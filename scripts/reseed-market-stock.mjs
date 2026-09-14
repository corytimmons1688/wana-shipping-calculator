// reseed-market-stock.mjs — rebuild actuals.marketStock from NetSuite.
//
// marketStock is what a market physically holds, per flavour, split lid/base.
// It was seeded once by hand from a pivot (30 Jul 2026) and nothing has
// updated it since, so the planner has been sizing runs against a position two
// months out of date. This rebuilds it from the shipment_log snapshot the
// NetSuite sync writes, which is the same source the shipping schedule
// reconciles against — so the plan and the reconciliation finally agree on
// what a market has.
//
// Cumulative received is the right figure, not "unsold stock on hand".
// applySchedule nets the completed log back off it (heldNet) precisely because
// a landed shipment appears in BOTH places; feeding it a post-consumption
// number would subtract the same truck twice. The raw figure also drives
// bareLid — lids at a market with no base under them — which is what decides
// when a base run can ship early. That only works on the true physical count.
//
//   node scripts/reseed-market-stock.mjs          # dry run, prints the diff
//   node scripts/reseed-market-stock.mjs --live   # writes, after a backup

import { mkdirSync, writeFileSync } from "node:fs";
import { MASTER_SKUS } from "../src/data/skuMaster.js";
import { flavourKey } from "../src/utils/inventory.js";

const SB = "https://fxdyiurjioesdmedmgzu.supabase.co";
const K = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4ZHlpdXJqaW9lc2RtZWRtZ3p1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzIzOTYsImV4cCI6MjA4ODMwODM5Nn0.5ueK5iXQ35oThb02ClX3iErPwYR4tPih9GtBAmhDQYk";
const H = { "Content-Type": "application/json", apikey: K, Authorization: "Bearer " + K };

const MARKET = { NJ: "New Jersey", NY: "New York", CO: "Colorado" };
const live = process.argv.includes("--live");
const fm = (n) => Number(n || 0).toLocaleString();

// flavour name → lid SKU, through the same normaliser the rest of the app uses
// (it strips ratios, state prefixes and the known misspellings in NetSuite's
// item names — "Balance Berry Guave", "Rasberry").
const BY_FLAVOUR = {};
for (const m of MASTER_SKUS) BY_FLAVOUR[flavourKey(m.name)] = m.sku;

// Assorted is the exception. The lid is one SKU, but NetSuite ships the bases
// under whatever went in the box — Hybrid, Indica, Sativa for the Classic
// assortment, and the individual blends for High Dose. No flavour lookup can
// join those back up, so the label SKU does it: -1941- is Classic (Med & Rec),
// -2040-HD is High Dose. Matching on the label rather than the display name
// keeps this working when someone renames "Berry Patch Assorted".
const ASSORTED = [
  [/-2040-HD/i, "PL-WCB-HD-01"],
  [/-1941-(?:HYB|IND|SAT)\b/i, "PL-WCB-490-00"],
];
const assortedSku = (sourceSku) => {
  for (const [re, sku] of ASSORTED) if (re.test(String(sourceSku || ""))) return sku;
  return null;
};

const [logRow] = await (await fetch(`${SB}/rest/v1/shipment_log?id=eq.1&select=data,updated_at`, { headers: H })).json();
const snap = logRow.data;
console.log(`NetSuite snapshot ${logRow.updated_at} · ${snap.shipments.length} shipments\n`);

