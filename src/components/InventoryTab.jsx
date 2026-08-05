// InventoryTab — inventory at Calyx from actual flows (inbound received −
// outbound shipped + count adjustments), with forward projection / MOH from
// the active scenario's item forecast, target levels (ROP/Max) and reorder
// suggestions, plus editors for inbound shipments, outbound-to-Wana shipments,
// open POs, and targets. Actuals are shared across scenarios (Supabase `actuals`).

import { useState, useMemo, useEffect } from "react";
import { calcSkuWeeklyForecast, calcSkuInventory, calcSkuMarketWeekly, shipmentEta, buildWeekGrid, skuInfo } from "../utils/inventory";
import { buildApplySchedule, slotKey, baseSkuFor, LID_BOX, BASE_BOX, CAP_MIN, CAP_MAX } from "../utils/applySchedule";
import { allocateSalesOrders } from "../utils/salesOrderMatch";
import { parseLocalDate } from "../utils/calc";
import { MASTER_SKUS, BASE_TYPES } from "../data/skuMaster";
import { Ed } from "./Shared";
import InventoryReconcile, { buildReconciliation, inventoryFlag } from "./InventoryReconcile";
import { matchReceipts } from "../utils/receiptMatch";
import { fm, dF } from "../utils/format";
import { T, tbl, th, td } from "../utils/theme";

const todayISO = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const ALL_SKU_OPTIONS = [
  ...MASTER_SKUS.map((m) => ({ sku: m.sku, label: `${m.sku} — ${m.name}` })),
  { sku: BASE_TYPES["Black Sparkle"].sku, label: `${BASE_TYPES["Black Sparkle"].sku} — Black Base` },
  { sku: BASE_TYPES["White"].sku, label: `${BASE_TYPES["White"].sku} — White Base` },
];

function SkuSelect({ value, onChange, width = 250 }) {
  const known = ALL_SKU_OPTIONS.some((o) => o.sku === value);
  return (
    <select value={value || ""} onChange={(e) => onChange(e.target.value)}
      style={{ width, fontSize: 11, padding: "3px 4px", borderRadius: 4, border: "1px solid " + T.BD, background: T.S1, color: T.TX, fontFamily: "'JetBrains Mono',monospace" }}>
      <option value="" disabled>select SKU…</option>
      {ALL_SKU_OPTIONS.map((o) => <option key={o.sku} value={o.sku}>{o.label}</option>)}
      {value && !known && <option value={value}>{value} (unrecognized)</option>}
    </select>
  );
}

function DateEd({ value, onChange }) {
  return <input type="date" value={value || ""} onChange={(e) => onChange(e.target.value)}
    style={{ fontSize: 10.5, padding: "2px 3px", borderRadius: 4, border: "1px solid " + T.BD, background: T.S1, color: value ? "#1e40af" : T.T2, fontFamily: "'JetBrains Mono',monospace" }} />;
}

function Chip({ txt, bg, bd, tx, title }) {
  return <span title={title} style={{ display: "inline-block", padding: "2px 8px", borderRadius: 9, background: bg, border: "1px solid " + bd, color: tx, fontSize: 9.5, fontWeight: 700, whiteSpace: "nowrap" }}>{txt}</span>;
}

function MohChip({ v }) {
  if (!v) return <span style={{ color: T.T2, fontSize: 10 }}>n/a</span>;
  const { moh, mohCapped, horizonMo, avgMoFwd } = v;
  if (!isFinite(moh) || avgMoFwd <= 0) return <span style={{ color: T.T2, fontSize: 10 }}>n/a</span>;
  const txt = mohCapped ? horizonMo.toFixed(1) + "+" : moh.toFixed(1);
  const c = moh < 1 ? { bg: "#fee2e2", bd: "#dc2626", tx: "#991b1b" } : moh < 2 ? { bg: "#fef3c7", bd: T.AM, tx: "#92400e" } : { bg: "#dcfce7", bd: T.GR, tx: "#166534" };
  return <Chip txt={txt} bg={c.bg} bd={c.bd} tx={c.tx} title="Months on hand vs avg forward forecast (13 wk)" />;
}

function StatusChipIn({ sh, today, onReceive }) {
  if (sh.received) return <Chip txt="Received" bg="#dcfce7" bd={T.GR} tx="#166534" />;
  const eta = shipmentEta(sh);
  const chip = !eta ? <Chip txt="No dates" bg={T.S2} bd={T.BD} tx={T.T2} title="Excluded from projections until dated or received" />
    : eta <= today ? <Chip txt="Arrived?" bg="#fef3c7" bd={T.AM} tx="#92400e" title="ETA has passed" />
    : <Chip txt="In transit" bg="#dbeafe" bd={T.AC} tx="#1d4ed8" />;
  // Any not-yet-received shipment can be marked received when it physically arrives.
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      {chip}
      <button onClick={onReceive} title="Mark this shipment received at Calyx (moves units to On hand)" style={{ marginLeft: 4, padding: "1px 7px", borderRadius: 4, border: "1px solid " + T.GR, background: T.GR + "10", color: T.GR, cursor: "pointer", fontSize: 9, fontWeight: 600 }}>Receive</button>
    </span>
  );
}

const INV_VIEWS = ["overview", "mrp", "inbound", "outbound", "pos", "targets", "factory"];
const HIDDEN_VIEWS = ["factory"];

export default function InventoryTab({ sc, actuals, updActuals }) {
  // Persist the active sub-view so a page refresh returns to the same place.
  const [view, setViewRaw] = useState(() => {
    try { const v = localStorage.getItem("wana.invView"); return INV_VIEWS.includes(v) ? v : "overview"; } catch { return "overview"; }
  });
  const setView = (v) => { setViewRaw(v); try { localStorage.setItem("wana.invView", v); } catch { /* ignore */ } };
  // Views built but not currently surfaced. The render blocks stay intact, so
  // un-hiding is a one-line change rather than a rebuild.
  useEffect(() => { if (HIDDEN_VIEWS.includes(view)) setView("overview"); }, [view]); // eslint-disable-line
  const [expKey, setExpKey] = useState(null);
  const [expShip, setExpShip] = useState(null);
  const [outMkt, setOutMkt] = useState("All");
  const [adjVal, setAdjVal] = useState("");
  const [mrpCollapsed, setMrpCollapsed] = useState(() => new Set());
  const [applyMkt, setApplyMkt] = useState("All");
  // Live NetSuite on-hand, refreshed by the sync cron into shipment_log.
  const [nsInv, setNsInv] = useState({ loading: true, rows: [], at: null, err: null });
  const [nsShip, setNsShip] = useState([]);
  const [nsRcpt, setNsRcpt] = useState([]);
  const [nsSO, setNsSO] = useState([]);       // open orders, to book shipments against
  const [recon, setRecon] = useState(null);   // SKU whose reconciliation is open
  const [flagOnly, setFlagOnly] = useState(false);
  // what the last receipt sweep marked received, and what it only suspects
  const [autoRcv, setAutoRcv] = useState({ applied: [], possible: [] });
  const loadNsInv = () => {
    const U = "https://fxdyiurjioesdmedmgzu.supabase.co/rest/v1/shipment_log?id=eq.1&select=data,updated_at";
    const K = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4ZHlpdXJqaW9lc2RtZWRtZ3p1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzIzOTYsImV4cCI6MjA4ODMwODM5Nn0.5ueK5iXQ35oThb02ClX3iErPwYR4tPih9GtBAmhDQYk";
    setNsInv((p) => ({ ...p, loading: true }));
    fetch(U, { headers: { apikey: K, Authorization: `Bearer ${K}` } })
      .then((r) => r.json())
      .then((rows) => {
        const d = ((rows[0] || {}).data) || {};
        setNsShip(d.shipments || []);
        setNsRcpt(d.receipts || []);
        setNsSO(d.salesOrders || []);
        setNsInv({ loading: false, err: null, rows: d.inventory || [], at: (rows[0] || {}).updated_at || null });
      })
      .catch((e) => setNsInv({ loading: false, rows: [], at: null, err: String(e.message || e) }));
  };
  useEffect(() => { loadNsInv(); }, []); // eslint-disable-line

  // A NetSuite item receipt is proof the factory shipment landed, so flip the
  // dashboard's "received" flag rather than waiting for someone to tick it.
  // Only exact full-line matches are applied; each one records the receipt it
  // came from so the decision stays auditable and reversible.
  useEffect(() => {
    if (!nsRcpt.length || !(actuals.inbound || []).length) return;
    const { confirmed, possible } = matchReceipts(actuals.inbound, nsRcpt);
    setAutoRcv((prev) => ({ applied: confirmed.length ? [...prev.applied, ...confirmed] : prev.applied, possible }));
    if (!confirmed.length) return;
    const by = Object.fromEntries(confirmed.map((c) => [c.id, c]));
    updActuals((d) => {
      for (const sh of d.inbound || []) {
        const m = by[sh.id];
        if (!m || sh.received) continue;
        sh.received = true;
        sh.receivedRef = m.receiptRef;      // the NetSuite item receipt
        sh.receivedOn = m.date;
        sh.autoReceived = true;             // distinguishes this from a human tick
      }
    });
  }, [nsRcpt, actuals.inbound]); // eslint-disable-line
  // Inventory model "as of" date — anchored to the last week of May (May 25,
  // 2026, a Monday on the week grid) since NJ's demand begins that week.
  // Nothing has shipped/been consumed before this, so the projection starts here.
  const today = new Date(2026, 4, 25);

  const fc = useMemo(() => calcSkuWeeklyForecast(sc.markets), [sc.markets]);
  const inv = useMemo(() => calcSkuInventory(actuals, fc, today), [actuals, fc]); // eslint-disable-line
  const mw = useMemo(() => calcSkuMarketWeekly(sc.markets), [sc.markets]);
  const grid = useMemo(() => buildWeekGrid(), []);

  // ── plan vs actual ─────────────────────────────────────────────────────────
  // Match each scheduled ship line to what NetSuite says actually left, so the
  // floor sees the plan tick itself off and — more usefully — sees what was
  // MISSED on a day where the rest of the load went out.
  const MKT_CODE = { "New Jersey": "NJ", "New York": "NY", Colorado: "CO", Massachusetts: "MA",
    Arizona: "AZ", Illinois: "IL", Michigan: "MI", Missouri: "MO", Montana: "MT",
    "New Mexico": "NM", Ohio: "OH", Oklahoma: "OK", Connecticut: "CT", Maryland: "MD" };
  // strip state prefixes and known naming drift so "New Jersey Sunrise" and
  // "Sunrise", or "Swift Recovery Bounce Back Cherry Cola" and "Swift Recovery
  // Cherry Cola", resolve to the same flavour
  const normName = (v) => String(v || "").toLowerCase()
    .replace(/^(new jersey|new york|colorado|arizona|illinois|michigan|montana|ohio|oklahoma|missouri|new mexico|connecticut|maryland|massachusetts)\s+/, "")
    .replace(/bounce back /g, "").replace(/rasberry/g, "raspberry")
    .replace(/[^a-z]/g, "");
  const actualIdx = useMemo(() => {
    const ix = {};
    for (const sh of nsShip || []) {
      const d = parseLocalDate(String(sh.ship_date || "").replace(/(\d+)\/(\d+)\/(\d+)/, (m, a, b, c) => `${c}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}`));
      const iso = isNaN(d) ? null : d.toISOString().slice(0, 10);
      for (const l of sh.lines || []) {
        // A LID row's sku is the PL- code and matches the plan directly. A BASE
        // row's sku is the shared PB- base, so it can only be tied back to a
        // flavour by name — normalise both sides before comparing.
        const key = l.component_type === "LID"
          ? l.sku
          : normName(String(l.flavor || "").replace(/\s*-\s*(BASE|LID)\s*$/i, ""));
        const k = `${sh.market}|${key}|${l.component_type}`;
        (ix[k] = ix[k] || []).push({ date: iso, qty: l.quantity_shipped, tracking: sh.tracking_display });
      }
    }
    return ix;
  }, [nsShip]);
  // a scheduled line counts as shipped if the same market+sku+kind moved within
  // four days of the planned date — carriers slip, the intent still matches
  const actualFor = (market, sku, kind, date, name) => {
    const key = kind === "LID" ? sku : normName(name);
    const hits = actualIdx[`${MKT_CODE[market] || market}|${key}|${kind}`] || [];
    let best = null;
    for (const h of hits) {
      if (!h.date) continue;
      const signed = Math.round((parseLocalDate(h.date) - parseLocalDate(date)) / 86400000);
      const diff = Math.abs(signed);
      // A ±4 day window was too tight: 2,592 Swift Recovery shipped Jul 31
      // against an Aug 5 plan line — five days — so it read as never shipped
      // while every other line on that truck reconciled. Teams ship ahead when
      // a truck is going anyway, so allow a fortnight either side and show the
      // drift rather than silently dropping the match.
      if (diff <= 14 && (!best || diff < best.diff)) best = { ...h, diff, drift: signed };
    }
    return best;
  };

  // ── shared mutation helpers ────────────────────────────────────────────────
  const updIn = (id, fn) => updActuals((a) => { const sh = a.inbound.find((s) => s.id === id); if (sh) fn(sh); });
  const updOut = (id, fn) => updActuals((a) => { const sh = a.outbound.find((s) => s.id === id); if (sh) fn(sh); });

  const addInbound = () => {
    const id = Date.now() + Math.random();
    updActuals((a) => a.inbound.unshift({ id, ref: "", factoryRef: "", shipDate: "", truckDate: "", railDate: "", received: false, lines: [] }));
    setExpShip(id);
  };
  const addOutbound = () => {
    const id = Date.now() + Math.random();
    const market = outMkt !== "All" ? outMkt : "New Jersey";
    updActuals((a) => a.outbound.unshift({ id, market, dateShipped: todayISO(), arriveBy: "", tracking: "", delivered: false, lines: [] }));
    setExpShip(id);
  };
  const autoBaseLines = (id) => updOut(id, (sh) => {
    let blk = 0, wht = 0;
    for (const l of sh.lines) {
      if (!l.sku || l.sku.startsWith("PB-")) continue;
      const info = skuInfo(l.sku);
      if (info.base === "Black Sparkle") blk += Number(l.qty) || 0; else wht += Number(l.qty) || 0;
    }
    const upsert = (sku, qty) => {
      if (!qty) return;
      const ex = sh.lines.find((l) => l.sku === sku);
      if (ex) ex.qty = qty; else sh.lines.push({ sku, qty });
    };
    upsert(BASE_TYPES["Black Sparkle"].sku, blk);
    upsert(BASE_TYPES["White"].sku, wht);
  });

  // ── overview grouping ──────────────────────────────────────────────────────
  const overviewGroups = useMemo(() => {
    const rows = Object.values(inv.perSku);
    const bases = rows.filter((r) => r.isBase).sort((a, b) => a.name.localeCompare(b.name));
    const blk = rows.filter((r) => !r.isBase && !r.key.startsWith("~") && r.base === "Black Sparkle").sort((a, b) => a.name.localeCompare(b.name));
    const wht = rows.filter((r) => !r.isBase && !r.key.startsWith("~") && r.base !== "Black Sparkle").sort((a, b) => a.name.localeCompare(b.name));
    const unm = rows.filter((r) => r.key.startsWith("~")).sort((a, b) => a.name.localeCompare(b.name));
    const out = [];
    if (bases.length) out.push({ name: "Bases (PB-)", color: "#334155", rows: bases });
    if (blk.length) out.push({ name: "Lids — Black Sparkle base", color: "#1a1a2e", rows: blk });
    if (wht.length) out.push({ name: "Lids — White / Custom Color base", color: "#64748b", rows: wht });
    if (unm.length) out.push({ name: "Unmapped", color: T.AM, rows: unm });
    return out;
  }, [inv]);

  const lineRows = (sh, kind) => {
    const lines = sh.lines || [];
    return (
      <div style={{ padding: "8px 10px", background: T.S2 + "55" }}>
        {lines.map((l, li) => (
          <div key={li} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <SkuSelect value={l.sku} onChange={(v) => (kind === "in" ? updIn : updOut)(sh.id, (s) => { s.lines[li].sku = v; })} />
            <span style={{ fontSize: 10, color: T.T2 }}>{skuInfo(l.sku).name !== l.sku ? skuInfo(l.sku).name : ""}</span>
            <span style={{ marginLeft: "auto" }}>
              <Ed value={l.qty || 0} onChange={(v) => (kind === "in" ? updIn : updOut)(sh.id, (s) => { s.lines[li].qty = Number(v) || 0; })} />
            </span>
            <button onClick={() => (kind === "in" ? updIn : updOut)(sh.id, (s) => s.lines.splice(li, 1))}
              style={{ border: "none", background: "transparent", color: T.T2, cursor: "pointer", fontSize: 12 }} title="Remove line">✕</button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
          <button onClick={() => (kind === "in" ? updIn : updOut)(sh.id, (s) => s.lines.push({ sku: "", qty: 0 }))}
            style={{ padding: "3px 9px", borderRadius: 4, border: "1px solid " + T.AC, background: T.AC + "10", color: T.AC, cursor: "pointer", fontSize: 10, fontWeight: 600 }}>+ Add line</button>
          {kind === "out" && (
            <button onClick={() => autoBaseLines(sh.id)} title="Adds PB- base quantities mirroring the lid lines 1:1 by base type"
              style={{ padding: "3px 9px", borderRadius: 4, border: "1px solid " + T.PU, background: T.PU + "10", color: T.PU, cursor: "pointer", fontSize: 10, fontWeight: 600 }}>Auto-add base lines</button>
          )}
          <span style={{ marginLeft: "auto", fontSize: 10, color: T.T2 }}>
            {fm(lines.reduce((a, l) => a + (Number(l.qty) || 0), 0))} units
          </span>
        </div>
      </div>
    );
  };

  const subBtn = (k, label) => (
    <button key={k} onClick={() => { setView(k); setExpShip(null); }} style={{ padding: "4px 12px", borderRadius: 999, cursor: "pointer", fontSize: 11, fontFamily: "inherit",
      border: "1px solid " + (view === k ? T.AC : T.BD), background: view === k ? T.AC : "transparent", color: view === k ? "#fff" : T.T2, fontWeight: view === k ? 700 : 500 }}>{label}</button>
  );

  const card = (label, value, sub, color) => (
    <div style={{ flex: "1 1 150px", background: T.S1, border: "1px solid " + T.BD, borderRadius: 7, padding: "10px 14px", borderLeft: "3px solid " + (color || T.AC) }}>
      <div style={{ fontSize: 9, color: T.T2, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 800, fontFamily: "'JetBrains Mono',monospace", color: color || T.TX }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: T.T2, marginTop: 1 }}>{sub}</div>}
    </div>
  );

  const targetChip = (r) => {
    if (!r.targetStatus) return <span style={{ color: T.BD }}>—</span>;
    if (r.targetStatus === "reorder") {
      const sev = r.moh < 1 ? { bg: "#fee2e2", bd: "#dc2626", tx: "#991b1b" } : { bg: "#fef3c7", bd: T.AM, tx: "#92400e" };
      return <Chip txt={`Reorder ${fm(r.reorderQty)}`} bg={sev.bg} bd={sev.bd} tx={sev.tx} title={`Position ${fm(Math.round(r.position))} < ROP ${fm(Math.round(r.rop))} — suggested order to Max in increments of ${fm(r.increment)}`} />;
    }
    if (r.targetStatus === "over") return <Chip txt="Over max" bg="#fef3c7" bd={T.AM} tx="#92400e" title={`Position ${fm(Math.round(r.position))} > Max ${fm(Math.round(r.tMax))}`} />;
    return <Chip txt="OK" bg="#dcfce7" bd={T.GR} tx="#166534" />;
  };

  // ── render ─────────────────────────────────────────────────────────────────
  const inboundSorted = useMemo(() => {
    const rank = (sh) => { if (sh.received) return 3; const e = shipmentEta(sh); if (!e) return 2; return e <= today ? 1 : 0; };
    return [...(actuals.inbound || [])].sort((a, b) => rank(a) - rank(b) || ((shipmentEta(a) || 0) - (shipmentEta(b) || 0)));
  }, [actuals.inbound]); // eslint-disable-line

  const outMarkets = useMemo(() => {
    const s = new Set(["New Jersey"]);
    (actuals.outbound || []).forEach((o) => o.market && s.add(o.market));
    (actuals.milestones || []).forEach((m) => m.market && s.add(m.market));
    return ["All", ...[...s].sort()];
  }, [actuals]);

  const outboundShown = (actuals.outbound || []).filter((o) => outMkt === "All" || o.market === outMkt);
  const milestonesShown = (actuals.milestones || []).filter((m) => outMkt === "All" || m.market === outMkt);

  const poRows = useMemo(() => {
    const keys = new Set([...(actuals.poLines || []).map((p) => p.sku), ...Object.values(inv.perSku).filter((r) => r.poRecvDerived > 0).map((r) => r.key)]);
    return [...keys].filter((k) => k && !k.startsWith("~")).map((k) => inv.perSku[k]).filter(Boolean)
      .sort((a, b) => (b.isBase ? 1 : 0) - (a.isBase ? 1 : 0) || a.name.localeCompare(b.name));
  }, [actuals.poLines, inv]);

  const ensurePo = (sku, fn) => updActuals((a) => {
    let p = a.poLines.find((x) => x.sku === sku);
    if (!p) { p = { sku, poQty: 0, adjQty: 0 }; a.poLines.push(p); }
    fn(p);
  });

  return (
    <div style={{ padding: "14px 18px" }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        {card("In transit (inbound)", fm(Math.round(inv.totals.inTransit)), inv.totals.nextArrival ? `next arrival ${dF(inv.totals.nextArrival)} · ${inv.totals.inTransitShipments} shipments` : `${inv.totals.inTransitShipments} shipments`, T.PU)}
        {card("SKUs at risk", fm(inv.totals.atRisk), "months on hand below 1.0", inv.totals.atRisk > 0 ? "#dc2626" : T.GR)}
        {card("Open PO remaining", fm(Math.round(inv.totals.poRemaining)), "not yet shipped from factory", T.AM)}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        {subBtn("overview", "Overview")}
        {subBtn("mrp", "MRP")}
        {subBtn("inbound", "Inbound (factory → Calyx)")}
        {subBtn("targets", "Targets")}
        {/* Factory Priority hidden — restore this line and HIDDEN_VIEWS below to bring it back */}
        {subBtn("apply", "Apply Schedule")}
        {subBtn("live", "Live Inventory (NS)")}
        <span style={{ marginLeft: "auto", fontSize: 9.5, color: T.T2 }}>forecast: scenario “{sc.name}”</span>
      </div>

      {inv.unscheduled.length > 0 && view !== "inbound" && (
        <div style={{ marginBottom: 10, fontSize: 10, color: "#92400e", background: "#fef3c7", border: "1px solid " + T.AM, borderRadius: 5, padding: "5px 10px" }}>
          ⚠ {inv.unscheduled.length} inbound shipment{inv.unscheduled.length > 1 ? "s" : ""} without dates ({inv.unscheduled.join(", ")}) — excluded from projections. Add dates or mark received in the Inbound view.
        </div>
      )}

      {(autoRcv.applied.length > 0 || autoRcv.possible.length > 0) && (
        <div style={{ marginBottom: 10, fontSize: 10, borderRadius: 5, padding: "6px 10px",
          color: "#166534", background: "#f0fdf4", border: "1px solid " + T.GR }}>
          {autoRcv.applied.length > 0 && (
            <div>
              ✓ {autoRcv.applied.length} inbound shipment{autoRcv.applied.length > 1 ? "s" : ""} marked received from NetSuite item receipts —{" "}
              {autoRcv.applied.map((a) => `${a.ref} → ${a.receiptRef} (${a.date})`).join(", ")}.
              <button onClick={() => {
                const ids = new Set(autoRcv.applied.map((a) => a.id));
                updActuals((d) => { for (const sh of d.inbound || []) if (ids.has(sh.id) && sh.autoReceived) {
                  sh.received = false; delete sh.receivedRef; delete sh.receivedOn; delete sh.autoReceived; } });
                setAutoRcv((p) => ({ ...p, applied: [] }));
              }} style={{ marginLeft: 8, padding: "1px 8px", borderRadius: 4, border: "1px solid " + T.GR,
                background: "transparent", color: "#166534", cursor: "pointer", fontSize: 9.5 }}>Undo</button>
            </div>
          )}
          {autoRcv.possible.length > 0 && (
            <div style={{ marginTop: autoRcv.applied.length ? 5 : 0, color: "#92400e" }}>
              ⚠ {autoRcv.possible.length} shipment{autoRcv.possible.length > 1 ? "s" : ""} partly match a receipt but not on every line — left unreceived for you to check:{" "}
              {autoRcv.possible.map((a) => `${a.ref} ≈ ${a.receiptRef} (${a.matched}/${a.lines} lines)`).join(", ")}.
            </div>
          )}
        </div>
      )}

      {view === "overview" && (
        <div style={{ background: T.S1, border: "1px solid " + T.BD, borderRadius: 6, overflowX: "auto" }}>
          <table style={{ ...tbl, fontSize: 11 }}>
            <thead><tr>
              <th style={{ ...th, minWidth: 170 }}>SKU / Item</th>
              <th style={{ ...th, textAlign: "right" }}>On hand</th>
              <th style={{ ...th, textAlign: "right" }}>In transit</th>
              <th style={{ ...th, textAlign: "right" }}>Next 4 wk dem.</th>
              <th style={{ ...th, textAlign: "center" }}>MOH</th>
              <th style={{ ...th, textAlign: "right" }}>Stockout</th>
              <th style={{ ...th, textAlign: "right" }}>ROP</th>
              <th style={{ ...th, textAlign: "center" }}>Target status</th>
              <th style={{ ...th, textAlign: "right" }}>PO open</th>
            </tr></thead>
            <tbody>
              {overviewGroups.map((grp) => [
                <tr key={"h" + grp.name}><td colSpan={9} style={{ ...td, background: T.S2, fontWeight: 700, fontSize: 10, color: grp.color, textTransform: "uppercase", letterSpacing: "0.5px" }}>{grp.name}</td></tr>,
                ...grp.rows.map((r) => {
                  const exp = expKey === r.key;
                  return [
                    <tr key={r.key} onClick={() => { setExpKey(exp ? null : r.key); setAdjVal(""); }} style={{ cursor: "pointer", background: exp ? T.AC + "0A" : undefined }}>
                      <td style={{ ...td }}>
                        <span style={{ color: T.T2, fontSize: 9, marginRight: 5 }}>{exp ? "▼" : "▶"}</span>
                        <span style={{ fontWeight: 600 }}>{r.name}</span>
                        <span style={{ fontSize: 9, color: T.T2, fontFamily: "'JetBrains Mono',monospace", marginLeft: 6 }}>{r.key.startsWith("~") ? "unmapped" : r.key}</span>
                      </td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, color: r.onHand < 0 ? "#dc2626" : T.TX }}>{fm(Math.round(r.onHand))}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "'JetBrains Mono',monospace" }}>
                        {r.inTransit > 0 ? <>{fm(Math.round(r.inTransit))} <span style={{ color: T.T2, fontSize: 9 }}>{dF(r.nextEta)}</span></> : <span style={{ color: T.BD }}>—</span>}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "'JetBrains Mono',monospace", color: r.fwd4wk > 0 ? T.TX : T.BD }}>{r.fwd4wk > 0 ? fm(Math.round(r.fwd4wk)) : "—"}</td>
                      <td style={{ ...td, textAlign: "center" }}><MohChip v={r} /></td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "'JetBrains Mono',monospace", color: r.stockoutIdx != null ? (r.moh < 1 ? "#dc2626" : "#92400e") : T.BD, fontWeight: r.stockoutIdx != null ? 700 : 400 }}>
                        {r.stockoutIdx != null ? dF(r.stockoutDate) : "—"}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "'JetBrains Mono',monospace", color: r.rop != null ? T.T2 : T.BD }}>{r.rop != null ? fm(Math.round(r.rop)) : "—"}</td>
                      <td style={{ ...td, textAlign: "center" }}>{targetChip(r)}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "'JetBrains Mono',monospace" }}>
                        {r.hasPo ? (r.poOver > 0 ? <Chip txt={`over ${fm(Math.round(r.poOver))}`} bg="#fef3c7" bd={T.AM} tx="#92400e" /> : fm(Math.round(r.poRemaining))) : <span style={{ color: T.BD }}>—</span>}
                      </td>
                    </tr>,
                    exp && (
                      <tr key={r.key + "x"}><td colSpan={9} style={{ ...td, background: T.AC + "07", padding: "10px 14px" }}>
                        <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 52, maxWidth: 560 }}>
                          {grid.slice(inv.todayIdx, inv.todayIdx + 13).map((g) => {
                            const v = r.proj[g.idx];
                            if (v == null) return null;
                            const maxAbs = Math.max(1, ...grid.slice(inv.todayIdx, inv.todayIdx + 13).map((x) => Math.abs(r.proj[x.idx] || 0)));
                            const h = Math.max(3, Math.round((Math.abs(v) / maxAbs) * 44));
                            const arr = r.arrivals[g.idx] > 0;
                            return <div key={g.idx} title={`${g.label}: ${fm(Math.round(v))}${arr ? ` (+${fm(Math.round(r.arrivals[g.idx]))} arriving)` : ""}`}
                              style={{ flex: 1, height: h, background: v < 0 ? "#dc2626" : arr ? T.GR : T.AC, borderRadius: "2px 2px 0 0", opacity: v < 0 ? 1 : 0.75 }} />;
                          })}
                        </div>
                        <div style={{ fontSize: 9, color: T.T2, margin: "4px 0 8px" }}>Projected stock next 13 weeks (arrivals − forecast) · green bar = arrival week · red = projected negative</div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <span style={{ fontSize: 10, color: T.T2 }}>Set actual counted on-hand:</span>
                          <input value={adjVal} onChange={(e) => setAdjVal(e.target.value)} placeholder={String(Math.round(r.onHand))}
                            style={{ width: 90, fontSize: 11, padding: "3px 6px", borderRadius: 4, border: "1px solid " + T.BD, fontFamily: "'JetBrains Mono',monospace", textAlign: "right" }} />
                          <button onClick={(e) => { e.stopPropagation(); const n = Number(adjVal); if (isNaN(n)) return;
                            const delta = Math.round(n - r.onHand);
                            if (delta === 0) return;
                            updActuals((a) => a.adjustments.push({ id: Date.now() + Math.random(), sku: r.key, date: todayISO(), delta, note: `Count true-up (${Math.round(r.onHand)} → ${Math.round(n)})` }));
                            setAdjVal(""); }}
                            style={{ padding: "3px 10px", borderRadius: 4, border: "1px solid " + T.AC, background: T.AC + "10", color: T.AC, cursor: "pointer", fontSize: 10, fontWeight: 600 }}>Apply adjustment</button>
                          <span style={{ fontSize: 9, color: T.T2 }}>stores a dated delta — received {fm(Math.round(r.received))} · shipped out {fm(Math.round(r.shippedOut))}</span>
                        </div>
                      </td></tr>
                    ),
                  ];
                }),
              ])}
            </tbody>
          </table>
          <div style={{ padding: "6px 12px", fontSize: 9, color: T.T2, borderTop: "1px solid " + T.BD }}>
            On hand = inbound received − outbound shipped ± adjustments (actual flows). Projection consumes the active scenario's item forecast. Base demand derives from lid forecast via base-type mapping; assorted maps to White. Position (for targets) = on hand + in transit + open PO.
          </div>
        </div>
      )}

      {view === "mrp" && (() => {
        const mrpCols = grid.slice(inv.todayIdx);
        const hasActivity = (r) => (mw.byKey[r.key] && Object.keys(mw.byKey[r.key]).length > 0) || r.onHand !== 0 || r.inTransit > 0;
        const visibleKeys = overviewGroups.flatMap((g) => g.rows.filter(hasActivity).map((r) => r.key));
        const exportMrp = async () => {
          const mod = await import("exceljs");
          const ExcelJS = mod.default || mod;
          const wb = new ExcelJS.Workbook();
          const ws = wb.addWorksheet("MRP", { views: [{ state: "frozen", xSplit: 1, ySplit: 5 }] });
          ws.columns = [{ width: 44 }, ...mrpCols.map(() => ({ width: 9.5 }))];

          const C = { // mirror src/utils/theme.js
            border: "FFD0D4DD", surface: "FFEEF0F4", text: "FF1A1A2E", muted: "FF6B7280",
            blue: "FF2563EB", blueTint: "FFE8F0FE", green: "FF16A34A", greenDark: "FF166534",
            redText: "FF991B1B", redFill: "FFFEE2E2", totalFill: "FFF5F6F8",
            groupColors: { "Bases (PB-)": "FF334155", "Lids — Black Sparkle base": "FF1A1A2E", "Lids — White / Custom Color base": "FF64748B", "Unmapped": "FFB45309" },
          };
          const thinBottom = { bottom: { style: "thin", color: { argb: C.border } } };
          const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

          const title = ws.addRow(["MRP — weekly demand vs projected on hand"]);
          title.getCell(1).font = { bold: true, size: 13, color: { argb: C.text } };
          const sub = ws.addRow([`Scenario: ${sc.name}   ·   Generated ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`]);
          sub.getCell(1).font = { size: 9, color: { argb: C.muted } };
          ws.addRow([]);

          const moRow = ws.addRow(["", ...mrpCols.map((g) => g.date.toLocaleDateString("en-US", { month: "long", year: "numeric" }))]);
          let start = 2;
          for (let i = 2; i <= mrpCols.length + 1; i++) {
            const isLast = i === mrpCols.length + 1;
            if (isLast || moRow.getCell(i + 1).value !== moRow.getCell(i).value) {
              if (i > start) ws.mergeCells(moRow.number, start, moRow.number, i);
              start = i + 1;
            }
          }
          moRow.eachCell((cell) => { cell.font = { bold: true, size: 9, color: { argb: C.text } }; cell.alignment = { horizontal: "center" }; cell.border = thinBottom; });

          const wkRow = ws.addRow(["SKU / week", ...mrpCols.map((g) => `${g.label}\nwk ${g.idx + 11}`)]);
          wkRow.height = 24;
          wkRow.eachCell((cell, col) => {
            cell.font = { bold: true, size: 8.5, color: { argb: C.muted } };
            cell.alignment = { horizontal: col === 1 ? "left" : "right", vertical: "bottom", wrapText: true };
            cell.border = { bottom: { style: "medium", color: { argb: C.border } } };
            if (col > 1 && mrpCols[col - 2].idx === inv.todayIdx) cell.fill = fill(C.blueTint);
          });

          const numFmt = "#,##0";
          for (const grp of overviewGroups) {
            const rows = grp.rows.filter(hasActivity);
            if (!rows.length) continue;
            const gRow = ws.addRow([grp.name.toUpperCase()]);
            ws.mergeCells(gRow.number, 1, gRow.number, mrpCols.length + 1);
            gRow.getCell(1).font = { bold: true, size: 8.5, color: { argb: C.groupColors[grp.name] || C.muted } };
            gRow.getCell(1).fill = fill(C.surface);

            for (const r of rows) {
              const code = r.key.startsWith("~") ? "unmapped" : r.key;
              const ohRow = ws.addRow([`${r.name}  (${code}) — projected on hand`, ...mrpCols.map((g) => (r.proj[g.idx] == null ? null : Math.round(r.proj[g.idx])))]);
              ohRow.eachCell({ includeEmpty: false }, (cell, col) => {
                cell.border = thinBottom;
                if (col === 1) { cell.font = { bold: true, size: 9.5, color: { argb: C.text } }; return; }
                cell.numFmt = numFmt;
                const v = cell.value;
                if (typeof v === "number" && v < 0) { cell.font = { bold: true, size: 9.5, color: { argb: C.redText } }; cell.fill = fill(C.redFill); }
                else cell.font = { bold: true, size: 9.5, color: { argb: C.text } };
              });

              const dm = mw.byKey[r.key] || {};
              for (const mname of Object.keys(dm)) {
                const mRow = ws.addRow([`        ${mname} demand`, ...mrpCols.map((g) => (dm[mname][g.idx] > 0 ? Math.round(dm[mname][g.idx]) : null))]);
                mRow.eachCell({ includeEmpty: false }, (cell, col) => {
                  cell.font = { size: 9, color: { argb: C.muted } };
                  if (col > 1) cell.numFmt = numFmt;
                });
              }
              const tRow = ws.addRow(["        Total demand", ...mrpCols.map((g) => (r.demand[g.idx] > 0 ? Math.round(r.demand[g.idx]) : null))]);
              tRow.eachCell({ includeEmpty: false }, (cell, col) => {
                cell.font = { bold: true, size: 9, color: { argb: C.muted } };
                cell.fill = fill(C.totalFill);
                if (col > 1) cell.numFmt = numFmt;
              });
              const rRow = ws.addRow(["        Receipts (in transit)", ...mrpCols.map((g) => (r.arrivals[g.idx] > 0 ? Math.round(r.arrivals[g.idx]) : null))]);
              rRow.eachCell({ includeEmpty: false }, (cell, col) => {
                cell.font = { bold: col > 1, size: 9, color: { argb: col === 1 ? C.green : C.greenDark } };
                cell.border = thinBottom;
                if (col > 1) cell.numFmt = "+#,##0";
              });
            }
          }

          ws.addRow([]);
          const note = ws.addRow(["On hand row = prior week balance + receipts − demand, starting from current on hand. Demand rows cover markets with item-level forecasts; base (PB-) demand derives from lid demand per market. Red = projected shortage."]);
          note.getCell(1).font = { italic: true, size: 8.5, color: { argb: C.muted } };

          const buf = await wb.xlsx.writeBuffer();
          const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `Wana-MRP-${todayISO()}.xlsx`;
          a.click();
          URL.revokeObjectURL(a.href);
        };
        const moGroups = [];
        for (const g of mrpCols) {
          const yr = g.date.getFullYear();
          const last = moGroups[moGroups.length - 1];
          if (last && last.mo === g.mo && last.yr === yr) last.span++;
          else moGroups.push({ mo: g.mo, yr, span: 1, label: g.date.toLocaleDateString("en-US", { month: "long", year: "numeric" }) });
        }
        const stickyName = { position: "sticky", left: 0, background: T.S1, zIndex: 1, minWidth: 196, maxWidth: 220, borderRight: "1px solid " + T.BD };
        const numCell = { ...td, textAlign: "right", fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, minWidth: 52, padding: "3px 6px" };
        // This week has to read as one continuous column the whole way down.
        // Tinting the header and the on-hand row alone lost it the moment the
        // table scrolled past a screen, which is where it is needed most. A
        // meaningful fill — a projected shortage — still wins over it.
        //
        // `inv.todayIdx` is where the projection is anchored (May 25 2026, the
        // week NJ demand begins), not the week we are in — the table starts
        // there, so testing against it just tints the leftmost column. The week
        // we are actually in is the last Monday on or before today.
        const nowKey = todayISO();
        const nowIdx = grid.reduce((acc, g) => (g.key <= nowKey ? g.idx : acc), -1);
        const nowCol = (g) => (g.idx === nowIdx ? T.AC + "12" : undefined);
        return (
          <div style={{ background: T.S1, border: "1px solid " + T.BD, borderRadius: 6 }}>
            <div style={{ padding: "8px 12px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, fontWeight: 700 }}>MRP — weekly demand vs projected on hand</span>
              <button onClick={() => setMrpCollapsed(new Set())} style={{ padding: "3px 9px", borderRadius: 4, border: "1px solid " + T.BD, background: "transparent", color: T.T2, cursor: "pointer", fontSize: 10 }}>Expand all</button>
              <button onClick={() => setMrpCollapsed(new Set(visibleKeys))} style={{ padding: "3px 9px", borderRadius: 4, border: "1px solid " + T.BD, background: "transparent", color: T.T2, cursor: "pointer", fontSize: 10 }}>Collapse all</button>
              <button onClick={exportMrp} style={{ padding: "3px 11px", borderRadius: 4, border: "1px solid " + T.GR, background: T.GR + "10", color: T.GR, cursor: "pointer", fontSize: 10, fontWeight: 700 }}>⬇ Download Excel</button>
              <span style={{ fontSize: 9.5, color: T.T2 }}>On hand row = prior week balance + receipts − demand, starting from current on hand. Click a SKU to toggle its market breakdown.</span>
            </div>
            <div style={{ overflow: "auto", maxHeight: "calc(100vh - 380px)" }}>
              <table style={{ ...tbl, fontSize: 10.5 }}>
                <thead>
                  <tr>
                    <th style={{ ...th, ...stickyName, zIndex: 3 }}></th>
                    {moGroups.map((g, i) => (
                      <th key={i} colSpan={g.span} style={{ ...th, textAlign: "center", color: T.TX, borderLeft: "1px solid " + T.BD }}>{g.label}</th>
                    ))}
                  </tr>
                  <tr>
                    <th style={{ ...th, ...stickyName, top: 29, zIndex: 3 }}>SKU / week</th>
                    {mrpCols.map((g) => (
                      <th key={g.idx} style={{ ...th, top: 29, textAlign: "right", minWidth: 52, background: g.idx === nowIdx ? T.AC + "24" : T.S1,
                        color: g.idx === nowIdx ? T.AC : undefined, fontWeight: g.idx === nowIdx ? 700 : undefined }}>
                        {g.label}<br /><span style={{ fontWeight: 400, color: T.T2 }}>wk {g.idx + 11}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {overviewGroups.map((grp) => {
                    const rows = grp.rows.filter(hasActivity);
                    if (!rows.length) return null;
                    return [
                      <tr key={"h" + grp.name}><td colSpan={mrpCols.length + 1} style={{ ...td, background: T.S2, fontWeight: 700, fontSize: 10, color: grp.color, textTransform: "uppercase", letterSpacing: "0.5px", position: "sticky", left: 0 }}>{grp.name}</td></tr>,
                      ...rows.map((r) => {
                        const collapsed = mrpCollapsed.has(r.key);
                        const dm = mw.byKey[r.key] || {};
                        const dmMarkets = Object.keys(dm);
                        const toggle = () => setMrpCollapsed((p) => { const n = new Set(p); n.has(r.key) ? n.delete(r.key) : n.add(r.key); return n; });
                        const out = [
                          <tr key={r.key} onClick={toggle} style={{ cursor: "pointer" }}>
                            <td style={{ ...td, ...stickyName, padding: "4px 8px" }}>
                              <span style={{ color: T.T2, fontSize: 9, marginRight: 4 }}>{collapsed ? "▶" : "▼"}</span>
                              <span style={{ fontWeight: 700, fontSize: 10.5 }}>{r.name}</span>
                              <div style={{ fontSize: 8.5, color: T.T2, fontFamily: "'JetBrains Mono',monospace", paddingLeft: 13 }}>{r.key.startsWith("~") ? "unmapped" : r.key} · on hand {fm(Math.round(r.onHand))}</div>
                            </td>
                            {mrpCols.map((g) => {
                              const v = r.proj[g.idx];
                              const neg = v != null && v < 0;
                              return <td key={g.idx} style={{ ...numCell, fontWeight: 700, color: neg ? "#991b1b" : T.TX, background: neg ? "#fee2e2" : nowCol(g) }}>{v == null ? "—" : fm(Math.round(v))}</td>;
                            })}
                          </tr>,
                        ];
                        if (!collapsed) {
                          for (const mname of dmMarkets) {
                            out.push(
                              <tr key={r.key + mname}>
                                <td style={{ ...td, ...stickyName, padding: "2px 8px 2px 22px", fontSize: 9.5, color: T.T2 }}>↳ {mname} demand</td>
                                {mrpCols.map((g) => { const v = dm[mname][g.idx]; return <td key={g.idx} style={{ ...numCell, color: v > 0 ? T.TX : T.BD, background: nowCol(g) }}>{v > 0 ? fm(Math.round(v)) : "—"}</td>; })}
                              </tr>
                            );
                          }
                          out.push(
                            <tr key={r.key + "tot"}>
                              <td style={{ ...td, ...stickyName, padding: "2px 8px 2px 22px", fontSize: 9.5, fontWeight: 700, color: T.T2 }}>Total demand</td>
                              {mrpCols.map((g) => { const v = r.demand[g.idx]; return <td key={g.idx} style={{ ...numCell, fontWeight: 600, color: v > 0 ? T.TX : T.BD, background: nowCol(g) || T.S2 + "44" }}>{v > 0 ? fm(Math.round(v)) : "—"}</td>; })}
                            </tr>,
                            <tr key={r.key + "rcv"}>
                              <td style={{ ...td, ...stickyName, padding: "2px 8px 2px 22px", fontSize: 9.5, color: T.GR }}>Receipts (in transit)</td>
                              {mrpCols.map((g) => {
                                const v = r.arrivals[g.idx];
                                const refs = (r.arrivalRefs && r.arrivalRefs[g.idx]) || [];
                                const tip = refs.map((a) => `${a.ref}: ${fm(a.qty)}`).join("\n");
                                return <td key={g.idx} title={v > 0 ? tip : undefined} style={{ ...numCell, color: v > 0 ? T.GR : T.BD, fontWeight: v > 0 ? 700 : 400, cursor: v > 0 ? "help" : "default", background: nowCol(g) }}>{v > 0 ? "+" + fm(Math.round(v)) : "—"}</td>;
                              })}
                            </tr>
                          );
                        }
                        return out;
                      }),
                    ];
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: "6px 12px", fontSize: 9, color: T.T2, borderTop: "1px solid " + T.BD }}>
              Demand rows show each market with item-level forecast (NJ, NY, CO, MA); base (PB-) demand derives from lid demand per market. Bold SKU row = projected on hand at end of each week; red = projected shortage.
            </div>
          </div>
        );
      })()}

      {view === "factory" && (() => {
        const startIdx = 21; // week 32 = Aug 3, 2026
        // Net requirements (lot-for-lot): per SKU, walk from the projected on-hand
        // entering week 32, netting each week's demand against available stock +
        // scheduled inbound receipts. Only the shortfall the factory must produce
        // is listed. Excludes open POs not yet shipped (see Open POs tab).
        const rows = [];
        for (const key of Object.keys(inv.perSku)) {
          const r = inv.perSku[key];
          let avail = (r.proj && r.proj[startIdx - 1] != null) ? r.proj[startIdx - 1] : (r.onHand || 0);
          for (let w = startIdx; w < grid.length; w++) {
            const supply = avail + (r.arrivals[w] || 0);
            const dem = r.demand[w] || 0;
            const net = dem - supply;
            if (net > 0.5) {
              rows.push({ key, name: r.name, cat: r.cat, isBase: r.isBase, qty: Math.round(net), idx: w, label: grid[w].label, wk: w + 11, date: grid[w].key });
              avail = 0; // produced exactly the shortfall this week
            } else {
              avail = -net; // leftover available carried forward
            }
          }
        }
        rows.sort((a, b) => a.idx - b.idx || (a.isBase ? 0 : 1) - (b.isBase ? 0 : 1) || b.qty - a.qty || a.name.localeCompare(b.name));
        const totalUnits = rows.reduce((a, r) => a + r.qty, 0);

        const exportFactory = async () => {
          const mod = await import("exceljs");
          const ExcelJS = mod.default || mod;
          const wb = new ExcelJS.Workbook();
          const ws = wb.addWorksheet("Factory Priority");
          ws.columns = [{ width: 7 }, { width: 11 }, { width: 18 }, { width: 30 }, { width: 16 }, { width: 14 }];
          const head = ["Week", "Date", "SKU", "Item", "Type", "Quantity"];
          const t = ws.addRow(["Factory Priority — net production requirements from week 32 (Aug 3, 2026)"]);
          t.getCell(1).font = { bold: true, size: 13 };
          ws.addRow([`Net of projected on-hand + scheduled inbound · Scenario: ${sc.name} · Generated ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · ${rows.length} line items, ${totalUnits.toLocaleString()} units`]).getCell(1).font = { size: 9, color: { argb: "FF6B7280" } };
          ws.addRow([]);
          const hr = ws.addRow(head);
          hr.eachCell((c) => { c.font = { bold: true, size: 10, color: { argb: "FF6B7280" } }; c.border = { bottom: { style: "medium", color: { argb: "FFD0D4DD" } } }; });
          ws.views = [{ state: "frozen", ySplit: hr.number }];
          rows.forEach((r, i) => {
            const row = ws.addRow([r.wk, r.label, r.isBase ? r.key : r.key, r.name, r.isBase ? "Base" : r.cat, r.qty]);
            row.getCell(6).numFmt = "#,##0";
          });
          const buf = await wb.xlsx.writeBuffer();
          const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
          const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `Wana-Factory-Priority-${todayISO()}.xlsx`; a.click(); URL.revokeObjectURL(a.href);
        };

        let lastWk = null;
        return (
          <div style={{ background: T.S1, border: "1px solid " + T.BD, borderRadius: 6 }}>
            <div style={{ padding: "8px 12px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, fontWeight: 700 }}>Factory Priority — net requirements from week 32 (Aug 3)</span>
              <button onClick={exportFactory} style={{ padding: "3px 11px", borderRadius: 4, border: "1px solid " + T.GR, background: T.GR + "10", color: T.GR, cursor: "pointer", fontSize: 10, fontWeight: 700 }}>⬇ Download Excel</button>
              <span style={{ marginLeft: "auto", fontSize: 10, color: T.T2 }}>{rows.length} line items · {fm(totalUnits)} net units · ordered by need date</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ ...tbl, fontSize: 11 }}>
                <thead><tr>
                  <th style={{ ...th, width: 44, textAlign: "right" }}>#</th>
                  <th style={{ ...th, width: 96 }}>Week</th>
                  <th style={{ ...th }}>SKU</th>
                  <th style={{ ...th }}>Item</th>
                  <th style={{ ...th, width: 130 }}>Type</th>
                  <th style={{ ...th, textAlign: "right" }}>Quantity</th>
                </tr></thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={6} style={{ ...td, color: T.T2, textAlign: "center", padding: 20 }}>No production demand from week 32 onward in this scenario.</td></tr>}
                  {rows.map((r, i) => {
                    const newWk = r.wk !== lastWk; lastWk = r.wk;
                    return (
                      <tr key={r.key + r.idx} style={{ borderTop: newWk ? "2px solid " + T.BD : undefined }}>
                        <td style={{ ...td, textAlign: "right", color: T.T2, fontFamily: "'JetBrains Mono',monospace" }}>{i + 1}</td>
                        <td style={{ ...td, fontFamily: "'JetBrains Mono',monospace", fontWeight: newWk ? 700 : 400, color: newWk ? T.TX : T.T2 }}>{r.label}<span style={{ fontSize: 9, color: T.T2 }}> · wk {r.wk}</span></td>
                        <td style={{ ...td, fontFamily: "'JetBrains Mono',monospace", fontSize: 10 }}>{r.key.startsWith("~") ? "—" : r.key}</td>
                        <td style={{ ...td, fontWeight: 500 }}>{r.name}</td>
                        <td style={{ ...td }}><span style={{ fontSize: 9.5, color: r.isBase ? "#334155" : T.T2, background: T.S2, borderRadius: 3, padding: "1px 6px" }}>{r.isBase ? "Base" : r.cat}</span></td>
                        <td style={{ ...td, textAlign: "right", fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{fm(r.qty)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: "6px 12px", fontSize: 9, color: T.T2, borderTop: "1px solid " + T.BD }}>
              Net requirements (lot-for-lot): each row is the quantity the factory must produce that week after netting demand against projected on-hand + scheduled inbound receipts (scenario "{sc.name}"), ordered by need date. Bases (PB-) derived from lid demand. Does not deduct open POs not yet shipped — cross-check the Open POs tab. Heavy line = new week.
            </div>
          </div>
        );
      })()}

      {view === "apply" && (() => {
        const aps = actuals.applySchedule || { capacity: 12474, log: [], overrides: {} };
        // Always plan across every market, then filter for display. Planning a
        // single market makes the scheduler hand that market the entire
        // application line, which produces a schedule that cannot happen:
        // filtered to New York the plan applied its bases Aug 3-4 and shipped
        // 128,142 units on Aug 7, when in reality New Jersey and Colorado hold
        // that capacity and New York's labels do not run until Aug 10-31.
        // The filter is a lens on one plan, never a plan of its own.
        const full = buildApplySchedule({
          mw, grid, actuals, today: new Date(), startDate: aps.startDate || undefined,
          capacity: aps.capacity, log: aps.log, overrides: aps.overrides,
          preApplied: aps.preApplied || {}, marketStock: actuals.marketStock || {},
          pinned: aps.pinned || [], numDays: 40, market: "All",
        });
        // Which order each shipment is booked against. Allocated over the whole
        // plan, never the filtered view — the order a line draws on must not
        // depend on which market the screen happens to be showing.
        const soAlloc = allocateSalesOrders({
          days: full.days, salesOrders: nsSO,
          marketCode: (m) => MKT_CODE[m] || m,
          itemSku: (l) => (l.kind === "BASE" ? baseSkuFor(l.sku) : l.sku),
          isShipped: (l, date) => !!actualFor(l.market, l.sku, l.kind, date, l.name),
        });
        const sched = applyMkt === "All" ? full : (() => {
          const keep = (r) => r.market === applyMkt;
          const days = full.days
            // `applied` stays the whole line's load — the capacity bar has to
            // keep telling the truth about contention, or the filtered view
            // implies headroom that another market is already using.
            .map((d) => ({ ...d, apply: (d.apply || []).filter(keep), ship: (d.ship || []).filter(keep) }))
            .filter((d) => d.apply.length || d.ship.length);
          return { ...full, days };
        })();
        const firstDay = sched.days.length ? sched.days[0].date : "";
        const updSched = (fn) => updActuals((a) => {
          if (!a.applySchedule) a.applySchedule = { capacity: 12474, log: [], overrides: {} };
          if (!Array.isArray(a.applySchedule.log)) a.applySchedule.log = [];
          if (!a.applySchedule.overrides) a.applySchedule.overrides = {};
          fn(a.applySchedule);
        });
        // `side` is which half of the grid was ticked — applying a base and
        // shipping it are separate jobs on separate days, so completing one
        // must not tick the other off.
        const setDone = (line, date, on, side) => updSched((s) => {
          const k = slotKey(date, line.market, line.sku, line.kind);
          const same = (e) => e.date === date && e.market === line.market && e.sku === line.sku && e.kind === line.kind;
          if (on) {
            if (!s.log.some((e) => same(e) && (e.side || "both") === side)) {
              s.log.push({ date, market: line.market, sku: line.sku, kind: line.kind, side,
                units: line.units, due: line.due, preApplied: !!line.preApplied });
            }
            delete s.overrides[k];
            // Only drop the pin for the side just completed; the other half of
            // an agreed day stays pinned.
            if (Array.isArray(s.pinned) && side === "ship")
              s.pinned = s.pinned.filter((p) => !(p.date === date && p.market === line.market && p.sku === line.sku && p.kind === line.kind));
          } else {
            // Remove this side's entry, and any legacy entry with no side —
            // those completed both halves, so they must go or the tick returns.
            for (let i = s.log.length - 1; i >= 0; i--) {
              const e = s.log[i], es = e.side || "both";
              if (same(e) && (es === side || es === "both")) s.log.splice(i, 1);
            }
          }
        });
        const setQty = (line, date, v) => updSched((s) => {
          const k = slotKey(date, line.market, line.sku, line.kind);
          const box = line.kind === "BASE" ? BASE_BOX : LID_BOX;
          const snapped = Math.max(0, Math.round((Number(v) || 0) / box) * box);
          if (snapped === line.units) delete s.overrides[k]; else s.overrides[k] = snapped;
        });
        const dF2 = (s) => { const d = parseLocalDate(s); return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); };

        const exportApply = async () => {
          const mod = await import("exceljs"); const ExcelJS = mod.default || mod;
          const wb = new ExcelJS.Workbook();
          const mk = (name, rows) => {
            const ws = wb.addWorksheet(name);
            ws.columns = [{ width: 16 }, { width: 16 }, { width: 30 }, { width: 11 }, { width: 11 }, { width: 9 }, { width: 12 }, { width: 20 }];
            const h = ws.addRow(["Date", "Market", "Item", "Base", "Qty", "Boxes", "Needed by", "Ship against SO"]);
            h.eachCell((c) => { c.font = { bold: true, size: 9 }; });
            rows.forEach((r) => ws.addRow(r));
          };
          mk("Application", sched.days.flatMap((d) => d.apply.map((l) => [dF2(d.date), l.market, `${l.name} – BASE`, l.baseColor, l.units, l.boxes, l.due || ""])));
          // The order to book against travels with the export — the sheet is what
          // reaches the floor, so it has to answer this without the screen.
          const soText = (l) => {
            const a = soAlloc[l.key];
            if (!a || a.confirmed) return "";
            if (!a.parts.length) return "no open SO";
            return a.parts.map((p) => p.so).join(" · ") + (a.short > 0 ? " · needs a new SO" : "");
          };
          mk("Shipping", sched.days.flatMap((d) => d.ship.map((l) => [dF2(d.date), l.market, `${l.name} – ${l.kind}`, l.kind === "BASE" ? l.baseColor : "", l.units, l.boxes, l.due || "", soText(l)])));
          const buf = await wb.xlsx.writeBuffer();
          const a = document.createElement("a");
          a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
          a.download = `Wana-Apply-Ship-${todayISO()}.xlsx`; a.click(); URL.revokeObjectURL(a.href);
        };

        const cellN = { ...td, textAlign: "right", fontFamily: "'JetBrains Mono',monospace", fontSize: 10 };
        const badge = (l) => (
          <>
            {l.pinned && <span title="Agreed by the team — kept exactly as entered" style={{ marginLeft: 4, fontSize: 7.5, color: T.AC, border: "1px solid " + T.AC + "66", borderRadius: 3, padding: "0 3px" }}>pinned</span>}
            {l.partial && <span title="Split to cover this market's need date — the rest of this flavour runs on a later day" style={{ marginLeft: 4, fontSize: 7.5, color: "#92400e", border: "1px solid " + T.AM, borderRadius: 3, padding: "0 3px" }}>part run</span>}
            {l.preApplied && <span title="Already applied — no capacity used" style={{ marginLeft: 4, fontSize: 7.5, color: T.GR, border: "1px solid " + T.GR + "66", borderRadius: 3, padding: "0 3px" }}>pre</span>}
          </>
        );
        // When the market actually needs this line. The scheduler already
        // stamps `due` — the first week its demand goes uncovered — so the tag
        // answers "are we shipping this in time?" without leaving the row.
        const demandTag = (l, date) => {
          if (!l.due) return null;
          const daysLate = Math.round((new Date(date) - new Date(l.due)) / 86400000);
          const late = daysLate > 0;
          const early = -daysLate;
          return (
            <span title={late
                ? `Market demand starts ${dF2(l.due)} — this leaves Calyx ${daysLate} day${daysLate > 1 ? "s" : ""} after that, before any transit time`
                : `Market demand starts ${dF2(l.due)} — leaves Calyx ${early > 0 ? `${early} day${early > 1 ? "s" : ""} ahead of it` : "the same day"}, before any transit time`}
              style={{ marginLeft: 4, fontSize: 7.5, fontWeight: 700, borderRadius: 3, padding: "0 3px",
                whiteSpace: "nowrap",
                color: late ? "#92400e" : T.T2,
                border: "1px solid " + (late ? T.AM : T.BD),
                background: late ? "#fffbeb" : "transparent" }}>
              {late ? `⚠ needed ${dF2(l.due)} · ${daysLate}d late` : `needed ${dF2(l.due)}`}
            </span>
          );
        };

        // The order the floor books this shipment against. A market and SKU can
        // sit on more than one open order — New Jersey runs two, Colorado three
        // — so a line that outruns the oldest one names every order it spans.
        const soTag = (l) => {
          const a = soAlloc[l.key];
          if (!a || a.confirmed) return null;      // already gone; the ✓ says so
          const box = { marginLeft: 4, fontSize: 7.5, fontWeight: 700, borderRadius: 3,
            padding: "0 3px", whiteSpace: "nowrap", fontFamily: "'JetBrains Mono',monospace" };
          if (!a.parts.length) return (
            <span title={`No open sales order covers ${a.item} for ${l.market} — raise one in NetSuite before this ships`}
              style={{ ...box, color: "#92400e", border: "1px solid " + T.AM, background: "#fffbeb" }}>
              no open SO
            </span>
          );
          const detail = a.parts.map((p) => `${p.so}${p.custPo ? ` · PO ${p.custPo}` : ""} — ${fm(p.units)} units`).join("\n");
          return (
            <span title={`Ship against ${a.item}\n${detail}` + (a.short > 0
                ? `\n\n⚠ ${fm(a.short)} units are beyond every open order — needs a new SO`
                : "")}
              style={{ ...box, color: T.PU, border: "1px solid " + T.PU + "66", background: T.PU + "0F" }}>
              {a.parts.map((p) => p.so).join(" · ")}{a.short > 0 ? " ⚠" : ""}
            </span>
          );
        };

        const lineRow = (l, date, showBase, st) => (
          <tr key={l.key} style={{
            background: st && st.shipped ? "#dcfce7" : st && st.missed ? "#fef3c7" : (l.done ? T.S2 + "AA" : undefined),
            opacity: (l.done && !st) ? 0.5 : 1 }}>
            <td style={{ ...td, fontSize: 9.5, fontWeight: 600, textDecoration: l.done ? "line-through" : undefined }}>{l.market}</td>
            <td style={{ ...td, fontSize: 9.5, textDecoration: l.done ? "line-through" : undefined }}>
              {l.name} <span style={{ fontWeight: 700 }}>– {l.kind}</span>{badge(l)}
              {!showBase && demandTag(l, date)}
              {!showBase && soTag(l)}
              {st && st.shipped && <span title={`Confirmed in NetSuite${st.a.tracking ? " — " + st.a.tracking : ""}${st.a.date ? ` — shipped ${st.a.date}` : ""}`} style={{ marginLeft: 4, fontSize: 7.5, color: T.GR, border: "1px solid " + T.GR, borderRadius: 3, padding: "0 3px", fontWeight: 700 }}>
                ✓ shipped {fm(st.a.qty)}{st.a.drift ? ` · ${Math.abs(st.a.drift)}d ${st.a.drift < 0 ? "early" : "late"}` : ""}
              </span>}
              {st && st.missed && <span title="Other lines on this day shipped, this one did not" style={{ marginLeft: 4, fontSize: 7.5, color: "#92400e", border: "1px solid " + T.AM, borderRadius: 3, padding: "0 3px", fontWeight: 700 }}>⚠ not shipped</span>}
              {l.reason && <div style={{ fontSize: 8, color: T.T2 }}>{l.reason}</div>}
            </td>
            {showBase && <td style={{ ...td, textAlign: "center" }}>
              <span style={{ fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 3, border: "1px solid " + T.BD, background: l.baseColor === "Black" ? "#1a1a2e" : "#f1f5f9", color: l.baseColor === "Black" ? "#fff" : "#334155" }}>{l.baseColor}</span>
            </td>}
            <td style={cellN}>
              {st && st.shipped
                ? <span title={`Planned ${fm(l.units)} — NetSuite says ${fm(st.a.qty)} shipped`} style={{ fontWeight: 700, color: T.GR }}>
                    {fm(st.a.qty)}{st.a.qty !== l.units && <span style={{ color: T.T2, fontWeight: 400 }}> ({fm(l.units)} plan)</span>}
                  </span>
                : (l.done ? fm(l.units) : <Ed value={l.units} onChange={(v) => setQty(l, date, v)} style={{ color: l.edited ? T.AM : "#1e40af", fontSize: 10 }} />)}
            </td>
            <td style={{ ...cellN, color: T.T2 }}>{fm(l.boxes)}</td>
            <td style={{ ...td, textAlign: "center" }}>
              <input type="checkbox" checked={!!l.done || !!(st && st.shipped)} readOnly={!!(st && st.shipped)}
                title={st && st.shipped ? "Confirmed shipped in NetSuite" : undefined}
                onChange={(e) => { if (!(st && st.shipped)) setDone(l, date, e.target.checked, showBase ? "apply" : "ship"); }}
                style={{ cursor: st && st.shipped ? "default" : "pointer" }} />
            </td>
          </tr>
        );

        const pane = (title, sub, colour, pick, showBase) => (
          <div style={{ flex: 1, minWidth: 380, background: T.S1, border: "1px solid " + T.BD, borderRadius: 6, overflow: "hidden" }}>
            <div style={{ padding: "6px 10px", background: colour + "12", borderBottom: "1px solid " + T.BD }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: colour }}>{title}</span>
              <span style={{ marginLeft: 8, fontSize: 9, color: T.T2 }}>{sub}</span>
            </div>
            <div style={{ overflow: "auto", maxHeight: "calc(100vh - 420px)" }}>
              <table style={{ ...tbl, fontSize: 10 }}>
                <thead><tr>
                  <th style={{ ...th, minWidth: 84 }}>Market</th>
                  <th style={{ ...th, minWidth: 160 }}>Item</th>
                  {showBase && <th style={{ ...th, textAlign: "center", minWidth: 48 }}>Base</th>}
                  <th style={{ ...th, textAlign: "right", minWidth: 68 }}>Qty</th>
                  <th style={{ ...th, textAlign: "right", minWidth: 46 }}>Bx</th>
                  <th style={{ ...th, textAlign: "center", minWidth: 34 }}>✓</th>
                </tr></thead>
                <tbody>
                  {sched.days.every((d) => pick(d).length === 0) &&
                    <tr><td colSpan={showBase ? 6 : 5} style={{ ...td, textAlign: "center", color: T.T2, padding: 16 }}>Nothing scheduled.</td></tr>}
                  {sched.days.map((d) => {
                    const rows = pick(d);
                    if (!rows.length) return null;
                    // reconcile only the shipping pane against NetSuite actuals
                    const stat = {};
                    if (!showBase) {
                      let any = false;
                      for (const l of rows) { const a = actualFor(l.market, l.sku, l.kind, d.date, l.name); if (a) { stat[l.key] = { shipped: true, a }; any = true; } }
                      if (any) for (const l of rows) if (!stat[l.key]) stat[l.key] = { missed: true };
                    }
                    const applied = d.apply.reduce((a, l) => a + (l.preApplied ? 0 : l.units), 0);
                    const over = applied > aps.capacity;
                    return [
                      <tr key={"h" + d.date}>
                        <td colSpan={showBase ? 6 : 5} style={{ ...td, background: T.S2, fontWeight: 700, fontSize: 10, position: "sticky", left: 0 }}>
                          {showBase ? "Apply " : "Ship "}{dF2(d.date)}
                          <span style={{ marginLeft: 8, fontWeight: 400, fontFamily: "'JetBrains Mono',monospace", color: showBase ? (over ? "#991b1b" : T.T2) : T.T2 }}>
                            {showBase ? `${fm(applied)} / ${fm(aps.capacity)} (${Math.round((applied / aps.capacity) * 100)}%)`
                              : `${fm(rows.reduce((a, l) => a + l.units, 0))} units`}
                          </span>
                          {showBase && over && (
                            <span title="A single flavour's run cannot be split, so this day holds more than the line can physically do. Add a shift or raise capacity."
                              style={{ marginLeft: 6, fontSize: 8, fontWeight: 700, color: "#991b1b",
                                background: "#fee2e2", border: "1px solid #dc2626", borderRadius: 3, padding: "0 4px" }}>
                              ⚠ {fm(applied - aps.capacity)} over · {(applied / aps.capacity).toFixed(1)} days of line time
                            </span>
                          )}
                          <span style={{ display: "none" }}>
                          </span>
                        </td>
                      </tr>,
                      ...rows.map((l) => lineRow(l, d.date, showBase, stat[l.key])),
                    ];
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );

        return (
          <div>
            <div style={{ background: T.S1, border: "1px solid " + T.BD, borderRadius: 6, padding: "8px 12px", marginBottom: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, fontWeight: 700 }}>Apply &amp; ship schedule</span>
              <label style={{ fontSize: 10, color: T.T2, display: "flex", alignItems: "center", gap: 4 }}>
                Market
                <select value={applyMkt} onChange={(e) => setApplyMkt(e.target.value)}
                  style={{ background: T.S2, border: "1px solid " + T.BD, color: T.AC, borderRadius: 3, padding: "2px 5px", fontSize: 11, fontFamily: "inherit" }}>
                  <option value="All">All markets</option>
                  {sched.markets.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 10, color: T.T2, display: "flex", alignItems: "center", gap: 4 }}>
                Capacity/day
                <input type="number" min={aps.capMin ?? CAP_MIN} max={aps.capMax ?? CAP_MAX} step={BASE_BOX} value={aps.capacity}
                  onChange={(e) => { const v = Math.min(aps.capMax ?? CAP_MAX, Math.max(aps.capMin ?? CAP_MIN, Number(e.target.value) || (aps.capMin ?? CAP_MIN))); updSched((s) => { s.capacity = v; }); }}
                  style={{ width: 74, background: T.S2, border: "1px solid " + T.BD, color: T.AC, borderRadius: 3, padding: "2px 5px", fontSize: 11, fontFamily: "'JetBrains Mono',monospace" }} />
              </label>
              <label style={{ fontSize: 10, color: T.T2, display: "flex", alignItems: "center", gap: 4 }}>
                Starts <DateEd value={aps.startDate || firstDay} onChange={(v) => updSched((s) => { s.startDate = v || ""; })} />
              </label>
              <button onClick={exportApply} style={{ padding: "3px 11px", borderRadius: 4, border: "1px solid " + T.GR, background: T.GR + "10", color: T.GR, cursor: "pointer", fontSize: 10, fontWeight: 700 }}>⬇ Excel</button>
              {aps.log.length > 0 && (
                <button onClick={() => { if (window.confirm(`Clear all ${aps.log.length} completed lines?`)) updSched((s) => { s.log = []; }); }}
                  style={{ padding: "3px 9px", borderRadius: 4, border: "1px solid " + T.BD, background: "transparent", color: T.T2, cursor: "pointer", fontSize: 10 }}>Reset completed</button>
              )}
              {[["To apply", fm(Math.round(sched.totals.toApply)), T.PU],
                ["To ship", fm(Math.round(sched.totals.toShip)), T.AC],
                ["Completed", fm(Math.round(sched.totals.done)), T.GR],
                ["Not yet applied", fm(Math.round(sched.totals.unapplied)), sched.totals.unapplied > 0 ? T.AM : T.T2]].map(([l, v, c], i) => (
                <div key={i} style={{ background: T.S2, borderRadius: 5, padding: "3px 9px", border: "1px solid " + T.BD }}>
                  <div style={{ color: T.T2, fontSize: 8, textTransform: "uppercase" }}>{l}</div>
                  <div style={{ color: c, fontSize: 12.5, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{v}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
              {pane("① APPLICATION — Calyx floor", "labels onto bases · the bottleneck", T.PU, (d) => d.apply, true)}
              {pane("② SHIPPING — to market", "leaves the day after its lids land", T.AC, (d) => d.ship, false)}
            </div>

            <div style={{ marginTop: 8, fontSize: 9, color: T.T2 }}>
              Application runs as early as base stock allows — ahead of lid arrival — so a market ships the day after its lids reach Calyx. Bases pairing with lids the market already holds ship the next business day. Lid boxes {fm(LID_BOX)} · base boxes {fm(BASE_BOX)}.
              {sched.queueLeft.length > 0 && <> <span style={{ color: "#92400e" }}>⚠ {fm(Math.round(sched.totals.unapplied))} units can&rsquo;t be applied in this window — base stock hasn&rsquo;t landed.</span></>}
            </div>
          </div>
        );
      })()}


      {view === "live" && (() => {
        const all = nsInv.rows.filter((r) => r.onHand !== 0 || r.available !== 0)
          .map((r) => ({ ...r, flag: inventoryFlag(
            buildReconciliation({ sku: r.sku, onHand: r.onHand, receipts: nsRcpt, shipments: nsShip, actuals }),
            r.onHand) }));
        const suspect = all.filter((r) => r.flag.rank >= 2);
        const rows = flagOnly ? suspect : all;
        const tot = rows.reduce((a, r) => a + r.onHand, 0);
        const bases = rows.filter((r) => r.sku.startsWith("PB-")).reduce((a, r) => a + r.onHand, 0);
        const numC = { ...td, textAlign: "right", fontFamily: "'JetBrains Mono',monospace", fontSize: 11 };
        return (
          <div style={{ background: T.S1, border: "1px solid " + T.BD, borderRadius: 6 }}>
            <div style={{ padding: "8px 12px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, fontWeight: 700 }}>Live inventory — NetSuite</span>
              <button onClick={loadNsInv} style={{ padding: "3px 10px", borderRadius: 4, border: "1px solid " + T.BD, background: "transparent", color: T.T2, cursor: "pointer", fontSize: 10 }}>↻ Refresh</button>
              <label style={{ fontSize: 10, color: T.T2, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                <input type="checkbox" checked={flagOnly} onChange={(e) => setFlagOnly(e.target.checked)} /> Flagged only
              </label>
              {[["SKUs", fm(rows.length), T.AC], ["Total on hand", fm(tot), T.TX],
                ["Bases", fm(bases), T.GR], ["Lids", fm(tot - bases), T.PU],
                ["Need review", fm(suspect.length), suspect.length ? "#b45309" : T.GR]].map(([l, v, c], i) => (
                <div key={i} style={{ background: T.S2, borderRadius: 5, padding: "3px 9px", border: "1px solid " + T.BD }}>
                  <div style={{ color: T.T2, fontSize: 8, textTransform: "uppercase" }}>{l}</div>
                  <div style={{ color: c, fontSize: 12.5, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{v}</div>
                </div>
              ))}
              <span style={{ marginLeft: "auto", fontSize: 9, color: T.T2 }}>
                {nsInv.loading ? "loading…" : nsInv.at ? `synced ${new Date(nsInv.at).toLocaleString()}` : "not synced yet"}
              </span>
            </div>
            {nsInv.err && <div style={{ margin: "0 12px 8px", fontSize: 10, color: "#991b1b" }}>Could not load: {nsInv.err}</div>}
            {!nsInv.loading && !rows.length && (
              <div style={{ padding: 20, textAlign: "center", fontSize: 11, color: T.T2 }}>
                No inventory yet — the sync writes this at 6am and noon. Press Refresh after the next run.
              </div>
            )}
            <div style={{ overflow: "auto", maxHeight: "calc(100vh - 320px)" }}>
              <table style={{ ...tbl, fontSize: 11 }}>
                <thead><tr>
                  <th style={{ ...th, minWidth: 128 }}>SKU</th>
                  <th style={{ ...th, minWidth: 240 }}>Item</th>
                  <th style={{ ...th, minWidth: 130 }}>Location</th>
                  <th style={{ ...th, textAlign: "right" }}>On hand</th>
                  <th style={{ ...th, textAlign: "right" }}>Available</th>
                  <th style={{ ...th, minWidth: 128 }}>Check</th>
                </tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.sku + i}>
                      <td style={{ ...td, fontFamily: "'JetBrains Mono',monospace", fontSize: 10 }}>{r.sku}</td>
                      <td style={{ ...td }}>{String(r.name || "").split(":")[0]}</td>
                      <td style={{ ...td, color: T.T2, fontSize: 10 }}>{r.location}</td>
                      <td onClick={() => setRecon(r)} title="Reconcile against the dashboard"
                        style={{ ...numC, fontWeight: 700, cursor: "pointer",
                          color: r.onHand < 0 ? "#991b1b" : T.AC,
                          background: r.onHand < 0 ? "#fee2e2" : undefined,
                          textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 2 }}>{fm(r.onHand)}</td>
                      <td style={{ ...numC, color: T.T2 }}>{fm(r.available)}</td>
                      <td style={{ ...td }} title={r.flag.why}>
                        <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 3,
                          color: r.flag.color, background: r.flag.bg, whiteSpace: "nowrap",
                          fontFamily: r.flag.key === "gap" ? "'JetBrains Mono',monospace" : "inherit" }}>
                          {r.flag.rank >= 2 ? "⚠ " : r.flag.key === "ok" ? "✓ " : ""}{r.flag.label}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: "6px 12px", fontSize: 9, color: T.T2, borderTop: "1px solid " + T.BD }}>
              Straight from NetSuite inventory balances by location — the true count, refreshed with the shipment sync. Negative on hand means units shipped against stock that has not been receipted yet. Click any on-hand figure to reconcile it against the dashboard ledger.
            </div>
          </div>
        );
      })()}

      {recon && (
        <InventoryReconcile sku={recon.sku} name={recon.name} onHand={recon.onHand}
          receipts={nsRcpt} shipments={nsShip} actuals={actuals} onClose={() => setRecon(null)} />
      )}

      {view === "inbound" && (
        <div style={{ background: T.S1, border: "1px solid " + T.BD, borderRadius: 6, overflowX: "auto" }}>
          <div style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={addInbound} style={{ padding: "4px 12px", borderRadius: 5, border: "1px solid " + T.GR, background: T.GR + "10", color: T.GR, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>+ Add inbound shipment</button>
            <span style={{ fontSize: 10, color: T.T2 }}>Set ETA directly, or it derives from the latest leg date. Click a row to edit line items.</span>
          </div>
          <table style={{ ...tbl, fontSize: 11 }}>
            <thead><tr>
              <th style={{ ...th }}>Ref</th><th style={{ ...th }}>Factory #</th>
              <th style={{ ...th }}>Ship</th><th style={{ ...th }}>Trucking</th><th style={{ ...th }}>Rail</th>
              <th style={{ ...th }}>ETA</th><th style={{ ...th }}>Status</th>
              <th style={{ ...th, textAlign: "right" }}>Units</th><th style={{ ...th }}></th>
            </tr></thead>
            <tbody>
              {inboundSorted.length === 0 && <tr><td colSpan={9} style={{ ...td, color: T.T2, textAlign: "center", padding: 20 }}>No inbound shipments yet — add the CP shipments from the factory.</td></tr>}
              {inboundSorted.map((sh) => {
                const exp = expShip === sh.id;
                const units = (sh.lines || []).reduce((a, l) => a + (Number(l.qty) || 0), 0);
                return [
                  <tr key={sh.id} style={{ background: exp ? T.AC + "0A" : undefined }}>
                    <td style={{ ...td, fontWeight: 700 }}>
                      <span onClick={() => setExpShip(exp ? null : sh.id)} title={exp ? "Collapse" : "Expand line items"} style={{ color: T.T2, fontSize: 9, marginRight: 4, cursor: "pointer" }}>{exp ? "▼" : "▶"}</span>
                      <Ed value={sh.ref || ""} type="text" onChange={(v) => updIn(sh.id, (s) => { s.ref = v; })} />
                    </td>
                    <td style={{ ...td }}><Ed value={sh.factoryRef || ""} type="text" onChange={(v) => updIn(sh.id, (s) => { s.factoryRef = v; })} /></td>
                    <td style={{ ...td }}><DateEd value={sh.shipDate} onChange={(v) => updIn(sh.id, (s) => { s.shipDate = v; })} /></td>
                    <td style={{ ...td }}><DateEd value={sh.truckDate} onChange={(v) => updIn(sh.id, (s) => { s.truckDate = v; })} /></td>
                    <td style={{ ...td }}><DateEd value={sh.railDate} onChange={(v) => updIn(sh.id, (s) => { s.railDate = v; })} /></td>
                    <td style={{ ...td }}>
                      {sh.received ? <span style={{ color: T.T2 }}>—</span> : (
                        <span>
                          <DateEd value={sh.eta || ""} onChange={(v) => updIn(sh.id, (s) => { s.eta = v; })} />
                          {!sh.eta && <div style={{ fontSize: 8.5, color: T.T2 }}>auto: {dF(shipmentEta(sh))}</div>}
                        </span>
                      )}
                    </td>
                    <td style={{ ...td }}><StatusChipIn sh={sh} today={today} onReceive={() => updIn(sh.id, (s) => { s.received = true; })} /></td>
                    <td style={{ ...td, textAlign: "right", fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>{fm(units)}</td>
                    <td style={{ ...td }}>
                      {sh.received && <button onClick={() => updIn(sh.id, (s) => { s.received = false; })} title="Un-mark received" style={{ border: "none", background: "transparent", color: T.T2, cursor: "pointer", fontSize: 10 }}>↩</button>}
                      <button onClick={() => { if (window.confirm(`Delete shipment ${sh.ref || "(no ref)"}?`)) updActuals((a) => { a.inbound = a.inbound.filter((x) => x.id !== sh.id); }); }}
                        style={{ border: "none", background: "transparent", color: T.T2, cursor: "pointer", fontSize: 12 }} title="Delete shipment">🗑</button>
                    </td>
                  </tr>,
                  exp && <tr key={sh.id + "x"}><td colSpan={9} style={{ padding: 0, borderBottom: "1px solid " + T.BD }}>{lineRows(sh, "in")}</td></tr>,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}

      {view === "targets" && (
        <div style={{ background: T.S1, border: "1px solid " + T.BD, borderRadius: 6, overflowX: "auto" }}>
          <div style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11 }}>ROP = monthly × <Ed value={actuals.targets.ropMonths} onChange={(v) => updActuals((a) => { a.targets.ropMonths = Number(v) || 0; })} /> mo</span>
            <span style={{ fontSize: 11 }}>Max = monthly × <Ed value={actuals.targets.maxMonths} onChange={(v) => updActuals((a) => { a.targets.maxMonths = Number(v) || 0; })} /> mo</span>
            <AddTargetRow existing={(actuals.targets.rows || []).map((t) => t.sku)} onAdd={(sku) => updActuals((a) => a.targets.rows.push({ sku, monthly: 0, increment: 0 }))} />
            <span style={{ fontSize: 10, color: T.T2 }}>Reorder fires when position (on hand + in transit + open PO) drops below ROP; suggested qty fills to Max in order increments.</span>
          </div>
          <table style={{ ...tbl, fontSize: 11 }}>
            <thead><tr>
              <th style={{ ...th, minWidth: 200 }}>SKU</th>
              <th style={{ ...th, textAlign: "right" }}>Monthly volume</th>
              <th style={{ ...th, textAlign: "right" }}>Order increment</th>
              <th style={{ ...th, textAlign: "right" }}>ROP</th>
              <th style={{ ...th, textAlign: "right" }}>Max</th>
              <th style={{ ...th, textAlign: "right" }}>Position</th>
              <th style={{ ...th, textAlign: "center" }}>Status</th>
              <th style={{ ...th }}></th>
            </tr></thead>
            <tbody>
              {(actuals.targets.rows || []).length === 0 && <tr><td colSpan={8} style={{ ...td, color: T.T2, textAlign: "center", padding: 18 }}>No target rows yet — add SKUs with their monthly volume and order increment.</td></tr>}
              {(actuals.targets.rows || []).map((t, ti) => {
                const r = inv.perSku[t.sku];
                return (
                  <tr key={t.sku + ti}>
                    <td style={{ ...td }}><span style={{ fontWeight: 600 }}>{skuInfo(t.sku).name}</span> <span style={{ fontSize: 9, color: T.T2, fontFamily: "'JetBrains Mono',monospace" }}>{t.sku}</span></td>
                    <td style={{ ...td, textAlign: "right" }}><Ed value={t.monthly} onChange={(v) => updActuals((a) => { a.targets.rows[ti].monthly = Number(v) || 0; })} /></td>
                    <td style={{ ...td, textAlign: "right" }}><Ed value={t.increment} onChange={(v) => updActuals((a) => { a.targets.rows[ti].increment = Number(v) || 0; })} /></td>
                    <td style={{ ...td, textAlign: "right", fontFamily: "'JetBrains Mono',monospace", color: T.T2 }}>{fm(Math.round((t.monthly || 0) * actuals.targets.ropMonths))}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: "'JetBrains Mono',monospace", color: T.T2 }}>{fm(Math.round((t.monthly || 0) * actuals.targets.maxMonths))}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: "'JetBrains Mono',monospace" }}>{r ? fm(Math.round(r.position)) : "—"}</td>
                    <td style={{ ...td, textAlign: "center" }}>{r ? targetChip(r) : "—"}</td>
                    <td style={{ ...td }}><button onClick={() => updActuals((a) => a.targets.rows.splice(ti, 1))} style={{ border: "none", background: "transparent", color: T.T2, cursor: "pointer", fontSize: 12 }} title="Remove target">✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AddPoRow({ onAdd }) {
  const [sku, setSku] = useState("");
  const [qty, setQty] = useState("");
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <SkuSelect value={sku} onChange={setSku} width={220} />
      <input value={qty} onChange={(e) => setQty(e.target.value)} placeholder="PO qty"
        style={{ width: 80, fontSize: 11, padding: "3px 6px", borderRadius: 4, border: "1px solid " + T.BD, fontFamily: "'JetBrains Mono',monospace", textAlign: "right" }} />
      <button onClick={() => { const q = Number(qty); if (sku && q > 0) { onAdd(sku, q); setSku(""); setQty(""); } }}
        style={{ padding: "3px 10px", borderRadius: 4, border: "1px solid " + T.GR, background: T.GR + "10", color: T.GR, cursor: "pointer", fontSize: 10, fontWeight: 700 }}>+ Add PO line</button>
    </span>
  );
}

function AddTargetRow({ existing, onAdd }) {
  const [sku, setSku] = useState("");
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <SkuSelect value={sku} onChange={setSku} width={220} />
      <button onClick={() => { if (sku && !existing.includes(sku)) { onAdd(sku); setSku(""); } }}
        style={{ padding: "3px 10px", borderRadius: 4, border: "1px solid " + T.GR, background: T.GR + "10", color: T.GR, cursor: "pointer", fontSize: 10, fontWeight: 700 }}>+ Add target</button>
    </span>
  );
}
