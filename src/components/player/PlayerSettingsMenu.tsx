import React, { useState, useEffect, useRef, useId } from 'react';
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
import {
  useBackHandler,
  BACK_PRIORITY,
  focusElementSafely,
} from '../../navigation';

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
  const menuContainerRef = useRef<HTMLDivElement>(null);
  const lastMainItemRef = useRef<SubMenuType | null>(null);
  const menuId = useId();

  useEffect(() => {
    if (isOpen) {
      setActiveSubMenu('main');
      lastMainItemRef.current = null;
    }
  }, [isOpen]);

  useBackHandler(
    `player-settings-submenu-${menuId}`,
    BACK_PRIORITY.SUB_MODAL + 1,
    () => {
      if (isOpen && activeSubMenu !== 'main') {
        setActiveSubMenu('main');
        return true;
      }
      return false;
    },
    isOpen && activeSubMenu !== 'main'
  );

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      const root = menuContainerRef.current;
      if (!root) return;

      if (activeSubMenu === 'main' && lastMainItemRef.current) {
        const originBtn = root.querySelector<HTMLElement>(
          `button[data-settings-item="${lastMainItemRef.current}"]`
        );
        if (originBtn) {
          focusElementSafely(originBtn);
          return;
        }
      }

      const activeOption =
        root.querySelector<HTMLElement>('[data-settings-list="true"] button[data-track-active="true"]') ||
        root.querySelector<HTMLElement>('[data-settings-list="true"] button') ||
        root.querySelector<HTMLElement>('button');
      if (activeOption) {
        focusElementSafely(activeOption);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [isOpen, activeSubMenu]);

  if (!isOpen) return null;

  const openSubMenu = (sub: SubMenuType) => {
    lastMainItemRef.current = sub;
    setActiveSubMenu(sub);
  };

  const speedOptions = [0.5, 0.75, 1, 1.25, 1.5, 2];

  const currentQualityLabel =
    currentQuality === -1
      ? 'Automático'
      : qualities.find((q) => q.id === currentQuality)?.name || 'Automático';

  const currentAudioLabel =
    audioTracks.length > 0
      ? audioTracks.find((a) => a.id === currentAudioTrack)?.name || audioTracks[0].name
      : 'Padrão';

  const currentSubtitleLabel =
    subtitleTracks.length === 0
      ? 'Indisponível'
      : currentSubtitleTrack === -1
        ? 'Desativado'
        : subtitleTracks.find((s) => s.id === currentSubtitleTrack)?.name || 'Desativado';

  const currentProfileLabel = BUFFER_PROFILES[bufferProfile]?.label || 'Equilibrado';

  return (
    <div
      ref={menuContainerRef}
      data-focus-scope="modal"
      data-player-settings-menu="true"
      className="absolute bottom-12 sm:bottom-14 right-2 sm:right-4 z-40 w-[min(18rem,calc(100%-1rem))] max-h-[calc(100%-3rem)] flex flex-col bg-nc-bg-card/95 border border-nc-border/80 backdrop-blur-xl rounded-xl sm:rounded-2xl shadow-2xl overflow-hidden p-2.5 sm:p-3 text-white text-xs select-none animate-in fade-in zoom-in-95 duration-150"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Top Header */}
      <div
        data-nav-row="settings-header"
        className="flex items-center justify-between pb-2 mb-2 border-b border-nc-border/40 px-1 shrink-0"
      >
        {activeSubMenu === 'main' ? (
          <span className="font-semibold text-sm flex items-center gap-1.5 text-white">
            <Sliders className="w-4 h-4 text-nc-primary" /> Configurações
          </span>
        ) : (
          <button
            type="button"
            data-settings-back="true"
            onClick={() => setActiveSubMenu('main')}
            className="text-nc-text-secondary hover:text-white flex items-center gap-1 text-xs font-medium cursor-pointer px-1.5 py-1 rounded-lg"
          >
            ← Voltar
          </button>
        )}
        <button
          type="button"
          data-settings-close="true"
          onClick={onClose}
          className="p-1 hover:bg-white/10 rounded-full text-nc-text-secondary hover:text-white cursor-pointer"
          title="Fechar"
          aria-label="Fechar configurações"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Main Menu */}
      {activeSubMenu === 'main' && (
        <div
          data-settings-list="true"
          data-scroll-container="true"
          className="flex-1 overflow-y-auto custom-scrollbar min-h-0 space-y-1 pr-0.5"
        >
          {/* Quality option if real levels available */}
          {qualities.length > 0 && (
            <button
              type="button"
              data-settings-item="quality"
              onClick={() => openSubMenu('quality')}
              className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-white/10 transition-colors text-left cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Gauge className="w-4 h-4 text-nc-text-secondary" />
                <span>Qualidade</span>
              </div>
              <div className="flex items-center gap-1 text-nc-text-secondary">
                <span className="truncate max-w-[110px]">{currentQualityLabel}</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </div>
            </button>
          )}

          {/* Audio tracks (always accessible so user can inspect or switch real tracks) */}
          <button
            type="button"
            data-settings-item="audio"
            onClick={() => openSubMenu('audio')}
            className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-white/10 transition-colors text-left cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-nc-text-secondary" />
              <span>Áudio</span>
            </div>
            <div className="flex items-center gap-1 text-nc-text-secondary">
              <span data-settings-audio-summary="true" className="truncate max-w-[110px]">
                {currentAudioLabel}
              </span>
              <ChevronRight className="w-3.5 h-3.5" />
            </div>
          </button>

          {/* Subtitles (always accessible so user can enable, disable, or see availability) */}
          <button
            type="button"
            data-settings-item="subtitles"
            onClick={() => openSubMenu('subtitles')}
            className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-white/10 transition-colors text-left cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Subtitles className="w-4 h-4 text-nc-text-secondary" />
              <span>Legendas</span>
            </div>
            <div className="flex items-center gap-1 text-nc-text-secondary">
              <span data-settings-subtitles-summary="true" className="truncate max-w-[110px]">
                {currentSubtitleLabel}
              </span>
              <ChevronRight className="w-3.5 h-3.5" />
            </div>
          </button>

          {/* Speed option (only for VOD / Series) */}
          {!isLive && (
            <button
              type="button"
              data-settings-item="speed"
              onClick={() => openSubMenu('speed')}
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
            type="button"
            data-settings-item="profile"
            onClick={() => openSubMenu('profile')}
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
        <div
          data-settings-list="true"
          data-scroll-container="true"
          className="flex-1 overflow-y-auto custom-scrollbar min-h-0 space-y-1 pr-0.5"
        >
          <button
            type="button"
            data-track-active={currentQuality === -1 ? 'true' : 'false'}
            aria-pressed={currentQuality === -1}
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
              type="button"
              key={q.id}
              data-track-active={currentQuality === q.id ? 'true' : 'false'}
              aria-pressed={currentQuality === q.id}
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
        <div
          data-settings-list="true"
          data-scroll-container="true"
          className="flex-1 overflow-y-auto custom-scrollbar min-h-0 space-y-1 pr-0.5"
        >
          {audioTracks.length > 0 ? (
            <>
              {audioTracks.map((tr) => {
                const isSelected =
                  currentAudioTrack === tr.id ||
                  (currentAudioTrack === -1 && audioTracks[0]?.id === tr.id);
                return (
                  <button
                    type="button"
                    key={tr.id}
                    data-audio-track-id={tr.id}
                    data-track-active={isSelected ? 'true' : 'false'}
                    aria-pressed={isSelected}
                    onClick={() => {
                      onSelectAudioTrack(tr.id);
                      setActiveSubMenu('main');
                    }}
                    className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-white/10 transition-colors text-left cursor-pointer"
                  >
                    <span className="truncate pr-2">{tr.name}</span>
                    {isSelected && <Check className="w-4 h-4 text-nc-primary shrink-0" />}
                  </button>
                );
              })}
              {audioTracks.length === 1 && (
                <p
                  data-audio-single-note="true"
                  className="px-2 py-1.5 text-[11px] text-nc-text-secondary leading-snug"
                >
                  Faixa única disponível nesta transmissão.
                </p>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                data-audio-default-only="true"
                data-track-active="true"
                aria-pressed="true"
                onClick={() => setActiveSubMenu('main')}
                className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-white/10 transition-colors text-left cursor-pointer"
              >
                <span>Padrão da mídia</span>
                <Check className="w-4 h-4 text-nc-primary shrink-0" />
              </button>
              <p
                data-audio-empty-state="true"
                className="px-2 py-1.5 text-[11px] text-nc-text-secondary leading-snug"
              >
                Nenhuma faixa de áudio adicional exposta pelo fluxo ou navegador.
              </p>
            </>
          )}
        </div>
      )}

      {/* Subtitles Submenu */}
      {activeSubMenu === 'subtitles' && (
        <div
          data-settings-list="true"
          data-scroll-container="true"
          className="flex-1 overflow-y-auto custom-scrollbar min-h-0 space-y-1 pr-0.5"
        >
          <button
            type="button"
            data-subtitle-track-id="-1"
            data-track-active={currentSubtitleTrack === -1 ? 'true' : 'false'}
            aria-pressed={currentSubtitleTrack === -1}
            onClick={() => {
              onSelectSubtitleTrack(-1);
              setActiveSubMenu('main');
            }}
            className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-white/10 transition-colors text-left cursor-pointer"
          >
            <span>Desativado</span>
            {currentSubtitleTrack === -1 && <Check className="w-4 h-4 text-nc-primary shrink-0" />}
          </button>
          {subtitleTracks.length > 0 ? (
            subtitleTracks.map((st) => {
              const isSelected = currentSubtitleTrack === st.id;
              return (
                <button
                  type="button"
                  key={st.id}
                  data-subtitle-track-id={st.id}
                  data-track-active={isSelected ? 'true' : 'false'}
                  aria-pressed={isSelected}
                  onClick={() => {
                    onSelectSubtitleTrack(st.id);
                    setActiveSubMenu('main');
                  }}
                  className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-white/10 transition-colors text-left cursor-pointer"
                >
                  <span className="truncate pr-2">{st.name}</span>
                  {isSelected && <Check className="w-4 h-4 text-nc-primary shrink-0" />}
                </button>
              );
            })
          ) : (
            <p
              data-subtitles-empty-state="true"
              className="px-2 py-1.5 text-[11px] text-nc-text-secondary leading-snug"
            >
              Nenhuma legenda compatível disponível para este conteúdo.
            </p>
          )}
        </div>
      )}

      {/* Speed Submenu */}
      {activeSubMenu === 'speed' && (
        <div
          data-settings-list="true"
          data-scroll-container="true"
          className="flex-1 overflow-y-auto custom-scrollbar min-h-0 space-y-1 pr-0.5"
        >
          {speedOptions.map((rate) => (
            <button
              type="button"
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
        <div
          data-settings-list="true"
          data-scroll-container="true"
          className="flex-1 overflow-y-auto custom-scrollbar min-h-0 space-y-2 pr-0.5"
        >
          {Object.values(BUFFER_PROFILES).map((p) => (
            <button
              type="button"
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
