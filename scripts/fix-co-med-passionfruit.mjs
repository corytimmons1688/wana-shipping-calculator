// fix-co-med-passionfruit.mjs — Colorado's "(Med) Pineapple Passionfruit"
// was rolled into the Assorted lid (PL-WCB-490-00); it shares the rec
// Passion Pineapple lid, so re-map that one skuDetail entry to PL-WCB-420-00.
// Other genuine Assorted/Med rows stay on 490. Backup + dry-run/live.
//
//   node scripts/fix-co-med-passionfruit.mjs          → dry run
//   node scripts/fix-co-med-passionfruit.mjs --live   → PATCH

import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = "https://fxdyiurjioesdmedmgzu.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4ZHlpdXJqaW9lc2RtZWRtZ3p1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzIzOTYsImV4cCI6MjA4ODMwODM5Nn0.5ueK5iXQ35oThb02ClX3iErPwYR4tPih9GtBAmhDQYk";
const HEADERS = { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };
const URL_ = `${SUPABASE_URL}/rest/v1/scenarios?id=eq.1`;
const TARGET_NAME = "(Med) Pineapple Passionfruit";
const FROM = "PL-WCB-490-00", TO = "PL-WCB-420-00";

const live = process.argv.includes("--live");
const res = await fetch(URL_, { headers: HEADERS });
if (!res.ok) { console.error(`fetch failed ${res.status}`); process.exit(1); }
const row = (await res.json())[0];
const ts = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync(new URL("./backups/", import.meta.url), { recursive: true });
writeFileSync(new URL(`./backups/scenarios-${ts}.json`, import.meta.url), JSON.stringify(row, null, 1));

let fixed = 0;
for (const sc of row.data) {
  const co = (sc.markets || []).find((m) => m.name === "Colorado");
  if (!co || !co.skuDetail || !co.skuDetail.skus) continue;
  for (const s of co.skuDetail.skus) {
    if (s.name === TARGET_NAME && s.sku === FROM) {
      const annual = (s.weekly || []).reduce((a, v) => a + (Number(v) || 0), 0);
      s.sku = TO;
      console.log(`scenario "${sc.name}": "${TARGET_NAME}" ${FROM} → ${TO} (${annual.toLocaleString()} u moved to Passion Pineapple)`);
      fixed++;
    }
  }
}
console.log(`backup: scripts/backups/scenarios-${ts}.json · entries fixed: ${fixed}`);
if (!fixed) { console.error("nothing matched — aborting"); process.exit(1); }

if (!live) { console.log("\nDry run only — re-run with --live to write."); process.exit(0); }
const patch = await fetch(URL_, { method: "PATCH", headers: { ...HEADERS, Prefer: "return=minimal" }, body: JSON.stringify({ data: row.data, updated_at: new Date().toISOString() }) });
if (!patch.ok) { console.error(`PATCH failed ${patch.status} ${await patch.text()}`); process.exit(1); }
console.log("✓ Med Pineapple Passionfruit re-mapped to Passion Pineapple (420).");
