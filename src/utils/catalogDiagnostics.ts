import { useSyncExternalStore } from 'react';
import { safeReadStorage, safeSetStorage } from './accountUtils';
import { isUsingCapacitorNativeTransport } from '../services/httpTransport';

export const CATALOG_DIAGNOSTICS_ENABLED_KEY = 'northcode_catalog_diag_enabled';

export type CatalogOperationDomain = 'live' | 'vod' | 'series';
export type CatalogOperationKind = 'categories' | 'catalog';

export type CatalogOperationType =
  | 'live_categories'
  | 'vod_categories'
  | 'series_categories'
  | 'live_catalog'
  | 'vod_catalog'
  | 'series_catalog';

export type CatalogOperationOutcome =
  | 'idle'
  | 'queued'
  | 'running'
  | 'success'
  | 'error'
  | 'cancelled';

export type CatalogAttemptOutcome = 'running' | 'success' | 'error' | 'cancelled';

export type CatalogErrorCategory =
  | 'timeout'
  | 'network'
  | 'http_4xx'
  | 'http_5xx'
  | 'invalid_format'
  | 'auth_rejected'
  | 'cancelled'
  | 'unknown';

export type CatalogPayloadFormat = 'text-json' | 'pre-parsed-object' | 'empty';

export type CatalogTransportKind = 'web-fetch' | 'capacitor-native';

export type CatalogReleaseTrigger =
  | 'pending'
  | 'auto_all_six'
  | 'manual_continue_button'
  | 'auth_rejected';

export type CatalogIndexBuildMode =
  | 'none'
  | 'async-cooperative'
  | 'sync'
  | 'memory-cache';

export type CatalogSortDomain = 'vod' | 'series' | 'hero' | 'liveGroups';

export interface CatalogAttemptDiagnostics {
  attemptNumber: number;
  startedAtMs: number;
  endedAtMs: number | null;
  durationMs: number | null;
  outcome: CatalogAttemptOutcome;
  errorCategory: CatalogErrorCategory | null;
  httpStatus: number | null;
  transportKind: CatalogTransportKind;
  // Web (fetch) separated metrics
  responseWaitMs: number | null;
  bodyReadMs: number | null;
  // Android (CapacitorHttp) combined transport + native bridge metric
  nativeTransportAndBridgeMs: number | null;
  // Payload & JSON.parse metrics
  payloadFormat: CatalogPayloadFormat | null;
  jsonParseExecuted: boolean;
  jsonParseMs: number | null;
  payloadChars: number | null;
}

export interface CatalogOperationDiagnostics {
  operationId: string;
  sessionId: number;
  runNumber: number;
  type: CatalogOperationType;
  domain: CatalogOperationDomain;
  kind: CatalogOperationKind;
  initialPriority: number;
  effectivePriority: number;
  deduplicatedHits: number;
  enqueuedAtMs: number;
  startedAtMs: number | null;
  completedAtMs: number | null;
  queueWaitMs: number | null;
  executionMs: number | null;
  totalElapsedMs: number | null;
  outcome: CatalogOperationOutcome;
  errorCategory: CatalogErrorCategory | null;
  retryCount: number;
  retryWaitMs: number;
  attempts: CatalogAttemptDiagnostics[];
  // Normalization (xtreamService.ts)
  normalizationMs: number | null;
  rawItemsCount: number | null;
  validItemsCount: number | null;
  // Index construction (catalogIndex.ts)
  indexBuildMode: CatalogIndexBuildMode;
  indexFromCache: boolean;
  indexElapsedMs: number | null;
  indexActiveComputeMs: number | null;
  indexBatchesProcessed: number;
  indexBatchYields: number;
  indexedItemsCount: number | null;
  indexCancelled: boolean;
}

export interface CatalogDomainSortDiagnostics {
  newSortsCount: number;
  cacheHitsCount: number;
  totalSortMs: number;
  lastSortedItemsCount: number;
}

export interface CatalogSortingDiagnostics {
  vod: CatalogDomainSortDiagnostics;
  series: CatalogDomainSortDiagnostics;
  hero: CatalogDomainSortDiagnostics;
  liveGroups: CatalogDomainSortDiagnostics;
  totalNewSortsCount: number;
  totalCacheHitsCount: number;
  totalSortMs: number;
}

export interface CatalogSessionDiagnosticsReport {
  sessionId: number;
  transportMode: CatalogTransportKind;
  maxConcurrency: number;
  startedAtMonotonicMs: number;
  allSixFinishedAtMs: number | null;
  overlayDismissedAtMs: number | null;
  homeAvailableAtMs: number | null;
  releaseTrigger: CatalogReleaseTrigger;
  wasDisplaySetupShown: boolean;
  displaySetupOpenedAtMs: number | null;
  displaySetupClosedAtMs: number | null;
  displaySetupWaitMs: number;
  netProcessingUntilHomeAvailableMs: number | null;
  operations: Record<CatalogOperationType, CatalogOperationDiagnostics | null>;
  operationHistory: CatalogOperationDiagnostics[];
  sorting: CatalogSortingDiagnostics;
}

