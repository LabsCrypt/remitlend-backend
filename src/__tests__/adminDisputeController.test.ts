import request from "supertest";
import { jest } from "@jest/globals";
import { Keypair } from "@stellar/stellar-sdk";
import { generateJwtToken } from "../services/authService.js";

type MockQueryResult = { rows: unknown[]; rowCount?: number };

const TEST_ADMIN = Keypair.random().publicKey();
const TEST_BORROWER = Keypair.random().publicKey();
const TEST_USER = Keypair.random().publicKey();

process.env.JWT_SECRET = "test-jwt-secret-min-32-chars-long!!";
process.env.ADMIN_WALLETS = `${TEST_ADMIN}`;

const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();

jest.unstable_mockModule("../db/connection.js", () => ({
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn<() => Promise<unknown>>(),
  withTransaction: jest.fn<
    (fn: (client: unknown) => Promise<unknown>) => Promise<unknown>
  >((fn) => fn({ query: mockQuery, release: jest.fn() })),
  pool: { query: mockQuery },
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
    ping: jest.fn<() => Promise<string>>().mockResolvedValue("ok"),
  },
}));

jest.unstable_mockModule("../services/notificationService.js", () => ({
  notificationService: {
    createNotification: jest
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined),
  },
}));

await import("../db/connection.js");
const { default: app } = await import("../app.js");

const mockedQuery = mockQuery;

const bearer = (publicKey: string, _role?: string) => ({
  Authorization: `Bearer ${generateJwtToken(publicKey)}`,
});

beforeEach(() => {
  mockedQuery.mockReset();
  jest.clearAllMocks();
});

afterAll(() => {
  delete process.env.JWT_SECRET;
  delete process.env.ADMIN_WALLETS;
});

