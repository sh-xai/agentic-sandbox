# ABOUTME: FastMCP server exposing sample tools (read, write, destructive) for agent interaction.
# ABOUTME: Tools are categorized by risk level for OPA policy enforcement via tags and annotations.

import os
import platform
import shutil
import subprocess
import socket
from datetime import datetime, timezone
from pathlib import Path

from fastmcp import FastMCP
from mcp.types import ToolAnnotations
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource

WORKSPACE = Path(os.environ.get("WORKSPACE_DIR", "/workspace"))

# --- OpenTelemetry setup ---

resource = Resource.create({"service.name": os.environ.get("OTEL_SERVICE_NAME", "mcp-server")})
provider = TracerProvider(resource=resource)

otlp_endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT")
if otlp_endpoint:
    exporter = OTLPSpanExporter(endpoint=otlp_endpoint, insecure=True)
    provider.add_span_processor(BatchSpanProcessor(exporter))

trace.set_tracer_provider(provider)
tracer = trace.get_tracer("mcp-server")

# --- FastMCP server ---

mcp = FastMCP(
    name="Sandbox Tool Server",
    instructions="Provides file system and command tools within a sandboxed /workspace directory.",
)


def _resolve_path(user_path: str) -> Path:
    """Resolve a user-supplied path to an absolute path within the workspace sandbox."""
    candidate = Path(user_path)
    if not candidate.is_absolute():
        candidate = WORKSPACE / candidate
    resolved = candidate.resolve()
    workspace_resolved = WORKSPACE.resolve()
    if not str(resolved).startswith(str(workspace_resolved)):
        raise ValueError(f"Path '{user_path}' resolves outside the workspace: {resolved}")
    return resolved


# ========== Read tools (safe) ==========


@mcp.tool(
    tags={"read"},
    annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False),
)
def list_files(directory: str = ".") -> str:
    """List files and directories at the given path within the workspace.

    Args:
        directory: Relative or absolute path inside /workspace. Defaults to workspace root.

    Returns:
        A newline-separated listing of entries with type indicators (dir/ or file).
    """
    with tracer.start_as_current_span(
        "tool.list_files",
        attributes={"tool.name": "list_files", "tool.category": "read", "tool.args.directory": directory},
    ):
        target = _resolve_path(directory)
        if not target.exists():
            return f"Error: directory not found: {directory}"
        if not target.is_dir():
            return f"Error: not a directory: {directory}"
        entries = sorted(target.iterdir())
        lines = []
        for entry in entries:
            suffix = "/" if entry.is_dir() else ""
            lines.append(f"{entry.name}{suffix}")
        if not lines:
            return "(empty directory)"
        return "\n".join(lines)


@mcp.tool(
    tags={"read"},
    annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False),
)
def read_file(path: str) -> str:
    """Read the contents of a file within the workspace.

    Args:
        path: Relative or absolute path to a file inside /workspace.

    Returns:
        The file contents as text, or an error message.
    """
    with tracer.start_as_current_span(
        "tool.read_file",
        attributes={"tool.name": "read_file", "tool.category": "read", "tool.args.path": path},
    ):
        target = _resolve_path(path)
        if not target.exists():
            return f"Error: file not found: {path}"
        if not target.is_file():
            return f"Error: not a regular file: {path}"
        try:
            return target.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            return f"Error: file is not valid UTF-8 text: {path}"


@mcp.tool(
    tags={"read"},
    annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False),
)
def get_system_info() -> str:
    """Return basic system information about the container.

    Returns:
        Hostname, current time (UTC), platform, Python version, and workspace path.
    """
    with tracer.start_as_current_span(
        "tool.get_system_info",
        attributes={"tool.name": "get_system_info", "tool.category": "read"},
    ):
        info = {
            "hostname": socket.gethostname(),
            "utc_time": datetime.now(timezone.utc).isoformat(),
            "platform": platform.platform(),
            "python_version": platform.python_version(),
            "workspace": str(WORKSPACE),
            "workspace_exists": WORKSPACE.exists(),
        }
        return "\n".join(f"{k}: {v}" for k, v in info.items())


