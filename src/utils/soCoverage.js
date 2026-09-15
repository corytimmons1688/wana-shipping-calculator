// soCoverage.js — how much of a market's forecast already has a sales order
// behind it, week by week.
//
// The Item Forecast grid says what a market intends to sell. It has never said
// whether anyone has ordered it, so a market reading that grid cannot tell the
// weeks that are covered from the weeks they still owe us a PO for. This joins
// the two: the same cube sales orders the Market Orders view reads, drawn down
// across the forecast weeks in date order, so every cell knows whether it is
// spoken for.
//
// Allocation is oldest week first, which is how an order actually gets consumed
// — the order does not name a week, so the earliest demand takes it. What falls
// off the end is what the market needs to write a new order against, and it
// lands on the weeks furthest out, where there is still time to do something
// about it.

import { cubeOrdersOnly } from "./salesOrderMatch";

// NetSuite's market codes, keyed by the scenario's market names.
export const MARKET_CODE = {
  "New Jersey": "NJ", "New York": "NY", Colorado: "CO", Massachusetts: "MA",
  Arizona: "AZ", Illinois: "IL", Michigan: "MI", Missouri: "MO", Montana: "MT",
  "New Mexico": "NM", Ohio: "OH", Oklahoma: "OK", Connecticut: "CT", Maryland: "MD",
  Mississippi: "MS", Arkansas: "AR", Florida: "FL",
};

// Statuses where nothing further will ship. A closed order still covers what it
// actually delivered — those units are on the market's floor — but the balance
// was cancelled and covers nothing, so it must not read as ordered.
const CLOSED = new Set(["C", "G", "H"]);

/**
 * Ordered quantity per lid SKU for one market, from the cube orders only.
 * `market` null rolls every market up, to match the grid's macro view.
 */
export function orderedBySku(salesOrders = [], market = null) {
  const code = market ? MARKET_CODE[market] || market : null;
  const out = {};
  for (const r of cubeOrdersOnly(salesOrders)) {
    if (!r.market) continue;                       // not booked to a market
    if (code && r.market !== code) continue;
    // Lid lines only. A cube is one lid and one base, so the lid line is the
    // count of cubes ordered; bases ride a shared PB- code that cannot say
    // which flavour it belongs to without its label, and counting both would
    // double the coverage of every flavour.
    if (!String(r.sku || "").startsWith("PL-")) continue;
    const closed = CLOSED.has(String(r.status || "").trim().toUpperCase());
    const qty = closed ? Number(r.shipped) || 0 : Number(r.ordered) || 0;
    if (qty <= 0) continue;
    const e = (out[r.sku] = out[r.sku] || { ordered: 0, orders: [] });
    e.ordered += qty;
    const at = e.orders.find((o) => o.so === r.so);
    if (at) at.qty += qty;
    else e.orders.push({ so: r.so, qty, status: r.status, customer: r.customer, custPo: r.custPo });
  }
  for (const k of Object.keys(out))
    out[k].orders.sort((a, b) => String(a.so).localeCompare(String(b.so), undefined, { numeric: true }));
  return out;
}
