import React, { useEffect, useRef, useState, useCallback, useId, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { AlertCircle, RefreshCw, Wrench, ArrowLeft } from 'lucide-react';
import { VideoPlayerProps, VideoPlayerHandle } from './player/types';
import { usePlaybackSession } from './player/usePlaybackSession';
import { PlayerControls } from './player/PlayerControls';
import { PlayerSettingsMenu, SubMenuType } from './player/PlayerSettingsMenu';
import { PlayerDiagnosticsModal } from './player/PlayerDiagnosticsModal';
import { registerPlayer, setActivePlayer, isPlayerActive } from './player/playerRegistry';
import { useOptionalXtreamCredentials } from '../context/XtreamContext';
import {
  useBackHandler,
  BACK_PRIORITY,
  getNavMode,
  focusElementSafely,
  isCentralBackPolicyAttached,
} from '../navigation';

export type { VideoPlayerProps, VideoPlayerHandle };

export const VideoPlayer = React.memo(
  React.forwardRef<VideoPlayerHandle, VideoPlayerProps>(function VideoPlayer(
    {
      playerRef,
      streamUrl = '',
      title,
      contentType,
      channelName,
      programTitle,
      onBack,
      embedded = false,
      disableEmbeddedControlsFocus = false,
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
      externalSubtitles,
    }: VideoPlayerProps,
    forwardedRef
  ) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const credentials = useOptionalXtreamCredentials();

  // Modals state
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialSubMenu, setSettingsInitialSubMenu] = useState<SubMenuType>('main');
  const settingsOriginControlRef = useRef<string>('settings');
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // Fullscreen & PiP states
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isVisuallyExpanded, setIsVisuallyExpanded] = useState(false);
  const [isEnteringFullscreen, setIsEnteringFullscreen] = useState(false);
  const [isExitingFullscreen, setIsExitingFullscreen] = useState(false);
  const [hasPiP, setHasPiP] = useState(false);
  const isMountedRef = useRef(true);
  const isEnteringFullscreenRef = useRef(false);
  const isExitingFullscreenRef = useRef(false);
  const fullscreenEntryRequestIdRef = useRef(0);
  const pendingFullscreenPromiseRef = useRef<Promise<boolean> | null>(null);

  const activeSelectionKey = `${String(streamId ?? '')}|${String(streamUrl ?? '')}|${String(channelName ?? '')}`;
  const activeSelectionKeyRef = useRef(activeSelectionKey);
  const selectionGenerationRef = useRef(0);
  if (activeSelectionKeyRef.current !== activeSelectionKey) {
    activeSelectionKeyRef.current = activeSelectionKey;
    selectionGenerationRef.current += 1;
  }

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
    isControlsVisible:
      isControlsVisible || !hasStartedPlaying || showSettings || showDiagnostics,
    isDiagnosticsOpen: showDiagnostics,
    externalSubtitles,
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
      if (isFs) {
        isEnteringFullscreenRef.current = false;
        pendingFullscreenPromiseRef.current = null;
        setIsEnteringFullscreen(false);
      } else if (!isEnteringFullscreenRef.current) {
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

  const isContainerCurrentlyFullscreen = useCallback(() => {
    if (typeof document === 'undefined') {
      return false;
    }
    const container = containerRef.current;
    const fsEl =
      document.fullscreenElement ||
      (document as any).webkitFullscreenElement ||
      (document as any).mozFullScreenElement ||
      (document as any).msFullscreenElement;

    return Boolean(
      container &&
        fsEl &&
        (fsEl === container || container.contains(fsEl as Node))
    );
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

  const performFullscreenExit = useCallback(async (): Promise<boolean> => {
    if (isExitingFullscreenRef.current) {
      return false;
    }

    const isCurrentContainerFs = isContainerCurrentlyFullscreen();
    const isFs =
      isCurrentContainerFs ||
      isFullscreen ||
      isVisuallyExpanded ||
      isEnteringFullscreenRef.current ||
      isEnteringFullscreen;
    if (!isFs) {
      return false;
    }

    fullscreenEntryRequestIdRef.current += 1;
    isEnteringFullscreenRef.current = false;
    pendingFullscreenPromiseRef.current = null;
    isExitingFullscreenRef.current = true;
    if (isMountedRef.current) {
      setIsEnteringFullscreen(false);
      setIsExitingFullscreen(true);
    }

    try {
      if (isCurrentContainerFs && typeof document !== 'undefined') {
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
    } finally {
      isExitingFullscreenRef.current = false;
      if (isMountedRef.current) {
        setIsExitingFullscreen(false);
      }
    }

    const stillContainerFs = isContainerCurrentlyFullscreen();
    if (stillContainerFs) {
      if (isMountedRef.current) {
        setIsFullscreen(true);
      }
      return false;
    }

    if (isMountedRef.current) {
      setIsFullscreen(false);
      setIsVisuallyExpanded(false);
      setIsEnteringFullscreen(false);
    }

    return true;
  }, [isContainerCurrentlyFullscreen, isFullscreen, isVisuallyExpanded, isEnteringFullscreen]);

  // Direct fullscreen entry invoked synchronously within user interaction context
  const requestFullscreenImmediate = useCallback((): Promise<boolean> => {
    const container = containerRef.current;
    if (!container) return Promise.resolve(false);
    setActivePlayer(playerId);

    if (isExitingFullscreenRef.current) {
      return Promise.resolve(false);
    }

    if (isEnteringFullscreenRef.current) {
      resetInactivityTimer();
      return pendingFullscreenPromiseRef.current ?? Promise.resolve(true);
    }

    const isCurrentContainerFs = isContainerCurrentlyFullscreen();
    if (isCurrentContainerFs || isFullscreen || isVisuallyExpanded) {
      resetInactivityTimer();
      return Promise.resolve(true);
    }

    const requestId = ++fullscreenEntryRequestIdRef.current;
    isEnteringFullscreenRef.current = true;

    let nativePromise: Promise<void> | null = null;
    let usedNativeCall = false;
    let syncThrew = false;

    try {
      if (typeof container.requestFullscreen === 'function') {
        usedNativeCall = true;
        const res = container.requestFullscreen();
        if (res && typeof (res as Promise<void>).then === 'function') {
          nativePromise = res as Promise<void>;
        }
      } else if (typeof (container as any).webkitRequestFullscreen === 'function') {
        usedNativeCall = true;
        const res = (container as any).webkitRequestFullscreen();
        if (res && typeof (res as Promise<void>).then === 'function') {
          nativePromise = res as Promise<void>;
        }
      } else if (
        videoRef.current &&
        typeof (videoRef.current as any).webkitEnterFullscreen === 'function'
      ) {
        usedNativeCall = true;
        (videoRef.current as any).webkitEnterFullscreen();
      }
    } catch (err) {
      console.warn('Fullscreen request failed, applying visual expansion:', err);
      syncThrew = true;
    }

    if (!usedNativeCall || syncThrew) {
      isEnteringFullscreenRef.current = false;
      pendingFullscreenPromiseRef.current = null;
      if (isMountedRef.current) {
        setIsEnteringFullscreen(false);
        setIsVisuallyExpanded(true);
        setIsControlsVisible(true);
      }
      return Promise.resolve(true);
    }

    if (!nativePromise) {
      isEnteringFullscreenRef.current = false;
      pendingFullscreenPromiseRef.current = null;
      if (isMountedRef.current) {
        setIsEnteringFullscreen(false);
        if (isContainerCurrentlyFullscreen()) {
          setIsFullscreen(true);
        } else {
          setIsVisuallyExpanded(true);
        }
        setIsControlsVisible(true);
      }
      return Promise.resolve(true);
    }

    if (isMountedRef.current) {
      setIsEnteringFullscreen(true);
      setIsControlsVisible(true);
    }

    const completionPromise = nativePromise
      .then(() => {
        if (fullscreenEntryRequestIdRef.current !== requestId) {
          if (
            isContainerCurrentlyFullscreen() &&
            typeof document !== 'undefined' &&
            typeof document.exitFullscreen === 'function'
          ) {
            document.exitFullscreen().catch(() => {});
          }
          return false;
        }
        isEnteringFullscreenRef.current = false;
        pendingFullscreenPromiseRef.current = null;
        if (isMountedRef.current) {
          setIsEnteringFullscreen(false);
          setIsFullscreen(true);
          if (
            getNavMode() === 'remote' &&
            containerRef.current &&
            typeof document !== 'undefined' &&
            (!document.activeElement || !containerRef.current.contains(document.activeElement)) &&
            !openOverlayRef.current.showSettings &&
            !openOverlayRef.current.showDiagnostics
          ) {
            focusPlayerControl('play-pause');
          }
        }
        return true;
      })
      .catch((err) => {
        console.warn('Fullscreen request failed, applying visual expansion:', err);
        if (fullscreenEntryRequestIdRef.current !== requestId) {
          return false;
        }
        isEnteringFullscreenRef.current = false;
        pendingFullscreenPromiseRef.current = null;
        if (isMountedRef.current) {
          setIsEnteringFullscreen(false);
          setIsVisuallyExpanded(true);
          if (
            getNavMode() === 'remote' &&
            containerRef.current &&
            typeof document !== 'undefined' &&
            (!document.activeElement || !containerRef.current.contains(document.activeElement)) &&
            !openOverlayRef.current.showSettings &&
            !openOverlayRef.current.showDiagnostics
          ) {
            focusPlayerControl('play-pause');
          }
        }
        return true;
      });

    pendingFullscreenPromiseRef.current = completionPromise;
    return completionPromise;
  }, [
    playerId,
    isContainerCurrentlyFullscreen,
    isFullscreen,
    isVisuallyExpanded,
    resetInactivityTimer,
    focusPlayerControl,
  ]);

  // Fullscreen toggle: container requestFullscreen or visual expansion fallback
  const toggleFullscreen = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;
    setActivePlayer(playerId);

    if (isExitingFullscreenRef.current || isEnteringFullscreenRef.current) {
      return;
    }

    const isCurrentContainerFs = isContainerCurrentlyFullscreen();
    const isFs = isCurrentContainerFs || isFullscreen;

    if (isFs || isVisuallyExpanded) {
      await performFullscreenExit();
    } else {
      await requestFullscreenImmediate();
    }
  }, [
    playerId,
    isContainerCurrentlyFullscreen,
    isVisuallyExpanded,
    isFullscreen,
    performFullscreenExit,
    requestFullscreenImmediate,
  ]);

  const playerHandle = useCallback(
    (): VideoPlayerHandle => ({
      requestFullscreenImmediate,
      exitFullscreenImmediate: performFullscreenExit,
      isFullscreenOrPending: () =>
        Boolean(
          isEnteringFullscreenRef.current ||
            isEnteringFullscreen ||
            isContainerCurrentlyFullscreen() ||
            isFullscreen ||
            isVisuallyExpanded
        ),
    }),
    [
      requestFullscreenImmediate,
      performFullscreenExit,
      isEnteringFullscreen,
      isContainerCurrentlyFullscreen,
      isFullscreen,
      isVisuallyExpanded,
    ]
  );

  useImperativeHandle(forwardedRef, playerHandle, [playerHandle]);
  useImperativeHandle(playerRef, playerHandle, [playerHandle]);

  // Enter fullscreen explicitly when requested by parent via prop trigger
  const prevFsRequestRef = useRef(fullscreenRequestTrigger);
  useEffect(() => {
    if (fullscreenRequestTrigger > 0 && fullscreenRequestTrigger !== prevFsRequestRef.current) {
      prevFsRequestRef.current = fullscreenRequestTrigger;
      const isCurrentContainerFs = isContainerCurrentlyFullscreen();
      if (
        !isCurrentContainerFs &&
        !isFullscreen &&
        !isVisuallyExpanded &&
        !isEnteringFullscreenRef.current
      ) {
        void requestFullscreenImmediate();
      }
    }
  }, [
    fullscreenRequestTrigger,
    isContainerCurrentlyFullscreen,
    isFullscreen,
    isVisuallyExpanded,
    requestFullscreenImmediate,
  ]);

  // Clean exit fullscreen on unmount ONLY if fullscreen belongs to this player instance
  useEffect(() => {
    isMountedRef.current = true;
    const container = containerRef.current;
    return () => {
      isMountedRef.current = false;
      selectionGenerationRef.current += 1;
      if (typeof document !== 'undefined' && !isExitingFullscreenRef.current) {
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
    pendingFocusControlRef.current = settingsOriginControlRef.current || 'settings';
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

    if (isExitingFullscreenRef.current) {
      return;
    }

    const isCurrentContainerFs = isContainerCurrentlyFullscreen();
    const isFs =
      isCurrentContainerFs ||
      isFullscreen ||
      isVisuallyExpanded ||
      isEnteringFullscreenRef.current ||
      isEnteringFullscreen;

    if (embedded && isFs) {
      const exitSelectionGeneration = selectionGenerationRef.current;
      const exitSelectionKey = activeSelectionKeyRef.current;
      const initialSelectedChannelBtn =
        typeof document !== 'undefined'
          ? (document.querySelector<HTMLButtonElement>(
              'button[data-live-channel-origin="true"]'
            ) ||
            document.querySelector<HTMLButtonElement>(
              'button[data-live-channel-selected="true"]'
            ))
          : null;
      const initialSelectedChannelId =
        initialSelectedChannelBtn?.getAttribute('data-live-channel-id') ?? null;

      const didExitFullscreen = await performFullscreenExit();
      const isStillSamePlayerAndSelection =
        isMountedRef.current &&
        Boolean(containerRef.current && containerRef.current.isConnected) &&
        selectionGenerationRef.current === exitSelectionGeneration &&
        activeSelectionKeyRef.current === exitSelectionKey;

      if (!isStillSamePlayerAndSelection) {
        return;
      }

      if (!didExitFullscreen) {
        if (
          containerRef.current &&
          isContainerCurrentlyFullscreen() &&
          getNavMode() === 'remote' &&
          typeof document !== 'undefined' &&
          (!document.activeElement ||
            !containerRef.current.contains(document.activeElement))
        ) {
          focusPlayerControl('play-pause');
        }
        return;
      }

      if (getNavMode() === 'remote' && typeof document !== 'undefined') {
        const selectedChannelBtn =
          document.querySelector<HTMLButtonElement>(
            'button[data-live-channel-origin="true"]'
          ) ||
          document.querySelector<HTMLButtonElement>(
            'button[data-live-channel-selected="true"]'
          );
        if (selectedChannelBtn && selectedChannelBtn.isConnected) {
          const currentChannelId = selectedChannelBtn.getAttribute(
            'data-live-channel-id'
          );
          const isSameChannelButton =
            initialSelectedChannelId !== null
              ? currentChannelId === initialSelectedChannelId
              : initialSelectedChannelBtn === null ||
                selectedChannelBtn === initialSelectedChannelBtn;

          if (isSameChannelButton) {
            focusElementSafely(selectedChannelBtn);
          }
        }
      }
      return;
    }

    if (onBack) {
      selectionGenerationRef.current += 1;
      onBack();
    }
  }, [
    playerId,
    embedded,
    isContainerCurrentlyFullscreen,
    isFullscreen,
    isVisuallyExpanded,
    isEnteringFullscreen,
    showSettings,
    showDiagnostics,
    closeSettingsMenu,
    closeDiagnosticsModal,
    performFullscreenExit,
    focusPlayerControl,
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

  const isPlayerInFullLayer = Boolean(
    !embedded ||
      isFullscreen ||
      isVisuallyExpanded ||
      isEnteringFullscreen ||
      isExitingFullscreen
  );
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

  const shortcutContextRef = useRef({
    session,
    resetInactivityTimer,
    toggleFullscreen,
    handleBack,
    showSettings,
    showDiagnostics,
    closeSettingsMenu,
    closeDiagnosticsModal,
    isFullscreen,
    isVisuallyExpanded,
    isExitingFullscreen,
    embedded,
    onBack,
  });
  shortcutContextRef.current = {
    session,
    resetInactivityTimer,
    toggleFullscreen,
    handleBack,
    showSettings,
    showDiagnostics,
    closeSettingsMenu,
    closeDiagnosticsModal,
    isFullscreen,
    isVisuallyExpanded,
    isExitingFullscreen,
    embedded,
    onBack,
  };

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

      const ctx = shortcutContextRef.current;
      const isCurrentFs = ctx.isFullscreen || ctx.isVisuallyExpanded;
      const isFocused = Boolean(
        activeEl && containerRef.current.contains(activeEl)
      );

      // Multiple instances check: only the active, fullscreen, or focused player receives shortcuts
      if (!isPlayerActive(playerId, isCurrentFs, isFocused)) {
        return;
      }

      ctx.resetInactivityTimer();

      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          if (isEnteringFullscreenRef.current || isExitingFullscreenRef.current) {
            break;
          }
          ctx.session.togglePlay();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          ctx.toggleFullscreen();
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          ctx.session.toggleMute();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          ctx.session.seekBy(-10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          ctx.session.seekBy(10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          ctx.session.setVolume(ctx.session.volume + 0.1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          ctx.session.setVolume(ctx.session.volume - 0.1);
          break;
        case 'Escape':
          if (!isCentralBackPolicyAttached()) {
            e.preventDefault();
            if (ctx.showSettings) {
              ctx.closeSettingsMenu();
            } else if (ctx.showDiagnostics) {
              ctx.closeDiagnosticsModal();
            } else if (
              ctx.embedded &&
              (ctx.isFullscreen ||
                ctx.isVisuallyExpanded ||
                isEnteringFullscreenRef.current ||
                ctx.isExitingFullscreen)
            ) {
              ctx.handleBack();
            } else if (
              ctx.isFullscreen ||
              ctx.isVisuallyExpanded ||
              isEnteringFullscreenRef.current ||
              ctx.isExitingFullscreen
            ) {
              ctx.toggleFullscreen();
            } else if (!ctx.embedded && ctx.onBack) {
              ctx.onBack();
            }
          }
          break;
        default: {
          if (!ctx.session.isLive && /^[0-9]$/.test(e.key)) {
            const effectiveDuration = ctx.session.getEffectiveDuration();
            if (effectiveDuration > 0) {
              e.preventDefault();
              const pct = parseInt(e.key, 10) * 0.1;
              ctx.session.seek(effectiveDuration * pct);
            }
          }
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [playerId]);

  const handleTogglePlayGuarded = useCallback(() => {
    if (isEnteringFullscreenRef.current || isExitingFullscreenRef.current) {
      resetInactivityTimer();
      return;
    }
    session.togglePlay();
  }, [session, resetInactivityTimer]);

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

    if (isEnteringFullscreenRef.current || isExitingFullscreenRef.current) {
      resetInactivityTimer();
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

  const isCompactPreview = !isPlayerInFullLayer;

  const playerContent = (
    <motion.div
      ref={containerRef}
      data-player-container="true"
      data-player-presentation={isCompactPreview ? 'compact-preview' : 'full-layer'}
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
        isCompactPreview
          ? 'relative w-full aspect-video rounded-2xl overflow-hidden bg-black border border-nc-border/40 shadow-2xl select-none group'
          : 'fixed inset-0 z-[100] w-full h-full bg-black flex flex-col items-center justify-center select-none overflow-hidden'
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
        embedded={isCompactPreview}
        disableRemoteFocus={Boolean(
          embedded && disableEmbeddedControlsFocus && !isPlayerInFullLayer
        )}
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
        isFullscreen={isFullscreen || isVisuallyExpanded || isEnteringFullscreen}
        isAtLiveEdge={session.isAtLiveEdge}
        liveEdgeDistance={session.liveEdgeDistance}
        hasActiveSubtitles={session.currentSubtitleTrack !== -1}
        playbackRate={session.playbackRate}
        onTogglePlay={handleTogglePlayGuarded}
        onSeek={session.seek}
        onSeekBy={session.seekBy}
        onSeekToLive={session.seekToLive}
        onVolumeChange={session.setVolume}
        onToggleMute={session.toggleMute}
        onToggleFullscreen={toggleFullscreen}
        onTogglePiP={togglePiP}
        onOpenSettings={() => {
          settingsOriginControlRef.current = 'settings';
          setShowDiagnostics(false);
          if (showSettings && settingsInitialSubMenu === 'main') {
            closeSettingsMenu();
          } else {
            setSettingsInitialSubMenu('main');
            setShowSettings(true);
            resetInactivityTimer();
          }
        }}
        onOpenAudioSubtitles={() => {
          settingsOriginControlRef.current = 'audio-subtitles';
          setShowDiagnostics(false);
          if (
            showSettings &&
            (settingsInitialSubMenu === 'subtitles' || settingsInitialSubMenu === 'audio')
          ) {
            closeSettingsMenu();
          } else {
            setSettingsInitialSubMenu('subtitles');
            setShowSettings(true);
            resetInactivityTimer();
          }
        }}
        onOpenSpeed={() => {
          settingsOriginControlRef.current = 'speed';
          setShowDiagnostics(false);
          if (showSettings && settingsInitialSubMenu === 'speed') {
            closeSettingsMenu();
          } else {
            setSettingsInitialSubMenu('speed');
            setShowSettings(true);
            resetInactivityTimer();
          }
        }}
        onOpenDiagnostics={() => {
          setShowSettings(false);
          setShowDiagnostics((p) => !p);
          resetInactivityTimer();
        }}
        onBack={onBack || (embedded && isPlayerInFullLayer) ? handleBack : undefined}
        onNext={onNext}
        onPrevious={onPrevious}
        onUserInteraction={resetInactivityTimer}
        hasPiP={hasPiP}
      />

      {/* Settings Menu Overlay */}
      <PlayerSettingsMenu
        isOpen={showSettings}
        initialSubMenu={settingsInitialSubMenu}
        onClose={closeSettingsMenu}
        onOpenDiagnostics={() => {
          setShowSettings(false);
          setShowDiagnostics(true);
          resetInactivityTimer();
        }}
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
          data-player-error-overlay="true"
          className={`absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md text-center pointer-events-auto overflow-y-auto ${
            isCompactPreview ? 'p-2.5 sm:p-3.5' : 'p-6'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className={`rounded-full bg-red-500/20 flex items-center justify-center shrink-0 ${
              isCompactPreview ? 'w-8 h-8 mb-1.5' : 'w-14 h-14 mb-4'
            }`}
          >
            <AlertCircle
              className={isCompactPreview ? 'w-4 h-4 text-red-500' : 'w-7 h-7 text-red-500'}
            />
          </div>
          <h3
            className={`font-bold text-white ${
              isCompactPreview ? 'text-xs sm:text-sm mb-1' : 'text-lg mb-2'
            }`}
          >
            Erro de Reprodução Direta
          </h3>
          <p
            className={`text-red-400 max-w-lg leading-snug ${
              isCompactPreview
                ? 'text-[11px] sm:text-xs line-clamp-2 mb-2'
                : 'text-sm leading-relaxed mb-6'
            }`}
          >
            {activeError}
          </p>

          <div
            data-nav-row="player-error"
            className={`flex flex-wrap justify-center ${
              isCompactPreview ? 'gap-1.5 sm:gap-2' : 'gap-3'
            }`}
          >
            <button
              type="button"
              data-player-error-primary="true"
              onClick={handleRetry}
              className={`bg-nc-primary text-black font-semibold rounded-xl transition-all hover:brightness-110 flex items-center gap-1.5 cursor-pointer ${
                isCompactPreview ? 'px-3 py-1.5 text-xs' : 'px-5 py-2.5 text-sm gap-2'
              }`}
            >
              <RefreshCw className={isCompactPreview ? 'w-3.5 h-3.5' : 'w-4 h-4'} /> Tentar Novamente
            </button>
            <button
              type="button"
              data-player-error-diagnostics="true"
              onClick={() => {
                setShowDiagnostics(true);
                resetInactivityTimer();
              }}
              className={`bg-white/10 hover:bg-white/20 text-white font-medium rounded-xl transition-colors border border-nc-border/40 flex items-center gap-1.5 cursor-pointer ${
                isCompactPreview ? 'px-2.5 py-1.5 text-xs' : 'px-5 py-2.5 text-sm gap-2'
              }`}
            >
              <Wrench className={isCompactPreview ? 'w-3.5 h-3.5 text-nc-primary' : 'w-4 h-4 text-nc-primary'} /> Diagnóstico
            </button>
            {(onBack || (embedded && isPlayerInFullLayer)) && !isCompactPreview && (
              <button
                type="button"
                onClick={handleBack}
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
  })
);
