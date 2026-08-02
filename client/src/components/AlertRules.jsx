import { useEffect, useState } from 'react';
import { ShieldAlert, ChevronDown, ChevronUp } from 'lucide-react';
import { getAlertRules, getTargets } from '../lib/api';
import { cn } from '../lib/utils';

const SEVERITY_STYLES = {
  critical: 'bg-red-900/40 text-red-400 border-red-800',
  warning:  'bg-yellow-900/40 text-yellow-400 border-yellow-800',
  info:     'bg-blue-900/40 text-blue-400 border-blue-800',
};

const OPERATOR_LABELS = {
  include: 'Include',
  exclude: 'Exclude',
};

export default function AlertRules() {
  const [rules, setRules] = useState([]);
  const [targets, setTargets] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getAlertRules(), getTargets()])
      .then(([r, t]) => {
        setRules(r);
        setTargets(t);
      })
      .catch(e => console.error('Failed to load alert rules:', e))
      .finally(() => setLoading(false));
  }, []);

  function toggleExpand(ruleName) {
    setExpanded(prev => (prev === ruleName ? null : ruleName));
  }

  function getAppliesTo(rule) {
    if (!Array.isArray(rule.targets) || rule.targets.length === 0) {
      return 'All targets';
    }
    const op = OPERATOR_LABELS[rule.targets_operator] || 'Include';
    return `${op}: ${rule.targets.join(', ')}`;
  }

  if (loading) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="text-center py-6 text-gray-500 text-sm">Loading alert rules…</div>
      </div>
    );
  }

  if (rules.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="text-center py-6 text-gray-500 text-sm">No alert rules configured.</div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800">
        <ShieldAlert size={16} className="text-gray-400" />
        <h2 className="text-sm font-semibold text-gray-200">Alert Rules</h2>
        <span className="ml-1 text-xs text-gray-500">({rules.length} rules)</span>
      </div>

      <div className="divide-y divide-gray-800">
        {rules.map(rule => {
          const isOpen = expanded === rule.name;
          const severityStyle = SEVERITY_STYLES[rule.severity] || SEVERITY_STYLES.info;
          const isExclude = rule.targets_operator === 'exclude';

          // Which targets this rule applies to
          const listedTargets = Array.isArray(rule.targets) && rule.targets.length > 0
            ? targets.filter(t =>
                rule.targets.some(
                  rt => String(rt) === String(t.id) || rt === t.name || rt === t.ip
                )
              )
            : null; // null means "all"

          return (
            <div key={rule.name}>
              <button
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-800/40 transition-colors text-left"
                onClick={() => toggleExpand(rule.name)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white">{rule.name}</span>
                    <span className={cn('text-xs border px-2 py-0.5 rounded-full', severityStyle)}>
                      {rule.severity}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 font-mono">{rule.condition}</p>
                </div>

                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-xs text-gray-400 hidden sm:block">
                    Applies to:{' '}
                    <span className="text-gray-200">{getAppliesTo(rule)}</span>
                  </span>
                  {isOpen ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
                </div>
              </button>

              {isOpen && (
                <div className="px-4 pb-4 bg-gray-800/20">
                  <div className="pt-3 space-y-3">
                    <div className="flex flex-wrap gap-4 text-xs text-gray-400">
                      <span>Condition: <code className="text-blue-300 bg-gray-800 px-1 py-0.5 rounded">{rule.condition}</code></span>
                      <span>Cooldown: <span className="text-gray-200">{rule.cooldown ?? 300}s</span></span>
                      <span>Trigger after: <span className="text-gray-200">{rule.trigger_after ?? 1} cycle(s)</span></span>
                      <span>Severity: <span className="text-gray-200">{rule.severity}</span></span>
                    </div>

                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">
                          Target Assignment
                        </p>
                        {listedTargets && (
                          <span className={cn(
                            'text-xs border px-2 py-0.5 rounded-full',
                            isExclude
                              ? 'bg-orange-900/40 text-orange-400 border-orange-800'
                              : 'bg-blue-900/40 text-blue-400 border-blue-700',
                          )}>
                            {isExclude ? 'Exclude' : 'Include'}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border',
                            !listedTargets
                              ? 'bg-blue-900/50 text-blue-300 border-blue-700'
                              : 'bg-gray-800 text-gray-400 border-gray-700',
                          )}
                        >
                          <span className={cn('w-1.5 h-1.5 rounded-full', !listedTargets ? 'bg-blue-400' : 'bg-gray-600')} />
                          All targets
                        </span>
                        {targets.map(t => {
                          const inList = listedTargets
                            ? listedTargets.some(at => at.id === t.id)
                            : false;
                          // active = receives this alert
                          const active = listedTargets
                            ? (isExclude ? !inList : inList)
                            : true;
                          return (
                            <span
                              key={t.id}
                              className={cn(
                                'inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border',
                                active
                                  ? 'bg-blue-900/50 text-blue-300 border-blue-700'
                                  : 'bg-gray-800 text-gray-500 border-gray-700 opacity-50'
                              )}
                            >
                              <span className={cn('w-1.5 h-1.5 rounded-full', active ? 'bg-blue-400' : 'bg-gray-600')} />
                              {t.name}
                            </span>
                          );
                        })}
                      </div>
                      <p className="text-xs text-gray-600 mt-2">
                        To change target assignments, use the <strong className="text-gray-500">Settings → Alert Rules</strong> panel or edit the <code className="text-gray-500">targets</code> and <code className="text-gray-500">targets_operator</code> fields in <code className="text-gray-500">config.yaml</code>.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
