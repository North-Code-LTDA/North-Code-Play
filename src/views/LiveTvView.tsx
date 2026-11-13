import React, { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import {
  TvMinimalPlay,
  Loader2,
  AlertCircle,
  RefreshCw,
  Layers,
  ChevronDown,
  ChevronLeft,
  Check,
} from 'lucide-react';
import { useXtreamCredentials, useXtreamLive } from '../context/XtreamContext';
import { useFavorites, FavoriteItem } from '../hooks/useFavorites';
import { LiveTvHero } from '../components/LiveTvHero';
import { LiveChannelRow, LiveChannelCard } from '../components/LiveChannelRow';
import { XtreamService } from '../services/xtreamService';
import { buildDirectMediaUrl } from '../utils/mediaUtils';
import { useAccountPlaybackHistory, recordPlaybackPosition } from '../utils/playbackHistory';
import { formatCategoryLabel } from '../utils/categoryLabel';
import {
  groupLiveStreams,
  filterLiveChannelGroups,
  LiveChannelGroup,
  ResolutionQuality,
} from '../utils/liveChannelGroups';
import { getOrCreateLiveIndex } from '../utils/catalogIndex';
import {
  buildEpgCacheKeys,
  resolveNowPlayingProgram,
  LIVE_SHOWCASE_ROW_WINDOW_SIZE,
  EPG_CLOCK_UPDATE_INTERVAL_MS,
  getLiveEpgClockNowMs,
  subscribeLiveEpgClockForTest,
  getSharedSessionEpgCache,
  clearSharedSessionEpgCache,
} from '../utils/epgUtils';
import { useVirtualWindow } from '../hooks/useVirtualWindow';
import {
  useBackHandler,
  BACK_PRIORITY,
  getNavMode,
  focusElementSafely,
  isElementFocusable,
  registerShowcaseRowController,
  unregisterShowcaseRowController,
} from '../navigation';

export const AUTO_RESOLUTION_PRIORITY: ResolutionQuality[] = ['SD', 'HD', 'FHD', '4K'];

const DEFAULT_LIVE_FALLBACK_TIMEOUT_MS = 28000;
let liveFallbackTimeoutOverrideMs: number | null = null;

export function getLiveFallbackTimeoutMs(): number {
  return liveFallbackTimeoutOverrideMs !== null
    ? liveFallbackTimeoutOverrideMs
    : DEFAULT_LIVE_FALLBACK_TIMEOUT_MS;
}

export function setLiveFallbackTimeoutMsForTest(ms: number | null): void {
  liveFallbackTimeoutOverrideMs = ms;
}

const SHOWCASE_SCROLL_HYSTERESIS_PX = 24;

function setElementScrollTopImmediate(el: HTMLElement, targetScrollTop: number): void {
  const next = Math.max(0, targetScrollTop);
  const prevBehavior = el.style?.scrollBehavior ?? '';
  try {
    if (el.style) {
      el.style.scrollBehavior = 'auto';
    }
    if (typeof el.scrollTo === 'function') {
      try {
        el.scrollTo({ top: next, behavior: 'instant' as ScrollBehavior });
      } catch {
        el.scrollTo({ top: next, behavior: 'auto' });
      }
    }
    el.scrollTop = next;
  } catch {
    el.scrollTop = next;
  } finally {
    if (el.style) {
      if (prevBehavior) {
        el.style.scrollBehavior = prevBehavior;
      } else {
        el.style.removeProperty('scroll-behavior');
      }
    }
  }
}

function measureShowcaseRowVisualTop(
  containerEl: HTMLElement | null,
  mainEl: HTMLElement | null,
  rowIndex: number
): number | null {
  if (!containerEl || !mainEl || rowIndex < 0) return null;
  const targetEl =
    containerEl.querySelector<HTMLElement>(
      `[data-scroll-block="true"][data-showcase-row-index="${rowIndex}"]`
    ) ||
    containerEl
      .querySelector<HTMLElement>(`[data-home-row-index="${rowIndex}"]`)
      ?.closest<HTMLElement>('[data-scroll-block="true"]') ||
    containerEl.querySelector<HTMLElement>(`[data-home-row-index="${rowIndex}"]`);
  if (!targetEl) return null;
  const mainRect = mainEl.getBoundingClientRect();
  const rowRect = targetEl.getBoundingClientRect();
  if (
    (rowRect.height > 0 || rowRect.top !== 0 || rowRect.bottom !== 0) &&
    typeof rowRect.top === 'number' &&
    typeof mainRect.top === 'number'
  ) {
    return rowRect.top - mainRect.top;
  }
  const offsetTop = (targetEl as any).offsetTop;
  if (typeof offsetTop === 'number' && offsetTop > 0) {
    return offsetTop - (mainEl.scrollTop || 0);
  }
  return null;
}

function estimateTitleLineCount(
  title: string,
  availableWidthPx: number,
  fontSizePx: number
): number {
  const trimmed = (title || '').trim();
  if (!trimmed) return 1;
  const safeWidth = Math.max(120, availableWidthPx);
  const avgCharWidth = Math.max(8, fontSizePx * 0.68);
  const maxCharsPerLine = Math.max(8, Math.floor(safeWidth / avgCharWidth));
  const words = trimmed.split(/\s+/);
  let lines = 1;
  let currentLineChars = 0;

  for (const word of words) {
    const wordLen = word.length;
    if (currentLineChars === 0) {
      if (wordLen <= maxCharsPerLine) {
        currentLineChars = wordLen;
      } else {
        const extraLines = Math.ceil(wordLen / maxCharsPerLine) - 1;
        lines += extraLines;
        currentLineChars = wordLen % maxCharsPerLine || maxCharsPerLine;
      }
    } else if (currentLineChars + 1 + wordLen <= maxCharsPerLine) {
      currentLineChars += 1 + wordLen;
    } else {
      lines += 1;
      if (wordLen <= maxCharsPerLine) {
        currentLineChars = wordLen;
      } else {
        const extraLines = Math.ceil(wordLen / maxCharsPerLine) - 1;
        lines += extraLines;
        currentLineChars = wordLen % maxCharsPerLine || maxCharsPerLine;
      }
    }
  }
  return Math.max(1, lines);
}

function estimateLiveShowcaseRowSlotHeight(title: string, viewportWidth: number): number {
  const safeVw = viewportWidth > 0 ? viewportWidth : 1280;

  let isTvMode = false;
  let tvScale = 85;
  if (typeof document !== 'undefined' && document.documentElement) {
    isTvMode = document.documentElement.getAttribute('data-display-mode') === 'tv';
    const inlineScale = parseFloat(
      document.documentElement.style.getPropertyValue('--nc-ui-scale') || ''
    );
    if (Number.isFinite(inlineScale) && inlineScale > 0) {
      tvScale = inlineScale * 100;
    }
  }

  let cardHeightPx: number;
  let headingFontSizePx: number;

  if (isTvMode) {
    const clampedScale = Math.max(0.5, Math.min(1.25, tvScale / 100));
    const remPx = 16 * clampedScale;
    cardHeightPx = 8.75 * remPx;
    headingFontSizePx = Math.min(
      1.5 * remPx,
      Math.max(1.125 * remPx, 0.98 * remPx + 0.0065 * safeVw)
    );
  } else {
    cardHeightPx = safeVw >= 768 ? 140 : safeVw >= 640 ? 132 : 116;
    headingFontSizePx = Math.min(24, Math.max(18, 15.68 + 0.0065 * safeVw));
  }

  const horizontalPadPx = safeVw >= 768 ? 80 : safeVw >= 640 ? 48 : 32;
  const availableTitleWidthPx = Math.max(160, safeVw - horizontalPadPx);
  const titleLines = estimateTitleLineCount(title, availableTitleWidthPx, headingFontSizePx);
  const headingLineHeightPx = headingFontSizePx * 1.25;
  const headingHeightPx = titleLines * headingLineHeightPx;

  // mb-4 (16px) + pt-4 (16px) + pb-8 (32px) + pb-6 (24px) = 88px vertical chrome
  return Math.round(headingHeightPx + cardHeightPx + 88);
}

/**
 * Selects the next channel variant stream to attempt.
 * - In 'auto' mode: strictly follows SD -> HD -> FHD -> 4K priority (lowest to highest resolution),
 *   skipping streams already present in attemptedSet. Within the same resolution tier, prefers a
 *   previously successful stream from session memory if available and untried.
 * - In manual mode: tries the explicitly chosen variant first, then any other untried stream of the
 *   same chosen resolution, and finally falls back to remaining resolutions in SD -> HD -> FHD -> 4K order.
 */
export function selectChannelVariantForAttempt(
  group: LiveChannelGroup,
  targetMode: string,
  attemptedSet: Set<string | number>,
  sessionSuccessfulStreamId?: string | number
): any | null {
  if (!group) return null;
  if (!group.isGrouped || group.variants.length === 0) {
    const sId = group.primaryStream.stream_id || group.primaryStream.id;
    return attemptedSet.has(sId) ? null : group.primaryStream;
  }

  // 1. Manual mode handling
  if (targetMode !== 'auto') {
    const selectedVariant = group.variants.find(
      (v) =>
        String(v.streamId) === targetMode || v.label === targetMode || v.resolution === targetMode
    );

    const targetResolution = selectedVariant
      ? selectedVariant.resolution
      : (targetMode as ResolutionQuality);

    if (selectedVariant && !attemptedSet.has(selectedVariant.streamId)) {
      return selectedVariant.stream;
    }

    const sameResVariants = group.variants.filter((v) => v.resolution === targetResolution);
    for (const v of sameResVariants) {
      if (!attemptedSet.has(v.streamId)) {
        return v.stream;
      }
    }

    for (const res of AUTO_RESOLUTION_PRIORITY) {
      if (res === targetResolution) continue;
      const otherVariants = group.variants.filter((v) => v.resolution === res);
      for (const v of otherVariants) {
        if (!attemptedSet.has(v.streamId)) {
          return v.stream;
        }
      }
    }

    return null;
  }

  // 2. Automatic mode handling: strictly SD -> HD -> FHD -> 4K
  for (const res of AUTO_RESOLUTION_PRIORITY) {
    const matchingVariants = group.variants.filter((v) => v.resolution === res);
    if (matchingVariants.length === 0) continue;

    if (sessionSuccessfulStreamId !== undefined && !attemptedSet.has(sessionSuccessfulStreamId)) {
      const preferredInTier = matchingVariants.find(
        (v) => String(v.streamId) === String(sessionSuccessfulStreamId)
      );
      if (preferredInTier) {
        return preferredInTier.stream;
      }
    }

    for (const v of matchingVariants) {
      if (!attemptedSet.has(v.streamId)) {
        return v.stream;
      }
    }
  }

  for (const v of group.variants) {
    if (!attemptedSet.has(v.streamId)) {
      return v.stream;
    }
  }

  return null;
}

export interface LiveChannelLaunchIntent {
  streamId: string | number;
  requestId: number;
  categoryId?: string;
  streamSnapshot?: any;
}

interface LiveTvViewProps {
  onPlay: (url: string, title: string, startAt?: number, streamId?: string | number) => void;
  searchQuery?: string;
  initialChannelIntent?: LiveChannelLaunchIntent | null;
  onConsumeChannelIntent?: (requestId: number) => void;
}

export interface LiveTvLayoutMetricsInput {
  viewportWidth: number;
  viewportHeight: number;
  uiScale?: number;
  displayMode?: 'default' | 'tv';
  isGrouped?: boolean;
  hasNowPlaying?: boolean;
  epgCount?: number;
}

export interface LiveTvLayoutMetrics {
  isMobile: boolean;
  isShortLandscape: boolean;
  remPx: number;
  rightPaneWidth: number;
  rightPaneHeight: number;
  topSectionDirection: 'row' | 'column';
  previewWidth: number;
  previewHeight: number;
  previewAspectRatio: number;
  summaryHeight: number;
  topSectionHeight: number;
  epgSectionHeight: number;
  epgHeaderHeight: number;
  epgScrollViewportHeight: number;
  epgCardHeight: number;
  epgTotalContentHeight: number;
  epgMaxScrollTop: number;
  visibleEpgCardsCount: number;
}

export function computeLiveTvLayoutMetrics({
  viewportWidth,
  viewportHeight,
  uiScale = 1,
  displayMode = 'default',
  isGrouped = false,
  hasNowPlaying = true,
  epgCount = 6,
}: LiveTvLayoutMetricsInput): LiveTvLayoutMetrics {
  const isMobile = viewportWidth < 768;
  const isShortLandscape = !isMobile && viewportHeight <= 640;
  const effectiveScale = displayMode === 'tv' ? Math.max(0.5, Math.min(1.25, uiScale)) : 1;
  const remPx = 16 * effectiveScale;

  const rightPaneWidth = Math.max(300, viewportWidth);
  const safeBottomPx =
    displayMode === 'tv' ? Math.min(28, Math.max(10, Math.round(viewportHeight * 0.022))) : 0;
  const rightPaneHeight = Math.max(240, viewportHeight - safeBottomPx);

  const topSectionDirection: 'row' | 'column' = isMobile ? 'column' : 'row';
  const topPadY =
    displayMode === 'tv' ? Math.round(1.5 * remPx) : isShortLandscape ? 16 : 24;
  const topPadX =
    displayMode === 'tv' ? Math.round(2 * remPx) : isShortLandscape ? 32 : 48;

  const innerTopWidth = Math.max(240, rightPaneWidth - topPadX);
  let previewWidth: number;
  if (isMobile) {
    previewWidth = innerTopWidth;
  } else if (displayMode === 'tv') {
    previewWidth = Math.round(Math.min(innerTopWidth * 0.48, 34 * remPx));
  } else {
    previewWidth = Math.round(Math.min(innerTopWidth * 0.48, 544));
  }
  const previewHeight = Math.round((previewWidth * 9) / 16);
  const previewAspectRatio = Number((previewWidth / Math.max(1, previewHeight)).toFixed(4));

  const logoRowHeight = Math.round((displayMode === 'tv' ? 3 : 3.5) * remPx);
  const variantsHeight = isGrouped ? Math.round(2.25 * remPx) : 0;
  const nowPlayingHeight = hasNowPlaying ? Math.round(4.75 * remPx) : 0;
  const summaryGaps = Math.round(1.5 * remPx);
  const summaryHeight = logoRowHeight + variantsHeight + nowPlayingHeight + summaryGaps;

  const topSectionHeight =
    topSectionDirection === 'row'
      ? Math.max(previewHeight, summaryHeight) + topPadY
      : previewHeight + summaryHeight + topPadY + 12;

  const epgHeaderHeight = Math.round(2.5 * remPx);
  const epgSectionHeight = Math.max(180, rightPaneHeight - topSectionHeight);
  const epgScrollViewportHeight = Math.max(120, epgSectionHeight - epgHeaderHeight);
  const epgCardHeight = Math.round((displayMode === 'tv' ? 8.75 : 8.75) * remPx);
  const epgGap = Math.round(1 * remPx);
  const epgPadY = Math.round(1.5 * remPx);
  const epgTotalContentHeight =
    epgCount > 0
      ? epgCount * epgCardHeight + Math.max(0, epgCount - 1) * epgGap + epgPadY
      : epgScrollViewportHeight;
  const epgMaxScrollTop = Math.max(0, epgTotalContentHeight - epgScrollViewportHeight);
  const visibleEpgCardsCount = Number(
    (Math.max(0, epgScrollViewportHeight - epgPadY / 2) / (epgCardHeight + epgGap)).toFixed(2)
  );

  return {
    isMobile,
    isShortLandscape,
    remPx,
    rightPaneWidth,
    rightPaneHeight,
    topSectionDirection,
    previewWidth,
    previewHeight,
    previewAspectRatio,
    summaryHeight,
    topSectionHeight,
    epgSectionHeight,
    epgHeaderHeight,
    epgScrollViewportHeight,
    epgCardHeight,
    epgTotalContentHeight,
    epgMaxScrollTop,
    visibleEpgCardsCount,
  };
}

interface LiveRowEntry {
  key: string;
  title: string;
  groups: LiveChannelGroup[];
  virtualize: boolean;
}

const VIRTUAL_LIVE_CATEGORIES = [
  { category_id: 'nc_recent', category_name: 'Assistidos Recentemente' },
  { category_id: 'nc_fav', category_name: 'Canais Favoritos' },
];

interface LiveChannelGridProps {
  groups: LiveChannelGroup[];
  mainContainerRef: React.RefObject<HTMLElement | null>;
  resetKey: string;
  serverUrl?: string;
  accountPrefix: string;
  selectedGroupId: string | null;
  epgCache: ReadonlyMap<string, any[]>;
  epgCacheVersion: number;
  referenceNowMs?: number;
  onActivateGroup: (group: LiveChannelGroup, el: HTMLButtonElement) => void;
}

const LiveChannelGrid = React.memo(function LiveChannelGrid({
  groups,
  mainContainerRef,
  resetKey,
  serverUrl,
  accountPrefix,
  selectedGroupId,
  epgCache,
  epgCacheVersion,
  referenceNowMs,
  onActivateGroup,
}: LiveChannelGridProps) {
  const gridContainerRef = useRef<HTMLDivElement>(null);

  const {
    startIndex: gridStartIndex,
    endIndex: gridEndIndex,
    topSpacerPx: gridTopSpacerPx,
    bottomSpacerPx: gridBottomSpacerPx,
    virtualContainerCallbackRef: gridVirtualCallbackRef,
  } = useVirtualWindow({
    totalCount: groups.length,
    mode: 'grid',
    scrollContainerRef: mainContainerRef as React.RefObject<HTMLDivElement | null>,
    virtualContainerRef: gridContainerRef,
    resetKey,
    maxWindowItems: 72,
  });

  return (
    <>
      {gridTopSpacerPx > 0 && (
        <div
          data-virtual-spacer="top"
          aria-hidden="true"
          style={{ height: `${gridTopSpacerPx}px` }}
        />
      )}
      <div
        ref={gridVirtualCallbackRef}
        data-nav-grid="true"
        data-virtual-container="true"
        data-virtual-total={groups.length}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        {groups.slice(gridStartIndex, gridEndIndex).map((group, localIdx) => {
          const actualIndex = gridStartIndex + localIdx;
          return (
            <LiveChannelCard
              key={group.groupId}
              group={group}
              serverUrl={serverUrl}
              accountPrefix={accountPrefix}
              isSelected={selectedGroupId === group.groupId}
              epgCache={epgCache}
              epgCacheVersion={epgCacheVersion}
              referenceNowMs={referenceNowMs}
              layoutVariant="grid"
              virtualIndex={actualIndex}
              rowPriority={actualIndex < 12}
              allowImageRender={true}
              onActivate={onActivateGroup}
            />
          );
        })}
      </div>
      {gridBottomSpacerPx > 0 && (
        <div
          data-virtual-spacer="bottom"
          aria-hidden="true"
          style={{ height: `${gridBottomSpacerPx}px` }}
        />
      )}
    </>
  );
});

export const LiveTvView = React.memo(function LiveTvView({
  searchQuery = '',
  initialChannelIntent = null,
  onConsumeChannelIntent,
}: LiveTvViewProps) {
  const { credentials } = useXtreamCredentials();
  const {
    liveCategories,
    liveStreams,
    allLiveStreams,
    fetchLiveStreams,
    loadingLive,
    liveError,
    liveCategoriesError,
    liveCategoriesStatus,
    liveCatalogStatus,
    fetchLiveCategories,
  } = useXtreamLive();

  const {
    favorites,
    isFavorite,
    toggleFavorite,
    toggleGroupFavorites,
    favoriteError,
    clearFavoriteError,
  } = useFavorites();
  const [favActionError, setFavActionError] = useState<string | null>(null);
  const historyRecords = useAccountPlaybackHistory(credentials);

  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [isCategoriesMenuOpen, setIsCategoriesMenuOpen] = useState(false);
  const [isRetryingDomain, setIsRetryingDomain] = useState(false);

  // Active Hero playback, sliding docked preview & variant states
  const [selectedGroup, setSelectedGroup] = useState<LiveChannelGroup | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState<boolean>(false);
  const isPreviewOpenRef = useRef<boolean>(false);
  isPreviewOpenRef.current = isPreviewOpen;

  const [isHeroScrolledOutOfView, setIsHeroScrolledOutOfView] = useState<boolean>(false);
  const isHeroScrolledOutOfViewRef = useRef<boolean>(false);
  isHeroScrolledOutOfViewRef.current = isHeroScrolledOutOfView;

  const [heroSlotHeightPx, setHeroSlotHeightPx] = useState<number>(470);
  const heroSlotHeightRef = useRef<number>(470);
  const [dockTopPx, setDockTopPx] = useState<number>(112);

  const [activeVariantStream, setActiveVariantStream] = useState<any | null>(null);
  const [selectedResolutionMode, setSelectedResolutionMode] = useState<'auto' | string>('auto');
  const [attemptTrigger, setAttemptTrigger] = useState(0);
  const [fullscreenRequestTrigger, setFullscreenRequestTrigger] = useState(0);
  const [miniPlayerUrl, setMiniPlayerUrl] = useState<string>('');
  const [miniPlayerError, setMiniPlayerError] = useState<string | null>(null);
  const [miniPlayerLoading, setMiniPlayerLoading] = useState(false);

  // EPG state for active channel + passive session cache for wide channel cards + shared temporal clock
  const [epgData, setEpgData] = useState<any[]>([]);
  const [loadingEpg, setLoadingEpg] = useState(false);
  const [epgError, setEpgError] = useState<string | null>(null);
  const epgCacheRef = useRef<Map<string, any[]>>(getSharedSessionEpgCache());
  const [epgCacheVersion, setEpgCacheVersion] = useState(0);
  const [epgClockNowMs, setEpgClockNowMs] = useState<number>(() => getLiveEpgClockNowMs());

  // Playback attempt & fallback refs
  const isMountedRef = useRef<boolean>(true);
  const sessionSuccessfulVariantsRef = useRef<Map<string, string | number>>(new Map());
  const attemptedStreamIdsRef = useRef<Set<string | number>>(new Set());
  const attemptIdRef = useRef<number>(0);
  const fallbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeVariantStreamRef = useRef<any | null>(null);
  activeVariantStreamRef.current = activeVariantStream;
  const selectedGroupRef = useRef<LiveChannelGroup | null>(null);
  selectedGroupRef.current = selectedGroup;
  const heroWasExplicitlyActivatedRef = useRef<boolean>(false);
  const consumedIntentRequestIdRef = useRef<number | null>(null);
  const prevAccountPrefixRef = useRef<string | null>(null);
  const lastActivatedCardRef = useRef<HTMLButtonElement | null>(null);

  // Scroll & showcase vertical windowing refs (matching CatalogShowcaseView)
  const viewRootRef = useRef<HTMLDivElement>(null);
  const mainContainerRef = useRef<HTMLElement>(null);
  const heroSlotRef = useRef<HTMLDivElement>(null);
  const categoriesTriggerRef = useRef<HTMLButtonElement>(null);
  const categoriesMenuRef = useRef<HTMLDivElement>(null);
  const showcaseRowsContainerRef = useRef<HTMLDivElement | null>(null);
  const registeredShowcaseContainerRef = useRef<HTMLDivElement | null>(null);
  const rowWindowStartRef = useRef<number>(0);
  const [rowWindowStart, setRowWindowStart] = useState(0);
  rowWindowStartRef.current = rowWindowStart;
  const measuredRowHeightsRef = useRef<Map<number, number>>(new Map());
  const measuredRowsStartOffsetRef = useRef<number | null>(null);
  const isDpadShowcaseNavActiveRef = useRef<boolean>(false);
  const isProgrammaticRowShiftRef = useRef<boolean>(false);
  const lastManualScrollTopRef = useRef<number | null>(null);

  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : 1280
  );
  const liveViewportWidth =
    typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : viewportWidth;
  const lastMeasuredViewportWidthRef = useRef<number>(liveViewportWidth);
  if (lastMeasuredViewportWidthRef.current !== liveViewportWidth) {
    lastMeasuredViewportWidthRef.current = liveViewportWidth;
    measuredRowHeightsRef.current.clear();
    measuredRowsStartOffsetRef.current = null;
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => {
      const nextW = window.innerWidth > 0 ? window.innerWidth : 1280;
      setViewportWidth((prev) => (prev === nextW ? prev : nextW));
    };
    window.addEventListener('resize', handleResize, { passive: true });
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const accountPrefix = useMemo(() => {
    if (!credentials?.serverUrl && !credentials?.username) return '';
    return `${credentials?.serverUrl || ''}|${credentials?.username || ''}`;
  }, [credentials?.serverUrl, credentials?.username]);

  const liveIndex = useMemo(() => getOrCreateLiveIndex(allLiveStreams), [allLiveStreams]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const hasSearch = normalizedQuery.length > 0;
  const isGridMode = hasSearch || activeCategoryId !== null;

  // Cancel timers on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current);
        fallbackTimeoutRef.current = null;
      }
      attemptIdRef.current++;
      if (registeredShowcaseContainerRef.current) {
        unregisterShowcaseRowController(registeredShowcaseContainerRef.current);
        registeredShowcaseContainerRef.current = null;
      }
    };
  }, []);

  // Single shared EPG clock for LiveTvView (updates every 60s + on tab visibilitychange/focus)
  useEffect(() => {
    const syncClock = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      setEpgClockNowMs(getLiveEpgClockNowMs());
    };

    const intervalId = setInterval(syncClock, EPG_CLOCK_UPDATE_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        setEpgClockNowMs(getLiveEpgClockNowMs());
      }
    };

    const handleWindowFocus = () => {
      setEpgClockNowMs(getLiveEpgClockNowMs());
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleWindowFocus);
    }

    const unsubscribeTestClock = subscribeLiveEpgClockForTest((nowMs) => {
      try {
        flushSync(() => {
          setEpgClockNowMs(nowMs);
        });
      } catch {
        setEpgClockNowMs(nowMs);
      }
    });

    return () => {
      clearInterval(intervalId);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleWindowFocus);
      }
      unsubscribeTestClock();
    };
  }, []);

  // Reset playback state, cache, and active filters when credentials switch
  useEffect(() => {
    if (fallbackTimeoutRef.current) {
      clearTimeout(fallbackTimeoutRef.current);
      fallbackTimeoutRef.current = null;
    }
    attemptIdRef.current++;
    sessionSuccessfulVariantsRef.current.clear();
    attemptedStreamIdsRef.current.clear();
    if (prevAccountPrefixRef.current !== null && prevAccountPrefixRef.current !== accountPrefix) {
      clearSharedSessionEpgCache();
    }
    prevAccountPrefixRef.current = accountPrefix;
    setEpgCacheVersion((v) => v + 1);
    heroWasExplicitlyActivatedRef.current = false;
    consumedIntentRequestIdRef.current = null;
    lastActivatedCardRef.current = null;
    isPreviewOpenRef.current = false;
    setIsPreviewOpen(false);
    isHeroScrolledOutOfViewRef.current = false;
    setIsHeroScrolledOutOfView(false);
    setSelectedGroup(null);
    setActiveVariantStream(null);
    setSelectedResolutionMode('auto');
    setMiniPlayerUrl('');
    setMiniPlayerError(null);
    setMiniPlayerLoading(false);
    setEpgData([]);
    setEpgError(null);
    setLoadingEpg(false);
    setActiveCategoryId(null);
    setIsCategoriesMenuOpen(false);
    rowWindowStartRef.current = 0;
    setRowWindowStart(0);
    measuredRowHeightsRef.current.clear();
    measuredRowsStartOffsetRef.current = null;
  }, [credentials, accountPrefix]);

  useEffect(() => {
    if (favActionError) {
      const timer = setTimeout(() => {
        setFavActionError(null);
        clearFavoriteError();
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [favActionError, clearFavoriteError]);

  const isGroupFavorited = useCallback(
    (group: LiveChannelGroup | null): boolean => {
      if (!group) return false;
      return group.allStreams.some((s) => isFavorite(s.stream_id || s.id, 'live'));
    },
    [isFavorite]
  );

  const handleToggleHeroFavorite = useCallback(
    (group: LiveChannelGroup) => {
      if (!group) return;
      if (group.isGrouped) {
        const groupFavIds = group.allStreams
          .map((s) => String(s.stream_id || s.id))
          .filter((id) => isFavorite(id, 'live'));

        if (groupFavIds.length > 0) {
          const ok = toggleGroupFavorites(groupFavIds);
          if (!ok) {
            setFavActionError('Não foi possível salvar os favoritos neste dispositivo.');
          } else {
            setFavActionError(null);
          }
        } else {
          const repStream = group.primaryStream;
          const repId = repStream.stream_id || repStream.id;
          const ok = toggleGroupFavorites([], {
            id: repId,
            name: group.displayName,
            cover: group.stream_icon || '',
            type: 'live',
          });
          if (!ok) {
            setFavActionError('Não foi possível salvar os favoritos neste dispositivo.');
          } else {
            setFavActionError(null);
          }
        }
      } else {
        const primaryId = group.primaryStream?.stream_id || group.primaryStream?.id;
        const item: FavoriteItem = {
          id: primaryId,
          name: group.displayName,
          cover: group.stream_icon || '',
          type: 'live',
        };
        const ok = toggleFavorite(item);
        if (!ok) {
          setFavActionError('Não foi possível salvar os favoritos neste dispositivo.');
        } else {
          setFavActionError(null);
        }
      }
    },
    [isFavorite, toggleFavorite, toggleGroupFavorites]
  );

  // Favorite and recently watched Live groups
  const favoriteGroups = useMemo(() => {
    const matchedStreams = favorites
      .filter((f) => f.type === 'live')
      .map((f) => liveIndex.getById(f.id))
      .filter(Boolean);
    if (matchedStreams.length === 0) return [];
    return groupLiveStreams(matchedStreams);
  }, [favorites, liveIndex]);

  const recentGroups = useMemo(() => {
    if (!allLiveStreams || allLiveStreams.length === 0) return [];
    const liveRecords = historyRecords.filter((r) => r.type === 'live');
    const seenIds = new Set<string>();
    const streams: any[] = [];
    for (const rec of liveRecords) {
      const stream = liveIndex.getById(rec.id);
      if (stream) {
        const idStr = String(stream.stream_id ?? stream.id);
        if (!seenIds.has(idStr)) {
          seenIds.add(idStr);
          streams.push(stream);
        }
      }
    }
    return groupLiveStreams(streams);
  }, [historyRecords, allLiveStreams, liveIndex]);

  // All showcase category rows (Recentes -> Favoritos -> Real Live Categories)
  const showcaseRowDefinitions = useMemo<LiveRowEntry[]>(() => {
    const rows: LiveRowEntry[] = [];

    if (recentGroups.length > 0) {
      rows.push({
        key: 'nc_recent',
        title: 'Assistidos Recentemente',
        groups: recentGroups,
        virtualize: true,
      });
    }

    if (favoriteGroups.length > 0) {
      rows.push({
        key: 'nc_fav',
        title: 'Canais Favoritos',
        groups: favoriteGroups,
        virtualize: true,
      });
    }

    const useAllIndex = allLiveStreams.length > 0;
    const fallbackGroupsByCat = new Map<string, LiveChannelGroup[]>();
    if (!useAllIndex && liveStreams.length > 0) {
      for (const grp of groupLiveStreams(liveStreams)) {
        const cid = String(grp.category_id ?? '');
        const existing = fallbackGroupsByCat.get(cid);
        if (existing) existing.push(grp);
        else fallbackGroupsByCat.set(cid, [grp]);
      }
    }

    for (const cat of liveCategories) {
      const catId = String(cat.category_id);
      const groups = useAllIndex
        ? liveIndex.getGroupsByCategory(catId)
        : fallbackGroupsByCat.get(catId) || [];
      if (groups.length === 0) continue;
      rows.push({
        key: `cat_${catId}`,
        title: formatCategoryLabel(cat.category_name, 'live'),
        groups,
        virtualize: true,
      });
    }

    // If categories list was empty/omitted but streams exist directly, expose a fallback "Canais Ao Vivo" row
    if (rows.length === 0) {
      const sourcePool = allLiveStreams.length > 0 ? allLiveStreams : liveStreams;
      if (sourcePool.length > 0) {
        const allGrps =
          allLiveStreams.length > 0 ? liveIndex.getAllGroups() : groupLiveStreams(sourcePool);
        if (allGrps.length > 0) {
          rows.push({
            key: 'all_channels',
            title: 'Canais Ao Vivo',
            groups: allGrps,
            virtualize: true,
          });
        }
      }
    }

    return rows;
  }, [recentGroups, favoriteGroups, liveCategories, allLiveStreams, liveStreams, liveIndex]);

  const totalShowcaseRows = showcaseRowDefinitions.length;
  const shouldVirtualizeShowcaseRows =
    !isGridMode && totalShowcaseRows > LIVE_SHOWCASE_ROW_WINDOW_SIZE;
  const maxRowWindowStart = shouldVirtualizeShowcaseRows
    ? Math.max(0, totalShowcaseRows - LIVE_SHOWCASE_ROW_WINDOW_SIZE)
    : 0;
  const effectiveRowWindowStart = shouldVirtualizeShowcaseRows
    ? Math.max(0, Math.min(rowWindowStart, maxRowWindowStart))
    : 0;
  const effectiveRowWindowEnd = shouldVirtualizeShowcaseRows
    ? Math.min(totalShowcaseRows, effectiveRowWindowStart + LIVE_SHOWCASE_ROW_WINDOW_SIZE)
    : totalShowcaseRows;

  // Grid groups for search OR explicit category filter from "Categorias" dropdown
  const displayedGridGroups = useMemo<LiveChannelGroup[]>(() => {
    if (hasSearch) {
      const poolGroups =
        allLiveStreams.length > 0 ? liveIndex.getAllGroups() : groupLiveStreams(liveStreams);
      return filterLiveChannelGroups(poolGroups, searchQuery);
    }

    if (activeCategoryId === 'nc_recent') {
      return recentGroups;
    }
    if (activeCategoryId === 'nc_fav') {
      return favoriteGroups;
    }
    if (activeCategoryId !== null) {
      const catIdStr = String(activeCategoryId);
      if (allLiveStreams.length > 0) {
        const indexedGroups = liveIndex.getGroupsByCategory(catIdStr);
        if (indexedGroups.length > 0) return indexedGroups;
      }
      return groupLiveStreams(
        liveStreams.filter((s) => s && String(s.category_id) === catIdStr)
      );
    }
    return [];
  }, [
    hasSearch,
    searchQuery,
    activeCategoryId,
    allLiveStreams.length,
    liveStreams,
    liveIndex,
    recentGroups,
    favoriteGroups,
  ]);

  // Helper to pick next variant in group (SD -> HD -> FHD -> 4K automatic priority)
  const pickVariantForGroup = useCallback(
    (
      group: LiveChannelGroup,
      targetMode: string,
      attemptedSet: Set<string | number>
    ): any | null => {
      const successfulId = group
        ? sessionSuccessfulVariantsRef.current.get(group.groupId)
        : undefined;
      return selectChannelVariantForAttempt(group, targetMode, attemptedSet, successfulId);
    },
    []
  );

  // Execute a playback attempt for a channel variant
  const startVariantAttempt = useCallback(
    (group: LiveChannelGroup, targetMode: string, forcedStream?: any) => {
      if (!isMountedRef.current) return;

      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current);
        fallbackTimeoutRef.current = null;
      }

      const currentAttemptId = ++attemptIdRef.current;
      const targetStream =
        forcedStream || pickVariantForGroup(group, targetMode, attemptedStreamIdsRef.current);

      if (!targetStream) {
        setMiniPlayerError(
          'Não foi possível carregar nenhuma versão do canal. Verifique a conexão com o servidor.'
        );
        setMiniPlayerLoading(false);
        return;
      }

      setActiveVariantStream(targetStream);
      setMiniPlayerLoading(true);
      setMiniPlayerError(null);
      setAttemptTrigger(currentAttemptId);

      const streamId = targetStream.stream_id || targetStream.id;

      try {
        const url = buildDirectMediaUrl(credentials, {
          type: 'live',
          streamId,
          allowedOutputFormats: credentials?.allowed_output_formats,
        });

        if (isMountedRef.current && attemptIdRef.current === currentAttemptId) {
          setMiniPlayerUrl(url);

          const timeoutMs = getLiveFallbackTimeoutMs();
          fallbackTimeoutRef.current = setTimeout(() => {
            fallbackTimeoutRef.current = null;
            if (!isMountedRef.current || attemptIdRef.current !== currentAttemptId) return;
            attemptedStreamIdsRef.current.add(streamId);
            const nextStream = pickVariantForGroup(
              group,
              targetMode,
              attemptedStreamIdsRef.current
            );
            if (nextStream) {
              startVariantAttempt(group, targetMode, nextStream);
            } else {
              setMiniPlayerError(
                'Não foi possível carregar nenhuma versão do canal (Tempo limite esgotado).'
              );
              setMiniPlayerLoading(false);
            }
          }, timeoutMs);
        }
      } catch (err: any) {
        if (isMountedRef.current && attemptIdRef.current === currentAttemptId) {
          attemptedStreamIdsRef.current.add(streamId);
          setMiniPlayerUrl('');
          setMiniPlayerError(err?.message || 'Falha ao conectar à transmissão do canal.');
          setMiniPlayerLoading(false);
        }
      }
    },
    [credentials, pickVariantForGroup]
  );

  // Explicit activation of a channel card (mouse click, touch tap, Enter/Space):
  // - NEVER scrolls the page back to the top or shifts category scrollTop / row scrollLeft.
  // - 1st activation: selects channel and opens preview (in top Hero or sliding dock if scrolled down).
  // - 2nd consecutive activation on same channel while preview is open: expands to fullscreen.
  // - Activation on same channel after sliding preview was collapsed: reopens preview first.
  const handleActivateGroup = useCallback(
    (group: LiveChannelGroup, cardEl?: HTMLButtonElement | null) => {
      if (!group) return;
      heroWasExplicitlyActivatedRef.current = true;

      if (cardEl) {
        lastActivatedCardRef.current = cardEl;
        if (typeof document !== 'undefined' && document.activeElement !== cardEl) {
          try {
            cardEl.focus({ preventScroll: true });
          } catch {}
        }
      }

      const mainEl = mainContainerRef.current;
      const currentScrollTop = mainEl ? mainEl.scrollTop || 0 : 0;
      const threshold = Math.max(180, Math.round(heroSlotHeightRef.current * 0.55));
      const isScrolledOut = currentScrollTop > threshold;
      if (isHeroScrolledOutOfViewRef.current !== isScrolledOut) {
        isHeroScrolledOutOfViewRef.current = isScrolledOut;
        setIsHeroScrolledOutOfView(isScrolledOut);
      }
      if (mainEl) {
        const mRect = mainEl.getBoundingClientRect();
        if (mRect.top > 0) {
          setDockTopPx(Math.round(mRect.top));
        }
      }

      // Estado 3: 2nd consecutive activation on the SAME channel while preview is open -> expand fullscreen immediately
      if (
        selectedGroup &&
        selectedGroup.groupId === group.groupId &&
        isPreviewOpenRef.current &&
        !miniPlayerError &&
        miniPlayerUrl
      ) {
        setFullscreenRequestTrigger((prev) => prev + 1);
        return;
      }

      // Estado 5 -> Estado 2: Re-activating the SAME channel after its preview was collapsed -> reopen preview & resume playback
      if (selectedGroup && selectedGroup.groupId === group.groupId && !isPreviewOpenRef.current) {
        isPreviewOpenRef.current = true;
        setIsPreviewOpen(true);
        startVariantAttempt(
          group,
          selectedResolutionMode,
          activeVariantStreamRef.current || undefined
        );
        return;
      }

      // Estado 2: 1st activation of a channel -> select channel, open preview, preserve scrollTop/scrollLeft & card focus
      isPreviewOpenRef.current = true;
      setIsPreviewOpen(true);
      setSelectedGroup(group);
      setSelectedResolutionMode('auto');
      attemptedStreamIdsRef.current.clear();
      startVariantAttempt(group, 'auto');
    },
    [
      selectedGroup,
      miniPlayerError,
      miniPlayerUrl,
      selectedResolutionMode,
      startVariantAttempt,
    ]
  );

  // Close sliding dock explicitly (e.g., close button or arrow navigation while docked)
  const handleCloseDock = useCallback(() => {
    if (!isPreviewOpenRef.current) return;
    isPreviewOpenRef.current = false;
    setIsPreviewOpen(false);
    if (fallbackTimeoutRef.current) {
      clearTimeout(fallbackTimeoutRef.current);
      fallbackTimeoutRef.current = null;
    }
  }, []);

  // Estado 4: Pressing any directional arrow key while the sliding docked preview is open
  // collapses the sliding preview AND lets the same arrow key move focus to the neighboring card/category.
  useEffect(() => {
    const onKeyDownCapture = (e: KeyboardEvent) => {
      if (
        e.key !== 'ArrowLeft' &&
        e.key !== 'ArrowRight' &&
        e.key !== 'ArrowUp' &&
        e.key !== 'ArrowDown'
      ) {
        return;
      }
      if (!isHeroScrolledOutOfViewRef.current || !isPreviewOpenRef.current) {
        return;
      }
      if (
        typeof document !== 'undefined' &&
        document.querySelector('[data-focus-scope="modal"]') !== null
      ) {
        return;
      }
      // Collapse sliding preview without consuming the arrow key so spatialNav advances focus in the same keystroke
      isPreviewOpenRef.current = false;
      try {
        flushSync(() => {
          setIsPreviewOpen(false);
        });
      } catch {
        setIsPreviewOpen(false);
      }
      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current);
        fallbackTimeoutRef.current = null;
      }
    };

    window.addEventListener('keydown', onKeyDownCapture, true);
    return () => {
      window.removeEventListener('keydown', onKeyDownCapture, true);
    };
  }, []);

  // Consume launch intent from Home ("Canais Ao Vivo")
  useEffect(() => {
    if (!initialChannelIntent) return;
    if (consumedIntentRequestIdRef.current === initialChannelIntent.requestId) return;

    const catalogEmpty = allLiveStreams.length === 0 && liveStreams.length === 0;
    if (
      catalogEmpty &&
      (liveCatalogStatus === 'loading' || liveCatalogStatus === 'idle' || loadingLive)
    ) {
      return;
    }

    consumedIntentRequestIdRef.current = initialChannelIntent.requestId;
    onConsumeChannelIntent?.(initialChannelIntent.requestId);
    heroWasExplicitlyActivatedRef.current = true;
    isPreviewOpenRef.current = true;
    setIsPreviewOpen(true);

    const rawStreamId = initialChannelIntent.streamId;
    const targetIdStr =
      rawStreamId !== undefined && rawStreamId !== null ? String(rawStreamId).trim() : '';

    const sourcePool = allLiveStreams.length > 0 ? allLiveStreams : liveStreams;
    const matchedStream = targetIdStr
      ? allLiveStreams.length > 0
        ? liveIndex.getById(targetIdStr) || null
        : sourcePool.find((s: any) => s && String(s.stream_id ?? s.id) === targetIdStr)
      : null;

    if (matchedStream) {
      const catId = matchedStream.category_id ? String(matchedStream.category_id) : '';
      const groupsInCat =
        catId && allLiveStreams.length > 0
          ? liveIndex.getGroupsByCategory(catId)
          : groupLiveStreams(
              catId
                ? sourcePool.filter((s) => s && String(s.category_id) === catId)
                : [matchedStream]
            );
      const targetGroup =
        groupsInCat.find((g) =>
          g.allStreams.some((s) => String(s.stream_id ?? s.id) === targetIdStr)
        ) ||
        ({
          groupId: `single_direct_${targetIdStr}`,
          displayName: matchedStream.name || 'Canal ao Vivo',
          category_id: matchedStream.category_id,
          epg_channel_id: matchedStream.epg_channel_id,
          stream_icon: matchedStream.stream_icon,
          isGrouped: false,
          variants: [],
          primaryStream: matchedStream,
          allStreams: [matchedStream],
        } as LiveChannelGroup);

      setSelectedGroup(targetGroup);
      setSelectedResolutionMode('auto');
      attemptedStreamIdsRef.current.clear();
      startVariantAttempt(targetGroup, 'auto');
      if (mainContainerRef.current) {
        mainContainerRef.current.scrollTop = 0;
      }
      isHeroScrolledOutOfViewRef.current = false;
      setIsHeroScrolledOutOfView(false);
      return;
    }

    // Stream ID invalid / absent -> show clean recoverable error in Hero
    const snap = initialChannelIntent.streamSnapshot || {};
    const fallbackGroup: LiveChannelGroup = {
      groupId: `invalid_intent_${initialChannelIntent.requestId}`,
      displayName: snap.name || 'Canal Indisponível',
      category_id: snap.category_id || '',
      epg_channel_id: snap.epg_channel_id,
      stream_icon: snap.stream_icon || '',
      isGrouped: false,
      variants: [],
      primaryStream: {
        ...snap,
        stream_id: targetIdStr || '',
        name: snap.name || 'Canal Indisponível',
      },
      allStreams: [],
    };

    if (fallbackTimeoutRef.current) {
      clearTimeout(fallbackTimeoutRef.current);
      fallbackTimeoutRef.current = null;
    }
    attemptIdRef.current++;
    setSelectedGroup(fallbackGroup);
    setActiveVariantStream(fallbackGroup.primaryStream);
    setSelectedResolutionMode('auto');
    attemptedStreamIdsRef.current.clear();
    setMiniPlayerUrl('');
    setMiniPlayerLoading(false);
    setMiniPlayerError(
      !targetIdStr
        ? 'Identificador do canal inválido para reprodução.'
        : 'Canal não encontrado no catálogo atual da conta.'
    );
  }, [
    initialChannelIntent,
    allLiveStreams,
    liveStreams,
    liveIndex,
    liveCatalogStatus,
    loadingLive,
    onConsumeChannelIntent,
    startVariantAttempt,
  ]);

  // Manual resolution switch
  const handleSelectResolutionMode = useCallback(
    (variant: any | 'auto') => {
      if (!selectedGroup) return;
      heroWasExplicitlyActivatedRef.current = true;
      isPreviewOpenRef.current = true;
      setIsPreviewOpen(true);
      attemptedStreamIdsRef.current.clear();

      if (variant === 'auto') {
        setSelectedResolutionMode('auto');
        startVariantAttempt(selectedGroup, 'auto');
      } else {
        const vId = String(variant.stream_id || variant.id || variant.streamId);
        setSelectedResolutionMode(vId);
        startVariantAttempt(selectedGroup, vId, variant);
      }
    },
    [selectedGroup, startVariantAttempt]
  );

  const handleExpandFullscreen = useCallback(() => {
    if (!selectedGroup) return;
    heroWasExplicitlyActivatedRef.current = true;
    isPreviewOpenRef.current = true;
    setIsPreviewOpen(true);
    setFullscreenRequestTrigger((prev) => prev + 1);
  }, [selectedGroup]);

  const handlePlaybackSuccess = useCallback(
    (attemptId?: number) => {
      if (!isMountedRef.current || attemptId === undefined || attemptId !== attemptIdRef.current) {
        return;
      }

      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current);
        fallbackTimeoutRef.current = null;
      }
      setMiniPlayerLoading(false);
      setMiniPlayerError(null);

      if (selectedGroup && activeVariantStream) {
        const streamId = activeVariantStream.stream_id || activeVariantStream.id;
        sessionSuccessfulVariantsRef.current.set(selectedGroup.groupId, streamId);
        if (heroWasExplicitlyActivatedRef.current) {
          recordPlaybackPosition(credentials, { id: streamId, type: 'live' });
        }
      }
    },
    [selectedGroup, activeVariantStream, credentials]
  );

  const handlePlaybackFinalError = useCallback(
    (errorMsg: string, attemptId?: number) => {
      if (!isMountedRef.current || attemptId === undefined || attemptId !== attemptIdRef.current) {
        return;
      }

      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current);
        fallbackTimeoutRef.current = null;
      }

      if (activeVariantStream) {
        const streamId = activeVariantStream.stream_id || activeVariantStream.id;
        attemptedStreamIdsRef.current.add(streamId);
      }

      if (selectedGroup) {
        const nextStream = pickVariantForGroup(
          selectedGroup,
          selectedResolutionMode,
          attemptedStreamIdsRef.current
        );
        if (nextStream) {
          startVariantAttempt(selectedGroup, selectedResolutionMode, nextStream);
          return;
        }
      }

      setMiniPlayerError('Não foi possível carregar nenhuma versão do canal. ' + (errorMsg || ''));
      setMiniPlayerLoading(false);
    },
    [
      activeVariantStream,
      selectedGroup,
      selectedResolutionMode,
      pickVariantForGroup,
      startVariantAttempt,
    ]
  );

  const handleRetryPlayback = useCallback(() => {
    if (!selectedGroup) return;
    heroWasExplicitlyActivatedRef.current = true;
    isPreviewOpenRef.current = true;
    setIsPreviewOpen(true);
    attemptedStreamIdsRef.current.clear();
    startVariantAttempt(selectedGroup, selectedResolutionMode);
  }, [selectedGroup, selectedResolutionMode, startVariantAttempt]);

  const handleBackFromHeroPlayer = useCallback(() => {
    // Restore focus to the active channel card first (preserving the user's position in the grid),
    // falling back to the Hero play button only if no channel card is connected.
    const selectedCard =
      (lastActivatedCardRef.current && lastActivatedCardRef.current.isConnected
        ? lastActivatedCardRef.current
        : null) ||
      viewRootRef.current?.querySelector<HTMLButtonElement>(
        'button[data-live-channel-selected="true"]'
      );
    if (selectedCard && selectedCard.isConnected) {
      try {
        selectedCard.focus({ preventScroll: true });
        return;
      } catch {}
    }
    if (getNavMode() === 'remote') {
      const heroPlayBtn = viewRootRef.current?.querySelector<HTMLButtonElement>(
        'button[data-live-hero-play="true"]'
      );
      if (heroPlayBtn && isElementFocusable(heroPlayBtn)) {
        focusElementSafely(heroPlayBtn);
      }
    }
  }, []);

  const activeStreamId = useMemo(() => {
    if (!activeVariantStream) return '';
    const rawId = activeVariantStream.stream_id ?? activeVariantStream.id;
    return rawId !== undefined && rawId !== null ? String(rawId) : '';
  }, [activeVariantStream]);

  // Fetch EPG ONLY when active stream changes (never on card focus/hover)
  useEffect(() => {
    let isCurrent = true;
    if (!activeStreamId || !credentials) {
      setEpgData([]);
      setLoadingEpg(false);
      setEpgError(null);
      return () => {
        isCurrent = false;
      };
    }

    setLoadingEpg(true);
    setEpgError(null);
    setEpgData([]);

    const currentStream = activeVariantStreamRef.current;
    const sId = currentStream?.stream_id ?? currentStream?.id ?? activeStreamId;

    XtreamService.getShortEpg(credentials, sId, 10)
      .then((data) => {
        if (!isCurrent) return;
        const rawListings = Array.isArray(data?.epg_listings) ? data.epg_listings : [];
        const validListings = rawListings.filter(
          (item: any) => item !== null && typeof item === 'object' && !Array.isArray(item)
        );
        setEpgData(validListings);
        setEpgError(null);
        setLoadingEpg(false);

        const groupSnapshot = selectedGroupRef.current;
        if (groupSnapshot && validListings.length > 0) {
          const cacheKeys = buildEpgCacheKeys(groupSnapshot, accountPrefix);
          for (const k of cacheKeys) {
            epgCacheRef.current.set(k, validListings);
          }
          setEpgCacheVersion((v) => v + 1);
        }
      })
      .catch((err) => {
        if (!isCurrent) return;
        console.error('EPG fetch error:', err);
        setEpgData([]);
        setEpgError('Programação indisponível');
        setLoadingEpg(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [activeStreamId, credentials, accountPrefix]);

  const heroNowPlaying = useMemo(
    () => resolveNowPlayingProgram(epgData, epgClockNowMs),
    [epgData, epgClockNowMs]
  );

  // Showcase vertical row measurement & synchronization (identical architecture to CatalogShowcaseView)
  const getRowSlotHeight = useCallback(
    (rowIndex: number): number => {
      const measured = measuredRowHeightsRef.current.get(rowIndex);
      if (typeof measured === 'number' && measured > 0) {
        return measured;
      }
      const rowDef = showcaseRowDefinitions[rowIndex];
      return estimateLiveShowcaseRowSlotHeight(rowDef?.title || '', liveViewportWidth);
    },
    [showcaseRowDefinitions, liveViewportWidth]
  );

  const measureMountedShowcaseGeometry = useCallback((): void => {
    const mainEl = mainContainerRef.current;
    const rowsContainerEl = showcaseRowsContainerRef.current;
    if (!mainEl) return;

    const mainRect = mainEl.getBoundingClientRect();
    if (mainRect.top > 0) {
      setDockTopPx(Math.round(mainRect.top));
    }

    if (heroSlotRef.current && !isHeroScrolledOutOfViewRef.current) {
      const hRect = heroSlotRef.current.getBoundingClientRect();
      const rawHeroH = hRect.height || heroSlotRef.current.offsetHeight;
      if (rawHeroH > 120) {
        const roundedH = Math.round(rawHeroH);
        heroSlotHeightRef.current = roundedH;
        setHeroSlotHeightPx((prev) => (Math.abs(prev - roundedH) > 1 ? roundedH : prev));
      }
    }

    if (!rowsContainerEl) return;

    const scrollTop = mainEl.scrollTop || 0;
    const topSpacerEl = rowsContainerEl.querySelector<HTMLElement>(
      '[data-showcase-row-spacer="top"]'
    );
    const currentTopSpacerPx = topSpacerEl
      ? parseFloat(topSpacerEl.style.height || '0') || 0
      : 0;

    const allBlocks = rowsContainerEl.querySelectorAll<HTMLElement>('[data-scroll-block="true"]');

    if (allBlocks.length > 0) {
      const firstBlock = allBlocks[0];
      const firstRect = firstBlock.getBoundingClientRect();
      if (firstRect.height > 0 && typeof firstRect.top === 'number') {
        const inferredStart = Math.round(
          firstRect.top - mainRect.top + scrollTop - currentTopSpacerPx
        );
        if (inferredStart >= 0) {
          measuredRowsStartOffsetRef.current = inferredStart;
        }
      }
    }

    if (measuredRowsStartOffsetRef.current === null) {
      const containerRect = rowsContainerEl.getBoundingClientRect();
      if (containerRect.height > 0 && typeof containerRect.top === 'number') {
        const offsetFromContainer = Math.round(containerRect.top - mainRect.top + scrollTop);
        if (offsetFromContainer >= 0) {
          measuredRowsStartOffsetRef.current = offsetFromContainer;
        }
      }
    }

    for (let i = 0; i < allBlocks.length; i++) {
      const scrollBlock = allBlocks[i];
      const rIdx = parseInt(
        scrollBlock.getAttribute('data-showcase-row-index') ||
          scrollBlock.querySelector('[data-home-row-index]')?.getAttribute('data-home-row-index') ||
          String(i),
        10
      );
      if (isNaN(rIdx) || rIdx < 0) continue;
      const rect = scrollBlock.getBoundingClientRect();
      const rawHeight = rect.height > 0 ? rect.height : scrollBlock.offsetHeight;
      if (typeof rawHeight === 'number' && rawHeight > 0) {
        measuredRowHeightsRef.current.set(rIdx, Math.round(rawHeight));
      }
    }
  }, []);

  useLayoutEffect(() => {
    if (isGridMode || totalShowcaseRows === 0) return;
    measureMountedShowcaseGeometry();
  }, [
    isGridMode,
    totalShowcaseRows,
    effectiveRowWindowStart,
    effectiveRowWindowEnd,
    liveViewportWidth,
    measureMountedShowcaseGeometry,
  ]);

  const computeShowcaseRowStartFromScroll = useCallback(
    (scrollTop: number, currentWindowStart?: number): number => {
      if (!shouldVirtualizeShowcaseRows || totalShowcaseRows <= LIVE_SHOWCASE_ROW_WINDOW_SIZE) {
        return 0;
      }
      const rowsStartOffsetPx =
        measuredRowsStartOffsetRef.current ?? Math.max(320, heroSlotHeightRef.current + 16);
      const relativeTop = Math.max(0, scrollTop - rowsStartOffsetPx);

      const offsets = new Array<number>(totalShowcaseRows + 1);
      offsets[0] = 0;
      for (let i = 0; i < totalShowcaseRows; i++) {
        offsets[i + 1] = offsets[i] + getRowSlotHeight(i);
      }

      const findRowAtOffset = (targetOffset: number): number => {
        if (targetOffset <= 0) return 0;
        let low = 0;
        let high = totalShowcaseRows - 1;
        while (low <= high) {
          const mid = (low + high) >> 1;
          if (offsets[mid + 1] <= targetOffset) {
            low = mid + 1;
          } else if (offsets[mid] > targetOffset) {
            high = mid - 1;
          } else {
            return mid;
          }
        }
        return Math.max(0, Math.min(totalShowcaseRows - 1, low));
      };

      const firstVisibleRow = findRowAtOffset(relativeTop);
      const rawDesired = Math.max(0, Math.min(maxRowWindowStart, firstVisibleRow - 1));

      if (typeof currentWindowStart !== 'number') {
        return rawDesired;
      }

      const clampedCurrent = Math.max(0, Math.min(maxRowWindowStart, currentWindowStart));
      if (rawDesired === clampedCurrent) {
        return clampedCurrent;
      }

      if (rawDesired > clampedCurrent) {
        const downRow = findRowAtOffset(
          Math.max(0, relativeTop - SHOWCASE_SCROLL_HYSTERESIS_PX)
        );
        const downDesired = Math.max(0, Math.min(maxRowWindowStart, downRow - 1));
        return Math.max(clampedCurrent, downDesired);
      }

      if (scrollTop <= 0) {
        return 0;
      }
      const upRow = findRowAtOffset(relativeTop + SHOWCASE_SCROLL_HYSTERESIS_PX);
      const upDesired = Math.max(0, Math.min(maxRowWindowStart, upRow - 1));
      return Math.min(clampedCurrent, upDesired);
    },
    [shouldVirtualizeShowcaseRows, totalShowcaseRows, getRowSlotHeight, maxRowWindowStart]
  );

  // Shift showcase row window for D-Pad / programmatic restore while preserving the anchor row's
  // visual position in the viewport via a single measured delta compensation pass.
  const shiftShowcaseWindowWithAnchor = useCallback(
    (desiredStart: number, preferredAnchorRowIndex?: number): boolean => {
      const clampedDesired = Math.max(0, Math.min(maxRowWindowStart, desiredStart));
      const curStart = Math.max(0, Math.min(rowWindowStartRef.current, maxRowWindowStart));
      if (clampedDesired === curStart) {
        return false;
      }
      measureMountedShowcaseGeometry();

      const curEnd = Math.min(totalShowcaseRows, curStart + LIVE_SHOWCASE_ROW_WINDOW_SIZE);
      const nextEnd = Math.min(
        totalShowcaseRows,
        clampedDesired + LIVE_SHOWCASE_ROW_WINDOW_SIZE
      );
      const overlapStart = Math.max(curStart, clampedDesired);
      const overlapEnd = Math.min(curEnd, nextEnd);

      let anchorRowIdx = -1;
      if (overlapStart < overlapEnd) {
        if (
          typeof preferredAnchorRowIndex === 'number' &&
          preferredAnchorRowIndex >= overlapStart &&
          preferredAnchorRowIndex < overlapEnd
        ) {
          anchorRowIdx = preferredAnchorRowIndex;
        } else {
          const activeEl =
            typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
          const focusedRowWrapper = activeEl?.closest<HTMLElement>('[data-home-row-index]');
          const parsedFocusedRow = focusedRowWrapper?.hasAttribute('data-home-row-index')
            ? parseInt(focusedRowWrapper.getAttribute('data-home-row-index') || '-1', 10)
            : -1;
          if (
            !isNaN(parsedFocusedRow) &&
            parsedFocusedRow >= overlapStart &&
            parsedFocusedRow < overlapEnd
          ) {
            anchorRowIdx = parsedFocusedRow;
          } else {
            anchorRowIdx = overlapStart;
          }
        }
      }

      const mainEl = mainContainerRef.current;
      const rowsContainerEl = showcaseRowsContainerRef.current;
      const visualTopBefore =
        anchorRowIdx >= 0
          ? measureShowcaseRowVisualTop(rowsContainerEl, mainEl, anchorRowIdx)
          : null;

      isProgrammaticRowShiftRef.current = true;
      rowWindowStartRef.current = clampedDesired;
      try {
        try {
          flushSync(() => {
            setRowWindowStart(clampedDesired);
          });
        } catch {
          setRowWindowStart(clampedDesired);
        }

        measureMountedShowcaseGeometry();

        if (anchorRowIdx >= 0 && visualTopBefore !== null && mainContainerRef.current) {
          const visualTopAfter = measureShowcaseRowVisualTop(
            showcaseRowsContainerRef.current,
            mainContainerRef.current,
            anchorRowIdx
          );
          if (visualTopAfter !== null) {
            const delta = visualTopAfter - visualTopBefore;
            if (Math.abs(delta) > 0.5) {
              setElementScrollTopImmediate(
                mainContainerRef.current,
                Math.max(0, (mainContainerRef.current.scrollTop || 0) + delta)
              );
            }
          }
        }
      } finally {
        isProgrammaticRowShiftRef.current = false;
      }
      return true;
    },
    [maxRowWindowStart, totalShowcaseRows, measureMountedShowcaseGeometry]
  );

  const ensureShowcaseRowMounted = useCallback(
    (targetRowIndex: number, preserveRowIndex?: number): boolean => {
      isDpadShowcaseNavActiveRef.current = true;
      if (!shouldVirtualizeShowcaseRows || totalShowcaseRows <= LIVE_SHOWCASE_ROW_WINDOW_SIZE) {
        return false;
      }
      const clampedTarget = Math.max(
        0,
        Math.min(totalShowcaseRows - 1, Math.floor(targetRowIndex))
      );
      const curStart = Math.max(0, Math.min(rowWindowStartRef.current, maxRowWindowStart));
      const curEnd = Math.min(totalShowcaseRows, curStart + LIVE_SHOWCASE_ROW_WINDOW_SIZE);

      const hasTopMargin = curStart === 0 || clampedTarget >= curStart + 1;
      const hasBottomMargin = curEnd >= totalShowcaseRows || clampedTarget < curEnd - 1;
      if (
        clampedTarget >= curStart &&
        clampedTarget < curEnd &&
        hasTopMargin &&
        hasBottomMargin
      ) {
        return false;
      }

      let desiredStart: number;
      if (
        typeof preserveRowIndex === 'number' &&
        preserveRowIndex >= 0 &&
        preserveRowIndex < totalShowcaseRows
      ) {
        if (clampedTarget < preserveRowIndex) {
          desiredStart = clampedTarget <= 3 ? 0 : clampedTarget - 1;
        } else {
          desiredStart = clampedTarget - LIVE_SHOWCASE_ROW_WINDOW_SIZE + 2;
        }
      } else {
        desiredStart = clampedTarget - Math.floor(LIVE_SHOWCASE_ROW_WINDOW_SIZE / 2);
      }

      desiredStart = Math.max(0, Math.min(maxRowWindowStart, desiredStart));

      const preferredAnchor =
        typeof preserveRowIndex === 'number' &&
        preserveRowIndex >= 0 &&
        preserveRowIndex < totalShowcaseRows
          ? preserveRowIndex
          : clampedTarget;

      return shiftShowcaseWindowWithAnchor(desiredStart, preferredAnchor);
    },
    [
      shouldVirtualizeShowcaseRows,
      totalShowcaseRows,
      maxRowWindowStart,
      shiftShowcaseWindowWithAnchor,
    ]
  );

  const latestControllerRef = useRef({
    totalRows: totalShowcaseRows,
    ensureRowMounted: ensureShowcaseRowMounted,
  });
  latestControllerRef.current = {
    totalRows: totalShowcaseRows,
    ensureRowMounted: ensureShowcaseRowMounted,
  };

  const showcaseRowsContainerCallbackRef = useCallback((node: HTMLDivElement | null) => {
    const prevNode = registeredShowcaseContainerRef.current;
    if (prevNode && prevNode !== node) {
      unregisterShowcaseRowController(prevNode);
      registeredShowcaseContainerRef.current = null;
    }
    showcaseRowsContainerRef.current = node;
    if (node && latestControllerRef.current.totalRows > 0) {
      registerShowcaseRowController(node, {
        totalRows: latestControllerRef.current.totalRows,
        ensureRowMounted: (targetRowIndex, preserveRowIndex) =>
          latestControllerRef.current.ensureRowMounted(targetRowIndex, preserveRowIndex),
      });
      registeredShowcaseContainerRef.current = node;
    }
  }, []);

  useLayoutEffect(() => {
    const containerEl = showcaseRowsContainerRef.current;
    if (!containerEl || totalShowcaseRows === 0) {
      if (registeredShowcaseContainerRef.current) {
        unregisterShowcaseRowController(registeredShowcaseContainerRef.current);
        registeredShowcaseContainerRef.current = null;
      }
      return;
    }
    if (
      registeredShowcaseContainerRef.current &&
      registeredShowcaseContainerRef.current !== containerEl
    ) {
      unregisterShowcaseRowController(registeredShowcaseContainerRef.current);
    }
    registerShowcaseRowController(containerEl, {
      totalRows: totalShowcaseRows,
      ensureRowMounted: ensureShowcaseRowMounted,
    });
    registeredShowcaseContainerRef.current = containerEl;
  }, [totalShowcaseRows, ensureShowcaseRowMounted]);

  // Track whether the natural top Hero slot is scrolled out of view & sync showcase row window on manual scroll
  useEffect(() => {
    const mainEl = mainContainerRef.current;
    if (!mainEl) return;

    const releaseDpadScrollControl = () => {
      isDpadShowcaseNavActiveRef.current = false;
    };

    const onShowcaseKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const activeEl =
          typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        if (activeEl && mainEl.contains(activeEl)) {
          isDpadShowcaseNavActiveRef.current = true;
        }
      }
    };

    const handleScroll = () => {
      const currentScrollTop = Math.max(0, mainEl.scrollTop || 0);
      const threshold = Math.max(180, Math.round(heroSlotHeightRef.current * 0.55));
      const nextScrolledOut = currentScrollTop > threshold;

      if (nextScrolledOut !== isHeroScrolledOutOfViewRef.current) {
        isHeroScrolledOutOfViewRef.current = nextScrolledOut;
        setIsHeroScrolledOutOfView(nextScrolledOut);
        if (nextScrolledOut) {
          // Estado 1: Scrolling down past the Hero naturally leaves the Hero out of view
          // until the user explicitly activates a channel while scrolled down.
          isPreviewOpenRef.current = false;
          setIsPreviewOpen(false);
          if (fallbackTimeoutRef.current) {
            clearTimeout(fallbackTimeoutRef.current);
            fallbackTimeoutRef.current = null;
          }
        } else if (selectedGroupRef.current) {
          // Returning to the top of the page restores the top Hero preview
          isPreviewOpenRef.current = true;
          setIsPreviewOpen(true);
        }
      }

      if (isGridMode || !shouldVirtualizeShowcaseRows) return;
      if (isProgrammaticRowShiftRef.current || isDpadShowcaseNavActiveRef.current) return;

      measureMountedShowcaseGeometry();

      const prevScrollTop = lastManualScrollTopRef.current;
      if (prevScrollTop !== null && Math.abs(currentScrollTop - prevScrollTop) < 0.5) {
        return;
      }
      lastManualScrollTopRef.current = currentScrollTop;

      const curStart = Math.max(0, Math.min(rowWindowStartRef.current, maxRowWindowStart));
      let nextStart = computeShowcaseRowStartFromScroll(currentScrollTop, curStart);

      if (prevScrollTop !== null) {
        if (currentScrollTop > prevScrollTop && nextStart < curStart) {
          nextStart = curStart;
        } else if (currentScrollTop < prevScrollTop && nextStart > curStart) {
          nextStart = curStart;
        }
      }

      if (nextStart !== curStart) {
        rowWindowStartRef.current = nextStart;
        try {
          flushSync(() => {
            setRowWindowStart(nextStart);
          });
        } catch {
          setRowWindowStart(nextStart);
        }
        measureMountedShowcaseGeometry();
      }
    };

    window.addEventListener('keydown', onShowcaseKeyDown, true);
    mainEl.addEventListener('wheel', releaseDpadScrollControl, { passive: true });
    mainEl.addEventListener('touchstart', releaseDpadScrollControl, { passive: true });
    mainEl.addEventListener('touchmove', releaseDpadScrollControl, { passive: true });
    mainEl.addEventListener('pointerdown', releaseDpadScrollControl, { passive: true });
    mainEl.addEventListener('mousedown', releaseDpadScrollControl, { passive: true });
    mainEl.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('keydown', onShowcaseKeyDown, true);
      mainEl.removeEventListener('wheel', releaseDpadScrollControl);
      mainEl.removeEventListener('touchstart', releaseDpadScrollControl);
      mainEl.removeEventListener('touchmove', releaseDpadScrollControl);
      mainEl.removeEventListener('pointerdown', releaseDpadScrollControl);
      mainEl.removeEventListener('mousedown', releaseDpadScrollControl);
      mainEl.removeEventListener('scroll', handleScroll);
    };
  }, [
    isGridMode,
    shouldVirtualizeShowcaseRows,
    maxRowWindowStart,
    computeShowcaseRowStartFromScroll,
    measureMountedShowcaseGeometry,
  ]);

  // Category dropdown selection
  const handleSelectCategory = useCallback(
    (catId: string | null) => {
      setIsCategoriesMenuOpen(false);
      if (catId === 'showcase' || catId === null) {
        rowWindowStartRef.current = 0;
        setRowWindowStart(0);
        setActiveCategoryId(null);
        if (mainContainerRef.current) {
          mainContainerRef.current.scrollTop = 0;
        }
        isHeroScrolledOutOfViewRef.current = false;
        setIsHeroScrolledOutOfView(false);
        if (getNavMode() === 'remote' && categoriesTriggerRef.current) {
          setTimeout(() => {
            if (categoriesTriggerRef.current) focusElementSafely(categoriesTriggerRef.current);
          }, 0);
        }
        return;
      }

      setActiveCategoryId(catId);
      if (mainContainerRef.current) {
        mainContainerRef.current.scrollTop = 0;
      }
      isHeroScrolledOutOfViewRef.current = false;
      setIsHeroScrolledOutOfView(false);

      if (
        catId !== 'nc_recent' &&
        catId !== 'nc_fav' &&
        allLiveStreams.length === 0 &&
        fetchLiveStreams
      ) {
        Promise.resolve(fetchLiveStreams(catId)).catch(() => {});
      }

      if (getNavMode() === 'remote' && categoriesTriggerRef.current) {
        setTimeout(() => {
          if (categoriesTriggerRef.current) focusElementSafely(categoriesTriggerRef.current);
        }, 0);
      }
    },
    [allLiveStreams.length, fetchLiveStreams]
  );

  // Focus first item when Categories dropdown opens
  useEffect(() => {
    if (!isCategoriesMenuOpen) return;
    const menuEl = categoriesMenuRef.current;
    if (!menuEl) return;
    const targetBtn =
      menuEl.querySelector<HTMLButtonElement>('button[data-category-selected="true"]') ||
      menuEl.querySelector<HTMLButtonElement>('button[data-category-id]');
    if (targetBtn) {
      focusElementSafely(targetBtn);
    }
  }, [isCategoriesMenuOpen]);

  // Outside click closes Categories dropdown
  useEffect(() => {
    if (!isCategoriesMenuOpen) return;
    const onPointerDown = (e: PointerEvent | MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (categoriesMenuRef.current?.contains(target)) return;
      if (categoriesTriggerRef.current?.contains(target)) return;
      setIsCategoriesMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [isCategoriesMenuOpen]);

  // Keyboard navigation inside Categories menu (matching CatalogShowcaseView)
  const handleCategoriesMenuKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab') {
      setIsCategoriesMenuOpen(false);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const menuEl = categoriesMenuRef.current;
    if (!menuEl) return;
    const items = Array.from<HTMLButtonElement>(
      menuEl.querySelectorAll<HTMLButtonElement>('button[data-category-id]:not(:disabled)')
    );
    if (items.length === 0) return;
    const active = document.activeElement as HTMLButtonElement | null;
    const currentIdx = active ? items.indexOf(active) : -1;

    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'ArrowDown') {
      const nextIdx = currentIdx < 0 ? 0 : Math.min(items.length - 1, currentIdx + 1);
      focusElementSafely(items[nextIdx], 'down');
    } else if (e.key === 'ArrowUp') {
      const prevIdx = currentIdx <= 0 ? 0 : currentIdx - 1;
      focusElementSafely(items[prevIdx], 'up');
    }
  }, []);

  // Back handler 1: Close open Categories dropdown menu
  useBackHandler(
    'livetv-categories-menu',
    BACK_PRIORITY.CATEGORY_MENU,
    () => {
      if (isCategoriesMenuOpen) {
        setIsCategoriesMenuOpen(false);
        if (categoriesTriggerRef.current) {
          focusElementSafely(categoriesTriggerRef.current);
        }
        return true;
      }
      return false;
    },
    isCategoriesMenuOpen
  );

  // Back handler 2: Exit filtered category grid back to showcase
  useBackHandler(
    'livetv-filtered-grid',
    BACK_PRIORITY.VIEW_INTERNAL,
    () => {
      if (activeCategoryId !== null && !hasSearch) {
        rowWindowStartRef.current = 0;
        setRowWindowStart(0);
        setActiveCategoryId(null);
        if (mainContainerRef.current) {
          mainContainerRef.current.scrollTop = 0;
        }
        isHeroScrolledOutOfViewRef.current = false;
        setIsHeroScrolledOutOfView(false);
        setTimeout(() => {
          if (categoriesTriggerRef.current && isElementFocusable(categoriesTriggerRef.current)) {
            focusElementSafely(categoriesTriggerRef.current);
          }
        }, 0);
        return true;
      }
      return false;
    },
    activeCategoryId !== null && !hasSearch
  );

  const activeCategoryLabel = useMemo(() => {
    if (!activeCategoryId) return null;
    const vMatch = VIRTUAL_LIVE_CATEGORIES.find((vc) => vc.category_id === activeCategoryId);
    if (vMatch) return vMatch.category_name;
    const rMatch = liveCategories.find((c) => String(c.category_id) === String(activeCategoryId));
    return rMatch ? formatCategoryLabel(rMatch.category_name, 'live') : 'Categoria';
  }, [activeCategoryId, liveCategories]);

  const handleRetryDomain = useCallback(async () => {
    setIsRetryingDomain(true);
    try {
      const tasks: Promise<any>[] = [];
      if (liveCategoriesStatus === 'error' || liveCategoriesError) {
        if (fetchLiveCategories) tasks.push(fetchLiveCategories());
      }
      if (liveCatalogStatus === 'error' || liveError || tasks.length === 0) {
        if (fetchLiveStreams) tasks.push(fetchLiveStreams());
      }
      await Promise.all(tasks);
    } finally {
      setIsRetryingDomain(false);
    }
  }, [
    liveCategoriesStatus,
    liveCategoriesError,
    liveCatalogStatus,
    liveError,
    fetchLiveCategories,
    fetchLiveStreams,
  ]);

  const isCatalogLoading =
    liveCatalogStatus === 'loading' ||
    loadingLive ||
    (liveCategoriesStatus === 'loading' && liveCategories.length === 0);

  // Estado 5: When the Hero is scrolled out of view and the sliding preview is collapsed,
  // suspend the embedded streamUrl so hidden background video does not decode indefinitely.
  const isHeroDockedMode = Boolean(selectedGroup && isHeroScrolledOutOfView);
  const isDockedPreviewVisible = Boolean(isHeroDockedMode && isPreviewOpen);
  const effectiveStreamUrl =
    isHeroScrolledOutOfView && !isPreviewOpen ? '' : miniPlayerUrl;

  return (
    <div
      ref={viewRootRef}
      data-showcase-section="live"
      className="flex-1 flex flex-col w-full h-full overflow-hidden relative bg-nc-bg"
    >
      {(favActionError || favoriteError) && (
        <div
          role="alert"
          className="fixed bottom-6 right-6 left-6 sm:left-auto sm:max-w-md z-[100] bg-red-600/95 text-white nc-text-subtitle px-4 py-3 rounded-xl shadow-2xl border border-red-500/50 backdrop-blur-md flex items-center gap-3"
        >
          <AlertCircle className="w-5 h-5 text-white shrink-0" />
          <span className="whitespace-normal break-words">{favActionError || favoriteError}</span>
        </div>
      )}

      {/* Domain Top Bar with "TV ao Vivo" Title & "Categorias" Selector (identical to CatalogShowcaseView) */}
      <div
        data-nav-zone="categories"
        data-showcase-categories-bar="true"
        className="relative z-30 shrink-0 px-4 sm:px-6 md:px-10 pt-3 pb-2 flex flex-wrap items-center justify-between gap-3 bg-nc-bg"
      >
        <div data-nav-row="true" className="flex flex-wrap items-center gap-3 sm:gap-4">
          <h1 className="nc-section-title font-bold text-white tracking-tight">TV ao Vivo</h1>

          <div className="relative">
            <button
              ref={categoriesTriggerRef}
              type="button"
              data-categories-trigger="true"
              data-category-id="all"
              data-category-selected="true"
              disabled={liveCategoriesStatus === 'loading' && liveCategories.length === 0}
              aria-haspopup="listbox"
              aria-expanded={isCategoriesMenuOpen}
              onClick={() => setIsCategoriesMenuOpen((prev) => !prev)}
              className="flex items-center gap-2.5 px-4 py-2 rounded-full bg-white/[0.08] hover:bg-white/[0.14] border border-white/15 text-white nc-text-subtitle font-semibold transition-colors disabled:opacity-50"
            >
              <Layers className="w-4 h-4 text-nc-primary shrink-0" />
              <span>
                {activeCategoryLabel ? `Categorias: ${activeCategoryLabel}` : 'Categorias'}
              </span>
              <ChevronDown
                className={`w-4 h-4 text-white/75 transition-transform duration-200 ${
                  isCategoriesMenuOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            <div
              ref={categoriesMenuRef}
              role="listbox"
              aria-label="Categorias de TV ao Vivo"
              data-categories-menu="true"
              data-focus-scope={isCategoriesMenuOpen ? 'modal' : undefined}
              data-nav-zone={isCategoriesMenuOpen ? 'modal' : undefined}
              hidden={!isCategoriesMenuOpen}
              inert={!isCategoriesMenuOpen ? true : undefined}
              aria-hidden={!isCategoriesMenuOpen ? 'true' : undefined}
              onKeyDown={handleCategoriesMenuKeyDown}
              className="absolute left-0 top-full mt-2 w-72 sm:w-80 max-h-[65vh] overflow-y-auto rounded-2xl bg-[#12131a]/98 backdrop-blur-xl border border-white/15 shadow-[0_24px_60px_rgba(0,0,0,0.85)] p-2 z-50 flex flex-col gap-1"
            >
              {activeCategoryId !== null && (
                <>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    data-category-id="showcase"
                    onClick={() => handleSelectCategory(null)}
                    className="w-full text-left px-3.5 py-2.5 rounded-xl nc-text-subtitle font-semibold text-nc-primary hover:bg-white/[0.08] flex items-center justify-between gap-2 transition-colors"
                  >
                    <span>Voltar à vitrine de TV ao Vivo</span>
                  </button>
                  <div role="separator" className="my-1 border-t border-white/10" />
                </>
              )}

              {VIRTUAL_LIVE_CATEGORIES.map((vc) => {
                const isSelected = activeCategoryId === vc.category_id;
                return (
                  <button
                    key={vc.category_id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    data-category-id={vc.category_id}
                    data-live-category-id={vc.category_id}
                    data-category-selected={isSelected ? 'true' : 'false'}
                    onClick={() => handleSelectCategory(vc.category_id)}
                    className={`w-full text-left px-3.5 py-2.5 rounded-xl nc-text-subtitle font-medium flex items-center justify-between gap-2 transition-colors ${
                      isSelected
                        ? 'bg-nc-primary text-black font-bold'
                        : 'text-white/90 hover:bg-white/[0.08]'
                    }`}
                  >
                    <span className="whitespace-normal break-words">{vc.category_name}</span>
                    {isSelected && <Check className="w-4 h-4 shrink-0" />}
                  </button>
                );
              })}

              {liveCategories.length > 0 && (
                <div role="separator" className="my-1 border-t border-white/10" />
              )}

              {liveCategories.map((cat) => {
                const catId = String(cat.category_id);
                const isSelected = activeCategoryId === catId;
                const formatted = formatCategoryLabel(cat.category_name, 'live');
                return (
                  <button
                    key={catId}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    data-category-id={catId}
                    data-live-category-id={catId}
                    data-category-selected={isSelected ? 'true' : 'false'}
                    onClick={() => handleSelectCategory(catId)}
                    className={`w-full text-left px-3.5 py-2.5 rounded-xl nc-text-subtitle font-medium flex items-center justify-between gap-2 transition-colors ${
                      isSelected
                        ? 'bg-nc-primary text-black font-bold'
                        : 'text-white/85 hover:bg-white/[0.08]'
                    }`}
                  >
                    <span className="whitespace-normal break-words">{formatted}</span>
                    {isSelected && <Check className="w-4 h-4 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          {activeCategoryId !== null && !hasSearch && (
            <button
              type="button"
              data-back-to-showcase="true"
              onClick={() => handleSelectCategory(null)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-nc-text-secondary hover:text-white nc-text-subtitle font-medium transition-colors"
            >
              <ChevronLeft className="w-4 h-4 shrink-0" />
              <span>Vitrine</span>
            </button>
          )}
        </div>

        {(isGridMode || hasSearch) && (
          <span className="nc-text-meta text-nc-text-secondary font-medium">
            {displayedGridGroups.length}{' '}
            {displayedGridGroups.length === 1 ? 'canal' : 'canais'}
          </span>
        )}
      </div>

      {/* Main Scrollable Content Area (Hero + Category Carousels OR Filtered/Search Grid) */}
      <main
        ref={mainContainerRef as React.RefObject<HTMLElement>}
        data-scroll-container="true"
        data-nav-zone="content"
        style={{ overflowAnchor: 'none' }}
        className="flex-1 bg-nc-bg overflow-y-auto h-full"
      >
        {(liveCategoriesError || liveError) && (
          <div
            role="status"
            data-domain-error="live"
            className="mx-4 sm:mx-6 md:mx-10 mt-3 mb-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
          >
            <div className="flex items-start sm:items-center gap-2.5">
              <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5 sm:mt-0" />
              <span className="nc-text-subtitle text-amber-200 whitespace-normal break-words">
                {liveError || liveCategoriesError}
              </span>
            </div>
            <button
              type="button"
              data-domain-retry="live"
              disabled={isRetryingDomain}
              onClick={handleRetryDomain}
              className="px-3.5 py-1.5 rounded-lg bg-nc-primary text-black nc-text-subtitle font-semibold hover:bg-nc-primary-hover transition-colors flex items-center gap-1.5 shrink-0 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRetryingDomain ? 'animate-spin' : ''}`} />
              <span>Tentar novamente</span>
            </button>
          </div>
        )}

        <div className="pb-16">
          {/* Natural Top Hero Slot: preserves exact measured height when Hero docks so scrollTop never shifts */}
          <div
            ref={heroSlotRef}
            data-live-hero-slot="true"
            style={
              isHeroDockedMode
                ? { height: `${heroSlotHeightPx}px`, overflowAnchor: 'none' }
                : { overflowAnchor: 'none' }
            }
            className="w-full shrink-0"
          >
            <LiveTvHero
              selectedGroup={selectedGroup}
              activeVariantStream={activeVariantStream}
              selectedResolutionMode={selectedResolutionMode}
              serverUrl={credentials?.serverUrl}
              streamUrl={effectiveStreamUrl}
              attemptTrigger={attemptTrigger}
              fullscreenRequestTrigger={fullscreenRequestTrigger}
              isLoadingPlayback={miniPlayerLoading}
              playbackError={miniPlayerError}
              nowPlaying={heroNowPlaying}
              loadingEpg={loadingEpg}
              epgError={epgError}
              isFavorited={isGroupFavorited(selectedGroup)}
              isCatalogLoading={isCatalogLoading && totalShowcaseRows === 0}
              isDocked={isHeroDockedMode}
              isDockedVisible={isDockedPreviewVisible}
              dockTopPx={dockTopPx}
              onCloseDock={handleCloseDock}
              onExpandFullscreen={handleExpandFullscreen}
              onRetryPlayback={handleRetryPlayback}
              onBackFromFullscreen={handleBackFromHeroPlayer}
              onPlaybackSuccess={handlePlaybackSuccess}
              onPlaybackFinalError={handlePlaybackFinalError}
              onSelectResolutionMode={handleSelectResolutionMode}
              onToggleFavorite={handleToggleHeroFavorite}
            />
          </div>

          {isGridMode ? (
            /* Virtualized Grid for Explicit Category Filter OR Search Results */
            <div className="px-4 sm:px-6 md:px-10 pt-2 pb-12">
              <div className="mb-4 flex items-center justify-between gap-2">
                <h2 className="nc-subsection-title font-bold text-white whitespace-normal break-words">
                  {hasSearch
                    ? `Resultados em TV ao Vivo para "${searchQuery}"`
                    : activeCategoryLabel || 'Canais'}
                </h2>
              </div>

              {isCatalogLoading && displayedGridGroups.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-nc-text-secondary">
                  <Loader2 className="w-8 h-8 animate-spin text-nc-primary mb-4" />
                  <p className="nc-text-subtitle">Carregando canais...</p>
                </div>
              ) : displayedGridGroups.length === 0 ? (
                <div className="text-center py-20 text-nc-text-secondary">
                  <TvMinimalPlay className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p className="nc-text-subtitle">
                    {hasSearch
                      ? `Nenhum canal encontrado para "${searchQuery}".`
                      : activeCategoryId === 'nc_recent'
                        ? 'Você ainda não assistiu a canais recentemente.'
                        : activeCategoryId === 'nc_fav'
                          ? 'Você ainda não adicionou canais aos favoritos.'
                          : 'Nenhum canal encontrado nesta categoria.'}
                  </p>
                </div>
              ) : (
                <LiveChannelGrid
                  groups={displayedGridGroups}
                  mainContainerRef={mainContainerRef}
                  resetKey={`live_${activeCategoryId ?? 'showcase'}_${normalizedQuery}`}
                  serverUrl={credentials?.serverUrl}
                  accountPrefix={accountPrefix}
                  selectedGroupId={selectedGroup?.groupId ?? null}
                  epgCache={epgCacheRef.current}
                  epgCacheVersion={epgCacheVersion}
                  referenceNowMs={epgClockNowMs}
                  onActivateGroup={handleActivateGroup}
                />
              )}
            </div>
          ) : (
            /* Vertical Category Showcase Mode (HorizontalRow Carousels of Wide Channel Cards) */
            <>
              {isCatalogLoading && totalShowcaseRows === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-nc-text-secondary">
                  <Loader2 className="w-8 h-8 animate-spin text-nc-primary mb-4" />
                  <p className="nc-text-subtitle">Carregando canais...</p>
                </div>
              ) : totalShowcaseRows === 0 ? (
                <div className="text-center py-20 text-nc-text-secondary px-6">
                  <TvMinimalPlay className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p className="nc-text-subtitle">Nenhum canal disponível no momento.</p>
                </div>
              ) : (
                <div
                  ref={showcaseRowsContainerCallbackRef}
                  data-showcase-rows-container="true"
                  data-showcase-virtualized={shouldVirtualizeShowcaseRows ? 'true' : 'false'}
                  data-showcase-total-rows={totalShowcaseRows}
                  style={{ overflowAnchor: 'none' }}
                  className="mt-2 sm:mt-4 px-4 sm:px-6 md:px-10 relative z-20"
                >
                  <div
                    data-showcase-row-spacer="top"
                    aria-hidden="true"
                    style={{ height: '0px', overflowAnchor: 'none' }}
                  />
                  {showcaseRowDefinitions.map((row, rowIndex) => {
                    const isMounted =
                      rowIndex >= effectiveRowWindowStart && rowIndex < effectiveRowWindowEnd;

                    return (
                      <div
                        key={row.key}
                        data-scroll-block="true"
                        data-showcase-row-key={row.key}
                        data-showcase-row-index={rowIndex}
                        className="pb-6"
                        style={{ overflowAnchor: 'none' }}
                      >
                        {isMounted ? (
                          <LiveChannelRow
                            title={row.title}
                            groups={row.groups}
                            rowIndex={rowIndex}
                            serverUrl={credentials?.serverUrl}
                            accountPrefix={accountPrefix}
                            selectedGroupId={selectedGroup?.groupId ?? null}
                            epgCache={epgCacheRef.current}
                            epgCacheVersion={epgCacheVersion}
                            referenceNowMs={epgClockNowMs}
                            virtualize={row.virtualize}
                            scrollContainer={mainContainerRef.current}
                            onActivateGroup={handleActivateGroup}
                          />
                        ) : (
                          <div className="w-full group" data-showcase-unmounted-row={rowIndex}>
                            <h2 className="nc-heading-view font-semibold text-white mb-4 break-words whitespace-normal">
                              {row.title}
                            </h2>
                            <div
                              className="flex flex-row overflow-hidden w-full gap-4 px-2 pb-8 pt-4 pointer-events-none select-none"
                              aria-hidden="true"
                            >
                              <div className="nc-live-wide-card shrink-0 rounded-xl invisible" />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div
                    data-showcase-row-spacer="bottom"
                    aria-hidden="true"
                    style={{ height: '0px', overflowAnchor: 'none' }}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
});
