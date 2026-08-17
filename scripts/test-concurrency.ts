/**
 * Concurrency test — the spec's #1 correctness requirement: fire many
 * simultaneous acquireChannel() calls against the pool and verify no
 * channel is ever double-leased. Excess requests (more than the pool
 * has available) should fail cleanly with NoAvailableChannelError, not
 * corrupt state.
 *
 * Run with: pnpm tsx scripts/test-concurrency.ts
 */
import "dotenv/config";
import { Keypair } from "@stellar/stellar-sdk";
import { fundTestnetAccount } from "../src/lib/stellar";
import { prisma } from "../src/lib/prisma";
import { acquireChannel, releaseLease, NoAvailableChannelError } from "../src/lib/lease-broker";

const CONCURRENT_REQUESTS = 20; // deliberately more than the pool has available

async function main() {
  console.log("== SLIPWAY concurrency test ==\n");

  const operator = await prisma.operator.findUnique({
    where: { username: "test-operator" },
  });
  if (!operator) {
    throw new Error("No test-operator found — run test-provision.ts first.");
  }

  const availableCount = await prisma.channelAccount.count({
    where: { operatorId: operator.id, state: "Available" },
  });
  console.log(`Pool has ${availableCount} Available channel(s).`);
  console.log(`Firing ${CONCURRENT_REQUESTS} concurrent acquire() calls...\n`);

  // A single stand-in operation-source public key is fine here — we're
  // testing channel allocation, not building real distinct payments.
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

  const attempts = Array.from({ length: CONCURRENT_REQUESTS }, (_, i) =>
    acquireChannel({
      operatorId: operator.id,
      tenantId: tenant.id,
      operationSource: stubOperationSource,
      operations: [{ destination: stubOperationSource, amount: "1" }],
    })
      .then((result) => ({ i, ok: true as const, result }))
      .catch((err) => ({ i, ok: false as const, err }))
  );

  const results = await Promise.all(attempts);

  const succeeded = results.filter((r) => r.ok) as Array<{ i: number; ok: true; result: any }>;
  const failed = results.filter((r) => !r.ok) as Array<{ i: number; ok: false; err: any }>;

  console.log(`Succeeded: ${succeeded.length}`);
  console.log(`Failed: ${failed.length}\n`);

  // The critical check: no channel public key appears more than once
  // across all successful acquisitions.
  const claimedChannels = succeeded.map((r) => r.result.channelAccount);
  const uniqueChannels = new Set(claimedChannels);

  if (claimedChannels.length !== uniqueChannels.size) {
    console.log("❌ FAILED: a channel was leased more than once!");
    console.log(claimedChannels);
    process.exitCode = 1;
  } else {
    console.log(`✅ No double-leases: ${claimedChannels.length} successful acquires, all distinct channels.`);
  }

  // Every failure should be the expected "pool exhausted" error, not
  // something unexpected (e.g. a DB deadlock or unhandled exception).
  const unexpectedFailures = failed.filter((r) => !(r.err instanceof NoAvailableChannelError));
  if (unexpectedFailures.length > 0) {
    console.log(`\n❌ ${unexpectedFailures.length} failure(s) were NOT clean pool-exhaustion errors:`);
    for (const f of unexpectedFailures) console.log(`  [${f.i}]`, f.err.message ?? f.err);
    process.exitCode = 1;
  } else {
    console.log(`✅ All ${failed.length} failures were clean NoAvailableChannelError (pool exhaustion), as expected.`);
  }

  // Clean up — release everything we successfully leased so the pool
  // isn't left artificially drained after this test.
  console.log("\nReleasing all successfully leased channels...");
  for (const r of succeeded) {
    await releaseLease(r.result.leaseId);
  }
  console.log("Done. (Released channels are now in Resync — run test-reconcile.ts to bring them back to Available.)");
}

main()
  .catch((err) => {
    console.error("Concurrency test crashed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
