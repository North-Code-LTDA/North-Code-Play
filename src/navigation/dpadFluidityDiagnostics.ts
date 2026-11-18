import { safeReadStorage, safeSetStorage } from '../utils/safeStorage';
import { isAndroidCapacitorRuntime } from '../utils/xtreamreckoner';

export type DpadNavigationBehaviorMode = 'current' | 'optimized';

export const DPAD_FLUIDITY_DIAGNOSTICS_ENABLED_KEY = 'nc_dpad_fluidity_diagnostics_enabled_v1';
export const DPAD_NAVIGATION_BEHAVIOR_MODE_KEY = 'nc_dpad_nav_behavior_mode_v1';

const LATENCY_RING_BUFFER_SIZE = 256;
const ACTIVE_NAV_WINDOW_MS = 320;
const FRAME_MONITOR_IDLE_STOP_MS = 450;

export interface DpadLatencySummary {
  sampleCount: number;
  lastMs: number | null;
  medianMs: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  maxMs: number | null;
}

export interface DpadDirectionBreakdown {
  up: number;
  down: number;
  left: number;
  right: number;
}

export interface DpadFluidityDiagnosticsSnapshot {
  enabled: boolean;
  behaviorMode: DpadNavigationBehaviorMode;
  effectiveOptimizedActive: boolean;
  totalEventsReceived: number;
  singlePressEventsCount: number;
  repeatPressEventsCount: number;
  coalescedRepeatEventsCount: number;
  completedMovesCount: number;
  noOpMovesCount: number;
  byDirection: DpadDirectionBreakdown;
  fastVerticalPathHits: number;
  fastHorizontalPathHits: number;
  globalFallbackMovesCount: number;
  commandProcessLatency: DpadLatencySummary;
  focusUpdateLatency: DpadLatencySummary;
  firstFrameAfterCommandLatency: DpadLatencySummary;
  flushSyncCount: number;
  flushSyncTotalMs: number;
  flushSyncMaxMs: number;
  geometryMeasureCount: number;
  geometryBeforeVirtualTotalMs: number;
  geometryAfterVirtualTotalMs: number;
  geometryMaxMs: number;
  rowsMountedDuringNav: number;
  rowsUnmountedDuringNav: number;
  cardsMountedDuringNav: number;
  cardsUnmountedDuringNav: number;
  sampledFramesDuringNav: number;
  frameIntervalsOver34MsCount: number;
  frameIntervalsOver50MsCount: number;
  maxFrameIntervalMs: number;
  longTasksSupported: boolean;
  longTasksCount: number;
  longTasksTotalMs: number;
  longTasksMaxMs: number;
  imageRequestsStartedDuringNav: number;
  imageRequestsCompletedDuringNav: number;
  imgOnLoadEventsDuringNav: number;
  categorySortsExecutedDuringNav: number;
  categorySortDurationDuringNavMs: number;
  diagnosticsSelfOverheadTotalMs: number;
  diagnosticsSelfOverheadMaxMs: number;
}

interface LatencyRingBuffer {
  buffer: Float64Array;
  writeIndex: number;
  count: number;
  lastValue: number | null;
  maxValue: number | null;
}

function createLatencyRingBuffer(): LatencyRingBuffer {
  return {
    buffer: new Float64Array(LATENCY_RING_BUFFER_SIZE),
    writeIndex: 0,
    count: 0,
    lastValue: null,
    maxValue: null,
  };
}

function resetLatencyRingBuffer(rb: LatencyRingBuffer): void {
  rb.writeIndex = 0;
  rb.count = 0;
  rb.lastValue = null;
  rb.maxValue = null;
}

function pushLatencySample(rb: LatencyRingBuffer, rawMs: number): void {
  if (!Number.isFinite(rawMs) || rawMs < 0) return;
  const val = Math.round(rawMs * 100) / 100;
  rb.buffer[rb.writeIndex] = val;
  rb.writeIndex = (rb.writeIndex + 1) % LATENCY_RING_BUFFER_SIZE;
  if (rb.count < LATENCY_RING_BUFFER_SIZE) {
    rb.count++;
  }
  rb.lastValue = val;
  if (rb.maxValue === null || val > rb.maxValue) {
    rb.maxValue = val;
  }
}

