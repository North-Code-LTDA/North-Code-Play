import assert from 'node:assert';
import { Window } from 'happy-dom';
import React, { act, Profiler } from 'react';
import { createRoot, Root } from 'react-dom/client';

// Watchdog de segurança para evitar travamentos em ambiente simulado
const watchdog = setTimeout(() => {
  console.error('TIMEOUT: test-live-tv-nav excedeu 25s');
  process.exit(1);
}, 25000);
watchdog.unref();

// ============================================================================
// 1. Ambiente DOM determinístico (happy-dom) com geometria realista de TV 720p
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
(globalThis as any).HTMLImageElement = windowInstance.HTMLImageElement;
(globalThis as any).Element = windowInstance.Element;
(globalThis as any).Node = windowInstance.Node;
(globalThis as any).SVGElement = windowInstance.SVGElement;
(globalThis as any).Event = windowInstance.Event;
(globalThis as any).CustomEvent = windowInstance.CustomEvent;
(globalThis as any).KeyboardEvent = windowInstance.KeyboardEvent;
(globalThis as any).MouseEvent = windowInstance.MouseEvent;
(globalThis as any).FocusEvent = windowInstance.FocusEvent;
(globalThis as any).MutationObserver = windowInstance.MutationObserver;
(globalThis as any).localStorage = windowInstance.localStorage;
(globalThis as any).sessionStorage = windowInstance.sessionStorage;
(globalThis as any).URL = windowInstance.URL;
(globalThis as any).Blob = windowInstance.Blob;
(globalThis as any).getComputedStyle = windowInstance.getComputedStyle.bind(windowInstance);

