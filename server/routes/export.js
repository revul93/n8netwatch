'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../database');
const { getConfig } = require('../config');

// Format an epoch-ms timestamp as local "YYYY-MM-DD HH:MM:SS".
function formatTimestamp(ms) {
  const d = new Date(Number(ms));
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Resolve a target's `interface` (an IPv4 or an interface name) to its source IP.
function resolveSourceIp(iface) {
  if (!iface) return '';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(iface)) return iface; // already an IP
  try {
    const cfg = getConfig();
    const match = (cfg.interfaces || []).find((i) => i.name === iface);
    return (match && match.ipv4) || '';
  } catch {
    return '';
  }
}

function csvCell(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

// GET /api/targets/:id/export  (CSV download — one row per ping cycle)
router.get('/:id/export', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid target id' });

    const target = db.getTargetById(id);
    if (!target) return res.status(404).json({ error: 'Target not found' });

    const { from, to } = req.query;
    // Fetch the full window for export (see cap in db.getPingResults).
    const { rows } = db.getPingResults(id, from, to, 500000, 0);

    const targetIp = target.ip || '';
    const sourceIp = resolveSourceIp(target.interface);

    const headers = [
      'id', 'timestamp', 'target_id', 'target_ip', 'source_ip', 'is_alive',
      'min_latency', 'avg_latency', 'max_latency', 'jitter', 'packet_loss_prct',
      'packets_sent', 'packets_received',
    ];

    const csvLines = [
      headers.join(','),
      ...rows.map((row) => [
        row.id,
        formatTimestamp(row.created_at),
        row.target_id,
        targetIp,
        sourceIp,
        row.is_alive,
        row.min_latency,
        row.avg_latency,
        row.max_latency,
        row.jitter,
        row.packet_loss,
        row.packets_sent,
        row.packets_received,
      ].map(csvCell).join(',')),
    ];

    const filename = `${target.name.replace(/\s+/g, '_')}_${id}_export.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvLines.join('\n'));
  } catch (err) {
    console.error('[Routes/export] GET /:id/export:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/targets/:id/report  (comprehensive report data as JSON)
router.get('/:id/report', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid target id' });

    const target = db.getTargetById(id);
    if (!target) return res.status(404).json({ error: 'Target not found' });

    // Uptime statistics
    const uptime = db.getUptime(id);

    // Metrics over the past 24 hours (5-minute buckets)
    const metricsFrom = Date.now() - 86400000;
    const metrics = db.getMetrics(id, metricsFrom, Date.now(), 300);

    // Recent ping results (last 200 samples)
    const { rows: pingRows } = db.getPingResults(id, metricsFrom, Date.now(), 200, 0);

    // Alert history for this target (last 100)
    const { rows: alertRows } = db.getAlerts({ target_id: id, limit: 100 });

    res.json({
      generated_at: new Date().toISOString(),
      target: {
        id:              target.id,
        name:            target.name,
        ip:              target.ip,
        group:           target.group,
        interface:       target.interface || null,
        interface_alias: target.interface_alias || null,
        is_alive:        target.is_alive,
        avg_latency:     target.avg_latency,
        packet_loss:     target.packet_loss,
      },
      uptime,
      metrics,
      ping_results: pingRows,
      alerts: alertRows,
    });
  } catch (err) {
    console.error('[Routes/export] GET /:id/report:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/targets/:id/log-report?from&to&latencyThreshold
// Availability-report data for a target over a window: summary stats over all
// samples, a downsampled latency series for the chart, and grouped problem
// "events" (outage / degradation episodes). The complete raw log stays in the
// CSV export; this keeps the PDF concise and bounded.
router.get('/:id/log-report', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid target id' });

    const target = db.getTargetById(id);
    if (!target) return res.status(404).json({ error: 'Target not found' });

    const { from, to } = req.query;
    // Report options: query params win; otherwise fall back to the admin-saved
    // config.report defaults.
    let rc = {};
    try { rc = getConfig().report || {}; } catch { /* config unavailable */ }
    const latencyThreshold = Number(req.query.latencyThreshold) || Number(rc.latency_threshold) || 100; // ms
    const jitterThreshold = req.query.jitterThreshold != null
      ? Number(req.query.jitterThreshold) || 0
      : Number(rc.jitter_threshold) || 0; // 0 = disabled
    const outagesOnly = req.query.outagesOnly != null
      ? (req.query.outagesOnly === '1' || req.query.outagesOnly === 'true')
      : !!rc.outages_only;
    const includeLog = req.query.includeLog != null
      ? !(req.query.includeLog === '0' || req.query.includeLog === 'false')
      : (rc.detailed_log !== false);

    // All samples in the window (oldest first).
    const { rows: raw } = db.getPingResults(id, from, to, 500000, 0);
    const rows = raw.slice().sort((a, b) => a.created_at - b.created_at);

    const alive = (r) => r.is_alive === 1 || r.is_alive === true;
    const n = rows.length;
    const upCount = rows.filter(alive).length;

    const latencies = rows.filter((r) => alive(r) && r.avg_latency != null).map((r) => Number(r.avg_latency));
    const mins = rows.filter((r) => alive(r) && r.min_latency != null).map((r) => Number(r.min_latency));
    const maxs = rows.filter((r) => alive(r) && r.max_latency != null).map((r) => Number(r.max_latency));
    const jitters = rows.filter((r) => alive(r) && r.jitter != null).map((r) => Number(r.jitter));
    const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
    const median = (a) => {
      if (!a.length) return null;
      const s = [...a].sort((x, y) => x - y);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    const totalSent = rows.reduce((s, r) => s + (r.packets_sent || 0), 0);
    const totalRecv = rows.reduce((s, r) => s + (r.packets_received || 0), 0);

    // Group "problem" samples into events. Bad samples separated by only a
    // short recovered gap (<= gapMs) are treated as one episode, so a flapping
    // link reads as one event instead of dozens. gapMs / minEventMs are tunable.
    const gapMs = Number(req.query.gapMs) || 60000;          // merge across <=60s gaps
    const minEventMs = Number(req.query.minEventMs) || 120000; // "significant" degraded >=2m
    const isBad = (r) => {
      if (!alive(r)) return true;
      if (outagesOnly) return false; // outages-only mode ignores degradation
      if ((r.packet_loss || 0) > 0) return true;
      if (r.avg_latency != null && Number(r.avg_latency) > latencyThreshold) return true;
      if (jitterThreshold > 0 && r.jitter != null && Number(r.jitter) > jitterThreshold) return true;
      return false;
    };
    const allEvents = [];
    let cur = null;
    for (const r of rows) {
      if (!isBad(r)) continue;
      const down = !alive(r);
      if (cur && (r.created_at - cur.end) > gapMs) { allEvents.push(cur); cur = null; }
      if (!cur) cur = { start: r.created_at, end: r.created_at, samples: 0, down: 0, worst_latency: 0, max_loss: 0 };
      cur.end = r.created_at;
      cur.samples += 1;
      if (down) cur.down += 1;
      if (r.avg_latency != null) cur.worst_latency = Math.max(cur.worst_latency, Number(r.avg_latency));
      cur.max_loss = Math.max(cur.max_loss, r.packet_loss || 0);
    }
    if (cur) allEvents.push(cur);
    // Typical sample interval (median gap), so a single-sample event reads as
    // ~one probe cycle rather than "0s".
    let intervalMs = 8000;
    if (n > 1) {
      const deltas = [];
      for (let i = 1; i < n; i++) deltas.push(rows[i].created_at - rows[i - 1].created_at);
      deltas.sort((a, b) => a - b);
      intervalMs = deltas[Math.floor(deltas.length / 2)] || 8000;
    }
    allEvents.forEach((e) => {
      e.duration_ms = (e.end - e.start) + intervalMs;
      e.type = e.down > 0 ? 'Outage' : 'Degraded';
    });
    // An event is worth listing if it was an outage, sustained (>=minEventMs),
    // had real packet loss (>=5%), or spiked hard (>=1.5x the latency threshold).
    // Everything else is a brief blip — counted, but not table clutter.
    const significant = (e) =>
      e.down > 0 || e.duration_ms >= minEventMs || e.max_loss >= 5 || e.worst_latency >= latencyThreshold * 1.5;
    const events = allEvents.filter(significant);
    const minorCount = allEvents.length - events.length;
    const longestOutage = events.filter((e) => e.type === 'Outage').reduce((m, e) => Math.max(m, e.duration_ms), 0);

    // Downsample avg latency for the trend chart (~180 points; null when down).
    const targetPoints = 180;
    const step = Math.max(1, Math.ceil(n / targetPoints));
    const series = [];
    for (let i = 0; i < n; i += step) {
      const r = rows[i];
      series.push({ ts: r.created_at, avg_latency: alive(r) && r.avg_latency != null ? Number(r.avg_latency) : null });
    }

    // Full per-sample log for the period (oldest first), bounded so the PDF
    // stays openable; the CSV export remains the complete unbounded record.
    const LOG_CAP = 25000;
    const num = (v) => (v != null ? Number(v) : null);
    const log = (includeLog ? rows.slice(0, LOG_CAP) : []).map((r) => ({
      ts: r.created_at,
      alive: alive(r) ? 1 : 0,
      min: num(r.min_latency),
      avg: num(r.avg_latency),
      max: num(r.max_latency),
      jitter: num(r.jitter),
      loss: num(r.packet_loss),
    }));

    res.json({
      generated_at: Date.now(),
      latency_threshold: latencyThreshold,
      jitter_threshold: jitterThreshold,
      outages_only: outagesOnly,
      target: {
        id: target.id,
        name: target.name,
        ip: target.ip,
        source_ip: resolveSourceIp(target.interface),
        group: target.group,
        interface_alias: target.interface_alias || null,
      },
      period: {
        from: rows.length ? rows[0].created_at : (from ? new Date(from).getTime() : null),
        to: rows.length ? rows[n - 1].created_at : (to ? new Date(to).getTime() : null),
      },
      summary: {
        samples: n,
        up: upCount,
        down: n - upCount,
        uptime_pct: n ? (upCount / n) * 100 : null,
        avg_latency: mean(latencies),
        min_latency: mins.length ? Math.min(...mins) : null,
        max_latency: maxs.length ? Math.max(...maxs) : null,
        median_latency: median(latencies),
        avg_jitter: mean(jitters),
        packet_loss_pct: totalSent ? (1 - totalRecv / totalSent) * 100 : null,
        event_count: events.length,
        outage_count: events.filter((e) => e.type === 'Outage').length,
        degraded_count: events.filter((e) => e.type === 'Degraded').length,
        minor_count: minorCount,
        longest_outage_ms: longestOutage,
      },
      events: events.slice(0, 500),
      events_truncated: events.length > 500,
      series,
      log,
      log_total: n,
      log_truncated: n > LOG_CAP,
    });
  } catch (err) {
    console.error('[Routes/export] GET /:id/log-report:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
