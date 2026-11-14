import { XtreamCredentials } from '../types';
import { XtreamService } from '../services/xtreamService';
import { LiveChannelGroup, ResolutionQuality } from './liveChannelGroups';

export interface ResolvedEpgProgram {
  id: string;
  title: string;
  description: string;
  startMs: number;
  endMs: number;
  startLabel: string;
  endLabel: string;
  isCurrent: boolean;
  raw: any;
}

export type LiveEpgStatus = 'idle' | 'loading' | 'ok' | 'empty' | 'error';

export interface LiveEpgSnapshot {
  cacheKey: string;
  streamId: number;
  status: LiveEpgStatus;
  currentProgram: ResolvedEpgProgram | null;
  timeline: ResolvedEpgProgram[];
  rawListings: any[];
  fetchedAtMs: number;
  expiresAtMs: number;
}

export interface LiveEpgStats {
  totalNetworkRequests: number;
  deduplicatedHits: number;
  cacheHits: number;
  cancelledQueuedRequests: number;
  staleIgnoredCount: number;
  activeInFlightCount: number;
  queuedCount: number;
  maxObservedConcurrent: number;
  requestsByStreamId: Record<number, number>;
}

const DEFAULT_OK_TTL_MS = 5 * 60 * 1000;
const DEFAULT_EMPTY_TTL_MS = 2 * 60 * 1000;
const DEFAULT_ERROR_TTL_MS = 15 * 1000;

let customClockFn: (() => number) | null = null;
let maxConcurrentEpgRequests = 3;

const epgCache = new Map<string, LiveEpgSnapshot>();

interface QueuedSubscriber {
  id: number;
  onUpdate: (snapshot: LiveEpgSnapshot) => void;
  cancelled: boolean;
}

interface EpgTask {
  cacheKey: string;
  credentials: XtreamCredentials;
  streamId: number;
  priority: 'high' | 'normal';
  status: 'queued' | 'running' | 'settled' | 'cancelled';
  subscribers: Map<number, QueuedSubscriber>;
  promise: Promise<LiveEpgSnapshot>;
  resolvePromise: (snapshot: LiveEpgSnapshot) => void;
}

const activeTasks = new Map<string, EpgTask>();
const pendingQueue: EpgTask[] = [];
let runningCount = 0;
let nextSubscriberId = 1;
let generationCounter = 1;

const stats: LiveEpgStats = {
  totalNetworkRequests: 0,
  deduplicatedHits: 0,
  cacheHits: 0,
  cancelledQueuedRequests: 0,
  staleIgnoredCount: 0,
  activeInFlightCount: 0,
  queuedCount: 0,
  maxObservedConcurrent: 0,
  requestsByStreamId: {},
};

export function getLiveEpgNowMs(): number {
  return customClockFn ? customClockFn() : Date.now();
}

export function setLiveEpgClockForTest(clockFn: (() => number) | null): void {
  customClockFn = clockFn;
}

export function setLiveEpgConcurrencyLimitForTest(limit: number): void {
  maxConcurrentEpgRequests = Math.max(1, Math.floor(limit || 3));
}

export function resetLiveEpgCacheForTest(): void {
  generationCounter++;
  epgCache.clear();
  pendingQueue.length = 0;
  activeTasks.clear();
  runningCount = 0;
  stats.totalNetworkRequests = 0;
  stats.deduplicatedHits = 0;
  stats.cacheHits = 0;
  stats.cancelledQueuedRequests = 0;
  stats.staleIgnoredCount = 0;
  stats.activeInFlightCount = 0;
  stats.queuedCount = 0;
  stats.maxObservedConcurrent = 0;
  stats.requestsByStreamId = {};
}

export function getLiveEpgStatsForTest(): LiveEpgStats {
  return {
    ...stats,
    activeInFlightCount: runningCount,
    queuedCount: pendingQueue.length,
    requestsByStreamId: { ...stats.requestsByStreamId },
  };
}

/**
 * Safely decodes an EPG text field (title or description) which may be Base64-encoded
 * (UTF-8 or Latin1) or plain text. Never throws and never returns binary garbage.
 */