export interface CatalogDiagnosticAttemptHandle {
  readonly sessionId: number;
  readonly operationId: string;
  readonly attemptNumber: number;
  isActive(): boolean;
  recordWebResponseWait(durationMs: number, httpStatus?: number): void;
  recordWebBodyRead(durationMs: number, charLength: number): void;
  recordCapacitorTransportAndBridge(durationMs: number, httpStatus?: number): void;
  recordPayloadNormalization(params: {
    payloadFormat: CatalogPayloadFormat;
    jsonParseExecuted: boolean;
    jsonParseMs: number | null;
    payloadChars: number | null;
  }): void;
  finishAttempt(
    outcome: 'success' | 'error' | 'cancelled',
    errorCategory?: CatalogErrorCategory | null,
    httpStatus?: number | null
  ): void;
}

export interface CatalogDiagnosticOperationHandle {
  readonly sessionId: number;
  readonly operationId: string;
  readonly type: CatalogOperationType;
  isActive(): boolean;
  startAttempt(attemptNumber: number): CatalogDiagnosticAttemptHandle | null;
  recordRetryWait(waitMs: number): void;
  recordNormalization(params: {
    durationMs: number;
    rawItemsCount: number;
    validItemsCount: number;
  }): void;
  recordResultItemsFallback(validItemsCount: number): void;
  recordIndexBuild(params: {
    mode: CatalogIndexBuildMode;
    fromCache: boolean;
    elapsedMs: number;
    activeComputeMs: number;
    batchesProcessed: number;
    batchYields: number;
    indexedItemsCount: number;
    cancelled: boolean;
  }): void;
}

const ALL_OPERATION_TYPES: CatalogOperationType[] = [
  'live_categories',
  'vod_categories',
  'series_categories',
  'live_catalog',
  'vod_catalog',
  'series_catalog',
];

function readInitialEnabledPreference(): boolean {
  const res = safeReadStorage(CATALOG_DIAGNOSTICS_ENABLED_KEY);
  return res.success && res.value === 'true';
}

let isCatalogDiagnosticsEnabled: boolean = readInitialEnabledPreference();
let customClockForTest: (() => number) | null = null;
let recordedEventsCountForTest = 0;

let activeSessionReport: CatalogSessionDiagnosticsReport | null = null;
let publishedSnapshot: CatalogSessionDiagnosticsReport | null = null;
const diagnosticsListeners = new Set<() => void>();

export function nowMonotonicMs(): number {
  if (customClockForTest) {
    return customClockForTest();
  }
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

export function setCatalogDiagnosticsClockForTest(clockFn: (() => number) | null): void {
  customClockForTest = clockFn;
}

export function getCatalogDiagnosticsRecordedEventsCountForTest(): number {
  return recordedEventsCountForTest;
}

export function resetCatalogDiagnosticsForTest(enabled: boolean = false): void {
  recordedEventsCountForTest = 0;
  isCatalogDiagnosticsEnabled = enabled;
  safeSetStorage(CATALOG_DIAGNOSTICS_ENABLED_KEY, enabled ? 'true' : 'false');
  activeSessionReport = null;
  publishedSnapshot = null;
  notifyDiagnosticsListeners();
}

function notifyDiagnosticsListeners(): void {
  if (activeSessionReport) {
    publishedSnapshot = cloneSessionReport(activeSessionReport);
  } else {
    publishedSnapshot = null;
  }
  diagnosticsListeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // ignore listener errors
    }
  });
}

export function isCatalogLoadDiagnosticsEnabled(): boolean {
  return isCatalogDiagnosticsEnabled;
}

export function syncCatalogLoadDiagnosticsPreferenceFromStorage(): boolean {
  const next = readInitialEnabledPreference();
  if (next !== isCatalogDiagnosticsEnabled) {
    isCatalogDiagnosticsEnabled = next;
    if (!next) {
      activeSessionReport = null;
    }
    notifyDiagnosticsListeners();
  }
  return isCatalogDiagnosticsEnabled;
}

export function setCatalogLoadDiagnosticsEnabled(enabled: boolean): boolean {
  const saved = safeSetStorage(CATALOG_DIAGNOSTICS_ENABLED_KEY, enabled ? 'true' : 'false');
  isCatalogDiagnosticsEnabled = Boolean(enabled);
  if (!enabled) {
    activeSessionReport = null;
  }
  notifyDiagnosticsListeners();
  return saved;
}

function createEmptyDomainSortStats(): CatalogDomainSortDiagnostics {
  return {
    newSortsCount: 0,
    cacheHitsCount: 0,
    totalSortMs: 0,
    lastSortedItemsCount: 0,
  };
}

function createEmptySortingDiagnostics(): CatalogSortingDiagnostics {
  return {
    vod: createEmptyDomainSortStats(),
    series: createEmptyDomainSortStats(),
    hero: createEmptyDomainSortStats(),
    liveGroups: createEmptyDomainSortStats(),
    totalNewSortsCount: 0,
    totalCacheHitsCount: 0,
    totalSortMs: 0,
  };
}

function cloneOperationDiagnostics(op: CatalogOperationDiagnostics): CatalogOperationDiagnostics {
  return {
    ...op,
    attempts: op.attempts.map((a) => ({ ...a })),
  };
}

