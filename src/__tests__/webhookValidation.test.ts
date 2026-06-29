import request from "supertest";
import app from "../app.js";

describe("Webhook subscription validation", () => {
  const apiKey = "test-internal-api-key";

  beforeAll(() => {
    process.env.INTERNAL_API_KEY = apiKey;
  });

  it("rejects requests without API key", async () => {
    const response = await request(app)
      .post("/api/admin/webhooks")
      .send({
        callbackUrl: "https://example.com/webhook",
        eventTypes: ["LoanApproved"],
      });

    expect(response.status).toBe(401);
  });

  it("validates callbackUrl is required", async () => {
    const response = await request(app)
      .post("/api/admin/webhooks")
      .set("x-api-key", apiKey)
      .send({
        eventTypes: ["LoanApproved"],
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("validates callbackUrl is a valid URL", async () => {
    const response = await request(app)
      .post("/api/admin/webhooks")
      .set("x-api-key", apiKey)
      .send({
        callbackUrl: "not-a-valid-url",
        eventTypes: ["LoanApproved"],
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("validates callbackUrl uses http or https protocol", async () => {
    const response = await request(app)
      .post("/api/admin/webhooks")
      .set("x-api-key", apiKey)
      .send({
        callbackUrl: "ftp://example.com/webhook",
        eventTypes: ["LoanApproved"],
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("validates eventTypes is required", async () => {
    const response = await request(app)
      .post("/api/admin/webhooks")
      .set("x-api-key", apiKey)
      .send({
        callbackUrl: "https://example.com/webhook",
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("validates eventTypes is an array", async () => {
    const response = await request(app)
      .post("/api/admin/webhooks")
      .set("x-api-key", apiKey)
      .send({
        callbackUrl: "https://example.com/webhook",
        eventTypes: "LoanApproved",
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("validates eventTypes has at least one element", async () => {
    const response = await request(app)
      .post("/api/admin/webhooks")
      .set("x-api-key", apiKey)
      .send({
        callbackUrl: "https://example.com/webhook",
        eventTypes: [],
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("validates eventTypes contains only valid event types", async () => {
    const response = await request(app)
      .post("/api/admin/webhooks")
      .set("x-api-key", apiKey)
      .send({
        callbackUrl: "https://example.com/webhook",
        eventTypes: ["InvalidEventType"],
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("accepts valid webhook subscription with secret", async () => {
    const response = await request(app)
      .post("/api/admin/webhooks")
      .set("x-api-key", apiKey)
      .send({
        callbackUrl: "https://example.com/webhook",
        eventTypes: ["LoanApproved"],
        secret: "my-secret-key",
      });

    // Should not fail validation (may fail for other reasons like DB not being set up)
    expect(response.status).not.toBe(400);
  });

  it("accepts valid webhook subscription without secret", async () => {
    const response = await request(app)
      .post("/api/admin/webhooks")
      .set("x-api-key", apiKey)
      .send({
        callbackUrl: "https://example.com/webhook",
        eventTypes: ["LoanApproved", "LoanRepaid"],
      });

    // Should not fail validation (may fail for other reasons like DB not being set up)
    expect(response.status).not.toBe(400);
  });

  it("validates indexer webhook endpoint", async () => {
    const response = await request(app)
      .post("/api/indexer/webhooks")
      .set("x-api-key", apiKey)
      .send({
        callbackUrl: "not-a-url",
        eventTypes: ["LoanApproved"],
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });
});
