// seed-actuals.mjs — one-time seed of the shared `actuals` row (id=1) from
// Cory's tracking spreadsheets (Wana Rebrand.xlsx + Wana Cube Launch Shared
// Document.xlsx, extracted 2026-06-10).
//
//   node scripts/seed-actuals.mjs          → DRY RUN (prints diff, writes nothing)
//   node scripts/seed-actuals.mjs --live   → PATCHes the actuals row
//
// Safe to re-run: it REPLACES the whole actuals object, so only run --live
// before manual edits begin in the app (or re-extract first).

const SUPABASE_URL = "https://fxdyiurjioesdmedmgzu.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4ZHlpdXJqaW9lc2RtZWRtZ3p1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzIzOTYsImV4cCI6MjA4ODMwODM5Nn0.5ueK5iXQ35oThb02ClX3iErPwYR4tPih9GtBAmhDQYk";
const HEADERS = { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };
const ROW_URL = `${SUPABASE_URL}/rest/v1/actuals?id=eq.1`;

const KNOWN_SKUS = [
  "PL-WCB-105-00","PL-WCB-110-00","PL-WCB-115-00","PL-WCB-120-00","PL-WCB-125-00",
  "PL-WCB-405-00","PL-WCB-410-00","PL-WCB-415-00","PL-WCB-420-00","PL-WCB-425-00",
  "PL-WCB-430-00","PL-WCB-435-00","PL-WCB-440-00","PL-WCB-460-00","PL-WCB-465-00",
  "PL-WCB-470-00","PL-WCB-475-00","PL-WCB-480-00","PL-WCB-485-00","PL-WCB-490-00",
  "PL-WCB-LTO-01","PL-WCB-HD-01","PB-WCB-221-00","PB-WCB-002-00",
];

// ── Inbound: factory → Calyx (Wana Rebrand.xlsx · Shipments) ────────────────
const INBOUND = [
  { id: 1001, ref: "CP-11", factoryRef: "HCM26040021", shipDate: "", truckDate: "", railDate: "", received: true,
    lines: [ { sku: "PL-WCB-125-00", qty: 3888 }, { sku: "PL-WCB-110-00", qty: 1296 }, { sku: "PB-WCB-221-00", qty: 32508 } ] },
  { id: 1002, ref: "CP-20", factoryRef: "HCM26040083", shipDate: "", truckDate: "", railDate: "", received: true,
    lines: [ { sku: "PB-WCB-002-00", qty: 11340 }, { sku: "PB-WCB-221-00", qty: 28350 }, { sku: "PL-WCB-115-00", qty: 12960 },
             { sku: "PL-WCB-125-00", qty: 10368 }, { sku: "PL-WCB-120-00", qty: 10368 }, { sku: "PL-WCB-110-00", qty: 14496 } ] },
  { id: 1003, ref: "CP-14", factoryRef: "HCM26050012", shipDate: "", truckDate: "", railDate: "", received: true,
    lines: [ { sku: "PB-WCB-221-00", qty: 22680 } ] },
  { id: 1004, ref: "CP-19", factoryRef: "", shipDate: "2026-05-18", truckDate: "2026-06-23", railDate: "2026-07-18", received: false,
    lines: [ { sku: "PB-WCB-221-00", qty: 10584 }, { sku: "PB-WCB-002-00", qty: 1512 }, { sku: "PL-WCB-485-00", qty: 5184 } ] },
  { id: 1005, ref: "CP-16", factoryRef: "", shipDate: "2026-05-25", truckDate: "2026-06-30", railDate: "2026-07-26", received: false,
    lines: [ { sku: "PL-WCB-430-00", qty: 15552 }, { sku: "PB-WCB-002-00", qty: 30240 }, { sku: "PB-WCB-221-00", qty: 28656 }, { sku: "PL-WCB-110-00", qty: 20736 } ] },
  { id: 1006, ref: "CP-17", factoryRef: "", shipDate: "2026-05-25", truckDate: "2026-06-30", railDate: "2026-07-13", received: false,
    lines: [ { sku: "PB-WCB-002-00", qty: 1512 } ] },
  { id: 1007, ref: "CP-22", factoryRef: "", shipDate: "2026-06-05", truckDate: "2026-07-11", railDate: "", received: false,
    lines: [ { sku: "PL-WCB-475-00", qty: 17920 }, { sku: "PB-WCB-002-00", qty: 270720 } ] },
  { id: 1008, ref: "CP-23 (confirm ref)", factoryRef: "", shipDate: "2026-06-11", truckDate: "2026-07-01", railDate: "", received: false,
    lines: [ { sku: "PL-WCB-405-00", qty: 3888 }, { sku: "PL-WCB-460-00", qty: 9072 }, { sku: "PL-WCB-120-00", qty: 5184 },
             { sku: "PL-WCB-480-00", qty: 10368 }, { sku: "PL-WCB-485-00", qty: 10368 }, { sku: "PL-WCB-415-00", qty: 7776 },
             { sku: "PL-WCB-440-00", qty: 5184 }, { sku: "PL-WCB-410-00", qty: 2592 }, { sku: "PL-WCB-465-00", qty: 7776 },
             { sku: "PL-WCB-470-00", qty: 3888 } ] },
];

