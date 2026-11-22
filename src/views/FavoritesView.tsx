import React, { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { Play, Tv, Film, PlaySquare, Heart, AlertCircle, RefreshCw, Search, X } from 'lucide-react';
import { useFavorites, FavoriteItem } from '../hooks/useFavorites';
import { useXtreamCredentials } from '../context/XtreamContext';
import { MovieDetails } from '../components/MovieDetails';
import { SeriesDetails } from '../components/SeriesDetails';
import { HorizontalRow } from '../components/HorizontalRow';
import { MediaImage } from '../components/MediaImage';
import { buildDirectMediaUrl, normalizeImageSource } from '../utils/mediaUtils';
import { recordPlaybackPosition } from '../utils/playbackHistory';
import { useVirtualWindow } from '../hooks/useVirtualWindow';
import {
  useBackHandler,
  BACK_PRIORITY,
  focusElementSafely,
  pushFocusMemory,
  restoreVirtualItemByKey,
} from '../navigation';

export type FavoritesFilterType = 'all' | 'live' | 'movie' | 'series';

interface FavoritesViewProps {
  onPlay: (
    url: string,
    title: string,
    startAt?: number,
    streamId?: string | number,
    contentType?: 'live' | 'movie' | 'episode',
    channelName?: string,
    programTitle?: string,
    onNext?: () => void,
    onPrevious?: () => void,
    externalSubtitles?: any[]
  ) => void;
  searchQuery?: string;
}

const FILTER_TABS: ReadonlyArray<{
  id: FavoritesFilterType;
  label: string;
}> = [
  { id: 'all', label: 'Todos' },
  { id: 'live', label: 'Canais' },
  { id: 'movie', label: 'Filmes' },
  { id: 'series', label: 'Séries' },
];

const SECTION_ORDER: ReadonlyArray<'live' | 'movie' | 'series'> = ['live', 'movie', 'series'];

const FAVORITES_GRID_ACTIVE_IMAGE_BUDGET = 24;

function isFavoriteRemovalShortcutKey(e: React.KeyboardEvent<HTMLElement>): boolean {
  if (e.altKey) return false;
  const key = e.key;
  if (
    key === 'f' ||
    key === 'F' ||
    key === 'Delete' ||
    key === 'Backspace' ||
    key === 'ContextMenu' ||
    key === 'Menu' ||
    key === 'MediaTopMenu' ||
    key === 'ColorF0Red'
  ) {
    return !e.ctrlKey && !e.metaKey;
  }
  return false;
}

function isShortcutBlockedByOverlayOrInput(): boolean {
  if (typeof document === 'undefined') return false;
  if (document.querySelector('[data-focus-scope="modal"]')) return true;
  if (document.querySelector('[data-player-fullscreen="true"]')) return true;
  const active = document.activeElement as HTMLElement | null;
  if (active) {
    const tag = active.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active.isContentEditable) {
      return true;
    }
  }
  return false;
}

interface PendingFocusRestoration {
  sectionType: 'live' | 'movie' | 'series';
  targetIndexInSection: number;
  savedScrollTop: number;
  savedRowScrollLeft: number;
}

interface LastOpenedOrigin {
  itemKey: string;
  sectionType: 'live' | 'movie' | 'series';
  indexInSection: number;
  savedScrollTop: number;
  savedRowScrollLeft: number;
}

