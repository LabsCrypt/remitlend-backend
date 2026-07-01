import request from "supertest";
import { jest } from "@jest/globals";
import { Keypair } from "@stellar/stellar-sdk";
import { generateJwtToken } from "../services/authService.js";

type MockQueryResult = { rows: unknown[]; rowCount?: number };

const TEST_USER = Keypair.random().publicKey();
const OTHER_USER = Keypair.random().publicKey();

process.env.JWT_SECRET = "test-jwt-secret-min-32-chars-long!!";

jest.unstable_mockModule("../db/connection.js", () => ({
  default: { query: jest.fn() },
  query: jest.fn(),
  closePool: jest.fn(),
}));

jest.unstable_mockModule("../services/cacheService.js", () => ({
  cacheService: {
    get: jest.fn<() => Promise<any>>().mockResolvedValue(null),
    set: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    delete: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    ping: jest.fn<() => Promise<string>>().mockResolvedValue("ok"),
  },
}));

jest.unstable_mockModule("../services/sorobanService.js", () => ({
  sorobanService: {
    ping: jest.fn().mockResolvedValue("ok"),
  },
}));

const mockNotificationService = {
  getNotificationsForUser: jest.fn(),
  getUnreadCount: jest.fn(),
  markRead: jest.fn(),
  markAllRead: jest.fn(),
  subscribe: jest.fn(),
  createNotification: jest.fn(),
};

jest.unstable_mockModule("../services/notificationService.js", () => ({
  notificationService: mockNotificationService,
}));

await import("../db/connection.js");
await import("../services/notificationService.js");
const { default: app } = await import("../app.js");

const bearer = (publicKey: string) => ({
  Authorization: `Bearer ${generateJwtToken(publicKey)}`,
});

beforeEach(() => {
  jest.clearAllMocks();
});

afterAll(() => {
  delete process.env.JWT_SECRET;
});