function cloneSessionReport(
  report: CatalogSessionDiagnosticsReport
): CatalogSessionDiagnosticsReport {
  const clonedOps: Record<CatalogOperationType, CatalogOperationDiagnostics | null> = {
    live_categories: report.operations.live_categories
      ? cloneOperationDiagnostics(report.operations.live_categories)
      : null,
    vod_categories: report.operations.vod_categories
      ? cloneOperationDiagnostics(report.operations.vod_categories)
      : null,
    series_categories: report.operations.series_categories
      ? cloneOperationDiagnostics(report.operations.series_categories)
      : null,
    live_catalog: report.operations.live_catalog
      ? cloneOperationDiagnostics(report.operations.live_catalog)
      : null,
    vod_catalog: report.operations.vod_catalog
      ? cloneOperationDiagnostics(report.operations.vod_catalog)
      : null,
    series_catalog: report.operations.series_catalog
      ? cloneOperationDiagnostics(report.operations.series_catalog)
      : null,
  };

  return {
    ...report,
    operations: clonedOps,
    operationHistory: report.operationHistory.map(cloneOperationDiagnostics),
    sorting: {
      vod: { ...report.sorting.vod },
      series: { ...report.sorting.series },
      hero: { ...report.sorting.hero },
      liveGroups: { ...report.sorting.liveGroups },
      totalNewSortsCount: report.sorting.totalNewSortsCount,
      totalCacheHitsCount: report.sorting.totalCacheHitsCount,
      totalSortMs: report.sorting.totalSortMs,
    },
  };
}

function roundMs(value: number): number {
  return Math.max(0, Math.round(value * 100) / 100);
}

function relativeToSessionMs(
  report: CatalogSessionDiagnosticsReport,
  monotonicNow: number
): number {
  return roundMs(Math.max(0, monotonicNow - report.startedAtMonotonicMs));
}

function parseDomainAndKind(type: CatalogOperationType): {
  domain: CatalogOperationDomain;
  kind: CatalogOperationKind;
} {
  if (type.startsWith('live_')) {
    return {
      domain: 'live',
      kind: type.endsWith('_categories') ? 'categories' : 'catalog',
    };
  }
  if (type.startsWith('vod_')) {
    return {
      domain: 'vod',
      kind: type.endsWith('_categories') ? 'categories' : 'catalog',
    };
  }
  return {
    domain: 'series',
    kind: type.endsWith('_categories') ? 'categories' : 'catalog',
  };
}

export function classifyDiagnosticErrorCategory(err: unknown): CatalogErrorCategory {
  if (!err || typeof err !== 'object') return 'unknown';
  const anyErr = err as Record<string, any>;
  const msg = String(anyErr.message || '');

  if (/Operação cancelada pelo usuário|aborted|cancel/i.test(msg)) {
    return 'cancelled';
  }
  if (anyErr.isAuthError === true || anyErr.status === 401 || anyErr.status === 403) {
    return 'auth_rejected';
  }
  if (/usuário ou senha (inválidos|incorretos)|conta (de usuário )?(desativada|expirada|banida)|credenciais inválidas|acesso (negado|expirado)/i.test(msg)) {
    return 'auth_rejected';
  }
  if (anyErr.isFatalFormat === true || /formato inválido|esperava-se uma lista|não é um JSON válido/i.test(msg)) {
    return 'invalid_format';
  }
  if (/tempo limite|timeout|timed out/i.test(msg)) {
    return 'timeout';
  }
  if (typeof anyErr.status === 'number') {
    if (anyErr.status >= 400 && anyErr.status < 500) return 'http_4xx';
    if (anyErr.status >= 500) return 'http_5xx';
  }
  if (anyErr.isTransient === true || /falha de rede|cors/i.test(msg)) {
    return 'network';
  }
  return 'unknown';
}

export function getCurrentCatalogTransportKind(): CatalogTransportKind {
  return isUsingCapacitorNativeTransport() ? 'capacitor-native' : 'web-fetch';
}

/**
 * Starts a new in-memory diagnostics session for `sessionId`.
 * Replaces any previous session report in memory so only the most recent session is retained.
 * Does nothing when catalog diagnostics are disabled.
 */
export function startCatalogDiagnosticsSession(
  sessionId: number,
  maxConcurrency: number = 2
): void {
  if (!isCatalogDiagnosticsEnabled) return;

  recordedEventsCountForTest++;
  const startMonotonic = nowMonotonicMs();

  activeSessionReport = {
    sessionId,
    transportMode: getCurrentCatalogTransportKind(),
    maxConcurrency,
    startedAtMonotonicMs: startMonotonic,
    allSixFinishedAtMs: null,
    overlayDismissedAtMs: null,
    homeAvailableAtMs: null,
    releaseTrigger: 'pending',
    wasDisplaySetupShown: false,
    displaySetupOpenedAtMs: null,
    displaySetupClosedAtMs: null,
    displaySetupWaitMs: 0,
    netProcessingUntilHomeAvailableMs: null,
    operations: {
      live_categories: null,
      vod_categories: null,
      series_categories: null,
      live_catalog: null,
      vod_catalog: null,
      series_catalog: null,
    },
    operationHistory: [],
    sorting: createEmptySortingDiagnostics(),
  };

  notifyDiagnosticsListeners();
}

/**
 * Marks any in-flight operations/attempts belonging to `sessionId` as cancelled
 * when that session is still the active session (e.g., on unmount or explicit cancellation).
 */
