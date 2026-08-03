import { useMemo, useRef, useState, useCallback } from 'react';
import GridLayout, { WidthProvider } from 'react-grid-layout';
import Widget from './Widget';

const RGL = WidthProvider(GridLayout);

const COLS = 12;
const ROW_HEIGHT = 30;
const MARGIN = [12, 12];
const DEFAULT_STORAGE_KEY = 'dashLayoutV3';

/**
 * Flow widgets left-to-right, wrapping at COLS, to produce a default layout for
 * any widget the user hasn't positioned yet.
 */
function flowLayout(widgets) {
  const items = [];
  let x = 0, y = 0, rowH = 0;
  for (const w of widgets) {
    const ww = Math.min(w.w || 3, COLS);
    if (x + ww > COLS) { x = 0; y += rowH; rowH = 0; }
    items.push({ i: w.id, x, y, w: ww, h: w.h || 6, minW: w.minW || 2, minH: w.minH || 2 });
    x += ww;
    rowH = Math.max(rowH, w.h || 6);
  }
  return items;
}

function loadSaved(storageKey) {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey));
    return Array.isArray(raw) ? raw : null;
  } catch { return null; }
}

/**
 * DashboardGrid — draggable + resizable widget grid (react-grid-layout).
 *
 * Props:
 *   widgets – [{ id, title, right?, w, h, minW, minH, render(size) }]
 *             `render` receives the measured content size { width, height }.
 *
 * Layout (position + size of every widget) is persisted to localStorage and
 * reconciled with the current widget set on every render: known widgets keep
 * their saved geometry, brand-new widgets are flowed in with their defaults,
 * and vanished widgets are dropped.
 */
export default function DashboardGrid({ widgets, storageKey = DEFAULT_STORAGE_KEY }) {
  const savedRef = useRef(loadSaved(storageKey));

  // Merge saved geometry with defaults for the current widget set.
  const layout = useMemo(() => {
    const defaults = flowLayout(widgets);
    const savedById = new Map((savedRef.current || []).map((l) => [l.i, l]));
    return defaults.map((def) => {
      const s = savedById.get(def.i);
      return s
        ? { ...def, x: s.x, y: s.y, w: s.w, h: s.h }
        : def;
    });
  }, [widgets]);

  const [, force] = useState(0);

  const handleLayoutChange = useCallback((next) => {
    savedRef.current = next.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
    localStorage.setItem(storageKey, JSON.stringify(savedRef.current));
    force((n) => n + 1);
  }, [storageKey]);

  return (
    <RGL
      className="layout"
      layout={layout}
      cols={COLS}
      rowHeight={ROW_HEIGHT}
      margin={MARGIN}
      draggableHandle=".widget-drag-handle"
      resizeHandles={['se', 'e', 's']}
      compactType="vertical"
      isBounded
      onDragStop={handleLayoutChange}
      onResizeStop={handleLayoutChange}
    >
      {widgets.map((w) => (
        <div key={w.id}>
          <Widget title={w.title} right={w.right}>
            {w.render}
          </Widget>
        </div>
      ))}
    </RGL>
  );
}
