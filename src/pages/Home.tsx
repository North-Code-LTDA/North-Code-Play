import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { X, AlertCircle, Loader2, RefreshCw, KeyRound } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { VideoPlayer } from '../components/VideoPlayer';
import { TopHeader, MainSectionId, PrimaryNavSectionId } from '../components/TopHeader';

import { HomeView } from '../views/HomeView';
import { LiveTvView, LiveChannelLaunchIntent } from '../views/LiveTvView';
import { MoviesView } from '../views/MoviesView';
import { SeriesView } from '../views/SeriesView';
import { ConfigView } from '../views/ConfigView';
import { FavoritesView } from '../views/FavoritesView';
import { XtreamProvider, useXtreamSession } from '../context/XtreamContext';
import { useDebounce } from '../hooks/useDebounce';
import { normalizeServerUrl } from '../utils/mediaUtils';
import { markCredentialsAuthRejected, safeRemoveCredentials } from '../utils/accountUtils';
import { DisplaySetupModal } from '../components/DisplaySetupModal';
import { useDisplayPreferences } from '../platform/tvEnvironment';
import {
  useBackHandler,
  BACK_PRIORITY,
  pushFocusMemory,
  popFocusMemory,
  getNavMode,
  focusElementSafely,
  isElementFocusable,
} from '../navigation';
import {
  recordHomeOpeningMilestone,
  recordHomeManualContinueIntent,
} from '../utils/catalogDiagnostics';

export type ViewType = MainSectionId;

