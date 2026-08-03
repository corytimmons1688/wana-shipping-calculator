// AdminPage.jsx — who may use this dashboard. Admin-only; every action is
// re-checked server-side in api/access.js, so hiding the tab is convenience,
// not the security boundary.

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "./authClient";
import { T, tbl, th, td } from "../utils/theme";

const mono = { fontFamily: "'JetBrains Mono',monospace" };
const STATUS = {
  approved: { label: "Approved", fg: "#15803d", bg: "#dcfce7" },
  pending:  { label: "Pending",  fg: "#92400e", bg: "#fef3c7" },
  denied:   { label: "Denied",   fg: "#991b1b", bg: "#fee2e2" },
};
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");

export default function AdminPage({ me }) {
  const [rows, setRows] = useState([]);
  const [state, setState] = useState({ loading: true, err: null });
  const [busyId, setBusyId] = useState(null);
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    setState({ loading: true, err: null });
    try {
      const r = await apiFetch("/api/access?users=1");
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.hint || j.error || `HTTP ${r.status}`);
      }
      const j = await r.json();
      setRows(j.users || []);
      setState({ loading: false, err: null });
    } catch (e) { setState({ loading: false, err: String(e.message || e) }); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (user_id, action) => {
    setBusyId(user_id);
    try {
      const r = await apiFetch("/api/access", { method: "POST", body: JSON.stringify({ user_id, action }) });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setState((s) => ({ ...s, err: j.error || `HTTP ${r.status}` }));
      } else await load();
    } finally { setBusyId(null); }
  };

  const pending = rows.filter((r) => r.status === "pending");
  const shown = filter === "all" ? rows : rows.filter((r) => r.status === filter);

  const btn = (label, onClick, tone, disabled) => (
    <button onClick={onClick} disabled={disabled} style={{
      padding: "2px 8px", borderRadius: 4, fontSize: 9.5, fontWeight: 700, fontFamily: "inherit",
      cursor: disabled ? "not-allowed" : "pointer", marginRight: 4, opacity: disabled ? 0.5 : 1,
      border: "1px solid " + tone, background: "transparent", color: tone }}>{label}</button>
  );

  return (
    <div style={{ padding: "14px 18px" }}>
      <div style={{ display: "flex", gap: 10, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>User access</span>
        <label style={{ fontSize: 10, color: T.T2, display: "flex", alignItems: "center", gap: 4 }}>
          Status
          <select value={filter} onChange={(e) => setFilter(e.target.value)}
            style={{ background: T.S2, border: "1px solid " + T.BD, color: T.AC, borderRadius: 3,
              padding: "2px 6px", fontSize: 11, fontFamily: "inherit" }}>
            <option value="all">All</option><option value="pending">Pending</option>
            <option value="approved">Approved</option><option value="denied">Denied</option>
          </select>
        </label>
        <button onClick={load} style={{ padding: "3px 10px", borderRadius: 4, border: "1px solid " + T.BD,
          background: "transparent", color: T.T2, cursor: "pointer", fontSize: 10 }}>↻ Refresh</button>
        {[["Users", rows.length, T.AC], ["Awaiting approval", pending.length, pending.length ? "#b45309" : T.GR],
          ["Admins", rows.filter((r) => r.is_admin).length, T.TX]].map(([l, v, c]) => (
          <div key={l} style={{ background: T.S2, borderRadius: 5, padding: "3px 9px", border: "1px solid " + T.BD }}>
            <div style={{ color: T.T2, fontSize: 8, textTransform: "uppercase" }}>{l}</div>
            <div style={{ color: c, fontSize: 12.5, fontWeight: 700, ...mono }}>{v}</div>
          </div>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 9, color: T.T2 }}>
          Calyx addresses are approved automatically · everyone else needs a decision here
        </span>
      </div>

      {state.err && (
        <div style={{ marginBottom: 10, fontSize: 10.5, color: "#991b1b", background: "#fee2e2",
          border: "1px solid #dc2626", borderRadius: 5, padding: "7px 10px" }}>{state.err}</div>
      )}

      {pending.length > 0 && filter === "all" && (
        <div style={{ marginBottom: 10, fontSize: 10.5, color: "#92400e", background: "#fffbeb",
          border: "1px solid " + T.AM, borderRadius: 5, padding: "7px 10px" }}>
          ⚠ {pending.length} account{pending.length > 1 ? "s are" : " is"} waiting for a decision:{" "}
          {pending.map((p) => p.email).join(", ")}
        </div>
      )}

      <div style={{ background: T.S1, border: "1px solid " + T.BD, borderRadius: 6, overflow: "auto" }}>
        <table style={{ ...tbl, fontSize: 11 }}>
          <thead><tr>
            <th style={{ ...th, minWidth: 210 }}>Email</th>
            <th style={{ ...th, minWidth: 140 }}>Name</th>
            <th style={{ ...th, minWidth: 92 }}>Status</th>
            <th style={{ ...th, minWidth: 60 }}>Admin</th>
            <th style={{ ...th, minWidth: 92 }}>Registered</th>
            <th style={{ ...th, minWidth: 150 }}>Decided by</th>
            <th style={{ ...th, minWidth: 200 }}>Actions</th>
          </tr></thead>
          <tbody>
            {shown.map((r) => {
              const s = STATUS[r.status] || STATUS.pending;
              const self = me && String(r.user_id) === String(me.id);
              const busy = busyId === r.user_id;
              return (
                <tr key={r.user_id} style={{ background: r.status === "pending" ? "#fffbeb" : undefined }}>
                  <td style={{ ...td, ...mono, fontSize: 10.5 }}>
                    {r.email}{self && <span style={{ color: T.T2, fontFamily: "inherit" }}> (you)</span>}
                  </td>
                  <td style={{ ...td }}>{r.name || "—"}</td>
                  <td style={{ ...td }}>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 3,
                      color: s.fg, background: s.bg }}>{s.label}</span>
                  </td>
                  <td style={{ ...td, color: r.is_admin ? T.AC : T.T2, fontWeight: r.is_admin ? 700 : 400 }}>
                    {r.is_admin ? "Yes" : "—"}
                  </td>
                  <td style={{ ...td, color: T.T2, fontSize: 10 }}>{fmtDate(r.created_at)}</td>
                  <td style={{ ...td, color: T.T2, fontSize: 9.5 }}>
                    {r.decided_by || "—"}{r.decided_at ? ` · ${fmtDate(r.decided_at)}` : ""}
                  </td>
                  <td style={{ ...td }}>
                    {r.status !== "approved" && btn("Approve", () => act(r.user_id, "approve"), T.GR, busy)}
                    {r.status !== "denied" && btn("Deny", () => act(r.user_id, "deny"), "#b91c1c", busy || self)}
                    {r.is_admin
                      ? btn("Revoke admin", () => act(r.user_id, "revoke_admin"), T.T2, busy || self)
                      : btn("Make admin", () => act(r.user_id, "make_admin"), T.AC, busy)}
                  </td>
                </tr>
              );
            })}
            {!shown.length && !state.loading && (
              <tr><td colSpan={7} style={{ ...td, textAlign: "center", color: T.T2, padding: 20 }}>
                No accounts match this filter.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 7, fontSize: 9, color: T.T2 }}>
        Denying or revoking your own admin rights is blocked — it would lock the door from the inside.
        Every action is re-authorised on the server, so this page cannot grant what the API would refuse.
      </div>
    </div>
  );
}
