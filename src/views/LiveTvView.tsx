import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { TvMinimalPlay, Loader2, Heart, ArrowLeft, Calendar, AlertCircle, RefreshCw, X, Layers } from 'lucide-react';
import { useXtreamCredentials, useXtreamLive } from '../context/XtreamContext';
import { useFavorites, FavoriteItem } from '../hooks/useFavorites';
import { VideoPlayer } from '../components/VideoPlayer';
import { MediaImage } from '../components/MediaImage';
import { XtreamService } from '../services/xtreamService';
import { buildDirectMediaUrl } from '../utils/mediaUtils';
import { useAccountPlaybackHistory, recordPlaybackPosition } from '../utils/playbackHistory';
import { formatCategoryLabel } from '../utils/categoryLabel';
import {
  groupLiveStreams,
  filterLiveChannelGroups,
  parseChannelVariantSuffix,
  LiveChannelGroup,
  ResolutionQuality,
} from '../utils/liveChannelGroups';
import { getOrCreateLiveIndex } from '../utils/catalogIndex';
import { useVirtualWindow } from '../hooks/useVirtualWindow';
import {
  useBackHandler,
  BACK_PRIORITY,
  getNavMode,
  focusElementSafely,
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

  // 1. Manual mode handling:
  if (targetMode !== 'auto') {
    const selectedVariant = group.variants.find(
      (v) => String(v.streamId) === targetMode || v.label === targetMode || v.resolution === targetMode
    );

    const targetResolution = selectedVariant ? selectedVariant.resolution : (targetMode as ResolutionQuality);

    // First priority in manual mode: try the specific chosen stream if not yet attempted
    if (selectedVariant && !attemptedSet.has(selectedVariant.streamId)) {
      return selectedVariant.stream;
    }

    // Second priority: try other untried streams of the SAME chosen resolution in original order
    const sameResVariants = group.variants.filter((v) => v.resolution === targetResolution);
    for (const v of sameResVariants) {
      if (!attemptedSet.has(v.streamId)) {
        return v.stream;
      }
    }

    // Third priority: fallback to other resolutions in automatic priority order SD > HD > FHD > 4K
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

  // Pick any remaining untried variant in group
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

  const sidebarWidth = isMobile
    ? 0
    : displayMode === 'tv'
      ? Math.round(12.75 * remPx)
      : viewportWidth >= 1024
        ? 256
        : 80;
  const contentAreaWidth = Math.max(320, viewportWidth - sidebarWidth);
  const categoryPaneWidth = isMobile
    ? 0
    : displayMode === 'tv'
      ? Math.min(Math.round(viewportWidth * 0.42), Math.round(16.25 * remPx))
      : Math.round(contentAreaWidth * (viewportWidth >= 1024 ? 0.3 : 0.35));

  const rightPaneWidth = isMobile
    ? viewportWidth
    : Math.max(300, contentAreaWidth - categoryPaneWidth);
  const safeBottomPx =
    displayMode === 'tv' ? Math.min(28, Math.max(10, Math.round(viewportHeight * 0.022))) : 0;
  const rightPaneHeight = Math.max(240, viewportHeight - safeBottomPx);

  const topSectionDirection: 'row' | 'column' = isMobile ? 'column' : 'row';
  const topPadY =
    displayMode === 'tv'
      ? Math.round(1.1 * remPx)
      : isShortLandscape
        ? 16
        : 20;
  const topPadX =
    displayMode === 'tv'
      ? Math.round(1.7 * remPx)
      : isShortLandscape
        ? 24
        : 24;

  const innerTopWidth = Math.max(240, rightPaneWidth - topPadX);
  let previewWidth: number;
  if (isMobile) {
    previewWidth = innerTopWidth;
  } else if (displayMode === 'tv') {
    previewWidth = Math.round(
      Math.max(11 * remPx, Math.min(viewportWidth * 0.23, 15 * remPx))
    );
  } else if (isShortLandscape) {
    previewWidth = Math.round(Math.max(176, Math.min(viewportWidth * 0.23, 232)));
  } else {
    previewWidth = Math.round(Math.min(innerTopWidth * 0.4, viewportWidth >= 1024 ? 320 : 248));
  }
  const previewHeight = Math.round((previewWidth * 9) / 16);
  const previewAspectRatio = Number((previewWidth / Math.max(1, previewHeight)).toFixed(4));

  const logoRowHeight = Math.round(
    (displayMode === 'tv' || isShortLandscape ? 2.5 : 2.75) * remPx
  );
  const variantsHeight = isGrouped ? Math.round(2.05 * remPx) : 0;
  const nowPlayingHeight = hasNowPlaying
    ? Math.round((displayMode === 'tv' || isShortLandscape ? 3.85 : 4.25) * remPx)
    : 0;
  const summaryGaps =
    (variantsHeight > 0 ? Math.round(0.45 * remPx) : 0) +
    (nowPlayingHeight > 0 ? Math.round(0.45 * remPx) : 0);
  const summaryHeight = logoRowHeight + variantsHeight + nowPlayingHeight + summaryGaps;

  const mobileBackHeight = isMobile ? 44 : 0;
  const topSectionHeight =
    topSectionDirection === 'row'
      ? Math.max(previewHeight, summaryHeight) + topPadY
      : mobileBackHeight + previewHeight + summaryHeight + topPadY + 10;

  const epgHeaderHeight = Math.round(
    (displayMode === 'tv' || isShortLandscape ? 2.25 : 2.5) * remPx
  );
  const epgSectionHeight = isMobile
    ? Math.max(220, rightPaneHeight - topSectionHeight)
    : Math.max(120, rightPaneHeight - topSectionHeight);
  const epgScrollViewportHeight = Math.max(84, epgSectionHeight - epgHeaderHeight);

  const epgCardHeight = Math.round(
    (displayMode === 'tv' || isShortLandscape ? 4.35 : 4.65) * remPx
  );
  const epgGap = Math.round(0.6 * remPx);
  const epgPadY = Math.round(1.1 * remPx);
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

export const LiveTvView = React.memo(function LiveTvView({
  searchQuery = '',
  initialChannelIntent = null,
  onConsumeChannelIntent,
}: LiveTvViewProps) {
  const { credentials } = useXtreamCredentials();
  const { 
    liveCategories, liveStreams, allLiveStreams, fetchLiveStreams, 
    loadingLive, liveError, liveCategoriesError, liveCategoriesStatus,
    liveCatalogStatus, fetchLiveCategories 
  } = useXtreamLive();
  
  // Navigation states
  const [leftPaneView, setLeftPaneView] = useState<'categories' | 'channels'>('categories');
  const [isMobilePlayerOpen, setIsMobilePlayerOpen] = useState(false);

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>('nc_recent');
  const [loadingCategoryId, setLoadingCategoryId] = useState<string | null>(null);
  
  // Group selection & variant selection state
  const [selectedGroup, setSelectedGroup] = useState<LiveChannelGroup | null>(null);
  const [activeVariantStream, setActiveVariantStream] = useState<any | null>(null);
  const [selectedResolutionMode, setSelectedResolutionMode] = useState<'auto' | string>('auto');
  const [attemptTrigger, setAttemptTrigger] = useState(0);
  const [fullscreenRequestTrigger, setFullscreenRequestTrigger] = useState(0);
  
  // States for EPG
  const [epgData, setEpgData] = useState<any[]>([]);
  const [loadingEpg, setLoadingEpg] = useState(false);
  const [epgError, setEpgError] = useState<string | null>(null);

  const { favorites, isFavorite, toggleFavorite, toggleGroupFavorites, favoriteError, clearFavoriteError } = useFavorites();
  const [favActionError, setFavActionError] = useState<string | null>(null);

  const historyRecords = useAccountPlaybackHistory(credentials);

  // References for playback attempt tracking and session fallback
  const isMountedRef = useRef<boolean>(true);
  const sessionSuccessfulVariantsRef = useRef<Map<string, string | number>>(new Map());
  const attemptedStreamIdsRef = useRef<Set<string | number>>(new Set());
  const attemptIdRef = useRef<number>(0);
  const fallbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeVariantStreamRef = useRef<any | null>(null);
  activeVariantStreamRef.current = activeVariantStream;

  // References for D-pad focus and scroll preservation between categories, channels, preview, and EPG
  const viewRootRef = useRef<HTMLDivElement>(null);
  const categoriesListRef = useRef<HTMLDivElement>(null);
  const channelsScrollRef = useRef<HTMLDivElement>(null);
  const channelsListRef = useRef<HTMLDivElement>(null);
  const epgScrollRef = useRef<HTMLDivElement>(null);
  const isEpgFocusedRef = useRef<boolean>(false);
  const originChannelGroupIdRef = useRef<string | null>(null);
  const originChannelIndexRef = useRef<number>(-1);
  const categoriesScrollTopRef = useRef<number>(0);
  const originCategoryIdRef = useRef<string>('nc_recent');
  const lastPointerDownTimeRef = useRef<number>(0);
  const pendingChannelEntryCategoryRef = useRef<string | null>(null);
  const pendingCategoryRestoreFocusRef = useRef<string | null>(null);
  const pendingChannelRestoreFocusRef = useRef<string | null>(null);
  const consumedIntentRequestIdRef = useRef<number | null>(null);

  const liveIndex = useMemo(() => getOrCreateLiveIndex(allLiveStreams), [allLiveStreams]);

  // Cancel fallbackTimeoutRef and invalidate active attempt on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current);
        fallbackTimeoutRef.current = null;
      }
      attemptIdRef.current++;
    };
  }, []);

  // Reset active attempt and memory when active credentials change
  useEffect(() => {
    if (fallbackTimeoutRef.current) {
      clearTimeout(fallbackTimeoutRef.current);
      fallbackTimeoutRef.current = null;
    }
    attemptIdRef.current++;
    sessionSuccessfulVariantsRef.current.clear();
    attemptedStreamIdsRef.current.clear();
    setSelectedGroup(null);
    setActiveVariantStream(null);
    setMiniPlayerUrl('');
    setMiniPlayerError(null);
  }, [credentials]);

  useEffect(() => {
    if (favActionError) {
      const timer = setTimeout(() => {
        setFavActionError(null);
        clearFavoriteError();
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [favActionError, clearFavoriteError]);

  const handleToggleFavorite = (item: FavoriteItem) => {
    const success = toggleFavorite(item);
    if (!success) {
      setFavActionError('Não foi possível salvar os favoritos neste dispositivo. Tente novamente.');
    } else {
      setFavActionError(null);
    }
  };

  // Handle group favorite toggle
  const handleToggleGroupFavorite = (group: LiveChannelGroup) => {
    const groupFavIds = group.allStreams
      .map((s) => String(s.stream_id || s.id))
      .filter((id) => isFavorite(id, 'live'));

    if (groupFavIds.length > 0) {
      // Remove all favorited stream IDs belonging to this group in a single atomic operation
      const ok = toggleGroupFavorites(groupFavIds);
      if (!ok) {
        setFavActionError('Não foi possível salvar os favoritos neste dispositivo. Tente novamente.');
      } else {
        setFavActionError(null);
      }
    } else {
      // Add one representative favorite
      const repStream = group.primaryStream;
      const repId = repStream.stream_id || repStream.id;
      const ok = toggleGroupFavorites([], {
        id: repId,
        name: group.displayName,
        cover: group.stream_icon || '',
        type: 'live',
      });
      if (!ok) {
        setFavActionError('Não foi possível salvar os favoritos neste dispositivo. Tente novamente.');
      } else {
        setFavActionError(null);
      }
    }
  };

  const favoriteChannels = useMemo(() => {
    return favorites
      .filter((f) => f.type === 'live')
      .map((f) => liveIndex.getById(f.id))
      .filter(Boolean);
  }, [favorites, liveIndex]);

  const recentChannels = useMemo(() => {
    if (!allLiveStreams || allLiveStreams.length === 0) return [];
    const liveRecords = historyRecords.filter((r) => r.type === 'live');

    const result: any[] = [];
    const seenIds = new Set<string | number>();

    for (const record of liveRecords) {
      const item = liveIndex.getById(record.id);
      if (item) {
        const itemId = item.stream_id || item.id;
        if (!seenIds.has(itemId)) {
          seenIds.add(itemId);
          result.push(item);
        }
      }
    }

    return result;
  }, [historyRecords, allLiveStreams.length, liveIndex]);

  const extendedCategories = useMemo(() => {
    const virtualCats = [
      { category_id: 'nc_recent', category_name: 'Assistidos Recentemente' },
      { category_id: 'nc_fav', category_name: 'Canais Favoritos' },
    ];
    return [...virtualCats, ...liveCategories];
  }, [liveCategories]);

  // Default to first category
  useEffect(() => {
    if (extendedCategories.length > 0 && selectedCategoryId === undefined) {
      setSelectedCategoryId(extendedCategories[0].category_id);
    }
  }, [extendedCategories, selectedCategoryId]);

  // Load streams when category is selected
  useEffect(() => {
    let isCurrent = true;
    if (selectedCategoryId && selectedCategoryId !== 'nc_recent' && selectedCategoryId !== 'nc_fav') {
      const targetCat = String(selectedCategoryId);
      setLoadingCategoryId(targetCat);
      Promise.resolve(fetchLiveStreams(selectedCategoryId))
        .catch(() => {})
        .finally(() => {
          if (isCurrent) {
            setLoadingCategoryId((prev) => (prev === targetCat ? null : prev));
          }
        });
    } else {
      setLoadingCategoryId(null);
    }
    if (channelsScrollRef.current) {
      channelsScrollRef.current.scrollTop = 0;
    }
    return () => {
      isCurrent = false;
    };
  }, [selectedCategoryId, fetchLiveStreams]);

  // Handle Search query override
  useEffect(() => {
    if (searchQuery) {
      setLeftPaneView('channels');
      if (channelsScrollRef.current) {
        channelsScrollRef.current.scrollTop = 0;
      }
    }
  }, [searchQuery]);

  // Strictly filter streams by selectedCategoryId for real categories using O(1) index when allLiveStreams is available
  const rawFilteredStreams = useMemo(() => {
    if (!selectedCategoryId) return [];
    if (selectedCategoryId === 'nc_recent') return recentChannels;
    if (selectedCategoryId === 'nc_fav') return favoriteChannels;

    const targetCatId = String(selectedCategoryId);
    if (allLiveStreams.length > 0) {
      const indexed = liveIndex.getByCategory(targetCatId);
      if (indexed.length > 0) {
        return indexed;
      }
    }
    const matchingFromLive = liveStreams.filter(
      (s) => s && String(s.category_id) === targetCatId
    );
    return matchingFromLive;
  }, [selectedCategoryId, recentChannels, favoriteChannels, liveStreams, allLiveStreams.length, liveIndex]);

  const isRealCategory = Boolean(
    selectedCategoryId &&
      selectedCategoryId !== 'nc_recent' &&
      selectedCategoryId !== 'nc_fav'
  );

  const isCategoryChannelsLoading = Boolean(
    !searchQuery &&
      isRealCategory &&
      rawFilteredStreams.length === 0 &&
      (loadingCategoryId === String(selectedCategoryId) ||
        loadingLive ||
        liveCatalogStatus === 'loading' ||
        liveCatalogStatus === 'idle')
  );

  // Groups streams using cached category/catalog group index
  const groupedChannels = useMemo(() => {
    if (searchQuery && searchQuery.trim().length > 0) {
      const allGroups = liveIndex.getAllGroups();
      return filterLiveChannelGroups(allGroups, searchQuery);
    }

    if (selectedCategoryId === 'nc_recent' || selectedCategoryId === 'nc_fav') {
      return rawFilteredStreams.map((stream) => {
        const sId = stream.stream_id || stream.id;
        return {
          groupId: `single_virtual_${sId}`,
          displayName: stream.name || 'Sem nome',
          category_id: stream.category_id,
          epg_channel_id: stream.epg_channel_id,
          stream_icon: stream.stream_icon,
          isGrouped: false,
          variants: [],
          primaryStream: stream,
          allStreams: [stream],
        } as LiveChannelGroup;
      });
    }

    if (selectedCategoryId && allLiveStreams.length > 0) {
      const cachedCatGroups = liveIndex.getGroupsByCategory(selectedCategoryId);
      if (cachedCatGroups.length > 0) {
        return cachedCatGroups;
      }
    }

    return groupLiveStreams(rawFilteredStreams);
  }, [rawFilteredStreams, allLiveStreams.length, liveIndex, selectedCategoryId, searchQuery]);

  const {
    startIndex: channelStartIndex,
    endIndex: channelEndIndex,
    topSpacerPx: channelTopSpacerPx,
    bottomSpacerPx: channelBottomSpacerPx,
    ensureIndexMounted: ensureChannelIndexMounted,
    scrollContainerCallbackRef: channelsScrollCallbackRef,
    virtualContainerCallbackRef: channelsListCallbackRef,
  } = useVirtualWindow({
    totalCount: groupedChannels.length,
    mode: 'list',
    scrollContainerRef: channelsScrollRef,
    virtualContainerRef: channelsListRef,
    resetKey: `${selectedCategoryId ?? ''}__${searchQuery}__${leftPaneView}`,
    maxWindowItems: 80,
  });

  const displayedGroups = useMemo(
    () => groupedChannels.slice(channelStartIndex, channelEndIndex),
    [groupedChannels, channelStartIndex, channelEndIndex]
  );

  // Mini-player states
  const [miniPlayerUrl, setMiniPlayerUrl] = useState<string>('');
  const [miniPlayerError, setMiniPlayerError] = useState<string | null>(null);
  const [miniPlayerLoading, setMiniPlayerLoading] = useState(false);

  // Helper to pick next variant in group (SD -> HD -> FHD -> 4K automatic priority)
  const pickVariantForGroup = useCallback((
    group: LiveChannelGroup,
    targetMode: string,
    attemptedSet: Set<string | number>
  ): any | null => {
    const successfulId = group ? sessionSuccessfulVariantsRef.current.get(group.groupId) : undefined;
    return selectChannelVariantForAttempt(group, targetMode, attemptedSet, successfulId);
  }, []);

  // Execute an attempt for a stream/variant
  const startVariantAttempt = useCallback((
    group: LiveChannelGroup,
    targetMode: string,
    forcedStream?: any
  ) => {
    if (!isMountedRef.current) {
      return;
    }
    if (fallbackTimeoutRef.current) {
      clearTimeout(fallbackTimeoutRef.current);
      fallbackTimeoutRef.current = null;
    }

    const currentAttemptId = ++attemptIdRef.current;
    const targetStream = forcedStream || pickVariantForGroup(group, targetMode, attemptedStreamIdsRef.current);

    if (!targetStream) {
      setMiniPlayerError('Não foi possível carregar nenhuma versão do canal. Verifique a conexão com o servidor.');
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

        // Fallback timeout (default 28 seconds) if playback doesn't start
        const timeoutMs = getLiveFallbackTimeoutMs();
        fallbackTimeoutRef.current = setTimeout(() => {
          fallbackTimeoutRef.current = null;
          if (!isMountedRef.current || attemptIdRef.current !== currentAttemptId) return;
          attemptedStreamIdsRef.current.add(streamId);
          const nextStream = pickVariantForGroup(group, targetMode, attemptedStreamIdsRef.current);
          if (nextStream) {
            startVariantAttempt(group, targetMode, nextStream);
          } else {
            setMiniPlayerError('Não foi possível carregar nenhuma versão do canal (Tempo limite esgotado).');
            setMiniPlayerLoading(false);
          }
        }, timeoutMs);
      }
    } catch (err: any) {
      if (isMountedRef.current && attemptIdRef.current === currentAttemptId) {
        attemptedStreamIdsRef.current.add(streamId);
        setMiniPlayerUrl('');
        setMiniPlayerError(err.message || 'Falha ao conectar à transmissão do canal.');
        setMiniPlayerLoading(false);
      }
    }
  }, [credentials, pickVariantForGroup]);

  const syncOriginChannelDomAttribute = useCallback((groupId: string | null) => {
    const listRoot = channelsListRef.current;
    if (!listRoot) return;
    const channelBtns = listRoot.querySelectorAll<HTMLButtonElement>(
      'button[data-live-channel-btn="true"]'
    );
    channelBtns.forEach((btn) => {
      const isMatch = groupId !== null && btn.getAttribute('data-live-channel-id') === groupId;
      btn.setAttribute('data-live-channel-origin', isMatch ? 'true' : 'false');
    });
  }, []);

  const handleChannelRowFocus = useCallback(
    (groupId: string, actualIndex: number) => {
      originChannelGroupIdRef.current = groupId;
      originChannelIndexRef.current = actualIndex;
      syncOriginChannelDomAttribute(groupId);
    },
    [syncOriginChannelDomAttribute]
  );

  // Handle group click: 1st OK starts channel in preview; 2nd OK on already-selected active channel expands to fullscreen without restarting stream
  const handleSelectGroup = useCallback((group: LiveChannelGroup) => {
    // Prevent starting a channel from a stale category when a real category is active
    if (
      !searchQuery &&
      selectedCategoryId &&
      selectedCategoryId !== 'nc_recent' &&
      selectedCategoryId !== 'nc_fav' &&
      group.category_id !== undefined &&
      String(group.category_id) !== String(selectedCategoryId)
    ) {
      return;
    }

    originChannelGroupIdRef.current = group.groupId;
    const groupIdx = groupedChannels.findIndex((g) => g.groupId === group.groupId);
    if (groupIdx >= 0) {
      originChannelIndexRef.current = groupIdx;
    }
    syncOriginChannelDomAttribute(group.groupId);

    if (selectedGroup && selectedGroup.groupId === group.groupId && !miniPlayerError && miniPlayerUrl) {
      setIsMobilePlayerOpen(true);
      setFullscreenRequestTrigger((prev) => prev + 1);
      return;
    }
    setSelectedGroup(group);
    setSelectedResolutionMode('auto');
    attemptedStreamIdsRef.current.clear();
    setIsMobilePlayerOpen(true);
    startVariantAttempt(group, 'auto');
  }, [searchQuery, selectedCategoryId, groupedChannels, syncOriginChannelDomAttribute, selectedGroup, miniPlayerError, miniPlayerUrl, startVariantAttempt]);

  // Handle manual resolution mode change
  const handleSelectResolutionMode = useCallback((variant: any | 'auto') => {
    if (!selectedGroup) return;
    attemptedStreamIdsRef.current.clear();

    if (variant === 'auto') {
      setSelectedResolutionMode('auto');
      startVariantAttempt(selectedGroup, 'auto');
    } else {
      const vId = String(variant.stream_id || variant.id || variant.streamId);
      setSelectedResolutionMode(vId);
      startVariantAttempt(selectedGroup, vId, variant);
    }
  }, [selectedGroup, startVariantAttempt]);

  // Handle playback success callback
  const handlePlaybackSuccess = useCallback((attemptId?: number) => {
    if (!isMountedRef.current || attemptId === undefined || attemptId !== attemptIdRef.current) {
      return; // Discard absent or stale callback
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
      recordPlaybackPosition(credentials, { id: streamId, type: 'live' });
    }
  }, [selectedGroup, activeVariantStream, credentials]);

  // Handle playback final error callback
  const handlePlaybackFinalError = useCallback((errorMsg: string, attemptId?: number) => {
    if (!isMountedRef.current || attemptId === undefined || attemptId !== attemptIdRef.current) {
      return; // Discard absent or stale callback
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
      const nextStream = pickVariantForGroup(selectedGroup, selectedResolutionMode, attemptedStreamIdsRef.current);
      if (nextStream) {
        startVariantAttempt(selectedGroup, selectedResolutionMode, nextStream);
        return;
      }
    }

    setMiniPlayerError('Não foi possível carregar nenhuma versão do canal. ' + (errorMsg || ''));
    setMiniPlayerLoading(false);
  }, [activeVariantStream, selectedGroup, selectedResolutionMode, pickVariantForGroup, startVariantAttempt]);

  // Handle retry
  const handleRetry = useCallback(() => {
    if (!selectedGroup) return;
    attemptedStreamIdsRef.current.clear();
    startVariantAttempt(selectedGroup, selectedResolutionMode);
  }, [selectedGroup, selectedResolutionMode, startVariantAttempt]);

  const shouldApplyProgrammaticFocus = useCallback(() => {
    const isRecentPointer =
      getNavMode() === 'pointer' && Date.now() - lastPointerDownTimeRef.current < 250;
    return !isRecentPointer;
  }, []);

  // Consume launch intent from Home ("Canais Ao Vivo" row) exactly once per requestId
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

    const rawStreamId = initialChannelIntent.streamId;
    const targetIdStr =
      rawStreamId !== undefined && rawStreamId !== null ? String(rawStreamId).trim() : '';

    const sourcePool = allLiveStreams.length > 0 ? allLiveStreams : liveStreams;
    const matchedStream = targetIdStr
      ? (allLiveStreams.length > 0
          ? liveIndex.getById(targetIdStr) || null
          : sourcePool.find((s: any) => s && String(s.stream_id ?? s.id) === targetIdStr))
      : null;

    if (matchedStream) {
      const catId = matchedStream.category_id ? String(matchedStream.category_id) : 'nc_recent';
      originCategoryIdRef.current = catId;
      setSelectedCategoryId(catId);
      setLeftPaneView('channels');

      const groupsInCat =
        catId !== 'nc_recent' && catId !== 'nc_fav' && allLiveStreams.length > 0
          ? liveIndex.getGroupsByCategory(catId)
          : groupLiveStreams(
              catId !== 'nc_recent' && catId !== 'nc_fav'
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

      pendingChannelEntryCategoryRef.current = null;
      if (shouldApplyProgrammaticFocus()) {
        pendingChannelRestoreFocusRef.current = targetGroup.groupId;
      }

      setSelectedGroup(targetGroup);
      setSelectedResolutionMode('auto');
      attemptedStreamIdsRef.current.clear();
      setIsMobilePlayerOpen(true);
      startVariantAttempt(targetGroup, 'auto');
      return;
    }

    // Invalid stream_id or stream not found in account catalog: open recoverable error state in LiveTvView preview
    const fallbackCatId =
      initialChannelIntent.categoryId &&
      liveCategories.some((c) => String(c.category_id) === String(initialChannelIntent.categoryId))
        ? String(initialChannelIntent.categoryId)
        : liveCategories[0]?.category_id
          ? String(liveCategories[0].category_id)
          : 'nc_recent';

    originCategoryIdRef.current = fallbackCatId;
    setSelectedCategoryId(fallbackCatId);
    setLeftPaneView('channels');
    pendingChannelEntryCategoryRef.current = null;

    const snap = initialChannelIntent.streamSnapshot || {};
    const fallbackGroup: LiveChannelGroup = {
      groupId: `invalid_intent_${initialChannelIntent.requestId}`,
      displayName: snap.name || 'Canal Indisponível',
      category_id: snap.category_id || fallbackCatId,
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
    setIsMobilePlayerOpen(true);
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
    liveCategories,
    liveCatalogStatus,
    loadingLive,
    onConsumeChannelIntent,
    shouldApplyProgrammaticFocus,
    startVariantAttempt,
  ]);

  // Close channel/player
  const handleCloseChannel = useCallback(() => {
    const closedGroupId = selectedGroup?.groupId || null;
    if (fallbackTimeoutRef.current) {
      clearTimeout(fallbackTimeoutRef.current);
      fallbackTimeoutRef.current = null;
    }
    attemptIdRef.current++;
    setSelectedGroup(null);
    setActiveVariantStream(null);
    setMiniPlayerUrl('');
    setMiniPlayerLoading(false);
    setMiniPlayerError(null);
    setIsMobilePlayerOpen(false);

    if (closedGroupId && shouldApplyProgrammaticFocus()) {
      pendingChannelRestoreFocusRef.current = closedGroupId;
      const root = viewRootRef.current || document.body;
      const channelBtns = Array.from(
        root.querySelectorAll('button[data-live-channel-id]')
      ) as HTMLButtonElement[];
      const targetBtn =
        channelBtns.find((b) => b.getAttribute('data-live-channel-id') === closedGroupId) ||
        channelBtns[0];
      if (targetBtn) {
        focusElementSafely(targetBtn);
        pendingChannelRestoreFocusRef.current = null;
      }
    }
  }, [selectedGroup, shouldApplyProgrammaticFocus]);

  const handleReturnToCategories = useCallback(() => {
    pendingChannelEntryCategoryRef.current = null;
    if (shouldApplyProgrammaticFocus()) {
      pendingCategoryRestoreFocusRef.current =
        originCategoryIdRef.current || String(selectedCategoryId || 'nc_recent');
    }
    setLeftPaneView('categories');
  }, [selectedCategoryId, shouldApplyProgrammaticFocus]);

  // Focus first channel of the active category (or "Voltar às Categorias" while loading/empty) after entering channels view
  useEffect(() => {
    if (leftPaneView !== 'channels') return;

    if (pendingChannelRestoreFocusRef.current) {
      if (!shouldApplyProgrammaticFocus()) {
        pendingChannelRestoreFocusRef.current = null;
        return;
      }
      const targetId = pendingChannelRestoreFocusRef.current;
      const targetIdx = groupedChannels.findIndex((g) => g.groupId === targetId);
      if (targetIdx >= 0) {
        ensureChannelIndexMounted(targetIdx);
      }
      const root = viewRootRef.current || document.body;
      const channelBtns = Array.from(
        root.querySelectorAll('button[data-live-channel-id]')
      ) as HTMLButtonElement[];
      const targetBtn =
        channelBtns.find((b) => b.getAttribute('data-live-channel-id') === targetId) ||
        channelBtns[0];
      if (targetBtn) {
        focusElementSafely(targetBtn);
        pendingChannelRestoreFocusRef.current = null;
        return;
      }
      if (!isCategoryChannelsLoading && liveCatalogStatus !== 'loading' && liveCatalogStatus !== 'idle') {
        const backToCatsBtn = root.querySelector(
          'button[data-live-back-to-categories="true"]'
        ) as HTMLButtonElement | null;
        if (backToCatsBtn) {
          focusElementSafely(backToCatsBtn);
        }
        pendingChannelRestoreFocusRef.current = null;
      }
    }

    if (!pendingChannelEntryCategoryRef.current) return;

    if (!shouldApplyProgrammaticFocus()) {
      pendingChannelEntryCategoryRef.current = null;
      return;
    }

    const currentCatStr = String(selectedCategoryId || '');
    if (pendingChannelEntryCategoryRef.current !== currentCatStr) {
      // Category changed (e.g. rapid A -> B): replace stale A focus target with B
      pendingChannelEntryCategoryRef.current = currentCatStr;
    }

    const root = viewRootRef.current || document.body;
    const activeEl = document.activeElement as HTMLElement | null;

    // If user already deliberately moved focus away (e.g. to another control, channel, sidebar, or header), do not steal focus
    if (
      activeEl &&
      activeEl !== document.body &&
      activeEl !== document.documentElement &&
      activeEl.getAttribute('data-live-back-to-categories') !== 'true' &&
      !activeEl.hasAttribute('data-live-category-id')
    ) {
      pendingChannelEntryCategoryRef.current = null;
      return;
    }

    const channelBtns = Array.from(
      root.querySelectorAll('button[data-live-channel-btn="true"]')
    ) as HTMLButtonElement[];
    const firstMatchingChannelBtn = isRealCategory
      ? channelBtns.find(
          (btn) => btn.getAttribute('data-live-channel-category-id') === currentCatStr
        )
      : channelBtns[0];

    if (firstMatchingChannelBtn) {
      focusElementSafely(firstMatchingChannelBtn);
      pendingChannelEntryCategoryRef.current = null;
      return;
    }

    const isStillLoading =
      isCategoryChannelsLoading ||
      liveCatalogStatus === 'loading' ||
      liveCatalogStatus === 'idle';

    const backToCatsBtn = root.querySelector(
      'button[data-live-back-to-categories="true"]'
    ) as HTMLButtonElement | null;
    if (backToCatsBtn && (!activeEl || activeEl === document.body || !root.contains(activeEl))) {
      focusElementSafely(backToCatsBtn);
    }

    if (!isStillLoading) {
      if (backToCatsBtn) {
        focusElementSafely(backToCatsBtn);
      }
      pendingChannelEntryCategoryRef.current = null;
    }
  }, [
    leftPaneView,
    selectedCategoryId,
    isRealCategory,
    groupedChannels,
    displayedGroups,
    ensureChannelIndexMounted,
    isCategoryChannelsLoading,
    liveCatalogStatus,
    selectedGroup,
    shouldApplyProgrammaticFocus,
  ]);

  // Restore categories scrollTop and origin category button focus when returning to categories view
  useEffect(() => {
    if (leftPaneView !== 'categories') return;

    if (categoriesListRef.current) {
      categoriesListRef.current.scrollTop = categoriesScrollTopRef.current;
    }

    if (pendingCategoryRestoreFocusRef.current) {
      const targetCatId = pendingCategoryRestoreFocusRef.current;
      pendingCategoryRestoreFocusRef.current = null;
      const root = categoriesListRef.current || viewRootRef.current || document.body;
      const catBtns = Array.from(
        root.querySelectorAll('button[data-live-category-id]')
      ) as HTMLButtonElement[];
      const targetBtn =
        catBtns.find((b) => b.getAttribute('data-live-category-id') === targetCatId) || catBtns[0];
      if (targetBtn) {
        const savedScroll = categoriesScrollTopRef.current;
        focusElementSafely(targetBtn);
        if (categoriesListRef.current) {
          categoriesListRef.current.scrollTop = savedScroll;
        }
      }
    }
  }, [leftPaneView, extendedCategories.length]);

  // Register LiveTvView internal Back handler (close active channel preview or return from channels to categories)
  useBackHandler(
    'livetv-internal',
    BACK_PRIORITY.VIEW_INTERNAL,
    () => {
      if (selectedGroup) {
        handleCloseChannel();
        return true;
      }
      if (leftPaneView === 'channels' && !searchQuery) {
        handleReturnToCategories();
        return true;
      }
      return false;
    },
    Boolean(selectedGroup || (leftPaneView === 'channels' && !searchQuery))
  );

  const activeStreamId = useMemo(() => {
    if (!activeVariantStream) return '';
    const rawId = activeVariantStream.stream_id ?? activeVariantStream.id;
    return rawId !== undefined && rawId !== null ? String(rawId) : '';
  }, [activeVariantStream]);

  // Fetch EPG only when the active variant stream ID actually changes (never on focus movements)
  useEffect(() => {
    let isMounted = true;
    if (!activeStreamId || !credentials) {
      setEpgData([]);
      setLoadingEpg(false);
      setEpgError(null);
      return () => {
        isMounted = false;
      };
    }

    if (epgScrollRef.current) {
      epgScrollRef.current.scrollTop = 0;
    }
    setLoadingEpg(true);
    setEpgError(null);
    setEpgData([]);

    const currentStream = activeVariantStreamRef.current;
    const sId = currentStream?.stream_id ?? currentStream?.id ?? activeStreamId;

    XtreamService.getShortEpg(credentials, sId, 10)
      .then((data) => {
        if (isMounted) {
          const rawListings = Array.isArray(data?.epg_listings) ? data.epg_listings : [];
          const validListings = rawListings.filter(
            (item: any) => item !== null && typeof item === 'object' && !Array.isArray(item)
          );
          setEpgData(validListings);
          setEpgError(null);
          setLoadingEpg(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error('EPG fetch error:', err);
          setEpgData([]);
          setEpgError('Não foi possível carregar a programação deste canal no momento.');
          setLoadingEpg(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [activeStreamId, credentials]);

  // Preserve focus inside EPG section if user focused the loading state before EPG resolved
  useEffect(() => {
    if (loadingEpg || !isEpgFocusedRef.current) return;
    const scrollEl = epgScrollRef.current;
    if (!scrollEl) return;
    const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
    if (!activeEl || activeEl === document.body || !scrollEl.contains(activeEl)) {
      const primaryEpgTarget = scrollEl.querySelector<HTMLElement>('[data-epg-primary="true"]');
      if (primaryEpgTarget) {
        focusElementSafely(primaryEpgTarget);
      }
    }
  }, [loadingEpg, epgData.length, epgError]);

  const ensureEpgItemVisible = useCallback((idx: number, itemEl: HTMLElement | null) => {
    const container = epgScrollRef.current;
    if (!container || !itemEl) return;

    if (idx === 0) {
      container.scrollTop = 0;
      return;
    }

    const padY = 10;
    const containerRect = container.getBoundingClientRect();
    const itemRect = itemEl.getBoundingClientRect();

    if (containerRect.height > 0 && itemRect.height > 0) {
      if (itemRect.bottom > containerRect.bottom - padY) {
        container.scrollTop += itemRect.bottom - (containerRect.bottom - padY);
      } else if (itemRect.top < containerRect.top + padY) {
        container.scrollTop = Math.max(
          0,
          container.scrollTop - (containerRect.top + padY - itemRect.top)
        );
      }
      return;
    }

    const containerHeight = container.clientHeight || 220;
    const itemHeight = itemEl.offsetHeight || 68;
    const itemTop = itemEl.offsetTop || idx * (itemHeight + 10);
    const itemBottom = itemTop + itemHeight;
    if (itemBottom > container.scrollTop + containerHeight - padY) {
      container.scrollTop = itemBottom - containerHeight + padY;
    } else if (itemTop < container.scrollTop + padY) {
      container.scrollTop = Math.max(0, itemTop - padY);
    }
  }, []);

  const handleRightPaneKeyDownCapture = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'ArrowLeft') return;
      const targetId = originChannelGroupIdRef.current || selectedGroup?.groupId || null;
      if (!targetId) return;
      const targetIdx =
        originChannelIndexRef.current >= 0
          ? originChannelIndexRef.current
          : groupedChannels.findIndex((g) => g.groupId === targetId);
      if (targetIdx >= 0) {
        ensureChannelIndexMounted(targetIdx);
      }
      syncOriginChannelDomAttribute(targetId);
    },
    [selectedGroup, groupedChannels, ensureChannelIndexMounted, syncOriginChannelDomAttribute]
  );

  // Helpers to decode Base64 and format EPG time
  const decodeBase64 = (val: unknown): string => {
    if (typeof val !== 'string') return '';
    try {
      return decodeURIComponent(escape(atob(val)));
    } catch {
      return val;
    }
  };

  const formatEpgTime = (val: unknown): string | null => {
    if (typeof val !== 'string') return null;
    const trimmed = val.trim();
    if (!trimmed) return null;
    const parts = trimmed.split(/\s+/);
    const timePart = parts.length > 1 ? parts[1] : parts[0];
    if (!timePart) return null;
    const timeSub = timePart.substring(0, 5);
    if (/^\d{1,2}:\d{2}$/.test(timeSub)) {
      return timeSub.padStart(5, '0');
    }
    return null;
  };

  const activeCategory = extendedCategories.find(c => c.category_id === selectedCategoryId);

  return (
    <div
      ref={viewRootRef}
      onPointerDownCapture={() => {
        lastPointerDownTimeRef.current = Date.now();
        pendingChannelEntryCategoryRef.current = null;
      }}
      className="flex flex-col md:flex-row flex-1 w-full h-auto md:h-full min-h-0 overflow-y-auto md:overflow-hidden bg-nc-bg"
    >
      {/* Left Pane: Categories or Channels */}
      <div
        data-nav-zone="categories"
        className={`nc-tv-category-pane w-full md:w-[35%] lg:w-[30%] flex-col border-r border-nc-border/50 bg-nc-bg-card/20 h-full shrink-0 flex ${isMobilePlayerOpen ? 'hidden md:flex' : 'flex'}`}
      >
        
        {/* Categories View */}
        {leftPaneView === 'categories' && (
          <div className="flex flex-col h-full overflow-hidden">
            <div className="p-4 border-b border-nc-border/50 bg-nc-bg shrink-0">
              <h2 className="text-sm font-semibold text-white uppercase tracking-wider">CATEGORIAS DE TV</h2>
            </div>
            <div
              ref={categoriesListRef}
              data-scroll-container="true"
              onScroll={(e) => {
                categoriesScrollTopRef.current = e.currentTarget.scrollTop;
              }}
              className="flex-1 overflow-y-auto px-2 py-2 space-y-1 custom-scrollbar"
            >
              {liveCategoriesError && liveCategories.length === 0 && (
                <div className="p-3 mb-2 bg-red-500/10 border border-red-500/30 rounded-xl flex flex-col items-center justify-center text-center gap-2">
                  <p className="text-xs text-red-400">{liveCategoriesError}</p>
                  <button
                    onClick={() => fetchLiveCategories()}
                    className="flex items-center gap-1.5 px-3 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg text-xs font-medium transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Tentar novamente
                  </button>
                </div>
              )}
              {liveCategoriesStatus === 'loading' && extendedCategories.length === 2 ? (
                 <div className="flex items-center justify-center py-10">
                   <Loader2 className="w-6 h-6 animate-spin text-nc-text-secondary" />
                 </div>
              ) : (
                extendedCategories.map((cat) => (
                  <button
                    key={cat.category_id}
                    type="button"
                    data-live-category-id={String(cat.category_id)}
                    data-category-selected={selectedCategoryId === cat.category_id ? 'true' : 'false'}
                    onClick={() => {
                      if (categoriesListRef.current) {
                        categoriesScrollTopRef.current = categoriesListRef.current.scrollTop;
                      }
                      const targetCatId = String(cat.category_id);
                      originCategoryIdRef.current = targetCatId;
                      if (shouldApplyProgrammaticFocus()) {
                        pendingChannelEntryCategoryRef.current = targetCatId;
                      } else {
                        pendingChannelEntryCategoryRef.current = null;
                      }
                      setSelectedCategoryId(cat.category_id);
                      setLeftPaneView('channels');
                    }}
                    className="nc-tv-category-btn w-full text-left px-4 py-2.5 rounded-xl text-sm transition-colors line-clamp-2 whitespace-normal break-words leading-snug text-nc-text-secondary hover:bg-nc-bg-input hover:text-white"
                  >
                    {formatCategoryLabel(cat.category_name, 'live')}
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* Channels View */}
        {leftPaneView === 'channels' && (
          <div className="flex flex-col h-full overflow-hidden">
            <div className="p-4 border-b border-nc-border/50 bg-nc-bg shrink-0 flex flex-col gap-2">
              {!searchQuery && (
                <button 
                  type="button"
                  data-live-back-to-categories="true"
                  onClick={handleReturnToCategories}
                  className="flex items-center gap-2 text-nc-text-secondary hover:text-white text-sm w-fit transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" /> Voltar às Categorias
                </button>
              )}
              <h2 className="text-lg font-semibold text-white truncate">
                {searchQuery ? `BUSCA: ${searchQuery.toUpperCase()}` : formatCategoryLabel(activeCategory?.category_name, 'live')}
              </h2>
            </div>
            
            <div ref={channelsScrollCallbackRef} data-scroll-container="true" className="flex-1 overflow-y-auto p-2 custom-scrollbar">
              {liveError && rawFilteredStreams.length === 0 ? (
                <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex flex-col items-center justify-center text-center gap-3 my-4">
                  <p className="text-sm text-red-400">{liveError}</p>
                  <button
                    onClick={() => fetchLiveStreams(selectedCategoryId)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg text-xs font-medium transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Tentar novamente
                  </button>
                </div>
              ) : (isCategoryChannelsLoading || liveCatalogStatus === 'loading') && rawFilteredStreams.length === 0 ? (
                 <div className="flex items-center justify-center py-10">
                   <Loader2 className="w-6 h-6 animate-spin text-nc-text-secondary" />
                 </div>
              ) : !isCategoryChannelsLoading && liveCatalogStatus === 'ready' && !liveError && groupedChannels.length === 0 ? (
                 <div className="flex flex-col items-center justify-center py-10 text-nc-text-secondary">
                   <TvMinimalPlay className="w-12 h-12 mb-4 opacity-20" />
                   <p className="text-sm">Nenhum canal encontrado.</p>
                 </div>
              ) : (
                <div ref={channelsListCallbackRef} data-virtual-container="true" className="space-y-2">
                  {channelTopSpacerPx > 0 && (
                    <div
                      aria-hidden="true"
                      data-virtual-spacer="top"
                      style={{ height: `${channelTopSpacerPx}px` }}
                    />
                  )}
                  {displayedGroups.map((group, idx) => {
                    const actualIndex = channelStartIndex + idx;
                    const isSelected = selectedGroup?.groupId === group.groupId;
                    const isOrigin = originChannelGroupIdRef.current
                      ? originChannelGroupIdRef.current === group.groupId
                      : isSelected;
                    const primaryStream = group.primaryStream;
                    const primaryId = primaryStream.stream_id || primaryStream.id;
                    const groupFav = group.allStreams.some((s) => isFavorite(s.stream_id || s.id, 'live'));

                    return (
                      <div
                        key={group.groupId}
                        data-nav-row="true"
                        data-scroll-block="true"
                        data-virtual-index={actualIndex}
                        className={`nc-tv-channel-row w-full flex items-center gap-1 rounded-xl transition-colors border ${
                          isSelected
                            ? 'bg-nc-primary/10 border-nc-primary/30'
                            : 'bg-transparent border-transparent hover:bg-nc-bg-input'
                        }`}
                      >
                        <button
                          type="button"
                          data-live-channel-btn="true"
                          data-live-channel-id={group.groupId}
                          data-live-channel-category-id={String(group.category_id ?? '')}
                          data-live-channel-selected={isSelected ? 'true' : 'false'}
                          data-live-channel-origin={isOrigin ? 'true' : 'false'}
                          onFocus={() => handleChannelRowFocus(group.groupId, actualIndex)}
                          onClick={(e) => {
                            if (shouldApplyProgrammaticFocus()) {
                              focusElementSafely(e.currentTarget);
                            }
                            handleSelectGroup(group);
                          }}
                          className="nc-tv-channel-btn w-full flex items-center gap-3 p-2 rounded-xl transition-colors flex-1 min-w-0 text-left"
                        >
                          <div className="nc-tv-channel-logo w-16 h-12 bg-black/40 rounded-lg shrink-0 flex items-center justify-center overflow-hidden relative">
                            <MediaImage
                              src={group.stream_icon}
                              serverUrl={credentials?.serverUrl}
                              alt={group.displayName}
                              itemId={primaryId}
                              itemName={group.displayName}
                              priority={actualIndex < 15}
                              loading={actualIndex < 15 ? 'eager' : 'lazy'}
                              className="w-full h-full object-contain p-1"
                            />
                          </div>

                          <div className="nc-tv-channel-info flex-1 min-w-0 text-left flex flex-col gap-0.5">
                            <p
                              data-live-channel-name="true"
                              className={`nc-tv-channel-name font-medium text-sm truncate ${isSelected ? 'text-nc-primary' : 'text-white'}`}
                            >
                              {group.displayName}
                            </p>
                            {group.isGrouped && (
                              <div className="nc-tv-channel-meta flex items-center gap-1.5 text-[10px] text-nc-text-secondary overflow-hidden">
                                <span className="inline-flex items-center gap-0.5 font-semibold text-nc-primary/90 bg-nc-primary/10 px-1.5 py-0.5 rounded border border-nc-primary/20 shrink-0">
                                  <Layers className="w-2.5 h-2.5" />
                                  {group.variants.length} versões
                                </span>
                                <span className="truncate opacity-75">
                                  {group.variants.map((v) => v.label).join(' · ')}
                                </span>
                              </div>
                            )}
                          </div>
                        </button>

                        <button
                          type="button"
                          data-live-channel-fav="true"
                          data-live-channel-id={group.groupId}
                          aria-label={groupFav ? 'Remover canal dos favoritos' : 'Favoritar canal'}
                          title={groupFav ? 'Remover dos favoritos' : 'Favoritar canal'}
                          onFocus={() => handleChannelRowFocus(group.groupId, actualIndex)}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (group.isGrouped) {
                              handleToggleGroupFavorite(group);
                            } else {
                              handleToggleFavorite({ id: primaryId, name: group.displayName, cover: group.stream_icon || '', type: 'live' });
                            }
                          }}
                          className="nc-tv-channel-fav p-2.5 mr-1 rounded-xl shrink-0 text-nc-text-secondary hover:text-white transition-colors"
                        >
                          <Heart className={`w-4 h-4 ${groupFav ? 'fill-nc-primary text-nc-primary' : ''}`} />
                        </button>
                      </div>
                    );
                  })}
                  {channelBottomSpacerPx > 0 && (
                    <div
                      aria-hidden="true"
                      data-virtual-spacer="bottom"
                      style={{ height: `${channelBottomSpacerPx}px` }}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Right Pane: Player & EPG */}
      <div
        data-nav-zone="content"
        onKeyDownCapture={handleRightPaneKeyDownCapture}
        className={`nc-live-right-pane flex-1 min-w-0 flex-col w-full h-auto md:h-full min-h-0 overflow-y-auto md:overflow-hidden bg-nc-bg flex touch-pan-y ${!isMobilePlayerOpen ? 'hidden md:flex' : 'flex'}`}
      >
        {selectedGroup ? (
          <div
            data-live-content-stack="true"
            className="nc-live-content-stack flex flex-col w-full h-auto md:h-full md:min-h-0 overflow-visible md:overflow-hidden"
          >
            {/* Mobile Back Button */}
            <div className="md:hidden px-3 py-2.5 shrink-0 border-b border-nc-border/50 flex items-center bg-nc-bg">
              <button
                type="button"
                onClick={handleCloseChannel}
                className="flex items-center gap-2 text-nc-text-secondary hover:text-white transition-colors text-sm font-medium"
              >
                <ArrowLeft className="w-5 h-5" /> Voltar aos Canais
              </button>
            </div>

            {/* Top Section (Compact Summary + 16:9 Mini-Player side by side on md+) */}
            <div
              data-live-top-section="true"
              className="nc-live-top-section flex flex-col md:flex-row items-stretch md:items-start gap-2.5 lg:gap-4 px-3 py-2.5 lg:p-3.5 shrink-0 border-b border-nc-border/15 bg-nc-bg"
            >
              {/* Left child: Channel Info, Version Selector & Current Program Summary */}
              <div
                data-live-summary-col="true"
                className="nc-live-summary-col flex-1 min-w-0 flex flex-col items-start gap-2 order-2 md:order-1"
              >
                <div className="flex items-center gap-2.5 lg:gap-3 w-full min-w-0">
                  <div className="nc-live-channel-logo w-11 h-11 lg:w-14 lg:h-14 bg-nc-bg-card rounded-xl flex items-center justify-center overflow-hidden shrink-0 border border-nc-border/50 p-1.5 shadow-md">
                    <MediaImage
                      src={selectedGroup.stream_icon}
                      serverUrl={credentials?.serverUrl}
                      alt={selectedGroup.displayName}
                      itemId={selectedGroup.primaryStream?.stream_id || selectedGroup.primaryStream?.id}
                      itemName={selectedGroup.displayName}
                      priority={true}
                      loading="eager"
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div className="overflow-hidden min-w-0 flex-1">
                    <h1 className="nc-live-channel-title text-base md:text-lg lg:text-xl font-bold text-white truncate block w-full">
                      {selectedGroup.displayName}
                    </h1>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-red-500/10 text-red-400 text-[11px] font-medium border border-red-500/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
                        AO VIVO
                      </span>
                      {activeVariantStream?.name && parseChannelVariantSuffix(activeVariantStream.name).resolution && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-nc-primary/20 text-nc-primary border border-nc-primary/30 text-[11px] font-bold">
                          {parseChannelVariantSuffix(activeVariantStream.name).resolution}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Version Selector for Grouped Channels */}
                {selectedGroup.isGrouped && selectedGroup.variants.length > 0 && (
                  <div className="nc-live-variants-bar w-full px-2.5 py-1.5 bg-nc-bg-card/70 border border-nc-border/50 rounded-xl flex flex-row items-center justify-between gap-2 shadow-sm">
                    <span className="text-[11px] font-semibold text-white/90 shrink-0">Versão do canal:</span>
                    <div
                      data-nav-row="live-variants"
                      className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar w-auto max-w-full"
                    >
                      <button
                        type="button"
                        data-variant-active={selectedResolutionMode === 'auto' ? 'true' : 'false'}
                        onClick={() => handleSelectResolutionMode('auto')}
                        className={`px-2.5 py-0.5 rounded-lg text-[11px] font-medium transition-colors shrink-0 ${
                          selectedResolutionMode === 'auto'
                            ? 'bg-nc-primary text-black font-bold shadow-md'
                            : 'bg-nc-bg-input hover:bg-nc-border/60 text-nc-text-secondary hover:text-white'
                        }`}
                      >
                        Automático
                      </button>
                      {selectedGroup.variants.map((v) => {
                        const activeId = activeVariantStream?.stream_id || activeVariantStream?.id;
                        const isCurrentActive = String(activeId) === String(v.streamId);
                        return (
                          <button
                            type="button"
                            key={v.streamId}
                            data-variant-active={
                              isCurrentActive && selectedResolutionMode !== 'auto' ? 'true' : 'false'
                            }
                            onClick={() => handleSelectResolutionMode(v.stream)}
                            className={`px-2 py-0.5 rounded-lg text-[11px] font-medium transition-colors shrink-0 flex items-center gap-1 ${
                              isCurrentActive
                                ? 'bg-nc-primary/20 text-nc-primary border border-nc-primary/50 font-bold'
                                : 'bg-nc-bg-input hover:bg-nc-border/60 text-nc-text-secondary hover:text-white'
                            }`}
                          >
                            <span>{v.label}</span>
                            {isCurrentActive && (
                              <span className="w-1.5 h-1.5 rounded-full bg-nc-primary animate-pulse" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Current Program Info */}
                {epgData && epgData.length > 0 && epgData[0] && (
                  <div
                    data-live-now-playing="true"
                    className="nc-live-now-playing w-full px-3 py-2 bg-nc-bg-card/50 rounded-xl border border-nc-border/50 flex flex-col gap-0.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] text-nc-primary font-semibold uppercase tracking-wider">
                        Passando Agora
                      </p>
                      {(() => {
                        const startStr = formatEpgTime(epgData[0].start);
                        const endStr = formatEpgTime(epgData[0].end);
                        if (startStr && endStr) {
                          return (
                            <p className="text-[11px] text-nc-text-secondary font-mono shrink-0">
                              {startStr} - {endStr}
                            </p>
                          );
                        }
                        return null;
                      })()}
                    </div>
                    {decodeBase64(epgData[0].title) && (
                      <p className="text-xs sm:text-sm text-white font-medium truncate">
                        {decodeBase64(epgData[0].title)}
                      </p>
                    )}
                    {decodeBase64(epgData[0].description) && (
                      <p className="nc-live-now-playing-desc text-xs text-nc-text-secondary line-clamp-1 lg:line-clamp-2">
                        {decodeBase64(epgData[0].description)}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Right child: Mini-Player (preserves 16:9 aspect-video) */}
              <div
                data-live-preview-wrapper="true"
                className="nc-live-preview-box w-full md:w-[40%] lg:w-[42%] md:max-w-[15.5rem] lg:max-w-[20rem] xl:max-w-md shrink-0 order-1 md:order-2 shadow-2xl"
              >
                <VideoPlayer
                  key={selectedGroup.groupId}
                  streamUrl={miniPlayerUrl}
                  title={selectedGroup.displayName}
                  channelName={selectedGroup.displayName}
                  programTitle={
                    epgData && epgData.length > 0 && epgData[0]
                      ? decodeBase64(epgData[0].title) || undefined
                      : undefined
                  }
                  contentType="live"
                  streamId={
                    activeVariantStream?.stream_id || activeVariantStream?.id || selectedGroup.groupId
                  }
                  attemptTrigger={attemptTrigger}
                  fullscreenRequestTrigger={fullscreenRequestTrigger}
                  onBack={handleCloseChannel}
                  embedded={true}
                  disableEmbeddedControlsFocus={true}
                  isLoading={miniPlayerLoading}
                  errorMessage={miniPlayerError}
                  onRetry={handleRetry}
                  onPlaybackSuccess={handlePlaybackSuccess}
                  onPlaybackFinalError={handlePlaybackFinalError}
                />
              </div>
            </div>

            {/* EPG Section (Pinned Header + Single Scrollable EPG Container) */}
            <div
              data-live-epg-section="true"
              className="nc-live-epg-section flex-1 flex flex-col w-full h-auto md:h-full min-h-[12rem] md:min-h-0 overflow-visible md:overflow-hidden bg-nc-bg"
            >
              <div
                data-live-epg-header="true"
                className="nc-live-epg-header px-3.5 py-2 lg:px-4 lg:py-2.5 shrink-0 border-b border-nc-border/40 bg-nc-bg flex items-center justify-between gap-2"
              >
                <h3 className="text-sm sm:text-base font-semibold text-white flex items-center gap-2">
                  <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-nc-primary shrink-0" /> Programação
                </h3>
                {!loadingEpg && !epgError && epgData.length > 0 && (
                  <span className="text-[11px] text-nc-text-secondary font-mono">
                    {epgData.length} {epgData.length === 1 ? 'programa' : 'programas'}
                  </span>
                )}
              </div>

              <div
                ref={epgScrollRef}
                data-epg-scroll="true"
                data-scroll-container="true"
                onFocusCapture={() => {
                  isEpgFocusedRef.current = true;
                }}
                onBlurCapture={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    isEpgFocusedRef.current = false;
                  }
                }}
                className="nc-live-epg-scroll flex-1 w-full h-auto md:h-full min-h-[10rem] md:min-h-0 overflow-visible md:overflow-y-auto px-3.5 py-2.5 lg:p-4 custom-scrollbar bg-nc-bg touch-pan-y"
              >
                {loadingEpg ? (
                  <div
                    tabIndex={0}
                    role="status"
                    aria-label="Carregando grade de programação"
                    data-nav-item="true"
                    data-epg-state="loading"
                    data-epg-primary="true"
                    className="nc-tv-epg-state flex flex-col items-center justify-center py-8 px-4 bg-nc-bg-card/20 rounded-xl border border-nc-border/40 text-center outline-none cursor-default"
                  >
                    <Loader2 className="w-7 h-7 animate-spin text-nc-primary mb-2" />
                    <p className="text-xs sm:text-sm text-nc-text-secondary">
                      Carregando programação...
                    </p>
                  </div>
                ) : epgError ? (
                  <div
                    tabIndex={0}
                    role="status"
                    aria-label="Programação indisponível"
                    data-nav-item="true"
                    data-epg-state="error"
                    data-epg-primary="true"
                    className="nc-tv-epg-state text-center py-8 px-4 bg-red-500/10 rounded-xl border border-red-500/30 outline-none cursor-default"
                  >
                    <p className="text-xs sm:text-sm text-red-300">{epgError}</p>
                  </div>
                ) : epgData && epgData.length > 0 ? (
                  <div
                    data-epg-timeline="true"
                    className="nc-tv-epg-timeline space-y-2.5 relative before:absolute before:inset-0 before:ml-[1.25rem] before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-nc-border/50 before:to-transparent pb-4"
                  >
                    {epgData.map((prog: any, idx: number) => {
                      const startStr = formatEpgTime(prog?.start);
                      const endStr = formatEpgTime(prog?.end);
                      const title = decodeBase64(prog?.title);
                      const description = decodeBase64(prog?.description);
                      const isFirst = idx === 0;

                      return (
                        <div
                          key={prog?.id ?? `${idx}_${startStr ?? ''}_${title ?? ''}`}
                          className="nc-tv-epg-row relative flex items-start justify-start group is-active"
                        >
                          {/* Timeline Marker */}
                          <div
                            className={`nc-tv-epg-marker flex items-center justify-center w-6 h-6 rounded-full border-2 bg-nc-bg shrink-0 shadow absolute left-[1.25rem] -translate-x-1/2 top-3.5 transition-colors ${
                              isFirst
                                ? 'border-nc-primary text-nc-primary'
                                : 'border-nc-border/50 text-nc-text-secondary'
                            }`}
                          >
                            <div
                              className={`w-2 h-2 rounded-full ${
                                isFirst ? 'bg-nc-primary' : 'bg-transparent'
                              }`}
                            />
                          </div>

                          {/* Focusable Non-Button EPG Card */}
                          <div
                            role="article"
                            tabIndex={0}
                            data-nav-item="true"
                            data-epg-item="true"
                            data-epg-index={idx}
                            data-epg-primary={isFirst ? 'true' : undefined}
                            data-scroll-block="true"
                            onFocus={(e) => ensureEpgItemVisible(idx, e.currentTarget)}
                            className={`nc-tv-epg-card w-[calc(100%-2.5rem)] ml-[2.5rem] px-3.5 py-2.5 rounded-xl border transition-all cursor-default outline-none ${
                              isFirst
                                ? 'border-nc-primary/40 bg-nc-primary/[0.07]'
                                : 'border-nc-border/50 bg-nc-bg-card hover:bg-nc-bg-input'
                            }`}
                          >
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                {startStr && endStr && (
                                  <div
                                    data-epg-time="true"
                                    className={`text-xs font-semibold uppercase tracking-wider font-mono ${
                                      isFirst ? 'text-nc-primary' : 'text-nc-text-secondary'
                                    }`}
                                  >
                                    {startStr} - {endStr}
                                  </div>
                                )}
                                {isFirst && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-nc-primary/20 text-nc-primary text-[10px] font-bold uppercase tracking-wider">
                                    Agora
                                  </span>
                                )}
                              </div>
                              {title && (
                                <h4
                                  data-epg-title="true"
                                  className={`font-medium text-sm sm:text-base leading-snug ${
                                    isFirst ? 'text-white font-semibold' : 'text-white/85'
                                  }`}
                                >
                                  {title}
                                </h4>
                              )}
                              {description && (
                                <p
                                  data-epg-description="true"
                                  className="text-xs sm:text-sm text-nc-text-secondary line-clamp-2 mt-0.5 leading-snug"
                                >
                                  {description}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div
                    tabIndex={0}
                    role="status"
                    aria-label="Nenhuma programação disponível (EPG Vazio)"
                    data-nav-item="true"
                    data-epg-state="empty"
                    data-epg-primary="true"
                    className="nc-tv-epg-state text-center py-8 px-4 bg-nc-bg-card/30 rounded-xl border border-nc-border/50 outline-none cursor-default"
                  >
                    <p className="text-xs sm:text-sm text-nc-text-secondary">
                      Nenhuma programação disponível (EPG Vazio).
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-col h-full flex items-center justify-center p-6 text-center text-nc-text-secondary bg-nc-bg">
            <div className="w-24 h-24 rounded-full bg-nc-bg-card flex items-center justify-center mb-6 shadow-xl">
              <TvMinimalPlay className="w-12 h-12 text-nc-text-secondary/50" />
            </div>
            <h2 className="text-xl md:text-2xl font-bold text-white mb-2">Selecione um Canal</h2>
            <p className="max-w-md">
              Escolha um canal na lista à esquerda para assistir e visualizar sua grade de programação ao vivo.
            </p>
          </div>
        )}
      </div>

      {(favActionError || favoriteError) && (
        <div
          role="alert"
          className="fixed bottom-6 right-6 left-6 sm:left-auto sm:max-w-md z-[110] bg-red-600/90 text-white text-sm px-4 py-3 rounded-xl shadow-2xl border border-red-500/50 backdrop-blur-md flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-2"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-5 h-5 text-white shrink-0" />
            <span className="truncate sm:whitespace-normal">
              {favActionError || favoriteError}
            </span>
          </div>
          <button
            onClick={() => {
              setFavActionError(null);
              clearFavoriteError();
            }}
            className="p-1 hover:bg-white/20 rounded-lg text-white/80 hover:text-white shrink-0 transition-colors"
            aria-label="Fechar aviso"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
});
