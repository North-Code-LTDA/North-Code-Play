import assert from 'node:assert';
import { Window } from 'happy-dom';
import React, { act, Profiler } from 'react';
import { createRoot, Root } from 'react-dom/client';

const IS_BASELINE_MODE = process.argv.includes('--baseline');

// Watchdog de segurança para evitar travamentos em ambiente simulado
const watchdog = setTimeout(() => {
  console.error('TIMEOUT: test-live-tv-epg-assets excedeu 25s');
  process.exit(1);
}, 25000);
watchdog.unref();

// ============================================================================
// 1. Ambiente DOM determinístico (happy-dom) com viewport configurável (720p / 1080p)
// ============================================================================
let viewportWidth = 1280;
let viewportHeight = 720;

const windowInstance = new Window({
  url: 'http://localhost:3000',
  width: viewportWidth,
  height: viewportHeight,
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

function setSimulatedViewport(width: number, height: number) {
  viewportWidth = width;
  viewportHeight = height;
  Object.defineProperty(windowInstance, 'innerWidth', {
    value: width,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(windowInstance, 'innerHeight', {
    value: height,
    writable: true,
    configurable: true,
  });
}
setSimulatedViewport(1280, 720);

(globalThis as any).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// IntersectionObserver determinístico com suporte real a root + rootMargin
interface MockIOInstance {
  callback: IntersectionObserverCallback;
  root: Element | null;
  rootMargin: string;
  targets: Set<Element>;
}
const activeIOInstances = new Set<MockIOInstance>();

function parseMockMargin(raw: string): { top: number; right: number; bottom: number; left: number } {
  const parts = (raw || '0px')
    .trim()
    .split(/\s+/)
    .map((p) => {
      const n = parseFloat(p);
      return Number.isFinite(n) ? n : 0;
    });
  if (parts.length === 1) return { top: parts[0], right: parts[0], bottom: parts[0], left: parts[0] };
  if (parts.length === 2) return { top: parts[0], right: parts[1], bottom: parts[0], left: parts[1] };
  if (parts.length === 3) return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[1] };
  return { top: parts[0] ?? 0, right: parts[1] ?? 0, bottom: parts[2] ?? 0, left: parts[3] ?? 0 };
}

class DeterministicIntersectionObserver {
  private rec: MockIOInstance;
  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.rec = {
      callback,
      root: (options?.root as Element | null) ?? null,
      rootMargin: options?.rootMargin ?? '0px',
      targets: new Set<Element>(),
    };
    activeIOInstances.add(this.rec);
  }
  observe(target: Element) {
    this.rec.targets.add(target);
  }
  unobserve(target: Element) {
    this.rec.targets.delete(target);
  }
  disconnect() {
    this.rec.targets.clear();
    activeIOInstances.delete(this.rec);
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

function flushIntersectionObservers() {
  for (const inst of Array.from(activeIOInstances)) {
    if (inst.targets.size === 0) continue;
    const margins = parseMockMargin(inst.rootMargin);
    const rootRect = inst.root
      ? inst.root.getBoundingClientRect()
      : ({
          top: 0,
          left: 0,
          right: viewportWidth,
          bottom: viewportHeight,
          width: viewportWidth,
          height: viewportHeight,
        } as DOMRect);

    const entries: IntersectionObserverEntry[] = [];
    for (const target of Array.from(inst.targets)) {
      if (!(target as HTMLElement).isConnected) continue;
      const r = target.getBoundingClientRect();
      const horizOverlap =
        r.right >= rootRect.left - margins.left && r.left <= rootRect.right + margins.right;
      const vertOverlap =
        r.bottom >= rootRect.top - margins.top && r.top <= rootRect.bottom + margins.bottom;
      const isIntersecting = r.width > 0 && r.height > 0 && horizOverlap && vertOverlap;
      entries.push({
        target,
        isIntersecting,
        intersectionRatio: isIntersecting ? 1 : 0,
        boundingClientRect: r,
        intersectionRect: r,
        rootBounds: rootRect,
        time: performance.now(),
      } as IntersectionObserverEntry);
    }
    if (entries.length > 0) {
      inst.callback(entries, {} as IntersectionObserver);
    }
  }
}

(globalThis as any).IntersectionObserver = DeterministicIntersectionObserver;
(windowInstance as any).IntersectionObserver = DeterministicIntersectionObserver;

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

if (typeof (globalThis as any).requestAnimationFrame !== 'function') {
  (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), 8) as unknown as number;
  (globalThis as any).cancelAnimationFrame = (id: number) =>
    clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
}
(windowInstance as any).requestAnimationFrame = (globalThis as any).requestAnimationFrame;
(windowInstance as any).cancelAnimationFrame = (globalThis as any).cancelAnimationFrame;

// ============================================================================
// 2. Geometria determinística vinculada à escala TV e viewport real
// ============================================================================
function getCurrentRemPx(): number {
  const mode = document.documentElement.getAttribute('data-display-mode');
  if (mode === 'tv') {
    const raw = parseFloat(document.documentElement.style.getPropertyValue('--nc-ui-scale') || '');
    const ratio = Number.isFinite(raw) && raw > 0 ? Math.max(0.5, Math.min(1.25, raw)) : 0.85;
    return 16 * ratio;
  }
  return 16;
}

function getMockGeometryMetrics() {
  const remPx = getCurrentRemPx();
  const scaleRatio = remPx / 16;
  const headerTop = Math.round((68 + 56) * scaleRatio);
  const leftPaneWidth = Math.round(viewportWidth * 0.5);
  const leftScrollWidth = Math.max(260, leftPaneWidth - Math.round(3 * remPx));
  const leftScrollHeight = Math.max(240, viewportHeight - headerTop);
  const rowStride = Math.max(88, Math.round(9.15 * remPx));
  const rowHeight = Math.max(76, Math.round(7.9 * remPx));
  const cardWidth = Math.round(16.75 * remPx);
  const cardGap = Math.round(0.75 * remPx);
  const cardStride = cardWidth + cardGap;
  const cardHeight = Math.round(5.15 * remPx);
  return {
    headerTop,
    leftScrollWidth,
    leftScrollHeight,
    rowStride,
    rowHeight,
    cardWidth,
    cardGap,
    cardStride,
    cardHeight,
  };
}

function makeRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON() {
      return { left, top, right: left + width, bottom: top + height, width, height };
    },
  } as DOMRect;
}

function computeRectForElement(el: HTMLElement): DOMRect {
  const m = getMockGeometryMetrics();
  if (el.getAttribute('data-showcase-rows-container') === 'true') {
    return makeRect(0, m.headerTop, m.leftScrollWidth, m.leftScrollHeight);
  }
  if (el.getAttribute('data-live-category-row-scroll') === 'true') {
    const sec = el.closest('[data-home-row-index]') as HTMLElement | null;
    const rowIdx = Number(sec?.getAttribute('data-home-row-index') ?? '0');
    const leftScroll = el.closest('[data-showcase-rows-container="true"]') as HTMLElement | null;
    const scrollTop = leftScroll?.scrollTop || 0;
    const top = m.headerTop + rowIdx * m.rowStride + 26 - scrollTop;
    return makeRect(0, top, m.leftScrollWidth, m.cardHeight + 12);
  }
  if (el.hasAttribute('data-home-row-index')) {
    const rowIdx = Number(el.getAttribute('data-home-row-index') ?? '0');
    const leftScroll = el.closest('[data-showcase-rows-container="true"]') as HTMLElement | null;
    const scrollTop = leftScroll?.scrollTop || 0;
    const top = m.headerTop + rowIdx * m.rowStride - scrollTop;
    return makeRect(0, top, m.leftScrollWidth, m.rowHeight);
  }
  if (el.getAttribute('data-live-channel-card') === 'true') {
    const cardIdx = Number(el.getAttribute('data-virtual-index') ?? '0');
    const rowScroll = el.closest('[data-live-category-row-scroll="true"]') as HTMLElement | null;
    const sec = el.closest('[data-home-row-index]') as HTMLElement | null;
    const rowIdx = Number(sec?.getAttribute('data-home-row-index') ?? '0');
    const leftScroll = el.closest('[data-showcase-rows-container="true"]') as HTMLElement | null;
    const scrollTop = leftScroll?.scrollTop || 0;
    const scrollLeft = rowScroll?.scrollLeft || 0;
    const top = m.headerTop + rowIdx * m.rowStride + 26 - scrollTop;
    const left = cardIdx * m.cardStride - scrollLeft;
    return makeRect(left, top, m.cardWidth, m.cardHeight);
  }
  if (el.getAttribute('data-live-channel-btn') === 'true') {
    const card = el.closest('[data-live-channel-card="true"]') as HTMLElement | null;
    if (card) {
      const r = computeRectForElement(card);
      return makeRect(r.left, r.top, Math.max(120, r.width - 42), r.height);
    }
  }
  if (el.getAttribute('data-live-channel-fav') === 'true') {
    const card = el.closest('[data-live-channel-card="true"]') as HTMLElement | null;
    if (card) {
      const r = computeRectForElement(card);
      return makeRect(r.left + Math.max(120, r.width - 42), r.top + 16, 36, 36);
    }
  }
  return makeRect(0, 0, 100, 40);
}

const proto = (windowInstance.HTMLElement as any).prototype;
proto.animate = undefined;
const videoProto = (windowInstance as any).HTMLMediaElement?.prototype;
if (videoProto) {
  videoProto.play = () => Promise.resolve();
  videoProto.pause = () => {};
  videoProto.load = () => {};
}
proto.getBoundingClientRect = function (this: HTMLElement) {
  return computeRectForElement(this);
};
Object.defineProperty(proto, 'clientWidth', {
  configurable: true,
  get(this: HTMLElement) {
    return computeRectForElement(this).width;
  },
});
Object.defineProperty(proto, 'clientHeight', {
  configurable: true,
  get(this: HTMLElement) {
    return computeRectForElement(this).height;
  },
});
Object.defineProperty(proto, 'offsetWidth', {
  configurable: true,
  get(this: HTMLElement) {
    return computeRectForElement(this).width;
  },
});
Object.defineProperty(proto, 'offsetHeight', {
  configurable: true,
  get(this: HTMLElement) {
    return computeRectForElement(this).height;
  },
});
Object.defineProperty(proto, 'scrollWidth', {
  configurable: true,
  get(this: HTMLElement) {
    if (this.getAttribute('data-live-category-row-scroll') === 'true') {
      const m = getMockGeometryMetrics();
      const cards = this.querySelectorAll('[data-live-channel-card="true"]').length;
      const spacers = Array.from(this.querySelectorAll<HTMLElement>('[data-virtual-spacer]')).reduce(
        (acc, sp) => acc + (parseFloat(sp.style.width || '0') || 0),
        0
      );
      return Math.max(m.leftScrollWidth, cards * m.cardStride + spacers);
    }
    return computeRectForElement(this).width;
  },
});
Object.defineProperty(proto, 'scrollHeight', {
  configurable: true,
  get(this: HTMLElement) {
    if (this.getAttribute('data-showcase-rows-container') === 'true') {
      const total = Number(this.getAttribute('data-showcase-total-rows') || '0');
      return Math.max(getMockGeometryMetrics().leftScrollHeight, total * getMockGeometryMetrics().rowStride);
    }
    return computeRectForElement(this).height;
  },
});
proto.scrollIntoView = function () {};
proto.scrollTo = function (this: HTMLElement, arg1: any, arg2?: number) {
  if (typeof arg1 === 'object' && arg1 !== null) {
    if (typeof arg1.left === 'number') this.scrollLeft = arg1.left;
    if (typeof arg1.top === 'number') this.scrollTop = arg1.top;
  } else if (typeof arg1 === 'number') {
    this.scrollLeft = arg1;
    if (typeof arg2 === 'number') this.scrollTop = arg2;
  }
};

// ============================================================================
// 3. Imports do aplicativo e instrumentação determinística de EPG (sem rede real)
// ============================================================================
const { XtreamCredentialsContext, XtreamLiveContext } = await import('../src/context/XtreamContext');
const { XtreamService } = await import('../src/services/xtreamService');
const {
  resetLiveEpgCacheForTest,
  setLiveEpgClockForTest,
  setLiveEpgConcurrencyLimitForTest,
  getCachedLiveEpgSnapshot,
} = await import('../src/utils/liveEpgManager');
const { clearLoadedImageUrlCache, hasLoadedImageUrl } = await import('../src/components/MediaImage');
const { LiveTvView } = await import('../src/views/LiveTvView');
const { NavigationProvider, setNavMode, focusElementSafely } = await import('../src/navigation');
const { setAndroidPlatformOverrideForDpadTest } = await import('../src/navigation/navigationPlatformPolicy');
const { confirmDisplayPreferences, syncDocumentDisplayAttributes } = await import(
  '../src/platform/tvEnvironment'
);
const {
  initPerformanceProfile,
  setPerformanceProfilePreference,
  resetPerformanceProfileCacheForTest,
} = await import('../src/platform/performanceProfile');

// Intercepta XtreamService.getShortEpg para 100% de determinismo sem chamadas externas
interface EpgCallRecord {
  streamId: number;
  atMs: number;
}
let epgCalls: EpgCallRecord[] = [];
type EpgHandler = (streamId: number) => Promise<{ epg_listings: any[] }>;

const BASE_NOW_MS = 1760000000000;
let simulatedEpgNowMs = BASE_NOW_MS;
setLiveEpgClockForTest(() => simulatedEpgNowMs);
setLiveEpgConcurrencyLimitForTest(6);

function makeProgramListing(
  streamId: number,
  title: string,
  startMs: number = simulatedEpgNowMs - 15 * 60 * 1000,
  endMs: number = simulatedEpgNowMs + 45 * 60 * 1000,
  description = `Descrição oficial do programa ${title}`
) {
  return {
    id: `prog_${streamId}_${startMs}`,
    title,
    description,
    start_timestamp: Math.floor(startMs / 1000),
    stop_timestamp: Math.floor(endMs / 1000),
    start: '2026-11-21 19:00:00',
    end: '2026-11-21 20:00:00',
  };
}

let customEpgHandler: EpgHandler = async (streamId: number) => ({
  epg_listings: [
    makeProgramListing(streamId, `Programa Ao Vivo #${streamId}`),
    makeProgramListing(
      streamId,
      `Próximo Programa #${streamId}`,
      simulatedEpgNowMs + 45 * 60 * 1000,
      simulatedEpgNowMs + 105 * 60 * 1000
    ),
  ],
});

(XtreamService as any).getShortEpg = async (_creds: any, streamId: number) => {
  epgCalls.push({ streamId: Number(streamId), atMs: performance.now() });
  return customEpgHandler(Number(streamId));
};

function buildSyntheticLiveCatalog() {
  const liveCategories: any[] = [];
  const liveStreams: any[] = [];
  let streamId = 1000;

  for (let c = 0; c < 25; c++) {
    const catId = `cat_${c + 1}`;
    liveCategories.push({
      category_id: catId,
      category_name: `Categoria ${String(c + 1).padStart(2, '0')}`,
      parent_id: 0,
    });
    const count = c === 0 ? 80 : 25;
    for (let ch = 0; ch < count; ch++) {
      streamId += 1;
      const baseName = `Canal ${catId}-${String(ch + 1).padStart(3, '0')}`;
      if (c === 0 && ch === 0) {
        // Canal 0 com variantes SD e HD para testar troca de resolução preservando EPG
        liveStreams.push({
          num: streamId,
          name: `${baseName} SD`,
          stream_type: 'live',
          stream_id: streamId,
          stream_icon: `https://cdn.example.test/logos/ch-${streamId}.png`,
          epg_channel_id: '',
          added: '1700000000',
          category_id: catId,
          custom_sid: '',
          tv_archive: 0,
          direct_source: '',
          tv_archive_duration: 0,
        });
        const hdId = streamId + 50000;
        liveStreams.push({
          num: hdId,
          name: `${baseName} HD`,
          stream_type: 'live',
          stream_id: hdId,
          stream_icon: `https://cdn.example.test/logos/ch-${streamId}.png`,
          epg_channel_id: '',
          added: '1700000000',
          category_id: catId,
          custom_sid: '',
          tv_archive: 0,
          direct_source: '',
          tv_archive_duration: 0,
        });
      } else {
        liveStreams.push({
          num: streamId,
          name: `${baseName} HD`,
          stream_type: 'live',
          stream_id: streamId,
          stream_icon: `https://cdn.example.test/logos/ch-${streamId}.png`,
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

async function waitMs(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
  await flush(4);
}

const origPerfNow = performance.now.bind(performance);
let simulatedClockOffsetMs = 0;
performance.now = () => origPerfNow() + simulatedClockOffsetMs;

async function dispatchKey(key: string, repeat = false): Promise<void> {
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

function resetEnv(
  isAndroid: boolean,
  mode: 'tv' | 'default',
  nav: 'remote' | 'pointer',
  perf: 'auto' | 'lite' | 'full',
  tvScale = 85
) {
  window.localStorage.clear();
  clearLoadedImageUrlCache();
  resetLiveEpgCacheForTest();
  epgCalls = [];
  simulatedEpgNowMs = BASE_NOW_MS;
  document.documentElement.removeAttribute('data-performance-mode');
  document.documentElement.removeAttribute('data-display-mode');
  document.documentElement.style.removeProperty('font-size');
  document.documentElement.style.removeProperty('--nc-ui-scale');
  document.documentElement.style.removeProperty('--nc-ui-scale-pct');
  document.documentElement.style.removeProperty('--nc-rem-compensation');
  setAndroidPlatformOverrideForDpadTest(isAndroid);
  confirmDisplayPreferences(mode, tvScale);
  syncDocumentDisplayAttributes();
  setNavMode(nav);
  resetPerformanceProfileCacheForTest();
  initPerformanceProfile();
  setPerformanceProfilePreference(perf);
}

const TEST_CREDENTIALS = {
  serverUrl: 'http://epg.example.test:8080',
  username: 'demo',
  password: 'secret',
};

async function mountLiveTv(
  catalog: ReturnType<typeof buildSyntheticLiveCatalog>,
  onCommit?: () => void,
  options?: { strictMode?: boolean; onStrictProbe?: (event: 'setup' | 'cleanup') => void }
) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);

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

  const StrictProbe = options?.onStrictProbe
    ? function StrictProbeComponent() {
        React.useEffect(() => {
          options.onStrictProbe?.('setup');
          return () => {
            options.onStrictProbe?.('cleanup');
          };
        }, []);
        return null;
      }
    : null;

  const tree = React.createElement(
    XtreamCredentialsContext.Provider,
    { value: { credentials: TEST_CREDENTIALS } },
    React.createElement(
      XtreamLiveContext.Provider,
      { value: liveContextValue },
      React.createElement(
        NavigationProvider,
        null,
        StrictProbe ? React.createElement(StrictProbe) : null,
        React.createElement(
          Profiler,
          {
            id: 'live-tv-epg-test',
            onRender: () => {
              onCommit?.();
            },
          },
          React.createElement(LiveTvView)
        )
      )
    )
  );

  await act(async () => {
    root.render(options?.strictMode ? React.createElement(React.StrictMode, null, tree) : tree);
  });
  const immediateEpgCallsAfterRender = epgCalls.length;
  await flush(6);

  return {
    host,
    immediateEpgCallsAfterRender,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    },
  };
}

// ============================================================================
// 4. Execução dos cenários (16 requisitos da Fase 3/5)
// ============================================================================
async function runTests() {
  const catalog = buildSyntheticLiveCatalog();
  let passed = 0;

  const runCase = async (name: string, fn: () => Promise<void>) => {
    await fn();
    passed += 1;
    console.log(`  [OK] ${name}`);
  };

  console.log(
    IS_BASELINE_MODE
      ? 'Executando medicao BASELINE (antes da Fase 3) de EPG, imagens e visibilidade...'
      : 'Executando suite direcionada de EPG, logotipos e visibilidade da TV ao Vivo (test-live-tv-epg-assets)...'
  );

  // --------------------------------------------------------------------------
  // Bloco 1: Assinaturas iniciais (Full vs Lite 720p vs Lite 1080p) + commits redundantes (empty)
  // --------------------------------------------------------------------------
  await runCase(
    '1/2/8/14. Comparativo de assinaturas iniciais (Full vs Lite), adaptação à viewport/escala, EPG visível e zero commits redundantes em EPG vazio/idêntico',
    async () => {
      setSimulatedViewport(1280, 720);
      // 1a) Modo Completo (Full): mede baseline exato de assinaturas iniciais e commits com EPG vazio
      customEpgHandler = async () => ({ epg_listings: [] });
      resetEnv(true, 'tv', 'remote', 'full', 85);
      let fullTotalCommits = 0;
      const mountedFull = await mountLiveTv(catalog, () => {
        fullTotalCommits += 1;
      });
      let fullInitialEpgCalls = 0;
      let fullInitialAuthorizedImgs = 0;
      try {
        await waitMs(40);
        fullInitialEpgCalls = epgCalls.length;
        fullInitialAuthorizedImgs = mountedFull.host.querySelectorAll(
          '[data-live-channel-card="true"] img'
        ).length;
      } finally {
        await mountedFull.unmount();
      }

      // 1b) Modo Lite efetivo (720p, escala 85%): mede burst imediato vs pós-estabilização
      customEpgHandler = async (streamId) => ({
        epg_listings: [makeProgramListing(streamId, `Jornal TV ${streamId}`)],
      });
      resetEnv(true, 'tv', 'remote', 'auto', 85);
      let liteCommits = 0;
      const mountedLite720 = await mountLiveTv(catalog, () => {
        liteCommits += 1;
      });
      let liteImmediateEpgCalls = 0;
      let liteSettled720EpgCalls = 0;
      let liteAuthorizedImgs720 = 0;
      try {
        assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'lite');
        liteImmediateEpgCalls = mountedLite720.immediateEpgCallsAfterRender;
        liteAuthorizedImgs720 = mountedLite720.host.querySelectorAll(
          '[data-live-channel-card="true"] img'
        ).length;

        // Aguarda estabilização secundária do Lite (~150ms)
        await waitMs(220);
        liteSettled720EpgCalls = epgCalls.length;

        // Verifica que cards efetivamente visíveis receberam título real de EPG
        const firstCardEpg = mountedLite720.host.querySelector(
          '[data-home-row-index="0"] [data-live-channel-card="true"][data-virtual-index="0"] [data-live-channel-epg="true"]'
        );
        assert.strictEqual(
          firstCardEpg?.textContent?.trim(),
          'Jornal TV 1001',
          'Card visível em Lite deve receber e exibir o título real de EPG'
        );
      } finally {
        await mountedLite720.unmount();
      }

      // 1c) Adaptação dinâmica à viewport maior (1080p, escala 75%) — prova que não usa limite fixo 4x4
      setSimulatedViewport(1920, 1080);
      resetEnv(true, 'tv', 'remote', 'auto', 75);
      const mountedLite1080 = await mountLiveTv(catalog);
      let liteSettled1080EpgCalls = 0;
      try {
        await waitMs(220);
        liteSettled1080EpgCalls = epgCalls.length;
      } finally {
        await mountedLite1080.unmount();
        setSimulatedViewport(1280, 720);
      }

      // 1d) Medição direta de commits redundantes quando EPG retorna vazio (equivalente ao estado inicial)
      const emptyResolvers: Array<(payload: { epg_listings: any[] }) => void> = [];
      customEpgHandler = () =>
        new Promise((resolve) => {
          emptyResolvers.push(resolve);
        });
      resetEnv(true, 'tv', 'remote', 'auto', 85);
      let commitsDuringEmptyEpg = 0;
      let countingEmpty = false;
      const mountedEmpty = await mountLiveTv(catalog, () => {
        if (countingEmpty) commitsDuringEmptyEpg += 1;
      });
      try {
        await waitMs(220);
        assert.ok(emptyResolvers.length > 0, 'Deve haver requisições EPG prontas para resolver como vazio');
        countingEmpty = true;
        await act(async () => {
          while (emptyResolvers.length > 0) {
            emptyResolvers.shift()!({ epg_listings: [] });
          }
          await Promise.resolve();
        });
        await flush(4);
        countingEmpty = false;
        const firstCardEpg = mountedEmpty.host.querySelector(
          '[data-home-row-index="0"] [data-live-channel-card="true"][data-virtual-index="0"] [data-live-channel-epg="true"]'
        );
        assert.strictEqual(
          firstCardEpg?.textContent?.trim(),
          'Programação indisponível',
          'Ausência de EPG deve manter mensagem apropriada no card'
        );
      } finally {
        await mountedEmpty.unmount();
      }

      console.log(
        `    [METRICS] Full mount EPG: ${fullInitialEpgCalls} (imgs: ${fullInitialAuthorizedImgs}) | ` +
          `Lite 720p imediato: ${liteImmediateEpgCalls} | Lite 720p estabilizado: ${liteSettled720EpgCalls} (imgs: ${liteAuthorizedImgs720}) | ` +
          `Lite 1080p estabilizado: ${liteSettled1080EpgCalls} | Commits extras em EPG vazio: ${commitsDuringEmptyEpg} | ` +
          `Full total commits (vazio): ${fullTotalCommits}`
      );

      if (!IS_BASELINE_MODE) {
        assert.ok(
          liteImmediateEpgCalls < fullInitialEpgCalls,
          `Lite não deve disparar rajada inicial igual ao Full (lite imediato=${liteImmediateEpgCalls}, full=${fullInitialEpgCalls})`
        );
        assert.ok(
          liteSettled720EpgCalls < fullInitialEpgCalls,
          `Lite 720p estabilizado deve ativar bem menos assinaturas EPG que Full (lite=${liteSettled720EpgCalls}, full=${fullInitialEpgCalls})`
        );
        assert.ok(
          liteSettled720EpgCalls >= 9 && liteSettled720EpgCalls <= 20,
          `Lite 720p deve corresponder à área visível real (~12-15 cards, atual=${liteSettled720EpgCalls})`
        );
        assert.ok(
          liteSettled1080EpgCalls > liteSettled720EpgCalls,
          `Lite 1080p com escala menor deve ativar mais cards visíveis que 720p (1080p=${liteSettled1080EpgCalls}, 720p=${liteSettled720EpgCalls})`
        );
        assert.ok(
          liteAuthorizedImgs720 < fullInitialAuthorizedImgs,
          `Lite deve autorizar menos logotipos antecipadamente fora da viewport (lite=${liteAuthorizedImgs720}, full=${fullInitialAuthorizedImgs})`
        );
        assert.strictEqual(
          commitsDuringEmptyEpg,
          0,
          `EPG vazio equivalente ao estado inicial não deve gerar re-renders redundantes (atual=${commitsDuringEmptyEpg})`
        );
      }

      // 1e) Web e Android padrão (celular) preservam comportamento original Full
      customEpgHandler = async (streamId) => ({
        epg_listings: [makeProgramListing(streamId, `Web Prog ${streamId}`)],
      });
      resetEnv(false, 'default', 'remote', 'auto', 100);
      const mountedWeb = await mountLiveTv(catalog);
      try {
        assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'full');
        assert.ok(
          epgCalls.length >= 25,
          `Web deve preservar comportamento original Full imediato (atual=${epgCalls.length})`
        );
      } finally {
        await mountedWeb.unmount();
      }

      resetEnv(true, 'default', 'remote', 'lite', 100);
      const mountedPhone = await mountLiveTv(catalog);
      try {
        assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'full');
        assert.ok(
          epgCalls.length >= 25,
          `Android celular/default deve preservar comportamento original Full (atual=${epgCalls.length})`
        );
      } finally {
        await mountedPhone.unmount();
      }
    }
  );

  // --------------------------------------------------------------------------
  // Bloco 2: Prioridade do card focado + prioridade 'high' imediata do painel direito
  // --------------------------------------------------------------------------
  await runCase(
    '3/4/10/11. Card focado recebe prioridade imediata; painel direito mantém priority high imediata, variantes, vazio e erro sem travar navegação',
    async () => {
      setSimulatedViewport(1280, 720);
      customEpgHandler = async (streamId) => {
        if (streamId === 1002) return { epg_listings: [] };
        if (streamId === 1003) throw new Error('Simulated provider EPG timeout');
        return {
          epg_listings: [
            makeProgramListing(streamId, `Destaque ${streamId}`),
            makeProgramListing(
              streamId,
              `Sequência ${streamId}`,
              simulatedEpgNowMs + 45 * 60 * 1000,
              simulatedEpgNowMs + 95 * 60 * 1000
            ),
          ],
        };
      };

      resetEnv(true, 'tv', 'remote', 'auto', 85);
      const mounted = await mountLiveTv(catalog);
      try {
        // Antes de os 150ms dos vizinhos passarem, focar explicitamente o card 4 (fora da janela visível inicial 0..2)
        const card4Btn = mounted.host.querySelector<HTMLButtonElement>(
          '[data-home-row-index="0"] button[data-live-channel-btn="true"][data-row-card-index="4"]'
        )!;
        assert.ok(card4Btn, 'Card 4 deve existir montado na janela horizontal Lite (10 cards)');
        const card4StreamId = Number(card4Btn.getAttribute('data-live-channel-id'));

        // Verifica que o logotipo do card 4 estava diferido em Lite antes do foco
        const card4Wrap = card4Btn.closest('[data-live-channel-card="true"]')!;
        const card4DeferredBeforeFocus = Boolean(
          card4Wrap.querySelector('[data-media-image-deferred="true"]')
        );

        act(() => {
          focusElementSafely(card4Btn);
        });
        await flush(6);

        if (!IS_BASELINE_MODE) {
          assert.strictEqual(
            card4DeferredBeforeFocus,
            true,
            'Card 4 fora da viewport inicial em Lite deve começar com logo diferido'
          );
          assert.ok(
            epgCalls.some((c) => c.streamId === card4StreamId),
            'Card focado em Lite deve disparar EPG imediatamente (prioridade sobre vizinhos)'
          );
          assert.ok(
            card4Wrap.querySelector('img'),
            'Card focado em Lite deve ativar logotipo imediatamente ao receber foco'
          );
        }

        // Seleciona canal 0 (possui variantes SD e HD, streamId EPG canônico = 1001) por OK
        const card0Btn = mounted.host.querySelector<HTMLButtonElement>(
          '[data-home-row-index="0"] button[data-live-channel-btn="true"][data-row-card-index="0"]'
        )!;
        const callsBeforeSelect = epgCalls.length;
        act(() => {
          card0Btn.click();
        });
        await flush(6);

        // Painel direito deve ter iniciado imediatamente (sem esperar 150ms do Lite!)
        const rightTitle = mounted.host.querySelector('[data-live-now-playing-title="true"]');
        const rightTime = mounted.host.querySelector('[data-live-now-playing-time="true"]');
        const rightDesc = mounted.host.querySelector('[data-live-now-playing-desc="true"]');
        const timelineItems = mounted.host.querySelectorAll('[data-epg-item="true"]');
        assert.ok(
          epgCalls.slice(callsBeforeSelect).some((c) => c.streamId === 1001) ||
            Boolean(getCachedLiveEpgSnapshot(TEST_CREDENTIALS, 1001)),
          'Painel direito deve manter subscription imediata priority: high'
        );
        assert.strictEqual(rightTitle?.textContent?.trim(), 'Destaque 1001');
        assert.ok(rightTime?.textContent?.includes('-'), 'Painel direito deve preservar horário');
        assert.ok(rightDesc?.textContent?.includes('Destaque 1001'), 'Painel direito deve preservar descrição');
        assert.strictEqual(timelineItems.length, 2, 'Painel direito deve preservar lista cronológica');

        // Troca de variante de resolução (HD) via seletor compacto mantém EPG intacto
        const qualityTrigger = mounted.host.querySelector<HTMLButtonElement>(
          '[data-live-quality-trigger="true"]'
        );
        assert.ok(qualityTrigger, 'Canal agrupado deve exibir botão compacto de qualidade');
        assert.strictEqual(
          mounted.host.querySelector('[data-live-quality-menu="true"]'),
          null,
          'Menu de qualidade deve iniciar fechado'
        );
        assert.ok(
          qualityTrigger!.textContent?.includes('Automático'),
          'Trigger compacto deve iniciar em Qualidade: Automático'
        );
        act(() => {
          qualityTrigger!.click();
        });
        await flush(4);
        const qualityMenu = mounted.host.querySelector<HTMLElement>(
          '[data-live-quality-menu="true"]'
        );
        assert.ok(qualityMenu, 'Menu compacto de qualidade deve abrir ao acionar o trigger');
        const hdBtn = Array.from(
          qualityMenu!.querySelectorAll<HTMLButtonElement>('[data-live-quality-option]')
        ).find((b) => b.textContent?.trim() === 'HD');
        assert.ok(hdBtn, 'Menu de qualidade deve listar variante HD');
        act(() => {
          hdBtn!.click();
        });
        await flush(4);
        assert.strictEqual(
          mounted.host.querySelector('[data-live-quality-menu="true"]'),
          null,
          'Menu compacto de qualidade deve fechar após selecionar variante HD'
        );
        assert.ok(
          mounted.host
            .querySelector<HTMLButtonElement>('[data-live-quality-trigger="true"]')
            ?.textContent?.includes('HD'),
          'Trigger compacto deve refletir Qualidade: HD após seleção manual'
        );
        assert.strictEqual(
          mounted.host.querySelector('[data-live-now-playing-title="true"]')?.textContent?.trim(),
          'Destaque 1001',
          'Troca de resolução deve preservar EPG do canal selecionado'
        );

        // Canal 1 (stream 1002 = EPG vazio) -> mensagem apropriada no painel direito
        const card1Btn = mounted.host.querySelector<HTMLButtonElement>(
          '[data-home-row-index="0"] button[data-live-channel-btn="true"][data-row-card-index="1"]'
        )!;
        act(() => {
          card1Btn.click();
        });
        await flush(6);
        assert.strictEqual(
          mounted.host.querySelector('[data-epg-state="empty"]')?.textContent?.trim(),
          'Nenhuma programação disponível para este canal.'
        );

        // Canal 2 (stream 1003 = erro de EPG) -> mensagem de erro sem travar D-pad
        const card2Btn = mounted.host.querySelector<HTMLButtonElement>(
          '[data-home-row-index="0"] button[data-live-channel-btn="true"][data-row-card-index="2"]'
        )!;
        act(() => {
          focusElementSafely(card2Btn);
          card2Btn.click();
        });
        await flush(6);
        assert.strictEqual(
          mounted.host.querySelector('[data-epg-state="error"]')?.textContent?.trim(),
          'Programação indisponível no momento.'
        );

        // D-pad continua navegando normalmente após erro de EPG
        await dispatchKey('ArrowRight', false);
        assert.strictEqual(
          document.activeElement?.getAttribute('data-row-card-index'),
          '3',
          'Erro de EPG não pode bloquear navegação por D-pad'
        );
      } finally {
        await mounted.unmount();
      }
    }
  );

  // --------------------------------------------------------------------------
  // Bloco 3: Navegação rápida em Lite não acumula assinaturas pendentes desnecessárias
  // --------------------------------------------------------------------------
  await runCase(
    '5/6. Navegação rápida por D-pad em Lite não acumula assinaturas pendentes e desmontar cancela corretamente',
    async () => {
      setSimulatedViewport(1280, 720);
      customEpgHandler = async (streamId) => ({
        epg_listings: [makeProgramListing(streamId, `Burst ${streamId}`)],
      });

      resetEnv(true, 'tv', 'remote', 'auto', 85);
      const mounted = await mountLiveTv(catalog);
      try {
        const card0Btn = mounted.host.querySelector<HTMLButtonElement>(
          '[data-home-row-index="0"] button[data-live-channel-btn="true"][data-row-card-index="0"]'
        )!;
        act(() => {
          focusElementSafely(card0Btn);
        });
        await flush(2);

        const callsBeforeBurst = epgCalls.length;
        // Dispara rajada rápida de 20 passos horizontais com tecla mantida (<90ms reais entre eventos)
        for (let step = 0; step < 20; step++) {
          await dispatchKey('ArrowRight', true);
          act(() => {
            flushIntersectionObservers();
          });
        }
        const callsRightAfterBurst = epgCalls.length - callsBeforeBurst;

        // Aguarda estabilização final após parar no índice 20
        await waitMs(220);
        const callsAfterSettle = epgCalls.length - callsBeforeBurst;

        const activeIdx = Number(document.activeElement?.getAttribute('data-row-card-index'));
        assert.strictEqual(activeIdx, 20, 'D-pad rápido deve alcançar o card 20 sem regressão');

        const activeCardEpg = document.activeElement
          ?.closest('[data-live-channel-card="true"]')
          ?.querySelector('[data-live-channel-epg="true"]');
        assert.ok(
          activeCardEpg?.textContent?.includes('Burst '),
          'Card onde a navegação parou deve receber seu EPG após estabilizar'
        );

        console.log(
          `    [METRICS] Rajada rápida 20 canais (Lite): durante rajada=${callsRightAfterBurst} reqs | ` +
            `após estabilizar=${callsAfterSettle} reqs`
        );

        if (!IS_BASELINE_MODE) {
          assert.ok(
            callsRightAfterBurst <= 6,
            `Rajada rápida em Lite não deve disparar dezenas de requisições intermediárias (atual=${callsRightAfterBurst})`
          );
          assert.ok(
            callsAfterSettle < 25,
            `Após estabilizar, não deve acumular assinaturas de todos os canais transitórios (atual=${callsAfterSettle})`
          );
        }

        // Desmonta antes de qualquer novo timer disparar e valida cancelamento limpo
        const callsBeforeUnmount = epgCalls.length;
        await mounted.unmount();
        await waitMs(220);
        assert.strictEqual(
          epgCalls.length,
          callsBeforeUnmount,
          'Desmontar a tela/cards deve cancelar todas as assinaturas pendentes sem vazamento'
        );
      } finally {
        if (mounted.host.isConnected) {
          await mounted.unmount();
        }
      }
    }
  );

  // --------------------------------------------------------------------------
  // Bloco 4: Atualização atrasada não contamina outro canal + atualização real vs idêntica
  // --------------------------------------------------------------------------
  await runCase(
    '7/8/9. Resposta atrasada não contamina outro canal; dados idênticos geram 0 commits; mudança real de programa atualiza título',
    async () => {
      setSimulatedViewport(1280, 720);
      const pendingResolvers = new Map<number, (payload: { epg_listings: any[] }) => void>();

      customEpgHandler = (streamId) =>
        new Promise((resolve) => {
          pendingResolvers.set(streamId, resolve);
        });

      resetEnv(true, 'tv', 'remote', 'auto', 85);
      let commits = 0;
      let trackCommits = false;
      const mounted = await mountLiveTv(catalog, () => {
        if (trackCommits) commits += 1;
      });

      try {
        // Seleciona canal 0 (1001) no painel direito — resposta fica pendente
        const card0Btn = mounted.host.querySelector<HTMLButtonElement>(
          '[data-home-row-index="0"] button[data-live-channel-btn="true"][data-row-card-index="0"]'
        )!;
        const card1Btn = mounted.host.querySelector<HTMLButtonElement>(
          '[data-home-row-index="0"] button[data-live-channel-btn="true"][data-row-card-index="1"]'
        )!;

        act(() => {
          card0Btn.click();
        });
        await flush(4);
        assert.ok(pendingResolvers.has(1001), 'Canal 1001 deve ter requisição pendente');

        // Antes de 1001 responder, troca para canal 1 (1002)
        act(() => {
          card1Btn.click();
        });
        await flush(4);
        assert.ok(pendingResolvers.has(1002), 'Canal 1002 deve ter requisição pendente');

        // Resolve 1002 primeiro
        await act(async () => {
          pendingResolvers.get(1002)!({
            epg_listings: [makeProgramListing(1002, 'Programa Oficial 1002')],
          });
        });
        await flush(4);
        assert.strictEqual(
          mounted.host.querySelector('[data-live-now-playing-title="true"]')?.textContent?.trim(),
          'Programa Oficial 1002'
        );

        // Agora resolve 1001 atrasado — NÃO pode contaminar o painel direito (que exibe 1002)!
        await act(async () => {
          pendingResolvers.get(1001)!({
            epg_listings: [makeProgramListing(1001, 'Programa Atrasado 1001')],
          });
        });
        await flush(4);
        assert.strictEqual(
          mounted.host.querySelector('[data-live-now-playing-title="true"]')?.textContent?.trim(),
          'Programa Oficial 1002',
          'Resposta atrasada do canal 1001 não pode contaminar o painel direito do canal 1002'
        );

        // Garante que card 0 também já recebeu o snapshot de 1001 após estabilização
        await waitMs(220);
        // Resolve eventuais pendentes restantes para estabilizar a tela
        await act(async () => {
          pendingResolvers.forEach((resolve, id) => {
            if (id !== 1001 && id !== 1002) {
              resolve({ epg_listings: [makeProgramListing(id, `Programa ${id}`)] });
            }
          });
          pendingResolvers.clear();
        });
        await flush(6);

        const card0EpgEl = mounted.host.querySelector(
          '[data-home-row-index="0"] [data-live-channel-card="true"][data-virtual-index="0"] [data-live-channel-epg="true"]'
        );
        assert.strictEqual(card0EpgEl?.textContent?.trim(), 'Programa Atrasado 1001');

        // Testa 0 commits redundantes ao reentrar visibilidade / re-subscrever com dados idênticos (novo objeto!)
        resetLiveEpgCacheForTest();
        const identicalResolvers: Array<{ streamId: number; resolve: (p: { epg_listings: any[] }) => void }> = [];
        customEpgHandler = (streamId) =>
          new Promise((resolve) => {
            identicalResolvers.push({ streamId, resolve });
          });

        const card0Row = mounted.host.querySelector<HTMLElement>('[data-home-row-index="0"]')!;
        const card0Wrap = card0Btn.closest('[data-live-channel-card="true"]')!;
        const leftScroll = mounted.host.querySelector<HTMLElement>('[data-showcase-rows-container="true"]')!;
        act(() => {
          leftScroll.scrollTop = 900;
          flushIntersectionObservers();
        });
        await flush(4);

        // Reentra linha 0 com handler retornando novo objeto de snapshot porém MESMO título/startMs/endMs
        act(() => {
          leftScroll.scrollTop = 0;
          flushIntersectionObservers();
        });
        await waitMs(220);
        assert.ok(identicalResolvers.length > 0, 'Deve reconsultar EPG após expiração do cache');

        // Conta commits React no momento exato em que os novos objetos idênticos de EPG são entregues
        commits = 0;
        trackCommits = true;
        await act(async () => {
          while (identicalResolvers.length > 0) {
            const item = identicalResolvers.shift()!;
            const sameTitle =
              item.streamId === 1001
                ? 'Programa Atrasado 1001'
                : item.streamId === 1002
                  ? 'Programa Oficial 1002'
                  : `Programa ${item.streamId}`;
            item.resolve({
              epg_listings: [makeProgramListing(item.streamId, sameTitle)],
            });
          }
          await Promise.resolve();
        });
        await flush(4);
        trackCommits = false;
        const identicalEpgCommits = commits;

        // Agora avança o relógio para mudança REAL de programa e valida atualização do título
        resetLiveEpgCacheForTest();
        const nextStart = simulatedEpgNowMs + 60 * 60 * 1000;
        const nextEnd = nextStart + 60 * 60 * 1000;
        simulatedEpgNowMs = nextStart + 5 * 60 * 1000;
        customEpgHandler = async (streamId) => ({
          epg_listings: [makeProgramListing(streamId, `Novo Programa Real ${streamId}`, nextStart, nextEnd)],
        });

        // Reativa visibilidade para reconsultar após expiração do cache
        act(() => {
          leftScroll.scrollTop = 900;
          flushIntersectionObservers();
        });
        await flush(4);
        act(() => {
          leftScroll.scrollTop = 0;
          flushIntersectionObservers();
        });
        await waitMs(220);

        const updatedCard0Title = mounted.host
          .querySelector(
            '[data-home-row-index="0"] [data-live-channel-card="true"][data-virtual-index="0"] [data-live-channel-epg="true"]'
          )
          ?.textContent?.trim();

        console.log(
          `    [METRICS] Commits em EPG idêntico (novo objeto): ${identicalEpgCommits} | ` +
            `Título após mudança real: "${updatedCard0Title}"`
        );

        assert.strictEqual(
          updatedCard0Title,
          'Novo Programa Real 1001',
          'Mudança real de programa deve atualizar corretamente o título exibido no card'
        );
        if (!IS_BASELINE_MODE) {
          assert.strictEqual(
            identicalEpgCommits,
            0,
            `Dados de EPG idênticos (novo objeto) não devem causar commits React redundantes (atual=${identicalEpgCommits})`
          );
        }
        assert.ok(card0Row && card0Wrap);
      } finally {
        await mounted.unmount();
      }
    }
  );

  // --------------------------------------------------------------------------
  // Bloco 5: Logotipos (visíveis, cache preservado, geometria intacta, sem piscar) + Alternância Lite <-> Full + Favoritos/Preview/Retorno
  // --------------------------------------------------------------------------
  await runCase(
    '12/13/15/16. Logotipos preservam cache/geometria sem piscar; alternância Lite <-> Full e favoritos/preview/foco intactos',
    async () => {
      setSimulatedViewport(1280, 720);
      customEpgHandler = async (streamId) => ({
        epg_listings: [makeProgramListing(streamId, `LogoTest ${streamId}`)],
      });

      resetEnv(true, 'tv', 'remote', 'auto', 85);
      const mounted = await mountLiveTv(catalog);
      try {
        // Card 0 visível: logotipo montado com <img> e geometria preservada (w-12 h-12)
        const card0Wrap = mounted.host.querySelector(
          '[data-home-row-index="0"] [data-live-channel-card="true"][data-virtual-index="0"]'
        )!;
        const logoBox0 = card0Wrap.querySelector('.nc-tv-channel-logo')!;
        assert.ok(logoBox0.className.includes('w-12') && logoBox0.className.includes('h-12'));
        const img0 = card0Wrap.querySelector<HTMLImageElement>('img')!;
        assert.ok(img0, 'Card visível deve renderizar <img> do logotipo');
        const img0Src = img0.getAttribute('src')!;
        assert.ok(img0Src.includes('ch-1001.png'));

        // Simula onLoad para popular loadedImageUrlsCache
        act(() => {
          img0.dispatchEvent(new Event('load'));
        });
        await flush(2);
        assert.strictEqual(
          hasLoadedImageUrl(img0Src),
          true,
          'Logotipo carregado deve ser preservado em loadedImageUrlsCache'
        );

        // Card 6 fora da viewport inicial em Lite mantém container w-12 h-12 (geometria preservada)
        const card6Wrap = mounted.host.querySelector(
          '[data-home-row-index="0"] [data-live-channel-card="true"][data-virtual-index="6"]'
        )!;
        const logoBox6 = card6Wrap.querySelector('.nc-tv-channel-logo')!;
        assert.ok(logoBox6.className.includes('w-12') && logoBox6.className.includes('h-12'));
        if (!IS_BASELINE_MODE) {
          assert.ok(
            card6Wrap.querySelector('[data-media-image-deferred="true"]'),
            'Card fora da área visível em Lite deve preservar espaço diferido sem baixar antecipadamente'
          );
        }

        // Movimenta D-pad pelo card 0 -> card 1 -> card 2 -> volta ao card 0: img0 não pisca nem desmonta
        const btn0 = card0Wrap.querySelector<HTMLButtonElement>('button[data-live-channel-btn="true"]')!;
        act(() => {
          focusElementSafely(btn0);
        });
        await flush(2);
        await dispatchKey('ArrowRight', false);
        await dispatchKey('ArrowRight', false);
        await dispatchKey('ArrowLeft', false);
        await dispatchKey('ArrowLeft', false);
        const img0AfterNav = card0Wrap.querySelector<HTMLImageElement>('img');
        assert.strictEqual(
          img0AfterNav,
          img0,
          'Movimentação de D-pad não pode desmontar ou fazer piscar logotipo já autorizado'
        );

        // Favoritos permanecem intactos
        const favBtn0 = card0Wrap.querySelector<HTMLButtonElement>('button[data-live-channel-fav="true"]')!;
        assert.strictEqual(favBtn0.getAttribute('aria-pressed'), 'false');
        act(() => {
          favBtn0.click();
        });
        await flush(4);
        assert.ok(
          mounted.host.querySelector('[data-live-category-title="true"]')?.textContent?.includes('Canais Favoritos'),
          'Favoritar canal deve continuar criando a fileira Canais Favoritos'
        );

        // Alternância Lite -> Completo -> Lite preserva foco e restaura janelas adequadas
        const focusedBeforeToggle = document.activeElement as HTMLElement | null;
        assert.ok(focusedBeforeToggle, 'Foco deve estar ativo antes de alternar modo');
        act(() => {
          setPerformanceProfilePreference('full');
        });
        await flush(6);
        assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'full');
        assert.strictEqual(
          mounted.host.querySelectorAll('[data-home-row-index]').length,
          24,
          'Alternar para Completo deve restaurar janela vertical de 24 fileiras'
        );
        assert.ok(
          mounted.host.contains(document.activeElement),
          'Alternar Lite -> Completo deve preservar foco'
        );

        act(() => {
          setPerformanceProfilePreference('lite');
        });
        await flush(6);
        assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'lite');
        assert.strictEqual(
          mounted.host.querySelectorAll('[data-home-row-index]').length,
          12,
          'Voltar para Lite deve restaurar janela vertical de 12 fileiras'
        );
        assert.ok(
          mounted.host.contains(document.activeElement),
          'Alternar Completo -> Lite deve preservar foco'
        );

        // Seleção por OK (preview) e retorno de foco por Back
        const activeBtn = document.activeElement as HTMLButtonElement;
        act(() => {
          activeBtn.click();
        });
        await flush(6);
        assert.ok(
          mounted.host.querySelector('[data-live-preview-column="true"]'),
          '1º OK deve abrir preview do canal selecionado'
        );

        await dispatchKey('Escape', false);
        await flush(4);
        assert.strictEqual(
          mounted.host.querySelector('[data-live-preview-column="true"]'),
          null,
          'Back/Escape deve fechar preview'
        );
        assert.ok(
          document.activeElement?.getAttribute('data-live-channel-btn') === 'true',
          'Fechar preview deve restaurar foco no canal de origem'
        );
      } finally {
        await mounted.unmount();
      }
    }
  );

  // --------------------------------------------------------------------------
  // Bloco 6: Ciclo de vida sob React.StrictMode real (microcorreção Fase 3/5)
  // --------------------------------------------------------------------------
  await runCase(
    'StrictMode. Coordenador EPG permanece funcional após setup/cleanup/setup, sem duplicatas, limpa ao desmontar e remonta normalmente',
    async () => {
      setSimulatedViewport(1280, 720);
      const capturedConsoleErrors: string[] = [];
      const origConsoleError = console.error;
      const origConsoleWarn = console.warn;
      console.error = (...args: any[]) => {
        capturedConsoleErrors.push(args.map((a) => String(a)).join(' '));
        origConsoleError(...args);
      };
      console.warn = (...args: any[]) => {
        const msg = args.map((a) => String(a)).join(' ');
        if (!msg.includes('Reduced Motion')) {
          capturedConsoleErrors.push(msg);
        }
        origConsoleWarn(...args);
      };

      try {
        // 6a) Montagem sob React.StrictMode real: confirma ciclo duplo de efeitos e funcionalidade completa
        let strictSetups = 0;
        let strictCleanups = 0;
        customEpgHandler = async (streamId) => ({
          epg_listings: [
            makeProgramListing(streamId, `Strict Programa #${streamId}`),
            makeProgramListing(
              streamId,
              `Strict Próximo #${streamId}`,
              simulatedEpgNowMs + 45 * 60 * 1000,
              simulatedEpgNowMs + 95 * 60 * 1000
            ),
          ],
        });

        resetEnv(true, 'tv', 'remote', 'auto', 85);
        const mountedStrict1 = await mountLiveTv(catalog, undefined, {
          strictMode: true,
          onStrictProbe: (ev) => {
            if (ev === 'setup') strictSetups += 1;
            if (ev === 'cleanup') strictCleanups += 1;
          },
        });

        try {
          assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'lite');
          assert.ok(
            strictSetups >= 2 && strictCleanups >= 1,
            `React.StrictMode deve executar ciclo duplo de efeitos (setups=${strictSetups}, cleanups=${strictCleanups})`
          );

          // 1) Foco em card fora da viewport inicial (card 4): deve receber EPG imediatamente sob StrictMode
          const card4Btn = mountedStrict1.host.querySelector<HTMLButtonElement>(
            '[data-home-row-index="0"] button[data-live-channel-btn="true"][data-row-card-index="4"]'
          )!;
          assert.ok(card4Btn, 'Card 4 deve existir montado sob StrictMode');
          const card4StreamId = Number(card4Btn.getAttribute('data-live-channel-id'));
          act(() => {
            focusElementSafely(card4Btn);
          });
          await flush(6);

          const card4EpgText = card4Btn
            .closest('[data-live-channel-card="true"]')
            ?.querySelector('[data-live-channel-epg="true"]')
            ?.textContent?.trim();
          assert.strictEqual(
            card4EpgText,
            `Strict Programa #${card4StreamId}`,
            'Card focado deve receber EPG normalmente após ciclo extra do StrictMode'
          );

          // 2) Painel direito (priority: 'high') continua imediato mesmo antes do timer de 150ms dos cards visíveis
          const card0Btn = mountedStrict1.host.querySelector<HTMLButtonElement>(
            '[data-home-row-index="0"] button[data-live-channel-btn="true"][data-row-card-index="0"]'
          )!;
          const callsBeforeRightSelect = epgCalls.length;
          act(() => {
            card0Btn.click();
          });
          await flush(6);
          assert.strictEqual(
            mountedStrict1.host.querySelector('[data-live-now-playing-title="true"]')?.textContent?.trim(),
            'Strict Programa #1001',
            'EPG do painel direito (priority: high) deve continuar imediato sob StrictMode'
          );
          assert.ok(
            epgCalls.slice(callsBeforeRightSelect).some((c) => c.streamId === 1001) ||
              Boolean(getCachedLiveEpgSnapshot(TEST_CREDENTIALS, 1001)),
            'Painel direito deve ter acionado EPG imediato'
          );

          // 3) Após estabilização (150ms), cards visíveis recebem EPG sem assinaturas duplicadas
          await waitMs(220);
          const card1EpgText = mountedStrict1.host
            .querySelector(
              '[data-home-row-index="0"] [data-live-channel-card="true"][data-virtual-index="1"] [data-live-channel-epg="true"]'
            )
            ?.textContent?.trim();
          assert.strictEqual(
            card1EpgText,
            'Strict Programa #1002',
            'Cards visíveis devem receber EPG após estabilização sob StrictMode'
          );

          // Verifica ausência de requisições duplicadas por streamId após StrictMode double-invoke
          const seenStreamCounts = new Map<number, number>();
          for (const rec of epgCalls) {
            seenStreamCounts.set(rec.streamId, (seenStreamCounts.get(rec.streamId) ?? 0) + 1);
          }
          const duplicatedStreams = Array.from(seenStreamCounts.entries()).filter(([, count]) => count > 1);
          assert.strictEqual(
            duplicatedStreams.length,
            0,
            `Não devem surgir assinaturas EPG duplicadas sob StrictMode (duplicados=${JSON.stringify(duplicatedStreams)})`
          );
        } finally {
          await mountedStrict1.unmount();
        }

        // 6b) Desmontagem definitiva com timer pendente E requisição in-flight atrasada:
        // nenhum timer remanescente pode disparar e nenhuma resposta tardia pode gerar warning
        const lateResolvers: Array<{ streamId: number; resolve: (p: { epg_listings: any[] }) => void }> = [];
        customEpgHandler = (streamId) =>
          new Promise((resolve) => {
            lateResolvers.push({ streamId, resolve });
          });

        resetEnv(true, 'tv', 'remote', 'auto', 85);
        const mountedStrictUnmount = await mountLiveTv(catalog, undefined, { strictMode: true });
        // Foca card 4 para iniciar 1 requisição in-flight enquanto os vizinhos ainda estão no timer de 150ms
        const card4UnmountBtn = mountedStrictUnmount.host.querySelector<HTMLButtonElement>(
          '[data-home-row-index="0"] button[data-live-channel-btn="true"][data-row-card-index="4"]'
        )!;
        act(() => {
          focusElementSafely(card4UnmountBtn);
        });
        await flush(4);
        assert.ok(lateResolvers.length >= 1, 'Deve haver requisição in-flight antes da desmontagem definitiva');

        const callsBeforeTrueUnmount = epgCalls.length;
        await mountedStrictUnmount.unmount();

        // Aguarda além dos 150ms do timer compartilhado — nenhum novo fetch pode ser disparado após desmontagem
        await waitMs(230);
        assert.strictEqual(
          epgCalls.length,
          callsBeforeTrueUnmount,
          'Desmontagem definitiva sob StrictMode deve cancelar timer pendente e impedir novas assinaturas'
        );

        // Resolve a requisição in-flight atrasada após desmontagem — não pode gerar erro/warning React
        await act(async () => {
          while (lateResolvers.length > 0) {
            const item = lateResolvers.shift()!;
            item.resolve({
              epg_listings: [makeProgramListing(item.streamId, `Tardio Pós-Unmount #${item.streamId}`)],
            });
          }
          await Promise.resolve();
        });
        await flush(4);

        // 6c) Nova montagem da TV ao Vivo sob StrictMode funciona normalmente do zero
        customEpgHandler = async (streamId) => ({
          epg_listings: [makeProgramListing(streamId, `Remontagem Strict #${streamId}`)],
        });
        resetEnv(true, 'tv', 'remote', 'auto', 85);
        const mountedStrict2 = await mountLiveTv(catalog, undefined, { strictMode: true });
        try {
          await waitMs(220);
          const remountCard0Epg = mountedStrict2.host
            .querySelector(
              '[data-home-row-index="0"] [data-live-channel-card="true"][data-virtual-index="0"] [data-live-channel-epg="true"]'
            )
            ?.textContent?.trim();
          assert.strictEqual(
            remountCard0Epg,
            'Remontagem Strict #1001',
            'Nova montagem da TV ao Vivo sob StrictMode deve funcionar normalmente'
          );
        } finally {
          await mountedStrict2.unmount();
        }

        const unmountedStateWarnings = capturedConsoleErrors.filter(
          (msg) =>
            msg.toLowerCase().includes('unmounted') ||
            msg.toLowerCase().includes('memory leak') ||
            msg.toLowerCase().includes('cannot update a component')
        );
        assert.strictEqual(
          unmountedStateWarnings.length,
          0,
          `Não devem ocorrer avisos de atualização de estado após desmontagem: ${unmountedStateWarnings.join(' | ')}`
        );
      } finally {
        console.error = origConsoleError;
        console.warn = origConsoleWarn;
      }
    }
  );

  console.log(
    `\nSucesso: ${passed} blocos de cenários passaram em test-live-tv-epg-assets${
      IS_BASELINE_MODE ? ' (modo baseline)' : ''
    }.`
  );
  process.exit(0);
}

runTests().catch((err) => {
  console.error('FALHA em test-live-tv-epg-assets:', err);
  process.exit(1);
});
