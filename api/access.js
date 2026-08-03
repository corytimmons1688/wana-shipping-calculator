// api/access.js — the app's own view of who you are and what you may see.
//
//   GET  /api/access            → this caller's status (works while pending)
//   GET  /api/access?users=1    → admin: every account and its status
//   POST /api/access            → admin: {user_id, action}
//                                 action ∈ approve | deny | make_admin | revoke_admin
//
// Deliberately, GET-without-users answers for pending and denied users too —
// the frontend needs to tell "waiting for approval" apart from "signed out",
// and requireAccess() would collapse both into a 403.

import { getUser, getAccess, requireAccess, accessConfigured, sb, isTrusted } from "./_auth.js";

const ACTIONS = {
  approve:      { status: "approved" },
  deny:         { status: "denied" },
  make_admin:   { is_admin: true, status: "approved" },
  revoke_admin: { is_admin: false },
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!accessConfigured())
    return res.status(503).json({ error: "access_control_unconfigured",
      hint: "Set SUPABASE_SERVICE_ROLE_KEY in the Vercel project so the app can read its access table." });

  // ── admin: list every account ──
  if (req.method === "GET" && req.query.users) {
    const ctx = await requireAccess(req, res, { adminOnly: true });
    if (!ctx) return;
    const users = await sb("app_access?select=*&order=created_at.desc");
    return res.status(200).json({ users });
  }

  // ── anyone signed in: my own status ──
  if (req.method === "GET") {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: "unauthenticated" });
    try {
      const access = await getAccess(user);
      return res.status(200).json({
        user: { id: user.id, email: user.email, name: user.name, role: user.role,
          emailVerified: user.emailVerified },
        access,
      });
    } catch (e) {
      console.error("access lookup failed:", e && e.message);
      return res.status(503).json({ error: "access_lookup_failed" });
    }
  }

  // ── admin: change someone's access ──
  if (req.method === "POST") {
    const ctx = await requireAccess(req, res, { adminOnly: true });
    if (!ctx) return;
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    const { user_id: targetId, action } = body || {};
    if (!targetId || !ACTIONS[action])
      return res.status(400).json({ error: "bad_request", hint: `action must be one of ${Object.keys(ACTIONS).join(", ")}` });

    // An admin who revokes or denies themselves locks the door from inside.
    if (String(targetId) === String(ctx.user.id) && (action === "deny" || action === "revoke_admin"))
      return res.status(400).json({ error: "cannot_change_own_admin_access" });

    const patch = { ...ACTIONS[action], decided_at: new Date().toISOString(), decided_by: ctx.user.email };
    const rows = await sb(`app_access?user_id=eq.${encodeURIComponent(targetId)}`, {
      method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch),
    });
    if (!rows || !rows.length) return res.status(404).json({ error: "no_such_user" });
    return res.status(200).json({ ok: true, user: rows[0] });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "method_not_allowed" });
}

export { isTrusted };
