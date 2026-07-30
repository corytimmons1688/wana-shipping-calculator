// apply-eta-5.mjs — applies "Wana ETA (5).xlsx" (Jul 30 2026) to the inbound tracker.
//
//  · AMEND 11 containers: ETA changes + revised line quantities
//      CP-31 black base 52,980→52,920 and factory ref HCM26070094 (was blank)
//      CP-36 Assorted 151,956→102,060  (49,896 moved to the AIR shipment)
//      CP-39 Relaxed Rasp 26,082→19,278, White base 206,388→79,380,
//            + PO9490 lines Mighty Green Apple 20,412 / Mellow Melon 4,536
//  · ADD  AIR shipment (ETA 8/7): Sunrise 18,144 + Assorted 49,896 — this is
//         the Compax air quote from 7/22 ("50K assorted and 18K sunrise").
//  · ADD  Fast Boat (ETA 8/27): 9 lid lines, 134,946 u
//  · ADD  PO9490 placeholder shipments, one per SKU with its own CRD/ETA,
//         REPLACING the single undated 141,120-unit placeholder now in the row.
//  · CP-42 is deliberately NOT added — see the note printed at the end.
//
//   node scripts/apply-eta-5.mjs          → dry run (backup + diff)
//   node scripts/apply-eta-5.mjs --live   → PATCH

import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = "https://fxdyiurjioesdmedmgzu.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4ZHlpdXJqaW9lc2RtZWRtZ3p1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzIzOTYsImV4cCI6MjA4ODMwODM5Nn0.5ueK5iXQ35oThb02ClX3iErPwYR4tPih9GtBAmhDQYk";
const HEADERS = { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };
const URL_ = `${SUPABASE_URL}/rest/v1/actuals?id=eq.1`;

// ── amendments: ref → { eta?, factoryRef?, lines? } (lines REPLACE when given)
const AMEND = {
  "CP-25": { eta: "2026-08-03" },
  "CP-26": { eta: "2026-07-31" },
  "CP-32": { eta: "2026-08-10" },
  "CP-31": { eta: "2026-08-27", factoryRef: "HCM26070094",
    lines: [["PB-WCB-002-00", 173880], ["PB-WCB-221-00", 52920]] },
  "CP-33": { eta: "2026-08-31" },
  "CP-34": { eta: "2026-09-08" },
  "CP-35": { eta: "2026-09-08" },
  "CP-36": { eta: "2026-09-05",
    lines: [["PB-WCB-221-00", 163296], ["PL-WCB-125-00", 20412], ["PL-WCB-115-00", 26082],
            ["PL-WCB-475-00", 30618], ["PL-WCB-490-00", 102060], ["PB-WCB-221-00", 79380]] },
  "CP-38": { eta: "2026-09-21" },
  "CP-39": { eta: "2026-09-19",
    lines: [["PL-WCB-480-00", 35154], ["PL-WCB-485-00", 19278], ["PB-WCB-002-00", 79380],
            ["PL-WCB-450-00", 20412], ["PL-WCB-430-00", 4536]] },
  "CP-40": { eta: "2026-09-26" },
};

const NEW = [
  { ref: "AIR — PO9472/9490", factoryRef: "AIR", shipDate: "", eta: "2026-08-07",
    lines: [["PL-WCB-465-00", 18144], ["PL-WCB-490-00", 49896]] },
  { ref: "Fast Boat — PO9472", factoryRef: "PO9472", shipDate: "", eta: "2026-08-27",
    lines: [["PL-WCB-475-00", 10206], ["PL-WCB-110-00", 30618], ["PL-WCB-105-00", 10206],
            ["PL-WCB-125-00", 17010], ["PL-WCB-460-00", 10206], ["PL-WCB-470-00", 10206],
            ["PL-WCB-420-00", 20412], ["PL-WCB-480-00", 15876], ["PL-WCB-425-00", 10206]] },
  // PO9490 placeholders — one per SKU, each with its own cargo-ready date + ETA
  { ref: "PO9490 — Blissful Blueberry", factoryRef: "PO9490", shipDate: "2026-08-08", eta: "2026-09-22", lines: [["PL-WCB-415-00", 20412]] },
  { ref: "PO9490 — Mighty Green Apple", factoryRef: "PO9490", shipDate: "2026-08-09", eta: "2026-09-23", lines: [["PL-WCB-450-00", 20412]] },
  { ref: "PO9490 — Bright Berry Lime", factoryRef: "PO9490", shipDate: "2026-08-10", eta: "2026-09-24", lines: [["PL-WCB-475-00", 20412]] },
  { ref: "PO9490 — Go Go Mango", factoryRef: "PO9490", shipDate: "2026-08-11", eta: "2026-09-25", lines: [["PL-WCB-405-00", 20412]] },
  { ref: "PO9490 — Robust Raspberry", factoryRef: "PO9490", shipDate: "2026-08-15", eta: "2026-09-29", lines: [["PL-WCB-445-00", 20412]] },
  { ref: "PO9490 — Mellow Melon", factoryRef: "PO9490", shipDate: "2026-08-17", eta: "2026-10-01", lines: [["PL-WCB-430-00", 20412]] },
  { ref: "PO9490 — Sunrise", factoryRef: "PO9490", shipDate: "", eta: "", lines: [["PL-WCB-465-00", 2268]] },
];

