// AuthPages.jsx — login, register, verify email, forgot/reset password, and the
// waiting-room screen for accounts this app has not admitted yet.
// Every call goes through the Better Auth SDK; nothing here hand-rolls a fetch
// to an auth endpoint, and no password is ever stored or logged.

import { useState, useEffect, useRef } from "react";
import { authClient, authError, clearAuthToken } from "./authClient";
import { navigate, useRoute } from "./useAuth";
import { T } from "../utils/theme";

const MIN_PASSWORD = 8;

// ── shared chrome ──────────────────────────────────────────────────────────
function Shell({ title, sub, children, footer }) {
  return (
    <div style={{ minHeight: "100vh", background: T.BG || "#f8fafc", display: "flex",
      alignItems: "center", justifyContent: "center", padding: 20,
      fontFamily: "'DM Sans','Segoe UI',sans-serif", color: T.TX }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.4 }}>
            <span style={{ color: T.GR }}>Wana</span> Production &amp; Shipping
          </div>
          <div style={{ fontSize: 10.5, color: T.T2, marginTop: 2 }}>Calyx Containers supply dashboard</div>
        </div>
        <div style={{ background: T.S1, border: "1px solid " + T.BD, borderRadius: 10, padding: "22px 22px 20px" }}>
          <h1 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 3px" }}>{title}</h1>
          {sub && <p style={{ fontSize: 11, color: T.T2, margin: "0 0 15px", lineHeight: 1.5 }}>{sub}</p>}
          {children}
        </div>
        {footer && <div style={{ textAlign: "center", marginTop: 13, fontSize: 11, color: T.T2 }}>{footer}</div>}
      </div>
    </div>
  );
}

const Field = ({ label, ...p }) => (
  <label style={{ display: "block", marginBottom: 11 }}>
    <span style={{ display: "block", fontSize: 10, fontWeight: 700, color: T.T2, marginBottom: 4,
      textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</span>
    <input {...p} style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: 12.5,
      border: "1px solid " + T.BD, borderRadius: 6, background: T.S2, color: T.TX, fontFamily: "inherit" }} />
  </label>
);

const Button = ({ children, disabled, ...p }) => (
  <button {...p} disabled={disabled} style={{ width: "100%", padding: "9px 12px", fontSize: 12.5, fontWeight: 700,
    borderRadius: 6, border: "1px solid " + (disabled ? T.BD : T.AC), cursor: disabled ? "not-allowed" : "pointer",
    background: disabled ? T.S2 : T.AC, color: disabled ? T.T2 : "#fff", fontFamily: "inherit", marginTop: 3 }}>
    {children}
  </button>
);

const Link = ({ to, children }) => (
  <a href={to} onClick={(e) => { e.preventDefault(); navigate(to); }}
    style={{ color: T.AC, textDecoration: "none", fontWeight: 600 }}>{children}</a>
);

