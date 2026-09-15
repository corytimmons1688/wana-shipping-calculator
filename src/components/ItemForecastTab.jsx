// ItemForecastTab — per-SKU weekly forecast grid.
// Macro view merges all detail markets (gated weeks excluded, matching
// calcWeeklyDemand); selecting a market shows its raw rows with muted
// pre-go-live cells, editable when the market stores weekly detail.

import { useState, useMemo, useEffect } from "react";
import { calcSkuWeeklyForecast, weekIdxOf , catLabel } from "../utils/inventory";
import { orderedBySku } from "../utils/soCoverage";
import { parseLocalDate } from "../utils/calc";
import { Ed } from "./Shared";
import { fm } from "../utils/format";
import { T, tbl, th, td } from "../utils/theme";

const SUPABASE_URL = "https://fxdyiurjioesdmedmgzu.supabase.co";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4ZHlpdXJqaW9lc2RtZWRtZ3p1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzIzOTYsImV4cCI6MjA4ODMwODM5Nn0.5ueK5iXQ35oThb02ClX3iErPwYR4tPih9GtBAmhDQYk";

// Covered cells are tinted rather than boxed: the grid is already dense with
// numbers and borders, and a wash reads as "this is fine" at a glance without
// competing with the figures. Short cells get the warmer tint, because those
// are the ones a market has to act on.
// A forecast row's identity. `key` alone is not unique — a market can carry the
// same lid SKU on several rows, which is how the assorted variants are stored.
const rowId = (r) => `${r.key}|${r.market}|${r.si}`;
const num = { ...td, textAlign: "right", fontFamily: "'JetBrains Mono',monospace" };
const OK_BG = "#dcfce7", OK_TX = "#166534";
const SHORT_BG = "#fef3c7", SHORT_TX = "#92400e";

const CAT_ORDER = ["Optimal", "Optimals", "Quick", "Classic", "LTO", "HD", "Wave 1", "Wave 2", "Wave 3"];
const GROUP_COLORS = { Optimal: "#334155", Optimals: "#334155", Quick: "#0e7490", Classic: "#9a3412", default: T.T2 };

