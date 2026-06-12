// inventory.js — pure calc utilities for Item Forecast + Inventory tabs.
// Reuses the app-wide Mar-9-2026 Monday week grid (43 weeks) and mirrors
// calcWeeklyDemand's goLive gating + monthly→weekly distribution rules exactly
// so the new views tie out with the Shipping Calculator's weekly demand series.

import { MASTER_SKUS, BASE_TYPES } from "../data/skuMaster";
import { parseLocalDate } from "./calc";

export const WEEK0 = new Date(2026, 2, 9);
export const NUM_WEEKS = 43;
export const ASSORTED_SKU = "PL-WCB-490-00";
const WK_MS = 7 * 86400000;

export function weekIdxOf(date, mode = "round") {
  const t = (date - WEEK0) / WK_MS;
  return mode === "floor" ? Math.floor(t) : mode === "ceil" ? Math.ceil(t) : Math.round(t);
}

export function weekKey(idx) {
  const d = new Date(WEEK0); d.setDate(d.getDate() + idx * 7);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function buildWeekGrid() {
  const grid = [];
  for (let i = 0; i < NUM_WEEKS; i++) {
    const date = new Date(WEEK0); date.setDate(date.getDate() + i * 7);
    grid.push({ idx: i, key: weekKey(i), date, mo: date.getMonth(),
      label: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) });
  }
  return grid;
}

// All assorted variants (Med + non-Med) consolidate to one SKU per Cory's direction.
export function isAssorted(name) {
  return /assort/i.test(name || "");
}

export function resolveSkuKey(skuField, name) {
  const s = (skuField || "").trim();
  if (s && s !== "#N/A") return s;
  if (isAssorted(name)) return ASSORTED_SKU;
  return "~" + (name || "unknown");
}

// Lookup display info for any row key (PL-/PB- code or "~name" unmapped).
export function skuInfo(key) {
  if (key === BASE_TYPES["Black Sparkle"].sku) return { name: "Black Base", cat: "Base", base: null, isBase: true };
  if (key === BASE_TYPES["White"].sku) return { name: "White Base", cat: "Base", base: null, isBase: true };
  const m = MASTER_SKUS.find((x) => x.sku === key);
  if (m) return { name: m.name, cat: m.cat, base: m.base, isBase: false };
  if (key.startsWith("~")) return { name: key.slice(1), cat: "Unmapped", base: "White", isBase: false };
  return { name: key, cat: "Unmapped", base: "White", isBase: false };
}

// Per-SKU weekly forecast on the canonical grid.
// opts.market: null → macro (rows merged per SKU across detail markets, gated weeks excluded);
//              "Name" → that market's rows with per-week gating masks for muted rendering.
// bySku always holds gated-EXCLUDED weekly sums (consumption-grade numbers).
export function calcSkuWeeklyForecast(mkts, opts = {}) {
  const market = opts.market || null;
  const grid = buildWeekGrid();
  const marketsWithDetail = mkts.filter((m) => m.skuDetail && m.skuDetail.skus && m.skuDetail.skus.length).map((m) => m.name);
  const bySku = {};
  const rows = [];
  const merged = {};

  for (const mk of mkts) {
    if (!mk.skuDetail || !mk.skuDetail.skus) continue;
    if (market && mk.name !== market) continue;
    const det = mk.skuDetail;
    const goLive = mk.goLive;
    det.skus.forEach((sku, si) => {
      const key = resolveSkuKey(sku.sku, sku.name);
      const weekly = new Array(NUM_WEEKS).fill(0);
      const gated = new Array(NUM_WEEKS).fill(false);
      if (det.weeks && sku.weekly) {
        for (let wi = 0; wi < sku.weekly.length && wi < det.weeks.length; wi++) {
          const v = sku.weekly[wi] || 0;
          if (v <= 0) continue;
          const d = parseLocalDate(det.weeks[wi]);
          const idx = weekIdxOf(d, "round");
          if (idx < 0 || idx >= NUM_WEEKS) continue;
          weekly[idx] += v;
          if (goLive == null || d.getMonth() + 1 < goLive) gated[idx] = true;
        }
      } else if (sku.monthly) {
        for (let mo = 0; mo < 12; mo++) {
          const v = sku.monthly[mo] || 0;
          if (v <= 0) continue;
          const mWeeks = grid.filter((g) => g.mo === mo);
          if (!mWeeks.length) continue;
          const g8 = goLive == null || mo + 1 < goLive;
          mWeeks.forEach((g) => { weekly[g.idx] += v / mWeeks.length; if (g8) gated[g.idx] = true; });
        }
      }
      const active = weekly.map((v, i) => (gated[i] ? 0 : v));
      const total = active.reduce((a, b) => a + b, 0);
      if (!bySku[key]) bySku[key] = new Array(NUM_WEEKS).fill(0);
      for (let i = 0; i < NUM_WEEKS; i++) bySku[key][i] += active[i];
      if (market) {
        rows.push({ key, sku: sku.sku || "", name: sku.name, cat: sku.cat || "—", market: mk.name, si,
          fmt: det.weeks ? "weekly" : "monthly", weekly, gated, total });
      } else {
        if (!merged[key]) {
          // Macro rows use the canonical master name/category, not first-seen market's
          const info = skuInfo(key);
          merged[key] = { key, sku: key.startsWith("~") ? "" : key,
            name: key.startsWith("~") ? sku.name : info.name,
            cat: key.startsWith("~") ? "Unmapped" : info.cat,
            market: "All", si: -1, fmt: "merged", weekly: new Array(NUM_WEEKS).fill(0), gated: new Array(NUM_WEEKS).fill(false), total: 0 };
        }
        for (let i = 0; i < NUM_WEEKS; i++) merged[key].weekly[i] += active[i];
        merged[key].total += total;
      }
    });
  }
  if (!market) rows.push(...Object.values(merged));
  return { grid, rows, bySku, marketsWithDetail };
}

