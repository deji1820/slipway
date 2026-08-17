/**
 * M2 lease broker test — acquires a channel, has a stand-in "tenant"
 * keypair sign the operation-source side, submits the fully-signed
 * envelope, and confirms it landed on-chain.
 *
 * Run with: pnpm tsx scripts/test-lease.ts
 */
import "dotenv/config";
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { server, NETWORK_PASSPHRASE, fundTestnetAccount } from "../src/lib/stellar";
import { prisma } from "../src/lib/prisma";
import { acquireChannel, submitLease } from "../src/lib/lease-broker";

async function main() {
  console.log("== SLIPWAY M2 lease broker test ==\n");

  const operator = await prisma.operator.findUnique({
    where: { username: "test-operator" },
  });
  if (!operator) {
    throw new Error("No test-operator found — run test-provision.ts first.");
  }

  // Set up a stand-in tenant + their operation-source keypair. In real
  // usage, SLIPWAY never sees this secret key — only the public key is
  // registered. We hold the secret here only because this script is
  // playing both roles (SLIPWAY *and* the tenant) to prove the flow works.
  console.log("Setting up stand-in tenant...");
  const tenantOperationKeypair = Keypair.random();
  await fundTestnetAccount(tenantOperationKeypair.publicKey());
  console.log(`Tenant operation-source account funded: ${tenantOperationKeypair.publicKey()}\n`);

  const tenant = await prisma.tenant.upsert({
    where: { apiKeyHash: "test-tenant-key-hash" },
    update: {},
    create: {
      operatorId: operator.id,
      name: "Test Tenant",
      apiKeyHash: "test-tenant-key-hash",
      operationSourcePublicKey: tenantOperationKeypair.publicKey(),
    },
  });

  // Send payment to a fresh throwaway destination, just to have somewhere
  // to send 1 XLM.
  const destination = Keypair.random();
  await fundTestnetAccount(destination.publicKey()); // destination must exist to receive payment

  // 1. Acquire — SLIPWAY builds the envelope, channel co-signs.
  console.log("Acquiring a channel...");
  const acquireResult = await acquireChannel({
    operatorId: operator.id,
    tenantId: tenant.id,
    operationSource: tenantOperationKeypair.publicKey(),
    operations: [{ destination: destination.publicKey(), amount: "1" }],
  });
  console.log(`Leased channel: ${acquireResult.channelAccount}`);
  console.log(`Lease ID: ${acquireResult.leaseId}`);
  console.log(`Expires at: ${acquireResult.expiresAt.toISOString()}\n`);

  // 2. Tenant signs the operation-source side.
  console.log("Tenant signing envelope...");
  const tx = TransactionBuilder.fromXDR(acquireResult.envelopeXdr, NETWORK_PASSPHRASE);
  (tx as any).sign(tenantOperationKeypair);
  const fullySignedXdr = tx.toXDR();
  console.log("Signed.\n");

  // 3. Submit.
  console.log("Submitting...");
  const submitResult = await submitLease(acquireResult.leaseId, fullySignedXdr);
  console.log("Result:", submitResult);

  if (submitResult.status === "succeeded") {
    console.log(`\n✅ Payment landed on-chain: https://stellar.expert/explorer/testnet/tx/${submitResult.hash}`);
  } else {
    console.log(`\n❌ Submission failed with code: ${submitResult.resultCode}`);
  }
}

main()
  .catch((err) => {
    console.error("Lease broker test failed.");
    if (err?.response?.data?.extras) {
      console.error("Horizon result_codes:", JSON.stringify(err.response.data.extras, null, 2));
    } else {
      console.error(err);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
