import { XtreamCredentials } from '../types';
import { XtreamService } from '../services/xtreamService';
import { normalizeServerUrl } from './mediaUtils';
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

const DEFAULT_OK_TTL_MS = 5 * 60 * 1000;
const DEFAULT_EMPTY_TTL_MS = 2 * 60 * 1000;
const DEFAULT_ERROR_TTL_MS = 15 * 1000;
export const DEFAULT_MAX_EPG_CACHE_ENTRIES = 512;

let customClockFn: (() => number) | null = null;
let maxConcurrentEpgRequests = 3;
let maxEpgCacheEntries = DEFAULT_MAX_EPG_CACHE_ENTRIES;

const epgCache = new Map<string, LiveEpgSnapshot>();

interface QueuedSubscriber {
  id: number;
  onUpdate: (snapshot: LiveEpgSnapshot) => void;
  cancelled: boolean;
}

interface EpgTask {
  internalKey: string;
  cacheKey: string;
  credentials: XtreamCredentials;
  streamId: number;
  priority: 'high' | 'normal';
  generation: number;
  status: 'queued' | 'running' | 'settled' | 'cancelled';
  abortController: AbortController | null;
  slotReleased: boolean;
  promiseResolved: boolean;
  subscribers: Map<number, QueuedSubscriber>;
  promise: Promise<LiveEpgSnapshot>;
  resolvePromise: (snapshot: LiveEpgSnapshot) => void;
}

const activeTasks = new Map<string, EpgTask>();
const pendingQueue: EpgTask[] = [];
let runningCount = 0;
let nextSubscriberId = 1;
let generationCounter = 1;

export function getLiveEpgNowMs(): number {
  return customClockFn ? customClockFn() : Date.now();
}

export function setLiveEpgClockForTest(clockFn: (() => number) | null): void {
  customClockFn = clockFn;
}

export function setLiveEpgConcurrencyLimitForTest(limit: number): void {
  maxConcurrentEpgRequests = Math.max(1, Math.floor(limit || 3));
}

export function setLiveEpgMaxCacheEntriesForTest(limit: number): void {
  maxEpgCacheEntries = Math.max(
    1,
    Math.floor(limit || DEFAULT_MAX_EPG_CACHE_ENTRIES)
  );
  evictEpgCacheToLimit(getLiveEpgNowMs());
}

function createCancelledTaskSnapshot(
  cacheKey: string,
  streamId: number,
  nowMs: number
): LiveEpgSnapshot {
  return {
    cacheKey,
    streamId,
    status: 'idle',
    currentProgram: null,
    timeline: [],
    rawListings: [],
    fetchedAtMs: nowMs,
    expiresAtMs: nowMs,
  };
}

function resolveTaskOnce(task: EpgTask, snapshot: LiveEpgSnapshot): void {
  if (task.promiseResolved) return;
  task.promiseResolved = true;
  task.resolvePromise(snapshot);
}

/**
 * Encerra e limpa todo o cache e a fila de EPG da sessão atual (ex.: logout ou troca de conta),
 * abortando consultas em execução e resolvendo consumidores pendentes sem vazamento.
 */
export function clearLiveEpgSessionCache(): void {
  generationCounter++;
  const nowMs = getLiveEpgNowMs();

  const tasksToAbort = new Set<EpgTask>([
    ...pendingQueue,
    ...activeTasks.values(),
  ]);

  pendingQueue.length = 0;
  activeTasks.clear();
  epgCache.clear();
  runningCount = 0;

  tasksToAbort.forEach((task) => {
    task.status = 'cancelled';
    task.slotReleased = true;
    try {
      task.abortController?.abort();
    } catch {
      // ignore
    }
    resolveTaskOnce(
      task,
      createCancelledTaskSnapshot(task.cacheKey, task.streamId, nowMs)
    );
  });
}

