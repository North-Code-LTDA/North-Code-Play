import React, { useState, useMemo, useEffect } from 'react';
import { Play, Tv, Film, PlaySquare, Heart, AlertCircle, RefreshCw, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useFavorites, FavoriteItem } from '../hooks/useFavorites';
import { useXtreamContext } from '../context/XtreamContext';
import { MovieDetails } from '../components/MovieDetails';
import { SeriesDetails } from '../components/SeriesDetails';
import { MediaImage } from '../components/MediaImage';
import { buildDirectMediaUrl } from '../utils/mediaUtils';

interface FavoritesViewProps {
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

export function FavoritesView({ onPlay, searchQuery = '' }: FavoritesViewProps) {
  const { favorites, toggleFavorite, favoriteError, clearFavoriteError } = useFavorites();
  const { credentials } = useXtreamContext();
  const [filterType, setFilterType] = useState<'all' | 'live' | 'movie' | 'series'>('all');
  
  const [selectedMovie, setSelectedMovie] = useState<FavoriteItem | null>(null);
  const [selectedSeries, setSelectedSeries] = useState<FavoriteItem | null>(null);
  const [displayCount, setDisplayCount] = useState(100);
  const [favPlayError, setFavPlayError] = useState<string | null>(null);
  const [failedFav, setFailedFav] = useState<FavoriteItem | null>(null);
  const [favActionError, setFavActionError] = useState<string | null>(null);

  useEffect(() => {
    if (favActionError) {
      const timer = setTimeout(() => {
        setFavActionError(null);
        clearFavoriteError();
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [favActionError, clearFavoriteError]);

  const handleToggleFavorite = (fav: FavoriteItem) => {
    const success = toggleFavorite(fav);
    if (!success) {
      setFavActionError('Não foi possível salvar os favoritos neste dispositivo. Tente novamente.');
    } else {
      setFavActionError(null);
    }
  };

  useEffect(() => {
    setDisplayCount(100);
  }, [searchQuery, filterType]);

  const filteredFavorites = useMemo(() => {
    return favorites.filter(fav => {
      const matchesSearch = fav.name?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesType = filterType === 'all' || fav.type === filterType;
      return matchesSearch && matchesType;
    });
  }, [favorites, searchQuery, filterType]);

  const displayedFavorites = filteredFavorites.slice(0, displayCount);

  const handlePlayClick = (fav: FavoriteItem) => {
    if (!credentials) return;

    if (fav.type === 'live') {
      try {
        setFavPlayError(null);
        setFailedFav(null);
        const url = buildDirectMediaUrl(credentials, {
          type: 'live',
          streamId: fav.id,
          allowedOutputFormats: credentials.allowed_output_formats,
        });
        onPlay(url, fav.name, 0, fav.id, 'live', fav.name);
      } catch (err: any) {
        console.error('Erro ao iniciar canal favorito:', err.message);
        setFavPlayError(err?.message || 'Falha ao iniciar canal favorito.');
        setFailedFav(fav);
      }
    } else if (fav.type === 'movie') {
      setSelectedMovie(fav);
    } else if (fav.type === 'series') {
      setSelectedSeries(fav);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden h-full relative">
      <AnimatePresence>
        {selectedMovie && (
          <MovieDetails
            streamId={selectedMovie.id}
            streamName={selectedMovie.name}
            streamIcon={selectedMovie.cover}
            onClose={() => setSelectedMovie(null)}
            onPlay={onPlay}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedSeries && (
          <SeriesDetails
            seriesId={selectedSeries.id}
            seriesName={selectedSeries.name}
            seriesCover={selectedSeries.cover}
            onClose={() => setSelectedSeries(null)}
            onPlay={onPlay}
          />
        )}
      </AnimatePresence>

      {favPlayError && (
        <div className="absolute inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-nc-bg border border-red-500/40 rounded-2xl p-6 md:p-8 max-w-md w-full shadow-2xl flex flex-col items-center text-center animate-in zoom-in-95 duration-300">
            <div className="w-14 h-14 rounded-full bg-red-500/20 flex items-center justify-center mb-4">
              <AlertCircle className="w-7 h-7 text-red-500" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Erro ao Iniciar Canal</h3>
            <p className="text-red-400 text-sm mb-4 leading-relaxed">{favPlayError}</p>
            <div className="flex gap-3 w-full">
              {failedFav && (
                <button
                  onClick={() => handlePlayClick(failedFav)}
                  className="flex-1 py-3 bg-nc-primary text-black font-semibold rounded-xl transition-all hover:brightness-110 flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" /> Tentar Novamente
                </button>
              )}
              <button
                onClick={() => setFavPlayError(null)}
                className="flex-1 py-3 bg-nc-bg-card hover:bg-nc-bg-input text-white font-medium rounded-xl transition-colors border border-nc-border/50"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="p-6 md:p-8 shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <h1 className="text-3xl font-bold text-white flex items-center gap-2">
            <Heart className="w-8 h-8 fill-nc-primary text-nc-primary" /> Meus Favoritos
          </h1>
        </div>
        
        <div className="flex gap-2">
          <button
            onClick={() => setFilterType('all')}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              filterType === 'all'
                ? 'bg-white text-black'
                : 'bg-nc-bg-card hover:bg-nc-bg-input text-gray-300'
            }`}
          >
            Todos
          </button>
          <button
            onClick={() => setFilterType('live')}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              filterType === 'live'
                ? 'bg-white text-black'
                : 'bg-nc-bg-card hover:bg-nc-bg-input text-gray-300'
            }`}
          >
            Canais
          </button>
          <button
            onClick={() => setFilterType('movie')}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              filterType === 'movie'
                ? 'bg-white text-black'
                : 'bg-nc-bg-card hover:bg-nc-bg-input text-gray-300'
            }`}
          >
            Filmes
          </button>
          <button
            onClick={() => setFilterType('series')}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              filterType === 'series'
                ? 'bg-white text-black'
                : 'bg-nc-bg-card hover:bg-nc-bg-input text-gray-300'
            }`}
          >
            Séries
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 md:p-8 pt-0">
        {displayedFavorites.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-gray-500">
            <Heart className="w-12 h-12 mb-3 stroke-1 text-gray-600" />
            <p className="text-lg">Nenhum favorito encontrado</p>
            <p className="text-sm text-gray-600 mt-1">
              {searchQuery ? 'Tente buscar por outro termo' : 'Adicione canais, filmes ou séries aos seus favoritos'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {displayedFavorites.map((fav) => (
              <motion.div
                key={`${fav.type}-${fav.id}`}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="group relative bg-nc-bg-card border border-nc-border rounded-xl overflow-hidden hover:border-nc-primary/50 transition-colors flex flex-col"
              >
                <div 
                  className="aspect-[2/3] w-full bg-nc-bg-input relative overflow-hidden cursor-pointer"
                  onClick={() => handlePlayClick(fav)}
                >
                  <MediaImage
                    src={fav.cover}
                    alt={fav.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div className="w-12 h-12 rounded-full bg-nc-primary flex items-center justify-center text-black shadow-lg transform scale-75 group-hover:scale-100 transition-transform">
                      <Play className="w-6 h-6 fill-current ml-1" />
                    </div>
                  </div>
                  <div className="absolute top-2 left-2 px-2 py-0.5 rounded text-[10px] font-bold bg-black/60 backdrop-blur-md text-white border border-white/10 uppercase flex items-center gap-1">
                    {fav.type === 'live' && <Tv className="w-3 h-3 text-red-500" />}
                    {fav.type === 'movie' && <Film className="w-3 h-3 text-blue-500" />}
                    {fav.type === 'series' && <PlaySquare className="w-3 h-3 text-green-500" />}
                    {fav.type === 'live' ? 'TV' : fav.type === 'movie' ? 'Filme' : 'Série'}
                  </div>
                </div>

                <div className="p-3 flex items-center justify-between gap-2 flex-1">
                  <span 
                    className="text-sm font-medium text-white truncate cursor-pointer hover:text-nc-primary transition-colors flex-1"
                    onClick={() => handlePlayClick(fav)}
                    title={fav.name}
                  >
                    {fav.name}
                  </span>
                  <button
                    onClick={() => handleToggleFavorite(fav)}
                    className="text-nc-primary hover:scale-110 transition-transform p-1 cursor-pointer shrink-0"
                    title="Remover dos favoritos"
                  >
                    <Heart className="w-5 h-5 fill-current" />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

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
    </div>
  );
}
