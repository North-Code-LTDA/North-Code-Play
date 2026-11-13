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
import { XtreamService } from '../services/xtreamService';
import { useFavorites, FavoriteItem } from '../hooks/useFavorites';
import { VideoPlayer } from './VideoPlayer';
import { buildDirectMediaUrl, normalizeImageSource } from '../utils/mediaUtils';
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

function formatEpisodeDuration(
  rawDuration?: string | number | null,
  durationSecs?: number | string | null
): {
  text: string | null;
  totalMinutes: number | null;
} {
  const numericSecs =
    typeof durationSecs === 'number'
      ? durationSecs
      : typeof durationSecs === 'string' && /^\d+$/.test(durationSecs.trim())
        ? parseInt(durationSecs.trim(), 10)
        : 0;

  if (numericSecs > 0) {
    const totalMin = Math.max(1, Math.round(numericSecs / 60));
    const hours = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    return {
      text: hours > 0 ? (mins > 0 ? `${hours}h ${mins}min` : `${hours}h`) : `${totalMin}min`,
      totalMinutes: totalMin,
    };
  }

  if (rawDuration === undefined || rawDuration === null) {
    return { text: null, totalMinutes: null };
  }

  const trimmed = String(rawDuration).trim();
  if (!trimmed || trimmed === '0' || trimmed === '00:00:00' || trimmed === '00:00') {
    return { text: null, totalMinutes: null };
  }

  const hmsMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (hmsMatch) {
    const h = parseInt(hmsMatch[1], 10);
    const m = parseInt(hmsMatch[2], 10);
    const totalMin = h * 60 + m;
    if (totalMin <= 0) return { text: null, totalMinutes: null };
    return {
      text: h > 0 ? (m > 0 ? `${h}h ${m}min` : `${h}h`) : `${m}min`,
      totalMinutes: totalMin,
    };
  }

  if (/^\d+$/.test(trimmed)) {
    const totalMin = parseInt(trimmed, 10);
    if (totalMin <= 0) return { text: null, totalMinutes: null };
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return {
      text: h > 0 ? (m > 0 ? `${h}h ${m}min` : `${h}h`) : `${totalMin}min`,
      totalMinutes: totalMin,
    };
  }

  const minMatch = trimmed.match(/(\d+)\s*min/i);
  const hourMatch = trimmed.match(/(\d+)\s*h/i);
  if (hourMatch || minMatch) {
    const h = hourMatch ? parseInt(hourMatch[1], 10) : 0;
    const m = minMatch ? parseInt(minMatch[1], 10) : 0;
    const totalMin = h * 60 + m;
    return {
      text: trimmed,
      totalMinutes: totalMin > 0 ? totalMin : null,
    };
  }

  return { text: trimmed, totalMinutes: null };
}

function extractCleanYear(rawDate?: string | number | null): string | null {
  if (rawDate === undefined || rawDate === null) return null;
  const str = String(rawDate).trim();
  if (!str || str === '0') return null;
  const match = str.match(/\b(19\d{2}|20\d{2})\b/);
  return match ? match[1] : null;
}

function sortSeasonKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const aTrim = a.trim();
    const bTrim = b.trim();
    const aIsNum = /^\d+$/.test(aTrim);
    const bIsNum = /^\d+$/.test(bTrim);
    if (aIsNum && bIsNum) {
      return parseInt(aTrim, 10) - parseInt(bTrim, 10);
    }
    if (aIsNum) return -1;
    if (bIsNum) return 1;
    return aTrim.localeCompare(bTrim, undefined, { numeric: true, sensitivity: 'base' });
  });
}

