"use strict";

const path = require("path");
const Database = require("better-sqlite3");

let _db = null;

function getDb() {
  if (!_db)
    throw new Error("Database not initialized. Call initDatabase() first.");
  return _db;
}

function initDatabase() {
  // If n8watch_DATA_DIR is set, use it as the directory for the SQLite database.
  const dataDir = process.env.n8watch_DATA_DIR
    ? require("path").resolve(process.env.n8watch_DATA_DIR)
    : path.join(__dirname, "..", "data");

  require("fs").mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "n8watch.db");
  _db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  _db.exec(`
    CREATE TABLE IF NOT EXISTS targets (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT    NOT NULL,
      ip              TEXT    NOT NULL,
      grp             TEXT,
      interface       TEXT,
      interface_alias TEXT,
      is_user_target  INTEGER NOT NULL DEFAULT 0,
      expires_at      INTEGER,
      created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
      updated_at      INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    );

    -- Unique constraint: same IP is only a duplicate when the interface is also
    -- the same (or both are absent). This allows monitoring the same host via
    -- multiple outgoing interfaces (e.g. eth0 and eth1) simultaneously.
    -- Two partial indexes implement NULL-safe equality for the interface column:
    --   1. Among targets with no interface: at most one entry per IP.
    --   2. Among targets with an interface: at most one entry per (IP, interface).
    CREATE UNIQUE INDEX IF NOT EXISTS uq_targets_ip_null_iface
      ON targets(ip) WHERE interface IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_targets_ip_iface
      ON targets(ip, interface) WHERE interface IS NOT NULL;

    CREATE TABLE IF NOT EXISTS ping_results (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      target_id         INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
      is_alive          INTEGER NOT NULL,
      min_latency       REAL,
      avg_latency       REAL,
      max_latency       REAL,
      jitter            REAL,
      packet_loss       REAL NOT NULL DEFAULT 100,
      packets_sent      INTEGER NOT NULL DEFAULT 0,
      packets_received  INTEGER NOT NULL DEFAULT 0,
      created_at        INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_ping_results_target_created
      ON ping_results(target_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS alerts (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      target_id    INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
      rule_name    TEXT    NOT NULL,
      severity     TEXT    NOT NULL,
      condition    TEXT    NOT NULL,
      message      TEXT,
      resolved     INTEGER NOT NULL DEFAULT 0,
      resolved_at  INTEGER,
      created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_alerts_target_created
      ON alerts(target_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_alerts_resolved
      ON alerts(resolved, created_at DESC);

    -- Archive table for user-defined targets whose lifetime has ended.
    -- Records are never deleted so the full history is preserved.
    CREATE TABLE IF NOT EXISTS expired_targets (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT    NOT NULL,
      ip              TEXT    NOT NULL,
      interface       TEXT,
      interface_alias TEXT,
      target_created_at INTEGER NOT NULL,
      expired_at      INTEGER NOT NULL,
      archived_at     INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
      ping_count      INTEGER NOT NULL DEFAULT 0,
      uptime_overall  REAL
    );

    CREATE INDEX IF NOT EXISTS idx_expired_targets_expired_at
      ON expired_targets(expired_at DESC);

    -- Speedtest results: periodic internet speed measurements
    CREATE TABLE IF NOT EXISTS speedtest_results (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      download    REAL,       -- Mbps
      upload      REAL,       -- Mbps
      tool        TEXT,       -- "speedtest", "fast", or "both"
      interface   TEXT,
      error       TEXT,       -- non-null when the test failed
      created_at  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_speedtest_created
      ON speedtest_results(created_at DESC);
  `);

  // Migrate existing databases: add columns if they don't exist yet
  const targetCols = _db
    .prepare("PRAGMA table_info(targets)")
    .all()
    .map((c) => c.name);
  if (!targetCols.includes("is_user_target")) {
    _db.exec(
      "ALTER TABLE targets ADD COLUMN is_user_target INTEGER NOT NULL DEFAULT 0",
    );
  }
  if (!targetCols.includes("expires_at")) {
    _db.exec("ALTER TABLE targets ADD COLUMN expires_at INTEGER");
  }
  if (!targetCols.includes("interface")) {
    _db.exec("ALTER TABLE targets ADD COLUMN interface TEXT");
  }
  if (!targetCols.includes("interface_alias")) {
    _db.exec("ALTER TABLE targets ADD COLUMN interface_alias TEXT");
  }

  // Migrate: if the targets table still has a UNIQUE constraint on the ip column
  // alone (the old schema), recreate the table without it and add the new
  // partial unique indexes that allow the same IP with different interfaces.
  const tableSchema = _db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='targets'",
    )
    .get();
  const hasLegacyUniqueIp =
    tableSchema &&
    /ip\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(tableSchema.sql);
  if (hasLegacyUniqueIp) {
    _db.exec(`
      PRAGMA foreign_keys = OFF;

      CREATE TABLE targets_new (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        name            TEXT    NOT NULL,
        ip              TEXT    NOT NULL,
        grp             TEXT,
        interface       TEXT,
        interface_alias TEXT,
        is_user_target  INTEGER NOT NULL DEFAULT 0,
        expires_at      INTEGER,
        created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
        updated_at      INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
      );

      INSERT INTO targets_new
        SELECT id, name, ip, grp, interface, interface_alias,
               is_user_target, expires_at, created_at, updated_at
        FROM targets;

      DROP TABLE targets;
      ALTER TABLE targets_new RENAME TO targets;

      PRAGMA foreign_keys = ON;
    `);

    // Re-create the partial unique indexes after the migration
    _db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_targets_ip_null_iface
        ON targets(ip) WHERE interface IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_targets_ip_iface
        ON targets(ip, interface) WHERE interface IS NOT NULL;
    `);

    console.log("[DB] Migrated targets table: replaced UNIQUE(ip) with partial unique indexes");
  }

  return _db;
}

function syncTargets(targets) {
  const db = getDb();
  const now = Date.now();

  const updateStmt = db.prepare(`
    UPDATE targets
    SET
      name            = @name,
      grp             = @grp,
      interface_alias = @interface_alias,
      is_user_target  = 0,
      expires_at      = NULL,
      updated_at      = @now
    WHERE ip = @ip
      AND COALESCE(interface, '') = COALESCE(@interface, '')
      AND is_user_target = 0
  `);

  const insertStmt = db.prepare(`
    INSERT INTO targets (name, ip, grp, interface, interface_alias, is_user_target, created_at, updated_at)
    VALUES (@name, @ip, @grp, @interface, @interface_alias, 0, @now, @now)
  `);

  const syncAll = db.transaction((targets) => {
    // Build a set of canonical keys (ip + '|' + interface) for the current config.
    // This is used to remove config targets that are no longer present.
    const configKeys = new Set(
      targets.map((t) => `${t.ip}|${t.interface || ""}`)
    );

    for (const t of targets) {
      const params = {
        name: t.name,
        ip: t.ip,
        grp: t.group || null,
        interface: t.interface || null,
        interface_alias: t.interface_alias || null,
        now,
      };
      const result = updateStmt.run(params);
      if (result.changes === 0) {
        insertStmt.run(params);
      }
    }

    // Remove config targets whose (ip, interface) pair is no longer in config,
    // while preserving user-added targets.
    const dbConfigTargets = db
      .prepare("SELECT id, ip, interface FROM targets WHERE is_user_target = 0")
      .all();
    for (const row of dbConfigTargets) {
      const key = `${row.ip}|${row.interface || ""}`;
      if (!configKeys.has(key)) {
        db.prepare("DELETE FROM targets WHERE id = ?").run(row.id);
      }
    }
  });

  syncAll(targets);
}

function insertPingResult(data) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO ping_results
      (target_id, is_alive, min_latency, avg_latency, max_latency, jitter,
       packet_loss, packets_sent, packets_received, created_at)
    VALUES
      (@target_id, @is_alive, @min_latency, @avg_latency, @max_latency, @jitter,
       @packet_loss, @packets_sent, @packets_received, @created_at)
  `);
  const result = stmt.run({
    target_id: data.target_id,
    is_alive: data.is_alive ? 1 : 0,
    min_latency: data.min_latency ?? null,
    avg_latency: data.avg_latency ?? null,
    max_latency: data.max_latency ?? null,
    jitter: data.jitter ?? null,
    packet_loss: data.packet_loss ?? 100,
    packets_sent: data.packets_sent ?? 0,
    packets_received: data.packets_received ?? 0,
    created_at: data.created_at ?? Date.now(),
  });
  return result.lastInsertRowid;
}

