import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { App } from '@capacitor/app';
import type { BackButtonListenerEvent } from '@capacitor/app';
import { executeBackAction } from './backPolicy';

export interface CapacitorAppBridgeLike {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  addListener: (
    eventName: 'backButton',
    listenerFunc: (event: BackButtonListenerEvent) => void
  ) => Promise<PluginListenerHandle> | PluginListenerHandle;
  exitApp: () => Promise<void> | void;
}

export interface NativeBackBridgeStatus {
  bridgeType: 'capacitor' | 'none';
  label: string;
  active: boolean;
}

let testBridgeOverride: CapacitorAppBridgeLike | null = null;
let activeInstanceToken = 0;
let attachedInstanceToken: number | null = null;
let activeTearDown: (() => void) | null = null;

/**
 * Permite injetar ou inspecionar o adaptador oficial @capacitor/app em testes automatizados
 * sem depender de variáveis globais legadas (AppMint/Cordova).
 */
export function setCapacitorAppBridgeForTest(override: CapacitorAppBridgeLike | null): void {
  testBridgeOverride = override;
}

function resolveCapacitorBridge(): {
  isNative: boolean;
  addListener: CapacitorAppBridgeLike['addListener'];
  exitApp: CapacitorAppBridgeLike['exitApp'];
} {
  if (testBridgeOverride) {
    const isNative =
      typeof testBridgeOverride.isNativePlatform === 'function'
        ? testBridgeOverride.isNativePlatform()
        : true;
    return {
      isNative,
      addListener: testBridgeOverride.addListener.bind(testBridgeOverride),
      exitApp: testBridgeOverride.exitApp.bind(testBridgeOverride),
    };
  }

  let isNative = false;
  try {
    if (typeof Capacitor?.isNativePlatform === 'function') {
      isNative = Boolean(Capacitor.isNativePlatform());
    } else if (typeof Capacitor?.getPlatform === 'function') {
      isNative = Capacitor.getPlatform() !== 'web';
    }
  } catch {
    isNative = false;
  }

  return {
    isNative,
    addListener: (eventName, listenerFunc) => App.addListener(eventName, listenerFunc),
    exitApp: () => App.exitApp(),
  };
}

export function getNativeBackBridgeStatus(): NativeBackBridgeStatus {
  const { isNative } = resolveCapacitorBridge();
  const isAttached = attachedInstanceToken !== null;

  if (isNative || (testBridgeOverride !== null && isAttached)) {
    return {
      bridgeType: 'capacitor',
      label: 'Capacitor App.backButton (@capacitor/app)',
      active: isAttached,
    };
  }

  return {
    bridgeType: 'none',
    label: 'Navegador Web (Capacitor App.backButton pronto para Android)',
    active: false,
  };
}

/**
 * Registra o listener oficial do Capacitor 8 (`App.addListener('backButton', ...)`)
 * para Android TV e celulares Android:
 * - Encaminha o evento para `executeBackAction()`, respeitando a prioridade de camadas:
 *   menus do player -> tela cheia/player -> detalhes -> canais/categorias -> seção -> início.
 * - Na tela raiz (quando `executeBackAction()` retorna `false`), invoca `App.exitApp()`
 *   mantendo as credenciais e os dados locais preservados para reabertura.
 * - Garante um único listener ativo por instância e remoção segura mesmo quando a
 *   Promise de `App.addListener` resolve após a desmontagem ou durante ciclos de `React.StrictMode`.
 */
export function attachCapacitorBackAdapter(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }

  // Se já houver uma instância anterior pendente ou ativa, desarma-a antes de registrar a nova
  if (activeTearDown) {
    try {
      activeTearDown();
    } catch {
      // Ignore previous teardown error
    }
    activeTearDown = null;
  }

  const instanceToken = ++activeInstanceToken;
  let removed = false;
  let resolvedHandle: PluginListenerHandle | null = null;
  let registrationPromise: Promise<PluginListenerHandle> | null = null;

  const { isNative, addListener, exitApp } = resolveCapacitorBridge();
  const shouldAttachNativeListener = isNative || testBridgeOverride !== null;

  const handleNativeBack = (event?: BackButtonListenerEvent) => {
    if (removed || attachedInstanceToken !== instanceToken) {
      return;
    }

    if (event && typeof (event as any).preventDefault === 'function') {
      try {
        (event as any).preventDefault();
      } catch {
        // Ignore preventDefault error
      }
    }

    let handled = false;
    try {
      handled = Boolean(executeBackAction());
    } catch (err) {
      console.warn('[CapacitorBackAdapter] Erro ao executar ação de Voltar:', err);
      handled = false;
    }

    if (!handled) {
      // Na raiz da aplicação: aplica a saída nativa mantendo credenciais e dados locais intactos
      try {
        const maybeExitPromise = exitApp();
        if (maybeExitPromise && typeof (maybeExitPromise as Promise<void>).catch === 'function') {
          (maybeExitPromise as Promise<void>).catch(() => {});
        }
      } catch {
        // Ignore exitApp errors on unsupported platforms
      }
    }
  };

  if (shouldAttachNativeListener) {
    attachedInstanceToken = instanceToken;
    try {
      const maybePromise = addListener('backButton', handleNativeBack);
      if (maybePromise && typeof (maybePromise as Promise<PluginListenerHandle>).then === 'function') {
        registrationPromise = maybePromise as Promise<PluginListenerHandle>;
        registrationPromise
          .then((handle) => {
            if (removed || attachedInstanceToken !== instanceToken) {
              // Se a instância já foi desmontada antes da resolução da Promise (ex.: StrictMode), remove imediatamente
              try {
                const removeRes = handle?.remove?.();
                if (removeRes && typeof (removeRes as Promise<void>).catch === 'function') {
                  (removeRes as Promise<void>).catch(() => {});
                }
              } catch {
                // Ignore late removal error
              }
              return;
            }
            resolvedHandle = handle;
          })
          .catch(() => {
            if (attachedInstanceToken === instanceToken) {
              attachedInstanceToken = null;
            }
          });
      } else if (maybePromise && typeof (maybePromise as PluginListenerHandle).remove === 'function') {
        resolvedHandle = maybePromise as PluginListenerHandle;
      }
    } catch {
      if (attachedInstanceToken === instanceToken) {
        attachedInstanceToken = null;
      }
    }
  }

  const detach = () => {
    if (removed) return;
    removed = true;

    if (attachedInstanceToken === instanceToken) {
      attachedInstanceToken = null;
    }
    if (activeTearDown === detach) {
      activeTearDown = null;
    }

    if (resolvedHandle && typeof resolvedHandle.remove === 'function') {
      const handleToRemove = resolvedHandle;
      resolvedHandle = null;
      try {
        const removeRes = handleToRemove.remove();
        if (removeRes && typeof (removeRes as Promise<void>).catch === 'function') {
          (removeRes as Promise<void>).catch(() => {});
        }
      } catch {
        // Ignore synchronous remove error
      }
    }
  };

  activeTearDown = detach;
  return detach;
}
