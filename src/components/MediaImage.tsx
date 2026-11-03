import React, { useState, useEffect, useRef } from 'react';
import {
  buildDirectImageUrl,
  diagnoseImageUrl,
  isDebugImagesEnabled,
} from '../utils/mediaUtils';

export interface MediaImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src?: unknown;
  serverUrl?: string | null;
  itemId?: string | number;
  itemName?: string;
  priority?: boolean;
  /**
   * Controls whether the image is authorized to initiate its network request.
   * Defaults to true so all consumers outside visibility-gated rows preserve their contract.
   * Once authorized for a given (itemId, resolvedUrl) identity on a mounted instance,
   * authorization is latched across re-renders and visibility exits/re-entries.
   */
  active?: boolean;
  /**
   * Native fetch priority hint ('high' | 'low' | 'auto').
   * Reserved for high-priority presentation assets (such as HeroBanner when priority={true}).
   */
  fetchPriority?: 'high' | 'low' | 'auto';
}

type ImageStatus = 'empty' | 'loading' | 'loaded' | 'retrying' | 'failed';

const MAX_LOADED_URL_CACHE_SIZE = 2500;
const loadedImageUrlsCache = new Set<string>();

let mediaImageRetryDelayMs = 2000;
let activeRetryTimersCount = 0;

export function setMediaImageRetryDelayMsForTest(delayMs: number): void {
  mediaImageRetryDelayMs = Math.max(10, delayMs);
}

export function getActiveMediaImageRetryTimersCount(): number {
  return activeRetryTimersCount;
}

function rememberLoadedImageUrl(url: string | null): void {
  if (!url) return;
  if (loadedImageUrlsCache.has(url)) {
    loadedImageUrlsCache.delete(url);
    loadedImageUrlsCache.add(url);
    return;
  }
  if (loadedImageUrlsCache.size >= MAX_LOADED_URL_CACHE_SIZE) {
    const oldest = loadedImageUrlsCache.values().next().value;
    if (oldest !== undefined) {
      loadedImageUrlsCache.delete(oldest);
    }
  }
  loadedImageUrlsCache.add(url);
}

export function hasLoadedImageUrl(url: string | null | undefined): boolean {
  return Boolean(url && loadedImageUrlsCache.has(url));
}

export function clearLoadedImageUrlCache(): void {
  loadedImageUrlsCache.clear();
}

// ============================================================================
// Shared Container IntersectionObserver Pool & Coalesced Fallback Manager
// ============================================================================

export const VERTICAL_HOME_ROOT_MARGIN = '240px 0px';
export const HORIZONTAL_ROW_ROOT_MARGIN = '0px 280px';

export interface ParsedRootMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function parseRootMarginPx(rawMargin: string): ParsedRootMargin {
  const parts = rawMargin
    .trim()
    .split(/\s+/)
    .map((part) => {
      const n = parseFloat(part);
      return Number.isFinite(n) ? n : 0;
    });
  if (parts.length === 1) {
    return { top: parts[0], right: parts[0], bottom: parts[0], left: parts[0] };
  }
  if (parts.length === 2) {
    return { top: parts[0], right: parts[1], bottom: parts[0], left: parts[1] };
  }
  if (parts.length === 3) {
    return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[1] };
  }
  if (parts.length >= 4) {
    return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] };
  }
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

export interface RootContainerMetrics {
  usable: boolean;
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
  scrollTop: number;
  scrollLeft: number;
  offsetTop: number;
  offsetLeft: number;
}

let perfIoCallbackInvocations = 0;
let perfFallbackEvaluationPasses = 0;
let perfRootRectReads = 0;
let perfTargetRectReads = 0;

export function resetSharedObserverPerfStats(): void {
  perfIoCallbackInvocations = 0;
  perfFallbackEvaluationPasses = 0;
  perfRootRectReads = 0;
  perfTargetRectReads = 0;
}

