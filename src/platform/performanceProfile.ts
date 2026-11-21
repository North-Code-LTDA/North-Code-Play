import { useCallback, useEffect, useState } from 'react';
import { isAndroidCapacitorPlatform } from '../navigation/navigationPlatformPolicy';
import { NavMode, getNavMode, subscribeNavMode } from '../navigation/spatialNav';
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
  navMode: NavMode;
  isLiteActive: boolean;
}

let currentPreference: PerformanceProfilePreference = PERFORMANCE_PROFILE_DEFAULT;
let initializedFromStorage = false;
let lastLoadedRawPref: string | null = null;
let displaySubscriptionAttached = false;
let navModeSubscriptionAttached = false;
let displaySubscriptionAttachCount = 0;
let navModeSubscriptionAttachCount = 0;
let lastNotifiedSnapshot: PerformanceProfileSnapshot | null = null;

const listeners = new Set<() => void>();

function isValidPreference(value: unknown): value is PerformanceProfilePreference {
  return value === 'auto' || value === 'lite' || value === 'full';
}

function areSnapshotsEqual(
  a: PerformanceProfileSnapshot | null,
  b: PerformanceProfileSnapshot
): boolean {
  if (!a) return false;
  return (
    a.preference === b.preference &&
    a.effectiveMode === b.effectiveMode &&
    a.isAndroidApk === b.isAndroidApk &&
    a.displayEffectiveMode === b.displayEffectiveMode &&
    a.navMode === b.navMode &&
    a.isLiteActive === b.isLiteActive
  );
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
 * - Android APK + display presentation 'default': always 'full'
 * - Android APK + display presentation 'tv' + navMode 'pointer': always 'full'
 * - Android APK + display presentation 'tv' + navMode 'remote':
 *   - 'auto': 'lite'
 *   - 'lite': 'lite'
 *   - 'full': 'full'
 */
export function resolveEffectivePerformanceMode(
  preference: PerformanceProfilePreference,
  isAndroidApk: boolean,
  displayEffectiveMode: DisplayMode,
  navMode: NavMode = getNavMode()
): EffectivePerformanceMode {
  if (!isAndroidApk) {
    return 'full';
  }
  if (displayEffectiveMode !== 'tv') {
    return 'full';
  }
  if (navMode !== 'remote') {
    return 'full';
  }
  if (preference === 'full') {
    return 'full';
  }
  return 'lite';
}

export function getPerformanceProfileSnapshot(): PerformanceProfileSnapshot {
  loadFromStorageIfNeeded();
  const isAndroidApk = isAndroidCapacitorPlatform();
  const displaySnap = getDisplayPreferencesSnapshot();
  const navMode = getNavMode();
  const effectiveMode = resolveEffectivePerformanceMode(
    currentPreference,
    isAndroidApk,
    displaySnap.effectiveMode,
    navMode
  );

  return {
    preference: currentPreference,
    effectiveMode,
    isAndroidApk,
    displayEffectiveMode: displaySnap.effectiveMode,
    navMode,
    isLiteActive: effectiveMode === 'lite',
  };
}

export function syncDocumentPerformanceAttributes(
  precomputedSnapshot?: PerformanceProfileSnapshot
): boolean {
  if (typeof document === 'undefined' || !document.documentElement) return false;
  const snap = precomputedSnapshot ?? getPerformanceProfileSnapshot();
  const docEl = document.documentElement;
  if (docEl.getAttribute('data-performance-mode') !== snap.effectiveMode) {
    docEl.setAttribute('data-performance-mode', snap.effectiveMode);
    return true;
  }
  return false;
}

function notifyListenersIfChanged(): boolean {
  const snap = getPerformanceProfileSnapshot();
  const domChanged = syncDocumentPerformanceAttributes(snap);
  const snapshotChanged = !areSnapshotsEqual(lastNotifiedSnapshot, snap);

  if (!domChanged && !snapshotChanged) {
    return false;
  }

  lastNotifiedSnapshot = snap;
  if (!snapshotChanged) {
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

function ensureSubscriptions(): void {
  if (!displaySubscriptionAttached) {
    displaySubscriptionAttached = true;
    displaySubscriptionAttachCount += 1;
    subscribeDisplayPreferences(() => {
      notifyListenersIfChanged();
    });
  }
  if (!navModeSubscriptionAttached) {
    navModeSubscriptionAttached = true;
    navModeSubscriptionAttachCount += 1;
    subscribeNavMode(() => {
      notifyListenersIfChanged();
    });
  }
}

/**
 * Initializes the performance profile attribute on documentElement before React mounts
 * and keeps it synchronized with TV presentation mode and remote/pointer nav mode.
 */
export function initPerformanceProfile(): PerformanceProfileSnapshot {
  ensureSubscriptions();
  const snap = getPerformanceProfileSnapshot();
  syncDocumentPerformanceAttributes(snap);
  lastNotifiedSnapshot = snap;
  return snap;
}

export function setPerformanceProfilePreference(
  nextPreference: PerformanceProfilePreference
): boolean {
  if (!isValidPreference(nextPreference)) {
    return false;
  }
  ensureSubscriptions();
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

  notifyListenersIfChanged();
  return persisted;
}

export function subscribePerformanceProfile(listener: () => void): () => void {
  ensureSubscriptions();
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
  lastNotifiedSnapshot = null;
}

/**
 * Exposes internal global subscription counters for automated verification that
 * mounts/remounts never register duplicate subscriptions.
 */
export function getPerformanceProfileSubscriptionCountsForTest(): {
  display: number;
  navMode: number;
  listeners: number;
} {
  return {
    display: displaySubscriptionAttachCount,
    navMode: navModeSubscriptionAttachCount,
    listeners: listeners.size,
  };
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
      if (areSnapshotsEqual(prev, next)) {
        return prev;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    ensureSubscriptions();
    const snap = getPerformanceProfileSnapshot();
    syncDocumentPerformanceAttributes(snap);
    lastNotifiedSnapshot = snap;
    refreshState();
    return subscribePerformanceProfile(refreshState);
  }, [refreshState]);

  return {
    ...state,
    setPreference: setPerformanceProfilePreference,
  };
}
