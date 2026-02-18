// ABOUTME: Log viewer page for browsing logs from Loki.
// ABOUTME: Displays log lines with timestamp, level, and message with text/label filtering.
"use client";

import { useState, useEffect, useCallback } from "react";
import type { LokiQueryRangeResponse } from "@/types";
import styles from "./page.module.css";

interface ParsedLog {
  timestamp: string;
  line: string;
  labels: Record<string, string>;
  level: string;
}

function parseLevel(line: string, labels: Record<string, string>): string {
  if (labels.level) return labels.level;
  const lower = line.toLowerCase();
  if (lower.includes('"level":"error"') || lower.includes("level=error")) return "error";
  if (lower.includes('"level":"warn"') || lower.includes("level=warn")) return "warn";
  if (lower.includes('"level":"info"') || lower.includes("level=info")) return "info";
  if (lower.includes('"level":"debug"') || lower.includes("level=debug")) return "debug";
  return "info";
}

function formatNanoTimestamp(nanos: string): string {
  const ms = parseInt(nanos, 10) / 1_000_000;
  return new Date(ms).toLocaleString();
}

function levelClassName(level: string): string {
  switch (level) {
    case "error": return styles.levelError;
    case "warn":
    case "warning": return styles.levelWarn;
    case "debug": return styles.levelDebug;
    case "info": return styles.levelInfo;
    default: return styles.levelDefault;
  }
}

export default function LogsPage() {
  const [logs, setLogs] = useState<ParsedLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [textFilter, setTextFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("mcp-proxy");
  const [autoRefresh, setAutoRefresh] = useState(false);

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

  const filteredLogs = textFilter
    ? logs.filter((log) => log.line.toLowerCase().includes(textFilter.toLowerCase()))
    : logs;

  const services = ["mcp-proxy", "mcp-server", "agent", "opa"];

  return (
    <div>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Log Viewer</h1>
          <p className={styles.subtitle}>Aggregated logs from Loki</p>
        </div>
        <div className={styles.controls}>
          <input
            type="text"
            placeholder="Filter text..."
            value={textFilter}
            onChange={(e) => setTextFilter(e.target.value)}
          />
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
            {autoRefresh ? "Polling ON" : "Auto-refresh"}
          </button>
          {autoRefresh && (
            <span className={styles.pollingIndicator}>
              <span className={styles.pollingDot} />
              5s
            </span>
          )}
        </div>
      </div>

      {error && <div className={styles.errorState}>{error}</div>}

      {loading && !logs.length ? (
        <div className={styles.emptyState}>Loading logs...</div>
      ) : filteredLogs.length === 0 ? (
        <div className={styles.emptyState}>
          {textFilter ? "No logs match the filter" : "No logs found"}
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Level</th>
                <th>Service</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((log, idx) => (
                <tr key={`${log.timestamp}-${idx}`} className={styles.logRow}>
                  <td className={styles.logTimestamp}>
                    {formatNanoTimestamp(log.timestamp)}
                  </td>
                  <td>
                    <span className={levelClassName(log.level)}>{log.level}</span>
                  </td>
                  <td className={styles.logLabel}>
                    {log.labels.job || log.labels.service || "-"}
                  </td>
                  <td className={styles.logMessage}>{log.line}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
