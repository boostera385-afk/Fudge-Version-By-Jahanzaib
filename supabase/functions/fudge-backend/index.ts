import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const CONNECTOR_VERSION = 41;
const PROJECT_REF = "exxknotrmrimwwuyhjqx";
const STORAGE_BUCKET = "fudge-review-images";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || `https://${PROJECT_REF}.supabase.co`;

const HEADERS: Record<string, string[]> = {
  Structure: ["Request ID", "Review Type", "Service Keyword", "City", "Review", "Picture Links", "Quality Check", "Status", "Review ID", "Business", "Updated At", "Numbers", "Rephrased Content"],
  Reviews: ["Review ID", "Fingerprint", "Service", "Subcategory", "City", "Business", "Place ID", "Review", "Review Type", "Original Picture Links", "Drive Picture Links", "Status", "Used At", "Request ID", "Source URL", "Collected At", "QC Note", "Website Copy", "Phone"],
  "Search Progress": ["Search Key", "Service Keyword", "City", "Query", "Page", "Next Business", "Exhausted", "Visited Place IDs", "Updated At"],
  Businesses: ["Place ID", "Service Keyword", "City", "Business", "Visited At", "Eligible Reviews"],
  Cities: ["City", "Status", "Last Used", "Exhausted Keywords", "Notes"],
  Services: ["Service Keyword", "Status", "Reviews Collected", "Notes", "Search Term", "Business Name Keywords", "Review Keywords", "Required Review Keywords", "Google Filter Keywords", "Exclude Keywords", "Service Family", "Subcategory", "Topic Filter Required", "Collect Family Reviews", "Rewrite Service Phrase", "Equivalent Service Phrases"],
  Names: ["Name", "Last Used"],
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-fudge-token, x-fudge-extension-token, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function secretKey(): string {
  const modern = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modern) {
    try {
      const keys = JSON.parse(modern);
      if (keys.default) return keys.default;
    } catch (_) {
      // Fall through to the legacy compatibility key.
    }
  }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!legacy) throw new Error("Supabase server credentials are unavailable.");
  return legacy;
}

const admin = createClient(SUPABASE_URL, secretKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const clean = (value: unknown) => String(value == null ? "" : value).trim();
const cleanRow = (row: unknown[]) => row.map((value) => value == null ? "" : String(value));

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

type Actor = { id: string; name: string; actorType: "workspace" | "extension"; extensionId?: string };

async function authenticate(req: Request): Promise<Actor> {
  const extensionToken = clean(req.headers.get("x-fudge-extension-token"));
  if (extensionToken) {
    const secretHash = await sha256(extensionToken);
    const { data, error } = await admin
      .from("extensions")
      .select("id,workspace_id,name,status")
      .eq("secret_hash", secretHash)
      .maybeSingle();
    if (error) throw error;
    if (!data || data.status === "disabled") throw Object.assign(new Error("This Fudge worker is not authorized."), { status: 401 });
    return { id: data.workspace_id, name: data.name, actorType: "extension", extensionId: data.id };
  }
  const token = clean(req.headers.get("x-fudge-token"));
  if (token.length < 48) throw Object.assign(new Error("The Fudge connection token is missing."), { status: 401 });
  const secretHash = await sha256(token);
  const { data, error } = await admin
    .from("fudge_workspaces")
    .select("id,name")
    .eq("secret_hash", secretHash)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error("The Fudge connection token is invalid."), { status: 401 });
  return { ...data, actorType: "workspace" };
}

function columnIndex(label: string): number {
  return [...label].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function parseRange(input: string) {
  const match = clean(input).match(/^'?([^'!]+)'?!([A-Z]+)(\d+)(?::([A-Z]+)?(\d+)?)?$/i);
  if (!match || !HEADERS[match[1]]) throw new Error(`Invalid Fudge range: ${input}`);
  return {
    tab: match[1],
    startColumn: columnIndex(match[2].toUpperCase()),
    startRow: Number(match[3]),
    endColumn: columnIndex((match[4] || match[2]).toUpperCase()),
    endRow: match[5] ? Number(match[5]) : null,
  };
}

type StoredRow = { id: number; cells: unknown[] };

async function allRows(workspaceId: string, tab: string): Promise<StoredRow[]> {
  const result: StoredRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin
      .from("fudge_rows")
      .select("id,cells")
      .eq("workspace_id", workspaceId)
      .eq("tab", tab)
      .order("id", { ascending: true })
      .range(offset, offset + 999);
    if (error) throw error;
    result.push(...(data || []).map((row) => ({ id: Number(row.id), cells: Array.isArray(row.cells) ? row.cells : [] })));
    if (!data || data.length < 1000) break;
  }
  return result;
}

async function readRange(workspaceId: string, input: string) {
  const range = parseRange(input);
  const stored = await allRows(workspaceId, range.tab);
  const logical: unknown[][] = [HEADERS[range.tab], ...stored.map((row) => row.cells)];
  const lastRow = range.endRow || logical.length;
  return logical
    .slice(Math.max(0, range.startRow - 1), Math.max(0, lastRow))
    .map((row) => Array.from({ length: range.endColumn - range.startColumn + 1 }, (_, index) => clean(row[range.startColumn + index])));
}

async function automationState(workspaceId: string) {
  const { data, error } = await admin
    .from("fudge_automation")
    .select("state")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  const state = data?.state || {};
  return {
    queueTrigger: true,
    rephraseTrigger: Boolean(Deno.env.get("OPENAI_API_KEY")),
    editTrigger: false,
    writerConfigured: Boolean(Deno.env.get("OPENAI_API_KEY")),
    model: Deno.env.get("FUDGE_OPENAI_MODEL") || "gpt-5.6-luna",
    lastRephrased: 0,
    lastRunAt: null,
    lastError: null,
    ...state,
  };
}

