// ABOUTME: Trace explorer page modeled after Datadog APM trace view.
// ABOUTME: Table-based trace list with status dots, service colors, waterfall span detail, and tag inspector.
"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { JaegerTrace, JaegerSpan } from "@/types";
import styles from "./page.module.css";

// --- Constants ---

const SERVICE_COLORS: Record<string, string> = {
  "mcp-proxy": "#60a5fa",
  "mcp-server": "#34d399",
  agent: "#a78bfa",
  "jaeger-all-in-one": "#6b7280",
};

const DEFAULT_SERVICE_COLOR = "#9aa0b0";

function serviceColor(name: string): string {
  return SERVICE_COLORS[name] ?? DEFAULT_SERVICE_COLOR;
}

type TraceType =
  | "tool_call"
  | "denied"
  | "connection"
  | "cache"
  | "mcp_message"
  | "other";

interface ClassifiedTrace {
  trace: JaegerTrace;
  type: TraceType;
  toolName: string | null;
  toolCategory: string | null;
  policyDecision: string | null;
  mcpMethod: string | null;
  duration: number;
  startTime: number;
  rootService: string;
  spanCount: number;
  serviceSet: string[];
  hasError: boolean;
}

type FilterType = "all" | "tool_call" | "denied" | "connection";
type SortField = "time" | "duration" | "service";
type SortDir = "asc" | "desc";

// --- Helpers ---

function getSpanTag(span: JaegerSpan, key: string): string | null {
  const tag = span.tags.find((t) => t.key === key);
  return tag ? String(tag.value) : null;
}

function formatDuration(us: number): string {
  if (us < 1000) return `${us}\u00B5s`;
  if (us < 1_000_000) return `${(us / 1000).toFixed(1)}ms`;
  return `${(us / 1_000_000).toFixed(2)}s`;
}

