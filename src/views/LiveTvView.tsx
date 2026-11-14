import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import {
  Tv,
  Heart,
  ChevronLeft,
  ChevronRight,
  Clock,
  Radio,
  AlertCircle,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { XtreamCredentials, Category, LiveStream } from '../types';
import { useXtreamCredentials, useXtreamLive } from '../context/XtreamContext';
import { VideoPlayer } from '../components/VideoPlayer';
import { MediaImage, observeContainerVisibility, notifyContainerScrollForFallback } from '../components/MediaImage';
import { useFavorites } from '../hooks/useFavorites';
import { useAccountPlaybackHistory, recordPlaybackPosition } from '../utils/playbackHistory';
import { buildDirectMediaUrl } from '../utils/mediaUtils';
import {
  LiveChannelGroup,
  ChannelVariant,
  ResolutionQuality,
  groupLiveStreams,
  filterLiveChannelGroups,
  parseChannelVariantSuffix,
} from '../utils/liveChannelGroups';
import { getOrCreateLiveIndex } from '../utils/catalogIndex';
import { formatLiveTvCategoryTitle } from '../utils/categoryLabel';
import {
  LiveEpgSnapshot,
  getCachedLiveEpgSnapshot,
  getPreferredEpgStreamIdForGroup,
  subscribeLiveChannelEpg,
} from '../utils/liveEpgManager';
import { useVirtualWindow } from '../hooks/useVirtualWindow';
import {
  useBackHandler,
  BACK_PRIORITY,
  getNavMode,
  focusElementSafely,
  registerVirtualContainer,
  unregisterVirtualContainer,
  registerShowcaseRowController,
  unregisterShowcaseRowController,
  invalidateCandidateCache,
} from '../navigation';

export const AUTO_RESOLUTION_PRIORITY: ResolutionQuality[] = ['SD', 'HD', 'FHD', '4K'];

let liveFallbackTimeoutMs = 28000;

export function setLiveFallbackTimeoutMsForTest(ms: number): void {
  liveFallbackTimeoutMs = Math.max(10, Math.floor(ms || 28000));
}

export function getLiveFallbackTimeoutMsForTest(): number {
  return liveFallbackTimeoutMs;
}

export interface LiveChannelLaunchIntent {
  streamId: string | number;
  requestId: number;
  categoryId?: string;
  streamSnapshot?: any;
}

export interface LiveTvViewProps {
  onPlay?: (...args: any[]) => void;
  searchQuery?: string;
  isTvMode?: boolean;
  initialChannelIntent?: LiveChannelLaunchIntent | null;
  onConsumeChannelIntent?: (requestId: number) => void;
}

interface LiveCategoryRowDescriptor {
  id: string;
  categoryId: string;
  rawTitle: string;
  channels: LiveChannelGroup[];
}

function getGroupPrimaryStream(group: LiveChannelGroup | null | undefined): any {
  if (!group) return null;
  if (group.primaryStream) return group.primaryStream;
  if (Array.isArray(group.variants) && group.variants.length > 0 && group.variants[0]?.stream) {
    return group.variants[0].stream;
  }
  if (Array.isArray(group.allStreams) && group.allStreams.length > 0) {
    return group.allStreams[0];
  }
  return null;
}

function getStreamIdString(stream: any): string {
  const id = stream?.stream_id ?? stream?.id ?? '';
  return id !== undefined && id !== null ? String(id) : '';
}

function collectGroupStreamIds(group: LiveChannelGroup | null | undefined): string[] {
  if (!group) return [];
  const ids = new Set<string>();
  const primary = getStreamIdString(group.primaryStream);
  if (primary) ids.add(primary);
  if (Array.isArray(group.allStreams)) {
    for (const s of group.allStreams) {
      const id = getStreamIdString(s);
      if (id) ids.add(id);
    }
  }
  if (Array.isArray(group.variants)) {
    for (const v of group.variants) {
      const id = v?.streamId !== undefined && v?.streamId !== null
        ? String(v.streamId)
        : getStreamIdString(v?.stream);
      if (id) ids.add(id);
    }
  }
  return Array.from(ids);
}

function buildFallbackGroupFromStream(stream: any, fallbackCategoryId?: string): LiveChannelGroup {
  const sId = stream?.stream_id ?? stream?.id ?? '';
  const catId = stream?.category_id ?? fallbackCategoryId ?? 'default';
  const parsed = parseChannelVariantSuffix(stream?.name);
  return {
    groupId: JSON.stringify(['single', String(catId), String(sId)]),
    displayName: parsed.baseName || (typeof stream?.name === 'string' && stream.name.trim() ? stream.name : 'Canal Ao Vivo'),
    category_id: catId,
    epg_channel_id: stream?.epg_channel_id ? String(stream.epg_channel_id) : undefined,
    stream_icon: stream?.stream_icon,
    isGrouped: false,
    variants: [],
    primaryStream: stream,
    allStreams: [stream],
  };
}

function normalizeGroupCandidates(group: LiveChannelGroup): ChannelVariant[] {
  const seen = new Set<string>();
  const candidates: ChannelVariant[] = [];

  if (Array.isArray(group.variants)) {
    for (const v of group.variants) {
      if (!v || !v.stream) continue;
      const sId = String(v.streamId ?? getStreamIdString(v.stream));
      if (!sId || seen.has(sId)) continue;
      seen.add(sId);
      candidates.push({
        resolution: v.resolution,
        stream: v.stream,
        streamId: v.streamId ?? sId,
        label: v.label || v.resolution || 'SD',
      });
    }
  }

  const extraStreams: any[] = [];
  if (group.primaryStream) extraStreams.push(group.primaryStream);
  if (Array.isArray(group.allStreams)) extraStreams.push(...group.allStreams);

  for (const s of extraStreams) {
    if (!s || typeof s !== 'object') continue;
    const sId = getStreamIdString(s);
    if (!sId || seen.has(sId)) continue;
    seen.add(sId);
    const parsed = parseChannelVariantSuffix(s.name);
    const res: ResolutionQuality = parsed.resolution || 'SD';
    candidates.push({
      resolution: res,
      stream: s,
      streamId: s.stream_id ?? s.id ?? sId,
      label: res,
    });
  }

  return candidates;
}

export interface LiveTvLayoutMetricsInput {
  viewportWidth: number;
  viewportHeight: number;
  uiScale: number;
  displayMode: 'default' | 'tv';
  isGrouped: boolean;
  hasNowPlaying: boolean;
  epgCount: number;
}

export interface LiveTvLayoutMetrics {
  isMobile: boolean;
  topSectionDirection: 'row' | 'column';
  rightPaneWidth: number;
  previewWidth: number;
  previewHeight: number;
  previewAspectRatio: number;
  topSectionHeight: number;
  epgHeaderHeight: number;
  epgSectionHeight: number;
  epgScrollViewportHeight: number;
  epgCardHeight: number;
  epgTotalContentHeight: number;
  visibleEpgCardsCount: number;
  epgMaxScrollTop: number;
}

export function computeLiveTvLayoutMetrics(input: LiveTvLayoutMetricsInput): LiveTvLayoutMetrics {
  const {
    viewportWidth,
    viewportHeight,
    uiScale,
    displayMode,
    isGrouped,
    hasNowPlaying,
    epgCount,
  } = input;

  const isMobile = viewportWidth < 768;
  const scale = Math.max(0.5, Math.min(1.25, uiScale || 1));
  const topHeaderHeight = isMobile ? Math.round(92 * scale) : Math.round(68 * scale);
  const availableHeight = Math.max(320, viewportHeight - topHeaderHeight);
  const rightPaneWidth = isMobile ? viewportWidth : Math.round(viewportWidth * 0.5);
  const topSectionDirection: 'row' | 'column' = isMobile ? 'column' : 'row';

  const previewWidth = isMobile
    ? Math.max(240, rightPaneWidth - 32)
    : Math.max(176, Math.min(Math.round(viewportWidth * 0.22), Math.round(336 * scale)));
  const previewHeight = Math.round((previewWidth * 9) / 16);
  const previewAspectRatio = previewHeight > 0 ? previewWidth / previewHeight : 16 / 9;

  const extraTopPadding =
    (isGrouped ? Math.round(28 * scale) : 0) + (hasNowPlaying ? Math.round(36 * scale) : 0);
  const topSectionHeight = isMobile
    ? previewHeight + Math.round(130 * scale) + extraTopPadding
    : Math.max(
        previewHeight + Math.round(28 * scale),
        Math.min(
          Math.round(availableHeight * 0.42),
          Math.round((displayMode === 'tv' ? 148 : 164) * scale + extraTopPadding * 0.35)
        )
      );

  const epgHeaderHeight = Math.max(30, Math.round(38 * scale));
  const epgSectionHeight = Math.max(260, availableHeight - topSectionHeight);
  const epgScrollViewportHeight = Math.max(220, epgSectionHeight - epgHeaderHeight);
  const epgCardHeight = Math.max(58, Math.round(72 * scale));
  const epgCardGap = 10;
  const epgTotalContentHeight = Math.max(0, epgCount * (epgCardHeight + epgCardGap));
  const visibleEpgCardsCount = Number(
    (epgScrollViewportHeight / (epgCardHeight + epgCardGap)).toFixed(2)
  );
  const epgMaxScrollTop = Math.max(0, epgTotalContentHeight - epgScrollViewportHeight);

  return {
    isMobile,
    topSectionDirection,
    rightPaneWidth,
    previewWidth,
    previewHeight,
    previewAspectRatio,
    topSectionHeight,
    epgHeaderHeight,
    epgSectionHeight,
    epgScrollViewportHeight,
    epgCardHeight,
    epgTotalContentHeight,
    visibleEpgCardsCount,
    epgMaxScrollTop,
  };
}

export type SelectedChannelVariantResult = ChannelVariant & {
  stream_id: string | number;
  name?: string;
};

function toSelectedVariantResult(variant: ChannelVariant): SelectedChannelVariantResult {
  const rawStreamId = variant.stream?.stream_id ?? variant.stream?.id ?? variant.streamId;
  return {
    ...variant,
    stream_id: rawStreamId,
    name: variant.stream?.name,
  };
}

/**
 * Selects the best channel variant for playback or fallback without mutating `triedStreamIds`.
 * - Manual mode: tries exact `selectedVariantIdOrAuto`, then siblings of same resolution,
 *   then `AUTO_RESOLUTION_PRIORITY` (`SD -> HD -> FHD -> 4K`), then any remaining untried stream.
 * - Auto mode: tries `AUTO_RESOLUTION_PRIORITY` (`SD -> HD -> FHD -> 4K`), then remaining streams.
 * - Returns `null` once all streams in the group are exhausted.
 */
export function selectChannelVariantForAttempt(
  group: LiveChannelGroup | null | undefined,
  selectedVariantIdOrAuto: string,
  triedStreamIds: ReadonlySet<string | number>
): SelectedChannelVariantResult | null {
  if (!group) return null;
  const candidates = normalizeGroupCandidates(group);
  if (candidates.length === 0) return null;

  const triedStrings = new Set<string>();
  triedStreamIds.forEach((id) => {
    if (id !== undefined && id !== null) {
      triedStrings.add(String(id));
    }
  });

  const untried = candidates.filter((c) => !triedStrings.has(String(c.streamId)));
  if (untried.length === 0) return null;

  if (selectedVariantIdOrAuto && selectedVariantIdOrAuto !== 'auto') {
    const requestedStr = String(selectedVariantIdOrAuto);
    const exactMatch = untried.find((c) => String(c.streamId) === requestedStr);
    if (exactMatch) {
      return toSelectedVariantResult(exactMatch);
    }

    const requestedCandidate = candidates.find((c) => String(c.streamId) === requestedStr);
    if (requestedCandidate?.resolution) {
      const sameRes = untried.find((c) => c.resolution === requestedCandidate.resolution);
      if (sameRes) {
        return toSelectedVariantResult(sameRes);
      }
    }
  }

  for (const res of AUTO_RESOLUTION_PRIORITY) {
    const match = untried.find((c) => c.resolution === res);
    if (match) {
      return toSelectedVariantResult(match);
    }
  }

  return untried[0] ? toSelectedVariantResult(untried[0]) : null;
}

function getStreamResolutionLabel(stream: any, group?: LiveChannelGroup | null): ResolutionQuality | null {
  if (!stream) return null;
  const sId = getStreamIdString(stream);
  if (group && Array.isArray(group.variants)) {
    const variant = group.variants.find((v) => String(v.streamId) === sId);
    if (variant?.resolution) return variant.resolution;
  }
  const parsed = parseChannelVariantSuffix(stream.name);
  return parsed.resolution;
}

// ============================================================================
// LiveChannelCard
// Compact horizontal channel card: square logo left, channel name top-right,
// real EPG program title below (no "Passando Agora" prefix, no version badges).
// ============================================================================

interface LiveChannelCardProps {
  group: LiveChannelGroup;
  categoryId: string;
  rowIndex: number;
  cardIndex: number;
  credentials: XtreamCredentials | null;
  isSelected: boolean;
  isOrigin: boolean;
  isFavorite: boolean;
  isRowVisible: boolean;
  rowScrollEl: HTMLElement | null;
  onSelectGroup: (group: LiveChannelGroup, categoryId: string, rowIndex: number, cardIndex: number) => void;
  onToggleFavorite: (group: LiveChannelGroup) => void;
  onFocusCard: (groupId: string, categoryId: string, rowIndex: number, cardIndex: number) => void;
}

const LiveChannelCard = React.memo(function LiveChannelCard({
  group,
  categoryId,
  rowIndex,
  cardIndex,
  credentials,
  isSelected,
  isOrigin,
  isFavorite,
  isRowVisible,
  rowScrollEl,
  onSelectGroup,
  onToggleFavorite,
  onFocusCard,
}: LiveChannelCardProps) {
  const cardWrapRef = useRef<HTMLDivElement | null>(null);
  const [isHorizVisible, setIsHorizVisible] = useState<boolean>(cardIndex < 10);
  const [isFocused, setIsFocused] = useState<boolean>(false);

  const primaryStream = getGroupPrimaryStream(group);
  const primaryStreamId = getStreamIdString(primaryStream) || group.groupId;
  const preferredEpgStreamId = useMemo(
    () => getPreferredEpgStreamIdForGroup(group) || Number(primaryStream?.stream_id ?? primaryStream?.id ?? 0),
    [group, primaryStream]
  );

  const [epgSnapshot, setEpgSnapshot] = useState<LiveEpgSnapshot | null>(() => {
    if (!credentials || !preferredEpgStreamId) return null;
    return getCachedLiveEpgSnapshot(credentials, preferredEpgStreamId);
  });

  useEffect(() => {
    const el = cardWrapRef.current;
    if (!el) return;
    return observeContainerVisibility({
      target: el,
      root: rowScrollEl,
      rootMargin: '0px 280px',
      axis: 'horizontal',
      index: cardIndex,
      onIntersectChange: (intersecting) => {
        if (!intersecting && typeof IntersectionObserver === 'undefined') {
          const rect = el.getBoundingClientRect();
          const rootRect = rowScrollEl?.getBoundingClientRect();
          if (
            rect.width === 0 &&
            rect.height === 0 &&
            (!rootRect || (rootRect.width === 0 && rootRect.height === 0))
          ) {
            return;
          }
        }
        setIsHorizVisible(intersecting);
      },
    });
  }, [rowScrollEl, cardIndex]);

  const isCardActiveForAssets = isRowVisible && isHorizVisible;

  useEffect(() => {
    if (!credentials || !preferredEpgStreamId || !isCardActiveForAssets) {
      return;
    }

    const cached = getCachedLiveEpgSnapshot(credentials, preferredEpgStreamId);
    if (cached) {
      setEpgSnapshot(cached);
    }

    const unsubscribe = subscribeLiveChannelEpg({
      credentials,
      streamId: preferredEpgStreamId,
      priority: 'normal',
      onUpdate: (snap) => {
        setEpgSnapshot(snap);
      },
    });

    return () => {
      unsubscribe();
    };
  }, [credentials, preferredEpgStreamId, isCardActiveForAssets]);

  const epgTitle =
    epgSnapshot?.currentProgram?.title && epgSnapshot.currentProgram.title.trim().length > 0
      ? epgSnapshot.currentProgram.title
      : 'Programação indisponível';

  const logoSrc = group.stream_icon || primaryStream?.stream_icon;

  return (
    <div
      ref={cardWrapRef}
      data-live-channel-card="true"
      data-virtual-index={cardIndex}
      data-card-focused={isFocused ? 'true' : undefined}
      className="nc-live-horizontal-card relative w-[15.75rem] sm:w-[16.75rem] shrink-0 h-[5.15rem]"
    >
      <div
        className={`nc-card-visual-layer flex items-center bg-nc-bg-card border transition-colors ${
          isSelected
            ? 'border-white/25 bg-white/[0.09]'
            : 'border-white/10 hover:border-white/25 hover:bg-white/[0.05]'
        }`}
      >
        <button
          type="button"
          data-nav-item="true"
          data-live-channel-btn="true"
          data-row-card-index={cardIndex}
          data-live-channel-id={primaryStreamId}
          data-live-channel-group-id={group.groupId}
          data-live-channel-category-id={categoryId}
          data-live-category-id={cardIndex === 0 ? categoryId : undefined}
          data-live-channel-selected={isSelected ? 'true' : 'false'}
          data-live-channel-origin={isOrigin ? 'true' : undefined}
          onClick={() => onSelectGroup(group, categoryId, rowIndex, cardIndex)}
          onFocus={() => {
            setIsFocused(true);
            onFocusCard(group.groupId, categoryId, rowIndex, cardIndex);
          }}
          onBlur={() => setIsFocused(false)}
          className="flex-1 min-w-0 h-full flex items-center gap-3 pl-2.5 pr-1 py-2 text-left rounded-l-xl focus:outline-none"
        >
          <div className="nc-tv-channel-logo relative w-12 h-12 shrink-0 rounded-lg bg-black/60 border border-white/10 flex items-center justify-center overflow-hidden p-1">
            <Tv className="w-5 h-5 text-white/25" aria-hidden="true" />
            {logoSrc && (
              <MediaImage
                src={logoSrc}
                serverUrl={credentials?.serverUrl}
                alt={group.displayName}
                itemId={primaryStreamId}
                itemName={group.displayName}
                active={isCardActiveForAssets}
                className="relative z-10 w-full h-full object-contain"
              />
            )}
          </div>

          <div className="nc-tv-channel-info flex-1 min-w-0 flex flex-col justify-center gap-0.5">
            <span
              data-live-channel-name="true"
              className="nc-tv-channel-name text-sm font-semibold text-white/95 leading-snug"
            >
              {group.displayName}
            </span>
            <span
              data-live-channel-epg="true"
              className="text-xs text-white/60 truncate block"
            >
              {epgTitle}
            </span>
          </div>
        </button>

        <button
          type="button"
          data-nav-item="true"
          data-live-channel-fav="true"
          data-row-fav-index={cardIndex}
          aria-label={
            isFavorite
              ? `Remover ${group.displayName} dos favoritos`
              : `Adicionar ${group.displayName} aos favoritos`
          }
          aria-pressed={isFavorite}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(group);
          }}
          onFocus={() => {
            setIsFocused(true);
            onFocusCard(group.groupId, categoryId, rowIndex, cardIndex);
          }}
          onBlur={() => setIsFocused(false)}
          className="nc-tv-channel-fav shrink-0 p-2 mr-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors focus:outline-none"
        >
          <Heart
            className={`w-4 h-4 ${isFavorite ? 'fill-red-500 text-red-500' : 'text-white/60'}`}
          />
        </button>
      </div>
    </div>
  );
});

