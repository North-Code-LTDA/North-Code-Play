import { useSyncExternalStore, useCallback, useMemo } from 'react';
import { getAccountKey, safeReadStorage, safeSetStorage, StorageReadResult } from './accountUtils';

export const HISTORY_KEY_PREFIX = 'northcode_history_';
export const HISTORY_UPDATED_EVENT = 'northcode_history_updated';
export const MAX_CACHED_HISTORY_ACCOUNTS = 8;

export type PlaybackType = 'live' | 'movie' | 'episode';

export interface PlaybackHistoryRecord {
  id: string;
  type: PlaybackType;
  updatedAt: number;
  positionSec?: number;
  parentSeriesId?: string;
}

export type PlaybackHistoryMap = Record<string, PlaybackHistoryRecord>;

export interface AccountIdentity {
  serverUrl?: string | null;
  username?: string | null;
}

export interface PlaybackHistoryPerfStats {
  storageReads: number;
  storageWrites: number;
  jsonParses: number;
  recordValidations: number;
  sortCalls: number;
  cachedAccountsCount: number;
}

interface HistorySnapshot {
  raw: string | null;
  map: Readonly<PlaybackHistoryMap>;
  sortedRecords: PlaybackHistoryRecord[] | null;
  sortedByType: Partial<Record<PlaybackType, PlaybackHistoryRecord[]>>;
  verifiedInCurrentMicrotask?: boolean;
  pendingSubscriberRender?: boolean;
}

const EMPTY_HISTORY_MAP: Readonly<PlaybackHistoryMap> = Object.freeze({});
const EMPTY_HISTORY_RECORDS: PlaybackHistoryRecord[] = Object.freeze(
  []
) as unknown as PlaybackHistoryRecord[];

function createEmptySnapshot(raw: string | null = null): HistorySnapshot {
  return {
    raw,
    map: EMPTY_HISTORY_MAP,
    sortedRecords: EMPTY_HISTORY_RECORDS,
    sortedByType: {
      live: EMPTY_HISTORY_RECORDS,
      movie: EMPTY_HISTORY_RECORDS,
      episode: EMPTY_HISTORY_RECORDS,
    },
    verifiedInCurrentMicrotask: false,
    pendingSubscriberRender: false,
  };
}

const EMPTY_HISTORY_SNAPSHOT: HistorySnapshot = createEmptySnapshot(null);

// Bounded LRU in-memory snapshot cache per historyKey -> HistorySnapshot
const historySnapshotCache = new Map<string, HistorySnapshot>();

// Subscriptions per historyKey -> Set<() => void>
const historyListeners = new Map<string, Set<() => void>>();

// Tracks snapshots verified in the current synchronous turn/microtask
const microtaskVerifiedSnapshots = new Set<HistorySnapshot>();
let isMicrotaskClearScheduled = false;
let lastSeenStorageGetItem: unknown =
  typeof window !== 'undefined' && window.localStorage ? window.localStorage.getItem : null;

function markSnapshotVerifiedForMicrotask(snapshot: HistorySnapshot): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    lastSeenStorageGetItem = window.localStorage.getItem;
  }
  snapshot.verifiedInCurrentMicrotask = true;
  microtaskVerifiedSnapshots.add(snapshot);
  if (!isMicrotaskClearScheduled) {
    isMicrotaskClearScheduled = true;
    queueMicrotask(() => {
      isMicrotaskClearScheduled = false;
      microtaskVerifiedSnapshots.forEach((snap) => {
        snap.verifiedInCurrentMicrotask = false;
      });
      microtaskVerifiedSnapshots.clear();
    });
  }
}

function isSnapshotVerifiedInCurrentMicrotask(snapshot: HistorySnapshot | undefined): boolean {
  if (!snapshot || !snapshot.verifiedInCurrentMicrotask) return false;
  if (
    typeof window !== 'undefined' &&
    window.localStorage &&
    window.localStorage.getItem !== lastSeenStorageGetItem
  ) {
    return false;
  }
  return true;
}

// Tracks the historyKey whose snapshot was just updated/synced right before notifying subscribers
let activeConfirmedNotificationKey: string | null = null;
let areGlobalHistoryListenersAttached = false;

const perfStats = {
  storageReads: 0,
  storageWrites: 0,
  jsonParses: 0,
  recordValidations: 0,
  sortCalls: 0,
};

