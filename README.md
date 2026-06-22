# RemitLend Backend API

Express.js backend service for the RemitLend platform, providing API endpoints for credit scoring, remittance simulation, loan indexing, webhook delivery, and NFT metadata management.

## Overview

The backend serves as a bridge between the frontend application, PostgreSQL, Redis, and Stellar/Soroban contracts. It handles:

- **Loan Event Indexing**: Polls Soroban RPC for loan, pool, NFT, score, and governance events.
- **Credit Scoring**: Updates borrower scores from indexed repayment, default, and late-payment history.
- **Remittance Simulation**: Provides mocked remittance data for local testing.
- **Webhook Delivery**: Dispatches signed event payloads to subscribed callback URLs and retries failures.
- **Background Maintenance**: Runs reconciliation, cleanup, default-checking, and loan-due jobs while the API process is alive.
- **Security**: Validates requests, rate limits traffic, validates startup configuration, and signs webhook payloads with HMAC-SHA256.

## Tech Stack

- **Runtime**: Node.js 22.x
- **Container runtime**: `node:22-alpine` in the Dockerfile
- **Framework**: Express.js 5
- **Language**: TypeScript
- **Validation**: Zod
- **Testing**: Jest + Supertest
- **Documentation**: Swagger/OpenAPI
- **Code Quality**: ESLint + Prettier

> Keep local Node, Docker, and any `package.json` `engines.node` setting aligned on Node 22.x. The Dockerfile is the deployment source of truth and currently pins `node:22-alpine`.

## Getting Started

### Prerequisites

- Node.js 22.x
- npm 10+
- PostgreSQL
- Redis
- Stellar/Soroban contract IDs and admin credentials for contract-backed flows

### Installation

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Fill the mandatory values in .env, then apply migrations
npm run migrate:up