function summarizeLatencyRingBuffer(rb: LatencyRingBuffer): DpadLatencySummary {
  if (rb.count === 0) {
    return {
      sampleCount: 0,
      lastMs: null,
      medianMs: null,
      p95Ms: null,
      p99Ms: null,
      maxMs: null,
    };
  }
  const slice = Array.from(rb.buffer.subarray(0, rb.count)).sort((a, b) => a - b);
  const pickPercentile = (p: number): number => {
    const idx = Math.min(slice.length - 1, Math.max(0, Math.ceil((p / 100) * slice.length) - 1));
    return slice[idx];
  };
  const mid = Math.floor(slice.length / 2);
  const median =
    slice.length % 2 === 1
      ? slice[mid]
      : Math.round(((slice[mid - 1] + slice[mid]) / 2) * 100) / 100;

  return {
    sampleCount: rb.count,
    lastMs: rb.lastValue,
    medianMs: median,
    p95Ms: pickPercentile(95),
    p99Ms: pickPercentile(99),
    maxMs: rb.maxValue,
  };
}

function readInitialEnabledFlag(): boolean {
  const res = safeReadStorage(DPAD_FLUIDITY_DIAGNOSTICS_ENABLED_KEY);
  return res.success && res.value === 'true';
}

function readInitialBehaviorMode(): DpadNavigationBehaviorMode {
  const res = safeReadStorage(DPAD_NAVIGATION_BEHAVIOR_MODE_KEY);
  if (res.success && (res.value === 'current' || res.value === 'optimized')) {
    return res.value;
  }
  return isAndroidCapacitorRuntime() ? 'optimized' : 'current';
}

let isFluidityDiagnosticsEnabled: boolean = readInitialEnabledFlag();
let currentBehaviorMode: DpadNavigationBehaviorMode = readInitialBehaviorMode();
let behaviorModeExplicitlySet: boolean = (() => {
  const res = safeReadStorage(DPAD_NAVIGATION_BEHAVIOR_MODE_KEY);
  return res.success && (res.value === 'current' || res.value === 'optimized');
})();

let customClockForTest: (() => number) | null = null;

function nowMs(): number {
  if (customClockForTest) return customClockForTest();
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function roundMs(val: number): number {
  return Math.max(0, Math.round(val * 100) / 100);
}

const commandProcessSamples = createLatencyRingBuffer();
const focusUpdateSamples = createLatencyRingBuffer();
const firstFrameSamples = createLatencyRingBuffer();

let totalEventsReceived = 0;
let singlePressEventsCount = 0;
let repeatPressEventsCount = 0;
let coalescedRepeatEventsCount = 0;
let completedMovesCount = 0;
let noOpMovesCount = 0;
const byDirection: DpadDirectionBreakdown = { up: 0, down: 0, left: 0, right: 0 };
let fastVerticalPathHits = 0;
let fastHorizontalPathHits = 0;
let globalFallbackMovesCount = 0;

let flushSyncCount = 0;
let flushSyncTotalMs = 0;
let flushSyncMaxMs = 0;

let geometryMeasureCount = 0;
let geometryBeforeVirtualTotalMs = 0;
let geometryAfterVirtualTotalMs = 0;
let geometryMaxMs = 0;

let rowsMountedDuringNav = 0;
let rowsUnmountedDuringNav = 0;
let cardsMountedDuringNav = 0;
let cardsUnmountedDuringNav = 0;

let sampledFramesDuringNav = 0;
let frameIntervalsOver34MsCount = 0;
let frameIntervalsOver50MsCount = 0;
let maxFrameIntervalMs = 0;

let longTasksSupported = false;
let longTasksCount = 0;
let longTasksTotalMs = 0;
let longTasksMaxMs = 0;
let activeLongTaskObserver: PerformanceObserver | null = null;

let imageRequestsStartedDuringNav = 0;
let imageRequestsCompletedDuringNav = 0;
let imgOnLoadEventsDuringNav = 0;
let categorySortsExecutedDuringNav = 0;
let categorySortDurationDuringNavMs = 0;

let diagnosticsSelfOverheadTotalMs = 0;
let diagnosticsSelfOverheadMaxMs = 0;

let lastDpadCommandTimestampMs = -Infinity;
let activeFrameMonitorRafId: number | null = null;
let lastFrameTimestampMs: number | null = null;
let pendingFirstFrameCommandStartMs: number | null = null;

const listeners = new Set<() => void>();

function recordSelfOverhead(startMono: number): void {
  const elapsed = Math.max(0, nowMs() - startMono);
  diagnosticsSelfOverheadTotalMs = roundMs(diagnosticsSelfOverheadTotalMs + elapsed);
  if (elapsed > diagnosticsSelfOverheadMaxMs) {
    diagnosticsSelfOverheadMaxMs = roundMs(elapsed);
  }
}

function notifyListeners(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // ignore
    }
  });
}

