import { useEffect, useState, useCallback } from 'react';

export type DisplayMode = 'tv' | 'default';

export const STORAGE_KEY_DISPLAY_PREFS = 'northcode_display_preferences_v1';
const LEGACY_KEY_DISPLAY_MODE = 'northcode_display_mode_pref';
const LEGACY_KEY_TV_DENSITY = 'northcode_tv_density_pref';

export const TV_SCALE_MIN = 50;
export const TV_SCALE_MAX = 125;
export const TV_SCALE_STEP = 5;
export const TV_SCALE_DEFAULT = 85;

export interface StoredDisplayPreferences {
  version: 1;
  mode: DisplayMode;
  tvScale: number;
  configured: true;
}

export interface DisplayPreferencesSnapshot {
  mode: DisplayMode;
  tvScale: number;
  effectiveMode: DisplayMode;
  effectiveTvScale: number;
  uiScaleFactor: number;
  isConfigured: boolean;
  isPreviewActive: boolean;
}

let confirmedMode: DisplayMode = 'default';
let confirmedTvScale: number = TV_SCALE_DEFAULT;
let isConfiguredState = false;
let previewState: { mode: DisplayMode; tvScale: number; sessionId: string } | null = null;
let previewSessionCounter = 0;
let initializedFromStorage = false;
let lastLoadedRawPrefs: string | null = null;
let cachedBaseRootFontSizePx: number | null = null;

const DEFAULT_BASE_ROOT_FONT_SIZE_PX = 16;

const listeners = new Set<() => void>();

export function createDisplayPreviewSession(): string {
  previewSessionCounter += 1;
  return `nc_display_preview_${previewSessionCounter}`;
}

export function clampTvScale(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return TV_SCALE_DEFAULT;
  }
  const stepped = Math.round(value / TV_SCALE_STEP) * TV_SCALE_STEP;
  return Math.max(TV_SCALE_MIN, Math.min(TV_SCALE_MAX, stepped));
}

function resolveBaseRootFontSizePx(docEl: HTMLElement): number {
  if (cachedBaseRootFontSizePx !== null && cachedBaseRootFontSizePx > 0) {
    return cachedBaseRootFontSizePx;
  }
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
    return DEFAULT_BASE_ROOT_FONT_SIZE_PX;
  }

  const prevMode = docEl.getAttribute('data-display-mode');
  const prevInlineFontSize = docEl.style.fontSize;
  try {
    if (prevMode === 'tv' || prevInlineFontSize) {
      docEl.removeAttribute('data-display-mode');
      docEl.style.removeProperty('font-size');
    }
    const computed = window.getComputedStyle(docEl).fontSize;
    const parsed = parseFloat(computed || '');
    if (Number.isFinite(parsed) && parsed > 0) {
      cachedBaseRootFontSizePx = Number(parsed.toFixed(2));
      return cachedBaseRootFontSizePx;
    }
  } catch {
    // Fallback to standard 16px
  } finally {
    if (prevMode !== null) {
      docEl.setAttribute('data-display-mode', prevMode);
    }
    if (prevInlineFontSize) {
      docEl.style.fontSize = prevInlineFontSize;
    }
  }

  cachedBaseRootFontSizePx = DEFAULT_BASE_ROOT_FONT_SIZE_PX;
  return cachedBaseRootFontSizePx;
}

function isValidStoredDisplayPreferences(raw: unknown): raw is StoredDisplayPreferences {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) return false;
  if (obj.configured !== true) return false;
  if (obj.mode !== 'tv' && obj.mode !== 'default') return false;
  if (
    typeof obj.tvScale !== 'number' ||
    !Number.isFinite(obj.tvScale) ||
    obj.tvScale < TV_SCALE_MIN ||
    obj.tvScale > TV_SCALE_MAX
  ) {
    return false;
  }
  return true;
}

