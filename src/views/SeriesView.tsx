import React, { useState, useMemo } from 'react';
import { PlaySquare, Loader2, Play, X, ChevronLeft, Heart } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useXtreamContext } from '../context/XtreamContext';
import { XtreamService } from '../services/xtreamService';
import { useFavorites } from '../hooks/useFavorites';

interface SeriesViewProps {
  onPlay: (url: string, title: string) => void;
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
  const { isFavorite, toggleFavorite } = useFavorites();

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
      setDisplayCount(100); // Reset display count on category change
    }
  }, [selectedCategoryId, fetchSeriesStreams]);

  React.useEffect(() => {
    setDisplayCount(100); // Reset display count on search change
  }, [searchQuery]);

  const sourceStreams = searchQuery && searchQuery.length > 0 ? allSeriesStreams : seriesStreams;
  
  const filteredStreams = useMemo(() => {
    if (!searchQuery) return sourceStreams;
    return sourceStreams.filter(stream => stream.name?.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [sourceStreams, searchQuery]);

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
               {displayedStreams.map((stream) => (
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
                <div className="flex flex-col gap-8 mx-auto w-full">
                  {/* Hero & Info Section */}
                  <div className="relative w-full rounded-2xl overflow-hidden bg-black shrink-0 flex flex-col min-h-[400px] md:min-h-[500px]">
                     <div className="absolute inset-0 bg-black z-0">
                       {seriesInfo.info?.backdrop_path?.[0] ? (
                          <img 
                            src={seriesInfo.info.backdrop_path[0]}
                            alt="Backdrop"
                            className="w-full h-full object-cover opacity-50 object-top"
                          />
                       ) : seriesInfo.info?.cover ? (
                          <img 
                            src={seriesInfo.info.cover}
                            alt="Cover fallback"
                            className="w-full h-full object-cover opacity-30 object-top"
                          />
                       ) : null}
                     </div>
                     <div className="absolute inset-0 bg-gradient-to-t from-nc-bg via-nc-bg/40 to-transparent z-0" />
                     <div className="absolute inset-0 bg-gradient-to-r from-nc-bg via-nc-bg/40 to-transparent z-0" />
                     
                     <div className="relative z-10 p-6 md:p-10 pt-32 md:pt-48 flex items-end">
                        <div className="max-w-4xl">
                           <h1 className="text-3xl md:text-5xl font-bold text-white mb-4">
                              {seriesInfo.info?.name || selectedSeries.name}
                           </h1>
                           <div className="flex flex-wrap items-center gap-4 text-xs md:text-sm font-medium text-nc-text-secondary mb-4">
                              {seriesInfo.info?.rating && seriesInfo.info.rating !== "0" && (
                                <span className="flex items-center gap-1 text-green-400">
                                   ★ {seriesInfo.info.rating}
                                </span>
                              )}
                              {seriesInfo.info?.releasedate && (
                                <span>{new Date(seriesInfo.info.releasedate).getFullYear() || seriesInfo.info.releasedate}</span>
                              )}
                              {seriesInfo.info?.genre && (
                                <span className="px-2 py-0.5 rounded border border-nc-border/50 text-nc-text-secondary">
                                  {seriesInfo.info.genre}
                                </span>
                              )}
                           </div>
                           <p className="text-gray-300 text-sm md:text-base leading-relaxed line-clamp-3 max-w-3xl mb-6">
                             {seriesInfo.info?.plot || 'Sinopse não disponível.'}
                           </p>
                           <button 
                             onClick={() => toggleFavorite({
                               id: selectedSeries.series_id,
                               name: seriesInfo.info?.name || selectedSeries.name,
                               cover: seriesInfo.info?.cover || selectedSeries.cover || '',
                               type: 'series'
                             })}
                             className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 backdrop-blur-md transition-colors w-fit font-medium text-white shadow-xl"
                           >
                             <Heart className={`w-5 h-5 ${isFavorite(selectedSeries.series_id, 'series') ? 'fill-nc-primary text-nc-primary' : 'text-white'}`} />
                             {isFavorite(selectedSeries.series_id, 'series') ? 'Favoritado' : 'Adicionar aos Favoritos'}
                           </button>
                        </div>
                     </div>
                  </div>

                  {/* Metadata and Episodes Section */}
                  <div className="flex flex-col lg:flex-row gap-8 max-w-[1400px] w-full mx-auto px-4">
                     {/* Sidebar Metadata */}
                     <div className="w-full lg:w-1/4 shrink-0 flex flex-col gap-6">
                        {seriesInfo.info?.cast && (
                           <div>
                              <span className="text-nc-text-secondary text-sm block mb-1">Elenco</span>
                              <span className="text-white text-sm leading-relaxed">{seriesInfo.info.cast}</span>
                           </div>
                        )}
                        {seriesInfo.info?.director && (
                           <div>
                              <span className="text-nc-text-secondary text-sm block mb-1">Diretor</span>
                              <span className="text-white text-sm">{seriesInfo.info.director}</span>
                           </div>
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
