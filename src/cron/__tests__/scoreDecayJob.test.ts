import { jest } from "@jest/globals";

type Borrower = {
  user_id: string;
  current_score: number;
  last_repayment: string | null;
};

const mockGetInactiveBorrowers: jest.MockedFunction<
  () => Promise<Borrower[]>
> = jest.fn();
const mockApplyScoreDecay: jest.MockedFunction<
  (b: Borrower) => Promise<number>
> = jest.fn();

jest.unstable_mockModule("../../services/scoreDecayService.js", () => ({
  getInactiveBorrowers: mockGetInactiveBorrowers,
  applyScoreDecay: mockApplyScoreDecay,
}));

jest.unstable_mockModule("../../services/cacheService.js", () => ({
  cacheService: {
    setNotExists: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
    delete: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  },
}));

jest.unstable_mockModule("../../utils/logger.js", () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe("scoreDecayJob", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should apply score decay to inactive borrowers above minimum score", async () => {
    const borrowers: Borrower[] = [
      { user_id: "user1", current_score: 700, last_repayment: "2024-01-01T00:00:00.000Z" },
      { user_id: "user2", current_score: 650, last_repayment: null },
    ];
    mockGetInactiveBorrowers.mockResolvedValue(borrowers);
    mockApplyScoreDecay.mockResolvedValue(0);

    const { runScoreDecayJob } = await import("../scoreDecayJob.js");
    await runScoreDecayJob();

    expect(mockGetInactiveBorrowers).toHaveBeenCalled();
    expect(mockApplyScoreDecay).toHaveBeenCalledTimes(2);
    expect(mockApplyScoreDecay).toHaveBeenCalledWith(borrowers[0]);
    expect(mockApplyScoreDecay).toHaveBeenCalledWith(borrowers[1]);
  });

  it("should handle errors gracefully", async () => {
    mockGetInactiveBorrowers.mockRejectedValue(new Error("DB error"));
    const { runScoreDecayJob } = await import("../scoreDecayJob.js");
    await expect(runScoreDecayJob()).resolves.not.toThrow();
  });
});
