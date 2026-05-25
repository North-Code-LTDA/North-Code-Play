import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Info, Loader2, X, ChevronLeft } from 'lucide-react';
import { useXtreamContext } from '../context/XtreamContext';
import { XtreamService } from '../services/xtreamService';

interface HomeViewProps {
  onPlay: (url: string, title: string) => void;
}

export function HomeView({ onPlay }: HomeViewProps) {
  const { liveStreams, vodStreams, seriesStreams, loadingLive, loadingVod, loadingSeries, credentials } = useXtreamContext();

  const [selectedSeries, setSelectedSeries] = useState<any | null>(null);
  const [seriesInfo, setSeriesInfo] = useState<any | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null);

  const isLoading = loadingLive || loadingVod || loadingSeries;

  // Use the first VOD stream as the Hero (if available)
  const heroMovie = vodStreams.length > 0 ? vodStreams[0] : null;

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

  const handlePlaySeries = async (stream: any) => {
    if (!credentials) return;
    setSelectedSeries(stream);
    setSeriesInfo(null);
    setLoadingInfo(true);
    setSelectedSeason(null);
    try {
      const info = await XtreamService.getSeriesInfo(credentials, stream.series_id || stream.id);
      setSeriesInfo(info);
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

  if (isLoading && vodStreams.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-screen">
        <Loader2 className="w-12 h-12 animate-spin text-nc-text-secondary" />
      </div>
    );
  }

  return (
    <>
      <div className="md:hidden h-16 w-full shrink-0" /> {/* Spacer for mobile header */}
      
      {/* Hero Section */}
      {heroMovie && (
        <div className="relative w-full h-[60vh] md:h-[70vh] lg:h-[80vh] flex items-end pb-12 md:pb-24 px-6 md:px-12 shrink-0">
          <div className="absolute inset-0 z-0">
            <img 
              src={heroMovie.stream_icon || "https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?q=80&w=2070&auto=format&fit=crop"} 
              alt={heroMovie.name}
              className="w-full h-full object-cover object-top"
              onError={(e) => {
                (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?q=80&w=2070&auto=format&fit=crop';
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-nc-bg via-nc-bg/60 to-transparent" />
            <div className="absolute inset-0 md:bg-gradient-to-r md:from-nc-bg md:via-nc-bg/40 md:to-transparent" />
          </div>

          <div className="relative z-10 max-w-2xl w-full">
            <motion.h1 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-4xl md:text-6xl lg:text-7xl font-bold text-white tracking-tight mb-4 drop-shadow-lg"
            >
              {heroMovie.name}
            </motion.h1>
            {heroMovie.rating && heroMovie.rating !== "0" && (
              <motion.p 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="text-yellow-500 font-medium mb-4 drop-shadow-md"
              >
                ★ {heroMovie.rating}
              </motion.p>
            )}
            
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="flex items-center gap-4"
            >
              <button 
                onClick={() => handlePlayVod(heroMovie)}
                className="flex-1 md:flex-none items-center justify-center flex gap-2 bg-nc-primary hover:bg-nc-primary-hover text-black px-6 md:px-8 py-3 rounded-lg font-semibold transition-all active:scale-95"
              >
                <Play className="w-5 h-5 fill-black" />
                Assistir
              </button>
              <button className="flex-1 md:flex-none items-center justify-center flex gap-2 bg-white/20 hover:bg-white/30 backdrop-blur-md text-white px-6 md:px-8 py-3 rounded-lg font-semibold transition-all active:scale-95">
                <Info className="w-5 h-5" />
                Mais Info
              </button>
            </motion.div>
          </div>
        </div>
      )}

      {/* Carousels */}
      <div className="px-6 md:px-12 pb-24 space-y-12 -mt-10 relative z-20 shrink-0">
        
        {/* Canais Ao Vivo */}
        {liveStreams.length > 0 && (
          <div className="w-full">
            <h2 className="text-xl md:text-2xl font-semibold text-white mb-4">Canais Ao Vivo</h2>
            <div className="flex overflow-x-auto gap-4 pb-4 snap-x scrollbar-hide md:grid md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 md:gap-4 md:overflow-visible md:pb-0">
              {liveStreams.slice(0, 12).map((item) => (
                <motion.div 
                  key={item.stream_id}
                  onClick={() => handlePlayLive(item)}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="shrink-0 snap-center group cursor-pointer overflow-hidden rounded-xl bg-nc-bg-card border border-transparent hover:border-nc-primary/50 transition-all w-64 md:w-full aspect-video"
                >
                  <div className="relative w-full h-full p-4 flex items-center justify-center bg-black/40">
                    {item.stream_icon ? (
                      <img 
                        src={item.stream_icon} 
                        alt={item.name}
                        className="w-full h-full object-contain transition-transform duration-300 group-hover:scale-105"
                        loading="lazy"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdib3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iIzMzMyIgZD0iTTAgMGgwWjI0IDBoMloiLz48L3N2Zz4='; // fallback transparent
                        }}
                      />
                    ) : (
                      <span className="text-white text-sm opacity-50">{item.name}</span>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                      <p className="text-white font-medium text-sm truncate w-full">{item.name}</p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* Filmes em Destaque */}
        {vodStreams.length > 0 && (
          <div className="w-full">
            <h2 className="text-xl md:text-2xl font-semibold text-white mb-4">Filmes em Destaque</h2>
            <div className="flex overflow-x-auto gap-4 pb-4 snap-x scrollbar-hide md:grid md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 md:gap-4 md:overflow-visible md:pb-0">
              {vodStreams.slice(1, 13).map((item) => (
                <motion.div 
                  key={item.stream_id}
                  onClick={() => handlePlayVod(item)}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="shrink-0 snap-center group cursor-pointer overflow-hidden rounded-xl bg-nc-bg-card border border-transparent hover:border-nc-primary/50 transition-all w-36 md:w-full aspect-[2/3]"
                >
                  <div className="relative w-full h-full">
                    {item.stream_icon ? (
                      <img 
                        src={item.stream_icon} 
                        alt={item.name}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        loading="lazy"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdib3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iIzMzMyIgZD0iTTAgMGgwWjI0IDBoMloiLz48L3N2Zz4=';
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-nc-bg-input">
                        <span className="text-xs text-nc-text-secondary text-center px-1">{item.name}</span>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                      <p className="text-white font-medium text-sm truncate w-full">{item.name}</p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* Séries */}
        {seriesStreams.length > 0 && (
          <div className="w-full">
            <h2 className="text-xl md:text-2xl font-semibold text-white mb-4">Séries</h2>
            <div className="flex overflow-x-auto gap-4 pb-4 snap-x scrollbar-hide md:grid md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 md:gap-4 md:overflow-visible md:pb-0">
              {seriesStreams.slice(0, 12).map((item) => (
                <motion.div 
                  key={item.series_id}
                  onClick={() => handlePlaySeries(item)}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="shrink-0 snap-center group cursor-pointer overflow-hidden rounded-xl bg-nc-bg-card border border-transparent hover:border-nc-primary/50 transition-all w-36 md:w-full aspect-[2/3]"
                >
                  <div className="relative w-full h-full">
                    {item.cover ? (
                      <img 
                        src={item.cover} 
                        alt={item.name}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        loading="lazy"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdib3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iIzMzMyIgZD0iTTAgMGgwWjI0IDBoMloiLz48L3N2Zz4=';
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-nc-bg-input">
                        <span className="text-xs text-nc-text-secondary text-center px-1">{item.name}</span>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                      <p className="text-white font-medium text-sm truncate w-full">{item.name}</p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Series Details Modal */}
      <AnimatePresence>
        {selectedSeries && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed inset-0 z-[100] bg-nc-bg/95 backdrop-blur-xl flex flex-col overflow-hidden"
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
                <div className="flex flex-col items-center justify-center h-full text-nc-text-secondary">
                  <Loader2 className="w-10 h-10 animate-spin mb-4 text-nc-primary" />
                  <p>Carregando episódios...</p>
                </div>
              ) : seriesInfo ? (
                <div className="flex flex-col md:flex-row gap-8 max-w-6xl mx-auto pb-12">
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
    </>
  );
}