const Alert = ({ kind = "error", children, action }) => {
  const c = kind === "error" ? { fg: "#991b1b", bg: "#fee2e2", bd: "#dc2626" }
    : kind === "warn" ? { fg: "#92400e", bg: "#fffbeb", bd: T.AM }
    : { fg: "#166534", bg: "#f0fdf4", bd: T.GR };
  return (
    <div style={{ fontSize: 11, lineHeight: 1.5, color: c.fg, background: c.bg, border: "1px solid " + c.bd,
      borderRadius: 6, padding: "8px 10px", marginBottom: 12 }}>
      {children}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
};

const inlineBtn = (fg) => ({ background: "transparent", border: "1px solid " + fg, color: fg,
  borderRadius: 4, padding: "2px 8px", fontSize: 10, cursor: "pointer", fontFamily: "inherit", fontWeight: 700 });

// ── /login ─────────────────────────────────────────────────────────────────
export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [unverified, setUnverified] = useState(false);
  const [resent, setResent] = useState(false);
  const [lockUntil, setLockUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

  // Countdown for a 429 lockout — the submit button stays disabled until it runs out.
  useEffect(() => {
    if (!lockUntil) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [lockUntil]);
  const lockLeft = Math.max(0, Math.ceil((lockUntil - now) / 1000));
  const locked = lockLeft > 0;

  const submit = async (e) => {
    e.preventDefault();
    if (locked || busy) return;
    setBusy(true); setErr(null); setUnverified(false); setResent(false);
    const { error } = await authClient.signIn.email({ email: email.trim(), password });
    setBusy(false);
    if (!error) { navigate("/", { replace: true }); return; }

    const a = authError(error);
    if (a.status === 429) {
      setLockUntil(Date.now() + a.retryAfter * 1000); setNow(Date.now());
      setErr("Too many failed attempts. This account is temporarily locked.");
    } else if (a.status === 403) {
      setUnverified(true);
    } else if (a.status === 401) {
      // Never reveal which half was wrong.
      setErr("Invalid email or password.");
    } else {
      setErr(a.message);
    }
  };

  const resend = async () => {
    const { error } = await authClient.sendVerificationEmail({
      email: email.trim(), callbackURL: `${window.location.origin}/verify-email` });
    setResent(!error);
    if (error) setErr(authError(error).message);
  };

  return (
    <Shell title="Sign in" sub="Use your Packos account to reach the Wana supply dashboard."
      footer={<>No account? <Link to="/register">Create one</Link></>}>
      {err && <Alert>{err}{locked && <> Try again in <strong>{Math.floor(lockLeft / 60)}:{String(lockLeft % 60).padStart(2, "0")}</strong>.</>}</Alert>}
      {unverified && (
        <Alert kind="warn"
          action={resent
            ? <span style={{ fontWeight: 700 }}>Verification email sent.</span>
            : <button type="button" onClick={resend} style={inlineBtn("#92400e")}>Resend verification email</button>}>
          Your email address is not verified yet. Check your inbox for the verification link.
        </Alert>
      )}
      <form onSubmit={submit}>
        <Field label="Email" type="email" value={email} autoComplete="username" required
          onChange={(e) => setEmail(e.target.value)} />
        <Field label="Password" type="password" value={password} autoComplete="current-password" required
          onChange={(e) => setPassword(e.target.value)} />
        <div style={{ textAlign: "right", fontSize: 10.5, marginBottom: 10 }}>
          <Link to="/forgot-password">Forgot password?</Link>
        </div>
        <Button type="submit" disabled={busy || locked}>
          {locked ? `Locked — ${Math.floor(lockLeft / 60)}:${String(lockLeft % 60).padStart(2, "0")}` : busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </Shell>
  );
}

// ── /register ──────────────────────────────────────────────────────────────
export function RegisterPage() {
  const [f, setF] = useState({ name: "", email: "", password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(false);
  const on = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    if (f.password.length < MIN_PASSWORD) return setErr(`Password must be at least ${MIN_PASSWORD} characters.`);
    if (f.password !== f.confirm) return setErr("Passwords do not match.");
    setBusy(true);
    const { error } = await authClient.signUp.email({
      name: f.name.trim(), email: f.email.trim(), password: f.password,
      callbackURL: `${window.location.origin}/verify-email`,
    });
    setBusy(false);
    if (error) return setErr(authError(error).message);   // server wording, verbatim
    setDone(true);
  };

  if (done) return (
    <Shell title="Check your email"
      sub={`We sent a verification link to ${f.email}. Open it to confirm your address.`}
      footer={<Link to="/login">Back to sign in</Link>}>
      <Alert kind="ok">
        Accounts outside Calyx Containers also need an administrator to approve access
        before the dashboard opens. You will be told as soon as that happens.
      </Alert>
    </Shell>
  );

  return (
    <Shell title="Create an account" sub="Calyx staff are approved automatically. Everyone else is reviewed by an administrator."
      footer={<>Already registered? <Link to="/login">Sign in</Link></>}>
      {err && <Alert>{err}</Alert>}
      <form onSubmit={submit}>
        <Field label="Full name" value={f.name} required autoComplete="name" onChange={on("name")} />
        <Field label="Email" type="email" value={f.email} required autoComplete="username" onChange={on("email")} />
        <Field label="Password" type="password" value={f.password} required autoComplete="new-password"
          minLength={MIN_PASSWORD} onChange={on("password")} />
        <Field label="Confirm password" type="password" value={f.confirm} required autoComplete="new-password"
          onChange={on("confirm")} />
        <div style={{ fontSize: 10, color: T.T2, marginBottom: 8 }}>At least {MIN_PASSWORD} characters.</div>
        <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create account"}</Button>
      </form>
    </Shell>
  );
}

// ── /verify-email ──────────────────────────────────────────────────────────
export function VerifyEmailPage() {
  const { query } = useRoute();
  const token = query.get("token");
  const [state, setState] = useState(token ? "working" : "missing");
  const [err, setErr] = useState(null);
  const [email, setEmail] = useState("");
  const [resent, setResent] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;      // tokens are single-use; never fire twice
    (async () => {
      const { error } = await authClient.verifyEmail({ query: { token } });
      if (error) { setErr(authError(error).message); setState("failed"); }
      else setState("ok");
    })();
  }, [token]);

  const resend = async () => {
    const { error } = await authClient.sendVerificationEmail({
      email: email.trim(), callbackURL: `${window.location.origin}/verify-email` });
    if (error) setErr(authError(error).message); else { setResent(true); setErr(null); }
  };

  if (state === "ok") return (
    <Shell title="Email verified" sub="Your address is confirmed.">
      <Alert kind="ok">You can sign in now.</Alert>
      <Button onClick={() => navigate("/login")}>Go to sign in</Button>
    </Shell>
  );

  if (state === "working") return <Shell title="Verifying…" sub="One moment while we confirm your email address." />;

  return (
    <Shell title={state === "missing" ? "Verification link needed" : "Verification failed"}
      sub={state === "missing"
        ? "Open the link from your email, or request a new one below."
        : "That link is invalid or has expired. Request a fresh one."}
      footer={<Link to="/login">Back to sign in</Link>}>
      {err && <Alert>{err}</Alert>}
      {resent
        ? <Alert kind="ok">A new verification email is on its way.</Alert>
        : <>
            <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Button onClick={resend} disabled={!email.trim()}>Resend verification email</Button>
          </>}
    </Shell>
  );
}

// ── /forgot-password ───────────────────────────────────────────────────────
export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    // Ignore the outcome on purpose: a different answer for a known address
    // would let anyone enumerate who has an account.
    await authClient.requestPasswordReset({
      email: email.trim(), redirectTo: `${window.location.origin}/reset-password` }).catch(() => {});
    setBusy(false); setSent(true);
  };

  if (sent) return (
    <Shell title="Check your email"
      sub="If that account exists, we have sent a password reset link."
      footer={<Link to="/login">Back to sign in</Link>} />
  );

  return (
    <Shell title="Reset your password" sub="Enter your email and we will send a reset link."
      footer={<Link to="/login">Back to sign in</Link>}>
      <form onSubmit={submit}>
        <Field label="Email" type="email" value={email} required autoComplete="username"
          onChange={(e) => setEmail(e.target.value)} />
        <Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</Button>
      </form>
    </Shell>
  );
}

