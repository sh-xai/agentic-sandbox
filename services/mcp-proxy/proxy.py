# ABOUTME: MCP proxy that intercepts tool calls between agent and MCP server.
# ABOUTME: Logs all interactions, emits OTel traces, and enforces OPA policies.

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.trace import StatusCode

# --- Configuration ---

MCP_SERVER_URL = os.environ.get("MCP_SERVER_URL", "http://mcp-server:8000")
OPA_URL = os.environ.get("OPA_URL", "http://opa:8181")
OTEL_ENDPOINT = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT")
OTEL_SERVICE_NAME = os.environ.get("OTEL_SERVICE_NAME", "mcp-proxy")
JAEGER_QUERY_URL = os.environ.get("JAEGER_QUERY_URL", "http://jaeger:16686")

logger = logging.getLogger("mcp-proxy")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

# --- OpenTelemetry setup ---

resource = Resource.create({"service.name": OTEL_SERVICE_NAME})
provider = TracerProvider(resource=resource)

if OTEL_ENDPOINT:
    exporter = OTLPSpanExporter(endpoint=OTEL_ENDPOINT, insecure=True)
    provider.add_span_processor(BatchSpanProcessor(exporter))

trace.set_tracer_provider(provider)
tracer = trace.get_tracer("mcp-proxy")

# --- Tool metadata cache ---

_tool_cache: list[dict] = []
_tool_category_map: dict[str, str] = {}
_cache_lock = asyncio.Lock()


def _populate_category_map(tools: list[dict]) -> dict[str, str]:
    """Build a tool-name-to-category mapping from tool metadata."""
    category_map = {}
    for tool in tools:
        name = tool.get("name", "")
        # FastMCP stores tags in the tool annotations
        tags = tool.get("annotations", {}).get("tags", [])
        # Derive category from tags: destructive > write > read
        if "destructive" in tags:
            category_map[name] = "destructive"
        elif "write" in tags:
            category_map[name] = "write"
        elif "read" in tags:
            category_map[name] = "read"
        else:
            category_map[name] = "unknown"
    return category_map


async def _refresh_tool_cache(client: httpx.AsyncClient) -> None:
    """Connect to MCP server via SSE, send tools/list, and populate the cache.

    The MCP SSE transport requires an SSE handshake to get a session-bound
    message endpoint. Responses arrive on the SSE stream, not as POST
    response bodies.
    """
    global _tool_cache, _tool_category_map
    with tracer.start_as_current_span("refresh_tool_cache"):
        try:
            async with client.stream("GET", f"{MCP_SERVER_URL}/sse", timeout=30.0) as sse_stream:
                # Step 1: Read the endpoint event from the SSE stream
                message_endpoint = None
                async for line in sse_stream.aiter_lines():
                    if line.startswith("data: ") and "/messages/" in line:
                        message_endpoint = line[len("data: "):]
                        break

                if not message_endpoint:
                    logger.error("Failed to get message endpoint from MCP server SSE")
                    return

                # Build absolute URL for the session message endpoint
                if message_endpoint.startswith("/"):
                    url = f"{MCP_SERVER_URL}{message_endpoint}"
                else:
                    url = message_endpoint

                # Step 2: POST tools/list (server returns 202; result on SSE stream)
                jsonrpc_request = {
                    "jsonrpc": "2.0",
                    "id": "cache-init",
                    "method": "tools/list",
                    "params": {},
                }
                await client.post(url, json=jsonrpc_request, timeout=10.0)

                # Step 3: Read the tools/list result from the SSE stream
                data_lines: list[str] = []
                async for line in sse_stream.aiter_lines():
                    if line.startswith("event: "):
                        data_lines = []
                    elif line.startswith("data: "):
                        data_lines.append(line[len("data: "):])
                    elif line == "" and data_lines:
                        # Empty line marks end of an SSE event
                        payload = "\n".join(data_lines)
                        try:
                            data = json.loads(payload)
                        except json.JSONDecodeError:
                            data_lines = []
                            continue
                        # The tools/list result has id "cache-init"
                        if data.get("id") == "cache-init":
                            tools = data.get("result", {}).get("tools", [])
                            async with _cache_lock:
                                _tool_cache = tools
                                _tool_category_map = _populate_category_map(tools)
                            logger.info("Tool cache refreshed: %d tools loaded", len(_tool_cache))
                            return
                        data_lines = []
        except Exception:
            logger.exception("Failed to refresh tool cache from MCP server")


async def _ensure_tool_cache(client: httpx.AsyncClient) -> None:
    """Refresh the cache if it is empty."""
    if not _tool_cache:
        await _refresh_tool_cache(client)


