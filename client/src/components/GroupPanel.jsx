import { useState } from 'react';
import UnifiedChart from './UnifiedChart';
import HostPill from './HostPill';

const CHART_MIN = 90;

/**
 * One group panel, designed to fill a react-grid-layout widget:
 *   1. Metric toggle + up/down counts (compact control row)
 *   2. Mini UnifiedChart scoped to this group (fills available height)
 *   3. Wrapped HostPill list
 *
 * Sizing is driven by the parent widget via `fillHeight` (the measured content
 * height of the widget) — no internal resize handle or column-span buttons; the
 * widget itself is dragged/resized by react-grid-layout.
 *
 * Props:
 *   groupName        – display name (shown by the widget header, kept here for context)
 *   targets          – target objects in this group
 *   lastPingResults  – { [targetId]: pingResult }
 *   colorMap         – { [targetId]: color }
 *   fillHeight       – measured widget content height (px); chart fills what's left
 *   showName         – render the group name inline (default false; widget header shows it)
 */
export default function GroupPanel({
  groupName,
  targets = [],
  lastPingResults = {},
  colorMap = {},
  fillHeight = 220,
  showName = false,
}) {
  const [groupSelectedIds, setGroupSelectedIds] = useState([]);
  const [selectedMetric, setSelectedMetric] = useState('latency');

  function handlePillClick(targetId) {
    setGroupSelectedIds(prev =>
      prev.includes(targetId)
        ? prev.filter(id => id !== targetId)
        : [...prev, targetId]
    );
  }

  const chartTargets = groupSelectedIds.length > 0
    ? targets.filter(t => groupSelectedIds.includes(t.id))
    : targets;

  const aliases = [...new Set(targets.map(t => t.interface_alias).filter(Boolean))];
  const sharedAlias = aliases.length === 1 ? aliases[0] : null;

  const upCount = targets.filter(t => {
    const r = lastPingResults[t.id];
    return r?.is_alive === true || r?.is_alive === 1;
  }).length;
  const downCount = targets.filter(t => {
    const r = lastPingResults[t.id];
    return r?.is_alive === false || r?.is_alive === 0;
  }).length;

  return (
    <div className="flex flex-col gap-2 min-w-0 h-full">
      {/* ── Control row ── */}
      <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
        {showName && <span className="text-sm font-semibold text-white truncate">{groupName}</span>}
        {sharedAlias && (
          <span className="text-xs bg-teal-900/50 text-teal-300 border border-teal-800 px-2 py-0.5 rounded-full flex-shrink-0">
            ↑ {sharedAlias}
          </span>
        )}
        <span className="ml-auto text-xs flex items-center gap-2">
          {upCount > 0 && (
            <span className="flex items-center gap-1 text-green-400">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
              {upCount} up
            </span>
          )}
          {downCount > 0 && (
            <span className="flex items-center gap-1 text-red-400">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse inline-block" />
              {downCount} down
            </span>
          )}
          {upCount === 0 && downCount === 0 && (
            <span className="text-gray-500">{targets.length} targets</span>
          )}
          <span className="flex items-center gap-0.5 ml-1 border border-gray-700 rounded-md overflow-hidden">
            {[
              { key: 'latency', label: 'Latency' },
              { key: 'jitter', label: 'Jitter' },
              { key: 'packet_loss', label: 'Loss' },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setSelectedMetric(tab.key)}
                aria-pressed={selectedMetric === tab.key}
                className={`px-1.5 py-0.5 text-xs transition-colors ${
                  selectedMetric === tab.key
                    ? 'bg-blue-700 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </span>
        </span>
      </div>

      {/* ── Mini chart (fills available height) ── */}
      <div className="min-w-0 flex-1 min-h-0">
        <UnifiedChart
          targets={chartTargets}
          lastPingResults={lastPingResults}
          colorMap={colorMap}
          fillHeight
          bare
          singleMetric={selectedMetric}
        />
      </div>

      {/* ── Host pills ── */}
      <div className="flex flex-wrap justify-center gap-2 flex-shrink-0 max-h-24 overflow-auto">
        {targets.map(target => (
          <HostPill
            key={target.id}
            target={target}
            lastPingResult={lastPingResults[target.id]}
            isSelected={groupSelectedIds.includes(target.id)}
            onTargetClick={handlePillClick}
          />
        ))}
      </div>
    </div>
  );
}
