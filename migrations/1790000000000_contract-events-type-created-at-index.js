/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

// Issue #2: CREATE INDEX CONCURRENTLY cannot run inside a transaction, and
// node-pg-migrate wraps each migration in a transaction by default. Disabling
// the transaction wrapper lets the CONCURRENTLY clause survive while still
// going through the migrate:up tooling.
export const disableTransaction = true;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // The orphaned src/db/migrations SQL targeted `loan_events`, but as of
  // 1788000000019_unified-contract-events the loan_events relation is a
  // backward-compatibility view over contract_events. CREATE INDEX
  // CONCURRENTLY cannot index a view, so we target the underlying table
  // directly — the index name follows the contract_events_* convention
  // the rest of that migration established.
  pgm.sql(
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contract_events_type_created_at
       ON contract_events (event_type, created_at);`,
  );
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql(
    "DROP INDEX CONCURRENTLY IF EXISTS idx_contract_events_type_created_at;",
  );
};
