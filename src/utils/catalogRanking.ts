/**
 * Extract a valid release year from item metadata or title.
 * Valid range: 1900 to currentYear + 1.
 */
export const getValidYear = (item: any): number => {
  if (!item) return 0;
  const currentMaxYear = new Date().getFullYear() + 1;

  // 1. Check direct year metadata (year, releaseDate, releasedate)
  const candidateYearMeta = item.year || item.releaseDate || item.releasedate;
  if (candidateYearMeta) {
    const strVal = String(candidateYearMeta).trim();
    const match = strVal.match(/\b(19\d\d|20\d{2})\b/);
    if (match) {
      const year = parseInt(match[0], 10);
      if (year >= 1900 && year <= currentMaxYear) {
        return year;
      }
    }
  }

  // 2. Fallback to extracting year from title name
  if (item.name) {
    const nameStr = String(item.name);
    const match = nameStr.match(/\b(19\d\d|20\d{2})\b/);
    if (match) {
      const year = parseInt(match[0], 10);
      if (year >= 1900 && year <= currentMaxYear) {
        return year;
      }
    }
  }

  return 0;
};

/**
 * Extract a valid rating float from item (0 if invalid/missing).
 */
export const getValidRating = (item: any): number => {
  if (!item || item.rating === null || item.rating === undefined || item.rating === '') return 0;
  const rating = parseFloat(item.rating);
  return isNaN(rating) || rating < 0 ? 0 : rating;
};

/**
 * Sort streams by Year and Rating without discarding items that lack year or rating.
 * Items with valid metadata (year or rating) come first, ordered by Year (desc) then Rating (desc).
 * Items without year/rating come after, preserving their relative order (stable sort).
 * Does NOT mutate the original array.
 */
export const sortByYearAndRating = <T = any>(streams: T[]): T[] => {
  if (!Array.isArray(streams) || streams.length === 0) return [];

  const copy = [...streams];

  return copy.sort((a, b) => {
    const yearA = getValidYear(a);
    const yearB = getValidYear(b);
    const ratingA = getValidRating(a);
    const ratingB = getValidRating(b);

    const hasMetaA = yearA > 0 || ratingA > 0;
    const hasMetaB = yearB > 0 || ratingB > 0;

    if (hasMetaA && hasMetaB) {
      if (yearA !== yearB) {
        return yearB - yearA;
      }
      return ratingB - ratingA;
    }

    if (hasMetaA && !hasMetaB) return -1;
    if (!hasMetaA && hasMetaB) return 1;

    return 0;
  });
};
