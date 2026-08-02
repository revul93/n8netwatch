import { useState, useEffect, useCallback } from 'react';
import {
  Lock, LogOut, Plus, Trash2, Save, RefreshCw, ChevronDown, ChevronUp,
  Server, Wifi, Bell, Mail, Settings2, Target, Shield, Eye, Gauge, Play
} from 'lucide-react';
import {
  adminHasPassword, adminLogin, adminLogout, adminVerify, adminGetConfig,
  adminSaveTargets, adminAddTarget, adminDeleteTarget,
  adminSaveInterfaces, adminSaveAlertRules, adminSaveSmtp,
  adminSaveServer, adminSaveGeneral, adminSaveSecurity, adminSaveDashboard,
  adminSaveSpeedtest, adminRunSpeedtest, getSpeedtestTools, getInterfaces,
} from '../lib/api';
import { cn } from '../lib/utils';

// ── Token persistence ─────────────────────────────────────────────────────────
const TOKEN_KEY = 'admin_token';
function storeToken(t) { if (t) sessionStorage.setItem(TOKEN_KEY, t); else sessionStorage.removeItem(TOKEN_KEY); }
function readToken()   { return sessionStorage.getItem(TOKEN_KEY); }

// ── IP / hostname validation ──────────────────────────────────────────────────
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
// Simplified but reasonably strict IPv6: groups of 1-4 hex digits separated by colons,
// with an optional '::' shorthand. Covers the most common forms.
const IPV6_RE = /^([\da-fA-F]{1,4}:){7}[\da-fA-F]{1,4}$|^([\da-fA-F]{1,4}:)*::?([\da-fA-F]{1,4}:)*[\da-fA-F]{0,4}$/;
const HOST_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

function isValidIpOrHost(value) {
  if (!value || !value.trim()) return false;
  const v = value.trim();
  if (IPV4_RE.test(v)) {
    return v.split('.').every(n => /^\d+$/.test(n) && parseInt(n, 10) <= 255);
  }
  if (v.includes(':') && IPV6_RE.test(v)) return true;
  return HOST_RE.test(v);
}

// ── Alert condition field/metric/operator options ─────────────────────────────
const ALERT_METRIC_OPTIONS = [
  { value: 'packet_loss',  label: 'Packet Loss' },
  { value: 'avg_latency',  label: 'Avg Latency' },
  { value: 'jitter',       label: 'Jitter' },
  { value: 'is_alive',     label: 'Is Alive' },
  { value: 'min_latency',  label: 'Min Latency' },
  { value: 'max_latency',  label: 'Max Latency' },
];

const ALERT_OPERATOR_OPTIONS = [
  { value: '==', label: '==' },
  { value: '>',  label: '>'  },
  { value: '<',  label: '<'  },
  { value: '>=', label: '>=' },
  { value: '<=', label: '<=' },
  { value: '!=', label: '!=' },
];

function parseCondition(condition) {
  if (!condition) return { metric: 'packet_loss', operator: '>', value: '' };
  const match = condition.trim().match(/^(\w+)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (!match) return { metric: 'packet_loss', operator: '>', value: '' };
  return { metric: match[1], operator: match[2], value: match[3].trim() };
}

// ── Shared form field ─────────────────────────────────────────────────────────
function Field({ label, type = 'text', value, onChange, placeholder, required, className, error }) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {label && (
        <label className="text-xs text-gray-400">{label}{required && <span className="text-red-400 ml-0.5">*</span>}</label>
      )}
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          'px-3 py-2 bg-gray-800 border rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500',
          error ? 'border-red-500' : 'border-gray-700',
        )}
      />
      {error && <span className="text-red-400 text-xs">{error}</span>}
    </div>
  );
}

// ── Select field (dropdown) ───────────────────────────────────────────────────
function SelectField({ label, value, onChange, options, placeholder, required, className }) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {label && (
        <label className="text-xs text-gray-400">{label}{required && <span className="text-red-400 ml-0.5">*</span>}</label>
      )}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <div
        className={cn(
          'relative w-10 h-6 rounded-full transition-colors',
          checked ? 'bg-blue-600' : 'bg-gray-700',
        )}
        onClick={() => onChange(!checked)}
      >
        <div className={cn(
          'absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform',
          checked ? 'translate-x-5' : 'translate-x-1',
        )} />
      </div>
      <span className="text-sm text-gray-300">{label}</span>
    </label>
  );
}

