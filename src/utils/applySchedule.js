// applySchedule.js — two linked plans for the Calyx floor:
//
//   APPLICATION  when labels go on bases. This is the bottleneck, so it runs as
//                early as base stock allows — ahead of lid arrival — and is the
//                only thing that consumes daily capacity.
//   SHIPPING     when matched components leave for a market. Bases that pair
//                with lids the market already holds ship the day after they're
//                applied; everything else waits for its lids and ships the day
//                after they land at Calyx.
//
// Persisted state: capacity, start date, completed log, edited quantities,
// pre-applied base stock and pinned days. The plan itself is derived.

import { BASE_TYPES } from "../data/skuMaster";
import { skuInfo } from "./inventory";

export const LID_BOX = 1134;
export const BASE_BOX = 378;
export const CAP_MIN = 10000, CAP_MAX = 15000;
export const DEFAULT_CAPACITY = 12474;
export const DUE_WINDOW_DAYS = 45;

export const baseSkuFor = (lidSku) => (BASE_TYPES[skuInfo(lidSku).base] || BASE_TYPES["White"]).sku;
const iso = (d) => { const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const parse = (s) => { const p = String(s).split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); };
export const slotKey = (date, market, sku, kind) => `${date}|${market}|${sku}|${kind}`;
const upBox = (n, box) => (n <= 0 ? 0 : Math.ceil(n / box) * box);
const dnBox = (n, box) => (n <= 0 ? 0 : Math.floor(n / box) * box);

function businessDays(from, n) {
  const out = [], d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  while (out.length < n) { const w = d.getDay(); if (w !== 0 && w !== 6) out.push(iso(d)); d.setDate(d.getDate() + 1); }
  return out;
}
export function nextBusinessDay(from) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return iso(d);
}
const nextBizStr = (s) => nextBusinessDay(parse(s));
const shortDate = (iso) => { const p = String(iso).split("-"); return p.length === 3 ? `${+p[1]}/${+p[2]}` : iso; };

// True stock at Calyx (received − shipped ± adjustments) plus dated arrivals.
function availability(actuals) {
  const onHand = {}, arrivals = [];
  for (const sh of actuals.inbound || [])
    for (const l of sh.lines || []) {
      const q = Number(l.qty) || 0; if (!l.sku || !q) continue;
      if (sh.received === true) onHand[l.sku] = (onHand[l.sku] || 0) + q;
      else if (sh.eta) arrivals.push({ sku: l.sku, date: sh.eta, qty: q, ref: sh.ref || "" });
    }
  for (const sh of actuals.outbound || [])
    for (const l of sh.lines || []) { const q = Number(l.qty) || 0; if (l.sku && q) onHand[l.sku] = (onHand[l.sku] || 0) - q; }
  for (const a of actuals.adjustments || []) { const d = Number(a.delta) || 0; if (a.sku && d) onHand[a.sku] = (onHand[a.sku] || 0) + d; }
  arrivals.sort((a, b) => a.date.localeCompare(b.date));
  const at = (sku, dateStr) => {
    let v = onHand[sku] || 0;
    for (const a of arrivals) { if (a.sku !== sku) continue; if (a.date <= dateStr) v += a.qty; else break; }
    return v;
  };
  // First date at least `qty` of a sku is at Calyx, plus WHICH container got us
  // there — so a ship line can name the thing it is actually waiting on.
  const readyBy = (sku, qty, fromDate) => {
    if ((onHand[sku] || 0) >= qty) return { date: fromDate, ref: "", fromStock: true };
    let run = onHand[sku] || 0;
    for (const a of arrivals) {
      if (a.sku !== sku) continue;
      run += a.qty;
      if (run >= qty) return { date: a.date > fromDate ? a.date : fromDate, ref: a.ref, fromStock: false };
    }
    return null;                                   // never enough in the horizon
  };
  return { at, readyBy, onHand };
}