function ensureLongTaskObserverState(): void {
  if (!isFluidityDiagnosticsEnabled) {
    if (activeLongTaskObserver) {
      try {
        activeLongTaskObserver.disconnect();
      } catch {
        // ignore
      }
      activeLongTaskObserver = null;
    }
    return;
  }

  if (activeLongTaskObserver) return;

  if (
    typeof window === 'undefined' ||
    typeof (window as any).PerformanceObserver !== 'function'
  ) {
    longTasksSupported = false;
    return;
  }

  const PerfObs = (window as any).PerformanceObserver as typeof PerformanceObserver;
  const supportedTypes = Array.isArray((PerfObs as any).supportedEntryTypes)
    ? ((PerfObs as any).supportedEntryTypes as string[])
    : [];

  if (supportedTypes.length > 0 && !supportedTypes.includes('longtask')) {
    longTasksSupported = false;
    return;
  }

  try {
    const obs = new PerfObs((list) => {
      if (!isFluidityDiagnosticsEnabled) return;
      const t0 = nowMs();
      if (t0 - lastDpadCommandTimestampMs > FRAME_MONITOR_IDLE_STOP_MS) {
        return;
      }
      const entries = list.getEntries();
      for (let i = 0; i < entries.length; i++) {
        const dur = entries[i].duration;
        if (typeof dur === 'number' && dur > 0) {
          longTasksCount++;
          longTasksTotalMs = roundMs(longTasksTotalMs + dur);
          if (dur > longTasksMaxMs) {
            longTasksMaxMs = roundMs(dur);
          }
        }
      }
      recordSelfOverhead(t0);
    });
    obs.observe({ entryTypes: ['longtask'] });
    activeLongTaskObserver = obs;
    longTasksSupported = true;
  } catch {
    longTasksSupported = false;
    activeLongTaskObserver = null;
  }
}

function stopFrameMonitorLoop(): void {
  if (
    activeFrameMonitorRafId !== null &&
    typeof window !== 'undefined' &&
    typeof window.cancelAnimationFrame === 'function'
  ) {
    try {
      window.cancelAnimationFrame(activeFrameMonitorRafId);
    } catch {
      // ignore
    }
  }
  activeFrameMonitorRafId = null;
  lastFrameTimestampMs = null;
  pendingFirstFrameCommandStartMs = null;
}

