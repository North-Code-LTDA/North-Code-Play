import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Play, Info, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useXtreamCredentials } from '../context/XtreamContext';
import { XtreamService } from '../services/xtreamService';
import { MediaImage } from './MediaImage';
import { normalizeImageSource } from '../utils/mediaUtils';
import { getValidYear } from '../utils/catalogRanking';
import { computeHeroItemsFromList } from '../utils/catalogIndex';

const inFlightHeroDetailsMap = new Map<string, Promise<any>>();

/**
 * Starts or reuses an in-flight getVodInfo / getSeriesInfo request for a HeroBanner item,
 * preventing duplicate requests when the user clicks "Continuar" / "Assistir" before
 * initial HeroBanner metadata arrives.
 */
export function fetchOrReuseHeroDetails(credentials: any, item: any): Promise<any> {
  if (!credentials?.serverUrl || !credentials?.username || !item) {
    return Promise.resolve(null);
  }
  const isMovie =
    item.stream_type === 'movie' || Boolean(item.stream_id && !item.series_id);
  const targetId = isMovie
    ? item.stream_id
    : item.series_id ?? item.stream_id ?? item.id;
  if (targetId === undefined || targetId === null || targetId === '') {
    return Promise.resolve(null);
  }

  const key = `${credentials.serverUrl}|${credentials.username}|${isMovie ? 'vod' : 'series'}|${targetId}`;
  const existing = inFlightHeroDetailsMap.get(key);
  if (existing) {
    return existing;
  }

  const promise = (
    isMovie
      ? XtreamService.getVodInfo(credentials, targetId)
      : XtreamService.getSeriesInfo(credentials, targetId)
  )
    .catch((error) => {
      console.warn('Failed to fetch details for hero item:', error);
      return null;
    })
    .finally(() => {
      if (inFlightHeroDetailsMap.get(key) === promise) {
        inFlightHeroDetailsMap.delete(key);
      }
    });

  inFlightHeroDetailsMap.set(key, promise);
  return promise;
}

export interface HeroBannerProps {
  items: any[];
  onPlay: (item: any, detailsResponse?: any) => void | Promise<void>;
  onInfo: (item: any) => void;
  isPaused?: boolean;
  canContinueItem?: (item: any) => boolean;
}