// ── /reset-password ────────────────────────────────────────────────────────
export function ResetPasswordPage() {
  const { query } = useRoute();
  const token = query.get("token");
  const [f, setF] = useState({ password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const on = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    if (f.password.length < MIN_PASSWORD) return setErr(`Password must be at least ${MIN_PASSWORD} characters.`);
    if (f.password !== f.confirm) return setErr("Passwords do not match.");
    setBusy(true);
    const { error } = await authClient.resetPassword({ newPassword: f.password, token });
    setBusy(false);
    if (error) return setErr(authError(error).message);
    clearAuthToken();          // any old session is stale after a password change
    navigate("/login", { replace: true });
  };

  if (!token) return (
    <Shell title="Reset link needed" sub="This page opens from the link in your reset email."
      footer={<Link to="/forgot-password">Request a new link</Link>} />
  );

  return (
    <Shell title="Choose a new password" sub="Pick something you have not used here before."
      footer={<Link to="/login">Back to sign in</Link>}>
      {err && <Alert>{err}</Alert>}
      <form onSubmit={submit}>
        <Field label="New password" type="password" value={f.password} required autoComplete="new-password"
          minLength={MIN_PASSWORD} onChange={on("password")} />
        <Field label="Confirm new password" type="password" value={f.confirm} required autoComplete="new-password"
          onChange={on("confirm")} />
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Set new password"}</Button>
      </form>
    </Shell>
  );
}

// ── /pending — signed in, not yet admitted ─────────────────────────────────
export function PendingPage({ user, access, onRefresh, onSignOut }) {
  const denied = access?.status === "denied";
  return (
    <Shell title={denied ? "Access declined" : "Waiting for approval"}
      sub={denied
        ? "An administrator has declined access for this account."
        : "Your account is registered. An administrator needs to approve it before the dashboard opens."}
      footer={<button onClick={onSignOut} style={{ ...inlineBtn(T.T2), border: "none" }}>Sign out</button>}>
      <Alert kind={denied ? "error" : "warn"}>
        Signed in as <strong>{user?.email}</strong>.
        {!denied && <> Approvals are handled by the Calyx supply team — reach out to them if this is urgent.</>}
      </Alert>
      {!denied && <Button onClick={onRefresh}>Check again</Button>}
    </Shell>
  );
}
