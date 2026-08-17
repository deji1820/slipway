/**
 * Lease timeout test — acquires a channel and deliberately does nothing
 * with it (no submit, no release), waits past the lease timeout, then
 * runs expireOverdueLeases() and confirms it gets caught and moved to
 * Resync rather than being held forever.
 *
 * Run with: pnpm tsx scripts/test-timeout.ts
 *
 * NOTE: the lease timeout is currently hardcoded to 30s in lease-broker.ts
 * (DEFAULT_LEASE_TIMEOUT_SECONDS). This script waits 32s to be safe.
 */
import "dotenv/config";
import { Keypair } from "@stellar/stellar-sdk";
import { prisma } from "../src/lib/prisma";
import { acquireChannel, expireOverdueLeases } from "../src/lib/lease-broker";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("== SLIPWAY lease timeout test ==\n");

  const operator = await prisma.operator.findUnique({
    where: { username: "test-operator" },
  });
  if (!operator) {
    throw new Error("No test-operator found — run test-provision.ts first.");
  }

  const stubOperationSource = Keypair.random().publicKey();
  const tenant = await prisma.tenant.upsert({
    where: { apiKeyHash: "test-tenant-key-hash" },
    update: {},
    create: {
      operatorId: operator.id,
      name: "Test Tenant",
      apiKeyHash: "test-tenant-key-hash",
      operationSourcePublicKey: stubOperationSource,
    },
  });

  console.log("Acquiring a channel and deliberately abandoning it (no submit, no release)...");
  const result = await acquireChannel({
    operatorId: operator.id,
    tenantId: tenant.id,
    operationSource: stubOperationSource,
    operations: [{ destination: stubOperationSource, amount: "1" }],
  });
  console.log(`Leased: ${result.channelAccount}, expires at ${result.expiresAt.toISOString()}\n`);

  const channelBefore = await prisma.channelAccount.findUnique({
    where: { publicKey: result.channelAccount },
  });
  console.log(`Channel state right after acquire: ${channelBefore?.state} (expected: Leased)\n`);

  const waitMs = 32_000;
  console.log(`Waiting ${waitMs / 1000}s for the lease to expire...`);
  await sleep(waitMs);

  console.log("Running expireOverdueLeases()...");
  const expiredCount = await expireOverdueLeases();
  console.log(`Expired ${expiredCount} lease(s).\n`);

  const channelAfter = await prisma.channelAccount.findUnique({
    where: { publicKey: result.channelAccount },
  });
  const leaseAfter = await prisma.lease.findUnique({ where: { id: result.leaseId } });

  console.log(`Channel state after timeout: ${channelAfter?.state} (expected: Resync)`);
  console.log(`Lease status after timeout: ${leaseAfter?.status} (expected: expired)`);

  if (channelAfter?.state === "Resync" && leaseAfter?.status === "expired") {
    console.log("\n✅ Timeout handling works — abandoned lease was caught and released.");
  } else {
    console.log("\n❌ Timeout handling did not behave as expected.");
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("Timeout test failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
