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

// SuiteQL status codes that mean nothing further will ship on the order.
const CLOSED = new Set(["C", "G", "H"]);

// NetSuite gives order dates as M/D/YYYY. Sort on a comparable form, and push
// anything undated to the back so a missing date never jumps the queue.
const orderRank = (r) => {
  const m = String(r.orderDate || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : "9999-99-99";
};

// Open balance per market + item, oldest order first.
function openPools(salesOrders) {
  const pools = {};
  for (const r of salesOrders || []) {
    if (CLOSED.has(String(r.status || "").trim().toUpperCase())) continue;
    const left = (Number(r.ordered) || 0) - (Number(r.shipped) || 0);
    if (left <= 0 || !r.market || !r.sku) continue;
    const k = r.market + "|" + r.sku;
    (pools[k] = pools[k] || []).push({ so: r.so, custPo: r.custPo, orderDate: r.orderDate,
      status: r.status, ordered: Number(r.ordered) || 0, left });
  }
  for (const k of Object.keys(pools))
    pools[k].sort((a, b) => orderRank(a).localeCompare(orderRank(b)) ||
      String(a.so).localeCompare(String(b.so), undefined, { numeric: true }));
  return pools;
}

// days        the whole plan, every market — allocation must not depend on
//             which market the screen happens to be filtered to
// marketCode  "New Jersey" → "NJ", to meet NetSuite's market codes
// itemSku     a plan line → the SKU that physically ships (bases are a shared
//             PB- code, not the flavour's PL- lid code the line is keyed on)
// isShipped   already confirmed gone in NetSuite, so its units are counted in
//             the order's `shipped` figure and must not be drawn down twice
export function allocateSalesOrders({ days = [], salesOrders = [], marketCode, itemSku, isShipped }) {
  const pools = openPools(salesOrders);
  const out = {};
  for (const d of days) {
    for (const l of d.ship || []) {
      const item = itemSku(l);
      const key = (marketCode(l.market) || l.market) + "|" + item;
      const entry = { item, parts: [], short: 0, confirmed: false };
      out[l.key] = entry;
      if (isShipped && isShipped(l, d.date)) { entry.confirmed = true; continue; }
      let need = l.units;
      for (const p of pools[key] || []) {
        if (need <= 0) break;
        if (p.left <= 0) continue;
        const take = Math.min(need, p.left);
        p.left -= take; need -= take;
        entry.parts.push({ so: p.so, custPo: p.custPo, units: take });
      }
      entry.short = need;                 // beyond every open order for this item
    }
  }
  return out;
}
