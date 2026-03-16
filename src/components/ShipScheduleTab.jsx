import { useMemo } from "react";
import { MASTER_SKUS, BASE_TYPES } from "../data/skuMaster";
import { calcSkuDemand } from "../utils/calc";
import { fm, dF } from "../utils/format";
import { T, tbl, th, td } from "../utils/theme";

var GROUPS = ["Black Sparkle", "White"];
var GROUP_COLORS = { "Black Sparkle": { hd: "#1a1a2e", tx: "#fff" }, "White": { hd: "#6b7280", tx: "#fff" } };

// Build weekly SKU ship schedule from displayShips + skuDemand
function buildSchedule(ships, skuDemand) {
  if (!ships || ships.length === 0) return { weeks: [], bySku: {} };

  var allSkus = Object.keys(skuDemand);

  // Pre-compute annual demand per SKU (fallback for months with zero demand)
  var annualDem = {};
  var totalAnnualDem = 0;
  for (var ai = 0; ai < allSkus.length; ai++) {
    var annSum = 0;
    var d2 = skuDemand[allSkus[ai]];
    if (d2) for (var am = 0; am < 12; am++) annSum += (d2[am] || 0);
    annualDem[allSkus[ai]] = annSum;
    totalAnnualDem += annSum;
  }

  // Snap date to the production-week grid (every 7 days from Mar 9 2026)
  var PROD_START = new Date(2026, 2, 9).getTime();
  var WEEK_MS = 7 * 86400000;
  function snapToProductionWeek(date) {
    var t = date.getTime();
    var diff = t - PROD_START;
    var wkIdx = Math.round(diff / WEEK_MS);
    return new Date(PROD_START + wkIdx * WEEK_MS);
  }

  // Group shipments by production week (same grid as unified view)
  var weekMap = {};
  for (var i = 0; i < ships.length; i++) {
    var sh = ships[i];
    if (!sh.bSd || sh.bQ <= 0) continue;
    var snapped = snapToProductionWeek(new Date(sh.bSd));
    snapped.setHours(0,0,0,0);
    var key = snapped.getTime();
    if (!weekMap[key]) weekMap[key] = { wk: snapped, shipments: [] };
    weekMap[key].shipments.push(sh);
  }

  var weekKeys = Object.keys(weekMap).map(Number).sort(function(a, b) { return a - b; });
  var weeks = [];
  for (var wi = 0; wi < weekKeys.length; wi++) weeks.push(weekMap[weekKeys[wi]]);

  var bySku = {};
  for (var si = 0; si < allSkus.length; si++) bySku[allSkus[si]] = new Array(weeks.length).fill(0);

  for (var wki = 0; wki < weeks.length; wki++) {
    var wkShips = weeks[wki].shipments;
    for (var shi = 0; shi < wkShips.length; shi++) {
      var s = wkShips[shi];

      // Use ARRIVAL month for proportions
      var arrMo = s.bAr ? s.bAr.getMonth() : (s.mo != null ? s.mo : -1);

      var useMonthly = false;
      var totalDem = 0;
      if (arrMo >= 0 && arrMo <= 11) {
        for (var ski = 0; ski < allSkus.length; ski++) {
          var dem = skuDemand[allSkus[ski]];
          if (dem) totalDem += (dem[arrMo] || 0);
        }
        if (totalDem > 0) useMonthly = true;
      }
      if (!useMonthly) totalDem = totalAnnualDem;
      if (totalDem <= 0) continue;

      var allocated = 0;
      var skuAllocs = [];
      for (var ski2 = 0; ski2 < allSkus.length; ski2++) {
        var skuCode = allSkus[ski2];
        var skuDem = useMonthly
          ? ((skuDemand[skuCode] && skuDemand[skuCode][arrMo]) || 0)
          : (annualDem[skuCode] || 0);
        if (skuDem <= 0) { skuAllocs.push(0); continue; }
        var share = Math.round(s.bQ * skuDem / totalDem);
        skuAllocs.push(share);
        allocated += share;
      }
      var remainder = s.bQ - allocated;
      if (remainder !== 0) {
        var maxIdx = 0, maxVal = 0;
        for (var fi = 0; fi < skuAllocs.length; fi++) {
          if (skuAllocs[fi] > maxVal) { maxVal = skuAllocs[fi]; maxIdx = fi; }
        }
        skuAllocs[maxIdx] += remainder;
      }
      for (var ski3 = 0; ski3 < allSkus.length; ski3++) {
        if (!bySku[allSkus[ski3]]) bySku[allSkus[ski3]] = new Array(weeks.length).fill(0);
        bySku[allSkus[ski3]][wki] += skuAllocs[ski3];
      }
    }
  }

  return { weeks: weeks, bySku: bySku };
}

