import {
  Keypair,
  TransactionBuilder,
  Operation,
  BASE_FEE,
  Account,
  Asset,
} from "@stellar/stellar-sdk";
import { server, NETWORK_PASSPHRASE } from "./stellar";
import { prisma } from "./prisma";
import type { ChannelAccount, Operator } from "@prisma/client";

// NOTE: placeholder, matches the other test scripts — replace with real
// encryption/decryption before this goes anywhere beyond local testnet use.
function placeholderDecrypt(enc: string): string {
  return Buffer.from(enc, "base64").toString("utf-8");
}

const DEFAULT_LEASE_TIMEOUT_SECONDS = 30;
const DEFAULT_TX_TIME_BOUNDS_SECONDS = 60;

export class NoAvailableChannelError extends Error {
  constructor() {
    super("No available channel in the pool.");
  }
}

export interface AcquireParams {
  operatorId: string;
  tenantId: string;
  operationSource: string; // tenant's public key, performs the actual operation
  operations: Array<{ destination: string; amount: string; asset?: "native" }>;
}

export interface AcquireResult {
  leaseId: string;
  channelAccount: string;
  sequence: string;
  envelopeXdr: string;
  expiresAt: Date;
}

/**
 * Acquires an Available channel, builds an unsigned envelope with the
 * channel as transaction source, marks the channel Leased, and returns
 * the envelope for the tenant to sign.
 *
 * Sequence handling: the channel's local `sequence` field is trusted only
 * because it was verified on-chain the last time the channel was in
 * Available state (either freshly provisioned, or resynced after its
 * previous lease resolved). We never re-read from chain here — that's
 * the throughput the whole system exists to provide.
 */
