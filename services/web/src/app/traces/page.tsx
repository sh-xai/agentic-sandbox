// ABOUTME: Trace explorer page for viewing distributed traces from Jaeger.
// ABOUTME: Displays trace table with expandable span timeline and service filtering.
"use client";

import { useState, useEffect, useCallback } from "react";
import type { JaegerTrace, JaegerTracesResponse } from "@/types";
import styles from "./page.module.css";

function formatDuration(microseconds: number): string {
  if (microseconds < 1000) return `${microseconds}\u00B5s`;
  if (microseconds < 1_000_000) return `${(microseconds / 1000).toFixed(1)}ms`;
  return `${(microseconds / 1_000_000).toFixed(2)}s`;
}

function formatTimestamp(microseconds: number): string {
  return new Date(microseconds / 1000).toLocaleString();
}

export default function TracesPage() {
  const [traces, setTraces] = useState<JaegerTrace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [service, setService] = useState("mcp-proxy");
  const [selectedTrace, setSelectedTrace] = useState<JaegerTrace | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const fetchTraces = useCallback(async () => {
    try {
      const res = await fetch(`/api/traces?service=${encodeURIComponent(service)}&limit=50`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: JaegerTracesResponse = await res.json();
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

  const services = [
    "mcp-proxy",
    "mcp-server",
    "agent",
  ];

  return (
    <div>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Trace Explorer</h1>
          <p className={styles.subtitle}>Distributed traces from Jaeger</p>
        </div>
        <div className={styles.controls}>
          <select value={service} onChange={(e) => setService(e.target.value)}>
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

      {loading && !traces.length ? (
        <div className={styles.emptyState}>Loading traces...</div>
      ) : traces.length === 0 ? (
        <div className={styles.emptyState}>No traces found for service &quot;{service}&quot;</div>
      ) : (
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>Trace ID</th>
                <th>Service</th>
                <th>Operation</th>
                <th>Spans</th>
                <th>Duration</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {traces.map((trace) => {
                const rootSpan = trace.spans[0];
                const process = trace.processes[rootSpan?.processID];
                const isSelected = selectedTrace?.traceID === trace.traceID;
                return (
                  <tr
                    key={trace.traceID}
                    className={isSelected ? styles.traceRowSelected : styles.traceRow}
                    onClick={() => setSelectedTrace(isSelected ? null : trace)}
                  >
                    <td className={styles.traceId}>
                      {trace.traceID.substring(0, 12)}...
                    </td>
                    <td>{process?.serviceName ?? "unknown"}</td>
                    <td>{rootSpan?.operationName ?? "unknown"}</td>
                    <td>{trace.spans.length}</td>
                    <td className={styles.duration}>
                      {rootSpan ? formatDuration(rootSpan.duration) : "-"}
                    </td>
                    <td className={styles.timestamp}>
                      {rootSpan ? formatTimestamp(rootSpan.startTime) : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedTrace && <SpanTimeline trace={selectedTrace} onClose={() => setSelectedTrace(null)} />}
    </div>
  );
}

function SpanTimeline({ trace, onClose }: { trace: JaegerTrace; onClose: () => void }) {
  const spans = [...trace.spans].sort((a, b) => a.startTime - b.startTime);
  const traceStart = spans[0]?.startTime ?? 0;
  const traceEnd = Math.max(...spans.map((s) => s.startTime + s.duration));
  const traceDuration = traceEnd - traceStart;

  return (
    <div className={styles.spanDetail}>
      <div className={styles.spanDetailTitle}>
        <span>Spans for {trace.traceID.substring(0, 16)}...</span>
        <button className={styles.closeButton} onClick={onClose}>{"\u00D7"}</button>
      </div>
      <div className={styles.spanTimeline}>
        {spans.map((span) => {
          const offset = traceDuration > 0
            ? ((span.startTime - traceStart) / traceDuration) * 100
            : 0;
          const width = traceDuration > 0
            ? Math.max((span.duration / traceDuration) * 100, 0.5)
            : 100;
          const process = trace.processes[span.processID];

          return (
            <div key={span.spanID} className={styles.spanRow}>
              <span className={styles.spanName} title={`${process?.serviceName}: ${span.operationName}`}>
                {span.operationName}
              </span>
              <div className={styles.spanBarContainer}>
                <div
                  className={styles.spanBar}
                  style={{ left: `${offset}%`, width: `${width}%` }}
                />
              </div>
              <span className={styles.spanDuration}>{formatDuration(span.duration)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
