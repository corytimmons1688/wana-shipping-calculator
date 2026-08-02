// tracking.js — turn a carrier + tracking/PRO number into a clickable link.
//
// Logistics Plus books every one of these shipments, but their eShipPlus REST
// API has no "give me a tracking URL" call: it exposes GetShipmentStatus /
// GetShipmentStatusCondensed, which return status events keyed on the eShipPlus
// BookingReferenceNumber — a number NetSuite does not store. What NetSuite does
// store is the carrier PRO/tracking number, and every carrier publishes a
// stable public tracking URL keyed on exactly that. So we link direct to the
// carrier: no new integration, no credentials, works on data we already have.

const CARRIERS = [
  [/fedex\s*freight/i, (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}`],
  [/fedex/i,           (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}`],
  [/estes/i,           (n) => `https://www.estes-express.com/myestes/shipment-tracking/track?searchValue=${n}`],
  [/forward\s*air/i,   (n) => `https://www.forwardair.com/tracking?tracking=${n}`],
  [/\bups\b/i,         (n) => `https://www.ups.com/track?tracknum=${n}`],
  [/xpo/i,             (n) => `https://www.xpo.com/tracking/?referenceNumbers=${n}`],
  [/old\s*dominion|\bodfl\b/i, (n) => `https://www.odfl.com/us/en/tools/tracking.html?pro=${n}`],
  [/saia/i,            (n) => `https://www.saia.com/track/details?searchBy=PRO&numbers=${n}`],
  [/\babf\b|arcbest/i, (n) => `https://arcb.com/tools/tracking.html#/${n}`],
  [/\br\s*\+\s*l\b|rl\s*carriers/i, (n) => `https://www2.rlcarriers.com/freight/shipping/shipment-tracing?pro=${n}`],
  [/tforce/i,          (n) => `https://www.tforcefreight.com/ltl/apps/Tracking?proNumbers=${n}`],
  [/dayton/i,          (n) => `https://www.daytonfreight.com/tracking?number=${n}`],
];

// Everything ships through Logistics Plus, so their portal is the safe fallback
// when the carrier is unknown or blank — the user can paste the number there.
const LP_FALLBACK = "https://www.eshipplus.com/";

/** @returns {string|null} a public tracking URL, or null if there is nothing to link. */
export function trackingUrl(carrier, number) {
  const n = String(number || "").trim();
  if (!n) return null;
  const c = String(carrier || "");
  for (const [re, url] of CARRIERS) if (re.test(c)) return url(encodeURIComponent(n));
  // No carrier match: Google the number. Beats a dead link, and LTL PRO numbers
  // resolve to the right carrier's page on the first hit.
  return `https://www.google.com/search?q=${encodeURIComponent(n + " tracking")}`;
}

export { LP_FALLBACK };
