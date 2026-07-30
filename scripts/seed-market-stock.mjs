import { mkdirSync, writeFileSync } from "node:fs";
const URL_="https://fxdyiurjioesdmedmgzu.supabase.co/rest/v1/actuals?id=eq.1";
const K="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4ZHlpdXJqaW9lc2RtZWRtZ3p1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzIzOTYsImV4cCI6MjA4ODMwODM5Nn0.5ueK5iXQ35oThb02ClX3iErPwYR4tPih9GtBAmhDQYk";
const H={ "Content-Type":"application/json", apikey:K, Authorization:"Bearer "+K };
// New Jersey component position from Cory's on-hand pivot (30 Jul 2026)
const NJ={
 "PL-WCB-415-00":{lid:4968, base:3780},  "PL-WCB-460-00":{lid:8694, base:0},
 "PL-WCB-120-00":{lid:20304,base:20412}, "PL-WCB-405-00":{lid:3726, base:0},
 "PL-WCB-125-00":{lid:14256,base:12096}, "PL-WCB-465-00":{lid:7452, base:1134},
 "PL-WCB-470-00":{lid:3726, base:0},     "PL-WCB-420-00":{lid:4968, base:4158},
 "PL-WCB-480-00":{lid:11178,base:0},     "PL-WCB-485-00":{lid:18198,base:10206},
 "PL-WCB-410-00":{lid:2484, base:2646},  "PL-WCB-110-00":{lid:14346,base:24570},
 "PL-WCB-115-00":{lid:7776, base:6804},
};
const live=process.argv.includes("--live");
const row=(await (await fetch(URL_,{headers:H})).json())[0];
mkdirSync("scripts/backups",{recursive:true});
writeFileSync(`scripts/backups/actuals-${new Date().toISOString().replace(/[:.]/g,"-")}.json`, JSON.stringify(row,null,1));
row.data.marketStock=row.data.marketStock||{};
row.data.marketStock["New Jersey"]=NJ;
row.data.applySchedule=row.data.applySchedule||{capacity:12474,log:[],overrides:{}};
row.data.applySchedule.preApplied=row.data.applySchedule.preApplied||{};
row.data.applySchedule.preApplied["New Jersey|PL-WCB-465-00"]=6426;  // Sunrise base already labelled
const L=Object.values(NJ).reduce((a,v)=>a+v.lid,0), B=Object.values(NJ).reduce((a,v)=>a+v.base,0);
console.log(`NJ component stock: ${Object.keys(NJ).length} flavors · lids ${L.toLocaleString()} · bases ${B.toLocaleString()}`);
console.log(`pre-applied: NJ Sunrise base 6,426`);
if(!live){console.log("dry run — pass --live");process.exit(0);}
const p=await fetch(URL_,{method:"PATCH",headers:{...H,Prefer:"return=minimal"},body:JSON.stringify({data:row.data,updated_at:new Date().toISOString()})});
console.log("PATCH",p.status,p.ok?"✓ seeded":await p.text());
