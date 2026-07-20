// apply-scrap-sheet-v2.mjs — applies "Scrap Sheet v2.xlsx" (Jul 2026):
//
// PART 1 (scenarios row): prune each supplied state's skuDetail to exactly its
// new SKU roster (MA, AZ, IL, MI, NM) and add newly-listed SKUs as zero rows.
// Base + "HD" variants are SEPARATE rows sharing the same PL- SKU (110/420),
// so Market Demand shows them separately while MRP combines them by SKU.
// HD-only flavors use their own codes (445/450/455).
//
// PART 2 (actuals row): inbound updates —
//  - PO9245 block (from "Wana ETA (2).xlsx"): CP-19 + CP-24 delivered,
//    CP-17→7/17, CP-25→7/24, CP-30→7/31 + revised lines, CP-32→8/3.
//  - Add CP-26 (White base 6,048, ETA 7/25).
//  - DELETE the 18 "CP pending — <SKU>" placeholders and add the real
//    containers CP-31/33/34/35/36/38/39/40 with ETAs from the sheet.
//    (CP-35 Stay Asleep 87,782 per sheet, re-confirmed in v2.)
//
//   node scripts/apply-scrap-sheet-v2.mjs          → dry run (backups + diff)
//   node scripts/apply-scrap-sheet-v2.mjs --live   → PATCH both rows

import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = "https://fxdyiurjioesdmedmgzu.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4ZHlpdXJqaW9lc2RtZWRtZ3p1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzIzOTYsImV4cCI6MjA4ODMwODM5Nn0.5ueK5iXQ35oThb02ClX3iErPwYR4tPih9GtBAmhDQYk";
const HEADERS = { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };
const SC_URL = `${SUPABASE_URL}/rest/v1/scenarios?id=eq.1`;
const ACT_URL = `${SUPABASE_URL}/rest/v1/actuals?id=eq.1`;

// ── PART 1: state rosters — [canonName, sku, cat] ; "HD" in name ⇒ HD variant row
const C = {
  FAG: ["Fast Asleep Grape", "PL-WCB-120-00", "Optimal"],
  SAD: ["Stay Asleep Dreamberry", "PL-WCB-110-00", "Optimal"],
  SADHD: ["Stay Asleep Dreamberry HD", "PL-WCB-110-00", "HD"],
  KCB: ["Keep Calm Blissberry", "PL-WCB-125-00", "Optimal"],
  GTC: ["Good Time Clementine", "PL-WCB-105-00", "Optimal"],
  SRC: ["Swift Recovery Cherry Cola", "PL-WCB-115-00", "Optimal"],
  PP:  ["Passion Pineapple", "PL-WCB-420-00", "Classic"],
  PPHD:["Passion Pineapple HD", "PL-WCB-420-00", "HD"],
  RR:  ["Relaxed Raspberry", "PL-WCB-485-00", "Quick"],
  PPE: ["Peaceful Pear", "PL-WCB-480-00", "Quick"],
  BP:  ["Bubbly Peach", "PL-WCB-460-00", "Quick"],
  SUN: ["Sunrise", "PL-WCB-465-00", "Quick"],
  BBL: ["Bright Berry Lime", "PL-WCB-475-00", "Quick"],
  POG: ["Paradise POG", "PL-WCB-470-00", "Quick"],
  BBG: ["Balanced Berry Guava", "PL-WCB-435-00", "Classic"],
  BRZ: ["Breezy Pineapple", "PL-WCB-440-00", "Classic"],
  CBC: ["Chill Black Cherry", "PL-WCB-425-00", "Classic"],
  GGM: ["Go Go Mango", "PL-WCB-405-00", "Classic"],
  MM:  ["Mellow Melon", "PL-WCB-430-00", "Classic"],
  BB:  ["Blissful Blueberry", "PL-WCB-415-00", "Classic"],
  SY:  ["Serene Yuzu", "PL-WCB-410-00", "Classic"],
  RRL: ["Robust Raspberry", "PL-WCB-445-00", "HD"],
  MGA: ["Mighty Green Apple", "PL-WCB-450-00", "HD"],
  BBO: ["Bold Blood Orange", "PL-WCB-455-00", "HD"],
};
const ROSTERS = {
  "Massachusetts": [C.PPE, C.BP, C.SUN, C.BBL, C.RR, C.BBG, C.BRZ, C.CBC, C.FAG, C.SAD, C.KCB, C.GTC, C.SRC, C.POG, C.PP, C.GGM, C.MM, C.BB],
  "Arizona": [C.FAG, C.KCB, C.GTC, C.SRC, C.SAD, C.SY, C.GGM, C.PP, C.RRL, C.BBG, C.MM, C.SUN, C.RR, C.PPE, C.BP, C.BBL, C.POG, C.SADHD, C.PPHD, C.MGA, C.BBO, C.CBC, C.BB],
  "Illinois": [C.FAG, C.SAD, C.KCB, C.GTC, C.BB, C.GGM, C.MM, C.SY, C.CBC, C.BRZ, C.BP, C.RR, C.SUN, C.PPE, C.BBL],
  "Michigan": [C.PP, C.CBC, C.BBG, C.SY, C.BB, C.GGM, C.MM, C.FAG, C.KCB, C.GTC, C.SRC, C.SAD, C.RR, C.SUN, C.BP, C.BBL],
  "New Mexico": [C.FAG, C.SAD, C.BBO, C.BB, C.MGA, C.SY, C.GGM, C.PP, C.RRL, C.BBG, C.RR, C.PPE, C.BP, C.BBL, C.SRC, C.GTC, C.CBC, C.SUN, C.PPHD, C.BRZ, C.SADHD],
};
const isHD = (name) => /HD$/i.test(name.trim());
const rkey = (sku, name) => sku + "|" + (isHD(name) ? "HD" : "");

