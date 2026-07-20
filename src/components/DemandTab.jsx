import { useState, useMemo } from "react";
import { MO } from "../data/defaults";
import { marketMonthlyDemand, parseLocalDate, marketActiveFrom } from "../utils/calc";
import { buildWeekGrid, weekIdxOf, NUM_WEEKS } from "../utils/inventory";
import { fm } from "../utils/format";
import { T, tbl, th, td } from "../utils/theme";
import { Ed } from "./Shared";

const stickyCol = { position: "sticky", left: 0, background: T.S1, zIndex: 1, minWidth: 156, maxWidth: 200, borderRight: "1px solid " + T.BD };

// Build every rendered weekly row + the local (self-consistent) go-live demand row.
// Detail markets place per-SKU values per week (weekly format) or in the month's
// first grid week (monthly format); aggregate markets place demand[mo] in the
// first grid week. The GLD row sums the gated parent/aggregate rows only.
function buildDemandModel(markets, grid, firstWkByMonth) {
  const rows = [];
  const weeklyGLD = new Array(NUM_WEEKS).fill(0);

  markets.forEach((mk, mi) => {
    const goLive = mk.goLive;
    const af = marketActiveFrom(mk);
    // Go-live gate is a 2026 launch month; weeks in a later year are always
    // active (a month-of-year test alone would wrongly re-hide early 2027).
    const gatedAt = (gi) => (af ? grid[gi].date < af : (goLive == null || (grid[gi].date.getFullYear() <= 2026 && grid[gi].mo + 1 < goLive)));
    const md = marketMonthlyDemand(mk);
    const annual = md.reduce((a, b) => a + b, 0);
    const det = mk.skuDetail;
    const hasSku = det && det.skus && det.skus.length > 0;

    const parentWeekly = new Array(NUM_WEEKS).fill(0);
    const parentGated = new Array(NUM_WEEKS).fill(false);
    for (let i = 0; i < NUM_WEEKS; i++) parentGated[i] = gatedAt(i);

    let kind = "aggregate";
    const skuRows = [];
    let editAt = null;

    if (hasSku && det.weeks) {
      kind = "detailWeekly";
      det.skus.forEach((sku, si) => {
        const weekly = new Array(NUM_WEEKS).fill(0);
        const gated = new Array(NUM_WEEKS).fill(false);
        const eAt = {};
        const wlen = Math.min((sku.weekly || []).length, det.weeks.length);
        for (let wi = 0; wi < wlen; wi++) {
          const gi = weekIdxOf(parseLocalDate(det.weeks[wi]), "round");
          if (gi < 0 || gi >= NUM_WEEKS) continue;
          const v = sku.weekly[wi] || 0;
          weekly[gi] += v;
          parentWeekly[gi] += v;
          if (eAt[gi] === undefined) eAt[gi] = { kind: "weekly", wi };
          if (gatedAt(gi)) gated[gi] = true;
        }
        skuRows.push({ si, name: sku.name, sku: sku.sku || "", cat: sku.cat || "—", fmt: "weekly", weekly, gated, editAt: eAt });
      });
    } else if (hasSku) {
      kind = "detailMonthly";
      det.skus.forEach((sku, si) => {
        const weekly = new Array(NUM_WEEKS).fill(0);
        const gated = new Array(NUM_WEEKS).fill(false);
        const eAt = {};
        const monthly = sku.monthly || [];
        for (let mo = 0; mo < 12; mo++) {
          const gi = firstWkByMonth[mo];
          if (gi == null) continue;
          const v = monthly[mo] || 0;
          weekly[gi] += v;
          parentWeekly[gi] += v;
          eAt[gi] = { kind: "monthly", mo };
          if (gatedAt(gi)) gated[gi] = true;
        }
        skuRows.push({ si, name: sku.name, sku: sku.sku || "", cat: sku.cat || "—", fmt: "monthly", weekly, gated, editAt: eAt });
      });
    } else {
      editAt = {};
      const dem = mk.demand || [];
      for (let mo = 0; mo < 12; mo++) {
        const gi = firstWkByMonth[mo];
        if (gi == null) continue;
        parentWeekly[gi] = dem[mo] || 0;
        editAt[gi] = { kind: "aggregate", mo };
      }
    }

    for (let i = 0; i < NUM_WEEKS; i++) if (!parentGated[i]) weeklyGLD[i] += parentWeekly[i];
    rows.push({ mi, name: mk.name, goLive, priority: mk.priority, kind, weekly: parentWeekly, gated: parentGated, annual, skuRows, editAt });
  });

  // Window START = first ACTIVE (post-go-live) week, so pre-go-live cells stay
  // hidden. Window END = the full planning horizon (end of 2027), NOT the last
  // week carrying data — so every future week through the horizon is visible
  // and editable for forward planning even before any demand is entered there.
  let lo = Infinity;
  for (const row of rows) row.weekly.forEach((v, i) => { if (v > 0 && !row.gated[i] && i < lo) lo = i; });
  if (lo === Infinity) lo = 0;
  const hi = NUM_WEEKS - 1;
  return { rows, weeklyGLD, lo, hi };
}

