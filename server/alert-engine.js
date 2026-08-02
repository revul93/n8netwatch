'use strict';

const { evaluateCondition } = require('./utils/condition-parser');
const { calculateDowntime } = require('./utils/helpers');

let _db          = null;
let _wss         = null;
let _emailSvc    = null;
let _rules       = [];

// cooldownMap: "targetId-ruleName" -> timestamp of last alert sent
const cooldownMap = new Map();

// streakMap: "targetId-ruleName" -> number of consecutive ping cycles the rule's
// condition has evaluated true. Drives the `trigger_after` behaviour so a rule
// only fires once its condition has held for N cycles in a row (default 1).
const streakMap = new Map();

// Severity ordering — higher number = higher priority
const SEVERITY_ORDER = { critical: 3, warning: 2, info: 1, low: 0 };

function getSeverityLevel(severity) {
  return SEVERITY_ORDER[String(severity).toLowerCase()] ?? 0;
}

/**
 * getTriggerAfter - how many consecutive triggering ping cycles are required
 * before a rule fires. Configured per-rule via `trigger_after` (preferred) or
 * its alias `occurrences`. Defaults to 1 (fire on the first triggering cycle),
 * which preserves the original behaviour. Invalid values fall back to 1.
 *
 * @param {object} rule
 * @returns {number} integer >= 1
 */
