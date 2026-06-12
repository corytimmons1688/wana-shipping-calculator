// ItemForecastTab — per-SKU weekly forecast grid.
// Macro view merges all detail markets (gated weeks excluded, matching
// calcWeeklyDemand); selecting a market shows its raw rows with muted
// pre-go-live cells, editable when the market stores weekly detail.

import { useState, useMemo } from "react";
import { calcSkuWeeklyForecast, weekIdxOf } from "../utils/inventory";
import { parseLocalDate } from "../utils/calc";
import { Ed } from "./Shared";
import { fm } from "../utils/format";
import { T, tbl, th, td } from "../utils/theme";

const CAT_ORDER = ["Optimal", "Optimals", "Quick", "Classic", "LTO", "HD", "Wave 1", "Wave 2", "Wave 3"];
const GROUP_COLORS = { Optimal: "#334155", Optimals: "#334155", Quick: "#0e7490", Classic: "#9a3412", default: T.T2 };

export default function ItemForecastTab({ sc, upd }) {
  const [sel, setSel] = useState(null); // null = macro (all markets)
  const fc = useMemo(() => calcSkuWeeklyForecast(sc.markets, { market: sel }), [sc.markets, sel]);
  const todayIdx = weekIdxOf(new Date(), "floor");
  const mkSel = sel ? sc.markets.find((m) => m.name === sel) : null;
  const isWeeklyMkt = !!(mkSel && mkSel.skuDetail && mkSel.skuDetail.weeks);

  // Map canonical grid index → this market's det.weeks index (for editing).
  const wiByGrid = useMemo(() => {
    if (!isWeeklyMkt) return null;
    const map = {};
    mkSel.skuDetail.weeks.forEach((w, wi) => {
      const gi = weekIdxOf(parseLocalDate(w), "round");
      if (gi >= 0 && map[gi] === undefined) map[gi] = wi;
    });
    return map;
  }, [mkSel, isWeeklyMkt]);

  // Visible week window = first..last week carrying any value.
  const { lo, hi } = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const r of fc.rows) r.weekly.forEach((v, i) => { if (v > 0) { if (i < lo) lo = i; if (i > hi) hi = i; } });
    if (lo === Infinity) { lo = Math.max(0, todayIdx); hi = Math.min(fc.grid.length - 1, lo + 12); }
    return { lo, hi };
  }, [fc, todayIdx]);
  const cols = fc.grid.slice(lo, hi + 1);

  const moGroups = useMemo(() => {
    const gs = [];
    for (const g of cols) {
      const last = gs[gs.length - 1];
      if (last && last.mo === g.mo) last.span++;
      else gs.push({ mo: g.mo, span: 1, label: g.date.toLocaleDateString("en-US", { month: "long" }) });
    }
    return gs;
  }, [cols]);

  const groups = useMemo(() => {
    const by = {};
    for (const r of fc.rows) { const c = r.cat || "—"; (by[c] = by[c] || []).push(r); }
    const names = Object.keys(by).sort((a, b) => {
      const ia = CAT_ORDER.indexOf(a), ib = CAT_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
    return names.map((n) => ({ name: n, rows: by[n].slice().sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [fc]);

  const activeVal = (r, i) => (r.gated[i] ? 0 : r.weekly[i]);
  const colSum = (rows, i) => rows.reduce((a, r) => a + activeVal(r, i), 0);
  const grandTotal = fc.rows.reduce((a, r) => a + r.total, 0);
  const gatedUnits = sel ? fc.rows.reduce((a, r) => a + r.weekly.reduce((x, v, i) => x + (r.gated[i] ? v : 0), 0), 0) : 0;

  const applyTotals = () => {
    if (!mkSel || mkSel.goLive == null) return;
    if (!window.confirm(`Overwrite ${sel}'s monthly Market Demand (months from go-live) with this item forecast's monthly sums?`)) return;
    upd((s) => {
      const mk = s.markets.find((m) => m.name === sel);
      if (!mk) return;
      for (let mo = 0; mo < 12; mo++) {
        if (mo + 1 < mk.goLive) continue;
        let sum = 0;
        fc.rows.forEach((r) => r.weekly.forEach((v, i) => { if (!r.gated[i] && fc.grid[i].mo === mo) sum += v; }));
        mk.demand[mo] = Math.round(sum);
      }
    });
  };

  const chip = (label, active, onClick, sub) => (
    <button key={label} onClick={onClick} style={{ padding: "4px 12px", borderRadius: 999, cursor: "pointer", fontSize: 11, fontFamily: "inherit",
      border: "1px solid " + (active ? T.AC : T.BD), background: active ? T.AC : "transparent", color: active ? "#fff" : T.T2, fontWeight: active ? 700 : 500 }}>
      {label}{sub && <span style={{ fontSize: 8, marginLeft: 4, opacity: 0.75 }}>{sub}</span>}
    </button>
  );

  const stickyCol = { position: "sticky", left: 0, background: T.S1, zIndex: 1, minWidth: 168, maxWidth: 200, borderRight: "1px solid " + T.BD };

  return (
    <div style={{ padding: "14px 18px" }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        {chip("All Markets (Macro)", sel === null, () => setSel(null))}
        {fc.marketsWithDetail.map((name) => {
          const mk = sc.markets.find((m) => m.name === name);
          const monthly = mk && mk.skuDetail && !mk.skuDetail.weeks;
          return chip(name, sel === name, () => setSel(name), monthly ? "monthly" : null);
        })}
        <span style={{ marginLeft: "auto", fontSize: 10, color: T.T2 }}>
          {fc.marketsWithDetail.length} of {sc.markets.length} markets have item detail
        </span>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <div style={{ background: T.S1, border: "1px solid " + T.BD, borderRadius: 6, padding: "6px 12px" }}>
          <span style={{ fontSize: 9, color: T.T2 }}>{sel ? sel + " 2026 forecast" : "Macro 2026 forecast"} </span>
          <span style={{ fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", fontSize: 13, color: T.AC }}>{fm(Math.round(grandTotal))}</span>
        </div>
        {sel && isWeeklyMkt && (
          <button onClick={applyTotals} style={{ padding: "5px 11px", borderRadius: 5, border: "1px solid " + T.AM, background: T.AM + "10", color: T.AM, cursor: "pointer", fontSize: 10, fontWeight: 600 }}>
            Apply totals to Market Demand
          </button>
        )}
        {sel && gatedUnits > 0 && (
          <span style={{ fontSize: 10, color: T.AM, background: T.AM + "12", border: "1px solid " + T.AM + "44", borderRadius: 5, padding: "4px 9px" }}>
            ⚠ {fm(Math.round(gatedUnits))} units fall before {sel}'s go-live month — shown struck-through, excluded from totals. Adjust go-live in Market Demand to include them.
          </span>
        )}
      </div>

      {fc.rows.length === 0 ? (
        <div style={{ padding: 30, textAlign: "center", color: T.T2, fontSize: 12, background: T.S1, border: "1px solid " + T.BD, borderRadius: 6 }}>
          No item-level forecast for this selection yet. Markets with detail: {fc.marketsWithDetail.join(", ") || "none"}.
        </div>
      ) : (
        <div style={{ overflowX: "auto", background: T.S1, border: "1px solid " + T.BD, borderRadius: 6 }}>
          <table style={{ ...tbl, fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ ...th, ...stickyCol, zIndex: 3 }}></th>
                {moGroups.map((g, i) => (
                  <th key={i} colSpan={g.span} style={{ ...th, textAlign: "center", color: T.TX, borderLeft: "1px solid " + T.BD }}>{g.label}</th>
                ))}
                <th style={{ ...th, textAlign: "right", borderLeft: "2px solid " + T.BD }}>2026</th>
              </tr>
              <tr>
                <th style={{ ...th, ...stickyCol, top: 29, zIndex: 3 }}>SKU / Item</th>
                {cols.map((g) => (
                  <th key={g.idx} style={{ ...th, top: 29, textAlign: "right", minWidth: 56, background: g.idx === todayIdx ? T.AC + "14" : T.S1 }}>
                    {g.label}<br /><span style={{ fontWeight: 400, color: T.T2 }}>wk {g.idx + 11}</span>
                  </th>
                ))}
                <th style={{ ...th, top: 29, textAlign: "right", borderLeft: "2px solid " + T.BD }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((grp) => (
                [
                  <tr key={"h-" + grp.name}>
                    <td colSpan={cols.length + 2} style={{ ...td, background: T.S2, fontWeight: 700, fontSize: 10, color: GROUP_COLORS[grp.name] || GROUP_COLORS.default, textTransform: "uppercase", letterSpacing: "0.5px" }}>{grp.name}</td>
                  </tr>,
                  ...grp.rows.map((r) => (
                    <tr key={`${grp.name}|${r.key}|${r.market}|${r.si}|${r.name}`}>
                      <td style={{ ...td, ...stickyCol }}>
                        <div style={{ fontWeight: 600, fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</div>
                        <div style={{ fontSize: 9, color: T.T2, fontFamily: "'JetBrains Mono',monospace" }}>{r.sku || "unmapped"}</div>
                      </td>
                      {cols.map((g) => {
                        const i = g.idx;
                        const raw = r.weekly[i];
                        const gated = r.gated[i] && raw > 0;
                        const wi = wiByGrid ? wiByGrid[i] : undefined;
                        const editable = sel && isWeeklyMkt && r.fmt === "weekly" && wi !== undefined;
                        const cellBg = i === todayIdx ? T.AC + "0A" : undefined;
                        if (editable) {
                          const det = mkSel.skuDetail.skus[r.si];
                          return (
                            <td key={i} style={{ ...td, textAlign: "right", background: cellBg, opacity: gated ? 0.45 : 1 }} title={gated ? "Before go-live — excluded from totals" : undefined}>
                              <span style={{ textDecoration: gated ? "line-through" : "none" }}>
                                <Ed value={Math.round(det.weekly[wi] || 0)} onChange={(v) => upd((s) => {
                                  const mk = s.markets.find((m) => m.name === sel);
                                  if (mk && mk.skuDetail && mk.skuDetail.skus[r.si]) mk.skuDetail.skus[r.si].weekly[wi] = Number(v) || 0;
                                })} />
                              </span>
                            </td>
                          );
                        }
                        return (
                          <td key={i} style={{ ...td, textAlign: "right", fontFamily: "'JetBrains Mono',monospace", background: cellBg,
                            color: raw > 0 ? (gated ? T.T2 + "88" : T.TX) : T.BD, textDecoration: gated ? "line-through" : "none" }}
                            title={gated ? "Before go-live — excluded from totals" : undefined}>
                            {raw > 0 ? fm(Math.round(raw)) : "—"}
                          </td>
                        );
                      })}
                      <td style={{ ...td, textAlign: "right", fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", borderLeft: "2px solid " + T.BD }}>{fm(Math.round(r.total))}</td>
                    </tr>
                  )),
                  <tr key={"s-" + grp.name}>
                    <td style={{ ...td, ...stickyCol, fontWeight: 700, fontSize: 10, color: T.T2 }}>{grp.name} subtotal</td>
                    {cols.map((g) => (
                      <td key={g.idx} style={{ ...td, textAlign: "right", fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: T.T2, background: T.S2 + "66" }}>
                        {colSum(grp.rows, g.idx) > 0 ? fm(Math.round(colSum(grp.rows, g.idx))) : "—"}
                      </td>
                    ))}
                    <td style={{ ...td, textAlign: "right", fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: T.T2, borderLeft: "2px solid " + T.BD, background: T.S2 + "66" }}>
                      {fm(Math.round(grp.rows.reduce((a, r) => a + r.total, 0)))}
                    </td>
                  </tr>,
                ]
              ))}
              <tr>
                <td style={{ ...td, ...stickyCol, fontWeight: 800, borderTop: "2px solid " + T.BD }}>TOTAL {sel ? "— " + sel : "— all markets"}</td>
                {cols.map((g) => (
                  <td key={g.idx} style={{ ...td, textAlign: "right", fontWeight: 800, fontFamily: "'JetBrains Mono',monospace", borderTop: "2px solid " + T.BD, background: g.idx === todayIdx ? T.AC + "14" : undefined }}>
                    {fm(Math.round(colSum(fc.rows, g.idx)))}
                  </td>
                ))}
                <td style={{ ...td, textAlign: "right", fontWeight: 800, fontFamily: "'JetBrains Mono',monospace", borderTop: "2px solid " + T.BD, borderLeft: "2px solid " + T.BD, color: T.AC }}>
                  {fm(Math.round(grandTotal))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 9.5, color: T.T2, flexWrap: "wrap" }}>
        <span><span style={{ display: "inline-block", width: 9, height: 9, background: T.AC + "22", border: "1px solid " + T.AC, verticalAlign: -1, marginRight: 4 }} />current week</span>
        {sel && isWeeklyMkt && <span>Click any cell to edit — saves automatically to this scenario</span>}
        {!sel && <span>Macro totals tie to the Shipping Calculator's weekly demand series (go-live gated)</span>}
        <span>Assorted items (Med + non-Med) consolidate under PL-WCB-490-00</span>
      </div>
    </div>
  );
}
