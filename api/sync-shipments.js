// sync-shipments.js — Vercel serverless function, run by cron at 06:00 and 12:00
// America/Denver. Pulls Wana Cube Item Fulfillments for every market
// from NetSuite, transforms them with the shared report logic, and upserts the
// result into Supabase `shipment_log` (id = 1) for the Shipments tab to read.
//
// Required Vercel environment variables (Project → Settings → Environment
// Variables). All are NetSuite Token-Based Auth values — create an integration
// record and an access token in NetSuite, then paste them here:
//   NS_ACCOUNT        e.g. 1234567 or 1234567_SB1  (underscore form for sandbox)
//   NS_CONSUMER_KEY
//   NS_CONSUMER_SECRET
//   NS_TOKEN_ID
//   NS_TOKEN_SECRET
//   CRON_SECRET       any random string; Vercel sends it as the Bearer token
//
// Nothing here logs secrets. If the NS_* vars are missing the handler returns
// 503 and leaves the last good snapshot in place rather than clobbering it.

import crypto from "node:crypto";
import { buildShipmentReport } from "./_shipmentReport.js";

const SUPABASE_URL = "https://fxdyiurjioesdmedmgzu.supabase.co";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4ZHlpdXJqaW9lc2RtZWRtZ3p1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzIzOTYsImV4cCI6MjA4ODMwODM5Nn0.5ueK5iXQ35oThb02ClX3iErPwYR4tPih9GtBAmhDQYk";

const pct = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

// NetSuite TBA: OAuth 1.0a, HMAC-SHA256, account id as the realm.
function authHeader(method, url, env) {
  const p = {
    oauth_consumer_key: env.NS_CONSUMER_KEY,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA256",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: env.NS_TOKEN_ID,
    oauth_version: "1.0",
  };
  const paramStr = Object.keys(p).sort().map((k) => `${pct(k)}=${pct(p[k])}`).join("&");
  const base = [method.toUpperCase(), pct(url), pct(paramStr)].join("&");
  const key = `${pct(env.NS_CONSUMER_SECRET)}&${pct(env.NS_TOKEN_SECRET)}`;
  p.oauth_signature = crypto.createHmac("sha256", key).update(base).digest("base64");
  const realm = String(env.NS_ACCOUNT).toUpperCase();
  return "OAuth realm=\"" + realm + "\"," +
    Object.keys(p).sort().map((k) => `${pct(k)}="${pct(p[k])}"`).join(",");
}

async function suiteql(q, env, { pageSize = 1000 } = {}) {
  const host = String(env.NS_ACCOUNT).toLowerCase().replace(/_/g, "-");
  const rows = [];
  let offset = 0;
  for (let guard = 0; guard < 25; guard++) {          // §4.6 pagination is mandatory
    const url = `https://${host}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql?limit=${pageSize}&offset=${offset}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "transient", Authorization: authHeader("POST", url.split("?")[0], env) },
      body: JSON.stringify({ q }),
    });
    if (!res.ok) throw new Error(`SuiteQL ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = await res.json();
    rows.push(...(j.items || []));
    if (!j.hasMore) break;
    offset += pageSize;
  }
  return rows;
}