const next = {}, unmapped = {};
for (const s of snap.shipments) {
  const market = MARKET[s.market];
  if (!market) continue;                       // markets not yet on cubes
  for (const l of s.lines || []) {
    const kind = l.component_type;
    if (kind !== "LID" && kind !== "BASE") continue;
    const qty = Number(l.quantity_shipped) || 0;
    if (!qty) continue;
    // A lid line names its own SKU. A base line ships as the generic body, so
    // its flavour comes from the label that went on with it.
    const sku = kind === "LID" ? l.sku
      : (assortedSku(l.source_sku)
         || BY_FLAVOUR[flavourKey(String(l.flavor || "").replace(/\s*-\s*BASE$/i, ""))]);
    if (!sku) { unmapped[`${s.market} ${l.flavor}`] = (unmapped[`${s.market} ${l.flavor}`] || 0) + qty; continue; }
    const mk = (next[market] = next[market] || {});
    const row = (mk[sku] = mk[sku] || { lid: 0, base: 0 });
    row[kind === "LID" ? "lid" : "base"] += qty;
  }
}

if (Object.keys(unmapped).length) {
  console.log("⚠ could not attribute to a flavour — NOT counted:");
  for (const [k, v] of Object.entries(unmapped)) console.log(`   ${k} — ${fm(v)}`);
  console.log();
}

const [actRow] = await (await fetch(`${SB}/rest/v1/actuals?id=eq.1&select=data`, { headers: H })).json();
const prev = actRow.data.marketStock || {};

for (const market of Object.keys(next).sort()) {
  const was = prev[market] || {}, now = next[market];
  const skus = [...new Set([...Object.keys(was), ...Object.keys(now)])].sort();
  const name = Object.fromEntries(MASTER_SKUS.map((m) => [m.sku, m.name]));
  console.log(`── ${market} ──`);
  console.log(`${"flavour".padEnd(26)}${"lid was".padStart(10)}${"→ lid".padStart(10)}${"base was".padStart(11)}${"→ base".padStart(10)}`);
  let wl = 0, wb = 0, nl = 0, nb = 0;
  for (const sku of skus) {
    const a = was[sku] || { lid: 0, base: 0 }, b = now[sku] || { lid: 0, base: 0 };
    wl += a.lid || 0; wb += a.base || 0; nl += b.lid || 0; nb += b.base || 0;
    const moved = (a.lid || 0) !== (b.lid || 0) || (a.base || 0) !== (b.base || 0);
    console.log(`${(name[sku] || sku).slice(0, 25).padEnd(26)}${fm(a.lid).padStart(10)}${fm(b.lid).padStart(10)}${fm(a.base).padStart(11)}${fm(b.base).padStart(10)}${moved ? "  *" : ""}`);
  }
  console.log(`${"TOTAL".padEnd(26)}${fm(wl).padStart(10)}${fm(nl).padStart(10)}${fm(wb).padStart(11)}${fm(nb).padStart(10)}`);
  console.log(`   unpaired lids at market: was ${fm(wl - wb)} → now ${fm(nl - nb)}\n`);
}

// A market with a record but no NetSuite shipments would be silently wiped by
// a wholesale replace. That should never happen with the markets on cubes
// today, so say so loudly rather than discover it later in a plan.
const dropped = Object.keys(prev).filter((m) => !next[m]);
if (dropped.length) {
  console.log(`✗ refusing to write — these markets have a stock record but no NetSuite shipments: ${dropped.join(", ")}`);
  console.log("  Add them to MARKET, or remove their record by hand if they are genuinely finished.");
  process.exit(1);
}

if (!live) { console.log("dry run — nothing written. Re-run with --live to apply."); process.exit(0); }

mkdirSync("scripts/backups", { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
writeFileSync(`scripts/backups/actuals-${stamp}-pre-marketstock-reseed.json`, JSON.stringify(actRow, null, 1));
console.log(`backup → scripts/backups/actuals-${stamp}-pre-marketstock-reseed.json`);

actRow.data.marketStock = next;
const r = await fetch(`${SB}/rest/v1/actuals?id=eq.1`, {
  method: "PATCH", headers: { ...H, Prefer: "return=minimal" },
  body: JSON.stringify({ data: actRow.data }),
});
console.log(r.ok ? "✓ marketStock written" : `✗ ${r.status}: ${(await r.text()).slice(0, 300)}`);
