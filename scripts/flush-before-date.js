#!/usr/bin/env node
"use strict";

/**
 * flush-before-date.js — Delete historical n8watch data (ping results and
 * alerts) created on or before a given date, keeping everything after it.
 *
 * Unlike flush-data.js (wipes a whole table) or nuke-db.js (wipes the whole
 * database), this script only trims data up to a cutoff date and leaves
 * targets and any data after the cutoff untouched.
 *
 * Usage:
 *   node scripts/flush-before-date.js [DD-MM-YYYY] [options]
 *
 * If no date is given on the command line, the script prompts for one.
 *
 * Options:
 *   --ping-results   Only flush ping results (default: both tables)
 *   --alerts         Only flush alerts (default: both tables)
 *   --yes            Skip the confirmation prompt
 *
 * Examples:
 *   node scripts/flush-before-date.js 30-06-2026
 *   node scripts/flush-before-date.js 30-06-2026 --alerts
 *   node scripts/flush-before-date.js 30-06-2026 --yes
 */

const path = require("path");
const readline = require("readline");

const args = process.argv.slice(2);
const skipConfirm = args.includes("--yes");

const onlyPingResults = args.includes("--ping-results");
const onlyAlerts = args.includes("--alerts");
const flushPingResults = onlyPingResults || !onlyAlerts;
const flushAlerts = onlyAlerts || !onlyPingResults;

const dateArg = args.find((a) => /^\d{2}-\d{2}-\d{4}$/.test(a));

// Resolve the database path the same way the server and the other scripts do.
const dataDir = process.env.n8watch_DATA_DIR
  ? path.resolve(process.env.n8watch_DATA_DIR)
  : path.join(__dirname, "..", "data");

const dbPath = path.join(dataDir, "n8watch.db");

// Parses "DD-MM-YYYY" and returns the exclusive cutoff timestamp (epoch ms,
// local time) that is the start of the day AFTER the given date — i.e. rows
// with created_at < cutoff were created on or before the requested date.
function parseCutoff(input) {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(input.trim());
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);

  const date = new Date(year, month - 1, day + 1, 0, 0, 0, 0);

  // Reject invalid dates like 31-04-2026 (Date silently rolls them over).
  const rolledOverDay = new Date(year, month - 1, day);
  if (
    rolledOverDay.getFullYear() !== year ||
    rolledOverDay.getMonth() !== month - 1 ||
    rolledOverDay.getDate() !== day
  ) {
    return null;
  }

  return date.getTime();
}

function askDate() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question("Flush data up to and including date (dd-mm-yyyy): ", (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function askConfirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^[Yy]$/.test(answer.trim()));
    });
  });
}

async function run() {
  const rawDate = dateArg || (await askDate());
  const cutoff = parseCutoff(rawDate);

  if (cutoff === null) {
    console.error(`ERROR: "${rawDate}" is not a valid dd-mm-yyyy date.`);
    process.exit(1);
  }

  let Database;
  try {
    Database = require("better-sqlite3");
  } catch {
    console.error(
      'ERROR: better-sqlite3 is not installed. Run "npm install" first.',
    );
    process.exit(1);
  }

  if (!require("fs").existsSync(dbPath)) {
    console.error(`ERROR: Database not found at ${dbPath}`);
    process.exit(1);
  }

  const db = new Database(dbPath);

  const summary = [];
  if (flushPingResults) summary.push("ping results");
  if (flushAlerts) summary.push("alerts");

  console.log("");
  console.log("n8watch — Flush Data Up To Date");
  console.log("=================================");
  console.log(`Database    : ${dbPath}`);
  console.log(`Cutoff date : ${rawDate} (inclusive)`);
  console.log(`Will delete : ${summary.join(", ")} created on or before that date`);
  console.log(`Kept        : targets, and any data after ${rawDate}`);
  console.log("");

  if (!skipConfirm) {
    const confirmed = await askConfirm(
      `Are you sure you want to delete ${summary.join(", ")} up to ${rawDate}? [y/N]: `,
    );
    if (!confirmed) {
      console.log("Aborted. No data was deleted.");
      console.log("");
      db.close();
      return;
    }
  }

  const tx = db.transaction(() => {
    let pings = 0,
      alerts = 0;

    if (flushPingResults) {
      pings = db
        .prepare("DELETE FROM ping_results WHERE created_at < ?")
        .run(cutoff).changes;
    }
    if (flushAlerts) {
      alerts = db
        .prepare("DELETE FROM alerts WHERE created_at < ?")
        .run(cutoff).changes;
    }

    return { pings, alerts };
  });

  const result = tx();

  // Reclaim disk space after large deletes (must run outside a transaction).
  db.exec("VACUUM");

  console.log("Done!");
  if (flushPingResults)
    console.log(`  Deleted ${result.pings} ping result(s)`);
  if (flushAlerts) console.log(`  Deleted ${result.alerts} alert record(s)`);
  console.log("");

  db.close();
}

run();
