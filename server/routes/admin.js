'use strict';

const express = require('express');
const router  = express.Router();
const auth    = require('../auth');
const { getConfig, saveConfig } = require('../config');
const db = require('../database');
const { broadcast } = require('../websocket');
const branding = require('../branding-store');
const { normalizeReportConfig } = require('../report-config');

// ── Auth middleware ───────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!auth.verifySession(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.adminToken = token;
  next();
}

// ── Auth routes ───────────────────────────────────────────────────────────────

// GET /api/admin/has-password  — check whether a password has been configured
router.get('/has-password', (req, res) => {
  res.json({ hasPassword: auth.hasPassword() });
});

// POST /api/admin/login
router.post('/login', (req, res) => {
  const { password } = req.body || {};
  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'password is required' });
  }
  if (!auth.hasPassword()) {
    return res.status(503).json({ error: 'Admin password not configured. Run setup or set-password script.' });
  }
  if (!auth.checkPassword(password)) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  const token = auth.createSession();
  res.json({ token });
});

// POST /api/admin/logout
router.post('/logout', requireAuth, (req, res) => {
  auth.destroySession(req.adminToken);
  res.json({ success: true });
});

// GET /api/admin/verify  — check whether the token is still valid
router.get('/verify', requireAuth, (req, res) => {
  res.json({ valid: true });
});

// ── Config read ───────────────────────────────────────────────────────────────