// ── PART 2: inbound data
const AMEND = [ // ref, fields to set (lines replace when present)
  { ref: "CP-19", set: { received: true } },
  { ref: "CP-24", set: { received: true } },
  { ref: "CP-17", set: { eta: "2026-07-17" } },
  { ref: "CP-25", set: { eta: "2026-07-24" } },
  { ref: "CP-32", set: { eta: "2026-08-03" } },
  { ref: "CP-30", set: { eta: "2026-07-31", factoryRefIfEmpty: "HCM26060100",
    lines: [["PL-WCB-460-00",19872],["PL-WCB-420-00",10546],["PL-WCB-120-00",26082],["PL-WCB-480-00",19872],["PL-WCB-485-00",16146],["PL-WCB-405-00",14904],["PL-WCB-415-00",8694],["PL-WCB-470-00",12420],["PL-WCB-425-00",16146],["PL-WCB-475-00",4968],["PL-WCB-410-00",13662],["PL-WCB-465-00",12420],["PL-WCB-440-00",16146],["PL-WCB-435-00",16146],["PB-WCB-002-00",22680]] } },
];
const NEW_SHIPS = [
  { ref: "CP-26", factoryRef: "HCM26050084", shipDate: "2026-06-18", eta: "2026-07-25", lines: [["PB-WCB-002-00",6048]] },
  { ref: "CP-31", factoryRef: "", shipDate: "2026-07-16", eta: "2026-08-23", lines: [["PB-WCB-002-00",173880],["PB-WCB-221-00",52980]] },
  { ref: "CP-33", factoryRef: "HCM26070016", shipDate: "2026-07-16", eta: "2026-08-23", lines: [["PB-WCB-002-00",15120],["PL-WCB-465-00",51030]] },
  { ref: "CP-34", factoryRef: "HCM26070046", shipDate: "2026-07-25", eta: "2026-09-03", lines: [["PB-WCB-221-00",34020]] },
  { ref: "CP-35", factoryRef: "HCM26070045", shipDate: "2026-07-25", eta: "2026-09-03", lines: [["PL-WCB-105-00",20412],["PL-WCB-110-00",87782]] },
  { ref: "CP-36", factoryRef: "HCM26070056", shipDate: "2026-08-03", eta: "2026-09-09", lines: [["PB-WCB-221-00",163296],["PL-WCB-125-00",20412],["PL-WCB-115-00",26082],["PL-WCB-475-00",30618],["PL-WCB-490-00",151956],["PB-WCB-221-00",79380]] },
  { ref: "CP-38", factoryRef: "HCM26070089", shipDate: "2026-08-10", eta: "2026-09-17", lines: [["PL-WCB-420-00",32886],["PL-WCB-470-00",30618],["PL-WCB-460-00",45360],["PB-WCB-002-00",189000]] },
  { ref: "CP-39", factoryRef: "HCM26070081", shipDate: "2026-08-16", eta: "2026-09-24", lines: [["PL-WCB-480-00",35154],["PL-WCB-485-00",26082],["PB-WCB-002-00",206388]] },
  { ref: "CP-40", factoryRef: "HCM26070082", shipDate: "2026-08-23", eta: "2026-10-01", lines: [["PL-WCB-120-00",51030],["PL-WCB-425-00",20412],["PL-WCB-435-00",20412],["PL-WCB-410-00",5670],["PB-WCB-002-00",2268]] },
];

const live = process.argv.includes("--live");
const ts = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync(new URL("./backups/", import.meta.url), { recursive: true });

const [scRes, actRes] = await Promise.all([fetch(SC_URL, { headers: HEADERS }), fetch(ACT_URL, { headers: HEADERS })]);
if (!scRes.ok || !actRes.ok) { console.error("fetch failed", scRes.status, actRes.status); process.exit(1); }
const scRow = (await scRes.json())[0];
const actRow = (await actRes.json())[0];
writeFileSync(new URL(`./backups/scenarios-${ts}.json`, import.meta.url), JSON.stringify(scRow, null, 1));
writeFileSync(new URL(`./backups/actuals-${ts}.json`, import.meta.url), JSON.stringify(actRow, null, 1));
console.log(`── apply-scrap-sheet-v2 ${live ? "(LIVE)" : "(dry run)"} — backups saved ──`);

