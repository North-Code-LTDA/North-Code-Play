import React, { useState, useEffect, useRef, useCallback } from 'react';
import Hls from 'hls.js';
import {
  PlayerContentType,
  PlayerTransport,
  BufferProfileKey,
  QualityLevel,
  MediaTrackInfo,
  BufferedTimeRange,
  PlaybackStats,
} from './types';
import { BUFFER_PROFILES } from './profiles';

interface UsePlaybackSessionOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  streamUrl: string;
  contentType?: PlayerContentType;
  startAt?: number;
  streamId?: string | number;
  onRetry?: () => void;
  retryTrigger?: number;
}

export function usePlaybackSession({
  videoRef,
  streamUrl,
  contentType: explicitContentType,
  startAt = 0,
  streamId,
  retryTrigger = 0,
}: UsePlaybackSessionOptions) {
  // Session tracking to discard stale callbacks
  const sessionIdRef = useRef(0);
  const hlsRef = useRef<Hls | null>(null);
  const recoveryTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Buffer profile state
  const [bufferProfile, setBufferProfileState] = useState<BufferProfileKey>(() => {
    try {
      const saved = localStorage.getItem('nc_player_profile');
      if (saved && (saved === 'balanced' || saved === 'stability' || saved === 'lowLatency')) {
        return saved as BufferProfileKey;
      }
    } catch {}
    return 'balanced';
  });
  const bufferProfileRef = useRef<BufferProfileKey>(bufferProfile);
  bufferProfileRef.current = bufferProfile;

  // Media state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedRanges, setBufferedRanges] = useState<BufferedTimeRange[]>([]);
  const [bufferedAhead, setBufferedAhead] = useState(0);

  const [volume, setVolumeState] = useState(() => {
    try {
      const saved = localStorage.getItem('nc_player_volume');
      return saved !== null ? Number(saved) : 1;
    } catch {
      return 1;
    }
  });
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [error, setError] = useState<string | null>(null);

  // Store refs for initial session setup without re-triggering main effect
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;
  const playbackRateRef = useRef(playbackRate);
  playbackRateRef.current = playbackRate;

  // Quality, Audio, Subtitles
  const [qualities, setQualities] = useState<QualityLevel[]>([]);
  const [currentQuality, setCurrentQuality] = useState<number>(-1); // -1 = Auto
  const [audioTracks, setAudioTracks] = useState<MediaTrackInfo[]>([]);
  const [currentAudioTrack, setCurrentAudioTrack] = useState<number>(-1);
  const [subtitleTracks, setSubtitleTracks] = useState<MediaTrackInfo[]>([]);
  const [currentSubtitleTrack, setCurrentSubtitleTrack] = useState<number>(-1); // -1 = Off

  // Live stream specifics & stats tracking refs to prevent stale closure
  const [liveSyncPosition, setLiveSyncPosition] = useState<number | null>(null);
  const [liveEdgeDistance, setLiveEdgeDistance] = useState<number>(0);
  const [rebufferingCount, setRebufferingCount] = useState(0);
  const rebufferingCountRef = useRef(0);
  rebufferingCountRef.current = rebufferingCount;

  const liveEdgeDistanceRef = useRef(0);
  liveEdgeDistanceRef.current = liveEdgeDistance;

  const [stats, setStats] = useState<PlaybackStats>({ rebufferingCount: 0 });

  // Infer content type if not explicit
  const inferredContentType: PlayerContentType = (() => {
    if (explicitContentType) return explicitContentType;
    const lower = (streamUrl || '').toLowerCase();
    if (lower.includes('/live/')) return 'live';
    if (lower.includes('/series/')) return 'episode';
    if (lower.includes('/movie/')) return 'movie';
    if (lower.endsWith('.m3u8')) return 'live';
    return 'movie';
  })();

  const isLive = inferredContentType === 'live';

  // Infer transport (HLS vs progressive file)
  const inferredTransport: PlayerTransport = (() => {
    if (!streamUrl) return 'unknown';
    try {
      const parsed = new URL(streamUrl);
      const path = parsed.pathname.toLowerCase();
      const search = parsed.search.toLowerCase();
      if (
        path.endsWith('.m3u8') ||
        search.includes('.m3u8') ||
        search.includes('output=m3u8') ||
        search.includes('format=m3u8')
      ) {
        return 'hls';
      }
      if (
        path.endsWith('.ts') ||
        search.includes('.ts') ||
        search.includes('output=ts') ||
        search.includes('format=ts')
      ) {
        return 'progressive';
      }
      if (
        path.endsWith('.mp4') ||
        path.endsWith('.m4v') ||
        path.endsWith('.webm') ||
        path.endsWith('.mkv') ||
        path.endsWith('.avi')
      ) {
        return 'progressive';
      }
    } catch {
      // ignore
    }
    const lower = streamUrl.toLowerCase();
    if (lower.includes('.m3u8')) return 'hls';
    if (lower.endsWith('.ts') || lower.includes('.ts?') || lower.includes('/ts')) return 'progressive';
    if (isLive && !lower.includes('.ts')) return 'hls';
    return 'progressive';
  })();

  // Update volume & mute directly on HTMLVideoElement without interrupting session
  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.volume = volume;
      video.muted = isMuted;
    }
  }, [videoRef, volume, isMuted]);

  // Update playbackRate directly on HTMLVideoElement without interrupting session
  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.playbackRate = playbackRate;
    }
  }, [videoRef, playbackRate]);

  // Thorough cleanup of video pipeline and HLS instance
  const cleanup = useCallback(() => {
    recoveryTimersRef.current.forEach((t) => clearTimeout(t));
    recoveryTimersRef.current = [];

    if (hlsRef.current) {
      try {
        hlsRef.current.stopLoad();
        hlsRef.current.detachMedia();
        hlsRef.current.destroy();
      } catch {
        // ignore
      }
      hlsRef.current = null;
    }

    const video = videoRef.current;
    if (video) {
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch {
        // ignore
      }
    }
  }, [videoRef]);

  // Helper to extract active buffer ranges & ahead time directly from HTMLMediaElement
  const calculateBufferStats = useCallback((video: HTMLVideoElement) => {
    const ranges: BufferedTimeRange[] = [];
    let ahead = 0;
    const cur = video.currentTime;
    if (video.buffered && video.buffered.length > 0) {
      for (let i = 0; i < video.buffered.length; i++) {
        const start = video.buffered.start(i);
        const end = video.buffered.end(i);
        ranges.push({ start, end });
        if (cur >= start && cur <= end) {
          ahead = Math.max(0, end - cur);
        }
      }
    }
    return { ranges, ahead };
  }, []);

  // Main playback attachment effect (runs ONLY on streamUrl, retryTrigger, or structural media changes)
  useEffect(() => {
    const video = videoRef.current;
    
    // Immediate state & metrics reset helper
    const resetSessionMetrics = () => {
      setIsLoading(false);
      setIsPlaying(false);
      setIsBuffering(false);
      setError(null);
      setCurrentTime(0);
      setDuration(0);
      setBufferedAhead(0);
      setBufferedRanges([]);
      setQualities([]);
      setAudioTracks([]);
      setSubtitleTracks([]);
      setCurrentQuality(-1);
      setRebufferingCount(0);
      rebufferingCountRef.current = 0;
      setLiveSyncPosition(null);
      setLiveEdgeDistance(0);
      liveEdgeDistanceRef.current = 0;
      setStats({
        width: 0,
        height: 0,
        duration: 0,
        currentTime: 0,
        bufferedAhead: 0,
        bufferedRanges: [],
        rebufferingCount: 0,
        liveLatency: undefined,
        engineLabel: undefined,
      });
    };

    if (!video || !streamUrl) {
      cleanup();
      resetSessionMetrics();
      return;
    }

    const currentSessionId = ++sessionIdRef.current;
    cleanup();
    resetSessionMetrics();
    setIsLoading(true);

    // Initial video element setup using current ref values
    video.volume = volumeRef.current;
    video.muted = isMutedRef.current;
    video.playbackRate = playbackRateRef.current;

    let mediaRecoveryAttempts = 0;
    let networkRecoveryAttempts = 0;
    let seekApplied = false;

    // Helper to apply startAt seek once metadata is available
    const applyStartAt = () => {
      if (!seekApplied && startAt > 0 && !isLive) {
        seekApplied = true;
        try {
          video.currentTime = startAt;
        } catch {
          // ignore
        }
      }
    };

    // Named video element event listeners for clean disposal
    const handlePlaying = () => {
      if (sessionIdRef.current !== currentSessionId) return;
      setIsPlaying(true);
      setIsLoading(false);
      setIsBuffering(false);
    };

    const handlePlay = () => {
      if (sessionIdRef.current !== currentSessionId) return;
      setIsPlaying(true);
    };

    const handlePause = () => {
      if (sessionIdRef.current !== currentSessionId) return;
      setIsPlaying(false);
      // Save progress on pause for VOD/series
      if (!isLive && streamId && video.currentTime > 5) {
        try {
          localStorage.setItem(`nc_progress_${streamId}`, String(Math.floor(video.currentTime)));
        } catch {}
      }
    };

    const handleWaiting = () => {
      if (sessionIdRef.current !== currentSessionId) return;
      setIsBuffering(true);
      setRebufferingCount((prev) => {
        const next = prev + 1;
        rebufferingCountRef.current = next;
        return next;
      });
    };

    const handleTimeUpdate = () => {
      if (sessionIdRef.current !== currentSessionId) return;
      const cur = video.currentTime;
      setCurrentTime(cur);

      // Save progress every ~5 seconds for VOD/series
      if (!isLive && streamId && cur > 5 && Math.floor(cur) % 5 === 0) {
        try {
          localStorage.setItem(`nc_progress_${streamId}`, String(Math.floor(cur)));
        } catch {}
      }

      // Update buffered stats dynamically
      const { ranges, ahead } = calculateBufferStats(video);
      setBufferedRanges(ranges);
      setBufferedAhead(ahead);

      // Live latency calculation
      if (isLive && hlsRef.current) {
        const syncPos = hlsRef.current.liveSyncPosition;
        if (syncPos !== null && syncPos !== undefined && syncPos > 0) {
          setLiveSyncPosition(syncPos);
          const dist = Math.max(0, syncPos - cur);
          setLiveEdgeDistance(dist);
          liveEdgeDistanceRef.current = dist;
        }
      }
    };

    const handleDurationChange = () => {
      if (sessionIdRef.current !== currentSessionId) return;
      const dur = video.duration;
      if (isFinite(dur) && !isNaN(dur)) {
        setDuration(dur);
      } else {
        setDuration(0);
      }
    };

    const handleLoadedMetadata = () => {
      if (sessionIdRef.current !== currentSessionId) return;
      setIsLoading(false);
      handleDurationChange();
      applyStartAt();
      video.play().catch(() => {
        if (sessionIdRef.current === currentSessionId) {
          setIsPlaying(false);
        }
      });
    };

    const handleProgress = () => {
      if (sessionIdRef.current !== currentSessionId) return;
      const { ranges, ahead } = calculateBufferStats(video);
      setBufferedRanges(ranges);
      setBufferedAhead(ahead);
    };

    const handleVolumeChange = () => {
      if (sessionIdRef.current !== currentSessionId) return;
      setVolumeState(video.volume);
      setIsMuted(video.muted);
      try {
        localStorage.setItem('nc_player_volume', String(video.volume));
      } catch {}
    };

    const handleRateChange = () => {
      if (sessionIdRef.current !== currentSessionId) return;
      setPlaybackRateState(video.playbackRate);
    };

    const handleError = () => {
      if (sessionIdRef.current !== currentSessionId) return;
      const mediaErr = video.error;
      let msg = 'Falha ao reproduzir mídia diretamente do provedor.';
      if (mediaErr) {
        if (mediaErr.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
          msg =
            'Formato não suportado nativamente pelo navegador ou bloqueio de CORS / Mixed Content pelo provedor.';
        } else if (mediaErr.code === MediaError.MEDIA_ERR_NETWORK) {
          msg = 'Erro de rede ao conectar à transmissão do provedor.';
        } else if (mediaErr.code === MediaError.MEDIA_ERR_DECODE) {
          msg = 'Erro na decodificação do fluxo de vídeo.';
        }
      }
      setError(msg);
      setIsLoading(false);
      setIsBuffering(false);
    };

    // Attach listeners to video element
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('durationchange', handleDurationChange);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('progress', handleProgress);
    video.addEventListener('volumechange', handleVolumeChange);
    video.addEventListener('ratechange', handleRateChange);
    video.addEventListener('error', handleError);

    // Engine attachment: HLS.js vs Native
    if (inferredTransport === 'hls' && Hls.isSupported()) {
      const profileCfg = BUFFER_PROFILES[bufferProfileRef.current];
      const hls = new Hls({
        ...profileCfg.hlsOptions,
        xhrSetup: (xhr) => {
          xhr.withCredentials = false;
        },
      });
      hlsRef.current = hls;

      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        if (sessionIdRef.current !== currentSessionId) return;
        setIsLoading(false);
        setError(null);

        // Map real HLS quality levels
        if (data.levels && data.levels.length > 0) {
          const mappedQualities: QualityLevel[] = data.levels.map((lvl, idx) => ({
            id: idx,
            height: lvl.height,
            width: lvl.width,
            bitrate: lvl.bitrate,
            name: lvl.height
              ? `${lvl.height}p (${Math.round(lvl.bitrate / 1000)} kbps)`
              : `Nível ${idx + 1}`,
          }));
          setQualities(mappedQualities);
        }

        // Map real audio tracks
        if (hls.audioTracks && hls.audioTracks.length > 0) {
          setAudioTracks(
            hls.audioTracks.map((tr) => ({
              id: tr.id,
              name: tr.name || tr.lang || `Faixa ${tr.id + 1}`,
              lang: tr.lang,
            }))
          );
          setCurrentAudioTrack(hls.audioTrack);
        }

        // Map subtitle tracks
        if (hls.subtitleTracks && hls.subtitleTracks.length > 0) {
          setSubtitleTracks(
            hls.subtitleTracks.map((tr) => ({
              id: tr.id,
              name: tr.name || tr.lang || `Legenda ${tr.id + 1}`,
              lang: tr.lang,
            }))
          );
          setCurrentSubtitleTrack(hls.subtitleTrack);
        }

        applyStartAt();
        video.play().catch(() => {
          if (sessionIdRef.current === currentSessionId) {
            setIsPlaying(false);
          }
        });
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        if (sessionIdRef.current !== currentSessionId) return;
        if (hls.autoLevelEnabled) {
          setCurrentQuality(-1);
        } else {
          setCurrentQuality(data.level);
        }
      });

      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_event, data) => {
        if (sessionIdRef.current !== currentSessionId) return;
        setCurrentAudioTrack(data.id);
      });

      hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_event, data) => {
        if (sessionIdRef.current !== currentSessionId) return;
        setCurrentSubtitleTrack(data.id);
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (sessionIdRef.current !== currentSessionId) return;
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              if (networkRecoveryAttempts < 3) {
                networkRecoveryAttempts++;
                const delayMs = networkRecoveryAttempts * 1000;
                const timer = setTimeout(() => {
                  if (sessionIdRef.current === currentSessionId && hlsRef.current) {
                    hlsRef.current.startLoad();
                  }
                }, delayMs);
                recoveryTimersRef.current.push(timer);
              } else {
                setError(
                  'Falha de rede ou CORS ao carregar manifesto HLS diretamente do provedor. ' +
                    'Verifique se o servidor do provedor permite requisições da web.'
                );
                setIsLoading(false);
                setIsBuffering(false);
                hls.destroy();
                hlsRef.current = null;
              }
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              if (mediaRecoveryAttempts < 2) {
                mediaRecoveryAttempts++;
                hls.recoverMediaError();
              } else {
                setError('Erro fatal irrecuperável na decodificação de mídia HLS.');
                setIsLoading(false);
                setIsBuffering(false);
                hls.destroy();
                hlsRef.current = null;
              }
              break;
            default:
              setError('Erro fatal irrecuperável no fluxo HLS.');
              setIsLoading(false);
              setIsBuffering(false);
              hls.destroy();
              hlsRef.current = null;
              break;
          }
        }
      });
    } else {
      // Native progressive playback (or Safari native HLS)
      video.src = streamUrl;
      video.load();
    }

    // Interval to poll stats periodically using fresh video element readings
    const statsTimer = setInterval(() => {
      if (sessionIdRef.current !== currentSessionId) return;
      if (video) {
        const { ranges, ahead } = calculateBufferStats(video);
        const hasLiveLatency = isLive && hlsRef.current && hlsRef.current.liveSyncPosition !== null;
        setStats({
          width: video.videoWidth,
          height: video.videoHeight,
          duration: video.duration || 0,
          currentTime: video.currentTime || 0,
          bufferedAhead: ahead,
          bufferedRanges: ranges,
          networkState: video.networkState,
          readyState: video.readyState,
          rebufferingCount: rebufferingCountRef.current,
          liveLatency: hasLiveLatency ? liveEdgeDistanceRef.current : undefined,
          engineLabel: hlsRef.current
            ? 'HLS (Hls.js / MediaSource)'
            : inferredTransport === 'hls'
            ? 'HLS Nativo (Safari / HTML5 Video)'
            : 'Progressivo Nativo (HTML5 Video)',
        });
      }
    }, 1000);

    return () => {
      clearInterval(statsTimer);

      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('durationchange', handleDurationChange);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('progress', handleProgress);
      video.removeEventListener('volumechange', handleVolumeChange);
      video.removeEventListener('ratechange', handleRateChange);
      video.removeEventListener('error', handleError);

      // Save progress on exit if VOD/series
      if (!isLive && streamId && video.currentTime > 5) {
        try {
          localStorage.setItem(`nc_progress_${streamId}`, String(Math.floor(video.currentTime)));
        } catch {}
      }

      cleanup();
    };
  }, [streamUrl, retryTrigger, cleanup, isLive, streamId, startAt, inferredTransport, calculateBufferStats]);

  // Actions
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused || video.ended) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [videoRef]);

  const seek = useCallback(
    (time: number) => {
      const video = videoRef.current;
      if (!video) return;
      const target = Math.max(0, Math.min(time, duration || Infinity));
      video.currentTime = target;
      setCurrentTime(target);
    },
    [videoRef, duration]
  );

  const seekBy = useCallback(
    (delta: number) => {
      const video = videoRef.current;
      if (!video) return;
      const target = Math.max(0, Math.min(video.currentTime + delta, duration || Infinity));
      video.currentTime = target;
      setCurrentTime(target);
    },
    [videoRef, duration]
  );

  const seekToLive = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (hlsRef.current && hlsRef.current.liveSyncPosition) {
      video.currentTime = hlsRef.current.liveSyncPosition;
    } else if (duration > 0 && isFinite(duration)) {
      video.currentTime = Math.max(0, duration - 2);
    }
  }, [videoRef, duration]);

  const setVolume = useCallback(
    (newVol: number) => {
      const video = videoRef.current;
      const clamped = Math.max(0, Math.min(newVol, 1));
      if (video) {
        video.volume = clamped;
        if (clamped > 0 && video.muted) {
          video.muted = false;
        }
      }
      setVolumeState(clamped);
      try {
        localStorage.setItem('nc_player_volume', String(clamped));
      } catch {}
    },
    [videoRef]
  );

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      video.muted = !video.muted;
      setIsMuted(video.muted);
    } else {
      setIsMuted((prev) => !prev);
    }
  }, [videoRef]);

  const setPlaybackRate = useCallback(
    (rate: number) => {
      const video = videoRef.current;
      if (video) {
        video.playbackRate = rate;
      }
      setPlaybackRateState(rate);
    },
    [videoRef]
  );

  const setQuality = useCallback((qualityId: number) => {
    if (hlsRef.current) {
      if (qualityId === -1) {
        hlsRef.current.currentLevel = -1; // Auto
      } else {
        hlsRef.current.currentLevel = qualityId;
      }
      setCurrentQuality(qualityId);
    }
  }, []);

  const setAudioTrack = useCallback((trackId: number) => {
    if (hlsRef.current) {
      hlsRef.current.audioTrack = trackId;
      setCurrentAudioTrack(trackId);
    }
  }, []);

  const setSubtitleTrack = useCallback((trackId: number) => {
    if (hlsRef.current) {
      hlsRef.current.subtitleTrack = trackId;
      setCurrentSubtitleTrack(trackId);
    }
  }, []);

  const setProfile = useCallback((profileKey: BufferProfileKey) => {
    setBufferProfileState(profileKey);
    bufferProfileRef.current = profileKey;
    try {
      localStorage.setItem('nc_player_profile', profileKey);
    } catch {}
    const cfg = BUFFER_PROFILES[profileKey];
    if (hlsRef.current) {
      Object.assign(hlsRef.current.config, cfg.hlsOptions);
    }
  }, []);

  return {
    isPlaying,
    isLoading,
    isBuffering,
    currentTime,
    duration,
    bufferedRanges,
    bufferedAhead,
    volume,
    isMuted,
    playbackRate,
    error,
    isLive,
    inferredTransport,
    liveSyncPosition,
    liveEdgeDistance,
    isAtLiveEdge: isLive ? liveEdgeDistance <= 6 : true,
    qualities,
    currentQuality,
    audioTracks,
    currentAudioTrack,
    subtitleTracks,
    currentSubtitleTrack,
    bufferProfile,
    stats,
    togglePlay,
    seek,
    seekBy,
    seekToLive,
    setVolume,
    toggleMute,
    setPlaybackRate,
    setQuality,
    setAudioTrack,
    setSubtitleTrack,
    setProfile,
  };
}
