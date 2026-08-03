// _auth.js — server-side identity and access.
//
// Two separate questions, deliberately kept apart:
//   WHO ARE YOU?  answered by the shared Better Auth server (identity only).
//   ARE YOU IN?   answered here, by this app, from the app_access table.
//
// The auth server is shared across apps and knows nothing about who should see
// Wana supply data, so authorisation cannot live there. Calyx staff are trusted
// by email domain and admitted on first sign-in; everyone else waits for an
// admin to approve them.

const AUTH_URL = (process.env.BETTER_AUTH_URL || "https://auth.packos.ai/api/auth").replace(/\/+$/, "");
const SUPABASE_URL = "https://fxdyiurjioesdmedmgzu.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Trusted staff domain — these accounts are approved the moment they sign in.
export const TRUSTED_DOMAINS = (process.env.TRUSTED_EMAIL_DOMAINS || "calyxcontainers.com")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

// Bootstrap admins. Without this the first admin could never approve anyone,
// because approving requires already being an admin.
export const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "ctimmons@calyxcontainers.com")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

// Master switch, mirroring src/auth/config.js on the server side.
export const AUTH_REQUIRED = String(process.env.REQUIRE_AUTH || "false").toLowerCase() === "true";

const domainOf = (email) => String(email || "").toLowerCase().split("@")[1] || "";
export const isTrusted = (email) => TRUSTED_DOMAINS.includes(domainOf(email));
export const isBootstrapAdmin = (email) => ADMIN_EMAILS.includes(String(email || "").toLowerCase());

// ── Supabase (service role) ────────────────────────────────────────────────
// The browser holds the public anon key, so app_access is RLS-locked and only
// reachable with the service-role key from here. Missing key = fail closed.
export const accessConfigured = () => !!SERVICE_KEY;
async function sb(path, init = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`, ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 ? null : r.json();
}

/**
 * Validate the caller's bearer token against the auth server.
 * @returns {Promise<{id,email,name,role,emailVerified}|null>}
 */
export async function getUser(req) {
  const auth = req.headers.authorization || "";
  const cookie = req.headers.cookie || "";
  if (!auth && !cookie) return null;
  try {
    const r = await fetch(`${AUTH_URL}/get-session`, {
      headers: {
        ...(auth ? { Authorization: auth } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        Origin: new URL(AUTH_URL).origin,
        "Cache-Control": "no-store",
      },
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    const u = j && j.user;
    if (!u || !u.email) return null;
    return { id: u.id, email: u.email, name: u.name || "", role: u.role || "",
      emailVerified: !!u.emailVerified };
  } catch {
    return null;   // auth server unreachable → treat as signed out, never hang
  }
}

/**
 * The app's own verdict on a validated user. Creates the row on first sight,
 * applying the domain policy, and refreshes last_seen.
 * @returns {Promise<{status,isAdmin,email,name,createdAt}>}
 */
export async function getAccess(user) {
  const email = String(user.email).toLowerCase();
  const rows = await sb(`app_access?user_id=eq.${encodeURIComponent(user.id)}&select=*`);
  let row = rows && rows[0];

  if (!row) {
    // Match on email too — the same person signing in from a rebuilt auth
    // account should keep the approval an admin already granted them.
    const byEmail = await sb(`app_access?email=eq.${encodeURIComponent(email)}&select=*`);
    if (byEmail && byEmail[0]) {
      row = (await sb(`app_access?email=eq.${encodeURIComponent(email)}`, {
        method: "PATCH", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ user_id: user.id, name: user.name || byEmail[0].name }),
      }))[0];
    }
  }

  if (!row) {
    const admin = isBootstrapAdmin(email);
    const approved = admin || isTrusted(email);
    row = (await sb("app_access", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        user_id: user.id, email, name: user.name || "", domain: domainOf(email),
        status: approved ? "approved" : "pending",
        is_admin: admin,
        decided_at: approved ? new Date().toISOString() : null,
        decided_by: approved ? (admin ? "bootstrap" : "auto:trusted-domain") : null,
      }),
    }))[0];
  } else if (isBootstrapAdmin(email) && (!row.is_admin || row.status !== "approved")) {
    // Keep the bootstrap admin reachable even if the row was edited.
    row = (await sb(`app_access?user_id=eq.${encodeURIComponent(user.id)}`, {
      method: "PATCH", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ is_admin: true, status: "approved" }),
    }))[0];
  }

  sb(`app_access?user_id=eq.${encodeURIComponent(user.id)}`, {
    method: "PATCH", body: JSON.stringify({ last_seen: new Date().toISOString() }),
  }).catch(() => {});                     // best-effort, never blocks a request

  return { status: row.status, isAdmin: !!row.is_admin, email: row.email,
    name: row.name, createdAt: row.created_at };
}

/**
 * Guard for every non-public app API. Ends the response and returns null when
 * the caller is not a signed-in, approved user.
 */
export async function requireAccess(req, res, { adminOnly = false } = {}) {
  res.setHeader("Cache-Control", "no-store");
  // Sign-in is switched off while the auth server issues are resolved (see
  // src/auth/config.js). Set REQUIRE_AUTH=true to enforce again. The endpoints
  // are still same-origin only — the wildcard CORS is not coming back.
  if (!AUTH_REQUIRED) return { user: null, access: null, sb, bypassed: true };
  if (!accessConfigured()) {
    res.status(503).json({ error: "access_control_unconfigured",
      hint: "SUPABASE_SERVICE_ROLE_KEY is not set on this deployment." });
    return null;
  }
  const user = await getUser(req);
  if (!user) { res.status(401).json({ error: "unauthenticated" }); return null; }
  let access;
  try { access = await getAccess(user); }
  catch (e) { console.error("access lookup failed:", e && e.message);
    res.status(503).json({ error: "access_lookup_failed" }); return null; }

  if (access.status !== "approved") {
    res.status(403).json({ error: access.status === "denied" ? "access_denied" : "access_pending" });
    return null;
  }
  if (adminOnly && !access.isAdmin) { res.status(403).json({ error: "admin_only" }); return null; }
  return { user, access, sb };
}

export { sb };
