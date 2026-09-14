// SyncNowButton.jsx — "go and read NetSuite again, now".
//
// The cron re-reads NetSuite twice a day, which is the wrong cadence on the
// days it matters: a container lands, the receipt is keyed in, and the floor
// needs to see it before the next run. This button hits the same endpoint the
// cron hits (/api/sync-shipments), so there is one sync path, not two.
//
// Nothing secret comes near the browser. The cron authenticates with
// CRON_SECRET; a click sends no token at all and the server admits it on the
// strength of the session plus a short cooldown. Shipping the cron secret to
// the client to "reuse" the same door would have published the key to NetSuite.

import { useState } from "react";
import { T } from "../utils/theme";

export default function SyncNowButton({ onDone, label = "Sync now", compact = false }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  const run = async () => {
    setBusy(true); setMsg(null); setErr(null);
    try {
      const r = await fetch("/api/sync-shipments", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.hint || d.error || `HTTP ${r.status}`);
      setMsg(`${d.shipments || 0} shipments · ${d.receipts || 0} receipts · ${d.salesOrders || 0} orders`);
      if (onDone) onDone();
    } catch (e) {
      setErr(String((e && e.message) || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button onClick={run} disabled={busy}
        title="Re-read NetSuite right now — fulfillments, item receipts, open orders and on-hand. The scheduled sync runs at 8am and 2pm ET."
        style={{ padding: "3px 10px", borderRadius: 4, fontFamily: "inherit", fontSize: 10,
          border: "1px solid " + (busy ? T.BD : T.AC), background: "transparent",
          color: busy ? T.T2 : T.AC, cursor: busy ? "progress" : "pointer" }}>
        {busy ? "reading NetSuite…" : `⟳ ${label}`}
      </button>
      {(msg || err) && !compact && (
        <span style={{ fontSize: 9.5, maxWidth: 340, color: err ? "#b91c1c" : T.GR }}>
          {err || `synced · ${msg}`}
        </span>
      )}
    </>
  );
}
