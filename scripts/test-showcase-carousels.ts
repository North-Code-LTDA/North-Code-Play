import assert from 'node:assert';
import type { ReactElement } from 'react';
import type { Root } from 'react-dom/client';
import { createDomTestEnv, type TrackedReactRoot } from './helpers/domEnv';

const TOTAL_CASES = 5;

const rawCaseFilter = process.env.NC_SHOWCASE_CAROUSELS_CASE?.trim();
let selectedCaseNumber: number | null = null;
if (rawCaseFilter) {
  const parsed = Number.parseInt(rawCaseFilter, 10);
  if (!/^\d+$/.test(rawCaseFilter) || parsed < 1 || parsed > TOTAL_CASES) {
    console.error(
      `FALHA em test-showcase-carousels: filtro inválido NC_SHOWCASE_CAROUSELS_CASE="${rawCaseFilter}". Informe um número inteiro entre 1 e ${TOTAL_CASES}.`
    );
    process.exit(1);
  }
  selectedCaseNumber = parsed;
}

// ============================================================================
// 1. Geometria determinística para HorizontalRow / LiveTvView / spatialNav
// ============================================================================
function makeRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({ left, top, width, height }),
  } as DOMRect;
}

const ROW_VIEWPORT_WIDTH = 1200;
const CARD_WIDTH_POSTER = 176;
const CARD_GAP = 16;
const CARD_STRIDE_POSTER = CARD_WIDTH_POSTER + CARD_GAP; // 192px
const CARD_HEIGHT_POSTER = 264;
const ROW_SLOT_HEIGHT = 340;
const ROW_TOP_OFFSET = 460;

