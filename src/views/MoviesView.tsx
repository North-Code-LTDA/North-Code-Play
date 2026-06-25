import React, { useState, useMemo, useEffect } from 'react';
import { Film, Loader2, Play } from 'lucide-react';
import { motion } from 'motion/react';
import { useXtreamContext } from '../context/XtreamContext';
import { MovieDetails } from '../components/MovieDetails';
import { useFavorites } from '../hooks/useFavorites';

interface MoviesViewProps {
  onPlay: (url: string, title: string, startAt?: number, streamId?: string | number) => void;
  searchQuery?: string;
}

export function MoviesView({ onPlay, searchQuery = '' }: MoviesViewProps) {
  const { vodCategories, vodStreams, allVodStreams, fetchVodStreams, loadingVod, error, credentials } = useXtreamContext();
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>();
  const [selectedMovie, setSelectedMovie] = useState<any>(null);
  const [displayCount, setDisplayCount] = useState(100);
  const { favorites } = useFavorites();
  const [continueWatching, setContinueWatching] = useState<any[]>([]);

  const favoriteMovies = useMemo(() => {
    return favorites
      .filter(f => f.type === 'movie')
      .map(f => allVodStreams.find(s => String(s.stream_id || s.id) === String(f.id)))
      .filter(Boolean);
  }, [favorites, allVodStreams]);

  useEffect(() => {
    if (allVodStreams.length === 0) return;

    try {
      const watchedMap = new Map();
      
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('nc_progress_')) {
          const progressId = key.replace('nc_progress_', '');
          const value = Number(localStorage.getItem(key));
          
          if (value > 30) {
            const item = allVodStreams.find((c: any) => String(c.stream_id || c.id) === String(progressId));
            
            if (item) {
              const itemId = item.stream_id || item.id;
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
      console.warn('Error reading from localStorage for continue watching movies:', error);
    }
  }, [allVodStreams]);

  const extendedCategories = useMemo(() => {
    const virtualCats = [
      { category_id: 'nc_recent', category_name: 'Assistidos Recentemente' },
      { category_id: 'nc_fav', category_name: 'Filmes Favoritos' }
    ];
    return [...virtualCats, ...vodCategories];
  }, [vodCategories]);

  // Default to first category
  React.useEffect(() => {
    if (extendedCategories.length > 0 && selectedCategoryId === undefined) {
      setSelectedCategoryId(extendedCategories[0].category_id);
    }
  }, [extendedCategories, selectedCategoryId]);

  // Fetch streams when category changes
  React.useEffect(() => {
    if (selectedCategoryId && selectedCategoryId !== 'nc_recent' && selectedCategoryId !== 'nc_fav') {
      fetchVodStreams(selectedCategoryId);
    }
    setDisplayCount(100); // Reset display count on category change
  }, [selectedCategoryId, fetchVodStreams]);

  React.useEffect(() => {
    setDisplayCount(100); // Reset display count on search change
  }, [searchQuery]);

  const filteredStreams = useMemo(() => {
    if (searchQuery) {
      return allVodStreams.filter(item => item.name?.toLowerCase().includes(searchQuery.toLowerCase()));
    }
    if (selectedCategoryId === 'nc_recent') return continueWatching;
    if (selectedCategoryId === 'nc_fav') return favoriteMovies;
    
    return vodStreams;
  }, [searchQuery, selectedCategoryId, continueWatching, favoriteMovies, vodStreams, allVodStreams]);

  const displayedStreams = filteredStreams.slice(0, displayCount);

  return (
    <div className="flex flex-1 overflow-hidden h-full relative">
      {selectedMovie ? (
        <MovieDetails 
          streamId={selectedMovie.stream_id} 
          streamName={selectedMovie.name}
          streamIcon={selectedMovie.stream_icon}
          onClose={() => setSelectedMovie(null)}
          onPlay={onPlay}
        />
      ) : (
        <>
          {/* Sidebar - Categories */}
          <aside data-tv-zone="sidebar" className="hidden md:flex w-full md:w-[35%] lg:w-[30%] flex-col border-r border-nc-border/50 bg-nc-bg-card/30 h-full shrink-0">
            <div className="p-4 border-b border-nc-border/50">
              <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Categorias de Filmes</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar">
              {loadingVod && extendedCategories.length === 2 ? (
                 <div className="flex items-center justify-center py-10">
                   <Loader2 className="w-6 h-6 animate-spin text-nc-text-secondary" />
                 </div>
              ) : (
                <>
                  {extendedCategories.map((cat) => (
                    <button
                      key={cat.category_id}
                      tabIndex={0}
                      onClick={() => setSelectedCategoryId(cat.category_id)}
                      className={`tv-focus w-full text-left px-4 py-2.5 rounded-lg text-sm transition-colors truncate ${selectedCategoryId === cat.category_id ? 'bg-nc-primary text-black font-medium' : 'text-nc-text-secondary hover:bg-nc-bg-input hover:text-white'}`}
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
                  tabIndex={0}
                  data-tv-zone="main"
                  onClick={() => setSelectedCategoryId(cat.category_id)}
                  className={`tv-focus shrink-0 snap-center px-4 py-2 rounded-full text-sm transition-colors whitespace-nowrap ${selectedCategoryId === cat.category_id ? 'bg-nc-primary text-black font-medium' : 'bg-nc-bg-card hover:bg-nc-bg-input text-nc-text-secondary'}`}
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
                  {filteredStreams.length} filmes encontrados
                </p>
              </div>

              {loadingVod && filteredStreams.length === 0 ? (
                 <div className="flex items-center justify-center h-64">
                   <Loader2 className="w-10 h-10 animate-spin text-nc-text-secondary" />
                 </div>
              ) : filteredStreams.length === 0 ? (
                 <div className="flex flex-col items-center justify-center h-64 text-nc-text-secondary">
                   <Film className="w-16 h-16 mb-4 opacity-20" />
                   <p>Nenhum filme encontrado nesta categoria.</p>
                 </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                   {displayedStreams.map((stream) => (
                     <motion.div
                       key={stream.stream_id}
                       tabIndex={0}
                       data-tv-zone="main"
                       whileHover={{ scale: 1.05 }}
                       whileTap={{ scale: 0.95 }}
                       onClick={() => {
                         setSelectedMovie(stream);
                       }}
                       className="tv-focus group relative aspect-[2/3] bg-nc-bg-card rounded-xl overflow-hidden cursor-pointer border border-nc-border/50 hover:border-nc-primary/50 transition-colors"
                     >
                       {stream.stream_icon ? (
                         <img 
                           src={stream.stream_icon} 
                           alt={stream.name}
                           className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                           loading="lazy"
                           onError={(e) => {
                             (e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdib3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iIzMzMyIgZD0iTTAgMGgwWjI0IDBoMloiLz48L3N2Zz4='; // fallback transparent
                           }}
                         />
                       ) : (
                         <div className="w-full h-full flex flex-col items-center justify-center bg-nc-bg-input">
                           <Film className="w-8 h-8 text-nc-text-secondary/30 mb-2" />
                         </div>
                       )}
                       
                       <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
                         <p className="text-white font-medium text-sm line-clamp-2 leading-tight">
                           {stream.name}
                         </p>
                         {stream.rating && stream.rating !== "0" && (
                            <p className="text-xs text-yellow-500 mt-1">★ {stream.rating}</p>
                         )}
                         <div className="mt-2 flex items-center justify-center w-8 h-8 rounded-full bg-nc-primary text-black">
                           <Play className="w-4 h-4 ml-0.5" />
                         </div>
                       </div>
                     </motion.div>
                   ))}
                 </div>
                 
                 {displayCount < filteredStreams.length && (
                    <div className="mt-8 flex justify-center">
                      <button
                        tabIndex={0}
                        data-tv-zone="main"
                        onClick={() => setDisplayCount(prev => prev + 100)}
                        className="tv-focus px-6 py-3 bg-nc-bg-card hover:bg-nc-bg-input border border-nc-border/50 rounded-xl text-white font-medium transition-colors"
                      >
                        Carregar Mais
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </main>
        </>
      )}
    </div>
  );
}