export const HeroBanner = React.memo(function HeroBanner({
  items,
  onPlay,
  onInfo,
  isPaused = false,
  canContinueItem,
}: HeroBannerProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const { credentials } = useXtreamCredentials();
  const [activeDetailsResponse, setActiveDetailsResponse] = useState<any>(null);
  const [isPlayPending, setIsPlayPending] = useState(false);
  const playPendingRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const heroItems = useMemo(() => {
    return computeHeroItemsFromList(items);
  }, [items]);

  useEffect(() => {
    setCurrentIndex(0);
  }, [heroItems]);

  useEffect(() => {
    if (heroItems.length <= 1 || isPaused || isPlayPending) return;
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % heroItems.length);
    }, 8000);
    return () => clearInterval(timer);
  }, [heroItems.length, isPaused, isPlayPending]);

  const currentItem = heroItems[currentIndex];

  useEffect(() => {
    playPendingRef.current = false;
    setIsPlayPending(false);
  }, [currentItem, credentials]);

  useEffect(() => {
    if (!currentItem || !credentials || isPaused) return;

    let isCurrent = true;
    setActiveDetailsResponse(null);

    fetchOrReuseHeroDetails(credentials, currentItem).then((res) => {
      if (isCurrent && res) {
        setActiveDetailsResponse(res);
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [currentItem, credentials, isPaused]);

  if (heroItems.length === 0 || !currentItem) return null;

  const activeDetails = activeDetailsResponse?.info || null;

  const horizontalBackdrop =
    normalizeImageSource(activeDetails?.backdrop_path) ||
    normalizeImageSource(currentItem.backdrop_path) ||
    '';
  const verticalCover =
    normalizeImageSource(currentItem.stream_icon) ||
    normalizeImageSource(currentItem.cover) ||
    normalizeImageSource(activeDetails?.movie_image) ||
    normalizeImageSource(activeDetails?.cover) ||
    '';

  const hasHorizontalBackdrop = Boolean(horizontalBackdrop);
  const hasVerticalCoverOnly = !hasHorizontalBackdrop && Boolean(verticalCover);
  const activeImageSrc = horizontalBackdrop || verticalCover || '';
  const imageMode = hasHorizontalBackdrop
    ? 'horizontal-backdrop'
    : hasVerticalCoverOnly
      ? 'vertical-cover'
      : 'none';

  const isSeries =
    currentItem.stream_type === 'series' ||
    Boolean(currentItem.series_id && !currentItem.stream_id);
  const canContinue = Boolean(canContinueItem?.(currentItem));
  const itemKey = String(
    currentItem.stream_id || currentItem.series_id || currentItem.id || currentItem.name
  );
  const synopsisText =
    activeDetails?.plot ||
    activeDetails?.overview ||
    currentItem.plot ||
    currentItem.overview ||
    '';

  return (
    <div className="nc-tv-hero w-full shrink-0 px-4 sm:px-6 md:px-10 pt-2 sm:pt-3 pb-2 bg-nc-bg">
      <div
        data-hero-stage="true"
        data-hero-image-mode={imageMode}
        className="relative w-full min-h-[320px] sm:min-h-[390px] md:min-h-[470px] lg:min-h-[530px] rounded-2xl md:rounded-3xl overflow-hidden border border-white/10 bg-[#0b0c10] shadow-[0_20px_50px_rgba(0,0,0,0.65)] flex flex-col justify-end p-5 sm:p-8 md:p-11 lg:p-14"
      >
        <AnimatePresence mode="popLayout">
          <motion.div
            key={itemKey}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            className="absolute inset-0 z-0"
          >
            {hasHorizontalBackdrop ? (
              <>
                <MediaImage
                  src={activeImageSrc}
                  serverUrl={credentials?.serverUrl}
                  alt={currentItem.name}
                  itemId={itemKey}
                  itemName={currentItem.name}
                  priority={true}
                  className="w-full h-full object-cover object-center opacity-85"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/55 to-black/15" />
                <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/55 to-transparent" />
              </>
            ) : hasVerticalCoverOnly ? (
              <div className="relative w-full h-full bg-gradient-to-br from-[#171923] via-[#0e1017] to-[#08090d]">
                <div className="absolute inset-y-0 right-0 w-full sm:w-3/5 flex items-center justify-center sm:justify-end pr-4 sm:pr-8 md:pr-14 py-5 sm:py-7 opacity-45 sm:opacity-90">
                  <MediaImage
                    src={activeImageSrc}
                    serverUrl={credentials?.serverUrl}
                    alt={currentItem.name}
                    itemId={itemKey}
                    itemName={currentItem.name}
                    priority={true}
                    className="h-full max-h-[260px] sm:max-h-[360px] md:max-h-[420px] w-auto aspect-[2/3] object-contain rounded-xl shadow-2xl border border-white/15"
                  />
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-[#08090d] via-[#08090d]/70 to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-r from-[#08090d] via-[#08090d]/90 to-transparent" />
              </div>
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-[#171923] via-[#0e1017] to-[#08090d]" />
            )}
          </motion.div>
        </AnimatePresence>

        <div className="relative z-10 max-w-2xl w-full flex flex-col items-start justify-end">
          <AnimatePresence mode="wait">
            <motion.div
              key={itemKey}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              transition={{ duration: 0.4 }}
              className="w-full"
            >
              <h1 className="nc-heading-hero nc-tv-hero-title font-bold text-white tracking-tight drop-shadow-lg break-words whitespace-normal text-wrap">
                {currentItem.name}
              </h1>

              <div className="flex flex-wrap items-center gap-2.5 nc-text-subtitle text-white/85 mb-3 mt-2.5">
                <span className="text-white/95 font-semibold">
                  {isSeries ? 'Série' : 'Filme'}
                </span>
                {(activeDetails?.genre || currentItem.category_name) && (
                  <>
                    <span className="text-white/40">•</span>
                    <span className="text-white/85 break-words">
                      {activeDetails?.genre || currentItem.category_name}
                    </span>
                  </>
                )}
                {(activeDetails?.releasedate || getValidYear(currentItem) > 0) && (
                  <>
                    <span className="text-white/40">•</span>
                    <span className="text-white/90 font-medium">
                      {activeDetails?.releasedate || getValidYear(currentItem) || ''}
                    </span>
                  </>
                )}
                {currentItem.rating && currentItem.rating !== '0' && (
                  <>
                    <span className="text-white/40">•</span>
                    <span className="bg-white/15 px-2 py-0.5 rounded nc-text-meta text-amber-400 font-semibold">
                      ★ {currentItem.rating}
                    </span>
                  </>
                )}
              </div>

              {synopsisText ? (
                <p className="nc-text-reading text-white/85 line-clamp-2 sm:line-clamp-3 md:line-clamp-4 mb-5 max-w-xl drop-shadow">
                  {synopsisText}
                </p>
              ) : (
                <p className="nc-text-reading text-white/70 line-clamp-2 mb-5 max-w-xl">
                  Explore os detalhes completos ou inicie a reprodução imediata no North Code Play.
                </p>
              )}
            </motion.div>
          </AnimatePresence>

          <div data-nav-row="true" className="nc-action-group relative z-30 mt-1">
            <button
              type="button"
              data-hero-action="play"
              data-hero-resume={canContinue ? 'true' : 'false'}
              data-hero-loading={isPlayPending ? 'true' : 'false'}
              aria-busy={isPlayPending ? 'true' : 'false'}
              onClick={() => {
                if (playPendingRef.current) return;
                const maybePromise = onPlay(currentItem, activeDetailsResponse);
                if (maybePromise && typeof (maybePromise as Promise<void>).then === 'function') {
                  playPendingRef.current = true;
                  setIsPlayPending(true);
                  Promise.resolve(maybePromise).finally(() => {
                    playPendingRef.current = false;
                    if (isMountedRef.current) {
                      setIsPlayPending(false);
                    }
                  });
                }
              }}
              className="flex-1 sm:flex-none items-center justify-center flex gap-2.5 bg-white hover:bg-white/90 text-black px-5 sm:px-7 py-2.5 sm:py-3 rounded-full font-bold transition-all active:scale-95 shadow-lg"
            >
              {isPlayPending ? (
                <Loader2
                  data-hero-spinner="true"
                  className="w-5 h-5 animate-spin text-black shrink-0"
                />
              ) : (
                <Play className="w-5 h-5 fill-black shrink-0" />
              )}
              <span>{canContinue ? 'Continuar' : 'Assistir'}</span>
              {isPlayPending && (
                <span className="text-xs font-semibold opacity-75">Carregando...</span>
              )}
            </button>
            <button
              type="button"
              data-hero-action="info"
              onClick={() => onInfo(currentItem)}
              className="flex-1 sm:flex-none items-center justify-center flex gap-2 bg-white/20 hover:bg-white/30 backdrop-blur-md text-white border border-white/15 px-5 sm:px-7 py-2.5 sm:py-3 rounded-full font-semibold transition-all active:scale-95"
            >
              <Info className="w-5 h-5 shrink-0" />
              <span>Mais informações</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
