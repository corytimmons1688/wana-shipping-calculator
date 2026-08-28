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
// How far ahead demand is pulled into the plan. Six months rather than the 45
// days this started at: at 45 the plan showed six business days of forward work
// and hid the rest, which is not a schedule anyone can order material against.
export const DUE_WINDOW_DAYS = 180;
// How far past TODAY the day grid must reach, whatever its start date is.
//
// The grid used to be `numDays` business days counted from `startDate`, so the
// forward view shrank by a day for every day that passed. With a Jul 1 start
// and 40 days it ran out on Aug 25 — by Aug 17 that left six business days of
// plan, and 396,900 units had no day to land on. Measuring from today instead
// means the horizon cannot rot: the grid always reaches this far ahead.
export const HORIZON_DAYS = 180;
// How much demand a single run covers, and how early it is allowed to start.
// A run serves one week of a market's demand from the first week it has to
// cover, and it does not take line time until it is within a week of that week.
// Collecting the whole 45-day window into one run instead is what turned
// Colorado Dreamberry into a single 49,140-unit batch — and because a run needs
// all of its material on hand before it starts, that invented a black-base
// shortage the MRP never showed (58,968 on hand against the 49,140 it was
// supposedly short of). Both halves matter: sizing runs without also holding
// them back just splits one oversized batch into two adjacent ones.
//
// One week rather than the two or three it is tempting to reach for, because a
// busy flavour already wants about a day of line time per week — Colorado
// Assorted runs ~18.5k against an 18k day. Any horizon past a week hands the
// one-SKU-one-day rule a run it cannot fit, and the day goes over: at three
// weeks the worst day plans 216% of capacity, at one week nothing exceeds 101%.
// The cost is changeovers — the floor sets up more labels more often.
export const COVERAGE_DAYS = 7;
// Once a line is this close to the date its market needs stock, a partial run
// beats a tidy one — run what there is material for rather than leave a market
// short while holding out for one clean batch.
export const PARTIAL_LEAD_DAYS = 10;

export const baseSkuFor = (lidSku) => (BASE_TYPES[skuInfo(lidSku).base] || BASE_TYPES["White"]).sku;
const iso = (d) => { const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const parse = (s) => { const p = String(s).split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); };
export const slotKey = (date, market, sku, kind) => `${date}|${market}|${sku}|${kind}`;
const minusDays = (isoStr, n) => { const d = parse(isoStr); d.setDate(d.getDate() - n); return iso(d); };
const plusDays = (isoStr, n) => { const d = parse(isoStr); d.setDate(d.getDate() + n); return iso(d); };
const upBox = (n, box) => (n <= 0 ? 0 : Math.ceil(n / box) * box);
const dnBox = (n, box) => (n <= 0 ? 0 : Math.floor(n / box) * box);