// ============================================================================
// LiveCategoryRow
// Independent horizontal row per category with virtualized horizontal window.
// ============================================================================

const HORIZ_CARD_WIDTH_PX = 268;
const HORIZ_CARD_GAP_PX = 12;
const HORIZ_CARD_STRIDE_PX = HORIZ_CARD_WIDTH_PX + HORIZ_CARD_GAP_PX;
const HORIZ_VIRTUAL_THRESHOLD = 24;
const HORIZ_VIRTUAL_OVERSCAN = 4;
const HORIZ_WINDOW_MIN_ITEMS = 18;

function computeHorizWindow(
  totalCount: number,
  scrollLeft: number,
  rowWidth: number
): { startIndex: number; endIndex: number; leftSpacerPx: number; rightSpacerPx: number } {
  if (totalCount <= HORIZ_VIRTUAL_THRESHOLD) {
    return {
      startIndex: 0,
      endIndex: totalCount,
      leftSpacerPx: 0,
      rightSpacerPx: 0,
    };
  }

  const effectiveWidth = rowWidth > 0 ? rowWidth : 640;
  const visibleSlots = Math.max(4, Math.ceil(effectiveWidth / HORIZ_CARD_STRIDE_PX));
  const windowSize = Math.min(totalCount, Math.max(HORIZ_WINDOW_MIN_ITEMS, visibleSlots + HORIZ_VIRTUAL_OVERSCAN * 2));
  const rawFirst = Math.floor(Math.max(0, scrollLeft) / HORIZ_CARD_STRIDE_PX);
  const maxStart = Math.max(0, totalCount - windowSize);
  const startIndex = Math.max(0, Math.min(maxStart, rawFirst - HORIZ_VIRTUAL_OVERSCAN));
  const endIndex = Math.min(totalCount, startIndex + windowSize);

  return {
    startIndex,
    endIndex,
    leftSpacerPx: startIndex * HORIZ_CARD_STRIDE_PX,
    rightSpacerPx: Math.max(0, (totalCount - endIndex) * HORIZ_CARD_STRIDE_PX),
  };
}