function getLatestPingResult(targetId) {
  const db = getDb();
  return (
    db
      .prepare(
        `
    SELECT * FROM ping_results
    WHERE target_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `,
      )
      .get(targetId) || null
  );
}

function getAllTargetsWithLatest() {
  const db = getDb();
  return db
    .prepare(
      `
    SELECT
      t.id, t.name, t.ip, t.grp AS "group",
      t.interface, t.interface_alias,
      t.is_user_target, t.expires_at,
      t.created_at, t.updated_at,
      pr.id           AS latest_ping_id,
      pr.is_alive,
      pr.min_latency,
      pr.avg_latency,
      pr.max_latency,
      pr.jitter,
      pr.packet_loss,
      pr.packets_sent,
      pr.packets_received,
      pr.created_at   AS last_checked_at,
      (
        SELECT SUM(CASE WHEN pr2.is_alive = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*)
        FROM ping_results pr2
        WHERE pr2.target_id = t.id
      ) AS uptime_overall
    FROM targets t
    LEFT JOIN ping_results pr ON pr.id = (
      SELECT id FROM ping_results WHERE target_id = t.id ORDER BY created_at DESC LIMIT 1
    )
    WHERE (t.is_user_target = 0) OR (t.is_user_target = 1 AND (t.expires_at IS NULL OR t.expires_at > ?))
    ORDER BY t.is_user_target ASC,
             CASE WHEN t.is_user_target = 0 THEN t.id END ASC,
             t.created_at DESC
  `,
    )
    .all(Date.now());
}

