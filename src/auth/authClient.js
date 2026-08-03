// authClient.js — the official Better Auth SDK, pointed at this app's own
// origin so every call goes through /api/auth/* and out to auth.packos.ai
// server-to-server. Never call the auth server directly from the browser: it
// will 403 on Origin, and no amount of client-side work can change that.
//
// Sessions are bearer tokens, not cookies — the auth cookie belongs to
// auth.packos.ai and this app cannot read it. The token arrives on the
// set-auth-token response header; we capture it, persist it, and send it back
// as Authorization on every subsequent request (auth and app APIs alike).

import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";

const AUTH_TOKEN_KEY = "wana-auth-token";

const read = () => { try { return localStorage.getItem(AUTH_TOKEN_KEY); } catch { return null; } };
let authToken = read();

export function getAuthToken() { return authToken; }
export function setAuthToken(t) {
  authToken = t || null;
  try { t ? localStorage.setItem(AUTH_TOKEN_KEY, t) : localStorage.removeItem(AUTH_TOKEN_KEY); } catch { /* private mode */ }
}
export function clearAuthToken() { setAuthToken(null); }

// Vite may serve the app under a base path; the proxy lives beneath it.
const base = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");
export const AUTH_BASE = `${window.location.origin}${base}/api/auth`;

export const authClient = createAuthClient({
  baseURL: AUTH_BASE,
  fetchOptions: {
    credentials: "include",
    auth: { type: "Bearer", token: () => authToken ?? undefined },
    onSuccess(ctx) {
      const token = ctx.response.headers.get("set-auth-token");
      if (token) setAuthToken(token);
    },
  },
  plugins: [
    inferAdditionalFields({
      user: { role: { type: "string", input: false }, userUuid: { type: "string", input: false } },
    }),
  ],
});

/** fetch() for this app's own APIs, carrying the bearer token. */
export async function apiFetch(path, init = {}) {
  const headers = { ...(init.headers || {}) };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (init.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  return fetch(`${base}${path}`, { ...init, headers, credentials: "include" });
}

/**
 * Better Auth surfaces failures as {error:{status,message,code}} rather than
 * throwing, and the login screen has to tell 401/403/429 apart to respond
 * correctly. This normalises whatever shape comes back.
 */
export function authError(err) {
  if (!err) return null;
  const status = err.status ?? err.statusCode ?? err?.error?.status ?? 0;
  const message = err.message || err.statusText || err?.error?.message || "Something went wrong.";
  const code = err.code || err?.error?.code || "";
  // Lockout: prefer a server-supplied retryAfter, else parse "N minutes" out of
  // the message, else fall back to five minutes.
  let retryAfter = Number(err.retryAfter ?? err?.error?.retryAfter ?? 0);
  if (!retryAfter && status === 429) {
    const m = /(\d+)\s*(second|minute)/i.exec(message);
    retryAfter = m ? Number(m[1]) * (/minute/i.test(m[2]) ? 60 : 1) : 300;
  }
  return { status, message, code, retryAfter };
}
