import { getValidYear, getValidRating, sortByYearAndRating } from './catalogRanking';
import { groupLiveStreams, LiveChannelGroup } from './liveChannelGroups';

export interface CatalogIndexPerfStats {
  vodIndexBuilds: number;
  seriesIndexBuilds: number;
  liveIndexBuilds: number;
  categoryLookups: number;
  idLookups: number;
  heroComputations: number;
}

const indexPerfStats: CatalogIndexPerfStats = {
  vodIndexBuilds: 0,
  seriesIndexBuilds: 0,
  liveIndexBuilds: 0,
  categoryLookups: 0,
  idLookups: 0,
  heroComputations: 0,
};

export function getCatalogIndexPerfStats(): CatalogIndexPerfStats {
  return { ...indexPerfStats };
}

export function resetCatalogIndexPerfStats(): void {
  indexPerfStats.vodIndexBuilds = 0;
  indexPerfStats.seriesIndexBuilds = 0;
  indexPerfStats.liveIndexBuilds = 0;
  indexPerfStats.categoryLookups = 0;
  indexPerfStats.idLookups = 0;
  indexPerfStats.heroComputations = 0;
}

export interface RankedCatalogIndex<T> {
  readonly source: T[];
  readonly byId: Map<string, T>;
  readonly byCategoryId: Map<string, T[]>;
  getByCategory(categoryId: string | number | undefined | null): T[];
  getById(id: string | number | undefined | null): T | undefined;
  getSortedAll(): T[];
  getSortedByCategory(categoryId: string | number | undefined | null): T[];
}

export interface LiveCatalogIndex<T = any> {
  readonly source: T[];
  readonly byId: Map<string, T>;
  readonly byCategoryId: Map<string, T[]>;
  getByCategory(categoryId: string | number | undefined | null): T[];
  getById(id: string | number | undefined | null): T | undefined;
  getGroupsByCategory(categoryId: string | number | undefined | null): LiveChannelGroup[];
  getAllGroups(): LiveChannelGroup[];
}

const vodIndexCache = new WeakMap<any[], RankedCatalogIndex<any>>();
const seriesIndexCache = new WeakMap<any[], RankedCatalogIndex<any>>();
const liveIndexCache = new WeakMap<any[], LiveCatalogIndex<any>>();

function createRankedCatalogIndex<T extends Record<string, any>>(
  items: T[],
  idField: 'stream_id' | 'series_id',
  domain: 'vod' | 'series'
): RankedCatalogIndex<T> {
  const safeItems = Array.isArray(items) ? items : [];
  if (domain === 'vod') {
    indexPerfStats.vodIndexBuilds++;
  } else {
    indexPerfStats.seriesIndexBuilds++;
  }

  const byId = new Map<string, T>();
  const byCategoryId = new Map<string, T[]>();

  for (let i = 0; i < safeItems.length; i++) {
    const item = safeItems[i];
    if (!item || typeof item !== 'object') continue;

    const rawId = item[idField] ?? item.id;
    if (rawId !== undefined && rawId !== null && rawId !== '') {
      const idKey = String(rawId);
      if (!byId.has(idKey)) {
        byId.set(idKey, item);
      }
    }

    const catKey = String(item.category_id ?? '');
    let bucket = byCategoryId.get(catKey);
    if (!bucket) {
      bucket = [];
      byCategoryId.set(catKey, bucket);
    }
    bucket.push(item);
  }

  let sortedAllCache: T[] | null = null;
  let sortedAllYear = 0;
  const sortedByCategoryCache = new Map<string, { year: number; sorted: T[] }>();

  return {
    source: safeItems,
    byId,
    byCategoryId,
    getByCategory(categoryId) {
      indexPerfStats.categoryLookups++;
      if (categoryId === undefined || categoryId === null) return [];
      return byCategoryId.get(String(categoryId)) || [];
    },
    getById(id) {
      indexPerfStats.idLookups++;
      if (id === undefined || id === null || id === '') return undefined;
      return byId.get(String(id));
    },
    getSortedAll() {
      const maxYear = new Date().getFullYear() + 1;
      if (!sortedAllCache || sortedAllYear !== maxYear) {
        sortedAllCache = sortByYearAndRating(safeItems);
        sortedAllYear = maxYear;
      }
      return sortedAllCache;
    },
    getSortedByCategory(categoryId) {
      indexPerfStats.categoryLookups++;
      if (categoryId === undefined || categoryId === null) return [];
      const key = String(categoryId);
      const maxYear = new Date().getFullYear() + 1;
      const existing = sortedByCategoryCache.get(key);
      if (existing && existing.year === maxYear) {
        return existing.sorted;
      }
      const rawCat = byCategoryId.get(key) || [];
      const sorted = rawCat.length > 0 ? sortByYearAndRating(rawCat) : [];
      sortedByCategoryCache.set(key, { year: maxYear, sorted });
      return sorted;
    },
  };
}

