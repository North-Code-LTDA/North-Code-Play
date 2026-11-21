import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import {
  Tv,
  Heart,
  ChevronLeft,
  ChevronRight,
  Clock,
  Radio,
  AlertCircle,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { XtreamCredentials, Category, LiveStream } from '../types';
import { useXtreamCredentials, useXtreamLive } from '../context/XtreamContext';
import { VideoPlayer, VideoPlayerHandle } from '../components/VideoPlayer';
import { MediaImage, observeContainerVisibility, notifyContainerScrollForFallback } from '../components/MediaImage';
import { useFavorites } from '../hooks/useFavorites';
import { useAccountPlaybackHistory, recordPlaybackPosition } from '../utils/playbackHistory';
import { buildDirectMediaUrl } from '../utils/mediaUtils';
import { setLiveTvPreviewPlaybackActiveForImagePreload } from '../services/androidImageCache';
import {
  LiveChannelGroup,
  ChannelVariant,
  ResolutionQuality,
  groupLiveStreams,
  filterLiveChannelGroups,
  parseChannelVariantSuffix,
} from '../utils/liveChannelGroups';
import { getOrCreateLiveIndex } from '../utils/catalogIndex';
import { formatLiveTvCategoryTitle } from '../utils/categoryLabel';
import {
  LiveEpgSnapshot,
  getCachedLiveEpgSnapshot,
  getPreferredEpgStreamIdForGroup,
  subscribeLiveChannelEpg,
} from '../utils/liveEpgManager';
import { useVirtualWindow } from '../hooks/useVirtualWindow';
import { usePerformanceProfile } from '../platform/performanceProfile';
import { useDisplayPreferences } from '../platform/tvEnvironment';
import {
  useBackHandler,
  BACK_PRIORITY,
  getNavMode,
  focusElementSafely,
  registerVirtualContainer,
  unregisterVirtualContainer,
  registerShowcaseRowController,
  unregisterShowcaseRowController,
  invalidateCandidateCache,
} from '../navigation';

export const AUTO_RESOLUTION_PRIORITY: ResolutionQuality[] = ['SD', 'HD', 'FHD', '4K'];

let liveFallbackTimeoutMs = 28000;

export function setLiveFallbackTimeoutMsForTest(ms: number): void {
  liveFallbackTimeoutMs = Math.max(10, Math.floor(ms || 28000));
}

export function getLiveFallbackTimeoutMsForTest(): number {
  return liveFallbackTimeoutMs;
}

const FULL_VERTICAL_VISIBILITY_MARGIN = '240px 0px';
const FULL_HORIZ_VISIBILITY_MARGIN = '0px 280px';
const LITE_VERTICAL_VISIBILITY_MARGIN = '32px 0px';
const LITE_HORIZ_VISIBILITY_MARGIN = '0px 32px';

const LITE_EPG_SECONDARY_DELAY_MS = 150;
const LITE_EPG_FOCUSED_BURST_MS = 55;
const LITE_EPG_BURST_WINDOW_MS = 90;

let nextLiteEpgEntryId = 1;

function resolveRemPxFromScaleKey(displayScaleKey: string): number {
  const parts = displayScaleKey.split(':');
  if (parts[0] === 'tv') {
    const raw = parseFloat(parts[1] || '');
    const ratio = Number.isFinite(raw) && raw > 0 ? (raw > 2 ? raw / 100 : raw) : 0.85;
    return 16 * Math.max(0.5, Math.min(1.25, ratio));
  }
  return 16;
}

function computeLiteInitialVisibleRowRange(
  leftScrollEl: HTMLElement | null,
  displayScaleKey: string
): { startRow: number; endRow: number } {
  const remPx = resolveRemPxFromScaleKey(displayScaleKey);
  const scaleRatio = remPx / 16;
  let viewportHeight = 0;
  let scrollTop = 0;

  if (leftScrollEl) {
    scrollTop = leftScrollEl.scrollTop || 0;
    if (leftScrollEl.clientHeight > 0) {
      viewportHeight = leftScrollEl.clientHeight;
    } else {
      const rect = leftScrollEl.getBoundingClientRect();
      if (rect.height > 0) viewportHeight = rect.height;
    }
  }

  if (viewportHeight <= 0) {
    const winH =
      typeof window !== 'undefined' && typeof window.innerHeight === 'number' && window.innerHeight > 0
        ? window.innerHeight
        : 720;
    const headerReserve = Math.round((68 + 56) * scaleRatio);
    viewportHeight = Math.max(180, winH - headerReserve);
  }

  const rowStridePx = Math.max(88, Math.round(9.15 * remPx));
  const startRow = Math.max(0, Math.floor(Math.max(0, scrollTop) / rowStridePx));
  const visibleRows = Math.max(1, Math.ceil(viewportHeight / rowStridePx));
  return { startRow, endRow: startRow + visibleRows };
}

function computeLiteInitialVisibleCardRange(
  rowScrollEl: HTMLElement | null,
  leftScrollEl: HTMLElement | null,
  displayScaleKey: string
): { startCard: number; endCard: number } {
  const remPx = resolveRemPxFromScaleKey(displayScaleKey);
  const isSmUp =
    typeof window === 'undefined' ||
    typeof window.innerWidth !== 'number' ||
    window.innerWidth === 0 ||
    window.innerWidth >= 640;

  const cardWidth = (isSmUp ? 16.75 : 15.75) * remPx;
  const gap = 0.75 * remPx;
  const stride = Math.max(1, cardWidth + gap);

  let viewportWidth = 0;
  let scrollLeft = 0;

  if (rowScrollEl) {
    scrollLeft = rowScrollEl.scrollLeft || 0;
    if (rowScrollEl.clientWidth > 0) {
      viewportWidth = rowScrollEl.clientWidth;
    }
  }

  if (viewportWidth <= 0 && leftScrollEl && leftScrollEl.clientWidth > 0) {
    viewportWidth = Math.max(cardWidth, leftScrollEl.clientWidth - 3 * remPx);
  }

  if (viewportWidth <= 0) {
    const winW =
      typeof window !== 'undefined' && typeof window.innerWidth === 'number' && window.innerWidth > 0
        ? window.innerWidth
        : 1280;
    const paneW = winW >= 768 ? winW * 0.5 : winW;
    viewportWidth = Math.max(cardWidth, paneW - 3 * remPx);
  }

  const startCard = Math.max(0, Math.floor(Math.max(0, scrollLeft) / stride));
  const visibleCards = Math.max(1, Math.ceil(viewportWidth / stride));
  return { startCard, endCard: startCard + visibleCards };
}

function areCardEpgSnapshotsEquivalent(
  prev: LiveEpgSnapshot | null,
  next: LiveEpgSnapshot | null
): boolean {
  if (prev === next) return true;
  const prevTitle = prev?.currentProgram?.title?.trim() || '';
  const nextTitle = next?.currentProgram?.title?.trim() || '';
  if (!prevTitle && !nextTitle) {
    // Both render the exact same fallback string ("Programação indisponível")
    return true;
  }
  if (prevTitle !== nextTitle) return false;
  const prevStart = prev?.currentProgram?.startMs ?? 0;
  const nextStart = next?.currentProgram?.startMs ?? 0;
  const prevEnd = prev?.currentProgram?.endMs ?? 0;
  const nextEnd = next?.currentProgram?.endMs ?? 0;
  return prevStart === nextStart && prevEnd === nextEnd;
}

function areRightPaneEpgSnapshotsEquivalent(
  prev: LiveEpgSnapshot | null,
  next: LiveEpgSnapshot | null
): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;
  if (prev.status !== next.status || prev.streamId !== next.streamId) return false;

  const pCur = prev.currentProgram;
  const nCur = next.currentProgram;
  if (Boolean(pCur) !== Boolean(nCur)) return false;
  if (pCur && nCur) {
    if (
      pCur.id !== nCur.id ||
      pCur.title !== nCur.title ||
      pCur.description !== nCur.description ||
      pCur.startMs !== nCur.startMs ||
      pCur.endMs !== nCur.endMs ||
      pCur.startLabel !== nCur.startLabel ||
      pCur.endLabel !== nCur.endLabel
    ) {
      return false;
    }
  }

  if (prev.timeline.length !== next.timeline.length) return false;
  for (let i = 0; i < prev.timeline.length; i++) {
    const a = prev.timeline[i];
    const b = next.timeline[i];
    if (
      a.id !== b.id ||
      a.title !== b.title ||
      a.description !== b.description ||
      a.startMs !== b.startMs ||
      a.endMs !== b.endMs ||
      a.startLabel !== b.startLabel ||
      a.endLabel !== b.endLabel ||
      a.isCurrent !== b.isCurrent
    ) {
      return false;
    }
  }
  return true;
}

interface LitePendingEpgEntry {
  entryId: number;
  credentials: XtreamCredentials;
  streamId: number;
  onUpdate: (snapshot: LiveEpgSnapshot) => void;
  readyAtMs: number;
  isFocused: boolean;
}

/**
 * Centralized coordinator for secondary (priority: 'normal') card EPG subscriptions in Lite mode.
 * Uses at most ONE shared timeout across the entire LiveTvView (zero per-card timers, zero polling),
 * prioritizes focused cards immediately (with micro-stabilization only during rapid held-key bursts),
 * and cancels transient entries before subscribing when cards scroll away or unmount.
 * Never affects right-pane EPG subscriptions (priority: 'high').
 */
class LiteEpgCoordinator {
  private pending = new Map<number, LitePendingEpgEntry>();
  private activeSubs = new Map<number, () => void>();
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private lastFocusMoveMs = 0;
  private focusedEntryId: number | null = null;
  private disposed = false;

  private nowMs(): number {
    return typeof Date !== 'undefined' ? Date.now() : 0;
  }

