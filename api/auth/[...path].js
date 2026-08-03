// api/auth/[...path].js — reverse proxy to the shared Better Auth server.
//
// Why this exists: a browser cannot call auth.packos.ai directly. Better Auth
// rejects any Origin not on its trusted list (403 INVALID_ORIGIN) and rejects a
// missing Origin too (403 MISSING_OR_NULL_ORIGIN), and a browser can neither
// omit nor forge that header. So the browser talks to this app's own origin and
// this function relays server-to-server, rewriting Origin/Referer to the auth
// server's own origin — which it always trusts.
//
// Everything else passes through untouched: method, path, body, content-type,
// Authorization, Cookie, the set-auth-token response header, and the real
// status code. The client SDK needs genuine 401/403/429s to drive its UI.

export const config = { api: { bodyParser: false } };

const UPSTREAM = (process.env.BETTER_AUTH_URL || "https://auth.packos.ai/api/auth").replace(/\/+$/, "");
const ORIGIN = new URL(UPSTREAM).origin;

// Hop-by-hop headers must not be relayed, and host must be the upstream's.
const STRIP = new Set(["host", "connection", "keep-alive", "transfer-encoding",
  "upgrade", "proxy-authorization", "proxy-authenticate", "te", "trailer",
  "content-length", "accept-encoding"]);

function rawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  try {
    const segs = Array.isArray(req.query.path) ? req.query.path : [req.query.path].filter(Boolean);
    const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    const target = `${UPSTREAM}/${segs.join("/")}${qs}`;

    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (STRIP.has(k.toLowerCase()) || v == null) continue;
      headers[k] = Array.isArray(v) ? v.join(", ") : v;
    }
    // The whole point of the proxy.
    headers.origin = ORIGIN;
    headers.referer = ORIGIN + "/";

    const method = req.method || "GET";
    const body = method === "GET" || method === "HEAD" ? undefined : await rawBody(req);

    const upstream = await fetch(target, { method, headers, body, redirect: "manual" });

    // Relay every response header, including set-auth-token and any Set-Cookie.
    upstream.headers.forEach((value, key) => {
      const k = key.toLowerCase();
      if (k === "content-encoding" || k === "content-length" || k === "transfer-encoding") return;
      if (k === "set-cookie") return;                       // handled below
      res.setHeader(key, value);
    });
    const cookies = typeof upstream.headers.getSetCookie === "function"
      ? upstream.headers.getSetCookie()
      : (upstream.headers.get("set-cookie") ? [upstream.headers.get("set-cookie")] : []);
    if (cookies.length) res.setHeader("Set-Cookie", cookies);

    // A session answer must never be cached — stale auth is a security bug.
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");

    res.status(upstream.status);
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.end(buf);
  } catch (e) {
    // Never leak tokens or upstream internals into the response.
    console.error("auth proxy error:", e && e.message);
    res.status(502).json({ error: "auth_proxy_unavailable" });
  }
}
