import type { Request, Response, NextFunction } from "express";
import { cacheService } from "../services/cacheService.js";
import logger from "../utils/logger.js";

const IDEMPOTENCY_TTL = 24 * 60 * 60; // 24 hours in seconds

interface CachedResponse {
  status: number;
  body: unknown;
  inProgress?: boolean;
}

/**
 * Middleware to handle Idempotency-Key headers.
 *
 * Reserves the key with an atomic SET NX *before* the downstream handler
 * runs, so two concurrent requests sharing the same key can't both miss the
 * cache check and submit the same money-moving transaction twice. The race
 * window in the original implementation — which only wrote the cache on the
 * `res.on("finish")` callback — is closed by writing an `inProgress`
 * placeholder up front and overwriting it with the real response when the
 * handler completes.
 *
 * Behaviour:
 *   * No `Idempotency-Key` header → forward.
 *   * Key reserved successfully → handler runs, the response body is cached
 *     on finish with `X-Idempotency-Cache: STORED`.
 *   * Key already cached as a finished response → return the cached body
 *     with `X-Idempotency-Cache: HIT`.
 *   * Key already reserved but the first request is still in flight → 409
 *     with `X-Idempotency-Cache: IN_PROGRESS`.
 */
export const idempotencyMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const key = req.header("Idempotency-Key");

  if (!key) {
    return next();
  }

  const cacheKey = `idemp:${key}`;

  try {
    // ── Race-free key reservation ──────────────────────────────────────────
    // Try to claim the key first. If we lose the race, fall back to reading
    // whatever the first request stored (which is guaranteed to exist because
    // the winner has written at least the in-progress placeholder).
    const reserved = await cacheService.setNotExists(
      cacheKey,
      { status: 0, body: null, inProgress: true } satisfies CachedResponse,
      IDEMPOTENCY_TTL,
    );

    if (!reserved) {
      const cached = await cacheService.get<CachedResponse>(cacheKey);

      // The setNX call failed but the read came back empty — almost certainly
      // a transient cache miss between the failed reserve and the read.
      // Treat it as "in progress" so the client retries rather than letting
      // the handler run uncoordinated.
      if (!cached) {
        logger.warn(
          `Idempotency reservation lost the race but no cached value found; treating as in-progress`,
          { key, url: req.originalUrl, method: req.method },
        );
        res
          .status(409)
          .set("X-Idempotency-Cache", "IN_PROGRESS")
          .json({
            error: "request_in_progress",
            message:
              "Another request with this Idempotency-Key is still being processed.",
          });
        return;
      }

      if (cached.inProgress) {
        logger.info(`Idempotency in-progress for key: ${key}`, {
          url: req.originalUrl,
          method: req.method,
        });
        res
          .status(409)
          .set("X-Idempotency-Cache", "IN_PROGRESS")
          .json({
            error: "request_in_progress",
            message:
              "Another request with this Idempotency-Key is still being processed.",
          });
        return;
      }

      logger.info(`Idempotency hit for key: ${key}`, {
        url: req.originalUrl,
        method: req.method,
      });
      res
        .status(cached.status)
        .set("X-Idempotency-Cache", "HIT")
        .json(cached.body);
      return;
    }

    // ── Intercept response body to overwrite the placeholder on finish ────
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    let responseBody: unknown;
    let bodyCaptured = false;

    res.json = function (body: unknown) {
      responseBody = body;
      bodyCaptured = true;
      return originalJson(body);
    };

    res.send = function (body: unknown) {
      if (!bodyCaptured) {
        if (typeof body === "string") {
          try {
            responseBody = JSON.parse(body);
          } catch {
            responseBody = body;
          }
        } else {
          responseBody = body;
        }
        bodyCaptured = true;
      }
      return originalSend(body);
    };

    res.on("finish", async () => {
      try {
        // Only cache 2xx and 4xx so retries on 5xx are not poisoned with a
        // stale failure. On 5xx, drop the in-progress placeholder so future
        // requests with the same key can try again.
        if (res.statusCode >= 500) {
          await cacheService.delete(cacheKey);
          return;
        }
        await cacheService.set(
          cacheKey,
          {
            status: res.statusCode,
            body: responseBody ?? null,
          } satisfies CachedResponse,
          IDEMPOTENCY_TTL,
        );
      } catch (error) {
        logger.error(`Error caching idempotency key ${key}`, { error });
      }
    });

    next();
  } catch (error) {
    logger.error("Error in idempotency middleware", { error, key });
    next();
  }
};
