import React, { useRef, useState, useEffect, useCallback, useLayoutEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MediaImage } from './MediaImage';
import { LiveChannelGroup } from '../utils/liveChannelGroups';
import {
  buildEpgCacheKeys,
  resolveNowPlayingProgram,
  type ResolvedNowPlaying,
} from '../utils/epgUtils';
import { registerVirtualContainer, unregisterVirtualContainer } from '../navigation';

const LIVE_ROW_VIRTUAL_OVERSCAN = 4;
const LIVE_ROW_RENDER_LIMIT = 18;
const DEFAULT_LIVE_WIDE_CARD_STEP_PX = 440; // ~26.5rem + 1rem gap fallback

function parsePx(val: string | null | undefined): number {
  if (!val) return 0;
  const parsed = parseFloat(val);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function resolveLiveRowMetrics(container: HTMLElement | null): {
  cardStep: number;
  containerWidth: number;
  visibleSpan: number;
} {
  if (!container || typeof window === 'undefined') {
    return {
      cardStep: DEFAULT_LIVE_WIDE_CARD_STEP_PX,
      containerWidth: 1200,
      visibleSpan: 3,
    };
  }

  let cardWidth = 0;
  let gap = 16;

  try {
    const style = window.getComputedStyle(container);
    const colGap = parsePx(style.columnGap) || parsePx(style.gap);
    if (colGap > 0) gap = colGap;

    const firstCard = container.querySelector<HTMLElement>('[data-row-card-slot="true"]');
    if (firstCard) {
      const rect = firstCard.getBoundingClientRect();
      if (rect.width > 0) {
        cardWidth = rect.width;
      }
    }
  } catch {}

  const cw = container.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1200) || 1200;
  if (cardWidth <= 0) {
    cardWidth = cw < 640 ? 304 : cw < 768 ? 360 : 424;
  }

  const cardStep = Math.max(200, Math.round(cardWidth + gap));
  const visibleSpan = Math.max(1, Math.ceil(cw / cardStep));

  return { cardStep, containerWidth: cw, visibleSpan };
}

function computeHorizontalRange(params: {
  totalCount: number;
  scrollLeft: number;
  visibleSpan: number;
  cardStep: number;
  overscan: number;
  renderLimit: number;
  anchorIndex?: number | null;
}): { start: number; end: number } {
  const { totalCount, scrollLeft, visibleSpan, cardStep, overscan, renderLimit, anchorIndex } = params;
  if (totalCount <= 0) return { start: 0, end: 0 };
  const limit = Math.min(totalCount, Math.max(1, renderLimit));
  if (totalCount <= limit) return { start: 0, end: totalCount };

  const visibleStart = Math.max(0, Math.floor(Math.max(0, scrollLeft) / Math.max(1, cardStep)));
  let start = Math.max(0, visibleStart - overscan);
  let end = Math.min(totalCount, visibleStart + visibleSpan + overscan);

  if (end - start > limit) {
    end = Math.min(totalCount, start + limit);
  }
  if (end - start < limit) {
    start = Math.max(0, end - limit);
  }

  if (typeof anchorIndex === 'number' && anchorIndex >= 0 && anchorIndex < totalCount) {
    if (anchorIndex < start) {
      start = Math.max(0, anchorIndex - Math.min(overscan, Math.floor(limit / 3)));
      end = Math.min(totalCount, start + limit);
    } else if (anchorIndex >= end) {
      end = Math.min(totalCount, anchorIndex + Math.min(overscan, Math.floor(limit / 3)) + 1);
      start = Math.max(0, end - limit);
    }
  }

  return { start, end };
}

export interface LiveChannelCardProps {
  group: LiveChannelGroup;
  serverUrl?: string;
  accountPrefix?: string;
  isSelected: boolean;
  epgCache: ReadonlyMap<string, any[]>;
  epgCacheVersion: number;
  referenceNowMs?: number;
  layoutVariant?: 'row' | 'grid';
  rowCardIndex?: number;
  virtualIndex?: number;
  rowPriority?: boolean;
  allowImageRender?: boolean;
  onActivate: (group: LiveChannelGroup, el: HTMLButtonElement) => void;
}

