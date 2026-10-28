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

export function syncDocumentDisplayAttributes(): void {
  if (typeof document === 'undefined' || !document.documentElement) return;
  const pref = getDisplayModePreference();
  const effective = getEffectiveDisplayMode(pref);
  const density = getTvDensityPreference();
  const origin = pref === 'auto' ? 'auto' : 'manual';

  document.documentElement.setAttribute('data-display-mode', effective);
  document.documentElement.setAttribute('data-tv-density', density);
  document.documentElement.setAttribute('data-display-origin', origin);
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
  notifyListeners();
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
  notifyListeners();
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
    const modePreference = getDisplayModePreference();
    const effectiveMode = getEffectiveDisplayMode(modePreference);
    const density = getTvDensityPreference();
    const webToApkTv = detectWebToApkIsTv();
    return {
      modePreference,
      effectiveMode,
      origin: (modePreference === 'auto' ? 'auto' : 'manual') as 'auto' | 'manual',
      density,
      webToApkTv,
    };
  }, []);

  const [state, setState] = useState(getSnapshot);

  useEffect(() => {
    syncDocumentDisplayAttributes();
    setState(getSnapshot());
    return subscribeTvPresentation(() => {
      setState(getSnapshot());
    });
  }, [getSnapshot]);

  return {
    ...state,
    setModePreference: setDisplayModePreference,
    setDensity: setTvDensityPreference,
  };
}
