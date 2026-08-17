import { NextResponse } from "next/server";
import { authenticateTenant } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { releaseLease } from "@/lib/lease-broker";

export async function POST(req: Request) {
  const tenant = await authenticateTenant(req);
  if (!tenant) {
    return NextResponse.json({ error: "Invalid or missing x-api-key header" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.leaseId) {
    return NextResponse.json({ error: "Request body must include `leaseId`" }, { status: 400 });
  }

  const lease = await prisma.lease.findUnique({ where: { id: body.leaseId } });
  if (!lease || lease.tenantId !== tenant.id) {
    return NextResponse.json({ error: "Lease not found" }, { status: 404 });
  }

  try {
    await releaseLease(body.leaseId);
    return NextResponse.json({ released: true }, { status: 200 });
  } catch (err) {
    console.error("release failed:", err);
    return NextResponse.json({ error: "Internal error during release" }, { status: 500 });
  }
}
