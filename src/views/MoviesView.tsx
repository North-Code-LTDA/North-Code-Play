import React, { useState } from 'react';
import { Film, Loader2, Play } from 'lucide-react';
import { motion } from 'motion/react';
import { useXtreamContext } from '../context/XtreamContext';

interface MoviesViewProps {
  onPlay: (url: string, title: string) => void;
}

export function MoviesView({ onPlay }: MoviesViewProps) {
  const { vodCategories, vodStreams, fetchVodStreams, loadingVod, error, credentials } = useXtreamContext();
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>();

  // Default to first category
  React.useEffect(() => {
    if (vodCategories.length > 0 && selectedCategoryId === undefined) {
      setSelectedCategoryId(vodCategories[0].category_id);
    }
  }, [vodCategories, selectedCategoryId]);

  // Fetch streams when category changes
  React.useEffect(() => {
    if (selectedCategoryId) {
      fetchVodStreams(selectedCategoryId);
    }
  }, [selectedCategoryId, fetchVodStreams]);

  return (
    <div className="flex flex-1 overflow-hidden h-full">
      {/* Sidebar - Categories */}
      <aside className="hidden md:flex w-64 border-r border-nc-border/50 bg-nc-bg-card/30 flex-col h-full shrink-0">
        <div className="p-4 border-b border-nc-border/50">
          <h2 className="text-xs font-semibold text-nc-text-secondary uppercase tracking-wider">Categorias de Filmes</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar">
          {loadingVod && vodCategories.length === 0 ? (
             <div className="flex items-center justify-center py-10">
               <Loader2 className="w-6 h-6 animate-spin text-nc-text-secondary" />
             </div>
          ) : (
            <>
              {vodCategories.map((cat) => (
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
        <div className="md:hidden h-16 w-full shrink-0" /> {/* Spacer for mobile header */}
        
        {/* Mobile Categories Navbar */}
        <div className="md:hidden w-full overflow-x-auto snap-x flex gap-2 p-4 border-b border-nc-border/50 custom-scrollbar shrink-0">
          {vodCategories.map((cat) => (
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
                 ? vodCategories.find(c => c.category_id === selectedCategoryId)?.category_name 
                 : 'Carregando...'}
            </h1>
            <p className="text-nc-text-secondary text-sm mt-1">
              {vodStreams.length} filmes encontrados
            </p>
          </div>

          {loadingVod && vodStreams.length === 0 ? (
             <div className="flex items-center justify-center h-64">
               <Loader2 className="w-10 h-10 animate-spin text-nc-text-secondary" />
             </div>
          ) : vodStreams.length === 0 ? (
             <div className="flex flex-col items-center justify-center h-64 text-nc-text-secondary">
               <Film className="w-16 h-16 mb-4 opacity-20" />
               <p>Nenhum filme encontrado nesta categoria.</p>
             </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
             {vodStreams.map((stream) => (
               <motion.div
                 key={stream.stream_id}
                 whileHover={{ scale: 1.05 }}
                 whileTap={{ scale: 0.95 }}
                 onClick={() => {
                   if (!credentials) return;
                   const ext = stream.container_extension || "mp4";
                   const rawUrl = `${credentials.serverUrl.endsWith('/') ? credentials.serverUrl.slice(0, -1) : credentials.serverUrl}/movie/${credentials.username}/${credentials.password}/${stream.stream_id}.${ext}`;
                   onPlay(rawUrl, stream.name);
                 }}
                 className="group relative aspect-[2/3] bg-nc-bg-card rounded-xl overflow-hidden cursor-pointer border border-nc-border/50 hover:border-nc-primary/50 transition-colors"
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
          )}
        </div>
      </main>
    </div>
  );
}