export const FavoritesView = React.memo(function FavoritesView({
  onPlay,
  searchQuery = '',
}: FavoritesViewProps) {
  const { favorites, toggleFavorite, favoriteError, clearFavoriteError } = useFavorites();
  const { credentials } = useXtreamCredentials();

  const [filterType, setFilterType] = useState<FavoritesFilterType>('all');
  const [selectedMovie, setSelectedMovie] = useState<FavoriteItem | null>(null);
  const [selectedSeries, setSelectedSeries] = useState<FavoriteItem | null>(null);
  const [favPlayError, setFavPlayError] = useState<string | null>(null);
  const [failedFav, setFailedFav] = useState<FavoriteItem | null>(null);
  const [favActionError, setFavActionError] = useState<string | null>(null);
  const [focusedGridIndex, setFocusedGridIndex] = useState<number | null>(null);

  const viewRootRef = useRef<HTMLDivElement | null>(null);
  const mainScrollRef = useRef<HTMLElement | null>(null);
  const gridContainerRef = useRef<HTMLDivElement | null>(null);
  const [mainScrollEl, setMainScrollEl] = useState<HTMLElement | null>(null);

  const pendingFocusAfterRemoveRef = useRef<PendingFocusRestoration | null>(null);
  const lastOpenedOriginRef = useRef<LastOpenedOrigin | null>(null);

  const setMainScrollCallbackRef = useCallback((node: HTMLElement | null) => {
    mainScrollRef.current = node;
    setMainScrollEl((prev) => (prev !== node ? node : prev));
  }, []);

  useBackHandler(
    'favorites-play-error',
    BACK_PRIORITY.SUB_MODAL,
    () => {
      if (favPlayError) {
        setFavPlayError(null);
        return true;
      }
      return false;
    },
    Boolean(favPlayError)
  );

  useEffect(() => {
    if (favActionError) {
      const timer = setTimeout(() => {
        setFavActionError(null);
        clearFavoriteError();
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [favActionError, clearFavoriteError]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const hasSearch = normalizedQuery.length > 0;

  const searchMatchedFavorites = useMemo(() => {
    if (!hasSearch) return favorites;
    return favorites.filter((fav) => (fav.name || '').toLowerCase().includes(normalizedQuery));
  }, [favorites, hasSearch, normalizedQuery]);

  const liveFavorites = useMemo(
    () => searchMatchedFavorites.filter((fav) => fav.type === 'live'),
    [searchMatchedFavorites]
  );

  const movieFavorites = useMemo(
    () => searchMatchedFavorites.filter((fav) => fav.type === 'movie'),
    [searchMatchedFavorites]
  );

  const seriesFavorites = useMemo(
    () => searchMatchedFavorites.filter((fav) => fav.type === 'series'),
    [searchMatchedFavorites]
  );

  const filteredFavorites = useMemo(() => {
    if (filterType === 'live') return liveFavorites;
    if (filterType === 'movie') return movieFavorites;
    if (filterType === 'series') return seriesFavorites;
    return searchMatchedFavorites;
  }, [filterType, liveFavorites, movieFavorites, seriesFavorites, searchMatchedFavorites]);

  const activeSectionsInAll = useMemo(() => {
    const sections: Array<{
      key: 'live' | 'movie' | 'series';
      type: 'live' | 'movie' | 'series';
      title: string;
      items: FavoriteItem[];
    }> = [];
    if (liveFavorites.length > 0) {
      sections.push({
        key: 'live',
        type: 'live',
        title: 'Canais Favoritos',
        items: liveFavorites,
      });
    }
    if (movieFavorites.length > 0) {
      sections.push({
        key: 'movie',
        type: 'movie',
        title: 'Filmes Favoritos',
        items: movieFavorites,
      });
    }
    if (seriesFavorites.length > 0) {
      sections.push({
        key: 'series',
        type: 'series',
        title: 'Séries Favoritas',
        items: seriesFavorites,
      });
    }
    return sections;
  }, [liveFavorites, movieFavorites, seriesFavorites]);

  const isDomainGridMode = filterType !== 'all';

  const {
    startIndex: gridStartIndex,
    endIndex: gridEndIndex,
    topSpacerPx: gridTopSpacerPx,
    bottomSpacerPx: gridBottomSpacerPx,
    columns: gridColumns,
    ensureIndexMounted: ensureGridIndexMounted,
    virtualContainerCallbackRef: gridVirtualContainerCallbackRef,
  } = useVirtualWindow({
    totalCount: isDomainGridMode ? filteredFavorites.length : 0,
    mode: 'grid',
    scrollContainerRef: mainScrollRef,
    virtualContainerRef: gridContainerRef,
    isFrozen: Boolean(selectedMovie || selectedSeries || favPlayError),
    resetKey: `favorites_grid_${filterType}_${normalizedQuery}`,
    maxWindowItems: 72,
  });

  useEffect(() => {
    setFocusedGridIndex(null);
  }, [filterType, normalizedQuery]);

  const activeGridImageRange = useMemo(() => {
    if (!isDomainGridMode) {
      return { min: 0, max: 0 };
    }
    const windowLen = Math.max(0, gridEndIndex - gridStartIndex);
    if (windowLen <= FAVORITES_GRID_ACTIVE_IMAGE_BUDGET) {
      return { min: gridStartIndex, max: gridEndIndex };
    }
    if (
      focusedGridIndex !== null &&
      focusedGridIndex >= gridStartIndex &&
      focusedGridIndex < gridEndIndex
    ) {
      const half = Math.floor(FAVORITES_GRID_ACTIVE_IMAGE_BUDGET / 2);
      const min = Math.max(
        gridStartIndex,
        Math.min(gridEndIndex - FAVORITES_GRID_ACTIVE_IMAGE_BUDGET, focusedGridIndex - half)
      );
      return { min, max: Math.min(gridEndIndex, min + FAVORITES_GRID_ACTIVE_IMAGE_BUDGET) };
    }
    if (gridStartIndex === 0) {
      return { min: 0, max: Math.min(gridEndIndex, FAVORITES_GRID_ACTIVE_IMAGE_BUDGET) };
    }
    if (gridEndIndex >= filteredFavorites.length) {
      return {
        min: Math.max(gridStartIndex, gridEndIndex - FAVORITES_GRID_ACTIVE_IMAGE_BUDGET),
        max: gridEndIndex,
      };
    }
    const leadOffset = Math.min(
      Math.max(0, windowLen - FAVORITES_GRID_ACTIVE_IMAGE_BUDGET),
      Math.max(gridColumns, gridColumns * 2)
    );
    const min = gridStartIndex + leadOffset;
    return { min, max: Math.min(gridEndIndex, min + FAVORITES_GRID_ACTIVE_IMAGE_BUDGET) };
  }, [isDomainGridMode, gridStartIndex, gridEndIndex, focusedGridIndex, filteredFavorites.length, gridColumns]);

  const applyNeighborOrFilterFocus = useCallback(
    (restoration: PendingFocusRestoration) => {
      const rootEl = viewRootRef.current;
      if (!rootEl) return;

      const { sectionType, targetIndexInSection, savedScrollTop, savedRowScrollLeft } = restoration;

      const sectionItemsMap: Record<'live' | 'movie' | 'series', FavoriteItem[]> = {
        live: liveFavorites,
        movie: movieFavorites,
        series: seriesFavorites,
      };

      const focusTargetCardInSection = (
        secType: 'live' | 'movie' | 'series',
        desiredIdx: number,
        preserveRowScroll: boolean
      ): boolean => {
        const itemsInSec = sectionItemsMap[secType];
        if (!itemsInSec || itemsInSec.length === 0) return false;

        const clampedIdx = Math.max(0, Math.min(itemsInSec.length - 1, desiredIdx));
        const targetFav = itemsInSec[clampedIdx];
        const targetItemKey = `${targetFav.type}-${targetFav.id}`;

        const secEl = rootEl.querySelector<HTMLElement>(`[data-favorites-section="${secType}"]`);
        if (!secEl) return false;

        if (isDomainGridMode) {
          ensureGridIndexMounted(clampedIdx);
        } else {
          const rowEl = secEl.querySelector<HTMLElement>('[data-nav-row="true"]');
          if (rowEl && preserveRowScroll && savedRowScrollLeft > 0) {
            rowEl.scrollLeft = savedRowScrollLeft;
          }
          if (rowEl && rowEl.getAttribute('data-virtual-container') === 'true') {
            const restored = restoreVirtualItemByKey(
              rowEl,
              targetItemKey,
              preserveRowScroll ? savedRowScrollLeft : undefined
            );
            if (restored && restored.isConnected) {
              if (mainScrollRef.current) {
                const maxTop = Math.max(
                  0,
                  (mainScrollRef.current.scrollHeight || 0) -
                    (mainScrollRef.current.clientHeight || 0)
                );
                mainScrollRef.current.scrollTop = Math.min(savedScrollTop, maxTop);
              }
              return true;
            }
          }
        }

        const cardEl =
          secEl.querySelector<HTMLElement>(`[data-favorite-index="${clampedIdx}"]`) ||
          secEl.querySelector<HTMLElement>(`[data-favorite-key="${targetItemKey}"]`) ||
          secEl.querySelector<HTMLElement>('[data-favorite-card="true"]');

        if (cardEl && cardEl.isConnected) {
          try {
            cardEl.focus({ preventScroll: true });
          } catch {
            focusElementSafely(cardEl);
          }
          if (mainScrollRef.current) {
            const maxTop = Math.max(
              0,
              (mainScrollRef.current.scrollHeight || 0) - (mainScrollRef.current.clientHeight || 0)
            );
            mainScrollRef.current.scrollTop = Math.min(savedScrollTop, maxTop);
          }
          return true;
        }
        return false;
      };

      // 1. Try focusing the neighbor in the same section
      if (focusTargetCardInSection(sectionType, targetIndexInSection, true)) {
        return;
      }

      // 2. If in 'all' mode and this section became empty, move to the closest remaining section
      if (filterType === 'all') {
        const currentOrderIdx = SECTION_ORDER.indexOf(sectionType);
        // Prefer next section below, then previous section above
        for (let offset = 1; offset < SECTION_ORDER.length; offset++) {
          const nextSec = SECTION_ORDER[currentOrderIdx + offset];
          if (nextSec && focusTargetCardInSection(nextSec, 0, false)) {
            return;
          }
        }
        for (let offset = 1; offset < SECTION_ORDER.length; offset++) {
          const prevSec = SECTION_ORDER[currentOrderIdx - offset];
          if (prevSec) {
            const prevLen = sectionItemsMap[prevSec].length;
            if (prevLen > 0 && focusTargetCardInSection(prevSec, 0, false)) {
              return;
            }
          }
        }
      }

      // 3. Fallback: section/view is now empty -> focus the active filter button in the filter bar
      const activeFilterBtn =
        rootEl.querySelector<HTMLButtonElement>(`button[data-favorites-filter="${filterType}"]`) ||
        rootEl.querySelector<HTMLButtonElement>('button[data-favorites-filter="all"]');
      if (activeFilterBtn && activeFilterBtn.isConnected) {
        focusElementSafely(activeFilterBtn);
      }
    },
    [
      liveFavorites,
      movieFavorites,
      seriesFavorites,
      isDomainGridMode,
      filterType,
      ensureGridIndexMounted,
    ]
  );

  // Synchronously restore focus when a focused favorite card is removed
  useLayoutEffect(() => {
    const pending = pendingFocusAfterRemoveRef.current;
    if (!pending) return;
    pendingFocusAfterRemoveRef.current = null;
    applyNeighborOrFilterFocus(pending);
  }, [favorites, filteredFavorites, applyNeighborOrFilterFocus]);

  const handleToggleFavorite = useCallback(
    (
      fav: FavoriteItem,
      sectionType: 'live' | 'movie' | 'series',
      indexInSection: number,
      cardEl?: HTMLElement | null
    ) => {
      const rootEl = viewRootRef.current;
      const activeEl =
        typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;

      const wasCardFocused = Boolean(
        (cardEl && activeEl && (activeEl === cardEl || cardEl.contains(activeEl))) ||
          (activeEl &&
            rootEl?.contains(activeEl) &&
            (activeEl.getAttribute('data-favorite-card') === 'true' ||
              activeEl.getAttribute('data-favorite-remove') === 'true'))
      );

      const rowEl = cardEl?.closest<HTMLElement>('[data-nav-row="true"]') || null;
      const savedScrollTop = mainScrollRef.current?.scrollTop ?? 0;
      const savedRowScrollLeft = rowEl?.scrollLeft ?? 0;

      const success = toggleFavorite(fav);
      if (!success) {
        setFavActionError(
          'Não foi possível salvar os favoritos neste dispositivo. Tente novamente.'
        );
        return;
      }

      setFavActionError(null);
      if (wasCardFocused) {
        pendingFocusAfterRemoveRef.current = {
          sectionType,
          targetIndexInSection: indexInSection,
          savedScrollTop,
          savedRowScrollLeft,
        };
      }
    },
    [toggleFavorite]
  );

  const restoreOriginAfterModalClose = useCallback(() => {
    const origin = lastOpenedOriginRef.current;
    if (!origin) return;
    const rootEl = viewRootRef.current;
    if (!rootEl) return;

    const applyRestore = () => {
      const exactCard = rootEl.querySelector<HTMLElement>(
        `[data-favorite-key="${origin.itemKey}"]`
      );
      if (exactCard && exactCard.isConnected) {
        try {
          exactCard.focus({ preventScroll: true });
        } catch {
          focusElementSafely(exactCard);
        }
        if (mainScrollRef.current) {
          mainScrollRef.current.scrollTop = origin.savedScrollTop;
        }
        return;
      }

      // If the user unfavorited the item inside MovieDetails/SeriesDetails before closing,
      // restore focus to its neighbor or the active filter tab
      applyNeighborOrFilterFocus({
        sectionType: origin.sectionType,
        targetIndexInSection: origin.indexInSection,
        savedScrollTop: origin.savedScrollTop,
        savedRowScrollLeft: origin.savedRowScrollLeft,
      });
    };

    applyRestore();
  }, [applyNeighborOrFilterFocus]);

  const handleCloseMovieDetails = useCallback(() => {
    setSelectedMovie(null);
    setTimeout(() => {
      restoreOriginAfterModalClose();
    }, 0);
  }, [restoreOriginAfterModalClose]);

  const handleCloseSeriesDetails = useCallback(() => {
    setSelectedSeries(null);
    setTimeout(() => {
      restoreOriginAfterModalClose();
    }, 0);
  }, [restoreOriginAfterModalClose]);

  const handlePlayClick = useCallback(
    (fav: FavoriteItem, explicitCardEl?: HTMLElement | null, indexInSection = 0) => {
      if (!credentials) return;

      const cardEl =
        explicitCardEl ||
        (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
          ? document.activeElement.closest<HTMLElement>('[data-favorite-card="true"]') ||
            document.activeElement
          : null);
      const rowEl = cardEl?.closest<HTMLElement>('[data-nav-row="true"]') || null;

      lastOpenedOriginRef.current = {
        itemKey: `${fav.type}-${fav.id}`,
        sectionType: fav.type,
        indexInSection,
        savedScrollTop: mainScrollRef.current?.scrollTop ?? 0,
        savedRowScrollLeft: rowEl?.scrollLeft ?? 0,
      };

      if (cardEl) {
        pushFocusMemory(cardEl);
      }

      if (fav.type === 'live') {
        try {
          recordPlaybackPosition(credentials, {
            id: fav.id,
            type: 'live',
          });
          setFavPlayError(null);
          setFailedFav(null);
          const url = buildDirectMediaUrl(credentials, {
            type: 'live',
            streamId: fav.id,
            allowedOutputFormats: credentials.allowed_output_formats,
          });
          onPlay(url, fav.name, 0, fav.id, 'live', fav.name);
        } catch (err: any) {
          console.error('Erro ao iniciar canal favorito:', err.message);
          setFavPlayError(err?.message || 'Falha ao iniciar canal favorito.');
          setFailedFav(fav);
        }
      } else if (fav.type === 'movie') {
        setSelectedMovie(fav);
      } else if (fav.type === 'series') {
        setSelectedSeries(fav);
      }
    },
    [credentials, onPlay]
  );

  const handleSelectFilter = useCallback((nextFilter: FavoritesFilterType) => {
    setFilterType(nextFilter);
    if (mainScrollRef.current) {
      mainScrollRef.current.scrollTop = 0;
    }
  }, []);

  const renderFavoriteCard = ({
    fav,
    index,
    itemKey,
    layoutMode,
    virtualize,
    isAuthorized,
    isFocused,
    setCardRef,
    onFocusCard,
    onBlurCard,
  }: {
    fav: FavoriteItem;
    index: number;
    itemKey: string;
    layoutMode: 'row' | 'grid';
    virtualize: boolean;
    isAuthorized: boolean;
    isFocused: boolean;
    setCardRef?: (el: HTMLElement | null) => void;
    onFocusCard?: () => void;
    onBlurCard?: () => void;
  }) => {
    const favoriteKey = `${fav.type}-${fav.id}`;
    const isLive = fav.type === 'live';
    const ratingVal = fav.extraData?.rating;
    const hasRating = ratingVal !== undefined && ratingVal !== null && String(ratingVal) !== '' && String(ratingVal) !== '0';
    const yearVal = fav.extraData?.year;

    const sizeClass =
      layoutMode === 'row'
        ? isLive
          ? 'nc-tv-row-card-live w-64 md:w-72 aspect-video shrink-0 snap-start'
          : 'nc-tv-row-card-poster w-36 md:w-44 aspect-[2/3] shrink-0 snap-start'
        : isLive
          ? 'aspect-video w-full'
          : 'aspect-[2/3] w-full';

    return (
      <div
        key={itemKey}
        ref={setCardRef}
        tabIndex={0}
        role="button"
        aria-label={fav.name}
        data-nav-item="true"
        data-showcase-card="true"
        data-favorite-card="true"
        data-favorite-type={fav.type}
        data-favorite-key={favoriteKey}
        data-favorite-index={index}
        data-row-card-index={layoutMode === 'row' ? index : undefined}
        data-row-item-key={layoutMode === 'row' ? favoriteKey : undefined}
        data-virtual-index={virtualize ? index : undefined}
        data-virtual-key={virtualize ? favoriteKey : undefined}
        data-card-focused={isFocused ? 'true' : 'false'}
        onFocus={() => {
          onFocusCard?.();
        }}
        onBlur={() => {
          onBlurCard?.();
        }}
        onClick={(e) => {
          const el = e.currentTarget as HTMLElement;
          if (typeof document !== 'undefined' && document.activeElement !== el) {
            try {
              el.focus({ preventScroll: true });
            } catch {}
          }
          handlePlayClick(fav, el, index);
        }}
        onKeyDown={(e) => {
          if (isShortcutBlockedByOverlayOrInput()) return;
          if (isFavoriteRemovalShortcutKey(e)) {
            e.preventDefault();
            e.stopPropagation();
            handleToggleFavorite(fav, fav.type, index, e.currentTarget as HTMLElement);
            return;
          }
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            handlePlayClick(fav, e.currentTarget as HTMLElement, index);
          }
        }}
        onContextMenu={(e) => {
          // Avoid accidental browser context menu when remote Menu/ContextMenu key is pressed
          if (typeof document !== 'undefined' && document.documentElement.dataset.navMode === 'remote') {
            e.preventDefault();
          }
        }}
        className={`nc-showcase-card relative z-0 hover:z-20 focus:z-20 focus-visible:z-20 group rounded-xl overflow-visible cursor-pointer select-none ${sizeClass}`}
      >
        {isLive ? (
          <div
            data-card-visual="true"
            className="nc-card-visual-layer relative w-full h-full rounded-xl overflow-hidden bg-nc-bg-card border border-nc-border flex flex-col justify-between p-3.5"
          >
            <div className="flex items-center justify-between gap-2 z-10">
              <div className="flex items-center gap-1.5 min-w-0">
                <Tv className="w-3.5 h-3.5 text-red-500 shrink-0" />
                <span className="nc-text-meta text-nc-text-secondary font-medium truncate">
                  Canal ao vivo
                </span>
              </div>
              <button
                type="button"
                tabIndex={-1}
                data-favorite-remove="true"
                title="Remover dos favoritos"
                aria-label={`Remover ${fav.name} dos favoritos`}
                onClick={(e) => {
                  e.stopPropagation();
                  const cardEl = (e.currentTarget as HTMLElement).closest<HTMLElement>(
                    '[data-favorite-card="true"]'
                  );
                  handleToggleFavorite(fav, 'live', index, cardEl);
                }}
                className="p-1.5 rounded-lg bg-black/55 hover:bg-black/85 text-nc-primary hover:text-red-400 border border-white/10 transition-colors cursor-pointer shrink-0 z-20"
              >
                <Heart className="w-4 h-4 fill-current" />
              </button>
            </div>

            <div className="flex-1 flex items-center justify-center overflow-hidden my-1.5 px-4 py-2 rounded-lg bg-black/45 border border-white/[0.04] relative">
              <MediaImage
                src={fav.cover}
                serverUrl={credentials?.serverUrl}
                alt={fav.name}
                itemId={fav.id}
                itemName={fav.name}
                active={isAuthorized}
                loading="lazy"
                decoding="async"
                className="nc-fav-card-img max-h-full max-w-full object-contain transition-transform duration-200 group-hover:scale-105"
              />
              <div className="nc-card-play-overlay absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                <div className="nc-card-play-badge w-10 h-10 rounded-full bg-nc-primary flex items-center justify-center text-black shadow-lg transform scale-90 group-hover:scale-100 group-focus:scale-100 transition-transform">
                  <Play className="w-5 h-5 fill-current ml-0.5" />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 z-10">
              <h3
                className="text-white nc-card-title font-semibold line-clamp-1 group-hover:text-nc-primary group-focus:text-nc-primary transition-colors flex-1"
                title={fav.name}
              >
                {fav.name}
              </h3>
            </div>
          </div>
        ) : (
          <div
            data-card-visual="true"
            className="nc-card-visual-layer relative w-full h-full rounded-xl overflow-hidden bg-nc-bg-card border border-nc-border flex flex-col justify-end"
          >
            <MediaImage
              src={fav.cover}
              serverUrl={credentials?.serverUrl}
              alt={fav.name}
              itemId={fav.id}
              itemName={fav.name}
              active={isAuthorized}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/35 to-transparent" />

            <button
              type="button"
              tabIndex={-1}
              data-favorite-remove="true"
              title="Remover dos favoritos"
              aria-label={`Remover ${fav.name} dos favoritos`}
              onClick={(e) => {
                e.stopPropagation();
                const cardEl = (e.currentTarget as HTMLElement).closest<HTMLElement>(
                  '[data-favorite-card="true"]'
                );
                handleToggleFavorite(fav, fav.type, index, cardEl);
              }}
              className="absolute top-2.5 right-2.5 z-20 p-1.5 rounded-lg bg-black/65 hover:bg-black/90 text-nc-primary hover:text-red-400 border border-white/10 backdrop-blur-sm transition-colors cursor-pointer"
            >
              <Heart className="w-4 h-4 fill-current" />
            </button>

            <div className="nc-card-play-overlay absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
              <div className="nc-card-play-badge w-12 h-12 rounded-full bg-nc-primary flex items-center justify-center text-black transform scale-75 group-hover:scale-100 group-focus:scale-100 transition-transform shadow-lg">
                <Play className="w-6 h-6 fill-current ml-1" />
              </div>
            </div>

            <div className="relative z-10 p-3">
              <h3
                className="text-white nc-card-title font-semibold line-clamp-2 group-hover:text-nc-primary group-focus:text-nc-primary transition-colors"
                title={fav.name}
              >
                {fav.name}
              </h3>
              <div className="flex items-center gap-1.5 mt-1 nc-text-meta text-nc-text-secondary">
                {fav.type === 'movie' ? (
                  <Film className="w-3 h-3 text-nc-text-secondary shrink-0" />
                ) : (
                  <PlaySquare className="w-3 h-3 text-nc-text-secondary shrink-0" />
                )}
                <span>{fav.type === 'movie' ? 'Filme' : 'Série'}</span>
                {hasRating && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-yellow-500 font-medium tabular-nums">★ {ratingVal}</span>
                  </>
                )}
                {yearVal && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{yearVal}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const domainGridTitle =
    filterType === 'live'
      ? 'Canais Favoritos'
      : filterType === 'movie'
        ? 'Filmes Favoritos'
        : 'Séries Favoritas';

  return (
    <div
      ref={viewRootRef}
      data-favorites-view="true"
      className="flex flex-1 flex-col overflow-hidden w-full h-full relative bg-nc-bg"
    >
      {selectedMovie && (
        <MovieDetails
          streamId={selectedMovie.id}
          streamName={selectedMovie.name}
          streamIcon={normalizeImageSource(selectedMovie.cover)}
          categoryName={selectedMovie.extraData?.category || 'Favorito'}
          rating={selectedMovie.extraData?.rating}
          year={selectedMovie.extraData?.year}
          onClose={handleCloseMovieDetails}
          onPlay={onPlay}
        />
      )}

      {selectedSeries && (
        <SeriesDetails
          seriesId={selectedSeries.id}
          seriesName={selectedSeries.name}
          seriesCover={normalizeImageSource(selectedSeries.cover)}
          onClose={handleCloseSeriesDetails}
          onPlay={onPlay}
        />
      )}

      {favPlayError && (
        <div
          data-focus-scope="modal"
          data-fav-error-modal="true"
          className="absolute inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="nc-lite-instant-modal bg-nc-bg border border-red-500/40 rounded-2xl p-6 md:p-8 max-w-md w-full shadow-2xl flex flex-col items-center text-center animate-in zoom-in-95 duration-300">
            <div className="w-14 h-14 rounded-full bg-red-500/20 flex items-center justify-center mb-4">
              <AlertCircle className="w-7 h-7 text-red-500" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Erro ao Iniciar Canal</h3>
            <p className="text-red-400 text-sm mb-4 leading-relaxed">{favPlayError}</p>
            <div data-nav-row="true" className="flex gap-3 w-full">
              {failedFav && (
                <button
                  type="button"
                  data-nav-item="true"
                  data-autofocus="true"
                  onClick={() => handlePlayClick(failedFav)}
                  className="flex-1 py-3 bg-nc-primary text-black font-semibold rounded-xl transition-all hover:brightness-110 flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" /> Tentar Novamente
                </button>
              )}
              <button
                type="button"
                data-nav-item="true"
                onClick={() => setFavPlayError(null)}
                className="flex-1 py-3 bg-nc-bg-card hover:bg-nc-bg-input text-white font-medium rounded-xl transition-colors border border-nc-border/50"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Domain Top Bar with Section Title & Filter Controls */}
      <div
        data-nav-zone="categories"
        data-showcase-categories-bar="true"
        data-favorites-header="true"
        className="relative z-30 shrink-0 px-4 sm:px-6 md:px-10 pt-4 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-nc-bg border-b border-white/[0.06]"
      >
        <div className="flex items-center justify-between sm:justify-start gap-3">
          <h1 className="nc-section-title font-bold text-white tracking-tight flex items-center gap-2.5">
            <Heart className="w-6 h-6 fill-nc-primary text-nc-primary shrink-0" />
            <span>Meus Favoritos</span>
          </h1>
          <span className="nc-text-meta text-nc-text-secondary font-medium tabular-nums">
            {filteredFavorites.length}{' '}
            {filteredFavorites.length === 1 ? 'favorito' : 'favoritos'}
          </span>
        </div>

        <div
          data-nav-row="true"
          data-favorites-filters="true"
          role="tablist"
          aria-label="Filtrar favoritos"
          className="flex flex-wrap items-center gap-2"
        >
          {FILTER_TABS.map((tab) => {
            const isActive = filterType === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                data-nav-item="true"
                data-favorites-filter={tab.id}
                data-category-selected={isActive ? 'true' : 'false'}
                onClick={() => handleSelectFilter(tab.id)}
                className={`px-4 py-2 rounded-full nc-text-subtitle whitespace-nowrap shrink-0 transition-colors cursor-pointer border ${
                  isActive
                    ? 'bg-white text-black font-semibold border-white shadow-sm'
                    : 'bg-white/[0.06] hover:bg-white/[0.12] text-white/85 hover:text-white border-white/10 font-medium'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Scrollable Favorites Area */}
      <main
        ref={setMainScrollCallbackRef}
        data-scroll-container="true"
        data-nav-zone="content"
        style={{ overflowAnchor: 'none' }}
        className="flex-1 bg-nc-bg overflow-y-auto h-full"
      >
        {filteredFavorites.length === 0 ? (
          <div
            data-favorites-empty="true"
            className="min-h-[18rem] px-6 py-16 flex flex-col items-center justify-center text-center"
          >
            <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-center mb-4">
              {hasSearch ? (
                <Search className="w-6 h-6 text-nc-text-secondary" />
              ) : (
                <Heart className="w-7 h-7 stroke-1.5 text-nc-text-secondary" />
              )}
            </div>
            <p className="nc-heading-section text-white mb-1.5">Nenhum favorito encontrado</p>
            <p className="nc-text-subtitle text-nc-text-secondary max-w-md">
              {hasSearch
                ? `Nenhum resultado para "${searchQuery}". Tente buscar por outro termo.`
                : filterType === 'live'
                  ? 'Você ainda não adicionou canais ao vivo aos seus favoritos.'
                  : filterType === 'movie'
                    ? 'Você ainda não adicionou filmes aos seus favoritos.'
                    : filterType === 'series'
                      ? 'Você ainda não adicionou séries aos seus favoritos.'
                      : 'Adicione canais, filmes ou séries aos seus favoritos para acessá-los rapidamente aqui.'}
            </p>
            {filterType !== 'all' && !hasSearch && favorites.length > 0 && (
              <button
                type="button"
                data-nav-item="true"
                data-favorites-reset-filter="true"
                onClick={() => handleSelectFilter('all')}
                className="mt-5 px-4 py-2 rounded-full bg-white/[0.08] hover:bg-white/[0.14] border border-white/15 text-white nc-text-subtitle font-medium transition-colors cursor-pointer"
              >
                Ver todos os favoritos
              </button>
            )}
          </div>
        ) : filterType === 'all' ? (
          /* CASE 1: "Todos" — Organized by content sections (Canais Favoritos, Filmes Favoritos, Séries Favoritas) */
          <div
            data-showcase-rows-container="true"
            data-showcase-virtualized="false"
            data-showcase-total-rows={activeSectionsInAll.length}
            style={{ overflowAnchor: 'none' }}
            className="mt-2 sm:mt-4 px-4 sm:px-6 md:px-10 pb-16 relative z-20"
          >
            {activeSectionsInAll.map((sec, rowIdx) => (
              <section
                key={sec.key}
                data-scroll-block="true"
                data-scroll-top-anchor={rowIdx === 0 ? 'true' : undefined}
                data-favorites-section={sec.type}
                data-showcase-row-key={`fav_sec_${sec.type}`}
                data-showcase-row-index={rowIdx}
                className="pb-6"
                style={{ overflowAnchor: 'none' }}
              >
                <HorizontalRow
                  title={sec.title}
                  items={sec.items}
                  type={sec.type === 'live' ? 'live' : sec.type === 'movie' ? 'vod' : 'series'}
                  rowIndex={rowIdx}
                  scrollContainer={mainScrollEl}
                  virtualize={sec.items.length > 18}
                  onItemClick={(item, el) => handlePlayClick(item, el)}
                  renderCardItem={({
                    item: fav,
                    index: idx,
                    itemKey,
                    virtualize,
                    isAuthorized,
                    isFocused,
                    setCardRef,
                    onFocusCard,
                    onBlurCard,
                  }) =>
                    renderFavoriteCard({
                      fav,
                      index: idx,
                      itemKey,
                      layoutMode: 'row',
                      virtualize,
                      isAuthorized,
                      isFocused,
                      setCardRef,
                      onFocusCard,
                      onBlurCard,
                    })
                  }
                />
              </section>
            ))}
          </div>
        ) : (
          /* CASE 2: Specific Domain Filter ("Canais", "Filmes", "Séries") — Virtualized Domain Grid */
          <section
            data-favorites-section={filterType}
            className="px-4 sm:px-6 md:px-10 pt-4 pb-16"
          >
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2
                data-favorites-grid-title="true"
                className="nc-heading-view font-semibold text-white whitespace-normal break-words"
              >
                {hasSearch
                  ? `Resultados em ${domainGridTitle} para "${searchQuery}"`
                  : domainGridTitle}
              </h2>
              <span className="nc-text-meta text-nc-text-secondary font-medium tabular-nums">
                {filteredFavorites.length}{' '}
                {filteredFavorites.length === 1 ? 'item' : 'itens'}
              </span>
            </div>

            {gridTopSpacerPx > 0 && (
              <div
                data-virtual-spacer="top"
                aria-hidden="true"
                style={{ height: `${gridTopSpacerPx}px` }}
              />
            )}

            <div
              ref={gridVirtualContainerCallbackRef}
              data-nav-grid="true"
              data-virtual-container="true"
              data-virtual-total={filteredFavorites.length}
              className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 nc-tv-media-grid"
            >
              {filteredFavorites
                .slice(gridStartIndex, gridEndIndex)
                .map((fav: FavoriteItem, localIdx: number) => {
                  const virtualIndex = gridStartIndex + localIdx;
                  const itemKey = `${fav.type}-${fav.id}`;
                  const isImageActive =
                    (virtualIndex >= activeGridImageRange.min &&
                      virtualIndex < activeGridImageRange.max) ||
                    focusedGridIndex === virtualIndex;

                  return renderFavoriteCard({
                    fav,
                    index: virtualIndex,
                    itemKey,
                    layoutMode: 'grid',
                    virtualize: true,
                    isAuthorized: isImageActive,
                    isFocused: focusedGridIndex === virtualIndex,
                    onFocusCard: () => setFocusedGridIndex(virtualIndex),
                    onBlurCard: () =>
                      setFocusedGridIndex((prev) => (prev === virtualIndex ? null : prev)),
                  });
                })}
            </div>

            {gridBottomSpacerPx > 0 && (
              <div
                data-virtual-spacer="bottom"
                aria-hidden="true"
                style={{ height: `${gridBottomSpacerPx}px` }}
              />
            )}
          </section>
        )}
      </main>

      {(favActionError || favoriteError) && (
        <div
          role="alert"
          className="nc-lite-instant-toast fixed bottom-6 right-6 left-6 sm:left-auto sm:max-w-md z-[110] bg-red-600/90 text-white text-sm px-4 py-3 rounded-xl shadow-2xl border border-red-500/50 backdrop-blur-md flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-2"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-5 h-5 text-white shrink-0" />
            <span className="truncate sm:whitespace-normal">
              {favActionError || favoriteError}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setFavActionError(null);
              clearFavoriteError();
            }}
            className="p-1 hover:bg-white/20 rounded-lg text-white/80 hover:text-white shrink-0 transition-colors"
            aria-label="Fechar aviso"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
});
