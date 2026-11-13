import React from 'react';
import { Heart, Loader2, Maximize2, Play, TvMinimalPlay, X } from 'lucide-react';
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
  isDocked?: boolean;
  isDockedVisible?: boolean;
  dockTopPx?: number;
  onCloseDock?: () => void;
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
  isDocked = false,
  isDockedVisible = false,
  dockTopPx = 112,
  onCloseDock,
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

  const previewState = !selectedGroup
    ? 'idle'
    : isDocked
      ? isDockedVisible
        ? 'open'
        : 'collapsed'
      : streamUrl || isLoadingPlayback || playbackError
        ? 'open'
        : 'collapsed';

  return (
    <section
      data-scroll-top-anchor={!isDocked ? 'true' : undefined}
      data-live-hero="true"
      data-live-hero-docked={isDocked && isDockedVisible ? 'true' : 'false'}
      data-live-preview-state={previewState}
      data-nav-ignore={isDocked ? 'true' : undefined}
      inert={isDocked && !isDockedVisible ? true : undefined}
      aria-hidden={isDocked && !isDockedVisible ? 'true' : undefined}
      aria-label="Destaque TV ao Vivo"
      style={
        isDocked
          ? {
              top: isDockedVisible ? `${dockTopPx}px` : `${Math.max(0, dockTopPx - 32)}px`,
            }
          : undefined
      }
      className={
        isDocked
          ? `fixed left-0 right-0 z-40 px-4 sm:px-6 md:px-10 pt-2 pb-2 pointer-events-none transition-[top,opacity] duration-200 ease-out motion-reduce:transition-none ${
              isDockedVisible ? 'opacity-100' : 'opacity-0'
            }`
          : 'nc-tv-hero w-full shrink-0 px-4 sm:px-6 md:px-10 pt-2 sm:pt-3 pb-2 bg-nc-bg'
      }
    >
      <div
        data-hero-stage={!isDocked ? 'true' : undefined}
        data-live-dock-panel={isDocked ? 'true' : undefined}
        className={
          isDocked
            ? `relative w-full max-w-5xl mx-auto rounded-2xl overflow-hidden border border-white/15 bg-[#0b0c10]/95 backdrop-blur-xl shadow-[0_24px_60px_rgba(0,0,0,0.9)] p-3 sm:p-4 select-none ${
                isDockedVisible ? 'pointer-events-auto' : 'pointer-events-none'
              }`
            : 'relative w-full min-h-[320px] sm:min-h-[390px] md:min-h-[470px] lg:min-h-[530px] rounded-2xl md:rounded-3xl overflow-hidden border border-white/10 bg-[#0b0c10] shadow-[0_20px_50px_rgba(0,0,0,0.65)] flex flex-col justify-center p-5 sm:p-8 md:p-11 lg:p-14 select-none'
        }
      >
        {/* Shared HeroBanner atmospheric background layers */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#171923] via-[#0e1017] to-[#08090d]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_75%_25%,rgba(255,255,255,0.08),transparent_55%)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/95 via-black/55 to-black/15"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0b0c10] via-[#0b0c10]/35 to-transparent"
        />

        {isDocked && onCloseDock && (
          <button
            type="button"
            data-live-dock-close="true"
            tabIndex={-1}
            aria-label="Recolher pré-visualização"
            onClick={onCloseDock}
            className="absolute top-2.5 right-2.5 z-30 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-white/80 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {selectedGroup ? (
          <div
            data-live-top-section="true"
            className={
              isDocked
                ? 'nc-live-top-section relative z-10 flex flex-row items-center gap-3.5 sm:gap-5 w-full pr-7'
                : 'nc-live-top-section relative z-10 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-5 lg:gap-8 w-full'
            }
          >
            {/* Left column: channel identity, real EPG summary, version selector, HeroBanner-aligned actions */}
            <div
              data-live-summary-col="true"
              className={
                isDocked
                  ? 'nc-live-summary-col flex-1 min-w-0 flex flex-col items-start gap-2 order-2 md:order-1'
                  : 'nc-live-summary-col flex-1 min-w-0 max-w-2xl flex flex-col items-start gap-3.5 order-2 md:order-1'
              }
            >
              {/* Domain + Resolution Metadata Row matching HeroBanner */}
              <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
                <span className="px-2.5 py-0.5 rounded-md text-xs font-bold uppercase tracking-wider bg-white/15 text-white border border-white/20 backdrop-blur-sm inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                  Ao Vivo
                </span>
                {activeStreamResolution && (
                  <span className="nc-badge-info px-2 py-0.5 rounded-md text-xs font-semibold uppercase bg-white/10 text-white/90 border border-white/15">
                    {activeStreamResolution}
                  </span>
                )}
                {nowPlaying?.timeSlot && (
                  <span className="nc-text-meta font-mono text-white/80 font-medium">
                    • {nowPlaying.timeSlot}
                  </span>
                )}
              </div>

              {/* Channel Logo + Hero Title */}
              <div className="flex items-center gap-3 sm:gap-3.5 w-full min-w-0">
                <div
                  className={
                    isDocked
                      ? 'nc-live-channel-logo w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-black/40 border border-white/15 flex items-center justify-center overflow-hidden shrink-0 p-1.5'
                      : 'nc-live-channel-logo w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-black/40 border border-white/15 flex items-center justify-center overflow-hidden shrink-0 p-2'
                  }
                >
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

                <h1
                  className={
                    isDocked
                      ? 'nc-live-channel-title nc-text-subtitle sm:text-lg font-extrabold text-white tracking-tight drop-shadow-lg line-clamp-1 whitespace-normal break-words flex-1 min-w-0'
                      : 'nc-live-channel-title nc-heading-hero nc-tv-hero-title font-extrabold text-white tracking-tight drop-shadow-lg line-clamp-2 whitespace-normal break-words flex-1 min-w-0'
                  }
                >
                  {selectedGroup.displayName}
                </h1>
              </div>

              {/* Current Program Block (strictly grounded in real EPG or honest unavailable state) */}
              <div
                data-live-now-playing="true"
                className={
                  isDocked
                    ? 'nc-live-now-playing w-full flex flex-col gap-1'
                    : 'nc-live-now-playing w-full rounded-xl bg-white/[0.04] border border-white/10 px-3.5 py-3 flex flex-col gap-1.5'
                }
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
                    {!isDocked && (
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
                    )}

                    {nowPlaying.title && (
                      <p
                        data-live-now-playing-title="true"
                        className="nc-text-subtitle font-semibold text-white line-clamp-1 sm:line-clamp-2 whitespace-normal break-words"
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
                        className="w-full max-w-md h-1.5 rounded-full bg-white/20 overflow-hidden my-0.5"
                      >
                        <div
                          className="h-full bg-white rounded-full transition-[width] duration-300"
                          style={{ width: `${nowPlaying.progressPercent}%` }}
                        />
                      </div>
                    )}

                    {!isDocked && nowPlaying.description && (
                      <p
                        data-live-now-playing-desc="true"
                        className="nc-live-now-playing-desc nc-text-reading text-white/80 line-clamp-2 whitespace-normal break-words"
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
                  className="nc-live-variants-bar w-full min-w-0 flex flex-wrap sm:flex-nowrap items-center gap-2"
                >
                  <span className="nc-text-meta font-medium text-white/60 shrink-0">
                    Versão:
                  </span>
                  <div
                    data-nav-row={!isDocked ? 'true' : undefined}
                    data-live-variants-row="true"
                    className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide min-w-0 max-w-full py-0.5 touch-pan-x"
                  >
                    <button
                      type="button"
                      tabIndex={isDocked ? -1 : 0}
                      data-variant-active={selectedResolutionMode === 'auto' ? 'true' : 'false'}
                      onClick={() => onSelectResolutionMode('auto')}
                      className={`px-3 py-1 rounded-full nc-text-meta font-semibold transition-colors shrink-0 cursor-pointer ${
                        selectedResolutionMode === 'auto'
                          ? 'bg-white text-black'
                          : 'bg-white/15 text-white/85 hover:bg-white/25 hover:text-white border border-white/15'
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
                          tabIndex={isDocked ? -1 : 0}
                          data-variant-active={isSelectedVariant ? 'true' : 'false'}
                          onClick={() => onSelectResolutionMode(v.stream)}
                          className={`px-3 py-1 rounded-full nc-text-meta font-semibold transition-colors shrink-0 flex items-center gap-1.5 cursor-pointer ${
                            isSelectedVariant
                              ? 'bg-white text-black'
                              : isActiveStream
                                ? 'bg-white/25 text-white border border-white/30'
                                : 'bg-white/15 text-white/85 hover:bg-white/25 hover:text-white border border-white/15'
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
              <div
                data-nav-row={!isDocked ? 'true' : undefined}
                className="nc-action-group flex flex-wrap items-center gap-2.5 sm:gap-3 pt-0.5"
              >
                <button
                  type="button"
                  tabIndex={isDocked ? -1 : 0}
                  data-live-hero-play="true"
                  data-autofocus={!isDocked ? 'true' : undefined}
                  onClick={() => {
                    if (playbackError) {
                      onRetryPlayback();
                    } else {
                      onExpandFullscreen();
                    }
                  }}
                  className={
                    isDocked
                      ? 'nc-tv-details-action flex items-center gap-2 bg-white hover:bg-white/90 text-black px-4 py-1.5 rounded-full font-bold nc-text-meta transition-transform active:scale-95 shadow-lg cursor-pointer'
                      : 'nc-tv-details-action flex items-center gap-2.5 bg-white hover:bg-white/90 text-black px-5 sm:px-7 py-2.5 sm:py-3 rounded-full font-bold nc-text-subtitle transition-transform active:scale-95 shadow-lg cursor-pointer'
                  }
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
                  tabIndex={isDocked ? -1 : 0}
                  data-live-hero-favorite="true"
                  aria-label={
                    isFavorited ? 'Remover canal dos favoritos' : 'Adicionar canal aos favoritos'
                  }
                  aria-pressed={isFavorited}
                  onClick={() => onToggleFavorite(selectedGroup)}
                  className={
                    isDocked
                      ? 'nc-tv-details-action-icon flex items-center justify-center w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-md text-white border border-white/15 transition-colors cursor-pointer'
                      : 'nc-tv-details-action-icon flex items-center justify-center w-11 h-11 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-md text-white border border-white/15 transition-colors cursor-pointer'
                  }
                >
                  <Heart
                    className={`w-4 h-4 shrink-0 ${
                      isFavorited ? 'fill-white text-white' : 'text-white'
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Right column: Single Embedded 16:9 Live Preview */}
            <div
              data-live-preview-wrapper="true"
              className={
                isDocked
                  ? 'w-36 sm:w-48 md:w-60 shrink-0 order-1 md:order-2 flex items-center'
                  : 'w-full md:w-[48%] lg:w-[50%] md:max-w-[34rem] shrink-0 order-1 md:order-2 flex items-center'
              }
            >
              <div className="w-full aspect-video rounded-xl md:rounded-2xl overflow-hidden bg-black border border-white/15 shadow-[0_20px_50px_rgba(0,0,0,0.85)]">
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
          /* Neutral fallback stage before a channel is selected, matching HeroBanner stage geometry */
          <div
            data-live-hero-neutral="true"
            className="relative z-10 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-6 w-full"
          >
            <div className="flex-1 min-w-0 max-w-2xl flex flex-col items-start gap-2.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="px-2.5 py-0.5 rounded-md text-xs font-bold uppercase tracking-wider bg-white/15 text-white border border-white/20 backdrop-blur-sm">
                  TV ao Vivo
                </span>
              </div>
              <h1 className="nc-live-channel-title nc-heading-hero nc-tv-hero-title font-extrabold text-white tracking-tight drop-shadow-lg line-clamp-2 whitespace-normal break-words w-full">
                {isCatalogLoading ? 'Carregando canais...' : 'Selecione um canal'}
              </h1>
              <p className="nc-text-reading text-white/80 max-w-xl">
                {isCatalogLoading
                  ? 'Preparando a grade de canais disponíveis.'
                  : 'Escolha um canal nas categorias abaixo para assistir ao vivo.'}
              </p>
            </div>

            <div className="w-full md:w-[48%] lg:w-[50%] md:max-w-[34rem] aspect-video rounded-xl md:rounded-2xl bg-black/65 border border-white/10 flex flex-col items-center justify-center gap-2.5 text-white/45 shrink-0 shadow-[0_20px_50px_rgba(0,0,0,0.85)]">
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