export function decodeEpgText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';

  // Base64 strings have length divisible by 4 and only contain A-Z, a-z, 0-9, +, /, and optional = padding
  const looksLikeBase64 =
    trimmed.length >= 4 &&
    trimmed.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed);

  if (looksLikeBase64) {
    try {
      const binaryStr =
        typeof window !== 'undefined' && typeof window.atob === 'function'
          ? window.atob(trimmed)
          : Buffer.from(trimmed, 'base64').toString('binary');

      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      let decoded = '';
      if (typeof TextDecoder !== 'undefined') {
        try {
          decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch {
          decoded = binaryStr;
        }
      } else {
        try {
          decoded = decodeURIComponent(escape(binaryStr));
        } catch {
          decoded = binaryStr;
        }
      }

      // Reject decoded result if it contains non-whitespace control characters or replacement chars
      const hasControlChars = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\uFFFD]/.test(decoded);
      if (!hasControlChars && decoded.trim().length > 0) {
        return decoded.replace(/\s+/g, ' ').trim();
      }
    } catch {
      // Fall back to plain text below
    }
  }

  return trimmed.replace(/\s+/g, ' ').trim();
}

/**
 * Parses an EPG timestamp from numeric seconds/ms or date string ("YYYY-MM-DD HH:mm:ss" or ISO).
 * Returns NaN if invalid.
 */
export function parseEpgTimestampMs(rawTimestamp: unknown, rawDateStr?: unknown): number {
  if (rawTimestamp !== null && rawTimestamp !== undefined && rawTimestamp !== '') {
    const num = Number(rawTimestamp);
    if (Number.isFinite(num) && num > 0) {
      // Values below 1e11 are Unix timestamps in seconds
      return num < 1e11 ? Math.round(num * 1000) : Math.round(num);
    }
  }

  if (typeof rawDateStr === 'string') {
    const trimmed = rawDateStr.trim();
    if (!trimmed) return NaN;

    if (/^\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      if (Number.isFinite(num) && num > 0) {
        return num < 1e11 ? Math.round(num * 1000) : Math.round(num);
      }
    }

    // Normalize "YYYY-MM-DD HH:mm:ss" -> "YYYY-MM-DDTHH:mm:ss"
    const normalized = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?$/.test(trimmed)
      ? trimmed.replace(/\s+/, 'T')
      : trimmed;
    const parsed = Date.parse(normalized);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return NaN;
}

export function formatEpgTimeLabel(rawDateStr: unknown, timestampMs: number): string {
  if (typeof rawDateStr === 'string') {
    const parts = rawDateStr.trim().split(/[\sT]+/);
    if (parts.length >= 2 && /^\d{2}:\d{2}/.test(parts[1])) {
      return parts[1].slice(0, 5);
    }
  }
  if (Number.isFinite(timestampMs) && timestampMs > 0) {
    const d = new Date(timestampMs);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  return '';
}

/**
 * Parses and validates raw EPG listings, returning sorted valid entries.
 */
export function parseValidEpgListings(rawListings: unknown, nowMs: number = getLiveEpgNowMs()): ResolvedEpgProgram[] {
  if (!Array.isArray(rawListings) || rawListings.length === 0) {
    return [];
  }

  const valid: ResolvedEpgProgram[] = [];
  for (let i = 0; i < rawListings.length; i++) {
    const item = rawListings[i];
    if (!item || typeof item !== 'object') continue;

    const title = decodeEpgText(item.title);
    if (!title) continue;

    const startMs = parseEpgTimestampMs(item.start_timestamp, item.start);
    const endMs = parseEpgTimestampMs(
      item.stop_timestamp ?? item.end_timestamp,
      item.end ?? item.stop
    );

    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      continue;
    }

    const description = decodeEpgText(item.description ?? item.descr ?? '');
    const startLabel = formatEpgTimeLabel(item.start, startMs);
    const endLabel = formatEpgTimeLabel(item.end ?? item.stop, endMs);
    const id = String(item.id ?? item.epg_id ?? `${startMs}_${endMs}_${i}`);
    const isCurrent = startMs <= nowMs && nowMs < endMs;

    valid.push({
      id,
      title,
      description,
      startMs,
      endMs,
      startLabel,
      endLabel,
      isCurrent,
      raw: item,
    });
  }

  valid.sort((a, b) => {
    if (a.startMs !== b.startMs) return a.startMs - b.startMs;
    return a.endMs - b.endMs;
  });

  return valid;
}

/**
 * Resolves the program currently airing at `nowMs` (`startMs <= nowMs && nowMs < endMs`).
 * Never assumes index 0 is on air without temporal validation.
 */
export function resolveCurrentEpgProgram(
  rawListings: unknown,
  nowMs: number = getLiveEpgNowMs()
): ResolvedEpgProgram | null {
  const valid = parseValidEpgListings(rawListings, nowMs);
  for (let i = 0; i < valid.length; i++) {
    const entry = valid[i];
    if (entry.startMs <= nowMs && nowMs < entry.endMs) {
      return entry;
    }
  }
  return null;
}

/**
 * Resolves both the currently airing program and the non-expired timeline (`endMs > nowMs`)
 * for the right-pane schedule view.
 */
export function resolveRightPaneEpgTimeline(
  rawListings: unknown,
  nowMs: number = getLiveEpgNowMs()
): { currentProgram: ResolvedEpgProgram | null; timeline: ResolvedEpgProgram[] } {
  const valid = parseValidEpgListings(rawListings, nowMs);
  if (valid.length === 0) {
    return { currentProgram: null, timeline: [] };
  }

  const currentProgram =
    valid.find((entry) => entry.startMs <= nowMs && nowMs < entry.endMs) ?? null;

  const nonExpired = valid
    .filter((entry) => entry.endMs > nowMs)
    .map((entry) => ({
      ...entry,
      isCurrent:
        currentProgram !== null &&
        entry.id === currentProgram.id &&
        entry.startMs === currentProgram.startMs,
    }));

  return {
    currentProgram,
    timeline: nonExpired,
  };
}

const EPG_VARIANT_RESOLUTION_PRIORITY: ResolutionQuality[] = ['SD', 'HD', 'FHD', '4K'];

/**
 * Selects the canonical stream_id used for EPG queries of a channel group when in automatic mode.
 * Prioritizes SD -> HD -> FHD -> 4K (matching `group.primaryStream` and initial auto playback)
 * so card EPG queries and initial right-pane playback share the exact same stream_id and cache entry.
 */
export function getPreferredEpgStreamIdForGroup(group: LiveChannelGroup | null | undefined): number {
  if (!group) return 0;

  if (Array.isArray(group.variants) && group.variants.length > 0) {
    for (const res of EPG_VARIANT_RESOLUTION_PRIORITY) {
      const match = group.variants.find((v) => v.resolution === res);
      const candidateId = Number(
        match?.streamId ?? match?.stream?.stream_id ?? match?.stream?.id
      );
      if (Number.isFinite(candidateId) && candidateId > 0) {
        return candidateId;
      }
    }
    const fallbackVariantId = Number(
      group.variants[0]?.streamId ??
        group.variants[0]?.stream?.stream_id ??
        group.variants[0]?.stream?.id
    );
    if (Number.isFinite(fallbackVariantId) && fallbackVariantId > 0) {
      return fallbackVariantId;
    }
  }

  const primaryId = Number(group.primaryStream?.stream_id ?? group.primaryStream?.id);
  if (Number.isFinite(primaryId) && primaryId > 0) {
    return primaryId;
  }

  if (Array.isArray(group.allStreams) && group.allStreams.length > 0) {
    const firstStreamId = Number(group.allStreams[0]?.stream_id ?? group.allStreams[0]?.id);
    if (Number.isFinite(firstStreamId) && firstStreamId > 0) {
      return firstStreamId;
    }
  }

  return 0;
}

export function buildLiveEpgCacheKey(
  credentials: XtreamCredentials | null | undefined,
  streamId: number | string | null | undefined
): string {
  if (!credentials || !credentials.serverUrl || !credentials.username) {
    return '';
  }
  const numericStreamId = Number(streamId);
  if (!Number.isFinite(numericStreamId) || numericStreamId <= 0) {
    return '';
  }
  const normalizedServer = String(credentials.serverUrl)
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '');
  const normalizedUser = String(credentials.username).trim().toLowerCase();
  return `${normalizedServer}|${normalizedUser}|${numericStreamId}`;
}

