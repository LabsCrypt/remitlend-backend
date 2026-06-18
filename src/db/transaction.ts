/**
 * Canonical transaction helper with configurable retry semantics.
 *
 * Money-moving code MUST use withTransaction (retrying variant).
 * Read-only or idempotent non-critical paths MAY use withTransactionNoRetry.
 *
 * @see docs/database-transactions.md
 */

import { PoolClient } from "pg"; // adjust for your driver (pg, mysql2, etc.)

// ─── Retry configuration ──────────────────────────────────────────────────────

const RETRY_CONFIG = {
  maxRetries: 5,
  baseDelayMs: 50,
  maxDelayMs: 2000,
  transientErrorCodes: new Set([
    "40001", // serialization_failure
    "40P01", // deadlock_detected
    "08006", // connection_failure
    "08003", // connection_does_not_exist
    "08001", // sqlclient_unable_to_establish_sqlconnection
  ]),
};

// ─── Types ──────────────────────────────────────────────────────────────────

export type TransactionFn<T> = (client: PoolClient) => Promise<T>;

export interface TransactionOptions {
  /** Retry on transient errors (deadlock, serialization failure). Default: true */
  retry?: boolean;
  /** Override max retry attempts. Only used when retry=true */
  maxRetries?: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isTransientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as any).code;
  return typeof code === "string" && RETRY_CONFIG.transientErrorCodes.has(code);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function exponentialBackoff(attempt: number): number {
  const delay = Math.min(
    RETRY_CONFIG.baseDelayMs * 2 ** attempt,
    RETRY_CONFIG.maxDelayMs
  );
  // Add jitter to prevent thundering herd
  return delay + Math.random() * delay * 0.5;
}

// ─── Core implementation ────────────────────────────────────────────────────

/**
 * Execute work inside a database transaction.
 *
 * By default (retry=true) this retries on transient errors
 * (deadlock, serialization failure) with exponential backoff.
 * Use this for ALL money-moving or state-mutating operations.
 */
export async function withTransaction<T>(
  client: PoolClient,
  fn: TransactionFn<T>,
  options: TransactionOptions = {}
): Promise<T> {
  const { retry = true, maxRetries = RETRY_CONFIG.maxRetries } = options;

  async function attempt(attemptNumber: number): Promise<T> {
    await client.query("BEGIN");
    try {
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {}); // ignore rollback errors

      const shouldRetry =
        retry &&
        attemptNumber < maxRetries &&
        isTransientError(error);

      if (shouldRetry) {
        const delay = exponentialBackoff(attemptNumber);
        console.warn(
          `[withTransaction] Transient error (attempt ${attemptNumber + 1}/${maxRetries + 1}), ` +
          `retrying in ${Math.round(delay)}ms: ${(error as Error).message}`
        );
        await sleep(delay);
        return attempt(attemptNumber + 1);
      }

      throw error;
    }
  }

  return attempt(0);
}

/**
 * Execute work inside a database transaction WITHOUT retry.
 *
 * Use ONLY for:
 * - Read-only transactions where retry adds no value
 * - Idempotent admin/ops scripts
 * - Cases where the caller handles retry externally
 *
 * ⚠️ NEVER use this for money-moving code.
 */
export async function withTransactionNoRetry<T>(
  client: PoolClient,
  fn: TransactionFn<T>
): Promise<T> {
  return withTransaction(client, fn, { retry: false });
}

// ─── Re-export for backward compatibility during migration ────────────────────
// TODO: Remove after all imports are migrated
export { withTransaction as withTransactionRetry };