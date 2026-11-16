import { Capacitor } from '@capacitor/core';

export type NativeRuntimeKind = 'android' | 'web';

export interface NativeRuntimeProbe {
  isNativePlatform: () => boolean;
  getPlatform: () => string;
}

export interface NativeRuntimeInfo {
  runtime: NativeRuntimeKind;
  isNativePlatform: boolean;
  platform: string;
  isNativeAndroid: boolean;
}

const defaultNativeProbe: NativeRuntimeProbe = {
  isNativePlatform: () => {
    try {
      return typeof Capacitor?.isNativePlatform === 'function'
        ? Boolean(Capacitor.isNativePlatform())
        : false;
    } catch {
      return false;
    }
  },
  getPlatform: () => {
    try {
      return typeof Capacitor?.getPlatform === 'function'
        ? String(Capacitor.getPlatform() || 'web').toLowerCase()
        : 'web';
    } catch {
      return 'web';
    }
  },
};

/**
 * Detects whether the app is executing inside the native Android Capacitor shell.
 * Never infers physical Android TV or native APK from UI display mode (`data-display-mode="tv"`).
 */
export function detectNativeRuntimeInfo(
  probe: NativeRuntimeProbe = defaultNativeProbe
): NativeRuntimeInfo {
  let isNativePlatform = false;
  let platform = 'web';

  try {
    isNativePlatform = Boolean(probe.isNativePlatform());
  } catch {
    isNativePlatform = false;
  }

  try {
    platform = String(probe.getPlatform() || 'web').toLowerCase();
  } catch {
    platform = 'web';
  }

  const isNativeAndroid = isNativePlatform && platform === 'android';

  return {
    runtime: isNativeAndroid ? 'android' : 'web',
    isNativePlatform,
    platform,
    isNativeAndroid,
  };
}

/**
 * Synchronizes native runtime attributes onto `document.documentElement` before React mounts,
 * enabling CSS-level Android APK optimizations while keeping standard Web completely intact.
 */
export function syncNativeRuntimeAttributes(
  doc: Document | null | undefined = typeof document !== 'undefined' ? document : null,
  probe?: NativeRuntimeProbe
): NativeRuntimeInfo {
  const info = detectNativeRuntimeInfo(probe);
  const rootEl = doc?.documentElement;

  if (rootEl) {
    rootEl.setAttribute('data-native-runtime', info.isNativeAndroid ? 'capacitor-android' : 'web');
    if (info.isNativeAndroid) {
      rootEl.setAttribute('data-android-apk', 'true');
    } else {
      rootEl.removeAttribute('data-android-apk');
    }
  }

  return info;
}

/**
 * Checks whether the current runtime is native Android APK (reading synchronized root attribute first,
 * falling back to Capacitor runtime probe).
 */
export function isNativeAndroidRuntime(
  doc: Document | null | undefined = typeof document !== 'undefined' ? document : null
): boolean {
  const rootAttr = doc?.documentElement?.getAttribute('data-android-apk');
  if (rootAttr === 'true') {
    return true;
  }
  if (doc?.documentElement?.getAttribute('data-native-runtime') === 'web') {
    return false;
  }
  return detectNativeRuntimeInfo().isNativeAndroid;
}