export function getPlaybackHistoryPerfStats(): PlaybackHistoryPerfStats {
  return {
    ...perfStats,
    cachedAccountsCount: historySnapshotCache.size,
  };
}

export function resetPlaybackHistoryPerfStats(): void {
  perfStats.storageReads = 0;
  perfStats.storageWrites = 0;
  perfStats.jsonParses = 0;
  perfStats.recordValidations = 0;
  perfStats.sortCalls = 0;
  microtaskVerifiedSnapshots.forEach((snap) => {
    snap.verifiedInCurrentMicrotask = false;
    snap.pendingSubscriberRender = false;
  });
  microtaskVerifiedSnapshots.clear();
  historySnapshotCache.forEach((snap) => {
    snap.pendingSubscriberRender = false;
  });
}

export function clearPlaybackHistoryMemoryCacheForTest(): void {
  microtaskVerifiedSnapshots.forEach((snap) => {
    snap.verifiedInCurrentMicrotask = false;
    snap.pendingSubscriberRender = false;
  });
  microtaskVerifiedSnapshots.clear();
  historySnapshotCache.clear();
}

function getCachedSnapshot(historyKey: string): HistorySnapshot | undefined {
  const existing = historySnapshotCache.get(historyKey);
  if (!existing) return undefined;
  // Refresh LRU order
  historySnapshotCache.delete(historyKey);
  historySnapshotCache.set(historyKey, existing);
  return existing;
}

function setCachedSnapshot(historyKey: string, snapshot: HistorySnapshot): void {
  if (!historyKey) return;
  if (historySnapshotCache.has(historyKey)) {
    historySnapshotCache.delete(historyKey);
  }
  historySnapshotCache.set(historyKey, snapshot);
  markSnapshotVerifiedForMicrotask(snapshot);

  while (historySnapshotCache.size > MAX_CACHED_HISTORY_ACCOUNTS) {
    let keyToEvict: string | undefined;
    for (const candidateKey of historySnapshotCache.keys()) {
      const subs = historyListeners.get(candidateKey);
      if (!subs || subs.size === 0) {
        keyToEvict = candidateKey;
        break;
      }
    }
    if (!keyToEvict) {
      keyToEvict = historySnapshotCache.keys().next().value;
    }
    if (!keyToEvict || keyToEvict === historyKey) break;
    historySnapshotCache.delete(keyToEvict);
  }
}

function getHistoryListeners(historyKey: string): Set<() => void> {
  let listeners = historyListeners.get(historyKey);
  if (!listeners) {
    listeners = new Set<() => void>();
    historyListeners.set(historyKey, listeners);
  }
  return listeners;
}

function notifyHistorySubscribers(historyKey: string, fromConfirmedSnapshot: boolean = false): void {
  const listeners = historyListeners.get(historyKey);
  if (!listeners || listeners.size === 0) return;

  if (fromConfirmedSnapshot) {
    const snap = historySnapshotCache.get(historyKey);
    if (snap) {
      snap.pendingSubscriberRender = true;
    }
  }

  const prevConfirmedKey = activeConfirmedNotificationKey;
  if (fromConfirmedSnapshot) {
    activeConfirmedNotificationKey = historyKey;
  }
  try {
    listeners.forEach((fn) => fn());
  } finally {
    activeConfirmedNotificationKey = prevConfirmedKey;
  }
}

function readStorageWithStats(historyKey: string): StorageReadResult {
  perfStats.storageReads++;
  return safeReadStorage(historyKey);
}

function writeStorageWithStats(historyKey: string, value: string): boolean {
  perfStats.storageWrites++;
  return safeSetStorage(historyKey, value);
}

function isValidHistoryRecord(
  key: string,
  item: unknown
): item is PlaybackHistoryRecord {
  perfStats.recordValidations++;
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return false;
  }

  const rec = item as Record<string, any>;
  const { type, id, updatedAt, positionSec, parentSeriesId } = rec;

  if (type !== 'live' && type !== 'movie' && type !== 'episode') {
    return false;
  }

  const isValidId =
    (typeof id === 'string' && id.length > 0) ||
    (typeof id === 'number' && Number.isFinite(id));
  if (!isValidId) {
    return false;
  }

  if (key !== `${type}:${String(id)}`) {
    return false;
  }

  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) {
    return false;
  }

  if ('positionSec' in rec && positionSec !== undefined) {
    if (typeof positionSec !== 'number' || !Number.isFinite(positionSec) || positionSec < 0) {
      return false;
    }
  }

  if ('parentSeriesId' in rec && parentSeriesId !== undefined) {
    const isValidParent =
      (typeof parentSeriesId === 'string' && parentSeriesId.length > 0) ||
      (typeof parentSeriesId === 'number' && Number.isFinite(parentSeriesId));
    if (!isValidParent) {
      return false;
    }
  }

  return true;
}

