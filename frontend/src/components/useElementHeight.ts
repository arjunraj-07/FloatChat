'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The rendered height of an element, for charts that need a pixel height.
 * A zero height (the element is hidden) is ignored, so a chart keeps its
 * last size while its section is not shown.
 */
export function useElementHeight(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0].contentRect.height);
      if (next > 0) setHeight(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, height] as const;
}
