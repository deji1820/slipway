import { NextResponse } from "next/server";
import { authenticateTenant } from "@/lib/auth";
import { acquireChannel, NoAvailableChannelError } from "@/lib/lease-broker";

export async function POST(req: Request) {
  const tenant = await authenticateTenant(req);
  if (!tenant) {
    return NextResponse.json({ error: "Invalid or missing x-api-key header" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.operations) || body.operations.length === 0) {
    return NextResponse.json(
      { error: "Request body must include a non-empty `operations` array" },
      { status: 400 }
    );
  }

  // operationSource is fixed to the tenant's registered public key — a
  // tenant cannot request an envelope built against a different source
  // account than the one they registered. This is a deliberate guardrail,
  // not an oversight.
  try {
    const result = await acquireChannel({
      operatorId: tenant.operatorId,
      tenantId: tenant.id,
      operationSource: tenant.operationSourcePublicKey,
      operations: body.operations,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof NoAvailableChannelError) {
      return NextResponse.json(
        { error: "No available channel in the pool. Retry shortly or check /v1/pool/status." },
        { status: 409 }
      );
    }
    console.error("acquire failed:", err);
    return NextResponse.json({ error: "Internal error during acquire" }, { status: 500 });
  }
}