function validateAndFreezeHistoryMap(parsed: unknown): Readonly<PlaybackHistoryMap> | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const entries = Object.entries(parsed);
  if (entries.length === 0) {
    return EMPTY_HISTORY_MAP;
  }

  const validatedMap: PlaybackHistoryMap = {};
  for (const [key, item] of entries) {
    if (!isValidHistoryRecord(key, item)) {
      return null;
    }
    const rec = item as PlaybackHistoryRecord;
    const normalizedRecord: PlaybackHistoryRecord = {
      id: String(rec.id),
      type: rec.type,
      updatedAt: rec.updatedAt,
      ...(rec.positionSec !== undefined ? { positionSec: rec.positionSec } : {}),
      ...(rec.parentSeriesId !== undefined ? { parentSeriesId: String(rec.parentSeriesId) } : {}),
    };
    validatedMap[key] = Object.freeze(normalizedRecord);
  }

  return Object.freeze(validatedMap);
}

function parseAndValidateHistoryJson(raw: string): Readonly<PlaybackHistoryMap> | null {
  perfStats.jsonParses++;
  try {
    const parsed = JSON.parse(raw);
    return validateAndFreezeHistoryMap(parsed);
  } catch {
    return null;
  }
}

function createSnapshotFromValidatedMap(
  raw: string | null,
  validatedMap: Readonly<PlaybackHistoryMap>
): HistorySnapshot {
  if (validatedMap === EMPTY_HISTORY_MAP || Object.keys(validatedMap).length === 0) {
    return createEmptySnapshot(raw);
  }
  return {
    raw,
    map: validatedMap,
    sortedRecords: null,
    sortedByType: {},
  };
}

function getSortedRecordsFromSnapshot(
  snapshot: HistorySnapshot,
  typeFilter?: PlaybackType
): PlaybackHistoryRecord[] {
  if (!snapshot.sortedRecords) {
    const values = Object.values(snapshot.map);
    if (values.length === 0) {
      snapshot.sortedRecords = EMPTY_HISTORY_RECORDS;
    } else {
      perfStats.sortCalls++;
      values.sort((a, b) => b.updatedAt - a.updatedAt);
      snapshot.sortedRecords = Object.freeze(values) as unknown as PlaybackHistoryRecord[];
    }
  }

  if (!typeFilter) {
    return snapshot.sortedRecords;
  }

  const cachedByType = snapshot.sortedByType[typeFilter];
  if (cachedByType) {
    return cachedByType;
  }

  const filtered = snapshot.sortedRecords.filter((r) => r.type === typeFilter);
  const frozenFiltered =
    filtered.length === 0
      ? EMPTY_HISTORY_RECORDS
      : (Object.freeze(filtered) as unknown as PlaybackHistoryRecord[]);
  snapshot.sortedByType[typeFilter] = frozenFiltered;
  return frozenFiltered;
}

/**
 * Resolves the current confirmed snapshot for a historyKey.
 * Reuses the in-memory validated map and sorted records while the persisted raw string has not changed.
 * On storage read failure or corrupt JSON, preserves the previously confirmed snapshot in memory if present.
 */
function resolveSnapshotForRead(
  historyKey: string,
  allowConfirmedNotificationReuse: boolean = false
): HistorySnapshot | null {
  if (!historyKey) return EMPTY_HISTORY_SNAPSHOT;

  const cached = getCachedSnapshot(historyKey);
  if (allowConfirmedNotificationReuse && cached) {
    if (activeConfirmedNotificationKey === historyKey || isSnapshotVerifiedInCurrentMicrotask(cached)) {
      return cached;
    }
    if (
      cached.pendingSubscriberRender &&
      (typeof window === 'undefined' ||
        !window.localStorage ||
        window.localStorage.getItem === lastSeenStorageGetItem)
    ) {
      cached.pendingSubscriberRender = false;
      markSnapshotVerifiedForMicrotask(cached);
      return cached;
    }
  }

  const readRes = readStorageWithStats(historyKey);
  if (!readRes.success) {
    return cached ?? null;
  }

  const raw = readRes.value;
  if (raw === null || raw === undefined) {
    if (cached && cached.raw === null) {
      markSnapshotVerifiedForMicrotask(cached);
      return cached;
    }
    const emptySnap = createEmptySnapshot(null);
    setCachedSnapshot(historyKey, emptySnap);
    return emptySnap;
  }

  if (cached && cached.raw === raw) {
    markSnapshotVerifiedForMicrotask(cached);
    return cached;
  }

  const validatedMap = parseAndValidateHistoryJson(raw);
  if (validatedMap === null) {
    return cached ?? null;
  }

  const nextSnapshot = createSnapshotFromValidatedMap(raw, validatedMap);
  setCachedSnapshot(historyKey, nextSnapshot);
  return nextSnapshot;
}

