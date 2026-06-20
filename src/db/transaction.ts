/**
 * Canonical transaction helpers with retry logic.
 * Exports:
 *   withTransaction            — callback-first DB transaction (with retry)
 *   withRetryingTransaction    — alias for backward compatibility
 *   withStellarAndDbTransaction — money-moving path (Stellar + DB)
 *   executeTransactionQueries   — run queries inside an existing transaction
 */

import pg, { type PoolClient } from "pg";
import { pool } from "./connection.js";
import logger from "../utils/logger.js";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TransactionOptions {
  /** Max attempts for transient-error retries (default: 3) */
  maxRetries?: number;
  /** Initial back-off delay in ms (default: 200, doubles each retry) */
  baseDelayMs?: number;
}

export type TransactionCallback<T> = (client: PoolClient) => Promise<T>;

// Transient error codes that warrant retry with exponential backoff
const TRANSIENT_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "08000", // connection_exception
  "08003", // connection_does_not_exist
  "08006", // connection_failure
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
  "40001", // serialization_failure
  "40P01", // deadlock_detected
]);

function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code;
  return typeof code === "string" && TRANSIENT_ERROR_CODES.has(code);
}

// ─── Core withTransaction (callback-first, with retry) ─────────────────────

/**
 * Execute work inside a database transaction with automatic retry on
 * transient PostgreSQL errors (deadlock, serialization failure, etc.).
 *
 * A dedicated PoolClient is checked out for each attempt so that
 * BEGIN / all DML / COMMIT run on the same connection.
 * If the callback throws, or a transient error is encountered, the
 * transaction is rolled back and retried up to `maxRetries` times
 * with exponential back-off.
 */
export async function withTransaction<T>(
  fn: TransactionCallback<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 200;
  let attempt = 0;

  while (true) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch((rollbackErr) => {
        logger.error("Rollback failed", rollbackErr);
      });

      if (isTransientError(err) && attempt < maxRetries) {
        const delay = baseDelayMs * 2 ** attempt;
        attempt++;
        logger.warn(
          `Transient DB error in transaction (${(err as Error).message}). ` +
            `Retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`,
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      throw err;
    } finally {
      client.release();
    }
  }
}

// ─── Retrying variant (alias for backward compatibility) ──────────────────

/**
 * Alias for withTransaction. Exists for code that explicitly wants the
 * retrying behaviour spelled out in the call site.
 */
export async function withRetryingTransaction<T>(
  fn: TransactionCallback<T>,
  options?: TransactionOptions,
): Promise<T> {
  return withTransaction(fn, options);
}

// ─── Stellar + DB transaction (old signature, now with retry) ─────────────

/**
 * Wrapper for operations that involve both on-chain submission and database writes.
 *
 * ⚠️ CRITICAL: The Stellar operation executes OUTSIDE the DB transaction and is
 * IRREVERSIBLE. If the DB transaction fails after Stellar succeeds, manual reconciliation
 * may be required. The DB portion uses the retrying withTransaction.
 *
 * @param stellarOperation — Function that submits to Stellar network (executed first)
 * @param dbOperations    — Function that performs database writes (inside retrying tx)
 */
export async function withStellarAndDbTransaction<T>(
  stellarOperation: () => Promise<unknown>,
  dbOperations: (stellarResult: unknown, client: PoolClient) => Promise<T>,
): Promise<{ stellarResult: unknown; dbResult: T }> {
  // Execute Stellar operation first (irreversible — outside DB transaction)
  const stellarResult = await stellarOperation();

  // Then execute DB operations inside the retrying transaction wrapper
  const dbResult = await withTransaction(async (client) => {
    return await dbOperations(stellarResult, client);
  });

  return { stellarResult, dbResult };
}

// ─── Execute queries inside an existing transaction ────────────────────────

/**
 * Run a batch of queries inside an existing transaction client.
 */
export async function executeTransactionQueries(
  client: PoolClient,
  queries: Array<{ sql: string; params?: unknown[] }>,
): Promise<void> {
  for (const { sql, params } of queries) {
    await client.query(sql, params);
  }
}