export function measureRootContainer(
  root: HTMLElement | null,
  axis: 'vertical' | 'horizontal'
): RootContainerMetrics {
  if (root) {
    perfRootRectReads++;
    const rect = root.getBoundingClientRect();
    const scrollTop = root.scrollTop || 0;
    const scrollLeft = root.scrollLeft || 0;
    const offsetTop = root.offsetTop || 0;
    const offsetLeft = root.offsetLeft || 0;

    if (axis === 'vertical') {
      const rectHeight = rect.height > 0 ? rect.height : Math.max(0, rect.bottom - rect.top);
      if (rectHeight > 0) {
        return {
          usable: true,
          top: rect.top,
          bottom: rect.top + rectHeight,
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rectHeight,
          scrollTop,
          scrollLeft,
          offsetTop,
          offsetLeft,
        };
      }
      if (root.clientHeight > 0) {
        return {
          usable: true,
          top: rect.top,
          bottom: rect.top + root.clientHeight,
          left: rect.left,
          right: rect.right,
          width: root.clientWidth || 0,
          height: root.clientHeight,
          scrollTop,
          scrollLeft,
          offsetTop,
          offsetLeft,
        };
      }
      return {
        usable: false,
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        width: 0,
        height: 0,
        scrollTop,
        scrollLeft,
        offsetTop,
        offsetLeft,
      };
    } else {
      const rectWidth = rect.width > 0 ? rect.width : Math.max(0, rect.right - rect.left);
      if (rectWidth > 0) {
        return {
          usable: true,
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.left + rectWidth,
          width: rectWidth,
          height: rect.height,
          scrollTop,
          scrollLeft,
          offsetTop,
          offsetLeft,
        };
      }
      if (root.clientWidth > 0) {
        return {
          usable: true,
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.left + root.clientWidth,
          width: root.clientWidth,
          height: root.clientHeight || 0,
          scrollTop,
          scrollLeft,
          offsetTop,
          offsetLeft,
        };
      }
      return {
        usable: false,
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        width: 0,
        height: 0,
        scrollTop,
        scrollLeft,
        offsetTop,
        offsetLeft,
      };
    }
  }

  const winHeight = typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : 0;
  const winWidth = typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : 0;
  const usable = axis === 'vertical' ? winHeight > 0 : winWidth > 0;

  return {
    usable,
    top: 0,
    bottom: winHeight,
    left: 0,
    right: winWidth,
    width: winWidth,
    height: winHeight,
    scrollTop: typeof window !== 'undefined' ? window.scrollY || 0 : 0,
    scrollLeft: typeof window !== 'undefined' ? window.scrollX || 0 : 0,
    offsetTop: 0,
    offsetLeft: 0,
  };
}

export function inspectElementVisibilityWithRootMetrics(
  target: HTMLElement,
  rootMetrics: RootContainerMetrics,
  margins: ParsedRootMargin,
  axis: 'vertical' | 'horizontal'
): { usable: boolean; isIntersecting: boolean } {
  if (!rootMetrics.usable) {
    return { usable: false, isIntersecting: false };
  }

  perfTargetRectReads++;
  const targetRect = target.getBoundingClientRect();

  if (axis === 'vertical') {
    const targetHeight =
      targetRect.height > 0 ? targetRect.height : Math.max(0, targetRect.bottom - targetRect.top);
    if (targetHeight > 0) {
      const tTop = targetRect.top;
      const tBottom = targetRect.top + targetHeight;
      const isIntersecting =
        tBottom >= rootMetrics.top - margins.top &&
        tTop <= rootMetrics.bottom + margins.bottom;
      return { usable: true, isIntersecting };
    }

    if (target.offsetHeight > 0) {
      const itemTop = target.offsetTop - rootMetrics.offsetTop;
      const itemBottom = itemTop + target.offsetHeight;
      const isIntersecting =
        itemBottom >= rootMetrics.scrollTop - margins.top &&
        itemTop <= rootMetrics.scrollTop + rootMetrics.height + margins.bottom;
      return { usable: true, isIntersecting };
    }

    return { usable: false, isIntersecting: false };
  } else {
    const targetWidth =
      targetRect.width > 0 ? targetRect.width : Math.max(0, targetRect.right - targetRect.left);
    if (targetWidth > 0) {
      const tLeft = targetRect.left;
      const tRight = targetRect.left + targetWidth;
      const isIntersecting =
        tRight >= rootMetrics.left - margins.left &&
        tLeft <= rootMetrics.right + margins.right;
      return { usable: true, isIntersecting };
    }

    if (target.offsetWidth > 0) {
      const itemLeft = target.offsetLeft - rootMetrics.offsetLeft;
      const itemRight = itemLeft + target.offsetWidth;
      const isIntersecting =
        itemRight >= rootMetrics.scrollLeft - margins.left &&
        itemLeft <= rootMetrics.scrollLeft + rootMetrics.width + margins.right;
      return { usable: true, isIntersecting };
    }

    return { usable: false, isIntersecting: false };
  }
}

