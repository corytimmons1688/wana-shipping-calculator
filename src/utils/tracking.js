// tracking.js — build a direct carrier tracking link from the NetSuite
// tracking number + shipping method.
//
// Caveat worth knowing: NetSuite's tracking field is free text, not a validated
// carrier number. Across all fulfillments it holds real UPS 1Z barcodes, bare
// LTL PRO numbers, BOL numbers, air-waybill forms like 164-8121980, and literal
// placeholders — "PICKEDUP" appears on nine separate fulfillments. Links are
// only as good as what was typed in, so NON_TRACKING below suppresses the link
// for values that plainly are not numbers rather than sending anyone to a
// carrier page that cannot possibly resolve them.

// Formats that identify their own carrier regardless of what the shipping
// method says — these win, because the method field is frequently wrong.
const BY_FORMAT = [
  [/^1Z[0-9A-Z]{16}$/i,        (n) => `https://www.ups.com/track?loc=en_US&tracknum=${n}&requester=ST/`],
  [/^(94|93|92|95)\d{18,20}$/, (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`],
];

// Carrier tracking URLs, keyed on the NetSuite shipping method.
const BY_CARRIER = [
  [/fedex\s*freight/i,              (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}&trkqual=~${n}~FDFR`],
  [/fedex/i,                        (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}`],
  [/estes/i,                        (n) => `https://www.estes-express.com/myestes/shipment-tracking/track?searchValue=${n}&searchType=PRO`],
  [/forward\s*air/i,                (n) => `https://www.forwardair.com/tracking?trackingNumbers=${n}`],
  [/\bups\b/i,                      (n) => `https://www.ups.com/track?loc=en_US&tracknum=${n}&requester=ST/`],
  [/xpo/i,                          (n) => `https://www.xpo.com/tracking/?referenceNumbers=${n}`],
  [/old\s*dominion|\bodfl\b/i,      (n) => `https://www.odfl.com/us/en/tools/tracking.html?pro=${n}`],
  [/saia/i,                         (n) => `https://www.saia.com/track/details?searchBy=PRO&numbers=${n}`],
  [/\babf\b|arcbest/i,              (n) => `https://arcb.com/tools/tracking.html#/${n}`],
  [/\br\s*\+\s*l\b|rl\s*carriers/i, (n) => `https://www2.rlcarriers.com/freight/shipping/shipment-tracing?pro=${n}&docType=PRO`],
  [/tforce/i,                       (n) => `https://www.tforcefreight.com/ltl/apps/Tracking?proNumbers=${n}`],
  [/dayton/i,                       (n) => `https://www.daytonfreight.com/tracking?number=${n}`],
  [/southeastern|\bsefl\b/i,        (n) => `https://www.sefl.com/Tracing/index.jsp?pro=${n}`],
  [/averitt/i,                      (n) => `https://www.averittexpress.com/tools/tracking?trackingNumber=${n}`],
];

// Everything routes through Logistics Plus, so their portal resolves anything
// booked there — including BOL numbers no carrier will recognise.
export const LP_PORTAL = "https://www.eshipplus.com/";

// Values that are not tracking numbers at all. Linking these is worse than
// showing plain text: it looks like the dashboard is broken.
const NON_TRACKING = /^(pickedup|picked\s*up|n\/?a|none|tbd|will\s*call|customer\s*pickup|pending|\-+)$/i;
export const isTrackable = (n) => {
  const s = String(n || "").trim();
  return !!s && !NON_TRACKING.test(s) && /\d/.test(s);
};

/** @returns {string|null} a direct carrier tracking URL, or null if unlinkable. */
export function trackingUrl(carrier, number) {
  const n = String(number || "").trim();
  if (!isTrackable(n)) return null;
  const enc = encodeURIComponent(n);
  for (const [re, url] of BY_FORMAT) if (re.test(n)) return url(enc);
  const c = String(carrier || "");
  for (const [re, url] of BY_CARRIER) if (re.test(c)) return url(enc);
  return LP_PORTAL;
}
