import type React from 'react';

export type PlayerContentType = 'live' | 'movie' | 'episode';
export type PlayerTransport = 'hls' | 'progressive' | 'unknown';
export type BufferProfileKey = 'balanced' | 'stability' | 'lowLatency';

export interface QualityLevel {
  id: number;
  height: number;
  width: number;
  bitrate: number;
  name: string;
}

export interface MediaTrackInfo {
  id: number;
  name: string;
  lang?: string;
}

export interface BufferedTimeRange {
  start: number;
  end: number;
}

export interface PlaybackStats {
  width?: number;
  height?: number;
  duration?: number;
  currentTime?: number;
  bufferedAhead?: number;
  bufferedRanges?: BufferedTimeRange[];
  droppedFrames?: number;
  currentBitrate?: number;
  networkState?: number;
  readyState?: number;
  rebufferingCount: number;
  liveLatency?: number;
}

export interface VideoPlayerProps {
  key?: React.Key;
  streamUrl?: string;
  title: string;
  contentType?: PlayerContentType;
  channelName?: string;
  programTitle?: string;
  onBack: () => void;
  embedded?: boolean;
  startAt?: number;
  streamId?: string | number;
  onNext?: () => void;
  onPrevious?: () => void;
  isLoading?: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
}
