import React, { useState, useMemo, useEffect } from 'react';
import { TvMinimalPlay, Loader2, Play, Heart, ArrowLeft, Calendar } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useXtreamContext } from '../context/XtreamContext';
import { useFavorites } from '../hooks/useFavorites';
import { VideoPlayer } from '../components/VideoPlayer';
import { XtreamService } from '../services/xtreamService';

interface LiveTvViewProps {
  onPlay: (url: string, title: string, startAt?: number, streamId?: string | number) => void;
  searchQuery?: string;
}

export function LiveTvView({ onPlay, searchQuery = '' }: LiveTvViewProps) {
  const { liveCategories, liveStreams, allLiveStreams, fetchLiveStreams, loadingLive, error, credentials } = useXtreamContext();
  
  // Navigation states
  const [leftPaneView, setLeftPaneView] = useState<'categories' | 'channels'>('categories');
  const [isMobilePlayerOpen, setIsMobilePlayerOpen] = useState(false);

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>();
  const [selectedChannel, setSelectedChannel] = useState<any | null>(null);
  const [displayCount, setDisplayCount] = useState(100);
  
  // States for EPG
  const [epgData, setEpgData] = useState<any[]>([]);
  const [loadingEpg, setLoadingEpg] = useState(false);

  const { favorites, isFavorite, toggleFavorite } = useFavorites();
  const [recentChannels, setRecentChannels] = useState<any[]>([]);

  const favoriteChannels = useMemo(() => {
    return favorites
      .filter(f => f.type === 'live')
      .map(f => allLiveStreams.find(s => String(s.stream_id || s.id) === String(f.id)))
      .filter(Boolean);
  }, [favorites, allLiveStreams]);

  useEffect(() => {
    if (allLiveStreams.length === 0) return;

    try {
      const watchedMap = new Map();
      
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('nc_live_history_')) {
          const channelId = key.replace('nc_live_history_', '');
          const lastWatched = Number(localStorage.getItem(key)) || 0;
          
          const item = allLiveStreams.find((c: any) => String(c.stream_id || c.id) === String(channelId));
          
          if (item) {
            watchedMap.set(channelId, { item, lastWatched });
          }
        }
      }

      const sortedItems = Array.from(watchedMap.values())
        .sort((a, b) => b.lastWatched - a.lastWatched)
        .map(w => w.item);

      setRecentChannels(sortedItems);
    } catch (error) {
      console.warn('Error reading from localStorage for continue watching live:', error);
    }
  }, [allLiveStreams]);

  const extendedCategories = useMemo(() => {
    const virtualCats = [
      { category_id: 'nc_recent', category_name: 'Canais Recentes' },
      { category_id: 'nc_fav', category_name: 'Canais Favoritos' }
    ];
    return [...virtualCats, ...liveCategories];
  }, [liveCategories]);

  // Default to first category
  useEffect(() => {
    if (extendedCategories.length > 0 && selectedCategoryId === undefined) {
      setSelectedCategoryId(extendedCategories[0].category_id);
    }
  }, [extendedCategories, selectedCategoryId]);

  // Load streams when category is selected
  useEffect(() => {
    if (selectedCategoryId && selectedCategoryId !== 'nc_recent' && selectedCategoryId !== 'nc_fav') {
      fetchLiveStreams(selectedCategoryId);
    }
    setDisplayCount(100);
  }, [selectedCategoryId, fetchLiveStreams]);

  // Handle Search query override
  useEffect(() => {
    if (searchQuery) {
      setLeftPaneView('channels');
      setDisplayCount(100);
    }
  }, [searchQuery]);

  // Fetch EPG when channel is selected
  useEffect(() => {
    let isMounted = true;
    if (selectedChannel && credentials) {
      setLoadingEpg(true);
      setEpgData([]);
      XtreamService.getShortEpg(credentials, selectedChannel.stream_id, 10)
        .then(data => {
          if (isMounted) {
            setEpgData(data?.epg_listings || []);
            setLoadingEpg(false);
          }
        })
        .catch(err => {
          if (isMounted) {
            console.error("EPG fetch error:", err);
            setLoadingEpg(false);
          }
        });
    }
    return () => { isMounted = false; };
  }, [selectedChannel, credentials]);

  const filteredStreams = useMemo(() => {
    if (searchQuery) {
      return allLiveStreams.filter(item => item.name?.toLowerCase().includes(searchQuery.toLowerCase()));
    }
    if (selectedCategoryId === 'nc_recent') return recentChannels;
    if (selectedCategoryId === 'nc_fav') return favoriteChannels;

    return liveStreams;
  }, [searchQuery, selectedCategoryId, recentChannels, favoriteChannels, liveStreams, allLiveStreams]);

  const displayedStreams = filteredStreams.slice(0, displayCount);

  // Helper to decode Base64 EPG titles safely
  const decodeBase64 = (str: string) => {
    try {
      return decodeURIComponent(escape(atob(str)));
    } catch {
      return str; // Return raw if decoding fails
    }
  };

  const activeCategory = extendedCategories.find(c => c.category_id === selectedCategoryId);

  // Build stream URL strictly for embedded player wrapper
  const getStreamUrl = (stream: any) => {
    if (!credentials) return '';
    const baseUrl = credentials.serverUrl.endsWith('/') ? credentials.serverUrl.slice(0, -1) : credentials.serverUrl;
    let rawUrl = `${baseUrl}/${credentials.username}/${credentials.password}/${stream.stream_id}.ts`;
    return rawUrl.replace('.ts', '.m3u8');
  };

  return (
    <div className="flex flex-col md:flex-row flex-1 w-full h-auto md:h-[calc(100vh-80px)] overflow-y-auto md:overflow-hidden bg-nc-bg">
      {/* Left Pane: Categories or Channels */}
      <div className={`w-full md:w-[35%] lg:w-[30%] flex-col border-r border-nc-border/50 bg-nc-bg-card/20 h-full shrink-0 flex ${isMobilePlayerOpen ? 'hidden md:flex' : 'flex'}`}>
        
        {/* Categories View */}
        {leftPaneView === 'categories' && (
          <div className="flex flex-col h-full overflow-hidden">
            <div className="p-4 border-b border-nc-border/50 bg-nc-bg shrink-0">
              <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Categorias de TV</h2>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1 custom-scrollbar">
              {loadingLive && extendedCategories.length === 2 ? (
                 <div className="flex items-center justify-center py-10">
                   <Loader2 className="w-6 h-6 animate-spin text-nc-text-secondary" />
                 </div>
              ) : (
                extendedCategories.map((cat) => (
                  <button
                    key={cat.category_id}
                    onClick={() => {
                      setSelectedCategoryId(cat.category_id);
                      setLeftPaneView('channels');
                    }}
                    className="w-full text-left px-4 py-3 rounded-xl text-sm transition-colors truncate text-nc-text-secondary hover:bg-nc-bg-input hover:text-white"
                  >
                    {cat.category_name}
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* Channels View */}
        {leftPaneView === 'channels' && (
          <div className="flex flex-col h-full overflow-hidden">
            <div className="p-4 border-b border-nc-border/50 bg-nc-bg shrink-0 flex flex-col gap-2">
              {!searchQuery && (
                <button 
                  onClick={() => setLeftPaneView('categories')}
                  className="flex items-center gap-2 text-nc-text-secondary hover:text-white text-sm w-fit transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" /> Voltar às Categorias
                </button>
              )}
              <h2 className="text-lg font-semibold text-white truncate">
                {searchQuery ? `Busca: ${searchQuery}` : activeCategory?.category_name}
              </h2>
            </div>
            
            <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
              {loadingLive && filteredStreams.length === 0 ? (
                 <div className="flex items-center justify-center py-10">
                   <Loader2 className="w-6 h-6 animate-spin text-nc-text-secondary" />
                 </div>
              ) : filteredStreams.length === 0 ? (
                 <div className="flex flex-col items-center justify-center py-10 text-nc-text-secondary">
                   <TvMinimalPlay className="w-12 h-12 mb-4 opacity-20" />
                   <p className="text-sm">Nenhum canal encontrado.</p>
                 </div>
              ) : (
                <div className="space-y-2">
                  {displayedStreams.map((stream) => (
                    <button
                      key={stream.stream_id}
                      onClick={() => {
                        setSelectedChannel(stream);
                        setIsMobilePlayerOpen(true);
                        localStorage.setItem('nc_live_history_' + stream.stream_id, Date.now().toString());
                      }}
                      className={`w-full flex items-center gap-3 p-2 rounded-xl transition-colors border ${
                        selectedChannel?.stream_id === stream.stream_id 
                          ? 'bg-nc-primary/10 border-nc-primary/30' 
                          : 'bg-transparent border-transparent hover:bg-nc-bg-input'
                      }`}
                    >
                      <div className="w-16 h-12 bg-black/40 rounded-lg shrink-0 flex items-center justify-center overflow-hidden">
                        {stream.stream_icon ? (
                           <img 
                             src={stream.stream_icon} 
                             alt={stream.name}
                             className="w-full h-full object-contain p-1"
                             onError={(e) => {
                               (e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdib3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iIzMzMyIgZD0iTTAgMGgwWjI0IDBoMloiLz48L3N2Zz4='; 
                             }}
                           />
                        ) : (
                          <TvMinimalPlay className="w-5 h-5 text-nc-text-secondary/50" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 text-left flex flex-col">
                        <p className={`font-medium text-sm truncate ${selectedChannel?.stream_id === stream.stream_id ? 'text-nc-primary' : 'text-white'}`}>
                          {stream.name}
                        </p>
                      </div>
                      <div 
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite({ id: stream.stream_id, name: stream.name, cover: stream.stream_icon || '', type: 'live' });
                        }}
                        className="p-2 shrink-0 text-nc-text-secondary hover:text-white"
                      >
                         <Heart className={`w-4 h-4 ${isFavorite(stream.stream_id, 'live') ? 'fill-nc-primary text-nc-primary' : ''}`} />
                      </div>
                    </button>
                  ))}
                  
                  {displayCount < filteredStreams.length && (
                    <button
                      onClick={() => setDisplayCount(prev => prev + 100)}
                      className="w-full py-3 mt-4 text-sm bg-nc-bg-input hover:bg-nc-bg-card rounded-xl text-nc-text-secondary transition-colors"
                    >
                      Carregar Mais
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Right Pane: Player & EPG */}
      <div className={`flex-1 min-w-0 flex-col w-full h-auto md:h-full overflow-visible md:overflow-y-auto bg-nc-bg flex ${!isMobilePlayerOpen ? 'hidden md:flex' : 'flex'}`}>
        {selectedChannel ? (
          <div className="flex flex-col w-full h-auto md:h-full overflow-visible md:overflow-y-auto">
             {/* Mobile Back Button */}
             <div className="md:hidden p-4 shrink-0 border-b border-nc-border/50 flex items-center bg-nc-bg">
               <button 
                 onClick={() => setIsMobilePlayerOpen(false)}
                 className="flex items-center gap-2 text-nc-text-secondary hover:text-white transition-colors"
               >
                 <ArrowLeft className="w-5 h-5" /> Voltar aos Canais
               </button>
             </div>

             {/* Top Section (Header + Mini-Player) */}
             <div className="flex flex-col lg:flex-row gap-4 p-4 shrink-0 border-b border-nc-border/10 bg-nc-bg">
               {/* Left child: Channel Info */}
               <div className="flex-1 min-w-0 flex flex-col items-start gap-4 order-2 lg:order-1">
                 <div className="flex items-center gap-4 w-full">
                    <div className="w-20 h-20 bg-nc-bg-card rounded-2xl flex items-center justify-center overflow-hidden shrink-0 border border-nc-border/50 p-2">
                      {selectedChannel.stream_icon ? (
                        <img 
                          src={selectedChannel.stream_icon} 
                          alt={selectedChannel.name}
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <TvMinimalPlay className="w-8 h-8 text-nc-text-secondary/50" />
                      )}
                    </div>
                    <div className="overflow-hidden min-w-0 flex-1">
                      <h1 className="text-xl md:text-2xl font-bold text-white truncate block w-full">{selectedChannel.name}</h1>
                      <span className="inline-flex items-center gap-2 px-3 py-1 mt-2 rounded-full bg-red-500/10 text-red-400 text-xs font-medium border border-red-500/20">
                        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                        AO VIVO
                      </span>
                    </div>
                 </div>
                 
                 {/* Current Program Info */}
                 {epgData && epgData.length > 0 && epgData[0] && (
                   <div className="mt-2 w-full p-4 bg-nc-bg-card/50 rounded-xl border border-nc-border/50 flex flex-col gap-1">
                      <p className="text-xs text-nc-primary font-semibold uppercase tracking-wider">Passando Agora</p>
                      <p className="text-white font-medium">{decodeBase64(epgData[0].title)}</p>
                      {epgData[0].description && (
                        <p className="text-sm text-nc-text-secondary line-clamp-2">
                          {decodeBase64(epgData[0].description)}
                        </p>
                      )}
                      <p className="text-xs text-nc-text-secondary mt-1 font-mono">
                        {epgData[0].start.split(' ')[1]?.substring(0,5)} - {epgData[0].end.split(' ')[1]?.substring(0,5)}
                      </p>
                   </div>
                 )}
               </div>

               {/* Right child: Mini-Player */}
               <div className="w-full lg:w-[45%] lg:max-w-md md:max-h-[50vh] lg:max-h-[60vh] xl:max-h-none shrink-0 order-1 lg:order-2 shadow-2xl">
                 <VideoPlayer 
                   streamUrl={getStreamUrl(selectedChannel)} 
                   title={selectedChannel.name} 
                   onBack={() => setIsMobilePlayerOpen(false)}
                   embedded={true}
                 />
               </div>
             </div>

             {/* EPG List */}
             <div className="flex-1 w-full h-auto md:h-full min-h-[300px] overflow-visible md:overflow-y-auto p-4 custom-scrollbar bg-nc-bg">
               <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2 border-b border-nc-border/50 pb-2">
                 <Calendar className="w-5 h-5 text-nc-primary" /> Programação
               </h3>
               
               {loadingEpg ? (
                 <div className="flex items-center justify-center py-10">
                   <Loader2 className="w-8 h-8 animate-spin text-nc-primary" />
                 </div>
               ) : epgData && epgData.length > 0 ? (
                 <div className="space-y-3 relative before:absolute before:inset-0 before:ml-[3.5rem] before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-nc-border/50 before:to-transparent pb-8">
                   {epgData.map((prog: any, idx: number) => {
                     return (
                       <div key={idx} className="relative flex items-start justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                         {/* Timeline Marker */}
                         <div className={`flex items-center justify-center w-8 h-8 rounded-full border-2 bg-nc-bg shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow absolute left-[3.5rem] md:left-1/2 -translate-x-1/2 top-4 md:top-1/2 md:-translate-y-1/2 transition-colors ${idx === 0 ? 'border-nc-primary text-nc-primary' : 'border-nc-border/50 text-nc-text-secondary'}`}>
                            <div className={`w-2.5 h-2.5 rounded-full ${idx === 0 ? 'bg-nc-primary' : 'bg-transparent'}`}></div>
                         </div>
                         
                         {/* EPG Card */}
                         <div className="w-[calc(100%-4.5rem)] md:w-[calc(50%-2.5rem)] ml-[4.5rem] md:ml-0 p-4 rounded-xl border border-nc-border/50 bg-nc-bg-card hover:bg-nc-bg-input transition-colors">
                           <div className="flex flex-col gap-1">
                             <div className={`text-xs font-semibold uppercase tracking-wider ${idx === 0 ? 'text-nc-primary' : 'text-nc-text-secondary'}`}>
                               {prog.start.split(' ')[1]?.substring(0,5)} - {prog.end.split(' ')[1]?.substring(0,5)}
                             </div>
                             <h4 className={`font-medium text-base ${idx === 0 ? 'text-white' : 'text-white/80'}`}>
                               {decodeBase64(prog.title)}
                             </h4>
                             {prog.description && (
                               <p className="text-sm text-nc-text-secondary line-clamp-2 mt-1">
                                 {decodeBase64(prog.description)}
                               </p>
                             )}
                           </div>
                         </div>
                       </div>
                     );
                   })}
                 </div>
               ) : (
                 <div className="text-center py-10 bg-nc-bg-card/30 rounded-xl border border-nc-border/50">
                   <p className="text-nc-text-secondary">Nenhuma programação disponível (EPG Vazio).</p>
                 </div>
               )}
             </div>
          </div>
        ) : (
          <div className="flex-col h-full flex items-center justify-center p-6 text-center text-nc-text-secondary bg-nc-bg">
             <div className="w-24 h-24 rounded-full bg-nc-bg-card flex items-center justify-center mb-6 shadow-xl">
               <TvMinimalPlay className="w-12 h-12 text-nc-text-secondary/50" />
             </div>
             <h2 className="text-xl md:text-2xl font-bold text-white mb-2">Selecione um Canal</h2>
             <p className="max-w-md">Escolha um canal na lista à esquerda para assistir e visualizar sua grade de programação ao vivo.</p>
          </div>
        )}
      </div>
    </div>
  );
}
