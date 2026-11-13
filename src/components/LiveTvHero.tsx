import React from 'react';
import { Heart, Loader2, Maximize2, Play, TvMinimalPlay } from 'lucide-react';
import { VideoPlayer } from './VideoPlayer';
import { MediaImage } from './MediaImage';
import { LiveChannelGroup, parseChannelVariantSuffix } from '../utils/liveChannelGroups';
import type { ResolvedNowPlaying } from '../utils/epgUtils';

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
}: LiveTvHeroProps) {
  const activeStreamResolution = activeVariantStream?.name
    ? parseChannelVariantSuffix(activeVariantStream.name).resolution
    : null;

  const activeVariantId = activeVariantStream?.stream_id ?? activeVariantStream?.id;
  const primaryStreamId =
    selectedGroup?.primaryStream?.stream_id ?? selectedGroup?.primaryStream?.id ?? '';

  return (
    <section
      data-hero-stage="true"
      data-scroll-top-anchor="true"
      data-live-hero="true"
      aria-label="Destaque TV ao Vivo"
      className="nc-tv-hero relative w-full px-4 sm:px-6 md:px-10 pt-2 pb-5 sm:pb-7"
    >
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#121520] via-[#0b0d14] to-[#050608] shadow-[0_24px_60px_rgba(0,0,0,0.75)]">
        {/* Subtle atmospheric radial sheen matching HeroBanner contrast */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.06),transparent_55%)]"
        />

        {selectedGroup ? (
          <div
            data-live-top-section="true"
            className="nc-live-top-section relative z-10 flex flex-col md:flex-row items-stretch md:items-center gap-5 lg:gap-8 p-4 sm:p-6 lg:p-8"
          >
            {/* Left column: channel identity, real EPG summary, subtle version selector, primary actions */}
            <div
              data-live-summary-col="true"
              className="nc-live-summary-col flex-1 min-w-0 flex flex-col items-start gap-3.5 order-2 md:order-1"
            >
              {/* Channel Logo + Title + Live marker */}
              <div className="flex items-center gap-3.5 w-full min-w-0">
                <div className="nc-live-channel-logo w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-black/65 border border-white/15 flex items-center justify-center overflow-hidden shrink-0 p-2 shadow-inner">
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

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="nc-text-meta inline-flex items-center gap-1.5 font-semibold uppercase tracking-wider text-white/80">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                      Ao Vivo
                    </span>
                    {activeStreamResolution && (
                      <span className="nc-badge-info text-white/60 font-semibold uppercase">
                        • {activeStreamResolution}
                      </span>
                    )}
                  </div>
                  <h1 className="nc-live-channel-title nc-heading-section font-bold text-white line-clamp-2 whitespace-normal break-words w-full">
                    {selectedGroup.displayName}
                  </h1>
                </div>
              </div>

              {/* Current Program Block (strictly grounded in real EPG or honest unavailable state) */}
              <div
                data-live-now-playing="true"
                className="nc-live-now-playing w-full rounded-xl bg-white/[0.04] border border-white/10 px-3.5 py-3 flex flex-col gap-1.5"
              >
                {loadingEpg ? (
                  <div
                    data-epg-state="loading"
                    className="flex items-center gap-2 nc-text-subtitle text-nc-text-secondary"
                  >
                    <Loader2 className="w-4 h-4 animate-spin text-white/75 shrink-0" />
                    <span>Carregando programação...</span>
                  </div>
                ) : epgError ? (
                  <p
                    data-epg-state="error"
                    className="nc-text-subtitle text-nc-text-secondary"
                  >
                    Programação indisponível
                  </p>
                ) : nowPlaying ? (
                  <>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <span className="nc-text-meta uppercase tracking-wider font-semibold text-white/60">
                        Passando agora
                      </span>
                      {nowPlaying.timeSlot && (
                        <span className="nc-text-meta font-mono text-white/75 shrink-0">
                          {nowPlaying.timeSlot}
                        </span>
                      )}
                    </div>

                    {nowPlaying.title && (
                      <p
                        data-live-now-playing-title="true"
                        className="nc-text-subtitle font-semibold text-white line-clamp-2 whitespace-normal break-words"
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
                        className="w-full h-1 rounded-full bg-white/15 overflow-hidden my-0.5"
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
                        className="nc-live-now-playing-desc nc-text-meta text-nc-text-secondary line-clamp-2 whitespace-normal break-words"
                      >
                        {nowPlaying.description}
                      </p>
                    )}
                  </>
                ) : (
                  <p
                    data-epg-state="empty"
                    className="nc-text-subtitle text-nc-text-secondary"
                  >
                    Programação indisponível
                  </p>
                )}
              </div>

              {/* Clean Subtle Channel Version Selector (only when >1 version exists) */}
              {selectedGroup.isGrouped && selectedGroup.variants.length > 0 && (
                <div
                  key={selectedGroup.groupId}
                  className="nc-live-variants-bar w-full min-w-0 flex flex-wrap sm:flex-nowrap items-center gap-2.5"
                >
                  <span className="nc-text-meta font-medium text-white/60 shrink-0">
                    Versão:
                  </span>
                  <div
                    data-nav-row="true"
                    data-live-variants-row="true"
                    className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide min-w-0 max-w-full py-0.5 touch-pan-x"
                  >
                    <button
                      type="button"
                      data-variant-active={selectedResolutionMode === 'auto' ? 'true' : 'false'}
                      onClick={() => onSelectResolutionMode('auto')}
                      className={`px-3 py-1 rounded-lg nc-text-meta font-semibold transition-colors shrink-0 ${
                        selectedResolutionMode === 'auto'
                          ? 'bg-white text-black'
                          : 'bg-white/[0.08] text-white/80 hover:bg-white/[0.16] hover:text-white'
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
                          data-variant-active={isSelectedVariant ? 'true' : 'false'}
                          onClick={() => onSelectResolutionMode(v.stream)}
                          className={`px-3 py-1 rounded-lg nc-text-meta font-semibold transition-colors shrink-0 flex items-center gap-1.5 ${
                            isSelectedVariant
                              ? 'bg-white text-black'
                              : isActiveStream
                                ? 'bg-white/[0.18] text-white border border-white/25'
                                : 'bg-white/[0.08] text-white/80 hover:bg-white/[0.16] hover:text-white'
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

              {/* Primary Hero Actions matching HeroBanner visual language */}
              <div data-nav-row="true" className="nc-action-group pt-0.5">
                <button
                  type="button"
                  data-live-hero-play="true"
                  data-autofocus="true"
                  onClick={() => {
                    if (playbackError) {
                      onRetryPlayback();
                    } else {
                      onExpandFullscreen();
                    }
                  }}
                  className="nc-tv-details-action inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-white text-black hover:bg-white/90 font-bold nc-text-subtitle transition-colors shadow-lg"
                >
                  {playbackError ? (
                    <>
                      <Play className="w-4 h-4 fill-current shrink-0" />
                      <span>Tentar novamente</span>
                    </>
                  ) : (
                    <>
                      <Maximize2 className="w-4 h-4 shrink-0" />
                      <span>Assistir</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  data-live-hero-favorite="true"
                  aria-label={
                    isFavorited ? 'Remover canal dos favoritos' : 'Adicionar canal aos favoritos'
                  }
                  aria-pressed={isFavorited}
                  onClick={() => onToggleFavorite(selectedGroup)}
                  className="nc-tv-details-action-icon inline-flex items-center justify-center w-10 h-10 rounded-full bg-white/[0.1] hover:bg-white/[0.2] border border-white/20 text-white transition-colors"
                >
                  <Heart
                    className={`w-4 h-4 shrink-0 ${
                      isFavorited ? 'fill-white text-white' : 'text-white'
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Right column: Embedded 16:9 Live Preview */}
            <div
              data-live-preview-wrapper="true"
              className="w-full md:w-[48%] lg:w-[50%] md:max-w-[34rem] shrink-0 order-1 md:order-2 flex items-center"
            >
              <div className="w-full aspect-video rounded-xl overflow-hidden bg-black border border-white/10 shadow-[0_18px_45px_rgba(0,0,0,0.85)]">
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
          </div>
        ) : (
          /* Neutral fallback stage before a channel is available or selected */
          <div
            data-live-hero-neutral="true"
            className="relative z-10 flex flex-col md:flex-row items-center gap-6 p-6 sm:p-8 min-h-[14rem]"
          >
            <div className="flex-1 min-w-0 flex flex-col items-start gap-2">
              <span className="nc-text-meta uppercase tracking-wider text-white/55 font-semibold">
                TV ao Vivo
              </span>
              <h1 className="nc-live-channel-title nc-heading-section font-bold text-white line-clamp-2 whitespace-normal break-words w-full">
                {isCatalogLoading ? 'Carregando canais...' : 'Selecione um canal'}
              </h1>
              <p className="nc-text-subtitle text-nc-text-secondary">
                {isCatalogLoading
                  ? 'Preparando a grade de canais disponíveis.'
                  : 'Escolha um canal nas categorias abaixo para assistir ao vivo.'}
              </p>
            </div>

            <div className="w-full md:w-[46%] lg:w-[48%] md:max-w-[32rem] aspect-video rounded-xl bg-black/75 border border-white/10 flex flex-col items-center justify-center gap-2.5 text-white/40 shrink-0">
              {isCatalogLoading ? (
                <Loader2 className="w-8 h-8 animate-spin text-white/60" />
              ) : (
                <TvMinimalPlay className="w-10 h-10 opacity-50" />
              )}
              <span className="nc-text-meta">
                {isCatalogLoading ? 'Sincronizando canais' : 'Pré-visualização do canal'}
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
});
