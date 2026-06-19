/**
 * src/db/connection.ts
 *
 * Database connection pool and query helper.
 * Transaction helpers live in transaction.ts and are re-exported here
 * for backward compatibility.
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
 */
export async function query<T = unknown>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const client = await pool.connect();
  try {
    const result = await client.query<T>(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}