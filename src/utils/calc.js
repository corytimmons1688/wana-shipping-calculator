export function calcGLD(mkts) {
  const r = new Array(12).fill(0);
  for (let m = 0; m < 12; m++)
    for (let i = 0; i < mkts.length; i++)
      if (mkts[i].goLive != null && mkts[i].goLive <= m + 1) r[m] += mkts[i].demand[m];
  return r;
}

export function calcProd(molds) {
  const S = new Date("2026-03-09"), wks = [];
  let bC = 0, lC = 0, bPU = 0, lPU = 0;
  const bPD = new Date(molds.base.proto.avail), bMD = new Date(molds.base.prod.avail);
  const lPD = new Date(molds.lid.proto.avail), lMD = new Date(molds.lid.prod.avail);
  for (let w = 0; w < 43; w++) {
    const wk = new Date(S); wk.setDate(wk.getDate() + w * 7);
    let bW = 0, lW = 0;
    if (wk >= bPD && (molds.base.proto.life == null || bPU < molds.base.proto.life)) {
      const o = molds.base.proto.daily * molds.base.proto.qty * molds.base.proto.days;
      const c = molds.base.proto.life ? Math.min(o, molds.base.proto.life - bPU) : o;
      bW += c; bPU += c;
    }
    if (wk >= bMD) bW += molds.base.prod.daily * molds.base.prod.qty * molds.base.prod.days;
    if (wk >= lPD && (molds.lid.proto.life == null || lPU < molds.lid.proto.life)) {
      const o2 = molds.lid.proto.daily * molds.lid.proto.qty * molds.lid.proto.days;
      const c2 = molds.lid.proto.life ? Math.min(o2, molds.lid.proto.life - lPU) : o2;
      lW += c2; lPU += c2;
    }
    if (wk >= lMD) lW += molds.lid.prod.daily * molds.lid.prod.qty * molds.lid.prod.days;
    bC += bW; lC += lW;
    wks.push({ wk, bW, lW, bC, lC, ship: Math.min(bC, lC), tot: bW + lW,
      sur: Math.abs(bC - lC), surT: bC > lC ? "base" : bC < lC ? "lid" : null });
  }
  return wks;
}

export function calcCap(molds, pm, eq) {
  const bCost = (molds.base.proto.qty * molds.base.proto.cost) + (molds.base.prod.qty * molds.base.prod.cost);
  const lCost = (molds.lid.proto.qty * molds.lid.proto.cost) + (molds.lid.prod.qty * molds.lid.prod.cost);
  const mT = bCost + lCost;
  let pT = 0; for (const p of pm) pT += p.qty * p.cost;
  let eT = 0; for (const e of eq) eT += e.qty * e.cost;
  return { bCost, lCost, mT, pT, eT, grand: mT + pT + eT };
}

function prodAt(prod, date) {
  let best = null;
  for (const p of prod) { if (p.wk <= date) best = p; }
  return best ? { bC: best.bC, lC: best.lC } : { bC: 0, lC: 0 };
}

function shipDate(arriveBy, transitDays) {
  const d = new Date(arriveBy);
  d.setDate(d.getDate() - transitDays);
  return d;
}

// Container capacity in units, based on pallets
// Each container has N pallets. Pallets can be base or lid.
// Base: basePP units per pallet. Lid: lidPP units per pallet.
// We pick the pallet split that best matches the base/lid ratio needed.
function contCap(contSpec, pal) {
  const p = contSpec.pallets;
  const bPP = pal.basePP;  // 9,072
  const lPP = pal.lidPP;   // 30,720
  return { pallets: p, bPP, lPP, maxB: p * bPP, maxL: p * lPP };
}

