import React, { useState, useMemo, useEffect } from 'react';
import { PlaySquare, Loader2, Play, X, ChevronLeft, Heart } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useXtreamContext } from '../context/XtreamContext';
import { XtreamService } from '../services/xtreamService';
import { useFavorites } from '../hooks/useFavorites';
import { SeriesDetails } from '../components/SeriesDetails';
import { MediaImage } from '../components/MediaImage';
import { buildDirectMediaUrl } from '../utils/mediaUtils';

interface SeriesViewProps {
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

export function SeriesView({ onPlay, searchQuery = '' }: SeriesViewProps) {
  const { seriesCategories, seriesStreams, allSeriesStreams, fetchSeriesStreams, loadingSeries, error, credentials } = useXtreamContext();
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>();
  const [selectedSeries, setSelectedSeries] = useState<any | null>(null);
  const [seriesInfo, setSeriesInfo] = useState<any | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null);
  const [displayCount, setDisplayCount] = useState(100);
  const { favorites } = useFavorites();
  const [continueWatching, setContinueWatching] = useState<any[]>([]);

  const favoriteSeries = useMemo(() => {
    return favorites
      .filter(f => f.type === 'series')
      .map(f => allSeriesStreams.find(s => String(s.series_id || s.id) === String(f.id)))
      .filter(Boolean);
  }, [favorites, allSeriesStreams]);

  useEffect(() => {
    if (allSeriesStreams.length === 0) return;

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

            const item = allSeriesStreams.find((c: any) => String(c.series_id || c.id) === String(targetId));
            
            if (item) {
              const itemId = item.series_id || item.id;
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
      console.warn('Error reading from localStorage for continue watching series:', error);
    }
  }, [allSeriesStreams]);

  const extendedCategories = useMemo(() => {
    const virtualCats = [
      { category_id: 'nc_recent', category_name: 'Assistidos Recentemente' },
      { category_id: 'nc_fav', category_name: 'Séries Favoritas' }
    ];
    return [...virtualCats, ...seriesCategories];
  }, [seriesCategories]);

  // Default to first category
  React.useEffect(() => {
    if (extendedCategories.length > 0 && selectedCategoryId === undefined) {
      setSelectedCategoryId(extendedCategories[0].category_id);
    }
  }, [extendedCategories, selectedCategoryId]);

  // Fetch streams when category changes
  React.useEffect(() => {
    if (selectedCategoryId && selectedCategoryId !== 'nc_recent' && selectedCategoryId !== 'nc_fav') {
      fetchSeriesStreams(selectedCategoryId);
    }
    setDisplayCount(100); // Reset display count on category change
  }, [selectedCategoryId, fetchSeriesStreams]);

  React.useEffect(() => {
    setDisplayCount(100); // Reset display count on search change
  }, [searchQuery]);

  const filteredStreams = useMemo(() => {
    if (searchQuery) {
      return allSeriesStreams.filter(item => item.name?.toLowerCase().includes(searchQuery.toLowerCase()));
    }
    if (selectedCategoryId === 'nc_recent') return continueWatching;
    if (selectedCategoryId === 'nc_fav') return favoriteSeries;

    return seriesStreams;
  }, [searchQuery, selectedCategoryId, continueWatching, favoriteSeries, seriesStreams, allSeriesStreams]);

  const displayedStreams = filteredStreams.slice(0, displayCount);

