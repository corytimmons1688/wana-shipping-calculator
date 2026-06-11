// rebrandForecasts.js — Massachusetts weekly item forecast (from Wana's MA
// delivery schedule, weeks of Jun 29 – Aug 31 2026) + default shape for the
// shared "actuals" row (inbound/outbound shipments, POs, adjustments, targets).

export const MA_SKU_DETAIL = {
  weeks: ["2026-06-29","2026-07-06","2026-07-13","2026-07-20","2026-07-27","2026-08-03","2026-08-10","2026-08-17","2026-08-24","2026-08-31"],
  skus: [
    { cat:"Optimal", name:"Fast Asleep Grape",          sku:"PL-WCB-120-00", startWk:0, weekly:[4000,0,0,0,0,4000,0,0,0,4000] },
    { cat:"Optimal", name:"Stay Asleep Dreamberry",     sku:"PL-WCB-110-00", startWk:0, weekly:[4000,0,0,0,0,4000,0,0,0,6000] },
    { cat:"Optimal", name:"Keep Calm Blissberry",       sku:"PL-WCB-125-00", startWk:0, weekly:[0,0,0,0,0,0,0,0,0,4000] },
    { cat:"Optimal", name:"Swift Recovery Cherry Cola", sku:"PL-WCB-115-00", startWk:0, weekly:[4000,0,0,0,0,0,0,0,0,0] },
    { cat:"Optimal", name:"Good Time Clementine",       sku:"PL-WCB-105-00", startWk:0, weekly:[0,0,0,0,0,0,0,0,0,4000] },
    { cat:"Quick",   name:"Bubbly Peach",               sku:"PL-WCB-460-00", startWk:0, weekly:[0,0,0,0,0,6000,0,0,0,0] },
    { cat:"Quick",   name:"Peaceful Pear",              sku:"PL-WCB-480-00", startWk:0, weekly:[0,0,0,0,0,6000,0,0,0,0] },
    { cat:"Quick",   name:"Relaxed Raspberry",          sku:"PL-WCB-485-00", startWk:0, weekly:[0,0,0,0,0,6000,0,0,0,0] },
    { cat:"Quick",   name:"Bright Berry Lime",          sku:"PL-WCB-475-00", startWk:0, weekly:[4000,0,0,0,0,0,0,0,0,4000] },
    { cat:"Quick",   name:"Mass Sunrise",               sku:"PL-WCB-465-00", startWk:0, weekly:[8000,0,0,0,0,0,0,0,0,0] },
    { cat:"Quick",   name:"Paradise POG",               sku:"PL-WCB-470-00", startWk:0, weekly:[4000,0,0,0,0,0,0,0,0,0] },
    { cat:"Classic", name:"Go Go Mango",                sku:"PL-WCB-405-00", startWk:0, weekly:[4000,0,0,0,0,0,0,0,0,0] },
    { cat:"Classic", name:"Mellow Melon",               sku:"PL-WCB-430-00", startWk:0, weekly:[4000,0,0,0,0,0,0,0,0,0] },
    { cat:"Classic", name:"Blissful Blueberry",         sku:"PL-WCB-415-00", startWk:0, weekly:[4000,0,0,0,0,0,0,0,0,0] },
    { cat:"Classic", name:"Serene Yuzu",                sku:"PL-WCB-410-00", startWk:0, weekly:[0,0,0,0,0,0,0,0,0,0] },
    { cat:"Classic", name:"Balanced Berry Guava",       sku:"PL-WCB-435-00", startWk:0, weekly:[0,0,0,0,0,0,0,0,0,0] },
    { cat:"Classic", name:"Chill Black Cherry",         sku:"PL-WCB-425-00", startWk:0, weekly:[0,0,0,0,0,4000,0,0,0,0] },
    { cat:"Classic", name:"Breezy Pineapple",           sku:"PL-WCB-440-00", startWk:0, weekly:[4000,0,0,0,0,0,0,0,0,0] },
    { cat:"Classic", name:"Passion Pineapple",          sku:"PL-WCB-420-00", startWk:0, weekly:[0,0,0,0,0,0,0,0,0,0] },
  ],
};

export const DEFAULT_ACTUALS = {
  inbound: [],
  outbound: [],
  poLines: [],
  adjustments: [],
  targets: { ropMonths: 5.5, maxMonths: 8.5, rows: [] },
  milestones: [],
};
