// ABOUTME: Metrics overview page displaying key metrics from Prometheus.
// ABOUTME: Shows request rate, error rate, and latency percentiles with auto-refresh.
"use client";

import { useState, useEffect, useCallback } from "react";
import type { PrometheusQueryResponse, PrometheusResult } from "@/types";
import styles from "./page.module.css";

interface MetricCard {
  label: string;
  query: string;
  unit: string;
  format?: (value: string) => string;
}

const KEY_METRICS: MetricCard[] = [
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
    label: "Latency p50",
    query: 'histogram_quantile(0.5, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))',
    unit: "ms",
    format: (v) => (parseFloat(v) * 1000).toFixed(0),
  },
  {
    label: "Latency p95",
    query: 'histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))',
    unit: "ms",
    format: (v) => (parseFloat(v) * 1000).toFixed(0),
  },
  {
    label: "Latency p99",
    query: 'histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))',
    unit: "ms",
    format: (v) => (parseFloat(v) * 1000).toFixed(0),
  },
];

async function fetchMetric(query: string): Promise<PrometheusResult[]> {
  const res = await fetch(`/api/metrics?query=${encodeURIComponent(query)}`);
  if (!res.ok) return [];
  const data: PrometheusQueryResponse = await res.json();
  return data.data?.result ?? [];
}

export default function MetricsPage() {
  const [cardValues, setCardValues] = useState<Record<string, string>>({});
  const [allMetrics, setAllMetrics] = useState<PrometheusResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const cardResults = await Promise.all(
        KEY_METRICS.map(async (metric) => {
          const results = await fetchMetric(metric.query);
          const value = results[0]?.value?.[1];
          const formatted = value && metric.format ? metric.format(value) : (value ?? "-");
          return { label: metric.label, value: formatted };
        })
      );

      const values: Record<string, string> = {};
      for (const { label, value } of cardResults) {
        values[label] = value;
      }
      setCardValues(values);

      const upResults = await fetchMetric("up");
      setAllMetrics(upResults);
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

  function formatLabels(metric: Record<string, string>): string {
    return Object.entries(metric)
      .filter(([key]) => key !== "__name__")
      .map(([key, value]) => `${key}="${value}"`)
      .join(", ");
  }

  return (
    <div>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Metrics</h1>
          <p className={styles.subtitle}>Key metrics from Prometheus</p>
        </div>
        <div className={styles.controls}>
          <button
            className={autoRefresh ? "active" : ""}
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            {autoRefresh ? "Polling ON" : "Auto-refresh"}
          </button>
          {autoRefresh && (
            <span className={styles.pollingIndicator}>
              <span className={styles.pollingDot} />
              10s
            </span>
          )}
        </div>
      </div>

      {error && <div className={styles.errorState}>{error}</div>}

      <div className={styles.cards}>
        {KEY_METRICS.map((metric) => (
          <div key={metric.label} className={styles.card}>
            <div className={styles.cardLabel}>{metric.label}</div>
            <div className={styles.cardValue}>
              {loading ? "-" : (cardValues[metric.label] ?? "-")}
            </div>
            <div className={styles.cardUnit}>{metric.unit}</div>
          </div>
        ))}
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Service Status (up)</h2>
        {loading ? (
          <div className={styles.emptyState}>Loading metrics...</div>
        ) : allMetrics.length === 0 ? (
          <div className={styles.emptyState}>No metrics available</div>
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Labels</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {allMetrics.map((result, idx) => (
                  <tr key={idx}>
                    <td className={styles.metricName}>
                      {result.metric.__name__ || "up"}
                    </td>
                    <td className={styles.metricLabels}>
                      {formatLabels(result.metric)}
                    </td>
                    <td className={styles.metricValue}>
                      {result.value?.[1] ?? "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
