// salesOrderMatch.js — which sales order a planned shipment goes out against.
//
// The floor needs to book each shipment to an order, and a market's SKU is
// rarely covered by a single one: New Jersey runs two open sales orders and
// Colorado three. So this walks the plan in ship-date order and draws each line
// down against the oldest open order first, the way the orders would actually
// be filled. A line bigger than what is left on one order carries both, and a
// line with no order behind it says so rather than naming one at random.
//
// Source is the same NetSuite `shipment_log` row the Market Orders tab reads.

import { MASTER_SKUS } from "../data/skuMaster";
import { isAssorted, ASSORTED_SKU } from "./inventory";

// SuiteQL status codes that mean nothing further will ship on the order.
const CLOSED = new Set(["C", "G", "H"]);

// Bases ship as a generic PB- code, so a base order line names a colour and
// never a flavour. What identifies the flavour is the base label and its
// application fee, which is why a market can run labels on a different order
// from the cubes — New Jersey does exactly that.
//
// Keying base rows on the shared PB- code instead let one line answer for every
// flavour of its colour. New York's SO15298 carries eleven flavours, each as a
// lid line, a WANA-NY-* label line and an application fee at matching
// quantities; Go Go Mango and Mellow Melon appear in none of the three, yet
// both drew a confident "SO15298 · white base" off that order's shared 56,200
// white base line. The screen claimed an order that does not cover them, and
// the same flavour read as ordered on its base row and unordered on its lid.
const labelName = (v) => String(v || "").toLowerCase()
  .replace(/\b\d+:\d+(:\d+)?\b/g, " ")            // potency suffixes — "Serene Yuzu 2:1"
  .replace(/\bbounce back\b/g, " ")
  .replace(/rasberry/g, "raspberry").replace(/guave/g, "guava")
  .replace(/\bbalance\b/g, "balanced")
  // A market brands its sunrise for itself — Arizona Sunrise, Colorado Sunrise,
  // New York Sunrise are one lid.
  .replace(/\b(arizona|colorado|new york|new jersey|illinois|michigan|montana|new mexico|massachusetts|maryland|connecticut|ohio|oklahoma|missouri|mississippi)\b/g, " ")
  .replace(/[^a-z]/g, "");

const MASTER = MASTER_SKUS.map((s) => ({ sku: s.sku, n: labelName(s.name) }));
// Flavours whose label reads nothing like the master name.
// Arizona's high-dose raspberry is labelled "Vibrant Raspberry Limeade" and
// ordered as PL-WCB-445-00 "Robust Raspberry Limeade" — three names, one lid,
// and it must not fall to Relaxed Raspberry, which is a separate Quick flavour
// Arizona also buys, on its own line at the same 4,000 quantity.
const ALIAS = { peach: "PL-WCB-460-00", sunrise: "PL-WCB-465-00",
  vibrantraspberrylimeade: "PL-WCB-445-00", robustraspberrylimeade: "PL-WCB-445-00" };

// A label line → the lid SKU whose flavour it carries, or null when the line is
// not a cube label at all. Markets still on 25D/45D jars run their own label
// scheme entirely; those return null and their base rows say so honestly.
export function baseLabelFlavour(name) {
  const raw = String(name || "");
  // Every assorted variant rides one lid — Berry Patch, Lemonade Stand and
  // Tropical Trio say "Assorted"; Hybrid, Indica and Sativa say "Mixed".
  if (isAssorted(raw) || /\bmixed\b\s*-\s*(hybrid|indica|sativa)/i.test(raw)) return ASSORTED_SKU;
  const tail = raw.split(/\s+-\s+/).pop();
  const n = labelName(tail);
  if (!n) return null;
  if (ALIAS[n]) return ALIAS[n];
  const exact = MASTER.find((m) => m.n === n);
  if (exact) return exact.sku;
  const part = MASTER.find((m) => m.n.length > 4 && (n.includes(m.n) || m.n.includes(n)));
  return part ? part.sku : null;
}

// A cube base label, as opposed to the tamper and blank stock every order runs
// — and as opposed to the 25D and 45D jar labels, which are a different product
// on the same WANA- prefix. "Wana Cube" in the description is what separates
// them: it appears on every label line in Arizona, Colorado, New Jersey and New
// York, and on none in Illinois, Massachusetts, Oklahoma, Mississippi, Missouri
// or urbanXtracts, who are not on cubes. Without that guard the flavour match
// falls through to a substring and Curaleaf's "Wana IL 25D lid label - Mango"
// answers for Go Go Mango, putting a jar order behind a cube shipment.
const isBaseLabel = (r) => /^WANA-/i.test(String(r.sku || ""))
  && !/TAMP|BLANK/i.test(String(r.sku || ""))
  && /wana\s+cube/i.test(String(r.name || ""));

