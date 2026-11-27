import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Play,
  X,
  Loader2,
  Heart,
  AlertCircle,
  RefreshCw,
  RotateCcw,
  ChevronDown,
} from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { useXtreamCredentials } from '../context/XtreamContext';
import {
  fetchOrReuseHeroDetails,
  getHeroAccountScopeKey,
} from '../services/heroSessionCache';
import { useFavorites, FavoriteItem } from '../hooks/useFavorites';
import { VideoPlayer } from './VideoPlayer';
import { ExternalSubtitleTrackInput } from './player/types';
import { extractXtreamSubtitles } from './player/trackUtils';
import {
  buildDirectMediaUrl,
  getEpisodeId,
  normalizeContainerExtension,
  normalizeDirectMediaSource,
  normalizeEpisodesBySeason,
  normalizeImageSource,
  normalizeMetadataText,
} from '../utils/mediaUtils';
import { MediaImage } from './MediaImage';
import { DetailsModalShell } from './DetailsModalShell';
import {
  getItemProgress,
  recordPlaybackPosition,
  clearItemProgress,
  useAccountPlaybackHistory,
} from '../utils/playbackHistory';
import {
  useBackHandler,
  BACK_PRIORITY,
  pushFocusMemory,
  popFocusMemory,
  peekFocusMemoryElement,
  getNavMode,
  focusElementSafely,
} from '../navigation';

export interface SeriesDetailsProps {
  key?: React.Key;
  seriesId: string | number;
  seriesName: string;
  seriesCover?: string;
  onClose: () => void;
  onPlay: (url: string, title: string, startAt?: number, streamId?: string | number) => void;
}

export function formatEpisodeDuration(
  rawDuration?: string | number | null,
  durationSecs?: number | string | null
): {
  text: string | null;
  totalMinutes: number | null;
} {
  const formatMinutes = (totalMin: number): { text: string; totalMinutes: number } => {
    const hours = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    return {
      text: hours > 0 ? (mins > 0 ? `${hours}h ${mins}min` : `${hours}h`) : `${totalMin}min`,
      totalMinutes: totalMin,
    };
  };

  const numericSecs =
    typeof durationSecs === 'number'
      ? Number.isFinite(durationSecs)
        ? Math.round(durationSecs)
        : 0
      : typeof durationSecs === 'string' && /^\d+(?:\.\d+)?$/.test(durationSecs.trim())
        ? Math.round(parseFloat(durationSecs.trim()))
        : 0;

  if (numericSecs > 0) {
    return formatMinutes(Math.max(1, Math.round(numericSecs / 60)));
  }

  if (rawDuration === undefined || rawDuration === null) {
    return { text: null, totalMinutes: null };
  }

  if (typeof rawDuration === 'number') {
    if (!Number.isFinite(rawDuration) || rawDuration <= 0) {
      return { text: null, totalMinutes: null };
    }
    return formatMinutes(Math.max(1, Math.round(rawDuration)));
  }

  const trimmed = String(rawDuration).trim();
  if (!trimmed || /^0+(?::0+(?:\.\d+)?)?(?:\.0+)?$/.test(trimmed)) {
    return { text: null, totalMinutes: null };
  }

  // 3-part HH:MM:SS (e.g. "00:49:00", "01:12:30", "00:00:45")
  const hmsMatch = trimmed.match(/^(\d{1,3}):(\d{2}):(\d{2})(?:\.\d+)?$/);
  if (hmsMatch) {
    const h = parseInt(hmsMatch[1], 10);
    const m = parseInt(hmsMatch[2], 10);
    const s = parseInt(hmsMatch[3], 10);
    if (m < 60 && s < 60) {
      const totalSecs = h * 3600 + m * 60 + s;
      if (totalSecs <= 0) return { text: null, totalMinutes: null };
      return formatMinutes(Math.max(1, Math.round(totalSecs / 60)));
    }
  }

  // 2-part MM:SS (e.g. "45:30" -> 46min, NOT 45h 30min)
  const msMatch = trimmed.match(/^(\d{1,3}):(\d{2})(?:\.\d+)?$/);
  if (msMatch) {
    const m = parseInt(msMatch[1], 10);
    const s = parseInt(msMatch[2], 10);
    if (s < 60) {
      const totalSecs = m * 60 + s;
      if (totalSecs <= 0) return { text: null, totalMinutes: null };
      return formatMinutes(Math.max(1, Math.round(totalSecs / 60)));
    }
  }

  // Pure integer minutes (e.g. "56", "90")
  if (/^\d+$/.test(trimmed)) {
    const totalMin = parseInt(trimmed, 10);
    if (totalMin <= 0) return { text: null, totalMinutes: null };
    return formatMinutes(totalMin);
  }

  // Human-readable hour/minute durations (e.g. "1h 15min", "45 min", "45m", "2h")
  const hourMatch = trimmed.match(/(\d+)\s*h(?:r|rs|oras?)?/i);
  const minMatch = trimmed.match(/(\d+)\s*(?:min(?:utos?)?|m\b)/i);
  if (hourMatch || minMatch) {
    const h = hourMatch ? parseInt(hourMatch[1], 10) : 0;
    const m = minMatch ? parseInt(minMatch[1], 10) : 0;
    const totalMin = h * 60 + m;
    if (totalMin <= 0) return { text: null, totalMinutes: null };
    return formatMinutes(totalMin);
  }

  return { text: null, totalMinutes: null };
}

function extractCleanYear(rawDate?: string | number | null): string | null {
  if (rawDate === undefined || rawDate === null) return null;
  const str = String(rawDate).trim();
  if (!str || str === '0') return null;
  const match = str.match(/\b(19\d{2}|20\d{2})\b/);
  return match ? match[1] : null;
}

function escapeSelectorValue(val: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(val);
  }
  return String(val).replace(/["\\]/g, '\\$&');
}

const UNSEASONED_OPTION_VALUE = '__nc_unseasoned__';

type EpisodeGroupSelection =
  | { kind: 'season'; seasonKey: string }
  | { kind: 'unseasoned' };

function isSameEpisodeGroup(
  a: EpisodeGroupSelection | null,
  b: EpisodeGroupSelection | null
): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  return a.kind === 'unseasoned' || (b.kind === 'season' && a.seasonKey === b.seasonKey);
}

