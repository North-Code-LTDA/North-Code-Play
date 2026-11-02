const YEAR_REGEX = /\b(19\d\d|20\d{2})\b/;

export interface CatalogRankingPerfStats {
  sortCalls: number;
  metadataExtractions: number;
  comparatorEvaluations: number;
}

const rankingPerfStats: CatalogRankingPerfStats = {
  sortCalls: 0,
  metadataExtractions: 0,
  comparatorEvaluations: 0,
};

export function getCatalogRankingPerfStats(): CatalogRankingPerfStats {
  return { ...rankingPerfStats };
}

export function resetCatalogRankingPerfStats(): void {
  rankingPerfStats.sortCalls = 0;
  rankingPerfStats.metadataExtractions = 0;
  rankingPerfStats.comparatorEvaluations = 0;
}

/**
 * Extract a valid release year from item metadata or title.
 * Valid range: 1900 to currentYear + 1.
 */
export const getValidYear = (item: any, maxYearOverride?: number): number => {
  if (!item) return 0;
  rankingPerfStats.metadataExtractions++;
  const currentMaxYear = maxYearOverride ?? new Date().getFullYear() + 1;

  // 1. Check direct year metadata (year, releaseDate, releasedate)
  const candidateYearMeta = item.year || item.releaseDate || item.releasedate;
  if (candidateYearMeta) {
    const strVal = String(candidateYearMeta).trim();
    const match = strVal.match(YEAR_REGEX);
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
    const match = nameStr.match(YEAR_REGEX);
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

interface DecoratedStream<T> {
  item: T;
  year: number;
  rating: number;
  hasMeta: boolean;
  idx: number;
}

/**
 * Sort streams by Year and Rating without discarding items that lack year or rating.
 * Items with valid metadata (year or rating) come first, ordered by Year (desc) then Rating (desc).
 * Items without year/rating come after, preserving their relative order (stable sort).
 * Precomputes year and rating once per item (O(N)) and does NOT mutate the original array.
 */
export const sortByYearAndRating = <T = any>(streams: T[]): T[] => {
  if (!Array.isArray(streams) || streams.length === 0) return [];
  rankingPerfStats.sortCalls++;

  const n = streams.length;
  if (n === 1) {
    return [streams[0]];
  }

  const currentMaxYear = new Date().getFullYear() + 1;
  const decorated = new Array<DecoratedStream<T>>(n);

  for (let i = 0; i < n; i++) {
    const item = streams[i];
    const year = getValidYear(item, currentMaxYear);
    const rating = getValidRating(item);
    decorated[i] = {
      item,
      year,
      rating,
      hasMeta: year > 0 || rating > 0,
      idx: i,
    };
  }

  decorated.sort((a, b) => {
    rankingPerfStats.comparatorEvaluations++;
    if (a.hasMeta && b.hasMeta) {
      if (a.year !== b.year) {
        return b.year - a.year;
      }
      if (b.rating !== a.rating) {
        return b.rating - a.rating;
      }
      return a.idx - b.idx;
    }

    if (a.hasMeta && !b.hasMeta) return -1;
    if (!a.hasMeta && b.hasMeta) return 1;

    return a.idx - b.idx;
  });

  const result = new Array<T>(n);
  for (let i = 0; i < n; i++) {
    result[i] = decorated[i].item;
  }
  return result;
};

