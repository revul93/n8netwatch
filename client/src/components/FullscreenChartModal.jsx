import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Minimize2, PanelLeftClose, PanelLeftOpen, GripVertical, LayoutGrid, AlignJustify, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';
import UnifiedChart from './UnifiedChart';
import HostCard from './HostCard';
import GroupPanel from './GroupPanel';
import DashboardGrid from './DashboardGrid';
import SummaryCards from './SummaryCards';

const PANEL_MIN = 180;
const PANEL_MAX = 520;
const PANEL_DEFAULT = 280;

const FS_CHART_HEIGHT_MIN = 180;
const FS_CHART_HEIGHT_MAX = 800;
const FS_CHART_HEIGHT_DEFAULT = 280;

const FS_CHART_WIDTH_MIN = 30; // percent
const FS_CHART_WIDTH_DEFAULT = 100; // percent

export default function FullscreenChartModal({ targets = [], lastPingResults = {}, onClose, colorMap = {}, onColorChange, sparklineData = {} }) {
  const [selectedIds, setSelectedIds] = useState([]);

  // Left panel state (open/closed and width)
  const [panelOpen, setPanelOpen] = useState(() => {
    const saved = localStorage.getItem('fsPanelOpen');
    return saved !== null ? saved === 'true' : true;
  });
  const [panelWidth, setPanelWidth] = useState(() => {
    const saved = parseInt(localStorage.getItem('fsPanelWidth'), 10);
    return isNaN(saved) ? PANEL_DEFAULT : Math.max(PANEL_MIN, Math.min(PANEL_MAX, saved));
  });
  const panelWidthRef = useRef(panelWidth);

  // Main chart height (vertical stretch)
  const [fsChartHeight, setFsChartHeight] = useState(() => {
    const saved = parseInt(localStorage.getItem('fsChartHeight'), 10);
    return isNaN(saved) ? FS_CHART_HEIGHT_DEFAULT : Math.max(FS_CHART_HEIGHT_MIN, Math.min(FS_CHART_HEIGHT_MAX, saved));
  });
  const fsChartHeightRef = useRef(fsChartHeight);

  // Main chart width (horizontal stretch, percentage)
  const [fsChartWidthPct, setFsChartWidthPct] = useState(() => {
    const saved = parseFloat(localStorage.getItem('fsChartWidthPct'));
    return isNaN(saved) ? FS_CHART_WIDTH_DEFAULT : Math.max(FS_CHART_WIDTH_MIN, Math.min(100, saved));
  });
  const fsChartWidthPctRef = useRef(fsChartWidthPct);
  const fsChartSectionRef = useRef(null);

  const handleFsChartResizeMouseDown = useCallback((e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = fsChartHeightRef.current;

    const onMouseMove = (ev) => {
      const newHeight = Math.max(FS_CHART_HEIGHT_MIN, Math.min(FS_CHART_HEIGHT_MAX, startHeight + ev.clientY - startY));
      fsChartHeightRef.current = newHeight;
      setFsChartHeight(newHeight);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      localStorage.setItem('fsChartHeight', fsChartHeightRef.current);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  const handleFsChartWidthResizeMouseDown = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startPct = fsChartWidthPctRef.current;
    const parentWidth = fsChartSectionRef.current?.parentElement?.getBoundingClientRect().width || window.innerWidth;

    const onMouseMove = (ev) => {
      const deltaPct = ((ev.clientX - startX) / parentWidth) * 100;
      const newPct = Math.max(FS_CHART_WIDTH_MIN, Math.min(100, startPct + deltaPct));
      fsChartWidthPctRef.current = newPct;
      setFsChartWidthPct(newPct);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      localStorage.setItem('fsChartWidthPct', fsChartWidthPctRef.current);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  const handleFsChartWidthKeyDown = useCallback((e) => {
    if (e.key === 'ArrowLeft') {
      const v = Math.max(FS_CHART_WIDTH_MIN, fsChartWidthPctRef.current - 5);
      fsChartWidthPctRef.current = v;
      setFsChartWidthPct(v);
      localStorage.setItem('fsChartWidthPct', v);
    }
    if (e.key === 'ArrowRight') {
      const v = Math.min(100, fsChartWidthPctRef.current + 5);
      fsChartWidthPctRef.current = v;
      setFsChartWidthPct(v);
      localStorage.setItem('fsChartWidthPct', v);
    }
  }, []);

  const handleFsChartHeightKeyDown = useCallback((e) => {
    if (e.key === 'ArrowUp') {
      const v = Math.max(FS_CHART_HEIGHT_MIN, fsChartHeightRef.current - 20);
      fsChartHeightRef.current = v;
      setFsChartHeight(v);
      localStorage.setItem('fsChartHeight', v);
    }
    if (e.key === 'ArrowDown') {
      const v = Math.min(FS_CHART_HEIGHT_MAX, fsChartHeightRef.current + 20);
      fsChartHeightRef.current = v;
      setFsChartHeight(v);
      localStorage.setItem('fsChartHeight', v);
    }
  }, []);

  // Panel target order (manual sort by drag-and-drop, persisted in localStorage)
  const [panelOrder, setPanelOrder] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('fsPanelOrder'));
      if (Array.isArray(saved) && saved.every(id => typeof id === 'number')) return saved;
    } catch {}
    return null;
  });
  const dragTargetRef = useRef(null);
  const [dragOverId, setDragOverId] = useState(null);

  // Merge server targets with saved panel order
  const orderedTargets = useCallback((serverTargets, order) => {
    if (!order) return serverTargets;
    const idSet = new Set(serverTargets.map(t => t.id));
    const knownIds = order.filter(id => idSet.has(id));
    const newTargets = serverTargets.filter(t => !knownIds.includes(t.id));
    const idToTarget = Object.fromEntries(serverTargets.map(t => [t.id, t]));
    return [...knownIds.map(id => idToTarget[id]), ...newTargets];
  }, []);

  const panelTargets = orderedTargets(targets, panelOrder);

  useEffect(() => {
    if (!panelOrder) return;
    const knownSet = new Set(panelOrder);
    const newIds = targets.map(t => t.id).filter(id => !knownSet.has(id));
    if (newIds.length > 0) {
      setPanelOrder(prev => {
        const next = [...(prev || []), ...newIds];
        localStorage.setItem('fsPanelOrder', JSON.stringify(next));
        return next;
      });
    }
  }, [targets, panelOrder]);

  const handleTargetDragStart = useCallback((e, id) => {
    dragTargetRef.current = id;
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleTargetDragEnter = useCallback((id) => {
    if (!dragTargetRef.current || dragTargetRef.current === id) return;
    setDragOverId(id);
    const currentIds = panelTargets.map(t => t.id);
    setPanelOrder(prev => {
      const base = prev || currentIds;
      const from = base.indexOf(dragTargetRef.current);
      const to = base.indexOf(id);
      if (from === -1 || to === -1 || from === to) return prev;
      const next = [...base];
      next.splice(from, 1);
      next.splice(to, 0, dragTargetRef.current);
      return next;
    });
  }, [panelTargets]);

  const handleTargetDragEnd = useCallback(() => {
    const currentIds = panelTargets.map(t => t.id);
    setPanelOrder(prev => {
      const order = prev || currentIds;
      localStorage.setItem('fsPanelOrder', JSON.stringify(order));
      return order;
    });
    dragTargetRef.current = null;
    setDragOverId(null);
  }, [panelTargets]);

  const containerRef = useRef(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // Toggle and persist panel visibility
  const togglePanel = useCallback(() => {
    setPanelOpen(prev => {
      const next = !prev;
      localStorage.setItem('fsPanelOpen', next);
      return next;
    });
  }, []);

  // Request browser fullscreen when the modal mounts
  useEffect(() => {
    const el = document.documentElement;
    if (el.requestFullscreen) {
      el.requestFullscreen().catch(() => {});
    } else if (el.webkitRequestFullscreen) {
      el.webkitRequestFullscreen();
    } else if (el.mozRequestFullScreen) {
      el.mozRequestFullScreen();
    } else if (el.msRequestFullscreen) {
      el.msRequestFullscreen();
    }

    const handleFsChange = () => {
      const isFs = !!(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement
      );
      if (!isFs) onCloseRef.current();
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    document.addEventListener('webkitfullscreenchange', handleFsChange);
    document.addEventListener('mozfullscreenchange', handleFsChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange);
      document.removeEventListener('webkitfullscreenchange', handleFsChange);
      document.removeEventListener('mozfullscreenchange', handleFsChange);
    };
  }, []);

  // The widget grid (react-grid-layout WidthProvider) measures its container width
  // on mount; the modal opens and enters fullscreen a beat later, so nudge it to
  // re-measure once the layout settles — otherwise widgets can start at 0 width.
  useEffect(() => {
    const timers = [80, 250, 700].map((ms) =>
      setTimeout(() => window.dispatchEvent(new Event('resize')), ms),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  // Exit browser fullscreen when the modal closes
  const handleClose = useCallback(() => {
    const exitFs =
      document.exitFullscreen ||
      document.webkitExitFullscreen ||
      document.mozCancelFullScreen ||
      document.msExitFullscreen;
    if (exitFs && (
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement
    )) {
      exitFs.call(document).catch(() => {});
    }
    onCloseRef.current();
  }, []);

  // Prevent background scroll while open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // Panel resize drag
  const handlePanelResizeMouseDown = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelWidthRef.current;

    const onMouseMove = (ev) => {
      const newWidth = Math.max(PANEL_MIN, Math.min(PANEL_MAX, startWidth + ev.clientX - startX));
      panelWidthRef.current = newWidth;
      setPanelWidth(newWidth);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      localStorage.setItem('fsPanelWidth', panelWidthRef.current);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  // Detail-view IDs: cards shown in full HostCard view instead of compact
  const [detailViewIds, setDetailViewIds] = useState([]);

  // Groups panel open/closed in fullscreen
  const [fsGroupsPanelOpen, setFsGroupsPanelOpen] = useState(() => {
    const saved = localStorage.getItem('fsGroupsPanelOpen');
    return saved === null ? true : saved === 'true';
  });

  const toggleFsGroupsPanel = useCallback(() => {
    setFsGroupsPanelOpen(prev => {
      const next = !prev;
      localStorage.setItem('fsGroupsPanelOpen', String(next));
      return next;
    });
  }, []);

  const toggleTarget = useCallback((id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  }, []);

  const toggleDetailView = useCallback((id) => {
    setDetailViewIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  }, []);

  const filteredTargets = selectedIds.length > 0
    ? panelTargets.filter(t => selectedIds.includes(t.id))
    : panelTargets;

  // ── Arrangeable widget grid (same drag/resize system as the dashboard) ──────
  const fsGroupEntries = (() => {
    const map = new Map();
    targets.forEach((t) => {
      const key = t.group || 'Ungrouped';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(t);
    });
    const named = [];
    let ung = null;
    for (const [name, gts] of map) {
      if (name === 'Ungrouped') ung = [name, gts];
      else named.push([name, gts]);
    }
    if (ung) named.push(ung);
    return named;
  })();

  const fsWidgets = [
    {
      id: 'summary', title: 'Summary', w: 12, h: 4, minW: 4, minH: 3,
      render: () => <SummaryCards targets={targets} lastPingResults={lastPingResults} />,
    },
    {
      id: 'chart', title: 'Overview Chart', w: 12, h: 16, minW: 4, minH: 8,
      render: () => (
        <div className="h-full min-h-0">
          <UnifiedChart
            targets={filteredTargets}
            lastPingResults={lastPingResults}
            colorMap={colorMap}
            onColorChange={onColorChange}
            fillHeight
            bare
          />
        </div>
      ),
    },
    ...fsGroupEntries.map(([name, gts]) => ({
      id: `group:${name}`, title: name, w: 3, h: 17, minW: 2, minH: 6,
      render: () => (
        <GroupPanel
          groupName={name}
          targets={gts}
          lastPingResults={lastPingResults}
          colorMap={colorMap}
        />
      ),
    })),
  ];

  const content = (
    <div
      ref={containerRef}
      className="fixed z-[9999] bg-gray-950 flex flex-col"
      style={{ top: 0, left: 0, right: 0, bottom: 0, margin: 0 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="fullscreen-chart-title"
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 flex-shrink-0">
        <button
          onClick={togglePanel}
          className="flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          title={panelOpen ? 'Hide targets panel' : 'Show targets panel'}
        >
          {panelOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>
        <h2 id="fullscreen-chart-title" className="text-lg font-bold text-white tracking-tight">
          n8watch
        </h2>

        <div className="flex-1" />

        {selectedIds.length > 0 && (
          <button
            onClick={() => setSelectedIds([])}
            className="px-3 py-1 rounded-lg text-xs text-gray-500 hover:text-gray-300 border border-gray-700 transition-colors"
          >
            Show all targets
          </button>
        )}

        <button
          onClick={handleClose}
          className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-400 hover:text-white transition-colors"
          title="Exit fullscreen (Esc)"
        >
          <Minimize2 size={16} />
          Exit Fullscreen
        </button>
      </div>

      {/* Body: left panel + main content area */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left panel — target cards */}
        {panelOpen && (
          <>
            <div
              className="flex flex-col bg-gray-900 border-r border-gray-800 flex-shrink-0 overflow-y-auto"
              style={{ width: panelWidth }}
            >
              <div className="px-3 py-2 border-b border-gray-800 flex-shrink-0">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Targets</span>
                <p className="text-xs text-gray-600 mt-0.5">Click to filter · drag to reorder</p>
              </div>
              <div className="flex flex-col gap-1 p-2 overflow-y-auto flex-1">
                {panelTargets.map(t => {
                  const isSelected = selectedIds.includes(t.id);
                  const isDragOver = dragOverId === t.id && dragTargetRef.current !== t.id;
                  const isDetail = detailViewIds.includes(t.id);
                  return (
                    <div
                      key={t.id}
                      className={cn(
                        'relative group/card select-none rounded-lg border transition-colors',
                        isDetail ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                        isSelected
                          ? 'border-blue-500 ring-1 ring-blue-500/40 bg-blue-950/20'
                          : 'border-gray-800 hover:border-blue-700',
                        isDragOver && 'ring-2 ring-blue-500 ring-offset-1 ring-offset-gray-900'
                      )}
                      title={isSelected ? 'Click to deselect' : 'Click to filter charts to this target'}
                      draggable
                      onDragStart={(e) => handleTargetDragStart(e, t.id)}
                      onDragEnter={() => handleTargetDragEnter(t.id)}
                      onDragOver={(e) => e.preventDefault()}
                      onDragEnd={handleTargetDragEnd}
                    >
                      {/* Detail / summary view toggle button */}
                      <button
                        className="absolute top-1.5 right-1.5 z-10 p-0.5 rounded text-gray-600 hover:text-blue-400 hover:bg-gray-800 transition-colors opacity-0 group-hover/card:opacity-100 focus:opacity-100"
                        onClick={(e) => { e.stopPropagation(); toggleDetailView(t.id); }}
                        title={isDetail ? 'Switch to summary view' : 'Switch to detail view'}
                        aria-label={isDetail ? 'Switch to summary view' : 'Switch to detail view'}
                      >
                        {isDetail ? <AlignJustify size={11} /> : <LayoutGrid size={11} />}
                      </button>
                      <HostCard
                        target={t}
                        lastPingResult={lastPingResults[t.id]}
                        sparklineData={sparklineData[t.id] || []}
                        isSelected={isSelected}
                        onTargetClick={toggleTarget}
                        hideExport
                        viewMode={isDetail ? 'detailed' : 'summary'}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Panel resize handle */}
            <div
              className="w-1 flex-shrink-0 bg-gray-800 hover:bg-blue-600 cursor-col-resize transition-colors group relative"
              onMouseDown={handlePanelResizeMouseDown}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') { const v = Math.max(PANEL_MIN, panelWidthRef.current - 20); panelWidthRef.current = v; setPanelWidth(v); localStorage.setItem('fsPanelWidth', v); }
                if (e.key === 'ArrowRight') { const v = Math.min(PANEL_MAX, panelWidthRef.current + 20); panelWidthRef.current = v; setPanelWidth(v); localStorage.setItem('fsPanelWidth', v); }
              }}
              tabIndex={0}
              role="separator"
              aria-orientation="vertical"
              aria-label="Drag or use arrow keys to resize the targets panel"
              title="Drag or use arrow keys to resize panel"
            >
              <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 flex items-center pointer-events-none opacity-0 group-hover:opacity-60">
                <GripVertical size={14} className="text-gray-400" />
              </div>
            </div>
          </>
        )}

        {/* Main content area — arrangeable widget grid (drag header to move, edge/corner to resize) */}
        <div className="flex-1 min-w-0 min-h-0 overflow-y-auto p-3">
          <DashboardGrid storageKey="fsDashLayout" widgets={fsWidgets} />
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
