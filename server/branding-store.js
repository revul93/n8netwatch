'use strict';

/**
 * Company-logo store for report branding. The logo is optional; it is kept as a
 * base64 data URL in a single file under the data directory (gitignored, so it
 * persists across updates and is never committed). If no logo is set, getLogo()
 * returns null and reports simply omit it.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.n8watch_DATA_DIR
  ? path.resolve(process.env.n8watch_DATA_DIR)
  : path.join(__dirname, '..', 'data');

const LOGO_PATH = path.join(DATA_DIR, 'branding-logo.txt');

function getLogo() {
  try {
    const v = fs.readFileSync(LOGO_PATH, 'utf8').trim();
    return v || null;
  } catch {
    return null;
  }
}

function setLogo(dataUrl) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LOGO_PATH, dataUrl, 'utf8');
}

function clearLogo() {
  try {
    fs.unlinkSync(LOGO_PATH);
  } catch {
    /* already absent */
  }
}

module.exports = { getLogo, setLogo, clearLogo };
