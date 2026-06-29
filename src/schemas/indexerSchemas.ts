import { z } from "zod";
import { SUPPORTED_WEBHOOK_EVENT_TYPES } from "../services/webhookService.js";

// Webhook creation schema
export const createWebhookSubscriptionSchema = z.object({
  callbackUrl: z
    .string()
    .url("callbackUrl must be a valid URL")
    .refine(
      (url) => {
        try {
          const protocol = new URL(url).protocol;
          return protocol === "http:" || protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: "callbackUrl must use http or https" },
    ),
  eventTypes: z
    .array(
      z.enum(
        SUPPORTED_WEBHOOK_EVENT_TYPES as unknown as readonly [
          string,
          ...string[],
        ],
      ),
    )
    .min(
      1,
      `eventTypes must include at least one of: ${SUPPORTED_WEBHOOK_EVENT_TYPES.join(
        ", ",
      )}`,
    ),
  secret: z.string().optional(),
});

// Reindex query params schema
const reindexMaxRange = Number(process.env.REINDEX_MAX_RANGE ?? 25000);

export const reindexLedgerRangeQuerySchema = z
  .object({
    fromLedger: z.coerce
      .number()
      .int("fromLedger must be an integer")
      .positive("fromLedger must be positive"),
    toLedger: z.coerce
      .number()
      .int("toLedger must be an integer")
      .positive("toLedger must be positive"),
  })
  .refine((data) => data.fromLedger <= data.toLedger, {
    message: "fromLedger must be less than or equal to toLedger",
  })
  .refine((data) => data.toLedger - data.fromLedger + 1 <= reindexMaxRange, {
    message: `Requested range exceeds maximum of ${reindexMaxRange} ledgers`,
  });

// Quarantine reprocess body schema
export const reprocessQuarantinedEventsSchema = z.object({
  ids: z
    .array(z.number().int().positive("ids must be positive integers"))
    .optional(),
  limit: z
    .number()
    .int("limit must be an integer")
    .positive("limit must be positive")
    .max(500, "limit must not exceed 500")
    .optional(),
});
