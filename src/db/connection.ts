/**
 *
 * Database connection pool and query helper.
 */

import pg from "pg";
import logger from "../utils/logger.js";

export type { PoolClient } from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on("error", (err) => {
  logger.error("Unexpected database pool error", err);
});

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

export async function getClient(): Promise<pg.PoolClient> {
  return pool.connect();
}

export async function withTransaction<T>(
  callback: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

let isShuttingDown = false;

const metricsInterval = setInterval(() => {
  logger.info("DB Pool Metrics", {
    total: pool.totalCount,
    idle: pool.idleCount,
    active: pool.totalCount - pool.idleCount,
    waiting: pool.waitingCount,
  });
}, 60000);
metricsInterval.unref();

const waitForPoolToDrain = async (timeoutMs: number): Promise<void> => {
  const startedAt = Date.now();
  while (pool.totalCount > 0 && pool.totalCount !== pool.idleCount) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(
        `Timed out waiting for pool to drain active clients after ${timeoutMs}ms`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

export const closePool = async (options?: { timeoutMs?: number }): Promise<void> => {
  const timeoutMs = options?.timeoutMs ?? 10000;
  isShuttingDown = true;
  clearInterval(metricsInterval);
  await waitForPoolToDrain(timeoutMs);
  await pool.end();
};