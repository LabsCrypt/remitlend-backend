/**
 *
 * Canonical transaction helpers with retry logic.
 */

import pg, { type PoolClient } from "pg";
import { pool } from "./connection.js";
import logger from "../utils/logger.js";

export interface TransactionOptions {
  maxRetries?: number;
  baseDelayMs?: number;
}

export type TransactionCallback<T> = (client: PoolClient) => Promise<T>;

const TRANSIENT_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "08000",
  "08003",
  "08006",
  "57P01",
  "57P02",
  "57P03",
  "40001",
  "40P01",
]);

function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code;
  return typeof code === "string" && TRANSIENT_ERROR_CODES.has(code);
}

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

export async function withRetryingTransaction<T>(
  fn: TransactionCallback<T>,
  options?: TransactionOptions,
): Promise<T> {
  return withTransaction(fn, options);
}

export async function withStellarAndDbTransaction<S, T>(
  stellarOperation: () => Promise<S>,
  dbOperations: (stellarResult: S, client: PoolClient) => Promise<T>,
): Promise<{ stellarResult: S; dbResult: T }> {
  const stellarResult = await stellarOperation();

  const dbResult = await withTransaction(async (client) => {
    return await dbOperations(stellarResult, client);
  });

  return { stellarResult, dbResult };
}

export async function executeTransactionQueries(
  client: PoolClient,
  queries: Array<{ sql: string; params?: unknown[] }>,
): Promise<void> {
  for (const { sql, params } of queries) {
    await client.query(sql, params);
  }
}