// ── Outbound: Calyx → Wana NJ (Wana Cube Launch · Actual Shipments) ─────────
const OUTBOUND = [
  { id: 2001, market: "New Jersey", dateShipped: "2026-06-10", arriveBy: "2026-06-16", tracking: "", delivered: false,
    lines: [ { sku: "PL-WCB-120-00", qty: 10206 }, { sku: "PL-WCB-110-00", qty: 12096 }, { sku: "PL-WCB-125-00", qty: 5292 },
             { sku: "PL-WCB-115-00", qty: 6804 }, { sku: "PB-WCB-221-00", qty: 34398 } ] },
];

// ── Open PO (Wana Rebrand.xlsx · Shipments right block) ─────────────────────
const PO_LINES = [
  { sku: "PL-WCB-405-00", poQty: 17920, adjQty: 0 }, { sku: "PL-WCB-110-00", poQty: 46080, adjQty: 0 },
  { sku: "PL-WCB-460-00", poQty: 30720, adjQty: 0 }, { sku: "PL-WCB-120-00", poQty: 46080, adjQty: 0 },
  { sku: "PL-WCB-480-00", poQty: 30720, adjQty: 0 }, { sku: "PL-WCB-485-00", poQty: 30720, adjQty: 0 },
  { sku: "PL-WCB-415-00", poQty: 15360, adjQty: 0 }, { sku: "PL-WCB-475-00", poQty: 17920, adjQty: 0 },
  { sku: "PL-WCB-430-00", poQty: 15360, adjQty: 0 }, { sku: "PL-WCB-425-00", poQty: 15360, adjQty: 0 },
  { sku: "PL-WCB-440-00", poQty: 15360, adjQty: 0 }, { sku: "PL-WCB-435-00", poQty: 15360, adjQty: 0 },
  { sku: "PL-WCB-410-00", poQty: 15360, adjQty: 0 }, { sku: "PL-WCB-115-00", poQty: 15360, adjQty: 0 },
  { sku: "PL-WCB-125-00", poQty: 15360, adjQty: 0 }, { sku: "PL-WCB-465-00", poQty: 19840, adjQty: 0 },
  { sku: "PL-WCB-420-00", poQty: 15360, adjQty: 0 }, { sku: "PL-WCB-470-00", poQty: 15360, adjQty: 0 },
  { sku: "PB-WCB-221-00", poQty: 122880, adjQty: 0 }, { sku: "PB-WCB-002-00", poQty: 270720, adjQty: 0 },
];

