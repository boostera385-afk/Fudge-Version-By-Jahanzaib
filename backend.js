const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const app = { snapshot: null, busy: false, editing: null, timer: null };
let toastTimer;

function showToast(message, error = false) {
  const toast = $("#toast");
  toast.className = `toast show${error ? " toast--error" : ""}`;
  toast.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 4200);
}

async function request(action, payload = {}) {
  const response = await fetch(FUDGE_SUPABASE.functionUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: FUDGE_SUPABASE.publishableKey, "x-fudge-token": FUDGE_SUPABASE.connectionToken },
    body: JSON.stringify({ action, ...payload })
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error(result?.error || `Supabase request failed (${response.status}).`);
  return result;
}

const relativeTime = (value) => {
  const elapsed = Date.now() - Date.parse(value || "");
  if (!Number.isFinite(elapsed)) return "Never";
  if (elapsed < 60000) return "Just now";
  if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)}m ago`;
  if (elapsed < 86400000) return `${Math.floor(elapsed / 3600000)}h ago`;
  return `${Math.floor(elapsed / 86400000)}d ago`;
};

const badge = (status) => `<span class="ops-badge ops-badge--${escapeHtml(String(status || "unknown").toLowerCase())}">${escapeHtml(status || "Unknown")}</span>`;
const empty = (text) => `<div class="ops-empty">${escapeHtml(text)}</div>`;

function renderMetrics() {
  const data = app.snapshot;
  const values = [
    ["Review inventory", data.reviewCount || 0, "Deduplicated records"],
    ["Requirements", data.requirements?.length || 0, "Active management targets"],
    ["Pending jobs", data.metrics?.pendingJobs || 0, "Waiting for a worker"],
    ["Active jobs", data.metrics?.activeJobs || 0, "Leased or running"],
    ["Completed", data.metrics?.completedJobs || 0, "Recent completed jobs"],
    ["Failed", data.metrics?.failedJobs || 0, "Needs attention"]
  ];
  $("#metrics").innerHTML = values.map(([label, value, hint]) => `<article class="ops-metric"><span>${escapeHtml(label)}</span><strong>${Number(value).toLocaleString()}</strong><small>${escapeHtml(hint)}</small></article>`).join("");
}

function renderAutomation() {
  const state = String(app.snapshot.automation?.runState || app.snapshot.automation?.state || "stopped").toLowerCase();
  $("#automationTitle").textContent = state === "running" ? "Collecting is running" : state === "paused" ? "Collecting is paused" : "Collecting is stopped";
  $("#automationHelp").textContent = state === "running" ? "Available workers can claim queued searches now." : state === "paused" ? "Running work can finish safely; no new work is assigned." : "No new work is assigned. Existing review data is preserved.";
  document.querySelectorAll("[data-state]").forEach((button) => { button.disabled = button.dataset.state === state; });
}

function renderRequirements() {
  const rows = app.snapshot.requirements || [];
  $("#requirements").innerHTML = rows.length ? rows.map((item) => {
    const target = Number(item.target_count) || 0;
    const backups = Number(item.backup_count) || 0;
    const assigned = Number(item.assigned_count) || 0;
    const wanted = target + backups;
    const percent = wanted ? Math.min(100, Math.round(assigned / wanted * 100)) : 100;
    const keywords = (item.search_keywords || []).map((keyword) => keyword.keyword).join(" · ") || "No keywords";
    const locations = (item.location_filters || []).join(" · ") || "All locations";
    return `<button class="ops-requirement" data-requirement="${escapeHtml(item.id)}">
      <div class="ops-row-main"><div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.services?.name || "Service")} · ${escapeHtml(locations)}</span></div>${badge(item.status)}</div>
      <div class="ops-progress"><i style="width:${percent}%"></i></div>
      <div class="ops-requirement-meta"><span>${assigned}/${wanted} assigned</span><span>${Number(item.rejected_count) || 0} rejected</span><span>${item.requires_customer_photos ? "Customer photos required" : "Pictures optional"}</span></div>
      <small>${escapeHtml(keywords)}</small>
    </button>`;
  }).join("") : empty("No requirements yet. Add one to create the first Supabase-managed search job.");
}

function renderWorkers() {
  const rows = app.snapshot.extensions || [];
  $("#workers").innerHTML = rows.length ? rows.map((worker) => `<div class="ops-list-row"><div><strong>${escapeHtml(worker.name)}</strong><span>Version ${escapeHtml(worker.version || "unknown")} · ${relativeTime(worker.last_heartbeat_at)}</span>${worker.last_error ? `<small class="ops-error">${escapeHtml(worker.last_error)}</small>` : ""}</div>${badge(worker.status)}</div>`).join("") : empty("No Chrome worker has registered yet. Reload the extension once.");
}

function renderJobs() {
  const rows = (app.snapshot.jobs || []).slice(0, 12);
  $("#jobs").innerHTML = rows.length ? rows.map((job) => `<div class="ops-list-row"><div><strong>${escapeHtml(job.query)}</strong><span>${escapeHtml(job.city || "All locations")} · ${relativeTime(job.updated_at)}</span>${job.error ? `<small class="ops-error">${escapeHtml(job.error)}</small>` : ""}</div>${badge(job.status)}</div>`).join("") : empty("No jobs yet. Active requirements create jobs automatically.");
}

function renderActivity() {
  const rows = app.snapshot.activity || [];
  $("#activity").innerHTML = rows.length ? rows.map((event) => `<div class="ops-list-row"><div><strong>${escapeHtml(event.action.replaceAll(".", " · "))}</strong><span>${escapeHtml(event.entity_type || "system")} ${event.entity_id ? `· ${escapeHtml(String(event.entity_id).slice(0, 8))}` : ""}</span></div><time>${relativeTime(event.created_at)}</time></div>`).join("") : empty("Activity will appear as requirements and jobs change.");
}

function render() {
  renderAutomation();
  renderMetrics();
  renderRequirements();
  renderWorkers();
  renderJobs();
  renderActivity();
}

async function load({ quiet = false } = {}) {
  if (app.busy) return;
  app.busy = true;
  if (!quiet) { $("#health").className = "data-health is-loading"; $("#health span").textContent = "Syncing"; }
  try {
    app.snapshot = await request("dashboardSnapshot");
    $("#health").className = "data-health is-online";
    $("#health span").textContent = "Supabase live";
    render();
  } catch (error) {
    $("#health").className = "data-health is-error";
    $("#health span").textContent = "Needs attention";
    if (!quiet) showToast(error.message, true);
  } finally { app.busy = false; }
}

function openRequirement(item = null) {
  app.editing = item;
  const form = $("#requirementForm");
  form.reset();
  form.elements.id.value = item?.id || "";
  form.elements.name.value = item?.name || "";
  form.elements.serviceName.value = item?.services?.name || "";
  form.elements.keywords.value = (item?.search_keywords || []).map((keyword) => keyword.keyword).join("\n");
  form.elements.targetCount.value = item?.target_count ?? 1;
  form.elements.backupCount.value = item?.backup_count ?? 2;
  form.elements.priority.value = item?.priority ?? 100;
  form.elements.status.value = item?.status === "completed" ? "completed" : item?.status === "paused" ? "paused" : "active";
  form.elements.locationFilters.value = (item?.location_filters || []).join("\n");
  form.elements.requiresCustomerPhotos.checked = Boolean(item?.requires_customer_photos);
  $("#requirementEditorTitle").textContent = item ? "Edit requirement" : "Add requirement";
  $("#archiveRequirement").hidden = !item;
  $("#requirementEditor").showModal();
}

async function saveRequirement(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("#saveRequirement");
  const requirement = {
    id: form.elements.id.value,
    name: form.elements.name.value.trim(), serviceName: form.elements.serviceName.value.trim(),
    keywords: form.elements.keywords.value, targetCount: Number(form.elements.targetCount.value),
    backupCount: Number(form.elements.backupCount.value), priority: Number(form.elements.priority.value),
    status: form.elements.status.value, locationFilters: form.elements.locationFilters.value,
    requiresCustomerPhotos: form.elements.requiresCustomerPhotos.checked
  };
  button.disabled = true; button.textContent = "Saving…";
  try {
    await request("saveRequirement", { requirement });
    $("#requirementEditor").close();
    await load();
    showToast(requirement.id ? "Requirement updated." : "Requirement created.");
  } catch (error) { showToast(error.message, true); }
  finally { button.disabled = false; button.textContent = "Save requirement"; }
}

async function archiveRequirement() {
  if (!app.editing || !confirm("Archive this requirement? Reviews and history will be preserved.")) return;
  const button = $("#archiveRequirement"); button.disabled = true;
  try { await request("deleteRequirement", { id: app.editing.id }); $("#requirementEditor").close(); await load(); showToast("Requirement archived. Historical reviews were preserved."); }
  catch (error) { showToast(error.message, true); }
  finally { button.disabled = false; }
}

async function changeAutomation(event) {
  const button = event.target.closest("[data-state]");
  if (!button) return;
  document.querySelectorAll("[data-state]").forEach((item) => { item.disabled = true; });
  try { await request("setAutomationState", { state: button.dataset.state }); await load(); showToast(`Automation ${button.dataset.state}.`); }
  catch (error) { renderAutomation(); showToast(error.message, true); }
}

$("#refresh").addEventListener("click", () => load());
$("#addRequirement").addEventListener("click", () => openRequirement());
$("#requirements").addEventListener("click", (event) => {
  const row = event.target.closest("[data-requirement]");
  if (row) openRequirement((app.snapshot.requirements || []).find((item) => item.id === row.dataset.requirement));
});
$("#requirementForm").addEventListener("submit", saveRequirement);
$("#archiveRequirement").addEventListener("click", archiveRequirement);
document.querySelector(".ops-control-actions").addEventListener("click", changeAutomation);

load();
app.timer = setInterval(() => load({ quiet: true }), 5000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) load({ quiet: true }); });
