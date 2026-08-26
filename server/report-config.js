'use strict';

/**
 * PDF availability-report settings (persisted in config.yaml under `report`).
 *   detailed_log      include the full per-sample log table in the PDF
 *   latency_threshold ms above which a sample counts as degraded / is highlighted
 *   jitter_threshold  ms above which a sample counts as degraded (0 = disabled)
 *   outages_only      only detect/list outages; skip latency/jitter/loss degradation
 */
const REPORT_DEFAULTS = {
  detailed_log: true,
  latency_threshold: 100,
  jitter_threshold: 0,
  outages_only: false,
};

function clampNum(v, def, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}

function normalizeReportConfig(raw = {}) {
  return {
    detailed_log: raw.detailed_log !== undefined ? !!raw.detailed_log : REPORT_DEFAULTS.detailed_log,
    latency_threshold: clampNum(raw.latency_threshold, REPORT_DEFAULTS.latency_threshold, 1, 100000),
    jitter_threshold: clampNum(raw.jitter_threshold, REPORT_DEFAULTS.jitter_threshold, 0, 100000),
    outages_only: !!raw.outages_only,
  };
}

module.exports = { REPORT_DEFAULTS, normalizeReportConfig };
