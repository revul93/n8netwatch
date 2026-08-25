import { useState, useEffect, useCallback, useRef } from 'react';
import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { format } from 'date-fns';
import TimeRangeSelector, { RANGES } from './TimeRangeSelector';
import { getMetrics } from '../lib/api';
import { cn } from '../lib/utils';

const COLORS = [
  '#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#a855f7',
  '#ec4899','#14b8a6','#84cc16','#6366f1','#f59e0b','#06b6d4',
  '#10b981','#8b5cf6','#f43f5e','#0ea5e9','#d946ef','#65a30d',
  '#dc2626','#2563eb',
];

const SWATCH_COLORS = [
  '#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#a855f7',
  '#ec4899','#14b8a6','#84cc16','#6366f1','#f59e0b','#06b6d4',
  '#10b981','#8b5cf6','#f43f5e','#0ea5e9','#d946ef','#65a30d',
  '#dc2626','#2563eb','#16a34a','#9333ea','#db2777','#0891b2',
];

/**
 * Build a stable color map from an ordered list of all targets (not just the
 * currently filtered subset). Colors are assigned by position in that master
 * list so they never shift when targets are filtered in or out.
 */
export function buildColorMap(allTargets) {
  const map = {};
  allTargets.forEach((t, i) => {
    map[t.id] = COLORS[i % COLORS.length];
  });
  return map;
}

function formatTick(ts) {
  if (!ts) return '';
  try { return format(new Date(ts), 'HH:mm'); } catch { return ''; }
}

function formatTooltipLabel(ts) {
  if (!ts) return '';
  try { return format(new Date(ts), 'MMM d HH:mm:ss'); } catch { return ts; }
}