export function resetLiveEpgCacheForTest(): void {
  maxEpgCacheEntries = DEFAULT_MAX_EPG_CACHE_ENTRIES;
  clearLiveEpgSessionCache();
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

function buildInternalEpgTaskKey(
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
  const canonicalServer = (
    normalizeServerUrl(credentials.serverUrl) ||
    String(credentials.serverUrl).trim().toLowerCase()
  ).replace(/\/+$/, '');
  const username = String(credentials.username);
  const password = String(credentials.password ?? '');
  // Chave interna isolada por credenciais completas; nunca exposta em snapshot.cacheKey nem em logs
  return `${canonicalServer}\0${username}\0${password}\0${numericStreamId}`;
}

function isCacheEntryStrictlyExpired(
  entry: LiveEpgSnapshot,
  nowMs: number
): boolean {
  if (nowMs < entry.expiresAtMs) {
    return false;
  }
  if (
    entry.status === 'ok' &&
    entry.rawListings.length > 0 &&
    nowMs < entry.fetchedAtMs + DEFAULT_OK_TTL_MS
  ) {
    return false;
  }
  return true;
}

function pruneExpiredEpgCache(nowMs: number): void {
  for (const [key, entry] of epgCache.entries()) {
    if (isCacheEntryStrictlyExpired(entry, nowMs)) {
      epgCache.delete(key);
    }
  }
}

function evictEpgCacheToLimit(nowMs: number): void {
  if (epgCache.size <= maxEpgCacheEntries) return;
  pruneExpiredEpgCache(nowMs);
  while (epgCache.size > maxEpgCacheEntries) {
    const oldestKey = epgCache.keys().next().value;
    if (oldestKey === undefined) break;
    epgCache.delete(oldestKey);
  }
}

function lruTouchEpgCache(internalKey: string, snapshot: LiveEpgSnapshot): void {
  if (epgCache.has(internalKey)) {
    epgCache.delete(internalKey);
  }
  epgCache.set(internalKey, snapshot);
}

function lruSetEpgCache(
  internalKey: string,
  snapshot: LiveEpgSnapshot,
  nowMs: number
): void {
  lruTouchEpgCache(internalKey, snapshot);
  evictEpgCacheToLimit(nowMs);
}

function buildSnapshotFromRaw(
  cacheKey: string,
  streamId: number,
  rawListings: any[],
  status: 'ok' | 'empty' | 'error',
  nowMs: number,
  fetchedAtMs: number = nowMs
): LiveEpgSnapshot {
  if (status === 'error') {
    return {
      cacheKey,
      streamId,
      status: 'error',
      currentProgram: null,
      timeline: [],
      rawListings: [],
      fetchedAtMs,
      expiresAtMs: fetchedAtMs + DEFAULT_ERROR_TTL_MS,
    };
  }

  const { currentProgram, timeline } = resolveRightPaneEpgTimeline(rawListings, nowMs);
  const resolvedStatus: LiveEpgStatus = timeline.length > 0 ? 'ok' : 'empty';
  const maxExpiresAtMs =
    fetchedAtMs +
    (resolvedStatus === 'ok' ? DEFAULT_OK_TTL_MS : DEFAULT_EMPTY_TTL_MS);
  const expiresAtMs =
    currentProgram !== null
      ? Math.min(currentProgram.endMs, maxExpiresAtMs)
      : maxExpiresAtMs;

  return {
    cacheKey,
    streamId,
    status: resolvedStatus,
    currentProgram,
    timeline,
    rawListings,
    fetchedAtMs,
    expiresAtMs,
  };
}

/**
 * Reads a valid (non-expired) EPG snapshot from cache, re-evaluating temporal bounds against `nowMs`.
 * If the previously active program has just ended (`nowMs >= currentProgram.endMs`), re-evaluates
 * `rawListings` anchored to the original `fetchedAtMs` (never extending the original TTL)
 * and invalidates once the original TTL expires or no valid current program remains.
 */
export function getCachedLiveEpgSnapshot(
  credentials: XtreamCredentials | null | undefined,
  streamId: number | string | null | undefined,
  nowMs: number = getLiveEpgNowMs()
): LiveEpgSnapshot | null {
  const internalKey = buildInternalEpgTaskKey(credentials, streamId);
  const cacheKey = buildLiveEpgCacheKey(credentials, streamId);
  if (!internalKey || !cacheKey) return null;

  const existing = epgCache.get(internalKey);
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
        nowMs,
        existing.fetchedAtMs
      );
      if (refreshed.currentProgram !== null && nowMs < refreshed.expiresAtMs) {
        lruTouchEpgCache(internalKey, refreshed);
        return refreshed;
      }
    }
    epgCache.delete(internalKey);
    return null;
  }

  // Always verify temporal validity of currentProgram against current clock without extending original TTL
  const needsTemporalRefresh =
    existing.status === 'ok' &&
    ((existing.currentProgram !== null &&
      (nowMs < existing.currentProgram.startMs ||
        nowMs >= existing.currentProgram.endMs)) ||
      (existing.currentProgram === null &&
        existing.timeline.length > 0 &&
        existing.timeline[0].startMs <= nowMs));

  if (needsTemporalRefresh) {
    const refreshed = buildSnapshotFromRaw(
      cacheKey,
      existing.streamId,
      existing.rawListings,
      'ok',
      nowMs,
      existing.fetchedAtMs
    );
    if (nowMs >= refreshed.expiresAtMs) {
      epgCache.delete(internalKey);
      return null;
    }
    lruTouchEpgCache(internalKey, refreshed);
    return refreshed;
  }

  // Atualiza posição LRU no acesso válido
  lruTouchEpgCache(internalKey, existing);
  return existing;
}

