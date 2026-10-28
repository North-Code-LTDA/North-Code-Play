import { executeBackAction } from './backPolicy';

interface CapacitorListenerHandle {
  remove?: () => Promise<void> | void;
}

/**
 * Attaches a runtime listener to Capacitor Android's hardware/system Back button
 * without requiring @capacitor/app in package.json.
 * Falls back to Cordova/WebView 'backbutton' document event when applicable.
 * At root screen (when executeBackAction() returns false), delegates to App.exitApp()
 * without ever clearing credentials or logging the user out.
 */
export function attachCapacitorBackAdapter(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }

  let removed = false;
  let pluginListenerHandle: CapacitorListenerHandle | null = null;
  let pendingPromise: Promise<CapacitorListenerHandle> | null = null;

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

  const cap = (window as any).Capacitor;
  const appPlugin = cap?.Plugins?.App;

  if (appPlugin && typeof appPlugin.addListener === 'function') {
    try {
      const maybePromise = appPlugin.addListener('backButton', handleNativeBack);
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

  document.addEventListener('backbutton', onDocumentBackButton, false);

  return () => {
    removed = true;
    document.removeEventListener('backbutton', onDocumentBackButton, false);
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