async function appendRows(workspaceId: string, tab: string, sourceRows: unknown[][]) {
  if (!HEADERS[tab]) throw new Error(`Invalid Fudge tab: ${tab}`);
  const existing = await allRows(workspaceId, tab);
  const reviewIds = new Set(existing.map((row) => clean(row.cells[0])).filter(Boolean));
  const fingerprints = new Set(existing.map((row) => clean(row.cells[1])).filter(Boolean));
  const progressKeys = new Set(existing.map((row) => clean(row.cells[0])).filter(Boolean));
  const businessKeys = new Set(existing.map((row) => [0, 1, 2].map((index) => clean(row.cells[index])).join("|")).filter((key) => !key.startsWith("||")));
  const accepted: string[][] = [];
  let skipped = 0;

  for (const source of sourceRows || []) {
    const row = cleanRow(Array.isArray(source) ? source : []);
    let duplicate = false;
    if (tab === "Reviews") {
      duplicate = Boolean((row[0] && reviewIds.has(row[0])) || (row[1] && fingerprints.has(row[1])));
      if (!duplicate) { if (row[0]) reviewIds.add(row[0]); if (row[1]) fingerprints.add(row[1]); }
    } else if (tab === "Search Progress") {
      duplicate = Boolean(row[0] && progressKeys.has(row[0]));
      if (!duplicate && row[0]) progressKeys.add(row[0]);
    } else if (tab === "Businesses") {
      const key = [0, 1, 2].map((index) => clean(row[index])).join("|");
      duplicate = businessKeys.has(key);
      if (!duplicate) businessKeys.add(key);
    }
    if (duplicate) { skipped += 1; continue; }
    accepted.push(row);
  }

  const startRow = existing.length + 2;
  if (accepted.length) {
    const { error } = await admin.from("fudge_rows").insert(accepted.map((cells) => ({
      workspace_id: workspaceId,
      tab,
      cells,
      updated_at: new Date().toISOString(),
    })));
    if (error) throw error;
  }
  return { ok: true, startRow, appended: accepted.length, skipped };
}

async function batchWrite(workspaceId: string, updates: Array<{ range: string; values: unknown[][] }>) {
  const tabCache = new Map<string, StoredRow[]>();
  let totalUpdatedRows = 0;
  for (const update of updates || []) {
    const range = parseRange(update.range);
    if (range.startRow === 1) continue; // Headers are canonical in the backend.
    if (!tabCache.has(range.tab)) tabCache.set(range.tab, await allRows(workspaceId, range.tab));
    const rows = tabCache.get(range.tab)!;
    const supplied = update.values || [];
    const writeRows = Array.isArray(supplied[0]) ? supplied : [supplied as unknown as unknown[]];
    for (let index = 0; index < writeRows.length; index += 1) {
      const logicalRow = range.startRow + index;
      const offset = logicalRow - 2;
      while (rows.length <= offset) {
        const { data, error } = await admin
          .from("fudge_rows")
          .insert({ workspace_id: workspaceId, tab: range.tab, cells: [] })
          .select("id,cells")
          .single();
        if (error) throw error;
        rows.push({ id: Number(data.id), cells: [] });
      }
      const stored = rows[offset];
      const cells = [...stored.cells];
      cleanRow(writeRows[index] || []).forEach((value, columnOffset) => {
        cells[range.startColumn + columnOffset] = value;
      });
      const { error } = await admin
        .from("fudge_rows")
        .update({ cells, updated_at: new Date().toISOString() })
        .eq("id", stored.id)
        .eq("workspace_id", workspaceId);
      if (error) throw error;
      stored.cells = cells;
      totalUpdatedRows += 1;
    }
  }
  return { ok: true, totalUpdatedRows };
}

async function deleteRow(workspaceId: string, tab: string, rowNumber: number) {
  if (!HEADERS[tab]) throw new Error(`Invalid Fudge tab: ${tab}`);
  if (!Number.isInteger(rowNumber) || rowNumber < 2) throw new Error("Choose a valid data row.");
  const rows = await allRows(workspaceId, tab);
  const target = rows[rowNumber - 2];
  if (!target) throw new Error("That record no longer exists.");
  const { error } = await admin
    .from("fudge_rows")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", target.id);
  if (error) throw error;
  return { ok: true, deleted: 1 };
}

async function replaceTab(workspaceId: string, tab: string, sourceRows: unknown[][]) {
  if (!HEADERS[tab]) throw new Error(`Invalid Fudge tab: ${tab}`);
  const { error: deleteError } = await admin
    .from("fudge_rows")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("tab", tab);
  if (deleteError) throw deleteError;
  const rows = (sourceRows || []).map((source) => cleanRow(Array.isArray(source) ? source : []));
  if (rows.length) {
    const { error: insertError } = await admin.from("fudge_rows").insert(rows.map((cells) => ({
      workspace_id: workspaceId,
      tab,
      cells,
      updated_at: new Date().toISOString(),
    })));
    if (insertError) throw insertError;
  }
  if (tab === "Structure" || tab === "Services") await importLegacyOperationalRows(workspaceId);
  if (tab === "Reviews") await importLegacyReviews(workspaceId);
  return { ok: true, replaced: rows.length };
}