function buildSnapshotFromRaw(
  cacheKey: string,
  streamId: number,
  rawListings: any[],
  status: 'ok' | 'empty' | 'error',
  nowMs: number
): LiveEpgSnapshot {
  if (status === 'error') {
    return {
      cacheKey,
      streamId,
      status: 'error',
      currentProgram: null,
      timeline: [],
      rawListings: [],
      fetchedAtMs: nowMs,
      expiresAtMs: nowMs + DEFAULT_ERROR_TTL_MS,
    };
  }

  const { currentProgram, timeline } = resolveRightPaneEpgTimeline(rawListings, nowMs);
  const resolvedStatus: LiveEpgStatus = timeline.length > 0 ? 'ok' : 'empty';
  const expiresAtMs =
    currentProgram !== null
      ? Math.min(currentProgram.endMs, nowMs + DEFAULT_OK_TTL_MS)
      : nowMs + (resolvedStatus === 'ok' ? DEFAULT_OK_TTL_MS : DEFAULT_EMPTY_TTL_MS);

  return {
    cacheKey,
    streamId,
    status: resolvedStatus,
    currentProgram,
    timeline,
    rawListings,
    fetchedAtMs: nowMs,
    expiresAtMs,
  };
}

/**
 * Reads a valid (non-expired) EPG snapshot from cache, re-evaluating temporal bounds against `nowMs`.
 * If the previously active program has just ended (`nowMs >= currentProgram.endMs`), re-evaluates
 * `rawListings` and invalidates if no valid current program remains after expiration.
 */
