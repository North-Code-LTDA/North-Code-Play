import type React from 'react';
import type {
  PlaybackSourceOrigin,
  PlaybackSourceMetadata,
} from '../../utils/mediaUtils';

export type { PlaybackSourceOrigin, PlaybackSourceMetadata };

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

export type MediaTrackSource = 'hls' | 'native' | 'external';

export interface ExternalSubtitleTrackInput {
  id?: string | number;
  url: string;
  lang?: string;
  label?: string;
  format?: 'vtt' | 'srt' | 'unknown';
  isDefault?: boolean;
  forced?: boolean;
}

export type OnPlayMediaHandler = (
  url: string,
  title: string,
  startAt?: number,
  streamId?: string | number,
  contentType?: PlayerContentType,
  channelName?: string,
  programTitle?: string,
  onNext?: () => void,
  onPrevious?: () => void,
  externalSubtitles?: ExternalSubtitleTrackInput[],
  sourceMetadata?: PlaybackSourceMetadata
) => void;

export interface MediaTrackInfo {
  id: number;
  name: string;
  lang?: string;
  source?: MediaTrackSource;
  hlsTrackId?: number;
  hlsTrackIndex?: number;
  nativeTrackIndex?: number;
  externalUrl?: string;
  format?: 'vtt' | 'srt' | 'unknown';
  channels?: string;
  codec?: string;
  isDefault?: boolean;
  forced?: boolean;
}

export interface BufferedTimeRange {
  start: number;
  end: number;
}

export interface VideoPlayerHandle {
  requestFullscreenImmediate: () => Promise<boolean>;
  exitFullscreenImmediate: () => Promise<boolean>;
  isFullscreenOrPending: () => boolean;
}

export interface VideoPlayerProps {
  key?: React.Key;
  ref?: React.Ref<VideoPlayerHandle>;
  playerRef?: React.Ref<VideoPlayerHandle>;
  streamUrl?: string;
  title: string;
  contentType?: PlayerContentType;
  containerExtension?: string | null;
  mimeType?: string | null;
  allowedOutputFormats?: string[] | null;
  directSource?: string | null;
  sourceOrigin?: PlaybackSourceOrigin;
  sourceMetadata?: PlaybackSourceMetadata | null;
  channelName?: string;
  programTitle?: string;
  onBack: () => void;
  embedded?: boolean;
  liteLivePreview?: boolean;
  disableEmbeddedControlsFocus?: boolean;
  startAt?: number;
  streamId?: string | number;
  attemptTrigger?: number;
  fullscreenRequestTrigger?: number;
  onNext?: () => void;
  onPrevious?: () => void;
  isLoading?: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
  onPlaybackSuccess?: (attemptId?: number) => void;
  onPlaybackFinalError?: (errorMessage: string, attemptId?: number) => void;
  externalSubtitles?: ExternalSubtitleTrackInput[];
}



