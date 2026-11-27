import React, { useState, useEffect, useRef } from 'react';
import {
  DEFAULT_MAX_IMAGE_CANDIDATES,
  normalizeImageCandidates,
} from '../utils/mediaUtils';
import {
  isAndroidPersistentImageCacheAvailable,
  isEligibleForAndroidImageDiskCache,
  isDeterministicImageCacheIneligibilityError,
  isImageAccessDeniedError,
  isImageRateLimitError,
  isImageNotFoundError,
  isImageCancellationOrSessionError,
  getImageUrlHostOrigin,
  recordRateLimitedImageHost,
  isImageHostRateLimited,
  recordTemporaryImageFailure,
  isImageUrlTemporarilyFailed,
  clearTemporaryImageFailure,
  clearTemporaryImageFailures,
  getInstantCachedImageSrc,
  acquireCachedImage,
  recoverFromCorruptedLocalImage,
} from '../services/androidImageCache';

export interface MediaImageResolvedSourceInfo {
  src: string | null;
  candidateIndex: number;
  status: 'empty' | 'loading' | 'loaded' | 'retrying' | 'failed';
}

export interface MediaImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src?: unknown;
  /**
   * Optional ordered alternative image sources belonging strictly to the same content item.
   * Combined with `src`, normalized, deduplicated after resolution, and capped at 3 distinct URLs.
   */
  fallbackSrcs?: unknown;
  serverUrl?: string | null;
  itemId?: string | number;
  itemName?: string;
  priority?: boolean;
  /**
   * Controls whether the image is authorized to initiate its network request.
   * Defaults to true so all consumers outside visibility-gated rows preserve their contract.
   * Once authorized for a given logical image identity on a mounted instance,
   * authorization is latched across re-renders and visibility exits/re-entries.
   */
  active?: boolean;
  /**
   * Native fetch priority hint ('high' | 'low' | 'auto').
   * Reserved for high-priority presentation assets (such as HeroBanner when priority={true}).
   */
  fetchPriority?: 'high' | 'low' | 'auto';
  /**
   * Optional callback notified when the active resolved candidate URL or status changes.
   * Allows consumers like HeroBanner to adapt visual layout (horizontal vs vertical)
   * without unmounting or remounting MediaImage.
   */
  onResolvedSourceChange?: (info: MediaImageResolvedSourceInfo) => void;
}

type ImageStatus = 'empty' | 'loading' | 'loaded' | 'retrying' | 'failed';
type EffectiveImageProvenance = 'none' | 'local_file' | 'remote_direct' | 'data_uri' | 'blob_url';

function inferDirectSourceProvenance(url: string | null): EffectiveImageProvenance {
  if (!url) return 'none';
  if (/^data:/i.test(url)) return 'data_uri';
  if (/^blob:/i.test(url)) return 'blob_url';
  return 'remote_direct';
}

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
  clearTemporaryImageFailures();
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

