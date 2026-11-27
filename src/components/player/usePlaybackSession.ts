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
import { getAccountKey } from '../../utils/accountUtils';
import {
  identifyMediaSource,
  buildPlaybackAttemptPlan,
  selectPlaybackFallbackAttempt,
  classifyPlaybackError,
  sanitizePlaybackErrorMessage,
  MediaSourceIdentification,
  PlaybackAttemptDescriptor,
  PlaybackErrorClassification,
  PlaybackSourceOrigin,
  PlaybackSourceMetadata,
} from '../../utils/mediaUtils';

interface InternalAudioTrackDescriptor extends MediaTrackInfo {
  nativeTrackObj?: any;
  hlsGroupId?: string;
  hlsUrl?: string;
  rawName?: string;
}

interface HlsAudioTrackIdentity {
  index: number;
  hlsTrackId?: number;
  hlsGroupId?: string;
  hlsUrl?: string;
  rawName?: string;
  lang?: string;
}

interface PendingHlsAudioRequest extends HlsAudioTrackIdentity {
  requestId: number;
  trackId: number;
  targetIndex: number;
  confirmed: boolean;
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
  sourceOrigin?: PlaybackSourceOrigin;
  sourceMetadata?: PlaybackSourceMetadata | null;
  containerExtension?: string | null;
  mimeType?: string | null;
  allowedOutputFormats?: string[] | null;
  directSource?: string | null;
  startAt?: number;
  streamId?: string | number;
  credentials?: AccountIdentity | null;
  onRetry?: () => void;
  retryTrigger?: number;
  onPlaybackSuccess?: (attemptId?: number) => void;
  onPlaybackFinalError?: (errorMessage: string, attemptId?: number) => void;
  isControlsVisible?: boolean;
  suppressLivePreviewVisualMetrics?: boolean;
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

function isMixedContentUrl(rawUrl: string): boolean {
  if (typeof window === 'undefined' || !window.location) return false;
  return (
    window.location.protocol === 'https:' &&
    /^http:\/\//i.test((rawUrl || '').trim())
  );
}

/**
 * Computes a deterministic, non-reversible session identity signature for the active account/credentials.
 * - Stable across object reference churn or unrelated metadata updates (e.g. user_info/server_info).
 * - Changes on account switch, logout, or credential rotation even if a direct_source URL stays identical.
 * - Never stores, exposes, or logs raw passwords.
 */
function computeCredentialSessionKey(credentials?: AccountIdentity | null): string {
  if (!credentials || typeof credentials !== 'object') return '';
  const accountKey = getAccountKey(credentials.serverUrl, credentials.username);
  const rawPwd =
    typeof (credentials as { password?: unknown }).password === 'string'
      ? (credentials as { password: string }).password
      : '';

  if (!accountKey && !rawPwd) return '';

  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < rawPwd.length; i++) {
    const code = rawPwd.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= code ^ (i + 1);
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }

  return `${accountKey}|${rawPwd.length}:${h1.toString(16)}:${h2.toString(16)}`;
}

function probeNativeHlsSupport(video: HTMLVideoElement | null): boolean {
  if (!video || typeof video.canPlayType !== 'function') return false;
  try {
    const appleMime = video.canPlayType('application/vnd.apple.mpegurl');
    if (appleMime === 'probably' || appleMime === 'maybe') return true;
    const mpegUrlMime = video.canPlayType('application/x-mpegurl');
    return mpegUrlMime === 'probably' || mpegUrlMime === 'maybe';
  } catch {
    return false;
  }
}

function classifyNativeMediaError(
  mediaErr: MediaError | null,
  source: MediaSourceIdentification
): PlaybackErrorClassification {
  return classifyPlaybackError({
    source,
    kind: 'native',
    mediaError: mediaErr
      ? { code: mediaErr.code, message: mediaErr.message }
      : null,
    isMixedContent: isMixedContentUrl(source.url),
  });
}

function classifyHlsFatalError(
  data: any,
  source: MediaSourceIdentification
): PlaybackErrorClassification {
  const responseCode =
    typeof data?.response?.code === 'number' && data.response.code > 0
      ? data.response.code
      : typeof data?.networkDetails?.status === 'number' && data.networkDetails.status > 0
        ? data.networkDetails.status
        : undefined;

  return classifyPlaybackError({
    source,
    kind: 'hls',
    hlsErrorData: data,
    httpStatus: responseCode,
    isMixedContent: isMixedContentUrl(source.url),
  });
}

function extractHlsAudioIdentity(
  track: InternalAudioTrackDescriptor
): HlsAudioTrackIdentity {
  return {
    index: track.hlsTrackIndex ?? track.id,
    hlsTrackId: track.hlsTrackId,
    hlsGroupId: track.hlsGroupId,
    hlsUrl: track.hlsUrl,
    rawName: track.rawName,
    lang: track.lang,
  };
}

function doesDescriptorMatchIdentity(
  track: InternalAudioTrackDescriptor,
  identity: HlsAudioTrackIdentity
): boolean {
  if (identity.hlsUrl && track.hlsUrl) {
    return track.hlsUrl === identity.hlsUrl;
  }
  if (identity.hlsGroupId && identity.rawName && track.hlsGroupId && track.rawName) {
    return (
      track.hlsGroupId === identity.hlsGroupId &&
      track.rawName === identity.rawName &&
      (!identity.lang || !track.lang || track.lang === identity.lang)
    );
  }
  if (identity.rawName && track.rawName && identity.lang && track.lang) {
    return track.rawName === identity.rawName && track.lang === identity.lang;
  }
  if (typeof identity.hlsTrackId === 'number' && typeof track.hlsTrackId === 'number') {
    if (track.hlsTrackId === identity.hlsTrackId) {
      return true;
    }
  }
  return (track.hlsTrackIndex ?? track.id) === identity.index;
}

