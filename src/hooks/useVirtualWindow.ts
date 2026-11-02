import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { useDisplayPreferences } from '../platform/tvEnvironment';
import {
  registerVirtualContainer,
  unregisterVirtualContainer,
  getActiveVirtualContainerCount,
  invalidateCandidateCache,
} from '../navigation';

const BASE_TV_FONT_SIZE_PX = 16;

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
  listOffsetTop: number;
  ensureIndexMounted: (targetIndex: number, preserveIndex?: number) => boolean;
  scrollContainerCallbackRef: (node: HTMLElement | null) => void;
  virtualContainerCallbackRef: (node: HTMLElement | null) => void;
  remeasureLayout: () => void;
}

export interface VirtualWindowBounds {
  totalRows: number;
  windowRows: number;
  maxStartRow: number;
  maxStartIndex: number;
  startIndex: number;
  endIndex: number;
  startRow: number;
  endRow: number;
}

export interface VirtualWindowDiagnostics {
  activeScrollListeners: number;
  activeVirtualContainers: number;
  layoutMeasureCount: number;
}

const attachedScrollContainers = new Set<HTMLElement>();
let layoutMeasureCount = 0;

export function getVirtualWindowDiagnostics(): VirtualWindowDiagnostics {
  return {
    activeScrollListeners: attachedScrollContainers.size,
    activeVirtualContainers: getActiveVirtualContainerCount(),
    layoutMeasureCount,
  };
}

export function resetVirtualWindowDiagnostics(): void {
  layoutMeasureCount = 0;
}

/**
 * Centralizes virtual window bounds calculation considering total rows (including an incomplete final row)
 * and maintaining row alignment while allowing endIndex to reach totalCount.
 */
export function computeVirtualWindowBounds(params: {
  totalCount: number;
  columns: number;
  alignedWindowSize: number;
  requestedStartIndex: number;
}): VirtualWindowBounds {
  const safeTotal = Math.max(0, Math.floor(params.totalCount));
  const safeCols = Math.max(1, Math.floor(params.columns));
  const safeWindowSize = Math.max(
    safeCols,
    Math.floor(Math.max(safeCols, params.alignedWindowSize) / safeCols) * safeCols
  );

  if (safeTotal === 0) {
    return {
      totalRows: 0,
      windowRows: Math.max(1, Math.floor(safeWindowSize / safeCols)),
      maxStartRow: 0,
      maxStartIndex: 0,
      startIndex: 0,
      endIndex: 0,
      startRow: 0,
      endRow: 0,
    };
  }

  const totalRows = Math.ceil(safeTotal / safeCols);
  const windowRows = Math.max(1, Math.floor(safeWindowSize / safeCols));
  const maxStartRow = safeTotal <= safeWindowSize ? 0 : Math.max(0, totalRows - windowRows);
  const maxStartIndex = maxStartRow * safeCols;

  const clampedRequested = Math.max(0, Math.min(safeTotal - 1, Math.floor(params.requestedStartIndex)));
  const requestedRow = Math.floor(clampedRequested / safeCols);
  const startRow = safeTotal <= safeWindowSize ? 0 : Math.min(maxStartRow, Math.max(0, requestedRow));
  const startIndex = startRow * safeCols;
  const endIndex = Math.min(safeTotal, startIndex + safeWindowSize);
  const endRow = Math.ceil(endIndex / safeCols);

  return {
    totalRows,
    windowRows,
    maxStartRow,
    maxStartIndex,
    startIndex,
    endIndex,
    startRow,
    endRow,
  };
}

function computeBreakpointGridColumns(widthPx: number): number {
  if (widthPx >= 1280) return 6;
  if (widthPx >= 1024) return 5;
  if (widthPx >= 768) return 4;
  if (widthPx >= 640) return 3;
  return 2;
}