  private clearTimer(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  private armNextTimer(now: number): void {
    this.clearTimer();
    if (this.disposed || this.pending.size === 0) return;

    let earliestReadyAt = Infinity;
    this.pending.forEach((entry) => {
      if (entry.readyAtMs < earliestReadyAt) {
        earliestReadyAt = entry.readyAtMs;
      }
    });

    if (!Number.isFinite(earliestReadyAt)) return;
    const delay = Math.max(0, earliestReadyAt - now);
    this.timerId = setTimeout(() => {
      this.timerId = null;
      this.flushDue();
    }, delay);
  }

  private activateEntry(entry: LitePendingEpgEntry): void {
    if (this.disposed) return;
    const cached = getCachedLiveEpgSnapshot(entry.credentials, entry.streamId);
    if (cached) {
      entry.onUpdate(cached);
      return;
    }
    const prevUnsub = this.activeSubs.get(entry.entryId);
    if (prevUnsub) {
      prevUnsub();
      this.activeSubs.delete(entry.entryId);
    }
    const unsub = subscribeLiveChannelEpg({
      credentials: entry.credentials,
      streamId: entry.streamId,
      priority: 'normal',
      onUpdate: entry.onUpdate,
    });
    this.activeSubs.set(entry.entryId, unsub);
  }

  private flushDue(): void {
    if (this.disposed) return;
    const now = this.nowMs();
    const due: LitePendingEpgEntry[] = [];

    this.pending.forEach((entry) => {
      if (entry.readyAtMs <= now + 4) {
        due.push(entry);
      }
    });

    // Always flush focused card first ahead of non-focused visible neighbors
    due.sort((a, b) => Number(b.isFocused) - Number(a.isFocused));

    for (let i = 0; i < due.length; i++) {
      const entry = due[i];
      if (!this.pending.has(entry.entryId)) continue;
      this.pending.delete(entry.entryId);
      this.activateEntry(entry);
    }

    if (this.pending.size > 0) {
      this.armNextTimer(this.nowMs());
    }
  }

  schedule(
    entryId: number,
    credentials: XtreamCredentials,
    streamId: number,
    onUpdate: (snapshot: LiveEpgSnapshot) => void,
    options: { isFocused: boolean }
  ): void {
    if (this.disposed) return;
    this.cancel(entryId);

    const now = this.nowMs();
    if (options.isFocused) {
      this.focusedEntryId = entryId;
      const isBurst = this.lastFocusMoveMs > 0 && now - this.lastFocusMoveMs < LITE_EPG_BURST_WINDOW_MS;
      if (!isBurst) {
        this.activateEntry({
          entryId,
          credentials,
          streamId,
          onUpdate,
          readyAtMs: now,
          isFocused: true,
        });
        return;
      }
      this.pending.set(entryId, {
        entryId,
        credentials,
        streamId,
        onUpdate,
        readyAtMs: now + LITE_EPG_FOCUSED_BURST_MS,
        isFocused: true,
      });
      this.armNextTimer(now);
      return;
    }

    this.pending.set(entryId, {
      entryId,
      credentials,
      streamId,
      onUpdate,
      readyAtMs: now + LITE_EPG_SECONDARY_DELAY_MS,
      isFocused: false,
    });
    this.armNextTimer(now);
  }

  notifyFocus(
    entryId: number,
    credentials: XtreamCredentials,
    streamId: number,
    onUpdate: (snapshot: LiveEpgSnapshot) => void
  ): void {
    if (this.disposed) return;
    const now = this.nowMs();
    const isRapidBurst =
      this.lastFocusMoveMs > 0 && now - this.lastFocusMoveMs < LITE_EPG_BURST_WINDOW_MS;
    this.lastFocusMoveMs = now;

    // Demote any previously focused pending entry that lost focus during a burst
    if (this.focusedEntryId !== null && this.focusedEntryId !== entryId) {
      const prevPending = this.pending.get(this.focusedEntryId);
      if (prevPending && prevPending.isFocused) {
        prevPending.isFocused = false;
        prevPending.readyAtMs = Math.max(prevPending.readyAtMs, now + LITE_EPG_SECONDARY_DELAY_MS);
      }
    }
    this.focusedEntryId = entryId;

    // Already actively subscribed for this card
    if (this.activeSubs.has(entryId)) {
      return;
    }

    const cached = getCachedLiveEpgSnapshot(credentials, streamId);
    if (cached) {
      this.pending.delete(entryId);
      onUpdate(cached);
      if (this.pending.size === 0) this.clearTimer();
      return;
    }

    if (!isRapidBurst) {
      this.pending.delete(entryId);
      this.activateEntry({
        entryId,
        credentials,
        streamId,
        onUpdate,
        readyAtMs: now,
        isFocused: true,
      });
      if (this.pending.size === 0) this.clearTimer();
      return;
    }

    // Rapid D-Pad burst: push back non-focused neighbors and prioritize the resting focused card
    this.pending.forEach((other) => {
      if (other.entryId !== entryId && !other.isFocused) {
        other.readyAtMs = Math.max(other.readyAtMs, now + LITE_EPG_SECONDARY_DELAY_MS);
      }
    });

    this.pending.set(entryId, {
      entryId,
      credentials,
      streamId,
      onUpdate,
      readyAtMs: now + LITE_EPG_FOCUSED_BURST_MS,
      isFocused: true,
    });
    this.armNextTimer(now);
  }

  notifyBlur(entryId: number, isStillVisible: boolean): void {
    if (this.focusedEntryId === entryId) {
      this.focusedEntryId = null;
    }
    if (!isStillVisible) {
      this.cancel(entryId);
      return;
    }
    const existing = this.pending.get(entryId);
    if (existing && existing.isFocused) {
      const now = this.nowMs();
      existing.isFocused = false;
      existing.readyAtMs = Math.max(existing.readyAtMs, now + LITE_EPG_SECONDARY_DELAY_MS);
      this.armNextTimer(now);
    }
  }

  notifyScrollActivity(): void {
    if (this.disposed || this.pending.size === 0) return;
    const now = this.nowMs();
    let changed = false;
    this.pending.forEach((entry) => {
      if (!entry.isFocused) {
        const nextReady = now + LITE_EPG_SECONDARY_DELAY_MS;
        if (nextReady > entry.readyAtMs) {
          entry.readyAtMs = nextReady;
          changed = true;
        }
      }
    });
    if (changed) {
      this.armNextTimer(now);
    }
  }

  cancel(entryId: number): void {
    if (this.focusedEntryId === entryId) {
      this.focusedEntryId = null;
    }
    this.pending.delete(entryId);
    const unsub = this.activeSubs.get(entryId);
    if (unsub) {
      this.activeSubs.delete(entryId);
      unsub();
    }
    if (this.pending.size === 0) {
      this.clearTimer();
    }
  }

  flushAllImmediate(): void {
    if (this.disposed || this.pending.size === 0) return;
    this.clearTimer();
    const entries = Array.from(this.pending.values());
    this.pending.clear();
    entries.sort((a, b) => Number(b.isFocused) - Number(a.isFocused));
    for (let i = 0; i < entries.length; i++) {
      this.activateEntry(entries[i]);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    this.pending.clear();
    this.activeSubs.forEach((unsub) => {
      try {
        unsub();
      } catch {}
    });
    this.activeSubs.clear();
    this.focusedEntryId = null;
  }
}

export interface LiveFocusOriginSnapshot {
  groupId: string | null;
  categoryId: string | null;
  rowIndex: number;
  cardIndex: number;
}

export interface LiveChannelLaunchIntent {
  streamId: string | number;
  requestId: number;
  categoryId?: string;
  streamSnapshot?: any;
}

export interface LiveTvViewProps {
  onPlay?: (...args: any[]) => void;
  searchQuery?: string;
  isTvMode?: boolean;
  initialChannelIntent?: LiveChannelLaunchIntent | null;
  onConsumeChannelIntent?: (requestId: number) => void;
}

interface LiveCategoryRowDescriptor {
  id: string;
  categoryId: string;
  rawTitle: string;
  channels: LiveChannelGroup[];
}

function getGroupPrimaryStream(group: LiveChannelGroup | null | undefined): any {
  if (!group) return null;
  if (group.primaryStream) return group.primaryStream;
  if (Array.isArray(group.variants) && group.variants.length > 0 && group.variants[0]?.stream) {
    return group.variants[0].stream;
  }
  if (Array.isArray(group.allStreams) && group.allStreams.length > 0) {
    return group.allStreams[0];
  }
  return null;
}

function getStreamIdString(stream: any): string {
  const id = stream?.stream_id ?? stream?.id ?? '';
  return id !== undefined && id !== null ? String(id) : '';
}

function collectGroupStreamIds(group: LiveChannelGroup | null | undefined): string[] {
  if (!group) return [];
  const ids = new Set<string>();
  const primary = getStreamIdString(group.primaryStream);
  if (primary) ids.add(primary);
  if (Array.isArray(group.allStreams)) {
    for (const s of group.allStreams) {
      const id = getStreamIdString(s);
      if (id) ids.add(id);
    }
  }
  if (Array.isArray(group.variants)) {
    for (const v of group.variants) {
      const id = v?.streamId !== undefined && v?.streamId !== null
        ? String(v.streamId)
        : getStreamIdString(v?.stream);
      if (id) ids.add(id);
    }
  }
  return Array.from(ids);
}

function buildFallbackGroupFromStream(stream: any, fallbackCategoryId?: string): LiveChannelGroup {
  const sId = stream?.stream_id ?? stream?.id ?? '';
  const catId = stream?.category_id ?? fallbackCategoryId ?? 'default';
  const parsed = parseChannelVariantSuffix(stream?.name);
  return {
    groupId: JSON.stringify(['single', String(catId), String(sId)]),
    displayName: parsed.baseName || (typeof stream?.name === 'string' && stream.name.trim() ? stream.name : 'Canal Ao Vivo'),
    category_id: catId,
    epg_channel_id: stream?.epg_channel_id ? String(stream.epg_channel_id) : undefined,
    stream_icon: stream?.stream_icon,
    isGrouped: false,
    variants: [],
    primaryStream: stream,
    allStreams: [stream],
  };
}

function normalizeGroupCandidates(group: LiveChannelGroup): ChannelVariant[] {
  const seen = new Set<string>();
  const candidates: ChannelVariant[] = [];

  if (Array.isArray(group.variants)) {
    for (const v of group.variants) {
      if (!v || !v.stream) continue;
      const sId = String(v.streamId ?? getStreamIdString(v.stream));
      if (!sId || seen.has(sId)) continue;
      seen.add(sId);
      candidates.push({
        resolution: v.resolution,
        stream: v.stream,
        streamId: v.streamId ?? sId,
        label: v.label || v.resolution || 'SD',
      });
    }
  }

  const extraStreams: any[] = [];
  if (group.primaryStream) extraStreams.push(group.primaryStream);
  if (Array.isArray(group.allStreams)) extraStreams.push(...group.allStreams);

  for (const s of extraStreams) {
    if (!s || typeof s !== 'object') continue;
    const sId = getStreamIdString(s);
    if (!sId || seen.has(sId)) continue;
    seen.add(sId);
    const parsed = parseChannelVariantSuffix(s.name);
    const res: ResolutionQuality = parsed.resolution || 'SD';
    candidates.push({
      resolution: res,
      stream: s,
      streamId: s.stream_id ?? s.id ?? sId,
      label: res,
    });
  }

  return candidates;
}

export interface LiveTvLayoutMetricsInput {
  viewportWidth: number;
  viewportHeight: number;
  uiScale: number;
  displayMode: 'default' | 'tv';
  isGrouped: boolean;
  hasNowPlaying: boolean;
  epgCount: number;
}

export interface LiveTvLayoutMetrics {
  isMobile: boolean;
  topSectionDirection: 'row' | 'column';
  rightPaneWidth: number;
  previewWidth: number;
  previewHeight: number;
  previewAspectRatio: number;
  topSectionHeight: number;
  epgHeaderHeight: number;
  epgSectionHeight: number;
  epgScrollViewportHeight: number;
  epgCardHeight: number;
  epgTotalContentHeight: number;
  visibleEpgCardsCount: number;
  epgMaxScrollTop: number;
}

export function computeLiveTvLayoutMetrics(input: LiveTvLayoutMetricsInput): LiveTvLayoutMetrics {
  const {
    viewportWidth,
    viewportHeight,
    uiScale,
    displayMode,
    isGrouped,
    hasNowPlaying,
    epgCount,
  } = input;

  const isMobile = viewportWidth < 768;
  const scale = Math.max(0.5, Math.min(1.25, uiScale || 1));
  const topHeaderHeight = isMobile ? Math.round(92 * scale) : Math.round(68 * scale);
  const availableHeight = Math.max(320, viewportHeight - topHeaderHeight);
  const rightPaneWidth = isMobile ? viewportWidth : Math.round(viewportWidth * 0.5);
  const topSectionDirection: 'row' | 'column' = isMobile ? 'column' : 'row';

  const previewWidth = isMobile
    ? Math.max(240, rightPaneWidth - 32)
    : Math.max(176, Math.min(Math.round(viewportWidth * 0.22), Math.round(336 * scale)));
  const previewHeight = Math.round((previewWidth * 9) / 16);
  const previewAspectRatio = previewHeight > 0 ? previewWidth / previewHeight : 16 / 9;

  const extraTopPadding =
    (isGrouped ? Math.round(28 * scale) : 0) + (hasNowPlaying ? Math.round(36 * scale) : 0);
  const topSectionHeight = isMobile
    ? previewHeight + Math.round(130 * scale) + extraTopPadding
    : Math.max(
        previewHeight + Math.round(28 * scale),
        Math.min(
          Math.round(availableHeight * 0.42),
          Math.round((displayMode === 'tv' ? 148 : 164) * scale + extraTopPadding * 0.35)
        )
      );

  const epgHeaderHeight = Math.max(30, Math.round(38 * scale));
  const epgSectionHeight = Math.max(260, availableHeight - topSectionHeight);
  const epgScrollViewportHeight = Math.max(220, epgSectionHeight - epgHeaderHeight);
  const epgCardHeight = Math.max(58, Math.round(72 * scale));
  const epgCardGap = 10;
  const epgTotalContentHeight = Math.max(0, epgCount * (epgCardHeight + epgCardGap));
  const visibleEpgCardsCount = Number(
    (epgScrollViewportHeight / (epgCardHeight + epgCardGap)).toFixed(2)
  );
  const epgMaxScrollTop = Math.max(0, epgTotalContentHeight - epgScrollViewportHeight);

  return {
    isMobile,
    topSectionDirection,
    rightPaneWidth,
    previewWidth,
    previewHeight,
    previewAspectRatio,
    topSectionHeight,
    epgHeaderHeight,
    epgSectionHeight,
    epgScrollViewportHeight,
    epgCardHeight,
    epgTotalContentHeight,
    visibleEpgCardsCount,
    epgMaxScrollTop,
  };
}

export type SelectedChannelVariantResult = ChannelVariant & {
  stream_id: string | number;
  name?: string;
};

function toSelectedVariantResult(variant: ChannelVariant): SelectedChannelVariantResult {
  const rawStreamId = variant.stream?.stream_id ?? variant.stream?.id ?? variant.streamId;
  return {
    ...variant,
    stream_id: rawStreamId,
    name: variant.stream?.name,
  };
}

/**
 * Selects the best channel variant for playback or fallback without mutating `triedStreamIds`.
 * - Manual mode: tries exact `selectedVariantIdOrAuto`, then siblings of same resolution,
 *   then `AUTO_RESOLUTION_PRIORITY` (`SD -> HD -> FHD -> 4K`), then any remaining untried stream.
 * - Auto mode: tries `AUTO_RESOLUTION_PRIORITY` (`SD -> HD -> FHD -> 4K`), then remaining streams.
 * - Returns `null` once all streams in the group are exhausted.
 */
export function selectChannelVariantForAttempt(
  group: LiveChannelGroup | null | undefined,
  selectedVariantIdOrAuto: string,
  triedStreamIds: ReadonlySet<string | number>
): SelectedChannelVariantResult | null {
  if (!group) return null;
  const candidates = normalizeGroupCandidates(group);
  if (candidates.length === 0) return null;

  const triedStrings = new Set<string>();
  triedStreamIds.forEach((id) => {
    if (id !== undefined && id !== null) {
      triedStrings.add(String(id));
    }
  });

  const untried = candidates.filter((c) => !triedStrings.has(String(c.streamId)));
  if (untried.length === 0) return null;

  if (selectedVariantIdOrAuto && selectedVariantIdOrAuto !== 'auto') {
    const requestedStr = String(selectedVariantIdOrAuto);
    const exactMatch = untried.find((c) => String(c.streamId) === requestedStr);
    if (exactMatch) {
      return toSelectedVariantResult(exactMatch);
    }

    const requestedCandidate = candidates.find((c) => String(c.streamId) === requestedStr);
    if (requestedCandidate?.resolution) {
      const sameRes = untried.find((c) => c.resolution === requestedCandidate.resolution);
      if (sameRes) {
        return toSelectedVariantResult(sameRes);
      }
    }
  }

  for (const res of AUTO_RESOLUTION_PRIORITY) {
    const match = untried.find((c) => c.resolution === res);
    if (match) {
      return toSelectedVariantResult(match);
    }
  }

  return untried[0] ? toSelectedVariantResult(untried[0]) : null;
}

function getStreamResolutionLabel(stream: any, group?: LiveChannelGroup | null): ResolutionQuality | null {
  if (!stream) return null;
  const sId = getStreamIdString(stream);
  if (group && Array.isArray(group.variants)) {
    const variant = group.variants.find((v) => String(v.streamId) === sId);
    if (variant?.resolution) return variant.resolution;
  }
  const parsed = parseChannelVariantSuffix(stream.name);
  return parsed.resolution;
}

// ============================================================================
// LiveChannelCard
// Compact horizontal channel card: square logo left, channel name top-right,
// real EPG program title below (no "Passando Agora" prefix, no version badges).
// ============================================================================

interface LiveChannelCardProps {
  group: LiveChannelGroup;
  categoryId: string;
  rowIndex: number;
  cardIndex: number;
  credentials: XtreamCredentials | null;
  isSelected: boolean;
  isLitePerformanceMode: boolean;
  displayScaleKey: string;
  leftScrollEl: HTMLElement | null;
  liteEpgCoordinator: LiteEpgCoordinator;
  getOriginSnapshot: () => LiveFocusOriginSnapshot;
  isFavorite: boolean;
  isRowVisible: boolean;
  rowScrollEl: HTMLElement | null;
  onEnsureRowVisible: () => void;
  onSelectGroup: (
    group: LiveChannelGroup,
    categoryId: string,
    rowIndex: number,
    cardIndex: number,
    buttonEl?: HTMLButtonElement | null
  ) => void;
  onToggleFavorite: (group: LiveChannelGroup) => void;
  onFocusCard: (
    groupId: string,
    categoryId: string,
    rowIndex: number,
    cardIndex: number,
    buttonEl?: HTMLButtonElement | null
  ) => void;
  onRegisterOriginButton: (btn: HTMLButtonElement) => void;
  onCardElementRef?: (cardIndex: number, el: HTMLDivElement | null) => void;
}

const LiveChannelCard = React.memo(function LiveChannelCard({
  group,
  categoryId,
  rowIndex,
  cardIndex,
  credentials,
  isSelected,
  isLitePerformanceMode,
  displayScaleKey,
  leftScrollEl,
  liteEpgCoordinator,
  getOriginSnapshot,
  isFavorite,
  isRowVisible,
  rowScrollEl,
  onEnsureRowVisible,
  onSelectGroup,
  onToggleFavorite,
  onFocusCard,
  onRegisterOriginButton,
  onCardElementRef,
}: LiveChannelCardProps) {
  const cardWrapRef = useRef<HTMLDivElement | null>(null);
  const channelBtnRef = useRef<HTMLButtonElement | null>(null);
  const epgEntryIdRef = useRef<number>(0);
  if (epgEntryIdRef.current === 0) {
    epgEntryIdRef.current = nextLiteEpgEntryId++;
  }

  const [isHorizVisible, setIsHorizVisible] = useState<boolean>(() => {
    if (!isLitePerformanceMode) {
      return cardIndex < 10;
    }
    const range = computeLiteInitialVisibleCardRange(rowScrollEl, leftScrollEl, displayScaleKey);
    return cardIndex >= range.startCard && cardIndex < range.endCard;
  });
  const isHorizVisibleRef = useRef<boolean>(isHorizVisible);
  isHorizVisibleRef.current = isHorizVisible;

  const setCardWrapCallbackRef = useCallback(
    (node: HTMLDivElement | null) => {
      cardWrapRef.current = node;
      onCardElementRef?.(cardIndex, node);
    },
    [cardIndex, onCardElementRef]
  );

  // Sync imperative focus & origin attributes only on mount / identity change (never on EPG re-renders)
  useLayoutEffect(() => {
    const btn = channelBtnRef.current;
    if (btn) {
      const snap = getOriginSnapshot();
      const matchesOrigin =
        snap.groupId === group.groupId && snap.categoryId === categoryId;
      if (matchesOrigin) {
        if (btn.getAttribute('data-live-channel-origin') !== 'true') {
          btn.setAttribute('data-live-channel-origin', 'true');
        }
        onRegisterOriginButton(btn);
      } else if (btn.hasAttribute('data-live-channel-origin')) {
        btn.removeAttribute('data-live-channel-origin');
      }
    }

    const wrap = cardWrapRef.current;
    if (wrap && typeof document !== 'undefined') {
      const activeEl = document.activeElement;
      const isFocusedNow = Boolean(activeEl && wrap.contains(activeEl));
      if (isFocusedNow) {
        if (wrap.getAttribute('data-card-focused') !== 'true') {
          wrap.setAttribute('data-card-focused', 'true');
        }
      } else if (wrap.hasAttribute('data-card-focused')) {
        wrap.removeAttribute('data-card-focused');
      }
    }
  }, [group.groupId, categoryId, getOriginSnapshot, onRegisterOriginButton]);

  const primaryStream = getGroupPrimaryStream(group);
  const primaryStreamId = getStreamIdString(primaryStream) || group.groupId;
  const preferredEpgStreamId = useMemo(
    () => getPreferredEpgStreamIdForGroup(group) || Number(primaryStream?.stream_id ?? primaryStream?.id ?? 0),
    [group, primaryStream]
  );

  const [focusActivatedLogoKey, setFocusActivatedLogoKey] = useState<string | null>(null);

  const [epgSnapshot, setEpgSnapshot] = useState<LiveEpgSnapshot | null>(() => {
    if (!credentials || !preferredEpgStreamId) return null;
    return getCachedLiveEpgSnapshot(credentials, preferredEpgStreamId);
  });

  const applyCardEpgSnapshot = useCallback(
    (snap: LiveEpgSnapshot | null, expectedStreamId: number) => {
      if (snap && snap.streamId && expectedStreamId > 0 && snap.streamId !== expectedStreamId) {
        return;
      }
      setEpgSnapshot((prev) => (areCardEpgSnapshotsEquivalent(prev, snap) ? prev : snap));
    },
    []
  );

  const prevEpgIdentityRef = useRef<{ creds: XtreamCredentials | null; streamId: number }>({
    creds: credentials,
    streamId: preferredEpgStreamId,
  });

  useEffect(() => {
    if (
      prevEpgIdentityRef.current.creds !== credentials ||
      prevEpgIdentityRef.current.streamId !== preferredEpgStreamId
    ) {
      prevEpgIdentityRef.current = { creds: credentials, streamId: preferredEpgStreamId };
      const cached =
        credentials && preferredEpgStreamId
          ? getCachedLiveEpgSnapshot(credentials, preferredEpgStreamId)
          : null;
      applyCardEpgSnapshot(cached, preferredEpgStreamId);
    }
  }, [credentials, preferredEpgStreamId, applyCardEpgSnapshot]);

  const horizRootMargin = isLitePerformanceMode
    ? LITE_HORIZ_VISIBILITY_MARGIN
    : FULL_HORIZ_VISIBILITY_MARGIN;

  useEffect(() => {
    const el = cardWrapRef.current;
    if (!el || !rowScrollEl) return;
    return observeContainerVisibility({
      target: el,
      root: rowScrollEl,
      rootMargin: horizRootMargin,
      axis: 'horizontal',
      index: cardIndex,
      onIntersectChange: (intersecting) => {
        if (!intersecting && typeof IntersectionObserver === 'undefined') {
          const rect = el.getBoundingClientRect();
          const rootRect = rowScrollEl?.getBoundingClientRect();
          if (
            rect.width === 0 &&
            rect.height === 0 &&
            (!rootRect || (rootRect.width === 0 && rootRect.height === 0))
          ) {
            return;
          }
        }
        if (isHorizVisibleRef.current === intersecting) return;
        isHorizVisibleRef.current = intersecting;
        setIsHorizVisible(intersecting);
      },
    });
  }, [rowScrollEl, cardIndex, horizRootMargin]);

  const isCardActiveForAssets = isRowVisible && isHorizVisible;
  const isCardActiveForAssetsRef = useRef<boolean>(isCardActiveForAssets);
  isCardActiveForAssetsRef.current = isCardActiveForAssets;

  const isLogoActive = isCardActiveForAssets || focusActivatedLogoKey === primaryStreamId;

  // Always cancel any coordinator subscription on unmount (including focus-initiated subscriptions)
  useEffect(() => {
    const entryId = epgEntryIdRef.current;
    return () => {
      liteEpgCoordinator.cancel(entryId);
    };
  }, [liteEpgCoordinator]);

  useEffect(() => {
    const entryId = epgEntryIdRef.current;
    const wrap = cardWrapRef.current;
    const isFocusedNow = Boolean(
      typeof document !== 'undefined' && wrap && document.activeElement && wrap.contains(document.activeElement)
    );

    if (!credentials || !preferredEpgStreamId || (!isCardActiveForAssets && !isFocusedNow)) {
      if (isLitePerformanceMode) {
        liteEpgCoordinator.cancel(entryId);
      }
      return;
    }

    const cached = getCachedLiveEpgSnapshot(credentials, preferredEpgStreamId);
    if (cached) {
      applyCardEpgSnapshot(cached, preferredEpgStreamId);
      return;
    }

    let cancelled = false;
    const expectedStreamId = preferredEpgStreamId;
    const handleUpdate = (snap: LiveEpgSnapshot) => {
      if (cancelled) return;
      applyCardEpgSnapshot(snap, expectedStreamId);
    };

    if (isLitePerformanceMode) {
      liteEpgCoordinator.schedule(entryId, credentials, expectedStreamId, handleUpdate, {
        isFocused: isFocusedNow,
      });
      return () => {
        cancelled = true;
        liteEpgCoordinator.cancel(entryId);
      };
    }

    const unsubscribe = subscribeLiveChannelEpg({
      credentials,
      streamId: expectedStreamId,
      priority: 'normal',
      onUpdate: handleUpdate,
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [
    credentials,
    preferredEpgStreamId,
    isCardActiveForAssets,
    isLitePerformanceMode,
    liteEpgCoordinator,
    applyCardEpgSnapshot,
  ]);

  const epgTitle =
    epgSnapshot?.currentProgram?.title && epgSnapshot.currentProgram.title.trim().length > 0
      ? epgSnapshot.currentProgram.title
      : 'Programação indisponível';

  const logoSrc = group.stream_icon || primaryStream?.stream_icon;
  const logoSrcRef = useRef<unknown>(logoSrc);
  logoSrcRef.current = logoSrc;
  const enterHoldStartRef = useRef<number | null>(null);
  const longPressConsumedRef = useRef<boolean>(false);

  const isShortcutBlockedByActiveScope = useCallback((targetEl: HTMLElement | null): boolean => {
    if (typeof document === 'undefined') return false;
    if (document.querySelector('[data-focus-scope="modal"], [data-player-fullscreen="true"]')) {
      return true;
    }
    const el = targetEl ?? (document.activeElement as HTMLElement | null);
    if (!el) return false;
    const tag = el.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable) {
      return true;
    }
    return Boolean(el.closest('[data-focus-scope="modal"], [data-player-fullscreen="true"]'));
  }, []);

  const handleCardShortcutKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const key = e.key;
      if (
        key === 'f' ||
        key === 'F' ||
        key === 'ContextMenu' ||
        key === 'Menu' ||
        key === 'MediaTopMenu' ||
        key === 'ColorF0Red'
      ) {
        if (isShortcutBlockedByActiveScope(e.currentTarget)) return;
        e.preventDefault();
        e.stopPropagation();
        onToggleFavorite(group);
        return;
      }

      if (key === 'Enter') {
        if (isShortcutBlockedByActiveScope(e.currentTarget)) return;
        if (!e.repeat) {
          enterHoldStartRef.current = performance.now();
          longPressConsumedRef.current = false;
        } else if (
          enterHoldStartRef.current !== null &&
          !longPressConsumedRef.current &&
          performance.now() - enterHoldStartRef.current >= 550
        ) {
          longPressConsumedRef.current = true;
          e.preventDefault();
          e.stopPropagation();
          onToggleFavorite(group);
        }
      }
    },
    [group, isShortcutBlockedByActiveScope, onToggleFavorite]
  );

  const handleCardKeyUp = useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter') {
      enterHoldStartRef.current = null;
    }
  }, []);