// Derived weekly demand for the two base SKUs = sum of mapped lid demand.
export function calcBaseWeeklyDemand(bySku) {
  const out = {
    [BASE_TYPES["Black Sparkle"].sku]: new Array(NUM_WEEKS).fill(0),
    [BASE_TYPES["White"].sku]: new Array(NUM_WEEKS).fill(0),
  };
  for (const key of Object.keys(bySku)) {
    if (key.startsWith("PB-")) continue;
    const info = skuInfo(key);
    const baseSku = info.base === "Black Sparkle" ? BASE_TYPES["Black Sparkle"].sku : BASE_TYPES["White"].sku;
    for (let i = 0; i < NUM_WEEKS; i++) out[baseSku][i] += bySku[key][i];
  }
  return out;
}

// ETA: explicit sh.eta wins; else latest leg date (ship → trucking → rail).
// Null if received or undated.
export function shipmentEta(sh) {
  if (sh.received) return null;
  if (sh.eta) {
    const d = parseLocalDate(sh.eta);
    if (!isNaN(d)) return d;
  }
  const ds = [sh.shipDate, sh.truckDate, sh.railDate].filter(Boolean)
    .map(parseLocalDate).filter((d) => !isNaN(d));
  if (!ds.length) return null;
  return new Date(Math.max(...ds.map((d) => d.getTime())));
}

// Per-market active (go-live-gated) weekly demand per SKU key, including
// derived PB- base demand per market — feeds the MRP view's market rows.
export function calcSkuMarketWeekly(mkts) {
  const byKey = {};
  const markets = [];
  for (const mk of mkts) {
    if (!mk.skuDetail || !mk.skuDetail.skus || !mk.skuDetail.skus.length) continue;
    markets.push(mk.name);
    const fc = calcSkuWeeklyForecast(mkts, { market: mk.name });
    const merged = { ...fc.bySku };
    const baseD = calcBaseWeeklyDemand(fc.bySku);
    for (const bs of Object.keys(baseD)) merged[bs] = baseD[bs];
    for (const key of Object.keys(merged)) {
      if (!merged[key].some((v) => v > 0)) continue;
      if (!byKey[key]) byKey[key] = {};
      byKey[key][mk.name] = merged[key];
    }
  }
  return { markets, byKey };
}