function getEffectiveRootFontSizePx(displayMode: 'default' | 'tv', tvScale: number): number {
  if (typeof document !== 'undefined' && document.documentElement) {
    const inlineSize = parseFloat(document.documentElement.style.fontSize || '');
    if (Number.isFinite(inlineSize) && inlineSize > 0) {
      return inlineSize;
    }
    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
      try {
        const computed = parseFloat(window.getComputedStyle(document.documentElement).fontSize || '');
        if (Number.isFinite(computed) && computed > 0) {
          return computed;
        }
      } catch {}
    }
  }
  if (displayMode === 'tv') {
    const clampedScale = Math.max(50, Math.min(125, tvScale));
    return Number(((BASE_TV_FONT_SIZE_PX * clampedScale) / 100).toFixed(2));
  }
  return 16;
}

function computeTvAutoFillGridMetrics(
  containerWidthPx: number,
  rootFontSizePx: number
): { columns: number; rowHeightPx: number } {
  // Matches .nc-tv-media-grid in src/index.css:
  // --nc-tv-card-min: 8.75rem; --nc-tv-grid-gap: 0.72rem; aspect-[2/3]
  const cardMinPx = 8.75 * rootFontSizePx;
  const gapPx = 0.72 * rootFontSizePx;
  const safeWidth = Math.max(cardMinPx, containerWidthPx);
  const columns = Math.max(1, Math.floor((safeWidth + gapPx) / (cardMinPx + gapPx)));
  const cardWidthPx = Math.max(cardMinPx, (safeWidth - Math.max(0, columns - 1) * gapPx) / columns);
  const cardHeightPx = cardWidthPx * 1.5;
  const rowHeightPx = Math.max(48, Math.round(cardHeightPx + gapPx));
  return { columns, rowHeightPx };
}

function findListIndexAtScrollOffset(
  offsetPx: number,
  totalCount: number,
  defaultItemHeightPx: number,
  measuredHeights: Map<number, number>
): number {
  if (totalCount <= 0 || offsetPx <= 0) return 0;
  if (measuredHeights.size === 0) {
    return Math.min(totalCount - 1, Math.max(0, Math.floor(offsetPx / defaultItemHeightPx)));
  }

  let acc = 0;
  for (let i = 0; i < totalCount; i++) {
    const h = measuredHeights.get(i) ?? defaultItemHeightPx;
    if (acc + h > offsetPx) {
      return i;
    }
    acc += h;
  }
  return Math.max(0, totalCount - 1);
}

function computeListCumulativeOffset(
  startIdx: number,
  endIdx: number,
  defaultItemHeightPx: number,
  measuredHeights: Map<number, number>
): number {
  const count = Math.max(0, endIdx - startIdx);
  if (count <= 0) return 0;
  let total = count * defaultItemHeightPx;
  if (measuredHeights.size > 0) {
    measuredHeights.forEach((h, idx) => {
      if (idx >= startIdx && idx < endIdx && h > 0) {
        total += h - defaultItemHeightPx;
      }
    });
  }
  return Math.max(0, Math.round(total));
}

function getCurrentExternalTopSpacerHeightPx(virtualEl: HTMLElement): number {
  const prevSibling = virtualEl.previousElementSibling as HTMLElement | null;
  if (!prevSibling || prevSibling.getAttribute('data-virtual-spacer') !== 'top') {
    return 0;
  }
  const rect = prevSibling.getBoundingClientRect();
  if (rect.height > 0) {
    return rect.height;
  }
  const inlineHeight = parseFloat(prevSibling.style?.height || '');
  if (Number.isFinite(inlineHeight) && inlineHeight >= 0) {
    return inlineHeight;
  }
  if (prevSibling.offsetHeight > 0) {
    return prevSibling.offsetHeight;
  }
  return 0;
}

