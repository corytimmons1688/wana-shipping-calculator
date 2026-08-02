// PurchaseOrdersView.jsx — every open Wana Cube order, keyed on the customer's
// own PO number. Master list on the left, detail panel on the right: pick an
// order and you get its SKU/quantity lines and every shipment booked against it.
//
// Source is NetSuite, written into shipment_log by the sync cron: salesOrders
// for the header/line data, shipments for what has actually left the dock.

import { useState, useMemo } from "react";
import { fm } from "../utils/format";
import { T, tbl, th, td } from "../utils/theme";
import { trackingUrl } from "../utils/tracking";

const MARKET_NAME = { NJ: "New Jersey", NY: "New York", CO: "Colorado", MA: "Massachusetts",
  AZ: "Arizona", IL: "Illinois", MI: "Michigan", MO: "Missouri", MT: "Montana", NM: "New Mexico",
  OH: "Ohio", OK: "Oklahoma", CT: "Connecticut", MD: "Maryland", AR: "Arkansas", MS: "Mississippi" };

const num = { ...td, textAlign: "right", fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5 };
const mono = { fontFamily: "'JetBrains Mono',monospace" };

export function Bar({ pct, w = 54 }) {
  return (
    <div style={{ width: w, height: 6, background: T.BD, borderRadius: 3, overflow: "hidden", display: "inline-block", verticalAlign: "middle" }}>
      <div style={{ width: Math.min(100, pct) + "%", height: "100%", background: pct >= 100 ? T.GR : pct > 0 ? T.AC : "transparent" }} />
    </div>
  );
}

export function TrackingLink({ carrier, number, label, size = 10 }) {
  const url = trackingUrl(carrier, number);
  const text = label || number;
  if (!url) return <span style={{ color: T.T2, fontSize: size }}>{text || "—"}</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer" title={`Track ${number} — opens ${carrier || "carrier"} tracking`}
      style={{ ...mono, color: T.AC, fontSize: size, textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 2 }}
      onClick={(e) => e.stopPropagation()}>
      {text} ↗
    </a>
  );
}

// SuiteQL returns sales-order status as a single letter, not the label the
// NetSuite UI shows. Translate, and keep the raw code for anything unmapped.
const SO_STATUS = { A: "Pending approval", B: "Pending fulfillment", C: "Cancelled",
  D: "Partially fulfilled", E: "Pending billing / partially fulfilled",
  F: "Pending billing", G: "Billed", H: "Closed" };
const statusText = (s) => SO_STATUS[String(s || "").trim().toUpperCase()] || s || "";
// Nothing more will ship on these.
const CLOSED = new Set(["C", "G", "H"]);
const isClosed = (s) => CLOSED.has(String(s || "").trim().toUpperCase());

