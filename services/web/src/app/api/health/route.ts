// ABOUTME: Health check API route that probes all backend services.
// ABOUTME: Returns status, latency, and error info for each service.
import { NextResponse } from "next/server";
import { JAEGER_URL, LOKI_URL, PROMETHEUS_URL, MCP_PROXY_URL } from "@/config";
import type { ServiceHealth, HealthResponse } from "@/types";

async function checkService(name: string, url: string): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    });
    const latencyMs = Date.now() - start;
    return {
      name,
      status: response.ok ? "healthy" : "unhealthy",
      url,
      latencyMs,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (err) {
    return {
      name,
      status: "unhealthy",
      url,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function GET() {
  const checks = await Promise.all([
    checkService("MCP Proxy", `${MCP_PROXY_URL}/health`),
    checkService("Jaeger", `${JAEGER_URL}/api/services`),
    checkService("Loki", `${LOKI_URL}/ready`),
    checkService("Prometheus", `${PROMETHEUS_URL}/-/ready`),
  ]);

  const response: HealthResponse = {
    services: checks,
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(response);
}
