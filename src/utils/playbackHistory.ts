import { useState, useEffect } from 'react';
import { getAccountKey, safeReadStorage, safeSetStorage } from './accountUtils';

export const HISTORY_KEY_PREFIX = 'northcode_history_';
export const HISTORY_UPDATED_EVENT = 'northcode_history_updated';

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
 * Returns empty object {} if key is absent.
 * Returns null if localStorage read fails, throws, or JSON is corrupted/malformed.
 */
export function readHistoryMap(historyKey: string): PlaybackHistoryMap | null {
  if (!historyKey) return {};

  const readRes = safeReadStorage(historyKey);
  if (!readRes.success) {
    return null;
  }
  if (readRes.value === null || readRes.value === undefined) {
    return {};
  }

  try {
    const parsed = JSON.parse(readRes.value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const validMap: PlaybackHistoryMap = {};
      for (const [k, item] of Object.entries(parsed)) {
        if (
          item &&
          typeof item === 'object' &&
          !Array.isArray(item) &&
          (item as any).id !== undefined &&
          (item as any).id !== null &&
          (item as any).id !== '' &&
          ((item as any).type === 'live' || (item as any).type === 'movie' || (item as any).type === 'episode')
        ) {
          validMap[k] = item as PlaybackHistoryRecord;
        }
      }
      return validMap;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Reads history map for a given account identity.
 * Returns null if read fails or throws exception.
 */
export function loadPlaybackHistory(identity: AccountIdentity | null | undefined): PlaybackHistoryMap | null {
  if (!identity || !identity.serverUrl || !identity.username) return {};
  const historyKey = getHistoryKey(identity.serverUrl, identity.username);
  if (!historyKey) return {};
  return readHistoryMap(historyKey);
}

/**
 * Safely writes PlaybackHistoryMap to localStorage under historyKey.
 * Dispatches custom event for same-tab reactive updates.
 * Returns false if writing fails.
 */
export function writeHistoryMap(historyKey: string, map: PlaybackHistoryMap): boolean {
  if (!historyKey) return false;

  const json = JSON.stringify(map);
  const success = safeSetStorage(historyKey, json);

  if (success && typeof window !== 'undefined') {
    try {
      window.dispatchEvent(
        new CustomEvent(HISTORY_UPDATED_EVENT, { detail: { historyKey } })
      );
    } catch {
      // ignore event dispatch errors
    }
  }

  return success;
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

  const historyMap = readHistoryMap(historyKey);
  if (historyMap === null) {
    // Read failed due to storage exception or corrupt JSON; abort to avoid data loss
    return false;
  }

  const strId = String(params.id);
  const recordKey = getRecordKey(params.type, strId);

  const existing = historyMap[recordKey];

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

  historyMap[recordKey] = updatedRecord;

  return writeHistoryMap(historyKey, historyMap);
}

/**
 * Gets recorded playback positionSec for an item in the active account.
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

  const historyMap = readHistoryMap(historyKey);
  if (!historyMap) return 0;

  const recordKey = getRecordKey(type, id);
  const record = historyMap[recordKey];

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

  const historyMap = readHistoryMap(historyKey);
  if (!historyMap) return false;

  const recordKey = getRecordKey(type, id);
  const existing = historyMap[recordKey];

  if (!existing) return true;

  historyMap[recordKey] = {
    ...existing,
    positionSec: 0,
    updatedAt: Date.now(),
  };

  return writeHistoryMap(historyKey, historyMap);
}

/**
 * Gets a sorted array of playback records for the active account.
 * Option to filter by type ('live', 'movie', 'episode').
 */
export function getHistoryRecords(
  account: AccountIdentity | null | undefined,
  typeFilter?: PlaybackType
): PlaybackHistoryRecord[] {
  if (!account || !account.serverUrl || !account.username) return [];
  const historyKey = getHistoryKey(account.serverUrl, account.username);
  if (!historyKey) return [];

  const historyMap = readHistoryMap(historyKey);
  if (!historyMap) return [];

  let records = Object.values(historyMap);

  if (typeFilter) {
    records = records.filter((r) => r.type === typeFilter);
  }

  return records.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * React hook that subscribes to local playback history changes for the active account.
 * Reacts immediately to same-tab writes and multi-tab StorageEvents.
 */
export function useAccountPlaybackHistory(account: AccountIdentity | null | undefined) {
  const [historyKey, setHistoryKey] = useState<string>(() =>
    getHistoryKey(account?.serverUrl, account?.username)
  );
  const [records, setRecords] = useState<PlaybackHistoryRecord[]>(() =>
    getHistoryRecords(account)
  );

  useEffect(() => {
    const key = getHistoryKey(account?.serverUrl, account?.username);
    setHistoryKey(key);
    setRecords(getHistoryRecords(account));
  }, [account?.serverUrl, account?.username]);

  useEffect(() => {
    if (!historyKey) {
      setRecords([]);
      return;
    }

    const refresh = () => {
      setRecords(getHistoryRecords(account));
    };

    const handleCustomEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.historyKey === historyKey) {
        refresh();
      }
    };

    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key === historyKey) {
        refresh();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener(HISTORY_UPDATED_EVENT, handleCustomEvent);
      window.addEventListener('storage', handleStorageEvent);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener(HISTORY_UPDATED_EVENT, handleCustomEvent);
        window.removeEventListener('storage', handleStorageEvent);
      }
    };
  }, [historyKey, account?.serverUrl, account?.username]);

  return records;
}
