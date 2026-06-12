// InventoryTab — inventory at Calyx from actual flows (inbound received −
// outbound shipped + count adjustments), with forward projection / MOH from
// the active scenario's item forecast, target levels (ROP/Max) and reorder
// suggestions, plus editors for inbound shipments, outbound-to-Wana shipments,
// open POs, and targets. Actuals are shared across scenarios (Supabase `actuals`).

import { useState, useMemo } from "react";
import { calcSkuWeeklyForecast, calcSkuInventory, calcSkuMarketWeekly, shipmentEta, buildWeekGrid, skuInfo } from "../utils/inventory";
import { parseLocalDate } from "../utils/calc";
import { MASTER_SKUS, BASE_TYPES } from "../data/skuMaster";
import { Ed } from "./Shared";
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
  if (!eta) return <Chip txt="No dates" bg={T.S2} bd={T.BD} tx={T.T2} title="Excluded from projections until dated or marked received" />;
  if (eta <= today) return (
    <span style={{ whiteSpace: "nowrap" }}>
      <Chip txt="Arrived?" bg="#fef3c7" bd={T.AM} tx="#92400e" title="ETA has passed — counted as received" />
      <button onClick={onReceive} style={{ marginLeft: 4, padding: "1px 6px", borderRadius: 4, border: "1px solid " + T.GR, background: T.GR + "10", color: T.GR, cursor: "pointer", fontSize: 9 }}>mark received</button>
    </span>
  );
  return <Chip txt="In transit" bg="#dbeafe" bd={T.AC} tx="#1d4ed8" />;
}

