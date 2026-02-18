// ABOUTME: Dashboard home page showing system health and recent trace activity.
// ABOUTME: Server component that fetches health, tools, and trace data on render.
import styles from "./page.module.css";
import type { HealthResponse, JaegerTracesResponse, McpToolsResponse } from "@/types";

async function fetchHealth(baseUrl: string): Promise<HealthResponse | null> {
  try {
    const res = await fetch(`${baseUrl}/api/health`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchTraces(baseUrl: string): Promise<JaegerTracesResponse | null> {
  try {
    const res = await fetch(`${baseUrl}/api/traces?limit=5&lookback=1h`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchTools(baseUrl: string): Promise<McpToolsResponse | null> {
  try {
    const res = await fetch(`${baseUrl}/api/tools`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function formatDuration(microseconds: number): string {
  if (microseconds < 1000) return `${microseconds}\u00B5s`;
  if (microseconds < 1_000_000) return `${(microseconds / 1000).toFixed(1)}ms`;
  return `${(microseconds / 1_000_000).toFixed(2)}s`;
}

function formatTimestamp(microseconds: number): string {
  return new Date(microseconds / 1000).toLocaleString();
}

export default async function Home() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3001";

  const [health, traces, tools] = await Promise.all([
    fetchHealth(baseUrl),
    fetchTraces(baseUrl),
    fetchTools(baseUrl),
  ]);

  const healthyCount = health?.services.filter((s) => s.status === "healthy").length ?? 0;
  const totalServices = health?.services.length ?? 0;
  const toolCount = tools?.tools?.length ?? 0;
  const traceCount = traces?.data?.length ?? 0;

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.title}>Dashboard</h1>
        <p className={styles.subtitle}>System overview and recent activity</p>
      </div>

      <div className={styles.cards}>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Service Health</div>
          <div
            className={`${styles.cardValue} ${
              healthyCount === totalServices ? styles.healthy : styles.unhealthy
            }`}
          >
            {healthyCount}/{totalServices}
          </div>
          <div className={styles.cardDetail}>services healthy</div>
        </div>

        <div className={styles.card}>
          <div className={styles.cardLabel}>MCP Tools</div>
          <div className={styles.cardValue}>{toolCount}</div>
          <div className={styles.cardDetail}>registered tools</div>
        </div>

        <div className={styles.card}>
          <div className={styles.cardLabel}>Recent Traces</div>
          <div className={styles.cardValue}>{traceCount}</div>
          <div className={styles.cardDetail}>in the last hour</div>
        </div>
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Service Status</h2>
        {health ? (
          <div className={styles.serviceList}>
            {health.services.map((svc) => (
              <div key={svc.name} className={styles.serviceRow}>
                <div
                  className={
                    svc.status === "healthy"
                      ? styles.statusDotHealthy
                      : svc.status === "unhealthy"
                        ? styles.statusDotUnhealthy
                        : styles.statusDotUnknown
                  }
                />
                <span className={styles.serviceName}>{svc.name}</span>
                {svc.latencyMs !== undefined && (
                  <span className={styles.serviceLatency}>{svc.latencyMs}ms</span>
                )}
                {svc.error && (
                  <span className={styles.unhealthy}>{svc.error}</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>Unable to fetch service health</div>
        )}
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Recent Traces</h2>
        {traces?.data && traces.data.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Trace ID</th>
                <th>Service</th>
                <th>Operation</th>
                <th>Duration</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {traces.data.map((trace) => {
                const rootSpan = trace.spans[0];
                const process = trace.processes[rootSpan?.processID];
                return (
                  <tr key={trace.traceID} className={styles.traceRow}>
                    <td className={styles.traceId}>
                      {trace.traceID.substring(0, 12)}...
                    </td>
                    <td>{process?.serviceName ?? "unknown"}</td>
                    <td>{rootSpan?.operationName ?? "unknown"}</td>
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
        ) : (
          <div className={styles.emptyState}>No traces found in the last hour</div>
        )}
      </div>
    </div>
  );
}