// Per-SKU monthly demand for ONE calendar year (12 buckets). Weekly-format SKUs
// bucket their weekly entries by the week's actual year+month (activeFrom-gated);
// legacy monthly-format SKUs represent the 2026 base year only. Used by the
// Monthly view so 2026 and 2027 stay separate — unlike the shared, year-blind
// marketMonthlyDemand() which the 2026 shipping/freight model depends on.
function skuMonthlyForYear(sku, det, af, year) {
  const out = new Array(12).fill(0);
  if (sku.weekly && det && det.weeks) {
    const n = Math.min(sku.weekly.length, det.weeks.length);
    for (let wi = 0; wi < n; wi++) {
      const v = sku.weekly[wi] || 0;
      if (v <= 0) continue;
      const wd = parseLocalDate(det.weeks[wi]);
      if (af && wd < af) continue;
      if (wd.getFullYear() === year) out[wd.getMonth()] += v;
    }
  } else if (sku.monthly && year === 2026) {
    for (let m = 0; m < 12; m++) out[m] += sku.monthly[m] || 0;
  }
  return out;
}

// Market monthly demand for one year = sum of its SKU rows (detail markets) or
// its aggregate demand template (aggregate markets, 2026 only).
function marketMonthlyForYear(mk, year) {
  const det = mk.skuDetail;
  const af = marketActiveFrom(mk);
  const out = new Array(12).fill(0);
  if (det && det.skus && det.skus.length) {
    for (const sku of det.skus) {
      const sm = skuMonthlyForYear(sku, det, af, year);
      for (let m = 0; m < 12; m++) out[m] += sm[m];
    }
  } else if (year === 2026) {
    const d = mk.demand || [];
    for (let m = 0; m < 12; m++) out[m] += d[m] || 0;
  }
  return out.map((v) => Math.round(v));
}

// Per-year Go-Live Demand: sums active markets' per-year monthly, mirroring
// calcGLD's activeFrom / goLive gating.
function gldForYear(markets, year) {
  const r = new Array(12).fill(0);
  for (const mk of markets) {
    const md = marketMonthlyForYear(mk, year);
    const af = marketActiveFrom(mk);
    for (let m = 0; m < 12; m++) {
      const active = af ? true : (mk.goLive != null && mk.goLive <= m + 1);
      if (active) r[m] += md[m];
    }
  }
  return r;
}