function loadFromStorageIfNeeded(): void {
  if (typeof window === 'undefined') return;

  let currentRaw: string | null = null;
  try {
    currentRaw = window.localStorage.getItem(STORAGE_KEY_DISPLAY_PREFS);
  } catch {
    if (!initializedFromStorage) {
      initializedFromStorage = true;
    }
    return;
  }

  if (initializedFromStorage && currentRaw === lastLoadedRawPrefs) {
    return;
  }

  initializedFromStorage = true;
  lastLoadedRawPrefs = currentRaw;

  if (!currentRaw) {
    confirmedMode = 'default';
    confirmedTvScale = TV_SCALE_DEFAULT;
    isConfiguredState = false;
    return;
  }

  try {
    const parsed = JSON.parse(currentRaw);
    if (isValidStoredDisplayPreferences(parsed)) {
      confirmedMode = parsed.mode;
      confirmedTvScale = clampTvScale(parsed.tvScale);
      isConfiguredState = true;
      return;
    }
  } catch {
    // Malformed JSON falls back to unconfigured default
  }

  confirmedMode = 'default';
  confirmedTvScale = TV_SCALE_DEFAULT;
  isConfiguredState = false;
}

export function getDisplayPreferencesSnapshot(): DisplayPreferencesSnapshot {
  loadFromStorageIfNeeded();
  const effectiveMode: DisplayMode = previewState
    ? previewState.mode
    : isConfiguredState
    ? confirmedMode
    : 'default';
  const effectiveTvScale: number = previewState
    ? previewState.tvScale
    : confirmedTvScale;
  const uiScaleFactor =
    effectiveMode === 'tv' ? Number((effectiveTvScale / 100).toFixed(2)) : 1;

  return {
    mode: confirmedMode,
    tvScale: confirmedTvScale,
    effectiveMode,
    effectiveTvScale,
    uiScaleFactor,
    isConfigured: isConfiguredState,
    isPreviewActive: previewState !== null,
  };
}

export function syncDocumentDisplayAttributes(): boolean {
  if (typeof document === 'undefined' || !document.documentElement) return false;
  const snap = getDisplayPreferencesSnapshot();
  const docEl = document.documentElement;
  const baseFontPx = resolveBaseRootFontSizePx(docEl);
  let changed = false;

  if (docEl.getAttribute('data-display-mode') !== snap.effectiveMode) {
    docEl.setAttribute('data-display-mode', snap.effectiveMode);
    changed = true;
  }

  const targetScaleStr = String(snap.uiScaleFactor);
  if (docEl.style.getPropertyValue('--nc-ui-scale') !== targetScaleStr) {
    docEl.style.setProperty('--nc-ui-scale', targetScaleStr);
    changed = true;
  }

  if (snap.effectiveMode === 'tv') {
    const targetPctStr = `${snap.effectiveTvScale}%`;
    if (docEl.style.getPropertyValue('--nc-ui-scale-pct') !== targetPctStr) {
      docEl.style.setProperty('--nc-ui-scale-pct', targetPctStr);
      changed = true;
    }

    const expectedFontPx = Number((baseFontPx * snap.uiScaleFactor).toFixed(2));
    const targetFontSizeStr = `${expectedFontPx}px`;
    if (docEl.style.fontSize !== targetFontSizeStr) {
      docEl.style.fontSize = targetFontSizeStr;
      changed = true;
    }

    // Check if WebView clamped root font-size (e.g. WebSettings.setMinimumFontSize)
    let remCompensation = 1;
    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
      try {
        const computedFontPx = parseFloat(window.getComputedStyle(docEl).fontSize || '');
        if (
          Number.isFinite(computedFontPx) &&
          computedFontPx > 0 &&
          Math.abs(computedFontPx - expectedFontPx) > 0.25
        ) {
          remCompensation = Number((expectedFontPx / computedFontPx).toFixed(4));
        }
      } catch {
        remCompensation = 1;
      }
    }
    const targetCompStr = String(remCompensation);
    if (docEl.style.getPropertyValue('--nc-rem-compensation') !== targetCompStr) {
      docEl.style.setProperty('--nc-rem-compensation', targetCompStr);
      changed = true;
    }
  } else {
    if (docEl.style.getPropertyValue('--nc-ui-scale-pct') !== '') {
      docEl.style.removeProperty('--nc-ui-scale-pct');
      changed = true;
    }
    if (docEl.style.getPropertyValue('--nc-rem-compensation') !== '') {
      docEl.style.removeProperty('--nc-rem-compensation');
      changed = true;
    }
    if (docEl.style.fontSize !== '') {
      docEl.style.removeProperty('font-size');
      changed = true;
    }
  }

  if (docEl.hasAttribute('data-tv-density')) {
    docEl.removeAttribute('data-tv-density');
    changed = true;
  }
  if (docEl.hasAttribute('data-display-origin')) {
    docEl.removeAttribute('data-display-origin');
    changed = true;
  }

  return changed;
}