  const handleCardElementFocus = useCallback(() => {
    const wrap = cardWrapRef.current;
    if (wrap && wrap.getAttribute('data-card-focused') !== 'true') {
      wrap.setAttribute('data-card-focused', 'true');
    }
    onFocusCard(group.groupId, categoryId, rowIndex, cardIndex, channelBtnRef.current);

    if (isLitePerformanceMode) {
      if (credentials && preferredEpgStreamId) {
        const expectedStreamId = preferredEpgStreamId;
        liteEpgCoordinator.notifyFocus(
          epgEntryIdRef.current,
          credentials,
          expectedStreamId,
          (snap) => applyCardEpgSnapshot(snap, expectedStreamId)
        );
      }
      if (!isCardActiveForAssetsRef.current && Boolean(logoSrcRef.current)) {
        onEnsureRowVisible();
        setFocusActivatedLogoKey((prev) => (prev === primaryStreamId ? prev : primaryStreamId));
      }
    }
  }, [
    group.groupId,
    categoryId,
    rowIndex,
    cardIndex,
    onFocusCard,
    isLitePerformanceMode,
    credentials,
    preferredEpgStreamId,
    liteEpgCoordinator,
    applyCardEpgSnapshot,
    onEnsureRowVisible,
    primaryStreamId,
  ]);

  const handleCardElementBlur = useCallback(
    (e: React.FocusEvent<HTMLButtonElement>, resetLongPress: boolean) => {
      if (resetLongPress) {
        enterHoldStartRef.current = null;
        longPressConsumedRef.current = false;
      }
      const wrap = cardWrapRef.current;
      if (!wrap) return;
      const related = e.relatedTarget;
      if (related && typeof Node !== 'undefined' && related instanceof Node && wrap.contains(related)) {
        return;
      }
      if (wrap.hasAttribute('data-card-focused')) {
        wrap.removeAttribute('data-card-focused');
      }
      if (isLitePerformanceMode) {
        liteEpgCoordinator.notifyBlur(epgEntryIdRef.current, isCardActiveForAssetsRef.current);
      }
    },
    [isLitePerformanceMode, liteEpgCoordinator]
  );

  return (
    <div
      ref={setCardWrapCallbackRef}
      data-live-channel-card="true"
      data-virtual-index={cardIndex}
      className="nc-live-horizontal-card relative w-[15.75rem] sm:w-[16.75rem] shrink-0 h-[5.15rem]"
    >
      <div
        className={`nc-card-visual-layer flex items-center bg-nc-bg-card border transition-colors ${
          isSelected
            ? 'border-white/25 bg-white/[0.09]'
            : 'border-white/10 hover:border-white/25 hover:bg-white/[0.05]'
        }`}
      >
        <button
          ref={channelBtnRef}
          type="button"
          data-nav-item="true"
          data-live-channel-btn="true"
          data-virtual-index={cardIndex}
          data-row-card-index={cardIndex}
          data-live-channel-id={primaryStreamId}
          data-live-channel-group-id={group.groupId}
          data-live-channel-category-id={categoryId}
          data-live-category-id={cardIndex === 0 ? categoryId : undefined}
          data-live-channel-selected={isSelected ? 'true' : 'false'}
          onClick={(e) => {
            if (longPressConsumedRef.current) {
              longPressConsumedRef.current = false;
              e.preventDefault();
              e.stopPropagation();
              return;
            }
            onSelectGroup(group, categoryId, rowIndex, cardIndex, channelBtnRef.current);
          }}
          onKeyDown={handleCardShortcutKeyDown}
          onKeyUp={handleCardKeyUp}
          onFocus={handleCardElementFocus}
          onBlur={(e) => handleCardElementBlur(e, true)}
          className="flex-1 min-w-0 h-full flex items-center gap-3 pl-2.5 pr-1 py-2 text-left rounded-l-xl focus:outline-none"
        >
          <div className="nc-tv-channel-logo relative w-12 h-12 shrink-0 rounded-lg bg-black/60 border border-white/10 flex items-center justify-center overflow-hidden p-1">
            <Tv className="w-5 h-5 text-white/25" aria-hidden="true" />
            {logoSrc && (
              <MediaImage
                src={logoSrc}
                serverUrl={credentials?.serverUrl}
                alt={group.displayName}
                itemId={primaryStreamId}
                itemName={group.displayName}
                active={isLogoActive}
                className="relative z-10 w-full h-full object-contain"
              />
            )}
          </div>

          <div className="nc-tv-channel-info flex-1 min-w-0 flex flex-col justify-center gap-0.5">
            <span
              data-live-channel-name="true"
              className="nc-tv-channel-name text-sm font-semibold text-white/95 leading-snug"
            >
              {group.displayName}
            </span>
            <span
              data-live-channel-epg="true"
              className="text-xs text-white/60 truncate block"
            >
              {epgTitle}
            </span>
          </div>
        </button>

        <button
          type="button"
          data-nav-item="true"
          data-live-channel-fav="true"
          data-row-fav-index={cardIndex}
          aria-label={
            isFavorite
              ? `Remover ${group.displayName} dos favoritos`
              : `Adicionar ${group.displayName} aos favoritos`
          }
          aria-pressed={isFavorite}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(group);
          }}
          onKeyDown={handleCardShortcutKeyDown}
          onFocus={handleCardElementFocus}
          onBlur={(e) => handleCardElementBlur(e, false)}
          className="nc-tv-channel-fav shrink-0 p-2 mr-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors focus:outline-none"
        >
          <Heart
            className={`w-4 h-4 ${isFavorite ? 'fill-red-500 text-red-500' : 'text-white/60'}`}
          />
        </button>
      </div>
    </div>
  );
});

// ============================================================================
// LiveCategoryRow
// Independent horizontal row per category with virtualized horizontal window.
// ============================================================================

const HORIZ_CARD_WIDTH_PX = 268;
const HORIZ_CARD_GAP_PX = 12;
const HORIZ_CARD_STRIDE_PX = HORIZ_CARD_WIDTH_PX + HORIZ_CARD_GAP_PX;

const HORIZ_VIRTUAL_THRESHOLD_FULL = 24;
const HORIZ_VIRTUAL_OVERSCAN_FULL = 4;
const HORIZ_WINDOW_MIN_ITEMS_FULL = 18;

const HORIZ_VIRTUAL_THRESHOLD_LITE = 14;
const HORIZ_VIRTUAL_OVERSCAN_LITE = 3;
const HORIZ_WINDOW_MIN_ITEMS_LITE = 10;

const LIVE_VERTICAL_WINDOW_FULL = 24;
const LIVE_VERTICAL_WINDOW_LITE = 12;

interface LiveHorizWindowConfig {
  threshold: number;
  overscan: number;
  minItems: number;
}

const LIVE_HORIZ_CONFIG_FULL: LiveHorizWindowConfig = {
  threshold: HORIZ_VIRTUAL_THRESHOLD_FULL,
  overscan: HORIZ_VIRTUAL_OVERSCAN_FULL,
  minItems: HORIZ_WINDOW_MIN_ITEMS_FULL,
};

const LIVE_HORIZ_CONFIG_LITE: LiveHorizWindowConfig = {
  threshold: HORIZ_VIRTUAL_THRESHOLD_LITE,
  overscan: HORIZ_VIRTUAL_OVERSCAN_LITE,
  minItems: HORIZ_WINDOW_MIN_ITEMS_LITE,
};

interface LiveHorizRowMetrics {
  rowWidth: number;
  cardWidth: number;
  gap: number;
  stride: number;
}

function resolveLiveHorizRowMetrics(rowEl: HTMLElement | null): LiveHorizRowMetrics {
  let remPx = 16;
  if (
    typeof document !== 'undefined' &&
    document.documentElement?.getAttribute('data-display-mode') === 'tv'
  ) {
    const inlineScale = parseFloat(
      document.documentElement.style.getPropertyValue('--nc-ui-scale') || ''
    );
    const scaleRatio =
      Number.isFinite(inlineScale) && inlineScale > 0 ? inlineScale : 0.85;
    remPx = 16 * Math.max(0.5, Math.min(1.25, scaleRatio));
  }

  const isSmUp =
    typeof window === 'undefined' ||
    typeof window.innerWidth !== 'number' ||
    window.innerWidth === 0 ||
    window.innerWidth >= 640;

  let cardWidth = Math.round((isSmUp ? 16.75 : 15.75) * remPx * 100) / 100;
  let gap = Math.round(0.75 * remPx * 100) / 100;
  let rowWidth = 640;

  if (rowEl) {
    const rowRect = rowEl.getBoundingClientRect();
    if (rowEl.clientWidth > 0) {
      rowWidth = rowEl.clientWidth;
    } else if (rowRect.width > 0) {
      rowWidth = rowRect.width;
    }

    const cards = rowEl.querySelectorAll<HTMLElement>('[data-live-channel-card="true"]');
    if (cards.length > 0) {
      const c0 = cards[0];
      const c0Rect = c0.getBoundingClientRect();
      if (c0.offsetWidth > 0) {
        cardWidth = c0.offsetWidth;
      } else if (c0Rect.width > 0) {
        cardWidth = c0Rect.width;
      }
      if (cards.length > 1) {
        const c1Rect = cards[1].getBoundingClientRect();
        const measuredStride = c1Rect.left - c0Rect.left;
        if (measuredStride > cardWidth) {
          gap = Math.max(0, Math.round((measuredStride - cardWidth) * 100) / 100);
        }
      }
    }
  }

  const safeCardWidth = Math.max(1, cardWidth);
  const safeGap = Math.max(0, gap);
  return {
    rowWidth: Math.max(1, rowWidth),
    cardWidth: safeCardWidth,
    gap: safeGap,
    stride: Math.max(1, safeCardWidth + safeGap),
  };
}

function computeHorizWindow(
  totalCount: number,
  scrollLeft: number,
  rowWidth: number,
  metrics?: Partial<LiveHorizRowMetrics>,
  pinnedRange?: { minIndex: number; maxIndex: number } | null,
  config: LiveHorizWindowConfig = LIVE_HORIZ_CONFIG_FULL
): { startIndex: number; endIndex: number; leftSpacerPx: number; rightSpacerPx: number } {
  if (totalCount <= config.threshold) {
    return {
      startIndex: 0,
      endIndex: totalCount,
      leftSpacerPx: 0,
      rightSpacerPx: 0,
    };
  }

  const cardWidth = metrics?.cardWidth || HORIZ_CARD_WIDTH_PX;
  const gap = metrics?.gap ?? HORIZ_CARD_GAP_PX;
  const stride = metrics?.stride || cardWidth + gap || HORIZ_CARD_STRIDE_PX;
  const effectiveWidth = rowWidth > 0 ? rowWidth : metrics?.rowWidth || 640;
  const visibleSlots = Math.max(4, Math.ceil(effectiveWidth / stride));
  const windowSize = Math.min(
    totalCount,
    Math.max(config.minItems, visibleSlots + config.overscan * 2)
  );
  const rawFirst = Math.floor(Math.max(0, scrollLeft) / stride);
  const maxStart = Math.max(0, totalCount - windowSize);
  let startIndex = Math.max(0, Math.min(maxStart, rawFirst - config.overscan));
  let endIndex = Math.min(totalCount, startIndex + windowSize);

  if (pinnedRange) {
    const minPin = Math.max(0, Math.min(totalCount - 1, pinnedRange.minIndex));
    const maxPin = Math.max(minPin, Math.min(totalCount - 1, pinnedRange.maxIndex));
    const pinSpan = maxPin - minPin + 1;
    if (pinSpan <= windowSize) {
      if (minPin < startIndex) {
        startIndex = minPin;
        endIndex = Math.min(totalCount, startIndex + windowSize);
      } else if (maxPin >= endIndex) {
        endIndex = Math.min(totalCount, maxPin + 1);
        startIndex = Math.max(0, endIndex - windowSize);
      }
    } else {
      startIndex = minPin;
      endIndex = Math.min(totalCount, maxPin + 1);
    }
  }

  const leftSpacerPx =
    startIndex > 0 ? Math.max(0, Math.round(startIndex * stride - gap)) : 0;
  const remainingRight = Math.max(0, totalCount - endIndex);
  const rightSpacerPx =
    remainingRight > 0 ? Math.max(0, Math.round(remainingRight * stride - gap)) : 0;

  return {
    startIndex,
    endIndex,
    leftSpacerPx,
    rightSpacerPx,
  };
}

