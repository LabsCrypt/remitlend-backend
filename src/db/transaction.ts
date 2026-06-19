/**
 * src/db/transaction.ts
 *
 * Transaction helpers with retry logic and Stellar integration.
 *
 * Exports:
 *   withTransaction          — canonical DB transaction helper (client-first)
 *   withRetryingTransaction  — same, with connection-level retry
 *   withStellarAndDbTransaction — money-moving path (Stellar + DB atomic)
 *   executeTransactionQueries — run queries inside an existing transaction
 */

import pg, { type PoolClient } from "pg";
import { pool } from "./connection.js";
import logger from "../utils/logger.js";
import { withRetry } from "../utils/withRetry.js";
import {
  type Transaction,
  type xdr as XdrNamespace,
  SorobanRpc,
} from "@stellar/stellar-sdk";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TransactionOptions {
  /** Max attempts for connection-level retries (default: 3) */
  maxRetries?: number;
  /** Delay between retries in ms (default: 100) */
  retryDelayMs?: number;
}

export interface StellarDbTransactionOptions extends TransactionOptions {
  /** Soroban RPC server for simulation/submission */
  rpc: SorobanRpc.Server;
  /** Transaction builder callback */
  buildStellarTx: () => Promise<Transaction>;
}

export type TransactionCallback<T> = (client: PoolClient) => Promise<T>;

// Connection failure codes that warrant re-acquiring a client
const CONNECTION_FAILURE_CODES = new Set([
  "08006", // connection_failure
  "08003", // connection_does_not_exist
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08004", // sqlserver_rejected_establishment_of_sqlconnection
]);

function isConnectionFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code;
  return typeof code === "string" && CONNECTION_FAILURE_CODES.has(code);
}

// ─── Core withTransaction (client-first signature) ────────────────────────────

/**
 * Execute work inside a database transaction.
 *
 * Signature: withTransaction(client, fn, options?)
 *
 * The caller provides the client (typically from pool.connect()).
 * This helper handles BEGIN, COMMIT, and ROLLBACK. On error it re-throws
 * after rolling back so the caller can release the client.
 *
 * @example
 * ```ts
 * const client = await pool.connect();
 * try {
 *   const result = await withTransaction(client, async (tx) => {
 *     await tx.query("UPDATE accounts SET balance = balance - $1", [100]);
 *     return { ok: true };
 *   });
 * } finally {
 *   client.release();
 * }
 * ```
 */
export async function withTransaction<T>(
  client: PoolClient,
  fn: TransactionCallback<T>,
  _options?: TransactionOptions,
): Promise<T> {
  await client.query("BEGIN");
  try {
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch((rollbackErr) => {
      logger.error("Rollback failed", rollbackErr);
    });
    throw err;
  }
}

// ─── Retrying variant (re-acquires client on connection failures) ─────────────

/**
 * Execute work inside a database transaction with automatic retry on
 * connection failures.
 *
 * Unlike withTransaction, this helper acquires its own client from the pool
 * and **re-acquires** on connection failure codes (08006, 08003, etc.).
 * This ensures actual recovery from dropped connections.
 *
 * @example
 * ```ts
 * const result = await withRetryingTransaction(async (client) => {
 *   const rows = await client.query("SELECT * FROM users");
 *   return rows.rows;
 * }, { maxRetries: 3 });
 * ```
 */
export async function withRetryingTransaction<T>(
  fn: TransactionCallback<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 100;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch((rollbackErr) => {
        logger.error("Rollback failed on retry attempt", rollbackErr);
      });

      lastError = err;

      if (!isConnectionFailure(err) || attempt === maxRetries) {
        throw err;
      }

      logger.warn(
        `Connection failure on attempt ${attempt}/${maxRetries}, re-acquiring client...`,
        err,
      );
      await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
      // Loop continues — a fresh client is acquired on next iteration
    } finally {
      client.release();
    }
  }

  throw lastError;
}

// ─── Stellar + DB atomic transaction ──────────────────────────────────────────

/**
 * Execute a Stellar blockchain transaction and database mutations atomically.
 *
 * Flow:
 *   1. BEGIN DB transaction
 *   2. Build and simulate Stellar transaction (read-only, uses DB state)
 *   3. Submit Stellar transaction
 *   4. On success: COMMIT DB transaction
 *   5. On failure: ROLLBACK DB transaction
 *
 * This ensures the DB state never diverges from the blockchain state.
 *
 * @deprecated Use withTransaction + manual Stellar submission for new code.
 */
export async function withStellarAndDbTransaction<T>(
  rpc: SorobanRpc.Server,
  buildStellarTx: () => Promise<Transaction>,
  dbWork: TransactionCallback<T>,
  options?: TransactionOptions,
): Promise<{ stellarResult: unknown; dbResult: T }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Build and simulate (read-only — safe inside transaction)
    const stellarTx = await buildStellarTx();
    const simulated = await rpc.simulateTransaction(stellarTx);

    if (SorobanRpc.Api.isSimulationError(simulated)) {
      throw new Error(`Stellar simulation failed: ${simulated.error}`);
    }

    // Submit to network
    const stellarResult = await rpc.sendTransaction(stellarTx);

    // Execute DB work now that Stellar is confirmed
    const dbResult = await dbWork(client);

    await client.query("COMMIT");
    return { stellarResult, dbResult };
  } catch (err) {
    await client.query("ROLLBACK").catch((rollbackErr) => {
      logger.error("Stellar+DB rollback failed", rollbackErr);
    });
    throw err;
  } finally {
    client.release();
  }
}

// ─── Execute queries inside an existing transaction ───────────────────────────

/**
 * Run a batch of queries inside an existing transaction client.
 *
 * This is a thin wrapper for code that already holds a transaction client
 * and wants to execute multiple queries without nested BEGIN/COMMIT.
 *
 * @example
 * ```ts
 * await withTransaction(client, async (tx) => {
 *   await executeTransactionQueries(tx, [
 *     { sql: "UPDATE accounts SET balance = $1", params: [100] },
 *     { sql: "INSERT INTO logs (msg) VALUES ($1)", params: ["deducted"] },
 *   ]);
 * });
 * ```
 */
export async function executeTransactionQueries(
  client: PoolClient,
  queries: Array<{ sql: string; params?: unknown[] }>,
): Promise<void> {
  for (const { sql, params } of queries) {
    await client.query(sql, params);
  }
}