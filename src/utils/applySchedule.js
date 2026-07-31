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

// Work is picked and labelled the day before it ships, so the plan opens on the
// next business day — nothing is ever scheduled for today.
export function nextBusinessDay(from) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return iso(d);
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

export function buildApplySchedule({ mw, grid, actuals, today, startDate,
  capacity = DEFAULT_CAPACITY, log = [], overrides = {}, preApplied = {},
  marketStock = {}, pinned = [], numDays = 30, dueWindowDays = DUE_WINDOW_DAYS }) {

  const todayStr = iso(today);
  const start = startDate || nextBusinessDay(today);
  const startD = (() => { const p = start.split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); })();
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
  const dates = businessDays(startD, numDays);
  const logByDate = {};
  for (const e of log) (logByDate[e.date] = logByDate[e.date] || []).push(e);

  const days = [];
  const work = items.map((i) => ({ ...i }));
  const preLeft = { ...preApplied };                  // pre-applied stock is finite

  // Base and lid for one flavour are planned together so the market's two halves
  // stay in step: we only send bases that pair with lids it already holds (or
  // that go out the same day), and only lids that pair with its bases. Excess of
  // either side is held back until its counterpart is available.
  const groups = {};
  for (const it of work) {
    const pk = it.market + "|" + it.sku;
    const g = groups[pk] || (groups[pk] = { pk, market: it.market, sku: it.sku, name: it.name,
      baseSku: it.baseSku, baseColor: it.baseColor, due: it.due });
    g[it.kind === "BASE" ? "base" : "lid"] = it;
    if (it.due < g.due) g.due = it.due;
  }
  const order = Object.values(groups).sort((a, b) =>
    a.due.localeCompare(b.due) || a.market.localeCompare(b.market) || a.name.localeCompare(b.name));
  const mktLid = {}, mktBase = {};
  for (const g of order) { mktLid[g.pk] = held(g.market, g.sku, "LID"); mktBase[g.pk] = held(g.market, g.sku, "BASE"); }

  // Pinned lines are days the team has already agreed. They render exactly as
  // entered and are consumed out of the requirement up front, so the derived
  // plan works around them instead of re-proposing the same work.
  const pinByDate = {};
  for (const p of pinned) {
    const g = groups[p.market + "|" + p.sku];
    const it = g && g[p.kind === "BASE" ? "base" : "lid"];
    const units = Number(p.units) || 0;
    if (it) it.need = Math.max(0, it.need - units);
    if (g) { if (p.kind === "BASE") mktBase[g.pk] += units; else mktLid[g.pk] += units; }
    (pinByDate[p.date] = pinByDate[p.date] || []).push(p);
  }
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
    for (const p of pinByDate[date] || []) {
      if ((log || []).some((e) => e.date === date && e.market === p.market && e.sku === p.sku && e.kind === p.kind)) continue;
      const info = skuInfo(p.sku);
      const units = Number(p.units) || 0;
      const box = p.kind === "BASE" ? BASE_BOX : LID_BOX;
      const ov = overrides[slotKey(date, p.market, p.sku, p.kind)];
      const qty = ov != null ? Math.max(0, Math.round(Number(ov) / box) * box) : units;
      lines.push({ key: slotKey(date, p.market, p.sku, p.kind), market: p.market, sku: p.sku,
        name: info.name, kind: p.kind, baseColor: info.base === "Black Sparkle" ? "Black" : "White",
        units: qty, boxes: qty / box, done: false, edited: ov != null,
        preApplied: !!p.preApplied, pinned: true, due: p.due || "" });
      if (p.kind === "BASE" && !p.preApplied) { capLeft -= qty; appliedPlanned += qty; }
      const ms = p.kind === "BASE" ? baseSkuFor(p.sku) : p.sku;
      used[ms] = (used[ms] || 0) + qty;
      planned += qty;
    }
    if (capLeft < 0) capLeft = 0;

    // Within a day, flavours that can go out complete (every half they still
    // need is in stock) run first — a finished pair lets the market produce,
    // a lone base just sits there. Base-only fills follow.
    const readyNow = (g) => {
      const bn = g.base && g.base.need > 0 ? g.base.need : 0;
      const ln = g.lid && g.lid.need > 0 ? g.lid.need : 0;
      if (!bn && !ln) return false;
      if (ln > 0 && availAt(g.sku, date) - (used[g.sku] || 0) < LID_BOX) return false;
      if (bn > 0 && availAt(g.baseSku, date) - (used[g.baseSku] || 0) < BASE_BOX) return false;
      return true;
    };
    const ready = [], rest = [];
    for (const g of order) (readyNow(g) ? ready : rest).push(g);

    // A pinned day is the agreed plan — render it exactly, don't top it up.
    for (const g of (pinByDate[date] ? [] : [...ready, ...rest])) {
      const bi = g.base, li = g.lid;
      const baseNeed = bi && bi.need > 0 ? bi.need : 0;
      const lidNeed = li && li.need > 0 ? li.need : 0;
      if (!baseNeed && !lidNeed) continue;

      const lidFree = Math.max(0, availAt(g.sku, date) - (used[g.sku] || 0));
      const baseFree = Math.max(0, availAt(g.baseSku, date) - (used[g.baseSku] || 0));
      const lidCan = Math.min(lidNeed, Math.floor(lidFree / LID_BOX) * LID_BOX);

      // ── BASE: only as many as the market has lids for (held lids that are
      //    still bare, plus whatever lids ship alongside today) ──────────────
      if (baseNeed > 0) {
        const bare = Math.max(0, mktLid[g.pk] - mktBase[g.pk]);
        const allow = upBox(bare + lidCan, BASE_BOX);
        const pre = Math.max(0, Number(preLeft[g.pk]) || 0);
        const preUse = Math.floor(pre / BASE_BOX) * BASE_BOX;
        const capUse = Math.floor(Math.max(0, capLeft) / BASE_BOX) * BASE_BOX;
        let qty = Math.min(baseNeed, Math.floor(baseFree / BASE_BOX) * BASE_BOX, allow, preUse + capUse);
        const ov = overrides[slotKey(date, g.market, g.sku, "BASE")];
        if (ov != null) qty = Math.min(Math.max(0, Math.round(Number(ov) / BASE_BOX) * BASE_BOX), qty);
        if (qty >= BASE_BOX) {
          const fromPre = Math.min(qty, pre);
          lines.push({ key: slotKey(date, g.market, g.sku, "BASE"), market: g.market, sku: g.sku,
            name: g.name, kind: "BASE", baseColor: g.baseColor, units: qty, boxes: qty / BASE_BOX,
            done: false, edited: ov != null, preApplied: fromPre > 0, due: bi.due, late: bi.due < date });
          preLeft[g.pk] = pre - fromPre;
          capLeft -= (qty - fromPre);
          appliedPlanned += (qty - fromPre);
          used[g.baseSku] = (used[g.baseSku] || 0) + qty;
          bi.need -= qty; mktBase[g.pk] += qty; planned += qty;
        }
      }

      // ── LID: only as many as the market has bare bases for (including the
      //    ones just sent), so lids never run ahead either ───────────────────
      if (lidNeed > 0) {
        const bare = Math.max(0, mktBase[g.pk] - mktLid[g.pk]);
        let qty = Math.min(lidCan, Math.floor(bare / LID_BOX) * LID_BOX);
        const ov = overrides[slotKey(date, g.market, g.sku, "LID")];
        if (ov != null) qty = Math.min(Math.max(0, Math.round(Number(ov) / LID_BOX) * LID_BOX), qty);
        if (qty >= LID_BOX) {
          lines.push({ key: slotKey(date, g.market, g.sku, "LID"), market: g.market, sku: g.sku,
            name: g.name, kind: "LID", baseColor: g.baseColor, units: qty, boxes: qty / LID_BOX,
            done: false, edited: ov != null, preApplied: false, due: li.due, late: li.due < date });
          used[g.sku] = (used[g.sku] || 0) + qty;
          li.need -= qty; mktLid[g.pk] += qty; planned += qty;
        }
      }
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
