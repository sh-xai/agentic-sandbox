// ABOUTME: Dashboard home page showing system health and recent trace activity.
// ABOUTME: Client component with auto-refresh, stats bar, service table, and condensed trace table.
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import type {
  HealthResponse,
  JaegerTrace,
  JaegerTracesResponse,
  JaegerSpan,
  McpToolsResponse,
} from "@/types";
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

// --- Helpers ---

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

function getSpanTag(span: JaegerSpan, key: string): string | null {
  const tag = span.tags.find((t) => t.key === key);
  return tag ? String(tag.value) : null;
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

// --- Trace classification ---

type TraceType = "tool_call" | "denied" | "connection" | "cache" | "mcp_message" | "other";

interface ClassifiedTrace {
  trace: JaegerTrace;
  type: TraceType;
  toolName: string | null;
  duration: number;
  startTime: number;
  rootService: string;
  hasError: boolean;
}

function classifyTrace(trace: JaegerTrace): ClassifiedTrace {
  const spans = trace.spans;
  const rootSpan = spans[0];
  const startTime = rootSpan?.startTime ?? 0;
  const duration = rootSpan?.duration ?? 0;

  let toolName: string | null = null;
  let policyDecision: string | null = null;
  let hasError = false;

  for (const span of spans) {
    const tn = getSpanTag(span, "mcp.tool_name") || getSpanTag(span, "tool.name");
    if (tn) toolName = tn;

    const pd = getSpanTag(span, "policy.decision") || getSpanTag(span, "opa.decision");
    if (pd) policyDecision = pd;

    if (getSpanTag(span, "error") === "true" || getSpanTag(span, "otel.status_code") === "ERROR") {
      hasError = true;
    }
  }

  const rootProc = trace.processes[rootSpan?.processID ?? ""];
  const rootService = rootProc?.serviceName ?? "unknown";
  const isDenied = policyDecision === "deny";

  const hasToolCall = spans.some(
    (s) =>
      s.operationName === "tool_call" ||
      getSpanTag(s, "mcp.method") === "tools/call"
  );

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
    duration,
    startTime,
    rootService,
    hasError: hasError || isDenied,
  };
}

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
      return "MCP Message";
    default:
      return ct.trace.spans[0]?.operationName ?? "Trace";
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