interface LiveCategoryRowProps {
  row: LiveCategoryRowDescriptor;
  rowIndex: number;
  credentials: XtreamCredentials | null;
  leftScrollEl: HTMLElement | null;
  selectedGroupId: string | null;
  originGroupId: string | null;
  originCategoryId: string | null;
  isGroupFavorite: (group: LiveChannelGroup) => boolean;
  onSelectGroup: (group: LiveChannelGroup, categoryId: string, rowIndex: number, cardIndex: number) => void;
  onToggleFavorite: (group: LiveChannelGroup) => void;
  onFocusCard: (groupId: string, categoryId: string, rowIndex: number, cardIndex: number) => void;
}

const LiveCategoryRow = React.memo(function LiveCategoryRow({
  row,
  rowIndex,
  credentials,
  leftScrollEl,
  selectedGroupId,
  originGroupId,
  originCategoryId,
  isGroupFavorite,
  onSelectGroup,
  onToggleFavorite,
  onFocusCard,
}: LiveCategoryRowProps) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const rowElRef = useRef<HTMLDivElement | null>(null);
  const [rowElState, setRowElState] = useState<HTMLDivElement | null>(null);
  const [isRowVisible, setIsRowVisible] = useState<boolean>(rowIndex < 6);

  const totalCount = row.channels.length;
  const shouldVirtualizeHoriz = totalCount > HORIZ_VIRTUAL_THRESHOLD;

  const [horizWindow, setHorizWindow] = useState(() =>
    computeHorizWindow(totalCount, 0, 640)
  );
  const horizWindowRef = useRef(horizWindow);
  horizWindowRef.current = horizWindow;

  const formattedTitle = useMemo(
    () => formatLiveTvCategoryTitle(row.rawTitle),
    [row.rawTitle]
  );

  // Reset horizontal window if channel count drops or category changes
  useEffect(() => {
    const el = rowElRef.current;
    const width = el?.clientWidth || 640;
    const scrollLeft = el?.scrollLeft || 0;
    const next = computeHorizWindow(totalCount, scrollLeft, width);
    horizWindowRef.current = next;
    setHorizWindow(next);
  }, [row.id, totalCount]);

  // Vertical visibility observation against left pane scroll container
  useEffect(() => {
    const target = sectionRef.current;
    if (!target) return;
    return observeContainerVisibility({
      target,
      root: leftScrollEl,
      rootMargin: '240px 0px',
      axis: 'vertical',
      index: rowIndex,
      onIntersectChange: (intersecting) => {
        if (!intersecting && typeof IntersectionObserver === 'undefined') {
          const rect = target.getBoundingClientRect();
          const rootRect = leftScrollEl?.getBoundingClientRect();
          if (
            rect.width === 0 &&
            rect.height === 0 &&
            (!rootRect || (rootRect.width === 0 && rootRect.height === 0))
          ) {
            return;
          }
        }
        setIsRowVisible(intersecting);
      },
    });
  }, [leftScrollEl, rowIndex]);

  const setRowCallbackRef = useCallback((node: HTMLDivElement | null) => {
    rowElRef.current = node;
    setRowElState((prev) => (prev !== node ? node : prev));
  }, []);

  const ensureIndexMounted = useCallback(
    (targetIndex: number, preserveIndex?: number): boolean => {
      if (!shouldVirtualizeHoriz || totalCount <= 0) return false;
      const clamped = Math.max(0, Math.min(totalCount - 1, Math.floor(targetIndex)));
      const cur = horizWindowRef.current;
      const margin = 2;

      if (
        clamped >= cur.startIndex &&
        clamped < cur.endIndex &&
        (cur.startIndex === 0 || clamped >= cur.startIndex + margin) &&
        (cur.endIndex >= totalCount || clamped < cur.endIndex - margin)
      ) {
        return false;
      }

      const rowWidth = rowElRef.current?.clientWidth || 640;
      const span = Math.max(HORIZ_WINDOW_MIN_ITEMS, cur.endIndex - cur.startIndex);
      let nextStart = Math.max(0, Math.min(Math.max(0, totalCount - span), clamped - Math.floor(span / 2)));

      if (typeof preserveIndex === 'number' && preserveIndex >= 0 && preserveIndex < totalCount) {
        if (Math.abs(clamped - preserveIndex) < span) {
          if (nextStart > preserveIndex) nextStart = preserveIndex;
          if (nextStart + span - 1 < preserveIndex) nextStart = Math.max(0, preserveIndex - span + 1);
          if (nextStart > clamped) nextStart = clamped;
          if (nextStart + span - 1 < clamped) nextStart = Math.max(0, clamped - span + 1);
        }
      }

      const nextEnd = Math.min(totalCount, nextStart + span);
      const nextWindow = {
        startIndex: nextStart,
        endIndex: nextEnd,
        leftSpacerPx: nextStart * HORIZ_CARD_STRIDE_PX,
        rightSpacerPx: Math.max(0, (totalCount - nextEnd) * HORIZ_CARD_STRIDE_PX),
      };

      if (nextWindow.startIndex === cur.startIndex && nextWindow.endIndex === cur.endIndex) {
        return false;
      }

      horizWindowRef.current = nextWindow;
      try {
        flushSync(() => {
          setHorizWindow(nextWindow);
        });
      } catch {
        setHorizWindow(nextWindow);
      }

      const el = rowElRef.current;
      if (el) {
        const targetScrollLeft = Math.max(0, clamped * HORIZ_CARD_STRIDE_PX - Math.round(rowWidth / 2) + Math.round(HORIZ_CARD_WIDTH_PX / 2));
        const prevBehavior = el.style.scrollBehavior;
        el.style.scrollBehavior = 'auto';
        el.scrollLeft = targetScrollLeft;
        el.style.scrollBehavior = prevBehavior;
      }

      return true;
    },
    [shouldVirtualizeHoriz, totalCount]
  );

  // Register horizontal row with spatialNav
  useLayoutEffect(() => {
    const el = rowElRef.current;
    if (!el) return;
    registerVirtualContainer(el, {
      totalCount,
      getColumns: () => totalCount,
      ensureIndexMounted,
    });
    return () => {
      unregisterVirtualContainer(el);
      invalidateCandidateCache();
    };
  }, [rowElState, totalCount, ensureIndexMounted]);

  const handleRowScroll = useCallback(() => {
    const el = rowElRef.current;
    if (!el) return;
    notifyContainerScrollForFallback(el);
    if (!shouldVirtualizeHoriz) return;
    const next = computeHorizWindow(totalCount, el.scrollLeft || 0, el.clientWidth || 640);
    if (
      next.startIndex !== horizWindowRef.current.startIndex ||
      next.endIndex !== horizWindowRef.current.endIndex
    ) {
      horizWindowRef.current = next;
      setHorizWindow(next);
    }
  }, [shouldVirtualizeHoriz, totalCount]);

  const scrollRowBy = useCallback((dir: -1 | 1) => {
    const el = rowElRef.current;
    if (!el) return;
    const step = Math.max(280, Math.round((el.clientWidth || 640) * 0.75));
    const nextLeft = Math.max(0, (el.scrollLeft || 0) + dir * step);
    if (typeof el.scrollTo === 'function') {
      try {
        el.scrollTo({ left: nextLeft, behavior: 'smooth' });
        return;
      } catch {}
    }
    el.scrollLeft = nextLeft;
  }, []);

  const visibleSlice = shouldVirtualizeHoriz
    ? row.channels.slice(horizWindow.startIndex, horizWindow.endIndex)
    : row.channels;

  return (
    <section
      ref={sectionRef}
      data-home-row-index={rowIndex}
      data-virtual-index={rowIndex}
      data-scroll-block="true"
      className="space-y-2 min-w-0"
    >
      <div className="flex items-center justify-between gap-2 px-1">
        <h3
          data-live-category-title="true"
          className="nc-heading-section text-white/95 tracking-tight truncate"
        >
          {formattedTitle}
        </h3>
        {row.channels.length > 2 && (
          <div className="hidden sm:flex items-center gap-1 shrink-0">
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Rolar ${formattedTitle} para esquerda`}
              onClick={() => scrollRowBy(-1)}
              className="p-1 rounded-md text-white/40 hover:text-white hover:bg-white/10 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Rolar ${formattedTitle} para direita`}
              onClick={() => scrollRowBy(1)}
              className="p-1 rounded-md text-white/40 hover:text-white hover:bg-white/10 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      <div
        ref={setRowCallbackRef}
        data-nav-row="true"
        data-live-category-row-scroll="true"
        data-virtual-container={shouldVirtualizeHoriz ? 'true' : undefined}
        onScroll={handleRowScroll}
        className="flex items-stretch gap-3 overflow-x-auto overflow-y-visible scrollbar-hide touch-pan-x py-1.5 px-1 min-w-0"
      >
        {shouldVirtualizeHoriz && horizWindow.leftSpacerPx > 0 && (
          <div
            data-virtual-spacer="left"
            aria-hidden="true"
            className="shrink-0"
            style={{ width: `${horizWindow.leftSpacerPx}px` }}
          />
        )}

        {visibleSlice.map((group, offsetIdx) => {
          const cardIdx = shouldVirtualizeHoriz ? horizWindow.startIndex + offsetIdx : offsetIdx;
          return (
            <LiveChannelCard
              key={group.groupId}
              group={group}
              categoryId={row.categoryId}
              rowIndex={rowIndex}
              cardIndex={cardIdx}
              credentials={credentials}
              isSelected={selectedGroupId === group.groupId}
              isOrigin={originGroupId === group.groupId && originCategoryId === row.categoryId}
              isFavorite={isGroupFavorite(group)}
              isRowVisible={isRowVisible}
              rowScrollEl={rowElState}
              onSelectGroup={onSelectGroup}
              onToggleFavorite={onToggleFavorite}
              onFocusCard={onFocusCard}
            />
          );
        })}

        {shouldVirtualizeHoriz && horizWindow.rightSpacerPx > 0 && (
          <div
            data-virtual-spacer="right"
            aria-hidden="true"
            className="shrink-0"
            style={{ width: `${horizWindow.rightSpacerPx}px` }}
          />
        )}
      </div>
    </section>
  );
});

