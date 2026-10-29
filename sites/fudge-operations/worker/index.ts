import handler from "vinext/server/fetch-handler";
import { createFreebuffAuth } from "@freebuff/auth";
import type { FreebuffAuth, FreebuffUser } from "@freebuff/auth";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";

// One instance per isolate caches Freebuff discovery and signing keys.
let freebuffAuth: FreebuffAuth | undefined;

const IDENTITY_HEADERS = [
  "oai-authenticated-user-id",
  "oai-authenticated-user-email",
  "oai-authenticated-user-full-name",
  "oai-authenticated-user-full-name-encoding",
];

function authFor(env: Cloudflare.Env): FreebuffAuth | null {
  if (!env.FREEBUFF_CLIENT_ID || !env.APP_ORIGIN) return null;
  freebuffAuth ??= createFreebuffAuth({
    clientId: env.FREEBUFF_CLIENT_ID,
    issuer: env.FREEBUFF_ISSUER,
    baseUrl: env.APP_ORIGIN,
  });
  return freebuffAuth;
}

function isAllowed(env: Cloudflare.Env, user: FreebuffUser): boolean {
  const list = (value: string | undefined) =>
    String(value || "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  const emails = list(env.FREEBUFF_ALLOWED_EMAILS);
  const subs = list(env.FREEBUFF_ALLOWED_SUBS);
  if (!emails.length && !subs.length) return true;
  if (subs.includes(user.sub.toLowerCase())) return true;
  return Boolean(user.email) && emails.includes(String(user.email).toLowerCase());
}

// Replace any client-supplied identity headers with the verified Freebuff user.
function withIdentity(request: Request, user: FreebuffUser | null): Request {
  const headers = new Headers(request.headers);
  for (const name of IDENTITY_HEADERS) headers.delete(name);
  if (user) {
    headers.set("oai-authenticated-user-id", user.sub);
    headers.set(
      "oai-authenticated-user-email",
      user.email || `${user.sub}@freebuff.invalid`,
    );
    if (user.name) {
      headers.set(
        "oai-authenticated-user-full-name",
        encodeURIComponent(user.name),
      );
      headers.set(
        "oai-authenticated-user-full-name-encoding",
        "percent-encoded-utf-8",
      );
    }
  }
  return new Request(request, { headers });
}

const worker = {
  fetch(
    request: Request,
    env: Cloudflare.Env,
    ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>,
  ): Response | Promise<Response> {
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS as ConnectorBinding;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }

    const run = (next: Request) =>
      runWithConnectorBinding(binding, () => handler.fetch(next, env, ctx));

    const auth = authFor(env);
    if (!auth) return run(request);

    const signedIn = auth;
    return signedIn.wrap(async (wrapped: Request) => {
      const user = await signedIn.getUser(wrapped);
      if (user && !isAllowed(env, user)) {
        return new Response("This Fudge dashboard is not enabled for this account.", {
          status: 403,
          headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" },
        });
      }
      if (!user) {
        const url = new URL(wrapped.url);
        const isApi = url.pathname.startsWith("/api/");
        if (isApi) return run(withIdentity(wrapped, null));
        return new Response(null, {
          status: 302,
          headers: {
            location: `/auth/freebuff/signin?returnTo=${encodeURIComponent(url.pathname + url.search)}`,
            "cache-control": "private, no-store",
          },
        });
      }
      return run(withIdentity(wrapped, user));
    })(request);
  },
};

export default worker;