export default function DemandTab({ sc, gld, annD, upd }) {
  var expandState = useState({});
  var expanded = expandState[0], setExpanded = expandState[1];
  var viewState = useState("weekly");
  var view = viewState[0], setView = viewState[1];
  var yearState = useState(2026);
  var mYear = yearState[0], setMYear = yearState[1];

  function toggleExpand(mi) {
    setExpanded(function(prev) {
      var next = Object.assign({}, prev);
      next[mi] = !next[mi];
      return next;
    });
  }

  var allT = 0;
  for (var ai = 0; ai < sc.markets.length; ai++) {
    var aMd = marketMonthlyDemand(sc.markets[ai]);
    for (var aj = 0; aj < aMd.length; aj++) allT += aMd[aj];
  }

  const grid = useMemo(() => buildWeekGrid(), []);
  const firstWkByMonth = useMemo(() => {
    const m = {};
    for (const g of grid) if (m[g.mo] === undefined) m[g.mo] = g.idx;
    return m;
  }, [grid]);
  const todayIdx = useMemo(() => weekIdxOf(new Date(), "floor"), []);
  const model = useMemo(() => buildDemandModel(sc.markets, grid, firstWkByMonth), [sc.markets, grid, firstWkByMonth]);

  function chip(label, active, onClick) {
    return (
      <button key={label} onClick={onClick} style={{ padding: "5px 14px", borderRadius: 999, cursor: "pointer", fontSize: 11, fontFamily: "inherit", border: "1px solid " + (active ? T.AC : T.BD), background: active ? T.AC : "transparent", color: active ? "#fff" : T.T2, fontWeight: active ? 700 : 500 }}>{label}</button>
    );
  }

  function goLiveSelect(mi, goLive) {
    return (
      <select value={goLive || ""} onChange={function(e) { var v = e.target.value === "" ? null : Number(e.target.value); upd(function(s) { s.markets[mi].goLive = v; }); }} style={{ background: T.S2, border: "1px solid " + T.BD, color: T.AC, borderRadius: 3, padding: "1px 2px", fontSize: 11, fontFamily: "'JetBrains Mono',monospace", width: 56 }}>
        <option value="">{"—"}</option>
        {MO.map(function(m, i) { return <option key={i} value={i + 1}>{m}</option>; })}
      </select>
    );
  }

  // ── MONTHLY VIEW (per calendar year — 2026 or 2027) ───────────────────────
  function renderMonthly() {
    var yearGLD = gldForYear(sc.markets, mYear);
    var gldAnn = 0; for (var gi = 0; gi < 12; gi++) gldAnn += yearGLD[gi];
    var editable2026 = mYear === 2026; // aggregate demand template is 2026-only
    return (
      <div style={{ overflow: "auto", maxHeight: "calc(100vh - 270px)" }}>
        <table style={tbl}><thead>
          <tr>
            <th style={{ ...th, minWidth: 140 }}></th>
            <th style={{ ...th, width: 72 }}></th>
            <th colSpan={13} style={{ ...th, textAlign: "center", color: T.TX, borderLeft: "1px solid " + T.BD }}>{mYear}</th>
          </tr>
          <tr>
            <th style={{ ...th, minWidth: 140 }}>Market</th>
            <th style={{ ...th, width: 72, textAlign: "center" }}>Go-Live</th>
            {MO.map(function(m, i) { return <th key={i} style={{ ...th, textAlign: "right", minWidth: 65, borderLeft: i === 0 ? "1px solid " + T.BD : undefined }}>{m}</th>; })}
            <th style={{ ...th, textAlign: "right", minWidth: 78 }}>Annual</th>
          </tr>
        </thead><tbody>
          {sc.markets.map(function(mk, mi) {
            var hasSku = mk.skuDetail && mk.skuDetail.skus && mk.skuDetail.skus.length > 0;
            var af = marketActiveFrom(mk);
            var md = marketMonthlyForYear(mk, mYear);
            var ann = 0; for (var di = 0; di < md.length; di++) ann += md[di];
            var isExp = expanded[mi];

            var mainRow = (
              <tr key={mi} style={{ background: mi % 2 === 0 ? "transparent" : T.S2 }}>
                <td style={{ ...td, fontWeight: 600, cursor: hasSku ? "pointer" : "default" }} onClick={hasSku ? function() { toggleExpand(mi); } : undefined}>
                  {mk.priority && <span style={{ color: T.PU, marginRight: 4, fontSize: 7 }}>{"●"}</span>}
                  {hasSku && <span style={{ marginRight: 4, fontSize: 10, color: T.AC }}>{isExp ? "▼" : "▶"}</span>}
                  {mk.name}
                  {hasSku && <span style={{ marginLeft: 4, fontSize: 9, color: T.T2 }}>({mk.skuDetail.skus.length} SKUs)</span>}
                  {hasSku && <span title="Monthly values roll up automatically from the SKU-level forecast" style={{ marginLeft: 4, fontSize: 8, color: T.AC, border: "1px solid " + T.AC + "55", borderRadius: 3, padding: "0 3px" }}>Σ auto</span>}
                </td>
                <td style={{ ...td, textAlign: "center" }}>{goLiveSelect(mi, mk.goLive)}</td>
                {md.map(function(d, di) {
                  var isGL = editable2026 && mk.goLive === di + 1;
                  var isAct = mYear > 2026 ? (mk.goLive != null || af != null) : (mk.goLive != null && di + 1 >= mk.goLive);
                  var borderL = di === 0 ? "1px solid " + T.BD : undefined;
                  if (hasSku || !editable2026) {
                    return <td key={di} title={hasSku ? "Rolled up from SKU-level forecast — edit items in the weekly view or the Item Forecast tab" : "Aggregate markets carry a single 2026 demand template — switch to 2026 to edit, or add SKU-level detail to plan " + mYear} style={{ ...td, textAlign: "right", background: isGL ? "#bbf7d0" : undefined, borderLeft: borderL }}><span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: isGL ? T.GR : isAct ? T.TX : T.T2 }}>{d > 0 ? fm(d) : (hasSku || !editable2026) ? "—" : fm(d)}</span></td>;
                  }
                  return <td key={di} style={{ ...td, textAlign: "right", background: isGL ? "#bbf7d0" : undefined, borderLeft: borderL }}><Ed value={d} onChange={function(v) { upd(function(s) { s.markets[mi].demand[di] = v; }); }} style={{ color: isGL ? T.GR : isAct ? T.TX : T.T2 }} /></td>;
                })}
                <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fm(ann)}</td>
              </tr>
            );

            var skuRows = [];
            if (hasSku && isExp) {
              var detail = mk.skuDetail;
              for (var si = 0; si < detail.skus.length; si++) {
                var sku = detail.skus[si];
                var skuMonthly = skuMonthlyForYear(sku, detail, af, mYear);
                var skuAnn = 0;
                for (var smi = 0; smi < 12; smi++) skuAnn += skuMonthly[smi];

                var startMo = -1;
                if (skuAnn > 0) for (var fm2 = 0; fm2 < 12; fm2++) { if (skuMonthly[fm2] > 0) { startMo = fm2; break; } }

                skuRows.push(
                  <tr key={"sku-"+mi+"-"+si} style={{ background: si % 2 === 0 ? T.S2+"40" : T.S2+"80" }}>
                    <td style={{ ...td, paddingLeft: 28, fontSize: 11, color: T.T2, borderLeft: "3px solid "+T.AC+"40" }}>
                      <span style={{ color: T.AC, fontSize: 8, marginRight: 4 }}>{"○"}</span>
                      {sku.name}
                      {sku.sku && <span style={{ marginLeft: 4, fontSize: 9, color: T.T2+"90" }}>{sku.sku}</span>}
                    </td>
                    <td style={{ ...td, textAlign: "center", fontSize: 9, color: T.T2, borderLeft: "3px solid "+T.AC+"40" }}>{sku.cat}</td>
                    {skuMonthly.map(function(v, smi2) {
                      var isStart = smi2 === startMo;
                      return <td key={smi2} style={{ ...td, textAlign: "right", fontSize: 10, color: v > 0 ? T.T2 : T.T2+"30", fontStyle: "italic", background: isStart ? "#bbf7d0" : undefined, borderLeft: smi2 === 0 ? "1px solid " + T.BD : undefined }}>{v > 0 ? fm(Math.round(v)) : ""}</td>;
                    })}
                    <td style={{ ...td, textAlign: "right", fontSize: 10, fontStyle: "italic", color: T.T2 }}>{fm(Math.round(skuAnn))}</td>
                  </tr>
                );
              }
            }

            return [mainRow].concat(skuRows);
          })}
          <tr style={{ background: "#bbf7d040" }}>
            <td style={{ ...td, fontWeight: 700, color: T.GR, borderTop: "2px solid " + T.GR }}>GO-LIVE DEMAND</td>
            <td style={{ ...td, textAlign: "center", color: T.T2, fontSize: 8, borderTop: "2px solid " + T.GR }}>auto</td>
            {yearGLD.map(function(d, i) { return <td key={i} style={{ ...td, textAlign: "right", fontWeight: 700, color: T.GR, borderTop: "2px solid " + T.GR, borderLeft: i === 0 ? "1px solid " + T.BD : undefined }}>{d > 0 ? fm(d) : "—"}</td>; })}
            <td style={{ ...td, textAlign: "right", fontWeight: 700, color: T.GR, borderTop: "2px solid " + T.GR }}>{fm(gldAnn)}</td>
          </tr>
        </tbody></table>
      </div>
    );
  }

  // ── WEEKLY VIEW (line-level editable) ─────────────────────────────────────
  function renderWeekly() {
    const cols = grid.slice(model.lo, model.hi + 1);
    const moGroups = [];
    for (const g of cols) {
      const yr = g.date.getFullYear();
      const last = moGroups[moGroups.length - 1];
      if (last && last.mo === g.mo && last.yr === yr) last.span++;
      else moGroups.push({ mo: g.mo, yr, span: 1, label: g.date.toLocaleDateString("en-US", { month: "long", year: "numeric" }) });
    }
    const gldAnnual = model.weeklyGLD.reduce((a, b) => a + b, 0);

    const numCell = (i, extra) => ({ ...td, textAlign: "right", fontFamily: "'JetBrains Mono',monospace", fontSize: 11, background: i === todayIdx ? T.AC + "0A" : undefined, ...(extra || {}) });
    const blankCell = (i) => <td key={i} style={numCell(i, { color: T.BD })}>{"—"}</td>;

    const editCell = (i, value, onChange) => (
      <td key={i} style={numCell(i)}>
        <Ed value={Math.round(value || 0)} onChange={onChange} />
      </td>
    );
    // Pre-go-live cells are hidden entirely (kept in the DB, just not shown).
    const staticCell = (i, gated, value) => (
      (gated || !(value > 0)) ? <td key={i} style={numCell(i, { color: T.BD })}>{"—"}</td>
        : <td key={i} style={numCell(i, { color: T.TX })}>{fm(Math.round(value))}</td>
    );

    const weekHeader = (g) => (
      <th key={g.idx} style={{ ...th, top: 29, textAlign: "right", minWidth: 58, background: g.idx === todayIdx ? T.AC + "14" : T.S1 }}>
        {g.label}<br /><span style={{ fontWeight: 400, color: T.T2 }}>wk {g.idx + 11}</span>
      </th>
    );

    const rowsOut = [];
    model.rows.forEach((row) => {
      const mi = row.mi;
      const isDetail = row.kind === "detailWeekly" || row.kind === "detailMonthly";
      const isExp = expanded[mi];

      rowsOut.push(
        <tr key={"m" + mi}>
          <td style={{ ...stickyCol, ...td, fontWeight: 600, cursor: isDetail ? "pointer" : "default" }} onClick={isDetail ? () => toggleExpand(mi) : undefined}>
            {row.priority && <span style={{ color: T.PU, marginRight: 4, fontSize: 7 }}>{"●"}</span>}
            {isDetail && <span style={{ marginRight: 4, fontSize: 10, color: T.AC }}>{isExp ? "▼" : "▶"}</span>}
            {row.name}
            {isDetail && <span style={{ marginLeft: 4, fontSize: 9, color: T.T2 }}>({row.skuRows.length} SKUs)</span>}
            {isDetail && <span title="Rolled up from the SKU rows below" style={{ marginLeft: 4, fontSize: 8, color: T.AC, border: "1px solid " + T.AC + "55", borderRadius: 3, padding: "0 3px" }}>Σ auto</span>}
          </td>
          <td style={{ ...td, textAlign: "center" }}>{goLiveSelect(mi, row.goLive)}</td>
          {cols.map((g) => {
            const i = g.idx;
            if (row.kind === "aggregate") {
              const ea = row.editAt[i];
              if (!ea || row.gated[i]) return blankCell(i);
              const mo = ea.mo;
              return editCell(i, (sc.markets[mi] && sc.markets[mi].demand || [])[mo], (v) => upd((s) => {
                const m = s.markets[mi];
                if (m && Array.isArray(m.demand)) { const n = Number(v); m.demand[mo] = isNaN(n) ? 0 : n; }
              }));
            }
            return staticCell(i, row.gated[i], row.weekly[i]);
          })}
          <td style={{ ...td, textAlign: "right", fontWeight: 700, borderLeft: "2px solid " + T.BD }}>{fm(Math.round(row.annual))}</td>
        </tr>
      );

      if (isDetail && isExp) {
        row.skuRows.forEach((sr) => {
          const annual = sr.weekly.reduce((a, b) => a + b, 0);
          rowsOut.push(
            <tr key={"m" + mi + "s" + sr.si} style={{ background: sr.si % 2 === 0 ? T.S2 + "40" : T.S2 + "80" }}>
              <td style={{ ...stickyCol, ...td, paddingLeft: 26, fontSize: 11, color: T.T2, background: sr.si % 2 === 0 ? T.S2 : T.S2, borderLeft: "3px solid " + T.AC + "40" }}>
                <span style={{ color: T.AC, fontSize: 8, marginRight: 4 }}>{"○"}</span>
                {sr.name}
                {sr.sku && <span style={{ marginLeft: 4, fontSize: 9, color: T.T2 + "90", fontFamily: "'JetBrains Mono',monospace" }}>{sr.sku}</span>}
              </td>
              <td style={{ ...td, textAlign: "center", fontSize: 9, color: T.T2 }}>{sr.cat}</td>
              {cols.map((g) => {
                const i = g.idx;
                if (row.gated[i]) return blankCell(i); // before go-live / active start — hidden
                const ea = sr.editAt[i];
                if (ea && ea.kind === "weekly") {
                  const wi = ea.wi;
                  return editCell(i, (sc.markets[mi] && sc.markets[mi].skuDetail && sc.markets[mi].skuDetail.skus[sr.si] && sc.markets[mi].skuDetail.skus[sr.si].weekly || [])[wi], (v) => upd((s) => {
                    const sk = s.markets[mi] && s.markets[mi].skuDetail && s.markets[mi].skuDetail.skus[sr.si];
                    if (sk && Array.isArray(sk.weekly) && wi < sk.weekly.length) { const n = Number(v); sk.weekly[wi] = isNaN(n) ? 0 : n; }
                  }));
                }
                if (ea && ea.kind === "monthly") {
                  const mo = ea.mo;
                  return editCell(i, (sc.markets[mi] && sc.markets[mi].skuDetail && sc.markets[mi].skuDetail.skus[sr.si] && sc.markets[mi].skuDetail.skus[sr.si].monthly || [])[mo], (v) => upd((s) => {
                    const sk = s.markets[mi] && s.markets[mi].skuDetail && s.markets[mi].skuDetail.skus[sr.si];
                    if (sk && Array.isArray(sk.monthly)) { const n = Number(v); sk.monthly[mo] = isNaN(n) ? 0 : n; }
                  }));
                }
                // No data slot for this active week yet. Weekly-format markets:
                // editing adds the week to skuDetail (kept aligned across all SKUs).
                if (row.kind === "detailWeekly") {
                  return editCell(i, 0, (v) => upd((s) => {
                    const det = s.markets[mi] && s.markets[mi].skuDetail;
                    if (!det || !Array.isArray(det.weeks) || !Array.isArray(det.skus)) return;
                    let wi = det.weeks.indexOf(g.key);
                    if (wi === -1) {
                      wi = det.weeks.length;
                      det.weeks.push(g.key);
                      det.skus.forEach((sk) => { if (!Array.isArray(sk.weekly)) sk.weekly = []; while (sk.weekly.length <= wi) sk.weekly.push(0); });
                    }
                    const sk = det.skus[sr.si];
                    if (sk && Array.isArray(sk.weekly)) { const n = Number(v); sk.weekly[wi] = isNaN(n) ? 0 : n; }
                  }));
                }
                return blankCell(i); // monthly-format markets: only the month's first-week cell is editable
              })}
              <td style={{ ...td, textAlign: "right", fontSize: 10, fontStyle: "italic", color: T.T2, borderLeft: "2px solid " + T.BD }}>{fm(Math.round(annual))}</td>
            </tr>
          );
        });
      }
    });

    return (
      <div style={{ overflow: "auto", maxHeight: "calc(100vh - 270px)", background: T.S1, border: "1px solid " + T.BD, borderRadius: 6 }}>
        <table style={{ ...tbl, fontSize: 11 }}>
          <thead>
            <tr>
              <th style={{ ...th, ...stickyCol, zIndex: 3 }}></th>
              <th style={{ ...th, width: 72 }}></th>
              {moGroups.map((g, i) => <th key={i} colSpan={g.span} style={{ ...th, textAlign: "center", color: T.TX, borderLeft: "1px solid " + T.BD }}>{g.label}</th>)}
              <th style={{ ...th, borderLeft: "2px solid " + T.BD }}></th>
            </tr>
            <tr>
              <th style={{ ...th, ...stickyCol, top: 29, zIndex: 3 }}>Market</th>
              <th style={{ ...th, top: 29, width: 72, textAlign: "center" }}>Go-Live</th>
              {cols.map(weekHeader)}
              <th style={{ ...th, top: 29, textAlign: "right", borderLeft: "2px solid " + T.BD }} title="Row total across the full planning horizon (Mar 2026 – Dec 2027)">Total</th>
            </tr>
          </thead>
          <tbody>
            {rowsOut}
            <tr style={{ background: "#bbf7d040" }}>
              <td style={{ ...stickyCol, ...td, fontWeight: 700, color: T.GR, borderTop: "2px solid " + T.GR }}>GO-LIVE DEMAND</td>
              <td style={{ ...td, textAlign: "center", color: T.T2, fontSize: 8, borderTop: "2px solid " + T.GR }}>auto</td>
              {cols.map((g) => <td key={g.idx} style={{ ...td, textAlign: "right", fontWeight: 700, color: T.GR, fontFamily: "'JetBrains Mono',monospace", borderTop: "2px solid " + T.GR, background: g.idx === todayIdx ? T.AC + "14" : undefined }}>{model.weeklyGLD[g.idx] > 0 ? fm(Math.round(model.weeklyGLD[g.idx])) : "—"}</td>)}
              <td style={{ ...td, textAlign: "right", fontWeight: 700, color: T.GR, borderTop: "2px solid " + T.GR, borderLeft: "2px solid " + T.BD }}>{fm(Math.round(gldAnnual))}</td>
            </tr>
          </tbody>
        </table>
        <div style={{ padding: "6px 4px", fontSize: 9.5, color: T.T2 }}>
          Each cell is editable: detail-market SKU rows write per-week (or per-month for monthly-format markets); aggregate markets place each month's total in the month's first week. Demand before a market's go-live date is hidden here (still stored — switch to Monthly or change go-live to see it). Note: the Shipping Calculator spreads each month's aggregate demand evenly across its weeks, while this view shows it in the first week.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "14px 18px" }}>
      <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "inline-flex", gap: 4, background: T.S2, borderRadius: 999, padding: 3, border: "1px solid " + T.BD }}>
          {chip("Weekly", view === "weekly", function() { setView("weekly"); })}
          {chip("Monthly", view === "monthly", function() { setView("monthly"); })}
        </div>
        {view === "monthly" && (
          <div style={{ display: "inline-flex", gap: 4, background: T.S2, borderRadius: 999, padding: 3, border: "1px solid " + T.BD }}>
            {chip("2026", mYear === 2026, function() { setMYear(2026); })}
            {chip("2027", mYear === 2027, function() { setMYear(2027); })}
          </div>
        )}
        {[{ l: "Total (All)", v: fm(allT), c: T.TX },{ l: "Go-Live Demand", v: fm(annD), c: T.GR },{ l: "Active Markets", v: sc.markets.filter(function(m){ return m.goLive != null; }).length + "/" + sc.markets.length, c: T.AC }].map(function(c2, i) {
          return (
            <div key={i} style={{ background: T.S2, borderRadius: 7, padding: "8px 14px", border: "1px solid " + T.BD, minWidth: 120 }}>
              <div style={{ color: T.T2, fontSize: 9, textTransform: "uppercase", marginBottom: 2 }}>{c2.l}</div>
              <div style={{ color: c2.c, fontSize: 17, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{c2.v}</div>
            </div>
          );
        })}
      </div>
      {view === "monthly" ? renderMonthly() : renderWeekly()}
    </div>
  );
}