// Given a container with N pallets, figure out optimal base/lid pallet split
// to ship as close to bWant bases and lWant lids as possible
function splitPallets(pallets, bPP, lPP, bWant, lWant) {
  let bestB = 0, bestL = 0, bestBP = 0, bestLP = 0, bestWaste = Infinity;
  for (let bp = 0; bp <= pallets; bp++) {
    const lp = pallets - bp;
    const bQ = Math.min(bp * bPP, bWant);
    const lQ = Math.min(lp * lPP, lWant);
    const waste = (bp * bPP - bQ) + (lp * lPP - lQ);
    const filled = bQ + lQ;
    if (filled > bestB + bestL || (filled === bestB + bestL && waste < bestWaste)) {
      bestB = bQ; bestL = lQ; bestBP = bp; bestLP = lp; bestWaste = waste;
    }
  }
  return { bQ: bestB, lQ: bestL, bPallets: bestBP, lPallets: bestLP };
}

// Check if a container is "full" (all pallets used with product)
function isFull(bQ, lQ, bPallets, lPallets, bPP, lPP) {
  // Full = every pallet has at least some product AND total pallets used = container pallets
  return (bPallets === 0 || bQ > 0) && (lPallets === 0 || lQ > 0);
}

export function optimize(mkts, molds, ship, par, cont, pal, airCost) {
  const gld = calcGLD(mkts), prod = calcProd(molds), res = [];
  let bS = 0, lS = 0;

  let oc = null, fb = null, ar = null;
  for (const s of ship) {
    if (s.method === "Standard Ocean") oc = s;
    if (s.method === "Fast Boat") fb = s;
    if (s.method === "Air") ar = s;
  }

  // ── PHASE 1: Calculate all demand deadlines ──
  const demands = [];
  for (let m = 0; m < 12; m++) {
    if (gld[m] <= 0) continue;
    const ms = new Date(2026, m, 1);
    const bD = new Date(ms); bD.setDate(bD.getDate() - par.baseLeadDays);
    const lD = new Date(ms); lD.setDate(lD.getDate() - par.lidLeadDays);
    demands.push({ mo: m, dem: gld[m], bDeadline: bD, lDeadline: lD, bNeed: gld[m], lNeed: gld[m] });
  }

  // ── PHASE 2: Maximize free Ocean (full containers only) ──
  for (const d of demands) {
    if (!oc) break;
    const oSD = shipDate(d.bDeadline, oc.transitDays);
    const avail = prodAt(prod, oSD);
    let aB = Math.max(0, avail.bC - bS);
    let aL = Math.max(0, avail.lC - lS);
    let cB = Math.min(aB, d.bNeed);
    let cL = Math.min(aL, d.lNeed);

    // Try 40' HC
    for (const ck of ["40HC", "20HC"]) {
      const cc = contCap(cont[ck], pal);
      while (cB + cL > 0) {
        const sp = splitPallets(cc.pallets, cc.bPP, cc.lPP, cB, cL);
        // Ocean requires full container: all pallets must have product
        if (sp.bQ + sp.lQ <= 0) break;
        // Check if it's truly full (no empty pallets)
        const usedPallets = sp.bPallets + sp.lPallets;
        const bFull = sp.bPallets === 0 || sp.bQ >= sp.bPallets * cc.bPP * 0.95;
        const lFull = sp.lPallets === 0 || sp.lQ >= sp.lPallets * cc.lPP * 0.95;
        if (!bFull || !lFull) break;
        if (sp.bQ + sp.lQ < cc.pallets * Math.min(cc.bPP, cc.lPP) * 0.5) break;

        res.push({ mo: d.mo, meth: "Standard Ocean", cn: cont[ck].label, bQ: sp.bQ, lQ: sp.lQ, tQ: sp.bQ + sp.lQ, cost: 0,
          bSd: new Date(oSD), lSd: new Date(oSD), bAr: new Date(d.bDeadline), lAr: new Date(d.lDeadline),
          bPal: sp.bPallets, lPal: sp.lPallets });
        bS += sp.bQ; lS += sp.lQ; d.bNeed -= sp.bQ; d.lNeed -= sp.lQ;
        cB -= sp.bQ; cL -= sp.lQ;
        aB -= sp.bQ; aL -= sp.lQ;
      }
    }
  }

  // ── PHASE 2b: Pre-ship future demand on free Ocean ──
  if (oc) {
    for (let di = 0; di < demands.length; di++) {
      const d = demands[di];
      const oSD = shipDate(d.bDeadline, oc.transitDays);
      const avail = prodAt(prod, oSD);
      let exB = Math.max(0, avail.bC - bS);
      let exL = Math.max(0, avail.lC - lS);

      for (let fj = di + 1; fj < demands.length && (exB > 0 || exL > 0); fj++) {
        const fd = demands[fj];
        if (fd.bNeed <= 0 && fd.lNeed <= 0) continue;
        let preB = Math.min(exB, fd.bNeed);
        let preL = Math.min(exL, fd.lNeed);

        for (const ck of ["40HC", "20HC"]) {
          const cc = contCap(cont[ck], pal);
          while (preB + preL > 0) {
            const sp = splitPallets(cc.pallets, cc.bPP, cc.lPP, preB, preL);
            if (sp.bQ + sp.lQ <= 0) break;
            const bFull = sp.bPallets === 0 || sp.bQ >= sp.bPallets * cc.bPP * 0.95;
            const lFull = sp.lPallets === 0 || sp.lQ >= sp.lPallets * cc.lPP * 0.95;
            if (!bFull || !lFull) break;

            res.push({ mo: fd.mo, meth: "Standard Ocean", cn: cont[ck].label, bQ: sp.bQ, lQ: sp.lQ, tQ: sp.bQ + sp.lQ, cost: 0,
              bSd: new Date(oSD), lSd: new Date(oSD), bAr: new Date(d.bDeadline), lAr: new Date(d.lDeadline),
              preShip: true, bPal: sp.bPallets, lPal: sp.lPallets });
            bS += sp.bQ; lS += sp.lQ; fd.bNeed -= sp.bQ; fd.lNeed -= sp.lQ;
            exB -= sp.bQ; exL -= sp.lQ; preB -= sp.bQ; preL -= sp.lQ;
          }
        }
      }
    }
  }

  // ── PHASE 3: Fast Boat with separate base/lid ship dates ──
  if (fb) {
    for (const d of demands) {
      if (d.bNeed <= 0 && d.lNeed <= 0) continue;

      const bSD = shipDate(d.bDeadline, fb.transitDays);
      const lSD = shipDate(d.lDeadline, fb.transitDays);

      const bAv = prodAt(prod, bSD);
      const lAv = prodAt(prod, lSD);

      let canB = Math.min(Math.max(0, bAv.bC - bS), d.bNeed);
      let canL = Math.min(Math.max(0, lAv.lC - lS), d.lNeed);

      // Combined: use base ship date for both
      const combAvailL = Math.min(Math.max(0, bAv.lC - lS), d.lNeed);

      // Cost comparison: separate vs combined
      function fbCost(bQ, lQ) {
        let cost = 0, rem = bQ + lQ;
        while (rem > 0) {
          // Check which container fits better
          const c40 = contCap(cont["40HC"], pal);
          const c20 = contCap(cont["20HC"], pal);
          if (rem > c20.pallets * Math.max(c20.bPP, c20.lPP)) {
            cost += cont["40HC"].cost; rem -= c40.maxB; // rough
          } else {
            cost += cont["20HC"].cost; rem = 0;
          }
        }
        return cost;
      }

      const combAirB = Math.max(0, d.bNeed - canB);
      const combAirL = Math.max(0, d.lNeed - combAvailL);
      const sepAirB = Math.max(0, d.bNeed - canB);
      const sepAirL = Math.max(0, d.lNeed - canL);

      const combAirCost = combAirB * airCost.base + combAirL * airCost.lid;
      const sepAirCost = sepAirB * airCost.base + sepAirL * airCost.lid;

      const useSep = canL > combAvailL && sepAirCost < combAirCost;

      if (useSep) {
        // Ship bases separately
        let remB = canB;
        for (const ck of ["40HC", "20HC"]) {
          const cc = contCap(cont[ck], pal);
          while (remB > 0) {
            const bPal = Math.min(cc.pallets, Math.ceil(remB / cc.bPP));
            const bQ = Math.min(bPal * cc.bPP, remB);
            if (bQ <= 0) break;
            res.push({ mo: d.mo, meth: "Fast Boat", cn: cont[ck].label, bQ, lQ: 0, tQ: bQ, cost: cont[ck].cost,
              bSd: new Date(bSD), lSd: new Date(bSD), bAr: new Date(d.bDeadline), lAr: new Date(d.bDeadline),
              bPal: bPal, lPal: 0 });
            bS += bQ; d.bNeed -= bQ; remB -= bQ;
          }
        }
        // Ship lids separately
        let remL = canL;
        for (const ck of ["40HC", "20HC"]) {
          const cc = contCap(cont[ck], pal);
          while (remL > 0) {
            const lPal = Math.min(cc.pallets, Math.ceil(remL / cc.lPP));
            const lQ = Math.min(lPal * cc.lPP, remL);
            if (lQ <= 0) break;
            res.push({ mo: d.mo, meth: "Fast Boat", cn: cont[ck].label, bQ: 0, lQ, tQ: lQ, cost: cont[ck].cost,
              bSd: new Date(lSD), lSd: new Date(lSD), bAr: new Date(d.lDeadline), lAr: new Date(d.lDeadline),
              bPal: 0, lPal: lPal });
            lS += lQ; d.lNeed -= lQ; remL -= lQ;
          }
        }
      } else {
        // Combined shipping
        let remB = canB, remL2 = combAvailL;
        for (const ck of ["40HC", "20HC"]) {
          const cc = contCap(cont[ck], pal);
          while (remB + remL2 > 0) {
            const sp = splitPallets(cc.pallets, cc.bPP, cc.lPP, remB, remL2);
            if (sp.bQ + sp.lQ <= 0) break;
            res.push({ mo: d.mo, meth: "Fast Boat", cn: cont[ck].label, bQ: sp.bQ, lQ: sp.lQ, tQ: sp.bQ + sp.lQ, cost: cont[ck].cost,
              bSd: new Date(bSD), lSd: new Date(bSD), bAr: new Date(d.bDeadline), lAr: new Date(d.lDeadline),
              bPal: sp.bPallets, lPal: sp.lPallets });
            bS += sp.bQ; lS += sp.lQ; d.bNeed -= sp.bQ; d.lNeed -= sp.lQ;
            remB -= sp.bQ; remL2 -= sp.lQ;
          }
        }
      }
    }
  }

  // ── PHASE 4: Air with split pricing ──
  if (ar) {
    for (const d of demands) {
      const bN = d.bNeed, lN = d.lNeed;
      if (bN <= 0 && lN <= 0) continue;
      const aSD = shipDate(d.bDeadline, ar.transitDays);
      const bQ = Math.ceil(Math.max(bN, 0) / par.rounding) * par.rounding;
      const lQ = Math.ceil(Math.max(lN, 0) / par.rounding) * par.rounding;
      if (bQ + lQ > 0) {
        const cost = (bQ * airCost.base) + (lQ * airCost.lid);
        res.push({ mo: d.mo, meth: "Air", cn: "Air", bQ, lQ, tQ: bQ + lQ, cost,
          bSd: new Date(aSD), lSd: new Date(aSD), bAr: new Date(d.bDeadline), lAr: new Date(d.lDeadline) });
        bS += bQ; lS += lQ; d.bNeed -= bQ; d.lNeed -= lQ;
      }
    }
  }

  // Fix arrival dates: actual arrival = ship date + transit days
  for (const sh of res) {
    const m = ship.find(s => s.method === sh.meth);
    if (m) {
      const arr = new Date(sh.bSd);
      arr.setDate(arr.getDate() + m.transitDays);
      sh.bAr = new Date(arr);
      sh.lAr = new Date(arr);
    }
  }

  // Sort by month then method priority
  const methOrder = { "Standard Ocean": 0, "Fast Boat": 1, "Air": 2 };
  res.sort((a, b) => a.mo - b.mo || methOrder[a.meth] - methOrder[b.meth]);
  return res;
}
