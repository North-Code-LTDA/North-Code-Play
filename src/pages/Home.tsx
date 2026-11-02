import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { LogOut, Home as HomeIcon, Tv, Film, PlaySquare, Settings, Menu, X, Search, Heart, AlertCircle, Loader2, RefreshCw, KeyRound } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { VideoPlayer } from '../components/VideoPlayer';

import { HomeView } from '../views/HomeView';
import { LiveTvView, LiveChannelLaunchIntent } from '../views/LiveTvView';
import { MoviesView } from '../views/MoviesView';
import { SeriesView } from '../views/SeriesView';
import { ConfigView } from '../views/ConfigView';
import { FavoritesView } from '../views/FavoritesView';
import { XtreamProvider, useXtreamContext } from '../context/XtreamContext';
import { useDebounce } from '../hooks/useDebounce';
import { normalizeServerUrl } from '../utils/mediaUtils';
import { markCredentialsAuthRejected, safeRemoveCredentials } from '../utils/accountUtils';
import { MediaImage } from '../components/MediaImage';
import { DisplaySetupModal } from '../components/DisplaySetupModal';
import { useDisplayPreferences } from '../platform/tvEnvironment';
import { APP_VERSION, APP_COMMIT, formatCommitShort } from '../version';
import {
  useNavigationMode,
  useBackHandler,
  BACK_PRIORITY,
  pushFocusMemory,
  popFocusMemory,
  getNavMode,
  focusElementSafely,
  isElementFocusable,
} from '../navigation';

export type ViewType = 'inicio' | 'live' | 'movies' | 'series' | 'favorites' | 'config';

