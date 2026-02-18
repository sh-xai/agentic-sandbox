// ABOUTME: Policy test API route that queries OPA for tool access decisions.
// ABOUTME: Accepts tool name and category, returns whether access is allowed.
import { NextRequest, NextResponse } from "next/server";
import { OPA_URL } from "@/config";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await fetch(`${OPA_URL}/v1/data/tool_access/allow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: { tool: body.tool, category: body.category } }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `OPA returned ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json({
      tool: body.tool,
      category: body.category,
      allowed: data.result === true,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to test policy" },
      { status: 502 }
    );
  }
}
