# ABOUTME: LangChain agent that discovers and invokes MCP tools through the proxy.
# ABOUTME: Instrumented with OpenTelemetry for distributed tracing.

import asyncio
import logging
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from enum import Enum

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace import StatusCode
from pydantic import BaseModel

# --- Configuration ---

MCP_PROXY_URL = os.environ.get("MCP_PROXY_URL", "http://mcp-proxy:8001")
OTEL_ENDPOINT = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT")
OTEL_SERVICE_NAME = os.environ.get("OTEL_SERVICE_NAME", "agent")
LLM_MODEL = os.environ.get("LLM_MODEL", "gpt-4.1")

STARTUP_MAX_RETRIES = 10
STARTUP_BASE_DELAY = 2.0

logger = logging.getLogger("agent")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

# --- OpenTelemetry setup ---

resource = Resource.create({"service.name": OTEL_SERVICE_NAME})
provider = TracerProvider(resource=resource)

if OTEL_ENDPOINT:
    exporter = OTLPSpanExporter(endpoint=OTEL_ENDPOINT, insecure=True)
    provider.add_span_processor(BatchSpanProcessor(exporter))

trace.set_tracer_provider(provider)
tracer = trace.get_tracer("agent")

# --- Task storage ---


class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class TaskRequest(BaseModel):
    task: str


class TaskRecord(BaseModel):
    id: str
    task: str
    status: TaskStatus
    result: str | None = None
    error: str | None = None
    created_at: str
    completed_at: str | None = None


_tasks: dict[str, TaskRecord] = {}

# --- Agent state ---

_mcp_client: MultiServerMCPClient | None = None
_agent = None
_tools: list = []
_ready = False


async def _connect_to_mcp() -> None:
    """Connect to MCP proxy via SSE and create the agent.

    Retries with exponential backoff since the proxy may not be ready at
    container startup.
    """
    global _mcp_client, _agent, _tools, _ready

    sse_url = f"{MCP_PROXY_URL}/sse"

    for attempt in range(1, STARTUP_MAX_RETRIES + 1):
        try:
            logger.info(
                "Connecting to MCP proxy at %s (attempt %d/%d)",
                sse_url,
                attempt,
                STARTUP_MAX_RETRIES,
            )
            client = MultiServerMCPClient(
                {
                    "sandbox": {
                        "transport": "sse",
                        "url": sse_url,
                    }
                }
            )
            tools = await client.get_tools()
            if not tools:
                raise RuntimeError("MCP proxy returned zero tools")

            llm = ChatOpenAI(model=LLM_MODEL)
            agent = create_react_agent(llm, tools)

            _mcp_client = client
            _agent = agent
            _tools = tools
            _ready = True

            logger.info(
                "Agent ready: model=%s, %d tools loaded", LLM_MODEL, len(tools)
            )
            return

        except Exception:
            logger.exception(
                "Failed to connect to MCP proxy (attempt %d/%d)",
                attempt,
                STARTUP_MAX_RETRIES,
            )
            if attempt < STARTUP_MAX_RETRIES:
                delay = STARTUP_BASE_DELAY * (2 ** (attempt - 1))
                delay = min(delay, 60.0)
                logger.info("Retrying in %.1f seconds...", delay)
                await asyncio.sleep(delay)

    logger.error("Exhausted all %d connection attempts", STARTUP_MAX_RETRIES)


async def _run_agent_task(task_id: str, description: str) -> None:
    """Execute a task using the agent and record the result."""
    record = _tasks[task_id]
    record.status = TaskStatus.RUNNING

    with tracer.start_as_current_span(
        "agent_task",
        attributes={
            "task.id": task_id,
            "task.description": description,
        },
    ) as span:
        try:
            result = await _agent.ainvoke(
                {"messages": [("human", description)]}
            )
            # Extract the final assistant message content
            messages = result.get("messages", [])
            output_parts = []
            tool_calls_made = []

            for msg in messages:
                if hasattr(msg, "type"):
                    if msg.type == "tool":
                        tool_calls_made.append(msg.name)
                    elif msg.type == "ai" and msg.content:
                        output_parts.append(msg.content)

            final_output = output_parts[-1] if output_parts else "(no output)"

            span.set_attribute("task.tool_calls", ", ".join(tool_calls_made))
            span.set_attribute("task.tool_call_count", len(tool_calls_made))
            span.set_attribute(
                "task.result_length", len(final_output)
            )

            record.result = final_output
            record.status = TaskStatus.COMPLETED
            record.completed_at = datetime.now(timezone.utc).isoformat()

            logger.info(
                "Task %s completed: %d tool calls, %d chars output",
                task_id,
                len(tool_calls_made),
                len(final_output),
            )

        except Exception as exc:
            error_msg = str(exc)
            span.set_status(StatusCode.ERROR, error_msg)
            span.set_attribute("task.error", error_msg)

            record.status = TaskStatus.FAILED
            record.error = error_msg
            record.completed_at = datetime.now(timezone.utc).isoformat()

            logger.exception("Task %s failed", task_id)


# --- Application lifecycle ---


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Connect to MCP proxy and create the agent on startup."""
    await _connect_to_mcp()
    try:
        yield
    finally:
        pass


app = FastAPI(title="Agent", lifespan=lifespan)


# --- Endpoints ---


@app.get("/health")
async def health():
    return {"status": "ok", "ready": _ready}


@app.get("/api/status")
async def status():
    return {
        "ready": _ready,
        "model": LLM_MODEL,
        "tools_loaded": len(_tools),
        "tool_names": [t.name for t in _tools],
        "tasks_total": len(_tasks),
        "tasks_running": sum(
            1 for t in _tasks.values() if t.status == TaskStatus.RUNNING
        ),
    }


@app.post("/api/tasks")
async def create_task(request: TaskRequest):
    if not _ready:
        return JSONResponse({"error": "Agent is not ready"}, status_code=503)

    task_id = str(uuid.uuid4())
    record = TaskRecord(
        id=task_id,
        task=request.task,
        status=TaskStatus.PENDING,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    _tasks[task_id] = record

    # Run in background so the POST returns immediately
    asyncio.create_task(_run_agent_task(task_id, request.task))

    return {"task_id": task_id, "status": record.status}


@app.get("/api/tasks/{task_id}")
async def get_task(task_id: str):
    record = _tasks.get(task_id)
    if not record:
        return JSONResponse({"error": "Task not found"}, status_code=404)
    return record.model_dump()