export default function InventoryTab({ sc, actuals, updActuals }) {
  const [view, setView] = useState("overview");
  const [expKey, setExpKey] = useState(null);
  const [expShip, setExpShip] = useState(null);
  const [outMkt, setOutMkt] = useState("All");
  const [adjVal, setAdjVal] = useState("");
  const [mrpCollapsed, setMrpCollapsed] = useState(() => new Set());
  const today = new Date();

  const fc = useMemo(() => calcSkuWeeklyForecast(sc.markets), [sc.markets]);
  const inv = useMemo(() => calcSkuInventory(actuals, fc, today), [actuals, fc]); // eslint-disable-line
  const mw = useMemo(() => calcSkuMarketWeekly(sc.markets), [sc.markets]);
  const grid = useMemo(() => buildWeekGrid(), []);

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
        {card("On hand at Calyx", fm(Math.round(inv.totals.onHand)), "received − shipped to Wana ± adjustments", inv.totals.onHand < 0 ? "#dc2626" : T.AC)}
        {card("In transit (inbound)", fm(Math.round(inv.totals.inTransit)), inv.totals.nextArrival ? `next arrival ${dF(inv.totals.nextArrival)} · ${inv.totals.inTransitShipments} shipments` : `${inv.totals.inTransitShipments} shipments`, T.PU)}
        {card("SKUs at risk", fm(inv.totals.atRisk), "months on hand below 1.0", inv.totals.atRisk > 0 ? "#dc2626" : T.GR)}
        {card("Open PO remaining", fm(Math.round(inv.totals.poRemaining)), "not yet shipped from factory", T.AM)}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        {subBtn("overview", "Overview")}
        {subBtn("mrp", "MRP")}
        {subBtn("inbound", "Inbound (factory → Calyx)")}
        {subBtn("outbound", "Outbound to Wana")}
        {subBtn("pos", "Open POs")}
        {subBtn("targets", "Targets")}
        <span style={{ marginLeft: "auto", fontSize: 9.5, color: T.T2 }}>forecast: scenario “{sc.name}”</span>
      </div>

      {inv.unscheduled.length > 0 && view !== "inbound" && (
        <div style={{ marginBottom: 10, fontSize: 10, color: "#92400e", background: "#fef3c7", border: "1px solid " + T.AM, borderRadius: 5, padding: "5px 10px" }}>
          ⚠ {inv.unscheduled.length} inbound shipment{inv.unscheduled.length > 1 ? "s" : ""} without dates ({inv.unscheduled.join(", ")}) — excluded from projections. Add dates or mark received in the Inbound view.
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
          const XLSX = await import("xlsx");
          const aoa = [];
          aoa.push(["MRP — weekly demand vs projected on hand"]);
          aoa.push([`Scenario: ${sc.name}`, `Generated: ${new Date().toLocaleDateString("en-US")}`]);
          aoa.push([]);
          aoa.push(["SKU / row", ...mrpCols.map((g) => `${g.label} (wk ${g.idx + 11})`)]);
          for (const grp of overviewGroups) {
            const rows = grp.rows.filter(hasActivity);
            if (!rows.length) continue;
            aoa.push([grp.name.toUpperCase()]);
            for (const r of rows) {
              const code = r.key.startsWith("~") ? "unmapped" : r.key;
              aoa.push([`${r.name} (${code}) — projected on hand`, ...mrpCols.map((g) => (r.proj[g.idx] == null ? "" : Math.round(r.proj[g.idx])))]);
              const dm = mw.byKey[r.key] || {};
              for (const mname of Object.keys(dm)) {
                aoa.push([`    ${mname} demand`, ...mrpCols.map((g) => Math.round(dm[mname][g.idx]) || 0)]);
              }
              aoa.push(["    Total demand", ...mrpCols.map((g) => Math.round(r.demand[g.idx]) || 0)]);
              aoa.push(["    Receipts (in transit)", ...mrpCols.map((g) => Math.round(r.arrivals[g.idx]) || 0)]);
            }
          }
          aoa.push([]);
          aoa.push(["On hand row = prior week balance + receipts − demand, starting from current on hand. Demand rows cover markets with item-level forecasts; base (PB-) demand derives from lid demand per market."]);
          const ws = XLSX.utils.aoa_to_sheet(aoa);
          ws["!cols"] = [{ wch: 46 }, ...mrpCols.map(() => ({ wch: 10 }))];
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, "MRP");
          XLSX.writeFile(wb, `Wana-MRP-${todayISO()}.xlsx`);
        };
        const moGroups = [];
        for (const g of mrpCols) {
          const last = moGroups[moGroups.length - 1];
          if (last && last.mo === g.mo) last.span++;
          else moGroups.push({ mo: g.mo, span: 1, label: g.date.toLocaleDateString("en-US", { month: "long" }) });
        }
        const stickyName = { position: "sticky", left: 0, background: T.S1, zIndex: 1, minWidth: 196, maxWidth: 220, borderRight: "1px solid " + T.BD };
        const numCell = { ...td, textAlign: "right", fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, minWidth: 52, padding: "3px 6px" };
        return (
          <div style={{ background: T.S1, border: "1px solid " + T.BD, borderRadius: 6 }}>
            <div style={{ padding: "8px 12px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, fontWeight: 700 }}>MRP — weekly demand vs projected on hand</span>
              <button onClick={() => setMrpCollapsed(new Set())} style={{ padding: "3px 9px", borderRadius: 4, border: "1px solid " + T.BD, background: "transparent", color: T.T2, cursor: "pointer", fontSize: 10 }}>Expand all</button>
              <button onClick={() => setMrpCollapsed(new Set(visibleKeys))} style={{ padding: "3px 9px", borderRadius: 4, border: "1px solid " + T.BD, background: "transparent", color: T.T2, cursor: "pointer", fontSize: 10 }}>Collapse all</button>
              <button onClick={exportMrp} style={{ padding: "3px 11px", borderRadius: 4, border: "1px solid " + T.GR, background: T.GR + "10", color: T.GR, cursor: "pointer", fontSize: 10, fontWeight: 700 }}>⬇ Download Excel</button>
              <span style={{ fontSize: 9.5, color: T.T2 }}>On hand row = prior week balance + receipts − demand, starting from current on hand. Click a SKU to toggle its market breakdown.</span>
            </div>
            <div style={{ overflowX: "auto" }}>
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
                      <th key={g.idx} style={{ ...th, top: 29, textAlign: "right", minWidth: 52, background: g.idx === inv.todayIdx ? T.AC + "14" : T.S1 }}>
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
                              return <td key={g.idx} style={{ ...numCell, fontWeight: 700, color: neg ? "#991b1b" : T.TX, background: neg ? "#fee2e2" : g.idx === inv.todayIdx ? T.AC + "0A" : undefined }}>{v == null ? "—" : fm(Math.round(v))}</td>;
                            })}
                          </tr>,
                        ];
                        if (!collapsed) {
                          for (const mname of dmMarkets) {
                            out.push(
                              <tr key={r.key + mname}>
                                <td style={{ ...td, ...stickyName, padding: "2px 8px 2px 22px", fontSize: 9.5, color: T.T2 }}>↳ {mname} demand</td>
                                {mrpCols.map((g) => { const v = dm[mname][g.idx]; return <td key={g.idx} style={{ ...numCell, color: v > 0 ? T.TX : T.BD }}>{v > 0 ? fm(Math.round(v)) : "—"}</td>; })}
                              </tr>
                            );
                          }
                          out.push(
                            <tr key={r.key + "tot"}>
                              <td style={{ ...td, ...stickyName, padding: "2px 8px 2px 22px", fontSize: 9.5, fontWeight: 700, color: T.T2 }}>Total demand</td>
                              {mrpCols.map((g) => { const v = r.demand[g.idx]; return <td key={g.idx} style={{ ...numCell, fontWeight: 600, color: v > 0 ? T.TX : T.BD, background: T.S2 + "44" }}>{v > 0 ? fm(Math.round(v)) : "—"}</td>; })}
                            </tr>,
                            <tr key={r.key + "rcv"}>
                              <td style={{ ...td, ...stickyName, padding: "2px 8px 2px 22px", fontSize: 9.5, color: T.GR }}>Receipts (in transit)</td>
                              {mrpCols.map((g) => { const v = r.arrivals[g.idx]; return <td key={g.idx} style={{ ...numCell, color: v > 0 ? T.GR : T.BD, fontWeight: v > 0 ? 700 : 400 }}>{v > 0 ? "+" + fm(Math.round(v)) : "—"}</td>; })}
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
                    <td style={{ ...td, fontWeight: 700, cursor: "pointer" }} onClick={() => setExpShip(exp ? null : sh.id)}>
                      <span style={{ color: T.T2, fontSize: 9, marginRight: 4 }}>{exp ? "▼" : "▶"}</span>
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

      {view === "outbound" && (
        <div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
            {outMarkets.map((m) => (
              <button key={m} onClick={() => setOutMkt(m)} style={{ padding: "3px 10px", borderRadius: 999, cursor: "pointer", fontSize: 10, fontFamily: "inherit",
                border: "1px solid " + (outMkt === m ? T.PU : T.BD), background: outMkt === m ? T.PU + "15" : "transparent", color: outMkt === m ? T.PU : T.T2, fontWeight: outMkt === m ? 700 : 500 }}>{m}</button>
            ))}
            <button onClick={addOutbound} style={{ marginLeft: "auto", padding: "4px 12px", borderRadius: 5, border: "1px solid " + T.GR, background: T.GR + "10", color: T.GR, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>+ Add outbound shipment</button>
          </div>

          <div style={{ background: T.S1, border: "1px solid " + T.BD, borderRadius: 6, overflowX: "auto", marginBottom: 12 }}>
            <table style={{ ...tbl, fontSize: 11 }}>
              <thead><tr>
                <th style={{ ...th }}>Market</th><th style={{ ...th }}>Shipped</th><th style={{ ...th }}>Arrives by</th>
                <th style={{ ...th }}>Tracking</th><th style={{ ...th }}>Status</th>
                <th style={{ ...th, textAlign: "right" }}>Units</th><th style={{ ...th }}></th>
              </tr></thead>
              <tbody>
                {outboundShown.length === 0 && <tr><td colSpan={7} style={{ ...td, color: T.T2, textAlign: "center", padding: 18 }}>No outbound shipments recorded{outMkt !== "All" ? ` for ${outMkt}` : ""} yet.</td></tr>}
                {outboundShown.map((sh) => {
                  const exp = expShip === sh.id;
                  const units = (sh.lines || []).reduce((a, l) => a + (Number(l.qty) || 0), 0);
                  const arrived = sh.arriveBy && parseLocalDate(sh.arriveBy) <= today;
                  return [
                    <tr key={sh.id} style={{ background: exp ? T.PU + "0A" : undefined }}>
                      <td style={{ ...td, fontWeight: 700, cursor: "pointer" }} onClick={() => setExpShip(exp ? null : sh.id)}>
                        <span style={{ color: T.T2, fontSize: 9, marginRight: 4 }}>{exp ? "▼" : "▶"}</span>
                        <select value={sh.market || "New Jersey"} onChange={(e) => updOut(sh.id, (s) => { s.market = e.target.value; })} onClick={(e) => e.stopPropagation()}
                          style={{ fontSize: 11, padding: "2px 3px", borderRadius: 4, border: "1px solid " + T.BD, background: T.S1, color: T.TX }}>
                          {sc.markets.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
                        </select>
                      </td>
                      <td style={{ ...td }}><DateEd value={sh.dateShipped} onChange={(v) => updOut(sh.id, (s) => { s.dateShipped = v; })} /></td>
                      <td style={{ ...td }}><DateEd value={sh.arriveBy} onChange={(v) => updOut(sh.id, (s) => { s.arriveBy = v; })} /></td>
                      <td style={{ ...td }}><Ed value={sh.tracking || ""} type="text" onChange={(v) => updOut(sh.id, (s) => { s.tracking = v; })} /></td>
                      <td style={{ ...td }}>
                        {sh.delivered ? <Chip txt="Delivered" bg="#dcfce7" bd={T.GR} tx="#166534" />
                          : !sh.dateShipped ? <Chip txt="Planned" bg={T.S2} bd={T.BD} tx={T.T2} />
                          : arrived ? <span style={{ whiteSpace: "nowrap" }}><Chip txt="Arrived?" bg="#fef3c7" bd={T.AM} tx="#92400e" /><button onClick={() => updOut(sh.id, (s) => { s.delivered = true; })} style={{ marginLeft: 4, padding: "1px 6px", borderRadius: 4, border: "1px solid " + T.GR, background: T.GR + "10", color: T.GR, cursor: "pointer", fontSize: 9 }}>mark delivered</button></span>
                          : <Chip txt="In transit" bg="#dbeafe" bd={T.AC} tx="#1d4ed8" />}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>{fm(units)}</td>
                      <td style={{ ...td }}>
                        <button onClick={() => { if (window.confirm("Delete this outbound shipment?")) updActuals((a) => { a.outbound = a.outbound.filter((x) => x.id !== sh.id); }); }}
                          style={{ border: "none", background: "transparent", color: T.T2, cursor: "pointer", fontSize: 12 }} title="Delete shipment">🗑</button>
                      </td>
                    </tr>,
                    exp && <tr key={sh.id + "x"}><td colSpan={7} style={{ padding: 0, borderBottom: "1px solid " + T.BD }}>{lineRows(sh, "out")}</td></tr>,
                  ];
                })}
              </tbody>
            </table>
            <div style={{ padding: "6px 12px", fontSize: 9, color: T.T2, borderTop: "1px solid " + T.BD }}>
              Outbound units deduct from Calyx on-hand on the ship date. Enter finished flavors as their PL- lid SKU and use “Auto-add base lines” for the matching PB- base units.
            </div>
          </div>

          <div style={{ background: T.S1, border: "1px solid " + T.BD, borderRadius: 6, overflowX: "auto" }}>
            <div style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 700 }}>Flavor schedule (Wana-facing)</span>
              <button onClick={() => updActuals((a) => a.milestones.push({ market: outMkt !== "All" ? outMkt : "New Jersey", sku: "", expectedArrival: "", kitchenDate: "" }))}
                style={{ padding: "3px 9px", borderRadius: 4, border: "1px solid " + T.AC, background: T.AC + "10", color: T.AC, cursor: "pointer", fontSize: 10, fontWeight: 600 }}>+ Add flavor row</button>
              <span style={{ fontSize: 9.5, color: T.T2 }}>expected arrival is free text (e.g. “TBD not before 7/11”)</span>
            </div>
            <table style={{ ...tbl, fontSize: 11 }}>
              <thead><tr>
                <th style={{ ...th }}>Market</th><th style={{ ...th, minWidth: 220 }}>Flavor / SKU</th>
                <th style={{ ...th }}>Expected arrival</th><th style={{ ...th }}>First kitchen date</th><th style={{ ...th }}></th>
              </tr></thead>
              <tbody>
                {milestonesShown.length === 0 && <tr><td colSpan={5} style={{ ...td, color: T.T2, textAlign: "center", padding: 16 }}>No flavor schedule rows{outMkt !== "All" ? ` for ${outMkt}` : ""} yet.</td></tr>}
                {milestonesShown.map((m) => {
                  const mi = (actuals.milestones || []).indexOf(m);
                  return (
                    <tr key={mi}>
                      <td style={{ ...td, color: T.T2 }}>{m.market}</td>
                      <td style={{ ...td }}><SkuSelect value={m.sku} onChange={(v) => updActuals((a) => { a.milestones[mi].sku = v; })} width={230} /></td>
                      <td style={{ ...td }}><Ed value={m.expectedArrival || ""} type="text" onChange={(v) => updActuals((a) => { a.milestones[mi].expectedArrival = v; })} /></td>
                      <td style={{ ...td }}><DateEd value={m.kitchenDate} onChange={(v) => updActuals((a) => { a.milestones[mi].kitchenDate = v; })} /></td>
                      <td style={{ ...td }}><button onClick={() => updActuals((a) => a.milestones.splice(mi, 1))} style={{ border: "none", background: "transparent", color: T.T2, cursor: "pointer", fontSize: 12 }} title="Remove">✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === "pos" && (
        <div style={{ background: T.S1, border: "1px solid " + T.BD, borderRadius: 6, overflowX: "auto" }}>
          <div style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 10 }}>
            <AddPoRow onAdd={(sku, qty) => ensurePo(sku, (p) => { p.poQty = qty; })} />
            <span style={{ fontSize: 10, color: T.T2 }}>Received + in transit derives from inbound shipment lines; use Manual adj for history not entered as shipments.</span>
          </div>
          <table style={{ ...tbl, fontSize: 11 }}>
            <thead><tr>
              <th style={{ ...th, minWidth: 200 }}>SKU</th>
              <th style={{ ...th, textAlign: "right" }}>PO qty</th>
              <th style={{ ...th, textAlign: "right" }}>Recv + transit</th>
              <th style={{ ...th, textAlign: "right" }}>Manual adj</th>
              <th style={{ ...th, textAlign: "right" }}>Remaining</th>
            </tr></thead>
            <tbody>
              {poRows.length === 0 && <tr><td colSpan={5} style={{ ...td, color: T.T2, textAlign: "center", padding: 18 }}>No PO lines yet — add the open Wana PO quantities per SKU.</td></tr>}
              {poRows.map((r) => (
                <tr key={r.key}>
                  <td style={{ ...td }}><span style={{ fontWeight: 600 }}>{r.name}</span> <span style={{ fontSize: 9, color: T.T2, fontFamily: "'JetBrains Mono',monospace" }}>{r.key}</span></td>
                  <td style={{ ...td, textAlign: "right" }}><Ed value={r.poQty} onChange={(v) => ensurePo(r.key, (p) => { p.poQty = Number(v) || 0; })} /></td>
                  <td style={{ ...td, textAlign: "right", fontFamily: "'JetBrains Mono',monospace" }}>{fm(Math.round(r.poRecvDerived))}</td>
                  <td style={{ ...td, textAlign: "right" }}><Ed value={r.poAdj} onChange={(v) => ensurePo(r.key, (p) => { p.adjQty = Number(v) || 0; })} /></td>
                  <td style={{ ...td, textAlign: "right", fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>
                    {r.poOver > 0 ? <Chip txt={`over ${fm(Math.round(r.poOver))}`} bg="#fef3c7" bd={T.AM} tx="#92400e" /> : fm(Math.round(r.poRemaining))}
                  </td>
                </tr>
              ))}
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
