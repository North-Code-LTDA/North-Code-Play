import { Capacitor, registerPlugin } from '@capacitor/core';
import {
  nowMonotonicMs,
  recordCatalogImageCacheDiagnosticsUpdate,
} from '../utils/catalogDiagnostics';
import { buildDirectImageUrl, normalizeImageSource } from '../utils/mediaUtils';
import { safeReadStorage, safeSetStorage } from '../utils/accountUtils';
import { getOrCreateVodIndex, getOrCreateSeriesIndex, getHeroBannerItems } from '../utils/catalogIndex';
import type { DisplayMode } from '../platform/tvEnvironment';

export const IMAGE_DISK_CACHE_PLUGIN_NAME = 'ImageDiskCache';
export const IMAGE_CACHE_SUBDIR_NAME = 'nc_image_cache';
export const DEFAULT_IMAGE_CACHE_MAX_BYTES = 120 * 1024 * 1024; // 120 MB
export const VISITED_CATEGORIES_STORAGE_KEY = 'nc_visited_image_categories_v1';
export const MAX_VISITED_CATEGORIES_HISTORY = 16;
export const MAX_LOW_PRIORITY_PENDING_TASKS = 24;

export type StartupImageCoordinationMode = 'mode_b';

const SAFE_IMAGE_FILE_NAME_REGEX =
  /^img_[a-f0-9]{64}\.(?:jpg|png|webp|gif|bmp|ico|avif|svg|bin)$/;
const DEDICATED_ANDROID_IMAGE_CACHE_DIR_REGEX =
  /^\/data\/(?:user(?:_de)?\/\d+|data)\/com\.northcode\.play\/files\/nc_image_cache$/;
const CAPACITOR_FILE_PATH_PREFIX = '/_capacitor_file_';

export type ImagePreloadPriority = 'critical' | 'high' | 'normal' | 'low';

export interface HydratedImageCacheEntry {
  key: string;
  fileName: string;
  filePath: string;
  byteSize: number;
  contentType?: string;
  etag?: string | null;
  lastModified?: string | null;
  cacheControl?: string | null;
  createdAtMs?: number;
  lastAccessedAtMs?: number;
}

export interface HydratedImageCacheIndexResult {
  cacheDir?: string;
  maxBytes?: number;
  totalBytes?: number;
  evictedEntriesCount?: number;
  corruptedRecoveriesCount?: number;
  entries?: HydratedImageCacheEntry[];
}

export interface AcquireImageNativeOptions {
  url: string;
  forceRefresh?: boolean;
  revalidate?: boolean;
  connectTimeout?: number;
  readTimeout?: number;
  recentAccessedKeys?: string[];
}

export interface AcquireImageNativeResult {
  hit: boolean;
  revalidated304?: boolean;
  bypassedNoStore?: boolean;
  deduplicated?: boolean;
  key?: string;
  fileName?: string | null;
  filePath?: string | null;
  inlineDataUrl?: string | null;
  cacheDir?: string | null;
  byteSize?: number;
  contentType?: string;
  etag?: string | null;
  lastModified?: string | null;
  cacheControl?: string | null;
  createdAtMs?: number;
  lastAccessedAtMs?: number;
  totalBytes?: number;
  storedEntriesCount?: number;
  evictedEntriesCount?: number;
  evictedKeys?: string[];
}

export interface ImageDiskCacheNativePlugin {
  getHydratedIndex(): Promise<HydratedImageCacheIndexResult>;
  configureCache(options: {
    maxBytes: number;
    recentAccessedKeys?: string[];
  }): Promise<{
    maxBytes?: number;
    totalBytes?: number;
    storedEntriesCount?: number;
    evictedEntriesCount?: number;
    evictedKeys?: string[];
  }>;
  touchEntries?(options: { keys: string[] }): Promise<{
    touchedCount?: number;
  }>;
  acquireImage(options: AcquireImageNativeOptions): Promise<AcquireImageNativeResult>;
  invalidateImage(options: {
    url?: string;
    key?: string;
    corruptedRecovery?: boolean;
  }): Promise<{
    removed?: boolean;
    totalBytes?: number;
    corruptedRecoveriesCount?: number;
  }>;
  clearAll(): Promise<{
    cleared?: boolean;
    epoch?: number;
    totalBytes?: number;
  }>;
}

export interface ImageCacheRuntimeStats {
  coordinationMode: StartupImageCoordinationMode;
  initialHydratedEntriesCount: number;
  downloadsDuringCatalogsCount: number;
  hitsDuringCatalogsCount: number;
  uniqueCatalogImageUrls: number;
  uniqueHomeImageUrls: number;
  persistentCacheHits: number;
  cacheLayerDownloads: number;
  deduplicatedDownloadsCount: number;
  downloadFailuresCount: number;
  bytesTransferredByCache: number;
  bytesStoredCurrently: number;
  storedEntriesCount: number;
  evictedEntriesCount: number;
  corruptedLocalRecoveriesCount: number;
  priorityTargetCount: number;
  priorityFoundOnDiskCount: number;
  priorityDownloadedSuccessCount: number;
  priorityFailedCount: number;
  priorityPendingAtReleaseCount: number;
  localRecoveryTimeMs: number | null;
  planBuildTotalMs: number | null;
  planCategorySelectionAndSortMs: number | null;
  planUniqueUrlCountMs: number | null;
  priorityCoversPreparationMs: number | null;
  maxSimultaneousNativeTasks: number;
  cancelledStaleQueueTasksCount: number;
  configuredMaxBytes: number;
}

interface InMemoryResolvedEntry {
  url: string;
  key: string;
  fileName: string;
  filePath: string;
  convertedSrc: string;
  byteSize: number;
  contentType?: string;
  etag?: string | null;
  lastModified?: string | null;
  cacheControl?: string | null;
  createdAtMs: number;
  lastAccessedAtMs: number;
}

interface QueuedAcquireResolver {
  resolve: (res: AcquireCachedImageOutcome) => void;
  reject: (err: Error) => void;
   cleanupAbort?: () => void;
}

interface QueuedAcquireTask {
  url: string;
  priority: ImagePreloadPriority;
  forceRefresh: boolean;
  revalidate: boolean;
  epochAtEnqueue: number;
  startedExecution: boolean;
  resolvers: QueuedAcquireResolver[];
}

export interface AcquireCachedImageOutcome {
  src: string;
  fromCache: boolean;
  isLocalFile: boolean;
  bypassedNoStore: boolean;
  byteSize: number;
}

let registeredPlugin: ImageDiskCacheNativePlugin | null = null;
let pluginOverrideForTest: ImageDiskCacheNativePlugin | null = null;
let convertFileSrcOverrideForTest: ((filePath: string) => string) | null = null;
let forceAndroidImageCacheEnabledForTest: boolean | null = null;

// Relógio lógico monotônico para desempate determinístico de LRU mesmo no mesmo milissegundo
let logicalAccessClock = Date.now();
function nextLogicalAccessStamp(): number {
  const now = Date.now();
  logicalAccessClock = now > logicalAccessClock ? now : logicalAccessClock + 1;
  return logicalAccessClock;
}

// Fila leve de chaves reutilizadas em memória para sincronização em lote com o plugin nativo
// (evita chamadas de bridge nativa por renderização de cartão)
const pendingTouchedKeys: string[] = [];
function recordTouchedKeyForNativeSync(key: string): void {
  if (!key || key.length !== 64) return;
  const idx = pendingTouchedKeys.indexOf(key);
  if (idx >= 0) {
    pendingTouchedKeys.splice(idx, 1);
  }
  pendingTouchedKeys.push(key);
  if (pendingTouchedKeys.length > 512) {
    pendingTouchedKeys.shift();
  }
}

function drainPendingTouchedKeys(): string[] {
  if (pendingTouchedKeys.length === 0) return [];
  return pendingTouchedKeys.splice(0, pendingTouchedKeys.length);
}

// Estado em memória sincronizado com o disco
const resolvedUrlToEntryMap = new Map<string, InMemoryResolvedEntry>();
const shaKeyToUrlMap = new Map<string, string>();
const inFlightTasksByUrl = new Map<string, QueuedAcquireTask>();
const pendingQueue: QueuedAcquireTask[] = [];

let activeWorkersCount = 0;
let currentSessionEpoch = 1;
let hydrationPromise: Promise<void> | null = null;
let activeLogoutClearPromise: Promise<void> | null = null;
let isHydrated = false;
let isMainVideoPlaybackActive = false;
let isLiveTvPreviewPlaybackActive = false;
let isCatalogTransferPhaseActive = false;
let lastDpadActivityTimestampMs = 0;
let dpadThrottleTimer: ReturnType<typeof setTimeout> | null = null;
let cooperativeUrlCountTimers: Array<ReturnType<typeof setTimeout>> = [];

export function getStartupImageCoordinationMode(): StartupImageCoordinationMode {
  runtimeStats.coordinationMode = 'mode_b';
  return 'mode_b';
}

export function setCatalogTransferPhaseActiveForImageCache(active: boolean): void {
  const next = Boolean(active);
  if (isCatalogTransferPhaseActive !== next) {
    isCatalogTransferPhaseActive = next;
    if (!next) {
      pumpAcquireQueue();
    }
  }
}

export function isCatalogTransferPhaseActiveForImageCache(): boolean {
  return isCatalogTransferPhaseActive;
}

function isAnyVideoPlaybackActive(): boolean {
  return isMainVideoPlaybackActive || isLiveTvPreviewPlaybackActive;
}

export function isVideoPlaybackThrottlingActiveForTest(): boolean {
  return isAnyVideoPlaybackActive();
}

const runtimeStats: ImageCacheRuntimeStats = {
  coordinationMode: 'mode_b',
  initialHydratedEntriesCount: 0,
  downloadsDuringCatalogsCount: 0,
  hitsDuringCatalogsCount: 0,
  uniqueCatalogImageUrls: 0,
  uniqueHomeImageUrls: 0,
  persistentCacheHits: 0,
  cacheLayerDownloads: 0,
  deduplicatedDownloadsCount: 0,
  downloadFailuresCount: 0,
  bytesTransferredByCache: 0,
  bytesStoredCurrently: 0,
  storedEntriesCount: 0,
  evictedEntriesCount: 0,
  corruptedLocalRecoveriesCount: 0,
  priorityTargetCount: 0,
  priorityFoundOnDiskCount: 0,
  priorityDownloadedSuccessCount: 0,
  priorityFailedCount: 0,
  priorityPendingAtReleaseCount: 0,
  localRecoveryTimeMs: null,
  planBuildTotalMs: null,
  planCategorySelectionAndSortMs: null,
  planUniqueUrlCountMs: null,
  priorityCoversPreparationMs: null,
  maxSimultaneousNativeTasks: 0,
  cancelledStaleQueueTasksCount: 0,
  configuredMaxBytes: DEFAULT_IMAGE_CACHE_MAX_BYTES,
};

function syncStatsToCatalogDiagnostics(): void {
  recordCatalogImageCacheDiagnosticsUpdate({
    coordinationMode: runtimeStats.coordinationMode,
    initialHydratedEntriesCount: runtimeStats.initialHydratedEntriesCount,
    downloadsDuringCatalogsCount: runtimeStats.downloadsDuringCatalogsCount,
    hitsDuringCatalogsCount: runtimeStats.hitsDuringCatalogsCount,
    uniqueCatalogImageUrls: runtimeStats.uniqueCatalogImageUrls,
    uniqueHomeImageUrls: runtimeStats.uniqueHomeImageUrls,
    persistentCacheHits: runtimeStats.persistentCacheHits,
    cacheLayerDownloads: runtimeStats.cacheLayerDownloads,
    deduplicatedDownloads: runtimeStats.deduplicatedDownloadsCount,
    downloadFailures: runtimeStats.downloadFailuresCount,
    bytesTransferredByCache: runtimeStats.bytesTransferredByCache,
    bytesStoredCurrently: runtimeStats.bytesStoredCurrently,
    storedEntriesCount: runtimeStats.storedEntriesCount,
    evictedEntriesCount: runtimeStats.evictedEntriesCount,
    corruptedLocalRecoveriesCount: runtimeStats.corruptedLocalRecoveriesCount,
    priorityTargetCount: runtimeStats.priorityTargetCount,
    priorityFoundOnDiskCount: runtimeStats.priorityFoundOnDiskCount,
    priorityDownloadedSuccessCount: runtimeStats.priorityDownloadedSuccessCount,
    priorityFailedCount: runtimeStats.priorityFailedCount,
    priorityPendingAtReleaseCount: runtimeStats.priorityPendingAtReleaseCount,
    localRecoveryTimeMs: runtimeStats.localRecoveryTimeMs,
    planBuildTotalMs: runtimeStats.planBuildTotalMs,
    planCategorySelectionAndSortMs: runtimeStats.planCategorySelectionAndSortMs,
    planUniqueUrlCountMs: runtimeStats.planUniqueUrlCountMs,
    priorityCoversPreparationMs: runtimeStats.priorityCoversPreparationMs,
    maxSimultaneousNativeTasks: runtimeStats.maxSimultaneousNativeTasks,
    cancelledStaleQueueTasksCount: runtimeStats.cancelledStaleQueueTasksCount,
  });
}

