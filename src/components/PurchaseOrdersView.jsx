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
import { cubeOrdersOnly, isCubeLabel, isCubeApplFee, baseLabelFlavour } from "../utils/salesOrderMatch";
import { skuInfo } from "../utils/inventory";
import { baseSkuFor } from "../utils/applySchedule";

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

// The tracking number links straight to the carrier's tracking page for that
// number. Values that are not tracking numbers at all ("PICKEDUP" and friends)
// render as plain text — see utils/tracking.js.
export function TrackingLink({ carrier, number, size = 10 }) {
  const url = trackingUrl(carrier, number);
  const n = String(number || "").trim();
  if (!n) return <span style={{ color: T.T2, fontSize: size }}>—</span>;
  if (!url) return <span style={{ ...mono, fontSize: size, color: T.T2 }} title="Not a tracking number">{n}</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
      title={`Track ${n} — opens ${carrier || "carrier"} tracking`}
      style={{ ...mono, fontSize: size, color: T.AC, textDecoration: "underline",
        textDecorationStyle: "dotted", textUnderlineOffset: 2 }}>
      {n} ↗
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

  // Wana Cube only. The sync pulls every open order NetSuite has, so the label
  // lines can be found wherever a market chooses to file them — which also drags
  // in the jar business: Curaleaf, Temple Hill, Stash House, 24-k Labs and a
  // dozen more. 22 of 36 orders on this screen had nothing to do with cubes.
  const cubeOrders = useMemo(() => cubeOrdersOnly(salesOrders), [salesOrders]);

  const markets = useMemo(() =>
    [...new Set(cubeOrders.map((r) => r.market).filter(Boolean))].sort(), [cubeOrders]);

  // One card per sales order. The customer PO is the label, but two SOs can
  // legitimately carry the same PO (lids and labels bill separately), so the
  // sales order number stays the key.
  const orders = useMemo(() => {
    const by = {};
    for (const r of cubeOrders) {
      const o = by[r.so] || (by[r.so] = { so: r.so, po: r.custPo, customer: r.customer, market: r.market,
        status: r.status, orderDate: r.orderDate, dueDate: r.dueDate, memo: r.memo,
        terms: r.terms, shipMethod: r.shipMethod, lines: [], ordered: 0, shipped: 0 });
      o.lines.push(r); o.ordered += r.ordered; o.shipped += r.shipped;
    }

    // Orders that ship together are one order to everyone who works with them.
    // New Jersey files the cubes on PO 1 and PO 2 / 9245 and the labels that go
    // on them on SP02377 — seven trucks have carried both. Colorado runs three
    // at once across 11599, 11600 and 11626 and fills them off the same pallets.
    // Two or three cards made the floor read a fraction of an order at a time.
    //
    // The link is the shipping record rather than anything on the orders
    // themselves: no field ties them, and the customer PO differs on every one.
    // Grouping is transitive — Colorado's three arrive as three overlapping
    // pairs, never all on one truck — so this walks the connected components of
    // "has shipped alongside". An order nothing has shipped against yet stands
    // on its own, which is right: SO15605 is not part of anything until it is.
    const parent = {};
    const find = (x) => { while (parent[x] && parent[x] !== x) x = parent[x] = parent[parent[x]] || parent[x]; return x; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
    for (const k of Object.keys(by)) parent[k] = k;
    for (const s of shipments) {
      const sos = [...new Set((s.lines || []).map((l) => l.sales_order).filter((x) => x && by[x]))];
      for (let i = 1; i < sos.length; i++) union(sos[0], sos[i]);
    }
    const members = {};
    for (const k of Object.keys(by)) (members[find(k)] = members[find(k)] || []).push(k);
    for (const group of Object.values(members)) {
      if (group.length < 2) continue;
      // The oldest order anchors the card — it is the one the programme started
      // on, and the one people name when they mean the whole thing.
      const sorted = group.slice().sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
      const host = by[sorted[0]];
      for (const k of sorted.slice(1)) {
        const o = by[k];
        host.lines.push(...o.lines);
        host.ordered += o.ordered; host.shipped += o.shipped;
        host.alsoSo = [...(host.alsoSo || []), o.so];
        host.alsoPo = [...(host.alsoPo || []), o.po].filter(Boolean);
        delete by[k];
      }
    }

    return Object.values(by)
      .map((o) => ({ ...o, pct: o.ordered ? Math.round((o.shipped / o.ordered) * 100) : 0,
        open: !isClosed(o.status) && o.shipped < o.ordered }))
      .sort((a, b) => String(b.so).localeCompare(String(a.so), undefined, { numeric: true }));
  }, [cubeOrders, shipments]);

  const list = useMemo(() => orders.filter((o) => {
    if (mkt !== "All" && o.market !== mkt) return false;
    if (openOnly && !o.open) return false;
    if (!q.trim()) return true;
    const s = q.trim().toLowerCase();
    return [o.po, o.so, o.customer, ...(o.alsoSo || []), ...(o.alsoPo || [])]
      .some((v) => String(v || "").toLowerCase().includes(s));
  }), [orders, mkt, openOnly, q]);

  const cur = useMemo(() => list.find((o) => o.so === sel) || null, [list, sel]);

  // Shipments tied to the selected order — matched on the sales order stamped
  // onto each shipped line, falling back to the customer PO for older syncs
  // that predate the sales_order field.
  const curShipments = useMemo(() => {
    if (!cur) return [];
    return shipments
      .map((s) => {
        const sos = [cur.so, ...(cur.alsoSo || [])];
        const pos = [cur.po, ...(cur.alsoPo || [])].filter(Boolean);
        const lines = (s.lines || []).filter((l) =>
          (l.sales_order && sos.includes(l.sales_order)) ||
          (!l.sales_order && pos.includes(l.customer_po)));
        return lines.length ? { ...s, lines } : null;
      })
      .filter(Boolean);
  }, [cur, shipments]);

  // Whether the log has been synced since lines started carrying their SO —
  // tells an empty shipment list apart from a log that simply cannot link yet.
  const stamped = useMemo(() =>
    shipments.some((s) => (s.lines || []).some((l) => l.sales_order)), [shipments]);

  // The base side of an order arrives as three lines per flavour — the generic
  // PB- cube, that flavour's label, and the fee for applying it — all at the
  // same quantity and all describing one thing. Read line by line that is twenty
  // rows saying what six flavours and a base pool say in seven. Pool the base
  // side into one row; list the lids flavour by flavour, which is how the floor
  // picks them. Anything that is neither — blank and tamper label stock — keeps
  // its own row rather than being folded into a total it has no part in.
  const grouped = useMemo(() => {
    if (!cur) return [];
    // Read the way the fulfilments read: a lid line and a base line per flavour,
    // the base carrying the cube code it actually ships on.
    //
    // An order does not state a flavour's base quantity anywhere. It bills three
    // things — one pooled PB- line per colour covering every flavour, that
    // flavour's label, and the fee for applying it — and only the label names
    // the flavour. So the label's quantity IS the flavour's base count, which is
    // the same rule the schedule and the shipment report already run on.
    //
    // That makes these rows the physical picture rather than the billing one:
    // the pooled cube line and the application fee are the same units counted a
    // second and third way, so they are folded in here instead of listed. The
    // card header still carries the billed totals.
    const lids = {}, bases = {}, other = [];
    for (const l of cur.lines) {
      const sku = String(l.sku || "");
      if (/^PL-WCB-/i.test(sku)) { lids[sku] = l; continue; }
      if (/^PB-WCB-/i.test(sku) || isCubeApplFee(l)) continue;   // counted via the label
      if (isCubeLabel(sku)) {
        const f = baseLabelFlavour(l.name);
        if (f) {
          const g = (bases[f] = bases[f] || { ordered: 0, shipped: 0, parts: [], sos: [], pos: [] });
          g.ordered += l.ordered || 0; g.shipped += l.shipped || 0;
          if (l.so && !g.sos.includes(l.so)) g.sos.push(l.so);
          if (l.custPo && !g.pos.includes(l.custPo)) g.pos.push(l.custPo);
          g.parts.push(`${sku} — ${fm(l.ordered)} ordered, ${fm(l.shipped)} shipped`);
          continue;
        }
      }
      other.push(l);
    }
    const out = [];
    for (const f of [...new Set([...Object.keys(lids), ...Object.keys(bases)])]
      .sort((x, y) => skuInfo(x).name.localeCompare(skuInfo(y).name))) {
      const name = skuInfo(f).name;
      const lid = lids[f], base = bases[f];
      if (lid) out.push({ sku: f, name: `${name} — LID`, pair: !!base,
        ordered: lid.ordered, shipped: lid.shipped, title: lid.name,
        sos: [lid.so].filter(Boolean), pos: [lid.custPo].filter(Boolean) });
      if (base) out.push({ sku: baseSkuFor(f), name: `${name} — BASE`,
        ordered: base.ordered, shipped: base.shipped, sos: base.sos, pos: base.pos,
        title: `Base quantity comes from this flavour's label, the only line that names it:\n\n`
          + base.parts.join("\n")
          + `\n\nThe pooled cube line and the application fee are the same units billed again, so they are not listed separately.` });
    }
    out.push(...other.map((l) => ({ ...l, title: l.name,
      sos: [l.so].filter(Boolean), pos: [l.custPo].filter(Boolean) })));
    return out;
  }, [cur]);

  // The order on one tab, its fulfilments on another — the same two things the
  // panel shows, so a sheet mailed to a market reads like the screen it came
  // from. Colour carries the same meaning here as there: green for shipped,
  // amber for what is still owed, and a full green bar at 100%.
  const exportOrder = async () => {
    if (!cur) return;
    const mod = await import("exceljs"); const ExcelJS = mod.default || mod;
    const wb = new ExcelJS.Workbook();
    const GREEN = "FF16A34A", AMBER = "FFD97706", GREY = "FF6B7280", INK = "FF1A1A2E";
    const mono = (sz = 10) => ({ name: "Consolas", size: sz });

    const ws = wb.addWorksheet("Order", { views: [{ state: "frozen", ySplit: 9 }] });
    ws.columns = [{ width: 18 }, { width: 34 }, { width: 15 }, { width: 24 },
      { width: 13 }, { width: 13 }, { width: 13 }, { width: 11 }];
    const title = ws.addRow([cur.po || "— no customer PO —"]);
    title.font = { bold: true, size: 14, color: { argb: "FF2563EB" } };
    ws.addRow([`${MARKET_NAME[cur.market] || cur.market || ""} · ${cur.customer || ""}`])
      .font = { size: 10, color: { argb: GREY } };
    ws.addRow([]);
    const pair = (k, v) => { const r = ws.addRow([k, v]);
      r.getCell(1).font = { bold: true, size: 9, color: { argb: GREY } };
      r.getCell(2).font = { size: 10 }; };
    pair("Calyx sales order", [cur.so, ...(cur.alsoSo || [])].join(" + "));
    pair("Status", statusText(cur.status));
    pair("Ordered on", cur.orderDate || "—");
    pair("Ship method", cur.shipMethod || "—");
    pair("Terms", cur.terms || "—");
    pair("Progress", `${fm(cur.shipped)} / ${fm(cur.ordered)} · ${cur.pct}%`);
    ws.addRow([]);

    const head = ws.addRow(["SKU", "Item", "Sales order", "Customer PO", "Ordered", "Shipped", "Open", "%"]);
    head.eachCell((c) => { c.font = { bold: true, size: 9, color: { argb: GREY } };
      c.border = { bottom: { style: "thin", color: { argb: "FFD0D4DD" } } };
      c.alignment = { horizontal: c.col > 4 ? "right" : "left" }; });
    for (const l of grouped) {
      const open = (l.ordered || 0) - (l.shipped || 0);
      const pct = l.ordered ? l.shipped / l.ordered : 0;
      const r = ws.addRow([l.sku || "", l.name, (l.sos || []).join(", "), (l.pos || []).join(", "),
        l.ordered || 0, l.shipped || 0, open, pct]);
      r.getCell(1).font = mono(9);
      r.getCell(2).font = { size: 10, color: { argb: INK } };
      r.getCell(3).font = mono(9); r.getCell(4).font = mono(9);
      for (const i of [5, 6, 7]) { r.getCell(i).font = mono(10); r.getCell(i).numFmt = "#,##0"; }
      r.getCell(6).font = { ...mono(10), color: { argb: GREEN } };
      r.getCell(7).font = { ...mono(10), color: { argb: open > 0 ? AMBER : GREY } };
      r.getCell(8).numFmt = "0%";
      r.getCell(8).font = { ...mono(10), color: { argb: pct >= 1 ? GREEN : GREY } };
    }

    const ws2 = wb.addWorksheet("Shipments", { views: [{ state: "frozen", ySplit: 1 }] });
    ws2.columns = [{ width: 13 }, { width: 20 }, { width: 16 }, { width: 34 }, { width: 8 },
      { width: 13 }, { width: 16 }, { width: 24 }];
    const h2 = ws2.addRow(["Shipped", "Item fulfilment", "SKU", "Flavor", "Type",
      "Qty shipped", "Carrier", "Tracking"]);
    h2.eachCell((c) => { c.font = { bold: true, size: 9, color: { argb: GREY } };
      c.border = { bottom: { style: "thin", color: { argb: "FFD0D4DD" } } };
      c.alignment = { horizontal: c.col === 6 ? "right" : "left" }; });
    for (const sh of curShipments) for (const l of sh.lines || []) {
      const r = ws2.addRow([sh.ship_date, (sh.fulfillment_tranids || []).join(", "), l.sku,
        String(l.flavor || "").replace(/\s*-\s*(BASE|LID)\s*$/i, ""), l.component_type,
        l.quantity_shipped, sh.carrier || "", sh.tracking_number || ""]);
      r.getCell(2).font = mono(9); r.getCell(3).font = mono(9); r.getCell(8).font = mono(9);
      r.getCell(6).numFmt = "#,##0";
      r.getCell(6).font = { ...mono(10), color: { argb: GREEN } };
    }
    if (!curShipments.length) ws2.addRow(["Nothing has shipped against this order yet."])
      .font = { size: 10, color: { argb: GREY } };

    const buf = await wb.xlsx.writeBuffer();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([buf],
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    a.download = `${String(cur.po || cur.so).replace(/[^\w.-]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click(); URL.revokeObjectURL(a.href);
  };

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
          {cubeOrders.length ? "No orders match these filters." : "No Wana Cube orders yet — the sync writes these at 6am and noon."}
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
                      <td style={{ ...td, ...mono, color: T.AC, fontWeight: 700 }}>
                        {o.po || "— none —"}
                        {(o.alsoPo || []).map((x) => (
                          <span key={x} style={{ display: "block", fontSize: 9.5, fontWeight: 400, color: T.T2 }}>+ {x}</span>
                        ))}
                      </td>
                      <td style={{ ...td, ...mono, fontSize: 10 }}>
                        {o.so}
                        {(o.alsoSo || []).map((x) => (
                          <span key={x} style={{ display: "block", fontSize: 9.5, color: T.T2 }}>+ {x}</span>
                        ))}
                      </td>
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
                  {field("Calyx sales order", <span style={mono}>{[cur.so, ...(cur.alsoSo || [])].join(" + ")}</span>)}
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

              {/* An order's base side arrives as three lines per flavour — the
                  generic PB- cube, the flavour's label, and the fee for applying
                  it — all at the same quantity and all describing one thing. Read
                  line by line that is twenty rows saying what six flavours and a
                  base pool say in seven. Pool the base side into one row and list
                  the lids flavour by flavour, which is how the floor picks them. */}
              <div style={{ padding: "9px 14px 4px", display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: T.T2, textTransform: "uppercase", letterSpacing: .4 }}>
                  Line items ({grouped.length})
                </span>
                <button onClick={exportOrder}
                  title="Download this order as Excel — the order on one tab, its fulfilments on another"
                  style={{ marginLeft: "auto", padding: "3px 10px", borderRadius: 4,
                    border: "1px solid " + T.BD, background: "transparent", color: T.GR,
                    cursor: "pointer", fontSize: 10, fontWeight: 600 }}>
                  ↓ Excel
                </button>
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
                  {grouped.map((l, i) => {
                    const p = l.ordered ? Math.round((l.shipped / l.ordered) * 100) : 0;
                    return (
                      <tr key={i} style={{
                        background: l.pooled ? T.S2 + "70" : undefined,
                        // A flavour's base line sits under its lid with no rule
                        // between them, so the pair reads as one flavour.
                        borderTop: undefined }}>
                        <td style={{ ...td, ...mono, fontSize: 10, color: l.pooled ? T.T2 : undefined,
                          borderBottom: l.pair ? "none" : undefined }}>{l.sku || ""}</td>
                        <td style={{ ...td, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 260,
                          borderBottom: l.pair ? "none" : undefined,
                          fontWeight: l.pooled ? 600 : 400,
                          }} title={l.title}>
                          {l.name}
                          {/* Which order this line is actually against. A card
                              can merge two — New Jersey bills its cubes on one
                              and the labels that go on them on another — so a
                              lid and the base under it sit on different orders
                              and a row that does not say so is half an answer. */}
                          {(l.sos || []).map((so, n) => (
                            <span key={so} title={`${so}${(l.pos || [])[n] ? ` · customer PO ${(l.pos || [])[n]}` : ""}`}
                              style={{ marginLeft: 6, fontSize: 8.5, fontWeight: 700, ...mono,
                                color: T.PU, border: "1px solid " + T.PU + "55", background: T.PU + "0F",
                                borderRadius: 3, padding: "1px 4px", whiteSpace: "nowrap" }}>
                              {so}{(l.pos || [])[n] ? ` · ${(l.pos || [])[n]}` : ""}
                            </span>
                          ))}
                        </td>
                        <td style={{ ...num, borderBottom: l.pair ? "none" : undefined }}>{fm(l.ordered)}</td>
                        <td style={{ ...num, color: T.GR, borderBottom: l.pair ? "none" : undefined }}>{fm(l.shipped)}</td>
                        <td style={{ ...num, color: l.ordered - l.shipped > 0 ? T.AM : T.T2, borderBottom: l.pair ? "none" : undefined }}>{fm(l.ordered - l.shipped)}</td>
                        <td style={{ ...num, whiteSpace: "nowrap", borderBottom: l.pair ? "none" : undefined }}>
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
