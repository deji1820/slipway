-- CreateEnum
CREATE TYPE "ChannelState" AS ENUM ('Provisioning', 'Available', 'Leased', 'Submitted', 'Failed', 'Resync', 'Draining', 'Merged');

-- CreateTable
CREATE TABLE "Operator" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "treasuryPublicKey" TEXT NOT NULL,
    "treasurySecretEnc" TEXT NOT NULL,
    "feeAccountPublicKey" TEXT NOT NULL,
    "feeAccountSecretEnc" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Operator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "apiKeyHash" TEXT NOT NULL,
    "operationSourcePublicKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelAccount" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "secretKeyEnc" TEXT NOT NULL,
    "state" "ChannelState" NOT NULL DEFAULT 'Provisioning',
    "sequence" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lease" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelAccountId" TEXT NOT NULL,
    "envelopeXdr" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "resultHash" TEXT,
    "resultCode" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Lease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoolConfig" (
    "operatorId" TEXT NOT NULL,
    "minChannels" INTEGER NOT NULL DEFAULT 10,
    "maxChannels" INTEGER NOT NULL DEFAULT 100,
    "safetyFactor" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "leaseTimeoutSeconds" INTEGER NOT NULL DEFAULT 30,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoolConfig_pkey" PRIMARY KEY ("operatorId")
);

-- CreateTable
CREATE TABLE "MetricSnapshot" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "throughputTps" DOUBLE PRECISION NOT NULL,
    "utilizationPct" DOUBLE PRECISION NOT NULL,
    "reserveCostXlm" DOUBLE PRECISION NOT NULL,
    "feeBalanceXlm" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "MetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Operator_username_key" ON "Operator"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_apiKeyHash_key" ON "Tenant"("apiKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelAccount_publicKey_key" ON "ChannelAccount"("publicKey");

-- CreateIndex
CREATE INDEX "ChannelAccount_operatorId_state_idx" ON "ChannelAccount"("operatorId", "state");

-- CreateIndex
CREATE INDEX "Lease_channelAccountId_idx" ON "Lease"("channelAccountId");

-- CreateIndex
CREATE INDEX "Lease_tenantId_idx" ON "Lease"("tenantId");

-- CreateIndex
CREATE INDEX "MetricSnapshot_operatorId_timestamp_idx" ON "MetricSnapshot"("operatorId", "timestamp");

-- AddForeignKey
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelAccount" ADD CONSTRAINT "ChannelAccount_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "ChannelAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolConfig" ADD CONSTRAINT "PoolConfig_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