const live = process.argv.includes("--live");
const res = await fetch(URL_, { headers: HEADERS });
if (!res.ok) { console.error(`fetch failed ${res.status}`); process.exit(1); }
const row = (await res.json())[0];
const ts = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync(new URL("./backups/", import.meta.url), { recursive: true });
writeFileSync(new URL(`./backups/actuals-${ts}.json`, import.meta.url), JSON.stringify(row, null, 1));
console.log(`── apply-eta-5 ${live ? "(LIVE)" : "(dry run)"} — backup saved ──\n`);

const sum = (ls) => (ls || []).reduce((a, l) => a + (Number(l.qty ?? l[1]) || 0), 0);
const inbound = row.data.inbound;

console.log("=== AMENDMENTS ===");
for (const [ref, a] of Object.entries(AMEND)) {
  const sh = inbound.find((s) => s.ref === ref);
  if (!sh) { console.error(`⚠ ${ref} not found — skipped`); continue; }
  const bits = [];
  if (a.eta && sh.eta !== a.eta) { bits.push(`ETA ${sh.eta || "—"} → ${a.eta}`); sh.eta = a.eta; }
  if (a.factoryRef && sh.factoryRef !== a.factoryRef) { bits.push(`factory ${sh.factoryRef || "—"} → ${a.factoryRef}`); sh.factoryRef = a.factoryRef; }
  if (a.lines) {
    const before = sum(sh.lines);
    sh.lines = a.lines.map(([sku, qty]) => ({ sku, qty }));
    const after = sum(a.lines);
    if (before !== after) bits.push(`units ${before.toLocaleString()} → ${after.toLocaleString()}`);
  }
  console.log(`${ref}: ${bits.length ? bits.join(" · ") : "no change"}`);
}

console.log("\n=== REPLACED PLACEHOLDER ===");
// The single undated PO9490 placeholder (ref blank or "TBD", 7 lines @ 20,160)
// is superseded by the per-SKU placeholders below — remove it or PO9490 double-counts.
const isOldPlaceholder = (s) => {
  const ref = (s.ref || "").trim().toUpperCase();
  return s.received !== true && (ref === "" || ref === "TBD") &&
    (s.lines || []).length > 1 && (s.lines || []).every((l) => Number(l.qty) === 20160);
};
const stale = inbound.filter(isOldPlaceholder);
for (const s of stale) console.log(`remove undated placeholder: eta ${s.eta || "—"}, ${sum(s.lines).toLocaleString()} u, ${s.lines.length} lines`);
row.data.inbound = inbound.filter((s) => !stale.includes(s));

console.log("\n=== NEW SHIPMENTS ===");
let seed = Date.now();
for (const n of NEW) {
  if (row.data.inbound.some((s) => s.ref === n.ref)) { console.log(`SKIP ${n.ref} (exists)`); continue; }
  row.data.inbound.push({ id: seed++ + Math.random(), ref: n.ref, factoryRef: n.factoryRef,
    shipDate: n.shipDate, truckDate: "", railDate: "", eta: n.eta, received: false,
    lines: n.lines.map(([sku, qty]) => ({ sku, qty })) });
  console.log(`ADD ${n.ref.padEnd(30)} eta ${(n.eta || "— none").padEnd(11)} ${sum(n.lines).toLocaleString().padStart(9)} u`);
}

const tot = row.data.inbound.reduce((a, s) => a + sum(s.lines), 0);
const intransit = row.data.inbound.filter((s) => s.received !== true).reduce((a, s) => a + sum(s.lines), 0);
console.log(`\ninbound now: ${row.data.inbound.length} shipments · ${tot.toLocaleString()} u total · ${intransit.toLocaleString()} u in transit`);
console.log("\n⚠ NOT ADDED — CP-42 (CRD 8/16, ETA 9/30: Go Go Mango 18,144 + Bright Berry Lime 20,412).");
console.log("  It overlaps the PO9490 placeholders for the same two SKUs; adding both would");
console.log("  double-count 38,556 u. Confirm whether CP-42 realizes those placeholders or is extra.");

if (!live) { console.log("\nDry run only — re-run with --live to write."); process.exit(0); }
const p = await fetch(URL_, { method: "PATCH", headers: { ...HEADERS, Prefer: "return=minimal" }, body: JSON.stringify({ data: row.data, updated_at: new Date().toISOString() }) });
if (!p.ok) { console.error(`PATCH failed ${p.status} ${await p.text()}`); process.exit(1); }
console.log("\n✓ inbound tracker updated.");
