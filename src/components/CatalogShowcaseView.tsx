import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
import { HeroBanner } from './HeroBanner';
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
} from '../navigation';

function isSeriesItem(item: any): boolean {
  if (!item || typeof item !== 'object') return false;
  return Boolean(item.series_id || item.stream_type === 'series' || item.type === 'series');
}

function extractReleaseYear(item: any): number | null {
  const year = getValidYear(item);
  return year > 0 ? year : null;
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

  const mainContainerRef = useRef<HTMLElement | null>(null);
  const gridContainerRef = useRef<HTMLDivElement | null>(null);
  const categoriesTriggerRef = useRef<HTMLButtonElement | null>(null);
  const categoriesMenuRef = useRef<HTMLDivElement | null>(null);

  const savedScrollTopRef = useRef<number | null>(null);
  const preSearchScrollTopRef = useRef<number | null>(null);
  const wasSearchingRef = useRef<boolean>(false);
  const lastOpenedGridKeyRef = useRef<string | null>(null);
  const lastShowcaseOriginRef = useRef<{
    rowContainer: HTMLElement | null;
    rowScrollLeft: number;
    virtualKey: string | null;
    virtualIndex: number | null;
    cardElement: HTMLElement | null;
  } | null>(null);

  // Keep latest values in refs for stable callbacks passed to memoized HeroBanner / HorizontalRow
  const credentialsRef = useRef(credentials);
  credentialsRef.current = credentials;
  const onPlayRef = useRef(onPlay);
  onPlayRef.current = onPlay;
  const onSelectLiveChannelRef = useRef(onSelectLiveChannel);
  onSelectLiveChannelRef.current = onSelectLiveChannel;
  const historyRecordsRef = useRef(historyRecords);
  historyRecordsRef.current = historyRecords;

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

  // Dynamic category rows for showcase
  const dynamicMovieRows = useMemo(() => {
    if (section === 'series' || allVodStreams.length === 0 || vodCategories.length === 0) {
      return EMPTY_ARRAY;
    }
    const maxRows = section === 'movies' ? 8 : 6;
    const rows: Array<{ id: string; title: string; items: any[] }> = [];
    for (const cat of vodCategories) {
      if (rows.length >= maxRows) break;
      const catId = String(cat.category_id);
      const rawInCat = vodIndex.getByCategory(catId);
      if (rawInCat.length >= 4) {
        rows.push({
          id: `vod_cat_${catId}`,
          title: cat.category_name,
          items: vodIndex.getSortedByCategory(catId).slice(0, 24),
        });
      }
    }
    return rows;
  }, [section, allVodStreams.length, vodCategories, vodIndex]);

  const dynamicSeriesRows = useMemo(() => {
    if (section === 'movies' || allSeriesStreams.length === 0 || seriesCategories.length === 0) {
      return EMPTY_ARRAY;
    }
    const maxRows = section === 'series' ? 8 : 6;
    const rows: Array<{ id: string; title: string; items: any[] }> = [];
    for (const cat of seriesCategories) {
      if (rows.length >= maxRows) break;
      const catId = String(cat.category_id);
      const rawInCat = seriesIndex.getByCategory(catId);
      if (rawInCat.length >= 4) {
        rows.push({
          id: `series_cat_${catId}`,
          title: cat.category_name,
          items: seriesIndex.getSortedByCategory(catId).slice(0, 24),
        });
      }
    }
    return rows;
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
    const cardEl = activeEl
      ? activeEl.closest<HTMLElement>('[data-nav-item="true"]') || activeEl
      : null;

    lastShowcaseOriginRef.current = {
      rowContainer: rowEl,
      rowScrollLeft: rowEl ? rowEl.scrollLeft : 0,
      virtualKey:
        cardEl?.getAttribute('data-virtual-key') ||
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
      if (mainContainerRef.current && savedScroll !== null) {
        mainContainerRef.current.scrollTop = savedScroll;
      }

      // If currently in virtualized grid mode, restore virtual grid card
      if (gridContainerRef.current && gridKey) {
        const safeKey =
          typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
            ? CSS.escape(gridKey)
            : gridKey.replace(/"/g, '\\"');
        const gridEl = gridContainerRef.current.querySelector<HTMLElement>(
          `[data-virtual-key="${safeKey}"]`
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
      const { rowContainer, rowScrollLeft, virtualKey, cardElement } = originSnapshot;

      if (rowContainer && rowContainer.isConnected) {
        rowContainer.scrollLeft = rowScrollLeft;
        if (rowContainer.getAttribute('data-virtual-container') === 'true' && virtualKey) {
          const restoredEl = restoreVirtualItemByKey(rowContainer, virtualKey, rowScrollLeft);
          if (restoredEl) {
            if (mainContainerRef.current && savedScroll !== null) {
              mainContainerRef.current.scrollTop = savedScroll;
            }
            return true;
          }
        }

        if (cardElement && cardElement.isConnected) {
          try {
            cardElement.focus({ preventScroll: true });
          } catch {
            cardElement.focus();
          }
          if (mainContainerRef.current && savedScroll !== null) {
            mainContainerRef.current.scrollTop = savedScroll;
          }
          rowContainer.scrollLeft = rowScrollLeft;
          return document.activeElement === cardElement;
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
  }, []);

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
    (item: any, detailsResponse?: any) => {
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

        const episodesMap = detailsResponse?.episodes || item?.episodes;
        if (latestEpisodeRecord && creds?.serverUrl && creds?.username && creds?.password) {
          let epExt = 'mp4';
          let epTitle = item.name || item.title || 'Episódio';
          if (episodesMap && typeof episodesMap === 'object') {
            for (const seasonKey of Object.keys(episodesMap)) {
              const seasonList = episodesMap[seasonKey];
              if (Array.isArray(seasonList)) {
                const foundEp = seasonList.find(
                  (ep: any) => String(ep.id ?? ep.stream_id) === String(latestEpisodeRecord.id)
                );
                if (foundEp) {
                  epExt = foundEp.container_extension || 'mp4';
                  const epNum = String(foundEp.episode_num || 1).padStart(2, '0');
                  const sNum = String(seasonKey).padStart(2, '0');
                  epTitle = `${item.name || item.title} - S${sNum}E${epNum} - ${foundEp.title || `Episódio ${foundEp.episode_num}`}`;
                  break;
                }
              }
            }
          }
          const directUrl = buildDirectMediaUrl(creds, {
            type: 'series',
            streamId: latestEpisodeRecord.id,
            containerExtension: epExt,
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

        if (episodesMap && typeof episodesMap === 'object' && creds?.serverUrl) {
          const seasons = Object.keys(episodesMap);
          if (seasons.length > 0) {
            const firstSeasonList = episodesMap[seasons[0]];
            if (Array.isArray(firstSeasonList) && firstSeasonList.length > 0) {
              const firstEp = firstSeasonList[0];
              const epId = firstEp.id ?? firstEp.stream_id;
              const epExt = firstEp.container_extension || 'mp4';
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
        return;
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

  // Search state
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const hasSearch = normalizedQuery.length > 0;

  // Preserve scrollTop across search open/close
  useEffect(() => {
    if (hasSearch && !wasSearchingRef.current) {
      wasSearchingRef.current = true;
      if (mainContainerRef.current) {
        preSearchScrollTopRef.current = mainContainerRef.current.scrollTop;
        mainContainerRef.current.scrollTop = 0;
      }
    } else if (!hasSearch && wasSearchingRef.current) {
      wasSearchingRef.current = false;
      const savedPreSearch = preSearchScrollTopRef.current;
      if (mainContainerRef.current && savedPreSearch !== null) {
        mainContainerRef.current.scrollTop = savedPreSearch;
      }
    }
  }, [hasSearch]);

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
  const isGridMode = section !== 'inicio' && (activeCategoryId !== null || hasSearch);
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

  // Compute showcase rows list with stable 0..N-1 rowIndex values
  const showcaseRows = useMemo(() => {
    const list: Array<{
      key: string;
      title: string;
      items: any[];
      type: 'vod' | 'series' | 'live';
      virtualize?: boolean;
      isContinueRow?: boolean;
    }> = [];

    if (continueWatchingItems.length > 0) {
      list.push({
        key: 'continue_watching',
        title: 'Continuar Assistindo',
        items: continueWatchingItems,
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
          items: liveHighlights,
          type: 'live',
        });
      }
      if (featuredMovies.length > 0) {
        list.push({
          key: 'featured_movies',
          title: 'Filmes em Destaque',
          items: featuredMovies,
          type: 'vod',
        });
      }
      if (featuredSeries.length > 0) {
        list.push({
          key: 'featured_series',
          title: 'Séries em Destaque',
          items: featuredSeries,
          type: 'series',
        });
      }
      for (const row of dynamicMovieRows) {
        if (row.items.length > 0) {
          list.push({
            key: row.id,
            title: row.title,
            items: row.items,
            type: 'vod',
          });
        }
      }
      for (const row of dynamicSeriesRows) {
        if (row.items.length > 0) {
          list.push({
            key: row.id,
            title: row.title,
            items: row.items,
            type: 'series',
          });
        }
      }
    } else if (section === 'movies') {
      if (domainFavoriteItems.length > 0) {
        list.push({
          key: 'favorite_movies',
          title: 'Filmes Favoritos',
          items: domainFavoriteItems,
          type: 'vod',
          virtualize: true,
        });
      }
      if (featuredMovies.length > 0) {
        list.push({
          key: 'featured_movies',
          title: 'Filmes em Destaque',
          items: featuredMovies,
          type: 'vod',
        });
      }
      for (const row of dynamicMovieRows) {
        if (row.items.length > 0) {
          list.push({
            key: row.id,
            title: row.title,
            items: row.items,
            type: 'vod',
          });
        }
      }
    } else if (section === 'series') {
      if (domainFavoriteItems.length > 0) {
        list.push({
          key: 'favorite_series',
          title: 'Séries Favoritas',
          items: domainFavoriteItems,
          type: 'series',
          virtualize: true,
        });
      }
      if (featuredSeries.length > 0) {
        list.push({
          key: 'featured_series',
          title: 'Séries em Destaque',
          items: featuredSeries,
          type: 'series',
        });
      }
      for (const row of dynamicSeriesRows) {
        if (row.items.length > 0) {
          list.push({
            key: row.id,
            title: row.title,
            items: row.items,
            type: 'series',
          });
        }
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
    dynamicMovieRows,
    dynamicSeriesRows,
  ]);

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

        {/* CASE 1: On-demand Search in 'Início' (multi-domain results) */}
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
              <div>
                <h3 className="nc-subsection-title font-semibold text-white mb-4 flex items-center gap-2">
                  <Radio className="w-5 h-5 text-red-500 shrink-0" />
                  <span>Canais Ao Vivo ({inicioSearchResults.live.length})</span>
                </h3>
                <div
                  data-nav-grid="true"
                  className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4"
                >
                  {inicioSearchResults.live.map((stream: any, idx: number) => (
                    <div
                      key={stream.stream_id || stream.id || `live_${idx}`}
                      tabIndex={0}
                      role="button"
                      aria-label={stream.name || stream.title || 'Canal ao vivo'}
                      data-nav-item="true"
                      onClick={() => handleLiveChannelClick(stream)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleLiveChannelClick(stream);
                        }
                      }}
                      className="group relative aspect-video bg-nc-bg-card rounded-xl overflow-hidden border border-nc-border hover:border-nc-primary/50 transition-all cursor-pointer flex flex-col justify-between p-3"
                    >
                      <div className="flex-1 flex items-center justify-center overflow-hidden p-2">
                        <MediaImage
                          src={stream.stream_icon}
                          serverUrl={credentials?.serverUrl}
                          alt={stream.name}
                          itemId={stream.stream_id || stream.id}
                          itemName={stream.name}
                          fallbackType="live"
                          className="max-h-full max-w-full object-contain group-hover:scale-110 transition-transform"
                        />
                      </div>
                      <div className="mt-2 text-center">
                        <h4 className="text-white nc-card-title line-clamp-2 group-hover:text-nc-primary transition-colors">
                          {stream.name}
                        </h4>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {inicioSearchResults.vod.length > 0 && (
              <div>
                <h3 className="nc-subsection-title font-semibold text-white mb-4 flex items-center gap-2">
                  <Film className="w-5 h-5 text-nc-primary shrink-0" />
                  <span>Filmes ({inicioSearchResults.vod.length})</span>
                </h3>
                <div
                  data-nav-grid="true"
                  className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4"
                >
                  {inicioSearchResults.vod.map((movie: any, idx: number) => (
                    <div
                      key={movie.stream_id || movie.id || `vod_${idx}`}
                      tabIndex={0}
                      role="button"
                      aria-label={movie.name || movie.title || 'Filme'}
                      data-nav-item="true"
                      onClick={(e) => handleSelectItem(movie, e.currentTarget)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleSelectItem(movie, e.currentTarget);
                        }
                      }}
                      className="group relative aspect-[2/3] bg-nc-bg-card rounded-xl overflow-hidden border border-nc-border hover:border-nc-primary/50 transition-all cursor-pointer flex flex-col justify-end"
                    >
                      <MediaImage
                        src={movie.stream_icon || movie.cover}
                        serverUrl={credentials?.serverUrl}
                        alt={movie.name}
                        itemId={movie.stream_id || movie.id}
                        itemName={movie.name}
                        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
                      <div className="relative z-10 p-3">
                        <h4 className="text-white nc-card-title line-clamp-2 group-hover:text-nc-primary transition-colors">
                          {movie.name}
                        </h4>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {inicioSearchResults.series.length > 0 && (
              <div>
                <h3 className="nc-subsection-title font-semibold text-white mb-4 flex items-center gap-2">
                  <Tv className="w-5 h-5 text-blue-500 shrink-0" />
                  <span>Séries ({inicioSearchResults.series.length})</span>
                </h3>
                <div
                  data-nav-grid="true"
                  className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4"
                >
                  {inicioSearchResults.series.map((s: any, idx: number) => (
                    <div
                      key={s.series_id || s.stream_id || s.id || `series_${idx}`}
                      tabIndex={0}
                      role="button"
                      aria-label={s.name || s.title || 'Série'}
                      data-nav-item="true"
                      onClick={(e) =>
                        handleSelectItem({ ...s, stream_type: 'series' }, e.currentTarget)
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleSelectItem({ ...s, stream_type: 'series' }, e.currentTarget);
                        }
                      }}
                      className="group relative aspect-[2/3] bg-nc-bg-card rounded-xl overflow-hidden border border-nc-border hover:border-nc-primary/50 transition-all cursor-pointer flex flex-col justify-end"
                    >
                      <MediaImage
                        src={s.cover || s.stream_icon}
                        serverUrl={credentials?.serverUrl}
                        alt={s.name}
                        itemId={s.series_id || s.stream_id || s.id}
                        itemName={s.name}
                        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
                      <div className="relative z-10 p-3">
                        <h4 className="text-white nc-card-title line-clamp-2 group-hover:text-nc-primary transition-colors">
                          {s.name}
                        </h4>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
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

            {isCatalogLoading && showcaseRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-nc-text-secondary">
                <Loader2 className="w-8 h-8 animate-spin text-nc-primary mb-4" />
                <p>Carregando catálogo...</p>
              </div>
            ) : showcaseRows.length === 0 ? (
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
              <div className="mt-2 sm:mt-4 px-4 sm:px-6 md:px-10 relative z-20 space-y-6">
                {showcaseRows.map((row, idx) => (
                  <div key={row.key} data-scroll-block="true">
                    <HorizontalRow
                      title={row.title}
                      items={row.items}
                      type={row.type}
                      rowIndex={idx}
                      virtualize={row.virtualize}
                      onItemClick={row.type === 'live' ? handleLiveChannelClick : handleSelectItem}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
});
