import React from 'react';
import {
  ArrowLeft,
  CalendarClock,
  Heart,
  Loader2,
  Maximize2,
  Play,
  TvMinimalPlay,
} from 'lucide-react';
import { VideoPlayer } from './VideoPlayer';
import { MediaImage } from './MediaImage';
import { LiveChannelGroup, parseChannelVariantSuffix } from '../utils/liveChannelGroups';
import type { ChronologicalEpgEntry, ResolvedNowPlaying } from '../utils/epgUtils';

export interface LiveTvHeroProps {
  selectedGroup: LiveChannelGroup | null;
  activeVariantStream: any | null;
  selectedResolutionMode: string;
  serverUrl?: string;
  streamUrl: string;
  attemptTrigger: number;
  fullscreenRequestTrigger: number;
  isLoadingPlayback: boolean;
  playbackError: string | null;
  nowPlaying: ResolvedNowPlaying | null;
  scheduleItems?: ChronologicalEpgEntry[];
  loadingEpg: boolean;
  epgError: string | null;
  isFavorited: boolean;
  isCatalogLoading?: boolean;
  onExpandFullscreen: () => void;
  onRetryPlayback: () => void;
  onBackFromFullscreen: () => void;
  onPlaybackSuccess: (attemptId?: number) => void;
  onPlaybackFinalError: (errorMsg: string, attemptId?: number) => void;
  onSelectResolutionMode: (variant: any | 'auto') => void;
  onToggleFavorite: (group: LiveChannelGroup) => void;
  onReturnFocusToCatalog?: () => void;
}