export function getImageCacheRuntimeStatsSnapshot(): ImageCacheRuntimeStats {
  return { ...runtimeStats };
}

export function isAndroidPersistentImageCacheAvailable(): boolean {
  if (forceAndroidImageCacheEnabledForTest !== null) {
    return forceAndroidImageCacheEnabledForTest;
  }
  if (pluginOverrideForTest !== null) {
    return true;
  }
  try {
    return (
      typeof Capacitor !== 'undefined' &&
      typeof Capacitor.isNativePlatform === 'function' &&
      Capacitor.isNativePlatform() &&
      typeof Capacitor.getPlatform === 'function' &&
      Capacitor.getPlatform() === 'android'
    );
  } catch {
    return false;
  }
}

export function setAndroidImageCacheTestOverride(config: {
  plugin?: ImageDiskCacheNativePlugin | null;
  convertFileSrc?: ((filePath: string) => string) | null;
  enabled?: boolean | null;
}): void {
  if (config.plugin !== undefined) {
    pluginOverrideForTest = config.plugin;
  }
  if (config.convertFileSrc !== undefined) {
    convertFileSrcOverrideForTest = config.convertFileSrc;
  }
  if (config.enabled !== undefined) {
    forceAndroidImageCacheEnabledForTest = config.enabled;
  }
}

function getNativeImageCachePlugin(): ImageDiskCacheNativePlugin {
  if (pluginOverrideForTest) {
    return pluginOverrideForTest;
  }
  if (!registeredPlugin) {
    registeredPlugin = registerPlugin<ImageDiskCacheNativePlugin>(IMAGE_DISK_CACHE_PLUGIN_NAME);
  }
  return registeredPlugin;
}

function convertImageFilePathToWebViewUrl(filePath: string): string {
  if (convertFileSrcOverrideForTest) {
    return convertFileSrcOverrideForTest(filePath);
  }
  if (typeof Capacitor?.convertFileSrc === 'function') {
    return Capacitor.convertFileSrc(filePath);
  }
  return `http://localhost${CAPACITOR_FILE_PATH_PREFIX}${filePath}`;
}

/**
 * Verifica se os metadados HTTP da entrada exigem revalidação condicional (`no-cache` ou `max-age` expirado).
 */
