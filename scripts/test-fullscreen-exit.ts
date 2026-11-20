import assert from 'node:assert';
import { Window } from 'happy-dom';
import React, { act, useRef, useState } from 'react';
import { createRoot, Root } from 'react-dom/client';

// Watchdog de segurança para evitar travamentos em ambiente simulado
const watchdog = setTimeout(() => {
  console.error('TIMEOUT: test-fullscreen-exit excedeu 20s');
  process.exit(1);
}, 20000);
watchdog.unref();

// ============================================================================
// 1. Ambiente DOM enxuto e determinístico (happy-dom)
// ============================================================================
const windowInstance = new Window({
  url: 'http://localhost:3000',
  width: 1280,
  height: 720,
});

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).window = windowInstance;
(globalThis as any).document = windowInstance.document;
Object.defineProperty(globalThis, 'navigator', {
  value: windowInstance.navigator,
  writable: true,
  configurable: true,
});
(globalThis as any).HTMLElement = windowInstance.HTMLElement;
(globalThis as any).HTMLButtonElement = windowInstance.HTMLButtonElement;
(globalThis as any).HTMLVideoElement = windowInstance.HTMLVideoElement;
(globalThis as any).Element = windowInstance.Element;
(globalThis as any).Node = windowInstance.Node;
(globalThis as any).SVGElement = windowInstance.SVGElement;
(globalThis as any).Event = windowInstance.Event;
(globalThis as any).CustomEvent = windowInstance.CustomEvent;
(globalThis as any).KeyboardEvent = windowInstance.KeyboardEvent;
(globalThis as any).MouseEvent = windowInstance.MouseEvent;
(globalThis as any).MutationObserver = windowInstance.MutationObserver;
(globalThis as any).localStorage = windowInstance.localStorage;
(globalThis as any).sessionStorage = windowInstance.sessionStorage;
(globalThis as any).URL = windowInstance.URL;
(globalThis as any).Blob = windowInstance.Blob;
(globalThis as any).getComputedStyle = windowInstance.getComputedStyle.bind(windowInstance);

(globalThis as any).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

(globalThis as any).IntersectionObserver = class IntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
};

const matchMediaStub = (query: string) => ({
  matches: query.includes('prefers-reduced-motion'),
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
});
(globalThis as any).matchMedia = matchMediaStub;
(windowInstance as any).matchMedia = matchMediaStub;

