#!/usr/bin/env ts-node
/**
 * Audit script: find all withTransaction imports across the codebase.
 *
 * Usage:
 *   npx ts-node scripts/audit-transaction-imports.ts
 *
 * Outputs a report showing:
 * - Files importing from "../db/connection" (should migrate)
 * - Files importing from "../db/transaction" (correct)
 * - Files using withTransactionNoRetry (verify intentional)
 */

import * as fs from "fs";
import * as path from "path";

const SRC_DIR = path.join(__dirname, "..", "src");

interface ImportMatch {
  file: string;
  line: number;
  text: string;
  source: "connection" | "transaction" | "unknown";
  usesRetryVariant: boolean;
  usesNoRetry: boolean;
}

function findTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findTsFiles(fullPath));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

function analyzeFile(filePath: string): ImportMatch[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const matches: ImportMatch[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const importRegex = /import\s+.*?\{[^}]*\b(withTransaction|withTransactionNoRetry)\b[^}]*\}.*?from\s+['"]([^'"]+)['"]/;
    const match = line.match(importRegex);

    if (match) {
      const sourceModule = match[2];
      const source: ImportMatch["source"] =
        sourceModule.includes("connection") ? "connection" :
        sourceModule.includes("transaction") ? "transaction" : "unknown";

      matches.push({
        file: path.relative(process.cwd(), filePath),
        line: i + 1,
        text: line.trim(),
        source,
        usesRetryVariant: line.includes("withTransaction"),
        usesNoRetry: line.includes("withTransactionNoRetry"),
      });
    }
  }

  return matches;
}

function main() {
  const files = findTsFiles(SRC_DIR);
  const allMatches: ImportMatch[] = [];

  for (const file of files) {
    allMatches.push(...analyzeFile(file));
  }

  // Categorize
  const fromConnection = allMatches.filter((m) => m.source === "connection");
  const fromTransaction = allMatches.filter((m) => m.source === "transaction");
  const usingNoRetry = allMatches.filter((m) => m.usesNoRetry);

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  withTransaction Import Audit Report");
  console.log("═══════════════════════════════════════════════════════════\n");

  console.log(`Total imports found: ${allMatches.length}\n`);

  if (fromConnection.length > 0) {
    console.log(`⚠️  Imports from connection.ts (NEED MIGRATION): ${fromConnection.length}`);
    console.log("   These should be updated to import from '../db/transaction'\n");
    for (const m of fromConnection) {
      console.log(`   ${m.file}:${m.line}`);
      console.log(`   → ${m.text}\n`);
    }
  } else {
    console.log("✅ No imports from connection.ts — all migrated!\n");
  }

  if (fromTransaction.length > 0) {
    console.log(`✅ Imports from transaction.ts (CORRECT): ${fromTransaction.length}\n`);
    for (const m of fromTransaction) {
      console.log(`   ${m.file}:${m.line}`);
      console.log(`   → ${m.text}\n`);
    }
  }

  if (usingNoRetry.length > 0) {
    console.log(`ℹ️  Files using withTransactionNoRetry: ${usingNoRetry.length}`);
    console.log("   Please verify these are intentionally non-retrying:\n");
    for (const m of usingNoRetry) {
      console.log(`   ${m.file}:${m.line}`);
      console.log(`   → ${m.text}\n`);
    }
  }

  // Money-moving paths check
  const moneyPaths = allMatches.filter((m) =>
    m.file.toLowerCase().includes("loan") ||
    m.file.toLowerCase().includes("payment") ||
    m.file.toLowerCase().includes("repay") ||
    m.file.toLowerCase().includes("transfer") ||
    m.file.toLowerCase().includes("wallet") ||
    m.file.toLowerCase().includes("balance")
  );

  if (moneyPaths.length > 0) {
    console.log("💰 Money-moving paths using withTransaction:");
    for (const m of moneyPaths) {
      const status = m.usesNoRetry ? "❌ USES NO-RETRY — RISK!" : "✅ retrying variant";
      console.log(`   ${m.file}:${m.line} — ${status}`);
    }
  }

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  Recommended fixes:");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  sed -i 's|from "../db/connection"|from "../db/transaction"|g' src/**/*.ts`);
  console.log("  Then verify money-moving paths use withTransaction (not NoRetry).");
}

main();