export function needsEntryHttpRevalidation(
  entry: { cacheControl?: string | null; createdAtMs?: number } | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!entry || !entry.cacheControl) return false;
  const cc = entry.cacheControl.toLowerCase();
  if (cc.includes('no-cache') || cc.includes('max-age=0')) {
    return true;
  }
  const match = cc.match(/max-age=(\d+)/);
  if (match && match[1]) {
    const maxAgeSec = parseInt(match[1], 10);
    if (!Number.isNaN(maxAgeSec)) {
      if (maxAgeSec <= 0) return true;
      const created = typeof entry.createdAtMs === 'number' && entry.createdAtMs > 0 ? entry.createdAtMs : 0;
      if (created > 0 && nowMs - created >= maxAgeSec * 1000) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Valida que o arquivo local retornado pelo plugin pertence estritamente ao diretório
 * persistente privado `<filesDir>/nc_image_cache/img_<sha256>.<ext>`.
 */
export function isValidPersistentImageFileReference(
  fileName: unknown,
  filePath: unknown
): fileName is string {
  if (typeof fileName !== 'string' || !SAFE_IMAGE_FILE_NAME_REGEX.test(fileName)) {
    return false;
  }
  if (
    typeof filePath !== 'string' ||
    !filePath ||
    filePath !== filePath.trim() ||
    !filePath.startsWith('/') ||
    filePath.startsWith('//') ||
    filePath.includes('..') ||
    filePath.includes('\\') ||
    filePath.includes('?') ||
    filePath.includes('#')
  ) {
    return false;
  }
  const slashIdx = filePath.lastIndexOf('/');
  if (slashIdx <= 0) return false;
  const parentDir = filePath.slice(0, slashIdx);
  const finalSeg = filePath.slice(slashIdx + 1);
  if (finalSeg !== fileName) return false;
  return DEDICATED_ANDROID_IMAGE_CACHE_DIR_REGEX.test(parentDir);
}

const MAX_URL_SHA256_CACHE_ENTRIES = 6000;
const urlToShaKeyCache = new Map<string, string>();

/**
 * Calcula o hash SHA-256 hex determinístico de 64 caracteres de uma URL em UTF-8
 * (idêntico ao algoritmo MessageDigest("SHA-256") do plugin Java).
 */
export function computeDeterministicUrlSha256Hex(url: string): string {
  const normalized = String(url || '').trim();
  const cachedHash = urlToShaKeyCache.get(normalized);
  if (cachedHash) {
    return cachedHash;
  }
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  const utf8Bytes: number[] = [];
  for (let i = 0; i < normalized.length; i++) {
    let code = normalized.charCodeAt(i);
    if (code < 0x80) {
      utf8Bytes.push(code);
    } else if (code < 0x800) {
      utf8Bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0xd800 || code >= 0xe000) {
      utf8Bytes.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    } else {
      i++;
      code = 0x10000 + (((code & 0x3ff) << 10) | (normalized.charCodeAt(i) & 0x3ff));
      utf8Bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }

  const bitLen = utf8Bytes.length * 8;
  utf8Bytes.push(0x80);
  while ((utf8Bytes.length % 64) !== 56) {
    utf8Bytes.push(0);
  }
  const highBits = Math.floor(bitLen / 0x100000000);
  const lowBits = bitLen >>> 0;
  utf8Bytes.push(
    (highBits >>> 24) & 0xff,
    (highBits >>> 16) & 0xff,
    (highBits >>> 8) & 0xff,
    highBits & 0xff,
    (lowBits >>> 24) & 0xff,
    (lowBits >>> 16) & 0xff,
    (lowBits >>> 8) & 0xff,
    lowBits & 0xff
  );

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Int32Array(64);
  const rotr = (n: number, x: number) => (x >>> n) | (x << (32 - n));

  for (let i = 0; i < utf8Bytes.length; i += 64) {
    for (let t = 0; t < 16; t++) {
      const idx = i + t * 4;
      w[t] =
        ((utf8Bytes[idx] << 24) |
          (utf8Bytes[idx + 1] << 16) |
          (utf8Bytes[idx + 2] << 8) |
          utf8Bytes[idx + 3]) |
        0;
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(7, w[t - 15]) ^ rotr(18, w[t - 15]) ^ (w[t - 15] >>> 3);
      const s1 = rotr(17, w[t - 2]) ^ rotr(19, w[t - 2]) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let t = 0; t < 64; t++) {
      const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t] + w[t]) | 0;
      const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }

  const toHex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  const computed =
    toHex(h0) +
    toHex(h1) +
    toHex(h2) +
    toHex(h3) +
    toHex(h4) +
    toHex(h5) +
    toHex(h6) +
    toHex(h7);

  if (urlToShaKeyCache.size >= MAX_URL_SHA256_CACHE_ENTRIES) {
    const firstKey = urlToShaKeyCache.keys().next().value;
    if (firstKey !== undefined) {
      urlToShaKeyCache.delete(firstKey);
    }
  }
  urlToShaKeyCache.set(normalized, computed);
  return computed;
}

/**
 * Hidrata o mapa em memória a partir do índice persistente do plugin Android.
 * Seguro para chamar múltiplas vezes; reconcilia entradas por hash SHA-256.
 */
const hydratedByShaKeyMap = new Map<string, InMemoryResolvedEntry>();

function applyEvictedKeysToInMemoryIndex(evictedKeys: string[] | undefined): void {
  if (!Array.isArray(evictedKeys) || evictedKeys.length === 0) return;
  for (const key of evictedKeys) {
    if (!key) continue;
    const entry = hydratedByShaKeyMap.get(key);
    hydratedByShaKeyMap.delete(key);
    if (entry?.url) {
      resolvedUrlToEntryMap.delete(entry.url);
    }
    const mappedUrl = shaKeyToUrlMap.get(key);
    if (mappedUrl) {
      resolvedUrlToEntryMap.delete(mappedUrl);
    }
    const pendingIdx = pendingTouchedKeys.indexOf(key);
    if (pendingIdx >= 0) {
      pendingTouchedKeys.splice(pendingIdx, 1);
    }
  }
  runtimeStats.storedEntriesCount = hydratedByShaKeyMap.size;
}

export async function ensureAndroidImageCacheHydrated(): Promise<void> {
  if (!isAndroidPersistentImageCacheAvailable()) {
    return;
  }
  if (activeLogoutClearPromise) {
    await activeLogoutClearPromise;
  }
  if (isHydrated) {
    return;
  }
  if (hydrationPromise) {
    return hydrationPromise;
  }

  const epochAtStart = currentSessionEpoch;
  const startMono = nowMonotonicMs();

  hydrationPromise = (async () => {
    try {
      if (activeLogoutClearPromise) {
        await activeLogoutClearPromise;
      }
      if (currentSessionEpoch !== epochAtStart) {
        return;
      }
      const plugin = getNativeImageCachePlugin();
      const res = await plugin.getHydratedIndex();
      if (currentSessionEpoch !== epochAtStart) {
        return;
      }

      const elapsedMs = Math.max(0, nowMonotonicMs() - startMono);
      runtimeStats.localRecoveryTimeMs = elapsedMs;
      if (typeof res?.maxBytes === 'number' && res.maxBytes > 0) {
        runtimeStats.configuredMaxBytes = res.maxBytes;
      }
      if (typeof res?.totalBytes === 'number' && res.totalBytes >= 0) {
        runtimeStats.bytesStoredCurrently = res.totalBytes;
      }
      if (typeof res?.evictedEntriesCount === 'number' && res.evictedEntriesCount >= 0) {
        runtimeStats.evictedEntriesCount = res.evictedEntriesCount;
      }
      if (typeof res?.corruptedRecoveriesCount === 'number' && res.corruptedRecoveriesCount >= 0) {
        runtimeStats.corruptedLocalRecoveriesCount = res.corruptedRecoveriesCount;
      }

      const entries = Array.isArray(res?.entries) ? res.entries : [];
      for (const item of entries) {
        if (
          !item ||
          typeof item.key !== 'string' ||
          item.key.length !== 64 ||
          !isValidPersistentImageFileReference(item.fileName, item.filePath)
        ) {
          continue;
        }
        const convertedSrc = convertImageFilePathToWebViewUrl(item.filePath);
        const accessedStamp =
          typeof item.lastAccessedAtMs === 'number' && item.lastAccessedAtMs > 0
            ? item.lastAccessedAtMs
            : nextLogicalAccessStamp();
        if (accessedStamp > logicalAccessClock) {
          logicalAccessClock = accessedStamp;
        }
        const entryObj: InMemoryResolvedEntry = {
          url: shaKeyToUrlMap.get(item.key) || '',
          key: item.key,
          fileName: item.fileName,
          filePath: item.filePath,
          convertedSrc,
          byteSize: typeof item.byteSize === 'number' ? item.byteSize : 0,
          contentType: item.contentType,
          etag: item.etag ?? null,
          lastModified: item.lastModified ?? null,
          cacheControl: item.cacheControl ?? null,
          createdAtMs:
            typeof item.createdAtMs === 'number' && item.createdAtMs > 0
              ? item.createdAtMs
              : Date.now(),
          lastAccessedAtMs: accessedStamp,
        };
        hydratedByShaKeyMap.set(item.key, entryObj);
        if (entryObj.url) {
          resolvedUrlToEntryMap.set(entryObj.url, entryObj);
        }
      }

      runtimeStats.storedEntriesCount = hydratedByShaKeyMap.size;
      runtimeStats.initialHydratedEntriesCount = hydratedByShaKeyMap.size;
      isHydrated = true;
      syncStatsToCatalogDiagnostics();
    } catch {
      // Se falhar na hidratação inicial, opera sob demanda sem bloquear a UI
      isHydrated = true;
    } finally {
      hydrationPromise = null;
    }
  })();

  return hydrationPromise;
}

/**
 * Consulta síncrona imediata para `MediaImage.tsx`:
 * Se a imagem já estiver mapeada no cache persistente local e não exigir revalidação HTTP,
 * retorna a URL local convertida (`Capacitor.convertFileSrc`) imediatamente na montagem/remontagem
 * do cartão, evitando qualquer piscar ou nova requisição de rede, e agenda a sincronização da
 * recência de acesso (LRU) em lote para a camada nativa.
 */
export function getInstantCachedImageSrc(
  resolvedRemoteUrl: string | null | undefined,
  options?: { countHit?: boolean }
): string | null {
  if (!resolvedRemoteUrl || !isAndroidPersistentImageCacheAvailable() || activeLogoutClearPromise) {
    return null;
  }
  const trimmed = resolvedRemoteUrl.trim();
  if (!trimmed) return null;

  const direct = resolvedUrlToEntryMap.get(trimmed);
  if (direct) {
    if (needsEntryHttpRevalidation(direct)) {
      return null;
    }
    if (convertFileSrcOverrideForTest) {
      direct.convertedSrc = convertImageFilePathToWebViewUrl(direct.filePath);
    }
    direct.lastAccessedAtMs = nextLogicalAccessStamp();
    recordTouchedKeyForNativeSync(direct.key);
    if (options?.countHit) {
      runtimeStats.persistentCacheHits++;
      if (isCatalogTransferPhaseActive) {
        runtimeStats.hitsDuringCatalogsCount++;
      }
      syncStatsToCatalogDiagnostics();
    }
    return direct.convertedSrc;
  }

  const shaKey = computeDeterministicUrlSha256Hex(trimmed);
  shaKeyToUrlMap.set(shaKey, trimmed);
  const bySha = hydratedByShaKeyMap.get(shaKey);
  if (bySha) {
    if (needsEntryHttpRevalidation(bySha)) {
      return null;
    }
    if (convertFileSrcOverrideForTest) {
      bySha.convertedSrc = convertImageFilePathToWebViewUrl(bySha.filePath);
    }
    bySha.url = trimmed;
    bySha.lastAccessedAtMs = nextLogicalAccessStamp();
    recordTouchedKeyForNativeSync(bySha.key);
    resolvedUrlToEntryMap.set(trimmed, bySha);
    if (options?.countHit) {
      runtimeStats.persistentCacheHits++;
      if (isCatalogTransferPhaseActive) {
        runtimeStats.hitsDuringCatalogsCount++;
      }
      syncStatsToCatalogDiagnostics();
    }
    return bySha.convertedSrc;
  }

  return null;
}

const PRIORITY_WEIGHT: Record<ImagePreloadPriority, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
};

function getEffectiveMaxConcurrency(): number {
  if (isAnyVideoPlaybackActive()) {
    return 1;
  }
  const now = nowMonotonicMs();
  if (now - lastDpadActivityTimestampMs < 240) {
    // Durante rajadas rápidas de D-Pad, restringe a concorrência para não disputar CPU/IO
    return 2;
  }
  return 4;
}

export function notifyDpadNavigationActivityForImagePreload(): void {
  lastDpadActivityTimestampMs = nowMonotonicMs();
  if (dpadThrottleTimer !== null) {
    clearTimeout(dpadThrottleTimer);
  }
  dpadThrottleTimer = setTimeout(() => {
    dpadThrottleTimer = null;
    pumpAcquireQueue();
  }, 260);
}

export function setVideoPlaybackActiveForImagePreload(active: boolean): void {
  const next = Boolean(active);
  if (isMainVideoPlaybackActive !== next) {
    isMainVideoPlaybackActive = next;
    if (!isAnyVideoPlaybackActive()) {
      pumpAcquireQueue();
    }
  }
}

export function setLiveTvPreviewPlaybackActiveForImagePreload(active: boolean): void {
  const next = Boolean(active);
  if (isLiveTvPreviewPlaybackActive !== next) {
    isLiveTvPreviewPlaybackActive = next;
    if (!isAnyVideoPlaybackActive()) {
      pumpAcquireQueue();
    }
  }
}

function sortPendingQueue(): void {
  pendingQueue.sort((a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]);
}

function pumpAcquireQueue(): void {
  if (!isAndroidPersistentImageCacheAvailable()) {
    return;
  }
  const maxConc = getEffectiveMaxConcurrency();
  while (activeWorkersCount < maxConc && pendingQueue.length > 0) {
    // Enquanto os 6 catálogos iniciais estão em transferência, bloquear downloads remotos
    // não essenciais (permitindo apenas recuperação explícita forceRefresh se necessária)
    if (isCatalogTransferPhaseActive && !pendingQueue[0].forceRefresh) {
      break;
    }

    // Durante navegação D-Pad intensa ou vídeo ativo (player principal ou preview da TV ao Vivo),
    // tarefas de prioridade 'low' aguardam; e tarefas 'low' usam no máximo 1 worker simultâneo
    const now = nowMonotonicMs();
    const isDpadBurst = now - lastDpadActivityTimestampMs < 240;
    if (pendingQueue[0].priority === 'low') {
      if (isDpadBurst || isAnyVideoPlaybackActive() || activeWorkersCount >= 1) {
        break;
      }
    }

    const nextTask = pendingQueue.shift();
    if (!nextTask) break;
    nextTask.startedExecution = true;
    activeWorkersCount++;
    if (activeWorkersCount > runtimeStats.maxSimultaneousNativeTasks) {
      runtimeStats.maxSimultaneousNativeTasks = activeWorkersCount;
      syncStatsToCatalogDiagnostics();
    }
    void executeQueuedAcquireTask(nextTask).finally(() => {
      activeWorkersCount = Math.max(0, activeWorkersCount - 1);
      pumpAcquireQueue();
    });
  }
}

async function executeQueuedAcquireTask(task: QueuedAcquireTask): Promise<void> {
  const { url, forceRefresh, revalidate, epochAtEnqueue } = task;
  try {
    if (activeLogoutClearPromise) {
      await activeLogoutClearPromise;
    }
    await ensureAndroidImageCacheHydrated();

    if (currentSessionEpoch !== epochAtEnqueue) {
      throw new Error('Sessão de imagens reiniciada (logout).');
    }

    if (!forceRefresh && !revalidate) {
      const existingInstant = getInstantCachedImageSrc(url);
      if (existingInstant) {
        const entry = resolvedUrlToEntryMap.get(url);
        runtimeStats.persistentCacheHits++;
        if (isCatalogTransferPhaseActive) {
          runtimeStats.hitsDuringCatalogsCount++;
        }
        syncStatsToCatalogDiagnostics();
        const hitOutcome: AcquireCachedImageOutcome = {
          src: existingInstant,
          fromCache: true,
          isLocalFile: true,
          bypassedNoStore: false,
          byteSize: entry?.byteSize ?? 0,
        };
        settleTaskResolvers(task, hitOutcome, null);
        return;
      }
    }

    const startedDuringCatalogs = isCatalogTransferPhaseActive;
    const recentAccessedKeys = drainPendingTouchedKeys();
    const plugin = getNativeImageCachePlugin();
    const nativeRes: AcquireImageNativeResult = await plugin.acquireImage({
      url,
      forceRefresh,
      revalidate,
      connectTimeout: 10000,
      readTimeout: 15000,
      recentAccessedKeys: recentAccessedKeys.length > 0 ? recentAccessedKeys : undefined,
    });

    if (currentSessionEpoch !== epochAtEnqueue) {
      throw new Error('Sessão de imagens encerrada após transferência.');
    }

    if (Array.isArray(nativeRes?.evictedKeys) && nativeRes.evictedKeys.length > 0) {
      applyEvictedKeysToInMemoryIndex(nativeRes.evictedKeys);
    }

    if (typeof nativeRes?.totalBytes === 'number' && nativeRes.totalBytes >= 0) {
      runtimeStats.bytesStoredCurrently = nativeRes.totalBytes;
    }
    if (typeof nativeRes?.storedEntriesCount === 'number' && nativeRes.storedEntriesCount >= 0) {
      runtimeStats.storedEntriesCount = nativeRes.storedEntriesCount;
    }
    if (typeof nativeRes?.evictedEntriesCount === 'number' && nativeRes.evictedEntriesCount >= 0) {
      runtimeStats.evictedEntriesCount = nativeRes.evictedEntriesCount;
    }

    // Caso o servidor tenha retornado Cache-Control: no-store, usa inlineDataUrl (1 único GET) sem persistir no disco
    if (nativeRes?.bypassedNoStore) {
      const shaKey = nativeRes?.key || computeDeterministicUrlSha256Hex(url);
      hydratedByShaKeyMap.delete(shaKey);
      resolvedUrlToEntryMap.delete(url);
      const inlineSrc =
        typeof nativeRes.inlineDataUrl === 'string' && nativeRes.inlineDataUrl.startsWith('data:')
          ? nativeRes.inlineDataUrl
          : url;
      if (startedDuringCatalogs) {
        runtimeStats.downloadsDuringCatalogsCount++;
      }
      syncStatsToCatalogDiagnostics();
      settleTaskResolvers(
        task,
        {
          src: inlineSrc,
          fromCache: false,
          isLocalFile: false,
          bypassedNoStore: true,
          byteSize: typeof nativeRes?.byteSize === 'number' ? nativeRes.byteSize : 0,
        },
        null
      );
      return;
    }

    const fileName = nativeRes?.fileName ?? null;
    const filePath = nativeRes?.filePath ?? null;
    if (!isValidPersistentImageFileReference(fileName, filePath)) {
      throw new Error('Referência de arquivo de imagem persistente inválida.');
    }

    const validFilePath = filePath as string;
    const convertedSrc = convertImageFilePathToWebViewUrl(validFilePath);
    const shaKey = nativeRes?.key || computeDeterministicUrlSha256Hex(url);
    const byteSize = typeof nativeRes?.byteSize === 'number' ? nativeRes.byteSize : 0;
    const stamp = nextLogicalAccessStamp();
    if (typeof nativeRes?.lastAccessedAtMs === 'number' && nativeRes.lastAccessedAtMs > logicalAccessClock) {
      logicalAccessClock = nativeRes.lastAccessedAtMs;
    }

    const entryObj: InMemoryResolvedEntry = {
      url,
      key: shaKey,
      fileName,
      filePath: validFilePath,
      convertedSrc,
      byteSize,
      contentType: nativeRes?.contentType,
      etag: nativeRes?.etag ?? null,
      lastModified: nativeRes?.lastModified ?? null,
      cacheControl: nativeRes?.cacheControl ?? null,
      createdAtMs:
        typeof nativeRes?.createdAtMs === 'number' && nativeRes.createdAtMs > 0
          ? nativeRes.createdAtMs
          : Date.now(),
      lastAccessedAtMs:
        typeof nativeRes?.lastAccessedAtMs === 'number' && nativeRes.lastAccessedAtMs > 0
          ? nativeRes.lastAccessedAtMs
          : stamp,
    };

    shaKeyToUrlMap.set(shaKey, url);
    hydratedByShaKeyMap.set(shaKey, entryObj);
    resolvedUrlToEntryMap.set(url, entryObj);

    // Sincronizar o mapa em memória caso o plugin tenha removido entradas antigas por LRU
    if (
      typeof nativeRes?.storedEntriesCount === 'number' &&
      hydratedByShaKeyMap.size > nativeRes.storedEntriesCount
    ) {
      await reconcileInMemoryEntriesWithNativeIndex(epochAtEnqueue);
    }

    if (nativeRes.hit) {
      runtimeStats.persistentCacheHits++;
      if (startedDuringCatalogs) {
        runtimeStats.hitsDuringCatalogsCount++;
      }
    } else {
      runtimeStats.cacheLayerDownloads++;
      runtimeStats.bytesTransferredByCache += byteSize;
      if (startedDuringCatalogs) {
        runtimeStats.downloadsDuringCatalogsCount++;
      }
    }
    syncStatsToCatalogDiagnostics();

    settleTaskResolvers(
      task,
      {
        src: convertedSrc,
        fromCache: Boolean(nativeRes.hit),
        isLocalFile: true,
        bypassedNoStore: false,
        byteSize,
      },
      null
    );
  } catch (err: any) {
    if (currentSessionEpoch === epochAtEnqueue) {
      runtimeStats.downloadFailuresCount++;
      syncStatsToCatalogDiagnostics();
    }
    const errorObj = err instanceof Error ? err : new Error(String(err || 'Falha no cache de imagem'));
    settleTaskResolvers(task, null, errorObj);
  }
}

async function reconcileInMemoryEntriesWithNativeIndex(expectedEpoch: number): Promise<void> {
  try {
    const plugin = getNativeImageCachePlugin();
    const snap = await plugin.getHydratedIndex();
    if (currentSessionEpoch !== expectedEpoch) return;
    const validKeys = new Set<string>();
    const entries = Array.isArray(snap?.entries) ? snap.entries : [];
    for (const e of entries) {
      if (e && typeof e.key === 'string') {
        validKeys.add(e.key);
      }
    }
    for (const [k, entry] of Array.from(hydratedByShaKeyMap.entries())) {
      if (!validKeys.has(k)) {
        hydratedByShaKeyMap.delete(k);
        if (entry.url) {
          resolvedUrlToEntryMap.delete(entry.url);
        }
        const mappedUrl = shaKeyToUrlMap.get(k);
        if (mappedUrl) {
          resolvedUrlToEntryMap.delete(mappedUrl);
        }
      }
    }
    if (typeof snap?.totalBytes === 'number') {
      runtimeStats.bytesStoredCurrently = snap.totalBytes;
    }
    runtimeStats.storedEntriesCount = hydratedByShaKeyMap.size;
  } catch {
    // Ignora falha de reconciliação secundária
  }
}

function settleTaskResolvers(
  task: QueuedAcquireTask,
  outcome: AcquireCachedImageOutcome | null,
  error: Error | null
): void {
  inFlightTasksByUrl.delete(task.url);
  for (const r of task.resolvers) {
    r.cleanupAbort?.();
    if (outcome) {
      r.resolve(outcome);
    } else {
      r.reject(error || new Error('Falha ao adquirir imagem.'));
    }
  }
}

function attachResolverWithAbort(
  task: QueuedAcquireTask,
  resolve: (res: AcquireCachedImageOutcome) => void,
  reject: (err: Error) => void,
  signal?: AbortSignal
): void {
  const resolverEntry: QueuedAcquireResolver = { resolve, reject };
  if (signal) {
    const onAbort = () => {
      resolverEntry.cleanupAbort?.();
      const idx = task.resolvers.indexOf(resolverEntry);
      if (idx >= 0) {
        task.resolvers.splice(idx, 1);
      }
      reject(new Error('Requisição de imagem cancelada (cartão desmontado).'));
      // Se a tarefa ainda estava aguardando na fila (não iniciou worker nativo) e não restam interessados,
      // remove da fila para não atrasar os cartões visíveis da categoria atual!
      if (!task.startedExecution && task.resolvers.length === 0) {
        const qIdx = pendingQueue.indexOf(task);
        if (qIdx >= 0) {
          pendingQueue.splice(qIdx, 1);
        }
        if (inFlightTasksByUrl.get(task.url) === task) {
          inFlightTasksByUrl.delete(task.url);
        }
        runtimeStats.cancelledStaleQueueTasksCount++;
        syncStatsToCatalogDiagnostics();
      }
    };
    resolverEntry.cleanupAbort = () => {
      signal.removeEventListener('abort', onAbort);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  }
  task.resolvers.push(resolverEntry);
}

/**
 * Adquire uma imagem do cache persistente (ou baixa e persiste sob demanda com deduplicação).
 * No navegador Web (fora do APK Android), retorna diretamente a URL remota resolvida.
 */
export async function acquireCachedImage(
  resolvedRemoteUrl: string,
  options?: {
    priority?: ImagePreloadPriority;
    forceRefresh?: boolean;
    revalidate?: boolean;
    signal?: AbortSignal;
  }
): Promise<AcquireCachedImageOutcome> {
  const trimmed = String(resolvedRemoteUrl || '').trim();
  if (!trimmed) {
    throw new Error('URL de imagem vazia.');
  }
  if (options?.signal?.aborted) {
    throw new Error('Requisição de imagem cancelada.');
  }

  if (!isAndroidPersistentImageCacheAvailable()) {
    return {
      src: trimmed,
      fromCache: false,
      isLocalFile: false,
      bypassedNoStore: false,
      byteSize: 0,
    };
  }

  if (activeLogoutClearPromise) {
    await activeLogoutClearPromise;
  }
  if (options?.signal?.aborted) {
    throw new Error('Requisição de imagem cancelada.');
  }

  const priority: ImagePreloadPriority = options?.priority ?? 'normal';
  const forceRefresh = Boolean(options?.forceRefresh);
  const existingEntry =
    resolvedUrlToEntryMap.get(trimmed) ||
    hydratedByShaKeyMap.get(computeDeterministicUrlSha256Hex(trimmed));
  const revalidate =
    Boolean(options?.revalidate) ||
    (!forceRefresh && Boolean(existingEntry && needsEntryHttpRevalidation(existingEntry)));

  if (!forceRefresh && !revalidate) {
    const instantSrc = getInstantCachedImageSrc(trimmed);
    if (instantSrc) {
      const entry = resolvedUrlToEntryMap.get(trimmed);
      runtimeStats.persistentCacheHits++;
      if (isCatalogTransferPhaseActive) {
        runtimeStats.hitsDuringCatalogsCount++;
      }
      syncStatsToCatalogDiagnostics();
      return {
        src: instantSrc,
        fromCache: true,
        isLocalFile: true,
        bypassedNoStore: false,
        byteSize: entry?.byteSize ?? 0,
      };
    }
  }

  const existingTask = inFlightTasksByUrl.get(trimmed);
  if (existingTask && existingTask.epochAtEnqueue === currentSessionEpoch) {
    runtimeStats.deduplicatedDownloadsCount++;
    if (PRIORITY_WEIGHT[priority] > PRIORITY_WEIGHT[existingTask.priority]) {
      existingTask.priority = priority;
      sortPendingQueue();
    }
    syncStatsToCatalogDiagnostics();
    return new Promise<AcquireCachedImageOutcome>((resolve, reject) => {
      attachResolverWithAbort(existingTask, resolve, reject, options?.signal);
    });
  }

  return new Promise<AcquireCachedImageOutcome>((resolve, reject) => {
    const newTask: QueuedAcquireTask = {
      url: trimmed,
      priority,
      forceRefresh,
      revalidate,
      epochAtEnqueue: currentSessionEpoch,
      startedExecution: false,
      resolvers: [],
    };
    attachResolverWithAbort(newTask, resolve, reject, options?.signal);
    inFlightTasksByUrl.set(trimmed, newTask);
    pendingQueue.push(newTask);
    sortPendingQueue();
    pumpAcquireQueue();
  });
}

/**
 * Quando um arquivo local falha ao decodificar/renderizar no `<img>` (arquivo truncado,
 * removido externamente ou corrompido), invalida imediatamente a entrada no índice em memória
 * e no disco nativo e baixa novamente da URL original do provedor sob demanda.
 */
export async function recoverFromCorruptedLocalImage(
  resolvedRemoteUrl: string
): Promise<AcquireCachedImageOutcome> {
  const trimmed = String(resolvedRemoteUrl || '').trim();
  if (!trimmed || !isAndroidPersistentImageCacheAvailable()) {
    return {
      src: trimmed,
      fromCache: false,
      isLocalFile: false,
      bypassedNoStore: false,
      byteSize: 0,
    };
  }

  const shaKey = computeDeterministicUrlSha256Hex(trimmed);
  resolvedUrlToEntryMap.delete(trimmed);
  hydratedByShaKeyMap.delete(shaKey);

  try {
    const plugin = getNativeImageCachePlugin();
    const invRes = await plugin.invalidateImage({
      url: trimmed,
      key: shaKey,
      corruptedRecovery: true,
    });
    runtimeStats.corruptedLocalRecoveriesCount =
      typeof invRes?.corruptedRecoveriesCount === 'number'
        ? invRes.corruptedRecoveriesCount
        : runtimeStats.corruptedLocalRecoveriesCount + 1;
    if (typeof invRes?.totalBytes === 'number') {
      runtimeStats.bytesStoredCurrently = invRes.totalBytes;
    }
    runtimeStats.storedEntriesCount = hydratedByShaKeyMap.size;
    syncStatsToCatalogDiagnostics();
  } catch {
    runtimeStats.corruptedLocalRecoveriesCount++;
    syncStatsToCatalogDiagnostics();
  }

  return acquireCachedImage(trimmed, {
    priority: 'critical',
    forceRefresh: true,
  });
}

/**
 * Configura o limite máximo em bytes do cache persistente (padrão 120 MB) e aplica LRU imediatamente.
 */
export async function configureImageCacheStorageBudget(maxBytes: number): Promise<void> {
  const clamped = Math.max(1024, Math.floor(maxBytes));
  runtimeStats.configuredMaxBytes = clamped;
  if (!isAndroidPersistentImageCacheAvailable()) {
    return;
  }
  if (activeLogoutClearPromise) {
    await activeLogoutClearPromise;
  }
  const epochNow = currentSessionEpoch;
  try {
    const recentAccessedKeys = drainPendingTouchedKeys();
    const plugin = getNativeImageCachePlugin();
    const res = await plugin.configureCache({
      maxBytes: clamped,
      recentAccessedKeys: recentAccessedKeys.length > 0 ? recentAccessedKeys : undefined,
    });
    if (Array.isArray(res?.evictedKeys) && res.evictedKeys.length > 0) {
      applyEvictedKeysToInMemoryIndex(res.evictedKeys);
    }
    if (typeof res?.evictedEntriesCount === 'number') {
      runtimeStats.evictedEntriesCount = res.evictedEntriesCount;
    }
    await reconcileInMemoryEntriesWithNativeIndex(epochNow);
    syncStatsToCatalogDiagnostics();
  } catch {
    // Ignora erro de configuração
  }
}

function clearCooperativeUrlCountTimers(): void {
  if (cooperativeUrlCountTimers.length === 0) return;
  for (const timer of cooperativeUrlCountTimers) {
    clearTimeout(timer);
  }
  cooperativeUrlCountTimers = [];
}

/**
 * Limpa integralmente o cache de imagens (memória, fila de pré-carregamento, downloads em andamento,
 * categorias visitadas e diretório persistente no disco) durante o logout.
 * Garante serialização caso uma nova sessão inicie imediatamente enquanto a limpeza estiver em curso.
 */
export async function clearImageCacheOnLogout(): Promise<void> {
  currentSessionEpoch++;
  clearCooperativeUrlCountTimers();
  resolvedUrlToEntryMap.clear();
  hydratedByShaKeyMap.clear();
  shaKeyToUrlMap.clear();
  pendingTouchedKeys.splice(0, pendingTouchedKeys.length);
  isHydrated = false;
  hydrationPromise = null;
  isMainVideoPlaybackActive = false;
  isLiveTvPreviewPlaybackActive = false;
  isCatalogTransferPhaseActive = false;

  // Cancelar todas as tarefas pendentes na fila e em andamento
  const tasksToCancel = [
    ...pendingQueue.splice(0, pendingQueue.length),
    ...Array.from(inFlightTasksByUrl.values()),
  ];
  inFlightTasksByUrl.clear();
  for (const t of tasksToCancel) {
    for (const r of t.resolvers) {
      r.cleanupAbort?.();
      r.reject(new Error('Cache de imagens limpo no logout.'));
    }
  }

  runtimeStats.bytesStoredCurrently = 0;
  runtimeStats.storedEntriesCount = 0;
  clearVisitedShowcaseCategories();

  const runClear = (async () => {
    if (isAndroidPersistentImageCacheAvailable()) {
      try {
        const plugin = getNativeImageCachePlugin();
        await plugin.clearAll();
      } catch {
        // Ignora erro de limpeza nativa
      }
    }
    syncStatsToCatalogDiagnostics();
  })();

  const trackedPromise = runClear.finally(() => {
    if (activeLogoutClearPromise === trackedPromise) {
      activeLogoutClearPromise = null;
    }
  });
  activeLogoutClearPromise = trackedPromise;
  await trackedPromise;
}

// ============================================================================
// Histórico leve de categorias visitadas para pré-carregamento inteligente
// ============================================================================

export function recordVisitedShowcaseCategory(categoryKey: string): void {
  const clean = String(categoryKey || '').trim();
  if (!clean) return;
  const current = getVisitedShowcaseCategories();
  const filtered = current.filter((k) => k !== clean);
  filtered.unshift(clean);
  if (filtered.length > MAX_VISITED_CATEGORIES_HISTORY) {
    filtered.length = MAX_VISITED_CATEGORIES_HISTORY;
  }
  safeSetStorage(VISITED_CATEGORIES_STORAGE_KEY, JSON.stringify(filtered));
}

export function getVisitedShowcaseCategories(): string[] {
  const res = safeReadStorage(VISITED_CATEGORIES_STORAGE_KEY);
  if (!res.success || !res.value) return [];
  try {
    const parsed = JSON.parse(res.value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0);
  } catch {
    return [];
  }
}

export function clearVisitedShowcaseCategories(): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(VISITED_CATEGORIES_STORAGE_KEY);
      return;
    }
  } catch {
    // Fallback to safeSetStorage
  }
  safeSetStorage(VISITED_CATEGORIES_STORAGE_KEY, '[]');
}

