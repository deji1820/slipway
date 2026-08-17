import { NextResponse } from "next/server";
import { authenticateTenant } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { submitLease } from "@/lib/lease-broker";

export async function POST(req: Request) {
  const tenant = await authenticateTenant(req);
  if (!tenant) {
    return NextResponse.json({ error: "Invalid or missing x-api-key header" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.leaseId || !body?.signedEnvelopeXdr) {
    return NextResponse.json(
      { error: "Request body must include `leaseId` and `signedEnvelopeXdr`" },
      { status: 400 }
    );
  }

  // Ownership check: a tenant may only submit against their own lease.
  const lease = await prisma.lease.findUnique({ where: { id: body.leaseId } });
  if (!lease || lease.tenantId !== tenant.id) {
    return NextResponse.json({ error: "Lease not found" }, { status: 404 });
  }

  try {
    const result = await submitLease(body.leaseId, body.signedEnvelopeXdr);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("submit failed:", err);
    return NextResponse.json({ error: "Internal error during submit" }, { status: 500 });
  }
}
