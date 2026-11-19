import { XtreamService } from './xtreamService';
import { normalizeImageSource, normalizeServerUrl } from '../utils/mediaUtils';

const MAX_METADATA_CACHE_ENTRIES = 60;
const MAX_SERIES_EPISODES_CACHE_ENTRIES = 3;

export type HeroDomainKey = 'inicio' | 'movies' | 'series' | 'standalone';

interface InFlightDetailsEntry {
  key: string;
  epoch: number;
  scopeKey: string;
  abortController: AbortController | null;
  activeConsumers: number;
  settled: boolean;
  promise: Promise<any>;
}

interface SequenceEntry {
  index: number;
  signature: string;
  scopeKey: string;
}

let sessionEpoch = 1;

// Bounded LRU cache for lightweight banner/movie metadata (VOD info + movie_data; Series info WITHOUT episodes)
const detailsMetadataCache = new Map<string, any>();

// Strictly bounded tiny LRU cache for full Series responses (including episodes) to avoid unbounded memory growth
const seriesEpisodesCache = new Map<string, any>();

// Shared in-flight requests keyed by full item identity within the current account/server/epoch
const inFlightDetailsMap = new Map<string, InFlightDetailsEntry>();

// Per-account, per-domain active HeroBanner slide index
const heroSequenceStore = new Map<string, SequenceEntry>();

function lruGet<T>(map: Map<string, T>, key: string): T | undefined {
  if (!map.has(key)) return undefined;
  const val = map.get(key) as T;
  map.delete(key);
  map.set(key, val);
  return val;
}

function lruSet<T>(map: Map<string, T>, key: string, value: T, maxEntries: number): void {
  if (map.has(key)) {
    map.delete(key);
  }
  map.set(key, value);
  while (map.size > maxEntries) {
    const oldestKey = map.keys().next().value;
    if (oldestKey === undefined) break;
    map.delete(oldestKey);
  }
}

export function getHeroAccountScopeKey(credentials: any): string {
  if (!credentials || typeof credentials !== 'object') {
    return `anon|ep${sessionEpoch}`;
  }
  const server =
    normalizeServerUrl(credentials.serverUrl) ||
    String(credentials.serverUrl || '').trim();
  const username = String(credentials.username || '').trim();
  const password = String(credentials.password || '');
  return `${server}|${username}|${password}|ep${sessionEpoch}`;
}

export function getHeroItemTargetInfo(
  item: any
): { kind: 'vod' | 'series'; targetId: string } | null {
  if (!item || typeof item !== 'object') return null;
  const isMovie =
    item.stream_type === 'movie' || Boolean(item.stream_id && !item.series_id);
  const rawId = isMovie
    ? item.stream_id ?? item.id
    : item.series_id ?? item.stream_id ?? item.id;
  if (rawId === undefined || rawId === null || rawId === '') {
    return null;
  }
  return {
    kind: isMovie ? 'vod' : 'series',
    targetId: String(rawId),
  };
}

function buildItemCacheKey(
  credentials: any,
  target: { kind: 'vod' | 'series'; targetId: string }
): { cacheKey: string; scopeKey: string } {
  const scopeKey = getHeroAccountScopeKey(credentials);
  return {
    scopeKey,
    cacheKey: `${scopeKey}|${target.kind}|${target.targetId}`,
  };
}

function sanitizeSeriesMetadataOnly(rawResponse: any): any {
  if (!rawResponse || typeof rawResponse !== 'object') return null;
  const info =
    rawResponse.info && typeof rawResponse.info === 'object'
      ? { ...rawResponse.info }
      : {};
  return { info };
}

function hasValidEpisodesPayload(payload: any): boolean {
  return Boolean(
    payload &&
      typeof payload === 'object' &&
      payload.episodes &&
      typeof payload.episodes === 'object'
  );
}

/**
 * Computes a stable identity signature for an ordered HeroBanner item list.
 * Reordering, adding, removing, or replacing items produces a different signature.
 */
export function computeHeroItemsSignature(items: any[]): string {
  if (!Array.isArray(items) || items.length === 0) return '';
  return items
    .map((it) => {
      const target = getHeroItemTargetInfo(it);
      if (target) {
        return `${target.kind}:${target.targetId}`;
      }
      const fallback = String(it?.name || it?.title || '');
      return `raw:${fallback}`;
    })
    .join('|');
}

export function getCachedHeroDetails(
  credentials: any,
  item: any,
  options?: { requireEpisodes?: boolean }
): any | null {
  if (!credentials?.serverUrl || !credentials?.username || !item) return null;
  const target = getHeroItemTargetInfo(item);
  if (!target) return null;
  const { cacheKey } = buildItemCacheKey(credentials, target);

  if (target.kind === 'series') {
    const fullSeries = lruGet(seriesEpisodesCache, cacheKey);
    if (fullSeries !== undefined) {
      return fullSeries;
    }
    if (options?.requireEpisodes) {
      return null;
    }
  }

  const metadata = lruGet(detailsMetadataCache, cacheKey);
  return metadata !== undefined ? metadata : null;
}