/**
 * Reads the current persisted history map before applying a mutation.
 * Reuses the cached validated map when the raw storage string matches cached.raw,
 * incorporates external storage changes when raw differs, and returns null if reading
 * fails or storage contains corrupted JSON so mutations abort without losing data.
 */
function readHistoryBaseMapForWrite(historyKey: string): Readonly<PlaybackHistoryMap> | null {
  if (!historyKey) return null;

  const cached = getCachedSnapshot(historyKey);
  const readRes = readStorageWithStats(historyKey);
  if (!readRes.success) {
    return null;
  }

  const raw = readRes.value;
  if (raw === null || raw === undefined) {
    if (!cached || cached.raw !== null) {
      setCachedSnapshot(historyKey, createEmptySnapshot(null));
    }
    return EMPTY_HISTORY_MAP;
  }

  if (cached && cached.raw === raw) {
    return cached.map;
  }

  const validatedMap = parseAndValidateHistoryJson(raw);
  if (validatedMap === null) {
    return null;
  }

  const nextSnapshot = createSnapshotFromValidatedMap(raw, validatedMap);
  setCachedSnapshot(historyKey, nextSnapshot);
  return validatedMap;
}

/**
 * Commits an already-validated frozen map to localStorage, updates the in-memory snapshot
 * BEFORE notifying subscribers, and dispatches HISTORY_UPDATED_EVENT.
 * If saving to localStorage fails, preserves the previous confirmed snapshot and returns false.
 */
function commitValidatedHistoryMap(
  historyKey: string,
  frozenMap: Readonly<PlaybackHistoryMap>
): boolean {
  if (!historyKey) return false;

  const json = JSON.stringify(frozenMap);
  const success = writeStorageWithStats(historyKey, json);
  if (!success) {
    return false;
  }

  const nextSnapshot = createSnapshotFromValidatedMap(json, frozenMap);
  setCachedSnapshot(historyKey, nextSnapshot);

  const prevConfirmedKey = activeConfirmedNotificationKey;
  activeConfirmedNotificationKey = historyKey;
  try {
    notifyHistorySubscribers(historyKey, true);

    if (typeof window !== 'undefined') {
      try {
        window.dispatchEvent(
          new CustomEvent(HISTORY_UPDATED_EVENT, {
            detail: { historyKey, internalNotify: true },
          })
        );
      } catch {
        // ignore event dispatch errors
      }
    }
  } finally {
    activeConfirmedNotificationKey = prevConfirmedKey;
  }

  return true;
}

function ensureHistoryListeners(): void {
  if (areGlobalHistoryListenersAttached || typeof window === 'undefined') return;
  areGlobalHistoryListenersAttached = true;

  window.addEventListener(HISTORY_UPDATED_EVENT, (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (!detail || !detail.historyKey || detail.internalNotify) {
      return;
    }
    const targetKey = String(detail.historyKey);
    resolveSnapshotForRead(targetKey, false);
    notifyHistorySubscribers(targetKey, true);
  });

  window.addEventListener('storage', (e: StorageEvent) => {
    if (e.key === null) {
      historySnapshotCache.clear();
      const activeKeys = Array.from(historyListeners.keys());
      for (const key of activeKeys) {
        resolveSnapshotForRead(key, false);
        notifyHistorySubscribers(key, true);
      }
      return;
    }

    if (e.key.startsWith(HISTORY_KEY_PREFIX)) {
      const targetKey = e.key;
      const readRes = readStorageWithStats(targetKey);
      if (readRes.success) {
        const raw = readRes.value;
        if (raw === null || raw === undefined) {
          setCachedSnapshot(targetKey, createEmptySnapshot(null));
        } else {
          const cached = getCachedSnapshot(targetKey);
          if (!cached || cached.raw !== raw) {
            const validatedMap = parseAndValidateHistoryJson(raw);
            if (validatedMap !== null) {
              setCachedSnapshot(targetKey, createSnapshotFromValidatedMap(raw, validatedMap));
            }
          }
        }
      }
      notifyHistorySubscribers(targetKey, true);
    }
  });
}

