import { Window } from 'happy-dom';
import type * as ReactNamespace from 'react';
import type { Root } from 'react-dom/client';

export interface MediaQueryListLike {
  matches: boolean;
  media: string;
  onchange: null;
  addListener: () => void;
  removeListener: () => void;
  addEventListener: () => void;
  removeEventListener: () => void;
  dispatchEvent: () => boolean;
}

export interface DomTestEnvOptions {
  url?: string;
  width?: number;
  height?: number;
  watchdogMs?: number;
  watchdogLabel?: string;
  rafIntervalMs?: number;
  disableElementAnimate?: boolean;
  stubScrollIntoView?: boolean;
  stubMediaPlayback?: boolean;
  stubResizeObserver?: boolean;
  stubIntersectionObserver?: boolean;
  matchMedia?: (query: string) => MediaQueryListLike;
  fetchImpl?: typeof fetch;
  beforeReactImport?: (ctx: {
    window: Window;
    document: Document;
    registerCleanup: (fn: () => void | Promise<void>) => void;
  }) => void;
}

export interface TrackedReactRoot {
  host: HTMLDivElement;
  root: Root;
  unmount: () => Promise<void>;
  unmountSync: () => void;
}

export interface DomTestEnv {
  window: Window;
  document: Document;
  React: typeof ReactNamespace.default;
  act: typeof ReactNamespace.act;
  Profiler: typeof ReactNamespace.Profiler;
  createTrackedRoot: (existingHost?: HTMLDivElement) => TrackedReactRoot;
  unmountAllRoots: () => Promise<Error[]>;
  registerCleanup: (fn: () => void | Promise<void>) => void;
  clearRafTimers: () => void;
  clearWatchdog: () => void;
  dispose: () => Promise<Error[]>;
}

interface SavedGlobalDescriptor {
  key: string;
  existed: boolean;
  descriptor?: PropertyDescriptor;
}

const DEFAULT_MATCH_MEDIA = (query: string): MediaQueryListLike => ({
  matches: query.includes('prefers-reduced-motion'),
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
});

function setGlobalProperty(
  saved: SavedGlobalDescriptor[],
  key: string,
  value: unknown
): void {
  const existed = Object.prototype.hasOwnProperty.call(globalThis, key);
  const descriptor = existed
    ? Object.getOwnPropertyDescriptor(globalThis, key)
    : undefined;
  saved.push({ key, existed, descriptor });

  try {
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
      enumerable: descriptor ? descriptor.enumerable : true,
    });
  } catch {
    (globalThis as Record<string, unknown>)[key] = value;
  }
}

function restoreGlobalProperties(saved: SavedGlobalDescriptor[]): Error[] {
  const errors: Error[] = [];
  for (let i = saved.length - 1; i >= 0; i -= 1) {
    const entry = saved[i];
    try {
      if (entry.existed && entry.descriptor) {
        Object.defineProperty(globalThis, entry.key, entry.descriptor);
      } else {
        delete (globalThis as Record<string, unknown>)[entry.key];
      }
    } catch (err) {
      errors.push(
        err instanceof Error
          ? err
          : new Error(`Falha ao restaurar global "${entry.key}": ${String(err)}`)
      );
    }
  }
  saved.length = 0;
  return errors;
}

/**
 * Inicializa um ambiente happy-dom isolado seguindo a ordem obrigatória:
 * 1) Watchdog de segurança (permanece ativo durante bootstrap, execução e teardown;
 *    sem unref() para impedir saída prematura silenciosa de Promises pendentes,
 *    e cancelado explicitamente ao final de dispose() para permitir encerramento natural)
 * 2) Criação da Window happy-dom (dentro do bloco protegido) e registro de globais/mocks
 * 3) Hook opcional beforeReactImport (geometria, protótipos e mocks específicos)
 * 4) Import dinâmico de react e react-dom/client (garantindo canUseDOM=true)
 */
