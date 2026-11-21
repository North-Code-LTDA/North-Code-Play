import { useCallback, useEffect, useState } from 'react';
import { isAndroidCapacitorPlatform } from '../navigation/navigationPlatformPolicy';
import {
  DisplayMode,
  getDisplayPreferencesSnapshot,
  subscribeDisplayPreferences,
} from './tvEnvironment';

export type PerformanceProfilePreference = 'auto' | 'lite' | 'full';
export type EffectivePerformanceMode = 'lite' | 'full';

export const STORAGE_KEY_PERFORMANCE_PROFILE = 'northcode_performance_profile_v1';
export const PERFORMANCE_PROFILE_DEFAULT: PerformanceProfilePreference = 'auto';

interface StoredPerformanceProfile {
  version: 1;
  preference: PerformanceProfilePreference;
}

export interface PerformanceProfileSnapshot {
  preference: PerformanceProfilePreference;
  effectiveMode: EffectivePerformanceMode;
  isAndroidApk: boolean;
  displayEffectiveMode: DisplayMode;
  isLiteActive: boolean;
}

let currentPreference: PerformanceProfilePreference = PERFORMANCE_PROFILE_DEFAULT;
let initializedFromStorage = false;
let lastLoadedRawPref: string | null = null;
let displaySubscriptionAttached = false;

const listeners = new Set<() => void>();

function isValidPreference(value: unknown): value is PerformanceProfilePreference {
  return value === 'auto' || value === 'lite' || value === 'full';
}

function parseStoredPreference(raw: string | null): PerformanceProfilePreference {
  if (!raw) return PERFORMANCE_PROFILE_DEFAULT;
  const trimmed = raw.trim();
  if (isValidPreference(trimmed)) {
    return trimmed;
  }
  try {
    const parsed = JSON.parse(trimmed) as Partial<StoredPerformanceProfile> | null;
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.version === 1 &&
      isValidPreference(parsed.preference)
    ) {
      return parsed.preference;
    }
  } catch {
    // Ignore malformed storage values and fall back to default
  }
  return PERFORMANCE_PROFILE_DEFAULT;
}

function loadFromStorageIfNeeded(): void {
  if (typeof window === 'undefined') return;

  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY_PERFORMANCE_PROFILE);
  } catch {
    if (!initializedFromStorage) {
      initializedFromStorage = true;
    }
    return;
  }

  if (initializedFromStorage && raw === lastLoadedRawPref) {
    return;
  }

  initializedFromStorage = true;
  lastLoadedRawPref = raw;
  currentPreference = parseStoredPreference(raw);
}

/**
 * Resolves the effective visual performance mode:
 * - Web: always 'full'
 * - Android APK:
 *   - 'auto': 'lite' when effective display presentation mode is 'tv', otherwise 'full'
 *   - 'lite': 'lite'
 *   - 'full': 'full'
 */
export function resolveEffectivePerformanceMode(
  preference: PerformanceProfilePreference,
  isAndroidApk: boolean,
  displayEffectiveMode: DisplayMode
): EffectivePerformanceMode {
  if (!isAndroidApk) {
    return 'full';
  }
  if (preference === 'lite') {
    return 'lite';
  }
  if (preference === 'full') {
    return 'full';
  }
  return displayEffectiveMode === 'tv' ? 'lite' : 'full';
}

export function getPerformanceProfileSnapshot(): PerformanceProfileSnapshot {
  loadFromStorageIfNeeded();
  const isAndroidApk = isAndroidCapacitorPlatform();
  const displaySnap = getDisplayPreferencesSnapshot();
  const effectiveMode = resolveEffectivePerformanceMode(
    currentPreference,
    isAndroidApk,
    displaySnap.effectiveMode
  );

  return {
    preference: currentPreference,
    effectiveMode,
    isAndroidApk,
    displayEffectiveMode: displaySnap.effectiveMode,
    isLiteActive: effectiveMode === 'lite',
  };
}

export function syncDocumentPerformanceAttributes(): boolean {
  if (typeof document === 'undefined' || !document.documentElement) return false;
  const snap = getPerformanceProfileSnapshot();
  const docEl = document.documentElement;
  if (docEl.getAttribute('data-performance-mode') !== snap.effectiveMode) {
    docEl.setAttribute('data-performance-mode', snap.effectiveMode);
    return true;
  }
  return false;
}

function notifyListeners(): void {
  syncDocumentPerformanceAttributes();
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // Ignore subscriber errors
    }
  });
}

function ensureDisplaySubscription(): void {
  if (displaySubscriptionAttached) return;
  displaySubscriptionAttached = true;
  subscribeDisplayPreferences(() => {
    notifyListeners();
  });
}

/**
 * Initializes the performance profile attribute on documentElement before React mounts
 * and keeps it synchronized with TV presentation mode confirmations.
 */
export function initPerformanceProfile(): PerformanceProfileSnapshot {
  ensureDisplaySubscription();
  syncDocumentPerformanceAttributes();
  return getPerformanceProfileSnapshot();
}

export function setPerformanceProfilePreference(
  nextPreference: PerformanceProfilePreference
): boolean {
  if (!isValidPreference(nextPreference)) {
    return false;
  }
  ensureDisplaySubscription();
  loadFromStorageIfNeeded();
  currentPreference = nextPreference;

  const payload: StoredPerformanceProfile = {
    version: 1,
    preference: nextPreference,
  };

  let persisted = false;
  if (typeof window !== 'undefined') {
    try {
      const serialized = JSON.stringify(payload);
      window.localStorage.setItem(STORAGE_KEY_PERFORMANCE_PROFILE, serialized);
      lastLoadedRawPref = serialized;
      initializedFromStorage = true;
      persisted = true;
    } catch {
      // Keep in-memory state if localStorage is unavailable or full
      initializedFromStorage = true;
      try {
        lastLoadedRawPref = window.localStorage.getItem(STORAGE_KEY_PERFORMANCE_PROFILE);
      } catch {
        // Ignore read error when storage is unavailable
      }
    }
  }

  notifyListeners();
  return persisted;
}

export function subscribePerformanceProfile(listener: () => void): () => void {
  ensureDisplaySubscription();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Resets in-memory cache (not localStorage) so automated tests can simulate a cold app restart.
 * Production code should never call this.
 */
export function resetPerformanceProfileCacheForTest(): void {
  currentPreference = PERFORMANCE_PROFILE_DEFAULT;
  initializedFromStorage = false;
  lastLoadedRawPref = null;
}

export interface UsePerformanceProfileResult extends PerformanceProfileSnapshot {
  setPreference: (nextPreference: PerformanceProfilePreference) => boolean;
}

export function usePerformanceProfile(): UsePerformanceProfileResult {
  const [state, setState] = useState<PerformanceProfileSnapshot>(() =>
    getPerformanceProfileSnapshot()
  );

  const refreshState = useCallback(() => {
    const next = getPerformanceProfileSnapshot();
    setState((prev) => {
      if (
        prev.preference === next.preference &&
        prev.effectiveMode === next.effectiveMode &&
        prev.isAndroidApk === next.isAndroidApk &&
        prev.displayEffectiveMode === next.displayEffectiveMode &&
        prev.isLiteActive === next.isLiteActive
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    ensureDisplaySubscription();
    syncDocumentPerformanceAttributes();
    refreshState();
    return subscribePerformanceProfile(refreshState);
  }, [refreshState]);

  return {
    ...state,
    setPreference: setPerformanceProfilePreference,
  };
}
