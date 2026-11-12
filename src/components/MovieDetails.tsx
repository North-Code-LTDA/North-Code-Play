import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import {
  Play,
  Heart,
  RotateCcw,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { useXtreamCredentials } from '../context/XtreamContext';
import { XtreamService } from '../services/xtreamService';
import { useFavorites } from '../hooks/useFavorites';
import {
  getItemProgress,
  recordPlaybackPosition,
  clearItemProgress,
} from '../utils/playbackHistory';
import { buildDirectMediaUrl, normalizeImageSource } from '../utils/mediaUtils';
import { MediaImage } from './MediaImage';
import { DetailsModalShell } from './DetailsModalShell';
import {
  useBackHandler,
  BACK_PRIORITY,
  getNavMode,
  focusElementSafely,
  pushFocusMemory,
  popFocusMemory,
} from '../navigation';

export interface MovieDetailsProps {
  streamId: number | string;
  streamName: string;
  streamIcon: string;
  categoryId?: string | number;
  categoryName?: string;
  rating?: string | number;
  year?: string | number;
  containerExtension?: string;
  catalogMovies?: any[];
  onSelectSimilarMovie?: (movie: any) => void;
  onClose: () => void;
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
}

interface ActiveMovieSnapshot {
  streamId: number | string;
  streamName: string;
  streamIcon: string;
  categoryId?: string | number;
  categoryName?: string;
  rating?: string | number;
  year?: string | number;
  containerExtension?: string;
}

function formatMovieDuration(rawDuration?: string | number, durationSecs?: number | string): {
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

  // Format HH:MM:SS or HH:MM
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

  // Pure number (minutes)
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

function extractCleanYear(rawDate?: string | number | null, fallbackYear?: string | number | null): string | null {
  for (const candidate of [rawDate, fallbackYear]) {
    if (candidate === undefined || candidate === null) continue;
    const str = String(candidate).trim();
    if (!str || str === '0') continue;
    const match = str.match(/\b(19\d{2}|20\d{2})\b/);
    if (match) return match[1];
  }
  return null;
}

export const MovieDetails = React.memo(function MovieDetails({
  streamId,
  streamName,
  streamIcon,
  categoryId,
  categoryName,
  rating,
  year,
  containerExtension,
  catalogMovies,
  onSelectSimilarMovie,
  onClose,
  onPlay,
}: MovieDetailsProps) {
  const { credentials } = useXtreamCredentials();
  const { isFavorite, toggleFavorite, clearFavoriteError } = useFavorites();

  // Internal override state when switching movies via "Títulos semelhantes" in standalone mode
  const [internalMovie, setInternalMovie] = useState<ActiveMovieSnapshot | null>(null);

  useEffect(() => {
    setInternalMovie(null);
  }, [streamId]);

  const activeMovie: ActiveMovieSnapshot = internalMovie || {
    streamId,
    streamName,
    streamIcon,
    categoryId,
    categoryName,
    rating,
    year,
    containerExtension,
  };

  const activeStreamId = activeMovie.streamId;
  const activeStreamName = activeMovie.streamName;
  const activeStreamIcon = activeMovie.streamIcon;
  const activeCategoryId = activeMovie.categoryId;
  const activeCategoryName = activeMovie.categoryName;
  const activeRatingProp = activeMovie.rating;
  const activeYearProp = activeMovie.year;
  const activeContainerExtProp = activeMovie.containerExtension;

  const [details, setDetails] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [favActionError, setFavActionError] = useState<string | null>(null);
  const [savedProgress, setSavedProgress] = useState<number>(0);
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);
  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : 1280
  );

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const primaryPlayBtnRef = useRef<HTMLButtonElement | null>(null);
  const resumeConfirmBtnRef = useRef<HTMLButtonElement | null>(null);

  const favorited = isFavorite(activeStreamId, 'movie');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => {
      if (window.innerWidth > 0) {
        setViewportWidth(window.innerWidth);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Sub-modal Back handler (Resume Confirmation)
  useBackHandler(
    'movie-details-resume-modal',
    BACK_PRIORITY.SUB_MODAL,
    () => {
      if (showResumePrompt) {
        setShowResumePrompt(false);
        setTimeout(() => {
          if (!popFocusMemory() && primaryPlayBtnRef.current) {
            focusElementSafely(primaryPlayBtnRef.current);
          }
        }, 0);
        return true;
      }
      return false;
    },
    showResumePrompt
  );

  // Main MovieDetails Back handler
  useBackHandler(
    'movie-details-view',
    BACK_PRIORITY.DETAILS_MODAL,
    () => {
      onClose();
      return true;
    },
    true
  );

  useEffect(() => {
    if (showResumePrompt && resumeConfirmBtnRef.current) {
      focusElementSafely(resumeConfirmBtnRef.current);
    }
  }, [showResumePrompt]);

  // Autofocus primary action when details finish loading
  useEffect(() => {
    if (!loading && primaryPlayBtnRef.current) {
      if (getNavMode() !== 'pointer') {
        focusElementSafely(primaryPlayBtnRef.current);
      } else {
        try {
          primaryPlayBtnRef.current.focus({ preventScroll: true });
        } catch {}
      }
    }
  }, [loading, activeStreamId]);

  useEffect(() => {
    if (favActionError) {
      const timer = setTimeout(() => {
        setFavActionError(null);
        clearFavoriteError();
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [favActionError, clearFavoriteError]);

  const handleToggleFavorite = () => {
    const info = details?.info || {};
    const coverImage = normalizeImageSource(
      info.movie_image || info.cover_big || activeStreamIcon
    );
    const success = toggleFavorite({
      id: activeStreamId,
      type: 'movie',
      name: info.name || activeStreamName,
      cover: coverImage,
    });
    if (!success) {
      setFavActionError(
        'Não foi possível salvar os favoritos neste dispositivo. Tente novamente.'
      );
    } else {
      setFavActionError(null);
    }
  };

  useEffect(() => {
    const progress = getItemProgress(credentials, 'movie', activeStreamId);
    setSavedProgress(progress);
  }, [credentials, activeStreamId]);

  useEffect(() => {
    let cancelled = false;

    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
    setShowResumePrompt(false);
    setPlayError(null);

    const fetchInfo = async () => {
      if (!credentials) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        setLoading(true);
        setError(null);
        const data = await XtreamService.getVodInfo(credentials, activeStreamId);
        if (cancelled) return;
        setDetails(data);
      } catch (err: any) {
        if (cancelled) return;
        console.error('Error fetching movie details:', err);
        setError('Não foi possível carregar os detalhes do filme.');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchInfo();
    return () => {
      cancelled = true;
    };
  }, [credentials, activeStreamId]);

  const info = details?.info || {};
  const movieData = details?.movie_data || {};

  const displayTitle = info.name || movieData.name || activeStreamName || 'Filme';
  const titleId = `movie-details-title-${activeStreamId}`;

  // Resolve primary backdrop / hero image
  const heroImageUrl = useMemo(() => {
    const rawBackdrop = Array.isArray(info.backdrop_path)
      ? info.backdrop_path.find((b: any) => typeof b === 'string' && b.trim().length > 0)
      : typeof info.backdrop_path === 'string' && info.backdrop_path.trim().length > 0
        ? info.backdrop_path
        : '';
    return normalizeImageSource(
      rawBackdrop || info.cover_big || info.movie_image || activeStreamIcon
    );
  }, [info.backdrop_path, info.cover_big, info.movie_image, activeStreamIcon]);

  // Real metadata fields (never fabricate unavailable fields)
  const releaseYear = useMemo(
    () =>
      extractCleanYear(
        info.releasedate || info.releaseDate || info.year,
        activeYearProp
      ),
    [info.releasedate, info.releaseDate, info.year, activeYearProp]
  );

  const { text: durationText, totalMinutes: totalDurationMinutes } = useMemo(
    () => formatMovieDuration(info.duration, info.duration_secs),
    [info.duration, info.duration_secs]
  );

  const displayRating = useMemo(() => {
    const raw = info.rating ?? activeRatingProp;
    if (raw === undefined || raw === null) return null;
    const str = String(raw).trim();
    if (!str || str === '0' || str === '0.0') return null;
    return str;
  }, [info.rating, activeRatingProp]);

  const castText = useMemo(() => {
    const raw = info.cast || info.actors;
    return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
  }, [info.cast, info.actors]);

  const directorText = useMemo(() => {
    const raw = info.director;
    return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
  }, [info.director]);

  const genreText = useMemo(() => {
    if (typeof info.genre === 'string' && info.genre.trim().length > 0) {
      return info.genre.trim();
    }
    if (
      typeof activeCategoryName === 'string' &&
      activeCategoryName.trim().length > 0 &&
      activeCategoryName.trim().toLowerCase() !== 'filme' &&
      activeCategoryName.trim().toLowerCase() !== 'filmes'
    ) {
      return activeCategoryName.trim();
    }
    return null;
  }, [info.genre, activeCategoryName]);

  // Deterministic "Títulos semelhantes" from already-loaded catalog
  const similarMovies = useMemo(() => {
    if (!Array.isArray(catalogMovies) || catalogMovies.length === 0) {
      return [];
    }

    const currentIdStr = String(activeStreamId);
    const currentTitleNorm = displayTitle.trim().toLowerCase();
    const targetCatId =
      activeCategoryId !== undefined && activeCategoryId !== null && String(activeCategoryId) !== ''
        ? String(activeCategoryId)
        : movieData?.category_id !== undefined && movieData?.category_id !== null
          ? String(movieData.category_id)
          : null;

    const genreTokens = (genreText || '')
      .toLowerCase()
      .split(/[,/|·•-]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 3);

    const seenIds = new Set<string>([currentIdStr]);
    const seenTitles = new Set<string>(currentTitleNorm ? [currentTitleNorm] : []);
    const sameCategoryMatches: any[] = [];
    const genreMatches: any[] = [];

    for (const item of catalogMovies) {
      if (!item || typeof item !== 'object') continue;
      // Exclude series or live items if mixed pool
      if (item.series_id || item.stream_type === 'series' || item.type === 'series') continue;

      const candId = item.stream_id ?? item.id;
      if (candId === undefined || candId === null) continue;
      const candIdStr = String(candId);
      if (seenIds.has(candIdStr)) continue;

      const candTitle = String(item.name || item.title || '').trim();
      const candTitleNorm = candTitle.toLowerCase();
      if (!candTitle || seenTitles.has(candTitleNorm)) continue;

      const candCatId =
        item.category_id !== undefined && item.category_id !== null
          ? String(item.category_id)
          : null;

      if (targetCatId && candCatId === targetCatId) {
        seenIds.add(candIdStr);
        seenTitles.add(candTitleNorm);
        sameCategoryMatches.push(item);
        if (sameCategoryMatches.length >= 9) break;
        continue;
      }

      if (genreTokens.length > 0 && sameCategoryMatches.length + genreMatches.length < 18) {
        const candGenreStr = String(item.genre || item.category_name || '').toLowerCase();
        if (candGenreStr && genreTokens.some((tok) => candGenreStr.includes(tok))) {
          seenIds.add(candIdStr);
          seenTitles.add(candTitleNorm);
          genreMatches.push(item);
        }
      }
    }

    return [...sameCategoryMatches, ...genreMatches].slice(0, 9);
  }, [
    catalogMovies,
    activeStreamId,
    displayTitle,
    activeCategoryId,
    movieData?.category_id,
    genreText,
  ]);

  const similarGridCols = viewportWidth < 640 ? 2 : 3;

  const hasAboutSection = Boolean(
    directorText || castText || genreText || releaseYear || durationText || displayRating
  );

  const handleSelectSimilar = useCallback(
    (movie: any) => {
      if (!movie) return;
      const nextId = movie.stream_id ?? movie.id;
      if (nextId === undefined || nextId === null) return;

      const nextIcon = normalizeImageSource(
        movie.stream_icon || movie.cover || movie.image || ''
      );

      if (onSelectSimilarMovie) {
        onSelectSimilarMovie(movie);
      } else {
        setInternalMovie({
          streamId: nextId,
          streamName: movie.name || movie.title || 'Filme',
          streamIcon: nextIcon,
          categoryId: movie.category_id,
          categoryName: movie.category_name,
          rating: movie.rating,
          year: movie.year,
          containerExtension: movie.container_extension,
        });
      }
    },
    [onSelectSimilarMovie]
  );

  const startPlayback = (startAt: number) => {
    if (!credentials) return;
    setShowResumePrompt(false);

    if (startAt === 0) {
      clearItemProgress(credentials, 'movie', activeStreamId);
      setSavedProgress(0);
    }

    const containerExt =
      movieData?.container_extension ||
      info?.container_extension ||
      activeContainerExtProp ||
      'mp4';

    recordPlaybackPosition(credentials, {
      id: activeStreamId,
      type: 'movie',
      positionSec: startAt,
    });

    try {
      setPlayError(null);
      const url = buildDirectMediaUrl(credentials, {
        type: 'movie',
        streamId: activeStreamId,
        containerExtension: containerExt,
      });
      onPlay(url, displayTitle, startAt, activeStreamId, 'movie');
    } catch (err: any) {
      console.error('Erro ao construir URL de filme:', err.message);
      setPlayError(err?.message || 'Falha ao iniciar reprodução do filme.');
    }
  };

  const handlePrimaryPlayClick = () => {
    if (!credentials) return;
    if (primaryPlayBtnRef.current) {
      pushFocusMemory(primaryPlayBtnRef.current);
    }
    if (savedProgress > 30) {
      setShowResumePrompt(true);
    } else {
      startPlayback(0);
    }
  };

  const savedMinutes = Math.max(1, Math.floor(savedProgress / 60));
  const progressPercent = useMemo(() => {
    if (savedProgress <= 30) return 0;
    if (totalDurationMinutes && totalDurationMinutes > 0) {
      return Math.min(95, Math.max(6, Math.round((savedProgress / (totalDurationMinutes * 60)) * 100)));
    }
    return 35;
  }, [savedProgress, totalDurationMinutes]);

  const overlaySlot = (
    <>
      {favActionError && (
        <div
          role="alert"
          className="absolute bottom-6 right-6 left-6 sm:left-auto sm:max-w-md z-[90] bg-red-600/95 text-white text-sm px-4 py-3 rounded-xl shadow-2xl border border-red-500/50 backdrop-blur-md flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2"
        >
          <AlertCircle className="w-5 h-5 text-white shrink-0" />
          <span>{favActionError}</span>
        </div>
      )}

      {playError && (
        <div
          role="alert"
          className="absolute top-16 right-6 left-6 sm:left-auto sm:max-w-md z-[90] bg-red-500/15 border border-red-500/40 rounded-xl p-4 flex items-center gap-3 text-red-200 text-sm backdrop-blur-md shadow-xl"
        >
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
          <span>{playError}</span>
        </div>
      )}

      {/* Sub-modal de Confirmação de Retomada */}
      {showResumePrompt && (
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
              Você parou em{' '}
              <span className="text-white font-semibold">{savedMinutes} min</span>. Deseja
              retomar de onde parou ou começar do início?
            </p>
            <div className="flex flex-col gap-3 w-full">
              <button
                ref={resumeConfirmBtnRef}
                type="button"
                data-autofocus="true"
                onClick={() => startPlayback(savedProgress)}
                className="w-full py-3.5 bg-white hover:bg-white/90 text-black font-bold rounded-lg transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Play className="w-5 h-5 fill-current" /> Retomar de {savedMinutes} min
              </button>
              <button
                type="button"
                onClick={() => startPlayback(0)}
                className="w-full py-3.5 bg-[#2a2a2a] hover:bg-[#363636] text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 border border-white/15 cursor-pointer"
              >
                <RotateCcw className="w-5 h-5" /> Assistir do Início
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowResumePrompt(false);
                  setTimeout(() => {
                    if (!popFocusMemory() && primaryPlayBtnRef.current) {
                      focusElementSafely(primaryPlayBtnRef.current);
                    }
                  }, 0);
                }}
                className="w-full py-2.5 text-[#bcbcbc] hover:text-white text-sm font-medium transition-colors mt-1 cursor-pointer"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  const headerRegion =
    !loading && !error ? (
      <div
        data-movie-hero-region="true"
        data-scroll-top-anchor="true"
        className="nc-tv-movie-hero relative w-full aspect-video min-h-[220px] sm:min-h-[320px] md:min-h-[400px] max-h-[460px] bg-[#141414] overflow-hidden flex flex-col justify-end"
      >
        {heroImageUrl ? (
          <MediaImage
            src={heroImageUrl}
            serverUrl={credentials?.serverUrl}
            alt={displayTitle}
            itemId={activeStreamId}
            itemName={displayTitle}
            priority={true}
            className="absolute inset-0 w-full h-full object-cover object-center opacity-85"
          />
        ) : (
          <div
            data-movie-hero-fallback="true"
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

          {savedProgress > 30 && (
            <div
              data-movie-progress-bar="true"
              className="flex items-center gap-3 max-w-md w-full"
            >
              <div className="flex-1 h-1 bg-white/30 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#E50914] rounded-full"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <span className="text-xs sm:text-sm font-bold text-white/90 shrink-0 drop-shadow">
                {totalDurationMinutes
                  ? `${savedMinutes} de ${totalDurationMinutes}min`
                  : `${savedMinutes} min assistidos`}
              </span>
            </div>
          )}

          <div
            data-nav-row="true"
            data-scroll-block="true"
            data-scroll-top-anchor="true"
            className="flex flex-wrap items-center gap-3 pt-1"
          >
            <button
              ref={primaryPlayBtnRef}
              type="button"
              data-autofocus="true"
              data-movie-primary-cta="true"
              onClick={handlePrimaryPlayClick}
              className="nc-tv-details-action px-6 sm:px-8 py-2.5 sm:py-3 bg-white hover:bg-white/90 text-black font-bold rounded-md flex items-center justify-center gap-2.5 transition-all shadow-lg cursor-pointer"
            >
              <Play className="w-5 h-5 fill-current text-black shrink-0" />
              <span>{savedProgress > 30 ? 'Continuar' : 'Assistir'}</span>
            </button>

            <button
              type="button"
              onClick={handleToggleFavorite}
              aria-label="Favoritar"
              data-movie-favorite-btn="true"
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
      modalType="movie"
      onClose={onClose}
      scrollContainerRef={scrollContainerRef}
      headerRegion={headerRegion}
      overlaySlot={overlaySlot}
    >
      {loading ? (
        <div className="flex flex-col items-center justify-center min-h-[360px] py-20 px-6 text-[#bcbcbc]">
          <h1 id={titleId} className="sr-only">
            {displayTitle}
          </h1>
          <Loader2 className="w-10 h-10 animate-spin text-white mb-4" />
          <p className="text-sm sm:text-base">Carregando informações do filme...</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center min-h-[360px] py-16 px-6 text-center">
          <AlertCircle className="w-14 h-14 text-red-500 mb-4" />
          <h1 id={titleId} className="text-xl sm:text-2xl font-bold text-white mb-2">
            Ops, algo deu errado
          </h1>
          <p className="text-[#bcbcbc] max-w-md mb-6">{error}</p>
          <div data-nav-row="true" className="flex flex-wrap items-center justify-center gap-3">
            <button
              ref={primaryPlayBtnRef}
              type="button"
              data-autofocus="true"
              onClick={() => startPlayback(savedProgress > 30 ? savedProgress : 0)}
              className="px-6 py-3 bg-white hover:bg-white/90 text-black font-bold rounded-md transition-colors flex items-center gap-2 cursor-pointer"
            >
              <Play className="w-5 h-5 fill-current" /> Reproduzir mesmo assim
            </button>
            <button
              type="button"
              onClick={onClose}
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
            data-movie-main-columns="true"
            className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 items-start"
          >
            {/* Left Column: Technical Metadata Line + Full Synopsis */}
            <div className="md:col-span-2 flex flex-col gap-3.5 min-w-0">
              {(releaseYear || durationText || displayRating || genreText) && (
                <div
                  data-movie-meta-line="true"
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm sm:text-base font-medium text-[#bcbcbc]"
                >
                  {releaseYear && (
                    <span data-movie-year="true" className="text-white/90 font-semibold">
                      {releaseYear}
                    </span>
                  )}
                  {durationText && (
                    <span data-movie-duration="true">{durationText}</span>
                  )}
                  {displayRating && (
                    <span
                      data-movie-rating="true"
                      className="text-yellow-400 font-semibold flex items-center gap-1"
                    >
                      ★ {displayRating}
                    </span>
                  )}
                  {!releaseYear && !durationText && !displayRating && genreText && (
                    <span>{genreText}</span>
                  )}
                </div>
              )}

              <div data-nav-row="true" data-scroll-block="true">
                <div
                  role="region"
                  aria-label="Sinopse do filme"
                  data-synopsis-focus="true"
                  data-nav-item="true"
                  tabIndex={0}
                  className="nc-tv-movie-synopsis rounded-lg p-1.5 -m-1.5 transition-colors focus:outline-none"
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
                data-movie-side-credits="true"
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

          {/* Section: Títulos semelhantes (only rendered when real related movies exist) */}
          {similarMovies.length > 0 && (
            <section
              data-similar-movies-section="true"
              className="pt-2 border-t border-white/10"
            >
              <h2 className="text-lg sm:text-xl font-bold text-white mb-4">
                Títulos semelhantes
              </h2>
              <div
                data-nav-grid="true"
                data-similar-movies-grid="true"
                data-grid-cols={similarGridCols}
                data-scroll-block="true"
                className="grid grid-cols-2 sm:grid-cols-3 gap-3.5 sm:gap-4"
              >
                {similarMovies.map((simItem: any, idx: number) => {
                  const simId = simItem.stream_id ?? simItem.id ?? idx;
                  const simTitle = simItem.name || simItem.title || 'Filme';
                  const simImage = normalizeImageSource(
                    simItem.stream_icon || simItem.cover || simItem.image || ''
                  );
                  const simYear = extractCleanYear(
                    simItem.year || simItem.releasedate || simItem.releaseDate,
                    simItem._precomputedYear
                  );
                  const simRating =
                    simItem.rating &&
                    String(simItem.rating).trim() !== '0' &&
                    String(simItem.rating).trim() !== '0.0'
                      ? String(simItem.rating).trim()
                      : null;

                  return (
                    <div
                      key={String(simId)}
                      tabIndex={0}
                      role="button"
                      aria-label={simTitle}
                      data-nav-item="true"
                      data-similar-movie-card="true"
                      data-similar-movie-id={String(simId)}
                      data-similar-index={idx}
                      onClick={() => handleSelectSimilar(simItem)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          handleSelectSimilar(simItem);
                        }
                      }}
                      className="nc-showcase-card group relative z-0 hover:z-20 focus:z-20 focus-visible:z-20 rounded-lg overflow-visible cursor-pointer select-none flex flex-col"
                    >
                      <div
                        data-card-visual="true"
                        className="nc-card-visual-layer w-full h-full rounded-lg overflow-hidden bg-[#2f2f2f] border border-white/10 flex flex-col"
                      >
                        <div className="relative w-full aspect-video bg-[#1f1f1f] overflow-hidden shrink-0">
                          <MediaImage
                            src={simImage}
                            serverUrl={credentials?.serverUrl}
                            alt={simTitle}
                            itemId={simId}
                            itemName={simTitle}
                            className="w-full h-full object-cover object-center"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-[#2f2f2f] via-transparent to-black/30" />
                          <div className="absolute inset-0 bg-black/35 opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity flex items-center justify-center">
                            <div className="w-10 h-10 rounded-full bg-white/90 text-black flex items-center justify-center shadow-lg">
                              <Play className="w-5 h-5 fill-current ml-0.5" />
                            </div>
                          </div>
                        </div>

                        <div className="p-3 flex-1 flex flex-col justify-between gap-2 bg-[#2f2f2f]">
                          <h3 className="text-xs sm:text-sm font-bold text-white line-clamp-2 break-words">
                            {simTitle}
                          </h3>
                          {(simYear || simRating) && (
                            <div className="flex items-center justify-between gap-2 text-xs text-[#bcbcbc]">
                              {simYear ? (
                                <span className="font-medium text-white/80">{simYear}</span>
                              ) : (
                                <span />
                              )}
                              {simRating && (
                                <span className="text-yellow-400 font-semibold">
                                  ★ {simRating}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Bottom Section: Sobre [nome do filme] */}
          {hasAboutSection && (
            <section
              data-about-movie-section="true"
              data-nav-row="true"
              data-scroll-block="true"
              className="pt-4 border-t border-white/10"
            >
              <div
                tabIndex={0}
                role="region"
                aria-label={`Sobre ${displayTitle}`}
                data-nav-item="true"
                data-about-movie-focus="true"
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
                  {durationText && (
                    <div>
                      <span className="text-[#777777]">Duração: </span>
                      <span className="text-white/90">{durationText}</span>
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