export function cancelCatalogDiagnosticsSession(sessionId: number): void {
  if (!isCatalogDiagnosticsEnabled) return;
  if (!activeSessionReport || activeSessionReport.sessionId !== sessionId) return;

  recordedEventsCountForTest++;
  const nowRel = relativeToSessionMs(activeSessionReport, nowMonotonicMs());
  let changed = false;

  for (const op of activeSessionReport.operationHistory) {
    if (op.outcome === 'queued' || op.outcome === 'running') {
      op.outcome = 'cancelled';
      op.errorCategory = 'cancelled';
      op.completedAtMs = nowRel;
      if (op.startedAtMs !== null) {
        op.executionMs = roundMs(Math.max(0, nowRel - op.startedAtMs));
      }
      op.totalElapsedMs = roundMs(Math.max(0, nowRel - op.enqueuedAtMs));
      for (const att of op.attempts) {
        if (att.outcome === 'running') {
          att.outcome = 'cancelled';
          att.errorCategory = 'cancelled';
          att.endedAtMs = nowRel;
          att.durationMs = roundMs(Math.max(0, nowRel - att.startedAtMs));
        }
      }
      changed = true;
    }
  }

  if (changed) {
    notifyDiagnosticsListeners();
  }
}

/**
 * Records deduplication hit (and optional priority elevation) when an already queued/running
 * operation is requested again in the same session.
 */
export function recordCatalogOperationDeduplicated(
  sessionId: number,
  type: CatalogOperationType,
  requestedPriority: number
): void {
  if (!isCatalogDiagnosticsEnabled) return;
  if (!activeSessionReport || activeSessionReport.sessionId !== sessionId) return;

  const op = activeSessionReport.operations[type];
  if (!op) return;

  recordedEventsCountForTest++;
  op.deduplicatedHits++;
  if (requestedPriority > op.effectivePriority) {
    op.effectivePriority = requestedPriority;
  }
  notifyDiagnosticsListeners();
}

/**
 * Records that an operation has entered the concurrency queue for `sessionId`.
 */
