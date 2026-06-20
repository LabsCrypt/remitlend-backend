import request from "supertest";
import app from "../app.js";

describe("Admin reindex endpoint", () => {
  const apiKey = "test-internal-api-key";

  beforeAll(() => {
    process.env.INTERNAL_API_KEY = apiKey;
  });

  it("rejects requests without API key", async () => {
    const response = await request(app).post(
      "/api/admin/reindex?fromLedger=1&toLedger=2",
    );

    expect(response.status).toBe(401);
  });

  it("validates ledger range query parameters - invalid fromLedger", async () => {
    const response = await request(app)
      .post("/api/admin/reindex?fromLedger=abc&toLedger=2")
      .set("x-api-key", apiKey);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("validates ledger range query parameters - invalid toLedger", async () => {
    const response = await request(app)
      .post("/api/admin/reindex?fromLedger=1&toLedger=xyz")
      .set("x-api-key", apiKey);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("validates ledger range query parameters - negative fromLedger", async () => {
    const response = await request(app)
      .post("/api/admin/reindex?fromLedger=-1&toLedger=2")
      .set("x-api-key", apiKey);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("validates ledger range query parameters - fromLedger > toLedger", async () => {
    const response = await request(app)
      .post("/api/admin/reindex?fromLedger=10&toLedger=5")
      .set("x-api-key", apiKey);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("rejects quarantine list requests without API key", async () => {
    const response = await request(app).get("/api/admin/quarantine-events");

    expect(response.status).toBe(401);
  });

  it("validates reprocess payload ids - non-integer id", async () => {
    const response = await request(app)
      .post("/api/admin/quarantine-events/reprocess")
      .set("x-api-key", apiKey)
      .send({ ids: [1, "bad-id"] });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("validates reprocess payload ids - negative id", async () => {
    const response = await request(app)
      .post("/api/admin/quarantine-events/reprocess")
      .set("x-api-key", apiKey)
      .send({ ids: [1, -5] });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("validates reprocess payload limit - non-integer limit", async () => {
    const response = await request(app)
      .post("/api/admin/quarantine-events/reprocess")
      .set("x-api-key", apiKey)
      .send({ limit: "invalid" });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("validates reprocess payload limit - exceeds maximum", async () => {
    const response = await request(app)
      .post("/api/admin/quarantine-events/reprocess")
      .set("x-api-key", apiKey)
      .send({ limit: 501 });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("rejects check-defaults payloads with more than 1000 loan IDs", async () => {
    const loanIds = Array.from({ length: 1001 }, (_, index) => index + 1);
    const response = await request(app)
      .post("/api/admin/check-defaults")
      .set("x-api-key", apiKey)
      .send({ loanIds });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });
});