// ---------------------------------------------------------------------------
// GET /api/notifications
// ---------------------------------------------------------------------------
describe("GET /api/notifications", () => {
  it("should reject unauthenticated requests", async () => {
    const response = await request(app).get("/api/notifications");
    expect(response.status).toBe(401);
  });

  it("should return notifications for authenticated user", async () => {
    const notifications = [
      {
        id: 1,
        userId: TEST_USER,
        type: "loan_approved",
        title: "Loan Approved",
        message: "Your loan has been approved",
        read: false,
        createdAt: "2025-01-15T10:00:00Z",
      },
      {
        id: 2,
        userId: TEST_USER,
        type: "repayment_confirmed",
        title: "Payment Confirmed",
        message: "Your repayment was successful",
        read: true,
        createdAt: "2025-01-14T10:00:00Z",
      },
    ];

    mockNotificationService.getNotificationsForUser.mockResolvedValueOnce(
      notifications,
    );
    mockNotificationService.getUnreadCount.mockResolvedValueOnce(1);

    const response = await request(app)
      .get("/api/notifications")
      .set(bearer(TEST_USER));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.notifications.length).toBe(2);
    expect(response.body.data.unreadCount).toBe(1);
  });

  it("should return empty notification list", async () => {
    mockNotificationService.getNotificationsForUser.mockResolvedValueOnce([]);
    mockNotificationService.getUnreadCount.mockResolvedValueOnce(0);

    const response = await request(app)
      .get("/api/notifications")
      .set(bearer(TEST_USER));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.notifications).toEqual([]);
    expect(response.body.data.unreadCount).toBe(0);
  });

  it("should respect limit parameter", async () => {
    const notifications = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      userId: TEST_USER,
      type: "loan_status",
      title: `Notification ${i + 1}`,
      message: "Test message",
      read: false,
      createdAt: new Date(Date.now() - i * 1000).toISOString(),
    }));

    mockNotificationService.getNotificationsForUser.mockResolvedValueOnce(
      notifications.slice(0, 25),
    );
    mockNotificationService.getUnreadCount.mockResolvedValueOnce(25);

    const response = await request(app)
      .get("/api/notifications?limit=25")
      .set(bearer(TEST_USER));

    expect(response.status).toBe(200);
    expect(
      mockNotificationService.getNotificationsForUser,
    ).toHaveBeenCalledWith(TEST_USER, 25);
  });

  it("should cap limit at 100", async () => {
    const notifications = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      userId: TEST_USER,
      type: "loan_status",
    }));

    mockNotificationService.getNotificationsForUser.mockResolvedValueOnce(
      notifications,
    );
    mockNotificationService.getUnreadCount.mockResolvedValueOnce(50);

    const response = await request(app)
      .get("/api/notifications?limit=200")
      .set(bearer(TEST_USER));

    expect(response.status).toBe(200);
    expect(
      mockNotificationService.getNotificationsForUser,
    ).toHaveBeenCalledWith(TEST_USER, 100);
  });

  it("should include unread count", async () => {
    const notifications = [
      {
        id: 1,
        read: false,
      },
      {
        id: 2,
        read: false,
      },
      {
        id: 3,
        read: true,
      },
    ];

    mockNotificationService.getNotificationsForUser.mockResolvedValueOnce(
      notifications,
    );
    mockNotificationService.getUnreadCount.mockResolvedValueOnce(2);

    const response = await request(app)
      .get("/api/notifications")
      .set(bearer(TEST_USER));

    expect(response.status).toBe(200);
    expect(response.body.data.unreadCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// POST /api/notifications/mark-read
// ---------------------------------------------------------------------------
describe("POST /api/notifications/mark-read", () => {
  it("should reject unauthenticated requests", async () => {
    const response = await request(app)
      .post("/api/notifications/mark-read")
      .send({ ids: [1, 2] });

    expect(response.status).toBe(401);
  });

  it("should mark specific notifications as read", async () => {
    mockNotificationService.markRead.mockResolvedValueOnce(undefined);

    const response = await request(app)
      .post("/api/notifications/mark-read")
      .set(bearer(TEST_USER))
      .send({ ids: [1, 2, 3] });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mockNotificationService.markRead).toHaveBeenCalledWith(
      TEST_USER,
      [1, 2, 3],
    );
  });

  it("should reject empty ids array", async () => {
    const response = await request(app)
      .post("/api/notifications/mark-read")
      .set(bearer(TEST_USER))
      .send({ ids: [] });

    expect(response.status).toBe(400);
  });

  it("should reject non-numeric ids", async () => {
    const response = await request(app)
      .post("/api/notifications/mark-read")
      .set(bearer(TEST_USER))
      .send({ ids: ["1", "2", "3"] });

    expect(response.status).toBe(400);
  });

  it("should reject non-array ids", async () => {
    const response = await request(app)
      .post("/api/notifications/mark-read")
      .set(bearer(TEST_USER))
      .send({ ids: 1 });

    expect(response.status).toBe(400);
  });

  it("should reject missing ids", async () => {
    const response = await request(app)
      .post("/api/notifications/mark-read")
      .set(bearer(TEST_USER))
      .send({});

    expect(response.status).toBe(400);
  });

  it("should handle marking single notification", async () => {
    mockNotificationService.markRead.mockResolvedValueOnce(undefined);

    const response = await request(app)
      .post("/api/notifications/mark-read")
      .set(bearer(TEST_USER))
      .send({ ids: [42] });

    expect(response.status).toBe(200);
    expect(mockNotificationService.markRead).toHaveBeenCalledWith(
      TEST_USER,
      [42],
    );
  });

  it("should enforce user ownership - only read own notifications", async () => {
    mockNotificationService.markRead.mockResolvedValueOnce(undefined);

    const response = await request(app)
      .post("/api/notifications/mark-read")
      .set(bearer(TEST_USER))
      .send({ ids: [1, 2] });

    // Service should be called with the authenticated user's ID
    expect(mockNotificationService.markRead).toHaveBeenCalledWith(
      TEST_USER,
      expect.anything(),
    );
    expect(response.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// POST /api/notifications/mark-all-read
// ---------------------------------------------------------------------------
describe("POST /api/notifications/mark-all-read", () => {
  it("should reject unauthenticated requests", async () => {
    const response = await request(app).post(
      "/api/notifications/mark-all-read",
    );
    expect(response.status).toBe(401);
  });

  it("should mark all notifications as read", async () => {
    mockNotificationService.markAllRead.mockResolvedValueOnce(undefined);

    const response = await request(app)
      .post("/api/notifications/mark-all-read")
      .set(bearer(TEST_USER));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mockNotificationService.markAllRead).toHaveBeenCalledWith(TEST_USER);
  });

  it("should enforce user ownership - only mark own notifications", async () => {
    mockNotificationService.markAllRead.mockResolvedValueOnce(undefined);

    const response = await request(app)
      .post("/api/notifications/mark-all-read")
      .set(bearer(TEST_USER));

    // Service should be called with the authenticated user's ID
    expect(mockNotificationService.markAllRead).toHaveBeenCalledWith(TEST_USER);
    expect(response.status).toBe(200);
  });

  it("should handle marking all when no unread exist", async () => {
    mockNotificationService.markAllRead.mockResolvedValueOnce(undefined);

    const response = await request(app)
      .post("/api/notifications/mark-all-read")
      .set(bearer(TEST_USER));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /api/notifications/stream
// ---------------------------------------------------------------------------
describe("GET /api/notifications/stream", () => {
  it("should reject unauthenticated requests", async () => {
    const response = await request(app).get("/api/notifications/stream");
    expect(response.status).toBe(401);
  });

  it("should establish SSE connection for authenticated user", async () => {
    const mockUnsubscribe = jest.fn();
    mockNotificationService.getNotificationsForUser.mockResolvedValueOnce([]);
    mockNotificationService.subscribe.mockReturnValueOnce(mockUnsubscribe);

    const response = await request(app)
      .get("/api/notifications/stream")
      .set(bearer(TEST_USER));

    // SSE streams are typically handled with 200 status and event-stream content-type
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
  });

  it("should send unread notifications on connect", async () => {
    const unreadNotifications = [
      {
        id: 1,
        type: "loan_approved",
        title: "Loan Approved",
        read: false,
      },
    ];

    const mockUnsubscribe = jest.fn();
    mockNotificationService.getNotificationsForUser.mockResolvedValueOnce([
      ...unreadNotifications,
      { id: 2, type: "other", read: true },
    ]);
    mockNotificationService.subscribe.mockReturnValueOnce(mockUnsubscribe);

    const response = await request(app)
      .get("/api/notifications/stream")
      .set(bearer(TEST_USER));

    expect(response.status).toBe(200);
    expect(
      mockNotificationService.getNotificationsForUser,
    ).toHaveBeenCalledWith(TEST_USER, 50);
  });

  it("should set correct SSE headers", async () => {
    const mockUnsubscribe = jest.fn();
    mockNotificationService.getNotificationsForUser.mockResolvedValueOnce([]);
    mockNotificationService.subscribe.mockReturnValueOnce(mockUnsubscribe);

    const response = await request(app)
      .get("/api/notifications/stream")
      .set(bearer(TEST_USER));

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["cache-control"]).toBe("no-cache");
    expect(response.headers["connection"]).toBe("keep-alive");
  });

  it("should subscribe user to notification events", async () => {
    const mockUnsubscribe = jest.fn();
    mockNotificationService.getNotificationsForUser.mockResolvedValueOnce([]);
    mockNotificationService.subscribe.mockReturnValueOnce(mockUnsubscribe);

    await request(app).get("/api/notifications/stream").set(bearer(TEST_USER));

    expect(mockNotificationService.subscribe).toHaveBeenCalledWith(
      TEST_USER,
      expect.any(Object),
    );
  });

  it("should handle empty notification list on connect", async () => {
    const mockUnsubscribe = jest.fn();
    mockNotificationService.getNotificationsForUser.mockResolvedValueOnce([]);
    mockNotificationService.subscribe.mockReturnValueOnce(mockUnsubscribe);

    const response = await request(app)
      .get("/api/notifications/stream")
      .set(bearer(TEST_USER));

    expect(response.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Notification Controller - Authorization Tests
// ---------------------------------------------------------------------------
describe("Notification Controller - Authorization", () => {
  it("should enforce user isolation - cannot access other's notifications", async () => {
    mockNotificationService.getNotificationsForUser.mockResolvedValueOnce([]);
    mockNotificationService.getUnreadCount.mockResolvedValueOnce(0);

    const response = await request(app)
      .get("/api/notifications")
      .set(bearer(TEST_USER));

    // Should be called with TEST_USER, not OTHER_USER
    expect(
      mockNotificationService.getNotificationsForUser,
    ).toHaveBeenCalledWith(TEST_USER, expect.any(Number));
  });

  it("should enforce user isolation on mark-read", async () => {
    mockNotificationService.markRead.mockResolvedValueOnce(undefined);

    await request(app)
      .post("/api/notifications/mark-read")
      .set(bearer(TEST_USER))
      .send({ ids: [1] });

    // Should be called with TEST_USER
    expect(mockNotificationService.markRead).toHaveBeenCalledWith(
      TEST_USER,
      expect.anything(),
    );
  });

  it("should enforce user isolation on mark-all-read", async () => {
    mockNotificationService.markAllRead.mockResolvedValueOnce(undefined);

    await request(app)
      .post("/api/notifications/mark-all-read")
      .set(bearer(TEST_USER));

    // Should be called with TEST_USER
    expect(mockNotificationService.markAllRead).toHaveBeenCalledWith(TEST_USER);
  });

  it("should enforce user isolation on stream", async () => {
    const mockUnsubscribe = jest.fn();
    mockNotificationService.getNotificationsForUser.mockResolvedValueOnce([]);
    mockNotificationService.subscribe.mockReturnValueOnce(mockUnsubscribe);

    await request(app).get("/api/notifications/stream").set(bearer(TEST_USER));

    // Should subscribe with TEST_USER
    expect(mockNotificationService.subscribe).toHaveBeenCalledWith(
      TEST_USER,
      expect.anything(),
    );
  });
});

// ---------------------------------------------------------------------------
// Notification Controller - Happy Path Scenarios
// ---------------------------------------------------------------------------
describe("Notification Controller - Happy Path Scenarios", () => {
  it("should handle complete flow: get -> mark-read -> mark-all-read", async () => {
    // Get notifications
    const notifications = [
      { id: 1, read: false },
      { id: 2, read: false },
      { id: 3, read: true },
    ];

    mockNotificationService.getNotificationsForUser.mockResolvedValueOnce(
      notifications,
    );
    mockNotificationService.getUnreadCount.mockResolvedValueOnce(2);

    let response = await request(app)
      .get("/api/notifications")
      .set(bearer(TEST_USER));

    expect(response.status).toBe(200);
    expect(response.body.data.unreadCount).toBe(2);

    // Mark specific as read
    mockNotificationService.markRead.mockResolvedValueOnce(undefined);

    response = await request(app)
      .post("/api/notifications/mark-read")
      .set(bearer(TEST_USER))
      .send({ ids: [1] });

    expect(response.status).toBe(200);

    // Mark all as read
    mockNotificationService.markAllRead.mockResolvedValueOnce(undefined);

    response = await request(app)
      .post("/api/notifications/mark-all-read")
      .set(bearer(TEST_USER));

    expect(response.status).toBe(200);
  });

  it("should handle stream with initial unread notifications", async () => {
    const notifications = [
      { id: 1, type: "loan_approved", read: false },
      { id: 2, type: "loan_approved", read: false },
      { id: 3, type: "repayment_confirmed", read: true },
    ];

    const mockUnsubscribe = jest.fn();
    mockNotificationService.getNotificationsForUser.mockResolvedValueOnce(
      notifications,
    );
    mockNotificationService.subscribe.mockReturnValueOnce(mockUnsubscribe);

    const response = await request(app)
      .get("/api/notifications/stream")
      .set(bearer(TEST_USER));

    expect(response.status).toBe(200);
    expect(mockNotificationService.getNotificationsForUser).toHaveBeenCalled();
  });
});