/**
 * Determines whether HeroBanner actually needs to issue a get_vod_info / get_series_info
 * query for the currently visible slide.
 * - If valid details are already in session cache: false.
 * - If catalog item already provides both backdrop_path and plot/overview (common in get_series): false.
 */
export function needsHeroDetailsFetch(credentials: any, item: any): boolean {
  if (!credentials?.serverUrl || !credentials?.username || !item) return false;
  if (getCachedHeroDetails(credentials, item) !== null) {
    return false;
  }
  const hasCatalogBackdrop = Boolean(normalizeImageSource(item.backdrop_path));
  const rawPlot = item.plot || item.overview || '';
  const hasCatalogSynopsis = typeof rawPlot === 'string' && rawPlot.trim().length > 0;
  return !(hasCatalogBackdrop && hasCatalogSynopsis);
}

function createAbortError(): Error {
  const err = new Error('Operação cancelada pelo usuário.');
  err.name = 'AbortError';
  return err;
}

/**
 * Fetches or reuses session-cached / in-flight getVodInfo / getSeriesInfo for an item.
 * Features:
 * - Bounded session LRU cache isolated by account/server/epoch.
 * - Strictly bounded series `episodes` retention (never kept in long-lived metadata cache).
 * - Consumer-safe cancellation: cancelling one consumer's AbortSignal only aborts the
 *   underlying network request when zero active consumers remain.
 */
export function fetchOrReuseHeroDetails(
  credentials: any,
  item: any,
  options?: {
    signal?: AbortSignal;
    requireEpisodes?: boolean;
    throwOnError?: boolean;
  }
): Promise<any> {
  const throwOnError = Boolean(options?.throwOnError);
  const requireEpisodes = Boolean(options?.requireEpisodes);
  const callerSignal = options?.signal;

  if (callerSignal?.aborted) {
    return throwOnError ? Promise.reject(createAbortError()) : Promise.resolve(null);
  }

  if (!credentials?.serverUrl || !credentials?.username || !item) {
    return Promise.resolve(null);
  }

  const target = getHeroItemTargetInfo(item);
  if (!target) {
    return Promise.resolve(null);
  }

  const cached = getCachedHeroDetails(credentials, item, { requireEpisodes });
  if (cached !== null) {
    return Promise.resolve(cached);
  }

  const { cacheKey, scopeKey } = buildItemCacheKey(credentials, target);
  const startEpoch = sessionEpoch;

  let entry = inFlightDetailsMap.get(cacheKey);
  if (!entry) {
    const abortController =
      typeof AbortController !== 'undefined' ? new AbortController() : null;

    const rawPromise = (async () => {
      try {
        const res =
          target.kind === 'vod'
            ? await XtreamService.getVodInfo(credentials, target.targetId, {
                signal: abortController?.signal,
              })
            : await XtreamService.getSeriesInfo(credentials, target.targetId, {
                signal: abortController?.signal,
              });

        const isStaleOrAborted =
          Boolean(abortController?.signal.aborted) || sessionEpoch !== startEpoch;

        if (!isStaleOrAborted && res && typeof res === 'object') {
          if (target.kind === 'vod') {
            lruSet(detailsMetadataCache, cacheKey, res, MAX_METADATA_CACHE_ENTRIES);
          } else {
            const sanitized = sanitizeSeriesMetadataOnly(res);
            if (sanitized) {
              lruSet(
                detailsMetadataCache,
                cacheKey,
                sanitized,
                MAX_METADATA_CACHE_ENTRIES
              );
            }
            if (hasValidEpisodesPayload(res)) {
              lruSet(
                seriesEpisodesCache,
                cacheKey,
                res,
                MAX_SERIES_EPISODES_CACHE_ENTRIES
              );
            }
          }
        }
        return res;
      } finally {
        if (entry) {
          entry.settled = true;
        }
        if (inFlightDetailsMap.get(cacheKey) === entry) {
          inFlightDetailsMap.delete(cacheKey);
        }
      }
    })();

    // Prevent unhandled rejection warnings if all consumers cancel or fail silently
    rawPromise.catch(() => {});

    entry = {
      key: cacheKey,
      epoch: startEpoch,
      scopeKey,
      abortController,
      activeConsumers: 0,
      settled: false,
      promise: rawPromise,
    };
    inFlightDetailsMap.set(cacheKey, entry);
  }

  entry.activeConsumers++;

  return new Promise<any>((resolve, reject) => {
    let consumerDone = false;

    const cleanupListener = () => {
      if (callerSignal) {
        callerSignal.removeEventListener('abort', onCallerAbort);
      }
    };

    const onCallerAbort = () => {
      if (consumerDone) return;
      consumerDone = true;
      cleanupListener();
      if (entry && !entry.settled) {
        entry.activeConsumers = Math.max(0, entry.activeConsumers - 1);
        if (entry.activeConsumers <= 0) {
          entry.abortController?.abort();
          if (inFlightDetailsMap.get(cacheKey) === entry) {
            inFlightDetailsMap.delete(cacheKey);
          }
        }
      }
      if (throwOnError) {
        reject(createAbortError());
      } else {
        resolve(null);
      }
    };

    if (callerSignal) {
      callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }

    entry!.promise.then(
      (res) => {
        if (consumerDone) return;
        consumerDone = true;
        cleanupListener();
        if (sessionEpoch !== startEpoch) {
          resolve(null);
          return;
        }
        if (target.kind === 'series' && !requireEpisodes) {
          resolve(sanitizeSeriesMetadataOnly(res) ?? res ?? null);
          return;
        }
        resolve(res ?? null);
      },
      (err) => {
        if (consumerDone) return;
        consumerDone = true;
        cleanupListener();
        if (throwOnError) {
          reject(err);
        } else {
          console.warn('Failed to fetch details for hero item:', err);
          resolve(null);
        }
      }
    );
  });
}

