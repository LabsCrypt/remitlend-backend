import cron from "node-cron";
import { query } from "../db/connection.js";
import { notificationService } from "../services/notificationService.js";
import logger from "../utils/logger.js";
import { cacheService } from "../services/cacheService.js";

const LOCK_KEY = "loan_due_check_cron:running";
const LOCK_TTL_SECONDS = 300; // 5 minutes

const LEDGER_CLOSE_SECONDS = 5;
const DEFAULT_TERM_LEDGERS = 17280; // 1 day in ledgers
const NOTIFICATION_WINDOW_SECONDS = 24 * 60 * 60; // 24 hours

function notificationCacheKey(loanId: number): string {
  return `loan_due_notified:${loanId}`;
}

export async function runLoanDueCheck(): Promise<void> {
  let lockAcquired = false;
  try {
    const lockValue = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    lockAcquired = await cacheService.setNotExists(
      LOCK_KEY,
      lockValue,
      LOCK_TTL_SECONDS,
    );
  } catch (error) {
    logger.error("Failed to acquire loan due check cron lock", { error });
  }

  if (!lockAcquired) {
    logger.warn(
      "Loan due check cron skipped - another instance is already running",
    );
    return;
  }

  try {
    logger.info("Running loan due check cron...");

    const result = await query(`
        SELECT le.loan_id, le.address, le.amount,
               le.ledger_closed_at AS approved_at,
               COALESCE(le.term_ledgers, ${DEFAULT_TERM_LEDGERS}) AS term_ledgers
        FROM contract_events le
        WHERE le.event_type = 'LoanApproved'
          AND NOT EXISTS (
            SELECT 1 FROM contract_events re
            WHERE re.loan_id = le.loan_id AND re.event_type = 'LoanRepaid'
          )
          AND (le.ledger_closed_at + (COALESCE(le.term_ledgers, ${DEFAULT_TERM_LEDGERS}) * ${LEDGER_CLOSE_SECONDS} || ' seconds')::interval) <= NOW() + INTERVAL '24 hours'
      `);

    let notifiedCount = 0;

    for (const loan of result.rows) {
      const cacheKey = notificationCacheKey(loan.loan_id);
      const alreadyNotified = await cacheService.setNotExists(
        cacheKey,
        "1",
        NOTIFICATION_WINDOW_SECONDS,
      );

      if (!alreadyNotified) {
        continue;
      }

      try {
        await notificationService.createNotification({
          userId: loan.address,
          type: "repayment_due",
          title: "Repayment Due Soon",
          message: `Your repayment for loan #${loan.loan_id} of ${loan.amount} is due.`,
          loanId: loan.loan_id,
        });
        notifiedCount++;
      } catch (err) {
        logger.error("Failed to send notification, clearing dedup key", {
          loanId: loan.loan_id,
          error: err,
        });
        await cacheService.delete(cacheKey).catch(() => {});
      }
    }

    logger.info(
      `Loan due check completed. Notified ${notifiedCount} borrowers (${result.rows.length} due loans found).`,
    );
  } catch (error) {
    logger.error("Error in loan due check cron", { error });
  } finally {
    try {
      await cacheService.delete(LOCK_KEY);
    } catch (error) {
      logger.error("Failed to release loan due check cron lock", { error });
    }
  }
}

/**
 * Checks for loans that are due soon (e.g., within 24 hours) and notifies borrowers.
 * Runs every hour at the top of the hour.
 */
export function startLoanDueCheckCron() {
  cron.schedule("0 * * * *", () => {
    void runLoanDueCheck();
  });
}
