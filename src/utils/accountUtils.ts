import { XtreamCredentials, XtreamUserInfo } from '../types';
import { normalizeAllowedOutputFormats, normalizeServerUrl } from './mediaUtils';

export const FAVORITES_KEY_PREFIX = 'northcode_favorites_';
export const CREDENTIALS_KEY = 'northcode_tv_credentials';

export interface FavoriteItem {
  id: string | number;
  name: string;
  cover: string;
  type: 'live' | 'movie' | 'series';
  extraData?: any;
}

export interface FormattedAccountExpiration {
  label: string;
  isAvailable: boolean;
  isExpired: boolean;
  timestampMs?: number;
}

export interface FormattedAccountStatus {
  label: string;
  isAvailable: boolean;
  tone: 'active' | 'inactive' | 'neutral';
}

export interface FormattedAccountConnections {
  activeText: string | null;
  maxText: string | null;
  displayText: string;
  isAvailable: boolean;
}

/**
 * Extracts non-sensitive account metadata from an Xtream `user_info` object for persistence
 * without duplicating password or fabricating absent fields.
 */
export function extractPersistableUserInfo(
  rawUserInfo: unknown
): XtreamUserInfo | undefined {
  if (!rawUserInfo || typeof rawUserInfo !== 'object' || Array.isArray(rawUserInfo)) {
    return undefined;
  }

  const src = rawUserInfo as Record<string, unknown>;
  const safeInfo: XtreamUserInfo = {};
  let hasField = false;

  const copyIfDefined = (key: keyof XtreamUserInfo) => {
    const val = src[key as string];
    if (val !== undefined && val !== null) {
      safeInfo[key] = val as any;
      hasField = true;
    }
  };

  copyIfDefined('username');
  copyIfDefined('status');
  copyIfDefined('exp_date');
  copyIfDefined('active_cons');
  copyIfDefined('max_connections');
  copyIfDefined('is_trial');
  copyIfDefined('created_at');
  copyIfDefined('message');

  const normalizedFormats = normalizeAllowedOutputFormats(src.allowed_output_formats);
  if (normalizedFormats !== undefined) {
    safeInfo.allowed_output_formats = normalizedFormats;
    hasField = true;
  }

  return hasField ? safeInfo : undefined;
}

/**
 * Parses a non-negative integer connection count (numeric or textual).
 * Returns null when absent, null, empty, or invalid — never turns missing values into "0".
 */
export function parseConnectionCount(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      return null;
    }
    return String(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || !/^\d+$/.test(trimmed)) {
      return null;
    }
    return String(parseInt(trimmed, 10));
  }
  return null;
}

/**
 * Formats account expiration date from numeric or textual Unix timestamps (seconds or milliseconds)
 * or valid ISO/date strings. Never presents missing/null exp_date as confirmed lifetime access.
 */
