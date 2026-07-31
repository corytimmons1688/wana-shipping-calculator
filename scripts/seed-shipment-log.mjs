import { readFileSync } from "node:fs";
import { buildShipmentReport } from "/Users/cory/Projects/wana-shipping-calculator/api/_shipmentReport.js";
const lines = JSON.parse(readFileSync("/tmp/ship-lines.json","utf8"));
const trk = JSON.parse(readFileSync("/tmp/ship-track.json","utf8"));
const tracking={}, carrier={};
for(const r of trk){ carrier[r.fid]=r.shippingmethod; if(r.trackingnumber) tracking[r.fid]=r.trackingnumber; }
const history = lines.map(r=>({item_id:r.item_id, trandate:r.trandate, qty:Number(r.qty)||0}));
const rows = lines.map(r=>({ fid:r.fid, tranid:r.tranid, trandate:r.trandate, item_id:r.item_id,
  itemid:r.itemid, displayname:r.displayname, qty:Number(r.qty)||0, createdfrom:r.createdfrom,
  customer_id:r.companyname, customer_name:r.companyname }));
const rep = buildShipmentReport(rows, { tracking, carrier, poQty:{}, history });
console.log("markets:", rep.markets.join(", "));
console.log("shipments:", rep.shipments.length, "| warnings:", rep.warnings.length);
for(const s of rep.shipments.slice(0,3))
  console.log(`  ${s.ship_date} ${s.market||"?"} ${s.tracking_display} — ${s.lines.length} lines (${s.fulfillment_tranids.join("+")})`);
const U="https://fxdyiurjioesdmedmgzu.supabase.co/rest/v1/shipment_log?id=eq.1";
const K="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4ZHlpdXJqaW9lc2RtZWRtZ3p1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzIzOTYsImV4cCI6MjA4ODMwODM5Nn0.5ueK5iXQ35oThb02ClX3iErPwYR4tPih9GtBAmhDQYk";
if(process.argv.includes("--live")){
  const r=await fetch(U,{method:"PATCH",headers:{"Content-Type":"application/json",apikey:K,Authorization:"Bearer "+K,Prefer:"return=minimal"},body:JSON.stringify({data:rep,updated_at:new Date().toISOString()})});
  console.log("PATCH",r.status,r.ok?"✓ seeded":await r.text());
} else console.log("dry run");