export const LiveTvHero = React.memo(function LiveTvHero({
  selectedGroup,
  activeVariantStream,
  selectedResolutionMode,
  serverUrl,
  streamUrl,
  attemptTrigger,
  fullscreenRequestTrigger,
  isLoadingPlayback,
  playbackError,
  nowPlaying,
  scheduleItems = [],
  loadingEpg,
  epgError,
  isFavorited,
  isCatalogLoading = false,
  onExpandFullscreen,
  onRetryPlayback,
  onBackFromFullscreen,
  onPlaybackSuccess,
  onPlaybackFinalError,
  onSelectResolutionMode,
  onToggleFavorite,
  onReturnFocusToCatalog,
}: LiveTvHeroProps) {
  const activeStreamResolution = activeVariantStream?.name
    ? parseChannelVariantSuffix(activeVariantStream.name).resolution
    : null;

  const activeVariantId = activeVariantStream?.stream_id ?? activeVariantStream?.id;
  const primaryStreamId =
    selectedGroup?.primaryStream?.stream_id ?? selectedGroup?.primaryStream?.id ?? '';

  const previewState = !selectedGroup
    ? 'idle'
    : streamUrl || isLoadingPlayback || playbackError
      ? 'open'
      : 'collapsed';

  const handlePanelKeyDownCapture = (e: React.KeyboardEvent<HTMLElement>) => {
    if (!onReturnFocusToCatalog) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;

    if (e.key === 'Escape' || e.key === 'Backspace') {
      // Do not intercept if fullscreen modal player is open
      if (
        typeof document !== 'undefined' &&
        document.querySelector('[data-player-container="true"][data-focus-scope="modal"]')
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      onReturnFocusToCatalog();
      return;
    }

    if (e.key === 'ArrowLeft') {
      const isLeftmostControl =
        target.getAttribute('data-live-hero-play') === 'true' ||
        target.getAttribute('data-live-epg-scroll') === 'true' ||
        target.getAttribute('data-variant-first') === 'true' ||
        target.getAttribute('data-live-neutral-back') === 'true';
      if (isLeftmostControl) {
        e.preventDefault();
        e.stopPropagation();
        onReturnFocusToCatalog();
      }
    }
  };

  return (
    <section
      data-live-hero="true"
      data-live-right-panel="true"
      data-live-hero-docked="false"
      data-live-preview-state={previewState}
      data-nav-zone="live-panel"
      aria-label="Painel de reprodução e programação da TV ao Vivo"
      onKeyDownCapture={handlePanelKeyDownCapture}
      className="w-full h-full flex flex-col min-h-0 bg-[#08090d] border-t md:border-t-0 md:border-l border-white/10 select-none overflow-hidden"
    >
      {selectedGroup ? (
        <div
          data-hero-stage="true"
          data-live-top-section="true"
          className="flex flex-col w-full h-full min-h-0 overflow-hidden"
        >
          {/* 1. Top Fixed Area: 16:9 Live Preview + Channel Identity + Actions + Now Playing */}
          <div className="shrink-0 p-3.5 sm:p-4 lg:p-5 flex flex-col gap-3 border-b border-white/10 bg-gradient-to-b from-[#12141d] via-[#0c0e14] to-[#08090d]">
            {/* Permanent 16:9 Embedded Video Preview */}
            <div
              data-live-preview-wrapper="true"
              className="w-full max-w-[36rem] mx-auto shrink-0"
            >
              <div className="w-full aspect-video rounded-xl overflow-hidden bg-black border border-white/15 shadow-[0_14px_34px_rgba(0,0,0,0.85)]">
                <VideoPlayer
                  key={selectedGroup.groupId}
                  streamUrl={streamUrl}
                  title={selectedGroup.displayName}
                  channelName={selectedGroup.displayName}
                  programTitle={nowPlaying?.title || undefined}
                  contentType="live"
                  streamId={activeVariantId || selectedGroup.groupId}
                  attemptTrigger={attemptTrigger}
                  fullscreenRequestTrigger={fullscreenRequestTrigger}
                  onBack={onBackFromFullscreen}
                  embedded={true}
                  disableEmbeddedControlsFocus={true}
                  isLoading={isLoadingPlayback}
                  errorMessage={playbackError}
                  onRetry={onRetryPlayback}
                  onPlaybackSuccess={onPlaybackSuccess}
                  onPlaybackFinalError={onPlaybackFinalError}
                />
              </div>
            </div>

            {/* Channel Identity + Primary Controls */}
            <div
              data-live-summary-col="true"
              className="w-full flex flex-col gap-2.5 min-w-0"
            >
              <div className="flex items-start justify-between gap-3 min-w-0 flex-wrap sm:flex-nowrap">
                {/* Logo + Channel Name + Badges */}
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="nc-live-channel-logo w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-black/50 border border-white/15 flex items-center justify-center overflow-hidden shrink-0 p-1.5">
                    <MediaImage
                      src={selectedGroup.stream_icon}
                      serverUrl={serverUrl}
                      alt={selectedGroup.displayName}
                      itemId={primaryStreamId}
                      itemName={selectedGroup.displayName}
                      priority={true}
                      loading="eager"
                      className="w-full h-full object-contain"
                    />
                  </div>

                  <div className="min-w-0 flex-1 flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="nc-badge-info px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider bg-red-500/20 text-red-200 border border-red-500/35 inline-flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                        Ao Vivo
                      </span>
                      {activeStreamResolution && (
                        <span className="nc-badge-info px-2 py-0.5 rounded text-xs font-semibold uppercase bg-white/10 text-white/90 border border-white/15">
                          {activeStreamResolution}
                        </span>
                      )}
                    </div>

                    <h1 className="nc-live-channel-title nc-heading-section font-bold text-white line-clamp-2 whitespace-normal break-words w-full">
                      {selectedGroup.displayName}
                    </h1>
                  </div>
                </div>

                {/* Action Buttons */}
                <div
                  data-nav-row="true"
                  className="nc-action-group flex items-center gap-2 shrink-0"
                >
                  <button
                    type="button"
                    data-nav-item="true"
                    data-live-hero-play="true"
                    data-autofocus="true"
                    onClick={() => {
                      if (playbackError) {
                        onRetryPlayback();
                      } else {
                        onExpandFullscreen();
                      }
                    }}
                    className="nc-tv-details-action flex items-center gap-2 bg-white hover:bg-white/90 text-black px-4 py-2 rounded-full font-bold text-xs sm:text-sm transition-transform active:scale-95 shadow-md cursor-pointer"
                  >
                    {playbackError ? (
                      <>
                        <Play className="w-3.5 h-3.5 fill-current shrink-0" />
                        <span>Tentar novamente</span>
                      </>
                    ) : (
                      <>
                        <Maximize2 className="w-3.5 h-3.5 shrink-0" />
                        <span>Assistir</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    data-nav-item="true"
                    data-live-hero-favorite="true"
                    aria-label={
                      isFavorited ? 'Remover canal dos favoritos' : 'Adicionar canal aos favoritos'
                    }
                    aria-pressed={isFavorited}
                    onClick={() => onToggleFavorite(selectedGroup)}
                    className="nc-tv-details-action-icon flex items-center justify-center w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 text-white border border-white/15 transition-colors cursor-pointer"
                  >
                    <Heart
                      className={`w-4 h-4 shrink-0 ${
                        isFavorited ? 'fill-white text-white' : 'text-white'
                      }`}
                    />
                  </button>

                  {onReturnFocusToCatalog && (
                    <button
                      type="button"
                      data-nav-item="true"
                      data-live-back-to-catalog="true"
                      aria-label="Voltar para a lista de canais"
                      onClick={onReturnFocusToCatalog}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white/85 hover:text-white border border-white/15 text-xs font-medium transition-colors cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
                      <span className="hidden sm:inline">Canais</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Discrete Version Selector (only when >1 version exists) */}
              {selectedGroup.isGrouped && selectedGroup.variants.length > 0 && (
                <div
                  key={selectedGroup.groupId}
                  className="nc-live-variants-bar w-full min-w-0 flex items-center gap-2"
                >
                  <span className="text-xs font-medium text-white/60 shrink-0">
                    Versão:
                  </span>
                  <div
                    data-nav-row="live-variants"
                    data-live-variants-row="true"
                    className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide min-w-0 max-w-full py-0.5 touch-pan-x"
                  >
                    <button
                      type="button"
                      data-nav-item="true"
                      data-variant-first="true"
                      data-variant-active={selectedResolutionMode === 'auto' ? 'true' : 'false'}
                      onClick={() => onSelectResolutionMode('auto')}
                      className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors shrink-0 cursor-pointer ${
                        selectedResolutionMode === 'auto'
                          ? 'bg-white text-black'
                          : 'bg-white/12 text-white/85 hover:bg-white/20 hover:text-white border border-white/15'
                      }`}
                    >
                      Automático
                    </button>
                    {selectedGroup.variants.map((v) => {
                      const isSelectedVariant =
                        selectedResolutionMode !== 'auto' &&
                        String(activeVariantId) === String(v.streamId);
                      const isActiveStream = String(activeVariantId) === String(v.streamId);

                      return (
                        <button
                          key={v.streamId}
                          type="button"
                          data-nav-item="true"
                          data-variant-active={isSelectedVariant ? 'true' : 'false'}
                          onClick={() => onSelectResolutionMode(v.stream)}
                          className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors shrink-0 flex items-center gap-1.5 cursor-pointer ${
                            isSelectedVariant
                              ? 'bg-white text-black'
                              : isActiveStream
                                ? 'bg-white/25 text-white border border-white/30'
                                : 'bg-white/12 text-white/85 hover:bg-white/20 hover:text-white border border-white/15'
                          }`}
                        >
                          <span>{v.label}</span>
                          {isActiveStream && selectedResolutionMode === 'auto' && (
                            <span
                              aria-hidden="true"
                              className="w-1.5 h-1.5 rounded-full bg-white shrink-0"
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Current Program Summary ("Passando agora") */}
              <div
                data-live-now-playing="true"
                className="nc-live-now-playing w-full rounded-xl bg-white/[0.04] border border-white/10 px-3.5 py-2.5 flex flex-col gap-1"
              >
                {loadingEpg ? (
                  <div
                    data-epg-state="loading"
                    className="flex items-center gap-2 text-xs sm:text-sm text-nc-text-secondary"
                  >
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-white/75 shrink-0" />
                    <span>Carregando programação...</span>
                  </div>
                ) : epgError ? (
                  <p
                    data-epg-state="error"
                    className="text-xs sm:text-sm text-nc-text-secondary"
                  >
                    Programação indisponível
                  </p>
                ) : nowPlaying ? (
                  <>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-xs uppercase tracking-wider font-semibold text-white/60">
                        Passando agora
                      </span>
                      {nowPlaying.timeSlot && (
                        <span className="text-xs font-mono text-white/80 shrink-0">
                          {nowPlaying.timeSlot}
                        </span>
                      )}
                    </div>

                    {nowPlaying.title && (
                      <p
                        data-live-now-playing-title="true"
                        className="text-xs sm:text-sm font-semibold text-white line-clamp-1 whitespace-normal break-words"
                      >
                        {nowPlaying.title}
                      </p>
                    )}

                    {nowPlaying.progressPercent !== null && (
                      <div
                        data-live-epg-progress="true"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={nowPlaying.progressPercent}
                        aria-label="Progresso do programa atual"
                        className="w-full h-1.5 rounded-full bg-white/15 overflow-hidden my-0.5"
                      >
                        <div
                          className="h-full bg-white rounded-full transition-[width] duration-300"
                          style={{ width: `${nowPlaying.progressPercent}%` }}
                        />
                      </div>
                    )}

                    {nowPlaying.description && (
                      <p
                        data-live-now-playing-desc="true"
                        className="nc-live-now-playing-desc text-xs text-white/75 line-clamp-2 whitespace-normal break-words leading-relaxed"
                      >
                        {nowPlaying.description}
                      </p>
                    )}
                  </>
                ) : (
                  <p
                    data-epg-state="empty"
                    className="text-xs sm:text-sm text-nc-text-secondary"
                  >
                    Programação indisponível
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* 2. Bottom Area: Chronological EPG Schedule List with Independent Vertical Scroll */}
          <div
            data-live-epg-list="true"
            className="flex-1 min-h-[160px] flex flex-col overflow-hidden bg-[#08090d]"
          >
            <div className="shrink-0 px-4 lg:px-5 py-2.5 border-b border-white/10 flex items-center justify-between gap-2 bg-[#0b0d13]">
              <div className="flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-white/70 shrink-0" />
                <h2 className="text-xs sm:text-sm font-semibold text-white/90 tracking-tight">
                  Grade de programação
                </h2>
              </div>
              {scheduleItems.length > 0 && (
                <span className="text-xs font-medium text-nc-text-secondary">
                  {scheduleItems.length}{' '}
                  {scheduleItems.length === 1 ? 'programa' : 'programas'}
                </span>
              )}
            </div>

            <div
              data-live-epg-scroll="true"
              data-synopsis-focus="true"
              data-nav-item="true"
              tabIndex={0}
              role="region"
              aria-label="Lista cronológica de programação do canal"
              className="nc-tv-epg-state flex-1 min-h-0 overflow-y-auto custom-scrollbar px-4 lg:px-5 py-3 space-y-2.5 outline-none"
            >
              {loadingEpg ? (
                <div className="py-8 flex flex-col items-center justify-center gap-2 text-nc-text-secondary">
                  <Loader2 className="w-5 h-5 animate-spin text-white/60" />
                  <span className="text-xs">Sincronizando grade de programação...</span>
                </div>
              ) : scheduleItems.length > 0 ? (
                scheduleItems.map((item) => (
                  <article
                    key={item.id}
                    data-epg-schedule-item="true"
                    data-epg-item-current={item.isCurrent ? 'true' : 'false'}
                    className={`rounded-xl border px-3.5 py-2.5 transition-colors ${
                      item.isCurrent
                        ? 'bg-white/[0.08] border-white/30'
                        : 'bg-white/[0.025] border-white/10'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                      <div className="flex items-center gap-2">
                        {item.isCurrent && (
                          <span className="nc-badge-info px-1.5 py-0.5 rounded text-xs font-bold uppercase tracking-wider bg-white text-black">
                            Agora
                          </span>
                        )}
                        {item.timeSlot ? (
                          <span
                            data-epg-item-time="true"
                            className="text-xs font-mono font-medium text-white/80"
                          >
                            {item.timeSlot}
                          </span>
                        ) : (
                          <span className="text-xs text-nc-text-secondary">
                            Horário não informado
                          </span>
                        )}
                      </div>
                    </div>

                    <h3
                      data-epg-item-title="true"
                      className={`text-xs sm:text-sm font-semibold leading-snug break-words ${
                        item.isCurrent ? 'text-white' : 'text-white/90'
                      }`}
                    >
                      {item.title}
                    </h3>

                    {item.isCurrent && item.progressPercent !== null && (
                      <div className="w-full h-1 rounded-full bg-white/15 overflow-hidden mt-1.5">
                        <div
                          className="h-full bg-white/90 rounded-full"
                          style={{ width: `${item.progressPercent}%` }}
                        />
                      </div>
                    )}

                    {item.description && (
                      <p
                        data-epg-item-desc="true"
                        className="text-xs text-nc-text-secondary mt-1 leading-relaxed break-words"
                      >
                        {item.description}
                      </p>
                    )}
                  </article>
                ))
              ) : (
                <div className="py-8 flex flex-col items-center justify-center text-center gap-1.5 text-nc-text-secondary">
                  <p className="text-xs sm:text-sm font-medium text-white/75">
                    Programação indisponível
                  </p>
                  <p className="text-xs text-nc-text-secondary max-w-xs">
                    A emissora não disponibilizou a grade de horários para este canal no momento.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Neutral Right-Column State before a channel is explicitly selected */
        <div
          data-hero-stage="true"
          data-live-hero-neutral="true"
          className="flex flex-col w-full h-full min-h-0 overflow-hidden"
        >
          <div className="shrink-0 p-3.5 sm:p-4 lg:p-5 flex flex-col gap-3.5 border-b border-white/10 bg-gradient-to-b from-[#12141d] via-[#0c0e14] to-[#08090d]">
            {/* Neutral 16:9 Preview Frame */}
            <div
              data-live-preview-wrapper="true"
              className="w-full max-w-[36rem] mx-auto shrink-0"
            >
              <div className="w-full aspect-video rounded-xl bg-black/70 border border-white/12 flex flex-col items-center justify-center gap-2.5 text-white/50 shadow-[0_14px_34px_rgba(0,0,0,0.8)] px-4 text-center">
                {isCatalogLoading ? (
                  <Loader2 className="w-8 h-8 animate-spin text-white/60" />
                ) : (
                  <TvMinimalPlay className="w-10 h-10 opacity-55" />
                )}
                <span className="text-xs sm:text-sm font-medium text-white/70">
                  {isCatalogLoading ? 'Sincronizando canais...' : 'Pré-visualização 16:9 ao vivo'}
                </span>
              </div>
            </div>

            <div className="flex flex-col items-start gap-2">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded text-xs font-bold uppercase tracking-wider bg-white/12 text-white border border-white/15">
                  TV ao Vivo
                </span>
              </div>
              <h1 className="nc-live-channel-title text-lg sm:text-xl lg:text-2xl font-bold text-white tracking-tight leading-snug">
                {isCatalogLoading ? 'Carregando canais...' : 'Selecione um canal'}
              </h1>
              <p className="text-xs sm:text-sm text-nc-text-secondary leading-relaxed">
                {isCatalogLoading
                  ? 'Preparando a vitrine de categorias e canais disponíveis.'
                  : 'Escolha um canal nas categorias à esquerda para iniciar a reprodução ao vivo e consultar a programação completa.'}
              </p>
            </div>
          </div>

          {/* Neutral Schedule Placeholder */}
          <div
            data-live-epg-list="true"
            className="flex-1 min-h-[140px] flex flex-col overflow-hidden bg-[#08090d]"
          >
            <div className="shrink-0 px-4 lg:px-5 py-2.5 border-b border-white/10 flex items-center gap-2 bg-[#0b0d13]">
              <CalendarClock className="w-4 h-4 text-white/60 shrink-0" />
              <h2 className="text-xs sm:text-sm font-semibold text-white/85 tracking-tight">
                Grade de programação
              </h2>
            </div>
            <div
              data-live-epg-scroll="true"
              className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-4 lg:px-5 py-6 flex flex-col items-center justify-center text-center text-nc-text-secondary"
            >
              <p className="text-xs sm:text-sm text-white/70 font-medium">
                Nenhum canal selecionado
              </p>
              <p className="text-xs text-nc-text-secondary mt-1 max-w-xs">
                Selecione um canal no catálogo para visualizar o programa em exibição e os próximos horários.
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
});
