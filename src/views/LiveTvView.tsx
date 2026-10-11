import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { TvMinimalPlay, Loader2, Play, Heart, ArrowLeft, Calendar, AlertCircle, RefreshCw, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useXtreamContext } from '../context/XtreamContext';
import { useFavorites, FavoriteItem } from '../hooks/useFavorites';
import { VideoPlayer } from '../components/VideoPlayer';
import { MediaImage } from '../components/MediaImage';
import { XtreamService } from '../services/xtreamService';
import { buildDirectMediaUrl } from '../utils/mediaUtils';
import { useAccountPlaybackHistory, recordPlaybackPosition } from '../utils/playbackHistory';
import { formatCategoryLabel } from '../utils/categoryLabel';
import {
  groupLiveStreams,
  searchMatchesGroup,
  getInitialVariant,
  LiveChannelGroup,
  ChannelResolution,
  ChannelVariant,
  STABILITY_ORDER,
} from '../utils/liveChannelGroups';

interface LiveTvViewProps {
  onPlay: (url: string, title: string, startAt?: number, streamId?: string | number) => void;
  searchQuery?: string;
}

export function LiveTvView({ onPlay, searchQuery = '' }: LiveTvViewProps) {
  const { 
    liveCategories, liveStreams, allLiveStreams, fetchLiveStreams, 
    loadingLive, liveError, liveCategoriesError, liveCategoriesStatus,
    liveCatalogStatus, fetchLiveCategories, credentials 
  } = useXtreamContext();
  
  // Navigation states
  const [leftPaneView, setLeftPaneView] = useState<'categories' | 'channels'>('categories');
  const [isMobilePlayerOpen, setIsMobilePlayerOpen] = useState(false);

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>('nc_recent');
  const [displayCount, setDisplayCount] = useState(100);

  // Logical channel group and active resolution state
  const [selectedGroup, setSelectedGroup] = useState<LiveChannelGroup | null>(null);
  const [activeVariant, setActiveVariant] = useState<ChannelVariant | null>(null);
  const [selectedResolutionMode, setSelectedResolutionMode] = useState<ChannelResolution | 'auto'>('auto');
  const [selectedChannel, setSelectedChannel] = useState<any | null>(null);
  
  // States for EPG
  const [epgData, setEpgData] = useState<any[]>([]);
  const [loadingEpg, setLoadingEpg] = useState(false);

  const { favorites, isFavorite, toggleFavorite, favoriteError, clearFavoriteError } = useFavorites();
  const [favActionError, setFavActionError] = useState<string | null>(null);

  const historyRecords = useAccountPlaybackHistory(credentials);

  // Session memory for successful variants in this LiveTvView session: Map<groupId, resolution>
  const lastSuccessfulVariantRef = useRef<Map<string, ChannelResolution>>(new Map());

  // Track attempted stream_ids in current fallback round to prevent loops
  const attemptedStreamIdsRef = useRef<Set<number | string>>(new Set());

  // Sequencer to ignore stale callbacks and timeouts from previous attempts or channels
  const attemptSeqRef = useRef<number>(0);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const favoriteChannels = useMemo(() => {
    return favorites
      .filter(f => f.type === 'live')
      .map(f => allLiveStreams.find(s => String(s.stream_id || s.id) === String(f.id)))
      .filter(Boolean);
  }, [favorites, allLiveStreams]);

  const recentChannels = useMemo(() => {
    if (!allLiveStreams || allLiveStreams.length === 0) return [];
    const liveRecords = historyRecords.filter((r) => r.type === 'live');

    const result: any[] = [];
    const seenIds = new Set<string | number>();

    for (const record of liveRecords) {
      const item = allLiveStreams.find(
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
  }, [historyRecords, allLiveStreams]);

  // Extended categories with virtual items
  const extendedCategories = useMemo(() => {
    const virtualCats = [
      { category_id: 'nc_recent', category_name: 'Assistidos Recentemente' },
      { category_id: 'nc_fav', category_name: 'Canais Favoritos' }
    ];
    return [...virtualCats, ...liveCategories];
  }, [liveCategories]);

  // Set default category
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
            const rawListings = Array.isArray(data?.epg_listings) ? data.epg_listings : [];
            const validListings = rawListings.filter(
              (item: any) => item !== null && typeof item === 'object' && !Array.isArray(item)
            );
            setEpgData(validListings);
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
  }, [selectedChannel?.stream_id, credentials]);

  // Raw streams for the current view before grouping
  const rawStreams = useMemo(() => {
    if (searchQuery) {
      return allLiveStreams;
    }
    if (selectedCategoryId === 'nc_recent') return recentChannels;
    if (selectedCategoryId === 'nc_fav') return favoriteChannels;

    return liveStreams;
  }, [searchQuery, selectedCategoryId, recentChannels, favoriteChannels, liveStreams, allLiveStreams]);

  // Grouped channels
  const channelGroups = useMemo(() => {
    const groups = groupLiveStreams(rawStreams, selectedCategoryId);
    if (!searchQuery) return groups;
    return groups.filter((g) => searchMatchesGroup(g, searchQuery));
  }, [rawStreams, selectedCategoryId, searchQuery]);

  const displayedGroups = channelGroups.slice(0, displayCount);

  // Helper to decode Base64 EPG titles safely
  const decodeBase64 = (val: unknown): string => {
    if (typeof val !== 'string') return '';
    try {
      return decodeURIComponent(escape(atob(val)));
    } catch {
      return val;
    }
  };

  // Helper to extract HH:mm from time string safely without timezone conversion
  const formatEpgTime = (val: unknown): string | null => {
    if (typeof val !== 'string') return null;
    const trimmed = val.trim();
    if (!trimmed) return null;
    const parts = trimmed.split(/\s+/);
    const timePart = parts.length > 1 ? parts[1] : parts[0];
    if (!timePart) return null;
    const timeSub = timePart.substring(0, 5);
    if (/^\d{1,2}:\d{2}$/.test(timeSub)) {
      return timeSub.padStart(5, '0');
    }
    return null;
  };

  const activeCategory = extendedCategories.find(c => c.category_id === selectedCategoryId);

  // Player state
  const [miniPlayerUrl, setMiniPlayerUrl] = useState<string>('');
  const [miniPlayerError, setMiniPlayerError] = useState<string | null>(null);
  const [miniPlayerLoading, setMiniPlayerLoading] = useState(false);

  // Fallback to next variant within the selected group
  const triggerNextVariantFallback = useCallback((
    group: LiveChannelGroup,
    seq: number,
    _failureReason?: string
  ) => {
    if (attemptSeqRef.current !== seq) return;
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }

    if (!group.isGroup || group.variants.length <= 1) {
      setMiniPlayerLoading(false);
      setMiniPlayerError('Falha ao reproduzir canal.');
      return;
    }

    // Procura próxima variante na ordem de estabilidade que ainda não foi tentada nesta rodada
    const nextCandidate = STABILITY_ORDER
      .map((res) => group.variants.find((v) => v.resolution === res))
      .filter((v): v is ChannelVariant => Boolean(v && !attemptedStreamIdsRef.current.has(v.stream.stream_id)))[0];

    if (nextCandidate) {
      attemptedStreamIdsRef.current.add(nextCandidate.stream.stream_id);
      setActiveVariant(nextCandidate);
      setSelectedChannel(nextCandidate.stream);
      setMiniPlayerLoading(true);
      setMiniPlayerError(null);

      const nextSeq = ++attemptSeqRef.current;
      try {
        const url = buildDirectMediaUrl(credentials, {
          type: 'live',
          streamId: nextCandidate.stream.stream_id,
          allowedOutputFormats: credentials?.allowed_output_formats,
        });
        setMiniPlayerUrl(url);
      } catch (err: any) {
        triggerNextVariantFallback(group, nextSeq, err.message);
        return;
      }

      fallbackTimerRef.current = setTimeout(() => {
        if (attemptSeqRef.current === nextSeq) {
          triggerNextVariantFallback(group, nextSeq, 'Tempo limite de conexão');
        }
      }, 28000);
    } else {
      // Todas as variantes falharam nesta rodada
      setMiniPlayerLoading(false);
      setMiniPlayerError('Todas as versões disponíveis deste canal falharam ao reproduzir.');
    }
  }, [credentials]);

  // Seleciona um grupo de canais e inicia a primeira variante
  const handleSelectGroup = useCallback((
    group: LiveChannelGroup,
    targetResolution?: ChannelResolution | 'auto'
  ) => {
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }

    const isSameGroup = selectedGroup?.id === group.id;
    const resMode = targetResolution !== undefined
      ? targetResolution
      : (isSameGroup ? selectedResolutionMode : 'auto');

    setSelectedResolutionMode(resMode);
    attemptedStreamIdsRef.current.clear();
    const currentSeq = ++attemptSeqRef.current;

    // Resolução inicial: manual, ou último sucesso nesta sessão, ou FHD -> HD -> SD -> 4K
    const lastSuccess = lastSuccessfulVariantRef.current.get(group.id);
    const initialVar = getInitialVariant(group, resMode, lastSuccess);

    attemptedStreamIdsRef.current.add(initialVar.stream.stream_id);
    setSelectedGroup(group);
    setActiveVariant(initialVar);
    setSelectedChannel(initialVar.stream);
    setMiniPlayerLoading(true);
    setMiniPlayerError(null);

    try {
      const url = buildDirectMediaUrl(credentials, {
        type: 'live',
        streamId: initialVar.stream.stream_id,
        allowedOutputFormats: credentials?.allowed_output_formats,
      });
      setMiniPlayerUrl(url);
    } catch (err: any) {
      setMiniPlayerLoading(false);
      setMiniPlayerError(err.message || 'Falha ao conectar à transmissão.');
      return;
    }

    // Prazo de fallback de 28 segundos se nenhuma reprodução iniciar
    fallbackTimerRef.current = setTimeout(() => {
      if (attemptSeqRef.current === currentSeq) {
        triggerNextVariantFallback(group, currentSeq, 'Tempo limite de conexão');
      }
    }, 28000);
  }, [credentials, selectedGroup?.id, selectedResolutionMode, triggerNextVariantFallback]);

  // Callback de sucesso real na reprodução
  const handlePlaybackSuccess = useCallback(() => {
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    setMiniPlayerLoading(false);
    setMiniPlayerError(null);

    if (selectedGroup && activeVariant) {
      lastSuccessfulVariantRef.current.set(selectedGroup.id, activeVariant.resolution);

      // Registra no histórico apenas o stream_id que realmente reproduziu com sucesso
      if (credentials) {
        recordPlaybackPosition(credentials, {
          id: activeVariant.stream.stream_id,
          type: 'live',
        });
      }
    }
  }, [selectedGroup, activeVariant, credentials]);

  // Callback de erro fatal na reprodução
  const handlePlaybackFatalError = useCallback((errMsg: string) => {
    if (selectedGroup) {
      triggerNextVariantFallback(selectedGroup, attemptSeqRef.current, errMsg);
    }
  }, [selectedGroup, triggerNextVariantFallback]);

  // Fechamento de canal / mini-player
  const handleCloseChannel = useCallback(() => {
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    attemptSeqRef.current++;
    setSelectedGroup(null);
    setSelectedChannel(null);
    setActiveVariant(null);
    setMiniPlayerUrl('');
    setMiniPlayerLoading(false);
    setMiniPlayerError(null);
    setSelectedResolutionMode('auto');
    setIsMobilePlayerOpen(false);
  }, []);

  // Limpeza de timers ao desmontar o componente
  useEffect(() => {
    return () => {
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
    };
  }, []);

  // Checagem e alternância de favoritos para um grupo
  const isGroupFavorited = useCallback((group: LiveChannelGroup) => {
    return group.streams.some((s) => isFavorite(s.stream_id, 'live'));
  }, [isFavorite]);

  const handleToggleGroupFavorite = useCallback((group: LiveChannelGroup, e: React.MouseEvent) => {
    e.stopPropagation();
    const isFav = isGroupFavorited(group);
    if (isFav) {
      group.streams.forEach((s) => {
        if (isFavorite(s.stream_id, 'live')) {
          handleToggleFavorite({ id: s.stream_id, name: s.name, cover: s.stream_icon || '', type: 'live' });
        }
      });
    } else {
      const target = activeVariant?.stream || group.primaryStream;
      handleToggleFavorite({ id: target.stream_id, name: target.name, cover: target.stream_icon || '', type: 'live' });
    }
  }, [isGroupFavorited, isFavorite, activeVariant]);

  return (
    <div className="flex w-full h-full overflow-hidden bg-nc-bg relative">
      {/* Toast de Erro ao Favoritar */}
      {favActionError && (
        <div
          role="alert"
          className="fixed bottom-6 right-6 left-6 sm:left-auto sm:max-w-md z-[120] bg-red-600/90 text-white text-sm px-4 py-3 rounded-xl shadow-2xl border border-red-500/50 backdrop-blur-md flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-2"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-5 h-5 text-white shrink-0" />
            <span className="truncate sm:whitespace-normal">{favActionError}</span>
          </div>
          <button
            onClick={() => { setFavActionError(null); clearFavoriteError(); }}
            className="p-1 hover:bg-white/20 rounded-lg text-white/80 hover:text-white shrink-0 transition-colors"
            aria-label="Fechar aviso"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Left Pane: Categories or Channel List */}
      <div className={`w-full md:w-80 lg:w-96 border-r border-nc-border/50 flex flex-col h-full bg-nc-bg shrink-0 ${isMobilePlayerOpen ? 'hidden md:flex' : 'flex'}`}>
        {/* Categories View */}
        {leftPaneView === 'categories' && (
          <div className="flex flex-col h-full overflow-hidden">
            <div className="p-4 border-b border-nc-border/50 bg-nc-bg shrink-0">
              <h2 className="text-lg font-semibold text-white">Categorias</h2>
            </div>
            
            <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
              {liveCategoriesError && liveCategories.length === 0 && (
                <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex flex-col items-center justify-center text-center gap-3 my-2">
                  <p className="text-sm text-red-400">{liveCategoriesError}</p>
                  <button
                    onClick={() => fetchLiveCategories()}
                    className="flex items-center gap-1.5 px-3 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg text-xs font-medium transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Tentar novamente
                  </button>
                </div>
              )}
              {liveCategoriesStatus === 'loading' && extendedCategories.length === 2 ? (
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
                    {formatCategoryLabel(cat.category_name, 'live')}
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
                {searchQuery ? `Busca: ${searchQuery}` : formatCategoryLabel(activeCategory?.category_name, 'live')}
              </h2>
            </div>
            
            <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
              {liveError && channelGroups.length === 0 ? (
                <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex flex-col items-center justify-center text-center gap-3 my-4">
                  <p className="text-sm text-red-400">{liveError}</p>
                  <button
                    onClick={() => fetchLiveStreams(selectedCategoryId)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg text-xs font-medium transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Tentar novamente
                  </button>
                </div>
              ) : liveCatalogStatus === 'loading' && channelGroups.length === 0 ? (
                 <div className="flex items-center justify-center py-10">
                   <Loader2 className="w-6 h-6 animate-spin text-nc-text-secondary" />
                 </div>
              ) : liveCatalogStatus === 'ready' && !liveError && channelGroups.length === 0 ? (
                 <div className="flex flex-col items-center justify-center py-10 text-nc-text-secondary">
                   <TvMinimalPlay className="w-12 h-12 mb-4 opacity-20" />
                   <p className="text-sm">Nenhum canal encontrado.</p>
                 </div>
              ) : (
                <div className="space-y-2">
                  {displayedGroups.map((group, idx) => {
                    const isSelected = selectedGroup?.id === group.id;
                    const primary = group.primaryStream;
                    return (
                      <button
                        key={group.id}
                        onClick={() => {
                          handleSelectGroup(group);
                          setIsMobilePlayerOpen(true);
                        }}
                        className={`w-full flex items-center gap-3 p-2 rounded-xl transition-colors border ${
                          isSelected 
                            ? 'bg-nc-primary/10 border-nc-primary/30' 
                            : 'bg-transparent border-transparent hover:bg-nc-bg-input'
                        }`}
                      >
                        <div className="w-16 h-12 bg-black/40 rounded-lg shrink-0 flex items-center justify-center overflow-hidden">
                          <MediaImage
                            src={primary.stream_icon}
                            serverUrl={credentials?.serverUrl}
                            alt={group.name}
                            itemId={primary.stream_id}
                            itemName={group.name}
                            priority={idx < 15}
                            loading={idx < 15 ? 'eager' : 'lazy'}
                            className="w-full h-full object-contain p-1"
                          />
                        </div>
                        <div className="flex-1 min-w-0 text-left flex flex-col">
                          <p className={`font-medium text-sm truncate ${isSelected ? 'text-nc-primary' : 'text-white'}`}>
                            {group.name}
                          </p>
                          {group.isGroup && (
                            <span className="text-[11px] text-nc-text-secondary/80 font-mono mt-0.5">
                              {group.variants.map(v => v.resolution).join(' · ')}
                            </span>
                          )}
                        </div>
                        <div 
                          onClick={(e) => handleToggleGroupFavorite(group, e)}
                          className="p-2 shrink-0 text-nc-text-secondary hover:text-white"
                          title="Favoritar canal"
                        >
                          <Heart className={`w-4 h-4 ${isGroupFavorited(group) ? 'fill-nc-primary text-nc-primary' : ''}`} />
                        </div>
                      </button>
                    );
                  })}
                  
                  {displayCount < channelGroups.length && (
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
        {selectedGroup && selectedChannel ? (
          <div className="flex flex-col w-full h-auto md:h-full overflow-visible md:overflow-y-auto">
             {/* Mobile Back Button */}
             <div className="md:hidden p-4 shrink-0 border-b border-nc-border/50 flex items-center bg-nc-bg">
               <button 
                 onClick={handleCloseChannel}
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
                      <MediaImage
                        src={selectedChannel.stream_icon || selectedGroup.primaryStream.stream_icon}
                        serverUrl={credentials?.serverUrl}
                        alt={selectedGroup.name}
                        itemId={selectedChannel.stream_id}
                        itemName={selectedGroup.name}
                        priority={true}
                        loading="eager"
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <div className="overflow-hidden min-w-0 flex-1">
                      <h1 className="text-xl md:text-2xl font-bold text-white truncate block w-full">
                        {selectedGroup.name}
                      </h1>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-500/10 text-red-400 text-xs font-medium border border-red-500/20">
                          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                          AO VIVO
                        </span>
                        {activeVariant && (
                          <span className="px-2.5 py-0.5 rounded-full bg-white/[0.08] text-white/90 text-xs font-mono font-medium border border-nc-border/40">
                            {activeVariant.resolution}
                          </span>
                        )}
                      </div>
                    </div>
                 </div>

                 {/* Seletor Discreto de Versão do Canal */}
                 {selectedGroup.isGroup && selectedGroup.variants.length > 1 && (
                   <div className="w-full p-3 bg-nc-bg-card/40 rounded-xl border border-nc-border/40 flex flex-wrap items-center gap-2.5 text-xs">
                     <span className="text-nc-text-secondary font-medium">Versão do canal:</span>
                     <div className="flex items-center gap-1.5 flex-wrap">
                       <button
                         type="button"
                         onClick={() => handleSelectGroup(selectedGroup, 'auto')}
                         className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                           selectedResolutionMode === 'auto'
                             ? 'bg-nc-primary text-black font-semibold shadow-sm'
                             : 'bg-white/[0.04] text-nc-text-secondary hover:text-white hover:bg-white/[0.08] border border-nc-border/40'
                         }`}
                       >
                         Automático
                       </button>
                       {selectedGroup.variants.map((v) => {
                         const isCurrent = activeVariant?.resolution === v.resolution;
                         const isSelectedManual = selectedResolutionMode === v.resolution;
                         return (
                           <button
                             type="button"
                             key={v.resolution}
                             onClick={() => handleSelectGroup(selectedGroup, v.resolution)}
                             className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 border ${
                               isSelectedManual
                                 ? 'bg-nc-primary text-black font-semibold border-nc-primary shadow-sm'
                                 : isCurrent
                                   ? 'bg-white/20 text-white border-nc-border/80'
                                   : 'bg-white/[0.04] text-nc-text-secondary hover:text-white hover:bg-white/[0.08] border-nc-border/40'
                             }`}
                           >
                             <span>{v.resolution}</span>
                             {isCurrent && (
                               <span
                                 className="w-1.5 h-1.5 rounded-full bg-emerald-400"
                                 title="Versão ativa"
                               />
                             )}
                           </button>
                         );
                       })}
                     </div>
                   </div>
                 )}
                 
                 {/* Current Program Info */}
                 {epgData && epgData.length > 0 && epgData[0] && (
                   <div className="mt-2 w-full p-4 bg-nc-bg-card/50 rounded-xl border border-nc-border/50 flex flex-col gap-1">
                      <p className="text-xs text-nc-primary font-semibold uppercase tracking-wider">Passando Agora</p>
                      {decodeBase64(epgData[0].title) && (
                        <p className="text-white font-medium">{decodeBase64(epgData[0].title)}</p>
                      )}
                      {decodeBase64(epgData[0].description) && (
                        <p className="text-sm text-nc-text-secondary line-clamp-2">
                          {decodeBase64(epgData[0].description)}
                        </p>
                      )}
                      {(() => {
                        const startStr = formatEpgTime(epgData[0].start);
                        const endStr = formatEpgTime(epgData[0].end);
                        if (startStr && endStr) {
                          return (
                            <p className="text-xs text-nc-text-secondary mt-1 font-mono">
                              {startStr} - {endStr}
                            </p>
                          );
                        }
                        return null;
                      })()}
                   </div>
                 )}
               </div>

               {/* Right child: Mini-Player com key estável por grupo */}
               <div className="w-full lg:w-[45%] lg:max-w-md md:max-h-[50vh] lg:max-h-[60vh] xl:max-h-none shrink-0 order-1 lg:order-2 shadow-2xl">
                 <VideoPlayer
                   key={selectedGroup.id}
                   streamUrl={miniPlayerUrl}
                   title={selectedGroup.name}
                   channelName={selectedGroup.name}
                   programTitle={epgData && epgData.length > 0 && epgData[0] ? (decodeBase64(epgData[0].title) || undefined) : undefined}
                   contentType="live"
                   streamId={selectedChannel.stream_id}
                   onBack={handleCloseChannel}
                   embedded={true}
                   isLoading={miniPlayerLoading}
                   errorMessage={miniPlayerError}
                   onRetry={() => handleSelectGroup(selectedGroup, selectedResolutionMode)}
                   onPlaybackSuccess={handlePlaybackSuccess}
                   onPlaybackFatalError={handlePlaybackFatalError}
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
                     const startStr = formatEpgTime(prog?.start);
                     const endStr = formatEpgTime(prog?.end);
                     const title = decodeBase64(prog?.title);
                     const description = decodeBase64(prog?.description);

                     return (
                       <div key={idx} className="relative flex items-start justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                         {/* Timeline Marker */}
                         <div className={`flex items-center justify-center w-8 h-8 rounded-full border-2 bg-nc-bg shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow absolute left-[3.5rem] md:left-1/2 -translate-x-1/2 top-4 md:top-1/2 md:-translate-y-1/2 transition-colors ${idx === 0 ? 'border-nc-primary text-nc-primary' : 'border-nc-border/50 text-nc-text-secondary'}`}>
                            <div className={`w-2.5 h-2.5 rounded-full ${idx === 0 ? 'bg-nc-primary' : 'bg-transparent'}`}></div>
                         </div>
                         
                         {/* EPG Card */}
                         <div className="w-[calc(100%-4.5rem)] md:w-[calc(50%-2.5rem)] ml-[4.5rem] md:ml-0 p-4 rounded-xl border border-nc-border/50 bg-nc-bg-card hover:bg-nc-bg-input transition-colors">
                           <div className="flex flex-col gap-1">
                             {startStr && endStr && (
                               <div className={`text-xs font-semibold uppercase tracking-wider ${idx === 0 ? 'text-nc-primary' : 'text-nc-text-secondary'}`}>
                                 {startStr} - {endStr}
                               </div>
                             )}
                             {title && (
                               <h4 className={`font-medium text-base ${idx === 0 ? 'text-white' : 'text-white/80'}`}>
                                 {title}
                               </h4>
                             )}
                             {description && (
                               <p className="text-sm text-nc-text-secondary line-clamp-2 mt-1">
                                 {description}
                               </p>
                             )}
                           </div>
                         </div>
                       </div>
                     );
                   })}
                 </div>
               ) : (
                 <div className="flex flex-col items-center justify-center py-10 text-nc-text-secondary">
                   <p className="text-sm">Nenhuma programação disponível para este canal.</p>
                 </div>
               )}
             </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-nc-text-secondary p-8 text-center">
            <TvMinimalPlay className="w-16 h-16 mb-4 opacity-20" />
            <h3 className="text-lg font-medium text-white mb-1">Selecione um Canal</h3>
            <p className="text-sm max-w-sm">
              Selecione um canal na lista ao lado para assistir à transmissão e conferir a programação.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