  const handleSeriesClick = async (series: any) => {
    if (!credentials) return;
    setSelectedSeries(series);
    setSeriesInfo(null);
    setLoadingInfo(true);
    setSelectedSeason(null);
    try {
      const info = await XtreamService.getSeriesInfo(credentials, series.series_id || series.id);
      setSeriesInfo(info);
      // Select first season by default
      if (info?.episodes) {
        const seasons = Object.keys(info.episodes);
        if (seasons.length > 0) {
          setSelectedSeason(seasons[0]);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingInfo(false);
    }
  };

  const handlePlayEpisode = (episode: any) => {
    if (!credentials) return;
    try {
      const ext = episode.container_extension || "mp4";
      const mediaUrl = buildDirectMediaUrl(credentials, {
        type: 'series',
        streamId: episode.id,
        containerExtension: ext,
      });
      onPlay(mediaUrl, `${selectedSeries?.name} - S${selectedSeason}E${episode.episode_num || episode.id}`, 0, episode.id);
    } catch (err: any) {
      console.error('Erro ao iniciar episódio:', err);
    }
  };

  return (
    <div className="flex flex-1 overflow-hidden h-full">
      {/* Sidebar - Categories */}
      <aside className="hidden md:flex w-full md:w-[35%] lg:w-[30%] flex-col border-r border-nc-border/50 bg-nc-bg-card/30 h-full shrink-0">
        <div className="p-4 border-b border-nc-border/50">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Categorias de Séries</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar">
          {loadingSeries && extendedCategories.length === 2 ? (
             <div className="flex items-center justify-center py-10">
               <Loader2 className="w-6 h-6 animate-spin text-nc-text-secondary" />
             </div>
          ) : (
            <>
              {extendedCategories.map((cat) => (
                <button
                  key={cat.category_id}
                  onClick={() => setSelectedCategoryId(cat.category_id)}
                  className={`w-full text-left px-4 py-2.5 rounded-lg text-sm transition-colors truncate ${selectedCategoryId === cat.category_id ? 'bg-nc-primary text-black font-medium' : 'text-nc-text-secondary hover:bg-nc-bg-input hover:text-white'}`}
                >
                  {cat.category_name}
                </button>
              ))}
            </>
          )}
        </div>
      </aside>

      {/* Main Content - Streams Grid */}
      <main className="flex-1 overflow-y-auto h-full custom-scrollbar flex flex-col">
        {/* Mobile Categories Navbar */}
        <div className="md:hidden w-full overflow-x-auto snap-x flex gap-2 p-4 border-b border-nc-border/50 custom-scrollbar shrink-0">
          {extendedCategories.map((cat) => (
            <button
              key={cat.category_id}
              onClick={() => setSelectedCategoryId(cat.category_id)}
              className={`shrink-0 snap-center px-4 py-2 rounded-full text-sm transition-colors whitespace-nowrap ${selectedCategoryId === cat.category_id ? 'bg-nc-primary text-black font-medium' : 'bg-nc-bg-card hover:bg-nc-bg-input text-nc-text-secondary'}`}
            >
              {cat.category_name}
            </button>
          ))}
        </div>
         <div className="p-6 flex-1">
          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/50 text-red-500 rounded-xl">
              {error}
            </div>
          )}

          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-white">
              {selectedCategoryId 
                 ? extendedCategories.find(c => c.category_id === selectedCategoryId)?.category_name 
                 : 'Carregando...'}
            </h1>
            <p className="text-nc-text-secondary text-sm mt-1">
              {filteredStreams.length} séries encontradas
            </p>
          </div>

          {loadingSeries && filteredStreams.length === 0 ? (
             <div className="flex items-center justify-center h-64">
               <Loader2 className="w-10 h-10 animate-spin text-nc-text-secondary" />
             </div>
          ) : filteredStreams.length === 0 ? (
             <div className="flex flex-col items-center justify-center h-64 text-nc-text-secondary">
               <PlaySquare className="w-16 h-16 mb-4 opacity-20" />
               <p>Nenhuma série encontrada nesta categoria.</p>
             </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
               {displayedStreams.map((stream, idx) => (
                 <motion.div
                   key={stream.series_id}
                   whileHover={{ scale: 1.05 }}
                   whileTap={{ scale: 0.95 }}
                   onClick={() => handleSeriesClick(stream)}
                   className="group relative aspect-[2/3] bg-nc-bg-card rounded-xl overflow-hidden cursor-pointer border border-nc-border/50 hover:border-nc-primary/50 transition-colors"
                 >
                   <MediaImage
                        src={stream.cover}
                        serverUrl={credentials?.serverUrl}
                        alt={stream.name}
                        itemId={stream.series_id}
                        itemName={stream.name}
                        priority={idx < 12}
                        loading={idx < 12 ? "eager" : "lazy"}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                   
                   <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
                     <p className="text-white font-medium text-sm line-clamp-2 leading-tight">
                       {stream.name}
                     </p>
                     {stream.rating && stream.rating !== "0" && (
                        <p className="text-xs text-yellow-500 mt-1">★ {stream.rating}</p>
                     )}
                   </div>
                 </motion.div>
               ))}
              </div>
              
              {displayCount < filteredStreams.length && (
                <div className="mt-8 flex justify-center">
                  <button
                    onClick={() => setDisplayCount(prev => prev + 100)}
                    className="px-6 py-3 bg-nc-bg-card hover:bg-nc-bg-input border border-nc-border/50 rounded-xl text-white font-medium transition-colors"
                  >
                    Carregar Mais
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* Series Details Modal */}
      <AnimatePresence>
        {selectedSeries && (
          <SeriesDetails
            seriesId={selectedSeries.series_id || selectedSeries.id}
            seriesName={selectedSeries.name || ""}
            seriesCover={selectedSeries.cover || ""}
            onClose={() => setSelectedSeries(null)}
            onPlay={onPlay}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