// ---------------------------------------------------------------------------
// GET /api/admin/disputes
// ---------------------------------------------------------------------------
describe("GET /api/admin/disputes", () => {
  it("should reject unauthenticated requests", async () => {
    const response = await request(app).get("/api/admin/disputes");
    expect(response.status).toBe(401);
  });

  it("should reject non-admin users", async () => {
    const response = await request(app)
      .get("/api/admin/disputes")
      .set(bearer(TEST_USER));

    expect(response.status).toBe(403);
  });

  it("should return list of disputes for admin", async () => {
    const disputes = [
      {
        id: 1,
        loan_id: 100,
        borrower: TEST_BORROWER,
        reason: "Payment not received",
        status: "open",
        created_at: "2025-01-01T00:00:00Z",
      },
      {
        id: 2,
        loan_id: 101,
        borrower: TEST_BORROWER,
        reason: "Technical issue",
        status: "open",
        created_at: "2025-01-02T00:00:00Z",
      },
    ];

    mockedQuery.mockResolvedValueOnce({
      rows: disputes,
      rowCount: 2,
    });

    const response = await request(app)
      .get("/api/admin/disputes")
      .set(bearer(TEST_ADMIN, "admin"));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.disputes.length).toBe(2);
  });

  it("should return empty list when no disputes exist", async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
    });

    const response = await request(app)
      .get("/api/admin/disputes")
      .set(bearer(TEST_ADMIN, "admin"));

    expect(response.status).toBe(200);
    expect(response.body.disputes).toEqual([]);
  });

  it("should filter disputes by status", async () => {
    const openDisputes = [
      {
        id: 1,
        loan_id: 100,
        status: "open",
      },
    ];

    mockedQuery.mockResolvedValueOnce({
      rows: openDisputes,
      rowCount: 1,
    });

    const response = await request(app)
      .get("/api/admin/disputes?status=open")
      .set(bearer(TEST_ADMIN, "admin"));

    expect(response.status).toBe(200);
    expect(response.body.disputes.length).toBe(1);
  });

  it("should reject invalid status filter", async () => {
    const response = await request(app)
      .get("/api/admin/disputes?status=invalid_status")
      .set(bearer(TEST_ADMIN, "admin"));

    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/disputes/:disputeId
// ---------------------------------------------------------------------------
describe("GET /api/admin/disputes/:disputeId", () => {
  it("should reject unauthenticated requests", async () => {
    const response = await request(app).get("/api/admin/disputes/1");
    expect(response.status).toBe(401);
  });

  it("should reject non-admin users", async () => {
    const response = await request(app)
      .get("/api/admin/disputes/1")
      .set(bearer(TEST_USER, "borrower"));

    expect(response.status).toBe(403);
  });

  it("should return dispute details for admin", async () => {
    const dispute = {
      id: 1,
      loan_id: 100,
      borrower: TEST_BORROWER,
      reason: "Payment not received",
      status: "open",
      created_at: "2025-01-01T00:00:00Z",
      loan: {
        id: 100,
        amount: 1000,
        status: "active",
      },
    };

    mockedQuery.mockResolvedValueOnce({
      rows: [dispute],
      rowCount: 1,
    });

    const response = await request(app)
      .get("/api/admin/disputes/1")
      .set(bearer(TEST_ADMIN, "admin"));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.dispute.id).toBe(1);
    expect(response.body.dispute.loan_id).toBe(100);
  });

  it("should return 404 for nonexistent dispute", async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
    });

    const response = await request(app)
      .get("/api/admin/disputes/999")
      .set(bearer(TEST_ADMIN, "admin"));

    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/disputes/:disputeId/resolve
// ---------------------------------------------------------------------------
describe("POST /api/admin/disputes/:disputeId/resolve", () => {
  it("should reject unauthenticated requests", async () => {
    const response = await request(app)
      .post("/api/admin/disputes/1/resolve")
      .send({
        action: "confirm",
        resolution: "Payment verified",
      });

    expect(response.status).toBe(401);
  });

  it("should reject non-admin users", async () => {
    const response = await request(app)
      .post("/api/admin/disputes/1/resolve")
      .set(bearer(TEST_USER, "borrower"))
      .send({
        action: "confirm",
        resolution: "Payment verified",
      });

    expect(response.status).toBe(403);
  });

  it("should resolve dispute with confirm action", async () => {
    const dispute = {
      id: 1,
      loan_id: 100,
      borrower: TEST_BORROWER,
      status: "open",
    };

    mockedQuery
      .mockResolvedValueOnce({ rows: [dispute], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });

    const response = await request(app)
      .post("/api/admin/disputes/1/resolve")
      .set(bearer(TEST_ADMIN, "admin"))
      .send({
        action: "confirm",
        resolution: "Default confirmed after review",
        adminNote: "Borrower did not respond",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it("should resolve dispute with reverse action", async () => {
    const dispute = {
      id: 1,
      loan_id: 100,
      borrower: TEST_BORROWER,
      status: "open",
    };

    mockedQuery
      .mockResolvedValueOnce({ rows: [dispute], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });

    const response = await request(app)
      .post("/api/admin/disputes/1/resolve")
      .set(bearer(TEST_ADMIN, "admin"))
      .send({
        action: "reverse",
        resolution: "Payment was delayed due to system error",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it("should reject invalid action", async () => {
    const response = await request(app)
      .post("/api/admin/disputes/1/resolve")
      .set(bearer(TEST_ADMIN, "admin"))
      .send({
        action: "invalid_action",
        resolution: "Some resolution",
      });

    expect(response.status).toBe(400);
  });

  it("should require resolution reason", async () => {
    const response = await request(app)
      .post("/api/admin/disputes/1/resolve")
      .set(bearer(TEST_ADMIN, "admin"))
      .send({
        action: "confirm",
        resolution: "No", // Too short (less than 5 chars)
      });

    expect(response.status).toBe(400);
  });

  it("should require minimum resolution length", async () => {
    const response = await request(app)
      .post("/api/admin/disputes/1/resolve")
      .set(bearer(TEST_ADMIN, "admin"))
      .send({
        action: "confirm",
        // No resolution provided
      });

    expect(response.status).toBe(400);
  });

  it("should reject resolution on already-resolved dispute", async () => {
    const dispute = {
      id: 1,
      loan_id: 100,
      borrower: TEST_BORROWER,
      status: "resolved", // Already resolved
    };

    mockedQuery.mockResolvedValue({
      rows: [], // No open dispute found
      rowCount: 0,
    });

    const response = await request(app)
      .post("/api/admin/disputes/1/resolve")
      .set(bearer(TEST_ADMIN, "admin"))
      .send({
        action: "confirm",
        resolution: "Attempted resolution",
      });

    expect(response.status).toBe(404);
  });

  it("should log events correctly on confirm", async () => {
    const dispute = {
      id: 1,
      loan_id: 100,
      borrower: TEST_BORROWER,
      status: "open",
    };

    mockedQuery
      .mockResolvedValueOnce({ rows: [dispute], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });

    await request(app)
      .post("/api/admin/disputes/1/resolve")
      .set(bearer(TEST_ADMIN, "admin"))
      .send({
        action: "confirm",
        resolution: "Default confirmed",
      });

    // Verify the dispute was updated to resolved
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE loan_disputes SET status = 'resolved'"),
      expect.anything(),
    );
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/disputes/:disputeId/reject
// ---------------------------------------------------------------------------
describe("POST /api/admin/disputes/:disputeId/reject", () => {
  it("should reject unauthenticated requests", async () => {
    const response = await request(app)
      .post("/api/admin/disputes/1/reject")
      .send({});

    expect(response.status).toBe(401);
  });

  it("should reject non-admin users", async () => {
    const response = await request(app)
      .post("/api/admin/disputes/1/reject")
      .set(bearer(TEST_USER, "borrower"))
      .send({});

    expect(response.status).toBe(403);
  });

  it("should reject dispute with optional note", async () => {
    const dispute = {
      id: 1,
      loan_id: 100,
      borrower: TEST_BORROWER,
      status: "open",
    };

    mockedQuery
      .mockResolvedValueOnce({ rows: [dispute], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });

    const response = await request(app)
      .post("/api/admin/disputes/1/reject")
      .set(bearer(TEST_ADMIN, "admin"))
      .send({
        admin_note: "Insufficient evidence provided",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it("should reject dispute without note", async () => {
    const dispute = {
      id: 1,
      loan_id: 100,
      borrower: TEST_BORROWER,
      status: "open",
    };

    mockedQuery
      .mockResolvedValueOnce({ rows: [dispute], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });

    const response = await request(app)
      .post("/api/admin/disputes/1/reject")
      .set(bearer(TEST_ADMIN, "admin"))
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it("should reject resolution on already-resolved dispute", async () => {
    mockedQuery.mockResolvedValue({
      rows: [], // No open dispute found
      rowCount: 0,
    });

    const response = await request(app)
      .post("/api/admin/disputes/1/reject")
      .set(bearer(TEST_ADMIN, "admin"))
      .send({});

    expect(response.status).toBe(404);
  });

  it("should update dispute status to rejected", async () => {
    const dispute = {
      id: 1,
      loan_id: 100,
      borrower: TEST_BORROWER,
      status: "open",
    };

    mockedQuery
      .mockResolvedValueOnce({ rows: [dispute], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });

    await request(app)
      .post("/api/admin/disputes/1/reject")
      .set(bearer(TEST_ADMIN, "admin"))
      .send({
        admin_note: "Insufficient evidence",
      });

    // Verify the dispute was updated to rejected
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE loan_disputes SET status = 'rejected'"),
      expect.anything(),
    );
  });
});

// ---------------------------------------------------------------------------
// Admin Dispute Controller - Authorization Tests
// ---------------------------------------------------------------------------
describe("Admin Dispute Controller - Authorization", () => {
  it("should enforce admin role on list disputes", async () => {
    const response = await request(app)
      .get("/api/admin/disputes")
      .set(bearer(TEST_USER));

    expect(response.status).toBe(403);
  });

  it("should enforce admin role on get dispute", async () => {
    const response = await request(app)
      .get("/api/admin/disputes/1")
      .set(bearer(TEST_USER));

    expect(response.status).toBe(403);
  });

  it("should enforce admin role on resolve", async () => {
    const response = await request(app)
      .post("/api/admin/disputes/1/resolve")
      .set(bearer(TEST_USER))
      .send({
        action: "confirm",
        resolution: "Some resolution",
      });

    expect(response.status).toBe(403);
  });

  it("should enforce admin role on reject", async () => {
    const response = await request(app)
      .post("/api/admin/disputes/1/reject")
      .set(bearer(TEST_USER))
      .send({});

    expect(response.status).toBe(403);
  });

  it("should allow admin to access all operations", async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
    });

    const response = await request(app)
      .get("/api/admin/disputes")
      .set(bearer(TEST_ADMIN));

    expect(response.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Admin Dispute Controller - Happy Path Scenarios
// ---------------------------------------------------------------------------
describe("Admin Dispute Controller - Happy Path Scenarios", () => {
  it("should handle complete flow: open -> resolve (confirm)", async () => {
    const dispute = {
      id: 1,
      loan_id: 100,
      borrower: TEST_BORROWER,
      reason: "Payment missing",
      status: "open",
    };

    // Get dispute
    mockedQuery.mockResolvedValueOnce({
      rows: [dispute],
      rowCount: 1,
    });

    const getResponse = await request(app)
      .get("/api/admin/disputes/1")
      .set(bearer(TEST_ADMIN, "admin"));

    expect(getResponse.status).toBe(200);
    expect(getResponse.body.dispute.status).toBe("open");

    // Resolve dispute
    mockedQuery.mockResolvedValueOnce({
      rows: [dispute],
      rowCount: 1,
    });
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 1 }],
      rowCount: 1,
    });

    const resolveResponse = await request(app)
      .post("/api/admin/disputes/1/resolve")
      .set(bearer(TEST_ADMIN, "admin"))
      .send({
        action: "confirm",
        resolution: "Default confirmed after admin review",
      });

    expect(resolveResponse.status).toBe(200);
    expect(resolveResponse.body.success).toBe(true);
  });

  it("should handle complete flow: open -> resolve (reverse)", async () => {
    const dispute = {
      id: 2,
      loan_id: 101,
      borrower: TEST_BORROWER,
      reason: "System error claim",
      status: "open",
    };

    mockedQuery.mockResolvedValueOnce({
      rows: [dispute],
      rowCount: 1,
    });
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 2 }],
      rowCount: 1,
    });

    const response = await request(app)
      .post("/api/admin/disputes/2/resolve")
      .set(bearer(TEST_ADMIN))
      .send({
        action: "reverse",
        resolution:
          "Payment was delayed due to network issue, reversal approved",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it("should handle complete flow: open -> reject", async () => {
    const dispute = {
      id: 3,
      loan_id: 102,
      borrower: TEST_BORROWER,
      reason: "Claiming system error",
      status: "open",
    };

    mockedQuery.mockResolvedValueOnce({
      rows: [dispute],
      rowCount: 1,
    });
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 3 }],
      rowCount: 1,
    });

    const response = await request(app)
      .post("/api/admin/disputes/3/reject")
      .set(bearer(TEST_ADMIN))
      .send({
        admin_note: "No supporting evidence provided",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
});
