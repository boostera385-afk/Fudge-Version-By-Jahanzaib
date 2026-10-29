"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Bot, ChevronDown, CirclePause, CirclePlay, Database, FileSpreadsheet, Filter, Plus, RefreshCw, Search, Square, Trash2, X } from "lucide-react";

type Snapshot = Record<string, any>;
type Requirement = Record<string, any>;

const LEGACY: Record<string, { headers: string[]; end: string }> = {
  Structure: { headers: ["Request ID", "Review Type", "Service Keyword", "City", "Review", "Picture Links", "Quality Check", "Status", "Review ID", "Business", "Updated At", "Numbers", "Rephrased Content"], end: "M" },
  Reviews: { headers: ["Review ID", "Fingerprint", "Service", "Subcategory", "City", "Business", "Place ID", "Review", "Review Type", "Original Picture Links", "Drive Picture Links", "Status", "Used At", "Request ID", "Source URL", "Collected At", "QC Note", "Website Copy", "Phone"], end: "S" },
  "Search Progress": { headers: ["Search Key", "Service Keyword", "City", "Query", "Page", "Next Business", "Exhausted", "Visited Place IDs", "Updated At"], end: "I" },
  Businesses: { headers: ["Place ID", "Service Keyword", "City", "Business", "Visited At", "Eligible Reviews"], end: "F" },
  Cities: { headers: ["City", "Status", "Last Used", "Exhausted Keywords", "Notes"], end: "E" },
  Services: { headers: ["Service Keyword", "Status", "Reviews Collected", "Notes", "Search Term", "Business Name Keywords", "Review Keywords", "Required Review Keywords", "Google Filter Keywords", "Exclude Keywords", "Service Family", "Subcategory", "Topic Filter Required", "Collect Family Reviews", "Rewrite Service Phrase", "Equivalent Service Phrases"], end: "P" },
  Names: { headers: ["Name", "Last Used"], end: "B" },
};

const TABS = ["Structure", "Reviews", "Requirements", "Search Progress", "Businesses", "Cities", "Services", "Names", "Jobs", "Workers", "Activity"];

const NORMALIZED_HEADERS: Record<string, string[]> = {
  Requirements: ["Name", "Service", "Status", "Required", "Backups", "Assigned", "Remaining", "Rejected", "Locations", "Photo Rule", "Keywords", "Priority", "Updated"],
  Jobs: ["Status", "Query", "City", "Current Page", "Businesses", "Reviews", "Error", "Updated"],
  Workers: ["Name", "Status", "Version", "Active Job", "Last Heartbeat", "Last Error"],
  Activity: ["Action", "Entity", "Entity ID", "Details", "Time"],
};

const letters = (index: number) => {
  let value = index + 1, result = "";
  while (value) { value -= 1; result = String.fromCharCode(65 + value % 26) + result; value = Math.floor(value / 26); }
  return result;
};

const text = (value: unknown) => value == null ? "" : String(value);
const dateLabel = (value: unknown) => {
  const date = new Date(text(value));
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
};