function findDescriptorByIdentity(
  list: InternalAudioTrackDescriptor[],
  identity: HlsAudioTrackIdentity
): InternalAudioTrackDescriptor | undefined {
  if (list.length === 0) return undefined;

  if (identity.hlsUrl) {
    const byUrl = list.find((t) => t.source === 'hls' && t.hlsUrl === identity.hlsUrl);
    if (byUrl) return byUrl;
  }

  if (identity.hlsGroupId && identity.rawName) {
    const byGroupName = list.find(
      (t) =>
        t.source === 'hls' &&
        t.hlsGroupId === identity.hlsGroupId &&
        t.rawName === identity.rawName &&
        (!identity.lang || !t.lang || t.lang === identity.lang)
    );
    if (byGroupName) return byGroupName;
  }

  if (identity.rawName && identity.lang) {
    const byNameLang = list.find(
      (t) => t.source === 'hls' && t.rawName === identity.rawName && t.lang === identity.lang
    );
    if (byNameLang) return byNameLang;
  }

  if (typeof identity.hlsTrackId === 'number') {
    const byMetaId = list.find((t) => t.source === 'hls' && t.hlsTrackId === identity.hlsTrackId);
    if (byMetaId) return byMetaId;
  }

  // Only fall back to array index when the identity had no stronger URL/group/name/metaId markers
  const hasStrongMarkers = Boolean(
    identity.hlsUrl ||
      (identity.hlsGroupId && identity.rawName) ||
      (identity.rawName && identity.lang) ||
      typeof identity.hlsTrackId === 'number'
  );
  if (!hasStrongMarkers && identity.index >= 0) {
    return list.find((t) => t.source === 'hls' && t.hlsTrackIndex === identity.index);
  }

  return undefined;
}

function resolveAudioTrackFromEventPayload(
  data: any,
  list: InternalAudioTrackDescriptor[]
): InternalAudioTrackDescriptor | undefined {
  if (!data || typeof data !== 'object' || list.length === 0) {
    return undefined;
  }

  // 1. Match by track URL (MediaPlaylist.url emitted by HLS.js)
  if (typeof data.url === 'string' && data.url.trim()) {
    const urlMatches = list.filter((t) => t.source === 'hls' && t.hlsUrl === data.url);
    if (urlMatches.length === 1) return urlMatches[0];
    if (urlMatches.length > 1) {
      const narrowed = urlMatches.find(
        (t) =>
          (!data.groupId || t.hlsGroupId === data.groupId) &&
          (!data.name || t.rawName === data.name) &&
          (!data.lang || t.lang === data.lang)
      );
      if (narrowed) return narrowed;
      return urlMatches[0];
    }
  }

  // 2. Match by groupId + name (+ lang) for MediaPlaylist objects (including muxed tracks with empty url)
  if (typeof data.name === 'string' && data.name.trim()) {
    const byMeta = list.find(
      (t) =>
        t.source === 'hls' &&
        t.rawName === data.name &&
        (!data.groupId || !t.hlsGroupId || t.hlsGroupId === data.groupId) &&
        (!data.lang || !t.lang || t.lang === data.lang)
    );
    if (byMeta) return byMeta;
  }

  // 3. Match by numeric id:
  //    - If payload carries MediaPlaylist metadata (url/name/groupId/lang), data.id is track.id (hlsTrackId) first.
  //    - If payload only carries { id }, treat data.id as hlsTrackIndex first (compatible with lightweight mocks).
  if (typeof data.id === 'number' && data.id >= 0) {
    const hasPlaylistMetadata = Boolean(
      (typeof data.url === 'string' && data.url.length > 0) ||
        (typeof data.name === 'string' && data.name.length > 0) ||
        (typeof data.groupId === 'string' && data.groupId.length > 0) ||
        (typeof data.lang === 'string' && data.lang.length > 0)
    );

    if (hasPlaylistMetadata) {
      const byMetaId = list.find((t) => t.source === 'hls' && t.hlsTrackId === data.id);
      if (byMetaId) return byMetaId;
      const byIndex = list.find((t) => t.source === 'hls' && t.hlsTrackIndex === data.id);
      if (byIndex) return byIndex;
    } else {
      const byIndex = list.find((t) => t.source === 'hls' && t.hlsTrackIndex === data.id);
      if (byIndex) return byIndex;
      const byMetaId = list.find((t) => t.source === 'hls' && t.hlsTrackId === data.id);
      if (byMetaId) return byMetaId;
    }
  }

  return undefined;
}

function resolveLiveHlsAudioTrackIndex(
  hlsTracks: any[],
  target: InternalAudioTrackDescriptor
): number {
  if (!Array.isArray(hlsTracks) || hlsTracks.length === 0) return -1;

  if (
    typeof target.hlsTrackIndex === 'number' &&
    target.hlsTrackIndex >= 0 &&
    target.hlsTrackIndex < hlsTracks.length
  ) {
    const candidate = hlsTracks[target.hlsTrackIndex];
    const sameUrl = !target.hlsUrl || !candidate?.url || candidate.url === target.hlsUrl;
    const sameGroup =
      !target.hlsGroupId || !candidate?.groupId || candidate.groupId === target.hlsGroupId;
    const sameRawName =
      !target.rawName || !candidate?.name || candidate.name === target.rawName;
    if (sameUrl && sameGroup && sameRawName) {
      return target.hlsTrackIndex;
    }
  }

  if (target.hlsUrl) {
    const byUrl = hlsTracks.findIndex((tr) => tr && tr.url === target.hlsUrl);
    if (byUrl !== -1) return byUrl;
  }

  if (target.hlsGroupId && target.rawName) {
    const byGroupAndName = hlsTracks.findIndex(
      (tr) =>
        tr &&
        tr.groupId === target.hlsGroupId &&
        tr.name === target.rawName &&
        (!target.lang || tr.lang === target.lang)
    );
    if (byGroupAndName !== -1) return byGroupAndName;
  }

  if (typeof target.hlsTrackId === 'number') {
    const byMetaId = hlsTracks.findIndex((tr) => tr && tr.id === target.hlsTrackId);
    if (byMetaId !== -1) return byMetaId;
  }

  return -1;
}