export default async function handler(req, res) {
  const env = process.env;
  // Vercel sends `Authorization: Bearer <CRON_SECRET>` on cron invocations.
  // Trim both sides — a trailing newline pasted into the env var is the most
  // common cause of a false mismatch — and tolerate a caller omitting "Bearer ".
  // Constant-time compare so the endpoint can't be used as an oracle.
  const expected = String(env.CRON_SECRET || "").trim();
  const NS_KEYS = ["NS_ACCOUNT", "NS_CONSUMER_KEY", "NS_CONSUMER_SECRET", "NS_TOKEN_ID", "NS_TOKEN_SECRET"];

  // ?diag=1 — setup check. Reports which variables the function can SEE and how
  // long the supplied bearer is. Never returns a secret value. Safe to remove
  // once the sync is confirmed working.
  if ((req.query && req.query.diag === "1") || /[?&]diag=1/.test(req.url || "")) {
    const got = String(req.headers.authorization || "").trim().replace(/^Bearer\s+/i, "").trim();
    return res.status(200).json({
      cron_secret_configured: !!expected,
      cron_secret_length: expected.length,
      bearer_received_length: got.length,
      bearer_matches: !!expected && got === expected,
      netsuite_present: NS_KEYS.filter((k) => !!env[k]),
      netsuite_missing: NS_KEYS.filter((k) => !env[k]),
      ns_account_length: String(env.NS_ACCOUNT || "").length,
    });
  }

  if (expected) {
    const got = String(req.headers.authorization || "").trim().replace(/^Bearer\s+/i, "").trim();
    const a = Buffer.from(got), b = Buffer.from(expected);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) return res.status(401).json({ error: "unauthorized", hint: "Authorization header did not match CRON_SECRET" });
  }
  const missing = NS_KEYS.filter((k) => !env[k]);
  if (missing.length) return res.status(503).json({ error: "NetSuite credentials not configured", missing });

  try {
    // §4.1 fulfillment lines — every Wana Cube component, all customers
    const lines = await suiteql(`
      SELECT t.id AS fid, t.tranid, t.trandate, t.entity AS customer_id,
             BUILTIN.DF(t.entity) AS customer_name,
             tl.item AS item_id, i.itemid, i.displayname,
             ABS(tl.quantity) AS qty, tl.createdfrom
      FROM transaction t
      JOIN transactionline tl ON tl.transaction = t.id
      LEFT JOIN item i ON i.id = tl.item
      WHERE t.type = 'ItemShip' AND tl.mainline = 'F' AND tl.item IS NOT NULL
        AND (i.itemid LIKE 'PL-WCB-%' OR i.itemid LIKE 'PB-WCB-%'
             OR i.itemid LIKE 'WANA-%' OR i.displayname LIKE '%Label Appl Fee%')
      ORDER BY t.trandate DESC`, env);

    const fids = [...new Set(lines.map((r) => r.fid))];
    const inList = fids.slice(0, 900).join(",") || "0";     // IN clause caps at 1000

    const [carrierRows, trackRows] = await Promise.all([
      suiteql(`SELECT doc, shippingmethod FROM transactionshipment WHERE doc IN (${inList})`, env).catch(() => []),
      suiteql(`SELECT t.id, tn.trackingnumber FROM transaction t
               LEFT JOIN trackingnumbermap tm ON tm.transaction = t.id
               LEFT JOIN trackingnumber tn ON tn.id = tm.trackingnumber
               WHERE t.id IN (${inList})`, env).catch(() => []),
    ]);
    const carrier = {}, tracking = {};
    for (const r of carrierRows) carrier[r.doc] = r.shippingmethod;
    for (const r of trackRows) if (r.trackingnumber) tracking[r.id] = r.trackingnumber;

    // §4.4 ordered quantities — never join `item` here, it times out at 180s
    const soIds = [...new Set(lines.map((r) => r.createdfrom).filter(Boolean))].slice(0, 900);
    const poQty = {};
    if (soIds.length) {
      const so = await suiteql(`SELECT tl.transaction, tl.item, ABS(tl.quantity) AS ordered_qty FROM transactionline tl
        WHERE tl.transaction IN (${soIds.join(",")}) AND tl.item IS NOT NULL AND tl.mainline = 'F'`, env).catch(() => []);
      // key by SO + item so progress is measured against the right order
      for (const r of so) { const k = `${r.transaction}|${r.item}`; poQty[k] = (poQty[k] || 0) + (Number(r.ordered_qty) || 0); }
    }

    const history = lines.map((r) => ({ item_id: r.item_id, createdfrom: r.createdfrom, trandate: r.trandate, qty: Number(r.qty) || 0 }));
    const report = buildShipmentReport(lines, { tracking, carrier, poQty, history });

    const r = await fetch(`${SUPABASE_URL}/rest/v1/shipment_log?id=eq.1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", apikey: ANON, Authorization: `Bearer ${ANON}`, Prefer: "return=minimal" },
      body: JSON.stringify({ data: report, updated_at: new Date().toISOString() }),
    });
    if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);

    return res.status(200).json({ ok: true, generated_at: report.generated_at,
      markets: report.markets, shipments: report.shipments.length, warnings: report.warnings.length });
  } catch (e) {
    // Surface the reason in Vercel logs — a cron failure is otherwise invisible
    // because the message only ever reached the HTTP response body.
    console.error('[sync-shipments] failed:', String(e && e.message || e));
    return res.status(500).json({ error: String(e.message || e) });
  }
}