// ── Targets (Wana Cube Launch · Target Inventory: ROP 5.5×, Max 8.5×) ───────
const TARGETS = {
  ropMonths: 5.5, maxMonths: 8.5,
  rows: [
    { sku: "PL-WCB-110-00", monthly: 132345, increment: 403200 },
    { sku: "PL-WCB-115-00", monthly: 28557,  increment: 100800 },
    { sku: "PL-WCB-120-00", monthly: 82514,  increment: 282240 },
    { sku: "PL-WCB-105-00", monthly: 19578,  increment: 80640 },
    { sku: "PL-WCB-125-00", monthly: 27947,  increment: 120960 },
    { sku: "PL-WCB-475-00", monthly: 51346,  increment: 161280 },
    { sku: "PL-WCB-460-00", monthly: 55290,  increment: 201600 },
    { sku: "PL-WCB-465-00", monthly: 62069,  increment: 201600 },
    { sku: "PL-WCB-470-00", monthly: 45646,  increment: 161280 },
    { sku: "PL-WCB-480-00", monthly: 46813,  increment: 161280 },
    { sku: "PL-WCB-485-00", monthly: 40714,  increment: 161280 },
    { sku: "PL-WCB-435-00", monthly: 25215,  increment: 80640 },
    { sku: "PL-WCB-415-00", monthly: 49509,  increment: 161280 },
    { sku: "PL-WCB-440-00", monthly: 8483,   increment: 40320 },
    { sku: "PL-WCB-425-00", monthly: 25502,  increment: 80640 },
    { sku: "PL-WCB-405-00", monthly: 20031,  increment: 60480 },
    { sku: "PL-WCB-430-00", monthly: 16250,  increment: 60480 },
    { sku: "PL-WCB-420-00", monthly: 60108,  increment: 201600 },
    { sku: "PL-WCB-410-00", monthly: 13130,  increment: 40320 },
    { sku: "PL-WCB-490-00", monthly: 64999,  increment: 201600 },
    { sku: "PB-WCB-002-00", monthly: 585105, increment: 1774080 },
    { sku: "PB-WCB-221-00", monthly: 290941, increment: 887040 },
  ],
};

// ── Flavor milestones, Wana-facing (NJ - Current Arrival Dates) ─────────────
const MILESTONES = [
  { market: "New Jersey", sku: "PL-WCB-120-00", expectedArrival: "Shipped 6/10 — arrives 6/16", kitchenDate: "2026-05-25" },
  { market: "New Jersey", sku: "PL-WCB-110-00", expectedArrival: "Shipped 6/10 — arrives 6/16", kitchenDate: "2026-05-25" },
  { market: "New Jersey", sku: "PL-WCB-125-00", expectedArrival: "Shipped 6/10 — arrives 6/18", kitchenDate: "2026-06-01" },
  { market: "New Jersey", sku: "PL-WCB-115-00", expectedArrival: "Shipped 6/10 — arrives 6/18", kitchenDate: "2026-06-08" },
  { market: "New Jersey", sku: "PL-WCB-485-00", expectedArrival: "Arrive by 6/30", kitchenDate: "2026-06-08" },
  { market: "New Jersey", sku: "PL-WCB-480-00", expectedArrival: "Arrive 7/8", kitchenDate: "2026-06-29" },
  { market: "New Jersey", sku: "PL-WCB-460-00", expectedArrival: "Arrive 7/8", kitchenDate: "2026-07-06" },
  { market: "New Jersey", sku: "PL-WCB-465-00", expectedArrival: "Arrive 7/8", kitchenDate: "2026-07-06" },
  { market: "New Jersey", sku: "PL-WCB-415-00", expectedArrival: "Arrive 7/8", kitchenDate: "2026-07-13" },
  { market: "New Jersey", sku: "PL-WCB-430-00", expectedArrival: "Arrive 7/13", kitchenDate: "2026-07-13" },
  { market: "New Jersey", sku: "PL-WCB-475-00", expectedArrival: "Arrive by 7/20", kitchenDate: "2026-07-13" },
  { market: "New Jersey", sku: "PL-WCB-470-00", expectedArrival: "Arrive 7/8", kitchenDate: "2026-07-20" },
  { market: "New Jersey", sku: "PL-WCB-405-00", expectedArrival: "Arrive 7/8", kitchenDate: "2026-07-27" },
  { market: "New Jersey", sku: "PL-WCB-420-00", expectedArrival: "TBD not before 7/11", kitchenDate: "2026-07-27" },
  { market: "New Jersey", sku: "PL-WCB-410-00", expectedArrival: "Arrive 7/8", kitchenDate: "2026-08-03" },
  { market: "New Jersey", sku: "PL-WCB-435-00", expectedArrival: "", kitchenDate: "2026-08-17" },
  { market: "New Jersey", sku: "PL-WCB-425-00", expectedArrival: "", kitchenDate: "2026-08-17" },
  { market: "New Jersey", sku: "PL-WCB-440-00", expectedArrival: "", kitchenDate: "2026-08-17" },
];

