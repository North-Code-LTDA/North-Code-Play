import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import {
  useXtream,
  useXtreamCatalogStatus,
  useXtreamLiveData,
} from '../context/XtreamContext';
import { XtreamStream } from '../services/xtreamService';
import {
  Tv,
  Heart,
  Calendar,
  Clock,
  Play,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Layers,
} from 'lucide-react';
import { VideoPlayer } from '../components/VideoPlayer';
import { MediaImage } from '../components/MediaImage';
import { useFavorites } from '../hooks/useFavorites';
import { useAccountPlaybackHistory } from '../hooks/useAccountPlaybackHistory';
import { LiveChannelLaunchIntent } from '../types/liveLaunchIntent';
import {
  LiveChannelGroup,
  ChannelVariant,
  ChannelQuality,
} from '../utils/liveChannelGroups';
import { getOrCreateLiveIndex } from '../utils/catalogIndex';
import { formatLiveTvCategoryTitle } from '../utils/categoryLabel';
import {
  useNavigation,
  isElementFocusable,
  registerVirtualContainer,
  unregisterVirtualContainer,
  registerShowcaseRowController,
  unregisterShowcaseRowController,
  invalidateCandidateCache,
} from '../navigation';
import { useVirtualWindow } from '../hooks/useVirtualWindow';
import {
  computeHorizontalVirtualWindow,
  HorizontalVirtualWindowResult,
} from '../components/HorizontalRow';
import {
  observeContainerVisibility,
  notifyContainerScrollForFallback,
} from '../utils/viewportVisibility';
import {
  ResolvedEpgProgram,
  LiveEpgStatus,
  getPreferredEpgStreamIdForGroup,
  getCachedLiveEpgSnapshot,
  subscribeLiveChannelEpg,
} from '../utils/liveEpgManager';

// Configurable timeout for testing fallback without waiting 28 real seconds
let LIVE_FALLBACK_TIMEOUT_MS = 28000;
export const setLiveFallbackTimeoutMsForTest = (ms: number) => {
  LIVE_FALLBACK_TIMEOUT_MS = ms;
};

interface LiveTvViewProps {
  onPlay: (stream: any) => void;
  searchQuery?: string;
  isTvMode?: boolean;
  launchIntent?: LiveChannelLaunchIntent | null;
  onConsumeLaunchIntent?: () => void;
}

const QUALITY_BADGE_STYLES: Record<ChannelQuality, string> = {
  '4K': 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  FHD: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  HD: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  SD: 'bg-gray-500/20 text-gray-300 border-gray-500/40',
  UNKNOWN: 'bg-white/10 text-gray-400 border-white/15',
};

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
  viewportWidth: number;
  viewportHeight: number;
  contentAreaWidth: number;
  leftPaneWidth: number;
  rightPaneWidth: number;
  leftPaneRatio: number;
  rightPaneRatio: number;
  isMobile: boolean;
  topSectionDirection: 'row' | 'column';
  topSectionHeight: number;
  previewWidth: number;
  previewHeight: number;
  previewAspectRatio: number;
  epgSectionHeight: number;
  epgHeaderHeight: number;
  epgScrollViewportHeight: number;
  epgCardHeight: number;
  visibleEpgCardsCount: number;
  epgTotalContentHeight: number;
  epgMaxScrollTop: number;
}

/**
 * Pure layout metric calculator for LiveTvView 50/50 split layout + right-pane EPG.
 */
export function computeLiveTvLayoutMetrics(
  input: LiveTvLayoutMetricsInput
): LiveTvLayoutMetrics {
  const {
    viewportWidth,
    viewportHeight,
    uiScale = 1,
    displayMode = 'default',
    isGrouped = true,
    hasNowPlaying = true,
    epgCount = 6,
  } = input;

  const isMobile = viewportWidth < 768;
  const isCompactDesktop = !isMobile && (viewportHeight <= 640 || displayMode === 'tv');
  const remPx = 16 * (displayMode === 'tv' ? uiScale : 1);

  const contentAreaWidth = viewportWidth;
  const leftPaneWidth = isMobile
    ? contentAreaWidth
    : Math.round(contentAreaWidth * 0.5);
  const rightPaneWidth = isMobile
    ? contentAreaWidth
    : Math.max(320, contentAreaWidth - leftPaneWidth);
  const leftPaneRatio =
    contentAreaWidth > 0 ? Number((leftPaneWidth / contentAreaWidth).toFixed(4)) : 0.5;
  const rightPaneRatio =
    contentAreaWidth > 0 ? Number((rightPaneWidth / contentAreaWidth).toFixed(4)) : 0.5;

  const topSectionDirection: 'row' | 'column' = isMobile ? 'column' : 'row';

  const previewWidth = isMobile
    ? Math.max(240, rightPaneWidth - 32)
    : isCompactDesktop
      ? Math.min(
          Math.max(Math.round(11 * remPx), Math.round(viewportWidth * 0.23)),
          Math.round(15 * remPx)
        )
      : Math.min(Math.round(288 * uiScale), Math.round(rightPaneWidth * 0.44));

  const previewHeight = Math.round((previewWidth * 9) / 16);
  const previewAspectRatio = Number((previewWidth / Math.max(1, previewHeight)).toFixed(4));

  const topPadY = isCompactDesktop ? Math.round(1.1 * remPx) : 32;
  const metaHeaderHeight = isCompactDesktop ? Math.round(2.5 * remPx) : 48;
  const variantsRowHeight = isGrouped ? (isCompactDesktop ? Math.round(2.1 * remPx) : 38) : 0;
  const nowPlayingHeight = hasNowPlaying ? (isCompactDesktop ? Math.round(3.1 * remPx) : 58) : 0;
  const rightColumnStackHeight =
    metaHeaderHeight +
    (variantsRowHeight > 0 ? variantsRowHeight + 6 : 0) +
    (nowPlayingHeight > 0 ? nowPlayingHeight + 6 : 0);

  const mobileBackBarHeight = isMobile ? 49 : 0;
  const topSectionHeight =
    topSectionDirection === 'row'
      ? Math.max(previewHeight, rightColumnStackHeight) + topPadY
      : mobileBackBarHeight + previewHeight + rightColumnStackHeight + 28;

  const epgSectionHeight = Math.max(160, viewportHeight - topSectionHeight);
  const epgHeaderHeight = isCompactDesktop ? Math.round(2.15 * remPx) : 42;
  const epgScrollPadY = isCompactDesktop ? Math.round(1.1 * remPx) : 24;
  const epgScrollViewportHeight = Math.max(80, epgSectionHeight - epgHeaderHeight);

  const epgCardHeight = isCompactDesktop ? Math.round(4.6 * remPx) : 84;
  const epgCardGap = isCompactDesktop ? Math.round(0.65 * remPx) : 12;

  const usableScrollHeight = Math.max(0, epgScrollViewportHeight - epgScrollPadY);
  const visibleEpgCardsCount = Number(
    (usableScrollHeight / Math.max(1, epgCardHeight + epgCardGap)).toFixed(2)
  );

  const epgTotalContentHeight =
    epgCount > 0
      ? epgCount * epgCardHeight + Math.max(0, epgCount - 1) * epgCardGap + epgScrollPadY
      : 0;
  const epgMaxScrollTop = Math.max(0, epgTotalContentHeight - epgScrollViewportHeight);

  return {
    viewportWidth,
    viewportHeight,
    contentAreaWidth,
    leftPaneWidth,
    rightPaneWidth,
    leftPaneRatio,
    rightPaneRatio,
    isMobile,
    topSectionDirection,
    topSectionHeight,
    previewWidth,
    previewHeight,
    previewAspectRatio,
    epgSectionHeight,
    epgHeaderHeight,
    epgScrollViewportHeight,
    epgCardHeight,
    visibleEpgCardsCount,
    epgTotalContentHeight,
    epgMaxScrollTop,
  };
}

interface LiveCategoryRowDescriptor {
  categoryId: string;
  rawCategoryName: string;
  formattedTitle: string;
  groups: LiveChannelGroup[];
}

const HORIZONTAL_VIRTUALIZE_THRESHOLD = 12;
const VERTICAL_VIRTUALIZE_THRESHOLD = 8;
const CARD_WIDTH_DEFAULT_PX = 256;
const CARD_HEIGHT_DEFAULT_PX = 82;
const CARD_GAP_DEFAULT_PX = 12;
const CATEGORY_ROW_ESTIMATED_HEIGHT_PX = 138;

function resolveLiveCardRowMetrics(): {
  cardWidth: number;
  cardHeight: number;
  gap: number;
  rowWidth: number;
} {
  let isTv = false;
  let scale = 1;
  let vw = 1280;
  if (typeof document !== 'undefined') {
    isTv = document.documentElement.getAttribute('data-display-mode') === 'tv';
    const rawScale = parseFloat(
      document.documentElement.style.getPropertyValue('--nc-ui-scale') || '1'
    );
    if (Number.isFinite(rawScale) && rawScale > 0) {
      scale = rawScale;
    }
  }
  if (typeof window !== 'undefined' && typeof window.innerWidth === 'number' && window.innerWidth > 0) {
    vw = window.innerWidth;
  }

  const factor = isTv ? scale : 1;
  const cardWidth = Math.max(180, Math.round(CARD_WIDTH_DEFAULT_PX * factor));
  const cardHeight = Math.max(64, Math.round(CARD_HEIGHT_DEFAULT_PX * factor));
  const gap = Math.max(8, Math.round(CARD_GAP_DEFAULT_PX * factor));
  const rowWidth = Math.max(cardWidth * 2, Math.round((vw >= 768 ? vw * 0.5 : vw) - 36));
  return { cardWidth, cardHeight, gap, rowWidth };
}

