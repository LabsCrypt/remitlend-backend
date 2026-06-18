import { query } from "../db/connection.js";
import logger from "../utils/logger.js";
import { WebhookService, type WebhookEventType } from "./webhookService.js";
import { cacheService } from "./cacheService.js";

const BACKOFF = [60, 300, 1800]; // seconds

const LOCK_KEY = "webhook_retry_scheduler:running";
const LOCK_TTL_SECONDS = 120; // 2 minutes

let schedulerInterval: NodeJS.Timeout | null = null;

async function markAsFailed(deliveryId: number) {
  await query(
    `UPDATE webhook_deliveries 
     SET next_retry_at = NULL,
         last_error = $1,
         updated_at = NOW()
     WHERE id = $2`,
    ["Permanently failed after max attempts reached", deliveryId],
  );
  logger.error(`Webhook delivery ${deliveryId} marked as permanently failed.`);
}

function shouldRetry(delivery: any, delay: number): boolean {
  const lastAttempt = new Date(delivery.updated_at).getTime();
  const now = Date.now();
  return now >= lastAttempt + delay * 1000;
}

async function sendWebhookAgain(delivery: any) {
  logger.info(
    `Retrying webhook delivery ${delivery.id} (attempt ${delivery.attempt_count + 1})`,
  );

  await WebhookService.retryWebhookDelivery(
    delivery.id,
    delivery.subscription_id,
    delivery.callback_url,
    delivery.secret || undefined,
    delivery.event_id,
    delivery.event_type as WebhookEventType,
    delivery.payload,
    delivery.attempt_count,
  );
}

export async function retryFailedWebhooks() {
  let lockAcquired = false;
  try {
    const lockValue = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    lockAcquired = await cacheService.setNotExists(
      LOCK_KEY,
      lockValue,
      LOCK_TTL_SECONDS,
    );
  } catch (error) {
    logger.error("Failed to acquire webhook retry scheduler lock", { error });
  }

  if (!lockAcquired) {
    logger.warn(
      "Webhook retry scheduler run skipped - another instance is already running",
    );
    return;
  }

  try {
    const result = await query(`
      SELECT wd.*, ws.max_attempts, ws.callback_url, ws.secret
      FROM webhook_deliveries wd
      JOIN webhook_subscriptions ws ON wd.subscription_id = ws.id
      WHERE wd.delivered_at IS NULL 
        AND (wd.next_retry_at IS NOT NULL OR wd.attempt_count = 0)
    `);

    const failed = result.rows;

    for (const delivery of failed) {
      const delay = BACKOFF[delivery.attempt_count] || 3600;

      if (delivery.attempt_count >= delivery.max_attempts) {
        await markAsFailed(delivery.id);
        continue;
      }

      if (shouldRetry(delivery, delay)) {
        await sendWebhookAgain(delivery);
      }
    }
  } catch (error) {
    logger.error("Error in webhook retry scheduler", { error });
  } finally {
    try {
      await cacheService.delete(LOCK_KEY);
    } catch (error) {
      logger.error("Failed to release webhook retry scheduler lock", { error });
    }
  }
}

export function startWebhookRetryScheduler() {
  if (schedulerInterval) {
    logger.warn("Webhook retry scheduler already running");
    return;
  }

  logger.info("Starting webhook retry scheduler (60s interval)");
  schedulerInterval = setInterval(retryFailedWebhooks, 60000);
}

export function stopWebhookRetryScheduler() {
  if (schedulerInterval) {
    logger.info("Stopping webhook retry scheduler");
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
