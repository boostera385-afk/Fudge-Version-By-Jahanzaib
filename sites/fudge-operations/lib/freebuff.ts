import { createFreebuffNext } from "@freebuff/auth/next";

// One auth instance per server process. The client ID and origin are public
// configuration and are injected by the hosting environment.
export const freebuff = createFreebuffNext({
  clientId: process.env.FREEBUFF_CLIENT_ID || "unconfigured",
  // Hosting supplies the canonical origin. The https fallback only keeps the
  // module loadable during builds that run without environment variables.
  baseUrl: process.env.APP_ORIGIN || "https://localhost",
});