export function evaluateElementVisibilityInContainer(
  target: HTMLElement,
  root: HTMLElement | null,
  margins: ParsedRootMargin,
  axis: 'vertical' | 'horizontal',
  _index?: number
): boolean {
  const rootMetrics = measureRootContainer(root, axis);
  return inspectElementVisibilityWithRootMetrics(target, rootMetrics, margins, axis).isIntersecting;
}

interface ObservedTargetRecord {
  target: HTMLElement;
  index: number;
  geometryUsable: boolean;
  lastIntersecting: boolean | null;
  listeners: Set<(isIntersecting: boolean) => void>;
}

interface SharedObserverPoolEntry {
  key: string;
  root: HTMLElement | null;
  rootMargin: string;
  parsedMargins: ParsedRootMargin;
  axis: 'vertical' | 'horizontal';
  observer: IntersectionObserver | null;
  usingFallbackOnly: boolean;
  hasScrollListener: boolean;
  hasResizeListener: boolean;
  scheduledFallbackRafId: number | null;
  scheduledGeometryRafId: number | null;
  pendingGeometryCheckAttempts: number;
  syncRootMetricsCache: RootContainerMetrics | null;
  syncRootMetricsClearQueued: boolean;
  resizeObserver: ResizeObserver | null;
  targets: Map<HTMLElement, ObservedTargetRecord>;
  disposeListeners: () => void;
}

const sharedObserverPool = new Map<HTMLElement | null, Map<string, SharedObserverPoolEntry>>();

export interface SharedObserverDiagnostics {
  activeObserverInstances: number;
  activePoolEntries: number;
  activeTargetSubscriptions: number;
  verticalObserverRoots: Array<HTMLElement | null>;
  horizontalObserverRoots: Array<HTMLElement | null>;
  fallbackScrollListeners: number;
  fallbackResizeListeners: number;
  pendingFallbackFrames: number;
  pendingGeometryFrames: number;
  ioCallbackInvocations: number;
  fallbackEvaluationPasses: number;
  rootRectReads: number;
  targetRectReads: number;
}

export function getSharedObserverDiagnostics(): SharedObserverDiagnostics {
  let activeObserverInstances = 0;
  let activePoolEntries = 0;
  let activeTargetSubscriptions = 0;
  let fallbackScrollListeners = 0;
  let fallbackResizeListeners = 0;
  let pendingFallbackFrames = 0;
  let pendingGeometryFrames = 0;
  const verticalObserverRoots: Array<HTMLElement | null> = [];
  const horizontalObserverRoots: Array<HTMLElement | null> = [];

  for (const [, byKey] of sharedObserverPool.entries()) {
    for (const [, entry] of byKey.entries()) {
      activePoolEntries++;
      if (entry.observer) {
        activeObserverInstances++;
      }
      if (entry.hasScrollListener) {
        fallbackScrollListeners++;
      }
      if (entry.hasResizeListener) {
        fallbackResizeListeners++;
      }
      if (entry.scheduledFallbackRafId !== null) {
        pendingFallbackFrames++;
      }
      if (entry.scheduledGeometryRafId !== null) {
        pendingGeometryFrames++;
      }
      if (entry.axis === 'vertical') {
        verticalObserverRoots.push(entry.root);
      } else {
        horizontalObserverRoots.push(entry.root);
      }
      for (const [, targetRec] of entry.targets.entries()) {
        activeTargetSubscriptions += targetRec.listeners.size;
      }
    }
  }

  return {
    activeObserverInstances,
    activePoolEntries,
    activeTargetSubscriptions,
    verticalObserverRoots,
    horizontalObserverRoots,
    fallbackScrollListeners,
    fallbackResizeListeners,
    pendingFallbackFrames,
    pendingGeometryFrames,
    ioCallbackInvocations: perfIoCallbackInvocations,
    fallbackEvaluationPasses: perfFallbackEvaluationPasses,
    rootRectReads: perfRootRectReads,
    targetRectReads: perfTargetRectReads,
  };
}

function getIntersectionObserverConstructor(): typeof IntersectionObserver | null {
  if (typeof window !== 'undefined' && typeof (window as any).IntersectionObserver === 'function') {
    return (window as any).IntersectionObserver;
  }
  if (typeof globalThis !== 'undefined' && typeof (globalThis as any).IntersectionObserver === 'function') {
    return (globalThis as any).IntersectionObserver;
  }
  return null;
}

