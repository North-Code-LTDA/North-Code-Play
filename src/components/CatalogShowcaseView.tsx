import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import {
  Play,
  Film,
  Tv,
  Radio,
  Search,
  Loader2,
  AlertCircle,
  RefreshCw,
  ChevronDown,
  ChevronLeft,
  Layers,
  Check,
} from 'lucide-react';
import { XtreamCredentials } from '../types';
import { HeroBanner, fetchOrReuseHeroDetails } from './HeroBanner';
import { HorizontalRow } from './HorizontalRow';
import { MovieDetails } from './MovieDetails';
import { SeriesDetails } from './SeriesDetails';
import { MediaImage } from './MediaImage';
import { useFavorites } from '../hooks/useFavorites';
import {
  getItemProgress,
  useAccountPlaybackHistory,
} from '../utils/playbackHistory';
import {
  getOrCreateVodIndex,
  getOrCreateSeriesIndex,
  getHeroBannerItems,
} from '../utils/catalogIndex';
import {
  buildDirectMediaUrl,
  normalizeImageSource,
} from '../utils/mediaUtils';
import { getValidYear } from '../utils/catalogRanking';
import { useVirtualWindow } from '../hooks/useVirtualWindow';
import {
  useBackHandler,
  BACK_PRIORITY,
  getNavMode,
  focusElementSafely,
  isElementFocusable,
  pushFocusMemory,
  restoreVirtualItemByKey,
  registerShowcaseRowController,
  unregisterShowcaseRowController,
} from '../navigation';

function isSeriesItem(item: any): boolean {
  if (!item || typeof item !== 'object') return false;
  return Boolean(item.series_id || item.stream_type === 'series' || item.type === 'series');
}

function extractReleaseYear(item: any): number | null {
  const year = getValidYear(item);
  return year > 0 ? year : null;
}

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
  const rowWrapper = containerEl.querySelector<HTMLElement>(
    `[data-home-row-index="${rowIndex}"]`
  );
  if (!rowWrapper) return null;
  const targetEl =
    rowWrapper.closest<HTMLElement>('[data-scroll-block="true"]') || rowWrapper;
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

export type CatalogShowcaseSection = 'inicio' | 'movies' | 'series';

export interface CatalogShowcaseViewProps {
  section: CatalogShowcaseSection;
  credentials: XtreamCredentials | null;
  searchQuery?: string;
  isPaused?: boolean;
  onPlay: (
    url: string,
    title: string,
    startAt?: number,
    streamId?: string | number,
    contentType?: 'live' | 'movie' | 'episode',
    channelName?: string,
    programTitle?: string,
    onNext?: () => void,
    onPrevious?: () => void
  ) => void;
  onSelectLiveChannel?: (stream: any) => void;

  // Live domain (used in 'inicio')
  liveStreams?: any[];
  allLiveStreams?: any[];
  loadingLive?: boolean;
  liveCatalogStatus?: string;
  fetchLiveStreams?: (categoryId?: string) => Promise<void>;

  // VOD domain (used in 'inicio' and 'movies')
  vodCategories?: any[];
  vodStreams?: any[];
  allVodStreams?: any[];
  loadingVod?: boolean;
  vodError?: string | null;
  vodCategoriesStatus?: string;
  vodCatalogStatus?: string;
  vodCategoriesError?: string | null;
  fetchVodCategories?: () => Promise<void>;
  fetchVodStreams?: (categoryId?: string) => Promise<void>;

  // Series domain (used in 'inicio' and 'series')
  seriesCategories?: any[];
  seriesStreams?: any[];
  allSeriesStreams?: any[];
  loadingSeries?: boolean;
  seriesError?: string | null;
  seriesCategoriesStatus?: string;
  seriesCatalogStatus?: string;
  seriesCategoriesError?: string | null;
  fetchSeriesCategories?: () => Promise<void>;
  fetchSeriesStreams?: (categoryId?: string) => Promise<void>;

  // Session readiness (used in 'inicio')
  sessionReady?: boolean;
}

const EMPTY_ARRAY: any[] = [];

const VIRTUAL_CATEGORIES = [
  { category_id: 'all', category_name: 'Ver todos', isVirtual: true },
  { category_id: 'nc_recent', category_name: 'Assistidos Recentemente', isVirtual: true },
  { category_id: 'nc_fav', category_name: 'Favoritos', isVirtual: true },
] as const;

const SHOWCASE_ROW_WINDOW_SIZE = 8;
const SHOWCASE_SCROLL_HYSTERESIS_PX = 24;
const SEARCH_IMAGE_ACTIVE_BUDGET = 24;

interface ShowcaseRowDescriptor {
  key: string;
  title: string;
  type: 'vod' | 'series' | 'live';
  kind: 'fixed' | 'vod_category' | 'series_category';
  fixedItems?: any[];
  categoryId?: string;
  virtualize?: boolean;
  isContinueRow?: boolean;
}

function estimateTitleLineCount(
  title: string,
  availableWidthPx: number,
  fontSizePx: number
): number {
  const trimmed = (title || '').trim();
  if (!trimmed) return 1;
  const safeWidth = Math.max(120, availableWidthPx);
  // .nc-heading-view uses font-weight: 700 (bold). In proportional Latin fonts,
  // bold text averages ~0.68 * fontSizePx per character (including whitespace and accents).
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

function estimateShowcaseRowSlotHeight(
  desc: ShowcaseRowDescriptor | undefined,
  viewportWidth: number
): number {
  const safeVw = viewportWidth > 0 ? viewportWidth : 1280;
  // Horizontal container padding on [data-showcase-rows-container="true"]:
  // px-4 (32px) below 640px, sm:px-6 (48px) at 640..767px, md:px-10 (80px) at >=768px
  const horizontalPaddingPx = safeVw >= 768 ? 80 : safeVw >= 640 ? 48 : 32;
  const availableTitleWidthPx = Math.max(140, safeVw - horizontalPaddingPx);
  // .nc-heading-view: clamp(18px, calc(15.68px + 0.65vw), 24px), line-height: 1.25
  const headingFontSizePx = Math.min(24, Math.max(18, 15.68 + 0.0065 * safeVw));
  const headingLineHeightPx = headingFontSizePx * 1.25;
  const lineCount = estimateTitleLineCount(
    desc?.title || '',
    availableTitleWidthPx,
    headingFontSizePx
  );
  const titleHeightPx = Math.ceil(lineCount * headingLineHeightPx);
  const titleMarginBottomPx = 16; // mb-4 on <h2> in HorizontalRow
  const trackVerticalPaddingPx = 48; // pt-4 (16px) + pb-8 (32px) on carousel track in HorizontalRow
  // Card height in HorizontalRow:
  // live: w-64 h-36 (144px) / md:w-72 md:h-[162px] (162px)
  // vod/series: w-36 h-54 (216px) / md:w-44 md:h-66 (264px)
  const cardHeightPx =
    desc?.type === 'live'
      ? safeVw >= 768
        ? 162
        : 144
      : safeVw >= 768
        ? 264
        : 216;
  const interRowSpacingPx = 24; // pb-6 (24px) on [data-scroll-block="true"]
  return (
    titleHeightPx +
    titleMarginBottomPx +
    trackVerticalPaddingPx +
    cardHeightPx +
    interRowSpacingPx
  );
}

function estimateShowcaseRowsStartOffset(
  hasHero: boolean,
  viewportWidth: number,
  viewportHeight: number
): number {
  const safeVw = viewportWidth > 0 ? viewportWidth : 1280;
  const safeVh = viewportHeight > 0 ? viewportHeight : 720;
  const containerMarginTopPx = safeVw >= 640 ? 16 : 8; // mt-2 (8px) / sm:mt-4 (16px)
  if (!hasHero) {
    return containerMarginTopPx;
  }
  // HeroBanner: h-[36vh] min-h-[240px] max-h-[380px] mb-4 (16px)
  const heroHeightPx = Math.min(380, Math.max(240, Math.round(safeVh * 0.36)));
  const heroMarginBottomPx = 16;
  return heroHeightPx + heroMarginBottomPx + containerMarginTopPx;
}

interface VirtualizedInicioSearchSectionProps {
  domain: 'live' | 'vod' | 'series';
  title: string;
  items: any[];
  credentials: XtreamCredentials | null;
  scrollContainerRef: React.RefObject<HTMLElement | null>;
  resetKey: string;
  maxWindowItems: number;
  fallbackOffsetTopPx: number;
  onLiveClick: (stream: any, el?: HTMLElement | null) => void;
  onMediaClick: (item: any, el?: HTMLElement | null) => void;
}

const VirtualizedInicioSearchSection = React.memo(function VirtualizedInicioSearchSection({
  domain,
  title,
  items,
  credentials,
  scrollContainerRef,
  resetKey,
  maxWindowItems,
  fallbackOffsetTopPx,
  onLiveClick,
  onMediaClick,
}: VirtualizedInicioSearchSectionProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [focusedVirtualIdx, setFocusedVirtualIdx] = useState<number | null>(null);

  const {
    startIndex,
    endIndex,
    topSpacerPx,
    bottomSpacerPx,
    columns,
    virtualContainerCallbackRef,
  } = useVirtualWindow({
    totalCount: items.length,
    mode: 'grid',
    scrollContainerRef,
    virtualContainerRef: gridRef,
    resetKey,
    maxWindowItems,
    fallbackOffsetTopPx,
  });

  useEffect(() => {
    setFocusedVirtualIdx(null);
  }, [resetKey]);

  const activeImageRange = useMemo(() => {
    const windowLen = Math.max(0, endIndex - startIndex);
    if (windowLen <= SEARCH_IMAGE_ACTIVE_BUDGET) {
      return { min: startIndex, max: endIndex };
    }
    if (
      focusedVirtualIdx !== null &&
      focusedVirtualIdx >= startIndex &&
      focusedVirtualIdx < endIndex
    ) {
      const half = Math.floor(SEARCH_IMAGE_ACTIVE_BUDGET / 2);
      const min = Math.max(
        startIndex,
        Math.min(endIndex - SEARCH_IMAGE_ACTIVE_BUDGET, focusedVirtualIdx - half)
      );
      return { min, max: Math.min(endIndex, min + SEARCH_IMAGE_ACTIVE_BUDGET) };
    }
    if (startIndex === 0) {
      return { min: 0, max: Math.min(endIndex, SEARCH_IMAGE_ACTIVE_BUDGET) };
    }
    if (endIndex >= items.length) {
      return {
        min: Math.max(startIndex, endIndex - SEARCH_IMAGE_ACTIVE_BUDGET),
        max: endIndex,
      };
    }
    const leadOffset = Math.min(
      Math.max(0, windowLen - SEARCH_IMAGE_ACTIVE_BUDGET),
      Math.max(columns, columns * 2)
    );
    const min = startIndex + leadOffset;
    return { min, max: Math.min(endIndex, min + SEARCH_IMAGE_ACTIVE_BUDGET) };
  }, [startIndex, endIndex, focusedVirtualIdx, items.length, columns]);

  if (items.length === 0) return null;

  return (
    <div data-search-domain={domain}>
      <h3 className="nc-subsection-title font-semibold text-white mb-4 flex items-center gap-2">
        {domain === 'live' ? (
          <Radio className="w-5 h-5 text-red-500 shrink-0" />
        ) : domain === 'vod' ? (
          <Film className="w-5 h-5 text-nc-primary shrink-0" />
        ) : (
          <Tv className="w-5 h-5 text-blue-500 shrink-0" />
        )}
        <span>
          {title} ({items.length})
        </span>
      </h3>

      {topSpacerPx > 0 && (
        <div
          data-virtual-spacer="top"
          aria-hidden="true"
          style={{ height: `${topSpacerPx}px` }}
        />
      )}

      <div
        ref={virtualContainerCallbackRef}
        data-nav-grid="true"
        data-virtual-container="true"
        className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4"
      >
        {items.slice(startIndex, endIndex).map((entry: any, localIdx: number) => {
          const virtualIndex = startIndex + localIdx;
          const rawId =
            domain === 'series'
              ? entry.series_id ?? entry.stream_id ?? entry.id ?? virtualIndex
              : entry.stream_id ?? entry.id ?? virtualIndex;
          const itemKey = `${domain}_${rawId}_${virtualIndex}`;
          const itemTitle =
            entry.name ||
            entry.title ||
            (domain === 'live' ? 'Canal ao vivo' : domain === 'vod' ? 'Filme' : 'Série');
          const isImageActive =
            (virtualIndex >= activeImageRange.min && virtualIndex < activeImageRange.max) ||
            focusedVirtualIdx === virtualIndex;

          if (domain === 'live') {
            return (
              <div
                key={itemKey}
                tabIndex={0}
                role="button"
                aria-label={itemTitle}
                data-nav-item="true"
                data-virtual-index={virtualIndex}
                data-virtual-key={String(rawId)}
                onFocus={() => setFocusedVirtualIdx(virtualIndex)}
                onClick={(e) => onLiveClick(entry, e.currentTarget)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onLiveClick(entry, e.currentTarget);
                  }
                }}
                className="group relative aspect-video bg-nc-bg-card rounded-xl overflow-hidden border border-nc-border hover:border-nc-primary/50 transition-all cursor-pointer flex flex-col justify-between p-3"
              >
                <div className="flex-1 flex items-center justify-center overflow-hidden p-2">
                  <MediaImage
                    src={entry.stream_icon}
                    serverUrl={credentials?.serverUrl}
                    alt={itemTitle}
                    itemId={rawId}
                    itemName={itemTitle}
                    active={isImageActive}
                    className="max-h-full max-w-full object-contain group-hover:scale-110 transition-transform"
                  />
                </div>
                <div className="mt-2 text-center">
                  <h4 className="text-white nc-card-title line-clamp-2 group-hover:text-nc-primary transition-colors">
                    {itemTitle}
                  </h4>
                </div>
              </div>
            );
          }

          const coverSrc =
            domain === 'series'
              ? entry.cover || entry.stream_icon
              : entry.stream_icon || entry.cover;
          const payload = domain === 'series' ? { ...entry, stream_type: 'series' } : entry;

          return (
            <div
              key={itemKey}
              tabIndex={0}
              role="button"
              aria-label={itemTitle}
              data-nav-item="true"
              data-virtual-index={virtualIndex}
              data-virtual-key={String(rawId)}
              onFocus={() => setFocusedVirtualIdx(virtualIndex)}
              onClick={(e) => {
                const el = e.currentTarget as HTMLElement;
                pushFocusMemory(el);
                onMediaClick(payload, el);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  const el = e.currentTarget as HTMLElement;
                  pushFocusMemory(el);
                  onMediaClick(payload, el);
                }
              }}
              className="group relative aspect-[2/3] bg-nc-bg-card rounded-xl overflow-hidden border border-nc-border hover:border-nc-primary/50 transition-all cursor-pointer flex flex-col justify-end"
            >
              <MediaImage
                src={coverSrc}
                serverUrl={credentials?.serverUrl}
                alt={itemTitle}
                itemId={rawId}
                itemName={itemTitle}
                active={isImageActive}
                className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
              <div className="relative z-10 p-3">
                <h4 className="text-white nc-card-title line-clamp-2 group-hover:text-nc-primary transition-colors">
                  {itemTitle}
                </h4>
              </div>
            </div>
          );
        })}
      </div>

      {bottomSpacerPx > 0 && (
        <div
          data-virtual-spacer="bottom"
          aria-hidden="true"
          style={{ height: `${bottomSpacerPx}px` }}
        />
      )}
    </div>
  );
});

