import request from "supertest";
import { jest } from "@jest/globals";
import { Keypair } from "@stellar/stellar-sdk";

process.env.JWT_SECRET = "test-jwt-secret-min-32-chars-long!!";
// These tests exercise auth flows repeatedly from a single IP, which would
// otherwise trip the login rate limiter. Disable it for this suite only.
process.env.DISABLE_RATE_LIMIT = "true";

jest.unstable_mockModule("../db/connection.js", () => ({
  default: { query: jest.fn() },
  query: jest.fn(),
  getClient: jest.fn<() => Promise<unknown>>(),
  withTransaction: jest.fn<
    (fn: (client: unknown) => Promise<unknown>) => Promise<unknown>
  >((fn) => fn({ query: jest.fn(), release: jest.fn() })),
  pool: { query: jest.fn() },
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

await import("../db/connection.js");
const { default: app } = await import("../app.js");

beforeEach(() => {
  jest.clearAllMocks();
});

afterAll(() => {
  delete process.env.JWT_SECRET;
  delete process.env.DISABLE_RATE_LIMIT;
});

// ---------------------------------------------------------------------------
// POST /api/auth/challenge
// ---------------------------------------------------------------------------
describe("POST /api/auth/challenge", () => {
  const testKeypair = Keypair.random();

  it("should generate challenge for valid public key", async () => {
    const response = await request(app).post("/api/auth/challenge").send({
      publicKey: testKeypair.publicKey(),
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toBeDefined();
    expect(response.body.data.message).toBeDefined();
    expect(response.body.data.nonce).toBeDefined();
    expect(response.body.data.timestamp).toBeDefined();
    expect(response.body.data.expiresIn).toBeDefined();
  });

  it("should include challenge message with nonce and timestamp", async () => {
    const response = await request(app).post("/api/auth/challenge").send({
      publicKey: testKeypair.publicKey(),
    });

    expect(response.status).toBe(200);
    const { message, nonce, timestamp } = response.body.data;
    expect(message).toContain("Nonce:");
    expect(message).toContain("Timestamp:");
    expect(message).toContain(nonce);
    expect(message).toContain(String(timestamp));
  });

  it("should reject missing publicKey", async () => {
    const response = await request(app).post("/api/auth/challenge").send({});

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("should reject invalid public key format", async () => {
    const response = await request(app).post("/api/auth/challenge").send({
      publicKey: "invalid_public_key",
    });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("should reject non-string publicKey", async () => {
    const response = await request(app).post("/api/auth/challenge").send({
      publicKey: 12345,
    });

    expect(response.status).toBe(400);
  });

  it("should reject empty publicKey", async () => {
    const response = await request(app).post("/api/auth/challenge").send({
      publicKey: "",
    });

    expect(response.status).toBe(400);
  });

  it("should return different nonces for multiple requests", async () => {
    const response1 = await request(app).post("/api/auth/challenge").send({
      publicKey: testKeypair.publicKey(),
    });

    const response2 = await request(app).post("/api/auth/challenge").send({
      publicKey: testKeypair.publicKey(),
    });

    expect(response1.body.data.nonce).not.toBe(response2.body.data.nonce);
  });

  it("should return expiration in milliseconds", async () => {
    const response = await request(app).post("/api/auth/challenge").send({
      publicKey: testKeypair.publicKey(),
    });

    expect(response.status).toBe(200);
    expect(response.body.data.expiresIn).toBe(5 * 60 * 1000); // 5 minutes
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------
describe("POST /api/auth/login", () => {
  const testKeypair = Keypair.random();

  it("should reject missing publicKey", async () => {
    const response = await request(app).post("/api/auth/login").send({
      message: "test message",
      signature: "test signature",
    });

    expect(response.status).toBe(400);
  });

  it("should reject missing message", async () => {
    const response = await request(app).post("/api/auth/login").send({
      publicKey: testKeypair.publicKey(),
      signature: "test signature",
    });

    expect(response.status).toBe(400);
  });

  it("should reject missing signature", async () => {
    const response = await request(app).post("/api/auth/login").send({
      publicKey: testKeypair.publicKey(),
      message: "test message",
    });

    expect(response.status).toBe(400);
  });

  it("should reject invalid challenge message format", async () => {
    const response = await request(app).post("/api/auth/login").send({
      publicKey: testKeypair.publicKey(),
      message: "Invalid message without timestamp",
      signature: "dGVzdA==",
    });

    expect(response.status).toBe(400);
  });

  it("should reject expired challenge", async () => {
    const currentTime = Date.now();
    const expiredTimestamp = currentTime - 10 * 60 * 1000; // 10 minutes ago
    const message = `Sign this message\n\nTimestamp: ${expiredTimestamp}`;

    const response = await request(app).post("/api/auth/login").send({
      publicKey: testKeypair.publicKey(),
      message,
      signature: "dGVzdA==",
    });

    expect(response.status).toBe(401);
  });

  it("should reject invalid signature", async () => {
    const currentTime = Date.now();
    const message = `Sign this message\n\nNonce: test\nTimestamp: ${currentTime}`;
    const invalidSignature = Buffer.alloc(64).toString("base64"); // Invalid signature

    const response = await request(app).post("/api/auth/login").send({
      publicKey: testKeypair.publicKey(),
      message,
      signature: invalidSignature,
    });

    expect(response.status).toBe(401);
  });

  it("should reject signature with wrong length", async () => {
    const currentTime = Date.now();
    const message = `Sign this message\n\nNonce: test\nTimestamp: ${currentTime}`;
    const wrongLengthSignature = Buffer.alloc(32).toString("base64"); // 32 bytes instead of 64

    const response = await request(app).post("/api/auth/login").send({
      publicKey: testKeypair.publicKey(),
      message,
      signature: wrongLengthSignature,
    });

    expect(response.status).toBe(401);
  });

  it("should successfully login with valid signature", async () => {
    const currentTime = Date.now();
    const message = `Sign this message\n\nNonce: test\nTimestamp: ${currentTime}`;
    const messageBytes = Buffer.from(message, "utf-8");
    const signature = testKeypair.sign(messageBytes);
    const signatureBase64 = signature.toString("base64");

    const response = await request(app).post("/api/auth/login").send({
      publicKey: testKeypair.publicKey(),
      message,
      signature: signatureBase64,
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.token).toBeDefined();
    expect(response.headers["set-cookie"]).toBeDefined();
  });

  it("should return JWT token on successful login", async () => {
    const currentTime = Date.now();
    const message = `Sign this message\n\nNonce: test\nTimestamp: ${currentTime}`;
    const messageBytes = Buffer.from(message, "utf-8");
    const signature = testKeypair.sign(messageBytes);
    const signatureBase64 = signature.toString("base64");

    const response = await request(app).post("/api/auth/login").send({
      publicKey: testKeypair.publicKey(),
      message,
      signature: signatureBase64,
    });

    expect(response.status).toBe(200);
    expect(response.body.data.token).toBeDefined();
    // Token should be a valid JWT (three parts separated by dots)
    expect(response.body.data.token.split(".").length).toBe(3);
  });

  it("should set secure cookie with JWT", async () => {
    const currentTime = Date.now();
    const message = `Sign this message\n\nNonce: test\nTimestamp: ${currentTime}`;
    const messageBytes = Buffer.from(message, "utf-8");
    const signature = testKeypair.sign(messageBytes);
    const signatureBase64 = signature.toString("base64");

    const response = await request(app).post("/api/auth/login").send({
      publicKey: testKeypair.publicKey(),
      message,
      signature: signatureBase64,
    });

    expect(response.status).toBe(200);
    expect(response.headers["set-cookie"]).toBeDefined();
    const setCookie = (
      response.headers["set-cookie"] as unknown as string[]
    )[0];
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Max-Age");
  });

  it("should reject signature signed by different keypair", async () => {
    const differentKeypair = Keypair.random();
    const currentTime = Date.now();
    const message = `Sign this message\n\nNonce: test\nTimestamp: ${currentTime}`;
    const messageBytes = Buffer.from(message, "utf-8");
    const wrongSignature = differentKeypair.sign(messageBytes);
    const wrongSignatureBase64 = wrongSignature.toString("base64");

    const response = await request(app).post("/api/auth/login").send({
      publicKey: testKeypair.publicKey(),
      message,
      signature: wrongSignatureBase64,
    });

    expect(response.status).toBe(401);
  });

  it("should reject signature with altered message", async () => {
    const currentTime = Date.now();
    const message = `Sign this message\n\nNonce: test\nTimestamp: ${currentTime}`;
    const messageBytes = Buffer.from(message, "utf-8");
    const signature = testKeypair.sign(messageBytes);
    const signatureBase64 = signature.toString("base64");

    const alteredMessage = `ALTERED ${message}`;

    const response = await request(app).post("/api/auth/login").send({
      publicKey: testKeypair.publicKey(),
      message: alteredMessage,
      signature: signatureBase64,
    });

    expect(response.status).toBe(401);
  });

  it("should reject invalid public key format", async () => {
    const message = `Sign this message\n\nTimestamp: ${Date.now()}`;

    const response = await request(app).post("/api/auth/login").send({
      publicKey: "not_a_valid_public_key",
      message,
      signature: "dGVzdA==",
    });

    expect(response.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Auth Controller - Authorization Tests
// ---------------------------------------------------------------------------
describe("Auth Controller - Authorization", () => {
  it("should allow challenge request without authentication", async () => {
    const testKeypair = Keypair.random();

    const response = await request(app).post("/api/auth/challenge").send({
      publicKey: testKeypair.publicKey(),
    });

    expect(response.status).toBe(200);
  });

  it("should allow login without authentication", async () => {
    const testKeypair = Keypair.random();
    const currentTime = Date.now();
    const message = `Sign this message\n\nNonce: test\nTimestamp: ${currentTime}`;
    const messageBytes = Buffer.from(message, "utf-8");
    const signature = testKeypair.sign(messageBytes);
    const signatureBase64 = signature.toString("base64");

    const response = await request(app).post("/api/auth/login").send({
      publicKey: testKeypair.publicKey(),
      message,
      signature: signatureBase64,
    });

    expect(response.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Auth Controller - Happy Path Scenarios
// ---------------------------------------------------------------------------
describe("Auth Controller - Happy Path Scenarios", () => {
  it("should complete full auth flow: challenge -> login", async () => {
    const testKeypair = Keypair.random();

    // Request challenge
    const challengeResponse = await request(app)
      .post("/api/auth/challenge")
      .send({
        publicKey: testKeypair.publicKey(),
      });

    expect(challengeResponse.status).toBe(200);
    const { message, nonce, timestamp } = challengeResponse.body.data;

    // Sign challenge and login
    const messageBytes = Buffer.from(message, "utf-8");
    const signature = testKeypair.sign(messageBytes);
    const signatureBase64 = signature.toString("base64");

    const loginResponse = await request(app).post("/api/auth/login").send({
      publicKey: testKeypair.publicKey(),
      message,
      signature: signatureBase64,
    });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.data.token).toBeDefined();
  });

  it("should reject login with stale message", async () => {
    const testKeypair = Keypair.random();

    // Request challenge
    const challengeResponse = await request(app)
      .post("/api/auth/challenge")
      .send({
        publicKey: testKeypair.publicKey(),
      });

    expect(challengeResponse.status).toBe(200);

    // Create old message
    const oldTimestamp = Date.now() - 10 * 60 * 1000; // 10 minutes ago
    const oldMessage = `Sign this message\n\nNonce: old\nTimestamp: ${oldTimestamp}`;
    const messageBytes = Buffer.from(oldMessage, "utf-8");
    const signature = testKeypair.sign(messageBytes);
    const signatureBase64 = signature.toString("base64");

    // Try to login with old message
    const loginResponse = await request(app).post("/api/auth/login").send({
      publicKey: testKeypair.publicKey(),
      message: oldMessage,
      signature: signatureBase64,
    });

    expect(loginResponse.status).toBe(401);
  });

  it("should handle multiple independent auth flows", async () => {
    const keypair1 = Keypair.random();
    const keypair2 = Keypair.random();

    // First user challenge
    const challenge1 = await request(app)
      .post("/api/auth/challenge")
      .send({ publicKey: keypair1.publicKey() });

    // Second user challenge
    const challenge2 = await request(app)
      .post("/api/auth/challenge")
      .send({ publicKey: keypair2.publicKey() });

    expect(challenge1.status).toBe(200);
    expect(challenge2.status).toBe(200);

    // First user login
    const message1 = challenge1.body.data.message;
    const sig1 = keypair1
      .sign(Buffer.from(message1, "utf-8"))
      .toString("base64");
    const login1 = await request(app).post("/api/auth/login").send({
      publicKey: keypair1.publicKey(),
      message: message1,
      signature: sig1,
    });

    // Second user login
    const message2 = challenge2.body.data.message;
    const sig2 = keypair2
      .sign(Buffer.from(message2, "utf-8"))
      .toString("base64");
    const login2 = await request(app).post("/api/auth/login").send({
      publicKey: keypair2.publicKey(),
      message: message2,
      signature: sig2,
    });

    expect(login1.status).toBe(200);
    expect(login2.status).toBe(200);
    expect(login1.body.data.token).not.toBe(login2.body.data.token);
  });
});