function getResizeObserverConstructor(): typeof ResizeObserver | null {
  if (typeof window !== 'undefined' && typeof (window as any).ResizeObserver === 'function') {
    return (window as any).ResizeObserver;
  }
  if (typeof globalThis !== 'undefined' && typeof (globalThis as any).ResizeObserver === 'function') {
    return (globalThis as any).ResizeObserver;
  }
  return null;
}

function scheduleAnimationFrame(cb: FrameRequestCallback): number {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    return window.requestAnimationFrame(cb);
  }
  if (typeof globalThis !== 'undefined' && typeof (globalThis as any).requestAnimationFrame === 'function') {
    return (globalThis as any).requestAnimationFrame(cb);
  }
  return setTimeout(() => cb(Date.now()), 16) as unknown as number;
}

function cancelScheduledAnimationFrame(id: number): void {
  if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(id);
    return;
  }
  if (typeof globalThis !== 'undefined' && typeof (globalThis as any).cancelAnimationFrame === 'function') {
    (globalThis as any).cancelAnimationFrame(id);
    return;
  }
  clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
}

function getOrMeasureSyncRootMetrics(entry: SharedObserverPoolEntry): RootContainerMetrics {
  if (entry.syncRootMetricsCache !== null) {
    return entry.syncRootMetricsCache;
  }
  const metrics = measureRootContainer(entry.root, entry.axis);
  entry.syncRootMetricsCache = metrics;
  if (!entry.syncRootMetricsClearQueued) {
    entry.syncRootMetricsClearQueued = true;
    Promise.resolve().then(() => {
      entry.syncRootMetricsCache = null;
      entry.syncRootMetricsClearQueued = false;
    });
  }
  return metrics;
}

/**
 * Re-evaluates all targets in a pool entry using a single container measurement,
 * separating DOM layout reads from listener notifications.
 */
function reevaluatePoolEntryTargets(entry: SharedObserverPoolEntry): void {
  if (entry.targets.size === 0) return;
  perfFallbackEvaluationPasses++;

  // Phase 1: Single container measurement for the entire pass
  const rootMetrics = measureRootContainer(entry.root, entry.axis);
  if (!rootMetrics.usable) {
    schedulePendingGeometryCheck(entry);
    return;
  }

  // Phase 2: Batch all target DOM reads before invoking any state listeners
  const pendingNotifications: Array<{
    targetRec: ObservedTargetRecord;
    isNowIntersecting: boolean;
  }> = [];

  for (const [, targetRec] of entry.targets.entries()) {
    const res = inspectElementVisibilityWithRootMetrics(
      targetRec.target,
      rootMetrics,
      entry.parsedMargins,
      entry.axis
    );
    if (!res.usable) {
      targetRec.geometryUsable = false;
      schedulePendingGeometryCheck(entry);
      continue;
    }
    targetRec.geometryUsable = true;
    if (targetRec.lastIntersecting !== res.isIntersecting) {
      pendingNotifications.push({
        targetRec,
        isNowIntersecting: res.isIntersecting,
      });
    }
  }

  // Phase 3: Organized notifications after all layout reads have completed
  for (const { targetRec, isNowIntersecting } of pendingNotifications) {
    targetRec.lastIntersecting = isNowIntersecting;
    for (const listener of Array.from(targetRec.listeners)) {
      listener(isNowIntersecting);
    }
  }
}

function scheduleFallbackReevaluation(entry: SharedObserverPoolEntry): void {
  if (entry.scheduledFallbackRafId !== null || entry.targets.size === 0) {
    return;
  }
  entry.scheduledFallbackRafId = scheduleAnimationFrame(() => {
    entry.scheduledFallbackRafId = null;
    reevaluatePoolEntryTargets(entry);
  });
}

/**
 * When initial geometry is temporarily unavailable (0x0 rects/offsets before layout settles),
 * schedules a coalesced frame re-check (and ResizeObserver if available) until geometry is usable.
 */
function schedulePendingGeometryCheck(entry: SharedObserverPoolEntry): void {
  if (entry.targets.size === 0) return;

  if (!entry.resizeObserver) {
    const ROConstructor = getResizeObserverConstructor();
    if (ROConstructor) {
      try {
        const ro = new ROConstructor(() => {
          reevaluatePendingUnavailableTargets(entry);
        });
        if (entry.root) {
          ro.observe(entry.root);
        }
        entry.resizeObserver = ro;
      } catch {
        entry.resizeObserver = null;
      }
    }
  }

  if (entry.scheduledGeometryRafId !== null) {
    return;
  }

  entry.scheduledGeometryRafId = scheduleAnimationFrame(() => {
    entry.scheduledGeometryRafId = null;
    reevaluatePendingUnavailableTargets(entry);
  });
}

