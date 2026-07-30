// applySchedule.js — day-by-day label-application + ship plan for the Calyx floor.
//
// One "set" = 1 lid box (1,134) = 3 base boxes (378 each), so everything the
// floor picks is a whole number of sets and lids/bases can never go out
// unpaired. Each line is (day · market · flavor): apply that many labelled
// bases and ship the matching lids.
//
// The schedule is DERIVED, not stored. Persisted state is only:
//   capacity   — units/day the team can apply (10k–15k)
//   log        — completed lines [{date, market, sku, units}] (grey rows)
//   overrides  — edited pending quantities { "date|market|sku": units }
// Remaining requirement = demand − already shipped − logged, so ticking a line
// or editing its quantity automatically re-flows every later day.

import { BASE_TYPES } from "../data/skuMaster";
import { skuInfo } from "./inventory";

export const LID_BOX = 1134;
export const BASE_BOX = 378;
export const SET = LID_BOX;              // 1 lid box pairs with 3 base boxes
export const CAP_MIN = 10000, CAP_MAX = 15000;
export const DEFAULT_CAPACITY = 12474;   // 11 sets/day — inside the 10–15k window

export const baseSkuFor = (lidSku) => {
  const info = skuInfo(lidSku);
  const b = BASE_TYPES[info.base] || BASE_TYPES["White"];
  return b.sku;
};

const iso = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
export const slotKey = (date, market, sku) => `${date}|${market}|${sku}`;

