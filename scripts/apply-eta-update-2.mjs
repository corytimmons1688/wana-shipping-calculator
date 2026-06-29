// apply-eta-update-2.mjs — add/amend Factory→Calyx inbound shipments from
// "Wana ETA (1).xlsx" (extracted 2026-06-18). Upserts by ref: existing
// shipments keep their id and are overwritten with the sheet's dates/eta/
// factory/lines/received; new refs are appended. Shipments not in the sheet
// (e.g. CP-11) are left untouched. SKU codes normalized to canonical form
// (drop "-C", fix sheet typos: 485 is a PL lid, 002/221 are PB bases).
//
//   node scripts/apply-eta-update-2.mjs          → dry run (backup + diff)
//   node scripts/apply-eta-update-2.mjs --live   → PATCH

import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = "https://fxdyiurjioesdmedmgzu.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4ZHlpdXJqaW9lc2RtZWRtZ3p1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzIzOTYsImV4cCI6MjA4ODMwODM5Nn0.5ueK5iXQ35oThb02ClX3iErPwYR4tPih9GtBAmhDQYk";
const HEADERS = { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };
const ROW_URL = `${SUPABASE_URL}/rest/v1/actuals?id=eq.1`;

const KNOWN = new Set([
  "PL-WCB-105-00","PL-WCB-110-00","PL-WCB-115-00","PL-WCB-120-00","PL-WCB-125-00",
  "PL-WCB-405-00","PL-WCB-410-00","PL-WCB-415-00","PL-WCB-420-00","PL-WCB-425-00",
  "PL-WCB-430-00","PL-WCB-435-00","PL-WCB-440-00","PL-WCB-460-00","PL-WCB-465-00",
  "PL-WCB-470-00","PL-WCB-475-00","PL-WCB-480-00","PL-WCB-485-00","PL-WCB-490-00",
  "PB-WCB-221-00","PB-WCB-002-00",
]);

// Sheet shipments (canonical SKUs). truck/rail cleared; eta is explicit.
const SHEET = [
  { ref:"CP-20", factoryRef:"HCM26050011", shipDate:"2026-05-14", eta:"2026-06-15", received:true,
    lines:[["PB-WCB-221-00",28350],["PB-WCB-002-00",11340],["PL-WCB-120-00",10368],["PL-WCB-115-00",15552],["PL-WCB-125-00",10368],["PL-WCB-110-00",14496]] },
  { ref:"CP-14", factoryRef:"HCM26050012", shipDate:"2026-05-28", eta:"", received:true,
    lines:[["PB-WCB-221-00",22680]] },
  { ref:"CP-16", factoryRef:"HCM26050065", shipDate:"2026-06-05", eta:"2026-07-20", received:false,
    lines:[["PL-WCB-430-00",15552],["PB-WCB-221-00",28728],["PB-WCB-002-00",24948],["PL-WCB-110-00",20736]] },
  { ref:"CP-17", factoryRef:"HCM26050067", shipDate:"", eta:"2026-07-28", received:false,
    lines:[["PB-WCB-002-00",5670],["PL-WCB-475-00",6480]] },
  { ref:"CP-19", factoryRef:"HCM26050066", shipDate:"", eta:"2026-07-01", received:false,
    lines:[["PL-WCB-485-00",5184],["PB-WCB-221-00",10584],["PB-WCB-002-00",1512]] },
  { ref:"CP-22", factoryRef:"HCM26050110", shipDate:"2026-06-05", eta:"2026-07-21", received:false,
    lines:[["PB-WCB-002-00",54432],["PL-WCB-110-00",10022],["PL-WCB-475-00",6480]] },
  { ref:"CP-24", factoryRef:"HCM26060063", shipDate:"2026-06-13", eta:"2026-07-10", received:false,
    lines:[["PL-WCB-460-00",11178],["PL-WCB-120-00",9936],["PL-WCB-480-00",11178],["PL-WCB-485-00",10314],["PL-WCB-405-00",3726],["PL-WCB-415-00",7452],["PL-WCB-420-00",4968],["PL-WCB-410-00",2484],["PL-WCB-465-00",7452],["PL-WCB-470-00",3726],["PB-WCB-002-00",17388]] },
  { ref:"CP-25", factoryRef:"HCM26060133", shipDate:"2026-06-18", eta:"2026-07-28", received:false,
    lines:[["PB-WCB-002-00",6048]] },
  { ref:"CP-30", factoryRef:"", shipDate:"2026-07-07", eta:"2026-08-01", received:false,
    lines:[["PL-WCB-460-00",19872],["PL-WCB-420-00",11178],["PL-WCB-120-00",26082],["PL-WCB-480-00",19872],["PL-WCB-485-00",16146],["PL-WCB-405-00",14904],["PL-WCB-415-00",8694],["PL-WCB-470-00",12420],["PL-WCB-425-00",16146],["PL-WCB-410-00",13662],["PL-WCB-465-00",12420],["PL-WCB-440-00",16146],["PL-WCB-435-00",16146],["PB-WCB-002-00",22680]] },
  { ref:"CP-32", factoryRef:"HCM26060142", shipDate:"2026-06-25", eta:"2026-08-01", received:false,
    lines:[["PB-WCB-002-00",90720]] },
];

