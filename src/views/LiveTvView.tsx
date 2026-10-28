import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { TvMinimalPlay, Loader2, Play, Heart, ArrowLeft, Calendar, AlertCircle, RefreshCw, X, Layers } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useXtreamContext } from '../context/XtreamContext';
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
import {
  useBackHandler,
  BACK_PRIORITY,
  getNavMode,
  focusElementSafely,
} from '../navigation';

export const AUTO_RESOLUTION_PRIORITY: ResolutionQuality[] = ['SD', 'HD', 'FHD', '4K'];

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

export function LiveTvView({
  onPlay,
  searchQuery = '',
  initialChannelIntent = null,
  onConsumeChannelIntent,
}: LiveTvViewProps) {
  const { 
    liveCategories, liveStreams, allLiveStreams, fetchLiveStreams, 
    loadingLive, liveError, liveCategoriesError, liveCategoriesStatus,
    liveCatalogStatus, fetchLiveCategories, credentials 
  } = useXtreamContext();
  
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
  
  const [displayCount, setDisplayCount] = useState(100);
  
  // States for EPG
  const [epgData, setEpgData] = useState<any[]>([]);
  const [loadingEpg, setLoadingEpg] = useState(false);

  const { favorites, isFavorite, toggleFavorite, toggleGroupFavorites, favoriteError, clearFavoriteError } = useFavorites();
  const [favActionError, setFavActionError] = useState<string | null>(null);

  const historyRecords = useAccountPlaybackHistory(credentials);

  // References for playback attempt tracking and session fallback
  const sessionSuccessfulVariantsRef = useRef<Map<string, string | number>>(new Map());
  const attemptedStreamIdsRef = useRef<Set<string | number>>(new Set());
  const attemptIdRef = useRef<number>(0);
  const fallbackTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // References for D-pad focus and scroll preservation between categories, channels, and preview
  const viewRootRef = useRef<HTMLDivElement>(null);
  const categoriesListRef = useRef<HTMLDivElement>(null);
  const categoriesScrollTopRef = useRef<number>(0);
  const originCategoryIdRef = useRef<string>('nc_recent');
  const lastPointerDownTimeRef = useRef<number>(0);
  const pendingChannelEntryCategoryRef = useRef<string | null>(null);
  const pendingCategoryRestoreFocusRef = useRef<string | null>(null);
  const pendingChannelRestoreFocusRef = useRef<string | null>(null);
  const consumedIntentRequestIdRef = useRef<number | null>(null);

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
      .map((f) => allLiveStreams.find((s) => String(s.stream_id || s.id) === String(f.id)))
      .filter(Boolean);
  }, [favorites, allLiveStreams]);

  const recentChannels = useMemo(() => {
    if (!allLiveStreams || allLiveStreams.length === 0) return [];
    const liveRecords = historyRecords.filter((r) => r.type === 'live');

    const result: any[] = [];
    const seenIds = new Set<string | number>();

    for (const record of liveRecords) {
      const item = allLiveStreams.find(
        (c: any) => String(c.stream_id || c.id) === String(record.id)
      );
      if (item) {
        const itemId = item.stream_id || item.id;
        if (!seenIds.has(itemId)) {
          seenIds.add(itemId);
          result.push(item);
        }
      }
    }

    return result;
  }, [historyRecords, allLiveStreams]);

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
    setDisplayCount(100);
    return () => {
      isCurrent = false;
    };
  }, [selectedCategoryId, fetchLiveStreams]);

  // Handle Search query override
  useEffect(() => {
    if (searchQuery) {
      setLeftPaneView('channels');
      setDisplayCount(100);
    }
  }, [searchQuery]);

  // Strictly filter streams by selectedCategoryId for real categories so stale liveStreams from a previous category are never rendered or focused
  const rawFilteredStreams = useMemo(() => {
    if (!selectedCategoryId) return [];
    if (selectedCategoryId === 'nc_recent') return recentChannels;
    if (selectedCategoryId === 'nc_fav') return favoriteChannels;

    const targetCatId = String(selectedCategoryId);
    const matchingFromLive = liveStreams.filter(
      (s) => s && String(s.category_id) === targetCatId
    );
    if (matchingFromLive.length > 0) {
      return matchingFromLive;
    }
    if (allLiveStreams.length > 0) {
      return allLiveStreams.filter(
        (s) => s && String(s.category_id) === targetCatId
      );
    }
    return [];
  }, [selectedCategoryId, recentChannels, favoriteChannels, liveStreams, allLiveStreams]);

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

  // Groups streams. When searchQuery is active, groups ALL account streams globally.
  const groupedChannels = useMemo(() => {
    if (searchQuery && searchQuery.trim().length > 0) {
      const allGroups = groupLiveStreams(allLiveStreams);
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

    return groupLiveStreams(rawFilteredStreams);
  }, [rawFilteredStreams, allLiveStreams, selectedCategoryId, searchQuery]);

  const displayedGroups = groupedChannels.slice(0, displayCount);

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

      if (attemptIdRef.current === currentAttemptId) {
        setMiniPlayerUrl(url);

        // 28-second fallback timeout if playback doesn't start
        fallbackTimeoutRef.current = setTimeout(() => {
          if (attemptIdRef.current !== currentAttemptId) return;
          attemptedStreamIdsRef.current.add(streamId);
          const nextStream = pickVariantForGroup(group, targetMode, attemptedStreamIdsRef.current);
          if (nextStream) {
            startVariantAttempt(group, targetMode, nextStream);
          } else {
            setMiniPlayerError('Não foi possível carregar nenhuma versão do canal (Tempo limite esgotado).');
            setMiniPlayerLoading(false);
          }
        }, 28000);
      }
    } catch (err: any) {
      if (attemptIdRef.current === currentAttemptId) {
        attemptedStreamIdsRef.current.add(streamId);
        setMiniPlayerUrl('');
        setMiniPlayerError(err.message || 'Falha ao conectar à transmissão do canal.');
        setMiniPlayerLoading(false);
      }
    }
  }, [credentials, pickVariantForGroup]);

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
  }, [searchQuery, selectedCategoryId, selectedGroup, miniPlayerError, miniPlayerUrl, startVariantAttempt]);

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
    if (attemptId === undefined || attemptId !== attemptIdRef.current) {
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
    if (attemptId === undefined || attemptId !== attemptIdRef.current) {
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
      ? sourcePool.find((s) => s && String(s.stream_id ?? s.id) === targetIdStr)
      : null;

    if (matchedStream) {
      const catId = matchedStream.category_id ? String(matchedStream.category_id) : 'nc_recent';
      originCategoryIdRef.current = catId;
      setSelectedCategoryId(catId);
      setLeftPaneView('channels');

      const catStreams =
        catId !== 'nc_recent' && catId !== 'nc_fav'
          ? sourcePool.filter((s) => s && String(s.category_id) === catId)
          : [matchedStream];
      const groupsInCat = groupLiveStreams(catStreams.length > 0 ? catStreams : [matchedStream]);
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
    displayedGroups,
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

  // Fetch EPG when active variant stream is selected
  useEffect(() => {
    let isMounted = true;
    if (activeVariantStream && credentials) {
      setLoadingEpg(true);
      setEpgData([]);
      const sId = activeVariantStream.stream_id || activeVariantStream.id;
      XtreamService.getShortEpg(credentials, sId, 10)
        .then(data => {
          if (isMounted) {
            const rawListings = Array.isArray(data?.epg_listings) ? data.epg_listings : [];
            const validListings = rawListings.filter(
              (item: any) => item !== null && typeof item === 'object' && !Array.isArray(item)
            );
            setEpgData(validListings);
            setLoadingEpg(false);
          }
        })
        .catch(err => {
          if (isMounted) {
            console.error("EPG fetch error:", err);
            setLoadingEpg(false);
          }
        });
    }
    return () => { isMounted = false; };
  }, [activeVariantStream, credentials]);

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
      className="flex flex-col md:flex-row flex-1 w-full h-auto md:h-[calc(100vh-80px)] overflow-y-auto md:overflow-hidden bg-nc-bg"
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
            
            <div data-scroll-container="true" className="flex-1 overflow-y-auto p-2 custom-scrollbar">
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
                <div className="space-y-2">
                  {displayedGroups.map((group, idx) => {
                    const isSelected = selectedGroup?.groupId === group.groupId;
                    const primaryStream = group.primaryStream;
                    const primaryId = primaryStream.stream_id || primaryStream.id;
                    const groupFav = group.allStreams.some((s) => isFavorite(s.stream_id || s.id, 'live'));

                    return (
                      <div
                        key={group.groupId}
                        data-nav-row="true"
                        data-scroll-block="true"
                        className={`w-full flex items-center gap-1 rounded-xl transition-colors border ${
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
                          onClick={(e) => {
                            if (shouldApplyProgrammaticFocus()) {
                              focusElementSafely(e.currentTarget);
                            }
                            handleSelectGroup(group);
                          }}
                          className="w-full flex items-center gap-3 p-2 rounded-xl transition-colors flex-1 min-w-0 text-left"
                        >
                          <div className="w-16 h-12 bg-black/40 rounded-lg shrink-0 flex items-center justify-center overflow-hidden relative">
                            <MediaImage
                              src={group.stream_icon}
                              serverUrl={credentials?.serverUrl}
                              alt={group.displayName}
                              itemId={primaryId}
                              itemName={group.displayName}
                              priority={idx < 15}
                              loading={idx < 15 ? 'eager' : 'lazy'}
                              className="w-full h-full object-contain p-1"
                            />
                          </div>

                          <div className="flex-1 min-w-0 text-left flex flex-col gap-0.5">
                            <p className={`font-medium text-sm truncate ${isSelected ? 'text-nc-primary' : 'text-white'}`}>
                              {group.displayName}
                            </p>
                            {group.isGrouped && (
                              <div className="flex items-center gap-1.5 text-[10px] text-nc-text-secondary overflow-hidden">
                                <span className="inline-flex items-center gap-0.5 font-semibold text-nc-primary/90 bg-nc-primary/10 px-1.5 py-0.5 rounded border border-nc-primary/20">
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
                          aria-label={groupFav ? 'Remover canal dos favoritos' : 'Favoritar canal'}
                          title={groupFav ? 'Remover dos favoritos' : 'Favoritar canal'}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (group.isGrouped) {
                              handleToggleGroupFavorite(group);
                            } else {
                              handleToggleFavorite({ id: primaryId, name: group.displayName, cover: group.stream_icon || '', type: 'live' });
                            }
                          }}
                          className="p-2.5 mr-1 rounded-xl shrink-0 text-nc-text-secondary hover:text-white transition-colors"
                        >
                          <Heart className={`w-4 h-4 ${groupFav ? 'fill-nc-primary text-nc-primary' : ''}`} />
                        </button>
                      </div>
                    );
                  })}
                  
                  {displayCount < groupedChannels.length && (
                    <button
                      onClick={() => setDisplayCount(prev => prev + 100)}
                      className="w-full py-3 mt-4 text-sm bg-nc-bg-input hover:bg-nc-bg-card rounded-xl text-nc-text-secondary transition-colors font-medium"
                    >
                      Carregar Mais
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Right Pane: Player & EPG */}
      <div data-nav-zone="content" className={`flex-1 min-w-0 flex-col w-full h-auto md:h-full overflow-visible md:overflow-y-auto bg-nc-bg flex ${!isMobilePlayerOpen ? 'hidden md:flex' : 'flex'}`}>
        {selectedGroup ? (
          <div className="flex flex-col w-full h-auto md:h-full overflow-visible md:overflow-y-auto">
             {/* Mobile Back Button */}
             <div className="md:hidden p-4 shrink-0 border-b border-nc-border/50 flex items-center bg-nc-bg">
               <button 
                 onClick={handleCloseChannel}
                 className="flex items-center gap-2 text-nc-text-secondary hover:text-white transition-colors text-sm font-medium"
               >
                 <ArrowLeft className="w-5 h-5" /> Voltar aos Canais
               </button>
             </div>

             {/* Top Section (Header + Mini-Player) */}
             <div className="flex flex-col lg:flex-row gap-4 p-4 shrink-0 border-b border-nc-border/10 bg-nc-bg">
               {/* Left child: Channel Info & Version Selector */}
               <div className="flex-1 min-w-0 flex flex-col items-start gap-3 order-2 lg:order-1">
                 <div className="flex items-center gap-4 w-full">
                    <div className="w-20 h-20 bg-nc-bg-card rounded-2xl flex items-center justify-center overflow-hidden shrink-0 border border-nc-border/50 p-2 shadow-lg">
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
                      <h1 className="text-xl md:text-2xl font-bold text-white truncate block w-full">{selectedGroup.displayName}</h1>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-500/10 text-red-400 text-xs font-medium border border-red-500/20">
                          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                          AO VIVO
                        </span>
                        {activeVariantStream?.name && parseChannelVariantSuffix(activeVariantStream.name).resolution && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-nc-primary/20 text-nc-primary border border-nc-primary/30 text-xs font-bold">
                            {parseChannelVariantSuffix(activeVariantStream.name).resolution}
                          </span>
                        )}
                      </div>
                    </div>
                 </div>

                 {/* Version Selector for Grouped Channels */}
                 {selectedGroup.isGrouped && selectedGroup.variants.length > 0 && (
                   <div className="w-full p-3 bg-nc-bg-card/70 border border-nc-border/50 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 shadow-sm">
                     <span className="text-xs font-semibold text-white/90 shrink-0">Versão do canal:</span>
                     <div data-nav-row="true" className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar w-full sm:w-auto">
                       <button
                         type="button"
                         onClick={() => handleSelectResolutionMode('auto')}
                         className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors shrink-0 ${
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
                             onClick={() => handleSelectResolutionMode(v.stream)}
                             className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors shrink-0 flex items-center gap-1.5 ${
                               isCurrentActive
                                 ? 'bg-nc-primary/20 text-nc-primary border border-nc-primary/50 font-bold'
                                 : 'bg-nc-bg-input hover:bg-nc-border/60 text-nc-text-secondary hover:text-white'
                             }`}
                           >
                             <span>{v.label}</span>
                             {isCurrentActive && <span className="w-1.5 h-1.5 rounded-full bg-nc-primary animate-pulse" />}
                           </button>
                         );
                       })}
                     </div>
                   </div>
                 )}
                 
                 {/* Current Program Info */}
                 {epgData && epgData.length > 0 && epgData[0] && (
                   <div className="w-full p-4 bg-nc-bg-card/50 rounded-xl border border-nc-border/50 flex flex-col gap-1">
                      <p className="text-xs text-nc-primary font-semibold uppercase tracking-wider">Passando Agora</p>
                      {decodeBase64(epgData[0].title) && (
                        <p className="text-white font-medium">{decodeBase64(epgData[0].title)}</p>
                      )}
                      {decodeBase64(epgData[0].description) && (
                        <p className="text-sm text-nc-text-secondary line-clamp-2">
                          {decodeBase64(epgData[0].description)}
                        </p>
                      )}
                      {(() => {
                        const startStr = formatEpgTime(epgData[0].start);
                        const endStr = formatEpgTime(epgData[0].end);
                        if (startStr && endStr) {
                          return (
                            <p className="text-xs text-nc-text-secondary mt-1 font-mono">
                              {startStr} - {endStr}
                            </p>
                          );
                        }
                        return null;
                      })()}
                   </div>
                 )}
               </div>

               {/* Right child: Mini-Player */}
               <div className="w-full lg:w-[45%] lg:max-w-md md:max-h-[50vh] lg:max-h-[60vh] xl:max-h-none shrink-0 order-1 lg:order-2 shadow-2xl">
                 <VideoPlayer
                   key={selectedGroup.groupId}
                   streamUrl={miniPlayerUrl}
                   title={selectedGroup.displayName}
                   channelName={selectedGroup.displayName}
                   programTitle={epgData && epgData.length > 0 && epgData[0] ? (decodeBase64(epgData[0].title) || undefined) : undefined}
                   contentType="live"
                   streamId={activeVariantStream?.stream_id || activeVariantStream?.id || selectedGroup.groupId}
                   attemptTrigger={attemptTrigger}
                   fullscreenRequestTrigger={fullscreenRequestTrigger}
                   onBack={handleCloseChannel}
                   embedded={true}
                   isLoading={miniPlayerLoading}
                   errorMessage={miniPlayerError}
                   onRetry={handleRetry}
                   onPlaybackSuccess={handlePlaybackSuccess}
                   onPlaybackFinalError={handlePlaybackFinalError}
                 />
               </div>
             </div>

             {/* EPG List */}
             <div className="flex-1 w-full h-auto md:h-full min-h-[300px] overflow-visible md:overflow-y-auto p-4 custom-scrollbar bg-nc-bg">
               <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2 border-b border-nc-border/50 pb-2">
                 <Calendar className="w-5 h-5 text-nc-primary" /> Programação
               </h3>
               
               {loadingEpg ? (
                 <div className="flex items-center justify-center py-10">
                   <Loader2 className="w-8 h-8 animate-spin text-nc-primary" />
                 </div>
               ) : epgData && epgData.length > 0 ? (
                 <div className="nc-tv-epg-timeline space-y-3 relative before:absolute before:inset-0 before:ml-[3.5rem] before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-nc-border/50 before:to-transparent pb-8">
                   {epgData.map((prog: any, idx: number) => {
                     const startStr = formatEpgTime(prog?.start);
                     const endStr = formatEpgTime(prog?.end);
                     const title = decodeBase64(prog?.title);
                     const description = decodeBase64(prog?.description);

                     return (
                       <div key={idx} className="nc-tv-epg-row relative flex items-start justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                         {/* Timeline Marker */}
                         <div className={`nc-tv-epg-marker flex items-center justify-center w-8 h-8 rounded-full border-2 bg-nc-bg shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow absolute left-[3.5rem] md:left-1/2 -translate-x-1/2 top-4 md:top-1/2 md:-translate-y-1/2 transition-colors ${idx === 0 ? 'border-nc-primary text-nc-primary' : 'border-nc-border/50 text-nc-text-secondary'}`}>
                            <div className={`w-2.5 h-2.5 rounded-full ${idx === 0 ? 'bg-nc-primary' : 'bg-transparent'}`}></div>
                         </div>
                         
                         {/* EPG Card */}
                         <div className="nc-tv-epg-card w-[calc(100%-4.5rem)] md:w-[calc(50%-2.5rem)] ml-[4.5rem] md:ml-0 p-4 rounded-xl border border-nc-border/50 bg-nc-bg-card hover:bg-nc-bg-input transition-colors">
                           <div className="flex flex-col gap-1">
                             {startStr && endStr && (
                               <div className={`text-xs font-semibold uppercase tracking-wider ${idx === 0 ? 'text-nc-primary' : 'text-nc-text-secondary'}`}>
                                 {startStr} - {endStr}
                               </div>
                             )}
                             {title && (
                               <h4 className={`font-medium text-base ${idx === 0 ? 'text-white' : 'text-white/80'}`}>
                                 {title}
                               </h4>
                             )}
                             {description && (
                               <p className="text-sm text-nc-text-secondary line-clamp-2 mt-1">
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
                 <div className="text-center py-10 bg-nc-bg-card/30 rounded-xl border border-nc-border/50">
                   <p className="text-nc-text-secondary">Nenhuma programação disponível (EPG Vazio).</p>
                 </div>
               )}
             </div>
          </div>
        ) : (
          <div className="flex-col h-full flex items-center justify-center p-6 text-center text-nc-text-secondary bg-nc-bg">
             <div className="w-24 h-24 rounded-full bg-nc-bg-card flex items-center justify-center mb-6 shadow-xl">
               <TvMinimalPlay className="w-12 h-12 text-nc-text-secondary/50" />
             </div>
             <h2 className="text-xl md:text-2xl font-bold text-white mb-2">Selecione um Canal</h2>
             <p className="max-w-md">Escolha um canal na lista à esquerda para assistir e visualizar sua grade de programação ao vivo.</p>
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
}