async function api(action: string, payload: Record<string, unknown> = {}): Promise<Snapshot> {
  const response = await fetch("/api/fudge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
  const result = (await response.json().catch(() => null)) as Snapshot | null;
  if (!response.ok || !result?.ok) throw new Error(result?.error || "The dashboard request failed.");
  return result;
}

function normalizedRows(tab: string, snapshot: Snapshot | null): string[][] {
  if (!snapshot) return [];
  if (tab === "Requirements") return (snapshot.requirements || []).map((item: Requirement) => {
    const wanted = Number(item.target_count || 0) + Number(item.backup_count || 0);
    return [item.name, item.services?.name, item.status, item.target_count, item.backup_count, item.assigned_count, Math.max(0, wanted - Number(item.assigned_count || 0)), item.rejected_count, (item.location_filters || []).join(" · "), item.requires_customer_photos ? "Customer photos required" : "Pictures optional", (item.search_keywords || []).map((keyword: any) => keyword.keyword).join(" · "), item.priority, dateLabel(item.updated_at)];
  });
  if (tab === "Jobs") return (snapshot.jobs || []).map((item: any) => [item.status, item.query, item.city, item.progress?.currentPage || 1, item.progress?.businessesVisited || 0, item.progress?.reviewsSaved || 0, item.error || "", dateLabel(item.updated_at)]);
  if (tab === "Workers") return (snapshot.extensions || []).map((item: any) => [item.name, item.status, item.version, item.active_job_id || "", dateLabel(item.last_heartbeat_at), item.last_error || ""]);
  if (tab === "Activity") return (snapshot.activity || []).map((item: any) => [item.action, item.entity_type, item.entity_id, JSON.stringify(item.details || {}), dateLabel(item.created_at)]);
  return [];
}

export default function FudgeWorkbook({ userName, canSignOut = false }: { userName: string; canSignOut?: boolean }) {
  const [active, setActive] = useState("Structure");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [legacyRows, setLegacyRows] = useState<Record<string, string[][]>>({});
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ row: number; col: number; value: string } | null>(null);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [requirement, setRequirement] = useState<Requirement | null | undefined>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const headers = LEGACY[active]?.headers || NORMALIZED_HEADERS[active] || [];
  const rows = LEGACY[active] ? (legacyRows[active] || []) : normalizedRows(active, snapshot);
  const filtered = useMemo(() => rows.map((row, index) => ({ row, index })).filter(({ row }) => !query || row.some((cell) => text(cell).toLowerCase().includes(query.toLowerCase()))), [rows, query]);
  const state = text(snapshot?.automation?.runState || snapshot?.automation?.state || "stopped").toLowerCase();

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3500);
  }, []);

  const loadSnapshot = useCallback(async (quiet = false) => {
    try {
      const result = await api("dashboardSnapshot");
      setSnapshot(result); setError("");
    } catch (err) { if (!quiet) setError(err instanceof Error ? err.message : "Unable to load Supabase."); }
  }, []);

  const loadSheet = useCallback(async (tab: string, quiet = false) => {
    if (!LEGACY[tab]) return;
    try {
      const result = await api("read", { ranges: [`'${tab}'!A2:${LEGACY[tab].end}`] });
      setLegacyRows((current) => ({ ...current, [tab]: result.values?.[0] || [] }));
      setError("");
    } catch (err) { if (!quiet) setError(err instanceof Error ? err.message : "Unable to load this sheet."); }
  }, []);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    await Promise.all([loadSnapshot(quiet), loadSheet(active, quiet)]);
    setLoading(false);
  }, [active, loadSheet, loadSnapshot]);

  useEffect(() => { setSelected(null); setEditing(null); setQuery(""); refresh(); }, [active, refresh]);
  useEffect(() => {
    const timer = setInterval(() => { if (!editing && requirement === undefined) refresh(true); }, 5000);
    return () => clearInterval(timer);
  }, [editing, requirement, refresh]);

  async function setAutomation(next: string) {
    try { await api("setAutomationState", { state: next }); await loadSnapshot(); notify(`Automation ${next}.`); }
    catch (err) { setError(err instanceof Error ? err.message : "State change failed."); }
  }

  async function saveCell(row: number, col: number, value: string) {
    const config = LEGACY[active];
    if (!config) return;
    const current = legacyRows[active] || [];
    const next = current.map((item) => [...item]);
    while (next[row].length < headers.length) next[row].push("");
    next[row][col] = value;
    setLegacyRows((all) => ({ ...all, [active]: next }));
    setEditing(null);
    try {
      const column = letters(col);
      await api("batchWrite", { updates: [{ range: `'${active}'!${column}${row + 2}:${column}${row + 2}`, values: [[value]] }] });
      notify("Saved to Supabase");
    } catch (err) { setError(err instanceof Error ? err.message : "Cell save failed."); await loadSheet(active); }
  }

  async function addRow() {
    if (active === "Requirements") { setRequirement(null); return; }
    if (!LEGACY[active]) return;
    try { await api("appendRows", { tab: active, rows: [Array(headers.length).fill("")] }); await loadSheet(active); setSelected(rows.length); notify("Row added"); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not add a row."); }
  }

  async function deleteRow() {
    if (selected == null) return;
    if (active === "Requirements") {
      const item = snapshot?.requirements?.[selected];
      if (item) setRequirement(item);
      return;
    }
    if (!LEGACY[active] || !confirm(`Delete row ${selected + 1} from ${active}?`)) return;
    try { await api("deleteRow", { tab: active, rowNumber: selected + 2 }); setSelected(null); await loadSheet(active); notify("Row deleted"); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not delete the row."); }
  }

  const selectedValue = selected == null ? "" : rows[selected]?.join("  |  ") || "";

  return (
    <main className="workbook-shell">
      <header className="topbar">
        <div className="brand-mark">F</div>
        <div className="workbook-title"><strong>Fudge Operations</strong><span><Database size={13} /> Supabase live · All changes saved automatically</span></div>
        <div className="topbar-actions">
          <div className={`live-pill live-pill--${state}`}><i />{state}</div>
          <button className="avatar" title={userName}>{userName.slice(0, 1).toUpperCase()}</button>
        </div>
      </header>

      <section className="menubar">
        <button>File</button><button>Edit</button><button>View</button><button>Insert</button><button>Data</button><button>Tools</button>
        <span />
        <button className="icon-button" onClick={() => refresh()} aria-label="Refresh"><RefreshCw size={16} className={loading ? "spin" : ""} /></button>
      </section>

      <section className="toolbar">
        <div className="automation-group">
          <button className={state === "running" ? "active" : ""} onClick={() => setAutomation("running")}><CirclePlay size={16} /> Start</button>
          <button className={state === "paused" ? "active" : ""} onClick={() => setAutomation("paused")}><CirclePause size={16} /> Pause</button>
          <button className={state === "stopped" ? "active danger" : "danger"} onClick={() => setAutomation("stopped")}><Square size={14} /> Stop</button>
        </div>
        <div className="toolbar-separator" />
        <button onClick={addRow} disabled={!LEGACY[active] && active !== "Requirements"}><Plus size={16} /> Add row</button>
        <button onClick={deleteRow} disabled={selected == null || (!LEGACY[active] && active !== "Requirements")}><Trash2 size={15} /> {active === "Requirements" ? "Edit" : "Delete"}</button>
        <div className="toolbar-separator" />
        <label className="sheet-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${active}`} /><Filter size={14} /></label>
      </section>

      <section className="formula-bar">
        <span className="cell-name">{selected == null ? "—" : `A${selected + 2}`}</span><span className="fx">fx</span><input value={selectedValue} readOnly placeholder="Select a row to inspect its values" />
      </section>

      <div className="error-slot">{error && <div className="error-banner"><span>{error}</span><button onClick={() => setError("")}><X size={15} /></button></div>}</div>

      <section className="grid-wrap">
        <table className="sheet-grid">
          <thead><tr><th className="corner"></th>{headers.map((header, col) => <th key={header} title={header}><span className="column-letter">{letters(col)}</span><strong>{header}</strong></th>)}</tr></thead>
          <tbody>
            {filtered.map(({ row, index }) => <tr key={index} className={selected === index ? "selected" : ""} onClick={() => setSelected(index)} onDoubleClick={() => active === "Requirements" && setRequirement(snapshot?.requirements?.[index])}>
              <th>{index + 2}</th>
              {headers.map((_, col) => {
                const value = text(row[col]);
                const links = value.split(/\r?\n|\|/).map((item) => item.trim()).filter((item) => /^https:\/\//i.test(item));
                return <td key={col} className={editing?.row === index && editing?.col === col ? "editing" : ""} onDoubleClick={(event) => { if (!LEGACY[active]) return; event.stopPropagation(); setEditing({ row: index, col, value }); }}>
                  {editing?.row === index && editing?.col === col ? <input autoFocus defaultValue={editing.value} onBlur={(event) => saveCell(index, col, event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") setEditing(null); }} /> : links.length ? <div className="cell-links">{links.map((link, linkIndex) => <a key={link} href={link} target="_blank" rel="noreferrer">{link.includes("drive.google.com/file/d/") ? `Drive image ${linkIndex + 1}` : `Open link ${linkIndex + 1}`}</a>)}</div> : <span>{value || ""}</span>}
                </td>;
              })}
            </tr>)}
            {!filtered.length && !loading && <tr><td colSpan={headers.length + 1} className="empty-grid">No rows in {active} yet. Use Add row to begin.</td></tr>}
          </tbody>
        </table>
      </section>

      <footer className="sheet-tabs">
        <button className="all-sheets"><FileSpreadsheet size={16} /></button>
        <div className="tabs-scroll">{TABS.map((tab) => <button key={tab} className={active === tab ? "active" : ""} onClick={() => setActive(tab)}>{tab === "Workers" ? <Bot size={14} /> : tab === "Activity" ? <Activity size={14} /> : null}{tab}</button>)}</div>
        <div className="sheet-count">{filtered.length.toLocaleString()} rows <ChevronDown size={13} /></div>
      </footer>

      {requirement !== undefined && <RequirementDialog item={requirement} onClose={() => setRequirement(undefined)} onSaved={async () => { setRequirement(undefined); await loadSnapshot(); notify("Requirement saved"); }} />}
      {toast && <div className="save-toast">{toast}</div>}
    </main>
  );
}

function RequirementDialog({ item, onClose, onSaved }: { item: Requirement | null; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const data = new FormData(event.currentTarget);
    try {
      await api("saveRequirement", { requirement: { id: item?.id || "", name: data.get("name"), serviceName: data.get("serviceName"), keywords: data.get("keywords"), targetCount: Number(data.get("targetCount")), backupCount: Number(data.get("backupCount")), priority: Number(data.get("priority")), status: data.get("status"), locationFilters: data.get("locations"), requiresCustomerPhotos: data.get("photos") === "on" } });
      onSaved();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Save failed."); setBusy(false); }
  }
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="requirement-modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
    <header><div><span>Service requirement</span><h2>{item ? "Edit requirement" : "Add requirement"}</h2></div><button type="button" onClick={onClose}><X size={18} /></button></header>
    <div className="modal-grid">
      <label><span>Requirement name</span><input name="name" required defaultValue={item?.name || ""} placeholder="Dallas plumbing photo reviews" /></label>
      <label><span>Service</span><input name="serviceName" required defaultValue={item?.services?.name || ""} placeholder="Plumbing" /></label>
      <label className="wide"><span>Search keywords · one per line</span><textarea name="keywords" rows={4} required defaultValue={(item?.search_keywords || []).map((keyword: any) => keyword.keyword).join("\n")} /></label>
      <label><span>Required reviews</span><input name="targetCount" type="number" min="0" required defaultValue={item?.target_count ?? 1} /></label>
      <label><span>Backup reviews</span><input name="backupCount" type="number" min="0" required defaultValue={item?.backup_count ?? 2} /></label>
      <label><span>Priority</span><input name="priority" type="number" min="1" defaultValue={item?.priority ?? 100} /></label>
      <label><span>Status</span><select name="status" defaultValue={item?.status || "active"}><option value="active">Active</option><option value="paused">Paused</option><option value="completed">Completed</option></select></label>
      <label className="wide"><span>Locations · comma or one per line</span><textarea name="locations" rows={3} defaultValue={(item?.location_filters || []).join("\n")} /></label>
      <label className="check wide"><input name="photos" type="checkbox" defaultChecked={Boolean(item?.requires_customer_photos)} /><span>Only reviews with customer photos are eligible</span></label>
    </div>
    {message && <p className="modal-error">{message}</p>}
    <footer><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy ? "Saving…" : "Save requirement"}</button></footer>
  </form></div>;
}