function reevaluatePendingUnavailableTargets(entry: SharedObserverPoolEntry): void {
  if (entry.targets.size === 0) return;

  const unavailableRecords: ObservedTargetRecord[] = [];
  for (const [, targetRec] of entry.targets.entries()) {
    if (!targetRec.geometryUsable) {
      unavailableRecords.push(targetRec);
    }
  }

  if (unavailableRecords.length === 0) {
    entry.pendingGeometryCheckAttempts = 0;
    if (entry.resizeObserver) {
      entry.resizeObserver.disconnect();
      entry.resizeObserver = null;
    }
    return;
  }

  const rootMetrics = measureRootContainer(entry.root, entry.axis);
  const pendingNotifications: Array<{
    targetRec: ObservedTargetRecord;
    isNowIntersecting: boolean;
  }> = [];
  let stillUnavailable = false;

  if (rootMetrics.usable) {
    for (const targetRec of unavailableRecords) {
      const res = inspectElementVisibilityWithRootMetrics(
        targetRec.target,
        rootMetrics,
        entry.parsedMargins,
        entry.axis
      );
      if (res.usable) {
        targetRec.geometryUsable = true;
        if (targetRec.lastIntersecting !== res.isIntersecting) {
          pendingNotifications.push({
            targetRec,
            isNowIntersecting: res.isIntersecting,
          });
        }
      } else {
        stillUnavailable = true;
      }
    }
  } else {
    stillUnavailable = true;
  }

  for (const { targetRec, isNowIntersecting } of pendingNotifications) {
    targetRec.lastIntersecting = isNowIntersecting;
    for (const listener of Array.from(targetRec.listeners)) {
      listener(isNowIntersecting);
    }
  }

  if (stillUnavailable) {
    entry.pendingGeometryCheckAttempts++;
    if (entry.pendingGeometryCheckAttempts < 10) {
      schedulePendingGeometryCheck(entry);
    }
  } else {
    entry.pendingGeometryCheckAttempts = 0;
    if (entry.resizeObserver) {
      entry.resizeObserver.disconnect();
      entry.resizeObserver = null;
    }
  }
}

