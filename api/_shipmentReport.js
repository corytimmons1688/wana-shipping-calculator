// _shipmentReport.js — transforms raw NetSuite Item Fulfillment lines into the
// shipment report contract. Implements the rules in
// Acreage_NJ_Shipment_Report_Integration_Spec.md, generalised past entity 1158:
// the customer is a parameter and the market is derived from the label prefix
// (WANA-<ST>-*), so a market appears as soon as it starts shipping cubes.
//
// Shared by the Vercel cron (api/sync-shipments.js) and the one-off seed script,
// so both produce byte-identical output from the same inputs.

export const LABEL_RE = /^WANA-([A-Z]{2})-/;
export const IS_LID = (sku) => /^PL-WCB-/.test(sku || "");
export const IS_BASE = (sku) => /^PB-WCB-/.test(sku || "");
export const IS_LABEL = (sku) => LABEL_RE.test(sku || "");
export const IS_APPL_FEE = (name) => /Label Appl Fee/i.test(name || "");
export const APPL_COLOR = (name) => (/black/i.test(name || "") ? "PB-WCB-221-00" : "PB-WCB-002-00");

// §9.3 — carrier names are free-form; map explicitly, pass unknowns through.
const CARRIER = { FEDEX: "FedEx", "FEDEX FREIGHT": "FedEx Freight", ESTES: "Estes",
  "FORWARD AIR": "Forward Air", "LTL BEST WAY": "LTL Best Way", UPS: "UPS" };
export const normCarrier = (s) => (!s ? "" : CARRIER[String(s).toUpperCase()] || s);

// §9.7 — misspellings and double spaces live in NetSuite item records.
const FLAVOR_FIX = { "Relaxed Rasberry": "Relaxed Raspberry", "Balance Berry Guava": "Balanced Berry Guava",
  "Bounce Back Cherry Cola": "Swift Recovery Cherry Cola", "State Sunrise": "Sunrise" };
export function normFlavor(s) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return FLAVOR_FIX[t] || t;
}
// §5.7 — labels: segment after the last " - ". Lids: everything before the first ":".
export function flavorFromLabel(displayname) { const p = String(displayname || "").split(" - "); return normFlavor(p[p.length - 1]); }
export function flavorFromLid(displayname) { return normFlavor(String(displayname || "").split(":")[0]); }