# ========== Write tools (moderate risk) ==========


@mcp.tool(
    tags={"write"},
    annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=True),
)
def write_file(path: str, content: str) -> str:
    """Write content to a file within the workspace. Creates parent directories if needed.

    Args:
        path: Relative or absolute path inside /workspace.
        content: The text content to write.

    Returns:
        Confirmation message with the number of bytes written, or an error.
    """
    with tracer.start_as_current_span(
        "tool.write_file",
        attributes={
            "tool.name": "write_file",
            "tool.category": "write",
            "tool.args.path": path,
            "tool.args.content_length": len(content),
        },
    ):
        try:
            target = _resolve_path(path)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
            return f"Wrote {len(content)} bytes to {path}"
        except ValueError as exc:
            return f"Error: {exc}"
        except OSError as exc:
            return f"Error writing file: {exc}"


@mcp.tool(
    tags={"write"},
    annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=True),
)
def create_directory(path: str) -> str:
    """Create a directory (and any missing parents) within the workspace.

    Args:
        path: Relative or absolute path inside /workspace.

    Returns:
        Confirmation message, or an error.
    """
    with tracer.start_as_current_span(
        "tool.create_directory",
        attributes={"tool.name": "create_directory", "tool.category": "write", "tool.args.path": path},
    ):
        try:
            target = _resolve_path(path)
            target.mkdir(parents=True, exist_ok=True)
            return f"Directory created: {path}"
        except ValueError as exc:
            return f"Error: {exc}"
        except OSError as exc:
            return f"Error creating directory: {exc}"


# ========== Destructive tools (high risk) ==========


@mcp.tool(
    tags={"destructive"},
    annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True),
)
def delete_file(path: str) -> str:
    """Delete a file or directory within the workspace.

    Args:
        path: Relative or absolute path inside /workspace.

    Returns:
        Confirmation message, or an error.
    """
    with tracer.start_as_current_span(
        "tool.delete_file",
        attributes={"tool.name": "delete_file", "tool.category": "destructive", "tool.args.path": path},
    ):
        try:
            target = _resolve_path(path)
            if not target.exists():
                return f"Error: path not found: {path}"
            if target.is_dir():
                shutil.rmtree(target)
                return f"Deleted directory: {path}"
            else:
                target.unlink()
                return f"Deleted file: {path}"
        except ValueError as exc:
            return f"Error: {exc}"
        except OSError as exc:
            return f"Error deleting: {exc}"


@mcp.tool(
    tags={"destructive"},
    annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, openWorldHint=True),
)
def execute_command(command: str) -> str:
    """Execute a shell command within the workspace directory.

    The command runs with /workspace as the working directory and has a 30-second timeout.

    Args:
        command: The shell command to execute.

    Returns:
        Combined stdout and stderr output, or an error message.
    """
    with tracer.start_as_current_span(
        "tool.execute_command",
        attributes={"tool.name": "execute_command", "tool.category": "destructive", "tool.args.command": command},
    ):
        try:
            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                timeout=30,
                cwd=str(WORKSPACE),
            )
            output = ""
            if result.stdout:
                output += result.stdout
            if result.stderr:
                output += f"\n[stderr]\n{result.stderr}"
            if result.returncode != 0:
                output += f"\n[exit code: {result.returncode}]"
            return output.strip() or "(no output)"
        except subprocess.TimeoutExpired:
            return "Error: command timed out after 30 seconds"
        except OSError as exc:
            return f"Error executing command: {exc}"


# --- Entry point ---

if __name__ == "__main__":
    WORKSPACE.mkdir(parents=True, exist_ok=True)
    mcp.run(transport="sse", host="0.0.0.0", port=8000)
