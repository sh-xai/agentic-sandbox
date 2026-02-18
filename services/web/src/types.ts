// ABOUTME: Shared TypeScript interfaces for the observability dashboard.
// ABOUTME: Defines types for Jaeger traces, Loki logs, Prometheus metrics, and service health.

export interface JaegerSpan {
  traceID: string;
  spanID: string;
  operationName: string;
  references: Array<{
    refType: string;
    traceID: string;
    spanID: string;
  }>;
  startTime: number;
  duration: number;
  tags: Array<{ key: string; type: string; value: string | number | boolean }>;
  logs: Array<{
    timestamp: number;
    fields: Array<{ key: string; type: string; value: string }>;
  }>;
  processID: string;
  warnings: string[] | null;
}

export interface JaegerProcess {
  serviceName: string;
  tags: Array<{ key: string; type: string; value: string }>;
}

export interface JaegerTrace {
  traceID: string;
  spans: JaegerSpan[];
  processes: Record<string, JaegerProcess>;
  warnings: string[] | null;
}

export interface JaegerTracesResponse {
  data: JaegerTrace[];
  total: number;
  limit: number;
  offset: number;
  errors: string[] | null;
}

export interface LokiLogEntry {
  timestamp: string;
  line: string;
  labels: Record<string, string>;
}

export interface LokiStream {
  stream: Record<string, string>;
  values: Array<[string, string]>;
}

export interface LokiQueryRangeResponse {
  status: string;
  data: {
    resultType: string;
    result: LokiStream[];
  };
}

export interface PrometheusResult {
  metric: Record<string, string>;
  value: [number, string];
}

export interface PrometheusQueryResponse {
  status: string;
  data: {
    resultType: string;
    result: PrometheusResult[];
  };
}

export interface ServiceHealth {
  name: string;
  status: "healthy" | "unhealthy" | "unknown";
  url: string;
  latencyMs?: number;
  error?: string;
}

export interface HealthResponse {
  services: ServiceHealth[];
  timestamp: string;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpToolsResponse {
  tools: McpTool[];
}

export interface AgentStatus {
  ready: boolean;
  model: string;
  tools_loaded: number;
  tool_names: string[];
  tasks_total: number;
  tasks_running: number;
}

export interface AgentTask {
  id: string;
  task: string;
  status: "pending" | "running" | "completed" | "failed";
  result: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface OpaPolicy {
  id: string;
  raw: string;
  ast?: Record<string, unknown>;
}

export interface OpaPoliciesResponse {
  result: OpaPolicy[];
}

export interface PolicyTestResult {
  tool: string;
  category: string;
  allowed: boolean;
}
