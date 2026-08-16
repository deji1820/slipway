/**
 * M1 test script — provisions a small pool of channel accounts on Stellar
 * testnet, using sponsored reserves from a treasury account, and records
 * them in the database with state Available.
 *
 * Run with: pnpm tsx scripts/test-provision.ts
 */
import "dotenv/config";
import {
  Keypair,
  TransactionBuilder,
  Operation,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { server, NETWORK_PASSPHRASE, fundTestnetAccount } from "../src/lib/stellar";
import { prisma } from "../src/lib/prisma";

const CHANNELS_TO_PROVISION = 5;

// NOTE: this is a placeholder, NOT real encryption — swap for KMS or
// application-layer encryption (e.g. via a library like @47ng/cloak)
// before this touches anything beyond local testnet experiments.
function placeholderEncrypt(secret: string): string {
  return Buffer.from(secret).toString("base64");
}

async function main() {
  console.log("== SLIPWAY M1 test provisioning ==\n");

  // 1. Treasury account — generate + fund fresh each run for this test.
  const treasury = Keypair.random();
  console.log(`Treasury public key: ${treasury.publicKey()}`);
  console.log("Funding treasury via Friendbot...");
  await fundTestnetAccount(treasury.publicKey());
  console.log("Treasury funded.\n");

  // 2. Ensure an Operator row exists for this treasury.
  const operator = await prisma.operator.upsert({
    where: { username: "test-operator" },
    update: {},
    create: {
      username: "test-operator",
      passwordHash: "not-set-for-test-script",
      treasuryPublicKey: treasury.publicKey(),
      treasurySecretEnc: placeholderEncrypt(treasury.secret()),
      feeAccountPublicKey: treasury.publicKey(), // reuse treasury as fee account for this test
      feeAccountSecretEnc: placeholderEncrypt(treasury.secret()),
    },
  });
  console.log(`Operator ready: ${operator.id}\n`);

  // 3. Provision N channel accounts, sponsored by the treasury.
  console.log(`Provisioning ${CHANNELS_TO_PROVISION} channel accounts...`);

  for (let i = 0; i < CHANNELS_TO_PROVISION; i++) {
    const channel = Keypair.random();

    const treasuryAccount = await server.loadAccount(treasury.publicKey());

    const tx = new TransactionBuilder(treasuryAccount, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        Operation.beginSponsoringFutureReserves({
          sponsoredId: channel.publicKey(),
        })
      )
      .addOperation(
        Operation.createAccount({
          destination: channel.publicKey(),
          startingBalance: "0", // zero balance — reserve is sponsored, fees will be fee-bumped later
        })
      )
      .addOperation(
        Operation.endSponsoringFutureReserves({
          source: channel.publicKey(),
        })
      )
      .setTimeout(30)
      .build();

    tx.sign(treasury, channel); // channel must co-sign to accept sponsorship

    const result = await server.submitTransaction(tx);
    console.log(`  Channel ${i + 1}/${CHANNELS_TO_PROVISION}: ${channel.publicKey()} (tx ${result.hash})`);

    // Read back the channel's starting sequence number from chain.
    const channelAccount = await server.loadAccount(channel.publicKey());

    await prisma.channelAccount.create({
      data: {
        operatorId: operator.id,
        publicKey: channel.publicKey(),
        secretKeyEnc: placeholderEncrypt(channel.secret()),
        state: "Available",
        sequence: channelAccount.sequenceNumber(),
      },
    });
  }

  console.log("\nAll channels provisioned and recorded.\n");

  // 4. Print pool status, same shape as GET /v1/pool/status will return.
  const [total, available] = await Promise.all([
    prisma.channelAccount.count({ where: { operatorId: operator.id } }),
    prisma.channelAccount.count({ where: { operatorId: operator.id, state: "Available" } }),
  ]);

  console.log("== Pool status ==");
  console.log({ total, available, utilisationPct: 0 });
}

main()
  .catch((err) => {
    console.error("Test provisioning failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