async function importLegacyOperationalRows(workspaceId: string) {
  const serviceRows = await allRows(workspaceId, "Services");
  for (const row of serviceRows) {
    const name = clean(row.cells[0]);
    if (!name) continue;
    await admin.from("services").upsert({
      workspace_id: workspaceId,
      name,
      slug: slugify(name),
      active: !["inactive", "paused", "disabled"].includes(clean(row.cells[1]).toLowerCase()),
      rules: { legacyCells: row.cells },
    }, { onConflict: "workspace_id,slug" });
  }
  const { count } = await admin.from("requirements").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
  if (count) return;
  const structureRows = await allRows(workspaceId, "Structure");
  for (const row of structureRows) {
    const serviceName = clean(row.cells[2]);
    if (!serviceName) continue;
    const slug = slugify(serviceName);
    let { data: service } = await admin.from("services").select("id").eq("workspace_id", workspaceId).eq("slug", slug).maybeSingle();
    if (!service) {
      const created = await admin.from("services").insert({ workspace_id: workspaceId, name: serviceName, slug }).select("id").single();
      if (created.error) throw created.error;
      service = created.data;
    }
    const requestId = clean(row.cells[0]) || `legacy-${row.id}`;
    const mode = clean(row.cells[1]) || "With Picture";
    const city = clean(row.cells[3]);
    const created = await admin.from("requirements").insert({
      workspace_id: workspaceId, service_id: service.id, name: `${serviceName} · ${requestId}`,
      target_count: 1, backup_count: 2, location_filters: city ? [city] : [],
      requires_customer_photos: /with picture|customer photo/i.test(mode),
      eligibility_rules: { legacyRequestId: requestId, legacyReviewMode: mode },
      priority: row.id,
    }).select("id").single();
    if (created.error) throw created.error;
    const serviceRule = serviceRows.find((item) => slugify(item.cells[0]) === slug);
    const keywords = [clean(serviceRule?.cells?.[4]), serviceName].filter(Boolean);
    await admin.from("search_keywords").insert([...new Set(keywords)].map((keyword, index) => ({
      workspace_id: workspaceId, requirement_id: created.data.id, keyword, priority: index + 1,
    })));
  }
}

