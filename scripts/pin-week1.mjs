// pin-week1.mjs — pin the agreed week-1 ship schedule (Cory, 30 Jul 2026).
// These four days render verbatim in the Apply Schedule tab; the derived plan
// consumes them out of the requirement and schedules everything else around.
//
//   node scripts/pin-week1.mjs          → dry run
//   node scripts/pin-week1.mjs --live   → PATCH

import { mkdirSync, writeFileSync } from "node:fs";

const URL_ = "https://fxdyiurjioesdmedmgzu.supabase.co/rest/v1/actuals?id=eq.1";
const K = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4ZHlpdXJqaW9lc2RtZWRtZ3p1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzIzOTYsImV4cCI6MjA4ODMwODM5Nn0.5ueK5iXQ35oThb02ClX3iErPwYR4tPih9GtBAmhDQYk";
const H = { "Content-Type": "application/json", apikey: K, Authorization: "Bearer " + K };
const M = "New Jersey";

const PINNED = [
  // Ship Friday 31 Jul
  { date: "2026-07-31", market: M, sku: "PL-WCB-430-00", kind: "BASE", units: 6804 },
  { date: "2026-07-31", market: M, sku: "PL-WCB-415-00", kind: "BASE", units: 3402 },
  { date: "2026-07-31", market: M, sku: "PL-WCB-430-00", kind: "LID",  units: 6804 },
  { date: "2026-07-31", market: M, sku: "PL-WCB-415-00", kind: "LID",  units: 2268 },
  { date: "2026-07-31", market: M, sku: "PL-WCB-110-00", kind: "LID",  units: 6804 },
  { date: "2026-07-31", market: M, sku: "PL-WCB-465-00", kind: "BASE", units: 6426, preApplied: true },
  // Ship Monday 3 Aug
  { date: "2026-08-03", market: M, sku: "PL-WCB-460-00", kind: "BASE", units: 10962 },
  { date: "2026-08-03", market: M, sku: "PL-WCB-460-00", kind: "LID",  units: 2268 },
  // Ship Tuesday 4 Aug
  { date: "2026-08-04", market: M, sku: "PL-WCB-475-00", kind: "BASE", units: 6804 },
  { date: "2026-08-04", market: M, sku: "PL-WCB-480-00", kind: "BASE", units: 11340 },
  { date: "2026-08-04", market: M, sku: "PL-WCB-475-00", kind: "LID",  units: 6804 },
  // Ship Wednesday 5 Aug
  { date: "2026-08-05", market: M, sku: "PL-WCB-405-00", kind: "BASE", units: 3780 },
  { date: "2026-08-05", market: M, sku: "PL-WCB-470-00", kind: "BASE", units: 3780 },
  { date: "2026-08-05", market: M, sku: "PL-WCB-485-00", kind: "BASE", units: 378 },
  { date: "2026-08-05", market: M, sku: "PL-WCB-115-00", kind: "BASE", units: 3402 },
  { date: "2026-08-05", market: M, sku: "PL-WCB-115-00", kind: "LID",  units: 2268 },
];

const live = process.argv.includes("--live");
const row = (await (await fetch(URL_, { headers: H })).json())[0];
mkdirSync("scripts/backups", { recursive: true });
writeFileSync(`scripts/backups/actuals-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, JSON.stringify(row, null, 1));

row.data.applySchedule = row.data.applySchedule || { capacity: 12474, log: [], overrides: {} };
row.data.applySchedule.pinned = PINNED;
row.data.applySchedule.startDate = "2026-07-31";

const byDay = {};
for (const p of PINNED) (byDay[p.date] = byDay[p.date] || []).push(p);
for (const [d, ls] of Object.entries(byDay)) {
  const applied = ls.filter((l) => l.kind === "BASE" && !l.preApplied).reduce((a, l) => a + l.units, 0);
  const ship = ls.reduce((a, l) => a + l.units, 0);
  console.log(`${d}: ${ls.length} lines · apply ${applied.toLocaleString()} · ship ${ship.toLocaleString()}`);
}
if (!live) { console.log("\nDry run — pass --live"); process.exit(0); }
const p = await fetch(URL_, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ data: row.data, updated_at: new Date().toISOString() }) });
console.log("PATCH", p.status, p.ok ? "✓ week 1 pinned" : await p.text());
