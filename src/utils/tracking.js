// tracking.js — turn a carrier + tracking number into something actionable.
//
// What we learned the hard way: most of these numbers do NOT resolve on carrier
// public tracking. NetSuite holds exactly one number per fulfillment, and for
// the LTL carriers it is a Logistics Plus reference — FedEx returns "can't be
// found" for 9406498754 whether or not the freight qualifier is supplied, so
// the URL was never the problem. Deep-linking those numbers just produces a
// dead end that looks like a bug in this dashboard.
//
// So: deep-link ONLY the formats that are unambiguously carrier-native (UPS 1Z,
// FedEx Express 12-digit, USPS). Everything else gets the carrier's tracking
// page plus a one-click copy, so the number is on the clipboard ready to paste.

// Numbers whose format identifies the carrier on its own. These resolve.
const PARCEL = [
  [/^1Z[0-9A-Z]{16}$/i, (n) => `https://www.ups.com/track?tracknum=${n}`],
  [/^\d{12}$/,          (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}`],
  [/^\d{15}$/,          (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}`],
  [/^(94|93|92|95)\d{18,20}$/, (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`],
];

// Tracking landing pages — paste the copied number here.
const PAGES = [
  [/fedex/i,                       "https://www.fedex.com/en-us/tracking.html"],
  [/estes/i,                       "https://www.estes-express.com/myestes/shipment-tracking/"],
  [/forward\s*air/i,               "https://www.forwardair.com/tracking"],
  [/\bups\b/i,                     "https://www.ups.com/track"],
  [/xpo/i,                         "https://www.xpo.com/tracking/"],
  [/old\s*dominion|\bodfl\b/i,     "https://www.odfl.com/us/en/tools/tracking.html"],
  [/saia/i,                        "https://www.saia.com/track"],
  [/\babf\b|arcbest/i,             "https://arcb.com/tools/tracking.html"],
  [/\br\s*\+\s*l\b|rl\s*carriers/i,"https://www2.rlcarriers.com/freight/shipping/shipment-tracing"],
  [/tforce/i,                      "https://www.tforcefreight.com/ltl/apps/Tracking"],
  [/dayton/i,                      "https://www.daytonfreight.com/tracking"],
];

// Everything here is booked through Logistics Plus, so their portal is where a
// number with no carrier — or an unrecognised one — will actually be found.
export const LP_PORTAL = "https://www.eshipplus.com/";

/**
 * @returns {{url: string, direct: boolean}|null}
 *   direct=true  → the link lands on the shipment itself
 *   direct=false → the link opens a search form; paste the copied number
 */
export function trackingTarget(carrier, number) {
  const n = String(number || "").trim();
  if (!n) return null;
  for (const [re, url] of PARCEL) if (re.test(n)) return { url: url(encodeURIComponent(n)), direct: true };
  const c = String(carrier || "");
  for (const [re, url] of PAGES) if (re.test(c)) return { url, direct: false };
  return { url: LP_PORTAL, direct: false };
}