function formatRelativeTime(us: number): string {
  const diffSec = Math.floor((Date.now() - us / 1000) / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

function formatTimestamp(us: number): string {
  return new Date(us / 1000).toLocaleString();
}

// --- Noise filtering ---

const NOISE_OPS = new Set([
  "GET /metrics",
  "GET /health",
  "GET /api/traces",
  "/metrics",
  "/health",
  "/api/traces",
]);

function isNoiseTrace(trace: JaegerTrace): boolean {
  return trace.spans.every((s) => {
    const op = s.operationName;
    if (NOISE_OPS.has(op)) return true;
    if (op === "http send" || op === "http receive") return true;
    if (/^GET\s+\/(metrics|health|api\/traces)/.test(op)) return true;
    return false;
  });
}

// --- Classification ---

function classifyTrace(trace: JaegerTrace): ClassifiedTrace {
  const spans = trace.spans;
  const rootSpan = spans[0];
  const startTime = rootSpan?.startTime ?? 0;
  const duration = rootSpan?.duration ?? 0;

  let toolName: string | null = null;
  let toolCategory: string | null = null;
  let policyDecision: string | null = null;
  let mcpMethod: string | null = null;
  let hasError = false;

  const serviceNames = new Set<string>();
  for (const span of spans) {
    const proc = trace.processes[span.processID];
    if (proc) serviceNames.add(proc.serviceName);

    const tn =
      getSpanTag(span, "mcp.tool_name") || getSpanTag(span, "tool.name");
    if (tn) toolName = tn;

    const tc =
      getSpanTag(span, "mcp.tool_category") || getSpanTag(span, "tool.category");
    if (tc) toolCategory = tc;

    const pd =
      getSpanTag(span, "policy.decision") || getSpanTag(span, "opa.decision");
    if (pd) policyDecision = pd;

    const mm = getSpanTag(span, "mcp.method");
    if (mm) mcpMethod = mm;

    if (getSpanTag(span, "error") === "true" || getSpanTag(span, "otel.status_code") === "ERROR") {
      hasError = true;
    }
  }

  const rootProc = trace.processes[rootSpan?.processID ?? ""];
  const rootService = rootProc?.serviceName ?? "unknown";

  const hasToolCall = spans.some(
    (s) =>
      s.operationName === "tool_call" ||
      getSpanTag(s, "mcp.method") === "tools/call"
  );
  const isDenied = policyDecision === "deny";

  let type: TraceType = "other";
  if (hasToolCall && isDenied) type = "denied";
  else if (hasToolCall) type = "tool_call";
  else if (spans.some((s) => s.operationName === "sse_connect")) type = "connection";
  else if (spans.some((s) => s.operationName === "refresh_tool_cache")) type = "cache";
  else if (spans.some((s) => s.operationName === "mcp_message")) type = "mcp_message";

  return {
    trace,
    type,
    toolName,
    toolCategory,
    policyDecision,
    mcpMethod,
    duration,
    startTime,
    rootService,
    spanCount: spans.length,
    serviceSet: Array.from(serviceNames),
    hasError: hasError || isDenied,
  };
}

// --- Display helpers ---

function traceTitle(ct: ClassifiedTrace): string {
  switch (ct.type) {
    case "tool_call":
    case "denied":
      return ct.toolName ?? "Unknown Tool";
    case "connection":
      return "SSE Connection";
    case "cache":
      return "Tool Cache Refresh";
    case "mcp_message":
      return describeMcpMethod(ct.mcpMethod);
    default:
      return ct.trace.spans[0]?.operationName ?? "Trace";
  }
}

function describeMcpMethod(method: string | null): string {
  if (!method) return "MCP Message";
  switch (method) {
    case "initialize": return "Session Initialize";
    case "notifications/initialized": return "Initialized Notification";
    case "tools/list": return "List Tools";
    case "tools/call": return "Tool Call";
    default: return method;
  }
}

function typeLabel(type: TraceType): string {
  switch (type) {
    case "tool_call": return "TOOL CALL";
    case "denied": return "DENIED";
    case "connection": return "CONNECTION";
    case "cache": return "CACHE";
    case "mcp_message": return "MCP";
    default: return "OTHER";
  }
}

function statusColor(ct: ClassifiedTrace): string {
  if (ct.type === "denied") return "var(--error)";
  if (ct.hasError) return "var(--error)";
  if (ct.type === "tool_call") return "var(--success)";
  if (ct.type === "connection") return "var(--accent)";
  return "var(--text-muted)";
}

// --- Main page ---

export default function TracesPage() {
  const [traces, setTraces] = useState<JaegerTrace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [service, setService] = useState("mcp-proxy");
  const [expandedTraceId, setExpandedTraceId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [filter, setFilter] = useState<FilterType>("all");
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("time");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const fetchTraces = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/traces?service=${encodeURIComponent(service)}&limit=50`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTraces(data.data || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch traces");
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    setLoading(true);
    fetchTraces();
  }, [fetchTraces]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchTraces, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchTraces]);

  const classified = useMemo(() => {
    return traces
      .filter((t) => !isNoiseTrace(t))
      .map(classifyTrace)
      .sort((a, b) => b.startTime - a.startTime);
  }, [traces]);

  // Search + filter
  const filtered = useMemo(() => {
    let result = classified;

    // Type filter
    if (filter === "tool_call") {
      result = result.filter((c) => c.type === "tool_call" || c.type === "denied");
    } else if (filter !== "all") {
      result = result.filter((c) => c.type === filter);
    }

    // Text search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((ct) => {
        const title = traceTitle(ct).toLowerCase();
        const svc = ct.rootService.toLowerCase();
        const tid = ct.trace.traceID.toLowerCase();
        const cat = (ct.toolCategory ?? "").toLowerCase();
        return title.includes(q) || svc.includes(q) || tid.includes(q) || cat.includes(q);
      });
    }

    // Sort
    result = [...result].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      switch (sortField) {
        case "time": return (a.startTime - b.startTime) * dir;
        case "duration": return (a.duration - b.duration) * dir;
        case "service": return a.rootService.localeCompare(b.rootService) * dir;
        default: return 0;
      }
    });

    return result;
  }, [classified, filter, search, sortField, sortDir]);

  // Stats
  const stats = useMemo(() => {
    const toolCalls = classified.filter(
      (c) => c.type === "tool_call" || c.type === "denied"
    );
    const denials = classified.filter((c) => c.type === "denied");
    const durations = toolCalls.filter((c) => c.duration > 0).map((c) => c.duration);
    const avgLatency =
      durations.length > 0
        ? durations.reduce((s, d) => s + d, 0) / durations.length
        : 0;
    const maxDuration = Math.max(...classified.map((c) => c.duration), 1);

    return {
      total: classified.length,
      toolCalls: toolCalls.length,
      denials: denials.length,
      avgLatency,
      maxDuration,
    };
  }, [classified]);

  const services = ["mcp-proxy", "mcp-server", "agent"];

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const sortArrow = (field: SortField) => {
    if (sortField !== field) return "";
    return sortDir === "asc" ? " \u2191" : " \u2193";
  };

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Trace Explorer</h1>
          <p className={styles.subtitle}>
            Distributed traces across MCP services
          </p>
        </div>
        <div className={styles.headerActions}>
          <select value={service} onChange={(e) => setService(e.target.value)}>
            {services.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button
            className={autoRefresh ? "active" : ""}
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            {autoRefresh ? "Live" : "Auto-refresh"}
          </button>
          {autoRefresh && (
            <span className={styles.liveDot} />
          )}
        </div>
      </div>

      {error && <div className={styles.errorBanner}>{error}</div>}

      {!loading && !error && (
        <>
          {/* Stats row */}
          <div className={styles.statsBar}>
            <div className={styles.stat}>
              <span className={styles.statValue}>{stats.total}</span>
              <span className={styles.statLabel}>Traces</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{stats.toolCalls}</span>
              <span className={styles.statLabel}>Tool Calls</span>
            </div>
            <div className={styles.stat}>
              <span className={`${styles.statValue} ${stats.denials > 0 ? styles.statDanger : ""}`}>
                {stats.denials}
              </span>
              <span className={styles.statLabel}>Denied</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>
                {stats.avgLatency > 0 ? formatDuration(stats.avgLatency) : "--"}
              </span>
              <span className={styles.statLabel}>Avg Latency</span>
            </div>
          </div>

          {/* Search + filters */}
          <div className={styles.toolbar}>
            <div className={styles.searchBox}>
              <span className={styles.searchIcon}>&#x1F50D;</span>
              <input
                type="text"
                placeholder="Search by tool, service, trace ID, or category..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={styles.searchInput}
              />
              {search && (
                <button className={styles.searchClear} onClick={() => setSearch("")}>
                  &times;
                </button>
              )}
            </div>
            <div className={styles.filterGroup}>
              {(
                [
                  ["all", "All"],
                  ["tool_call", "Tool Calls"],
                  ["denied", "Denied"],
                  ["connection", "Connections"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  className={`${styles.filterBtn} ${filter === key ? styles.filterBtnActive : ""}`}
                  onClick={() => setFilter(key)}
                >
                  {label}
                  {key !== "all" && (
                    <span className={styles.filterBadge}>
                      {key === "tool_call"
                        ? stats.toolCalls
                        : key === "denied"
                          ? stats.denials
                          : classified.filter((c) => c.type === key).length}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Trace table */}
      {loading && !traces.length ? (
        <div className={styles.emptyState}>Loading traces...</div>
      ) : filtered.length === 0 ? (
        <div className={styles.emptyState}>
          {classified.length === 0
            ? `No traces found for "${service}"`
            : "No traces match the current filters"}
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.traceTable}>
            <thead>
              <tr>
                <th className={styles.colStatus}></th>
                <th className={styles.colType}>Type</th>
                <th
                  className={`${styles.colService} ${styles.sortable}`}
                  onClick={() => toggleSort("service")}
                >
                  Service{sortArrow("service")}
                </th>
                <th className={styles.colOperation}>Operation</th>
                <th
                  className={`${styles.colDuration} ${styles.sortable}`}
                  onClick={() => toggleSort("duration")}
                >
                  Duration{sortArrow("duration")}
                </th>
                <th className={styles.colBar}></th>
                <th
                  className={`${styles.colTime} ${styles.sortable}`}
                  onClick={() => toggleSort("time")}
                >
                  Time{sortArrow("time")}
                </th>
                <th className={styles.colSpans}>Spans</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ct) => (
                <TraceRow
                  key={ct.trace.traceID}
                  ct={ct}
                  maxDuration={stats.maxDuration}
                  expanded={expandedTraceId === ct.trace.traceID}
                  onToggle={() =>
                    setExpandedTraceId((prev) =>
                      prev === ct.trace.traceID ? null : ct.trace.traceID
                    )
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- Trace row ---

function TraceRow({
  ct,
  maxDuration,
  expanded,
  onToggle,
}: {
  ct: ClassifiedTrace;
  maxDuration: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const title = traceTitle(ct);
  const barWidth = maxDuration > 0 ? Math.max((ct.duration / maxDuration) * 100, 1) : 0;

  return (
    <>
      <tr
        className={`${styles.traceRow} ${expanded ? styles.traceRowExpanded : ""}`}
        onClick={onToggle}
      >
        <td className={styles.colStatus}>
          <span
            className={styles.statusDot}
            style={{ background: statusColor(ct) }}
          />
        </td>
        <td className={styles.colType}>
          <span className={`${styles.typeBadge} ${styles[`type_${ct.type}`]}`}>
            {typeLabel(ct.type)}
          </span>
        </td>
        <td className={styles.colService}>
          <span className={styles.serviceName}>
            <span
              className={styles.serviceBar}
              style={{ background: serviceColor(ct.rootService) }}
            />
            {ct.rootService}
          </span>
        </td>
        <td className={styles.colOperation}>
          <span className={styles.opName}>{title}</span>
          {ct.toolCategory && (
            <span className={styles.opCategory}>{ct.toolCategory}</span>
          )}
        </td>
        <td className={styles.colDuration}>
          <span className={styles.durationText}>
            {ct.duration > 0 ? formatDuration(ct.duration) : "--"}
          </span>
        </td>
        <td className={styles.colBar}>
          <div className={styles.durationBarTrack}>
            <div
              className={styles.durationBarFill}
              style={{
                width: `${barWidth}%`,
                background: statusColor(ct),
              }}
            />
          </div>
        </td>
        <td className={styles.colTime} title={formatTimestamp(ct.startTime)}>
          {formatRelativeTime(ct.startTime)}
        </td>
        <td className={styles.colSpans}>{ct.spanCount}</td>
      </tr>
      {expanded && (
        <tr className={styles.detailRow}>
          <td colSpan={8}>
            <TraceDetail ct={ct} />
          </td>
        </tr>
      )}
    </>
  );
}

// --- Trace detail (waterfall) ---

function TraceDetail({ ct }: { ct: ClassifiedTrace }) {
  const { trace } = ct;
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);

  // Build parent map for indentation
  const parentMap = new Map<string, string>();
  for (const span of trace.spans) {
    for (const ref of span.references) {
      if (ref.refType === "CHILD_OF") {
        parentMap.set(span.spanID, ref.spanID);
      }
    }
  }

  // Calculate depth for each span
  function getDepth(spanId: string): number {
    let depth = 0;
    let current = spanId;
    while (parentMap.has(current)) {
      depth++;
      current = parentMap.get(current)!;
    }
    return depth;
  }

  // Sort spans by start time
  const spans = [...trace.spans].sort((a, b) => a.startTime - b.startTime);
  const traceStart = spans[0]?.startTime ?? 0;
  const traceEnd = Math.max(...spans.map((s) => s.startTime + s.duration));
  const traceDuration = traceEnd - traceStart;

  const selectedSpan = selectedSpanId
    ? spans.find((s) => s.spanID === selectedSpanId) ?? null
    : null;

  return (
    <div className={styles.detail}>
      {/* Trace summary header */}
      <div className={styles.detailHeader}>
        <span className={styles.detailTraceId}>
          Trace {ct.trace.traceID.substring(0, 12)}
        </span>
        <span className={styles.detailMeta}>
          {ct.spanCount} spans
        </span>
        <span className={styles.detailMeta}>
          {ct.serviceSet.join(", ")}
        </span>
        <span className={styles.detailMeta}>
          {ct.duration > 0 ? formatDuration(ct.duration) : "--"}
        </span>
      </div>

      <div className={styles.detailBody}>
        {/* Waterfall */}
        <div className={styles.waterfall}>
          {/* Time ruler */}
          <div className={styles.timeRuler}>
            <span>0ms</span>
            {traceDuration > 0 && (
              <>
                <span>{formatDuration(traceDuration / 4)}</span>
                <span>{formatDuration(traceDuration / 2)}</span>
                <span>{formatDuration((traceDuration * 3) / 4)}</span>
                <span>{formatDuration(traceDuration)}</span>
              </>
            )}
          </div>

          {spans.map((span) => {
            const depth = getDepth(span.spanID);
            const proc = trace.processes[span.processID];
            const svcName = proc?.serviceName ?? "unknown";
            const svcClr = serviceColor(svcName);

            const offset =
              traceDuration > 0
                ? ((span.startTime - traceStart) / traceDuration) * 100
                : 0;
            const width =
              traceDuration > 0
                ? Math.max((span.duration / traceDuration) * 100, 0.5)
                : 100;

            const decision = getSpanTag(span, "policy.decision") || getSpanTag(span, "opa.decision");
            const isError = decision === "deny" || getSpanTag(span, "error") === "true";
            const isSelected = span.spanID === selectedSpanId;

            return (
              <div
                key={span.spanID}
                className={`${styles.waterfallRow} ${isSelected ? styles.waterfallRowSelected : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedSpanId(isSelected ? null : span.spanID);
                }}
              >
                <div
                  className={styles.waterfallLabel}
                  style={{ paddingLeft: `${12 + depth * 20}px` }}
                >
                  <span
                    className={styles.waterfallSvcDot}
                    style={{ background: svcClr }}
                  />
                  <span className={styles.waterfallSvcName}>{svcName}</span>
                  <span className={styles.waterfallOpName}>
                    {describeSpanOp(span)}
                  </span>
                </div>
                <div className={styles.waterfallBarArea}>
                  <div
                    className={styles.waterfallBar}
                    style={{
                      left: `${offset}%`,
                      width: `${width}%`,
                      background: isError ? "var(--error)" : svcClr,
                      opacity: isError ? 0.9 : 0.75,
                    }}
                  >
                    {width > 8 && (
                      <span className={styles.waterfallBarLabel}>
                        {formatDuration(span.duration)}
                      </span>
                    )}
                  </div>
                </div>
                <span className={styles.waterfallDuration}>
                  {formatDuration(span.duration)}
                </span>
              </div>
            );
          })}
        </div>

        {/* Span detail panel */}
        {selectedSpan && (
          <SpanDetailPanel span={selectedSpan} trace={trace} />
        )}
      </div>
    </div>
  );
}