function computeOffsetTopRelativeToScrollContainer(
  targetEl: HTMLElement,
  scrollContainerEl: HTMLElement
): number {
  let total = 0;
  let curr: HTMLElement | null = targetEl;
  let reachedScroll = false;
  let guard = 0;

  while (curr && curr !== scrollContainerEl && guard < 32) {
    total += curr.offsetTop || 0;
    const parent = curr.offsetParent as HTMLElement | null;
    if (!parent) {
      break;
    }
    if (parent === scrollContainerEl) {
      reachedScroll = true;
      break;
    }
    curr = parent;
    guard++;
  }

  if (!reachedScroll && targetEl.offsetParent === scrollContainerEl.offsetParent) {
    total -= scrollContainerEl.offsetTop || 0;
  }

  return Math.max(0, total);
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
  const { effectiveMode: displayMode, effectiveTvScale: tvScale } = useDisplayPreferences();
  const effectiveWindowSize = maxWindowItems ?? (mode === 'grid' ? 96 : 80);

  // Track the actual mounted DOM elements so unmounting/remounting (e.g. LiveTvView category -> channels -> categories -> channels)
  // deterministically detaches old listeners/controllers and attaches to the new DOM elements.
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(() => scrollContainerRef.current);
  const [virtualEl, setVirtualEl] = useState<HTMLElement | null>(() => virtualContainerRef.current);

  const scrollContainerCallbackRef = useCallback(
    (node: HTMLElement | null) => {
      (scrollContainerRef as React.MutableRefObject<HTMLElement | null>).current = node;
      setScrollEl((prev) => (prev !== node ? node : prev));
    },
    [scrollContainerRef]
  );

  const virtualContainerCallbackRef = useCallback(
    (node: HTMLElement | null) => {
      (virtualContainerRef as React.MutableRefObject<HTMLElement | null>).current = node;
      setVirtualEl((prev) => (prev !== node ? node : prev));
    },
    [virtualContainerRef]
  );

  // Also synchronize if consumer only passed RefObject without attaching the callbackRef directly
  useLayoutEffect(() => {
    if (scrollContainerRef.current !== scrollEl) {
      setScrollEl(scrollContainerRef.current);
    }
    if (virtualContainerRef.current !== virtualEl) {
      setVirtualEl(virtualContainerRef.current);
    }
  });

  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : 1280
  );

  const rootFontSizePx = getEffectiveRootFontSizePx(displayMode, tvScale);
  const scaleFactor = displayMode === 'tv' ? rootFontSizePx / 16 : 1;

  // Measured layout state (updated from actual DOM geometry, computed grid tracks, or container width + TV scale)
  const [measuredColumns, setMeasuredColumns] = useState<number | null>(null);
  const [measuredRowHeightPx, setMeasuredRowHeightPx] = useState<number | null>(null);
  const [measuredListOffsetTop, setMeasuredListOffsetTop] = useState<number | null>(null);
  const [heightMeasurementVersion, setHeightMeasurementVersion] = useState<number>(0);

  // Variable item heights map and visual anchor history for mode === 'list'
  const measuredItemHeightsRef = useRef<Map<number, number>>(new Map());
  const prevListAnchorTopSpacerRef = useRef<number>(0);
  const prevStartIndexForAnchorRef = useRef<number>(0);

  const fallbackColumns =
    mode === 'grid'
      ? displayMode === 'tv'
        ? computeTvAutoFillGridMetrics(
            Math.max(320, viewportWidth - Math.round(18 * rootFontSizePx)),
            rootFontSizePx
          ).columns
        : computeBreakpointGridColumns(viewportWidth)
      : 1;

  const columns = mode === 'grid' ? Math.max(1, measuredColumns ?? fallbackColumns) : 1;

  const fallbackRowHeightPx =
    mode === 'grid'
      ? displayMode === 'tv'
        ? computeTvAutoFillGridMetrics(
            Math.max(320, viewportWidth - Math.round(18 * rootFontSizePx)),
            rootFontSizePx
          ).rowHeightPx
        : Math.max(180, Math.round(260 * scaleFactor))
      : Math.max(36, Math.round(68 * scaleFactor));

  const rowHeightPx = Math.max(32, measuredRowHeightPx ?? fallbackRowHeightPx);
  const listOffsetTop = measuredListOffsetTop ?? (mode === 'grid' ? 88 : 8);

  // Align window size to a multiple of columns so every window starts/ends on complete grid rows
  const alignedWindowSize =
    mode === 'grid'
      ? Math.max(columns * 6, Math.floor(Math.max(columns, effectiveWindowSize) / columns) * columns)
      : Math.max(1, effectiveWindowSize);

  const [windowStart, setWindowStart] = useState<number>(0);
  const windowStartRef = useRef<number>(0);
  windowStartRef.current = windowStart;

  const isFrozenRef = useRef<boolean>(isFrozen);
  isFrozenRef.current = isFrozen;

  // Clear variable height cache when category/resetKey or display scale changes
  const layoutResetSignature = `${resetKey}|${displayMode}|${tvScale}`;
  const prevLayoutResetSigRef = useRef<string>(layoutResetSignature);
  if (prevLayoutResetSigRef.current !== layoutResetSignature) {
    const prevKeyOnly = prevLayoutResetSigRef.current.split('|')[0];
    prevLayoutResetSigRef.current = layoutResetSignature;
    measuredItemHeightsRef.current.clear();
    if (prevKeyOnly !== resetKey && windowStart !== 0) {
      setWindowStart(0);
      windowStartRef.current = 0;
    }
  }

  // Measure real layout from DOM (grid columns, row stride, container offset, and variable list item heights)
  const remeasureLayout = useCallback(() => {
    layoutMeasureCount++;
    const currentRootRem = getEffectiveRootFontSizePx(displayMode, tvScale);
    const currentScaleFactor = displayMode === 'tv' ? currentRootRem / 16 : 1;

    // 1. Measure listOffsetTop using measurements belonging strictly to the current render
    if (scrollEl && virtualEl) {
      const sRect = scrollEl.getBoundingClientRect();
      const vRect = virtualEl.getBoundingClientRect();
      const currentExternalSpacerPx = getCurrentExternalTopSpacerHeightPx(virtualEl);
      if (sRect.height > 0 && vRect.height > 0) {
        const rawOffset =
          vRect.top -
          sRect.top +
          (scrollEl.scrollTop || 0) -
          currentExternalSpacerPx;
        const clampedOffset = Math.max(0, Math.round(rawOffset));
        setMeasuredListOffsetTop((prev) => (prev !== clampedOffset ? clampedOffset : prev));
      } else if (virtualEl.offsetTop > 0) {
        const relativeOffsetTop = computeOffsetTopRelativeToScrollContainer(virtualEl, scrollEl);
        const rawOffset = Math.max(0, Math.round(relativeOffsetTop - currentExternalSpacerPx));
        setMeasuredListOffsetTop((prev) => (prev !== rawOffset ? rawOffset : prev));
      }
    }

    if (mode === 'grid') {
      let nextCols: number | null = null;
      let nextRowStride: number | null = null;

      // Priority A: Measure from rendered grid item bounding rects
      if (virtualEl) {
        const items = (Array.from(
          virtualEl.querySelectorAll('[data-virtual-index]')
        ) as HTMLElement[]).slice(0, 18);
        if (items.length > 0) {
          const firstRect = items[0].getBoundingClientRect();
          if (firstRect.width > 0 && firstRect.height > 0) {
            let firstRowCount = 0;
            let secondRowTop: number | null = null;
            for (const item of items) {
              const r = item.getBoundingClientRect();
              if (r.width <= 0 || r.height <= 0) continue;
              if (Math.abs(r.top - firstRect.top) < firstRect.height * 0.4) {
                firstRowCount++;
              } else if (r.top >= firstRect.top + firstRect.height * 0.5) {
                secondRowTop = r.top;
                break;
              }
            }
            if (secondRowTop !== null && firstRowCount >= 1) {
              nextCols = firstRowCount;
              nextRowStride = Math.max(48, Math.round(secondRowTop - firstRect.top));
            } else if (firstRowCount >= 1 && items.length > firstRowCount) {
              nextCols = firstRowCount;
              nextRowStride = Math.max(48, Math.round(firstRect.height + 16 * currentScaleFactor));
            }
          }
        }

        // Priority B: Resolved pixel tracks in getComputedStyle(virtualEl).gridTemplateColumns
        if (
          nextCols === null &&
          typeof window !== 'undefined' &&
          typeof window.getComputedStyle === 'function'
        ) {
          try {
            const gtc = window.getComputedStyle(virtualEl).gridTemplateColumns || '';
            const trimmed = gtc.trim();
            if (/^\d+(\.\d+)?px(\s+\d+(\.\d+)?px)*$/.test(trimmed)) {
              const tracks = trimmed.split(/\s+/);
              if (tracks.length >= 1) {
                nextCols = tracks.length;
              }
            }
          } catch {}
        }
      }

      // Priority C: Container width + displayMode / tvScale calculation
      if (nextCols === null || nextRowStride === null) {
        const vRectWidth = virtualEl?.getBoundingClientRect().width || 0;
        const vClientWidth = virtualEl?.clientWidth || 0;
        const sRectWidth = scrollEl?.getBoundingClientRect().width || 0;
        const sClientWidth = scrollEl?.clientWidth || 0;

        const hasExplicitVirtualWidth = vRectWidth > 0 || vClientWidth > 0;
        const containerWidth =
          vRectWidth > 0
            ? vRectWidth
            : vClientWidth > 0
              ? vClientWidth
              : sRectWidth > 0
                ? Math.max(240, sRectWidth - 48)
                : sClientWidth > 0
                  ? sClientWidth
                  : viewportWidth;

        if (displayMode === 'tv') {
          const metrics = computeTvAutoFillGridMetrics(containerWidth, currentRootRem);
          if (nextCols === null) nextCols = metrics.columns;
          if (nextRowStride === null) nextRowStride = metrics.rowHeightPx;
        } else {
          const widthForBreakpoints = hasExplicitVirtualWidth ? containerWidth : viewportWidth;
          if (nextCols === null) {
            nextCols = computeBreakpointGridColumns(widthForBreakpoints);
          }
          if (nextRowStride === null) {
            nextRowStride = Math.max(180, Math.round(260 * currentScaleFactor));
          }
        }
      }

      setMeasuredColumns((prev) => (prev !== nextCols ? nextCols : prev));
      setMeasuredRowHeightPx((prev) => (prev !== nextRowStride ? nextRowStride : prev));
    } else {
      // mode === 'list': Measure variable heights of rendered channel items
      setMeasuredColumns(1);
      const defaultItemHeight = Math.max(36, Math.round(68 * currentScaleFactor));
      const listGapPx = Math.max(4, Math.round(8 * currentScaleFactor));

      if (virtualEl) {
        const items = Array.from(
          virtualEl.querySelectorAll('[data-virtual-index]')
        ) as HTMLElement[];
        let anyHeightChanged = false;
        let measuredSum = 0;
        let measuredCount = 0;

        for (let i = 0; i < items.length; i++) {
          const el = items[i];
          const idxAttr = parseInt(el.getAttribute('data-virtual-index') || '-1', 10);
          if (isNaN(idxAttr) || idxAttr < 0) continue;

          const rect = el.getBoundingClientRect();
          let itemStride = 0;

          if (rect.height > 0) {
            const nextEl = items[i + 1];
            const nextIdx = nextEl
              ? parseInt(nextEl.getAttribute('data-virtual-index') || '-1', 10)
              : -1;
            const nextRect = nextEl ? nextEl.getBoundingClientRect() : null;
            if (nextRect && nextRect.height > 0 && nextIdx === idxAttr + 1 && nextRect.top > rect.top) {
              itemStride = Math.round(nextRect.top - rect.top);
            } else {
              itemStride = Math.round(rect.height + listGapPx);
            }
          } else if (el.offsetHeight > 0) {
            itemStride = Math.round(el.offsetHeight + listGapPx);
          }

          if (itemStride > 0) {
            measuredSum += itemStride;
            measuredCount++;
            const prevMeasured = measuredItemHeightsRef.current.get(idxAttr);
            if (prevMeasured !== itemStride) {
              measuredItemHeightsRef.current.set(idxAttr, itemStride);
              anyHeightChanged = true;
            }
          }
        }

        if (measuredCount > 0) {
          const avgMeasured = Math.max(36, Math.round(measuredSum / measuredCount));
          setMeasuredRowHeightPx((prev) => (prev !== avgMeasured ? avgMeasured : prev));
        } else {
          setMeasuredRowHeightPx((prev) =>
            prev !== defaultItemHeight ? defaultItemHeight : prev
          );
        }

        if (anyHeightChanged) {
          setHeightMeasurementVersion((v) => v + 1);
        }
      } else {
        setMeasuredRowHeightPx((prev) => (prev !== defaultItemHeight ? defaultItemHeight : prev));
      }
    }
  }, [displayMode, tvScale, scrollEl, virtualEl, mode, viewportWidth]);

  // Run layout measurement on mount, container replacement, scale/mode change, or window shift
  useLayoutEffect(() => {
    remeasureLayout();
  }, [remeasureLayout, windowStart, totalCount]);

  // Window resize and ResizeObserver on scrollEl / virtualEl
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => {
      if (window.innerWidth > 0) {
        setViewportWidth(window.innerWidth);
      }
      remeasureLayout();
    };
    window.addEventListener('resize', handleResize, { passive: true });

    let resizeObserver: ResizeObserver | null = null;
    const ResizeObs =
      typeof ResizeObserver !== 'undefined'
        ? ResizeObserver
        : typeof (window as any).ResizeObserver === 'function'
          ? (window as any).ResizeObserver
          : null;

    if (ResizeObs && (scrollEl || virtualEl)) {
      try {
        resizeObserver = new ResizeObs(() => {
          remeasureLayout();
        });
        if (scrollEl) resizeObserver.observe(scrollEl);
        if (virtualEl && virtualEl !== scrollEl) resizeObserver.observe(virtualEl);
      } catch {}
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeObserver) {
        try {
          resizeObserver.disconnect();
        } catch {}
      }
    };
  }, [scrollEl, virtualEl, remeasureLayout]);

  const computeStartForScrollTop = useCallback(
    (scrollTop: number): number => {
      if (totalCount <= alignedWindowSize) return 0;

      const effectiveScrollTop = Math.max(0, scrollTop - listOffsetTop);
      const overscanRows = mode === 'grid' ? 3 : 10;

      let rawFirstVisibleRow = 0;
      if (mode === 'list') {
        rawFirstVisibleRow = findListIndexAtScrollOffset(
          effectiveScrollTop,
          totalCount,
          rowHeightPx,
          measuredItemHeightsRef.current
        );
      } else {
        rawFirstVisibleRow = Math.floor(effectiveScrollTop / rowHeightPx);
      }

      const desiredStartRow = Math.max(0, rawFirstVisibleRow - overscanRows);
      const bounds = computeVirtualWindowBounds({
        totalCount,
        columns,
        alignedWindowSize,
        requestedStartIndex: desiredStartRow * columns,
      });
      return bounds.startIndex;
    },
    [totalCount, alignedWindowSize, listOffsetTop, mode, rowHeightPx, columns]
  );

  // Attach/detach scroll listener whenever the actual scrollEl DOM node mounts, changes, or unmounts
  useEffect(() => {
    if (!scrollEl) return;

    let rafId: number | null = null;
    const updateFromScroll = () => {
      rafId = null;
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
      // Update immediately when jumping >= 2 rows, or via rAF for small incremental scrolls
      if (Math.abs(nextStart - windowStartRef.current) >= columns * 2) {
        if (rafId !== null && typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        windowStartRef.current = nextStart;
        setWindowStart(nextStart);
      } else if (rafId === null) {
        rafId = requestAnimationFrame(updateFromScroll);
      }
    };

    scrollEl.addEventListener('scroll', handleScroll, { passive: true });
    attachedScrollContainers.add(scrollEl);

    // Sync window immediately with the mounted container's current scrollTop
    if (!isFrozenRef.current) {
      const syncedStart = computeStartForScrollTop(scrollEl.scrollTop || 0);
      if (syncedStart !== windowStartRef.current) {
        windowStartRef.current = syncedStart;
        setWindowStart(syncedStart);
      }
    }

    return () => {
      if (rafId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      scrollEl.removeEventListener('scroll', handleScroll);
      attachedScrollContainers.delete(scrollEl);
    };
  }, [scrollEl, computeStartForScrollTop, columns]);

  // Synchronous window shift for D-pad navigation (called by spatialNav before querying candidates)
  const ensureIndexMounted = useCallback(
    (targetIndex: number, preserveIndex?: number): boolean => {
      if (totalCount <= 0) return false;
      const clampedTarget = Math.max(0, Math.min(totalCount - 1, Math.floor(targetIndex)));

      const curBounds = computeVirtualWindowBounds({
        totalCount,
        columns,
        alignedWindowSize,
        requestedStartIndex: windowStartRef.current,
      });

      if (totalCount <= alignedWindowSize) {
        if (windowStartRef.current !== 0) {
          windowStartRef.current = 0;
          try {
            flushSync(() => {
              setWindowStart(0);
            });
          } catch {
            setWindowStart(0);
          }
          return true;
        }
        return false;
      }

      const curStart = curBounds.startIndex;
      const curEnd = curBounds.endIndex;
      const margin = columns * 2;

      const isComfortablyAfterStart = curStart === 0 || clampedTarget >= curStart + margin;
      const isComfortablyBeforeEnd =
        curStart >= curBounds.maxStartIndex || clampedTarget < curEnd - margin;

      if (
        clampedTarget >= curStart &&
        clampedTarget < curEnd &&
        isComfortablyAfterStart &&
        isComfortablyBeforeEnd
      ) {
        return false;
      }

      const targetRow = Math.floor(clampedTarget / columns);
      const windowRows = curBounds.windowRows;
      let desiredStartRow = Math.max(
        0,
        Math.min(curBounds.maxStartRow, targetRow - Math.floor(windowRows / 2))
      );

      // Keep preserveIndex (the currently focused element) mounted during the synchronous transition
      if (
        typeof preserveIndex === 'number' &&
        preserveIndex >= 0 &&
        preserveIndex < totalCount
      ) {
        const preserveRow = Math.floor(preserveIndex / columns);
        if (Math.abs(targetRow - preserveRow) < windowRows) {
          if (desiredStartRow > preserveRow) {
            desiredStartRow = preserveRow;
          } else if (desiredStartRow + windowRows - 1 < preserveRow) {
            desiredStartRow = preserveRow - windowRows + 1;
          }
          if (desiredStartRow > targetRow) {
            desiredStartRow = targetRow;
          } else if (desiredStartRow + windowRows - 1 < targetRow) {
            desiredStartRow = targetRow - windowRows + 1;
          }
          desiredStartRow = Math.max(0, Math.min(curBounds.maxStartRow, desiredStartRow));
        }
      }

      const nextBounds = computeVirtualWindowBounds({
        totalCount,
        columns,
        alignedWindowSize,
        requestedStartIndex: desiredStartRow * columns,
      });
      const nextStart = nextBounds.startIndex;

      if (nextStart === curStart) return false;

      windowStartRef.current = nextStart;
      try {
        flushSync(() => {
          setWindowStart(nextStart);
        });
      } catch {
        setWindowStart(nextStart);
      }

      // Sync scrollTop so the container scroll position tracks the newly mounted D-pad target
      const activeScrollEl = scrollContainerRef.current || scrollEl;
      if (activeScrollEl) {
        const approxTargetTop =
          mode === 'list'
            ? listOffsetTop +
              computeListCumulativeOffset(0, clampedTarget, rowHeightPx, measuredItemHeightsRef.current)
            : listOffsetTop + targetRow * rowHeightPx;
        const viewHeight = activeScrollEl.clientHeight || 720;
        if (approxTargetTop > activeScrollEl.scrollTop + viewHeight - rowHeightPx) {
          activeScrollEl.scrollTop = Math.max(0, approxTargetTop - viewHeight + rowHeightPx * 2);
        } else if (approxTargetTop < activeScrollEl.scrollTop) {
          activeScrollEl.scrollTop = Math.max(0, approxTargetTop - listOffsetTop);
        }
      }

      return true;
    },
    [
      totalCount,
      alignedWindowSize,
      columns,
      rowHeightPx,
      listOffsetTop,
      mode,
      scrollContainerRef,
      scrollEl,
    ]
  );

  // Register/unregister virtual container controller whenever the actual virtualEl DOM node mounts, changes, or unmounts
  useLayoutEffect(() => {
    if (!virtualEl) return;
    registerVirtualContainer(virtualEl, {
      totalCount,
      getColumns: () => columns,
      ensureIndexMounted,
    });
    return () => {
      unregisterVirtualContainer(virtualEl);
      invalidateCandidateCache();
    };
  }, [virtualEl, totalCount, columns, ensureIndexMounted]);

  const bounds = computeVirtualWindowBounds({
    totalCount,
    columns,
    alignedWindowSize,
    requestedStartIndex: windowStart,
  });

  const { startIndex, endIndex, startRow, endRow, totalRows } = bounds;

  // Compute top and bottom spacers (using variable item heights in 'list' mode when available)
  void heightMeasurementVersion;
  const topSpacerPx =
    mode === 'list'
      ? computeListCumulativeOffset(0, startIndex, rowHeightPx, measuredItemHeightsRef.current)
      : startRow * rowHeightPx;

  const bottomSpacerPx =
    mode === 'list'
      ? computeListCumulativeOffset(endIndex, totalCount, rowHeightPx, measuredItemHeightsRef.current)
      : Math.max(0, (totalRows - endRow) * rowHeightPx);

  // Preserve visual scroll anchor if variable item height refinements adjusted topSpacerPx while startIndex stayed constant
  useLayoutEffect(() => {
    if (
      mode === 'list' &&
      scrollEl &&
      prevStartIndexForAnchorRef.current === startIndex &&
      prevListAnchorTopSpacerRef.current !== topSpacerPx &&
      scrollEl.scrollTop > 0
    ) {
      const delta = topSpacerPx - prevListAnchorTopSpacerRef.current;
      if (Math.abs(delta) > 1) {
        scrollEl.scrollTop = Math.max(0, scrollEl.scrollTop + delta);
      }
    }
    prevStartIndexForAnchorRef.current = startIndex;
    prevListAnchorTopSpacerRef.current = topSpacerPx;
  }, [mode, scrollEl, startIndex, topSpacerPx]);

  return {
    startIndex,
    endIndex,
    topSpacerPx,
    bottomSpacerPx,
    columns,
    rowHeightPx,
    listOffsetTop,
    ensureIndexMounted,
    scrollContainerCallbackRef,
    virtualContainerCallbackRef,
    remeasureLayout,
  };
}