// ── validate ────────────────────────────────────────────────────────────────
const problems = [];
const checkSku = (s, where) => { if (!KNOWN_SKUS.includes(s)) problems.push(`Unknown SKU ${s} in ${where}`); };
INBOUND.forEach((sh) => sh.lines.forEach((l) => checkSku(l.sku, `inbound ${sh.ref}`)));
OUTBOUND.forEach((sh) => sh.lines.forEach((l) => checkSku(l.sku, `outbound ${sh.market}`)));
PO_LINES.forEach((p) => checkSku(p.sku, "poLines"));
TARGETS.rows.forEach((t) => checkSku(t.sku, "targets"));
MILESTONES.forEach((m) => checkSku(m.sku, "milestones"));
const dupPo = PO_LINES.map((p) => p.sku).filter((s, i, a) => a.indexOf(s) !== i);
if (dupPo.length) problems.push(`Duplicate PO skus: ${dupPo.join(", ")}`);

const data = { inbound: INBOUND, outbound: OUTBOUND, poLines: PO_LINES, adjustments: [], targets: TARGETS, milestones: MILESTONES };

const sum = (ls) => ls.reduce((a, l) => a + l.qty, 0);
const live = process.argv.includes("--live");

console.log("── seed-actuals " + (live ? "(LIVE)" : "(dry run)") + " ──");
console.log(`inbound: ${INBOUND.length} shipments, ${INBOUND.reduce((a, s) => a + sum(s.lines), 0).toLocaleString()} units (${INBOUND.filter((s) => s.received).length} received)`);
console.log(`outbound: ${OUTBOUND.length} shipments, ${OUTBOUND.reduce((a, s) => a + sum(s.lines), 0).toLocaleString()} units`);
console.log(`poLines: ${PO_LINES.length} · targets: ${TARGETS.rows.length} rows (ROP ${TARGETS.ropMonths}×, Max ${TARGETS.maxMonths}×) · milestones: ${MILESTONES.length}`);
if (problems.length) { console.error("VALIDATION PROBLEMS:"); problems.forEach((p) => console.error(" - " + p)); process.exit(1); }
console.log("validation: OK");

const res = await fetch(ROW_URL, { headers: HEADERS });
if (!res.ok) { console.error(`Cannot read actuals row: ${res.status} ${await res.text()}`); process.exit(1); }
const rows = await res.json();
if (!rows.length) { console.error("actuals row id=1 does not exist — run the DDL first."); process.exit(1); }
const cur = rows[0].data || {};
console.log(`current row: inbound ${cur.inbound?.length ?? 0} · outbound ${cur.outbound?.length ?? 0} · poLines ${cur.poLines?.length ?? 0} · adjustments ${cur.adjustments?.length ?? 0} · targets ${cur.targets?.rows?.length ?? 0} · milestones ${cur.milestones?.length ?? 0}`);
if ((cur.adjustments?.length ?? 0) > 0) console.warn("WARNING: existing adjustments would be wiped by this seed.");

if (!live) { console.log("\nDry run only — re-run with --live to write."); process.exit(0); }

const patch = await fetch(ROW_URL, { method: "PATCH", headers: { ...HEADERS, Prefer: "return=minimal" },
  body: JSON.stringify({ data, updated_at: new Date().toISOString() }) });
if (!patch.ok) { console.error(`PATCH failed: ${patch.status} ${await patch.text()}`); process.exit(1); }
console.log("✓ actuals row seeded.");
