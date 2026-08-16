/**
 * M1 reclamation test — marks a channel Draining, then merges it back to
 * the treasury on-chain (reclaiming the sponsored reserve), and updates
 * its state to Merged in the database.
 *
 * Run with: pnpm tsx scripts/test-reclaim.ts
 */
import "dotenv/config";
import {
  Keypair,
  TransactionBuilder,
  Operation,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { server, NETWORK_PASSPHRASE } from "../src/lib/stellar";
import { prisma } from "../src/lib/prisma";

// NOTE: same placeholder as test-provision.ts — replace with real
// decryption (matching whatever encryption scheme secretKeyEnc actually
// uses) before this touches anything beyond local experiments.
function placeholderDecrypt(enc: string): string {
  return Buffer.from(enc, "base64").toString("utf-8");
}

async function main() {
  console.log("== SLIPWAY M1 reclamation test ==\n");

  const operator = await prisma.operator.findUnique({
    where: { username: "test-operator" },
  });
  if (!operator) {
    throw new Error("No test-operator found — run test-provision.ts first.");
  }

  // Pick a Draining channel left over from a failed prior run first (retry),
  // otherwise pick a fresh Available one.
  const channel =
    (await prisma.channelAccount.findFirst({
      where: { operatorId: operator.id, state: "Draining" },
    })) ??
    (await prisma.channelAccount.findFirst({
      where: { operatorId: operator.id, state: "Available" },
    }));
  if (!channel) {
    throw new Error("No Available or Draining channel found to reclaim.");
  }

  console.log(`Reclaiming channel: ${channel.publicKey}`);

  // 1. Mark Draining — no new leases against this channel from here on.
  await prisma.channelAccount.update({
    where: { id: channel.id },
    data: { state: "Draining" },
  });
  console.log("State -> Draining");

  // 2. Merge the channel account back into the treasury on-chain.
  // Account Merge sends the channel's remaining XLM balance (0, since it
  // was sponsored) to the destination, and removes the account entirely —
  // this is what actually releases the sponsored base reserve.
  const channelKeypair = Keypair.fromSecret(placeholderDecrypt(channel.secretKeyEnc));
  const channelAccount = await server.loadAccount(channel.publicKey);

  const innerTx = new TransactionBuilder(channelAccount, {
    fee: "0", // inner tx fee is irrelevant once fee-bumped; keep at 0
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.accountMerge({
        destination: operator.treasuryPublicKey,
      })
    )
    .setTimeout(30)
    .build();

  innerTx.sign(channelKeypair);

  // Wrap in a fee-bump paid by the treasury — the channel account has zero
  // XLM and should never need any, per the spec's fee-bump preference.
  const treasuryKeypair = Keypair.fromSecret(placeholderDecrypt(operator.treasurySecretEnc));
  const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
    treasuryKeypair,
    BASE_FEE,
    innerTx,
    NETWORK_PASSPHRASE
  );
  feeBumpTx.sign(treasuryKeypair);

  const result = await server.submitTransaction(feeBumpTx);
  console.log(`Merge transaction submitted: ${result.hash}`);

  // 3. Update state to Merged — this channel no longer exists on-chain.
  await prisma.channelAccount.update({
    where: { id: channel.id },
    data: { state: "Merged" },
  });
  console.log("State -> Merged\n");

  const [total, available, merged] = await Promise.all([
    prisma.channelAccount.count({ where: { operatorId: operator.id } }),
    prisma.channelAccount.count({ where: { operatorId: operator.id, state: "Available" } }),
    prisma.channelAccount.count({ where: { operatorId: operator.id, state: "Merged" } }),
  ]);

  console.log("== Pool status ==");
  console.log({ total, available, merged });
}

main()
  .catch((err) => {
    console.error("Reclamation test failed.");
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