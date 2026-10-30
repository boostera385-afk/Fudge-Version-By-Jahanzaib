// Gate for the hosted dashboard. The Worker entrypoint runs this before Vinext
// sees a request, so every page and every /api route is covered by one check.
// It fails closed: without both secrets configured, nothing is served.

const COOKIE_NAME = "fudge_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const SIGNIN_PATH = "/signin";
const SIGNOUT_PATH = "/signout";
// Online guessing is the only attack this password faces, and a Worker has no
// durable store to count attempts in. A fixed delay caps the rate instead.
const FAILED_SIGNIN_DELAY_MS = 400;

export type AuthConfig = { password: string; secret: string };

type AuthEnv = {
  FUDGE_DASHBOARD_PASSWORD?: string;
  FUDGE_SESSION_SECRET?: string;
};

export function readAuthConfig(env: AuthEnv): AuthConfig | null {
  const password = (env.FUDGE_DASHBOARD_PASSWORD || "").trim();
  const secret = (env.FUDGE_SESSION_SECRET || "").trim();
  if (password.length < 12 || secret.length < 32) return null;
  return { password, secret };
}

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message))));
}

function equals(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function createSession(config: AuthConfig): Promise<string> {
  const expiresAt = String(Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS);
  return `${expiresAt}.${await sign(config.secret, expiresAt)}`;
}

async function verifySession(config: AuthConfig, token: string): Promise<boolean> {
  const split = token.lastIndexOf(".");
  if (split <= 0) return false;
  const expiresAt = token.slice(0, split);
  if (!/^\d+$/.test(expiresAt) || Number(expiresAt) * 1000 <= Date.now()) return false;
  return equals(token.slice(split + 1), await sign(config.secret, expiresAt));
}

function readCookie(header: string | null, name: string): string {
  if (!header) return "";
  for (const part of header.split(";")) {
    const split = part.indexOf("=");
    if (split < 0) continue;
    if (part.slice(0, split).trim() === name) return part.slice(split + 1).trim();
  }
  return "";
}

function cookieHeader(value: string, maxAge: number, secure: boolean): string {
  const attributes = [`${COOKIE_NAME}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`];
  // Chrome keeps Secure cookies off plain-http origins, which loopback dev uses.
  if (secure) attributes.splice(3, 0, "Secure");
  return attributes.join("; ");
}

// Only same-origin paths, so a crafted link cannot bounce a signed-in operator
// off to another site.
function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(title: string, body: string, status: number): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8" />` +
      `<meta name="viewport" content="width=device-width, initial-scale=1" />` +
      `<meta name="robots" content="noindex, nofollow" />` +
      `<title>${escapeHtml(title)}</title><link rel="icon" href="/favicon.svg" /><style>
  :root { color-scheme: light dark; --bg: #f5f6f8; --card: #ffffff; --ink: #1f2328; --muted: #5f6672; --line: #d8dde3; --brand: #6c4bc2; --danger: #b3261e; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #16181c; --card: #1f2227; --ink: #e8eaed; --muted: #9aa0a6; --line: #343840; --danger: #f2b8b5; }
  }
  * { box-sizing: border-box; }
  body { display: grid; place-items: center; min-height: 100dvh; margin: 0; padding: 24px; background: var(--bg); color: var(--ink);
         font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .card { width: 100%; max-width: 360px; padding: 28px; border: 1px solid var(--line); border-radius: 14px; background: var(--card);
          box-shadow: 0 1px 3px rgb(0 0 0 / 8%); }
  .mark { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 10px; background: var(--brand); color: #fff; font-weight: 700; }
  h1 { margin: 16px 0 4px; font-size: 18px; }
  p { margin: 0 0 20px; color: var(--muted); font-size: 13px; }
  label { display: block; margin-bottom: 6px; font-size: 12px; font-weight: 600; }
  input { width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: inherit; font: inherit; }
  input:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px; }
  button { width: 100%; margin-top: 14px; padding: 10px 12px; border: 0; border-radius: 8px; background: var(--brand); color: #fff;
           font: inherit; font-weight: 600; cursor: pointer; }
  button:hover { filter: brightness(1.08); }
  .error { margin: 0 0 16px; padding: 9px 11px; border-radius: 8px; background: color-mix(in srgb, var(--danger) 12%, transparent);
           color: var(--danger); font-size: 12px; }
</style></head><body><div class="card">${body}</div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } },
  );
}

function signinPage(returnTo: string, error: string, status: number): Response {
  return page(
    "Sign in · Fudge Operations",
    `<div class="mark">F</div><h1>Fudge Operations</h1><p>This dashboard is private.</p>` +
      (error ? `<p class="error">${escapeHtml(error)}</p>` : "") +
      `<form method="post" action="${SIGNIN_PATH}">` +
      `<input type="hidden" name="return_to" value="${escapeHtml(returnTo)}" />` +
      `<label for="password">Password</label>` +
      `<input id="password" name="password" type="password" autocomplete="current-password" autofocus required />` +
      `<button type="submit">Sign in</button></form>`,
    status,
  );
}

function unconfiguredPage(): Response {
  return page(
    "Unavailable · Fudge Operations",
    `<div class="mark">F</div><h1>Dashboard locked</h1>` +
      `<p>FUDGE_DASHBOARD_PASSWORD and FUDGE_SESSION_SECRET are not set on this Worker, so the dashboard will not serve data.</p>`,
    503,
  );
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });

const wantsHtml = (request: Request, path: string) =>
  !path.startsWith("/api/") && (request.headers.get("Accept") || "").includes("text/html");

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function decide(request: Request, env: AuthEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const secure = url.protocol === "https:";
  const config = readAuthConfig(env);

  if (!config) {
    if (path === SIGNIN_PATH || wantsHtml(request, path)) return unconfiguredPage();
    return json({ ok: false, error: "The dashboard is not configured for sign-in." }, 503);
  }

  const signedIn = await verifySession(config, readCookie(request.headers.get("Cookie"), COOKIE_NAME));

  if (path === SIGNOUT_PATH) {
    return new Response(null, {
      status: 303,
      headers: { Location: SIGNIN_PATH, "Set-Cookie": cookieHeader("", 0, secure), "Cache-Control": "private, no-store" },
    });
  }

  if (path === SIGNIN_PATH) {
    const returnTo = safeReturnTo(url.searchParams.get("return_to"));
    if (request.method === "GET") {
      if (signedIn) return Response.redirect(new URL(returnTo, url).toString(), 303);
      return signinPage(returnTo, "", 200);
    }
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });

    const form = await request.formData().catch(() => null);
    const submitted = String(form?.get("password") ?? "");
    const target = safeReturnTo(String(form?.get("return_to") ?? returnTo));
    if (!equals(submitted, config.password)) {
      await delay(FAILED_SIGNIN_DELAY_MS);
      return signinPage(target, "That password is not correct.", 401);
    }
    return new Response(null, {
      status: 303,
      headers: {
        Location: target,
        "Set-Cookie": cookieHeader(await createSession(config), SESSION_TTL_SECONDS, secure),
        "Cache-Control": "private, no-store",
      },
    });
  }

  if (signedIn) return null;

  if (wantsHtml(request, path)) {
    const target = new URL(SIGNIN_PATH, url);
    target.searchParams.set("return_to", path + url.search);
    return Response.redirect(target.toString(), 303);
  }
  return json({ ok: false, error: "Sign in to use the Fudge dashboard." }, 401);
}

/**
 * Returns a Response when the request must not reach the application —
 * the sign-in and sign-out routes, an unauthenticated caller, or a Worker
 * that has no credentials configured. Returns null to let the request through.
 */
export async function guardRequest(request: Request, env: AuthEnv): Promise<Response | null> {
  const response = await decide(request, env);
  // A turned-away POST still has its body in flight. workerd faults on the next
  // request if nothing ever reads it, so drain whatever the gate did not consume.
  // Only when the gate answers: a passed-through request still needs its body.
  if (response && request.body && !request.bodyUsed) {
    await request.arrayBuffer().catch(() => undefined);
  }
  return response;
}
