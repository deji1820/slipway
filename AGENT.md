# SLIPWAY — Agent Guide

This file guides a coding agent (e.g. Claude, in chat or Claude Code) building SLIPWAY. Read this alongside `SPEC.md` (functional spec) and `BRAND.md` (design guidance).

## Tech Stack

- **Frontend + API**: Next.js (App Router), TypeScript
- **Background worker**: standalone Node.js/TypeScript process for the reconciler + provisioner — deployed as a **separate Railway service** from the Next.js app. Do not try to run continuous polling loops inside Next.js API routes or serverless functions.
- **ORM**: Prisma, targeting Postgres
- **Database**: Postgres, hosted on Railway
- **Styling**: Tailwind CSS
- **Stellar SDK**: `@stellar/stellar-sdk` (TypeScript) for envelope building, XDR, fee-bump wrapping, Horizon/RPC calls
- **Runtime**: Node.js (LTS)
- **Package manager**: pnpm
- **Auth**: username/password only, seeded admin account via Prisma seed script — no third-party auth provider for this version
- **Deployment**: Railway for both the Next.js app and the worker service; Railway Postgres for the database

**Always resolve the latest stable version of every dependency before scaffolding** — do not assume versions from training data. Check npm/PyPI directly if unsure.

## Local Dev

- Provide a `docker-compose.yml` for local Postgres (and Redis if a job queue is added between the API and worker — recommended for handing acquire/submit events to the reconciler cleanly).
- Provide `.env.example` covering: `DATABASE_URL`, `STELLAR_NETWORK` (testnet/mainnet), `HORIZON_URL`, `RPC_URL`, `TREASURY_SECRET` (dev only — see security note below), `FEE_ACCOUNT_SECRET`, `SESSION_SECRET`.
- Default all Stellar network config to **testnet** in local/dev `.env.example`. Mainnet values should never be committed, even as examples.

## Application Best Practices

- Follow the **milestone order from SPEC.md** (M1 pool/lifecycle → M2 lease broker → M3 load validation → M4 mainnet). Do not build the lease broker before the channel state machine is durable and tested — the spec is explicit that sequence bugs are the primary risk surface.
- Implement the **channel lifecycle state machine** exactly as specified: `Provisioning → Available → Leased → Submitted → Available`, with `Failed → Resync` and lease-timeout → `Resync` (never straight back to `Available` on timeout — see SPEC.md's sequence management rules).
- **Never assume a local sequence number is correct after any error.** Any ambiguous or failed outcome must move the channel to `Resync` and re-read from chain before reuse.
- **Every transaction envelope SLIPWAY builds must carry a bounded time-bounds window.** This is called out in the source spec as the single most valuable defensive detail — do not skip it, even in early milestones.
- Use **sponsored reserves** for channel account creation (operator's treasury sponsors, not each channel funded independently) and **fee-bump wrapping** for fees, so channels can carry a zero XLM balance.
- Write the **concurrency tests from SPEC.md's testing plan** (100 concurrent acquires against a 50-channel pool, broker restart with channels mid-lease, stale-sequence submission, pool exhaustion/backpressure) before considering M1/M2 complete — these are correctness requirements, not nice-to-haves.

## Security Best Practices

- **SLIPWAY never touches tenant operation-source keys.** The API contract is: SLIPWAY builds an unsigned envelope, the tenant signs client-side, SLIPWAY only ever receives the signed envelope back. Do not add any endpoint, admin tool, or debug path that accepts or stores a tenant's private key.
- **Channel account secret keys ARE held by SLIPWAY** (it must sign as transaction source) — encrypt these at rest (e.g. via a KMS or `pgcrypto`/application-layer encryption, never plaintext in Postgres), and restrict decryption to the submitter/provisioner processes only.
- Treasury and fee-account secrets are the highest-value secrets in the system. Never load them into the Next.js web process; only the worker service (provisioner/submitter) should have access, and only from environment/secret storage, never checked into git.
- Hash admin passwords with a strong modern algorithm (argon2id or bcrypt with adequate cost factor) — never store plaintext or reversible-encrypted passwords, even for the seeded demo admin.
- Rate-limit `/v1/channels/acquire` and `/v1/channels/submit` per tenant to prevent pool exhaustion by a single misbehaving or malicious tenant (the spec calls out pool exhaustion as a named risk).
- Validate all XDR/envelope inputs server-side before submission — never trust client-constructed envelopes without confirming they match the operations SLIPWAY itself built for that lease.
- Log and alert on fee-account balance dropping below a safe threshold — halt submissions rather than fail silently on a drained fee account, per the spec's own risk table.
- Keep dependencies current: run `pnpm audit` (or equivalent) as part of CI, and pin to latest stable versions at scaffold time rather than copying versions from any cached example.

## What NOT to Build in v1

- No multi-tenant infrastructure-level isolation (single-tenant deployable only — documented as v2).
- No transaction content/policy validation — SLIPWAY provides sequence capacity only.
- No signing service, custody feature, or key-management UI for tenants — this would contradict the project's core non-custodial guarantee.
