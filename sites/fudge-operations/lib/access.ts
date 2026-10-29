import type { FreebuffUser } from "@freebuff/auth";

const list = (value: string | undefined) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

/**
 * Optional allowlist. When neither variable is set every signed-in Freebuff
 * account may use the dashboard; setting either one restricts access.
 */
export function isAllowedUser(user: FreebuffUser): boolean {
  const emails = list(process.env.FUDGE_ALLOWED_EMAILS);
  const subs = list(process.env.FUDGE_ALLOWED_SUBS);
  if (!emails.length && !subs.length) return true;
  if (subs.includes(user.sub.toLowerCase())) return true;
  return Boolean(user.email) && emails.includes(String(user.email).toLowerCase());
}