function scheduleFrameMonitorTick(): void {
  if (
    !isFluidityDiagnosticsEnabled ||
    typeof window === 'undefined' ||
    typeof window.requestAnimationFrame !== 'function'
  ) {
    return;
  }
  if (activeFrameMonitorRafId !== null) return;

  activeFrameMonitorRafId = window.requestAnimationFrame((rafTimestamp) => {
    activeFrameMonitorRafId = null;
    if (!isFluidityDiagnosticsEnabled) {
      lastFrameTimestampMs = null;
      pendingFirstFrameCommandStartMs = null;
      return;
    }

    const t0 = nowMs();
    const currentMono =
      customClockForTest !== null
        ? t0
        : typeof rafTimestamp === 'number' && rafTimestamp > 0
          ? rafTimestamp
          : t0;

    if (pendingFirstFrameCommandStartMs !== null) {
      const firstFrameDelta = Math.max(0, t0 - pendingFirstFrameCommandStartMs);
      pushLatencySample(firstFrameSamples, firstFrameDelta);
      pendingFirstFrameCommandStartMs = null;
    }

    if (lastFrameTimestampMs !== null) {
      const delta = Math.max(0, currentMono - lastFrameTimestampMs);
      sampledFramesDuringNav++;
      if (delta > 34) {
        frameIntervalsOver34MsCount++;
      }
      if (delta > 50) {
        frameIntervalsOver50MsCount++;
      }
      if (delta > maxFrameIntervalMs) {
        maxFrameIntervalMs = roundMs(delta);
      }
    }
    lastFrameTimestampMs = currentMono;

    const shouldContinue = t0 - lastDpadCommandTimestampMs <= FRAME_MONITOR_IDLE_STOP_MS;
    recordSelfOverhead(t0);

    if (shouldContinue) {
      scheduleFrameMonitorTick();
    } else {
      lastFrameTimestampMs = null;
    }
  });
}

// Initialize observer if enabled at startup
ensureLongTaskObserverState();

export function isDpadFluidityDiagnosticsEnabled(): boolean {
  return isFluidityDiagnosticsEnabled;
}

export function setDpadFluidityDiagnosticsEnabled(enabled: boolean): boolean {
  const next = Boolean(enabled);
  const saved = safeSetStorage(DPAD_FLUIDITY_DIAGNOSTICS_ENABLED_KEY, next ? 'true' : 'false');
  isFluidityDiagnosticsEnabled = next;
  if (!next) {
    stopFrameMonitorLoop();
  }
  ensureLongTaskObserverState();
  notifyListeners();
  return saved;
}

export function getDpadNavigationBehaviorMode(): DpadNavigationBehaviorMode {
  if (!behaviorModeExplicitlySet) {
    return isAndroidCapacitorRuntime() ? 'optimized' : 'current';
  }
  return currentBehaviorMode;
}

export function setDpadNavigationBehaviorMode(mode: DpadNavigationBehaviorMode): boolean {
  const normalized: DpadNavigationBehaviorMode = mode === 'current' ? 'current' : 'optimized';
  const saved = safeSetStorage(DPAD_NAVIGATION_BEHAVIOR_MODE_KEY, normalized);
  currentBehaviorMode = normalized;
  behaviorModeExplicitlySet = true;
  notifyListeners();
  return saved;
}

/**
 * Returns true when the optimized D-Pad path should be executed.
 * On Web, defaults to 'current' unless explicitly switched to 'optimized'.
 * On Android APK, defaults to 'optimized' and can be switched to 'current' for A/B comparison.
 */
export function isDpadOptimizedPathActive(): boolean {
  return getDpadNavigationBehaviorMode() === 'optimized';
}

export function isDpadNavigationCurrentlyActiveWindow(): boolean {
  return nowMs() - lastDpadCommandTimestampMs <= ACTIVE_NAV_WINDOW_MS;
}

export function setDpadFluidityClockForTest(clockFn: (() => number) | null): void {
  customClockForTest = clockFn;
}

