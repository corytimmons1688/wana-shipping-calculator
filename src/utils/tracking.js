// tracking.js — build a direct carrier tracking link from the NetSuite
// tracking number + shipping method.
//
// FedEx LTL is the trap here: FedEx Freight PROs resolve ONLY on
// fedexfreight.com. Send the same PRO to fedex.com and it answers "the tracking
// number you entered can't be found", which looks like bad data but is just the
// wrong site. NetSuite labels these loads both "FedEx Freight" and plain
// "FEDEX", and 10-digit numbers under either label are Freight PROs — verified
// against live shipments 9406498754 and 0368241193, both of which track.
//
// One caveat that is real: the tracking field is free text, so it also holds
// typed-in placeholders. "PICKEDUP" sits in it on nine fulfillments. Those are
// suppressed below rather than linked to a page that cannot resolve them.

const fedexFreight = (n) => `https://www.fedexfreight.com/fedextrack/?trknbr=${n}&trkqual=~${n}~FDFR`;
// Express/Ground barcodes are 12 or 15 digits; anything shorter is an LTL PRO.
const isParcelLen = (raw) => /^\d{12}$|^\d{15}$/.test(raw);

// Formats that identify their own carrier regardless of what the shipping
// method says — these win, because the method field is frequently wrong.
const BY_FORMAT = [
  [/^1Z[0-9A-Z]{16}$/i,        (n) => `https://www.ups.com/track?loc=en_US&tracknum=${n}&requester=ST/`],
  [/^(94|93|92|95)\d{18,20}$/, (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`],
];

// Carrier tracking URLs, keyed on the NetSuite shipping method.
const BY_CARRIER = [
  [/fedex\s*freight/i,              (n) => fedexFreight(n)],
  [/fedex/i, (n, raw) => (isParcelLen(raw) ? `https://www.fedex.com/fedextrack/?trknbr=${n}` : fedexFreight(n))],
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
  for (const [re, url] of BY_FORMAT) if (re.test(n)) return url(enc, n);
  const c = String(carrier || "");
  for (const [re, url] of BY_CARRIER) if (re.test(c)) return url(enc, n);
  return LP_PORTAL;
}