// ============================================================================
// 2. Ambiente DOM compartilhado (happy-dom) + importação tardia de React
// ============================================================================
const env = await createDomTestEnv({
  url: 'http://localhost:3000',
  width: 1280,
  height: 720,
  watchdogMs: 25000,
  watchdogLabel: 'test-showcase-carousels',
  rafIntervalMs: 0,
  disableElementAnimate: true,
  stubScrollIntoView: true,
  stubMediaPlayback: true,
  stubResizeObserver: true,
  stubIntersectionObserver: true,
  matchMedia: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
  fetchImpl: (async () => {
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch,
  beforeReactImport: ({ window: win }) => {
    const ShowcaseIntersectionObserver = class IntersectionObserver {
      private cb: IntersectionObserverCallback;
      constructor(cb: IntersectionObserverCallback) {
        this.cb = cb;
      }
      observe(target: Element) {
        // Marca apenas elementos montados na janela atual como visíveis de forma controlada
        this.cb(
          [
            {
              target,
              isIntersecting: true,
              intersectionRatio: 1,
              boundingClientRect: target.getBoundingClientRect(),
              intersectionRect: target.getBoundingClientRect(),
              rootBounds: null,
              time: Date.now(),
            } as IntersectionObserverEntry,
          ],
          this as any
        );
      }
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    };
    (globalThis as any).IntersectionObserver = ShowcaseIntersectionObserver;
    (win as any).IntersectionObserver = ShowcaseIntersectionObserver;

    const htmlProto = win.HTMLElement.prototype as any;
    htmlProto.scrollIntoView = function () {};
    htmlProto.scrollTo = function (options?: any, y?: number) {
      if (typeof options === 'object' && options !== null) {
        if (typeof options.top === 'number') this.scrollTop = options.top;
        if (typeof options.left === 'number') this.scrollLeft = options.left;
      } else if (typeof options === 'number') {
        this.scrollLeft = options;
        if (typeof y === 'number') this.scrollTop = y;
      }
    };

    Object.defineProperty(htmlProto, 'clientWidth', {
      configurable: true,
      get() {
        const el = this as HTMLElement;
        if (el.getAttribute?.('data-nav-row') === 'true') return ROW_VIEWPORT_WIDTH;
        if (el.getAttribute?.('data-nav-grid') === 'true') return ROW_VIEWPORT_WIDTH;
        if (el.getAttribute?.('data-scroll-container') === 'true') return 1280;
        if (el.hasAttribute?.('data-row-card-index')) return CARD_WIDTH_POSTER;
        return 1280;
      },
    });

    Object.defineProperty(htmlProto, 'clientHeight', {
      configurable: true,
      get() {
        const el = this as HTMLElement;
        if (el.getAttribute?.('data-nav-row') === 'true') return 290;
        if (el.getAttribute?.('data-scroll-container') === 'true') return 720;
        if (el.hasAttribute?.('data-row-card-index')) return CARD_HEIGHT_POSTER;
        return 720;
      },
    });

    Object.defineProperty(htmlProto, 'offsetWidth', {
      configurable: true,
      get() {
        const el = this as HTMLElement;
        if (el.hasAttribute?.('data-row-card-index')) return CARD_WIDTH_POSTER;
        if (el.getAttribute?.('data-nav-row') === 'true') return ROW_VIEWPORT_WIDTH;
        return 160;
      },
    });

    Object.defineProperty(htmlProto, 'offsetHeight', {
      configurable: true,
      get() {
        const el = this as HTMLElement;
        if (el.hasAttribute?.('data-row-card-index')) return CARD_HEIGHT_POSTER;
        if (el.getAttribute?.('data-nav-row') === 'true') return 290;
        return 44;
      },
    });

    htmlProto.getBoundingClientRect = function (this: HTMLElement): DOMRect {
      if (this.hasAttribute('hidden') || this.getAttribute('aria-hidden') === 'true') {
        return makeRect(0, 0, 0, 0);
      }
      const hiddenAncestor = this.closest?.('[hidden], [aria-hidden="true"]');
      if (hiddenAncestor) {
        return makeRect(0, 0, 0, 0);
      }

      // Card inside horizontal row (CatalogShowcaseView HorizontalRow or LiveTvView)
      if (this.hasAttribute('data-row-card-index')) {
        const cardIdx = parseInt(this.getAttribute('data-row-card-index') || '0', 10) || 0;
        const rowEl = this.closest<HTMLElement>('[data-nav-row="true"]');
        const rowWrapper = this.closest<HTMLElement>('[data-home-row-index], [data-showcase-row-index]');
        const rowIdxAttr =
          rowWrapper?.getAttribute('data-home-row-index') ??
          rowWrapper?.getAttribute('data-showcase-row-index') ??
          '0';
        const rowIdx = parseInt(rowIdxAttr, 10) || 0;
        const scrollLeft = rowEl ? rowEl.scrollLeft || 0 : 0;
        const scrollContainer = this.closest<HTMLElement>('[data-scroll-container="true"]');
        const scrollTop = scrollContainer ? scrollContainer.scrollTop || 0 : 0;
        const left = 16 + cardIdx * CARD_STRIDE_POSTER - scrollLeft;
        const top = ROW_TOP_OFFSET + rowIdx * ROW_SLOT_HEIGHT - scrollTop;
        return makeRect(left, top, CARD_WIDTH_POSTER, CARD_HEIGHT_POSTER);
      }

      // Horizontal row container
      if (this.getAttribute('data-nav-row') === 'true') {
        const rowWrapper = this.closest<HTMLElement>('[data-home-row-index], [data-showcase-row-index]');
        const rowIdxAttr =
          rowWrapper?.getAttribute('data-home-row-index') ??
          rowWrapper?.getAttribute('data-showcase-row-index') ??
          '0';
        const rowIdx = parseInt(rowIdxAttr, 10) || 0;
        const scrollContainer = this.closest<HTMLElement>('[data-scroll-container="true"]');
        const scrollTop = scrollContainer ? scrollContainer.scrollTop || 0 : 0;
        const top = ROW_TOP_OFFSET + rowIdx * ROW_SLOT_HEIGHT - scrollTop;
        return makeRect(0, top, ROW_VIEWPORT_WIDTH, 290);
      }

      // Showcase/Home row block wrapper
      if (
        this.hasAttribute('data-showcase-row-index') ||
        this.hasAttribute('data-home-row-index')
      ) {
        const rowIdxAttr =
          this.getAttribute('data-showcase-row-index') ??
          this.getAttribute('data-home-row-index') ??
          '0';
        const rowIdx = parseInt(rowIdxAttr, 10) || 0;
        const scrollContainer = this.closest<HTMLElement>('[data-scroll-container="true"]');
        const scrollTop = scrollContainer ? scrollContainer.scrollTop || 0 : 0;
        const top = ROW_TOP_OFFSET - 30 + rowIdx * ROW_SLOT_HEIGHT - scrollTop;
        return makeRect(0, top, ROW_VIEWPORT_WIDTH, ROW_SLOT_HEIGHT);
      }

      if (this.getAttribute('data-scroll-container') === 'true') {
        return makeRect(0, 0, 1280, 720);
      }

      // Generic interactive element (buttons, grid cards, etc.)
      if (this.hasAttribute('data-nav-item') || this.tagName === 'BUTTON' || this.tagName === 'INPUT') {
        return makeRect(24, 24, 160, 44);
      }

      return makeRect(0, 0, 1200, 100);
    };
  },
});

const { React, act } = env;

// ============================================================================
// 3. Imports dinâmicos após o bootstrap do DOM
// ============================================================================
let CatalogShowcaseView!: (typeof import('../src/components/CatalogShowcaseView'))['CatalogShowcaseView'];
let LiveTvView!: (typeof import('../src/views/LiveTvView'))['LiveTvView'];
let XtreamCredentialsContext!: (typeof import('../src/context/XtreamContext'))['XtreamCredentialsContext'];
let XtreamLiveContext!: (typeof import('../src/context/XtreamContext'))['XtreamLiveContext'];
let NavigationProvider!: (typeof import('../src/navigation'))['NavigationProvider'];
let moveSpatialFocus!: (typeof import('../src/navigation'))['moveSpatialFocus'];
let setNavMode!: (typeof import('../src/navigation'))['setNavMode'];
let clearAllBackHandlersForTest!: (typeof import('../src/navigation'))['clearAllBackHandlersForTest'];
let invalidateCandidateCache!: (typeof import('../src/navigation'))['invalidateCandidateCache'];
let getOrCreateVodIndex!: (typeof import('../src/utils/catalogIndex'))['getOrCreateVodIndex'];
let getOrCreateSeriesIndex!: (typeof import('../src/utils/catalogIndex'))['getOrCreateSeriesIndex'];
let getHeroBannerItems!: (typeof import('../src/utils/catalogIndex'))['getHeroBannerItems'];

try {
  ({ CatalogShowcaseView } = await import('../src/components/CatalogShowcaseView'));
  ({ LiveTvView } = await import('../src/views/LiveTvView'));
  ({
    XtreamCredentialsContext,
    XtreamLiveContext,
  } = await import('../src/context/XtreamContext'));
  ({
    NavigationProvider,
    moveSpatialFocus,
    setNavMode,
    clearAllBackHandlersForTest,
    invalidateCandidateCache,
  } = await import('../src/navigation'));
  ({
    getOrCreateVodIndex,
    getOrCreateSeriesIndex,
    getHeroBannerItems,
  } = await import('../src/utils/catalogIndex'));
} catch (importError) {
  const cleanupErrors = await env.dispose();
  if (cleanupErrors.length > 0) {
    console.error('Erros adicionais ao limpar ambiente após falha de importação:', cleanupErrors);
  }
  throw importError;
}

env.registerCleanup(() => {
  clearAllBackHandlersForTest();
  invalidateCandidateCache();
});

// ============================================================================
// 4. Geradores de catálogos sintéticos determinísticos
// ============================================================================
const SYNTHETIC_CREDENTIALS = {
  serverUrl: 'http://synthetic.local',
  username: 'demo_user',
  password: 'demo_password',
};

function makeSyntheticVodCategory(id: string, name: string) {
  return { category_id: id, category_name: name, parent_id: 0 };
}

function makeSyntheticVodList(categorySpecs: Array<{ id: string; name: string; count: number }>) {
  const categories = categorySpecs.map((c) => makeSyntheticVodCategory(c.id, c.name));
  const streams: any[] = [];
  let seq = 10000;
  for (const spec of categorySpecs) {
    for (let i = 0; i < spec.count; i++) {
      seq += 1;
      const year = 2015 + (i % 11); // 2015..2025
      const rating = ((i * 7) % 50) / 10 + 5.0; // 5.0..9.9
      streams.push({
        num: seq,
        name: `Filme ${spec.name} #${String(i + 1).padStart(4, '0')} (${year})`,
        stream_type: 'movie',
        stream_id: seq,
        stream_icon: `http://synthetic.local/images/vod_${seq}.jpg`,
        rating: rating.toFixed(1),
        rating_5based: rating / 2,
        added: String(1700000000 + seq),
        category_id: spec.id,
        category_ids: [spec.id],
        container_extension: 'mp4',
      });
    }
  }
  return { categories, streams };
}

function makeSyntheticSeriesList(categorySpecs: Array<{ id: string; name: string; count: number }>) {
  const categories = categorySpecs.map((c) => makeSyntheticVodCategory(c.id, c.name));
  const streams: any[] = [];
  let seq = 50000;
  for (const spec of categorySpecs) {
    for (let i = 0; i < spec.count; i++) {
      seq += 1;
      const year = 2016 + (i % 10);
      const rating = ((i * 5) % 45) / 10 + 5.2;
      streams.push({
        num: seq,
        name: `Série ${spec.name} #${String(i + 1).padStart(4, '0')} (${year})`,
        series_id: seq,
        cover: `http://synthetic.local/images/series_${seq}.jpg`,
        rating: rating.toFixed(1),
        rating_5based: rating / 2,
        releaseDate: `${year}-06-15`,
        last_modified: String(1700000000 + seq),
        category_id: spec.id,
        category_ids: [spec.id],
      });
    }
  }
  return { categories, streams };
}

function makeSyntheticLiveList(categorySpecs: Array<{ id: string; name: string; count: number }>) {
  const categories = categorySpecs.map((c) => makeSyntheticVodCategory(c.id, c.name));
  const streams: any[] = [];
  let seq = 80000;
  for (const spec of categorySpecs) {
    for (let i = 0; i < spec.count; i++) {
      seq += 1;
      streams.push({
        num: seq,
        name: `Canal ${spec.name} ${String(i + 1).padStart(3, '0')} HD`,
        stream_type: 'live',
        stream_id: seq,
        stream_icon: `http://synthetic.local/images/live_${seq}.png`,
        epg_channel_id: `epg_${seq}`,
        added: String(1700000000 + seq),
        category_id: spec.id,
        category_ids: [spec.id],
      });
    }
  }
  return { categories, streams };
}

async function flushMicrotasks(ms = 15) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

const trackedByRoot = new WeakMap<Root, TrackedReactRoot>();

function mountInContainer(element: ReactElement): { container: HTMLElement; root: Root } {
  const tracked = env.createTrackedRoot();
  trackedByRoot.set(tracked.root, tracked);
  act(() => {
    tracked.root.render(element);
  });
  return { container: tracked.host, root: tracked.root };
}

function unmountContainer(root: Root, container: HTMLElement) {
  const tracked = trackedByRoot.get(root);
  if (tracked) {
    tracked.unmountSync();
    trackedByRoot.delete(root);
  } else {
    act(() => {
      root.unmount();
    });
    container.remove();
  }
  invalidateCandidateCache();
}

function findRowByTitle(container: HTMLElement, expectedTitle: string): HTMLElement | null {
  const headings = Array.from(container.querySelectorAll('h2, h3'));
  for (const h of headings) {
    if ((h.textContent || '').trim() === expectedTitle) {
      const wrapper = h.closest<HTMLElement>('[data-home-row-index], [data-showcase-row-index]');
      const navRow = wrapper?.querySelector<HTMLElement>('[data-nav-row="true"]');
      if (navRow) return navRow;
    }
  }
  return null;
}

function getMountedCardsInRow(rowEl: HTMLElement): HTMLElement[] {
  return Array.from(rowEl.querySelectorAll<HTMLElement>('[data-row-card-index]'));
}

function getCardIndex(el: Element | null): number {
  if (!el) return -1;
  const raw = el.getAttribute('data-row-card-index');
  return raw !== null ? parseInt(raw, 10) : -1;
}

function stepSpatial(direction: 'left' | 'right' | 'up' | 'down', steps = 1): HTMLElement | null {
  let moved: HTMLElement | null = null;
  for (let i = 0; i < steps; i++) {
    act(() => {
      moved = moveSpatialFocus(direction);
    });
  }
  return moved;
}

// ============================================================================
// 5. Execução dos cenários direcionados
// ============================================================================
async function runTests() {
  const startedAt = Date.now();
  let caseIndex = 0;
  let passed = 0;
  let skipped = 0;

  function pass(label: string) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  }

  const runCase = async (title: string, fn: () => Promise<void> | void) => {
    caseIndex += 1;
    if (selectedCaseNumber !== null && caseIndex !== selectedCaseNumber) {
      skipped += 1;
      return;
    }
    console.log(`\n[${caseIndex}/${TOTAL_CASES}] ${title}`);
    window.localStorage.clear();
    clearAllBackHandlersForTest();
    invalidateCandidateCache();
    let caseError: unknown = null;
    try {
      await fn();
    } catch (err) {
      caseError = err;
    } finally {
      const unmountErrors = await env.unmountAllRoots();
      clearAllBackHandlersForTest();
      invalidateCandidateCache();
      if (!caseError && unmountErrors.length > 0) {
        caseError = unmountErrors[0];
      }
    }
    if (caseError) {
      throw caseError;
    }
  };

  if (selectedCaseNumber !== null) {
    console.log(
      `=== North Code Play — Teste Direcionado de Carrosséis Completos (filtro PARCIAL NC_SHOWCASE_CAROUSELS_CASE=${selectedCaseNumber}/${TOTAL_CASES}) ===`
    );
  } else {
    console.log('=== North Code Play — Teste Direcionado de Carrosséis Completos ===');
  }

  // --- Cenário 1: Indexação, estabilidade de referência e preservação do HeroBanner ---
  await runCase('Indexação completa, estabilidade de referência e preservação do HeroBanner', () => {
  const vodData = makeSyntheticVodList([
    { id: 'v8', name: 'Curtas', count: 8 },
    { id: 'v24', name: 'Clássicos', count: 24 },
    { id: 'v25', name: 'Ação', count: 25 },
    { id: 'v80', name: 'Drama', count: 80 },
    { id: 'v1063', name: 'Acervo Gigante', count: 1063 },
  ]);
  const seriesData = makeSyntheticSeriesList([
    { id: 's10', name: 'Minisséries', count: 10 },
    { id: 's24', name: 'Comédia', count: 24 },
    { id: 's25', name: 'Suspense', count: 25 },
    { id: 's61', name: 'Ficção', count: 61 },
  ]);

  const vodIndex = getOrCreateVodIndex(vodData.streams);
  const seriesIndex = getOrCreateSeriesIndex(seriesData.streams);

  const cat1063First = vodIndex.getSortedByCategory('v1063');
  const cat1063Second = vodIndex.getSortedByCategory('v1063');
  assert.strictEqual(cat1063First.length, 1063, 'Categoria VOD grande deve conter todos os 1063 títulos');
  assert.strictEqual(cat1063First, cat1063Second, 'getSortedByCategory deve preservar referência estável em cache');

  const allVodFirst = vodIndex.getSortedAll();
  const allVodSecond = vodIndex.getSortedAll();
  assert.strictEqual(allVodFirst.length, 1200, 'getSortedAll VOD deve conter todos os 1200 títulos');
  assert.strictEqual(allVodFirst, allVodSecond, 'getSortedAll VOD deve preservar referência estável');

  // Sem IDs duplicados na categoria
  const uniqueVodIds = new Set(cat1063First.map((item: any) => String(item.stream_id)));
  assert.strictEqual(uniqueVodIds.size, 1063, 'Categoria VOD grande não deve ter IDs duplicados');

  // Séries completas e referência estável
  const catS61First = seriesIndex.getSortedByCategory('s61');
  const catS61Second = seriesIndex.getSortedByCategory('s61');
  assert.strictEqual(catS61First.length, 61, 'Categoria de séries deve conter todos os 61 títulos');
  assert.strictEqual(catS61First, catS61Second, 'getSortedByCategory Séries deve preservar referência estável');

  // Preservação estrita da regra do HeroBanner (limite de 30 itens deduplicados)
  const heroHome = getHeroBannerItems(vodData.streams, seriesData.streams);
  const heroMovies = getHeroBannerItems(vodData.streams, []);
  const heroSeries = getHeroBannerItems([], seriesData.streams);
  assert.strictEqual(heroHome.length, 30, 'HeroBanner (Início) deve continuar limitado a 30 itens');
  assert.strictEqual(heroMovies.length, 30, 'HeroBanner (Filmes) deve continuar limitado a 30 itens');
  assert.strictEqual(heroSeries.length, 30, 'HeroBanner (Séries) deve continuar limitado a 30 itens');

  pass('catalogIndex preserva catálogos completos (1200 filmes / 120 séries), referências estáveis e HeroBanner limitado a 30 itens');
  });

  // --- Cenário 2: Início (Canais Ao Vivo, Filmes em Destaque, Séries em Destaque) ---
  await runCase('Início: Canais Ao Vivo (>24), Filmes em Destaque (>24) e Séries em Destaque (>24)', async () => {
  setNavMode('remote');
  const vodData = makeSyntheticVodList([
    { id: 'v8', name: 'Curtas', count: 8 },
    { id: 'v80', name: 'Drama', count: 80 },
    { id: 'v1120', name: 'Catálogo Completo', count: 1120 },
  ]);
  const seriesData = makeSyntheticSeriesList([
    { id: 's24', name: 'Comédia', count: 24 },
    { id: 's96', name: 'Ficção', count: 96 },
  ]);
  const liveData = makeSyntheticLiveList([
    { id: 'l60', name: 'Esportes', count: 60 },
  ]);

  const { container, root } = mountInContainer(
    React.createElement(
      XtreamCredentialsContext.Provider,
      { value: { credentials: SYNTHETIC_CREDENTIALS } },
      React.createElement(
        NavigationProvider,
        null,
        React.createElement(CatalogShowcaseView, {
          section: 'inicio',
          credentials: SYNTHETIC_CREDENTIALS,
          onPlay: () => {},
          liveStreams: liveData.streams,
          allLiveStreams: liveData.streams,
          loadingLive: false,
          liveCatalogStatus: 'ready',
          vodCategories: vodData.categories,
          vodStreams: vodData.streams,
          allVodStreams: vodData.streams,
          loadingVod: false,
          vodCategoriesStatus: 'ready',
          vodCatalogStatus: 'ready',
          seriesCategories: seriesData.categories,
          seriesStreams: seriesData.streams,
          allSeriesStreams: seriesData.streams,
          loadingSeries: false,
          seriesCategoriesStatus: 'ready',
          seriesCatalogStatus: 'ready',
        })
      )
    )
  );
  await flushMicrotasks(25);

  const liveRow = findRowByTitle(container, 'Canais Ao Vivo');
  const featuredMoviesRow = findRowByTitle(container, 'Filmes em Destaque');
  const featuredSeriesRow = findRowByTitle(container, 'Séries em Destaque');

  assert.ok(liveRow, 'Carrossel "Canais Ao Vivo" deve estar montado no Início');
  assert.ok(featuredMoviesRow, 'Carrossel "Filmes em Destaque" deve estar montado no Início');
  assert.ok(featuredSeriesRow, 'Carrossel "Séries em Destaque" deve estar montado no Início');

  assert.strictEqual(liveRow!.getAttribute('data-virtual-container'), 'true', 'Canais Ao Vivo (60) deve ativar virtualização horizontal');
  assert.strictEqual(featuredMoviesRow!.getAttribute('data-virtual-container'), 'true', 'Filmes em Destaque (1208) deve ativar virtualização horizontal');
  assert.strictEqual(featuredSeriesRow!.getAttribute('data-virtual-container'), 'true', 'Séries em Destaque (120) deve ativar virtualização horizontal');

  const initialMoviesCards = getMountedCardsInRow(featuredMoviesRow!);
  assert.ok(
    initialMoviesCards.length > 0 && initialMoviesCards.length < 30,
    `Filmes em Destaque (1208 itens) deve montar janela limitada no DOM (montados: ${initialMoviesCards.length})`
  );
  assert.ok(
    featuredMoviesRow!.querySelector('[data-virtual-spacer="right"]'),
    'Filmes em Destaque deve renderizar spacer direito para representar itens restantes'
  );

  // Atravessar o antigo limite de 24 itens em Canais Ao Vivo (60 canais)
  const firstLiveCard = liveRow!.querySelector<HTMLElement>('[data-row-card-index="0"]');
  assert.ok(firstLiveCard, 'Primeiro card de Canais Ao Vivo deve existir');
  act(() => {
    firstLiveCard!.focus();
  });
  stepSpatial('right', 28);
  assert.strictEqual(getCardIndex(document.activeElement), 28, 'Canais Ao Vivo deve navegar além do 24º item (índice 28)');

  // Atravessar o antigo limite de 24 itens em Filmes em Destaque (1208 itens)
  const firstFeaturedMovie = featuredMoviesRow!.querySelector<HTMLElement>('[data-row-card-index="0"]');
  assert.ok(firstFeaturedMovie, 'Primeiro card de Filmes em Destaque deve existir');
  act(() => {
    firstFeaturedMovie!.focus();
  });
  stepSpatial('right', 32);
  assert.strictEqual(getCardIndex(document.activeElement), 32, 'Filmes em Destaque deve navegar além do 24º item (índice 32)');
  assert.ok(
    getMountedCardsInRow(featuredMoviesRow!).length < 30,
    'Mesmo após avançar em Filmes em Destaque (1208 itens), DOM montado permanece limitado'
  );

  // Atravessar o antigo limite de 24 itens em Séries em Destaque (120 itens)
  const firstFeaturedSeries = featuredSeriesRow!.querySelector<HTMLElement>('[data-row-card-index="0"]');
  assert.ok(firstFeaturedSeries, 'Primeiro card de Séries em Destaque deve existir');
  act(() => {
    firstFeaturedSeries!.focus();
  });
  stepSpatial('right', 26);
  assert.strictEqual(getCardIndex(document.activeElement), 26, 'Séries em Destaque deve navegar além do 24º item (índice 26)');

  unmountContainer(root, container);
  pass('Início exibe Canais Ao Vivo (60), Filmes em Destaque (1208) e Séries em Destaque (120) sem truncamento de 24 e com virtualização controlada');
  });

  // --- Cenário 3: Filmes (8, 24, 25, 80, 1063 itens + detalhes + retorno + Ver todos + atualização) ---
  await runCase('Filmes: 8, 24, 25, 80 e 1063 itens, navegação completa, detalhes, Ver todos e atualização de catálogo', async () => {
  setNavMode('remote');
  const vodData = makeSyntheticVodList([
    { id: 'v8', name: 'Curtas', count: 8 },
    { id: 'v24', name: 'Clássicos', count: 24 },
    { id: 'v25', name: 'Ação', count: 25 },
    { id: 'v80', name: 'Drama', count: 80 },
    { id: 'v1063', name: 'Acervo Gigante', count: 1063 },
  ]);

  const buildMoviesTree = (categories: any[], streams: any[]) =>
    React.createElement(
      XtreamCredentialsContext.Provider,
      { value: { credentials: SYNTHETIC_CREDENTIALS } },
      React.createElement(
        NavigationProvider,
        null,
        React.createElement(CatalogShowcaseView, {
          section: 'movies',
          credentials: SYNTHETIC_CREDENTIALS,
          onPlay: () => {},
          vodCategories: categories,
          vodStreams: streams,
          allVodStreams: streams,
          loadingVod: false,
          vodCategoriesStatus: 'ready',
          vodCatalogStatus: 'ready',
        })
      )
    );

  const { container, root } = mountInContainer(buildMoviesTree(vodData.categories, vodData.streams));
  await flushMicrotasks(25);

  const row8 = findRowByTitle(container, 'Curtas');
  const row24 = findRowByTitle(container, 'Clássicos');
  const row25 = findRowByTitle(container, 'Ação');
  const row80 = findRowByTitle(container, 'Drama');
  const row1063 = findRowByTitle(container, 'Acervo Gigante');

  assert.ok(row8 && row24 && row25 && row80 && row1063, 'Todas as 5 fileiras de categorias de Filmes devem estar montadas');

  // Fileiras pequenas (<=24) não virtualizam e montam todos os cards
  assert.strictEqual(row8!.getAttribute('data-virtual-container'), null, 'Categoria de 8 itens não deve ativar virtualização');
  assert.strictEqual(getMountedCardsInRow(row8!).length, 8, 'Categoria de 8 itens deve montar todos os 8 cards');
  assert.strictEqual(row24!.getAttribute('data-virtual-container'), null, 'Categoria de 24 itens (limite) não deve ativar virtualização');
  assert.strictEqual(getMountedCardsInRow(row24!).length, 24, 'Categoria de 24 itens deve montar todos os 24 cards');

  // Fileiras >24 ativam virtualização horizontal explicitamente
  assert.strictEqual(row25!.getAttribute('data-virtual-container'), 'true', 'Categoria de 25 itens deve ativar virtualização');
  assert.strictEqual(row80!.getAttribute('data-virtual-container'), 'true', 'Categoria de 80 itens deve ativar virtualização');
  assert.strictEqual(row1063!.getAttribute('data-virtual-container'), 'true', 'Categoria de 1063 itens deve ativar virtualização');
  assert.ok(
    getMountedCardsInRow(row1063!).length < 30,
    `Categoria de 1063 itens deve manter janela DOM limitada (montados: ${getMountedCardsInRow(row1063!).length})`
  );

  // Não ocorre carregamento em massa de imagens (contagem total de <img> em toda a página fica restrita à janela montada)
  const totalImgsInDom = container.querySelectorAll('img').length;
  assert.ok(
    totalImgsInDom < 160,
    `Não deve haver criação em massa de imagens para 1200 filmes (imgs no DOM: ${totalImgsInDom})`
  );

  // 3a) Categoria de 25 itens: 0 -> 24 (último) -> tentar avançar além do último -> voltar ao 0
  const r25Card0 = row25!.querySelector<HTMLElement>('[data-row-card-index="0"]');
  assert.ok(r25Card0);
  act(() => {
    r25Card0!.focus();
  });
  stepSpatial('right', 24);
  assert.strictEqual(getCardIndex(document.activeElement), 24, 'Categoria de 25 itens deve alcançar o 25º card (índice 24)');
  // Tentar avançar além do último não deve quebrar nem perder o foco
  stepSpatial('right', 1);
  assert.strictEqual(getCardIndex(document.activeElement), 24, 'Após o último card da fileira de 25 itens, foco permanece no índice 24');
  stepSpatial('left', 24);
  assert.strictEqual(getCardIndex(document.activeElement), 0, 'Navegação de retorno à esquerda deve voltar ao índice 0');

  // 3b) Navegação vertical entre categorias (25 itens -> 80 itens -> 25 itens)
  stepSpatial('down', 1);
  assert.ok(
    row80!.contains(document.activeElement),
    'Seta para baixo deve mover o foco da categoria "Ação" (25) para "Drama" (80)'
  );
  stepSpatial('up', 1);
  assert.ok(
    row25!.contains(document.activeElement),
    'Seta para cima deve retornar o foco da categoria "Drama" (80) para "Ação" (25)'
  );

  // 3c) Categoria de 80 itens: 0 -> 23 -> 24 -> 35 -> abrir MovieDetails -> fechar -> restaurar índice 35 -> avançar até 79 -> voltar ao 0
  const r80Card0 = row80!.querySelector<HTMLElement>('[data-row-card-index="0"]');
  assert.ok(r80Card0);
  act(() => {
    r80Card0!.focus();
  });
  stepSpatial('right', 23);
  assert.strictEqual(getCardIndex(document.activeElement), 23, 'Deve alcançar índice 23');
  stepSpatial('right', 1);
  assert.strictEqual(getCardIndex(document.activeElement), 24, 'Deve ultrapassar o antigo limite de 24 (índice 24)');
  stepSpatial('right', 11);
  assert.strictEqual(getCardIndex(document.activeElement), 35, 'Deve alcançar item intermediário distante (índice 35)');

  const card35El = document.activeElement as HTMLElement;
  const card35Key = card35El.getAttribute('data-row-item-key');
  assert.ok(card35Key, 'Card no índice 35 deve possuir data-row-item-key');
  assert.ok(row80!.querySelector('[data-virtual-spacer="left"]'), 'Spacer esquerdo deve existir quando deslocado ao índice 35');

  // Abrir MovieDetails a partir do card 35
  act(() => {
    card35El.click();
  });
  await flushMicrotasks(25);

  const closeMovieBtn =
    document.body.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Fechar"]') ||
    Array.from(document.body.querySelectorAll('button')).find((b) =>
      (b.textContent || '').includes('Voltar')
    );
  assert.ok(closeMovieBtn, 'MovieDetails deve abrir e exibir botão de fechar');

  // Fechar MovieDetails e verificar restauração exata do foco no índice 35
  act(() => {
    closeMovieBtn!.click();
  });
  await flushMicrotasks(25);

  assert.strictEqual(
    getCardIndex(document.activeElement),
    35,
    'Ao fechar MovieDetails, foco deve retornar exatamente ao card de índice 35'
  );
  assert.strictEqual(
    (document.activeElement as HTMLElement)?.getAttribute('data-row-item-key'),
    card35Key,
    'Ao fechar MovieDetails, o item restaurado deve ter a mesma chave do item original'
  );

  // Continuar até o último item da categoria de 80 (índice 79) e voltar ao início (índice 0)
  stepSpatial('right', 44);
  assert.strictEqual(getCardIndex(document.activeElement), 79, 'Categoria de 80 itens deve alcançar o último card (índice 79)');
  assert.ok(getMountedCardsInRow(row80!).length < 30, 'Mesmo no índice 79, janela DOM permanece limitada');
  stepSpatial('left', 79);
  assert.strictEqual(getCardIndex(document.activeElement), 0, 'Retorno à esquerda na categoria de 80 itens deve voltar ao índice 0');

  // 3d) Categoria com >1000 itens (1063 itens): início -> >24 -> intermediário distante -> último (1062)
  const r1063Card0 = row1063!.querySelector<HTMLElement>('[data-row-card-index="0"]');
  assert.ok(r1063Card0);
  act(() => {
    r1063Card0!.focus();
  });
  stepSpatial('right', 30);
  assert.strictEqual(getCardIndex(document.activeElement), 30, 'Categoria de 1063 itens deve navegar além de 24 (índice 30)');

  // Deslocar scroll horizontal até meio do catálogo (~índice 550) e navegar nele
  act(() => {
    row1063!.scrollLeft = 550 * CARD_STRIDE_POSTER;
    row1063!.dispatchEvent(new Event('scroll'));
  });
  await flushMicrotasks(25);
  const midCard = row1063!.querySelector<HTMLElement>('[data-row-card-index="550"]');
  assert.ok(midCard, 'Item intermediário distante (índice 550) da categoria de 1063 itens deve montar sob demanda');
  assert.ok(
    getMountedCardsInRow(row1063!).length < 30,
    `No índice 550 de 1063 itens, DOM montado continua limitado (montados: ${getMountedCardsInRow(row1063!).length})`
  );

  // Deslocar até o final do catálogo (índice 1062 — 1063º item) e focar último item
  act(() => {
    row1063!.scrollLeft = 1062 * CARD_STRIDE_POSTER;
    row1063!.dispatchEvent(new Event('scroll'));
  });
  await flushMicrotasks(25);
  const lastCard1063 = row1063!.querySelector<HTMLElement>('[data-row-card-index="1062"]');
  assert.ok(lastCard1063, 'Último item (índice 1062) da categoria de 1063 itens deve ser acessível');
  act(() => {
    lastCard1063!.focus();
  });
  assert.strictEqual(getCardIndex(document.activeElement), 1062, 'Foco alcança o último card da categoria de 1063 itens');
  assert.ok(
    getMountedCardsInRow(row1063!).length < 30,
    'No último item (índice 1062), janela DOM permanece limitada'
  );

  // 3e) Filtro de categoria / modo "Ver todos" preservado
  const verTodosOption = container.querySelector<HTMLButtonElement>('[data-category-id="all"]');
  assert.ok(verTodosOption, 'Opção "Ver todos" deve existir no seletor de categorias de Filmes');
  act(() => {
    verTodosOption!.click();
  });
  await flushMicrotasks(25);
  const gridContainer = container.querySelector<HTMLElement>('[data-nav-grid="true"][data-virtual-container="true"]');
  assert.ok(gridContainer, 'Modo "Ver todos" deve renderizar grade virtualizada');
  assert.strictEqual(gridContainer!.getAttribute('data-virtual-total'), '1200', 'Grade "Ver todos" deve expor todos os 1200 filmes');

  // Voltar à vitrine
  const backToShowcaseBtn = container.querySelector<HTMLButtonElement>('[data-category-id="showcase"]');
  assert.ok(backToShowcaseBtn, 'Opção de retorno à vitrine deve existir');
  act(() => {
    backToShowcaseBtn!.click();
  });
  await flushMicrotasks(25);

  // 3f) Atualização dinâmica do catálogo: categoria v24 cresce de 24 -> 34 itens e ativa virtualização
  const expandedStreams = [
    ...vodData.streams,
    ...Array.from({ length: 10 }, (_, idx) => ({
      num: 99000 + idx,
      name: `Novo Clássico #${idx + 1} (2025)`,
      stream_type: 'movie',
      stream_id: 99000 + idx,
      stream_icon: `http://synthetic.local/images/vod_new_${idx}.jpg`,
      rating: '8.5',
      rating_5based: 4.25,
      added: String(1750000000 + idx),
      category_id: 'v24',
      category_ids: ['v24'],
      container_extension: 'mp4',
    })),
  ];
  act(() => {
    root.render(buildMoviesTree(vodData.categories, expandedStreams));
  });
  await flushMicrotasks(25);

  const updatedRow24 = findRowByTitle(container, 'Clássicos');
  assert.ok(updatedRow24, 'Categoria Clássicos deve continuar montada após atualização de catálogo');
  assert.strictEqual(
    updatedRow24!.getAttribute('data-virtual-container'),
    'true',
    'Ao crescer de 24 para 34 itens, categoria deve ativar virtualização horizontal'
  );
  const updatedFirstCard = updatedRow24!.querySelector<HTMLElement>('[data-row-card-index="0"]');
  act(() => {
    updatedFirstCard!.focus();
  });
  stepSpatial('right', 33);
  assert.strictEqual(getCardIndex(document.activeElement), 33, 'Categoria atualizada para 34 itens deve alcançar o 34º item (índice 33)');

  unmountContainer(root, container);
  pass('Filmes valida 8/24/25/80/1063 itens, navegação completa, retorno de MovieDetails além de 24, Ver todos e atualização de catálogo');
  });

  // --- Cenário 4: Séries (10, 24, 25, 61 itens + SeriesDetails além de 24 + filtro de categoria) ---
  await runCase('Séries: 10, 24, 25 e 61 itens, navegação completa, SeriesDetails além de 24 e filtro', async () => {
  setNavMode('remote');
  const seriesData = makeSyntheticSeriesList([
    { id: 's10', name: 'Minisséries', count: 10 },
    { id: 's24', name: 'Comédia', count: 24 },
    { id: 's25', name: 'Suspense', count: 25 },
    { id: 's61', name: 'Ficção', count: 61 },
  ]);

  const { container, root } = mountInContainer(
    React.createElement(
      XtreamCredentialsContext.Provider,
      { value: { credentials: SYNTHETIC_CREDENTIALS } },
      React.createElement(
        NavigationProvider,
        null,
        React.createElement(CatalogShowcaseView, {
          section: 'series',
          credentials: SYNTHETIC_CREDENTIALS,
          onPlay: () => {},
          seriesCategories: seriesData.categories,
          seriesStreams: seriesData.streams,
          allSeriesStreams: seriesData.streams,
          loadingSeries: false,
          seriesCategoriesStatus: 'ready',
          seriesCatalogStatus: 'ready',
        })
      )
    )
  );
  await flushMicrotasks(25);

  const rowS10 = findRowByTitle(container, 'Minisséries');
  const rowS24 = findRowByTitle(container, 'Comédia');
  const rowS25 = findRowByTitle(container, 'Suspense');
  const rowS61 = findRowByTitle(container, 'Ficção');

  assert.ok(rowS10 && rowS24 && rowS25 && rowS61, 'Todas as fileiras de Séries devem estar montadas');
  assert.strictEqual(rowS10!.getAttribute('data-virtual-container'), null, 'Série de 10 itens não virtualiza');
  assert.strictEqual(rowS24!.getAttribute('data-virtual-container'), null, 'Série de 24 itens não virtualiza');
  assert.strictEqual(rowS25!.getAttribute('data-virtual-container'), 'true', 'Série de 25 itens virtualiza');
  assert.strictEqual(rowS61!.getAttribute('data-virtual-container'), 'true', 'Série de 61 itens virtualiza');

  // Navegar além de 24 na categoria de 61 séries até índice 32, abrir SeriesDetails, fechar e validar retorno
  const s61Card0 = rowS61!.querySelector<HTMLElement>('[data-row-card-index="0"]');
  assert.ok(s61Card0);
  act(() => {
    s61Card0!.focus();
  });
  stepSpatial('right', 32);
  assert.strictEqual(getCardIndex(document.activeElement), 32, 'Séries (61 itens) deve alcançar índice 32');
  const s32El = document.activeElement as HTMLElement;
  const s32Key = s32El.getAttribute('data-row-item-key');
  assert.ok(s32Key, 'Card de série no índice 32 deve possuir data-row-item-key');

  act(() => {
    s32El.click();
  });
  await flushMicrotasks(25);

  const closeSeriesBtn =
    document.body.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Fechar"]') ||
    Array.from(document.body.querySelectorAll('button')).find((b) =>
      (b.textContent || '').includes('Voltar')
    );
  assert.ok(closeSeriesBtn, 'SeriesDetails deve abrir e exibir botão de fechar');

  act(() => {
    closeSeriesBtn!.click();
  });
  await flushMicrotasks(25);

  assert.strictEqual(getCardIndex(document.activeElement), 32, 'Ao fechar SeriesDetails, foco deve retornar exatamente ao índice 32');
  assert.strictEqual(
    (document.activeElement as HTMLElement)?.getAttribute('data-row-item-key'),
    s32Key,
    'Ao fechar SeriesDetails, item restaurado deve ter a mesma chave'
  );

  // Avançar até o último item (índice 60) e voltar ao 0
  stepSpatial('right', 28);
  assert.strictEqual(getCardIndex(document.activeElement), 60, 'Séries (61 itens) deve alcançar último item (índice 60)');
  assert.ok(getMountedCardsInRow(rowS61!).length < 30, 'Séries (61 itens) mantém janela DOM limitada no último item');
  stepSpatial('left', 60);
  assert.strictEqual(getCardIndex(document.activeElement), 0, 'Séries deve retornar ao índice 0');

  // Filtro por categoria específica (Ficção: 61 itens)
  const catFilterBtn = container.querySelector<HTMLButtonElement>('[data-category-id="s61"]');
  assert.ok(catFilterBtn, 'Botão da categoria Ficção deve existir no menu');
  act(() => {
    catFilterBtn!.click();
  });
  await flushMicrotasks(25);
  const seriesGrid = container.querySelector<HTMLElement>('[data-nav-grid="true"][data-virtual-container="true"]');
  assert.ok(seriesGrid, 'Filtro de categoria em Séries deve abrir grade virtualizada');
  assert.strictEqual(seriesGrid!.getAttribute('data-virtual-total'), '61', 'Grade filtrada de Ficção deve conter todas as 61 séries');

  unmountContainer(root, container);
  pass('Séries valida 10/24/25/61 itens, navegação completa, retorno de SeriesDetails além de 24 e filtro de categoria');
  });

  // --- Cenário 5: Auditoria em execução (somente leitura) da TV ao Vivo (>24 canais por categoria) ---
  await runCase('TV ao Vivo (somente leitura): confirmação de inexistência de truncamento acima de 24 canais', async () => {
  setNavMode('remote');
  const liveData = makeSyntheticLiveList([
    { id: 'l12', name: 'Notícias', count: 12 },
    { id: 'l60', name: 'Esportes', count: 60 },
  ]);

  const { container, root } = mountInContainer(
    React.createElement(
      XtreamCredentialsContext.Provider,
      { value: { credentials: SYNTHETIC_CREDENTIALS } },
      React.createElement(
        XtreamLiveContext.Provider,
        {
          value: {
            liveCategories: liveData.categories,
            liveStreams: liveData.streams,
            allLiveStreams: liveData.streams,
            liveCategoriesStatus: 'ready',
            liveCatalogStatus: 'ready',
            liveCategoriesError: null,
            liveError: null,
            loadingLive: false,
            loadedLiveCatalog: true,
            fetchLiveCategories: async () => {},
            fetchLiveStreams: async () => {},
          },
        },
        React.createElement(
          NavigationProvider,
          null,
          React.createElement(LiveTvView, {
            isTvMode: true,
            searchQuery: '',
          })
        )
      )
    )
  );
  await flushMicrotasks(35);

  const liveRows = Array.from(
    container.querySelectorAll<HTMLElement>('[data-live-category-row-scroll="true"]')
  );
  assert.ok(liveRows.length >= 2, `LiveTvView deve renderizar as 2 fileiras de categorias (encontradas: ${liveRows.length})`);

  const smallLiveRow = liveRows.find((r) => r.getAttribute('data-virtual-container') !== 'true');
  const largeLiveRow = liveRows.find((r) => r.getAttribute('data-virtual-container') === 'true');

  assert.ok(smallLiveRow, 'Categoria pequena de TV ao Vivo (12 canais) deve permanecer sem virtualização');
  assert.strictEqual(getMountedCardsInRow(smallLiveRow!).length, 12, 'Categoria de 12 canais deve montar todos os 12 canais');

  assert.ok(largeLiveRow, 'Categoria grande de TV ao Vivo (60 canais) deve ativar virtualização horizontal (HORIZ_VIRTUAL_THRESHOLD=24)');
  assert.ok(
    getMountedCardsInRow(largeLiveRow!).length < 30,
    `TV ao Vivo (60 canais) deve manter janela DOM limitada (montados: ${getMountedCardsInRow(largeLiveRow!).length})`
  );

  // Navegar além do 24º canal até o 60º canal (índice 59)
  const firstChannelBtn = largeLiveRow!.querySelector<HTMLElement>('[data-row-card-index="0"]');
  assert.ok(firstChannelBtn, 'Primeiro canal da categoria de 60 canais deve estar montado');
  act(() => {
    firstChannelBtn!.focus();
  });
  stepSpatial('right', 25);
  assert.strictEqual(getCardIndex(document.activeElement), 25, 'LiveTvView deve navegar além do 24º canal (índice 25)');
  stepSpatial('right', 34);
  assert.strictEqual(getCardIndex(document.activeElement), 59, 'LiveTvView deve alcançar o 60º canal (índice 59) sem truncamento');

  unmountContainer(root, container);
  pass('LiveTvView confirmado sem truncamento: categoria de 60 canais virtualiza janela e alcança do índice 0 ao 59');
  });

  if (caseIndex !== TOTAL_CASES) {
    throw new Error(
      `Contagem esperada de blocos em test-showcase-carousels (${TOTAL_CASES}) diverge da executada (${caseIndex}).`
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
  console.error('FALHA em test-showcase-carousels:', runError);
  if (teardownErrors.length > 0) {
    console.error('Erros adicionais durante teardown em test-showcase-carousels:', teardownErrors);
  }
  process.exitCode = 1;
} else if (teardownErrors.length > 0) {
  console.error('FALHA durante teardown em test-showcase-carousels:', teardownErrors);
  process.exitCode = 1;
} else if (summary) {
  if (selectedCaseNumber !== null) {
    console.log(
      `\n✅ Sucesso PARCIAL (filtro NC_SHOWCASE_CAROUSELS_CASE=${selectedCaseNumber}): ${summary.passed} bloco executado (${summary.skipped} ignorados de ${TOTAL_CASES}) em ${summary.durationMs}ms — test-showcase-carousels.`
    );
  } else {
    console.log(
      `\n✅ Todos os ${summary.passed}/${TOTAL_CASES} blocos de verificação de carrosséis completos passaram com sucesso em ${summary.durationMs}ms — test-showcase-carousels.`
    );
  }
}