/**
 * Derives the unique local history key for an Xtream account.
 * Uses getAccountKey formula but replaces favorites prefix with history prefix.
 * Returns "" if missing valid account credentials.
 */
export function getHistoryKey(
  serverUrl?: string | null,
  username?: string | null
): string {
  if (!serverUrl || !username) return '';
  const accountKey = getAccountKey(serverUrl, username);
  if (!accountKey) return '';
  return accountKey.replace('northcode_favorites_', HISTORY_KEY_PREFIX);
}

/**
 * Helper to build the combined key for a record: type:id
 */
export function getRecordKey(type: PlaybackType, id: string | number): string {
  return `${type}:${String(id)}`;
}

/**
 * Safely reads raw JSON string from localStorage and parses PlaybackHistoryMap.
 * Reuses the validated snapshot map when the persisted JSON string has not changed,
 * returning a shallow copy so external mutations never alter the shared snapshot.
 * Returns empty object {} if key is absent.
 * Returns null if localStorage read fails, throws, or JSON is corrupted/malformed.
 */
export function readHistoryMap(historyKey: string): PlaybackHistoryMap | null {
  if (!historyKey) return {};

  const cached = getCachedSnapshot(historyKey);
  const readRes = readStorageWithStats(historyKey);
  if (!readRes.success) {
    return null;
  }
  if (readRes.value === null || readRes.value === undefined) {
    if (!cached || cached.raw !== null) {
      setCachedSnapshot(historyKey, createEmptySnapshot(null));
    }
    return {};
  }

  const raw = readRes.value;
  if (cached && cached.raw === raw) {
    return { ...cached.map };
  }

  const validatedMap = parseAndValidateHistoryJson(raw);
  if (validatedMap === null) {
    return null;
  }

  const nextSnapshot = createSnapshotFromValidatedMap(raw, validatedMap);
  setCachedSnapshot(historyKey, nextSnapshot);
  return { ...validatedMap };
}

/**
 * Safely writes PlaybackHistoryMap to localStorage under historyKey.
 * Updates the confirmed snapshot before notifying subscribers and dispatching custom event.
 * Returns false if validation or writing fails, preserving the prior confirmed snapshot.
 */
export function writeHistoryMap(historyKey: string, map: PlaybackHistoryMap): boolean {
  if (!historyKey) return false;

  const validatedMap = validateAndFreezeHistoryMap(map);
  if (validatedMap === null) {
    return false;
  }

  return commitValidatedHistoryMap(historyKey, validatedMap);
}

/**
 * Records or updates a playback position in the active account's history.
 * Type + ID combination prevents collisions between movie/episode/live with same ID.
 * Preserves existing parentSeriesId if not supplied.
 * Aborts and returns false if reading existing history fails (returns null).
 */
export function recordPlaybackPosition(
  account: AccountIdentity | null | undefined,
  params: {
    id: string | number;
    type: PlaybackType;
    positionSec?: number;
    parentSeriesId?: string | number;
  }
): boolean {
  if (!account || !account.serverUrl || !account.username) return false;

  const historyKey = getHistoryKey(account.serverUrl, account.username);
  if (!historyKey) return false;

  const baseMap = readHistoryBaseMapForWrite(historyKey);
  if (baseMap === null) {
    // Read failed due to storage exception or corrupt JSON; abort to avoid data loss
    return false;
  }

  const strId = String(params.id);
  const recordKey = getRecordKey(params.type, strId);

  const existing = baseMap[recordKey];

  const parentSeriesId =
    params.parentSeriesId !== undefined && params.parentSeriesId !== null
      ? String(params.parentSeriesId)
      : existing?.parentSeriesId;

  const updatedRecord: PlaybackHistoryRecord = {
    id: strId,
    type: params.type,
    updatedAt: Date.now(),
    positionSec:
      params.positionSec !== undefined
        ? Math.floor(Math.max(0, params.positionSec))
        : existing?.positionSec,
    ...(parentSeriesId ? { parentSeriesId } : {}),
  };

  if (!isValidHistoryRecord(recordKey, updatedRecord)) {
    return false;
  }

  const nextMap: PlaybackHistoryMap = {
    ...baseMap,
    [recordKey]: Object.freeze(updatedRecord),
  };

  return commitValidatedHistoryMap(historyKey, Object.freeze(nextMap));
}

