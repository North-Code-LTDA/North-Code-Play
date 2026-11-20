import React, { useState } from 'react';
import {
  ArrowLeft,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Volume1,
  Maximize,
  Minimize,
  Settings,
  SkipBack,
  SkipForward,
  PictureInPicture2,
  Radio,
} from 'lucide-react';
import { PlayerTimeline } from './PlayerTimeline';
import { BufferedTimeRange } from './types';

interface PlayerControlsProps {
  embedded: boolean;
  disableRemoteFocus?: boolean;
  isVisible: boolean;
  title: string;
  channelName?: string;
  programTitle?: string;
  isLive: boolean;
  isPlaying: boolean;
  isLoading: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  bufferedRanges: BufferedTimeRange[];
  volume: number;
  isMuted: boolean;
  isFullscreen: boolean;
  isAtLiveEdge: boolean;
  liveEdgeDistance: number;
  hasActiveSubtitles?: boolean;
  playbackRate?: number;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onSeekBy: (delta: number) => void;
  onSeekToLive: () => void;
  onVolumeChange: (vol: number) => void;
  onToggleMute: () => void;
  onToggleFullscreen: () => void;
  onTogglePiP: () => void;
  onOpenSettings: () => void;
  onOpenAudioSubtitles?: () => void;
  onOpenSpeed?: () => void;
  onBack?: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  onUserInteraction?: () => void;
  hasPiP: boolean;
}

export function formatTime(secs: number): string {
  if (isNaN(secs) || !isFinite(secs) || secs < 0) return '00:00';
  const total = Math.floor(secs);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function parseCenteredTitleParts(
  title: string,
  channelName?: string,
  programTitle?: string,
  isLive?: boolean
): { primary: string; secondary: string | null; isBoldSplit: boolean } {
  if (isLive) {
    const primary = (channelName || title || '').trim();
    const secondary = programTitle && programTitle.trim() !== primary ? programTitle.trim() : null;
    return { primary, secondary, isBoldSplit: Boolean(secondary) };
  }

  const rawTitle = (title || '').trim();
  const dashSeriesMatch = rawTitle.match(/^(.*?)\s+-\s+(S\d+E\d+|E\d+)(?:\s*[-·:]?\s*(.*))?$/i);
  if (dashSeriesMatch) {
    const seriesName = dashSeriesMatch[1].trim();
    const epCode = dashSeriesMatch[2].trim();
    const inlineEpTitle = (dashSeriesMatch[3] || '').trim();
    let epTitle = (programTitle || inlineEpTitle || '').trim();
    if (epTitle) {
      // Remove redundant series name or episode code prefix if present in Xtream episode title
      const escapedSeries = seriesName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const escapedCode = epCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      epTitle = epTitle
        .replace(new RegExp(`^${escapedSeries}\\s*[-·:]?\\s*`, 'i'), '')
        .replace(new RegExp(`^${escapedCode}\\s*[-·:]?\\s*`, 'i'), '')
        .trim();
    }
    const secondary = epTitle ? `${epCode} ${epTitle}` : epCode;
    return { primary: seriesName, secondary, isBoldSplit: true };
  }

  const inlineSeriesMatch = rawTitle.match(/^(.*?)\s+(S\d+E\d+|E\d+)\s+(.+)$/i);
  if (inlineSeriesMatch) {
    return {
      primary: inlineSeriesMatch[1].trim(),
      secondary: `${inlineSeriesMatch[2].trim()} ${inlineSeriesMatch[3].trim()}`,
      isBoldSplit: true,
    };
  }

  if (programTitle && programTitle.trim() && programTitle.trim() !== rawTitle) {
    return {
      primary: rawTitle,
      secondary: programTitle.trim(),
      isBoldSplit: true,
    };
  }

  return { primary: rawTitle, secondary: null, isBoldSplit: false };
}

function Seek10Icon({ direction }: { direction: 'back' | 'forward' }) {
  const isBack = direction === 'back';
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className="nc-player-icon"
      aria-hidden="true"
    >
      {isBack ? (
        <>
          <path
            d="M12 5a7.5 7.5 0 1 1-6.45 3.68"
            stroke="currentColor"
            strokeWidth="1.85"
            strokeLinecap="round"
          />
          <path
            d="M8.5 3.5L5.2 5.4l2.1 3.2"
            stroke="currentColor"
            strokeWidth="1.85"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <>
          <path
            d="M12 5a7.5 7.5 0 1 0 6.45 3.68"
            stroke="currentColor"
            strokeWidth="1.85"
            strokeLinecap="round"
          />
          <path
            d="M15.5 3.5l3.3 1.9-2.1 3.2"
            stroke="currentColor"
            strokeWidth="1.85"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      <text
        x="12"
        y="15.1"
        textAnchor="middle"
        fill="currentColor"
        fontSize="7.4"
        fontWeight="700"
        fontFamily="Inter, system-ui, sans-serif"
      >
        10
      </text>
    </svg>
  );
}

function NextEpisodeRefIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="nc-player-icon" aria-hidden="true">
      <path
        d="M5.5 5.2L15.2 12L5.5 18.8V5.2Z"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinejoin="round"
      />
      <path
        d="M18.5 5.5V18.5"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PrevEpisodeRefIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="nc-player-icon" aria-hidden="true">
      <path
        d="M18.5 5.2L8.8 12L18.5 18.8V5.2Z"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 5.5V18.5"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SubtitlesDialogRefIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="nc-player-icon" aria-hidden="true">
      <path
        d="M4 5.5C4 4.67 4.67 4 5.5 4h13c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5H13l-3.8 3.2c-.48.4-1.2.06-1.2-.57V17H5.5C4.67 17 4 16.33 4 15.5v-10Z"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinejoin="round"
      />
      <path
        d="M7.5 9.25h5M14.5 9.25h2M7.5 12.75h2.5M12 12.75h4.5"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SpeedometerRefIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="nc-player-icon" aria-hidden="true">
      <path
        d="M4.8 17.5a8.5 8.5 0 1 1 14.4 0"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
      />
      <path
        d="M12 13l3.6-3.6"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
      />
      <circle cx="12" cy="13" r="1.5" fill="currentColor" />
    </svg>
  );
}