export const CatalogShowcaseView = React.memo(function CatalogShowcaseView({
  section,
  credentials,
  searchQuery = '',
  isPaused = false,
  onPlay,
  onSelectLiveChannel,
  liveStreams = EMPTY_ARRAY,
  allLiveStreams = EMPTY_ARRAY,
  loadingLive = false,
  liveCatalogStatus = 'idle',
  fetchLiveStreams,
  vodCategories = EMPTY_ARRAY,
  vodStreams = EMPTY_ARRAY,
  allVodStreams = EMPTY_ARRAY,
  loadingVod = false,
  vodError = null,
  vodCategoriesStatus = 'ready',
  vodCatalogStatus = 'ready',
  vodCategoriesError = null,
  fetchVodCategories,
  fetchVodStreams,
  seriesCategories = EMPTY_ARRAY,
  seriesStreams = EMPTY_ARRAY,
  allSeriesStreams = EMPTY_ARRAY,
  loadingSeries = false,
  seriesError = null,
  seriesCategoriesStatus = 'ready',
  seriesCatalogStatus = 'ready',
  seriesCategoriesError = null,
  fetchSeriesCategories,
  fetchSeriesStreams,
  sessionReady = true,
}: CatalogShowcaseViewProps) {
  const { favorites } = useFavorites();
  const historyRecords = useAccountPlaybackHistory(credentials);

  // Selected details modals
  const [selectedMovie, setSelectedMovie] = useState<any | null>(null);
  const [selectedSeries, setSelectedSeries] = useState<any | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const [isRetryingDomain, setIsRetryingDomain] = useState(false);

  // Category filter state for 'movies' and 'series' (null = Showcase Mode)
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [isCategoriesMenuOpen, setIsCategoriesMenuOpen] = useState(false);

  // Vertical window state for Showcase rows
  const [rowWindowStart, setRowWindowStart] = useState(0);
  const rowWindowStartRef = useRef(0);
  rowWindowStartRef.current = rowWindowStart;
  const isProgrammaticRowShiftRef = useRef(false);
  const isDpadShowcaseNavActiveRef = useRef(false);
  const lastManualScrollTopRef = useRef<number | null>(null);
  const measuredRowHeightsRef = useRef<Map<number, number>>(new Map());
  const measuredRowsStartOffsetRef = useRef<number | null>(null);

  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>(() => ({
    width: typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : 720,
  }));
  const liveViewportWidth =
    typeof window !== 'undefined' && window.innerWidth > 0
      ? window.innerWidth
      : viewportSize.width;
  const liveViewportHeight =
    typeof window !== 'undefined' && window.innerHeight > 0
      ? window.innerHeight
      : viewportSize.height;
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
      const nextH = window.innerHeight > 0 ? window.innerHeight : 720;
      setViewportSize((prev) =>
        prev.width === nextW && prev.height === nextH ? prev : { width: nextW, height: nextH }
      );
    };
    window.addEventListener('resize', handleResize, { passive: true });
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const mainContainerRef = useRef<HTMLElement | null>(null);
  const gridContainerRef = useRef<HTMLDivElement | null>(null);
  const showcaseRowsContainerRef = useRef<HTMLDivElement | null>(null);
  const registeredShowcaseContainerRef = useRef<HTMLDivElement | null>(null);
  const categoriesTriggerRef = useRef<HTMLButtonElement | null>(null);
  const categoriesMenuRef = useRef<HTMLDivElement | null>(null);

  const savedScrollTopRef = useRef<number | null>(null);
  const preSearchScrollTopRef = useRef<number | null>(null);
  const preSearchRowWindowStartRef = useRef<number | null>(null);
  const wasSearchingRef = useRef<boolean>(false);
  const lastOpenedGridKeyRef = useRef<string | null>(null);
  const lastShowcaseOriginRef = useRef<{
    rowContainer: HTMLElement | null;
    rowScrollLeft: number;
    homeRowIndex: number | null;
    rowCardIndex: number | null;
    virtualKey: string | null;
    virtualIndex: number | null;
    cardElement: HTMLElement | null;
  } | null>(null);

  // Keep latest values in refs for stable callbacks and async metadata guards
  const isMountedRef = useRef(true);
  const activeSectionRef = useRef(section);
  activeSectionRef.current = section;
  const credentialsRef = useRef(credentials);
  credentialsRef.current = credentials;
  const onPlayRef = useRef(onPlay);
  onPlayRef.current = onPlay;
  const onSelectLiveChannelRef = useRef(onSelectLiveChannel);
  onSelectLiveChannelRef.current = onSelectLiveChannel;
  const historyRecordsRef = useRef(historyRecords);
  historyRecordsRef.current = historyRecords;
  const heroPlaySessionRef = useRef(0);
  const heroPlayInFlightRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      heroPlaySessionRef.current += 1;
      heroPlayInFlightRef.current = false;
    };
  }, []);

  // Invalidate any pending async HeroBanner play resolution if section or account changes
  useEffect(() => {
    heroPlaySessionRef.current += 1;
    heroPlayInFlightRef.current = false;
  }, [section, credentials?.serverUrl, credentials?.username]);

  // Reset vertical showcase row window when switching sections
  useEffect(() => {
    rowWindowStartRef.current = 0;
    setRowWindowStart(0);
    isDpadShowcaseNavActiveRef.current = false;
    lastManualScrollTopRef.current = null;
    measuredRowHeightsRef.current.clear();
    measuredRowsStartOffsetRef.current = null;
    preSearchScrollTopRef.current = null;
    preSearchRowWindowStartRef.current = null;
    wasSearchingRef.current = false;
  }, [section]);

  useEffect(() => {
    if (playError) {
      const timer = setTimeout(() => setPlayError(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [playError]);

  // Trigger initial catalog fetch in 'inicio' if idle
  useEffect(() => {
    if (section === 'inicio' && credentials && sessionReady) {
      if (liveCatalogStatus === 'idle' && fetchLiveStreams) {
        fetchLiveStreams().catch(() => {});
      }
      if (vodCatalogStatus === 'idle' && fetchVodStreams) {
        fetchVodStreams().catch(() => {});
      }
      if (seriesCatalogStatus === 'idle' && fetchSeriesStreams) {
        fetchSeriesStreams().catch(() => {});
      }
    }
  }, [
    section,
    credentials,
    sessionReady,
    liveCatalogStatus,
    vodCatalogStatus,
    seriesCatalogStatus,
    fetchLiveStreams,
    fetchVodStreams,
    fetchSeriesStreams,
  ]);

  // Build O(1) catalog indexes only for relevant domains
  const vodIndex = useMemo(
    () => getOrCreateVodIndex(section === 'series' ? EMPTY_ARRAY : allVodStreams),
    [section, allVodStreams]
  );
  const seriesIndex = useMemo(
    () => getOrCreateSeriesIndex(section === 'movies' ? EMPTY_ARRAY : allSeriesStreams),
    [section, allSeriesStreams]
  );

  // Domain-specific Continue Watching rows
  const continueWatchingItems = useMemo(() => {
    if (section === 'movies') {
      if (allVodStreams.length === 0) return EMPTY_ARRAY;
      const result: any[] = [];
      const seen = new Set<string>();
      for (const r of historyRecords) {
        if (r.type === 'movie' && (r.positionSec ?? 0) > 30) {
          const item = vodIndex.getById(r.id);
          if (item) {
            const idStr = String(item.stream_id ?? item.id);
            const rowKey = `movie_${idStr}`;
            if (!seen.has(rowKey)) {
              seen.add(rowKey);
              result.push({ ...item, rowKey });
            }
          }
        }
      }
      return result;
    }

    if (section === 'series') {
      if (allSeriesStreams.length === 0) return EMPTY_ARRAY;
      const result: any[] = [];
      const seen = new Set<string>();
      for (const r of historyRecords) {
        if ((r.positionSec ?? 0) <= 30) continue;
        const seriesLookupId = r.type === 'episode' ? r.parentSeriesId : undefined;
        if (!seriesLookupId) continue;
        const item = seriesIndex.getById(seriesLookupId);
        if (item) {
          const idStr = String(item.series_id ?? item.id);
          const rowKey = `series_${idStr}`;
          if (!seen.has(rowKey)) {
            seen.add(rowKey);
            result.push({ ...item, rowKey });
          }
        }
      }
      return result;
    }

    // 'inicio': mixed movies + series
    if (allVodStreams.length === 0 && allSeriesStreams.length === 0) return EMPTY_ARRAY;
    const result: any[] = [];
    const seen = new Set<string>();
    for (const r of historyRecords) {
      if ((r.positionSec ?? 0) <= 30) continue;
      if (r.type === 'movie') {
        const item = vodIndex.getById(r.id);
        if (item) {
          const idStr = String(item.stream_id ?? item.id);
          const rowKey = `movie_${idStr}`;
          if (!seen.has(rowKey)) {
            seen.add(rowKey);
            result.push({ ...item, rowKey });
          }
        }
      } else if (r.type === 'episode' && r.parentSeriesId) {
        const item = seriesIndex.getById(r.parentSeriesId);
        if (item) {
          const idStr = String(item.series_id ?? item.id);
          const rowKey = `series_${idStr}`;
          if (!seen.has(rowKey)) {
            seen.add(rowKey);
            result.push({ ...item, rowKey });
          }
        }
      }
    }
    return result;
  }, [
    section,
    historyRecords,
    allVodStreams.length,
    allSeriesStreams.length,
    vodIndex,
    seriesIndex,
  ]);

  // Domain-specific Favorites rows (for 'movies' and 'series')
  const domainFavoriteItems = useMemo(() => {
    if (section === 'movies') {
      const movieFavs = favorites.filter((f) => f && f.type === 'movie');
      if (movieFavs.length === 0) return EMPTY_ARRAY;
      const result: any[] = [];
      for (const fav of movieFavs) {
        const found = vodIndex.getById(fav.id);
        if (found) {
          result.push(found);
        } else {
          const favAny = fav as any;
          result.push({
            stream_id: fav.id,
            name: fav.name || favAny.title || 'Filme Favorito',
            stream_icon: fav.cover || favAny.image || '',
            rating: favAny.rating || fav.extraData?.rating || '',
            year: favAny.year || fav.extraData?.year || '',
            category_name: favAny.category || 'Favorito',
            stream_type: 'movie',
          });
        }
      }
      return result;
    }

    if (section === 'series') {
      const seriesFavs = favorites.filter((f) => f && f.type === 'series');
      if (seriesFavs.length === 0) return EMPTY_ARRAY;
      const result: any[] = [];
      for (const fav of seriesFavs) {
        const found = seriesIndex.getById(fav.id);
        if (found) {
          result.push(found);
        } else {
          const favAny = fav as any;
          result.push({
            series_id: fav.id,
            name: fav.name || favAny.title || 'Série Favorita',
            cover: fav.cover || favAny.image || '',
            rating: favAny.rating || fav.extraData?.rating || '',
            year: favAny.year || fav.extraData?.year || '',
            category_name: favAny.category || 'Favorito',
            stream_type: 'series',
          });
        }
      }
      return result;
    }

    return EMPTY_ARRAY;
  }, [section, favorites, vodIndex, seriesIndex]);

  // Featured items
  const featuredMovies = useMemo(() => {
    if (section === 'series') return EMPTY_ARRAY;
    if (allVodStreams.length > 0) return vodIndex.getSortedAll().slice(0, 24);
    if (vodStreams.length > 0) return vodStreams.slice(0, 24);
    return EMPTY_ARRAY;
  }, [section, vodIndex, allVodStreams.length, vodStreams]);

  const featuredSeries = useMemo(() => {
    if (section === 'movies') return EMPTY_ARRAY;
    if (allSeriesStreams.length > 0) return seriesIndex.getSortedAll().slice(0, 24);
    if (seriesStreams.length > 0) return seriesStreams.slice(0, 24);
    return EMPTY_ARRAY;
  }, [section, seriesIndex, allSeriesStreams.length, seriesStreams]);

  // Live highlights (for 'inicio')
  const liveHighlights = useMemo(() => {
    if (section !== 'inicio') return EMPTY_ARRAY;
    const pool = allLiveStreams.length > 0 ? allLiveStreams : liveStreams;
    return pool.length > 0 ? pool.slice(0, 24) : EMPTY_ARRAY;
  }, [section, allLiveStreams, liveStreams]);

  // Lightweight non-empty category descriptors (O(1) membership check via in-memory index, NO upfront sorting)
  const nonEmptyVodCategoryDescriptors = useMemo(() => {
    if (section === 'series' || allVodStreams.length === 0 || vodCategories.length === 0) {
      return EMPTY_ARRAY;
    }
    const descriptors: Array<{ catId: string; categoryName: string }> = [];
    for (const cat of vodCategories) {
      const catId = String(cat.category_id);
      if (vodIndex.getByCategory(catId).length > 0) {
        descriptors.push({
          catId,
          categoryName: String(cat.category_name || ''),
        });
      }
    }
    return descriptors;
  }, [section, allVodStreams.length, vodCategories, vodIndex]);

  const nonEmptySeriesCategoryDescriptors = useMemo(() => {
    if (section === 'movies' || allSeriesStreams.length === 0 || seriesCategories.length === 0) {
      return EMPTY_ARRAY;
    }
    const descriptors: Array<{ catId: string; categoryName: string }> = [];
    for (const cat of seriesCategories) {
      const catId = String(cat.category_id);
      if (seriesIndex.getByCategory(catId).length > 0) {
        descriptors.push({
          catId,
          categoryName: String(cat.category_name || ''),
        });
      }
    }
    return descriptors;
  }, [section, allSeriesStreams.length, seriesCategories, seriesIndex]);

  // HeroBanner items by domain
  const heroItems = useMemo(() => {
    if (section === 'movies') {
      return getHeroBannerItems(allVodStreams, EMPTY_ARRAY);
    }
    if (section === 'series') {
      return getHeroBannerItems(EMPTY_ARRAY, allSeriesStreams);
    }
    return getHeroBannerItems(allVodStreams, allSeriesStreams);
  }, [section, allVodStreams, allSeriesStreams]);

  // Helper to check if a movie or series has saved progress > 30s
  const canContinueItem = useCallback(
    (item: any): boolean => {
      if (!item) return false;
      const creds = credentialsRef.current;
      const records = historyRecordsRef.current;
      if (isSeriesItem(item)) {
        const sId = String(item.series_id ?? item.stream_id ?? item.id ?? '');
        if (!sId) return false;
        return records.some(
          (r) =>
            r.type === 'episode' &&
            String(r.parentSeriesId) === sId &&
            (r.positionSec ?? 0) > 30
        );
      }
      const mId = item.stream_id ?? item.id;
      if (mId === undefined || mId === null) return false;
      if (getItemProgress(creds, 'movie', mId) > 30) return true;
      return records.some(
        (r) => r.type === 'movie' && String(r.id) === String(mId) && (r.positionSec ?? 0) > 30
      );
    },
    []
  );

  // Lightweight showcase row descriptors (all non-empty categories preserved in provider order; interleaved in 'inicio')
  const showcaseRowDescriptors = useMemo<ShowcaseRowDescriptor[]>(() => {
    const list: ShowcaseRowDescriptor[] = [];

    if (continueWatchingItems.length > 0) {
      list.push({
        key: 'continue_watching',
        title: 'Continuar Assistindo',
        kind: 'fixed',
        fixedItems: continueWatchingItems,
        type: section === 'series' ? 'series' : 'vod',
        virtualize: true,
        isContinueRow: true,
      });
    }

    if (section === 'inicio') {
      if (liveHighlights.length > 0) {
        list.push({
          key: 'live_highlights',
          title: 'Canais Ao Vivo',
          kind: 'fixed',
          fixedItems: liveHighlights,
          type: 'live',
        });
      }
      if (featuredMovies.length > 0) {
        list.push({
          key: 'featured_movies',
          title: 'Filmes em Destaque',
          kind: 'fixed',
          fixedItems: featuredMovies,
          type: 'vod',
        });
      }
      if (featuredSeries.length > 0) {
        list.push({
          key: 'featured_series',
          title: 'Séries em Destaque',
          kind: 'fixed',
          fixedItems: featuredSeries,
          type: 'series',
        });
      }

      const maxCatLen = Math.max(
        nonEmptyVodCategoryDescriptors.length,
        nonEmptySeriesCategoryDescriptors.length
      );
      for (let i = 0; i < maxCatLen; i++) {
        if (i < nonEmptyVodCategoryDescriptors.length) {
          const vodCat = nonEmptyVodCategoryDescriptors[i];
          list.push({
            key: `vod_cat_${vodCat.catId}`,
            title: `Filmes · ${vodCat.categoryName}`,
            type: 'vod',
            kind: 'vod_category',
            categoryId: vodCat.catId,
          });
        }
        if (i < nonEmptySeriesCategoryDescriptors.length) {
          const serCat = nonEmptySeriesCategoryDescriptors[i];
          list.push({
            key: `series_cat_${serCat.catId}`,
            title: `Séries · ${serCat.categoryName}`,
            type: 'series',
            kind: 'series_category',
            categoryId: serCat.catId,
          });
        }
      }
    } else if (section === 'movies') {
      if (domainFavoriteItems.length > 0) {
        list.push({
          key: 'favorite_movies',
          title: 'Filmes Favoritos',
          kind: 'fixed',
          fixedItems: domainFavoriteItems,
          type: 'vod',
          virtualize: true,
        });
      }
      if (featuredMovies.length > 0) {
        list.push({
          key: 'featured_movies',
          title: 'Filmes em Destaque',
          kind: 'fixed',
          fixedItems: featuredMovies,
          type: 'vod',
        });
      }
      for (const vodCat of nonEmptyVodCategoryDescriptors) {
        list.push({
          key: `vod_cat_${vodCat.catId}`,
          title: vodCat.categoryName,
          type: 'vod',
          kind: 'vod_category',
          categoryId: vodCat.catId,
        });
      }
    } else if (section === 'series') {
      if (domainFavoriteItems.length > 0) {
        list.push({
          key: 'favorite_series',
          title: 'Séries Favoritas',
          kind: 'fixed',
          fixedItems: domainFavoriteItems,
          type: 'series',
          virtualize: true,
        });
      }
      if (featuredSeries.length > 0) {
        list.push({
          key: 'featured_series',
          title: 'Séries em Destaque',
          kind: 'fixed',
          fixedItems: featuredSeries,
          type: 'series',
        });
      }
      for (const serCat of nonEmptySeriesCategoryDescriptors) {
        list.push({
          key: `series_cat_${serCat.catId}`,
          title: serCat.categoryName,
          type: 'series',
          kind: 'series_category',
          categoryId: serCat.catId,
        });
      }
    }

    return list;
  }, [
    section,
    continueWatchingItems,
    liveHighlights,
    featuredMovies,
    featuredSeries,
    domainFavoriteItems,
    nonEmptyVodCategoryDescriptors,
    nonEmptySeriesCategoryDescriptors,
  ]);

  const dynamicCategoryRowCount =
    section === 'inicio'
      ? nonEmptyVodCategoryDescriptors.length + nonEmptySeriesCategoryDescriptors.length
      : section === 'movies'
        ? nonEmptyVodCategoryDescriptors.length
        : nonEmptySeriesCategoryDescriptors.length;

  // Search state
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const hasSearch = normalizedQuery.length > 0;
  const isGridMode = section !== 'inicio' && (activeCategoryId !== null || hasSearch);

  const totalShowcaseRows = showcaseRowDescriptors.length;
  const shouldVirtualizeShowcaseRows =
    dynamicCategoryRowCount > 7 || totalShowcaseRows > 11;
  const maxRowWindowStart = shouldVirtualizeShowcaseRows
    ? Math.max(0, totalShowcaseRows - SHOWCASE_ROW_WINDOW_SIZE)
    : 0;

  const getRowSlotHeight = useCallback(
    (rowIndex: number): number => {
      const measured = measuredRowHeightsRef.current.get(rowIndex);
      if (typeof measured === 'number' && measured > 0) {
        return measured;
      }
      return estimateShowcaseRowSlotHeight(
        showcaseRowDescriptors[rowIndex],
        liveViewportWidth
      );
    },
    [showcaseRowDescriptors, liveViewportWidth]
  );

  const measureMountedShowcaseGeometry = useCallback((): void => {
    const mainEl = mainContainerRef.current;
    const rowsContainerEl = showcaseRowsContainerRef.current;
    if (!mainEl || !rowsContainerEl) return;

    const mainRect = mainEl.getBoundingClientRect();
    const scrollTop = mainEl.scrollTop || 0;
    const topSpacerEl = rowsContainerEl.querySelector<HTMLElement>(
      '[data-showcase-row-spacer="top"]'
    );
    const currentTopSpacerPx = topSpacerEl
      ? parseFloat(topSpacerEl.style.height || '0') || 0
      : 0;

    const mountedWrappers = rowsContainerEl.querySelectorAll<HTMLElement>(
      '[data-home-row-index]'
    );

    if (mountedWrappers.length > 0) {
      const firstWrapper = mountedWrappers[0];
      const firstBlock =
        firstWrapper.closest<HTMLElement>('[data-scroll-block="true"]') ||
        firstWrapper;
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
        const offsetFromContainer = Math.round(
          containerRect.top - mainRect.top + scrollTop
        );
        if (offsetFromContainer >= 0) {
          measuredRowsStartOffsetRef.current = offsetFromContainer;
        }
      } else {
        const heroEl = mainEl.querySelector<HTMLElement>(
          '[data-hero-stage="true"]'
        );
        if (heroEl) {
          const heroRect = heroEl.getBoundingClientRect();
          if (heroRect.height > 0) {
            const marginPlusGap = liveViewportWidth >= 640 ? 32 : 24;
            measuredRowsStartOffsetRef.current = Math.round(
              Math.max(0, heroRect.top - mainRect.top + scrollTop) +
                heroRect.height +
                marginPlusGap
            );
          }
        }
      }
    }

    for (let i = 0; i < mountedWrappers.length; i++) {
      const wrapper = mountedWrappers[i];
      const rIdx = parseInt(
        wrapper.getAttribute('data-home-row-index') || '-1',
        10
      );
      if (isNaN(rIdx) || rIdx < 0) continue;
      const scrollBlock =
        wrapper.closest<HTMLElement>('[data-scroll-block="true"]') || wrapper;
      const rect = scrollBlock.getBoundingClientRect();
      const rawHeight = rect.height > 0 ? rect.height : scrollBlock.offsetHeight;
      if (typeof rawHeight === 'number' && rawHeight > 0) {
        measuredRowHeightsRef.current.set(rIdx, Math.round(rawHeight));
      }
    }
  }, [liveViewportWidth]);

  const computeShowcaseRowStartFromScroll = useCallback(
    (scrollTop: number, currentWindowStart?: number): number => {
      if (!shouldVirtualizeShowcaseRows || totalShowcaseRows <= SHOWCASE_ROW_WINDOW_SIZE) {
        return 0;
      }
      const rowsStartOffsetPx =
        measuredRowsStartOffsetRef.current ??
        estimateShowcaseRowsStartOffset(
          heroItems.length > 0,
          liveViewportWidth,
          liveViewportHeight
        );
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
      const rawDesired = Math.max(
        0,
        Math.min(maxRowWindowStart, firstVisibleRow - 1)
      );

      if (typeof currentWindowStart !== 'number') {
        return rawDesired;
      }

      const clampedCurrent = Math.max(
        0,
        Math.min(maxRowWindowStart, currentWindowStart)
      );
      if (rawDesired === clampedCurrent) {
        return clampedCurrent;
      }

      if (rawDesired > clampedCurrent) {
        const downRow = findRowAtOffset(
          Math.max(0, relativeTop - SHOWCASE_SCROLL_HYSTERESIS_PX)
        );
        const downDesired = Math.max(
          0,
          Math.min(maxRowWindowStart, downRow - 1)
        );
        return Math.max(clampedCurrent, downDesired);
      }

      if (scrollTop <= 0) {
        return 0;
      }
      const upRow = findRowAtOffset(relativeTop + SHOWCASE_SCROLL_HYSTERESIS_PX);
      const upDesired = Math.max(0, Math.min(maxRowWindowStart, upRow - 1));
      return Math.min(clampedCurrent, upDesired);
    },
    [
      shouldVirtualizeShowcaseRows,
      totalShowcaseRows,
      heroItems.length,
      liveViewportWidth,
      liveViewportHeight,
      getRowSlotHeight,
      maxRowWindowStart,
    ]
  );

  // Capture the current scrollTop before replacing the origin screen with search results,
  // including when the search starts from "Ver todos" or a category grid.
  // Save and restore the showcase row window ONLY when the search starts from the showcase.
  if (hasSearch && !wasSearchingRef.current) {
    wasSearchingRef.current = true;
    const liveScrollTop = mainContainerRef.current ? mainContainerRef.current.scrollTop : 0;
    preSearchScrollTopRef.current = liveScrollTop;
    const startedFromShowcase = section === 'inicio' || activeCategoryId === null;
    if (startedFromShowcase) {
      const computedStartFromScroll =
        shouldVirtualizeShowcaseRows && liveScrollTop > 0
          ? computeShowcaseRowStartFromScroll(liveScrollTop)
          : 0;
      preSearchRowWindowStartRef.current =
        rowWindowStartRef.current > 0 ? rowWindowStartRef.current : computedStartFromScroll;
    } else {
      preSearchRowWindowStartRef.current = null;
    }
  }

  // When closing search, restore the showcase row window first (only if search started from the showcase),
  // and then restore scrollTop in useLayoutEffect once the origin screen is mounted.
  let activeRowWindowStart = rowWindowStart;
  if (
    !hasSearch &&
    wasSearchingRef.current &&
    preSearchRowWindowStartRef.current !== null &&
    (section === 'inicio' || activeCategoryId === null)
  ) {
    activeRowWindowStart = Math.max(
      0,
      Math.min(preSearchRowWindowStartRef.current, maxRowWindowStart)
    );
    rowWindowStartRef.current = activeRowWindowStart;
    if (rowWindowStart !== activeRowWindowStart) {
      setRowWindowStart(activeRowWindowStart);
    }
  }

  const effectiveRowStart = shouldVirtualizeShowcaseRows
    ? Math.max(0, Math.min(activeRowWindowStart, maxRowWindowStart))
    : 0;
  const effectiveRowEnd = shouldVirtualizeShowcaseRows
    ? Math.min(totalShowcaseRows, effectiveRowStart + SHOWCASE_ROW_WINDOW_SIZE)
    : totalShowcaseRows;

  // Compute cumulative row offsets using the same geometry for mounted rows and reserved spacers
  const showcaseRowOffsets = new Array<number>(totalShowcaseRows + 1);
  showcaseRowOffsets[0] = 0;
  for (let i = 0; i < totalShowcaseRows; i++) {
    showcaseRowOffsets[i + 1] = showcaseRowOffsets[i] + getRowSlotHeight(i);
  }

  const topShowcaseSpacerPx = shouldVirtualizeShowcaseRows
    ? showcaseRowOffsets[effectiveRowStart] || 0
    : 0;
  const bottomShowcaseSpacerPx = shouldVirtualizeShowcaseRows
    ? Math.max(
        0,
        (showcaseRowOffsets[totalShowcaseRows] || 0) -
          (showcaseRowOffsets[effectiveRowEnd] || 0)
      )
    : 0;

  // Prepare and sort category preview items ONLY for rows inside the currently mounted window
  const mountedShowcaseRows = useMemo(() => {
    const slice = showcaseRowDescriptors.slice(effectiveRowStart, effectiveRowEnd);
    return slice.map((desc, offset) => {
      const rowIndex = effectiveRowStart + offset;
      let items: any[] = desc.fixedItems || EMPTY_ARRAY;
      if (desc.kind === 'vod_category' && desc.categoryId) {
        items = vodIndex.getSortedByCategory(desc.categoryId).slice(0, 24);
      } else if (desc.kind === 'series_category' && desc.categoryId) {
        items = seriesIndex.getSortedByCategory(desc.categoryId).slice(0, 24);
      }
      return {
        ...desc,
        rowIndex,
        items,
        reservedHeightPx: getRowSlotHeight(rowIndex),
      };
    });
  }, [
    showcaseRowDescriptors,
    effectiveRowStart,
    effectiveRowEnd,
    vodIndex,
    seriesIndex,
    getRowSlotHeight,
  ]);

  // Keep DOM measurements of mounted showcase rows and HeroBanner offset up to date
  useLayoutEffect(() => {
    if (isGridMode || (section === 'inicio' && hasSearch) || totalShowcaseRows === 0) {
      return;
    }
    measureMountedShowcaseGeometry();
  }, [
    isGridMode,
    section,
    hasSearch,
    totalShowcaseRows,
    effectiveRowStart,
    effectiveRowEnd,
    liveViewportWidth,
    measureMountedShowcaseGeometry,
  ]);

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

      const curEnd = Math.min(totalShowcaseRows, curStart + SHOWCASE_ROW_WINDOW_SIZE);
      const nextEnd = Math.min(totalShowcaseRows, clampedDesired + SHOWCASE_ROW_WINDOW_SIZE);
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

  // Synchronously shift vertical showcase row window when navigating by D-Pad or restoring details origin
  const ensureShowcaseRowMounted = useCallback(
    (targetRowIndex: number, preserveRowIndex?: number): boolean => {
      isDpadShowcaseNavActiveRef.current = true;
      if (!shouldVirtualizeShowcaseRows || totalShowcaseRows <= SHOWCASE_ROW_WINDOW_SIZE) {
        return false;
      }
      const clampedTarget = Math.max(
        0,
        Math.min(totalShowcaseRows - 1, Math.floor(targetRowIndex))
      );
      const curStart = Math.max(0, Math.min(rowWindowStartRef.current, maxRowWindowStart));
      const curEnd = Math.min(totalShowcaseRows, curStart + SHOWCASE_ROW_WINDOW_SIZE);

      const hasTopMargin = curStart === 0 || clampedTarget >= curStart + 1;
      const hasBottomMargin =
        curEnd >= totalShowcaseRows || clampedTarget < curEnd - 1;

      if (
        clampedTarget >= curStart &&
        clampedTarget < curEnd &&
        hasTopMargin &&
        hasBottomMargin
      ) {
        return false;
      }

      let desiredStart = Math.max(
        0,
        Math.min(
          maxRowWindowStart,
          clampedTarget - Math.floor(SHOWCASE_ROW_WINDOW_SIZE / 2)
        )
      );

      if (
        typeof preserveRowIndex === 'number' &&
        preserveRowIndex >= 0 &&
        preserveRowIndex < totalShowcaseRows &&
        Math.abs(clampedTarget - preserveRowIndex) < SHOWCASE_ROW_WINDOW_SIZE
      ) {
        if (desiredStart > preserveRowIndex) {
          desiredStart = preserveRowIndex;
        } else if (desiredStart + SHOWCASE_ROW_WINDOW_SIZE - 1 < preserveRowIndex) {
          desiredStart = preserveRowIndex - SHOWCASE_ROW_WINDOW_SIZE + 1;
        }
        if (desiredStart > clampedTarget) {
          desiredStart = clampedTarget;
        } else if (desiredStart + SHOWCASE_ROW_WINDOW_SIZE - 1 < clampedTarget) {
          desiredStart = clampedTarget - SHOWCASE_ROW_WINDOW_SIZE + 1;
        }
        desiredStart = Math.max(0, Math.min(maxRowWindowStart, desiredStart));
      }

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

  const latestShowcaseControllerRef = useRef<{
    totalRows: number;
    ensureRowMounted: (targetRowIndex: number, preserveRowIndex?: number) => boolean;
  }>({
    totalRows: totalShowcaseRows,
    ensureRowMounted: ensureShowcaseRowMounted,
  });
  latestShowcaseControllerRef.current = {
    totalRows: totalShowcaseRows,
    ensureRowMounted: ensureShowcaseRowMounted,
  };

  // Bind showcase row controller directly to the mounted DOM node so recreating the element
  // (e.g. closing search or returning from Ver todos / category) unregisters the old node and registers the new one.
  const showcaseRowsContainerCallbackRef = useCallback((node: HTMLDivElement | null) => {
    const prevNode = registeredShowcaseContainerRef.current;
    if (prevNode && prevNode !== node) {
      unregisterShowcaseRowController(prevNode);
      registeredShowcaseContainerRef.current = null;
    }
    showcaseRowsContainerRef.current = node;
    if (node && latestShowcaseControllerRef.current.totalRows > 0) {
      registerShowcaseRowController(node, {
        totalRows: latestShowcaseControllerRef.current.totalRows,
        ensureRowMounted: (targetRowIndex: number, preserveRowIndex?: number) =>
          latestShowcaseControllerRef.current.ensureRowMounted(targetRowIndex, preserveRowIndex),
      });
      registeredShowcaseContainerRef.current = node;
    }
  }, []);

  // Update showcase row controller when totalShowcaseRows or ensureShowcaseRowMounted changes while mounted
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

  useEffect(() => {
    return () => {
      if (registeredShowcaseContainerRef.current) {
        unregisterShowcaseRowController(registeredShowcaseContainerRef.current);
        registeredShowcaseContainerRef.current = null;
      }
    };
  }, []);

  // Capture origin before opening MovieDetails / SeriesDetails
  const captureOriginBeforeDetails = useCallback((item?: any, explicitCardEl?: HTMLElement | null) => {
    if (mainContainerRef.current) {
      savedScrollTopRef.current = mainContainerRef.current.scrollTop;
    }

    if (explicitCardEl) {
      const k = explicitCardEl.getAttribute('data-virtual-key');
      if (k) lastOpenedGridKeyRef.current = k;
    } else if (item) {
      const itemId = item.stream_id ?? item.series_id ?? item.id;
      if (itemId !== undefined && itemId !== null) {
        lastOpenedGridKeyRef.current = String(itemId);
      }
    }

    const activeEl =
      explicitCardEl ||
      (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    const rowEl = activeEl ? activeEl.closest<HTMLElement>('[data-nav-row="true"]') : null;
    const homeRowWrapper = activeEl ? activeEl.closest<HTMLElement>('[data-home-row-index]') : null;
    const parsedHomeRowIdx = homeRowWrapper?.hasAttribute('data-home-row-index')
      ? parseInt(homeRowWrapper.getAttribute('data-home-row-index') || '-1', 10)
      : -1;
    const cardEl = activeEl
      ? activeEl.closest<HTMLElement>('[data-nav-item="true"]') || activeEl
      : null;
    const parsedCardIdx = cardEl?.hasAttribute('data-row-card-index')
      ? parseInt(cardEl.getAttribute('data-row-card-index') || '-1', 10)
      : -1;

    lastShowcaseOriginRef.current = {
      rowContainer: rowEl,
      rowScrollLeft: rowEl ? rowEl.scrollLeft : 0,
      homeRowIndex: !isNaN(parsedHomeRowIdx) && parsedHomeRowIdx >= 0 ? parsedHomeRowIdx : null,
      rowCardIndex: !isNaN(parsedCardIdx) && parsedCardIdx >= 0 ? parsedCardIdx : null,
      virtualKey:
        cardEl?.getAttribute('data-virtual-key') ||
        cardEl?.getAttribute('data-row-item-key') ||
        (item?.rowKey ? String(item.rowKey) : null),
      virtualIndex: cardEl?.hasAttribute('data-virtual-index')
        ? parseInt(cardEl.getAttribute('data-virtual-index') || '-1', 10)
        : null,
      cardElement: cardEl,
    };
  }, []);

  const restoreOriginAfterDetails = useCallback(() => {
    const savedScroll = savedScrollTopRef.current;
    const originSnapshot = lastShowcaseOriginRef.current;
    const gridKey = lastOpenedGridKeyRef.current;

    const applyRestore = () => {
      if (
        originSnapshot &&
        originSnapshot.homeRowIndex !== null &&
        originSnapshot.homeRowIndex >= 0
      ) {
        ensureShowcaseRowMounted(originSnapshot.homeRowIndex, originSnapshot.homeRowIndex);
      }

      if (mainContainerRef.current && savedScroll !== null) {
        isProgrammaticRowShiftRef.current = true;
        try {
          mainContainerRef.current.scrollTop = savedScroll;
        } finally {
          isProgrammaticRowShiftRef.current = false;
        }
      }

      // If currently in virtualized grid mode (or Início search grid), restore virtual grid card
      const activeGridRoot = gridContainerRef.current || mainContainerRef.current;
      if (activeGridRoot && gridKey) {
        const safeKey =
          typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
            ? CSS.escape(gridKey)
            : gridKey.replace(/"/g, '\\"');
        const gridEl = activeGridRoot.querySelector<HTMLElement>(
          `[data-nav-grid="true"] [data-virtual-key="${safeKey}"]`
        );
        if (gridEl && gridEl.isConnected) {
          focusElementSafely(gridEl);
          if (mainContainerRef.current && savedScroll !== null) {
            mainContainerRef.current.scrollTop = savedScroll;
          }
          return true;
        }
      }

      if (!originSnapshot) return false;
      const {
        rowContainer,
        rowScrollLeft,
        homeRowIndex,
        rowCardIndex,
        virtualKey,
        cardElement,
      } = originSnapshot;

      const resolvedRowEl =
        rowContainer && rowContainer.isConnected
          ? rowContainer
          : homeRowIndex !== null && mainContainerRef.current
            ? mainContainerRef.current.querySelector<HTMLElement>(
                `[data-home-row-index="${homeRowIndex}"] [data-nav-row="true"]`
              )
            : null;

      if (resolvedRowEl && resolvedRowEl.isConnected) {
        resolvedRowEl.scrollLeft = rowScrollLeft;
        if (resolvedRowEl.getAttribute('data-virtual-container') === 'true' && virtualKey) {
          const restoredEl = restoreVirtualItemByKey(resolvedRowEl, virtualKey, rowScrollLeft);
          if (restoredEl) {
            if (mainContainerRef.current && savedScroll !== null) {
              mainContainerRef.current.scrollTop = savedScroll;
            }
            return true;
          }
        }

        const resolvedCardEl =
          cardElement && cardElement.isConnected
            ? cardElement
            : (rowCardIndex !== null
                ? resolvedRowEl.querySelector<HTMLElement>(
                    `[data-row-card-index="${rowCardIndex}"]`
                  )
                : null) ||
              resolvedRowEl.querySelector<HTMLElement>('[data-nav-item="true"]');

        if (resolvedCardEl && resolvedCardEl.isConnected) {
          try {
            resolvedCardEl.focus({ preventScroll: true });
          } catch {
            resolvedCardEl.focus();
          }
          if (mainContainerRef.current && savedScroll !== null) {
            mainContainerRef.current.scrollTop = savedScroll;
          }
          resolvedRowEl.scrollLeft = rowScrollLeft;
          return document.activeElement === resolvedCardEl;
        }
      }

      if (cardElement && cardElement.isConnected) {
        focusElementSafely(cardElement);
        if (mainContainerRef.current && savedScroll !== null) {
          mainContainerRef.current.scrollTop = savedScroll;
        }
        return document.activeElement === cardElement;
      }

      return false;
    };

    if (!applyRestore()) {
      setTimeout(() => {
        applyRestore();
      }, 0);
    }
  }, [ensureShowcaseRowMounted]);

  const handleCloseMovieDetails = useCallback(() => {
    setSelectedMovie(null);
    restoreOriginAfterDetails();
  }, [restoreOriginAfterDetails]);

  const handleCloseSeriesDetails = useCallback(() => {
    setSelectedSeries(null);
    restoreOriginAfterDetails();
  }, [restoreOriginAfterDetails]);

  // Open details modal for Movie or Series
  const handleSelectItem = useCallback(
    (item: any, explicitCardEl?: HTMLElement | null) => {
      if (!item) return;
      captureOriginBeforeDetails(item, explicitCardEl);
      if (isSeriesItem(item)) {
        setSelectedSeries(item);
      } else {
        setSelectedMovie(item);
      }
    },
    [captureOriginBeforeDetails]
  );

  // Direct Play / Resume from HeroBanner ("Assistir" or "Continuar")
  const handleHeroPlay = useCallback(
    (item: any, detailsResponse?: any): void | Promise<void> => {
      if (!item) return;
      const creds = credentialsRef.current;
      const playFn = onPlayRef.current;
      const records = historyRecordsRef.current;

      if (isSeriesItem(item)) {
        const sId = String(item.series_id ?? item.stream_id ?? item.id ?? '');
        const latestEpisodeRecord = records.find(
          (r) =>
            r.type === 'episode' &&
            String(r.parentSeriesId) === sId &&
            (r.positionSec ?? 0) > 30
        );

        const executeConfirmedSeriesPlay = (resolvedDetails: any) => {
          const episodesMap = resolvedDetails?.episodes || item?.episodes;

          if (latestEpisodeRecord) {
            if (
              episodesMap &&
              typeof episodesMap === 'object' &&
              creds?.serverUrl &&
              creds?.username &&
              creds?.password
            ) {
              let foundEp: any = null;
              let foundSeasonKey = '1';
              for (const seasonKey of Object.keys(episodesMap)) {
                const seasonList = episodesMap[seasonKey];
                if (Array.isArray(seasonList)) {
                  const match = seasonList.find(
                    (ep: any) =>
                      String(ep.id ?? ep.stream_id) === String(latestEpisodeRecord.id)
                  );
                  if (match) {
                    foundEp = match;
                    foundSeasonKey = seasonKey;
                    break;
                  }
                }
              }

              if (foundEp) {
                const confirmedExt =
                  typeof foundEp.container_extension === 'string'
                    ? foundEp.container_extension.trim().replace(/^\.+/, '')
                    : '';
                if (/^[a-z0-9]+$/i.test(confirmedExt)) {
                  const epNum = String(foundEp.episode_num || 1).padStart(2, '0');
                  const sNum = String(foundSeasonKey).padStart(2, '0');
                  const epTitle = `${item.name || item.title} - S${sNum}E${epNum} - ${foundEp.title || `Episódio ${foundEp.episode_num || 1}`}`;
                  const directUrl = buildDirectMediaUrl(creds, {
                    type: 'series',
                    streamId: latestEpisodeRecord.id,
                    containerExtension: confirmedExt,
                  });
                  if (directUrl) {
                    playFn(
                      directUrl,
                      epTitle,
                      latestEpisodeRecord.positionSec,
                      latestEpisodeRecord.id,
                      'episode'
                    );
                    return;
                  }
                }
              }
            }

            // Se não for possível confirmar o episódio salvo ou uma extensão válida nos metadados,
            // encaminhar para os detalhes sem iniciar outro episódio e sem chutar extensão
            handleSelectItem(item);
            return;
          }

          if (episodesMap && typeof episodesMap === 'object' && creds?.serverUrl) {
            const seasons = Object.keys(episodesMap);
            if (seasons.length > 0) {
              const firstSeasonList = episodesMap[seasons[0]];
              if (Array.isArray(firstSeasonList) && firstSeasonList.length > 0) {
                const firstEp = firstSeasonList[0];
                const epId = firstEp.id ?? firstEp.stream_id;
                const epExt =
                  String(firstEp.container_extension || '')
                    .trim()
                    .replace(/^\./, '') || 'mp4';
                const directUrl = buildDirectMediaUrl(creds, {
                  type: 'series',
                  streamId: epId,
                  containerExtension: epExt,
                });
                if (directUrl) {
                  const sNum = String(seasons[0]).padStart(2, '0');
                  const epNum = String(firstEp.episode_num || 1).padStart(2, '0');
                  const epTitle = `${item.name || item.title} - S${sNum}E${epNum} - ${firstEp.title || 'Episódio 1'}`;
                  playFn(directUrl, epTitle, 0, epId, 'episode');
                  return;
                }
              }
            }
          }

          handleSelectItem(item);
        };

        const existingEpisodesMap = detailsResponse?.episodes || item?.episodes;
        if (existingEpisodesMap && typeof existingEpisodesMap === 'object') {
          executeConfirmedSeriesPlay(detailsResponse);
          return;
        }

        if (!creds?.serverUrl || !creds?.username || !creds?.password) {
          handleSelectItem(item);
          return;
        }

        if (heroPlayInFlightRef.current) {
          return;
        }

        const sessionAtClick = heroPlaySessionRef.current;
        const sectionAtClick = activeSectionRef.current;
        const serverAtClick = creds.serverUrl;
        const userAtClick = creds.username;
        heroPlayInFlightRef.current = true;

        return (async () => {
          try {
            const fetchedDetails = await fetchOrReuseHeroDetails(creds, item);
            if (
              !isMountedRef.current ||
              heroPlaySessionRef.current !== sessionAtClick ||
              activeSectionRef.current !== sectionAtClick ||
              credentialsRef.current?.serverUrl !== serverAtClick ||
              credentialsRef.current?.username !== userAtClick
            ) {
              return;
            }
            executeConfirmedSeriesPlay(fetchedDetails);
          } finally {
            heroPlayInFlightRef.current = false;
          }
        })();
      }

      // Movie direct play / resume
      const movieId = item.stream_id ?? item.id;
      if (creds?.serverUrl && creds?.username && creds?.password && movieId !== undefined) {
        const ext =
          detailsResponse?.movie_data?.container_extension ||
          item.container_extension ||
          'mp4';
        const directUrl = buildDirectMediaUrl(creds, {
          type: 'movie',
          streamId: movieId,
          containerExtension: ext,
        });
        if (directUrl) {
          const savedSec = getItemProgress(creds, 'movie', movieId);
          const recordSec =
            records.find((r) => r.type === 'movie' && String(r.id) === String(movieId))
              ?.positionSec ?? 0;
          const resumeSec = Math.max(savedSec, recordSec);
          playFn(
            directUrl,
            item.name || item.title || 'Filme',
            resumeSec > 30 ? resumeSec : 0,
            movieId,
            'movie'
          );
          return;
        }
      }

      handleSelectItem(item);
    },
    [handleSelectItem]
  );

  // Live channel click handler in 'inicio'
  const handleLiveChannelClick = useCallback((stream: any) => {
    if (!stream) return;
    if (onSelectLiveChannelRef.current) {
      onSelectLiveChannelRef.current(stream);
      return;
    }
    const creds = credentialsRef.current;
    if (!creds?.serverUrl || !creds?.username || !creds?.password || stream.stream_id === undefined) {
      setPlayError(
        `Não foi possível reproduzir "${stream.name || 'Canal'}": dados de conexão ou ID ausentes.`
      );
      return;
    }
    const ext = stream.container_extension || 'm3u8';
    const url = buildDirectMediaUrl(creds, {
      type: 'live',
      streamId: stream.stream_id,
      containerExtension: ext,
      allowedOutputFormats: creds.allowed_output_formats,
    });
    if (!url) {
      setPlayError(
        `Não foi possível reproduzir "${stream.name || 'Canal'}": dados de conexão ou ID ausentes.`
      );
      return;
    }
    setPlayError(null);
    onPlayRef.current(
      url,
      stream.name || stream.title || 'Canal ao Vivo',
      0,
      stream.stream_id,
      'live',
      stream.name || stream.title
    );
  }, []);

  // Reset scrollTop when entering search; when closing search, restore scrollTop after the origin screen is mounted
  useLayoutEffect(() => {
    if (hasSearch) {
      if (mainContainerRef.current) {
        isProgrammaticRowShiftRef.current = true;
        try {
          mainContainerRef.current.scrollTop = 0;
        } finally {
          isProgrammaticRowShiftRef.current = false;
        }
      }
    } else if (wasSearchingRef.current) {
      wasSearchingRef.current = false;
      const savedPreSearchRowStart = preSearchRowWindowStartRef.current;
      preSearchRowWindowStartRef.current = null;
      if (
        savedPreSearchRowStart !== null &&
        (section === 'inicio' || activeCategoryId === null) &&
        savedPreSearchRowStart !== rowWindowStartRef.current
      ) {
        isProgrammaticRowShiftRef.current = true;
        rowWindowStartRef.current = savedPreSearchRowStart;
        try {
          flushSync(() => {
            setRowWindowStart(savedPreSearchRowStart);
          });
        } catch {
          setRowWindowStart(savedPreSearchRowStart);
        } finally {
          isProgrammaticRowShiftRef.current = false;
        }
      }
      const savedPreSearch = preSearchScrollTopRef.current;
      if (mainContainerRef.current && savedPreSearch !== null) {
        isProgrammaticRowShiftRef.current = true;
        try {
          mainContainerRef.current.scrollTop = savedPreSearch;
        } finally {
          isProgrammaticRowShiftRef.current = false;
        }
      }
    }
  }, [hasSearch, section, activeCategoryId]);

  // Domain categories for 'movies' / 'series'
  const realCategories = section === 'movies' ? vodCategories : seriesCategories;
  const isCategoriesLoading =
    section === 'movies'
      ? vodCategoriesStatus === 'loading' || (loadingVod && vodCategories.length === 0)
      : section === 'series'
        ? seriesCategoriesStatus === 'loading' || (loadingSeries && seriesCategories.length === 0)
        : false;
  const isCatalogLoading =
    section === 'movies'
      ? vodCatalogStatus === 'loading' || loadingVod
      : section === 'series'
        ? seriesCatalogStatus === 'loading' || loadingSeries
        : loadingVod || loadingSeries || loadingLive;

  const domainCategoriesError =
    section === 'movies' ? vodCategoriesError : section === 'series' ? seriesCategoriesError : null;
  const domainCatalogError =
    section === 'movies' ? vodError : section === 'series' ? seriesError : null;

  const handleRetryDomain = useCallback(async () => {
    setIsRetryingDomain(true);
    try {
      if (section === 'movies') {
        const tasks: Promise<any>[] = [];
        if (vodCategoriesStatus === 'error' || vodCategoriesError) {
          if (fetchVodCategories) tasks.push(fetchVodCategories());
        }
        if (vodCatalogStatus === 'error' || vodError || tasks.length === 0) {
          if (fetchVodStreams) tasks.push(fetchVodStreams());
        }
        await Promise.all(tasks);
      } else if (section === 'series') {
        const tasks: Promise<any>[] = [];
        if (seriesCategoriesStatus === 'error' || seriesCategoriesError) {
          if (fetchSeriesCategories) tasks.push(fetchSeriesCategories());
        }
        if (seriesCatalogStatus === 'error' || seriesError || tasks.length === 0) {
          if (fetchSeriesStreams) tasks.push(fetchSeriesStreams());
        }
        await Promise.all(tasks);
      }
    } finally {
      setIsRetryingDomain(false);
    }
  }, [
    section,
    vodCategoriesStatus,
    vodCategoriesError,
    vodCatalogStatus,
    vodError,
    fetchVodCategories,
    fetchVodStreams,
    seriesCategoriesStatus,
    seriesCategoriesError,
    seriesCatalogStatus,
    seriesError,
    fetchSeriesCategories,
    fetchSeriesStreams,
  ]);

  // Active category label
  const activeCategoryLabel = useMemo(() => {
    if (!activeCategoryId) return null;
    const virtualMatch = VIRTUAL_CATEGORIES.find((vc) => vc.category_id === activeCategoryId);
    if (virtualMatch) return virtualMatch.category_name;
    const realMatch = realCategories.find(
      (c: any) => String(c.category_id) === String(activeCategoryId)
    );
    return realMatch ? realMatch.category_name : 'Categoria';
  }, [activeCategoryId, realCategories]);

  // Select category or return to showcase
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
        if (getNavMode() === 'remote' && categoriesTriggerRef.current) {
          setTimeout(() => {
            if (categoriesTriggerRef.current) {
              focusElementSafely(categoriesTriggerRef.current);
            }
          }, 0);
        }
        return;
      }

      const isSameCategory = activeCategoryId === catId;
      setActiveCategoryId(catId);
      if (!isSameCategory) {
        if (mainContainerRef.current) {
          mainContainerRef.current.scrollTop = 0;
        }
        savedScrollTopRef.current = 0;
      }

      // Support legacy mock contexts where allVodStreams / allSeriesStreams is empty and fetchVodStreams(catId) populates vodStreams
      if (
        catId !== 'all' &&
        catId !== 'nc_recent' &&
        catId !== 'nc_fav'
      ) {
        if (section === 'movies' && allVodStreams.length === 0 && fetchVodStreams) {
          fetchVodStreams(catId).catch(() => {});
        } else if (section === 'series' && allSeriesStreams.length === 0 && fetchSeriesStreams) {
          fetchSeriesStreams(catId).catch(() => {});
        }
      }

      if (getNavMode() === 'remote' && categoriesTriggerRef.current) {
        setTimeout(() => {
          if (categoriesTriggerRef.current) {
            focusElementSafely(categoriesTriggerRef.current);
          }
        }, 0);
      }
    },
    [
      activeCategoryId,
      section,
      allVodStreams.length,
      allSeriesStreams.length,
      fetchVodStreams,
      fetchSeriesStreams,
    ]
  );

  // Focus active item when Categories menu opens
  useEffect(() => {
    if (!isCategoriesMenuOpen) return;
    const menuEl = categoriesMenuRef.current;
    if (!menuEl) return;
    const targetBtn =
      menuEl.querySelector<HTMLButtonElement>('button[data-category-selected="true"]') ||
      menuEl.querySelector<HTMLButtonElement>('button[data-category-id="all"]') ||
      menuEl.querySelector<HTMLButtonElement>('button[data-category-id]');
    if (targetBtn) {
      focusElementSafely(targetBtn);
    }
  }, [isCategoriesMenuOpen]);

  // Close Categories menu on outside pointerdown
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

  // Back handler 1: Close Categories dropdown menu (BACK_PRIORITY.CATEGORY_MENU)
  useBackHandler(
    `showcase-categories-menu-${section}`,
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

  // Back handler 2: Exit filtered grid back to Showcase (BACK_PRIORITY.VIEW_INTERNAL)
  useBackHandler(
    `showcase-filtered-grid-${section}`,
    BACK_PRIORITY.VIEW_INTERNAL,
    () => {
      if (
        section !== 'inicio' &&
        activeCategoryId !== null &&
        !hasSearch &&
        !selectedMovie &&
        !selectedSeries
      ) {
        rowWindowStartRef.current = 0;
        setRowWindowStart(0);
        setActiveCategoryId(null);
        if (mainContainerRef.current) {
          mainContainerRef.current.scrollTop = 0;
        }
        setTimeout(() => {
          if (categoriesTriggerRef.current && isElementFocusable(categoriesTriggerRef.current)) {
            focusElementSafely(categoriesTriggerRef.current);
          }
        }, 0);
        return true;
      }
      return false;
    },
    section !== 'inicio' &&
      activeCategoryId !== null &&
      !hasSearch &&
      !selectedMovie &&
      !selectedSeries
  );

  // Sync vertical showcase row window on manual scroll (touch, mouse wheel, or scrollbar).
  // Manual scroll leaves scrollTop under browser control during touch gestures and inertia:
  // it NEVER writes to scrollTop, calls scrollTo/scrollIntoView, or moves focus.
  useEffect(() => {
    const mainEl = mainContainerRef.current;
    if (
      !mainEl ||
      isGridMode ||
      (section === 'inicio' && hasSearch) ||
      !shouldVirtualizeShowcaseRows
    ) {
      isDpadShowcaseNavActiveRef.current = false;
      lastManualScrollTopRef.current = null;
      return;
    }

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

    const handleShowcaseScroll = () => {
      if (isProgrammaticRowShiftRef.current) return;
      // While D-Pad vertical navigation owns showcase row transitions, ignore scroll events
      // (including intermediate scrollTop positions from unfinished scroll animations)
      // so the focused row is never unmounted by an intermediate scroll event.
      if (isDpadShowcaseNavActiveRef.current) return;

      measureMountedShowcaseGeometry();

      const currentScrollTop = Math.max(0, mainEl.scrollTop || 0);
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
    mainEl.addEventListener('scroll', handleShowcaseScroll, { passive: true });
    return () => {
      window.removeEventListener('keydown', onShowcaseKeyDown, true);
      mainEl.removeEventListener('wheel', releaseDpadScrollControl);
      mainEl.removeEventListener('touchstart', releaseDpadScrollControl);
      mainEl.removeEventListener('touchmove', releaseDpadScrollControl);
      mainEl.removeEventListener('pointerdown', releaseDpadScrollControl);
      mainEl.removeEventListener('mousedown', releaseDpadScrollControl);
      mainEl.removeEventListener('scroll', handleShowcaseScroll);
    };
  }, [
    isGridMode,
    section,
    hasSearch,
    shouldVirtualizeShowcaseRows,
    maxRowWindowStart,
    computeShowcaseRowStartFromScroll,
    measureMountedShowcaseGeometry,
  ]);

  // Keyboard navigation inside Categories menu
  const handleCategoriesMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
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
  };

  // Filtered items for Grid Mode in 'movies' and 'series'
  const displayedGridItems = useMemo(() => {
    if (section === 'inicio') return EMPTY_ARRAY;
    if (!activeCategoryId && !hasSearch) return EMPTY_ARRAY;

    const fullPool =
      section === 'movies'
        ? allVodStreams.length > 0
          ? allVodStreams
          : vodStreams
        : allSeriesStreams.length > 0
          ? allSeriesStreams
          : seriesStreams;

    // On-demand search searches across the ENTIRE domain catalog, even outside a selected category
    if (hasSearch) {
      return fullPool.filter((item) => {
        const name = (item.name || item.title || '').toLowerCase();
        return name.includes(normalizedQuery);
      });
    }

    if (activeCategoryId === 'all') {
      if (section === 'movies') {
        return allVodStreams.length > 0 ? vodIndex.getSortedAll() : vodStreams;
      }
      return allSeriesStreams.length > 0 ? seriesIndex.getSortedAll() : seriesStreams;
    }

    if (activeCategoryId === 'nc_recent') {
      return continueWatchingItems;
    }

    if (activeCategoryId === 'nc_fav') {
      return domainFavoriteItems;
    }

    if (section === 'movies') {
      if (allVodStreams.length > 0) {
        return vodIndex.getSortedByCategory(activeCategoryId);
      }
      return vodStreams.filter((m) => String(m.category_id) === String(activeCategoryId));
    }

    if (allSeriesStreams.length > 0) {
      return seriesIndex.getSortedByCategory(activeCategoryId);
    }
    return seriesStreams.filter((s) => String(s.category_id) === String(activeCategoryId));
  }, [
    section,
    activeCategoryId,
    hasSearch,
    normalizedQuery,
    allVodStreams,
    vodStreams,
    allSeriesStreams,
    seriesStreams,
    continueWatchingItems,
    domainFavoriteItems,
    vodIndex,
    seriesIndex,
  ]);

  const {
    startIndex,
    endIndex,
    topSpacerPx,
    bottomSpacerPx,
    virtualContainerCallbackRef,
  } = useVirtualWindow({
    totalCount: isGridMode ? displayedGridItems.length : 0,
    mode: 'grid',
    scrollContainerRef: mainContainerRef,
    virtualContainerRef: gridContainerRef,
    resetKey: `${section}_${activeCategoryId ?? 'showcase'}_${normalizedQuery}`,
    maxWindowItems: 96,
  });

  // Search results for 'inicio'
  const inicioSearchResults = useMemo(() => {
    if (section !== 'inicio' || !hasSearch) return null;
    const livePool = allLiveStreams.length > 0 ? allLiveStreams : liveStreams;
    const vodPool = allVodStreams.length > 0 ? allVodStreams : vodStreams;
    const seriesPool = allSeriesStreams.length > 0 ? allSeriesStreams : seriesStreams;

    return {
      live: livePool.filter((s) => (s.name || '').toLowerCase().includes(normalizedQuery)),
      vod: vodPool.filter((s) => (s.name || '').toLowerCase().includes(normalizedQuery)),
      series: seriesPool.filter((s) => (s.name || '').toLowerCase().includes(normalizedQuery)),
    };
  }, [
    section,
    hasSearch,
    normalizedQuery,
    allLiveStreams,
    liveStreams,
    allVodStreams,
    vodStreams,
    allSeriesStreams,
    seriesStreams,
  ]);

  const inicioSearchWindowMetrics = useMemo(() => {
    if (!inicioSearchResults) {
      return {
        perSectionMaxWindow: 48,
        liveOffsetTopPx: 88,
        vodOffsetTopPx: 88,
        seriesOffsetTopPx: 88,
      };
    }
    const nonEmptyDomains =
      (inicioSearchResults.live.length > 0 ? 1 : 0) +
      (inicioSearchResults.vod.length > 0 ? 1 : 0) +
      (inicioSearchResults.series.length > 0 ? 1 : 0);
    const perSectionMaxWindow =
      nonEmptyDomains <= 1 ? 60 : nonEmptyDomains === 2 ? 36 : 24;

    const estCols = 6;
    const estRowHeight = 260;
    const liveHeight =
      inicioSearchResults.live.length > 0
        ? 64 + Math.ceil(inicioSearchResults.live.length / estCols) * estRowHeight
        : 0;
    const vodHeight =
      inicioSearchResults.vod.length > 0
        ? 64 + Math.ceil(inicioSearchResults.vod.length / estCols) * estRowHeight
        : 0;

    return {
      perSectionMaxWindow,
      liveOffsetTopPx: 88,
      vodOffsetTopPx: 88 + liveHeight,
      seriesOffsetTopPx: 88 + liveHeight + vodHeight,
    };
  }, [inicioSearchResults]);

  const sectionTitle = section === 'movies' ? 'Filmes' : section === 'series' ? 'Séries' : 'Início';

  return (
    <div
      data-showcase-section={section}
      className="flex-1 flex flex-col w-full h-full overflow-hidden relative bg-nc-bg"
    >
      {selectedMovie && (
        <MovieDetails
          streamId={selectedMovie.stream_id ?? selectedMovie.id}
          streamName={selectedMovie.name || selectedMovie.title}
          streamIcon={normalizeImageSource(
            selectedMovie.stream_icon || selectedMovie.cover || selectedMovie.image
          )}
          categoryName={selectedMovie.category_name || 'Filme'}
          rating={selectedMovie.rating}
          year={selectedMovie.year}
          containerExtension={selectedMovie.container_extension}
          onClose={handleCloseMovieDetails}
          onPlay={onPlay}
        />
      )}

      {selectedSeries && (
        <SeriesDetails
          seriesId={selectedSeries.series_id || selectedSeries.stream_id || selectedSeries.id}
          seriesName={selectedSeries.name || selectedSeries.title}
          seriesCover={normalizeImageSource(
            selectedSeries.cover || selectedSeries.stream_icon || selectedSeries.image
          )}
          onClose={handleCloseSeriesDetails}
          onPlay={onPlay}
        />
      )}

      {playError && (
        <div
          role="alert"
          className="fixed bottom-6 right-6 left-6 sm:left-auto sm:max-w-md z-[100] bg-red-600/95 text-white text-sm px-4 py-3 rounded-xl shadow-2xl border border-red-500/50 backdrop-blur-md flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2"
        >
          <AlertCircle className="w-5 h-5 text-white shrink-0" />
          <span className="whitespace-normal break-words">{playError}</span>
        </div>
      )}

      {/* Domain Top Bar with Section Title & "Categorias" Control for Filmes and Séries */}
      {section !== 'inicio' && (
        <div
          data-nav-zone="categories"
          data-showcase-categories-bar="true"
          className="relative z-30 shrink-0 px-4 sm:px-6 md:px-10 pt-3 pb-2 flex flex-wrap items-center justify-between gap-3 bg-nc-bg"
        >
          <div data-nav-row="true" className="flex flex-wrap items-center gap-3 sm:gap-4">
            <h1 className="nc-section-title font-bold text-white tracking-tight">
              {sectionTitle}
            </h1>

            <div className="relative">
              <button
                ref={categoriesTriggerRef}
                type="button"
                data-categories-trigger="true"
                data-category-selected="true"
                disabled={isCategoriesLoading && realCategories.length === 0}
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

              {/* Categories Dropdown / Panel (kept in DOM with hidden/inert when closed for instant access) */}
              <div
                ref={categoriesMenuRef}
                role="listbox"
                aria-label={`Categorias de ${sectionTitle}`}
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
                      <span>Voltar à vitrine de {sectionTitle}</span>
                    </button>
                    <div role="separator" className="my-1 border-t border-white/10" />
                  </>
                )}

                {VIRTUAL_CATEGORIES.map((vc) => {
                  const isSelected = activeCategoryId === vc.category_id;
                  return (
                    <button
                      key={vc.category_id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      data-category-id={vc.category_id}
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

                {realCategories.length > 0 && (
                  <div role="separator" className="my-1 border-t border-white/10" />
                )}

                {realCategories.map((cat: any) => {
                  const catId = String(cat.category_id);
                  const isSelected = activeCategoryId === catId;
                  return (
                    <button
                      key={catId}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      data-category-id={catId}
                      data-category-selected={isSelected ? 'true' : 'false'}
                      onClick={() => handleSelectCategory(catId)}
                      className={`w-full text-left px-3.5 py-2.5 rounded-xl nc-text-subtitle font-medium flex items-center justify-between gap-2 transition-colors ${
                        isSelected
                          ? 'bg-nc-primary text-black font-bold'
                          : 'text-white/85 hover:bg-white/[0.08]'
                      }`}
                    >
                      <span className="whitespace-normal break-words">{cat.category_name}</span>
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
              {displayedGridItems.length}{' '}
              {section === 'movies'
                ? displayedGridItems.length === 1
                  ? 'filme'
                  : 'filmes'
                : displayedGridItems.length === 1
                  ? 'série'
                  : 'séries'}
            </span>
          )}
        </div>
      )}

      {/* Main Scrollable Showcase or Virtualized Grid Area */}
      <main
        ref={mainContainerRef as React.RefObject<HTMLElement>}
        data-scroll-container="true"
        data-nav-zone="content"
        style={{ overflowAnchor: 'none' }}
        className="flex-1 bg-nc-bg overflow-y-auto h-full"
      >
        {/* Domain Error Banner for Filmes / Séries */}
        {section !== 'inicio' && (domainCategoriesError || domainCatalogError) && (
          <div
            role="status"
            data-domain-error={section}
            className="mx-4 sm:mx-6 md:mx-10 mt-3 mb-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
          >
            <div className="flex items-start sm:items-center gap-2.5">
              <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5 sm:mt-0" />
              <span className="nc-text-subtitle text-amber-200 whitespace-normal break-words">
                {domainCatalogError || domainCategoriesError}
              </span>
            </div>
            <button
              type="button"
              data-domain-retry={section}
              disabled={isRetryingDomain}
              onClick={handleRetryDomain}
              className="px-3.5 py-1.5 rounded-lg bg-nc-primary text-black nc-text-subtitle font-semibold hover:bg-nc-primary-hover transition-colors flex items-center gap-1.5 shrink-0 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRetryingDomain ? 'animate-spin' : ''}`} />
              <span>Tentar novamente</span>
            </button>
          </div>
        )}

        {/* CASE 1: On-demand Search in 'Início' (virtualized multi-domain results) */}
        {section === 'inicio' && hasSearch && inicioSearchResults ? (
          <div className="px-4 sm:px-6 md:px-10 py-6 space-y-10 pb-20">
            <h2 className="nc-section-title font-bold text-white flex items-center gap-2">
              <Search className="w-6 h-6 text-nc-primary shrink-0" />
              <span className="whitespace-normal break-words">
                Resultados para &ldquo;{searchQuery}&rdquo;
              </span>
            </h2>

            {inicioSearchResults.live.length === 0 &&
              inicioSearchResults.vod.length === 0 &&
              inicioSearchResults.series.length === 0 && (
                <div className="text-center py-20 text-nc-text-secondary">
                  <p className="text-lg">
                    Nenhum resultado encontrado para &ldquo;{searchQuery}&rdquo;
                  </p>
                </div>
              )}

            {inicioSearchResults.live.length > 0 && (
              <VirtualizedInicioSearchSection
                domain="live"
                title="Canais Ao Vivo"
                items={inicioSearchResults.live}
                credentials={credentials}
                scrollContainerRef={mainContainerRef}
                resetKey={`inicio_search_live_${normalizedQuery}`}
                maxWindowItems={inicioSearchWindowMetrics.perSectionMaxWindow}
                fallbackOffsetTopPx={inicioSearchWindowMetrics.liveOffsetTopPx}
                onLiveClick={handleLiveChannelClick}
                onMediaClick={handleSelectItem}
              />
            )}

            {inicioSearchResults.vod.length > 0 && (
              <VirtualizedInicioSearchSection
                domain="vod"
                title="Filmes"
                items={inicioSearchResults.vod}
                credentials={credentials}
                scrollContainerRef={mainContainerRef}
                resetKey={`inicio_search_vod_${normalizedQuery}`}
                maxWindowItems={inicioSearchWindowMetrics.perSectionMaxWindow}
                fallbackOffsetTopPx={inicioSearchWindowMetrics.vodOffsetTopPx}
                onLiveClick={handleLiveChannelClick}
                onMediaClick={handleSelectItem}
              />
            )}

            {inicioSearchResults.series.length > 0 && (
              <VirtualizedInicioSearchSection
                domain="series"
                title="Séries"
                items={inicioSearchResults.series}
                credentials={credentials}
                scrollContainerRef={mainContainerRef}
                resetKey={`inicio_search_series_${normalizedQuery}`}
                maxWindowItems={inicioSearchWindowMetrics.perSectionMaxWindow}
                fallbackOffsetTopPx={inicioSearchWindowMetrics.seriesOffsetTopPx}
                onLiveClick={handleLiveChannelClick}
                onMediaClick={handleSelectItem}
              />
            )}
          </div>
        ) : isGridMode ? (
          /* CASE 2: Virtualized Grid Mode in 'movies' or 'series' (Category filter, "Ver todos", or domain Search) */
          <div className="px-4 sm:px-6 md:px-10 pt-2 pb-16">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="nc-subsection-title font-bold text-white whitespace-normal break-words">
                {hasSearch
                  ? `Resultados em ${sectionTitle} para "${searchQuery}"`
                  : activeCategoryLabel || sectionTitle}
              </h2>
            </div>

            {isCatalogLoading && displayedGridItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-nc-text-secondary">
                <Loader2 className="w-8 h-8 animate-spin text-nc-primary mb-4" />
                <p>Carregando {sectionTitle.toLowerCase()}...</p>
              </div>
            ) : displayedGridItems.length === 0 ? (
              <div className="text-center py-20 text-nc-text-secondary">
                {section === 'movies' ? (
                  <Film className="w-12 h-12 mx-auto mb-3 opacity-20" />
                ) : (
                  <Tv className="w-12 h-12 mx-auto mb-3 opacity-20" />
                )}
                <p>
                  {hasSearch
                    ? `Nenhum resultado encontrado em ${sectionTitle} para "${searchQuery}".`
                    : activeCategoryId === 'nc_recent'
                      ? `Você ainda não assistiu a ${sectionTitle.toLowerCase()} recentemente.`
                      : activeCategoryId === 'nc_fav'
                        ? `Você ainda não adicionou ${sectionTitle.toLowerCase()} aos favoritos.`
                        : `Nenhum título encontrado nesta categoria.`}
                </p>
              </div>
            ) : (
              <>
                {topSpacerPx > 0 && (
                  <div
                    data-virtual-spacer="top"
                    aria-hidden="true"
                    style={{ height: `${topSpacerPx}px` }}
                  />
                )}
                <div
                  ref={virtualContainerCallbackRef}
                  data-nav-grid="true"
                  data-virtual-container="true"
                  className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
                >
                  {displayedGridItems.slice(startIndex, endIndex).map((item: any, localIdx: number) => {
                    const virtualIndex = startIndex + localIdx;
                    const itemId = item.stream_id ?? item.series_id ?? item.id ?? virtualIndex;
                    const itemKey = String(itemId);
                    const itemTitle = item.name || item.title || sectionTitle;
                    const itemImage = item.stream_icon || item.cover || item.image;
                    const releaseYear =
                      item._precomputedYear !== undefined
                        ? item._precomputedYear || null
                        : extractReleaseYear(item);

                    return (
                      <div
                        key={itemKey}
                        tabIndex={0}
                        role="button"
                        aria-label={itemTitle}
                        data-nav-item="true"
                        data-virtual-index={virtualIndex}
                        data-virtual-key={itemKey}
                        onClick={(e) => {
                          const el = e.currentTarget as HTMLElement;
                          if (typeof document !== 'undefined' && document.activeElement !== el) {
                            try {
                              el.focus({ preventScroll: true });
                            } catch {}
                          }
                          pushFocusMemory(el);
                          handleSelectItem(
                            section === 'series' ? { ...item, stream_type: 'series' } : item,
                            el
                          );
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            const el = e.currentTarget as HTMLElement;
                            pushFocusMemory(el);
                            handleSelectItem(
                              section === 'series' ? { ...item, stream_type: 'series' } : item,
                              el
                            );
                          }
                        }}
                        className="group relative aspect-[2/3] bg-nc-bg-card rounded-xl overflow-hidden border border-nc-border hover:border-nc-primary/50 transition-all cursor-pointer flex flex-col justify-end"
                      >
                        <MediaImage
                          src={itemImage}
                          serverUrl={credentials?.serverUrl}
                          alt={itemTitle}
                          itemId={itemId}
                          itemName={itemTitle}
                          className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />

                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <div className="w-12 h-12 rounded-full bg-nc-primary flex items-center justify-center text-black transform scale-75 group-hover:scale-100 transition-transform shadow-lg">
                            <Play className="w-6 h-6 fill-current ml-1" />
                          </div>
                        </div>

                        <div className="relative z-10 p-3">
                          <h3 className="text-white nc-card-title line-clamp-2 group-hover:text-nc-primary transition-colors">
                            {itemTitle}
                          </h3>
                          <div className="flex items-center justify-between gap-2 mt-1">
                            {item.rating && item.rating !== '0' ? (
                              <span className="nc-text-meta text-yellow-500 flex items-center gap-1">
                                ★ {item.rating}
                              </span>
                            ) : (
                              <span />
                            )}
                            {releaseYear && (
                              <span className="nc-text-meta text-nc-text-secondary font-medium">
                                {releaseYear}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {bottomSpacerPx > 0 && (
                  <div
                    data-virtual-spacer="bottom"
                    aria-hidden="true"
                    style={{ height: `${bottomSpacerPx}px` }}
                  />
                )}
              </>
            )}
          </div>
        ) : (
          /* CASE 3: Shared Showcase Mode (Início, Filmes, Séries) */
          <div className="pb-16">
            <div data-scroll-top-anchor="true">
              {heroItems.length > 0 && (
                <HeroBanner
                  items={heroItems}
                  onPlay={handleHeroPlay}
                  onInfo={handleSelectItem}
                  isPaused={isPaused || Boolean(selectedMovie || selectedSeries)}
                  canContinueItem={canContinueItem}
                />
              )}
            </div>

            {isCatalogLoading && totalShowcaseRows === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-nc-text-secondary">
                <Loader2 className="w-8 h-8 animate-spin text-nc-primary mb-4" />
                <p>Carregando catálogo...</p>
              </div>
            ) : totalShowcaseRows === 0 ? (
              <div className="text-center py-20 text-nc-text-secondary px-6">
                {section === 'movies' ? (
                  <Film className="w-12 h-12 mx-auto mb-3 opacity-20" />
                ) : section === 'series' ? (
                  <Tv className="w-12 h-12 mx-auto mb-3 opacity-20" />
                ) : (
                  <Layers className="w-12 h-12 mx-auto mb-3 opacity-20" />
                )}
                <p>Nenhum título disponível no momento.</p>
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
                {topShowcaseSpacerPx > 0 && (
                  <div
                    data-showcase-row-spacer="top"
                    aria-hidden="true"
                    style={{ height: `${topShowcaseSpacerPx}px`, overflowAnchor: 'none' }}
                  />
                )}
                {mountedShowcaseRows.map((row) => (
                  <div
                    key={row.key}
                    data-scroll-block="true"
                    data-showcase-row-key={row.key}
                    className="pb-6"
                    style={{
                      minHeight: `${row.reservedHeightPx}px`,
                      overflowAnchor: 'none',
                    }}
                  >
                    <HorizontalRow
                      title={row.title}
                      items={row.items}
                      type={row.type}
                      rowIndex={row.rowIndex}
                      virtualize={row.virtualize}
                      onItemClick={row.type === 'live' ? handleLiveChannelClick : handleSelectItem}
                    />
                  </div>
                ))}
                {bottomShowcaseSpacerPx > 0 && (
                  <div
                    data-showcase-row-spacer="bottom"
                    aria-hidden="true"
                    style={{ height: `${bottomShowcaseSpacerPx}px`, overflowAnchor: 'none' }}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
});
