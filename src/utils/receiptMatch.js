// receiptMatch.js — tie NetSuite Item Receipts to the factory→Calyx shipments
// tracked on the dashboard, so "received" stops being a manual checkbox.
//
// There is no shared identifier to join on. Every Wana Cube receipt is booked
// against the same blanket PO9245, carries no memo and no external reference,
// and the dashboard's own CP- number never reaches NetSuite. What does line up
// is the cargo: a shipment's SKUs and quantities are reproduced exactly on the
// receipt that books it in (CP-16's 20,736 Dreamberry lids → IR5371).
//
// So the match is on line composition, and it is deliberately strict: every
// line of the shipment must appear on one receipt at exactly that quantity.
// Anything less is reported as a suggestion for a human, never auto-applied —
// wrongly flipping a shipment to received inflates on-hand and silently
// corrupts the whole forecast downstream.

/** Group flat receipt rows into one entry per Item Receipt document. */
export function groupReceipts(receipts = []) {
  const by = {};
  for (const r of receipts) {
    if (!r || !r.ref || !r.sku) continue;
    const g = by[r.ref] || (by[r.ref] = { ref: r.ref, date: r.date, lines: {} });
    g.lines[r.sku] = (g.lines[r.sku] || 0) + (Number(r.qty) || 0);
    // a receipt's lines all share its date; keep the earliest seen
    if (r.date && (!g.date || String(r.date) < String(g.date))) g.date = r.date;
  }
  return Object.values(by);
}

/**
 * @returns {{confirmed: Array, possible: Array}}
 *   confirmed — every line matched exactly; safe to mark received
 *   possible  — a partial overlap worth a human look, never auto-applied
 */
export function matchReceipts(inbound = [], receipts = []) {
  const irs = groupReceipts(receipts);
  const confirmed = [], possible = [];
  if (!irs.length) return { confirmed, possible };

  // A receipt already credited to a shipment cannot also explain another one.
  const claimed = new Set();
  for (const sh of inbound) if (sh.received && sh.receivedRef) claimed.add(sh.receivedRef);

  for (const sh of inbound) {
    if (sh.received) continue;
    const lines = (sh.lines || []).filter((l) => l && l.sku && Number(l.qty) > 0);
    if (!lines.length) continue;

    let best = null;
    for (const ir of irs) {
      if (claimed.has(ir.ref)) continue;
      const hit = lines.filter((l) => ir.lines[l.sku] === Number(l.qty)).length;
      if (!hit) continue;
      const score = hit / lines.length;
      if (!best || score > best.score) best = { ir, score, hit };
    }
    if (!best) continue;

    const rec = { id: sh.id, ref: sh.ref || "—", receiptRef: best.ir.ref, date: best.ir.date,
      lines: lines.length, matched: best.hit, score: best.score };
    if (best.score === 1) { claimed.add(best.ir.ref); confirmed.push(rec); }
    else possible.push(rec);
  }
  return { confirmed, possible };
}
