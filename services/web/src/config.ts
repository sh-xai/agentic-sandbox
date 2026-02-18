// ABOUTME: Backend service URL configuration for the observability dashboard.
// ABOUTME: Reads from environment variables with sensible Docker defaults.

export const JAEGER_URL = process.env.JAEGER_URL || "http://jaeger:16686";
export const LOKI_URL = process.env.LOKI_URL || "http://loki:3100";
export const PROMETHEUS_URL = process.env.PROMETHEUS_URL || "http://prometheus:9090";
export const MCP_PROXY_URL = process.env.MCP_PROXY_URL || "http://mcp-proxy:8001";
export const AGENT_URL = process.env.AGENT_URL || "http://agent:8002";
export const OPA_URL = process.env.OPA_URL || "http://opa:8181";
