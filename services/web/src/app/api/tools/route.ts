// ABOUTME: Tools API route that proxies to the MCP proxy's tool listing endpoint.
// ABOUTME: Returns available MCP tools and their schemas.
import { NextResponse } from "next/server";
import { MCP_PROXY_URL } from "@/config";

export async function GET() {
  try {
    const response = await fetch(`${MCP_PROXY_URL}/api/tools`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `MCP Proxy returned ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch tools" },
      { status: 502 }
    );
  }
}