// Core inventory state per SKU from actual flows + forecast projection.
export function calcSkuInventory(actuals, fc, today = new Date()) {
  const inbound = actuals.inbound || [];
  const outbound = actuals.outbound || [];
  const adjustments = actuals.adjustments || [];
  const poLines = actuals.poLines || [];
  const targets = actuals.targets || { ropMonths: 5.5, maxMonths: 8.5, rows: [] };
  const baseDemand = calcBaseWeeklyDemand(fc.bySku);
  const todayIdx = Math.min(NUM_WEEKS - 1, Math.max(0, weekIdxOf(today, "floor")));

  const keys = new Set([
    ...Object.keys(fc.bySku), ...Object.keys(baseDemand),
    ...inbound.flatMap((s) => (s.lines || []).map((l) => l.sku)),
    ...outbound.flatMap((s) => (s.lines || []).map((l) => l.sku)),
    ...poLines.map((p) => p.sku),
    ...(targets.rows || []).map((t) => t.sku),
    ...adjustments.map((a) => a.sku),
  ].filter(Boolean));

  const nameFromFc = {};
  for (const r of fc.rows) if (r.key) nameFromFc[r.key] = r.name;

  const perSku = {};
  const unscheduled = [];
  for (const sh of inbound) {
    if (!sh.received && !shipmentEta(sh)) unscheduled.push(sh.ref || "(no ref)");
  }

  let nextArrivalAll = null;
  for (const key of keys) {
    const demand = fc.bySku[key] || baseDemand[key] || new Array(NUM_WEEKS).fill(0);
    let received = 0, inTransit = 0, shippedOut = 0, adjPast = 0, poRecvDerived = 0;
    const arrivals = new Array(NUM_WEEKS).fill(0);
    const futureAdj = new Array(NUM_WEEKS).fill(0);
    let nextEta = null;

    for (const sh of inbound) {
      const qty = (sh.lines || []).filter((l) => l.sku === key).reduce((a, l) => a + (Number(l.qty) || 0), 0);
      if (!qty) continue;
      poRecvDerived += qty;
      const eta = shipmentEta(sh);
      const isRecv = sh.received === true || (eta && eta <= today);
      if (isRecv) { received += qty; continue; }
      if (!eta) continue; // unscheduled — excluded from projection, warned globally
      inTransit += qty;
      if (!nextEta || eta < nextEta) nextEta = eta;
      const idx = weekIdxOf(eta, "ceil");
      if (idx >= 0 && idx < NUM_WEEKS) arrivals[idx] += qty;
    }
    if (nextEta && (!nextArrivalAll || nextEta < nextArrivalAll)) nextArrivalAll = nextEta;

    for (const sh of outbound) {
      const qty = (sh.lines || []).filter((l) => l.sku === key).reduce((a, l) => a + (Number(l.qty) || 0), 0);
      if (!qty) continue;
      const d = sh.dateShipped ? parseLocalDate(sh.dateShipped) : null;
      if (!d || isNaN(d) || d <= today) shippedOut += qty;
    }

    for (const a of adjustments) {
      if (a.sku !== key) continue;
      const delta = Number(a.delta) || 0;
      const d = a.date ? parseLocalDate(a.date) : null;
      if (!d || isNaN(d) || d <= today) adjPast += delta;
      else {
        const idx = weekIdxOf(d, "floor");
        if (idx >= 0 && idx < NUM_WEEKS) futureAdj[idx] += delta;
      }
    }

    const onHand = received - shippedOut + adjPast;
    const proj = new Array(NUM_WEEKS).fill(null);
    proj[todayIdx] = onHand;
    let stockoutIdx = onHand < 0 ? todayIdx : null;
    for (let w = todayIdx + 1; w < NUM_WEEKS; w++) {
      proj[w] = proj[w - 1] + arrivals[w] - demand[w] + futureAdj[w];
      if (stockoutIdx == null && proj[w] < 0) stockoutIdx = w;
    }
    const fwd4wk = demand.slice(todayIdx + 1, todayIdx + 5).reduce((a, b) => a + b, 0);
    const fwd13 = demand.slice(todayIdx + 1, todayIdx + 14).reduce((a, b) => a + b, 0);
    const avgMoFwd = fwd13 / 3;
    const moh = avgMoFwd > 0 ? Math.max(0, onHand) / avgMoFwd : Infinity;
    const horizonMo = ((NUM_WEEKS - 1 - todayIdx) * 7) / 30.44;

    const po = poLines.find((p) => p.sku === key);
    const poQty = po ? Number(po.poQty) || 0 : 0;
    const poAdj = po ? Number(po.adjQty) || 0 : 0;
    const poRemaining = po ? Math.max(0, poQty - poRecvDerived - poAdj) : 0;
    const poOver = po && poRecvDerived + poAdj > poQty ? poRecvDerived + poAdj - poQty : 0;

    const t = (targets.rows || []).find((x) => x.sku === key);
    const rop = t ? (Number(t.monthly) || 0) * (targets.ropMonths || 0) : null;
    const tMax = t ? (Number(t.monthly) || 0) * (targets.maxMonths || 0) : null;
    const position = onHand + inTransit + poRemaining;
    let targetStatus = null, reorderQty = 0;
    if (t && rop != null) {
      if (position < rop) {
        const need = tMax - position;
        const inc = Number(t.increment) || 0;
        reorderQty = inc > 0 ? Math.ceil(need / inc) * inc : Math.ceil(need);
        targetStatus = "reorder";
      } else if (position > tMax) targetStatus = "over";
      else targetStatus = "ok";
    }

    const info = skuInfo(key);
    perSku[key] = {
      key, name: nameFromFc[key] || info.name, cat: info.cat, base: info.base, isBase: info.isBase,
      received, shippedOut, inTransit, nextEta, onHand, arrivals, proj, demand,
      stockoutIdx, stockoutDate: stockoutIdx != null ? buildWeekGrid()[stockoutIdx].date : null,
      fwd4wk, avgMoFwd, moh, mohCapped: isFinite(moh) && moh > horizonMo, horizonMo,
      poQty, poAdj, poRecvDerived, poRemaining, poOver, hasPo: !!po,
      monthlyTarget: t ? Number(t.monthly) || 0 : null, increment: t ? Number(t.increment) || 0 : null,
      rop, tMax, position, targetStatus, reorderQty,
    };
  }

  const vals = Object.values(perSku);
  const totals = {
    onHand: vals.reduce((a, v) => a + v.onHand, 0),
    inTransit: vals.reduce((a, v) => a + v.inTransit, 0),
    poRemaining: vals.reduce((a, v) => a + v.poRemaining, 0),
    atRisk: vals.filter((v) => v.avgMoFwd > 0 && v.moh < 1).length,
    nextArrival: nextArrivalAll,
    inTransitShipments: inbound.filter((s) => !s.received && shipmentEta(s)).length,
  };
  return { perSku, totals, unscheduled, todayIdx };
}
