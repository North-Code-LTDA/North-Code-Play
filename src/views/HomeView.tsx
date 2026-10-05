import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { useXtreamContext } from '../context/XtreamContext';
import { HeroBanner } from '../components/HeroBanner';
import { HorizontalRow } from '../components/HorizontalRow';
import { MovieDetails } from '../components/MovieDetails';
import { SeriesDetails } from '../components/SeriesDetails';
import { buildDirectMediaUrl } from '../utils/mediaUtils';
import { sortByYearAndRating } from '../utils/catalogRanking';

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
  searchQuery?: string;
}

export function HomeView({ onPlay, searchQuery = '' }: HomeViewProps) {
  const { 
    liveStreams, vodStreams, seriesStreams, 
    allLiveStreams, allVodStreams, allSeriesStreams,
    liveCategories, vodCategories, seriesCategories,
    loadingLive, loadingVod, loadingSeries, credentials,
    fetchLiveStreams, fetchVodStreams, fetchSeriesStreams
  } = useXtreamContext();

  const [selectedSeries, setSelectedSeries] = useState<any | null>(null);
  const [selectedMovie, setSelectedMovie] = useState<any | null>(null);
  const [displayCount, setDisplayCount] = useState({ live: 24, vod: 24, series: 24 });
  const [continueWatching, setContinueWatching] = useState<any[]>([]);
  const [homePlayError, setHomePlayError] = useState<string | null>(null);
  const [retryAction, setRetryAction] = useState<(() => void) | null>(null);

  // Continue Watching logic
  useEffect(() => {
    const combined = [...allVodStreams, ...allSeriesStreams];
    if (combined.length === 0) return;

    try {
      const watchedMap = new Map();
      
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('nc_progress_')) {
          const progressId = key.replace('nc_progress_', '');
          const value = Number(localStorage.getItem(key));
          
          if (value > 30) {
            const parentSeriesId = localStorage.getItem('nc_parent_series_' + progressId);
            const targetId = parentSeriesId ? parentSeriesId : progressId;

            const item = combined.find((c: any) => String(c.stream_id || c.series_id || c.id) === String(targetId));
            
            if (item) {
              const itemId = item.stream_id || item.series_id || item.id;
              const lastWatched = Number(localStorage.getItem('nc_last_watched_' + progressId)) || 0;

              if (!watchedMap.has(itemId) || watchedMap.get(itemId).lastWatched < lastWatched) {
                watchedMap.set(itemId, { item, lastWatched });
              }
            }
          }
        }
      }

      const sortedItems = Array.from(watchedMap.values())
        .sort((a, b) => b.lastWatched - a.lastWatched)
        .map(w => w.item);

      setContinueWatching(sortedItems);
    } catch (error) {
      console.warn('Error reading from localStorage for continue watching:', error);
    }
  }, [allVodStreams, allSeriesStreams]);

  // Auto-Fetch data in background if empty when landing on Dashboard
  useEffect(() => {
    if (credentials) {
      if (allLiveStreams.length === 0) fetchLiveStreams();
      if (allVodStreams.length === 0) fetchVodStreams();
      if (allSeriesStreams.length === 0) fetchSeriesStreams();
    }
  }, [credentials, allLiveStreams.length, allVodStreams.length, allSeriesStreams.length, fetchLiveStreams, fetchVodStreams, fetchSeriesStreams]);

  useEffect(() => {
    setDisplayCount({ live: 24, vod: 24, series: 24 });
  }, [searchQuery]);

  const isLoading = loadingLive || loadingVod || loadingSeries;

  // -- Destaques Live (Deterministic channels list preserving provider order) --
  const topLiveStreams = useMemo(() => {
    if (!allLiveStreams || allLiveStreams.length === 0) return [];
    const result: any[] = [];
    const seenIds = new Set<string | number>();

    for (const channel of allLiveStreams) {
      if (!channel) continue;
      const id = channel.stream_id || channel.id;
      const name = channel.name;
      if (id === null || id === undefined || id === '') continue;
      if (!name || typeof name !== 'string' || !name.trim()) continue;

      if (!seenIds.has(id)) {
        seenIds.add(id);
        result.push(channel);
      }
    }
    return result;
  }, [allLiveStreams]);

  // -- Ranking Universal --
  const recentMovies = useMemo(() => {
    return sortByYearAndRating(allVodStreams);
  }, [allVodStreams]);

  const recentSeries = useMemo(() => {
    return sortByYearAndRating(allSeriesStreams);
  }, [allSeriesStreams]);

  // -- Fileiras de Categorias Reais VOD & Series --
  const dynamicVodCategoryRows = useMemo(() => {
    if (searchQuery || !vodCategories || vodCategories.length === 0 || !allVodStreams || allVodStreams.length === 0) {
      return [];
    }

    const rows: { categoryId: string; title: string; items: any[] }[] = [];

    for (const cat of vodCategories) {
      if (!cat || !cat.category_id || !cat.category_name) continue;
      const catId = String(cat.category_id);
      
      const itemsInCat = allVodStreams.filter(m => String(m.category_id) === catId);
      if (itemsInCat.length > 0) {
        const sorted = sortByYearAndRating(itemsInCat);
        rows.push({
          categoryId: `vod_cat_${catId}`,
          title: `Filmes • ${cat.category_name}`,
          items: sorted,
        });
      }

      if (rows.length === 4) break;
    }

    return rows;
  }, [searchQuery, vodCategories, allVodStreams]);

  const dynamicSeriesCategoryRows = useMemo(() => {
    if (searchQuery || !seriesCategories || seriesCategories.length === 0 || !allSeriesStreams || allSeriesStreams.length === 0) {
      return [];
    }

    const rows: { categoryId: string; title: string; items: any[] }[] = [];

    for (const cat of seriesCategories) {
      if (!cat || !cat.category_id || !cat.category_name) continue;
      const catId = String(cat.category_id);
      
      const itemsInCat = allSeriesStreams.filter(s => String(s.category_id) === catId);
      if (itemsInCat.length > 0) {
        const sorted = sortByYearAndRating(itemsInCat);
        rows.push({
          categoryId: `series_cat_${catId}`,
          title: `Séries • ${cat.category_name}`,
          items: sorted,
        });
      }

      if (rows.length === 4) break;
    }

    return rows;
  }, [searchQuery, seriesCategories, allSeriesStreams]);

  // Search overrides
  const filteredLive = useMemo(() => {
    if (!searchQuery) return topLiveStreams;
    return allLiveStreams.filter(item => {
      const name = item?.name;
      return name && String(name).toLowerCase().includes(searchQuery.toLowerCase());
    });
  }, [topLiveStreams, allLiveStreams, searchQuery]);

  const filteredVod = useMemo(() => {
    if (!searchQuery) return recentMovies;
    return allVodStreams.filter(item => {
      const name = item?.name;
      return name && String(name).toLowerCase().includes(searchQuery.toLowerCase());
    });
  }, [recentMovies, allVodStreams, searchQuery]);

  const filteredSeries = useMemo(() => {
    if (!searchQuery) return recentSeries;
    return allSeriesStreams.filter(item => {
      const name = item?.name;
      return name && String(name).toLowerCase().includes(searchQuery.toLowerCase());
    });
  }, [recentSeries, allSeriesStreams, searchQuery]);

  const handlePlayLive = (stream: any) => {
    if (!credentials) return;
    try {
      setHomePlayError(null);
      setRetryAction(null);
      const url = buildDirectMediaUrl(credentials, {
        type: 'live',
        streamId: stream.stream_id,
        allowedOutputFormats: credentials.allowed_output_formats,
      });
      onPlay(url, stream.name, 0, stream.stream_id, 'live', stream.name);
    } catch (err: any) {
      console.error('Erro ao iniciar canal ao vivo:', err.message);
      setHomePlayError(err?.message || 'Falha ao iniciar transmissão ao vivo.');
      setRetryAction(() => () => handlePlayLive(stream));
    }
  };

  const handlePlayVod = (stream: any) => {
    if (!credentials) return;
    try {
      setHomePlayError(null);
      setRetryAction(null);
      const url = buildDirectMediaUrl(credentials, {
        type: 'movie',
        streamId: stream.stream_id,
        containerExtension: stream.container_extension || "mp4",
      });
      onPlay(url, stream.name, 0, stream.stream_id, 'movie');
    } catch (err: any) {
      console.error('Erro ao iniciar filme:', err.message);
      setHomePlayError(err?.message || 'Falha ao iniciar filme.');
      setRetryAction(() => () => handlePlayVod(stream));
    }
  };

  if (isLoading && allVodStreams.length === 0 && allSeriesStreams.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-screen">
        <Loader2 className="w-12 h-12 animate-spin text-nc-text-secondary" />
      </div>
    );
  }

  // Combine VOD and Series for Hero banner
  const contentForHero = [...allVodStreams, ...allSeriesStreams];

  return (
    <div className="flex flex-col w-full h-full overflow-y-auto overflow-x-hidden">
      <HeroBanner 
        items={contentForHero}
        onPlay={(item) => {
          if (item.stream_type === 'movie' || item.stream_id) {
            handlePlayVod(item);
          } else {
            setSelectedSeries(item);
          }
        }}
        onInfo={(item) => {
          if (item.stream_type === 'movie' || item.stream_id) {
            setSelectedMovie(item);
          } else {
            setSelectedSeries(item);
          }
        }}
      />

      <div className="px-6 md:px-12 pb-12 gap-8 flex flex-col relative z-20 mt-4 md:mt-8 lg:mt-16 xl:mt-24 shrink-0">
        {continueWatching.length > 0 && (
          <HorizontalRow 
             title="Continuar Assistindo"
             items={continueWatching}
             type="vod"
             onItemClick={(item) => {
               if (item.stream_type === 'movie' || item.stream_id) {
                 setSelectedMovie(item);
               } else {
                 setSelectedSeries(item);
               }
             }}
          />
        )}
        
        {filteredLive.length > 0 && (
          <HorizontalRow 
             title="Canais Ao Vivo"
             items={filteredLive.slice(0, displayCount.live)}
             type="live"
             onItemClick={handlePlayLive}
          />
        )}
        
        {filteredVod.length > 0 && (
          <HorizontalRow 
             title="Filmes em Destaque"
             items={filteredVod.slice(0, displayCount.vod)}
             type="vod"
             onItemClick={(item) => setSelectedMovie(item)}
          />
        )}
        
        {filteredSeries.length > 0 && (
          <HorizontalRow 
             title="Séries em Destaque"
             items={filteredSeries.slice(0, displayCount.series)}
             type="series"
             onItemClick={(item) => setSelectedSeries(item)}
          />
        )}

        {!searchQuery && dynamicVodCategoryRows.map((row) => (
          <HorizontalRow 
            key={row.categoryId}
            title={row.title}
            items={row.items.slice(0, displayCount.vod)}
            type="vod"
            onItemClick={(item) => setSelectedMovie(item)}
          />
        ))}

        {!searchQuery && dynamicSeriesCategoryRows.map((row) => (
          <HorizontalRow 
            key={row.categoryId}
            title={row.title}
            items={row.items.slice(0, displayCount.series)}
            type="series"
            onItemClick={(item) => setSelectedSeries(item)}
          />
        ))}
      </div>

      <AnimatePresence>
        {selectedMovie && (
          <MovieDetails 
            key="movie-details"
            streamId={selectedMovie.stream_id} 
            streamName={selectedMovie.name}
            streamIcon={selectedMovie.stream_icon}
            onClose={() => setSelectedMovie(null)} 
            onPlay={onPlay} 
          />
        )}
        {selectedSeries && (
          <SeriesDetails
            key="series-details"
            seriesId={selectedSeries.series_id || selectedSeries.id}
            seriesName={selectedSeries.name}
            seriesCover={selectedSeries.cover}
            onClose={() => setSelectedSeries(null)}
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
