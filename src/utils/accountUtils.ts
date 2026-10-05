import { XtreamCredentials } from '../types';
import { normalizeServerUrl } from './mediaUtils';

export const FAVORITES_KEY_PREFIX = 'northcode_favorites_';
export const CREDENTIALS_KEY = 'northcode_tv_credentials';

export interface FavoriteItem {
  id: string | number;
  name: string;
  cover: string;
  type: 'live' | 'movie' | 'series';
  extraData?: any;
}

/**
 * Derives the unique local favorites key for an Xtream account.
 * Key formula: northcode_favorites_ + encodeURIComponent(JSON.stringify([normalizedServerUrl, effectiveUsername]))
 *
 * Rules:
 * - serverUrl is normalized via normalizeServerUrl (handles protocol, port, trailing slashes, base path)
 * - username is trimmed, preserving original casing
 * - password, list name, avatar, or session tokens do NOT alter identity
 * - Returns "" if serverUrl or username is missing/empty
 */
export function getFavoritesKey(
  serverUrl?: string | null,
  username?: string | null
): string {
  if (!serverUrl || !username) return '';

  const normServer = normalizeServerUrl(serverUrl);
  const cleanUser = username.trim();

  if (!normServer || !cleanUser) return '';

  const tupleJson = JSON.stringify([normServer, cleanUser]);
  return `${FAVORITES_KEY_PREFIX}${encodeURIComponent(tupleJson)}`;
}

// Alias for backwards compatibility across components
export const getAccountKey = getFavoritesKey;

export interface StorageReadResult {
  success: boolean;
  value: string | null;
  error?: any;
}

/**
 * Safely reads raw string from localStorage, explicitly distinguishing between:
 * - A missing key: { success: true, value: null }
 * - A read failure/exception: { success: false, value: null, error: ... }
 */
export function safeReadStorage(key: string): StorageReadResult {
  if (typeof window === 'undefined') {
    return { success: false, value: null, error: 'window_unavailable' };
  }
  try {
    const value = window.localStorage.getItem(key);
    return { success: true, value };
  } catch (e) {
    console.warn(`[safeReadStorage] Error reading key "${key}":`, e);
    return { success: false, value: null, error: e };
  }
}

/**
 * Safely reads raw string from localStorage without throwing
 */
export function safeGetStorage(key: string): string | null {
  const res = safeReadStorage(key);
  return res.success ? res.value : null;
}

/**
 * Safely writes string to localStorage without throwing
 */
export function safeSetStorage(key: string, value: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (e) {
    console.error(`[safeSetStorage] Error writing key "${key}":`, e);
    return false;
  }
}

export interface StoredFavoritesResult {
  success: boolean;
  items: FavoriteItem[];
  raw: string | null;
  error?: any;
}

/**
 * Safely parses raw JSON string into FavoriteItem[].
 * Returns empty array if null, empty string, or invalid JSON.
 */
export function parseFavoritesJson(raw: string | null): FavoriteItem[] {
  if (raw === null || raw.trim() === '') {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item) => item && item.id !== undefined && item.type
      );
    }
  } catch {
    // Malformed JSON returns empty list cleanly
  }

  return [];
}

/**
 * Reads stored favorites array for an account key.
 * Distinguishes between read failure (success: false) and absent/empty key (success: true, items: []).
 */
export function readStoredFavorites(accountKey: string): StoredFavoritesResult {
  if (!accountKey) return { success: false, items: [], raw: null };

  const readRes = safeReadStorage(accountKey);
  if (!readRes.success) {
    return { success: false, items: [], raw: null, error: readRes.error };
  }

  const raw = readRes.value;
  return { success: true, items: parseFavoritesJson(raw), raw };
}

/**
 * Reads stored favorites array for an account key.
 * Returns empty array if key does not exist or JSON is invalid.
 */
export function getStoredFavorites(accountKey: string): FavoriteItem[] {
  const res = readStoredFavorites(accountKey);
  return res.items;
}

/**
 * Writes favorites array directly to account key in localStorage as JSON array.
 */
export function setStoredFavorites(accountKey: string, favs: FavoriteItem[]): boolean {
  if (!accountKey) return false;
  return safeSetStorage(accountKey, JSON.stringify(favs));
}

/**
 * Safely saves credentials to localStorage.
 */
export function safeSaveCredentials(
  fullCredentials: XtreamCredentials
): { success: boolean; error?: string } {
  if (typeof window === 'undefined') return { success: false, error: 'window_unavailable' };

  const ok = safeSetStorage(CREDENTIALS_KEY, JSON.stringify(fullCredentials));
  if (!ok) {
    return { success: false, error: 'storage_failure' };
  }
  return { success: true };
}

/**
 * Safely removes credentials from localStorage on logout.
 */
export function safeRemoveCredentials(): { success: boolean; error?: string } {
  if (typeof window === 'undefined') return { success: false, error: 'window_unavailable' };

  try {
    window.localStorage.removeItem(CREDENTIALS_KEY);
    return { success: true };
  } catch {
    return { success: false, error: 'storage_failure' };
  }
}