export function getCachedLiveEpgSnapshot(
  credentials: XtreamCredentials | null | undefined,
  streamId: number | string | null | undefined,
  nowMs: number = getLiveEpgNowMs()
): LiveEpgSnapshot | null {
  const cacheKey = buildLiveEpgCacheKey(credentials, streamId);
  if (!cacheKey) return null;

  const existing = epgCache.get(cacheKey);
  if (!existing) return null;

  if (nowMs >= existing.expiresAtMs) {
    // Before evicting a cached listing set when a program boundary was crossed,
    // check if the overall fetch TTL is still fresh and another program in rawListings is now airing
    if (
      existing.status === 'ok' &&
      existing.rawListings.length > 0 &&
      nowMs < existing.fetchedAtMs + DEFAULT_OK_TTL_MS
    ) {
      const refreshed = buildSnapshotFromRaw(
        cacheKey,
        existing.streamId,
        existing.rawListings,
        'ok',
        nowMs
      );
      if (refreshed.currentProgram !== null) {
        refreshed.fetchedAtMs = existing.fetchedAtMs;
        epgCache.set(cacheKey, refreshed);
        return refreshed;
      }
    }
    epgCache.delete(cacheKey);
    return null;
  }

  // Always verify temporal validity of currentProgram against current clock
  if (
    existing.currentProgram &&
    (nowMs < existing.currentProgram.startMs || nowMs >= existing.currentProgram.endMs)
  ) {
    const refreshed = buildSnapshotFromRaw(
      cacheKey,
      existing.streamId,
      existing.rawListings,
      existing.status === 'error' ? 'error' : 'ok',
      nowMs
    );
    refreshed.fetchedAtMs = existing.fetchedAtMs;
    epgCache.set(cacheKey, refreshed);
    return refreshed;
  }

  return existing;
}

export function isLiveEpgRequestInFlight(
  credentials: XtreamCredentials | null | undefined,
  streamId: number | string | null | undefined
): boolean {
  const cacheKey = buildLiveEpgCacheKey(credentials, streamId);
  if (!cacheKey) return false;
  return activeTasks.has(cacheKey);
}

function pumpQueue(): void {
  while (runningCount < maxConcurrentEpgRequests && pendingQueue.length > 0) {
    const nextTask = pendingQueue.shift();
    if (!nextTask) break;
    if (nextTask.status !== 'queued') continue;

    // Check if all subscribers cancelled while waiting in queue
    let activeSubscribers = 0;
    nextTask.subscribers.forEach((sub) => {
      if (!sub.cancelled) activeSubscribers++;
    });

    if (activeSubscribers === 0) {
      nextTask.status = 'cancelled';
      activeTasks.delete(nextTask.cacheKey);
      stats.cancelledQueuedRequests++;
      continue;
    }

    executeTask(nextTask);
  }
}

function executeTask(task: EpgTask): void {
  const taskGen = generationCounter;
  task.status = 'running';
  runningCount++;
  if (runningCount > stats.maxObservedConcurrent) {
    stats.maxObservedConcurrent = runningCount;
  }

  stats.totalNetworkRequests++;
  stats.requestsByStreamId[task.streamId] =
    (stats.requestsByStreamId[task.streamId] || 0) + 1;

  Promise.resolve()
    .then(() => XtreamService.getShortEpg(task.credentials, task.streamId, 10))
    .then((data) => {
      const nowMs = getLiveEpgNowMs();
      const rawListings = Array.isArray(data?.epg_listings) ? data.epg_listings : [];
      const snapshot = buildSnapshotFromRaw(
        task.cacheKey,
        task.streamId,
        rawListings,
        rawListings.length > 0 ? 'ok' : 'empty',
        nowMs
      );
      return snapshot;
    })
    .catch(() => {
      const nowMs = getLiveEpgNowMs();
      return buildSnapshotFromRaw(task.cacheKey, task.streamId, [], 'error', nowMs);
    })
    .then((snapshot) => {
      runningCount = Math.max(0, runningCount - 1);
      activeTasks.delete(task.cacheKey);
      task.status = 'settled';

      if (taskGen !== generationCounter) {
        stats.staleIgnoredCount++;
        task.resolvePromise(snapshot);
        pumpQueue();
        return;
      }

      epgCache.set(task.cacheKey, snapshot);

      task.subscribers.forEach((sub) => {
        if (sub.cancelled) {
          stats.staleIgnoredCount++;
          return;
        }
        try {
          sub.onUpdate(snapshot);
        } catch {
          // Ignore subscriber callback errors
        }
      });

      task.resolvePromise(snapshot);
      pumpQueue();
    });
}