const problems = [];
SHEET.forEach((s) => s.lines.forEach(([sku]) => { if (!KNOWN.has(sku)) problems.push(`${s.ref}: unknown SKU ${sku}`); }));
if (problems.length) { console.error("VALIDATION:"); problems.forEach((p) => console.error(" - " + p)); process.exit(1); }

const live = process.argv.includes("--live");
const res = await fetch(ROW_URL, { headers: HEADERS });
if (!res.ok) { console.error(`fetch failed ${res.status}`); process.exit(1); }
const row = (await res.json())[0];
if (!row) { console.error("actuals row missing"); process.exit(1); }
const data = row.data;
if (!Array.isArray(data.inbound)) data.inbound = [];

const ts = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync(new URL("./backups/", import.meta.url), { recursive: true });
writeFileSync(new URL(`./backups/actuals-${ts}.json`, import.meta.url), JSON.stringify(row, null, 1));

const sum = (lines) => lines.reduce((a, l) => a + (Array.isArray(l) ? l[1] : l.qty), 0);
let amended = 0, added = 0;
console.log(`── apply-eta-update-2 ${live ? "(LIVE)" : "(dry run)"} ──`);
for (const s of SHEET) {
  const lines = s.lines.map(([sku, qty]) => ({ sku, qty }));
  const ex = data.inbound.find((x) => x.ref === s.ref);
  const newTot = sum(s.lines);
  if (ex) {
    const before = `${ex.received ? "received" : ("ETA " + (ex.eta || "—"))}, ${sum(ex.lines || [])} u`;
    ex.factoryRef = s.factoryRef; ex.shipDate = s.shipDate; ex.truckDate = ""; ex.railDate = ""; ex.eta = s.eta; ex.received = s.received; ex.lines = lines;
    console.log(`AMEND ${s.ref}: [${before}] → [${s.received ? "received" : ("ETA " + (s.eta || "—"))}, ${newTot} u, ${lines.length} lines]`);
    amended++;
  } else {
    data.inbound.push({ id: Date.now() + Math.random(), ref: s.ref, factoryRef: s.factoryRef, shipDate: s.shipDate, truckDate: "", railDate: "", eta: s.eta, received: s.received, lines });
    console.log(`ADD   ${s.ref}: ${s.received ? "received" : ("ETA " + (s.eta || "—"))}, ${newTot} u, ${lines.length} lines`);
    added++;
  }
}
const untouched = data.inbound.filter((x) => !SHEET.some((s) => s.ref === x.ref)).map((x) => x.ref);
console.log(`\namended ${amended}, added ${added}; untouched: ${untouched.join(", ") || "none"}`);
console.log(`total inbound shipments: ${data.inbound.length}, total units: ${data.inbound.reduce((a, x) => a + sum(x.lines || []), 0).toLocaleString()}`);
console.log(`backup: scripts/backups/actuals-${ts}.json`);

if (!live) { console.log("\nDry run only — re-run with --live to write."); process.exit(0); }
const patch = await fetch(ROW_URL, { method: "PATCH", headers: { ...HEADERS, Prefer: "return=minimal" }, body: JSON.stringify({ data, updated_at: new Date().toISOString() }) });
if (!patch.ok) { console.error(`PATCH failed ${patch.status} ${await patch.text()}`); process.exit(1); }
console.log("✓ inbound shipments updated.");