function HomeContent({ credentials }: { credentials: any }) {
  const navigate = useNavigate();
  const navMode = useNavigationMode();
  const { isConfigured } = useDisplayPreferences();
  const isDisplaySetupOpen = !isConfigured;
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [currentView, setCurrentView] = useState<ViewType>('inicio');
  const [liveLaunchIntent, setLiveLaunchIntent] = useState<LiveChannelLaunchIntent | null>(null);
  const liveLaunchReqCounterRef = useRef(0);
  const lastPointerDownTimeRef = useRef<number>(0);
  const homeRootRef = useRef<HTMLDivElement>(null);
  const authRecoveryPrimaryRef = useRef<HTMLButtonElement>(null);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [isRetryingSession, setIsRetryingSession] = useState(false);
  const [activeVideo, setActiveVideo] = useState<{
    url: string;
    title: string;
    startAt?: number;
    streamId?: string | number;
    contentType?: 'live' | 'movie' | 'episode';
    channelName?: string;
    programTitle?: string;
    onNext?: () => void;
    onPrevious?: () => void;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchEditing, setIsSearchEditing] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debouncedSearchQuery = useDebounce(searchQuery, 500);

  // Overlay state & context consumption
  const {
    sessionReady,
    liveCategoriesStatus,
    vodCategoriesStatus,
    seriesCategoriesStatus,
    liveCatalogStatus,
    vodCatalogStatus,
    seriesCatalogStatus,
    liveCategoriesError,
    vodCategoriesError,
    seriesCategoriesError,
    isAuthRejected,
    authError,
    retrySession,
  } = useXtreamContext();

  // Back policy: 1) Exit search text editing mode
  useBackHandler(
    'home-search-edit',
    BACK_PRIORITY.SUB_MODAL,
    () => {
      if (isSearchEditing) {
        setIsSearchEditing(false);
        return true;
      }
      return false;
    },
    isSearchEditing
  );

  // Back policy: 2) Close mobile drawer menu
  useBackHandler(
    'home-mobile-menu',
    BACK_PRIORITY.DRAWER_MENU,
    () => {
      if (isMobileMenuOpen) {
        setIsMobileMenuOpen(false);
        popFocusMemory();
        return true;
      }
      return false;
    },
    isMobileMenuOpen
  );

  // Back policy: 3) From categories of live/movies/series or content of config/favorites, focus the corresponding sidebar button while keeping the section open;
  // on a subsequent Back (when focus is already on the sidebar or outside), return to 'inicio' (never logs out!)
  useBackHandler(
    'home-section-to-inicio',
    BACK_PRIORITY.SECTION_TO_HOME,
    () => {
      if (currentView !== 'inicio') {
        const isRecentPointer =
          getNavMode() === 'pointer' && Date.now() - lastPointerDownTimeRef.current < 250;

        if (!isRecentPointer) {
          const activeEl = document.activeElement as HTMLElement | null;
          const isInCategories =
            (currentView === 'live' || currentView === 'movies' || currentView === 'series') &&
            Boolean(activeEl && activeEl.closest('[data-nav-zone="categories"]'));
          const isInConfigOrFavoritesContent =
            (currentView === 'config' || currentView === 'favorites') &&
            Boolean(activeEl && activeEl.closest('[data-nav-zone="content"]'));

          if (isInCategories || isInConfigOrFavoritesContent) {
            const root = homeRootRef.current || document.body;
            const desktopSidebarBtns = Array.from(
              root.querySelectorAll(
                `aside[data-nav-zone="sidebar"] button[data-sidebar-nav-id="${currentView}"]`
              )
            ) as HTMLButtonElement[];

            const isMobileViewport =
              typeof window !== 'undefined' && window.innerWidth > 0 && window.innerWidth < 768;

            const visibleSidebarBtn = !isMobileViewport
              ? desktopSidebarBtns.find((btn) => isElementFocusable(btn))
              : undefined;

            if (visibleSidebarBtn) {
              focusElementSafely(visibleSidebarBtn);
              return true;
            }

            const mobileMenuBtn = root.querySelector(
              'button[data-mobile-menu-trigger="true"]'
            ) as HTMLButtonElement | null;
            if (mobileMenuBtn && isElementFocusable(mobileMenuBtn)) {
              focusElementSafely(mobileMenuBtn);
              return true;
            }
          }
        }

        setCurrentView('inicio');
        setSearchQuery('');
        return true;
      }
      return false;
    },
    currentView !== 'inicio'
  );

  const [isOpeningDismissed, setIsOpeningDismissed] = useState(false);
  const [showContinueButton, setShowContinueButton] = useState(false);

  const isStatusFinished = (s: string) => s === 'ready' || s === 'error';
  const allSixFinished = Boolean(
    sessionReady &&
    isStatusFinished(liveCategoriesStatus) &&
    isStatusFinished(vodCategoriesStatus) &&
    isStatusFinished(seriesCategoriesStatus) &&
    isStatusFinished(liveCatalogStatus) &&
    isStatusFinished(vodCatalogStatus) &&
    isStatusFinished(seriesCatalogStatus)
  );

  // Automatically close without minimum artificial delay when all six are ready/error or if auth is rejected
  useEffect(() => {
    if (allSixFinished || isAuthRejected) {
      setIsOpeningDismissed(true);
    }
  }, [allSixFinished, isAuthRejected]);

  // Show "Continuar enquanto carrega" button if pending after 10s
  useEffect(() => {
    if (isOpeningDismissed) return;
    const timer = setTimeout(() => {
      setShowContinueButton(true);
    }, 10000);
    return () => clearTimeout(timer);
  }, [isOpeningDismissed]);

  const isOverlayActive = !isOpeningDismissed && !allSixFinished && !isAuthRejected;

  const hasTransientCategoriesFailure = Boolean(
    !isAuthRejected &&
      sessionReady &&
      (liveCategoriesStatus === 'error' ||
        vodCategoriesStatus === 'error' ||
        seriesCategoriesStatus === 'error')
  );

  const transientFailureMessage =
    liveCategoriesError ||
    vodCategoriesError ||
    seriesCategoriesError ||
    'Falha temporária de conexão com o servidor do provedor.';

  const handleReturnToLoginForRecovery = () => {
    const reason =
      authError || 'Usuário ou senha inválidos ou conta desativada.';
    markCredentialsAuthRejected(reason);
    navigate('/', {
      replace: true,
      state: {
        editCredentials: true,
        authError: reason,
      },
    });
  };

  const handleEditCredentialsOnTransientFailure = () => {
    navigate('/', {
      state: {
        editCredentials: true,
      },
    });
  };

  const handleRetrySession = async () => {
    setIsRetryingSession(true);
    try {
      await retrySession();
    } finally {
      setIsRetryingSession(false);
    }
  };

  useEffect(() => {
    if (isAuthRejected && !isDisplaySetupOpen && authRecoveryPrimaryRef.current) {
      const timer = setTimeout(() => {
        if (authRecoveryPrimaryRef.current) {
          focusElementSafely(authRecoveryPrimaryRef.current);
        }
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isAuthRejected, isDisplaySetupOpen]);

  const handleFirstSetupComplete = () => {
    setTimeout(() => {
      if (getNavMode() !== 'remote') return;
      const root = homeRootRef.current;
      if (!root) return;
      const target =
        root.querySelector<HTMLElement>('[data-nav-zone="content"] button, [data-nav-zone="content"] [data-nav-item="true"]') ||
        root.querySelector<HTMLElement>('aside[data-nav-zone="sidebar"] button[data-sidebar-active="true"]');
      if (target && isElementFocusable(target)) {
        focusElementSafely(target);
      }
    }, 0);
  };

  useEffect(() => {
    if (logoutError) {
      const timer = setTimeout(() => setLogoutError(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [logoutError]);

  const handleLogout = () => {
    const res = safeRemoveCredentials();
    if (!res.success) {
      setLogoutError('Não foi possível sair deste dispositivo. Tente novamente.');
      return;
    }
    setLogoutError(null);
    navigate('/');
  };

  const handlePlay = (
    url: string,
    title: string,
    startAt?: number,
    streamId?: string | number,
    contentType?: 'live' | 'movie' | 'episode',
    channelName?: string,
    programTitle?: string,
    onNext?: () => void,
    onPrevious?: () => void
  ) => {
    pushFocusMemory();
    setActiveVideo({
      url,
      title,
      startAt,
      streamId,
      contentType,
      channelName,
      programTitle,
      onNext,
      onPrevious,
    });
  };

  const handleSelectLiveFromHome = (stream: any) => {
    const reqId = ++liveLaunchReqCounterRef.current;
    const sId = stream?.stream_id ?? stream?.id ?? '';
    setLiveLaunchIntent({
      streamId: sId,
      requestId: reqId,
      categoryId: stream?.category_id ? String(stream.category_id) : undefined,
      streamSnapshot: stream,
    });
    setCurrentView('live');
    setIsMobileMenuOpen(false);
  };

  const handleConsumeLiveIntent = (reqId: number) => {
    setLiveLaunchIntent((prev) => (prev && prev.requestId === reqId ? null : prev));
  };

  const renderNavItems = () => (
    <>
      <button data-sidebar-nav-id="inicio" data-sidebar-active={currentView === 'inicio' ? 'true' : 'false'} onClick={() => { setCurrentView('inicio'); setIsMobileMenuOpen(false); setSearchQuery(''); }} className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-colors ${currentView === 'inicio' ? 'bg-nc-primary text-black font-semibold' : 'text-nc-text-secondary hover:text-white hover:bg-nc-bg-input'}`}>
        <HomeIcon className="w-5 h-5" />
        <span>Início</span>
      </button>
      <button data-sidebar-nav-id="live" data-sidebar-active={currentView === 'live' ? 'true' : 'false'} onClick={() => { setCurrentView('live'); setIsMobileMenuOpen(false); setSearchQuery(''); }} className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-colors ${currentView === 'live' ? 'bg-nc-primary text-black font-semibold' : 'text-nc-text-secondary hover:text-white hover:bg-nc-bg-input'}`}>
        <Tv className="w-5 h-5" />
        <span>TV ao Vivo</span>
      </button>
      <button data-sidebar-nav-id="movies" data-sidebar-active={currentView === 'movies' ? 'true' : 'false'} onClick={() => { setCurrentView('movies'); setIsMobileMenuOpen(false); setSearchQuery(''); }} className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-colors ${currentView === 'movies' ? 'bg-nc-primary text-black font-semibold' : 'text-nc-text-secondary hover:text-white hover:bg-nc-bg-input'}`}>
        <Film className="w-5 h-5" />
        <span>Filmes</span>
      </button>
      <button data-sidebar-nav-id="series" data-sidebar-active={currentView === 'series' ? 'true' : 'false'} onClick={() => { setCurrentView('series'); setIsMobileMenuOpen(false); setSearchQuery(''); }} className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-colors ${currentView === 'series' ? 'bg-nc-primary text-black font-semibold' : 'text-nc-text-secondary hover:text-white hover:bg-nc-bg-input'}`}>
        <PlaySquare className="w-5 h-5" />
        <span>Séries</span>
      </button>
      <button data-sidebar-nav-id="favorites" data-sidebar-active={currentView === 'favorites' ? 'true' : 'false'} onClick={() => { setCurrentView('favorites'); setIsMobileMenuOpen(false); setSearchQuery(''); }} className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-colors ${currentView === 'favorites' ? 'bg-nc-primary text-black font-semibold' : 'text-nc-text-secondary hover:text-white hover:bg-nc-bg-input'}`}>
        <Heart className="w-5 h-5" />
        <span>Meus Favoritos</span>
      </button>
      <div className="h-4" />
      <button
        data-sidebar-nav-id="config"
        data-sidebar-active={currentView === 'config' ? 'true' : 'false'}
        onClick={() => {
          const alreadyConfig = currentView === 'config';
          setCurrentView('config');
          setIsMobileMenuOpen(false);
          setSearchQuery('');
          if (alreadyConfig && getNavMode() === 'remote') {
            const root = homeRootRef.current || document.body;
            const target =
              root.querySelector<HTMLElement>('[data-config-primary="true"]') ||
              root.querySelector<HTMLElement>('[data-nav-zone="content"] button');
            if (target) {
              focusElementSafely(target);
            }
          }
        }}
        className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-colors ${currentView === 'config' ? 'bg-nc-primary text-black font-semibold' : 'text-nc-text-secondary hover:text-white hover:bg-nc-bg-input'}`}
      >
        <Settings className="w-5 h-5" />
        <span>Configurações</span>
      </button>
    </>
  );

  const isHeroPaused = Boolean(activeVideo || isOverlayActive || isDisplaySetupOpen);

  const renderView = () => {
    switch (currentView) {
      case 'inicio':
        return (
          <HomeView
            onPlay={handlePlay}
            onSelectLiveChannel={handleSelectLiveFromHome}
            searchQuery={debouncedSearchQuery}
            isPaused={isHeroPaused}
          />
        );
      case 'live':
        return (
          <LiveTvView
            onPlay={handlePlay}
            searchQuery={debouncedSearchQuery}
            initialChannelIntent={liveLaunchIntent}
            onConsumeChannelIntent={handleConsumeLiveIntent}
          />
        );
      case 'movies':
        return <MoviesView onPlay={handlePlay} searchQuery={debouncedSearchQuery} />;
      case 'series':
        return <SeriesView onPlay={handlePlay} searchQuery={debouncedSearchQuery} />;
      case 'favorites':
        return <FavoritesView onPlay={handlePlay} searchQuery={debouncedSearchQuery} />;
      case 'config':
        return <ConfigView />;
      default:
        return (
          <HomeView
            onPlay={handlePlay}
            onSelectLiveChannel={handleSelectLiveFromHome}
            searchQuery={debouncedSearchQuery}
            isPaused={isHeroPaused}
          />
        );
    }
  };

  return (
    <>
      <div
        ref={homeRootRef}
        data-home-shell="true"
        onPointerDownCapture={() => {
          lastPointerDownTimeRef.current = Date.now();
        }}
        className="h-[100dvh] nc-safe-screen bg-nc-bg flex flex-col md:flex-row w-full overflow-hidden"
        inert={isOverlayActive || isDisplaySetupOpen || isAuthRejected ? true : undefined}
      >
        <AnimatePresence>
          {activeVideo && (
            <VideoPlayer 
              streamUrl={activeVideo.url} 
              title={activeVideo.title} 
              contentType={activeVideo.contentType}
              channelName={activeVideo.channelName}
              programTitle={activeVideo.programTitle}
              onBack={() => {
                setActiveVideo(null);
                if (!popFocusMemory()) {
                  setTimeout(() => popFocusMemory(), 0);
                }
              }}
              startAt={activeVideo.startAt}
              streamId={activeVideo.streamId}
              onNext={activeVideo.onNext}
              onPrevious={activeVideo.onPrevious}
            />
          )}
        </AnimatePresence>

        {/* Sidebar - Desktop */}
        <aside data-nav-zone="sidebar" className="nc-tv-sidebar hidden md:flex flex-col w-64 border-r border-nc-border/50 bg-black/50 backdrop-blur-xl z-50 h-full shrink-0">
          <div className="nc-tv-sidebar-logo p-6">
            <Logo className="scale-90 origin-left" />
          </div>
          
          <div className="nc-tv-sidebar-nav flex-1 px-4 py-2 space-y-2 overflow-y-auto custom-scrollbar flex flex-col">
            {renderNavItems()}
          </div>

          <div className="nc-tv-sidebar-footer p-4 border-t border-nc-border/50 mt-auto shrink-0">
            <div className="flex items-center gap-3 px-4 py-2.5 mb-1.5">
              <div className="w-9 h-9 rounded-full bg-nc-primary/20 flex items-center justify-center text-nc-primary font-bold shrink-0 overflow-hidden border border-nc-border">
                {credentials.avatar ? (
                  <MediaImage 
                    src={credentials.avatar} 
                    serverUrl={credentials.serverUrl}
                    alt="Avatar" 
                    className="w-full h-full object-cover" 
                  />
                ) : (
                  (credentials.playlistName || 'M').charAt(0).toUpperCase()
                )}
              </div>
              <div className="flex-1 overflow-hidden">
                <p className="text-sm font-medium text-white truncate">{credentials.playlistName || 'Minha Lista'}</p>
                <p className="text-xs text-gray-400 truncate">{credentials.username}</p>
              </div>
            </div>
            <button 
              onClick={handleLogout}
              className="flex items-center gap-3 w-full px-4 py-2.5 rounded-xl text-red-500 hover:bg-red-500/10 transition-colors"
            >
              <LogOut className="w-5 h-5" />
              <span>Sair</span>
            </button>
            <div className="mt-2.5 pt-2 border-t border-nc-border/30 text-center">
              <span className="text-[10px] font-mono text-nc-text-secondary/60">
                v{APP_VERSION} ({formatCommitShort(APP_COMMIT)})
              </span>
            </div>
          </div>
        </aside>

        {/* Mobile Header */}
        <header className="md:hidden sticky top-0 w-full h-16 border-b border-nc-border/50 bg-black/80 backdrop-blur-xl z-[45] flex items-center justify-between px-4 shrink-0">
          <Logo className="scale-75 origin-left" />
          <button 
            data-mobile-menu-trigger="true"
            onClick={(e) => {
              pushFocusMemory(e.currentTarget);
              setIsMobileMenuOpen(true);
            }}
            className="p-2 text-white"
          >
            <Menu className="w-6 h-6" />
          </button>
        </header>

        {/* Mobile Sidebar Overlay */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <>
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  popFocusMemory();
                }}
                className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]"
              />
              <motion.aside 
                data-focus-scope="modal"
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
                className="md:hidden fixed inset-y-0 left-0 w-64 nc-safe-drawer bg-nc-bg-card border-r border-nc-border/50 z-[70] flex flex-col"
              >
                <div className="p-4 flex items-center justify-between border-b border-nc-border/50">
                  <Logo className="scale-75 origin-left" />
                  <button
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      popFocusMemory();
                    }}
                    className="p-2 text-nc-text-secondary hover:text-white"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>
                <div className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
                  {renderNavItems()}
                </div>
                <div className="p-4 border-t border-nc-border/50">
                  <div className="flex items-center gap-3 px-4 py-3 mb-2">
                    <div className="w-9 h-9 rounded-full bg-nc-primary/20 flex items-center justify-center text-nc-primary font-bold shrink-0 overflow-hidden border border-nc-border">
                      {credentials.avatar ? (
                        <MediaImage 
                          src={credentials.avatar} 
                          serverUrl={credentials.serverUrl}
                          alt="Avatar" 
                          className="w-full h-full object-cover" 
                        />
                      ) : (
                        (credentials.playlistName || 'M').charAt(0).toUpperCase()
                      )}
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <p className="text-sm font-medium text-white truncate">{credentials.playlistName || 'Minha Lista'}</p>
                      <p className="text-xs text-gray-400 truncate">{credentials.username}</p>
                    </div>
                  </div>
                  <button 
                    onClick={handleLogout}
                    className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-red-500 hover:bg-red-500/10 transition-colors"
                  >
                    <LogOut className="w-5 h-5" />
                    <span>Sair</span>
                  </button>
                  <div className="mt-3 pt-2 border-t border-nc-border/30 text-center">
                    <span className="text-[10px] font-mono text-nc-text-secondary/60">
                      v{APP_VERSION} ({formatCommitShort(APP_COMMIT)})
                    </span>
                  </div>
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        {/* Main Content */}
        <div className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col relative w-full h-full">
          {/* Top Search Bar */}
          {currentView !== 'config' && (
            <div data-nav-zone="header" className="nc-tv-header w-full shrink-0 p-4 md:px-8 border-b border-nc-border/30 bg-nc-bg/80 backdrop-blur-lg flex items-center justify-center z-[40]">
              <div className="relative w-full max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-nc-text-secondary" />
                <input 
                  ref={searchInputRef}
                  type="text" 
                  readOnly={navMode === 'remote' && !isSearchEditing}
                  data-search-editing={isSearchEditing ? 'true' : 'false'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onPointerDown={() => setIsSearchEditing(true)}
                  onClick={() => {
                    if (navMode === 'remote' && !isSearchEditing) {
                      setIsSearchEditing(true);
                    }
                  }}
                  onBlur={() => setIsSearchEditing(false)}
                  onKeyDown={(e) => {
                    if (navMode === 'remote' && !isSearchEditing && (e.key === 'Enter' || e.key === 'NumpadEnter')) {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsSearchEditing(true);
                    }
                  }}
                  placeholder="Pesquisar..." 
                  className="w-full pl-10 pr-4 py-2.5 bg-nc-bg-input border border-nc-border/50 focus:border-nc-primary rounded-xl text-white outline-none transition-colors"
                />
              </div>
            </div>
          )}

          {/* Transient Failure Banner (preserves credentials, allows retry or optional credential editing) */}
          {hasTransientCategoriesFailure && (
            <div
              role="status"
              data-transient-recovery="true"
              className="w-full shrink-0 px-4 py-3 md:px-8 bg-amber-500/10 border-b border-amber-500/30 flex flex-wrap items-center justify-between gap-3 z-[35]"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
                <p className="text-xs sm:text-sm text-amber-200 truncate sm:whitespace-normal">
                  {transientFailureMessage} Suas credenciais continuam salvas neste dispositivo.
                </p>
              </div>
              <div data-nav-row="transient-recovery-actions" className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  data-transient-retry="true"
                  disabled={isRetryingSession}
                  onClick={handleRetrySession}
                  className="px-3.5 py-1.5 rounded-lg bg-nc-primary text-black text-xs sm:text-sm font-semibold hover:bg-nc-primary-hover transition-colors flex items-center gap-1.5 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRetryingSession ? 'animate-spin' : ''}`} />
                  <span>Tentar novamente</span>
                </button>
                <button
                  type="button"
                  data-transient-edit-login="true"
                  onClick={handleEditCredentialsOnTransientFailure}
                  className="px-3.5 py-1.5 rounded-lg bg-nc-bg-card hover:bg-nc-bg-input text-white border border-nc-border/60 text-xs sm:text-sm font-medium transition-colors"
                >
                  Revisar servidor
                </button>
              </div>
            </div>
          )}

          <main className="flex-1 min-w-0 min-h-0 flex overflow-hidden relative">
            {isDisplaySetupOpen || isAuthRejected ? (
              <div
                data-home-deferred="true"
                aria-hidden="true"
                className="flex-1 w-full h-full bg-nc-bg"
              />
            ) : (
              renderView()
            )}
          </main>
        </div>

        {logoutError && (
          <div
            role="alert"
            className="fixed bottom-6 right-6 left-6 sm:left-auto sm:max-w-md z-[120] bg-red-600/90 text-white text-sm px-4 py-3 rounded-xl shadow-2xl border border-red-500/50 backdrop-blur-md flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle className="w-5 h-5 text-white shrink-0" />
              <span className="truncate sm:whitespace-normal">{logoutError}</span>
            </div>
            <button
              onClick={() => setLogoutError(null)}
              className="p-1 hover:bg-white/20 rounded-lg text-white/80 hover:text-white shrink-0 transition-colors"
              aria-label="Fechar aviso"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Authentication Rejected Recovery Modal (proven invalid, disabled, or expired credentials) */}
      {isAuthRejected && (
        <div
          role={isDisplaySetupOpen ? undefined : 'dialog'}
          aria-modal={isDisplaySetupOpen ? undefined : 'true'}
          aria-hidden={isDisplaySetupOpen ? 'true' : undefined}
          inert={isDisplaySetupOpen ? true : undefined}
          aria-label="Recuperação de acesso"
          data-focus-scope="modal"
          data-auth-recovery="true"
          className="fixed inset-0 z-[130] bg-nc-bg/95 backdrop-blur-md nc-safe-overlay flex flex-col items-center justify-center text-center select-none"
        >
          <div className="w-full max-w-md bg-nc-bg-card border border-nc-border rounded-2xl p-6 sm:p-8 shadow-2xl flex flex-col items-center">
            <div className="w-14 h-14 rounded-2xl bg-red-500/15 border border-red-500/40 flex items-center justify-center mb-4">
              <KeyRound className="w-7 h-7 text-red-400" />
            </div>

            <h2 className="text-xl font-bold text-white mb-2">
              Não foi possível validar seu acesso
            </h2>
            <p className="text-sm text-red-300 font-medium mb-2">
              {authError || 'Usuário ou senha inválidos ou conta desativada/expirada.'}
            </p>
            <p className="text-xs text-nc-text-secondary mb-6 leading-relaxed">
              Seus favoritos, histórico de reprodução e preferências de tela continuam salvos neste dispositivo. Volte ao login para atualizar ou corrigir seus dados de acesso.
            </p>

            <div
              data-nav-row="auth-recovery-actions"
              className="flex flex-col sm:flex-row items-center justify-center gap-3 w-full"
            >
              <button
                ref={authRecoveryPrimaryRef}
                type="button"
                data-autofocus="true"
                data-auth-recovery-login="true"
                onClick={handleReturnToLoginForRecovery}
                className="w-full sm:flex-1 py-3 px-4 rounded-xl bg-nc-primary text-black font-semibold hover:bg-nc-primary-hover transition-colors flex items-center justify-center gap-2"
              >
                <KeyRound className="w-4 h-4" />
                <span>Voltar ao Login e corrigir</span>
              </button>

              <button
                type="button"
                data-auth-recovery-retry="true"
                disabled={isRetryingSession}
                onClick={handleRetrySession}
                className="w-full sm:w-auto py-3 px-4 rounded-xl bg-nc-bg-input hover:bg-nc-border/50 text-white border border-nc-border/60 font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isRetryingSession ? 'animate-spin' : ''}`} />
                <span>Tentar novamente</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Initial Opening Overlay covering the entire interface */}
      {isOverlayActive && (
        <div
          role={isDisplaySetupOpen ? undefined : 'dialog'}
          aria-modal={isDisplaySetupOpen ? undefined : 'true'}
          aria-hidden={isDisplaySetupOpen ? 'true' : undefined}
          inert={isDisplaySetupOpen ? true : undefined}
          aria-label="Carregando programação"
          className="fixed inset-0 z-[100] bg-nc-bg/95 backdrop-blur-md nc-safe-overlay flex flex-col items-center justify-center text-center select-none"
        >
          <div className="relative mb-6">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white/[0.04] border border-nc-border/60 flex items-center justify-center shadow-2xl backdrop-blur-sm">
              <Loader2 className="w-8 h-8 sm:w-10 sm:h-10 animate-spin motion-reduce:animate-none text-nc-primary" />
            </div>
            <div className="absolute inset-0 bg-white/[0.06] blur-2xl rounded-full pointer-events-none" />
          </div>

          <Logo className="mb-3 scale-105" />

          <h2 className="text-xl sm:text-2xl font-semibold text-white tracking-tight">
            Carregando sua programação
          </h2>
          <p className="text-sm text-nc-text-secondary mt-2 max-w-md">
            Sincronizando canais ao vivo, filmes e séries para {credentials?.playlistName || 'sua lista'}...
          </p>

          <div className="w-full max-w-4xl mt-8 grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 sm:gap-4 opacity-40 pointer-events-none">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div
                key={idx}
                className="aspect-[2/3] rounded-xl bg-white/[0.03] border border-nc-border/40 animate-pulse motion-reduce:animate-none"
              />
            ))}
          </div>

          {showContinueButton && (
            <div className="mt-8">
              <button
                type="button"
                onClick={() => setIsOpeningDismissed(true)}
                className="px-5 py-2.5 bg-nc-bg-card hover:bg-nc-bg-input text-white border border-nc-border/80 rounded-xl text-sm font-medium transition-colors shadow-lg focus:outline-none focus:ring-2 focus:ring-nc-primary"
              >
                Continuar enquanto carrega
              </button>
            </div>
          )}
        </div>
      )}

      {/* First-run Device Presentation Setup Wizard (outside inert containers) */}
      <DisplaySetupModal
        isOpen={isDisplaySetupOpen}
        canCancel={false}
        onComplete={handleFirstSetupComplete}
      />
    </>
  );
}

export function Home() {
  const navigate = useNavigate();
  const [credentials, setCredentials] = useState<any>(null);

  useEffect(() => {
    const saved = localStorage.getItem('northcode_tv_credentials');
    if (!saved) {
      navigate('/');
    } else {
      try {
        const parsed = JSON.parse(saved);
        const normalized = normalizeServerUrl(parsed.serverUrl);
        if (normalized && normalized !== parsed.serverUrl) {
          parsed.serverUrl = normalized;
          localStorage.setItem('northcode_tv_credentials', JSON.stringify(parsed));
        }
        setCredentials(parsed);
      } catch {
        navigate('/');
      }
    }
  }, [navigate]);

  if (!credentials) return null;

  return (
    <XtreamProvider credentials={credentials}>
      <HomeContent credentials={credentials} />
    </XtreamProvider>
  );
}