function escapeSelectorValue(val: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(val);
  }
  return String(val).replace(/["\\]/g, '\\$&');
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
  const [seriesInfo, setSeriesInfo] = useState<any | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null);
  const [isSeasonMenuOpen, setIsSeasonMenuOpen] = useState(false);

  const [showResumeModal, setShowResumeModal] = useState(false);
  const [savedProgress, setSavedProgress] = useState(0);
  const [selectedEpisode, setSelectedEpisode] = useState<any>(null);
  const [playingEpisodeData, setPlayingEpisodeData] = useState<{
    url: string;
    title: string;
    startAt: number;
    episode: any;
  } | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const [failedEpisode, setFailedEpisode] = useState<{ episode: any; startAt: number } | null>(
    null
  );
  const [favActionError, setFavActionError] = useState<string | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const primaryPlayBtnRef = useRef<HTMLButtonElement | null>(null);
  const favoriteBtnRef = useRef<HTMLButtonElement | null>(null);
  const seasonTriggerBtnRef = useRef<HTMLButtonElement | null>(null);
  const seasonMenuRef = useRef<HTMLDivElement | null>(null);
  const resumeConfirmBtnRef = useRef<HTMLButtonElement | null>(null);
  const originFocusElementRef = useRef<HTMLElement | null>(null);
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
    const active =
      typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (active && active !== document.body && active !== document.documentElement) {
      originFocusElementRef.current = active;
    }
    pushFocusMemory(active);
  }, [seriesId]);

  const sortedSeasons = useMemo(() => {
    const rawEpisodes = seriesInfo?.episodes;
    if (!rawEpisodes || typeof rawEpisodes !== 'object') return [];
    const keys = Object.keys(rawEpisodes).filter((k) => Array.isArray(rawEpisodes[k]));
    return sortSeasonKeys(keys);
  }, [seriesInfo]);

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
      (selectedSeason
        ? seasonMenuRef.current.querySelector<HTMLElement>(
            `button[data-season-option="${escapeSelectorValue(selectedSeason)}"]`
          )
        : null) || seasonMenuRef.current.querySelector<HTMLElement>('button[data-season-option]');

    if (selectedOption) {
      try {
        selectedOption.focus({ preventScroll: true });
      } catch {
        selectedOption.focus();
      }
    }
  }, [isSeasonMenuOpen, selectedSeason]);

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

  // Ensure season changes never leave focus stranded on an unmounted episode node
  useEffect(() => {
    if (
      !selectedSeason ||
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
    selectedSeason,
    loadingInfo,
    playingEpisodeData,
    showResumeModal,
    playError,
    isSeasonMenuOpen,
  ]);

  const handleClose = useCallback(() => {
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
        setPlayError(null);
        restoreEpisodeFocus();
        return true;
      }
      if (showResumeModal) {
        setShowResumeModal(false);
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
    setIsSeasonMenuOpen(false);
    setShowResumeModal(false);
    setPlayError(null);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }

    async function fetchInfo() {
      if (!credentials) {
        if (!cancelled) setLoadingInfo(false);
        return;
      }
      try {
        setLoadingInfo(true);
        setErrorInfo(null);
        const info = await XtreamService.getSeriesInfo(credentials, seriesId);
        if (cancelled) return;
        if (!info || typeof info !== 'object') {
          setSeriesInfo(null);
          setErrorInfo('Não foi possível carregar os detalhes da série.');
          return;
        }
        setSeriesInfo(info);
        if (info.episodes && typeof info.episodes === 'object') {
          const seasons = sortSeasonKeys(
            Object.keys(info.episodes).filter((k) => Array.isArray(info.episodes[k]))
          );
          if (seasons.length > 0) {
            const firstWithEpisodes =
              seasons.find((s) => info.episodes[s] && info.episodes[s].length > 0) ||
              seasons[0];
            setSelectedSeason(firstWithEpisodes);
          } else {
            setSelectedSeason(null);
          }
        } else {
          setSelectedSeason(null);
        }
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        setSeriesInfo(null);
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
    };
  }, [credentials, seriesId]);

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
    () => extractCleanYear(info.releasedate || info.releaseDate || info.year),
    [info.releasedate, info.releaseDate, info.year]
  );

  const displayRating = useMemo(() => {
    const raw = info.rating;
    if (raw === undefined || raw === null) return null;
    const str = String(raw).trim();
    if (!str || str === '0' || str === '0.0') return null;
    return str;
  }, [info.rating]);

  const castText = useMemo(() => {
    const raw = info.cast || info.actors;
    return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
  }, [info.cast, info.actors]);

  const directorText = useMemo(() => {
    const raw = info.director;
    return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
  }, [info.director]);

  const genreText = useMemo(() => {
    const raw = info.genre;
    return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
  }, [info.genre]);

  const seasonCountText = useMemo(() => {
    if (sortedSeasons.length === 0) return null;
    return `${sortedSeasons.length} ${sortedSeasons.length === 1 ? 'temporada' : 'temporadas'}`;
  }, [sortedSeasons.length]);

  // Flatten all episodes in sorted season order to determine contextual primary CTA
  const allSeriesEpisodes = useMemo(() => {
    const entries: Array<{ seasonKey: string; episode: any; episodeIndex: number }> = [];
    if (!seriesInfo?.episodes) return entries;
    for (const sKey of sortedSeasons) {
      const list = seriesInfo.episodes[sKey];
      if (!Array.isArray(list)) continue;
      list.forEach((ep: any, idx: number) => {
        if (ep && typeof ep === 'object') {
          entries.push({ seasonKey: sKey, episode: ep, episodeIndex: idx });
        }
      });
    }
    return entries;
  }, [seriesInfo, sortedSeasons]);

  // Contextual Primary Episode Target (Continue in-progress episode vs Play first available episode)
  const primaryEpisodeTarget = useMemo(() => {
    if (allSeriesEpisodes.length === 0) return null;

    const byId = new Map<string, { seasonKey: string; episode: any; episodeIndex: number }>();
    for (const entry of allSeriesEpisodes) {
      if (entry.episode.id !== undefined && entry.episode.id !== null) {
        byId.set(String(entry.episode.id), entry);
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
        const progressPercent =
          durInfo.totalMinutes && durInfo.totalMinutes > 0
            ? Math.min(95, Math.max(6, Math.round((progressSec / (durInfo.totalMinutes * 60)) * 100)))
            : 35;

        return {
          mode: 'continue' as const,
          seasonKey: matched.seasonKey,
          episode: matched.episode,
          epNum,
          label: `Continuar T${matched.seasonKey}:E${epNum}`,
          progressSec,
          savedMinutes,
          totalMinutes: durInfo.totalMinutes,
          progressPercent,
        };
      }
    }

    // 2. Fallback scan via getItemProgress
    for (const entry of allSeriesEpisodes) {
      if (entry.episode.id === undefined || entry.episode.id === null) continue;
      const progressSec = getItemProgress(credentials, 'episode', entry.episode.id);
      if (progressSec > 30) {
        const epNum = entry.episode.episode_num || entry.episodeIndex + 1;
        const durInfo = formatEpisodeDuration(
          entry.episode.info?.duration || entry.episode.duration,
          entry.episode.info?.duration_secs || entry.episode.duration_secs
        );
        const savedMinutes = Math.max(1, Math.floor(progressSec / 60));
        const progressPercent =
          durInfo.totalMinutes && durInfo.totalMinutes > 0
            ? Math.min(95, Math.max(6, Math.round((progressSec / (durInfo.totalMinutes * 60)) * 100)))
            : 35;

        return {
          mode: 'continue' as const,
          seasonKey: entry.seasonKey,
          episode: entry.episode,
          epNum,
          label: `Continuar T${entry.seasonKey}:E${epNum}`,
          progressSec,
          savedMinutes,
          totalMinutes: durInfo.totalMinutes,
          progressPercent,
        };
      }
    }

    // 3. Default to the first available episode of the first valid season
    const first = allSeriesEpisodes[0];
    const firstEpNum = first.episode.episode_num || 1;
    return {
      mode: 'first' as const,
      seasonKey: first.seasonKey,
      episode: first.episode,
      epNum: firstEpNum,
      label: `Assistir T${first.seasonKey}:E${firstEpNum}`,
      progressSec: 0,
      savedMinutes: 0,
      totalMinutes: null,
      progressPercent: 0,
    };
  }, [allSeriesEpisodes, historyRecords, credentials]);

  const executePlay = (episode: any, startAt: number = 0, seasonOverride?: string) => {
    const activeSeasonForPlay = seasonOverride || selectedSeason || '1';
    if (episode?.id !== undefined && episode?.id !== null) {
      lastEpisodeIdRef.current = String(episode.id);
    }
    if (scrollContainerRef.current && !playingEpisodeData && !showResumeModal && !playError) {
      savedEpisodeScrollTopRef.current = scrollContainerRef.current.scrollTop;
    }

    recordPlaybackPosition(credentials, {
      id: episode.id,
      type: 'episode',
      parentSeriesId: seriesId,
      ...(startAt > 0 ? { positionSec: startAt } : {}),
    });

    if (startAt === 0) {
      clearItemProgress(credentials, 'episode', episode.id);
    }

    if (!credentials) return;
    try {
      setPlayError(null);
      setFailedEpisode(null);
      const ext = episode.container_extension || 'mp4';
      const mediaUrl = buildDirectMediaUrl(credentials, {
        type: 'series',
        streamId: episode.id,
        containerExtension: ext,
      });

      setPlayingEpisodeData({
        url: mediaUrl,
        title: `${displayTitle} - S${activeSeasonForPlay}E${episode.episode_num || episode.id}`,
        startAt,
        episode,
      });
      setShowResumeModal(false);
    } catch (err: any) {
      console.error('Erro ao iniciar episódio:', err);
      setPlayError(err?.message || 'Falha ao preparar a reprodução do episódio.');
      setFailedEpisode({ episode, startAt });
    }
  };

  const handleNextEpisode = () => {
    if (!selectedSeason || !seriesInfo?.episodes || !playingEpisodeData) return;
    const episodes = seriesInfo.episodes[selectedSeason];
    if (!Array.isArray(episodes)) return;
    const currentIndex = episodes.findIndex((e: any) => e.id === playingEpisodeData.episode.id);
    if (currentIndex !== -1 && currentIndex < episodes.length - 1) {
      executePlay(episodes[currentIndex + 1], 0, selectedSeason);
    }
  };

  const handlePreviousEpisode = () => {
    if (!selectedSeason || !seriesInfo?.episodes || !playingEpisodeData) return;
    const episodes = seriesInfo.episodes[selectedSeason];
    if (!Array.isArray(episodes)) return;
    const currentIndex = episodes.findIndex((e: any) => e.id === playingEpisodeData.episode.id);
    if (currentIndex > 0) {
      executePlay(episodes[currentIndex - 1], 0, selectedSeason);
    }
  };

  const handlePlayEpisodeClick = (
    episode: any,
    fromHeroCta: boolean = false,
    seasonOverride?: string
  ) => {
    lastTriggerWasHeroRef.current = fromHeroCta;
    if (episode?.id !== undefined && episode?.id !== null) {
      lastEpisodeIdRef.current = String(episode.id);
    }
    if (scrollContainerRef.current) {
      savedEpisodeScrollTopRef.current = scrollContainerRef.current.scrollTop;
    }
    if (seasonOverride && seasonOverride !== selectedSeason) {
      setSelectedSeason(seasonOverride);
    }
    const progress = getItemProgress(credentials, 'episode', episode.id);
    if (progress > 30) {
      setSavedProgress(progress);
      setSelectedEpisode(episode);
      setShowResumeModal(true);
    } else {
      executePlay(episode, 0, seasonOverride);
    }
  };

  const handlePrimaryHeroAction = () => {
    if (!primaryEpisodeTarget) return;
    if (primaryPlayBtnRef.current) {
      pushFocusMemory(primaryPlayBtnRef.current);
    }
    handlePlayEpisodeClick(
      primaryEpisodeTarget.episode,
      true,
      primaryEpisodeTarget.seasonKey
    );
  };

  const handleSelectSeason = (seasonNum: string) => {
    const preservedScrollTop = scrollContainerRef.current?.scrollTop ?? null;
    setSelectedSeason(seasonNum);
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

  const currentSeasonEpisodes: any[] = useMemo(() => {
    if (!selectedSeason || !seriesInfo?.episodes) return [];
    const list = seriesInfo.episodes[selectedSeason];
    return Array.isArray(list) ? list : [];
  }, [selectedSeason, seriesInfo]);

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
          className="absolute bottom-6 right-6 left-6 sm:left-auto sm:max-w-md z-[110] bg-red-600/95 text-white text-sm px-4 py-3 rounded-xl shadow-2xl border border-red-500/50 backdrop-blur-md flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-2"
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

      {showResumeModal && selectedEpisode && (
        <div
          data-focus-scope="modal"
          data-resume-modal="true"
          className="absolute inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="bg-[#181818] border border-white/15 rounded-2xl p-6 md:p-8 max-w-md w-full shadow-2xl flex flex-col items-center text-center animate-in zoom-in-95 duration-200">
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
                onClick={() => executePlay(selectedEpisode, savedProgress)}
                className="w-full py-3.5 bg-white hover:bg-white/90 text-black font-bold rounded-lg transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Play className="w-5 h-5 fill-current" /> Retomar de {savedMinutes} min
              </button>
              <button
                type="button"
                onClick={() => executePlay(selectedEpisode, 0)}
                className="w-full py-3.5 bg-[#2a2a2a] hover:bg-[#363636] text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 border border-white/15 cursor-pointer"
              >
                <RotateCcw className="w-5 h-5" /> Assistir do Início
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowResumeModal(false);
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
          <div className="bg-[#181818] border border-red-500/40 rounded-2xl p-6 md:p-8 max-w-md w-full shadow-2xl flex flex-col items-center text-center animate-in zoom-in-95 duration-200">
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
                    executePlay(failedEpisode.episode, failedEpisode.startAt)
                  }
                  className="flex-1 py-3 bg-white hover:bg-white/90 text-black font-bold rounded-lg transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4" /> Tentar Novamente
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setPlayError(null);
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

      <AnimatePresence>
        {playingEpisodeData &&
          (() => {
            let hasNext = false;
            let hasPrev = false;
            if (selectedSeason && seriesInfo?.episodes) {
              const episodes = seriesInfo.episodes[selectedSeason];
              if (Array.isArray(episodes)) {
                const currIdx = episodes.findIndex(
                  (e: any) => e.id === playingEpisodeData.episode.id
                );
                if (currIdx !== -1) {
                  if (currIdx < episodes.length - 1) hasNext = true;
                  if (currIdx > 0) hasPrev = true;
                }
              }
            }
            return (
              <VideoPlayer
                streamUrl={playingEpisodeData.url}
                title={playingEpisodeData.title}
                contentType="episode"
                startAt={playingEpisodeData.startAt}
                streamId={playingEpisodeData.episode.id}
                onBack={() => {
                  setPlayingEpisodeData(null);
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
        <div className="absolute inset-0 bg-gradient-to-t from-[#181818] via-[#181818]/45 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#181818]/85 via-[#181818]/25 to-transparent" />
        <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black/50 to-transparent pointer-events-none" />

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
              data-series-progress-bar="true"
              className="flex items-center gap-3 max-w-md w-full"
            >
              <div className="flex-1 h-1 bg-white/30 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#E50914] rounded-full"
                  style={{ width: `${primaryEpisodeTarget.progressPercent}%` }}
                />
              </div>
              <span className="text-xs sm:text-sm font-bold text-white/90 shrink-0 drop-shadow">
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
                    {info.plot || 'Sinopse não disponível.'}
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

              {sortedSeasons.length > 0 && selectedSeason && (
                <div
                  data-nav-row="true"
                  data-nav-season-row="true"
                  data-scroll-block="true"
                  className="relative"
                >
                  <button
                    ref={seasonTriggerBtnRef}
                    type="button"
                    aria-haspopup="listbox"
                    aria-expanded={isSeasonMenuOpen}
                    aria-label={`Selecionar temporada, atual Temporada ${selectedSeason}`}
                    data-season-dropdown-trigger="true"
                    data-season-selected="true"
                    onClick={() => setIsSeasonMenuOpen((prev) => !prev)}
                    className="nc-tv-season-btn min-w-[175px] sm:min-w-[210px] px-4 py-2.5 rounded-md bg-[#242424] hover:bg-[#2f2f2f] text-white font-semibold text-sm sm:text-base border border-white/25 flex items-center justify-between gap-3 transition-colors shadow-md cursor-pointer"
                  >
                    <span>Temporada {selectedSeason}</span>
                    <ChevronDown
                      className={`w-4 h-4 text-white/80 transition-transform duration-200 shrink-0 ${
                        isSeasonMenuOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

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
                        const isSelected = selectedSeason === seasonNum;
                        const epCount = Array.isArray(seriesInfo?.episodes?.[seasonNum])
                          ? seriesInfo.episodes[seasonNum].length
                          : 0;
                        return (
                          <button
                            key={seasonNum}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            data-season-option={seasonNum}
                            data-season-selected={isSelected ? 'true' : 'false'}
                            data-autofocus={isSelected ? 'true' : undefined}
                            onClick={() => handleSelectSeason(seasonNum)}
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
                    </div>
                  )}
                </div>
              )}
            </div>

            {sortedSeasons.length > 0 ? (
              <div
                data-nav-zone="episodes"
                className="nc-tv-episode-list flex flex-col divide-y divide-white/10"
              >
                {currentSeasonEpisodes.length > 0 ? (
                  currentSeasonEpisodes.map((episode: any, idx: number) => {
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
                      episode.id !== undefined && episode.id !== null
                        ? getItemProgress(credentials, 'episode', episode.id)
                        : 0;
                    const epProgressPercent =
                      epProgressSec > 30
                        ? epDurationInfo.totalMinutes && epDurationInfo.totalMinutes > 0
                          ? Math.min(
                              95,
                              Math.max(
                                8,
                                Math.round(
                                  (epProgressSec / (epDurationInfo.totalMinutes * 60)) * 100
                                )
                              )
                            )
                          : 40
                        : 0;

                    return (
                      <div
                        key={episode.id ?? idx}
                        tabIndex={0}
                        role="button"
                        data-nav-item="true"
                        data-episode-id={String(episode.id)}
                        data-episode-num={String(epNum)}
                        data-scroll-block="true"
                        aria-label={epTitle}
                        onClick={() => handlePlayEpisodeClick(episode, false)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            handlePlayEpisodeClick(episode, false);
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
                              itemId={episode.id}
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
                            <div className="w-9 h-9 rounded-full bg-black/75 border border-white/80 text-white flex items-center justify-center shadow-lg">
                              <Play className="w-4 h-4 fill-current ml-0.5" />
                            </div>
                          </div>

                          {epProgressSec > 30 && (
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
