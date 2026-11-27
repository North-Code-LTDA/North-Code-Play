import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Play, Info, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useXtreamCredentials } from '../context/XtreamContext';
import { MediaImage } from './MediaImage';
import { buildDirectImageUrl, normalizeImageSource } from '../utils/mediaUtils';
import { getValidYear } from '../utils/catalogRanking';
import { computeHeroItemsFromList } from '../utils/catalogIndex';
import {
  computeHeroItemsSignature,
  fetchOrReuseHeroDetails,
  getCachedHeroDetails,
  getHeroAccountScopeKey,
  getSavedHeroSlideIndex,
  HeroDomainKey,
  needsHeroDetailsFetch,
  setSavedHeroSlideIndex,
} from '../services/heroSessionCache';
import {
  getInstantCachedImageSrc,
  isAndroidPersistentImageCacheAvailable,
  scheduleBackgroundLowPriorityPreload,
} from '../services/androidImageCache';
import { usePerformanceProfile } from '../platform/performanceProfile';

export { fetchOrReuseHeroDetails };

function evaluateHeroContainerVisibility(
  heroEl: HTMLElement | null,
  containerEl: HTMLElement | null
): boolean {
  if (!heroEl) return true;
  if (typeof document !== 'undefined' && (document.hidden || document.visibilityState === 'hidden')) {
    return false;
  }

  const container =
    containerEl ?? (heroEl.closest('[data-scroll-container="true"]') as HTMLElement | null);
  const heroRect = heroEl.getBoundingClientRect();
  const containerRect = container ? container.getBoundingClientRect() : null;

  const heroHeight =
    heroRect.height > 0 ? heroRect.height : Math.max(0, heroRect.bottom - heroRect.top);
  const containerHeight = containerRect
    ? containerRect.height > 0
      ? containerRect.height
      : Math.max(0, containerRect.bottom - containerRect.top)
    : typeof window !== 'undefined'
      ? window.innerHeight || 0
      : 0;

  if (heroHeight > 0 && containerHeight > 0) {
    const containerTop = containerRect ? containerRect.top : 0;
    const containerBottom = containerTop + containerHeight;
    return heroRect.bottom > containerTop && heroRect.top < containerBottom;
  }

  // Fallback for test DOM environments without computed layout geometry (0x0 rects)
  if (container) {
    const scrollTop = container.scrollTop || 0;
    const estHeroBottom =
      heroEl.offsetHeight > 0 ? (heroEl.offsetTop || 0) + heroEl.offsetHeight : 530;
    return estHeroBottom > scrollTop;
  }

  return true;
}

export interface HeroBannerProps {
  items: any[];
  onPlay: (item: any, detailsResponse?: any) => void | Promise<void>;
  onInfo: (item: any) => void;
  isPaused?: boolean;
  canContinueItem?: (item: any) => boolean;
  domain?: HeroDomainKey;
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
}

