// config.js — the sign-in switch.
//
// Auth is OFF while two things are resolved with the auth.packos.ai team:
//   1. this app's origin is not on BETTER_AUTH_TRUSTED_ORIGINS, so every
//      redirect flow (verify email, password reset) lands off-site;
//   2. SES sandbox mode may block verification email to external addresses.
//
// Nothing has been removed — the proxy, client, pages, guard, admin page and
// API middleware are all intact and were verified working end to end. Flip
// this to true (or set VITE_REQUIRE_AUTH=true in Vercel, plus REQUIRE_AUTH=true
// for the API) to put the dashboard back behind sign-in.
//
// The auth pages stay reachable at /login, /register and friends even while
// this is off, so the flows can be tested without flipping the switch for
// everyone.
const DEFAULT_ENABLED = false;

const flag = String(import.meta.env.VITE_REQUIRE_AUTH ?? "").toLowerCase();
export const AUTH_ENABLED = flag === "true" ? true : flag === "false" ? false : DEFAULT_ENABLED;
