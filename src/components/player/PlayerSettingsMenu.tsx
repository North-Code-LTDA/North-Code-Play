import React, { useState } from 'react';
import {
  Check,
  ChevronRight,
  Sliders,
  Gauge,
  Volume2,
  Subtitles,
  Activity,
  X,
} from 'lucide-react';
import { QualityLevel, MediaTrackInfo, BufferProfileKey } from './types';
import { BUFFER_PROFILES } from './profiles';

interface PlayerSettingsMenuProps {
  isOpen: boolean;
  onClose: () => void;
  isLive: boolean;
  qualities: QualityLevel[];
  currentQuality: number;
  onSelectQuality: (id: number) => void;
  audioTracks: MediaTrackInfo[];
  currentAudioTrack: number;
  onSelectAudioTrack: (id: number) => void;
  subtitleTracks: MediaTrackInfo[];
  currentSubtitleTrack: number;
  onSelectSubtitleTrack: (id: number) => void;
  playbackRate: number;
  onSelectPlaybackRate: (rate: number) => void;
  bufferProfile: BufferProfileKey;
  onSelectBufferProfile: (key: BufferProfileKey) => void;
}

type SubMenuType = 'main' | 'quality' | 'audio' | 'subtitles' | 'speed' | 'profile';

export function PlayerSettingsMenu({
  isOpen,
  onClose,
  isLive,
  qualities,
  currentQuality,
  onSelectQuality,
  audioTracks,
  currentAudioTrack,
  onSelectAudioTrack,
  subtitleTracks,
  currentSubtitleTrack,
  onSelectSubtitleTrack,
  playbackRate,
  onSelectPlaybackRate,
  bufferProfile,
  onSelectBufferProfile,
}: PlayerSettingsMenuProps) {
  const [activeSubMenu, setActiveSubMenu] = useState<SubMenuType>('main');

  if (!isOpen) return null;

  const speedOptions = [0.5, 0.75, 1, 1.25, 1.5, 2];

  const currentQualityLabel =
    currentQuality === -1
      ? 'Automático'
      : qualities.find((q) => q.id === currentQuality)?.name || 'Automático';

  const currentAudioLabel =
    audioTracks.find((a) => a.id === currentAudioTrack)?.name || 'Padrão';

  const currentSubtitleLabel =
    currentSubtitleTrack === -1
      ? 'Desativado'
      : subtitleTracks.find((s) => s.id === currentSubtitleTrack)?.name || 'Desativado';

  const currentProfileLabel = BUFFER_PROFILES[bufferProfile]?.label || 'Equilibrado';

  return (
    <div
      className="absolute bottom-16 right-4 sm:right-8 z-40 w-72 bg-nc-bg-card/95 border border-nc-border/80 backdrop-blur-xl rounded-2xl shadow-2xl overflow-hidden p-3 text-white text-xs select-none animate-in fade-in zoom-in-95 duration-150"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Top Header */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-nc-border/40 px-1">
        {activeSubMenu === 'main' ? (
          <span className="font-semibold text-sm flex items-center gap-1.5 text-white">
            <Sliders className="w-4 h-4 text-nc-primary" /> Configurações
          </span>
        ) : (
          <button
            onClick={() => setActiveSubMenu('main')}
            className="text-nc-text-secondary hover:text-white flex items-center gap-1 text-xs font-medium cursor-pointer"
          >
            ← Voltar
          </button>
        )}
        <button
          onClick={onClose}
          className="p-1 hover:bg-white/10 rounded-full text-nc-text-secondary hover:text-white cursor-pointer"
          title="Fechar"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Main Menu */}
      {activeSubMenu === 'main' && (
        <div className="space-y-1">
          {/* Quality option if real levels available */}
          {qualities.length > 0 && (
            <button
              onClick={() => setActiveSubMenu('quality')}
              className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-white/10 transition-colors text-left cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Gauge className="w-4 h-4 text-nc-text-secondary" />
                <span>Qualidade</span>
              </div>
              <div className="flex items-center gap-1 text-nc-text-secondary">
                <span className="truncate max-w-[100px]">{currentQualityLabel}</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </div>
            </button>
          )}

          {/* Audio tracks if available */}
          {audioTracks.length > 1 && (
            <button
              onClick={() => setActiveSubMenu('audio')}
              className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-white/10 transition-colors text-left cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-nc-text-secondary" />
                <span>Áudio</span>
              </div>
              <div className="flex items-center gap-1 text-nc-text-secondary">
                <span className="truncate max-w-[100px]">{currentAudioLabel}</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </div>
            </button>
          )}

          {/* Subtitles if available */}
          {subtitleTracks.length > 0 && (
            <button
              onClick={() => setActiveSubMenu('subtitles')}
              className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-white/10 transition-colors text-left cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Subtitles className="w-4 h-4 text-nc-text-secondary" />
                <span>Legendas</span>
              </div>
              <div className="flex items-center gap-1 text-nc-text-secondary">
                <span className="truncate max-w-[100px]">{currentSubtitleLabel}</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </div>
            </button>
          )}

          {/* Speed option (only for VOD / Series) */}
          {!isLive && (
            <button
              onClick={() => setActiveSubMenu('speed')}
              className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-white/10 transition-colors text-left cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-nc-text-secondary" />
                <span>Velocidade</span>
              </div>
              <div className="flex items-center gap-1 text-nc-text-secondary">
                <span>{playbackRate === 1 ? 'Normal' : `${playbackRate}x`}</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </div>
            </button>
          )}

          {/* Buffer Profile */}
          <button
            onClick={() => setActiveSubMenu('profile')}
            className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-white/10 transition-colors text-left cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-nc-text-secondary" />
              <span>Perfil de Buffer</span>
            </div>
            <div className="flex items-center gap-1 text-nc-text-secondary">
              <span>{currentProfileLabel}</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </div>
          </button>
        </div>
      )}

      {/* Quality Submenu */}
      {activeSubMenu === 'quality' && (
        <div className="space-y-1 max-h-56 overflow-y-auto custom-scrollbar">
          <button
            onClick={() => {
              onSelectQuality(-1);
              setActiveSubMenu('main');
            }}
            className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-white/10 transition-colors text-left cursor-pointer"
          >
            <span>Automático</span>
            {currentQuality === -1 && <Check className="w-4 h-4 text-nc-primary" />}
          </button>
          {qualities.map((q) => (
            <button
              key={q.id}
              onClick={() => {
                onSelectQuality(q.id);
                setActiveSubMenu('main');
              }}
              className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-white/10 transition-colors text-left cursor-pointer"
            >
              <span>{q.name}</span>
              {currentQuality === q.id && <Check className="w-4 h-4 text-nc-primary" />}
            </button>
          ))}
        </div>
      )}

      {/* Audio Submenu */}
      {activeSubMenu === 'audio' && (
        <div className="space-y-1 max-h-56 overflow-y-auto custom-scrollbar">
          {audioTracks.map((tr) => (
            <button
              key={tr.id}
              onClick={() => {
                onSelectAudioTrack(tr.id);
                setActiveSubMenu('main');
              }}
              className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-white/10 transition-colors text-left cursor-pointer"
            >
              <span>{tr.name}</span>
              {currentAudioTrack === tr.id && <Check className="w-4 h-4 text-nc-primary" />}
            </button>
          ))}
        </div>
      )}

      {/* Subtitles Submenu */}
      {activeSubMenu === 'subtitles' && (
        <div className="space-y-1 max-h-56 overflow-y-auto custom-scrollbar">
          <button
            onClick={() => {
              onSelectSubtitleTrack(-1);
              setActiveSubMenu('main');
            }}
            className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-white/10 transition-colors text-left cursor-pointer"
          >
            <span>Desativado</span>
            {currentSubtitleTrack === -1 && <Check className="w-4 h-4 text-nc-primary" />}
          </button>
          {subtitleTracks.map((st) => (
            <button
              key={st.id}
              onClick={() => {
                onSelectSubtitleTrack(st.id);
                setActiveSubMenu('main');
              }}
              className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-white/10 transition-colors text-left cursor-pointer"
            >
              <span>{st.name}</span>
              {currentSubtitleTrack === st.id && <Check className="w-4 h-4 text-nc-primary" />}
            </button>
          ))}
        </div>
      )}

      {/* Speed Submenu */}
      {activeSubMenu === 'speed' && (
        <div className="space-y-1">
          {speedOptions.map((rate) => (
            <button
              key={rate}
              onClick={() => {
                onSelectPlaybackRate(rate);
                setActiveSubMenu('main');
              }}
              className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-white/10 transition-colors text-left cursor-pointer"
            >
              <span>{rate === 1 ? '1x (Normal)' : `${rate}x`}</span>
              {playbackRate === rate && <Check className="w-4 h-4 text-nc-primary" />}
            </button>
          ))}
        </div>
      )}

      {/* Buffer Profile Submenu */}
      {activeSubMenu === 'profile' && (
        <div className="space-y-2">
          {Object.values(BUFFER_PROFILES).map((p) => (
            <button
              key={p.key}
              onClick={() => {
                onSelectBufferProfile(p.key);
                setActiveSubMenu('main');
              }}
              className={`w-full p-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
                bufferProfile === p.key
                  ? 'border-nc-primary/60 bg-nc-primary/10'
                  : 'border-nc-border/40 hover:bg-white/5'
              }`}
            >
              <div className="flex items-center justify-between font-medium text-white mb-0.5">
                <span>{p.label}</span>
                {bufferProfile === p.key && <Check className="w-4 h-4 text-nc-primary" />}
              </div>
              <p className="text-[11px] text-nc-text-secondary leading-snug">{p.description}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