export function recordCatalogOperationEnqueued(
  sessionId: number,
  type: CatalogOperationType,
  priority: number
): CatalogDiagnosticOperationHandle | null {
  if (!isCatalogDiagnosticsEnabled) return null;
  if (!activeSessionReport || activeSessionReport.sessionId !== sessionId) return null;

  recordedEventsCountForTest++;
  const report = activeSessionReport;
  const enqueuedAtMs = relativeToSessionMs(report, nowMonotonicMs());
  const prevRunsCount = report.operationHistory.filter((item) => item.type === type).length;
  const runNumber = prevRunsCount + 1;
  const operationId = `s${sessionId}:${type}#${runNumber}`;
  const { domain, kind } = parseDomainAndKind(type);

  const opRecord: CatalogOperationDiagnostics = {
    operationId,
    sessionId,
    runNumber,
    type,
    domain,
    kind,
    initialPriority: priority,
    effectivePriority: priority,
    deduplicatedHits: 0,
    enqueuedAtMs,
    startedAtMs: null,
    completedAtMs: null,
    queueWaitMs: null,
    executionMs: null,
    totalElapsedMs: null,
    outcome: 'queued',
    errorCategory: null,
    retryCount: 0,
    retryWaitMs: 0,
    attempts: [],
    normalizationMs: null,
    rawItemsCount: null,
    validItemsCount: null,
    indexBuildMode: 'none',
    indexFromCache: false,
    indexElapsedMs: null,
    indexActiveComputeMs: null,
    indexBatchesProcessed: 0,
    indexBatchYields: 0,
    indexedItemsCount: null,
    indexCancelled: false,
  };

  report.operations[type] = opRecord;
  report.operationHistory.push(opRecord);
  notifyDiagnosticsListeners();

  const isOpStillActive = (): boolean => {
    return (
      isCatalogDiagnosticsEnabled &&
      activeSessionReport !== null &&
      activeSessionReport.sessionId === sessionId &&
      opRecord.outcome !== 'cancelled'
    );
  };

  const handle: CatalogDiagnosticOperationHandle = {
    sessionId,
    operationId,
    type,
    isActive: isOpStillActive,
    startAttempt(attemptNumber: number): CatalogDiagnosticAttemptHandle | null {
      if (!isOpStillActive() || !activeSessionReport) return null;
      recordedEventsCountForTest++;
      const currentReport = activeSessionReport;
      const attemptStartRel = relativeToSessionMs(currentReport, nowMonotonicMs());
      const transportKind = getCurrentCatalogTransportKind();
      currentReport.transportMode = transportKind;

      if (attemptNumber > 1) {
        opRecord.retryCount = Math.max(opRecord.retryCount, attemptNumber - 1);
      }

      const attemptRecord: CatalogAttemptDiagnostics = {
        attemptNumber,
        startedAtMs: attemptStartRel,
        endedAtMs: null,
        durationMs: null,
        outcome: 'running',
        errorCategory: null,
        httpStatus: null,
        transportKind,
        responseWaitMs: null,
        bodyReadMs: null,
        nativeTransportAndBridgeMs: null,
        payloadFormat: null,
        jsonParseExecuted: false,
        jsonParseMs: null,
        payloadChars: null,
      };

      opRecord.attempts.push(attemptRecord);
      notifyDiagnosticsListeners();

      const isAttemptActive = (): boolean => {
        return isOpStillActive() && attemptRecord.outcome === 'running';
      };

      return {
        sessionId,
        operationId,
        attemptNumber,
        isActive: isAttemptActive,
        recordWebResponseWait(durationMs: number, httpStatus?: number) {
          if (!isAttemptActive()) return;
          recordedEventsCountForTest++;
          attemptRecord.responseWaitMs = roundMs(durationMs);
          if (httpStatus !== undefined) {
            attemptRecord.httpStatus = httpStatus;
          }
        },
        recordWebBodyRead(durationMs: number, charLength: number) {
          if (!isAttemptActive()) return;
          recordedEventsCountForTest++;
          attemptRecord.bodyReadMs = roundMs(durationMs);
          attemptRecord.payloadChars = charLength;
        },
        recordCapacitorTransportAndBridge(durationMs: number, httpStatus?: number) {
          if (!isAttemptActive()) return;
          recordedEventsCountForTest++;
          attemptRecord.nativeTransportAndBridgeMs = roundMs(durationMs);
          if (httpStatus !== undefined) {
            attemptRecord.httpStatus = httpStatus;
          }
        },
        recordPayloadNormalization(params) {
          if (!isAttemptActive()) return;
          recordedEventsCountForTest++;
          attemptRecord.payloadFormat = params.payloadFormat;
          attemptRecord.jsonParseExecuted = params.jsonParseExecuted;
          attemptRecord.jsonParseMs =
            params.jsonParseMs !== null ? roundMs(params.jsonParseMs) : null;
          if (params.payloadChars !== null) {
            attemptRecord.payloadChars = params.payloadChars;
          }
        },
        finishAttempt(outcome, errorCategory = null, httpStatus = null) {
          if (!isOpStillActive() || !activeSessionReport) return;
          if (attemptRecord.outcome !== 'running') return;
          recordedEventsCountForTest++;
          const endRel = relativeToSessionMs(activeSessionReport, nowMonotonicMs());
          attemptRecord.endedAtMs = endRel;
          attemptRecord.durationMs = roundMs(Math.max(0, endRel - attemptRecord.startedAtMs));
          attemptRecord.outcome = outcome;
          attemptRecord.errorCategory = errorCategory;
          if (httpStatus !== null && httpStatus !== undefined) {
            attemptRecord.httpStatus = httpStatus;
          }
          notifyDiagnosticsListeners();
        },
      };
    },
    recordRetryWait(waitMs: number) {
      if (!isOpStillActive()) return;
      recordedEventsCountForTest++;
      opRecord.retryWaitMs = roundMs(opRecord.retryWaitMs + Math.max(0, waitMs));
      notifyDiagnosticsListeners();
    },
    recordNormalization(params) {
      if (!isOpStillActive()) return;
      recordedEventsCountForTest++;
      opRecord.normalizationMs = roundMs(params.durationMs);
      opRecord.rawItemsCount = params.rawItemsCount;
      opRecord.validItemsCount = params.validItemsCount;
      notifyDiagnosticsListeners();
    },
    recordResultItemsFallback(validItemsCount: number) {
      if (!isOpStillActive()) return;
      if (opRecord.validItemsCount === null) {
        recordedEventsCountForTest++;
        opRecord.rawItemsCount = validItemsCount;
        opRecord.validItemsCount = validItemsCount;
        if (opRecord.normalizationMs === null) {
          opRecord.normalizationMs = 0;
        }
      }
    },
    recordIndexBuild(params) {
      if (!isOpStillActive()) return;
      recordedEventsCountForTest++;
      opRecord.indexBuildMode = params.mode;
      opRecord.indexFromCache = params.fromCache;
      opRecord.indexElapsedMs = roundMs(params.elapsedMs);
      opRecord.indexActiveComputeMs = roundMs(params.activeComputeMs);
      opRecord.indexBatchesProcessed = params.batchesProcessed;
      opRecord.indexBatchYields = params.batchYields;
      opRecord.indexedItemsCount = params.indexedItemsCount;
      opRecord.indexCancelled = params.cancelled;
      notifyDiagnosticsListeners();
    },
  };

  return handle;
}

/**
 * Records the moment an enqueued operation actually begins executing in a concurrency slot.
 */
export function recordCatalogOperationStarted(
  handle: CatalogDiagnosticOperationHandle | null | undefined
): void {
  if (!handle || !isCatalogDiagnosticsEnabled) return;
  if (!activeSessionReport || activeSessionReport.sessionId !== handle.sessionId) return;

  const op = activeSessionReport.operationHistory.find(
    (item) => item.operationId === handle.operationId
  );
  if (!op || op.outcome !== 'queued') return;

  recordedEventsCountForTest++;
  const startedAtMs = relativeToSessionMs(activeSessionReport, nowMonotonicMs());
  op.startedAtMs = startedAtMs;
  op.queueWaitMs = roundMs(Math.max(0, startedAtMs - op.enqueuedAtMs));
  op.outcome = 'running';
  notifyDiagnosticsListeners();
}

/**
 * Records the completion of an operation ('success' | 'error' | 'cancelled').
 * Automatically checks if all 6 operations of the session have finished.
 */
