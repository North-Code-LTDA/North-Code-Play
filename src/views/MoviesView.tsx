import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Film, Loader2, Play, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useXtreamContext } from '../context/XtreamContext';
import { MovieDetails } from '../components/MovieDetails';
import { useFavorites } from '../hooks/useFavorites';
import { MediaImage } from '../components/MediaImage';
import { useAccountPlaybackHistory } from '../utils/playbackHistory';
import { formatCategoryLabel } from '../utils/categoryLabel';
import {
  useBackHandler,
  BACK_PRIORITY,
  focusElementSafely,
  isElementFocusable,
} from '../navigation';


interface MoviesViewProps {
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

export function MoviesView({ onPlay, searchQuery = '' }: MoviesViewProps) {
  const { 
    vodCategories, vodStreams, allVodStreams, fetchVodStreams, 
    loadingVod, vodError, vodCategoriesError, vodCategoriesStatus,
    vodCatalogStatus, fetchVodCategories, credentials 
  } = useXtreamContext();
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>();
  const [selectedMovie, setSelectedMovie] = useState<any>(null);
  const [displayCount, setDisplayCount] = useState(100);
  const { favorites } = useFavorites();

  const historyRecords = useAccountPlaybackHistory(credentials);

  const viewRootRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const prevCategoryRef = useRef<string | undefined>(selectedCategoryId);
  const prevSearchRef = useRef<string>(searchQuery);

  // Back policy: when focus is inside the movies content area (and no details/player modal is open),
  // first Back focuses the currently selected category without changing category, scrollTop, or view.
  useBackHandler(
    'movies-content-to-category',
    BACK_PRIORITY.VIEW_INTERNAL,
    () => {
      if (selectedMovie) return false;
      const activeEl = document.activeElement as HTMLElement | null;
      if (!activeEl || !mainRef.current || !mainRef.current.contains(activeEl)) {
        return false;
      }
      if (activeEl.closest('[data-nav-zone="categories"]')) {
        return false;
      }

      const root = viewRootRef.current || document.body;
      const categoryBtns = (
        Array.from(
          root.querySelectorAll('[data-nav-zone="categories"] button[data-category-id]')
        ) as HTMLButtonElement[]
      ).filter((btn) => isElementFocusable(btn));

      const targetBtn =
        categoryBtns.find((btn) => btn.getAttribute('data-category-id') === String(selectedCategoryId)) ||
        categoryBtns[0];

      if (targetBtn) {
        focusElementSafely(targetBtn);
        return true;
      }
      return false;
    },
    !selectedMovie
  );

  const handleSelectCategory = (catId: string) => {
    if (catId === selectedCategoryId) return; // Do not reset scroll if same category is clicked
    setSelectedCategoryId(catId);
    if (mainRef.current) {
      mainRef.current.scrollTop = 0;
    }
  };

  const favoriteMovies = useMemo(() => {
    return favorites
      .filter(f => f.type === 'movie')
      .map(f => allVodStreams.find(s => String(s.stream_id || s.id) === String(f.id)))
      .filter(Boolean);
  }, [favorites, allVodStreams]);

  const continueWatching = useMemo(() => {
    if (!allVodStreams || allVodStreams.length === 0) return [];
    const movieRecords = historyRecords.filter(
      (r) => r.type === 'movie' && (r.positionSec ?? 0) > 30
    );

    const result: any[] = [];
    const seenIds = new Set<string | number>();

    for (const record of movieRecords) {
      const item = allVodStreams.find(
        (c: any) => String(c.stream_id || c.id) === String(record.id)
      );
      if (item) {
        const itemId = item.stream_id || item.id;
        if (!seenIds.has(itemId)) {
          seenIds.add(itemId);
          result.push(item);
        }
      }
    }

    return result;
  }, [historyRecords, allVodStreams]);

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
    if (selectedCategoryId !== prevCategoryRef.current) {
      prevCategoryRef.current = selectedCategoryId;
      if (mainRef.current) {
        mainRef.current.scrollTop = 0;
      }
      setDisplayCount(100); // Reset display count on category change
    }
  }, [selectedCategoryId, fetchVodStreams]);

  React.useEffect(() => {
    if (searchQuery !== prevSearchRef.current) {
      prevSearchRef.current = searchQuery;
      if (mainRef.current) {
        mainRef.current.scrollTop = 0;
      }
      setDisplayCount(100); // Reset display count on search change
    }
  }, [searchQuery]);

  const filteredStreams = useMemo(() => {
    if (searchQuery) {
      return allVodStreams.filter(item => item.name?.toLowerCase().includes(searchQuery.toLowerCase()));
    }
    if (selectedCategoryId === 'nc_recent') return continueWatching;
    if (selectedCategoryId === 'nc_fav') return favoriteMovies;
    
    return vodStreams;
  }, [searchQuery, selectedCategoryId, continueWatching, favoriteMovies, vodStreams, allVodStreams]);

  useEffect(() => {
    if (selectedMovie || displayCount >= filteredStreams.length) return;

    const root = mainRef.current;
    const sentinel = sentinelRef.current;

    if (!root || !sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setDisplayCount(prev => prev + 100);
        }
      },
      {
        root: root,
        rootMargin: '200px',
        threshold: 0,
      }
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [selectedMovie, displayCount, filteredStreams.length]);

  const displayedStreams = filteredStreams.slice(0, displayCount);

  return (
    <div ref={viewRootRef} className="flex flex-1 overflow-hidden h-full relative">
      {/* Sidebar - Categories */}
      <aside data-nav-zone="categories" className="nc-tv-category-pane hidden md:flex w-full md:w-[35%] lg:w-[30%] flex-col border-r border-nc-border/50 bg-nc-bg-card/30 h-full shrink-0">
        <div className="p-4 border-b border-nc-border/50">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Categorias de Filmes</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar">
          {vodCategoriesError && vodCategories.length === 0 && (
            <div className="p-3 mb-2 bg-red-500/10 border border-red-500/30 rounded-xl flex flex-col items-center justify-center text-center gap-2">
              <p className="text-xs text-red-400">{vodCategoriesError}</p>
              <button
                type="button"
                onClick={() => fetchVodCategories()}
                className="flex items-center gap-1.5 px-3 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg text-xs font-medium transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Tentar novamente
              </button>
            </div>
          )}
          {vodCategoriesStatus === 'loading' && extendedCategories.length === 2 ? (
             <div className="flex items-center justify-center py-10">
               <Loader2 className="w-6 h-6 animate-spin text-nc-text-secondary" />
             </div>
          ) : (
            <>
              {extendedCategories.map((cat) => (
                <button
                  key={cat.category_id}
                  type="button"
                  data-category-id={String(cat.category_id)}
                  data-category-selected={selectedCategoryId === cat.category_id ? 'true' : 'false'}
                  onClick={() => handleSelectCategory(cat.category_id)}
                  className={`nc-tv-category-btn w-full text-left px-4 py-2.5 rounded-lg text-sm transition-colors line-clamp-2 whitespace-normal break-words leading-snug ${selectedCategoryId === cat.category_id ? 'bg-nc-primary text-black font-medium' : 'text-nc-text-secondary hover:bg-nc-bg-input hover:text-white'}`}
                >
                  {formatCategoryLabel(cat.category_name, 'vod')}
                </button>
              ))}
            </>
          )}
        </div>
      </aside>

      {/* Main Content - Streams Grid */}
      <main ref={mainRef} data-nav-zone="content" data-scroll-container="true" className="flex-1 overflow-y-auto h-full custom-scrollbar flex flex-col">
        {/* Mobile Categories Navbar */}
        <div data-nav-zone="categories" data-nav-row="true" className="md:hidden w-full overflow-x-auto snap-x flex gap-2 p-4 border-b border-nc-border/50 custom-scrollbar shrink-0">
          {vodCategoriesError && vodCategories.length === 0 && (
            <button
              type="button"
              onClick={() => fetchVodCategories()}
              className="shrink-0 snap-center px-4 py-2 rounded-full text-sm bg-red-500/20 text-red-300 font-medium flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Recarregar categorias
            </button>
          )}
          {extendedCategories.map((cat) => (
            <button
              key={cat.category_id}
              type="button"
              data-category-id={String(cat.category_id)}
              data-category-selected={selectedCategoryId === cat.category_id ? 'true' : 'false'}
              onClick={() => handleSelectCategory(cat.category_id)}
              className={`shrink-0 snap-center px-4 py-2 rounded-full text-sm transition-colors whitespace-nowrap ${selectedCategoryId === cat.category_id ? 'bg-nc-primary text-black font-medium' : 'bg-nc-bg-card hover:bg-nc-bg-input text-nc-text-secondary'}`}
            >
              {formatCategoryLabel(cat.category_name, 'vod')}
            </button>
          ))}
        </div>

            <div className="nc-tv-content-pad p-6 flex-1">
              {vodError && (
                <div className="mb-6 p-4 bg-red-500/10 border border-red-500/50 text-red-500 rounded-xl flex items-center justify-between">
                  <span>{vodError}</span>
                  <button
                    type="button"
                    onClick={() => fetchVodStreams(selectedCategoryId)}
                    className="ml-4 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-white rounded-lg text-xs font-medium transition-colors"
                  >
                    Tentar novamente
                  </button>
                </div>
              )}

              <div className="mb-6">
                <h1 className="text-2xl font-semibold text-white">
                  {selectedCategoryId 
                     ? formatCategoryLabel(extendedCategories.find(c => c.category_id === selectedCategoryId)?.category_name, 'vod') 
                     : 'Carregando...'}
                </h1>
                <p className="text-nc-text-secondary text-sm mt-1">
                  {filteredStreams.length} filmes encontrados
                </p>
              </div>

              {vodCatalogStatus === 'loading' && filteredStreams.length === 0 ? (
                 <div className="flex items-center justify-center h-64">
                   <Loader2 className="w-10 h-10 animate-spin text-nc-text-secondary" />
                 </div>
              ) : vodCatalogStatus === 'ready' && !vodError && filteredStreams.length === 0 ? (
                 <div className="flex flex-col items-center justify-center h-64 text-nc-text-secondary">
                   <Film className="w-16 h-16 mb-4 opacity-20" />
                   <p>Nenhum filme encontrado nesta categoria.</p>
                 </div>
              ) : (
                <>
                  <div data-nav-grid="true" className="nc-tv-media-grid grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                   {displayedStreams.map((stream, idx) => (
                     <motion.div
                       key={stream.stream_id}
                       tabIndex={0}
                       role="button"
                       data-nav-item="true"
                       aria-label={stream.name}
                       whileHover={{ scale: 1.05 }}
                       whileTap={{ scale: 0.95 }}
                       onClick={() => {
                         setSelectedMovie(stream);
                       }}
                       className="group relative aspect-[2/3] bg-nc-bg-card rounded-xl overflow-hidden cursor-pointer border border-nc-border/50 hover:border-nc-primary/50 transition-colors"
                     >
                       <MediaImage
                          src={stream.stream_icon}
                          serverUrl={credentials?.serverUrl}
                          alt={stream.name}
                          itemId={stream.stream_id}
                          itemName={stream.name}
                          priority={idx < 12}
                          loading={idx < 12 ? "eager" : "lazy"}
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                       
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
                    <div ref={sentinelRef} className="h-10 w-full" />
                  )}
                </>
              )}
            </div>
          </main>

      {/* Movie Details Layer - rendered on top without unmounting the list */}
      <AnimatePresence>
        {selectedMovie && (
          <MovieDetails 
            streamId={selectedMovie.stream_id} 
            streamName={selectedMovie.name}
            streamIcon={selectedMovie.stream_icon}
            onClose={() => setSelectedMovie(null)}
            onPlay={onPlay}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