export function isLiveEpgRequestInFlight(
  credentials: XtreamCredentials | null | undefined,
  streamId: number | string | null | undefined
): boolean {
  const internalKey = buildInternalEpgTaskKey(credentials, streamId);
  if (!internalKey) return false;
  return activeTasks.has(internalKey);
}

function cancelTaskIfOrphaned(task: EpgTask): void {
  if (task.subscribers.size > 0) return;
  if (task.status !== 'queued' && task.status !== 'running') return;

  const wasQueued = task.status === 'queued';
  task.status = 'cancelled';

  if (wasQueued) {
    const qIdx = pendingQueue.indexOf(task);
    if (qIdx !== -1) {
      pendingQueue.splice(qIdx, 1);
    }
  }

  if (activeTasks.get(task.internalKey) === task) {
    activeTasks.delete(task.internalKey);
  }

  try {
    task.abortController?.abort();
  } catch {
    // ignore
  }

  resolveTaskOnce(
    task,
    createCancelledTaskSnapshot(task.cacheKey, task.streamId, getLiveEpgNowMs())
  );
}

function pumpQueue(): void {
  while (runningCount < maxConcurrentEpgRequests && pendingQueue.length > 0) {
    const nextTask = pendingQueue.shift();
    if (!nextTask) break;
    if (nextTask.status !== 'queued' || nextTask.generation !== generationCounter) {
      continue;
    }

    // Check if all subscribers cancelled while waiting in queue
    let activeSubscribers = 0;
    nextTask.subscribers.forEach((sub) => {
      if (!sub.cancelled) activeSubscribers++;
    });

    if (activeSubscribers === 0) {
      nextTask.status = 'cancelled';
      if (activeTasks.get(nextTask.internalKey) === nextTask) {
        activeTasks.delete(nextTask.internalKey);
      }
      resolveTaskOnce(
        nextTask,
        createCancelledTaskSnapshot(
          nextTask.cacheKey,
          nextTask.streamId,
          getLiveEpgNowMs()
        )
      );
      continue;
    }

    executeTask(nextTask);
  }
}