// NetSuite gives order dates as M/D/YYYY. Sort on a comparable form, and push
// anything undated to the back so a missing date never jumps the queue.
const orderRank = (r) => {
  const m = String(r.orderDate || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : "9999-99-99";
};

// Open balance per market + item, oldest order first — plus which orders carry
// that item at all, balance or no balance.
//
// The two are not the same question and a row has to say which one it failed.
// Bases are the case that forces it: every flavour of a colour draws on one
// shared PB- line, so New York can plan 66,150 white base against a single
// 56,200 line and run it dry. The rows past that point are not unordered —
// they are over the quantity ordered, which is a different thing to fix.
function openPools(salesOrders) {
  const pools = {}, onOrder = {}, customers = {};
  for (const r of salesOrders || []) {
    if (CLOSED.has(String(r.status || "").trim().toUpperCase())) continue;
    if (!r.market || !r.sku) continue;
    // Where this line answers on the plan. A lid line speaks for its own SKU; a
    // base label speaks for the flavour it names, and nothing else on the order
    // can say which flavour a base belongs to.
    let k = null;
    if (String(r.sku).startsWith("PL-")) k = `${r.market}|${r.sku}|LID`;
    else if (isBaseLabel(r)) {
      const f = baseLabelFlavour(r.name);
      if (f) k = `${r.market}|${f}|BASE`;
    }
    if (!k) continue;
    (onOrder[k] = onOrder[k] || []).push(r.so);
    if (r.customer) (customers[k] = customers[k] || []).push(r.customer);
    const left = (Number(r.ordered) || 0) - (Number(r.shipped) || 0);
    if (left <= 0) continue;
    (pools[k] = pools[k] || []).push({ so: r.so, custPo: r.custPo, customer: r.customer,
      orderDate: r.orderDate, status: r.status, ordered: Number(r.ordered) || 0, left });
  }
  for (const k of Object.keys(pools))
    pools[k].sort((a, b) => orderRank(a).localeCompare(orderRank(b)) ||
      String(a.so).localeCompare(String(b.so), undefined, { numeric: true }));
  for (const k of Object.keys(onOrder)) onOrder[k] = [...new Set(onOrder[k])].sort();
  for (const k of Object.keys(customers)) customers[k] = [...new Set(customers[k])].sort();
  return { pools, onOrder, customers };
}

// days        the whole plan, every market — allocation must not depend on
//             which market the screen happens to be filtered to
// marketCode  "New Jersey" → "NJ", to meet NetSuite's market codes
// itemSku     a plan line → the SKU that physically ships (bases are a shared
//             PB- code, not the flavour's PL- lid code the line is keyed on)
// isShipped   already confirmed gone in NetSuite, so its units are counted in
//             the order's `shipped` figure and must not be drawn down twice
export function allocateSalesOrders({ days = [], salesOrders = [], marketCode, itemSku, isShipped }) {
  const { pools, onOrder, customers } = openPools(salesOrders);
  const out = {};
  for (const d of days) {
    for (const l of d.ship || []) {
      const item = itemSku(l);
      // Both halves key on the flavour's lid SKU: the lid because that is its
      // own order line, the base because its label line is filed under the same
      // flavour. `item` stays the code that physically ships, for the tooltip.
      const key = `${marketCode(l.market) || l.market}|${l.sku}|${l.kind}`;
      // `onOrder` is every order carrying this item, so a row that draws
      // nothing can still name the order it belongs to and say the quantity is
      // exceeded, rather than claiming the item was never ordered.
      // `customers` is who the orders behind this item belong to. A market can
      // ship to more than one — New York runs Acreage and Urban — and the only
      // thing that tells them apart is the order a row books against.
      const entry = { item, parts: [], short: 0, confirmed: false,
        onOrder: onOrder[key] || [], customers: customers[key] || [] };
      out[l.key] = entry;
      if (isShipped && isShipped(l, d.date)) { entry.confirmed = true; continue; }
      let need = l.units;
      for (const p of pools[key] || []) {
        if (need <= 0) break;
        if (p.left <= 0) continue;
        const take = Math.min(need, p.left);
        p.left -= take; need -= take;
        // One order can carry a flavour on more than one line — Montana files
        // its labels twice on SO15716 — and drawing from each in turn used to
        // name the same order once per line, so the badge read "SO15826 ·
        // SO15826". An order is named once, for the total it covers.
        const at = entry.parts.find((x) => x.so === p.so);
        if (at) at.units += take;
        else entry.parts.push({ so: p.so, custPo: p.custPo, customer: p.customer, units: take });
      }
      entry.short = need;                 // beyond the open balance on those orders
    }
  }
  return out;
}