// ============================================================================
// Cálculo adaptativo e preparação inicial de capas prioritárias na abertura
// ============================================================================

export interface AdaptiveInitialImageBudget {
  posterCardsPerRow: number;
  landscapeCardsPerRow: number;
  visibleRowsCount: number;
  nextRowsCount: number;
}

/**
 * Calcula quantos cartões cabem horizontalmente na viewport atual do dispositivo
 * (Android TV 1080p/4K, TV Box 720p, tablet ou celular), alinhado às métricas reais de CSS
 * de `HorizontalRow.tsx` (15.5rem / 9.25rem no modo TV e w-72 / w-44 no modo padrão),
 * somando 2 cartões de margem para rolagem horizontal imediata.
 */
export function computeAdaptiveInitialCardsPerRow(params?: {
  viewportWidth?: number;
  viewportHeight?: number;
  displayMode?: DisplayMode;
  tvScale?: number;
}): AdaptiveInitialImageBudget {
  const width =
    typeof params?.viewportWidth === 'number' && params.viewportWidth > 0
      ? params.viewportWidth
      : typeof window !== 'undefined' && window.innerWidth > 0
        ? window.innerWidth
        : 1280;

  const isTv = params?.displayMode === 'tv';
  if (isTv) {
    const rawScale = typeof params?.tvScale === 'number' && params.tvScale > 0 ? params.tvScale : 100;
    const clampedScale = Math.max(0.75, Math.min(1.25, rawScale / 100));
    const remPx = 16 * clampedScale;
    const gapPx = 1.0 * remPx;
    const posterCardStepPx = Math.max(90, Math.round(9.25 * remPx + gapPx));
    const landscapeCardStepPx = Math.max(140, Math.round(15.5 * remPx + gapPx));

    const visiblePosters = Math.max(3, Math.ceil(width / posterCardStepPx));
    const visibleLandscapes = Math.max(2, Math.ceil(width / landscapeCardStepPx));

    return {
      posterCardsPerRow: Math.min(14, visiblePosters + 2),
      landscapeCardsPerRow: Math.min(10, visibleLandscapes + 2),
      visibleRowsCount: 3,
      nextRowsCount: 2,
    };
  }

  const isMd = width >= 768;
  const posterCardStepPx = isMd ? 176 + 16 : 128 + 16;
  const landscapeCardStepPx = isMd ? 288 + 16 : 224 + 16;

  const visiblePosters = Math.max(3, Math.ceil(width / posterCardStepPx));
  const visibleLandscapes = Math.max(2, Math.ceil(width / landscapeCardStepPx));

  return {
    posterCardsPerRow: Math.min(14, visiblePosters + 2),
    landscapeCardsPerRow: Math.min(10, visibleLandscapes + 2),
    visibleRowsCount: 3,
    nextRowsCount: 2,
  };
}

