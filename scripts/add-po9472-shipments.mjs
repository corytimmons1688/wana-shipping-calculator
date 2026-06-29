// add-po9472-shipments.mjs — add the PO9472 / WO647631 production lots
// (FRD 06/22/26 sheet) as Factory→Calyx inbound shipments. One shipment per
// SKU lot (each has its own ETA to SLC). CP numbers are pending, so ref is a
// placeholder the user renames when CP containers are assigned. Upsert by ref
// (idempotent: re-running updates in place, never duplicates). shipDate = EST
// FRD; eta = ETA to SLC. Total 1,291,248 units = PO9472.
//
//   node scripts/add-po9472-shipments.mjs          → dry run (backup + diff)
//   node scripts/add-po9472-shipments.mjs --live   → PATCH

import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = "https://fxdyiurjioesdmedmgzu.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4ZHlpdXJqaW9lc2RtZWRtZ3p1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzIzOTYsImV4cCI6MjA4ODMwODM5Nn0.5ueK5iXQ35oThb02ClX3iErPwYR4tPih9GtBAmhDQYk";
const HEADERS = { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };
const ROW_URL = `${SUPABASE_URL}/rest/v1/actuals?id=eq.1`;
const FACTORY = "PO9472 / WO647631";

// [sku, qty, frd (ship), eta]
const LOTS = [
  ["PL-WCB-465-00", 51030,  "2026-07-09", "2026-08-13"],
  ["PL-WCB-490-00", 151956, "2026-07-10", "2026-08-14"],
  ["PL-WCB-475-00", 30618,  "2026-07-21", "2026-08-25"],
  ["PL-WCB-110-00", 82782,  "2026-07-26", "2026-08-30"],
  ["PL-WCB-105-00", 20412,  "2026-07-27", "2026-08-31"],
  ["PL-WCB-125-00", 20412,  "2026-07-29", "2026-09-02"],
  ["PL-WCB-115-00", 26082,  "2026-08-01", "2026-09-05"],
  ["PL-WCB-460-00", 45360,  "2026-08-04", "2026-09-08"],
  ["PL-WCB-420-00", 32886,  "2026-08-05", "2026-09-09"],
  ["PL-WCB-470-00", 30618,  "2026-08-07", "2026-09-11"],
  ["PL-WCB-480-00", 35154,  "2026-08-12", "2026-09-16"],
  ["PL-WCB-485-00", 26082,  "2026-08-14", "2026-09-18"],
  ["PL-WCB-120-00", 51030,  "2026-08-17", "2026-09-21"],
  ["PL-WCB-425-00", 20412,  "2026-08-19", "2026-09-23"],
  ["PL-WCB-435-00", 20412,  "2026-08-21", "2026-09-25"],
  ["PL-WCB-410-00", 5670,   "2026-08-23", "2026-09-27"],
  ["PB-WCB-221-00", 197316, "2026-07-26", "2026-08-30"],
  ["PB-WCB-002-00", 443016, "2026-08-15", "2026-09-19"],
];

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

let added = 0, updated = 0, idSeed = Date.now();
console.log(`── add-po9472-shipments ${live ? "(LIVE)" : "(dry run)"} ──`);
for (const [sku, qty, frd, eta] of LOTS) {
  const ref = `CP pending — ${sku}`;
  const ex = data.inbound.find((x) => x.ref === ref);
  if (ex) {
    ex.factoryRef = FACTORY; ex.shipDate = frd; ex.truckDate = ""; ex.railDate = ""; ex.eta = eta; ex.received = false; ex.lines = [{ sku, qty }];
    updated++; console.log(`UPDATE ${ref}: ${qty} u, ETA ${eta}`);
  } else {
    data.inbound.push({ id: idSeed++ + Math.random(), ref, factoryRef: FACTORY, shipDate: frd, truckDate: "", railDate: "", eta, received: false, lines: [{ sku, qty }] });
    added++; console.log(`ADD    ${ref}: ${qty} u, FRD ${frd} → ETA ${eta}`);
  }
}
const total = LOTS.reduce((a, l) => a + l[1], 0);
console.log(`\nadded ${added}, updated ${updated}; PO9472 lot units: ${total.toLocaleString()}`);
console.log(`total inbound shipments now: ${data.inbound.length}, total inbound units: ${data.inbound.reduce((a, x) => a + (x.lines || []).reduce((s, l) => s + (Number(l.qty) || 0), 0), 0).toLocaleString()}`);
console.log(`backup: scripts/backups/actuals-${ts}.json`);

if (!live) { console.log("\nDry run only — re-run with --live to write."); process.exit(0); }
const patch = await fetch(ROW_URL, { method: "PATCH", headers: { ...HEADERS, Prefer: "return=minimal" }, body: JSON.stringify({ data, updated_at: new Date().toISOString() }) });
if (!patch.ok) { console.error(`PATCH failed ${patch.status} ${await patch.text()}`); process.exit(1); }
console.log("✓ PO9472 production lots added as inbound shipments.");