// PART 1
console.log("\n=== PART 1: state SKU rosters (prune to match) ===");
const markets = scRow.data[0].markets;
for (const [state, roster] of Object.entries(ROSTERS)) {
  const mk = markets.find((m) => m.name === state);
  if (!mk || !mk.skuDetail || !mk.skuDetail.skus) { console.error(`⚠ ${state}: no skuDetail — skipped`); continue; }
  const det = mk.skuDetail;
  const weekly = !!det.weeks;
  const zeroArr = () => new Array(weekly ? det.weeks.length : 12).fill(0);
  const wantKeys = new Set(roster.map(([n, s]) => rkey(s, n)));
  const before = det.skus.length;
  const removed = det.skus.filter((s) => !wantKeys.has(rkey(s.sku, s.name)));
  det.skus = det.skus.filter((s) => wantKeys.has(rkey(s.sku, s.name)));
  const haveKeys = new Set(det.skus.map((s) => rkey(s.sku, s.name)));
  const added = [];
  for (const [name, sku, cat] of roster) {
    if (haveKeys.has(rkey(sku, name))) continue;
    const row = weekly ? { cat, name, sku, startWk: 0, weekly: zeroArr() } : { cat, name, sku, startMo: mk.goLive ? mk.goLive - 1 : 0, monthly: zeroArr() };
    det.skus.push(row); added.push(name);
  }
  const rmQty = removed.reduce((a, s) => a + (s.monthly || s.weekly || []).reduce((x, y) => x + (+y || 0), 0), 0);
  console.log(`${state}: ${before} → ${det.skus.length} rows · removed ${removed.length} (${Math.round(rmQty).toLocaleString()} u: ${removed.map((r) => r.name).join(", ") || "—"}) · added ${added.length} (${added.join(", ") || "—"})`);
}

// PART 2
console.log("\n=== PART 2: inbound tracker ===");
const inbound = actRow.data.inbound;
for (const a of AMEND) {
  const sh = inbound.find((x) => x.ref === a.ref);
  if (!sh) { console.error(`⚠ ${a.ref} not found`); continue; }
  const bits = [];
  if (a.set.received) { sh.received = true; bits.push("received"); }
  if (a.set.eta) { bits.push(`eta ${sh.eta || "—"}→${a.set.eta}`); sh.eta = a.set.eta; }
  if (a.set.factoryRefIfEmpty && !sh.factoryRef) { sh.factoryRef = a.set.factoryRefIfEmpty; bits.push("factoryRef set"); }
  if (a.set.lines) { const oldU = sh.lines.reduce((x, l) => x + (+l.qty || 0), 0); sh.lines = a.set.lines.map(([sku, qty]) => ({ sku, qty })); const newU = a.set.lines.reduce((x, l) => x + l[1], 0); bits.push(`lines ${oldU.toLocaleString()}→${newU.toLocaleString()} u`); }
  console.log(`AMEND ${a.ref}: ${bits.join(" · ")}`);
}
const pendings = inbound.filter((x) => (x.ref || "").startsWith("CP pending"));
actRow.data.inbound = inbound.filter((x) => !(x.ref || "").startsWith("CP pending"));
console.log(`DELETE ${pendings.length} "CP pending" placeholders (${pendings.reduce((a, s) => a + s.lines.reduce((x, l) => x + (+l.qty || 0), 0), 0).toLocaleString()} u — replaced by real containers)`);
let idSeed = Date.now();
for (const n of NEW_SHIPS) {
  if (actRow.data.inbound.some((x) => x.ref === n.ref)) { console.log(`SKIP ${n.ref} (exists)`); continue; }
  actRow.data.inbound.push({ id: idSeed++ + Math.random(), ref: n.ref, factoryRef: n.factoryRef, shipDate: n.shipDate, truckDate: "", railDate: "", eta: n.eta, received: false, lines: n.lines.map(([sku, qty]) => ({ sku, qty })) });
  console.log(`ADD   ${n.ref}: ETA ${n.eta}, ${n.lines.reduce((a, l) => a + l[1], 0).toLocaleString()} u, ${n.lines.length} lines`);
}
const totU = actRow.data.inbound.reduce((a, s) => a + s.lines.reduce((x, l) => x + (+l.qty || 0), 0), 0);
console.log(`inbound now: ${actRow.data.inbound.length} shipments, ${totU.toLocaleString()} units`);

if (!live) { console.log("\nDry run only — re-run with --live to write."); process.exit(0); }
const p1 = await fetch(SC_URL, { method: "PATCH", headers: { ...HEADERS, Prefer: "return=minimal" }, body: JSON.stringify({ data: scRow.data, updated_at: new Date().toISOString() }) });
if (!p1.ok) { console.error(`scenarios PATCH failed ${p1.status} ${await p1.text()}`); process.exit(1); }
console.log("✓ state rosters applied.");
const p2 = await fetch(ACT_URL, { method: "PATCH", headers: { ...HEADERS, Prefer: "return=minimal" }, body: JSON.stringify({ data: actRow.data, updated_at: new Date().toISOString() }) });
if (!p2.ok) { console.error(`actuals PATCH failed ${p2.status} ${await p2.text()}`); process.exit(1); }
console.log("✓ inbound tracker updated.");