export function resetDpadFluidityDiagnostics(options?: {
  enabled?: boolean;
  behaviorMode?: DpadNavigationBehaviorMode;
  clearExplicitMode?: boolean;
}): void {
  stopFrameMonitorLoop();
  resetLatencyRingBuffer(commandProcessSamples);
  resetLatencyRingBuffer(focusUpdateSamples);
  resetLatencyRingBuffer(firstFrameSamples);

  totalEventsReceived = 0;
  singlePressEventsCount = 0;
  repeatPressEventsCount = 0;
  coalescedRepeatEventsCount = 0;
  completedMovesCount = 0;
  noOpMovesCount = 0;
  byDirection.up = 0;
  byDirection.down = 0;
  byDirection.left = 0;
  byDirection.right = 0;
  fastVerticalPathHits = 0;
  fastHorizontalPathHits = 0;
  globalFallbackMovesCount = 0;

  flushSyncCount = 0;
  flushSyncTotalMs = 0;
  flushSyncMaxMs = 0;

  geometryMeasureCount = 0;
  geometryBeforeVirtualTotalMs = 0;
  geometryAfterVirtualTotalMs = 0;
  geometryMaxMs = 0;

  rowsMountedDuringNav = 0;
  rowsUnmountedDuringNav = 0;
  cardsMountedDuringNav = 0;
  cardsUnmountedDuringNav = 0;

  sampledFramesDuringNav = 0;
  frameIntervalsOver34MsCount = 0;
  frameIntervalsOver50MsCount = 0;
  maxFrameIntervalMs = 0;

  longTasksCount = 0;
  longTasksTotalMs = 0;
  longTasksMaxMs = 0;

  imageRequestsStartedDuringNav = 0;
  imageRequestsCompletedDuringNav = 0;
  imgOnLoadEventsDuringNav = 0;
  categorySortsExecutedDuringNav = 0;
  categorySortDurationDuringNavMs = 0;

  diagnosticsSelfOverheadTotalMs = 0;
  diagnosticsSelfOverheadMaxMs = 0;
  lastDpadCommandTimestampMs = -Infinity;

  if (options?.enabled !== undefined) {
    isFluidityDiagnosticsEnabled = Boolean(options.enabled);
    safeSetStorage(
      DPAD_FLUIDITY_DIAGNOSTICS_ENABLED_KEY,
      isFluidityDiagnosticsEnabled ? 'true' : 'false'
    );
  }
  if (options?.clearExplicitMode) {
    behaviorModeExplicitlySet = false;
    currentBehaviorMode = isAndroidCapacitorRuntime() ? 'optimized' : 'current';
  } else if (options?.behaviorMode !== undefined) {
    currentBehaviorMode = options.behaviorMode;
    behaviorModeExplicitlySet = true;
    safeSetStorage(DPAD_NAVIGATION_BEHAVIOR_MODE_KEY, options.behaviorMode);
  }
  ensureLongTaskObserverState();
  notifyListeners();
}

export function recordDpadKeydownReceived(params: {
  direction: 'up' | 'down' | 'left' | 'right';
  isRepeat: boolean;
  coalesced?: boolean;
}): number {
  const stamp = nowMs();
  lastDpadCommandTimestampMs = stamp;
  if (!isFluidityDiagnosticsEnabled) {
    return stamp;
  }
  const t0 = stamp;
  totalEventsReceived++;
  if (params.isRepeat) {
    repeatPressEventsCount++;
  } else {
    singlePressEventsCount++;
  }
  if (params.coalesced) {
    coalescedRepeatEventsCount++;
  }
  byDirection[params.direction]++;
  if (pendingFirstFrameCommandStartMs === null && !params.coalesced) {
    pendingFirstFrameCommandStartMs = stamp;
  }
  scheduleFrameMonitorTick();
  recordSelfOverhead(t0);
  return stamp;
}

