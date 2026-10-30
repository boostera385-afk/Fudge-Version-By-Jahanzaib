declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    CONNECTORS?: unknown;
    /** Shared sign-in password for the dashboard; at least 12 characters. */
    FUDGE_DASHBOARD_PASSWORD?: string;
    /** HMAC key for the session cookie; at least 32 characters. */
    FUDGE_SESSION_SECRET?: string;
  }
}
