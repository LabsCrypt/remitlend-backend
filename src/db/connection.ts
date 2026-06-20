/**
 * src/db/connection.ts
 *
 * Database connection pool and query helper.
 * Transaction helpers are re-exported from transaction.ts for convenience.
 */

import pg from "pg";
import { env } from "../config/env.js";
import logger from "../utils/logger.js";
import { withTransaction } from "./transaction.js";

export type { PoolClient } from "pg";
export { withTransaction };

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on("error", (err) => {
  logger.error("Unexpected database pool error", err);
});

/**
 * Execute a single query using a pooled client.
 * The client is automatically released back to the pool.
 * Returns the full pg.QueryResult so callers can access .rows, .rowCount, etc.
 */
export async function query(
  sql: string,
  params?: unknown[],
): Promise<pg.QueryResult> {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result;
  } finally {
    client.release();
  }
}

/**
 * Acquire a dedicated client from the pool.
 * Caller MUST call client.release() when done.
 */
export async function getClient(): Promise<pg.PoolClient> {
  return pool.connect();
}
