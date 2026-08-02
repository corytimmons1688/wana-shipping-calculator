// InventoryReconcile.jsx — why does NetSuite say one number and the dashboard
// another? Click an on-hand figure and this lays both ledgers side by side as a
// dated timeline: NetSuite item receipts and fulfillments against the
// dashboard's own inbound, outbound and adjustments.
//
// Every event is matched to its counterpart on the other side where one exists.
// What is left unmatched IS the discrepancy — so those rows are highlighted and
// summarised in plain language at the top.

import { useMemo } from "react";
import { fm } from "../utils/format";
import { T, tbl, th, td } from "../utils/theme";

const mono = { fontFamily: "'JetBrains Mono',monospace" };
const numC = { ...td, textAlign: "right", ...mono, fontSize: 10.5 };

// NetSuite hands back M/D/YYYY, the dashboard stores YYYY-MM-DD. Normalise so
// the two ledgers actually sort into one chronological sequence.
function toISO(d) {
  const s = String(d || "").trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${String(m[1]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}` : s;
}
const dayGap = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000) || 0;

/**
 * Greedy pairing: for each event on side A find the closest-dated event on
 * side B with the same quantity. Exact quantity is the strong signal — dates
 * legitimately differ by days because a shipment is receipted when it lands,
 * not when the dashboard says it was due.
 */
function pair(a, b) {
  const used = new Set();
  const link = (x, y, i, how, gap) => {
    used.add(i); x.match = y; y.match = x; x.gapDays = gap; x.how = how; y.how = how;
  };
  // Pass 1 — the dashboard records the fulfillment number it shipped against,
  // so when both sides name the same document that is proof, not inference.
  for (const x of a) {
    const i = b.findIndex((y, j) => !used.has(j) && x.doc && y.doc && x.doc === y.doc);
    if (i >= 0) link(x, b[i], i, "document", dayGap(x.date, b[i].date));
  }
  // Pass 2 — otherwise the exact quantity, nearest in time.
  for (const x of a) {
    if (x.match) continue;
    let best = -1, bestGap = Infinity;
    b.forEach((y, i) => {
      if (used.has(i) || y.match || y.qty !== x.qty) return;
      const g = dayGap(x.date, y.date);
      if (g < bestGap) { bestGap = g; best = i; }
    });
    if (best >= 0) link(x, b[best], best, "quantity", bestGap);
  }
}

export default function InventoryReconcile({ sku, name, onHand, receipts = [], shipments = [], actuals = {}, onClose }) {
  const model = useMemo(() => {
    // The dashboard stores a fulfillment number against each outbound, so an
    // unmatched one can still name the order it should have been fulfilled on.
    const soByIf = {}, poByIf = {};
    for (const s of shipments) for (const t of (s.fulfillment_tranids || [])) {
      soByIf[t] = s.sales_orders || []; poByIf[t] = s.customer_pos || [];
    }

    // ── NetSuite ledger ──────────────────────────────────────────────────
    const nsIn = receipts.filter((r) => r.sku === sku)
      .map((r) => ({ side: "ns", kind: "Receipt", date: toISO(r.date), ref: r.ref, qty: r.qty, sign: 1 }));
    const nsOut = [];
    for (const s of shipments) {
      for (const l of (s.lines || [])) {
        if (l.sku !== sku) continue;
        const ifs = s.fulfillment_tranids || [];
        nsOut.push({ side: "ns", kind: "Shipment", date: toISO(s.ship_date),
          ref: ifs.join("+") || s.shipment_key, doc: ifs[0] || "",
          note: [s.market, ...(s.customer_pos || [])].filter(Boolean).join(" · "),
          sos: s.sales_orders || [], pos: s.customer_pos || [], market: s.market,
          qty: Number(l.quantity_shipped) || 0, sign: -1 });
      }
    }

    // ── Dashboard ledger ─────────────────────────────────────────────────
    const dashIn = [], dashOut = [], adj = [];
    for (const sh of actuals.inbound || []) {
      const q = (sh.lines || []).filter((l) => l.sku === sku).reduce((a, l) => a + (Number(l.qty) || 0), 0);
      if (!q) continue;
      // Only received stock is on hand; in-transit is deliberately excluded and
      // called out separately so it is never mistaken for a discrepancy.
      (sh.received ? dashIn : adj).push({ side: "dash", kind: sh.received ? "Inbound received" : "In transit",
        date: toISO(sh.eta), ref: sh.ref || "—", qty: q, sign: sh.received ? 1 : 0,
        factoryRef: sh.factoryRef || "", eta: sh.eta || "", shipDate: sh.shipDate || "",
        pending: !sh.received });
    }
    for (const sh of actuals.outbound || []) {
      const q = (sh.lines || []).filter((l) => l.sku === sku).reduce((a, l) => a + (Number(l.qty) || 0), 0);
      if (!q) continue;
      const doc = String(sh.tracking || "").trim();
      dashOut.push({ side: "dash", kind: "Outbound", date: toISO(sh.dateShipped || sh.arriveBy),
        ref: doc || sh.market || "—", doc, note: doc && sh.market ? sh.market : "",
        market: sh.market || "", sos: soByIf[doc] || [], pos: poByIf[doc] || [],
        qty: q, sign: -1 });
    }
    for (const a of actuals.adjustments || []) {
      const d = Number(a.delta) || 0;
      if (a.sku !== sku || !d) continue;
      adj.push({ side: "dash", kind: "Adjustment", date: toISO(a.date), ref: a.note || "—",
        qty: Math.abs(d), sign: d > 0 ? 1 : -1, isAdj: true });
    }

    // pair like against like
    pair(nsIn, dashIn);
    pair(nsOut, dashOut);

    const sum = (arr) => arr.reduce((a, e) => a + e.qty, 0);
    const nsInT = sum(nsIn), nsOutT = sum(nsOut), dashInT = sum(dashIn), dashOutT = sum(dashOut);
    const adjT = adj.filter((e) => e.isAdj).reduce((a, e) => a + e.qty * e.sign, 0);
    const inTransit = adj.filter((e) => e.pending).reduce((a, e) => a + e.qty, 0);

    const dashExpected = dashInT - dashOutT + adjT;
    const gap = (Number(onHand) || 0) - dashExpected;

    // unmatched = the whole of the discrepancy
    const orphanNsIn   = nsIn.filter((e) => !e.match);
    const orphanDashIn = dashIn.filter((e) => !e.match);
    const orphanNsOut  = nsOut.filter((e) => !e.match);
    const orphanDashOut = dashOut.filter((e) => !e.match);

    const events = [...nsIn, ...nsOut, ...dashIn, ...dashOut, ...adj]
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));

    // What is missing, named as the document someone has to go create — and
    // what evidence says it should exist.
    const list = (a) => (a || []).filter(Boolean).join(" / ");
    // Customer PO values are free text and often already read "PO 1 and PO 2",
    // so only add the "PO" label when it is not already there.
    const poLabel = (a) => { const v = list(a); return /^po\b/i.test(v) ? v : `PO ${v}`; };
    for (const e of dashIn) if (!e.match) e.detail =
      `Missing Item Receipt${e.factoryRef ? ` on PO ${e.factoryRef}` : ""} — based on ${e.ref} delivery expected ${e.eta || "date not set"}`;
    for (const e of nsIn) if (!e.match) e.detail =
      `Receipted in NetSuite as ${e.ref} on ${e.date} — no matching inbound shipment on the dashboard`;
    for (const e of nsOut) if (!e.match) e.detail =
      `Not on the dashboard — ${e.ref} shipped ${e.date}${e.sos.length ? ` on ${list(e.sos)}` : ""}${e.pos.length ? ` (${poLabel(e.pos)})` : ""}`;
    for (const e of dashOut) if (!e.match) e.detail =
      `Item Fulfillment missed${e.sos.length ? ` for ${list(e.sos)}` : e.doc ? ` for ${e.doc}` : ""} — based on ${e.market || "shipment"} expected to ship ${e.date || "date not set"} on dashboard`;

    // ── plain-language insight ───────────────────────────────────────────
    const notes = [];
    const t = (arr) => fm(arr.reduce((a, e) => a + e.qty, 0));
    // Distinguish "NetSuite has no receipt for this" from "we have not pulled
    // receipts yet" — otherwise every SKU falsely accuses the receiving team.
    const noReceiptFeed = !receipts.length;
    if (noReceiptFeed) notes.push("NetSuite item receipts have not been synced yet, so arrivals cannot be matched on the NetSuite side. Re-run the sync — until then treat the inbound rows below as unverified, not as missing receipts.");
    if (orphanNsIn.length) notes.push(`${orphanNsIn.length} NetSuite receipt${orphanNsIn.length > 1 ? "s" : ""} totalling ${t(orphanNsIn)} have no matching inbound shipment in the dashboard — NetSuite has booked stock the dashboard never recorded arriving, so the dashboard reads low.`);
    if (orphanDashIn.length && !noReceiptFeed) notes.push(`${orphanDashIn.length} dashboard inbound shipment${orphanDashIn.length > 1 ? "s are" : " is"} marked received (${t(orphanDashIn)}) with no NetSuite item receipt — either the receipt has not been entered yet, or the shipment was marked received early. The dashboard reads high by this amount.`);
    if (orphanNsOut.length) notes.push(`${orphanNsOut.length} NetSuite fulfillment${orphanNsOut.length > 1 ? "s" : ""} totalling ${t(orphanNsOut)} are not reflected as dashboard outbound — stock has physically left but the dashboard still counts it, reading high.`);
    if (orphanDashOut.length) notes.push(`${orphanDashOut.length} dashboard outbound shipment${orphanDashOut.length > 1 ? "s" : ""} totalling ${t(orphanDashOut)} have no NetSuite fulfillment — either not yet fulfilled in NetSuite, or recorded here in error. The dashboard reads low.`);
    if (adjT) notes.push(`A manual adjustment of ${adjT > 0 ? "+" : ""}${fm(adjT)} is applied in the dashboard only; NetSuite has no equivalent entry.`);
    if (inTransit) notes.push(`${fm(inTransit)} is still in transit and correctly excluded from both on-hand figures — it is not part of the gap.`);
    if (!notes.length) {
      notes.push(gap === 0
        ? "Both ledgers agree. Every NetSuite receipt and fulfillment has a matching dashboard record."
        : `Every event pairs up, yet the totals still differ by ${fm(Math.abs(gap))}. That points at a starting balance rather than a missing transaction — stock that predates the dashboard's first recorded shipment.`);
    }

    return { events, nsInT, nsOutT, dashInT, dashOutT, adjT, inTransit, dashExpected, gap,
      orphans: orphanNsIn.length + orphanDashIn.length + orphanNsOut.length + orphanDashOut.length, notes };
  }, [sku, onHand, receipts, shipments, actuals]);

  const stat = (l, v, c) => (
    <div key={l} style={{ background: T.S1, borderRadius: 5, padding: "4px 10px", border: "1px solid " + T.BD }}>
      <div style={{ color: T.T2, fontSize: 8, textTransform: "uppercase", letterSpacing: .3 }}>{l}</div>
      <div style={{ color: c || T.TX, fontSize: 13, fontWeight: 700, ...mono }}>{v}</div>
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 60,
      display: "flex", justifyContent: "flex-end" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(920px, 94vw)", background: T.S2,
        height: "100%", overflow: "auto", boxShadow: "-8px 0 26px rgba(0,0,0,.18)" }}>

        <div style={{ padding: "12px 16px", borderBottom: "1px solid " + T.BD, position: "sticky", top: 0, background: T.S2, zIndex: 2 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ ...mono, fontSize: 15, fontWeight: 700, color: T.AC }}>{sku}</span>
            <span style={{ fontSize: 11, color: T.T2 }}>{String(name || "").split(":")[0]}</span>
            <button onClick={onClose} style={{ marginLeft: "auto", border: "1px solid " + T.BD, background: "transparent",
              color: T.T2, borderRadius: 4, cursor: "pointer", fontSize: 12, padding: "1px 8px" }}>✕</button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 9 }}>
            {stat("NetSuite on hand", fm(onHand), T.TX)}
            {stat("Dashboard expects", fm(model.dashExpected), T.T2)}
            {stat("Gap", (model.gap > 0 ? "+" : "") + fm(model.gap), model.gap === 0 ? T.GR : "#b45309")}
            {stat("Unexplained events", fm(model.orphans), model.orphans ? "#b45309" : T.GR)}
          </div>
        </div>

        {/* insight */}
        <div style={{ margin: "12px 16px", background: model.gap === 0 ? T.GR + "10" : "#fffbeb",
          border: "1px solid " + (model.gap === 0 ? T.GR : T.AM), borderRadius: 6, padding: "10px 12px" }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: .4,
            color: model.gap === 0 ? T.GR : "#92400e", marginBottom: 5 }}>Why the numbers differ</div>
          {model.notes.map((n, i) => (
            <div key={i} style={{ fontSize: 11, lineHeight: 1.5, color: T.TX, marginBottom: i < model.notes.length - 1 ? 5 : 0 }}>• {n}</div>
          ))}
          <div style={{ marginTop: 8, paddingTop: 7, borderTop: "1px dashed " + T.BD, fontSize: 10, color: T.T2, ...mono }}>
            dashboard: {fm(model.dashInT)} received − {fm(model.dashOutT)} shipped
            {model.adjT ? ` ${model.adjT > 0 ? "+" : "−"} ${fm(Math.abs(model.adjT))} adj` : ""} = {fm(model.dashExpected)}
            &nbsp;·&nbsp; netsuite: {fm(model.nsInT)} receipted − {fm(model.nsOutT)} fulfilled = {fm(model.nsInT - model.nsOutT)}
          </div>
        </div>

        {/* timeline */}
        <div style={{ padding: "0 16px 20px" }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: T.T2, textTransform: "uppercase", letterSpacing: .4, margin: "4px 0 6px" }}>
            Timeline — both ledgers, newest first
          </div>
          <table style={{ ...tbl, fontSize: 10.5 }}>
            <thead><tr>
              <th style={{ ...th, minWidth: 84 }}>Date</th>
              <th style={{ ...th, minWidth: 76 }}>Source</th>
              <th style={{ ...th, minWidth: 118 }}>Event</th>
              <th style={{ ...th, minWidth: 150 }}>Reference</th>
              <th style={{ ...th, textAlign: "right", minWidth: 78 }}>Quantity</th>
              <th style={{ ...th, minWidth: 300 }}>Match / what is missing</th>
            </tr></thead>
            <tbody>
              {model.events.map((e, i) => {
                const orphan = !e.match && !e.isAdj && !e.pending;
                return (
                  <tr key={i} style={{ background: orphan ? "#fffbeb" : e.pending ? T.S1 : undefined }}>
                    <td style={{ ...td, ...mono, fontSize: 10, color: T.T2 }}>{e.date || "—"}</td>
                    <td style={{ ...td }}>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3,
                        color: e.side === "ns" ? "#1e40af" : "#3730a3",
                        background: e.side === "ns" ? "#dbeafe" : "#e0e7ff" }}>
                        {e.side === "ns" ? "NetSuite" : "Dashboard"}
                      </span>
                    </td>
                    <td style={{ ...td, color: e.pending ? T.T2 : T.TX }}>{e.kind}</td>
                    <td style={{ ...td, ...mono, fontSize: 9.5, color: T.T2 }}>
                      {e.ref}{e.note ? <span style={{ fontFamily: "inherit" }}> · {e.note}</span> : null}
                    </td>
                    <td style={{ ...numC, fontWeight: 700,
                      color: e.sign > 0 ? T.GR : e.sign < 0 ? "#b91c1c" : T.T2 }}>
                      {e.sign > 0 ? "+" : e.sign < 0 ? "−" : ""}{fm(e.qty)}
                    </td>
                    <td style={{ ...td, fontSize: 9.5, lineHeight: 1.45 }}>
                      {e.pending ? <span style={{ color: T.T2 }}>in transit — excluded</span>
                        : e.isAdj ? <span style={{ color: T.T2 }}>dashboard only</span>
                        : e.match
                          ? <span style={{ color: T.GR }}>
                              ✓ {e.match.ref}
                              <span style={{ color: T.T2 }}>
                                {e.how === "document" ? " · same document" : " · matched on quantity"}
                                {e.gapDays >= 1 ? ` · ${Math.round(e.gapDays)}d apart` : ""}
                              </span>
                            </span>
                          : <span style={{ color: "#b45309" }}>
                              <span style={{ fontWeight: 700 }}>⚠ </span>{e.detail || "no counterpart"}
                            </span>}
                    </td>
                  </tr>
                );
              })}
              {!model.events.length && (
                <tr><td colSpan={6} style={{ ...td, textAlign: "center", color: T.T2, padding: 18 }}>
                  No recorded movement for this SKU on either side.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
