import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  // v1 is single-tenant deployable (per SPEC.md scope) — there's exactly
  // one operator per deployment, so we don't need per-request operator
  // resolution here. This assumption breaks in the v2 multi-tenant
  // follow-on and will need revisiting then.
  const operator = await prisma.operator.findFirst();
  if (!operator) {
    return NextResponse.json({ error: "No operator configured" }, { status: 503 });
  }

  const counts = await prisma.channelAccount.groupBy({
    by: ["state"],
    where: { operatorId: operator.id },
    _count: true,
  });

  const byState: Record<string, number> = {};
  for (const row of counts) byState[row.state] = row._count;

  const total = Object.values(byState).reduce((sum, n) => sum + n, 0);
  const available = byState["Available"] ?? 0;
  const leased = byState["Leased"] ?? 0;
  const resyncing = byState["Resync"] ?? 0;
  const utilisationPct = total > 0 ? Math.round((leased / total) * 100) : 0;

  return NextResponse.json({ total, available, leased, resyncing, utilisationPct }, { status: 200 });
}