async function importLegacyReviews(workspaceId: string) {
  const rows = await allRows(workspaceId, "Reviews");
  for (const row of rows) {
    const text = clean(row.cells[7]);
    if (!text) continue;
    const serviceName = clean(row.cells[2]);
    let serviceId: string | null = null;
    if (serviceName) {
      const slug = slugify(serviceName);
      let { data: service } = await admin.from("services").select("id").eq("workspace_id", workspaceId).eq("slug", slug).maybeSingle();
      if (!service) {
        const created = await admin.from("services").insert({ workspace_id: workspaceId, name: serviceName, slug }).select("id").single();
        if (created.error) throw created.error;
        service = created.data;
      }
      serviceId = service.id;
    }
    const sourceId = clean(row.cells[0]) || null;
    const fingerprint = clean(row.cells[1]) || null;
    const fallbackIdentity = await sha256([clean(row.cells[6]), clean(row.cells[5]), text.toLowerCase()].join("|"));
    let existing: { id: string } | null = null;
    if (sourceId) existing = (await admin.from("reviews").select("id").eq("workspace_id", workspaceId).eq("source_review_id", sourceId).maybeSingle()).data;
    if (!existing && fingerprint) existing = (await admin.from("reviews").select("id").eq("workspace_id", workspaceId).eq("fingerprint", fingerprint).maybeSingle()).data;
    if (!existing) existing = (await admin.from("reviews").select("id").eq("workspace_id", workspaceId).eq("fallback_identity", fallbackIdentity).maybeSingle()).data;
    const legacyStatus = clean(row.cells[11]).toLowerCase();
    const record = {
      workspace_id: workspaceId, source_review_id: sourceId, fingerprint, fallback_identity: fallbackIdentity,
      service_id: serviceId, business_name: clean(row.cells[5]), place_id: clean(row.cells[6]), city: clean(row.cells[4]),
      rating: 5, review_text: text, review_type: clean(row.cells[8]) || "With Picture",
      original_photo_urls: asStringArray(row.cells[9]).filter((url) => /^https:\/\//i.test(url)),
      drive_photo_urls: asStringArray(row.cells[10]).filter((url) => /^https:\/\//i.test(url)),
      source_url: clean(row.cells[14]) || null, collected_at: clean(row.cells[15]) || new Date().toISOString(),
      status: legacyStatus === "rejected" ? "rejected" : legacyStatus === "used" ? "archived" : "available",
      rejection_reason: legacyStatus === "rejected" ? clean(row.cells[16]) || "Rejected in legacy quality check" : null,
      raw: { legacyCells: row.cells }, updated_at: new Date().toISOString(),
    };
    if (existing) await admin.from("reviews").update(record).eq("id", existing.id).eq("workspace_id", workspaceId);
    else {
      const inserted = await admin.from("reviews").insert(record);
      if (inserted.error && inserted.error.code !== "23505") throw inserted.error;
    }
  }
  await importLegacyAssignments(workspaceId);
}

async function importLegacyAssignments(workspaceId: string) {
  const structures = await allRows(workspaceId, "Structure");
  for (const row of structures) {
    const requestId = clean(row.cells[0]);
    const sourceReviewId = clean(row.cells[8]);
    if (!requestId || !sourceReviewId) continue;
    const { data: requirements } = await admin.from("requirements").select("id,target_count")
      .eq("workspace_id", workspaceId).contains("eligibility_rules", { legacyRequestId: requestId }).limit(1);
    const requirement = requirements?.[0];
    const { data: review } = await admin.from("reviews").select("id").eq("workspace_id", workspaceId).eq("source_review_id", sourceReviewId).maybeSingle();
    if (!requirement || !review) continue;
    await admin.from("review_assignments").upsert({
      workspace_id: workspaceId, requirement_id: requirement.id, review_id: review.id, status: "assigned", is_backup: false,
    }, { onConflict: "requirement_id,review_id", ignoreDuplicates: true });
    await admin.from("reviews").update({ status: "assigned" }).eq("id", review.id).eq("workspace_id", workspaceId);
    await recalculateRequirement(workspaceId, requirement.id);
  }
}

function safeName(value: unknown) {
  return clean(value).replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "image";
}

async function uploadPhotos(workspaceId: string, photos: Record<string, unknown>[]) {
  const files: Record<string, unknown>[] = [];
  const errors: Record<string, unknown>[] = [];
  for (const photo of photos || []) {
    try {
      const response = await fetch(clean(photo.url), { redirect: "follow" });
      if (!response.ok) throw new Error(`Image download returned ${response.status}.`);
      const contentType = response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
      if (!contentType.startsWith("image/")) throw new Error("The downloaded file is not an image.");
      const extension = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : contentType.includes("gif") ? "gif" : "jpg";
      const path = `${workspaceId}/${safeName(photo.reviewId)}/${safeName(photo.index)}-${crypto.randomUUID()}.${extension}`;
      const body = await response.arrayBuffer();
      const { error } = await admin.storage.from(STORAGE_BUCKET).upload(path, body, { contentType, cacheControl: "31536000", upsert: false });
      if (error) throw error;
      const { data, error: signedUrlError } = await admin.storage.from(STORAGE_BUCKET).createSignedUrl(path, 31536000);
      if (signedUrlError) throw signedUrlError;
      files.push({
        key: photo.key,
        id: path,
        name: path.split("/").pop(),
        originalUrl: photo.url,
        shareLink: data.signedUrl,
        directLink: data.signedUrl,
        viewLink: data.signedUrl,
      });
    } catch (error) {
      errors.push({ key: photo.key, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { ok: true, files, errors };
}

async function rewriteReview(payload: Record<string, unknown>) {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("Website rewriting is ready but needs OPENAI_API_KEY in the Fudge project Edge Function secrets.");
  const review = (payload.review || {}) as Record<string, unknown>;
  const model = Deno.env.get("FUDGE_OPENAI_MODEL") || "gpt-5.6-luna";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "Rewrite the customer review as concise, natural website testimonial copy. Preserve every factual claim. Return only the rewritten testimonial." },
        { role: "user", content: `Service review: ${clean(review.text)}\nBusiness: ${clean(review.business)}\nCity: ${clean(review.city)}\nPhone: ${clean(payload.phone)}` },
      ],
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || `OpenAI returned ${response.status}.`);
  return { ok: true, text: clean(body?.choices?.[0]?.message?.content), model };
}

async function logActivity(workspaceId: string, actor: Actor, action: string, entityType = "", entityId = "", details: Record<string, unknown> = {}) {
  await admin.from("activity_logs").insert({
    workspace_id: workspaceId,
    actor_type: actor.actorType === "extension" ? "extension" : "system",
    actor_id: actor.extensionId || actor.id,
    action,
    entity_type: entityType || null,
    entity_id: entityId || null,
    details,
  });
}

function slugify(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "service";
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  return clean(value).split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
}

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function registerExtension(actor: Actor, payload: Record<string, unknown>) {
  if (actor.actorType !== "workspace") throw Object.assign(new Error("Only the workspace connection can register a worker."), { status: 403 });
  const installationId = clean(payload.installationId);
  if (!installationId) throw new Error("installationId is required.");
  const secret = randomSecret();
  const secretHash = await sha256(secret);
  const record = {
    workspace_id: actor.id,
    installation_id: installationId,
    name: clean(payload.name) || "Fudge Chrome Extension",
    secret_hash: secretHash,
    status: "online",
    version: clean(payload.version),
    capabilities: payload.capabilities || {},
    last_heartbeat_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await admin.from("extensions")
    .upsert(record, { onConflict: "workspace_id,installation_id" })
    .select("id,name,status")
    .single();
  if (error) throw error;
  await logActivity(actor.id, actor, "extension.registered", "extension", data.id, { version: record.version });
  return { ok: true, extension: data, extensionToken: secret };
}

async function workerHeartbeat(actor: Actor, payload: Record<string, unknown>) {
  if (actor.actorType !== "extension" || !actor.extensionId) throw Object.assign(new Error("A registered worker is required."), { status: 403 });
  const patch = {
    status: clean(payload.status) === "paused" ? "paused" : "online",
    last_heartbeat_at: new Date().toISOString(),
    version: clean(payload.version) || undefined,
    last_error: clean(payload.error) || null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from("extensions").update(patch).eq("id", actor.extensionId).eq("workspace_id", actor.id);
  if (error) throw error;
  const automation = await automationState(actor.id);
  return { ok: true, automation, extensionId: actor.extensionId };
}

async function saveIdempotent(workspaceId: string, extensionId: string | undefined, key: string, action: string, response: Record<string, unknown>) {
  if (!key) return;
  await admin.from("api_idempotency").upsert({ workspace_id: workspaceId, extension_id: extensionId || null, idempotency_key: key, action, response });
}

async function previousIdempotent(workspaceId: string, key: string) {
  if (!key) return null;
  const { data, error } = await admin.from("api_idempotency").select("response").eq("workspace_id", workspaceId).eq("idempotency_key", key).maybeSingle();
  if (error) throw error;
  return data?.response || null;
}

async function recalculateRequirement(workspaceId: string, requirementId: string) {
  const { data: requirement, error } = await admin.from("requirements")
    .select("*,services(name)").eq("workspace_id", workspaceId).eq("id", requirementId).single();
  if (error) throw error;
  const { data: currentAssignments, error: assignmentError } = await admin.from("review_assignments")
    .select("id,review_id,status,is_backup").eq("workspace_id", workspaceId).eq("requirement_id", requirementId)
    .in("status", ["assigned", "accepted"]);
  if (assignmentError) throw assignmentError;
  const wanted = Math.max(0, Number(requirement.target_count) + Number(requirement.backup_count));
  let assigned = currentAssignments?.length || 0;
  const assignedReviewIds = new Set((currentAssignments || []).map((item) => item.review_id));
  if (assigned < wanted) {
    let query = admin.from("reviews").select("id,city,original_photo_urls,drive_photo_urls")
      .eq("workspace_id", workspaceId).eq("service_id", requirement.service_id).eq("status", "available")
      .order("collected_at", { ascending: true }).limit(wanted - assigned + 20);
    if (requirement.requires_customer_photos) query = query.not("original_photo_urls", "eq", "{}");
    const { data: candidates, error: reviewError } = await query;
    if (reviewError) throw reviewError;
    const locations = new Set(asStringArray(requirement.location_filters).map((item) => item.toLowerCase()));
    for (const review of candidates || []) {
      if (assigned >= wanted) break;
      if (assignedReviewIds.has(review.id)) continue;
      if (locations.size && review.city && !locations.has(clean(review.city).toLowerCase())) continue;
      const isBackup = assigned >= Number(requirement.target_count);
      const { error: insertError } = await admin.from("review_assignments").insert({
        workspace_id: workspaceId, requirement_id: requirementId, review_id: review.id, is_backup: isBackup,
      });
      if (insertError) continue;
      await admin.from("reviews").update({ status: "assigned" }).eq("id", review.id).eq("workspace_id", workspaceId);
      assigned += 1;
    }
  }
  const { count: rejected } = await admin.from("review_assignments").select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId).eq("requirement_id", requirementId).eq("status", "rejected");
  const remaining = Math.max(0, wanted - assigned);
  await admin.from("requirements").update({
    collected_count: assigned + Number(rejected || 0), assigned_count: assigned, rejected_count: Number(rejected || 0),
    status: requirement.status === "archived" || requirement.status === "paused" ? requirement.status : (remaining === 0 ? "completed" : "active"),
  }).eq("id", requirementId).eq("workspace_id", workspaceId);
  return { requirement, assigned, rejected: Number(rejected || 0), remaining, wanted };
}

async function ensureSearchJobs(workspaceId: string) {
  const automation = await automationState(workspaceId);
  const runState = clean(automation.runState || automation.state || "running").toLowerCase();
  if (["paused", "stopped"].includes(runState)) return;
  const { data: requirements, error } = await admin.from("requirements").select("id,priority,status")
    .eq("workspace_id", workspaceId).eq("status", "active").order("priority");
  if (error) throw error;
  for (const item of requirements || []) {
    const state = await recalculateRequirement(workspaceId, item.id);
    if (!state.remaining) continue;
    const { count: activeJobs } = await admin.from("search_jobs").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId).eq("requirement_id", item.id).in("status", ["pending", "leased", "running"]);
    if (activeJobs) continue;
    const { data: keywords } = await admin.from("search_keywords").select("id,keyword,priority,attempt_count")
      .eq("workspace_id", workspaceId).eq("requirement_id", item.id).eq("active", true).eq("status", "ready")
      .order("priority").limit(3);
    const cities = asStringArray(state.requirement.location_filters);
    for (const keyword of keywords || []) {
      const city = cities[0] || "";
      const cycle = Number(keyword.attempt_count || 0) + 1;
      const key = `${item.id}:${keyword.id}:${city.toLowerCase()}:${cycle}`;
      await admin.from("search_jobs").upsert({
        workspace_id: workspaceId, requirement_id: item.id, keyword_id: keyword.id,
        status: "pending", priority: Math.min(Number(item.priority), Number(keyword.priority)),
        query: [keyword.keyword, city].filter(Boolean).join(" "), city,
        review_mode: state.requirement.requires_customer_photos ? "With Picture" : "Without Picture",
        target_count: Math.max(1, state.remaining), idempotency_key: key,
      }, { onConflict: "workspace_id,idempotency_key", ignoreDuplicates: true });
    }
  }
}

async function claimNextJob(actor: Actor) {
  if (actor.actorType !== "extension" || !actor.extensionId) throw Object.assign(new Error("A registered worker is required."), { status: 403 });
  const automation = await automationState(actor.id);
  const runState = clean(automation.runState || automation.state || "running").toLowerCase();
  if (runState !== "running") return { ok: true, job: null, automation };
  await ensureSearchJobs(actor.id);
  const { data, error } = await admin.rpc("claim_fudge_search_job", {
    target_workspace: actor.id, target_extension: actor.extensionId, lease_seconds: 180,
  });
  if (error) throw error;
  const job = data?.[0] || null;
  if (!job) return { ok: true, job: null };
  const { data: keyword } = await admin.from("search_keywords").select("keyword,priority").eq("id", job.keyword_id).single();
  const { data: requirement } = await admin.from("requirements").select("*,services(name,rules)").eq("id", job.requirement_id).single();
  await admin.from("search_history").insert({ workspace_id: actor.id, job_id: job.id, extension_id: actor.extensionId, keyword_id: job.keyword_id, event_type: "leased" });
  await logActivity(actor.id, actor, "job.leased", "search_job", job.id, { query: job.query });
  return { ok: true, job: {
    id: job.id, leaseToken: job.lease_token, searchKey: job.id, serviceKeyword: requirement?.services?.name || requirement?.name,
    city: job.city, query: job.query, reviewMode: job.review_mode, targetCount: job.target_count,
    requirementId: job.requirement_id, keywordId: job.keyword_id, keyword: keyword?.keyword,
    currentPage: Number(job.progress?.currentPage || 1), businessIndex: Number(job.progress?.businessIndex || 0),
    visitedPlaceIds: job.progress?.visitedPlaceIds || [], serviceRules: requirement?.services?.rules || {},
  } };
}

async function assertJobLease(actor: Actor, payload: Record<string, any>) {
  if (actor.actorType !== "extension" || !actor.extensionId) throw Object.assign(new Error("A registered worker is required."), { status: 403 });
  const jobId = clean(payload.jobId || payload.id);
  const leaseToken = clean(payload.leaseToken);
  const { data: job, error } = await admin.from("search_jobs").select("*").eq("id", jobId).eq("workspace_id", actor.id).maybeSingle();
  if (error) throw error;
  if (!job || job.extension_id !== actor.extensionId || clean(job.lease_token) !== leaseToken) throw Object.assign(new Error("The job lease is no longer valid."), { status: 409 });
  return job;
}

async function reportJobProgress(actor: Actor, payload: Record<string, any>) {
  const job = await assertJobLease(actor, payload);
  const progress = { ...(job.progress || {}), ...(payload.progress || {}), updatedAt: new Date().toISOString() };
  const status = payload.running === false ? job.status : "running";
  const { error } = await admin.from("search_jobs").update({
    progress, status, heartbeat_at: new Date().toISOString(), leased_until: new Date(Date.now() + 180000).toISOString(), started_at: job.started_at || new Date().toISOString(),
  }).eq("id", job.id).eq("workspace_id", actor.id);
  if (error) throw error;
  await admin.from("extensions").update({ status: "online", last_heartbeat_at: new Date().toISOString(), active_job_id: job.id }).eq("id", actor.extensionId!);
  if (payload.eventType) await admin.from("search_history").insert({ workspace_id: actor.id, job_id: job.id, extension_id: actor.extensionId, keyword_id: job.keyword_id, event_type: clean(payload.eventType), details: progress });
  return { ok: true, jobId: job.id, leasedUntil: new Date(Date.now() + 180000).toISOString() };
}

async function submitReviewBatch(actor: Actor, payload: Record<string, any>, idempotencyKey: string) {
  if (actor.actorType !== "extension" || !actor.extensionId) throw Object.assign(new Error("A registered worker is required."), { status: 403 });
  const previous = await previousIdempotent(actor.id, idempotencyKey);
  if (previous) return previous;
  const job = payload.jobId ? await assertJobLease(actor, payload) : null;
  let jobServiceId: string | null = null;
  if (job) {
    const { data: requirement, error } = await admin.from("requirements").select("service_id").eq("id", job.requirement_id).single();
    if (error) throw error;
    jobServiceId = requirement.service_id;
  }
  const rows = Array.isArray(payload.reviews) ? payload.reviews : [];
  let inserted = 0;
  let duplicates = 0;
  for (const source of rows) {
    const text = clean(source.text || source.review || source.reviewText);
    if (!text) continue;
    const sourceId = clean(source.id || source.reviewId) || null;
    const fingerprint = clean(source.fingerprint) || null;
    const fallbackIdentity = await sha256([clean(source.placeId), clean(source.reviewerName || source.author), text.toLowerCase()].join("|"));
    const record = {
      workspace_id: actor.id, source_review_id: sourceId, fingerprint, fallback_identity: fallbackIdentity,
      service_id: clean(source.serviceId) || jobServiceId, source_job_id: job?.id || null,
      business_name: clean(source.business), place_id: clean(source.placeId), city: clean(source.city),
      rating: Math.max(1, Math.min(5, Number(source.rating) || 5)), review_text: text,
      reviewer_name: clean(source.reviewerName || source.author), review_type: clean(source.reviewType || source.mode) || "With Picture",
      original_photo_urls: asStringArray(source.photos || source.originalPhotoUrls), drive_photo_urls: asStringArray(source.drivePhotoUrls || (source.drivePhotos || []).map((item: any) => item?.shareLink || item?.viewLink)),
      source_url: clean(source.sourceUrl) || null, collected_at: source.collectedAt || new Date().toISOString(), raw: source,
    };
    let existing: { id: string } | null = null;
    if (sourceId) existing = (await admin.from("reviews").select("id").eq("workspace_id", actor.id).eq("source_review_id", sourceId).limit(1).maybeSingle()).data;
    if (!existing && fingerprint) existing = (await admin.from("reviews").select("id").eq("workspace_id", actor.id).eq("fingerprint", fingerprint).limit(1).maybeSingle()).data;
    if (!existing) existing = (await admin.from("reviews").select("id").eq("workspace_id", actor.id).eq("fallback_identity", fallbackIdentity).limit(1).maybeSingle()).data;
    if (existing) {
      duplicates += 1;
      const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (record.drive_photo_urls.length) update.drive_photo_urls = record.drive_photo_urls;
      if (jobServiceId) { update.service_id = jobServiceId; update.source_job_id = job?.id || null; }
      await admin.from("reviews").update(update).eq("id", existing.id).eq("workspace_id", actor.id);
      continue;
    }
    const { error } = await admin.from("reviews").insert(record);
    if (error) { if (error.code === "23505") duplicates += 1; else throw error; }
    else inserted += 1;
  }
  if (job) await recalculateRequirement(actor.id, job.requirement_id);
  const response = { ok: true, inserted, duplicates, received: rows.length };
  await saveIdempotent(actor.id, actor.extensionId, idempotencyKey, "submitReviewBatch", response);
  await logActivity(actor.id, actor, "reviews.submitted", "search_job", job?.id || "", response);
  return response;
}

async function recordBusiness(actor: Actor, payload: Record<string, any>) {
  const job = await assertJobLease(actor, payload);
  const placeId = clean(payload.placeId);
  if (!placeId) return { ok: true };
  const { data: requirement } = await admin.from("requirements").select("service_id").eq("id", job.requirement_id).single();
  const record = {
    workspace_id: actor.id, place_id: placeId, service_id: requirement?.service_id || null,
    city: clean(payload.city || job.city), name: clean(payload.business), eligible_reviews: Math.max(0, Number(payload.eligible) || 0),
    scanned_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  const { data: existing } = await admin.from("businesses").select("id,scan_count").eq("workspace_id", actor.id)
    .eq("place_id", placeId).eq("service_id", record.service_id).eq("city", record.city).maybeSingle();
  const operation = existing
    ? admin.from("businesses").update({ ...record, scan_count: Number(existing.scan_count || 0) + 1 }).eq("id", existing.id)
    : admin.from("businesses").insert(record);
  const { error } = await operation;
  if (error) throw error;
  await admin.from("search_history").insert({ workspace_id: actor.id, job_id: job.id, extension_id: actor.extensionId, keyword_id: job.keyword_id, event_type: "business_scanned", details: { placeId, business: record.name, eligible: record.eligible_reviews } });
  return { ok: true };
}

async function finishJob(actor: Actor, payload: Record<string, any>, failed = false) {
  const job = await assertJobLease(actor, payload);
  const status = failed ? "failed" : "completed";
  const patch = {
    status, progress: { ...(job.progress || {}), ...(payload.progress || {}) }, error: failed ? clean(payload.error) : null,
    completed_at: new Date().toISOString(), leased_until: null, lease_token: null, updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from("search_jobs").update(patch).eq("id", job.id).eq("workspace_id", actor.id);
  if (error) throw error;
  await admin.from("extensions").update({ active_job_id: null, last_heartbeat_at: new Date().toISOString(), status: "online" }).eq("id", actor.extensionId!);
  await admin.from("search_keywords").update({
    status: payload.exhausted ? "exhausted" : "ready", exhausted_at: payload.exhausted ? new Date().toISOString() : null,
    last_searched_at: new Date().toISOString(), attempt_count: Number(payload.attemptCount || 0) + 1,
  }).eq("id", job.keyword_id).eq("workspace_id", actor.id);
  await admin.from("search_history").insert({ workspace_id: actor.id, job_id: job.id, extension_id: actor.extensionId, keyword_id: job.keyword_id, event_type: status, details: patch.progress });
  await recalculateRequirement(actor.id, job.requirement_id);
  await ensureSearchJobs(actor.id);
  await logActivity(actor.id, actor, `job.${status}`, "search_job", job.id, { exhausted: Boolean(payload.exhausted), error: patch.error });
  return { ok: true, jobId: job.id, status };
}

async function setAutomationState(actor: Actor, payload: Record<string, unknown>) {
  const requested = clean(payload.state).toLowerCase();
  if (!['running', 'paused', 'stopped'].includes(requested)) throw new Error("Automation state must be running, paused, or stopped.");
  const current = await automationState(actor.id);
  const state = { ...current, runState: requested, state: requested, lastRunAt: new Date().toISOString() };
  const { error } = await admin.from("fudge_automation").upsert({ workspace_id: actor.id, state, updated_at: new Date().toISOString() });
  if (error) throw error;
  await logActivity(actor.id, actor, `automation.${requested}`, "automation", actor.id);
  return { ok: true, automation: state };
}

async function saveRequirement(actor: Actor, payload: Record<string, any>) {
  if (actor.actorType !== "workspace") throw Object.assign(new Error("Dashboard access is required."), { status: 403 });
  const input = payload.requirement || payload;
  const serviceName = clean(input.serviceName || input.service);
  if (!serviceName) throw new Error("Service name is required.");
  const slug = slugify(serviceName);
  const { data: existingService, error: findServiceError } = await admin.from("services").select("id,name,rules").eq("workspace_id", actor.id).eq("slug", slug).maybeSingle();
  if (findServiceError) throw findServiceError;
  let service;
  if (existingService) {
    const servicePatch: Record<string, unknown> = { name: serviceName, active: input.serviceActive !== false };
    if (input.serviceRules && Object.keys(input.serviceRules).length) servicePatch.rules = input.serviceRules;
    const updated = await admin.from("services").update(servicePatch).eq("id", existingService.id).eq("workspace_id", actor.id).select("id,name").single();
    if (updated.error) throw updated.error;
    service = updated.data;
  } else {
    const created = await admin.from("services").insert({
      workspace_id: actor.id, name: serviceName, slug, active: input.serviceActive !== false,
      rules: input.serviceRules || { searchTerm: serviceName, reviewSignals: [], requiredSignals: [], excludeSignals: [] },
    }).select("id,name").single();
    if (created.error) throw created.error;
    service = created.data;
  }
  const requirementRecord = {
    workspace_id: actor.id, service_id: service.id, name: clean(input.name) || `${serviceName} reviews`,
    status: clean(input.status) || "active", target_count: Math.max(0, Number(input.targetCount) || 0),
    backup_count: Math.max(0, Number(input.backupCount) || 0), location_filters: asStringArray(input.locationFilters),
    requires_customer_photos: Boolean(input.requiresCustomerPhotos), eligibility_rules: input.eligibilityRules || {},
    priority: Number(input.priority) || 100,
  };
  let requirement;
  if (clean(input.id)) {
    const { data, error } = await admin.from("requirements").update(requirementRecord).eq("id", clean(input.id)).eq("workspace_id", actor.id).select().single();
    if (error) throw error; requirement = data;
  } else {
    const { data, error } = await admin.from("requirements").insert(requirementRecord).select().single();
    if (error) throw error; requirement = data;
  }
  const keywords = asStringArray(input.keywords);
  if (keywords.length) {
    await admin.from("search_keywords").delete().eq("workspace_id", actor.id).eq("requirement_id", requirement.id);
    const { error } = await admin.from("search_keywords").insert(keywords.map((keyword, index) => ({
      workspace_id: actor.id, requirement_id: requirement.id, keyword, priority: index + 1, active: true,
    })));
    if (error) throw error;
  }
  await recalculateRequirement(actor.id, requirement.id);
  await ensureSearchJobs(actor.id);
  await logActivity(actor.id, actor, clean(input.id) ? "requirement.updated" : "requirement.created", "requirement", requirement.id);
  return { ok: true, requirement };
}

async function deleteRequirement(actor: Actor, payload: Record<string, unknown>) {
  if (actor.actorType !== "workspace") throw Object.assign(new Error("Dashboard access is required."), { status: 403 });
  const id = clean(payload.id);
  const { error } = await admin.from("requirements").update({ status: "archived" }).eq("workspace_id", actor.id).eq("id", id);
  if (error) throw error;
  await admin.from("search_jobs").update({ status: "cancelled", leased_until: null, lease_token: null }).eq("workspace_id", actor.id).eq("requirement_id", id).in("status", ["pending", "leased"]);
  await logActivity(actor.id, actor, "requirement.archived", "requirement", id);
  return { ok: true };
}

async function dashboardSnapshot(workspaceId: string) {
  const staleBefore = new Date(Date.now() - 90000).toISOString();
  await admin.from("extensions").update({ status: "offline", active_job_id: null }).eq("workspace_id", workspaceId).lt("last_heartbeat_at", staleBefore).neq("status", "disabled");
  const [requirements, keywords, jobs, extensions, activity, reviewCount, duplicateCount] = await Promise.all([
    admin.from("requirements").select("*,services(id,name,slug,active,rules),search_keywords(*)").eq("workspace_id", workspaceId).neq("status", "archived").order("priority"),
    admin.from("search_keywords").select("id,status,keyword,requirement_id,last_searched_at,attempt_count").eq("workspace_id", workspaceId),
    admin.from("search_jobs").select("id,status,query,city,requirement_id,extension_id,progress,error,created_at,updated_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(100),
    admin.from("extensions").select("id,name,status,version,active_job_id,last_heartbeat_at,last_error").eq("workspace_id", workspaceId).order("created_at"),
    admin.from("activity_logs").select("id,action,entity_type,entity_id,details,created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(30),
    admin.from("reviews").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    admin.from("activity_logs").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("action", "reviews.submitted"),
  ]);
  for (const result of [requirements, keywords, jobs, extensions, activity, reviewCount, duplicateCount]) if (result.error) throw result.error;
  const automation = await automationState(workspaceId);
  // The job list above is capped, so counting it would under-report every total
  // once the queue passes that cap. Count in the database instead.
  const countJobs = async (statuses: string[]) => {
    const { count, error } = await admin
      .from("search_jobs")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .in("status", statuses);
    if (error) throw error;
    return count || 0;
  };
  const [pendingJobs, activeJobs, completedJobs, failedJobs] = await Promise.all([
    countJobs(["pending"]), countJobs(["leased", "running"]), countJobs(["completed"]), countJobs(["failed"]),
  ]);
  return {
    ok: true, automation, requirements: requirements.data || [], keywords: keywords.data || [], jobs: jobs.data || [],
    extensions: extensions.data || [], activity: activity.data || [], reviewCount: reviewCount.count || 0,
    metrics: { pendingJobs, activeJobs, completedJobs, failedJobs },
  };
}

async function handleAction(workspace: Actor, payload: Record<string, any>, req: Request) {
  const automation = await automationState(workspace.id);
  switch (payload.action) {
    case "setup":
      return {
        ok: true,
        spreadsheetId: PROJECT_REF,
        spreadsheetUrl: `https://supabase.com/dashboard/project/${PROJECT_REF}/editor`,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        automation,
      };
    case "status":
    case "installAutomation":
      return { ok: true, automation };
    case "registerExtension":
      return await registerExtension(workspace, payload);
    case "workerHeartbeat":
      return await workerHeartbeat(workspace, payload);
    case "claimNextJob":
      return await claimNextJob(workspace);
    case "reportJobProgress":
      return await reportJobProgress(workspace, payload);
    case "submitReviewBatch":
      return await submitReviewBatch(workspace, payload, clean(req.headers.get("idempotency-key") || payload.idempotencyKey));
    case "recordBusiness":
      return await recordBusiness(workspace, payload);
    case "completeJob":
      return await finishJob(workspace, payload, false);
    case "failJob":
      return await finishJob(workspace, payload, true);
    case "setAutomationState":
      return await setAutomationState(workspace, payload);
    case "saveRequirement":
      return await saveRequirement(workspace, payload);
    case "deleteRequirement":
      return await deleteRequirement(workspace, payload);
    case "dashboardSnapshot":
      return await dashboardSnapshot(workspace.id);
    case "read":
      return { ok: true, values: await Promise.all((payload.ranges || []).map((range: string) => readRange(workspace.id, range))), automation };
    case "batchWrite":
      return { ...(await batchWrite(workspace.id, payload.updates || [])), automation };
    case "deleteRow":
      return { ...(await deleteRow(workspace.id, clean(payload.tab), Number(payload.rowNumber))), automation };
    case "replaceTab":
      return { ...(await replaceTab(workspace.id, clean(payload.tab), payload.rows || [])), automation };
    case "appendRows":
      return { ...(await appendRows(workspace.id, clean(payload.tab), payload.rows || [])), automation };
    case "uploadPhotos":
      throw new Error("Review pictures are stored through the Google Drive connector so they keep drive.google.com file links.");
    case "rewriteReview":
      return await rewriteReview(payload);
    case "processQueue":
      return { ok: true, filled: 0, replaced: 0, rephrased: 0, automation };
    case "rephraseNow":
      return { ok: true, rephrased: 0, pending: 0, automation };
    default:
      throw new Error("Unknown Fudge action.");
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ ok: false, error: "POST required." }), { status: 405, headers: corsHeaders });
  try {
    const workspace = await authenticate(req);
    const payload = await req.json();
    const result = await handleAction(workspace, payload || {}, req);
    return new Response(JSON.stringify({ connectorVersion: CONNECTOR_VERSION, ...result }), { status: 200, headers: corsHeaders });
  } catch (error) {
    const status = Number((error as { status?: number })?.status) || 400;
    return new Response(JSON.stringify({ connectorVersion: CONNECTOR_VERSION, ok: false, error: error instanceof Error ? error.message : String(error) }), { status, headers: corsHeaders });
  }
});
