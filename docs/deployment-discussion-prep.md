# Deployment Discussion Prep — Desktop & Multi-Tenant

Prepared 2026-02-17. For discussion with Saj on 2026-02-18.

## Current State
- 11 Docker Compose services, ~1.5-2.5 GB RAM
- All services communicate via Docker internal DNS
- No auth, no multi-user, no persistence for agent tasks
- Single OPENAI_API_KEY shared across everything
- OPA policies are static files mounted read-only
- Observability stack (6 services) is ~60% of the footprint

---

## Scenario 1: Desktop Deployment (Small Packaged)

### Goal
Single-user install on a developer's machine. Run locally, minimal setup.

### Key Questions to Discuss
1. **What's the target audience?** Developers? Non-technical users? Both affect packaging complexity.
2. **Which services are essential vs optional?** The observability stack (jaeger, grafana, loki, prometheus, promtail, otel-collector) is 6 of 11 services and ~1GB RAM. Could be opt-in.
3. **What's the minimum viable deployment?** Core = agent + mcp-server + mcp-proxy + opa + web (5 services)
4. **Docker dependency acceptable?** Docker Desktop is heavy. Alternatives: Podman, native processes, single binary.

### Packaging Options
| Approach | Pros | Cons |
|----------|------|------|
| **Docker Compose (current)** | Works now, consistent | Requires Docker Desktop (~4GB), 11 containers |
| **Docker Compose (slim profile)** | Remove observability, keep core 5 | Still needs Docker, loses monitoring |
| **Docker Compose profiles** | `docker compose --profile full` vs `--profile core` | Easy, backward compatible |
| **Electron + embedded services** | Native app feel, auto-start | Complex packaging, platform-specific |
| **Single binary (Go/Rust)** | No Docker needed | Major rewrite, lose Python ecosystem |
| **Docker-in-Wasm / Colima** | Lighter than Docker Desktop | Maturity concerns |

### Simplification Opportunities
- **OPA could be embedded** — Python `opa` library or simple rule engine replacing the OPA container
- **Otel collector could be removed** — Services export traces directly to Jaeger, metrics directly to Prometheus
- **Promtail could be replaced** — Web UI reads Docker logs directly via Docker API
- **Grafana is redundant** — Custom web dashboard already exists
- **Loki could be optional** — Logs page could query Docker API directly for recent logs

### Minimal Desktop Stack (5 services → possibly 3)
```
Essential:    agent + mcp-server + mcp-proxy (core function)
Desirable:    web (dashboard), opa (policy enforcement)
Optional:     everything else (observability)
```

If OPA rules are embedded in mcp-proxy, and web queries Docker directly for logs:
**agent + mcp-server + mcp-proxy + web = 4 containers, ~500MB RAM**

### Distribution Considerations
- `.env` setup wizard (OPENAI_API_KEY at minimum)
- Pre-built images on Docker Hub / GitHub Container Registry
- `docker compose pull && docker compose up` one-liner
- Or: installer script that checks prerequisites, pulls images, configures .env
- Windows: could wrap in a PowerShell script or MSI installer
- Cross-platform: Docker Compose is already cross-platform

---

## Scenario 2: Multi-Tenant Service

### Goal
Hosted service where multiple users/orgs each get their own agent sandbox.

### Key Questions to Discuss
1. **Isolation model?** Shared infrastructure with logical tenants? Separate containers per tenant? Separate VMs?
2. **What's the unit of tenancy?** Per user? Per organization? Per project?
3. **Which services are shared vs per-tenant?**
4. **What's the pricing/billing model?** Affects architecture (metering, quotas).
5. **Where does it run?** AWS/GCP/Azure? Kubernetes?

### Isolation Spectrum
| Model | Isolation | Cost | Complexity |
|-------|-----------|------|------------|
| **Shared everything** | Low (logical) | Cheapest | Auth + tenant routing |
| **Shared infra, isolated agents** | Medium | Moderate | Container-per-tenant for agent+mcp |
| **Namespace-per-tenant (K8s)** | High | Higher | Full stack per namespace |
| **VM-per-tenant** | Highest | Expensive | Simplest security model |

