// apply-jun12-updates.mjs — applies Cory's Jun-12 data revisions:
//  1. actuals.inbound ← "Wana ETA.xlsx" (explicit ETAs to SLC; CP-20/CP-14 back
//     to in-transit; new CP-24/CP-25/CP-30; revised CP-16/17/19/22 quantities;
//     supersedes the old pending CP-23 placeholder). All other actuals keys
//     (outbound, poLines, adjustments, targets, milestones) are PRESERVED.
//  2. Colorado market ← "CO Rebrand Production Schedule (4).xlsx" sheet
//     "CO Rebrand MPS (4.30)": weekly skuDetail Aug 3 – Dec 21 (assorted + Med
//     rows mapped to PL-WCB-490-00) and mk.demand recomputed (Jan–Jul = 0).
//
//   node scripts/apply-jun12-updates.mjs          → dry run (backs up + prints)
//   node scripts/apply-jun12-updates.mjs --live   → PATCHes both rows
//
// Backups are written to scripts/backups/ before any write.

import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = "https://fxdyiurjioesdmedmgzu.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4ZHlpdXJqaW9lc2RtZWRtZ3p1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzIzOTYsImV4cCI6MjA4ODMwODM5Nn0.5ueK5iXQ35oThb02ClX3iErPwYR4tPih9GtBAmhDQYk";
const HEADERS = { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };
const ACTUALS_URL = `${SUPABASE_URL}/rest/v1/actuals?id=eq.1`;
const SCENARIOS_URL = `${SUPABASE_URL}/rest/v1/scenarios?id=eq.1`;

// ── 1. Inbound (Wana ETA.xlsx) ──────────────────────────────────────────────
const INBOUND = [
  { id: 1001, ref: "CP-11", factoryRef: "HCM26040021", shipDate: "", truckDate: "", railDate: "", eta: "", received: true,
    lines: [ { sku: "PL-WCB-125-00", qty: 3888 }, { sku: "PL-WCB-110-00", qty: 1296 }, { sku: "PB-WCB-221-00", qty: 32508 } ] },
  { id: 1002, ref: "CP-20", factoryRef: "HCM26050011", shipDate: "2026-05-14", truckDate: "", railDate: "", eta: "2026-06-15", received: false,
    lines: [ { sku: "PB-WCB-221-00", qty: 28350 }, { sku: "PB-WCB-002-00", qty: 11340 }, { sku: "PL-WCB-120-00", qty: 10368 },
             { sku: "PL-WCB-115-00", qty: 15552 }, { sku: "PL-WCB-125-00", qty: 10368 }, { sku: "PL-WCB-110-00", qty: 14496 } ] },
  { id: 1003, ref: "CP-14", factoryRef: "HCM26050012", shipDate: "2026-05-28", truckDate: "", railDate: "", eta: "2026-06-29", received: false,
    lines: [ { sku: "PB-WCB-221-00", qty: 22680 } ] },
  { id: 1009, ref: "CP-24", factoryRef: "", shipDate: "2026-06-13", truckDate: "", railDate: "", eta: "2026-07-03", received: false,
    lines: [ { sku: "PL-WCB-460-00", qty: 11178 }, { sku: "PL-WCB-120-00", qty: 9936 }, { sku: "PL-WCB-480-00", qty: 11178 },
             { sku: "PL-WCB-485-00", qty: 11178 }, { sku: "PL-WCB-405-00", qty: 3726 }, { sku: "PL-WCB-415-00", qty: 7452 },
             { sku: "PL-WCB-420-00", qty: 4968 }, { sku: "PL-WCB-410-00", qty: 2484 }, { sku: "PL-WCB-465-00", qty: 7452 },
             { sku: "PL-WCB-470-00", qty: 3726 } ] },
  { id: 1005, ref: "CP-16", factoryRef: "HCM26050065", shipDate: "2026-06-05", truckDate: "", railDate: "", eta: "2026-07-11", received: false,
    lines: [ { sku: "PL-WCB-430-00", qty: 15552 }, { sku: "PB-WCB-221-00", qty: 28728 }, { sku: "PB-WCB-002-00", qty: 24948 }, { sku: "PL-WCB-110-00", qty: 20736 } ] },
  { id: 1007, ref: "CP-22", factoryRef: "HCM26050110", shipDate: "2026-06-05", truckDate: "", railDate: "", eta: "2026-07-11", received: false,
    lines: [ { sku: "PB-WCB-002-00", qty: 54432 }, { sku: "PL-WCB-110-00", qty: 10022 }, { sku: "PL-WCB-475-00", qty: 6480 } ] },
  { id: 1006, ref: "CP-17", factoryRef: "HCM26050067", shipDate: "2026-05-30", truckDate: "", railDate: "", eta: "2026-07-15", received: false,
    lines: [ { sku: "PB-WCB-002-00", qty: 5670 }, { sku: "PL-WCB-475-00", qty: 6480 } ] },
  { id: 1004, ref: "CP-19", factoryRef: "HCM26050066", shipDate: "2026-05-18", truckDate: "", railDate: "", eta: "2026-07-15", received: false,
    lines: [ { sku: "PL-WCB-485-00", qty: 5184 }, { sku: "PB-WCB-221-00", qty: 10584 }, { sku: "PB-WCB-002-00", qty: 1512 } ] },
  { id: 1010, ref: "CP-25", factoryRef: "", shipDate: "2026-06-18", truckDate: "", railDate: "", eta: "2026-07-24", received: false,
    lines: [ { sku: "PB-WCB-002-00", qty: 6048 } ] },
  { id: 1011, ref: "CP-30", factoryRef: "", shipDate: "2026-07-07", truckDate: "", railDate: "", eta: "2026-08-12", received: false,
    lines: [ { sku: "PL-WCB-460-00", qty: 22356 }, { sku: "PL-WCB-420-00", qty: 11178 }, { sku: "PL-WCB-120-00", qty: 29808 },
             { sku: "PL-WCB-480-00", qty: 19872 }, { sku: "PL-WCB-485-00", qty: 14904 }, { sku: "PL-WCB-405-00", qty: 14904 },
             { sku: "PL-WCB-415-00", qty: 8694 }, { sku: "PL-WCB-470-00", qty: 12420 }, { sku: "PL-WCB-425-00", qty: 16146 },
             { sku: "PL-WCB-410-00", qty: 13662 }, { sku: "PL-WCB-465-00", qty: 12420 }, { sku: "PL-WCB-440-00", qty: 16146 },
             { sku: "PL-WCB-435-00", qty: 16146 }, { sku: "PB-WCB-002-00", qty: 156114 } ] },
];