function getOrCreateSharedPoolEntry(
  root: HTMLElement | null,
  rootMargin: string,
  axis: 'vertical' | 'horizontal'
): SharedObserverPoolEntry {
  let byKey = sharedObserverPool.get(root);
  if (!byKey) {
    byKey = new Map<string, SharedObserverPoolEntry>();
    sharedObserverPool.set(root, byKey);
  }

  const key = `${axis}|${rootMargin}`;
  const existing = byKey.get(key);
  if (existing) {
    return existing;
  }

  const parsedMargins = parseRootMarginPx(rootMargin);
  const IOConstructor = getIntersectionObserverConstructor();

  const entry: SharedObserverPoolEntry = {
    key,
    root,
    rootMargin,
    parsedMargins,
    axis,
    observer: null,
    usingFallbackOnly: IOConstructor === null,
    hasScrollListener: false,
    hasResizeListener: false,
    scheduledFallbackRafId: null,
    scheduledGeometryRafId: null,
    pendingGeometryCheckAttempts: 0,
    syncRootMetricsCache: null,
    syncRootMetricsClearQueued: false,
    resizeObserver: null,
    targets: new Map<HTMLElement, ObservedTargetRecord>(),
    disposeListeners: () => {},
  };

  if (IOConstructor) {
    try {
      const observer = new IOConstructor(
        (ioEntries: IntersectionObserverEntry[]) => {
          perfIoCallbackInvocations++;
          const pendingNotifications: Array<{
            targetRec: ObservedTargetRecord;
            isIntersecting: boolean;
          }> = [];

          for (const ioEntry of ioEntries) {
            const targetEl = ioEntry.target as HTMLElement;
            const targetRec = entry.targets.get(targetEl);
            if (!targetRec) continue;
            targetRec.geometryUsable = true;
            const isIntersecting = Boolean(
              ioEntry.isIntersecting ||
                (typeof ioEntry.intersectionRatio === 'number' && ioEntry.intersectionRatio > 0)
            );
            if (targetRec.lastIntersecting !== isIntersecting) {
              pendingNotifications.push({ targetRec, isIntersecting });
            }
          }

          for (const { targetRec, isIntersecting } of pendingNotifications) {
            targetRec.lastIntersecting = isIntersecting;
            for (const listener of Array.from(targetRec.listeners)) {
              listener(isIntersecting);
            }
          }
        },
        {
          root: root ?? null,
          rootMargin,
          threshold: 0,
        }
      );
      entry.observer = observer;
      entry.usingFallbackOnly = false;
    } catch {
      entry.observer = null;
      entry.usingFallbackOnly = true;
    }
  }

  // Only install manual scroll/resize listeners when IntersectionObserver is unavailable (fallback mode)
  let scrollEventTarget: EventTarget | null = null;
  const onFallbackScrollOrResize = () => {
    scheduleFallbackReevaluation(entry);
  };

  if (entry.usingFallbackOnly) {
    scrollEventTarget = root ?? (typeof window !== 'undefined' ? window : null);
    if (scrollEventTarget && typeof scrollEventTarget.addEventListener === 'function') {
      scrollEventTarget.addEventListener('scroll', onFallbackScrollOrResize, {
        passive: true,
      } as AddEventListenerOptions);
      entry.hasScrollListener = true;
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('resize', onFallbackScrollOrResize);
      entry.hasResizeListener = true;
    }
  }

  entry.disposeListeners = () => {
    if (entry.scheduledFallbackRafId !== null) {
      cancelScheduledAnimationFrame(entry.scheduledFallbackRafId);
      entry.scheduledFallbackRafId = null;
    }
    if (entry.scheduledGeometryRafId !== null) {
      cancelScheduledAnimationFrame(entry.scheduledGeometryRafId);
      entry.scheduledGeometryRafId = null;
    }
    if (entry.resizeObserver) {
      entry.resizeObserver.disconnect();
      entry.resizeObserver = null;
    }
    if (entry.hasScrollListener && scrollEventTarget && typeof scrollEventTarget.removeEventListener === 'function') {
      scrollEventTarget.removeEventListener('scroll', onFallbackScrollOrResize);
      entry.hasScrollListener = false;
    }
    if (entry.hasResizeListener && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('resize', onFallbackScrollOrResize);
      entry.hasResizeListener = false;
    }
    entry.syncRootMetricsCache = null;
  };

  byKey.set(key, entry);
  return entry;
}

export interface ObserveContainerVisibilityOptions {
  target: HTMLElement;
  root: HTMLElement | null;
  rootMargin: string;
  axis: 'vertical' | 'horizontal';
  index: number;
  onIntersectChange: (isIntersecting: boolean) => void;
}

export function observeContainerVisibility({
  target,
  root,
  rootMargin,
  axis,
  index,
  onIntersectChange,
}: ObserveContainerVisibilityOptions): () => void {
  const poolEntry = getOrCreateSharedPoolEntry(root, rootMargin, axis);
  let targetRec = poolEntry.targets.get(target);
  const isNewTarget = !targetRec;

  if (!targetRec) {
    targetRec = {
      target,
      index,
      geometryUsable: false,
      lastIntersecting: null,
      listeners: new Set(),
    };
    poolEntry.targets.set(target, targetRec);
  } else {
    targetRec.index = index;
  }

  targetRec.listeners.add(onIntersectChange);

  if (isNewTarget && poolEntry.observer) {
    poolEntry.observer.observe(target);
  }

  // If IntersectionObserver did not synchronously populate lastIntersecting during observe(target),
  // perform a single initial geometry check reusing the synchronous container measurement.
  if (targetRec.lastIntersecting === null) {
    const rootMetrics = getOrMeasureSyncRootMetrics(poolEntry);
    const initialEval = inspectElementVisibilityWithRootMetrics(
      target,
      rootMetrics,
      poolEntry.parsedMargins,
      axis
    );
    targetRec.geometryUsable = initialEval.usable;
    targetRec.lastIntersecting = initialEval.usable ? initialEval.isIntersecting : false;
    onIntersectChange(targetRec.lastIntersecting);

    if (!initialEval.usable) {
      schedulePendingGeometryCheck(poolEntry);
    }
  } else {
    onIntersectChange(targetRec.lastIntersecting);
  }

  let unsubscribed = false;
  return () => {
    if (unsubscribed) return;
    unsubscribed = true;

    const currentRec = poolEntry.targets.get(target);
    if (currentRec) {
      currentRec.listeners.delete(onIntersectChange);
      if (currentRec.listeners.size === 0) {
        poolEntry.targets.delete(target);
        if (poolEntry.observer && typeof poolEntry.observer.unobserve === 'function') {
          poolEntry.observer.unobserve(target);
        }
      }
    }

    if (poolEntry.targets.size === 0) {
      if (poolEntry.observer && typeof poolEntry.observer.disconnect === 'function') {
        poolEntry.observer.disconnect();
      }
      poolEntry.disposeListeners();
      const byKey = sharedObserverPool.get(root);
      if (byKey) {
        byKey.delete(poolEntry.key);
        if (byKey.size === 0) {
          sharedObserverPool.delete(root);
        }
      }
    }
  };
}