/**
 * Extrai com segurança a referência bruta de imagem de um registro de catálogo Xtream
 * (canal ao vivo, filme VOD ou série) ou de uma string/array de strings.
 */
export function extractCatalogItemRawImage(item: any): string | null {
  if (!item) return null;
  if (typeof item === 'string' || Array.isArray(item)) {
    return normalizeImageSource(item);
  }
  if (typeof item !== 'object') return null;
  const candidate =
    item.stream_icon ??
    item.cover ??
    item.cover_big ??
    item.movie_image ??
    item.logo ??
    item.backdrop_path ??
    null;
  return normalizeImageSource(candidate);
}

function extractRawCoverFromItem(item: any): unknown {
  return extractCatalogItemRawImage(item);
}

export interface HomeStartupImagePlan {
  /** 1. Imagem principal do HeroBanner */
  tier1HeroUrls: string[];
  /** 2. Capas visíveis das primeiras fileiras da Home */
  tier2FirstRowsVisibleUrls: string[];
  /** 3. Capas das próximas fileiras imediatas da Home */
  tier3NextRowsUrls: string[];
  /** 4. Capas das categorias seguintes / visitadas recentemente */
  tier4VisitedCategoryUrls: string[];
  /** Lista unificada deduplicada das camadas prioritárias (1 + 2 + 3) para o carregamento inicial */
  priorityUrls: string[];
  /** Total de URLs únicas de imagem no catálogo inteiro */
  uniqueCatalogImageUrlsCount: number;
  /** Total de URLs únicas de imagem nas fileiras montadas da Home */
  uniqueHomeImageUrlsCount: number;
  posterCardsPerRow: number;
  landscapeCardsPerRow: number;
  planBuildTotalMs: number;
  planCategorySelectionAndSortMs: number;
  planUniqueUrlCountMs: number;
}

/**
 * Executa a contagem diagnóstica de URLs únicas do catálogo e das fileiras da Home
 * de forma cooperativa em pequenos lotes assíncronos (`setTimeout(..., 0)`), evitando
 * bloquear a thread principal durante a liberação da Home em catálogos grandes (40k+ itens).
 */
export function scheduleCooperativeCatalogUrlCount(params: {
  serverUrl?: string | null;
  allLiveStreams?: any[];
  allVodStreams?: any[];
  allSeriesStreams?: any[];
  vodCategories?: any[];
  seriesCategories?: any[];
  continueWatchingItems?: any[];
  batchSize?: number;
  onComplete?: (result: {
    uniqueCatalogImageUrlsCount: number;
    uniqueHomeImageUrlsCount: number;
    activeComputeMs: number;
  }) => void;
}): void {
  clearCooperativeUrlCountTimers();
  const {
    serverUrl,
    allLiveStreams = [],
    allVodStreams = [],
    allSeriesStreams = [],
    vodCategories = [],
    seriesCategories = [],
    continueWatchingItems = [],
    batchSize = 1800,
    onComplete,
  } = params;

  const epochAtSchedule = currentSessionEpoch;
  const catalogSet = new Set<string>();
  const homeSet = new Set<string>();
  let totalComputeMs = 0;

  const vodIndex = getOrCreateVodIndex(allVodStreams);
  const seriesIndex = getOrCreateSeriesIndex(allSeriesStreams);
  const heroItems = getHeroBannerItems(allVodStreams, allSeriesStreams);

  // Coletar referências leves dos itens das fileiras da Home (sem ordenar 100 categorias;
  // getByCategory(id).slice(0, 24) contém o conjunto das fileiras de categorias)
  const homeItemsFlat: any[] = [];
  for (let i = 0; i < Math.min(2, heroItems.length); i++) {
    homeItemsFlat.push(heroItems[i]);
  }
  if (Array.isArray(continueWatchingItems) && continueWatchingItems.length > 0) {
    homeItemsFlat.push(...continueWatchingItems.slice(0, 24));
  }
  if (allLiveStreams.length > 0) {
    homeItemsFlat.push(...allLiveStreams.slice(0, 24));
  }
  if (allVodStreams.length > 0) {
    homeItemsFlat.push(...vodIndex.getSortedAll().slice(0, 24));
  }
  if (allSeriesStreams.length > 0) {
    homeItemsFlat.push(...seriesIndex.getSortedAll().slice(0, 24));
  }
  for (const c of Array.isArray(vodCategories) ? vodCategories : []) {
    if (!c) continue;
    const catItems = vodIndex.getByCategory(c.category_id);
    if (catItems.length > 0) {
      homeItemsFlat.push(...catItems.slice(0, 24));
    }
  }
  for (const c of Array.isArray(seriesCategories) ? seriesCategories : []) {
    if (!c) continue;
    const catItems = seriesIndex.getByCategory(c.category_id);
    if (catItems.length > 0) {
      homeItemsFlat.push(...catItems.slice(0, 24));
    }
  }

  const arraysToScan: Array<{ arr: any[]; target: 'catalog' | 'home'; isHeroCheck?: boolean }> = [
    { arr: homeItemsFlat, target: 'home', isHeroCheck: true },
    { arr: allLiveStreams, target: 'catalog' },
    { arr: allVodStreams, target: 'catalog' },
    { arr: allSeriesStreams, target: 'catalog' },
  ];

  let arrayIdx = 0;
  let itemIdx = 0;

  const runBatch = () => {
    if (currentSessionEpoch !== epochAtSchedule) return;
    const sliceStart = nowMonotonicMs();
    let processed = 0;

    while (arrayIdx < arraysToScan.length && processed < batchSize) {
      const current = arraysToScan[arrayIdx];
      const arr = current.arr;
      while (itemIdx < arr.length && processed < batchSize) {
        const item = arr[itemIdx++];
        processed++;
        if (current.target === 'home') {
          if (current.isHeroCheck && itemIdx <= 2) {
            const backdropRaw =
              (Array.isArray(item?.backdrop_path) ? item.backdrop_path[0] : item?.backdrop_path) ||
              item?.cover_big ||
              extractRawCoverFromItem(item);
            const backdropUrl = buildDirectImageUrl(backdropRaw, serverUrl);
            if (backdropUrl) homeSet.add(backdropUrl);
          }
          const raw = extractRawCoverFromItem(item);
          const resolved = buildDirectImageUrl(raw, serverUrl);
          if (resolved) homeSet.add(resolved);
        } else {
          const raw = extractRawCoverFromItem(item);
          const resolved = buildDirectImageUrl(raw, serverUrl);
          if (resolved) catalogSet.add(resolved);
        }
      }
      if (itemIdx >= arr.length) {
        arrayIdx++;
        itemIdx = 0;
      }
    }

    totalComputeMs += Math.max(0, nowMonotonicMs() - sliceStart);

    if (arrayIdx < arraysToScan.length) {
      const t = setTimeout(runBatch, 0);
      cooperativeUrlCountTimers.push(t);
    } else {
      clearCooperativeUrlCountTimers();
      runtimeStats.uniqueCatalogImageUrls = catalogSet.size;
      runtimeStats.uniqueHomeImageUrls = homeSet.size;
      runtimeStats.planUniqueUrlCountMs = totalComputeMs;
      syncStatsToCatalogDiagnostics();
      onComplete?.({
        uniqueCatalogImageUrlsCount: catalogSet.size,
        uniqueHomeImageUrlsCount: homeSet.size,
        activeComputeMs: totalComputeMs,
      });
    }
  };

  const firstTimer = setTimeout(runBatch, 0);
  cooperativeUrlCountTimers.push(firstTimer);
}

/**
 * Constrói o plano ordenado de imagens da Home (idêntico à seleção real de fileiras e cartões
 * do `CatalogShowcaseView.tsx`: HeroBanner, Continue Assistindo se houver, Canais em Destaque
 * com orçamento landscape, Filmes em Destaque, Séries em Destaque e categorias intercaladas
 * ordenadas apenas para as fileiras efetivamente inspecionadas nas Camadas 2, 3 e 4).
 *
 * Quando `deferFullUrlCount: true` é informado (caminho crítico da abertura da Home), a varredura
 * diagnóstica de todas as 40.000+ URLs do catálogo é agendada cooperativamente em segundo plano
 * para eliminar o bloqueio síncrono de ~8 segundos após a conclusão dos 6 catálogos.
 */
