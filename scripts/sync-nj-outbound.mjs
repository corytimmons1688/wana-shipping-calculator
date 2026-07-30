// sync-nj-outbound.mjs — replace the single estimated New Jersey outbound row
// with the six actual NetSuite Item Fulfillments to Acreage Holdings NJ (id 1158).
//
// The app only carried one manual 68,796-unit row dated 6/15, so every view that
// nets "demand − already shipped" (Apply Schedule, on-hand at Calyx) was wrong by
// ~146k units. Quantities below are the NET of each fulfillment's inventory-detail
// lines, verified against NetSuite (215,258 total).
//
//   node scripts/sync-nj-outbound.mjs          → dry run
//   node scripts/sync-nj-outbound.mjs --live   → PATCH

import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = "https://fxdyiurjioesdmedmgzu.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4ZHlpdXJqaW9lc2RtZWRtZ3p1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzIzOTYsImV4cCI6MjA4ODMwODM5Nn0.5ueK5iXQ35oThb02ClX3iErPwYR4tPih9GtBAmhDQYk";
const HEADERS = { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };
const URL_ = `${SUPABASE_URL}/rest/v1/actuals?id=eq.1`;

const IFS = [
  { ref: "IF18572", date: "2026-06-17", lines: [["PB-WCB-221-00",34398],["PL-WCB-110-00",13104],["PL-WCB-115-00",7776],["PL-WCB-120-00",10368],["PL-WCB-125-00",6480]] },
  { ref: "IF18725", date: "2026-07-06", lines: [["PB-WCB-002-00",10206],["PB-WCB-221-00",6804],["PL-WCB-125-00",7776],["PL-WCB-485-00",5184]] },
  { ref: "IF18789", date: "2026-07-14", lines: [["PB-WCB-221-00",10206],["PL-WCB-110-00",1242],["PL-WCB-120-00",9936],["PL-WCB-405-00",3726],["PL-WCB-410-00",2484],["PL-WCB-415-00",4968],["PL-WCB-420-00",4968],["PL-WCB-460-00",8694],["PL-WCB-465-00",7452],["PL-WCB-470-00",3726],["PL-WCB-480-00",11178],["PL-WCB-485-00",7830]] },
  { ref: "IF18813", date: "2026-07-16", lines: [["PB-WCB-002-00",11718],["PB-WCB-221-00",12474]] },
  { ref: "IF18838", date: "2026-07-20", lines: [["PL-WCB-110-00",1242]] },
  { ref: "IF18938", date: "2026-07-29", lines: [["PL-WCB-110-00",11318]] },
];

const live = process.argv.includes("--live");
const res = await fetch(URL_, { headers: HEADERS });
if (!res.ok) { console.error(`fetch failed ${res.status}`); process.exit(1); }
const row = (await res.json())[0];
const ts = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync(new URL("./backups/", import.meta.url), { recursive: true });
writeFileSync(new URL(`./backups/actuals-${ts}.json`, import.meta.url), JSON.stringify(row, null, 1));

const sum = (ls) => ls.reduce((a, l) => a + (Number(l.qty ?? l[1]) || 0), 0);
const before = (row.data.outbound || []).filter((o) => o.market === "New Jersey");
console.log(`── sync-nj-outbound ${live ? "(LIVE)" : "(dry run)"} — backup saved ──`);
console.log(`existing NJ rows: ${before.length} · ${before.reduce((a, o) => a + sum(o.lines || []), 0).toLocaleString()} u`);
for (const o of before) console.log(`   remove: ${o.dateShipped || "—"}  ${sum(o.lines || []).toLocaleString()} u  (${(o.lines || []).length} lines)`);

// keep any non-NJ rows untouched
row.data.outbound = (row.data.outbound || []).filter((o) => o.market !== "New Jersey");
let seed = Date.now();
for (const f of IFS) {
  row.data.outbound.push({ id: seed++ + Math.random(), market: "New Jersey", dateShipped: f.date,
    arriveBy: "", tracking: f.ref, delivered: true, lines: f.lines.map(([sku, qty]) => ({ sku, qty })) });
  console.log(`   add: ${f.ref}  ${f.date}  ${sum(f.lines).toLocaleString()} u  (${f.lines.length} lines)`);
}
const total = row.data.outbound.reduce((a, o) => a + sum(o.lines || []), 0);
console.log(`\noutbound now: ${row.data.outbound.length} rows · ${total.toLocaleString()} u`);

if (!live) { console.log("\nDry run only — re-run with --live to write."); process.exit(0); }
const p = await fetch(URL_, { method: "PATCH", headers: { ...HEADERS, Prefer: "return=minimal" }, body: JSON.stringify({ data: row.data, updated_at: new Date().toISOString() }) });
if (!p.ok) { console.error(`PATCH failed ${p.status} ${await p.text()}`); process.exit(1); }
console.log("✓ NJ outbound synced from NetSuite.");
