'use strict';

const express = require('express');
const router  = express.Router();
const { getLogo } = require('../branding-store');
const { getConfig } = require('../config');
const { normalizeReportConfig } = require('../report-config');

// GET /api/branding/logo  — public; returns the company logo data URL or null.
router.get('/logo', (req, res) => {
  res.json({ dataUrl: getLogo() });
});

// GET /api/branding/report-config  — public; PDF report settings (thresholds,
// toggles) so the client can build the report with the admin-configured options.
router.get('/report-config', (req, res) => {
  let raw = {};
  try { raw = getConfig().report || {}; } catch { /* config unavailable */ }
  res.json(normalizeReportConfig(raw));
});

module.exports = router;