export default function ItemForecastTab({ sc, upd }) {
  const [sel, setSel] = useState(null); // null = macro (all markets)
  // Sales orders from the same NetSuite snapshot the Market Orders tab reads,
  // so "ordered" means the same thing on both screens.
  const [so, setSo] = useState({ rows: [], at: null, loading: true, err: null });
  const [showCover, setShowCover] = useState(() => {
    try { return localStorage.getItem("wana.fc.cover") !== "0"; } catch { return true; }
  });
  useEffect(() => {
    fetch(`${SUPABASE_URL}/rest/v1/shipment_log?id=eq.1&select=data,updated_at`,
      { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } })
      .then((r) => r.json())
      .then((rows) => setSo({ loading: false, err: null,
        rows: ((rows[0] || {}).data || {}).salesOrders || [], at: (rows[0] || {}).updated_at || null }))
      .catch((e) => setSo({ rows: [], at: null, loading: false, err: String(e.message || e) }));
  }, []);
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
    for (const r of fc.rows) r.weekly.forEach((v, i) => { if (v > 0 && !r.gated[i]) { if (i < lo) lo = i; if (i > hi) hi = i; } });
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
    for (const r of fc.rows) { const c = catLabel(r.name, r.cat); (by[c] = by[c] || []).push(r); }
    const names = Object.keys(by).sort((a, b) => {
      const ia = CAT_ORDER.indexOf(a), ib = CAT_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
    return names.map((n) => ({ name: n, rows: by[n].slice().sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [fc]);

  // What each flavour has on order, and which of its weeks that reaches.
  //
  // Rows can share a SKU — Colorado lists six assorted variants against
  // PL-WCB-490-00 — and one order covers all of them between them. So the pool
  // is spent across the whole group week by week rather than row by row;
  // otherwise every variant claims the same order and all six read as covered.
  const cover = useMemo(() => {
    if (!showCover || !so.rows.length) return null;
    const ord = orderedBySku(so.rows, sel);
    const byKey = {};
    for (const r of fc.rows) (byKey[r.key] = byKey[r.key] || []).push(r);
    const out = {};
    for (const key of Object.keys(byKey)) {
      const rows = byKey[key];
      const e = ord[key] || { ordered: 0, orders: [] };
      let left = e.ordered;
      const weeks = rows.map(() => ({}));
      const used = rows.map(() => 0);
      const n = Math.max(...rows.map((r) => r.weekly.length));
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < rows.length; j++) {
          const r = rows[j];
          const q = Number(r.weekly[i]) || 0;
          if (q <= 0 || r.gated[i]) continue;
          const take = Math.min(left, q);
          left -= take; used[j] += take;
          weeks[j][i] = { kind: take >= q ? "covered" : take > 0 ? "partial" : "short", covered: take };
        }
      }
      rows.forEach((r, j) => {
        const fcTotal = r.weekly.reduce((a, v, i) => a + (r.gated[i] ? 0 : v), 0);
        out[rowId(r)] = { orders: e.orders, orderTotal: e.ordered, shared: rows.length > 1,
          used: used[j], short: Math.max(0, fcTotal - used[j]), surplus: left,
          fcTotal, weeks: weeks[j] };
      });
    }
    return out;
  }, [showCover, so.rows, sel, fc]);

  const shortTotal = cover
    ? Object.values(cover).reduce((a, c) => a + c.short, 0) : 0;

  const activeVal = (r, i) => (r.gated[i] ? 0 : r.weekly[i]);
  const colSum = (rows, i) => rows.reduce((a, r) => a + activeVal(r, i), 0);
  const grandTotal = fc.rows.reduce((a, r) => a + r.total, 0);
  const gatedUnits = sel ? fc.rows.reduce((a, r) => a + r.weekly.reduce((x, v, i) => x + (r.gated[i] ? v : 0), 0), 0) : 0;

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
        {sel && (
          <span style={{ fontSize: 10, color: T.T2, background: T.S2, border: "1px solid " + T.BD, borderRadius: 5, padding: "4px 9px" }}>
            Market Demand rolls up from these items automatically
          </span>
        )}
        <label title="Shades each week by whether a cube sales order already covers it — the same orders the Market Orders tab reads"
          style={{ fontSize: 10, color: T.T2, display: "flex", alignItems: "center", gap: 5, cursor: "pointer",
            background: T.S1, border: "1px solid " + T.BD, borderRadius: 6, padding: "5px 10px" }}>
          <input type="checkbox" checked={showCover} onChange={(e) => {
            setShowCover(e.target.checked);
            try { localStorage.setItem("wana.fc.cover", e.target.checked ? "1" : "0"); } catch { /* private mode */ }
          }} /> Show sales-order coverage
        </label>
        {showCover && so.loading && <span style={{ fontSize: 10, color: T.T2 }}>loading orders…</span>}
        {showCover && so.err && <span style={{ fontSize: 10, color: "#b91c1c" }}>orders unavailable: {so.err}</span>}
        {cover && shortTotal > 0 && (
          <span style={{ fontSize: 10, color: SHORT_TX, background: SHORT_BG, border: "1px solid " + T.AM + "55", borderRadius: 5, padding: "4px 9px" }}>
            {fm(Math.round(shortTotal))} units of forecast with no sales order behind them
          </span>
        )}
        {cover && shortTotal === 0 && so.rows.length > 0 && (
          <span style={{ fontSize: 10, color: OK_TX, background: OK_BG, border: "1px solid " + T.GR + "55", borderRadius: 5, padding: "4px 9px" }}>
            every forecast week is covered by an order
          </span>
        )}
        {sel && gatedUnits > 0 && (
          <span style={{ fontSize: 10, color: T.AM, background: T.AM + "12", border: "1px solid " + T.AM + "44", borderRadius: 5, padding: "4px 9px" }}>
            ⚠ {fm(Math.round(gatedUnits))} units fall before {sel}'s go-live month — hidden here (still stored), excluded from totals. Adjust go-live in Market Demand to include them.
          </span>
        )}
      </div>

      {fc.rows.length === 0 ? (
        <div style={{ padding: 30, textAlign: "center", color: T.T2, fontSize: 12, background: T.S1, border: "1px solid " + T.BD, borderRadius: 6 }}>
          No item-level forecast for this selection yet. Markets with detail: {fc.marketsWithDetail.join(", ") || "none"}.
        </div>
      ) : (
        <div style={{ overflow: "auto", maxHeight: "calc(100vh - 300px)", background: T.S1, border: "1px solid " + T.BD, borderRadius: 6 }}>
          <table style={{ ...tbl, fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ ...th, ...stickyCol, zIndex: 3 }}></th>
                {moGroups.map((g, i) => (
                  <th key={i} colSpan={g.span} style={{ ...th, textAlign: "center", color: T.TX, borderLeft: "1px solid " + T.BD }}>{g.label}</th>
                ))}
                <th style={{ ...th, textAlign: "right", borderLeft: "2px solid " + T.BD }}>2026</th>
                {cover && <th colSpan={2} style={{ ...th, textAlign: "center", borderLeft: "1px solid " + T.BD, color: T.TX }}>Sales orders</th>}
              </tr>
              <tr>
                <th style={{ ...th, ...stickyCol, top: 29, zIndex: 3 }}>SKU / Item</th>
                {cols.map((g) => (
                  <th key={g.idx} style={{ ...th, top: 29, textAlign: "right", minWidth: 56, background: g.idx === todayIdx ? T.AC + "14" : T.S1 }}>
                    {g.label}<br /><span style={{ fontWeight: 400, color: T.T2 }}>wk {g.idx + 11}</span>
                  </th>
                ))}
                <th style={{ ...th, top: 29, textAlign: "right", borderLeft: "2px solid " + T.BD }}>Total</th>
                {cover && <th style={{ ...th, top: 29, textAlign: "right", borderLeft: "1px solid " + T.BD }}>Ordered</th>}
                {cover && <th style={{ ...th, top: 29, textAlign: "right" }} title="Forecast with no sales order behind it — what this market still has to order">To order</th>}
              </tr>
            </thead>
            <tbody>
              {groups.map((grp) => (
                [
                  <tr key={"h-" + grp.name}>
                    <td colSpan={cols.length + 2 + (cover ? 2 : 0)} style={{ ...td, background: T.S2, fontWeight: 700, fontSize: 10, color: GROUP_COLORS[grp.name] || GROUP_COLORS.default, textTransform: "uppercase", letterSpacing: "0.5px" }}>{grp.name}</td>
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
                        // Coverage wins the cell background when it is on; the
                        // current week still reads from its tinted header.
                        const cv = cover && cover[rowId(r)] ? cover[rowId(r)].weeks[i] : null;
                        const cellBg = cv
                          ? (cv.kind === "short" ? SHORT_BG : cv.kind === "partial" ? SHORT_BG + "88" : OK_BG)
                          : (i === todayIdx ? T.AC + "0A" : undefined);
                        const cellTx = cv ? (cv.kind === "covered" ? OK_TX : SHORT_TX) : undefined;
                        const cellTitle = cv
                          ? (cv.kind === "covered" ? `Covered by ${(cover[rowId(r)].orders || []).map((o) => o.so).join(", ") || "an order"}`
                            : cv.kind === "partial" ? `Part-covered — ${fm(Math.round(cv.covered))} of ${fm(Math.round(raw))} has an order behind it`
                            : "No sales order covers this week — this is where a new order is needed")
                          : undefined;
                        // Demand before go-live is hidden (kept in the data, excluded from totals).
                        if (r.gated[i]) {
                          return <td key={i} style={{ ...td, textAlign: "right", fontFamily: "'JetBrains Mono',monospace", background: i === todayIdx ? T.AC + "0A" : undefined, color: T.BD }}>{"—"}</td>;
                        }
                        const wi = wiByGrid ? wiByGrid[i] : undefined;
                        const editable = sel && isWeeklyMkt && r.fmt === "weekly" && wi !== undefined;
                        if (editable) {
                          const det = mkSel.skuDetail.skus[r.si];
                          return (
                            <td key={i} title={cellTitle} style={{ ...td, textAlign: "right", background: cellBg }}>
                              <Ed value={Math.round(det.weekly[wi] || 0)} onChange={(v) => upd((s) => {
                                const mk = s.markets.find((m) => m.name === sel);
                                if (mk && mk.skuDetail && mk.skuDetail.skus[r.si]) mk.skuDetail.skus[r.si].weekly[wi] = Number(v) || 0;
                              })} />
                            </td>
                          );
                        }
                        return (
                          <td key={i} title={cellTitle} style={{ ...td, textAlign: "right", fontFamily: "'JetBrains Mono',monospace", background: cellBg, color: raw > 0 ? (cellTx || T.TX) : T.BD }}>
                            {raw > 0 ? fm(Math.round(raw)) : "—"}
                          </td>
                        );
                      })}
                      <td style={{ ...td, textAlign: "right", fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", borderLeft: "2px solid " + T.BD }}>{fm(Math.round(r.total))}</td>
                      {cover && (() => {
                        const c = cover[rowId(r)] || { used: 0, short: 0, orders: [], orderTotal: 0 };
                        const tip = (c.orders || []).length
                          ? (c.orders.map((o) => `${o.so} · ${fm(o.qty)}`).join("\n")
                             + (c.shared ? "\n(shared with the other variants on this SKU)" : "")
                             + (c.surplus > 0 ? `\n${fm(Math.round(c.surplus))} ordered beyond the forecast` : ""))
                          : "No cube sales order names this item";
                        return [
                          <td key="o" title={tip} style={{ ...num, borderLeft: "1px solid " + T.BD, color: c.used > 0 ? T.TX : T.BD }}>
                            {c.used > 0 ? fm(Math.round(c.used)) : "—"}
                          </td>,
                          <td key="g" style={{ ...num, fontWeight: 700, background: c.short > 0 ? SHORT_BG : undefined, color: c.short > 0 ? SHORT_TX : T.T2 }}>
                            {c.short > 0 ? fm(Math.round(c.short)) : "—"}
                          </td>,
                        ];
                      })()}
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
                    {cover && (() => {
                      const o = grp.rows.reduce((a, r) => a + ((cover[rowId(r)] || {}).used || 0), 0);
                      const sh = grp.rows.reduce((a, r) => a + ((cover[rowId(r)] || {}).short || 0), 0);
                      return [
                        <td key="o" style={{ ...num, fontWeight: 700, color: T.T2, borderLeft: "1px solid " + T.BD, background: T.S2 + "66" }}>{o > 0 ? fm(Math.round(o)) : "—"}</td>,
                        <td key="g" style={{ ...num, fontWeight: 700, color: sh > 0 ? SHORT_TX : T.T2, background: sh > 0 ? SHORT_BG : T.S2 + "66" }}>{sh > 0 ? fm(Math.round(sh)) : "—"}</td>,
                      ];
                    })()}
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
                {cover && (() => {
                  const o = fc.rows.reduce((a, r) => a + ((cover[rowId(r)] || {}).used || 0), 0);
                  return [
                    <td key="o" style={{ ...num, fontWeight: 800, borderTop: "2px solid " + T.BD, borderLeft: "1px solid " + T.BD }}>{fm(Math.round(o))}</td>,
                    <td key="g" style={{ ...num, fontWeight: 800, borderTop: "2px solid " + T.BD, color: shortTotal > 0 ? SHORT_TX : T.T2, background: shortTotal > 0 ? SHORT_BG : undefined }}>{shortTotal > 0 ? fm(Math.round(shortTotal)) : "—"}</td>,
                  ];
                })()}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 9.5, color: T.T2, flexWrap: "wrap" }}>
        <span><span style={{ display: "inline-block", width: 9, height: 9, background: T.AC + "22", border: "1px solid " + T.AC, verticalAlign: -1, marginRight: 4 }} />current week</span>
        {sel && isWeeklyMkt && <span>Click any cell to edit — saves automatically to this scenario</span>}
        {!sel && <span>Macro totals tie to the Shipping Calculator's weekly demand series (go-live gated)</span>}
        {cover && <span><span style={{ display: "inline-block", width: 9, height: 9, background: OK_BG, border: "1px solid " + T.GR, verticalAlign: -1, marginRight: 4 }} />covered by a sales order</span>}
        {cover && <span><span style={{ display: "inline-block", width: 9, height: 9, background: SHORT_BG, border: "1px solid " + T.AM, verticalAlign: -1, marginRight: 4 }} />no order yet — needs one</span>}
        {cover && <span>Orders fill the earliest weeks first, so shortfalls land on the weeks furthest out{so.at ? ` · orders synced ${new Date(so.at).toLocaleString()}` : ""}</span>}
        <span>Assorted items (Med + non-Med) consolidate under PL-WCB-490-00</span>
      </div>
    </div>
  );
}
