// set-nj-activefrom.mjs — sets New Jersey's week-precise active start to
// 2026-05-25 (last week of May). Demand dated before this is hidden/excluded
// across the views and Go-Live Demand, overriding the month-level June go-live.
// Read-modify-write with a backup; everything else preserved.
//
//   node scripts/set-nj-activefrom.mjs          → dry run
//   node scripts/set-nj-activefrom.mjs --live   → PATCH

import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = "https://fxdyiurjioesdmedmgzu.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4ZHlpdXJqaW9lc2RtZWRtZ3p1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzIzOTYsImV4cCI6MjA4ODMwODM5Nn0.5ueK5iXQ35oThb02ClX3iErPwYR4tPih9GtBAmhDQYk";
const HEADERS = { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };
const URL_ = `${SUPABASE_URL}/rest/v1/scenarios?id=eq.1`;
const ACTIVE_FROM = "2026-05-25";

const live = process.argv.includes("--live");
const res = await fetch(URL_, { headers: HEADERS });
if (!res.ok) { console.error(`fetch failed: ${res.status}`); process.exit(1); }
const row = (await res.json())[0];
if (!row) { console.error("scenarios row missing"); process.exit(1); }

const ts = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync(new URL("./backups/", import.meta.url), { recursive: true });
writeFileSync(new URL(`./backups/scenarios-${ts}.json`, import.meta.url), JSON.stringify(row, null, 1));

let touched = 0;
for (const sc of row.data) {
  const nj = (sc.markets || []).find((m) => m.name === "New Jersey");
  if (nj) { console.log(`scenario "${sc.name}": NJ goLive=${nj.goLive} activeFrom ${nj.activeFrom || "(none)"} → ${ACTIVE_FROM}`); nj.activeFrom = ACTIVE_FROM; touched++; }
}
console.log(`backup: scripts/backups/scenarios-${ts}.json · scenarios touched: ${touched}`);

if (!live) { console.log("\nDry run only — re-run with --live to write."); process.exit(0); }

const patch = await fetch(URL_, { method: "PATCH", headers: { ...HEADERS, Prefer: "return=minimal" },
  body: JSON.stringify({ data: row.data, updated_at: new Date().toISOString() }) });
if (!patch.ok) { console.error(`PATCH failed: ${patch.status} ${await patch.text()}`); process.exit(1); }
console.log("✓ NJ activeFrom set to 2026-05-25.");