interface LiveChannelCardProps {
  group: LiveChannelGroup;
  categoryId: string;
  rowIndex: number;
  cardIdx: number;
  cardWidth: number;
  cardHeight: number;
  isSelected: boolean;
  isOrigin: boolean;
  isFavorite: boolean;
  isCardVisible: boolean;
  credentials: any;
  onSelectChannel: (
    group: LiveChannelGroup,
    categoryId: string,
    rowIndex: number,
    cardIdx: number,
    btnEl: HTMLButtonElement
  ) => void;
  onToggleFavorite: (group: LiveChannelGroup) => void;
  onCardFocus: (cardIdx: number, group: LiveChannelGroup, categoryId: string, rowIndex: number) => void;
  onCardBlur: (cardIdx: number) => void;
  registerCardRef?: (cardIdx: number, el: HTMLElement | null) => void;
}

const LiveChannelCard = React.memo<LiveChannelCardProps>(
  ({
    group,
    categoryId,
    rowIndex,
    cardIdx,
    cardWidth,
    cardHeight,
    isSelected,
    isOrigin,
    isFavorite,
    isCardVisible,
    credentials,
    onSelectChannel,
    onToggleFavorite,
    onCardFocus,
    onCardBlur,
    registerCardRef,
  }) => {
    const [isFocusedWithin, setIsFocusedWithin] = useState(false);
    const epgStreamId = useMemo(() => getPreferredEpgStreamIdForGroup(group), [group]);

    const [currentProgramTitle, setCurrentProgramTitle] = useState<string | null>(() => {
      const cached = getCachedLiveEpgSnapshot(credentials, epgStreamId);
      return cached?.currentProgram?.title ?? null;
    });

    const shouldFetchEpg = isCardVisible || isFocusedWithin || isSelected;

    useEffect(() => {
      if (!credentials || !epgStreamId) {
        setCurrentProgramTitle(null);
        return;
      }

      const cached = getCachedLiveEpgSnapshot(credentials, epgStreamId);
      if (cached) {
        setCurrentProgramTitle(cached.currentProgram?.title ?? null);
        return;
      }

      if (!shouldFetchEpg) {
        return;
      }

      const priority = isFocusedWithin || isSelected ? 'high' : 'normal';
      const unsubscribe = subscribeLiveChannelEpg({
        credentials,
        streamId: epgStreamId,
        priority,
        onUpdate: (snapshot) => {
          setCurrentProgramTitle(snapshot.currentProgram?.title ?? null);
        },
      });

      return () => {
        unsubscribe();
      };
    }, [credentials, epgStreamId, shouldFetchEpg, isFocusedWithin, isSelected]);

    return (
      <div
        ref={(el) => registerCardRef?.(cardIdx, el)}
        data-live-channel-card="true"
        data-live-card-row-index={rowIndex}
        data-live-card-index={cardIdx}
        data-card-focused={isFocusedWithin ? 'true' : 'false'}
        data-card-selected={isSelected ? 'true' : 'false'}
        style={{ width: `${cardWidth}px`, height: `${cardHeight}px` }}
        className="nc-showcase-card nc-live-horizontal-card relative shrink-0 select-none group/card rounded-xl"
      >
        <div
          data-card-visual="true"
          className={`nc-card-visual-layer relative w-full h-full rounded-xl overflow-hidden flex items-center transition-colors border ${
            isSelected
              ? 'bg-white/[0.13] border-white/30 shadow-lg'
              : 'bg-[#121726]/90 border-white/[0.07] hover:bg-white/[0.08] hover:border-white/15'
          }`}
        >
          {isSelected && (
            <div
              aria-hidden="true"
              className="absolute left-0 top-2 bottom-2 w-1 bg-white rounded-r-full z-20"
            />
          )}

          <button
            type="button"
            data-live-channel-btn="true"
            data-live-channel-group-id={group.groupKey}
            data-live-channel-category-id={categoryId}
            data-live-category-id={cardIdx === 0 ? categoryId : undefined}
            data-row-card-index={cardIdx}
            data-virtual-index={cardIdx}
            data-live-channel-selected={isSelected ? 'true' : 'false'}
            data-live-channel-origin={isOrigin ? 'true' : 'false'}
            aria-label={group.displayName}
            onFocus={() => {
              setIsFocusedWithin(true);
              onCardFocus(cardIdx, group, categoryId, rowIndex);
            }}
            onBlur={() => {
              setIsFocusedWithin(false);
              onCardBlur(cardIdx);
            }}
            onClick={(e) => {
              const btnEl = e.currentTarget;
              if (typeof document !== 'undefined' && document.activeElement !== btnEl) {
                try {
                  btnEl.focus({ preventScroll: true });
                } catch {}
              }
              onSelectChannel(group, categoryId, rowIndex, cardIdx, btnEl);
            }}
            className="flex items-center gap-3 w-full h-full pl-2.5 pr-10 py-2 text-left outline-none cursor-pointer min-w-0"
          >
            <div
              data-live-card-logo="true"
              className="nc-tv-channel-logo w-14 h-14 rounded-lg bg-black/50 flex items-center justify-center p-1.5 shrink-0 border border-white/[0.08] relative overflow-hidden"
            >
              <MediaImage
                src={group.representative.stream_icon}
                serverUrl={credentials?.serverUrl}
                alt={group.displayName}
                itemId={group.representative.stream_id}
                itemName={group.displayName}
                active={isCardVisible || isFocusedWithin || isSelected}
                className="w-full h-full object-contain"
                fallbackIcon={<Tv className="w-6 h-6 text-gray-600" />}
              />
            </div>

            <div className="nc-tv-channel-info flex-1 min-w-0 flex flex-col justify-center gap-0.5 overflow-hidden">
              <span
                data-live-channel-name="true"
                className={`nc-tv-channel-name font-semibold text-sm leading-tight truncate block w-full ${
                  isSelected ? 'text-white font-bold' : 'text-gray-100 group-hover/card:text-white'
                }`}
              >
                {group.displayName}
              </span>
              <span
                data-live-card-epg="true"
                data-live-card-epg-status={currentProgramTitle ? 'active' : 'unavailable'}
                className={`text-xs leading-snug truncate block w-full ${
                  currentProgramTitle ? 'text-gray-300 font-medium' : 'text-gray-500'
                }`}
              >
                {currentProgramTitle || 'Programação indisponível'}
              </span>
            </div>
          </button>

          <button
            type="button"
            data-live-channel-fav="true"
            data-row-fav-index={cardIdx}
            onFocus={() => {
              setIsFocusedWithin(true);
              onCardFocus(cardIdx, group, categoryId, rowIndex);
            }}
            onBlur={() => {
              setIsFocusedWithin(false);
              onCardBlur(cardIdx);
            }}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(group);
            }}
            className={`nc-tv-channel-fav absolute right-1.5 top-1/2 -translate-y-1/2 z-10 p-2 rounded-lg transition-all cursor-pointer outline-none focus:ring-2 focus:ring-white focus:bg-white/20 ${
              isFavorite
                ? 'text-red-500 hover:bg-white/10'
                : 'text-gray-500 hover:text-gray-200 hover:bg-white/10'
            }`}
            title={isFavorite ? 'Remover dos Favoritos' : 'Adicionar aos Favoritos'}
            aria-label={
              isFavorite
                ? `Remover ${group.displayName} dos favoritos`
                : `Adicionar ${group.displayName} aos favoritos`
            }
          >
            <Heart className={`w-4 h-4 ${isFavorite ? 'fill-red-500 text-red-500' : ''}`} />
          </button>
        </div>
      </div>
    );
  }
);

interface LiveCategoryRowProps {
  rowDescriptor: LiveCategoryRowDescriptor;
  rowIndex: number;
  selectedGroupKey: string | null;
  originGroupKey: string | null;
  originCategoryId: string | null;
  credentials: any;
  isRowVerticallyVisible: boolean;
  isFavoriteFn: (id: string | number, type: 'live' | 'vod' | 'series') => boolean;
  onSelectChannel: (
    group: LiveChannelGroup,
    categoryId: string,
    rowIndex: number,
    cardIdx: number,
    btnEl: HTMLButtonElement
  ) => void;
  onToggleFavorite: (group: LiveChannelGroup) => void;
  onOriginChange: (groupKey: string, categoryId: string, rowIndex: number, cardIdx: number) => void;
  savedScrollLeft?: number;
  onSaveScrollLeft: (categoryId: string, scrollLeft: number) => void;
}