export function recordDpadMoveResolution(params: {
  commandStartMs: number;
  moved: boolean;
  resolutionPath: 'fast-vertical' | 'fast-horizontal' | 'global-fallback' | 'none';
  focusUpdatedAtMs?: number;
}): void {
  if (!isFluidityDiagnosticsEnabled) return;
  const t0 = nowMs();
  const totalElapsed = Math.max(0, t0 - params.commandStartMs);
  pushLatencySample(commandProcessSamples, totalElapsed);

  if (params.moved) {
    completedMovesCount++;
    const focusStamp = params.focusUpdatedAtMs ?? t0;
    pushLatencySample(focusUpdateSamples, Math.max(0, focusStamp - params.commandStartMs));
    if (params.resolutionPath === 'fast-vertical') {
      fastVerticalPathHits++;
    } else if (params.resolutionPath === 'fast-horizontal') {
      fastHorizontalPathHits++;
    } else if (params.resolutionPath === 'global-fallback') {
      globalFallbackMovesCount++;
    }
  } else {
    noOpMovesCount++;
  }
  recordSelfOverhead(t0);
}

export function recordDpadFlushSyncExecution(durationMs: number): void {
  if (!isFluidityDiagnosticsEnabled) return;
  const t0 = nowMs();
  const d = roundMs(durationMs);
  flushSyncCount++;
  flushSyncTotalMs = roundMs(flushSyncTotalMs + d);
  if (d > flushSyncMaxMs) {
    flushSyncMaxMs = d;
  }
  recordSelfOverhead(t0);
}

export function recordDpadGeometryMeasurement(
  phase: 'before-virtual' | 'after-virtual',
  durationMs: number
): void {
  if (!isFluidityDiagnosticsEnabled) return;
  const t0 = nowMs();
  const d = roundMs(durationMs);
  geometryMeasureCount++;
  if (phase === 'before-virtual') {
    geometryBeforeVirtualTotalMs = roundMs(geometryBeforeVirtualTotalMs + d);
  } else {
    geometryAfterVirtualTotalMs = roundMs(geometryAfterVirtualTotalMs + d);
  }
  if (d > geometryMaxMs) {
    geometryMaxMs = d;
  }
  recordSelfOverhead(t0);
}

export function recordDpadVirtualMountDelta(params: {
  rowsMounted?: number;
  rowsUnmounted?: number;
  cardsMounted?: number;
  cardsUnmounted?: number;
}): void {
  if (!isFluidityDiagnosticsEnabled) return;
  const t0 = nowMs();
  if (t0 - lastDpadCommandTimestampMs <= ACTIVE_NAV_WINDOW_MS) {
    if (params.rowsMounted && params.rowsMounted > 0) {
      rowsMountedDuringNav += params.rowsMounted;
    }
    if (params.rowsUnmounted && params.rowsUnmounted > 0) {
      rowsUnmountedDuringNav += params.rowsUnmounted;
    }
    if (params.cardsMounted && params.cardsMounted > 0) {
      cardsMountedDuringNav += params.cardsMounted;
    }
    if (params.cardsUnmounted && params.cardsUnmounted > 0) {
      cardsUnmountedDuringNav += params.cardsUnmounted;
    }
  }
  recordSelfOverhead(t0);
}

export function recordDpadNavImageActivity(
  kind: 'request-start' | 'request-complete' | 'img-onload'
): void {
  if (!isFluidityDiagnosticsEnabled) return;
  const t0 = nowMs();
  if (t0 - lastDpadCommandTimestampMs <= ACTIVE_NAV_WINDOW_MS) {
    if (kind === 'request-start') {
      imageRequestsStartedDuringNav++;
    } else if (kind === 'request-complete') {
      imageRequestsCompletedDuringNav++;
    } else if (kind === 'img-onload') {
      imgOnLoadEventsDuringNav++;
    }
  }
  recordSelfOverhead(t0);
}

export function recordDpadNavCategorySortActivity(durationMs: number): void {
  if (!isFluidityDiagnosticsEnabled) return;
  const t0 = nowMs();
  if (t0 - lastDpadCommandTimestampMs <= ACTIVE_NAV_WINDOW_MS) {
    categorySortsExecutedDuringNav++;
    categorySortDurationDuringNavMs = roundMs(categorySortDurationDuringNavMs + durationMs);
  }
  recordSelfOverhead(t0);
}

