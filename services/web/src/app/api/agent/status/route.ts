// ABOUTME: Agent status API route that proxies to the agent service.
// ABOUTME: Returns agent readiness, model info, loaded tools, and task counts.
import { NextResponse } from "next/server";
import { AGENT_URL } from "@/config";

export async function GET() {
  try {
    const response = await fetch(`${AGENT_URL}/api/status`, {
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
      { error: err instanceof Error ? err.message : "Failed to fetch agent status" },
      { status: 502 }
    );
  }
}