(globalThis as any).ResizeObserver = class ResizeObserver {
  private cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
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

const htmlProto = windowInstance.HTMLElement.prototype as any;
htmlProto.animate = undefined;
if (!htmlProto.scrollIntoView) {
  htmlProto.scrollIntoView = () => {};
}

const videoProto = windowInstance.HTMLMediaElement?.prototype as any;
if (videoProto) {
  videoProto.play = () => Promise.resolve();
  videoProto.pause = () => {};
  videoProto.load = () => {};
}

// Geometria sintética consistente para navegação espacial 2D em painel esquerdo 640x640
const origGetBoundingClientRect = htmlProto.getBoundingClientRect;
let gbrCounter = 0;

function getUiScaleFactor(): number {
  const raw = parseFloat(document.documentElement.style.getPropertyValue('--nc-ui-scale') || '');
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

htmlProto.getBoundingClientRect = function (this: HTMLElement) {
  gbrCounter += 1;
  const scale = getUiScaleFactor();
  const cardW = Math.round(268 * scale);
  const gap = Math.round(12 * scale);
  const stride = cardW + gap;
  const rowH = Math.round(148 * scale);

  if (this.getAttribute?.('data-showcase-rows-container') === 'true') {
    return {
      left: 0,
      top: 64,
      right: 640,
      bottom: 720,
      width: 640,
      height: 656,
      x: 0,
      y: 64,
      toJSON: () => ({}),
    };
  }

  if (this.getAttribute?.('data-live-category-row-scroll') === 'true') {
    const section = this.closest?.('[data-home-row-index]') as HTMLElement | null;
    const rowIdx = Number(section?.getAttribute('data-home-row-index') || 0);
    const scrollContainer = this.closest?.('[data-showcase-rows-container="true"]') as HTMLElement | null;
    const scrollTop = scrollContainer?.scrollTop || 0;
    const top = 64 + 16 + rowIdx * rowH - scrollTop + 28;
    return {
      left: 16,
      top,
      right: 624,
      bottom: top + Math.round(88 * scale),
      width: 608,
      height: Math.round(88 * scale),
      x: 16,
      y: top,
      toJSON: () => ({}),
    };
  }

  if (this.hasAttribute?.('data-home-row-index')) {
    const rowIdx = Number(this.getAttribute('data-home-row-index') || 0);
    const scrollContainer = this.closest?.('[data-showcase-rows-container="true"]') as HTMLElement | null;
    const scrollTop = scrollContainer?.scrollTop || 0;
    const top = 64 + 16 + rowIdx * rowH - scrollTop;
    return {
      left: 16,
      top,
      right: 624,
      bottom: top + rowH - 12,
      width: 608,
      height: rowH - 12,
      x: 16,
      y: top,
      toJSON: () => ({}),
    };
  }

  if (this.getAttribute?.('data-live-channel-card') === 'true') {
    const cardIdx = Number(this.getAttribute('data-virtual-index') || 0);
    const rowScroll = this.closest?.('[data-live-category-row-scroll="true"]') as HTMLElement | null;
    const section = this.closest?.('[data-home-row-index]') as HTMLElement | null;
    const rowIdx = Number(section?.getAttribute('data-home-row-index') || 0);
    const scrollContainer = this.closest?.('[data-showcase-rows-container="true"]') as HTMLElement | null;
    const scrollLeft = rowScroll?.scrollLeft || 0;
    const scrollTop = scrollContainer?.scrollTop || 0;
    const left = 16 + cardIdx * stride - scrollLeft;
    const top = 64 + 16 + rowIdx * rowH - scrollTop + 32;
    const height = Math.round(82 * scale);
    return {
      left,
      top,
      right: left + cardW,
      bottom: top + height,
      width: cardW,
      height,
      x: left,
      y: top,
      toJSON: () => ({}),
    };
  }

  if (
    this.getAttribute?.('data-live-channel-btn') === 'true' ||
    this.getAttribute?.('data-live-channel-fav') === 'true'
  ) {
    const isFav = this.getAttribute('data-live-channel-fav') === 'true';
    const cardEl = this.closest?.('[data-live-channel-card="true"]') as HTMLElement | null;
    const cardIdx = Number(cardEl?.getAttribute('data-virtual-index') || 0);
    const rowScroll = this.closest?.('[data-live-category-row-scroll="true"]') as HTMLElement | null;
    const section = this.closest?.('[data-home-row-index]') as HTMLElement | null;
    const rowIdx = Number(section?.getAttribute('data-home-row-index') || 0);
    const scrollContainer = this.closest?.('[data-showcase-rows-container="true"]') as HTMLElement | null;
    const scrollLeft = rowScroll?.scrollLeft || 0;
    const scrollTop = scrollContainer?.scrollTop || 0;
    const cardLeft = 16 + cardIdx * stride - scrollLeft;
    const top = 64 + 16 + rowIdx * rowH - scrollTop + 32;
    const height = Math.round(82 * scale);
    const favW = 36;
    const left = isFav ? cardLeft + cardW - favW - 6 : cardLeft;
    const width = isFav ? favW : cardW - favW - 8;
    return {
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      x: left,
      y: top,
      toJSON: () => ({}),
    };
  }

  return origGetBoundingClientRect.call(this);
};

Object.defineProperty(htmlProto, 'clientWidth', {
  configurable: true,
  get(this: HTMLElement) {
    if (this.getAttribute?.('data-live-category-row-scroll') === 'true') return 608;
    if (this.getAttribute?.('data-showcase-rows-container') === 'true') return 640;
    return 0;
  },
});

Object.defineProperty(htmlProto, 'clientHeight', {
  configurable: true,
  get(this: HTMLElement) {
    if (this.getAttribute?.('data-showcase-rows-container') === 'true') return 656;
    return 0;
  },
});

Object.defineProperty(htmlProto, 'offsetWidth', {
  configurable: true,
  get(this: HTMLElement) {
    if (this.getAttribute?.('data-live-channel-card') === 'true') {
      return Math.round(268 * getUiScaleFactor());
    }
    return 0;
  },
});

// ============================================================================
// 2. Importações após bootstrap DOM
// ============================================================================
const { setAndroidPlatformOverrideForDpadTest } = await import(
  '../src/navigation/navigationPlatformPolicy'
);
const {
  confirmDisplayPreferences,
  syncDocumentDisplayAttributes,
} = await import('../src/platform/tvEnvironment');
const {
  initPerformanceProfile,
  setPerformanceProfilePreference,
  resetPerformanceProfileCacheForTest,
} = await import('../src/platform/performanceProfile');
const {
  NavigationProvider,
  setNavMode,
  executeBackAction,
  focusElementSafely,
} = await import('../src/navigation');
const { XtreamCredentialsContext, XtreamLiveContext } = await import(
  '../src/context/XtreamContext'
);
const { LiveTvView } = await import('../src/views/LiveTvView');

// ============================================================================
// 3. Fábrica de catálogo realista (30 categorias, cat 1 com 120 canais, demais 35 canais)
// ============================================================================
function buildLargeLiveCatalog() {
  const liveCategories: Array<{ category_id: string; category_name: string; parent_id: number }> = [];
  const liveStreams: any[] = [];
  let streamId = 1000;

  for (let c = 0; c < 30; c++) {
    const catId = String(c + 1);
    liveCategories.push({
      category_id: catId,
      category_name: `Categoria ${String(c + 1).padStart(2, '0')}`,
      parent_id: 0,
    });
    const channelCount = c === 0 ? 120 : 35;
    for (let ch = 0; ch < channelCount; ch++) {
      streamId += 1;
      liveStreams.push({
        num: streamId,
        name: `Canal ${catId}-${String(ch + 1).padStart(3, '0')} HD`,
        stream_type: 'live',
        stream_id: streamId,
        stream_icon: '',
        epg_channel_id: '',
        added: '1700000000',
        category_id: catId,
        custom_sid: '',
        tv_archive: 0,
        direct_source: '',
        tv_archive_duration: 0,
      });
    }
  }

  return { liveCategories, liveStreams };
}

async function flush(ticks = 6): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const origPerfNow = performance.now.bind(performance);
let simulatedClockOffsetMs = 0;
performance.now = () => origPerfNow() + simulatedClockOffsetMs;

async function dispatchArrow(key: string, repeat = false): Promise<void> {
  if (repeat) {
    simulatedClockOffsetMs += 90;
  }
  await act(async () => {
    const ev = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      repeat,
    });
    document.dispatchEvent(ev);
  });
  await flush(3);
}