function HomeContent({ credentials }: { credentials: any }) {
  const navigate = useNavigate();
  const { isConfigured } = useDisplayPreferences();
  const isDisplaySetupOpen = !isConfigured;
  const [currentView, setCurrentView] = useState<ViewType>('inicio');
  const [configFocusTarget, setConfigFocusTarget] = useState<'presentation' | 'account'>('presentation');
  const [configFocusReqId, setConfigFocusReqId] = useState(0);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [liveLaunchIntent, setLiveLaunchIntent] = useState<LiveChannelLaunchIntent | null>(null);
  const liveLaunchReqCounterRef = useRef(0);
  const lastPointerDownTimeRef = useRef<number>(0);
  const homeRootRef = useRef<HTMLDivElement>(null);
  const mainViewAreaRef = useRef<HTMLElement>(null);
  const authRecoveryPrimaryRef = useRef<HTMLButtonElement>(null);
  const pendingSectionFocusRef = useRef<{
    section: 'live' | 'movies' | 'series';
    requestId: number;
  } | null>(null);
  const sectionFocusReqCounterRef = useRef(0);
  const isApplyingSectionFocusRef = useRef(false);
  const [sectionFocusTick, setSectionFocusTick] = useState(0);

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
  const debouncedSearchQuery = useDebounce(searchQuery, 500);

  // Overlay state & isolated session context consumption
  const {
    allSixFinished,
    hasTransientCategoriesFailure,
    transientFailureMessage,
    isAuthRejected,
    authError,
    retrySession,
  } = useXtreamSession();

  // One-time focus forwarding when activating TV ao Vivo, Filmes, or Séries
  const tryApplyPendingSectionFocus = useCallback((): boolean => {
    const pending = pendingSectionFocusRef.current;
    if (!pending || pending.section !== currentView) {
      return false;
    }
    const viewRoot = mainViewAreaRef.current;
    if (!viewRoot) return false;

    const isDesktopViewport =
      typeof window === 'undefined' ||
      typeof window.innerWidth !== 'number' ||
      window.innerWidth === 0 ||
      window.innerWidth >= 768;

    const categoryBtns: HTMLButtonElement[] = Array.from<HTMLButtonElement>(
      viewRoot.querySelectorAll<HTMLButtonElement>(
        '[data-nav-zone="categories"] button[data-category-id], [data-nav-zone="categories"] button[data-live-category-id]'
      )
    ).filter((btn: HTMLButtonElement) => {
      if (!isElementFocusable(btn)) return false;
      if (isDesktopViewport && btn.closest('.md\\:hidden')) return false;
      if (!isDesktopViewport && btn.closest('.hidden.md\\:flex')) return false;
      return true;
    });

    if (categoryBtns.length === 0) {
      return false;
    }

    const selectedBtn: HTMLButtonElement | undefined = categoryBtns.find(
      (btn: HTMLButtonElement) => btn.getAttribute('data-category-selected') === 'true'
    );
    const targetBtn: HTMLButtonElement = selectedBtn || categoryBtns[0];

    pendingSectionFocusRef.current = null;
    isApplyingSectionFocusRef.current = true;
    try {
      focusElementSafely(targetBtn);
    } finally {
      isApplyingSectionFocusRef.current = false;
    }
    return true;
  }, [currentView]);

  useEffect(() => {
    const pending = pendingSectionFocusRef.current;
    if (!pending) return;
    if (pending.section !== currentView) {
      pendingSectionFocusRef.current = null;
      return;
    }

    if (tryApplyPendingSectionFocus()) {
      return;
    }

    const viewRoot = mainViewAreaRef.current;
    let observer: MutationObserver | null = null;
    const ObserverCtor =
      typeof MutationObserver !== 'undefined'
        ? MutationObserver
        : typeof window !== 'undefined'
          ? (window as any).MutationObserver
          : undefined;
    if (viewRoot && ObserverCtor) {
      observer = new ObserverCtor(() => {
        if (tryApplyPendingSectionFocus() && observer) {
          observer.disconnect();
          observer = null;
        }
      });
      observer!.observe(viewRoot, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-category-selected', 'disabled', 'class'],
      });
    }

    const cancelOnKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'Tab' ||
        e.key === 'Escape' ||
        e.key === 'Backspace'
      ) {
        pendingSectionFocusRef.current = null;
      }
    };

    const cancelOnPointerDown = (e: PointerEvent | MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const originNavBtn = target?.closest?.(`button[data-header-nav-id="${pending.section}"]`);
      if (!originNavBtn) {
        pendingSectionFocusRef.current = null;
      }
    };

    const cancelOnFocusIn = (e: FocusEvent) => {
      if (isApplyingSectionFocusRef.current) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const isOriginHeaderBtn =
        target.getAttribute('data-header-nav-id') === pending.section ||
        Boolean(target.closest(`button[data-header-nav-id="${pending.section}"]`));
      if (!isOriginHeaderBtn) {
        pendingSectionFocusRef.current = null;
      }
    };

    window.addEventListener('keydown', cancelOnKeyDown, true);
    window.addEventListener('pointerdown', cancelOnPointerDown, true);
    window.addEventListener('focusin', cancelOnFocusIn, true);

    return () => {
      if (observer) {
        observer.disconnect();
      }
      window.removeEventListener('keydown', cancelOnKeyDown, true);
      window.removeEventListener('pointerdown', cancelOnPointerDown, true);
      window.removeEventListener('focusin', cancelOnFocusIn, true);
    };
  }, [currentView, sectionFocusTick, tryApplyPendingSectionFocus]);

  // Back policy: From categories of live/movies/series or content of config/favorites,
  // focus the active section button in the new top header while keeping the section open;
  // on a subsequent Back (when focus is already in the header or outside), return to 'inicio' (never logs out!)
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
            const headerTargetBtn =
              currentView === 'config'
                ? root.querySelector<HTMLButtonElement>(
                    'header[data-nav-zone="header"] button[data-header-account-trigger="true"]'
                  )
                : root.querySelector<HTMLButtonElement>(
                    `header[data-nav-zone="header"] button[data-header-nav-id="${currentView}"]`
                  );

            if (headerTargetBtn && isElementFocusable(headerTargetBtn)) {
              focusElementSafely(headerTargetBtn);
              return true;
            }
          }
        }

        pendingSectionFocusRef.current = null;
        setCurrentView('inicio');
        setSearchQuery('');
        setIsSearchOpen(false);
        setIsAccountMenuOpen(false);
        setTimeout(() => {
          const root = homeRootRef.current || document.body;
          const inicioBtn = root.querySelector<HTMLButtonElement>(
            'header[data-nav-zone="header"] button[data-header-nav-id="inicio"]'
          );
          if (inicioBtn && isElementFocusable(inicioBtn) && getNavMode() === 'remote') {
            focusElementSafely(inicioBtn);
          }
        }, 0);
        return true;
      }
      return false;
    },
    currentView !== 'inicio'
  );

  const [isOpeningDismissed, setIsOpeningDismissed] = useState(false);
  const [showContinueButton, setShowContinueButton] = useState(false);

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

  useEffect(() => {
    recordHomeOpeningMilestone({
      isDisplaySetupOpen,
      isOverlayActive,
      isAuthRejected,
      allSixFinished,
    });
  }, [isDisplaySetupOpen, isOverlayActive, isAuthRejected, allSixFinished]);

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
        root.querySelector<HTMLElement>(
          '[data-nav-zone="content"] button, [data-nav-zone="content"] [data-nav-item="true"]'
        ) ||
        root.querySelector<HTMLElement>(
          'header[data-nav-zone="header"] button[data-header-nav-active="true"]'
        );
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

  const handleLogout = useCallback(() => {
    const res = safeRemoveCredentials();
    if (!res.success) {
      setLogoutError('Não foi possível sair deste dispositivo. Tente novamente.');
      return;
    }
    setLogoutError(null);
    navigate('/');
  }, [navigate]);

  const handlePlay = useCallback(
    (
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
    },
    []
  );

  const handleClosePlayer = useCallback(() => {
    setActiveVideo(null);
    if (!popFocusMemory()) {
      setTimeout(() => popFocusMemory(), 0);
    }
  }, []);

  const handleSelectLiveFromHome = useCallback((stream: any) => {
    const reqId = ++liveLaunchReqCounterRef.current;
    const sId = stream?.stream_id ?? stream?.id ?? '';
    pendingSectionFocusRef.current = null;
    setLiveLaunchIntent({
      streamId: sId,
      requestId: reqId,
      categoryId: stream?.category_id ? String(stream.category_id) : undefined,
      streamSnapshot: stream,
    });
    setCurrentView('live');
    setIsSearchOpen(false);
    setIsAccountMenuOpen(false);
  }, []);

  const handleConsumeLiveIntent = useCallback((reqId: number) => {
    setLiveLaunchIntent((prev) => (prev && prev.requestId === reqId ? null : prev));
  }, []);

  const handleSelectSection = useCallback((section: PrimaryNavSectionId) => {
    setIsAccountMenuOpen(false);
    setIsSearchOpen(false);
    setSearchQuery('');
    if (section === 'live' || section === 'movies' || section === 'series') {
      pendingSectionFocusRef.current = {
        section,
        requestId: ++sectionFocusReqCounterRef.current,
      };
      setSectionFocusTick((t) => t + 1);
    } else {
      pendingSectionFocusRef.current = null;
    }
    setCurrentView(section);
  }, []);

  const handleOpenSearch = useCallback(() => {
    pendingSectionFocusRef.current = null;
    setIsAccountMenuOpen(false);
    if (currentView === 'config') {
      setCurrentView('inicio');
    }
    setIsSearchOpen(true);
  }, [currentView]);

  const handleCloseSearch = useCallback(() => {
    setIsSearchOpen(false);
    setSearchQuery('');
  }, []);

  const handleToggleAccountMenu = useCallback(() => {
    pendingSectionFocusRef.current = null;
    setIsAccountMenuOpen((prev) => {
      const next = !prev;
      if (next) {
        setIsSearchOpen(false);
        setSearchQuery('');
      }
      return next;
    });
  }, []);

  const handleCloseAccountMenu = useCallback(() => {
    setIsAccountMenuOpen(false);
  }, []);

  const handleSelectAccountAction = useCallback(
    (action: 'account' | 'config' | 'logout') => {
      pendingSectionFocusRef.current = null;
      setIsAccountMenuOpen(false);
      setIsSearchOpen(false);
      setSearchQuery('');

      if (action === 'logout') {
        handleLogout();
        return;
      }

      const targetSection = action === 'account' ? 'account' : 'presentation';
      setConfigFocusTarget(targetSection);
      setConfigFocusReqId((prev) => prev + 1);
      setCurrentView('config');
    },
    [handleLogout]
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
        return (
          <ConfigView
            focusTarget={configFocusTarget}
            focusRequestId={configFocusReqId}
          />
        );
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
        className="h-[100dvh] nc-safe-screen bg-nc-bg flex flex-col w-full overflow-hidden"
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
              onBack={handleClosePlayer}
              startAt={activeVideo.startAt}
              streamId={activeVideo.streamId}
              onNext={activeVideo.onNext}
              onPrevious={activeVideo.onPrevious}
            />
          )}
        </AnimatePresence>

        {/* Shared Top Navigation Header across all authenticated views */}
        <TopHeader
          currentView={currentView}
          onSelectSection={handleSelectSection}
          onSelectAccountAction={handleSelectAccountAction}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          isSearchOpen={isSearchOpen}
          onOpenSearch={handleOpenSearch}
          onCloseSearch={handleCloseSearch}
          isAccountMenuOpen={isAccountMenuOpen}
          onToggleAccountMenu={handleToggleAccountMenu}
          onCloseAccountMenu={handleCloseAccountMenu}
          username={credentials?.username || credentials?.playlistName}
        />

        {/* Main Content Area below the shared TopHeader */}
        <div className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col relative w-full h-full">
          {/* Transient Failure Banner (preserves credentials, allows retry or optional credential editing) */}
          {hasTransientCategoriesFailure && (
            <div
              role="status"
              data-transient-recovery="true"
              className="nc-notice-banner w-full shrink-0 px-4 py-3 md:px-8 bg-amber-500/10 border-b border-amber-500/30 z-[35]"
            >
              <div
                data-transient-recovery-message="true"
                className="flex items-start sm:items-center gap-2.5 grow shrink basis-72 min-w-[min(100%,18rem)]"
              >
                <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5 sm:mt-0" />
                <p className="nc-text-subtitle text-amber-200 whitespace-normal break-words min-w-0 flex-1">
                  {transientFailureMessage} Suas credenciais continuam salvas neste dispositivo.
                </p>
              </div>
              <div data-nav-row="transient-recovery-actions" className="nc-action-group shrink-0">
                <button
                  type="button"
                  data-transient-retry="true"
                  disabled={isRetryingSession}
                  onClick={handleRetrySession}
                  className="px-3.5 py-1.5 rounded-lg bg-nc-primary text-black nc-text-subtitle font-semibold hover:bg-nc-primary-hover transition-colors flex items-center gap-1.5 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${isRetryingSession ? 'animate-spin' : ''}`} />
                  <span>Tentar novamente</span>
                </button>
                <button
                  type="button"
                  data-transient-edit-login="true"
                  onClick={handleEditCredentialsOnTransientFailure}
                  className="px-3.5 py-1.5 rounded-lg bg-nc-bg-card hover:bg-nc-bg-input text-white border border-nc-border/60 nc-text-subtitle font-medium transition-colors"
                >
                  Revisar servidor
                </button>
              </div>
            </div>
          )}

          <main
            ref={mainViewAreaRef}
            className="flex-1 min-w-0 min-h-0 flex overflow-hidden relative"
          >
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
              <span className="whitespace-normal break-words">{logoutError}</span>
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
                data-continue-while-loading="true"
                onClick={() => {
                  recordHomeManualContinueIntent();
                  setIsOpeningDismissed(true);
                }}
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

export default Home;

