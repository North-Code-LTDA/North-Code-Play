import { useSyncExternalStore, useCallback } from 'react';

export interface FavoriteItem {
  id: string | number;
  name: string;
  cover: string;
  type: 'live' | 'movie' | 'series';
  extraData?: any;
}

const STORAGE_KEY = 'northcode_tv_favorites';

let memoryFavorites: FavoriteItem[] = loadFavoritesFromStorage();
const listeners = new Set<() => void>();

function loadFavoritesFromStorage(): FavoriteItem[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (e) {
    console.error('Failed to parse favorites from storage', e);
  }
  return memoryFavorites || [];
}

function saveFavoritesToStorage(favs: FavoriteItem[]): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(favs));
    return true;
  } catch (e) {
    console.error('Failed to save favorites to storage', e);
    return false;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return memoryFavorites;
}

// Window storage listener for cross-tab synchronization
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      const fresh = loadFavoritesFromStorage();
      memoryFavorites = fresh;
      listeners.forEach((fn) => fn());
    }
  });
}

export function useFavorites() {
  const favorites = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const toggleFavorite = useCallback((item: FavoriteItem) => {
    const current = memoryFavorites;
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

    saveFavoritesToStorage(updated);
    memoryFavorites = updated;
    listeners.forEach((fn) => fn());
  }, []);

  const isFavorite = useCallback(
    (id: string | number, type: 'live' | 'movie' | 'series') => {
      return favorites.some(
        (fav) => String(fav.id) === String(id) && fav.type === type
      );
    },
    [favorites]
  );

  const getFavoritesByType = useCallback(
    (type: 'live' | 'movie' | 'series') => {
      return favorites.filter((fav) => fav.type === type);
    },
    [favorites]
  );

  return {
    favorites,
    toggleFavorite,
    isFavorite,
    getFavoritesByType,
  };
}