export async function acquireChannel(params: AcquireParams): Promise<AcquireResult> {
  return prisma.$transaction(async (tx) => {
    // Atomically claim one Available channel. The DB transaction + row
    // lock is what prevents two concurrent acquires from getting the
    // same channel — the spec's #1 concurrency requirement.
    const channel = await tx.$queryRaw<ChannelAccount[]>`
      SELECT * FROM "ChannelAccount"
      WHERE "operatorId" = ${params.operatorId} AND state = 'Available'
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;

    if (!channel || channel.length === 0) {
      throw new NoAvailableChannelError();
    }

    const claimed = channel[0];
    const nextSequence = (BigInt(claimed.sequence) + BigInt(1)).toString();

    const timeoutSeconds = DEFAULT_LEASE_TIMEOUT_SECONDS;
    const expiresAt = new Date(Date.now() + timeoutSeconds * 1000);

    // Build the envelope: channel is transaction source (consumes sequence,
    // pays fee), tenant's operationSource performs the actual payment.
    const account = new Account(claimed.publicKey, claimed.sequence);

    const builder = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    }).setTimeout(DEFAULT_TX_TIME_BOUNDS_SECONDS); // mandatory bounded validity window

    for (const op of params.operations) {
      builder.addOperation(
        Operation.payment({
          source: params.operationSource,
          destination: op.destination,
          asset: Asset.native(),
          amount: op.amount,
        })
      );
    }

    const unsignedTx = builder.build();

    // Channel co-signs now (it's SLIPWAY's own key) — tenant adds their
    // operation-source signature after receiving the envelope.
    const channelKeypair = Keypair.fromSecret(placeholderDecrypt(claimed.secretKeyEnc));
    unsignedTx.sign(channelKeypair);

    await tx.channelAccount.update({
      where: { id: claimed.id },
      data: { state: "Leased", sequence: nextSequence, lastUsedAt: new Date() },
    });

    const lease = await tx.lease.create({
      data: {
        tenantId: params.tenantId,
        channelAccountId: claimed.id,
        envelopeXdr: unsignedTx.toXDR(),
        status: "leased",
        expiresAt,
      },
    });

    return {
      leaseId: lease.id,
      channelAccount: claimed.publicKey,
      sequence: nextSequence,
      envelopeXdr: unsignedTx.toXDR(),
      expiresAt,
    };
  });
}

export interface SubmitResult {
  status: "succeeded" | "failed";
  hash?: string;
  resultCode?: string;
}

/**
 * Submits a tenant-signed envelope. On any failure or ambiguous outcome,
 * routes the channel to Resync rather than assuming the sequence is
 * still valid — per the spec's core sequence-management rule.
 */
export async function submitLease(leaseId: string, signedEnvelopeXdr: string): Promise<SubmitResult> {
  const lease = await prisma.lease.findUniqueOrThrow({
    where: { id: leaseId },
    include: { channelAccount: { include: { operator: true } } },
  });

  if (lease.status !== "leased") {
    throw new Error(`Lease ${leaseId} is not in a submittable state (status: ${lease.status})`);
  }

  const innerTx = TransactionBuilder.fromXDR(signedEnvelopeXdr, NETWORK_PASSPHRASE);

  // Wrap in a fee-bump paid by the treasury — the channel account has zero
  // XLM balance by design (sponsored reserve only), per the spec's
  // fee-bump preference. Fee management stays centralised in one account.
  const treasuryKeypair = Keypair.fromSecret(
    placeholderDecrypt(lease.channelAccount.operator.treasurySecretEnc)
  );
  const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
    treasuryKeypair,
    BASE_FEE,
    innerTx as any,
    NETWORK_PASSPHRASE
  );
  feeBumpTx.sign(treasuryKeypair);

  try {
    const result = await server.submitTransaction(feeBumpTx);

    await prisma.$transaction([
      prisma.lease.update({
        where: { id: leaseId },
        data: { status: "succeeded", resultHash: result.hash, resolvedAt: new Date() },
      }),
      prisma.channelAccount.update({
        where: { id: lease.channelAccountId },
        data: { state: "Available" }, // sequence already advanced optimistically at acquire time
      }),
    ]);

    return { status: "succeeded", hash: result.hash };
  } catch (err: any) {
    const resultCode = err?.response?.data?.extras?.result_codes?.transaction ?? "unknown";

    // Any failure (including tx_bad_seq) -> Resync. Never assume the
    // local sequence is still correct after an error.
    await prisma.$transaction([
      prisma.lease.update({
        where: { id: leaseId },
        data: { status: "failed", resultCode, resolvedAt: new Date() },
      }),
      prisma.channelAccount.update({
        where: { id: lease.channelAccountId },
        data: { state: "Resync" },
      }),
    ]);

    return { status: "failed", resultCode };
  }
}

/**
 * Releases a lease without submitting. Per the spec: move to Resync, not
 * straight back to Available — the tenant may still submit the envelope
 * late, and assuming the sequence is unconsumed would cause a collision.
 */
export async function releaseLease(leaseId: string): Promise<void> {
  const lease = await prisma.lease.findUniqueOrThrow({ where: { id: leaseId } });

  if (lease.status !== "leased") {
    throw new Error(`Lease ${leaseId} is not in a releasable state (status: ${lease.status})`);
  }

  await prisma.$transaction([
    prisma.lease.update({
      where: { id: leaseId },
      data: { status: "released", resolvedAt: new Date() },
    }),
    prisma.channelAccount.update({
      where: { id: lease.channelAccountId },
      data: { state: "Resync" },
    }),
  ]);
}

/**
 * Reconciler step: re-reads on-chain sequence for every channel in
 * Resync and moves it back to Available with the corrected sequence.
 */
export async function resyncChannel(channelAccountId: string): Promise<void> {
  const channel = await prisma.channelAccount.findUniqueOrThrow({
    where: { id: channelAccountId },
  });

  const onChain = await server.loadAccount(channel.publicKey);

  await prisma.channelAccount.update({
    where: { id: channel.id },
    data: { state: "Available", sequence: onChain.sequenceNumber() },
  });
}