export const SeriesDetails = React.memo(function SeriesDetails({
  seriesId,
  seriesName,
  seriesCover,
  onClose,
}: SeriesDetailsProps) {
  const { credentials } = useXtreamCredentials();
  const { isFavorite, toggleFavorite, favoriteError, clearFavoriteError } = useFavorites();
  const historyRecords = useAccountPlaybackHistory(credentials);

  const [loadingInfo, setLoadingInfo] = useState(true);
  const [errorInfo, setErrorInfo] = useState<string | null>(null);
  const [seriesState, setSeriesState] = useState<{
    scopeKey: string;
    seriesId: string;
    data: any;
  } | null>(null);
  const [selectedGroupState, setSelectedGroupState] = useState<{
    scopeKey: string;
    seriesId: string;
    group: EpisodeGroupSelection;
  } | null>(null);
  const [isSeasonMenuOpen, setIsSeasonMenuOpen] = useState(false);

  const currentScopeKey = getHeroAccountScopeKey(credentials);
  const hasCredentials = Boolean(credentials);
  const credentialsRef = useRef(credentials);
  credentialsRef.current = credentials;
  const currentSeriesIdStr = String(seriesId);
  const scopeIdentityRef = useRef<string>(`${currentScopeKey}::${currentSeriesIdStr}`);
  const scopeGenerationRef = useRef<number>(0);
  const nextScopeIdentity = `${currentScopeKey}::${currentSeriesIdStr}`;
  if (scopeIdentityRef.current !== nextScopeIdentity) {
    scopeIdentityRef.current = nextScopeIdentity;
    scopeGenerationRef.current += 1;
  }
  const playerPresenceKey = scopeGenerationRef.current;
  const seriesInfo =
    seriesState &&
    seriesState.scopeKey === currentScopeKey &&
    seriesState.seriesId === currentSeriesIdStr
      ? seriesState.data
      : null;

  const [pendingResumeState, setPendingResumeState] = useState<{
    scopeKey: string;
    seriesId: string;
    episode: any;
    group: EpisodeGroupSelection | null;
    savedProgress: number;
  } | null>(null);
  const [playingEpisodeState, setPlayingEpisodeState] = useState<{
    scopeKey: string;
    seriesId: string;
    url: string;
    title: string;
    startAt: number;
    episode: any;
    group: EpisodeGroupSelection | null;
    subtitles?: ExternalSubtitleTrackInput[];
  } | null>(null);
  const [playErrorState, setPlayErrorState] = useState<{
    scopeKey: string;
    seriesId: string;
    message: string;
    failedEpisode: {
      episode: any;
      startAt: number;
      group: EpisodeGroupSelection | null;
    } | null;
  } | null>(null);
  const [favActionError, setFavActionError] = useState<string | null>(null);

  const activeResumeState =
    pendingResumeState &&
    pendingResumeState.scopeKey === currentScopeKey &&
    pendingResumeState.seriesId === currentSeriesIdStr
      ? pendingResumeState
      : null;
  const showResumeModal = Boolean(activeResumeState);
  const savedProgress = activeResumeState?.savedProgress ?? 0;

  const playingEpisodeData =
    playingEpisodeState &&
    playingEpisodeState.scopeKey === currentScopeKey &&
    playingEpisodeState.seriesId === currentSeriesIdStr
      ? playingEpisodeState
      : null;

  const activePlayErrorState =
    playErrorState &&
    playErrorState.scopeKey === currentScopeKey &&
    playErrorState.seriesId === currentSeriesIdStr
      ? playErrorState
      : null;
  const playError = activePlayErrorState?.message ?? null;
  const failedEpisode = activePlayErrorState?.failedEpisode ?? null;

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const primaryPlayBtnRef = useRef<HTMLButtonElement | null>(null);
  const favoriteBtnRef = useRef<HTMLButtonElement | null>(null);
  const seasonTriggerBtnRef = useRef<HTMLButtonElement | null>(null);
  const seasonMenuRef = useRef<HTMLDivElement | null>(null);
  const resumeConfirmBtnRef = useRef<HTMLButtonElement | null>(null);
  const originFocusElementRef = useRef<HTMLElement | null>(null);
  const didPushOriginRef = useRef<boolean>(false);
  const isClosingRef = useRef<boolean>(false);
  const lastEpisodeIdRef = useRef<string | null>(null);
  const lastTriggerWasHeroRef = useRef<boolean>(false);
  const savedEpisodeScrollTopRef = useRef<number | null>(null);
  const restoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (restoreTimerRef.current) {
        clearTimeout(restoreTimerRef.current);
        restoreTimerRef.current = null;
      }
    };
  }, []);

  const restoreEpisodeFocus = useCallback(() => {
    if (restoreTimerRef.current) {
      clearTimeout(restoreTimerRef.current);
      restoreTimerRef.current = null;
    }

    const targetEpisodeId = lastEpisodeIdRef.current;
    const savedScroll = savedEpisodeScrollTopRef.current;
    const fromHero = lastTriggerWasHeroRef.current;

    const attemptRestore = (): boolean => {
      const container = scrollContainerRef.current;
      if (!container) return false;

      if (savedScroll !== null) {
        container.scrollTop = savedScroll;
      }

      if (fromHero && primaryPlayBtnRef.current && primaryPlayBtnRef.current.isConnected) {
        try {
          primaryPlayBtnRef.current.focus({ preventScroll: true });
        } catch {
          primaryPlayBtnRef.current.focus();
        }
        if (savedScroll !== null) {
          container.scrollTop = savedScroll;
        }
        return true;
      }

      if (targetEpisodeId) {
        const epEl = container.querySelector<HTMLElement>(
          `[data-episode-id="${escapeSelectorValue(targetEpisodeId)}"]`
        );
        if (epEl) {
          try {
            epEl.focus({ preventScroll: true });
          } catch {
            epEl.focus();
          }

          if (savedScroll !== null) {
            container.scrollTop = savedScroll;
          }

          const cRect = container.getBoundingClientRect();
          const eRect = epEl.getBoundingClientRect();
          if (cRect.height > 0 && eRect.height > 0) {
            const padY = 20;
            if (eRect.top < cRect.top + padY) {
              container.scrollTop = Math.max(
                0,
                container.scrollTop + (eRect.top - cRect.top) - padY
              );
              savedEpisodeScrollTopRef.current = container.scrollTop;
            } else if (eRect.bottom > cRect.bottom - padY) {
              container.scrollTop = Math.max(
                0,
                container.scrollTop + (eRect.bottom - cRect.bottom) + padY
              );
              savedEpisodeScrollTopRef.current = container.scrollTop;
            }
          }
          return true;
        }
      }

      const fallbackEl =
        primaryPlayBtnRef.current ||
        container.querySelector<HTMLElement>('[data-episode-id]') ||
        seasonTriggerBtnRef.current ||
        favoriteBtnRef.current;

      if (fallbackEl) {
        focusElementSafely(fallbackEl);
        return true;
      }

      return false;
    };

    if (!attemptRestore()) {
      restoreTimerRef.current = setTimeout(() => {
        restoreTimerRef.current = null;
        attemptRestore();
      }, 0);
    }
  }, []);

  useEffect(() => {
    isClosingRef.current = false;
    const active =
      typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const topMem = peekFocusMemoryElement();
    const topIsShowcaseCard =
      topMem !== null &&
      topMem.isConnected &&
      (topMem.getAttribute('data-showcase-card') === 'true' ||
        topMem.hasAttribute('data-virtual-index') ||
        topMem.hasAttribute('data-row-card-index'));
    const isActiveInput =
      active !== null && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');

    if (active && active !== document.body && active !== document.documentElement) {
      if (topIsShowcaseCard && isActiveInput) {
        originFocusElementRef.current = topMem;
      } else {
        originFocusElementRef.current = active;
        if (!didPushOriginRef.current) {
          pushFocusMemory(active);
          didPushOriginRef.current = true;
        }
      }
    } else if (topMem && topMem.isConnected) {
      originFocusElementRef.current = topMem;
    }
  }, [seriesId]);

  const normalizedSeriesEpisodes = useMemo(
    () => normalizeEpisodesBySeason(seriesInfo?.episodes),
    [seriesInfo]
  );

  const episodesBySeason = normalizedSeriesEpisodes.seasons;
  const sortedSeasons = normalizedSeriesEpisodes.sortedSeasonKeys;
  const unseasonedEpisodes = normalizedSeriesEpisodes.unseasonedEpisodes;

  const scopedSelectedGroup: EpisodeGroupSelection | null =
    selectedGroupState &&
    selectedGroupState.scopeKey === currentScopeKey &&
    selectedGroupState.seriesId === currentSeriesIdStr
      ? selectedGroupState.group
      : null;

  const effectiveSelectedGroup: EpisodeGroupSelection | null = useMemo(() => {
    if (!scopedSelectedGroup) return null;
    if (scopedSelectedGroup.kind === 'season') {
      return Object.prototype.hasOwnProperty.call(
        episodesBySeason,
        scopedSelectedGroup.seasonKey
      )
        ? scopedSelectedGroup
        : null;
    }
    return unseasonedEpisodes.length > 0 ? scopedSelectedGroup : null;
  }, [scopedSelectedGroup, episodesBySeason, unseasonedEpisodes.length]);

  const effectiveSelectedGroupKey =
    effectiveSelectedGroup === null
      ? null
      : effectiveSelectedGroup.kind === 'season'
        ? `season:${effectiveSelectedGroup.seasonKey}`
        : UNSEASONED_OPTION_VALUE;

  // Autofocus primary action when series details finish loading
  useEffect(() => {
    if (!loadingInfo && seriesInfo) {
      const targetBtn = primaryPlayBtnRef.current || favoriteBtnRef.current;
      if (targetBtn) {
        if (getNavMode() !== 'pointer') {
          focusElementSafely(targetBtn);
        } else {
          try {
            targetBtn.focus({ preventScroll: true });
          } catch {}
        }
      }
    }
  }, [loadingInfo, seriesInfo]);

  // Focus active season option when dropdown opens
  useEffect(() => {
    if (!isSeasonMenuOpen || !seasonMenuRef.current) return;
    const selectedOption =
      (effectiveSelectedGroup
        ? effectiveSelectedGroup.kind === 'season'
          ? seasonMenuRef.current.querySelector<HTMLElement>(
              `button[data-season-group-kind="season"][data-season-option="${escapeSelectorValue(effectiveSelectedGroup.seasonKey)}"]`
            )
          : seasonMenuRef.current.querySelector<HTMLElement>(
              'button[data-season-group-kind="unseasoned"]'
            )
        : null) || seasonMenuRef.current.querySelector<HTMLElement>('button[data-season-option]');

    if (selectedOption) {
      try {
        selectedOption.focus({ preventScroll: true });
      } catch {
        selectedOption.focus();
      }
    }
  }, [isSeasonMenuOpen, effectiveSelectedGroup]);

  // Close season dropdown on outside click
  useEffect(() => {
    if (!isSeasonMenuOpen || typeof document === 'undefined') return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (
        seasonMenuRef.current?.contains(target) ||
        seasonTriggerBtnRef.current?.contains(target)
      ) {
        return;
      }
      setIsSeasonMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isSeasonMenuOpen]);

  // Ensure season/group changes never leave focus stranded on an unmounted episode node
  useEffect(() => {
    if (
      !effectiveSelectedGroupKey ||
      loadingInfo ||
      playingEpisodeData ||
      showResumeModal ||
      playError ||
      isSeasonMenuOpen
    ) {
      return;
    }
    if (getNavMode() !== 'remote') return;

    const active = document.activeElement;
    if (
      !active ||
      active === document.body ||
      active === document.documentElement ||
      !active.isConnected
    ) {
      if (seasonTriggerBtnRef.current) {
        focusElementSafely(seasonTriggerBtnRef.current);
      } else if (primaryPlayBtnRef.current) {
        focusElementSafely(primaryPlayBtnRef.current);
      } else if (favoriteBtnRef.current) {
        focusElementSafely(favoriteBtnRef.current);
      }
    }
  }, [
    effectiveSelectedGroupKey,
    loadingInfo,
    playingEpisodeData,
    showResumeModal,
    playError,
    isSeasonMenuOpen,
  ]);

  const handleClose = useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    if (restoreTimerRef.current) {
      clearTimeout(restoreTimerRef.current);
      restoreTimerRef.current = null;
    }
    const originEl = originFocusElementRef.current;
    onClose();

    const restoreOrigin = () => {
      if (popFocusMemory()) {
        return true;
      }
      if (originEl && originEl.isConnected) {
        focusElementSafely(originEl);
        return true;
      }
      return false;
    };

    if (!restoreOrigin()) {
      setTimeout(restoreOrigin, 0);
    }
  }, [onClose]);

  useBackHandler(
    `series-details-submodal-${seriesId}`,
    BACK_PRIORITY.SUB_MODAL,
    () => {
      if (playError) {
        setPlayErrorState(null);
        restoreEpisodeFocus();
        return true;
      }
      if (showResumeModal) {
        setPendingResumeState(null);
        restoreEpisodeFocus();
        return true;
      }
      if (isSeasonMenuOpen) {
        setIsSeasonMenuOpen(false);
        if (seasonTriggerBtnRef.current) {
          try {
            seasonTriggerBtnRef.current.focus({ preventScroll: true });
          } catch {
            seasonTriggerBtnRef.current.focus();
          }
        }
        return true;
      }
      return false;
    },
    isSeasonMenuOpen || showResumeModal || Boolean(playError)
  );

  useBackHandler(
    `series-details-${seriesId}`,
    BACK_PRIORITY.DETAILS_MODAL,
    () => {
      handleClose();
      return true;
    },
    !playingEpisodeData
  );

  useEffect(() => {
    if (showResumeModal && resumeConfirmBtnRef.current) {
      focusElementSafely(resumeConfirmBtnRef.current);
    }
  }, [showResumeModal]);

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
      setFavActionError(
        'Não foi possível salvar os favoritos neste dispositivo. Tente novamente.'
      );
    } else {
      setFavActionError(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const abortController =
      typeof AbortController !== 'undefined' ? new AbortController() : null;
    const creds = credentialsRef.current;
    const fetchScopeKey = currentScopeKey;
    const fetchSeriesId = currentSeriesIdStr;

    setSeriesState(null);
    setSelectedGroupState(null);
    setIsSeasonMenuOpen(false);
    setPendingResumeState(null);
    setPlayingEpisodeState(null);
    setPlayErrorState(null);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }

    async function fetchInfo() {
      if (!creds) {
        if (!cancelled) setLoadingInfo(false);
        return;
      }
      try {
        setLoadingInfo(true);
        setErrorInfo(null);
        const info = await fetchOrReuseHeroDetails(
          creds,
          { series_id: seriesId, stream_type: 'series' },
          {
            signal: abortController?.signal,
            requireEpisodes: true,
            throwOnError: true,
          }
        );
        if (cancelled || abortController?.signal.aborted) return;
        if (!info || typeof info !== 'object') {
          setSeriesState(null);
          setErrorInfo('Não foi possível carregar os detalhes da série.');
          return;
        }
        setSeriesState({
          scopeKey: fetchScopeKey,
          seriesId: fetchSeriesId,
          data: info,
        });
        const normalizedEpisodes = normalizeEpisodesBySeason(info.episodes);
        const seasons = normalizedEpisodes.sortedSeasonKeys;
        if (seasons.length > 0) {
          const firstWithEpisodes =
            seasons.find(
              (s) =>
                normalizedEpisodes.seasons[s] && normalizedEpisodes.seasons[s].length > 0
            ) || seasons[0];
          setSelectedGroupState({
            scopeKey: fetchScopeKey,
            seriesId: fetchSeriesId,
            group: { kind: 'season', seasonKey: firstWithEpisodes },
          });
        } else if (normalizedEpisodes.unseasonedEpisodes.length > 0) {
          setSelectedGroupState({
            scopeKey: fetchScopeKey,
            seriesId: fetchSeriesId,
            group: { kind: 'unseasoned' },
          });
        } else {
          setSelectedGroupState(null);
        }
      } catch (err: any) {
        if (cancelled || abortController?.signal.aborted || err?.name === 'AbortError') return;
        console.error(err);
        setSeriesState(null);
        setErrorInfo('Não foi possível carregar os detalhes da série.');
      } finally {
        if (!cancelled) {
          setLoadingInfo(false);
        }
      }
    }
    fetchInfo();
    return () => {
      cancelled = true;
      abortController?.abort();
    };
  }, [currentScopeKey, hasCredentials, currentSeriesIdStr]);

  const info = seriesInfo?.info || {};
  const displayTitle = info.name || seriesName || 'Série';
  const titleId = `series-details-title-${seriesId}`;
  const favorited = isFavorite(seriesId, 'series');

  const heroBackdropUrl = useMemo(() => {
    const rawBackdrop = Array.isArray(info.backdrop_path)
      ? info.backdrop_path.find((b: any) => typeof b === 'string' && b.trim().length > 0)
      : typeof info.backdrop_path === 'string' && info.backdrop_path.trim().length > 0
        ? info.backdrop_path
        : '';
    return normalizeImageSource(rawBackdrop);
  }, [info.backdrop_path]);

  const heroCoverUrl = useMemo(
    () =>
      normalizeImageSource(info.cover_big || info.cover) ||
      normalizeImageSource(seriesCover),
    [info.cover_big, info.cover, seriesCover]
  );

  const heroImageUrl = heroBackdropUrl || heroCoverUrl;

  const releaseYear = useMemo(
    () => extractCleanYear(info.releasedate || info.releaseDate || info.release_date || info.year),
    [info.releasedate, info.releaseDate, info.release_date, info.year]
  );

  const displayRating = useMemo(() => {
    const raw = info.rating;
    if (raw === undefined || raw === null) return null;
    const str = String(raw).trim();
    if (!str || str === '0' || str === '0.0') return null;
    return str;
  }, [info.rating]);

  const castText = useMemo(
    () => normalizeMetadataText(info.cast) || normalizeMetadataText(info.actors),
    [info.cast, info.actors]
  );

  const directorText = useMemo(
    () => normalizeMetadataText(info.director),
    [info.director]
  );

  const genreText = useMemo(
    () => normalizeMetadataText(info.genre),
    [info.genre]
  );

  const seasonCountText = useMemo(() => {
    if (sortedSeasons.length === 0) return null;
    return `${sortedSeasons.length} ${sortedSeasons.length === 1 ? 'temporada' : 'temporadas'}`;
  }, [sortedSeasons.length]);

  // Flatten all episodes in sorted season order (followed by unseasoned episodes) to determine contextual primary CTA
  const allSeriesEpisodes = useMemo(() => {
    const entries: Array<{ seasonKey: string | null; episode: any; episodeIndex: number }> = [];
    for (const sKey of sortedSeasons) {
      const list = episodesBySeason[sKey];
      if (!Array.isArray(list)) continue;
      list.forEach((ep: any, idx: number) => {
        if (ep && typeof ep === 'object') {
          entries.push({ seasonKey: sKey, episode: ep, episodeIndex: idx });
        }
      });
    }
    unseasonedEpisodes.forEach((ep: any, idx: number) => {
      if (ep && typeof ep === 'object') {
        entries.push({ seasonKey: null, episode: ep, episodeIndex: idx });
      }
    });
    return entries;
  }, [episodesBySeason, sortedSeasons, unseasonedEpisodes]);

  // Contextual Primary Episode Target (Continue in-progress episode vs Play first available episode)
  const primaryEpisodeTarget = useMemo(() => {
    if (allSeriesEpisodes.length === 0) return null;

    const byId = new Map<string, { seasonKey: string | null; episode: any; episodeIndex: number }>();
    for (const entry of allSeriesEpisodes) {
      const epId = getEpisodeId(entry.episode);
      if (epId !== null) {
        byId.set(String(epId), entry);
      }
    }

    // 1. Check active account playback history (most recently updated episode with progress > 30s)
    for (const rec of historyRecords) {
      if (rec.type !== 'episode') continue;
      const matched = byId.get(String(rec.id));
      if (matched && (rec.positionSec || 0) > 30) {
        const progressSec = rec.positionSec || 0;
        const epNum = matched.episode.episode_num || matched.episodeIndex + 1;
        const durInfo = formatEpisodeDuration(
          matched.episode.info?.duration || matched.episode.duration,
          matched.episode.info?.duration_secs || matched.episode.duration_secs
        );
        const savedMinutes = Math.max(1, Math.floor(progressSec / 60));
        const progressPercent: number | null =
          durInfo.totalMinutes && durInfo.totalMinutes > 0
            ? Math.min(95, Math.max(6, Math.round((progressSec / (durInfo.totalMinutes * 60)) * 100)))
            : null;

        return {
          mode: 'continue' as const,
          seasonKey: matched.seasonKey,
          episode: matched.episode,
          epNum,
          label:
            matched.seasonKey !== null
              ? `Continuar T${matched.seasonKey}:E${epNum}`
              : `Continuar Episódio ${epNum}`,
          progressSec,
          savedMinutes,
          totalMinutes: durInfo.totalMinutes,
          progressPercent,
        };
      }
    }

    // 2. Fallback scan via getItemProgress
    for (const entry of allSeriesEpisodes) {
      const epId = getEpisodeId(entry.episode);
      if (epId === null) continue;
      const progressSec = getItemProgress(credentials, 'episode', epId);
      if (progressSec > 30) {
        const epNum = entry.episode.episode_num || entry.episodeIndex + 1;
        const durInfo = formatEpisodeDuration(
          entry.episode.info?.duration || entry.episode.duration,
          entry.episode.info?.duration_secs || entry.episode.duration_secs
        );
        const savedMinutes = Math.max(1, Math.floor(progressSec / 60));
        const progressPercent: number | null =
          durInfo.totalMinutes && durInfo.totalMinutes > 0
            ? Math.min(95, Math.max(6, Math.round((progressSec / (durInfo.totalMinutes * 60)) * 100)))
            : null;

        return {
          mode: 'continue' as const,
          seasonKey: entry.seasonKey,
          episode: entry.episode,
          epNum,
          label:
            entry.seasonKey !== null
              ? `Continuar T${entry.seasonKey}:E${epNum}`
              : `Continuar Episódio ${epNum}`,
          progressSec,
          savedMinutes,
          totalMinutes: durInfo.totalMinutes,
          progressPercent,
        };
      }
    }

    // 3. Default to the first available episode
    const first = allSeriesEpisodes[0];
    const firstEpNum = first.episode.episode_num || 1;
    return {
      mode: 'first' as const,
      seasonKey: first.seasonKey,
      episode: first.episode,
      epNum: firstEpNum,
      label:
        first.seasonKey !== null
          ? `Assistir T${first.seasonKey}:E${firstEpNum}`
          : `Assistir Episódio ${firstEpNum}`,
      progressSec: 0,
      savedMinutes: 0,
      totalMinutes: null,
      progressPercent: null,
    };
  }, [allSeriesEpisodes, historyRecords, credentials]);

  const getEpisodesForGroup = useCallback(
    (group: EpisodeGroupSelection | null): any[] => {
      if (!group) return [];
      if (group.kind === 'season') {
        const list = episodesBySeason[group.seasonKey];
        return Array.isArray(list) ? list : [];
      }
      return unseasonedEpisodes;
    },
    [episodesBySeason, unseasonedEpisodes]
  );

  const executePlay = (
    episode: any,
    startAt: number = 0,
    groupOverride?: EpisodeGroupSelection | null
  ) => {
    const activeGroupForPlay: EpisodeGroupSelection | null =
      groupOverride !== undefined ? groupOverride : effectiveSelectedGroup;
    const seasonKeyForTitle =
      activeGroupForPlay && activeGroupForPlay.kind === 'season'
        ? activeGroupForPlay.seasonKey
        : null;
    const epId = getEpisodeId(episode);
    const episodeDirectSource =
      normalizeDirectMediaSource(episode?.direct_source) ||
      normalizeDirectMediaSource(episode?.info?.direct_source);

    if (
      activeGroupForPlay &&
      !isSameEpisodeGroup(activeGroupForPlay, effectiveSelectedGroup)
    ) {
      setSelectedGroupState({
        scopeKey: currentScopeKey,
        seriesId: currentSeriesIdStr,
        group: activeGroupForPlay,
      });
    }

    if (epId !== null) {
      lastEpisodeIdRef.current = String(epId);
    }
    if (scrollContainerRef.current && !playingEpisodeData && !showResumeModal && !playError) {
      savedEpisodeScrollTopRef.current = scrollContainerRef.current.scrollTop;
    }

    if (epId === null && !episodeDirectSource) {
      setPendingResumeState(null);
      setPlayErrorState({
        scopeKey: currentScopeKey,
        seriesId: currentSeriesIdStr,
        message: 'Não foi possível reproduzir este episódio: identificador inválido ou ausente.',
        failedEpisode: null,
      });
      return;
    }

    if (epId !== null) {
      recordPlaybackPosition(credentials, {
        id: epId,
        type: 'episode',
        parentSeriesId: seriesId,
        ...(startAt > 0 ? { positionSec: startAt } : {}),
      });

      if (startAt === 0) {
        clearItemProgress(credentials, 'episode', epId);
      }
    }

    if (!credentials) return;
    try {
      setPlayErrorState(null);
      const ext = normalizeContainerExtension(episode?.container_extension) || 'mp4';
      const mediaUrl = buildDirectMediaUrl(credentials, {
        type: 'series',
        streamId: epId ?? '',
        containerExtension: ext,
        directSource: episodeDirectSource ?? undefined,
      });

      const episodeSubs = extractXtreamSubtitles(episode, credentials.serverUrl);
      const epNumberOrId = episode?.episode_num || epId || 1;
      const playbackTitle =
        seasonKeyForTitle !== null
          ? `${displayTitle} - S${seasonKeyForTitle}E${epNumberOrId}`
          : `${displayTitle} - Episódio ${epNumberOrId}`;

      setPlayingEpisodeState({
        scopeKey: currentScopeKey,
        seriesId: currentSeriesIdStr,
        url: mediaUrl,
        title: playbackTitle,
        startAt,
        episode,
        group: activeGroupForPlay,
        subtitles: episodeSubs.length > 0 ? episodeSubs : undefined,
      });
      setPendingResumeState(null);
    } catch (err: any) {
      console.error('Erro ao iniciar episódio:', err);
      setPendingResumeState(null);
      setPlayErrorState({
        scopeKey: currentScopeKey,
        seriesId: currentSeriesIdStr,
        message: err?.message || 'Falha ao preparar a reprodução do episódio.',
        failedEpisode: { episode, startAt, group: activeGroupForPlay },
      });
    }
  };

  const currentSeasonEpisodes: any[] = useMemo(
    () => getEpisodesForGroup(effectiveSelectedGroup),
    [effectiveSelectedGroup, getEpisodesForGroup]
  );

  const handleNextEpisode = () => {
    if (!playingEpisodeData) return;
    const activeGroup = playingEpisodeData.group ?? effectiveSelectedGroup;
    const episodes = getEpisodesForGroup(activeGroup);
    if (!Array.isArray(episodes) || episodes.length === 0) return;
    const playingEpId = getEpisodeId(playingEpisodeData.episode);
    if (playingEpId === null) return;
    const currentIndex = episodes.findIndex((e: any) => {
      const candId = getEpisodeId(e);
      return candId !== null && String(candId) === String(playingEpId);
    });
    if (currentIndex !== -1 && currentIndex < episodes.length - 1) {
      executePlay(episodes[currentIndex + 1], 0, activeGroup);
    }
  };

  const handlePreviousEpisode = () => {
    if (!playingEpisodeData) return;
    const activeGroup = playingEpisodeData.group ?? effectiveSelectedGroup;
    const episodes = getEpisodesForGroup(activeGroup);
    if (!Array.isArray(episodes) || episodes.length === 0) return;
    const playingEpId = getEpisodeId(playingEpisodeData.episode);
    if (playingEpId === null) return;
    const currentIndex = episodes.findIndex((e: any) => {
      const candId = getEpisodeId(e);
      return candId !== null && String(candId) === String(playingEpId);
    });
    if (currentIndex > 0) {
      executePlay(episodes[currentIndex - 1], 0, activeGroup);
    }
  };

  const handlePlayEpisodeClick = (
    episode: any,
    fromHeroCta: boolean = false,
    groupOverride?: EpisodeGroupSelection | null
  ) => {
    const resolvedGroup: EpisodeGroupSelection | null =
      groupOverride !== undefined ? groupOverride : effectiveSelectedGroup;
    const epId = getEpisodeId(episode);
    lastTriggerWasHeroRef.current = fromHeroCta;
    if (epId !== null) {
      lastEpisodeIdRef.current = String(epId);
    }
    if (scrollContainerRef.current) {
      savedEpisodeScrollTopRef.current = scrollContainerRef.current.scrollTop;
    }
    if (resolvedGroup && !isSameEpisodeGroup(resolvedGroup, effectiveSelectedGroup)) {
      setSelectedGroupState({
        scopeKey: currentScopeKey,
        seriesId: currentSeriesIdStr,
        group: resolvedGroup,
      });
    }
    const progress =
      epId !== null
        ? getItemProgress(credentials, 'episode', epId)
        : 0;
    if (progress > 30) {
      setPendingResumeState({
        scopeKey: currentScopeKey,
        seriesId: currentSeriesIdStr,
        episode,
        group: resolvedGroup,
        savedProgress: progress,
      });
    } else {
      executePlay(episode, 0, resolvedGroup);
    }
  };

  const handlePrimaryHeroAction = () => {
    if (!primaryEpisodeTarget) return;
    const targetGroup: EpisodeGroupSelection =
      primaryEpisodeTarget.seasonKey !== null
        ? { kind: 'season', seasonKey: primaryEpisodeTarget.seasonKey }
        : { kind: 'unseasoned' };
    handlePlayEpisodeClick(primaryEpisodeTarget.episode, true, targetGroup);
  };

  const handleSelectGroup = (group: EpisodeGroupSelection) => {
    const preservedScrollTop = scrollContainerRef.current?.scrollTop ?? null;
    setSelectedGroupState({
      scopeKey: currentScopeKey,
      seriesId: currentSeriesIdStr,
      group,
    });
    setIsSeasonMenuOpen(false);
    if (seasonTriggerBtnRef.current) {
      try {
        seasonTriggerBtnRef.current.focus({ preventScroll: true });
      } catch {
        seasonTriggerBtnRef.current.focus();
      }
    }
    if (preservedScrollTop !== null && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = preservedScrollTop;
    }
  };

  const hasAboutSection = Boolean(
    directorText ||
      castText ||
      genreText ||
      releaseYear ||
      seasonCountText ||
      displayRating
  );

  const savedMinutes = Math.max(1, Math.floor(savedProgress / 60));

  const overlaySlot = (
    <>
      {(favActionError || favoriteError) && (
        <div
          role="alert"
          className="nc-lite-instant-toast absolute bottom-6 right-6 left-6 sm:left-auto sm:max-w-md z-[110] bg-red-600/95 text-white text-sm px-4 py-3 rounded-xl shadow-2xl border border-red-500/50 backdrop-blur-md flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-2"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-5 h-5 text-white shrink-0" />
            <span className="whitespace-normal break-words">
              {favActionError || favoriteError}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setFavActionError(null);
              clearFavoriteError();
            }}
            className="p-1 hover:bg-white/20 rounded-lg text-white/80 hover:text-white shrink-0 transition-colors cursor-pointer"
            aria-label="Fechar aviso"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {activeResumeState && (
        <div
          data-focus-scope="modal"
          data-resume-modal="true"
          className="absolute inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="nc-lite-instant-modal bg-[#181818] border border-white/15 rounded-2xl p-6 md:p-8 max-w-md w-full shadow-2xl flex flex-col items-center text-center animate-in zoom-in-95 duration-200">
            <div className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center mb-4">
              <Play className="w-7 h-7 text-white fill-current ml-1" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Continuar Assistindo?</h3>
            <p className="text-[#bcbcbc] text-sm mb-6">
              Você já assistiu uma parte deste episódio (
              <span className="text-white font-semibold">{savedMinutes} min</span>). O que
              você gostaria de fazer?
            </p>
            <div className="flex flex-col gap-3 w-full">
              <button
                ref={resumeConfirmBtnRef}
                type="button"
                data-autofocus="true"
                onClick={() =>
                  executePlay(
                    activeResumeState.episode,
                    activeResumeState.savedProgress,
                    activeResumeState.group
                  )
                }
                className="w-full py-3.5 bg-white hover:bg-white/90 text-black font-bold rounded-lg transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Play className="w-5 h-5 fill-current" /> Retomar de {savedMinutes} min
              </button>
              <button
                type="button"
                onClick={() =>
                  executePlay(activeResumeState.episode, 0, activeResumeState.group)
                }
                className="w-full py-3.5 bg-[#2a2a2a] hover:bg-[#363636] text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 border border-white/15 cursor-pointer"
              >
                <RotateCcw className="w-5 h-5" /> Assistir do Início
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingResumeState(null);
                  restoreEpisodeFocus();
                }}
                className="w-full py-2.5 text-[#bcbcbc] hover:text-white text-sm font-medium transition-colors mt-1 cursor-pointer"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {playError && (
        <div
          data-focus-scope="modal"
          data-play-error-modal="true"
          className="absolute inset-0 z-[110] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="nc-lite-instant-modal bg-[#181818] border border-red-500/40 rounded-2xl p-6 md:p-8 max-w-md w-full shadow-2xl flex flex-col items-center text-center animate-in zoom-in-95 duration-200">
            <div className="w-14 h-14 rounded-full bg-red-500/20 flex items-center justify-center mb-4">
              <AlertCircle className="w-7 h-7 text-red-500" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Erro ao Iniciar Episódio</h3>
            <p className="text-red-400 text-sm mb-4 leading-relaxed">{playError}</p>
            <p className="text-[#bcbcbc] text-xs mb-6">
              A transmissão foi solicitada diretamente ao provedor. O endereço pode estar
              inacessível ou o formato requerer compatibilidade no navegador.
            </p>
            <div data-nav-row="true" className="flex gap-3 w-full">
              {failedEpisode && (
                <button
                  type="button"
                  data-autofocus="true"
                  onClick={() =>
                    executePlay(
                      failedEpisode.episode,
                      failedEpisode.startAt,
                      failedEpisode.group
                    )
                  }
                  className="flex-1 py-3 bg-white hover:bg-white/90 text-black font-bold rounded-lg transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4" /> Tentar Novamente
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setPlayErrorState(null);
                  restoreEpisodeFocus();
                }}
                className="flex-1 py-3 bg-[#2a2a2a] hover:bg-[#3a3a3a] text-white font-semibold rounded-lg transition-colors border border-white/15 cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      <AnimatePresence key={playerPresenceKey}>
        {playingEpisodeData &&
          (() => {
            let hasNext = false;
            let hasPrev = false;
            const playingEpId = getEpisodeId(playingEpisodeData.episode);
            const activeGroupEpisodes = getEpisodesForGroup(
              playingEpisodeData.group ?? effectiveSelectedGroup
            );
            if (activeGroupEpisodes.length > 0 && playingEpId !== null) {
              const currIdx = activeGroupEpisodes.findIndex((e: any) => {
                const candId = getEpisodeId(e);
                return candId !== null && String(candId) === String(playingEpId);
              });
              if (currIdx !== -1) {
                if (currIdx < activeGroupEpisodes.length - 1) hasNext = true;
                if (currIdx > 0) hasPrev = true;
              }
            }
            return (
              <VideoPlayer
                streamUrl={playingEpisodeData.url}
                title={playingEpisodeData.title}
                programTitle={
                  playingEpisodeData.episode?.title
                    ? String(playingEpisodeData.episode.title)
                    : undefined
                }
                contentType="episode"
                startAt={playingEpisodeData.startAt}
                streamId={playingEpId ?? undefined}
                externalSubtitles={playingEpisodeData.subtitles}
                onBack={() => {
                  setPlayingEpisodeState(null);
                  restoreEpisodeFocus();
                }}
                onNext={hasNext ? handleNextEpisode : undefined}
                onPrevious={hasPrev ? handlePreviousEpisode : undefined}
              />
            );
          })()}
      </AnimatePresence>
    </>
  );

  const headerRegion =
    !loadingInfo && seriesInfo && !errorInfo ? (
      <div
        data-series-hero-region="true"
        data-scroll-top-anchor="true"
        className="nc-tv-series-hero relative w-full aspect-video min-h-[220px] sm:min-h-[320px] md:min-h-[400px] max-h-[460px] bg-[#141414] overflow-hidden flex flex-col justify-end"
      >
        {heroImageUrl ? (
          <MediaImage
            src={heroImageUrl}
            serverUrl={credentials?.serverUrl}
            alt={displayTitle}
            itemId={seriesId}
            itemName={displayTitle}
            priority={true}
            className="absolute inset-0 w-full h-full object-cover object-center opacity-85"
          />
        ) : (
          <div
            data-series-hero-fallback="true"
            className="absolute inset-0 bg-gradient-to-br from-[#262626] via-[#1b1b1b] to-[#141414]"
          />
        )}

        {/* Cinematic gradients into #181818 */}
        <div
          data-details-scrim-primary="true"
          className="absolute inset-0 bg-gradient-to-t from-[#181818] via-[#181818]/45 to-transparent"
        />
        <div
          data-details-scrim-secondary="true"
          className="absolute inset-0 bg-gradient-to-r from-[#181818]/85 via-[#181818]/25 to-transparent"
        />
        <div
          data-details-scrim-secondary="true"
          className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black/50 to-transparent pointer-events-none"
        />

        {/* Foreground Title, Progress Bar, and Primary Actions */}
        <div
          data-scroll-top-anchor="true"
          className="nc-tv-details-hero-inner relative z-20 px-5 sm:px-8 md:px-10 pb-5 sm:pb-7 pt-12 flex flex-col gap-3.5 max-w-3xl"
        >
          <h1
            id={titleId}
            className="nc-heading-details nc-tv-details-title font-black text-white tracking-tight drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)] break-words"
          >
            {displayTitle}
          </h1>

          {primaryEpisodeTarget && primaryEpisodeTarget.mode === 'continue' && (
            <div
              data-series-progress-info="true"
              className="flex items-center gap-3 max-w-md w-full"
            >
              {primaryEpisodeTarget.progressPercent !== null && (
                <div
                  data-series-progress-bar="true"
                  className="flex-1 h-1 bg-white/30 rounded-full overflow-hidden"
                >
                  <div
                    className="h-full bg-[#E50914] rounded-full"
                    style={{ width: `${primaryEpisodeTarget.progressPercent}%` }}
                  />
                </div>
              )}
              <span
                data-series-progress-minutes="true"
                className="text-xs sm:text-sm font-bold text-white/90 shrink-0 drop-shadow"
              >
                {primaryEpisodeTarget.totalMinutes
                  ? `${primaryEpisodeTarget.savedMinutes} de ${primaryEpisodeTarget.totalMinutes}min`
                  : `${primaryEpisodeTarget.savedMinutes} min assistidos`}
              </span>
            </div>
          )}

          <div
            data-nav-row="true"
            data-scroll-block="true"
            data-scroll-top-anchor="true"
            className="flex flex-wrap items-center gap-3 pt-1"
          >
            {primaryEpisodeTarget && (
              <button
                ref={primaryPlayBtnRef}
                type="button"
                data-autofocus="true"
                data-series-primary-cta="true"
                onClick={handlePrimaryHeroAction}
                className="nc-tv-details-action px-6 sm:px-8 py-2.5 sm:py-3 bg-white hover:bg-white/90 text-black font-bold rounded-md flex items-center justify-center gap-2.5 transition-all shadow-lg cursor-pointer"
              >
                <Play className="w-5 h-5 fill-current text-black shrink-0" />
                <span>{primaryEpisodeTarget.label}</span>
              </button>
            )}

            <button
              ref={favoriteBtnRef}
              type="button"
              data-autofocus={!primaryEpisodeTarget ? 'true' : undefined}
              data-scroll-block="true"
              data-series-favorite-btn="true"
              aria-label="Favoritar"
              onClick={() =>
                handleToggleFavorite({
                  id: seriesId,
                  name: displayTitle,
                  cover: heroCoverUrl || heroImageUrl || '',
                  type: 'series',
                })
              }
              className={`nc-tv-details-action-icon w-11 h-11 rounded-full border-2 flex items-center justify-center transition-all cursor-pointer ${
                favorited
                  ? 'bg-white/15 border-white text-red-500'
                  : 'bg-[#2a2a2a]/80 hover:bg-[#3a3a3a] border-white/50 hover:border-white text-white'
              }`}
              title={favorited ? 'Remover dos Favoritos' : 'Adicionar aos Favoritos'}
            >
              <Heart className={`w-5 h-5 ${favorited ? 'fill-current' : ''}`} />
            </button>
          </div>
        </div>
      </div>
    ) : undefined;

  return (
    <DetailsModalShell
      titleId={titleId}
      modalType="series"
      onClose={handleClose}
      scrollContainerRef={scrollContainerRef}
      headerRegion={headerRegion}
      overlaySlot={overlaySlot}
    >
      {loadingInfo ? (
        <div className="flex flex-col items-center justify-center min-h-[360px] py-20 px-6 text-[#bcbcbc]">
          <h1 id={titleId} className="sr-only">
            {displayTitle}
          </h1>
          <Loader2 className="w-10 h-10 animate-spin text-white mb-4" />
          <p className="text-sm sm:text-base">Carregando dados da série...</p>
        </div>
      ) : errorInfo || !seriesInfo ? (
        <div
          data-series-error-state="true"
          className="flex flex-col items-center justify-center min-h-[360px] py-16 px-6 text-center"
        >
          <AlertCircle className="w-14 h-14 text-red-500 mb-4" />
          <h1 id={titleId} className="text-xl sm:text-2xl font-bold text-white mb-2">
            Ops, algo deu errado
          </h1>
          <p className="text-[#bcbcbc] max-w-md mb-6">
            {errorInfo || 'Falha ao carregar informações da série.'}
          </p>
          <div data-nav-row="true" className="flex flex-wrap items-center justify-center gap-3">
            <button
              ref={primaryPlayBtnRef}
              type="button"
              data-autofocus="true"
              onClick={handleClose}
              className="px-6 py-3 bg-[#2a2a2a] hover:bg-[#3a3a3a] text-white font-semibold rounded-md border border-white/15 transition-colors cursor-pointer"
            >
              Voltar
            </button>
          </div>
        </div>
      ) : (
        <div className="px-5 sm:px-8 md:px-10 pt-2 pb-10 flex flex-col gap-8">
          {/* Two-Column Metadata & Synopsis Section */}
          <div
            data-series-main-columns="true"
            className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 items-start"
          >
            {/* Left Column: Technical Metadata Line + Full Synopsis */}
            <div className="md:col-span-2 flex flex-col gap-3.5 min-w-0">
              {(releaseYear || seasonCountText || displayRating || genreText) && (
                <div
                  data-series-meta-line="true"
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm sm:text-base font-medium text-[#bcbcbc]"
                >
                  {releaseYear && (
                    <span data-series-year="true" className="text-white/90 font-semibold">
                      {releaseYear}
                    </span>
                  )}
                  {seasonCountText && (
                    <span data-series-seasons-count="true">{seasonCountText}</span>
                  )}
                  {displayRating && (
                    <span
                      data-series-rating="true"
                      className="text-yellow-400 font-semibold flex items-center gap-1"
                    >
                      ★ {displayRating}
                    </span>
                  )}
                  {!releaseYear && !seasonCountText && !displayRating && genreText && (
                    <span>{genreText}</span>
                  )}
                </div>
              )}

              <div data-nav-row="true" data-scroll-block="true">
                <div
                  role="region"
                  aria-label="Sinopse da série"
                  data-synopsis-focus="true"
                  data-nav-item="true"
                  data-scroll-block="true"
                  data-scroll-top-anchor="true"
                  tabIndex={0}
                  className="nc-tv-series-synopsis rounded-lg p-1.5 -m-1.5 transition-colors focus:outline-none"
                >
                  <p className="nc-text-reading text-white/95 leading-relaxed whitespace-pre-line break-words">
                    {normalizeMetadataText(info.plot) ||
                      normalizeMetadataText(info.description) ||
                      'Sinopse não disponível.'}
                  </p>
                </div>
              </div>
            </div>

            {/* Right Column: Compact Credits (Elenco, Gêneros, Direção) */}
            {(castText || genreText || directorText) && (
              <div
                data-series-side-credits="true"
                className="md:col-span-1 flex flex-col gap-2.5 text-xs sm:text-sm leading-snug min-w-0"
              >
                {castText && (
                  <div className="break-words">
                    <span className="text-[#777777]">Elenco: </span>
                    <span className="text-white/90">{castText}</span>
                  </div>
                )}
                {genreText && (
                  <div className="break-words">
                    <span className="text-[#777777]">Gêneros: </span>
                    <span className="text-white/90">{genreText}</span>
                  </div>
                )}
                {directorText && (
                  <div className="break-words">
                    <span className="text-[#777777]">Direção: </span>
                    <span className="text-white/90">{directorText}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Episodes Section Header + Season Dropdown + Enriched Episode List */}
          <section data-episodes-section="true" className="pt-2 border-t border-white/10">
            <div
              data-episodes-header="true"
              className="flex flex-wrap items-center justify-between gap-4 mb-4 relative z-30"
            >
              <h2 className="text-lg sm:text-2xl font-bold text-white">Episódios</h2>

              {(sortedSeasons.length > 0 || unseasonedEpisodes.length > 0) &&
                effectiveSelectedGroup &&
                (() => {
                  const activeGroupLabel =
                    effectiveSelectedGroup.kind === 'season'
                      ? `Temporada ${effectiveSelectedGroup.seasonKey}`
                      : 'Sem temporada';
                  return (
                    <div className="relative" data-scroll-block="true">
                      <div
                        data-nav-row="true"
                        data-nav-season-row="true"
                        data-scroll-block="true"
                      >
                        <button
                          ref={seasonTriggerBtnRef}
                          type="button"
                          aria-haspopup="listbox"
                          aria-expanded={isSeasonMenuOpen}
                          aria-label={`Selecionar temporada, atual ${activeGroupLabel}`}
                          data-season-dropdown-trigger="true"
                          data-season-selected="true"
                          onClick={() => setIsSeasonMenuOpen((prev) => !prev)}
                          className="nc-tv-season-btn min-w-[175px] sm:min-w-[210px] px-4 py-2.5 rounded-md bg-[#242424] hover:bg-[#2f2f2f] text-white font-semibold text-sm sm:text-base border border-white/25 flex items-center justify-between gap-3 transition-colors shadow-md cursor-pointer"
                        >
                          <span>{activeGroupLabel}</span>
                          <ChevronDown
                            className={`w-4 h-4 text-white/80 transition-transform duration-200 shrink-0 ${
                              isSeasonMenuOpen ? 'rotate-180' : ''
                            }`}
                          />
                        </button>
                      </div>

                      {isSeasonMenuOpen && (
                        <div
                          ref={seasonMenuRef}
                          role="listbox"
                          aria-label="Temporadas disponíveis"
                          data-season-dropdown-menu="true"
                          data-focus-scope="modal"
                          className="absolute right-0 mt-1.5 min-w-[240px] sm:min-w-[270px] max-h-72 overflow-y-auto rounded-md bg-[#242424] border border-white/25 shadow-[0_16px_48px_rgba(0,0,0,0.92)] py-1.5 z-50 flex flex-col"
                        >
                          {sortedSeasons.map((seasonNum) => {
                            const isSelected =
                              effectiveSelectedGroup.kind === 'season' &&
                              effectiveSelectedGroup.seasonKey === seasonNum;
                            const epCount = Array.isArray(episodesBySeason[seasonNum])
                              ? episodesBySeason[seasonNum].length
                              : 0;
                            return (
                              <button
                                key={`season:${seasonNum}`}
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                data-season-group-kind="season"
                                data-season-option={seasonNum}
                                data-season-selected={isSelected ? 'true' : 'false'}
                                data-autofocus={isSelected ? 'true' : undefined}
                                onClick={() =>
                                  handleSelectGroup({ kind: 'season', seasonKey: seasonNum })
                                }
                                className={`w-full px-4 py-2.5 text-left text-sm sm:text-base flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                                  isSelected
                                    ? 'bg-white/15 text-white font-bold'
                                    : 'text-[#d4d4d4] hover:bg-white/10 hover:text-white font-medium'
                                }`}
                              >
                                <span>Temporada {seasonNum}</span>
                                <span className="text-xs sm:text-sm text-[#a3a3a3] font-normal shrink-0">
                                  ({epCount} {epCount === 1 ? 'episódio' : 'episódios'})
                                </span>
                              </button>
                            );
                          })}
                          {unseasonedEpisodes.length > 0 &&
                            (() => {
                              const isSelected = effectiveSelectedGroup.kind === 'unseasoned';
                              const epCount = unseasonedEpisodes.length;
                              return (
                                <button
                                  key={UNSEASONED_OPTION_VALUE}
                                  type="button"
                                  role="option"
                                  aria-selected={isSelected}
                                  data-season-group-kind="unseasoned"
                                  data-season-option={UNSEASONED_OPTION_VALUE}
                                  data-season-selected={isSelected ? 'true' : 'false'}
                                  data-autofocus={isSelected ? 'true' : undefined}
                                  onClick={() => handleSelectGroup({ kind: 'unseasoned' })}
                                  className={`w-full px-4 py-2.5 text-left text-sm sm:text-base flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                                    isSelected
                                      ? 'bg-white/15 text-white font-bold'
                                      : 'text-[#d4d4d4] hover:bg-white/10 hover:text-white font-medium'
                                  }`}
                                >
                                  <span>Sem temporada</span>
                                  <span className="text-xs sm:text-sm text-[#a3a3a3] font-normal shrink-0">
                                    ({epCount} {epCount === 1 ? 'episódio' : 'episódios'})
                                  </span>
                                </button>
                              );
                            })()}
                        </div>
                      )}
                    </div>
                  );
                })()}
            </div>

            {sortedSeasons.length > 0 || unseasonedEpisodes.length > 0 ? (
              <div
                data-nav-zone="episodes"
                className="nc-tv-episode-list flex flex-col divide-y divide-white/10"
              >
                {currentSeasonEpisodes.length > 0 ? (
                  currentSeasonEpisodes.map((episode: any, idx: number) => {
                    const epId = getEpisodeId(episode);
                    const epNum = episode.episode_num || idx + 1;
                    const epTitle = episode.title || `Episódio ${epNum}`;
                    const epRawImage =
                      episode.info?.movie_image ||
                      episode.info?.cover_big ||
                      episode.info?.episode_image ||
                      episode.movie_image ||
                      episode.cover ||
                      episode.stream_icon ||
                      '';
                    const epThumbUrl =
                      normalizeImageSource(epRawImage) ||
                      heroBackdropUrl ||
                      heroCoverUrl ||
                      '';
                    const epDurationInfo = formatEpisodeDuration(
                      episode.info?.duration || episode.duration,
                      episode.info?.duration_secs || episode.duration_secs
                    );
                    const epPlot =
                      [
                        episode.info?.plot,
                        episode.plot,
                        episode.info?.description,
                        episode.description,
                      ]
                        .find((v) => typeof v === 'string' && v.trim().length > 0)
                        ?.trim() || null;

                    const epProgressSec =
                      epId !== null
                        ? getItemProgress(credentials, 'episode', epId)
                        : 0;
                    const epSavedMinutes =
                      epProgressSec > 30 ? Math.max(1, Math.floor(epProgressSec / 60)) : 0;
                    const epProgressPercent: number | null =
                      epProgressSec > 30 &&
                      epDurationInfo.totalMinutes &&
                      epDurationInfo.totalMinutes > 0
                        ? Math.min(
                            95,
                            Math.max(
                              8,
                              Math.round(
                                (epProgressSec / (epDurationInfo.totalMinutes * 60)) * 100
                              )
                            )
                          )
                        : null;

                    return (
                      <div
                        key={epId !== null ? String(epId) : `ep-idx-${idx}`}
                        tabIndex={0}
                        role="button"
                        data-nav-item="true"
                        data-episode-id={epId !== null ? String(epId) : undefined}
                        data-episode-num={String(epNum)}
                        data-scroll-block="true"
                        aria-label={epTitle}
                        onClick={() =>
                          handlePlayEpisodeClick(
                            episode,
                            false,
                            effectiveSelectedGroup ?? undefined
                          )
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            handlePlayEpisodeClick(
                              episode,
                              false,
                              effectiveSelectedGroup ?? undefined
                            );
                          }
                        }}
                        className="nc-tv-episode-card group relative w-full rounded-xl p-3 sm:p-4 flex items-center gap-3.5 sm:gap-5 cursor-pointer border border-transparent hover:bg-white/[0.06] hover:border-white/15 focus:bg-white/[0.08] focus:border-white/80 focus:outline-none transition-colors select-none"
                      >
                        {/* 1. Episode Number */}
                        <div
                          data-episode-number="true"
                          className="w-6 sm:w-8 shrink-0 text-center text-base sm:text-xl font-bold text-[#bcbcbc] group-hover:text-white group-focus:text-white transition-colors"
                        >
                          {epNum}
                        </div>

                        {/* 2. 16:9 Horizontal Thumbnail + Play Overlay + Progress Bar */}
                        <div
                          data-episode-thumbnail="true"
                          className="relative w-28 sm:w-36 md:w-40 aspect-video shrink-0 rounded-md overflow-hidden bg-[#242424] border border-white/10"
                        >
                          {epThumbUrl ? (
                            <MediaImage
                              src={epThumbUrl}
                              serverUrl={credentials?.serverUrl}
                              alt={epTitle}
                              itemId={epId ?? undefined}
                              itemName={epTitle}
                              className="w-full h-full object-cover object-center"
                            />
                          ) : (
                            <div
                              data-episode-thumb-fallback="true"
                              className="w-full h-full bg-gradient-to-br from-[#2a2a2a] to-[#1a1a1a] flex items-center justify-center"
                            >
                              <Play className="w-6 h-6 text-white/40" />
                            </div>
                          )}

                          <div className="nc-tv-episode-icon absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity flex items-center justify-center">
                            <div className="nc-card-play-badge w-9 h-9 rounded-full bg-black/75 border border-white/80 text-white flex items-center justify-center shadow-lg">
                              <Play className="w-4 h-4 fill-current ml-0.5" />
                            </div>
                          </div>

                          {epProgressPercent !== null && (
                            <div
                              data-episode-progress-bar="true"
                              className="absolute inset-x-0 bottom-0 h-1 bg-white/30 overflow-hidden"
                            >
                              <div
                                className="h-full bg-[#E50914]"
                                style={{ width: `${epProgressPercent}%` }}
                              />
                            </div>
                          )}
                        </div>

                        {/* 3. Title + Duration + Episode Synopsis */}
                        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                          <div className="flex items-start justify-between gap-3 min-w-0">
                            <h4
                              data-episode-title="true"
                              className="text-white font-bold text-sm sm:text-base leading-snug line-clamp-2 break-words"
                            >
                              {epTitle}
                            </h4>
                            {epDurationInfo.text && (
                              <span
                                data-episode-duration="true"
                                className="text-xs sm:text-sm font-medium text-[#bcbcbc] shrink-0 pt-0.5"
                              >
                                {epDurationInfo.text}
                              </span>
                            )}
                          </div>

                          {epProgressSec > 30 && epProgressPercent === null && (
                            <span
                              data-episode-progress-minutes="true"
                              className="text-[11px] sm:text-xs font-semibold text-white/80"
                            >
                              {epSavedMinutes} min assistidos
                            </span>
                          )}

                          {epPlot && (
                            <p
                              data-episode-synopsis="true"
                              className="text-xs sm:text-sm text-[#a3a3a3] leading-relaxed line-clamp-2 sm:line-clamp-3 break-words"
                            >
                              {epPlot}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-center py-12 text-[#bcbcbc]">
                    Não há episódios disponíveis nesta temporada.
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-14 text-[#bcbcbc]">
                Não há episódios disponíveis.
              </div>
            )}
          </section>

          {/* Bottom Section: Sobre [nome da série] */}
          {hasAboutSection && (
            <section
              data-about-series-section="true"
              data-nav-row="true"
              data-scroll-block="true"
              className="pt-4 border-t border-white/10"
            >
              <div
                tabIndex={0}
                role="region"
                aria-label={`Sobre ${displayTitle}`}
                data-nav-item="true"
                data-about-series-focus="true"
                className="rounded-xl p-2 -m-2 transition-colors focus:outline-none"
              >
                <h2 className="text-lg sm:text-xl font-bold text-white mb-3 break-words">
                  Sobre <span className="font-extrabold">{displayTitle}</span>
                </h2>
                <div className="flex flex-col gap-2 text-xs sm:text-sm leading-relaxed">
                  {directorText && (
                    <div className="break-words">
                      <span className="text-[#777777]">Direção: </span>
                      <span className="text-white/90">{directorText}</span>
                    </div>
                  )}
                  {castText && (
                    <div className="break-words">
                      <span className="text-[#777777]">Elenco: </span>
                      <span className="text-white/90">{castText}</span>
                    </div>
                  )}
                  {genreText && (
                    <div className="break-words">
                      <span className="text-[#777777]">Gêneros: </span>
                      <span className="text-white/90">{genreText}</span>
                    </div>
                  )}
                  {releaseYear && (
                    <div>
                      <span className="text-[#777777]">Ano de lançamento: </span>
                      <span className="text-white/90">{releaseYear}</span>
                    </div>
                  )}
                  {seasonCountText && (
                    <div>
                      <span className="text-[#777777]">Temporadas: </span>
                      <span className="text-white/90">{seasonCountText}</span>
                    </div>
                  )}
                  {displayRating && (
                    <div>
                      <span className="text-[#777777]">Avaliação: </span>
                      <span className="text-white/90">★ {displayRating}</span>
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}
        </div>
      )}
    </DetailsModalShell>
  );
});
