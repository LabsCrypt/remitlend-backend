/**
 * @param { import("node-pg-migrate").MigrationBuilder } @param pgm {import("node-pg-migrate").MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.createTable("transaction_submissions", {
    id: {
      type: "serial",
      primaryKey: true,
    },
    tx_hash: {
      type: "varchar(64)",
      notNull: true,
      unique: true,
    },
    status: {
      type: "varchar(50)",
      notNull: true,
    },
    submitted_at: {
      type: "timestamp with time zone",
      notNull: true,
      default: pgm.func("NOW()"),
    },
    submitted_by: {
      type: "varchar(56)",
      null: true,
    },
    transaction_type: {
      type: "varchar(20)",
      notNull: true,
      default: "loan",
    },
    result_xdr: {
      type: "text",
      null: true,
    },
    created_at: {
      type: "timestamp with time zone",
      notNull: true,
      default: pgm.func("NOW()"),
    },
    updated_at: {
      type: "timestamp with time zone",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  // Indexes for performance
  pgm.createIndex("transaction_submissions", ["submitted_at"]);
  pgm.createIndex("transaction_submissions", ["submitted_by"]);
  pgm.createIndex("transaction_submissions", ["status"]);
  pgm.createIndex("transaction_submissions", ["transaction_type"]);

  // Ensure the shared updated_at trigger function exists (not created by any
  // earlier migration), otherwise the trigger below cannot be created.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS trigger AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Trigger to update updated_at timestamp
  pgm.createTrigger("transaction_submissions", "update_updated_at", {
    when: "BEFORE",
    operation: "UPDATE",
    function: "update_updated_at_column",
  });
};

/**
 * @param { import("node-pg-migrate").MigrationBuilder } @param pgm {import("node-pg-migrate").MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.dropTable("transaction_submissions");
};
