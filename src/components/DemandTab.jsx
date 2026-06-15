import { useState, useMemo } from "react";
import { MO } from "../data/defaults";
import { marketMonthlyDemand, parseLocalDate } from "../utils/calc";
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
    const md = marketMonthlyDemand(mk);
    const annual = md.reduce((a, b) => a + b, 0);
    const det = mk.skuDetail;
    const hasSku = det && det.skus && det.skus.length > 0;

    const parentWeekly = new Array(NUM_WEEKS).fill(0);
    const parentGated = new Array(NUM_WEEKS).fill(false);
    for (let i = 0; i < NUM_WEEKS; i++) parentGated[i] = goLive == null || grid[i].mo + 1 < goLive;

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
          if (goLive == null || grid[gi].mo + 1 < goLive) gated[gi] = true;
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
          if (goLive == null || mo + 1 < goLive) gated[gi] = true;
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

  // Window to ACTIVE (post-go-live) demand only — pre-go-live cells are hidden,
  // so they no longer drag the window back to the start of the grid.
  let lo = Infinity, hi = -Infinity;
  for (const row of rows) row.weekly.forEach((v, i) => { if (v > 0 && !row.gated[i]) { if (i < lo) lo = i; if (i > hi) hi = i; } });
  if (lo === Infinity) { lo = 0; hi = Math.min(NUM_WEEKS - 1, 12); }
  return { rows, weeklyGLD, lo, hi };
}

export default function DemandTab({ sc, gld, annD, upd }) {
  var expandState = useState({});
  var expanded = expandState[0], setExpanded = expandState[1];
  var viewState = useState("weekly");
  var view = viewState[0], setView = viewState[1];

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

  // ── MONTHLY VIEW (unchanged behavior) ─────────────────────────────────────
  function renderMonthly() {
    return (
      <div style={{ overflowX: "auto" }}>
        <table style={tbl}><thead><tr>
          <th style={{ ...th, minWidth: 140 }}>Market</th>
          <th style={{ ...th, width: 72, textAlign: "center" }}>Go-Live</th>
          {MO.map(function(m, i) { return <th key={i} style={{ ...th, textAlign: "right", minWidth: 65 }}>{m}</th>; })}
          <th style={{ ...th, textAlign: "right", minWidth: 78 }}>Annual</th>
        </tr></thead><tbody>
          {sc.markets.map(function(mk, mi) {
            var hasSku = mk.skuDetail && mk.skuDetail.skus && mk.skuDetail.skus.length > 0;
            var md = marketMonthlyDemand(mk);
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
                  var isGL = mk.goLive === di + 1;
                  var isAct = mk.goLive != null && di + 1 >= mk.goLive;
                  if (hasSku) {
                    return <td key={di} title="Rolled up from SKU-level forecast — edit items in the weekly view or the Item Forecast tab" style={{ ...td, textAlign: "right", background: isGL ? "#bbf7d0" : undefined }}><span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: isGL ? T.GR : isAct ? T.TX : T.T2 }}>{fm(d)}</span></td>;
                  }
                  return <td key={di} style={{ ...td, textAlign: "right", background: isGL ? "#bbf7d0" : undefined }}><Ed value={d} onChange={function(v) { upd(function(s) { s.markets[mi].demand[di] = v; }); }} style={{ color: isGL ? T.GR : isAct ? T.TX : T.T2 }} /></td>;
                })}
                <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fm(ann)}</td>
              </tr>
            );

            var skuRows = [];
            if (hasSku && isExp) {
              var detail = mk.skuDetail;
              for (var si = 0; si < detail.skus.length; si++) {
                var sku = detail.skus[si];
                var skuMonthly;
                if (sku.monthly) {
                  skuMonthly = sku.monthly;
                } else {
                  skuMonthly = [0,0,0,0,0,0,0,0,0,0,0,0];
                  for (var wi = 0; wi < sku.weekly.length && wi < detail.weeks.length; wi++) {
                    var wkDate = new Date(detail.weeks[wi]);
                    var mo = wkDate.getMonth();
                    skuMonthly[mo] += sku.weekly[wi];
                  }
                }
                var skuAnn = 0;
                for (var smi = 0; smi < 12; smi++) skuAnn += skuMonthly[smi];

                var startMo = -1;
                if (sku.startMo != null) {
                  startMo = sku.startMo;
                } else if (sku.startWk != null && detail.weeks && sku.startWk < detail.weeks.length) {
                  startMo = new Date(detail.weeks[sku.startWk]).getMonth();
                }

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
                      return <td key={smi2} style={{ ...td, textAlign: "right", fontSize: 10, color: v > 0 ? T.T2 : T.T2+"30", fontStyle: "italic", background: isStart ? "#bbf7d0" : undefined }}>{v > 0 ? fm(Math.round(v)) : ""}</td>;
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
            {gld.map(function(d, i) { return <td key={i} style={{ ...td, textAlign: "right", fontWeight: 700, color: T.GR, borderTop: "2px solid " + T.GR }}>{fm(d)}</td>; })}
            <td style={{ ...td, textAlign: "right", fontWeight: 700, color: T.GR, borderTop: "2px solid " + T.GR }}>{fm(annD)}</td>
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
      const last = moGroups[moGroups.length - 1];
      if (last && last.mo === g.mo) last.span++;
      else moGroups.push({ mo: g.mo, span: 1, label: g.date.toLocaleDateString("en-US", { month: "long" }) });
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
                const ea = sr.editAt[i];
                if (!ea || sr.gated[i]) return blankCell(i);
                if (ea.kind === "weekly") {
                  const wi = ea.wi;
                  return editCell(i, (sc.markets[mi] && sc.markets[mi].skuDetail && sc.markets[mi].skuDetail.skus[sr.si] && sc.markets[mi].skuDetail.skus[sr.si].weekly || [])[wi], (v) => upd((s) => {
                    const sk = s.markets[mi] && s.markets[mi].skuDetail && s.markets[mi].skuDetail.skus[sr.si];
                    if (sk && Array.isArray(sk.weekly) && wi < sk.weekly.length) { const n = Number(v); sk.weekly[wi] = isNaN(n) ? 0 : n; }
                  }));
                }
                const mo = ea.mo;
                return editCell(i, (sc.markets[mi] && sc.markets[mi].skuDetail && sc.markets[mi].skuDetail.skus[sr.si] && sc.markets[mi].skuDetail.skus[sr.si].monthly || [])[mo], (v) => upd((s) => {
                  const sk = s.markets[mi] && s.markets[mi].skuDetail && s.markets[mi].skuDetail.skus[sr.si];
                  if (sk && Array.isArray(sk.monthly)) { const n = Number(v); sk.monthly[mo] = isNaN(n) ? 0 : n; }
                }));
              })}
              <td style={{ ...td, textAlign: "right", fontSize: 10, fontStyle: "italic", color: T.T2, borderLeft: "2px solid " + T.BD }}>{fm(Math.round(annual))}</td>
            </tr>
          );
        });
      }
    });

    return (
      <div style={{ overflowX: "auto", background: T.S1, border: "1px solid " + T.BD, borderRadius: 6 }}>
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
              <th style={{ ...th, top: 29, textAlign: "right", borderLeft: "2px solid " + T.BD }}>Annual</th>
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
        {[{ l: "Annual (All)", v: fm(allT), c: T.TX },{ l: "Go-Live Demand", v: fm(annD), c: T.GR },{ l: "Active Markets", v: sc.markets.filter(function(m){ return m.goLive != null; }).length + "/" + sc.markets.length, c: T.AC }].map(function(c2, i) {
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