### Shared vs Per-Tenant Services
| Service | Shared? | Per-Tenant? | Notes |
|---------|---------|-------------|-------|
| **web** | Shared | — | Single frontend, tenant-aware routing |
| **agent** | — | Per-tenant | Each tenant needs own LLM context, own API key |
| **mcp-server** | — | Per-tenant | Filesystem isolation required (/workspace per tenant) |
| **mcp-proxy** | Could share | Per-tenant better | Policy context is per-tenant |
| **opa** | Shared | — | Single engine, policies keyed by tenant |
| **otel-collector** | Shared | — | Tag traces/metrics with tenant_id |
| **jaeger** | Shared | — | Filter by tenant_id tag |
| **loki** | Shared | — | Filter by tenant_id label |
| **prometheus** | Shared | — | Filter by tenant_id label |
| **grafana** | Shared | — | Org-per-tenant or dashboard filtering |

### Architecture Changes Needed
1. **Authentication & Authorization**
   - Add auth layer (OAuth2/OIDC, API keys, or JWT)
   - Web frontend: login, session management
   - API routes: tenant context extraction from token
   - Agent API: tenant scoping

2. **Tenant Management**
   - Tenant registry (database: Postgres, DynamoDB, etc.)
   - Tenant provisioning (create agent + mcp-server per tenant)
   - Tenant lifecycle (suspend, delete, resource limits)

3. **API Key Management**
   - Per-tenant OPENAI_API_KEY (or shared with billing)
   - Secure storage (Vault, AWS Secrets Manager, encrypted DB)
   - Usage metering and rate limiting

4. **Data Isolation**
   - Agent tasks: need persistent storage (Postgres/Redis) with tenant_id
   - MCP workspace: isolated filesystem per tenant (volume per tenant, or object storage)
   - Policies: per-tenant policy sets in OPA
   - Logs/traces: tenant_id labels for filtering

5. **Orchestration**
   - Docker Compose won't scale — need Kubernetes or ECS
   - Container-per-tenant: K8s Deployments with tenant labels
   - Auto-scaling: spin up/down agent containers based on demand
   - Health checks and auto-restart per tenant

6. **Observability Multi-Tenancy**
   - Inject tenant_id into all OTel spans and metrics
   - Loki: use tenant_id as label for log isolation
   - Jaeger: tag-based filtering
   - Grafana: multi-org or variable-based dashboards

### Cost Drivers
- LLM API calls (biggest cost — per-tenant OpenAI usage)
- Compute (agent containers: 2 CPU + 2GB RAM each)
- Storage (workspace files, logs, traces)
- Network (SSE connections, API calls)

### Kubernetes Sketch
```
Shared namespace (infra):
  - web (Deployment, 2+ replicas)
  - opa (Deployment, 2+ replicas)
  - otel-collector (DaemonSet or Deployment)
  - jaeger (StatefulSet or managed service)
  - loki (StatefulSet or Grafana Cloud)
  - prometheus (StatefulSet or managed service)
  - grafana (Deployment or Grafana Cloud)
  - postgres (StatefulSet or managed RDS)

Per-tenant (dynamic):
  - agent-{tenant_id} (Deployment, 1 replica)
  - mcp-server-{tenant_id} (Deployment, 1 replica)
  - mcp-proxy-{tenant_id} (Deployment, 1 replica)
  - PVC: workspace-{tenant_id} (1Gi default)
```

### Managed Service Substitutions
| Self-Hosted | Managed Alternative |
|------------|-------------------|
| Jaeger | AWS X-Ray, Datadog APM, Grafana Tempo |
| Loki | Grafana Cloud Logs, CloudWatch, Datadog Logs |
| Prometheus | Grafana Cloud Metrics, CloudWatch, Datadog Metrics |
| Grafana | Grafana Cloud |
| OPA | Styra DAS (managed OPA) |
| Postgres | RDS, Cloud SQL, Supabase |

Using managed services for observability eliminates 5-6 containers from deployment.

---

## Decision Points for Tomorrow

1. **Which scenario first?** Desktop is simpler and proves the product. Multi-tenant is the business model.
2. **Docker Compose profiles** as quick win for desktop? (core vs full)
3. **What level of observability** does a desktop user actually need?
4. **Persistence**: Should agent tasks survive restarts? (Currently lost)
5. **Multi-tenant isolation**: How paranoid do we need to be about tenant separation?
6. **LLM provider flexibility**: Lock to OpenAI or support Anthropic, local models, etc.?
7. **MCP server extensibility**: Single server with 7 tools, or pluggable tool servers per tenant?
