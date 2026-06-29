// apply-me-forecast.mjs — set monthly line-item skuDetail for the 11 market-
// expansion states from "Z. ME Master Forecast - 2026 (4).xlsx" (extracted to
// scripts/me-forecast.json). Converts those aggregate-only markets to
// monthly-format skuDetail; leaves NY/MA (curated weekly) and all others
// untouched; Florida not added; Pina Colada + one-off legacy flavors dropped.
// Skipped/added SKUs 445/450/455 must exist in skuMaster (added in code).
//
//   node scripts/apply-me-forecast.mjs          → dry run (backup + diff)
//   node scripts/apply-me-forecast.mjs --live   → PATCH

import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

const SUPABASE_URL = "https://fxdyiurjioesdmedmgzu.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4ZHlpdXJqaW9lc2RtZWRtZ3p1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzIzOTYsImV4cCI6MjA4ODMwODM5Nn0.5ueK5iXQ35oThb02ClX3iErPwYR4tPih9GtBAmhDQYk";
const HEADERS = { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };
const URL_ = `${SUPABASE_URL}/rest/v1/scenarios?id=eq.1`;

const FC = JSON.parse(readFileSync(new URL("./me-forecast.json", import.meta.url), "utf8"));
const live = process.argv.includes("--live");

const res = await fetch(URL_, { headers: HEADERS });
if (!res.ok) { console.error(`fetch failed ${res.status}`); process.exit(1); }
const row = (await res.json())[0];
if (!row) { console.error("scenarios row missing"); process.exit(1); }

const ts = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync(new URL("./backups/", import.meta.url), { recursive: true });
writeFileSync(new URL(`./backups/scenarios-${ts}.json`, import.meta.url), JSON.stringify(row, null, 1));

const sc = row.data[0];
const markets = (sc && sc.markets) || [];
const sum = (skus) => skus.reduce((a, s) => a + s.monthly.reduce((x, y) => x + y, 0), 0);
console.log(`── apply-me-forecast ${live ? "(LIVE)" : "(dry run)"} — scenario "${sc.name}" ──`);
let applied = 0, missing = [];
for (const [state, detail] of Object.entries(FC)) {
  const mk = markets.find((m) => m.name === state);
  if (!mk) { missing.push(state); continue; }
  const oldFmt = mk.skuDetail ? (mk.skuDetail.weeks ? "weekly" : "monthly") : "aggregate";
  const oldAnnual = (mk.demand || []).reduce((a, b) => a + b, 0);
  mk.skuDetail = { skus: detail.skus };
  console.log(`${state}: ${oldFmt} (demand ${Math.round(oldAnnual).toLocaleString()}) → monthly skuDetail, ${detail.skus.length} SKUs, rollup ${sum(detail.skus).toLocaleString()} (goLive ${mk.goLive})`);
  applied++;
}
if (missing.length) console.error(`\n⚠ markets not found (skipped): ${missing.join(", ")}`);
console.log(`\napplied ${applied} states`);

if (!live) { console.log("\nDry run only — re-run with --live to write."); process.exit(0); }
const patch = await fetch(URL_, { method: "PATCH", headers: { ...HEADERS, Prefer: "return=minimal" }, body: JSON.stringify({ data: row.data, updated_at: new Date().toISOString() }) });
if (!patch.ok) { console.error(`PATCH failed ${patch.status} ${await patch.text()}`); process.exit(1); }
console.log("✓ line-item forecasts applied to 11 states.");