export interface DisplayEnvironmentDiagnostics {
  requested: {
    confirmedMode: DisplayMode;
    confirmedTvScale: number;
    effectiveMode: DisplayMode;
    effectiveTvScale: number;
    uiScaleFactor: number;
    isConfigured: boolean;
    isPreviewActive: boolean;
    baseRootFontSizePx: number;
    expectedRootFontSizePx: number;
    expectedProbeWidthPx: number;
    expectedProbeHeightPx: number;
  };
  measured: {
    domDisplayModeAttr: string | null;
    domUiScaleVar: string | null;
    computedUiScaleVar: string | null;
    domRemCompensationVar: string | null;
    inlineRootFontSize: string | null;
    computedRootFontSize: string | null;
    computedRootFontSizePx: number | null;
    probeWidthPx: number | null;
    probeHeightPx: number | null;
    compensatedProbeWidthPx: number | null;
    compensatedProbeHeightPx: number | null;
    effectiveMeasuredScalePct: number | null;
  };
  viewport: {
    innerWidth: number | null;
    innerHeight: number | null;
    clientWidth: number | null;
    clientHeight: number | null;
    devicePixelRatio: number | null;
    vvWidth: number | null;
    vvHeight: number | null;
    vvScale: number | null;
  };
  environment: {
    userAgent: string;
    platform: string;
  };
}

