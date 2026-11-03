import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { AnimatePresence } from 'motion/react';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { useXtreamContext } from '../context/XtreamContext';
import { HeroBanner } from '../components/HeroBanner';
import { HorizontalRow } from '../components/HorizontalRow';
import { MovieDetails } from '../components/MovieDetails';
import { SeriesDetails } from '../components/SeriesDetails';
import { buildDirectMediaUrl } from '../utils/mediaUtils';
import { sortByYearAndRating } from '../utils/catalogRanking';
import {
  getOrCreateVodIndex,
  getOrCreateSeriesIndex,
  getHeroBannerItems,
} from '../utils/catalogIndex';
import { useAccountPlaybackHistory, recordPlaybackPosition } from '../utils/playbackHistory';
import { formatCategoryLabel } from '../utils/categoryLabel';
import { restoreVirtualItemByKey } from '../navigation';
export { formatCategoryLabel };

const displayCount = { live: 24, vod: 24, series: 24 };

interface HomeViewProps {
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
  searchQuery?: string;
  isPaused?: boolean;
}

export function HomeView({ onPlay, onSelectLiveChannel, searchQuery = '', isPaused = false }: HomeViewProps) {
  const { 
    allLiveStreams, allVodStreams, allSeriesStreams,
    liveCategories, vodCategories, seriesCategories,
    credentials,
    sessionReady,
    liveCatalogStatus, vodCatalogStatus, seriesCatalogStatus,
    liveCategoriesError, vodCategoriesError, seriesCategoriesError,
    liveError, vodError, seriesError,
    fetchLiveStreams, fetchVodStreams, fetchSeriesStreams,
    fetchLiveCategories, fetchVodCategories, fetchSeriesCategories,
  } = useXtreamContext();

  const [selectedSeries, setSelectedSeries] = useState<any | null>(null);
  const [selectedMovie, setSelectedMovie] = useState<any | null>(null);
  const [homePlayError, setHomePlayError] = useState<string | null>(null);
  const [retryAction, setRetryAction] = useState<(() => void) | null>(null);

  const historyRecords = useAccountPlaybackHistory(credentials);
  const vodIndex = useMemo(() => getOrCreateVodIndex(allVodStreams), [allVodStreams]);
  const seriesIndex = useMemo(() => getOrCreateSeriesIndex(allSeriesStreams), [allSeriesStreams]);

  // Continue Watching logic using O(1) indexed lookup by id
  const continueWatching = useMemo(() => {
    if (allVodStreams.length === 0 && allSeriesStreams.length === 0) return [];

    const validRecords = historyRecords.filter(
      (r) => (r.type === 'movie' || r.type === 'episode') && (r.positionSec ?? 0) > 30
    );

    const result: any[] = [];
    const seenKeys = new Set<string>();

    for (const record of validRecords) {
      if (record.type === 'movie') {
        const item = vodIndex.getById(record.id);
        if (item) {
          const itemId = item.stream_id || item.id;
          const rowKey = `movie_${itemId}`;
          if (!seenKeys.has(rowKey)) {
            seenKeys.add(rowKey);
            result.push({ ...item, rowKey });
          }
        }
      } else if (record.type === 'episode') {
        if (!record.parentSeriesId) continue;
        const item = seriesIndex.getById(record.parentSeriesId);
        if (item) {
          const itemId = item.series_id || item.id;
          const rowKey = `series_${itemId}`;
          if (!seenKeys.has(rowKey)) {
            seenKeys.add(rowKey);
            result.push({ ...item, rowKey });
          }
        }
      }
    }

    return result;
  }, [historyRecords, allVodStreams.length, allSeriesStreams.length, vodIndex, seriesIndex]);

  // Request catalog operations ONLY when the session is ready and status is idle.
  useEffect(() => {
    if (credentials && sessionReady) {
      if (liveCatalogStatus === 'idle') {
        fetchLiveStreams().catch(() => {});
      }
      if (vodCatalogStatus === 'idle') {
        fetchVodStreams().catch(() => {});
      }
      if (seriesCatalogStatus === 'idle') {
        fetchSeriesStreams().catch(() => {});
      }
    }
  }, [
    credentials,
    sessionReady,
    liveCatalogStatus,
    vodCatalogStatus,
    seriesCatalogStatus,
    fetchLiveStreams,
    fetchVodStreams,
    fetchSeriesStreams,
  ]);

  // Filter content based on search query using cached sorted catalog index when searchQuery is empty
  const filteredLive = useMemo(() => {
    if (!searchQuery) return allLiveStreams;
    const q = searchQuery.toLowerCase();
    return allLiveStreams.filter(s => s.name?.toLowerCase().includes(q));
  }, [allLiveStreams, searchQuery]);

  const filteredVod = useMemo(() => {
    if (!searchQuery) {
      return vodIndex.getSortedAll();
    }
    const q = searchQuery.toLowerCase();
    return sortByYearAndRating(
      allVodStreams.filter(s => s.name?.toLowerCase().includes(q))
    );
  }, [allVodStreams, vodIndex, searchQuery]);

  const filteredSeries = useMemo(() => {
    if (!searchQuery) {
      return seriesIndex.getSortedAll();
    }
    const q = searchQuery.toLowerCase();
    return sortByYearAndRating(
      allSeriesStreams.filter(s => s.name?.toLowerCase().includes(q))
    );
  }, [allSeriesStreams, seriesIndex, searchQuery]);

  // Dynamic category rows for Movies (limit to 4 categories with at least 4 items) via pre-indexed categories
  const dynamicVodCategoryRows = useMemo(() => {
    if (allVodStreams.length === 0 || vodCategories.length === 0) return [];
    
    const excludedIds = new Set(['all', 'favorites', 'recent']);
    const candidateCategories = vodCategories.filter(
      (cat) => !excludedIds.has(String(cat.category_id))
    );

    const rows: { categoryId: string; title: string; items: any[] }[] = [];

    for (const cat of candidateCategories) {
      const catId = String(cat.category_id);
      const rawInCat = vodIndex.getByCategory(catId);

      if (rawInCat.length >= 4) {
        rows.push({
          categoryId: catId,
          title: `Filmes: ${formatCategoryLabel(cat.category_name)}`,
          items: vodIndex.getSortedByCategory(catId).slice(0, displayCount.vod),
        });
      }

      if (rows.length >= 4) break;
    }

    return rows;
  }, [allVodStreams.length, vodCategories, vodIndex]);

  // Dynamic category rows for Series (limit to 3 categories with at least 4 items) via pre-indexed categories
  const dynamicSeriesCategoryRows = useMemo(() => {
    if (allSeriesStreams.length === 0 || seriesCategories.length === 0) return [];

    const excludedIds = new Set(['all', 'favorites', 'recent']);
    const candidateCategories = seriesCategories.filter(
      (cat) => !excludedIds.has(String(cat.category_id))
    );

    const rows: { categoryId: string; title: string; items: any[] }[] = [];

    for (const cat of candidateCategories) {
      const catId = String(cat.category_id);
      const rawInCat = seriesIndex.getByCategory(catId);

      if (rawInCat.length >= 4) {
        rows.push({
          categoryId: catId,
          title: `Séries: ${formatCategoryLabel(cat.category_name)}`,
          items: seriesIndex.getSortedByCategory(catId).slice(0, displayCount.series),
        });
      }

      if (rows.length >= 3) break;
    }

    return rows;
  }, [allSeriesStreams.length, seriesCategories, seriesIndex]);

  const handlePlayLive = useCallback((stream: any) => {
    if (!credentials) return;
    if (onSelectLiveChannel) {
      onSelectLiveChannel(stream);
      return;
    }
    try {
      const streamId = stream?.stream_id ?? stream?.id;
      const url = buildDirectMediaUrl(credentials, {
        type: 'live',
        streamId,
        allowedOutputFormats: credentials?.allowed_output_formats,
      });
      onPlay(url, stream.name, 0, streamId, 'live', stream.name, stream.epg_title || stream.name);
    } catch (err: any) {
      console.error('Erro ao iniciar canal ao vivo:', err.message);
      setHomePlayError(err?.message || 'Falha ao iniciar canal.');
      setRetryAction(() => () => handlePlayLive(stream));
    }
  }, [credentials, onSelectLiveChannel, onPlay]);

  const handlePlayVod = useCallback((stream: any) => {
    if (!credentials) return;
    try {
      const url = buildDirectMediaUrl(credentials, {
        type: 'movie',
        streamId: stream.stream_id,
        containerExtension: stream.container_extension || 'mp4',
      });
      recordPlaybackPosition(credentials, {
        id: stream.stream_id,
        type: 'movie',
      });
      onPlay(url, stream.name, 0, stream.stream_id, 'movie');
    } catch (err: any) {
      console.error('Erro ao iniciar filme:', err.message);
      setHomePlayError(err?.message || 'Falha ao iniciar filme.');
      setRetryAction(() => () => handlePlayVod(stream));
    }
  }, [credentials, onPlay]);

  // Precomputed HeroBanner items (reused across renders without re-concatenating or re-sorting 27k items)
  const contentForHero = useMemo(
    () => getHeroBannerItems(allVodStreams, allSeriesStreams),
    [allVodStreams, allSeriesStreams]
  );

  const handleHeroPlay = useCallback(
    (item: any) => {
      if (item.stream_type === 'movie' || item.stream_id) {
        handlePlayVod(item);
      } else {
        setSelectedSeries(item);
      }
    },
    [handlePlayVod]
  );

  const handleHeroInfo = useCallback((item: any) => {
    continueWatchingOriginRef.current = null;
    if (item.stream_type === 'movie' || item.stream_id) {
      setSelectedMovie(item);
    } else {
      setSelectedSeries(item);
    }
  }, []);

  const continueWatchingOriginRef = React.useRef<{
    itemKey: string;
    scrollLeft: number;
  } | null>(null);

  const handleContinueWatchingClick = useCallback((item: any) => {
    const itemKey = String(
      item?.rowKey ?? item?.stream_id ?? item?.series_id ?? item?.id ?? ''
    );
    const cwRowEl =
      typeof document !== 'undefined'
        ? (document.querySelector(
            '[data-nav-row="true"][data-virtual-container="true"]'
          ) as HTMLElement | null)
        : null;
    if (itemKey) {
      continueWatchingOriginRef.current = {
        itemKey,
        scrollLeft: cwRowEl ? cwRowEl.scrollLeft || 0 : 0,
      };
    }

    if (typeof item.rowKey === 'string' && item.rowKey.startsWith('series_')) {
      setSelectedSeries(item);
    } else if (typeof item.rowKey === 'string' && item.rowKey.startsWith('movie_')) {
      setSelectedMovie(item);
    } else if (item.stream_type === 'movie' || (item.stream_id && !item.series_id)) {
      setSelectedMovie(item);
    } else {
      setSelectedSeries(item);
    }
  }, []);

  const restoreContinueWatchingOrigin = useCallback(() => {
    const origin = continueWatchingOriginRef.current;
    if (!origin) return;
    const cwRowEl =
      typeof document !== 'undefined'
        ? (document.querySelector(
            '[data-nav-row="true"][data-virtual-container="true"]'
          ) as HTMLElement | null)
        : null;
    if (!cwRowEl) return;
    restoreVirtualItemByKey(cwRowEl, origin.itemKey, origin.scrollLeft);
  }, []);

  useEffect(() => {
    if (!selectedMovie && !selectedSeries && !isPaused && continueWatchingOriginRef.current) {
      const origin = continueWatchingOriginRef.current;
      continueWatchingOriginRef.current = null;
      const cwRowEl =
        typeof document !== 'undefined'
          ? (document.querySelector(
              '[data-nav-row="true"][data-virtual-container="true"]'
            ) as HTMLElement | null)
          : null;
      if (cwRowEl) {
        restoreVirtualItemByKey(cwRowEl, origin.itemKey, origin.scrollLeft);
      }
    }
  }, [selectedMovie, selectedSeries, isPaused]);

  const [homeScrollContainerEl, setHomeScrollContainerEl] = useState<HTMLDivElement | null>(null);
  const topLiveRowItems = useMemo(() => filteredLive.slice(0, displayCount.live), [filteredLive]);
  const topVodRowItems = useMemo(() => filteredVod.slice(0, displayCount.vod), [filteredVod]);
  const topSeriesRowItems = useMemo(() => filteredSeries.slice(0, displayCount.series), [filteredSeries]);

  let nextRowIndex = 0;

  return (
    <div
      ref={setHomeScrollContainerEl}
      data-nav-zone="content"
      data-scroll-container="true"
      className="flex flex-col w-full h-full overflow-y-auto overflow-x-hidden"
    >
      <div data-scroll-top-anchor="true" className="w-full shrink-0">
        <HeroBanner 
          items={contentForHero}
          isPaused={Boolean(isPaused || selectedMovie || selectedSeries)}
          onPlay={handleHeroPlay}
          onInfo={handleHeroInfo}
        />
      </div>

      <div className="px-6 md:px-12 pb-12 gap-8 flex flex-col relative z-20 mt-4 md:mt-8 lg:mt-16 xl:mt-24 shrink-0">
        {/* Continue Watching Row */}
        {continueWatching.length > 0 && (
          <div data-scroll-block="true" className="w-full">
            <HorizontalRow 
               title="Continuar Assistindo"
               items={continueWatching}
               type="vod"
               rowIndex={nextRowIndex++}
               scrollContainer={homeScrollContainerEl}
               onItemClick={handleContinueWatchingClick}
               virtualize={true}
            />
          </div>
        )}

        {/* Specific Category Error Banners */}
        {liveCategoriesError && liveCategories.length === 0 && (
          <div className="w-full p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 text-red-400">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>Falha ao carregar categorias de TV: {liveCategoriesError}</span>
            </div>
            <button
              onClick={() => { fetchLiveCategories().catch(() => {}); }}
              className="px-3 py-1.5 bg-nc-bg-card hover:bg-nc-bg-input text-white rounded-lg flex items-center gap-1.5 transition-colors border border-nc-border/50 text-xs font-medium shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Tentar novamente
            </button>
          </div>
        )}

        {vodCategoriesError && vodCategories.length === 0 && (
          <div className="w-full p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 text-red-400">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>Falha ao carregar categorias de filmes: {vodCategoriesError}</span>
            </div>
            <button
              onClick={() => { fetchVodCategories().catch(() => {}); }}
              className="px-3 py-1.5 bg-nc-bg-card hover:bg-nc-bg-input text-white rounded-lg flex items-center gap-1.5 transition-colors border border-nc-border/50 text-xs font-medium shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Tentar novamente
            </button>
          </div>
        )}

        {seriesCategoriesError && seriesCategories.length === 0 && (
          <div className="w-full p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 text-red-400">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>Falha ao carregar categorias de séries: {seriesCategoriesError}</span>
            </div>
            <button
              onClick={() => { fetchSeriesCategories().catch(() => {}); }}
              className="px-3 py-1.5 bg-nc-bg-card hover:bg-nc-bg-input text-white rounded-lg flex items-center gap-1.5 transition-colors border border-nc-border/50 text-xs font-medium shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Tentar novamente
            </button>
          </div>
        )}
        
        {/* Live TV Section: Discrete loading, Error with Retry, or Content */}
        {(liveCatalogStatus === 'loading' || (credentials && liveCatalogStatus === 'idle')) && allLiveStreams.length === 0 && (
          <div className="w-full flex flex-col gap-3 py-2" role="status" aria-label="Carregando canais ao vivo">
            <div className="flex items-center gap-2 text-nc-text-secondary text-sm px-2">
              <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none text-nc-primary" />
              <span>Carregando canais ao vivo...</span>
            </div>
            <div className="flex gap-4 overflow-hidden px-2 opacity-30">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="w-32 sm:w-44 h-24 sm:h-28 rounded-xl bg-white/[0.04] border border-nc-border/40 animate-pulse motion-reduce:animate-none shrink-0" />
              ))}
            </div>
          </div>
        )}

        {liveCatalogStatus === 'error' && allLiveStreams.length === 0 && (
          <div className="w-full p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 text-red-400">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>Falha ao carregar canais ao vivo: {liveError}</span>
            </div>
            <button
              onClick={() => { fetchLiveStreams().catch(() => {}); }}
              className="px-3 py-1.5 bg-nc-bg-card hover:bg-nc-bg-input text-white rounded-lg flex items-center gap-1.5 transition-colors border border-nc-border/50 text-xs font-medium shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Tentar novamente
            </button>
          </div>
        )}

        {filteredLive.length > 0 && (
          <div data-scroll-block="true" className="w-full">
            <HorizontalRow 
               title="Canais Ao Vivo"
               items={topLiveRowItems}
               type="live"
               rowIndex={nextRowIndex++}
               scrollContainer={homeScrollContainerEl}
               onItemClick={handlePlayLive}
            />
          </div>
        )}
        
        {/* Movies Section: Discrete loading, Error with Retry, or Content */}
        {(vodCatalogStatus === 'loading' || (credentials && vodCatalogStatus === 'idle')) && allVodStreams.length === 0 && (
          <div className="w-full flex flex-col gap-3 py-2" role="status" aria-label="Carregando filmes em destaque">
            <div className="flex items-center gap-2 text-nc-text-secondary text-sm px-2">
              <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none text-nc-primary" />
              <span>Carregando filmes em destaque...</span>
            </div>
            <div className="flex gap-4 overflow-hidden px-2 opacity-30">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="w-28 sm:w-36 aspect-[2/3] rounded-xl bg-white/[0.04] border border-nc-border/40 animate-pulse motion-reduce:animate-none shrink-0" />
              ))}
            </div>
          </div>
        )}

        {vodCatalogStatus === 'error' && allVodStreams.length === 0 && (
          <div className="w-full p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 text-red-400">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>Falha ao carregar filmes: {vodError}</span>
            </div>
            <button
              onClick={() => { fetchVodStreams().catch(() => {}); }}
              className="px-3 py-1.5 bg-nc-bg-card hover:bg-nc-bg-input text-white rounded-lg flex items-center gap-1.5 transition-colors border border-nc-border/50 text-xs font-medium shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Tentar novamente
            </button>
          </div>
        )}

        {filteredVod.length > 0 && (
          <div data-scroll-block="true" className="w-full">
            <HorizontalRow 
               title="Filmes em Destaque"
               items={topVodRowItems}
               type="vod"
               rowIndex={nextRowIndex++}
               scrollContainer={homeScrollContainerEl}
               onItemClick={setSelectedMovie}
            />
          </div>
        )}
        
        {/* Series Section: Discrete loading, Error with Retry, or Content */}
        {(seriesCatalogStatus === 'loading' || (credentials && seriesCatalogStatus === 'idle')) && allSeriesStreams.length === 0 && (
          <div className="w-full flex flex-col gap-3 py-2" role="status" aria-label="Carregando séries em destaque">
            <div className="flex items-center gap-2 text-nc-text-secondary text-sm px-2">
              <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none text-nc-primary" />
              <span>Carregando séries em destaque...</span>
            </div>
            <div className="flex gap-4 overflow-hidden px-2 opacity-30">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="w-28 sm:w-36 aspect-[2/3] rounded-xl bg-white/[0.04] border border-nc-border/40 animate-pulse motion-reduce:animate-none shrink-0" />
              ))}
            </div>
          </div>
        )}

        {seriesCatalogStatus === 'error' && allSeriesStreams.length === 0 && (
          <div className="w-full p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 text-red-400">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>Falha ao carregar séries: {seriesError}</span>
            </div>
            <button
              onClick={() => { fetchSeriesStreams().catch(() => {}); }}
              className="px-3 py-1.5 bg-nc-bg-card hover:bg-nc-bg-input text-white rounded-lg flex items-center gap-1.5 transition-colors border border-nc-border/50 text-xs font-medium shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Tentar novamente
            </button>
          </div>
        )}

        {filteredSeries.length > 0 && (
          <div data-scroll-block="true" className="w-full">
            <HorizontalRow 
               title="Séries em Destaque"
               items={topSeriesRowItems}
               type="series"
               rowIndex={nextRowIndex++}
               scrollContainer={homeScrollContainerEl}
               onItemClick={setSelectedSeries}
            />
          </div>
        )}

        {/* Dynamic Category Rows */}
        {!searchQuery && dynamicVodCategoryRows.map((row) => (
          <div key={row.categoryId} data-scroll-block="true" className="w-full">
            <HorizontalRow 
              title={row.title}
              items={row.items}
              type="vod"
              rowIndex={nextRowIndex++}
              scrollContainer={homeScrollContainerEl}
              onItemClick={setSelectedMovie}
            />
          </div>
        ))}

        {!searchQuery && dynamicSeriesCategoryRows.map((row) => (
          <div key={row.categoryId} data-scroll-block="true" className="w-full">
            <HorizontalRow 
              title={row.title}
              items={row.items}
              type="series"
              rowIndex={nextRowIndex++}
              scrollContainer={homeScrollContainerEl}
              onItemClick={setSelectedSeries}
            />
          </div>
        ))}
      </div>

      <AnimatePresence>
        {selectedMovie && (
          <MovieDetails 
            key="movie-details"
            streamId={selectedMovie.stream_id} 
            streamName={selectedMovie.name}
            streamIcon={selectedMovie.stream_icon}
            onClose={() => {
              setSelectedMovie(null);
              restoreContinueWatchingOrigin();
            }} 
            onPlay={onPlay} 
          />
        )}
        {selectedSeries && (
          <SeriesDetails
            key="series-details"
            seriesId={selectedSeries.series_id || selectedSeries.id}
            seriesName={selectedSeries.name}
            seriesCover={selectedSeries.cover}
            onClose={() => {
              setSelectedSeries(null);
              restoreContinueWatchingOrigin();
            }} 
            onPlay={onPlay} 
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {homePlayError && (
          <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-nc-bg border border-red-500/40 rounded-2xl p-6 md:p-8 max-w-md w-full shadow-2xl flex flex-col items-center text-center animate-in zoom-in-95 duration-300">
              <div className="w-14 h-14 rounded-full bg-red-500/20 flex items-center justify-center mb-4">
                <AlertCircle className="w-7 h-7 text-red-500" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Erro de Reprodução</h3>
              <p className="text-red-400 text-sm mb-4 leading-relaxed">{homePlayError}</p>
              <div className="flex gap-3 w-full">
                {retryAction && (
                  <button
                    onClick={() => {
                      const act = retryAction;
                      setHomePlayError(null);
                      act();
                    }}
                    className="flex-1 py-3 bg-nc-primary text-black font-semibold rounded-xl transition-all hover:brightness-110 flex items-center justify-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" /> Tentar Novamente
                  </button>
                )}
                <button
                  onClick={() => setHomePlayError(null)}
                  className="flex-1 py-3 bg-nc-bg-card hover:bg-nc-bg-input text-white font-medium rounded-xl transition-colors border border-nc-border/50"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