// At least `n` business days from `from`, and never stopping before `until`.
// The `until` half is what keeps the horizon measured from today rather than
// from the plan's start date, so a start date left in the past cannot eat the
// forward view. The cap is a guard against a bad date, not a planning limit.
function businessDays(from, n, until) {
  const out = [], d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  while (out.length < n || (until && out.length && out[out.length - 1] < until)) {
    const w = d.getDay(); if (w !== 0 && w !== 6) out.push(iso(d));
    d.setDate(d.getDate() + 1);
    if (out.length > 1000) break;
  }
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
  horizonDays = HORIZON_DAYS,
  coverageDays = COVERAGE_DAYS, defer = [], market = "All" }) {

  const todayStr = iso(today);
  const start = startDate || nextBusinessDay(today);
  const windowEndStr = iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + dueWindowDays));
  const av = availability(actuals);

  // What a market physically holds. Completed work is deliberately NOT added
  // here: retire() already takes those units off the outstanding need further
  // down, and adding them to the market's pool as well deducted every finished
  // line twice — once by satisfying demand at source, once by retiring it.
  //
  // New Jersey is how it surfaced. Mellow Melon carries 15,608 of demand and
  // one completed 6,804 line; the plan subtracted 13,608 and left 2,000, so
  // their September and November weeks simply were not there. Same arithmetic
  // on Bubbly Peach and Balanced Berry Guava. The market saw "NONE" against a
  // need the plan believed was already met.
  const held = (mk, sku, kind) => {
    const ms = (marketStock[mk] || {})[sku] || {};
    return Number(kind === "LID" ? ms.lid : ms.base) || 0;
  };

  // ── time-phased requirement per market + flavour ──────────────────────────
  // Demand is cut into runs rather than collected into one. A run opens on the
  // first week it has to cover and takes the weeks that fall within
  // `coverageDays` of it; the next week beyond that opens the next run. So a
  // flavour appears as several right-sized runs across the window instead of
  // one batch of everything the market will want in the next 45 days.
  const groups = [];
  // Lids the market already holds with no base under them, kept per market +
  // flavour rather than per run. Every run of a flavour draws on the same pool,
  // so holding it on the run would let each one claim the same lids and ship
  // early on stock that is not there twice.
  const bareLid = {};
  for (const sku of Object.keys(mw.byKey || {})) {
    if (sku.startsWith("PB-")) continue;
    for (const [mk, weekly] of Object.entries(mw.byKey[sku] || {})) {
      if (market !== "All" && mk !== market) continue;
      let lidPool = held(mk, sku, "LID"), basePool = held(mk, sku, "BASE");
      const pk = mk + "|" + sku;
      bareLid[pk] = Math.max(0, lidPool - basePool);
      const runs = [];
      let run = null;
      for (let w = 0; w < weekly.length; w++) {
        const q = Number(weekly[w]) || 0; if (q <= 0) continue;
        const d = (grid[w] && grid[w].key) || todayStr;
        if (d > windowEndStr) break;
        const uL = Math.min(lidPool, q); lidPool -= uL;
        const uB = Math.min(basePool, q); basePool -= uB;
        const nl = q - uL, nb = q - uB;
        if (nl <= 0 && nb <= 0) continue;          // held stock still covers it
        if (!run || d > plusDays(run.due, coverageDays - 1)) { run = { due: d, base: 0, lid: 0 }; runs.push(run); }
        run.base += nb; run.lid += nl;
      }
      const info = skuInfo(sku);
      for (let i = 0; i < runs.length; i++)
        groups.push({ pk, rk: pk + "|" + i, market: mk, sku, name: info.name,
          baseSku: baseSkuFor(sku), baseColor: info.base === "Black Sparkle" ? "Black" : "White",
          baseNeed: upBox(runs[i].base, BASE_BOX), lidNeed: upBox(runs[i].lid, LID_BOX),
          due: runs[i].due });
    }
  }
  groups.sort((a, b) => a.due.localeCompare(b.due) || a.market.localeCompare(b.market) || a.name.localeCompare(b.name));
  // Finished and pinned work retires the earliest outstanding run first and
  // overflows into the next. The runs of a flavour are tranches of one queue,
  // so units that clear more than the front run have to keep counting against
  // what follows — otherwise the planner re-schedules demand already covered,
  // and that phantom need evicts other markets from the day.
  const retire = (mk, sku, kind, units) => {
    const pk = mk + "|" + sku, field = kind === "BASE" ? "baseNeed" : "lidNeed";
    if (kind === "BASE") bareLid[pk] = Math.max(0, (bareLid[pk] || 0) - units);
    let left = units;
    for (const g of groups) {
      if (left <= 0) break;
      if (g.pk !== pk) continue;
      const t = Math.min(left, g[field]); g[field] -= t; left -= t;
    }
  };

  const dates = businessDays(parse(start), numDays, plusDays(todayStr, horizonDays));
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
  // The exact slots a pin owns, as (date, market, sku, kind). This used to be
  // keyed on market|sku|kind with no date, which meant pinning one agreed day
  // froze every OTHER run of that flavour too. New Jersey pinned its Aug 5 Go
  // Go Mango run and the next 16,610 units — out to December — silently stopped
  // being scheduled, while 218,862 white bases sat on the floor. A pin is an
  // agreement about one day, not a hold on the flavour.
  const pinSlots = new Set();
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
    retire(e.market, e.sku, e.kind, units);
  }
  for (const p of pinned) {
    if (market !== "All" && p.market !== market) continue;
    const k = slotKey(p.date, p.market, p.sku, p.kind);
    // A pinned line that has been ticked is already accounted for by the log
    // above. Reserve the slot so the planner leaves it alone, then contribute
    // only the side the tick has NOT completed. Counting both is what doubled
    // Mellow Melon to 13,608 and pushed Colorado off the day.
    const done = doneSlots.get(k);
    pinSlots.add(k);
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
      retire(p.market, p.sku, p.kind, units);
    }
  }

  // ── APPLICATION pass — capacity-bound, pulled as early as base stock allows
  const applyDone = {};                              // rk → { units, date }
  // Pinned units are already off the books — retire() subtracted them from the
  // earliest runs — so what is left here is genuinely outstanding work.
  const work = groups.filter((g) => g.baseNeed > 0);
  for (const date of dates) {
    let capLeft = capacity - (byDate[date] ? byDate[date].applied : 0);
    if (capLeft <= 0) continue;
    const started = new Set();      // flavours already on the line today
    for (const g of work) {
      if (g.baseNeed <= 0 || capLeft < BASE_BOX) continue;
      // A run waits until it is within its coverage horizon of the week it has
      // to serve. Without this the later runs simply pile onto the front of the
      // schedule and the plan is back to building a month of stock at once.
      if (date < minusDays(g.due, coverageDays)) continue;
      // One flavour, one run per day — two runs of the same flavour landing on
      // one day share a slot key, merge into a single row, and rebuild exactly
      // the oversized batch the runs were split to avoid.
      if (started.has(g.pk)) continue;
      // Never plan into a day a pin already owns: both would land on the same
      // slot key, merge, and quietly inflate the quantity the team agreed.
      if (pinSlots.has(slotKey(date, g.market, g.sku, "BASE"))) continue;
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
        const availB = dnBox(free, BASE_BOX);
        const fromCap = Math.max(0, want - dnBox(pre, BASE_BOX));
        // A requirement larger than a whole day can never fit one; give it the
        // earliest day it has material for and let that day run over, which the
        // capacity bar shows in red.
        const capOk = fromCap > capacity
          ? !(byDate[date] && byDate[date].applied > 0)
          : fromCap <= capLeft;
        if (availB >= want && capOk) {
          qty = want;                                        // clean single run
        } else if (date >= minusDays(g.due, PARTIAL_LEAD_DAYS)) {
          // Near or past the market's need date: run what we can rather than
          // leaving them short waiting for the rest of the material.
          qty = Math.min(want, availB, dnBox(pre, BASE_BOX) + dnBox(capLeft, BASE_BOX));
        } else {
          continue;                                          // hold for one clean run
        }
      }
      if (qty < BASE_BOX) continue;
      started.add(g.pk);
      const fromPre = Math.min(qty, pre);
      preLeft[g.pk] = pre - fromPre;
      capLeft -= (qty - fromPre);
      usedBase[g.baseSku] = (usedBase[g.baseSku] || 0) + qty;
      g.baseNeed -= qty;
      const d = D(date);
      put(d.apply, { key: slotKey(date, g.market, g.sku, "BASE"), market: g.market, sku: g.sku,
        name: g.name, kind: "BASE", baseColor: g.baseColor, units: qty, boxes: qty / BASE_BOX,
        done: false, edited: ov != null, preApplied: fromPre > 0, due: g.due, late: g.due < date,
        partial: g.baseNeed > 0 }, BASE_BOX);
      d.applied += (qty - fromPre);
      const a = applyDone[g.rk] || (applyDone[g.rk] = { units: 0, date });
      a.units += qty; a.date = date;
    }
  }

  // ── SHIPPING pass ────────────────────────────────────────────────────────
  // Bases that pair with lids already at the market go the next business day
  // after they're applied. Everything else waits for its lids to land, then
  // ships the following business day.
  const shipQueue = [];
  // A market can be told to stand back so another can be filled. This is an
  // exception the planner is handed, not one it works out: the run still
  // appears and still shows how late it is, it just stops claiming stock ahead
  // of the market it is yielding to. Entered for Dreamberry in Aug 2026 —
  // New York waits for its container so Colorado's 10,000 lands before Aug 17,
  // which the floor cannot do both of (12,840 lids against 14,742 asked for).
  const deferOf = (g) => defer.find((d) => d.market === g.market && d.sku === g.sku
    && (!d.from || g.due >= d.from) && (!d.to || g.due <= d.to));
  const yields = (g) => !!deferOf(g);
  // A yielding run stands back only as far as the exception says. It sorts as
  // though it were due at the end of the window, so it loses the floor to the
  // market being filled but still takes the next container in its turn —
  // sending it to the very back of the queue instead cost New York the Aug 27
  // boat and dropped it behind runs not due until mid-September.
  const shipOrder = [...groups].sort((a, b) => {
    const da = deferOf(a), db = deferOf(b);
    const ka = da ? (da.to || a.due) : a.due, kb = db ? (db.to || b.due) : b.due;
    return ka.localeCompare(kb) || (da ? 1 : 0) - (db ? 1 : 0);
  });
  for (const g of shipOrder) {
    const yielded = yields(g);
    const why = (txt) => (yielded ? `${txt} · held back by exception` : txt);
    const a = applyDone[g.rk];
    if (a && a.units > 0) {
      // Runs are walked in due order, so the earliest one gets first claim on
      // the bare lids and drains the pool for the rest.
      const early = Math.min(a.units, dnBox(bareLid[g.pk] || 0, BASE_BOX));
      if (early > 0) { bareLid[g.pk] -= early; shipQueue.push({ g, kind: "BASE", units: early, date: nextBizStr(a.date), reason: "lids already at market" }); }
      const rest = a.units - early;
      if (rest > 0) {
        const lr = av.readyBy(g.sku, rest + (usedLid[g.sku] || 0), a.date);
        if (lr) {
          const lidsBind = lr.date > a.date && !lr.fromStock;
          shipQueue.push({ g, kind: "BASE", units: rest, date: nextBizStr(lidsBind ? lr.date : a.date),
            reason: why(lidsBind ? `waits for ${lr.ref || "lids"} · ${shortDate(lr.date)}`
                                 : `application completes ${shortDate(a.date)}`) });
        }
      }
    }
    if (g.lidNeed > 0) {
      const need = g.lidNeed;
      const lr = av.readyBy(g.sku, need + (usedLid[g.sku] || 0), start);
      if (lr) {
        const applyD = applyDone[g.rk] ? applyDone[g.rk].date : start;
        const lidsBind = lr.date > applyD && !lr.fromStock;
        usedLid[g.sku] = (usedLid[g.sku] || 0) + need;
        shipQueue.push({ g, kind: "LID", units: need, date: nextBizStr(lidsBind ? lr.date : applyD),
          reason: why(lidsBind ? `waits for ${lr.ref || "lids"} · ${shortDate(lr.date)}`
                               : (applyDone[g.rk] ? "with its bases" : "lids in stock")) });
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
