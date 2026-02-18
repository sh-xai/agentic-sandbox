// ABOUTME: Per-policy API route for creating, updating, and deleting OPA policies.
// ABOUTME: Proxies PUT (Rego upload) and DELETE operations to OPA by policy ID.
import { NextRequest, NextResponse } from "next/server";
import { OPA_URL } from "@/config";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ policyId: string }> }
) {
  const { policyId } = await params;

  try {
    const body = await request.text();

    const response = await fetch(
      `${OPA_URL}/v1/policies/${encodeURIComponent(policyId)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "text/plain" },
        body,
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `OPA returned ${response.status}: ${errorText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to upload policy" },
      { status: 502 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ policyId: string }> }
) {
  const { policyId } = await params;

  try {
    const response = await fetch(
      `${OPA_URL}/v1/policies/${encodeURIComponent(policyId)}`,
      {
        method: "DELETE",
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: `OPA returned ${response.status}` },
        { status: response.status }
      );
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete policy" },
      { status: 502 }
    );
  }
}
