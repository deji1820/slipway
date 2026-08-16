# SLIPWAY — Specification

## Overview

SLIPWAY is a **channel account leasing service** for the Stellar network. Every Stellar account can only have one transaction "in flight" at a time, because a transaction is only valid at `sequence + 1`. High-volume operators (exchanges, anchors, payment processors) work around this by maintaining a pool of "channel accounts" that act as transaction source (paying fees, consuming sequence numbers) while the operator's real account remains the operation source (where funds actually move).

SLIPWAY productizes this workaround: **throughput-as-a-service behind one REST API**, plus a dashboard for pool visibility and the throughput/cost metrics that make a strong grant demo.

**Core guarantee:** SLIPWAY never holds tenant funds and never signs on a tenant's behalf. It builds unsigned transaction envelopes; tenants add their own operation-source signature. Custody risk is low by construction — a compromised channel account can only "grief" its own sequence number, never move money.

## How It Works — Happy Path

1. Tenant application calls `POST /v1/channels/acquire` with the operations it wants to submit.
2. SLIPWAY's lease broker allocates an `Available` channel account, builds a transaction envelope with that channel as the transaction source, and returns the unsigned envelope + a `leaseId`.
3. Tenant signs the envelope with their own operation-source key (never sent to SLIPWAY) and calls `POST /v1/channels/submit`.
4. SLIPWAY's submitter posts the transaction to the network, classifies the result, and releases the channel back to `Available` (or routes it to `Resync` on any ambiguous/failed outcome).
5. A background **reconciler** periodically re-reads on-chain sequence numbers to correct any local drift, and reclaims idle/orphaned channels.

## Setup

**Operator onboarding** (the entity running SLIPWAY, e.g. an exchange or anchor):
- Register an operator account (username/password, seeded admin for demo).
- Connect a Stellar treasury account (public key) that will sponsor channel account reserves.
- Connect a fee account funded with XLM (used for fee-bump wrapping so channels themselves need zero balance).
- Configure pool bounds: min/max channel count, target safety factor, lease timeout duration.

**Tenant onboarding** (an application that leases channels from this SLIPWAY deployment):
- Register a tenant under an operator, receive a `tenantId` and API credentials.
- Tenant never registers or uploads keys — only their public operation-source account is referenced when building envelopes.

## Scope for This Build/Version