export function buildHomeStartupImagePlan(params: {
  serverUrl?: string | null;
  allLiveStreams?: any[];
  allVodStreams?: any[];
  allSeriesStreams?: any[];
  vodCategories?: any[];
  seriesCategories?: any[];
  continueWatchingItems?: any[];
  viewportWidth?: number;
  viewportHeight?: number;
  displayMode?: DisplayMode;
  tvScale?: number;
  deferFullUrlCount?: boolean;
}): HomeStartupImagePlan {
  const planStartMono = nowMonotonicMs();
  const {
    serverUrl,
    allLiveStreams = [],
    allVodStreams = [],
    allSeriesStreams = [],
    vodCategories = [],
    seriesCategories = [],
    continueWatchingItems = [],
    deferFullUrlCount = false,
  } = params;

  const budget = computeAdaptiveInitialCardsPerRow({
    viewportWidth: params.viewportWidth,
    viewportHeight: params.viewportHeight,
    displayMode: params.displayMode,
    tvScale: params.tvScale,
  });

  const sortStartMono = nowMonotonicMs();
  const vodIndex = getOrCreateVodIndex(allVodStreams);
  const seriesIndex = getOrCreateSeriesIndex(allSeriesStreams);
  const heroItems = getHeroBannerItems(allVodStreams, allSeriesStreams);

  const tier1HeroUrls: string[] = [];
  const tier2FirstRowsVisibleUrls: string[] = [];
  const tier3NextRowsUrls: string[] = [];
  const tier4VisitedCategoryUrls: string[] = [];
  const homeRowsUrlsSet = new Set<string>();
  const seenPriority = new Set<string>();

  const pushUnique = (url: string | null, bucket: string[]) => {
    if (!url) return;
    homeRowsUrlsSet.add(url);
    if (!seenPriority.has(url)) {
      seenPriority.add(url);
      bucket.push(url);
    }
  };

  // Camada 1: Imagem principal do HeroBanner (e segundo slide imediato)
  for (let i = 0; i < Math.min(2, heroItems.length); i++) {
    const item = heroItems[i];
    const backdropRaw =
      (Array.isArray(item?.backdrop_path) ? item.backdrop_path[0] : item?.backdrop_path) ||
      item?.cover_big ||
      extractRawCoverFromItem(item);
    const backdropUrl = buildDirectImageUrl(backdropRaw, serverUrl);
    pushUnique(backdropUrl, tier1HeroUrls);
  }

  // Descritores preguiçosos (lazy) das fileiras da Home, na mesma ordem exata de CatalogShowcaseView.tsx
  interface LazyHomeRowDescriptor {
    key: string;
    isLandscape: boolean;
    getItems: () => any[];
  }
  const rowDescriptors: LazyHomeRowDescriptor[] = [];

  if (Array.isArray(continueWatchingItems) && continueWatchingItems.length > 0) {
    const cwSlice = continueWatchingItems.slice(0, 24);
    rowDescriptors.push({
      key: 'continue_watching',
      isLandscape: false,
      getItems: () => cwSlice,
    });
  }

  if (allLiveStreams.length > 0) {
    const liveSlice = allLiveStreams.slice(0, 24);
    rowDescriptors.push({
      key: 'live_highlights',
      isLandscape: true,
      getItems: () => liveSlice,
    });
  }

  const featuredMovies = vodIndex.getSortedAll().slice(0, 24);
  if (featuredMovies.length > 0) {
    rowDescriptors.push({
      key: 'featured_movies',
      isLandscape: false,
      getItems: () => featuredMovies,
    });
  }

  const featuredSeries = seriesIndex.getSortedAll().slice(0, 24);
  if (featuredSeries.length > 0) {
    rowDescriptors.push({
      key: 'featured_series',
      isLandscape: false,
      getItems: () => featuredSeries,
    });
  }

  const nonEmptyVodCats = (Array.isArray(vodCategories) ? vodCategories : []).filter(
    (c) => c && vodIndex.getByCategory(c.category_id).length > 0
  );
  const nonEmptySeriesCats = (Array.isArray(seriesCategories) ? seriesCategories : []).filter(
    (c) => c && seriesIndex.getByCategory(c.category_id).length > 0
  );
  const maxCatLen = Math.max(nonEmptyVodCats.length, nonEmptySeriesCats.length);
  for (let i = 0; i < maxCatLen; i++) {
    if (i < nonEmptyVodCats.length) {
      const cat = nonEmptyVodCats[i];
      rowDescriptors.push({
        key: `vod_cat_${cat.category_id}`,
        isLandscape: false,
        getItems: () => vodIndex.getSortedByCategory(cat.category_id).slice(0, 24),
      });
    }
    if (i < nonEmptySeriesCats.length) {
      const cat = nonEmptySeriesCats[i];
      rowDescriptors.push({
        key: `series_cat_${cat.category_id}`,
        isLandscape: false,
        getItems: () => seriesIndex.getSortedByCategory(cat.category_id).slice(0, 24),
      });
    }
  }

  // Camada 2: Capas visíveis das primeiras fileiras da Home
  const firstRowsLimit = Math.min(budget.visibleRowsCount, rowDescriptors.length);
  for (let r = 0; r < firstRowsLimit; r++) {
    const desc = rowDescriptors[r];
    const rowItems = desc.getItems();
    const rowBudget = desc.isLandscape ? budget.landscapeCardsPerRow : budget.posterCardsPerRow;
    const cardsLimit = Math.min(rowBudget, rowItems.length);
    for (let c = 0; c < cardsLimit; c++) {
      const resolved = buildDirectImageUrl(extractRawCoverFromItem(rowItems[c]), serverUrl);
      pushUnique(resolved, tier2FirstRowsVisibleUrls);
    }
  }

  // Camada 3: Capas das próximas fileiras imediatas da Home (avança sobre fileiras cujos itens já estavam em Destaque)
  let nextRowsCollected = 0;
  let nextRowsCursor = firstRowsLimit;
  while (nextRowsCursor < rowDescriptors.length && nextRowsCollected < budget.nextRowsCount) {
    const desc = rowDescriptors[nextRowsCursor];
    const rowItems = desc.getItems();
    const rowBudget = desc.isLandscape ? budget.landscapeCardsPerRow : budget.posterCardsPerRow;
    const cardsLimit = Math.min(rowBudget, rowItems.length);
    const beforeLen = tier3NextRowsUrls.length;
    for (let c = 0; c < cardsLimit; c++) {
      const resolved = buildDirectImageUrl(extractRawCoverFromItem(rowItems[c]), serverUrl);
      pushUnique(resolved, tier3NextRowsUrls);
    }
    if (tier3NextRowsUrls.length > beforeLen) {
      nextRowsCollected++;
    }
    nextRowsCursor++;
  }

  // Camada 4: Categorias visitadas recentemente pelo usuário + próximas 2 fileiras além da janela imediata
  const visitedKeys = new Set(getVisitedShowcaseCategories());
  if (visitedKeys.size > 0) {
    for (let r = firstRowsLimit; r < rowDescriptors.length; r++) {
      const desc = rowDescriptors[r];
      if (visitedKeys.has(desc.key)) {
        const rowItems = desc.getItems();
        const rowBudget = desc.isLandscape ? budget.landscapeCardsPerRow : budget.posterCardsPerRow;
        const cardsLimit = Math.min(rowBudget, rowItems.length);
        for (let c = 0; c < cardsLimit; c++) {
          const resolved = buildDirectImageUrl(extractRawCoverFromItem(rowItems[c]), serverUrl);
          pushUnique(resolved, tier4VisitedCategoryUrls);
        }
      }
    }
  }
  for (let r = nextRowsCursor; r < Math.min(nextRowsCursor + 2, rowDescriptors.length); r++) {
    const desc = rowDescriptors[r];
    const rowItems = desc.getItems();
    const rowBudget = desc.isLandscape ? budget.landscapeCardsPerRow : budget.posterCardsPerRow;
    const cardsLimit = Math.min(rowBudget, rowItems.length);
    for (let c = 0; c < cardsLimit; c++) {
      const resolved = buildDirectImageUrl(extractRawCoverFromItem(rowItems[c]), serverUrl);
      pushUnique(resolved, tier4VisitedCategoryUrls);
    }
  }

  const planCategorySelectionAndSortMs = Math.max(0, nowMonotonicMs() - sortStartMono);
  let planUniqueUrlCountMs = 0;
  let uniqueCatalogImageUrlsCount = homeRowsUrlsSet.size;
  let uniqueHomeImageUrlsCount = homeRowsUrlsSet.size;

  if (deferFullUrlCount) {
    scheduleCooperativeCatalogUrlCount({
      serverUrl,
      allLiveStreams,
      allVodStreams,
      allSeriesStreams,
      vodCategories,
      seriesCategories,
      continueWatchingItems,
    });
  } else {
    const urlCountStartMono = nowMonotonicMs();
    const allCatalogUrlsSet = new Set<string>();
    const addItemUrlToSet = (item: any, targetSet: Set<string>) => {
      const raw = extractRawCoverFromItem(item);
      const resolved = buildDirectImageUrl(raw, serverUrl);
      if (resolved) {
        targetSet.add(resolved);
      }
    };

    for (const ch of allLiveStreams) addItemUrlToSet(ch, allCatalogUrlsSet);
    for (const m of allVodStreams) addItemUrlToSet(m, allCatalogUrlsSet);
    for (const s of allSeriesStreams) addItemUrlToSet(s, allCatalogUrlsSet);

    for (const c of nonEmptyVodCats) {
      const items = vodIndex.getByCategory(c.category_id).slice(0, 24);
      for (const it of items) addItemUrlToSet(it, homeRowsUrlsSet);
    }
    for (const c of nonEmptySeriesCats) {
      const items = seriesIndex.getByCategory(c.category_id).slice(0, 24);
      for (const it of items) addItemUrlToSet(it, homeRowsUrlsSet);
    }
    for (const ch of allLiveStreams.slice(0, 24)) addItemUrlToSet(ch, homeRowsUrlsSet);
    for (const m of featuredMovies) addItemUrlToSet(m, homeRowsUrlsSet);
    for (const s of featuredSeries) addItemUrlToSet(s, homeRowsUrlsSet);

    uniqueCatalogImageUrlsCount = allCatalogUrlsSet.size;
    uniqueHomeImageUrlsCount = homeRowsUrlsSet.size;
    planUniqueUrlCountMs = Math.max(0, nowMonotonicMs() - urlCountStartMono);
    runtimeStats.uniqueCatalogImageUrls = uniqueCatalogImageUrlsCount;
    runtimeStats.uniqueHomeImageUrls = uniqueHomeImageUrlsCount;
    runtimeStats.planUniqueUrlCountMs = planUniqueUrlCountMs;
  }

  const priorityUrls = [
    ...tier1HeroUrls,
    ...tier2FirstRowsVisibleUrls,
    ...tier3NextRowsUrls,
  ];

  const planBuildTotalMs = Math.max(0, nowMonotonicMs() - planStartMono);
  runtimeStats.planBuildTotalMs = planBuildTotalMs;
  runtimeStats.planCategorySelectionAndSortMs = planCategorySelectionAndSortMs;
  runtimeStats.priorityTargetCount = priorityUrls.length;
  syncStatsToCatalogDiagnostics();

  return {
    tier1HeroUrls,
    tier2FirstRowsVisibleUrls,
    tier3NextRowsUrls,
    tier4VisitedCategoryUrls,
    priorityUrls,
    uniqueCatalogImageUrlsCount,
    uniqueHomeImageUrlsCount,
    posterCardsPerRow: budget.posterCardsPerRow,
    landscapeCardsPerRow: budget.landscapeCardsPerRow,
    planBuildTotalMs,
    planCategorySelectionAndSortMs,
    planUniqueUrlCountMs,
  };
}

export interface StartupImagePreparationResult {
  allAlreadyCached: boolean;
  preparedCount: number;
  foundOnDiskCount: number;
  downloadedSuccessCount: number;
  failedCount: number;
  pendingAtReleaseCount: number;
  totalTargetCount: number;
  durationMs: number;
}

/**
 * Executa a preparação das capas prioritárias da abertura em ordem estrita de prioridade:
 * 1. HeroBanner ('critical')
 * 2. Primeiras fileiras visíveis ('high')
 * 3. Próximas fileiras imediatas ('normal')
 * E agenda a Camada 4 ('low') em segundo plano sem bloquear a liberação da Home.
 *
 * Separa rigorosamente:
 * - `foundOnDiskCount`: encontradas no disco na abertura
 * - `downloadedSuccessCount`: baixadas com sucesso na preparação inicial
 * - `failedCount`: que falharam (nunca contabilizadas como preparadas com sucesso!)
 * - `pendingAtReleaseCount`: ainda pendentes quando a Home foi liberada
 */
