// applySchedule.js — day-by-day label-application + ship plan for the Calyx floor.
//
// Model (matches how the team actually works):
//  · BASE and LID are separate lines. A market that already holds the lid only
//    needs the labelled base, so BASE-only days are normal.
//  · Only BASE lines consume application capacity — labels go on bases. Lids
//    are pick-and-ship, so a day can look heavy in units yet be light on labour
//    (e.g. bases that were applied ahead of time).
//  · TIME-PHASED by due date: each market's weekly demand becomes a dated
//    bucket, netted against the components that market already holds. Only work
//    due inside the planning window is scheduled, so a market needing stock in
//    two weeks is never pushed behind another market's December volume.
//
// Persisted state is only capacity, the completed log, edited quantities and
// pre-applied base stock; the plan itself is derived.

import { BASE_TYPES } from "../data/skuMaster";
import { skuInfo } from "./inventory";

export const LID_BOX = 1134;
export const BASE_BOX = 378;
export const CAP_MIN = 10000, CAP_MAX = 15000;
export const DEFAULT_CAPACITY = 12474;
export const DUE_WINDOW_DAYS = 45;        // only plan work due inside this window

export const baseSkuFor = (lidSku) => (BASE_TYPES[skuInfo(lidSku).base] || BASE_TYPES["White"]).sku;
const iso = (d) => { const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
export const slotKey = (date, market, sku, kind) => `${date}|${market}|${sku}|${kind}`;
const upBox = (n, box) => (n <= 0 ? 0 : Math.ceil(n / box) * box);

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

// TRUE stock at Calyx: received inbound − everything shipped out ± adjustments,
// plus not-yet-received inbound keyed by ETA. (calcSkuInventory can't be used —
// it is anchored to the MRP as-of date and treats demand, not outbound, as the
// outflow, so it reports stock that has physically gone to a market.)
function availabilityFn(actuals) {
  const onHand = {}, arrivals = [];
  for (const sh of actuals.inbound || [])
    for (const l of sh.lines || []) {
      const q = Number(l.qty) || 0; if (!l.sku || !q) continue;
      if (sh.received === true) onHand[l.sku] = (onHand[l.sku] || 0) + q;
      else if (sh.eta) arrivals.push({ sku: l.sku, date: sh.eta, qty: q });
    }
  for (const sh of actuals.outbound || [])
    for (const l of sh.lines || []) {
      const q = Number(l.qty) || 0; if (l.sku && q) onHand[l.sku] = (onHand[l.sku] || 0) - q;
    }
  for (const a of actuals.adjustments || []) {
    const d = Number(a.delta) || 0; if (a.sku && d) onHand[a.sku] = (onHand[a.sku] || 0) + d;
  }
  const cache = {};
  return (sku, dateStr) => {
    const k = sku + "|" + dateStr;
    if (cache[k] != null) return cache[k];
    let v = onHand[sku] || 0;
    for (const a of arrivals) if (a.sku === sku && a.date <= dateStr) v += a.qty;
    cache[k] = v; return v;
  };
}

export function buildApplySchedule({ mw, grid, actuals, today,
  capacity = DEFAULT_CAPACITY, log = [], overrides = {}, preApplied = {},
  marketStock = {}, numDays = 30, dueWindowDays = DUE_WINDOW_DAYS }) {

  const todayStr = iso(today);
  const windowEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + dueWindowDays);
  const windowEndStr = iso(windowEnd);

  // components already shipped by us since the market-stock snapshot
  const shippedSince = {};
  for (const e of log) {
    const k = e.market + "|" + e.sku + "|" + e.kind;
    shippedSince[k] = (shippedSince[k] || 0) + (Number(e.units) || 0);
  }
  const held = (market, sku, kind) => {
    const ms = (marketStock[market] || {})[sku] || {};
    return (Number(kind === "LID" ? ms.lid : ms.base) || 0) + (shippedSince[market + "|" + sku + "|" + kind] || 0);
  };

  // ── time-phased requirement ───────────────────────────────────────────────
  const items = [];
  for (const sku of Object.keys(mw.byKey || {})) {
    if (sku.startsWith("PB-")) continue;                 // bases follow their lid
    for (const [market, weekly] of Object.entries(mw.byKey[sku] || {})) {
      let lidPool = held(market, sku, "LID"), basePool = held(market, sku, "BASE");
      let lidNeed = 0, baseNeed = 0, lidDue = null, baseDue = null;
      for (let w = 0; w < weekly.length; w++) {
        const q = Number(weekly[w]) || 0;
        if (q <= 0) continue;
        const due = (grid[w] && grid[w].key) || todayStr;
        if (due > windowEndStr) break;                   // beyond the planning window
        const useLid = Math.min(lidPool, q); lidPool -= useLid;
        const shortLid = q - useLid;
        if (shortLid > 0) { lidNeed += shortLid; if (!lidDue) lidDue = due; }
        const useBase = Math.min(basePool, q); basePool -= useBase;
        const shortBase = q - useBase;
        if (shortBase > 0) { baseNeed += shortBase; if (!baseDue) baseDue = due; }
      }
      const info = skuInfo(sku);
      const common = { market, sku, name: info.name, baseSku: baseSkuFor(sku),
        baseColor: info.base === "Black Sparkle" ? "Black" : "White" };
      if (baseNeed > 0) items.push({ ...common, kind: "BASE", need: upBox(baseNeed, BASE_BOX), due: baseDue || todayStr });
      if (lidNeed > 0) items.push({ ...common, kind: "LID", need: upBox(lidNeed, LID_BOX), due: lidDue || todayStr });
    }
  }
  // earliest due first; within a day put BASE ahead of its LID
  items.sort((a, b) => a.due.localeCompare(b.due) || a.market.localeCompare(b.market)
    || a.name.localeCompare(b.name) || (a.kind === "BASE" ? -1 : 1));

  const availAt = availabilityFn(actuals);
  const used = {};
  const dates = businessDays(today, numDays);
  const logByDate = {};
  for (const e of log) (logByDate[e.date] = logByDate[e.date] || []).push(e);

  const days = [];
  const work = items.map((i) => ({ ...i }));
  const preLeft = { ...preApplied };                  // pre-applied stock is finite
  // a flavour's lids ship with (or after) its labelled bases, never ahead of them
  const baseOutstanding = {};
  for (const i of work) if (i.kind === "BASE") baseOutstanding[i.market + "|" + i.sku] = i.need;
  let planned = 0, doneU = 0, appliedPlanned = 0;

  for (const date of dates) {
    const lines = [];
    let capLeft = capacity;

    for (const e of logByDate[date] || []) {
      const info = skuInfo(e.sku);
      const units = Number(e.units) || 0;
      lines.push({ key: slotKey(date, e.market, e.sku, e.kind), market: e.market, sku: e.sku,
        name: info.name, kind: e.kind, baseColor: info.base === "Black Sparkle" ? "Black" : "White",
        units, boxes: units / (e.kind === "BASE" ? BASE_BOX : LID_BOX), done: true, edited: false, preApplied: false, due: e.due || "" });
      if (e.kind === "BASE" && !e.preApplied) capLeft -= units;
      const s = e.kind === "BASE" ? baseSkuFor(e.sku) : e.sku;
      used[s] = (used[s] || 0) + units;
      doneU += units;
    }
    if (capLeft < 0) capLeft = 0;

    for (const it of work) {
      if (it.need <= 0) continue;
      const isBase = it.kind === "BASE";
      const pk = it.market + "|" + it.sku;
      // hold a flavour's lids until its bases are covered, so they travel together
      if (!isBase && (baseOutstanding[pk] || 0) > 0) continue;
      const matSku = isBase ? it.baseSku : it.sku;
      const box = isBase ? BASE_BOX : LID_BOX;
      const free = availAt(matSku, date) - (used[matSku] || 0);
      if (free < box) continue;
      let qty = Math.min(it.need, Math.floor(free / box) * box);
      const pre = isBase ? Math.max(0, Number(preLeft[pk]) || 0) : 0;
      if (isBase) {
        const preUse = Math.floor(pre / box) * box;
        const capUse = Math.floor(Math.max(0, capLeft) / box) * box;
        qty = Math.min(qty, preUse + capUse);
      }
      if (qty < box) continue;
      const ov = overrides[slotKey(date, it.market, it.sku, it.kind)];
      if (ov != null) qty = Math.min(Math.max(0, Math.round(Number(ov) / box) * box), qty);
      if (qty <= 0) continue;

      const fromPre = isBase ? Math.min(qty, pre) : 0;
      lines.push({ key: slotKey(date, it.market, it.sku, it.kind), market: it.market, sku: it.sku,
        name: it.name, kind: it.kind, baseColor: it.baseColor, units: qty, boxes: qty / box,
        done: false, edited: ov != null, preApplied: fromPre > 0, due: it.due, late: it.due < date });
      if (isBase) {
        preLeft[pk] = pre - fromPre;
        capLeft -= (qty - fromPre);
        appliedPlanned += (qty - fromPre);
        baseOutstanding[pk] = Math.max(0, (baseOutstanding[pk] || 0) - qty);
      }
      used[matSku] = (used[matSku] || 0) + qty;
      it.need -= qty;
      planned += qty;
    }

    if (lines.length) {
      const applied = lines.filter((l) => l.kind === "BASE" && !l.preApplied).reduce((a, l) => a + l.units, 0);
      days.push({ date, capacity, applied, shipped: lines.reduce((a, l) => a + l.units, 0), lines });
    }
  }

  const left = work.filter((w) => w.need > 0);
  return { days, queueLeft: left,
    totals: { planned, done: doneU, applied: appliedPlanned,
      unscheduled: left.reduce((a, w) => a + w.need, 0),
      requirement: items.reduce((a, i) => a + i.need, 0), capacity } };
}
