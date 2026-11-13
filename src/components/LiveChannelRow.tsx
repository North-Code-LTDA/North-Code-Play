import React, { useMemo, useCallback } from 'react';
import { MediaImage } from './MediaImage';
import { HorizontalRow, HorizontalRowCustomCardRenderParams } from './HorizontalRow';
import { LiveChannelGroup } from '../utils/liveChannelGroups';
import {
  buildEpgCacheKeys,
  resolveNowPlayingProgram,
  type ResolvedNowPlaying,
} from '../utils/epgUtils';
import { pushFocusMemory } from '../navigation';

export interface LiveChannelCardProps {
  group: LiveChannelGroup;
  serverUrl?: string;
  accountPrefix?: string;
  isSelected: boolean;
  isFocused?: boolean;
  epgCache: ReadonlyMap<string, any[]>;
  epgCacheVersion: number;
  referenceNowMs?: number;
  layoutVariant?: 'row' | 'grid';
  rowCardIndex?: number;
  virtualIndex?: number;
  rowPriority?: boolean;
  allowImageRender?: boolean;
  cardRef?: (el: HTMLElement | null) => void;
  onFocusCard?: () => void;
  onBlurCard?: () => void;
  onActivate: (group: LiveChannelGroup, el: HTMLButtonElement) => void;
}

export const LiveChannelCard = React.memo(function LiveChannelCard({
  group,
  serverUrl,
  accountPrefix = '',
  isSelected,
  isFocused = false,
  epgCache,
  epgCacheVersion,
  referenceNowMs,
  layoutVariant = 'row',
  rowCardIndex,
  virtualIndex,
  rowPriority = false,
  allowImageRender = true,
  cardRef,
  onFocusCard,
  onBlurCard,
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
      ref={cardRef}
      type="button"
      data-nav-item="true"
      data-showcase-card="true"
      data-live-channel-btn="true"
      data-live-channel-id={group.groupId}
      data-live-channel-category-id={String(group.category_id ?? '')}
      data-live-channel-selected={isSelected ? 'true' : 'false'}
      data-live-channel-origin={isSelected ? 'true' : 'false'}
      data-card-focused={isFocused ? 'true' : 'false'}
      data-row-card-index={rowCardIndex}
      data-virtual-index={virtualIndex}
      data-row-item-key={group.groupId}
      data-virtual-key={group.groupId}
      aria-label={group.displayName}
      aria-pressed={isSelected}
      onFocus={onFocusCard}
      onBlur={onBlurCard}
      onClick={(e) => {
        const el = e.currentTarget;
        if (typeof document !== 'undefined' && document.activeElement !== el) {
          try {
            el.focus({ preventScroll: true });
          } catch {}
        }
        pushFocusMemory(el);
        onActivate(group, el);
      }}
      className={`nc-showcase-card ${cardDimensionClass} relative z-0 hover:z-20 focus:z-20 focus-visible:z-20 group shrink-0 snap-start rounded-xl overflow-visible cursor-pointer select-none text-left p-0 bg-transparent border-0`}
    >
      <div
        data-card-visual="true"
        className={`nc-card-visual-layer relative w-full h-full rounded-xl overflow-hidden flex items-stretch border transition-colors ${
          isSelected
            ? 'bg-[#1f1f1f] border-white/40'
            : 'bg-nc-bg-card border-nc-border'
        }`}
      >
        {/* Left square dark visual block with centered undistorted logo matching Home live cards */}
        <div className="h-full aspect-square bg-black/40 border-r border-white/10 flex items-center justify-center p-2.5 sm:p-3 shrink-0 overflow-hidden">
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
        <div className="flex-1 min-w-0 px-3.5 sm:px-4 py-2.5 flex flex-col justify-between h-full">
          <div className="flex items-start justify-between gap-2 min-w-0">
            <p
              data-live-channel-name="true"
              className={`nc-tv-channel-name nc-card-title font-semibold min-w-0 flex-1 line-clamp-1 group-hover:text-white transition-colors ${
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

          <div className="min-w-0 flex flex-col gap-0.5 my-auto pt-0.5">
            {nowPlaying?.title ? (
              <>
                <p className="nc-text-meta font-medium text-white/90 line-clamp-1 whitespace-normal break-words">
                  {nowPlaying.title}
                </p>
                {nowPlaying.description ? (
                  <p className="nc-text-meta text-nc-text-secondary line-clamp-1 whitespace-normal break-words">
                    {nowPlaying.description}
                  </p>
                ) : nowPlaying.timeSlot ? (
                  <p className="nc-text-meta font-mono text-nc-text-secondary line-clamp-1">
                    {nowPlaying.timeSlot}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="nc-text-meta text-nc-text-secondary line-clamp-1">
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
  scrollContainer?: HTMLElement | null;
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
  scrollContainer = null,
  onActivateGroup,
}: LiveChannelRowProps) {
  const isRowPriority = rowIndex < 3;

  const renderCardItem = useCallback(
    ({
      item,
      index,
      itemKey,
      virtualize: isRowVirtualized,
      isFocused,
      setCardRef,
      onFocusCard,
      onBlurCard,
    }: HorizontalRowCustomCardRenderParams) => {
      const group = item as LiveChannelGroup;
      return (
        <LiveChannelCard
          key={itemKey}
          group={group}
          serverUrl={serverUrl}
          accountPrefix={accountPrefix}
          isSelected={selectedGroupId === group.groupId}
          isFocused={isFocused}
          epgCache={epgCache}
          epgCacheVersion={epgCacheVersion}
          referenceNowMs={referenceNowMs}
          layoutVariant="row"
          rowCardIndex={index}
          virtualIndex={isRowVirtualized ? index : undefined}
          rowPriority={isRowPriority && index < 6}
          allowImageRender={true}
          cardRef={setCardRef}
          onFocusCard={onFocusCard}
          onBlurCard={onBlurCard}
          onActivate={onActivateGroup}
        />
      );
    },
    [
      serverUrl,
      accountPrefix,
      selectedGroupId,
      epgCache,
      epgCacheVersion,
      referenceNowMs,
      isRowPriority,
      onActivateGroup,
    ]
  );

  const handleRowItemClick = useCallback(
    (item: any, element?: HTMLElement) => {
      if (item && element instanceof HTMLButtonElement) {
        onActivateGroup(item as LiveChannelGroup, element);
      } else if (item) {
        onActivateGroup(item as LiveChannelGroup, (element as HTMLButtonElement) || null!);
      }
    },
    [onActivateGroup]
  );

  if (groups.length === 0) return null;

  return (
    <HorizontalRow
      title={title}
      items={groups}
      type="live"
      cardVariant="live-wide"
      rowIndex={rowIndex}
      scrollContainer={scrollContainer}
      virtualize={virtualize}
      onItemClick={handleRowItemClick}
      renderCardItem={renderCardItem}
    />
  );
});