let rafIdCounter = 1;
const rafTimers = new Map<number, NodeJS.Timeout>();
const rafCallback = (cb: FrameRequestCallback) => {
  const id = rafIdCounter++;
  const timer = setTimeout(() => {
    rafTimers.delete(id);
    cb(performance.now());
  }, 16);
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
(globalThis as any).requestAnimationFrame = rafCallback;
(windowInstance as any).requestAnimationFrame = rafCallback;
(globalThis as any).cancelAnimationFrame = cancelRafCallback;
(windowInstance as any).cancelAnimationFrame = cancelRafCallback;

// Evitar WAAPI no happy-dom (motion/react)
const htmlProto = windowInstance.HTMLElement.prototype as any;
htmlProto.animate = undefined;
if (!htmlProto.scrollIntoView) {
  htmlProto.scrollIntoView = () => {};
}

// Stub determinístico para métodos de mídia em HTMLVideoElement
const videoProto = windowInstance.HTMLMediaElement?.prototype as any;
let videoLoadCount = 0;
if (videoProto) {
  videoProto.play = function () {
    return Promise.resolve();
  };
  videoProto.pause = function () {};
  videoProto.load = function () {
    videoLoadCount += 1;
  };
}

// ============================================================================
// 2. Controle determinístico de Fullscreen API no document / container
// ============================================================================
let currentFullscreenElement: Element | null = null;
let requestFullscreenCalls = 0;
let exitFullscreenCalls = 0;

interface Deferred<T = void> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type ExitMode =
  | 'immediate-promise'
  | 'deferred'
  | 'reject-keep-fs';

let exitMode: ExitMode = 'immediate-promise';
let lastExitDeferred: Deferred<void> | null = null;
let lastRequestDeferred: Deferred<void> | null = null;
let requestMode: 'immediate-promise' | 'deferred' = 'immediate-promise';

Object.defineProperty(windowInstance.document, 'fullscreenElement', {
  configurable: true,
  get: () => currentFullscreenElement,
});

function setNativeFullscreenElement(el: Element | null, dispatchEvent = true) {
  currentFullscreenElement = el;
  if (dispatchEvent) {
    document.dispatchEvent(new Event('fullscreenchange'));
  }
}

(windowInstance.HTMLElement.prototype as any).requestFullscreen = function () {
  requestFullscreenCalls += 1;
  const target = this as Element;
  if (requestMode === 'deferred') {
    const def = createDeferred<void>();
    lastRequestDeferred = def;
    return def.promise;
  }
  currentFullscreenElement = target;
  document.dispatchEvent(new Event('fullscreenchange'));
  return Promise.resolve();
};

(windowInstance.document as any).exitFullscreen = function () {
  exitFullscreenCalls += 1;
  if (exitMode === 'deferred') {
    const def = createDeferred<void>();
    lastExitDeferred = def;
    return def.promise;
  }
  if (exitMode === 'reject-keep-fs') {
    return Promise.reject(new Error('Simulated native exitFullscreen failure'));
  }
  currentFullscreenElement = null;
  document.dispatchEvent(new Event('fullscreenchange'));
  return Promise.resolve();
};

function resetFullscreenMocks() {
  currentFullscreenElement = null;
  requestFullscreenCalls = 0;
  exitFullscreenCalls = 0;
  exitMode = 'immediate-promise';
  requestMode = 'immediate-promise';
  lastExitDeferred = null;
  lastRequestDeferred = null;
  videoLoadCount = 0;
}

async function flushMicrotasks(ticks = 4): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// ============================================================================
// 3. Importações tardias após bootstrap do DOM
// ============================================================================
const { MotionConfig } = await import('motion/react');
const { VideoPlayer } = await import('../src/components/VideoPlayer');
const {
  NavigationProvider,
  useBackHandler,
  BACK_PRIORITY,
  setNavMode,
  setCapacitorAppBridgeForTest,
} = await import('../src/navigation');
type VideoPlayerHandle = import('../src/components/player/types').VideoPlayerHandle;

interface ChannelItem {
  id: string;
  streamId: string;
  name: string;
  url: string;
}

const CHANNELS: ChannelItem[] = [
  { id: 'ch-1', streamId: '101', name: 'Canal Um HD', url: '' },
  { id: 'ch-2', streamId: '102', name: 'Canal Dois HD', url: '' },
];

interface HarnessApi {
  selectChannel: (id: string) => void;
  closePreview: () => void;
  getPreviewOpen: () => boolean;
  getCloseCount: () => number;
  getSelectedChannelId: () => string | null;
  getPlayerHandle: () => VideoPlayerHandle | null;
  getContainer: () => HTMLElement | null;
  getVideoElement: () => HTMLVideoElement | null;
  getChannelButton: (id: string) => HTMLButtonElement | null;
}

function createLivePreviewHarness(onReady: (api: HarnessApi) => void) {
  return function LivePreviewHarness() {
    const [selectedChannelId, setSelectedChannelId] = useState<string | null>('ch-1');
    const selectedChannelIdRef = useRef<string | null>('ch-1');
    const closeCountRef = useRef(0);
    const playerRef = useRef<VideoPlayerHandle | null>(null);

    const activeChannel = CHANNELS.find((c) => c.id === selectedChannelId) ?? null;

    const closePreview = () => {
      closeCountRef.current += 1;
      selectedChannelIdRef.current = null;
      setSelectedChannelId(null);
    };

    const handleChannelActivate = (channel: ChannelItem) => {
      if (selectedChannelIdRef.current === channel.id) {
        void playerRef.current?.requestFullscreenImmediate();
        return;
      }
      selectedChannelIdRef.current = channel.id;
      setSelectedChannelId(channel.id);
    };

    // Espelha LiveTvView: BACK_PRIORITY.VIEW_INTERNAL fecha o preview se FULLSCREEN_PLAYER não consumir
    useBackHandler(
      'live-tv-view-harness',
      BACK_PRIORITY.VIEW_INTERNAL,
      () => {
        if (selectedChannelIdRef.current) {
          closePreview();
          return true;
        }
        return false;
      },
      Boolean(selectedChannelId)
    );

    onReady({
      selectChannel: (id: string) => {
        selectedChannelIdRef.current = id;
        setSelectedChannelId(id);
      },
      closePreview,
      getPreviewOpen: () => selectedChannelIdRef.current !== null,
      getCloseCount: () => closeCountRef.current,
      getSelectedChannelId: () => selectedChannelIdRef.current,
      getPlayerHandle: () => playerRef.current,
      getContainer: () => document.querySelector<HTMLElement>('[data-player-container="true"]'),
      getVideoElement: () => document.querySelector<HTMLVideoElement>('video'),
      getChannelButton: (id: string) =>
        document.querySelector<HTMLButtonElement>(`button[data-live-channel-id="${id}"]`),
    });

    return React.createElement(
      'div',
      { id: 'live-tv-harness' },
      React.createElement(
        'div',
        { 'data-testid': 'channel-list' },
        CHANNELS.map((ch) =>
          React.createElement(
            'button',
            {
              key: ch.id,
              type: 'button',
              'data-live-channel-id': ch.id,
              'data-live-channel-origin': selectedChannelId === ch.id ? 'true' : undefined,
              'data-live-channel-selected': selectedChannelId === ch.id ? 'true' : undefined,
              onClick: () => handleChannelActivate(ch),
            },
            ch.name
          )
        )
      ),
      activeChannel
        ? React.createElement(VideoPlayer, {
            playerRef,
            embedded: true,
            disableEmbeddedControlsFocus: true,
            streamUrl: activeChannel.url,
            streamId: activeChannel.streamId,
            channelName: activeChannel.name,
            title: activeChannel.name,
            contentType: 'live',
            onBack: closePreview,
          })
        : null
    );
  };
}

interface MountedHarness {
  api: HarnessApi;
  fireCapacitorBack: () => void;
  unmount: () => Promise<void>;
}

async function mountHarness(options: { withCapacitorBridge?: boolean } = {}): Promise<MountedHarness> {
  resetFullscreenMocks();
  setNavMode('remote');

  let capacitorBackListener: ((event: { canGoBack: boolean }) => void) | null = null;
  if (options.withCapacitorBridge) {
    setCapacitorAppBridgeForTest({
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      addListener: (_eventName, listenerFunc) => {
        capacitorBackListener = listenerFunc;
        return Promise.resolve({
          remove: async () => {
            capacitorBackListener = null;
          },
        });
      },
      exitApp: () => {},
    });
  } else {
    setCapacitorAppBridgeForTest(null);
  }

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);

  let latestApi!: HarnessApi;
  const HarnessComponent = createLivePreviewHarness((api) => {
    latestApi = api;
  });

  await act(async () => {
    root.render(
      React.createElement(
        MotionConfig,
        { reducedMotion: 'always' },
        React.createElement(
          NavigationProvider,
          null,
          React.createElement(HarnessComponent)
        )
      )
    );
  });
  await flushMicrotasks();

  return {
    api: new Proxy({} as HarnessApi, {
      get: (_target, prop) => (latestApi as any)[prop],
    }),
    fireCapacitorBack: () => {
      assert.ok(capacitorBackListener, 'Listener Capacitor backButton deveria estar registrado');
      capacitorBackListener({ canGoBack: true });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      host.remove();
      setCapacitorAppBridgeForTest(null);
    },
  };
}

