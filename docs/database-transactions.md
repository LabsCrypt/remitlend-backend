# Database Transactions

## Quick Reference

| Helper                   | Retries?                     | Use For                                                                   |
| ------------------------ | ---------------------------- | ------------------------------------------------------------------------- |
| `withTransaction`        | ✅ Yes (exponential backoff) | **All money-moving code** — loans, repayments, transfers, balance updates |
| `withTransactionNoRetry` | ❌ No                        | Read-only queries, idempotent admin scripts, externally-managed retry     |

## Import

```typescript
import { withTransaction, withTransactionNoRetry } from "../db/transaction";

Why Two Helpers?
PostgreSQL (and other MVCC databases) can raise transient errors under concurrency:
40001 serialization_failure — concurrent transactions conflict on row versions
40P01 deadlock_detected — circular lock dependency between transactions
These are expected under load and safe to retry — the transaction had not yet committed.
withTransaction automatically retries with exponential backoff (50ms → 100ms → 200ms … max 2s, with jitter).
withTransactionNoRetry skips this overhead for paths where it adds no value.

Examples
Money-moving: use retrying variant
import { withTransaction } from "../db/transaction";

async function disburseLoan(loanId: string, amount: BigNumber) {
  const client = await pool.connect();
  try {
    return await withTransaction(client, async (tx) => {
      // Deduct from lender escrow
      await tx.query(
        "UPDATE escrow_balances SET balance = balance - $1 WHERE id = $2",
        [amount, lenderId]
      );

      // Credit borrower wallet
      await tx.query(
        "UPDATE wallet_balances SET balance = balance + $1 WHERE id = $2",
        [amount, borrowerId]
      );

      // Mark loan disbursed
      await tx.query(
        "UPDATE loans SET status = 'disbursed', disbursed_at = NOW() WHERE id = $1",
        [loanId]
      );

      return { disbursed: true };
    });
  } finally {
    client.release();
  }
}


Read-only: use no-retry variant (optional)
import { withTransactionNoRetry } from "../db/transaction";

async function getLoanHistory(userId: string) {
  const client = await pool.connect();
  try {
    return await withTransactionNoRetry(client, async (tx) => {
      // SET TRANSACTION READ ONLY; -- optional optimization
      const { rows } = await tx.query(
        "SELECT * FROM loans WHERE borrower_id = $1 ORDER BY created_at DESC",
        [userId]
      );
      return rows;
    });
  } finally {
    client.release();
  }
}
```
