// update-ny-forecast.mjs — replaces New York's skuDetail with the weekly plan
// from "NY Wana Rebrand Unit Needs 3.31.26 (2).xlsx" (extracted to
// scripts/ny-forecast.json by the companion extractor). Converts NY from
// monthly to weekly detail (Jun 1 – Dec 21, Acreage + Urban Xtracts rows) and
// syncs the stored monthly demand to the rollup for DB self-consistency.
//
//   node scripts/update-ny-forecast.mjs          → dry run (backs up + prints)
//   node scripts/update-ny-forecast.mjs --live   → PATCH

import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

const SUPABASE_URL = "https://fxdyiurjioesdmedmgzu.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4ZHlpdXJqaW9lc2RtZWRtZ3p1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzIzOTYsImV4cCI6MjA4ODMwODM5Nn0.5ueK5iXQ35oThb02ClX3iErPwYR4tPih9GtBAmhDQYk";
const HEADERS = { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };
const URL_ = `${SUPABASE_URL}/rest/v1/scenarios?id=eq.1`;

const live = process.argv.includes("--live");
const det = JSON.parse(readFileSync(new URL("./ny-forecast.json", import.meta.url), "utf8"));
det.skus.forEach((s) => { s.name = s.name.replace(" (Urban)", ""); });

const monthly = new Array(12).fill(0);
det.skus.forEach((s) => s.weekly.forEach((v, wi) => { monthly[Number(det.weeks[wi].split("-")[1]) - 1] += v; }));
const total = monthly.reduce((a, b) => a + b, 0);

console.log(`── update-ny-forecast ${live ? "(LIVE)" : "(dry run)"} ──`);
console.log(`weekly detail: ${det.skus.length} SKUs × ${det.weeks.length} weeks (${det.weeks[0]} → ${det.weeks[det.weeks.length - 1]})`);
console.log(`monthly rollup: Jul ${monthly[6].toLocaleString()} · Aug ${monthly[7].toLocaleString()} · Sep ${monthly[8].toLocaleString()} · Oct ${monthly[9].toLocaleString()} · Nov ${monthly[10].toLocaleString()} · Dec ${monthly[11].toLocaleString()} — total ${total.toLocaleString()}`);

const res = await fetch(URL_, { headers: HEADERS });
if (!res.ok) { console.error(`fetch failed: ${res.status}`); process.exit(1); }
const row = (await res.json())[0];
if (!row) { console.error("scenarios row missing"); process.exit(1); }

const ts = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync(new URL("./backups/", import.meta.url), { recursive: true });
writeFileSync(new URL(`./backups/scenarios-${ts}.json`, import.meta.url), JSON.stringify(row, null, 1));
console.log(`backup written: scripts/backups/scenarios-${ts}.json`);

const ny = row.data[0] && row.data[0].markets && row.data[0].markets.find((m) => m.name === "New York");
if (!ny) { console.error("New York market not found"); process.exit(1); }
const oldAnnual = (ny.demand || []).reduce((a, b) => a + b, 0);
const oldFmt = ny.skuDetail && ny.skuDetail.weeks ? "weekly" : "monthly";
console.log(`NY before: ${oldFmt} skuDetail, ${ny.skuDetail ? ny.skuDetail.skus.length : 0} SKUs, demand annual ${Math.round(oldAnnual).toLocaleString()} → after: ${total.toLocaleString()} (goLive stays ${ny.goLive})`);

ny.skuDetail = { weeks: det.weeks, skus: det.skus };
ny.demand = monthly;

if (!live) { console.log("\nDry run only — re-run with --live to write."); process.exit(0); }

const patch = await fetch(URL_, { method: "PATCH", headers: { ...HEADERS, Prefer: "return=minimal" },
  body: JSON.stringify({ data: row.data, updated_at: new Date().toISOString() }) });
if (!patch.ok) { console.error(`PATCH failed: ${patch.status} ${await patch.text()}`); process.exit(1); }
console.log("✓ New York weekly forecast applied.");
