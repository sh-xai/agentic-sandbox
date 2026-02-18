// ABOUTME: Task submission API route that proxies to the agent service.
// ABOUTME: Accepts a task description and returns the created task ID.
import { NextRequest, NextResponse } from "next/server";
import { AGENT_URL } from "@/config";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await fetch(`${AGENT_URL}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
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
      { error: err instanceof Error ? err.message : "Failed to submit task" },
      { status: 502 }
    );
  }
}
