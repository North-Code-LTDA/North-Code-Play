import { useState, useEffect } from 'react';

export interface FavoriteItem {
  id: string | number;
  name: string;
  cover: string;
  type: 'live' | 'movie' | 'series';
  extraData?: any; // For any extra info like rating, category, etc.
}

export function useFavorites() {
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem('northcode_tv_favorites');
    if (stored) {
      try {
        setFavorites(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to parse favorites', e);
      }
    }
  }, []);

  const toggleFavorite = (item: FavoriteItem) => {
    setFavorites((prev) => {
      const exists = prev.some((fav) => String(fav.id) === String(item.id) && fav.type === item.type);
      let updated;
      if (exists) {
        updated = prev.filter((fav) => !(String(fav.id) === String(item.id) && fav.type === item.type));
      } else {
        updated = [item, ...prev];
      }
      localStorage.setItem('northcode_tv_favorites', JSON.stringify(updated));
      return updated;
    });
  };

  const isFavorite = (id: string | number, type: 'live' | 'movie' | 'series') => {
    return favorites.some((fav) => String(fav.id) === String(id) && fav.type === type);
  };

  const getFavoritesByType = (type: 'live' | 'movie' | 'series') => {
    return favorites.filter(fav => fav.type === type);
  };

  return {
    favorites,
    toggleFavorite,
    isFavorite,
    getFavoritesByType
  };
}