export function recordCatalogOperationFinished(
  handle: CatalogDiagnosticOperationHandle | null | undefined,
  outcome: 'success' | 'error' | 'cancelled',
  err?: unknown
): void {
  if (!handle || !isCatalogDiagnosticsEnabled) return;
  if (!activeSessionReport || activeSessionReport.sessionId !== handle.sessionId) return;

  const report = activeSessionReport;
  const op = report.operationHistory.find(
    (item) => item.operationId === handle.operationId
  );
  if (!op || (op.outcome !== 'running' && op.outcome !== 'queued')) return;

  recordedEventsCountForTest++;
  const completedAtMs = relativeToSessionMs(report, nowMonotonicMs());
  if (op.startedAtMs === null) {
    op.startedAtMs = completedAtMs;
    op.queueWaitMs = roundMs(Math.max(0, completedAtMs - op.enqueuedAtMs));
  }
  op.completedAtMs = completedAtMs;
  op.executionMs = roundMs(Math.max(0, completedAtMs - op.startedAtMs));
  op.totalElapsedMs = roundMs(Math.max(0, completedAtMs - op.enqueuedAtMs));
  op.outcome = outcome;

  if (outcome === 'cancelled') {
    op.errorCategory = 'cancelled';
  } else if (outcome === 'error') {
    op.errorCategory = classifyDiagnosticErrorCategory(err);
  } else {
    op.errorCategory = null;
  }

  for (const att of op.attempts) {
    if (att.outcome === 'running') {
      att.endedAtMs = completedAtMs;
      att.durationMs = roundMs(Math.max(0, completedAtMs - att.startedAtMs));
      att.outcome = outcome;
      att.errorCategory = op.errorCategory;
    }
  }

  const allSixDone = ALL_OPERATION_TYPES.every((t) => {
    const currentOp = report.operations[t];
    return (
      currentOp !== null &&
      (currentOp.outcome === 'success' || currentOp.outcome === 'error')
    );
  });

  if (allSixDone && report.allSixFinishedAtMs === null) {
    report.allSixFinishedAtMs = completedAtMs;
    if (report.releaseTrigger === 'pending') {
      report.releaseTrigger = 'auto_all_six';
      report.overlayDismissedAtMs = completedAtMs;
    }
  }

  notifyDiagnosticsListeners();
}

/**
 * Records sorting execution vs cache hit in `catalogIndex.ts`.
 */
export function recordCatalogSortDiagnostic(
  domain: CatalogSortDomain,
  fromCache: boolean,
  durationMs: number,
  itemsCount: number
): void {
  if (!isCatalogDiagnosticsEnabled || !activeSessionReport) return;

  recordedEventsCountForTest++;
  const bucket = activeSessionReport.sorting[domain];
  bucket.lastSortedItemsCount = itemsCount;

  if (fromCache) {
    bucket.cacheHitsCount++;
    activeSessionReport.sorting.totalCacheHitsCount++;
  } else {
    const rounded = roundMs(durationMs);
    bucket.newSortsCount++;
    bucket.totalSortMs = roundMs(bucket.totalSortMs + rounded);
    activeSessionReport.sorting.totalNewSortsCount++;
    activeSessionReport.sorting.totalSortMs = roundMs(
      activeSessionReport.sorting.totalSortMs + rounded
    );
  }

  notifyDiagnosticsListeners();
}

/**
 * Records opening milestones from HomeContent (`Home.tsx`), separating:
 * - when all 6 operations finish (`allSixFinishedAtMs`)
 * - whether release was automatic (`'auto_all_six'`), manual (`'manual_continue_button'`), or auth rejected (`'auth_rejected'`)
 * - any time spent waiting on the DisplaySetupModal (`displaySetupWaitMs`)
 * - the exact moment the Home interface becomes available (`homeAvailableAtMs`)
 */
export function recordHomeOpeningMilestone(params: {
  isDisplaySetupOpen: boolean;
  isOverlayActive: boolean;
  isAuthRejected: boolean;
  allSixFinished: boolean;
  manualContinueClicked?: boolean;
}): void {
  if (!isCatalogDiagnosticsEnabled || !activeSessionReport) return;

  const report = activeSessionReport;
  const nowRel = relativeToSessionMs(report, nowMonotonicMs());
  let changed = false;

  if (params.isDisplaySetupOpen) {
    if (!report.wasDisplaySetupShown) {
      report.wasDisplaySetupShown = true;
      report.displaySetupOpenedAtMs = nowRel;
      changed = true;
    }
  } else if (report.wasDisplaySetupShown && report.displaySetupClosedAtMs === null) {
    report.displaySetupClosedAtMs = nowRel;
    const openAt = report.displaySetupOpenedAtMs ?? 0;
    report.displaySetupWaitMs = roundMs(Math.max(0, nowRel - openAt));
    changed = true;
  }

  if (params.manualContinueClicked && report.releaseTrigger === 'pending') {
    report.releaseTrigger = 'manual_continue_button';
    report.overlayDismissedAtMs = nowRel;
    changed = true;
  }

  if (params.isAuthRejected && report.releaseTrigger === 'pending') {
    report.releaseTrigger = 'auth_rejected';
    report.overlayDismissedAtMs = nowRel;
    changed = true;
  }

  if (params.allSixFinished) {
    if (report.allSixFinishedAtMs === null) {
      report.allSixFinishedAtMs = nowRel;
      changed = true;
    }
    if (report.releaseTrigger === 'pending') {
      report.releaseTrigger = 'auto_all_six';
      report.overlayDismissedAtMs = nowRel;
      changed = true;
    }
  }

  const isHomeInteractiveNow =
    !params.isOverlayActive && !params.isDisplaySetupOpen && !params.isAuthRejected;

  if (isHomeInteractiveNow && report.homeAvailableAtMs === null) {
    report.homeAvailableAtMs = nowRel;
    if (report.overlayDismissedAtMs === null) {
      report.overlayDismissedAtMs = nowRel;
    }
    if (report.releaseTrigger === 'pending') {
      report.releaseTrigger = params.allSixFinished
        ? 'auto_all_six'
        : 'manual_continue_button';
    }
    const waitMs =
      report.wasDisplaySetupShown && report.displaySetupClosedAtMs !== null
        ? report.displaySetupWaitMs
        : 0;
    report.netProcessingUntilHomeAvailableMs = roundMs(
      Math.max(0, report.homeAvailableAtMs - waitMs)
    );
    changed = true;
  }

  if (changed) {
    recordedEventsCountForTest++;
    notifyDiagnosticsListeners();
  }
}

