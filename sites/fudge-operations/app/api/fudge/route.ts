import { isSameOriginRequest } from "@freebuff/auth";
import { NextRequest, NextResponse } from "next/server";
import { isAllowedUser } from "../../../lib/access";
import { callFudge } from "../../../lib/fudge-api";
import { freebuff } from "../../../lib/freebuff";

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
  const user = await freebuff.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401, headers: privateHeaders });
  }
  if (!isAllowedUser(user)) {
    return NextResponse.json({ ok: false, error: "This Fudge dashboard is not enabled for this account." }, { status: 403, headers: privateHeaders });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    const origin = process.env.APP_ORIGIN || request.nextUrl.origin;
    if (!isSameOriginRequest(request, origin)) {
      return NextResponse.json({ ok: false, error: "This request came from another site." }, { status: 403, headers: privateHeaders });
    }
  }
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