interface LiveCategoryRowProps {
  row: LiveCategoryRowDescriptor;
  rowIndex: number;
  credentials: XtreamCredentials | null;
  leftScrollEl: HTMLElement | null;
  selectedGroupId: string | null;
  isLitePerformanceMode: boolean;
  displayScaleKey: string;
  liteEpgCoordinator: LiteEpgCoordinator;
  getOriginSnapshot: () => LiveFocusOriginSnapshot;
  isGroupFavorite: (group: LiveChannelGroup) => boolean;
  onSelectGroup: (
    group: LiveChannelGroup,
    categoryId: string,
    rowIndex: number,
    cardIndex: number,
    buttonEl?: HTMLButtonElement | null
  ) => void;
  onToggleFavorite: (group: LiveChannelGroup) => void;
  onFocusCard: (
    groupId: string,
    categoryId: string,
    rowIndex: number,
    cardIndex: number,
    buttonEl?: HTMLButtonElement | null
  ) => void;
  onRegisterOriginButton: (btn: HTMLButtonElement) => void;
  onRegisterRowEnsureCard: (
    categoryId: string,
    fn: ((targetIndex: number, preserveIndex?: number) => boolean) | null
  ) => void;
}

function areLiveCategoryRowPropsEqual(
  prev: LiveCategoryRowProps,
  next: LiveCategoryRowProps
): boolean {
  if (
    prev.row !== next.row ||
    prev.rowIndex !== next.rowIndex ||
    prev.credentials !== next.credentials ||
    prev.leftScrollEl !== next.leftScrollEl ||
    prev.isLitePerformanceMode !== next.isLitePerformanceMode ||
    prev.displayScaleKey !== next.displayScaleKey ||
    prev.liteEpgCoordinator !== next.liteEpgCoordinator ||
    prev.getOriginSnapshot !== next.getOriginSnapshot ||
    prev.isGroupFavorite !== next.isGroupFavorite ||
    prev.onSelectGroup !== next.onSelectGroup ||
    prev.onToggleFavorite !== next.onToggleFavorite ||
    prev.onFocusCard !== next.onFocusCard ||
    prev.onRegisterOriginButton !== next.onRegisterOriginButton ||
    prev.onRegisterRowEnsureCard !== next.onRegisterRowEnsureCard
  ) {
    return false;
  }

  if (prev.selectedGroupId === next.selectedGroupId) {
    return true;
  }

  const channels = next.row.channels;
  for (let i = 0; i < channels.length; i++) {
    const gId = channels[i].groupId;
    if (gId === prev.selectedGroupId || gId === next.selectedGroupId) {
      return false;
    }
  }
  return true;
}

const LiveCategoryRow = React.memo(function LiveCategoryRow({
  row,
  rowIndex,
  credentials,
  leftScrollEl,
  selectedGroupId,
  isLitePerformanceMode,
  displayScaleKey,
  liteEpgCoordinator,
  getOriginSnapshot,
  isGroupFavorite,
  onSelectGroup,
  onToggleFavorite,
  onFocusCard,
  onRegisterOriginButton,
  onRegisterRowEnsureCard,
}: LiveCategoryRowProps) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const rowElRef = useRef<HTMLDivElement | null>(null);
  const cardElementsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const isRowMountedRef = useRef<boolean>(true);
  const pendingAsyncWindowRef = useRef<{
    startIndex: number;
    endIndex: number;
    leftSpacerPx: number;
    rightSpacerPx: number;
  } | null>(null);
  const asyncWindowQueuedRef = useRef<boolean>(false);
  const metricsCacheRef = useRef<{
    scaleKey: string;
    measuredWithDom: boolean;
    metrics: LiveHorizRowMetrics;
  } | null>(null);
  const [rowElState, setRowElState] = useState<HTMLDivElement | null>(null);
  const [isRowVisible, setIsRowVisible] = useState<boolean>(() => {
    if (!isLitePerformanceMode) {
      return rowIndex < 6;
    }
    const range = computeLiteInitialVisibleRowRange(leftScrollEl, displayScaleKey);
    return rowIndex >= range.startRow && rowIndex < range.endRow;
  });
  const isRowVisibleRef = useRef<boolean>(isRowVisible);
  isRowVisibleRef.current = isRowVisible;

  const ensureRowVisible = useCallback(() => {
    if (isRowVisibleRef.current) return;
    isRowVisibleRef.current = true;
    setIsRowVisible(true);
  }, []);

  useEffect(() => {
    isRowMountedRef.current = true;
    return () => {
      isRowMountedRef.current = false;
      pendingAsyncWindowRef.current = null;
    };
  }, []);

  const horizConfig = isLitePerformanceMode ? LIVE_HORIZ_CONFIG_LITE : LIVE_HORIZ_CONFIG_FULL;
  const totalCount = row.channels.length;
  const shouldVirtualizeHoriz = totalCount > horizConfig.threshold;

  const [horizWindow, setHorizWindow] = useState(() =>
    computeHorizWindow(totalCount, 0, 640, undefined, null, horizConfig)
  );
  const horizWindowRef = useRef(horizWindow);
  horizWindowRef.current = horizWindow;

  const scheduleAsyncHorizWindow = useCallback(
    (nextWindow: {
      startIndex: number;
      endIndex: number;
      leftSpacerPx: number;
      rightSpacerPx: number;
    }) => {
      pendingAsyncWindowRef.current = nextWindow;
      if (asyncWindowQueuedRef.current) return;
      asyncWindowQueuedRef.current = true;
      queueMicrotask(() => {
        asyncWindowQueuedRef.current = false;
        if (!isRowMountedRef.current) return;
        const pending = pendingAsyncWindowRef.current;
        pendingAsyncWindowRef.current = null;
        if (!pending) return;
        const cur = horizWindowRef.current;
        if (
          pending.startIndex === cur.startIndex &&
          pending.endIndex === cur.endIndex &&
          Math.abs(pending.leftSpacerPx - cur.leftSpacerPx) <= 1 &&
          Math.abs(pending.rightSpacerPx - cur.rightSpacerPx) <= 1
        ) {
          return;
        }
        horizWindowRef.current = pending;
        setHorizWindow(pending);
      });
    },
    []
  );

  // Keep spatialNav candidate cache fresh after async horizontal window shifts commit
  useLayoutEffect(() => {
    invalidateCandidateCache();
  }, [horizWindow.startIndex, horizWindow.endIndex]);

  const formattedTitle = useMemo(
    () => formatLiveTvCategoryTitle(row.rawTitle),
    [row.rawTitle]
  );

  const setCardElementRef = useCallback((idx: number, el: HTMLDivElement | null) => {
    if (el) {
      cardElementsRef.current.set(idx, el);
    } else {
      cardElementsRef.current.delete(idx);
    }
  }, []);

  const getRowMetrics = useCallback(
    (forceMeasure = false): LiveHorizRowMetrics => {
      const el = rowElRef.current;
      const cache = metricsCacheRef.current;
      if (
        !forceMeasure &&
        cache &&
        cache.scaleKey === displayScaleKey &&
        (cache.measuredWithDom || !el)
      ) {
        return cache.metrics;
      }
      const measured = resolveLiveHorizRowMetrics(el);
      metricsCacheRef.current = {
        scaleKey: displayScaleKey,
        measuredWithDom: Boolean(el),
        metrics: measured,
      };
      return measured;
    },
    [displayScaleKey]
  );

  const getFocusedCardIndexInRow = useCallback((): number | null => {
    if (typeof document === 'undefined') return null;
    const el = rowElRef.current;
    const activeEl = document.activeElement;
    if (!el || !(activeEl instanceof HTMLElement) || !el.contains(activeEl)) {
      return null;
    }
    const cardEl = activeEl.closest<HTMLElement>('[data-live-channel-card="true"]');
    if (!cardEl) return null;
    const idx = Number(cardEl.getAttribute('data-virtual-index'));
    return Number.isFinite(idx) && idx >= 0 && idx < totalCount ? idx : null;
  }, [totalCount]);

  // Measure and synchronize horizontal window when row, channel count, TV scale, or Lite mode changes
  useLayoutEffect(() => {
    const el = rowElRef.current;
    const metrics = getRowMetrics(true);
    const scrollLeft = el?.scrollLeft || 0;
    const focusedIdx = getFocusedCardIndexInRow();
    const pinnedRange =
      focusedIdx !== null ? { minIndex: focusedIdx, maxIndex: focusedIdx } : null;
    const next = computeHorizWindow(
      totalCount,
      scrollLeft,
      metrics.rowWidth,
      metrics,
      pinnedRange,
      horizConfig
    );
    const cur = horizWindowRef.current;
    if (
      next.startIndex !== cur.startIndex ||
      next.endIndex !== cur.endIndex ||
      Math.abs(next.leftSpacerPx - cur.leftSpacerPx) > 1 ||
      Math.abs(next.rightSpacerPx - cur.rightSpacerPx) > 1
    ) {
      horizWindowRef.current = next;
      setHorizWindow(next);
    }
  }, [row.id, totalCount, rowElState, displayScaleKey, horizConfig, getRowMetrics, getFocusedCardIndexInRow]);

  // Observe row container width changes to invalidate cached geometry without per-scroll reads
  useEffect(() => {
    const el = rowElRef.current;
    if (!el) return;
    const ResizeObs =
      typeof ResizeObserver !== 'undefined'
        ? ResizeObserver
        : typeof window !== 'undefined' && typeof (window as any).ResizeObserver === 'function'
          ? (window as any).ResizeObserver
          : null;
    if (!ResizeObs) return;

    let lastWidth = el.clientWidth || 0;
    let observer: ResizeObserver | null = null;
    try {
      observer = new ResizeObs(() => {
        const nextWidth = el.clientWidth || 0;
        if (nextWidth <= 0 || Math.abs(nextWidth - lastWidth) < 1) return;
        lastWidth = nextWidth;
        const metrics = getRowMetrics(true);
        const focusedIdx = getFocusedCardIndexInRow();
        const pinnedRange =
          focusedIdx !== null ? { minIndex: focusedIdx, maxIndex: focusedIdx } : null;
        const next = computeHorizWindow(
          totalCount,
          el.scrollLeft || 0,
          metrics.rowWidth,
          metrics,
          pinnedRange,
          horizConfig
        );
        const cur = horizWindowRef.current;
        if (
          next.startIndex !== cur.startIndex ||
          next.endIndex !== cur.endIndex ||
          Math.abs(next.leftSpacerPx - cur.leftSpacerPx) > 1 ||
          Math.abs(next.rightSpacerPx - cur.rightSpacerPx) > 1
        ) {
          horizWindowRef.current = next;
          setHorizWindow(next);
        }
      });
      observer.observe(el);
    } catch {}

    return () => {
      try {
        observer?.disconnect();
      } catch {}
    };
  }, [rowElState, totalCount, horizConfig, getRowMetrics, getFocusedCardIndexInRow]);

  const verticalRootMargin = isLitePerformanceMode
    ? LITE_VERTICAL_VISIBILITY_MARGIN
    : FULL_VERTICAL_VISIBILITY_MARGIN;

  // Vertical visibility observation against left pane scroll container
  useEffect(() => {
    const target = sectionRef.current;
    if (!target || !leftScrollEl) return;
    return observeContainerVisibility({
      target,
      root: leftScrollEl,
      rootMargin: verticalRootMargin,
      axis: 'vertical',
      index: rowIndex,
      onIntersectChange: (intersecting) => {
        if (!intersecting && typeof IntersectionObserver === 'undefined') {
          const rect = target.getBoundingClientRect();
          const rootRect = leftScrollEl?.getBoundingClientRect();
          if (
            rect.width === 0 &&
            rect.height === 0 &&
            (!rootRect || (rootRect.width === 0 && rootRect.height === 0))
          ) {
            return;
          }
        }
        if (isRowVisibleRef.current === intersecting) return;
        isRowVisibleRef.current = intersecting;
        setIsRowVisible(intersecting);
      },
    });
  }, [leftScrollEl, rowIndex, verticalRootMargin]);

  const setRowCallbackRef = useCallback((node: HTMLDivElement | null) => {
    rowElRef.current = node;
    if (!node) {
      metricsCacheRef.current = null;
    }
    setRowElState((prev) => (prev !== node ? node : prev));
  }, []);

  const ensureIndexMounted = useCallback(
    (targetIndex: number, preserveIndex?: number): boolean => {
      if (totalCount <= 0) return false;
      const clamped = Math.max(0, Math.min(totalCount - 1, Math.floor(targetIndex)));
      const el = rowElRef.current;
      const metrics = getRowMetrics(false);
      const { rowWidth, cardWidth, gap, stride } = metrics;
      const totalContentWidth =
        totalCount * cardWidth + Math.max(0, totalCount - 1) * gap;
      const maxScrollLeft = Math.max(0, totalContentWidth - rowWidth);
      const padX = Math.min(8, Math.max(0, Math.floor((rowWidth - cardWidth) / 2)));

      const prevScrollLeft = el ? el.scrollLeft || 0 : 0;
      let desiredScrollLeft = prevScrollLeft;
      const cardLeft = clamped * stride;
      const cardRight = cardLeft + cardWidth;

      if (clamped === 0) {
        desiredScrollLeft = 0;
      } else if (clamped === totalCount - 1) {
        desiredScrollLeft = maxScrollLeft;
      } else if (cardLeft < desiredScrollLeft + padX) {
        desiredScrollLeft = Math.max(0, cardLeft - padX);
      } else if (cardRight > desiredScrollLeft + rowWidth - padX) {
        desiredScrollLeft = Math.min(maxScrollLeft, cardRight - rowWidth + padX);
      }

      const didScroll = Boolean(el && Math.abs(prevScrollLeft - desiredScrollLeft) > 0.5);
      if (el && didScroll) {
        const prevBehavior = el.style.scrollBehavior;
        el.style.scrollBehavior = 'auto';
        el.scrollLeft = desiredScrollLeft;
        el.style.scrollBehavior = prevBehavior;
      }

      let didSyncFlush = false;
      if (shouldVirtualizeHoriz) {
        const pinnedRange =
          typeof preserveIndex === 'number' && preserveIndex >= 0 && preserveIndex < totalCount
            ? {
                minIndex: Math.min(clamped, preserveIndex),
                maxIndex: Math.max(clamped, preserveIndex),
              }
            : {
                minIndex: clamped,
                maxIndex: clamped,
              };

        const nextWindow = computeHorizWindow(
          totalCount,
          desiredScrollLeft,
          rowWidth,
          metrics,
          pinnedRange,
          horizConfig
        );
        const cur = horizWindowRef.current;
        const windowChanged =
          nextWindow.startIndex !== cur.startIndex ||
          nextWindow.endIndex !== cur.endIndex ||
          Math.abs(nextWindow.leftSpacerPx - cur.leftSpacerPx) > 1 ||
          Math.abs(nextWindow.rightSpacerPx - cur.rightSpacerPx) > 1;

        if (windowChanged) {
          const targetCardEl = cardElementsRef.current.get(clamped);
          const targetAlreadyMounted = Boolean(
            clamped >= cur.startIndex &&
              clamped < cur.endIndex &&
              targetCardEl &&
              targetCardEl.isConnected
          );
          const preserveAlreadyMounted =
            typeof preserveIndex !== 'number' ||
            (preserveIndex >= cur.startIndex &&
              preserveIndex < cur.endIndex &&
              Boolean(cardElementsRef.current.get(preserveIndex)?.isConnected));

          if (targetAlreadyMounted && preserveAlreadyMounted) {
            // Target card is already mounted and focusable in DOM: defer window shift outside keydown critical path
            scheduleAsyncHorizWindow(nextWindow);
          } else {
            pendingAsyncWindowRef.current = null;
            horizWindowRef.current = nextWindow;
            didSyncFlush = true;
            try {
              flushSync(() => {
                setHorizWindow(nextWindow);
              });
            } catch {
              setHorizWindow(nextWindow);
            }
          }
        }
      }

      if (el && (didScroll || didSyncFlush)) {
        if (Math.abs((el.scrollLeft || 0) - desiredScrollLeft) > 0.5) {
          const prevBehavior = el.style.scrollBehavior;
          el.style.scrollBehavior = 'auto';
          el.scrollLeft = desiredScrollLeft;
          el.style.scrollBehavior = prevBehavior;
        }
        const cardEl =
          cardElementsRef.current.get(clamped) ||
          el.querySelector<HTMLElement>(
            `[data-live-channel-card="true"][data-virtual-index="${clamped}"]`
          );
        if (cardEl && cardEl.isConnected) {
          const rowRect = el.getBoundingClientRect();
          const cardRect = cardEl.getBoundingClientRect();
          if (rowRect.width > 0 && cardRect.width > 0) {
            let fineScrollLeft = el.scrollLeft || 0;
            if (cardRect.left < rowRect.left + padX) {
              fineScrollLeft = Math.max(
                0,
                fineScrollLeft + (cardRect.left - rowRect.left) - padX
              );
            } else if (cardRect.right > rowRect.right - padX) {
              fineScrollLeft = Math.min(
                maxScrollLeft,
                Math.max(0, fineScrollLeft + (cardRect.right - rowRect.right) + padX)
              );
            }
            if (Math.abs(fineScrollLeft - (el.scrollLeft || 0)) > 0.5) {
              const prevBehavior = el.style.scrollBehavior;
              el.style.scrollBehavior = 'auto';
              el.scrollLeft = fineScrollLeft;
              el.style.scrollBehavior = prevBehavior;
            }
          }
        }
      }

      return didSyncFlush;
    },
    [shouldVirtualizeHoriz, totalCount, horizConfig, getRowMetrics, scheduleAsyncHorizWindow]
  );

  // Register horizontal row with spatialNav and parent row map
  useLayoutEffect(() => {
    const el = rowElRef.current;
    if (!el) return;
    registerVirtualContainer(el, {
      totalCount,
      getColumns: () => totalCount,
      ensureIndexMounted,
    });
    onRegisterRowEnsureCard(row.categoryId, ensureIndexMounted);
    return () => {
      onRegisterRowEnsureCard(row.categoryId, null);
      unregisterVirtualContainer(el);
      invalidateCandidateCache();
    };
  }, [rowElState, row.categoryId, totalCount, ensureIndexMounted, onRegisterRowEnsureCard]);

  const computeScrollEdgeAvailability = useCallback(
    (
      el: HTMLDivElement | null,
      win: { startIndex: number; endIndex: number } = horizWindowRef.current
    ): { canPrev: boolean; canNext: boolean } => {
      if (totalCount <= 1) {
        return { canPrev: false, canNext: false };
      }
      const scrollLeft = el ? el.scrollLeft || 0 : 0;
      let maxScroll = 0;
      if (el && el.clientWidth > 0 && el.scrollWidth > 0) {
        maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
      } else {
        const m = getRowMetrics(false);
        const totalW = totalCount * m.cardWidth + Math.max(0, totalCount - 1) * m.gap;
        maxScroll = Math.max(0, totalW - m.rowWidth);
      }
      const canPrev = scrollLeft > 2 || (shouldVirtualizeHoriz && win.startIndex > 0);
      const canNext =
        scrollLeft < maxScroll - 2 || (shouldVirtualizeHoriz && win.endIndex < totalCount);
      return { canPrev, canNext };
    },
    [totalCount, shouldVirtualizeHoriz, getRowMetrics]
  );

  const [scrollEdges, setScrollEdges] = useState<{ canPrev: boolean; canNext: boolean }>(() =>
    computeScrollEdgeAvailability(null)
  );

  const syncScrollEdges = useCallback(
    (
      el: HTMLDivElement | null,
      win: { startIndex: number; endIndex: number } = horizWindowRef.current
    ) => {
      const nextEdges = computeScrollEdgeAvailability(el, win);
      setScrollEdges((prev) =>
        prev.canPrev === nextEdges.canPrev && prev.canNext === nextEdges.canNext
          ? prev
          : nextEdges
      );
    },
    [computeScrollEdgeAvailability]
  );

  useEffect(() => {
    syncScrollEdges(rowElRef.current, horizWindowRef.current);
  }, [row.id, totalCount, rowElState, syncScrollEdges]);

  const handleRowScroll = useCallback(() => {
    const el = rowElRef.current;
    if (!el) return;
    if (isLitePerformanceMode) {
      liteEpgCoordinator.notifyScrollActivity();
    }
    notifyContainerScrollForFallback(el);
    if (!shouldVirtualizeHoriz) {
      syncScrollEdges(el, horizWindowRef.current);
      return;
    }
    const metrics = getRowMetrics(false);
    const next = computeHorizWindow(
      totalCount,
      el.scrollLeft || 0,
      metrics.rowWidth,
      metrics,
      null,
      horizConfig
    );
    if (
      next.startIndex !== horizWindowRef.current.startIndex ||
      next.endIndex !== horizWindowRef.current.endIndex ||
      Math.abs(next.leftSpacerPx - horizWindowRef.current.leftSpacerPx) > 1 ||
      Math.abs(next.rightSpacerPx - horizWindowRef.current.rightSpacerPx) > 1
    ) {
      horizWindowRef.current = next;
      setHorizWindow(next);
    }
    syncScrollEdges(el, next);
  }, [
    isLitePerformanceMode,
    liteEpgCoordinator,
    shouldVirtualizeHoriz,
    totalCount,
    horizConfig,
    getRowMetrics,
    syncScrollEdges,
  ]);

  const scrollRowBy = useCallback(
    (dir: -1 | 1) => {
      const el = rowElRef.current;
      if (!el) return;
      const step = Math.max(280, Math.round((el.clientWidth || 640) * 0.75));
      const nextLeft = Math.max(0, (el.scrollLeft || 0) + dir * step);
      if (typeof el.scrollTo === 'function') {
        try {
          el.scrollTo({ left: nextLeft, behavior: 'smooth' });
          return;
        } catch {}
      }
      el.scrollLeft = nextLeft;
      handleRowScroll();
    },
    [handleRowScroll]
  );

  const visibleSlice = shouldVirtualizeHoriz
    ? row.channels.slice(horizWindow.startIndex, horizWindow.endIndex)
    : row.channels;

  return (
    <section
      ref={sectionRef}
      data-home-row-index={rowIndex}
      data-virtual-index={rowIndex}
      data-scroll-block="true"
      className="space-y-2 min-w-0"
    >
      <div className="flex items-center px-1 min-w-0">
        <h3
          data-live-category-title="true"
          className="nc-heading-section text-white/95 tracking-tight truncate"
        >
          {formattedTitle}
        </h3>
      </div>

      <div
        className="relative w-full min-w-0 group"
        onMouseEnter={() => syncScrollEdges(rowElRef.current)}
      >
        <button
          type="button"
          tabIndex={-1}
          data-row-scroll-prev="true"
          disabled={!scrollEdges.canPrev}
          aria-label={`Rolar ${formattedTitle} para esquerda`}
          onClick={() => scrollRowBy(-1)}
          className={`hidden sm:flex absolute left-0 top-1.5 bottom-1.5 w-10 md:w-12 bg-gradient-to-r from-nc-bg via-nc-bg/80 to-transparent z-30 items-center justify-start pl-1.5 md:pl-2.5 transition-opacity disabled:opacity-0 ${
            scrollEdges.canPrev
              ? 'opacity-0 group-hover:opacity-100 cursor-pointer pointer-events-none group-hover:pointer-events-auto'
              : 'opacity-0 pointer-events-none'
          }`}
        >
          <ChevronLeft className="w-6 h-6 text-white drop-shadow-md" />
        </button>

        <div
          ref={setRowCallbackRef}
          data-nav-row="true"
          data-live-category-row-scroll="true"
          data-virtual-container={shouldVirtualizeHoriz ? 'true' : undefined}
          onScroll={handleRowScroll}
          className="flex items-stretch gap-3 overflow-x-auto overflow-y-visible scrollbar-hide touch-pan-x py-1.5 px-1 min-w-0"
        >
          {shouldVirtualizeHoriz && horizWindow.leftSpacerPx > 0 && (
            <div
              data-virtual-spacer="left"
              aria-hidden="true"
              className="shrink-0"
              style={{ width: `${horizWindow.leftSpacerPx}px` }}
            />
          )}

          {visibleSlice.map((group, offsetIdx) => {
            const cardIdx = shouldVirtualizeHoriz ? horizWindow.startIndex + offsetIdx : offsetIdx;
            return (
              <LiveChannelCard
                key={group.groupId}
                group={group}
                categoryId={row.categoryId}
                rowIndex={rowIndex}
                cardIndex={cardIdx}
                credentials={credentials}
                isSelected={selectedGroupId === group.groupId}
                isLitePerformanceMode={isLitePerformanceMode}
                displayScaleKey={displayScaleKey}
                leftScrollEl={leftScrollEl}
                liteEpgCoordinator={liteEpgCoordinator}
                getOriginSnapshot={getOriginSnapshot}
                isFavorite={isGroupFavorite(group)}
                isRowVisible={isRowVisible}
                rowScrollEl={rowElState}
                onEnsureRowVisible={ensureRowVisible}
                onSelectGroup={onSelectGroup}
                onToggleFavorite={onToggleFavorite}
                onFocusCard={onFocusCard}
                onRegisterOriginButton={onRegisterOriginButton}
                onCardElementRef={setCardElementRef}
              />
            );
          })}

          {shouldVirtualizeHoriz && horizWindow.rightSpacerPx > 0 && (
            <div
              data-virtual-spacer="right"
              aria-hidden="true"
              className="shrink-0"
              style={{ width: `${horizWindow.rightSpacerPx}px` }}
            />
          )}
        </div>

        <button
          type="button"
          tabIndex={-1}
          data-row-scroll-next="true"
          disabled={!scrollEdges.canNext}
          aria-label={`Rolar ${formattedTitle} para direita`}
          onClick={() => scrollRowBy(1)}
          className={`hidden sm:flex absolute right-0 top-1.5 bottom-1.5 w-10 md:w-12 bg-gradient-to-l from-nc-bg via-nc-bg/80 to-transparent z-30 items-center justify-end pr-1.5 md:pr-2.5 transition-opacity disabled:opacity-0 ${
            scrollEdges.canNext
              ? 'opacity-0 group-hover:opacity-100 cursor-pointer pointer-events-none group-hover:pointer-events-auto'
              : 'opacity-0 pointer-events-none'
          }`}
        >
          <ChevronRight className="w-6 h-6 text-white drop-shadow-md" />
        </button>
      </div>
    </section>
  );
}, areLiveCategoryRowPropsEqual);