function getTargetById(id) {
  const db = getDb();
  return (
    db
      .prepare(
        `
    SELECT
      t.id, t.name, t.ip, t.grp AS "group",
      t.interface, t.interface_alias,
      t.created_at, t.updated_at,
      pr.id           AS latest_ping_id,
      pr.is_alive,
      pr.min_latency,
      pr.avg_latency,
      pr.max_latency,
      pr.jitter,
      pr.packet_loss,
      pr.packets_sent,
      pr.packets_received,
      pr.created_at   AS last_checked_at
    FROM targets t
    LEFT JOIN ping_results pr ON pr.id = (
      SELECT id FROM ping_results WHERE target_id = t.id ORDER BY created_at DESC LIMIT 1
    )
    WHERE t.id = ?
  `,
      )
      .get(id) || null
  );
}

function parseMs(val, defaultVal) {
  if (val === undefined || val === null) return defaultVal;
  const n = Number(val);
  if (!isNaN(n)) return n;
  const d = new Date(val);
  if (!isNaN(d.getTime())) return d.getTime();
  return defaultVal;
}

function getPingResults(targetId, from, to, limit = 100, offset = 0) {
  const db = getDb();
  const fromMs = parseMs(from, 0);
  const toMs = parseMs(to, Date.now());
  // Ceiling is generous so full-range exports/reports (which pass a large limit)
  // are honored; ordinary paginated callers still pass small limits.
  const lim = Math.min(Number(limit) || 100, 500000);
  const off = Number(offset) || 0;

  const rows = db
    .prepare(
      `
    SELECT * FROM ping_results
    WHERE target_id = ?
      AND created_at >= ?
      AND created_at <= ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `,
    )
    .all(targetId, fromMs, toMs, lim, off);

  const total = db
    .prepare(
      `
    SELECT COUNT(*) AS cnt FROM ping_results
    WHERE target_id = ?
      AND created_at >= ?
      AND created_at <= ?
  `,
    )
    .get(targetId, fromMs, toMs).cnt;

  return { rows, total, limit: lim, offset: off };
}

function getMetrics(targetId, from, to, intervalSeconds = 300) {
  const db = getDb();
  const fromMs = parseMs(from, Date.now() - 86400000);
  const toMs = parseMs(to, Date.now());
  const bucketMs = intervalSeconds * 1000;

  return db
    .prepare(
      `
    SELECT
      (created_at / @bucket) * @bucket AS bucket,
      AVG(avg_latency)       AS avg_latency,
      MIN(min_latency)       AS min_latency,
      MAX(max_latency)       AS max_latency,
      AVG(jitter)            AS jitter,
      AVG(packet_loss)       AS packet_loss,
      SUM(CASE WHEN is_alive = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS uptime_pct,
      COUNT(*)               AS sample_count
    FROM ping_results
    WHERE target_id = @target_id
      AND created_at >= @from
      AND created_at <= @to
    GROUP BY bucket
    ORDER BY bucket ASC
  `,
    )
    .all({ bucket: bucketMs, target_id: targetId, from: fromMs, to: toMs });
}

