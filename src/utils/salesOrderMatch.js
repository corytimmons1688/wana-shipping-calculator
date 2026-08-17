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
    const k = r.market + "|" + r.sku;
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
      const key = (marketCode(l.market) || l.market) + "|" + item;
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
        entry.parts.push({ so: p.so, custPo: p.custPo, customer: p.customer, units: take });
      }
      entry.short = need;                 // beyond the open balance on those orders
    }
  }
  return out;
}