function resetEnv(isAndroid: boolean, mode: 'tv' | 'default', nav: 'remote' | 'pointer', perf: 'auto' | 'lite' | 'full') {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-performance-mode');
  document.documentElement.removeAttribute('data-display-mode');
  document.documentElement.style.removeProperty('font-size');
  document.documentElement.style.removeProperty('--nc-ui-scale');
  document.documentElement.style.removeProperty('--nc-ui-scale-pct');
  document.documentElement.style.removeProperty('--nc-rem-compensation');
  setAndroidPlatformOverrideForDpadTest(isAndroid);
  confirmDisplayPreferences(mode, 85);
  syncDocumentDisplayAttributes();
  setNavMode(nav);
  resetPerformanceProfileCacheForTest();
  initPerformanceProfile();
  setPerformanceProfilePreference(perf);
}

async function mountLiveTv(
  catalog: ReturnType<typeof buildLargeLiveCatalog>,
  onCommit?: () => void
): Promise<{
  host: HTMLDivElement;
  unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);

  const credentials = {
    serverUrl: 'http://example.test:8080',
    username: 'demo',
    password: 'secret',
  };

  const liveContextValue = {
    liveCategories: catalog.liveCategories,
    liveStreams: catalog.liveStreams,
    allLiveStreams: catalog.liveStreams,
    liveCategoriesStatus: 'ready' as const,
    liveCatalogStatus: 'ready' as const,
    liveCategoriesError: null,
    liveError: null,
    loadingLive: false,
    loadedLiveCatalog: true,
    fetchLiveCategories: async () => {},
    fetchLiveStreams: async () => {},
  };

  await act(async () => {
    root.render(
      React.createElement(
        XtreamCredentialsContext.Provider,
        { value: { credentials } },
        React.createElement(
          XtreamLiveContext.Provider,
          { value: liveContextValue },
          React.createElement(
            NavigationProvider,
            null,
            React.createElement(
              Profiler,
              {
                id: 'live-tv-test',
                onRender: () => {
                  onCommit?.();
                },
              },
              React.createElement(LiveTvView)
            )
          )
        )
      )
    );
  });
  await flush(6);

  return {
    host,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    },
  };
}