function SectionCard({ icon: Icon, title, children }) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-800 bg-gray-800/40">
        <Icon size={16} className="text-blue-400" />
        <h2 className="text-sm font-semibold text-gray-200">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function SaveBar({ saving, saved, error, onSave }) {
  return (
    <div className="flex items-center gap-3 mt-4">
      <button
        onClick={onSave}
        disabled={saving}
        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
      >
        {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
      {saved && <span className="text-green-400 text-xs">✓ Saved</span>}
      {error && <span className="text-red-400 text-xs">{error}</span>}
    </div>
  );
}

// ── Login form ─────────────────────────────────────────────────────────────────
function LoginForm({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [noPassword, setNoPassword] = useState(false);

  useEffect(() => {
    adminHasPassword().then(has => { if (!has) setNoPassword(true); }).catch(() => {});
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { token } = await adminLogin(password);
      storeToken(token);
      onLogin(token);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (noPassword) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 w-full max-w-sm text-center">
          <Lock size={32} className="mx-auto mb-4 text-yellow-400" />
          <h2 className="text-lg font-semibold mb-2">Admin Password Not Set</h2>
          <p className="text-gray-400 text-sm">
            Run <code className="bg-gray-800 px-1.5 py-0.5 rounded text-xs">npm run set-password</code> on the
            server to configure the admin password before accessing the Settings panel.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 w-full max-w-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center">
            <Lock size={18} className="text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Admin Login</h2>
            <p className="text-xs text-gray-400">Settings panel is password protected</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="Enter admin password"
            required
          />
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button
            type="submit"
            disabled={loading || !password}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            {loading ? 'Logging in…' : 'Log In'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── System Targets section ────────────────────────────────────────────────────
function TargetsSection({ config, token, onConfigRefresh }) {
  const [targets, setTargets]   = useState([]);
  const [newTarget, setNewTarget] = useState({ name: '', ip: '', group: '', interface: '' });
  const [ipErrors, setIpErrors] = useState({});
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [error, setError]       = useState('');

  const ifaceOptions = (config?.interfaces || []).map(f => ({
    value: f.name,
    label: f.alias ? `${f.name} — ${f.alias}` : f.name,
  }));

  useEffect(() => {
    if (config?.targets) setTargets(config.targets.map(t => ({ ...t })));
  }, [config]);

  const updateTarget = (i, field, value) => {
    setTargets(prev => prev.map((t, idx) => idx === i ? { ...t, [field]: value } : t));
    if (field === 'ip') {
      setIpErrors(prev => ({ ...prev, [i]: value && !isValidIpOrHost(value) ? 'Enter a valid IP address or hostname' : '' }));
    }
  };

  const handleSave = async () => {
    // Validate all IPs before saving
    const errors = {};
    targets.forEach((t, i) => {
      if (t.ip && !isValidIpOrHost(t.ip)) errors[i] = 'Enter a valid IP address or hostname';
    });
    if (Object.keys(errors).length > 0) { setIpErrors(errors); setError('Fix validation errors before saving'); return; }
    setSaving(true); setError(''); setSaved(false);
    try {
      await adminSaveTargets(token, targets);
      setSaved(true);
      onConfigRefresh();
      setTimeout(() => setSaved(false), 3000);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const handleAdd = async () => {
    if (!newTarget.name.trim() || !newTarget.ip.trim()) {
      setError('Name and IP are required for a new target');
      return;
    }
    if (!isValidIpOrHost(newTarget.ip)) {
      setError('Enter a valid IP address or hostname');
      return;
    }
    setSaving(true); setError('');
    try {
      await adminAddTarget(token, newTarget);
      setNewTarget({ name: '', ip: '', group: '', interface: '' });
      onConfigRefresh();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (index) => {
    setSaving(true); setError('');
    try {
      await adminDeleteTarget(token, index);
      onConfigRefresh();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  return (
    <SectionCard icon={Target} title="System Targets">
      <div className="flex flex-col gap-3">
        {/* Column headers */}
        <div className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 px-0.5">
          <span className="text-xs text-gray-400">Name<span className="text-red-400 ml-0.5">*</span></span>
          <span className="text-xs text-gray-400">IP / Host<span className="text-red-400 ml-0.5">*</span></span>
          <span className="text-xs text-gray-400">Group</span>
          <span className="text-xs text-gray-400">Interface</span>
          <span />
        </div>

        {targets.map((t, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 items-end">
            <Field value={t.name} onChange={v => updateTarget(i, 'name', v)} placeholder="Google DNS" required />
            <Field
              value={t.ip}
              onChange={v => updateTarget(i, 'ip', v)}
              placeholder="8.8.8.8"
              required
              error={ipErrors[i]}
            />
            <Field value={t.group || ''} onChange={v => updateTarget(i, 'group', v)} placeholder="DNS Servers" />
            <SelectField
              value={t.interface || ''}
              onChange={v => updateTarget(i, 'interface', v)}
              options={ifaceOptions}
              placeholder="— any —"
            />
            <button onClick={() => handleDelete(i)} className="mb-0.5 p-2 text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded transition-colors" title="Remove">
              <Trash2 size={15} />
            </button>
          </div>
        ))}

        <div className="mt-2 pt-3 border-t border-gray-800">
          <p className="text-xs text-gray-500 mb-2 font-medium">Add New Target</p>
          <div className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 items-end">
            <Field label="Name" value={newTarget.name} onChange={v => setNewTarget(p => ({ ...p, name: v }))} placeholder="My Server" required />
            <Field label="IP / Host" value={newTarget.ip} onChange={v => setNewTarget(p => ({ ...p, ip: v }))} placeholder="192.168.1.10" required />
            <Field label="Group" value={newTarget.group} onChange={v => setNewTarget(p => ({ ...p, group: v }))} placeholder="Servers" />
            <SelectField
              label="Interface"
              value={newTarget.interface}
              onChange={v => setNewTarget(p => ({ ...p, interface: v }))}
              options={ifaceOptions}
              placeholder="— any —"
            />
            <button onClick={handleAdd} disabled={saving} className="mb-0.5 p-2 text-green-400 hover:text-green-300 hover:bg-green-900/20 rounded transition-colors" title="Add target">
              <Plus size={15} />
            </button>
          </div>
        </div>

        <SaveBar saving={saving} saved={saved} error={error} onSave={handleSave} />
      </div>
    </SectionCard>
  );
}

// ── Interfaces section ────────────────────────────────────────────────────────
function InterfacesSection({ config, token, onConfigRefresh }) {
  const [ifaces, setIfaces]   = useState([]);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [error, setError]     = useState('');

  useEffect(() => {
    if (config) setIfaces((config.interfaces || []).map(i => ({ ...i })));
  }, [config]);

  const update = (i, field, value) => setIfaces(prev => prev.map((f, idx) => idx === i ? { ...f, [field]: value } : f));
  const addRow  = () => setIfaces(prev => [...prev, { name: '', alias: '', ipv4: '' }]);
  const remove  = (i) => setIfaces(prev => prev.filter((_, idx) => idx !== i));

  const handleSave = async () => {
    setSaving(true); setError(''); setSaved(false);
    try {
      await adminSaveInterfaces(token, ifaces);
      setSaved(true);
      onConfigRefresh();
      setTimeout(() => setSaved(false), 3000);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  return (
    <SectionCard icon={Wifi} title="Network Interfaces">
      <div className="flex flex-col gap-3">
        {/* Column headers */}
        {ifaces.length > 0 && (
          <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 px-0.5">
            <span className="text-xs text-gray-400">Interface Name<span className="text-red-400 ml-0.5">*</span></span>
            <span className="text-xs text-gray-400">Alias</span>
            <span className="text-xs text-gray-400">IPv4 Address</span>
            <span />
          </div>
        )}
        {ifaces.map((f, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
            <Field value={f.name} onChange={v => update(i, 'name', v)} placeholder="eth0" required />
            <Field value={f.alias || ''} onChange={v => update(i, 'alias', v)} placeholder="Primary LAN" />
            <Field value={f.ipv4 || ''} onChange={v => update(i, 'ipv4', v)} placeholder="192.168.1.1" />
            <button onClick={() => remove(i)} className="mb-0.5 p-2 text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded transition-colors"><Trash2 size={15} /></button>
          </div>
        ))}
        <button onClick={addRow} className="flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300 mt-1 w-fit">
          <Plus size={13} /> Add Interface
        </button>
        <SaveBar saving={saving} saved={saved} error={error} onSave={handleSave} />
      </div>
    </SectionCard>
  );
}

// ── Alert rules section ───────────────────────────────────────────────────────
function AlertRulesSection({ config, token, onConfigRefresh }) {
  const [rules, setRules]   = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [error, setError]   = useState('');

  const availableTargets = config?.targets || [];

  useEffect(() => {
    if (config?.alerts?.rules) setRules(config.alerts.rules.map(r => ({ ...r })));
  }, [config]);

  const update = (i, field, value) => setRules(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));

  const updateConditionPart = (i, part, val) => {
    const parts = parseCondition(rules[i].condition);
    parts[part] = val;
    const { metric, operator, value } = parts;
    update(i, 'condition', metric && value !== '' ? `${metric} ${operator} ${value}` : '');
  };

  const updateTargetScope = (i, mode) => {
    setRules(prev => prev.map((r, idx) => {
      if (idx !== i) return r;
      if (mode === 'all') {
        const { targets: _t, targets_operator: _op, ...rest } = r;
        return rest;
      }
      return { ...r, targets_operator: mode, targets: r.targets || [] };
    }));
  };

  const toggleTarget = (i, targetName) => {
    setRules(prev => prev.map((r, idx) => {
      if (idx !== i) return r;
      const current = r.targets || [];
      const exists = current.includes(targetName);
      return { ...r, targets: exists ? current.filter(t => t !== targetName) : [...current, targetName] };
    }));
  };

  const addRow  = () => setRules(prev => [...prev, { name: '', condition: `${ALERT_METRIC_OPTIONS[0].value} ${ALERT_OPERATOR_OPTIONS[1].value} 0`, severity: 'warning', cooldown: 300 }]);
  const remove  = (i) => setRules(prev => prev.filter((_, idx) => idx !== i));

  const handleSave = async () => {
    setSaving(true); setError(''); setSaved(false);
    try {
      await adminSaveAlertRules(token, rules);
      setSaved(true);
      onConfigRefresh();
      setTimeout(() => setSaved(false), 3000);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const inputCls = 'px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500';

  return (
    <SectionCard icon={Bell} title="Alert Rules">
      <div className="flex flex-col gap-3">
        {rules.map((r, i) => {
          const { metric, operator, value } = parseCondition(r.condition);
          const scope = r.targets_operator || 'all';
          const hasTargetFilter = scope !== 'all';
          return (
            <div key={i} className="p-3 bg-gray-800/40 border border-gray-700/60 rounded-lg flex flex-col gap-3">
              {/* Row 1: Name + Severity + Cooldown + Trigger After + Delete */}
              <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 items-end">
                <Field label="Rule Name" value={r.name} onChange={v => update(i, 'name', v)} placeholder="Host Down" required />
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-400">Severity</label>
                  <select
                    value={r.severity || 'warning'}
                    onChange={e => update(i, 'severity', e.target.value)}
                    className={inputCls}
                  >
                    <option value="critical">critical</option>
                    <option value="warning">warning</option>
                    <option value="info">info</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-400">Cooldown (s)</label>
                  <input
                    type="number"
                    value={r.cooldown ?? 300}
                    onChange={e => update(i, 'cooldown', parseInt(e.target.value, 10) || 300)}
                    className={cn(inputCls, 'w-24')}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label
                    className="text-xs text-gray-400"
                    title="Number of consecutive ping cycles the condition must hold before the alert fires (default 1)"
                  >
                    Trigger after
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={r.trigger_after ?? 1}
                    onChange={e => update(i, 'trigger_after', Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className={cn(inputCls, 'w-24')}
                    title="Consecutive triggering cycles required before alerting. 1 = alert immediately."
                  />
                </div>
                <button
                  onClick={() => remove(i)}
                  className="mb-0.5 p-2 text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded transition-colors"
                  title="Remove rule"
                >
                  <Trash2 size={15} />
                </button>
              </div>

              {/* Row 2: Condition builder — Metric + Operator + Value */}
              <div className="flex flex-wrap gap-2 items-end">
                <div className="flex flex-col gap-1 flex-1 min-w-32">
                  <label className="text-xs text-gray-400">Metric</label>
                  <select
                    value={metric}
                    onChange={e => updateConditionPart(i, 'metric', e.target.value)}
                    className={inputCls}
                  >
                    {ALERT_METRIC_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-400">Operator</label>
                  <select
                    value={operator}
                    onChange={e => updateConditionPart(i, 'operator', e.target.value)}
                    className={cn(inputCls, 'w-20')}
                  >
                    {ALERT_OPERATOR_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1 flex-1 min-w-24">
                  <label className="text-xs text-gray-400">Value</label>
                  <input
                    type="number"
                    value={value}
                    onChange={e => updateConditionPart(i, 'value', e.target.value)}
                    placeholder="100"
                    className={inputCls}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-400">Preview</label>
                  <div className="px-3 py-2 bg-gray-800/50 border border-gray-700/40 rounded text-xs text-gray-400 font-mono whitespace-nowrap h-[38px] flex items-center">
                    {r.condition || '—'}
                  </div>
                </div>
              </div>

              {/* Row 3: Target scope */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <label className="text-xs text-gray-400 shrink-0">Applies to:</label>
                  <select
                    value={scope}
                    onChange={e => updateTargetScope(i, e.target.value)}
                    className={cn(inputCls, 'w-44')}
                  >
                    <option value="all">All targets</option>
                    <option value="include">Include specific targets</option>
                    <option value="exclude">Exclude specific targets</option>
                  </select>
                </div>
                {hasTargetFilter && availableTargets.length > 0 && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5 pl-1">
                    {availableTargets.map(t => (
                      <label key={t.name} className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={(r.targets || []).includes(t.name)}
                          onChange={() => toggleTarget(i, t.name)}
                          className="rounded border-gray-600 bg-gray-800 accent-blue-500"
                        />
                        {t.name}
                      </label>
                    ))}
                  </div>
                )}
                {hasTargetFilter && availableTargets.length === 0 && (
                  <p className="text-xs text-gray-500 pl-1">No system targets defined.</p>
                )}
              </div>
            </div>
          );
        })}
        <button onClick={addRow} className="flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300 mt-1 w-fit">
          <Plus size={13} /> Add Rule
        </button>
        <SaveBar saving={saving} saved={saved} error={error} onSave={handleSave} />
      </div>
    </SectionCard>
  );
}

// ── SMTP section ──────────────────────────────────────────────────────────────
function SmtpSection({ config, token, onConfigRefresh }) {
  const alerts = config?.alerts || {};
  const smtp   = alerts.smtp || {};

  const [enabled, setEnabled] = useState(alerts.email_notifications !== false);
  const [host, setHost]       = useState(smtp.host || '');
  const [port, setPort]       = useState(smtp.port ?? 587);
  const [secure, setSecure]   = useState(smtp.secure || false);
  const [user, setUser]       = useState(smtp.user || '');
  const [pass, setPass]       = useState(smtp.pass || '');
  const [from, setFrom]       = useState(smtp.from || '');
  const [to, setTo]           = useState((smtp.to || []).join(', '));
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [error, setError]     = useState('');

  useEffect(() => {
    if (!config) return;
    const a = config.alerts || {};
    const s = a.smtp || {};
    setEnabled(a.email_notifications !== false);
    setHost(s.host || '');
    setPort(s.port ?? 587);
    setSecure(s.secure || false);
    setUser(s.user || '');
    setPass(s.pass || '');
    setFrom(s.from || '');
    setTo((s.to || []).join(', '));
  }, [config]);

  const handleSave = async () => {
    setSaving(true); setError(''); setSaved(false);
    try {
      const toList = to.split(',').map(s => s.trim()).filter(Boolean);
      await adminSaveSmtp(token, {
        email_notifications: enabled,
        smtp: { host, port: parseInt(port, 10) || 587, secure, user, pass, from, to: toList },
      });
      setSaved(true);
      onConfigRefresh();
      setTimeout(() => setSaved(false), 3000);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  return (
    <SectionCard icon={Mail} title="SMTP / Email Notifications">
      <div className="flex flex-col gap-4">
        <Toggle label="Enable email notifications" checked={enabled} onChange={setEnabled} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="SMTP Host" value={host} onChange={setHost} placeholder="smtp.gmail.com" />
          <Field label="Port" type="number" value={port} onChange={setPort} placeholder="587" />
        </div>
        <Toggle label="Use TLS (secure)" checked={secure} onChange={setSecure} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Username" value={user} onChange={setUser} placeholder="you@gmail.com" />
          <Field label="Password / App Password" type="password" value={pass} onChange={setPass} placeholder="••••••••" />
        </div>
        <Field label="From address" value={from} onChange={setFrom} placeholder='n8watch <monitor@yourdomain.com>' />
        <Field label="To addresses (comma-separated)" value={to} onChange={setTo} placeholder="admin@yourdomain.com, ops@yourdomain.com" />
        <SaveBar saving={saving} saved={saved} error={error} onSave={handleSave} />
      </div>
    </SectionCard>
  );
}

// ── Server settings section ───────────────────────────────────────────────────
function ServerSection({ config, token, onConfigRefresh }) {
  const server  = config?.server  || {};
  const general = config?.general || {};

  const [port, setPort]           = useState(server.port || 3000);
  const [host, setHost]           = useState(server.host || '0.0.0.0');
  const [pingInterval, setPingInterval] = useState(general.ping_interval || 30);
  const [pingCount, setPingCount]       = useState(general.ping_count || 5);
  const [pingTimeout, setPingTimeout]   = useState(general.ping_timeout || 5);
  const [pingConcurrency, setPingConcurrency] = useState(general.ping_concurrency ?? 0);
  const [retentionDays, setRetentionDays] = useState(general.data_retention_days || 90);
  const [maxLifetime, setMaxLifetime]   = useState(general.max_user_target_lifetime_days || 7);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [error, setError]   = useState('');

  useEffect(() => {
    if (!config) return;
    const s = config.server  || {};
    const g = config.general || {};
    setPort(s.port || 3000);
    setHost(s.host || '0.0.0.0');
    setPingInterval(g.ping_interval || 30);
    setPingCount(g.ping_count || 5);
    setPingTimeout(g.ping_timeout || 5);
    setPingConcurrency(g.ping_concurrency ?? 0);
    setRetentionDays(g.data_retention_days || 90);
    setMaxLifetime(g.max_user_target_lifetime_days || 7);
  }, [config]);

  const handleSave = async () => {
    setSaving(true); setError(''); setSaved(false);
    try {
      await adminSaveServer(token, { port: parseInt(port, 10), host });
      await adminSaveGeneral(token, {
        ping_interval: parseInt(pingInterval, 10),
        ping_count: parseInt(pingCount, 10),
        ping_timeout: parseInt(pingTimeout, 10),
        ping_concurrency: parseInt(pingConcurrency, 10) || 0,
        data_retention_days: parseInt(retentionDays, 10),
        max_user_target_lifetime_days: parseInt(maxLifetime, 10),
      });
      setSaved(true);
      onConfigRefresh();
      setTimeout(() => setSaved(false), 3000);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  return (
    <SectionCard icon={Server} title="Server & General Settings">
      <div className="flex flex-col gap-4">
        <p className="text-xs text-yellow-400 bg-yellow-900/20 border border-yellow-800 rounded px-3 py-2">
          ⚠ Changes to port/host take effect after restarting n8watch.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Listen Port" type="number" value={port} onChange={setPort} placeholder="3000" />
          <Field label="Listen Host" value={host} onChange={setHost} placeholder="0.0.0.0" />
        </div>
        <hr className="border-gray-800" />
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Ping Settings</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Interval (s)" type="number" value={pingInterval} onChange={setPingInterval} placeholder="30" />
          <Field label="Packets per ping" type="number" value={pingCount} onChange={setPingCount} placeholder="5" />
          <Field label="Timeout (s)" type="number" value={pingTimeout} onChange={setPingTimeout} placeholder="5" />
          <div className="flex flex-col gap-1">
            <Field label="Concurrency (0 = unlimited)" type="number" value={pingConcurrency} onChange={setPingConcurrency} placeholder="0" />
            <span className="text-xs text-gray-500">Max parallel pings. Set to 0 to ping all targets simultaneously.</span>
          </div>
        </div>
        <hr className="border-gray-800" />
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Data Retention</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Data retention (days)" type="number" value={retentionDays} onChange={setRetentionDays} placeholder="90" />
          <Field label="Max user target lifetime (days)" type="number" value={maxLifetime} onChange={setMaxLifetime} placeholder="7" />
        </div>
        <SaveBar saving={saving} saved={saved} error={error} onSave={handleSave} />
      </div>
    </SectionCard>
  );
}

// ── Security section ──────────────────────────────────────────────────────────
function SecuritySection({ config, token, onConfigRefresh }) {
  const al = config?.security?.ip_allowlist || { enabled: false, entries: [] };

  const [enabled, setEnabled] = useState(al.enabled || false);
  const [entries, setEntries] = useState((al.entries || []).map(e => ({ ...e })));
  const [newAddress, setNewAddress] = useState('');
  const [newAllowAdmin, setNewAllowAdmin] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [error, setError]     = useState('');

  useEffect(() => {
    if (!config) return;
    const a = config.security?.ip_allowlist || { enabled: false, entries: [] };
    setEnabled(a.enabled || false);
    setEntries((a.entries || []).map(e => ({ ...e })));
  }, [config]);

  const removeEntry = (i) => setEntries(prev => prev.filter((_, idx) => idx !== i));
  const toggleAdmin = (i) => setEntries(prev => prev.map((e, idx) => idx === i ? { ...e, allow_admin: !e.allow_admin } : e));

  const addEntry = () => {
    const addr = newAddress.trim();
    if (!addr) { setError('Address is required'); return; }
    setEntries(prev => [...prev, { address: addr, allow_admin: newAllowAdmin }]);
    setNewAddress('');
    setNewAllowAdmin(false);
    setError('');
  };

  const handleSave = async () => {
    setSaving(true); setError(''); setSaved(false);
    try {
      await adminSaveSecurity(token, { ip_allowlist: { enabled, entries } });
      setSaved(true);
      onConfigRefresh();
      setTimeout(() => setSaved(false), 3000);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  return (
    <SectionCard icon={Shield} title="Security — IP Allowlist">
      <div className="flex flex-col gap-4">
        <Toggle label="Enable IP allowlist" checked={enabled} onChange={setEnabled} />
        <p className="text-xs text-blue-300 bg-blue-900/20 border border-blue-800 rounded px-3 py-2">
          ℹ localhost (127.0.0.1 / ::1) is <strong>always allowed</strong> regardless of this setting, so you can never lock yourself out.
        </p>

        {entries.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-0.5">
              <span className="text-xs text-gray-400">Address (IP, CIDR, or range)</span>
              <span className="text-xs text-gray-400 text-center w-24">Allow Admin</span>
              <span />
            </div>
            {entries.map((e, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
                <div className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 font-mono truncate">{e.address}</div>
                <div className="flex justify-center w-24">
                  <input
                    type="checkbox"
                    checked={!!e.allow_admin}
                    onChange={() => toggleAdmin(i)}
                    className="w-4 h-4 accent-blue-500 cursor-pointer"
                  />
                </div>
                <button onClick={() => removeEntry(i)} className="p-2 text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded transition-colors" title="Remove">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="pt-2 border-t border-gray-800">
          <p className="text-xs text-gray-500 mb-2 font-medium">Add Entry</p>
          <div className="flex gap-2 items-end flex-wrap">
            <div className="flex flex-col gap-1 flex-1 min-w-48">
              <label className="text-xs text-gray-400">Address <span className="text-gray-600">(e.g. 192.168.1.0/24, 10.0.0.5, 10.0.0.1-10.0.0.50)</span></label>
              <input
                type="text"
                value={newAddress}
                onChange={e => setNewAddress(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addEntry()}
                placeholder="192.168.1.0/24"
                className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-300 pb-2 cursor-pointer">
              <input
                type="checkbox"
                checked={newAllowAdmin}
                onChange={e => setNewAllowAdmin(e.target.checked)}
                className="w-4 h-4 accent-blue-500"
              />
              Allow Admin
            </label>
            <button
              onClick={addEntry}
              className="flex items-center gap-2 px-3 py-2 text-xs text-blue-400 hover:text-blue-300 border border-blue-800 hover:bg-blue-900/20 rounded transition-colors mb-0.5"
            >
              <Plus size={13} /> Add
            </button>
          </div>
        </div>

        <SaveBar saving={saving} saved={saved} error={error} onSave={handleSave} />
      </div>
    </SectionCard>
  );
}

// ── Dashboard View section ────────────────────────────────────────────────────
function ViewSection({ config, token, onConfigRefresh }) {
  const vis = config?.dashboard?.visibility || {};

  const [summary,   setSummary]   = useState(vis.summary    !== false);
  const [chart,     setChart]     = useState(vis.chart      !== false);
  const [groups,    setGroups]    = useState(vis.groups     !== false);
  const [hosts,     setHosts]     = useState(vis.hosts      !== false);
  const [speedtest, setSpeedtest] = useState(vis.speedtest  !== false);
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);
  const [error, setError]         = useState('');

  useEffect(() => {
    if (!config) return;
    const v = config.dashboard?.visibility || {};
    setSummary(v.summary    !== false);
    setChart(v.chart        !== false);
    setGroups(v.groups      !== false);
    setHosts(v.hosts        !== false);
    setSpeedtest(v.speedtest !== false);
  }, [config]);

  const handleSave = async () => {
    setSaving(true); setError(''); setSaved(false);
    try {
      await adminSaveDashboard(token, { visibility: { summary, chart, groups, hosts, speedtest } });
      setSaved(true);
      onConfigRefresh();
      setTimeout(() => setSaved(false), 3000);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  return (
    <SectionCard icon={Eye} title="Dashboard Visibility">
      <div className="flex flex-col gap-4">
        <p className="text-xs text-gray-500">
          Control which sections are shown on the main dashboard. Changes take effect immediately for all connected clients.
        </p>
        <div className="flex flex-col gap-3">
          <Toggle label="Summary Cards (up/down counts, avg latency…)" checked={summary}   onChange={setSummary} />
          <Toggle label="Network Chart (latency / packet-loss over time)" checked={chart}   onChange={setChart} />
          <Toggle label="Internet Speed Chart (download / upload)"       checked={speedtest} onChange={setSpeedtest} />
          <Toggle label="Groups (grouped target overview)"               checked={groups}   onChange={setGroups} />
          <Toggle label="Host Cards (individual target cards)"           checked={hosts}    onChange={setHosts} />
        </div>
        <SaveBar saving={saving} saved={saved} error={error} onSave={handleSave} />
      </div>
    </SectionCard>
  );
}

// ── Speedtest section ─────────────────────────────────────────────────────────
function SpeedtestSection({ config, token, onConfigRefresh }) {
  const st = config?.speedtest || {};

  const [enabled,   setEnabled]   = useState(st.enabled  || false);
  const [interval,  setInterval_] = useState(st.interval || 3600);
  const [iface,     setIface]     = useState(st.interface || '');
  const [tool,      setTool]      = useState(st.tool      || 'speedtest');
  const [show,      setShow]      = useState(st.show      || 'both');
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [error,     setError]     = useState('');
  const [runResult, setRunResult] = useState(null);
  const [running,   setRunning]   = useState(false);

  // Available tools & interfaces
  const [tools, setTools]       = useState({ speedtest: null, fast: null }); // null = unknown
  const [interfaces, setIfaces] = useState([]);

  useEffect(() => {
    getSpeedtestTools()
      .then(t => setTools(t))
      .catch(() => {});
    getInterfaces()
      .then(list => setIfaces(list || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!config) return;
    const s = config.speedtest || {};
    setEnabled(s.enabled  || false);
    setInterval_(s.interval || 3600);
    setIface(s.interface   || '');
    setTool(s.tool         || 'speedtest');
    setShow(s.show         || 'both');
  }, [config]);

  const handleSave = async () => {
    const iv = parseInt(interval, 10);
    if (isNaN(iv) || iv < 60) { setError('Interval must be at least 60 seconds'); return; }
    setSaving(true); setError(''); setSaved(false);
    try {
      await adminSaveSpeedtest(token, {
        enabled,
        interval: iv,
        interface: iface,
        tool,
        show,
      });
      setSaved(true);
      onConfigRefresh();
      setTimeout(() => setSaved(false), 3000);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const handleRunNow = async () => {
    setRunning(true); setRunResult(null); setError('');
    try {
      const { result } = await adminRunSpeedtest(token);
      setRunResult(result);
    } catch (err) {
      setError(err.message || 'Speed test failed');
    } finally {
      setRunning(false);
    }
  };

  const toolLabel = (name) => {
    if (tools[name] === null) return name === 'speedtest' ? 'speedtest-cli' : 'fast-cli';
    return tools[name]
      ? (name === 'speedtest' ? 'speedtest-cli ✓' : 'fast-cli ✓')
      : (name === 'speedtest' ? 'speedtest-cli (not installed)' : 'fast-cli (not installed)');
  };

  const ifaceOptions = [
    { value: '', label: '— system default —' },
    ...interfaces.map(f => ({ value: f.name, label: f.alias ? `${f.name} — ${f.alias}` : f.name })),
  ];

  return (
    <SectionCard icon={Gauge} title="Internet Speedtest">
      <div className="flex flex-col gap-4">
        <p className="text-xs text-gray-500">
          Periodically measures download and upload speed using <code className="bg-gray-800 px-1 rounded">speedtest-cli</code> and/or <code className="bg-gray-800 px-1 rounded">fast-cli</code>.
          Install the tools globally on the server before enabling.
        </p>

        <Toggle label="Enable periodic speed tests" checked={enabled} onChange={setEnabled} />

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Test interval (seconds, min 60)</label>
            <input
              type="number"
              value={interval}
              onChange={e => setInterval_(e.target.value)}
              min={60}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            />
          </div>

          <SelectField
            label="Outgoing interface"
            value={iface}
            onChange={setIface}
            options={ifaceOptions}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Tool</label>
            <select
              value={tool}
              onChange={e => setTool(e.target.value)}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            >
              <option value="speedtest">{toolLabel('speedtest')}</option>
              <option value="fast">{toolLabel('fast')}</option>
              <option value="both">Both (average of speedtest-cli + fast-cli)</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Show on dashboard</label>
            <select
              value={show}
              onChange={e => setShow(e.target.value)}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            >
              <option value="both">Download + Upload</option>
              <option value="download">Download only</option>
              <option value="upload">Upload only</option>
            </select>
          </div>
        </div>

        <SaveBar saving={saving} saved={saved} error={error} onSave={handleSave} />

        <hr className="border-gray-800" />

        {/* Run Now */}
        <div className="flex flex-col gap-2">
          <p className="text-xs text-gray-400 font-medium">Manual Test</p>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={handleRunNow}
              disabled={running || !enabled}
              title={!enabled ? 'Enable speedtest first' : 'Run a speed test immediately'}
              className="flex items-center gap-2 px-4 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors"
            >
              {running
                ? <RefreshCw size={14} className="animate-spin" />
                : <Play size={14} />}
              {running ? 'Running…' : 'Run Test Now'}
            </button>
            {runResult && (
              <span className="text-xs text-green-400">
                ↓ {runResult.download != null ? `${runResult.download} Mbps` : '—'}
                {'  '}↑ {runResult.upload != null ? `${runResult.upload} Mbps` : '—'}
              </span>
            )}
          </div>
          {!enabled && (
            <p className="text-xs text-gray-500">Enable speedtest and save before running a manual test.</p>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

// ── Tab bar ───────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'targets',    label: 'Targets',    icon: Target  },
  { id: 'interfaces', label: 'Interfaces', icon: Wifi    },
  { id: 'rules',      label: 'Alert Rules',icon: Bell    },
  { id: 'smtp',       label: 'SMTP',       icon: Mail    },
  { id: 'server',     label: 'Server',     icon: Server  },
  { id: 'security',   label: 'Security',   icon: Shield  },
  { id: 'speedtest',  label: 'Speedtest',  icon: Gauge   },
  { id: 'view',       label: 'View',       icon: Eye     },
];

// ── Main Settings page ────────────────────────────────────────────────────────
export default function Settings() {
  const [token, setToken]     = useState(() => readToken());
  const [config, setConfig]   = useState(null);
  const [activeTab, setActiveTab] = useState('targets');
  const [loading, setLoading] = useState(false);

  const handleLogin = (tok) => { setToken(tok); };

  const fetchConfig = useCallback(async (tok) => {
    if (!tok) return;
    setLoading(true);
    try {
      const cfg = await adminGetConfig(tok);
      setConfig(cfg);
    } catch (err) {
      if (err.message.includes('401') || err.message.includes('Unauthorized')) {
        storeToken(null);
        setToken(null);
      }
    } finally { setLoading(false); }
  }, []);

  // On mount: verify existing session token
  useEffect(() => {
    if (!token) return;
    adminVerify(token)
      .then(() => fetchConfig(token))
      .catch(() => { storeToken(null); setToken(null); });
  }, [token, fetchConfig]);

  const handleLogout = async () => {
    try { await adminLogout(token); } catch (_) {}
    storeToken(null);
    setToken(null);
    setConfig(null);
  };

  if (!token) return <LoginForm onLogin={handleLogin} />;

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="text-sm text-gray-400 mt-0.5">Manage system configuration — changes are saved to config.yaml</p>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
        >
          <LogOut size={15} />
          Log out
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors flex-1 justify-center',
              activeTab === id
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-800',
            )}
          >
            <Icon size={14} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <RefreshCw size={14} className="animate-spin" /> Loading config…
        </div>
      )}

      {config && (
        <>
          {activeTab === 'targets'    && <TargetsSection    config={config} token={token} onConfigRefresh={() => fetchConfig(token)} />}
          {activeTab === 'interfaces' && <InterfacesSection config={config} token={token} onConfigRefresh={() => fetchConfig(token)} />}
          {activeTab === 'rules'      && <AlertRulesSection config={config} token={token} onConfigRefresh={() => fetchConfig(token)} />}
          {activeTab === 'smtp'       && <SmtpSection       config={config} token={token} onConfigRefresh={() => fetchConfig(token)} />}
          {activeTab === 'server'     && <ServerSection     config={config} token={token} onConfigRefresh={() => fetchConfig(token)} />}
          {activeTab === 'security'   && <SecuritySection   config={config} token={token} onConfigRefresh={() => fetchConfig(token)} />}
          {activeTab === 'speedtest'  && <SpeedtestSection  config={config} token={token} onConfigRefresh={() => fetchConfig(token)} />}
          {activeTab === 'view'       && <ViewSection       config={config} token={token} onConfigRefresh={() => fetchConfig(token)} />}
        </>
      )}
    </div>
  );
}