export function getOrCreateVodIndex<T = any>(vodStreams: T[]): RankedCatalogIndex<T> {
  const safe = Array.isArray(vodStreams) ? vodStreams : [];
  const cached = vodIndexCache.get(safe);
  if (cached) return cached;
  const created = createRankedCatalogIndex(safe as any[], 'stream_id', 'vod');
  vodIndexCache.set(safe, created);
  return created;
}

export function getOrCreateSeriesIndex<T = any>(seriesStreams: T[]): RankedCatalogIndex<T> {
  const safe = Array.isArray(seriesStreams) ? seriesStreams : [];
  const cached = seriesIndexCache.get(safe);
  if (cached) return cached;
  const created = createRankedCatalogIndex(safe as any[], 'series_id', 'series');
  seriesIndexCache.set(safe, created);
  return created;
}

export function getOrCreateLiveIndex<T = any>(liveStreams: T[]): LiveCatalogIndex<T> {
  const safe = Array.isArray(liveStreams) ? liveStreams : [];
  const cached = liveIndexCache.get(safe);
  if (cached) return cached;

  indexPerfStats.liveIndexBuilds++;
  const byId = new Map<string, T>();
  const byCategoryId = new Map<string, T[]>();

  for (let i = 0; i < safe.length; i++) {
    const item = safe[i] as any;
    if (!item || typeof item !== 'object') continue;

    const rawId = item.stream_id ?? item.id;
    if (rawId !== undefined && rawId !== null && rawId !== '') {
      const idKey = String(rawId);
      if (!byId.has(idKey)) {
        byId.set(idKey, item);
      }
    }

    const catKey = String(item.category_id ?? '');
    let bucket = byCategoryId.get(catKey);
    if (!bucket) {
      bucket = [];
      byCategoryId.set(catKey, bucket);
    }
    bucket.push(item);
  }

  const groupsByCategoryCache = new Map<string, LiveChannelGroup[]>();
  let allGroupsCache: LiveChannelGroup[] | null = null;

  const index: LiveCatalogIndex<T> = {
    source: safe,
    byId,
    byCategoryId,
    getByCategory(categoryId) {
      indexPerfStats.categoryLookups++;
      if (categoryId === undefined || categoryId === null) return [];
      return byCategoryId.get(String(categoryId)) || [];
    },
    getById(id) {
      indexPerfStats.idLookups++;
      if (id === undefined || id === null || id === '') return undefined;
      return byId.get(String(id));
    },
    getGroupsByCategory(categoryId) {
      indexPerfStats.categoryLookups++;
      if (categoryId === undefined || categoryId === null) return [];
      const key = String(categoryId);
      const cachedGroups = groupsByCategoryCache.get(key);
      if (cachedGroups) return cachedGroups;
      const rawCat = byCategoryId.get(key) || [];
      const groups = rawCat.length > 0 ? groupLiveStreams(rawCat) : [];
      groupsByCategoryCache.set(key, groups);
      return groups;
    },
    getAllGroups() {
      if (!allGroupsCache) {
        allGroupsCache = groupLiveStreams(safe);
      }
      return allGroupsCache;
    },
  };

  liveIndexCache.set(safe, index);
  return index;
}

const PRECOMPUTED_HERO_SYMBOL = Symbol.for('nc.precomputed.hero');
const HERO_DEDUP_TAG_REGEX = /\b(dublado|legendado|dub|leg|4k|fhd|hd|dual|áudio|audio)\b/g;
const HERO_DEDUP_BRACKET_CHARS_REGEX = /[\[\]\(\)]/g;
const HERO_DEDUP_SPACE_REGEX = /\s+/g;

export function normalizeHeroTitleForDedup(rawName: string | undefined | null): string {
  return String(rawName || '')
    .toLowerCase()
    .replace(HERO_DEDUP_TAG_REGEX, '')
    .replace(HERO_DEDUP_BRACKET_CHARS_REGEX, '')
    .replace(HERO_DEDUP_SPACE_REGEX, ' ')
    .trim();
}

export function hasHeroImage(item: any): boolean {
  if (!item || typeof item !== 'object') return false;
  return Boolean(item.stream_icon || item.cover || item.backdrop_path);
}

export function isPrecomputedHeroArray(items: any): boolean {
  return Boolean(items && Array.isArray(items) && (items as any)[PRECOMPUTED_HERO_SYMBOL] === true);
}