export const HeroBanner = React.memo(function HeroBanner({
  items,
  onPlay,
  onInfo,
  isPaused = false,
  canContinueItem,
  domain = 'standalone',
  scrollContainerRef,
}: HeroBannerProps) {
  const { credentials } = useXtreamCredentials();
  const { isLiteActive } = usePerformanceProfile();
  const heroRootRef = useRef<HTMLDivElement | null>(null);
  const [isPlayPending, setIsPlayPending] = useState(false);
  const playPendingRef = useRef(false);
  const playRequestSeqRef = useRef(0);
  const activePlayRequestIdRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);

  const [isInViewport, setIsInViewport] = useState<boolean>(true);
  const [isDocumentVisible, setIsDocumentVisible] = useState<boolean>(() =>
    typeof document === 'undefined'
      ? true
      : !document.hidden && document.visibilityState !== 'hidden'
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      activePlayRequestIdRef.current = null;
      playPendingRef.current = false;
    };
  }, []);

  const heroItems = useMemo(() => {
    return computeHeroItemsFromList(items);
  }, [items]);

  const itemsSignature = useMemo(() => {
    return computeHeroItemsSignature(heroItems);
  }, [heroItems]);

  const scopeKey = getHeroAccountScopeKey(credentials);
  const sequenceIdentity = `${scopeKey}::${domain}::${itemsSignature}`;
  const prevSequenceIdentityRef = useRef<string>(sequenceIdentity);

  const [currentIndex, setCurrentIndex] = useState<number>(() =>
    getSavedHeroSlideIndex(credentials, domain, itemsSignature, heroItems.length)
  );

  // Synchronize index immediately when account/domain/content signature genuinely changes
  if (prevSequenceIdentityRef.current !== sequenceIdentity) {
    prevSequenceIdentityRef.current = sequenceIdentity;
    const nextIdx = getSavedHeroSlideIndex(
      credentials,
      domain,
      itemsSignature,
      heroItems.length
    );
    if (nextIdx !== currentIndex) {
      setCurrentIndex(nextIdx);
    }
  }

  const safeCurrentIndex =
    heroItems.length > 0 ? Math.min(Math.max(0, currentIndex), heroItems.length - 1) : 0;

  useEffect(() => {
    if (heroItems.length > 0 && itemsSignature) {
      setSavedHeroSlideIndex(credentials, domain, itemsSignature, safeCurrentIndex);
    }
  }, [credentials, domain, itemsSignature, safeCurrentIndex, heroItems.length]);

  // Real visibility tracking inside the scroll container and document lifecycle
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (typeof document === 'undefined') return;
      setIsDocumentVisible(!document.hidden && document.visibilityState !== 'hidden');
    };

    if (typeof document !== 'undefined') {
      handleVisibilityChange();
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    const heroEl = heroRootRef.current;
    const container =
      scrollContainerRef?.current ??
      ((heroEl?.closest('[data-scroll-container="true"]') as HTMLElement | null) || null);

    const syncGeometryVisibility = () => {
      if (!isMountedRef.current) return;
      setIsInViewport(evaluateHeroContainerVisibility(heroRootRef.current, container));
    };

    syncGeometryVisibility();

    let observer: IntersectionObserver | null = null;
    let observerRegistered = false;
    const IO =
      typeof window !== 'undefined' && typeof (window as any).IntersectionObserver === 'function'
        ? ((window as any).IntersectionObserver as typeof IntersectionObserver)
        : typeof globalThis !== 'undefined' &&
            typeof (globalThis as any).IntersectionObserver === 'function'
          ? ((globalThis as any).IntersectionObserver as typeof IntersectionObserver)
          : null;

    if (IO && heroEl) {
      try {
        observer = new IO(
          (entries) => {
            if (!isMountedRef.current || entries.length === 0) return;
            const entry = entries[entries.length - 1];
            const intersecting = Boolean(
              entry.isIntersecting ||
                (typeof entry.intersectionRatio === 'number' && entry.intersectionRatio > 0)
            );
            setIsInViewport(intersecting);
          },
          {
            root: container ?? null,
            threshold: 0,
          }
        );
        observer.observe(heroEl);
        observerRegistered = true;
      } catch {
        observer = null;
        observerRegistered = false;
      }
    }

    const scrollTarget: EventTarget | null = !observerRegistered
      ? (container ?? (typeof window !== 'undefined' ? window : null))
      : null;

    if (scrollTarget && typeof scrollTarget.addEventListener === 'function') {
      scrollTarget.addEventListener('scroll', syncGeometryVisibility, { passive: true });
    }
    if (
      !observerRegistered &&
      typeof window !== 'undefined' &&
      typeof window.addEventListener === 'function'
    ) {
      window.addEventListener('resize', syncGeometryVisibility);
    }

    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (observer) {
        observer.disconnect();
      }
      if (scrollTarget && typeof scrollTarget.removeEventListener === 'function') {
        scrollTarget.removeEventListener('scroll', syncGeometryVisibility);
      }
      if (
        !observerRegistered &&
        typeof window !== 'undefined' &&
        typeof window.removeEventListener === 'function'
      ) {
        window.removeEventListener('resize', syncGeometryVisibility);
      }
    };
  }, [scrollContainerRef, heroItems.length]);

  const effectivelyPaused = Boolean(isPaused || !isInViewport || !isDocumentVisible);
  const isAutoRotationSuspended = isLiteActive;

  useEffect(() => {
    if (heroItems.length <= 1 || effectivelyPaused || isPlayPending || isAutoRotationSuspended) {
      return;
    }
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % heroItems.length);
    }, 8000);
    return () => clearInterval(timer);
  }, [heroItems, domain, effectivelyPaused, isPlayPending, isAutoRotationSuspended]);

  const currentItem = heroItems[safeCurrentIndex];
  const isSeries = Boolean(
    currentItem &&
      (currentItem.stream_type === 'series' ||
        Boolean(currentItem.series_id && !currentItem.stream_id))
  );
  const itemKey = currentItem
    ? String(currentItem.stream_id ?? currentItem.series_id ?? currentItem.id ?? currentItem.name)
    : '';
  const currentItemIdentity = currentItem ? `${isSeries ? 'series' : 'movie'}:${itemKey}` : '';

  const [activeDetailsState, setActiveDetailsState] = useState<{
    scopeKey: string;
    itemIdentity: string;
    data: any;
  } | null>(() => {
    const cached =
      currentItem && credentials ? getCachedHeroDetails(credentials, currentItem) : null;
    return cached
      ? { scopeKey, itemIdentity: currentItemIdentity, data: cached }
      : null;
  });

  useEffect(() => {
    activePlayRequestIdRef.current = null;
    playPendingRef.current = false;
    setIsPlayPending(false);
  }, [currentItemIdentity, scopeKey, domain]);

  useEffect(() => {
    if (!currentItem || !credentials) {
      setActiveDetailsState(null);
      return;
    }

    const fetchScopeKey = scopeKey;
    const fetchItemIdentity = currentItemIdentity;

    const cached = getCachedHeroDetails(credentials, currentItem);
    if (cached !== null) {
      setActiveDetailsState({
        scopeKey: fetchScopeKey,
        itemIdentity: fetchItemIdentity,
        data: cached,
      });
      return;
    }

    setActiveDetailsState(null);

    if (effectivelyPaused) return;
    if (!needsHeroDetailsFetch(credentials, currentItem)) return;

    let isCurrent = true;
    const abortController =
      typeof AbortController !== 'undefined' ? new AbortController() : null;

    fetchOrReuseHeroDetails(credentials, currentItem, {
      signal: abortController?.signal,
      requireEpisodes: false,
    }).then((res) => {
      if (isCurrent && !abortController?.signal.aborted && res) {
        setActiveDetailsState({
          scopeKey: fetchScopeKey,
          itemIdentity: fetchItemIdentity,
          data: res,
        });
      }
    });

    return () => {
      isCurrent = false;
      abortController?.abort();
    };
  }, [currentItem, credentials, effectivelyPaused, scopeKey, currentItemIdentity]);

  // Synchronously validate details against current account scope and current item identity
  // so stale details from a previous slide or account are never rendered or passed to onPlay
  const activeDetailsResponse =
    activeDetailsState &&
    activeDetailsState.scopeKey === scopeKey &&
    activeDetailsState.itemIdentity === currentItemIdentity
      ? activeDetailsState.data
      : currentItem && credentials
        ? getCachedHeroDetails(credentials, currentItem)
        : null;

  // Gradual preparation of at most the single immediate next slide on Android after stabilizing current slide
  useEffect(() => {
    if (
      effectivelyPaused ||
      isAutoRotationSuspended ||
      heroItems.length <= 1 ||
      !credentials?.serverUrl ||
      !isAndroidPersistentImageCacheAvailable()
    ) {
      return;
    }

    const nextIndex = (safeCurrentIndex + 1) % heroItems.length;
    const nextItem = heroItems[nextIndex];
    if (!nextItem) return;

    const timer = setTimeout(() => {
      if (!isMountedRef.current || effectivelyPaused || isAutoRotationSuspended) return;
      const cachedNext = getCachedHeroDetails(credentials, nextItem);
      const rawNextImg =
        normalizeImageSource(cachedNext?.info?.backdrop_path) ||
        normalizeImageSource(nextItem.backdrop_path) ||
        normalizeImageSource(nextItem.cover) ||
        normalizeImageSource(nextItem.stream_icon);
      if (!rawNextImg) return;
      const resolvedNextUrl = buildDirectImageUrl(rawNextImg, credentials.serverUrl);
      if (!resolvedNextUrl || getInstantCachedImageSrc(resolvedNextUrl)) return;
      scheduleBackgroundLowPriorityPreload([resolvedNextUrl]);
    }, 600);

    return () => {
      clearTimeout(timer);
    };
  }, [effectivelyPaused, isAutoRotationSuspended, safeCurrentIndex, heroItems, credentials]);

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

  const canContinue = Boolean(canContinueItem?.(currentItem));
  const synopsisText =
    activeDetails?.plot ||
    activeDetails?.overview ||
    currentItem.plot ||
    currentItem.overview ||
    '';
  const genreLabel = activeDetails?.genre || currentItem.genre || currentItem.category_name;
  const releaseLabel =
    activeDetails?.releasedate ||
    activeDetails?.releaseDate ||
    currentItem.releasedate ||
    currentItem.releaseDate ||
    (getValidYear(currentItem) > 0 ? getValidYear(currentItem) : '');

  const imageLayerContent = hasHorizontalBackdrop ? (
    <>
      <MediaImage
        src={activeImageSrc}
        serverUrl={credentials?.serverUrl}
        alt={currentItem.name}
        itemId={itemKey}
        itemName={currentItem.name}
        priority={true}
        active={!effectivelyPaused}
        className="w-full h-full object-cover object-center opacity-85"
      />
      <div
        data-hero-scrim-primary="true"
        className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/55 to-black/15"
      />
      <div
        data-hero-scrim-secondary="true"
        className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/55 to-transparent"
      />
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
          active={!effectivelyPaused}
          className="h-full max-h-[260px] sm:max-h-[360px] md:max-h-[420px] w-auto aspect-[2/3] object-contain rounded-xl shadow-2xl border border-white/15"
        />
      </div>
      <div
        data-hero-scrim-primary="true"
        className="absolute inset-0 bg-gradient-to-t from-[#08090d] via-[#08090d]/70 to-transparent"
      />
      <div
        data-hero-scrim-secondary="true"
        className="absolute inset-0 bg-gradient-to-r from-[#08090d] via-[#08090d]/90 to-transparent"
      />
    </div>
  ) : (
    <div className="w-full h-full bg-gradient-to-br from-[#171923] via-[#0e1017] to-[#08090d]" />
  );

  const textLayerContent = (
    <>
      <h1 className="nc-heading-hero nc-tv-hero-title font-bold text-white tracking-tight drop-shadow-lg break-words whitespace-normal text-wrap">
        {currentItem.name}
      </h1>

      <div className="flex flex-wrap items-center gap-2.5 nc-text-subtitle text-white/85 mb-3 mt-2.5">
        <span className="text-white/95 font-semibold">
          {isSeries ? 'Série' : 'Filme'}
        </span>
        {genreLabel && (
          <>
            <span className="text-white/40">•</span>
            <span className="text-white/85 break-words">{genreLabel}</span>
          </>
        )}
        {releaseLabel && (
          <>
            <span className="text-white/40">•</span>
            <span className="text-white/90 font-medium">{releaseLabel}</span>
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
    </>
  );

  return (
    <div
      ref={heroRootRef}
      className="nc-tv-hero w-full shrink-0 px-4 sm:px-6 md:px-10 pt-2 sm:pt-3 pb-2 bg-nc-bg"
    >
      <div
        data-hero-stage="true"
        data-hero-image-mode={imageMode}
        data-hero-paused={effectivelyPaused ? 'true' : 'false'}
        data-hero-index={String(safeCurrentIndex)}
        data-hero-lite-motion={isLiteActive ? 'true' : 'false'}
        data-hero-autorotate={isAutoRotationSuspended ? 'paused-lite' : 'active'}
        className="relative w-full min-h-[320px] sm:min-h-[390px] md:min-h-[470px] lg:min-h-[530px] rounded-2xl md:rounded-3xl overflow-hidden border border-white/10 bg-[#0b0c10] shadow-[0_20px_50px_rgba(0,0,0,0.65)] flex flex-col justify-end p-5 sm:p-8 md:p-11 lg:p-14"
      >
        {isLiteActive ? (
          <div key={itemKey} data-hero-image-layer="true" className="absolute inset-0 z-0">
            {imageLayerContent}
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            <motion.div
              key={itemKey}
              data-hero-image-layer="true"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6 }}
              className="absolute inset-0 z-0"
            >
              {imageLayerContent}
            </motion.div>
          </AnimatePresence>
        )}

        <div className="relative z-10 max-w-2xl w-full flex flex-col items-start justify-end">
          {isLiteActive ? (
            <div key={itemKey} data-hero-text-layer="true" className="w-full">
              {textLayerContent}
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={itemKey}
                data-hero-text-layer="true"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.4 }}
                className="w-full"
              >
                {textLayerContent}
              </motion.div>
            </AnimatePresence>
          )}

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
                  const requestId = ++playRequestSeqRef.current;
                  activePlayRequestIdRef.current = requestId;
                  playPendingRef.current = true;
                  setIsPlayPending(true);
                  Promise.resolve(maybePromise).finally(() => {
                    if (activePlayRequestIdRef.current !== requestId) {
                      return;
                    }
                    activePlayRequestIdRef.current = null;
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
