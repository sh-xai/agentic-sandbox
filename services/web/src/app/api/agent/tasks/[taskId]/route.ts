// ABOUTME: Task status API route that proxies per-task lookups to the agent service.
// ABOUTME: Returns task status, result, and timing information by task ID.
import { NextRequest, NextResponse } from "next/server";
import { AGENT_URL } from "@/config";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  try {
    const response = await fetch(`${AGENT_URL}/api/tasks/${encodeURIComponent(taskId)}`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Agent returned ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch task status" },
      { status: 502 }
    );
  }
}
