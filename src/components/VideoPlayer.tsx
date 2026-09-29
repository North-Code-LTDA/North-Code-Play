import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { AlertCircle, RefreshCw, Wrench, ArrowLeft } from 'lucide-react';
import { VideoPlayerProps, PlayerContentType } from './player/types';
import { usePlaybackSession } from './player/usePlaybackSession';
import { PlayerControls } from './player/PlayerControls';
import { PlayerSettingsMenu } from './player/PlayerSettingsMenu';
import { PlayerDiagnosticsModal } from './player/PlayerDiagnosticsModal';

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

  // Playback session hook manages HLS.js vs native HTML5, tracks, audio, qualities, buffer
  const session = usePlaybackSession({
    videoRef,
    streamUrl,
    contentType,
    startAt,
    streamId,
    onRetry,
    retryTrigger,
  });

  const activeError = externalError || session.error;
  const isCurrentlyLoading =
    externalLoading || (session.isLoading && !activeError);

  // Detect PiP capability
  useEffect(() => {
    if (typeof document !== 'undefined' && 'pictureInPictureEnabled' in document) {
      setHasPiP(document.pictureInPictureEnabled);
    }
  }, []);

  // Sync fullscreen state with document events
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFs = Boolean(
        document.fullscreenElement ||
          (document as any).webkitFullscreenElement ||
          (document as any).mozFullScreenElement ||
          (document as any).msFullscreenElement
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

  // Inactivity timer: hide controls after 3 seconds of playing
  const resetInactivityTimer = useCallback(() => {
    setIsControlsVisible(true);
    if (idleTimeoutRef.current) {
      clearTimeout(idleTimeoutRef.current);
    }
    // Only auto-hide if playing and no modal is open
    if (
      session.isPlaying &&
      !showSettings &&
      !showDiagnostics &&
      !activeError &&
      !isCurrentlyLoading &&
      !session.isBuffering
    ) {
      idleTimeoutRef.current = setTimeout(() => {
        setIsControlsVisible(false);
      }, 3000);
    }
  }, [
    session.isPlaying,
    session.isBuffering,
    showSettings,
    showDiagnostics,
    activeError,
    isCurrentlyLoading,
  ]);

  useEffect(() => {
    resetInactivityTimer();
    return () => {
      if (idleTimeoutRef.current) clearTimeout(idleTimeoutRef.current);
    };
  }, [resetInactivityTimer]);

  // Fullscreen toggle: container requestFullscreen or visual expansion fallback
  const toggleFullscreen = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;

    const isFs = Boolean(
      document.fullscreenElement || (document as any).webkitFullscreenElement
    );

    if (isFs || isVisuallyExpanded) {
      try {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          await (document as any).webkitExitFullscreen();
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
  }, [isVisuallyExpanded]);

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

  // Keyboard shortcuts active only for active player
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in form inputs
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable)
      ) {
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
          } else if (!embedded) {
            onBack();
          }
          break;
        default:
          // Numeric keys 0-9 seek to % of duration (for VOD/Series)
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
    if (onRetry) {
      onRetry();
    } else {
      setRetryTrigger((p) => p + 1);
    }
  };

  const playerContent = (
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseMove={resetInactivityTimer}
      onTouchStart={resetInactivityTimer}
      onClick={handleContainerClick}
      className={`${
        embedded && !isVisuallyExpanded
          ? 'relative w-full aspect-video rounded-2xl overflow-hidden bg-black border border-nc-border/40 shadow-2xl select-none group'
          : 'fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center select-none overflow-hidden'
      }`}
    >
      {/* Video Element: custom React UI controls native/HLS playback, no Plyr */}
      <video
        ref={videoRef}
        className="w-full h-full object-contain pointer-events-none"
        playsInline
        controls={false}
      />

      {/* Unified React Player Controls */}
      <PlayerControls
        embedded={embedded && !isVisuallyExpanded}
        isVisible={isControlsVisible || !session.isPlaying || Boolean(activeError) || isCurrentlyLoading}
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
        onBack={onBack}
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
          className="absolute inset-0 z-30 flex flex-col items-center justify-center p-6 bg-black/90 backdrop-blur-md text-center"
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