// ============================================================================
// 4. Execução dos cenários direcionados da TV ao Vivo (Fase 2/5)
// ============================================================================
async function runTests() {
  const catalog = buildLargeLiveCatalog();
  let passed = 0;

  const runCase = async (name: string, fn: () => Promise<void>) => {
    await fn();
    passed += 1;
    console.log(`  [OK] ${name}`);
  };

  console.log('Executando suite direcionada da TV ao Vivo (test-live-tv-nav)...');

  // --------------------------------------------------------------------------
  // Cenário A: Comparação de cards/fileiras montados (Full vs Lite) + métricas de foco/scroll
  // --------------------------------------------------------------------------
  await runCase(
    '1. Contagem comparativa de fileiras/cards montados (Full vs Lite) e custo de foco/scroll',
    async () => {
      // Medição em modo Completo (Full)
      resetEnv(true, 'tv', 'remote', 'full');
      let fullFocusCommits = 0;
      const mountedFull = await mountLiveTv(catalog, () => {
        fullFocusCommits += 1;
      });
      let fullRows = 0;
      let fullCards = 0;
      let fullRow0Cards = 0;
      try {
        fullRows = mountedFull.host.querySelectorAll('[data-home-row-index]').length;
        fullCards = mountedFull.host.querySelectorAll('[data-live-channel-card="true"]').length;
        const row0 = mountedFull.host.querySelector('[data-home-row-index="0"]');
        fullRow0Cards = row0?.querySelectorAll('[data-live-channel-card="true"]').length ?? 0;

        assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'full');
        assert.strictEqual(fullRows, 24, 'Modo Completo deve preservar 24 fileiras verticais');
        assert.strictEqual(fullRow0Cards, 18, 'Modo Completo deve preservar mínimo de 18 cards horizontais');
      } finally {
        await mountedFull.unmount();
      }

      // Medição em modo Lite efetivo (APK Android + TV + remote + auto)
      resetEnv(true, 'tv', 'remote', 'auto');
      let liteCommits = 0;
      const mountedLite = await mountLiveTv(catalog, () => {
        liteCommits += 1;
      });
      try {
        assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'lite');
        const liteRows = mountedLite.host.querySelectorAll('[data-home-row-index]').length;
        const liteCards = mountedLite.host.querySelectorAll('[data-live-channel-card="true"]').length;
        const row0 = mountedLite.host.querySelector('[data-home-row-index="0"]');
        const liteRow0Cards = row0?.querySelectorAll('[data-live-channel-card="true"]').length ?? 0;

        // Instrumentação de foco entre cards adjacentes (0 re-renders React e 0 querySelectorAll no scroll container)
        const leftScroll = mountedLite.host.querySelector<HTMLElement>('[data-showcase-rows-container="true"]')!;
        const cardBtns = Array.from(
          row0!.querySelectorAll<HTMLButtonElement>('button[data-live-channel-btn="true"]')
        );
        assert.ok(cardBtns.length >= 6, 'Linha 0 deve ter cards suficientes montados em Lite');

        act(() => {
          focusElementSafely(cardBtns[0]);
        });
        await flush();

        let focusQsaCalls = 0;
        const origLeftQsa = leftScroll.querySelectorAll.bind(leftScroll);
        leftScroll.querySelectorAll = ((sel: string) => {
          focusQsaCalls += 1;
          return origLeftQsa(sel);
        }) as typeof leftScroll.querySelectorAll;

        const commitsBeforeFocusMoves = liteCommits;
        try {
          for (let i = 1; i <= 5; i++) {
            act(() => {
              focusElementSafely(cardBtns[i]);
            });
          }
          await flush();
        } finally {
          leftScroll.querySelectorAll = origLeftQsa;
        }
        const focusReactCommits = liteCommits - commitsBeforeFocusMoves;

        // Instrumentação de leituras de geometria durante eventos de scroll horizontal
        const row0Scroll = row0!.querySelector<HTMLElement>('[data-live-category-row-scroll="true"]')!;
        gbrCounter = 0;
        act(() => {
          for (let px = 60; px <= 300; px += 60) {
            row0Scroll.scrollLeft = px;
            row0Scroll.dispatchEvent(new Event('scroll'));
          }
        });
        await flush();
        const scrollGbrCalls = gbrCounter;

        console.log(
          `    [METRICS] Full: ${fullRows} fileiras / ${fullRow0Cards} cards na fila 0 / ${fullCards} cards totais | ` +
            `Lite: ${liteRows} fileiras / ${liteRow0Cards} cards na fila 0 / ${liteCards} cards totais | ` +
            `Focus commits (5 trocas): ${focusReactCommits} | Focus QSA: ${focusQsaCalls} | Scroll gBCR (5 eventos): ${scrollGbrCalls}`
        );

        assert.strictEqual(liteRows, 12, 'Modo Lite efetivo deve reduzir janela vertical para 12 fileiras');
        assert.ok(
          liteRow0Cards <= 12 && liteRow0Cards >= 10,
          `Modo Lite efetivo deve reduzir janela horizontal para ~10 cards (atual: ${liteRow0Cards})`
        );
        assert.ok(
          liteCards < fullCards * 0.4,
          `Modo Lite deve reduzir drasticamente cards montados (${liteCards} vs ${fullCards})`
        );
        assert.strictEqual(
          focusReactCommits,
          0,
          `Troca de foco entre cards adjacentes não deve disparar re-renders React (atual: ${focusReactCommits})`
        );
        assert.strictEqual(
          focusQsaCalls,
          0,
          `Troca de foco entre cards montados não deve executar querySelectorAll no container (atual: ${focusQsaCalls})`
        );
        assert.strictEqual(
          scrollGbrCalls,
          0,
          `handleRowScroll não deve chamar getBoundingClientRect() com cache de métricas ativo (atual: ${scrollGbrCalls})`
        );
      } finally {
        await mountedLite.unmount();
      }
    }
  );

  // --------------------------------------------------------------------------
  // Cenário B: Horizontal D-pad (inclusive repeat) em lista > 100 canais, primeiro/último canal, favorito e volta
  // --------------------------------------------------------------------------
  await runCase(
    '2. Navegação horizontal D-Pad (com tecla mantida), 120 canais (0..119 e volta), botão favorito e destaque branco',
    async () => {
      resetEnv(true, 'tv', 'remote', 'auto');
      const mounted = await mountLiveTv(catalog);
      try {
        const firstBtn = mounted.host.querySelector<HTMLButtonElement>(
          '[data-home-row-index="0"] button[data-live-channel-btn="true"][data-row-card-index="0"]'
        )!;
        assert.ok(firstBtn, 'Primeiro canal deve existir');
        act(() => {
          focusElementSafely(firstBtn);
        });
        await flush();

        // Verifica destaque branco inicial no card 0
        const firstCard = firstBtn.closest<HTMLElement>('[data-live-channel-card="true"]')!;
        assert.strictEqual(firstCard.getAttribute('data-card-focused'), 'true');
        assert.strictEqual(firstBtn.getAttribute('data-live-channel-origin'), 'true');

        // Acesso ao botão de favoritos do card 0 (mantém data-card-focused="true" ao trocar de botão dentro do mesmo card)
        const favBtn0 = firstCard.querySelector<HTMLButtonElement>('button[data-live-channel-fav="true"]')!;
        assert.ok(favBtn0, 'Botão de favoritos do canal 0 deve existir');
        act(() => {
          focusElementSafely(favBtn0);
        });
        await flush();
        assert.strictEqual(
          document.activeElement,
          favBtn0,
          'Botão de favoritos do card 0 deve ser focável'
        );
        assert.strictEqual(
          firstCard.getAttribute('data-card-focused'),
          'true',
          'Card deve manter data-card-focused="true" ao mover foco do botão do canal para o botão de favoritos'
        );

        // Acionar favorito e confirmar que foco + data-card-focused sobrevivem ao re-render de favorito
        act(() => {
          favBtn0.click();
        });
        await flush();
        assert.strictEqual(
          (document.activeElement as HTMLElement | null)?.getAttribute('data-live-channel-fav'),
          'true'
        );
        assert.strictEqual(
          (document.activeElement as HTMLElement | null)
            ?.closest('[data-live-channel-card="true"]')
            ?.getAttribute('data-card-focused'),
          'true',
          'Destaque branco deve permanecer após re-render do botão de favoritos'
        );
        // Desfazer favorito para manter linha 0 como Categoria 01
        act(() => {
          (document.activeElement as HTMLButtonElement).click();
        });
        await flush();

        // Voltar do botão de favoritos para o botão principal do card 0 via ArrowLeft
        await dispatchArrow('ArrowLeft');
        assert.strictEqual(
          (document.activeElement as HTMLElement | null)?.getAttribute('data-live-channel-btn'),
          'true',
          'ArrowLeft no botão de favoritos deve voltar para o botão principal do mesmo card'
        );
        assert.strictEqual(
          (document.activeElement as HTMLElement | null)?.getAttribute('data-row-card-index'),
          '0'
        );
        assert.strictEqual(
          (document.activeElement as HTMLElement | null)
            ?.closest('[data-live-channel-card="true"]')
            ?.getAttribute('data-card-focused'),
          'true',
          'Destaque branco deve permanecer ao retornar do favorito para o botão do canal'
        );

        // Avançar continuamente até o último canal (índice 119) simulando tecla mantida pressionada
        let steps = 0;
        let maxReachedIndex = 0;
        while (steps < 280 && maxReachedIndex < 119) {
          await dispatchArrow('ArrowRight', steps > 0);
          steps += 1;
          const active = document.activeElement as HTMLElement | null;
          assert.ok(active && mounted.host.contains(active), `Foco não pode ser perdido no passo ${steps}`);
          const idxStr =
            active.getAttribute('data-row-card-index') ?? active.getAttribute('data-row-fav-index');
          const idx = Number(idxStr);
          if (Number.isFinite(idx) && idx > maxReachedIndex) {
            maxReachedIndex = idx;
          }
        }

        assert.strictEqual(
          maxReachedIndex,
          119,
          `Navegação horizontal deve alcançar o último canal (119) em lista de 120 canais (alcançou: ${maxReachedIndex})`
        );

        // Garantir que há exatamente 1 origem marcada e nenhum canal foi selecionado apenas por foco
        const originButtons = mounted.host.querySelectorAll('button[data-live-channel-origin="true"]');
        assert.strictEqual(originButtons.length, 1, 'Deve existir exatamente 1 marcador de canal de origem');
        const selectedButtons = mounted.host.querySelectorAll('button[data-live-channel-selected="true"]');
        assert.strictEqual(
          selectedButtons.length,
          0,
          'Simples foco por D-Pad nunca deve selecionar ou iniciar reprodução de canal'
        );

        // Retornar até o primeiro canal (índice 0) com tecla ArrowLeft mantida pressionada
        let backSteps = 0;
        let minReachedIndex = maxReachedIndex;
        while (backSteps < 280 && minReachedIndex > 0) {
          await dispatchArrow('ArrowLeft', backSteps > 0);
          backSteps += 1;
          const active = document.activeElement as HTMLElement | null;
          assert.ok(active && mounted.host.contains(active), `Foco não pode ser perdido ao voltar (passo ${backSteps})`);
          const idxStr =
            active.getAttribute('data-row-card-index') ?? active.getAttribute('data-row-fav-index');
          const idx = Number(idxStr);
          if (Number.isFinite(idx) && idx < minReachedIndex) {
            minReachedIndex = idx;
          }
        }
        assert.strictEqual(minReachedIndex, 0, 'Deve retornar integralmente até o primeiro canal (0)');
      } finally {
        await mounted.unmount();
      }
    }
  );

  // --------------------------------------------------------------------------
  // Cenário C: Movimento vertical entre categorias (primeira -> última -> primeira)
  // --------------------------------------------------------------------------
  await runCase(
    '3. Movimento vertical D-Pad alcança última categoria (29) e retorna à primeira (0) sem perda de foco',
    async () => {
      resetEnv(true, 'tv', 'remote', 'auto');
      const mounted = await mountLiveTv(catalog);
      try {
        const firstBtn = mounted.host.querySelector<HTMLButtonElement>(
          '[data-home-row-index="0"] button[data-live-channel-btn="true"][data-row-card-index="0"]'
        )!;
        act(() => {
          focusElementSafely(firstBtn);
        });
        await flush();

        // Descer da categoria 0 até a última categoria (29)
        let currentRow = 0;
        for (let step = 0; step < 35 && currentRow < 29; step++) {
          await dispatchArrow('ArrowDown', step > 0);
          const active = document.activeElement as HTMLElement | null;
          assert.ok(active && mounted.host.contains(active), `Foco perdido descendo na etapa ${step}`);
          const section = active.closest<HTMLElement>('[data-home-row-index]');
          assert.ok(section, 'Elemento focado deve estar em uma linha de categoria');
          currentRow = Number(section.getAttribute('data-home-row-index'));
          const card = active.closest<HTMLElement>('[data-live-channel-card="true"]');
          assert.strictEqual(
            card?.getAttribute('data-card-focused'),
            'true',
            'Card focado na nova categoria deve ter destaque branco data-card-focused="true"'
          );
        }
        assert.strictEqual(currentRow, 29, `Deve alcançar a última categoria (29), chegou em ${currentRow}`);

        // Subir de volta até a primeira categoria (0)
        for (let step = 0; step < 35 && currentRow > 0; step++) {
          await dispatchArrow('ArrowUp', step > 0);
          const active = document.activeElement as HTMLElement | null;
          assert.ok(active && mounted.host.contains(active), `Foco perdido subindo na etapa ${step}`);
          const section = active.closest<HTMLElement>('[data-home-row-index]');
          currentRow = Number(section?.getAttribute('data-home-row-index'));
        }
        assert.strictEqual(currentRow, 0, `Deve retornar à primeira categoria (0), parou em ${currentRow}`);
      } finally {
        await mounted.unmount();
      }
    }
  );

  // --------------------------------------------------------------------------
  // Cenário D: Seleção somente por OK, continuidade da reprodução ao navegar, retorno do preview e tela cheia
  // --------------------------------------------------------------------------
  await runCase(
    '4. Seleção somente por OK, continuidade do preview ao navegar na lista, 2º OK tela cheia e retorno ao canal de origem',
    async () => {
      resetEnv(true, 'tv', 'remote', 'auto');
      const mounted = await mountLiveTv(catalog);
      try {
        const ch0Btn = mounted.host.querySelector<HTMLButtonElement>(
          '[data-home-row-index="0"] button[data-live-channel-btn="true"][data-row-card-index="0"]'
        )!;
        act(() => {
          focusElementSafely(ch0Btn);
        });
        await flush();

        // Foco simples não abre preview
        assert.ok(
          mounted.host.textContent?.includes('Selecione um Canal'),
          'Preview não deve abrir antes do OK'
        );

        // 1º OK no canal 0 -> seleciona canal e abre preview
        act(() => {
          ch0Btn.click();
        });
        await flush(6);
        assert.strictEqual(
          ch0Btn.getAttribute('data-live-channel-selected'),
          'true',
          'Canal 0 deve ficar selecionado após OK'
        );
        const initialTitle = mounted.host.querySelector('.nc-live-channel-title')?.textContent;
        assert.ok(initialTitle && initialTitle.includes('Canal 1-001'), 'Preview deve exibir Canal 1-001');

        // Navegar por vários canais na lista mantendo preview tocando sem trocar canal
        await dispatchArrow('ArrowRight');
        await dispatchArrow('ArrowRight');
        await dispatchArrow('ArrowDown');
        await dispatchArrow('ArrowDown');
        const titleAfterNav = mounted.host.querySelector('.nc-live-channel-title')?.textContent;
        assert.strictEqual(
          titleAfterNav,
          initialTitle,
          'Navegar pela lista não pode interromper nem trocar o canal em reprodução no preview'
        );

        // Verificar que o canal de origem atual é o último card focado na lista
        const focusedBeforeBack = document.activeElement as HTMLButtonElement | null;
        const expectedOriginGroupId = focusedBeforeBack?.getAttribute('data-live-channel-group-id');
        assert.ok(expectedOriginGroupId, 'Deve existir canal de origem antes de fechar o preview');

        // Fechar preview via Back -> restaura foco no canal de origem correto
        let backHandled = false;
        act(() => {
          backHandled = executeBackAction();
        });
        await flush(6);
        assert.strictEqual(backHandled, true, 'Back deve fechar o preview ativo');
        assert.ok(
          mounted.host.textContent?.includes('Selecione um Canal'),
          'Preview deve fechar após Back'
        );
        const activeAfterBack = document.activeElement as HTMLElement | null;
        assert.strictEqual(
          activeAfterBack?.getAttribute('data-live-channel-group-id'),
          expectedOriginGroupId,
          'Fechar preview deve restaurar foco no canal de origem correto'
        );

        // 2º OK no mesmo canal selecionado deve manter fluxo de entrada em tela cheia intacto
        const reopenBtn = mounted.host.querySelector<HTMLButtonElement>(
          '[data-home-row-index="0"] button[data-live-channel-btn="true"][data-row-card-index="0"]'
        )!;
        act(() => {
          focusElementSafely(reopenBtn);
          reopenBtn.click();
        });
        await flush(6);
        // 2º OK solicita fullscreen imediato no VideoPlayer sem erros
        act(() => {
          reopenBtn.click();
        });
        await flush(4);
        assert.strictEqual(
          reopenBtn.getAttribute('data-live-channel-selected'),
          'true',
          'Canal deve permanecer selecionado após 2º OK'
        );
      } finally {
        await mounted.unmount();
      }
    }
  );

  // --------------------------------------------------------------------------
  // Cenário E: Escala TV (75% -> 100% -> 85%) e alternância Lite <-> Completo sem perda de foco
  // --------------------------------------------------------------------------
  await runCase(
    '5. Virtualização íntegra após mudança de escala TV e alternância Lite <-> Completo sem perda de foco',
    async () => {
      resetEnv(true, 'tv', 'remote', 'full');
      const mounted = await mountLiveTv(catalog);
      try {
        // Navegar até uma categoria profunda (ex.: linha 16, que existe na janela 0..24 do modo Full mas sairia de 0..12 ao encolher para Lite!)
        const row16Btn = mounted.host.querySelector<HTMLButtonElement>(
          '[data-home-row-index="16"] button[data-live-channel-btn="true"][data-row-card-index="12"]'
        )!;
        assert.ok(row16Btn, 'Linha 16 card 12 deve existir em modo Full (24x18)');
        const expectedGroupId = row16Btn.getAttribute('data-live-channel-group-id');

        act(() => {
          focusElementSafely(row16Btn);
        });
        await flush();
        assert.strictEqual(document.activeElement, row16Btn);

        // Alternar Full -> Lite com foco na linha 16 / card 12
        act(() => {
          setPerformanceProfilePreference('lite');
        });
        await flush(6);
        assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'lite');
        const activeInLite = document.activeElement as HTMLElement | null;
        assert.strictEqual(
          activeInLite?.getAttribute('data-live-channel-group-id'),
          expectedGroupId,
          'Alternar Full -> Lite não pode perder foco mesmo quando linha/card estava fora dos primeiros 12x10'
        );
        assert.strictEqual(
          activeInLite?.closest('[data-live-channel-card="true"]')?.getAttribute('data-card-focused'),
          'true',
          'Destaque branco deve ser preservado após alternar para Lite'
        );
        const rowsInLite = mounted.host.querySelectorAll('[data-home-row-index]').length;
        assert.strictEqual(rowsInLite, 12, 'Janela vertical deve encolher para 12 fileiras no modo Lite');

        // Alterar escala TV (85% -> 75% -> 100% -> 85%) e validar navegação contínua
        act(() => {
          confirmDisplayPreferences('tv', 75);
          syncDocumentDisplayAttributes();
        });
        await flush(4);
        await dispatchArrow('ArrowRight');
        assert.ok(
          mounted.host.contains(document.activeElement),
          'Foco deve permanecer íntegro após mudar escala TV para 75%'
        );

        act(() => {
          confirmDisplayPreferences('tv', 100);
          syncDocumentDisplayAttributes();
        });
        await flush(4);
        await dispatchArrow('ArrowRight');
        assert.ok(
          mounted.host.contains(document.activeElement),
          'Foco deve permanecer íntegro após mudar escala TV para 100%'
        );

        // Alternar Lite -> Full preservando foco atual
        const groupBeforeFull = (document.activeElement as HTMLElement | null)?.getAttribute(
          'data-live-channel-group-id'
        ) ?? (document.activeElement as HTMLElement | null)
          ?.closest('[data-live-channel-card="true"]')
          ?.querySelector('[data-live-channel-btn="true"]')
          ?.getAttribute('data-live-channel-group-id');

        act(() => {
          setPerformanceProfilePreference('full');
        });
        await flush(6);
        assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'full');
        const activeBackInFull = document.activeElement as HTMLElement | null;
        const groupAfterFull =
          activeBackInFull?.getAttribute('data-live-channel-group-id') ??
          activeBackInFull
            ?.closest('[data-live-channel-card="true"]')
            ?.querySelector('[data-live-channel-btn="true"]')
            ?.getAttribute('data-live-channel-group-id');
        assert.strictEqual(
          groupAfterFull,
          groupBeforeFull,
          'Alternar Lite -> Full não pode perder o foco atual'
        );
      } finally {
        await mounted.unmount();
      }
    }
  );

  // --------------------------------------------------------------------------
  // Cenário F: Retorno do preview após categoria de origem ter sido desmontada pela virtualização
  // --------------------------------------------------------------------------
  await runCase(
    '6. Retorno do preview restaura foco corretamente mesmo após a categoria/card de origem ter saído da janela virtual',
    async () => {
      resetEnv(true, 'tv', 'remote', 'auto');
      const mounted = await mountLiveTv(catalog);
      try {
        // Abrir canal 0 na categoria 0
        const ch0Btn = mounted.host.querySelector<HTMLButtonElement>(
          '[data-home-row-index="0"] button[data-live-channel-btn="true"][data-row-card-index="0"]'
        )!;
        act(() => {
          focusElementSafely(ch0Btn);
          ch0Btn.click();
        });
        await flush(6);

        // Navegar 20 categorias para baixo (desmontando a categoria 0 da janela vertical de 12 linhas)
        for (let i = 0; i < 20; i++) {
          await dispatchArrow('ArrowDown', i > 0);
        }
        const deepFocused = document.activeElement as HTMLElement | null;
        const deepRow = Number(deepFocused?.closest('[data-home-row-index]')?.getAttribute('data-home-row-index'));
        assert.ok(deepRow >= 15, `Deve ter navegado para categoria profunda (atual: ${deepRow})`);
        const deepGroupId = deepFocused?.getAttribute('data-live-channel-group-id');

        // Fechar preview via Back -> deve manter foco no canal de origem atual sem perder foco
        act(() => {
          executeBackAction();
        });
        await flush(6);
        const restored = document.activeElement as HTMLElement | null;
        assert.strictEqual(
          restored?.getAttribute('data-live-channel-group-id'),
          deepGroupId,
          'Fechar preview deve restaurar exatamente o canal de origem atual'
        );
      } finally {
        await mounted.unmount();
      }
    }
  );

  clearTimeout(watchdog);
  console.log(`\nSucesso: ${passed} blocos de cenários passaram em test-live-tv-nav.`);
  process.exit(0);
}

runTests().catch((err) => {
  clearTimeout(watchdog);
  console.error('FALHA em test-live-tv-nav:', err);
  process.exit(1);
});
