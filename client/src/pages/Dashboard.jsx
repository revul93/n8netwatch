import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { useApi } from '../hooks/useApi';
import { getTargets, getPingResults, addUserTarget, deleteUserTarget, getReportData, getInterfaces, getDashboardConfig, getSpeedtestResults } from '../lib/api';
import { generatePDFReport, generateCSVReport } from '../lib/reportGenerator';
import SummaryCards from '../components/SummaryCards';
import UnifiedChart, { buildColorMap } from '../components/UnifiedChart';
import SpeedChart from '../components/SpeedChart';
import HostGrid from '../components/HostGrid';
import HostPill from '../components/HostPill';
import FullscreenChartModal from '../components/FullscreenChartModal';
import GroupPanel from '../components/GroupPanel';
import DashboardGrid from '../components/DashboardGrid';
import { RefreshCw, Maximize2, Plus, X, FileText, FileDown } from 'lucide-react';
import { cn } from '../lib/utils';

const SECTION_KEYS = ['summary', 'chart', 'speedtest', 'groups', 'hosts'];

const CHART_HEIGHT_MIN = 180;
const CHART_HEIGHT_MAX = 800;
const CHART_HEIGHT_DEFAULT = 280;

const CHART_WIDTH_MIN = 30; // percent
const CHART_WIDTH_DEFAULT = 100; // percent

const GROUPS_HEIGHT_MIN = 150;
const GROUPS_HEIGHT_MAX = 600;
const GROUPS_HEIGHT_DEFAULT = 300;

const SPEEDTEST_HEIGHT_MIN = 160;
const SPEEDTEST_HEIGHT_MAX = 600;
const SPEEDTEST_HEIGHT_DEFAULT = 260;

