import { query } from "../db/connection.js";
import logger from "../utils/logger.js";

const DECAY_POINTS_PER_MONTH = 5;
const MIN_SCORE = 300;
const INACTIVITY_THRESHOLD_DAYS = 30;

export interface InactiveBorrower {
  user_id: string;
  current_score: number;
  last_repayment: string | null;
}

export async function getInactiveBorrowers(): Promise<InactiveBorrower[]> {
  const result = await query(
    `
    SELECT s.borrower AS user_id, s.score AS current_score,
           MAX(e.ledger_closed_at) AS last_repayment
    FROM scores s
    LEFT JOIN contract_events e
      ON s.borrower = e.address AND e.event_type = 'LoanRepaid'
    GROUP BY s.borrower, s.score
    HAVING MAX(e.ledger_closed_at) IS NULL
       OR MAX(e.ledger_closed_at) < NOW() - INTERVAL '${INACTIVITY_THRESHOLD_DAYS} days'
    `,
  );
  return result.rows as InactiveBorrower[];
}

export async function applyScoreDecay(
  borrower: InactiveBorrower,
): Promise<number> {
  const now = Date.now();
  let monthsInactive = 1;

  if (borrower.last_repayment) {
    const lastMs = new Date(borrower.last_repayment).getTime();
    monthsInactive = Math.max(
      1,
      Math.floor((now - lastMs) / (30 * 24 * 60 * 60 * 1000)),
    );
  }

  const decay = monthsInactive * DECAY_POINTS_PER_MONTH;
  const newScore = Math.max(MIN_SCORE, borrower.current_score - decay);

  await query(
    `UPDATE scores SET score = $1, updated_at = CURRENT_TIMESTAMP WHERE borrower = $2`,
    [newScore, borrower.user_id],
  );

  logger.info("Applied score decay", {
    userId: borrower.user_id,
    oldScore: borrower.current_score,
    newScore,
    monthsInactive,
  });

  return newScore;
}
