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
   * Once authorized for a given (itemId, resolvedUrl) identity, authorization is latched
   * across re-renders and visibility exits/re-entries.
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
// Shared Container IntersectionObserver Pool & Fallback Manager
// ============================================================================

export const VERTICAL_HOME_ROOT_MARGIN = '240px 0px';
export const HORIZONTAL_ROW_ROOT_MARGIN = '0px 280px';
export const INITIAL_VISIBLE_CARDS_PER_ROW = 8;

interface ParsedRootMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function parseRootMarginPx(rawMargin: string): ParsedRootMargin {
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

export function evaluateElementVisibilityInContainer(
  target: HTMLElement,
  root: HTMLElement | null,
  margins: ParsedRootMargin,
  axis: 'vertical' | 'horizontal',
  index: number
): boolean {
  const targetRect = target.getBoundingClientRect();
  const rootRect = root ? root.getBoundingClientRect() : null;

  if (axis === 'vertical') {
    const hasMeasuredRects =
      targetRect.height > 0 &&
      (rootRect ? rootRect.height > 0 : typeof window !== 'undefined' && window.innerHeight > 0);
    if (hasMeasuredRects) {
      const rTop = rootRect ? rootRect.top : 0;
      const rBottom = rootRect ? rootRect.bottom : window.innerHeight || 720;
      return (
        targetRect.bottom >= rTop - margins.top &&
        targetRect.top <= rBottom + margins.bottom
      );
    }

    const scrollTop = root ? root.scrollTop || 0 : typeof window !== 'undefined' ? window.scrollY || 0 : 0;
    const viewportHeight =
      root && root.clientHeight > 0
        ? root.clientHeight
        : typeof window !== 'undefined' && window.innerHeight > 0
          ? window.innerHeight
          : 720;
    const itemTop = target.offsetTop > 0 ? target.offsetTop : 604 + index * 380;
    const itemHeight = target.offsetHeight > 0 ? target.offsetHeight : 320;
    const itemBottom = itemTop + itemHeight;
    return (
      itemBottom >= scrollTop - margins.top &&
      itemTop <= scrollTop + viewportHeight + margins.bottom
    );
  } else {
    const hasMeasuredRects =
      targetRect.width > 0 &&
      (rootRect ? rootRect.width > 0 : typeof window !== 'undefined' && window.innerWidth > 0);
    if (hasMeasuredRects) {
      const rLeft = rootRect ? rootRect.left : 0;
      const rRight = rootRect ? rootRect.right : window.innerWidth || 1280;
      return (
        targetRect.right >= rLeft - margins.left &&
        targetRect.left <= rRight + margins.right
      );
    }

    const scrollLeft = root ? root.scrollLeft || 0 : typeof window !== 'undefined' ? window.scrollX || 0 : 0;
    const viewportWidth =
      root && root.clientWidth > 0
        ? root.clientWidth
        : typeof window !== 'undefined' && window.innerWidth > 0
          ? window.innerWidth
          : 1200;
    const itemLeft = target.offsetLeft > 0 ? target.offsetLeft : index * 192;
    const itemWidth = target.offsetWidth > 0 ? target.offsetWidth : 176;
    const itemRight = itemLeft + itemWidth;
    return (
      itemRight >= scrollLeft - margins.left &&
      itemLeft <= scrollLeft + viewportWidth + margins.right
    );
  }
}

interface ObservedTargetRecord {
  target: HTMLElement;
  index: number;
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
}

export function getSharedObserverDiagnostics(): SharedObserverDiagnostics {
  let activeObserverInstances = 0;
  let activePoolEntries = 0;
  let activeTargetSubscriptions = 0;
  let fallbackScrollListeners = 0;
  const verticalObserverRoots: Array<HTMLElement | null> = [];
  const horizontalObserverRoots: Array<HTMLElement | null> = [];

  for (const [, byKey] of sharedObserverPool.entries()) {
    for (const [, entry] of byKey.entries()) {
      activePoolEntries++;
      if (entry.observer) {
        activeObserverInstances++;
      }
      if (entry.usingFallbackOnly) {
        fallbackScrollListeners++;
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

function reevaluatePoolEntryTargets(entry: SharedObserverPoolEntry): void {
  for (const [, targetRec] of entry.targets.entries()) {
    const isNowIntersecting = evaluateElementVisibilityInContainer(
      targetRec.target,
      entry.root,
      entry.parsedMargins,
      entry.axis,
      targetRec.index
    );
    if (targetRec.lastIntersecting !== isNowIntersecting) {
      targetRec.lastIntersecting = isNowIntersecting;
      for (const listener of Array.from(targetRec.listeners)) {
        listener(isNowIntersecting);
      }
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
  let observer: IntersectionObserver | null = null;

  const entry: SharedObserverPoolEntry = {
    key,
    root,
    rootMargin,
    parsedMargins,
    axis,
    observer: null,
    usingFallbackOnly: IOConstructor === null,
    targets: new Map<HTMLElement, ObservedTargetRecord>(),
    disposeListeners: () => {},
  };

  if (IOConstructor) {
    try {
      observer = new IOConstructor(
        (ioEntries: IntersectionObserverEntry[]) => {
          for (const ioEntry of ioEntries) {
            const targetEl = ioEntry.target as HTMLElement;
            const targetRec = entry.targets.get(targetEl);
            if (!targetRec) continue;
            const isIntersecting = Boolean(
              ioEntry.isIntersecting ||
                (typeof ioEntry.intersectionRatio === 'number' && ioEntry.intersectionRatio > 0)
            );
            if (targetRec.lastIntersecting !== isIntersecting) {
              targetRec.lastIntersecting = isIntersecting;
              for (const listener of Array.from(targetRec.listeners)) {
                listener(isIntersecting);
              }
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
    } catch {
      entry.observer = null;
      entry.usingFallbackOnly = true;
    }
  }

  const onScrollOrResize = () => {
    reevaluatePoolEntryTargets(entry);
  };

  const scrollEventTarget: EventTarget | null =
    root ?? (typeof window !== 'undefined' ? window : null);

  if (scrollEventTarget && typeof scrollEventTarget.addEventListener === 'function') {
    scrollEventTarget.addEventListener('scroll', onScrollOrResize, { passive: true } as AddEventListenerOptions);
  }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('resize', onScrollOrResize);
  }

  entry.disposeListeners = () => {
    if (scrollEventTarget && typeof scrollEventTarget.removeEventListener === 'function') {
      scrollEventTarget.removeEventListener('scroll', onScrollOrResize);
    }
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('resize', onScrollOrResize);
    }
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
    const initialIntersecting = evaluateElementVisibilityInContainer(
      target,
      root,
      poolEntry.parsedMargins,
      axis,
      index
    );
    targetRec = {
      target,
      index,
      lastIntersecting: initialIntersecting,
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

  // Synchronize initial visibility state immediately on subscription
  const currentVisible = evaluateElementVisibilityInContainer(
    target,
    root,
    poolEntry.parsedMargins,
    axis,
    index
  );
  targetRec.lastIntersecting = currentVisible;
  onIntersectChange(currentVisible);

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
 * 4. Separates image identity (`itemId` + `resolvedUrl`) from loading authorization (`active`):
 *    once authorized, state and retry budget are preserved across visibility exits/re-entries and re-renders.
 * 5. Exactly ONE retry after ~2000ms using the exact same URL upon initial onError.
 * 6. Resets retry budget and cancels pending timers on unmount or when source/serverUrl changes.
 * 7. Reuses the loaded URL memory cache (up to 2,500 entries) so already-loaded images render immediately.
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

  const shouldAuthorizeNow = Boolean(active || priority || isCachedLoaded);
  const [latchedAuthorizedKey, setLatchedAuthorizedKey] = useState<string | null>(() =>
    resolvedUrl && shouldAuthorizeNow ? currentKey : null
  );

  // Status & retry count state (reuse loaded URL memory cache to avoid opacity-0 flash on remount)
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
    if (isCachedLoaded && status !== 'loaded') {
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

