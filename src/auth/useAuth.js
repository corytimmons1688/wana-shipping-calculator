// useAuth.js — session + app access in one hook, plus a tiny path router.
//
// This app has no router dependency and does not need one: five auth paths and
// everything else is the dashboard. Email links land on real paths, and
// vercel.json already rewrites non-/api paths to index.html, so plain
// history.pushState is enough.

import { useState, useEffect, useCallback } from "react";
import { authClient, apiFetch, clearAuthToken, getAuthToken } from "./authClient";

export const AUTH_PATHS = ["/login", "/register", "/verify-email", "/forgot-password", "/reset-password", "/pending"];

export function navigate(to, { replace = false } = {}) {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");
  const url = `${base}${to}`;
  if (replace) window.history.replaceState({}, "", url);
  else window.history.pushState({}, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useRoute() {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");
  const get = () => {
    const p = window.location.pathname.slice(base.length) || "/";
    return { path: p.replace(/\/+$/, "") || "/", query: new URLSearchParams(window.location.search) };
  };
  const [route, setRoute] = useState(get);
  useEffect(() => {
    const on = () => setRoute(get());
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []); // eslint-disable-line
  return route;
}

/**
 * Resolves to one of:
 *   loading            — still checking
 *   signedOut          — no valid session
 *   pending / denied   — signed in, but this app has not admitted them
 *   approved           — full access; `isAdmin` says whether the admin page shows
 *
 * If the auth server or access API is unreachable we resolve to signedOut
 * rather than hanging, so navigation never blocks on a dead dependency.
 */
export function useAuth() {
  const [state, setState] = useState({ loading: true, user: null, access: null, error: null });

  const refresh = useCallback(async () => {
    if (!getAuthToken()) { setState({ loading: false, user: null, access: null, error: null }); return; }
    try {
      const r = await apiFetch("/api/access");
      if (r.status === 401) { setState({ loading: false, user: null, access: null, error: null }); return; }
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setState({ loading: false, user: null, access: null, error: j.hint || j.error || `HTTP ${r.status}` });
        return;
      }
      const j = await r.json();
      setState({ loading: false, user: j.user, access: j.access, error: null });
    } catch {
      setState({ loading: false, user: null, access: null, error: null });   // degrade to signed out
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const signOut = useCallback(async () => {
    try { await authClient.signOut(); } catch { /* token may already be dead */ }
    clearAuthToken();
    setState({ loading: false, user: null, access: null, error: null });
    navigate("/login", { replace: true });
  }, []);

  const status = state.loading ? "loading"
    : state.error ? "error"
    : !state.user ? "signedOut"
    : state.access?.status === "approved" ? "approved"
    : state.access?.status === "denied" ? "denied"
    : "pending";

  return { ...state, status, isAdmin: !!state.access?.isAdmin, refresh, signOut };
}
