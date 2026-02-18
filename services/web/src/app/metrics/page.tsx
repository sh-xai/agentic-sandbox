// ABOUTME: Metrics overview page displaying key metrics from Prometheus.
// ABOUTME: Compact stats bar for request/error/latency, service status table with status dots and badges.
"use client";

import { useState, useEffect, useCallback } from "react";
import type { PrometheusQueryResponse, PrometheusResult } from "@/types";
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

interface MetricDef {
  label: string;
  query: string;
  unit: string;
  format?: (value: string) => string;
}

const KEY_METRICS: MetricDef[] = [
  {
    label: "Request Rate",
    query: 'sum(rate(http_requests_total[5m]))',
    unit: "req/s",
    format: (v) => parseFloat(v).toFixed(2),
  },
  {
    label: "Error Rate",
    query: 'sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) * 100',
    unit: "%",
    format: (v) => {
      const n = parseFloat(v);
      return isNaN(n) ? "0" : n.toFixed(1);
    },
  },
  {
    label: "p50",
    query: 'histogram_quantile(0.5, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))',
    unit: "ms",
    format: (v) => (parseFloat(v) * 1000).toFixed(0),
  },
  {
    label: "p95",
    query: 'histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))',
    unit: "ms",
    format: (v) => (parseFloat(v) * 1000).toFixed(0),
  },
  {
    label: "p99",
    query: 'histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))',
    unit: "ms",
    format: (v) => (parseFloat(v) * 1000).toFixed(0),
  },
];

// --- Helpers ---

async function fetchMetric(query: string): Promise<PrometheusResult[]> {
  const res = await fetch(`/api/metrics?query=${encodeURIComponent(query)}`);
  if (!res.ok) return [];
  const data: PrometheusQueryResponse = await res.json();
  return data.data?.result ?? [];
}

interface ParsedService {
  service: string;
  instance: string;
  isUp: boolean;
}

function parseServiceMetric(result: PrometheusResult): ParsedService {
  const labels = result.metric;
  const service = labels.job || labels.service || labels.__name__ || "unknown";
  const instance = labels.instance || "-";
  const value = result.value?.[1];
  const isUp = value === "1";
  return { service, instance, isUp };
}

// --- Main page ---

export default function MetricsPage() {
  const [cardValues, setCardValues] = useState<Record<string, string>>({});
  const [serviceMetrics, setServiceMetrics] = useState<ParsedService[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const cardResults = await Promise.all(
        KEY_METRICS.map(async (metric) => {
          const results = await fetchMetric(metric.query);
          const value = results[0]?.value?.[1];
          const formatted = value && metric.format ? metric.format(value) : (value ?? "--");
          return { label: metric.label, value: formatted, unit: metric.unit };
        })
      );

      const values: Record<string, string> = {};
      for (const { label, value, unit } of cardResults) {
        values[label] = value === "--" ? "--" : `${value}${unit}`;
      }
      setCardValues(values);

      const upResults = await fetchMetric("up");
      setServiceMetrics(upResults.map(parseServiceMetric));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch metrics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchAll, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchAll]);

  const errorRateValue = parseFloat(cardValues["Error Rate"] ?? "0");
  const isHighErrorRate = !isNaN(errorRateValue) && errorRateValue > 5;

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Metrics</h1>
          <p className={styles.subtitle}>Key metrics from Prometheus</p>
        </div>
        <div className={styles.headerActions}>
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
            {KEY_METRICS.map((metric) => (
              <div key={metric.label} className={styles.stat}>
                <span className={`${styles.statValue} ${
                  metric.label === "Error Rate" && isHighErrorRate ? styles.statDanger : ""
                }`}>
                  {cardValues[metric.label] ?? "--"}
                </span>
                <span className={styles.statLabel}>{metric.label}</span>
              </div>
            ))}
          </div>

          {/* Service status table */}
          <div className={styles.sectionLabel}>Service Status</div>
          {serviceMetrics.length === 0 ? (
            <div className={styles.emptyState}>No metrics available</div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.colStatus}></th>
                    <th>Service</th>
                    <th className={styles.colInstance}>Instance</th>
                    <th className={styles.colBadge}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {serviceMetrics.map((svc, idx) => (
                    <tr key={idx} className={styles.row}>
                      <td className={styles.colStatus}>
                        <span
                          className={styles.statusDot}
                          style={{
                            background: svc.isUp ? "var(--success)" : "var(--error)",
                          }}
                        />
                      </td>
                      <td>
                        <span className={styles.serviceName}>
                          <span
                            className={styles.serviceBar}
                            style={{ background: serviceColor(svc.service) }}
                          />
                          {svc.service}
                        </span>
                      </td>
                      <td className={styles.colInstance}>
                        <span className={styles.instanceText}>{svc.instance}</span>
                      </td>
                      <td className={styles.colBadge}>
                        <span className={`${styles.typeBadge} ${svc.isUp ? styles.badgeUp : styles.badgeDown}`}>
                          {svc.isUp ? "UP" : "DOWN"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {loading && <div className={styles.emptyState}>Loading metrics...</div>}
    </div>
  );
}
