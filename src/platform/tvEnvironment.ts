import { useEffect, useState, useCallback } from 'react';

export type DisplayModePreference = 'auto' | 'tv' | 'default';
export type EffectiveDisplayMode = 'tv' | 'default';
export type TvDensityPreference = 'compact' | 'normal' | 'comfortable';

const STORAGE_KEY_DISPLAY_MODE = 'northcode_display_mode_pref';
const STORAGE_KEY_TV_DENSITY = 'northcode_tv_density_pref';

let memoryDisplayModePref: DisplayModePreference = 'auto';
let memoryTvDensityPref: TvDensityPreference = 'normal';
let initializedFromStorage = false;

const listeners = new Set<() => void>();

/**
 * Safely queries window.WebToApk.isTv() when running inside the WebToApk Android wrapper.
 * Never infers TV mode from keyboard navigation, screen width, or orientation.
 */
export function detectWebToApkIsTv(): { detected: boolean; available: boolean } {
  if (typeof window === 'undefined') {
    return { detected: false, available: false };
  }
  try {
    const w = window as any;
    if (w.WebToApk && typeof w.WebToApk.isTv === 'function') {
      const res = w.WebToApk.isTv();
      return { detected: res === true, available: true };
    }
  } catch {
    // Ignore runtime bridge errors in non-APK browsers
  }
  return { detected: false, available: false };
}

export function isNativeTvEnvironment(): boolean {
  return detectWebToApkIsTv().detected;
}

export function isNativePackagedEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const w = window as any;
    if (w.AppMint && typeof w.AppMint.setBackHandler === 'function') return true;
    if (w.WebToApk && typeof w.WebToApk.isTv === 'function') return true;
    if (w.Capacitor) return true;
  } catch {
    // Ignore
  }
  return false;
}

function ensureLoadedFromStorage(): void {
  if (initializedFromStorage || typeof window === 'undefined') return;
  initializedFromStorage = true;

  try {
    const rawMode = window.localStorage.getItem(STORAGE_KEY_DISPLAY_MODE);
    if (rawMode === 'auto' || rawMode === 'tv' || rawMode === 'default') {
      memoryDisplayModePref = rawMode;
    }
  } catch {
    // Storage unavailable or blocked; keep memory default
  }

  try {
    const rawDensity = window.localStorage.getItem(STORAGE_KEY_TV_DENSITY);
    if (rawDensity === 'compact' || rawDensity === 'normal' || rawDensity === 'comfortable') {
      memoryTvDensityPref = rawDensity;
    }
  } catch {
    // Storage unavailable or blocked; keep memory default
  }
}

export function getDisplayModePreference(): DisplayModePreference {
  ensureLoadedFromStorage();
  return memoryDisplayModePref;
}

export function getTvDensityPreference(): TvDensityPreference {
  ensureLoadedFromStorage();
  return memoryTvDensityPref;
}

export function getEffectiveDisplayMode(
  pref: DisplayModePreference = getDisplayModePreference()
): EffectiveDisplayMode {
  if (pref === 'tv') return 'tv';
  if (pref === 'default') return 'default';
  return isNativeTvEnvironment() ? 'tv' : 'default';
}

export function syncDocumentDisplayAttributes(): boolean {
  if (typeof document === 'undefined' || !document.documentElement) return false;
  const pref = getDisplayModePreference();
  const effective = getEffectiveDisplayMode(pref);
  const density = getTvDensityPreference();
  const origin = pref === 'auto' ? 'auto' : 'manual';

  const docEl = document.documentElement;
  let changed = false;

  if (docEl.getAttribute('data-display-mode') !== effective) {
    docEl.setAttribute('data-display-mode', effective);
    changed = true;
  }
  if (docEl.getAttribute('data-tv-density') !== density) {
    docEl.setAttribute('data-tv-density', density);
    changed = true;
  }
  if (docEl.getAttribute('data-display-origin') !== origin) {
    docEl.setAttribute('data-display-origin', origin);
    changed = true;
  }

  return changed;
}

interface InternalSnapshot {
  modePreference: DisplayModePreference;
  effectiveMode: EffectiveDisplayMode;
  origin: 'auto' | 'manual';
  density: TvDensityPreference;
  webToApkAvailable: boolean;
  webToApkDetected: boolean;
}

let lastSnapshot: InternalSnapshot | null = null;

function readInternalSnapshot(): InternalSnapshot {
  const modePreference = getDisplayModePreference();
  const webToApk = detectWebToApkIsTv();
  const effectiveMode: EffectiveDisplayMode =
    modePreference === 'tv'
      ? 'tv'
      : modePreference === 'default'
      ? 'default'
      : webToApk.detected
      ? 'tv'
      : 'default';
  const density = getTvDensityPreference();
  const origin = modePreference === 'auto' ? 'auto' : 'manual';

  return {
    modePreference,
    effectiveMode,
    origin,
    density,
    webToApkAvailable: webToApk.available,
    webToApkDetected: webToApk.detected,
  };
}

