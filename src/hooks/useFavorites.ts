import { useSyncExternalStore, useCallback, useMemo, useEffect } from 'react';
import { XtreamCredentials } from '../types';
import { useXtreamContext } from '../context/XtreamContext';
import {
  getAccountKey,
  safeGetStorage,
  readAccountEnvelope,
  writeAccountEnvelope,
  bootstrapLegacyMigration,
  migrateOldKeyToV2,
  hasUnassignedLegacyFavorites,
  hasAmbiguousOldKeyFavorites,
  importUnassignedLegacyToAccount,
  importAmbiguousOldKeyToAccount,
  ImportResult,
  MIGRATION_STATUS_KEY,
  SOURCE_REGISTRY_KEY,
  LEGACY_FAVORITES_KEY,
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

export function notifyAccountSubscribers(accountKey: string) {
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

  const envelope = readAccountEnvelope(accountKey);
  if (envelope.isMalformed) {
    // Preserve previous cached items if storage JSON is malformed
    const fallback = cached ? cached.items : EMPTY_FAVORITES;
    accountMemoryCache.set(accountKey, { raw, items: fallback });
    return fallback;
  }

  const validItems: FavoriteItem[] = envelope.items.filter(
    (item) => item && item.id !== undefined && item.type
  );

  accountMemoryCache.set(accountKey, { raw, items: validItems });
  return validItems;
}

/**
 * Saves favorites for an accountKey to localStorage using versioned envelope and updates in-memory cache & subscribers
 */
function saveFavoritesForAccount(accountKey: string, favs: FavoriteItem[]): boolean {
  if (!accountKey) return false;

  const previousEntry = accountMemoryCache.get(accountKey);
  const ok = writeAccountEnvelope(accountKey, favs);

  if (ok) {
    const raw = safeGetStorage(accountKey);
    accountMemoryCache.set(accountKey, { raw, items: favs });
    notifyAccountSubscribers(accountKey);
    return true;
  } else {
    // Revert cache if storage write failed (e.g. QuotaExceededError or corrupt target)
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
    // Storage cleared in another tab or test environment (key === null)
    if (e.key === null) {
      accountMemoryCache.clear();
      accountListeners.forEach((listeners) => {
        listeners.forEach((fn) => fn());
      });
      return;
    }

    if (accountListeners.has(e.key)) {
      getCachedFavoritesForAccount(e.key);
      notifyAccountSubscribers(e.key);
    }

    // Global metadata or legacy changed
    if (
      e.key === MIGRATION_STATUS_KEY ||
      e.key === SOURCE_REGISTRY_KEY ||
      e.key === LEGACY_FAVORITES_KEY
    ) {
      accountListeners.forEach((listeners) => {
        listeners.forEach((fn) => fn());
      });
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

  // Run lazy migration outside of render body via useEffect
  useEffect(() => {
    if (typeof window !== 'undefined' && activeCreds?.serverUrl && activeCreds?.username && accountKey) {
      bootstrapLegacyMigration(accountKey);
      migrateOldKeyToV2(activeCreds.serverUrl, activeCreds.username);
    }
  }, [accountKey, activeCreds?.serverUrl, activeCreds?.username]);

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
      if (!item || item.id === undefined || !item.type) {
        return false;
      }

      const env = readAccountEnvelope(accountKey);
      if (env.isMalformed) {
        return false;
      }

      const current = getCachedFavoritesForAccount(accountKey);
      const exists = current.some(
        (fav) => fav && String(fav.id) === String(item.id) && fav.type === item.type
      );

      let updated: FavoriteItem[];
      if (exists) {
        updated = current.filter(
          (fav) => !(fav && String(fav.id) === String(item.id) && fav.type === item.type)
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
        (fav) => fav && String(fav.id) === String(id) && fav.type === type
      );
    },
    [accountKey, favorites]
  );

  const getFavoritesByType = useCallback(
    (type: 'live' | 'movie' | 'series'): FavoriteItem[] => {
      if (!accountKey) return EMPTY_FAVORITES;
      return favorites.filter((fav) => fav && fav.type === type);
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
      hasAmbiguousOldKeyFavorites(activeCreds?.serverUrl, activeCreds?.username, accountKey)
    );
  }, [activeCreds?.serverUrl, activeCreds?.username, accountKey, favorites]);

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