// ── 2. Colorado weekly plan (CO Rebrand MPS (4.30), Aug 3 – Dec 21) ─────────
const CO_WEEKS = ["2026-08-03","2026-08-10","2026-08-17","2026-08-24","2026-08-31","2026-09-07","2026-09-14","2026-09-21","2026-09-28","2026-10-05","2026-10-12","2026-10-19","2026-10-26","2026-11-02","2026-11-09","2026-11-16","2026-11-23","2026-11-30","2026-12-07","2026-12-14","2026-12-21"];
const CO_SKUS = [
  { cat:"Optimal", name:"Fast Asleep Grape 1:1:1",        sku:"PL-WCB-120-00", startWk:0, weekly:[0,8889,0,0,8889,0,0,10667,0,10667,0,0,10667,0,0,0,10667,0,0,10667,0] },
  { cat:"Optimal", name:"Stay Asleep Dream Berry",        sku:"PL-WCB-110-00", startWk:0, weekly:[17778,0,17778,0,0,0,17778,0,0,0,21333,0,0,21333,0,0,21333,0,21333,0,0] },
  { cat:"Optimal", name:"Keep Calm Blissberry",           sku:"PL-WCB-125-00", startWk:0, weekly:[0,0,8889,0,0,0,0,0,5333,0,0,5556,0,0,5556,0,5556,0,0,0,0] },
  { cat:"Optimal", name:"Swift Recovery Cherry Cola",     sku:"PL-WCB-115-00", startWk:0, weekly:[0,0,0,7111,0,0,0,3556,0,5556,0,0,5556,0,0,0,5556,0,0,0,0] },
  { cat:"Optimal", name:"Good Time Clementine",           sku:"PL-WCB-105-00", startWk:0, weekly:[0,0,7111,0,0,0,0,5333,0,0,0,0,5556,0,0,5556,0,0,5556,0,0] },
  { cat:"Quick",   name:"Bright Berry Lime 1:1",          sku:"PL-WCB-475-00", startWk:0, weekly:[0,8889,0,8889,0,0,0,0,5333,0,6444,0,0,6444,0,0,0,6444,0,6444,0] },
  { cat:"Quick",   name:"Bubbly Peach",                   sku:"PL-WCB-460-00", startWk:0, weekly:[0,10667,0,0,10667,0,0,0,10667,0,0,10667,0,0,0,0,10667,0,0,10667,0] },
  { cat:"Quick",   name:"Peaceful Pear",                  sku:"PL-WCB-480-00", startWk:0, weekly:[0,10667,0,0,0,10667,0,0,0,6444,0,0,6444,0,0,0,6444,0,0,6444,0] },
  { cat:"Quick",   name:"Colorado Sunrise",               sku:"PL-WCB-465-00", startWk:0, weekly:[8889,0,8889,0,0,10000,0,0,10000,0,0,0,10000,0,0,10000,0,0,0,0,10000] },
  { cat:"Quick",   name:"Relaxed Raspberry",              sku:"PL-WCB-485-00", startWk:0, weekly:[0,0,0,8889,0,0,0,0,8889,0,0,5556,0,0,5556,0,0,5556,0,0,0] },
  { cat:"Quick",   name:"Paradise POG",                   sku:"PL-WCB-470-00", startWk:0, weekly:[0,0,0,0,8333,0,8333,0,0,6667,0,6667,0,6667,0,6667,6667,0,0,0,6667] },
  { cat:"Classic", name:"Hybrid Assorted",                sku:"PL-WCB-490-00", startWk:0, weekly:[0,0,0,0,0,0,17778,0,0,11111,0,0,11111,0,0,11111,0,11111,0,0,11111] },
  { cat:"Classic", name:"Indica Assorted",                sku:"PL-WCB-490-00", startWk:0, weekly:[0,0,0,0,0,17778,0,0,0,17778,0,0,0,0,0,0,13333,0,13333,0,13333] },
  { cat:"Classic", name:"Sativa Assorted",                sku:"PL-WCB-490-00", startWk:0, weekly:[0,0,0,0,0,17778,0,0,0,13333,0,0,13333,0,0,0,0,13333,0,13333,0] },
  { cat:"Classic", name:"Passionfruit Pineapple 1:1",     sku:"PL-WCB-420-00", startWk:0, weekly:[0,0,0,0,10667,0,0,0,7111,0,6667,0,0,6667,0,6667,0,6667,0,6667,0] },
  { cat:"Classic", name:"Chill Black Cherry 5:1",         sku:"PL-WCB-425-00", startWk:0, weekly:[5333,0,0,0,0,0,0,5333,0,0,0,4444,0,0,0,4444,0,0,0,4444,0] },
  { cat:"Classic", name:"Balanced Berry Guava 1:1",       sku:"PL-WCB-435-00", startWk:0, weekly:[7111,0,0,0,0,0,0,0,7111,0,0,0,4444,0,0,0,4444,0,0,0,4444] },
  { cat:"Classic", name:"Serene Yuzu 2:1",                sku:"PL-WCB-410-00", startWk:0, weekly:[0,0,0,0,0,0,0,4444,0,0,0,0,0,0,0,4444,0,0,0,0,0] },
  { cat:"Med",     name:"(Med) Berry Patch Assorted",     sku:"PL-WCB-490-00", startWk:0, weekly:[0,0,0,0,0,0,3333,0,0,0,0,3333,0,0,0,0,0,3333,0,0,0] },
  { cat:"Med",     name:"(Med) Tropical Trio Assorted",   sku:"PL-WCB-490-00", startWk:0, weekly:[3333,0,0,0,0,0,0,0,0,3333,0,0,0,3333,0,0,0,0,0,3333,0] },
  { cat:"Med",     name:"(Med) Lemonade Stand Assorted",  sku:"PL-WCB-490-00", startWk:0, weekly:[0,0,0,0,0,0,3333,0,0,0,0,3333,0,0,0,0,0,3333,0,0,0] },
  { cat:"Med",     name:"(Med) Stay Asleep 1:1:1",        sku:"PL-WCB-490-00", startWk:0, weekly:[0,0,0,0,3333,0,0,0,0,0,0,3333,0,0,0,0,0,3333,0,0,0] },
  { cat:"Med",     name:"(Med) Pineapple Passionfruit",   sku:"PL-WCB-490-00", startWk:0, weekly:[3333,0,0,0,0,0,0,0,3333,0,0,0,0,3333,0,0,0,0,0,3333,0] },
];