function executeTask(task: EpgTask): void {
  const taskGen = task.generation;
  task.status = 'running';
  runningCount++;

  const signal = task.abortController?.signal;
  const coordinatorPriority = task.priority === 'high' ? 'user' : 'normal';

  Promise.resolve()
    .then(() => {
      if (
        taskGen !== generationCounter ||
        task.status === 'cancelled' ||
        signal?.aborted
      ) {
        return { aborted: true as const, snapshot: null };
      }
      return XtreamService.getShortEpg(task.credentials, task.streamId, 10, {
        signal,
        lane: 'epg',
        priority: coordinatorPriority,
      }).then((data) => {
        if (
          taskGen !== generationCounter ||
          task.status === 'cancelled' ||
          signal?.aborted
        ) {
          return { aborted: true as const, snapshot: null };
        }
        const nowMs = getLiveEpgNowMs();
        const rawListings = Array.isArray(data?.epg_listings)
          ? data.epg_listings
          : [];
        const snapshot = buildSnapshotFromRaw(
          task.cacheKey,
          task.streamId,
          rawListings,
          rawListings.length > 0 ? 'ok' : 'empty',
          nowMs
        );
        return { aborted: false as const, snapshot };
      });
    })
    .catch((err: any) => {
      const isAborted = Boolean(
        taskGen !== generationCounter ||
          task.status === 'cancelled' ||
          signal?.aborted ||
          err?.isAborted === true ||
          err?.name === 'AbortError' ||
          err?.message === 'Operação cancelada pelo usuário.'
      );
      if (isAborted) {
        return { aborted: true as const, snapshot: null };
      }
      const nowMs = getLiveEpgNowMs();
      return {
        aborted: false as const,
        snapshot: buildSnapshotFromRaw(
          task.cacheKey,
          task.streamId,
          [],
          'error',
          nowMs
        ),
      };
    })
    .then((outcome) => {
      // Proteção contra sessão/geração obsoleta: nunca mutar contadores, fila,
      // activeTasks ou cache pertencentes a uma geração mais nova.
      if (taskGen !== generationCounter) {
        resolveTaskOnce(
          task,
          outcome.snapshot ??
            createCancelledTaskSnapshot(
              task.cacheKey,
              task.streamId,
              getLiveEpgNowMs()
            )
        );
        return;
      }

      if (!task.slotReleased) {
        task.slotReleased = true;
        runningCount = Math.max(0, runningCount - 1);
      }

      if (activeTasks.get(task.internalKey) === task) {
        activeTasks.delete(task.internalKey);
      }

      if (
        outcome.aborted ||
        !outcome.snapshot ||
        task.status === 'cancelled' ||
        signal?.aborted
      ) {
        task.status = 'cancelled';
        resolveTaskOnce(
          task,
          createCancelledTaskSnapshot(
            task.cacheKey,
            task.streamId,
            getLiveEpgNowMs()
          )
        );
        pumpQueue();
        return;
      }

      const snapshot = outcome.snapshot;
      task.status = 'settled';
      lruSetEpgCache(task.internalKey, snapshot, snapshot.fetchedAtMs);

      task.subscribers.forEach((sub) => {
        if (sub.cancelled) {
          return;
        }
        try {
          sub.onUpdate(snapshot);
        } catch {
          // Ignore subscriber callback errors
        }
      });

      resolveTaskOnce(task, snapshot);
      pumpQueue();
    });
}

/**
 * Subscribes a caller (channel card or right-pane detail view) to the EPG of `(credentials, streamId)`.
 * - Returns cached snapshot immediately if valid (updating LRU order).
 * - Deduplicates concurrent/queued requests for the same `(credentials, streamId)`.
 * - Enforces concurrency limit (`maxConcurrentEpgRequests`) and coordinates via shared Xtream coordinator.
 * - Cancels queued AND running requests (propagating AbortSignal) when all subscribers unsubscribe.
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
  const internalKey = buildInternalEpgTaskKey(credentials, numericStreamId);

  if (!cacheKey || !internalKey || !credentials) {
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

  const existingTask = activeTasks.get(internalKey);
  if (
    existingTask &&
    existingTask.generation === generationCounter &&
    (existingTask.status === 'queued' || existingTask.status === 'running')
  ) {
    existingTask.subscribers.set(subId, subscriber);
    if (priority === 'high' && existingTask.priority !== 'high') {
      existingTask.priority = 'high';
      if (existingTask.status === 'queued') {
        const qIdx = pendingQueue.indexOf(existingTask);
        if (qIdx > 0) {
          pendingQueue.splice(qIdx, 1);
          pendingQueue.unshift(existingTask);
        }
      }
      XtreamService.elevateRequestPriority(
        credentials,
        'get_short_epg',
        { stream_id: String(numericStreamId), limit: '10' },
        'user'
      );
    }

    return () => {
      subscriber.cancelled = true;
      existingTask.subscribers.delete(subId);
      cancelTaskIfOrphaned(existingTask);
    };
  }

  let resolvePromise!: (snapshot: LiveEpgSnapshot) => void;
  const promise = new Promise<LiveEpgSnapshot>((resolve) => {
    resolvePromise = resolve;
  });

  const abortController =
    typeof AbortController !== 'undefined' ? new AbortController() : null;

  const newTask: EpgTask = {
    internalKey,
    cacheKey,
    credentials,
    streamId: numericStreamId,
    priority,
    generation: generationCounter,
    status: 'queued',
    abortController,
    slotReleased: false,
    promiseResolved: false,
    subscribers: new Map([[subId, subscriber]]),
    promise,
    resolvePromise,
  };

  activeTasks.set(internalKey, newTask);
  if (priority === 'high') {
    pendingQueue.unshift(newTask);
  } else {
    pendingQueue.push(newTask);
  }

  pumpQueue();

  return () => {
    subscriber.cancelled = true;
    newTask.subscribers.delete(subId);
    cancelTaskIfOrphaned(newTask);
  };
}