const LiveCategoryRow = React.memo<LiveCategoryRowProps>(
  ({
    rowDescriptor,
    rowIndex,
    selectedGroupKey,
    originGroupKey,
    originCategoryId,
    credentials,
    isRowVerticallyVisible,
    isFavoriteFn,
    onSelectChannel,
    onToggleFavorite,
    onOriginChange,
    savedScrollLeft = 0,
    onSaveScrollLeft,
  }) => {
    const { categoryId, formattedTitle, groups } = rowDescriptor;
    const rowElRef = useRef<HTMLDivElement | null>(null);
    const cardElsRef = useRef<Map<number, HTMLElement>>(new Map());
    const [focusedCardIdx, setFocusedCardIdx] = useState<number | null>(null);

    const virtualizeHorizontal = groups.length > HORIZONTAL_VIRTUALIZE_THRESHOLD;
    const initialMetrics = useMemo(() => resolveLiveCardRowMetrics(), []);

    const [horizWindow, setHorizWindow] = useState<
      HorizontalVirtualWindowResult & {
        cardWidth: number;
        cardHeight: number;
        gap: number;
        rowWidth: number;
      }
    >(() => {
      const m = initialMetrics;
      if (!virtualizeHorizontal) {
        return {
          startIndex: 0,
          endIndex: groups.length,
          leftSpacerPx: 0,
          rightSpacerPx: 0,
          visibleCount: groups.length,
          cardWidth: m.cardWidth,
          cardHeight: m.cardHeight,
          gap: m.gap,
          rowWidth: m.rowWidth,
        };
      }
      const win = computeHorizontalVirtualWindow({
        totalCount: groups.length,
        scrollLeft: savedScrollLeft,
        rowWidth: m.rowWidth,
        cardWidth: m.cardWidth,
        gap: m.gap,
      });
      return {
        ...win,
        cardWidth: m.cardWidth,
        cardHeight: m.cardHeight,
        gap: m.gap,
        rowWidth: m.rowWidth,
      };
    });

    const horizWindowRef = useRef(horizWindow);
    horizWindowRef.current = horizWindow;

    const groupsRef = useRef(groups);
    groupsRef.current = groups;

    const [horizontallyVisibleCards, setHorizontallyVisibleCards] = useState<Set<number>>(
      () => {
        const initial = new Set<number>();
        const initialLimit = Math.min(groups.length, 4);
        for (let i = 0; i < initialLimit; i++) {
          initial.add(i);
        }
        return initial;
      }
    );

    const registerCardRef = useCallback((idx: number, el: HTMLElement | null) => {
      if (el) {
        cardElsRef.current.set(idx, el);
      } else {
        cardElsRef.current.delete(idx);
      }
    }, []);

    const syncHorizontalWindow = useCallback(
      (
        scrollLeftPx: number,
        pinnedRange: { minIndex: number; maxIndex: number } | null = null,
        immediate = false
      ) => {
        const m = resolveLiveCardRowMetrics();
        const rowEl = rowElRef.current;
        const measuredRowWidth =
          rowEl && rowEl.clientWidth > 0 ? rowEl.clientWidth : m.rowWidth;

        if (!virtualizeHorizontal) {
          const next = {
            startIndex: 0,
            endIndex: groupsRef.current.length,
            leftSpacerPx: 0,
            rightSpacerPx: 0,
            visibleCount: groupsRef.current.length,
            cardWidth: m.cardWidth,
            cardHeight: m.cardHeight,
            gap: m.gap,
            rowWidth: measuredRowWidth,
          };
          horizWindowRef.current = next;
          setHorizWindow(next);
          return next;
        }

        const win = computeHorizontalVirtualWindow({
          totalCount: groupsRef.current.length,
          scrollLeft: scrollLeftPx,
          rowWidth: measuredRowWidth,
          cardWidth: m.cardWidth,
          gap: m.gap,
          pinnedRange,
        });

        const cur = horizWindowRef.current;
        const next = {
          ...win,
          cardWidth: m.cardWidth,
          cardHeight: m.cardHeight,
          gap: m.gap,
          rowWidth: measuredRowWidth,
        };

        if (
          immediate ||
          cur.startIndex !== next.startIndex ||
          cur.endIndex !== next.endIndex ||
          cur.leftSpacerPx !== next.leftSpacerPx ||
          cur.rightSpacerPx !== next.rightSpacerPx ||
          cur.cardWidth !== next.cardWidth
        ) {
          horizWindowRef.current = next;
          setHorizWindow(next);
          invalidateCandidateCache();
        }
        return next;
      },
      [virtualizeHorizontal]
    );

    useLayoutEffect(() => {
      const rowEl = rowElRef.current;
      if (!rowEl) return;

      if (savedScrollLeft > 0 && Math.abs(rowEl.scrollLeft - savedScrollLeft) > 2) {
        rowEl.scrollLeft = savedScrollLeft;
      }

      syncHorizontalWindow(
        rowEl.scrollLeft || savedScrollLeft || 0,
        focusedCardIdx !== null
          ? { minIndex: focusedCardIdx, maxIndex: focusedCardIdx }
          : null
      );

      const handleScroll = () => {
        const sl = rowEl.scrollLeft || 0;
        onSaveScrollLeft(categoryId, sl);
        notifyContainerScrollForFallback(rowEl);
        syncHorizontalWindow(
          sl,
          focusedCardIdx !== null
            ? { minIndex: focusedCardIdx, maxIndex: focusedCardIdx }
            : null
        );
      };

      const handleResize = () => {
        syncHorizontalWindow(rowEl.scrollLeft || 0);
      };

      rowEl.addEventListener('scroll', handleScroll, { passive: true });
      if (typeof window !== 'undefined') {
        window.addEventListener('resize', handleResize);
      }

      return () => {
        rowEl.removeEventListener('scroll', handleScroll);
        if (typeof window !== 'undefined') {
          window.removeEventListener('resize', handleResize);
        }
      };
    }, [categoryId, groups.length, savedScrollLeft, onSaveScrollLeft, syncHorizontalWindow, focusedCardIdx]);

    const ensureIndexMounted = useCallback(
      (targetIndex: number, fromIndex?: number): boolean => {
        const total = groupsRef.current.length;
        if (targetIndex < 0 || targetIndex >= total) return false;
        const rowEl = rowElRef.current;
        const cur = horizWindowRef.current;
        const stride = cur.cardWidth + cur.gap;
        const cardLeft = targetIndex * stride;
        const cardRight = cardLeft + cur.cardWidth;
        const curScroll = rowEl ? rowEl.scrollLeft || 0 : 0;

        let nextScroll = curScroll;
        if (cardLeft < curScroll) {
          nextScroll = Math.max(0, cardLeft - 12);
        } else if (cardRight > curScroll + cur.rowWidth) {
          nextScroll = Math.max(0, cardRight - cur.rowWidth + 12);
        }

        if (rowEl && Math.abs(rowEl.scrollLeft - nextScroll) > 1) {
          rowEl.scrollLeft = nextScroll;
          onSaveScrollLeft(categoryId, nextScroll);
        }

        const minPin =
          typeof fromIndex === 'number' && fromIndex >= 0
            ? Math.min(fromIndex, targetIndex)
            : targetIndex;
        const maxPin =
          typeof fromIndex === 'number' && fromIndex >= 0
            ? Math.max(fromIndex, targetIndex)
            : targetIndex;

        const prevStart = cur.startIndex;
        const prevEnd = cur.endIndex;
        const updated = syncHorizontalWindow(
          nextScroll,
          { minIndex: minPin, maxIndex: maxPin },
          true
        );
        return updated.startIndex !== prevStart || updated.endIndex !== prevEnd;
      },
      [categoryId, onSaveScrollLeft, syncHorizontalWindow]
    );

    useLayoutEffect(() => {
      const rowEl = rowElRef.current;
      if (!rowEl || groups.length === 0) return;

      registerVirtualContainer(rowEl, {
        totalCount: groups.length,
        getColumns: () => groups.length,
        ensureIndexMounted,
      });

      return () => {
        unregisterVirtualContainer(rowEl);
        invalidateCandidateCache();
      };
    }, [groups.length, ensureIndexMounted]);

    const effectiveStart = virtualizeHorizontal
      ? Math.max(0, Math.min(groups.length, horizWindow.startIndex))
      : 0;
    const effectiveEnd = virtualizeHorizontal
      ? Math.max(effectiveStart, Math.min(groups.length, horizWindow.endIndex))
      : groups.length;

    // Observe horizontal card visibility within the row so off-screen cards don't trigger EPG
    useLayoutEffect(() => {
      const rowEl = rowElRef.current;
      if (!rowEl || groups.length === 0) return;

      const unsubs: Array<() => void> = [];
      const nextVisible = new Set<number>();

      for (let idx = effectiveStart; idx < effectiveEnd; idx++) {
        const cardEl = cardElsRef.current.get(idx);
        if (!cardEl) continue;

        const unsub = observeContainerVisibility({
          target: cardEl,
          root: rowEl,
          rootMargin: '0px 80px 0px 80px',
          axis: 'horizontal',
          index: idx,
          onIntersectChange: (vis) => {
            setHorizontallyVisibleCards((prev) => {
              const has = prev.has(idx);
              if (vis === has) return prev;
              const copy = new Set(prev);
              if (vis) copy.add(idx);
              else copy.delete(idx);
              return copy;
            });
          },
        });
        unsubs.push(unsub);
        if (idx < effectiveStart + 4) {
          nextVisible.add(idx);
        }
      }

      return () => {
        unsubs.forEach((u) => u());
      };
    }, [groups, effectiveStart, effectiveEnd]);

    const scrollByAmount = useCallback(
      (delta: number) => {
        const rowEl = rowElRef.current;
        if (!rowEl) return;
        const target = Math.max(0, (rowEl.scrollLeft || 0) + delta);
        rowEl.scrollLeft = target;
        onSaveScrollLeft(categoryId, target);
        syncHorizontalWindow(target);
      },
      [categoryId, onSaveScrollLeft, syncHorizontalWindow]
    );

    const handleCardFocus = useCallback(
      (idx: number, group: LiveChannelGroup, catId: string, rIdx: number) => {
        setFocusedCardIdx(idx);
        onOriginChange(group.groupKey, catId, rIdx, idx);
        const rowEl = rowElRef.current;
        const cardEl = cardElsRef.current.get(idx);
        if (rowEl && cardEl) {
          const m = horizWindowRef.current;
          const stride = m.cardWidth + m.gap;
          const cardLeft = idx * stride;
          const cardRight = cardLeft + m.cardWidth;
          const curScroll = rowEl.scrollLeft || 0;
          const rowW = rowEl.clientWidth > 0 ? rowEl.clientWidth : m.rowWidth;
          if (cardLeft < curScroll + 8) {
            rowEl.scrollLeft = Math.max(0, cardLeft - 8);
          } else if (cardRight > curScroll + rowW - 8) {
            rowEl.scrollLeft = Math.max(0, cardRight - rowW + 8);
          }
        }
      },
      [onOriginChange]
    );

    const handleCardBlur = useCallback((idx: number) => {
      setFocusedCardIdx((prev) => (prev === idx ? null : prev));
    }, []);

    const visibleSlice = virtualizeHorizontal
      ? groups.slice(effectiveStart, effectiveEnd)
      : groups;

    return (
      <section
        data-home-row-index={rowIndex}
        data-live-category-row="true"
        data-live-category-row-id={categoryId}
        className="w-full group/row"
      >
        <div className="flex items-center justify-between gap-2 mb-2 px-1">
          <h3
            data-live-category-title="true"
            className="nc-heading-view font-semibold text-white tracking-tight break-words whitespace-normal"
          >
            {formattedTitle}
          </h3>
        </div>

        <div className="relative w-full">
          <button
            type="button"
            tabIndex={-1}
            data-row-scroll-prev="true"
            onClick={() => scrollByAmount(-280)}
            className="absolute left-0 top-1 bottom-2 w-9 bg-gradient-to-r from-[#0B0F19] via-[#0B0F19]/80 to-transparent z-10 flex items-center justify-start pl-1.5 opacity-0 group-hover/row:opacity-100 transition-opacity pointer-events-auto"
            aria-label={`Rolar ${formattedTitle} para a esquerda`}
          >
            <ChevronLeft className="w-5 h-5 text-white drop-shadow" />
          </button>

          <div
            ref={rowElRef}
            data-nav-row="true"
            data-live-category-row-scroll="true"
            data-live-category-scroll-id={categoryId}
            data-virtual-container={virtualizeHorizontal ? 'true' : undefined}
            className="flex flex-row items-center overflow-x-auto overflow-y-hidden w-full gap-3 px-1 py-1.5 scrollbar-hide"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {virtualizeHorizontal && horizWindow.leftSpacerPx > 0 && (
              <div
                key="__live_horiz_spacer_left__"
                data-virtual-spacer="left"
                aria-hidden="true"
                role="presentation"
                className="shrink-0 pointer-events-none select-none"
                style={{ width: `${horizWindow.leftSpacerPx}px`, height: '1px' }}
              />
            )}

            {visibleSlice.map((group, offset) => {
              const cardIdx = effectiveStart + offset;
              const isSelected = selectedGroupKey === group.groupKey;
              const isOrigin =
                originGroupKey === group.groupKey &&
                (originCategoryId === null || originCategoryId === categoryId);
              const isFav = group.variants.some((v) =>
                isFavoriteFn(v.stream.stream_id, 'live')
              );
              const isCardVisible =
                isRowVerticallyVisible &&
                (horizontallyVisibleCards.has(cardIdx) || cardIdx < effectiveStart + 4);

              return (
                <LiveChannelCard
                  key={`${categoryId}_${group.groupKey}`}
                  group={group}
                  categoryId={categoryId}
                  rowIndex={rowIndex}
                  cardIdx={cardIdx}
                  cardWidth={horizWindow.cardWidth}
                  cardHeight={horizWindow.cardHeight}
                  isSelected={isSelected}
                  isOrigin={isOrigin}
                  isFavorite={isFav}
                  isCardVisible={isCardVisible}
                  credentials={credentials}
                  onSelectChannel={onSelectChannel}
                  onToggleFavorite={onToggleFavorite}
                  onCardFocus={handleCardFocus}
                  onCardBlur={handleCardBlur}
                  registerCardRef={registerCardRef}
                />
              );
            })}

            {virtualizeHorizontal && horizWindow.rightSpacerPx > 0 && (
              <div
                key="__live_horiz_spacer_right__"
                data-virtual-spacer="right"
                aria-hidden="true"
                role="presentation"
                className="shrink-0 pointer-events-none select-none"
                style={{ width: `${horizWindow.rightSpacerPx}px`, height: '1px' }}
              />
            )}
          </div>

          <button
            type="button"
            tabIndex={-1}
            data-row-scroll-next="true"
            onClick={() => scrollByAmount(280)}
            className="absolute right-0 top-1 bottom-2 w-9 bg-gradient-to-l from-[#0B0F19] via-[#0B0F19]/80 to-transparent z-10 flex items-center justify-end pr-1.5 opacity-0 group-hover/row:opacity-100 transition-opacity pointer-events-auto"
            aria-label={`Rolar ${formattedTitle} para a direita`}
          >
            <ChevronRight className="w-5 h-5 text-white drop-shadow" />
          </button>
        </div>
      </section>
    );
  }
);