function getUptime(targetId) {
  const db = getDb();
  const now = Date.now();

  const query = db.prepare(`
    SELECT
      SUM(CASE WHEN is_alive = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS uptime_pct,
      COUNT(*) AS total
    FROM ping_results
    WHERE target_id = ? AND created_at >= ?
  `);

  const queryAll = db.prepare(`
    SELECT
      SUM(CASE WHEN is_alive = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS uptime_pct,
      COUNT(*) AS total
    FROM ping_results
    WHERE target_id = ?
  `);

  const calc = (windowMs) => {
    const row = query.get(targetId, now - windowMs);
    if (!row || row.total === 0) return null;
    return Math.round(row.uptime_pct * 100) / 100;
  };

  const rowAll = queryAll.get(targetId);
  const uptime_overall =
    !rowAll || rowAll.total === 0
      ? null
      : Math.round(rowAll.uptime_pct * 100) / 100;

  return {
    uptime_1h: calc(3600000),
    uptime_24h: calc(86400000),
    uptime_7d: calc(604800000),
    uptime_30d: calc(2592000000),
    uptime_overall,
  };
}

function getDashboardSummary() {
  const db = getDb();

  const counts = db
    .prepare(
      `
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN pr.is_alive = 1 THEN 1 ELSE 0 END) AS up,
      SUM(CASE WHEN pr.is_alive = 0 THEN 1 ELSE 0 END) AS down,
      SUM(CASE WHEN pr.id IS NULL THEN 1 ELSE 0 END)   AS unknown
    FROM targets t
    LEFT JOIN ping_results pr ON pr.id = (
      SELECT id FROM ping_results WHERE target_id = t.id ORDER BY created_at DESC LIMIT 1
    )
  `,
    )
    .get();

  const latency = db
    .prepare(
      `
    SELECT
      AVG(pr.avg_latency)  AS avg_latency,
      AVG(pr.packet_loss)  AS avg_packet_loss
    FROM targets t
    JOIN ping_results pr ON pr.id = (
      SELECT id FROM ping_results WHERE target_id = t.id ORDER BY created_at DESC LIMIT 1
    )
    WHERE pr.is_alive = 1
  `,
    )
    .get();

  const activeAlerts = db
    .prepare(
      `
    SELECT COUNT(*) AS cnt FROM alerts WHERE resolved = 0
  `,
    )
    .get();

  return {
    total: counts.total || 0,
    up: counts.up || 0,
    down: counts.down || 0,
    unknown: counts.unknown || 0,
    avg_latency: latency ? latency.avg_latency || null : null,
    avg_packet_loss: latency ? latency.avg_packet_loss || null : null,
    active_alerts: activeAlerts.cnt || 0,
  };
}