function FullscreenCornersRefIcon({ isFullscreen }: { isFullscreen: boolean }) {
  if (isFullscreen) {
    return <Minimize className="nc-player-icon stroke-[1.85]" />;
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" className="nc-player-icon" aria-hidden="true">
      <path
        d="M4 9V5.5C4 4.67 4.67 4 5.5 4H9M15 4h3.5C19.33 4 20 4.67 20 5.5V9M20 15v3.5c0 .83-.67 1.5-1.5 1.5H15M9 20H5.5C4.67 20 4 19.33 4 18.5V15"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PlayerControls({
  embedded,
  disableRemoteFocus = false,
  isVisible,
  title,
  channelName,
  programTitle,
  isLive,
  isPlaying,
  isLoading,
  isBuffering,
  currentTime,
  duration,
  bufferedRanges,
  volume,
  isMuted,
  isFullscreen,
  isAtLiveEdge,
  liveEdgeDistance,
  hasActiveSubtitles = false,
  playbackRate = 1,
  onTogglePlay,
  onSeek,
  onSeekBy,
  onSeekToLive,
  onVolumeChange,
  onToggleMute,
  onToggleFullscreen,
  onTogglePiP,
  onOpenSettings,
  onOpenAudioSubtitles,
  onOpenSpeed,
  onBack,
  onNext,
  onPrevious,
  onUserInteraction,
  hasPiP,
}: PlayerControlsProps) {
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [isVolumeGroupFocused, setIsVolumeGroupFocused] = useState(false);

  const effectiveDuration = duration > 0 && isFinite(duration) ? duration : 0;
  const effectiveVolume = isMuted ? 0 : volume;
  const isRemoteMode =
    typeof document !== 'undefined' && document.documentElement.dataset.navMode === 'remote';
  const isVolumeSliderExpanded =
    showVolumeSlider || isVolumeGroupFocused || (isRemoteMode && !disableRemoteFocus);
  const isControlFocusable = isVisible && !disableRemoteFocus;

  const VolumeIcon =
    effectiveVolume === 0 || isMuted
      ? VolumeX
      : effectiveVolume < 0.5
        ? Volume1
        : Volume2;

  const handleControlClick = (e: React.MouseEvent, action: () => void) => {
    e.stopPropagation();
    onUserInteraction?.();
    action();
    if (typeof document !== 'undefined' && document.documentElement.dataset.navMode !== 'remote') {
      try {
        (e.currentTarget as HTMLElement)?.blur();
      } catch {}
    }
  };

  const stopProp = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  // Preserve the compact embedded Live TV preview layout untouched
  if (embedded) {
    return (
      <div
        data-nav-ignore={disableRemoteFocus ? 'true' : undefined}
        onFocusCapture={() => onUserInteraction?.()}
        className="absolute inset-0 z-20 pointer-events-none overflow-hidden select-none"
      >
        {/* Top Header Bar (Embedded Preview) */}
        <div
          data-nav-row="player-top"
          className={`absolute top-0 left-0 right-0 z-20 w-full bg-gradient-to-b from-black/85 via-black/40 to-transparent flex items-center justify-between transition-all duration-300 ${
            isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none invisible'
          } p-2 sm:p-2.5`}
          onClick={stopProp}
          onPointerDown={stopProp}
          aria-hidden={!isVisible}
        >
          <div className="flex items-center gap-2 min-w-0 max-w-[75%]">
            {onBack && (
              <button
                type="button"
                data-player-control="back"
                data-player-primary="true"
                onClick={(e) => handleControlClick(e, onBack)}
                tabIndex={isControlFocusable ? 0 : -1}
                className="bg-white/10 hover:bg-white/20 active:scale-95 backdrop-blur-md rounded-full text-white transition-all cursor-pointer shrink-0 p-1.5"
                title="Voltar"
                aria-label="Voltar"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}

            <div className="min-w-0 flex flex-col">
              <div className="flex items-center gap-1.5">
                {isLive && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold bg-nc-primary text-black shrink-0 uppercase tracking-wider">
                    <span className="w-1.5 h-1.5 rounded-full bg-black animate-pulse" />
                    AO VIVO
                  </span>
                )}
                <h2 className="font-bold text-white truncate text-xs sm:text-sm">
                  {channelName || title}
                </h2>
              </div>
              {programTitle && (
                <p className="text-[10px] sm:text-xs text-nc-text-secondary truncate mt-0.5">
                  {programTitle}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              data-player-control="settings"
              onClick={(e) => handleControlClick(e, onOpenSettings)}
              tabIndex={isControlFocusable ? 0 : -1}
              className="bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-xl text-white transition-colors cursor-pointer p-1.5"
              title="Configurações de Reprodução"
              aria-label="Configurações de Reprodução"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Center Buffering / Loading Indicator */}
        {(isBuffering || isLoading) && (
          <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
            <div className="flex flex-col items-center justify-center p-3 bg-black/60 backdrop-blur-sm rounded-2xl pointer-events-none select-none">
              <div className="w-8 h-8 border-2 border-nc-primary border-t-transparent rounded-full animate-spin mb-2" />
              <span className="text-[11px] text-white font-medium">Carregando...</span>
            </div>
          </div>
        )}

        {/* Center Play Button on Pause */}
        {!isPlaying && !isLoading && !isBuffering && (
          <div
            className={`absolute inset-0 z-10 flex items-center justify-center pointer-events-none transition-all duration-300 ${
              isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none invisible'
            }`}
            aria-hidden={!isVisible}
          >
            <button
              type="button"
              onClick={(e) => handleControlClick(e, onTogglePlay)}
              tabIndex={-1}
              className="bg-white/15 hover:bg-white/25 active:scale-95 backdrop-blur-md rounded-full text-white transition-all shadow-2xl pointer-events-auto cursor-pointer p-3 sm:p-3.5"
              title="Reproduzir"
              aria-label="Reproduzir no centro"
            >
              <Play className="w-5 h-5 fill-white translate-x-0.5" />
            </button>
          </div>
        )}

        {/* Bottom Controls Bar (Embedded Preview) */}
        <div
          className={`absolute bottom-0 left-0 right-0 z-20 w-full bg-gradient-to-t from-black/90 via-black/50 to-transparent flex flex-col gap-1 transition-all duration-300 ${
            isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none invisible'
          } px-2.5 pb-2 pt-3`}
          onClick={stopProp}
          onPointerDown={stopProp}
          aria-hidden={!isVisible}
        >
          <PlayerTimeline
            embedded={true}
            currentTime={currentTime}
            duration={effectiveDuration}
            bufferedRanges={bufferedRanges}
            isLive={isLive}
            liveEdgeDistance={liveEdgeDistance}
            isVisible={isControlFocusable}
            onSeek={onSeek}
            onUserInteraction={onUserInteraction}
            formatTime={formatTime}
          />

          <div
            data-nav-row="player-bottom"
            className="flex items-center justify-between text-white text-xs select-none"
          >
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                data-player-control="play-pause"
                data-player-primary="true"
                data-autofocus={disableRemoteFocus ? undefined : 'true'}
                onClick={(e) => handleControlClick(e, onTogglePlay)}
                tabIndex={isControlFocusable ? 0 : -1}
                className="p-1.5 hover:bg-white/10 rounded-xl transition-colors cursor-pointer text-white"
                title={isPlaying ? 'Pausar (Espaço/K)' : 'Reproduzir (Espaço/K)'}
                aria-label={isPlaying ? 'Pausar' : 'Reproduzir'}
              >
                {isPlaying ? (
                  <Pause className="w-4 h-4 fill-white" />
                ) : (
                  <Play className="w-4 h-4 fill-white translate-x-0.5" />
                )}
              </button>

              <div
                className="relative flex items-center gap-1"
                onMouseEnter={() => setShowVolumeSlider(true)}
                onMouseLeave={() => setShowVolumeSlider(false)}
                onFocusCapture={() => setIsVolumeGroupFocused(true)}
                onBlurCapture={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    setIsVolumeGroupFocused(false);
                  }
                }}
                onClick={stopProp}
              >
                <button
                  type="button"
                  data-player-control="mute"
                  onClick={(e) => handleControlClick(e, onToggleMute)}
                  tabIndex={isControlFocusable ? 0 : -1}
                  className="hover:bg-white/10 rounded-xl transition-colors cursor-pointer text-white p-1.5"
                  title={isMuted ? 'Ativar Som (M)' : 'Mudo (M)'}
                  aria-label={isMuted ? 'Ativar Som' : 'Silenciar'}
                >
                  <VolumeIcon className="w-4 h-4" />
                </button>

                <div
                  className={`transition-all duration-200 overflow-hidden flex items-center px-1 ${
                    isVolumeSliderExpanded
                      ? 'w-14 opacity-100'
                      : 'w-0 opacity-0 pointer-events-none invisible'
                  }`}
                  onClick={stopProp}
                  onPointerDown={stopProp}
                >
                  <input
                    type="range"
                    data-player-control="volume-slider"
                    aria-label="Volume"
                    min={0}
                    max={1}
                    step={0.05}
                    value={effectiveVolume}
                    tabIndex={isControlFocusable && isVolumeSliderExpanded ? 0 : -1}
                    onChange={(e) => {
                      e.stopPropagation();
                      onUserInteraction?.();
                      onVolumeChange(parseFloat(e.target.value));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                        e.preventDefault();
                        e.stopPropagation();
                        onUserInteraction?.();
                        const delta = e.key === 'ArrowRight' ? 0.05 : -0.05;
                        const nextVol = Math.max(
                          0,
                          Math.min(1, Number((effectiveVolume + delta).toFixed(2)))
                        );
                        onVolumeChange(nextVol);
                      }
                    }}
                    className="nc-player-volume-slider w-full h-1.5 bg-white/30 rounded-lg appearance-none cursor-pointer accent-nc-primary"
                    title="Ajustar Volume"
                  />
                </div>
              </div>

              {isLive && (
                <div className="flex items-center gap-1.5 text-xs font-mono ml-1 text-gray-300">
                  <button
                    type="button"
                    data-player-control="live-edge"
                    onClick={(e) => handleControlClick(e, onSeekToLive)}
                    disabled={isAtLiveEdge}
                    tabIndex={isControlFocusable && !isAtLiveEdge ? 0 : -1}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold transition-all ${
                      isAtLiveEdge
                        ? 'bg-nc-primary/20 text-nc-primary cursor-default'
                        : 'bg-white/20 text-white hover:bg-white/30 cursor-pointer animate-pulse'
                    }`}
                  >
                    <Radio className="w-3 h-3" />
                    <span>{isAtLiveEdge ? 'DIRETO' : 'IR PARA AO VIVO'}</span>
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-1">
              {hasPiP && (
                <button
                  type="button"
                  data-player-control="pip"
                  onClick={(e) => handleControlClick(e, onTogglePiP)}
                  tabIndex={isControlFocusable ? 0 : -1}
                  className="p-1.5 hover:bg-white/10 rounded-xl transition-colors cursor-pointer text-white"
                  title="Picture-in-Picture"
                  aria-label="Picture-in-Picture"
                >
                  <PictureInPicture2 className="w-4 h-4" />
                </button>
              )}

              <button
                type="button"
                data-player-control="fullscreen"
                onClick={(e) => handleControlClick(e, onToggleFullscreen)}
                tabIndex={isControlFocusable ? 0 : -1}
                className="p-1.5 hover:bg-white/10 rounded-xl transition-colors cursor-pointer text-white"
                title={isFullscreen ? 'Sair da Tela Cheia (F)' : 'Tela Cheia (F)'}
                aria-label={isFullscreen ? 'Sair da Tela Cheia' : 'Tela Cheia'}
              >
                {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Full-layer / Fullscreen Player (High-fidelity to Reference Images 1 & 2)
  const centerTitleParts = parseCenteredTitleParts(title, channelName, programTitle, isLive);

  return (
    <div
      data-nav-ignore={disableRemoteFocus ? 'true' : undefined}
      onFocusCapture={() => onUserInteraction?.()}
      className="absolute inset-0 z-20 pointer-events-none overflow-hidden select-none"
    >
      {/* Top Scrim & Controls Bar (Back on top-left, discrete technical access on top-right, NO title duplication) */}
      <div
        data-nav-row="player-top"
        className={`absolute top-0 left-0 right-0 z-20 w-full nc-player-top-scrim flex items-center justify-between transition-all duration-300 ${
          isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none invisible'
        } px-4 pt-3.5 pb-6 sm:px-7 sm:pt-5 sm:pb-8 nc-safe-player-top`}
        onClick={stopProp}
        onPointerDown={stopProp}
        aria-hidden={!isVisible}
      >
        <div className="flex items-center">
          {onBack && (
            <button
              type="button"
              data-player-control="back"
              data-player-primary="true"
              onClick={(e) => handleControlClick(e, onBack)}
              tabIndex={isControlFocusable ? 0 : -1}
              className="nc-player-ctrl-btn text-white/95 hover:text-white"
              title="Voltar"
              aria-label="Voltar"
            >
              <ArrowLeft className="nc-player-icon stroke-[1.9]" />
            </button>
          )}
        </div>

        {/* Top-Right Discrete Settings Control */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          <button
            type="button"
            data-player-control="settings"
            onClick={(e) => handleControlClick(e, onOpenSettings)}
            tabIndex={isControlFocusable ? 0 : -1}
            className="nc-player-ctrl-btn text-white/80 hover:text-white"
            title="Configurações de Reprodução"
            aria-label="Configurações de Reprodução"
          >
            <Settings className="nc-player-icon stroke-[1.75] scale-90" />
          </button>
        </div>
      </div>

      {/* Center Buffering / Loading Indicator */}
      {(isBuffering || isLoading) && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center justify-center p-4 bg-black/55 backdrop-blur-sm rounded-2xl pointer-events-none select-none animate-in fade-in duration-200">
            <div
              data-player-spinner="true"
              className="w-9 h-9 border-2 border-nc-primary border-t-transparent rounded-full animate-spin mb-2"
            />
            <span className="text-xs text-white/90 font-medium">Carregando...</span>
          </div>
        </div>
      )}

      {/* Bottom Scrim, Timeline & Control Row */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-20 w-full nc-player-bottom-scrim flex flex-col gap-1 sm:gap-2 transition-all duration-300 ${
          isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none invisible'
        } px-3 pb-3 pt-8 sm:px-7 sm:pb-5 sm:pt-12 nc-safe-player-bottom`}
        onClick={stopProp}
        onPointerDown={stopProp}
        aria-hidden={!isVisible}
      >
        {/* Reference Timeline immediately above the bottom button bar */}
        <PlayerTimeline
          embedded={false}
          currentTime={currentTime}
          duration={effectiveDuration}
          bufferedRanges={bufferedRanges}
          isLive={isLive}
          liveEdgeDistance={liveEdgeDistance}
          isVisible={isControlFocusable}
          onSeek={onSeek}
          onUserInteraction={onUserInteraction}
          formatTime={formatTime}
        />

        {/* Reference Bottom Row: 3-column grid on desktop/TV/landscape, stacked rows on mobile portrait */}
        <div
          data-nav-row="player-bottom"
          className="nc-player-bottom-layout text-white select-none"
        >
          {/* Left Group: Play/Pause, Seek -10s, Seek +10s, Volume */}
          <div
            data-player-group="left"
            className="nc-player-left-group"
          >
            {/* 1. Play/Pause */}
            <button
              type="button"
              data-player-control="play-pause"
              data-player-primary="true"
              data-autofocus={disableRemoteFocus ? undefined : 'true'}
              onClick={(e) => handleControlClick(e, onTogglePlay)}
              tabIndex={isControlFocusable ? 0 : -1}
              className="nc-player-ctrl-btn"
              title={isPlaying ? 'Pausar (Espaço/K)' : 'Reproduzir (Espaço/K)'}
              aria-label={isPlaying ? 'Pausar' : 'Reproduzir'}
            >
              {isPlaying ? (
                <Pause className="nc-player-icon fill-white stroke-[1.5]" />
              ) : (
                <Play className="nc-player-icon fill-white stroke-[1.5] translate-x-[1px]" />
              )}
            </button>

            {/* 2. Seek 10s Backward (VOD / Series only) */}
            {!isLive && (
              <button
                type="button"
                data-player-control="seek-back"
                onClick={(e) => handleControlClick(e, () => onSeekBy(-10))}
                tabIndex={isControlFocusable ? 0 : -1}
                className="nc-player-ctrl-btn"
                title="Retroceder 10 segundos"
                aria-label="Retroceder 10 segundos"
              >
                <Seek10Icon direction="back" />
              </button>
            )}

            {/* 3. Seek 10s Forward (VOD / Series only) */}
            {!isLive && (
              <button
                type="button"
                data-player-control="seek-forward"
                onClick={(e) => handleControlClick(e, () => onSeekBy(10))}
                tabIndex={isControlFocusable ? 0 : -1}
                className="nc-player-ctrl-btn"
                title="Avançar 10 segundos"
                aria-label="Avançar 10 segundos"
              >
                <Seek10Icon direction="forward" />
              </button>
            )}

            {/* 4. Volume / Mute + Contextual Slider */}
            <div
              className="relative flex items-center gap-1"
              onMouseEnter={() => setShowVolumeSlider(true)}
              onMouseLeave={() => setShowVolumeSlider(false)}
              onFocusCapture={() => setIsVolumeGroupFocused(true)}
              onBlurCapture={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  setIsVolumeGroupFocused(false);
                }
              }}
              onClick={stopProp}
            >
              <button
                type="button"
                data-player-control="mute"
                onClick={(e) => handleControlClick(e, onToggleMute)}
                tabIndex={isControlFocusable ? 0 : -1}
                className="nc-player-ctrl-btn"
                title={isMuted ? 'Ativar Som (M)' : 'Silenciar (M)'}
                aria-label={isMuted ? 'Ativar Som' : 'Silenciar'}
              >
                <VolumeIcon className="nc-player-icon stroke-[1.85]" />
              </button>

              <div
                className={`transition-all duration-200 overflow-hidden flex items-center px-1 ${
                  isVolumeSliderExpanded
                    ? 'w-16 sm:w-24 opacity-100'
                    : 'w-0 opacity-0 pointer-events-none invisible'
                }`}
                onClick={stopProp}
                onPointerDown={stopProp}
              >
                <input
                  type="range"
                  data-player-control="volume-slider"
                  aria-label="Volume"
                  min={0}
                  max={1}
                  step={0.05}
                  value={effectiveVolume}
                  tabIndex={isControlFocusable && isVolumeSliderExpanded ? 0 : -1}
                  onChange={(e) => {
                    e.stopPropagation();
                    onUserInteraction?.();
                    onVolumeChange(parseFloat(e.target.value));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                      e.preventDefault();
                      e.stopPropagation();
                      onUserInteraction?.();
                      const delta = e.key === 'ArrowRight' ? 0.05 : -0.05;
                      const nextVol = Math.max(
                        0,
                        Math.min(1, Number((effectiveVolume + delta).toFixed(2)))
                      );
                      onVolumeChange(nextVol);
                    }
                  }}
                  className="nc-player-volume-slider w-full h-1 bg-white/35 rounded-lg appearance-none cursor-pointer accent-nc-primary"
                  title="Ajustar Volume"
                />
              </div>
            </div>

            {/* Live Edge Indicator / Action when Live */}
            {isLive && (
              <button
                type="button"
                data-player-control="live-edge"
                onClick={(e) => handleControlClick(e, onSeekToLive)}
                disabled={isAtLiveEdge}
                tabIndex={isControlFocusable && !isAtLiveEdge ? 0 : -1}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wider uppercase transition-all ml-1 shrink-0 ${
                  isAtLiveEdge
                    ? 'bg-nc-primary text-black cursor-default'
                    : 'bg-white/20 text-white hover:bg-white/30 cursor-pointer animate-pulse'
                }`}
                title={isAtLiveEdge ? 'Sincronizado ao vivo' : 'Voltar ao vivo'}
              >
                <span
                  data-player-live-dot="true"
                  className={`w-2 h-2 rounded-full ${
                    isAtLiveEdge ? 'bg-black animate-pulse' : 'bg-nc-primary'
                  }`}
                />
                <span>{isAtLiveEdge ? 'AO VIVO' : 'IR AO VIVO'}</span>
              </button>
            )}
          </div>

          {/* Center: Truly Centered Content Title */}
          <div
            data-player-center-title="true"
            className="nc-player-title-cell"
          >
            <div className="nc-player-center-title truncate">
              {centerTitleParts.isBoldSplit ? (
                <>
                  <span data-player-title-primary="true" className="font-bold text-white">
                    {centerTitleParts.primary}
                  </span>
                  {centerTitleParts.secondary && (
                    <span
                      data-player-title-secondary="true"
                      className="font-normal text-white/90 ml-2"
                    >
                      {centerTitleParts.secondary}
                    </span>
                  )}
                </>
              ) : (
                <span data-player-title-primary="true" className="font-semibold text-white">
                  {centerTitleParts.primary}
                </span>
              )}
            </div>
          </div>

          {/* Right Group: Contextual Episode Controls + PiP + Audio & Subtitles + Speed + Fullscreen */}
          <div
            data-player-group="right"
            className="nc-player-right-group"
          >
            {/* Previous Episode (only when available) */}
            {onPrevious && (
              <button
                type="button"
                data-player-control="previous"
                onClick={(e) => handleControlClick(e, onPrevious)}
                tabIndex={isControlFocusable ? 0 : -1}
                className="nc-player-ctrl-btn"
                title="Episódio Anterior"
                aria-label="Episódio Anterior"
              >
                <PrevEpisodeRefIcon />
              </button>
            )}

            {/* Next Episode (only when available, matching Image 1) */}
            {onNext && (
              <button
                type="button"
                data-player-control="next"
                onClick={(e) => handleControlClick(e, onNext)}
                tabIndex={isControlFocusable ? 0 : -1}
                className="nc-player-ctrl-btn"
                title="Próximo Episódio"
                aria-label="Próximo Episódio"
              >
                <NextEpisodeRefIcon />
              </button>
            )}

            {/* Picture-in-Picture (only when supported) */}
            {hasPiP && (
              <button
                type="button"
                data-player-control="pip"
                onClick={(e) => handleControlClick(e, onTogglePiP)}
                tabIndex={isControlFocusable ? 0 : -1}
                className="nc-player-ctrl-btn"
                title="Picture-in-Picture"
                aria-label="Picture-in-Picture"
              >
                <PictureInPicture2 className="nc-player-icon stroke-[1.85]" />
              </button>
            )}

            {/* Audio & Subtitles (Direct access to Cycle 12.29-a menu, matching Images 1 & 2) */}
            <button
              type="button"
              data-player-control="audio-subtitles"
              onClick={(e) =>
                handleControlClick(e, onOpenAudioSubtitles || onOpenSettings)
              }
              tabIndex={isControlFocusable ? 0 : -1}
              className="nc-player-ctrl-btn relative"
              title="Áudio e Legendas"
              aria-label="Áudio e Legendas"
            >
              <SubtitlesDialogRefIcon />
              {hasActiveSubtitles && (
                <span
                  data-player-subtitles-active-dot="true"
                  className="absolute bottom-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-nc-primary"
                />
              )}
            </button>

            {/* Playback Speed (VOD / Series only, matching Images 1 & 2; hidden on Live TV) */}
            {!isLive && (
              <button
                type="button"
                data-player-control="speed"
                onClick={(e) =>
                  handleControlClick(e, onOpenSpeed || onOpenSettings)
                }
                tabIndex={isControlFocusable ? 0 : -1}
                className="nc-player-ctrl-btn relative"
                title={`Velocidade de Reprodução (${playbackRate === 1 ? 'Normal' : `${playbackRate}x`})`}
                aria-label="Velocidade de Reprodução"
              >
                <SpeedometerRefIcon />
              </button>
            )}

            {/* Fullscreen */}
            <button
              type="button"
              data-player-control="fullscreen"
              onClick={(e) => handleControlClick(e, onToggleFullscreen)}
              tabIndex={isControlFocusable ? 0 : -1}
              className="nc-player-ctrl-btn"
              title={isFullscreen ? 'Sair da Tela Cheia (F)' : 'Tela Cheia (F)'}
              aria-label={isFullscreen ? 'Sair da Tela Cheia' : 'Tela Cheia'}
            >
              <FullscreenCornersRefIcon isFullscreen={isFullscreen} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