// CO monthly demand recomputed from the weekly plan (week assigned by its Monday's month)
const CO_DEMAND = (() => {
  const d = new Array(12).fill(0);
  CO_SKUS.forEach((s) => s.weekly.forEach((v, wi) => {
    const mo = Number(CO_WEEKS[wi].split("-")[1]) - 1;
    d[mo] += v;
  }));
  return d.map((v) => Math.round(v));
})();

const live = process.argv.includes("--live");
const sum = (sh) => sh.lines.reduce((a, l) => a + l.qty, 0);
const ts = new Date().toISOString().replace(/[:.]/g, "-");

console.log(`── apply-jun12-updates ${live ? "(LIVE)" : "(dry run)"} ──`);
console.log(`inbound: ${INBOUND.length} shipments, ${INBOUND.reduce((a, s) => a + sum(s), 0).toLocaleString()} units (${INBOUND.filter((s) => s.received).length} received)`);
console.log(`CO weekly plan: ${CO_SKUS.length} rows, ${CO_SKUS.reduce((a, s) => a + s.weekly.reduce((x, y) => x + y, 0), 0).toLocaleString()} units Aug–Dec`);
console.log(`CO monthly demand → Aug ${CO_DEMAND[7].toLocaleString()} · Sep ${CO_DEMAND[8].toLocaleString()} · Oct ${CO_DEMAND[9].toLocaleString()} · Nov ${CO_DEMAND[10].toLocaleString()} · Dec ${CO_DEMAND[11].toLocaleString()} (Jan–Jul 0)`);

