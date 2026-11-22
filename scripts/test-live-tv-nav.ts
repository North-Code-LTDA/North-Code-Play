import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Window } from 'happy-dom';
import React, { act, Profiler } from 'react';
import { createRoot, Root } from 'react-dom/client';

// Watchdog global de segurança (180s) para toda a suíte; cada cenário possui watchdog independente de 25s
const GLOBAL_WATCHDOG_MS = 180000;
const CASE_WATCHDOG_MS = 25000;
const watchdog = setTimeout(() => {
  console.error(`TIMEOUT GLOBAL: test-live-tv-nav excedeu ${GLOBAL_WATCHDOG_MS / 1000}s`);
  process.exit(1);
}, GLOBAL_WATCHDOG_MS);
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

  if (this.hasAttribute?.('data-header-nav-id')) {
    const id = this.getAttribute('data-header-nav-id');
    const order = ['home', 'live', 'movies', 'series', 'favorites'];
    const idx = Math.max(0, order.indexOf(id || 'home'));
    const left = 240 + idx * 110;
    return {
      left,
      top: 12,
      right: left + 96,
      bottom: 48,
      width: 96,
      height: 36,
      x: left,
      y: 12,
      toJSON: () => ({}),
    };
  }

  if (this.getAttribute?.('data-live-variants-row') === 'true') {
    return {
      left: 660,
      top: 140,
      right: 980,
      bottom: 180,
      width: 320,
      height: 40,
      x: 660,
      y: 140,
      toJSON: () => ({}),
    };
  }

  if (this.closest?.('[data-live-variants-row="true"]') && this.tagName === 'BUTTON') {
    const siblings = Array.from(
      this.parentElement?.querySelectorAll('button') ?? []
    );
    const idx = Math.max(0, siblings.indexOf(this as HTMLButtonElement));
    const left = 660 + idx * 78;
    return {
      left,
      top: 144,
      right: left + 70,
      bottom: 176,
      width: 70,
      height: 32,
      x: left,
      y: 144,
      toJSON: () => ({}),
    };
  }

  if (this.getAttribute?.('data-live-quality-trigger') === 'true') {
    return {
      left: 660,
      top: 432,
      right: 850,
      bottom: 468,
      width: 190,
      height: 36,
      x: 660,
      y: 432,
      toJSON: () => ({}),
    };
  }

  if (this.getAttribute?.('data-live-quality-menu') === 'true') {
    return {
      left: 660,
      top: 474,
      right: 850,
      bottom: 630,
      width: 190,
      height: 156,
      x: 660,
      y: 474,
      toJSON: () => ({}),
    };
  }

  if (this.hasAttribute?.('data-live-quality-option') && this.tagName === 'BUTTON') {
    const siblings = Array.from(
      this.parentElement?.querySelectorAll('button[data-live-quality-option]') ?? []
    );
    const idx = Math.max(0, siblings.indexOf(this as HTMLButtonElement));
    const top = 480 + idx * 36;
    return {
      left: 666,
      top,
      right: 844,
      bottom: top + 32,
      width: 178,
      height: 32,
      x: 666,
      y: top,
      toJSON: () => ({}),
    };
  }

  if (
    this.getAttribute?.('data-epg-item') === 'true' ||
    this.getAttribute?.('data-epg-primary') === 'true'
  ) {
    const siblings = Array.from(
      this.parentElement?.querySelectorAll('[data-epg-item="true"], [data-epg-primary="true"]') ?? []
    );
    const idx = Math.max(0, siblings.indexOf(this));
    const top = 524 + idx * 72;
    return {
      left: 660,
      top,
      right: 1240,
      bottom: top + 64,
      width: 580,
      height: 64,
      x: 660,
      y: top,
      toJSON: () => ({}),
    };
  }

  if (this.getAttribute?.('data-mobile-back') === 'true') {
    return {
      left: 16,
      top: 72,
      right: 156,
      bottom: 104,
      width: 140,
      height: 32,
      x: 16,
      y: 72,
      toJSON: () => ({}),
    };
  }

  if (this.hasAttribute?.('data-test-rect-top')) {
    const left = Number(this.getAttribute('data-test-rect-left') || 40);
    const top = Number(this.getAttribute('data-test-rect-top') || 120);
    const width = Number(this.getAttribute('data-test-rect-width') || 160);
    const height = Number(this.getAttribute('data-test-rect-height') || 44);
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
const { LiveTvView, computeLiveTvLayoutMetrics } = await import('../src/views/LiveTvView');
const { VideoPlayer } = await import('../src/components/VideoPlayer');
const { usePlaybackSession } = await import('../src/components/player/usePlaybackSession');

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
  const TOTAL_CASES = 9;
  const rawCaseFilter = process.env.NC_LIVE_TV_NAV_CASE?.trim();
  let targetCaseNumber: number | null = null;
  if (rawCaseFilter !== undefined && rawCaseFilter !== '') {
    if (!/^\d+$/.test(rawCaseFilter)) {
      console.error(
        `ERRO: NC_LIVE_TV_NAV_CASE inválido ("${rawCaseFilter}"). Informe um número inteiro entre 1 e ${TOTAL_CASES}.`
      );
      clearTimeout(watchdog);
      process.exit(1);
    }
    const parsedCase = Number(rawCaseFilter);
    if (!Number.isInteger(parsedCase) || parsedCase < 1 || parsedCase > TOTAL_CASES) {
      console.error(
        `ERRO: NC_LIVE_TV_NAV_CASE fora do intervalo ("${rawCaseFilter}"). Informe um número inteiro entre 1 e ${TOTAL_CASES}.`
      );
      clearTimeout(watchdog);
      process.exit(1);
    }
    targetCaseNumber = parsedCase;
  }

  const catalog = buildLargeLiveCatalog();
  let caseCounter = 0;
  let executed = 0;
  let passed = 0;

  const runCase = async (name: string, fn: () => Promise<void>) => {
    caseCounter += 1;
    const currentCaseNumber = caseCounter;
    if (targetCaseNumber !== null && currentCaseNumber !== targetCaseNumber) {
      return;
    }

    executed += 1;
    console.log(`  [INÍCIO] ${name}`);
    const startedAt = Date.now();
    const caseWatchdog = setTimeout(() => {
      console.error(
        `  [TIMEOUT] Cenário ${currentCaseNumber} excedeu ${CASE_WATCHDOG_MS / 1000}s: ${name}`
      );
      clearTimeout(watchdog);
      process.exit(1);
    }, CASE_WATCHDOG_MS);
    caseWatchdog.unref();

    try {
      await fn();
      const durationMs = Date.now() - startedAt;
      passed += 1;
      console.log(`  [OK] ${name} (duração: ${durationMs} ms)`);
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      console.error(`  [FALHA] ${name} (duração: ${durationMs} ms)`);
      throw err;
    } finally {
      clearTimeout(caseWatchdog);
    }
  };

  console.log(
    targetCaseNumber !== null
      ? `Executando cenário direcionado #${targetCaseNumber} da TV ao Vivo (test-live-tv-nav)...`
      : 'Executando suite direcionada da TV ao Vivo (test-live-tv-nav)...'
  );

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

  // --------------------------------------------------------------------------
  // Cenário G: Regressão de foco Cabeçalho TV ao Vivo + ArrowDown (com/sem canal, variantes SD/HD/FHD, virtualização e outras seções)
  // --------------------------------------------------------------------------
  await runCase(
    '7. Cabeçalho TV ao Vivo + ArrowDown retorna às categorias sem desvio para SD/HD/FHD (com/sem canal, virtualização e demais seções preservadas)',
    async () => {
      // Catálogo com canal agrupado (SD/HD/FHD) na primeira categoria e 30 categorias para virtualização
      const variantCatalog = buildLargeLiveCatalog();
      variantCatalog.liveStreams.unshift(
        {
          num: 901,
          name: 'Canal Variantes SD',
          stream_type: 'live',
          stream_id: 901,
          stream_icon: '',
          epg_channel_id: '',
          added: '1700000000',
          category_id: '1',
          custom_sid: '',
          tv_archive: 0,
          direct_source: '',
          tv_archive_duration: 0,
        },
        {
          num: 902,
          name: 'Canal Variantes HD',
          stream_type: 'live',
          stream_id: 902,
          stream_icon: '',
          epg_channel_id: '',
          added: '1700000000',
          category_id: '1',
          custom_sid: '',
          tv_archive: 0,
          direct_source: '',
          tv_archive_duration: 0,
        },
        {
          num: 903,
          name: 'Canal Variantes FHD',
          stream_type: 'live',
          stream_id: 903,
          stream_icon: '',
          epg_channel_id: '',
          added: '1700000000',
          category_id: '1',
          custom_sid: '',
          tv_archive: 0,
          direct_source: '',
          tv_archive_duration: 0,
        }
      );

      resetEnv(true, 'tv', 'remote', 'auto');
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root: Root = createRoot(host);

      const credentials = {
        serverUrl: 'http://example.test:8080',
        username: 'demo',
        password: 'secret',
      };

      const liveContextValue = {
        liveCategories: variantCatalog.liveCategories,
        liveStreams: variantCatalog.liveStreams,
        allLiveStreams: variantCatalog.liveStreams,
        liveCategoriesStatus: 'ready' as const,
        liveCatalogStatus: 'ready' as const,
        liveCategoriesError: null,
        liveError: null,
        loadingLive: false,
        loadedLiveCatalog: true,
        fetchLiveCategories: async () => {},
        fetchLiveStreams: async () => {},
      };

      try {
        console.log('    [CHECKPOINT 7.1] Montagem inicial');
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
                    'div',
                    null,
                    React.createElement(
                      'header',
                      { 'data-nav-zone': 'header' },
                      React.createElement(
                        'button',
                        { type: 'button', 'data-nav-item': 'true', 'data-header-nav-id': 'home' },
                        'Início'
                      ),
                      React.createElement(
                        'button',
                        {
                          type: 'button',
                          'data-nav-item': 'true',
                          'data-header-nav-id': 'live',
                          'data-header-nav-active': 'true',
                        },
                        'TV ao Vivo'
                      ),
                      React.createElement(
                        'button',
                        { type: 'button', 'data-nav-item': 'true', 'data-header-nav-id': 'movies' },
                        'Filmes'
                      )
                    ),
                    React.createElement(LiveTvView)
                  )
                )
              )
            )
          );
        });
        await flush(6);

        const liveHeaderBtn = host.querySelector<HTMLButtonElement>(
          'button[data-header-nav-id="live"]'
        )!;
        const leftPane = host.querySelector<HTMLElement>(
          '.nc-live-left-pane[data-nav-zone="categories"]'
        )!;
        assert.ok(liveHeaderBtn, 'Botão TV ao Vivo do cabeçalho deve existir');
        assert.ok(leftPane, 'Painel esquerdo .nc-live-left-pane[data-nav-zone="categories"] deve existir');

        // 1 & 3a. Sem canal selecionado: Cabeçalho TV ao Vivo + ArrowDown entra na zona de categorias
        console.log('    [CHECKPOINT 7.2] Teste de ArrowDown sem canal');
        act(() => {
          focusElementSafely(liveHeaderBtn);
        });
        await flush();
        await dispatchArrow('ArrowDown');
        const activeNoChannel = document.activeElement as HTMLElement | null;
        assert.ok(
          activeNoChannel && leftPane.contains(activeNoChannel),
          'ArrowDown no cabeçalho TV ao Vivo sem canal selecionado deve focar a zona de categorias'
        );
        assert.strictEqual(
          activeNoChannel.getAttribute('data-live-channel-btn'),
          'true',
          'Destino na zona de categorias deve ser um canal elegível'
        );

        // 2 & 3b. Selecionar canal agrupado com variantes SD/HD/FHD
        console.log('    [CHECKPOINT 7.3] Seleção do canal');
        const groupedChannelBtn = host.querySelector<HTMLButtonElement>(
          '[data-home-row-index="0"] button[data-live-channel-btn="true"][data-row-card-index="0"]'
        )!;
        assert.ok(groupedChannelBtn, 'Canal agrupado SD/HD/FHD deve estar no índice 0');
        const groupedId = groupedChannelBtn.getAttribute('data-live-channel-group-id');
        act(() => {
          focusElementSafely(groupedChannelBtn);
          groupedChannelBtn.click();
        });
        await flush(6);

        const qualityTrigger = host.querySelector<HTMLButtonElement>(
          '[data-live-quality-trigger="true"]'
        );
        assert.ok(
          qualityTrigger,
          'Canal agrupado SD/HD/FHD deve exibir o controle compacto [data-live-quality-trigger="true"] no painel direito'
        );
        assert.strictEqual(
          host.querySelector('[data-live-variants-row="true"]'),
          null,
          'Fileira fixa [data-live-variants-row="true"] não deve mais ser exibida no painel direito'
        );
        assert.strictEqual(
          host.querySelector('[data-live-quality-menu="true"]'),
          null,
          'Menu compacto de qualidade deve iniciar fechado'
        );

        // Voltar ao cabeçalho TV ao Vivo e pressionar ArrowDown: NÃO pode desviar para o controle de qualidade
        act(() => {
          focusElementSafely(liveHeaderBtn);
        });
        await flush();
        await dispatchArrow('ArrowDown');
        const activeWithVariants = document.activeElement as HTMLElement | null;
        assert.ok(
          activeWithVariants && activeWithVariants !== qualityTrigger,
          'Presença do controle compacto de qualidade não pode interceptar ArrowDown a partir do cabeçalho TV ao Vivo'
        );
        assert.ok(
          activeWithVariants && leftPane.contains(activeWithVariants),
          'ArrowDown no cabeçalho TV ao Vivo com canal selecionado deve retornar à zona de categorias'
        );
        assert.strictEqual(
          activeWithVariants.getAttribute('data-live-channel-group-id'),
          groupedId,
          'Foco deve retornar ao canal de origem/selecionado'
        );

        // Acesso ao seletor de qualidade e navegação D-pad dentro do menu continuam funcionais
        console.log('    [CHECKPOINT 7.4] Abertura do menu de qualidade');
        act(() => {
          focusElementSafely(qualityTrigger);
          qualityTrigger.click();
        });
        await flush(4);
        const openedMenu = host.querySelector<HTMLElement>('[data-live-quality-menu="true"]');
        assert.ok(openedMenu, 'Menu compacto de qualidade deve abrir ao acionar o trigger');
        const optionButtons = Array.from(
          openedMenu!.querySelectorAll<HTMLButtonElement>('button[data-live-quality-option]')
        );
        assert.ok(optionButtons.length >= 4, 'Menu compacto deve listar Automático + SD/HD/FHD');
        assert.strictEqual(
          document.activeElement,
          optionButtons[0],
          'Ao abrir o menu, foco deve mover para a opção ativa (Automático)'
        );
        console.log('    [CHECKPOINT 7.5] Teste de navegação dentro do menu');
        await dispatchArrow('ArrowDown');
        assert.strictEqual(
          document.activeElement,
          optionButtons[1],
          'ArrowDown dentro do menu compacto deve avançar para a próxima resolução'
        );
        console.log('    [CHECKPOINT 7.6] Fechamento por Back');
        act(() => {
          executeBackAction();
        });
        await flush(4);
        assert.strictEqual(
          host.querySelector('[data-live-quality-menu="true"]'),
          null,
          'Back deve fechar o menu compacto de qualidade'
        );
        assert.strictEqual(
          document.activeElement,
          qualityTrigger,
          'Back deve restaurar o foco ao botão compacto de qualidade'
        );

        // 5. Restauração de foco com virtualização a partir do cabeçalho TV ao Vivo
        console.log('    [CHECKPOINT 7.7] Navegação até categoria profunda');
        act(() => {
          focusElementSafely(groupedChannelBtn);
        });
        await flush();
        for (let i = 0; i < 18; i++) {
          await dispatchArrow('ArrowDown', i > 0);
        }
        const deepOriginBtn = document.activeElement as HTMLElement | null;
        const deepOriginRow = Number(
          deepOriginBtn?.closest('[data-home-row-index]')?.getAttribute('data-home-row-index')
        );
        const deepOriginGroupId = deepOriginBtn?.getAttribute('data-live-channel-group-id');
        assert.ok(deepOriginRow >= 15 && deepOriginGroupId, 'Deve ter navegado até uma categoria profunda');

        // Focar cabeçalho TV ao Vivo e desmontar a linha profunda da janela virtual simulando rolagem para o topo
        console.log('    [CHECKPOINT 7.8] Restauração após virtualização');
        act(() => {
          focusElementSafely(liveHeaderBtn);
        });
        await flush();
        const leftScroll = host.querySelector<HTMLElement>('[data-showcase-rows-container="true"]')!;
        act(() => {
          leftScroll.scrollTop = 0;
          leftScroll.dispatchEvent(new Event('scroll'));
        });
        await flush(4);
        assert.strictEqual(
          host.querySelector(`[data-home-row-index="${deepOriginRow}"]`),
          null,
          'Linha de origem profunda deve ter sido desmontada pela virtualização antes do retorno'
        );

        await dispatchArrow('ArrowDown');
        const restoredDeep = document.activeElement as HTMLElement | null;
        assert.ok(
          restoredDeep && leftPane.contains(restoredDeep),
          'ArrowDown no cabeçalho TV ao Vivo deve retornar à zona de categorias mesmo após virtualização'
        );
        assert.strictEqual(
          restoredDeep.getAttribute('data-live-channel-group-id'),
          deepOriginGroupId,
          'pickPreferredZoneEntry deve remontar e restaurar exatamente o canal de origem virtualizado'
        );
      } finally {
        await act(async () => {
          root.unmount();
        });
        host.remove();
      }

      // 4. Navegação de outras seções (Início / Filmes) não é alterada
      console.log('    [CHECKPOINT 7.9] Teste de navegação nas outras seções');
      const otherHost = document.createElement('div');
      document.body.appendChild(otherHost);
      const otherRoot: Root = createRoot(otherHost);
      try {
        await act(async () => {
          otherRoot.render(
            React.createElement(
              NavigationProvider,
              null,
              React.createElement(
                'div',
                null,
                React.createElement(
                  'header',
                  { 'data-nav-zone': 'header' },
                  React.createElement(
                    'button',
                    {
                      type: 'button',
                      'data-nav-item': 'true',
                      'data-header-nav-id': 'home',
                      'data-header-nav-active': 'true',
                    },
                    'Início'
                  ),
                  React.createElement(
                    'button',
                    { type: 'button', 'data-nav-item': 'true', 'data-header-nav-id': 'movies' },
                    'Filmes'
                  )
                ),
                React.createElement(
                  'section',
                  { 'data-nav-zone': 'content' },
                  React.createElement(
                    'button',
                    {
                      type: 'button',
                      'data-nav-item': 'true',
                      'data-test-content-primary': 'true',
                      'data-test-rect-left': '40',
                      'data-test-rect-top': '140',
                      'data-test-rect-width': '200',
                      'data-test-rect-height': '48',
                    },
                    'Destaque Início'
                  )
                )
              )
            )
          );
        });
        await flush(4);

        const homeHeaderBtn = otherHost.querySelector<HTMLButtonElement>(
          'button[data-header-nav-id="home"]'
        )!;
        const homeContentBtn = otherHost.querySelector<HTMLButtonElement>(
          'button[data-test-content-primary="true"]'
        )!;
        act(() => {
          focusElementSafely(homeHeaderBtn);
        });
        await flush();
        await dispatchArrow('ArrowDown');
        assert.strictEqual(
          document.activeElement,
          homeContentBtn,
          'Cabeçalho Início + ArrowDown deve continuar descendo normalmente para a zona content'
        );

        // Seção Filmes com barra de categorias de vitrine preservada
        await act(async () => {
          otherRoot.render(
            React.createElement(
              NavigationProvider,
              null,
              React.createElement(
                'div',
                null,
                React.createElement(
                  'header',
                  { 'data-nav-zone': 'header' },
                  React.createElement(
                    'button',
                    {
                      type: 'button',
                      'data-nav-item': 'true',
                      'data-header-nav-id': 'movies',
                      'data-header-nav-active': 'true',
                    },
                    'Filmes'
                  )
                ),
                React.createElement(
                  'div',
                  { 'data-nav-zone': 'categories', 'data-showcase-categories-bar': 'true' },
                  React.createElement(
                    'button',
                    {
                      type: 'button',
                      'data-nav-item': 'true',
                      'data-category-selected': 'true',
                      'data-test-rect-left': '40',
                      'data-test-rect-top': '96',
                      'data-test-rect-width': '160',
                      'data-test-rect-height': '36',
                    },
                    'Categorias Filmes'
                  )
                ),
                React.createElement(
                  'main',
                  { 'data-nav-zone': 'content' },
                  React.createElement(
                    'button',
                    {
                      type: 'button',
                      'data-nav-item': 'true',
                      'data-test-rect-left': '40',
                      'data-test-rect-top': '180',
                      'data-test-rect-width': '180',
                      'data-test-rect-height': '48',
                    },
                    'Filme Destaque'
                  )
                )
              )
            )
          );
        });
        await flush(4);

        const moviesHeaderBtn = otherHost.querySelector<HTMLButtonElement>(
          'button[data-header-nav-id="movies"]'
        )!;
        const moviesCatBtn = otherHost.querySelector<HTMLButtonElement>(
          '[data-showcase-categories-bar="true"] button'
        )!;
        act(() => {
          focusElementSafely(moviesHeaderBtn);
        });
        await flush();
        await dispatchArrow('ArrowDown');
        assert.strictEqual(
          document.activeElement,
          moviesCatBtn,
          'Cabeçalho Filmes + ArrowDown deve preservar a entrada na barra de categorias da vitrine'
        );
      } finally {
        await act(async () => {
          otherRoot.unmount();
        });
        otherHost.remove();
      }
    }
  );

  // --------------------------------------------------------------------------
  // Cenário H: Supressão de métricas visuais no preview Live Lite, restauração em fullscreen e preservação do motor
  // --------------------------------------------------------------------------
  await runCase(
    '8. Preview Live Lite suprime atualizações de tempo/buffer, Full preserva, fullscreen restaura/re-suprime sem recriar vídeo e mantém loading/buffering/erros',
    async () => {
      resetEnv(true, 'tv', 'remote', 'auto');

      const setupSyntheticVideoMetrics = (video: HTMLVideoElement) => {
        const state = {
          currentTime: 0,
          duration: 0,
          bufferedEnd: 0,
          error: null as any,
          loadCalls: 0,
          playCalls: 0,
        };

        Object.defineProperty(video, 'currentTime', {
          configurable: true,
          get: () => state.currentTime,
          set: (v: number) => {
            state.currentTime = v;
          },
        });
        Object.defineProperty(video, 'duration', {
          configurable: true,
          get: () => state.duration,
        });
        Object.defineProperty(video, 'buffered', {
          configurable: true,
          get: () => ({
            length: state.bufferedEnd > 0 ? 1 : 0,
            start: () => 0,
            end: () => state.bufferedEnd,
          }),
        });
        Object.defineProperty(video, 'error', {
          configurable: true,
          get: () => state.error,
        });
        video.load = () => {
          state.loadCalls += 1;
        };
        video.play = () => {
          state.playCalls += 1;
          return Promise.resolve();
        };

        return state;
      };

      // Parte A: Verificação direta do hook usePlaybackSession (referência de bufferedRanges, supressão, restauração e pause)
      const hookHost = document.createElement('div');
      document.body.appendChild(hookHost);
      const hookRoot: Root = createRoot(hookHost);
      let latestSession: ReturnType<typeof usePlaybackSession> | null = null;
      let hookCommits = 0;

      function SessionProbe({ suppress }: { suppress: boolean }) {
        const videoRef = React.useRef<HTMLVideoElement>(null);
        const session = usePlaybackSession({
          videoRef,
          streamUrl: 'http://example.test:8080/live/demo/secret/5001.ts',
          contentType: 'live',
          isControlsVisible: true,
          suppressLivePreviewVisualMetrics: suppress,
        });
        latestSession = session;
        return React.createElement('video', { ref: videoRef });
      }

      try {
        await act(async () => {
          hookRoot.render(
            React.createElement(
              Profiler,
              {
                id: 'session-probe',
                onRender: () => {
                  hookCommits += 1;
                },
              },
              React.createElement(SessionProbe, { suppress: true })
            )
          );
        });
        await flush(4);

        const probeVideo = hookHost.querySelector('video') as HTMLVideoElement;
        assert.ok(probeVideo, 'Elemento <video> do probe deve existir');
        const vState = setupSyntheticVideoMetrics(probeVideo);

        act(() => {
          probeVideo.dispatchEvent(new Event('loadedmetadata'));
          probeVideo.dispatchEvent(new Event('playing'));
        });
        await flush(4);
        assert.strictEqual(latestSession!.isPlaying, true);
        assert.strictEqual(latestSession!.isLoading, false);

        const initialBufferedRef = latestSession!.bufferedRanges;
        const commitsBeforeSuppressedBurst = hookCommits;

        // 6. Em modo suprimido (Lite preview), eventos de tempo/duração/buffer não causam commits nem criam novo array bufferedRanges
        act(() => {
          vState.duration = 120;
          probeVideo.dispatchEvent(new Event('durationchange'));
          for (let i = 1; i <= 5; i++) {
            vState.currentTime = i * 5;
            vState.bufferedEnd = i * 5 + 15;
            probeVideo.dispatchEvent(new Event('timeupdate'));
            probeVideo.dispatchEvent(new Event('progress'));
          }
        });
        await flush(4);

        assert.strictEqual(
          hookCommits - commitsBeforeSuppressedBurst,
          0,
          'Preview Live Lite deve gerar 0 commits React em rajadas de timeupdate/progress/durationchange'
        );
        assert.strictEqual(
          latestSession!.bufferedRanges,
          initialBufferedRef,
          'bufferedRanges não deve alocar novos arrays enquanto métricas visuais estiverem suprimidas'
        );
        assert.strictEqual(latestSession!.currentTime, 0, 'currentTime React deve permanecer suprimido');
        assert.strictEqual(latestSession!.duration, 0, 'duration React deve permanecer suprimida');

        // handlePause não deve forçar publicação visual de métricas quando suprimido, mas deve atualizar isPlaying
        act(() => {
          probeVideo.dispatchEvent(new Event('pause'));
        });
        await flush(4);
        assert.strictEqual(latestSession!.isPlaying, false, 'pause deve continuar atualizando isPlaying');
        assert.strictEqual(
          latestSession!.bufferedRanges,
          initialBufferedRef,
          'pause não deve forçar criação/publicação de bufferedRanges durante supressão'
        );
        assert.strictEqual(latestSession!.currentTime, 0, 'pause não deve forçar publicação de currentTime durante supressão');

        // Retomar reprodução
        act(() => {
          probeVideo.dispatchEvent(new Event('playing'));
        });
        await flush(4);

        const loadCallsBeforeToggle = vState.loadCalls;
        const playCallsBeforeToggle = vState.playCalls;

        // 8 & 10. Entrar em fullscreen (suppress -> false): sincroniza métricas do <video> existente sem recriar nem recarregar
        await act(async () => {
          hookRoot.render(
            React.createElement(
              Profiler,
              {
                id: 'session-probe',
                onRender: () => {
                  hookCommits += 1;
                },
              },
              React.createElement(SessionProbe, { suppress: false })
            )
          );
        });
        await flush(4);

        assert.strictEqual(hookHost.querySelector('video'), probeVideo, 'Elemento <video> não pode ser recriado ao sair da supressão');
        assert.strictEqual(vState.loadCalls, loadCallsBeforeToggle, 'video.load() não pode ser chamado ao sair da supressão');
        assert.strictEqual(vState.playCalls, playCallsBeforeToggle, 'video.play() não pode reiniciar sessão ao sair da supressão');
        assert.strictEqual(latestSession!.currentTime, 25, 'currentTime deve sincronizar imediatamente a partir do <video>');
        assert.strictEqual(latestSession!.duration, 120, 'duration deve sincronizar imediatamente a partir do <video>');
        assert.strictEqual(latestSession!.bufferedRanges.length, 1, 'bufferedRanges deve sincronizar ao entrar em fullscreen');
        assert.strictEqual(latestSession!.bufferedRanges[0].end, 40);

        // Eventos em fullscreen (ou modo Full) voltam a publicar métricas normalmente
        const commitsBeforeFsEvents = hookCommits;
        act(() => {
          vState.currentTime = 31;
          vState.bufferedEnd = 48;
          probeVideo.dispatchEvent(new Event('timeupdate'));
          probeVideo.dispatchEvent(new Event('progress'));
        });
        await flush(4);
        assert.ok(
          hookCommits > commitsBeforeFsEvents,
          'Publicação de métricas deve estar ativa com suppressLivePreviewVisualMetrics=false'
        );
        assert.strictEqual(latestSession!.currentTime, 31);
        assert.strictEqual(latestSession!.bufferedRanges[0].end, 48);

        // 9 & 10. Voltar ao preview Lite (suppress -> true): restaura supressão sem recriar <video> nem reiniciar
        await act(async () => {
          hookRoot.render(
            React.createElement(
              Profiler,
              {
                id: 'session-probe',
                onRender: () => {
                  hookCommits += 1;
                },
              },
              React.createElement(SessionProbe, { suppress: true })
            )
          );
        });
        await flush(4);

        assert.strictEqual(hookHost.querySelector('video'), probeVideo, 'Elemento <video> não pode ser recriado ao voltar ao preview Lite');
        assert.strictEqual(vState.loadCalls, loadCallsBeforeToggle, 'video.load() não pode ser chamado ao voltar ao preview Lite');
        assert.strictEqual(vState.playCalls, playCallsBeforeToggle, 'video.play() não pode reiniciar ao voltar ao preview Lite');

        const bufferedRefBackInLite = latestSession!.bufferedRanges;
        const commitsAfterReturnLite = hookCommits;
        act(() => {
          vState.currentTime = 50;
          vState.bufferedEnd = 70;
          probeVideo.dispatchEvent(new Event('timeupdate'));
          probeVideo.dispatchEvent(new Event('progress'));
        });
        await flush(4);
        assert.strictEqual(
          hookCommits - commitsAfterReturnLite,
          0,
          'Retornar ao preview Lite deve voltar a suprimir commits de timeupdate/progress'
        );
        assert.strictEqual(
          latestSession!.bufferedRanges,
          bufferedRefBackInLite,
          'Retornar ao preview Lite não deve alocar novos arrays de bufferedRanges'
        );

        // 11. Eventos de buffering, loading e erro continuam funcionais durante supressão
        act(() => {
          probeVideo.dispatchEvent(new Event('waiting'));
        });
        await flush(4);
        assert.strictEqual(latestSession!.isBuffering, true, 'Evento waiting deve continuar atualizando isBuffering');

        act(() => {
          probeVideo.dispatchEvent(new Event('playing'));
        });
        await flush(4);
        assert.strictEqual(latestSession!.isBuffering, false, 'Evento playing deve encerrar buffering');

        act(() => {
          vState.error = { code: 2 };
          probeVideo.dispatchEvent(new Event('error'));
        });
        await flush(4);
        assert.ok(
          typeof latestSession!.error === 'string' && latestSession!.error.length > 0,
          'Evento error deve continuar publicando erro mesmo em preview Lite'
        );
      } finally {
        await act(async () => {
          hookRoot.unmount();
        });
        hookHost.remove();
      }

      // Parte B: Integração real no componente VideoPlayer (Lite vs Full + requestFullscreenImmediate / exitFullscreenImmediate)
      const runVideoPlayerIntegration = async (liteLivePreview: boolean) => {
        const vpHost = document.createElement('div');
        document.body.appendChild(vpHost);
        const vpRoot: Root = createRoot(vpHost);
        const playerRef = React.createRef<import('../src/components/VideoPlayer').VideoPlayerHandle>();
        let vpCommits = 0;
        let finalErrors: string[] = [];

        try {
          await act(async () => {
            vpRoot.render(
              React.createElement(
                NavigationProvider,
                null,
                React.createElement(
                  Profiler,
                  {
                    id: `vp-${liteLivePreview ? 'lite' : 'full'}`,
                    onRender: () => {
                      vpCommits += 1;
                    },
                  },
                  React.createElement(VideoPlayer, {
                    ref: playerRef,
                    streamUrl: 'http://example.test:8080/live/demo/secret/6001.ts',
                    title: 'Canal Teste Live',
                    contentType: 'live',
                    embedded: true,
                    liteLivePreview,
                    onBack: () => {},
                    onPlaybackFinalError: (msg: string) => {
                      finalErrors.push(msg);
                    },
                  })
                )
              )
            );
          });
          await flush(4);

          const videoEl = vpHost.querySelector('video') as HTMLVideoElement;
          assert.ok(videoEl, 'VideoPlayer deve renderizar <video>');
          const vState = setupSyntheticVideoMetrics(videoEl);
          videoEl.volume = 0.65;
          videoEl.muted = false;

          act(() => {
            videoEl.dispatchEvent(new Event('loadedmetadata'));
            videoEl.dispatchEvent(new Event('playing'));
          });
          await flush(4);

          const commitsBeforeBurst = vpCommits;
          act(() => {
            vState.duration = 90;
            videoEl.dispatchEvent(new Event('durationchange'));
            for (let i = 1; i <= 4; i++) {
              vState.currentTime = i * 4;
              vState.bufferedEnd = i * 4 + 10;
              videoEl.dispatchEvent(new Event('timeupdate'));
              videoEl.dispatchEvent(new Event('progress'));
            }
          });
          await flush(4);
          const previewBurstCommits = vpCommits - commitsBeforeBurst;

          if (liteLivePreview) {
            assert.strictEqual(
              previewBurstCommits,
              0,
              `VideoPlayer em preview Live Lite deve ter 0 commits em rajada de tempo/buffer (atual: ${previewBurstCommits})`
            );

            // Entrar em fullscreen pelo handle real do VideoPlayer
            const loadCountBeforeFs = vState.loadCalls;
            const playCountBeforeFs = vState.playCalls;
            await act(async () => {
              const entered = await playerRef.current!.requestFullscreenImmediate();
              assert.strictEqual(entered, true, 'requestFullscreenImmediate deve entrar em fullscreen');
            });
            await flush(6);

            assert.strictEqual(
              vpHost.querySelector('[data-player-container="true"]')?.getAttribute('data-player-presentation'),
              'full-layer',
              'Player deve entrar em apresentação full-layer'
            );
            assert.strictEqual(vpHost.querySelector('video'), videoEl, 'Mesmo elemento <video> deve ser preservado ao entrar em fullscreen');
            assert.strictEqual(vState.loadCalls, loadCountBeforeFs, 'Fullscreen não pode disparar video.load()');
            assert.strictEqual(vState.playCalls, playCountBeforeFs, 'Fullscreen não pode reiniciar video.play()');

            // Em fullscreen, timeupdate/progress voltam a gerar atualizações React
            const commitsInFsBefore = vpCommits;
            act(() => {
              vState.currentTime = 30;
              vState.bufferedEnd = 45;
              videoEl.dispatchEvent(new Event('timeupdate'));
              videoEl.dispatchEvent(new Event('progress'));
            });
            await flush(4);
            assert.ok(
              vpCommits > commitsInFsBefore,
              'Entrar em fullscreen deve restaurar publicação de métricas no VideoPlayer'
            );

            // Voltar ao preview Lite via exitFullscreenImmediate
            await act(async () => {
              const exited = await playerRef.current!.exitFullscreenImmediate();
              assert.strictEqual(exited, true, 'exitFullscreenImmediate deve retornar ao preview');
            });
            await flush(6);

            assert.strictEqual(
              vpHost.querySelector('[data-player-container="true"]')?.getAttribute('data-player-presentation'),
              'compact-preview',
              'Player deve retornar para apresentação compact-preview'
            );
            assert.strictEqual(vpHost.querySelector('video'), videoEl, 'Mesmo elemento <video> deve ser preservado ao retornar ao preview');
            assert.strictEqual(vState.loadCalls, loadCountBeforeFs, 'Retornar ao preview não pode disparar video.load()');
            assert.strictEqual(vState.playCalls, playCountBeforeFs, 'Retornar ao preview não pode reiniciar video.play()');
            assert.strictEqual(videoEl.volume, 0.65, 'Volume do vídeo deve ser preservado na transição');
            assert.strictEqual(videoEl.muted, false, 'Estado muted deve ser preservado na transição');

            // Supressão restaurada no preview Lite
            const commitsBackInPreview = vpCommits;
            act(() => {
              vState.currentTime = 42;
              vState.bufferedEnd = 60;
              videoEl.dispatchEvent(new Event('timeupdate'));
              videoEl.dispatchEvent(new Event('progress'));
            });
            await flush(4);
            assert.strictEqual(
              vpCommits - commitsBackInPreview,
              0,
              'Voltar ao preview Lite deve restaurar a supressão de métricas visuais no VideoPlayer'
            );

            // Buffering e Erro continuam exibidos no preview Lite
            act(() => {
              videoEl.dispatchEvent(new Event('waiting'));
            });
            await flush(4);
            assert.ok(
              vpHost.querySelector('.animate-spin'),
              'Spinner de buffering deve continuar aparecendo no preview Lite'
            );

            act(() => {
              vState.error = { code: 2 };
              videoEl.dispatchEvent(new Event('error'));
            });
            await flush(4);
            assert.ok(
              vpHost.querySelector('[data-player-error-overlay="true"]'),
              'Overlay de erro deve continuar funcionando no preview Lite'
            );
            assert.strictEqual(finalErrors.length, 1, 'onPlaybackFinalError deve continuar sendo disparado');
          } else {
            // 7. Modo Full preserva comportamento original (métricas publicadas normalmente no preview)
            assert.ok(
              previewBurstCommits > 0,
              `VideoPlayer em modo Full deve preservar publicação original de métricas (atual: ${previewBurstCommits})`
            );
          }
        } finally {
          await act(async () => {
            vpRoot.unmount();
          });
          vpHost.remove();
        }
      };

      await runVideoPlayerIntegration(true);
      await runVideoPlayerIntegration(false);
    }
  );

  // --------------------------------------------------------------------------
  // Cenário I: Preview TV ampliado (100%, limite ~42dvh, EPG visível/rolável),
  // seletor compacto de qualidade, preservação do <video> e layout mobile
  // --------------------------------------------------------------------------
  await runCase(
    '9. Preview TV ampliado acima das informações com limite ~42dvh, seletor compacto de qualidade (D-pad/Back/troca de canal/preservação de <video>) e mobile preservado',
    async () => {
      // 1-4 & 13. Métricas de layout em TV (720p, 1080p, viewport baixa), desktop padrão e mobile
      const tv720 = computeLiveTvLayoutMetrics({
        viewportWidth: 1280,
        viewportHeight: 720,
        uiScale: 1,
        displayMode: 'tv',
        isGrouped: true,
        hasNowPlaying: true,
        epgCount: 12,
      });
      const default720 = computeLiveTvLayoutMetrics({
        viewportWidth: 1280,
        viewportHeight: 720,
        uiScale: 1,
        displayMode: 'default',
        isGrouped: true,
        hasNowPlaying: true,
        epgCount: 12,
      });
      const tvShortViewport = computeLiveTvLayoutMetrics({
        viewportWidth: 1280,
        viewportHeight: 540,
        uiScale: 1,
        displayMode: 'tv',
        isGrouped: true,
        hasNowPlaying: true,
        epgCount: 12,
      });
      const mobileMetrics = computeLiveTvLayoutMetrics({
        viewportWidth: 390,
        viewportHeight: 844,
        uiScale: 1,
        displayMode: 'default',
        isGrouped: true,
        hasNowPlaying: true,
        epgCount: 12,
      });

      // TV: direção vertical na seção superior e preview ampliado usando largura interna da coluna direita
      assert.strictEqual(
        tv720.topSectionDirection,
        'column',
        'Apresentação TV deve usar direção vertical (column) na seção superior'
      );
      assert.strictEqual(
        default720.topSectionDirection,
        'row',
        'Apresentação desktop não-TV deve preservar direção horizontal (row)'
      );
      assert.ok(
        tv720.previewWidth > default720.previewWidth * 1.8,
        `Preview TV deve ter largura ampliada no painel direito (TV=${tv720.previewWidth}px vs Default=${default720.previewWidth}px)`
      );
      assert.ok(
        tv720.previewWidth >= tv720.rightPaneWidth - 40,
        `Preview TV deve ocupar praticamente toda a largura interna da coluna direita (${tv720.previewWidth}/${tv720.rightPaneWidth})`
      );
      // Limite proporcional ~42dvh em telas de altura padrão e baixa
      assert.ok(
        tv720.previewHeight <= Math.round(720 * 0.42),
        `Altura do preview em 720p deve respeitar limite de ~42% (${tv720.previewHeight}px)`
      );
      assert.ok(
        tvShortViewport.previewHeight <= Math.round(540 * 0.42),
        `Altura do preview em viewport baixa (540px) deve ser limitada a ~42% (${tvShortViewport.previewHeight}px)`
      );
      assert.ok(
        tvShortViewport.previewHeight < tv720.previewHeight,
        'Viewport mais baixa deve reduzir proporcionalmente a altura do preview'
      );
      // EPG continua visível e rolável em TV (inclusive viewport baixa)
      assert.ok(
        tv720.epgSectionHeight >= 260 && tv720.epgScrollViewportHeight >= 220 && tv720.epgMaxScrollTop > 0,
        'EPG em TV 720p deve manter altura utilizável e rolagem independente'
      );
      assert.ok(
        tvShortViewport.epgSectionHeight >= 260 &&
          tvShortViewport.epgScrollViewportHeight >= 220 &&
          tvShortViewport.epgMaxScrollTop > 0,
        'EPG em TV com pouca altura deve continuar visível e rolável'
      );
      // Mobile preservado
      assert.strictEqual(mobileMetrics.isMobile, true, 'Layout mobile deve continuar detectado abaixo de 768px');
      assert.strictEqual(mobileMetrics.topSectionDirection, 'column', 'Layout mobile deve continuar em coluna');
      assert.strictEqual(mobileMetrics.rightPaneWidth, 390, 'Painel mobile deve ocupar 100% da viewport');
      assert.ok(mobileMetrics.epgScrollViewportHeight >= 220, 'EPG mobile deve continuar rolável');

      // Verificar regras CSS críticas de apresentação TV em src/index.css
      const indexCss = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
      const tvTopSectionBlock = indexCss.match(
        /html\[data-display-mode="tv"\]\s+\.nc-live-top-section\s*\{[^}]*\}/
      )?.[0];
      const tvPreviewBoxBlock = indexCss.match(
        /html\[data-display-mode="tv"\]\s+\.nc-live-preview-box\s*\{[^}]*\}/
      )?.[0];
      const tvRightPaneBlock = indexCss.match(
        /html\[data-display-mode="tv"\]\s+\.nc-live-right-pane\s*\{[^}]*\}/
      )?.[0];
      assert.ok(
        tvTopSectionBlock?.includes('flex-direction: column-reverse !important'),
        'CSS TV deve inverter .nc-live-top-section para exibir preview acima das informações'
      );
      assert.ok(
        tvPreviewBoxBlock?.includes('width: 100% !important') &&
          tvPreviewBoxBlock?.includes('42dvh') &&
          !tvPreviewBoxBlock?.includes('clamp('),
        'CSS TV deve substituir clamp estreito por width: 100% e limite em torno de 42dvh'
      );
      assert.ok(
        tvRightPaneBlock?.includes('overflow-y: auto !important'),
        'CSS TV deve permitir rolagem vertical do painel direito em telas baixas ou escala elevada'
      );

      // 5-12. Fluxo completo no DOM de LiveTvView em modo TV + Lite
      const catalog = buildLargeLiveCatalog();
      // Canal agrupado no índice 0 (SD/HD/FHD) e canal único (sem variantes extras) no índice 1
      catalog.liveStreams.unshift(
        {
          num: 951,
          name: 'Canal Premium SD',
          stream_type: 'live',
          stream_id: 951,
          stream_icon: '',
          epg_channel_id: '',
          added: '1700000000',
          category_id: '1',
          custom_sid: '',
          tv_archive: 0,
          direct_source: '',
          tv_archive_duration: 0,
        },
        {
          num: 952,
          name: 'Canal Premium HD',
          stream_type: 'live',
          stream_id: 952,
          stream_icon: '',
          epg_channel_id: '',
          added: '1700000000',
          category_id: '1',
          custom_sid: '',
          tv_archive: 0,
          direct_source: '',
          tv_archive_duration: 0,
        },
        {
          num: 953,
          name: 'Canal Premium FHD',
          stream_type: 'live',
          stream_id: 953,
          stream_icon: '',
          epg_channel_id: '',
          added: '1700000000',
          category_id: '1',
          custom_sid: '',
          tv_archive: 0,
          direct_source: '',
          tv_archive_duration: 0,
        },
        {
          num: 954,
          name: 'Canal Unico HD',
          stream_type: 'live',
          stream_id: 954,
          stream_icon: '',
          epg_channel_id: '',
          added: '1700000000',
          category_id: '1',
          custom_sid: '',
          tv_archive: 0,
          direct_source: '',
          tv_archive_duration: 0,
        }
      );

      resetEnv(true, 'tv', 'remote', 'lite');
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

      try {
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
                    'div',
                    null,
                    React.createElement(
                      'header',
                      { 'data-nav-zone': 'header' },
                      React.createElement(
                        'button',
                        {
                          type: 'button',
                          'data-nav-item': 'true',
                          'data-header-nav-id': 'live',
                          'data-header-nav-active': 'true',
                        },
                        'TV ao Vivo'
                      )
                    ),
                    React.createElement(LiveTvView)
                  )
                )
              )
            )
          );
        });
        await flush(6);

        const ch0Btn = host.querySelector<HTMLButtonElement>(
          '[data-home-row-index="0"] button[data-live-channel-btn="true"][data-row-card-index="0"]'
        )!;
        const ch1Btn = host.querySelector<HTMLButtonElement>(
          '[data-home-row-index="0"] button[data-live-channel-btn="true"][data-row-card-index="1"]'
        )!;
        const liveHeaderBtn = host.querySelector<HTMLButtonElement>(
          'button[data-header-nav-id="live"]'
        )!;
        const leftPane = host.querySelector<HTMLElement>(
          '.nc-live-left-pane[data-nav-zone="categories"]'
        )!;
        assert.ok(ch0Btn && ch1Btn, 'Canais agrupado e único devem estar montados na linha 0');

        // Seleciona canal agrupado (SD/HD/FHD)
        act(() => {
          focusElementSafely(ch0Btn);
          ch0Btn.click();
        });
        await flush(6);

        // Verifica estrutura DOM: apenas 1 <video>, preview dentro de top-section, EPG presente, mobile back preservado
        const allVideos = host.querySelectorAll('video');
        assert.strictEqual(allVideos.length, 1, 'Deve existir exatamente um elemento <video> no preview');
        const initialVideoEl = allVideos[0];
        assert.ok(
          host.querySelector('[data-live-top-section="true"] [data-live-preview-column="true"] video') ===
            initialVideoEl,
          'Preview existente deve permanecer dentro de data-live-preview-column'
        );
        assert.ok(
          host.querySelector('[data-live-epg-section="true"] [data-epg-scroll="true"]'),
          'Grade de Programação com container rolável deve permanecer montada'
        );
        assert.ok(
          host.querySelector('[data-mobile-back="true"]'),
          'Controle de retorno mobile deve permanecer preservado'
        );

        // 5. Seletor compacto inicia fechado e sem elementos ocultos na navegação
        const trigger = host.querySelector<HTMLButtonElement>('[data-live-quality-trigger="true"]')!;
        assert.ok(trigger, 'Botão compacto de qualidade deve existir para canal com múltiplas variantes');
        assert.strictEqual(trigger.getAttribute('aria-expanded'), 'false');
        assert.ok(
          trigger.textContent?.includes('Qualidade: Automático'),
          `Trigger inicial deve exibir Qualidade: Automático (atual: ${trigger.textContent})`
        );
        assert.strictEqual(
          host.querySelector('[data-live-quality-menu="true"]'),
          null,
          'Menu de qualidade não deve existir no DOM enquanto fechado'
        );
        assert.strictEqual(
          host.querySelectorAll('[data-live-quality-option]').length,
          0,
          'Nenhuma opção oculta deve participar da navegação D-pad enquanto o menu estiver fechado'
        );

        // 6. Abrir menu mostra Automático + variantes e move foco para opção ativa
        act(() => {
          focusElementSafely(trigger);
          trigger.click();
        });
        await flush(6);
        const menu = host.querySelector<HTMLElement>('[data-live-quality-menu="true"]')!;
        assert.ok(menu, 'Menu de qualidade deve abrir ao acionar o trigger');
        assert.strictEqual(trigger.getAttribute('aria-expanded'), 'true');
        const options = Array.from(
          menu.querySelectorAll<HTMLButtonElement>('button[data-live-quality-option]')
        );
        const optionLabels = options.map((o) => o.textContent?.trim());
        assert.deepStrictEqual(
          optionLabels,
          ['Automático', 'FHD', 'HD', 'SD'],
          `Menu deve listar Automático e variantes do canal (atual: ${JSON.stringify(optionLabels)})`
        );
        assert.strictEqual(
          options[0].getAttribute('data-variant-active'),
          'true',
          'Automático deve estar marcado como opção ativa'
        );
        assert.strictEqual(
          document.activeElement,
          options[0],
          'Ao abrir o menu, o foco deve ir para a opção ativa'
        );
        assert.strictEqual(
          host.querySelector('video'),
          initialVideoEl,
          'Abrir o menu de qualidade não pode recriar o elemento <video>'
        );

        // 7. Navegação D-pad (ArrowDown / ArrowUp / ArrowLeft / ArrowRight) sem vazar foco
        await dispatchArrow('ArrowDown');
        assert.strictEqual(document.activeElement, options[1], 'ArrowDown deve mover para FHD');
        await dispatchArrow('ArrowDown');
        assert.strictEqual(document.activeElement, options[2], 'ArrowDown deve mover para HD');
        await dispatchArrow('ArrowLeft');
        assert.ok(
          menu.contains(document.activeElement),
          'ArrowLeft no menu aberto não pode vazar foco para canais ou EPG'
        );
        await dispatchArrow('ArrowRight');
        assert.ok(
          menu.contains(document.activeElement),
          'ArrowRight no menu aberto não pode vazar foco para fora do menu'
        );
        await dispatchArrow('ArrowUp');
        assert.strictEqual(document.activeElement, options[1], 'ArrowUp deve retornar para FHD');

        // 9. Back fecha sem alterar resolução e restaura foco ao botão compacto
        act(() => {
          executeBackAction();
        });
        await flush(6);
        assert.strictEqual(
          host.querySelector('[data-live-quality-menu="true"]'),
          null,
          'Back deve fechar o menu de qualidade'
        );
        assert.strictEqual(
          document.activeElement,
          trigger,
          'Back deve restaurar foco ao botão compacto de qualidade'
        );
        assert.ok(
          trigger.textContent?.includes('Qualidade: Automático'),
          'Back não deve alterar a resolução ativa'
        );
        assert.strictEqual(
          host.querySelector('video'),
          initialVideoEl,
          'Fechar menu via Back deve manter exatamente o mesmo elemento <video>'
        );

        // 8 & 11. Seleção manual de HD aplica variante, fecha menu, restaura foco e preserva o mesmo <video>
        act(() => {
          trigger.click();
        });
        await flush(6);
        const menuForSelect = host.querySelector<HTMLElement>('[data-live-quality-menu="true"]')!;
        const hdOption = Array.from(
          menuForSelect.querySelectorAll<HTMLButtonElement>('button[data-live-quality-option]')
        ).find((btn) => btn.textContent?.trim() === 'HD')!;
        assert.ok(hdOption, 'Opção HD deve existir no menu');
        act(() => {
          hdOption.click();
        });
        await flush(6);
        assert.strictEqual(
          host.querySelector('[data-live-quality-menu="true"]'),
          null,
          'Selecionar HD deve fechar o menu'
        );
        assert.ok(
          trigger.textContent?.includes('Qualidade: HD'),
          `Trigger deve exibir Qualidade: HD após seleção manual (atual: ${trigger.textContent})`
        );
        assert.strictEqual(
          document.activeElement,
          trigger,
          'Selecionar opção deve restaurar foco ao botão compacto'
        );
        assert.strictEqual(
          host.querySelector('video'),
          initialVideoEl,
          'Selecionar variante pelo seletor compacto deve preservar exatamente o mesmo <video>'
        );

        // Clique fora fecha o menu
        act(() => {
          trigger.click();
        });
        await flush(4);
        assert.ok(host.querySelector('[data-live-quality-menu="true"]'), 'Menu deve reabrir');
        const epgHeader = host.querySelector<HTMLElement>('[data-live-epg-header="true"]')!;
        act(() => {
          epgHeader.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        });
        await flush(4);
        assert.strictEqual(
          host.querySelector('[data-live-quality-menu="true"]'),
          null,
          'Clique fora deve fechar o menu compacto de qualidade'
        );

        // 12. Cabeçalho TV ao Vivo + ArrowDown continua retornando às categorias mesmo após seleção manual
        act(() => {
          focusElementSafely(liveHeaderBtn);
        });
        await flush();
        await dispatchArrow('ArrowDown');
        assert.ok(
          document.activeElement && leftPane.contains(document.activeElement),
          'Cabeçalho TV ao Vivo + ArrowDown deve continuar retornando às categorias'
        );

        // 10. Trocar de canal fecha o menu aberto (e canal sem múltiplas variantes oculta o controle)
        act(() => {
          focusElementSafely(trigger);
          trigger.click();
        });
        await flush(4);
        assert.ok(
          host.querySelector('[data-live-quality-menu="true"]'),
          'Menu deve estar aberto antes da troca de canal'
        );
        act(() => {
          ch1Btn.click();
        });
        await flush(6);
        assert.strictEqual(
          host.querySelector('[data-live-quality-menu="true"]'),
          null,
          'Trocar de canal deve fechar qualquer menu de qualidade aberto'
        );
        assert.strictEqual(
          host.querySelector('[data-live-quality-trigger="true"]'),
          null,
          'Canal com apenas uma variante não deve exibir o controle compacto de qualidade'
        );
        assert.strictEqual(
          host.querySelector('video'),
          initialVideoEl,
          'Troca de canal no preview deve manter o mesmo elemento <video> sem recriar player'
        );
      } finally {
        await act(async () => {
          root.unmount();
        });
        host.remove();
      }
    }
  );

  clearTimeout(watchdog);
  if (executed === 0) {
    console.error('ERRO: Nenhum cenário foi executado em test-live-tv-nav.');
    process.exit(1);
  }
  console.log(
    `\nSucesso: ${passed}/${executed} cenário(s) executado(s) passaram em test-live-tv-nav${
      targetCaseNumber !== null ? ` (filtro NC_LIVE_TV_NAV_CASE=${targetCaseNumber})` : ''
    }.`
  );
  process.exit(0);
}

runTests().catch((err) => {
  clearTimeout(watchdog);
  console.error('FALHA em test-live-tv-nav:', err);
  process.exit(1);
});
