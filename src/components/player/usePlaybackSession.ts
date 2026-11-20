import React, { useState, useEffect, useRef, useCallback } from 'react';
import Hls from 'hls.js';
import {
  PlayerContentType,
  PlayerTransport,
  BufferProfileKey,
  QualityLevel,
  MediaTrackInfo,
  ExternalSubtitleTrackInput,
  BufferedTimeRange,
} from './types';
import { BUFFER_PROFILES } from './profiles';
import {
  formatMediaTrackLabel,
  disambiguateTrackNames,
  detectSubtitleFormat,
  loadExternalSubtitleAsVttUrl,
} from './trackUtils';
import { recordPlaybackPosition, AccountIdentity, PlaybackType } from '../../utils/playbackHistory';

interface InternalAudioTrackDescriptor extends MediaTrackInfo {
  nativeTrackObj?: any;
}

interface InternalSubtitleTrackDescriptor extends MediaTrackInfo {
  nativeTrackObj?: TextTrack | any;
  trackElement?: HTMLTrackElement | null;
}

interface ResolvedExternalTrackEntry {
  key: string;
  url: string;
  resolvedSrc: string;
  isBlobUrl: boolean;
  lang?: string;
  label?: string;
  format: 'vtt' | 'srt' | 'unknown';
  isDefault?: boolean;
  forced?: boolean;
  trackEl: HTMLTrackElement;
}

interface UsePlaybackSessionOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  streamUrl: string;
  contentType?: PlayerContentType;
  startAt?: number;
  streamId?: string | number;
  credentials?: AccountIdentity | null;
  onRetry?: () => void;
  retryTrigger?: number;
  onPlaybackSuccess?: (attemptId?: number) => void;
  onPlaybackFinalError?: (errorMessage: string, attemptId?: number) => void;
  isControlsVisible?: boolean;
  externalSubtitles?: ExternalSubtitleTrackInput[];
}

export const VOLUME_STORAGE_KEY = 'nc_player_volume';

export function normalizePlayerVolume(raw: unknown, fallback: number = 1): number {
  const safeFallback =
    typeof fallback === 'number' && Number.isFinite(fallback) && fallback >= 0 && fallback <= 1
      ? fallback
      : 1;

  if (raw === null || raw === undefined || typeof raw === 'boolean') {
    return safeFallback;
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return safeFallback;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
      return safeFallback;
    }
    return parsed;
  }

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      return safeFallback;
    }
    return Math.max(0, Math.min(raw, 1));
  }

  return safeFallback;
}

