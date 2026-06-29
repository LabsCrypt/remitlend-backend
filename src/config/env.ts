import { StrKey } from "@stellar/stellar-sdk";
import logger from "../utils/logger.js";

const REQUIRED_ENV_VARS = [
  "DATABASE_URL",
  "REDIS_URL",
  "JWT_SECRET",
  "STELLAR_RPC_URL",
  "STELLAR_NETWORK_PASSPHRASE",
  "LOAN_MANAGER_CONTRACT_ID",
  "LENDING_POOL_CONTRACT_ID",
  "POOL_TOKEN_ADDRESS",
  "LOAN_MANAGER_ADMIN_SECRET",
  "INTERNAL_API_KEY",
  "FRONTEND_URL",
  "SCORE_DELTA_REPAY",
  "SCORE_DELTA_DEFAULT",
  "SCORE_DELTA_LATE",
];

const MIN_SECRET_LENGTH = 32;

function validateSecretFormat(errors: string[]): void {
  const jwtSecret = process.env.JWT_SECRET?.trim();
  if (jwtSecret && jwtSecret.length < MIN_SECRET_LENGTH) {
    errors.push(
      `JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters (got ${jwtSecret.length})`,
    );
  }

  const apiKey = process.env.INTERNAL_API_KEY?.trim();
  if (apiKey && apiKey.length < MIN_SECRET_LENGTH) {
    errors.push(
      `INTERNAL_API_KEY must be at least ${MIN_SECRET_LENGTH} characters (got ${apiKey.length})`,
    );
  }

  const adminSecret = process.env.LOAN_MANAGER_ADMIN_SECRET?.trim();
  if (adminSecret && !StrKey.isValidEd25519SecretSeed(adminSecret)) {
    errors.push(`LOAN_MANAGER_ADMIN_SECRET is not a valid Stellar secret key`);
  }
}

export function validateEnvVars(): void {
  const missing = REQUIRED_ENV_VARS.filter(
    (key) => !process.env[key] || process.env[key]!.trim() === "",
  );

  if (missing.length > 0) {
    const boldRed = (msg: string) => `\x1b[1;31m${msg}\x1b[0m`;
    const bold = (msg: string) => `\x1b[1m${msg}\x1b[0m`;

    const errorPrefix = boldRed("FATAL ERROR: Environment validation failed");
    const missingVarMsg = `Missing or empty required variables: ${bold(missing.join(", "))}`;
    const actionMsg = `Please verify these variables in your \x1b[4m.env\x1b[0m file or deployment environment.`;

    console.error(`\n${errorPrefix}\n${missingVarMsg}\n${actionMsg}\n`);

    logger.error("Environment validation failure", {
      missing,
      node_env: process.env.NODE_ENV,
    });

    process.exit(1);
  }

  const formatErrors: string[] = [];
  validateSecretFormat(formatErrors);

  if (formatErrors.length > 0) {
    const boldRed = (msg: string) => `\x1b[1;31m${msg}\x1b[0m`;

    const errorPrefix = boldRed("FATAL ERROR: Environment validation failed");
    const details = formatErrors.map((e) => `  - ${e}`).join("\n");

    console.error(`\n${errorPrefix}\n${details}\n`);

    logger.error("Environment format validation failure", {
      errors: formatErrors,
      node_env: process.env.NODE_ENV,
    });

    process.exit(1);
  }

  logger.info("Environment variables validated successfully.");
}