// Business days (Mon–Fri) starting at or after `from`.
function businessDays(from, n) {
  const out = [];
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  while (out.length < n) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) out.push(iso(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

// TRUE current stock at Calyx, computed straight off the actuals rather than the
// MRP's per-SKU model (that one is anchored to the May-25 as-of date and treats
// market demand — not outbound shipments — as the outflow, so it would report
// stock that has physically already gone to a market).
//   on hand = received inbound − everything shipped out ± count adjustments
//   arrivals = not-yet-received inbound, keyed by ETA date
function availabilityFn(actuals) {
  const onHand = {}, arrivals = [];
  for (const sh of actuals.inbound || []) {
    for (const l of sh.lines || []) {
      const q = Number(l.qty) || 0;
      if (!l.sku || !q) continue;
      if (sh.received === true) onHand[l.sku] = (onHand[l.sku] || 0) + q;
      else if (sh.eta) arrivals.push({ sku: l.sku, date: sh.eta, qty: q });
    }
  }
  for (const sh of actuals.outbound || [])
    for (const l of sh.lines || []) {
      const q = Number(l.qty) || 0;
      if (l.sku && q) onHand[l.sku] = (onHand[l.sku] || 0) - q;
    }
  for (const a of actuals.adjustments || []) {
    const d = Number(a.delta) || 0;
    if (a.sku && d) onHand[a.sku] = (onHand[a.sku] || 0) + d;
  }
  const cache = {};
  return (sku, dateStr) => {
    const k = sku + "|" + dateStr;
    if (cache[k] != null) return cache[k];
    let v = onHand[sku] || 0;
    for (const a of arrivals) if (a.sku === sku && a.date <= dateStr) v += a.qty;
    cache[k] = v;
    return v;
  };
}

/**
 * @returns {{days: Array, queueLeft: Array, totals: object}}
 *   days: [{ date, capUsed, capacity, lines: [{key, market, sku, name, baseSku,
 *            baseColor, units, sets, done, edited, blocked}] }]
 */
export function buildApplySchedule({ mw, actuals, today,
  capacity = DEFAULT_CAPACITY, log = [], overrides = {}, numDays = 30 }) {
  const capSets = Math.max(1, Math.floor(capacity / SET));
  const outbound = actuals.outbound || [];

  // ── already shipped to each market (per SKU) ──────────────────────────────
  const shipped = {};
  for (const o of outbound) {
    for (const l of o.lines || []) {
      if (!l.sku || l.sku.startsWith("PB-")) continue;
      const k = o.market + "|" + l.sku;
      shipped[k] = (shipped[k] || 0) + (Number(l.qty) || 0);
    }
  }
  // ── already applied (logged) ──────────────────────────────────────────────
  const logged = {};
  for (const e of log) {
    const k = e.market + "|" + e.sku;
    logged[k] = (logged[k] || 0) + (Number(e.units) || 0);
  }

  // ── requirement per market + lid SKU ──────────────────────────────────────
  const queue = [];
  for (const sku of Object.keys(mw.byKey || {})) {
    if (sku.startsWith("PB-")) continue;           // bases derive from lids
    for (const [market, weekly] of Object.entries(mw.byKey[sku] || {})) {
      let total = 0, firstIdx = Infinity;
      for (let w = 0; w < weekly.length; w++) {
        const v = Number(weekly[w]) || 0;
        if (v > 0) { total += v; if (w < firstIdx) firstIdx = w; }
      }
      if (total <= 0) continue;
      const k = market + "|" + sku;
      const remain = total - (shipped[k] || 0) - (logged[k] || 0);
      if (remain <= 0) continue;
      queue.push({ market, sku, name: skuInfo(sku).name, baseSku: baseSkuFor(sku),
        baseColor: skuInfo(sku).base === "Black Sparkle" ? "Black" : "White",
        need: remain, firstIdx });
    }
  }
  // earliest need first, then largest
  queue.sort((a, b) => a.firstIdx - b.firstIdx || b.need - a.need || a.market.localeCompare(b.market));

  const availAt = availabilityFn(actuals);
  const usedLid = {}, usedBase = {};                 // consumed so far in this plan
  const dates = businessDays(today, numDays);
  const logByDate = {};
  for (const e of log) (logByDate[e.date] = logByDate[e.date] || []).push(e);

  const days = [];
  const work = queue.map((q) => ({ ...q }));
  let totalPlanned = 0, totalDone = 0, totalBlocked = 0;

  for (const date of dates) {
    const lines = [];
    let setsLeft = capSets;

    // completed rows for this date first — they consume capacity and material
    for (const e of logByDate[date] || []) {
      const info = skuInfo(e.sku);
      const units = Number(e.units) || 0;
      lines.push({ key: slotKey(date, e.market, e.sku), market: e.market, sku: e.sku,
        name: info.name, baseSku: baseSkuFor(e.sku),
        baseColor: info.base === "Black Sparkle" ? "Black" : "White",
        units, sets: Math.round(units / SET), done: true, edited: false, blocked: false });
      setsLeft -= Math.ceil(units / SET);
      usedLid[e.sku] = (usedLid[e.sku] || 0) + units;
      const bs = baseSkuFor(e.sku);
      usedBase[bs] = (usedBase[bs] || 0) + units;
      totalDone += units;
    }
    if (setsLeft < 0) setsLeft = 0;

    for (const item of work) {
      if (setsLeft <= 0) break;
      if (item.need <= 0) continue;
      const ov = overrides[slotKey(date, item.market, item.sku)];

      // material on hand (or landed) by this date, net of what the plan already used
      const lidFree = availAt(item.sku, date) - (usedLid[item.sku] || 0);
      const baseFree = availAt(item.baseSku, date) - (usedBase[item.baseSku] || 0);
      const matSets = Math.floor(Math.max(0, Math.min(lidFree, baseFree)) / SET);
      if (matSets <= 0) continue;                    // nothing landed yet — try a later day

      let sets = Math.min(setsLeft, matSets, Math.ceil(item.need / SET));
      if (ov != null) sets = Math.min(Math.max(0, Math.round(Number(ov) / SET)), setsLeft, matSets);
      if (sets <= 0) continue;

      const units = sets * SET;
      lines.push({ key: slotKey(date, item.market, item.sku), market: item.market, sku: item.sku,
        name: item.name, baseSku: item.baseSku, baseColor: item.baseColor,
        units, sets, done: false, edited: ov != null,
        blocked: matSets < Math.ceil(item.need / SET) });
      setsLeft -= sets;
      item.need -= units;
      usedLid[item.sku] = (usedLid[item.sku] || 0) + units;
      usedBase[item.baseSku] = (usedBase[item.baseSku] || 0) + units;
      totalPlanned += units;
    }

    if (lines.length) days.push({ date, capacity, capUsed: lines.reduce((a, l) => a + l.units, 0), lines });
  }

  const queueLeft = work.filter((w) => w.need > 0);
  totalBlocked = queueLeft.reduce((a, w) => a + w.need, 0);
  return { days, queueLeft,
    totals: { planned: totalPlanned, done: totalDone, unscheduled: totalBlocked,
      requirement: queue.reduce((a, q) => a + q.need, 0), capSets, capacity } };
}