export function readDisplayEnvironmentDiagnostics(
  probeEl?: HTMLElement | null,
  compensatedProbeEl?: HTMLElement | null
): DisplayEnvironmentDiagnostics {
  const snap = getDisplayPreferencesSnapshot();
  const hasDoc = typeof document !== 'undefined' && Boolean(document.documentElement);
  const docEl = hasDoc ? document.documentElement : null;
  const baseRootFontSizePx = docEl
    ? resolveBaseRootFontSizePx(docEl)
    : DEFAULT_BASE_ROOT_FONT_SIZE_PX;

  const expectedRootFontSizePx = Number(
    (baseRootFontSizePx * snap.uiScaleFactor).toFixed(2)
  );
  // Probe sample is 10rem wide x 2rem tall
  const expectedProbeWidthPx = Number((expectedRootFontSizePx * 10).toFixed(2));
  const expectedProbeHeightPx = Number((expectedRootFontSizePx * 2).toFixed(2));

  let domDisplayModeAttr: string | null = null;
  let domUiScaleVar: string | null = null;
  let computedUiScaleVar: string | null = null;
  let domRemCompensationVar: string | null = null;
  let inlineRootFontSize: string | null = null;
  let computedRootFontSize: string | null = null;
  let computedRootFontSizePx: number | null = null;

  if (docEl) {
    domDisplayModeAttr = docEl.getAttribute('data-display-mode');
    const inlineScale = docEl.style.getPropertyValue('--nc-ui-scale').trim();
    domUiScaleVar = inlineScale || null;
    const inlineComp = docEl.style.getPropertyValue('--nc-rem-compensation').trim();
    domRemCompensationVar = inlineComp || null;
    inlineRootFontSize = docEl.style.fontSize ? docEl.style.fontSize.trim() : null;

    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
      try {
        const cs = window.getComputedStyle(docEl);
        const rawFs = cs.fontSize ? cs.fontSize.trim() : '';
        if (rawFs) {
          computedRootFontSize = rawFs;
          const parsedFs = parseFloat(rawFs);
          if (Number.isFinite(parsedFs) && parsedFs > 0) {
            computedRootFontSizePx = Number(parsedFs.toFixed(2));
          }
        }
        const csScale = cs.getPropertyValue('--nc-ui-scale').trim();
        if (csScale) {
          computedUiScaleVar = csScale;
        }
      } catch {
        // Ignore computed style errors
      }
    }
  }

  let probeWidthPx: number | null = null;
  let probeHeightPx: number | null = null;
  if (probeEl && typeof probeEl.getBoundingClientRect === 'function') {
    try {
      const rect = probeEl.getBoundingClientRect();
      if (
        rect &&
        Number.isFinite(rect.width) &&
        Number.isFinite(rect.height) &&
        rect.width > 0 &&
        rect.height > 0
      ) {
        probeWidthPx = Number(rect.width.toFixed(2));
        probeHeightPx = Number(rect.height.toFixed(2));
      }
    } catch {
      // Ignore rect errors
    }
  }

  let compensatedProbeWidthPx: number | null = null;
  let compensatedProbeHeightPx: number | null = null;
  if (compensatedProbeEl && typeof compensatedProbeEl.getBoundingClientRect === 'function') {
    try {
      const cRect = compensatedProbeEl.getBoundingClientRect();
      if (
        cRect &&
        Number.isFinite(cRect.width) &&
        Number.isFinite(cRect.height) &&
        cRect.width > 0 &&
        cRect.height > 0
      ) {
        compensatedProbeWidthPx = Number(cRect.width.toFixed(2));
        compensatedProbeHeightPx = Number(cRect.height.toFixed(2));
      }
    } catch {
      // Ignore rect errors
    }
  }

  let effectiveMeasuredScalePct: number | null = null;
  if (probeWidthPx !== null && baseRootFontSizePx > 0) {
    const singleRemMeasured = probeWidthPx / 10;
    effectiveMeasuredScalePct = Math.round(
      (singleRemMeasured / baseRootFontSizePx) * 100
    );
  } else if (computedRootFontSizePx !== null && baseRootFontSizePx > 0) {
    effectiveMeasuredScalePct = Math.round(
      (computedRootFontSizePx / baseRootFontSizePx) * 100
    );
  }

  let innerWidth: number | null = null;
  let innerHeight: number | null = null;
  let clientWidth: number | null = null;
  let clientHeight: number | null = null;
  let devicePixelRatio: number | null = null;
  let vvWidth: number | null = null;
  let vvHeight: number | null = null;
  let vvScale: number | null = null;

  if (typeof window !== 'undefined') {
    if (Number.isFinite(window.innerWidth) && window.innerWidth > 0) {
      innerWidth = Math.round(window.innerWidth);
    }
    if (Number.isFinite(window.innerHeight) && window.innerHeight > 0) {
      innerHeight = Math.round(window.innerHeight);
    }
    if (docEl && Number.isFinite(docEl.clientWidth) && docEl.clientWidth > 0) {
      clientWidth = Math.round(docEl.clientWidth);
    }
    if (docEl && Number.isFinite(docEl.clientHeight) && docEl.clientHeight > 0) {
      clientHeight = Math.round(docEl.clientHeight);
    }
    if (Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0) {
      devicePixelRatio = Number(window.devicePixelRatio.toFixed(2));
    }
    const vv = window.visualViewport;
    if (vv) {
      if (Number.isFinite(vv.width) && vv.width > 0) vvWidth = Math.round(vv.width);
      if (Number.isFinite(vv.height) && vv.height > 0) vvHeight = Math.round(vv.height);
      if (Number.isFinite(vv.scale) && vv.scale > 0) {
        vvScale = Number(vv.scale.toFixed(2));
      }
    }
  }

  const userAgent =
    typeof navigator !== 'undefined' && navigator.userAgent
      ? navigator.userAgent
      : 'indisponível';
  const platform =
    typeof navigator !== 'undefined' && navigator.platform
      ? navigator.platform
      : 'indisponível';

  return {
    requested: {
      confirmedMode: snap.mode,
      confirmedTvScale: snap.tvScale,
      effectiveMode: snap.effectiveMode,
      effectiveTvScale: snap.effectiveTvScale,
      uiScaleFactor: snap.uiScaleFactor,
      isConfigured: snap.isConfigured,
      isPreviewActive: snap.isPreviewActive,
      baseRootFontSizePx,
      expectedRootFontSizePx,
      expectedProbeWidthPx,
      expectedProbeHeightPx,
    },
    measured: {
      domDisplayModeAttr,
      domUiScaleVar,
      computedUiScaleVar,
      domRemCompensationVar,
      inlineRootFontSize,
      computedRootFontSize,
      computedRootFontSizePx,
      probeWidthPx,
      probeHeightPx,
      compensatedProbeWidthPx,
      compensatedProbeHeightPx,
      effectiveMeasuredScalePct,
    },
    viewport: {
      innerWidth,
      innerHeight,
      clientWidth,
      clientHeight,
      devicePixelRatio,
      vvWidth,
      vvHeight,
      vvScale,
    },
    environment: {
      userAgent,
      platform,
    },
  };
}