// ============================================================================
// LiveTvView
// 50/50 balanced split: left continuous horizontal category showcase,
// right channel preview, variant selector, and EPG schedule.
// ============================================================================

export const LiveTvView = React.memo(function LiveTvView({
  onPlay: _onPlay,
  searchQuery = '',
  isTvMode: _isTvMode,
  initialChannelIntent = null,
  onConsumeChannelIntent,
}: LiveTvViewProps) {
  const { credentials } = useXtreamCredentials();
  const {
    liveCategories,
    liveStreams,
    allLiveStreams,
    loadingLive,
    loadedLiveCatalog,
    liveError,
    fetchLiveCategories,
    fetchLiveStreams,
  } = useXtreamLive();

  const { favorites, isFavorite, toggleGroupFavorites } = useFavorites(credentials);
  const historyRecords = useAccountPlaybackHistory(credentials);

  const effectiveLiveStreams = useMemo(
    () => (liveStreams.length > 0 ? liveStreams : allLiveStreams),
    [liveStreams, allLiveStreams]
  );

  // Trigger initial fetch only if credentials exist and live catalog is not loaded yet
  const fetchedForAccountRef = useRef<string | null>(null);
  useEffect(() => {
    if (!credentials) {
      fetchedForAccountRef.current = null;
      return;
    }
    const accountSig = `${credentials.serverUrl}|${credentials.username}`;
    if (fetchedForAccountRef.current === accountSig) return;

    if (!loadingLive && !loadedLiveCatalog && effectiveLiveStreams.length === 0) {
      fetchedForAccountRef.current = accountSig;
      if (liveCategories.length === 0) {
        fetchLiveCategories().catch(() => {});
      }
      fetchLiveStreams().catch(() => {});
    } else if (loadedLiveCatalog || effectiveLiveStreams.length > 0) {
      fetchedForAccountRef.current = accountSig;
    }
  }, [
    credentials,
    loadingLive,
    loadedLiveCatalog,
    effectiveLiveStreams.length,
    liveCategories.length,
    fetchLiveCategories,
    fetchLiveStreams,
  ]);

  const liveIndex = useMemo(
    () => getOrCreateLiveIndex(effectiveLiveStreams),
    [effectiveLiveStreams]
  );

  // Active selection & playback state
  const [selectedGroup, setSelectedGroup] = useState<LiveChannelGroup | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<any | null>(null);
  const [selectedVariantIdOrAuto, setSelectedVariantIdOrAuto] = useState<string>('auto');
  const [attemptTrigger, setAttemptTrigger] = useState<number>(0);
  const [fullscreenRequestTrigger, setFullscreenRequestTrigger] = useState<number>(0);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [isMobilePlayerOpen, setIsMobilePlayerOpen] = useState<boolean>(false);

  // EPG state for right pane
  const [rightPaneEpg, setRightPaneEpg] = useState<LiveEpgSnapshot | null>(null);
  const [rightPaneEpgLoading, setRightPaneEpgLoading] = useState<boolean>(false);

  // Focus origin tracking for spatial navigation between left catalog and right pane
  const [originState, setOriginState] = useState<{
    groupId: string | null;
    categoryId: string | null;
    rowIndex: number;
    cardIndex: number;
  }>({
    groupId: null,
    categoryId: null,
    rowIndex: -1,
    cardIndex: -1,
  });

  // Playback fallback state & cleanup refs
  const isMountedRef = useRef<boolean>(true);
  const triedStreamIdsRef = useRef<Set<string>>(new Set());
  const fallbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeAttemptIdRef = useRef<number>(0);
  const playbackSucceededAttemptRef = useRef<number>(0);

  const clearFallbackTimer = useCallback(() => {
    if (fallbackTimeoutRef.current !== null) {
      clearTimeout(fallbackTimeoutRef.current);
      fallbackTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearFallbackTimer();
    };
  }, [clearFallbackTimer]);

  const isGroupFavorite = useCallback(
    (group: LiveChannelGroup): boolean => {
      const ids = collectGroupStreamIds(group);
      return ids.some((id) => isFavorite(id, 'live'));
    },
    [isFavorite]
  );

  const handleToggleFavorite = useCallback(
    (group: LiveChannelGroup) => {
      const ids = collectGroupStreamIds(group);
      if (ids.length === 0) return;
      const alreadyFav = ids.some((id) => isFavorite(id, 'live'));
      if (alreadyFav) {
        toggleGroupFavorites(ids);
      } else {
        const primary = getGroupPrimaryStream(group);
        const primaryId = getStreamIdString(primary) || ids[0];
        toggleGroupFavorites(ids, {
          id: primaryId,
          name: group.displayName,
          cover: group.stream_icon || primary?.stream_icon || '',
          type: 'live',
          extraData: primary,
        });
      }
    },
    [isFavorite, toggleGroupFavorites]
  );

  // Helper to resolve a streamId into its LiveChannelGroup using O(1) liveIndex lookups
  const resolveGroupByStreamId = useCallback(
    (rawId: string | number | undefined | null, hintCategoryId?: string, streamSnapshot?: any): LiveChannelGroup | null => {
      if (rawId === undefined || rawId === null || rawId === '') return null;
      const targetIdStr = String(rawId);
      const indexedStream = liveIndex.getById(targetIdStr) || streamSnapshot;
      const catId = indexedStream?.category_id ?? hintCategoryId;

      if (catId !== undefined && catId !== null && String(catId) !== '') {
        const catGroups = liveIndex.getGroupsByCategory(String(catId));
        const match = catGroups.find((g) => collectGroupStreamIds(g).includes(targetIdStr));
        if (match) return match;
      }

      // Check remaining categories only if needed
      if (liveCategories.length > 0 && effectiveLiveStreams.length <= 5000) {
        const allGroups = liveIndex.getAllGroups();
        const match = allGroups.find((g) => collectGroupStreamIds(g).includes(targetIdStr));
        if (match) return match;
      }

      if (indexedStream && typeof indexedStream === 'object') {
        return buildFallbackGroupFromStream(indexedStream, hintCategoryId);
      }
      return null;
    },
    [liveIndex, liveCategories.length, effectiveLiveStreams.length]
  );

  // Build ordered category rows (virtual Favorites & Recents + provider categories)
  const normalizedSearch = searchQuery.trim().toLowerCase();

  const categoryRows = useMemo<LiveCategoryRowDescriptor[]>(() => {
    const rows: LiveCategoryRowDescriptor[] = [];

    if (!normalizedSearch) {
      // 1. Assistidos Recentemente
      const liveHistory = historyRecords.filter((r) => r.type === 'live');
      if (liveHistory.length > 0) {
        const seenGroupIds = new Set<string>();
        const recentGroups: LiveChannelGroup[] = [];
        for (const rec of liveHistory) {
          const group = resolveGroupByStreamId(rec.id);
          if (group && !seenGroupIds.has(group.groupId)) {
            seenGroupIds.add(group.groupId);
            recentGroups.push(group);
          }
          if (recentGroups.length >= 20) break;
        }
        if (recentGroups.length > 0) {
          rows.push({
            id: 'row:__recent__',
            categoryId: '__recent__',
            rawTitle: 'Assistidos Recentemente',
            channels: recentGroups,
          });
        }
      }

      // 2. Canais Favoritos
      const liveFavs = favorites.filter((f) => f && f.type === 'live');
      if (liveFavs.length > 0) {
        const seenFavGroupIds = new Set<string>();
        const favGroups: LiveChannelGroup[] = [];
        for (const fav of liveFavs) {
          const group = resolveGroupByStreamId(fav.id, undefined, fav.extraData);
          if (group && !seenFavGroupIds.has(group.groupId)) {
            seenFavGroupIds.add(group.groupId);
            favGroups.push(group);
          }
        }
        if (favGroups.length > 0) {
          rows.push({
            id: 'row:__favorites__',
            categoryId: '__favorites__',
            rawTitle: 'Canais Favoritos',
            channels: favGroups,
          });
        }
      }
    }

    // 3. Provider categories
    const knownCategoryIds = new Set<string>();
    for (const cat of liveCategories) {
      const catId = String(cat.category_id);
      knownCategoryIds.add(catId);
      const rawGroups = liveIndex.getGroupsByCategory(catId);
      const channels = normalizedSearch
        ? filterLiveChannelGroups(rawGroups, normalizedSearch)
        : rawGroups;
      if (channels.length > 0) {
        rows.push({
          id: `row:${catId}`,
          categoryId: catId,
          rawTitle: cat.category_name || 'Geral',
          channels,
        });
      }
    }

    // 4. Fallback if streams exist without matching liveCategories entries
    if (liveCategories.length === 0 && effectiveLiveStreams.length > 0) {
      const uncategorizedMap = new Map<string, LiveStream[]>();
      for (const stream of effectiveLiveStreams) {
        const catKey = String(stream?.category_id ?? 'default');
        let list = uncategorizedMap.get(catKey);
        if (!list) {
          list = [];
          uncategorizedMap.set(catKey, list);
        }
        list.push(stream);
      }
      uncategorizedMap.forEach((streamsInCat, catId) => {
        const grouped = groupLiveStreams(streamsInCat);
        const channels = normalizedSearch
          ? filterLiveChannelGroups(grouped, normalizedSearch)
          : grouped;
        if (channels.length > 0) {
          rows.push({
            id: `row:${catId}`,
            categoryId: catId,
            rawTitle: catId === 'default' ? 'Canais' : `Categoria ${catId}`,
            channels,
          });
        }
      });
    } else if (knownCategoryIds.size > 0 && rows.length === 0 && !normalizedSearch && effectiveLiveStreams.length > 0) {
      // Categories exist, none matched stream category_ids -> show Geral row
      const groupedAll = liveIndex.getAllGroups();
      if (groupedAll.length > 0) {
        rows.push({
          id: 'row:__all__',
          categoryId: '__all__',
          rawTitle: 'Canais',
          channels: groupedAll,
        });
      }
    }

    return rows;
  }, [
    normalizedSearch,
    historyRecords,
    favorites,
    liveCategories,
    effectiveLiveStreams,
    liveIndex,
    resolveGroupByStreamId,
  ]);

  // Schedule 28s fallback timer if a playback attempt stalls before reporting success
  const startPlaybackAttempt = useCallback(
    (group: LiveChannelGroup, variant: ChannelVariant, variantSelection: string) => {
      clearFallbackTimer();
      const attemptId = ++activeAttemptIdRef.current;
      setSelectedChannel(variant.stream);
      setPlaybackError(null);
      setAttemptTrigger((n) => n + 1);

      fallbackTimeoutRef.current = setTimeout(() => {
        fallbackTimeoutRef.current = null;
        if (!isMountedRef.current || activeAttemptIdRef.current !== attemptId) {
          return;
        }
        if (playbackSucceededAttemptRef.current === attemptId) {
          return;
        }

        const failedId = String(variant.streamId ?? getStreamIdString(variant.stream));
        if (failedId) {
          triedStreamIdsRef.current.add(failedId);
        }
        const nextVariant = selectChannelVariantForAttempt(
          group,
          variantSelection,
          triedStreamIdsRef.current
        );
        if (nextVariant) {
          startPlaybackAttempt(group, nextVariant, variantSelection);
        } else {
          setPlaybackError('Não foi possível reproduzir este canal no momento.');
        }
      }, liveFallbackTimeoutMs);
    },
    [clearFallbackTimer]
  );

  // Select a channel group from left pane (or enter fullscreen on 2nd click on desktop)
  const handleSelectGroup = useCallback(
    (group: LiveChannelGroup, categoryId?: string, rowIndex?: number, cardIndex?: number) => {
      if (typeof categoryId === 'string' && typeof rowIndex === 'number' && typeof cardIndex === 'number') {
        setOriginState({
          groupId: group.groupId,
          categoryId,
          rowIndex,
          cardIndex,
        });
      }

      const isAlreadySelected = selectedGroup?.groupId === group.groupId && selectedChannel !== null;
      const isNarrowViewport =
        typeof window !== 'undefined' && window.innerWidth > 0 && window.innerWidth < 768;

      if (isAlreadySelected) {
        if (isNarrowViewport && !isMobilePlayerOpen) {
          setIsMobilePlayerOpen(true);
        } else {
          setFullscreenRequestTrigger((n) => n + 1);
        }
        return;
      }

      triedStreamIdsRef.current = new Set();
      setSelectedGroup(group);
      setSelectedVariantIdOrAuto('auto');

      if (isNarrowViewport) {
        setIsMobilePlayerOpen(true);
      }

      const initialVariant = selectChannelVariantForAttempt(
        group,
        'auto',
        triedStreamIdsRef.current
      );

      if (initialVariant) {
        startPlaybackAttempt(group, initialVariant, 'auto');
      } else {
        const fallbackStream = getGroupPrimaryStream(group);
        clearFallbackTimer();
        setSelectedChannel(fallbackStream);
        setPlaybackError(fallbackStream ? null : 'Canal indisponível.');
      }
    },
    [selectedGroup, selectedChannel, isMobilePlayerOpen, startPlaybackAttempt, clearFallbackTimer]
  );

  // Handle direct channel launch intent from Home
  const consumedIntentIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!initialChannelIntent) return;
    if (consumedIntentIdRef.current === initialChannelIntent.requestId) return;

    const matchedGroup = resolveGroupByStreamId(
      initialChannelIntent.streamId,
      initialChannelIntent.categoryId,
      initialChannelIntent.streamSnapshot
    );

    if (!matchedGroup) {
      if (effectiveLiveStreams.length > 0 || loadedLiveCatalog) {
        consumedIntentIdRef.current = initialChannelIntent.requestId;
        onConsumeChannelIntent?.(initialChannelIntent.requestId);
      }
      return;
    }

    consumedIntentIdRef.current = initialChannelIntent.requestId;
    triedStreamIdsRef.current = new Set();
    setSelectedGroup(matchedGroup);
    setSelectedVariantIdOrAuto('auto');

    if (typeof window !== 'undefined' && window.innerWidth > 0 && window.innerWidth < 768) {
      setIsMobilePlayerOpen(true);
    }

    const initialVariant = selectChannelVariantForAttempt(
      matchedGroup,
      'auto',
      triedStreamIdsRef.current
    );
    if (initialVariant) {
      startPlaybackAttempt(matchedGroup, initialVariant, 'auto');
    } else {
      const primary = getGroupPrimaryStream(matchedGroup);
      setSelectedChannel(primary);
    }

    onConsumeChannelIntent?.(initialChannelIntent.requestId);
  }, [
    initialChannelIntent,
    effectiveLiveStreams.length,
    loadedLiveCatalog,
    resolveGroupByStreamId,
    startPlaybackAttempt,
    onConsumeChannelIntent,
  ]);

  // Select manual variant or Automático in right pane
  const handleSelectVariant = useCallback(
    (variantIdOrAuto: string) => {
      if (!selectedGroup) return;
      setSelectedVariantIdOrAuto(variantIdOrAuto);
      triedStreamIdsRef.current = new Set();
      const targetVariant = selectChannelVariantForAttempt(
        selectedGroup,
        variantIdOrAuto,
        triedStreamIdsRef.current
      );
      if (targetVariant) {
        startPlaybackAttempt(selectedGroup, targetVariant, variantIdOrAuto);
      }
    },
    [selectedGroup, startPlaybackAttempt]
  );

  // Manual retry button on playback error
  const handleManualRetry = useCallback(() => {
    if (!selectedGroup) return;
    triedStreamIdsRef.current = new Set();
    const targetVariant = selectChannelVariantForAttempt(
      selectedGroup,
      selectedVariantIdOrAuto,
      triedStreamIdsRef.current
    );
    if (targetVariant) {
      startPlaybackAttempt(selectedGroup, targetVariant, selectedVariantIdOrAuto);
    }
  }, [selectedGroup, selectedVariantIdOrAuto, startPlaybackAttempt]);

  // VideoPlayer callbacks
  const handlePlaybackSuccess = useCallback(
    (attemptId?: number) => {
      clearFallbackTimer();
      playbackSucceededAttemptRef.current = attemptId ?? activeAttemptIdRef.current;
      setPlaybackError(null);
      if (credentials && selectedChannel) {
        const sId = getStreamIdString(selectedChannel);
        if (sId) {
          recordPlaybackPosition(credentials, {
            id: sId,
            type: 'live',
            positionSec: 0,
          });
        }
      }
    },
    [clearFallbackTimer, credentials, selectedChannel]
  );

  const handlePlaybackFinalError = useCallback(
    (errMsg: string) => {
      clearFallbackTimer();
      if (!selectedGroup || !selectedChannel) {
        setPlaybackError(errMsg || 'Erro ao reproduzir canal.');
        return;
      }

      const failedId = getStreamIdString(selectedChannel);
      if (failedId) {
        triedStreamIdsRef.current.add(failedId);
      }

      const nextVariant = selectChannelVariantForAttempt(
        selectedGroup,
        selectedVariantIdOrAuto,
        triedStreamIdsRef.current
      );

      if (nextVariant) {
        startPlaybackAttempt(selectedGroup, nextVariant, selectedVariantIdOrAuto);
      } else {
        setPlaybackError(errMsg || 'Não foi possível reproduzir este canal.');
      }
    },
    [clearFallbackTimer, selectedGroup, selectedChannel, selectedVariantIdOrAuto, startPlaybackAttempt]
  );

  // Right-pane EPG subscription keyed on canonical group stream ID (SD -> HD -> FHD -> 4K)
  const rightPaneEpgStreamId = useMemo(() => {
    if (!selectedGroup) return 0;
    return (
      getPreferredEpgStreamIdForGroup(selectedGroup) ||
      Number(selectedChannel?.stream_id ?? selectedChannel?.id ?? 0)
    );
  }, [selectedGroup, selectedChannel]);

  useEffect(() => {
    if (!credentials || !rightPaneEpgStreamId) {
      setRightPaneEpg(null);
      setRightPaneEpgLoading(false);
      return;
    }

    const cached = getCachedLiveEpgSnapshot(credentials, rightPaneEpgStreamId);
    if (cached) {
      setRightPaneEpg(cached);
      setRightPaneEpgLoading(false);
    } else {
      setRightPaneEpg(null);
      setRightPaneEpgLoading(true);
    }

    const unsubscribe = subscribeLiveChannelEpg({
      credentials,
      streamId: rightPaneEpgStreamId,
      priority: 'high',
      onUpdate: (snap) => {
        setRightPaneEpg(snap);
        setRightPaneEpgLoading(false);
      },
    });

    return () => {
      unsubscribe();
    };
  }, [credentials, rightPaneEpgStreamId]);

  // Close preview and restore focus to the previously selected channel button in left pane
  const closePreviewAndRestoreFocus = useCallback(() => {
    const prevPrimaryId = getStreamIdString(selectedChannel) || getStreamIdString(getGroupPrimaryStream(selectedGroup));
    const prevGroupId = selectedGroup?.groupId;

    clearFallbackTimer();
    activeAttemptIdRef.current += 1;
    setSelectedGroup(null);
    setSelectedChannel(null);
    setPlaybackError(null);
    setIsMobilePlayerOpen(false);

    if (getNavMode() === 'remote' && typeof document !== 'undefined') {
      const allChannelBtns = Array.from(
        document.querySelectorAll<HTMLButtonElement>('button[data-live-channel-btn="true"]')
      );
      const targetBtn =
        (prevGroupId && originState.categoryId
          ? allChannelBtns.find(
              (btn) =>
                btn.getAttribute('data-live-channel-group-id') === prevGroupId &&
                btn.getAttribute('data-live-channel-category-id') === originState.categoryId
            ) || null
          : null) ||
        (prevGroupId
          ? allChannelBtns.find(
              (btn) => btn.getAttribute('data-live-channel-group-id') === prevGroupId
            ) || null
          : null) ||
        (prevPrimaryId
          ? allChannelBtns.find(
              (btn) => btn.getAttribute('data-live-channel-id') === prevPrimaryId
            ) || null
          : null) ||
        document.querySelector<HTMLButtonElement>('button[data-live-channel-selected="true"]');

      if (targetBtn && targetBtn.isConnected) {
        focusElementSafely(targetBtn);
      }
    }
  }, [selectedChannel, selectedGroup, originState.categoryId, clearFallbackTimer]);

  const handleMobileBackToChannels = useCallback(() => {
    if (isMobilePlayerOpen) {
      setIsMobilePlayerOpen(false);
      return;
    }
    closePreviewAndRestoreFocus();
  }, [isMobilePlayerOpen, closePreviewAndRestoreFocus]);

  // Register Back handler for closing mobile player or active preview
  useBackHandler(
    'live-tv-view',
    BACK_PRIORITY.VIEW_INTERNAL,
    () => {
      if (isMobilePlayerOpen) {
        setIsMobilePlayerOpen(false);
        return true;
      }
      if (selectedGroup) {
        closePreviewAndRestoreFocus();
        return true;
      }
      return false;
    },
    Boolean(isMobilePlayerOpen || selectedGroup)
  );

  // Left-pane vertical virtualization + showcase row controller
  const leftScrollRef = useRef<HTMLDivElement | null>(null);
  const leftVirtualRef = useRef<HTMLDivElement | null>(null);

  const {
    startIndex: rowStartIndex,
    endIndex: rowEndIndex,
    topSpacerPx: rowsTopSpacerPx,
    bottomSpacerPx: rowsBottomSpacerPx,
    ensureIndexMounted: ensureRowMounted,
    scrollContainerCallbackRef,
    virtualContainerCallbackRef,
  } = useVirtualWindow({
    totalCount: categoryRows.length,
    mode: 'list',
    scrollContainerRef: leftScrollRef,
    virtualContainerRef: leftVirtualRef,
    maxWindowItems: 24,
    fallbackOffsetTopPx: 16,
    fallbackItemHeightPx: 148,
    resetKey: `live_rows_${normalizedSearch}`,
  });

  const [leftScrollNode, setLeftScrollNode] = useState<HTMLDivElement | null>(null);
  const setLeftScrollRef = useCallback(
    (node: HTMLDivElement | null) => {
      leftScrollRef.current = node;
      scrollContainerCallbackRef(node);
      setLeftScrollNode((prev) => (prev !== node ? node : prev));
    },
    [scrollContainerCallbackRef]
  );

  const setLeftVirtualRef = useCallback(
    (node: HTMLDivElement | null) => {
      leftVirtualRef.current = node;
      virtualContainerCallbackRef(node);
    },
    [virtualContainerCallbackRef]
  );

  useLayoutEffect(() => {
    const el = leftScrollRef.current;
    if (!el) return;
    registerShowcaseRowController(el, {
      totalRows: categoryRows.length,
      ensureRowMounted,
    });
    return () => {
      unregisterShowcaseRowController(el);
    };
  }, [leftScrollNode, categoryRows.length, ensureRowMounted]);

  const handleFocusCard = useCallback((groupId: string, categoryId: string, rowIndex: number, cardIndex: number) => {
    setOriginState({ groupId, categoryId, rowIndex, cardIndex });
  }, []);

  const effectiveOriginRowIndex = useMemo(() => {
    if (!originState.categoryId) return originState.rowIndex;
    const dynamicIdx = categoryRows.findIndex((r) => r.categoryId === originState.categoryId);
    return dynamicIdx >= 0 ? dynamicIdx : originState.rowIndex;
  }, [categoryRows, originState.categoryId, originState.rowIndex]);

  // Derived playback URL for VideoPlayer
  const activeStreamUrl = useMemo(() => {
    if (!credentials || !selectedChannel) return '';
    const sId = selectedChannel.stream_id ?? selectedChannel.id;
    if (!sId) return '';
    return buildDirectMediaUrl(credentials, {
      type: 'live',
      streamId: sId,
      allowedOutputFormats: credentials.allowed_output_formats,
      directSource: selectedChannel.direct_source,
    });
  }, [credentials, selectedChannel]);

  const activeResolutionBadge = useMemo(
    () => getStreamResolutionLabel(selectedChannel, selectedGroup),
    [selectedChannel, selectedGroup]
  );

  const rightPanePrimaryLogo = selectedGroup
    ? selectedGroup.stream_icon || getGroupPrimaryStream(selectedGroup)?.stream_icon
    : null;

  const currentEpgProgram = rightPaneEpg?.currentProgram ?? null;
  const epgTimeline = rightPaneEpg?.timeline ?? [];

  const visibleCategoryRows = categoryRows.slice(rowStartIndex, rowEndIndex);

  return (
    <div className="flex-1 w-full h-full flex flex-col md:flex-row bg-nc-bg overflow-hidden min-h-0 min-w-0">
      {/* ===================================================================
          LEFT PANE (~50%): "Categorias De TV" + Vertical stack of horizontal rows
         =================================================================== */}
      <aside
        data-nav-zone="categories"
        className={`nc-live-left-pane nc-tv-category-pane w-full md:w-1/2 md:max-w-[50%] flex-1 md:flex-none flex-col min-w-0 min-h-0 border-b md:border-b-0 md:border-r border-white/10 bg-nc-bg ${
          isMobilePlayerOpen ? 'hidden md:flex' : 'flex'
        }`}
      >
        <div className="shrink-0 px-4 sm:px-6 pt-4 pb-3 border-b border-white/10 flex items-center justify-between gap-3">
          <h2 className="nc-heading-view text-white tracking-tight">
            Categorias De TV
          </h2>
          {categoryRows.length > 0 && (
            <span className="nc-text-meta text-white/50 shrink-0">
              {categoryRows.length} {categoryRows.length === 1 ? 'categoria' : 'categorias'}
            </span>
          )}
        </div>

        <div
          ref={setLeftScrollRef}
          data-scroll-container="true"
          data-showcase-rows-container="true"
          data-showcase-virtualized="true"
          data-showcase-total-rows={categoryRows.length}
          data-live-origin-row-index={effectiveOriginRowIndex >= 0 ? effectiveOriginRowIndex : undefined}
          data-live-origin-card-index={originState.cardIndex >= 0 ? originState.cardIndex : undefined}
          onScroll={() => notifyContainerScrollForFallback(leftScrollRef.current)}
          style={{ overflowAnchor: 'none' }}
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar touch-pan-y px-4 sm:px-6 py-4"
        >
          {loadingLive && categoryRows.length === 0 ? (
            <div className="h-full min-h-[14rem] flex flex-col items-center justify-center gap-3 text-white/60">
              <Loader2 className="w-7 h-7 animate-spin text-white/70" />
              <span className="nc-text-subtitle">Carregando canais ao vivo...</span>
            </div>
          ) : liveError && categoryRows.length === 0 ? (
            <div className="h-full min-h-[14rem] flex flex-col items-center justify-center gap-3 text-center px-4">
              <AlertCircle className="w-7 h-7 text-red-400" />
              <p className="nc-text-subtitle text-white/80">{liveError}</p>
              <button
                type="button"
                data-nav-item="true"
                onClick={() => fetchLiveStreams().catch(() => {})}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-black text-sm font-semibold hover:bg-white/90 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Tentar novamente</span>
              </button>
            </div>
          ) : categoryRows.length === 0 ? (
            <div className="h-full min-h-[14rem] flex flex-col items-center justify-center gap-2 text-center px-4 text-white/50">
              <Radio className="w-8 h-8 text-white/30" />
              <p className="nc-text-subtitle">
                {normalizedSearch
                  ? 'Nenhum canal encontrado para esta busca.'
                  : 'Nenhum canal disponível no momento.'}
              </p>
            </div>
          ) : (
            <>
              {rowsTopSpacerPx > 0 && (
                <div
                  data-virtual-spacer="top"
                  aria-hidden="true"
                  style={{ height: `${rowsTopSpacerPx}px` }}
                />
              )}

              <div ref={setLeftVirtualRef} className="space-y-5">
                {visibleCategoryRows.map((row, offsetIdx) => {
                  const rowIndex = rowStartIndex + offsetIdx;
                  return (
                    <LiveCategoryRow
                      key={row.id}
                      row={row}
                      rowIndex={rowIndex}
                      credentials={credentials}
                      leftScrollEl={leftScrollNode}
                      selectedGroupId={selectedGroup?.groupId ?? null}
                      originGroupId={originState.groupId}
                      originCategoryId={originState.categoryId}
                      isGroupFavorite={isGroupFavorite}
                      onSelectGroup={handleSelectGroup}
                      onToggleFavorite={handleToggleFavorite}
                      onFocusCard={handleFocusCard}
                    />
                  );
                })}
              </div>

              {rowsBottomSpacerPx > 0 && (
                <div
                  data-virtual-spacer="bottom"
                  aria-hidden="true"
                  style={{ height: `${rowsBottomSpacerPx}px` }}
                />
              )}
            </>
          )}
        </div>
      </aside>

      {/* ===================================================================
          RIGHT PANE (~50%): Channel preview, variants, details, and EPG schedule
         =================================================================== */}
      <main
        data-nav-zone="content"
        className={`nc-live-right-pane w-full md:w-1/2 md:max-w-[50%] flex-1 md:flex-none flex-col min-w-0 min-h-0 bg-nc-bg overflow-y-auto md:overflow-hidden touch-pan-y ${
          isMobilePlayerOpen ? 'flex' : 'hidden md:flex'
        }`}
      >
        {!selectedGroup || !selectedChannel ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 gap-3 text-white/60">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-center">
              <Tv className="w-8 h-8 text-white/40" />
            </div>
            <h2 className="nc-heading-section text-white">Selecione um Canal</h2>
            <p className="nc-text-subtitle text-white/55 max-w-sm">
              Escolha um canal à esquerda para iniciar o preview ao vivo, alternar resoluções e consultar a programação completa.
            </p>
          </div>
        ) : (
          <div
            data-live-content-stack="true"
            className="flex-1 flex flex-col min-w-0 min-h-0 md:overflow-hidden"
          >
            {/* Mobile Back Bar (always rendered for mobile & responsive tests) */}
            <div className="md:hidden shrink-0 px-4 pt-3 pb-2 border-b border-white/10 flex items-center justify-between gap-2">
              <button
                type="button"
                data-nav-item="true"
                data-mobile-back="true"
                onClick={handleMobileBackToChannels}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Voltar aos Canais</span>
              </button>
            </div>

            {/* Top Section: Channel Info + Variants + Now Playing (Left) | Video Preview (Right) */}
            <div
              data-live-top-section="true"
              className="nc-live-top-section shrink-0 p-4 sm:p-5 border-b border-white/10 flex flex-col-reverse md:flex-row gap-4 items-start min-w-0"
            >
              {/* Channel Metadata + Variant Selector + Now Playing Summary */}
              <div
                data-live-info-column="true"
                className="flex-1 min-w-0 flex flex-col gap-2.5 w-full"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="nc-live-channel-logo relative w-11 h-11 shrink-0 rounded-lg bg-black/60 border border-white/10 flex items-center justify-center overflow-hidden p-1">
                    <Tv className="w-5 h-5 text-white/25" aria-hidden="true" />
                    {rightPanePrimaryLogo && (
                      <MediaImage
                        src={rightPanePrimaryLogo}
                        serverUrl={credentials?.serverUrl}
                        alt={selectedGroup.displayName}
                        itemId={getStreamIdString(selectedChannel)}
                        itemName={selectedGroup.displayName}
                        className="relative z-10 w-full h-full object-contain"
                      />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <h1 className="nc-live-channel-title nc-heading-section font-bold text-white line-clamp-2 whitespace-normal break-words w-full">
                        {selectedGroup.displayName}
                      </h1>
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {activeResolutionBadge && (
                        <span className="nc-badge-info px-2 py-0.5 rounded bg-white/15 text-white/90">
                          {activeResolutionBadge}
                        </span>
                      )}
                      <span
                        data-live-badge="true"
                        className="nc-badge-info inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" aria-hidden="true" />
                        <span>AO VIVO</span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Variant Selector Row (only rendered when multiple resolutions exist) */}
                {selectedGroup.isGrouped && Array.isArray(selectedGroup.variants) && selectedGroup.variants.length > 1 && (
                  <div className="space-y-1 min-w-0">
                    <span className="nc-text-meta text-white/50 block">Versão do canal</span>
                    <div
                      data-nav-row="true"
                      data-live-variants-row="true"
                      className="flex items-center gap-2 overflow-x-auto scrollbar-hide touch-pan-x py-1 max-w-full"
                    >
                      <button
                        type="button"
                        data-nav-item="true"
                        data-variant-active={selectedVariantIdOrAuto === 'auto' ? 'true' : 'false'}
                        onClick={() => handleSelectVariant('auto')}
                        className={`shrink-0 px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                          selectedVariantIdOrAuto === 'auto'
                            ? 'bg-white text-black'
                            : 'bg-white/10 text-white/80 hover:bg-white/20 hover:text-white'
                        }`}
                      >
                        Automático
                      </button>
                      {selectedGroup.variants.map((variant) => {
                        const vIdStr = String(variant.streamId);
                        const isActive = selectedVariantIdOrAuto === vIdStr;
                        return (
                          <button
                            key={vIdStr}
                            type="button"
                            data-nav-item="true"
                            data-variant-active={isActive ? 'true' : 'false'}
                            onClick={() => handleSelectVariant(vIdStr)}
                            className={`shrink-0 px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                              isActive
                                ? 'bg-white text-black'
                                : 'bg-white/10 text-white/80 hover:bg-white/20 hover:text-white'
                            }`}
                          >
                            {variant.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Now Playing Summary Card */}
                {currentEpgProgram && (
                  <div className="nc-live-now-playing rounded-lg bg-white/[0.04] border border-white/10 p-2.5 min-w-0">
                    <div className="flex items-center justify-between gap-2 text-xs text-white/60">
                      <span className="font-semibold text-white/90 truncate">
                        {currentEpgProgram.title}
                      </span>
                      {(currentEpgProgram.startLabel || currentEpgProgram.endLabel) && (
                        <span className="shrink-0 tabular-nums">
                          {currentEpgProgram.startLabel} - {currentEpgProgram.endLabel}
                        </span>
                      )}
                    </div>
                    {currentEpgProgram.description && (
                      <p className="nc-live-now-playing-desc nc-text-meta text-white/55 mt-1 line-clamp-2">
                        {currentEpgProgram.description}
                      </p>
                    )}
                  </div>
                )}

                {playbackError && (
                  <p className="nc-notice-banner rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-200">
                    {playbackError}
                  </p>
                )}
              </div>

              {/* Video Preview */}
              <div
                data-live-preview-column="true"
                className="nc-live-preview-box w-full md:w-[clamp(15rem,23.5vw,23.5rem)] shrink-0 aspect-video rounded-xl overflow-hidden bg-black border border-white/10 relative"
              >
                <VideoPlayer
                  streamUrl={activeStreamUrl}
                  title={selectedGroup.displayName}
                  contentType="live"
                  channelName={selectedGroup.displayName}
                  programTitle={currentEpgProgram?.title}
                  streamId={selectedChannel.stream_id ?? selectedChannel.id}
                  attemptTrigger={attemptTrigger}
                  fullscreenRequestTrigger={fullscreenRequestTrigger}
                  embedded={true}
                  disableEmbeddedControlsFocus={true}
                  onBack={closePreviewAndRestoreFocus}
                  onRetry={handleManualRetry}
                  onPlaybackSuccess={handlePlaybackSuccess}
                  onPlaybackFinalError={handlePlaybackFinalError}
                />
              </div>
            </div>

            {/* Bottom Section: EPG Timeline */}
            <div
              data-live-epg-section="true"
              className="flex-1 flex flex-col min-h-0 min-w-0 md:overflow-hidden"
            >
              <div
                data-live-epg-header="true"
                className="nc-live-epg-header shrink-0 px-4 sm:px-5 py-3 border-b border-white/10 flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-white/70" />
                  <h3 className="nc-heading-section text-white">Grade de Programação</h3>
                </div>
                {epgTimeline.length > 0 && (
                  <span className="nc-text-meta text-white/50">
                    {epgTimeline.length} {epgTimeline.length === 1 ? 'programa' : 'programas'}
                  </span>
                )}
              </div>

              <div
                data-epg-scroll="true"
                data-scroll-container="true"
                className="nc-live-epg-scroll flex-1 min-h-0 md:overflow-y-auto custom-scrollbar touch-pan-y px-4 sm:px-5 py-4"
              >
                {epgTimeline.length === 0 ? (
                  (() => {
                    const epgStateKind: 'loading' | 'error' | 'empty' = rightPaneEpgLoading
                      ? 'loading'
                      : rightPaneEpg?.status === 'error'
                        ? 'error'
                        : 'empty';
                    return (
                      <div
                        key="epg-state-box"
                        tabIndex={0}
                        data-nav-item="true"
                        data-epg-primary="true"
                        data-epg-state={epgStateKind}
                        className="nc-tv-epg-state rounded-xl border border-white/10 bg-white/[0.03] p-5 text-center text-white/55 nc-text-subtitle flex items-center justify-center gap-2 focus:outline-none"
                      >
                        {epgStateKind === 'loading' ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Carregando programação...</span>
                          </>
                        ) : epgStateKind === 'error' ? (
                          <span>Programação indisponível no momento.</span>
                        ) : (
                          <span>Nenhuma programação disponível para este canal.</span>
                        )}
                      </div>
                    );
                  })()
                ) : (
                  <div className="nc-tv-epg-timeline space-y-2.5">
                    {epgTimeline.map((prog, idx) => (
                      <article
                        key={`${prog.id}_${prog.startMs}_${idx}`}
                        role="article"
                        tabIndex={0}
                        data-epg-item="true"
                        data-nav-item="true"
                        data-epg-primary={idx === 0 ? 'true' : undefined}
                        className={`nc-tv-epg-card rounded-xl border p-3.5 transition-colors ${
                          prog.isCurrent
                            ? 'border-white/35 bg-white/[0.08]'
                            : 'border-white/10 bg-white/[0.03]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="nc-text-meta font-semibold text-white/80 tabular-nums">
                            {prog.startLabel} - {prog.endLabel}
                          </span>
                          {prog.isCurrent && (
                            <span
                              data-epg-live-badge="true"
                              className="nc-badge-info px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20"
                            >
                              AO VIVO
                            </span>
                          )}
                        </div>
                        <h4 className="text-sm font-semibold text-white/95 leading-snug">
                          {prog.title}
                        </h4>
                        {prog.description && (
                          <p className="nc-text-meta text-white/60 mt-1 line-clamp-2">
                            {prog.description}
                          </p>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
});
