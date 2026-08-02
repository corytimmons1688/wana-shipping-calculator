// ShipmentLogTab.jsx — actual shipments to every market, pulled from NetSuite
// Item Fulfillments by the Vercel cron (api/sync-shipments) twice a day.
// Read-only: this is what left the dock, not a plan.
//
// Organised the way the markets ask about shipments: by their own PO number.
// Each card is one physical shipment — PO and Calyx SO in the header, carrier
// tracking as a live link, SKU detail underneath.

import { useState, useEffect, useMemo } from "react";
import { fm } from "../utils/format";
import { T, tbl, th, td } from "../utils/theme";
import { TrackingLink } from "./PurchaseOrdersView";

const SUPABASE_URL = "https://fxdyiurjioesdmedmgzu.supabase.co";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4ZHlpdXJqaW9lc2RtZWRtZ3p1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzIzOTYsImV4cCI6MjA4ODMwODM5Nn0.5ueK5iXQ35oThb02ClX3iErPwYR4tPih9GtBAmhDQYk";

const MARKET_NAME = { NJ: "New Jersey", NY: "New York", CO: "Colorado", MA: "Massachusetts",
  AZ: "Arizona", IL: "Illinois", MI: "Michigan", MO: "Missouri", MT: "Montana", NM: "New Mexico",
  OH: "Ohio", OK: "Oklahoma", CT: "Connecticut", MD: "Maryland", AR: "Arkansas", MS: "Mississippi" };

const mono = { fontFamily: "'JetBrains Mono',monospace" };