export async function executeHomeStartupImagePreparation(
  plan: HomeStartupImagePlan,
  options?: {
    signal?: AbortSignal;
    maxWaitMs?: number;
    onProgress?: (preparedCount: number, totalCount: number) => void;
  }
): Promise<StartupImagePreparationResult> {
  const totalTargetCount = plan.priorityUrls.length;
  runtimeStats.priorityTargetCount = totalTargetCount;

  if (totalTargetCount === 0 || !isAndroidPersistentImageCacheAvailable()) {
    runtimeStats.priorityFoundOnDiskCount = 0;
    runtimeStats.priorityDownloadedSuccessCount = 0;
    runtimeStats.priorityFailedCount = 0;
    runtimeStats.priorityPendingAtReleaseCount = 0;
    runtimeStats.priorityCoversPreparationMs = 0;
    syncStatsToCatalogDiagnostics();
    return {
      allAlreadyCached: true,
      preparedCount: totalTargetCount,
      foundOnDiskCount: 0,
      downloadedSuccessCount: 0,
      failedCount: 0,
      pendingAtReleaseCount: 0,
      totalTargetCount,
      durationMs: 0,
    };
  }

  const startMono = nowMonotonicMs();
  await ensureAndroidImageCacheHydrated();

  // Verificar quais URLs prioritárias já estão disponíveis sincronicamente no cache local
  const alreadyOnDiskSet = new Set<string>();
  for (const url of plan.priorityUrls) {
    if (getInstantCachedImageSrc(url, { countHit: true })) {
      alreadyOnDiskSet.add(url);
    }
  }
  const foundOnDiskCount = alreadyOnDiskSet.size;

  if (foundOnDiskCount === totalTargetCount) {
    // Sem atraso artificial quando já estão em cache!
    runtimeStats.priorityFoundOnDiskCount = foundOnDiskCount;
    runtimeStats.priorityDownloadedSuccessCount = 0;
    runtimeStats.priorityFailedCount = 0;
    runtimeStats.priorityPendingAtReleaseCount = 0;
    runtimeStats.priorityCoversPreparationMs = 0;
    syncStatsToCatalogDiagnostics();
    options?.onProgress?.(totalTargetCount, totalTargetCount);
    // Disparar pré-carregamento oportunista da Camada 4 em segundo plano
    scheduleBackgroundLowPriorityPreload(plan.tier4VisitedCategoryUrls);
    return {
      allAlreadyCached: true,
      preparedCount: totalTargetCount,
      foundOnDiskCount,
      downloadedSuccessCount: 0,
      failedCount: 0,
      pendingAtReleaseCount: 0,
      totalTargetCount,
      durationMs: 0,
    };
  }

  let downloadedSuccessCount = 0;
  let failedCount = 0;
  let preparedCount = foundOnDiskCount;
  const maxWaitMs = options?.maxWaitMs ?? 3800;

  options?.onProgress?.(preparedCount, totalTargetCount);

  const enqueueTier = (urls: string[], priority: ImagePreloadPriority) =>
    urls
      .filter((url) => !alreadyOnDiskSet.has(url))
      .map((url) =>
        acquireCachedImage(url, { priority })
          .then(() => {
            downloadedSuccessCount++;
            preparedCount = foundOnDiskCount + downloadedSuccessCount;
            options?.onProgress?.(preparedCount, totalTargetCount);
          })
          .catch(() => {
            // Uma tentativa de download que falhou NÃO é contabilizada como preparada com sucesso
            failedCount++;
            options?.onProgress?.(preparedCount, totalTargetCount);
          })
      );

  const allPromises = [
    ...enqueueTier(plan.tier1HeroUrls, 'critical'),
    ...enqueueTier(plan.tier2FirstRowsVisibleUrls, 'high'),
    ...enqueueTier(plan.tier3NextRowsUrls, 'normal'),
  ];

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<void>((resolve) => {
    timeoutId = setTimeout(resolve, maxWaitMs);
  });

  const abortPromise = new Promise<void>((resolve) => {
    if (options?.signal) {
      if (options.signal.aborted) {
        resolve();
      } else {
        options.signal.addEventListener('abort', () => resolve(), { once: true });
      }
    }
  });

  await Promise.race([
    Promise.all(allPromises).then(() => {}),
    timeoutPromise,
    abortPromise,
  ]);

  if (timeoutId !== null) {
    clearTimeout(timeoutId);
  }

  const durationMs = Math.max(0, nowMonotonicMs() - startMono);
  const pendingAtReleaseCount = Math.max(
    0,
    totalTargetCount - foundOnDiskCount - downloadedSuccessCount - failedCount
  );
  preparedCount = foundOnDiskCount + downloadedSuccessCount;

  runtimeStats.priorityFoundOnDiskCount = foundOnDiskCount;
  runtimeStats.priorityDownloadedSuccessCount = downloadedSuccessCount;
  runtimeStats.priorityFailedCount = failedCount;
  runtimeStats.priorityPendingAtReleaseCount = pendingAtReleaseCount;
  runtimeStats.priorityCoversPreparationMs = durationMs;
  syncStatsToCatalogDiagnostics();

  // Agendar Camada 4 (categorias seguintes / visitadas) em segundo plano com prioridade 'low'
  if (!options?.signal?.aborted) {
    scheduleBackgroundLowPriorityPreload(plan.tier4VisitedCategoryUrls);
  }

  return {
    allAlreadyCached: false,
    preparedCount,
    foundOnDiskCount,
    downloadedSuccessCount,
    failedCount,
    pendingAtReleaseCount,
    totalTargetCount,
    durationMs,
  };
}

export function scheduleBackgroundLowPriorityPreload(urls: string[]): void {
  if (
    !isAndroidPersistentImageCacheAvailable() ||
    isCatalogTransferPhaseActive ||
    !Array.isArray(urls) ||
    urls.length === 0
  ) {
    return;
  }

  let currentLowPriorityQueued = 0;
  for (const t of pendingQueue) {
    if (t.priority === 'low') {
      currentLowPriorityQueued++;
    }
  }

  for (const url of urls) {
    if (currentLowPriorityQueued >= MAX_LOW_PRIORITY_PENDING_TASKS) {
      break;
    }
    if (!url || getInstantCachedImageSrc(url)) continue;
    if (inFlightTasksByUrl.has(url.trim())) continue;
    currentLowPriorityQueued++;
    void acquireCachedImage(url, { priority: 'low' }).catch(() => {
      // Falhas de pré-carregamento em background nunca interrompem a aplicação
    });
  }
}

/**
 * Reseta o estado do serviço de cache de imagens exclusivamente para suítes de teste automatizadas.
 */
export function resetAndroidImageCacheForTest(): void {
  currentSessionEpoch++;
  clearCooperativeUrlCountTimers();
  resolvedUrlToEntryMap.clear();
  hydratedByShaKeyMap.clear();
  shaKeyToUrlMap.clear();
  pendingTouchedKeys.splice(0, pendingTouchedKeys.length);
  inFlightTasksByUrl.clear();
  pendingQueue.splice(0, pendingQueue.length);
  activeWorkersCount = 0;
  isHydrated = false;
  hydrationPromise = null;
  activeLogoutClearPromise = null;
  isMainVideoPlaybackActive = false;
  isLiveTvPreviewPlaybackActive = false;
  isCatalogTransferPhaseActive = false;
  lastDpadActivityTimestampMs = 0;
  if (dpadThrottleTimer !== null) {
    clearTimeout(dpadThrottleTimer);
    dpadThrottleTimer = null;
  }
  runtimeStats.coordinationMode = 'mode_b';
  runtimeStats.initialHydratedEntriesCount = 0;
  runtimeStats.downloadsDuringCatalogsCount = 0;
  runtimeStats.hitsDuringCatalogsCount = 0;
  runtimeStats.uniqueCatalogImageUrls = 0;
  runtimeStats.uniqueHomeImageUrls = 0;
  runtimeStats.persistentCacheHits = 0;
  runtimeStats.cacheLayerDownloads = 0;
  runtimeStats.deduplicatedDownloadsCount = 0;
  runtimeStats.downloadFailuresCount = 0;
  runtimeStats.bytesTransferredByCache = 0;
  runtimeStats.bytesStoredCurrently = 0;
  runtimeStats.storedEntriesCount = 0;
  runtimeStats.evictedEntriesCount = 0;
  runtimeStats.corruptedLocalRecoveriesCount = 0;
  runtimeStats.priorityTargetCount = 0;
  runtimeStats.priorityFoundOnDiskCount = 0;
  runtimeStats.priorityDownloadedSuccessCount = 0;
  runtimeStats.priorityFailedCount = 0;
  runtimeStats.priorityPendingAtReleaseCount = 0;
  runtimeStats.localRecoveryTimeMs = null;
  runtimeStats.planBuildTotalMs = null;
  runtimeStats.planCategorySelectionAndSortMs = null;
  runtimeStats.planUniqueUrlCountMs = null;
  runtimeStats.priorityCoversPreparationMs = null;
  runtimeStats.maxSimultaneousNativeTasks = 0;
  runtimeStats.cancelledStaleQueueTasksCount = 0;
  runtimeStats.configuredMaxBytes = DEFAULT_IMAGE_CACHE_MAX_BYTES;
  clearVisitedShowcaseCategories();
}

// ============================================================================
// Simulador de Disco Persistente Android para Testes Automatizados (`npm test`)
// ============================================================================

export interface SimulatedDiskResponseConfig {
  status?: number;
  contentType?: string;
  cacheControl?: string;
  etag?: string;
  lastModified?: string;
  declaredContentLength?: number;
  bodyBytes?: Uint8Array;
  delayMs?: number;
  networkError?: boolean;
}

export function createValidTestJpegBytes(byteLength: number = 2048): Uint8Array {
  const len = Math.max(16, byteLength);
  const buf = new Uint8Array(len);
  // JPEG SOI magic bytes: FF D8 FF E0
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  buf[3] = 0xe0;
  for (let i = 4; i < len - 2; i++) {
    buf[i] = (i * 31) & 0xff;
  }
  // JPEG EOI: FF D9
  buf[len - 2] = 0xff;
  buf[len - 1] = 0xd9;
  return buf;
}

function encodeUint8ArrayToBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    const triplet = (b0 << 16) | (b1 << 8) | b2;
    out += alphabet[(triplet >>> 18) & 0x3f];
    out += alphabet[(triplet >>> 12) & 0x3f];
    out += i + 1 < len ? alphabet[(triplet >>> 6) & 0x3f] : '=';
    out += i + 2 < len ? alphabet[triplet & 0x3f] : '=';
  }
  return out;
}

function hasValidSimulatedImageSignature(bytes: Uint8Array, contentType: string): boolean {
  if (!bytes || bytes.length < 4) return false;
  // Rejeitar JSON ou HTML disfarçados
  let offset = 0;
  while (
    offset < bytes.length &&
    (bytes[offset] === 0x20 || bytes[offset] === 0x09 || bytes[offset] === 0x0a || bytes[offset] === 0x0d)
  ) {
    offset++;
  }
  if (offset < bytes.length) {
    const first = bytes[offset];
    if (first === 0x7b /* { */ || first === 0x5b /* [ */) return false;
    if (first === 0x3c /* < */) {
      return contentType.toLowerCase().includes('svg');
    }
  }
  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  // PNG
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
  // WebP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return true;
  }
  // GIF
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return true;
  return false;
}

/**
 * Cria um harness de disco persistente simulado que replica fielmente o comportamento do
 * `ImageDiskCachePlugin.java` (incluindo persistência entre reinicializações simuladas,
 * validação de HTTP/Content-Type/Content-Length/magic bytes, ETag 304, LRU por orçamento de bytes,
 * sincronização em lote de recência, inlineDataUrl para no-store, corrupção física de arquivos e
 * bloqueio por época no logout).
 */
