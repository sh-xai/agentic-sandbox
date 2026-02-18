// ABOUTME: Log API route that proxies requests to Loki's query_range endpoint.
// ABOUTME: Accepts query, limit, start, and end params for log filtering.
import { NextRequest, NextResponse } from "next/server";
import { LOKI_URL } from "@/config";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const query = searchParams.get("query") || '{job="mcp-proxy"}';
  const limit = searchParams.get("limit") || "100";
  const end = searchParams.get("end") || (Date.now() * 1_000_000).toString();
  const start =
    searchParams.get("start") ||
    (Date.now() * 1_000_000 - 3600 * 1_000_000_000).toString();

  const url = new URL(`${LOKI_URL}/loki/api/v1/query_range`);
  url.searchParams.set("query", query);
  url.searchParams.set("limit", limit);
  url.searchParams.set("start", start);
  url.searchParams.set("end", end);

  try {
    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Loki returned ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch logs" },
      { status: 502 }
    );
  }
}
