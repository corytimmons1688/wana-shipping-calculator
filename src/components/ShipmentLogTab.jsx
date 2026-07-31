// ShipmentLogTab.jsx — actual shipments to every market, pulled from NetSuite
// Item Fulfillments by the Vercel cron (api/sync-shipments) three times a day.
// Read-only: this is what left the dock, not a plan.

import { useState, useEffect, useMemo } from "react";
import { fm } from "../utils/format";
import { T, tbl, th, td } from "../utils/theme";

const SUPABASE_URL = "https://fxdyiurjioesdmedmgzu.supabase.co";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4ZHlpdXJqaW9lc2RtZWRtZ3p1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzIzOTYsImV4cCI6MjA4ODMwODM5Nn0.5ueK5iXQ35oThb02ClX3iErPwYR4tPih9GtBAmhDQYk";

const MARKET_NAME = { NJ: "New Jersey", NY: "New York", CO: "Colorado", MA: "Massachusetts",
  AZ: "Arizona", IL: "Illinois", MI: "Michigan", MO: "Missouri", MT: "Montana", NM: "New Mexico",
  OH: "Ohio", OK: "Oklahoma", CT: "Connecticut", MD: "Maryland", AR: "Arkansas", MS: "Mississippi" };

export default function ShipmentLogTab() {
  const [state, setState] = useState({ loading: true, error: null, data: null, updatedAt: null });
  const [mkt, setMkt] = useState("All");
  const [days, setDays] = useState(30);

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
    return isNaN(d) ? true : d >= cutoff;
  }), [rep, mkt, cutoff]);

  const totals = shipments.reduce((a, s) => {
    for (const l of s.lines) { a.units += l.quantity_shipped; a[l.component_type] = (a[l.component_type] || 0) + l.quantity_shipped; }
    return a;
  }, { units: 0 });

  const exportXlsx = async () => {
    const mod = await import("exceljs"); const ExcelJS = mod.default || mod;
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("Shipments");
    ws.columns = [{ width: 16 }, { width: 42 }, { width: 18 }, { width: 21 }, { width: 14 }, { width: 14 }, { width: 26 }];
    const h = ws.addRow(["SKU", "Flavor", "Quantity Shipped", "Total Shipped on PO", "PO Quantity", "Date Shipped", "Tracking"]);
    h.eachCell((c) => { c.font = { bold: true, size: 10, name: "Arial" }; });
    for (const s of shipments) for (const l of s.lines)
      ws.addRow([l.sku, l.flavor, l.quantity_shipped, l.total_shipped_on_po, l.po_quantity, s.ship_date, s.tracking_display]);
    const buf = await wb.xlsx.writeBuffer();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    a.download = `Wana-Shipments-${new Date().toISOString().slice(0, 10)}.xlsx`; a.click(); URL.revokeObjectURL(a.href);
  };

  const numCell = { ...td, textAlign: "right", fontFamily: "'JetBrains Mono',monospace", fontSize: 11 };
  return (
    <div style={{ padding: "14px 18px" }}>
      <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>Shipment log — actual fulfillments</span>
        <label style={{ fontSize: 10, color: T.T2, display: "flex", alignItems: "center", gap: 4 }}>
          Market
          <select value={mkt} onChange={(e) => setMkt(e.target.value)}
            style={{ background: T.S2, border: "1px solid " + T.BD, color: T.AC, borderRadius: 3, padding: "2px 6px", fontSize: 11, fontFamily: "inherit" }}>
            <option value="All">All markets</option>
            {(rep.markets || []).map((m) => <option key={m} value={m}>{MARKET_NAME[m] || m}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 10, color: T.T2, display: "flex", alignItems: "center", gap: 4 }}>
          Window
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}
            style={{ background: T.S2, border: "1px solid " + T.BD, color: T.AC, borderRadius: 3, padding: "2px 6px", fontSize: 11, fontFamily: "inherit" }}>
            {[7, 14, 30, 90, 3650].map((d) => <option key={d} value={d}>{d === 3650 ? "All time" : `Last ${d} days`}</option>)}
          </select>
        </label>
        <button onClick={load} style={{ padding: "3px 10px", borderRadius: 4, border: "1px solid " + T.BD, background: "transparent", color: T.T2, cursor: "pointer", fontSize: 10 }}>↻ Refresh</button>
        <button onClick={exportXlsx} style={{ padding: "3px 11px", borderRadius: 4, border: "1px solid " + T.GR, background: T.GR + "10", color: T.GR, cursor: "pointer", fontSize: 10, fontWeight: 700 }}>⬇ Excel</button>
        {[["Shipments", fm(shipments.length), T.AC], ["Units", fm(totals.units), T.TX],
          ["Lids", fm(totals.LID || 0), T.PU], ["Bases", fm(totals.BASE || 0), T.GR]].map(([l, v, c], i) => (
          <div key={i} style={{ background: T.S2, borderRadius: 5, padding: "3px 9px", border: "1px solid " + T.BD }}>
            <div style={{ color: T.T2, fontSize: 8, textTransform: "uppercase" }}>{l}</div>
            <div style={{ color: c, fontSize: 12.5, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{v}</div>
          </div>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 9, color: T.T2 }}>
          {state.loading ? "loading…" : state.updatedAt ? `synced ${new Date(state.updatedAt).toLocaleString()}` : "never synced"}
        </span>
      </div>

      {state.error && <div style={{ marginBottom: 10, fontSize: 10, color: "#991b1b", background: "#fee2e2", border: "1px solid #dc2626", borderRadius: 5, padding: "6px 10px" }}>Could not load: {state.error}</div>}
      {!state.loading && !shipments.length && !state.error && (
        <div style={{ fontSize: 11, color: T.T2, background: T.S1, border: "1px solid " + T.BD, borderRadius: 6, padding: 20, textAlign: "center" }}>
          Nothing shipped in this window. The sync runs at 6am, noon and 6pm — press Refresh after the next run.
        </div>
      )}

      <div style={{ background: T.S1, border: "1px solid " + T.BD, borderRadius: 6, overflow: "auto", maxHeight: "calc(100vh - 240px)" }}>
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
            {shipments.map((s) => [
              <tr key={"h" + s.shipment_key}>
                <td colSpan={6} style={{ ...td, background: T.S2, fontWeight: 700, fontSize: 10, position: "sticky", left: 0 }}>
                  {s.ship_date} · <span style={{ color: T.AC }}>{MARKET_NAME[s.market] || s.market || s.customer_name || "—"}</span>
                  <span style={{ marginLeft: 8, fontWeight: 400, color: T.T2 }}>{s.tracking_display}</span>
                  <span style={{ marginLeft: 8, fontWeight: 400, color: T.T2, fontSize: 9 }}>{(s.fulfillment_tranids || []).join(" + ")}</span>
                  {(s.reconciliation || []).some((r) => r.status === "mismatch") &&
                    <span title="Applied-label total does not match bases shipped" style={{ marginLeft: 6, fontSize: 8, color: "#92400e", border: "1px solid " + T.AM, borderRadius: 3, padding: "0 3px" }}>recon ⚠</span>}
                </td>
              </tr>,
              ...s.lines.map((l, i) => (
                <tr key={s.shipment_key + i}>
                  <td style={{ ...td, fontFamily: "'JetBrains Mono',monospace", fontSize: 10 }}>{l.sku}</td>
                  <td style={{ ...td }}>{l.flavor}</td>
                  <td style={numCell}>{fm(l.quantity_shipped)}</td>
                  <td style={{ ...numCell, color: T.T2 }}>{fm(l.total_shipped_on_po)}</td>
                  <td style={{ ...numCell, color: T.T2 }}>{l.po_quantity == null ? "—" : fm(l.po_quantity)}</td>
                  <td style={{ ...numCell, color: l.po_percent_complete >= 1 ? T.GR : T.T2 }}>
                    {l.po_percent_complete == null ? "—" : Math.round(l.po_percent_complete * 100) + "%"}
                  </td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>

      {(rep.warnings || []).length > 0 && (
        <div style={{ marginTop: 8, fontSize: 9, color: T.T2 }}>
          {rep.warnings.length} warning{rep.warnings.length > 1 ? "s" : ""} from the last sync — mostly missing tracking numbers, which fall back to the shipping method.
        </div>
      )}
    </div>
  );
}
