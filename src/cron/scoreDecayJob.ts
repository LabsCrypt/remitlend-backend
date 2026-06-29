import cron from "node-cron";
import {
  getInactiveBorrowers,
  applyScoreDecay,
} from "../services/scoreDecayService.js";
import logger from "../utils/logger.js";
import { cacheService } from "../services/cacheService.js";

const LOCK_KEY = "score_decay_job:running";
const LOCK_TTL_SECONDS = 600; // 10 minutes

export async function runScoreDecayJob(): Promise<void> {
  let lockAcquired = false;
  try {
    const lockValue = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    lockAcquired = await cacheService.setNotExists(
      LOCK_KEY,
      lockValue,
      LOCK_TTL_SECONDS,
    );
  } catch (error) {
    logger.error("Failed to acquire score decay job lock", { error });
  }

  if (!lockAcquired) {
    logger.warn(
      "Score decay job skipped - another instance is already running",
    );
    return;
  }

  try {
    logger.info("Running score decay job...");

    const borrowers = await getInactiveBorrowers();
    let decayedCount = 0;

    for (const borrower of borrowers) {
      if (borrower.current_score > 300) {
        await applyScoreDecay(borrower);
        decayedCount++;
      }
    }

    logger.info(
      `Score decay job completed. Decayed ${decayedCount} of ${borrowers.length} inactive borrowers.`,
    );
  } catch (error) {
    logger.error("Error in score decay job", { error });
  } finally {
    try {
      await cacheService.delete(LOCK_KEY);
    } catch (error) {
      logger.error("Failed to release score decay job lock", { error });
    }
  }
}

export function startScoreDecayCron(): void {
  cron.schedule("0 2 * * *", () => {
    void runScoreDecayJob();
  });
  logger.info("Score decay cron scheduled (daily at 02:00)");
}
