import { useSyncExternalStore, useCallback, useMemo } from 'react';
import { XtreamCredentials } from '../types';
import { useXtreamContext } from '../context/XtreamContext';
import {
  getAccountKey,
  safeGetStorage,
  safeSetStorage,
  bootstrapLegacyMigration,
  migrateOldKeyToV2,
  hasUnassignedLegacyFavorites,
  hasAmbiguousOldKeyFavorites,
  importUnassignedLegacyToAccount,
  importAmbiguousOldKeyToAccount,
  ImportResult,
} from '../utils/accountUtils';

export interface FavoriteItem {
  id: string | number;
  name: string;
  cover: string;
  type: 'live' | 'movie' | 'series';
  extraData?: any;
}

interface CacheEntry {
  raw: string | null;
  items: FavoriteItem[];
}

// In-memory stable cache per accountKey -> CacheEntry
const accountMemoryCache = new Map<string, CacheEntry>();

// Subscriptions per accountKey -> Set<() => void>
const accountListeners = new Map<string, Set<() => void>>();

// Empty fallback array with stable reference
const EMPTY_FAVORITES: FavoriteItem[] = [];

let isStorageListenerAttached = false;

function getAccountListeners(accountKey: string): Set<() => void> {
  let listeners = accountListeners.get(accountKey);
  if (!listeners) {
    listeners = new Set<() => void>();
    accountListeners.set(accountKey, listeners);
  }
  return listeners;
}

function notifyAccountSubscribers(accountKey: string) {
  const listeners = accountListeners.get(accountKey);
  if (listeners) {
    listeners.forEach((fn) => fn());
  }
}

/**
 * Gets cached favorites array for accountKey, updating cache only when raw storage string changes.
 * Guarantees reference stability for useSyncExternalStore.
 */
function getCachedFavoritesForAccount(accountKey: string): FavoriteItem[] {
  if (!accountKey) return EMPTY_FAVORITES;

  const raw = safeGetStorage(accountKey);
  const cached = accountMemoryCache.get(accountKey);

  if (cached && cached.raw === raw) {
    return cached.items;
  }

  if (raw === null || raw === undefined) {
    accountMemoryCache.set(accountKey, { raw: null, items: EMPTY_FAVORITES });
    return EMPTY_FAVORITES;
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const validItems: FavoriteItem[] = parsed.filter(
        (item) => item && item.id !== undefined && item.type
      );
      accountMemoryCache.set(accountKey, { raw, items: validItems });
      return validItems;
    }
  } catch (e) {
    console.error(`Failed to parse favorites JSON for account ${accountKey}`, e);
  }

  // Preserve previous items if JSON corrupt
  const fallback = cached ? cached.items : EMPTY_FAVORITES;
  accountMemoryCache.set(accountKey, { raw, items: fallback });
  return fallback;
}

/**
 * Saves favorites for an accountKey to localStorage and updates in-memory cache & subscribers
 */
function saveFavoritesForAccount(accountKey: string, favs: FavoriteItem[]): boolean {
  if (!accountKey) return false;

  const rawJson = JSON.stringify(favs);
  const previousEntry = accountMemoryCache.get(accountKey);

  const success = safeSetStorage(accountKey, rawJson);
  if (success) {
    accountMemoryCache.set(accountKey, { raw: rawJson, items: favs });
    notifyAccountSubscribers(accountKey);
    return true;
  } else {
    if (previousEntry) {
      accountMemoryCache.set(accountKey, previousEntry);
    } else {
      accountMemoryCache.delete(accountKey);
    }
    return false;
  }
}

/**
 * Attaches window storage event listener lazily
 */
function ensureStorageListener() {
  if (isStorageListenerAttached || typeof window === 'undefined') return;
  isStorageListenerAttached = true;

  window.addEventListener('storage', (e) => {
    if (!e.key) return;

    if (accountListeners.has(e.key)) {
      getCachedFavoritesForAccount(e.key);
      notifyAccountSubscribers(e.key);
    }
  });
}

/**
 * Hook to manage favorites per Xtream account.
 * Credentials can be passed explicitly or inferred from XtreamContext.
 */
