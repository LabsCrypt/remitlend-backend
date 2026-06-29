// Migration: Add loan_disputes table and support for disputed loan status

export const up = (pgm) => {
  // 1. Create loan_disputes table
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS loan_disputes (
      id SERIAL PRIMARY KEY,
      -- loan_id is not a FK: loan_events is an append-only event table whose
      -- loan_id is non-unique (and later becomes a view), so it cannot be a
      -- foreign key target.
      loan_id INTEGER NOT NULL,
      borrower TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', -- open, resolved, rejected
      admin_note TEXT,
      resolution TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      resolved_at TIMESTAMP WITH TIME ZONE
    );
  `);

  // 2. Add indexes for efficient querying
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_loan_disputes_status ON loan_disputes(status);
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_loan_disputes_borrower ON loan_disputes(borrower);
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_loan_disputes_loan_id ON loan_disputes(loan_id);
  `);

  // 3. Add disputed status to loan_events (if using status enum, update it)
  // If status is a string, no migration needed. If enum, alter type here.
  // Example for enum:
  // pgm.sql(`ALTER TYPE loan_status_enum ADD VALUE IF NOT EXISTS 'disputed';`);
};

export const down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS loan_disputes;`);
  // No need to remove enum value (Postgres doesn't support removing enum values easily)
};
