import React, { useState, useEffect, useRef } from 'react';
import { Play, X, ChevronLeft, Loader2, Heart, AlertCircle, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useXtreamContext } from '../context/XtreamContext';
import { XtreamService } from '../services/xtreamService';
import { useFavorites, FavoriteItem } from '../hooks/useFavorites';
import { VideoPlayer } from './VideoPlayer';
import { buildDirectMediaUrl, normalizeImageSource } from '../utils/mediaUtils';
import { MediaImage } from './MediaImage';

import { getItemProgress, recordPlaybackPosition, clearItemProgress } from '../utils/playbackHistory';
import {
  useBackHandler,
  BACK_PRIORITY,
  pushFocusMemory,
  popFocusMemory,
  getNavMode,
  focusElementSafely,
} from '../navigation';

interface SeriesDetailsProps {
  key?: React.Key;
  seriesId: string | number;
  seriesName: string;
  seriesCover?: string;
  onClose: () => void;
  onPlay: (url: string, title: string, startAt?: number, streamId?: string | number) => void;
}

export function SeriesDetails({ seriesId, seriesName, seriesCover, onClose }: SeriesDetailsProps) {
  const { credentials } = useXtreamContext();
  const { isFavorite, toggleFavorite, favoriteError, clearFavoriteError } = useFavorites();
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [seriesInfo, setSeriesInfo] = useState<any | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null);

  const [showResumeModal, setShowResumeModal] = useState(false);
  const [savedProgress, setSavedProgress] = useState(0);
  const [selectedEpisode, setSelectedEpisode] = useState<any>(null);
  const [playingEpisodeData, setPlayingEpisodeData] = useState<{url: string, title: string, startAt: number, episode: any} | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const [failedEpisode, setFailedEpisode] = useState<{ episode: any; startAt: number } | null>(null);
  const [favActionError, setFavActionError] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const favoriteBtnRef = useRef<HTMLButtonElement>(null);
  const originFocusElementRef = useRef<HTMLElement | null>(null);
  const lastEpisodeIdRef = useRef<string | null>(null);
  const savedEpisodeScrollTopRef = useRef<number | null>(null);
  const restoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (restoreTimerRef.current) {
        clearTimeout(restoreTimerRef.current);
        restoreTimerRef.current = null;
      }
    };
  }, []);

  const restoreEpisodeFocus = () => {
    if (restoreTimerRef.current) {
      clearTimeout(restoreTimerRef.current);
      restoreTimerRef.current = null;
    }

    const targetEpisodeId = lastEpisodeIdRef.current;
    const savedScroll = savedEpisodeScrollTopRef.current;

    const attemptRestore = (): boolean => {
      const container = scrollContainerRef.current;
      if (!container) return false;

      if (savedScroll !== null) {
        container.scrollTop = savedScroll;
      }

      if (targetEpisodeId) {
        const epEl = container.querySelector<HTMLElement>(
          `[data-episode-id="${CSS.escape(targetEpisodeId)}"]`
        );
        if (epEl) {
          try {
            epEl.focus({ preventScroll: true });
          } catch {
            epEl.focus();
          }

          if (savedScroll !== null) {
            container.scrollTop = savedScroll;
          }

          const cRect = container.getBoundingClientRect();
          const eRect = epEl.getBoundingClientRect();
          if (cRect.height > 0 && eRect.height > 0) {
            const padY = 20;
            if (eRect.top < cRect.top + padY) {
              container.scrollTop = Math.max(0, container.scrollTop + (eRect.top - cRect.top) - padY);
              savedEpisodeScrollTopRef.current = container.scrollTop;
            } else if (eRect.bottom > cRect.bottom - padY) {
              container.scrollTop = Math.max(
                0,
                container.scrollTop + (eRect.bottom - cRect.bottom) + padY
              );
              savedEpisodeScrollTopRef.current = container.scrollTop;
            }
          }
          return true;
        }
      }

      // Fallback within SeriesDetails if the episode is no longer in the DOM
      const fallbackEl =
        container.querySelector<HTMLElement>('[data-episode-id]') ||
        container.querySelector<HTMLElement>('button[data-season-selected="true"]') ||
        favoriteBtnRef.current;

      if (fallbackEl) {
        focusElementSafely(fallbackEl);
        return true;
      }

      return false;
    };

    if (!attemptRestore()) {
      restoreTimerRef.current = setTimeout(() => {
        restoreTimerRef.current = null;
        attemptRestore();
      }, 0);
    }
  };

  useEffect(() => {
    const active =
      typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (active && active !== document.body && active !== document.documentElement) {
      originFocusElementRef.current = active;
    }
    pushFocusMemory(active);
  }, [seriesId]);

  useEffect(() => {
    if (!loadingInfo && seriesInfo && getNavMode() === 'remote' && favoriteBtnRef.current) {
      focusElementSafely(favoriteBtnRef.current);
    }
  }, [loadingInfo, seriesInfo]);

  // Ensure season changes never leave focus stranded on an unmounted episode node
  useEffect(() => {
    if (!selectedSeason || loadingInfo || playingEpisodeData || showResumeModal || playError) {
      return;
    }
    if (getNavMode() !== 'remote') return;

    const active = document.activeElement;
    if (!active || active === document.body || active === document.documentElement || !active.isConnected) {
      const container = scrollContainerRef.current;
      const seasonBtn = container?.querySelector<HTMLElement>('button[data-season-selected="true"]');
      if (seasonBtn) {
        focusElementSafely(seasonBtn);
      } else if (favoriteBtnRef.current) {
        focusElementSafely(favoriteBtnRef.current);
      }
    }
  }, [selectedSeason, loadingInfo, playingEpisodeData, showResumeModal, playError]);

  const handleClose = () => {
    if (restoreTimerRef.current) {
      clearTimeout(restoreTimerRef.current);
      restoreTimerRef.current = null;
    }
    const originEl = originFocusElementRef.current;
    onClose();

    const restoreOrigin = () => {
      if (popFocusMemory()) {
        return true;
      }
      if (originEl && originEl.isConnected) {
        focusElementSafely(originEl);
        return true;
      }
      return false;
    };

    if (!restoreOrigin()) {
      setTimeout(restoreOrigin, 0);
    }
  };

  useBackHandler(
    `series-details-submodal-${seriesId}`,
    BACK_PRIORITY.SUB_MODAL,
    () => {
      if (playError) {
        setPlayError(null);
        restoreEpisodeFocus();
        return true;
      }
      if (showResumeModal) {
        setShowResumeModal(false);
        restoreEpisodeFocus();
        return true;
      }
      return false;
    },
    showResumeModal || Boolean(playError)
  );

  useBackHandler(
    `series-details-${seriesId}`,
    BACK_PRIORITY.DETAILS_MODAL,
    () => {
      handleClose();
      return true;
    },
    !playingEpisodeData
  );

  useEffect(() => {
    if (favActionError) {
      const timer = setTimeout(() => {
        setFavActionError(null);
        clearFavoriteError();
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [favActionError, clearFavoriteError]);

  const handleToggleFavorite = (item: FavoriteItem) => {
    const success = toggleFavorite(item);
    if (!success) {
      setFavActionError('Não foi possível salvar os favoritos neste dispositivo. Tente novamente.');
    } else {
      setFavActionError(null);
    }
  };

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

  const executePlay = (episode: any, startAt: number = 0) => {
    if (episode?.id !== undefined && episode?.id !== null) {
      lastEpisodeIdRef.current = String(episode.id);
    }
    if (scrollContainerRef.current && !playingEpisodeData && !showResumeModal && !playError) {
      savedEpisodeScrollTopRef.current = scrollContainerRef.current.scrollTop;
    }

    // Associate episode with parent series ID in active account's history
    recordPlaybackPosition(credentials, {
      id: episode.id,
      type: 'episode',
      parentSeriesId: seriesId,
      ...(startAt > 0 ? { positionSec: startAt } : {}),
    });

    if (startAt === 0) {
      clearItemProgress(credentials, 'episode', episode.id);
    }

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
    if (episode?.id !== undefined && episode?.id !== null) {
      lastEpisodeIdRef.current = String(episode.id);
    }
    if (scrollContainerRef.current) {
      savedEpisodeScrollTopRef.current = scrollContainerRef.current.scrollTop;
    }
    const progress = getItemProgress(credentials, 'episode', episode.id);
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
      data-focus-scope="modal"
      data-nav-zone="main"
      className="absolute inset-0 z-[60] bg-nc-bg/95 backdrop-blur-xl flex flex-col overflow-hidden w-full h-full min-w-0 min-h-0"
    >
      {/* Header */}
      <div
        data-nav-row="true"
        data-scroll-top-anchor="true"
        className="nc-tv-details-header flex items-center justify-between p-4 border-b border-nc-border/50 bg-black/50 shrink-0"
      >
        <button 
          onClick={handleClose}
          className="flex items-center gap-2 text-nc-text-secondary hover:text-white transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
          <span>Voltar</span>
        </button>
        <h2 className="text-lg font-semibold truncate flex-1 px-4 text-center">
          {seriesInfo?.info?.name || seriesName}
        </h2>
        <button 
          onClick={handleClose}
          aria-label="Fechar"
          className="p-2 hover:bg-white/10 rounded-full transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Content */}
      <div
        ref={scrollContainerRef}
        data-scroll-container="true"
        className="nc-tv-details-scroll flex-1 min-w-0 min-h-0 overflow-y-auto custom-scrollbar p-6"
      >
        {loadingInfo ? (
          <div className="flex flex-col items-center justify-center h-64 text-nc-text-secondary">
            <Loader2 className="w-10 h-10 animate-spin mb-4 text-nc-primary" />
            <p>Carregando dados da série...</p>
          </div>
        ) : seriesInfo ? (
          <div className="nc-tv-details-stack flex flex-col gap-8 mx-auto w-full min-w-0">
            {/* Hero & Info Section */}
            <div
              className="nc-tv-details-hero relative w-full rounded-2xl overflow-hidden bg-black shrink-0 flex flex-col min-h-[320px] md:min-h-[420px]"
            >
               <div className="absolute inset-0 bg-black z-0">
                 {(() => {
                   const backdropSource = normalizeImageSource(seriesInfo.info?.backdrop_path);
                   const coverSource = normalizeImageSource(seriesInfo.info?.cover) || normalizeImageSource(seriesCover);
                   const heroImageSource = backdropSource || coverSource;
                   if (!heroImageSource) return null;
                   return (
                     <MediaImage 
                       src={heroImageSource}
                       serverUrl={credentials?.serverUrl}
                       alt={seriesInfo.info?.name || seriesName || "Backdrop"}
                       itemId={seriesId}
                       itemName={seriesInfo.info?.name || seriesName}
                       priority={true}
                       className={`w-full h-full object-cover object-top ${backdropSource ? 'opacity-50' : 'opacity-30'}`}
                     />
                   );
                 })()}
               </div>
               <div className="absolute inset-0 bg-gradient-to-t from-nc-bg via-nc-bg/40 to-transparent z-0" />
               <div className="absolute inset-0 bg-gradient-to-r from-nc-bg via-nc-bg/40 to-transparent z-0" />
               
               <div className="nc-tv-details-hero-inner relative z-10 p-6 md:p-10 pt-20 md:pt-36 flex items-end">
                  <div className="max-w-4xl min-w-0 w-full">
                     <h1 className="nc-tv-details-title text-3xl md:text-5xl font-bold text-white mb-3 md:mb-4">
                        {seriesInfo.info?.name || seriesName}
                     </h1>
                     <div className="flex flex-wrap items-center gap-4 text-xs md:text-sm font-medium text-nc-text-secondary mb-3 md:mb-4">
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
                     <div
                       tabIndex={0}
                       role="region"
                       aria-label="Sinopse da série"
                       data-nav-item="true"
                       data-synopsis-focus="true"
                       data-scroll-block="true"
                       data-scroll-top-anchor="true"
                       className="nc-tv-details-synopsis rounded-xl p-2.5 mb-3 md:mb-4 max-w-3xl max-h-40 md:max-h-56 overflow-y-auto custom-scrollbar focus:outline-none transition-colors"
                     >
                       <p className="text-gray-300 text-sm md:text-base leading-relaxed">
                         {seriesInfo.info?.plot || 'Sinopse não disponível.'}
                       </p>
                     </div>
                     <button 
                       ref={favoriteBtnRef}
                       data-autofocus="true"
                       data-scroll-block="true"
                       onClick={() => handleToggleFavorite({
                         id: seriesId,
                         name: seriesInfo.info?.name || seriesName,
                         cover: normalizeImageSource(seriesInfo.info?.cover) || normalizeImageSource(seriesCover) || '',
                         type: 'series'
                       })}
                       className="nc-tv-details-action flex items-center gap-2 px-6 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 backdrop-blur-md transition-colors w-fit font-medium text-white shadow-xl mt-1"
                     >
                       <Heart className={`w-5 h-5 ${isFavorite(seriesId, 'series') ? 'fill-nc-primary text-nc-primary' : 'text-white'}`} />
                       {isFavorite(seriesId, 'series') ? 'Favoritado' : 'Adicionar aos Favoritos'}
                     </button>
                  </div>
               </div>
            </div>

            {/* Metadata and Episodes Section */}
            <div className="nc-tv-details-body flex flex-col lg:flex-row gap-6 lg:gap-8 max-w-[1400px] w-full min-w-0 min-h-0 mx-auto px-2 sm:px-4">
               {/* Sidebar Metadata */}
               <div className="nc-tv-details-meta w-full lg:w-1/4 shrink-0 flex flex-col gap-4 lg:gap-6">
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
               <div className="flex-1 min-w-0 min-h-0 flex flex-col">
                  {/* Season Tabs */}
              {seriesInfo.episodes && Object.keys(seriesInfo.episodes).length > 0 ? (
                <>
                  <div
                    data-nav-row="true"
                    data-nav-season-row="true"
                    data-scroll-block="true"
                    className="nc-tv-season-row overflow-x-auto custom-scrollbar flex gap-2 p-1 pb-3 mb-4 border-b border-nc-border/50 shrink-0"
                  >
                    {Object.keys(seriesInfo.episodes).map((seasonNum) => {
                      const isSeasonSelected = selectedSeason === seasonNum;
                      return (
                        <button
                          key={seasonNum}
                          type="button"
                          data-season-selected={isSeasonSelected ? 'true' : 'false'}
                          onClick={() => setSelectedSeason(seasonNum)}
                          className={`nc-tv-season-btn px-5 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${isSeasonSelected ? 'bg-nc-primary text-black' : 'bg-nc-bg-card hover:bg-nc-bg-input text-nc-text-secondary'}`}
                        >
                          Temporada {seasonNum}
                        </button>
                      );
                    })}
                  </div>

                  {/* Episodes List */}
                  <div data-nav-zone="episodes" className="nc-tv-episode-list flex flex-col gap-2.5 p-1">
                    {selectedSeason && seriesInfo.episodes[selectedSeason]?.length > 0 ? (
                      seriesInfo.episodes[selectedSeason].map((episode: any) => (
                        <motion.div
                          key={episode.id}
                          tabIndex={0}
                          role="button"
                          data-nav-item="true"
                          data-episode-id={String(episode.id)}
                          data-scroll-block="true"
                          aria-label={episode.title || `Episódio ${episode.episode_num}`}
                          whileHover={{ scale: 1.01 }}
                          whileTap={{ scale: 0.99 }}
                          onClick={() => handlePlayEpisode(episode)}
                          className="nc-tv-episode-card w-full bg-nc-bg-card border border-nc-border/50 rounded-xl p-3.5 md:p-4 flex gap-3.5 md:gap-4 items-center cursor-pointer hover:border-nc-primary/50 transition-colors group"
                        >
                          <div className="nc-tv-episode-icon w-10 h-10 md:w-12 md:h-12 rounded-full bg-nc-bg-input flex items-center justify-center shrink-0 group-hover:bg-nc-primary group-hover:text-black transition-colors">
                            <Play className="w-4 h-4 md:w-5 md:h-5 ml-0.5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-white font-medium text-sm md:text-base truncate">
                              {episode.title || `Episódio ${episode.episode_num}`}
                            </h4>
                            {episode.duration && (
                              <p className="text-xs text-nc-text-secondary mt-0.5">
                                {episode.duration}
                              </p>
                            )}
                          </div>
                        </motion.div>
                      ))
                    ) : (
                      <div className="text-center py-12 text-nc-text-secondary">
                        Não há episódios disponíveis nesta temporada.
                      </div>
                    )}
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
        <div data-focus-scope="modal" className="absolute inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-nc-bg border border-nc-border/50 rounded-2xl p-6 md:p-8 max-w-sm w-full shadow-2xl flex flex-col items-center text-center animate-in zoom-in-95 duration-300">
            <h3 className="text-xl font-bold text-white mb-2">Continuar Assistindo?</h3>
            <p className="text-nc-text-secondary text-sm mb-6">
              Você já assistiu uma parte deste episódio. O que você gostaria de fazer?
            </p>
            <div className="flex flex-col gap-3 w-full">
              <button
                type="button"
                data-autofocus="true"
                ref={(el) => {
                  if (el && getNavMode() === 'remote' && document.activeElement !== el) {
                    setTimeout(() => {
                      if (el.isConnected) focusElementSafely(el);
                    }, 0);
                  }
                }}
                onClick={() => executePlay(selectedEpisode, savedProgress)}
                className="w-full py-3 bg-nc-primary text-black font-semibold rounded-xl transition-all hover:scale-105 active:scale-95"
              >
                Retomar de {Math.floor(savedProgress / 60)} min
              </button>
              <button
                type="button"
                onClick={() => executePlay(selectedEpisode, 0)}
                className="w-full py-3 bg-nc-bg-card hover:bg-nc-bg-input text-white font-medium rounded-xl transition-colors border border-nc-border/30"
              >
                Assistir do Início
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowResumeModal(false);
                  restoreEpisodeFocus();
                }}
                className="w-full py-2 mt-2 text-nc-text-secondary hover:text-white transition-colors text-sm"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {playError && (
        <div data-focus-scope="modal" className="absolute inset-0 z-[110] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-nc-bg border border-red-500/40 rounded-2xl p-6 md:p-8 max-w-md w-full shadow-2xl flex flex-col items-center text-center animate-in zoom-in-95 duration-300">
            <div className="w-14 h-14 rounded-full bg-red-500/20 flex items-center justify-center mb-4">
              <AlertCircle className="w-7 h-7 text-red-500" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Erro ao Iniciar Episódio</h3>
            <p className="text-red-400 text-sm mb-4 leading-relaxed">{playError}</p>
            <p className="text-gray-400 text-xs mb-6">
              A transmissão foi solicitada diretamente ao provedor. O endereço pode estar inacessível ou o formato requerer compatibilidade no navegador.
            </p>
            <div data-nav-row="true" className="flex gap-3 w-full">
              {failedEpisode && (
                <button
                  type="button"
                  data-autofocus="true"
                  onClick={() => executePlay(failedEpisode.episode, failedEpisode.startAt)}
                  className="flex-1 py-3 bg-nc-primary text-black font-semibold rounded-xl transition-all hover:brightness-110 flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" /> Tentar Novamente
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setPlayError(null);
                  restoreEpisodeFocus();
                }}
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
              contentType="episode"
              startAt={playingEpisodeData.startAt}
              streamId={playingEpisodeData.episode.id}
              onBack={() => {
                setPlayingEpisodeData(null);
                restoreEpisodeFocus();
              }}
              onNext={hasNext ? handleNextEpisode : undefined}
              onPrevious={hasPrev ? handlePreviousEpisode : undefined}
            />
          );
        })()}
      </AnimatePresence>

      {(favActionError || favoriteError) && (
        <div
          role="alert"
          className="fixed bottom-6 right-6 left-6 sm:left-auto sm:max-w-md z-[110] bg-red-600/90 text-white text-sm px-4 py-3 rounded-xl shadow-2xl border border-red-500/50 backdrop-blur-md flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-2"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-5 h-5 text-white shrink-0" />
            <span className="truncate sm:whitespace-normal">
              {favActionError || favoriteError}
            </span>
          </div>
          <button
            onClick={() => {
              setFavActionError(null);
              clearFavoriteError();
            }}
            className="p-1 hover:bg-white/20 rounded-lg text-white/80 hover:text-white shrink-0 transition-colors"
            aria-label="Fechar aviso"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </motion.div>
  );
}
