// AuthGate.jsx — the route guard. Decides between the auth screens, the
// waiting room, and the dashboard itself.
//
// Public paths stay reachable while signed out, because verification and reset
// links are opened by people who are not signed in. Everything else requires an
// approved account. If the auth server is unreachable we land on /login rather
// than hanging — a dead dependency should not trap someone on a blank screen.

import { useEffect } from "react";
import App from "../App";
import { useAuth, useRoute, navigate, AUTH_PATHS } from "./useAuth";
import { LoginPage, RegisterPage, VerifyEmailPage, ForgotPasswordPage, ResetPasswordPage, PendingPage } from "./AuthPages";
import { T } from "../utils/theme";
import { AUTH_ENABLED } from "./config";

const PUBLIC = new Set(["/login", "/register", "/verify-email", "/forgot-password", "/reset-password"]);

const Splash = ({ children }) => (
  <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
    background: T.BG || "#f8fafc", color: T.T2, fontSize: 12, padding: 20, textAlign: "center",
    fontFamily: "'DM Sans','Segoe UI',sans-serif" }}>
    {children}
  </div>
);

export default function AuthGate() {
  const { path } = useRoute();
  const auth = useAuth();
  const { status, user, access, refresh, signOut, isAdmin } = auth;

  // Signed-in users have no business on the sign-in screen.
  useEffect(() => {
    if (status === "approved" && (path === "/login" || path === "/register")) navigate("/", { replace: true });
  }, [status, path]);

  // Sign-in switched off — see auth/config.js. Must sit below every hook: an
  // early return above one changes the hook count between routes and React
  // throws "Rendered more hooks than during the previous render".
  if (!AUTH_ENABLED && !PUBLIC.has(path)) return <App auth={null} />;

  // Public pages render regardless of session — the token in the URL is the credential.
  if (PUBLIC.has(path)) {
    if (path === "/register") return <RegisterPage />;
    if (path === "/verify-email") return <VerifyEmailPage />;
    if (path === "/forgot-password") return <ForgotPasswordPage />;
    if (path === "/reset-password") return <ResetPasswordPage />;
    return <LoginPage />;
  }

  if (status === "loading") return <Splash>Checking your session…</Splash>;

  if (status === "error") return (
    <Splash>
      <div style={{ maxWidth: 460 }}>
        <div style={{ fontWeight: 700, color: "#991b1b", marginBottom: 6 }}>Access control is unavailable</div>
        <div style={{ lineHeight: 1.6 }}>{auth.error}</div>
        <button onClick={refresh} style={{ marginTop: 12, padding: "5px 14px", borderRadius: 5,
          border: "1px solid " + T.BD, background: "transparent", color: T.T2, cursor: "pointer",
          fontSize: 11, fontFamily: "inherit" }}>Retry</button>
      </div>
    </Splash>
  );

  if (status === "signedOut") { navigate("/login", { replace: true }); return <Splash>Redirecting to sign in…</Splash>; }

  if (status !== "approved")
    return <PendingPage user={user} access={access} onRefresh={refresh} onSignOut={signOut} />;

  return <App auth={{ user, access, isAdmin, signOut }} />;
}
