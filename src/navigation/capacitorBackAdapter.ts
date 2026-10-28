import { executeBackAction } from './backPolicy';

interface CapacitorListenerHandle {
  remove?: () => Promise<void> | void;
}

export interface NativeBackBridgeStatus {
  bridgeType: 'appmint' | 'capacitor' | 'cordova-backbutton' | 'none';
  label: string;
  active: boolean;
}

let activeBridgeType: NativeBackBridgeStatus['bridgeType'] = 'none';

export function getNativeBackBridgeStatus(): NativeBackBridgeStatus {
  if (typeof window !== 'undefined') {
    try {
      const w = window as any;
      if (w.AppMint && typeof w.AppMint.setBackHandler === 'function') {
        return {
          bridgeType: 'appmint',
          label: 'AppMint.setBackHandler (WebToApk)',
          active: activeBridgeType === 'appmint',
        };
      }
      if (w.Capacitor?.Plugins?.App && typeof w.Capacitor.Plugins.App.addListener === 'function') {
        return {
          bridgeType: 'capacitor',
          label: 'Capacitor App.backButton',
          active: activeBridgeType === 'capacitor',
        };
      }
    } catch {
      // Ignore bridge inspection errors
    }
  }

  if (activeBridgeType === 'cordova-backbutton') {
    return {
      bridgeType: 'cordova-backbutton',
      label: 'Ausente (Fallback document backbutton ativo)',
      active: false,
    };
  }

  return {
    bridgeType: 'none',
    label: 'Ausente',
    active: false,
  };
}

/**
 * Attaches a runtime listener to Android TV / APK hardware/system Back button:
 * 1. Prioritizes window.AppMint.setBackHandler (WebToApk official synchronous API):
 *    - Executes executeBackAction() synchronously.
 *    - Returns true when consumed internally (player, modal, submenu, details, channels, categories, section).
 *    - Returns false when no internal layer consumes Back (root screen), allowing host exit confirmation.
 *    - Cleans up via setBackHandler(null) on teardown and avoids attaching duplicate listeners.
 * 2. Falls back to Capacitor App.addListener('backButton') or Cordova/WebView 'backbutton'
 *    ONLY when AppMint.setBackHandler is not present.
 */
export function attachCapacitorBackAdapter(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }

  let removed = false;
  const w = window as any;

  // 1. Official WebToApk / AppMint synchronous Back handler
  try {
    if (w.AppMint && typeof w.AppMint.setBackHandler === 'function') {
      const appMintHandler = (): boolean => {
        if (removed) return false;
        try {
          return Boolean(executeBackAction());
        } catch (err) {
          console.warn('AppMint back handler error:', err);
          return false;
        }
      };

      w.AppMint.setBackHandler(appMintHandler);
      activeBridgeType = 'appmint';

      return () => {
        removed = true;
        activeBridgeType = 'none';
        try {
          if (w.AppMint && typeof w.AppMint.setBackHandler === 'function') {
            w.AppMint.setBackHandler(null);
          }
        } catch {
          // Ignore teardown errors
        }
      };
    }
  } catch {
    // Fall through to Capacitor / document fallback if AppMint access throws
  }

  // 2. Fallback: Capacitor App plugin or document 'backbutton' (only when AppMint is absent)
  let pluginListenerHandle: CapacitorListenerHandle | null = null;
  let pendingPromise: Promise<CapacitorListenerHandle> | null = null;
  let capacitorAttached = false;

  const handleNativeBack = (ev?: any) => {
    if (removed) return;
    if (ev && typeof ev.preventDefault === 'function') {
      ev.preventDefault();
    }

    const handled = executeBackAction();
    if (!handled) {
      // At root screen: allow native Android app to exit/minimize without logging out
      const cap = (window as any).Capacitor;
      const appPlugin = cap?.Plugins?.App;
      if (appPlugin && typeof appPlugin.exitApp === 'function') {
        try {
          appPlugin.exitApp();
        } catch {}
      }
    }
  };

  const cap = w.Capacitor;
  const appPlugin = cap?.Plugins?.App;

  if (appPlugin && typeof appPlugin.addListener === 'function') {
    try {
      const maybePromise = appPlugin.addListener('backButton', handleNativeBack);
      capacitorAttached = true;
      activeBridgeType = 'capacitor';
      if (maybePromise && typeof maybePromise.then === 'function') {
        pendingPromise = maybePromise;
        maybePromise
          .then((handle: CapacitorListenerHandle) => {
            if (removed) {
              handle?.remove?.();
            } else {
              pluginListenerHandle = handle;
            }
          })
          .catch(() => {});
      } else if (maybePromise && typeof maybePromise.remove === 'function') {
        pluginListenerHandle = maybePromise;
      }
    } catch {}
  }

  const onDocumentBackButton = (e: Event) => {
    handleNativeBack(e);
  };

  if (!capacitorAttached) {
    document.addEventListener('backbutton', onDocumentBackButton, false);
    activeBridgeType = 'cordova-backbutton';
  }

  return () => {
    removed = true;
    activeBridgeType = 'none';
    if (!capacitorAttached) {
      document.removeEventListener('backbutton', onDocumentBackButton, false);
    }
    if (pluginListenerHandle && typeof pluginListenerHandle.remove === 'function') {
      try {
        pluginListenerHandle.remove();
      } catch {}
    }
    if (pendingPromise) {
      pendingPromise
        .then((h) => {
          try {
            h?.remove?.();
          } catch {}
        })
        .catch(() => {});
    }
  };
}

