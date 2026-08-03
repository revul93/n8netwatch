import { GripVertical } from 'lucide-react';
import { useElementSize } from '../hooks/useElementSize';
import { cn } from '../lib/utils';

/**
 * Widget — a draggable/resizable dashboard tile for use inside react-grid-layout.
 *
 * Layout: a fixed header (the drag handle — class `widget-drag-handle` so RGL
 * only starts a drag from here, leaving inner controls clickable) plus a content
 * area that fills the remaining height. The content area's measured size is
 * passed to `children` as a render prop so charts can fill the widget.
 *
 * Props:
 *   title     – header label
 *   right     – optional node rendered at the right of the header (controls)
 *   children  – either a node, or a function ({ width, height }) => node
 *   className – extra classes for the outer tile
 */
export default function Widget({ title, right = null, children, className }) {
  const [contentRef, size] = useElementSize();

  return (
    <div
      className={cn(
        'h-full w-full flex flex-col bg-gray-900 border border-gray-800 rounded-xl overflow-hidden',
        className,
      )}
    >
      {/* Header / drag handle */}
      <div className="widget-drag-handle flex items-center gap-2 px-3 py-2 border-b border-gray-800 cursor-move select-none flex-shrink-0">
        <GripVertical size={13} className="text-gray-600 flex-shrink-0" />
        <span className="text-xs font-semibold text-gray-300 truncate">{title}</span>
        {right && (
          <span
            className="ml-auto flex items-center gap-1"
            // Keep header controls from initiating a drag
            onMouseDown={(e) => e.stopPropagation()}
          >
            {right}
          </span>
        )}
      </div>

      {/* Content — fills remaining height; children can flex to fill it */}
      <div ref={contentRef} className="flex-1 min-h-0 overflow-auto p-3 flex flex-col">
        {typeof children === 'function' ? children(size) : children}
      </div>
    </div>
  );
}