const [actRes, scRes] = await Promise.all([
  fetch(ACTUALS_URL, { headers: HEADERS }),
  fetch(SCENARIOS_URL, { headers: HEADERS }),
]);
if (!actRes.ok || !scRes.ok) { console.error("Fetch failed", actRes.status, scRes.status); process.exit(1); }
const actRow = (await actRes.json())[0];
const scRow = (await scRes.json())[0];
if (!actRow || !scRow) { console.error("Missing rows"); process.exit(1); }

mkdirSync(new URL("./backups/", import.meta.url), { recursive: true });
writeFileSync(new URL(`./backups/actuals-${ts}.json`, import.meta.url), JSON.stringify(actRow, null, 1));
writeFileSync(new URL(`./backups/scenarios-${ts}.json`, import.meta.url), JSON.stringify(scRow, null, 1));
console.log(`backups written: scripts/backups/{actuals,scenarios}-${ts}.json`);

const newActuals = { ...actRow.data, inbound: INBOUND };
console.log(`preserving: outbound ${actRow.data.outbound?.length ?? 0} · poLines ${actRow.data.poLines?.length ?? 0} · adjustments ${actRow.data.adjustments?.length ?? 0} · targets ${actRow.data.targets?.rows?.length ?? 0} · milestones ${actRow.data.milestones?.length ?? 0}`);

const scenarios = scRow.data;
const co = scenarios[0] && scenarios[0].markets && scenarios[0].markets.find((m) => m.name === "Colorado");
if (!co) { console.error("Colorado market not found in scenario 0"); process.exit(1); }
const oldAnnual = (co.demand || []).reduce((a, b) => a + b, 0);
co.skuDetail = { weeks: CO_WEEKS, skus: CO_SKUS };
co.demand = CO_DEMAND;
console.log(`CO demand annual: ${Math.round(oldAnnual).toLocaleString()} → ${CO_DEMAND.reduce((a, b) => a + b, 0).toLocaleString()} (goLive stays ${co.goLive})`);

if (!live) { console.log("\nDry run only — re-run with --live to write."); process.exit(0); }

const p1 = await fetch(ACTUALS_URL, { method: "PATCH", headers: { ...HEADERS, Prefer: "return=minimal" },
  body: JSON.stringify({ data: newActuals, updated_at: new Date().toISOString() }) });
if (!p1.ok) { console.error(`actuals PATCH failed: ${p1.status} ${await p1.text()}`); process.exit(1); }
console.log("✓ actuals.inbound updated.");

const p2 = await fetch(SCENARIOS_URL, { method: "PATCH", headers: { ...HEADERS, Prefer: "return=minimal" },
  body: JSON.stringify({ data: scenarios, updated_at: new Date().toISOString() }) });
if (!p2.ok) { console.error(`scenarios PATCH failed: ${p2.status} ${await p2.text()}`); process.exit(1); }
console.log("✓ Colorado weekly plan applied.");
