import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2 } from 'lucide-react';
import { useXtreamContext } from '../context/XtreamContext';
import { HeroBanner } from '../components/HeroBanner';
import { HorizontalRow } from '../components/HorizontalRow';
import { MovieDetails } from '../components/MovieDetails';
import { SeriesDetails } from '../components/SeriesDetails';
import { getMediaStreamUrl } from '../utils/mediaUtils';

interface HomeViewProps {
  onPlay: (url: string, title: string, startAt?: number, streamId?: string | number) => void;
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

              // Se o item ainda não está no Map OU se encontramos um episódio mais recente dessa mesma série, atualizamos
              if (!watchedMap.has(itemId) || watchedMap.get(itemId).lastWatched < lastWatched) {
                watchedMap.set(itemId, { item, lastWatched });
              }
            }
          }
        }
      }

      // Extrai os valores do Map, ordena cronologicamente (decrescente) e mapeia apenas os itens
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

  // -- Helper for sorting by Year and Rating --
  const getValidYear = (item: any) => {
    let year = Number(item.year);
    if (!isNaN(year) && year >= 1950 && year <= 2026) {
      return year;
    }
    if (item.name) {
      const match = String(item.name).match(/\b(19[5-9]\d|20[0-2][0-6])\b/);
      if (match) {
        return Number(match[0]);
      }
    }
    return 0;
  };

  const getValidRating = (item: any) => {
    if (item.rating === null || item.rating === undefined || item.rating === '') return 0;
    const rating = parseFloat(item.rating);
    return isNaN(rating) ? 0 : rating;
  };

  const sortByYearAndRating = (streams: any[]) => {
    const validStreams = streams.filter(item => getValidYear(item) > 0 || getValidRating(item) > 0);
    return validStreams.sort((a, b) => {
      const aYear = getValidYear(a);
      const bYear = getValidYear(b);
      if (aYear !== bYear) return bYear - aYear;
      
      const aRating = getValidRating(a);
      const bRating = getValidRating(b);
      return bRating - aRating;
    });
  };

  // -- Destaques Live (Deduplicated VIP Channels) --
  const topKeywords = ['globo sp', 'sbt sp', 'record sp', 'telecine', 'megapix', 'cinemax', 'discovery', 'history', 'animal', 'cazé', 'sportv', 'premiere'];
  const topLiveStreams = useMemo(() => {
    const topChannels = [];
    const usedStreamIds = new Set();

    for (const keyword of topKeywords) {
      const matches = allLiveStreams.filter(item =>
        item.name?.toLowerCase().includes(keyword) && !usedStreamIds.has(item.stream_id)
      );

      if (matches.length > 0) {
        const bestMatch = matches.find(m => {
          const nameLower = m.name?.toLowerCase() || '';
          return nameLower.includes('fhd') || nameLower.includes(' hd');
        }) || matches[0];

        topChannels.push(bestMatch);
        usedStreamIds.add(bestMatch.stream_id);
      }
    }
    return topChannels;
  }, [allLiveStreams]);

  // -- Lançamentos Reais --
  const recentMovies = useMemo(() => {
    return sortByYearAndRating(allVodStreams);
  }, [allVodStreams]);

  const recentSeries = useMemo(() => {
    return sortByYearAndRating(allSeriesStreams);
  }, [allSeriesStreams]);

  // -- Categorias Dinamicas VOD --
  const getCategoryIdsByKeywords = (categories: any[], keywords: string[]) => {
    return categories
      .filter(c => keywords.some(k => c.category_name?.toLowerCase().includes(k.toLowerCase())))
      .map(c => String(c.category_id));
  };

  const actionMovies = useMemo(() => {
    const pids = getCategoryIdsByKeywords(vodCategories, ['ação', 'action']);
    return sortByYearAndRating(allVodStreams.filter(m => pids.includes(String(m.category_id))));
  }, [allVodStreams, vodCategories]);

  const scifiMovies = useMemo(() => {
    const pids = getCategoryIdsByKeywords(vodCategories, ['ficção', 'sci-fi']);
    return sortByYearAndRating(allVodStreams.filter(m => pids.includes(String(m.category_id))));
  }, [allVodStreams, vodCategories]);

  const adventureMovies = useMemo(() => {
    const pids = getCategoryIdsByKeywords(vodCategories, ['aventura', 'adventure']);
    return sortByYearAndRating(allVodStreams.filter(m => pids.includes(String(m.category_id))));
  }, [allVodStreams, vodCategories]);

  // Search overrides
  const filteredLive = useMemo(() => {
    if (!searchQuery) return topLiveStreams;
    return allLiveStreams.filter(item => item.name?.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [topLiveStreams, allLiveStreams, searchQuery]);

  const filteredVod = useMemo(() => {
    if (!searchQuery) return recentMovies;
    return allVodStreams.filter(item => item.name?.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [recentMovies, allVodStreams, searchQuery]);

  const filteredSeries = useMemo(() => {
    if (!searchQuery) return recentSeries;
    return allSeriesStreams.filter(item => item.name?.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [recentSeries, allSeriesStreams, searchQuery]);

  const handlePlayLive = async (stream: any) => {
    if (!credentials) return;
    try {
      const url = await getMediaStreamUrl(credentials, {
        type: 'live',
        streamId: stream.stream_id,
        allowedOutputFormats: (credentials as any).allowed_output_formats,
      });
      onPlay(url, stream.name, 0, stream.stream_id);
    } catch (err: any) {
      console.error('Erro ao iniciar canal ao vivo:', err.message);
    }
  };

  const handlePlayVod = async (stream: any) => {
    if (!credentials) return;
    try {
      const url = await getMediaStreamUrl(credentials, {
        type: 'movie',
        streamId: stream.stream_id,
        containerExtension: stream.container_extension || "mp4",
      });
      onPlay(url, stream.name, 0, stream.stream_id);
    } catch (err: any) {
      console.error('Erro ao iniciar filme:', err.message);
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
        
        <HorizontalRow 
           title="Canais Ao Vivo"
           items={filteredLive.slice(0, displayCount.live)}
           type="live"
           onItemClick={handlePlayLive}
        />
        
        <HorizontalRow 
           title="Filmes em Destaque"
           items={filteredVod.slice(0, displayCount.vod)}
           type="vod"
           onItemClick={(item) => setSelectedMovie(item)}
        />
        
        <HorizontalRow 
           title="Séries em Destaque"
           items={filteredSeries.slice(0, displayCount.series)}
           type="series"
           onItemClick={(item) => setSelectedSeries(item)}
        />

        {!searchQuery && actionMovies.length > 0 && (
          <HorizontalRow 
            title="Ação"
            items={actionMovies.slice(0, displayCount.vod)}
            type="vod"
            onItemClick={(item) => setSelectedMovie(item)}
          />
        )}

        {!searchQuery && scifiMovies.length > 0 && (
          <HorizontalRow 
            title="Ficção Científica"
            items={scifiMovies.slice(0, displayCount.vod)}
            type="vod"
            onItemClick={(item) => setSelectedMovie(item)}
          />
        )}

        {!searchQuery && adventureMovies.length > 0 && (
          <HorizontalRow 
            title="Aventura"
            items={adventureMovies.slice(0, displayCount.vod)}
            type="vod"
            onItemClick={(item) => setSelectedMovie(item)}
          />
        )}
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
    </div>
  );
}
