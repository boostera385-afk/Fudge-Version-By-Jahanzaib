import { NextRequest, NextResponse } from "next/server";
import { callFudge } from "../../../lib/fudge-api";

export const dynamic = "force-dynamic";

const ALLOWED = new Set([
  "dashboardSnapshot",
  "read",
  "batchWrite",
  "appendRows",
  "deleteRow",
  "saveRequirement",
  "deleteRequirement",
  "setAutomationState",
]);

const privateHeaders = { "Cache-Control": "private, no-store" };

async function handle(request: NextRequest) {
  const body: Record<string, unknown> = request.method === "GET"
    ? Object.fromEntries(request.nextUrl.searchParams.entries())
    : ((await request.json().catch(() => ({}))) as Record<string, unknown>);
  const action = String(body.action || "");
  if (!ALLOWED.has(action)) {
    return NextResponse.json({ ok: false, error: "Unsupported dashboard action." }, { status: 400, headers: privateHeaders });
  }
  try {
    return NextResponse.json(await callFudge(action, body), { headers: privateHeaders });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Fudge request failed." }, { status: 502, headers: privateHeaders });
  }
}

export async function GET(request: NextRequest) { return handle(request); }
export async function POST(request: NextRequest) { return handle(request); }
