export function dc(o) { return JSON.parse(JSON.stringify(o)); }
export function fm(v) {
  return v == null || isNaN(v) ? "\u2014" : Number(v).toLocaleString();
}
export function f$(v) {
  return v == null || isNaN(v) ? "\u2014" : "$" + Number(v).toLocaleString(undefined, {minimumFractionDigits:0,maximumFractionDigits:0});
}
export function fC(v) {
  return v == null || isNaN(v) ? "\u2014" : "$" + Number(v).toLocaleString(undefined, {minimumFractionDigits:2,maximumFractionDigits:2});
}
// FIXED: null guard prevents crash when date is null/undefined
export function dF(d) {
  return d ? d.toLocaleDateString("en-US", {month:"short",day:"numeric"}) : "\u2014";
}
