// convert-monthly-states-to-weekly.mjs — convert every monthly-format detail
// market (the 11 expansion states) to weekly-format skuDetail so ALL active
// weeks are editable in the weekly Market Demand / Item Forecast grids.
//
// Each SKU's monthly[mo] is placed in the FIRST Monday of that month (matching
// what the weekly grid already displays), so monthly rollups, Annual, and
// GLD are preserved exactly. Weeks span Jan 5 – Dec 28 2026 (Jan/Feb Mondays
// are off the display grid but keep pre-launch demand in the Annual rollup).
// Weekly-format markets (NJ/NY/CO/MA) are untouched.
//
//   node scripts/convert-monthly-states-to-weekly.mjs          → dry run
//   node scripts/convert-monthly-states-to-weekly.mjs --live   → PATCH

import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = "https://fxdyiurjioesdmedmgzu.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4ZHlpdXJqaW9lc2RtZWRtZ3p1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzIzOTYsImV4cCI6MjA4ODMwODM5Nn0.5ueK5iXQ35oThb02ClX3iErPwYR4tPih9GtBAmhDQYk";
const HEADERS = { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };
const URL_ = `${SUPABASE_URL}/rest/v1/scenarios?id=eq.1`;

// Mondays: Jan 5 2026 through Dec 28 2026 (52 Mondays; Jan 5 is a Monday).
const WEEKS = [];
{
  const d = new Date(2026, 0, 5);
  while (d.getFullYear() === 2026) {
    const p = (n) => String(n).padStart(2, "0");
    WEEKS.push(`2026-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
    d.setDate(d.getDate() + 7);
  }
}
// first week index of each month
const FIRST = {};
WEEKS.forEach((w, i) => { const mo = Number(w.split("-")[1]) - 1; if (FIRST[mo] === undefined) FIRST[mo] = i; });

const live = process.argv.includes("--live");
const res = await fetch(URL_, { headers: HEADERS });
if (!res.ok) { console.error(`fetch failed ${res.status}`); process.exit(1); }
const row = (await res.json())[0];
const ts = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync(new URL("./backups/", import.meta.url), { recursive: true });
writeFileSync(new URL(`./backups/scenarios-${ts}.json`, import.meta.url), JSON.stringify(row, null, 1));

console.log(`── convert-monthly-states-to-weekly ${live ? "(LIVE)" : "(dry run)"} — ${WEEKS.length} week grid ──`);
let converted = 0, failures = 0;
for (const sc of row.data) {
  for (const mk of sc.markets || []) {
    const det = mk.skuDetail;
    if (!det || !det.skus || !det.skus.length || det.weeks) continue; // aggregate or already weekly
    const beforeMonthly = new Array(12).fill(0);
    det.skus.forEach((s) => (s.monthly || []).forEach((v, m) => { beforeMonthly[m] += Number(v) || 0; }));

    det.weeks = [...WEEKS];
    det.skus = det.skus.map((s) => {
      const weekly = new Array(WEEKS.length).fill(0);
      (s.monthly || []).forEach((v, mo) => { const n = Number(v) || 0; if (n > 0 && FIRST[mo] !== undefined) weekly[FIRST[mo]] += n; });
      const startWk = weekly.findIndex((v) => v > 0);
      return { cat: s.cat, name: s.name, sku: s.sku, startWk: startWk < 0 ? 0 : startWk, weekly };
    });

    // verify: per-month totals preserved
    const afterMonthly = new Array(12).fill(0);
    det.skus.forEach((s) => s.weekly.forEach((v, wi) => { afterMonthly[Number(det.weeks[wi].split("-")[1]) - 1] += Number(v) || 0; }));
    const ok = beforeMonthly.every((v, m) => Math.round(v) === Math.round(afterMonthly[m]));
    if (!ok) { console.error(`✗ ${sc.name} / ${mk.name}: monthly totals mismatch — ABORT`); failures++; }
    const annual = afterMonthly.reduce((a, b) => a + b, 0);
    console.log(`${mk.name}: ${det.skus.length} SKUs → weekly (annual ${Math.round(annual).toLocaleString()} preserved: ${ok ? "✓" : "✗"})`);
    converted++;
  }
}
console.log(`\nconverted ${converted} markets · backup scripts/backups/scenarios-${ts}.json`);
if (failures) { console.error("verification failures — nothing written"); process.exit(1); }
if (!converted) { console.log("nothing to convert — no write."); process.exit(0); }

if (!live) { console.log("\nDry run only — re-run with --live to write."); process.exit(0); }
const patch = await fetch(URL_, { method: "PATCH", headers: { ...HEADERS, Prefer: "return=minimal" }, body: JSON.stringify({ data: row.data, updated_at: new Date().toISOString() }) });
if (!patch.ok) { console.error(`PATCH failed ${patch.status} ${await patch.text()}`); process.exit(1); }
console.log("✓ monthly-format states converted to weekly.");