export function measureRootContainer(
  root: HTMLElement | null,
  axis: 'vertical' | 'horizontal'
): RootContainerMetrics {
  if (root) {
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

export function notifyContainerScrollForFallback(root: HTMLElement | null): void {
  if (!root) return;
  const byKey = sharedObserverPool.get(root);
  if (!byKey) return;
  byKey.forEach((entry) => {
    if (entry.usingFallbackOnly && entry.targets.size > 0) {
      scheduleFallbackReevaluation(entry);
    }
  });
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
  // perform a single initial geometry check reusing the synchronous container measurement
  // (unless a coalesced fallback frame is already scheduled for this container).
  if (targetRec.lastIntersecting === null) {
    if (poolEntry.usingFallbackOnly && poolEntry.scheduledFallbackRafId !== null) {
      onIntersectChange(false);
    } else {
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
function findFirstViableCandidateIndex(
  candidates: ReadonlyArray<string>,
  startIndex: number = 0,
  attemptedUrls?: ReadonlySet<string>,
  avoidHostOrigin?: string | null
): number {
  for (let i = Math.max(0, startIndex); i < candidates.length; i++) {
    const url = candidates[i];
    if (!url) continue;
    if (attemptedUrls && attemptedUrls.has(url)) continue;
    if (isImageUrlTemporarilyFailed(url)) continue;
    if (isImageHostRateLimited(url)) continue;
    if (avoidHostOrigin && getImageUrlHostOrigin(url) === avoidHostOrigin) continue;
    return i;
  }
  return -1;
}

function resolveCandidateInitialPresentation(
  url: string | null,
  hasAnyCandidates: boolean
): {
  effectiveSrc: string | null;
  provenance: EffectiveImageProvenance;
  status: ImageStatus;
  useDiskCache: boolean;
} {
  if (!url) {
    return {
      effectiveSrc: null,
      provenance: 'none',
      status: hasAnyCandidates ? 'failed' : 'empty',
      useDiskCache: false,
    };
  }
  const useDiskCache = Boolean(
    isAndroidPersistentImageCacheAvailable() && isEligibleForAndroidImageDiskCache(url)
  );
  if (useDiskCache) {
    const instantLocal = getInstantCachedImageSrc(url);
    return {
      effectiveSrc: instantLocal,
      provenance: instantLocal ? 'local_file' : 'none',
      status: instantLocal ? 'loaded' : 'loading',
      useDiskCache: true,
    };
  }
  return {
    effectiveSrc: url,
    provenance: inferDirectSourceProvenance(url),
    status: loadedImageUrlsCache.has(url) ? 'loaded' : 'loading',
    useDiskCache: false,
  };
}

function MediaImageInner({
  src,
  fallbackSrcs,
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
  onResolvedSourceChange,
  ...rest
}: MediaImageProps) {
  // Resolve up to 3 distinct direct provider candidate URLs (preserving priority order & signed URLs literally)
  const candidates = normalizeImageCandidates(
    fallbackSrcs !== undefined ? [src, fallbackSrcs] : src,
    serverUrl,
    DEFAULT_MAX_IMAGE_CANDIDATES
  );
  const candidatesSignature = candidates.join('\n');
  const primaryCandidateUrl = candidates[0] ?? null;
  const normalizedItemId = itemId !== undefined && itemId !== null ? String(itemId) : '';
  const normalizedServerUrl = serverUrl ? String(serverUrl).trim() : '';

  const candidatesRef = useRef<string[]>(candidates);
  candidatesRef.current = candidates;

  const onResolvedSourceChangeRef = useRef(onResolvedSourceChange);
  onResolvedSourceChangeRef.current = onResolvedSourceChange;

  // Logical visual cycle tracking separated from individual candidate generation and
  // React StrictMode mount/cleanup effect lifecycle epoch.
  const cycleSeqRef = useRef<number>(1);
  const activeCycleKeyRef = useRef<string>(`cycle_1_${normalizedItemId}`);
  const identityGenerationRef = useRef<number>(1);
  const candidateGenerationRef = useRef<number>(1);
  const asyncLifecycleEpochRef = useRef<number>(1);
  const isMountedRef = useRef<boolean>(true);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRecoveryAbortRef = useRef<AbortController | null>(null);

  // Shared budgets across the ENTIRE logical cycle (never multiplied per candidate)
  const retryUsedRef = useRef<boolean>(false);
  const localRecoveryUsedRef = useRef<boolean>(false);
  const attemptedUrlsRef = useRef<Set<string>>(new Set());
  // Per-candidate native cache bypass flag
  const nativeCacheBypassedForCandidateRef = useRef<boolean>(false);

  const prevIdentitySnapshotRef = useRef({
    itemId: normalizedItemId,
    serverUrl: normalizedServerUrl,
    primaryUrl: primaryCandidateUrl,
    candidatesSignature,
    hadCandidates: candidates.length > 0,
  });

  const initialCandidateIdx = findFirstViableCandidateIndex(candidates, 0);
  const initialCandidateUrl =
    initialCandidateIdx >= 0 ? candidates[initialCandidateIdx] : null;
  const initialPresentation = resolveCandidateInitialPresentation(
    initialCandidateUrl,
    candidates.length > 0
  );

  // Seed attempted URLs for initial render synchronously on first mount
  const initialAttemptSeededRef = useRef<boolean>(false);
  if (!initialAttemptSeededRef.current) {
    initialAttemptSeededRef.current = true;
    if (initialCandidateUrl) {
      attemptedUrlsRef.current.add(initialCandidateUrl);
    }
  }

  const [activeCandidateIndex, setActiveCandidateIndex] = useState<number>(initialCandidateIdx);
  const activeUrlRef = useRef<string | null>(initialCandidateUrl);

  const shouldAuthorizeNow = Boolean(active);
  const [latchedAuthorizedCycleKey, setLatchedAuthorizedCycleKey] = useState<string | null>(() =>
    candidates.length > 0 && shouldAuthorizeNow ? activeCycleKeyRef.current : null
  );

  const [effectiveImgSrc, setEffectiveImgSrc] = useState<string | null>(
    initialPresentation.effectiveSrc
  );
  const [effectiveImgProvenance, setEffectiveImgProvenance] = useState<EffectiveImageProvenance>(
    initialPresentation.provenance
  );
  const [status, setStatus] = useState<ImageStatus>(initialPresentation.status);
  const [attempt, setAttempt] = useState<number>(0);

  const clearScheduledRetryTimer = () => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
      activeRetryTimersCount = Math.max(0, activeRetryTimersCount - 1);
    }
  };

  const cancelActiveRecovery = () => {
    if (activeRecoveryAbortRef.current !== null) {
      activeRecoveryAbortRef.current.abort();
      activeRecoveryAbortRef.current = null;
    }
  };

  const isCurrentCandidateVisualValid = (
    capturedCycleKey: string,
    capturedIdentityGeneration: number,
    capturedCandidateGeneration: number
  ): boolean =>
    isMountedRef.current &&
    activeCycleKeyRef.current === capturedCycleKey &&
    identityGenerationRef.current === capturedIdentityGeneration &&
    candidateGenerationRef.current === capturedCandidateGeneration;

  const isCurrentCandidateAsyncValid = (
    capturedCycleKey: string,
    capturedIdentityGeneration: number,
    capturedCandidateGeneration: number,
    capturedLifecycleEpoch: number
  ): boolean =>
    isCurrentCandidateVisualValid(
      capturedCycleKey,
      capturedIdentityGeneration,
      capturedCandidateGeneration
    ) && asyncLifecycleEpochRef.current === capturedLifecycleEpoch;

  // Synchronously reconcile logical identity changes vs in-place metadata enrichment
  const prevSnap = prevIdentitySnapshotRef.current;
  const prevActiveUrl = activeUrlRef.current;
  const itemIdChanged = prevSnap.itemId !== normalizedItemId;
  const serverUrlChanged = prevSnap.serverUrl !== normalizedServerUrl;
  const becameEmpty = prevSnap.hadCandidates && candidates.length === 0;
  const becameNonEmpty = !prevSnap.hadCandidates && candidates.length > 0;
  const activeUrlRemoved = Boolean(prevActiveUrl && !candidates.includes(prevActiveUrl));
  const primaryUpgraded = Boolean(
    primaryCandidateUrl &&
      prevSnap.primaryUrl !== primaryCandidateUrl &&
      !isImageUrlTemporarilyFailed(primaryCandidateUrl) &&
      !isImageHostRateLimited(primaryCandidateUrl)
  );

  const needsFullIdentityReset =
    itemIdChanged ||
    serverUrlChanged ||
    becameEmpty ||
    becameNonEmpty ||
    activeUrlRemoved ||
    primaryUpgraded;

  let currentCandidateIndex = activeCandidateIndex;
  let currentCandidateUrl: string | null =
    currentCandidateIndex >= 0 && currentCandidateIndex < candidates.length
      ? candidates[currentCandidateIndex]
      : null;
  let currentStatus = status;
  let currentEffectiveSrc = effectiveImgSrc;

  if (needsFullIdentityReset) {
    prevIdentitySnapshotRef.current = {
      itemId: normalizedItemId,
      serverUrl: normalizedServerUrl,
      primaryUrl: primaryCandidateUrl,
      candidatesSignature,
      hadCandidates: candidates.length > 0,
    };
    cycleSeqRef.current += 1;
    const nextCycleKey = `cycle_${cycleSeqRef.current}_${normalizedItemId}`;
    activeCycleKeyRef.current = nextCycleKey;
    identityGenerationRef.current += 1;
    candidateGenerationRef.current += 1;
    retryUsedRef.current = false;
    localRecoveryUsedRef.current = false;
    nativeCacheBypassedForCandidateRef.current = false;
    attemptedUrlsRef.current = new Set<string>();
    cancelActiveRecovery();
    clearScheduledRetryTimer();

    const nextIdx = findFirstViableCandidateIndex(candidates, 0);
    const nextUrl = nextIdx >= 0 ? candidates[nextIdx] : null;
    if (nextUrl) {
      attemptedUrlsRef.current.add(nextUrl);
    }
    const nextPres = resolveCandidateInitialPresentation(nextUrl, candidates.length > 0);

    activeUrlRef.current = nextUrl;
    currentCandidateIndex = nextIdx;
    currentCandidateUrl = nextUrl;
    currentStatus = nextPres.status;
    currentEffectiveSrc = nextPres.effectiveSrc;

    setActiveCandidateIndex(nextIdx);
    setAttempt(0);
    setLatchedAuthorizedCycleKey(
      candidates.length > 0 && shouldAuthorizeNow ? nextCycleKey : null
    );
    setEffectiveImgSrc(nextPres.effectiveSrc);
    setEffectiveImgProvenance(nextPres.provenance);
    setStatus(nextPres.status);
  } else {
    if (prevSnap.candidatesSignature !== candidatesSignature) {
      prevIdentitySnapshotRef.current = {
        itemId: normalizedItemId,
        serverUrl: normalizedServerUrl,
        primaryUrl: primaryCandidateUrl,
        candidatesSignature,
        hadCandidates: candidates.length > 0,
      };
      // If active URL shifted index due to penalized higher-priority metadata arriving, relocate cleanly without resetting
      if (prevActiveUrl) {
        const relocatedIdx = candidates.indexOf(prevActiveUrl);
        if (relocatedIdx >= 0 && relocatedIdx !== activeCandidateIndex) {
          currentCandidateIndex = relocatedIdx;
          currentCandidateUrl = candidates[relocatedIdx];
          setActiveCandidateIndex(relocatedIdx);
        }
      } else if (
        status === 'failed' &&
        attemptedUrlsRef.current.size < DEFAULT_MAX_IMAGE_CANDIDATES
      ) {
        // Previously failed cycle received a brand new unattempted non-penalized candidate
        const newlyAvailableIdx = findFirstViableCandidateIndex(
          candidates,
          0,
          attemptedUrlsRef.current
        );
        if (newlyAvailableIdx >= 0) {
          const nextUrl = candidates[newlyAvailableIdx];
          attemptedUrlsRef.current.add(nextUrl);
          candidateGenerationRef.current += 1;
          nativeCacheBypassedForCandidateRef.current = false;
          const nextPres = resolveCandidateInitialPresentation(nextUrl, true);
          activeUrlRef.current = nextUrl;
          currentCandidateIndex = newlyAvailableIdx;
          currentCandidateUrl = nextUrl;
          currentStatus = nextPres.status;
          currentEffectiveSrc = nextPres.effectiveSrc;
          setActiveCandidateIndex(newlyAvailableIdx);
          setEffectiveImgSrc(nextPres.effectiveSrc);
          setEffectiveImgProvenance(nextPres.provenance);
          setStatus(nextPres.status);
        }
      }
    }

    const activeCycleKeyNow = activeCycleKeyRef.current;
    const activeUseDiskCache = Boolean(
      currentCandidateUrl &&
        isAndroidPersistentImageCacheAvailable() &&
        isEligibleForAndroidImageDiskCache(currentCandidateUrl)
    );
    const activeInstantLocal = activeUseDiskCache
      ? getInstantCachedImageSrc(currentCandidateUrl)
      : null;
    const activeIsCachedLoaded = Boolean(
      currentCandidateUrl &&
        (loadedImageUrlsCache.has(currentCandidateUrl) || Boolean(activeInstantLocal))
    );

    if (
      candidates.length > 0 &&
      shouldAuthorizeNow &&
      latchedAuthorizedCycleKey !== activeCycleKeyNow
    ) {
      setLatchedAuthorizedCycleKey(activeCycleKeyNow);
      if (
        !currentCandidateUrl ||
        isImageUrlTemporarilyFailed(currentCandidateUrl) ||
        isImageHostRateLimited(currentCandidateUrl)
      ) {
        const freshIdx = findFirstViableCandidateIndex(candidates, 0);
        const freshUrl = freshIdx >= 0 ? candidates[freshIdx] : null;
        attemptedUrlsRef.current = new Set<string>(freshUrl ? [freshUrl] : []);
        candidateGenerationRef.current += 1;
        nativeCacheBypassedForCandidateRef.current = false;
        const freshPres = resolveCandidateInitialPresentation(freshUrl, candidates.length > 0);
        activeUrlRef.current = freshUrl;
        currentCandidateIndex = freshIdx;
        currentCandidateUrl = freshUrl;
        currentStatus = freshPres.status;
        currentEffectiveSrc = freshPres.effectiveSrc;
        setActiveCandidateIndex(freshIdx);
        setEffectiveImgSrc(freshPres.effectiveSrc);
        setEffectiveImgProvenance(freshPres.provenance);
        setStatus(freshPres.status);
      } else {
        if (activeInstantLocal && currentEffectiveSrc !== activeInstantLocal) {
          currentEffectiveSrc = activeInstantLocal;
          setEffectiveImgSrc(activeInstantLocal);
          setEffectiveImgProvenance('local_file');
        }
        if (activeIsCachedLoaded && currentStatus === 'loading') {
          currentStatus = 'loaded';
          setStatus('loaded');
        }
      }
    } else if (
      activeUseDiskCache &&
      !nativeCacheBypassedForCandidateRef.current &&
      activeInstantLocal &&
      currentEffectiveSrc !== activeInstantLocal &&
      !localRecoveryUsedRef.current
    ) {
      currentEffectiveSrc = activeInstantLocal;
      setEffectiveImgSrc(activeInstantLocal);
      setEffectiveImgProvenance('local_file');
      if (currentStatus === 'loading') {
        currentStatus = 'loaded';
        setStatus('loaded');
      }
    }
  }

  const activeCycleKey = activeCycleKeyRef.current;
  const renderIdentityGeneration = identityGenerationRef.current;
  const renderCandidateGeneration = candidateGenerationRef.current;
  const useAndroidDiskCache = Boolean(
    currentCandidateUrl &&
      isAndroidPersistentImageCacheAvailable() &&
      isEligibleForAndroidImageDiskCache(currentCandidateUrl)
  );

  // Advance sequentially to the next viable candidate within the current logical cycle
  const advanceToCandidateOrFail = (
    failedUrl: string | null,
    options?: {
      recordFailure?: boolean;
      avoidHostOrigin?: string | null;
    }
  ): boolean => {
    if (options?.recordFailure && failedUrl) {
      recordTemporaryImageFailure(failedUrl);
    }

    const list = candidatesRef.current;
    if (attemptedUrlsRef.current.size < DEFAULT_MAX_IMAGE_CANDIDATES) {
      const nextIdx = findFirstViableCandidateIndex(
        list,
        currentCandidateIndex + 1,
        attemptedUrlsRef.current,
        options?.avoidHostOrigin ?? null
      );
      if (nextIdx >= 0) {
        const nextUrl = list[nextIdx];
        attemptedUrlsRef.current.add(nextUrl);
        candidateGenerationRef.current += 1;
        nativeCacheBypassedForCandidateRef.current = false;
        cancelActiveRecovery();
        clearScheduledRetryTimer();

        const nextPres = resolveCandidateInitialPresentation(nextUrl, true);
        activeUrlRef.current = nextUrl;
        if (nextPres.status === 'loaded') {
          rememberLoadedImageUrl(nextUrl);
          clearTemporaryImageFailure(nextUrl);
        }
        setActiveCandidateIndex(nextIdx);
        setAttempt(0);
        setEffectiveImgSrc(nextPres.effectiveSrc);
        setEffectiveImgProvenance(nextPres.provenance);
        setStatus(nextPres.status);
        return true;
      }
    }

    // No viable alternatives left: enter clean visual fallback state
    candidateGenerationRef.current += 1;
    cancelActiveRecovery();
    clearScheduledRetryTimer();
    activeUrlRef.current = null;
    setActiveCandidateIndex(-1);
    setEffectiveImgSrc(null);
    setEffectiveImgProvenance('none');
    setStatus('failed');
    return false;
  };

  // Manage mount/unmount lifecycle epoch and cancel pending async work on cleanup
  // without mutating identityGenerationRef or candidateGenerationRef (preserving StrictMode DOM handlers)
  useEffect(() => {
    isMountedRef.current = true;
    asyncLifecycleEpochRef.current += 1;
    return () => {
      isMountedRef.current = false;
      asyncLifecycleEpochRef.current += 1;
      cancelActiveRecovery();
      clearScheduledRetryTimer();
    };
  }, []);

  // Notify optional consumer callback whenever resolved active source or lifecycle status changes
  const lastEmittedResolvedRef = useRef<string>('');
  useEffect(() => {
    const cb = onResolvedSourceChangeRef.current;
    if (!cb) return;
    const reportedSrc =
      currentStatus === 'failed' || currentStatus === 'empty' ? null : currentCandidateUrl;
    const reportedIndex =
      currentStatus === 'failed' || currentStatus === 'empty' ? -1 : currentCandidateIndex;
    const sig = `${reportedSrc ?? ''}|${reportedIndex}|${currentStatus}`;
    if (lastEmittedResolvedRef.current === sig) return;
    lastEmittedResolvedRef.current = sig;
    cb({
      src: reportedSrc,
      candidateIndex: reportedIndex,
      status: currentStatus,
    });
  }, [currentCandidateUrl, currentCandidateIndex, currentStatus]);

  const isAuthorized = Boolean(
    candidates.length > 0 &&
      (shouldAuthorizeNow || latchedAuthorizedCycleKey === activeCycleKey)
  );

  // Coordinate persistent disk cache acquisition on Android when authorized
  useEffect(() => {
    if (!isAuthorized || !currentCandidateUrl || currentStatus === 'failed' || currentStatus === 'empty') {
      return;
    }
    if (!useAndroidDiskCache || nativeCacheBypassedForCandidateRef.current) {
      return;
    }

    const opCycleKey = activeCycleKey;
    const opIdentityGeneration = identityGenerationRef.current;
    const opCandidateGeneration = candidateGenerationRef.current;
    const opLifecycleEpoch = asyncLifecycleEpochRef.current;
    const targetUrl = currentCandidateUrl;

    const syncHit = getInstantCachedImageSrc(targetUrl);
    if (syncHit && !localRecoveryUsedRef.current) {
      if (
        !isCurrentCandidateAsyncValid(
          opCycleKey,
          opIdentityGeneration,
          opCandidateGeneration,
          opLifecycleEpoch
        )
      ) {
        return;
      }
      rememberLoadedImageUrl(targetUrl);
      clearTemporaryImageFailure(targetUrl);
      setEffectiveImgSrc(syncHit);
      setEffectiveImgProvenance('local_file');
      setStatus('loaded');
      return;
    }

    let cancelled = false;
    const abortCtrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const priorityTier = priority
      ? 'critical'
      : fetchPriority === 'high'
        ? 'high'
        : 'normal';

    acquireCachedImage(targetUrl, {
      priority: priorityTier,
      signal: abortCtrl?.signal,
    })
      .then((outcome) => {
        if (
          cancelled ||
          !isCurrentCandidateAsyncValid(
            opCycleKey,
            opIdentityGeneration,
            opCandidateGeneration,
            opLifecycleEpoch
          )
        ) {
          return;
        }
        const nextProvenance: EffectiveImageProvenance = outcome.isLocalFile
          ? 'local_file'
          : inferDirectSourceProvenance(outcome.src);
        if (outcome.bypassedCache) {
          nativeCacheBypassedForCandidateRef.current = true;
        }
        if (
          outcome.fromCache ||
          outcome.isLocalFile ||
          (outcome.bypassedNoStore && nextProvenance === 'data_uri')
        ) {
          rememberLoadedImageUrl(targetUrl);
          clearTemporaryImageFailure(targetUrl);
        }
        setEffectiveImgSrc(outcome.src);
        setEffectiveImgProvenance(nextProvenance);
        if (outcome.fromCache) {
          setStatus('loaded');
        }
      })
      .catch((err) => {
        if (
          cancelled ||
          abortCtrl?.signal.aborted ||
          isImageCancellationOrSessionError(err) ||
          !isCurrentCandidateAsyncValid(
            opCycleKey,
            opIdentityGeneration,
            opCandidateGeneration,
            opLifecycleEpoch
          )
        ) {
          return;
        }

        // HTTP 429: never bypass via direct <img> and never blast alternative requests to the same host
        if (isImageRateLimitError(err)) {
          recordRateLimitedImageHost(targetUrl);
          advanceToCandidateOrFail(targetUrl, {
            recordFailure: false,
            avoidHostOrigin: getImageUrlHostOrigin(targetUrl),
          });
          return;
        }

        // HTTP 401/403: never bypass access restriction via direct <img> and never misclassify as permanent outage
        if (isImageAccessDeniedError(err)) {
          advanceToCandidateOrFail(targetUrl, { recordFailure: false });
          return;
        }

        // Deterministic cache ineligibility (e.g. unsupported format for disk cache):
        // allow direct <img> rendering so WebView can decode it or trigger standard onError fallback
        if (isDeterministicImageCacheIneligibilityError(err)) {
          nativeCacheBypassedForCandidateRef.current = true;
          setEffectiveImgSrc(targetUrl);
          setEffectiveImgProvenance(inferDirectSourceProvenance(targetUrl));
          return;
        }

        const list = candidatesRef.current;
        const hasNextAlternative =
          attemptedUrlsRef.current.size < DEFAULT_MAX_IMAGE_CANDIDATES &&
          findFirstViableCandidateIndex(
            list,
            currentCandidateIndex + 1,
            attemptedUrlsRef.current
          ) >= 0;

        // If native download failed with definitive 404/410 OR another alternative candidate is ready,
        // penalize temporarily and advance sequentially without issuing a redundant direct <img> fetch
        if (isImageNotFoundError(err) || hasNextAlternative) {
          advanceToCandidateOrFail(targetUrl, { recordFailure: true });
          return;
        }

        // Single-URL transient native error: fall back to direct provider URL so single-retry policy applies
        setEffectiveImgSrc(targetUrl);
        setEffectiveImgProvenance(inferDirectSourceProvenance(targetUrl));
      });

    return () => {
      cancelled = true;
      abortCtrl?.abort();
    };
  }, [
    isAuthorized,
    activeCycleKey,
    currentCandidateIndex,
    currentCandidateUrl,
    currentStatus,
    useAndroidDiskCache,
    priority,
    fetchPriority,
    attempt,
  ]);

  // Simulate automatic error trigger in test environment when a local file is explicitly marked corrupted
  useEffect(() => {
    if (
      useAndroidDiskCache &&
      effectiveImgProvenance === 'local_file' &&
      effectiveImgSrc &&
      effectiveImgSrc.includes('?corrupted=1') &&
      !localRecoveryUsedRef.current &&
      currentCandidateUrl
    ) {
      localRecoveryUsedRef.current = true;
      const opCycleKey = activeCycleKey;
      const opIdentityGeneration = identityGenerationRef.current;
      const opCandidateGeneration = candidateGenerationRef.current;
      const opLifecycleEpoch = asyncLifecycleEpochRef.current;
      const targetUrl = currentCandidateUrl;
      let cancelled = false;
      let settled = false;
      cancelActiveRecovery();
      const recoveryCtrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      activeRecoveryAbortRef.current = recoveryCtrl;

      recoverFromCorruptedLocalImage(targetUrl, { signal: recoveryCtrl?.signal })
        .then((recovered) => {
          settled = true;
          if (activeRecoveryAbortRef.current === recoveryCtrl) {
            activeRecoveryAbortRef.current = null;
          }
          if (
            cancelled ||
            recoveryCtrl?.signal.aborted ||
            !isCurrentCandidateAsyncValid(
              opCycleKey,
              opIdentityGeneration,
              opCandidateGeneration,
              opLifecycleEpoch
            )
          ) {
            return;
          }
          const nextProvenance: EffectiveImageProvenance = recovered.isLocalFile
            ? 'local_file'
            : inferDirectSourceProvenance(recovered.src);
          if (recovered.bypassedCache) {
            nativeCacheBypassedForCandidateRef.current = true;
          }
          if (
            recovered.fromCache ||
            recovered.isLocalFile ||
            (recovered.bypassedNoStore && nextProvenance === 'data_uri')
          ) {
            rememberLoadedImageUrl(targetUrl);
            clearTemporaryImageFailure(targetUrl);
          }
          setEffectiveImgSrc(recovered.src);
          setEffectiveImgProvenance(nextProvenance);
          setStatus('loaded');
        })
        .catch((err) => {
          settled = true;
          if (activeRecoveryAbortRef.current === recoveryCtrl) {
            activeRecoveryAbortRef.current = null;
          }
          if (
            cancelled ||
            recoveryCtrl?.signal.aborted ||
            isImageCancellationOrSessionError(err) ||
            !isCurrentCandidateAsyncValid(
              opCycleKey,
              opIdentityGeneration,
              opCandidateGeneration,
              opLifecycleEpoch
            )
          ) {
            return;
          }
          if (isImageRateLimitError(err)) {
            recordRateLimitedImageHost(targetUrl);
            advanceToCandidateOrFail(targetUrl, {
              recordFailure: false,
              avoidHostOrigin: getImageUrlHostOrigin(targetUrl),
            });
            return;
          }
          if (isImageAccessDeniedError(err)) {
            advanceToCandidateOrFail(targetUrl, { recordFailure: false });
            return;
          }
          if (isDeterministicImageCacheIneligibilityError(err)) {
            nativeCacheBypassedForCandidateRef.current = true;
            setEffectiveImgSrc(targetUrl);
            setEffectiveImgProvenance(inferDirectSourceProvenance(targetUrl));
            return;
          }
          const list = candidatesRef.current;
          const hasNextAlternative =
            attemptedUrlsRef.current.size < DEFAULT_MAX_IMAGE_CANDIDATES &&
            findFirstViableCandidateIndex(
              list,
              currentCandidateIndex + 1,
              attemptedUrlsRef.current
            ) >= 0;
          if (isImageNotFoundError(err) || hasNextAlternative) {
            advanceToCandidateOrFail(targetUrl, { recordFailure: true });
            return;
          }
          setEffectiveImgSrc(targetUrl);
          setEffectiveImgProvenance(inferDirectSourceProvenance(targetUrl));
        });
      return () => {
        cancelled = true;
        recoveryCtrl?.abort();
        if (activeRecoveryAbortRef.current === recoveryCtrl) {
          activeRecoveryAbortRef.current = null;
        }
        if (
          !settled &&
          activeCycleKeyRef.current === opCycleKey &&
          identityGenerationRef.current === opIdentityGeneration &&
          candidateGenerationRef.current === opCandidateGeneration
        ) {
          localRecoveryUsedRef.current = false;
        }
      };
    }
  }, [
    useAndroidDiskCache,
    effectiveImgProvenance,
    effectiveImgSrc,
    activeCycleKey,
    currentCandidateIndex,
    currentCandidateUrl,
  ]);

  const handleImageError = (
    e: React.SyntheticEvent<HTMLImageElement, Event>,
    eventCycleKey: string,
    eventIdentityGeneration: number,
    eventCandidateGeneration: number
  ) => {
    if (
      !isCurrentCandidateVisualValid(
        eventCycleKey,
        eventIdentityGeneration,
        eventCandidateGeneration
      )
    ) {
      return;
    }

    const failedUrl = currentCandidateUrl;
    if (failedUrl) {
      loadedImageUrlsCache.delete(failedUrl);
    }

    // 1. Shared single local-file corruption recovery budget across the entire cycle
    if (
      effectiveImgProvenance === 'local_file' &&
      useAndroidDiskCache &&
      failedUrl &&
      effectiveImgSrc &&
      !localRecoveryUsedRef.current
    ) {
      localRecoveryUsedRef.current = true;
      setStatus('loading');
      const opCycleKey = eventCycleKey;
      const opIdentityGeneration = eventIdentityGeneration;
      const opCandidateGeneration = eventCandidateGeneration;
      const opLifecycleEpoch = asyncLifecycleEpochRef.current;
      cancelActiveRecovery();
      const recoveryCtrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      activeRecoveryAbortRef.current = recoveryCtrl;

      recoverFromCorruptedLocalImage(failedUrl, { signal: recoveryCtrl?.signal })
        .then((recovered) => {
          if (activeRecoveryAbortRef.current === recoveryCtrl) {
            activeRecoveryAbortRef.current = null;
          }
          if (
            recoveryCtrl?.signal.aborted ||
            !isCurrentCandidateAsyncValid(
              opCycleKey,
              opIdentityGeneration,
              opCandidateGeneration,
              opLifecycleEpoch
            )
          ) {
            return;
          }
          const nextProvenance: EffectiveImageProvenance = recovered.isLocalFile
            ? 'local_file'
            : inferDirectSourceProvenance(recovered.src);
          if (recovered.bypassedCache) {
            nativeCacheBypassedForCandidateRef.current = true;
          }
          if (
            recovered.fromCache ||
            recovered.isLocalFile ||
            (recovered.bypassedNoStore && nextProvenance === 'data_uri')
          ) {
            rememberLoadedImageUrl(failedUrl);
            clearTemporaryImageFailure(failedUrl);
          }
          setEffectiveImgSrc(recovered.src);
          setEffectiveImgProvenance(nextProvenance);
          if (recovered.isLocalFile || recovered.fromCache) {
            setStatus('loaded');
          }
        })
        .catch((err) => {
          if (activeRecoveryAbortRef.current === recoveryCtrl) {
            activeRecoveryAbortRef.current = null;
          }
          if (
            recoveryCtrl?.signal.aborted ||
            isImageCancellationOrSessionError(err) ||
            !isCurrentCandidateAsyncValid(
              opCycleKey,
              opIdentityGeneration,
              opCandidateGeneration,
              opLifecycleEpoch
            )
          ) {
            return;
          }
          if (isImageRateLimitError(err)) {
            recordRateLimitedImageHost(failedUrl);
            advanceToCandidateOrFail(failedUrl, {
              recordFailure: false,
              avoidHostOrigin: getImageUrlHostOrigin(failedUrl),
            });
            return;
          }
          if (isImageAccessDeniedError(err)) {
            advanceToCandidateOrFail(failedUrl, { recordFailure: false });
            return;
          }
          if (isDeterministicImageCacheIneligibilityError(err)) {
            nativeCacheBypassedForCandidateRef.current = true;
            setEffectiveImgSrc(failedUrl);
            setEffectiveImgProvenance(inferDirectSourceProvenance(failedUrl));
            return;
          }
          const list = candidatesRef.current;
          const hasNextAlternative =
            attemptedUrlsRef.current.size < DEFAULT_MAX_IMAGE_CANDIDATES &&
            findFirstViableCandidateIndex(
              list,
              currentCandidateIndex + 1,
              attemptedUrlsRef.current
            ) >= 0;
          if (isImageNotFoundError(err) || hasNextAlternative) {
            advanceToCandidateOrFail(failedUrl, { recordFailure: true });
            return;
          }
          setEffectiveImgSrc(failedUrl);
          setEffectiveImgProvenance(inferDirectSourceProvenance(failedUrl));
        });
      return;
    }

    // 2. Prioritize switching sequentially to the next valid non-penalized alternative candidate
    const list = candidatesRef.current;
    const hasNextAlternative =
      attemptedUrlsRef.current.size < DEFAULT_MAX_IMAGE_CANDIDATES &&
      findFirstViableCandidateIndex(
        list,
        currentCandidateIndex + 1,
        attemptedUrlsRef.current
      ) >= 0;

    if (hasNextAlternative) {
      advanceToCandidateOrFail(failedUrl, { recordFailure: true });
      onError?.(e);
      return;
    }

    // 3. When only a single candidate exists, preserve the exact limited single retry (~2000ms)
    if (list.length === 1 && !retryUsedRef.current && attempt === 0) {
      retryUsedRef.current = true;
      setStatus('retrying');

      clearScheduledRetryTimer();
      activeRetryTimersCount++;
      const timerCycleKey = eventCycleKey;
      const timerIdentityGeneration = eventIdentityGeneration;
      const timerCandidateGeneration = eventCandidateGeneration;
      const timerLifecycleEpoch = asyncLifecycleEpochRef.current;
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        activeRetryTimersCount = Math.max(0, activeRetryTimersCount - 1);
        if (
          !isCurrentCandidateAsyncValid(
            timerCycleKey,
            timerIdentityGeneration,
            timerCandidateGeneration,
            timerLifecycleEpoch
          )
        ) {
          return;
        }
        candidateGenerationRef.current += 1;
        setAttempt(1);
        setStatus('loading');
      }, mediaImageRetryDelayMs);
      onError?.(e);
      return;
    }

    // 4. Exhausted all candidates / retry budget: record temporary failure and show clean visual fallback
    advanceToCandidateOrFail(failedUrl, { recordFailure: true });
    onError?.(e);
  };

  const handleImageLoad = (
    e: React.SyntheticEvent<HTMLImageElement, Event>,
    eventCycleKey: string,
    eventIdentityGeneration: number,
    eventCandidateGeneration: number
  ) => {
    if (
      !isCurrentCandidateVisualValid(
        eventCycleKey,
        eventIdentityGeneration,
        eventCandidateGeneration
      )
    ) {
      return;
    }
    if (currentCandidateUrl) {
      clearTemporaryImageFailure(currentCandidateUrl);
      rememberLoadedImageUrl(currentCandidateUrl);
    }
    setStatus('loaded');
    onLoad?.(e);
  };

  // If no valid candidates exist or all candidates failed definitively:
  // Render an empty reserved area preserving the layout and background classes without an <img> tag.
  if (!currentCandidateUrl || currentStatus === 'empty' || currentStatus === 'failed') {
    return (
      <div
        className={className}
        aria-label={alt || itemName || undefined}
        role={alt || itemName ? 'img' : undefined}
      />
    );
  }

  // If image has not yet been authorized by visibility or focus,
  // or is waiting for Android native disk cache acquisition before mounting <img>:
  // Keep the reserved layout container without activating duplicate simultaneous network requests.
  if (!isAuthorized || !currentEffectiveSrc) {
    return (
      <div
        className={className}
        data-media-image-deferred={!isAuthorized ? 'true' : undefined}
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
      key={`${activeCycleKey}_gen_${renderIdentityGeneration}_cand_${renderCandidateGeneration}_attempt_${attempt}`}
      src={currentEffectiveSrc}
      alt={alt}
      loading={effectiveLoading}
      decoding={effectiveDecoding}
      fetchPriority={effectiveFetchPriority}
      className={`${className} ${currentStatus === 'loaded' ? 'opacity-100' : 'opacity-0'} transition-opacity duration-200`}
      onError={(e) =>
        handleImageError(
          e,
          activeCycleKey,
          renderIdentityGeneration,
          renderCandidateGeneration
        )
      }
      onLoad={(e) =>
        handleImageLoad(
          e,
          activeCycleKey,
          renderIdentityGeneration,
          renderCandidateGeneration
        )
      }
      {...rest}
    />
  );
}

export const MediaImage = React.memo(MediaImageInner);