export function useFavorites(overrideCredentials?: XtreamCredentials | null) {
  ensureStorageListener();

  // Try to read credentials from context if available
  let contextCreds: XtreamCredentials | null = null;
  try {
    const context = useXtreamContext();
    contextCreds = context.credentials;
  } catch {
    // Context not mounted, fallback to overrideCredentials or null
  }

  const activeCreds = overrideCredentials !== undefined ? overrideCredentials : contextCreds;

  const accountKey = useMemo(() => {
    return getAccountKey(activeCreds?.serverUrl, activeCreds?.username);
  }, [activeCreds?.serverUrl, activeCreds?.username]);

  // Run lazy migration when credentials/accountKey are available
  if (typeof window !== 'undefined' && activeCreds?.serverUrl && activeCreds?.username) {
    bootstrapLegacyMigration(accountKey);
    migrateOldKeyToV2(activeCreds.serverUrl, activeCreds.username);
  }

  const subscribe = useCallback(
    (listener: () => void) => {
      if (!accountKey) {
        return () => {};
      }
      const listeners = getAccountListeners(accountKey);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    [accountKey]
  );

  const getSnapshot = useCallback(() => {
    if (!accountKey) return EMPTY_FAVORITES;
    return getCachedFavoritesForAccount(accountKey);
  }, [accountKey]);

  const favorites = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const toggleFavorite = useCallback(
    (item: FavoriteItem): boolean => {
      if (!accountKey) {
        console.warn('Cannot toggle favorite: no active account key.');
        return false;
      }

      const current = getCachedFavoritesForAccount(accountKey);
      const exists = current.some(
        (fav) => String(fav.id) === String(item.id) && fav.type === item.type
      );

      let updated: FavoriteItem[];
      if (exists) {
        updated = current.filter(
          (fav) => !(String(fav.id) === String(item.id) && fav.type === item.type)
        );
      } else {
        updated = [item, ...current];
      }

      return saveFavoritesForAccount(accountKey, updated);
    },
    [accountKey]
  );

  const isFavorite = useCallback(
    (id: string | number, type: 'live' | 'movie' | 'series'): boolean => {
      if (!accountKey) return false;
      return favorites.some(
        (fav) => String(fav.id) === String(id) && fav.type === type
      );
    },
    [accountKey, favorites]
  );

  const getFavoritesByType = useCallback(
    (type: 'live' | 'movie' | 'series'): FavoriteItem[] => {
      if (!accountKey) return EMPTY_FAVORITES;
      return favorites.filter((fav) => fav.type === type);
    },
    [accountKey, favorites]
  );

  const canImportLegacy = useMemo(() => {
    return Boolean(accountKey) && hasUnassignedLegacyFavorites(accountKey);
  }, [accountKey, favorites]);

  const canImportAmbiguousOldKey = useMemo(() => {
    return (
      Boolean(activeCreds?.serverUrl) &&
      Boolean(activeCreds?.username) &&
      hasAmbiguousOldKeyFavorites(activeCreds?.serverUrl, activeCreds?.username)
    );
  }, [activeCreds?.serverUrl, activeCreds?.username, favorites]);

  const importLegacyFavorites = useCallback((): ImportResult => {
    if (!accountKey) return { success: false, reason: 'invalid_key', importedCount: 0 };
    const res = importUnassignedLegacyToAccount(accountKey);
    if (res.success) {
      getCachedFavoritesForAccount(accountKey);
      notifyAccountSubscribers(accountKey);
    }
    return res;
  }, [accountKey]);

  const importAmbiguousOldKeyFavorites = useCallback((): ImportResult => {
    if (!activeCreds?.serverUrl || !activeCreds?.username) {
      return { success: false, reason: 'invalid_key', importedCount: 0 };
    }
    const res = importAmbiguousOldKeyToAccount(activeCreds.serverUrl, activeCreds.username);
    if (res.success) {
      getCachedFavoritesForAccount(accountKey);
      notifyAccountSubscribers(accountKey);
    }
    return res;
  }, [accountKey, activeCreds?.serverUrl, activeCreds?.username]);

  return {
    favorites,
    toggleFavorite,
    isFavorite,
    getFavoritesByType,
    accountKey,
    canImportLegacy,
    canImportAmbiguousOldKey,
    importLegacyFavorites,
    importAmbiguousOldKeyFavorites,
  };
}