# Start development server
npm run dev
```

### Database and migrations

The API expects a PostgreSQL database. Set `DATABASE_URL` in `.env` using `.env.example` as the template.

Apply schema migrations from the backend directory:

```bash
npm run migrate:up
```

Rollback last batch when needed:

```bash
npm run migrate:down
```

Scripts use `migrate:up` and `migrate:down` with colon-separated names, which work reliably across shells and CI.

Core tables are created by these migrations in filename order:

| Migration                                    | Tables                                             |
| -------------------------------------------- | -------------------------------------------------- |
| `1771691269865_initial-schema.js`            | `scores`, `remittance_history`                     |
| `1771691269866_loan-events-schema.js`        | `loan_events`, `indexer_state`                     |
| `1772000000000_webhook-subscriptions.js`     | `webhook_subscriptions`                            |
| `1773000000001_user-profiles.js`             | `user_profiles`                                    |
| `1773000000002_loan-history.js`              | `loan_history`                                     |
| `1773000000003_indexed-events.js`            | `indexed_events`                                   |
| `1774000000004_scores-add-created-at.js`     | adds `created_at` to `scores`                      |
| `1777000000007_unique-loan-status-events.js` | dedupes and enforces unique status events per loan |

With Docker Compose from the repo root, the backend service runs `migrate:up` before `npm run dev` so the schema is applied automatically when the database is healthy.

## Environment Variables

Copy `.env.example` to `.env` and keep the two files in sync when new configuration is introduced. Startup validation is implemented in `src/config/env.ts`; any variable in the mandatory table below must be present and non-empty or the process exits immediately.

### Mandatory at startup

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string used by API queries, migrations, schedulers, and webhook persistence. |
| `REDIS_URL` | Redis connection string used by queue/cache-backed flows. |
| `JWT_SECRET` | Secret used for JWT signing/verification. Use a strong production value. |
| `STELLAR_RPC_URL` | Soroban RPC endpoint used by indexers and on-chain service calls. |
| `STELLAR_NETWORK_PASSPHRASE` | Stellar network passphrase; must match the selected network and deployed contracts. |
| `LOAN_MANAGER_CONTRACT_ID` | Soroban LoanManager contract ID used for loan lifecycle operations. |
| `LENDING_POOL_CONTRACT_ID` | Soroban LendingPool contract ID used for pool-related operations/events. |
| `POOL_TOKEN_ADDRESS` | Pool token/asset address used by pool and accounting flows. |
| `LOAN_MANAGER_ADMIN_SECRET` | Secret key for the admin account authorized to submit privileged LoanManager transactions. |
| `INTERNAL_API_KEY` | Shared secret for internal-only administrative endpoints/jobs. |
| `FRONTEND_URL` | Canonical frontend origin used by CORS and links. |
| `SCORE_DELTA_REPAY` | Score increment applied by indexer/reconciliation after successful repayment. |
| `SCORE_DELTA_DEFAULT` | Score decrement applied after loan default. |
| `SCORE_DELTA_LATE` | Score decrement applied after late payment/late-fee events. |

### Other configuration in `.env.example`

| Variable(s) | Required? | Purpose |
| --- | --- | --- |
| `PORT`, `NODE_ENV` | Optional | Server port and runtime environment. |
| `CORS_ALLOWED_ORIGINS` | Optional | Comma-separated additional CORS origins. `FRONTEND_URL` remains mandatory. |
| `STELLAR_NETWORK` | Optional | Selects network defaults such as `testnet` or `mainnet`. |
| `REMITTANCE_NFT_CONTRACT_ID`, `MULTISIG_GOVERNANCE_CONTRACT_ID` | Optional, feature-dependent | Contract IDs for NFT/governance flows when enabled. |
| `STELLAR_USDC_ISSUER`, `STELLAR_EURC_ISSUER`, `STELLAR_PHP_ISSUER` | Optional, feature-dependent | Stellar asset issuers for supported currencies. |
| `SCORE_RECONCILIATION_SOURCE_SECRET` | Optional | Override signing/source account for score reconciliation read calls. |
| `LOAN_MIN_SCORE`, `LOAN_MAX_AMOUNT`, `LOAN_INTEREST_RATE_PERCENT`, `CREDIT_SCORE_THRESHOLD`, `LOAN_TERM_LEDGERS` | Optional/defaulted by config | Loan policy values and contract term assumptions. Keep `LOAN_TERM_LEDGERS` aligned with deployed contracts. |
| `INDEXER_POLL_INTERVAL_MS`, `INDEXER_BATCH_SIZE` | Optional | Controls indexer polling cadence and ledger/event batch size. |
| `DEFAULT_CHECK_INTERVAL_MS`, `DEFAULT_CHECK_MAX_LOANS_PER_RUN`, `DEFAULT_CHECK_BATCH_SIZE`, `DEFAULT_CHECK_BATCH_TIMEOUT_MS`, `DEFAULT_CHECK_CONCURRENCY`, `DEFAULT_CHECK_POLL_ATTEMPTS`, `DEFAULT_CHECK_POLL_SLEEP_MS` | Optional | Controls the scheduled on-chain default checker. |
| `SCORE_RECONCILIATION_INTERVAL_MS`, `SCORE_RECONCILIATION_MAX_BORROWERS_PER_RUN`, `SCORE_RECONCILIATION_BATCH_SIZE`, `SCORE_RECONCILIATION_AUTOCORRECT_ENABLED`, `SCORE_RECONCILIATION_AUTOCORRECT_THRESHOLD` | Optional | Controls score reconciliation cadence, batching, and optional autocorrection. |
| `WEBHOOK_REQUEST_TIMEOUT_MS`, `WEBHOOK_MAX_PAYLOAD_BYTES` | Optional | Controls outbound webhook timeout and payload-size summary behavior. |
| `SENTRY_DSN` | Optional | Enables Sentry error reporting when provided. |
| `NOTIFICATION_RETENTION_DAYS`, `READ_NOTIFICATION_RETENTION_DAYS` | Optional | Controls notification cleanup retention windows. |
| `SENDGRID_API_KEY`, `FROM_EMAIL` | Optional, feature-dependent | Email notification configuration. |
| `ADMIN_EMAIL`, `ADMIN_WEBHOOK_URL` | Optional | Admin alert destinations. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | Optional, feature-dependent | SMS notification configuration. |

## Background Jobs and Schedulers

These jobs run inside the API process. In production, run only one scheduler-active instance unless the job implementation is explicitly made distributed-lock safe.

| Job | Purpose | Main configuration |
| --- | --- | --- |
| **Indexer** | Polls Soroban RPC for contract events, persists normalized events, updates score/loan state, and dispatches webhooks. | `INDEXER_POLL_INTERVAL_MS`, `INDEXER_BATCH_SIZE`, contract IDs, Stellar RPC/network values, score deltas. |
| **Default checker** | Periodically scans eligible loans and submits on-chain `check_defaults` transactions in controlled batches. | `DEFAULT_CHECK_INTERVAL_MS`, `DEFAULT_CHECK_MAX_LOANS_PER_RUN`, `DEFAULT_CHECK_BATCH_SIZE`, `DEFAULT_CHECK_BATCH_TIMEOUT_MS`, `DEFAULT_CHECK_CONCURRENCY`, `DEFAULT_CHECK_POLL_ATTEMPTS`, `DEFAULT_CHECK_POLL_SLEEP_MS`, `LOAN_MANAGER_ADMIN_SECRET`. |
| **Webhook retry** | Finds failed webhook deliveries whose `next_retry_at` is due and retries them. Current retry schedule is roughly 5 minutes, 15 minutes, then 45 minutes after failure. | `WEBHOOK_REQUEST_TIMEOUT_MS`, `WEBHOOK_MAX_PAYLOAD_BYTES`, per-subscription webhook secret. |
| **Score reconciliation** | Compares stored scores with on-chain/derived state and optionally autocorrects drift beyond a configured threshold. | `SCORE_RECONCILIATION_INTERVAL_MS`, `SCORE_RECONCILIATION_MAX_BORROWERS_PER_RUN`, `SCORE_RECONCILIATION_BATCH_SIZE`, `SCORE_RECONCILIATION_AUTOCORRECT_ENABLED`, `SCORE_RECONCILIATION_AUTOCORRECT_THRESHOLD`, `SCORE_RECONCILIATION_SOURCE_SECRET`. |
| **Cleanup** | Removes expired/read notifications and other old operational records according to retention settings. | `NOTIFICATION_RETENTION_DAYS`, `READ_NOTIFICATION_RETENTION_DAYS`. |
| **Loan-due cron** | Periodically checks loans approaching or passing due status so the system can surface due/default-related state and notifications. | Loan tables, `LOAN_TERM_LEDGERS`, default-checker settings, notification settings. |

## Webhook HMAC Signatures

When a webhook subscription has a `secret`, every outbound webhook request includes:

```http
x-remitlend-signature: <hex_hmac_sha256>
content-type: application/json
```

The signature is produced from the exact raw JSON request body sent to the callback URL:

```ts
signature = HMAC_SHA256_HEX(secret, rawBody);
```

In code, `src/services/webhookService.ts` centralizes this in `createWebhookSignature(body, secret)`. The same file also exports `verifyWebhookSignature(body, signature, secret)` so tests or consumers can use the same timing-safe verification logic.

A webhook receiver should verify before parsing or mutating the payload:

```ts
import crypto from "node:crypto";