// --- Span detail panel ---

function SpanDetailPanel({
  span,
  trace,
}: {
  span: JaegerSpan;
  trace: JaegerTrace;
}) {
  const proc = trace.processes[span.processID];

  return (
    <div className={styles.spanPanel}>
      <div className={styles.spanPanelHeader}>
        <span className={styles.spanPanelTitle}>{span.operationName}</span>
        <span className={styles.spanPanelService}>
          {proc?.serviceName ?? "unknown"}
        </span>
      </div>

      <div className={styles.spanPanelSection}>
        <div className={styles.spanPanelLabel}>Timing</div>
        <div className={styles.spanPanelGrid}>
          <span className={styles.spanPanelKey}>Duration</span>
          <span className={styles.spanPanelVal}>{formatDuration(span.duration)}</span>
          <span className={styles.spanPanelKey}>Start</span>
          <span className={styles.spanPanelVal}>{formatTimestamp(span.startTime)}</span>
          <span className={styles.spanPanelKey}>Span ID</span>
          <span className={styles.spanPanelVal}>{span.spanID.substring(0, 16)}</span>
        </div>
      </div>

      {span.tags.length > 0 && (
        <div className={styles.spanPanelSection}>
          <div className={styles.spanPanelLabel}>Tags</div>
          <div className={styles.spanPanelGrid}>
            {span.tags.map((tag) => (
              <TagRow key={tag.key} tagKey={tag.key} tagValue={String(tag.value)} />
            ))}
          </div>
        </div>
      )}

      {span.logs.length > 0 && (
        <div className={styles.spanPanelSection}>
          <div className={styles.spanPanelLabel}>Logs</div>
          {span.logs.map((log, i) => (
            <div key={i} className={styles.spanLog}>
              <span className={styles.spanLogTime}>
                {formatTimestamp(log.timestamp)}
              </span>
              {log.fields.map((f) => (
                <span key={f.key} className={styles.spanLogField}>
                  {f.key}={f.value}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TagRow({ tagKey, tagValue }: { tagKey: string; tagValue: string }) {
  const highlight =
    tagKey.startsWith("mcp.") ||
    tagKey.startsWith("policy.") ||
    tagKey.startsWith("opa.") ||
    tagKey === "error";

  return (
    <>
      <span className={`${styles.spanPanelKey} ${highlight ? styles.spanPanelKeyHighlight : ""}`}>
        {tagKey}
      </span>
      <span className={`${styles.spanPanelVal} ${highlight ? styles.spanPanelValHighlight : ""}`}>
        {tagValue}
      </span>
    </>
  );
}

// --- Span operation description ---

function describeSpanOp(span: JaegerSpan): string {
  const op = span.operationName;
  const toolName = getSpanTag(span, "mcp.tool_name") || getSpanTag(span, "tool.name");

  if (op === "tool_call" && toolName) return toolName;
  if (op === "policy_check") return "policy check";
  if (op === "mcp_message") return "message";
  if (op === "sse_connect") return "sse connect";
  if (op === "refresh_tool_cache") return "cache refresh";
  if (op === "query_traces") return "query traces";
  if (op.includes("http send")) return "http request";
  if (op.includes("http receive")) return "http response";
  if (/^(GET|POST|PUT|DELETE|PATCH)\s+/.test(op)) {
    return op.replace(/\{[^}]+\}/g, "*").toLowerCase();
  }
  return op;
}
