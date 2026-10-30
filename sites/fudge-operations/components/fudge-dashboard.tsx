"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertTriangle, Bot, CheckCircle2, CirclePause, CirclePlay, Clock, Database, FileSpreadsheet,
  ListChecks, LogOut, Pencil, Plus, RefreshCw, Search, Square, Trash2, TriangleAlert, X,
} from "lucide-react";

type Service = { name?: string | null };
type Keyword = { keyword?: string | null };

type Requirement = {
  id: string; name?: string | null; status?: string | null;
  target_count?: number; backup_count?: number; assigned_count?: number;
  rejected_count?: number; collected_count?: number; priority?: number;
  location_filters?: string[]; requires_customer_photos?: boolean; updated_at?: string;
  services?: Service | null; search_keywords?: Keyword[];
};

type Job = {
  id: string; status?: string | null; query?: string | null; city?: string | null;
  extension_id?: string | null; error?: string | null; updated_at?: string;
  progress?: { currentPage?: number; businessesVisited?: number; reviewsSaved?: number } | null;
};

type Worker = {
  id: string; name?: string | null; status?: string | null; version?: string | null;
  active_job_id?: string | null; last_heartbeat_at?: string | null; last_error?: string | null;
};

type ActivityRow = {
  id: number; action?: string | null; entity_type?: string | null;
  entity_id?: string | null; details?: unknown; created_at?: string;
};

type Snapshot = {
  automation?: Record<string, unknown>;
  requirements?: Requirement[];
  jobs?: Job[];
  extensions?: Worker[];
  activity?: ActivityRow[];
  reviewCount?: number;
  metrics?: Record<string, number>;
};

// Tables still stored as sheet-shaped rows. The dashboard reads them as plain
// records; only these need the A1 range the backend still speaks.
const DATA_TABLES: Record<string, { headers: string[]; end: string }> = {
  Structure: { headers: ["Request ID", "Review Type", "Service Keyword", "City", "Review", "Picture Links", "Quality Check", "Status", "Review ID", "Business", "Updated At", "Numbers", "Rephrased Content"], end: "M" },
  Reviews: { headers: ["Review ID", "Fingerprint", "Service", "Subcategory", "City", "Business", "Place ID", "Review", "Review Type", "Original Picture Links", "Drive Picture Links", "Status", "Used At", "Request ID", "Source URL", "Collected At", "QC Note", "Website Copy", "Phone"], end: "S" },
  "Search Progress": { headers: ["Search Key", "Service Keyword", "City", "Query", "Page", "Next Business", "Exhausted", "Visited Place IDs", "Updated At"], end: "I" },
  Businesses: { headers: ["Place ID", "Service Keyword", "City", "Business", "Visited At", "Eligible Reviews"], end: "F" },
  Cities: { headers: ["City", "Status", "Last Used", "Exhausted Keywords", "Notes"], end: "E" },
  Services: { headers: ["Service Keyword", "Status", "Reviews Collected", "Notes", "Search Term", "Business Name Keywords", "Review Keywords", "Required Review Keywords", "Google Filter Keywords", "Exclude Keywords", "Service Family", "Subcategory", "Topic Filter Required", "Collect Family Reviews", "Rewrite Service Phrase", "Equivalent Service Phrases"], end: "P" },
  Names: { headers: ["Name", "Last Used"], end: "B" },
};

const NAV: { group: string; items: { id: string; label: string; icon?: React.ReactNode }[] }[] = [
  {
    group: "Operations",
    items: [
      { id: "Overview", label: "Overview", icon: <Activity size={15} /> },
      { id: "Requirements", label: "Requirements", icon: <ListChecks size={15} /> },
      { id: "Jobs", label: "Search jobs", icon: <Clock size={15} /> },
      { id: "Workers", label: "Workers", icon: <Bot size={15} /> },
      { id: "Activity", label: "Activity", icon: <Activity size={15} /> },
    ],
  },
  { group: "Collected data", items: Object.keys(DATA_TABLES).map((id) => ({ id, label: id })) },
];

const PAGE_SIZE = 50;