export function createSimulatedPersistentImageDiskHarness(options?: {
  initialMaxBytes?: number;
  defaultByteSize?: number;
  clearAllDelayMs?: number;
  customResponder?: (
    url: string,
    requestHeaders: { ifNoneMatch?: string; ifModifiedSince?: string }
  ) => SimulatedDiskResponseConfig | null;
}) {
  const cacheDir = '/data/user/0/com.northcode.play/files/nc_image_cache';
  let maxBytes = options?.initialMaxBytes ?? DEFAULT_IMAGE_CACHE_MAX_BYTES;
  const defaultByteSize = options?.defaultByteSize ?? 2048;

  interface DiskFileRecord {
    key: string;
    url: string;
    fileName: string;
    filePath: string;
    bytes: Uint8Array;
    contentType: string;
    etag: string | null;
    lastModified: string | null;
    cacheControl: string | null;
    createdAtMs: number;
    lastAccessedAtMs: number;
    corruptedOnDisk: boolean;
  }

  // Mapa persistente que sobrevive a `simulateAppRestart()`
  const persistentDiskFiles = new Map<string, DiskFileRecord>();
  const networkFetchCounterByUrl = new Map<string, number>();
  let totalNetworkFetches = 0;
  let evictedEntriesCount = 0;
  let corruptedRecoveriesCount = 0;
  let diskEpoch = 1;
  let accessClock = 1000;

  const getTotalDiskBytes = () => {
    let sum = 0;
    for (const rec of persistentDiskFiles.values()) {
      sum += rec.bytes.byteLength;
    }
    return sum;
  };

  const applyRecentAccessedKeys = (recentAccessedKeys?: string[]) => {
    if (!Array.isArray(recentAccessedKeys)) return;
    for (const k of recentAccessedKeys) {
      if (!k) continue;
      const rec = persistentDiskFiles.get(k);
      if (rec) {
        rec.lastAccessedAtMs = ++accessClock;
      }
    }
  };

  const enforceDiskLru = (): string[] => {
    const evictedKeys: string[] = [];
    if (getTotalDiskBytes() <= maxBytes) return evictedKeys;
    const sorted = Array.from(persistentDiskFiles.values()).sort((a, b) => {
      if (a.lastAccessedAtMs !== b.lastAccessedAtMs) {
        return a.lastAccessedAtMs - b.lastAccessedAtMs;
      }
      if (a.createdAtMs !== b.createdAtMs) {
        return a.createdAtMs - b.createdAtMs;
      }
      return a.key.localeCompare(b.key);
    });
    for (const candidate of sorted) {
      if (getTotalDiskBytes() <= maxBytes) break;
      persistentDiskFiles.delete(candidate.key);
      evictedKeys.push(candidate.key);
      evictedEntriesCount++;
    }
    return evictedKeys;
  };

  const plugin: ImageDiskCacheNativePlugin = {
    async getHydratedIndex() {
      const entries: HydratedImageCacheEntry[] = [];
      for (const [k, rec] of Array.from(persistentDiskFiles.entries())) {
        if (!rec.bytes || rec.bytes.byteLength === 0) {
          persistentDiskFiles.delete(k);
          continue;
        }
        entries.push({
          key: rec.key,
          fileName: rec.fileName,
          filePath: rec.filePath,
          byteSize: rec.bytes.byteLength,
          contentType: rec.contentType,
          etag: rec.etag,
          lastModified: rec.lastModified,
          cacheControl: rec.cacheControl,
          createdAtMs: rec.createdAtMs,
          lastAccessedAtMs: rec.lastAccessedAtMs,
        });
      }
      return {
        cacheDir,
        maxBytes,
        totalBytes: getTotalDiskBytes(),
        evictedEntriesCount,
        corruptedRecoveriesCount,
        entries,
      };
    },

    async configureCache({ maxBytes: newMax, recentAccessedKeys }) {
      applyRecentAccessedKeys(recentAccessedKeys);
      maxBytes = Math.max(1024, newMax);
      const evictedKeys = enforceDiskLru();
      return {
        maxBytes,
        totalBytes: getTotalDiskBytes(),
        storedEntriesCount: persistentDiskFiles.size,
        evictedEntriesCount,
        evictedKeys,
      };
    },

    async touchEntries({ keys }) {
      applyRecentAccessedKeys(keys);
      return {
        touchedCount: Array.isArray(keys) ? keys.length : 0,
      };
    },

    async invalidateImage({ url, key, corruptedRecovery }) {
      const targetKey =
        key && key.length === 64 ? key : computeDeterministicUrlSha256Hex(String(url || '').trim());
      const removed = persistentDiskFiles.delete(targetKey);
      if (corruptedRecovery) {
        corruptedRecoveriesCount++;
      }
      return {
        removed,
        totalBytes: getTotalDiskBytes(),
        corruptedRecoveriesCount,
      };
    },

    async clearAll() {
      diskEpoch++;
      persistentDiskFiles.clear();
      if (options?.clearAllDelayMs && options.clearAllDelayMs > 0) {
        await new Promise((r) => setTimeout(r, options.clearAllDelayMs));
      }
      return {
        cleared: true,
        epoch: diskEpoch,
        totalBytes: 0,
      };
    },

    async acquireImage({ url, forceRefresh, revalidate, recentAccessedKeys }) {
      applyRecentAccessedKeys(recentAccessedKeys);
      const trimmed = String(url || '').trim();
      const key = computeDeterministicUrlSha256Hex(trimmed);
      const epochAtCall = diskEpoch;

      const existing = persistentDiskFiles.get(key);
      const mustRevalidate =
        Boolean(revalidate) ||
        Boolean(existing && needsEntryHttpRevalidation(existing));

      if (existing && !forceRefresh && !mustRevalidate) {
        if (existing.bytes.byteLength > 0) {
          existing.lastAccessedAtMs = ++accessClock;
          return {
            hit: true,
            revalidated304: false,
            bypassedNoStore: false,
            key,
            fileName: existing.fileName,
            filePath: existing.filePath,
            cacheDir,
            byteSize: existing.bytes.byteLength,
            contentType: existing.contentType,
            etag: existing.etag,
            lastModified: existing.lastModified,
            cacheControl: existing.cacheControl,
            createdAtMs: existing.createdAtMs,
            lastAccessedAtMs: existing.lastAccessedAtMs,
            totalBytes: getTotalDiskBytes(),
            storedEntriesCount: persistentDiskFiles.size,
            evictedEntriesCount,
          };
        } else {
          persistentDiskFiles.delete(key);
        }
      }

      const customCfg =
        options?.customResponder?.(trimmed, {
          ifNoneMatch: !forceRefresh ? existing?.etag ?? undefined : undefined,
          ifModifiedSince: !forceRefresh ? existing?.lastModified ?? undefined : undefined,
        }) ?? null;

      const delayMs = customCfg?.delayMs ?? 2;
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }

      if (diskEpoch !== epochAtCall) {
        throw new Error('SESSION_CLEARED');
      }

      totalNetworkFetches++;
      networkFetchCounterByUrl.set(trimmed, (networkFetchCounterByUrl.get(trimmed) ?? 0) + 1);

      if (customCfg?.networkError) {
        throw new Error('NETWORK_ERROR');
      }

      const status = customCfg?.status ?? 200;
      if (status === 304 && existing && existing.bytes.byteLength > 0) {
        existing.createdAtMs = Date.now();
        existing.lastAccessedAtMs = ++accessClock;
        if (customCfg?.cacheControl !== undefined) {
          existing.cacheControl = customCfg.cacheControl;
        }
        if (customCfg?.etag !== undefined) {
          existing.etag = customCfg.etag;
        }
        if (customCfg?.lastModified !== undefined) {
          existing.lastModified = customCfg.lastModified;
        }
        return {
          hit: true,
          revalidated304: true,
          bypassedNoStore: false,
          key,
          fileName: existing.fileName,
          filePath: existing.filePath,
          cacheDir,
          byteSize: existing.bytes.byteLength,
          contentType: existing.contentType,
          etag: existing.etag,
          lastModified: existing.lastModified,
          cacheControl: existing.cacheControl,
          createdAtMs: existing.createdAtMs,
          lastAccessedAtMs: existing.lastAccessedAtMs,
          totalBytes: getTotalDiskBytes(),
          storedEntriesCount: persistentDiskFiles.size,
          evictedEntriesCount,
        };
      }

      if (status !== 200) {
        throw new Error(`HTTP_${status}`);
      }

      const contentType = customCfg?.contentType ?? 'image/jpeg';
      const lowerCt = contentType.toLowerCase();
      if (
        lowerCt.startsWith('text/html') ||
        lowerCt.startsWith('text/plain') ||
        lowerCt.startsWith('application/json') ||
        (!lowerCt.startsWith('image/') && !lowerCt.startsWith('application/octet-stream'))
      ) {
        throw new Error(`INVALID_CONTENT_TYPE: ${contentType}`);
      }

      const bodyBytes = customCfg?.bodyBytes ?? createValidTestJpegBytes(defaultByteSize);
      if (bodyBytes.byteLength === 0) {
        throw new Error('EMPTY_BODY');
      }
      if (
        typeof customCfg?.declaredContentLength === 'number' &&
        customCfg.declaredContentLength !== bodyBytes.byteLength
      ) {
        throw new Error('TRUNCATED_BODY');
      }
      if (!hasValidSimulatedImageSignature(bodyBytes, contentType)) {
        throw new Error('INVALID_IMAGE_SIGNATURE');
      }

      if (diskEpoch !== epochAtCall) {
        throw new Error('SESSION_CLEARED');
      }

      const cacheControl = customCfg?.cacheControl ?? 'public, max-age=86400';
      if (cacheControl.toLowerCase().includes('no-store')) {
        persistentDiskFiles.delete(key);
        const inlineDataUrl = `data:${contentType};base64,${encodeUint8ArrayToBase64(bodyBytes)}`;
        return {
          hit: false,
          revalidated304: false,
          bypassedNoStore: true,
          key,
          fileName: null,
          filePath: null,
          inlineDataUrl,
          cacheDir,
          byteSize: bodyBytes.byteLength,
          contentType,
          totalBytes: getTotalDiskBytes(),
          storedEntriesCount: persistentDiskFiles.size,
          evictedEntriesCount,
        };
      }

      const fileName = `img_${key}.jpg`;
      const filePath = `${cacheDir}/${fileName}`;
      const nowWallMs = Date.now();
      const nowAccess = ++accessClock;

      persistentDiskFiles.set(key, {
        key,
        url: trimmed,
        fileName,
        filePath,
        bytes: bodyBytes,
        contentType,
        etag: customCfg?.etag ?? null,
        lastModified: customCfg?.lastModified ?? null,
        cacheControl,
        createdAtMs: nowWallMs,
        lastAccessedAtMs: nowAccess,
        corruptedOnDisk: false,
      });

      const evictedKeys = enforceDiskLru();

      const saved = persistentDiskFiles.get(key);
      if (!saved) {
        throw new Error('BUDGET_EXCEEDED');
      }

      return {
        hit: false,
        revalidated304: false,
        bypassedNoStore: false,
        key,
        fileName,
        filePath,
        cacheDir,
        byteSize: bodyBytes.byteLength,
        contentType,
        etag: saved.etag,
        lastModified: saved.lastModified,
        cacheControl: saved.cacheControl,
        createdAtMs: saved.createdAtMs,
        lastAccessedAtMs: saved.lastAccessedAtMs,
        totalBytes: getTotalDiskBytes(),
        storedEntriesCount: persistentDiskFiles.size,
        evictedEntriesCount,
        evictedKeys,
      };
    },
  };

  return {
    plugin,
    install() {
      resetAndroidImageCacheForTest();
      setAndroidImageCacheTestOverride({
        plugin,
        enabled: true,
        convertFileSrc: (fp: string) => {
          // Verificar se o arquivo físico simulado está marcado como corrompido
          const slashIdx = fp.lastIndexOf('/');
          const fn = slashIdx >= 0 ? fp.slice(slashIdx + 1) : '';
          const keyMatch = fn.match(/^img_([a-f0-9]{64})\./);
          const key = keyMatch ? keyMatch[1] : '';
          const rec = persistentDiskFiles.get(key);
          if (!rec || rec.corruptedOnDisk) {
            return `http://localhost${CAPACITOR_FILE_PATH_PREFIX}${fp}?corrupted=1`;
          }
          return `http://localhost${CAPACITOR_FILE_PATH_PREFIX}${fp}`;
        },
      });
    },
    uninstall() {
      setAndroidImageCacheTestOverride({
        plugin: null,
        enabled: null,
        convertFileSrc: null,
      });
      resetAndroidImageCacheForTest();
    },
    /**
     * Simula o fechamento completo e reabertura do aplicativo Android:
     * limpa toda a memória RAM do JavaScript, preservando apenas os arquivos e o índice no disco simulado.
     */
    simulateAppRestart() {
      const savedVisited = safeReadStorage(VISITED_CATEGORIES_STORAGE_KEY);
      resetAndroidImageCacheForTest();
      if (savedVisited.success && savedVisited.value) {
        safeSetStorage(VISITED_CATEGORIES_STORAGE_KEY, savedVisited.value);
      }
      setAndroidImageCacheTestOverride({
        plugin,
        enabled: true,
      });
    },
    corruptPhysicalFileForUrl(url: string) {
      const key = computeDeterministicUrlSha256Hex(url.trim());
      const rec = persistentDiskFiles.get(key);
      if (rec) {
        rec.corruptedOnDisk = true;
      }
    },
    isPhysicalFileMarkedCorrupted(fileSrc: string): boolean {
      if (fileSrc.includes('?corrupted=1')) return true;
      const match = fileSrc.match(/img_([a-f0-9]{64})\./);
      if (!match) return false;
      const rec = persistentDiskFiles.get(match[1]);
      return !rec || rec.corruptedOnDisk;
    },
    getNetworkFetchCount(url?: string): number {
      if (!url) return totalNetworkFetches;
      return networkFetchCounterByUrl.get(url.trim()) ?? 0;
    },
    getPhysicalFileCount(): number {
      return persistentDiskFiles.size;
    },
    getTotalDiskBytes,
    hasPhysicalFileForUrl(url: string): boolean {
      const key = computeDeterministicUrlSha256Hex(url.trim());
      return persistentDiskFiles.has(key);
    },
  };
}
