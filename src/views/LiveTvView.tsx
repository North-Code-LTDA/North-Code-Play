import React, { useState, useMemo } from 'react';
import { TvMinimalPlay, Loader2, Play, Heart } from 'lucide-react';
import { motion } from 'motion/react';
import { useXtreamContext } from '../context/XtreamContext';
import { useFavorites } from '../hooks/useFavorites';

interface LiveTvViewProps {
  onPlay: (url: string, title: string) => void;
  searchQuery?: string;
}

export function LiveTvView({ onPlay, searchQuery = '' }: LiveTvViewProps) {
  const { liveCategories, liveStreams, allLiveStreams, fetchLiveStreams, loadingLive, error, credentials } = useXtreamContext();
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>();
  const [displayCount, setDisplayCount] = useState(100);

  // Default to first category
  React.useEffect(() => {
    if (liveCategories.length > 0 && selectedCategoryId === undefined) {
      setSelectedCategoryId(liveCategories[0].category_id);
    }
  }, [liveCategories, selectedCategoryId]);

  // Fetch streams when category changes
  React.useEffect(() => {
    if (selectedCategoryId) {
      fetchLiveStreams(selectedCategoryId);
      setDisplayCount(100); // Reset display count on category change
    }
  }, [selectedCategoryId, fetchLiveStreams]);
  
  React.useEffect(() => {
    setDisplayCount(100); // Reset display count on search change
  }, [searchQuery]);

  const sourceStreams = searchQuery && searchQuery.length > 0 ? allLiveStreams : liveStreams;
  
  const filteredStreams = useMemo(() => {
    if (!searchQuery) return sourceStreams;
    return sourceStreams.filter(stream => stream.name?.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [sourceStreams, searchQuery]);

  const displayedStreams = filteredStreams.slice(0, displayCount);

  const { isFavorite, toggleFavorite } = useFavorites();

  return (
    <div className="flex flex-1 overflow-hidden h-full">
      {/* Sidebar - Categories */}
      <aside className="hidden md:flex w-64 border-r border-nc-border/50 bg-nc-bg-card/30 flex-col h-full shrink-0">
        <div className="p-4 border-b border-nc-border/50">
          <h2 className="text-xs font-semibold text-nc-text-secondary uppercase tracking-wider">Categorias de TV</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar">
          {loadingLive && liveCategories.length === 0 ? (
             <div className="flex items-center justify-center py-10">
               <Loader2 className="w-6 h-6 animate-spin text-nc-text-secondary" />
             </div>
          ) : (
            <>
              {liveCategories.map((cat) => (
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
          {liveCategories.map((cat) => (
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
                 ? liveCategories.find(c => c.category_id === selectedCategoryId)?.category_name 
                 : 'Carregando...'}
            </h1>
            <p className="text-nc-text-secondary text-sm mt-1">
              {filteredStreams.length} canais encontrados
            </p>
          </div>

          {loadingLive && filteredStreams.length === 0 ? (
             <div className="flex items-center justify-center h-64">
               <Loader2 className="w-10 h-10 animate-spin text-nc-text-secondary" />
             </div>
          ) : filteredStreams.length === 0 ? (
             <div className="flex flex-col items-center justify-center h-64 text-nc-text-secondary">
               <TvMinimalPlay className="w-16 h-16 mb-4 opacity-20" />
               <p>Nenhum canal encontrado nesta categoria.</p>
             </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
               {displayedStreams.map((stream) => (
                 <motion.div
                   key={stream.stream_id}
                   whileHover={{ scale: 1.05 }}
                   whileTap={{ scale: 0.95 }}
                   onClick={() => {
                     if (!credentials) return;
                     // Build TS connection then replace with HLS
                     const baseUrl = credentials.serverUrl.endsWith('/') ? credentials.serverUrl.slice(0, -1) : credentials.serverUrl;
                     let rawUrl = `${baseUrl}/${credentials.username}/${credentials.password}/${stream.stream_id}.ts`;
                     // Replace .ts with .m3u8 dynamically to force HLS format for the web player
                     rawUrl = rawUrl.replace('.ts', '.m3u8');
                     
                     onPlay(rawUrl, stream.name);
                   }}
                   className="group relative aspect-video bg-nc-bg-card rounded-xl overflow-hidden cursor-pointer border border-nc-border/50 hover:border-nc-primary/50 transition-colors"
                 >
                   {stream.stream_icon ? (
                     <img 
                       src={stream.stream_icon} 
                       alt={stream.name}
                       className="w-full h-full object-contain p-4 bg-black/40 group-hover:opacity-50 transition-opacity"
                       loading="lazy"
                       onError={(e) => {
                         (e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdib3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iIzMzMyIgZD0iTTAgMGgwWjI0IDBoMloiLz48L3N2Zz4='; // fallback transparent
                       }}
                     />
                   ) : (
                     <div className="w-full h-full flex flex-col items-center justify-center bg-nc-bg-input">
                       <TvMinimalPlay className="w-8 h-8 text-nc-text-secondary/30 mb-2" />
                     </div>
                   )}
                   
                   <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
                     <p className="text-white font-medium text-sm line-clamp-2 leading-tight">
                       {stream.name}
                     </p>
                     <div className="mt-2 flex items-center justify-center w-8 h-8 rounded-full bg-nc-primary text-black">
                       <Play className="w-4 h-4 ml-0.5" />
                     </div>
                   </div>
                   <button 
                     onClick={(e) => {
                       e.stopPropagation();
                       toggleFavorite({
                         id: stream.stream_id,
                         name: stream.name,
                         cover: stream.stream_icon || '',
                         type: 'live'
                       });
                     }}
                     className="absolute top-2 right-2 p-2 rounded-full border border-white/10 bg-black/40 hover:bg-black/60 transition-colors z-10 hidden sm:block group-hover:block"
                   >
                     <Heart className={`w-4 h-4 ${isFavorite(stream.stream_id, 'live') ? 'fill-nc-primary text-nc-primary' : 'text-white'}`} />
                   </button>
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
    </div>
  );
}
