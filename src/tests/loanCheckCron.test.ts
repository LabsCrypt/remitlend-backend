import { jest } from "@jest/globals";

jest.unstable_mockModule("../db/connection.js", () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  default: { query: jest.fn() },
}));

jest.unstable_mockModule("../services/notificationService.js", () => ({
  notificationService: {
    createNotification: jest.fn(),
  },
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
const { notificationService } =
  await import("../services/notificationService.js");
const { cacheService } = await import("../services/cacheService.js");
const { runLoanDueCheck } = await import("../cron/loanCheckCron.js");

const mockedQuery = query as jest.MockedFunction<typeof query>;
const mockedSetNotExists = cacheService.setNotExists as jest.MockedFunction<
  typeof cacheService.setNotExists
>;
const mockedDelete = cacheService.delete as jest.MockedFunction<
  typeof cacheService.delete
>;
const mockedCreateNotification =
  notificationService.createNotification as jest.MockedFunction<
    typeof notificationService.createNotification
  >;

describe("loanCheckCron - runLoanDueCheck", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should skip if lock cannot be acquired", async () => {
    mockedSetNotExists.mockResolvedValue(false);

    await runLoanDueCheck();

    expect(mockedQuery).not.toHaveBeenCalled();
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });

  it("should notify a borrower for a due loan", async () => {
    // First call: acquire cron lock
    // Second call: dedup guard for loan (returns true = key was set = not yet notified)
    mockedSetNotExists.mockResolvedValueOnce(true).mockResolvedValueOnce(true);

    mockedQuery.mockResolvedValue({
      rows: [
        {
          loan_id: 42,
          address: "GBORROWER1",
          amount: "1000",
          approved_at: new Date().toISOString(),
          term_ledgers: 17280,
        },
      ],
      rowCount: 1,
    } as any);

    mockedCreateNotification.mockResolvedValue({} as any);
    mockedDelete.mockResolvedValue(undefined as any);

    await runLoanDueCheck();

    expect(mockedCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockedCreateNotification).toHaveBeenCalledWith({
      userId: "GBORROWER1",
      type: "repayment_due",
      title: "Repayment Due Soon",
      message: "Your repayment for loan #42 of 1000 is due.",
      loanId: 42,
    });
  });

  it("should not re-notify a borrower already notified within the window", async () => {
    // First call: acquire cron lock (true)
    // Second call: dedup guard (false = key already exists = already notified)
    mockedSetNotExists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    mockedQuery.mockResolvedValue({
      rows: [
        {
          loan_id: 42,
          address: "GBORROWER1",
          amount: "1000",
          approved_at: new Date().toISOString(),
          term_ledgers: 17280,
        },
      ],
      rowCount: 1,
    } as any);

    mockedDelete.mockResolvedValue(undefined as any);

    await runLoanDueCheck();

    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });

  it("should handle multiple loans and only notify those not yet notified", async () => {
    // Cron lock + 3 dedup guards: loan 1 not notified, loan 2 already notified, loan 3 not notified
    mockedSetNotExists
      .mockResolvedValueOnce(true) // cron lock
      .mockResolvedValueOnce(true) // loan 1: new
      .mockResolvedValueOnce(false) // loan 2: already notified
      .mockResolvedValueOnce(true); // loan 3: new

    mockedQuery.mockResolvedValue({
      rows: [
        {
          loan_id: 1,
          address: "GA",
          amount: "100",
          approved_at: new Date().toISOString(),
          term_ledgers: 17280,
        },
        {
          loan_id: 2,
          address: "GB",
          amount: "200",
          approved_at: new Date().toISOString(),
          term_ledgers: 17280,
        },
        {
          loan_id: 3,
          address: "GC",
          amount: "300",
          approved_at: new Date().toISOString(),
          term_ledgers: 17280,
        },
      ],
      rowCount: 3,
    } as any);

    mockedCreateNotification.mockResolvedValue({} as any);
    mockedDelete.mockResolvedValue(undefined as any);

    await runLoanDueCheck();

    expect(mockedCreateNotification).toHaveBeenCalledTimes(2);
    expect(mockedCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ loanId: 1 }),
    );
    expect(mockedCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ loanId: 3 }),
    );
  });

  it("should delete dedup key when notification fails so it can be retried", async () => {
    mockedSetNotExists.mockResolvedValueOnce(true).mockResolvedValueOnce(true);

    mockedQuery.mockResolvedValue({
      rows: [
        {
          loan_id: 99,
          address: "GFAIL",
          amount: "500",
          approved_at: new Date().toISOString(),
          term_ledgers: 17280,
        },
      ],
      rowCount: 1,
    } as any);

    mockedCreateNotification.mockRejectedValueOnce(new Error("send failed"));
    mockedDelete.mockResolvedValue(undefined as any);

    await runLoanDueCheck();

    expect(mockedDelete).toHaveBeenCalledWith("loan_due_notified:99");
  });
});