/** Color picker popover anchored to a legend item */
function ColorPickerPopover({ targetId, currentColor, defaultColor, onColorChange, onClose, anchorRef }) {
  const [hexInput, setHexInput] = useState(currentColor);
  const popoverRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target) &&
        anchorRef.current && !anchorRef.current.contains(e.target)
      ) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, anchorRef]);

  function applyColor(color) {
    setHexInput(color);
    onColorChange(targetId, color);
  }

  function handleHexInput(val) {
    setHexInput(val);
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      onColorChange(targetId, val);
    }
  }

  return (
    <div
      ref={popoverRef}
      className="absolute z-50 mt-2 p-3 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl"
      style={{ minWidth: 200 }}
    >
      <div className="grid grid-cols-6 gap-1.5 mb-3">
        {SWATCH_COLORS.map(color => (
          <button
            key={color}
            onClick={() => applyColor(color)}
            className={`w-7 h-7 rounded-md cursor-pointer border-2 transition-all hover:scale-110 ${
              hexInput.toLowerCase() === color.toLowerCase()
                ? 'border-white'
                : 'border-transparent'
            }`}
            style={{ backgroundColor: color }}
            title={color}
          />
        ))}
      </div>
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-7 h-7 rounded-md border border-gray-600 flex-shrink-0"
          style={{ backgroundColor: /^#[0-9a-fA-F]{6}$/.test(hexInput) ? hexInput : currentColor }}
        />
        <input
          type="text"
          value={hexInput}
          onChange={e => handleHexInput(e.target.value)}
          maxLength={7}
          className="flex-1 px-2 py-1 text-xs bg-gray-800 border border-gray-700 rounded-lg text-white font-mono focus:outline-none focus:border-blue-600"
          placeholder="#000000"
        />
      </div>
      <button
        onClick={() => applyColor(defaultColor)}
        className="w-full text-xs text-gray-400 hover:text-white py-1 px-2 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors"
      >
        ↺ Reset to default
      </button>
    </div>
  );
}

/** Custom legend renderer with clickable color picker */
function CustomLegend({ payload, targets, colorMap, defaultColorMap, onColorChange }) {
  const [openTargetId, setOpenTargetId] = useState(null);
  const anchorRefs = useRef({});

  function togglePicker(targetId) {
    setOpenTargetId(prev => (prev === targetId ? null : targetId));
  }

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 pt-3 justify-center relative">
      {payload.map(entry => {
        const t = targets.find(t => String(t.id) === String(entry.dataKey));
        const name = t ? t.name : entry.dataKey;
        const color = entry.color;
        const targetId = entry.dataKey;
        const defaultColor = defaultColorMap[targetId] || color;
        if (!anchorRefs.current[targetId]) anchorRefs.current[targetId] = { current: null };

        return (
          <div key={targetId} className="relative">
            <button
              ref={el => { anchorRefs.current[targetId] = { current: el }; }}
              onClick={() => togglePicker(targetId)}
              className="flex items-center gap-1.5 hover:opacity-80 transition-opacity focus:outline-none"
              title="Click to change line color"
            >
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: color }}
              />
              <span className="text-xs text-gray-300">{name}</span>
            </button>
            {openTargetId === targetId && (
              <ColorPickerPopover
                targetId={targetId}
                currentColor={color}
                defaultColor={defaultColor}
                onColorChange={(id, c) => { onColorChange(id, c); }}
                onClose={() => setOpenTargetId(null)}
                anchorRef={anchorRefs.current[targetId]}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Shared legend rendered outside individual chart panels */
function SharedLegend({ targets, colorMap, defaultColorMap, onColorChange }) {
  const payload = targets.map(t => ({
    dataKey: String(t.id),
    color: colorMap[t.id] || defaultColorMap[t.id] || COLORS[0],
  }));
  return (
    <CustomLegend
      payload={payload}
      targets={targets}
      colorMap={colorMap}
      defaultColorMap={defaultColorMap}
      onColorChange={onColorChange}
    />
  );
}

/** One chart panel */
function ChartPanel({ title, unit, data, targets, colorMap, defaultColorMap, onColorChange, chartType, chartHeight, loading, showLegend = true, bare = false, fill = false }) {
  // In `fill` mode the plot stretches to whatever height its flex parent gives
  // it (used inside a widget so the legend/controls stay visible without scroll).
  const plotHeight = fill ? '100%' : chartHeight;
  const tooltipStyle = {
    contentStyle: { background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 },
    labelFormatter: formatTooltipLabel,
    formatter: (v, name) => {
      const t = targets.find(t => String(t.id) === String(name));
      return [`${Number(v).toFixed(1)}${unit}`, t ? t.name : name];
    }
  };

  const xAxis = (
    <XAxis
      dataKey="ts"
      tickFormatter={formatTick}
      tick={{ fill: '#6b7280', fontSize: 11 }}
      axisLine={{ stroke: '#374151' }}
      tickLine={false}
      minTickGap={40}
    />
  );
  const yAxis = (
    <YAxis
      tick={{ fill: '#6b7280', fontSize: 11 }}
      axisLine={false}
      tickLine={false}
      unit={unit}
      width={45}
    />
  );
  const grid = <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />;
  const legend = showLegend ? (
    <Legend
      content={({ payload }) => (
        <CustomLegend
          payload={payload || []}
          targets={targets}
          colorMap={colorMap}
          defaultColorMap={defaultColorMap}
          onColorChange={onColorChange}
        />
      )}
    />
  ) : null;

  const commonProps = {
    data,
    margin: { top: 8, right: 16, left: 0, bottom: 0 },
  };

  let chartContent;
  if (loading) {
    chartContent = (
      <div className="flex items-center justify-center text-gray-500 text-sm h-full" style={fill ? undefined : { height: chartHeight }}>
        Loading…
      </div>
    );
  } else if (!data.length) {
    chartContent = (
      <div className="flex items-center justify-center text-gray-500 text-sm h-full" style={fill ? undefined : { height: chartHeight }}>
        No data
      </div>
    );
  } else if (chartType === 'area') {
    chartContent = (
      <ResponsiveContainer width="100%" height={plotHeight}>
        <AreaChart {...commonProps}>
          {grid}{xAxis}{yAxis}
          <Tooltip {...tooltipStyle} />
          {legend}
          {targets.map(t => {
            const color = colorMap[t.id] || COLORS[0];
            return (
              <Area
                key={t.id}
                type="monotone"
                dataKey={String(t.id)}
                stroke={color}
                fill={color + '22'}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            );
          })}
        </AreaChart>
      </ResponsiveContainer>
    );
  } else {
    chartContent = (
      <ResponsiveContainer width="100%" height={plotHeight}>
        <LineChart {...commonProps}>
          {grid}{xAxis}{yAxis}
          <Tooltip {...tooltipStyle} />
          {legend}
          {targets.map(t => {
            const color = colorMap[t.id] || COLORS[0];
            return (
              <Line
                key={t.id}
                type="monotone"
                dataKey={String(t.id)}
                stroke={color}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  // `bare` drops the card chrome (used when the panel lives inside a dashboard
  // Widget, which already provides the framed card).
  if (bare) {
    return (
      <div className={cn('min-w-0', fill && 'h-full flex flex-col min-h-0')}>
        <h3 className={cn('text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2', fill && 'flex-shrink-0')}>{title}</h3>
        {fill ? <div className="flex-1 min-h-0">{chartContent}</div> : chartContent}
      </div>
    );
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 min-w-0">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{title}</h3>
      {chartContent}
    </div>
  );
}

export default function UnifiedChart({
  targets = [],
  lastPingResults = {},
  chartHeight = 220,
  fillHeight = false,
  bare = false,
  colorMap = {},
  onColorChange,
  singleMetric,
  chartType: chartTypeProp,
}) {
  const [range, setRange] = useState(RANGES[2]); // 1h default
  const [latencyData, setLatencyData] = useState([]);
  const [jitterData, setJitterData] = useState([]);
  const [packetLossData, setPacketLossData] = useState([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef(null);
  const [dynamicHeight, setDynamicHeight] = useState(chartHeight);

  const hasDataRef = useRef(false);
  const prevRangeRef = useRef(range);
  const prevTargetIdsRef = useRef(targets.map(t => t.id).join(','));

  // When fillHeight=true, observe the parent element
  useEffect(() => {
    if (!fillHeight) return;
    const el = containerRef.current?.parentElement;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const available = el.clientHeight;
      if (available > 0) {
        setDynamicHeight(Math.max(200, available - 80));
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fillHeight]);

  const effectiveHeight = fillHeight ? dynamicHeight : chartHeight;

  const fetchData = useCallback(async () => {
    if (!targets.length) return;

    const targetIds = targets.map(t => t.id).join(',');
    const isParamChange =
      prevRangeRef.current !== range ||
      prevTargetIdsRef.current !== targetIds;
    prevRangeRef.current = range;
    prevTargetIdsRef.current = targetIds;

    if (!hasDataRef.current || isParamChange) setLoading(true);

    try {
      const now = new Date();
      const from = new Date(now.getTime() - range.minutes * 60 * 1000).toISOString();
      const to = now.toISOString();

      const interval = range.minutes <= 30 ? '1m'
        : range.minutes <= 180 ? '5m'
        : range.minutes <= 720 ? '15m'
        : '30m';

      const metrics = singleMetric ? [singleMetric] : ['latency', 'jitter', 'packet_loss'];

      const results = await Promise.allSettled(
        metrics.map(() =>
          Promise.allSettled(targets.map(t => getMetrics(t.id, { from, to, interval })))
        )
      );

      function buildData(metricResults, metricKey) {
        const timeMap = new Map();
        metricResults.forEach((res, i) => {
          if (res.status !== 'fulfilled') return;
          const target = targets[i];
          const rows = Array.isArray(res.value) ? res.value : (res.value?.rows || res.value?.data || []);
          rows.forEach(row => {
            const ts = row.bucket || row.timestamp || row.time;
            if (!ts) return;
            const key = new Date(ts).getTime();
            if (!timeMap.has(key)) timeMap.set(key, { ts: key });
            const val = row[metricKey] ?? row.avg_latency ?? row.value ?? null;
            timeMap.get(key)[target.id] = val !== null ? Number(val) : null;
          });
        });
        return Array.from(timeMap.values()).sort((a, b) => a.ts - b.ts);
      }

      const metricKeys = {
        latency: 'avg_latency',
        jitter: 'jitter',
        packet_loss: 'packet_loss',
      };

      const setters = {
        latency: setLatencyData,
        jitter: setJitterData,
        packet_loss: setPacketLossData,
      };

      metrics.forEach((metric, idx) => {
        if (results[idx].status !== 'fulfilled') return;
        const sorted = buildData(results[idx].value, metricKeys[metric]);
        const setter = setters[metric];
        setter(prev => {
          if (isParamChange || !prev.length) {
            hasDataRef.current = true;
            return sorted;
          }
          const prevTsSet = new Set(prev.map(d => d.ts));
          const newPoints = sorted.filter(d => !prevTsSet.has(d.ts));
          if (!newPoints.length) return prev;
          hasDataRef.current = true;
          const cutoff = Date.now() - range.minutes * 60 * 1000;
          const combined = [...prev, ...newPoints].sort((a, b) => a.ts - b.ts);
          return combined.filter(d => d.ts >= cutoff);
        });
      });
    } catch (e) {
      console.error('Chart fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [targets, range, singleMetric]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const keys = Object.keys(lastPingResults);
    if (keys.length > 0) {
      const timer = setTimeout(fetchData, 2000);
      return () => clearTimeout(timer);
    }
  }, [lastPingResults, fetchData]);

  const handleColorChange = useCallback((targetId, color) => {
    if (onColorChange) onColorChange(targetId, color);
  }, [onColorChange]);

  // defaultColorMap built from targets using base COLORS (for reset)
  const defaultColorMap = {};
  targets.forEach((t, i) => {
    defaultColorMap[t.id] = COLORS[i % COLORS.length];
  });

  const panelHeight = effectiveHeight;

  const METRIC_TABS = [
    { key: 'latency',     label: 'Latency',     unit: 'ms', chartType: 'line',  data: latencyData },
    { key: 'jitter',      label: 'Jitter',      unit: 'ms', chartType: 'line',  data: jitterData },
    { key: 'packet_loss', label: 'Packet Loss',  unit: '%',  chartType: 'area',  data: packetLossData },
  ];

  // Selected metrics for the multi-metric (main) view — multiple can be active
  const [activeMetrics, setActiveMetrics] = useState(['latency']);

  function toggleMetric(key) {
    setActiveMetrics(prev => {
      if (prev.includes(key)) {
        // Keep at least one selected
        if (prev.length === 1) return prev;
        return prev.filter(k => k !== key);
      }
      return [...prev, key];
    });
  }

  if (singleMetric) {
    const data = singleMetric === 'latency' ? latencyData
      : singleMetric === 'jitter' ? jitterData
      : packetLossData;
    const title = singleMetric === 'latency' ? 'Latency'
      : singleMetric === 'jitter' ? 'Jitter'
      : 'Packet Loss';
    const unit = singleMetric === 'packet_loss' ? '%' : 'ms';
    const chartType = chartTypeProp ?? (singleMetric === 'packet_loss' ? 'area' : 'line');

    return (
      <div ref={containerRef}>
        <ChartPanel
          title={title}
          unit={unit}
          data={data}
          targets={targets}
          colorMap={colorMap}
          defaultColorMap={defaultColorMap}
          onColorChange={handleColorChange}
          chartType={chartType}
          chartHeight={panelHeight}
          loading={loading}
          bare={bare}
        />
        <div className="flex justify-end mt-2">
          <TimeRangeSelector value={range.key} onChange={setRange} />
        </div>
      </div>
    );
  }

  const activeTabs = METRIC_TABS.filter(t => activeMetrics.includes(t.key));

  return (
    <div ref={containerRef} className={cn(fillHeight && 'flex flex-col h-full min-h-0')}>
      {/* Horizontally stacked charts for all active metrics */}
      <div
        className={cn('grid gap-3', fillHeight && 'flex-1 min-h-0')}
        style={{ gridTemplateColumns: `repeat(${activeTabs.length}, minmax(0, 1fr))` }}
      >
        {activeTabs.map(tab => (
          <ChartPanel
            key={tab.key}
            title={tab.label}
            unit={tab.unit}
            data={tab.data}
            targets={targets}
            colorMap={colorMap}
            defaultColorMap={defaultColorMap}
            onColorChange={handleColorChange}
            chartType={tab.chartType}
            chartHeight={panelHeight}
            loading={loading}
            showLegend={false}
            bare={bare}
            fill={fillHeight}
          />
        ))}
      </div>

      {/* Shared legend immediately below charts */}
      {targets.length > 0 && (
        <div className={cn('mt-3', fillHeight && 'flex-shrink-0')}>
          <SharedLegend
            targets={targets}
            colorMap={colorMap}
            defaultColorMap={defaultColorMap}
            onColorChange={handleColorChange}
          />
        </div>
      )}

      {/* Bottom bar: metric toggles + time range selector (right-aligned) */}
      <div className={cn('flex items-center justify-end gap-3 mt-3 flex-wrap', fillHeight && 'flex-shrink-0')}>
        <div className="flex gap-1 bg-gray-800 border border-gray-700 rounded-lg p-1">
          {METRIC_TABS.map(tab => {
            const isActive = activeMetrics.includes(tab.key);
            const isOnlyActive = isActive && activeMetrics.length === 1;
            return (
              <button
                key={tab.key}
                onClick={() => toggleMetric(tab.key)}
                className={cn(
                  'px-3 py-1 rounded text-xs font-medium transition-colors',
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-white'
                )}
                title={isOnlyActive ? 'At least one metric must be selected' : isActive ? 'Click to hide' : 'Click to show'}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        <TimeRangeSelector value={range.key} onChange={setRange} />
      </div>
    </div>
  );
}