function insertAlert(data) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO alerts (target_id, rule_name, severity, condition, message, created_at)
    VALUES (@target_id, @rule_name, @severity, @condition, @message, @created_at)
  `);
  const result = stmt.run({
    target_id: data.target_id,
    rule_name: data.rule_name,
    severity: data.severity,
    condition: data.condition,
    message: data.message || null,
    created_at: data.created_at || Date.now(),
  });
  return result.lastInsertRowid;
}

function getAlerts(filters = {}) {
  const db = getDb();
  const conditions = [];
  const params = {};

  if (filters.severity) {
    conditions.push("a.severity = @severity");
    params.severity = filters.severity;
  }
  if (filters.target_id) {
    conditions.push("a.target_id = @target_id");
    params.target_id = Number(filters.target_id);
  }
  if (filters.resolved !== undefined && filters.resolved !== "") {
    conditions.push("a.resolved = @resolved");
    params.resolved =
      filters.resolved === "true" || filters.resolved === "1" ? 1 : 0;
  }
  if (filters.from) {
    conditions.push("a.created_at >= @from");
    params.from = parseMs(filters.from, 0);
  }
  if (filters.to) {
    conditions.push("a.created_at <= @to");
    params.to = parseMs(filters.to, Date.now());
  }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const limit = Math.min(Number(filters.limit) || 50, 500);
  const offset = Number(filters.offset) || 0;

  const rows = db
    .prepare(
      `
    SELECT a.*, t.name AS target_name, t.ip AS target_ip
    FROM alerts a
    JOIN targets t ON t.id = a.target_id
    ${where}
    ORDER BY a.created_at DESC
    LIMIT @limit OFFSET @offset
  `,
    )
    .all({ ...params, limit, offset });

  const total = db
    .prepare(
      `
    SELECT COUNT(*) AS cnt
    FROM alerts a
    JOIN targets t ON t.id = a.target_id
    ${where}
  `,
    )
    .get(params).cnt;

  return { rows, total, limit, offset };
}

function getActiveAlerts() {
  const db = getDb();
  return db
    .prepare(
      `
    SELECT a.*, t.name AS target_name, t.ip AS target_ip
    FROM alerts a
    JOIN targets t ON t.id = a.target_id
    WHERE a.resolved = 0
    ORDER BY a.created_at DESC
  `,
    )
    .all();
}

function resolveAlert(alertId, resolvedAt) {
  const db = getDb();
  db.prepare(
    `
    UPDATE alerts SET resolved = 1, resolved_at = ? WHERE id = ?
  `,
  ).run(resolvedAt || Date.now(), alertId);
}

function addUserTarget(name, ip, iface, ifaceAlias, lifetimeDays) {
  const db = getDb();
  const now = Date.now();
  const maxDays = require('./config').getConfig().general.max_user_target_lifetime_days;
  const days = (typeof lifetimeDays === 'number' && lifetimeDays > 0) ? lifetimeDays : maxDays;
  const expiresAt = now + days * 86400000;

  // Enforce (ip, interface) uniqueness at the application level.
  // Two NULLs are considered equal here (same host, same default interface).
  const existing = db
    .prepare(
      "SELECT id FROM targets WHERE ip = ? AND COALESCE(interface, '') = COALESCE(?, '')",
    )
    .get(ip, iface || null);
  if (existing) {
    const err = new Error(
      "UNIQUE constraint failed: a target with this IP and interface already exists",
    );
    err.code = "UNIQUE_IP_INTERFACE";
    throw err;
  }

  const result = db
    .prepare(
      `
    INSERT INTO targets (name, ip, grp, interface, interface_alias, is_user_target, expires_at, created_at, updated_at)
    VALUES (@name, @ip, NULL, @interface, @interface_alias, 1, @expires_at, @now, @now)
  `,
    )
    .run({
      name,
      ip,
      interface: iface || null,
      interface_alias: ifaceAlias || null,
      expires_at: expiresAt,
      now,
    });
  return result.lastInsertRowid;
}

function deleteUserTarget(id) {
  const db = getDb();
  const info = db
    .prepare("DELETE FROM targets WHERE id = ? AND is_user_target = 1")
    .run(id);
  return info.changes > 0;
}

function getUserTargets() {
  const db = getDb();
  return db
    .prepare(
      `
    SELECT
      t.id, t.name, t.ip, t.interface, t.interface_alias,
      t.is_user_target, t.expires_at,
      t.created_at, t.updated_at,
      pr.is_alive,
      pr.min_latency,
      pr.avg_latency,
      pr.max_latency,
      pr.jitter,
      pr.packet_loss,
      pr.packets_sent,
      pr.packets_received,
      pr.created_at AS last_checked_at,
      (
        SELECT SUM(CASE WHEN pr2.is_alive = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*)
        FROM ping_results pr2
        WHERE pr2.target_id = t.id
      ) AS uptime_overall
    FROM targets t
    LEFT JOIN ping_results pr ON pr.id = (
      SELECT id FROM ping_results WHERE target_id = t.id ORDER BY created_at DESC LIMIT 1
    )
    WHERE t.is_user_target = 1
      AND (t.expires_at IS NULL OR t.expires_at > ?)
    ORDER BY t.created_at DESC
  `,
    )
    .all(Date.now());
}

function archiveExpiredUserTargets() {
  const db = getDb();
  const now = Date.now();

  // Find all expired user targets that have not yet been archived
  const expired = db
    .prepare(
      `SELECT t.id, t.name, t.ip, t.interface, t.interface_alias,
              t.created_at, t.expires_at,
              COUNT(pr.id) AS ping_count,
              CASE WHEN COUNT(pr.id) > 0
                   THEN SUM(CASE WHEN pr.is_alive = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(pr.id)
                   ELSE NULL END AS uptime_overall
       FROM targets t
       LEFT JOIN ping_results pr ON pr.target_id = t.id
       WHERE t.is_user_target = 1
         AND t.expires_at IS NOT NULL
         AND t.expires_at <= ?
       GROUP BY t.id`,
    )
    .all(now);

  if (expired.length === 0) return 0;

  const archiveStmt = db.prepare(`
    INSERT INTO expired_targets
      (name, ip, interface, interface_alias, target_created_at, expired_at, archived_at, ping_count, uptime_overall)
    VALUES
      (@name, @ip, @interface, @interface_alias, @target_created_at, @expired_at, @archived_at, @ping_count, @uptime_overall)
  `);

  const deleteStmt = db.prepare('DELETE FROM targets WHERE id = ?');

  const doArchive = db.transaction((rows) => {
    for (const row of rows) {
      archiveStmt.run({
        name:              row.name,
        ip:                row.ip,
        interface:         row.interface || null,
        interface_alias:   row.interface_alias || null,
        target_created_at: row.created_at,
        expired_at:        row.expires_at,
        archived_at:       now,
        ping_count:        row.ping_count || 0,
        uptime_overall:    row.uptime_overall ?? null,
      });
      deleteStmt.run(row.id);
    }
  });

  doArchive(expired);
  return expired.length;
}

function getExpiredTargets() {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM expired_targets ORDER BY expired_at DESC`,
    )
    .all();
}

