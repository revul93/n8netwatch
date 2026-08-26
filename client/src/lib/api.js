const BASE = '/api';

function toMs(val) {
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'number') return val;
  const n = Number(val);
  if (!isNaN(n)) return n;
  const d = new Date(val);
  if (!isNaN(d.getTime())) return d.getTime();
  return undefined;
}

async function request(path, params) {
  const url = new URL(BASE + path, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) {
        const coerced = (k === 'from' || k === 'to') ? toMs(v) : v;
        if (coerced !== undefined) url.searchParams.set(k, coerced);
      }
    });
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

export function getTargets() {
  return request('/targets').then(res => res.targets || []);
}

export function getTarget(id) {
  return request(`/targets/${id}`).then(res => res.target || res);
}

export function getPingResults(targetId, params) {
  return request(`/targets/${targetId}/ping-results`, params);
}

export function getLatestPingResults() {
  return request('/ping-results/latest').then(res => res.rows || []);
}

export function getMetrics(targetId, params) {
  return request(`/targets/${targetId}/metrics`, params).then(res => res.metrics || []);
}

export function getUptime(targetId) {
  return request(`/targets/${targetId}/uptime`);
}

export function getSystemStatus() {
  return request('/dashboard/system');
}

export function getDashboardSummary() {
  return request('/dashboard/summary').then(res => res.summary || res);
}

export function getAlerts(params) {
  return request('/alerts', params);
}

export function getActiveAlerts() {
  return request('/alerts/active').then(res => res.alerts || []);
}

export function getAlertRules() {
  return request('/alerts/rules').then(res => res.rules || []);
}

export function getExportUrl(targetId, from, to) {
  const url = new URL(`/api/targets/${targetId}/export`, window.location.origin);
  if (from) url.searchParams.set('from', toMs(from));
  if (to) url.searchParams.set('to', toMs(to));
  return url.toString();
}

export function getReportData(targetId) {
  return request(`/targets/${targetId}/report`);
}

// Availability-report data (summary + latency series + problem events) for the PDF.
// opts: { latencyThreshold, jitterThreshold, outagesOnly, includeLog }
export function getLogReportData(targetId, from, to, opts = {}) {
  const { latencyThreshold, jitterThreshold, outagesOnly, includeLog } = opts;
  return request(`/targets/${targetId}/log-report`, {
    from,
    to,
    latencyThreshold,
    jitterThreshold,
    outagesOnly: outagesOnly ? 1 : undefined,
    includeLog: includeLog === false ? 0 : undefined,
  });
}

// Company logo (data URL) for report branding; null if none uploaded.
export function getBrandingLogo() {
  return request('/branding/logo').then(res => res.dataUrl || null);
}

// PDF report settings (thresholds/toggles) configured by the admin. Public read.
export function getReportConfig() {
  return request('/branding/report-config');
}

export function adminSaveReportConfig(token, data) {
  return adminRequest('/config/report', 'PUT', data, token);
}

export function getInterfaces() {
  return request('/interfaces').then(res => res.interfaces || []);
}

export function getDashboardConfig() {
  return request('/dashboard/config');
}

export function getVersion() {
  return request('/version');
}

export function addUserTarget(name, ip, iface, ifaceAlias, lifetimeDays) {
  return fetch(`${BASE}/targets/user-targets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      ip,
      interface: iface || undefined,
      interface_alias: ifaceAlias || undefined,
      lifetime_days: lifetimeDays,
    }),
  }).then(async res => {
    if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
    return res.json();
  });
}

export function deleteUserTarget(id) {
  return fetch(`${BASE}/targets/user-targets/${id}`, { method: 'DELETE' }).then(async res => {
    if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
    return res.json();
  });
}

export function getExpiredTargets() {
  return request('/targets/expired').then(res => res.targets || []);
}

// ── Admin API ─────────────────────────────────────────────────────────────────

function adminRequest(path, method = 'GET', body = undefined, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(`${BASE}/admin${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).then(async res => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  });
}

export function adminHasPassword() {
  return adminRequest('/has-password').then(r => r.hasPassword);
}

export function adminLogin(password) {
  return adminRequest('/login', 'POST', { password });
}

export function adminLogout(token) {
  return adminRequest('/logout', 'POST', undefined, token);
}

export function adminVerify(token) {
  return adminRequest('/verify', 'GET', undefined, token);
}

export function adminGetConfig(token) {
  return adminRequest('/config', 'GET', undefined, token).then(r => r.config);
}

export function adminSaveTargets(token, targets) {
  return adminRequest('/config/targets', 'PUT', { targets }, token);
}

export function adminAddTarget(token, target) {
  return adminRequest('/config/targets', 'POST', target, token);
}

export function adminDeleteTarget(token, index) {
  return adminRequest(`/config/targets/${index}`, 'DELETE', undefined, token);
}

export function adminSaveInterfaces(token, interfaces) {
  return adminRequest('/config/interfaces', 'PUT', { interfaces }, token);
}

export function adminSaveAlertRules(token, rules) {
  return adminRequest('/config/alerts/rules', 'PUT', { rules }, token);
}

export function adminSaveSmtp(token, data) {
  return adminRequest('/config/alerts/smtp', 'PUT', data, token);
}

export function adminSaveServer(token, data) {
  return adminRequest('/config/server', 'PUT', data, token);
}

export function adminSaveGeneral(token, data) {
  return adminRequest('/config/general', 'PUT', data, token);
}

export function adminSaveSecurity(token, data) {
  return adminRequest('/config/security', 'PUT', data, token);
}

export function adminSaveDashboard(token, data) {
  return adminRequest('/config/dashboard', 'PUT', data, token);
}

export function adminSaveSpeedtest(token, data) {
  return adminRequest('/config/speedtest', 'PUT', data, token);
}

export function adminRunSpeedtest(token) {
  return adminRequest('/speedtest/run', 'POST', undefined, token);
}

export function adminUploadLogo(token, dataUrl) {
  return adminRequest('/config/branding/logo', 'POST', { dataUrl }, token);
}

export function adminDeleteLogo(token) {
  return adminRequest('/config/branding/logo', 'DELETE', undefined, token);
}

// ── Speedtest API ─────────────────────────────────────────────────────────────

export function getSpeedtestResults(params) {
  return request('/speedtest/results', params).then(res => res.results || []);
}

export function getLatestSpeedtestResult() {
  return request('/speedtest/latest').then(res => res.result || null);
}

export function getSpeedtestTools() {
  return request('/speedtest/tools');
}
