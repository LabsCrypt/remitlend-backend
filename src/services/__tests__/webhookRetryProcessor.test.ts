import { jest, describe, it, expect } from "@jest/globals";
import {
  WEBHOOK_RETRY_CONFIG,
  getRetryDelayMs,
} from "../webhookService.js";

describe("Webhook Retry Processor", () => {
  it("respects the configured backoff delays", () => {
    expect(WEBHOOK_RETRY_CONFIG.RETRY_DELAYS_MS).toEqual([
      5 * 60 * 1000,
      15 * 60 * 1000,
      45 * 60 * 1000,
    ]);

    expect(getRetryDelayMs(1)).toBe(WEBHOOK_RETRY_CONFIG.RETRY_DELAYS_MS[0]);
    expect(getRetryDelayMs(2)).toBe(WEBHOOK_RETRY_CONFIG.RETRY_DELAYS_MS[1]);
    expect(getRetryDelayMs(3)).toBe(WEBHOOK_RETRY_CONFIG.RETRY_DELAYS_MS[2]);
  });

  it("caps the backoff delay at the last configured value", () => {
    const maxDelay = WEBHOOK_RETRY_CONFIG.RETRY_DELAYS_MS[WEBHOOK_RETRY_CONFIG.RETRY_DELAYS_MS.length - 1];
    expect(getRetryDelayMs(WEBHOOK_RETRY_CONFIG.MAX_RETRY_ATTEMPTS)).toBe(maxDelay);
    expect(getRetryDelayMs(WEBHOOK_RETRY_CONFIG.MAX_RETRY_ATTEMPTS + 5)).toBe(maxDelay);
  });

  it("configures exactly 4 max attempts", () => {
    expect(WEBHOOK_RETRY_CONFIG.MAX_RETRY_ATTEMPTS).toBe(4);
  });
});
