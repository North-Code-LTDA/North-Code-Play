import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2 } from 'lucide-react';
import { useXtreamContext } from '../context/XtreamContext';
import { HeroBanner } from '../components/HeroBanner';
import { HorizontalRow } from '../components/HorizontalRow';
import { MovieDetails } from '../components/MovieDetails';
import { SeriesDetails } from '../components/SeriesDetails';

interface HomeViewProps {
  onPlay: (url: string, title: string) => void;
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

  // -- Destaques Live --
  const topKeywords = ['globo', 'telecine', 'premiere', 'espn', 'discovery', 'history', 'sportv', 'hbo'];
  const topLiveStreams = useMemo(() => {
    return allLiveStreams.filter(item => 
      topKeywords.some(keyword => item.name?.toLowerCase().includes(keyword))
    );
  }, [allLiveStreams]);

  // -- Lançamentos Reais --
  const recentMovies = useMemo(() => {
    return [...allVodStreams].sort((a, b) => {
      const aVal = Number(a.added) || Number(a.year) || 0;
      const bVal = Number(b.added) || Number(b.year) || 0;
      return bVal - aVal;
    });
  }, [allVodStreams]);

  const recentSeries = useMemo(() => {
    return [...allSeriesStreams].sort((a, b) => {
      const aVal = Number(a.added) || Number(a.year) || Number((a as any).last_modified) || 0;
      const bVal = Number(b.added) || Number(b.year) || Number((b as any).last_modified) || 0;
      return bVal - aVal;
    });
  }, [allSeriesStreams]);

  // -- Categorias Dinamicas VOD --
  const getCategoryIdsByKeywords = (categories: any[], keywords: string[]) => {
    return categories
      .filter(c => keywords.some(k => c.category_name?.toLowerCase().includes(k.toLowerCase())))
      .map(c => String(c.category_id));
  };

  const actionMovies = useMemo(() => {
    const pids = getCategoryIdsByKeywords(vodCategories, ['ação', 'action']);
    return allVodStreams.filter(m => pids.includes(String(m.category_id)));
  }, [allVodStreams, vodCategories]);

  const scifiMovies = useMemo(() => {
    const pids = getCategoryIdsByKeywords(vodCategories, ['ficção', 'sci-fi']);
    return allVodStreams.filter(m => pids.includes(String(m.category_id)));
  }, [allVodStreams, vodCategories]);

  const adventureMovies = useMemo(() => {
    const pids = getCategoryIdsByKeywords(vodCategories, ['aventura', 'adventure']);
    return allVodStreams.filter(m => pids.includes(String(m.category_id)));
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

  const handlePlayLive = (stream: any) => {
    if (!credentials) return;
    const baseUrl = credentials.serverUrl.endsWith('/') ? credentials.serverUrl.slice(0, -1) : credentials.serverUrl;
    let rawUrl = `${baseUrl}/${credentials.username}/${credentials.password}/${stream.stream_id}.ts`;
    rawUrl = rawUrl.replace('.ts', '.m3u8');
    onPlay(rawUrl, stream.name);
  };

  const handlePlayVod = (stream: any) => {
    if (!credentials) return;
    const ext = stream.container_extension || "mp4";
    const rawUrl = `${credentials.serverUrl.endsWith('/') ? credentials.serverUrl.slice(0, -1) : credentials.serverUrl}/movie/${credentials.username}/${credentials.password}/${stream.stream_id}.${ext}`;
    onPlay(rawUrl, stream.name);
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

      <div className="px-6 md:px-12 pb-12 gap-8 flex flex-col relative z-20 -mt-6 sm:-mt-10 md:-mt-16 lg:-mt-24 shrink-0">
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
