import { validateEnvVars } from "../config/env.js";
import { jest } from "@jest/globals";

jest.mock("../utils/logger.js");

const VALID_STELLAR_SECRET =
  "SBJ6ZXIH5JXKHXJUDF7DUX2HY5Q3SOOAUCQ3OUO5TIIJMOYIGPPP6Q6W";

function setValidEnv(): void {
  process.env.DATABASE_URL = "postgres://localhost";
  process.env.REDIS_URL = "redis://localhost";
  process.env.JWT_SECRET = "a".repeat(32);
  process.env.STELLAR_RPC_URL = "http://localhost";
  process.env.STELLAR_NETWORK_PASSPHRASE = "test";
  process.env.LOAN_MANAGER_CONTRACT_ID = "C1";
  process.env.LENDING_POOL_CONTRACT_ID = "C2";
  process.env.POOL_TOKEN_ADDRESS = "T1";
  process.env.LOAN_MANAGER_ADMIN_SECRET = VALID_STELLAR_SECRET;
  process.env.INTERNAL_API_KEY = "b".repeat(32);
  process.env.FRONTEND_URL = "http://localhost:3000";
  process.env.SCORE_DELTA_REPAY = "15";
  process.env.SCORE_DELTA_DEFAULT = "50";
  process.env.SCORE_DELTA_LATE = "5";
}

describe("Environment Variable Validation", () => {
  const originalEnv = process.env;
  let mockExit: any;

  beforeAll(() => {
    mockExit = jest
      .spyOn(process, "exit")
      .mockImplementation((code?: string | number | null | undefined) => {
        throw new Error(`Process.exit called with ${code}`);
      });
  });

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
    mockExit.mockRestore();
  });

  it("should not exit if all required variables are present and valid", () => {
    setValidEnv();

    expect(() => validateEnvVars()).not.toThrow();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("should exit with code 1 if a required variable is missing", () => {
    setValidEnv();
    delete process.env.DATABASE_URL;

    expect(() => validateEnvVars()).toThrow("Process.exit called with 1");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should exit with code 1 if a required variable is empty string", () => {
    setValidEnv();
    process.env.DATABASE_URL = "   ";

    expect(() => validateEnvVars()).toThrow("Process.exit called with 1");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  describe("JWT_SECRET format validation", () => {
    it("should exit if JWT_SECRET is shorter than 32 characters", () => {
      setValidEnv();
      process.env.JWT_SECRET = "short";

      expect(() => validateEnvVars()).toThrow("Process.exit called with 1");
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should pass if JWT_SECRET is exactly 32 characters", () => {
      setValidEnv();
      process.env.JWT_SECRET = "a".repeat(32);

      expect(() => validateEnvVars()).not.toThrow();
    });
  });

  describe("INTERNAL_API_KEY format validation", () => {
    it("should exit if INTERNAL_API_KEY is shorter than 32 characters", () => {
      setValidEnv();
      process.env.INTERNAL_API_KEY = "short";

      expect(() => validateEnvVars()).toThrow("Process.exit called with 1");
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should pass if INTERNAL_API_KEY is exactly 32 characters", () => {
      setValidEnv();
      process.env.INTERNAL_API_KEY = "x".repeat(32);

      expect(() => validateEnvVars()).not.toThrow();
    });
  });

  describe("LOAN_MANAGER_ADMIN_SECRET format validation", () => {
    it("should exit if LOAN_MANAGER_ADMIN_SECRET is not a valid Stellar secret key", () => {
      setValidEnv();
      process.env.LOAN_MANAGER_ADMIN_SECRET = "not-a-stellar-key";

      expect(() => validateEnvVars()).toThrow("Process.exit called with 1");
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should pass if LOAN_MANAGER_ADMIN_SECRET is a valid Stellar secret key", () => {
      setValidEnv();
      process.env.LOAN_MANAGER_ADMIN_SECRET = VALID_STELLAR_SECRET;

      expect(() => validateEnvVars()).not.toThrow();
    });
  });
});
