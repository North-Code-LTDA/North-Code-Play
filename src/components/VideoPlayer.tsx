import React, { useEffect, useRef, useState, useCallback, useId, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { AlertCircle, RefreshCw, ArrowLeft } from 'lucide-react';
import { VideoPlayerProps, VideoPlayerHandle } from './player/types';
import { usePlaybackSession } from './player/usePlaybackSession';
import { PlayerControls } from './player/PlayerControls';
import { PlayerSettingsMenu, SubMenuType } from './player/PlayerSettingsMenu';
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
      sourceOrigin,
      sourceMetadata,
      containerExtension,
      mimeType,
      allowedOutputFormats,
      directSource,
      channelName,
      programTitle,
      onBack,
      embedded = false,
      liteLivePreview = false,
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

  // Fullscreen & PiP states
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isVisuallyExpanded, setIsVisuallyExpanded] = useState(false);
  const [isEnteringFullscreen, setIsEnteringFullscreen] = useState(false);
  const [hasPiP, setHasPiP] = useState(false);
  const isMountedRef = useRef(true);
  const embeddedRef = useRef(embedded);
  embeddedRef.current = embedded;
  const isFullscreenRef = useRef(false);
  const isVisuallyExpandedRef = useRef(false);
  const isEnteringFullscreenRef = useRef(false);
  const isExitingFullscreenRef = useRef(false);
  const fullscreenEntryRequestIdRef = useRef(0);
  const fullscreenExitRequestIdRef = useRef(0);
  const pendingFullscreenPromiseRef = useRef<Promise<boolean> | null>(null);
  const pendingFullscreenExitPromiseRef = useRef<Promise<boolean> | null>(null);
  const pendingFullscreenExitResolveRef = useRef<((didExit: boolean) => void) | null>(null);
  const pendingFullscreenExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const suppressLivePreviewVisualMetrics = Boolean(
    liteLivePreview &&
      embedded &&
      contentType === 'live' &&
      !isFullscreen &&
      !isVisuallyExpanded &&
      !isEnteringFullscreen
  );

  // Playback session hook manages HLS.js vs native HTML5, tracks, audio, qualities, buffer
  const session = usePlaybackSession({
    videoRef,
    streamUrl,
    contentType,
    sourceOrigin,
    sourceMetadata,
    containerExtension,
    mimeType,
    allowedOutputFormats,
    directSource,
    startAt,
    streamId,
    credentials,
    onRetry,
    retryTrigger: combinedRetryTrigger,
    onPlaybackSuccess,
    onPlaybackFinalError,
    isControlsVisible:
      isControlsVisible || !hasStartedPlaying || showSettings,
    suppressLivePreviewVisualMetrics,
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
  }, [streamUrl, combinedRetryTrigger]);

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

  const syncFullscreenState = useCallback((next: boolean) => {
    isFullscreenRef.current = next;
    if (isMountedRef.current) {
      setIsFullscreen(next);
    }
  }, []);

  const syncVisuallyExpandedState = useCallback((next: boolean) => {
    isVisuallyExpandedRef.current = next;
    if (isMountedRef.current) {
      setIsVisuallyExpanded(next);
    }
  }, []);

  const syncEnteringFullscreenState = useCallback((next: boolean) => {
    isEnteringFullscreenRef.current = next;
    if (isMountedRef.current) {
      setIsEnteringFullscreen(next);
    }
  }, []);

  const pendingFocusControlRef = useRef<string | null>(null);

  const settlePendingFullscreenExit = useCallback(
    (didExit: boolean, expectedRequestId?: number): boolean => {
      if (
        expectedRequestId !== undefined &&
        fullscreenExitRequestIdRef.current !== expectedRequestId
      ) {
        return false;
      }
      if (!isExitingFullscreenRef.current && !pendingFullscreenExitResolveRef.current) {
        return false;
      }

      fullscreenExitRequestIdRef.current += 1;
      isExitingFullscreenRef.current = false;

      if (pendingFullscreenExitTimerRef.current) {
        clearTimeout(pendingFullscreenExitTimerRef.current);
        pendingFullscreenExitTimerRef.current = null;
      }

      const resolve = pendingFullscreenExitResolveRef.current;
      pendingFullscreenExitResolveRef.current = null;
      pendingFullscreenExitPromiseRef.current = null;

      if (didExit) {
        pendingFocusControlRef.current = null;
        syncFullscreenState(false);
        syncVisuallyExpandedState(false);
        syncEnteringFullscreenState(false);
      } else {
        syncEnteringFullscreenState(false);
        syncFullscreenState(isContainerCurrentlyFullscreen());
      }

      if (resolve) {
        resolve(didExit);
      }
      return true;
    },
    [
      isContainerCurrentlyFullscreen,
      syncFullscreenState,
      syncVisuallyExpandedState,
      syncEnteringFullscreenState,
    ]
  );

  // Sync fullscreen state with document events (isolated to this player container)
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFs = isContainerCurrentlyFullscreen();

      if (isFs) {
        syncFullscreenState(true);
        pendingFullscreenPromiseRef.current = null;
        syncEnteringFullscreenState(false);
        return;
      }

      if (isExitingFullscreenRef.current) {
        settlePendingFullscreenExit(true);
        return;
      }

      const wasFullscreen = isFullscreenRef.current || isVisuallyExpandedRef.current;
      syncFullscreenState(false);
      if (!isEnteringFullscreenRef.current) {
        pendingFocusControlRef.current = null;
        syncVisuallyExpandedState(false);

        // Native-initiated exit (e.g. Web Escape key) in embedded remote mode restores focus to origin channel
        if (wasFullscreen && embeddedRef.current && getNavMode() === 'remote' && typeof document !== 'undefined') {
          const selectedChannelBtn =
            document.querySelector<HTMLButtonElement>('button[data-live-channel-origin="true"]') ||
            document.querySelector<HTMLButtonElement>('button[data-live-channel-selected="true"]');
          if (selectedChannelBtn && selectedChannelBtn.isConnected) {
            focusElementSafely(selectedChannelBtn);
          }
        }
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
    };
  }, [
    isContainerCurrentlyFullscreen,
    settlePendingFullscreenExit,
    syncFullscreenState,
    syncVisuallyExpandedState,
    syncEnteringFullscreenState,
  ]);
  const wasInFullLayerRef = useRef(false);
  const openOverlayRef = useRef({
    showSettings: false,
    hasError: false,
    isLoading: false,
  });
  openOverlayRef.current = {
    showSettings,
    hasError: Boolean(activeError),
    isLoading: isCurrentlyLoading,
  };

  const isLiveContent = contentType === 'live';
  const isLiveContentRef = useRef(isLiveContent);
  isLiveContentRef.current = isLiveContent;

  const focusPlayerControl = useCallback((controlName: string) => {
    const root = containerRef.current;
    if (!root) return false;
    const liveMode = isLiveContentRef.current;
    const resolvedControlName =
      liveMode && controlName === 'play-pause' ? 'back' : controlName;
    const target =
      root.querySelector<HTMLElement>(`[data-player-control="${resolvedControlName}"]`) ||
      (liveMode
        ? root.querySelector<HTMLElement>('[data-player-control="back"]') ||
          root.querySelector<HTMLElement>('[data-player-control="settings"]')
        : root.querySelector<HTMLElement>('[data-player-control="play-pause"]') ||
          root.querySelector<HTMLElement>('[data-player-control="back"]'));
    if (target) {
      focusElementSafely(target);
      return true;
    }
    return false;
  }, []);

  // Inactivity timer: hide control bars after inactivity while playing (unless settings/error are open)
  const scheduleAutoHide = useCallback(() => {
    if (idleTimeoutRef.current) {
      clearTimeout(idleTimeoutRef.current);
      idleTimeoutRef.current = null;
    }

    const canAutoHide =
      (session.isPlaying || (hasStartedPlaying && session.isBuffering)) &&
      !showSettings &&
      !activeError;

    if (canAutoHide) {
      const delayMs = getNavMode() === 'remote' ? 4500 : 3000;
      idleTimeoutRef.current = setTimeout(() => {
        if (
          openOverlayRef.current.showSettings ||
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

  // Direct fullscreen exit invoked synchronously first (mirrors requestFullscreenImmediate)
  const performFullscreenExit = useCallback((): Promise<boolean> => {
    if (isExitingFullscreenRef.current) {
      return pendingFullscreenExitPromiseRef.current ?? Promise.resolve(false);
    }

    const isCurrentContainerFs = isContainerCurrentlyFullscreen();
    const hadPendingEntry = isEnteringFullscreenRef.current || isEnteringFullscreen;
    const isFs =
      isCurrentContainerFs ||
      isFullscreenRef.current ||
      isFullscreen ||
      isVisuallyExpandedRef.current ||
      isVisuallyExpanded ||
      hadPendingEntry;

    if (!isFs) {
      return Promise.resolve(false);
    }

    fullscreenEntryRequestIdRef.current += 1;
    isEnteringFullscreenRef.current = false;
    pendingFullscreenPromiseRef.current = null;

    // Fast synchronous exit when no native fullscreen element is active (e.g. CSS visual expansion fallback)
    if (!isCurrentContainerFs) {
      pendingFocusControlRef.current = null;
      syncFullscreenState(false);
      syncVisuallyExpandedState(false);
      syncEnteringFullscreenState(false);
      return Promise.resolve(true);
    }

    const requestId = ++fullscreenExitRequestIdRef.current;
    isExitingFullscreenRef.current = true;

    let nativePromise: Promise<void> | null = null;
    let usedNativeCall = false;
    let syncThrew = false;

    // Invoke native fullscreen exit synchronously BEFORE scheduling any React state updates
    if (typeof document !== 'undefined') {
      try {
        if (typeof document.exitFullscreen === 'function') {
          usedNativeCall = true;
          const res = document.exitFullscreen();
          if (res && typeof (res as Promise<void>).then === 'function') {
            nativePromise = res as Promise<void>;
          }
        } else if (typeof (document as any).webkitExitFullscreen === 'function') {
          usedNativeCall = true;
          const res = (document as any).webkitExitFullscreen();
          if (res && typeof (res as Promise<void>).then === 'function') {
            nativePromise = res as Promise<void>;
          }
        } else if (typeof (document as any).mozCancelFullScreen === 'function') {
          usedNativeCall = true;
          const res = (document as any).mozCancelFullScreen();
          if (res && typeof (res as Promise<void>).then === 'function') {
            nativePromise = res as Promise<void>;
          }
        } else if (typeof (document as any).msExitFullscreen === 'function') {
          usedNativeCall = true;
          const res = (document as any).msExitFullscreen();
          if (res && typeof (res as Promise<void>).then === 'function') {
            nativePromise = res as Promise<void>;
          }
        }
      } catch (err) {
        console.warn('Exit fullscreen failed:', err);
        syncThrew = true;
      }
    }

    // If native fullscreen already exited synchronously during the call, complete immediately
    if (!isContainerCurrentlyFullscreen()) {
      if (nativePromise) {
        nativePromise.catch(() => {});
      }
      isExitingFullscreenRef.current = false;
      pendingFocusControlRef.current = null;
      syncFullscreenState(false);
      syncVisuallyExpandedState(false);
      syncEnteringFullscreenState(false);
      return Promise.resolve(true);
    }

    if (!usedNativeCall || syncThrew) {
      isExitingFullscreenRef.current = false;
      syncEnteringFullscreenState(false);
      syncFullscreenState(true);
      return Promise.resolve(false);
    }

    // Coordinate completion on whichever arrives first: native fullscreenchange OR exitFullscreen Promise settlement
    const completionPromise = new Promise<boolean>((resolve) => {
      pendingFullscreenExitResolveRef.current = resolve;
    });
    pendingFullscreenExitPromiseRef.current = completionPromise;

    if (nativePromise) {
      nativePromise
        .then(() => {
          settlePendingFullscreenExit(!isContainerCurrentlyFullscreen(), requestId);
        })
        .catch((err) => {
          console.warn('Exit fullscreen failed:', err);
          settlePendingFullscreenExit(!isContainerCurrentlyFullscreen(), requestId);
        });
    } else {
      // Legacy void vendor APIs signal completion via fullscreenchange; guard against missing event without faking exit
      pendingFullscreenExitTimerRef.current = setTimeout(() => {
        settlePendingFullscreenExit(!isContainerCurrentlyFullscreen(), requestId);
      }, 1500);
    }

    return completionPromise;
  }, [
    isContainerCurrentlyFullscreen,
    isFullscreen,
    isVisuallyExpanded,
    isEnteringFullscreen,
    settlePendingFullscreenExit,
    syncFullscreenState,
    syncVisuallyExpandedState,
    syncEnteringFullscreenState,
  ]);

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
    if (
      isCurrentContainerFs ||
      isFullscreenRef.current ||
      isFullscreen ||
      isVisuallyExpandedRef.current ||
      isVisuallyExpanded
    ) {
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
      pendingFullscreenPromiseRef.current = null;
      syncEnteringFullscreenState(false);
      syncVisuallyExpandedState(true);
      if (isMountedRef.current) {
        setIsControlsVisible(true);
      }
      return Promise.resolve(true);
    }

    if (!nativePromise) {
      pendingFullscreenPromiseRef.current = null;
      syncEnteringFullscreenState(false);
      if (isContainerCurrentlyFullscreen()) {
        syncFullscreenState(true);
      } else {
        syncVisuallyExpandedState(true);
      }
      if (isMountedRef.current) {
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
        pendingFullscreenPromiseRef.current = null;
        syncEnteringFullscreenState(false);
        syncFullscreenState(true);
        if (isMountedRef.current) {
          if (
            getNavMode() === 'remote' &&
            containerRef.current &&
            typeof document !== 'undefined' &&
            (!document.activeElement || !containerRef.current.contains(document.activeElement)) &&
            !openOverlayRef.current.showSettings
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
        pendingFullscreenPromiseRef.current = null;
        syncEnteringFullscreenState(false);
        syncVisuallyExpandedState(true);
        if (isMountedRef.current) {
          if (
            getNavMode() === 'remote' &&
            containerRef.current &&
            typeof document !== 'undefined' &&
            (!document.activeElement || !containerRef.current.contains(document.activeElement)) &&
            !openOverlayRef.current.showSettings
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
    syncFullscreenState,
    syncVisuallyExpandedState,
    syncEnteringFullscreenState,
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
            isExitingFullscreenRef.current ||
            isEnteringFullscreen ||
            isContainerCurrentlyFullscreen() ||
            isFullscreenRef.current ||
            isFullscreen ||
            isVisuallyExpandedRef.current ||
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
      fullscreenEntryRequestIdRef.current += 1;
      fullscreenExitRequestIdRef.current += 1;
      if (pendingFullscreenExitTimerRef.current) {
        clearTimeout(pendingFullscreenExitTimerRef.current);
        pendingFullscreenExitTimerRef.current = null;
      }
      const pendingResolve = pendingFullscreenExitResolveRef.current;
      pendingFullscreenExitResolveRef.current = null;
      pendingFullscreenExitPromiseRef.current = null;
      if (pendingResolve) {
        pendingResolve(false);
      }
      const wasExiting = isExitingFullscreenRef.current;
      isExitingFullscreenRef.current = false;
      if (typeof document !== 'undefined' && !wasExiting) {
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

  // Back action: in embedded mode in fullscreen, first click exits fullscreen back to preview without unmounting video
  const handleBack = useCallback(async () => {
    setActivePlayer(playerId);
    if (showSettings) {
      closeSettingsMenu();
      return;
    }

    if (isExitingFullscreenRef.current) {
      return;
    }

    const isCurrentContainerFs = isContainerCurrentlyFullscreen();
    const isFs =
      isCurrentContainerFs ||
      isFullscreenRef.current ||
      isFullscreen ||
      isVisuallyExpandedRef.current ||
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
    closeSettingsMenu,
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
      return false;
    },
    showSettings
  );

  const isPlayerInFullLayer = Boolean(
    !embedded ||
      isFullscreen ||
      isVisuallyExpanded ||
      isEnteringFullscreen
  );
  // Keep FULLSCREEN_PLAYER handler mounted and gate synchronously via refs so rapid/early Back presses never leak to LiveTvView
  useBackHandler(
    `player-fullscreen-${playerId}`,
    BACK_PRIORITY.FULLSCREEN_PLAYER,
    () => {
      const shouldHandle =
        !embeddedRef.current ||
        openOverlayRef.current.showSettings ||
        isExitingFullscreenRef.current ||
        isEnteringFullscreenRef.current ||
        isContainerCurrentlyFullscreen() ||
        isFullscreenRef.current ||
        isVisuallyExpandedRef.current;
      if (!shouldHandle) {
        return false;
      }
      void handleBack();
      return true;
    },
    true
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
  // - when settings modal is open
  const areBarsVisible =
    isControlsVisible ||
    !hasStartedPlaying ||
    (!session.isPlaying && !isCurrentlyLoading && !session.isBuffering) ||
    showSettings;

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

      if (openOverlayRef.current.showSettings) {
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
    if (showSettings) return;
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
  }, [activeError, isCurrentlyLoading, isPlayerInFullLayer, showSettings]);

  // Apply pending focus request (e.g. after waking hidden controls or closing Settings modal)
  useEffect(() => {
    if (!areBarsVisible || showSettings) return;
    if (!pendingFocusControlRef.current) return;

    const targetControl = pendingFocusControlRef.current;
    pendingFocusControlRef.current = null;

    const timer = setTimeout(() => {
      focusPlayerControl(targetControl);
    }, 0);
    return () => clearTimeout(timer);
  }, [areBarsVisible, showSettings, focusPlayerControl]);

  const zapContextRef = useRef({
    onNext,
    onPrevious,
    resetInactivityTimer,
  });
  zapContextRef.current = {
    onNext,
    onPrevious,
    resetInactivityTimer,
  };
  const lastRepeatZapTimestampRef = useRef(0);

  // Capture-phase listener for Live TV fullscreen D-pad channel zapping (registered BEFORE handleWakeKeyCapture)
  useEffect(() => {
    if (contentType !== 'live' || !embedded || !isPlayerInFullLayer) {
      return;
    }

    const handleLiveFullscreenZapCapture = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      if (isEnteringFullscreenRef.current || isExitingFullscreenRef.current) return;
      if (openOverlayRef.current.showSettings) return;

      const activeEl = document.activeElement as HTMLElement | null;
      if (
        activeEl?.getAttribute?.('data-slider-editing') === 'true' ||
        Boolean(
          containerRef.current?.querySelector(
            '[data-player-control="volume-slider"][data-slider-editing="true"]'
          )
        )
      ) {
        return;
      }

      const { onNext: nextCb, onPrevious: prevCb, resetInactivityTimer: wakeControls } =
        zapContextRef.current;
      if (!nextCb || !prevCb) return;

      e.preventDefault();
      e.stopImmediatePropagation();

      const now = performance.now();
      if (e.repeat && now - lastRepeatZapTimestampRef.current < 350) {
        return;
      }
      lastRepeatZapTimestampRef.current = now;

      wakeControls();
      if (e.key === 'ArrowUp') {
        nextCb();
      } else {
        prevCb();
      }
    };

    window.addEventListener('keydown', handleLiveFullscreenZapCapture, true);
    return () => {
      window.removeEventListener('keydown', handleLiveFullscreenZapCapture, true);
    };
  }, [contentType, embedded, isPlayerInFullLayer]);

  // Capture-phase listener: when full-layer player controls are hidden, first remote/arrow/OK key reveals controls and focuses Play/Pause without firing other actions
  useEffect(() => {
    if (!isPlayerInFullLayer || areBarsVisible || showSettings || activeError) {
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
  }, [isPlayerInFullLayer, areBarsVisible, showSettings, activeError, resetInactivityTimer]);

  const shortcutContextRef = useRef({
    session,
    resetInactivityTimer,
    toggleFullscreen,
    handleBack,
    showSettings,
    closeSettingsMenu,
    isFullscreen,
    isVisuallyExpanded,
    isPlayerInFullLayer,
    isLive: isLiveContent,
    embedded,
    onBack,
  });
  shortcutContextRef.current = {
    session,
    resetInactivityTimer,
    toggleFullscreen,
    handleBack,
    showSettings,
    closeSettingsMenu,
    isFullscreen,
    isVisuallyExpanded,
    isPlayerInFullLayer,
    isLive: isLiveContent,
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
          if (ctx.isLive) {
            break;
          }
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
          if (ctx.isLive) {
            break;
          }
          e.preventDefault();
          ctx.session.seekBy(-10);
          break;
        case 'ArrowRight':
          if (ctx.isLive) {
            break;
          }
          e.preventDefault();
          ctx.session.seekBy(10);
          break;
        case 'ArrowUp':
          if (ctx.isLive && ctx.isPlayerInFullLayer) {
            break;
          }
          e.preventDefault();
          ctx.session.setVolume(ctx.session.volume + 0.1);
          break;
        case 'ArrowDown':
          if (ctx.isLive && ctx.isPlayerInFullLayer) {
            break;
          }
          e.preventDefault();
          ctx.session.setVolume(ctx.session.volume - 0.1);
          break;
        case 'Escape':
          if (!isCentralBackPolicyAttached()) {
            e.preventDefault();
            if (ctx.showSettings) {
              ctx.closeSettingsMenu();
            } else if (
              ctx.embedded &&
              (ctx.isFullscreen ||
                ctx.isVisuallyExpanded ||
                isEnteringFullscreenRef.current ||
                isExitingFullscreenRef.current)
            ) {
              ctx.handleBack();
            } else if (
              ctx.isFullscreen ||
              ctx.isVisuallyExpanded ||
              isEnteringFullscreenRef.current ||
              isExitingFullscreenRef.current
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
    if (isLiveContentRef.current) {
      resetInactivityTimer();
      return;
    }
    if (isEnteringFullscreenRef.current || isExitingFullscreenRef.current) {
      resetInactivityTimer();
      return;
    }
    session.togglePlay();
  }, [session, resetInactivityTimer]);

  const handleContainerClick = () => {
    setActivePlayer(playerId);
    // If settings menu is open, close it
    if (showSettings) {
      closeSettingsMenu();
      return;
    }

    if (isEnteringFullscreenRef.current || isExitingFullscreenRef.current) {
      resetInactivityTimer();
      return;
    }

    // Live TV: clicking video only reveals controls without pausing/resuming
    if (isLiveContent) {
      setIsControlsVisible(true);
      resetInactivityTimer();
      return;
    }

    // VOD: Toggle play/pause or show controls
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
          if (showSettings && settingsInitialSubMenu === 'speed') {
            closeSettingsMenu();
          } else {
            setSettingsInitialSubMenu('speed');
            setShowSettings(true);
            resetInactivityTimer();
          }
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
        isLive={session.isLive}
        qualities={session.qualities}
        currentQuality={session.currentQuality}
        onSelectQuality={session.setQuality}
        audioTracks={session.audioTracks}
        currentAudioTrack={session.currentAudioTrack}
        pendingAudioTrack={session.pendingAudioTrack}
        audioTrackFeedback={session.audioTrackFeedback}
        onSelectAudioTrack={session.setAudioTrack}
        subtitleTracks={session.subtitleTracks}
        currentSubtitleTrack={session.currentSubtitleTrack}
        onSelectSubtitleTrack={session.setSubtitleTrack}
        playbackRate={session.playbackRate}
        onSelectPlaybackRate={session.setPlaybackRate}
        bufferProfile={session.bufferProfile}
        onSelectBufferProfile={session.setProfile}
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
