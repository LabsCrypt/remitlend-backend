import request from "supertest";
import { jest } from "@jest/globals";
import { Keypair } from "@stellar/stellar-sdk";
import { generateJwtToken } from "../services/authService.js";

type MockQueryResult = { rows: unknown[]; rowCount?: number };

const TEST_SENDER = Keypair.random().publicKey();
const TEST_RECIPIENT = Keypair.random().publicKey();
const TEST_OTHER_USER = Keypair.random().publicKey();

process.env.JWT_SECRET = "test-jwt-secret-min-32-chars-long!!";

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

const mockSubmitSignedTx =
  jest.fn<
    (
      signedTxXdr: string,
    ) => Promise<{ txHash: string; status: string; resultXdr?: string }>
  >();

jest.unstable_mockModule("../services/sorobanService.js", () => ({
  sorobanService: {
    submitSignedTx: mockSubmitSignedTx,
    ping: jest.fn().mockResolvedValue("ok"),
  },
}));

jest.unstable_mockModule("../services/notificationService.js", () => ({
  notificationService: {
    createNotification: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockRemittanceService = {
  createRemittance: jest.fn(),
  getRemittances: jest.fn(),
  getRemittance: jest.fn(),
  updateRemittanceStatus: jest.fn(),
};

jest.unstable_mockModule("../services/remittanceService.js", () => ({
  remittanceService: mockRemittanceService,
}));

await import("../db/connection.js");
await import("../services/sorobanService.js");
await import("../services/remittanceService.js");
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
// POST /api/remittances - Create remittance
// ---------------------------------------------------------------------------
describe("POST /api/remittances", () => {
  const remittanceData = {
    recipientAddress: TEST_RECIPIENT,
    amount: 100,
    fromCurrency: "USDC",
    toCurrency: "USDC",
    memo: "test transfer",
  };

  it("should reject unauthenticated requests", async () => {
    const response = await request(app)
      .post("/api/remittances")
      .send(remittanceData);
    expect(response.status).toBe(401);
  });

  it("should create a remittance for authenticated user", async () => {
    const createdRemittance = {
      id: "remit-1",
      senderId: TEST_SENDER,
      recipientAddress: TEST_RECIPIENT,
      amount: 100,
      fromCurrency: "USDC",
      toCurrency: "USDC",
      memo: "test transfer",
      status: "pending",
      xdr: "AAAA...",
    };

    mockRemittanceService.createRemittance.mockResolvedValueOnce(
      createdRemittance,
    );

    const response = await request(app)
      .post("/api/remittances")
      .set(bearer(TEST_SENDER))
      .send(remittanceData);

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual(createdRemittance);
    expect(mockRemittanceService.createRemittance).toHaveBeenCalledWith(
      expect.objectContaining({
        senderAddress: TEST_SENDER,
        recipientAddress: TEST_RECIPIENT,
        amount: 100,
      }),
    );
  });

  it("should reject missing recipientAddress", async () => {
    const invalidData = { ...remittanceData };
    delete (invalidData as any).recipientAddress;

    const response = await request(app)
      .post("/api/remittances")
      .set(bearer(TEST_SENDER))
      .send(invalidData);

    expect(response.status).toBe(400);
  });

  it("should reject missing amount", async () => {
    const invalidData = { ...remittanceData };
    delete (invalidData as any).amount;

    const response = await request(app)
      .post("/api/remittances")
      .set(bearer(TEST_SENDER))
      .send(invalidData);

    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/remittances - List user's remittances
// ---------------------------------------------------------------------------
describe("GET /api/remittances", () => {
  it("should reject unauthenticated requests", async () => {
    const response = await request(app).get("/api/remittances");
    expect(response.status).toBe(401);
  });

  it("should return empty list for user with no remittances", async () => {
    mockRemittanceService.getRemittances.mockResolvedValueOnce({
      remittances: [],
      nextCursor: null,
      total: 0,
    });

    const response = await request(app)
      .get("/api/remittances")
      .set(bearer(TEST_SENDER));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual([]);
    expect(response.body.page_info.total).toBe(0);
  });

  it("should return user's remittances", async () => {
    const remittances = [
      {
        id: "remit-1",
        senderId: TEST_SENDER,
        recipientAddress: TEST_RECIPIENT,
        amount: 100,
        status: "completed",
      },
      {
        id: "remit-2",
        senderId: TEST_SENDER,
        recipientAddress: TEST_RECIPIENT,
        amount: 50,
        status: "pending",
      },
    ];

    mockRemittanceService.getRemittances.mockResolvedValueOnce({
      remittances,
      nextCursor: null,
      total: 2,
    });

    const response = await request(app)
      .get("/api/remittances")
      .set(bearer(TEST_SENDER));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.length).toBe(2);
    expect(response.body.page_info.total).toBe(2);
  });

  it("should filter by status", async () => {
    const completedRemittances = [
      {
        id: "remit-1",
        senderId: TEST_SENDER,
        status: "completed",
      },
    ];

    mockRemittanceService.getRemittances.mockResolvedValueOnce({
      remittances: completedRemittances,
      nextCursor: null,
      total: 1,
    });

    const response = await request(app)
      .get("/api/remittances?status=completed")
      .set(bearer(TEST_SENDER));

    expect(response.status).toBe(200);
    expect(mockRemittanceService.getRemittances).toHaveBeenCalledWith(
      TEST_SENDER,
      expect.anything(),
      expect.anything(),
      "completed",
    );
  });
});

// ---------------------------------------------------------------------------
// GET /api/remittances/:id - Get single remittance
// ---------------------------------------------------------------------------
describe("GET /api/remittances/:id", () => {
  it("should reject unauthenticated requests", async () => {
    const response = await request(app).get("/api/remittances/remit-1");
    expect(response.status).toBe(401);
  });

  it("should return remittance owned by authenticated user", async () => {
    const remittance = {
      id: "remit-1",
      senderId: TEST_SENDER,
      recipientAddress: TEST_RECIPIENT,
      amount: 100,
      status: "pending",
    };

    mockRemittanceService.getRemittance.mockResolvedValueOnce(remittance);

    const response = await request(app)
      .get("/api/remittances/remit-1")
      .set(bearer(TEST_SENDER));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual(remittance);
  });

  it("should reject access to remittance owned by another user", async () => {
    const remittance = {
      id: "remit-1",
      senderId: TEST_OTHER_USER, // Different sender
      recipientAddress: TEST_RECIPIENT,
      amount: 100,
      status: "pending",
    };

    mockRemittanceService.getRemittance.mockResolvedValueOnce(remittance);

    const response = await request(app)
      .get("/api/remittances/remit-1")
      .set(bearer(TEST_SENDER));

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
  });

  it("should handle remittance not found", async () => {
    mockRemittanceService.getRemittance.mockRejectedValueOnce(
      new Error("Remittance not found"),
    );

    const response = await request(app)
      .get("/api/remittances/nonexistent-id")
      .set(bearer(TEST_SENDER));

    expect(response.status).toBe(500); // Error from service
  });
});

// ---------------------------------------------------------------------------
// POST /api/remittances/:id/submit - Submit remittance
// ---------------------------------------------------------------------------
describe("POST /api/remittances/:id/submit", () => {
  const submitData = {
    signedXdr: "base64_encoded_signed_xdr",
  };

  it("should reject unauthenticated requests", async () => {
    const response = await request(app)
      .post("/api/remittances/remit-1/submit")
      .send(submitData);
    expect(response.status).toBe(401);
  });

  it("should reject submission for remittance owned by another user", async () => {
    const remittance = {
      id: "remit-1",
      senderId: TEST_OTHER_USER, // Different sender
      amount: 100,
      status: "pending",
    };

    mockRemittanceService.getRemittance.mockResolvedValueOnce(remittance);

    const response = await request(app)
      .post("/api/remittances/remit-1/submit")
      .set(bearer(TEST_SENDER))
      .send(submitData);

    expect(response.status).toBe(403);
  });

  it("should reject submission for non-pending remittance", async () => {
    const remittance = {
      id: "remit-1",
      senderId: TEST_SENDER,
      amount: 100,
      status: "completed", // Already completed
    };

    mockRemittanceService.getRemittance.mockResolvedValueOnce(remittance);

    const response = await request(app)
      .post("/api/remittances/remit-1/submit")
      .set(bearer(TEST_SENDER))
      .send(submitData);

    expect(response.status).toBe(400);
  });

  it("should submit remittance transaction successfully", async () => {
    const remittance = {
      id: "remit-1",
      senderId: TEST_SENDER,
      amount: 100,
      fromCurrency: "USDC",
      status: "pending",
    };

    const completedRemittance = {
      ...remittance,
      status: "completed",
      txHash: "abc123hash",
    };

    mockRemittanceService.getRemittance.mockResolvedValueOnce(remittance);
    mockRemittanceService.updateRemittanceStatus
      .mockResolvedValueOnce({ ...remittance, status: "processing" })
      .mockResolvedValueOnce(completedRemittance);
    mockSubmitSignedTx.mockResolvedValueOnce({
      txHash: "abc123hash",
      status: "SUCCESS",
    });

    const response = await request(app)
      .post("/api/remittances/remit-1/submit")
      .set(bearer(TEST_SENDER))
      .send(submitData);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.txHash).toBe("abc123hash");
    expect(response.body.data.status).toBe("completed");

    // Verify status transitions
    expect(mockRemittanceService.updateRemittanceStatus).toHaveBeenCalledWith(
      "remit-1",
      "processing",
    );
    expect(mockRemittanceService.updateRemittanceStatus).toHaveBeenCalledWith(
      "remit-1",
      "completed",
      "abc123hash",
    );
  });

  it("should mark remittance as failed if Stellar submission fails", async () => {
    const remittance = {
      id: "remit-1",
      senderId: TEST_SENDER,
      amount: 100,
      status: "pending",
    };

    mockRemittanceService.getRemittance.mockResolvedValueOnce(remittance);
    mockRemittanceService.updateRemittanceStatus.mockResolvedValueOnce({
      ...remittance,
      status: "processing",
    });
    mockSubmitSignedTx.mockRejectedValueOnce(
      new Error("Stellar submission failed"),
    );

    const response = await request(app)
      .post("/api/remittances/remit-1/submit")
      .set(bearer(TEST_SENDER))
      .send(submitData);

    expect(response.status).toBe(500);
    // Verify failed status was set
    expect(mockRemittanceService.updateRemittanceStatus).toHaveBeenCalledWith(
      "remit-1",
      "failed",
      undefined,
      expect.any(String),
    );
  });

  it("should reject missing signedXdr", async () => {
    const response = await request(app)
      .post("/api/remittances/remit-1/submit")
      .set(bearer(TEST_SENDER))
      .send({});

    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Authorization & Ownership Tests
// ---------------------------------------------------------------------------
describe("Remittance Controller - Authorization & Ownership", () => {
  it("should enforce wallet ownership on create", async () => {
    // Service will verify sender, but controller extracts from JWT
    mockRemittanceService.createRemittance.mockResolvedValueOnce({
      id: "remit-1",
      senderId: TEST_SENDER,
    });

    const response = await request(app)
      .post("/api/remittances")
      .set(bearer(TEST_SENDER))
      .send({
        recipientAddress: TEST_RECIPIENT,
        amount: 100,
        fromCurrency: "USDC",
        toCurrency: "USDC",
      });

    expect(response.status).toBe(201);
    expect(mockRemittanceService.createRemittance).toHaveBeenCalledWith(
      expect.objectContaining({
        senderAddress: TEST_SENDER,
      }),
    );
  });

  it("should enforce wallet ownership on get", async () => {
    const remittance = {
      id: "remit-1",
      senderId: TEST_OTHER_USER,
      amount: 100,
    };

    mockRemittanceService.getRemittance.mockResolvedValueOnce(remittance);

    const response = await request(app)
      .get("/api/remittances/remit-1")
      .set(bearer(TEST_SENDER));

    expect(response.status).toBe(403);
  });

  it("should enforce wallet ownership on submit", async () => {
    const remittance = {
      id: "remit-1",
      senderId: TEST_OTHER_USER,
      status: "pending",
    };

    mockRemittanceService.getRemittance.mockResolvedValueOnce(remittance);

    const response = await request(app)
      .post("/api/remittances/remit-1/submit")
      .set(bearer(TEST_SENDER))
      .send({ signedXdr: "test" });

    expect(response.status).toBe(403);
  });
});