const text = (value: unknown) => (value == null ? "" : String(value));
const num = (value: unknown) => Number(value) || 0;

const dateLabel = (value: unknown) => {
  const date = new Date(text(value));
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
};

const relative = (value: unknown) => {
  const date = new Date(text(value));
  if (Number.isNaN(date.getTime())) return "—";
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${Math.max(0, seconds)}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
};

type ApiResult = Snapshot & { ok?: boolean; error?: string; values?: string[][][] };

async function api(action: string, payload: Record<string, unknown> = {}): Promise<ApiResult> {
  const response = await fetch("/api/fudge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  if (response.status === 401) {
    // /signin is served by the Worker, ahead of Next, so the router cannot reach
    // it; a full document load is the only way there.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/signin?return_to=" + encodeURIComponent(window.location.pathname);
    throw new Error("Your session expired. Signing you back in…");
  }
  const result = (await response.json().catch(() => null)) as ApiResult | null;
  if (!response.ok || !result?.ok) throw new Error(result?.error || "The dashboard request failed.");
  return result;
}

function Badge({ value, tone }: { value: string; tone?: string }) {
  const key = (tone || value || "").toLowerCase();
  return <span className={`badge badge--${key}`}>{value || "—"}</span>;
}

/** Renders https:// values in a cell as links instead of raw text. */
function CellValue({ value }: { value: string }) {
  const links = value.split(/\r?\n|\|/).map((item) => item.trim()).filter((item) => /^https:\/\//i.test(item));
  if (!links.length) return <span title={value}>{value}</span>;
  return (
    <span className="cell-links">
      {links.map((link, index) => (
        <a key={link} href={link} target="_blank" rel="noreferrer">
          {link.includes("drive.google.com/file/d/") ? `Image ${index + 1}` : `Link ${index + 1}`}
        </a>
      ))}
    </span>
  );
}

export default function FudgeDashboard({ userName, canSignOut = false }: { userName: string; canSignOut?: boolean }) {
  const [section, setSection] = useState("Overview");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [tableRows, setTableRows] = useState<Record<string, string[][]>>({});
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ key: string; direction: 1 | -1 } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [editing, setEditing] = useState<{ row: number; col: number } | null>(null);
  const [requirement, setRequirement] = useState<Requirement | null | undefined>(undefined);
  const [confirming, setConfirming] = useState<{ title: string; body: string; action: () => Promise<void> } | null>(null);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const automation = snapshot?.automation || {};
  const state = text(automation.runState || automation.state || "stopped").toLowerCase();
  const isDataTable = Boolean(DATA_TABLES[section]);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3200);
  }, []);

  const loadSnapshot = useCallback(async (quiet = false) => {
    try {
      setSnapshot(await api("dashboardSnapshot"));
      setError("");
    } catch (err) {
      if (!quiet) setError(err instanceof Error ? err.message : "Unable to reach Supabase.");
    }
  }, []);

  const loadTable = useCallback(async (tab: string, quiet = false) => {
    const config = DATA_TABLES[tab];
    if (!config) return;
    try {
      const result = await api("read", { ranges: [`'${tab}'!A2:${config.end}`] });
      setTableRows((current) => ({ ...current, [tab]: result.values?.[0] || [] }));
      setError("");
    } catch (err) {
      if (!quiet) setError(err instanceof Error ? err.message : `Unable to load ${tab}.`);
    }
  }, []);

  const refresh = useCallback(async (quiet = false) => {
    await Promise.all([loadSnapshot(quiet), loadTable(section, quiet)]);
    setLoading(false);
  }, [section, loadSnapshot, loadTable]);

  // Switching sections resets the view state here, in the handler, rather than in
  // an effect reacting to the change.
  function goToSection(next: string) {
    if (next === section) return;
    setSection(next);
    setQuery("");
    setPage(0);
    setSort(null);
    setEditing(null);
    setLoading(true);
  }

  useEffect(() => {
    let active = true;
    (async () => {
      // Both loaders report their own failures, so this settles either way.
      await Promise.all([loadSnapshot(), loadTable(section)]);
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [section, loadSnapshot, loadTable]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!editing && requirement === undefined && !confirming) refresh(true);
    }, 5000);
    return () => clearInterval(timer);
  }, [editing, requirement, confirming, refresh]);

  async function setAutomation(next: string) {
    setBusy(next);
    try {
      await api("setAutomationState", { state: next });
      await loadSnapshot();
      notify(next === "running" ? "Collection started." : next === "paused" ? "Collection paused." : "Collection stopped.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the automation state.");
    } finally {
      setBusy("");
    }
  }

  async function saveCell(rowIndex: number, col: number, value: string) {
    const config = DATA_TABLES[section];
    if (!config) return;
    const current = tableRows[section] || [];
    const next = current.map((item) => [...item]);
    while (next[rowIndex].length < config.headers.length) next[rowIndex].push("");
    if (next[rowIndex][col] === value) { setEditing(null); return; }
    next[rowIndex][col] = value;
    setTableRows((all) => ({ ...all, [section]: next }));
    setEditing(null);
    try {
      const letter = String.fromCharCode(65 + col);
      await api("batchWrite", { updates: [{ range: `'${section}'!${letter}${rowIndex + 2}:${letter}${rowIndex + 2}`, values: [[value]] }] });
      notify("Saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that change.");
      await loadTable(section);
    }
  }

  function removeRow(rowIndex: number) {
    setConfirming({
      title: `Delete row ${rowIndex + 1}?`,
      body: `This removes the row from ${section} in Supabase. It cannot be undone.`,
      action: async () => {
        await api("deleteRow", { tab: section, rowNumber: rowIndex + 2 });
        await loadTable(section);
        notify("Row deleted");
      },
    });
  }

  function archiveRequirement(item: Requirement) {
    setConfirming({
      title: "Archive this requirement?",
      body: `“${text(item.name)}” stops being queued and its pending jobs are cancelled.`,
      action: async () => {
        await api("deleteRequirement", { id: item.id });
        await loadSnapshot();
        notify("Requirement archived");
      },
    });
  }

  async function addDataRow() {
    const config = DATA_TABLES[section];
    if (!config) return;
    try {
      await api("appendRows", { tab: section, rows: [Array(config.headers.length).fill("")] });
      await loadTable(section);
      notify("Row added");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add a row.");
    }
  }

  // One search box over whatever the active section shows.
  const matches = useCallback((haystack: string) => !query || haystack.toLowerCase().includes(query.toLowerCase()), [query]);

  const requirements = useMemo(() => {
    const list = (snapshot?.requirements || []).filter((item) =>
      matches([item.name, item.services?.name, item.status, (item.location_filters || []).join(" "), (item.search_keywords || []).map((k) => k.keyword).join(" ")].map(text).join(" ")));
    if (!sort) return list;
    const pick = (item: Requirement): string | number => {
      if (sort.key === "name") return text(item.name).toLowerCase();
      if (sort.key === "service") return text(item.services?.name).toLowerCase();
      if (sort.key === "status") return text(item.status);
      if (sort.key === "needed") return num(item.target_count) + num(item.backup_count);
      if (sort.key === "assigned") return num(item.assigned_count);
      if (sort.key === "priority") return num(item.priority);
      return text(item.updated_at);
    };
    return [...list].sort((a, b) => (pick(a) > pick(b) ? sort.direction : pick(a) < pick(b) ? -sort.direction : 0));
  }, [snapshot, matches, sort]);

  const jobs = useMemo(() => (snapshot?.jobs || []).filter((item) =>
    matches([item.query, item.city, item.status, item.error].map(text).join(" "))), [snapshot, matches]);

  const workers = useMemo(() => (snapshot?.extensions || []).filter((item) =>
    matches([item.name, item.status, item.version].map(text).join(" "))), [snapshot, matches]);

  const activity = useMemo(() => (snapshot?.activity || []).filter((item) =>
    matches([item.action, item.entity_type].map(text).join(" "))), [snapshot, matches]);

  const dataRows = useMemo(() => {
    if (!isDataTable) return [];
    return (tableRows[section] || [])
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => matches(row.join(" ")));
  }, [isDataTable, tableRows, section, matches]);

  const total = section === "Requirements" ? requirements.length
    : section === "Jobs" ? jobs.length
    : section === "Workers" ? workers.length
    : section === "Activity" ? activity.length
    : isDataTable ? dataRows.length : 0;

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = Math.min(page, pageCount - 1) * PAGE_SIZE;
  const slice = <T,>(list: T[]) => list.slice(start, start + PAGE_SIZE);

  const sortable = (key: string, label: string) => (
    <th key={key} className="sortable" onClick={() => setSort((current) => ({ key, direction: current?.key === key && current.direction === 1 ? -1 : 1 }))}>
      {label}{sort?.key === key ? <span className="sort-arrow">{sort.direction === 1 ? "↑" : "↓"}</span> : null}
    </th>
  );

  const metrics = snapshot?.metrics || {};
  const workersOnline = (snapshot?.extensions || []).filter((item) => text(item.status) === "online").length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">F</span><span className="brand-text"><strong>Fudge Operations</strong><small><Database size={11} /> Supabase · live</small></span></div>

        <div className="automation">
          <span className={`state-dot state-dot--${state}`} />
          <span className="state-label">{state}</span>
          <div className="automation-buttons">
            <button className={state === "running" ? "on" : ""} disabled={Boolean(busy)} onClick={() => setAutomation("running")}><CirclePlay size={15} /> Start</button>
            <button className={state === "paused" ? "on" : ""} disabled={Boolean(busy)} onClick={() => setAutomation("paused")}><CirclePause size={15} /> Pause</button>
            <button className={state === "stopped" ? "on danger" : "danger"} disabled={Boolean(busy)} onClick={() => setAutomation("stopped")}><Square size={13} /> Stop</button>
          </div>
        </div>

        <div className="topbar-right">
          <button className="ghost" onClick={() => { setLoading(true); refresh(); }} title="Refresh"><RefreshCw size={15} className={loading ? "spin" : ""} /> Refresh</button>
          {canSignOut ? (
            <form className="signout" method="post" action="/signout">
              <button type="submit" title="Sign out"><LogOut size={14} /> Sign out</button>
            </form>
          ) : null}
          <span className="avatar" title={userName}>{userName.slice(0, 1).toUpperCase()}</span>
        </div>
      </header>

      <div className="body">
        <nav className="sidebar">
          {NAV.map((group) => (
            <div className="nav-group" key={group.group}>
              <p>{group.group}</p>
              {group.items.map((item) => (
                <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => goToSection(item.id)}>
                  {item.icon || <FileSpreadsheet size={15} />}<span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <main className="content">
          {error ? (
            <div className="banner banner--error">
              <TriangleAlert size={16} /><span>{error}</span>
              <button onClick={() => setError("")} aria-label="Dismiss"><X size={15} /></button>
            </div>
          ) : null}

          {section === "Overview" ? (
            <Overview
              metrics={metrics}
              reviewCount={num(snapshot?.reviewCount)}
              requirementCount={(snapshot?.requirements || []).length}
              workers={snapshot?.extensions || []}
              workersOnline={workersOnline}
              activity={(snapshot?.activity || []).slice(0, 8)}
              state={state}
              onGo={goToSection}
            />
          ) : (
            <>
              <div className="section-head">
                <div>
                  <h1>{section === "Jobs" ? "Search jobs" : section}</h1>
                  <p>
                    {total.toLocaleString()} {total === 1 ? "row" : "rows"}{query ? " matching" : ""}
                    {section === "Jobs" && !query && num(metrics.pendingJobs) + num(metrics.activeJobs) + num(metrics.completedJobs) + num(metrics.failedJobs) > jobs.length
                      ? " · the 100 most recent" : ""}
                  </p>
                </div>
                <label className="search">
                  <Search size={15} />
                  <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder={`Search ${section}`} />
                  {query ? <button onClick={() => setQuery("")} aria-label="Clear search"><X size={14} /></button> : null}
                </label>
                {section === "Requirements" ? <button className="primary" onClick={() => setRequirement(null)}><Plus size={15} /> New requirement</button> : null}
                {isDataTable ? <button className="primary" onClick={addDataRow}><Plus size={15} /> Add row</button> : null}
              </div>

              <div className="table-wrap">
                {section === "Requirements" ? (
                  <table>
                    <thead><tr>
                      {sortable("name", "Requirement")}{sortable("service", "Service")}{sortable("status", "Status")}
                      {sortable("needed", "Needed")}{sortable("assigned", "Assigned")}<th>Remaining</th>
                      <th>Photos</th><th>Locations</th>{sortable("priority", "Priority")}<th>Updated</th><th className="actions-col" />
                    </tr></thead>
                    <tbody>
                      {slice(requirements).map((item) => {
                        const wanted = num(item.target_count) + num(item.backup_count);
                        const remaining = Math.max(0, wanted - num(item.assigned_count));
                        return (
                          <tr key={item.id}>
                            <td className="strong">{text(item.name)}</td>
                            <td>{text(item.services?.name) || "—"}</td>
                            <td><Badge value={text(item.status)} /></td>
                            <td className="number">{wanted}</td>
                            <td className="number">{num(item.assigned_count)}</td>
                            <td className="number">{remaining ? <span className="warn-text">{remaining}</span> : <CheckCircle2 size={14} className="ok-icon" />}</td>
                            <td>{item.requires_customer_photos ? "Required" : "Optional"}</td>
                            <td>{(item.location_filters || []).join(", ") || "Any"}</td>
                            <td className="number">{num(item.priority)}</td>
                            <td className="muted">{relative(item.updated_at)}</td>
                            <td className="actions">
                              <button onClick={() => setRequirement(item)} title="Edit"><Pencil size={14} /></button>
                              <button onClick={() => archiveRequirement(item)} title="Archive"><Trash2 size={14} /></button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : section === "Jobs" ? (
                  <table>
                    <thead><tr><th>Status</th><th>Query</th><th>City</th><th>Page</th><th>Businesses</th><th>Reviews</th><th>Worker</th><th>Error</th><th>Updated</th></tr></thead>
                    <tbody>
                      {slice(jobs).map((item) => (
                        <tr key={item.id}>
                          <td><Badge value={text(item.status)} /></td>
                          <td className="strong">{text(item.query)}</td>
                          <td>{text(item.city) || "Any"}</td>
                          <td className="number">{num(item.progress?.currentPage) || 1}</td>
                          <td className="number">{num(item.progress?.businessesVisited)}</td>
                          <td className="number">{num(item.progress?.reviewsSaved)}</td>
                          <td>{item.extension_id ? "Claimed" : <span className="muted">Unclaimed</span>}</td>
                          <td className="error-cell">{text(item.error)}</td>
                          <td className="muted">{relative(item.updated_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : section === "Workers" ? (
                  <table>
                    <thead><tr><th>Worker</th><th>Status</th><th>Version</th><th>Active job</th><th>Last heartbeat</th><th>Last error</th></tr></thead>
                    <tbody>
                      {slice(workers).map((item) => (
                        <tr key={item.id}>
                          <td className="strong"><Bot size={14} /> {text(item.name)}</td>
                          <td><Badge value={text(item.status)} /></td>
                          <td>{text(item.version) || "—"}</td>
                          <td>{item.active_job_id ? "Running a job" : <span className="muted">Idle</span>}</td>
                          <td className="muted" title={dateLabel(item.last_heartbeat_at)}>{relative(item.last_heartbeat_at)}</td>
                          <td className="error-cell">{text(item.last_error)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : section === "Activity" ? (
                  <table>
                    <thead><tr><th>Action</th><th>Entity</th><th>Details</th><th>When</th></tr></thead>
                    <tbody>
                      {slice(activity).map((item) => (
                        <tr key={item.id}>
                          <td className="strong">{text(item.action)}</td>
                          <td>{text(item.entity_type)}</td>
                          <td className="muted">{item.details && Object.keys(item.details).length ? JSON.stringify(item.details) : "—"}</td>
                          <td className="muted" title={dateLabel(item.created_at)}>{relative(item.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table>
                    <thead><tr>
                      <th className="row-num">#</th>
                      {DATA_TABLES[section].headers.map((header) => <th key={header}>{header}</th>)}
                      <th className="actions-col" />
                    </tr></thead>
                    <tbody>
                      {slice(dataRows).map(({ row, index }) => (
                        <tr key={index}>
                          <td className="row-num">{index + 1}</td>
                          {DATA_TABLES[section].headers.map((header, col) => {
                            const value = text(row[col]);
                            const active = editing?.row === index && editing?.col === col;
                            return (
                              <td key={header} className={active ? "editing" : "editable"} onClick={() => !active && setEditing({ row: index, col })}>
                                {active ? (
                                  <input
                                    autoFocus
                                    defaultValue={value}
                                    onBlur={(event) => saveCell(index, col, event.target.value)}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") event.currentTarget.blur();
                                      if (event.key === "Escape") setEditing(null);
                                    }}
                                  />
                                ) : <CellValue value={value} />}
                              </td>
                            );
                          })}
                          <td className="actions"><button onClick={() => removeRow(index)} title="Delete row"><Trash2 size={14} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {!total && !loading ? (
                  <div className="empty">
                    <FileSpreadsheet size={22} />
                    <p>{query ? `Nothing in ${section} matches “${query}”.` : `No rows in ${section} yet.`}</p>
                  </div>
                ) : null}
              </div>

              {pageCount > 1 ? (
                <div className="pager">
                  <span>Showing {(start + 1).toLocaleString()}–{Math.min(start + PAGE_SIZE, total).toLocaleString()} of {total.toLocaleString()}</span>
                  <div>
                    <button disabled={page <= 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous</button>
                    <span className="page-of">Page {Math.min(page, pageCount - 1) + 1} of {pageCount}</span>
                    <button disabled={page >= pageCount - 1} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}>Next</button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </main>
      </div>

      {requirement !== undefined ? (
        <RequirementDialog
          item={requirement}
          onClose={() => setRequirement(undefined)}
          onSaved={async () => { setRequirement(undefined); await loadSnapshot(); notify("Requirement saved"); }}
        />
      ) : null}

      {confirming ? (
        <ConfirmDialog
          {...confirming}
          onClose={() => setConfirming(null)}
          onError={(message) => { setConfirming(null); setError(message); }}
        />
      ) : null}

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}

function Overview({ metrics, reviewCount, requirementCount, workers, workersOnline, activity, state, onGo }: {
  metrics: Record<string, number>; reviewCount: number; requirementCount: number;
  workers: Worker[]; workersOnline: number; activity: ActivityRow[]; state: string;
  onGo: (section: string) => void;
}) {
  const pending = num(metrics.pendingJobs);
  const active = num(metrics.activeJobs);
  const stalled = state === "running" && pending > 0 && active === 0 && !workersOnline;

  const cards = [
    { label: "Reviews collected", value: reviewCount, go: "Reviews" },
    { label: "Active requirements", value: requirementCount, go: "Requirements" },
    { label: "Jobs waiting", value: pending, go: "Jobs", warn: pending > 0 && !active },
    { label: "Jobs running", value: active, go: "Jobs" },
    { label: "Completed", value: num(metrics.completedJobs), go: "Jobs" },
    { label: "Failed", value: num(metrics.failedJobs), go: "Jobs", warn: num(metrics.failedJobs) > 0 },
    { label: "Workers online", value: workersOnline, go: "Workers", warn: !workersOnline },
  ];

  return (
    <div className="overview">
      {stalled ? (
        <div className="banner banner--warn">
          <AlertTriangle size={16} />
          <span>
            Collection is set to <strong>running</strong> and {pending.toLocaleString()} jobs are waiting, but no worker is online.
            Open the Fudge extension in Chrome so it can pick the queue up.
          </span>
        </div>
      ) : null}

      <div className="cards">
        {cards.map((card) => (
          <button key={card.label} className={`card${card.warn ? " card--warn" : ""}`} onClick={() => onGo(card.go)}>
            <span className="card-value">{card.value.toLocaleString()}</span>
            <span className="card-label">{card.label}</span>
          </button>
        ))}
      </div>

      <div className="overview-split">
        <section className="panel">
          <header><h2>Workers</h2><button onClick={() => onGo("Workers")}>View all</button></header>
          {workers.length ? (
            <ul className="worker-list">
              {workers.map((worker) => (
                <li key={worker.id}>
                  <Bot size={15} />
                  <span className="strong">{text(worker.name)}</span>
                  <Badge value={text(worker.status)} />
                  <span className="muted">{relative(worker.last_heartbeat_at)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="panel-empty">No Fudge extension has registered with this workspace yet.</p>}
        </section>

        <section className="panel">
          <header><h2>Recent activity</h2><button onClick={() => onGo("Activity")}>View all</button></header>
          {activity.length ? (
            <ul className="activity-list">
              {activity.map((item) => (
                <li key={item.id}>
                  <span className="strong">{text(item.action)}</span>
                  <span className="muted">{relative(item.created_at)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="panel-empty">Nothing has happened yet.</p>}
        </section>
      </div>
    </div>
  );
}

function ConfirmDialog({ title, body, action, onClose, onError }: {
  title: string; body: string; action: () => Promise<void>; onClose: () => void; onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try { await action(); onClose(); }
    catch (error) { onError(error instanceof Error ? error.message : "That did not work."); }
  }
  return (
    <div className="backdrop" onMouseDown={onClose}>
      <div className="dialog dialog--small" onMouseDown={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        <p>{body}</p>
        <footer>
          <button onClick={onClose} disabled={busy}>Cancel</button>
          <button className="danger" onClick={run} disabled={busy}>{busy ? "Working…" : "Confirm"}</button>
        </footer>
      </div>
    </div>
  );
}

function RequirementDialog({ item, onClose, onSaved }: { item: Requirement | null; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const data = new FormData(event.currentTarget);
    try {
      await api("saveRequirement", {
        requirement: {
          id: item?.id || "",
          name: data.get("name"),
          serviceName: data.get("serviceName"),
          keywords: data.get("keywords"),
          targetCount: Number(data.get("targetCount")),
          backupCount: Number(data.get("backupCount")),
          priority: Number(data.get("priority")),
          status: data.get("status"),
          locationFilters: data.get("locations"),
          requiresCustomerPhotos: data.get("photos") === "on",
        },
      });
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed.");
      setBusy(false);
    }
  }

  return (
    <div className="backdrop" onMouseDown={onClose}>
      <form className="dialog" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><small>Service requirement</small><h2>{item ? "Edit requirement" : "New requirement"}</h2></div>
          <button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="dialog-grid">
          <label><span>Requirement name</span><input name="name" required defaultValue={text(item?.name)} placeholder="Dallas plumbing photo reviews" /></label>
          <label><span>Service</span><input name="serviceName" required defaultValue={text(item?.services?.name)} placeholder="Plumbing" /></label>
          <label className="wide"><span>Search keywords · one per line</span><textarea name="keywords" rows={4} required defaultValue={(item?.search_keywords || []).map((keyword) => text(keyword.keyword)).join("\n")} /></label>
          <label><span>Required reviews</span><input name="targetCount" type="number" min="0" required defaultValue={item?.target_count ?? 1} /></label>
          <label><span>Backup reviews</span><input name="backupCount" type="number" min="0" required defaultValue={item?.backup_count ?? 2} /></label>
          <label><span>Priority</span><input name="priority" type="number" min="1" defaultValue={item?.priority ?? 100} /></label>
          <label><span>Status</span><select name="status" defaultValue={text(item?.status) || "active"}><option value="active">Active</option><option value="paused">Paused</option><option value="completed">Completed</option></select></label>
          <label className="wide"><span>Locations · one per line</span><textarea name="locations" rows={3} defaultValue={(item?.location_filters || []).join("\n")} /></label>
          <label className="check wide"><input name="photos" type="checkbox" defaultChecked={Boolean(item?.requires_customer_photos)} /><span>Only reviews with customer photos are eligible</span></label>
        </div>
        {message ? <p className="dialog-error">{message}</p> : null}
        <footer>
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy}>{busy ? "Saving…" : "Save requirement"}</button>
        </footer>
      </form>
    </div>
  );
}