- Single-tenant deployable (per SPEC's v1 scope) — multi-tenant isolation is a documented v2/follow-on.
- All web-based: REST API + an admin/operator dashboard.
- No signing on SLIPWAY's side, ever — enforced at the API and code-review level.
- No transaction content validation — SLIPWAY provides sequence capacity, not policy.
- Local network / testnet only for initial milestones (M1–M3); mainnet is M4.

## Additional Showcase for Demo

- **Pool status dashboard**: live view of `total / available / leased / resyncing` channels and utilization %.
- **Throughput chart**: measured sustained tx/sec vs. a single-account baseline — this is the core grant demo artifact per the original spec ("the demo is a number").
- **Reserve cost tracking**: per-channel and total pool XLM reserve cost, and fee-account balance/drain rate.
- **Operator transaction history**: leased/submitted/failed/resynced channel events, timestamped.

---

## Pages (Dashboard)

| Page | Purpose |
|---|---|
| `/login` | Operator/admin login (username + password) |
| `/dashboard` | Pool status: total/available/leased/resyncing counts, utilization %, live throughput chart |
| `/dashboard/channels` | Table of all channel accounts with state, sequence, last-used timestamp; filter by state |
| `/dashboard/channels/[id]` | Single channel detail: full lifecycle history, current lease (if any) |
| `/dashboard/tenants` | List of tenants, their lease volume, error rates |
| `/dashboard/metrics` | Throughput vs. baseline chart, reserve cost breakdown, fee-account balance/alerting |
| `/dashboard/settings` | Pool sizing bounds, safety factor, lease timeout, treasury/fee account config |

## API Endpoints

### Tenant-facing (channel leasing)
```
POST   /v1/channels/acquire
       { tenantId, operationSource, operations[], timeBounds?, memo? }
       -> { leaseId, channelAccount, sequence, envelopeXdr, expiresAt }

POST   /v1/channels/submit
       { leaseId, signedEnvelopeXdr }
       -> { status, hash?, resultCode? }

POST   /v1/channels/release
       { leaseId }   // abandon without submitting
       -> { released: true }

GET    /v1/pool/status
       -> { total, available, leased, resyncing, utilisationPct }
```

### Operator/admin (dashboard-backing, authenticated)
```
POST   /api/auth/login              { username, password } -> session
POST   /api/auth/logout

GET    /api/channels                list + filter by state
GET    /api/channels/:id            single channel detail + lifecycle history

GET    /api/tenants                 list tenants + usage stats
POST   /api/tenants                 create tenant, issue API credentials

GET    /api/metrics/throughput      time-series tx/sec vs baseline
GET    /api/metrics/reserves        per-channel + total reserve cost
GET    /api/metrics/fees            fee account balance + drain rate history

GET    /api/settings                current pool config
PATCH  /api/settings                update pool bounds, safety factor, lease timeout

POST   /api/pool/provision          manually trigger channel provisioning (admin)
POST   /api/pool/drain/:id          mark a channel Draining for reclamation
```

## Background Services (not HTTP-facing)

- **Provisioner**: creates channel accounts with sponsored reserves, funds/wraps fees, reclaims dead channels. Runs on a schedule and on-demand from `/api/pool/provision`.
- **Reconciler**: polls on-chain sequence numbers for any channel not in `Available`, repairs local drift, resolves ambiguous submit outcomes, sweeps orphaned/idle `Draining` channels back to the sponsor.

These run as a **long-running worker process** separate from the Next.js API routes — Next.js serverless functions are not suitable for continuous polling loops. Deploy as a second Railway service in the same project, sharing the Postgres database.

## Database Schema (Prisma models, high level)

```
Operator        { id, username, passwordHash, treasuryPublicKey, feeAccountPublicKey, createdAt }
Tenant          { id, operatorId, name, apiKeyHash, operationSourcePublicKey, createdAt }
ChannelAccount  { id, operatorId, publicKey, secretKeyEncrypted, state, sequence, leaseId?, updatedAt }
Lease           { id, tenantId, channelAccountId, envelopeXdr, status, expiresAt, createdAt, resolvedAt }
PoolConfig      { operatorId, minChannels, maxChannels, safetyFactor, leaseTimeoutSeconds }
MetricSnapshot  { id, operatorId, timestamp, throughputTps, utilizationPct, reserveCostXlm, feeBalanceXlm }
```

`ChannelAccount.state` enum: `Provisioning | Available | Leased | Submitted | Failed | Resync | Draining | Merged`

**Security note:** `secretKeyEncrypted` stores channel account keys (SLIPWAY *does* hold channel keys — it must, to sign the transaction-source side — but never tenant operation-source keys). Encrypt at rest; see AGENT.md for key-handling requirements.

## Third-Party / External Services

- **Stellar Horizon / RPC** — submitting transactions, reading sequence numbers, streaming ledger data.
- **Stellar SDK** (`@stellar/stellar-sdk`, TypeScript) — envelope building, XDR handling, fee-bump wrapping.
- **Friendbot** (testnet only) — funding test accounts during M1–M3.
- **Railway Postgres** — primary datastore (channels, leases, tenants, metrics).
- **Railway** — hosting for both the Next.js app and the worker (reconciler/provisioner) service.

## Milestones (carried from the original technical spec)

- **M1 (week 1)** — Pool provisioning + lifecycle state machine, durable storage, reclamation. Local network.
- **M2 (week 2)** — Lease broker: acquire/submit/release, collision detection, resync, timeout handling. Testnet.
- **M3 (week 3)** — Sustained load test on testnet; publish throughput chart vs. single-account baseline.
- **M4 (week 4)** — Mainnet deploy, first real tenant, published operational metrics.