export function usePlaybackSession({
  videoRef,
  streamUrl,
  contentType: explicitContentType,
  startAt = 0,
  streamId,
  credentials,
  retryTrigger = 0,
  onPlaybackSuccess,
  onPlaybackFinalError,
  isControlsVisible = true,
  externalSubtitles,
}: UsePlaybackSessionOptions) {
  const activeAccountRef = useRef<AccountIdentity | null>(credentials || null);

  const onPlaybackSuccessRef = useRef(onPlaybackSuccess);
  onPlaybackSuccessRef.current = onPlaybackSuccess;

  const onPlaybackFinalErrorRef = useRef(onPlaybackFinalError);
  onPlaybackFinalErrorRef.current = onPlaybackFinalError;
  // Session tracking to discard stale callbacks
  const sessionIdRef = useRef(0);
  const hlsRef = useRef<Hls | null>(null);
  const recoveryTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const externalAbortControllerRef = useRef<AbortController | null>(null);
  const createdBlobUrlsRef = useRef<string[]>([]);
  const resolvedExternalTracksRef = useRef<ResolvedExternalTrackEntry[]>([]);
  const audioTracksRef = useRef<InternalAudioTrackDescriptor[]>([]);
  const subtitleTracksRef = useRef<InternalSubtitleTrackDescriptor[]>([]);
  const selectedSubtitleTrackIdRef = useRef<number>(-1);
  const syncSubtitleTracksFnRef = useRef<(() => void) | null>(null);

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

  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);

  const shouldPublishControls =
    isControlsVisible || (!isPlaying && !isLoading && !isBuffering);
  const shouldPublishControlsRef = useRef(shouldPublishControls);
  shouldPublishControlsRef.current = shouldPublishControls;

  const [volume, setVolumeState] = useState(() => {
    try {
      const saved = localStorage.getItem('nc_player_volume');
      return normalizePlayerVolume(saved, 1);
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

  // Live stream specifics & refs to prevent stale closure
  const [liveSyncPosition, setLiveSyncPosition] = useState<number | null>(null);
  const [liveEdgeDistance, setLiveEdgeDistance] = useState<number>(0);
  const liveSyncPositionRef = useRef<number | null>(null);
  const liveEdgeDistanceRef = useRef(0);

  const lastRecordedTimeRef = useRef<number>(0);

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
      video.volume = normalizePlayerVolume(volume, 1);
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

  const clearExternalTracksAndBlobs = useCallback(() => {
    if (externalAbortControllerRef.current) {
      try {
        externalAbortControllerRef.current.abort();
      } catch {}
      externalAbortControllerRef.current = null;
    }

    for (const entry of resolvedExternalTracksRef.current) {
      try {
        if (entry.trackEl && entry.trackEl.track) {
          entry.trackEl.track.mode = 'disabled';
        }
        entry.trackEl?.remove();
      } catch {}
    }
    resolvedExternalTracksRef.current = [];

    const video = videoRef.current;
    if (video) {
      try {
        const lingeringTracks = video.querySelectorAll('track[data-nc-external-track="true"]');
        lingeringTracks.forEach((el) => el.remove());
      } catch {}
    }

    if (createdBlobUrlsRef.current.length > 0) {
      for (const blobUrl of createdBlobUrlsRef.current) {
        try {
          if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
            URL.revokeObjectURL(blobUrl);
          }
        } catch {}
      }
      createdBlobUrlsRef.current = [];
    }
  }, [videoRef]);

  // Thorough cleanup of video pipeline and HLS instance
  const cleanup = useCallback(() => {
    recoveryTimersRef.current.forEach((t) => clearTimeout(t));
    recoveryTimersRef.current = [];

    clearExternalTracksAndBlobs();

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
        if (video.textTracks && video.textTracks.length > 0) {
          for (let i = 0; i < video.textTracks.length; i++) {
            try {
              video.textTracks[i].mode = 'disabled';
            } catch {}
          }
        }
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch {
        // ignore
      }
    }
  }, [videoRef, clearExternalTracksAndBlobs]);

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

  const syncVisualControlsStateFromVideo = useCallback(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return;
    const cur = video.currentTime || 0;
    const rawDur = video.duration;
    const dur = isFinite(rawDur) && !isNaN(rawDur) && rawDur > 0 ? rawDur : 0;
    currentTimeRef.current = cur;
    durationRef.current = dur;
    setCurrentTime(cur);
    setDuration(dur);

    const { ranges, ahead } = calculateBufferStats(video);
    setBufferedRanges(ranges);
    setBufferedAhead(ahead);

    if (isLive && hlsRef.current) {
      const syncPos = hlsRef.current.liveSyncPosition;
      if (syncPos !== null && syncPos !== undefined && syncPos > 0) {
        const dist = Math.max(0, syncPos - cur);
        liveSyncPositionRef.current = syncPos;
        liveEdgeDistanceRef.current = dist;
        setLiveSyncPosition(syncPos);
        setLiveEdgeDistance(dist);
      }
    }
  }, [videoRef, streamUrl, calculateBufferStats, isLive]);

  // Synchronize visual controls state immediately when controls become visible
  const wasPublishingControlsRef = useRef(shouldPublishControls);
  useEffect(() => {
    const wasPublishing = wasPublishingControlsRef.current;
    wasPublishingControlsRef.current = shouldPublishControls;
    if (!wasPublishing && shouldPublishControls) {
      syncVisualControlsStateFromVideo();
    }
  }, [shouldPublishControls, syncVisualControlsStateFromVideo]);

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
      currentTimeRef.current = 0;
      durationRef.current = 0;
      setBufferedAhead(0);
      setBufferedRanges([]);
      setQualities([]);
      setAudioTracks([]);
      setSubtitleTracks([]);
      setCurrentQuality(-1);
      setCurrentAudioTrack(-1);
      setCurrentSubtitleTrack(-1);
      audioTracksRef.current = [];
      subtitleTracksRef.current = [];
      selectedSubtitleTrackIdRef.current = -1;
      syncSubtitleTracksFnRef.current = null;
      setLiveSyncPosition(null);
      setLiveEdgeDistance(0);
      liveSyncPositionRef.current = null;
      liveEdgeDistanceRef.current = 0;
      lastRecordedTimeRef.current = startAt || 0;
    };

    if (!video || !streamUrl) {
      cleanup();
      resetSessionMetrics();
      return;
    }

    const currentSessionId = ++sessionIdRef.current;
    const activeAttemptId = retryTrigger;
    activeAccountRef.current = credentials || null;
    cleanup();
    resetSessionMetrics();
    setIsLoading(true);

    // Initial video element setup using current ref values
    video.volume = normalizePlayerVolume(volumeRef.current, 1);
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
          currentTimeRef.current = startAt;
        } catch {
          // ignore
        }
      }
    };

    let hasReportedSuccess = false;
    let hasReportedFinalError = false;

    const reportSuccess = () => {
      if (sessionIdRef.current !== currentSessionId) return;
      if (!hasReportedSuccess) {
        hasReportedSuccess = true;
        onPlaybackSuccessRef.current?.(activeAttemptId);
      }
    };

    const reportFinalError = (msg: string) => {
      if (sessionIdRef.current !== currentSessionId) return;
      if (!hasReportedFinalError) {
        hasReportedFinalError = true;
        onPlaybackFinalErrorRef.current?.(msg, activeAttemptId);
      }
    };

    // Named video element event listeners for clean disposal
    const handlePlaying = () => {
      if (sessionIdRef.current !== currentSessionId) return;
      setIsPlaying(true);
      setIsLoading(false);
      setIsBuffering(false);
      reportSuccess();
    };

    const handlePlay = () => {
      if (sessionIdRef.current !== currentSessionId) return;
      setIsPlaying(true);
    };

    const handlePause = () => {
      if (sessionIdRef.current !== currentSessionId) return;
      setIsPlaying(false);
      if (!shouldPublishControlsRef.current) {
        syncVisualControlsStateFromVideo();
      }
      // Save progress on pause for VOD/series
      if (!isLive && streamId && video.currentTime > 5) {
        const playbackType: PlaybackType = inferredContentType === 'episode' ? 'episode' : 'movie';
        const recorded = recordPlaybackPosition(activeAccountRef.current, {
          id: streamId,
          type: playbackType,
          positionSec: video.currentTime,
        });
        if (recorded) {
          lastRecordedTimeRef.current = video.currentTime;
        }
      }
    };

    const handleWaiting = () => {
      if (sessionIdRef.current !== currentSessionId) return;
      setIsBuffering(true);
    };

    const handleTimeUpdate = () => {
      if (sessionIdRef.current !== currentSessionId) return;
      const cur = video.currentTime;
      currentTimeRef.current = cur;

      // Save progress periodically (at most once every 5 seconds) for VOD/series
      if (!isLive && streamId && cur > 5) {
        if (Math.abs(cur - lastRecordedTimeRef.current) >= 5) {
          const playbackType: PlaybackType = inferredContentType === 'episode' ? 'episode' : 'movie';
          const recorded = recordPlaybackPosition(activeAccountRef.current, {
            id: streamId,
            type: playbackType,
            positionSec: cur,
          });
          if (recorded) {
            lastRecordedTimeRef.current = cur;
          }
        }
      }

      // Live latency ref tracking (always kept fresh for live edge calculations)
      let liveSyncPos: number | null = null;
      let liveDist = 0;
      if (isLive && hlsRef.current) {
        const syncPos = hlsRef.current.liveSyncPosition;
        if (syncPos !== null && syncPos !== undefined && syncPos > 0) {
          liveSyncPos = syncPos;
          liveDist = Math.max(0, syncPos - cur);
          liveSyncPositionRef.current = syncPos;
          liveEdgeDistanceRef.current = liveDist;
        }
      }

      if (!shouldPublishControlsRef.current) {
        return;
      }

      setCurrentTime(cur);

      // Update buffered stats dynamically only when controls are visible
      const { ranges, ahead } = calculateBufferStats(video);
      setBufferedRanges(ranges);
      setBufferedAhead(ahead);

      if (liveSyncPos !== null) {
        setLiveSyncPosition(liveSyncPos);
        setLiveEdgeDistance(liveDist);
      }
    };

    const handleDurationChange = () => {
      if (sessionIdRef.current !== currentSessionId) return;
      const dur = video.duration;
      const normalizedDur = isFinite(dur) && !isNaN(dur) && dur > 0 ? dur : 0;
      durationRef.current = normalizedDur;
      if (shouldPublishControlsRef.current) {
        setDuration(normalizedDur);
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
      if (!shouldPublishControlsRef.current) {
        return;
      }
      const { ranges, ahead } = calculateBufferStats(video);
      setBufferedRanges(ranges);
      setBufferedAhead(ahead);
    };

    const handleVolumeChange = () => {
      if (sessionIdRef.current !== currentSessionId) return;
      const safeVol = normalizePlayerVolume(video.volume, volumeRef.current);
      setVolumeState(safeVol);
      setIsMuted(video.muted);
      try {
        localStorage.setItem('nc_player_volume', String(safeVol));
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
        if (mediaErr.code === 4) {
          msg =
            'Formato não suportado nativamente pelo navegador ou bloqueio de CORS / Mixed Content pelo provedor.';
        } else if (mediaErr.code === 2) {
          msg = 'Erro de rede ao conectar à transmissão do provedor.';
        } else if (mediaErr.code === 3) {
          msg = 'Erro na decodificação do fluxo de vídeo.';
        }
      }
      setError(msg);
      setIsLoading(false);
      setIsBuffering(false);
      reportFinalError(msg);
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
    // Unified Audio Track discovery (HLS.js -> Native HTMLMediaElement.audioTracks)
    const syncAudioTracks = () => {
      if (sessionIdRef.current !== currentSessionId) return;
      const hlsInstance = hlsRef.current;

      if (hlsInstance && Array.isArray(hlsInstance.audioTracks) && hlsInstance.audioTracks.length > 0) {
        const rawList: InternalAudioTrackDescriptor[] = hlsInstance.audioTracks.map((tr, idx) => {
          const hlsTrackId = typeof tr.id === 'number' ? tr.id : idx;
          return {
            id: hlsTrackId,
            hlsTrackId,
            source: 'hls',
            lang: tr.lang,
            channels: (tr as any).channels ? String((tr as any).channels) : undefined,
            codec: (tr as any).audioCodec,
            isDefault: Boolean((tr as any).default),
            forced: Boolean((tr as any).forced),
            name: formatMediaTrackLabel({
              rawName: tr.name,
              lang: tr.lang,
              fallbackPrefix: 'Faixa',
              index: idx,
              isDefault: Boolean((tr as any).default),
              forced: Boolean((tr as any).forced),
              channels: (tr as any).channels,
            }),
          };
        });
        const disambiguated = disambiguateTrackNames(rawList) as InternalAudioTrackDescriptor[];
        audioTracksRef.current = disambiguated;
        setAudioTracks(disambiguated);

        const activeHlsAudio = hlsInstance.audioTrack;
        const matchedActive = disambiguated.find(
          (t) => t.hlsTrackId === activeHlsAudio || t.id === activeHlsAudio
        );
        if (matchedActive) {
          setCurrentAudioTrack(matchedActive.id);
        } else if (disambiguated.length > 0) {
          const defTrack = disambiguated.find((t) => t.isDefault) || disambiguated[0];
          setCurrentAudioTrack(defTrack.id);
        } else {
          setCurrentAudioTrack(-1);
        }
        return;
      }

      const nativeAudioList = (video as any).audioTracks;
      if (nativeAudioList && typeof nativeAudioList.length === 'number' && nativeAudioList.length > 0) {
        const rawNative: InternalAudioTrackDescriptor[] = [];
        let enabledId = -1;
        for (let i = 0; i < nativeAudioList.length; i++) {
          const nt = nativeAudioList[i];
          if (!nt) continue;
          if (nt.enabled && enabledId === -1) {
            enabledId = i;
          }
          rawNative.push({
            id: i,
            nativeTrackIndex: i,
            nativeTrackObj: nt,
            source: 'native',
            lang: nt.language || undefined,
            isDefault: Boolean(nt.kind === 'main'),
            name: formatMediaTrackLabel({
              rawName: nt.label,
              lang: nt.language,
              fallbackPrefix: 'Faixa',
              index: i,
            }),
          });
        }
        const disambiguated = disambiguateTrackNames(rawNative) as InternalAudioTrackDescriptor[];
        audioTracksRef.current = disambiguated;
        setAudioTracks(disambiguated);
        setCurrentAudioTrack(enabledId !== -1 ? enabledId : disambiguated[0]?.id ?? -1);
        return;
      }

      audioTracksRef.current = [];
      setAudioTracks([]);
      setCurrentAudioTrack(-1);
    };

    // Unified Subtitle Track discovery (HLS.js + Native HTMLMediaElement.textTracks + External tracks)
    const syncSubtitleTracks = () => {
      if (sessionIdRef.current !== currentSessionId) return;
      const hlsInstance = hlsRef.current;
      const combined: InternalSubtitleTrackDescriptor[] = [];

      const hasHlsSubtitles = Boolean(
        hlsInstance &&
          Array.isArray(hlsInstance.subtitleTracks) &&
          hlsInstance.subtitleTracks.length > 0
      );

      // 1. HLS subtitle tracks
      if (hasHlsSubtitles && hlsInstance) {
        hlsInstance.subtitleTracks.forEach((tr, idx) => {
          const hlsTrackId = typeof tr.id === 'number' ? tr.id : idx;
          combined.push({
            id: combined.length,
            hlsTrackId,
            source: 'hls',
            lang: tr.lang,
            isDefault: Boolean((tr as any).default),
            forced: Boolean((tr as any).forced),
            name: formatMediaTrackLabel({
              rawName: tr.name,
              lang: tr.lang,
              fallbackPrefix: 'Legenda',
              index: idx,
              isDefault: Boolean((tr as any).default),
              forced: Boolean((tr as any).forced),
            }),
          });
        });
      }

      // 2. Native in-band HTMLMediaElement.textTracks (only when HLS subtitleTracks are not active,
      //    preventing duplicate entries for TextTracks created internally by Hls.js, and excluding
      //    managed external <track data-nc-external-track="true"> elements)
      const externalTextTrackSet = new Set<TextTrack>();
      const externalLabelsSet = new Set<string>();
      for (const ext of resolvedExternalTracksRef.current) {
        if (ext.trackEl?.track) {
          externalTextTrackSet.add(ext.trackEl.track);
        }
        if (ext.label) {
          externalLabelsSet.add(ext.label.trim().toLowerCase());
        }
      }

      if (!hasHlsSubtitles && video.textTracks && video.textTracks.length > 0) {
        for (let i = 0; i < video.textTracks.length; i++) {
          const tt = video.textTracks[i];
          if (
            !tt ||
            externalTextTrackSet.has(tt) ||
            Boolean((tt as any).__ncExternal) ||
            (tt.label && externalLabelsSet.has(tt.label.trim().toLowerCase()))
          ) {
            continue;
          }
          const kind = (tt.kind || 'subtitles').toLowerCase();
          if (kind !== 'subtitles' && kind !== 'captions') continue;
          combined.push({
            id: combined.length,
            nativeTrackIndex: i,
            nativeTrackObj: tt,
            source: 'native',
            lang: tt.language || undefined,
            name: formatMediaTrackLabel({
              rawName: tt.label,
              lang: tt.language,
              fallbackPrefix: 'Legenda',
              index: combined.length,
            }),
          });
        }
      }

      // 3. Resolved External Subtitle Tracks (.vtt / .srt)
      resolvedExternalTracksRef.current.forEach((ext, extIdx) => {
        combined.push({
          id: combined.length,
          source: 'external',
          externalUrl: ext.url,
          format: ext.format,
          lang: ext.lang,
          isDefault: ext.isDefault,
          forced: ext.forced,
          trackElement: ext.trackEl,
          nativeTrackObj: ext.trackEl?.track,
          name: formatMediaTrackLabel({
            rawName: ext.label,
            lang: ext.lang,
            fallbackPrefix: 'Legenda',
            index: extIdx,
            isDefault: ext.isDefault,
            forced: ext.forced,
          }),
        });
      });

      const disambiguated = disambiguateTrackNames(combined) as InternalSubtitleTrackDescriptor[];
      subtitleTracksRef.current = disambiguated;
      setSubtitleTracks(disambiguated);

      // Synchronize active subtitle track
      const prevSelectedId = selectedSubtitleTrackIdRef.current;
      if (prevSelectedId >= 0) {
        const stillExists = disambiguated.find((t) => t.id === prevSelectedId);
        if (stillExists) {
          setCurrentSubtitleTrack(stillExists.id);
          return;
        }
      }

      if (hasHlsSubtitles && hlsInstance && typeof hlsInstance.subtitleTrack === 'number' && hlsInstance.subtitleTrack >= 0 && hlsInstance.subtitleDisplay !== false) {
        const matchedHls = disambiguated.find(
          (t) => t.source === 'hls' && t.hlsTrackId === hlsInstance.subtitleTrack
        );
        if (matchedHls) {
          selectedSubtitleTrackIdRef.current = matchedHls.id;
          setCurrentSubtitleTrack(matchedHls.id);
          return;
        }
      }

      const showingNativeOrExternal = disambiguated.find(
        (t) =>
          (t.source === 'native' || t.source === 'external') &&
          (t.trackElement?.track?.mode === 'showing' || t.nativeTrackObj?.mode === 'showing')
      );
      if (showingNativeOrExternal) {
        selectedSubtitleTrackIdRef.current = showingNativeOrExternal.id;
        setCurrentSubtitleTrack(showingNativeOrExternal.id);
        return;
      }

      selectedSubtitleTrackIdRef.current = -1;
      setCurrentSubtitleTrack(-1);
    };

    syncSubtitleTracksFnRef.current = syncSubtitleTracks;

    const handleLoadedMetadataWithTracks = () => {
      handleLoadedMetadata();
      if (sessionIdRef.current !== currentSessionId) return;
      syncAudioTracks();
      syncSubtitleTracks();
    };

    // Attach listeners to video element
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('durationchange', handleDurationChange);
    video.addEventListener('loadedmetadata', handleLoadedMetadataWithTracks);
    video.addEventListener('progress', handleProgress);
    video.addEventListener('volumechange', handleVolumeChange);
    video.addEventListener('ratechange', handleRateChange);
    video.addEventListener('error', handleError);

    // Native textTracks & audioTracks dynamic event listeners
    const textTrackList = video.textTracks;
    const nativeAudioList = (video as any).audioTracks;

    const handleNativeTextTracksChange = () => {
      if (sessionIdRef.current !== currentSessionId) return;
      syncSubtitleTracks();
    };

    const handleNativeAudioTracksChange = () => {
      if (sessionIdRef.current !== currentSessionId) return;
      syncAudioTracks();
    };

    if (textTrackList && typeof textTrackList.addEventListener === 'function') {
      textTrackList.addEventListener('addtrack', handleNativeTextTracksChange);
      textTrackList.addEventListener('removetrack', handleNativeTextTracksChange);
      textTrackList.addEventListener('change', handleNativeTextTracksChange);
    }

    if (nativeAudioList && typeof nativeAudioList.addEventListener === 'function') {
      nativeAudioList.addEventListener('addtrack', handleNativeAudioTracksChange);
      nativeAudioList.addEventListener('removetrack', handleNativeAudioTracksChange);
      nativeAudioList.addEventListener('change', handleNativeAudioTracksChange);
    }

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

        syncAudioTracks();
        syncSubtitleTracks();

        applyStartAt();
        video.play().catch(() => {
          if (sessionIdRef.current === currentSessionId) {
            setIsPlaying(false);
          }
        });
      });

      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
        if (sessionIdRef.current !== currentSessionId) return;
        syncAudioTracks();
      });

      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
        if (sessionIdRef.current !== currentSessionId) return;
        syncSubtitleTracks();
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
        const matched = audioTracksRef.current.find(
          (t) => t.source === 'hls' && (t.hlsTrackId === data.id || t.id === data.id)
        );
        setCurrentAudioTrack(matched ? matched.id : data.id);
      });

      hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_event, data) => {
        if (sessionIdRef.current !== currentSessionId) return;
        if (data.id === -1) {
          const activeCustom = subtitleTracksRef.current.find(
            (t) =>
              t.id === selectedSubtitleTrackIdRef.current &&
              (t.source === 'external' || t.source === 'native')
          );
          if (activeCustom) {
            return;
          }
          selectedSubtitleTrackIdRef.current = -1;
          setCurrentSubtitleTrack(-1);
          return;
        }
        const matched = subtitleTracksRef.current.find(
          (t) => t.source === 'hls' && (t.hlsTrackId === data.id || t.id === data.id)
        );
        const resolvedId = matched ? matched.id : data.id;
        selectedSubtitleTrackIdRef.current = resolvedId;
        setCurrentSubtitleTrack(resolvedId);
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
                const msg =
                  'Falha de rede ou CORS ao carregar manifesto HLS diretamente do provedor. ' +
                  'Verifique se o servidor do provedor permite requisições da web.';
                setError(msg);
                setIsLoading(false);
                setIsBuffering(false);
                reportFinalError(msg);
                hls.destroy();
                hlsRef.current = null;
              }
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              if (mediaRecoveryAttempts < 2) {
                mediaRecoveryAttempts++;
                hls.recoverMediaError();
              } else {
                const msg = 'Erro fatal irrecuperável na decodificação de mídia HLS.';
                setError(msg);
                setIsLoading(false);
                setIsBuffering(false);
                reportFinalError(msg);
                hls.destroy();
                hlsRef.current = null;
              }
              break;
            default: {
              const msg = 'Erro fatal irrecuperável no fluxo HLS.';
              setError(msg);
              setIsLoading(false);
              setIsBuffering(false);
              reportFinalError(msg);
              hls.destroy();
              hlsRef.current = null;
              break;
            }
          }
        }
      });
    } else {
      // Native progressive playback (or Safari native HLS)
      video.src = streamUrl;
      video.load();
    }

    return () => {
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('durationchange', handleDurationChange);
      video.removeEventListener('loadedmetadata', handleLoadedMetadataWithTracks);
      video.removeEventListener('progress', handleProgress);
      video.removeEventListener('volumechange', handleVolumeChange);
      video.removeEventListener('ratechange', handleRateChange);
      video.removeEventListener('error', handleError);

      if (textTrackList && typeof textTrackList.removeEventListener === 'function') {
        textTrackList.removeEventListener('addtrack', handleNativeTextTracksChange);
        textTrackList.removeEventListener('removetrack', handleNativeTextTracksChange);
        textTrackList.removeEventListener('change', handleNativeTextTracksChange);
      }

      if (nativeAudioList && typeof nativeAudioList.removeEventListener === 'function') {
        nativeAudioList.removeEventListener('addtrack', handleNativeAudioTracksChange);
        nativeAudioList.removeEventListener('removetrack', handleNativeAudioTracksChange);
        nativeAudioList.removeEventListener('change', handleNativeAudioTracksChange);
      }

      // Save progress on exit if VOD/series
      if (!isLive && streamId && video.currentTime > 5) {
        const playbackType: PlaybackType = inferredContentType === 'episode' ? 'episode' : 'movie';
        recordPlaybackPosition(activeAccountRef.current, {
          id: streamId,
          type: playbackType,
          positionSec: video.currentTime,
        });
      }

      cleanup();
    };
  }, [
    streamUrl,
    retryTrigger,
    cleanup,
    isLive,
    streamId,
    startAt,
    inferredTransport,
    calculateBufferStats,
    syncVisualControlsStateFromVideo,
  ]);

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

  const getEffectiveDuration = useCallback((): number => {
    const video = videoRef.current;
    if (!video) return 0;
    const dur = video.duration;
    if (typeof dur === 'number' && Number.isFinite(dur) && !Number.isNaN(dur) && dur > 0) {
      durationRef.current = dur;
      return dur;
    }
    durationRef.current = 0;
    return 0;
  }, [videoRef]);

  const seek = useCallback(
    (time: number) => {
      const video = videoRef.current;
      if (!video || !Number.isFinite(time)) return;
      const rawDur = getEffectiveDuration();
      const target = Math.max(0, Math.min(time, rawDur > 0 ? rawDur : Infinity));
      video.currentTime = target;
      currentTimeRef.current = target;
      if (shouldPublishControlsRef.current) {
        setCurrentTime(target);
        if (rawDur > 0) {
          setDuration(rawDur);
        }
      }
    },
    [videoRef, getEffectiveDuration]
  );

  const seekBy = useCallback(
    (delta: number) => {
      const video = videoRef.current;
      if (!video || !Number.isFinite(delta)) return;
      const rawDur = getEffectiveDuration();
      const target = Math.max(0, Math.min(video.currentTime + delta, rawDur > 0 ? rawDur : Infinity));
      video.currentTime = target;
      currentTimeRef.current = target;
      if (shouldPublishControlsRef.current) {
        setCurrentTime(target);
        if (rawDur > 0) {
          setDuration(rawDur);
        }
      }
    },
    [videoRef, getEffectiveDuration]
  );

  const seekToLive = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const rawDur = getEffectiveDuration();
    if (hlsRef.current && hlsRef.current.liveSyncPosition) {
      video.currentTime = hlsRef.current.liveSyncPosition;
    } else if (rawDur > 0) {
      video.currentTime = Math.max(0, rawDur - 2);
    }
    currentTimeRef.current = video.currentTime || 0;
    if (shouldPublishControlsRef.current) {
      setCurrentTime(currentTimeRef.current);
    }
  }, [videoRef, getEffectiveDuration]);

  const setVolume = useCallback(
    (newVol: number) => {
      const video = videoRef.current;
      const clamped = normalizePlayerVolume(newVol, volumeRef.current);
      if (video) {
        video.volume = clamped;
        if (clamped > 0 && video.muted) {
          video.muted = false;
        }
      }
      volumeRef.current = clamped;
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

  // External subtitle tracks resolution & attachment (decoupled from video pipeline restart)
  const externalSubtitlesKey = (externalSubtitles || [])
    .map((s) => `${s?.url || ''}|${s?.lang || ''}|${s?.label || ''}|${s?.format || ''}`)
    .join(';;');

  useEffect(() => {
    const video = videoRef.current;
    clearExternalTracksAndBlobs();
    syncSubtitleTracksFnRef.current?.();

    if (!video || !streamUrl || !Array.isArray(externalSubtitles) || externalSubtitles.length === 0) {
      return;
    }

    const activeSessionId = sessionIdRef.current;
    const abortController = new AbortController();
    externalAbortControllerRef.current = abortController;

    let cancelled = false;

    const attachExternalTracks = async () => {
      const seenUrls = new Set<string>();

      for (let i = 0; i < externalSubtitles.length; i++) {
        if (cancelled || sessionIdRef.current !== activeSessionId) return;
        const item = externalSubtitles[i];
        if (!item || typeof item.url !== 'string' || !item.url.trim()) continue;

        const rawUrl = item.url.trim();
        if (seenUrls.has(rawUrl)) continue;
        seenUrls.add(rawUrl);

        const detectedFormat = detectSubtitleFormat(rawUrl, item.format);
        if (detectedFormat === 'unsupported') continue;

        const loaded = await loadExternalSubtitleAsVttUrl(rawUrl, abortController.signal);
        if (cancelled || sessionIdRef.current !== activeSessionId) {
          if (loaded?.isBlobUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
            try {
              URL.revokeObjectURL(loaded.resolvedUrl);
            } catch {}
          }
          return;
        }

        if (!loaded) {
          continue;
        }

        if (loaded.isBlobUrl) {
          createdBlobUrlsRef.current.push(loaded.resolvedUrl);
        }

        const computedLabel =
          item.label ||
          formatMediaTrackLabel({
            rawName: item.label,
            lang: item.lang,
            fallbackPrefix: 'Legenda',
            index: i,
            isDefault: item.isDefault,
            forced: item.forced,
          });

        const trackEl = document.createElement('track');
        trackEl.kind = 'subtitles';
        trackEl.setAttribute('data-nc-external-track', 'true');
        trackEl.setAttribute('data-nc-external-url', rawUrl);
        trackEl.setAttribute('data-subtitle-mode', 'disabled');
        trackEl.label = computedLabel;
        if (item.lang) {
          trackEl.srclang = item.lang;
        }
        trackEl.src = loaded.resolvedUrl;

        const entryObj = {
          key: `${rawUrl}#${i}`,
          url: rawUrl,
          resolvedSrc: loaded.resolvedUrl,
          isBlobUrl: loaded.isBlobUrl,
          lang: item.lang,
          label: computedLabel,
          format: (detectedFormat === 'unknown' ? 'vtt' : detectedFormat) as 'vtt' | 'srt',
          isDefault: item.isDefault,
          forced: item.forced,
          trackEl,
        };
        resolvedExternalTracksRef.current.push(entryObj);

        const beforeTrackCount = video.textTracks ? video.textTracks.length : 0;
        video.appendChild(trackEl);
        const afterTrackCount = video.textTracks ? video.textTracks.length : 0;

        const linkedTextTrack =
          trackEl.track ||
          (video.textTracks && afterTrackCount > beforeTrackCount
            ? video.textTracks[afterTrackCount - 1]
            : undefined);

        if (linkedTextTrack) {
          try {
            (linkedTextTrack as any).__ncExternal = true;
            linkedTextTrack.mode = 'disabled';
          } catch {}
        }

        syncSubtitleTracksFnRef.current?.();
      }
    };

    attachExternalTracks();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [streamUrl, retryTrigger, externalSubtitlesKey, videoRef, clearExternalTracksAndBlobs]);

  const setAudioTrack = useCallback(
    (trackId: number) => {
      const target = audioTracksRef.current.find((t) => t.id === trackId);
      if (hlsRef.current && (!target || target.source === 'hls')) {
        const hlsTargetId = target?.hlsTrackId ?? trackId;
        hlsRef.current.audioTrack = hlsTargetId;
        setCurrentAudioTrack(trackId);
        return;
      }

      const video = videoRef.current;
      const nativeAudioList = video ? (video as any).audioTracks : null;
      if (nativeAudioList && typeof nativeAudioList.length === 'number' && nativeAudioList.length > 0) {
        const targetIndex = target?.nativeTrackIndex ?? trackId;
        for (let i = 0; i < nativeAudioList.length; i++) {
          try {
            nativeAudioList[i].enabled = i === targetIndex;
          } catch {}
        }
        setCurrentAudioTrack(trackId);
      }
    },
    [videoRef]
  );

  const setSubtitleTrack = useCallback(
    (trackId: number) => {
      const video = videoRef.current;

      if (trackId === -1) {
        selectedSubtitleTrackIdRef.current = -1;
        if (hlsRef.current) {
          hlsRef.current.subtitleTrack = -1;
          hlsRef.current.subtitleDisplay = false;
        }
        for (const ext of resolvedExternalTracksRef.current) {
          try {
            ext.trackEl?.removeAttribute('default');
            ext.trackEl?.setAttribute('data-subtitle-mode', 'disabled');
            if (ext.trackEl?.track) {
              ext.trackEl.track.mode = 'disabled';
            }
          } catch {}
        }
        if (video && video.textTracks) {
          for (let i = 0; i < video.textTracks.length; i++) {
            try {
              video.textTracks[i].mode = 'disabled';
            } catch {}
          }
        }
        setCurrentSubtitleTrack(-1);
        return;
      }

      const target = subtitleTracksRef.current.find((t) => t.id === trackId);
      if (!target) {
        if (hlsRef.current) {
          selectedSubtitleTrackIdRef.current = trackId;
          hlsRef.current.subtitleDisplay = true;
          hlsRef.current.subtitleTrack = trackId;
          setCurrentSubtitleTrack(trackId);
        }
        return;
      }

      selectedSubtitleTrackIdRef.current = target.id;

      if (target.source === 'hls') {
        for (const ext of resolvedExternalTracksRef.current) {
          try {
            ext.trackEl?.removeAttribute('default');
            ext.trackEl?.setAttribute('data-subtitle-mode', 'disabled');
            if (ext.trackEl?.track) {
              ext.trackEl.track.mode = 'disabled';
            }
          } catch {}
        }
        if (hlsRef.current) {
          hlsRef.current.subtitleDisplay = true;
          hlsRef.current.subtitleTrack = target.hlsTrackId ?? target.id;
        }
        setCurrentSubtitleTrack(target.id);
        return;
      }

      // External or Native subtitle track
      if (hlsRef.current) {
        hlsRef.current.subtitleTrack = -1;
        hlsRef.current.subtitleDisplay = false;
      }

      const targetTextTrack = target.trackElement?.track || target.nativeTrackObj;
      for (const ext of resolvedExternalTracksRef.current) {
        const isTargetExt =
          (target.trackElement && ext.trackEl === target.trackElement) ||
          (targetTextTrack && ext.trackEl?.track === targetTextTrack);
        try {
          if (isTargetExt) {
            ext.trackEl?.setAttribute('default', '');
            ext.trackEl?.setAttribute('data-subtitle-mode', 'showing');
          } else {
            ext.trackEl?.removeAttribute('default');
            ext.trackEl?.setAttribute('data-subtitle-mode', 'disabled');
          }
          if (ext.trackEl?.track) {
            ext.trackEl.track.mode = isTargetExt ? 'showing' : 'disabled';
          }
        } catch {}
      }
      if (video && video.textTracks) {
        for (let i = 0; i < video.textTracks.length; i++) {
          const tt = video.textTracks[i];
          try {
            tt.mode = tt === targetTextTrack ? 'showing' : 'disabled';
          } catch {}
        }
      }
      if (targetTextTrack) {
        try {
          targetTextTrack.mode = 'showing';
        } catch {}
      }
      setCurrentSubtitleTrack(target.id);
    },
    [videoRef]
  );

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
    getEffectiveDuration,
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