export const LiveChannelCard = React.memo(function LiveChannelCard({
  group,
  serverUrl,
  accountPrefix = '',
  isSelected,
  epgCache,
  epgCacheVersion,
  referenceNowMs,
  layoutVariant = 'row',
  rowCardIndex,
  virtualIndex,
  rowPriority = false,
  allowImageRender = true,
  onActivate,
}: LiveChannelCardProps) {
  const primaryId = group.primaryStream?.stream_id ?? group.primaryStream?.id ?? '';

  // Passive lookup in session EPG cache — never triggers EPG fetch on mount or focus
  const nowPlaying: ResolvedNowPlaying | null = useMemo(() => {
    void epgCacheVersion;
    const keys = buildEpgCacheKeys(group, accountPrefix);
    for (const k of keys) {
      const listings = epgCache.get(k);
      if (listings && listings.length > 0) {
        return resolveNowPlayingProgram(listings, referenceNowMs);
      }
    }
    const inlineListings =
      group.primaryStream?.epg_listings ||
      group.allStreams?.find((s: any) => Array.isArray(s?.epg_listings) && s.epg_listings.length > 0)
        ?.epg_listings;
    if (Array.isArray(inlineListings) && inlineListings.length > 0) {
      return resolveNowPlayingProgram(inlineListings, referenceNowMs);
    }
    return null;
  }, [group, accountPrefix, epgCache, epgCacheVersion, referenceNowMs]);

  const cardDimensionClass =
    layoutVariant === 'grid' ? 'nc-live-wide-card-grid' : 'nc-live-wide-card';

  return (
    <button
      type="button"
      data-nav-item="true"
      data-showcase-card="true"
      data-live-channel-btn="true"
      data-live-channel-id={group.groupId}
      data-live-channel-category-id={String(group.category_id ?? '')}
      data-live-channel-selected={isSelected ? 'true' : 'false'}
      data-live-channel-origin={isSelected ? 'true' : 'false'}
      data-row-card-index={rowCardIndex}
      data-virtual-index={virtualIndex}
      data-row-item-key={group.groupId}
      data-virtual-key={group.groupId}
      aria-label={group.displayName}
      aria-pressed={isSelected}
      onClick={(e) => {
        onActivate(group, e.currentTarget);
      }}
      className={`nc-showcase-card ${cardDimensionClass} group/card shrink-0 rounded-xl overflow-visible cursor-pointer select-none text-left p-0 bg-transparent border-0`}
    >
      <div
        data-card-visual="true"
        className={`nc-card-visual-layer relative w-full h-full rounded-xl overflow-hidden flex items-stretch border transition-colors ${
          isSelected
            ? 'bg-[#1a1e2c] border-white/35'
            : 'bg-[#12141c] border-white/[0.08]'
        }`}
      >
        {/* Left square dark visual block with centered undistorted logo */}
        <div className="h-full aspect-square bg-black/55 border-r border-white/10 flex items-center justify-center p-2.5 sm:p-3 shrink-0 overflow-hidden">
          {allowImageRender ? (
            <MediaImage
              src={group.stream_icon}
              serverUrl={serverUrl}
              alt={group.displayName}
              itemId={primaryId}
              itemName={group.displayName}
              priority={rowPriority}
              loading={rowPriority ? 'eager' : 'lazy'}
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="w-full h-full bg-white/[0.03] rounded-md" aria-hidden="true" />
          )}
        </div>

        {/* Right metadata column: channel name, real cached EPG title/desc or clean neutral state, valid-only progress */}
        <div className="flex-1 min-w-0 px-3 sm:px-3.5 py-2.5 flex flex-col justify-between h-full">
          <div className="flex items-start justify-between gap-2 min-w-0">
            <p
              data-live-channel-name="true"
              className={`nc-tv-channel-name nc-text-subtitle font-semibold min-w-0 flex-1 ${
                isSelected ? 'text-white' : 'text-white/95'
              }`}
            >
              {group.displayName}
            </p>
            {isSelected && (
              <span
                aria-hidden="true"
                className="w-2 h-2 rounded-full bg-red-500 mt-1.5 shrink-0"
              />
            )}
          </div>

          <div className="min-w-0 flex flex-col gap-0.5 my-auto pt-1">
            {nowPlaying?.title ? (
              <>
                <p className="nc-text-meta font-medium text-white/85 line-clamp-1 whitespace-normal break-words">
                  {nowPlaying.title}
                </p>
                {nowPlaying.description ? (
                  <p className="nc-text-meta text-white/55 line-clamp-1 whitespace-normal break-words">
                    {nowPlaying.description}
                  </p>
                ) : nowPlaying.timeSlot ? (
                  <p className="nc-text-meta font-mono text-white/55 line-clamp-1">
                    {nowPlaying.timeSlot}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="nc-text-meta text-white/45 line-clamp-1">
                Programação indisponível
              </p>
            )}
          </div>

          {nowPlaying && nowPlaying.progressPercent !== null && (
            <div
              data-live-card-epg-progress="true"
              className="w-full h-1 rounded-full bg-white/15 overflow-hidden mt-1.5 shrink-0"
              aria-hidden="true"
            >
              <div
                className="h-full bg-white/90 rounded-full"
                style={{ width: `${nowPlaying.progressPercent}%` }}
              />
            </div>
          )}
        </div>
      </div>
    </button>
  );
});

export interface LiveChannelRowProps {
  title: string;
  groups: LiveChannelGroup[];
  rowIndex: number;
  serverUrl?: string;
  accountPrefix?: string;
  selectedGroupId: string | null;
  epgCache: ReadonlyMap<string, any[]>;
  epgCacheVersion: number;
  referenceNowMs?: number;
  virtualize?: boolean;
  onActivateGroup: (group: LiveChannelGroup, el: HTMLButtonElement) => void;
}

export const LiveChannelRow = React.memo(function LiveChannelRow({
  title,
  groups,
  rowIndex,
  serverUrl,
  accountPrefix = '',
  selectedGroupId,
  epgCache,
  epgCacheVersion,
  referenceNowMs,
  virtualize = true,
  onActivateGroup,
}: LiveChannelRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);
  const isRowPriority = rowIndex < 3;

  const isVirtualized = virtualize && groups.length > LIVE_ROW_RENDER_LIMIT;
  const anchorIndexRef = useRef<number | null>(null);
  const [renderRange, setRenderRange] = useState<{ start: number; end: number }>(() =>
    computeHorizontalRange({
      totalCount: groups.length,
      scrollLeft: 0,
      visibleSpan: 3,
      cardStep: DEFAULT_LIVE_WIDE_CARD_STEP_PX,
      overscan: LIVE_ROW_VIRTUAL_OVERSCAN,
      renderLimit: LIVE_ROW_RENDER_LIMIT,
    })
  );
  const rangeRef = useRef(renderRange);
  rangeRef.current = renderRange;

  const syncScrollAndRange = useCallback(
    (anchorOverride?: number | null) => {
      const el = rowRef.current;
      if (!el) return;
      const { scrollLeft, scrollWidth, clientWidth } = el;
      setCanScrollLeft(scrollLeft > 4);
      setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 4);

      if (!isVirtualized) {
        if (rangeRef.current.start !== 0 || rangeRef.current.end !== groups.length) {
          setRenderRange({ start: 0, end: groups.length });
        }
        return;
      }

      const metrics = resolveLiveRowMetrics(el);
      const next = computeHorizontalRange({
        totalCount: groups.length,
        scrollLeft,
        visibleSpan: metrics.visibleSpan,
        cardStep: metrics.cardStep,
        overscan: LIVE_ROW_VIRTUAL_OVERSCAN,
        renderLimit: LIVE_ROW_RENDER_LIMIT,
        anchorIndex: anchorOverride ?? anchorIndexRef.current,
      });

      if (next.start !== rangeRef.current.start || next.end !== rangeRef.current.end) {
        rangeRef.current = next;
        setRenderRange(next);
      }
    },
    [groups.length, isVirtualized]
  );

  useLayoutEffect(() => {
    syncScrollAndRange();
  }, [syncScrollAndRange, groups]);

  useEffect(() => {
    const el = rowRef.current;
    if (!el || !isVirtualized) return;

    registerVirtualContainer(el, {
      totalCount: groups.length,
      getColumns: () => Math.max(1, groups.length),
      ensureIndexMounted: (targetIndex: number) => {
        const clamped = Math.max(0, Math.min(groups.length - 1, targetIndex));
        anchorIndexRef.current = clamped;
        const cur = rangeRef.current;
        if (clamped >= cur.start && clamped < cur.end) {
          return false;
        }
        syncScrollAndRange(clamped);
        return true;
      },
    });

    return () => {
      unregisterVirtualContainer(el);
    };
  }, [groups.length, isVirtualized, syncScrollAndRange]);

  const handleStepScroll = (direction: 'left' | 'right') => {
    const el = rowRef.current;
    if (!el) return;
    const distance = Math.max(320, el.clientWidth * 0.8);
    const nextLeft =
      direction === 'left'
        ? Math.max(0, el.scrollLeft - distance)
        : Math.min(el.scrollWidth, el.scrollLeft + distance);
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ left: nextLeft, behavior: 'smooth' });
    } else {
      el.scrollLeft = nextLeft;
    }
  };

  if (groups.length === 0) return null;

  const displayedStart = isVirtualized ? renderRange.start : 0;
  const displayedEnd = isVirtualized ? Math.min(groups.length, renderRange.end) : groups.length;
  const displayedGroups = groups.slice(displayedStart, displayedEnd);

  const metrics = resolveLiveRowMetrics(rowRef.current);
  const leftSpacerPx = isVirtualized ? displayedStart * metrics.cardStep : 0;
  const rightSpacerPx = isVirtualized
    ? Math.max(0, (groups.length - displayedEnd) * metrics.cardStep)
    : 0;

  return (
    <div
      className="w-full relative group"
      data-home-row-index={rowIndex}
    >
      <h2 className="nc-heading-view font-semibold text-white mb-4 break-words whitespace-normal">
        {title}
      </h2>

      <div className="relative flex items-center">
        {canScrollLeft && (
          <button
            type="button"
            aria-label={`Rolar ${title} para a esquerda`}
            data-nav-ignore="true"
            tabIndex={-1}
            onClick={() => handleStepScroll('left')}
            className="hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 z-30 w-10 h-16 items-center justify-center rounded-r-xl bg-black/75 hover:bg-black/90 text-white border border-white/15 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}

        <div
          ref={rowRef}
          data-nav-row="true"
          data-virtual-container={isVirtualized ? 'true' : undefined}
          data-virtual-total={groups.length}
          onScroll={() => syncScrollAndRange()}
          style={{ overflowAnchor: 'none' }}
          className="flex flex-row overflow-x-auto scrollbar-hide w-full gap-4 px-2 pb-8 pt-4 touch-pan-x"
        >
          {leftSpacerPx > 0 && (
            <div
              aria-hidden="true"
              data-horizontal-spacer="left"
              className="shrink-0"
              style={{ width: `${leftSpacerPx}px` }}
            />
          )}

          {displayedGroups.map((group, idx) => {
            const actualIndex = displayedStart + idx;
            return (
              <div
                key={group.groupId}
                data-row-card-slot="true"
                className="shrink-0"
              >
                <LiveChannelCard
                  group={group}
                  serverUrl={serverUrl}
                  accountPrefix={accountPrefix}
                  isSelected={selectedGroupId === group.groupId}
                  epgCache={epgCache}
                  epgCacheVersion={epgCacheVersion}
                  referenceNowMs={referenceNowMs}
                  layoutVariant="row"
                  rowCardIndex={actualIndex}
                  virtualIndex={isVirtualized ? actualIndex : undefined}
                  rowPriority={isRowPriority && actualIndex < 6}
                  allowImageRender={true}
                  onActivate={onActivateGroup}
                />
              </div>
            );
          })}

          {rightSpacerPx > 0 && (
            <div
              aria-hidden="true"
              data-horizontal-spacer="right"
              className="shrink-0"
              style={{ width: `${rightSpacerPx}px` }}
            />
          )}
        </div>

        {canScrollRight && (
          <button
            type="button"
            aria-label={`Rolar ${title} para a direita`}
            data-nav-ignore="true"
            tabIndex={-1}
            onClick={() => handleStepScroll('right')}
            className="hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 z-30 w-10 h-16 items-center justify-center rounded-l-xl bg-black/75 hover:bg-black/90 text-white border border-white/15 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        )}
      </div>
    </div>
  );
});
