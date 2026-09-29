import React, { useEffect, useState } from 'react';
import { Play, ArrowLeft, Loader2, Star, Calendar, Clock, Info, Heart } from 'lucide-react';
import { useXtreamContext } from '../context/XtreamContext';
import { XtreamService } from '../services/xtreamService';
import { useFavorites } from '../hooks/useFavorites';
import { buildDirectMediaUrl, buildDirectImageUrl } from '../utils/mediaUtils';

interface MovieDetailsProps {
  key?: React.Key;
  streamId: string | number;
  streamName: string;
  streamIcon?: string;
  onClose: () => void;
  onPlay: (url: string, title: string, startAt?: number, streamId?: string | number) => void;
}

export function MovieDetails({ streamId, streamName, streamIcon, onClose, onPlay }: MovieDetailsProps) {
  const { credentials } = useXtreamContext();
  const { isFavorite, toggleFavorite } = useFavorites();
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState<any>(null);
  const [movieData, setMovieData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [savedProgress, setSavedProgress] = useState(0);

  useEffect(() => {
    async function fetchInfo() {
      if (!credentials) return;
      try {
        setLoading(true);
        setError(null);
        const data = await XtreamService.getVodInfo(credentials, streamId);
        // Explicitly preserve both info and movie_data
        setInfo(data.info || {});
        setMovieData(data.movie_data || {});
      } catch (err: any) {
        setError(err.message || 'Erro ao carregar os detalhes do filme.');
      } finally {
        setLoading(false);
      }
    }
    fetchInfo();
  }, [credentials, streamId]);

  const requestFullscreen = () => {
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch((e) => console.log(e));
    }
  };

  const executePlay = (startAt: number = 0) => {
    if (startAt === 0) {
      localStorage.removeItem('nc_progress_' + streamId);
    }
    requestFullscreen();
    if (!credentials) return;
    try {
      // Use real container_extension from movie_data or info
      const rawExt = movieData?.container_extension || info?.container_extension || "mp4";
      const ext = String(rawExt).trim().replace(/^\./, "");
      const mediaUrl = buildDirectMediaUrl(credentials, {
        type: 'movie',
        streamId,
        containerExtension: ext,
      });
      onPlay(mediaUrl, streamName, startAt, streamId);
      setShowResumeModal(false);
    } catch (err: any) {
      setError(err.message || 'Erro ao preparar vídeo.');
    }
  };

  const handlePlayClick = () => {
    const progress = Number(localStorage.getItem('nc_progress_' + streamId)) || 0;
    if (progress > 30) {
      setSavedProgress(progress);
      setShowResumeModal(true);
    } else {
      executePlay(0);
    }
  };

  const handlePlay = handlePlayClick; // To backward compatibility on error screen

  if (loading) {
    return (
      <div className="absolute inset-0 z-50 bg-nc-bg flex flex-col items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-nc-primary mb-4" />
        <p className="text-nc-text-secondary">Carregando detalhes...</p>
      </div>
    );
  }

  if (error || !info) {
    return (
      <div className="absolute inset-0 z-50 bg-nc-bg flex flex-col items-center justify-center p-6 text-center">
        <Info className="w-12 h-12 text-red-500 mb-4" />
        <h2 className="text-xl font-medium text-white mb-2">Ops, algo deu errado</h2>
        <p className="text-nc-text-secondary mb-6">{error || 'Informações não disponíveis.'}</p>
        <div className="flex gap-4">
          <button onClick={onClose} className="px-6 py-2 bg-nc-bg-card hover:bg-nc-bg-input text-white rounded-lg transition-colors">Voltar</button>
          <button onClick={handlePlay} className="px-6 py-2 bg-nc-primary text-black font-medium rounded-lg transition-colors flex items-center gap-2">
            <Play className="w-4 h-4 fill-black" /> Formatar de qualquer forma
          </button>
        </div>
      </div>
    );
  }

  const rawCover = info.backdrop_path && info.backdrop_path.length > 0 
      ? (info.backdrop_path[0] || info.cover_big || info.movie_image)
      : (info.cover_big || info.movie_image || streamIcon);
  const coverImage = buildDirectImageUrl(rawCover);

  const durationMin = info.duration ? info.duration.split(':')[0] + 'm' : null;

  return (
    <div className="absolute inset-0 z-[50] bg-nc-bg w-full h-full overflow-hidden">
      
      {/* Fixed Page Background */}
      {coverImage && (
        <div className="absolute inset-0 z-0 pointer-events-none">
          <img 
            src={coverImage} 
            alt="background"
            className="w-full h-full object-cover opacity-20 blur-3xl scale-110"
          />
          <div className="absolute inset-0 bg-nc-bg/60" />
        </div>
      )}

      {/* Scrolling Content */}
      <div className="absolute inset-0 z-10 overflow-y-auto custom-scrollbar flex flex-col">
        {/* Hero Section */}
        <div className="relative w-full min-h-[50vh] md:min-h-[65vh] shrink-0 z-10 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black z-0">
            {coverImage && (
              <img 
                src={coverImage} 
                alt={info.name || streamName} 
                className="w-full h-full object-cover object-top opacity-60"
              />
            )}
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-nc-bg via-nc-bg/40 to-transparent z-0" />
          <div className="absolute inset-0 bg-gradient-to-r from-nc-bg via-nc-bg/60 to-transparent z-0" />
          
          <button 
            onClick={onClose}
            className="absolute top-6 left-6 p-3 bg-black/40 hover:bg-black/60 backdrop-blur-md rounded-full text-white transition-colors z-[60] cursor-pointer"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>

          <div className="relative z-20 p-6 md:p-12 pt-32">
            <div className="max-w-4xl">
            <h1 className="text-3xl md:text-5xl font-bold text-white mb-4 animate-in fade-in slide-in-from-bottom-4 duration-700">
              {info.name || streamName}
            </h1>
            
            <div className="flex items-center gap-4 text-sm md:text-base font-medium text-nc-text-secondary mb-6 animate-in fade-in slide-in-from-bottom-5 duration-700 delay-100">
              {info.rating && info.rating !== "0" && (
                <span className="flex items-center gap-1 text-green-400">
                  <Star className="w-4 h-4 fill-green-400" />
                  {info.rating} Relevância
                </span>
              )}
              {info.releasedate && (
                <span className="flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  {new Date(info.releasedate).getFullYear() || info.releasedate}
                </span>
              )}
              {durationMin && (
                <span className="flex items-center gap-1">
                  <Clock className="w-4 h-4" />
                  {durationMin}
                </span>
              )}
              {info.genre && (
                <span className="px-2 py-0.5 rounded border border-nc-border/50 text-xs text-nc-text-secondary">
                  {info.genre}
                </span>
              )}
            </div>

            <div className="flex items-center gap-4 animate-in fade-in slide-in-from-bottom-6 duration-700 delay-200">
              <button 
                onClick={handlePlay}
                className="flex items-center gap-3 bg-nc-primary hover:bg-nc-primary/90 text-black px-8 py-3.5 rounded-xl font-semibold w-fit transition-transform active:scale-95"
              >
                <Play className="w-6 h-6 fill-black m-0 p-0" />
                <span className="text-lg">Assistir</span>
              </button>
              
              <button 
                onClick={() => toggleFavorite({
                  id: streamId,
                  name: info.name || streamName,
                  cover: coverImage || streamIcon || '',
                  type: 'movie'
                })}
                className="flex items-center justify-center p-3.5 rounded-xl bg-white/10 hover:bg-white/20 backdrop-blur-md transition-colors"
                title="Favoritar"
              >
                <Heart className={`w-6 h-6 ${isFavorite(streamId, 'movie') ? 'fill-nc-primary text-nc-primary' : 'text-white'}`} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Details Section */}
      <div className="p-6 md:p-12 pt-4 flex-1 z-10 relative">
        <div className="max-w-4xl grid grid-cols-1 md:grid-cols-3 gap-8 bg-nc-bg/40 backdrop-blur-md p-8 rounded-3xl border border-white/5">
          <div className="md:col-span-2 space-y-6">
            <div>
              <p className="text-gray-200 text-lg leading-relaxed mix-blend-plus-lighter drop-shadow-md">
                {info.plot || 'Sinopse não disponível.'}
              </p>
            </div>
          </div>
          
          <div className="space-y-4">
            {info.director && (
              <div>
                <span className="text-nc-text-secondary/70 text-sm block">Diretor</span>
                <span className="text-white text-sm">{info.director}</span>
              </div>
            )}
            {info.cast && (
              <div>
                <span className="text-nc-text-secondary/70 text-sm block">Elenco</span>
                <span className="text-white text-sm leading-relaxed">{info.cast}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {showResumeModal && (
        <div className="absolute inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-nc-bg border border-nc-border/50 rounded-2xl p-6 md:p-8 max-w-sm w-full shadow-2xl flex flex-col items-center text-center animate-in zoom-in-95 duration-300">
            <h3 className="text-xl font-bold text-white mb-2">Continuar Assistindo?</h3>
            <p className="text-nc-text-secondary text-sm mb-6">
              Você já assistiu uma parte deste filme. O que você gostaria de fazer?
            </p>
            <div className="flex flex-col gap-3 w-full">
              <button
                onClick={() => executePlay(savedProgress)}
                className="w-full py-3 bg-nc-primary text-black font-semibold rounded-xl transition-all hover:scale-105 active:scale-95"
              >
                Retomar de {Math.floor(savedProgress / 60)} min
              </button>
              <button
                onClick={() => executePlay(0)}
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

    </div>
  </div>
  );
}
