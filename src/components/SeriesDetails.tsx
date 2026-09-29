import React, { useState, useEffect } from 'react';
import { Play, X, ChevronLeft, Loader2, Heart, AlertCircle, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useXtreamContext } from '../context/XtreamContext';
import { XtreamService } from '../services/xtreamService';
import { useFavorites } from '../hooks/useFavorites';
import { VideoPlayer } from './VideoPlayer';
import { buildDirectMediaUrl, buildDirectImageUrl, FALLBACK_IMAGE_DATA_URI } from '../utils/mediaUtils';

interface SeriesDetailsProps {
  key?: React.Key;
  seriesId: string | number;
  seriesName: string;
  seriesCover?: string;
  onClose: () => void;
  onPlay: (url: string, title: string, startAt?: number, streamId?: string | number) => void;
}

export function SeriesDetails({ seriesId, seriesName, seriesCover, onClose, onPlay }: SeriesDetailsProps) {
  const { credentials } = useXtreamContext();
  const { isFavorite, toggleFavorite } = useFavorites();
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [seriesInfo, setSeriesInfo] = useState<any | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null);

  const [showResumeModal, setShowResumeModal] = useState(false);
  const [savedProgress, setSavedProgress] = useState(0);
  const [selectedEpisode, setSelectedEpisode] = useState<any>(null);
  const [playingEpisodeData, setPlayingEpisodeData] = useState<{url: string, title: string, startAt: number, episode: any} | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const [failedEpisode, setFailedEpisode] = useState<{ episode: any; startAt: number } | null>(null);

  useEffect(() => {
    async function fetchInfo() {
      if (!credentials) return;
      try {
        setLoadingInfo(true);
        const info = await XtreamService.getSeriesInfo(credentials, seriesId);
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
    }
    fetchInfo();
  }, [credentials, seriesId]);

  const requestFullscreen = () => {
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch((e) => console.log(e));
    }
  };

  const executePlay = (episode: any, startAt: number = 0) => {
    localStorage.setItem('nc_parent_series_' + episode.id, String(seriesId));
    if (startAt === 0) {
      localStorage.removeItem('nc_progress_' + episode.id);
    }
    requestFullscreen();
    if (!credentials) return;
    try {
      setPlayError(null);
      setFailedEpisode(null);
      const ext = episode.container_extension || "mp4";
      const mediaUrl = buildDirectMediaUrl(credentials, {
        type: 'series',
        streamId: episode.id,
        containerExtension: ext,
      });

      setPlayingEpisodeData({
        url: mediaUrl,
        title: `${seriesInfo?.info?.name || seriesName} - S${selectedSeason}E${episode.episode_num || episode.id}`,
        startAt,
        episode,
      });
      setShowResumeModal(false);
    } catch (err: any) {
      console.error('Erro ao iniciar episódio:', err);
      setPlayError(err?.message || 'Falha ao preparar a reprodução do episódio.');
      setFailedEpisode({ episode, startAt });
    }
  };

  const handleNextEpisode = () => {
    if (!selectedSeason || !seriesInfo?.episodes || !playingEpisodeData) return;
    const episodes = seriesInfo.episodes[selectedSeason];
    const currentIndex = episodes.findIndex((e: any) => e.id === playingEpisodeData.episode.id);
    if (currentIndex !== -1 && currentIndex < episodes.length - 1) {
      executePlay(episodes[currentIndex + 1], 0);
    }
  };

  const handlePreviousEpisode = () => {
    if (!selectedSeason || !seriesInfo?.episodes || !playingEpisodeData) return;
    const episodes = seriesInfo.episodes[selectedSeason];
    const currentIndex = episodes.findIndex((e: any) => e.id === playingEpisodeData.episode.id);
    if (currentIndex > 0) {
      executePlay(episodes[currentIndex - 1], 0);
    }
  };

  const handlePlayEpisodeClick = (episode: any) => {
    const progress = Number(localStorage.getItem('nc_progress_' + episode.id)) || 0;
    if (progress > 30) {
      setSavedProgress(progress);
      setSelectedEpisode(episode);
      setShowResumeModal(true);
    } else {
      executePlay(episode, 0);
    }
  };

  const handlePlayEpisode = handlePlayEpisodeClick;

  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 50 }}
      className="absolute inset-0 z-[60] bg-nc-bg/95 backdrop-blur-xl flex flex-col overflow-hidden w-full h-full"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-nc-border/50 bg-black/50 shrink-0">
        <button 
          onClick={onClose}
          className="flex items-center gap-2 text-nc-text-secondary hover:text-white transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
          <span>Voltar</span>
        </button>
        <h2 className="text-lg font-semibold truncate flex-1 px-4 text-center">
          {seriesInfo?.info?.name || seriesName}
        </h2>
        <button 
          onClick={onClose}
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
            <p>Carregando dados da série...</p>
          </div>
        ) : seriesInfo ? (
          <div className="flex flex-col gap-8 mx-auto w-full">
            {/* Hero & Info Section */}
            <div className="relative w-full rounded-2xl overflow-hidden bg-black shrink-0 flex flex-col min-h-[400px] md:min-h-[500px]">
               <div className="absolute inset-0 bg-black z-0">
                 {seriesInfo.info?.backdrop_path?.[0] ? (
                    <img 
                      src={buildDirectImageUrl(seriesInfo.info.backdrop_path[0])}
                      alt="Backdrop"
                      className="w-full h-full object-cover opacity-50 object-top"
                    />
                 ) : (seriesInfo.info?.cover || seriesCover) ? (
                    <img 
                      src={buildDirectImageUrl(seriesInfo.info?.cover || seriesCover)}
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
                        {seriesInfo.info?.name || seriesName}
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
                         id: seriesId,
                         name: seriesInfo.info?.name || seriesName,
                         cover: seriesInfo.info?.cover || seriesCover || '',
                         type: 'series'
                       })}
                       className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 backdrop-blur-md transition-colors w-fit font-medium text-white shadow-xl"
                     >
                       <Heart className={`w-5 h-5 ${isFavorite(seriesId, 'series') ? 'fill-nc-primary text-nc-primary' : 'text-white'}`} />
                       {isFavorite(seriesId, 'series') ? 'Favoritado' : 'Adicionar aos Favoritos'}
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

      {showResumeModal && selectedEpisode && (
        <div className="absolute inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-nc-bg border border-nc-border/50 rounded-2xl p-6 md:p-8 max-w-sm w-full shadow-2xl flex flex-col items-center text-center animate-in zoom-in-95 duration-300">
            <h3 className="text-xl font-bold text-white mb-2">Continuar Assistindo?</h3>
            <p className="text-nc-text-secondary text-sm mb-6">
              Você já assistiu uma parte deste episódio. O que você gostaria de fazer?
            </p>
            <div className="flex flex-col gap-3 w-full">
              <button
                onClick={() => executePlay(selectedEpisode, savedProgress)}
                className="w-full py-3 bg-nc-primary text-black font-semibold rounded-xl transition-all hover:scale-105 active:scale-95"
              >
                Retomar de {Math.floor(savedProgress / 60)} min
              </button>
              <button
                onClick={() => executePlay(selectedEpisode, 0)}
                className="w-full py-3 bg-nc-bg-card hover:bg-nc-bg-input text-white font-medium rounded-xl transition-colors border border-nc-border/30"
              >
                Assistir do Início
              </button>
              <button
                onClick={() => setShowResumeModal(false)}
                className="w-full py-2 mt-2 text-nc-text-secondary hover:text-white transition-colors text-sm"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {playError && (
        <div className="absolute inset-0 z-[110] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-nc-bg border border-red-500/40 rounded-2xl p-6 md:p-8 max-w-md w-full shadow-2xl flex flex-col items-center text-center animate-in zoom-in-95 duration-300">
            <div className="w-14 h-14 rounded-full bg-red-500/20 flex items-center justify-center mb-4">
              <AlertCircle className="w-7 h-7 text-red-500" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Erro ao Iniciar Episódio</h3>
            <p className="text-red-400 text-sm mb-4 leading-relaxed">{playError}</p>
            <p className="text-gray-400 text-xs mb-6">
              A transmissão foi solicitada diretamente ao provedor. O endereço pode estar inacessível ou o formato requerer compatibilidade no navegador.
            </p>
            <div className="flex gap-3 w-full">
              {failedEpisode && (
                <button
                  onClick={() => executePlay(failedEpisode.episode, failedEpisode.startAt)}
                  className="flex-1 py-3 bg-nc-primary text-black font-semibold rounded-xl transition-all hover:brightness-110 flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" /> Tentar Novamente
                </button>
              )}
              <button
                onClick={() => setPlayError(null)}
                className="flex-1 py-3 bg-nc-bg-card hover:bg-nc-bg-input text-white font-medium rounded-xl transition-colors border border-nc-border/50"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      <AnimatePresence>
        {playingEpisodeData && (() => {
          let hasNext = false;
          let hasPrev = false;
          if (selectedSeason && seriesInfo?.episodes) {
            const episodes = seriesInfo.episodes[selectedSeason];
            const currIdx = episodes.findIndex((e: any) => e.id === playingEpisodeData.episode.id);
            if (currIdx !== -1) {
              if (currIdx < episodes.length - 1) hasNext = true;
              if (currIdx > 0) hasPrev = true;
            }
          }
          return (
            <VideoPlayer
              streamUrl={playingEpisodeData.url}
              title={playingEpisodeData.title}
              startAt={playingEpisodeData.startAt}
              streamId={playingEpisodeData.episode.id}
              onBack={() => {
                if (document.fullscreenElement) {
                  document.exitFullscreen().catch(err => console.log('Fullscreen exit error:', err));
                }
                setPlayingEpisodeData(null);
              }}
              onNext={hasNext ? handleNextEpisode : undefined}
              onPrevious={hasPrev ? handlePreviousEpisode : undefined}
            />
          );
        })()}
      </AnimatePresence>

    </motion.div>
  );
}