export default function Dashboard() {
  const { lastPingResults, configReloadedAt, targetsChangedAt, connected, lastSpeedtestResult } = useWebSocket();
  const { data: targets, loading, refetch } = useApi(getTargets, []);
  const [sparklineData, setSparklineData] = useState({});
  const [selectedTargetIds, setSelectedTargetIds] = useState([]);
  const [fullscreen, setFullscreen] = useState(false);

  // Resizable chart height
  const [chartHeight, setChartHeight] = useState(() => {
    const saved = parseInt(localStorage.getItem('dashChartHeight'), 10);
    return isNaN(saved) ? CHART_HEIGHT_DEFAULT : Math.max(CHART_HEIGHT_MIN, Math.min(CHART_HEIGHT_MAX, saved));
  });
  const chartHeightRef = useRef(chartHeight);

  // Resizable chart width (percentage)
  const [chartWidthPct, setChartWidthPct] = useState(() => {
    const saved = parseFloat(localStorage.getItem('dashChartWidthPct'));
    return isNaN(saved) ? CHART_WIDTH_DEFAULT : Math.max(CHART_WIDTH_MIN, Math.min(100, saved));
  });
  const chartWidthPctRef = useRef(chartWidthPct);
  const chartSectionRef = useRef(null);

  // Resizable groups height
  const [groupsHeight, setGroupsHeight] = useState(() => {
    const saved = parseInt(localStorage.getItem('dashGroupsHeight'), 10);
    return isNaN(saved) ? GROUPS_HEIGHT_DEFAULT : Math.max(GROUPS_HEIGHT_MIN, Math.min(GROUPS_HEIGHT_MAX, saved));
  });
  const groupsHeightRef = useRef(groupsHeight);

  // Resizable speedtest chart height
  const [speedtestHeight, setSpeedtestHeight] = useState(() => {
    const saved = parseInt(localStorage.getItem('dashSpeedtestHeight'), 10);
    return isNaN(saved) ? SPEEDTEST_HEIGHT_DEFAULT : Math.max(SPEEDTEST_HEIGHT_MIN, Math.min(SPEEDTEST_HEIGHT_MAX, saved));
  });
  const speedtestHeightRef = useRef(speedtestHeight);

  const handleSpeedtestResizeMouseDown = useCallback((e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = speedtestHeightRef.current;

    const onMouseMove = (ev) => {
      const newHeight = Math.max(SPEEDTEST_HEIGHT_MIN, Math.min(SPEEDTEST_HEIGHT_MAX, startHeight + ev.clientY - startY));
      speedtestHeightRef.current = newHeight;
      setSpeedtestHeight(newHeight);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      localStorage.setItem('dashSpeedtestHeight', speedtestHeightRef.current);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  // Speedtest history state
  const [speedtestResults, setSpeedtestResults] = useState([]);
  const [speedtestRunning, setSpeedtestRunning] = useState(false);

  const handleChartResizeMouseDown = useCallback((e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = chartHeightRef.current;

    const onMouseMove = (ev) => {
      const newHeight = Math.max(CHART_HEIGHT_MIN, Math.min(CHART_HEIGHT_MAX, startHeight + ev.clientY - startY));
      chartHeightRef.current = newHeight;
      setChartHeight(newHeight);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      localStorage.setItem('dashChartHeight', chartHeightRef.current);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  const handleChartWidthResizeMouseDown = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startPct = chartWidthPctRef.current;
    const parentWidth = chartSectionRef.current?.parentElement?.getBoundingClientRect().width || window.innerWidth;

    const onMouseMove = (ev) => {
      const deltaPct = ((ev.clientX - startX) / parentWidth) * 100;
      const newPct = Math.max(CHART_WIDTH_MIN, Math.min(100, startPct + deltaPct));
      chartWidthPctRef.current = newPct;
      setChartWidthPct(newPct);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      localStorage.setItem('dashChartWidthPct', chartWidthPctRef.current);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  const handleChartWidthKeyDown = useCallback((e) => {
    if (e.key === 'ArrowLeft') {
      const v = Math.max(CHART_WIDTH_MIN, chartWidthPctRef.current - 5);
      chartWidthPctRef.current = v;
      setChartWidthPct(v);
      localStorage.setItem('dashChartWidthPct', v);
    }
    if (e.key === 'ArrowRight') {
      const v = Math.min(100, chartWidthPctRef.current + 5);
      chartWidthPctRef.current = v;
      setChartWidthPct(v);
      localStorage.setItem('dashChartWidthPct', v);
    }
  }, []);

  const handleGroupsResizeMouseDown = useCallback((e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = groupsHeightRef.current;

    const onMouseMove = (ev) => {
      const newHeight = Math.max(GROUPS_HEIGHT_MIN, Math.min(GROUPS_HEIGHT_MAX, startHeight + ev.clientY - startY));
      groupsHeightRef.current = newHeight;
      setGroupsHeight(newHeight);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      localStorage.setItem('dashGroupsHeight', groupsHeightRef.current);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  // Section drag-and-drop order
  const [sectionOrder, setSectionOrder] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('dashboardSectionOrder'));
      if (
        Array.isArray(saved) &&
        SECTION_KEYS.every(k => saved.includes(k)) &&
        saved.every(k => SECTION_KEYS.includes(k))
      ) {
        return saved;
      }
    } catch {}
    return [...SECTION_KEYS];
  });
  const [dragOverSection, setDragOverSection] = useState(null);
  const dragSectionRef = useRef(null);

  // User target form state
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTargetName, setNewTargetName] = useState('');
  const [newTargetIp, setNewTargetIp] = useState('');
  const [newTargetIface, setNewTargetIface] = useState('');
  const [newTargetLifetimeDays, setNewTargetLifetimeDays] = useState(null);
  const [addError, setAddError] = useState('');
  const [addLoading, setAddLoading] = useState(false);

  // Available interfaces from config
  const { data: interfaces } = useApi(getInterfaces, []);

  // Max lifetime days + dashboard visibility from server config
  const { data: serverConfig } = useApi(getDashboardConfig, []);
  const maxLifetimeDays = serverConfig?.max_user_target_lifetime_days || 7;
  // Fall back to all-visible so the dashboard is always usable if config fetch fails
  const visibility = serverConfig?.visibility || { summary: true, chart: true, groups: true, hosts: true, speedtest: true };
  const speedtestConfig = serverConfig?.speedtest || {};

  // Sync lifetime days default once server config is loaded
  useEffect(() => {
    setNewTargetLifetimeDays(maxLifetimeDays);
  }, [maxLifetimeDays]);

  // Groups section collapsed/expanded state (persisted to localStorage)
  const [groupsPanelOpen, setGroupsPanelOpen] = useState(() => {
    const saved = localStorage.getItem('groupsPanelOpen');
    return saved === null ? true : saved === 'true';
  });

  const toggleGroupsPanel = useCallback(() => {
    setGroupsPanelOpen(prev => {
      const next = !prev;
      localStorage.setItem('groupsPanelOpen', String(next));
      return next;
    });
  }, []);

  // Confirmation dialog state
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [deleteStep, setDeleteStep] = useState('confirm'); // 'confirm' | 'report'
  const [reportDownloading, setReportDownloading] = useState(null);

  const fetchSparklines = useCallback(async (targetList) => {
    if (!targetList?.length) return;
    const from = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const results = await Promise.allSettled(
      targetList.map(t => getPingResults(t.id, { from, limit: 20 }))
    );
    const map = {};
    results.forEach((res, i) => {
      if (res.status === 'fulfilled') {
        const rows = Array.isArray(res.value) ? res.value : (res.value?.rows || res.value?.results || []);
        map[targetList[i].id] = rows;
      }
    });
    setSparklineData(map);
  }, []);

  useEffect(() => {
    if (targets?.length) {
      fetchSparklines(targets);
    }
  }, [targets, fetchSparklines]);

  // Update sparklines when new ping data arrives
  useEffect(() => {
    const ids = Object.keys(lastPingResults);
    if (!ids.length || !targets?.length) return;
    const timer = setTimeout(() => fetchSparklines(targets), 3000);
    return () => clearTimeout(timer);
  }, [lastPingResults, targets, fetchSparklines]);

  // Refetch targets when config.yaml changes (live reload)
  useEffect(() => {
    if (configReloadedAt) refetch();
  }, [configReloadedAt, refetch]);

  // Refetch targets when another client adds or removes a user-defined target (WebSocket push)
  useEffect(() => {
    if (targetsChangedAt) refetch();
  }, [targetsChangedAt, refetch]);

  // ── Speedtest data ────────────────────────────────────────────────────────────

  // Fetch historical speedtest results on mount
  useEffect(() => {
    getSpeedtestResults({ limit: 200 })
      .then(rows => setSpeedtestResults(rows))
      .catch(() => {});
  }, []);

  // Append new speedtest result from WebSocket
  useEffect(() => {
    if (!lastSpeedtestResult) return;
    setSpeedtestRunning(false);
    // Prepend (newest first) and deduplicate by id
    setSpeedtestResults(prev => {
      const id = lastSpeedtestResult.id;
      if (id && prev.some(r => r.id === id)) return prev;
      return [lastSpeedtestResult, ...prev].slice(0, 1000);
    });
  }, [lastSpeedtestResult]);

  // 15-second polling fallback — only active when WebSocket is disconnected to
  // ensure other browsers eventually see target changes even if they missed the
  // push event during a reconnect window
  useEffect(() => {
    if (connected) return;
    const timer = setInterval(() => refetch(), 15000);
    return () => clearInterval(timer);
  }, [connected, refetch]);

  // Toggle a target in the selection; clicking again deselects
  const handleTargetClick = useCallback((targetId) => {
    setSelectedTargetIds(prev =>
      prev.includes(targetId)
        ? prev.filter(id => id !== targetId)
        : [...prev, targetId]
    );
  }, []);

  const targetList = targets || [];

  // Stable color map derived from the full target list (not the filtered subset)
  const baseColorMap = useMemo(() => buildColorMap(targetList), [targetList]);

  // Custom colors from localStorage merged over base colors
  const [customColors, setCustomColors] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('n8watchTargetColors') || '{}');
    } catch { return {}; }
  });

  const colorMap = useMemo(() => ({ ...baseColorMap, ...customColors }), [baseColorMap, customColors]);

  const handleColorChange = useCallback((targetId, color) => {
    setCustomColors(prev => {
      const next = { ...prev, [targetId]: color };
      localStorage.setItem('n8watchTargetColors', JSON.stringify(next));
      return next;
    });
  }, []);

  // Targets shown in the chart: use selection if any, otherwise all
  const chartTargets = selectedTargetIds.length > 0
    ? targetList.filter(t => selectedTargetIds.includes(t.id))
    : targetList;

  // Add a user-defined temporary target
  const handleAddTarget = useCallback(async (e) => {
    e.preventDefault();
    const name = newTargetName.trim();
    const ip   = newTargetIp.trim();
    if (!name || !ip) {
      setAddError('Both name and IP/hostname are required.');
      return;
    }
    setAddError('');
    setAddLoading(true);
    try {
      const ifaceList = interfaces || [];
      const selectedIface = ifaceList.find(i => i.name === newTargetIface) || null;
      await addUserTarget(
        name,
        ip,
        selectedIface ? selectedIface.name  : undefined,
        selectedIface ? selectedIface.alias : undefined,
        newTargetLifetimeDays ?? maxLifetimeDays,
      );
      setNewTargetName('');
      setNewTargetIp('');
      setNewTargetIface('');
      setShowAddModal(false);
      await refetch();
    } catch (err) {
      setAddError(err.message || 'Failed to add target.');
    } finally {
      setAddLoading(false);
    }
  }, [newTargetName, newTargetIp, newTargetIface, newTargetLifetimeDays, maxLifetimeDays, interfaces, refetch]);

  // Show confirmation dialog before deleting a user target
  const handleDeleteRequest = useCallback((target) => {
    setDeleteCandidate(target);
    setDeleteStep('confirm');
  }, []);

  // After first confirmation, ask about report download
  const handleDeleteFirstConfirm = useCallback(() => {
    setDeleteStep('report');
  }, []);

  // Download report then delete
  const handleDownloadThenDelete = useCallback(async (format) => {
    if (!deleteCandidate) return;
    setReportDownloading(format);
    try {
      const data = await getReportData(deleteCandidate.id);
      if (format === 'pdf') {
        generatePDFReport(data);
      } else {
        generateCSVReport(data);
      }
    } catch (err) {
      console.error('Failed to generate report before delete:', err);
    } finally {
      setReportDownloading(null);
    }
    // Proceed with deletion after download
    try {
      await deleteUserTarget(deleteCandidate.id);
      setDeleteCandidate(null);
      await refetch();
    } catch (err) {
      console.error('Failed to delete user target:', err);
      setDeleteCandidate(null);
    }
  }, [deleteCandidate, refetch]);

  // Confirmed deletion (no report)
  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteCandidate) return;
    try {
      await deleteUserTarget(deleteCandidate.id);
      setDeleteCandidate(null);
      await refetch();
    } catch (err) {
      console.error('Failed to delete user target:', err);
      setDeleteCandidate(null);
    }
  }, [deleteCandidate, refetch]);

  // Section drag handlers
  const handleSectionDragStart = useCallback((e, key) => {
    dragSectionRef.current = key;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('section', key);
  }, []);

  const handleSectionDragEnter = useCallback((key) => {
    if (!dragSectionRef.current || dragSectionRef.current === key) return;
    setDragOverSection(key);
    setSectionOrder(prev => {
      const from = prev.indexOf(dragSectionRef.current);
      const to = prev.indexOf(key);
      if (from === -1 || to === -1 || from === to) return prev;
      const next = [...prev];
      next.splice(from, 1);
      next.splice(to, 0, dragSectionRef.current);
      return next;
    });
  }, []);

  const handleSectionDragEnd = useCallback(() => {
    setSectionOrder(prev => {
      localStorage.setItem('dashboardSectionOrder', JSON.stringify(prev));
      return prev;
    });
    dragSectionRef.current = null;
    setDragOverSection(null);
  }, []);

  // ── Build the arrangeable widget list ──────────────────────────────────────
  // Group targets by `group` (Ungrouped last) so each group is its own widget.
  const groupEntries = (() => {
    const map = new Map();
    targetList.forEach((t) => {
      const key = t.group || 'Ungrouped';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(t);
    });
    const named = [];
    let ungrouped = null;
    for (const [name, gts] of map) {
      if (name === 'Ungrouped') ungrouped = [name, gts];
      else named.push([name, gts]);
    }
    if (ungrouped) named.push(ungrouped);
    return named;
  })();

  const widgets = [];
  if (visibility.summary !== false) {
    widgets.push({
      id: 'summary', title: 'Summary', w: 12, h: 4, minW: 4, minH: 3,
      render: () => <SummaryCards targets={targetList} lastPingResults={lastPingResults} />,
    });
  }
  if (visibility.chart !== false) {
    widgets.push({
      id: 'chart', title: 'Overview Chart', w: 8, h: 19, minW: 4, minH: 8,
      render: () => (
        <div className="flex flex-col gap-3 h-full min-h-0">
          <div className="flex-1 min-h-0">
            <UnifiedChart
              targets={chartTargets}
              lastPingResults={lastPingResults}
              colorMap={colorMap}
              onColorChange={handleColorChange}
              fillHeight
              bare
            />
          </div>
          <div className="border-t border-gray-800 pt-2 flex-shrink-0">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500">
                {selectedTargetIds.length > 0
                  ? `${selectedTargetIds.length} selected — filtering chart`
                  : 'Click a target to filter the chart'}
              </span>
              {selectedTargetIds.length > 0 && (
                <button
                  onClick={() => setSelectedTargetIds([])}
                  className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                >
                  Clear selection
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2 max-h-28 overflow-auto">
              {targetList.map((target) => (
                <HostPill
                  key={target.id}
                  target={target}
                  lastPingResult={lastPingResults[target.id]}
                  isSelected={selectedTargetIds.includes(target.id)}
                  onTargetClick={handleTargetClick}
                />
              ))}
            </div>
          </div>
        </div>
      ),
    });
  }
  if (visibility.speedtest !== false) {
    widgets.push({
      id: 'speedtest', title: 'Internet Speed', w: 4, h: 13, minW: 3, minH: 6,
      render: ({ height }) => (
        <SpeedChart
          results={speedtestResults}
          show={speedtestConfig.show || 'both'}
          height={Math.max(140, Math.round((height || 300) - 64))}
          running={speedtestRunning}
        />
      ),
    });
  }
  if (visibility.groups !== false) {
    groupEntries.forEach(([name, gts]) => {
      widgets.push({
        id: `group:${name}`, title: name, w: 3, h: 17, minW: 2, minH: 6,
        render: ({ height }) => (
          <GroupPanel
            groupName={name}
            targets={gts}
            lastPingResults={lastPingResults}
            colorMap={colorMap}
            fillHeight={height || 220}
          />
        ),
      });
    });
  }
  if (visibility.hosts !== false) {
    widgets.push({
      id: 'hosts', title: 'Hosts', w: 12, h: 24, minW: 4, minH: 6,
      render: () => (
        <HostGrid
          targets={targetList}
          lastPingResults={lastPingResults}
          sparklineData={sparklineData}
          selectedTargetIds={selectedTargetIds}
          onTargetClick={handleTargetClick}
          onDeleteUserTarget={handleDeleteRequest}
        />
      ),
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">Real-time network monitoring</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={refetch}
            className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-400 hover:text-white transition-colors"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
          <button
            onClick={() => setFullscreen(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-400 hover:text-white transition-colors"
            title="Open chart in fullscreen"
          >
            <Maximize2 size={14} />
            Fullscreen
          </button>
        </div>
      </div>

      {/* Add temporary target button */}
      <div className="flex justify-end">
        <button
          onClick={() => { setAddError(''); setShowAddModal(true); }}
          className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-700 hover:bg-blue-600 rounded-lg text-sm text-white transition-colors"
        >
          <Plus size={14} />
          Add Temporary Target
        </button>
      </div>

      {/* Add temporary target modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-base font-semibold text-white">Add Temporary Target</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-gray-500 hover:text-white"
                disabled={addLoading}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAddTarget} className="flex flex-col gap-3">
              <input
                type="text"
                placeholder="Name (e.g. My Router)"
                value={newTargetName}
                onChange={e => setNewTargetName(e.target.value)}
                maxLength={100}
                className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-600"
              />
              <input
                type="text"
                placeholder="IP / Hostname (e.g. 192.168.1.1)"
                value={newTargetIp}
                onChange={e => setNewTargetIp(e.target.value)}
                maxLength={253}
                className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-600"
              />
              {interfaces && interfaces.length > 0 && (
                <select
                  value={newTargetIface}
                  onChange={e => setNewTargetIface(e.target.value)}
                  className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-600"
                  title="Outgoing network interface (optional)"
                >
                  <option value="">Interface — default</option>
                  {interfaces.map(iface => (
                    <option key={iface.name} value={iface.name}>
                      {[iface.name, iface.alias, iface.ipv4].filter(Boolean).join(' | ')}
                    </option>
                  ))}
                </select>
              )}
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Monitor for (days) — max {maxLifetimeDays}
                </label>
                <select
                  value={newTargetLifetimeDays ?? maxLifetimeDays}
                  onChange={e => setNewTargetLifetimeDays(Number(e.target.value))}
                  className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-600"
                >
                  {Array.from({ length: maxLifetimeDays }, (_, i) => i + 1).map(d => (
                    <option key={d} value={d}>{d} {d === 1 ? 'day' : 'days'}</option>
                  ))}
                </select>
              </div>
              {addError && <p className="text-xs text-red-400">{addError}</p>}
              <div className="flex gap-3 justify-end pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  disabled={addLoading}
                  className="px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addLoading}
                  className="flex items-center gap-1.5 px-4 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-60 rounded-lg text-sm text-white transition-colors"
                >
                  <Plus size={14} />
                  {addLoading ? 'Adding…' : 'Add Target'}
                </button>
              </div>
            </form>
            <p className="text-xs text-gray-600 mt-3">
              Temporary targets are not saved to config.yaml and do not trigger alerts.
            </p>
          </div>
        </div>
      )}

      {/* Arrangeable widget grid — drag the header to move, drag an edge/corner to resize */}
      <DashboardGrid widgets={widgets} />

      {fullscreen && (
        <FullscreenChartModal
          targets={targetList}
          lastPingResults={lastPingResults}
          colorMap={colorMap}
          onColorChange={handleColorChange}
          sparklineData={sparklineData}
          onClose={() => setFullscreen(false)}
        />
      )}

      {/* Delete confirmation dialog */}
      {deleteCandidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl">
            {deleteStep === 'confirm' ? (
              <>
                <div className="flex items-start justify-between mb-4">
                  <h3 className="text-base font-semibold text-white">Remove Temporary Target</h3>
                  <button onClick={() => setDeleteCandidate(null)} className="text-gray-500 hover:text-white">
                    <X size={18} />
                  </button>
                </div>
                <p className="text-sm text-gray-400 mb-6">
                  Are you sure you want to remove <span className="font-semibold text-white">{deleteCandidate.name}</span> ({deleteCandidate.ip})?
                  This will delete all monitoring data for this target.
                </p>
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={() => setDeleteCandidate(null)}
                    className="px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-400 hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteFirstConfirm}
                    className="px-4 py-2 bg-red-700 hover:bg-red-600 rounded-lg text-sm text-white transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-start justify-between mb-4">
                  <h3 className="text-base font-semibold text-white">Download Report?</h3>
                  <button onClick={() => setDeleteCandidate(null)} className="text-gray-500 hover:text-white">
                    <X size={18} />
                  </button>
                </div>
                <p className="text-sm text-gray-400 mb-5">
                  Would you like to download a report for <span className="font-semibold text-white">{deleteCandidate.name}</span> before removing it?
                </p>
                <div className="flex flex-col gap-2 mb-4">
                  <button
                    onClick={() => handleDownloadThenDelete('pdf')}
                    disabled={!!reportDownloading}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-60 rounded-lg text-sm text-white transition-colors"
                  >
                    <FileText size={14} />
                    {reportDownloading === 'pdf' ? 'Generating…' : 'Download PDF & Remove'}
                  </button>
                  <button
                    onClick={() => handleDownloadThenDelete('csv')}
                    disabled={!!reportDownloading}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-60 rounded-lg text-sm text-white transition-colors"
                  >
                    <FileDown size={14} />
                    {reportDownloading === 'csv' ? 'Generating…' : 'Download CSV & Remove'}
                  </button>
                </div>
                <div className="flex gap-3 justify-end border-t border-gray-800 pt-4">
                  <button
                    onClick={() => setDeleteCandidate(null)}
                    className="px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-400 hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteConfirm}
                    disabled={!!reportDownloading}
                    className="px-4 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-60 rounded-lg text-sm text-white transition-colors"
                  >
                    Remove Without Report
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