function getTriggerAfter(rule) {
  const raw = rule.trigger_after ?? rule.occurrences ?? 1;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function initAlertEngine(db, wss, emailService, config) {
  _db       = db;
  _wss      = wss;
  _emailSvc = emailService;
  _rules    = (config.alerts && config.alerts.rules) ? config.alerts.rules : [];

  console.log(`[AlertEngine] Initialized with ${_rules.length} rule(s)`);
}

/**
 * processAlerts - evaluate all rules against the latest ping result for a target.
 *
 * @param {{ id: number, name: string, ip: string }} target
 * @param {object} pingResult  - metrics from the ping engine
 */
async function processAlerts(target, pingResult) {
  if (!_db || _rules.length === 0) return;

  // Skip user-defined temporary targets — no alerts applied to them
  if (target.is_user_target) return;

  const metrics = {
    is_alive:         pingResult.is_alive ? 1 : 0,
    packet_loss:      pingResult.packet_loss      ?? 100,
    avg_latency:      pingResult.avg_latency      ?? 0,
    min_latency:      pingResult.min_latency      ?? 0,
    max_latency:      pingResult.max_latency      ?? 0,
    jitter:           pingResult.jitter           ?? 0,
    packets_sent:     pingResult.packets_sent     ?? 0,
    packets_received: pingResult.packets_received ?? 0,
  };

  // Collect all applicable rules that are triggered for this target
  const triggeredRules = [];
  for (const rule of _rules) {
    // Apply target filtering when a targets list is specified
    if (Array.isArray(rule.targets) && rule.targets.length > 0) {
      const targetMatch = rule.targets.some(
        t => String(t) === String(target.id) || t === target.name || t === target.ip
      );
      const operator = rule.targets_operator === 'exclude' ? 'exclude' : 'include';
      if (operator === 'exclude') {
        // Skip this target if it is in the exclusion list
        if (targetMatch) continue;
      } else {
        // Skip this target if it is NOT in the inclusion list
        if (!targetMatch) continue;
      }
    }

    // Track how many consecutive cycles this rule's condition has held for this
    // target. The rule only counts as "triggered" once that streak reaches its
    // `trigger_after` threshold — a single transient loss no longer alerts.
    const streakKey    = `${target.id}-${rule.name}`;
    const conditionMet = evaluateCondition(rule.condition, metrics);

    if (conditionMet) {
      const streak = (streakMap.get(streakKey) || 0) + 1;
      streakMap.set(streakKey, streak);
      if (streak >= getTriggerAfter(rule)) {
        triggeredRules.push(rule);
      }
    } else {
      // Condition cleared — reset the consecutive counter so the next episode
      // starts fresh (the threshold counts consecutive cycles, not lifetime).
      streakMap.delete(streakKey);
    }
  }

  if (triggeredRules.length === 0) return;

  // Determine the highest severity level among all triggered rules
  const highestLevel = triggeredRules.reduce(
    (max, rule) => Math.max(max, getSeverityLevel(rule.severity)),
    -1
  );

  // Only process rules at the highest severity — lower-severity rules are suppressed
  const rulesAtHighestSeverity = triggeredRules.filter(
    rule => getSeverityLevel(rule.severity) === highestLevel
  );

  const now = Date.now();

  for (const rule of rulesAtHighestSeverity) {
    const cooldownKey = `${target.id}-${rule.name}`;
    const cooldownSec = rule.cooldown || 300;
    const lastAlerted = cooldownMap.get(cooldownKey) || 0;

    if (now - lastAlerted < cooldownSec * 1000) continue;

    cooldownMap.set(cooldownKey, now);

    const alertId = _db.insertAlert({
      target_id:  target.id,
      rule_name:  rule.name,
      severity:   rule.severity,
      condition:  rule.condition,
      message:    `Rule "${rule.name}" triggered for ${target.name} (${target.ip})`,
      created_at: now,
    });

    const alertPayload = {
      id:          alertId,
      target_id:   target.id,
      target_name: target.name,
      target_ip:   target.ip,
      rule_name:   rule.name,
      severity:    rule.severity,
      condition:   rule.condition,
      metrics,
      created_at:  now,
    };

    if (_wss) {
      const { broadcast } = require('./websocket');
      broadcast('alert', alertPayload);
    }

    if (_emailSvc) {
      await _emailSvc.sendAlertEmail(target, rule, metrics).catch((err) =>
        console.error('[AlertEngine] Email error:', err.message)
      );
    }

    console.log(`[AlertEngine] Alert fired: ${rule.name} for ${target.name} (${target.ip})`);
  }
}

/**
 * checkRecovery - re-evaluate conditions for all open alerts on this target.
 * Clears any alert whose condition is no longer true.
 *
 * @param {{ id: number, name: string, ip: string }} target
 * @param {object} pingResult
 */
async function checkRecovery(target, pingResult) {
  if (!_db) return;

  // Skip user-defined temporary targets — no alerts applied to them
  if (target.is_user_target) return;

  const metrics = {
    is_alive:         pingResult.is_alive ? 1 : 0,
    packet_loss:      pingResult.packet_loss      ?? 100,
    avg_latency:      pingResult.avg_latency      ?? 0,
    min_latency:      pingResult.min_latency       ?? 0,
    max_latency:      pingResult.max_latency       ?? 0,
    jitter:           pingResult.jitter            ?? 0,
    packets_sent:     pingResult.packets_sent      ?? 0,
    packets_received: pingResult.packets_received  ?? 0,
  };

  const activeAlerts = _db.getActiveAlerts().filter(
    (a) => a.target_id === target.id
  );

  if (activeAlerts.length === 0) return;

  const now = Date.now();
  for (const alert of activeAlerts) {
    // Find the rule that originally triggered this alert
    const rule = _rules.find(r => r.name === alert.rule_name);

    // If the rule no longer exists OR the condition is no longer triggered, resolve
    const stillTriggered = rule ? evaluateCondition(rule.condition, metrics) : false;
    if (stillTriggered) continue;

    _db.resolveAlert(alert.id, now);

    const downtime = calculateDowntime(alert.created_at);

    const recoveryPayload = {
      alert_id:    alert.id,
      target_id:   target.id,
      target_name: target.name,
      target_ip:   target.ip,
      rule_name:   alert.rule_name,
      downtime_ms: downtime,
      resolved_at: now,
    };

    if (_wss) {
      const { broadcast } = require('./websocket');
      broadcast('recovery', recoveryPayload);
    }

    if (_emailSvc) {
      // Only send recovery email if the rule still exists in config; if the rule
      // was deleted we still resolve the alert but skip the email.
      if (rule) {
        await _emailSvc.sendRecoveryEmail(target, alert, downtime).catch((err) =>
          console.error('[AlertEngine] Recovery email error:', err.message)
        );
      }
    }

    console.log(`[AlertEngine] Recovery: alert "${alert.rule_name}" cleared for ${target.name} (${target.ip})`);
  }
}

module.exports = { initAlertEngine, processAlerts, checkRecovery };
