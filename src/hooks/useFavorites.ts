import { useSyncExternalStore, useCallback, useMemo, useState } from 'react';
import { XtreamCredentials } from '../types';
import { useXtreamContext } from '../context/XtreamContext';
import {
  getFavoritesKey,
  safeReadStorage,
  readStoredFavorites,
  parseFavoritesJson,
  setStoredFavorites,
  FavoriteItem,
  FAVORITES_KEY_PREFIX,
} from '../utils/accountUtils';

export type { FavoriteItem };

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
 * Uses a SINGLE read of localStorage to avoid race conditions or inconsistent states.
 * Guarantees reference stability for useSyncExternalStore.
 */
export function getCachedFavoritesForAccount(accountKey: string): FavoriteItem[] {
  if (!accountKey) return EMPTY_FAVORITES;

  // Single read of localStorage
  const readRes = safeReadStorage(accountKey);
  const cached = accountMemoryCache.get(accountKey);

  // If reading threw an error, preserve cached items if present, or EMPTY_FAVORITES.
  // Never alter or wipe out the cache on a storage read error.
  if (!readRes.success) {
    return cached ? cached.items : EMPTY_FAVORITES;
  }

  const raw = readRes.value;

  // If raw string matches cache, return cached items (stable reference for useSyncExternalStore)
  if (cached && cached.raw === raw) {
    return cached.items;
  }

  // Key absent from localStorage or empty string represents valid empty list
  if (raw === null || raw.trim() === '') {
    accountMemoryCache.set(accountKey, { raw: null, items: EMPTY_FAVORITES });
    return EMPTY_FAVORITES;
  }

  // Deserialize items directly from the raw string obtained in the single read above (no second read!)
  const items = parseFavoritesJson(raw);
  accountMemoryCache.set(accountKey, { raw, items });
  return items;
}

/**
 * Saves favorites for an accountKey to localStorage and updates in-memory cache & subscribers.
 * If storage write fails, cache is reverted and false is returned.
 */
function saveFavoritesForAccount(accountKey: string, favs: FavoriteItem[]): boolean {
  if (!accountKey) return false;

  const previousEntry = accountMemoryCache.get(accountKey);
  const ok = setStoredFavorites(accountKey, favs);

  if (ok) {
    const raw = JSON.stringify(favs);
    accountMemoryCache.set(accountKey, { raw, items: favs });
    notifyAccountSubscribers(accountKey);
    return true;
  } else {
    // Revert cache if storage write failed
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
    // Storage cleared in another tab (key === null)
    if (e.key === null) {
      accountMemoryCache.clear();
      accountListeners.forEach((listeners) => {
        listeners.forEach((fn) => fn());
      });
      return;
    }

    // Only update if key belongs to North Code favorites
    if (e.key.startsWith(FAVORITES_KEY_PREFIX) && accountListeners.has(e.key)) {
      notifyAccountSubscribers(e.key);
    }
  });
}

/**
 * Hook to manage simple local favorites per Xtream account.
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
    return getFavoritesKey(activeCreds?.serverUrl, activeCreds?.username);
  }, [activeCreds?.serverUrl, activeCreds?.username]);

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

  const [favoriteError, setFavoriteError] = useState<string | null>(null);

  const clearFavoriteError = useCallback(() => {
    setFavoriteError(null);
  }, []);

  const toggleFavorite = useCallback(
    (item: FavoriteItem): boolean => {
      if (!accountKey) {
        console.warn('Cannot toggle favorite: no active account key.');
        setFavoriteError('Não foi possível salvar os favoritos neste dispositivo. Tente novamente.');
        return false;
      }
      if (!item || item.id === undefined || !item.type) {
        return false;
      }

      // CRITICAL: Freshly read from storage to verify read succeeds and avoid overwriting on read failure!
      const readRes = readStoredFavorites(accountKey);
      if (!readRes.success) {
        console.warn('[toggleFavorite] Storage read failed for accountKey, aborting toggle to protect data.');
        setFavoriteError('Não foi possível salvar os favoritos neste dispositivo. Tente novamente.');
        return false;
      }

      const current = readRes.items;
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

      const ok = saveFavoritesForAccount(accountKey, updated);
      if (!ok) {
        setFavoriteError('Não foi possível salvar os favoritos neste dispositivo. Tente novamente.');
        return false;
      }

      setFavoriteError(null);
      return true;
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

  return {
    favorites,
    toggleFavorite,
    isFavorite,
    getFavoritesByType,
    accountKey,
    favoriteError,
    clearFavoriteError,
  };
}
