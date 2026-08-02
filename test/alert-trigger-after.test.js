'use strict';

/**
 * Tests for the per-rule `trigger_after` alerting behaviour.
 *
 * A rule must see its condition hold for N consecutive ping cycles before it
 * fires. Run with: `npm test` or `node test/alert-trigger-after.test.js`.
 *
 * Uses only Node's built-in `assert` — no test framework dependency. The alert
 * engine's collaborators (db, websocket, email) are replaced with lightweight
 * mocks so the streak logic can be exercised deterministically.
 */

const assert = require('assert');
const path = require('path');

const { initAlertEngine, processAlerts } = require(
  path.join(__dirname, '..', 'server', 'alert-engine.js'),
);

// ── Mocks ────────────────────────────────────────────────────────────────────
let firedAlerts = [];
let alertSeq = 1;

const mockDb = {
  insertAlert(data) {
    const id = alertSeq++;
    firedAlerts.push({ id, ...data });
    return id;
  },
  getActiveAlerts() { return []; },
  resolveAlert() {},
};

const mockEmail = {
  async sendAlertEmail() {},
  async sendRecoveryEmail() {},
};

function configWithRule(rule) {
  return { alerts: { rules: [rule] } };
}

// Distinct target ids per case so the engine's module-level streak/cooldown
// maps don't leak state between tests.
function target(id) {
  return { id, name: `Target-${id}`, ip: `10.0.0.${id}`, is_user_target: 0 };
}

const DOWN = { is_alive: 0, packet_loss: 100, avg_latency: 0, min_latency: 0, max_latency: 0, jitter: 0, packets_sent: 2, packets_received: 0 };
const UP   = { is_alive: 1, packet_loss: 0,   avg_latency: 10, min_latency: 9, max_latency: 11, jitter: 1, packets_sent: 2, packets_received: 2 };

async function run() {
  // ── Test 1: trigger_after: 3 fires only on the 3rd consecutive failure ──────
  {
    firedAlerts = [];
    const t = target(1);
    initAlertEngine(mockDb, null, mockEmail, configWithRule({
      name: 'Host Down', condition: 'packet_loss == 100', severity: 'critical', cooldown: 0, trigger_after: 3,
    }));
    await processAlerts(t, DOWN);
    assert.strictEqual(firedAlerts.length, 0, 'no alert after 1 failure');
    await processAlerts(t, DOWN);
    assert.strictEqual(firedAlerts.length, 0, 'no alert after 2 failures');
    await processAlerts(t, DOWN);
    assert.strictEqual(firedAlerts.length, 1, 'alert fires on the 3rd consecutive failure');
    console.log('PASS: trigger_after=3 fires only on the 3rd consecutive failure');
  }

  // ── Test 2: a successful cycle resets the consecutive counter ───────────────
  {
    firedAlerts = [];
    const t = target(2);
    initAlertEngine(mockDb, null, mockEmail, configWithRule({
      name: 'Host Down', condition: 'packet_loss == 100', severity: 'critical', cooldown: 0, trigger_after: 3,
    }));
    await processAlerts(t, DOWN);
    await processAlerts(t, DOWN);
    await processAlerts(t, UP);    // resets streak
    await processAlerts(t, DOWN);
    await processAlerts(t, DOWN);
    assert.strictEqual(firedAlerts.length, 0, 'streak reset by success — still no alert');
    await processAlerts(t, DOWN);
    assert.strictEqual(firedAlerts.length, 1, 'alert fires after 3 consecutive post-reset');
    console.log('PASS: a successful ping resets the consecutive counter');
  }

  // ── Test 3: default (no trigger_after) fires on the first failure ───────────
  {
    firedAlerts = [];
    const t = target(3);
    initAlertEngine(mockDb, null, mockEmail, configWithRule({
      name: 'Host Down', condition: 'packet_loss == 100', severity: 'critical', cooldown: 0,
    }));
    await processAlerts(t, DOWN);
    assert.strictEqual(firedAlerts.length, 1, 'default behaviour fires immediately');
    console.log('PASS: default (no trigger_after) fires on first failure — backward compatible');
  }

  // ── Test 4: the `occurrences` alias behaves like trigger_after ──────────────
  {
    firedAlerts = [];
    const t = target(4);
    initAlertEngine(mockDb, null, mockEmail, configWithRule({
      name: 'Host Down', condition: 'packet_loss == 100', severity: 'critical', cooldown: 0, occurrences: 2,
    }));
    await processAlerts(t, DOWN);
    assert.strictEqual(firedAlerts.length, 0, 'no alert after 1 (occurrences=2)');
    await processAlerts(t, DOWN);
    assert.strictEqual(firedAlerts.length, 1, 'alert fires on 2nd (occurrences alias)');
    console.log('PASS: "occurrences" alias behaves the same as trigger_after');
  }

  // ── Test 5: invalid trigger_after falls back to 1 ───────────────────────────
  {
    firedAlerts = [];
    const t = target(5);
    initAlertEngine(mockDb, null, mockEmail, configWithRule({
      name: 'Host Down', condition: 'packet_loss == 100', severity: 'critical', cooldown: 0, trigger_after: 'oops',
    }));
    await processAlerts(t, DOWN);
    assert.strictEqual(firedAlerts.length, 1, 'invalid trigger_after falls back to 1');
    console.log('PASS: invalid trigger_after falls back to 1');
  }

  console.log('\nAll alert trigger_after tests passed.');
}

run().catch((err) => {
  console.error('TEST FAILED:', err && err.stack ? err.stack : err);
  process.exit(1);
});
