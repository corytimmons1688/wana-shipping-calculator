// fulfilmentMatch.js — tie NetSuite item fulfilments to the rows of the apply
// schedule, so a run that has physically gone reads as shipped.
//
// The join has the same shape as receiptMatch on the inbound side: nothing
// shared to join on, so it is made on market + flavour + component, then
// narrowed by how closely the quantity and the date line up.
//
// What was missing is the rule receiptMatch already states for receipts — a
// fulfilment credited to one row cannot also explain another. Matching each row
// independently on nearest date let one truck answer for every row it happened
// to sit near. Colorado's 3,402 Assorted lids of Sep 1 were reported shipped
// against the Aug 25 run, the Sep 1 run AND the Sep 11 run at once; across the
// plan, eleven fulfilments were claimed more than once and 54,486 units that
// never moved showed as gone.
//
// Quantity decides before the calendar does. A truck is recognised by what was
// on it: those 3,402 units are the Aug 25 run to the unit, and nothing like the
// 18,144 the Sep 1 run wanted. Ordering on date alone handed the shipment to
// whichever row sat closest in the calendar and called the quantity a detail.

// Teams ship ahead when a truck is going anyway, and slip when it is not, so a
// fortnight either side still counts as the same run — the drift is reported
// rather than the match dropped.
export const MATCH_WINDOW_DAYS = 14;

const parseISO = (s) => { const p = String(s).split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); };
const dayDiff = (a, b) => Math.round((parseISO(a) - parseISO(b)) / 86400000);

/**
 * days     the plan as buildApplySchedule returns it
 * index    "MK|key|KIND" → [{ id, date, qty, ... }], one entry per shipped line
 * keyOf    a plan row → the index key its market + flavour + component lives under
 * slotKey  (date, market, sku, kind) → the row's identity, from applySchedule
 *
 * @returns {Map<string, object>} slotKey → the fulfilment line that row went on
 */
export function matchFulfilments({ days = [], index = {}, keyOf, slotKey }) {
  // Every (row, fulfilment) pair inside the window. Both sides are scored, then
  // the whole set is resolved at once — a row is not allowed to take the best
  // shipment for itself before a row that needs it more has been considered.
  const pairs = [];
  for (const d of days) {
    for (const l of d.ship || []) {
      for (const h of index[keyOf(l)] || []) {
        if (!h.date) continue;
        const drift = dayDiff(h.date, d.date);
        if (Math.abs(drift) > MATCH_WINDOW_DAYS) continue;
        pairs.push({ row: l, date: d.date, h, drift,
          gap: Math.abs((Number(h.qty) || 0) - (Number(l.units) || 0)) });
      }
    }
  }
  // Quantity, then date, then the earlier run — so a shipment settles on the
  // run it actually carried. A row already ticked in the log was written at the
  // real date for the real quantity, so it scores zero on both and claims its
  // own fulfilment before anything else can.
  pairs.sort((a, b) => a.gap - b.gap
    || Math.abs(a.drift) - Math.abs(b.drift)
    || String(a.date).localeCompare(String(b.date)));

  const out = new Map(), rowTaken = new Set(), shipTaken = new Set();
  for (const p of pairs) {
    const rk = slotKey(p.date, p.row.market, p.row.sku, p.row.kind);
    if (rowTaken.has(rk) || shipTaken.has(p.h.id)) continue;
    rowTaken.add(rk); shipTaken.add(p.h.id);
    out.set(rk, { ...p.h, diff: Math.abs(p.drift), drift: p.drift });
  }
  return out;
}
