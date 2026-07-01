// Re-map CO "(Med) Stay Asleep 1:1:1" from Assorted (490) to the rec Stay
// Asleep Dreamberry lid (PL-WCB-110-00). Backup + dry-run/live.
import { mkdirSync, writeFileSync } from "node:fs";
const URL_="https://fxdyiurjioesdmedmgzu.supabase.co/rest/v1/scenarios?id=eq.1";
const ANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4ZHlpdXJqaW9lc2RtZWRtZ3p1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzIzOTYsImV4cCI6MjA4ODMwODM5Nn0.5ueK5iXQ35oThb02ClX3iErPwYR4tPih9GtBAmhDQYk";
const H={ "Content-Type":"application/json", apikey:ANON, Authorization:"Bearer "+ANON };
const live=process.argv.includes("--live");
const row=(await (await fetch(URL_,{headers:H})).json())[0];
const ts=new Date().toISOString().replace(/[:.]/g,"-");
mkdirSync(new URL("./backups/",import.meta.url),{recursive:true});
writeFileSync(new URL(`./backups/scenarios-${ts}.json`,import.meta.url),JSON.stringify(row,null,1));
let fixed=0;
for(const sc of row.data){ const co=(sc.markets||[]).find(m=>m.name==="Colorado"); if(!co?.skuDetail?.skus) continue;
  for(const s of co.skuDetail.skus){ if(s.name==="(Med) Stay Asleep 1:1:1" && s.sku==="PL-WCB-490-00"){ const a=(s.weekly||[]).reduce((x,v)=>x+(Number(v)||0),0); s.sku="PL-WCB-110-00"; console.log(`"${s.name}" 490 -> 110 (${a.toLocaleString()} u)`); fixed++; } } }
console.log(`backup scripts/backups/scenarios-${ts}.json · fixed ${fixed}`);
if(!fixed){ console.error("no match"); process.exit(1); }
if(!live){ console.log("dry run"); process.exit(0); }
const p=await fetch(URL_,{method:"PATCH",headers:{...H,Prefer:"return=minimal"},body:JSON.stringify({data:row.data,updated_at:new Date().toISOString()})});
if(!p.ok){ console.error("PATCH failed",p.status,await p.text()); process.exit(1); }
console.log("✓ done");
