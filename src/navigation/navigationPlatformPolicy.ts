import { Capacitor } from '@capacitor/core';

export type DpadNavigationBehaviorMode = 'current' | 'optimized';

let androidPlatformOverrideForTest: boolean | null = null;

/**
 * Allows automated tests to deterministically simulate Web vs Android Capacitor environments.
 * Production code should never call this.
 */
export function setAndroidPlatformOverrideForDpadTest(isAndroid: boolean | null): void {
  androidPlatformOverrideForTest = isAndroid;
}

/**
 * Detects whether the application is currently executing inside the Android Capacitor APK.
 */
export function isAndroidCapacitorPlatform(): boolean {
  if (androidPlatformOverrideForTest !== null) {
    return androidPlatformOverrideForTest;
  }
  try {
    if (
      typeof Capacitor !== 'undefined' &&
      typeof Capacitor.isNativePlatform === 'function' &&
      Capacitor.isNativePlatform() &&
      typeof Capacitor.getPlatform === 'function' &&
      Capacitor.getPlatform() === 'android'
    ) {
      return true;
    }
    if (typeof window !== 'undefined' && (window as any).Capacitor) {
      const winCap = (window as any).Capacitor;
      if (
        typeof winCap.isNativePlatform === 'function' &&
        winCap.isNativePlatform() &&
        typeof winCap.getPlatform === 'function' &&
        winCap.getPlatform() === 'android'
      ) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Definitive platform navigation policy:
 * - Android APK: always uses the optimized D-Pad path ('optimized').
 * - Web: preserves standard Web navigation behavior ('current').
 * Legacy localStorage preferences are ignored so runtime behavior is strictly deterministic.
 */
export function getDpadNavigationBehaviorMode(): DpadNavigationBehaviorMode {
  return isAndroidCapacitorPlatform() ? 'optimized' : 'current';
}

/**
 * Returns true strictly when running on the Android Capacitor platform where the
 * optimized D-Pad path (2-row prefetch window, reduced synchronous layout, monotonic probe)
 * is definitively active.
 */
export function isDpadOptimizedPathActive(): boolean {
  return isAndroidCapacitorPlatform();
}
