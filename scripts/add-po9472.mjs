// add-po9472.mjs — adds PO9472 (Compax Packaging, 6/12/2026, SO15164) into the
// shared Open PO tracker. poQty per SKU is the cumulative open-PO quantity, so
// each PO9472 line ADDS to the existing balance (creates the line if missing).
// Everything else in the actuals row is preserved. Read-modify-write.
//
//   node scripts/add-po9472.mjs          → dry run
//   node scripts/add-po9472.mjs --live   → PATCH

import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = "https://fxdyiurjioesdmedmgzu.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4ZHlpdXJqaW9lc2RtZWRtZ3p1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzIzOTYsImV4cCI6MjA4ODMwODM5Nn0.5ueK5iXQ35oThb02ClX3iErPwYR4tPih9GtBAmhDQYk";
const HEADERS = { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };
const ROW_URL = `${SUPABASE_URL}/rest/v1/actuals?id=eq.1`;

const PO9472 = [
  { sku: "PB-WCB-221-00", qty: 197316 },
  { sku: "PB-WCB-002-00", qty: 443016 },
  { sku: "PL-WCB-490-00", qty: 151956 },
  { sku: "PL-WCB-435-00", qty: 20412 },
  { sku: "PL-WCB-425-00", qty: 20412 },
  { sku: "PL-WCB-420-00", qty: 32886 },
  { sku: "PL-WCB-410-00", qty: 5670 },
  { sku: "PL-WCB-120-00", qty: 51030 },
  { sku: "PL-WCB-125-00", qty: 20412 },
  { sku: "PL-WCB-110-00", qty: 82782 },
  { sku: "PL-WCB-105-00", qty: 20412 },
  { sku: "PL-WCB-115-00", qty: 26082 },
  { sku: "PL-WCB-475-00", qty: 30618 },
  { sku: "PL-WCB-460-00", qty: 45360 },
  { sku: "PL-WCB-465-00", qty: 51030 },
  { sku: "PL-WCB-470-00", qty: 30618 },
  { sku: "PL-WCB-480-00", qty: 35154 },
  { sku: "PL-WCB-485-00", qty: 26082 },
];

const live = process.argv.includes("--live");
const total = PO9472.reduce((a, l) => a + l.qty, 0);
console.log(`── add-po9472 ${live ? "(LIVE)" : "(dry run)"} — ${PO9472.length} lines, ${total.toLocaleString()} units ──`);

const res = await fetch(ROW_URL, { headers: HEADERS });
if (!res.ok) { console.error(`fetch failed: ${res.status}`); process.exit(1); }
const row = (await res.json())[0];
if (!row) { console.error("actuals row missing"); process.exit(1); }

const ts = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync(new URL("./backups/", import.meta.url), { recursive: true });
writeFileSync(new URL(`./backups/actuals-${ts}.json`, import.meta.url), JSON.stringify(row, null, 1));

const data = row.data;
if (!Array.isArray(data.poLines)) data.poLines = [];
for (const line of PO9472) {
  let p = data.poLines.find((x) => x.sku === line.sku);
  const before = p ? Number(p.poQty) || 0 : 0;
  if (!p) { p = { sku: line.sku, poQty: 0, adjQty: 0 }; data.poLines.push(p); }
  p.poQty = before + line.qty;
  console.log(`${line.sku}: ${before.toLocaleString()} + ${line.qty.toLocaleString()} → ${p.poQty.toLocaleString()}${before === 0 ? "  (new line)" : ""}`);
}

if (!live) { console.log("\nDry run only — re-run with --live to write."); process.exit(0); }

const patch = await fetch(ROW_URL, { method: "PATCH", headers: { ...HEADERS, Prefer: "return=minimal" },
  body: JSON.stringify({ data, updated_at: new Date().toISOString() }) });
if (!patch.ok) { console.error(`PATCH failed: ${patch.status} ${await patch.text()}`); process.exit(1); }
console.log("✓ PO9472 added to Open PO tracker.");
