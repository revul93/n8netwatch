import { useState, useRef, useLayoutEffect } from 'react';

/**
 * useElementSize — track an element's content-box size with a ResizeObserver.
 * Returns [ref, { width, height }]. Attach ref to the element you want measured.
 *
 * Used so charts inside freely-resizable dashboard widgets can fill whatever
 * height react-grid-layout gives the widget.
 */
export function useElementSize() {
  const ref = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const update = () => {
      const rect = el.getBoundingClientRect();
      setSize((prev) =>
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      );
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, size];
}
