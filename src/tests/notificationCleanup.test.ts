import { jest } from "@jest/globals";

const mockLoggerError = jest.fn();

jest.unstable_mockModule("../utils/logger.js", () => ({
  default: {
    error: mockLoggerError,
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.unstable_mockModule("../services/cacheService.js", () => ({
  cacheService: {
    setNotExists: jest.fn(async () => true),
    delete: jest.fn(async () => undefined),
  },
}));

// Use unstable_mockModule for robust ESM mocking of the connection module
jest.unstable_mockModule("../db/connection.js", () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  default: {
    query: jest.fn(),
  },
}));

// Use dynamic imports TO ENSURE mocks are applied BEFORE the module is loaded
const { query } = await import("../db/connection.js");
const {
  notificationService,
  startNotificationCleanupScheduler,
  stopNotificationCleanupScheduler,
} = await import("../services/notificationService.js");

const mockedQuery = query as jest.MockedFunction<typeof query>;

describe("Notification Cleanup Strategy", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    stopNotificationCleanupScheduler();
    delete process.env.NOTIFICATION_CLEANUP_INTERVAL_MS;
  });

  afterEach(() => {
    stopNotificationCleanupScheduler();
    jest.useRealTimers();
    delete process.env.NOTIFICATION_CLEANUP_INTERVAL_MS;
  });

  describe("deleteOldNotifications", () => {
    it("should delete notifications older than the retention threshold", async () => {
      const retentionDays = 90;

      mockedQuery.mockResolvedValue({ rowCount: 2 } as any);

      const deletedCount =
        await notificationService.deleteOldNotifications(retentionDays);

      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM notifications"),
        [retentionDays],
      );
      expect(deletedCount).toBe(2);
    });

    it("should return 0 if no notifications are deleted", async () => {
      mockedQuery.mockResolvedValue({ rowCount: 0 } as any);

      const deletedCount = await notificationService.deleteOldNotifications(90);

      expect(deletedCount).toBe(0);
    });

    it("should handle database errors gracefully", async () => {
      mockedQuery.mockRejectedValue(new Error("Database error") as never);

      const deletedCount = await notificationService.deleteOldNotifications(90);

      expect(deletedCount).toBe(0);
    });
  });

  describe("deleteReadAndArchived", () => {
    it("should delete read and archived notifications older than the retention threshold", async () => {
      const retentionDays = 30;

      mockedQuery.mockResolvedValue({ rowCount: 5 } as any);

      const deletedCount =
        await notificationService.deleteReadAndArchived(retentionDays);

      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining("status IN ('read', 'archived')"),
        [retentionDays],
      );
      expect(deletedCount).toBe(5);
    });

    it("should return 0 if no read/archived notifications are deleted", async () => {
      mockedQuery.mockResolvedValue({ rowCount: 0 } as any);

      const deletedCount = await notificationService.deleteReadAndArchived(30);

      expect(deletedCount).toBe(0);
    });

    it("should handle database errors gracefully", async () => {
      mockedQuery.mockRejectedValue(new Error("Database error") as never);

      const deletedCount = await notificationService.deleteReadAndArchived(30);

      expect(deletedCount).toBe(0);
    });
  });

  describe("startNotificationCleanupScheduler", () => {
    it("should catch and log thrown cleanup errors without stopping future runs", async () => {
      jest.useFakeTimers();
      process.env.NOTIFICATION_CLEANUP_INTERVAL_MS = "1000";

      const deleteOldSpy = jest
        .spyOn(notificationService, "deleteOldNotifications")
        .mockRejectedValueOnce(new Error("cleanup failed"))
        .mockResolvedValue(0);
      const deleteReadSpy = jest
        .spyOn(notificationService, "deleteReadAndArchived")
        .mockResolvedValue(0);

      startNotificationCleanupScheduler();
      for (let i = 0; i < 10; i += 1) {
        await Promise.resolve();
      }

      expect(mockLoggerError).toHaveBeenCalledWith(
        "Notification cleanup scheduled run failed",
        { error: expect.any(Error) },
      );

      await jest.advanceTimersByTimeAsync(1000);

      expect(deleteOldSpy).toHaveBeenCalledTimes(2);
      expect(deleteReadSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("archiveNotifications", () => {
    it("should set status to archived and read to true for the given ids", async () => {
      mockedQuery.mockResolvedValue({ rowCount: 2 } as any);

      await notificationService.archiveNotifications("user-1", [1, 2]);

      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = 'archived'"),
        ["user-1", [1, 2]],
      );
    });

    it("should not query the database when ids array is empty", async () => {
      await notificationService.archiveNotifications("user-1", []);

      expect(mockedQuery).not.toHaveBeenCalled();
    });
  });

  describe("getUnreadCount", () => {
    it("should count notifications with status unread", async () => {
      mockedQuery.mockResolvedValue({ rows: [{ count: "3" }] } as any);

      const count = await notificationService.getUnreadCount("user-1");

      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = 'unread'"),
        ["user-1"],
      );
      expect(count).toBe(3);
    });

    it("should return 0 when there are no unread notifications", async () => {
      mockedQuery.mockResolvedValue({ rows: [{ count: "0" }] } as any);

      const count = await notificationService.getUnreadCount("user-1");

      expect(count).toBe(0);
    });
  });
});
