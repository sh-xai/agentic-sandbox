// ABOUTME: Log viewer page for browsing logs from Loki.
// ABOUTME: Displays log table with status dots, level badges, service color bars, and expandable rows.
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { LokiQueryRangeResponse } from "@/types";
import styles from "./page.module.css";

// --- Constants ---

const SERVICE_COLORS: Record<string, string> = {
  "mcp-proxy": "#60a5fa",
  "mcp-server": "#34d399",
  agent: "#a78bfa",
  opa: "#f59e0b",
  "jaeger-all-in-one": "#6b7280",
};

const DEFAULT_SERVICE_COLOR = "#9aa0b0";

function serviceColor(name: string): string {
  return SERVICE_COLORS[name] ?? DEFAULT_SERVICE_COLOR;
}

// --- Types ---

interface ParsedLog {
  timestamp: string;
  line: string;
  labels: Record<string, string>;
  level: string;
}

type LevelFilter = "all" | "error" | "warn" | "info" | "debug";

// --- Helpers ---

function parseLevel(line: string, labels: Record<string, string>): string {
  if (labels.level) return labels.level;
  const lower = line.toLowerCase();
  if (lower.includes('"level":"error"') || lower.includes("level=error")) return "error";
  if (lower.includes('"level":"warn"') || lower.includes("level=warn")) return "warn";
  if (lower.includes('"level":"info"') || lower.includes("level=info")) return "info";
  if (lower.includes('"level":"debug"') || lower.includes("level=debug")) return "debug";
  return "info";
}

