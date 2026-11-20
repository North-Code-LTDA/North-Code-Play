import { getValidYear, getValidRating, sortByYearAndRating } from './catalogRanking';
import { groupLiveStreams, LiveChannelGroup } from './liveChannelGroups';

export interface CooperativeBuildOptions {
  batchSize?: number;
  signal?: AbortSignal;
  shouldCancel?: () => boolean;
  onBatchProgress?: (processedCount: number, totalCount: number, batchIndex: number) => void;
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

const inFlightVodBuilds = new WeakMap<any[], Promise<RankedCatalogIndex<any> | null>>();
const inFlightSeriesBuilds = new WeakMap<any[], Promise<RankedCatalogIndex<any> | null>>();
const inFlightLiveBuilds = new WeakMap<any[], Promise<LiveCatalogIndex<any> | null>>();

function instantiateRankedCatalogIndex<T extends Record<string, any>>(
  safeItems: T[],
  byId: Map<string, T>,
  byCategoryId: Map<string, T[]>
): RankedCatalogIndex<T> {
  let sortedAllCache: T[] | null = null;
  let sortedAllYear = 0;
  const sortedByCategoryCache = new Map<string, { year: number; sorted: T[] }>();

  return {
    source: safeItems,
    byId,
    byCategoryId,
    getByCategory(categoryId) {
      if (categoryId === undefined || categoryId === null) return [];
      return byCategoryId.get(String(categoryId)) || [];
    },
    getById(id) {
      if (id === undefined || id === null || id === '') return undefined;
      return byId.get(String(id));
    },
    getSortedAll() {
      const maxYear = new Date().getFullYear() + 1;
      if (sortedAllCache && sortedAllYear === maxYear) {
        return sortedAllCache;
      }
      sortedAllCache = sortByYearAndRating(safeItems);
      sortedAllYear = maxYear;
      return sortedAllCache;
    },
    getSortedByCategory(categoryId) {
      if (categoryId === undefined || categoryId === null) return [];
      const key = String(categoryId);
      const maxYear = new Date().getFullYear() + 1;
      const existing = sortedByCategoryCache.get(key);
      if (existing && existing.year === maxYear) {
        return existing.sorted;
      }
      const rawCat = byCategoryId.get(key) || [];
      if (
        rawCat.length > 0 &&
        rawCat.length === safeItems.length &&
        sortedAllCache &&
        sortedAllYear === maxYear
      ) {
        sortedByCategoryCache.set(key, { year: maxYear, sorted: sortedAllCache });
        return sortedAllCache;
      }
      const sorted = rawCat.length > 0 ? sortByYearAndRating(rawCat) : [];
      sortedByCategoryCache.set(key, { year: maxYear, sorted });
      return sorted;
    },
  };
}

function createRankedCatalogIndex<T extends Record<string, any>>(
  items: T[],
  idField: 'stream_id' | 'series_id'
): RankedCatalogIndex<T> {
  const safeItems = Array.isArray(items) ? items : [];
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

  return instantiateRankedCatalogIndex(safeItems, byId, byCategoryId);
}

function instantiateLiveCatalogIndex<T = any>(
  safeItems: T[],
  byId: Map<string, T>,
  byCategoryId: Map<string, T[]>
): LiveCatalogIndex<T> {
  const groupsByCategoryCache = new Map<string, LiveChannelGroup[]>();
  let allGroupsCache: LiveChannelGroup[] | null = null;

  return {
    source: safeItems,
    byId,
    byCategoryId,
    getByCategory(categoryId) {
      if (categoryId === undefined || categoryId === null) return [];
      return byCategoryId.get(String(categoryId)) || [];
    },
    getById(id) {
      if (id === undefined || id === null || id === '') return undefined;
      return byId.get(String(id));
    },
    getGroupsByCategory(categoryId) {
      if (categoryId === undefined || categoryId === null) return [];
      const key = String(categoryId);
      const cachedGroups = groupsByCategoryCache.get(key);
      if (cachedGroups) {
        return cachedGroups;
      }
      const rawCat = byCategoryId.get(key) || [];
      const groups = rawCat.length > 0 ? groupLiveStreams(rawCat) : [];
      groupsByCategoryCache.set(key, groups);
      return groups;
    },
    getAllGroups() {
      if (allGroupsCache) {
        return allGroupsCache;
      }
      allGroupsCache = groupLiveStreams(safeItems);
      return allGroupsCache;
    },
  };
}

export function getOrCreateVodIndex<T = any>(vodStreams: T[]): RankedCatalogIndex<T> {
  const safe = Array.isArray(vodStreams) ? vodStreams : [];
  const cached = vodIndexCache.get(safe);
  if (cached) return cached;
  const created = createRankedCatalogIndex(safe as any[], 'stream_id');
  vodIndexCache.set(safe, created);
  return created;
}

export function getOrCreateSeriesIndex<T = any>(seriesStreams: T[]): RankedCatalogIndex<T> {
  const safe = Array.isArray(seriesStreams) ? seriesStreams : [];
  const cached = seriesIndexCache.get(safe);
  if (cached) return cached;
  const created = createRankedCatalogIndex(safe as any[], 'series_id');
  seriesIndexCache.set(safe, created);
  return created;
}

export function getOrCreateLiveIndex<T = any>(liveStreams: T[]): LiveCatalogIndex<T> {
  const safe = Array.isArray(liveStreams) ? liveStreams : [];
  const cached = liveIndexCache.get(safe);
  if (cached) return cached;

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

  const index = instantiateLiveCatalogIndex(safe, byId, byCategoryId);
  liveIndexCache.set(safe, index);
  return index;
}

async function buildRankedCatalogIndexCooperatively<T extends Record<string, any>>(
  items: T[],
  idField: 'stream_id' | 'series_id',
  cache: WeakMap<any[], RankedCatalogIndex<any>>,
  inFlightMap: WeakMap<any[], Promise<RankedCatalogIndex<any> | null>>,
  options?: CooperativeBuildOptions
): Promise<RankedCatalogIndex<T> | null> {
  const safeItems = Array.isArray(items) ? items : [];
  const isCancelled = () => Boolean(options?.signal?.aborted || options?.shouldCancel?.());

  if (isCancelled()) {
    return null;
  }

  const cached = cache.get(safeItems);
  if (cached) {
    return cached;
  }

  const canShareInFlight =
    !options?.onBatchProgress && !options?.signal && !options?.shouldCancel;
  const existingInFlight = canShareInFlight ? inFlightMap.get(safeItems) : undefined;
  if (existingInFlight) {
    const res = await existingInFlight;
    if (res) {
      return res;
    }
  }

  const batchSize = Math.max(100, Math.floor(options?.batchSize ?? 1000));

  const taskPromise = (async (): Promise<RankedCatalogIndex<T> | null> => {
    const byId = new Map<string, T>();
    const byCategoryId = new Map<string, T[]>();
    let batchIdx = 0;

    for (let start = 0; start < safeItems.length; start += batchSize) {
      if (isCancelled()) {
        return null;
      }

      const end = Math.min(safeItems.length, start + batchSize);
      for (let i = start; i < end; i++) {
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

      batchIdx++;
      options?.onBatchProgress?.(end, safeItems.length, batchIdx);

      if (isCancelled()) {
        return null;
      }

      if (end < safeItems.length) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (isCancelled()) {
          return null;
        }
      }
    }

    const index = instantiateRankedCatalogIndex(safeItems, byId, byCategoryId);
    cache.set(safeItems, index);

    return index;
  })();

  if (canShareInFlight) {
    inFlightMap.set(safeItems, taskPromise);
  }
  try {
    return await taskPromise;
  } finally {
    if (canShareInFlight && inFlightMap.get(safeItems) === taskPromise) {
      inFlightMap.delete(safeItems);
    }
  }
}

export async function buildVodIndexAsync<T = any>(
  vodStreams: T[],
  options?: CooperativeBuildOptions
): Promise<RankedCatalogIndex<T> | null> {
  return buildRankedCatalogIndexCooperatively(
    vodStreams as any[],
    'stream_id',
    vodIndexCache,
    inFlightVodBuilds,
    options
  );
}

export async function buildSeriesIndexAsync<T = any>(
  seriesStreams: T[],
  options?: CooperativeBuildOptions
): Promise<RankedCatalogIndex<T> | null> {
  return buildRankedCatalogIndexCooperatively(
    seriesStreams as any[],
    'series_id',
    seriesIndexCache,
    inFlightSeriesBuilds,
    options
  );
}

export async function buildLiveIndexAsync<T = any>(
  liveStreams: T[],
  options?: CooperativeBuildOptions
): Promise<LiveCatalogIndex<T> | null> {
  const safeItems = Array.isArray(liveStreams) ? liveStreams : [];
  const isCancelled = () => Boolean(options?.signal?.aborted || options?.shouldCancel?.());

  if (isCancelled()) {
    return null;
  }

  const cached = liveIndexCache.get(safeItems);
  if (cached) {
    return cached;
  }

  const canShareInFlight =
    !options?.onBatchProgress && !options?.signal && !options?.shouldCancel;
  const existingInFlight = canShareInFlight ? inFlightLiveBuilds.get(safeItems) : undefined;
  if (existingInFlight) {
    const res = await existingInFlight;
    if (res) {
      return res;
    }
  }

  const batchSize = Math.max(100, Math.floor(options?.batchSize ?? 1000));

  const taskPromise = (async (): Promise<LiveCatalogIndex<T> | null> => {
    const byId = new Map<string, T>();
    const byCategoryId = new Map<string, T[]>();
    let batchIdx = 0;

    for (let start = 0; start < safeItems.length; start += batchSize) {
      if (isCancelled()) {
        return null;
      }

      const end = Math.min(safeItems.length, start + batchSize);
      for (let i = start; i < end; i++) {
        const item = safeItems[i] as any;
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

      batchIdx++;
      options?.onBatchProgress?.(end, safeItems.length, batchIdx);

      if (isCancelled()) {
        return null;
      }

      if (end < safeItems.length) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (isCancelled()) {
          return null;
        }
      }
    }

    const index = instantiateLiveCatalogIndex(safeItems, byId, byCategoryId);
    liveIndexCache.set(safeItems, index);

    return index;
  })();

  if (canShareInFlight) {
    inFlightLiveBuilds.set(safeItems, taskPromise);
  }
  try {
    return await taskPromise;
  } finally {
    if (canShareInFlight && inFlightLiveBuilds.get(safeItems) === taskPromise) {
      inFlightLiveBuilds.delete(safeItems);
    }
  }
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

const CANONICAL_EMPTY_ARRAY: any[] = [];

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

function selectTopHeroFromSingleSortedList(sorted: any[]): any[] {
  const seenNames = new Set<string>();
  const result: any[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    if (!hasHeroImage(item)) continue;
    const cleanName = normalizeHeroTitleForDedup(item.name || item.title || '');
    if (!seenNames.has(cleanName)) {
      seenNames.add(cleanName);
      result.push(item);
      if (result.length >= 30) break;
    }
  }
  return markAsPrecomputedHeroArray(result);
}

/**
 * Computes and caches the top 30 deduplicated HeroBanner items from (allVodStreams, allSeriesStreams).
 * For single-domain calls (`vod + []` or `[] + series`), selects top 30 from that domain's sorted index.
 * For combined Home calls (`vod + series`), reuses the exact top-30 Movies and top-30 Series selections
 * and merges up to 60 items using the identical comparator and title deduplication rules.
 */
export function getHeroBannerItems(allVodStreams: any[], allSeriesStreams: any[]): any[] {
  const safeVod =
    Array.isArray(allVodStreams) && allVodStreams.length > 0
      ? allVodStreams
      : CANONICAL_EMPTY_ARRAY;
  const safeSeries =
    Array.isArray(allSeriesStreams) && allSeriesStreams.length > 0
      ? allSeriesStreams
      : CANONICAL_EMPTY_ARRAY;

  if (safeVod === CANONICAL_EMPTY_ARRAY && safeSeries === CANONICAL_EMPTY_ARRAY) {
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

  let marked: any[];

  if (safeSeries === CANONICAL_EMPTY_ARRAY) {
    const vodSorted = getOrCreateVodIndex(safeVod).getSortedAll();
    marked = selectTopHeroFromSingleSortedList(vodSorted);
  } else if (safeVod === CANONICAL_EMPTY_ARRAY) {
    const seriesSorted = getOrCreateSeriesIndex(safeSeries).getSortedAll();
    marked = selectTopHeroFromSingleSortedList(seriesSorted);
  } else {
    // Reuse top-30 Movies and top-30 Series selections directly (mathematically identical to scanning full arrays)
    const vodTop30 = getHeroBannerItems(safeVod, CANONICAL_EMPTY_ARRAY);
    const seriesTop30 = getHeroBannerItems(CANONICAL_EMPTY_ARRAY, safeSeries);

    const seenNames = new Set<string>();
    const result: any[] = [];
    let i = 0;
    let j = 0;
    const nVod = vodTop30.length;
    const nSeries = seriesTop30.length;

    while ((i < nVod || j < nSeries) && result.length < 30) {
      let chosen: any;
      if (i < nVod && j < nSeries) {
        if (compareRankedHeroCandidate(vodTop30[i], seriesTop30[j], maxYear) <= 0) {
          chosen = vodTop30[i++];
        } else {
          chosen = seriesTop30[j++];
        }
      } else if (i < nVod) {
        chosen = vodTop30[i++];
      } else {
        chosen = seriesTop30[j++];
      }

      const cleanName = normalizeHeroTitleForDedup(chosen.name || chosen.title || '');
      if (!seenNames.has(cleanName)) {
        seenNames.add(cleanName);
        result.push(chosen);
      }
    }

    marked = markAsPrecomputedHeroArray(result);
  }

  innerMap.set(safeSeries, { maxYear, result: marked });
  return marked;
}
