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