function notifyListeners(): void {
  syncDocumentDisplayAttributes();
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // Ignore subscriber errors
    }
  });
}

export function startDisplayPreview(
  mode: DisplayMode,
  tvScale?: number,
  sessionId: string = 'default_session'
): void {
  loadFromStorageIfNeeded();
  const nextScale = clampTvScale(
    tvScale ?? (previewState ? previewState.tvScale : confirmedTvScale)
  );
  previewState = { mode, tvScale: nextScale, sessionId };
  notifyListeners();
}

export function cancelDisplayPreview(sessionId?: string): void {
  loadFromStorageIfNeeded();
  if (previewState !== null) {
    if (sessionId !== undefined && previewState.sessionId !== sessionId) {
      return;
    }
    previewState = null;
    notifyListeners();
  } else {
    syncDocumentDisplayAttributes();
  }
}

export function confirmDisplayPreferences(
  mode: DisplayMode,
  tvScale?: number,
  sessionId?: string
): boolean {
  loadFromStorageIfNeeded();
  const nextScale = clampTvScale(
    tvScale ?? (previewState ? previewState.tvScale : confirmedTvScale)
  );
  confirmedMode = mode;
  confirmedTvScale = nextScale;
  isConfiguredState = true;
  if (sessionId === undefined || previewState === null || previewState.sessionId === sessionId) {
    previewState = null;
  }

  const payload: StoredDisplayPreferences = {
    version: 1,
    mode: confirmedMode,
    tvScale: confirmedTvScale,
    configured: true,
  };

  let persisted = false;
  if (typeof window !== 'undefined') {
    try {
      const serialized = JSON.stringify(payload);
      window.localStorage.setItem(STORAGE_KEY_DISPLAY_PREFS, serialized);
      lastLoadedRawPrefs = serialized;
      persisted = true;
    } catch {
      // Keep in-memory state if localStorage is blocked or full
      initializedFromStorage = true;
      try {
        lastLoadedRawPrefs = window.localStorage.getItem(STORAGE_KEY_DISPLAY_PREFS);
      } catch {
        // Ignore read error when storage is unavailable
      }
    }

    if (persisted) {
      try {
        window.localStorage.removeItem(LEGACY_KEY_DISPLAY_MODE);
        window.localStorage.removeItem(LEGACY_KEY_TV_DENSITY);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  notifyListeners();
  return persisted;
}

export function subscribeDisplayPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export interface UseDisplayPreferencesResult extends DisplayPreferencesSnapshot {
  startPreview: (mode: DisplayMode, tvScale?: number, sessionId?: string) => void;
  cancelPreview: (sessionId?: string) => void;
  confirmPreferences: (mode: DisplayMode, tvScale?: number, sessionId?: string) => boolean;
}

export function useDisplayPreferences(): UseDisplayPreferencesResult {
  const [state, setState] = useState<DisplayPreferencesSnapshot>(() =>
    getDisplayPreferencesSnapshot()
  );

  const refreshState = useCallback(() => {
    const next = getDisplayPreferencesSnapshot();
    setState((prev) => {
      if (
        prev.mode === next.mode &&
        prev.tvScale === next.tvScale &&
        prev.effectiveMode === next.effectiveMode &&
        prev.effectiveTvScale === next.effectiveTvScale &&
        prev.uiScaleFactor === next.uiScaleFactor &&
        prev.isConfigured === next.isConfigured &&
        prev.isPreviewActive === next.isPreviewActive
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    syncDocumentDisplayAttributes();
    refreshState();
    return subscribeDisplayPreferences(refreshState);
  }, [refreshState]);

  return {
    ...state,
    startPreview: startDisplayPreview,
    cancelPreview: cancelDisplayPreview,
    confirmPreferences: confirmDisplayPreferences,
  };
}