export function getSavedHeroSlideIndex(
  credentials: any,
  domain: HeroDomainKey | string | undefined,
  itemsSignature: string,
  itemsLength: number
): number {
  if (!itemsSignature || itemsLength <= 0) return 0;
  const scopeKey = getHeroAccountScopeKey(credentials);
  const normalizedDomain = domain || 'standalone';
  const mapKey = `${scopeKey}::${normalizedDomain}`;
  const entry = heroSequenceStore.get(mapKey);
  if (!entry || entry.signature !== itemsSignature) {
    return 0;
  }
  if (entry.index < 0 || entry.index >= itemsLength) {
    return 0;
  }
  return entry.index;
}

export function setSavedHeroSlideIndex(
  credentials: any,
  domain: HeroDomainKey | string | undefined,
  itemsSignature: string,
  index: number
): void {
  if (!itemsSignature || index < 0) return;
  const scopeKey = getHeroAccountScopeKey(credentials);
  const normalizedDomain = domain || 'standalone';
  const mapKey = `${scopeKey}::${normalizedDomain}`;
  heroSequenceStore.set(mapKey, {
    index,
    signature: itemsSignature,
    scopeKey,
  });
}

/**
 * Clears session HeroBanner caches and aborts pending HeroBanner requests.
 * Pass `credentialsToClear` to invalidate only a specific account/server scope,
 * or omit to wipe all session state (e.g. on logout).
 */
export function clearHeroSessionCache(credentialsToClear?: any): void {
  if (credentialsToClear) {
    const targetScope = getHeroAccountScopeKey(credentialsToClear);
    for (const key of Array.from(detailsMetadataCache.keys())) {
      if (key.startsWith(`${targetScope}|`)) {
        detailsMetadataCache.delete(key);
      }
    }
    for (const key of Array.from(seriesEpisodesCache.keys())) {
      if (key.startsWith(`${targetScope}|`)) {
        seriesEpisodesCache.delete(key);
      }
    }
    for (const [key, entry] of Array.from(inFlightDetailsMap.entries())) {
      if (entry.scopeKey === targetScope) {
        entry.abortController?.abort();
        inFlightDetailsMap.delete(key);
      }
    }
    for (const [key, seq] of Array.from(heroSequenceStore.entries())) {
      if (seq.scopeKey === targetScope) {
        heroSequenceStore.delete(key);
      }
    }
    return;
  }

  sessionEpoch++;
  detailsMetadataCache.clear();
  seriesEpisodesCache.clear();
  for (const entry of inFlightDetailsMap.values()) {
    entry.abortController?.abort();
  }
  inFlightDetailsMap.clear();
  heroSequenceStore.clear();
}

export function getHeroSessionCacheStatsForTest() {
  return {
    metadataEntriesCount: detailsMetadataCache.size,
    seriesEpisodesEntriesCount: seriesEpisodesCache.size,
    maxMetadataEntries: MAX_METADATA_CACHE_ENTRIES,
    maxSeriesEpisodesEntries: MAX_SERIES_EPISODES_CACHE_ENTRIES,
    inFlightCount: inFlightDetailsMap.size,
    sequenceEntriesCount: heroSequenceStore.size,
    sessionEpoch,
  };
}