export default function PurchaseOrdersView({ salesOrders = [], shipments = [], syncedAt, onRefresh, loading }) {
  const [mkt, setMkt] = useState("All");
  const [q, setQ] = useState("");
  const [openOnly, setOpenOnly] = useState(true);
  const [sel, setSel] = useState(null);      // customer-PO key of the open order

  const markets = useMemo(() =>
    [...new Set(salesOrders.map((r) => r.market).filter(Boolean))].sort(), [salesOrders]);

  // One card per sales order. The customer PO is the label, but two SOs can
  // legitimately carry the same PO (lids and labels bill separately), so the
  // sales order number stays the key.
  const orders = useMemo(() => {
    const by = {};
    for (const r of salesOrders) {
      const o = by[r.so] || (by[r.so] = { so: r.so, po: r.custPo, customer: r.customer, market: r.market,
        status: r.status, orderDate: r.orderDate, dueDate: r.dueDate, memo: r.memo,
        terms: r.terms, shipMethod: r.shipMethod, lines: [], ordered: 0, shipped: 0 });
      o.lines.push(r); o.ordered += r.ordered; o.shipped += r.shipped;
    }
    return Object.values(by)
      .map((o) => ({ ...o, pct: o.ordered ? Math.round((o.shipped / o.ordered) * 100) : 0,
        open: !isClosed(o.status) && o.shipped < o.ordered }))
      .sort((a, b) => String(b.so).localeCompare(String(a.so), undefined, { numeric: true }));
  }, [salesOrders]);

  const list = useMemo(() => orders.filter((o) => {
    if (mkt !== "All" && o.market !== mkt) return false;
    if (openOnly && !o.open) return false;
    if (!q.trim()) return true;
    const s = q.trim().toLowerCase();
    return [o.po, o.so, o.customer].some((v) => String(v || "").toLowerCase().includes(s));
  }), [orders, mkt, openOnly, q]);

  const cur = useMemo(() => list.find((o) => o.so === sel) || null, [list, sel]);

  // Shipments tied to the selected order — matched on the sales order stamped
  // onto each shipped line, falling back to the customer PO for older syncs
  // that predate the sales_order field.
  const curShipments = useMemo(() => {
    if (!cur) return [];
    return shipments
      .map((s) => {
        const lines = (s.lines || []).filter((l) =>
          (l.sales_order && l.sales_order === cur.so) ||
          (!l.sales_order && cur.po && l.customer_po === cur.po));
        return lines.length ? { ...s, lines } : null;
      })
      .filter(Boolean);
  }, [cur, shipments]);

  // Whether the log has been synced since lines started carrying their SO —
  // tells an empty shipment list apart from a log that simply cannot link yet.
  const stamped = useMemo(() =>
    shipments.some((s) => (s.lines || []).some((l) => l.sales_order)), [shipments]);

  const tOrd = list.reduce((a, o) => a + o.ordered, 0);
  const tShp = list.reduce((a, o) => a + o.shipped, 0);

  const card = (l, v, c) => (
    <div key={l} style={{ background: T.S2, borderRadius: 5, padding: "3px 9px", border: "1px solid " + T.BD }}>
      <div style={{ color: T.T2, fontSize: 8, textTransform: "uppercase" }}>{l}</div>
      <div style={{ color: c, fontSize: 12.5, fontWeight: 700, ...mono }}>{v}</div>
    </div>
  );
  const field = (l, v) => (
    <div style={{ minWidth: 96 }}>
      <div style={{ color: T.T2, fontSize: 8, textTransform: "uppercase", letterSpacing: .3 }}>{l}</div>
      <div style={{ fontSize: 10.5, color: T.TX }}>{v || "—"}</div>
    </div>
  );

  return (
    <div style={{ background: T.S1, border: "1px solid " + T.BD, borderRadius: 6 }}>
      <div style={{ padding: "8px 12px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderBottom: "1px solid " + T.BD }}>
        <span style={{ fontSize: 11, fontWeight: 700 }}>Purchase orders — by customer PO</span>
        <label style={{ fontSize: 10, color: T.T2, display: "flex", alignItems: "center", gap: 4 }}>
          State
          <select value={mkt} onChange={(e) => { setMkt(e.target.value); setSel(null); }}
            style={{ background: T.S2, border: "1px solid " + T.BD, color: T.AC, borderRadius: 3, padding: "2px 6px", fontSize: 11, fontFamily: "inherit" }}>
            <option value="All">All states</option>
            {markets.map((m) => <option key={m} value={m}>{MARKET_NAME[m] || m}</option>)}
          </select>
        </label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="PO, SO or customer…"
          style={{ background: T.S2, border: "1px solid " + T.BD, color: T.TX, borderRadius: 3, padding: "3px 7px", fontSize: 10.5, fontFamily: "inherit", width: 150 }} />
        <label style={{ fontSize: 10, color: T.T2, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> Open only
        </label>
        <button onClick={onRefresh} style={{ padding: "3px 10px", borderRadius: 4, border: "1px solid " + T.BD, background: "transparent", color: T.T2, cursor: "pointer", fontSize: 10 }}>↻ Refresh</button>
        {card("Orders", fm(list.length), T.AC)}
        {card("Ordered", fm(tOrd), T.TX)}
        {card("Shipped", fm(tShp), T.GR)}
        {card("Outstanding", fm(tOrd - tShp), tOrd - tShp > 0 ? T.AM : T.T2)}
        <span style={{ marginLeft: "auto", fontSize: 9, color: T.T2 }}>
          {loading ? "loading…" : syncedAt ? `synced ${new Date(syncedAt).toLocaleString()}` : "not synced"}
        </span>
      </div>

      {!list.length && (
        <div style={{ padding: 22, textAlign: "center", fontSize: 11, color: T.T2 }}>
          {salesOrders.length ? "No orders match these filters." : "No sales orders yet — the sync writes these at 6am and noon."}
        </div>
      )}

      {!!list.length && (
        <div style={{ display: "flex", alignItems: "stretch", minHeight: 340 }}>
          {/* ── master list ─────────────────────────────────────────────── */}
          <div style={{ flex: cur ? "0 0 46%" : "1 1 100%", overflow: "auto", maxHeight: "calc(100vh - 300px)", borderRight: cur ? "1px solid " + T.BD : "none" }}>
            <table style={{ ...tbl, fontSize: 10.5 }}>
              <thead><tr>
                <th style={{ ...th, minWidth: 120 }}>Customer PO</th>
                <th style={{ ...th, minWidth: 78 }}>Calyx SO</th>
                <th style={{ ...th, minWidth: 150 }}>Customer</th>
                {!cur && <th style={{ ...th, minWidth: 60 }}>Ordered on</th>}
                <th style={{ ...th, textAlign: "right" }}>Ordered</th>
                <th style={{ ...th, textAlign: "right" }}>Shipped</th>
                {!cur && <th style={{ ...th, textAlign: "right" }}>Outstanding</th>}
                <th style={{ ...th, textAlign: "right", minWidth: 88 }}>Complete</th>
              </tr></thead>
              <tbody>
                {list.map((o) => {
                  const on = o.so === sel;
                  return (
                    <tr key={o.so} onClick={() => setSel(on ? null : o.so)}
                      style={{ cursor: "pointer", background: on ? T.AC + "18" : "transparent",
                        borderLeft: "3px solid " + (on ? T.AC : "transparent") }}>
                      <td style={{ ...td, ...mono, color: T.AC, fontWeight: 700 }}>{o.po || "— none —"}</td>
                      <td style={{ ...td, ...mono, fontSize: 10 }}>{o.so}</td>
                      <td style={{ ...td, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 190 }} title={o.customer}>{o.customer}</td>
                      {!cur && <td style={{ ...td, color: T.T2, fontSize: 10 }}>{o.orderDate || "—"}</td>}
                      <td style={num}>{fm(o.ordered)}</td>
                      <td style={{ ...num, color: T.GR }}>{fm(o.shipped)}</td>
                      {!cur && <td style={{ ...num, color: o.ordered - o.shipped > 0 ? T.AM : T.T2 }}>{fm(o.ordered - o.shipped)}</td>}
                      <td style={{ ...num, whiteSpace: "nowrap" }}>
                        <span style={{ color: o.pct >= 100 ? T.GR : T.T2, marginRight: 5 }}>{o.pct}%</span>
                        <Bar pct={o.pct} w={cur ? 34 : 54} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── detail panel ────────────────────────────────────────────── */}
          {cur && (
            <div style={{ flex: "1 1 54%", overflow: "auto", maxHeight: "calc(100vh - 300px)", background: T.S2 }}>
              <div style={{ padding: "10px 14px", borderBottom: "1px solid " + T.BD, position: "sticky", top: 0, background: T.S2, zIndex: 2 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ ...mono, fontSize: 15, fontWeight: 700, color: T.AC }}>{cur.po || "— no customer PO —"}</span>
                  <span style={{ fontSize: 10, color: T.T2 }}>{MARKET_NAME[cur.market] || cur.market || ""}</span>
                  <button onClick={() => setSel(null)} title="Close"
                    style={{ marginLeft: "auto", border: "1px solid " + T.BD, background: "transparent", color: T.T2, borderRadius: 4, cursor: "pointer", fontSize: 11, padding: "1px 7px" }}>✕</button>
                </div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8 }}>
                  {field("Calyx sales order", <span style={mono}>{cur.so}</span>)}
                  {field("Customer", cur.customer)}
                  {field("Status", statusText(cur.status))}
                  {field("Ordered on", cur.orderDate)}
                  {field("Due", cur.dueDate)}
                  {field("Ship method", cur.shipMethod)}
                  {field("Terms", cur.terms)}
                  {field("Progress", <span><span style={{ color: cur.pct >= 100 ? T.GR : T.TX, ...mono }}>{fm(cur.shipped)}/{fm(cur.ordered)} · {cur.pct}%</span> <Bar pct={cur.pct} w={40} /></span>)}
                </div>
                {cur.memo && <div style={{ marginTop: 7, fontSize: 10, color: T.T2, fontStyle: "italic" }}>{cur.memo}</div>}
              </div>

              <div style={{ padding: "9px 14px 4px", fontSize: 10, fontWeight: 700, color: T.T2, textTransform: "uppercase", letterSpacing: .4 }}>
                Line items ({cur.lines.length})
              </div>
              <table style={{ ...tbl, fontSize: 10.5 }}>
                <thead><tr>
                  <th style={{ ...th, minWidth: 116 }}>SKU</th>
                  <th style={{ ...th, minWidth: 190 }}>Item</th>
                  <th style={{ ...th, textAlign: "right" }}>Ordered</th>
                  <th style={{ ...th, textAlign: "right" }}>Shipped</th>
                  <th style={{ ...th, textAlign: "right" }}>Open</th>
                  <th style={{ ...th, textAlign: "right", minWidth: 80 }}>%</th>
                </tr></thead>
                <tbody>
                  {cur.lines.slice().sort((a, b) => a.sku.localeCompare(b.sku)).map((l, i) => {
                    const p = l.ordered ? Math.round((l.shipped / l.ordered) * 100) : 0;
                    return (
                      <tr key={i}>
                        <td style={{ ...td, ...mono, fontSize: 10 }}>{l.sku}</td>
                        <td style={{ ...td, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 230 }} title={l.name}>{l.name}</td>
                        <td style={num}>{fm(l.ordered)}</td>
                        <td style={{ ...num, color: T.GR }}>{fm(l.shipped)}</td>
                        <td style={{ ...num, color: l.ordered - l.shipped > 0 ? T.AM : T.T2 }}>{fm(l.ordered - l.shipped)}</td>
                        <td style={{ ...num, whiteSpace: "nowrap" }}>
                          <span style={{ color: p >= 100 ? T.GR : T.T2, marginRight: 4 }}>{p}%</span><Bar pct={p} w={30} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div style={{ padding: "13px 14px 4px", fontSize: 10, fontWeight: 700, color: T.T2, textTransform: "uppercase", letterSpacing: .4 }}>
                Shipments on this PO ({curShipments.length})
              </div>
              {!curShipments.length && (
                <div style={{ padding: "4px 14px 16px", fontSize: 10.5, color: T.T2 }}>
                  {stamped
                    ? "Nothing has shipped against this order yet."
                    : "The shipment log predates order-level linking — run the NetSuite sync once and shipments will appear here."}
                </div>
              )}
              {curShipments.map((s) => (
                <div key={s.shipment_key} style={{ margin: "0 14px 9px", border: "1px solid " + T.BD, borderRadius: 5, background: T.S1 }}>
                  <div style={{ padding: "5px 9px", display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", borderBottom: "1px solid " + T.BD }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700 }}>{s.ship_date}</span>
                    <span style={{ fontSize: 9.5, color: T.T2 }}>{s.carrier || "carrier n/a"}</span>
                    <TrackingLink carrier={s.carrier} number={s.tracking_number} />
                    <span style={{ marginLeft: "auto", fontSize: 9, color: T.T2, ...mono }}>{(s.fulfillment_tranids || []).join(" + ")}</span>
                  </div>
                  <table style={{ ...tbl, fontSize: 10 }}>
                    <tbody>
                      {s.lines.map((l, i) => (
                        <tr key={i}>
                          <td style={{ ...td, ...mono, fontSize: 9.5, minWidth: 112 }}>{l.sku}</td>
                          <td style={{ ...td }}>{l.flavor}</td>
                          <td style={{ ...num, minWidth: 70 }}>{fm(l.quantity_shipped)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