function snapshotsEqual(a: InternalSnapshot | null, b: InternalSnapshot): boolean {
  if (!a) return false;
  return (
    a.modePreference === b.modePreference &&
    a.effectiveMode === b.effectiveMode &&
    a.origin === b.origin &&
    a.density === b.density &&
    a.webToApkAvailable === b.webToApkAvailable &&
    a.webToApkDetected === b.webToApkDetected
  );
}

function notifyListeners(force: boolean = false): boolean {
  const next = readInternalSnapshot();
  const domChanged = syncDocumentDisplayAttributes();
  const stateChanged = !snapshotsEqual(lastSnapshot, next);
  lastSnapshot = next;

  if (!force && !domChanged && !stateChanged) {
    return false;
  }

  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // Ignore subscriber errors
    }
  });
  return true;
}

/**
 * Re-evaluates native TV detection and synchronizes document attributes and React subscribers
 * only if the effective state or bridge availability changed.
 */
export function refreshTvEnvironmentDetection(): boolean {
  ensureLoadedFromStorage();
  return notifyListeners(false);
}

/**
 * Central lifecycle monitor for TV presentation mode.
 * Synchronizes immediately on startup, performs a bounded set of short re-checks
 * in case the Android WebView injects window.WebToApk slightly after initial script load,
 * and re-verifies when the app returns to foreground.
 */
export function attachTvEnvironmentMonitor(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }

  refreshTvEnvironmentDetection();

  const retryDelays = [120, 350, 800, 1600, 3000];
  const timers: Array<ReturnType<typeof setTimeout>> = [];

  if (!detectWebToApkIsTv().available) {
    for (const delay of retryDelays) {
      const t = setTimeout(() => {
        refreshTvEnvironmentDetection();
        if (detectWebToApkIsTv().available) {
          timers.forEach((id) => clearTimeout(id));
          timers.length = 0;
        }
      }, delay);
      timers.push(t);
    }
  }

  const handleForegroundResume = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return;
    }
    refreshTvEnvironmentDetection();
  };

  window.addEventListener('focus', handleForegroundResume);
  window.addEventListener('pageshow', handleForegroundResume);
  document.addEventListener('visibilitychange', handleForegroundResume);

  return () => {
    timers.forEach((id) => clearTimeout(id));
    timers.length = 0;
    window.removeEventListener('focus', handleForegroundResume);
    window.removeEventListener('pageshow', handleForegroundResume);
    document.removeEventListener('visibilitychange', handleForegroundResume);
  };
}

export function setDisplayModePreference(pref: DisplayModePreference): void {
  ensureLoadedFromStorage();
  memoryDisplayModePref = pref;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY_DISPLAY_MODE, pref);
    } catch {
      // Safe fallback to in-memory preference
    }
  }
  notifyListeners(true);
}

export function setTvDensityPreference(density: TvDensityPreference): void {
  ensureLoadedFromStorage();
  memoryTvDensityPref = density;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY_TV_DENSITY, density);
    } catch {
      // Safe fallback to in-memory preference
    }
  }
  notifyListeners(true);
}

export function subscribeTvPresentation(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export interface TvPresentationState {
  modePreference: DisplayModePreference;
  effectiveMode: EffectiveDisplayMode;
  origin: 'auto' | 'manual';
  density: TvDensityPreference;
  webToApkTv: { detected: boolean; available: boolean };
  setModePreference: (pref: DisplayModePreference) => void;
  setDensity: (density: TvDensityPreference) => void;
}

export function useTvPresentation(): TvPresentationState {
  const getSnapshot = useCallback(() => {
    const snap = readInternalSnapshot();
    return {
      modePreference: snap.modePreference,
      effectiveMode: snap.effectiveMode,
      origin: snap.origin,
      density: snap.density,
      webToApkTv: {
        detected: snap.webToApkDetected,
        available: snap.webToApkAvailable,
      },
    };
  }, []);

  const [state, setState] = useState(getSnapshot);

  useEffect(() => {
    refreshTvEnvironmentDetection();
    setState((prev) => {
      const next = getSnapshot();
      if (
        prev.modePreference === next.modePreference &&
        prev.effectiveMode === next.effectiveMode &&
        prev.origin === next.origin &&
        prev.density === next.density &&
        prev.webToApkTv.available === next.webToApkTv.available &&
        prev.webToApkTv.detected === next.webToApkTv.detected
      ) {
        return prev;
      }
      return next;
    });
    return subscribeTvPresentation(() => {
      setState((prev) => {
        const next = getSnapshot();
        if (
          prev.modePreference === next.modePreference &&
          prev.effectiveMode === next.effectiveMode &&
          prev.origin === next.origin &&
          prev.density === next.density &&
          prev.webToApkTv.available === next.webToApkTv.available &&
          prev.webToApkTv.detected === next.webToApkTv.detected
        ) {
          return prev;
        }
        return next;
      });
    });
  }, [getSnapshot]);

  return {
    ...state,
    setModePreference: setDisplayModePreference,
    setDensity: setTvDensityPreference,
  };
}

