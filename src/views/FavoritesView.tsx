import React, { useState, useMemo } from 'react';
import { Play, Tv, Film, PlaySquare, Heart, AlertCircle, RefreshCw } from 'lucide-react';
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
  const { favorites, toggleFavorite, canImportLegacy, importLegacyFavorites } = useFavorites();
  const { credentials } = useXtreamContext();
  const [filterType, setFilterType] = useState<'all' | 'live' | 'movie' | 'series'>('all');
  const [importNotice, setImportNotice] = useState<string | null>(null);
  
  const [selectedMovie, setSelectedMovie] = useState<FavoriteItem | null>(null);
  const [selectedSeries, setSelectedSeries] = useState<FavoriteItem | null>(null);
  const [displayCount, setDisplayCount] = useState(100);
  const [favPlayError, setFavPlayError] = useState<string | null>(null);
  const [failedFav, setFailedFav] = useState<FavoriteItem | null>(null);

  React.useEffect(() => {
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

          {canImportLegacy && (
            <button
              onClick={() => {
                const res = importLegacyFavorites();
                if (res.success) {
                  setImportNotice(`${res.importedCount} favorito(s) antigo(s) importado(s) para esta conta!`);
                } else {
                  setImportNotice('Não foi possível importar os favoritos antigos.');
                }
                setTimeout(() => setImportNotice(null), 4000);
              }}
              className="px-4 py-2 bg-nc-primary/20 hover:bg-nc-primary/30 border border-nc-primary/50 text-nc-primary rounded-xl text-xs font-semibold transition-colors flex items-center gap-2 w-fit cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Importar favoritos antigos para esta conta
            </button>
          )}
        </div>

        {importNotice && (
          <div className="mb-4 p-3 bg-nc-primary/10 border border-nc-primary/30 text-nc-primary text-xs rounded-xl animate-in fade-in duration-200">
            {importNotice}
          </div>
        )}
        
        <div className="flex gap-2">
          <button onClick={() => setFilterType('all')} className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${filterType === 'all' ? 'bg-white text-black' : 'bg-nc-bg-card hover:bg-nc-bg-input text-gray-300'}`}>Todos</button>
          <button onClick={() => setFilterType('live')} className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${filterType === 'live' ? 'bg-white text-black' : 'bg-nc-bg-card hover:bg-nc-bg-input text-gray-300'}`}>Canais</button>
          <button onClick={() => setFilterType('movie')} className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${filterType === 'movie' ? 'bg-white text-black' : 'bg-nc-bg-card hover:bg-nc-bg-input text-gray-300'}`}>Filmes</button>
          <button onClick={() => setFilterType('series')} className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${filterType === 'series' ? 'bg-white text-black' : 'bg-nc-bg-card hover:bg-nc-bg-input text-gray-300'}`}>Séries</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 md:px-8 pb-8 custom-scrollbar">
        {filteredFavorites.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-nc-text-secondary">
             <Heart className="w-16 h-16 opacity-30 mb-4" />
             <p className="text-lg">Nenhum favorito encontrado.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
              {displayedFavorites.map((fav, idx) => (
                <motion.div
                  layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                key={`${fav.type}-${fav.id}`}
                className="group relative bg-nc-bg-card rounded-xl overflow-hidden cursor-pointer"
              >
                <div 
                  onClick={() => handlePlayClick(fav)}
                  className={`relative ${fav.type === 'live' ? 'aspect-video' : 'aspect-[2/3]'}`}
                >
                   <MediaImage
                        src={fav.cover}
                        serverUrl={credentials?.serverUrl}
                        alt={fav.name}
                        itemId={fav.id}
                        itemName={fav.name}
                        priority={idx < 12}
                        loading={idx < 12 ? "eager" : "lazy"}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                   <div className="absolute inset-0 bg-black/opacity-0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                      <div className="p-3 bg-nc-primary rounded-full opacity-0 group-hover:opacity-100 transform scale-75 group-hover:scale-100 transition-all shadow-xl">
                        <Play className="w-5 h-5 fill-black text-black ml-1" />
                      </div>
                   </div>
                </div>

                <div className="p-3 flex justify-between items-start gap-2">
                   <div>
                     <h3 className="font-medium text-white text-sm line-clamp-1">{fav.name}</h3>
                     <span className="text-xs text-nc-text-secondary capitalize">{fav.type === 'live' ? 'Canal' : fav.type === 'movie' ? 'Filme' : 'Série'}</span>
                   </div>
                   <button 
                     onClick={(e) => {
                       e.stopPropagation();
                       toggleFavorite(fav);
                     }}
                     className="p-1 hover:bg-white/10 rounded-full transition-colors group/btn"
                   >
                     <Heart className="w-4 h-4 fill-nc-primary text-nc-primary group-hover/btn:scale-110 transition-transform" />
                   </button>
                </div>
              </motion.div>
            ))}
          </div>
          
          {displayCount < filteredFavorites.length && (
            <div className="flex justify-center mt-8">
              <button
                onClick={() => setDisplayCount(prev => prev + 100)}
                className="px-6 py-3 bg-nc-bg-card hover:bg-nc-bg-input border border-nc-border/50 rounded-xl text-white font-medium transition-colors"
              >
                Carregar Mais Favoritos
              </button>
            </div>
          )}
          </>
        )}
      </div>
    </div>
  );
}