function formatRelativeTime(nanos: string): string {
  const ms = parseInt(nanos, 10) / 1_000_000;
  const diffSec = Math.floor((Date.now() - ms) / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

function formatTimestamp(nanos: string): string {
  const ms = parseInt(nanos, 10) / 1_000_000;
  return new Date(ms).toLocaleString();
}

function levelDotColor(level: string): string {
  switch (level) {
    case "error": return "var(--error)";
    case "warn":
    case "warning": return "var(--warning)";
    case "debug": return "var(--text-muted)";
    case "info": return "var(--accent)";
    default: return "var(--text-muted)";
  }
}

function levelBadgeClass(level: string): string {
  switch (level) {
    case "error": return styles.levelError;
    case "warn":
    case "warning": return styles.levelWarn;
    case "debug": return styles.levelDebug;
    case "info": return styles.levelInfo;
    default: return styles.levelDefault;
  }
}

function truncateMessage(line: string, max: number = 120): string {
  if (line.length <= max) return line;
  return line.substring(0, max) + "...";
}

// --- Main page ---

export default function LogsPage() {
  const [logs, setLogs] = useState<ParsedLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [serviceFilter, setServiceFilter] = useState("mcp-proxy");
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const query = serviceFilter
        ? `{job="${serviceFilter}"}`
        : '{job=~".+"}';
      const res = await fetch(
        `/api/logs?query=${encodeURIComponent(query)}&limit=200`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: LokiQueryRangeResponse = await res.json();

      const parsed: ParsedLog[] = [];
      if (data.data?.result) {
        for (const stream of data.data.result) {
          for (const [ts, line] of stream.values) {
            parsed.push({
              timestamp: ts,
              line,
              labels: stream.stream,
              level: parseLevel(line, stream.stream),
            });
          }
        }
      }

      parsed.sort((a, b) => parseInt(b.timestamp, 10) - parseInt(a.timestamp, 10));
      setLogs(parsed);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch logs");
    } finally {
      setLoading(false);
    }
  }, [serviceFilter]);

  useEffect(() => {
    setLoading(true);
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  // Level counts
  const levelCounts = useMemo(() => {
    const counts = { error: 0, warn: 0, info: 0, debug: 0 };
    for (const log of logs) {
      const lvl = log.level === "warning" ? "warn" : log.level;
      if (lvl in counts) counts[lvl as keyof typeof counts]++;
    }
    return counts;
  }, [logs]);

  // Filtered logs
  const filtered = useMemo(() => {
    let result = logs;

    if (levelFilter !== "all") {
      result = result.filter((log) => {
        const lvl = log.level === "warning" ? "warn" : log.level;
        return lvl === levelFilter;
      });
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((log) =>
        log.line.toLowerCase().includes(q) ||
        (log.labels.job ?? "").toLowerCase().includes(q) ||
        (log.labels.service ?? "").toLowerCase().includes(q)
      );
    }

    return result;
  }, [logs, levelFilter, search]);

  const uniqueServices = useMemo(() => {
    const svcSet = new Set<string>();
    for (const log of logs) {
      const svc = log.labels.job || log.labels.service;
      if (svc) svcSet.add(svc);
    }
    return Array.from(svcSet);
  }, [logs]);

  const services = ["mcp-proxy", "mcp-server", "agent", "opa"];

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Log Viewer</h1>
          <p className={styles.subtitle}>Aggregated logs from Loki</p>
        </div>
        <div className={styles.headerActions}>
          <select value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value)}>
            <option value="">All services</option>
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
          {autoRefresh && <span className={styles.liveDot} />}
        </div>
      </div>

      {error && <div className={styles.errorBanner}>{error}</div>}

      {!loading && !error && (
        <>
          {/* Stats bar */}
          <div className={styles.statsBar}>
            <div className={styles.stat}>
              <span className={styles.statValue}>{logs.length}</span>
              <span className={styles.statLabel}>Total Logs</span>
            </div>
            <div className={styles.stat}>
              <span className={`${styles.statValue} ${levelCounts.error > 0 ? styles.statDanger : ""}`}>
                {levelCounts.error}
              </span>
              <span className={styles.statLabel}>Errors</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{levelCounts.warn}</span>
              <span className={styles.statLabel}>Warnings</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{uniqueServices.length}</span>
              <span className={styles.statLabel}>Services</span>
            </div>
          </div>

          {/* Toolbar */}
          <div className={styles.toolbar}>
            <div className={styles.searchBox}>
              <span className={styles.searchIcon}>&#x1F50D;</span>
              <input
                type="text"
                placeholder="Search log messages..."
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
                  ["error", "Error"],
                  ["warn", "Warn"],
                  ["info", "Info"],
                  ["debug", "Debug"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  className={`${styles.filterBtn} ${levelFilter === key ? styles.filterBtnActive : ""}`}
                  onClick={() => setLevelFilter(key)}
                >
                  {label}
                  {key !== "all" && (
                    <span className={styles.filterBadge}>
                      {levelCounts[key as keyof typeof levelCounts] ?? 0}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Log table */}
      {loading && !logs.length ? (
        <div className={styles.emptyState}>Loading logs...</div>
      ) : filtered.length === 0 ? (
        <div className={styles.emptyState}>
          {logs.length === 0 ? "No logs found" : "No logs match the current filters"}
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.colStatus}></th>
                <th className={styles.colLevel}>Level</th>
                <th className={styles.colService}>Service</th>
                <th>Message</th>
                <th className={styles.colTime}>Time</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((log, idx) => {
                const isExpanded = expandedIdx === idx;
                const svc = log.labels.job || log.labels.service || "-";
                return (
                  <LogRow
                    key={`${log.timestamp}-${idx}`}
                    log={log}
                    svc={svc}
                    expanded={isExpanded}
                    onToggle={() => setExpandedIdx(isExpanded ? null : idx)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- Log row ---

function LogRow({
  log,
  svc,
  expanded,
  onToggle,
}: {
  log: ParsedLog;
  svc: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className={`${styles.logRow} ${expanded ? styles.logRowExpanded : ""}`}
        onClick={onToggle}
      >
        <td className={styles.colStatus}>
          <span
            className={styles.statusDot}
            style={{ background: levelDotColor(log.level) }}
          />
        </td>
        <td className={styles.colLevel}>
          <span className={`${styles.typeBadge} ${levelBadgeClass(log.level)}`}>
            {log.level.toUpperCase()}
          </span>
        </td>
        <td className={styles.colService}>
          <span className={styles.serviceName}>
            <span
              className={styles.serviceBar}
              style={{ background: serviceColor(svc) }}
            />
            {svc}
          </span>
        </td>
        <td className={styles.colMessage}>
          <span className={styles.messageText}>
            {truncateMessage(log.line)}
          </span>
        </td>
        <td className={styles.colTime} title={formatTimestamp(log.timestamp)}>
          {formatRelativeTime(log.timestamp)}
        </td>
      </tr>
      {expanded && (
        <tr className={styles.detailRow}>
          <td colSpan={5}>
            <LogDetail log={log} />
          </td>
        </tr>
      )}
    </>
  );
}

// --- Log detail (expandable row) ---

function LogDetail({ log }: { log: ParsedLog }) {
  const labelEntries = Object.entries(log.labels);

  return (
    <div className={styles.detail}>
      <div className={styles.detailSection}>
        <div className={styles.detailLabel}>Full Message</div>
        <pre className={styles.detailMessage}>{log.line}</pre>
      </div>
      {labelEntries.length > 0 && (
        <div className={styles.detailSection}>
          <div className={styles.detailLabel}>Labels</div>
          <div className={styles.detailGrid}>
            {labelEntries.map(([key, value]) => (
              <span key={key} className={styles.detailGridItem}>
                <span className={styles.detailKey}>{key}</span>
                <span className={styles.detailVal}>{value}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
