import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// Track active locks dynamically to model race conditions
const activeLocks = new Set<string>();
const mockWarn = jest.fn();

jest.unstable_mockModule("../utils/logger.js", () => ({
  default: {
    warn: mockWarn,
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.unstable_mockModule("../services/cacheService.js", () => ({
  cacheService: {
    setNotExists: jest.fn(async (key: string) => {
      if (activeLocks.has(key)) {
        return false;
      }
      activeLocks.add(key);
      return true;
    }),
    delete: jest.fn(async (key: string) => {
      activeLocks.delete(key);
    }),
  },
}));

jest.unstable_mockModule("../db/connection.js", () => ({
  query: jest.fn(async () => ({ rows: [], rowCount: 0 })),
  getClient: jest.fn(),
  withTransaction: jest.fn(),
}));

const { WebhookService } = await import("../services/webhookService.js");
const { scoreReconciliationService } =
  await import("../services/scoreReconciliationService.js");
const { runLoanDueCheck } = await import("../cron/loanCheckCron.js");
const { runNotificationCleanup } =
  await import("../services/notificationService.js");

describe("distributed lock: schedulers skip when lock is held", () => {
  beforeEach(() => {
    activeLocks.clear();
    mockWarn.mockClear();
  });

  describe("webhookRetryProcessor", () => {
    it("skips run when lock is not acquired", async () => {
      activeLocks.add("webhook_retry_scheduler:running");
      const result = await WebhookService.processRetries();
      expect(result).toBeUndefined();
      expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining("skipped"));
    });
  });

  describe("scoreReconciliationService", () => {
    it("skips run when lock is not acquired", async () => {
      activeLocks.add("score_reconciliation:running");
      const result =
        await scoreReconciliationService.reconcileActiveBorrowerScores();
      expect(result).toBeNull();
      expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining("skipped"));
    });
  });

  describe("loanCheckCron", () => {
    it("skips run when lock is not acquired", async () => {
      activeLocks.add("loan_due_check_cron:running");
      const result = await runLoanDueCheck();
      expect(result).toBeUndefined();
      expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining("skipped"));
    });
  });

  describe("notificationService cleanup", () => {
    it("skips run when lock is not acquired", async () => {
      activeLocks.add("notification_cleanup:running");
      const result = await runNotificationCleanup();
      expect(result).toBeUndefined();
      expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining("skipped"));
    });
  });

  describe("concurrent execution (race condition)", () => {
    it("first concurrent call acquires lock, second concurrent call is skipped", async () => {
      activeLocks.clear();

      // Trigger two concurrent runs
      const promise1 = WebhookService.processRetries();
      const promise2 = WebhookService.processRetries();

      await Promise.all([promise1, promise2]);

      // One call must have been skipped because the other held the lock
      expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining("skipped"));

      // The lock should be cleanly released after all runs are done
      expect(activeLocks.size).toBe(0);
    });
  });
});