// ============================================================================
// LiveTvEpgSection & LiveTvRightPane
// Isolated memoized components so catalog navigation never reconciles preview/EPG.
// ============================================================================

interface LiveTvEpgSectionProps {
  rightPaneEpg: LiveEpgSnapshot | null;
  rightPaneEpgLoading: boolean;
}

const LiveTvEpgSection = React.memo(function LiveTvEpgSection({
  rightPaneEpg,
  rightPaneEpgLoading,
}: LiveTvEpgSectionProps) {
  const epgTimeline = rightPaneEpg?.timeline ?? [];

  return (
    <div
      data-live-epg-section="true"
      className="flex-1 flex flex-col min-h-0 min-w-0 md:overflow-hidden"
    >
      <div
        data-live-epg-header="true"
        className="nc-live-epg-header shrink-0 px-4 sm:px-5 py-3 border-b border-white/10 flex items-center justify-between gap-2"
      >
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-white/70" />
          <h3 className="nc-heading-section text-white">Grade de Programação</h3>
        </div>
        {epgTimeline.length > 0 && (
          <span className="nc-text-meta text-white/50">
            {epgTimeline.length} {epgTimeline.length === 1 ? 'programa' : 'programas'}
          </span>
        )}
      </div>

      <div
        data-epg-scroll="true"
        data-scroll-container="true"
        className="nc-live-epg-scroll flex-1 min-h-0 md:overflow-y-auto custom-scrollbar touch-pan-y px-4 sm:px-5 py-4"
      >
        {epgTimeline.length === 0 ? (
          (() => {
            const epgStateKind: 'loading' | 'error' | 'empty' = rightPaneEpgLoading
              ? 'loading'
              : rightPaneEpg?.status === 'error'
                ? 'error'
                : 'empty';
            return (
              <div
                key="epg-state-box"
                tabIndex={0}
                data-nav-item="true"
                data-epg-primary="true"
                data-epg-state={epgStateKind}
                className="nc-tv-epg-state rounded-xl border border-white/10 bg-white/[0.03] p-5 text-center text-white/55 nc-text-subtitle flex items-center justify-center gap-2 focus:outline-none"
              >
                {epgStateKind === 'loading' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Carregando programação...</span>
                  </>
                ) : epgStateKind === 'error' ? (
                  <span>Programação indisponível no momento.</span>
                ) : (
                  <span>Nenhuma programação disponível para este canal.</span>
                )}
              </div>
            );
          })()
        ) : (
          <div className="nc-tv-epg-timeline space-y-2.5">
            {epgTimeline.map((prog, idx) => (
              <article
                key={`${prog.id}_${prog.startMs}_${idx}`}
                role="article"
                tabIndex={0}
                data-epg-item="true"
                data-nav-item="true"
                data-epg-primary={idx === 0 ? 'true' : undefined}
                className={`nc-tv-epg-card rounded-xl border p-3.5 transition-colors ${
                  prog.isCurrent
                    ? 'border-white/35 bg-white/[0.08]'
                    : 'border-white/10 bg-white/[0.03]'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="nc-text-meta font-semibold text-white/80 tabular-nums">
                    {prog.startLabel} - {prog.endLabel}
                  </span>
                  {prog.isCurrent && (
                    <span
                      data-epg-live-badge="true"
                      className="nc-badge-info px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20"
                    >
                      AO VIVO
                    </span>
                  )}
                </div>
                <h4 className="text-sm font-semibold text-white/95 leading-snug">
                  {prog.title}
                </h4>
                {prog.description && (
                  <p className="nc-text-meta text-white/60 mt-1 line-clamp-2">
                    {prog.description}
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

interface LiveTvRightPaneProps {
  credentials: XtreamCredentials | null;
  selectedGroup: LiveChannelGroup | null;
  selectedChannel: any | null;
  selectedVariantIdOrAuto: string;
  attemptTrigger: number;
  fullscreenRequestTrigger: number;
  playbackError: string | null;
  isMobilePlayerOpen: boolean;
  rightPaneEpg: LiveEpgSnapshot | null;
  rightPaneEpgLoading: boolean;
  videoPlayerRef: React.RefObject<VideoPlayerHandle | null>;
  onMobileBackToChannels: () => void;
  onSelectVariant: (variantIdOrAuto: string) => void;
  onClosePreviewAndRestoreFocus: () => void;
  onManualRetry: () => void;
  onPlaybackSuccess: (attemptId?: number) => void;
  onPlaybackFinalError: (errMsg: string) => void;
}

const LiveTvRightPane = React.memo(function LiveTvRightPane({
  credentials,
  selectedGroup,
  selectedChannel,
  selectedVariantIdOrAuto,
  attemptTrigger,
  fullscreenRequestTrigger,
  playbackError,
  isMobilePlayerOpen,
  rightPaneEpg,
  rightPaneEpgLoading,
  videoPlayerRef,
  onMobileBackToChannels,
  onSelectVariant,
  onClosePreviewAndRestoreFocus,
  onManualRetry,
  onPlaybackSuccess,
  onPlaybackFinalError,
}: LiveTvRightPaneProps) {
  const activeStreamUrl = useMemo(() => {
    if (!credentials || !selectedChannel) return '';
    const sId = selectedChannel.stream_id ?? selectedChannel.id;
    if (!sId) return '';
    return buildDirectMediaUrl(credentials, {
      type: 'live',
      streamId: sId,
      allowedOutputFormats: credentials.allowed_output_formats,
      directSource: selectedChannel.direct_source,
    });
  }, [credentials, selectedChannel]);

  const hasActiveLivePreview = Boolean(selectedGroup && selectedChannel && activeStreamUrl);
  useEffect(() => {
    setLiveTvPreviewPlaybackActiveForImagePreload(hasActiveLivePreview);
    return () => {
      setLiveTvPreviewPlaybackActiveForImagePreload(false);
    };
  }, [hasActiveLivePreview]);

  const activeResolutionBadge = useMemo(
    () => getStreamResolutionLabel(selectedChannel, selectedGroup),
    [selectedChannel, selectedGroup]
  );

  const rightPanePrimaryLogo = selectedGroup
    ? selectedGroup.stream_icon || getGroupPrimaryStream(selectedGroup)?.stream_icon
    : null;

  const currentEpgProgram = rightPaneEpg?.currentProgram ?? null;

  return (
    <main
      data-nav-zone="content"
      className={`nc-live-right-pane w-full md:w-1/2 md:max-w-[50%] flex-1 md:flex-none flex-col min-w-0 min-h-0 bg-nc-bg overflow-y-auto md:overflow-hidden touch-pan-y ${
        isMobilePlayerOpen ? 'flex' : 'hidden md:flex'
      }`}
    >
      {!selectedGroup || !selectedChannel ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8 gap-3 text-white/60">
          <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-center">
            <Tv className="w-8 h-8 text-white/40" />
          </div>
          <h2 className="nc-heading-section text-white">Selecione um Canal</h2>
          <p className="nc-text-subtitle text-white/55 max-w-sm">
            Escolha um canal à esquerda para iniciar o preview ao vivo, alternar resoluções e consultar a programação completa.
          </p>
        </div>
      ) : (
        <div
          data-live-content-stack="true"
          className="flex-1 flex flex-col min-w-0 min-h-0 md:overflow-hidden"
        >
          {/* Mobile Back Bar (always rendered for mobile & responsive tests) */}
          <div className="md:hidden shrink-0 px-4 pt-3 pb-2 border-b border-white/10 flex items-center justify-between gap-2">
            <button
              type="button"
              data-nav-item="true"
              data-mobile-back="true"
              onClick={onMobileBackToChannels}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Voltar aos Canais</span>
            </button>
          </div>

          {/* Top Section: Channel Info + Variants + Now Playing (Left) | Video Preview (Right) */}
          <div
            data-live-top-section="true"
            className="nc-live-top-section shrink-0 p-4 sm:p-5 border-b border-white/10 flex flex-col-reverse md:flex-row gap-4 items-start min-w-0"
          >
            {/* Channel Metadata + Variant Selector + Now Playing Summary */}
            <div
              data-live-info-column="true"
              className="flex-1 min-w-0 flex flex-col gap-3 w-full"
            >
              <div className="flex items-start gap-3.5 min-w-0">
                <div className="nc-live-channel-logo relative w-14 h-14 shrink-0 rounded-xl bg-black/60 border border-white/10 flex items-center justify-center overflow-hidden p-1.5">
                  <Tv className="w-6 h-6 text-white/25" aria-hidden="true" />
                  {rightPanePrimaryLogo && (
                    <MediaImage
                      src={rightPanePrimaryLogo}
                      serverUrl={credentials?.serverUrl}
                      alt={selectedGroup.displayName}
                      itemId={getStreamIdString(selectedChannel)}
                      itemName={selectedGroup.displayName}
                      className="relative z-10 w-full h-full object-contain"
                    />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <h1 className="nc-live-channel-title nc-heading-section font-bold text-white line-clamp-2 whitespace-normal break-words w-full">
                      {selectedGroup.displayName}
                    </h1>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {activeResolutionBadge && (
                      <span className="nc-badge-info text-xs font-semibold px-2.5 py-0.5 rounded bg-white/15 text-white/90">
                        {activeResolutionBadge}
                      </span>
                    )}
                    <span
                      data-live-badge="true"
                      className="nc-badge-info text-xs font-semibold inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" aria-hidden="true" />
                      <span>AO VIVO</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Variant Selector Row (only rendered when multiple resolutions exist) */}
              {selectedGroup.isGrouped && Array.isArray(selectedGroup.variants) && selectedGroup.variants.length > 1 && (
                <div className="space-y-1.5 min-w-0">
                  <span
                    data-live-variant-label="true"
                    className="nc-live-variant-label text-sm font-medium text-white/65 block"
                  >
                    Versão do canal
                  </span>
                  <div
                    data-nav-row="true"
                    data-live-variants-row="true"
                    className="flex items-center gap-2 overflow-x-auto scrollbar-hide touch-pan-x py-1 max-w-full"
                  >
                    <button
                      type="button"
                      data-nav-item="true"
                      data-variant-active={selectedVariantIdOrAuto === 'auto' ? 'true' : 'false'}
                      onClick={() => onSelectVariant('auto')}
                      className={`shrink-0 px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                        selectedVariantIdOrAuto === 'auto'
                          ? 'bg-white text-black'
                          : 'bg-white/10 text-white/80 hover:bg-white/20 hover:text-white'
                      }`}
                    >
                      Automático
                    </button>
                    {selectedGroup.variants.map((variant) => {
                      const vIdStr = String(variant.streamId);
                      const isActive = selectedVariantIdOrAuto === vIdStr;
                      return (
                        <button
                          key={vIdStr}
                          type="button"
                          data-nav-item="true"
                          data-variant-active={isActive ? 'true' : 'false'}
                          onClick={() => onSelectVariant(vIdStr)}
                          className={`shrink-0 px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                            isActive
                              ? 'bg-white text-black'
                              : 'bg-white/10 text-white/80 hover:bg-white/20 hover:text-white'
                          }`}
                        >
                          {variant.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Now Playing Summary Card */}
              {currentEpgProgram && (
                <div className="nc-live-now-playing rounded-lg bg-white/[0.04] border border-white/10 p-3 min-w-0">
                  <div className="flex items-baseline justify-between gap-2.5 text-[0.8125rem] sm:text-sm text-white/70">
                    <span
                      data-live-now-playing-title="true"
                      className="nc-live-now-playing-title text-[0.9375rem] sm:text-base font-semibold text-white/95 truncate"
                    >
                      {currentEpgProgram.title}
                    </span>
                    {(currentEpgProgram.startLabel || currentEpgProgram.endLabel) && (
                      <span
                        data-live-now-playing-time="true"
                        className="nc-live-now-playing-time text-[0.8125rem] sm:text-sm text-white/70 shrink-0 tabular-nums"
                      >
                        {currentEpgProgram.startLabel} - {currentEpgProgram.endLabel}
                      </span>
                    )}
                  </div>
                  {currentEpgProgram.description && (
                    <p
                      data-live-now-playing-desc="true"
                      className="nc-live-now-playing-desc text-[0.8125rem] sm:text-sm text-white/65 mt-1.5 line-clamp-2 leading-relaxed"
                    >
                      {currentEpgProgram.description}
                    </p>
                  )}
                </div>
              )}

              {playbackError && (
                <p className="nc-notice-banner rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-200">
                  {playbackError}
                </p>
              )}
            </div>

            {/* Video Preview */}
            <div
              data-live-preview-column="true"
              className="nc-live-preview-box w-full md:w-[clamp(15rem,23.5vw,23.5rem)] shrink-0 aspect-video rounded-xl overflow-hidden bg-black border border-white/10 relative"
            >
              <VideoPlayer
                ref={videoPlayerRef}
                playerRef={videoPlayerRef}
                streamUrl={activeStreamUrl}
                title={selectedGroup.displayName}
                contentType="live"
                channelName={selectedGroup.displayName}
                programTitle={currentEpgProgram?.title}
                streamId={selectedChannel.stream_id ?? selectedChannel.id}
                attemptTrigger={attemptTrigger}
                fullscreenRequestTrigger={fullscreenRequestTrigger}
                embedded={true}
                disableEmbeddedControlsFocus={true}
                onBack={onClosePreviewAndRestoreFocus}
                onRetry={onManualRetry}
                onPlaybackSuccess={onPlaybackSuccess}
                onPlaybackFinalError={onPlaybackFinalError}
              />
            </div>
          </div>

          {/* Bottom Section: EPG Timeline */}
          <LiveTvEpgSection
            rightPaneEpg={rightPaneEpg}
            rightPaneEpgLoading={rightPaneEpgLoading}
          />
        </div>
      )}
    </main>
  );
});

// ============================================================================
// LiveTvView
// 50/50 balanced split: left continuous horizontal category showcase,
// right channel preview, variant selector, and EPG schedule.
// ============================================================================

export const LiveTvView = React.memo(function LiveTvView({
  onPlay: _onPlay,
  searchQuery = '',
  isTvMode: _isTvMode,
  initialChannelIntent = null,
  onConsumeChannelIntent,
}: LiveTvViewProps) {
  const { credentials } = useXtreamCredentials();
  const {
    liveCategories,
    liveStreams,
    allLiveStreams,
    loadingLive,
    loadedLiveCatalog,
    liveError,
    fetchLiveCategories,
    fetchLiveStreams,
  } = useXtreamLive();

  const { favorites, isFavorite, toggleGroupFavorites } = useFavorites(credentials);
  const historyRecords = useAccountPlaybackHistory(credentials);
  const { isLiteActive } = usePerformanceProfile();
  const { effectiveMode: displayMode, effectiveTvScale: tvScale } = useDisplayPreferences();
  const displayScaleKey = `${displayMode}:${tvScale}`;

  const effectiveLiveStreams = useMemo(
    () => (liveStreams.length > 0 ? liveStreams : allLiveStreams),
    [liveStreams, allLiveStreams]
  );

  // Trigger initial fetch only if credentials exist and live catalog is not loaded yet
  const fetchedForAccountRef = useRef<string | null>(null);
  useEffect(() => {
    if (!credentials) {
      fetchedForAccountRef.current = null;
      return;
    }
    const accountSig = `${credentials.serverUrl}|${credentials.username}`;
    if (fetchedForAccountRef.current === accountSig) return;

    if (!loadingLive && !loadedLiveCatalog && effectiveLiveStreams.length === 0) {
      fetchedForAccountRef.current = accountSig;
      if (liveCategories.length === 0) {
        fetchLiveCategories().catch(() => {});
      }
      fetchLiveStreams().catch(() => {});
    } else if (loadedLiveCatalog || effectiveLiveStreams.length > 0) {
      fetchedForAccountRef.current = accountSig;
    }
  }, [
    credentials,
    loadingLive,
    loadedLiveCatalog,
    effectiveLiveStreams.length,
    liveCategories.length,
    fetchLiveCategories,
    fetchLiveStreams,
  ]);

  const liveIndex = useMemo(
    () => getOrCreateLiveIndex(effectiveLiveStreams),
    [effectiveLiveStreams]
  );

  // Active selection & playback state
  const [selectedGroup, setSelectedGroup] = useState<LiveChannelGroup | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<any | null>(null);
  const [selectedVariantIdOrAuto, setSelectedVariantIdOrAuto] = useState<string>('auto');
  const [attemptTrigger, setAttemptTrigger] = useState<number>(0);
  const [fullscreenRequestTrigger, setFullscreenRequestTrigger] = useState<number>(0);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [isMobilePlayerOpen, setIsMobilePlayerOpen] = useState<boolean>(false);

  const videoPlayerRef = useRef<VideoPlayerHandle | null>(null);
  const selectedGroupRef = useRef<LiveChannelGroup | null>(selectedGroup);
  selectedGroupRef.current = selectedGroup;
  const selectedChannelRef = useRef<any | null>(selectedChannel);
  selectedChannelRef.current = selectedChannel;
  const isMobilePlayerOpenRef = useRef<boolean>(isMobilePlayerOpen);
  isMobilePlayerOpenRef.current = isMobilePlayerOpen;

  // EPG state for right pane
  const [rightPaneEpg, setRightPaneEpg] = useState<LiveEpgSnapshot | null>(null);
  const [rightPaneEpgLoading, setRightPaneEpgLoading] = useState<boolean>(false);

  // Localized focus origin tracking (avoids re-rendering LiveTvView and rows on every arrow key)
  const originRef = useRef<LiveFocusOriginSnapshot>({
    groupId: null,
    categoryId: null,
    rowIndex: -1,
    cardIndex: -1,
  });
  const activeOriginBtnRef = useRef<HTMLButtonElement | null>(null);

  const getOriginSnapshot = useCallback((): LiveFocusOriginSnapshot => originRef.current, []);

  // Playback fallback state & cleanup refs
  const isMountedRef = useRef<boolean>(true);
  const triedStreamIdsRef = useRef<Set<string>>(new Set());
  const fallbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeAttemptIdRef = useRef<number>(0);
  const playbackSucceededAttemptRef = useRef<number>(0);

  const clearFallbackTimer = useCallback(() => {
    if (fallbackTimeoutRef.current !== null) {
      clearTimeout(fallbackTimeoutRef.current);
      fallbackTimeoutRef.current = null;
    }
  }, []);

  const liteEpgCoordinatorRef = useRef<LiteEpgCoordinator | null>(null);
  if (!liteEpgCoordinatorRef.current) {
    liteEpgCoordinatorRef.current = new LiteEpgCoordinator();
  }
  const liteEpgCoordinator = liteEpgCoordinatorRef.current;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearFallbackTimer();
      liteEpgCoordinator.dispose();
    };
  }, [clearFallbackTimer, liteEpgCoordinator]);

  // If user toggles from Lite -> Full, flush any pending deferred secondary EPG subscriptions immediately
  useEffect(() => {
    if (!isLiteActive) {
      liteEpgCoordinator.flushAllImmediate();
    }
  }, [isLiteActive, liteEpgCoordinator]);

  const isGroupFavorite = useCallback(
    (group: LiveChannelGroup): boolean => {
      const ids = collectGroupStreamIds(group);
      return ids.some((id) => isFavorite(id, 'live'));
    },
    [isFavorite]
  );

  const handleToggleFavorite = useCallback(
    (group: LiveChannelGroup) => {
      const ids = collectGroupStreamIds(group);
      if (ids.length === 0) return;
      const alreadyFav = ids.some((id) => isFavorite(id, 'live'));
      if (alreadyFav) {
        toggleGroupFavorites(ids);
      } else {
        const primary = getGroupPrimaryStream(group);
        const primaryId = getStreamIdString(primary) || ids[0];
        toggleGroupFavorites(ids, {
          id: primaryId,
          name: group.displayName,
          cover: group.stream_icon || primary?.stream_icon || '',
          type: 'live',
          extraData: primary,
        });
      }
    },
    [isFavorite, toggleGroupFavorites]
  );

  // Helper to resolve a streamId into its LiveChannelGroup using O(1) liveIndex lookups
  const resolveGroupByStreamId = useCallback(
    (rawId: string | number | undefined | null, hintCategoryId?: string, streamSnapshot?: any): LiveChannelGroup | null => {
      if (rawId === undefined || rawId === null || rawId === '') return null;
      const targetIdStr = String(rawId);
      const indexedStream = liveIndex.getById(targetIdStr) || streamSnapshot;
      const catId = indexedStream?.category_id ?? hintCategoryId;

      if (catId !== undefined && catId !== null && String(catId) !== '') {
        const catGroups = liveIndex.getGroupsByCategory(String(catId));
        const match = catGroups.find((g) => collectGroupStreamIds(g).includes(targetIdStr));
        if (match) return match;
      }

      // Check remaining categories only if needed
      if (liveCategories.length > 0 && effectiveLiveStreams.length <= 5000) {
        const allGroups = liveIndex.getAllGroups();
        const match = allGroups.find((g) => collectGroupStreamIds(g).includes(targetIdStr));
        if (match) return match;
      }

      if (indexedStream && typeof indexedStream === 'object') {
        return buildFallbackGroupFromStream(indexedStream, hintCategoryId);
      }
      return null;
    },
    [liveIndex, liveCategories.length, effectiveLiveStreams.length]
  );

  // Build ordered category rows (virtual Favorites & Recents + provider categories)
  const normalizedSearch = searchQuery.trim().toLowerCase();

  const categoryRows = useMemo<LiveCategoryRowDescriptor[]>(() => {
    const rows: LiveCategoryRowDescriptor[] = [];

    if (!normalizedSearch) {
      // 1. Assistidos Recentemente
      const liveHistory = historyRecords.filter((r) => r.type === 'live');
      if (liveHistory.length > 0) {
        const seenGroupIds = new Set<string>();
        const recentGroups: LiveChannelGroup[] = [];
        for (const rec of liveHistory) {
          const group = resolveGroupByStreamId(rec.id);
          if (group && !seenGroupIds.has(group.groupId)) {
            seenGroupIds.add(group.groupId);
            recentGroups.push(group);
          }
          if (recentGroups.length >= 20) break;
        }
        if (recentGroups.length > 0) {
          rows.push({
            id: 'row:__recent__',
            categoryId: '__recent__',
            rawTitle: 'Assistidos Recentemente',
            channels: recentGroups,
          });
        }
      }

      // 2. Canais Favoritos
      const liveFavs = favorites.filter((f) => f && f.type === 'live');
      if (liveFavs.length > 0) {
        const seenFavGroupIds = new Set<string>();
        const favGroups: LiveChannelGroup[] = [];
        for (const fav of liveFavs) {
          const group = resolveGroupByStreamId(fav.id, undefined, fav.extraData);
          if (group && !seenFavGroupIds.has(group.groupId)) {
            seenFavGroupIds.add(group.groupId);
            favGroups.push(group);
          }
        }
        if (favGroups.length > 0) {
          rows.push({
            id: 'row:__favorites__',
            categoryId: '__favorites__',
            rawTitle: 'Canais Favoritos',
            channels: favGroups,
          });
        }
      }
    }

    // 3. Provider categories
    const knownCategoryIds = new Set<string>();
    for (const cat of liveCategories) {
      const catId = String(cat.category_id);
      knownCategoryIds.add(catId);
      const rawGroups = liveIndex.getGroupsByCategory(catId);
      const channels = normalizedSearch
        ? filterLiveChannelGroups(rawGroups, normalizedSearch)
        : rawGroups;
      if (channels.length > 0) {
        rows.push({
          id: `row:${catId}`,
          categoryId: catId,
          rawTitle: cat.category_name || 'Geral',
          channels,
        });
      }
    }

    // 4. Fallback if streams exist without matching liveCategories entries
    if (liveCategories.length === 0 && effectiveLiveStreams.length > 0) {
      const uncategorizedMap = new Map<string, LiveStream[]>();
      for (const stream of effectiveLiveStreams) {
        const catKey = String(stream?.category_id ?? 'default');
        let list = uncategorizedMap.get(catKey);
        if (!list) {
          list = [];
          uncategorizedMap.set(catKey, list);
        }
        list.push(stream);
      }
      uncategorizedMap.forEach((streamsInCat, catId) => {
        const grouped = groupLiveStreams(streamsInCat);
        const channels = normalizedSearch
          ? filterLiveChannelGroups(grouped, normalizedSearch)
          : grouped;
        if (channels.length > 0) {
          rows.push({
            id: `row:${catId}`,
            categoryId: catId,
            rawTitle: catId === 'default' ? 'Canais' : `Categoria ${catId}`,
            channels,
          });
        }
      });
    } else if (knownCategoryIds.size > 0 && rows.length === 0 && !normalizedSearch && effectiveLiveStreams.length > 0) {
      // Categories exist, none matched stream category_ids -> show Geral row
      const groupedAll = liveIndex.getAllGroups();
      if (groupedAll.length > 0) {
        rows.push({
          id: 'row:__all__',
          categoryId: '__all__',
          rawTitle: 'Canais',
          channels: groupedAll,
        });
      }
    }

    return rows;
  }, [
    normalizedSearch,
    historyRecords,
    favorites,
    liveCategories,
    effectiveLiveStreams,
    liveIndex,
    resolveGroupByStreamId,
  ]);

  const categoryRowsRef = useRef<LiveCategoryRowDescriptor[]>(categoryRows);
  categoryRowsRef.current = categoryRows;

  // Left-pane vertical virtualization + showcase row controller
  const leftScrollRef = useRef<HTMLDivElement | null>(null);
  const leftVirtualRef = useRef<HTMLDivElement | null>(null);

  const resolveEffectiveOriginRowIndex = useCallback(
    (
      snap: LiveFocusOriginSnapshot = originRef.current,
      rows: LiveCategoryRowDescriptor[] = categoryRowsRef.current
    ): number => {
      if (!snap.categoryId) return snap.rowIndex;
      const dynamicIdx = rows.findIndex((r) => r.categoryId === snap.categoryId);
      return dynamicIdx >= 0 ? dynamicIdx : snap.rowIndex;
    },
    []
  );

  const registerOriginButton = useCallback((btn: HTMLButtonElement) => {
    const prevBtn = activeOriginBtnRef.current;
    if (prevBtn && prevBtn !== btn && prevBtn.hasAttribute('data-live-channel-origin')) {
      prevBtn.removeAttribute('data-live-channel-origin');
    }
    activeOriginBtnRef.current = btn;
  }, []);

  const syncOriginDomAttributes = useCallback(
    (snap: LiveFocusOriginSnapshot = originRef.current, hintedBtn?: HTMLButtonElement | null) => {
      const containerEl = leftScrollRef.current;
      if (!containerEl) return;

      const effectiveRowIdx = resolveEffectiveOriginRowIndex(snap);
      if (effectiveRowIdx >= 0) {
        const nextRowStr = String(effectiveRowIdx);
        if (containerEl.getAttribute('data-live-origin-row-index') !== nextRowStr) {
          containerEl.setAttribute('data-live-origin-row-index', nextRowStr);
        }
      } else if (containerEl.hasAttribute('data-live-origin-row-index')) {
        containerEl.removeAttribute('data-live-origin-row-index');
      }

      if (snap.cardIndex >= 0) {
        const nextCardStr = String(snap.cardIndex);
        if (containerEl.getAttribute('data-live-origin-card-index') !== nextCardStr) {
          containerEl.setAttribute('data-live-origin-card-index', nextCardStr);
        }
      } else if (containerEl.hasAttribute('data-live-origin-card-index')) {
        containerEl.removeAttribute('data-live-origin-card-index');
      }

      const prevBtn = activeOriginBtnRef.current;
      const matchesSnap = (btn: HTMLButtonElement | null | undefined): btn is HTMLButtonElement =>
        Boolean(
          btn &&
            btn.isConnected &&
            snap.groupId !== null &&
            snap.categoryId !== null &&
            btn.getAttribute('data-live-channel-group-id') === snap.groupId &&
            btn.getAttribute('data-live-channel-category-id') === snap.categoryId
        );

      let targetBtn: HTMLButtonElement | null = null;
      if (matchesSnap(hintedBtn)) {
        targetBtn = hintedBtn;
      } else if (matchesSnap(prevBtn)) {
        targetBtn = prevBtn;
      }

      if (prevBtn && prevBtn !== targetBtn) {
        if (prevBtn.hasAttribute('data-live-channel-origin')) {
          prevBtn.removeAttribute('data-live-channel-origin');
        }
        activeOriginBtnRef.current = null;
      }

      if (snap.groupId !== null && snap.categoryId !== null) {
        // Fallback DOM lookup ONLY when hinted/cached button is unavailable (e.g. after remount or row shift)
        if (!targetBtn) {
          if (effectiveRowIdx >= 0 && snap.cardIndex >= 0) {
            const candidate = containerEl.querySelector<HTMLButtonElement>(
              `[data-home-row-index="${effectiveRowIdx}"] button[data-live-channel-btn="true"][data-row-card-index="${snap.cardIndex}"]`
            );
            if (matchesSnap(candidate)) {
              targetBtn = candidate;
            }
          }

          if (!targetBtn) {
            const allBtns = containerEl.querySelectorAll<HTMLButtonElement>(
              'button[data-live-channel-btn="true"]'
            );
            for (let i = 0; i < allBtns.length; i++) {
              const btn = allBtns[i];
              if (matchesSnap(btn)) {
                targetBtn = btn;
                break;
              }
            }
          }
        }

        if (targetBtn) {
          if (targetBtn.getAttribute('data-live-channel-origin') !== 'true') {
            targetBtn.setAttribute('data-live-channel-origin', 'true');
          }
          activeOriginBtnRef.current = targetBtn;
        }
      }
    },
    [resolveEffectiveOriginRowIndex]
  );

  const updateOriginSnapshot = useCallback(
    (
      groupId: string,
      categoryId: string,
      rowIndex: number,
      cardIndex: number,
      buttonEl?: HTMLButtonElement | null
    ) => {
      const nextSnap: LiveFocusOriginSnapshot = {
        groupId,
        categoryId,
        rowIndex,
        cardIndex,
      };
      originRef.current = nextSnap;
      syncOriginDomAttributes(nextSnap, buttonEl);
    },
    [syncOriginDomAttributes]
  );

  // Schedule 28s fallback timer if a playback attempt stalls before reporting success
  const startPlaybackAttempt = useCallback(
    (group: LiveChannelGroup, variant: ChannelVariant, variantSelection: string) => {
      clearFallbackTimer();
      const attemptId = ++activeAttemptIdRef.current;
      selectedChannelRef.current = variant.stream;
      setSelectedChannel(variant.stream);
      setPlaybackError(null);
      setAttemptTrigger((n) => n + 1);

      fallbackTimeoutRef.current = setTimeout(() => {
        fallbackTimeoutRef.current = null;
        if (!isMountedRef.current || activeAttemptIdRef.current !== attemptId) {
          return;
        }
        if (playbackSucceededAttemptRef.current === attemptId) {
          return;
        }

        const failedId = String(variant.streamId ?? getStreamIdString(variant.stream));
        if (failedId) {
          triedStreamIdsRef.current.add(failedId);
        }
        const nextVariant = selectChannelVariantForAttempt(
          group,
          variantSelection,
          triedStreamIdsRef.current
        );
        if (nextVariant) {
          startPlaybackAttempt(group, nextVariant, variantSelection);
        } else {
          setPlaybackError('Não foi possível reproduzir este canal no momento.');
        }
      }, liveFallbackTimeoutMs);
    },
    [clearFallbackTimer]
  );

  // Select a channel group from left pane (or enter fullscreen immediately on 2nd OK)
  const handleSelectGroup = useCallback(
    (
      group: LiveChannelGroup,
      categoryId?: string,
      rowIndex?: number,
      cardIndex?: number,
      buttonEl?: HTMLButtonElement | null
    ) => {
      if (typeof categoryId === 'string' && typeof rowIndex === 'number' && typeof cardIndex === 'number') {
        updateOriginSnapshot(group.groupId, categoryId, rowIndex, cardIndex, buttonEl);
      }

      const currentSelectedGroup = selectedGroupRef.current;
      const currentSelectedChannel = selectedChannelRef.current;
      const isAlreadySelected =
        currentSelectedGroup?.groupId === group.groupId && currentSelectedChannel !== null;
      const isNarrowViewport =
        typeof window !== 'undefined' && window.innerWidth > 0 && window.innerWidth < 768;

      if (isAlreadySelected) {
        if (isNarrowViewport && !isMobilePlayerOpenRef.current) {
          isMobilePlayerOpenRef.current = true;
          setIsMobilePlayerOpen(true);
        } else if (videoPlayerRef.current) {
          void videoPlayerRef.current.requestFullscreenImmediate();
        } else {
          setFullscreenRequestTrigger((n) => n + 1);
        }
        return;
      }

      triedStreamIdsRef.current = new Set();
      selectedGroupRef.current = group;
      setSelectedGroup(group);
      setSelectedVariantIdOrAuto('auto');

      if (isNarrowViewport) {
        isMobilePlayerOpenRef.current = true;
        setIsMobilePlayerOpen(true);
      }

      const initialVariant = selectChannelVariantForAttempt(
        group,
        'auto',
        triedStreamIdsRef.current
      );

      if (initialVariant) {
        startPlaybackAttempt(group, initialVariant, 'auto');
      } else {
        const fallbackStream = getGroupPrimaryStream(group);
        clearFallbackTimer();
        selectedChannelRef.current = fallbackStream;
        setSelectedChannel(fallbackStream);
        setPlaybackError(fallbackStream ? null : 'Canal indisponível.');
      }
    },
    [updateOriginSnapshot, startPlaybackAttempt, clearFallbackTimer]
  );

  // Handle direct channel launch intent from Home
  const consumedIntentIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!initialChannelIntent) return;
    if (consumedIntentIdRef.current === initialChannelIntent.requestId) return;

    const matchedGroup = resolveGroupByStreamId(
      initialChannelIntent.streamId,
      initialChannelIntent.categoryId,
      initialChannelIntent.streamSnapshot
    );

    if (!matchedGroup) {
      if (effectiveLiveStreams.length > 0 || loadedLiveCatalog) {
        consumedIntentIdRef.current = initialChannelIntent.requestId;
        onConsumeChannelIntent?.(initialChannelIntent.requestId);
      }
      return;
    }

    consumedIntentIdRef.current = initialChannelIntent.requestId;
    triedStreamIdsRef.current = new Set();
    selectedGroupRef.current = matchedGroup;
    setSelectedGroup(matchedGroup);
    setSelectedVariantIdOrAuto('auto');

    if (typeof window !== 'undefined' && window.innerWidth > 0 && window.innerWidth < 768) {
      isMobilePlayerOpenRef.current = true;
      setIsMobilePlayerOpen(true);
    }

    const initialVariant = selectChannelVariantForAttempt(
      matchedGroup,
      'auto',
      triedStreamIdsRef.current
    );
    if (initialVariant) {
      startPlaybackAttempt(matchedGroup, initialVariant, 'auto');
    } else {
      const primary = getGroupPrimaryStream(matchedGroup);
      selectedChannelRef.current = primary;
      setSelectedChannel(primary);
    }

    onConsumeChannelIntent?.(initialChannelIntent.requestId);
  }, [
    initialChannelIntent,
    effectiveLiveStreams.length,
    loadedLiveCatalog,
    resolveGroupByStreamId,
    startPlaybackAttempt,
    onConsumeChannelIntent,
  ]);

  // Select manual variant or Automático in right pane
  const handleSelectVariant = useCallback(
    (variantIdOrAuto: string) => {
      const group = selectedGroupRef.current;
      if (!group) return;
      setSelectedVariantIdOrAuto(variantIdOrAuto);
      triedStreamIdsRef.current = new Set();
      const targetVariant = selectChannelVariantForAttempt(
        group,
        variantIdOrAuto,
        triedStreamIdsRef.current
      );
      if (targetVariant) {
        startPlaybackAttempt(group, targetVariant, variantIdOrAuto);
      }
    },
    [startPlaybackAttempt]
  );

  const selectedVariantRef = useRef<string>(selectedVariantIdOrAuto);
  selectedVariantRef.current = selectedVariantIdOrAuto;

  // Manual retry button on playback error
  const handleManualRetry = useCallback(() => {
    const group = selectedGroupRef.current;
    if (!group) return;
    const variantSel = selectedVariantRef.current;
    triedStreamIdsRef.current = new Set();
    const targetVariant = selectChannelVariantForAttempt(
      group,
      variantSel,
      triedStreamIdsRef.current
    );
    if (targetVariant) {
      startPlaybackAttempt(group, targetVariant, variantSel);
    }
  }, [startPlaybackAttempt]);

  // VideoPlayer callbacks
  const handlePlaybackSuccess = useCallback(
    (attemptId?: number) => {
      clearFallbackTimer();
      playbackSucceededAttemptRef.current = attemptId ?? activeAttemptIdRef.current;
      setPlaybackError(null);
      const currentChannel = selectedChannelRef.current;
      if (credentials && currentChannel) {
        const sId = getStreamIdString(currentChannel);
        if (sId) {
          recordPlaybackPosition(credentials, {
            id: sId,
            type: 'live',
            positionSec: 0,
          });
        }
      }
    },
    [clearFallbackTimer, credentials]
  );

  const handlePlaybackFinalError = useCallback(
    (errMsg: string) => {
      clearFallbackTimer();
      const group = selectedGroupRef.current;
      const currentChannel = selectedChannelRef.current;
      const variantSel = selectedVariantRef.current;
      if (!group || !currentChannel) {
        setPlaybackError(errMsg || 'Erro ao reproduzir canal.');
        return;
      }

      const failedId = getStreamIdString(currentChannel);
      if (failedId) {
        triedStreamIdsRef.current.add(failedId);
      }

      const nextVariant = selectChannelVariantForAttempt(
        group,
        variantSel,
        triedStreamIdsRef.current
      );

      if (nextVariant) {
        startPlaybackAttempt(group, nextVariant, variantSel);
      } else {
        setPlaybackError(errMsg || 'Não foi possível reproduzir este canal.');
      }
    },
    [clearFallbackTimer, startPlaybackAttempt]
  );

  // Right-pane EPG subscription keyed on canonical group stream ID (SD -> HD -> FHD -> 4K)
  const rightPaneEpgStreamId = useMemo(() => {
    if (!selectedGroup) return 0;
    return (
      getPreferredEpgStreamIdForGroup(selectedGroup) ||
      Number(selectedChannel?.stream_id ?? selectedChannel?.id ?? 0)
    );
  }, [selectedGroup, selectedChannel]);

  useEffect(() => {
    if (!credentials || !rightPaneEpgStreamId) {
      setRightPaneEpg((prev) => (prev === null ? prev : null));
      setRightPaneEpgLoading((prev) => (prev ? false : prev));
      return;
    }

    const expectedStreamId = rightPaneEpgStreamId;
    const cached = getCachedLiveEpgSnapshot(credentials, expectedStreamId);
    if (cached) {
      setRightPaneEpg((prev) => (areRightPaneEpgSnapshotsEquivalent(prev, cached) ? prev : cached));
      setRightPaneEpgLoading((prev) => (prev ? false : prev));
      return;
    }

    setRightPaneEpg((prev) => (prev === null ? prev : null));
    setRightPaneEpgLoading((prev) => (prev ? prev : true));

    let cancelled = false;
    const unsubscribe = subscribeLiveChannelEpg({
      credentials,
      streamId: expectedStreamId,
      priority: 'high',
      onUpdate: (snap) => {
        if (cancelled) return;
        if (snap && snap.streamId && snap.streamId !== expectedStreamId) return;
        setRightPaneEpg((prev) => (areRightPaneEpgSnapshotsEquivalent(prev, snap) ? prev : snap));
        setRightPaneEpgLoading((prev) => (prev ? false : prev));
      },
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [credentials, rightPaneEpgStreamId]);

  const rowEnsureCardMapRef = useRef<
    Map<string, (targetIndex: number, preserveIndex?: number) => boolean>
  >(new Map());

  const registerRowEnsureCard = useCallback(
    (
      categoryId: string,
      fn: ((targetIndex: number, preserveIndex?: number) => boolean) | null
    ) => {
      if (fn) {
        rowEnsureCardMapRef.current.set(categoryId, fn);
      } else {
        rowEnsureCardMapRef.current.delete(categoryId);
      }
    },
    []
  );

  const prevLiteActiveRef = useRef<boolean>(isLiteActive);
  const pendingLiteFocusRestoreRef = useRef<{
    rowIndex: number;
    cardIndex: number;
    categoryId: string | null;
    groupId: string | null;
    isFav: boolean;
  } | null>(null);

  if (prevLiteActiveRef.current !== isLiteActive) {
    prevLiteActiveRef.current = isLiteActive;
    if (
      typeof document !== 'undefined' &&
      document.activeElement instanceof HTMLElement &&
      leftScrollRef.current?.contains(document.activeElement)
    ) {
      const activeEl = document.activeElement;
      const isFav = activeEl.getAttribute('data-live-channel-fav') === 'true';
      const cardEl = activeEl.closest<HTMLElement>('[data-live-channel-card="true"]');
      const channelBtn = cardEl?.querySelector<HTMLButtonElement>(
        'button[data-live-channel-btn="true"]'
      );
      const sectionEl = activeEl.closest<HTMLElement>('[data-home-row-index]');
      const rowIdx = Number(sectionEl?.getAttribute('data-home-row-index'));
      const cardIdx = Number(cardEl?.getAttribute('data-virtual-index'));
      if (Number.isFinite(rowIdx) && rowIdx >= 0 && Number.isFinite(cardIdx) && cardIdx >= 0) {
        pendingLiteFocusRestoreRef.current = {
          rowIndex: rowIdx,
          cardIndex: cardIdx,
          categoryId: channelBtn?.getAttribute('data-live-channel-category-id') ?? originRef.current.categoryId,
          groupId: channelBtn?.getAttribute('data-live-channel-group-id') ?? originRef.current.groupId,
          isFav,
        };
      }
    }
  }

  const verticalMaxWindowItems = isLiteActive
    ? LIVE_VERTICAL_WINDOW_LITE
    : LIVE_VERTICAL_WINDOW_FULL;

  const {
    startIndex: rowStartIndex,
    endIndex: rowEndIndex,
    topSpacerPx: rowsTopSpacerPx,
    bottomSpacerPx: rowsBottomSpacerPx,
    ensureIndexMounted: ensureRowMounted,
    scrollContainerCallbackRef,
    virtualContainerCallbackRef,
  } = useVirtualWindow({
    totalCount: categoryRows.length,
    mode: 'list',
    scrollContainerRef: leftScrollRef,
    virtualContainerRef: leftVirtualRef,
    maxWindowItems: verticalMaxWindowItems,
    fallbackOffsetTopPx: 16,
    fallbackItemHeightPx: 148,
    resetKey: `live_rows_${normalizedSearch}`,
  });

  // Preserve active focus when toggling Lite <-> Full changes the vertical or horizontal window size
  useLayoutEffect(() => {
    const pending = pendingLiteFocusRestoreRef.current;
    if (!pending) return;
    pendingLiteFocusRestoreRef.current = null;
    if (typeof document === 'undefined') return;
    const containerEl = leftScrollRef.current;
    if (!containerEl) return;

    const activeEl = document.activeElement;
    if (activeEl instanceof HTMLElement && containerEl.contains(activeEl)) {
      const wrap = activeEl.closest<HTMLElement>('[data-live-channel-card="true"]');
      if (wrap && wrap.getAttribute('data-card-focused') !== 'true') {
        wrap.setAttribute('data-card-focused', 'true');
      }
      return;
    }

    // Run outside React's commit lifecycle so ensureRowMounted / ensureCardMounted can safely flushSync
    queueMicrotask(() => {
      if (!isMountedRef.current) return;
      const liveContainer = leftScrollRef.current;
      if (!liveContainer) return;

      ensureRowMounted(pending.rowIndex);
      if (pending.categoryId) {
        rowEnsureCardMapRef.current.get(pending.categoryId)?.(pending.cardIndex);
      }

      const selector = pending.isFav
        ? `[data-home-row-index="${pending.rowIndex}"] button[data-live-channel-fav="true"][data-row-fav-index="${pending.cardIndex}"]`
        : `[data-home-row-index="${pending.rowIndex}"] button[data-live-channel-btn="true"][data-row-card-index="${pending.cardIndex}"]`;
      const target = liveContainer.querySelector<HTMLElement>(selector);
      if (target && target.isConnected) {
        focusElementSafely(target);
        const wrap = target.closest<HTMLElement>('[data-live-channel-card="true"]');
        if (wrap && wrap.getAttribute('data-card-focused') !== 'true') {
          wrap.setAttribute('data-card-focused', 'true');
        }
      }
    });
  }, [isLiteActive, ensureRowMounted]);

  // Close preview and restore focus to the previously selected channel button in left pane
  const closePreviewAndRestoreFocus = useCallback(() => {
    const currentChannel = selectedChannelRef.current;
    const currentGroup = selectedGroupRef.current;
    const prevPrimaryId =
      getStreamIdString(currentChannel) || getStreamIdString(getGroupPrimaryStream(currentGroup));
    const prevGroupId = currentGroup?.groupId ?? originRef.current.groupId;
    const originCategoryId = originRef.current.categoryId;
    const originCardIndex = originRef.current.cardIndex;

    clearFallbackTimer();
    activeAttemptIdRef.current += 1;
    selectedGroupRef.current = null;
    selectedChannelRef.current = null;
    isMobilePlayerOpenRef.current = false;
    setSelectedGroup(null);
    setSelectedChannel(null);
    setPlaybackError(null);
    setIsMobilePlayerOpen(false);

    if (getNavMode() === 'remote' && typeof document !== 'undefined') {
      const effectiveRowIdx = resolveEffectiveOriginRowIndex(originRef.current);
      if (effectiveRowIdx >= 0) {
        ensureRowMounted(effectiveRowIdx);
      }
      if (originCategoryId && originCardIndex >= 0) {
        rowEnsureCardMapRef.current.get(originCategoryId)?.(originCardIndex);
      }

      const cachedOrigin = activeOriginBtnRef.current;
      let targetBtn: HTMLButtonElement | null =
        cachedOrigin &&
        cachedOrigin.isConnected &&
        cachedOrigin.getAttribute('data-live-channel-origin') === 'true'
          ? cachedOrigin
          : document.querySelector<HTMLButtonElement>('button[data-live-channel-origin="true"]');

      if (!targetBtn) {
        const allChannelBtns = Array.from(
          document.querySelectorAll<HTMLButtonElement>('button[data-live-channel-btn="true"]')
        );
        targetBtn =
          (prevGroupId && originCategoryId
            ? allChannelBtns.find(
                (btn) =>
                  btn.getAttribute('data-live-channel-group-id') === prevGroupId &&
                  btn.getAttribute('data-live-channel-category-id') === originCategoryId
              ) || null
            : null) ||
          (prevGroupId
            ? allChannelBtns.find(
                (btn) => btn.getAttribute('data-live-channel-group-id') === prevGroupId
              ) || null
            : null) ||
          (prevPrimaryId
            ? allChannelBtns.find(
                (btn) => btn.getAttribute('data-live-channel-id') === prevPrimaryId
              ) || null
            : null) ||
          document.querySelector<HTMLButtonElement>('button[data-live-channel-selected="true"]');
      }

      if (targetBtn && targetBtn.isConnected) {
        focusElementSafely(targetBtn);
      }
    }
  }, [clearFallbackTimer, resolveEffectiveOriginRowIndex, ensureRowMounted]);

  const handleMobileBackToChannels = useCallback(() => {
    if (isMobilePlayerOpenRef.current) {
      isMobilePlayerOpenRef.current = false;
      setIsMobilePlayerOpen(false);
      return;
    }
    closePreviewAndRestoreFocus();
  }, [closePreviewAndRestoreFocus]);

  // Register Back handler for closing mobile player or active preview
  useBackHandler(
    'live-tv-view',
    BACK_PRIORITY.VIEW_INTERNAL,
    () => {
      if (isMobilePlayerOpenRef.current) {
        isMobilePlayerOpenRef.current = false;
        setIsMobilePlayerOpen(false);
        return true;
      }
      if (selectedGroupRef.current) {
        closePreviewAndRestoreFocus();
        return true;
      }
      return false;
    },
    Boolean(isMobilePlayerOpen || selectedGroup)
  );

  const [leftScrollNode, setLeftScrollNode] = useState<HTMLDivElement | null>(null);
  const setLeftScrollRef = useCallback(
    (node: HTMLDivElement | null) => {
      leftScrollRef.current = node;
      scrollContainerCallbackRef(node);
      setLeftScrollNode((prev) => (prev !== node ? node : prev));
    },
    [scrollContainerCallbackRef]
  );

  const setLeftVirtualRef = useCallback(
    (node: HTMLDivElement | null) => {
      leftVirtualRef.current = node;
      virtualContainerCallbackRef(node);
    },
    [virtualContainerCallbackRef]
  );

  useLayoutEffect(() => {
    const el = leftScrollRef.current;
    if (!el) return;
    registerShowcaseRowController(el, {
      totalRows: categoryRows.length,
      ensureRowMounted,
    });
    return () => {
      unregisterShowcaseRowController(el);
    };
  }, [leftScrollNode, categoryRows.length, ensureRowMounted]);

  // Keep origin DOM attributes synchronized when category rows or vertical virtualization window changes
  useLayoutEffect(() => {
    const currentSnap = originRef.current;
    if (currentSnap.categoryId) {
      const effectiveRowIdx = resolveEffectiveOriginRowIndex(currentSnap, categoryRows);
      if (effectiveRowIdx >= 0 && effectiveRowIdx !== currentSnap.rowIndex) {
        originRef.current = {
          ...currentSnap,
          rowIndex: effectiveRowIdx,
        };
      }
    }
    syncOriginDomAttributes(originRef.current);
  }, [categoryRows, rowStartIndex, rowEndIndex, resolveEffectiveOriginRowIndex, syncOriginDomAttributes]);

  const handleFocusCard = useCallback(
    (
      groupId: string,
      categoryId: string,
      rowIndex: number,
      cardIndex: number,
      buttonEl?: HTMLButtonElement | null
    ) => {
      updateOriginSnapshot(groupId, categoryId, rowIndex, cardIndex, buttonEl);
    },
    [updateOriginSnapshot]
  );

  const effectiveOriginRowIndex = resolveEffectiveOriginRowIndex(originRef.current, categoryRows);
  const visibleCategoryRows = categoryRows.slice(rowStartIndex, rowEndIndex);

  return (
    <div className="flex-1 w-full h-full flex flex-col md:flex-row bg-nc-bg overflow-hidden min-h-0 min-w-0">
      {/* ===================================================================
          LEFT PANE (~50%): "Categorias De TV" + Vertical stack of horizontal rows
         =================================================================== */}
      <aside
        data-nav-zone="categories"
        className={`nc-live-left-pane nc-tv-category-pane w-full md:w-1/2 md:max-w-[50%] flex-1 md:flex-none flex-col min-w-0 min-h-0 border-b md:border-b-0 md:border-r border-white/10 bg-nc-bg ${
          isMobilePlayerOpen ? 'hidden md:flex' : 'flex'
        }`}
      >
        <div className="shrink-0 px-4 sm:px-6 pt-4 pb-3 border-b border-white/10 flex items-center justify-between gap-3">
          <h2 className="nc-heading-view text-white tracking-tight">
            Categorias De TV
          </h2>
          {categoryRows.length > 0 && (
            <span className="nc-text-meta text-white/50 shrink-0">
              {categoryRows.length} {categoryRows.length === 1 ? 'categoria' : 'categorias'}
            </span>
          )}
        </div>

        <div
          ref={setLeftScrollRef}
          data-scroll-container="true"
          data-showcase-rows-container="true"
          data-showcase-virtualized="true"
          data-showcase-total-rows={categoryRows.length}
          data-live-origin-row-index={effectiveOriginRowIndex >= 0 ? effectiveOriginRowIndex : undefined}
          data-live-origin-card-index={originRef.current.cardIndex >= 0 ? originRef.current.cardIndex : undefined}
          onScroll={() => {
            if (isLiteActive) {
              liteEpgCoordinator.notifyScrollActivity();
            }
            notifyContainerScrollForFallback(leftScrollRef.current);
          }}
          style={{ overflowAnchor: 'none' }}
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar touch-pan-y px-4 sm:px-6 py-4"
        >
          {loadingLive && categoryRows.length === 0 ? (
            <div className="h-full min-h-[14rem] flex flex-col items-center justify-center gap-3 text-white/60">
              <Loader2 className="w-7 h-7 animate-spin text-white/70" />
              <span className="nc-text-subtitle">Carregando canais ao vivo...</span>
            </div>
          ) : liveError && categoryRows.length === 0 ? (
            <div className="h-full min-h-[14rem] flex flex-col items-center justify-center gap-3 text-center px-4">
              <AlertCircle className="w-7 h-7 text-red-400" />
              <p className="nc-text-subtitle text-white/80">{liveError}</p>
              <button
                type="button"
                data-nav-item="true"
                onClick={() => fetchLiveStreams().catch(() => {})}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-black text-sm font-semibold hover:bg-white/90 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Tentar novamente</span>
              </button>
            </div>
          ) : categoryRows.length === 0 ? (
            <div className="h-full min-h-[14rem] flex flex-col items-center justify-center gap-2 text-center px-4 text-white/50">
              <Radio className="w-8 h-8 text-white/30" />
              <p className="nc-text-subtitle">
                {normalizedSearch
                  ? 'Nenhum canal encontrado para esta busca.'
                  : 'Nenhum canal disponível no momento.'}
              </p>
            </div>
          ) : (
            <>
              {rowsTopSpacerPx > 0 && (
                <div
                  data-virtual-spacer="top"
                  aria-hidden="true"
                  style={{ height: `${rowsTopSpacerPx}px` }}
                />
              )}

              <div ref={setLeftVirtualRef} className="space-y-5">
                {visibleCategoryRows.map((row, offsetIdx) => {
                  const rowIndex = rowStartIndex + offsetIdx;
                  return (
                    <LiveCategoryRow
                      key={row.id}
                      row={row}
                      rowIndex={rowIndex}
                      credentials={credentials}
                      leftScrollEl={leftScrollNode}
                      selectedGroupId={selectedGroup?.groupId ?? null}
                      isLitePerformanceMode={isLiteActive}
                      displayScaleKey={displayScaleKey}
                      liteEpgCoordinator={liteEpgCoordinator}
                      getOriginSnapshot={getOriginSnapshot}
                      isGroupFavorite={isGroupFavorite}
                      onSelectGroup={handleSelectGroup}
                      onToggleFavorite={handleToggleFavorite}
                      onFocusCard={handleFocusCard}
                      onRegisterOriginButton={registerOriginButton}
                      onRegisterRowEnsureCard={registerRowEnsureCard}
                    />
                  );
                })}
              </div>

              {rowsBottomSpacerPx > 0 && (
                <div
                  data-virtual-spacer="bottom"
                  aria-hidden="true"
                  style={{ height: `${rowsBottomSpacerPx}px` }}
                />
              )}
            </>
          )}
        </div>
      </aside>

      {/* ===================================================================
          RIGHT PANE (~50%): Channel preview, variants, details, and EPG schedule
         =================================================================== */}
      <LiveTvRightPane
        credentials={credentials}
        selectedGroup={selectedGroup}
        selectedChannel={selectedChannel}
        selectedVariantIdOrAuto={selectedVariantIdOrAuto}
        attemptTrigger={attemptTrigger}
        fullscreenRequestTrigger={fullscreenRequestTrigger}
        playbackError={playbackError}
        isMobilePlayerOpen={isMobilePlayerOpen}
        rightPaneEpg={rightPaneEpg}
        rightPaneEpgLoading={rightPaneEpgLoading}
        videoPlayerRef={videoPlayerRef}
        onMobileBackToChannels={handleMobileBackToChannels}
        onSelectVariant={handleSelectVariant}
        onClosePreviewAndRestoreFocus={closePreviewAndRestoreFocus}
        onManualRetry={handleManualRetry}
        onPlaybackSuccess={handlePlaybackSuccess}
        onPlaybackFinalError={handlePlaybackFinalError}
      />
    </div>
  );
});