export async function createDomTestEnv(
  options: DomTestEnvOptions = {}
): Promise<DomTestEnv> {
  const {
    url = 'http://localhost:3000',
    width = 1280,
    height = 720,
    watchdogMs,
    watchdogLabel = 'dom-test',
    rafIntervalMs = 16,
    disableElementAnimate = true,
    stubScrollIntoView = true,
    stubMediaPlayback = false,
    stubResizeObserver = true,
    stubIntersectionObserver = true,
    matchMedia = DEFAULT_MATCH_MEDIA,
    fetchImpl,
    beforeReactImport,
  } = options;

  let watchdog: ReturnType<typeof setTimeout> | null = null;
  if (typeof watchdogMs === 'number' && watchdogMs > 0) {
    watchdog = setTimeout(() => {
      console.error(`TIMEOUT GLOBAL: ${watchdogLabel} excedeu ${watchdogMs / 1000}s`);
      process.exit(1);
    }, watchdogMs);
  }

  const clearWatchdog = () => {
    if (watchdog !== null) {
      clearTimeout(watchdog);
      watchdog = null;
    }
  };

  const savedGlobals: SavedGlobalDescriptor[] = [];
  const customCleanups: Array<() => void | Promise<void>> = [];
  const rafTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const activeRoots = new Set<TrackedReactRoot>();
  let windowInstance: Window | null = null;
  let loadedAct: typeof ReactNamespace.act | null = null;
  let disposePromise: Promise<Error[]> | null = null;

  const registerCleanup = (fn: () => void | Promise<void>) => {
    customCleanups.push(fn);
  };

  const clearRafTimers = () => {
    for (const timer of rafTimers.values()) {
      clearTimeout(timer);
    }
    rafTimers.clear();
  };

  const unmountAllRoots = async (): Promise<Error[]> => {
    const errors: Error[] = [];
    for (const tracked of Array.from(activeRoots)) {
      try {
        await tracked.unmount();
      } catch (err) {
        errors.push(
          err instanceof Error
            ? err
            : new Error(`Falha ao desmontar root React: ${String(err)}`)
        );
      }
    }
    return errors;
  };

  const dispose = (): Promise<Error[]> => {
    if (disposePromise) {
      return disposePromise;
    }

    disposePromise = (async () => {
      const errors: Error[] = [];
      try {
        const rootErrors = await unmountAllRoots();
        errors.push(...rootErrors);

        for (let i = customCleanups.length - 1; i >= 0; i -= 1) {
          try {
            await customCleanups[i]();
          } catch (err) {
            errors.push(
              err instanceof Error
                ? err
                : new Error(`Falha em rotina de limpeza registrada: ${String(err)}`)
            );
          }
        }
        customCleanups.length = 0;

        try {
          clearRafTimers();
        } catch (err) {
          errors.push(err instanceof Error ? err : new Error(String(err)));
        }

        if (windowInstance !== null) {
          const closingWindow = windowInstance;
          windowInstance = null;
          try {
            await closingWindow.close();
          } catch (err) {
            errors.push(
              err instanceof Error
                ? err
                : new Error(`Falha ao encerrar happy-dom Window: ${String(err)}`)
            );
          }
        }

        errors.push(...restoreGlobalProperties(savedGlobals));
      } finally {
        clearWatchdog();
      }

      return errors;
    })();

    return disposePromise;
  };

  try {
    windowInstance = new Window({ url, width, height });
    const doc = windowInstance.document as unknown as Document;

    setGlobalProperty(savedGlobals, 'IS_REACT_ACT_ENVIRONMENT', true);
    setGlobalProperty(savedGlobals, 'window', windowInstance);
    setGlobalProperty(savedGlobals, 'document', doc);
    setGlobalProperty(savedGlobals, 'navigator', windowInstance.navigator);

    const domConstructors = [
      'HTMLElement',
      'HTMLButtonElement',
      'HTMLInputElement',
      'HTMLVideoElement',
      'HTMLImageElement',
      'HTMLTrackElement',
      'Element',
      'Node',
      'SVGElement',
      'Event',
      'InputEvent',
      'CustomEvent',
      'KeyboardEvent',
      'MouseEvent',
      'FocusEvent',
      'MutationObserver',
      'localStorage',
      'sessionStorage',
      'URL',
      'Blob',
    ] as const;

    for (const ctorName of domConstructors) {
      const value = (windowInstance as unknown as Record<string, unknown>)[ctorName];
      if (value !== undefined) {
        setGlobalProperty(savedGlobals, ctorName, value);
      }
    }

    setGlobalProperty(
      savedGlobals,
      'getComputedStyle',
      windowInstance.getComputedStyle.bind(windowInstance)
    );

    if (stubResizeObserver) {
      setGlobalProperty(
        savedGlobals,
        'ResizeObserver',
        class ResizeObserver {
          observe() {}
          unobserve() {}
          disconnect() {}
        }
      );
    }

    if (stubIntersectionObserver) {
      setGlobalProperty(
        savedGlobals,
        'IntersectionObserver',
        class IntersectionObserver {
          observe() {}
          unobserve() {}
          disconnect() {}
          takeRecords() {
            return [];
          }
        }
      );
    }

    setGlobalProperty(savedGlobals, 'matchMedia', matchMedia);
    (windowInstance as unknown as Record<string, unknown>).matchMedia = matchMedia;

    let rafIdCounter = 1;
    const rafCallback = (cb: FrameRequestCallback) => {
      const id = rafIdCounter++;
      const timer = setTimeout(() => {
        rafTimers.delete(id);
        cb(performance.now());
      }, rafIntervalMs);
      rafTimers.set(id, timer);
      return id;
    };
    const cancelRafCallback = (id: number) => {
      const timer = rafTimers.get(id);
      if (timer) {
        clearTimeout(timer);
        rafTimers.delete(id);
      }
    };

    setGlobalProperty(savedGlobals, 'requestAnimationFrame', rafCallback);
    setGlobalProperty(savedGlobals, 'cancelAnimationFrame', cancelRafCallback);
    (windowInstance as unknown as Record<string, unknown>).requestAnimationFrame = rafCallback;
    (windowInstance as unknown as Record<string, unknown>).cancelAnimationFrame = cancelRafCallback;

    if (fetchImpl) {
      setGlobalProperty(savedGlobals, 'fetch', fetchImpl);
    }

    const htmlProto = windowInstance.HTMLElement.prototype as unknown as Record<string, unknown>;
    if (disableElementAnimate) {
      htmlProto.animate = undefined;
      (windowInstance.Element.prototype as unknown as Record<string, unknown>).animate = undefined;
    }

    if (stubScrollIntoView && !htmlProto.scrollIntoView) {
      htmlProto.scrollIntoView = () => {};
    }

    if (stubMediaPlayback) {
      const videoProto = (windowInstance as unknown as {
        HTMLMediaElement?: { prototype?: Record<string, unknown> };
      }).HTMLMediaElement?.prototype;
      if (videoProto) {
        videoProto.play = () => Promise.resolve();
        videoProto.pause = () => {};
        videoProto.load = () => {};
      }
    }

    if (beforeReactImport) {
      beforeReactImport({
        window: windowInstance,
        document: doc,
        registerCleanup,
      });
    }

    // Importar React e React DOM somente após o ambiente DOM estar completamente pronto
    const reactModule = await import('react');
    const reactDomClient = await import('react-dom/client');
    const React = reactModule.default;
    const { act, Profiler } = reactModule;
    const { createRoot } = reactDomClient;
    loadedAct = act;

    const createTrackedRoot = (existingHost?: HTMLDivElement): TrackedReactRoot => {
      const createdHost = !existingHost;
      const host = existingHost ?? doc.createElement('div');
      const attachedByHelper = !host.parentNode;
      if (attachedByHelper) {
        doc.body.appendChild(host);
      }

      let root: Root;
      try {
        root = createRoot(host);
      } catch (err) {
        if (createdHost || attachedByHelper) {
          host.remove();
        }
        throw err;
      }

      let isUnmounted = false;
      let unmountPromise: Promise<void> | null = null;

      const tracked: TrackedReactRoot = {
        host,
        root,
        unmount: async () => {
          if (unmountPromise) {
            return unmountPromise;
          }
          if (isUnmounted) return;
          isUnmounted = true;
          unmountPromise = (async () => {
            try {
              if (loadedAct) {
                await loadedAct(async () => {
                  root.unmount();
                });
              } else {
                root.unmount();
              }
            } finally {
              activeRoots.delete(tracked);
              host.remove();
            }
          })();
          return unmountPromise;
        },
        unmountSync: () => {
          if (isUnmounted) return;
          isUnmounted = true;
          try {
            if (loadedAct) {
              loadedAct(() => {
                root.unmount();
              });
            } else {
              root.unmount();
            }
          } finally {
            activeRoots.delete(tracked);
            host.remove();
          }
        },
      };

      activeRoots.add(tracked);
      return tracked;
    };

    return {
      window: windowInstance,
      document: doc,
      React,
      act,
      Profiler,
      createTrackedRoot,
      unmountAllRoots,
      registerCleanup,
      clearRafTimers,
      clearWatchdog,
      dispose,
    };
  } catch (initError) {
    const cleanupErrors = await dispose();
    if (cleanupErrors.length > 0) {
      console.error(
        `[${watchdogLabel}] Erros adicionais durante limpeza de falha de inicialização:`,
        cleanupErrors
      );
    }
    throw initError;
  }
}