// NetSuite returns dates as M/D/YYYY, which does NOT sort chronologically as a
// string ("7/6/2026" > "7/31/2026"). Normalise before any date comparison.
export function toISO(d) {
  const s = String(d || "").trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${String(m[1]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
  return s;
}

/**
 * @param rows  fulfillment lines: {fid, tranid, trandate, item_id, itemid, displayname, qty, createdfrom, customer_id, customer_name}
 * @param meta  { tracking: {fid: number}, carrier: {fid: method}, poQty: {item_id: qty}, history: [{item_id, trandate, qty}] }
 */
export function buildShipmentReport(rows, meta = {}) {
  const tracking = meta.tracking || {}, carrier = meta.carrier || {}, poQty = meta.poQty || {};
  const warnings = [];

  // §5.1 dedup — collapse identical (fid, item, qty). Same item at DIFFERENT
  // quantities is legitimate (one per flavour) and must survive.
  const seen = new Set(), lines = [];
  for (const r of rows) {
    const k = `${r.fid}|${r.item_id}|${r.qty}`;
    if (seen.has(k)) continue;
    seen.add(k); lines.push(r);
  }

  // §5.2 keep only reportable families
  const keep = lines.filter((r) => r.itemid && (IS_LID(r.itemid) || IS_BASE(r.itemid) || IS_LABEL(r.itemid) || IS_APPL_FEE(r.displayname)));

  // §5.3 group by (date, tracking) — bases/lids and their labels ship on
  // separate fulfillments against separate SOs but are one physical shipment.
  const groups = {};
  for (const r of keep) {
    const trk = tracking[r.fid] || "";
    const key = `${r.trandate}|${trk || "m:" + (carrier[r.fid] || "")}|${r.customer_id}`;
    const g = groups[key] || (groups[key] = { shipment_key: `${r.trandate}|${trk || carrier[r.fid] || "none"}`,
      ship_date: r.trandate, customer_id: r.customer_id, customer_name: r.customer_name,
      market: null, tracking_number: trk, carrier: normCarrier(carrier[r.fid]),
      fulfillment_ids: [], fulfillment_tranids: [], lines: [], _raw: [] });
    if (!g.fulfillment_ids.includes(r.fid)) { g.fulfillment_ids.push(r.fid); g.fulfillment_tranids.push(r.tranid); }
    g._raw.push(r);
    if (!trk) warnings.push({ code: "MISSING_TRACKING", severity: "warn", fulfillment_tranid: r.tranid,
      message: `No tracking number; shipping method '${carrier[r.fid] || "unknown"}' used as fallback.` });
  }

  // cumulative per item across all history, up to and including a ship date (§5.6)
  // Built from the DEDUPLICATED lines, never the caller's raw rows — NetSuite
  // repeats each line 2–3× per fulfillment (§5.1) and using raw history here
  // doubles or triples every cumulative total.
  const hist = lines.map((r) => ({ item_id: r.item_id, createdfrom: r.createdfrom,
    trandate: r.trandate, qty: Number(r.qty) || 0 }))
    .sort((a, b) => toISO(a.trandate).localeCompare(toISO(b.trandate)));
  // Scoped to the line's own sales order — an item ships to many customers on
  // many SOs, and summing across all of them inflates progress past 100%.
  const cumulative = (itemId, soId, uptoDate) => hist.reduce((a, h) =>
    (String(h.item_id) === String(itemId) && String(h.createdfrom) === String(soId)
      && toISO(h.trandate) <= toISO(uptoDate) ? a + (Number(h.qty) || 0) : a), 0);
  const orderedQty = (itemId, soId) => {
    const k = `${soId}|${itemId}`;
    return poQty[k] != null ? poQty[k] : (poQty[itemId] != null ? poQty[itemId] : null);
  };

  const out = [];
  for (const g of Object.values(groups)) {
    const raw = g._raw;
    const labels = raw.filter((r) => IS_LABEL(r.itemid));
    const appl = raw.filter((r) => IS_APPL_FEE(r.displayname));
    const lids = raw.filter((r) => IS_LID(r.itemid));
    const bases = raw.filter((r) => IS_BASE(r.itemid));

    const st = labels.length ? (labels[0].itemid.match(LABEL_RE) || [])[1] : null;
    g.market = st || null;

    // §5.4 LID rows
    for (const r of lids) {
      const q = Number(r.qty) || 0;
      out.push({ shipment: g, sku: r.itemid, flavor: `${flavorFromLid(r.displayname)} - LID`,
        component_type: "LID", quantity_shipped: q,
        total_shipped_on_po: cumulative(r.item_id, r.createdfrom, g.ship_date) || q,
        po_quantity: orderedQty(r.item_id, r.createdfrom),
        source_sku: r.itemid, source_item_id: r.item_id });
    }
    // §5.5 BASE rows are derived from the LABEL lines (bases carry no flavour);
    // colour comes from the appl-fee line of matching quantity.
    for (const r of labels) {
      const q = Number(r.qty) || 0;
      const fee = appl.find((a) => Number(a.qty) === q);
      // No appl-fee line means this is a legacy label, not a Wana Cube base
      // application — emitting a PB-WCB row here would invent a shipment that
      // never happened, so skip it and say so.
      if (!fee) {
        warnings.push({ code: "ORPHAN_LABEL", severity: "warn", label_sku: r.itemid,
          message: `Label ${r.itemid} qty ${q} has no matching appl-fee line — not a Wana Cube base application; row omitted.` });
        continue;
      }
      out.push({ shipment: g, sku: APPL_COLOR(fee.displayname),
        flavor: `${flavorFromLabel(r.displayname)} - BASE`, component_type: "BASE", quantity_shipped: q,
        total_shipped_on_po: cumulative(r.item_id, r.createdfrom, g.ship_date) || q,
        po_quantity: orderedQty(r.item_id, r.createdfrom),
        source_sku: r.itemid, source_item_id: r.item_id });
    }
    // §6 base reconciliation: Σ appl fees per colour == Σ PB- shipped per colour
    for (const color of ["PB-WCB-002-00", "PB-WCB-221-00"]) {
      const feeTotal = appl.filter((a) => APPL_COLOR(a.displayname) === color).reduce((a, r) => a + (Number(r.qty) || 0), 0);
      const baseTotal = bases.filter((b) => b.itemid === color).reduce((a, r) => a + (Number(r.qty) || 0), 0);
      if (feeTotal || baseTotal) g.reconciliation = [...(g.reconciliation || []),
        { base_sku: color, appl_fee_total: feeTotal, base_qty_shipped: baseTotal, status: feeTotal === baseTotal ? "pass" : "mismatch" }];
      if (feeTotal !== baseTotal) warnings.push({ code: "BASE_RECON", severity: "warn",
        message: `${g.shipment_key} ${color}: appl fees ${feeTotal} vs bases shipped ${baseTotal}` });
    }
  }

  // assemble
  const shipments = Object.values(groups).map((g) => ({
    shipment_key: g.shipment_key, ship_date: g.ship_date, market: g.market,
    customer_id: g.customer_id, customer_name: g.customer_name,
    carrier: g.carrier, tracking_number: g.tracking_number,
    tracking_display: g.tracking_number ? `${g.carrier || "?"}: ${g.tracking_number}` : (g.carrier || "—"),
    fulfillment_tranids: g.fulfillment_tranids, reconciliation: g.reconciliation || [],
    lines: out.filter((l) => l.shipment === g).map(({ shipment, ...l }) => ({ ...l,
      po_percent_complete: l.po_quantity ? Number((l.total_shipped_on_po / l.po_quantity).toFixed(4)) : null })),
  })).filter((s) => s.lines.length).sort((a, b) => toISO(b.ship_date).localeCompare(toISO(a.ship_date)));

  const markets = [...new Set(shipments.map((s) => s.market).filter(Boolean))].sort();
  return { generated_at: new Date().toISOString(), source: "netsuite.suiteql", markets, shipments, warnings };
}