// GET /api/admin/config  — return the full config (minus sensitive data masking)
router.get('/config', requireAuth, (req, res) => {
  try {
    const config = getConfig();
    res.json({ config });
  } catch (err) {
    console.error('[Admin] GET /config:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── System Targets ────────────────────────────────────────────────────────────

// PUT /api/admin/config/targets  — replace the full targets array
router.put('/config/targets', requireAuth, (req, res) => {
  try {
    const { targets } = req.body || {};
    if (!Array.isArray(targets) || targets.length === 0) {
      return res.status(400).json({ error: 'targets must be a non-empty array' });
    }
    for (const t of targets) {
      if (!t.name || typeof t.name !== 'string' || !t.name.trim()) {
        return res.status(400).json({ error: 'Each target must have a name' });
      }
      if (!t.ip || typeof t.ip !== 'string' || !t.ip.trim()) {
        return res.status(400).json({ error: 'Each target must have an ip' });
      }
    }
    const config = getConfig();
    config.targets = targets.map((t) => {
      const out = { name: t.name.trim(), ip: t.ip.trim() };
      if (t.group) out.group = t.group.trim();
      if (t.interface) out.interface = t.interface.trim();
      return out;
    });
    saveConfig(config);
    db.syncTargets(config.targets);
    broadcast('config_reloaded', { targets_count: config.targets.length });
    res.json({ success: true, targets: config.targets });
  } catch (err) {
    console.error('[Admin] PUT /config/targets:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/config/targets  — add a single system target
router.post('/config/targets', requireAuth, (req, res) => {
  try {
    const { name, ip, group, interface: iface } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!ip || typeof ip !== 'string' || !ip.trim()) {
      return res.status(400).json({ error: 'ip is required' });
    }
    const config = getConfig();
    const entry = { name: name.trim(), ip: ip.trim() };
    if (group) entry.group = group.trim();
    if (iface) entry.interface = iface.trim();
    config.targets = [...(config.targets || []), entry];
    saveConfig(config);
    db.syncTargets(config.targets);
    broadcast('config_reloaded', { targets_count: config.targets.length });
    res.status(201).json({ success: true, target: entry });
  } catch (err) {
    console.error('[Admin] POST /config/targets:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/admin/config/targets/:index  — remove a system target by index
router.delete('/config/targets/:index', requireAuth, (req, res) => {
  try {
    const index = parseInt(req.params.index, 10);
    const config = getConfig();
    if (isNaN(index) || index < 0 || index >= (config.targets || []).length) {
      return res.status(404).json({ error: 'Target index out of range' });
    }
    if (config.targets.length === 1) {
      return res.status(400).json({ error: 'Cannot delete the last system target' });
    }
    config.targets = config.targets.filter((_, i) => i !== index);
    saveConfig(config);
    db.syncTargets(config.targets);
    broadcast('config_reloaded', { targets_count: config.targets.length });
    res.json({ success: true });
  } catch (err) {
    console.error('[Admin] DELETE /config/targets/:index:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Interfaces ────────────────────────────────────────────────────────────────

// PUT /api/admin/config/interfaces  — replace the full interfaces array
router.put('/config/interfaces', requireAuth, (req, res) => {
  try {
    const { interfaces } = req.body || {};
    if (!Array.isArray(interfaces)) {
      return res.status(400).json({ error: 'interfaces must be an array' });
    }
    for (const iface of interfaces) {
      if (!iface.name || typeof iface.name !== 'string' || !iface.name.trim()) {
        return res.status(400).json({ error: 'Each interface must have a name' });
      }
    }
    const config = getConfig();
    config.interfaces = interfaces.map((i) => {
      const out = { name: i.name.trim() };
      if (i.alias) out.alias = i.alias.trim();
      if (i.ipv4)  out.ipv4  = i.ipv4.trim();
      return out;
    });
    saveConfig(config);
    res.json({ success: true, interfaces: config.interfaces });
  } catch (err) {
    console.error('[Admin] PUT /config/interfaces:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Alert rules ───────────────────────────────────────────────────────────────

// PUT /api/admin/config/alerts/rules  — replace alert rules
router.put('/config/alerts/rules', requireAuth, (req, res) => {
  try {
    const { rules } = req.body || {};
    if (!Array.isArray(rules)) {
      return res.status(400).json({ error: 'rules must be an array' });
    }
    const config = getConfig();
    if (!config.alerts) config.alerts = {};
    config.alerts.rules = rules;
    saveConfig(config);
    res.json({ success: true, rules: config.alerts.rules });
  } catch (err) {
    console.error('[Admin] PUT /config/alerts/rules:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── SMTP settings ─────────────────────────────────────────────────────────────

// PUT /api/admin/config/alerts/smtp  — replace SMTP + email_notifications toggle
router.put('/config/alerts/smtp', requireAuth, (req, res) => {
  try {
    const { email_notifications, smtp } = req.body || {};
    const config = getConfig();
    if (!config.alerts) config.alerts = {};
    if (typeof email_notifications === 'boolean') {
      config.alerts.email_notifications = email_notifications;
    }
    if (smtp && typeof smtp === 'object') {
      config.alerts.smtp = smtp;
    }
    saveConfig(config);
    res.json({ success: true, alerts: config.alerts });
  } catch (err) {
    console.error('[Admin] PUT /config/alerts/smtp:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Server settings ───────────────────────────────────────────────────────────

// PUT /api/admin/config/server  — update server settings (port, host)
router.put('/config/server', requireAuth, (req, res) => {
  try {
    const { port, host } = req.body || {};
    const config = getConfig();
    if (port !== undefined) {
      const p = parseInt(port, 10);
      if (isNaN(p) || p < 1 || p > 65535) {
        return res.status(400).json({ error: 'port must be 1–65535' });
      }
      config.server.port = p;
    }
    if (host !== undefined) {
      if (typeof host !== 'string' || !host.trim()) {
        return res.status(400).json({ error: 'host must be a non-empty string' });
      }
      config.server.host = host.trim();
    }
    saveConfig(config);
    res.json({ success: true, server: config.server });
  } catch (err) {
    console.error('[Admin] PUT /config/server:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── General settings ──────────────────────────────────────────────────────────

// PUT /api/admin/config/general  — update general settings
router.put('/config/general', requireAuth, (req, res) => {
  try {
    const allowed = ['ping_interval', 'ping_count', 'ping_timeout', 'data_retention_days', 'max_user_target_lifetime_days', 'ping_concurrency'];
    const config = getConfig();
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        const v = parseInt(req.body[key], 10);
        if (key === 'ping_concurrency') {
          if (isNaN(v) || v < 0 || v > 1000) {
            return res.status(400).json({ error: `${key} must be between 0 and 1000 (0 = unlimited)` });
          }
        } else if (isNaN(v) || v < 1) {
          return res.status(400).json({ error: `${key} must be a positive integer` });
        }
        config.general[key] = v;
      }
    }
    saveConfig(config);
    res.json({ success: true, general: config.general });
  } catch (err) {
    console.error('[Admin] PUT /config/general:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Security settings ─────────────────────────────────────────────────────────
// Rate limiting is intentionally omitted: access is controlled by the IP
// allowlist middleware (apiFilter/adminFilter) mounted in index.js. Localhost
// is always allowed as a fail-safe, and these routes require a valid session
// token via requireAuth.

// PUT /api/admin/config/security  — update IP allowlist settings
router.put('/config/security', requireAuth, (req, res) => {
  try {
    const { ip_allowlist } = req.body || {};
    if (ip_allowlist === undefined) {
      return res.status(400).json({ error: 'ip_allowlist is required' });
    }
    if (typeof ip_allowlist !== 'object' || ip_allowlist === null) {
      return res.status(400).json({ error: 'ip_allowlist must be an object' });
    }
    if (ip_allowlist.entries !== undefined && !Array.isArray(ip_allowlist.entries)) {
      return res.status(400).json({ error: 'ip_allowlist.entries must be an array' });
    }
    const config = getConfig();
    if (!config.security) config.security = {};
    config.security.ip_allowlist = {
      enabled: typeof ip_allowlist.enabled === 'boolean' ? ip_allowlist.enabled : false,
      entries: Array.isArray(ip_allowlist.entries)
        ? ip_allowlist.entries.map(e => ({
            address:     String(e.address || '').trim(),
            allow_admin: typeof e.allow_admin === 'boolean' ? e.allow_admin : false,
          })).filter(e => e.address)
        : [],
    };
    saveConfig(config);
    res.json({ success: true, security: config.security });
  } catch (err) {
    console.error('[Admin] PUT /config/security:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Dashboard settings ────────────────────────────────────────────────────────

// PUT /api/admin/config/dashboard  — update dashboard visibility settings
router.put('/config/dashboard', requireAuth, (req, res) => {
  try {
    const { visibility } = req.body || {};
    if (!visibility || typeof visibility !== 'object') {
      return res.status(400).json({ error: 'visibility must be an object' });
    }
    const config = getConfig();
    if (!config.dashboard) config.dashboard = {};
    if (!config.dashboard.visibility) config.dashboard.visibility = {};
    for (const key of ['summary', 'chart', 'groups', 'hosts', 'speedtest']) {
      if (typeof visibility[key] === 'boolean') {
        config.dashboard.visibility[key] = visibility[key];
      }
    }
    saveConfig(config);
    broadcast('config_reloaded', {});
    res.json({ success: true, dashboard: config.dashboard });
  } catch (err) {
    console.error('[Admin] PUT /config/dashboard:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Speedtest settings ────────────────────────────────────────────────────────

// PUT /api/admin/config/speedtest  — update speedtest settings
router.put('/config/speedtest', requireAuth, (req, res) => {
  try {
    const { enabled, interval, interface: iface, tool, show } = req.body || {};
    const config = getConfig();
    if (!config.speedtest) config.speedtest = {};

    if (typeof enabled === 'boolean') {
      config.speedtest.enabled = enabled;
    }
    if (interval !== undefined) {
      const v = parseInt(interval, 10);
      if (isNaN(v) || v < 60) {
        return res.status(400).json({ error: 'interval must be at least 60 seconds' });
      }
      config.speedtest.interval = v;
    }
    if (iface !== undefined) {
      config.speedtest.interface = typeof iface === 'string' ? iface.trim() : '';
    }
    if (tool !== undefined) {
      if (!['speedtest', 'fast', 'both'].includes(tool)) {
        return res.status(400).json({ error: 'tool must be "speedtest", "fast", or "both"' });
      }
      config.speedtest.tool = tool;
    }
    if (show !== undefined) {
      if (!['download', 'upload', 'both'].includes(show)) {
        return res.status(400).json({ error: 'show must be "download", "upload", or "both"' });
      }
      config.speedtest.show = show;
    }

    saveConfig(config);
    broadcast('config_reloaded', {});
    res.json({ success: true, speedtest: config.speedtest });
  } catch (err) {
    console.error('[Admin] PUT /config/speedtest:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/speedtest/run  — trigger an immediate speed test
router.post('/speedtest/run', requireAuth, async (req, res) => {
  try {
    const { runSpeedtest } = require('../speedtest-engine');
    const { insertSpeedtestResult } = require('../database');
    const config = getConfig();

    if (!config.speedtest?.enabled) {
      return res.status(400).json({ error: 'Speedtest is disabled in config' });
    }

    const result = await runSpeedtest(config);
    const id = insertSpeedtestResult(result);
    broadcast('speedtest_result', { id, ...result });
    res.json({ success: true, result: { id, ...result } });
  } catch (err) {
    console.error('[Admin] POST /speedtest/run:', err.message);
    // Persist the failure so the chart shows an error marker
    try {
      const { insertSpeedtestResult } = require('../database');
      insertSpeedtestResult({ error: err.message, created_at: Date.now() });
    } catch (_) {}
    res.status(500).json({ error: err.message || 'Speed test failed' });
  }
});

// ── Branding: company logo for reports ─────────────────────────────────────────

// POST /api/admin/config/branding/logo  — upload/replace the logo (PNG or JPEG data URL)
router.post('/config/branding/logo', requireAuth, (req, res) => {
  try {
    const { dataUrl } = req.body || {};
    if (typeof dataUrl !== 'string' || !/^data:image\/(png|jpe?g);base64,/i.test(dataUrl)) {
      return res.status(400).json({ error: 'Provide a PNG or JPEG image (data URL).' });
    }
    if (dataUrl.length > 4_500_000) {
      return res.status(413).json({ error: 'Logo too large — please use an image under ~3 MB.' });
    }
    branding.setLogo(dataUrl);
    res.json({ success: true });
  } catch (err) {
    console.error('[Admin] POST /config/branding/logo:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/admin/config/branding/logo  — remove the logo
router.delete('/config/branding/logo', requireAuth, (req, res) => {
  try {
    branding.clearLogo();
    res.json({ success: true });
  } catch (err) {
    console.error('[Admin] DELETE /config/branding/logo:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/config/report  — PDF export report settings
router.put('/config/report', requireAuth, (req, res) => {
  try {
    const config = getConfig();
    config.report = normalizeReportConfig({ ...(config.report || {}), ...(req.body || {}) });
    saveConfig(config);
    res.json({ success: true, report: config.report });
  } catch (err) {
    console.error('[Admin] PUT /config/report:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
