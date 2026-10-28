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
  Wrench,
  SkipBack,
  SkipForward,
  PictureInPicture2,
  Radio,
} from 'lucide-react';
import { PlayerTimeline } from './PlayerTimeline';
import { BufferedTimeRange } from './types';

interface PlayerControlsProps {
  embedded: boolean;
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
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onSeekBy: (delta: number) => void;
  onSeekToLive: () => void;
  onVolumeChange: (vol: number) => void;
  onToggleMute: () => void;
  onToggleFullscreen: () => void;
  onTogglePiP: () => void;
  onOpenSettings: () => void;
  onOpenDiagnostics: () => void;
  onBack: () => void;
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

export function PlayerControls({
  embedded,
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
  onTogglePlay,
  onSeek,
  onSeekBy,
  onSeekToLive,
  onVolumeChange,
  onToggleMute,
  onToggleFullscreen,
  onTogglePiP,
  onOpenSettings,
  onOpenDiagnostics,
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
  const isVolumeSliderExpanded = showVolumeSlider || isVolumeGroupFocused || isRemoteMode;

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

  return (
    <div
      onFocusCapture={() => onUserInteraction?.()}
      className="absolute inset-0 z-20 pointer-events-none overflow-hidden select-none"
    >
      {/* Top Header Bar */}
      <div
        data-nav-row="player-top"
        className={`absolute top-0 left-0 right-0 z-20 w-full bg-gradient-to-b from-black/85 via-black/40 to-transparent flex items-center justify-between transition-all duration-300 ${
          isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none invisible'
        } ${embedded ? 'p-2.5 sm:p-3' : 'p-4 sm:p-6'}`}
        onClick={stopProp}
        onPointerDown={stopProp}
        aria-hidden={!isVisible}
      >
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 max-w-[75%]">
          {onBack && (
            <button
              type="button"
              data-player-control="back"
              data-player-primary="true"
              onClick={(e) => handleControlClick(e, onBack)}
              tabIndex={isVisible ? 0 : -1}
              className={`bg-white/10 hover:bg-white/20 active:scale-95 backdrop-blur-md rounded-full text-white transition-all cursor-pointer shrink-0 ${
                embedded ? 'p-1.5' : 'p-2 sm:p-2.5'
              }`}
              title="Voltar"
              aria-label="Voltar"
            >
              <ArrowLeft className={embedded ? 'w-4 h-4' : 'w-5 h-5 sm:w-6 sm:h-6'} />
            </button>
          )}

          <div className="min-w-0 flex flex-col">
            <div className="flex items-center gap-1.5 sm:gap-2">
              {isLive && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold bg-nc-primary text-black shrink-0 uppercase tracking-wider">
                  <span className="w-1.5 h-1.5 rounded-full bg-black animate-pulse" />
                  AO VIVO
                </span>
              )}
              <h2
                className={`font-bold text-white truncate ${
                  embedded ? 'text-xs sm:text-sm' : 'text-sm sm:text-lg'
                }`}
              >
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

        {/* Top Right Actions (Diagnostics & Settings) */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            type="button"
            data-player-control="diagnostics"
            onClick={(e) => handleControlClick(e, onOpenDiagnostics)}
            tabIndex={isVisible ? 0 : -1}
            className={`bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-xl text-white transition-colors cursor-pointer flex items-center gap-1 text-xs ${
              embedded ? 'p-1.5 px-2' : 'px-2.5 py-2'
            }`}
            title="Diagnóstico da Conexão Direta"
            aria-label="Diagnóstico da Conexão Direta"
          >
            <Wrench className="w-3.5 h-3.5 text-nc-primary" />
            <span className={embedded ? 'hidden' : 'hidden sm:inline'}>Diagnóstico</span>
          </button>

          <button
            type="button"
            data-player-control="settings"
            onClick={(e) => handleControlClick(e, onOpenSettings)}
            tabIndex={isVisible ? 0 : -1}
            className={`bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-xl text-white transition-colors cursor-pointer ${
              embedded ? 'p-1.5' : 'p-2'
            }`}
            title="Configurações de Reprodução"
            aria-label="Configurações de Reprodução"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Center Buffering / Loading Indicator (Independent of Bars Visibility) */}
      {(isBuffering || isLoading) && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <div
            className="flex flex-col items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm rounded-2xl pointer-events-none select-none animate-in fade-in duration-200"
          >
            <div className="w-8 h-8 sm:w-10 sm:h-10 border-2 sm:border-3 border-nc-primary border-t-transparent rounded-full animate-spin mb-2" />
            <span className="text-[11px] sm:text-xs text-white font-medium">Carregando...</span>
          </div>
        </div>
      )}

      {/* Center Play Button (Visible on Pause for mouse/touch click; D-pad uses bottom bar Play/Pause) */}
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
            className={`bg-white/15 hover:bg-white/25 active:scale-95 backdrop-blur-md rounded-full text-white transition-all shadow-2xl pointer-events-auto cursor-pointer ${
              embedded ? 'p-3.5 sm:p-4' : 'p-5 sm:p-6'
            }`}
            title="Reproduzir"
            aria-label="Reproduzir no centro"
          >
            <Play className={`${embedded ? 'w-6 h-6' : 'w-8 h-8 sm:w-10 sm:h-10'} fill-white translate-x-0.5`} />
          </button>
        </div>
      )}

      {/* Bottom Controls Bar */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-20 w-full bg-gradient-to-t from-black/90 via-black/50 to-transparent flex flex-col gap-1.5 transition-all duration-300 ${
          isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none invisible'
        } ${embedded ? 'px-3 pb-2.5 pt-4' : 'px-4 pb-4 sm:px-6 sm:pb-6 pt-8'}`}
        onClick={stopProp}
        onPointerDown={stopProp}
        aria-hidden={!isVisible}
      >
        {/* Timeline */}
        <PlayerTimeline
          currentTime={currentTime}
          duration={effectiveDuration}
          bufferedRanges={bufferedRanges}
          isLive={isLive}
          liveEdgeDistance={liveEdgeDistance}
          isVisible={isVisible}
          onSeek={onSeek}
          onUserInteraction={onUserInteraction}
          formatTime={formatTime}
        />

        {/* Buttons Row */}
        <div
          data-nav-row="player-bottom"
          className="flex items-center justify-between text-white text-xs select-none"
        >
          {/* Left Group */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Play/Pause */}
            <button
              type="button"
              data-player-control="play-pause"
              data-player-primary="true"
              data-autofocus="true"
              onClick={(e) => handleControlClick(e, onTogglePlay)}
              tabIndex={isVisible ? 0 : -1}
              className="p-2 hover:bg-white/10 rounded-xl transition-colors cursor-pointer text-white"
              title={isPlaying ? 'Pausar (Espaço/K)' : 'Reproduzir (Espaço/K)'}
              aria-label={isPlaying ? 'Pausar' : 'Reproduzir'}
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 fill-white" />
              ) : (
                <Play className="w-5 h-5 fill-white translate-x-0.5" />
              )}
            </button>

            {/* Previous Episode (if series) */}
            {onPrevious && (
              <button
                type="button"
                data-player-control="previous"
                onClick={(e) => handleControlClick(e, onPrevious)}
                tabIndex={isVisible ? 0 : -1}
                className="p-2 hover:bg-white/10 rounded-xl transition-colors cursor-pointer text-white"
                title="Episódio Anterior"
                aria-label="Episódio Anterior"
              >
                <SkipBack className="w-4 h-4" />
              </button>
            )}

            {/* Quick Seek 10s backwards (for VOD/Series) */}
            {!isLive && (
              <button
                type="button"
                data-player-control="seek-back"
                onClick={(e) => handleControlClick(e, () => onSeekBy(-10))}
                tabIndex={isVisible ? 0 : -1}
                className="p-2 hover:bg-white/10 rounded-xl transition-colors cursor-pointer text-white"
                title="Voltar 10 segundos (Seta Esquerda)"
                aria-label="Voltar 10 segundos"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}

            {/* Quick Seek 10s forward (for VOD/Series) */}
            {!isLive && (
              <button
                type="button"
                data-player-control="seek-forward"
                onClick={(e) => handleControlClick(e, () => onSeekBy(10))}
                tabIndex={isVisible ? 0 : -1}
                className="p-2 hover:bg-white/10 rounded-xl transition-colors cursor-pointer text-white"
                title="Avançar 10 segundos (Seta Direita)"
                aria-label="Avançar 10 segundos"
              >
                <RotateCw className="w-4 h-4" />
              </button>
            )}

            {/* Next Episode (if series) */}
            {onNext && (
              <button
                type="button"
                data-player-control="next"
                onClick={(e) => handleControlClick(e, onNext)}
                tabIndex={isVisible ? 0 : -1}
                className="p-2 hover:bg-white/10 rounded-xl transition-colors cursor-pointer text-white"
                title="Próximo Episódio"
                aria-label="Próximo Episódio"
              >
                <SkipForward className="w-4 h-4" />
              </button>
            )}

            {/* Volume Control */}
            <div
              className="relative flex items-center gap-1.5"
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
                tabIndex={isVisible ? 0 : -1}
                className={`hover:bg-white/10 rounded-xl transition-colors cursor-pointer text-white ${
                  embedded ? 'p-1.5' : 'p-2'
                }`}
                title={isMuted ? 'Ativar Som (M)' : 'Mudo (M)'}
                aria-label={isMuted ? 'Ativar Som' : 'Silenciar'}
              >
                <VolumeIcon className={embedded ? 'w-4 h-4' : 'w-5 h-5'} />
              </button>

              <div
                className={`transition-all duration-200 overflow-hidden flex items-center px-1 ${
                  isVolumeSliderExpanded
                    ? embedded
                      ? 'w-16 opacity-100'
                      : 'w-20 opacity-100'
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
                  tabIndex={isVisible && isVolumeSliderExpanded ? 0 : -1}
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
                  className="w-full h-1.5 bg-white/30 rounded-lg appearance-none cursor-pointer accent-nc-primary"
                  title="Ajustar Volume"
                />
              </div>
            </div>

            {/* Time / Live Info */}
            <div className="flex items-center gap-2 text-xs font-mono ml-1 text-gray-300">
              {isLive ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    data-player-control="live-edge"
                    onClick={(e) => handleControlClick(e, onSeekToLive)}
                    disabled={isAtLiveEdge}
                    tabIndex={isVisible && !isAtLiveEdge ? 0 : -1}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold transition-all ${
                      isAtLiveEdge
                        ? 'bg-nc-primary/20 text-nc-primary cursor-default'
                        : 'bg-white/20 text-white hover:bg-white/30 cursor-pointer animate-pulse'
                    }`}
                    title={isAtLiveEdge ? 'Sincronizado na borda ao vivo' : 'Ir para o momento ao vivo'}
                  >
                    <Radio className="w-3.5 h-3.5" />
                    <span>{isAtLiveEdge ? 'DIRETO' : 'IR PARA AO VIVO'}</span>
                  </button>
                  {liveEdgeDistance > 6 && (
                    <span className="text-[11px] text-nc-text-secondary">
                      -{formatTime(liveEdgeDistance)}
                    </span>
                  )}
                </div>
              ) : (
                <span>
                  {formatTime(currentTime)} / {formatTime(effectiveDuration)}
                </span>
              )}
            </div>
          </div>

          {/* Right Group */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Picture in Picture */}
            {hasPiP && (
              <button
                type="button"
                data-player-control="pip"
                onClick={(e) => handleControlClick(e, onTogglePiP)}
                tabIndex={isVisible ? 0 : -1}
                className="p-2 hover:bg-white/10 rounded-xl transition-colors cursor-pointer text-white"
                title="Picture-in-Picture"
                aria-label="Picture-in-Picture"
              >
                <PictureInPicture2 className="w-4 h-4" />
              </button>
            )}

            {/* Fullscreen */}
            <button
              type="button"
              data-player-control="fullscreen"
              onClick={(e) => handleControlClick(e, onToggleFullscreen)}
              tabIndex={isVisible ? 0 : -1}
              className="p-2 hover:bg-white/10 rounded-xl transition-colors cursor-pointer text-white"
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