export function usePlaybackSession({
  videoRef,
  streamUrl,
  contentType: explicitContentType,
  sourceOrigin,
  sourceMetadata,
  containerExtension,
  mimeType,
  allowedOutputFormats,
  directSource,
  startAt = 0,
  streamId,
  credentials,
  retryTrigger = 0,
  onPlaybackSuccess,
  onPlaybackFinalError,
  isControlsVisible = true,
  suppressLivePreviewVisualMetrics = false,
  externalSubtitles,
}: UsePlaybackSessionOptions) {
  const effectiveContentType = explicitContentType ?? sourceMetadata?.contentType;
  const effectiveSourceOrigin = sourceOrigin ?? sourceMetadata?.sourceOrigin;
  const effectiveContainerExtension =
    containerExtension ??
    sourceMetadata?.declaredContainerExtension ??
    sourceMetadata?.resolvedContainerExtension;
  const effectiveMimeType = mimeType ?? sourceMetadata?.mimeType;
  const effectiveDirectSource = directSource ?? sourceMetadata?.directSource;
  const effectiveStreamId = streamId ?? sourceMetadata?.streamId ?? undefined;
  const effectiveAllowedOutputFormats =
    allowedOutputFormats !== undefined
      ? allowedOutputFormats
      : sourceMetadata?.allowedOutputFormats;
  const accountIdentityKey = computeCredentialSessionKey(credentials);

  const activeAccountRef = useRef<AccountIdentity | null>(credentials || null);
  const credentialsRef = useRef<AccountIdentity | null>(credentials || null);
  credentialsRef.current = credentials || null;
  const allowedOutputFormatsRef = useRef<string[] | null | undefined>(
    effectiveAllowedOutputFormats
  );
  allowedOutputFormatsRef.current = effectiveAllowedOutputFormats;
  const sourceMetadataRef = useRef<PlaybackSourceMetadata | null>(sourceMetadata ?? null);
  sourceMetadataRef.current = sourceMetadata ?? null;

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
  const syncAudioTracksFnRef = useRef<(() => void) | null>(null);
  const syncSubtitleTracksFnRef = useRef<(() => void) | null>(null);
  const pendingAudioRequestRef = useRef<PendingHlsAudioRequest | null>(null);
  const lastConfirmedHlsAudioTrackRef = useRef<HlsAudioTrackIdentity | null>(null);
  const failedHlsAudioTrackRef = useRef<HlsAudioTrackIdentity | null>(null);
  const audioRequestSeqRef = useRef(0);

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

  const suppressLivePreviewVisualMetricsRef = useRef(suppressLivePreviewVisualMetrics);
  suppressLivePreviewVisualMetricsRef.current = suppressLivePreviewVisualMetrics;

  const shouldPublishControls =
    !suppressLivePreviewVisualMetrics &&
    (isControlsVisible || (!isPlaying && !isLoading && !isBuffering));
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
  const [pendingAudioTrack, setPendingAudioTrack] = useState<number>(-1);
  const [audioTrackFeedback, setAudioTrackFeedback] = useState<string | null>(null);
  const [subtitleTracks, setSubtitleTracks] = useState<MediaTrackInfo[]>([]);
  const [currentSubtitleTrack, setCurrentSubtitleTrack] = useState<number>(-1); // -1 = Off

  // Live stream specifics & refs to prevent stale closure
  const [liveSyncPosition, setLiveSyncPosition] = useState<number | null>(null);
  const [liveEdgeDistance, setLiveEdgeDistance] = useState<number>(0);
  const liveSyncPositionRef = useRef<number | null>(null);
  const liveEdgeDistanceRef = useRef(0);

  const lastRecordedTimeRef = useRef<number>(0);

  // M01 — Intelligent source identification (preserves explicit contentType & origin, immune to password/token substrings)
  const identifiedSource = identifyMediaSource({
    url: streamUrl || '',
    contentType: effectiveContentType,
    sourceOrigin: effectiveSourceOrigin,
    sourceMetadata: sourceMetadata ?? null,
    containerExtension: effectiveContainerExtension,
    mimeType: effectiveMimeType,
    directSource: effectiveDirectSource,
    credentials: (credentials as any) || null,
  });

  const inferredContentType: PlayerContentType = identifiedSource.contentType;
  const isLive = inferredContentType === 'live';
  const inferredTransport: PlayerTransport = identifiedSource.transport;

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

    if (suppressLivePreviewVisualMetricsRef.current) {
      return;
    }

    setCurrentTime(cur);
    setDuration(dur);

    const { ranges, ahead } = calculateBufferStats(video);
    setBufferedRanges(ranges);
    setBufferedAhead(ahead);

    if (liveSyncPos !== null) {
      setLiveSyncPosition(liveSyncPos);
      setLiveEdgeDistance(liveDist);
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
      setPendingAudioTrack(-1);
      setAudioTrackFeedback(null);
      setCurrentSubtitleTrack(-1);
      audioTracksRef.current = [];
      subtitleTracksRef.current = [];
      selectedSubtitleTrackIdRef.current = -1;
      pendingAudioRequestRef.current = null;
      lastConfirmedHlsAudioTrackRef.current = null;
      failedHlsAudioTrackRef.current = null;
      audioRequestSeqRef.current += 1;
      syncAudioTracksFnRef.current = null;
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
    const latestCredentials = credentialsRef.current;
    activeAccountRef.current = latestCredentials;
    cleanup();
    resetSessionMetrics();

    const nativeHlsSupported = probeNativeHlsSupport(video);
    const hlsJsSupported = Hls.isSupported();

    const attemptPlan = buildPlaybackAttemptPlan({
      url: streamUrl,
      streamId: effectiveStreamId,
      contentType: effectiveContentType,
      sourceOrigin: effectiveSourceOrigin,
      sourceMetadata: sourceMetadataRef.current,
      containerExtension: effectiveContainerExtension,
      mimeType: effectiveMimeType,
      allowedOutputFormats: allowedOutputFormatsRef.current,
      directSource: effectiveDirectSource,
      credentials: (latestCredentials as any) || null,
      capabilities: {
        hlsJsSupported,
        nativeHlsSupported,
        canPlayType:
          typeof video.canPlayType === 'function'
            ? (mime) => video.canPlayType(mime)
            : undefined,
      },
      isMixedContent: isMixedContentUrl(streamUrl),
    });

    if (attemptPlan.validationError || attemptPlan.attempts.length === 0) {
      const invalidMsg = sanitizePlaybackErrorMessage(
        attemptPlan.validationError?.message || 'Endereço de reprodução inválido.'
      );
      setError(invalidMsg);
      setIsLoading(false);
      setIsBuffering(false);
      onPlaybackFinalErrorRef.current?.(invalidMsg, activeAttemptId);
      return;
    }

    setIsLoading(true);

    // Initial video element setup using current ref values
    video.volume = normalizePlayerVolume(volumeRef.current, 1);
    video.muted = isMutedRef.current;
    video.playbackRate = playbackRateRef.current;

    let mediaRecoveryAttempts = 0;
    let networkRecoveryAttempts = 0;
    let seekApplied = false;
    let fallbackUsed = false;
    let activeEngineAttemptToken = 0;
    let activeAttempt: PlaybackAttemptDescriptor = attemptPlan.attempts[0];
    let isTransitioningEngine = false;
    let detachNativeAttemptListeners: (() => void) | null = null;
    let pendingNativeErrorGraceTimer: ReturnType<typeof setTimeout> | null = null;

    const clearPendingNativeErrorGraceTimer = () => {
      if (pendingNativeErrorGraceTimer !== null) {
        clearTimeout(pendingNativeErrorGraceTimer);
        pendingNativeErrorGraceTimer = null;
      }
    };

    // Helper to apply startAt seek only when media metadata/readyState is ready (M01.b 8.1)
    const applyStartAt = () => {
      if (!seekApplied && startAt > 0 && !isLive && video.readyState >= 1) {
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

    // M01.b 8.2 — Invalidate active attempt token BEFORE any teardown/cleanup operation
    const cleanupEngineAttempt = (resetVideoElement: boolean) => {
      activeEngineAttemptToken += 1;
      clearPendingNativeErrorGraceTimer();

      if (detachNativeAttemptListeners) {
        try {
          detachNativeAttemptListeners();
        } catch {
          // ignore
        }
        detachNativeAttemptListeners = null;
      }

      recoveryTimersRef.current.forEach((t) => clearTimeout(t));
      recoveryTimersRef.current = [];
      pendingAudioRequestRef.current = null;
      setPendingAudioTrack(-1);

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

      if (resetVideoElement) {
        isTransitioningEngine = true;
        try {
          video.pause();
          video.removeAttribute('src');
          video.load();
        } catch {
          // ignore
        } finally {
          isTransitioningEngine = false;
        }
      }
    };

    // M01.b 8.3 — Controlled teardown of video source on terminal error without remounting <video>
    const finalizeFatalError = (classified: PlaybackErrorClassification) => {
      cleanupEngineAttempt(true);
      const safeMsg = sanitizePlaybackErrorMessage(classified.message);
      setError(safeMsg);
      setIsPlaying(false);
      setIsLoading(false);
      setIsBuffering(false);
      reportFinalError(safeMsg);
    };

    let attachAttemptRef: ((attempt: PlaybackAttemptDescriptor) => void) | null = null;

    const handleAttemptFailure = (
      classified: PlaybackErrorClassification,
      attemptToken: number
    ) => {
      if (
        sessionIdRef.current !== currentSessionId ||
        attemptToken !== activeEngineAttemptToken ||
        hasReportedFinalError
      ) {
        return;
      }

      const nextAttempt = selectPlaybackFallbackAttempt({
        plan: attemptPlan,
        currentAttempt: activeAttempt,
        errorClassification: classified,
        hasStartedPlaying: hasReportedSuccess,
        fallbackAlreadyUsed: fallbackUsed,
      });

      if (nextAttempt) {
        fallbackUsed = true;
        cleanupEngineAttempt(true);
        activeAttempt = nextAttempt;
        mediaRecoveryAttempts = 0;
        networkRecoveryAttempts = 0;
        setQualities([]);
        setCurrentQuality(-1);
        setAudioTracks([]);
        audioTracksRef.current = [];
        setCurrentAudioTrack(-1);
        setPendingAudioTrack(-1);
        setAudioTrackFeedback(null);
        lastConfirmedHlsAudioTrackRef.current = null;
        failedHlsAudioTrackRef.current = null;
        setError(null);
        setIsLoading(true);
        setIsBuffering(false);
        attachAttemptRef?.(activeAttempt);
        return;
      }

      finalizeFatalError(classified);
    };

    // Unified Audio Track discovery (HLS.js -> Native HTMLMediaElement.audioTracks)
    const syncAudioTracks = () => {
      if (sessionIdRef.current !== currentSessionId) return;
      const hlsInstance = hlsRef.current;

      if (hlsInstance && Array.isArray(hlsInstance.audioTracks) && hlsInstance.audioTracks.length > 0) {
        const rawList: InternalAudioTrackDescriptor[] = hlsInstance.audioTracks.map((tr, idx) => {
          const hlsTrackId = typeof tr.id === 'number' ? tr.id : idx;
          return {
            id: idx,
            hlsTrackIndex: idx,
            hlsTrackId,
            hlsGroupId: typeof (tr as any).groupId === 'string' ? (tr as any).groupId : undefined,
            hlsUrl: typeof (tr as any).url === 'string' ? (tr as any).url : undefined,
            rawName: typeof tr.name === 'string' ? tr.name : undefined,
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

        const activeHlsIndex =
          typeof hlsInstance.audioTrack === 'number' ? hlsInstance.audioTrack : -1;
        const activePending = pendingAudioRequestRef.current;

        // While an audio switch is pending, NEVER promote hlsInstance.audioTrack to confirmed
        // on an intermediate AUDIO_TRACKS_UPDATED event.
        if (activePending) {
          const matchedPending = findDescriptorByIdentity(disambiguated, activePending);
          if (matchedPending) {
            activePending.trackId = matchedPending.id;
            activePending.targetIndex = matchedPending.hlsTrackIndex ?? matchedPending.id;
            activePending.index = activePending.targetIndex;
            setPendingAudioTrack(matchedPending.id);

            const prevConfirmed = lastConfirmedHlsAudioTrackRef.current;
            if (prevConfirmed) {
              const matchedConfirmed = findDescriptorByIdentity(disambiguated, prevConfirmed);
              if (matchedConfirmed) {
                lastConfirmedHlsAudioTrackRef.current = extractHlsAudioIdentity(matchedConfirmed);
                setCurrentAudioTrack(matchedConfirmed.id);
              } else {
                lastConfirmedHlsAudioTrackRef.current = null;
                setCurrentAudioTrack(-1);
              }
            } else {
              setCurrentAudioTrack(-1);
            }
            return;
          }

          // Pending target disappeared from the updated track list: cancel invalid request cleanly
          pendingAudioRequestRef.current = null;
          setPendingAudioTrack(-1);
          setAudioTrackFeedback(
            'A faixa de áudio solicitada não está mais disponível nesta transmissão.'
          );

          const matchedEngineAfterRemoval = disambiguated.find(
            (t) => t.hlsTrackIndex === activeHlsIndex
          );
          if (matchedEngineAfterRemoval) {
            lastConfirmedHlsAudioTrackRef.current = extractHlsAudioIdentity(
              matchedEngineAfterRemoval
            );
            setCurrentAudioTrack(matchedEngineAfterRemoval.id);
          } else if (lastConfirmedHlsAudioTrackRef.current) {
            const stillConfirmed = findDescriptorByIdentity(
              disambiguated,
              lastConfirmedHlsAudioTrackRef.current
            );
            if (stillConfirmed) {
              lastConfirmedHlsAudioTrackRef.current = extractHlsAudioIdentity(stillConfirmed);
              setCurrentAudioTrack(stillConfirmed.id);
            } else {
              lastConfirmedHlsAudioTrackRef.current = null;
              setCurrentAudioTrack(-1);
            }
          } else {
            lastConfirmedHlsAudioTrackRef.current = null;
            setCurrentAudioTrack(-1);
          }
          return;
        }

        const matchedActive = disambiguated.find((t) => t.hlsTrackIndex === activeHlsIndex);
        if (
          matchedActive &&
          failedHlsAudioTrackRef.current &&
          doesDescriptorMatchIdentity(matchedActive, failedHlsAudioTrackRef.current)
        ) {
          // Do not promote a previously failed target track on a subsequent AUDIO_TRACKS_UPDATED
          setCurrentAudioTrack(-1);
          return;
        }

        if (matchedActive) {
          lastConfirmedHlsAudioTrackRef.current = extractHlsAudioIdentity(matchedActive);
          setCurrentAudioTrack(matchedActive.id);
        } else if (disambiguated.length === 1) {
          lastConfirmedHlsAudioTrackRef.current = extractHlsAudioIdentity(disambiguated[0]);
          setCurrentAudioTrack(disambiguated[0].id);
        } else {
          const defTrack = disambiguated.find((t) => t.isDefault);
          lastConfirmedHlsAudioTrackRef.current = defTrack
            ? extractHlsAudioIdentity(defTrack)
            : null;
          setCurrentAudioTrack(defTrack ? defTrack.id : -1);
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
        if (enabledId !== -1) {
          setCurrentAudioTrack(enabledId);
        } else if (disambiguated.length === 1) {
          setCurrentAudioTrack(disambiguated[0].id);
        } else {
          setCurrentAudioTrack(-1);
        }
        return;
      }

      audioTracksRef.current = [];
      pendingAudioRequestRef.current = null;
      setAudioTracks([]);
      setCurrentAudioTrack(-1);
      setPendingAudioTrack(-1);
    };

    syncAudioTracksFnRef.current = syncAudioTracks;

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

    // Native textTracks & audioTracks dynamic event listeners
    const textTrackList = video.textTracks;
    const nativeAudioList = (video as any).audioTracks;

    const handleNativeTextTracksChange = () => {
      if (sessionIdRef.current !== currentSessionId || isTransitioningEngine) return;
      syncSubtitleTracks();
    };

    const handleNativeAudioTracksChange = () => {
      if (sessionIdRef.current !== currentSessionId || isTransitioningEngine) return;
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

    // M01.b 8.3 — Per-attempt HTMLMediaElement listeners protected by sessionId, attemptToken, and source provenance
    const bindNativeListenersForAttempt = (
      attempt: PlaybackAttemptDescriptor,
      attemptToken: number,
      getExpectedHlsInstance: () => Hls | null
    ): (() => void) => {
      const isAttemptStillActive = (): boolean => {
        if (
          sessionIdRef.current !== currentSessionId ||
          attemptToken !== activeEngineAttemptToken ||
          isTransitioningEngine ||
          hasReportedFinalError
        ) {
          return false;
        }
        if (attempt.engine === 'hls.js') {
          const expectedHls = getExpectedHlsInstance();
          return Boolean(expectedHls && hlsRef.current === expectedHls);
        }
        return video.getAttribute('src') === attempt.url;
      };

      const handlePlaying = () => {
        if (!isAttemptStillActive()) return;
        clearPendingNativeErrorGraceTimer();
        setIsPlaying(true);
        setIsLoading(false);
        setIsBuffering(false);
        reportSuccess();
      };

      const handlePlay = () => {
        if (!isAttemptStillActive()) return;
        setIsPlaying(true);
      };

      const handlePause = () => {
        if (!isAttemptStillActive()) return;
        setIsPlaying(false);
        if (!shouldPublishControlsRef.current && !suppressLivePreviewVisualMetricsRef.current) {
          syncVisualControlsStateFromVideo();
        }
        // M01.b 8.1 — Save progress on pause only after playback genuinely started
        if (hasReportedSuccess && !isLive && effectiveStreamId && video.currentTime > 5) {
          const playbackType: PlaybackType =
            inferredContentType === 'episode' ? 'episode' : 'movie';
          const recorded = recordPlaybackPosition(activeAccountRef.current, {
            id: effectiveStreamId,
            type: playbackType,
            positionSec: video.currentTime,
          });
          if (recorded) {
            lastRecordedTimeRef.current = video.currentTime;
          }
        }
      };

      const handleWaiting = () => {
        if (!isAttemptStillActive()) return;
        setIsBuffering(true);
      };

      const handleTimeUpdate = () => {
        if (!isAttemptStillActive()) return;
        const cur = video.currentTime;
        currentTimeRef.current = cur;

        // M01.b 8.1 — Save progress periodically only after playback genuinely started
        if (hasReportedSuccess && !isLive && effectiveStreamId && cur > 5) {
          if (Math.abs(cur - lastRecordedTimeRef.current) >= 5) {
            const playbackType: PlaybackType =
              inferredContentType === 'episode' ? 'episode' : 'movie';
            const recorded = recordPlaybackPosition(activeAccountRef.current, {
              id: effectiveStreamId,
              type: playbackType,
              positionSec: cur,
            });
            if (recorded) {
              lastRecordedTimeRef.current = cur;
            }
          }
        }

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

        if (suppressLivePreviewVisualMetricsRef.current || !shouldPublishControlsRef.current) {
          return;
        }

        setCurrentTime(cur);

        const { ranges, ahead } = calculateBufferStats(video);
        setBufferedRanges(ranges);
        setBufferedAhead(ahead);

        if (liveSyncPos !== null) {
          setLiveSyncPosition(liveSyncPos);
          setLiveEdgeDistance(liveDist);
        }
      };

      const handleDurationChange = () => {
        if (!isAttemptStillActive()) return;
        const dur = video.duration;
        const normalizedDur = isFinite(dur) && !isNaN(dur) && dur > 0 ? dur : 0;
        durationRef.current = normalizedDur;
        if (!suppressLivePreviewVisualMetricsRef.current && shouldPublishControlsRef.current) {
          setDuration(normalizedDur);
        }
      };

      const handleLoadedMetadataWithTracks = () => {
        if (!isAttemptStillActive()) return;
        setIsLoading(false);
        handleDurationChange();
        applyStartAt();
        video.play().catch(() => {
          if (isAttemptStillActive()) {
            setIsPlaying(false);
          }
        });
        syncAudioTracks();
        syncSubtitleTracks();
      };

      const handleProgress = () => {
        if (!isAttemptStillActive()) return;
        if (suppressLivePreviewVisualMetricsRef.current || !shouldPublishControlsRef.current) {
          return;
        }
        const { ranges, ahead } = calculateBufferStats(video);
        setBufferedRanges(ranges);
        setBufferedAhead(ahead);
      };

      const handleVolumeChange = () => {
        if (
          sessionIdRef.current !== currentSessionId ||
          attemptToken !== activeEngineAttemptToken ||
          isTransitioningEngine
        ) {
          return;
        }
        const safeVol = normalizePlayerVolume(video.volume, volumeRef.current);
        setVolumeState(safeVol);
        setIsMuted(video.muted);
        try {
          localStorage.setItem('nc_player_volume', String(safeVol));
        } catch {}
      };

      const handleRateChange = () => {
        if (
          sessionIdRef.current !== currentSessionId ||
          attemptToken !== activeEngineAttemptToken ||
          isTransitioningEngine
        ) {
          return;
        }
        setPlaybackRateState(video.playbackRate);
      };

      const handleError = () => {
        if (!isAttemptStillActive()) return;
        const mediaErr = video.error;
        if (!mediaErr) return;

        if (attempt.engine === 'hls.js') {
          // M01.b 8.3 — Do not blindly ignore real HTMLMediaElement errors during HLS.js:
          // allow HLS.js a brief guarded grace window to emit Hls.Events.ERROR; if it does not,
          // classify and handle the real element error instead of leaving the player stuck.
          clearPendingNativeErrorGraceTimer();
          const capturedErr = mediaErr;
          pendingNativeErrorGraceTimer = setTimeout(() => {
            pendingNativeErrorGraceTimer = null;
            if (!isAttemptStillActive()) return;
            const activeErr = video.error || capturedErr;
            const classified = classifyNativeMediaError(activeErr, attempt.source);
            handleAttemptFailure(classified, attemptToken);
          }, 250);
          return;
        }

        const classified = classifyNativeMediaError(mediaErr, attempt.source);
        handleAttemptFailure(classified, attemptToken);
      };

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
      };
    };

    // Engine attachment helper: HLS.js vs Native HTML5 / Native HLS (isolated by session + attemptToken)
    const attachAttempt = (attempt: PlaybackAttemptDescriptor) => {
      if (sessionIdRef.current !== currentSessionId) return;
      // M01.b 8.1 — Reset seek state for each attempt so startAt applies cleanly after fallback
      seekApplied = false;
      const attemptToken = ++activeEngineAttemptToken;

      if (attempt.engine === 'hls.js' && Hls.isSupported()) {
        const profileCfg = BUFFER_PROFILES[bufferProfileRef.current];
        const hls = new Hls({
          ...profileCfg.hlsOptions,
          xhrSetup: (xhr) => {
            xhr.withCredentials = false;
          },
        });
        hlsRef.current = hls;

        detachNativeAttemptListeners = bindNativeListenersForAttempt(
          attempt,
          attemptToken,
          () => hls
        );

        hls.loadSource(attempt.url);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
          if (
            sessionIdRef.current !== currentSessionId ||
            attemptToken !== activeEngineAttemptToken ||
            hlsRef.current !== hls
          ) {
            return;
          }
          clearPendingNativeErrorGraceTimer();
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
            if (
              sessionIdRef.current === currentSessionId &&
              attemptToken === activeEngineAttemptToken &&
              hlsRef.current === hls &&
              !isTransitioningEngine
            ) {
              setIsPlaying(false);
            }
          });
        });

        hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
          if (
            sessionIdRef.current !== currentSessionId ||
            attemptToken !== activeEngineAttemptToken ||
            hlsRef.current !== hls
          ) {
            return;
          }
          syncAudioTracks();
        });

        hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
          if (
            sessionIdRef.current !== currentSessionId ||
            attemptToken !== activeEngineAttemptToken ||
            hlsRef.current !== hls
          ) {
            return;
          }
          syncSubtitleTracks();
        });

        hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
          if (
            sessionIdRef.current !== currentSessionId ||
            attemptToken !== activeEngineAttemptToken ||
            hlsRef.current !== hls
          ) {
            return;
          }
          if (hls.autoLevelEnabled) {
            setCurrentQuality(-1);
          } else {
            setCurrentQuality(data.level);
          }
        });

        hls.on(Hls.Events.AUDIO_TRACK_SWITCHING, (_event, data) => {
          if (
            sessionIdRef.current !== currentSessionId ||
            attemptToken !== activeEngineAttemptToken ||
            hlsRef.current !== hls
          ) {
            return;
          }
          const matched = resolveAudioTrackFromEventPayload(data, audioTracksRef.current);
          if (!matched) return;
          const activePending = pendingAudioRequestRef.current;
          if (activePending && !doesDescriptorMatchIdentity(matched, activePending)) {
            // Ignore stale/out-of-order switching event from an older request
            return;
          }
          setPendingAudioTrack(matched.id);
        });

        hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_event, data) => {
          if (
            sessionIdRef.current !== currentSessionId ||
            attemptToken !== activeEngineAttemptToken ||
            hlsRef.current !== hls
          ) {
            return;
          }
          const matched = resolveAudioTrackFromEventPayload(data, audioTracksRef.current);
          const activePending = pendingAudioRequestRef.current;

          if (activePending) {
            if (!matched || !doesDescriptorMatchIdentity(matched, activePending)) {
              // Delayed/out-of-order confirmation for an older track MUST NOT complete a newer request
              return;
            }
            activePending.confirmed = true;
            pendingAudioRequestRef.current = null;
          }

          if (!matched) {
            return;
          }

          failedHlsAudioTrackRef.current = null;
          lastConfirmedHlsAudioTrackRef.current = extractHlsAudioIdentity(matched);
          setPendingAudioTrack(-1);
          setAudioTrackFeedback(null);
          setCurrentAudioTrack(matched.id);
        });

        hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_event, data) => {
          if (
            sessionIdRef.current !== currentSessionId ||
            attemptToken !== activeEngineAttemptToken ||
            hlsRef.current !== hls
          ) {
            return;
          }
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
          if (
            sessionIdRef.current !== currentSessionId ||
            attemptToken !== activeEngineAttemptToken ||
            hlsRef.current !== hls
          ) {
            return;
          }

          clearPendingNativeErrorGraceTimer();

          // Non-fatal audio track loading failures must not kill playback or falsely confirm the switch
          if (
            !data.fatal &&
            (data.details === Hls.ErrorDetails.AUDIO_TRACK_LOAD_ERROR ||
              data.details === Hls.ErrorDetails.AUDIO_TRACK_LOAD_TIMEOUT)
          ) {
            const activePending = pendingAudioRequestRef.current;
            const errorUrl =
              (typeof (data as any)?.url === 'string' && (data as any).url) ||
              (typeof (data as any)?.context?.url === 'string' && (data as any).context.url) ||
              (typeof (data as any)?.frag?.url === 'string' && (data as any).frag.url) ||
              '';

            // If a newer pending request is in flight and this error explicitly identifies an older track URL, ignore it
            if (
              activePending &&
              errorUrl &&
              activePending.hlsUrl &&
              errorUrl !== activePending.hlsUrl &&
              audioTracksRef.current.some((t) => t.hlsUrl === errorUrl)
            ) {
              return;
            }

            if (activePending) {
              failedHlsAudioTrackRef.current = {
                index: activePending.targetIndex,
                hlsTrackId: activePending.hlsTrackId,
                hlsGroupId: activePending.hlsGroupId,
                hlsUrl: activePending.hlsUrl,
                rawName: activePending.rawName,
                lang: activePending.lang,
              };
              pendingAudioRequestRef.current = null;
            }

            setPendingAudioTrack(-1);
            setAudioTrackFeedback('Não foi possível carregar a faixa de áudio selecionada.');

            // Reflect real engine state honestly: only keep previous track confirmed if hls.audioTrack still matches it
            const engineIndex = typeof hls.audioTrack === 'number' ? hls.audioTrack : -1;
            const engineTrack = audioTracksRef.current.find(
              (t) => t.source === 'hls' && t.hlsTrackIndex === engineIndex
            );
            const prevConfirmed = lastConfirmedHlsAudioTrackRef.current;
            if (
              engineTrack &&
              prevConfirmed &&
              doesDescriptorMatchIdentity(engineTrack, prevConfirmed)
            ) {
              setCurrentAudioTrack(engineTrack.id);
            } else {
              lastConfirmedHlsAudioTrackRef.current = null;
              setCurrentAudioTrack(-1);
            }
            return;
          }

          if (data.fatal) {
            const classified = classifyHlsFatalError(data, attempt.source);
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                if (classified.retryable && networkRecoveryAttempts < 3) {
                  networkRecoveryAttempts++;
                  const delayMs = networkRecoveryAttempts * 1000;
                  const timer = setTimeout(() => {
                    if (
                      sessionIdRef.current === currentSessionId &&
                      attemptToken === activeEngineAttemptToken &&
                      hlsRef.current === hls
                    ) {
                      hlsRef.current.startLoad();
                    }
                  }, delayMs);
                  recoveryTimersRef.current.push(timer);
                } else {
                  handleAttemptFailure(classified, attemptToken);
                }
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                if (classified.retryable && mediaRecoveryAttempts < 2) {
                  mediaRecoveryAttempts++;
                  hls.recoverMediaError();
                } else {
                  handleAttemptFailure(classified, attemptToken);
                }
                break;
              default: {
                handleAttemptFailure(classified, attemptToken);
                break;
              }
            }
          }
        });
      } else {
        // Native HTML5 progressive playback or native environment HLS
        detachNativeAttemptListeners = bindNativeListenersForAttempt(
          attempt,
          attemptToken,
          () => null
        );
        video.src = attempt.url;
        video.load();
      }
    };

    attachAttemptRef = attachAttempt;
    attachAttempt(activeAttempt);

    return () => {
      // M01.b 8.1 — Save progress on exit only if VOD/series actually started playing
      if (
        !isLive &&
        effectiveStreamId &&
        hasReportedSuccess &&
        !isTransitioningEngine &&
        video.currentTime > 5
      ) {
        const playbackType: PlaybackType = inferredContentType === 'episode' ? 'episode' : 'movie';
        recordPlaybackPosition(activeAccountRef.current, {
          id: effectiveStreamId,
          type: playbackType,
          positionSec: video.currentTime,
        });
      }

      // M01.b 8.2 — Invalidate active attempt token BEFORE detaching/cleaning up
      attachAttemptRef = null;
      cleanupEngineAttempt(false);

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

      cleanup();
    };
  }, [
    streamUrl,
    retryTrigger,
    accountIdentityKey,
    cleanup,
    isLive,
    effectiveStreamId,
    startAt,
    inferredTransport,
    effectiveContentType,
    effectiveSourceOrigin,
    effectiveContainerExtension,
    effectiveMimeType,
    effectiveDirectSource,
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
    (trackId: number): boolean => {
      const target = audioTracksRef.current.find((t) => t.id === trackId);
      if (!target) {
        return false;
      }

      if (hlsRef.current && target.source === 'hls') {
        const hls = hlsRef.current;
        const liveTracks = Array.isArray(hls.audioTracks) ? hls.audioTracks : [];
        const targetIndex = resolveLiveHlsAudioTrackIndex(liveTracks, target);

        if (targetIndex < 0 || targetIndex >= liveTracks.length) {
          pendingAudioRequestRef.current = null;
          setPendingAudioTrack(-1);
          setAudioTrackFeedback('Faixa de áudio indisponível neste fluxo.');
          syncAudioTracksFnRef.current?.();
          return false;
        }

        if (
          !pendingAudioRequestRef.current &&
          hls.audioTrack === targetIndex &&
          lastConfirmedHlsAudioTrackRef.current !== null &&
          doesDescriptorMatchIdentity(target, lastConfirmedHlsAudioTrackRef.current)
        ) {
          setPendingAudioTrack(-1);
          setAudioTrackFeedback(null);
          setCurrentAudioTrack(target.id);
          return true;
        }

        if (
          pendingAudioRequestRef.current &&
          pendingAudioRequestRef.current.targetIndex === targetIndex &&
          hls.audioTrack === targetIndex &&
          doesDescriptorMatchIdentity(target, pendingAudioRequestRef.current)
        ) {
          // Same target is already pending in flight
          setPendingAudioTrack(target.id);
          return true;
        }

        const request: PendingHlsAudioRequest = {
          requestId: ++audioRequestSeqRef.current,
          trackId: target.id,
          targetIndex,
          index: targetIndex,
          hlsTrackId: target.hlsTrackId,
          hlsGroupId: target.hlsGroupId,
          hlsUrl: target.hlsUrl,
          rawName: target.rawName,
          lang: target.lang,
          confirmed: false,
        };
        pendingAudioRequestRef.current = request;
        failedHlsAudioTrackRef.current = null;
        setAudioTrackFeedback(null);

        try {
          hls.audioTrack = targetIndex;
        } catch {
          pendingAudioRequestRef.current = null;
          setPendingAudioTrack(-1);
          setAudioTrackFeedback('Não foi possível alternar a faixa de áudio nesta transmissão.');
          syncAudioTracksFnRef.current?.();
          return false;
        }

        if (hls.audioTrack !== targetIndex) {
          pendingAudioRequestRef.current = null;
          setPendingAudioTrack(-1);
          setAudioTrackFeedback('Não foi possível alternar a faixa de áudio nesta transmissão.');
          syncAudioTracksFnRef.current?.();
          return false;
        }

        if (!request.confirmed && pendingAudioRequestRef.current === request) {
          setPendingAudioTrack(target.id);
        }
        return true;
      }

      const video = videoRef.current;
      const nativeAudioList = video ? (video as any).audioTracks : null;
      if (
        target.source === 'native' &&
        nativeAudioList &&
        typeof nativeAudioList.length === 'number' &&
        nativeAudioList.length > 0
      ) {
        const targetIndex = target.nativeTrackIndex ?? target.id;
        if (targetIndex < 0 || targetIndex >= nativeAudioList.length) {
          setAudioTrackFeedback('Faixa de áudio indisponível nesta mídia.');
          return false;
        }

        for (let i = 0; i < nativeAudioList.length; i++) {
          try {
            nativeAudioList[i].enabled = i === targetIndex;
          } catch {}
        }

        const targetActuallyEnabled = Boolean(nativeAudioList[targetIndex]?.enabled);
        if (targetActuallyEnabled) {
          setPendingAudioTrack(-1);
          setAudioTrackFeedback(null);
          setCurrentAudioTrack(target.id);
          return true;
        }

        let actualEnabledIndex = -1;
        for (let i = 0; i < nativeAudioList.length; i++) {
          if (nativeAudioList[i]?.enabled) {
            actualEnabledIndex = i;
            break;
          }
        }
        if (actualEnabledIndex !== -1) {
          const actualTrack = audioTracksRef.current.find(
            (t) => t.source === 'native' && t.nativeTrackIndex === actualEnabledIndex
          );
          if (actualTrack) {
            setCurrentAudioTrack(actualTrack.id);
          }
        }
        setPendingAudioTrack(-1);
        setAudioTrackFeedback('O navegador não permitiu alternar a faixa de áudio desta mídia.');
        return false;
      }

      return false;
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
    pendingAudioTrack,
    audioTrackFeedback,
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
