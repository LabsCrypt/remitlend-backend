import request from "supertest";
import { jest } from "@jest/globals";
import { Keypair } from "@stellar/stellar-sdk";
import { generateJwtToken } from "../services/authService.js";

type MockQueryResult = { rows: unknown[]; rowCount?: number };

const VALID_API_KEY = "test-internal-key";
const TEST_USER = Keypair.random().publicKey();
const OTHER_USER = Keypair.random().publicKey();

process.env.JWT_SECRET = "test-jwt-secret-min-32-chars-long!!";
process.env.INTERNAL_API_KEY = VALID_API_KEY;

const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();

jest.unstable_mockModule("../db/connection.js", () => ({
  default: { query: mockQuery },
  query: mockQuery,
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

await import("../db/connection.js");
const { default: app } = await import("../app.js");

const mockedQuery = mockQuery;

const bearer = (publicKey: string) => ({
  Authorization: `Bearer ${generateJwtToken(publicKey)}`,
});

const apiKeyHeader = () => ({
  "x-api-key": VALID_API_KEY,
});

beforeEach(() => {
  mockedQuery.mockReset();
  jest.clearAllMocks();
});

afterAll(() => {
  delete process.env.JWT_SECRET;
  delete process.env.INTERNAL_API_KEY;
});

// ---------------------------------------------------------------------------
// GET /api/score/:userId
// ---------------------------------------------------------------------------
describe("GET /api/score/:userId", () => {
  it("should reject unauthenticated requests", async () => {
    const response = await request(app).get(`/api/score/${TEST_USER}`);
    expect(response.status).toBe(401);
  });

  it("should reject when userId does not match JWT wallet", async () => {
    const response = await request(app)
      .get(`/api/score/${OTHER_USER}`)
      .set(bearer(TEST_USER));

    expect(response.status).toBe(403);
  });

  it("should return score when userId matches JWT wallet", async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ current_score: 650 }],
      rowCount: 1,
    });

    const response = await request(app)
      .get(`/api/score/${TEST_USER}`)
      .set(bearer(TEST_USER));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.userId).toBe(TEST_USER);
    expect(response.body.score).toBe(650);
    expect(response.body.band).toBe("Good");
  });

  it("should return default score 500 when no score exists", async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
    });

    const response = await request(app)
      .get(`/api/score/${TEST_USER}`)
      .set(bearer(TEST_USER));

    expect(response.status).toBe(200);
    expect(response.body.score).toBe(500);
    expect(response.body.band).toBe("Poor");
  });

  it("should return Excellent band for score >= 750", async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ current_score: 800 }],
      rowCount: 1,
    });

    const response = await request(app)
      .get(`/api/score/${TEST_USER}`)
      .set(bearer(TEST_USER));

    expect(response.status).toBe(200);
    expect(response.body.band).toBe("Excellent");
  });

  it("should return Fair band for score in range 580-669", async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ current_score: 600 }],
      rowCount: 1,
    });

    const response = await request(app)
      .get(`/api/score/${TEST_USER}`)
      .set(bearer(TEST_USER));

    expect(response.status).toBe(200);
    expect(response.body.band).toBe("Fair");
  });

  it("should include score factors in response", async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ current_score: 700 }],
      rowCount: 1,
    });

    const response = await request(app)
      .get(`/api/score/${TEST_USER}`)
      .set(bearer(TEST_USER));

    expect(response.status).toBe(200);
    expect(response.body.factors).toEqual({
      repaymentHistory: "On-time payments increase score by 15 pts each",
      latePaymentPenalty: "Late payments decrease score by 30 pts each",
      range: "500 (Poor) – 850 (Excellent)",
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/score/update
// ---------------------------------------------------------------------------
describe("POST /api/score/update", () => {
  it("should reject requests without API key", async () => {
    const response = await request(app)
      .post("/api/score/update")
      .send({
        userId: TEST_USER,
        repaymentAmount: 100,
        onTime: true,
      });

    expect(response.status).toBe(401);
  });

  it("should reject requests with invalid API key", async () => {
    const response = await request(app)
      .post("/api/score/update")
      .set("x-api-key", "invalid-key")
      .send({
        userId: TEST_USER,
        repaymentAmount: 100,
        onTime: true,
      });

    expect(response.status).toBe(401);
  });

  it("should update score with on-time repayment", async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ current_score: 650 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ current_score: 665 }], rowCount: 1 });

    const response = await request(app)
      .post("/api/score/update")
      .set(apiKeyHeader())
      .send({
        userId: TEST_USER,
        repaymentAmount: 100,
        onTime: true,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.oldScore).toBe(650);
    expect(response.body.newScore).toBe(665);
    expect(response.body.delta).toBe(15);
    expect(response.body.band).toBe("Good");
  });

  it("should update score with late repayment", async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ current_score: 650 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ current_score: 620 }], rowCount: 1 });

    const response = await request(app)
      .post("/api/score/update")
      .set(apiKeyHeader())
      .send({
        userId: TEST_USER,
        repaymentAmount: 100,
        onTime: false,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.oldScore).toBe(650);
    expect(response.body.newScore).toBe(620);
    expect(response.body.delta).toBe(-30);
  });

  it("should clamp score between 300 and 850", async () => {
    // Test upper bound
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ current_score: 845 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ current_score: 850 }], rowCount: 1 });

    const response = await request(app)
      .post("/api/score/update")
      .set(apiKeyHeader())
      .send({
        userId: TEST_USER,
        repaymentAmount: 100,
        onTime: true, // +15 would be 860, but clamped to 850
      });

    expect(response.status).toBe(200);
    expect(response.body.newScore).toBe(850);
  });

  it("should create score if user has no existing score", async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ current_score: 515 }], rowCount: 1 });

    const response = await request(app)
      .post("/api/score/update")
      .set(apiKeyHeader())
      .send({
        userId: TEST_USER,
        repaymentAmount: 100,
        onTime: true,
      });

    expect(response.status).toBe(200);
    expect(response.body.oldScore).toBe(500);
    expect(response.body.newScore).toBe(515);
  });

  it("should invalidate cache after score update", async () => {
    const { cacheService } = await import(
      "../services/cacheService.js"
    );
    const mockCacheDelete = jest.spyOn(cacheService, "delete");

    mockedQuery
      .mockResolvedValueOnce({ rows: [{ current_score: 650 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ current_score: 665 }], rowCount: 1 });

    const response = await request(app)
      .post("/api/score/update")
      .set(apiKeyHeader())
      .send({
        userId: TEST_USER,
        repaymentAmount: 100,
        onTime: true,
      });

    expect(response.status).toBe(200);
    expect(mockCacheDelete).toHaveBeenCalledWith(
      `score:userId:${TEST_USER}`,
    );

    mockCacheDelete.mockRestore();
  });

  it("should reject missing userId", async () => {
    const response = await request(app)
      .post("/api/score/update")
      .set(apiKeyHeader())
      .send({
        repaymentAmount: 100,
        onTime: true,
      });

    expect(response.status).toBe(400);
  });

  it("should reject missing onTime", async () => {
    const response = await request(app)
      .post("/api/score/update")
      .set(apiKeyHeader())
      .send({
        userId: TEST_USER,
        repaymentAmount: 100,
      });

    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/score/:userId/breakdown
// ---------------------------------------------------------------------------
describe("GET /api/score/:userId/breakdown", () => {
  it("should reject unauthenticated requests", async () => {
    const response = await request(app).get(`/api/score/${TEST_USER}/breakdown`);
    expect(response.status).toBe(401);
  });

  it("should reject when userId does not match JWT wallet", async () => {
    const response = await request(app)
      .get(`/api/score/${OTHER_USER}/breakdown`)
      .set(bearer(TEST_USER));

    expect(response.status).toBe(403);
  });

  it("should return score breakdown", async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [
          {
            current_score: 650,
            total_loans: 5,
            repaid_count: 4,
            defaulted_count: 0,
            total_repaid: 2000,
            on_time_count: 4,
            late_count: 0,
            avg_repayment_ledgers: 10000,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { event_type: "LoanRepaid", ledger_closed_at: "2025-01-01T00:00:00Z" },
          { event_type: "LoanRepaid", ledger_closed_at: "2025-01-08T00:00:00Z" },
          { event_type: "LoanRepaid", ledger_closed_at: "2025-01-15T00:00:00Z" },
          { event_type: "LoanRepaid", ledger_closed_at: "2025-01-22T00:00:00Z" },
        ],
      });

    const response = await request(app)
      .get(`/api/score/${TEST_USER}/breakdown`)
      .set(bearer(TEST_USER));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.current_score).toBe(650);
    expect(response.body.total_loans).toBe(5);
    expect(response.body.repaid_count).toBe(4);
    expect(response.body.on_time_count).toBe(4);
  });

  it("should return breakdown with zero loans", async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [
          {
            current_score: 500,
            total_loans: 0,
            repaid_count: 0,
            defaulted_count: 0,
            total_repaid: 0,
            on_time_count: 0,
            late_count: 0,
            avg_repayment_ledgers: 0,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const response = await request(app)
      .get(`/api/score/${TEST_USER}/breakdown`)
      .set(bearer(TEST_USER));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.current_score).toBe(500);
    expect(response.body.total_loans).toBe(0);
  });

  it("should include payment history timeline", async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [
          {
            current_score: 750,
            total_loans: 3,
            repaid_count: 3,
            defaulted_count: 0,
            total_repaid: 3000,
            on_time_count: 3,
            late_count: 0,
            avg_repayment_ledgers: 5000,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { event_type: "LoanRepaid", ledger_closed_at: "2025-01-01T00:00:00Z" },
          { event_type: "LoanRepaid", ledger_closed_at: "2025-02-01T00:00:00Z" },
          { event_type: "LoanRepaid", ledger_closed_at: "2025-03-01T00:00:00Z" },
        ],
      });

    const response = await request(app)
      .get(`/api/score/${TEST_USER}/breakdown`)
      .set(bearer(TEST_USER));

    expect(response.status).toBe(200);
    expect(response.body.payment_history).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Score Controller - Authorization & Ownership
// ---------------------------------------------------------------------------
describe("Score Controller - Authorization & Ownership", () => {
  it("should enforce wallet-param-matches-JWT on getScore", async () => {
    const response = await request(app)
      .get(`/api/score/${OTHER_USER}`)
      .set(bearer(TEST_USER));

    expect(response.status).toBe(403);
  });

  it("should enforce wallet-param-matches-JWT on getScoreBreakdown", async () => {
    const response = await request(app)
      .get(`/api/score/${OTHER_USER}/breakdown`)
      .set(bearer(TEST_USER));

    expect(response.status).toBe(403);
  });

  it("should require API key for score updates", async () => {
    const response = await request(app)
      .post("/api/score/update")
      .set(bearer(TEST_USER))
      .send({
        userId: TEST_USER,
        repaymentAmount: 100,
        onTime: true,
      });

    expect(response.status).toBe(401);
  });

  it("should only allow updateScore via API key, not JWT", async () => {
    const response = await request(app)
      .post("/api/score/update")
      .set(bearer(TEST_USER))
      .send({
        userId: TEST_USER,
        repaymentAmount: 100,
        onTime: true,
      });

    expect(response.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Score Controller - Credit Band Classification
// ---------------------------------------------------------------------------
describe("Score Controller - Credit Band Classification", () => {
  const testCases = [
    { score: 800, band: "Excellent" },
    { score: 750, band: "Excellent" },
    { score: 749, band: "Good" },
    { score: 670, band: "Good" },
    { score: 669, band: "Fair" },
    { score: 580, band: "Fair" },
    { score: 579, band: "Poor" },
    { score: 300, band: "Poor" },
    { score: 500, band: "Poor" },
  ];

  testCases.forEach(({ score, band }) => {
    it(`should return ${band} band for score ${score}`, async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [{ current_score: score }],
        rowCount: 1,
      });

      const response = await request(app)
        .get(`/api/score/${TEST_USER}`)
        .set(bearer(TEST_USER));

      expect(response.status).toBe(200);
      expect(response.body.band).toBe(band);
    });
  });
});
