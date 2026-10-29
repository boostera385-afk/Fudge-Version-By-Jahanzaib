declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    CONNECTORS?: unknown;
    FREEBUFF_CLIENT_ID?: string;
    FREEBUFF_ISSUER?: string;
    APP_ORIGIN?: string;
    FREEBUFF_ALLOWED_EMAILS?: string;
    FREEBUFF_ALLOWED_SUBS?: string;
  }
}