function markAsPrecomputedHeroArray<T>(items: T[]): T[] {
  try {
    Object.defineProperty(items, PRECOMPUTED_HERO_SYMBOL, {
      value: true,
      enumerable: false,
      configurable: true,
    });
  } catch {
    // ignore if frozen
  }
  return items;
}

/**
 * Computes the top 30 deduplicated hero items from a raw array (used when HeroBanner
 * is rendered standalone with an arbitrary items prop).
 */
export function computeHeroItemsFromList(items: any[]): any[] {
  if (!items || !Array.isArray(items) || items.length === 0) return [];
  if (isPrecomputedHeroArray(items)) return items;

  indexPerfStats.heroComputations++;
  const itemsWithImages = items.filter(hasHeroImage);
  if (itemsWithImages.length === 0) return [];

  const sorted = sortByYearAndRating(itemsWithImages);
  const seenNames = new Set<string>();
  const result: any[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    const cleanName = normalizeHeroTitleForDedup(item.name || item.title || '');
    if (!seenNames.has(cleanName)) {
      seenNames.add(cleanName);
      result.push(item);
      if (result.length >= 30) break;
    }
  }

  return markAsPrecomputedHeroArray(result);
}

const heroPairCache = new WeakMap<
  any[],
  WeakMap<any[], { maxYear: number; result: any[] }>
>();

function compareRankedHeroCandidate(a: any, b: any, maxYear: number): number {
  const yearA = getValidYear(a, maxYear);
  const yearB = getValidYear(b, maxYear);
  const ratingA = getValidRating(a);
  const ratingB = getValidRating(b);
  const hasMetaA = yearA > 0 || ratingA > 0;
  const hasMetaB = yearB > 0 || ratingB > 0;

  if (hasMetaA !== hasMetaB) return hasMetaA ? -1 : 1;
  if (!hasMetaA) return -1; // VOD precedes Series when both lack metadata
  if (yearB !== yearA) return yearB - yearA;
  if (ratingB !== ratingA) return ratingB - ratingA;
  return -1; // VOD precedes Series on exact tie
}

/**
 * Computes and caches the top 30 deduplicated HeroBanner items from (allVodStreams, allSeriesStreams)
 * by merging the already-sorted VOD and Series catalog indexes without concatenating or re-sorting
 * 27,000 items. Mathematically identical to computeHeroItemsFromList([...allVodStreams, ...allSeriesStreams]).
 */
export function getHeroBannerItems(allVodStreams: any[], allSeriesStreams: any[]): any[] {
  const safeVod = Array.isArray(allVodStreams) ? allVodStreams : [];
  const safeSeries = Array.isArray(allSeriesStreams) ? allSeriesStreams : [];

  if (safeVod.length === 0 && safeSeries.length === 0) {
    return markAsPrecomputedHeroArray([]);
  }

  const maxYear = new Date().getFullYear() + 1;
  let innerMap = heroPairCache.get(safeVod);
  if (innerMap) {
    const cached = innerMap.get(safeSeries);
    if (cached && cached.maxYear === maxYear) {
      return cached.result;
    }
  } else {
    innerMap = new WeakMap();
    heroPairCache.set(safeVod, innerMap);
  }

  indexPerfStats.heroComputations++;
  const vodSorted = getOrCreateVodIndex(safeVod).getSortedAll();
  const seriesSorted = getOrCreateSeriesIndex(safeSeries).getSortedAll();

  const seenNames = new Set<string>();
  const result: any[] = [];

  let i = 0;
  let j = 0;
  const nVod = vodSorted.length;
  const nSeries = seriesSorted.length;

  while ((i < nVod || j < nSeries) && result.length < 30) {
    while (i < nVod && !hasHeroImage(vodSorted[i])) {
      i++;
    }
    while (j < nSeries && !hasHeroImage(seriesSorted[j])) {
      j++;
    }
    if (i >= nVod && j >= nSeries) break;

    let chosen: any;
    if (i < nVod && j < nSeries) {
      if (compareRankedHeroCandidate(vodSorted[i], seriesSorted[j], maxYear) <= 0) {
        chosen = vodSorted[i++];
      } else {
        chosen = seriesSorted[j++];
      }
    } else if (i < nVod) {
      chosen = vodSorted[i++];
    } else {
      chosen = seriesSorted[j++];
    }

    const cleanName = normalizeHeroTitleForDedup(chosen.name || chosen.title || '');
    if (!seenNames.has(cleanName)) {
      seenNames.add(cleanName);
      result.push(chosen);
    }
  }

  const marked = markAsPrecomputedHeroArray(result);
  innerMap.set(safeSeries, { maxYear, result: marked });
  return marked;
}
