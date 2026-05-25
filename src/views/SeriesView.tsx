import React, { useState } from 'react';
import { PlaySquare, Loader2, Play, X, ChevronLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useXtreamContext } from '../context/XtreamContext';
import { XtreamService } from '../services/xtreamService';

interface SeriesViewProps {
  onPlay: (url: string, title: string) => void;
}

export function SeriesView({ onPlay }: SeriesViewProps) {
  const { seriesCategories, seriesStreams, fetchSeriesStreams, loadingSeries, error, credentials } = useXtreamContext();
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>();
  const [selectedSeries, setSelectedSeries] = useState<any | null>(null);
  const [seriesInfo, setSeriesInfo] = useState<any | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null);

  // Default to first category
  React.useEffect(() => {
    if (seriesCategories.length > 0 && selectedCategoryId === undefined) {
      setSelectedCategoryId(seriesCategories[0].category_id);
    }
  }, [seriesCategories, selectedCategoryId]);

  // Fetch streams when category changes
  React.useEffect(() => {
    if (selectedCategoryId) {
      fetchSeriesStreams(selectedCategoryId);
    }
  }, [selectedCategoryId, fetchSeriesStreams]);

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
    const ext = episode.container_extension || "mp4";
    const rawUrl = `${credentials.serverUrl.endsWith('/') ? credentials.serverUrl.slice(0, -1) : credentials.serverUrl}/series/${credentials.username}/${credentials.password}/${episode.id}.${ext}`;
    onPlay(rawUrl, `${selectedSeries?.name} - S${selectedSeason}E${episode.episode_num || episode.id}`);
  };

  return (
    <div className="flex flex-1 overflow-hidden h-full">
      {/* Sidebar - Categories */}
      <aside className="hidden md:flex w-64 border-r border-nc-border/50 bg-nc-bg-card/30 flex-col h-full shrink-0">
        <div className="p-4 border-b border-nc-border/50">
          <h2 className="text-xs font-semibold text-nc-text-secondary uppercase tracking-wider">Categorias de Séries</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar">
          {loadingSeries && seriesCategories.length === 0 ? (
             <div className="flex items-center justify-center py-10">
               <Loader2 className="w-6 h-6 animate-spin text-nc-text-secondary" />
             </div>
          ) : (
            <>
              {seriesCategories.map((cat) => (
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
        <div className="md:hidden h-16 w-full shrink-0" /> {/* Spacer for mobile header */}
        
        {/* Mobile Categories Navbar */}
        <div className="md:hidden w-full overflow-x-auto snap-x flex gap-2 p-4 border-b border-nc-border/50 custom-scrollbar shrink-0">
          {seriesCategories.map((cat) => (
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
                 ? seriesCategories.find(c => c.category_id === selectedCategoryId)?.category_name 
                 : 'Carregando...'}
            </h1>
            <p className="text-nc-text-secondary text-sm mt-1">
              {seriesStreams.length} séries encontradas
            </p>
          </div>

          {loadingSeries && seriesStreams.length === 0 ? (
             <div className="flex items-center justify-center h-64">
               <Loader2 className="w-10 h-10 animate-spin text-nc-text-secondary" />
             </div>
          ) : seriesStreams.length === 0 ? (
             <div className="flex flex-col items-center justify-center h-64 text-nc-text-secondary">
               <PlaySquare className="w-16 h-16 mb-4 opacity-20" />
               <p>Nenhuma série encontrada nesta categoria.</p>
             </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
             {seriesStreams.map((stream) => (
               <motion.div
                 key={stream.series_id}
                 whileHover={{ scale: 1.05 }}
                 whileTap={{ scale: 0.95 }}
                 onClick={() => handleSeriesClick(stream)}
                 className="group relative aspect-[2/3] bg-nc-bg-card rounded-xl overflow-hidden cursor-pointer border border-nc-border/50 hover:border-nc-primary/50 transition-colors"
               >
                 {stream.cover ? (
                   <img 
                     src={stream.cover} 
                     alt={stream.name}
                     className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                     loading="lazy"
                     onError={(e) => {
                       (e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdib3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iIzMzMyIgZD0iTTAgMGgwWjI0IDBoMloiLz48L3N2Zz4='; // fallback transparent
                     }}
                   />
                 ) : (
                   <div className="w-full h-full flex flex-col items-center justify-center bg-nc-bg-input">
                     <PlaySquare className="w-8 h-8 text-nc-text-secondary/30 mb-2" />
                   </div>
                 )}
                 
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
          )}
        </div>
      </main>

      {/* Series Details Modal */}
      <AnimatePresence>
        {selectedSeries && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="absolute inset-0 z-50 bg-nc-bg/95 backdrop-blur-xl flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-nc-border/50 bg-black/50 shrink-0">
              <button 
                onClick={() => setSelectedSeries(null)}
                className="flex items-center gap-2 text-nc-text-secondary hover:text-white transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
                <span>Voltar</span>
              </button>
              <h2 className="text-lg font-semibold truncate flex-1 px-4 text-center">
                {seriesInfo?.info?.name || selectedSeries.name}
              </h2>
              <button 
                onClick={() => setSelectedSeries(null)}
                className="p-2 hover:bg-white/10 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
              {loadingInfo ? (
                <div className="flex flex-col items-center justify-center h-64 text-nc-text-secondary">
                  <Loader2 className="w-10 h-10 animate-spin mb-4 text-nc-primary" />
                  <p>Carregando episódios...</p>
                </div>
              ) : seriesInfo ? (
                <div className="flex flex-col md:flex-row gap-8 max-w-6xl mx-auto">
                  {/* Poster & Info */}
                  <div className="w-full md:w-1/3 lg:w-1/4 shrink-0 flex flex-col gap-4">
                    <div className="aspect-[2/3] rounded-xl overflow-hidden bg-nc-bg-card border border-nc-border/50">
                      <img 
                        src={seriesInfo.info?.cover || selectedSeries.cover} 
                        alt="Cover" 
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdib3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iIzMzMyIgZD0iTTAgMGgwWjI0IDBoMloiLz48L3N2Zz4='; // fallback transparent
                        }}
                      />
                    </div>
                    {seriesInfo.info?.plot && (
                      <p className="text-sm text-nc-text-secondary leading-relaxed line-clamp-6">
                        {seriesInfo.info.plot}
                      </p>
                    )}
                  </div>

                  {/* Seasons & Episodes */}
                  <div className="flex-1 min-w-0 flex flex-col">
                    {/* Season Tabs */}
                    {seriesInfo.episodes && Object.keys(seriesInfo.episodes).length > 0 ? (
                      <>
                        <div className="overflow-x-auto custom-scrollbar flex gap-2 pb-4 mb-4 border-b border-nc-border/50 shrink-0">
                          {Object.keys(seriesInfo.episodes).map((seasonNum) => (
                            <button
                              key={seasonNum}
                              onClick={() => setSelectedSeason(seasonNum)}
                              className={`px-6 py-2.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${selectedSeason === seasonNum ? 'bg-nc-primary text-black' : 'bg-nc-bg-card hover:bg-nc-bg-input text-nc-text-secondary'}`}
                            >
                              Temporada {seasonNum}
                            </button>
                          ))}
                        </div>

                        {/* Episodes List */}
                        <div className="flex flex-col gap-3">
                          {selectedSeason && seriesInfo.episodes[selectedSeason]?.map((episode: any) => (
                            <motion.div
                              key={episode.id}
                              whileHover={{ scale: 1.01 }}
                              whileTap={{ scale: 0.99 }}
                              onClick={() => handlePlayEpisode(episode)}
                              className="w-full bg-nc-bg-card border border-nc-border/50 rounded-xl p-4 flex gap-4 items-center cursor-pointer hover:border-nc-primary/50 transition-colors group"
                            >
                              <div className="w-12 h-12 rounded-full bg-nc-bg-input flex items-center justify-center shrink-0 group-hover:bg-nc-primary group-hover:text-black transition-colors">
                                <Play className="w-5 h-5 ml-1" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <h4 className="text-white font-medium text-sm md:text-base truncate">
                                  {episode.title || `Episódio ${episode.episode_num}`}
                                </h4>
                                {episode.duration && (
                                  <p className="text-xs text-nc-text-secondary mt-1">
                                    {episode.duration}
                                  </p>
                                )}
                              </div>
                            </motion.div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="text-center py-20 text-nc-text-secondary">
                        Não há episódios disponíveis.
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-center py-20 text-red-400">
                  Falha ao carregar informações da série.
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
