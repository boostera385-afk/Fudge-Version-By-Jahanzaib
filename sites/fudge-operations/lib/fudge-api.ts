const FUNCTION_URL = process.env.FUDGE_SUPABASE_FUNCTION_URL;
const PUBLISHABLE_KEY = process.env.FUDGE_SUPABASE_PUBLISHABLE_KEY;
const WORKSPACE_TOKEN = process.env.FUDGE_WORKSPACE_TOKEN;

export type FudgeResult = { ok?: boolean; error?: string } & Record<string, unknown>;

export async function callFudge(action: string, payload: Record<string, unknown> = {}): Promise<FudgeResult> {
  if (!FUNCTION_URL || !PUBLISHABLE_KEY || !WORKSPACE_TOKEN) {
    throw new Error("The hosted Fudge connection is not configured.");
  }

  const response = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: PUBLISHABLE_KEY,
      "x-fudge-token": WORKSPACE_TOKEN,
    },
    body: JSON.stringify({ action, ...payload }),
    cache: "no-store",
  });
  const result = (await response.json().catch(() => null)) as FudgeResult | null;
  if (!response.ok || !result?.ok) {
    throw new Error(result?.error || `Fudge backend returned ${response.status}.`);
  }
  return result;
}