function cleanupExpiredUserTargets() {
  return archiveExpiredUserTargets();
}


function deleteOldData(retentionDays) {
  const db = getDb();
  const cutoff = Date.now() - retentionDays * 86400000;

  const delPings = db
    .prepare("DELETE FROM ping_results WHERE created_at < ?")
    .run(cutoff);
  const delAlerts = db
    .prepare("DELETE FROM alerts WHERE created_at < ? AND resolved = 1")
    .run(cutoff);
  const delSpeedtest = db
    .prepare("DELETE FROM speedtest_results WHERE created_at < ?")
    .run(cutoff);
  const delUserTargets = cleanupExpiredUserTargets();

  return {
    deletedPings: delPings.changes,
    deletedAlerts: delAlerts.changes,
    deletedSpeedtest: delSpeedtest.changes,
    deletedUserTargets: delUserTargets,
  };
}

function getLatestPingResultForAll() {
  const db = getDb();
  return db
    .prepare(
      `
    SELECT pr.*
    FROM ping_results pr
    INNER JOIN (
      SELECT target_id, MAX(created_at) AS max_ts
      FROM ping_results
      GROUP BY target_id
    ) latest ON pr.target_id = latest.target_id AND pr.created_at = latest.max_ts
  `,
    )
    .all();
}

// ── Speedtest helpers ─────────────────────────────────────────────────────────

function insertSpeedtestResult(data) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO speedtest_results (download, upload, tool, interface, error, created_at)
    VALUES (@download, @upload, @tool, @interface, @error, @created_at)
  `);
  const result = stmt.run({
    download:   data.download   ?? null,
    upload:     data.upload     ?? null,
    tool:       data.tool       || null,
    interface:  data.interface  || null,
    error:      data.error      || null,
    created_at: data.created_at ?? Date.now(),
  });
  return result.lastInsertRowid;
}

function getSpeedtestResults({ from, to, limit = 100 } = {}) {
  const db    = getDb();
  const fromMs = parseMs(from, 0);
  const toMs   = parseMs(to, Date.now());
  const lim    = Math.min(Number(limit) || 100, 1000);

  return db
    .prepare(
      `SELECT * FROM speedtest_results
       WHERE created_at >= ? AND created_at <= ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(fromMs, toMs, lim);
}

function getLatestSpeedtestResult() {
  const db = getDb();
  return (
    db
      .prepare(
        `SELECT * FROM speedtest_results ORDER BY created_at DESC LIMIT 1`,
      )
      .get() || null
  );
}

module.exports = {
  getDb,
  initDatabase,
  syncTargets,
  insertPingResult,
  getLatestPingResult,
  getAllTargetsWithLatest,
  getTargetById,
  getPingResults,
  getMetrics,
  getUptime,
  getDashboardSummary,
  insertAlert,
  getAlerts,
  getActiveAlerts,
  resolveAlert,
  deleteOldData,
  getLatestPingResultForAll,
  addUserTarget,
  deleteUserTarget,
  getUserTargets,
  cleanupExpiredUserTargets,
  archiveExpiredUserTargets,
  getExpiredTargets,
  insertSpeedtestResult,
  getSpeedtestResults,
  getLatestSpeedtestResult,
};
