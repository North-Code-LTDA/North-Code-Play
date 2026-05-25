import React, { useState, useMemo } from 'react';
import { Play, Tv, Film, PlaySquare, Heart } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useFavorites, FavoriteItem } from '../hooks/useFavorites';
import { useXtreamContext } from '../context/XtreamContext';
import { MovieDetails } from '../components/MovieDetails';
import { SeriesDetails } from '../components/SeriesDetails';

interface FavoritesViewProps {
  onPlay: (url: string, title: string) => void;
  searchQuery?: string;
}

export function FavoritesView({ onPlay, searchQuery = '' }: FavoritesViewProps) {
  const { favorites, toggleFavorite } = useFavorites();
  const { credentials } = useXtreamContext();
  const [filterType, setFilterType] = useState<'all' | 'live' | 'movie' | 'series'>('all');
  
  const [selectedMovie, setSelectedMovie] = useState<FavoriteItem | null>(null);
  const [selectedSeries, setSelectedSeries] = useState<FavoriteItem | null>(null);
  const [displayCount, setDisplayCount] = useState(100);

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
       // Live TV URLs
       const url = fav.extraData?.url || `${credentials.serverUrl.endsWith('/') ? credentials.serverUrl.slice(0, -1) : credentials.serverUrl}/${credentials.username}/${credentials.password}/${fav.id}.m3u8`;
       onPlay(url, fav.name);
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

      <div className="p-6 md:p-8 shrink-0">
        <h1 className="text-3xl font-bold text-white mb-6 flex items-center gap-2">
          <Heart className="w-8 h-8 fill-nc-primary text-nc-primary" /> Meus Favoritos
        </h1>
        
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
              {displayedFavorites.map((fav) => (
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
                   {fav.cover ? (
                     <img 
                       src={fav.cover} 
                       alt={fav.name}
                       className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                     />
                   ) : (
                     <div className="w-full h-full bg-nc-bg-input flex items-center justify-center">
                       {fav.type === 'live' && <Tv className="w-8 h-8 text-nc-text-secondary" />}
                       {fav.type === 'movie' && <Film className="w-8 h-8 text-nc-text-secondary" />}
                       {fav.type === 'series' && <PlaySquare className="w-8 h-8 text-nc-text-secondary" />}
                     </div>
                   )}
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