export function formatAccountExpiration(
  expDate: unknown,
  nowMs: number = Date.now()
): FormattedAccountExpiration {
  if (expDate === null || expDate === undefined) {
    return { label: 'Indisponível', isAvailable: false, isExpired: false };
  }

  let timestampMs: number | null = null;

  if (typeof expDate === 'number') {
    if (!Number.isFinite(expDate) || expDate <= 0) {
      return { label: 'Indisponível', isAvailable: false, isExpired: false };
    }
    timestampMs = expDate >= 1e11 ? expDate : expDate * 1000;
  } else if (typeof expDate === 'string') {
    const trimmed = expDate.trim();
    if (!trimmed) {
      return { label: 'Indisponível', isAvailable: false, isExpired: false };
    }
    const lower = trimmed.toLowerCase();
    if (
      lower === 'null' ||
      lower === 'undefined' ||
      lower === 'none' ||
      lower === 'n/a' ||
      lower === 'unlimited' ||
      lower === '0' ||
      lower === '-1'
    ) {
      return { label: 'Indisponível', isAvailable: false, isExpired: false };
    }

    if (/^\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      if (!Number.isFinite(num) || num <= 0) {
        return { label: 'Indisponível', isAvailable: false, isExpired: false };
      }
      timestampMs = num >= 1e11 ? num : num * 1000;
    } else {
      const ymdMatch = trimmed.match(
        /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/
      );
      if (ymdMatch) {
        const year = Number(ymdMatch[1]);
        const month = Number(ymdMatch[2]);
        const day = Number(ymdMatch[3]);
        const hour = ymdMatch[4] ? Number(ymdMatch[4]) : 12;
        const min = ymdMatch[5] ? Number(ymdMatch[5]) : 0;
        const sec = ymdMatch[6] ? Number(ymdMatch[6]) : 0;
        const d = new Date(year, month - 1, day, hour, min, sec);
        if (
          d.getFullYear() === year &&
          d.getMonth() === month - 1 &&
          d.getDate() === day
        ) {
          timestampMs = d.getTime();
        }
      } else {
        const parsedMs = Date.parse(trimmed);
        if (Number.isFinite(parsedMs)) {
          timestampMs = parsedMs;
        }
      }
    }
  } else {
    return { label: 'Indisponível', isAvailable: false, isExpired: false };
  }

  if (timestampMs === null || !Number.isFinite(timestampMs)) {
    return { label: 'Indisponível', isAvailable: false, isExpired: false };
  }

  const date = new Date(timestampMs);
  const year = date.getFullYear();
  if (Number.isNaN(date.getTime()) || year < 1970 || year > 2150) {
    return { label: 'Indisponível', isAvailable: false, isExpired: false };
  }

  const formattedDate = date.toLocaleDateString('pt-BR');
  const isExpired = timestampMs < nowMs;
  return {
    label: isExpired ? `Expirou em ${formattedDate}` : `Expira em ${formattedDate}`,
    isAvailable: true,
    isExpired,
    timestampMs,
  };
}

const KNOWN_STATUS_MAP: Record<
  string,
  { label: string; tone: 'active' | 'inactive' | 'neutral' }
> = {
  active: { label: 'Ativa', tone: 'active' },
  ativa: { label: 'Ativa', tone: 'active' },
  expired: { label: 'Expirada', tone: 'inactive' },
  expirada: { label: 'Expirada', tone: 'inactive' },
  disabled: { label: 'Desativada', tone: 'inactive' },
  desativada: { label: 'Desativada', tone: 'inactive' },
  banned: { label: 'Banida', tone: 'inactive' },
  banida: { label: 'Banida', tone: 'inactive' },
  inactive: { label: 'Inativa', tone: 'inactive' },
  inativa: { label: 'Inativa', tone: 'inactive' },
  suspended: { label: 'Suspensa', tone: 'inactive' },
  suspensa: { label: 'Suspensa', tone: 'inactive' },
  blocked: { label: 'Bloqueada', tone: 'inactive' },
  bloqueada: { label: 'Bloqueada', tone: 'inactive' },
  trial: { label: 'Teste', tone: 'neutral' },
};

export function formatAccountStatus(status: unknown): FormattedAccountStatus {
  if (typeof status !== 'string') {
    return { label: 'Indisponível', isAvailable: false, tone: 'neutral' };
  }
  const trimmed = status.trim();
  if (!trimmed || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'undefined') {
    return { label: 'Indisponível', isAvailable: false, tone: 'neutral' };
  }

  const mapped = KNOWN_STATUS_MAP[trimmed.toLowerCase()];
  if (mapped) {
    return { label: mapped.label, isAvailable: true, tone: mapped.tone };
  }

  return { label: trimmed, isAvailable: true, tone: 'neutral' };
}

/**
 * Formats active connections and max connection limit strictly from confirmed provider values.
 * Never displays missing `active_cons` as 0 or invents `max_connections`.
 */
export function formatAccountConnections(
  activeCons: unknown,
  maxConnections: unknown
): FormattedAccountConnections {
  const activeText = parseConnectionCount(activeCons);
  const maxText = parseConnectionCount(maxConnections);

  if (activeText !== null && maxText !== null) {
    return {
      activeText,
      maxText,
      displayText: `${activeText} / ${maxText}`,
      isAvailable: true,
    };
  }

  if (activeText !== null) {
    return {
      activeText,
      maxText: null,
      displayText: `${activeText} / Indisponível`,
      isAvailable: true,
    };
  }

  if (maxText !== null) {
    return {
      activeText: null,
      maxText,
      displayText: `Indisponível / ${maxText}`,
      isAvailable: true,
    };
  }

  return {
    activeText: null,
    maxText: null,
    displayText: 'Indisponível',
    isAvailable: false,
  };
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