export function getDpadFluidityDiagnosticsSnapshot(): DpadFluidityDiagnosticsSnapshot {
  const mode = getDpadNavigationBehaviorMode();
  return {
    enabled: isFluidityDiagnosticsEnabled,
    behaviorMode: mode,
    effectiveOptimizedActive: mode === 'optimized',
    totalEventsReceived,
    singlePressEventsCount,
    repeatPressEventsCount,
    coalescedRepeatEventsCount,
    completedMovesCount,
    noOpMovesCount,
    byDirection: { ...byDirection },
    fastVerticalPathHits,
    fastHorizontalPathHits,
    globalFallbackMovesCount,
    commandProcessLatency: summarizeLatencyRingBuffer(commandProcessSamples),
    focusUpdateLatency: summarizeLatencyRingBuffer(focusUpdateSamples),
    firstFrameAfterCommandLatency: summarizeLatencyRingBuffer(firstFrameSamples),
    flushSyncCount,
    flushSyncTotalMs,
    flushSyncMaxMs,
    geometryMeasureCount,
    geometryBeforeVirtualTotalMs,
    geometryAfterVirtualTotalMs,
    geometryMaxMs,
    rowsMountedDuringNav,
    rowsUnmountedDuringNav,
    cardsMountedDuringNav,
    cardsUnmountedDuringNav,
    sampledFramesDuringNav,
    frameIntervalsOver34MsCount,
    frameIntervalsOver50MsCount,
    maxFrameIntervalMs,
    longTasksSupported,
    longTasksCount,
    longTasksTotalMs,
    longTasksMaxMs,
    imageRequestsStartedDuringNav,
    imageRequestsCompletedDuringNav,
    imgOnLoadEventsDuringNav,
    categorySortsExecutedDuringNav,
    categorySortDurationDuringNavMs,
    diagnosticsSelfOverheadTotalMs,
    diagnosticsSelfOverheadMaxMs,
  };
}

