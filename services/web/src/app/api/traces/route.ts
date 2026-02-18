// ABOUTME: Trace API route that proxies requests to the Jaeger query API.
// ABOUTME: Accepts service, limit, and lookback query params.
import { NextRequest, NextResponse } from "next/server";
import { JAEGER_URL } from "@/config";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const service = searchParams.get("service") || "mcp-proxy";
  const limit = searchParams.get("limit") || "20";
  const lookback = searchParams.get("lookback") || "1h";

  const now = Date.now() * 1000;
  const lookbackUs = parseLookback(lookback);
  const start = now - lookbackUs;

  const url = new URL(`${JAEGER_URL}/api/traces`);
  url.searchParams.set("service", service);
  url.searchParams.set("limit", limit);
  url.searchParams.set("start", start.toString());
  url.searchParams.set("end", now.toString());

  try {
    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Jaeger returned ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch traces" },
      { status: 502 }
    );
  }
}

function parseLookback(lookback: string): number {
  const match = lookback.match(/^(\d+)(m|h|d)$/);
  if (!match) return 3600 * 1000 * 1000;

  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    m: 60 * 1000 * 1000,
    h: 3600 * 1000 * 1000,
    d: 86400 * 1000 * 1000,
  };
  return value * (multipliers[unit] || 3600 * 1000 * 1000);
}