/**
 * Standardized remote image component for channel logos, movie posters, series covers, and backdrops.
 *
 * Requirements enforced:
 * 1. Cleanly separates address resolution, authorization (`active`), loading (`eager`/`lazy`),
 *    fetchPriority (`high`/`low`/`auto`), and decoding (`async` by default).
 * 2. Employs explicit lifecycle states: 'empty', 'loading', 'loaded', 'retrying', 'failed'.
 * 3. Never renders `<img src="">` for empty sources or unauthorized deferred images.
 * 4. Separates image identity (`itemId` + `resolvedUrl`), loading authorization (`active`), and
 *    visual cache (`loadedImageUrlsCache`):
 *    - A new instance with `active=false` remains deferred even if its URL is in `loadedImageUrlsCache`.
 *    - Once authorized on a mounted instance, authorization, state, and retry budget are preserved
 *      for the same identity across visibility exits/re-entries and re-renders.
 * 5. Exactly ONE retry after ~2000ms using the exact same URL upon initial onError.
 * 6. Resets retry budget and cancels pending timers on unmount or when source/serverUrl changes.
 * 7. Uses `loadedImageUrlsCache` (up to 2,500 entries) to preserve visual state (`loaded`) when authorized.
 */
function MediaImageInner({
  src,
  serverUrl,
  alt = '',
  className = '',
  loading,
  decoding,
  priority = false,
  active = true,
  fetchPriority,
  itemId,
  itemName,
  onError,
  onLoad,
  ...rest
}: MediaImageProps) {
  // Resolve direct provider URL without proxy
  const resolvedUrl = buildDirectImageUrl(src, serverUrl);
  const isCachedLoaded = Boolean(resolvedUrl && loadedImageUrlsCache.has(resolvedUrl));

  // Track identity of current source independently of visibility/authorization
  const currentKey = `${itemId ?? ''}_${resolvedUrl ?? ''}`;
  const prevKeyRef = useRef(currentKey);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Authorization is strictly controlled by `active` (independent of priority hints and loadedImageUrlsCache)
  const shouldAuthorizeNow = Boolean(active);
  const [latchedAuthorizedKey, setLatchedAuthorizedKey] = useState<string | null>(() =>
    resolvedUrl && shouldAuthorizeNow ? currentKey : null
  );

  // Status & retry count state (loadedImageUrlsCache preserves visual state once authorized)
  const [status, setStatus] = useState<ImageStatus>(() => {
    if (!resolvedUrl) return 'empty';
    return isCachedLoaded ? 'loaded' : 'loading';
  });
  const [attempt, setAttempt] = useState(0);

  const clearScheduledRetryTimer = () => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
      activeRetryTimersCount = Math.max(0, activeRetryTimersCount - 1);
    }
  };

  // Synchronously reset retry state ONLY when image identity (source or server) changes
  if (prevKeyRef.current !== currentKey) {
    prevKeyRef.current = currentKey;
    clearScheduledRetryTimer();
    setAttempt(0);
    const nextAuthorized = Boolean(resolvedUrl && shouldAuthorizeNow);
    setLatchedAuthorizedKey(nextAuthorized ? currentKey : null);
    setStatus(
      !resolvedUrl
        ? 'empty'
        : isCachedLoaded
          ? 'loaded'
          : 'loading'
    );
  } else if (resolvedUrl && shouldAuthorizeNow && latchedAuthorizedKey !== currentKey) {
    // Latch authorization for this image identity so exiting/re-entering visibility preserves state
    setLatchedAuthorizedKey(currentKey);
    if (isCachedLoaded && status === 'loading') {
      setStatus('loaded');
    }
  }

  // Cancel any scheduled retry timer on unmount
  useEffect(() => {
    return () => {
      clearScheduledRetryTimer();
    };
  }, []);

  const isAuthorized = Boolean(
    resolvedUrl && (shouldAuthorizeNow || latchedAuthorizedKey === currentKey)
  );

  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    if (resolvedUrl) {
      loadedImageUrlsCache.delete(resolvedUrl);
    }
    const isFirstFailure = attempt === 0;

    if (isFirstFailure) {
      setStatus('retrying');

      if (isDebugImagesEnabled()) {
        const diag = diagnoseImageUrl(src, serverUrl);
        console.group(
          `%c[NC Image Diagnostic] ⚠️ 1ª Falha ao carregar imagem: ${itemName || alt || 'sem nome'}`,
          'color: #f59e0b; font-weight: bold;'
        );
        console.log('Item ID:', itemId ?? 'N/A');
        console.log('Nome do item:', itemName || alt || 'N/A');
        console.log('URL original:', src);
        console.log('URL resolvida:', resolvedUrl);
        console.log('Status: Primeira falha (agendando retentativa única em 2s com a mesma URL)');
        console.log('Classificação:', diag.diffCategory, diag.notes);
        console.groupEnd();
      }

      clearScheduledRetryTimer();
      activeRetryTimersCount++;
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        activeRetryTimersCount = Math.max(0, activeRetryTimersCount - 1);
        if (isDebugImagesEnabled()) {
          console.log(`[NC Image Diagnostic] 🔄 Executando retentativa única para: ${itemName || alt || resolvedUrl}`);
        }
        setAttempt(1);
        setStatus('loading');
      }, mediaImageRetryDelayMs);
    } else {
      // Second failure: definitive failure
      setStatus('failed');

      if (isDebugImagesEnabled()) {
        console.group(
          `%c[NC Image Diagnostic] ❌ Falha definitiva após retentativa: ${itemName || alt || 'sem nome'}`,
          'color: #ef4444; font-weight: bold;'
        );
        console.log('Item ID:', itemId ?? 'N/A');
        console.log('URL resolvida tentada:', resolvedUrl);
        console.log('Status: Falha definitiva (área mantida reservada e vazia sem ícone quebrado)');
        console.groupEnd();
      }
    }

    onError?.(e);
  };

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    rememberLoadedImageUrl(resolvedUrl);
    setStatus('loaded');
    onLoad?.(e);
  };

  // If source is empty, invalid, or failed definitively:
  // Render an empty reserved area preserving the layout and background classes without an <img> tag.
  if (!resolvedUrl || status === 'empty' || status === 'failed') {
    return (
      <div
        className={className}
        aria-label={alt || itemName || undefined}
        role={alt || itemName ? 'img' : undefined}
      />
    );
  }

  // If image has not yet been authorized by visibility or focus:
  // Keep the reserved layout container without activating the <img> network request yet.
  if (!isAuthorized) {
    return (
      <div
        className={className}
        data-media-image-deferred="true"
        aria-label={alt || itemName || undefined}
        role={alt || itemName ? 'img' : undefined}
      />
    );
  }

  // Orthogonal loading, fetchPriority, and decoding decisions:
  // - Priority elevates loading to 'eager' and fetchPriority to 'high' (reserved for primary assets like HeroBanner).
  // - Decoding defaults to 'async' for all covers, logos, and banners unless explicitly overridden.
  const effectiveLoading: 'eager' | 'lazy' | undefined = priority ? 'eager' : loading;
  const effectiveDecoding: 'async' | 'sync' | 'auto' = decoding ?? 'async';
  const effectiveFetchPriority: 'high' | 'low' | 'auto' | undefined =
    fetchPriority ?? (priority ? 'high' : undefined);

  return (
    <img
      key={`${currentKey}_attempt_${attempt}`}
      src={resolvedUrl}
      alt={alt}
      loading={effectiveLoading}
      decoding={effectiveDecoding}
      fetchPriority={effectiveFetchPriority}
      className={`${className} ${status === 'loaded' ? 'opacity-100' : 'opacity-0'} transition-opacity duration-200`}
      onError={handleImageError}
      onLoad={handleImageLoad}
      {...rest}
    />
  );
}

export const MediaImage = React.memo(MediaImageInner);
