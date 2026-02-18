// ABOUTME: Metrics API route that proxies PromQL queries to Prometheus.
// ABOUTME: Accepts a query param for arbitrary Prometheus queries.
import { NextRequest, NextResponse } from "next/server";
import { PROMETHEUS_URL } from "@/config";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const query = searchParams.get("query") || "up";

  const url = new URL(`${PROMETHEUS_URL}/api/v1/query`);
  url.searchParams.set("query", query);

  try {
    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Prometheus returned ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch metrics" },
      { status: 502 }
    );
  }
}