function verifyRemitLendWebhook(rawBody: string, signature: string, secret: string) {
  const expected = Buffer.from(
    crypto.createHmac("sha256", secret).update(rawBody).digest("hex"),
    "hex",
  );
  const received = Buffer.from(signature, "hex");

  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}
```

Important verification rules:

- Use the raw request body bytes/string exactly as received, not a re-serialized JSON object.
- Treat a missing `x-remitlend-signature` as invalid when the subscription has a secret.
- Compare digests with a timing-safe comparison.
- Rotate subscription secrets by registering/updating the webhook secret and coordinating the receiver deployment.

## Available Scripts

```bash
# Development
npm run dev              # Start dev server with hot reload

# Database
npm run migrate:up       # Apply migrations (requires DATABASE_URL)
npm run migrate:down     # Roll back last migration batch
npm run seed             # Seed realistic local development data
npm run seed:reset       # Reset and reseed development data

# Production
npm run build            # Compile TypeScript to JavaScript
npm start                # Run production build

# Testing
npm test                 # Run test suite
npm test -- --watch      # Run tests in watch mode
npm test -- --coverage   # Run tests with coverage

# Code Quality
npm run lint             # Check code quality
npm run lint:fix         # Fix linting issues
npm run format           # Format code with Prettier
npm run format:check     # Check code formatting
```

### Development seed data

New contributors can populate a realistic local dataset after running migrations:

```bash
npm run seed
```

This seeds sample profiles, scores, remittance history, loan history, loan events, notifications, and indexer state so dashboards and event-driven flows have local data.

To wipe those local development rows and recreate them from scratch:

```bash
npm run seed:reset
```

## API Documentation

Interactive API documentation is available via Swagger UI when the server is running:

**URL**: [http://localhost:3001/api-docs](http://localhost:3001/api-docs)

## Deployment

### Docker

```bash
# Build image
docker build -t remitlend-backend .

# Run container
docker run -p 3001:3001 --env-file .env remitlend-backend
```

### Docker Compose

From the project root:

```bash
docker compose up backend
```

### Production Considerations

- Set `NODE_ENV=production`.
- Use Node 22.x, matching `node:22-alpine` in the Dockerfile.
- Use strong production values for `JWT_SECRET`, `INTERNAL_API_KEY`, webhook subscription secrets, and Stellar admin secrets.
- Configure exact CORS origins.
- Run migrations before serving traffic.
- Ensure scheduler jobs are not duplicated across multiple replicas unless protected by a lock.
- Enable HTTPS, monitoring, logging, and health checks.

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines on contributing to the backend.

### Code Style

- Follow TypeScript best practices.
- Use async/await over callbacks.
- Maintain strict typing.
- Write descriptive variable names.
- Add JSDoc comments for public functions.
- Keep functions small and focused.

### Before Submitting PR

```bash
npm run lint
npm run format:check
npm test
npm run build
```

## Troubleshooting

### Port Already in Use

```bash
lsof -ti:3001 | xargs kill -9
```

### TypeScript Errors

```bash
rm -rf dist/
npm run build
```

### Module Not Found

```bash
rm -rf node_modules package-lock.json
npm install
```

## License

ISC License - See LICENSE file for details.

## Support

- Open an issue for bug reports.
- Check existing issues before creating new ones.
- Provide detailed reproduction steps.
- Include error messages and logs.
