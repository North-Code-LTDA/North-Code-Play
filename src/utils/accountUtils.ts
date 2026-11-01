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

export interface StoredSessionState {
  canAutoLogin: boolean;
  isAuthRejected: boolean;
  authError: string | null;
  credentials: (XtreamCredentials & { authRejected?: boolean; authError?: string }) | null;
}

/**
 * Reads stored credentials and evaluates whether automatic session resumption to /home
 * should happen, or if the stored credentials were marked as rejected/expired by the provider
 * so the user can edit them on the Login screen without a redirect loop.
 */
export function readAutoLoginState(): StoredSessionState {
  const readRes = safeReadStorage(CREDENTIALS_KEY);
  if (!readRes.success || !readRes.value) {
    return {
      canAutoLogin: false,
      isAuthRejected: false,
      authError: null,
      credentials: null,
    };
  }

  try {
    const parsed = JSON.parse(readRes.value);
    if (!parsed || typeof parsed !== 'object') {
      return {
        canAutoLogin: false,
        isAuthRejected: false,
        authError: null,
        credentials: null,
      };
    }

    const hasRequiredFields =
      typeof parsed.serverUrl === 'string' &&
      parsed.serverUrl.trim().length > 0 &&
      typeof parsed.username === 'string' &&
      parsed.username.trim().length > 0 &&
      typeof parsed.password === 'string' &&
      parsed.password.length > 0;

    if (!hasRequiredFields) {
      return {
        canAutoLogin: false,
        isAuthRejected: false,
        authError: null,
        credentials: parsed,
      };
    }

    if (parsed.authRejected === true) {
      return {
        canAutoLogin: false,
        isAuthRejected: true,
        authError:
          typeof parsed.authError === 'string' && parsed.authError.trim()
            ? parsed.authError.trim()
            : 'Usuário ou senha inválidos ou conta expirada.',
        credentials: parsed,
      };
    }

    return {
      canAutoLogin: true,
      isAuthRejected: false,
      authError: null,
      credentials: parsed,
    };
  } catch {
    return {
      canAutoLogin: false,
      isAuthRejected: false,
      authError: null,
      credentials: null,
    };
  }
}

/**
 * Marks the currently stored credentials as rejected by the provider (invalid, disabled, or expired)
 * while preserving the user's serverUrl, username, playlistName, avatar, favorites, watch history,
 * and display/player preferences so the user can return to Login and fix their access data
 * without being auto-redirected back to /home.
 */
export function markCredentialsAuthRejected(
  reason: string = 'Usuário ou senha inválidos ou conta expirada.'
): boolean {
  const readRes = safeReadStorage(CREDENTIALS_KEY);
  if (!readRes.success || !readRes.value) {
    return false;
  }

  try {
    const parsed = JSON.parse(readRes.value);
    if (!parsed || typeof parsed !== 'object') {
      return false;
    }
    const updated = {
      ...parsed,
      authRejected: true,
      authError: reason,
    };
    return safeSetStorage(CREDENTIALS_KEY, JSON.stringify(updated));
  } catch {
    return false;
  }
}

/**
 * Safely saves credentials to localStorage, clearing any prior authRejected recovery flag.
 */
export function safeSaveCredentials(
  fullCredentials: XtreamCredentials
): { success: boolean; error?: string } {
  if (typeof window === 'undefined') return { success: false, error: 'window_unavailable' };

  const cleanCredentials: Record<string, any> = { ...fullCredentials };
  delete cleanCredentials.authRejected;
  delete cleanCredentials.authError;

  const ok = safeSetStorage(CREDENTIALS_KEY, JSON.stringify(cleanCredentials));
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