export default function ShipmentLogTab() {
  const [state, setState] = useState({ loading: true, error: null, data: null, updatedAt: null });
  const [mkt, setMkt] = useState("All");
  const [days, setDays] = useState(30);
  const [q, setQ] = useState("");

  const load = async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/shipment_log?id=eq.1&select=data,updated_at`,
        { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
      if (!r.ok) throw new Error(`Supabase ${r.status}`);
      const rows = await r.json();
      setState({ loading: false, error: null, data: (rows[0] || {}).data || null, updatedAt: (rows[0] || {}).updated_at || null });
    } catch (e) { setState({ loading: false, error: String(e.message || e), data: null, updatedAt: null }); }
  };
  useEffect(() => { load(); }, []);

  const rep = state.data || { markets: [], shipments: [], warnings: [] };
  const cutoff = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - days); return d; }, [days]);
  const shipments = useMemo(() => (rep.shipments || []).filter((s) => {
    if (mkt !== "All" && s.market !== mkt) return false;
    const d = new Date(s.ship_date);
    if (!isNaN(d) && d < cutoff) return false;
    if (!q.trim()) return true;
    const t = q.trim().toLowerCase();
    return [...(s.customer_pos || []), ...(s.sales_orders || []), s.tracking_number, s.customer_name,
      ...(s.fulfillment_tranids || [])].some((v) => String(v || "").toLowerCase().includes(t));
  }), [rep, mkt, cutoff, q]);

  const totals = shipments.reduce((a, s) => {
    for (const l of s.lines) { a.units += l.quantity_shipped; a[l.component_type] = (a[l.component_type] || 0) + l.quantity_shipped; }
    return a;
  }, { units: 0 });

  const exportXlsx = async () => {
    const mod = await import("exceljs"); const ExcelJS = mod.default || mod;
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("Shipments");
    ws.columns = [{ width: 15 }, { width: 12 }, { width: 16 }, { width: 42 }, { width: 15 },
      { width: 18 }, { width: 13 }, { width: 13 }, { width: 24 }];
    const h = ws.addRow(["Customer PO", "Calyx SO", "SKU", "Flavor", "Qty shipped",
      "Total shipped on PO", "PO quantity", "Date shipped", "Tracking"]);
    h.eachCell((c) => { c.font = { bold: true, size: 10, name: "Arial" }; });
    for (const s of shipments) for (const l of s.lines)
      ws.addRow([l.customer_po || "", l.sales_order || "", l.sku, l.flavor, l.quantity_shipped,
        l.total_shipped_on_po, l.po_quantity, s.ship_date, s.tracking_display]);
    const buf = await wb.xlsx.writeBuffer();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    a.download = `Wana-Shipments-${new Date().toISOString().slice(0, 10)}.xlsx`; a.click(); URL.revokeObjectURL(a.href);
  };

  const numCell = { ...td, textAlign: "right", ...mono, fontSize: 11 };
  const chip = (l, v, c) => (
    <div key={l} style={{ background: T.S2, borderRadius: 5, padding: "3px 9px", border: "1px solid " + T.BD }}>
      <div style={{ color: T.T2, fontSize: 8, textTransform: "uppercase" }}>{l}</div>
      <div style={{ color: c, fontSize: 12.5, fontWeight: 700, ...mono }}>{v}</div>
    </div>
  );
  const meta = (l, v) => (
    <div>
      <div style={{ color: T.T2, fontSize: 8, textTransform: "uppercase", letterSpacing: .3 }}>{l}</div>
      <div style={{ fontSize: 10.5, color: T.TX }}>{v || "—"}</div>
    </div>
  );

  const sel = { background: T.S2, border: "1px solid " + T.BD, color: T.AC, borderRadius: 3, padding: "2px 6px", fontSize: 11, fontFamily: "inherit" };

  return (
    <div style={{ padding: "14px 18px" }}>
      <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>Shipment log — actual fulfillments</span>
        <label style={{ fontSize: 10, color: T.T2, display: "flex", alignItems: "center", gap: 4 }}>
          Market
          <select value={mkt} onChange={(e) => setMkt(e.target.value)} style={sel}>
            <option value="All">All markets</option>
            {(rep.markets || []).map((m) => <option key={m} value={m}>{MARKET_NAME[m] || m}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 10, color: T.T2, display: "flex", alignItems: "center", gap: 4 }}>
          Window
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={sel}>
            {[7, 14, 30, 90, 3650].map((d) => <option key={d} value={d}>{d === 3650 ? "All time" : `Last ${d} days`}</option>)}
          </select>
        </label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="PO, SO or tracking…"
          style={{ background: T.S2, border: "1px solid " + T.BD, color: T.TX, borderRadius: 3, padding: "3px 7px", fontSize: 10.5, fontFamily: "inherit", width: 150 }} />
        <button onClick={load} style={{ padding: "3px 10px", borderRadius: 4, border: "1px solid " + T.BD, background: "transparent", color: T.T2, cursor: "pointer", fontSize: 10 }}>↻ Refresh</button>
        <button onClick={exportXlsx} style={{ padding: "3px 11px", borderRadius: 4, border: "1px solid " + T.GR, background: T.GR + "10", color: T.GR, cursor: "pointer", fontSize: 10, fontWeight: 700 }}>⬇ Excel</button>
        {chip("Shipments", fm(shipments.length), T.AC)}
        {chip("Units", fm(totals.units), T.TX)}
        {chip("Lids", fm(totals.LID || 0), T.PU)}
        {chip("Bases", fm(totals.BASE || 0), T.GR)}
        <span style={{ marginLeft: "auto", fontSize: 9, color: T.T2 }}>
          {state.loading ? "loading…" : state.updatedAt ? `synced ${new Date(state.updatedAt).toLocaleString()}` : "never synced"}
        </span>
      </div>

      {state.error && <div style={{ marginBottom: 10, fontSize: 10, color: "#991b1b", background: "#fee2e2", border: "1px solid #dc2626", borderRadius: 5, padding: "6px 10px" }}>Could not load: {state.error}</div>}
      {!state.loading && !shipments.length && !state.error && (
        <div style={{ fontSize: 11, color: T.T2, background: T.S1, border: "1px solid " + T.BD, borderRadius: 6, padding: 20, textAlign: "center" }}>
          Nothing matches. The sync runs at 6am and noon — press Refresh after the next run.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: "calc(100vh - 210px)", overflow: "auto" }}>
        {shipments.map((s) => {
          const units = s.units != null ? s.units : s.lines.reduce((a, l) => a + l.quantity_shipped, 0);
          const pos = s.customer_pos || [];
          const mismatch = (s.reconciliation || []).some((r) => r.status === "mismatch");
          return (
            // flexShrink:0 — without it the scroll container squeezes each card
            // and the line table gets clipped behind the next header
            <div key={s.shipment_key} style={{ flexShrink: 0, background: T.S1, border: "1px solid " + T.BD, borderRadius: 6, overflow: "hidden" }}>
              {/* header — the customer's PO is the headline */}
              <div style={{ padding: "8px 12px", background: T.S2, borderBottom: "1px solid " + T.BD,
                display: "flex", gap: 18, alignItems: "baseline", flexWrap: "wrap" }}>
                <div style={{ ...mono, fontSize: 14, fontWeight: 700, color: T.AC }}>
                  {pos.length ? pos.join(" · ") : "— no customer PO —"}
                </div>
                {meta("Calyx SO", <span style={mono}>{(s.sales_orders || []).join(" · ")}</span>)}
                {meta("Customer", <span title={s.customer_name}>{MARKET_NAME[s.market] || s.market || ""}{s.market && s.customer_name ? " · " : ""}{s.customer_name || ""}</span>)}
                {meta("Shipped", s.ship_date)}
                {meta("Carrier", s.carrier)}
                {meta("Tracking", <TrackingLink carrier={s.carrier} number={s.tracking_number} size={10.5} />)}
                {meta("Units", <span style={{ ...mono, fontWeight: 700 }}>{fm(units)}</span>)}
                <div style={{ marginLeft: "auto", fontSize: 9, color: T.T2, ...mono }}>
                  {(s.fulfillment_tranids || []).join(" + ")}
                  {mismatch && <span title="Applied-label total does not match bases shipped"
                    style={{ marginLeft: 6, fontSize: 8, color: "#92400e", border: "1px solid " + T.AM, borderRadius: 3, padding: "0 3px" }}>recon ⚠</span>}
                </div>
              </div>
              <table style={{ ...tbl, fontSize: 11 }}>
                <thead><tr>
                  <th style={{ ...th, minWidth: 128 }}>SKU</th>
                  <th style={{ ...th, minWidth: 230 }}>Flavor</th>
                  <th style={{ ...th, textAlign: "right" }}>Qty shipped</th>
                  <th style={{ ...th, textAlign: "right" }}>Total on PO</th>
                  <th style={{ ...th, textAlign: "right" }}>PO qty</th>
                  <th style={{ ...th, textAlign: "right", minWidth: 56 }}>%</th>
                </tr></thead>
                <tbody>
                  {s.lines.map((l, i) => (
                    <tr key={i}>
                      <td style={{ ...td, ...mono, fontSize: 10 }}>{l.sku}</td>
                      <td style={{ ...td }}>{l.flavor}</td>
                      <td style={numCell}>{fm(l.quantity_shipped)}</td>
                      <td style={{ ...numCell, color: T.T2 }}>{fm(l.total_shipped_on_po)}</td>
                      <td style={{ ...numCell, color: T.T2 }}>{l.po_quantity == null ? "—" : fm(l.po_quantity)}</td>
                      <td style={{ ...numCell, color: l.po_percent_complete >= 1 ? T.GR : T.T2 }}>
                        {l.po_percent_complete == null ? "—" : Math.round(l.po_percent_complete * 100) + "%"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      {(rep.warnings || []).length > 0 && (
        <div style={{ marginTop: 8, fontSize: 9, color: T.T2 }}>
          {rep.warnings.length} warning{rep.warnings.length > 1 ? "s" : ""} from the last sync — mostly missing tracking numbers, which fall back to the shipping method.
        </div>
      )}
    </div>
  );
}
