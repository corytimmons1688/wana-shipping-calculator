// MarketOrdersTab.jsx — everything that flows between Calyx and the markets,
// in one place: what they ordered (Purchase Orders) and what we sent
// (Shipment Log). Both read the same shipment_log row that the NetSuite sync
// cron writes, so they load once here and share it.

import { useState, useEffect } from "react";
import { T } from "../utils/theme";
import PurchaseOrdersView from "./PurchaseOrdersView";
import ShipmentLogTab from "./ShipmentLogTab";

const SUPABASE_URL = "https://fxdyiurjioesdmedmgzu.supabase.co";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4ZHlpdXJqaW9lc2RtZWRtZ3p1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzIzOTYsImV4cCI6MjA4ODMwODM5Nn0.5ueK5iXQ35oThb02ClX3iErPwYR4tPih9GtBAmhDQYk";

export default function MarketOrdersTab() {
  const [view, setView] = useState(() => {
    try { return localStorage.getItem("wana.orders.view") || "pos"; } catch { return "pos"; }
  });
  const [ns, setNs] = useState({ loading: true, salesOrders: [], shipments: [], at: null, err: null });

  const load = () => {
    setNs((p) => ({ ...p, loading: true }));
    fetch(`${SUPABASE_URL}/rest/v1/shipment_log?id=eq.1&select=data,updated_at`,
      { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } })
      .then((r) => r.json())
      .then((rows) => {
        const d = (rows[0] || {}).data || {};
        setNs({ loading: false, err: null, salesOrders: d.salesOrders || [],
          shipments: d.shipments || [], at: (rows[0] || {}).updated_at || null });
      })
      .catch((e) => setNs({ loading: false, salesOrders: [], shipments: [], at: null, err: String(e.message || e) }));
  };
  useEffect(() => { load(); }, []);

  const pick = (k) => { setView(k); try { localStorage.setItem("wana.orders.view", k); } catch { /* private mode */ } };
  const btn = (k, label) => (
    <button onClick={() => pick(k)} style={{
      padding: "4px 13px", borderRadius: 999, fontSize: 11, cursor: "pointer",
      fontWeight: view === k ? 700 : 400, fontFamily: "inherit",
      border: "1px solid " + (view === k ? T.AC : T.BD),
      background: view === k ? T.AC : "transparent",
      color: view === k ? "#fff" : T.T2,
    }}>{label}</button>
  );

  return (
    <div style={{ padding: "12px 18px" }}>
      <div style={{ display: "flex", gap: 7, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        {btn("pos", "Purchase Orders")}
        {btn("shiplog", "Shipment Log")}
        <span style={{ marginLeft: "auto", fontSize: 9, color: T.T2 }}>
          orders and shipments from NetSuite
        </span>
      </div>

      {ns.err && (
        <div style={{ marginBottom: 10, fontSize: 10, color: "#991b1b", background: "#fee2e2",
          border: "1px solid #dc2626", borderRadius: 5, padding: "6px 10px" }}>Could not load: {ns.err}</div>
      )}

      {view === "pos" && (
        <PurchaseOrdersView salesOrders={ns.salesOrders} shipments={ns.shipments}
          syncedAt={ns.at} onRefresh={load} loading={ns.loading} />
      )}
      {view === "shiplog" && <ShipmentLogTab embedded />}
    </div>
  );
}
