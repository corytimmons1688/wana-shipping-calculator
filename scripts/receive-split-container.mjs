// receive-split-container.mjs — mark a factory shipment received when it was
// booked into NetSuite across several item receipts.
//
// matchReceipts only auto-receives a container whose every line appears on ONE
// receipt at exactly that quantity, and that strictness is deliberate: a wrong
// auto-receive inflates on-hand and corrupts the forecast downstream of it. But
// a container that lands short and is corrected later is booked twice, so it
// can never satisfy that rule and sits in "partly matched" forever even once
// every unit is in.
//
// This closes those by hand, and only on proof: the named receipts must sum to
// the manifest line for line, with nothing left over on any of them. Anything
// less and it refuses — the point is to be as strict as the matcher, not to
// provide a way around it.
//
//   node scripts/receive-split-container.mjs CP-36=IR5467,IR5469,IR5471
//   node scripts/receive-split-container.mjs CP-36=... --live

import { mkdirSync, writeFileSync } from "node:fs";

const SB = "https://fxdyiurjioesdmedmgzu.supabase.co";
const K = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4ZHlpdXJqaW9lc2RtZWRtZ3p1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzIzOTYsImV4cCI6MjA4ODMwODM5Nn0.5ueK5iXQ35oThb02ClX3iErPwYR4tPih9GtBAmhDQYk";
const H = { "Content-Type": "application/json", apikey: K, Authorization: "Bearer " + K };
const fm = (n) => Number(n || 0).toLocaleString();

const live = process.argv.includes("--live");
const specs = process.argv.slice(2).filter((a) => a.includes("=")).map((a) => {
  const [ref, refs] = a.split("=");
  return { ref, irs: refs.split(",").map((s) => s.trim()).filter(Boolean) };
});
if (!specs.length) { console.log("usage: node scripts/receive-split-container.mjs CP-36=IR5467,IR5469 [--live]"); process.exit(1); }

const [log] = await (await fetch(`${SB}/rest/v1/shipment_log?id=eq.1&select=data`, { headers: H })).json();
const [actRow] = await (await fetch(`${SB}/rest/v1/actuals?id=eq.1&select=data`, { headers: H })).json();

const irs = {};
for (const r of log.data.receipts || []) {
  const g = (irs[r.ref] = irs[r.ref] || { ref: r.ref, date: r.date, lines: {} });
  g.lines[r.sku] = (g.lines[r.sku] || 0) + (Number(r.qty) || 0);
}

let refuse = false;
const apply = [];
for (const spec of specs) {
  const sh = (actRow.data.inbound || []).find((s) => s.ref === spec.ref);
  if (!sh) { console.log(`✗ ${spec.ref}: no such inbound shipment`); refuse = true; continue; }
  if (sh.received) { console.log(`· ${spec.ref}: already received (${sh.receivedRef || "—"})`); continue; }

  const manifest = {};
  for (const l of sh.lines || []) if (l && l.sku) manifest[l.sku] = (manifest[l.sku] || 0) + (Number(l.qty) || 0);

  const got = {};
  let missingIr = false;
  for (const ref of spec.irs) {
    if (!irs[ref]) { console.log(`✗ ${spec.ref}: receipt ${ref} is not in the NetSuite feed`); missingIr = true; continue; }
    for (const [sku, q] of Object.entries(irs[ref].lines)) got[sku] = (got[sku] || 0) + q;
  }
  if (missingIr) { refuse = true; continue; }

  console.log(`── ${spec.ref}  vs  ${spec.irs.join(" + ")} ──`);
  console.log(`${"sku".padEnd(16)}${"manifest".padStart(10)}${"receipts".padStart(10)}`);
  const skus = [...new Set([...Object.keys(manifest), ...Object.keys(got)])].sort();
  let ok = true;
  for (const sku of skus) {
    const m = manifest[sku] || 0, g = got[sku] || 0;
    if (m !== g) ok = false;
    console.log(`${sku.padEnd(16)}${fm(m).padStart(10)}${fm(g).padStart(10)}${m === g ? "" : m === 0 ? "   ✗ on the receipts but not on this container" : g === 0 ? "   ✗ not received" : "   ✗ quantity differs"}`);
  }
  console.log(`${"".padEnd(16)}${fm(Object.values(manifest).reduce((a, b) => a + b, 0)).padStart(10)}${fm(Object.values(got).reduce((a, b) => a + b, 0)).padStart(10)}`);
  if (!ok) { console.log(`✗ ${spec.ref}: refusing — the receipts do not reconcile to the manifest exactly\n`); refuse = true; continue; }
  console.log(`✓ ${spec.ref}: every line reconciles, nothing left over\n`);
  apply.push({ sh, spec, date: irs[spec.irs[spec.irs.length - 1]].date });
}

if (refuse) { console.log("nothing written — fix the mismatches above first."); process.exit(1); }
if (!apply.length) { console.log("nothing to do."); process.exit(0); }
if (!live) { console.log("dry run — re-run with --live to apply."); process.exit(0); }

mkdirSync("scripts/backups", { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
writeFileSync(`scripts/backups/actuals-${stamp}-pre-split-receive.json`, JSON.stringify(actRow, null, 1));
console.log(`backup → scripts/backups/actuals-${stamp}-pre-split-receive.json`);

for (const a of apply) {
  a.sh.received = true;
  a.sh.receivedRef = a.spec.irs[0];      // the anchor, for anything reading one ref
  a.sh.receivedRefs = a.spec.irs;        // every receipt, so all of them are claimed
  a.sh.receivedOn = a.date;
  delete a.sh.autoReceived;              // reconciled deliberately, not by the matcher
}
const r = await fetch(`${SB}/rest/v1/actuals?id=eq.1`, {
  method: "PATCH", headers: { ...H, Prefer: "return=minimal" },
  body: JSON.stringify({ data: actRow.data }),
});
console.log(r.ok ? `✓ marked received: ${apply.map((a) => a.spec.ref).join(", ")}` : `✗ ${r.status}: ${(await r.text()).slice(0, 300)}`);