def _get_tool_category(tool_name: str) -> str:
    """Look up a tool's risk category from the cache."""
    return _tool_category_map.get(tool_name, "unknown")


# --- OPA policy check ---

async def _check_opa_policy(
    client: httpx.AsyncClient, tool_name: str, category: str
) -> bool:
    """Query OPA to decide whether a tool call is allowed.

    Returns True if allowed, False if denied or on error.
    """
    with tracer.start_as_current_span(
        "policy_check",
        attributes={
            "opa.tool": tool_name,
            "opa.category": category,
        },
    ) as span:
        try:
            payload = {"input": {"tool": tool_name, "category": category}}
            resp = await client.post(
                f"{OPA_URL}/v1/data/tool_access/allow",
                json=payload,
                timeout=5.0,
            )
            resp.raise_for_status()
            result = resp.json().get("result", False)
            allowed = bool(result)
            span.set_attribute("opa.decision", "allow" if allowed else "deny")
            logger.info(
                "OPA policy check: tool=%s category=%s decision=%s",
                tool_name, category, "allow" if allowed else "deny",
            )
            return allowed
        except Exception:
            logger.exception("OPA policy check failed for tool=%s", tool_name)
            span.set_attribute("opa.decision", "error")
            span.set_status(StatusCode.ERROR, "OPA policy check failed")
            return False


def _make_jsonrpc_error(request_id, code: int, message: str) -> dict:
    """Build a JSON-RPC 2.0 error response."""
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {"code": code, "message": message},
    }