export function buildApplySchedule({ mw, grid, actuals, today, startDate,
  capacity = DEFAULT_CAPACITY, log = [], overrides = {}, preApplied = {},
  marketStock = {}, pinned = [], numDays = 30, dueWindowDays = DUE_WINDOW_DAYS,
  market = "All" }) {

  const todayStr = iso(today);
  const start = startDate || nextBusinessDay(today);
  const windowEndStr = iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + dueWindowDays));
  const av = availability(actuals);

  const shippedSince = {};
  for (const e of log) shippedSince[e.market + "|" + e.sku + "|" + e.kind] = (shippedSince[e.market + "|" + e.sku + "|" + e.kind] || 0) + (Number(e.units) || 0);
  const held = (mk, sku, kind) => {
    const ms = (marketStock[mk] || {})[sku] || {};
    return (Number(kind === "LID" ? ms.lid : ms.base) || 0) + (shippedSince[mk + "|" + sku + "|" + kind] || 0);
  };

  // ── time-phased requirement per market + flavour ──────────────────────────
  const groups = [];
  for (const sku of Object.keys(mw.byKey || {})) {
    if (sku.startsWith("PB-")) continue;
    for (const [mk, weekly] of Object.entries(mw.byKey[sku] || {})) {
      if (market !== "All" && mk !== market) continue;
      let lidPool = held(mk, sku, "LID"), basePool = held(mk, sku, "BASE");
      const heldLid = lidPool, heldBase = basePool;
      let lidNeed = 0, baseNeed = 0, due = null;
      for (let w = 0; w < weekly.length; w++) {
        const q = Number(weekly[w]) || 0; if (q <= 0) continue;
        const d = (grid[w] && grid[w].key) || todayStr;
        if (d > windowEndStr) break;
        const uL = Math.min(lidPool, q); lidPool -= uL; if (q - uL > 0) { lidNeed += q - uL; if (!due) due = d; }
        const uB = Math.min(basePool, q); basePool -= uB; if (q - uB > 0) { baseNeed += q - uB; if (!due) due = d; }
      }
      if (baseNeed <= 0 && lidNeed <= 0) continue;
      const info = skuInfo(sku);
      groups.push({ pk: mk + "|" + sku, market: mk, sku, name: info.name,
        baseSku: baseSkuFor(sku), baseColor: info.base === "Black Sparkle" ? "Black" : "White",
        baseNeed: upBox(baseNeed, BASE_BOX), lidNeed: upBox(lidNeed, LID_BOX),
        bareLid: Math.max(0, heldLid - heldBase), due: due || todayStr });
    }
  }
  groups.sort((a, b) => a.due.localeCompare(b.due) || a.market.localeCompare(b.market) || a.name.localeCompare(b.name));

  const dates = businessDays(parse(start), numDays);
  const usedBase = {}, usedLid = {};
  const preLeft = { ...preApplied };
  const byDate = {};
  const D = (d) => (byDate[d] = byDate[d] || { date: d, applied: 0, capacity, apply: [], ship: [] });
  // A row's key is (date, market, sku, kind), and two entries can legitimately
  // resolve to the same slot — an "early" tranche and the remainder of the same
  // base line landing on one day. Pushing both hands React duplicate keys,
  // which breaks reconciliation: filtered-out rows stay in the DOM as ghosts.
  // Merge instead, so a slot is always exactly one row.
  const put = (arr, row, box) => {
    const at = arr.find((r) => r.key === row.key);
    if (!at) { arr.push(row); return row; }
    at.units += row.units;
    at.boxes = at.units / box;
    if (row.reason && !at.reason) at.reason = row.reason;
    return at;
  };

  // completed + pinned first — they consume capacity and material
  const pinKeys = new Set();
  // Applying a base and shipping it are two jobs on two days. A log entry now
  // says which one it completed, so ticking a line on the application side no
  // longer marks it shipped as well. Entries written before this carry no
  // `side` and still complete both, so old data keeps behaving as it did.
  const sideOf = (e) => e.side || "both";
  // Collapse to one record per slot first. A line can be ticked on both sides,
  // and each tick is its own entry — counted separately they would spend the
  // material and the capacity twice over.
  const doneSlots = new Map();
  for (const e of log) {
    if (market !== "All" && e.market !== market) continue;
    const k = slotKey(e.date, e.market, e.sku, e.kind);
    const cur = doneSlots.get(k) || { e, units: 0, applied: false, shipped: false };
    cur.units = Math.max(cur.units, Number(e.units) || 0);
    const side = sideOf(e);
    if (side !== "ship") cur.applied = true;
    if (side !== "apply") cur.shipped = true;
    doneSlots.set(k, cur);
  }
  for (const [k, c] of doneSlots) {
    const e = c.e, info = skuInfo(e.sku);
    const units = c.units, isBase = e.kind === "BASE";
    const box = isBase ? BASE_BOX : LID_BOX;
    const row = { key: k, market: e.market, sku: e.sku, name: info.name,
      kind: e.kind, baseColor: info.base === "Black Sparkle" ? "Black" : "White", units,
      boxes: units / box, done: true, preApplied: !!e.preApplied, due: e.due || "" };
    if (c.shipped) put(D(e.date).ship, { ...row }, box);
    // Capacity is only spent on the day the labels actually went on.
    if (isBase && !e.preApplied && c.applied) { put(D(e.date).apply, { ...row }, box); D(e.date).applied += units; }
    (isBase ? usedBase : usedLid)[isBase ? baseSkuFor(e.sku) : e.sku] =
      ((isBase ? usedBase : usedLid)[isBase ? baseSkuFor(e.sku) : e.sku] || 0) + units;
    // Work that is finished is no longer outstanding. Without this the planner
    // still sees the full requirement, schedules the same units a second time,
    // and that phantom demand pushes other markets off the day — ticking one
    // New Jersey line made a Colorado line disappear.
    const g = groups.find((x) => x.pk === e.market + "|" + e.sku);
    if (g) {
      if (isBase) { g.baseNeed = Math.max(0, g.baseNeed - units); g.bareLid = Math.max(0, g.bareLid - units); }
      else g.lidNeed = Math.max(0, g.lidNeed - units);
    }
  }
  for (const p of pinned) {
    if (market !== "All" && p.market !== market) continue;
    const k = slotKey(p.date, p.market, p.sku, p.kind);
    // A pinned line that has been ticked is already accounted for by the log
    // above. Reserve the slot so the planner leaves it alone, then contribute
    // only the side the tick has NOT completed. Counting both is what doubled
    // Mellow Melon to 13,608 and pushed Colorado off the day.
    const done = doneSlots.get(k);
    pinKeys.add(p.market + "|" + p.sku + "|" + p.kind);
    if (done && done.applied && done.shipped) continue;
    const info = skuInfo(p.sku), isBase = p.kind === "BASE";
    const ov = overrides[k];
    const box = isBase ? BASE_BOX : LID_BOX;
    const units = ov != null ? Math.max(0, Math.round(Number(ov) / box) * box) : Number(p.units) || 0;
    const row = { key: k, market: p.market, sku: p.sku, name: info.name, kind: p.kind,
      baseColor: info.base === "Black Sparkle" ? "Black" : "White", units, boxes: units / box,
      done: false, edited: ov != null, preApplied: !!p.preApplied, pinned: true, due: p.due || "" };
    if (!done || !done.shipped) put(D(p.date).ship, { ...row }, box);
    if (isBase && !p.preApplied && (!done || !done.applied)) { put(D(p.date).apply, { ...row }, box); D(p.date).applied += units; }
    // Material and outstanding need are spent once per slot — the log already
    // did it if this line was ticked.
    if (!done) {
      (isBase ? usedBase : usedLid)[isBase ? baseSkuFor(p.sku) : p.sku] = ((isBase ? usedBase : usedLid)[isBase ? baseSkuFor(p.sku) : p.sku] || 0) + units;
      const g = groups.find((x) => x.pk === p.market + "|" + p.sku);
      if (g) { if (isBase) { g.baseNeed = Math.max(0, g.baseNeed - units); g.bareLid = Math.max(0, g.bareLid - units); } else g.lidNeed = Math.max(0, g.lidNeed - units); }
    }
  }

  // ── APPLICATION pass — capacity-bound, pulled as early as base stock allows
  const applyDone = {};                              // pk → { units, date }
  const work = groups.filter((g) => g.baseNeed > 0 && !pinKeys.has(g.market + "|" + g.sku + "|BASE"));
  for (const date of dates) {
    let capLeft = capacity - (byDate[date] ? byDate[date].applied : 0);
    if (capLeft <= 0) continue;
    for (const g of work) {
      if (g.baseNeed <= 0 || capLeft < BASE_BOX) continue;
      const free = Math.max(0, av.at(g.baseSku, date) - (usedBase[g.baseSku] || 0));
      const pre = Math.max(0, Number(preLeft[g.pk]) || 0);
      const ov = overrides[slotKey(date, g.market, g.sku, "BASE")];

      // One SKU, one day. Splitting a flavour across days means the floor sets
      // up the same label twice and neither day ships, so a SKU only starts on
      // a day that can finish it: full quantity, or wait.
      let qty;
      if (ov != null) {
        // A hand-edited quantity is the operator's call — respect it as given.
        qty = Math.min(Math.max(0, Math.round(Number(ov) / BASE_BOX) * BASE_BOX),
                       dnBox(free, BASE_BOX), dnBox(pre, BASE_BOX) + dnBox(capLeft, BASE_BOX));
      } else {
        const want = upBox(g.baseNeed, BASE_BOX);
        if (dnBox(free, BASE_BOX) < want) continue;          // material not all here yet
        const fromCap = Math.max(0, want - dnBox(pre, BASE_BOX));
        // A requirement larger than a whole day can never fit one; give it the
        // earliest day it has material for and let that day run over, which the
        // capacity bar already shows in red.
        if (fromCap > capacity) { if (byDate[date] && byDate[date].applied > 0) continue; }
        else if (fromCap > capLeft) continue;                // wait for a day with room
        qty = want;
      }
      if (qty < BASE_BOX) continue;
      const fromPre = Math.min(qty, pre);
      preLeft[g.pk] = pre - fromPre;
      capLeft -= (qty - fromPre);
      usedBase[g.baseSku] = (usedBase[g.baseSku] || 0) + qty;
      g.baseNeed -= qty;
      const d = D(date);
      put(d.apply, { key: slotKey(date, g.market, g.sku, "BASE"), market: g.market, sku: g.sku,
        name: g.name, kind: "BASE", baseColor: g.baseColor, units: qty, boxes: qty / BASE_BOX,
        done: false, edited: ov != null, preApplied: fromPre > 0, due: g.due, late: g.due < date }, BASE_BOX);
      d.applied += (qty - fromPre);
      const a = applyDone[g.pk] || (applyDone[g.pk] = { units: 0, date });
      a.units += qty; a.date = date;
    }
  }

  // ── SHIPPING pass ────────────────────────────────────────────────────────
  // Bases that pair with lids already at the market go the next business day
  // after they're applied. Everything else waits for its lids to land, then
  // ships the following business day.
  const shipQueue = [];
  for (const g of groups) {
    const a = applyDone[g.pk];
    if (a && a.units > 0) {
      const early = Math.min(a.units, dnBox(g.bareLid, BASE_BOX));
      if (early > 0) shipQueue.push({ g, kind: "BASE", units: early, date: nextBizStr(a.date), reason: "lids already at market" });
      const rest = a.units - early;
      if (rest > 0) {
        const lr = av.readyBy(g.sku, rest + (usedLid[g.sku] || 0), a.date);
        if (lr) {
          const lidsBind = lr.date > a.date && !lr.fromStock;
          shipQueue.push({ g, kind: "BASE", units: rest, date: nextBizStr(lidsBind ? lr.date : a.date),
            reason: lidsBind ? `waits for ${lr.ref || "lids"} · ${shortDate(lr.date)}`
                             : `application completes ${shortDate(a.date)}` });
        }
      }
    }
    if (g.lidNeed > 0 && !pinKeys.has(g.market + "|" + g.sku + "|LID")) {
      const need = g.lidNeed;
      const lr = av.readyBy(g.sku, need + (usedLid[g.sku] || 0), start);
      if (lr) {
        const applyD = applyDone[g.pk] ? applyDone[g.pk].date : start;
        const lidsBind = lr.date > applyD && !lr.fromStock;
        usedLid[g.sku] = (usedLid[g.sku] || 0) + need;
        shipQueue.push({ g, kind: "LID", units: need, date: nextBizStr(lidsBind ? lr.date : applyD),
          reason: lidsBind ? `waits for ${lr.ref || "lids"} · ${shortDate(lr.date)}`
                           : (applyDone[g.pk] ? "with its bases" : "lids in stock") });
      }
    }
  }
  const lastDate = dates[dates.length - 1];
  for (const s of shipQueue) {
    if (s.date > lastDate || s.units <= 0) continue;
    const box = s.kind === "BASE" ? BASE_BOX : LID_BOX;
    const k = slotKey(s.date, s.g.market, s.g.sku, s.kind);
    if (log.some((e) => slotKey(e.date, e.market, e.sku, e.kind) === k && sideOf(e) !== "apply")) continue;
    const ov = overrides[k];
    const units = ov != null ? Math.max(0, Math.round(Number(ov) / box) * box) : s.units;
    if (units <= 0) continue;
    put(D(s.date).ship, { key: k, market: s.g.market, sku: s.g.sku, name: s.g.name, kind: s.kind,
      baseColor: s.g.baseColor, units, boxes: units / box, done: false, edited: ov != null,
      preApplied: false, due: s.g.due, late: s.g.due < s.date, reason: s.reason }, box);
  }

  const days = dates.map((d) => byDate[d]).filter((d) => d && (d.apply.length || d.ship.length));
  const totals = {
    capacity,
    toApply: days.reduce((a, d) => a + d.apply.reduce((x, l) => x + (l.preApplied ? 0 : l.units), 0), 0),
    toShip: days.reduce((a, d) => a + d.ship.reduce((x, l) => x + l.units, 0), 0),
    done: log.reduce((a, e) => a + (Number(e.units) || 0), 0),
    unapplied: groups.reduce((a, g) => a + Math.max(0, g.baseNeed), 0),
    requirement: groups.reduce((a, g) => a + g.baseNeed + g.lidNeed, 0),
  };
  const markets = [...new Set(Object.values(mw.byKey || {}).flatMap((m) => Object.keys(m)))].sort();
  return { days, totals, markets, queueLeft: groups.filter((g) => g.baseNeed > 0) };
}