/**
 * Subscribes a caller (channel card or right-pane detail view) to the EPG of `(credentials, streamId)`.
 * - Returns cached snapshot immediately if valid.
 * - Deduplicates concurrent/queued requests for the same `(credentials, streamId)`.
 * - Enforces concurrency limit (`maxConcurrentEpgRequests`).
 * - Cancels queued requests if all subscribers unsubscribe before execution starts.
 */
export function subscribeLiveChannelEpg(options: {
  credentials: XtreamCredentials | null | undefined;
  streamId: number | string | null | undefined;
  priority?: 'high' | 'normal';
  forceRefresh?: boolean;
  onUpdate: (snapshot: LiveEpgSnapshot) => void;
}): () => void {
  const {
    credentials,
    streamId,
    priority = 'normal',
    forceRefresh = false,
    onUpdate,
  } = options;

  const numericStreamId = Number(streamId);
  const cacheKey = buildLiveEpgCacheKey(credentials, numericStreamId);

  if (!cacheKey || !credentials) {
    const emptySnapshot: LiveEpgSnapshot = {
      cacheKey: '',
      streamId: Number.isFinite(numericStreamId) ? numericStreamId : 0,
      status: 'empty',
      currentProgram: null,
      timeline: [],
      rawListings: [],
      fetchedAtMs: getLiveEpgNowMs(),
      expiresAtMs: getLiveEpgNowMs() + DEFAULT_EMPTY_TTL_MS,
    };
    onUpdate(emptySnapshot);
    return () => {};
  }

  if (!forceRefresh) {
    const cached = getCachedLiveEpgSnapshot(credentials, numericStreamId);
    if (cached) {
      stats.cacheHits++;
      onUpdate(cached);
      return () => {};
    }
  }

  const subId = nextSubscriberId++;
  const subscriber: QueuedSubscriber = {
    id: subId,
    onUpdate,
    cancelled: false,
  };

  const existingTask = activeTasks.get(cacheKey);
  if (existingTask && (existingTask.status === 'queued' || existingTask.status === 'running')) {
    stats.deduplicatedHits++;
    existingTask.subscribers.set(subId, subscriber);
    if (priority === 'high' && existingTask.priority !== 'high' && existingTask.status === 'queued') {
      existingTask.priority = 'high';
      const qIdx = pendingQueue.indexOf(existingTask);
      if (qIdx > 0) {
        pendingQueue.splice(qIdx, 1);
        pendingQueue.unshift(existingTask);
      }
    }

    return () => {
      subscriber.cancelled = true;
      existingTask.subscribers.delete(subId);
      if (existingTask.status === 'queued' && existingTask.subscribers.size === 0) {
        existingTask.status = 'cancelled';
        const qIdx = pendingQueue.indexOf(existingTask);
        if (qIdx !== -1) {
          pendingQueue.splice(qIdx, 1);
        }
        activeTasks.delete(cacheKey);
        stats.cancelledQueuedRequests++;
      }
    };
  }

  let resolvePromise!: (snapshot: LiveEpgSnapshot) => void;
  const promise = new Promise<LiveEpgSnapshot>((resolve) => {
    resolvePromise = resolve;
  });

  const newTask: EpgTask = {
    cacheKey,
    credentials,
    streamId: numericStreamId,
    priority,
    status: 'queued',
    subscribers: new Map([[subId, subscriber]]),
    promise,
    resolvePromise,
  };

  activeTasks.set(cacheKey, newTask);
  if (priority === 'high') {
    pendingQueue.unshift(newTask);
  } else {
    pendingQueue.push(newTask);
  }

  pumpQueue();

  return () => {
    subscriber.cancelled = true;
    newTask.subscribers.delete(subId);
    if (newTask.status === 'queued' && newTask.subscribers.size === 0) {
      newTask.status = 'cancelled';
      const qIdx = pendingQueue.indexOf(newTask);
      if (qIdx !== -1) {
        pendingQueue.splice(qIdx, 1);
      }
      activeTasks.delete(cacheKey);
      stats.cancelledQueuedRequests++;
    }
  };
}
