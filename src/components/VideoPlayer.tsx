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
  onNext,
  onPrevious,
  isLoading: externalLoading = false,
  errorMessage: externalError = null,
  onRetry,
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

  // Inactivity controls visibility
  const [isControlsVisible, setIsControlsVisible] = useState(true);
  const idleTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Track whether reproduction has ever started for current stream
  const [hasStartedPlaying, setHasStartedPlaying] = useState(false);

  // Track accessible keyboard navigation vs mouse clicks to defuse lingering focus
  const isKeyboardNavigatingRef = useRef(false);

  // Playback session hook manages HLS.js vs native HTML5, tracks, audio, qualities, buffer
  const session = usePlaybackSession({
    videoRef,
    streamUrl,
    contentType,
    startAt,
    streamId,
    credentials,
    onRetry,
    retryTrigger,
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab' || e.key.startsWith('Arrow')) {
        isKeyboardNavigatingRef.current = true;
      }
    };
    const handlePointerDown = () => {
      isKeyboardNavigatingRef.current = false;
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, []);

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

  // Inactivity timer: hide control bars after 3 seconds of playing or buffering (if playback already started)
  const resetInactivityTimer = useCallback(() => {
    setIsControlsVisible(true);
    if (idleTimeoutRef.current) {
      clearTimeout(idleTimeoutRef.current);
    }

    const isAccessibleKeyboardFocus = Boolean(
      containerRef.current &&
        document.activeElement &&
        containerRef.current.contains(document.activeElement) &&
        (isKeyboardNavigatingRef.current ||
          (typeof (document.activeElement as any).matches === 'function' &&
            (document.activeElement as any).matches(':focus-visible')))
    );

    // Auto-hide bars after 3 seconds:
    // - during active playback
    // - OR during a buffering interruption in a video that already started playing
    // - regardless of buffer profile (including "Mais Estabilidade")
    // - provided settings/diagnostics modals are not open, no error, and no active keyboard navigation focus
    const canAutoHide =
      (session.isPlaying || (hasStartedPlaying && session.isBuffering)) &&
      !showSettings &&
      !showDiagnostics &&
      !activeError &&
      !isAccessibleKeyboardFocus;

    if (canAutoHide) {
      idleTimeoutRef.current = setTimeout(() => {
        setIsControlsVisible(false);
        // Defuse lingering mouse-click focus if retained
        if (
          containerRef.current &&
          document.activeElement &&
          containerRef.current.contains(document.activeElement) &&
          !isKeyboardNavigatingRef.current
        ) {
          try {
            (document.activeElement as HTMLElement)?.blur();
          } catch {}
        }
      }, 3000);
    }
  }, [
    session.isPlaying,
    session.isBuffering,
    hasStartedPlaying,
    showSettings,
    showDiagnostics,
    activeError,
  ]);

  // Synchronize timer with state changes only while controls are currently visible
  useEffect(() => {
    if (!isControlsVisible) return;

    if (idleTimeoutRef.current) {
      clearTimeout(idleTimeoutRef.current);
    }

    const isAccessibleKeyboardFocus = Boolean(
      containerRef.current &&
        document.activeElement &&
        containerRef.current.contains(document.activeElement) &&
        (isKeyboardNavigatingRef.current ||
          (typeof (document.activeElement as any).matches === 'function' &&
            (document.activeElement as any).matches(':focus-visible')))
    );

    const canAutoHide =
      (session.isPlaying || (hasStartedPlaying && session.isBuffering)) &&
      !showSettings &&
      !showDiagnostics &&
      !activeError &&
      !isAccessibleKeyboardFocus;

    if (canAutoHide) {
      idleTimeoutRef.current = setTimeout(() => {
        setIsControlsVisible(false);
        if (
          containerRef.current &&
          document.activeElement &&
          containerRef.current.contains(document.activeElement) &&
          !isKeyboardNavigatingRef.current
        ) {
          try {
            (document.activeElement as HTMLElement)?.blur();
          } catch {}
        }
      }, 3000);
    }

    return () => {
      if (idleTimeoutRef.current) clearTimeout(idleTimeoutRef.current);
    };
  }, [
    isControlsVisible,
    session.isPlaying,
    session.isBuffering,
    hasStartedPlaying,
    showSettings,
    showDiagnostics,
    activeError,
  ]);

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
        if (document.fullscreenElement || (document as any).webkitFullscreenElement) {
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

  // Clean exit fullscreen on unmount if element was in fullscreen
  useEffect(() => {
    return () => {
      if (typeof document !== 'undefined' && document.fullscreenElement) {
        try {
          if (document.exitFullscreen) {
            document.exitFullscreen().catch(() => {});
          }
        } catch {}
      }
    };
  }, []);

  // Back action: in embedded mode in fullscreen, first click exits fullscreen back to preview without unmounting video
  const handleBack = useCallback(async () => {
    setActivePlayer(playerId);
    if (showSettings) {
      setShowSettings(false);
      return;
    }
    if (showDiagnostics) {
      setShowDiagnostics(false);
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
      return;
    }

    if (onBack) {
      onBack();
    }
  }, [playerId, embedded, isFullscreen, isVisuallyExpanded, showSettings, showDiagnostics, toggleFullscreen, onBack]);

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

  // Keyboard shortcuts active only when no form or interactive control is focused
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement as HTMLElement | null;
      if (activeEl) {
        const tagName = activeEl.tagName;
        const role = activeEl.getAttribute('role');
        if (
          tagName === 'INPUT' ||
          tagName === 'TEXTAREA' ||
          tagName === 'BUTTON' ||
          tagName === 'SELECT' ||
          role === 'slider' ||
          role === 'menuitem' ||
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
          if (showSettings) {
            setShowSettings(false);
          } else if (showDiagnostics) {
            setShowDiagnostics(false);
          } else if (isFullscreen || isVisuallyExpanded) {
            toggleFullscreen();
          } else if (!embedded && onBack) {
            onBack();
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
    isFullscreen,
    isVisuallyExpanded,
    embedded,
    onBack,
  ]);

  const handleContainerClick = () => {
    setActivePlayer(playerId);
    // If settings or diagnostics open, close them
    if (showSettings) {
      setShowSettings(false);
      return;
    }
    if (showDiagnostics) {
      setShowDiagnostics(false);
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
    setRetryTrigger((p) => p + 1);
    if (onRetry) {
      onRetry();
    }
  };

  // Controls bars are visible if:
  // - explicitly visible (e.g. within 3s of interaction)
  // - before playback begins (!hasStartedPlaying)
  // - during pause (when video has started but is not playing and not loading/buffering)
  // - when settings or diagnostics modal is open
  const areBarsVisible =
    isControlsVisible ||
    !hasStartedPlaying ||
    (!session.isPlaying && !isCurrentlyLoading && !session.isBuffering) ||
    showSettings ||
    showDiagnostics;

  const playerContent = (
    <motion.div
      ref={containerRef}
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
        onOpenSettings={() => setShowSettings((p) => !p)}
        onOpenDiagnostics={() => setShowDiagnostics((p) => !p)}
        onBack={onBack ? handleBack : undefined}
        onNext={onNext}
        onPrevious={onPrevious}
        hasPiP={hasPiP}
      />

      {/* Settings Menu Overlay */}
      <PlayerSettingsMenu
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
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
        onClose={() => setShowDiagnostics(false)}
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

          <div className="flex flex-wrap gap-3 justify-center">
            <button
              onClick={handleRetry}
              className="px-5 py-2.5 bg-nc-primary text-black font-semibold rounded-xl transition-all hover:brightness-110 flex items-center gap-2 text-sm cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" /> Tentar Novamente
            </button>
            <button
              onClick={() => setShowDiagnostics(true)}
              className="px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white font-medium rounded-xl transition-colors border border-nc-border/40 flex items-center gap-2 text-sm cursor-pointer"
            >
              <Wrench className="w-4 h-4 text-nc-primary" /> Diagnóstico
            </button>
            {onBack && (
              <button
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
