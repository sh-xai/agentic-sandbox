# Agentic Sandbox — Full Architecture Reference

## Overview
GitHub: sh-xai/agentic-sandbox | Path: D:\AgenticSandbox
11 Docker services: 4 custom (agent, mcp-server, mcp-proxy, web) + 7 COTS (opa, otel-collector, jaeger, grafana, loki, prometheus, promtail)

## Services

### Custom Services

| Service | Language | Port | Purpose |
|---------|----------|------|---------|
| **web** | TypeScript/Next.js 15, Node 20 | 3001 | Observability dashboard + agent control panel |
| **agent** | Python 3.12, FastAPI | 8002 (internal) | LangChain ReAct agent coordinating MCP tools |
| **mcp-server** | Python 3.12, FastMCP | 8000 (internal) | Tool server (file ops, system info, 7 tools) |
| **mcp-proxy** | Python 3.12, FastAPI | 8001 | Policy interceptor, SSE proxy between agent and mcp-server |

### COTS Services

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| **opa** | OPA 0.61.0 | 8181 | Policy enforcement (Rego) |
| **otel-collector** | OTEL 0.96.0 | 4317/4318 | Trace/metric aggregation |
| **jaeger** | Jaeger 1.54 | 16686 | Distributed trace visualization |
| **grafana** | Grafana 10.3.1 | 3000 | Dashboard & alerting UI |
| **loki** | Loki 2.9.4 | 3100 | Log aggregation |
| **prometheus** | Prometheus 2.49.1 | 9090 | Metrics storage & querying |
| **promtail** | Promtail 2.9.4 | internal | Log shipper (Docker socket scraper) |

## Networks (3)
- **agent-net** (internal: true) — agent, mcp-server, mcp-proxy, opa, otel-collector
- **observability-net** — mcp-proxy, agent, opa, otel-collector, jaeger, grafana, loki, prometheus, promtail
- **frontend-net** — web, connects to observability-net + agent-net for backend queries

## Volumes (3 named)
- **grafana-data** → /var/lib/grafana
- **loki-data** → /loki (retention: 7 days)
- **prom-data** → /prometheus

## Agent Container Security
```yaml
cap_drop: ALL
read_only: true
tmpfs: /tmp
mem_limit: 2g
cpus: 2
```

## MCP Server Tools (7)
| Tool | Category | Description |
|------|----------|-------------|
| list_files | read | Lists directory contents |
| read_file | read | Reads file content (UTF-8) |
| get_system_info | read | System info (hostname, platform, etc.) |
| write_file | write | Writes content, creates parents |
| create_directory | write | Creates directory structure |
| delete_file | destructive | Deletes files/directories |
| execute_command | destructive | Runs shell commands (30s timeout) |

All paths sandboxed to /workspace boundary.

## Policy Flow
```
Agent → SSE → MCP Proxy → OPA check → if allowed → MCP Server
                                     → if denied → inject JSON-RPC error into SSE stream
```

OPA policies at ./policies/:
- tool-access.rego: category-based allow/deny (read/write allowed, destructive denied)
- audit.rego: generates audit records for every tool access decision

## Web Dashboard Pages (6)
- `/` — Dashboard: service health, recent traces, KPI stats
- `/traces` — Trace explorer: Jaeger query, waterfall visualization
- `/logs` — Log viewer: Loki query, level filtering, service filtering
- `/metrics` — Metrics: Prometheus query, service status table
- `/agents` — Agent control panel: task submission, task history
- `/policies` — Policy management: OPA policy CRUD, policy tester

## Web API Routes
All routes proxy to backend services:
- `/api/health` → probes all backends
- `/api/tools` → mcp-proxy /api/tools
- `/api/metrics?query=` → Prometheus /api/v1/query
- `/api/logs?query=&limit=` → Loki /loki/api/v1/query_range
- `/api/traces?service=&limit=&lookback=` → Jaeger /api/traces
- `/api/agent/status` → agent /api/status
- `/api/agent/tasks` → agent /api/tasks (GET list, POST submit)
- `/api/agent/tasks/{id}` → agent /api/tasks/{id}
- `/api/policies` → OPA /v1/policies
- `/api/policies/test` → OPA /v1/data/tool_access/allow
- `/api/policies/{id}` → OPA /v1/policies/{id} (PUT, DELETE)

## Config Files
- `config/otel-collector.yaml` — OTLP receivers, noise filter (drops /health, /metrics), exports to Jaeger + Prometheus
- `config/prometheus.yaml` — 15s scrape interval, scrapes otel-collector:8889 and mcp-proxy:8001/metrics
- `config/loki.yaml` — Local filesystem storage, v13 schema, TSDB, 7-day retention
- `config/promtail.yaml` — Docker socket discovery, labels: container name + stream
- `config/grafana/provisioning/datasources/` — Auto-provisions Jaeger, Loki, Prometheus

## Environment Variables
```
OPENAI_API_KEY        — Required, for LLM calls from agent
LLM_MODEL             — Default: gpt-4.1 (currently set to gpt-5.2)
MCP_PROXY_URL         — Default: http://mcp-proxy:8001
MCP_SERVER_URL        — Default: http://mcp-server:8000
OPA_URL               — Default: http://opa:8181
OTEL_EXPORTER_OTLP_ENDPOINT — Default: http://otel-collector:4317
OTEL_SERVICE_NAME     — Per-service (agent, mcp-server, mcp-proxy)
JAEGER_QUERY_URL      — Default: http://jaeger:16686
```

## Non-Persistent State (lost on restart)
- Agent: in-memory task dict
- MCP Proxy: tool cache, per-session error queues
- MCP Server: workspace files (baked into image at build time)

## Approximate Memory Footprint
~1.5-2.5 GB total across all 11 containers