export function getCatalogDiagnosticsSnapshot(): CatalogSessionDiagnosticsReport | null {
  return publishedSnapshot;
}

export function subscribeCatalogDiagnostics(listener: () => void): () => void {
  diagnosticsListeners.add(listener);
  return () => {
    diagnosticsListeners.delete(listener);
  };
}

export function useCatalogLoadDiagnostics(
  active: boolean = true
): CatalogSessionDiagnosticsReport | null {
  const subscribe = (listener: () => void) => {
    if (!active) return () => {};
    return subscribeCatalogDiagnostics(listener);
  };
  const getSnap = () => (active ? getCatalogDiagnosticsSnapshot() : null);
  return useSyncExternalStore(subscribe, getSnap, getSnap);
}

function formatMs(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) {
    return 'indisponível';
  }
  return `${val.toFixed(1)} ms`;
}

function formatReleaseTriggerLabel(trigger: CatalogReleaseTrigger): string {
  switch (trigger) {
    case 'auto_all_six':
      return 'Automática (6 operações concluídas)';
    case 'manual_continue_button':
      return 'Manual (botão "Continuar enquanto carrega")';
    case 'auth_rejected':
      return 'Interrompida (rejeição de autenticação)';
    default:
      return 'Pendente (em carregamento)';
  }
}

function formatOutcomeLabel(
  outcome: CatalogOperationOutcome,
  errorCategory: CatalogErrorCategory | null,
  retryCount: number
): string {
  const retrySuffix = retryCount > 0 ? ` (após ${retryCount} retry)` : '';
  switch (outcome) {
    case 'success':
      return `sucesso${retrySuffix}`;
    case 'error':
      return `erro [${errorCategory || 'unknown'}]${retrySuffix}`;
    case 'cancelled':
      return `cancelada${retrySuffix}`;
    case 'running':
      return `em execução${retrySuffix}`;
    case 'queued':
      return 'na fila';
    default:
      return 'inativa';
  }
}

function formatPayloadFormatLabel(fmt: CatalogPayloadFormat | null): string {
  if (fmt === 'pre-parsed-object') return 'objeto/array já interpretado';
  if (fmt === 'text-json') return 'texto JSON';
  if (fmt === 'empty') return 'vazio';
  return 'n/a';
}

function formatIndexBuildModeLabel(mode: CatalogIndexBuildMode, fromCache: boolean): string {
  if (mode === 'none') return 'não aplicável (categorias)';
  if (fromCache || mode === 'memory-cache') return 'leitura do cache em memória';
  if (mode === 'async-cooperative') return 'cooperativa assíncrona (lotes)';
  return 'síncrona';
}

/**
 * Generates a sanitized, human-readable and machine-verifiable diagnostics report
 * for the most recent session in memory.
 * Strictly excludes credentials, server URLs, account names, response content, and raw provider messages.
 */