/**
 * Gets recorded playback positionSec for an item in the active account.
 * Reuses the validated account snapshot without re-parsing or sorting the history.
 * Returns 0 if missing or invalid.
 */
export function getItemProgress(
  account: AccountIdentity | null | undefined,
  type: PlaybackType,
  id: string | number
): number {
  if (!account || !account.serverUrl || !account.username) return 0;
  const historyKey = getHistoryKey(account.serverUrl, account.username);
  if (!historyKey) return 0;

  const snapshot = resolveSnapshotForRead(historyKey, true);
  if (!snapshot) return 0;

  const recordKey = getRecordKey(type, id);
  const record = snapshot.map[recordKey];

  return record?.positionSec || 0;
}

/**
 * Resets playback progress for an item to 0 in the active account ("Assistir do Início").
 * For episodes, preserves association with parentSeriesId.
 */
export function clearItemProgress(
  account: AccountIdentity | null | undefined,
  type: PlaybackType,
  id: string | number
): boolean {
  if (!account || !account.serverUrl || !account.username) return false;
  const historyKey = getHistoryKey(account.serverUrl, account.username);
  if (!historyKey) return false;

  const baseMap = readHistoryBaseMapForWrite(historyKey);
  if (baseMap === null) return false;

  const recordKey = getRecordKey(type, id);
  const existing = baseMap[recordKey];

  if (!existing) return true;

  const updatedRecord: PlaybackHistoryRecord = {
    ...existing,
    positionSec: 0,
    updatedAt: Date.now(),
  };

  if (!isValidHistoryRecord(recordKey, updatedRecord)) {
    return false;
  }

  const nextMap: PlaybackHistoryMap = {
    ...baseMap,
    [recordKey]: Object.freeze(updatedRecord),
  };

  return commitValidatedHistoryMap(historyKey, Object.freeze(nextMap));
}

/**
 * Gets a sorted array of playback records for the active account.
 * Reuses the snapshot's sorted list while the persisted history does not change.
 * Option to filter by type ('live', 'movie', 'episode').
 */
export function getHistoryRecords(
  account: AccountIdentity | null | undefined,
  typeFilter?: PlaybackType
): PlaybackHistoryRecord[] {
  if (!account || !account.serverUrl || !account.username) return EMPTY_HISTORY_RECORDS;
  const historyKey = getHistoryKey(account.serverUrl, account.username);
  if (!historyKey) return EMPTY_HISTORY_RECORDS;

  const snapshot = resolveSnapshotForRead(historyKey, true);
  if (!snapshot) return EMPTY_HISTORY_RECORDS;

  return getSortedRecordsFromSnapshot(snapshot, typeFilter);
}

/**
 * Gets the stable sorted records snapshot for a historyKey (used by useSyncExternalStore).
 */
export function getAccountHistorySnapshot(historyKey: string): PlaybackHistoryRecord[] {
  if (!historyKey) return EMPTY_HISTORY_RECORDS;
  const snapshot = resolveSnapshotForRead(historyKey, true);
  if (!snapshot) return EMPTY_HISTORY_RECORDS;
  return getSortedRecordsFromSnapshot(snapshot);
}

/**
 * React hook that subscribes to local playback history changes for the active account
 * using a shared, reference-stable snapshot via useSyncExternalStore.
 * Reacts immediately to same-tab writes, account switches, and multi-tab StorageEvents.
 */
export function useAccountPlaybackHistory(
  account: AccountIdentity | null | undefined
): PlaybackHistoryRecord[] {
  ensureHistoryListeners();

  const historyKey = useMemo(
    () => getHistoryKey(account?.serverUrl, account?.username),
    [account?.serverUrl, account?.username]
  );

  const subscribe = useCallback(
    (listener: () => void) => {
      if (!historyKey) {
        return () => {};
      }
      const listeners = getHistoryListeners(historyKey);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          historyListeners.delete(historyKey);
        }
      };
    },
    [historyKey]
  );

  const getSnapshot = useCallback(() => {
    if (!historyKey) return EMPTY_HISTORY_RECORDS;
    return getAccountHistorySnapshot(historyKey);
  }, [historyKey]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
