import assert from 'node:assert';
import { createDomTestEnv } from './helpers/domEnv';

const TOTAL_CASES = 8;

const rawCaseFilter = process.env.NC_FULLSCREEN_EXIT_CASE?.trim();
let selectedCaseNumber: number | null = null;
if (rawCaseFilter) {
  const parsed = Number.parseInt(rawCaseFilter, 10);
  if (!/^\d+$/.test(rawCaseFilter) || parsed < 1 || parsed > TOTAL_CASES) {
    console.error(
      `FALHA em test-fullscreen-exit: filtro inválido NC_FULLSCREEN_EXIT_CASE="${rawCaseFilter}". Informe um número inteiro entre 1 e ${TOTAL_CASES}.`
    );
    process.exit(1);
  }
  selectedCaseNumber = parsed;
}

// ============================================================================
// 1. Estado determinístico de mídia e Fullscreen API
// ============================================================================
let videoLoadCount = 0;
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

function setNativeFullscreenElement(el: Element | null, dispatchEvent = true) {
  currentFullscreenElement = el;
  if (dispatchEvent) {
    document.dispatchEvent(new Event('fullscreenchange'));
  }
}

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

// ============================================================================
// 2. Ambiente DOM compartilhado (happy-dom) + importação tardia de React
// ============================================================================
const env = await createDomTestEnv({
  url: 'http://localhost:3000',
  width: 1280,
  height: 720,
  watchdogMs: 20000,
  watchdogLabel: 'test-fullscreen-exit',
  rafIntervalMs: 16,
  disableElementAnimate: true,
  stubScrollIntoView: true,
  stubMediaPlayback: false,
  beforeReactImport: ({ window: win, document: doc }) => {
    // Stub determinístico para métodos de mídia em HTMLVideoElement
    const videoProto = (win as any).HTMLMediaElement?.prototype;
    if (videoProto) {
      videoProto.play = function () {
        return Promise.resolve();
      };
      videoProto.pause = function () {};
      videoProto.load = function () {
        videoLoadCount += 1;
      };
    }

    // Controle determinístico de Fullscreen API no document / container
    Object.defineProperty(doc, 'fullscreenElement', {
      configurable: true,
      get: () => currentFullscreenElement,
    });

    (win.HTMLElement.prototype as any).requestFullscreen = function () {
      requestFullscreenCalls += 1;
      const target = this as Element;
      if (requestMode === 'deferred') {
        const def = createDeferred<void>();
        lastRequestDeferred = def;
        return def.promise;
      }
      currentFullscreenElement = target;
      doc.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    };

    (doc as any).exitFullscreen = function () {
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
      doc.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    };
  },
});

const { React, act } = env;
const { useRef, useState } = React;

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
let MotionConfig!: (typeof import('motion/react'))['MotionConfig'];
let VideoPlayer!: (typeof import('../src/components/VideoPlayer'))['VideoPlayer'];
let NavigationProvider!: (typeof import('../src/navigation'))['NavigationProvider'];
let useBackHandler!: (typeof import('../src/navigation'))['useBackHandler'];
let BACK_PRIORITY!: (typeof import('../src/navigation'))['BACK_PRIORITY'];
let setNavMode!: (typeof import('../src/navigation'))['setNavMode'];
let setCapacitorAppBridgeForTest!: (typeof import('../src/navigation'))['setCapacitorAppBridgeForTest'];
let clearAllBackHandlersForTest!: (typeof import('../src/navigation'))['clearAllBackHandlersForTest'];
let invalidateCandidateCache!: (typeof import('../src/navigation'))['invalidateCandidateCache'];

try {
  ({ MotionConfig } = await import('motion/react'));
  ({ VideoPlayer } = await import('../src/components/VideoPlayer'));
  ({
    NavigationProvider,
    useBackHandler,
    BACK_PRIORITY,
    setNavMode,
    setCapacitorAppBridgeForTest,
    clearAllBackHandlersForTest,
    invalidateCandidateCache,
  } = await import('../src/navigation'));
} catch (importError) {
  const cleanupErrors = await env.dispose();
  if (cleanupErrors.length > 0) {
    console.error('Erros adicionais ao limpar ambiente após falha de importação:', cleanupErrors);
  }
  throw importError;
}

env.registerCleanup(() => {
  setCapacitorAppBridgeForTest(null);
  clearAllBackHandlersForTest();
  invalidateCandidateCache();
  resetFullscreenMocks();
});

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

  const tracked = env.createTrackedRoot();
  const { root } = tracked;

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
      await tracked.unmount();
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
  const startedAt = Date.now();
  let caseIndex = 0;
  let passed = 0;
  let skipped = 0;
  const runCase = async (name: string, fn: () => Promise<void>) => {
    caseIndex += 1;
    if (selectedCaseNumber !== null && caseIndex !== selectedCaseNumber) {
      skipped += 1;
      return;
    }
    let caseError: unknown = null;
    try {
      await fn();
    } catch (err) {
      caseError = err;
    } finally {
      const unmountErrors = await env.unmountAllRoots();
      setCapacitorAppBridgeForTest(null);
      clearAllBackHandlersForTest();
      invalidateCandidateCache();
      resetFullscreenMocks();
      if (!caseError && unmountErrors.length > 0) {
        caseError = unmountErrors[0];
      }
    }
    if (caseError) {
      throw caseError;
    }
    passed += 1;
    console.log(`  [OK] [Caso ${caseIndex}/${TOTAL_CASES}] ${name}`);
  };

  if (selectedCaseNumber !== null) {
    console.log(
      `Executando suite direcionada de saída de tela cheia (test-fullscreen-exit) — filtro PARCIAL NC_FULLSCREEN_EXIT_CASE=${selectedCaseNumber}/${TOTAL_CASES}...`
    );
  } else {
    console.log('Executando suite direcionada de saída de tela cheia (test-fullscreen-exit)...');
  }

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

  if (caseIndex !== TOTAL_CASES) {
    throw new Error(
      `Contagem esperada de blocos em test-fullscreen-exit (${TOTAL_CASES}) diverge da executada (${caseIndex}).`
    );
  }

  return {
    passed,
    skipped,
    durationMs: Date.now() - startedAt,
  };
}

let runError: unknown = null;
let summary: { passed: number; skipped: number; durationMs: number } | null = null;

try {
  summary = await runTests();
} catch (err) {
  runError = err;
}

const teardownErrors = await env.dispose();

if (runError) {
  console.error('FALHA em test-fullscreen-exit:', runError);
  if (teardownErrors.length > 0) {
    console.error('Erros adicionais durante teardown em test-fullscreen-exit:', teardownErrors);
  }
  process.exitCode = 1;
} else if (teardownErrors.length > 0) {
  console.error('FALHA durante teardown em test-fullscreen-exit:', teardownErrors);
  process.exitCode = 1;
} else if (summary) {
  if (selectedCaseNumber !== null) {
    console.log(
      `\nSucesso PARCIAL (filtro NC_FULLSCREEN_EXIT_CASE=${selectedCaseNumber}): ${summary.passed} bloco executado (${summary.skipped} ignorados de ${TOTAL_CASES}) em ${summary.durationMs}ms — test-fullscreen-exit.`
    );
  } else {
    console.log(
      `\nSucesso: ${summary.passed}/${TOTAL_CASES} blocos de cenários (10 cenários obrigatórios + cancelamento precoce) passaram em ${summary.durationMs}ms — test-fullscreen-exit.`
    );
  }
}