# --- Application lifecycle ---

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage the shared httpx client and warm the tool cache."""
    async with httpx.AsyncClient() as client:
        app.state.http_client = client
        # Warm tool cache in the background (don't block startup if MCP server is slow)
        asyncio.create_task(_refresh_tool_cache(client))
        yield


app = FastAPI(title="MCP Proxy", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

FastAPIInstrumentor.instrument_app(app)


# --- SSE stream snooping ---

def _try_cache_from_sse(data: str) -> None:
    """Attempt to populate the tool cache from a tools/list result on the SSE stream.

    This is a best-effort, non-blocking operation. If the data isn't a
    tools/list response or can't be parsed, it silently does nothing.
    """
    global _tool_cache, _tool_category_map
    try:
        payload = json.loads(data)
    except (json.JSONDecodeError, TypeError):
        return
    # Only cache if the response contains a tools list
    result = payload.get("result", {})
    if not isinstance(result, dict):
        return
    tools = result.get("tools")
    if tools is None:
        return
    _tool_cache = tools
    _tool_category_map = _populate_category_map(tools)
    logger.info("Tool cache populated from SSE stream: %d tools", len(tools))


# --- Endpoints ---

@app.get("/health")
async def health():
    return {"status": "ok", "tools_cached": len(_tool_cache)}


@app.get("/metrics")
async def metrics():
    """Stub for Prometheus scraping. Returns basic counters as text."""
    # Placeholder -- a full implementation would use prometheus_client
    return Response(
        content="# HELP mcp_proxy_up Whether the proxy is running\nmcp_proxy_up 1\n",
        media_type="text/plain; charset=utf-8",
    )


@app.get("/sse")
async def sse_proxy(request: Request):
    """Proxy the SSE stream from the MCP server back to the agent.

    The MCP SSE transport works as follows:
    1. Client GETs /sse on the server
    2. Server pushes an event containing the message endpoint URL
    3. Client then POSTs JSON-RPC messages to that endpoint

    This proxy rewrites the message endpoint URL so the agent sends
    its messages through the proxy instead of directly to the MCP server.
    """
    client: httpx.AsyncClient = request.app.state.http_client

    async def stream_sse():
        with tracer.start_as_current_span(
            "sse_connect",
            attributes={"mcp.server_url": MCP_SERVER_URL},
        ):
            try:
                async with client.stream(
                    "GET", f"{MCP_SERVER_URL}/sse", timeout=None
                ) as upstream:
                    async for line in upstream.aiter_lines():
                        if await request.is_disconnected():
                            break
                        # Rewrite the message endpoint so the agent routes
                        # through the proxy rather than hitting the MCP server
                        # directly. The MCP server sends something like:
                        #   data: /messages/?session_id=abc
                        # We rewrite it to point at our own /messages/ endpoint.
                        if line.startswith("data: ") and "/messages/" in line:
                            path = line[len("data: "):]
                            rewritten = f"data: /messages/{path.split('/messages/')[-1]}"
                            yield rewritten + "\n"
                        else:
                            # Opportunistically populate tool cache from
                            # tools/list responses flowing through the stream
                            if line.startswith("data: "):
                                _try_cache_from_sse(line[len("data: "):])
                            yield line + "\n"
            except httpx.ReadError:
                logger.info("SSE upstream connection closed")
            except Exception:
                logger.exception("SSE proxy error")

    return StreamingResponse(stream_sse(), media_type="text/event-stream")


@app.post("/messages/")
@app.post("/messages/{path:path}")
async def forward_message(request: Request, path: str = ""):
    """Intercept MCP JSON-RPC messages, apply policy, and forward to the server.

    For tools/call messages the proxy:
    1. Logs the call details
    2. Checks OPA policy based on the tool category
    3. Blocks denied calls with a JSON-RPC error
    4. Forwards allowed calls and returns the server response
    """
    client: httpx.AsyncClient = request.app.state.http_client

    body = await request.body()
    try:
        message = json.loads(body)
    except json.JSONDecodeError:
        return JSONResponse(
            _make_jsonrpc_error(None, -32700, "Parse error"), status_code=400
        )

    method = message.get("method", "")
    request_id = message.get("id")
    params = message.get("params", {})

    logger.info("MCP message: method=%s id=%s", method, request_id)

    with tracer.start_as_current_span(
        "mcp_message",
        attributes={"mcp.method": method, "mcp.request_id": str(request_id)},
    ) as span:
        # --- Policy gate for tool calls ---
        if method == "tools/call":
            tool_name = params.get("name", "")
            category = _get_tool_category(tool_name)
            span.set_attribute("mcp.tool_name", tool_name)
            span.set_attribute("mcp.tool_category", category)

            with tracer.start_as_current_span(
                "tool_call",
                attributes={
                    "tool.name": tool_name,
                    "tool.category": category,
                },
            ) as tool_span:
                allowed = await _check_opa_policy(client, tool_name, category)
                tool_span.set_attribute("policy.decision", "allow" if allowed else "deny")

                if not allowed:
                    logger.warning("OPA DENIED tool call: %s (category=%s)", tool_name, category)
                    tool_span.set_status(StatusCode.ERROR, "Policy denied")
                    return JSONResponse(
                        _make_jsonrpc_error(
                            request_id,
                            -32001,
                            f"Policy denied: tool '{tool_name}' (category={category}) is not allowed",
                        )
                    )

                logger.info("OPA ALLOWED tool call: %s (category=%s)", tool_name, category)

        # --- Forward to MCP server ---
        forward_path = f"/messages/{path}" if path else "/messages/"
        # Preserve query string (session_id etc.)
        query_string = str(request.url.query)
        if query_string:
            forward_path = f"{forward_path}?{query_string}"

        try:
            upstream_resp = await client.post(
                f"{MCP_SERVER_URL}{forward_path}",
                content=body,
                headers={"Content-Type": "application/json"},
                timeout=30.0,
            )
            span.set_attribute("mcp.upstream_status", upstream_resp.status_code)

            # Return the upstream response as-is
            return Response(
                content=upstream_resp.content,
                status_code=upstream_resp.status_code,
                headers=dict(upstream_resp.headers),
            )
        except httpx.TimeoutException:
            logger.error("Timeout forwarding to MCP server: %s", forward_path)
            span.set_status(StatusCode.ERROR, "Upstream timeout")
            return JSONResponse(
                _make_jsonrpc_error(request_id, -32000, "MCP server timeout"),
                status_code=504,
            )
        except httpx.ConnectError:
            logger.error("Cannot connect to MCP server at %s", MCP_SERVER_URL)
            span.set_status(StatusCode.ERROR, "Upstream unreachable")
            return JSONResponse(
                _make_jsonrpc_error(request_id, -32000, "MCP server unreachable"),
                status_code=502,
            )


@app.get("/api/traces")
async def get_traces(service: str = OTEL_SERVICE_NAME, limit: int = 20):
    """Query Jaeger HTTP API for recent traces and return them to the dashboard."""
    client: httpx.AsyncClient = app.state.http_client
    with tracer.start_as_current_span("query_traces"):
        try:
            resp = await client.get(
                f"{JAEGER_QUERY_URL}/api/traces",
                params={"service": service, "limit": limit},
                timeout=10.0,
            )
            resp.raise_for_status()
            return resp.json()
        except Exception:
            logger.exception("Failed to query Jaeger traces")
            return JSONResponse(
                {"error": "Failed to fetch traces from Jaeger"},
                status_code=502,
            )


@app.get("/api/tools")
async def get_tools():
    """Return the cached list of tools available on the MCP server."""
    client: httpx.AsyncClient = app.state.http_client
    await _ensure_tool_cache(client)
    return {
        "tools": _tool_cache,
        "categories": _tool_category_map,
    }
