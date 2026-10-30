import React, { useEffect, useRef, useState, useCallback, useId, useContext } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { AlertCircle, RefreshCw, Wrench, ArrowLeft } from 'lucide-react';
import { VideoPlayerProps } from './player/types';
import { usePlaybackSession } from './player/usePlaybackSession';
import { PlayerControls } from './player/PlayerControls';
import { PlayerSettingsMenu } from './player/PlayerSettingsMenu';
import { PlayerDiagnosticsModal } from './player/PlayerDiagnosticsModal';
import { registerPlayer, setActivePlayer, isPlayerActive } from './player/playerRegistry';
import { XtreamContext } from '../context/XtreamContext';
import {
  useBackHandler,
  BACK_PRIORITY,
  getNavMode,
  focusElementSafely,
  isCentralBackPolicyAttached,
} from '../navigation';

export type { VideoPlayerProps };

export function VideoPlayer({
  streamUrl = '',
  title,
  contentType,
  channelName,
  programTitle,
  onBack,
  embedded = false,
  startAt,
  streamId,
  attemptTrigger: externalAttemptTrigger = 0,
  fullscreenRequestTrigger = 0,
  onNext,
  onPrevious,
  isLoading: externalLoading = false,
  errorMessage: externalError = null,
  onRetry,
  onPlaybackSuccess,
  onPlaybackFinalError,
}: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const xtreamCtx = useContext(XtreamContext);
  const credentials = xtreamCtx?.credentials || null;

  // Modals state
  const [showSettings, setShowSettings] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // Fullscreen & PiP states
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isVisuallyExpanded, setIsVisuallyExpanded] = useState(false);
  const [hasPiP, setHasPiP] = useState(false);

  // Retry trigger for internal engine re-attachment
  const [retryTrigger, setRetryTrigger] = useState(0);
  const combinedRetryTrigger = externalAttemptTrigger + retryTrigger;

  // Inactivity controls visibility
  const [isControlsVisible, setIsControlsVisible] = useState(true);
  const idleTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Track whether reproduction has ever started for current stream
  const [hasStartedPlaying, setHasStartedPlaying] = useState(false);

  // Playback session hook manages HLS.js vs native HTML5, tracks, audio, qualities, buffer
  const session = usePlaybackSession({
    videoRef,
    streamUrl,
    contentType,
    startAt,
    streamId,
    credentials,
    onRetry,
    retryTrigger: combinedRetryTrigger,
    onPlaybackSuccess,
    onPlaybackFinalError,
  });

  const activeError = externalError || session.error;
  const isCurrentlyLoading =
    externalLoading || (session.isLoading && !activeError);

  useEffect(() => {
    if (session.isPlaying) {
      setHasStartedPlaying(true);
    }
  }, [session.isPlaying]);

  useEffect(() => {
    setHasStartedPlaying(false);
  }, [streamUrl, retryTrigger]);

  // Unique player instance identifier and registry tracking
  const playerId = useId();
  useEffect(() => {
    return registerPlayer(playerId);
  }, [playerId]);

  // Detect PiP capability
  useEffect(() => {
    if (typeof document !== 'undefined' && 'pictureInPictureEnabled' in document) {
      setHasPiP(document.pictureInPictureEnabled);
    }
  }, []);

  // Sync fullscreen state with document events (isolated to this player container)
  useEffect(() => {
    const handleFullscreenChange = () => {
      const container = containerRef.current;
      const fsEl =
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement;

      const isFs = Boolean(
        container &&
          fsEl &&
          (fsEl === container || container.contains(fsEl as Node))
      );

      setIsFullscreen(isFs);
      if (!isFs) {
        setIsVisuallyExpanded(false);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  const pendingFocusControlRef = useRef<string | null>(null);
  const wasInFullLayerRef = useRef(false);
  const openOverlayRef = useRef({
    showSettings: false,
    showDiagnostics: false,
    hasError: false,
    isLoading: false,
  });
  openOverlayRef.current = {
    showSettings,
    showDiagnostics,
    hasError: Boolean(activeError),
    isLoading: isCurrentlyLoading,
  };

  const focusPlayerControl = useCallback((controlName: string) => {
    const root = containerRef.current;
    if (!root) return false;
    const target =
      root.querySelector<HTMLElement>(`[data-player-control="${controlName}"]`) ||
      root.querySelector<HTMLElement>('[data-player-control="play-pause"]') ||
      root.querySelector<HTMLElement>('[data-player-control="back"]');
    if (target) {
      focusElementSafely(target);
      return true;
    }
    return false;
  }, []);

  // Inactivity timer: hide control bars after inactivity while playing (unless settings/diagnostics/error are open)
  const scheduleAutoHide = useCallback(() => {
    if (idleTimeoutRef.current) {
      clearTimeout(idleTimeoutRef.current);
      idleTimeoutRef.current = null;
    }

    const canAutoHide =
      (session.isPlaying || (hasStartedPlaying && session.isBuffering)) &&
      !showSettings &&
      !showDiagnostics &&
      !activeError;

    if (canAutoHide) {
      const delayMs = getNavMode() === 'remote' ? 4500 : 3000;
      idleTimeoutRef.current = setTimeout(() => {
        if (
          openOverlayRef.current.showSettings ||
          openOverlayRef.current.showDiagnostics ||
          openOverlayRef.current.hasError
        ) {
          return;
        }
        setIsControlsVisible(false);
        if (
          containerRef.current &&
          document.activeElement &&
          containerRef.current.contains(document.activeElement)
        ) {
          try {
            (document.activeElement as HTMLElement)?.blur();
          } catch {}
        }
      }, delayMs);
    }
  }, [
    session.isPlaying,
    session.isBuffering,
    hasStartedPlaying,
    showSettings,
    showDiagnostics,
    activeError,
  ]);

  const resetInactivityTimer = useCallback(() => {
    setIsControlsVisible(true);
    scheduleAutoHide();
  }, [scheduleAutoHide]);

  const handlePlayerKeyDownCapture = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const key = e.key;
      const isActivityKey =
        key === 'ArrowUp' ||
        key === 'ArrowDown' ||
        key === 'ArrowLeft' ||
        key === 'ArrowRight' ||
        key === 'Enter' ||
        key === 'NumpadEnter' ||
        key === ' ' ||
        key === 'Spacebar' ||
        key === 'Tab' ||
        key === 'Home' ||
        key === 'End';
      if (!isActivityKey) return;
      setActivePlayer(playerId);
      resetInactivityTimer();
    },
    [playerId, resetInactivityTimer]
  );

  // Synchronize timer with state changes only while controls are currently visible
  useEffect(() => {
    if (!isControlsVisible) return;
    scheduleAutoHide();
    return () => {
      if (idleTimeoutRef.current) clearTimeout(idleTimeoutRef.current);
    };
  }, [isControlsVisible, scheduleAutoHide]);

  // Fullscreen toggle: container requestFullscreen or visual expansion fallback
  const toggleFullscreen = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;
    setActivePlayer(playerId);

    const fsEl =
      document.fullscreenElement ||
      (document as any).webkitFullscreenElement ||
      (document as any).mozFullScreenElement ||
      (document as any).msFullscreenElement;

    const isCurrentContainerFs = Boolean(
      container &&
        fsEl &&
        (fsEl === container || container.contains(fsEl as Node))
    );

    const isFs = isCurrentContainerFs || isFullscreen;

    if (isFs || isVisuallyExpanded) {
      try {
        if (isCurrentContainerFs) {
          if (document.exitFullscreen) {
            await document.exitFullscreen();
          } else if ((document as any).webkitExitFullscreen) {
            await (document as any).webkitExitFullscreen();
          } else if ((document as any).mozCancelFullScreen) {
            await (document as any).mozCancelFullScreen();
          } else if ((document as any).msExitFullscreen) {
            await (document as any).msExitFullscreen();
          }
        }
      } catch (err) {
        console.warn('Exit fullscreen failed:', err);
      }
      setIsFullscreen(false);
      setIsVisuallyExpanded(false);
    } else {
      try {
        if (container.requestFullscreen) {
          await container.requestFullscreen();
          setIsFullscreen(true);
        } else if ((container as any).webkitRequestFullscreen) {
          await (container as any).webkitRequestFullscreen();
          setIsFullscreen(true);
        } else if (
          videoRef.current &&
          (videoRef.current as any).webkitEnterFullscreen
        ) {
          // iOS Safari native video fullscreen
          (videoRef.current as any).webkitEnterFullscreen();
        } else {
          // Fallback visual expansion
          setIsVisuallyExpanded(true);
        }
      } catch (err) {
        console.warn('Fullscreen request failed, applying visual expansion:', err);
        setIsVisuallyExpanded(true);
      }
    }
  }, [playerId, isVisuallyExpanded, isFullscreen]);

  // Enter fullscreen explicitly when requested by parent (e.g. 2nd OK on already-selected Live TV channel)
  const prevFsRequestRef = useRef(fullscreenRequestTrigger);
  useEffect(() => {
    if (fullscreenRequestTrigger > 0 && fullscreenRequestTrigger !== prevFsRequestRef.current) {
      prevFsRequestRef.current = fullscreenRequestTrigger;
      const container = containerRef.current;
      const fsEl =
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement;
      const isCurrentContainerFs = Boolean(
        container &&
          fsEl &&
          (fsEl === container || container.contains(fsEl as Node))
      );
      if (!isCurrentContainerFs && !isFullscreen && !isVisuallyExpanded) {
        toggleFullscreen();
      }
    }
  }, [fullscreenRequestTrigger, isFullscreen, isVisuallyExpanded, toggleFullscreen]);

  // Clean exit fullscreen on unmount ONLY if fullscreen belongs to this player instance
  useEffect(() => {
    const container = containerRef.current;
    return () => {
      if (typeof document !== 'undefined') {
        const fsEl =
          document.fullscreenElement ||
          (document as any).webkitFullscreenElement ||
          (document as any).mozFullScreenElement ||
          (document as any).msFullscreenElement;
        if (container && fsEl && (fsEl === container || container.contains(fsEl as Node))) {
          try {
            if (document.exitFullscreen) {
              document.exitFullscreen().catch(() => {});
            } else if ((document as any).webkitExitFullscreen) {
              (document as any).webkitExitFullscreen();
            }
          } catch {}
        }
      }
    };
  }, []);

  const closeSettingsMenu = useCallback(() => {
    setShowSettings(false);
    pendingFocusControlRef.current = 'settings';
    resetInactivityTimer();
  }, [resetInactivityTimer]);

  const closeDiagnosticsModal = useCallback(() => {
    setShowDiagnostics(false);
    pendingFocusControlRef.current = 'diagnostics';
    resetInactivityTimer();
  }, [resetInactivityTimer]);

  // Back action: in embedded mode in fullscreen, first click exits fullscreen back to preview without unmounting video
  const handleBack = useCallback(async () => {
    setActivePlayer(playerId);
    if (showSettings) {
      closeSettingsMenu();
      return;
    }
    if (showDiagnostics) {
      closeDiagnosticsModal();
      return;
    }

    const container = containerRef.current;
    const fsEl =
      document.fullscreenElement ||
      (document as any).webkitFullscreenElement ||
      (document as any).mozFullScreenElement ||
      (document as any).msFullscreenElement;

    const isCurrentContainerFs = Boolean(
      container &&
        fsEl &&
        (fsEl === container || container.contains(fsEl as Node))
    );

    const isFs = isCurrentContainerFs || isFullscreen || isVisuallyExpanded;

    if (embedded && isFs) {
      await toggleFullscreen();
      if (getNavMode() === 'remote' && typeof document !== 'undefined') {
        const selectedChannelBtn = document.querySelector<HTMLButtonElement>(
          'button[data-live-channel-selected="true"]'
        );
        if (selectedChannelBtn) {
          focusElementSafely(selectedChannelBtn);
        }
      }
      return;
    }

    if (onBack) {
      onBack();
    }
  }, [
    playerId,
    embedded,
    isFullscreen,
    isVisuallyExpanded,
    showSettings,
    showDiagnostics,
    closeSettingsMenu,
    closeDiagnosticsModal,
    toggleFullscreen,
    onBack,
  ]);

  // Register Back handlers in centralized Back policy stack
  useBackHandler(
    `player-submodal-${playerId}`,
    BACK_PRIORITY.SUB_MODAL,
    () => {
      if (showSettings) {
        closeSettingsMenu();
        return true;
      }
      if (showDiagnostics) {
        closeDiagnosticsModal();
        return true;
      }
      return false;
    },
    showSettings || showDiagnostics
  );

  const isPlayerInFullLayer = Boolean(!embedded || isFullscreen || isVisuallyExpanded);
  useBackHandler(
    `player-fullscreen-${playerId}`,
    BACK_PRIORITY.FULLSCREEN_PLAYER,
    () => {
      handleBack();
      return true;
    },
    isPlayerInFullLayer
  );

  // PiP toggle
  const togglePiP = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled && !video.disablePictureInPicture) {
        await video.requestPictureInPicture();
      }
    } catch (err) {
      console.warn('PiP toggle error:', err);
    }
  }, []);

  // Controls bars are visible if:
  // - explicitly visible (e.g. within inactivity window)
  // - before playback begins (!hasStartedPlaying)
  // - during pause (when video has started but is not playing and not loading/buffering)
  // - when settings or diagnostics modal is open
  const areBarsVisible =
    isControlsVisible ||
    !hasStartedPlaying ||
    (!session.isPlaying && !isCurrentlyLoading && !session.isBuffering) ||
    showSettings ||
    showDiagnostics;

  // Move focus into the player ONCE when entering full-layer mode, completely decoupled from scheduleAutoHide and menu/playback state changes
  useEffect(() => {
    if (!isPlayerInFullLayer) {
      wasInFullLayerRef.current = false;
      return;
    }
    if (wasInFullLayerRef.current) {
      return;
    }
    wasInFullLayerRef.current = true;
    setIsControlsVisible(true);

    let timerFired = false;
    const timer = setTimeout(() => {
      timerFired = true;
      const root = containerRef.current;
      if (!root) return;

      if (openOverlayRef.current.showSettings || openOverlayRef.current.showDiagnostics) {
        return;
      }

      // Ensure background trigger button (Assistir / Episode card) never keeps focus behind the player
      if (document.activeElement instanceof HTMLElement && !root.contains(document.activeElement)) {
        try {
          document.activeElement.blur();
        } catch {}
      }

      if (getNavMode() === 'remote') {
        if (openOverlayRef.current.hasError && !openOverlayRef.current.isLoading) {
          const retryBtn = root.querySelector<HTMLElement>('[data-player-error-primary="true"]');
          if (retryBtn) {
            focusElementSafely(retryBtn);
            return;
          }
        }
        focusPlayerControl('play-pause');
      }
    }, 0);

    return () => {
      clearTimeout(timer);
      if (!timerFired) {
        wasInFullLayerRef.current = false;
      }
    };
  }, [isPlayerInFullLayer, focusPlayerControl]);

  // Focus error overlay primary button when an error appears in remote mode
  useEffect(() => {
    if (!activeError || isCurrentlyLoading || !isPlayerInFullLayer) return;
    if (showSettings || showDiagnostics) return;
    if (getNavMode() !== 'remote') return;
    const timer = setTimeout(() => {
      const retryBtn = containerRef.current?.querySelector<HTMLElement>(
        '[data-player-error-primary="true"]'
      );
      if (retryBtn) {
        focusElementSafely(retryBtn);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [activeError, isCurrentlyLoading, isPlayerInFullLayer, showSettings, showDiagnostics]);

  // Apply pending focus request (e.g. after waking hidden controls or closing Settings/Diagnostics modal)
  useEffect(() => {
    if (!areBarsVisible || showSettings || showDiagnostics) return;
    if (!pendingFocusControlRef.current) return;

    const targetControl = pendingFocusControlRef.current;
    pendingFocusControlRef.current = null;

    const timer = setTimeout(() => {
      focusPlayerControl(targetControl);
    }, 0);
    return () => clearTimeout(timer);
  }, [areBarsVisible, showSettings, showDiagnostics, focusPlayerControl]);

  // Capture-phase listener: when full-layer player controls are hidden, first remote/arrow/OK key reveals controls and focuses Play/Pause without firing other actions
  useEffect(() => {
    if (!isPlayerInFullLayer || areBarsVisible || showSettings || showDiagnostics || activeError) {
      return;
    }

    const handleWakeKeyCapture = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const isWakeKey =
        e.key === 'Enter' ||
        e.key === 'NumpadEnter' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight';

      if (!isWakeKey) return;

      e.preventDefault();
      e.stopPropagation();
      pendingFocusControlRef.current = 'play-pause';
      resetInactivityTimer();
    };

    window.addEventListener('keydown', handleWakeKeyCapture, true);
    return () => {
      window.removeEventListener('keydown', handleWakeKeyCapture, true);
    };
  }, [isPlayerInFullLayer, areBarsVisible, showSettings, showDiagnostics, activeError, resetInactivityTimer]);

  // Keyboard shortcuts active only when no form or interactive control is focused
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;

      const activeEl = document.activeElement as HTMLElement | null;
      if (activeEl) {
        const tagName = activeEl.tagName;
        const role = activeEl.getAttribute('role');
        if (
          tagName === 'INPUT' ||
          tagName === 'TEXTAREA' ||
          tagName === 'BUTTON' ||
          tagName === 'SELECT' ||
          role === 'button' ||
          role === 'slider' ||
          role === 'menuitem' ||
          activeEl.getAttribute('data-nav-item') === 'true' ||
          activeEl.isContentEditable
        ) {
          return;
        }
      }

      if (!containerRef.current) return;

      const isCurrentFs = isFullscreen || isVisuallyExpanded;
      const isFocused = Boolean(
        activeEl && containerRef.current.contains(activeEl)
      );

      // Multiple instances check: only the active, fullscreen, or focused player receives shortcuts
      if (!isPlayerActive(playerId, isCurrentFs, isFocused)) {
        return;
      }

      resetInactivityTimer();

      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          session.togglePlay();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          session.toggleMute();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          session.seekBy(-10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          session.seekBy(10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          session.setVolume(session.volume + 0.1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          session.setVolume(session.volume - 0.1);
          break;
        case 'Escape':
          if (!isCentralBackPolicyAttached()) {
            e.preventDefault();
            if (showSettings) {
              closeSettingsMenu();
            } else if (showDiagnostics) {
              closeDiagnosticsModal();
            } else if (isFullscreen || isVisuallyExpanded) {
              toggleFullscreen();
            } else if (!embedded && onBack) {
              onBack();
            }
          }
          break;
        default:
          if (!session.isLive && /^[0-9]$/.test(e.key) && session.duration > 0) {
            e.preventDefault();
            const pct = parseInt(e.key, 10) * 0.1;
            session.seek(session.duration * pct);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    playerId,
    session,
    resetInactivityTimer,
    toggleFullscreen,
    showSettings,
    showDiagnostics,
    closeSettingsMenu,
    closeDiagnosticsModal,
    isFullscreen,
    isVisuallyExpanded,
    embedded,
    onBack,
  ]);

  const handleContainerClick = () => {
    setActivePlayer(playerId);
    // If settings or diagnostics open, close them
    if (showSettings) {
      closeSettingsMenu();
      return;
    }
    if (showDiagnostics) {
      closeDiagnosticsModal();
      return;
    }

    // Toggle play/pause or show controls
    if (!isControlsVisible) {
      setIsControlsVisible(true);
      resetInactivityTimer();
    } else {
      session.togglePlay();
    }
  };

  const handleRetry = () => {
    if (onRetry) {
      onRetry();
    } else {
      setRetryTrigger((p) => p + 1);
    }
  };

  const playerContent = (
    <motion.div
      ref={containerRef}
      data-player-container="true"
      data-focus-scope={isPlayerInFullLayer ? 'modal' : undefined}
      data-player-active-shortcuts={
        isPlayerActive(playerId, isFullscreen || isVisuallyExpanded, false) ? 'true' : undefined
      }
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseMove={() => {
        setActivePlayer(playerId);
        resetInactivityTimer();
      }}
      onTouchStart={() => {
        setActivePlayer(playerId);
        resetInactivityTimer();
      }}
      onPointerDown={() => {
        setActivePlayer(playerId);
        resetInactivityTimer();
      }}
      onKeyDownCapture={handlePlayerKeyDownCapture}
      onClick={handleContainerClick}
      className={`${
        embedded && !isVisuallyExpanded
          ? 'relative w-full aspect-video rounded-2xl overflow-hidden bg-black border border-nc-border/40 shadow-2xl select-none group'
          : 'fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center select-none overflow-hidden'
      }`}
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        className="w-full h-full object-contain pointer-events-none"
        playsInline
        controls={false}
      />

      {/* Unified React Player Controls */}
      <PlayerControls
        embedded={embedded && !isVisuallyExpanded}
        isVisible={areBarsVisible}
        title={title}
        channelName={channelName}
        programTitle={programTitle}
        isLive={session.isLive}
        isPlaying={session.isPlaying}
        isLoading={isCurrentlyLoading}
        isBuffering={session.isBuffering}
        currentTime={session.currentTime}
        duration={session.duration}
        bufferedRanges={session.bufferedRanges}
        volume={session.volume}
        isMuted={session.isMuted}
        isFullscreen={isFullscreen || isVisuallyExpanded}
        isAtLiveEdge={session.isAtLiveEdge}
        liveEdgeDistance={session.liveEdgeDistance}
        onTogglePlay={session.togglePlay}
        onSeek={session.seek}
        onSeekBy={session.seekBy}
        onSeekToLive={session.seekToLive}
        onVolumeChange={session.setVolume}
        onToggleMute={session.toggleMute}
        onToggleFullscreen={toggleFullscreen}
        onTogglePiP={togglePiP}
        onOpenSettings={() => {
          setShowDiagnostics(false);
          setShowSettings((p) => !p);
          resetInactivityTimer();
        }}
        onOpenDiagnostics={() => {
          setShowSettings(false);
          setShowDiagnostics((p) => !p);
          resetInactivityTimer();
        }}
        onBack={onBack ? handleBack : undefined}
        onNext={onNext}
        onPrevious={onPrevious}
        onUserInteraction={resetInactivityTimer}
        hasPiP={hasPiP}
      />

      {/* Settings Menu Overlay */}
      <PlayerSettingsMenu
        isOpen={showSettings}
        onClose={closeSettingsMenu}
        isLive={session.isLive}
        qualities={session.qualities}
        currentQuality={session.currentQuality}
        onSelectQuality={session.setQuality}
        audioTracks={session.audioTracks}
        currentAudioTrack={session.currentAudioTrack}
        onSelectAudioTrack={session.setAudioTrack}
        subtitleTracks={session.subtitleTracks}
        currentSubtitleTrack={session.currentSubtitleTrack}
        onSelectSubtitleTrack={session.setSubtitleTrack}
        playbackRate={session.playbackRate}
        onSelectPlaybackRate={session.setPlaybackRate}
        bufferProfile={session.bufferProfile}
        onSelectBufferProfile={session.setProfile}
      />

      {/* Diagnostics Modal Overlay */}
      <PlayerDiagnosticsModal
        isOpen={showDiagnostics}
        onClose={closeDiagnosticsModal}
        streamUrl={streamUrl}
        contentType={session.isLive ? 'live' : contentType || 'movie'}
        transport={session.inferredTransport}
        stats={session.stats}
      />

      {/* Error Overlay */}
      {activeError && !isCurrentlyLoading && (
        <div
          className="absolute inset-0 z-30 flex flex-col items-center justify-center p-6 bg-black/90 backdrop-blur-md text-center pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-14 h-14 rounded-full bg-red-500/20 flex items-center justify-center mb-4">
            <AlertCircle className="w-7 h-7 text-red-500" />
          </div>
          <h3 className="text-lg font-bold text-white mb-2">Erro de Reprodução Direta</h3>
          <p className="text-red-400 text-sm max-w-lg mb-6 leading-relaxed">
            {activeError}
          </p>

          <div data-nav-row="player-error" className="flex flex-wrap gap-3 justify-center">
            <button
              type="button"
              data-player-error-primary="true"
              onClick={handleRetry}
              className="px-5 py-2.5 bg-nc-primary text-black font-semibold rounded-xl transition-all hover:brightness-110 flex items-center gap-2 text-sm cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" /> Tentar Novamente
            </button>
            <button
              type="button"
              onClick={() => {
                setShowDiagnostics(true);
                resetInactivityTimer();
              }}
              className="px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white font-medium rounded-xl transition-colors border border-nc-border/40 flex items-center gap-2 text-sm cursor-pointer"
            >
              <Wrench className="w-4 h-4 text-nc-primary" /> Diagnóstico
            </button>
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="px-5 py-2.5 bg-nc-bg-card hover:bg-nc-bg-input text-nc-text-secondary hover:text-white font-medium rounded-xl transition-colors border border-nc-border/50 text-sm cursor-pointer flex items-center gap-1.5"
              >
                <ArrowLeft className="w-4 h-4" /> Voltar
              </button>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );

  // If in full mode (not embedded and not visually expanded into embedded container), portal to document.body
  if (!embedded && typeof document !== 'undefined') {
    return createPortal(playerContent, document.body);
  }

  return playerContent;
}
