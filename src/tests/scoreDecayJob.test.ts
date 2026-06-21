import { jest } from "@jest/globals";

jest.unstable_mockModule("../db/connection.js", () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  default: { query: jest.fn() },
}));

jest.unstable_mockModule("../services/cacheService.js", () => ({
  cacheService: {
    setNotExists: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.unstable_mockModule("../utils/logger.js", () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const { query } = await import("../db/connection.js");
const { cacheService } = await import("../services/cacheService.js");
const { runScoreDecayJob } = await import("../cron/scoreDecayJob.js");

const mockedQuery = query as jest.MockedFunction<typeof query>;
const mockedSetNotExists = cacheService.setNotExists as jest.MockedFunction<
  typeof cacheService.setNotExists
>;
const mockedDelete = cacheService.delete as jest.MockedFunction<
  typeof cacheService.delete
>;

describe("scoreDecayJob - runScoreDecayJob", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should skip if lock cannot be acquired", async () => {
    mockedSetNotExists.mockResolvedValue(false);

    await runScoreDecayJob();

    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it("should apply decay to inactive borrowers with scores above minimum", async () => {
    mockedSetNotExists.mockResolvedValue(true);
    mockedDelete.mockResolvedValue(undefined as any);

    const thirtyDaysAgo = new Date(
      Date.now() - 60 * 24 * 60 * 60 * 1000,
    ).toISOString();

    // First query: getInactiveBorrowers
    mockedQuery.mockResolvedValueOnce({
      rows: [
        { user_id: "GA1", current_score: 600, last_repayment: thirtyDaysAgo },
        { user_id: "GA2", current_score: 300, last_repayment: null },
      ],
      rowCount: 2,
    } as any);

    // Second query: UPDATE for GA1 (GA2 is skipped since score is already at min)
    mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);

    await runScoreDecayJob();

    // Only 2 queries: SELECT inactive + UPDATE for GA1
    expect(mockedQuery).toHaveBeenCalledTimes(2);
    expect(mockedQuery).toHaveBeenLastCalledWith(
      expect.stringContaining("UPDATE scores"),
      expect.arrayContaining(["GA1"]),
    );
  });

  it("should not update borrowers already at minimum score", async () => {
    mockedSetNotExists.mockResolvedValue(true);
    mockedDelete.mockResolvedValue(undefined as any);

    mockedQuery.mockResolvedValueOnce({
      rows: [{ user_id: "GB1", current_score: 300, last_repayment: null }],
      rowCount: 1,
    } as any);

    await runScoreDecayJob();

    // Only the SELECT query should run, no UPDATE
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });

  it("should calculate decay based on months of inactivity", async () => {
    mockedSetNotExists.mockResolvedValue(true);
    mockedDelete.mockResolvedValue(undefined as any);

    // 90 days ago = ~3 months inactive => 3 * 5 = 15 points decay
    const ninetyDaysAgo = new Date(
      Date.now() - 90 * 24 * 60 * 60 * 1000,
    ).toISOString();

    mockedQuery.mockResolvedValueOnce({
      rows: [
        { user_id: "GC1", current_score: 500, last_repayment: ninetyDaysAgo },
      ],
      rowCount: 1,
    } as any);

    mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);

    await runScoreDecayJob();

    // Expected new score: 500 - (3 * 5) = 485
    expect(mockedQuery).toHaveBeenLastCalledWith(
      expect.stringContaining("UPDATE scores"),
      [485, "GC1"],
    );
  });
});
