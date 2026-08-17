/**
 * Reconciler — finds every channel account in Resync state, re-reads its
 * real sequence number from chain, and moves it back to Available with
 * the corrected sequence. This is what keeps the pool honest after any
 * failed submit, timeout, or release.
 *
 * Run with: pnpm tsx scripts/test-reconcile.ts
 * (In production this runs on a schedule, e.g. every few seconds, as
 * part of the always-on worker service — not invoked by hand like this.)
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { resyncChannel, expireOverdueLeases } from "../src/lib/lease-broker";

async function main() {
  console.log("== SLIPWAY reconciler ==\n");

  const expiredCount = await expireOverdueLeases();
  console.log(`Expired ${expiredCount} overdue lease(s).\n`);

  const operator = await prisma.operator.findUnique({
    where: { username: "test-operator" },
  });
  if (!operator) {
    throw new Error("No test-operator found — run test-provision.ts first.");
  }

  const stuck = await prisma.channelAccount.findMany({
    where: { operatorId: operator.id, state: "Resync" },
  });

  if (stuck.length === 0) {
    console.log("No channels in Resync. Nothing to do.");
  } else {
    console.log(`Found ${stuck.length} channel(s) in Resync:\n`);

    for (const channel of stuck) {
      process.stdout.write(`  Resyncing ${channel.publicKey}... `);
      try {
        await resyncChannel(channel.id);
        console.log("-> Available");
      } catch (err: any) {
        // If the account doesn't exist on-chain anymore (e.g. it was
        // merged in a prior run), this will fail — that's a real signal
        // the local DB and chain have drifted and needs a human look,
        // not something to silently swallow.
        console.log(`FAILED: ${err.message}`);
      }
    }
  }

  const counts = await prisma.channelAccount.groupBy({
    by: ["state"],
    where: { operatorId: operator.id },
    _count: true,
  });

  console.log("\n== Pool status by state ==");
  for (const row of counts) {
    console.log(`  ${row.state}: ${row._count}`);
  }
}

main()
  .catch((err) => {
    console.error("Reconciler failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });