// ABOUTME: Policy listing API route that proxies to the OPA service.
// ABOUTME: Returns all loaded Rego policies with their raw source and AST.
import { NextResponse } from "next/server";
import { OPA_URL } from "@/config";

export async function GET() {
  try {
    const response = await fetch(`${OPA_URL}/v1/policies`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `OPA returned ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch policies" },
      { status: 502 }
    );
  }
}