export function formatCatalogDiagnosticsReport(
  report: CatalogSessionDiagnosticsReport | null = publishedSnapshot
): string {
  const enabled = isCatalogDiagnosticsEnabled;
  const lines: string[] = [
    `--- Diagnóstico de Abertura dos Catálogos (P3.1) ---`,
    `Coleta na abertura: ${enabled ? 'Ativada' : 'Desativada (padrão)'}`,
  ];

  if (!enabled) {
    lines.push(
      `Status: Coleta desativada. Ative o diagnóstico nas Configurações e reabra o aplicativo para registrar as métricas da abertura.`
    );
    return lines.join('\n');
  }

  if (!report) {
    lines.push(`Status: Aguardando início da sessão de carregamento em memória.`);
    return lines.join('\n');
  }

  const transportLabel =
    report.transportMode === 'capacitor-native'
      ? 'Android CapacitorHttp (transporte + ponte nativa)'
      : 'Navegador Web (fetch)';

  lines.push(
    `Sessão local: #${report.sessionId} | Transporte: ${transportLabel} | Concorrência máx.: ${report.maxConcurrency}`
  );
  lines.push(`[Marcos de Abertura]`);
  lines.push(
    `• Conclusão das 6 operações iniciais: ${formatMs(report.allSixFinishedAtMs)}`
  );
  lines.push(
    `• Liberação da interface Home: ${formatMs(report.homeAvailableAtMs)} | Modo: ${formatReleaseTriggerLabel(
      report.releaseTrigger
    )}`
  );
  lines.push(
    `• Espera no seletor de apresentação: ${
      report.wasDisplaySetupShown
        ? `${formatMs(report.displaySetupWaitMs)} (aberto em ${formatMs(
            report.displaySetupOpenedAtMs
          )} → concluído em ${formatMs(report.displaySetupClosedAtMs)})`
        : '0.0 ms (já configurado)'
    }`
  );
  lines.push(
    `• Janela de processamento até liberar a Home (excluindo seletor): ${formatMs(
      report.netProcessingUntilHomeAvailableMs
    )}`
  );

  lines.push(`[Operações da Sessão #${report.sessionId} (operações paralelas podem se sobrepor)]`);

  for (const opType of ALL_OPERATION_TYPES) {
    const op = report.operations[opType];
    if (!op) {
      lines.push(`• ${opType}: não iniciada`);
      continue;
    }

    lines.push(
      `• ${op.operationId} [${op.type}] (domínio=${op.domain}, prio=${op.initialPriority}→${
        op.effectivePriority
      }, dedup=${op.deduplicatedHits}): resultado=${formatOutcomeLabel(
        op.outcome,
        op.errorCategory,
        op.retryCount
      )}`
    );
    lines.push(
      `  - Tempos: fila=${formatMs(op.queueWaitMs)} (entrada=${formatMs(
        op.enqueuedAtMs
      )} → início=${formatMs(op.startedAtMs)}) | execução=${formatMs(
        op.executionMs
      )} | total=${formatMs(op.totalElapsedMs)} (fim=${formatMs(op.completedAtMs)})${
        op.retryCount > 0 ? ` | espera retry=${formatMs(op.retryWaitMs)}` : ''
      }`
    );

    for (const att of op.attempts) {
      const transportDetail =
        att.transportKind === 'capacitor-native'
          ? `transporte + ponte nativa (CapacitorHttp)=${formatMs(
              att.nativeTransportAndBridgeMs
            )}`
          : `espera resposta=${formatMs(att.responseWaitMs)} | leitura corpo=${formatMs(
              att.bodyReadMs
            )}`;

      const parseDetail = att.jsonParseExecuted
        ? `JSON.parse=${formatMs(att.jsonParseMs)} (executado em JS, formato=${formatPayloadFormatLabel(
            att.payloadFormat
          )})`
        : `JSON.parse=não executado (formato=${formatPayloadFormatLabel(
            att.payloadFormat
          )})`;

      lines.push(
        `  - Tentativa #${att.attemptNumber}: ${att.outcome}${
          att.errorCategory ? ` [${att.errorCategory}]` : ''
        }${att.httpStatus ? ` (HTTP ${att.httpStatus})` : ''} | ${transportDetail} | ${parseDetail} | duração=${formatMs(
          att.durationMs
        )}`
      );
    }

    if (op.normalizationMs !== null || op.validItemsCount !== null) {
      lines.push(
        `  - Normalização: ${formatMs(op.normalizationMs)} | itens=${
          op.validItemsCount ?? 0
        } válidos (brutos=${op.rawItemsCount ?? 0})`
      );
    }

    if (op.kind === 'catalog') {
      lines.push(
        `  - Indexação (${formatIndexBuildModeLabel(
          op.indexBuildMode,
          op.indexFromCache
        )}): tempo decorrido (c/ pausas)=${formatMs(
          op.indexElapsedMs
        )} | processamento ativo=${formatMs(op.indexActiveComputeMs)} | lotes=${
          op.indexBatchesProcessed
        } (pausas=${op.indexBatchYields}) | itens indexados=${
          op.indexedItemsCount ?? 0
        }${op.indexCancelled ? ' [cancelada]' : ''}`
      );
    }
  }

  const s = report.sorting;
  lines.push(`[Ordenações e Agrupamentos em Memória]`);
  lines.push(
    `• Total: ${s.totalNewSortsCount} ordenações novas (${formatMs(
      s.totalSortMs
    )}) vs ${s.totalCacheHitsCount} leituras do cache em memória`
  );
  lines.push(
    `  - Filmes (VOD): novas=${s.vod.newSortsCount} (${formatMs(
      s.vod.totalSortMs
    )}, itens=${s.vod.lastSortedItemsCount}) | cache=${s.vod.cacheHitsCount}`
  );
  lines.push(
    `  - Séries: novas=${s.series.newSortsCount} (${formatMs(
      s.series.totalSortMs
    )}, itens=${s.series.lastSortedItemsCount}) | cache=${s.series.cacheHitsCount}`
  );
  lines.push(
    `  - Destaque (HeroBanner): novas=${s.hero.newSortsCount} (${formatMs(
      s.hero.totalSortMs
    )}, itens=${s.hero.lastSortedItemsCount}) | cache=${s.hero.cacheHitsCount}`
  );
  lines.push(
    `  - Agrupamento Canais Ao Vivo: novas=${s.liveGroups.newSortsCount} (${formatMs(
      s.liveGroups.totalSortMs
    )}, itens=${s.liveGroups.lastSortedItemsCount}) | cache=${s.liveGroups.cacheHitsCount}`
  );

  return lines.join('\n');
}