export function subscribeDpadFluidityDiagnostics(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function fmtLat(val: number | null): string {
  if (val === null || !Number.isFinite(val)) return 'n/a';
  return `${val.toFixed(2)} ms`;
}

export function formatDpadFluidityDiagnosticsReport(
  snap: DpadFluidityDiagnosticsSnapshot = getDpadFluidityDiagnosticsSnapshot()
): string {
  const modeLabel =
    snap.behaviorMode === 'optimized'
      ? 'Comportamento otimizado (redução de layout síncrono / janela 2-fileiras)'
      : 'Comportamento atual (referência de linha de base)';

  const lines: string[] = [
    `[Diagnóstico de Fluidez do D-Pad (Etapa 3)]`,
    `• Modo de navegação D-Pad selecionado: ${modeLabel}`,
    `• Coleta de fluidez do D-Pad: ${snap.enabled ? 'Ativada' : 'Desativada (padrão)'}`,
  ];

  if (!snap.enabled) {
    lines.push(
      `• Status: Coleta de fluidez desativada por padrão para custo zero em uso normal. Ative em Configurações → Arquitetura & Diagnóstico para medir a navegação.`
    );
    return lines.join('\n');
  }

  lines.push(
    `• Eventos D-Pad recebidos: total=${snap.totalEventsReceived} (únicos=${snap.singlePressEventsCount}, repetição/key-repeat=${snap.repeatPressEventsCount}, repetições coalescidas=${snap.coalescedRepeatEventsCount})`
  );
  lines.push(
    `• Direções: cima=${snap.byDirection.up} | baixo=${snap.byDirection.down} | esquerda=${snap.byDirection.left} | direita=${snap.byDirection.right}`
  );
  lines.push(
    `• Resolução de movimentos: concluídos=${snap.completedMovesCount} (caminho rápido vertical=${snap.fastVerticalPathHits}, caminho rápido horizontal=${snap.fastHorizontalPathHits}, fallback global=${snap.globalFallbackMovesCount}) | sem movimento=${snap.noOpMovesCount}`
  );
  lines.push(
    `• Latência processamento do comando (amostras=${snap.commandProcessLatency.sampleCount}): mediana=${fmtLat(
      snap.commandProcessLatency.medianMs
    )} | P95=${fmtLat(snap.commandProcessLatency.p95Ms)} | P99=${fmtLat(
      snap.commandProcessLatency.p99Ms
    )} | máx=${fmtLat(snap.commandProcessLatency.maxMs)}`
  );
  lines.push(
    `• Latência até atualização efetiva do foco (amostras=${snap.focusUpdateLatency.sampleCount}): mediana=${fmtLat(
      snap.focusUpdateLatency.medianMs
    )} | P95=${fmtLat(snap.focusUpdateLatency.p95Ms)} | P99=${fmtLat(
      snap.focusUpdateLatency.p99Ms
    )} | máx=${fmtLat(snap.focusUpdateLatency.maxMs)}`
  );
  lines.push(
    `• Latência até próximo quadro requestAnimationFrame (amostras=${snap.firstFrameAfterCommandLatency.sampleCount}; limitação: mede agendamento de quadro da WebView, não scanout HDMI físico): mediana=${fmtLat(
      snap.firstFrameAfterCommandLatency.medianMs
    )} | P95=${fmtLat(snap.firstFrameAfterCommandLatency.p95Ms)} | P99=${fmtLat(
      snap.firstFrameAfterCommandLatency.p99Ms
    )} | máx=${fmtLat(snap.firstFrameAfterCommandLatency.maxMs)}`
  );
  lines.push(
    `• Virtualização e flushSync: execuções=${snap.flushSyncCount} | tempo total=${snap.flushSyncTotalMs.toFixed(
      2
    )} ms | máx=${snap.flushSyncMaxMs.toFixed(2)} ms`
  );
  lines.push(
    `• Medição de geometria DOM: chamadas=${snap.geometryMeasureCount} | antes da virtualização=${snap.geometryBeforeVirtualTotalMs.toFixed(
      2
    )} ms | após virtualização=${snap.geometryAfterVirtualTotalMs.toFixed(
      2
    )} ms | máx=${snap.geometryMaxMs.toFixed(2)} ms`
  );
  lines.push(
    `• Montagem/desmontagem durante navegação: fileiras (+${snap.rowsMountedDuringNav} / -${snap.rowsUnmountedDuringNav}) | cartões (+${snap.cardsMountedDuringNav} / -${snap.cardsUnmountedDuringNav})`
  );
  lines.push(
    `• Intervalos entre quadros na navegação (quadros amostrados=${snap.sampledFramesDuringNav}): >34ms=${snap.frameIntervalsOver34MsCount} | >50ms=${snap.frameIntervalsOver50MsCount} | intervalo máx=${snap.maxFrameIntervalMs.toFixed(
      2
    )} ms`
  );
  lines.push(
    `• Long Tasks (PerformanceObserver): ${
      snap.longTasksSupported
        ? `suportado | quantidade=${snap.longTasksCount} | total=${snap.longTasksTotalMs.toFixed(
            2
          )} ms | máx=${snap.longTasksMaxMs.toFixed(2)} ms`
        : 'não suportado pela WebView/ambiente atual'
    }`
  );
  lines.push(
    `• Trabalho paralelo durante navegação ativa: requisições de imagem iniciadas=${snap.imageRequestsStartedDuringNav} | concluídas=${snap.imageRequestsCompletedDuringNav} | <img onLoad>=${snap.imgOnLoadEventsDuringNav} | ordenações de categoria=${snap.categorySortsExecutedDuringNav} (${snap.categorySortDurationDuringNavMs.toFixed(
      2
    )} ms)`
  );
  lines.push(
    `• Custo próprio do diagnóstico de fluidez: acumulado=${snap.diagnosticsSelfOverheadTotalMs.toFixed(
      2
    )} ms | máx por evento=${snap.diagnosticsSelfOverheadMaxMs.toFixed(2)} ms`
  );

  return lines.join('\n');
}