function dispatchKey(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

// ============================================================================
// 4. Casos de teste direcionados (10 cenários obrigatórios)
// ============================================================================
async function runTests() {
  let passed = 0;
  const runCase = async (name: string, fn: () => Promise<void>) => {
    await fn();
    passed += 1;
    console.log(`  [OK] ${name}`);
  };

  console.log('Executando suite direcionada de saída de tela cheia (test-fullscreen-exit)...');

  // Cenário 1, 2, 3 e 9: 2º OK imediato, 1º Back volta ao preview sem recarregar vídeo e restaura foco no canal correto
  await runCase(
    '1/2/3/9. 2º OK entra em tela cheia imediatamente, 1º Back sai síncrono ao preview sem desmontar vídeo e restaura foco no canal de origem',
    async () => {
      const h = await mountHarness({ withCapacitorBridge: true });
      try {
        const ch1Btn = h.api.getChannelButton('ch-1')!;
        const initialVideo = h.api.getVideoElement();
        assert.ok(ch1Btn, 'Botão do canal 1 deve existir');
        assert.ok(initialVideo, 'Elemento <video> deve existir no preview');
        assert.strictEqual(h.api.getContainer()?.getAttribute('data-player-presentation'), 'compact-preview');

        // 2º OK no canal já selecionado chama requestFullscreenImmediate de forma síncrona
        act(() => {
          ch1Btn.click();
        });
        assert.strictEqual(requestFullscreenCalls, 1, 'requestFullscreen deve ser chamado sincronamente no 2º OK');
        await flushMicrotasks();
        assert.strictEqual(h.api.getContainer()?.getAttribute('data-player-presentation'), 'full-layer');

        // 1º Back via Capacitor Android TV backButton dispara exitFullscreen imediatamente (síncrono)
        const loadsBeforeExit = videoLoadCount;
        act(() => {
          h.fireCapacitorBack();
        });
        assert.strictEqual(exitFullscreenCalls, 1, 'document.exitFullscreen deve ser chamado sincronamente no 1º Back');
        await flushMicrotasks();

        assert.strictEqual(h.api.getContainer()?.getAttribute('data-player-presentation'), 'compact-preview');
        assert.strictEqual(h.api.getPreviewOpen(), true, 'Preview deve continuar aberto após 1º Back');
        assert.strictEqual(h.api.getCloseCount(), 0, 'Preview não deve ter sido fechado');
        assert.strictEqual(h.api.getVideoElement(), initialVideo, 'Elemento <video> não deve ser desmontado/remontado');
        assert.strictEqual(videoLoadCount, loadsBeforeExit, 'Vídeo não deve ser recarregado ao sair da tela cheia');
        assert.strictEqual(
          document.activeElement,
          ch1Btn,
          'Foco deve retornar exatamente ao botão do canal de origem (ch-1)'
        );
      } finally {
        await h.unmount();
      }
    }
  );

  // Cenário 4 e 5: Back duplo rápido durante transição pendente + Promise lenta não fecha preview nem duplica exitFullscreen; Back posterior fecha preview
  await runCase(
    '4/5. Back rápido duplicado durante Promise lenta de exitFullscreen não fecha preview nem duplica chamada nativa; Back após conclusão fecha preview',
    async () => {
      const h = await mountHarness({ withCapacitorBridge: true });
      try {
        const ch1Btn = h.api.getChannelButton('ch-1')!;
        act(() => {
          ch1Btn.click();
        });
        await flushMicrotasks();
        assert.strictEqual(h.api.getContainer()?.getAttribute('data-player-presentation'), 'full-layer');

        // Simula saída nativa lenta (Android WebView demorando para resolver Promise e disparar fullscreenchange)
        exitMode = 'deferred';

        act(() => {
          h.fireCapacitorBack();
          h.fireCapacitorBack();
          dispatchKey('Escape');
        });
        await flushMicrotasks();

        assert.strictEqual(exitFullscreenCalls, 1, 'exitFullscreen não pode ser duplicado durante saída pendente');
        assert.strictEqual(h.api.getPreviewOpen(), true, 'Back repetido durante transição não pode fechar o preview');
        assert.strictEqual(h.api.getCloseCount(), 0, 'LiveTvView.VIEW_INTERNAL não pode ser acionado durante saída');
        assert.strictEqual(
          h.api.getContainer()?.getAttribute('data-player-presentation'),
          'full-layer',
          'Não deve fingir saída concluída enquanto document.fullscreenElement ainda está ativo'
        );
        assert.strictEqual(
          h.api.getPlayerHandle()?.isFullscreenOrPending(),
          true,
          'isFullscreenOrPending deve permanecer verdadeiro durante saída pendente'
        );

        // Conclui saída nativa
        await act(async () => {
          setNativeFullscreenElement(null, true);
          lastExitDeferred?.resolve();
        });
        await flushMicrotasks();

        assert.strictEqual(h.api.getContainer()?.getAttribute('data-player-presentation'), 'compact-preview');
        assert.strictEqual(h.api.getPreviewOpen(), true);
        assert.strictEqual(document.activeElement, ch1Btn);

        // Agora sim, um Back posterior (após conclusão) deve preservar o comportamento de fechar o preview
        act(() => {
          h.fireCapacitorBack();
        });
        await flushMicrotasks();
        assert.strictEqual(h.api.getPreviewOpen(), false, '2º Back após saída concluída deve fechar o preview');
        assert.strictEqual(h.api.getCloseCount(), 1);
      } finally {
        await h.unmount();
      }
    }
  );

  // Cenário 6a: fullscreenchange chega ANTES da resolução da Promise de exitFullscreen
  await runCase(
    '6a. fullscreenchange antes da resolução da Promise conclui retorno ao preview e foco imediatamente sem esperar Promise atrasada',
    async () => {
      const h = await mountHarness({ withCapacitorBridge: true });
      try {
        const ch1Btn = h.api.getChannelButton('ch-1')!;
        act(() => {
          ch1Btn.click();
        });
        await flushMicrotasks();

        exitMode = 'deferred';
        act(() => {
          h.fireCapacitorBack();
        });
        assert.strictEqual(exitFullscreenCalls, 1);

        // Dispara fullscreenchange ANTES da Promise de exitFullscreen resolver!
        await act(async () => {
          setNativeFullscreenElement(null, true);
        });
        await flushMicrotasks();

        assert.strictEqual(
          h.api.getContainer()?.getAttribute('data-player-presentation'),
          'compact-preview',
          'Deve sair de full-layer imediatamente ao receber fullscreenchange sem esperar Promise atrasada'
        );
        assert.strictEqual(
          document.activeElement,
          ch1Btn,
          'Foco deve retornar ao canal de origem imediatamente após fullscreenchange'
        );
        assert.strictEqual(h.api.getPreviewOpen(), true);

        // Quando a Promise atrasada finalmente resolve depois, não gera efeitos colaterais
        await act(async () => {
          lastExitDeferred?.resolve();
        });
        await flushMicrotasks();
        assert.strictEqual(h.api.getContainer()?.getAttribute('data-player-presentation'), 'compact-preview');
        assert.strictEqual(h.api.getPreviewOpen(), true);
        assert.strictEqual(h.api.getCloseCount(), 0);
      } finally {
        await h.unmount();
      }
    }
  );

  // Cenário 6b: Promise resolve ANTES do fullscreenchange
  await runCase(
    '6b. Promise de exitFullscreen resolvendo antes do fullscreenchange conclui saída limpa e evento posterior é idempotente',
    async () => {
      const h = await mountHarness({ withCapacitorBridge: true });
      try {
        const ch1Btn = h.api.getChannelButton('ch-1')!;
        act(() => {
          ch1Btn.click();
        });
        await flushMicrotasks();

        exitMode = 'deferred';
        act(() => {
          h.fireCapacitorBack();
        });

        // Limpa fullscreenElement e resolve Promise antes do evento fullscreenchange
        await act(async () => {
          setNativeFullscreenElement(null, false);
          lastExitDeferred?.resolve();
        });
        await flushMicrotasks();

        assert.strictEqual(h.api.getContainer()?.getAttribute('data-player-presentation'), 'compact-preview');
        assert.strictEqual(document.activeElement, ch1Btn);

        // Evento fullscreenchange atrasado chega depois
        await act(async () => {
          document.dispatchEvent(new Event('fullscreenchange'));
        });
        await flushMicrotasks();

        assert.strictEqual(h.api.getContainer()?.getAttribute('data-player-presentation'), 'compact-preview');
        assert.strictEqual(h.api.getPreviewOpen(), true);
        assert.strictEqual(h.api.getCloseCount(), 0);
      } finally {
        await h.unmount();
      }
    }
  );

  // Cenário 7: Falha/rejeição de exitFullscreen mantém estado honesto e permite retry
  await runCase(
    '7. Falha/rejeição de exitFullscreen com fullscreen ativo mantém full-layer, não fecha preview e destrava nova tentativa',
    async () => {
      const h = await mountHarness({ withCapacitorBridge: true });
      try {
        const ch1Btn = h.api.getChannelButton('ch-1')!;
        act(() => {
          ch1Btn.click();
        });
        await flushMicrotasks();

        exitMode = 'reject-keep-fs';
        act(() => {
          h.fireCapacitorBack();
        });
        await flushMicrotasks();

        assert.strictEqual(exitFullscreenCalls, 1);
        assert.strictEqual(
          h.api.getContainer()?.getAttribute('data-player-presentation'),
          'full-layer',
          'Com falha nativa e fullscreenElement ativo, player deve permanecer em full-layer'
        );
        assert.strictEqual(h.api.getPreviewOpen(), true, 'Falha na saída não deve fechar o preview');
        assert.strictEqual(h.api.getCloseCount(), 0);

        // Retry após falha deve funcionar normalmente (lock liberado)
        exitMode = 'immediate-promise';
        act(() => {
          h.fireCapacitorBack();
        });
        await flushMicrotasks();
        assert.strictEqual(exitFullscreenCalls, 2);
        assert.strictEqual(h.api.getContainer()?.getAttribute('data-player-presentation'), 'compact-preview');
        assert.strictEqual(document.activeElement, ch1Btn);
      } finally {
        await h.unmount();
      }
    }
  );

  // Cenário 8: Troca de canal durante transição pendente cancela restauração de foco obsoleta
  await runCase(
    '8. Troca de canal durante saída pendente cancela restauração de foco no canal anterior',
    async () => {
      const h = await mountHarness({ withCapacitorBridge: true });
      try {
        const ch1Btn = h.api.getChannelButton('ch-1')!;
        const ch2Btn = h.api.getChannelButton('ch-2')!;
        act(() => {
          ch1Btn.click();
        });
        await flushMicrotasks();

        exitMode = 'deferred';
        act(() => {
          h.fireCapacitorBack();
        });

        // Usuário/sistema troca para o canal 2 antes da saída terminar
        act(() => {
          h.api.selectChannel('ch-2');
        });
        await flushMicrotasks();
        ch2Btn.focus();
        assert.strictEqual(document.activeElement, ch2Btn);

        // Saída do canal 1 conclui agora
        await act(async () => {
          setNativeFullscreenElement(null, true);
          lastExitDeferred?.resolve();
        });
        await flushMicrotasks();

        assert.strictEqual(h.api.getContainer()?.getAttribute('data-player-presentation'), 'compact-preview');
        assert.strictEqual(
          document.activeElement,
          ch2Btn,
          'Não deve roubar o foco de volta para o canal antigo (ch-1) após troca para ch-2'
        );
      } finally {
        await h.unmount();
      }
    }
  );

  // Cenário 10: Fluxo Web (teclado Escape/GoBack + saída nativa iniciada pelo navegador via fullscreenchange)
  await runCase(
    '10. Fluxo Web: Escape via teclado e saída nativa iniciada pelo navegador (fullscreenchange direto) retornam ao preview preservando vídeo e foco',
    async () => {
      const h = await mountHarness({ withCapacitorBridge: false });
      try {
        const ch1Btn = h.api.getChannelButton('ch-1')!;
        const initialVideo = h.api.getVideoElement();

        // Fluxo Web A: Escape capturado pelo NavigationProvider -> VideoPlayer
        act(() => {
          ch1Btn.click();
        });
        await flushMicrotasks();
        assert.strictEqual(h.api.getContainer()?.getAttribute('data-player-presentation'), 'full-layer');

        act(() => {
          dispatchKey('Escape');
        });
        await flushMicrotasks();
        assert.strictEqual(exitFullscreenCalls, 1);
        assert.strictEqual(h.api.getContainer()?.getAttribute('data-player-presentation'), 'compact-preview');
        assert.strictEqual(h.api.getPreviewOpen(), true);
        assert.strictEqual(h.api.getVideoElement(), initialVideo);
        assert.strictEqual(document.activeElement, ch1Btn);

        // Fluxo Web B: Navegador intercepta Escape diretamente e dispara apenas fullscreenchange sem handleBack
        act(() => {
          ch1Btn.click();
        });
        await flushMicrotasks();
        assert.strictEqual(h.api.getContainer()?.getAttribute('data-player-presentation'), 'full-layer');

        await act(async () => {
          setNativeFullscreenElement(null, true);
        });
        await flushMicrotasks();

        assert.strictEqual(h.api.getContainer()?.getAttribute('data-player-presentation'), 'compact-preview');
        assert.strictEqual(h.api.getPreviewOpen(), true, 'Saída nativa pelo navegador não deve fechar preview');
        assert.strictEqual(h.api.getVideoElement(), initialVideo);
        assert.strictEqual(
          document.activeElement,
          ch1Btn,
          'Saída nativa via fullscreenchange em modo remote deve restaurar foco no canal de origem'
        );
      } finally {
        await h.unmount();
      }
    }
  );

  // Extra: Retorno rápido de entrada cancelada antes do native fullscreen engajar (sem chamadas nativas redundantes)
  await runCase(
    'Extra. Back pressionado imediatamente após 2º OK (entrada ainda pendente) cancela entrada sem vazar para LiveTvView',
    async () => {
      const h = await mountHarness({ withCapacitorBridge: true });
      try {
        const ch1Btn = h.api.getChannelButton('ch-1')!;
        requestMode = 'deferred';

        // 2º OK inicia entrada pendente (document.fullscreenElement ainda é null)
        act(() => {
          ch1Btn.click();
        });
        assert.strictEqual(requestFullscreenCalls, 1);

        // Back chega antes mesmo da Promise de entrada resolver
        act(() => {
          h.fireCapacitorBack();
        });
        await flushMicrotasks();

        assert.strictEqual(h.api.getPreviewOpen(), true, 'Back durante entrada pendente não deve fechar preview');
        assert.strictEqual(h.api.getCloseCount(), 0);
        assert.strictEqual(h.api.getContainer()?.getAttribute('data-player-presentation'), 'compact-preview');

        // Se a Promise de entrada resolver atrasada depois do cancelamento, não entra em tela cheia
        await act(async () => {
          const container = h.api.getContainer();
          if (container) {
            currentFullscreenElement = container;
          }
          lastRequestDeferred?.resolve();
        });
        await flushMicrotasks();
        assert.strictEqual(exitFullscreenCalls, 1, 'Entrada cancelada que completou atrasada deve chamar exitFullscreen');
        assert.strictEqual(h.api.getPreviewOpen(), true);
      } finally {
        await h.unmount();
      }
    }
  );

  clearTimeout(watchdog);
  console.log(`\nSucesso: ${passed} blocos de cenários (10 cenários obrigatórios + cancelamento precoce) passaram em test-fullscreen-exit.`);
  process.exit(0);
}

runTests().catch((err) => {
  clearTimeout(watchdog);
  console.error('FALHA em test-fullscreen-exit:', err);
  process.exit(1);
});