export default function ShipScheduleTab({ sc, ships }) {
  var skuDemand = useMemo(function() { return calcSkuDemand(sc.markets); }, [sc.markets]);
  var schedule = useMemo(function() { return buildSchedule(ships, skuDemand); }, [ships, skuDemand]);

  // Build grouped rows
  var groups = useMemo(function() {
    var out = [];
    for (var gi = 0; gi < GROUPS.length; gi++) {
      var gName = GROUPS[gi];
      var skus = MASTER_SKUS.filter(function(s) { return s.base === gName; });
      var rows = [];
      for (var si = 0; si < skus.length; si++) {
        var s = skus[si];
        var dem = skuDemand[s.sku] || new Array(12).fill(0);
        rows.push({ sku: s.sku, name: s.name, cat: s.cat, demand: dem });
      }
      out.push({ name: gName, baseSku: BASE_TYPES[gName].sku, rows: rows });
    }
    // Add unmapped row if any
    if (skuDemand._unmapped) {
      var mappedSkus = {};
      for (var mi = 0; mi < MASTER_SKUS.length; mi++) mappedSkus[MASTER_SKUS[mi].sku] = true;
      var unmappedDem = new Array(12).fill(0);
      var keys = Object.keys(skuDemand);
      for (var ki = 0; ki < keys.length; ki++) {
        var k = keys[ki];
        if (k === "_unmapped" || !mappedSkus[k]) {
          for (var um = 0; um < 12; um++) unmappedDem[um] += skuDemand[k][um];
        }
      }
      out[1].rows.push({ sku: "_unmapped", name: "Assorted / Unmapped (CO HD, etc.)", cat: "Other", demand: unmappedDem });
    }
    return out;
  }, [skuDemand]);

  var wks = schedule.weeks;
  var byS = schedule.bySku;
  var noShips = wks.length === 0;

  var totalScheduled = 0;
  for (var tsi = 0; tsi < (ships || []).length; tsi++) totalScheduled += ((ships[tsi].bQ || 0));

  return (
    <div style={{ padding: "14px 18px" }}>
      {/* Summary Cards */}
      <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        {[
          { l: "Total Scheduled", v: fm(Math.round(totalScheduled)), c: T.AC },
          { l: "Shipments", v: (ships || []).length, c: T.GR },
          { l: "Ship Weeks", v: wks.length, c: T.AM },
        ].map(function(c2, i) {
          return (
            <div key={i} style={{ background: T.S2, borderRadius: 7, padding: "8px 14px", border: "1px solid " + T.BD, minWidth: 120 }}>
              <div style={{ color: T.T2, fontSize: 9, textTransform: "uppercase", marginBottom: 2 }}>{c2.l}</div>
              <div style={{ color: c2.c, fontSize: 17, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{c2.v}</div>
            </div>
          );
        })}
      </div>

      {noShips ? (
        <div style={{ padding: 24, textAlign: "center", color: T.T2, fontSize: 13 }}>
          No shipments in the schedule yet. Add shipments in the Shipment Details view first.
        </div>
      ) : (
        <div style={{ overflowX: "auto", maxHeight: "calc(100vh - 240px)", overflowY: "auto" }}>
          <table style={tbl}>
            <thead>
              <tr>
                <th style={{ ...th, minWidth: 200, position: "sticky", left: 0, zIndex: 4, background: T.S1 }}>SKU</th>
                <th style={{ ...th, width: 50, textAlign: "center" }}>Cat</th>
                {wks.map(function(w, wi2) {
                  var meths = {};
                  for (var si2 = 0; si2 < w.shipments.length; si2++) meths[w.shipments[si2].meth] = true;
                  var methList = Object.keys(meths).join(", ");
                  return (
                    <th key={wi2} style={{ ...th, textAlign: "right", minWidth: 72, fontSize: 9 }}>
                      <div>{dF(w.wk)}</div>
                      <div style={{ fontSize: 8, color: T.T2, fontWeight: 400, marginTop: 1 }}>{methList}</div>
                    </th>
                  );
                })}
                <th style={{ ...th, textAlign: "right", minWidth: 80 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(function(g, gi2) {
                var gc = GROUP_COLORS[g.name];
                var groupWkTotals = new Array(wks.length).fill(0);
                var groupGrand = 0;
                for (var ri2 = 0; ri2 < g.rows.length; ri2++) {
                  var skuWk = byS[g.rows[ri2].sku] || new Array(wks.length).fill(0);
                  for (var wi3 = 0; wi3 < wks.length; wi3++) { groupWkTotals[wi3] += (skuWk[wi3] || 0); groupGrand += (skuWk[wi3] || 0); }
                }

                var headerRow = (
                  <tr key={"shdr-" + gi2}>
                    <td colSpan={2} style={{ ...td, fontWeight: 700, color: gc.tx, background: gc.hd, fontSize: 11, borderBottom: "2px solid " + gc.hd, position: "sticky", left: 0, zIndex: 3 }}>
                      {g.name} ({g.baseSku})
                    </td>
                    {groupWkTotals.map(function(v, wi4) {
                      return <td key={wi4} style={{ ...td, textAlign: "right", fontWeight: 700, color: gc.tx, background: gc.hd, fontSize: 10, borderBottom: "2px solid " + gc.hd }}>{v > 0 ? fm(Math.round(v)) : ""}</td>;
                    })}
                    <td style={{ ...td, textAlign: "right", fontWeight: 700, color: gc.tx, background: gc.hd, fontSize: 10, borderBottom: "2px solid " + gc.hd }}>{fm(Math.round(groupGrand))}</td>
                  </tr>
                );

                var dataRows = g.rows.map(function(row, rowIdx) {
                  var skuWeekly = byS[row.sku] || new Array(wks.length).fill(0);
                  var rowTotal = 0;
                  for (var rti = 0; rti < wks.length; rti++) rowTotal += (skuWeekly[rti] || 0);

                  return (
                    <tr key={"srow-" + gi2 + "-" + rowIdx} style={{ background: rowIdx % 2 === 0 ? "transparent" : T.S2 + "60" }}>
                      <td style={{ ...td, fontWeight: 500, fontSize: 11, position: "sticky", left: 0, zIndex: 2, background: rowIdx % 2 === 0 ? T.S1 : T.S2 + "60" }}>
                        <span style={{ color: T.TX }}>{row.name}</span>
                        <span style={{ marginLeft: 6, fontSize: 9, color: T.T2 + "90" }}>{row.sku !== "_unmapped" ? row.sku : ""}</span>
                      </td>
                      <td style={{ ...td, textAlign: "center", fontSize: 9, color: T.T2 }}>{row.cat}</td>
                      {skuWeekly.map(function(v, wi5) {
                        var hasVal = v > 0;
                        return <td key={wi5} style={{ ...td, textAlign: "right", color: hasVal ? T.TX : T.T2 + "30", fontSize: 11, background: hasVal ? "#f0fdf440" : undefined }}>{hasVal ? fm(Math.round(v)) : ""}</td>;
                      })}
                      <td style={{ ...td, textAlign: "right", fontWeight: 700, fontSize: 11 }}>{rowTotal > 0 ? fm(Math.round(rowTotal)) : ""}</td>
                    </tr>
                  );
                });

                return [headerRow].concat(dataRows);
              })}

              {/* Grand Total Row */}
              {(function() {
                var gT = new Array(wks.length).fill(0);
                for (var tgi = 0; tgi < groups.length; tgi++) {
                  for (var tri = 0; tri < groups[tgi].rows.length; tri++) {
                    var skuW = byS[groups[tgi].rows[tri].sku] || new Array(wks.length).fill(0);
                    for (var twi = 0; twi < wks.length; twi++) gT[twi] += (skuW[twi] || 0);
                  }
                }
                var grandTotal = 0; for (var gti = 0; gti < wks.length; gti++) grandTotal += gT[gti];
                return (
                  <tr style={{ background: T.AC + "10" }}>
                    <td colSpan={2} style={{ ...td, fontWeight: 700, color: T.AC, borderTop: "2px solid " + T.AC, position: "sticky", left: 0, zIndex: 2, background: T.AC + "10" }}>TOTAL</td>
                    {gT.map(function(v, i) { return <td key={i} style={{ ...td, textAlign: "right", fontWeight: 700, color: T.AC, borderTop: "2px solid " + T.AC }}>{v > 0 ? fm(Math.round(v)) : ""}</td>; })}
                    <td style={{ ...td, textAlign: "right", fontWeight: 700, color: T.AC, borderTop: "2px solid " + T.AC }}>{fm(Math.round(grandTotal))}</td>
                  </tr>
                );
              })()}

              {/* Per-week shipment total row (bQ totals for validation) */}
              <tr style={{ background: T.GR + "08" }}>
                <td colSpan={2} style={{ ...td, fontWeight: 600, color: T.GR, fontSize: 10, position: "sticky", left: 0, zIndex: 2, background: T.GR + "08" }}>Shipment bQ</td>
                {wks.map(function(w, wi6) {
                  var wkBQ = 0;
                  for (var sbi = 0; sbi < w.shipments.length; sbi++) wkBQ += (w.shipments[sbi].bQ || 0);
                  return <td key={wi6} style={{ ...td, textAlign: "right", fontWeight: 600, color: T.GR, fontSize: 10 }}>{wkBQ > 0 ? fm(wkBQ) : ""}</td>;
                })}
                <td style={{ ...td, textAlign: "right", fontWeight: 700, color: T.GR, fontSize: 10 }}>{fm(Math.round(totalScheduled))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