export const LiveTvView: React.FC<LiveTvViewProps> = React.memo(
  ({
    searchQuery = '',
    isTvMode = false,
    launchIntent = null,
    onConsumeLaunchIntent,
  }) => {
    const { getLiveUrl, credentials } = useXtream();
    const { isLoading } = useXtreamCatalogStatus();
    const { liveCategories, liveStreams, ensureLiveLoaded } = useXtreamLiveData();
    const { isFavorite, toggleFavorite } = useFavorites(credentials);
    const { historyMap, recordProgress } = useAccountPlaybackHistory(credentials);
    const { pushFocusMemory, registerBackHandler } = useNavigation();

    useEffect(() => {
      ensureLiveLoaded();
    }, [ensureLiveLoaded]);

    // Channel group & variant selection state
    const [selectedGroup, setSelectedGroup] = useState<LiveChannelGroup | null>(null);
    const [selectedVariantIndex, setSelectedVariantIndex] = useState<number>(0);
    const [isAutoQuality, setIsAutoQuality] = useState<boolean>(true);
    const [isMobilePlayerOpen, setIsMobilePlayerOpen] = useState(false);
    const [isPlayerFullscreen, setIsPlayerFullscreen] = useState(false);

    // EPG state for right pane
    const [epgTimeline, setEpgTimeline] = useState<ResolvedEpgProgram[]>([]);
    const [currentEpgProgram, setCurrentEpgProgram] = useState<ResolvedEpgProgram | null>(null);
    const [loadingEpg, setLoadingEpg] = useState<boolean>(false);
    const [epgError, setEpgError] = useState<boolean>(false);

    // Fallback & Scroll Preservation refs
    const failedVariantsRef = useRef<Set<number>>(new Set());
    const fallbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const leftScrollRef = useRef<HTMLDivElement | null>(null);
    const rowScrollLeftByCatRef = useRef<Map<string, number>>(new Map());
    const [originGroupKey, setOriginGroupKey] = useState<string | null>(null);
    const [originCategoryId, setOriginCategoryId] = useState<string | null>(null);
    const originChannelGroupIdRef = useRef<string | null>(null);
    const originCategoryIdRef = useRef<string | null>(null);
    const originRowIndexRef = useRef<number>(0);
    const originCardIndexRef = useRef<number>(0);
    const variantsRowRef = useRef<HTMLDivElement | null>(null);
    const epgScrollRef = useRef<HTMLDivElement | null>(null);
    const hadFocusInEpgAreaRef = useRef<boolean>(false);

    const handleOriginChange = useCallback(
      (groupKey: string, catId: string, rowIdx: number, cardIdx: number) => {
        originChannelGroupIdRef.current = groupKey;
        originCategoryIdRef.current = catId;
        originRowIndexRef.current = rowIdx;
        originCardIndexRef.current = cardIdx;
        setOriginGroupKey(groupKey);
        setOriginCategoryId(catId);
      },
      []
    );

    const saveRowScrollLeft = useCallback((catId: string, scrollLeft: number) => {
      rowScrollLeftByCatRef.current.set(catId, scrollLeft);
    }, []);

    // Ensure focused button in "Versão do canal" strip is scrolled into horizontal view
    const ensureVariantButtonVisible = useCallback((btn: HTMLElement | null) => {
      const row = variantsRowRef.current;
      if (!row || !btn) return;
      const rowRect = row.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      if (rowRect.width <= 0 || btnRect.width <= 0) return;

      const pad = 8;
      if (btnRect.left < rowRect.left + pad) {
        const delta = btnRect.left - (rowRect.left + pad);
        row.scrollLeft = Math.max(0, row.scrollLeft + delta);
      } else if (btnRect.right > rowRect.right - pad) {
        const delta = btnRect.right - (rowRect.right - pad);
        row.scrollLeft = Math.max(0, row.scrollLeft + delta);
      }
    }, []);

    // Active XtreamStream derived from selectedGroup + selectedVariantIndex
    const selectedChannel: XtreamStream | null = useMemo(() => {
      if (!selectedGroup || selectedGroup.variants.length === 0) return null;
      const safeIdx = Math.min(selectedVariantIndex, selectedGroup.variants.length - 1);
      return selectedGroup.variants[safeIdx]?.stream || selectedGroup.representative;
    }, [selectedGroup, selectedVariantIndex]);

    const activeVariant: ChannelVariant | null = useMemo(() => {
      if (!selectedGroup || selectedGroup.variants.length === 0) return null;
      const safeIdx = Math.min(selectedVariantIndex, selectedGroup.variants.length - 1);
      return selectedGroup.variants[safeIdx] || null;
    }, [selectedGroup, selectedVariantIndex]);

    // Pre-indexed Live catalog
    const liveIndex = useMemo(() => getOrCreateLiveIndex(liveStreams), [liveStreams]);
    const allGroupedChannels = liveIndex.allGroups;

    // Favorite channel groups
    const favoriteGroups = useMemo(() => {
      return allGroupedChannels.filter((group) =>
        group.variants.some((v) => isFavorite(v.stream.stream_id, 'live'))
      );
    }, [allGroupedChannels, isFavorite]);

    // Recently watched channel groups
    const recentGroups = useMemo(() => {
      const liveEntries = Object.values(historyMap)
        .filter((e) => e.type === 'live')
        .sort((a, b) => b.updatedAt - a.updatedAt);

      const seenGroups = new Set<string>();
      const result: LiveChannelGroup[] = [];

      for (const entry of liveEntries) {
        const foundGroup = liveIndex.groupByStreamId.get(String(entry.id));
        if (foundGroup && !seenGroups.has(foundGroup.groupKey)) {
          seenGroups.add(foundGroup.groupKey);
          result.push(foundGroup);
        }
      }
      return result;
    }, [liveIndex, historyMap]);

    // Build vertical list of category rows (virtual categories + real categories)
    const categoryRows = useMemo<LiveCategoryRowDescriptor[]>(() => {
      const trimmedQuery = searchQuery.trim().toLowerCase();
      const matchesQuery = (group: LiveChannelGroup): boolean => {
        if (!trimmedQuery) return true;
        if (group.displayName.toLowerCase().includes(trimmedQuery)) return true;
        return group.variants.some((v) =>
          String(v.stream.name || '')
            .toLowerCase()
            .includes(trimmedQuery)
        );
      };

      const rows: LiveCategoryRowDescriptor[] = [];

      const filteredRecent = recentGroups.filter(matchesQuery);
      if (filteredRecent.length > 0) {
        rows.push({
          categoryId: 'recent',
          rawCategoryName: 'Assistidos Recentemente',
          formattedTitle: formatLiveTvCategoryTitle('Assistidos Recentemente'),
          groups: filteredRecent,
        });
      }

      const filteredFavorites = favoriteGroups.filter(matchesQuery);
      if (filteredFavorites.length > 0) {
        rows.push({
          categoryId: 'favorites',
          rawCategoryName: 'Canais Favoritos',
          formattedTitle: formatLiveTvCategoryTitle('Canais Favoritos'),
          groups: filteredFavorites,
        });
      }

      for (const cat of liveCategories) {
        const catGroups = liveIndex.getGroupsByCategory(cat.category_id);
        const filtered = trimmedQuery ? catGroups.filter(matchesQuery) : catGroups;
        if (filtered.length > 0) {
          rows.push({
            categoryId: cat.category_id,
            rawCategoryName: cat.category_name,
            formattedTitle: formatLiveTvCategoryTitle(cat.category_name),
            groups: filtered,
          });
        }
      }

      // Fallback if provider returned streams without matching liveCategories
      if (rows.length === 0 && allGroupedChannels.length > 0) {
        const filteredAll = trimmedQuery
          ? allGroupedChannels.filter(matchesQuery)
          : allGroupedChannels;
        if (filteredAll.length > 0) {
          rows.push({
            categoryId: 'all',
            rawCategoryName: 'Canais Ao Vivo',
            formattedTitle: formatLiveTvCategoryTitle('Canais Ao Vivo'),
            groups: filteredAll,
          });
        }
      }

      return rows;
    }, [liveCategories, liveIndex, recentGroups, favoriteGroups, allGroupedChannels, searchQuery]);

    // Vertical virtualization of category rows when catalog has many categories
    const shouldVirtualizeRows = categoryRows.length > VERTICAL_VIRTUALIZE_THRESHOLD;
    const {
      startIndex: rowStartIndex,
      endIndex: rowEndIndex,
      topSpacerPx: rowTopSpacerPx,
      bottomSpacerPx: rowBottomSpacerPx,
      ensureIndexMounted: ensureCategoryRowMounted,
    } = useVirtualWindow({
      totalCount: categoryRows.length,
      columns: 1,
      estimatedRowHeight: CATEGORY_ROW_ESTIMATED_HEIGHT_PX,
      overscanRows: 3,
      enabled: shouldVirtualizeRows,
      scrollContainerRef: leftScrollRef,
    });

    // Register showcaseRowController on the left pane scroll container for vertical D-Pad navigation
    useLayoutEffect(() => {
      const containerEl = leftScrollRef.current;
      if (!containerEl || categoryRows.length === 0) return;

      registerShowcaseRowController(containerEl, {
        totalRows: categoryRows.length,
        ensureRowMounted: (targetRowIdx: number, fromRowIdx?: number) => {
          if (!shouldVirtualizeRows) return false;
          return ensureCategoryRowMounted(targetRowIdx, fromRowIdx);
        },
      });

      return () => {
        unregisterShowcaseRowController(containerEl);
      };
    }, [categoryRows.length, shouldVirtualizeRows, ensureCategoryRowMounted]);

    // Track which category rows are vertically visible in the left scroll container
    const [verticallyVisibleRowIndices, setVerticallyVisibleRowIndices] = useState<Set<number>>(
      () => new Set([0, 1, 2, 3, 4])
    );

    const effectiveRowStart = shouldVirtualizeRows
      ? Math.max(0, Math.min(categoryRows.length, rowStartIndex))
      : 0;
    const effectiveRowEnd = shouldVirtualizeRows
      ? Math.max(effectiveRowStart, Math.min(categoryRows.length, rowEndIndex))
      : categoryRows.length;

    useEffect(() => {
      const rootEl = leftScrollRef.current;
      if (!rootEl || categoryRows.length === 0) return;

      const unsubs: Array<() => void> = [];
      for (let rIdx = effectiveRowStart; rIdx < effectiveRowEnd; rIdx++) {
        const rowEl = rootEl.querySelector<HTMLElement>(`[data-home-row-index="${rIdx}"]`);
        if (!rowEl) continue;

        const unsub = observeContainerVisibility({
          target: rowEl,
          root: rootEl,
          rootMargin: '160px 0px 160px 0px',
          axis: 'vertical',
          index: rIdx,
          onIntersectChange: (vis) => {
            setVerticallyVisibleRowIndices((prev) => {
              const has = prev.has(rIdx);
              if (vis === has) return prev;
              const next = new Set(prev);
              if (vis) next.add(rIdx);
              else next.delete(rIdx);
              return next;
            });
          },
        });
        unsubs.push(unsub);
      }

      return () => {
        unsubs.forEach((u) => u());
      };
    }, [categoryRows, effectiveRowStart, effectiveRowEnd]);

    // Pick initial variant in Automatic mode (SD -> HD -> FHD -> 4K)
    const getAutoInitialVariantIndex = useCallback((variants: ChannelVariant[]): number => {
      if (variants.length <= 1) return 0;
      const non4kIdx = variants.findIndex((v) => v.quality !== '4K');
      return non4kIdx !== -1 ? non4kIdx : 0;
    }, []);

    // Select a channel group and start preview
    const selectChannelGroup = useCallback(
      (
        group: LiveChannelGroup,
        categoryId?: string,
        rowIdx?: number,
        cardIdx?: number
      ) => {
        if (fallbackTimeoutRef.current) {
          clearTimeout(fallbackTimeoutRef.current);
          fallbackTimeoutRef.current = null;
        }
        failedVariantsRef.current.clear();
        originChannelGroupIdRef.current = group.groupKey;
        setOriginGroupKey(group.groupKey);
        if (categoryId !== undefined) {
          originCategoryIdRef.current = categoryId;
          setOriginCategoryId(categoryId);
        }
        if (typeof rowIdx === 'number' && rowIdx >= 0) {
          originRowIndexRef.current = rowIdx;
        }
        if (typeof cardIdx === 'number' && cardIdx >= 0) {
          originCardIndexRef.current = cardIdx;
        }
        setSelectedGroup(group);
        setIsAutoQuality(true);
        const initialIdx = getAutoInitialVariantIndex(group.variants);
        setSelectedVariantIndex(initialIdx);
      },
      [getAutoInitialVariantIndex]
    );

    // Handle direct channel launch intent from HomeView
    useEffect(() => {
      if (!launchIntent || allGroupedChannels.length === 0) return;

      let matchedGroup: LiveChannelGroup | undefined;

      if (launchIntent.streamId !== undefined && launchIntent.streamId !== null) {
        matchedGroup = liveIndex.groupByStreamId.get(String(launchIntent.streamId));
      }

      if (!matchedGroup && launchIntent.groupKey) {
        matchedGroup = allGroupedChannels.find((g) => g.groupKey === launchIntent.groupKey);
      }

      if (!matchedGroup && launchIntent.channelName) {
        const targetName = launchIntent.channelName.trim().toLowerCase();
        matchedGroup = allGroupedChannels.find(
          (g) =>
            g.displayName.toLowerCase() === targetName ||
            g.variants.some((v) => String(v.stream.name || '').toLowerCase() === targetName)
        );
      }

      if (matchedGroup) {
        const targetRowIdx = categoryRows.findIndex((r) =>
          r.groups.some((g) => g.groupKey === matchedGroup!.groupKey)
        );
        const resolvedRowIdx = targetRowIdx >= 0 ? targetRowIdx : 0;
        const resolvedCatId =
          targetRowIdx >= 0
            ? categoryRows[targetRowIdx].categoryId
            : String(
                launchIntent.categoryId ||
                  matchedGroup.representative.category_id ||
                  liveCategories[0]?.category_id ||
                  'all'
              );
        const resolvedCardIdx =
          targetRowIdx >= 0
            ? Math.max(
                0,
                categoryRows[targetRowIdx].groups.findIndex(
                  (g) => g.groupKey === matchedGroup!.groupKey
                )
              )
            : 0;

        selectChannelGroup(matchedGroup, resolvedCatId, resolvedRowIdx, resolvedCardIdx);
        if (typeof window !== 'undefined' && window.innerWidth < 768) {
          setIsMobilePlayerOpen(true);
        }
      }

      onConsumeLaunchIntent?.();
    }, [
      launchIntent,
      allGroupedChannels,
      liveIndex,
      categoryRows,
      liveCategories,
      selectChannelGroup,
      onConsumeLaunchIntent,
    ]);

    // Focus the origin channel card when launched from HomeView
    useEffect(() => {
      if (!selectedGroup || !originChannelGroupIdRef.current) return;
      const timer = setTimeout(() => {
        const container = leftScrollRef.current;
        if (!container) return;
        const activeEl = document.activeElement as HTMLElement | null;
        if (activeEl && container.contains(activeEl)) return;

        const targetBtn =
          container.querySelector<HTMLButtonElement>(
            `button[data-live-channel-origin="true"]`
          ) ||
          container.querySelector<HTMLButtonElement>(
            `button[data-live-channel-selected="true"]`
          );
        if (targetBtn && isElementFocusable(targetBtn)) {
          targetBtn.focus();
        }
      }, 40);
      return () => clearTimeout(timer);
    }, [selectedGroup]);

    const selectVariantManual = useCallback((index: number) => {
      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current);
        fallbackTimeoutRef.current = null;
      }
      failedVariantsRef.current.clear();
      setIsAutoQuality(false);
      setSelectedVariantIndex(index);
    }, []);

    const enableAutoQuality = useCallback(() => {
      if (!selectedGroup) return;
      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current);
        fallbackTimeoutRef.current = null;
      }
      failedVariantsRef.current.clear();
      setIsAutoQuality(true);
      const initialIdx = getAutoInitialVariantIndex(selectedGroup.variants);
      setSelectedVariantIndex(initialIdx);
    }, [selectedGroup, getAutoInitialVariantIndex]);

    const handleStreamSuccess = useCallback(() => {
      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current);
        fallbackTimeoutRef.current = null;
      }
      if (selectedChannel && selectedGroup) {
        recordProgress(
          {
            id: selectedChannel.stream_id,
            type: 'live',
            name: selectedGroup.displayName,
            icon: selectedChannel.stream_icon || selectedGroup.representative.stream_icon,
            streamId: selectedChannel.stream_id,
            categoryId: selectedChannel.category_id,
            groupKey: selectedGroup.groupKey,
          },
          10,
          100
        );
      }
    }, [selectedChannel, selectedGroup, recordProgress]);

    // Automatic variant fallback (SD -> HD -> FHD -> 4K)
    const triggerVariantFallback = useCallback(() => {
      if (!selectedGroup || !isAutoQuality || selectedGroup.variants.length <= 1) {
        return false;
      }

      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current);
        fallbackTimeoutRef.current = null;
      }

      failedVariantsRef.current.add(selectedVariantIndex);

      let nextIdx = -1;
      for (let offset = 1; offset < selectedGroup.variants.length; offset++) {
        const candidate = (selectedVariantIndex + offset) % selectedGroup.variants.length;
        if (!failedVariantsRef.current.has(candidate)) {
          nextIdx = candidate;
          break;
        }
      }

      if (nextIdx !== -1) {
        setSelectedVariantIndex(nextIdx);
        return true;
      }
      return false;
    }, [selectedGroup, isAutoQuality, selectedVariantIndex]);

    useEffect(() => {
      if (!selectedGroup || !isAutoQuality || selectedGroup.variants.length <= 1) {
        return;
      }

      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current);
      }

      fallbackTimeoutRef.current = setTimeout(() => {
        triggerVariantFallback();
      }, LIVE_FALLBACK_TIMEOUT_MS);

      return () => {
        if (fallbackTimeoutRef.current) {
          clearTimeout(fallbackTimeoutRef.current);
          fallbackTimeoutRef.current = null;
        }
      };
    }, [selectedGroup, isAutoQuality, selectedVariantIndex, triggerVariantFallback]);

    // Subscribe right-pane EPG to the active channel stream via LiveEpgManager
    useEffect(() => {
      if (!selectedChannel || !credentials) {
        setEpgTimeline([]);
        setCurrentEpgProgram(null);
        setLoadingEpg(false);
        setEpgError(false);
        return;
      }

      const streamId = selectedChannel.stream_id;
      const cached = getCachedLiveEpgSnapshot(credentials, streamId);
      if (cached) {
        setCurrentEpgProgram(cached.currentProgram);
        setEpgTimeline(cached.timeline);
        setLoadingEpg(false);
        setEpgError(cached.status === 'error');
        return;
      }

      setLoadingEpg(true);
      setEpgError(false);

      const unsubscribe = subscribeLiveChannelEpg({
        credentials,
        streamId,
        priority: 'high',
        onUpdate: (snapshot) => {
          setCurrentEpgProgram(snapshot.currentProgram);
          setEpgTimeline(snapshot.timeline);
          setLoadingEpg(false);
          setEpgError(snapshot.status === 'error');
        },
      });

      return () => {
        unsubscribe();
      };
    }, [selectedChannel, credentials]);

    // Reset EPG scroll to top when switching channel
    useEffect(() => {
      if (epgScrollRef.current) {
        epgScrollRef.current.scrollTop = 0;
        delete (epgScrollRef.current as any).__ncDpadTargetTop;
      }
    }, [selectedChannel?.stream_id]);

    // Preserve focus inside EPG schedule area when loading transitions to empty/ok/error
    useEffect(() => {
      if (loadingEpg || !hadFocusInEpgAreaRef.current) return;
      const scrollEl = epgScrollRef.current;
      if (!scrollEl) return;

      const activeEl = document.activeElement as HTMLElement | null;
      const focusLost =
        !activeEl ||
        activeEl === document.body ||
        activeEl === document.documentElement ||
        !activeEl.isConnected;

      if (focusLost || scrollEl.contains(activeEl)) {
        const target =
          scrollEl.querySelector<HTMLElement>('[data-epg-primary="true"]') ||
          scrollEl.querySelector<HTMLElement>('[data-epg-item="true"]') ||
          scrollEl.querySelector<HTMLElement>('[data-epg-state]');
        if (target && target !== document.activeElement) {
          target.focus();
        }
      }
    }, [loadingEpg, epgTimeline.length, epgError, selectedChannel?.stream_id]);

    const focusOriginChannelRow = useCallback((groupKey: string | null): boolean => {
      const container = leftScrollRef.current;
      if (!container) return false;

      if (shouldVirtualizeRows && originRowIndexRef.current >= 0) {
        ensureCategoryRowMounted(originRowIndexRef.current);
      }

      const targetBtn =
        (groupKey
          ? container.querySelector<HTMLButtonElement>(
              `button[data-live-channel-origin="true"][data-live-channel-group-id="${CSS.escape(groupKey)}"]`
            ) ||
            container.querySelector<HTMLButtonElement>(
              `button[data-live-channel-btn="true"][data-live-channel-group-id="${CSS.escape(groupKey)}"]`
            )
          : null) ||
        container.querySelector<HTMLButtonElement>('button[data-live-channel-origin="true"]') ||
        container.querySelector<HTMLButtonElement>('button[data-live-channel-selected="true"]') ||
        container.querySelector<HTMLButtonElement>('button[data-live-channel-btn="true"]');

      if (targetBtn && isElementFocusable(targetBtn)) {
        targetBtn.focus();
        return true;
      }
      return false;
    }, [shouldVirtualizeRows, ensureCategoryRowMounted]);

    // Register hierarchical Back handler:
    // 1. Fullscreen -> exit to preview & restore focus to channel card
    // 2. Mobile player overlay -> close mobile player & return to channels
    // 3. Preview active -> close preview & restore focus to channel card
    useEffect(() => {
      return registerBackHandler(() => {
        if (isPlayerFullscreen) {
          const targetGroupKey =
            originChannelGroupIdRef.current || selectedGroup?.groupKey || null;
          setIsPlayerFullscreen(false);
          setTimeout(() => {
            focusOriginChannelRow(targetGroupKey);
          }, 0);
          return true;
        }
        if (isMobilePlayerOpen) {
          const targetGroupKey =
            originChannelGroupIdRef.current || selectedGroup?.groupKey || null;
          setIsMobilePlayerOpen(false);
          setTimeout(() => {
            focusOriginChannelRow(targetGroupKey);
          }, 0);
          return true;
        }
        if (selectedGroup) {
          const targetGroupKey = originChannelGroupIdRef.current || selectedGroup.groupKey;
          setSelectedGroup(null);
          setTimeout(() => {
            focusOriginChannelRow(targetGroupKey);
          }, 0);
          return true;
        }
        return false;
      });
    }, [
      registerBackHandler,
      isPlayerFullscreen,
      isMobilePlayerOpen,
      selectedGroup,
      focusOriginChannelRow,
    ]);

    const handleCardSelect = useCallback(
      (
        group: LiveChannelGroup,
        categoryId: string,
        rowIdx: number,
        cardIdx: number,
        btnEl: HTMLButtonElement
      ) => {
        pushFocusMemory(btnEl);
        handleOriginChange(group.groupKey, categoryId, rowIdx, cardIdx);

        const isDesktop =
          typeof window === 'undefined' ||
          window.innerWidth === 0 ||
          window.innerWidth >= 768;

        if (isDesktop) {
          if (selectedGroup?.groupKey === group.groupKey) {
            if (!isPlayerFullscreen) {
              setIsPlayerFullscreen(true);
            }
          } else {
            selectChannelGroup(group, categoryId, rowIdx, cardIdx);
          }
          return;
        }

        if (selectedGroup?.groupKey !== group.groupKey) {
          selectChannelGroup(group, categoryId, rowIdx, cardIdx);
        }
        setIsMobilePlayerOpen(true);
      },
      [pushFocusMemory, selectedGroup, isPlayerFullscreen, selectChannelGroup]
    );

    const handleToggleFavorite = useCallback(
      (group: LiveChannelGroup) => {
        toggleFavorite({
          ...group.representative,
          type: 'live',
          name: group.displayName,
        });
      },
      [toggleFavorite]
    );

    const visibleCategoryRows = shouldVirtualizeRows
      ? categoryRows.slice(effectiveRowStart, effectiveRowEnd)
      : categoryRows;

    if (isLoading) {
      return (
        <div className="flex flex-1 items-center justify-center h-full bg-transparent">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-10 h-10 text-white animate-spin" />
            <p className="text-gray-400 text-sm animate-pulse">
              Carregando canais e guia de programação...
            </p>
          </div>
        </div>
      );
    }

    return (
      <div
        data-live-split-root="true"
        className="flex flex-1 w-full h-full min-h-0 overflow-hidden bg-transparent text-white relative"
      >
        {/* LEFT PANE (~50%): Continuous Vertical Stack of Horizontal Category Rows */}
        <div
          data-nav-zone="categories"
          data-live-left-pane="true"
          className={`${
            isMobilePlayerOpen ? 'hidden md:flex' : 'flex'
          } nc-live-left-pane nc-tv-category-pane w-full md:w-1/2 md:max-w-[50%] md:flex-[0_0_50%] flex-col border-r border-white/[0.06] bg-[#0B0F19]/45 backdrop-blur-md z-10 h-full min-h-0 overflow-hidden`}
        >
          <div className="px-4 md:px-5 pt-3 pb-2.5 border-b border-white/[0.06] shrink-0 flex items-center justify-between gap-3">
            <h2
              data-live-categories-heading="true"
              className="nc-heading-view font-extrabold text-white tracking-tight truncate"
            >
              Categorias De TV
            </h2>
            {searchQuery.trim().length > 0 && (
              <span className="text-xs text-gray-400 truncate">
                Busca: &ldquo;{searchQuery.trim()}&rdquo;
              </span>
            )}
          </div>

          <div
            ref={leftScrollRef}
            data-scroll-container="true"
            data-showcase-rows-container="true"
            data-showcase-total-rows={categoryRows.length}
            data-live-origin-row-index={originRowIndexRef.current}
            data-live-origin-card-index={originCardIndexRef.current}
            className="flex-1 overflow-y-auto overflow-x-hidden px-3 md:px-4 py-3 space-y-5 scrollbar-hide min-h-0"
          >
            {categoryRows.length === 0 ? (
              <div
                data-live-empty-catalog="true"
                className="flex flex-col items-center justify-center py-16 px-4 text-center text-gray-400"
              >
                <Tv className="w-10 h-10 text-gray-600 mb-3" />
                <p className="text-sm font-medium text-gray-300">
                  {searchQuery.trim()
                    ? 'Nenhum canal encontrado para a busca atual.'
                    : 'Nenhuma categoria de canais disponível no momento.'}
                </p>
              </div>
            ) : (
              <>
                {shouldVirtualizeRows && rowTopSpacerPx > 0 && (
                  <div
                    key="__live_cat_spacer_top__"
                    data-virtual-spacer="top"
                    aria-hidden="true"
                    role="presentation"
                    style={{ height: `${rowTopSpacerPx}px` }}
                  />
                )}

                {visibleCategoryRows.map((rowDesc, offset) => {
                  const rowIndex = effectiveRowStart + offset;
                  const isRowVisible =
                    !shouldVirtualizeRows ||
                    verticallyVisibleRowIndices.has(rowIndex) ||
                    rowIndex < effectiveRowStart + 4;

                  return (
                    <LiveCategoryRow
                      key={rowDesc.categoryId}
                      rowDescriptor={rowDesc}
                      rowIndex={rowIndex}
                      selectedGroupKey={selectedGroup?.groupKey ?? null}
                      originGroupKey={originGroupKey}
                      originCategoryId={originCategoryId}
                      credentials={credentials}
                      isRowVerticallyVisible={isRowVisible}
                      isFavoriteFn={isFavorite}
                      onSelectChannel={handleCardSelect}
                      onToggleFavorite={handleToggleFavorite}
                      onOriginChange={handleOriginChange}
                      savedScrollLeft={
                        rowScrollLeftByCatRef.current.get(rowDesc.categoryId) || 0
                      }
                      onSaveScrollLeft={saveRowScrollLeft}
                    />
                  );
                })}

                {shouldVirtualizeRows && rowBottomSpacerPx > 0 && (
                  <div
                    key="__live_cat_spacer_bottom__"
                    data-virtual-spacer="bottom"
                    aria-hidden="true"
                    role="presentation"
                    style={{ height: `${rowBottomSpacerPx}px` }}
                  />
                )}
              </>
            )}
          </div>
        </div>

        {/* RIGHT PANE (~50%): Channel Details, Quality Selector, 16:9 Preview & EPG Schedule */}
        <div
          data-nav-zone="content"
          data-live-right-pane="true"
          className={`${
            !isMobilePlayerOpen ? 'hidden md:flex' : 'flex'
          } nc-live-right-pane w-full md:w-1/2 md:max-w-[50%] md:flex-[0_0_50%] flex-1 flex-col bg-[#080a0f]/80 h-full min-h-0 overflow-y-auto md:overflow-hidden touch-pan-y relative z-10`}
        >
          {selectedGroup && selectedChannel ? (
            <div
              data-live-content-stack="true"
              className="flex flex-col flex-1 w-full h-full min-h-0 md:overflow-hidden"
            >
              {isMobilePlayerOpen && (
                <div className="md:hidden flex items-center gap-2 px-4 py-3 bg-black/80 border-b border-white/[0.06] shrink-0">
                  <button
                    type="button"
                    data-mobile-back="true"
                    onClick={() => {
                      const targetGroupKey =
                        originChannelGroupIdRef.current || selectedGroup.groupKey;
                      setIsMobilePlayerOpen(false);
                      setTimeout(() => {
                        focusOriginChannelRow(targetGroupKey);
                      }, 0);
                    }}
                    className="flex items-center gap-2 text-sm font-medium text-gray-300 hover:text-white bg-white/[0.06] px-3 py-1.5 rounded-lg"
                  >
                    <ChevronLeft className="w-4 h-4" /> Voltar aos Canais
                  </button>
                  <span className="text-sm font-bold text-white truncate ml-2">
                    {selectedGroup.displayName}
                  </span>
                </div>
              )}

              {/* Top Section: 16:9 Video Preview + Channel Info + Variant Selector + Current Program */}
              <div
                data-live-top-section="true"
                className="nc-live-top-section flex flex-col md:flex-row gap-3 md:gap-4 p-3 md:p-4 bg-gradient-to-b from-white/[0.03] to-transparent border-b border-white/[0.06] shrink-0 items-start md:items-center min-w-0"
              >
                <div
                  data-live-preview-box="true"
                  className="nc-live-preview-box w-full md:w-64 lg:w-72 aspect-video bg-black rounded-xl overflow-hidden shadow-2xl border border-white/10 relative shrink-0"
                >
                  <VideoPlayer
                    url={getLiveUrl(selectedChannel.stream_id)}
                    title={
                      activeVariant && activeVariant.quality !== 'UNKNOWN'
                        ? `${selectedGroup.displayName} (${activeVariant.label})`
                        : selectedGroup.displayName
                    }
                    poster={selectedChannel.stream_icon}
                    isLive={true}
                    embedded={!isPlayerFullscreen}
                    disableEmbeddedControlsFocus={true}
                    isTvMode={isTvMode}
                    onClose={() => {
                      if (isPlayerFullscreen) {
                        const targetGroupKey =
                          originChannelGroupIdRef.current || selectedGroup.groupKey;
                        setIsPlayerFullscreen(false);
                        setTimeout(() => {
                          focusOriginChannelRow(targetGroupKey);
                        }, 0);
                      } else {
                        const targetGroupKey =
                          originChannelGroupIdRef.current || selectedGroup.groupKey;
                        setSelectedGroup(null);
                        setIsMobilePlayerOpen(false);
                        setTimeout(() => {
                          focusOriginChannelRow(targetGroupKey);
                        }, 0);
                      }
                    }}
                    onToggleFullscreen={() => setIsPlayerFullscreen((prev) => !prev)}
                    onStreamFailure={triggerVariantFallback}
                    onStreamSuccess={handleStreamSuccess}
                  />
                </div>

                <div className="flex-1 flex flex-col justify-center min-w-0 w-full">
                  <div className="flex items-center gap-2.5 mb-1.5 min-w-0">
                    <div className="nc-live-channel-logo w-10 h-10 md:w-11 md:h-11 rounded-xl bg-black/40 border border-white/[0.08] flex items-center justify-center p-1.5 shrink-0">
                      <MediaImage
                        src={selectedChannel.stream_icon}
                        serverUrl={credentials?.serverUrl}
                        alt={selectedGroup.displayName}
                        itemId={selectedChannel.stream_id}
                        itemName={selectedGroup.displayName}
                        className="w-full h-full object-contain"
                        fallbackIcon={<Tv className="w-5 h-5 text-gray-600" />}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h1 className="nc-live-channel-title nc-heading-section font-bold text-white line-clamp-2 whitespace-normal break-words w-full">
                          {selectedGroup.displayName}
                        </h1>
                        {activeVariant && activeVariant.quality !== 'UNKNOWN' && (
                          <span
                            className={`text-xs font-bold px-2 py-0.5 rounded-md border shrink-0 ${
                              QUALITY_BADGE_STYLES[activeVariant.quality]
                            }`}
                          >
                            {activeVariant.label}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Quality / Variant Selector */}
                  {selectedGroup.variants.length > 1 && (
                    <div
                      ref={variantsRowRef}
                      data-nav-row="true"
                      data-live-variants-row="true"
                      className="flex items-center gap-1.5 mb-2 flex-nowrap overflow-x-auto scrollbar-hide pb-0.5 max-w-full"
                    >
                      <span className="text-xs font-medium text-gray-400 flex items-center gap-1 mr-1 shrink-0">
                        <Layers className="w-3.5 h-3.5 text-gray-400" /> Versão do canal:
                      </span>
                      <button
                        type="button"
                        data-variant-btn="true"
                        data-variant-mode="auto"
                        data-variant-active={isAutoQuality ? 'true' : 'false'}
                        onClick={enableAutoQuality}
                        onFocus={(e) => ensureVariantButtonVisible(e.currentTarget)}
                        className={`text-xs font-semibold px-2.5 py-1 rounded-lg border transition-all shrink-0 cursor-pointer ${
                          isAutoQuality
                            ? 'bg-white text-black border-white shadow-sm'
                            : 'bg-white/[0.04] text-gray-400 border-white/10 hover:text-white hover:bg-white/[0.08]'
                        }`}
                      >
                        Automático
                      </button>
                      {selectedGroup.variants.map((variant, idx) => {
                        const isCurrentVariant =
                          !isAutoQuality && selectedVariantIndex === idx;
                        return (
                          <button
                            key={variant.stream.stream_id}
                            type="button"
                            data-variant-btn="true"
                            data-variant-index={idx}
                            data-variant-active={isCurrentVariant ? 'true' : 'false'}
                            onClick={() => selectVariantManual(idx)}
                            onFocus={(e) => ensureVariantButtonVisible(e.currentTarget)}
                            className={`text-xs font-semibold px-2.5 py-1 rounded-lg border transition-all flex items-center gap-1.5 shrink-0 cursor-pointer ${
                              isCurrentVariant
                                ? 'bg-white text-black border-white shadow-sm'
                                : selectedVariantIndex === idx && isAutoQuality
                                  ? 'bg-white/15 text-white border-white/40'
                                  : 'bg-white/[0.04] text-gray-400 border-white/10 hover:text-white hover:bg-white/[0.08]'
                            }`}
                          >
                            <span>{variant.label}</span>
                            {selectedVariantIndex === idx && isAutoQuality && (
                              <span
                                className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"
                                title="Reproduzindo no modo automático"
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Currently Airing Program Box */}
                  <div
                    data-live-now-playing="true"
                    className="nc-live-now-playing bg-white/[0.03] border border-white/[0.06] rounded-xl p-2.5 backdrop-blur-md"
                  >
                    <div className="flex items-center gap-2 text-gray-300 text-xs font-bold uppercase tracking-wider mb-0.5">
                      <Play className="w-3 h-3 fill-current shrink-0 text-emerald-400" />
                      <span>Passando Agora</span>
                    </div>
                    {currentEpgProgram ? (
                      <div>
                        <h3
                          data-live-right-current-title="true"
                          className="nc-card-title font-bold text-white line-clamp-1"
                        >
                          {currentEpgProgram.title}
                        </h3>
                        {currentEpgProgram.description && (
                          <p className="nc-live-now-playing-desc nc-meta-text text-gray-400 line-clamp-1 mt-0.5">
                            {currentEpgProgram.description}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p
                        data-live-right-current-empty="true"
                        className="text-gray-500 text-xs italic"
                      >
                        Sem informação de programa atual
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Bottom Section: EPG Timeline / Schedule */}
              <div
                data-live-epg-section="true"
                className="flex-1 flex flex-col w-full min-h-0 md:overflow-hidden"
              >
                <div
                  data-live-epg-header="true"
                  className="nc-live-epg-header px-3 md:px-4 py-2 border-b border-white/[0.06] shrink-0 bg-[#080a0f]/95 z-10"
                >
                  <h2 className="nc-section-title font-bold text-white flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-gray-300 shrink-0" /> Grade de Programação
                  </h2>
                </div>

                <div
                  ref={epgScrollRef}
                  data-scroll-container="true"
                  data-epg-scroll="true"
                  onFocusCapture={() => {
                    hadFocusInEpgAreaRef.current = true;
                  }}
                  onBlurCapture={(e) => {
                    const nextTarget = e.relatedTarget as Node | null;
                    if (
                      nextTarget &&
                      epgScrollRef.current &&
                      !epgScrollRef.current.contains(nextTarget)
                    ) {
                      hadFocusInEpgAreaRef.current = false;
                    }
                  }}
                  className="nc-live-epg-scroll flex-1 overflow-y-auto md:overflow-y-auto px-3 md:px-4 py-2.5 min-h-0"
                >
                  {loadingEpg ? (
                    <div
                      tabIndex={0}
                      role="region"
                      aria-label="Carregando programação"
                      data-nav-item="true"
                      data-epg-primary="true"
                      data-epg-state="loading"
                      className="nc-tv-epg-state flex items-center justify-center py-8 rounded-xl border border-white/[0.06] bg-white/[0.02] outline-none"
                    >
                      <Loader2 className="w-6 h-6 text-white animate-spin" />
                      <span className="ml-2.5 text-sm text-gray-300">
                        Carregando programação...
                      </span>
                    </div>
                  ) : epgError ? (
                    <div
                      tabIndex={0}
                      role="region"
                      aria-label="Programação indisponível no momento"
                      data-nav-item="true"
                      data-epg-primary="true"
                      data-epg-state="error"
                      className="nc-tv-epg-state text-center py-8 bg-white/[0.02] rounded-xl border border-white/[0.06] outline-none"
                    >
                      <Calendar className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                      <p className="text-gray-300 font-medium text-sm">
                        Programação indisponível no momento.
                      </p>
                      <p className="text-gray-500 text-xs mt-1">
                        Não foi possível consultar o guia deste canal agora.
                      </p>
                    </div>
                  ) : epgTimeline.length > 0 ? (
                    <div className="nc-tv-epg-timeline space-y-2.5 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-white/30 before:via-white/10 before:to-transparent">
                      {epgTimeline.map((prog, idx) => {
                        const isCurrent = prog.isCurrent;
                        return (
                          <div
                            key={prog.id || idx}
                            className="nc-tv-epg-row relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group"
                          >
                            <div
                              className={`nc-tv-epg-marker flex items-center justify-center w-3 h-3 rounded-full border-2 shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow ${
                                isCurrent
                                  ? 'bg-emerald-400 border-emerald-950 shadow-[0_0_10px_rgba(52,211,153,0.8)]'
                                  : 'bg-[#080a0f] border-white/20'
                              } absolute left-5 -translate-x-1/2 md:static md:translate-x-0`}
                            />
                            <div
                              tabIndex={0}
                              role="article"
                              data-nav-item="true"
                              data-epg-item="true"
                              data-epg-index={idx}
                              data-epg-current={isCurrent ? 'true' : 'false'}
                              data-epg-primary={idx === 0 ? 'true' : undefined}
                              className={`nc-tv-epg-card w-[calc(100%-2.5rem)] md:w-[calc(50%-1.5rem)] ml-10 md:ml-0 p-3 rounded-xl border transition-all outline-none ${
                                isCurrent
                                  ? 'bg-white/[0.08] border-white/25 shadow-lg'
                                  : 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04]'
                              }`}
                            >
                              <div className="flex items-center justify-between mb-1 gap-2">
                                <span
                                  className={`nc-meta-text font-bold flex items-center gap-1 ${
                                    isCurrent ? 'text-emerald-400' : 'text-gray-400'
                                  }`}
                                >
                                  <Clock className="w-3 h-3 shrink-0" />
                                  {prog.startLabel} - {prog.endLabel}
                                </span>
                                {isCurrent && (
                                  <span className="text-xs font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                                    Ao Vivo
                                  </span>
                                )}
                              </div>
                              <h4 className="nc-card-title font-bold text-white mb-0.5 line-clamp-2 break-words">
                                {prog.title}
                              </h4>
                              {prog.description && (
                                <p className="nc-meta-text text-gray-400 line-clamp-2 break-words">
                                  {prog.description}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div
                      tabIndex={0}
                      role="region"
                      aria-label="Programação não disponível para este canal"
                      data-nav-item="true"
                      data-epg-primary="true"
                      data-epg-state="empty"
                      className="nc-tv-epg-state text-center py-8 bg-white/[0.02] rounded-xl border border-white/[0.06] outline-none"
                    >
                      <Calendar className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                      <p className="text-gray-400 font-medium text-sm">
                        Programação não disponível para este canal.
                      </p>
                      <p className="text-gray-600 text-xs mt-1">
                        O servidor não forneceu dados de EPG válidos.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-500 p-8 text-center">
              <div className="w-20 h-20 rounded-full bg-white/[0.02] border border-white/[0.05] flex items-center justify-center mb-4">
                <Tv className="w-8 h-8 text-gray-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-300 mb-2">Nenhum canal selecionado</h2>
              <p className="text-sm text-gray-500 max-w-md">
                Percorra as categorias e escolha um canal à esquerda para assistir à transmissão
                ao vivo e visualizar a grade de programação.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }
);