export default function Home() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [traces, setTraces] = useState<JaegerTrace[]>([]);
  const [toolCount, setToolCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const [healthRes, tracesRes, toolsRes] = await Promise.all([
        fetch("/api/health"),
        fetch("/api/traces?limit=20&lookback=1h"),
        fetch("/api/tools"),
      ]);

      if (healthRes.ok) {
        const h: HealthResponse = await healthRes.json();
        setHealth(h);
      }

      if (tracesRes.ok) {
        const t: JaegerTracesResponse = await tracesRes.json();
        setTraces(t.data || []);
      }

      if (toolsRes.ok) {
        const m: McpToolsResponse = await toolsRes.json();
        setToolCount(m.tools?.length ?? 0);
      }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchAll, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchAll]);

  // Classified traces
  const classified = useMemo(() => {
    return traces
      .filter((t) => !isNoiseTrace(t))
      .map(classifyTrace)
      .sort((a, b) => b.startTime - a.startTime);
  }, [traces]);

  // Stats
  const healthyCount = health?.services.filter((s) => s.status === "healthy").length ?? 0;
  const totalServices = health?.services.length ?? 0;
  const maxLatency = Math.max(...(health?.services.map((s) => s.latencyMs ?? 0) ?? [0]), 1);

  const toolCallTraces = classified.filter((c) => c.type === "tool_call" || c.type === "denied");
  const durations = toolCallTraces.filter((c) => c.duration > 0).map((c) => c.duration);
  const avgLatency = durations.length > 0
    ? durations.reduce((s, d) => s + d, 0) / durations.length
    : 0;

  const recentTraces = classified.slice(0, 5);

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Dashboard</h1>
          <p className={styles.subtitle}>System overview and recent activity</p>
        </div>
        <div className={styles.headerActions}>
          <button onClick={fetchAll}>Refresh</button>
          <button
            className={autoRefresh ? "active" : ""}
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            {autoRefresh ? "Live" : "Auto-refresh"}
          </button>
          {autoRefresh && <span className={styles.liveDot} />}
        </div>
      </div>

      {error && <div className={styles.errorBanner}>{error}</div>}

      {!loading && !error && (
        <>
          {/* Stats bar */}
          <div className={styles.statsBar}>
            <div className={styles.stat}>
              <span className={`${styles.statValue} ${healthyCount === totalServices ? "" : styles.statDanger}`}>
                {healthyCount}/{totalServices}
              </span>
              <span className={styles.statLabel}>Services</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{toolCount}</span>
              <span className={styles.statLabel}>MCP Tools</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{classified.length}</span>
              <span className={styles.statLabel}>Traces 1h</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>
                {avgLatency > 0 ? formatDuration(avgLatency) : "--"}
              </span>
              <span className={styles.statLabel}>Avg Latency</span>
            </div>
          </div>

          {/* Service Health Table */}
          <div className={styles.sectionLabel}>Service Health</div>
          {health && health.services.length > 0 ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.colStatus}></th>
                    <th>Service</th>
                    <th className={styles.colLatency}>Latency</th>
                    <th className={styles.colBar}></th>
                    <th className={styles.colBadge}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {health.services.map((svc) => {
                    const isHealthy = svc.status === "healthy";
                    const barWidth = svc.latencyMs
                      ? Math.max((svc.latencyMs / maxLatency) * 100, 1)
                      : 0;
                    return (
                      <tr key={svc.name} className={styles.row}>
                        <td className={styles.colStatus}>
                          <span
                            className={styles.statusDot}
                            style={{
                              background: isHealthy ? "var(--success)" : "var(--error)",
                            }}
                          />
                        </td>
                        <td>
                          <span className={styles.serviceName}>
                            <span
                              className={styles.serviceBar}
                              style={{ background: serviceColor(svc.name) }}
                            />
                            {svc.name}
                          </span>
                        </td>
                        <td className={styles.colLatency}>
                          <span className={styles.durationText}>
                            {svc.latencyMs !== undefined ? `${svc.latencyMs}ms` : "--"}
                          </span>
                        </td>
                        <td className={styles.colBar}>
                          <div className={styles.durationBarTrack}>
                            <div
                              className={styles.durationBarFill}
                              style={{
                                width: `${barWidth}%`,
                                background: isHealthy ? "var(--success)" : "var(--error)",
                              }}
                            />
                          </div>
                        </td>
                        <td className={styles.colBadge}>
                          <span
                            className={`${styles.typeBadge} ${
                              isHealthy ? styles.badgeHealthy : styles.badgeUnhealthy
                            }`}
                          >
                            {isHealthy ? "HEALTHY" : "UNHEALTHY"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={styles.emptyState}>Unable to fetch service health</div>
          )}

          {/* Recent Traces Table */}
          <div className={styles.sectionLabel}>
            Recent Traces
            <Link href="/traces" className={styles.sectionLink}>
              View all &rarr;
            </Link>
          </div>
          {recentTraces.length > 0 ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.colStatus}></th>
                    <th className={styles.colType}>Type</th>
                    <th>Service</th>
                    <th>Operation</th>
                    <th className={styles.colDuration}>Duration</th>
                    <th className={styles.colTime}>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTraces.map((ct) => (
                    <tr key={ct.trace.traceID} className={styles.row}>
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
                      <td>
                        <span className={styles.serviceName}>
                          <span
                            className={styles.serviceBar}
                            style={{ background: serviceColor(ct.rootService) }}
                          />
                          {ct.rootService}
                        </span>
                      </td>
                      <td>
                        <span className={styles.opName}>{traceTitle(ct)}</span>
                      </td>
                      <td className={styles.colDuration}>
                        <span className={styles.durationText}>
                          {ct.duration > 0 ? formatDuration(ct.duration) : "--"}
                        </span>
                      </td>
                      <td className={styles.colTime} title={formatTimestamp(ct.startTime)}>
                        {formatRelativeTime(ct.startTime)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={styles.emptyState}>No traces found in the last hour</div>
          )}
        </>
      )}

      {loading && <div className={styles.emptyState}>Loading dashboard...</div>}
    </div>
  );
}
