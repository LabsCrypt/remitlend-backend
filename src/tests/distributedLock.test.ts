import { jest, describe, it, expect, beforeEach } from "@jest/globals";

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
    setNotExists: jest.fn(async () => false),
    delete: jest.fn(async () => {}),
  },
}));

jest.unstable_mockModule("../db/connection.js", () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  withTransaction: jest.fn(),
}));

const { retryFailedWebhooks } = await import("../services/webhookRetryScheduler.js");
const { scoreReconciliationService } = await import("../services/scoreReconciliationService.js");
const { runLoanDueCheck } = await import("../cron/loanCheckCron.js");
const { runNotificationCleanup } = await import("../services/notificationService.js");

describe("distributed lock: schedulers skip when lock is held", () => {
  beforeEach(() => {
    mockWarn.mockClear();
  });

  describe("webhookRetryScheduler", () => {
    it("skips run when lock is not acquired", async () => {
      const result = await retryFailedWebhooks();
      expect(result).toBeUndefined();
      expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining("skipped"));
    });
  });

  describe("scoreReconciliationService", () => {
    it("skips run when lock is not acquired", async () => {
      const result = await scoreReconciliationService.reconcileActiveBorrowerScores();
      expect(result).toBeNull();
      expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining("skipped"));
    });
  });

  describe("loanCheckCron", () => {
    it("skips run when lock is not acquired", async () => {
      const result = await runLoanDueCheck();
      expect(result).toBeUndefined();
      expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining("skipped"));
    });
  });

  describe("notificationService cleanup", () => {
    it("skips run when lock is not acquired", async () => {
      const result = await runNotificationCleanup();
      expect(result).toBeUndefined();
      expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining("skipped"));
    });
  });
});
