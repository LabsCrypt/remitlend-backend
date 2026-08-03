import { Request, Response, NextFunction } from "express";
import { idempotencyMiddleware } from "../middleware/idempotency.js";
import { cacheService } from "../services/cacheService.js";
import { jest } from "@jest/globals";

// Helper to cast to jest.Mock
const asMock = (fn: any) => fn as jest.Mock;

function makeReq(key?: string): Partial<Request> {
  const headerMock = jest.fn() as any;
  if (key !== undefined) headerMock.mockReturnValue(key);
  else headerMock.mockReturnValue(undefined);
  return {
    header: headerMock,
    method: "POST",
    originalUrl: "/api/test",
  };
}

function makeRes() {
  return {
    status: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    setHeader: jest.fn(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    on: jest.fn(),
    statusCode: 200,
  } as any;
}

describe("Idempotency Middleware", () => {
  let next: NextFunction;

  beforeEach(() => {
    next = jest.fn();
    jest.spyOn(cacheService, "get").mockReset();
    jest.spyOn(cacheService, "set").mockReset();
    jest.spyOn(cacheService, "setNotExists").mockReset();
    jest.spyOn(cacheService, "delete").mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("calls next() if no Idempotency-Key is present", async () => {
    const req = makeReq();
    const res = makeRes();
    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(cacheService.setNotExists).not.toHaveBeenCalled();
  });

  it("returns the cached response when the key was previously stored", async () => {
    const key = "test-key";
    const cached = { status: 201, body: { success: true } };

    (
      cacheService.setNotExists as jest.Mock<() => Promise<boolean>>
    ).mockResolvedValue(false);
    (cacheService.get as jest.Mock<() => Promise<any>>).mockResolvedValue(cached);

    const req = makeReq(key);
    const res = makeRes();
    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(cacheService.setNotExists).toHaveBeenCalledWith(
      `idemp:${key}`,
      expect.any(Object),
      expect.any(Number),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.set).toHaveBeenCalledWith("X-Idempotency-Cache", "HIT");
    expect(res.json).toHaveBeenCalledWith(cached.body);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 409 IN_PROGRESS when another request is still processing", async () => {
    const key = "in-flight";

    (
      cacheService.setNotExists as jest.Mock<() => Promise<boolean>>
    ).mockResolvedValue(false);
    (cacheService.get as jest.Mock<() => Promise<any>>).mockResolvedValue({
      status: 0,
      body: null,
      inProgress: true,
    });

    const req = makeReq(key);
    const res = makeRes();
    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.set).toHaveBeenCalledWith("X-Idempotency-Cache", "IN_PROGRESS");
    expect(next).not.toHaveBeenCalled();
  });

  it("reserves the key and forwards to next() on the happy path", async () => {
    const key = "new-key";
    (
      cacheService.setNotExists as jest.Mock<() => Promise<boolean>>
    ).mockResolvedValue(true);

    const req = makeReq(key);
    const res = makeRes();
    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(cacheService.setNotExists).toHaveBeenCalledWith(
      `idemp:${key}`,
      expect.objectContaining({ inProgress: true }),
      expect.any(Number),
    );
    expect(next).toHaveBeenCalled();
    expect(res.on).toHaveBeenCalledWith("finish", expect.any(Function));
  });

  // Issue #1: regression for the concurrency race that allowed duplicate
  // money-moving submissions through.
  it("runs the handler exactly once when two requests fire concurrently with the same key", async () => {
    const key = "concurrent-key";

    // Simulate a real cache: the first setNotExists wins, the second loses.
    let reserved = false;
    let cached: any = null;
    (
      cacheService.setNotExists as jest.Mock<() => Promise<boolean>>
    ).mockImplementation(async (_k: any, value: any) => {
      if (reserved) return false;
      reserved = true;
      cached = value;
      return true;
    });
    (cacheService.get as jest.Mock<() => Promise<any>>).mockImplementation(
      async () => cached,
    );

    const handler = jest.fn();
    const wrap = async () => {
      const req = makeReq(key);
      const res = makeRes();
      const middlewareNext = (() => handler()) as unknown as NextFunction;
      await idempotencyMiddleware(req as Request, res as Response, middlewareNext);
      return res;
    };

    const [resA, resB] = await Promise.all([wrap(), wrap()]);

    expect(handler).toHaveBeenCalledTimes(1);
    // The losing request must surface an explicit in-progress signal — not
    // silently pass through to the handler.
    const losingRes = resA.status.mock.calls.length > 0 ? resA : resB;
    expect(losingRes.status).toHaveBeenCalledWith(409);
    expect(losingRes.set).toHaveBeenCalledWith(
      "X-Idempotency-Cache",
      "IN_PROGRESS",
    );
  });
});
