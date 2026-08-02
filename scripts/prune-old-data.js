#!/usr/bin/env node
"use strict";

/**
 * prune-old-data.js — Retention job for the n8watch database.
 *
 * Deletes ping_results and alerts older than N days (default 14), then flushes
 * the WAL and reclaims freed space. Non-interactive by design — intended to be
 * run from cron. Targets (config-driven) are never touched.
 *
 * Usage:
 *   node scripts/prune-old-data.js [--days N] [--dry-run]
 *
 * Options:
 *   --days N     Keep the most recent N days; delete anything older. Default 14.
 *   --dry-run    Report what would be deleted without changing anything.
 *
 * Examples:
 *   node scripts/prune-old-data.js                 # prune data older than 14 days
 *   node scripts/prune-old-data.js --days 30       # keep 30 days
 *   node scripts/prune-old-data.js --dry-run       # preview counts only
 */

const path = require("path");
const fs = require("fs");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

function argVal(name, def) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : def;
}

const daysRaw = argVal("--days", "14");
const days = Number(daysRaw);
if (!Number.isInteger(days) || days <= 0) {
  console.error(`ERROR: --days must be a positive integer (got "${daysRaw}")`);
  process.exit(1);
}

// Resolve the database path the same way the server and other scripts do.
const dataDir = process.env.n8watch_DATA_DIR
  ? path.resolve(process.env.n8watch_DATA_DIR)
  : path.join(__dirname, "..", "data");
const dbPath = path.join(dataDir, "n8watch.db");

const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
const stamp = () => new Date().toISOString();

let Database;
try {
  Database = require("better-sqlite3");
} catch {
  console.error(`[${stamp()}] ERROR: better-sqlite3 not installed. Run "npm install".`);
  process.exit(1);
}

if (!fs.existsSync(dbPath)) {
  console.error(`[${stamp()}] ERROR: Database not found at ${dbPath}`);
  process.exit(1);
}

console.log(
  `[${stamp()}] prune-old-data: retention=${days}d ` +
    `cutoff=${new Date(cutoff).toISOString()} dryRun=${dryRun}`,
);

const db = new Database(dbPath);
// The live app writes every ping cycle; wait for its brief locks instead of
// failing immediately on SQLITE_BUSY.
db.pragma("busy_timeout = 60000");

try {
  const pingCount = db
    .prepare("SELECT COUNT(*) n FROM ping_results WHERE created_at < ?")
    .get(cutoff).n;
  const alertCount = db
    .prepare("SELECT COUNT(*) n FROM alerts WHERE created_at < ?")
    .get(cutoff).n;

  if (dryRun) {
    console.log(
      `[${stamp()}] DRY-RUN would delete: ${pingCount} ping_result(s), ${alertCount} alert(s)`,
    );
    db.close();
    process.exit(0);
  }

  const tx = db.transaction(() => {
    const p = db
      .prepare("DELETE FROM ping_results WHERE created_at < ?")
      .run(cutoff).changes;
    const a = db
      .prepare("DELETE FROM alerts WHERE created_at < ?")
      .run(cutoff).changes;
    return { p, a };
  });
  const { p, a } = tx();
  console.log(`[${stamp()}] deleted: ${p} ping_result(s), ${a} alert(s)`);

  // Flush the WAL back into the main DB file (reclaims WAL growth).
  try {
    const wc = db.pragma("wal_checkpoint(TRUNCATE)");
    console.log(`[${stamp()}] wal_checkpoint(TRUNCATE): ${JSON.stringify(wc)}`);
  } catch (e) {
    console.warn(`[${stamp()}] wal_checkpoint skipped: ${e.message}`);
  }

  // Reclaim freed pages. VACUUM needs an exclusive lock and can be busy on a
  // live DB; a failure here is non-fatal (SQLite reuses the free pages later).
  if (p > 0 || a > 0) {
    try {
      db.exec("VACUUM");
      console.log(`[${stamp()}] VACUUM complete`);
    } catch (e) {
      console.warn(`[${stamp()}] VACUUM skipped: ${e.message}`);
    }
  }

  db.close();
  console.log(`[${stamp()}] done`);
} catch (e) {
  console.error(`[${stamp()}] ERROR: ${e.message}`);
  try {
    db.close();
  } catch {}
  process.exit(1);
}
