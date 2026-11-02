import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { useDisplayPreferences } from '../platform/tvEnvironment';
import { registerVirtualContainer, unregisterVirtualContainer } from '../navigation';

export interface UseVirtualWindowOptions {
  totalCount: number;
  mode: 'grid' | 'list';
  scrollContainerRef: React.RefObject<HTMLElement | null>;
  virtualContainerRef: React.RefObject<HTMLElement | null>;
  isFrozen?: boolean;
  resetKey?: string;
  maxWindowItems?: number;
}

export interface VirtualWindowResult {
  startIndex: number;
  endIndex: number;
  topSpacerPx: number;
  bottomSpacerPx: number;
  columns: number;
  rowHeightPx: number;
  ensureIndexMounted: (targetIndex: number) => boolean;
}

function computeGridColumns(viewportWidth: number): number {
  if (viewportWidth >= 1280) return 6;
  if (viewportWidth >= 1024) return 5;
  if (viewportWidth >= 768) return 4;
  if (viewportWidth >= 640) return 3;
  return 2;
}

export function useVirtualWindow({
  totalCount,
  mode,
  scrollContainerRef,
  virtualContainerRef,
  isFrozen = false,
  resetKey = '',
  maxWindowItems,
}: UseVirtualWindowOptions): VirtualWindowResult {
  const { mode: displayMode, tvScale } = useDisplayPreferences();
  const effectiveWindowSize = maxWindowItems ?? (mode === 'grid' ? 96 : 80);

  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : 1280
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => {
      if (window.innerWidth > 0) {
        setViewportWidth(window.innerWidth);
      }
    };
    window.addEventListener('resize', handleResize, { passive: true });
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const scaleFactor = displayMode === 'tv' ? Math.max(0.5, Math.min(1.5, tvScale / 100)) : 1;
  const columns = mode === 'grid' ? computeGridColumns(viewportWidth) : 1;
  const baseRowHeight = mode === 'grid' ? 260 : 68;
  const rowHeightPx = Math.max(36, Math.round(baseRowHeight * scaleFactor));

  // Align window size to a multiple of columns
  const alignedWindowSize =
    mode === 'grid'
      ? Math.max(columns * 6, Math.floor(effectiveWindowSize / columns) * columns)
      : effectiveWindowSize;

  const [windowStart, setWindowStart] = useState<number>(0);
  const windowStartRef = useRef<number>(0);
  windowStartRef.current = windowStart;

  const isFrozenRef = useRef<boolean>(isFrozen);
  isFrozenRef.current = isFrozen;

  const prevResetKeyRef = useRef<string>(resetKey);
  if (prevResetKeyRef.current !== resetKey) {
    prevResetKeyRef.current = resetKey;
    if (windowStart !== 0) {
      setWindowStart(0);
      windowStartRef.current = 0;
    }
  }

  const computeStartForScrollTop = useCallback(
    (scrollTop: number): number => {
      if (totalCount <= alignedWindowSize) return 0;
      // Keep top-anchored window (startIndex = 0) for top region scrolls (<= 900px)
      // so initial cards stay mounted without spacer shifts during top-of-page interactions
      if (scrollTop <= 900) return 0;

      const rawFirstVisibleRow = Math.floor(Math.max(0, scrollTop - 160) / rowHeightPx);
      const overscanRows = mode === 'grid' ? 3 : 10;
      const startRow = Math.max(0, rawFirstVisibleRow - overscanRows);
      const candidateStart = startRow * columns;
      const maxStart = Math.max(
        0,
        Math.floor((totalCount - alignedWindowSize) / columns) * columns
      );
      return Math.min(maxStart, candidateStart);
    },
    [totalCount, alignedWindowSize, rowHeightPx, mode, columns]
  );

  // Listen to scroll events on scrollContainerRef
  useEffect(() => {
    const scrollEl = scrollContainerRef.current;
    if (!scrollEl) return;

    let rafPending = false;
    const updateFromScroll = () => {
      rafPending = false;
      if (isFrozenRef.current) return;
      const nextStart = computeStartForScrollTop(scrollEl.scrollTop || 0);
      if (nextStart !== windowStartRef.current) {
        windowStartRef.current = nextStart;
        setWindowStart(nextStart);
      }
    };

    const handleScroll = () => {
      if (isFrozenRef.current) return;
      const nextStart = computeStartForScrollTop(scrollEl.scrollTop || 0);
      if (nextStart === windowStartRef.current) return;
      // Update immediately when jumping far, or via rAF
      if (Math.abs(nextStart - windowStartRef.current) >= columns * 2) {
        windowStartRef.current = nextStart;
        setWindowStart(nextStart);
      } else if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(updateFromScroll);
      }
    };

    scrollEl.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      scrollEl.removeEventListener('scroll', handleScroll);
    };
  }, [scrollContainerRef, computeStartForScrollTop, columns]);

  // Synchronous window shift for D-pad navigation (called by spatialNav before querying candidates)
  const ensureIndexMounted = useCallback(
    (targetIndex: number): boolean => {
      if (totalCount <= alignedWindowSize) return false;
      const clampedTarget = Math.max(0, Math.min(totalCount - 1, targetIndex));
      const curStart = windowStartRef.current;
      const curEnd = Math.min(totalCount, curStart + alignedWindowSize);

      const margin = columns * 2;
      if (clampedTarget >= curStart + margin && clampedTarget < curEnd - margin) {
        return false;
      }
      if (curStart === 0 && clampedTarget < curEnd - margin) {
        return false;
      }

      const targetRow = Math.floor(clampedTarget / columns);
      const windowRows = Math.floor(alignedWindowSize / columns);
      const desiredStartRow = Math.max(0, targetRow - Math.floor(windowRows / 2));
      const maxStart = Math.max(
        0,
        Math.floor((totalCount - alignedWindowSize) / columns) * columns
      );
      const nextStart = Math.min(maxStart, desiredStartRow * columns);

      if (nextStart === curStart) return false;

      windowStartRef.current = nextStart;
      try {
        flushSync(() => {
          setWindowStart(nextStart);
        });
      } catch {
        setWindowStart(nextStart);
      }

      // Sync scrollTop in headless/virtualized containers so scroll position tracks the window
      const scrollEl = scrollContainerRef.current;
      if (scrollEl) {
        const approxTargetTop = targetRow * rowHeightPx;
        const viewHeight = scrollEl.clientHeight || 720;
        if (approxTargetTop > scrollEl.scrollTop + viewHeight - rowHeightPx) {
          scrollEl.scrollTop = Math.max(0, approxTargetTop - viewHeight + rowHeightPx * 2);
        } else if (approxTargetTop < scrollEl.scrollTop) {
          scrollEl.scrollTop = Math.max(0, approxTargetTop);
        }
      }

      return true;
    },
    [totalCount, alignedWindowSize, columns, rowHeightPx, scrollContainerRef]
  );

  // Register virtual container controller with spatialNav
  useLayoutEffect(() => {
    const containerEl = virtualContainerRef.current;
    if (!containerEl) return;
    registerVirtualContainer(containerEl, {
      totalCount,
      getColumns: () => columns,
      ensureIndexMounted,
    });
    return () => {
      unregisterVirtualContainer(containerEl);
    };
  }, [virtualContainerRef, totalCount, columns, ensureIndexMounted]);

  const maxValidStart =
    totalCount <= alignedWindowSize
      ? 0
      : Math.max(0, Math.floor((totalCount - alignedWindowSize) / columns) * columns);
  const startIndex = Math.min(windowStart, maxValidStart);
  const endIndex = Math.min(totalCount, startIndex + alignedWindowSize);

  const totalRows = Math.ceil(totalCount / columns);
  const startRow = Math.floor(startIndex / columns);
  const endRow = Math.ceil(endIndex / columns);

  const topSpacerPx = startRow * rowHeightPx;
  const bottomSpacerPx = Math.max(0, (totalRows - endRow) * rowHeightPx);

  return {
    startIndex,
    endIndex,
    topSpacerPx,
    bottomSpacerPx,
    columns,
    rowHeightPx,
    ensureIndexMounted,
  };
}
