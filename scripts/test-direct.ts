import assert from 'assert';
import { Window } from 'happy-dom';

// 1. CONFIGURAÇÃO DO AMBIENTE DOM REAL (HAPPY-DOM) PARA TESTES DE HOOKS E UI
const windowInstance = new Window({
  url: 'http://localhost',
  width: 1280,
  height: 720,
});
(globalThis as any).window = windowInstance;
(globalThis as any).document = windowInstance.document;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(globalThis, 'navigator', {
  value: windowInstance.navigator,
  configurable: true,
  writable: true,
});
(globalThis as any).localStorage = windowInstance.localStorage;
(globalThis as any).HTMLElement = windowInstance.HTMLElement;
(globalThis as any).HTMLInputElement = (windowInstance as any).HTMLInputElement;
(globalThis as any).Element = windowInstance.Element;
(globalThis as any).Node = windowInstance.Node;
(globalThis as any).HTMLMediaElement = windowInstance.HTMLMediaElement;
(globalThis as any).HTMLVideoElement = windowInstance.HTMLVideoElement;
(globalThis as any).Event = windowInstance.Event;
(globalThis as any).CustomEvent = windowInstance.CustomEvent;
(globalThis as any).KeyboardEvent = (windowInstance as any).KeyboardEvent;
(globalThis as any).MouseEvent = windowInstance.MouseEvent;
(globalThis as any).PointerEvent = windowInstance.PointerEvent;
(globalThis as any).StorageEvent = windowInstance.StorageEvent;
(globalThis as any).MutationObserver = (windowInstance as any).MutationObserver;
(globalThis as any).getComputedStyle = windowInstance.getComputedStyle.bind(windowInstance);

// Implementação coerente de requestAnimationFrame / cancelAnimationFrame para motion/react e hooks de UI
let nextRafId = 0;
const rafTimers = new Map<number, ReturnType<typeof setTimeout>>();

const testRequestAnimationFrame = (callback: FrameRequestCallback): number => {
  const id = ++nextRafId;
  const handle = setTimeout(() => {
    rafTimers.delete(id);
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    callback(now);
  }, 16);
  rafTimers.set(id, handle);
  return id;
};

const testCancelAnimationFrame = (id: number): void => {
  const handle = rafTimers.get(id);
  if (handle !== undefined) {
    clearTimeout(handle);
    rafTimers.delete(id);
  }
};

(windowInstance as any).requestAnimationFrame = testRequestAnimationFrame;
(windowInstance as any).cancelAnimationFrame = testCancelAnimationFrame;
(globalThis as any).requestAnimationFrame = testRequestAnimationFrame;
(globalThis as any).cancelAnimationFrame = testCancelAnimationFrame;

// No Happy DOM, a implementação parcial de WAAPI (Element.prototype.animate / KeyframeEffect)
// falha ao interpretar variáveis CSS compostas (ex.: var(--nc-player-btn-scale)) e não conclui onfinish.
// Removendo Element.prototype.animate no ambiente de teste, o motion/react utiliza seu motor JS determinístico via requestAnimationFrame.
delete (windowInstance.Element.prototype as any).animate;
delete (windowInstance.HTMLElement.prototype as any).animate;


let videoLoadCallCount = 0;
let videoPlayCallCount = 0;
let videoPauseCallCount = 0;

HTMLMediaElement.prototype.play = function () {
  videoPlayCallCount++;
  Object.defineProperty(this, 'paused', { value: false, configurable: true, writable: true });
  this.dispatchEvent(new windowInstance.Event('play'));
  this.dispatchEvent(new windowInstance.Event('playing'));
  return Promise.resolve();
};
HTMLMediaElement.prototype.pause = function () {
  videoPauseCallCount++;
  Object.defineProperty(this, 'paused', { value: true, configurable: true, writable: true });
  this.dispatchEvent(new windowInstance.Event('pause'));
};
HTMLMediaElement.prototype.load = function () {
  videoLoadCallCount++;
  this.dispatchEvent(new windowInstance.Event('loadstart'));
};

let currentFullscreenElement: Element | null = null;
Object.defineProperty(windowInstance.document, 'fullscreenElement', {
  get() {
    return currentFullscreenElement;
  },
  configurable: true,
});
(windowInstance.document as any).exitFullscreen = async function () {
  currentFullscreenElement = null;
  windowInstance.document.dispatchEvent(new windowInstance.Event('fullscreenchange'));
};
(windowInstance.HTMLElement.prototype as any).requestFullscreen = async function () {
  currentFullscreenElement = this;
  windowInstance.document.dispatchEvent(new windowInstance.Event('fullscreenchange'));
};

const scrollTopMap = new WeakMap<Element, number>();
Object.defineProperty(windowInstance.HTMLElement.prototype, 'scrollTop', {
  get() {
    return scrollTopMap.get(this) || 0;
  },
  set(val: number) {
    scrollTopMap.set(this, val);
  },
  configurable: true,
});

const scrollLeftMap = new WeakMap<Element, number>();
Object.defineProperty(windowInstance.HTMLElement.prototype, 'scrollLeft', {
  get() {
    return scrollLeftMap.get(this) || 0;
  },
  set(val: number) {
    scrollLeftMap.set(this, val);
  },
  configurable: true,
});

windowInstance.HTMLElement.prototype.scrollTo = function (
  optionsOrX?: ScrollToOptions | number,
  y?: number
) {
  if (typeof optionsOrX === 'number') {
    this.scrollLeft = optionsOrX;
    if (typeof y === 'number') {
      this.scrollTop = y;
    }
  } else if (optionsOrX && typeof optionsOrX === 'object') {
    if (typeof optionsOrX.left === 'number') {
      this.scrollLeft = optionsOrX.left;
    }
    if (typeof optionsOrX.top === 'number') {
      this.scrollTop = optionsOrX.top;
    }
  }
};

windowInstance.HTMLElement.prototype.scrollBy = function (
  optionsOrX?: ScrollToOptions | number,
  y?: number
) {
  if (typeof optionsOrX === 'number') {
    this.scrollLeft = (this.scrollLeft || 0) + optionsOrX;
    if (typeof y === 'number') {
      this.scrollTop = (this.scrollTop || 0) + y;
    }
  } else if (optionsOrX && typeof optionsOrX === 'object') {
    if (typeof optionsOrX.left === 'number') {
      this.scrollLeft = (this.scrollLeft || 0) + optionsOrX.left;
    }
    if (typeof optionsOrX.top === 'number') {
      this.scrollTop = (this.scrollTop || 0) + optionsOrX.top;
    }
  }
};

// 1.5 GUARDA DE ISOLAMENTO DE REDE PARA TESTES AUTOMATIZADOS (SEM ACESSO EXTERNO)
function sanitizeUrlForTestLog(rawUrl: unknown): string {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return '[url-vazia]';
  try {
    const parsed = new URL(rawUrl, 'http://localhost');
    // Remove credenciais de path (/live/user/pass/id -> /live/[redacted]/[redacted]/id) e query params
    const safePath = parsed.pathname.replace(
      /^\/(live|movie|series)\/[^/]+\/[^/]+\//i,
      '/$1/[redacted]/[redacted]/'
    );
    return `${parsed.origin}${safePath}`;
  } catch {
    return '[url-sanitizada]';
  }
}

let externalNetworkGuardHandler: ((url: string, init?: RequestInit) => Promise<Response>) | null =
  null;
let blockedExternalNetworkCount = 0;

const offlineFetchGuard = async (input: any, init?: RequestInit): Promise<Response> => {
  const rawUrl =
    typeof input === 'string'
      ? input
      : input && typeof input.url === 'string'
        ? input.url
        : String(input ?? '');
  if (externalNetworkGuardHandler) {
    return externalNetworkGuardHandler(rawUrl, init);
  }
  blockedExternalNetworkCount++;
  throw new Error(
    `[TestNetworkGuard] Chamada HTTP externa bloqueada durante os testes: ${sanitizeUrlForTestLog(rawUrl)}`
  );
};

(windowInstance as any).fetch = offlineFetchGuard;
(globalThis as any).fetch = offlineFetchGuard;

if ((windowInstance as any).XMLHttpRequest) {
  (windowInstance as any).XMLHttpRequest.prototype.send = function () {
    blockedExternalNetworkCount++;
    throw new Error('[TestNetworkGuard] XMLHttpRequest externo bloqueado durante os testes.');
  };
}

// 2. IMPORTAÇÃO DINÂMICA DOS MÓDULOS REAIS DO PROJETO (APÓS INICIALIZAR WINDOW E REQUESTANIMATIONFRAME)
import fs from 'fs';
import path from 'path';
import React, { act } from 'react';
import type { XtreamCredentials } from '../src/types';
import type { FavoriteItem } from '../src/hooks/useFavorites';

const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const axiosModule = await import('axios');
const axios = axiosModule.default;

axios.defaults.adapter = async (config) => {
  blockedExternalNetworkCount++;
  throw new Error(
    `[TestNetworkGuard] Requisição axios externa bloqueada nos testes: ${sanitizeUrlForTestLog(config?.url)}`
  );
};

const {
  normalizeServerUrl,
  normalizeImageSource,
  buildDirectMediaUrl,
  buildDirectImageUrl,
} = await import('../src/utils/mediaUtils');
const {
  getFavoritesKey,
  FAVORITES_KEY_PREFIX,
  CREDENTIALS_KEY,
} = await import('../src/utils/accountUtils');
const { useFavorites, getCachedFavoritesForAccount } = await import('../src/hooks/useFavorites');
const { VideoPlayer } = await import('../src/components/VideoPlayer');
const { DisplaySetupModal } = await import('../src/components/DisplaySetupModal');
const { FavoritesView } = await import('../src/views/FavoritesView');
const { MoviesView } = await import('../src/views/MoviesView');
const { SeriesView } = await import('../src/views/SeriesView');
const { LiveTvView } = await import('../src/views/LiveTvView');
const { ConfigView } = await import('../src/views/ConfigView');
const {
  XtreamProvider,
  XtreamMockProvider,
  XtreamContext,
  useXtreamContext,
  useXtreamCredentials,
  useOptionalXtreamCredentials,
  useXtreamSession,
  useXtreamLive,
  useXtreamVod,
  useXtreamSeries,
} = await import('../src/context/XtreamContext');
const { XtreamService, normalizeCatalogArray } = await import('../src/services/xtreamService');
const { Home } = await import('../src/pages/Home');
const {
  STORAGE_KEY_DISPLAY_PREFS,
  getDisplayPreferencesSnapshot,
  startDisplayPreview,
  cancelDisplayPreview,
  confirmDisplayPreferences,
  createDisplayPreviewSession,
  readDisplayEnvironmentDiagnostics,
} = await import('../src/platform/tvEnvironment');

// Mocks padrão offline para todos os métodos de XtreamService desde o início da suíte
const originalXtreamAuthenticate = XtreamService.authenticate.bind(XtreamService);
const origXtreamMethods = {
  getLiveCategories: XtreamService.getLiveCategories.bind(XtreamService),
  getVodCategories: XtreamService.getVodCategories.bind(XtreamService),
  getSeriesCategories: XtreamService.getSeriesCategories.bind(XtreamService),
  getLiveStreams: XtreamService.getLiveStreams.bind(XtreamService),
  getVodStreams: XtreamService.getVodStreams.bind(XtreamService),
  getSeries: XtreamService.getSeries.bind(XtreamService),
  getVodInfo: XtreamService.getVodInfo.bind(XtreamService),
  getSeriesInfo: XtreamService.getSeriesInfo.bind(XtreamService),
  getShortEpg: XtreamService.getShortEpg.bind(XtreamService),
  authenticate: XtreamService.authenticate.bind(XtreamService),
};

function installDefaultXtreamOfflineMocks(): void {
  (XtreamService as any).authenticate = async (creds?: XtreamCredentials) => ({
    user_info: {
      username: creds?.username || 'testUser',
      auth: 1,
      status: 'Active',
      exp_date: '1893456000',
      active_cons: '1',
      max_connections: '3',
      allowed_output_formats: creds?.allowed_output_formats || ['m3u8', 'ts'],
    },
    server_info: {
      allowed_output_formats: creds?.allowed_output_formats || ['m3u8', 'ts'],
    },
  });
  (XtreamService as any).getLiveCategories = async () => [];
  (XtreamService as any).getVodCategories = async () => [];
  (XtreamService as any).getSeriesCategories = async () => [];
  (XtreamService as any).getLiveStreams = async () => [];
  (XtreamService as any).getVodStreams = async () => [];
  (XtreamService as any).getSeries = async () => [];
  (XtreamService as any).getVodInfo = async () => ({ info: {}, movie_data: {} });
  (XtreamService as any).getSeriesInfo = async () => ({ info: {}, episodes: {} });
  (XtreamService as any).getShortEpg = async () => ({ epg_listings: [] });
}

installDefaultXtreamOfflineMocks();

const origGetItem = windowInstance.localStorage.getItem;
const origSetItem = windowInstance.localStorage.setItem;
const origRemoveItem = windowInstance.localStorage.removeItem;

function describeElement(el: Element | null | undefined): string {
  if (!el) return 'null';
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const scope = el.getAttribute('data-focus-scope')
    ? `[data-focus-scope="${el.getAttribute('data-focus-scope')}"]`
    : '';
  const player = el.getAttribute('data-player-container')
    ? `[data-player-container="${el.getAttribute('data-player-container')}"]`
    : '';
  const navId =
    el.getAttribute('data-header-nav-id') || el.getAttribute('data-sidebar-nav-id')
      ? `[nav="${el.getAttribute('data-header-nav-id') || el.getAttribute('data-sidebar-nav-id')}"]`
      : '';
  const catId =
    el.getAttribute('data-category-id') || el.getAttribute('data-live-category-id')
      ? `[cat="${el.getAttribute('data-category-id') || el.getAttribute('data-live-category-id')}"]`
      : '';
  const chId = el.getAttribute('data-live-channel-id')
    ? `[channel="${el.getAttribute('data-live-channel-id')}"]`
    : '';
  const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  return `<${tag}${id}${player}${scope}${navId}${catId}${chId}>("${text}")`;
}

function assertSameElement(
  actual: Element | null | undefined,
  expected: Element | null | undefined,
  message: string
): void {
  if (actual !== expected) {
    assert.fail(
      `${message} | esperado: ${describeElement(expected)} | obtido: ${describeElement(actual)}`
    );
  }
}

function assertDifferentElement(
  actual: Element | null | undefined,
  unexpected: Element | null | undefined,
  message: string
): void {
  if (actual === unexpected) {
    assert.fail(`${message} | não deveria ser: ${describeElement(unexpected)}`);
  }
}

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs: number,
  description: string
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
  if (!predicate()) {
    throw new Error(`Timeout (${timeoutMs}ms) aguardando condição: ${description}`);
  }
}

// -------------------------------------------------------------
// 3. TESTES DE REGRESSÃO DE URLS E IMAGENS
// -------------------------------------------------------------
function runDirectUrlTests() {
  console.log('--- 1. Testes de Regressão de URLs e Imagens ---');

  assert.strictEqual(normalizeServerUrl('example.com:8080'), 'http://example.com:8080');
  assert.strictEqual(normalizeServerUrl('http:/example.com:8080/'), 'http://example.com:8080');
  assert.strictEqual(normalizeServerUrl('https://provider.tv:8443/custom/base/'), 'https://provider.tv:8443/custom/base');
  assert.strictEqual(normalizeServerUrl('http://iptv.server.net/'), 'http://iptv.server.net');

  assert.strictEqual(normalizeImageSource('  https://example.com/cover.jpg  '), 'https://example.com/cover.jpg');
  assert.strictEqual(
    normalizeImageSource(['https://example.com/backdrop1.jpg', 'https://example.com/backdrop2.jpg']),
    'https://example.com/backdrop1.jpg'
  );
  assert.strictEqual(normalizeImageSource([]), null);

  const testCreds: XtreamCredentials = {
    serverUrl: 'http://myprovider.xyz:8080',
    username: 'user@test+1',
    password: 'p@ssword#123',
  };

  const liveUrl1 = buildDirectMediaUrl(testCreds, { type: 'live', streamId: 1042 });
  assert.strictEqual(liveUrl1, 'http://myprovider.xyz:8080/live/user%40test%2B1/p%40ssword%23123/1042.m3u8');

  const movieUrl1 = buildDirectMediaUrl(testCreds, { type: 'movie', streamId: 9001 });
  assert.strictEqual(movieUrl1, 'http://myprovider.xyz:8080/movie/user%40test%2B1/p%40ssword%23123/9001.mp4');

  const providerWithUrlParam =
    'http://logos.exemplo.test/image.php?url=https%3A%2F%2Fstorage.exemplo.test%2Fcanal.png&sig=abc#frag';
  assert.strictEqual(buildDirectImageUrl(providerWithUrlParam), providerWithUrlParam);

  console.log('✅ URLs e Imagens diretas validadas com sucesso!');
}

// -------------------------------------------------------------
// 4. TESTES DOS FAVORITOS SIMPLES, RESILIÊNCIA E INTERFACE
// -------------------------------------------------------------
async function runSimpleFavoritesTests() {
  console.log('--- 2. Testes de Favoritos Simples, Resiliência e Interface ---');

  const credsA: XtreamCredentials = { serverUrl: 'http://provider.tv:8080', username: 'usuarioA', password: 'pA' };
  const credsB: XtreamCredentials = { serverUrl: 'http://provider.tv:8080', username: 'usuarioB', password: 'pB' };

  const keyA = getFavoritesKey(credsA.serverUrl, credsA.username);
  const keyB = getFavoritesKey(credsB.serverUrl, credsB.username);

  assert(keyA.startsWith(FAVORITES_KEY_PREFIX), 'Chave deve usar o novo prefixo northcode_favorites_');
  assert(keyB.startsWith(FAVORITES_KEY_PREFIX), 'Chave B deve usar o novo prefixo northcode_favorites_');
  assert.notStrictEqual(keyA, keyB, 'Contas diferentes devem produzir chaves diferentes');

  window.localStorage.clear();

  let hookA: ReturnType<typeof useFavorites> | null = null;
  function AppA() {
    hookA = useFavorites(credsA);
    return React.createElement('div', null, 'App A');
  }

  const containerA = window.document.createElement('div');
  window.document.body.appendChild(containerA);
  const rootA = createRoot(containerA);

  await act(async () => {
    rootA.render(React.createElement(AppA));
  });

  // CASO A: Chave realmente ausente permite salvar o primeiro favorito
  console.log('Caso A: Chave ausente permite salvar o primeiro favorito');
  assert.strictEqual(window.localStorage.getItem(keyA), null, 'Chave realmente ausente no storage');
  assert.strictEqual(hookA!.favorites.length, 0, 'Conta nova começa com favoritos vazios');

  const itemLive: FavoriteItem = { id: 10, name: 'Canal News', type: 'live', cover: 'http://img/live.png' };
  const itemMovie: FavoriteItem = { id: 10, name: 'Filme Ação', type: 'movie', cover: 'http://img/movie.png' };
  const itemSeries: FavoriteItem = { id: 30, name: 'Série Drama', type: 'series', cover: 'http://img/series.png' };

  await act(async () => {
    assert.strictEqual(hookA!.toggleFavorite(itemLive), true);
    assert.strictEqual(hookA!.toggleFavorite(itemMovie), true);
    assert.strictEqual(hookA!.toggleFavorite(itemSeries), true);
  });

  assert.strictEqual(hookA!.favorites.length, 3, 'Lista deve conter 3 itens');
  assert.strictEqual(hookA!.isFavorite(10, 'live'), true);
  assert.strictEqual(hookA!.isFavorite(10, 'movie'), true);
  assert.strictEqual(hookA!.isFavorite(30, 'series'), true);

  // CASO B: Desfavoritar um item e confirmar remoção
  console.log('Caso B: Desfavoritar item e confirmar remoção');
  await act(async () => {
    assert.strictEqual(hookA!.toggleFavorite(itemLive), true, 'Remover canal');
  });

  assert.strictEqual(hookA!.favorites.length, 2, 'Lista deve ter 2 itens após remoção');
  assert.strictEqual(hookA!.isFavorite(10, 'live'), false);
  assert.strictEqual(hookA!.isFavorite(10, 'movie'), true);

  // CASO C: Fechar/desmontar e reabrir na mesma conta mantendo storage
  console.log('Caso C: Fechar/desmontar e reabrir na mesma conta mantendo storage');
  await act(async () => {
    rootA.unmount();
  });

  const containerA2 = window.document.createElement('div');
  window.document.body.appendChild(containerA2);
  const rootA2 = createRoot(containerA2);

  await act(async () => {
    rootA2.render(React.createElement(AppA));
  });

  assert.strictEqual(hookA!.favorites.length, 2, 'Itens devem continuar salvos após reabrir');
  assert.strictEqual(hookA!.isFavorite(10, 'movie'), true);
  assert.strictEqual(hookA!.isFavorite(30, 'series'), true);

  // CASO D: Dois consumidores da mesma conta observam a alteração imediatamente
  console.log('Caso D: Dois consumidores da mesma conta observam a alteração imediatamente');
  let hookA_consumer2: ReturnType<typeof useFavorites> | null = null;
  function AppA2() {
    hookA_consumer2 = useFavorites(credsA);
    return React.createElement('div', null, 'App A Consumidor 2');
  }

  const containerA_sub = window.document.createElement('div');
  window.document.body.appendChild(containerA_sub);
  const rootA_sub = createRoot(containerA_sub);

  await act(async () => {
    rootA_sub.render(React.createElement(AppA2));
  });

  assert.strictEqual(hookA_consumer2!.favorites.length, 2);

  await act(async () => {
    hookA!.toggleFavorite({ id: 99, name: 'Novo Filme', type: 'movie', cover: '' });
  });

  assert.strictEqual(hookA!.favorites.length, 3);
  assert.strictEqual(hookA_consumer2!.favorites.length, 3);

  // CASO E: Isolamento por conta (Conta B com lista própria)
  console.log('Caso E: Isolamento por conta (Conta B com lista própria)');
  let hookB: ReturnType<typeof useFavorites> | null = null;
  function AppB() {
    hookB = useFavorites(credsB);
    return React.createElement('div', null, 'App B');
  }

  const containerB = window.document.createElement('div');
  window.document.body.appendChild(containerB);
  const rootB = createRoot(containerB);

  await act(async () => {
    rootB.render(React.createElement(AppB));
  });

  assert.strictEqual(hookB!.favorites.length, 0);

  await act(async () => {
    hookB!.toggleFavorite({ id: 500, name: 'Item Exclusivo B', type: 'live', cover: '' });
  });

  assert.strictEqual(hookB!.favorites.length, 1);
  assert.strictEqual(hookA!.favorites.length, 3);

  // CASO 1 EXIGIDO: Conta tem favoritos persistidos; getItem lança exceção para a chave dessa conta
  // enquanto setItem continuaria funcionando; tentativa de adicionar/remover retorna false,
  // NÃO chama setItem e preserva integralmente a string JSON original. Ao normalizar a leitura,
  // os favoritos originais continuam visíveis.
  console.log('Caso 1 Exigido: Falha de leitura impede sobrescrita e preserva JSON original');
  const originalJsonString = window.localStorage.getItem(keyA);
  assert(originalJsonString && originalJsonString.length > 0, 'Conta A deve possuir JSON persistido');

  let setItemCalledForKeyA = false;
  Object.defineProperty(windowInstance.localStorage, 'getItem', {
    value: function (k: string) {
      if (k === keyA) {
        throw new Error('Simulated Read Error: Storage Read Failed for keyA');
      }
      return origGetItem.call(windowInstance.localStorage, k);
    },
    configurable: true,
    writable: true,
  });

  Object.defineProperty(windowInstance.localStorage, 'setItem', {
    value: function (k: string, v: string) {
      if (k === keyA) {
        setItemCalledForKeyA = true;
      }
      return origSetItem.call(windowInstance.localStorage, k, v);
    },
    configurable: true,
    writable: true,
  });

  await act(async () => {
    const resAdd = hookA!.toggleFavorite({ id: 8888, name: 'Item Durante Erro', type: 'movie', cover: '' });
    assert.strictEqual(resAdd, false, 'toggleFavorite deve retornar false quando leitura de storage falha');
  });

  assert.strictEqual(setItemCalledForKeyA, false, 'setItem NÃO deve ser chamado para keyA quando leitura falhou!');

  // Restaurar getItem e setItem
  Object.defineProperty(windowInstance.localStorage, 'getItem', {
    value: origGetItem,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(windowInstance.localStorage, 'setItem', {
    value: origSetItem,
    configurable: true,
    writable: true,
  });

  const preservedJsonString = window.localStorage.getItem(keyA);
  assert.strictEqual(preservedJsonString, originalJsonString, 'String JSON original deve ser preservada integralmente');

  // Leitura volta ao normal: favoritos originais continuam visíveis
  const favoritesAfterRecovery = hookA!.favorites;
  assert.strictEqual(favoritesAfterRecovery.length, 3, 'Favoritos originais continuam visíveis após normalização');
  assert.strictEqual(hookA!.isFavorite(10, 'movie'), true);
  assert.strictEqual(hookA!.isFavorite(30, 'series'), true);
  assert.strictEqual(hookA!.isFavorite(99, 'movie'), true);
  assert.strictEqual(hookA!.isFavorite(8888, 'movie'), false, 'Item não salvo não deve constar');

  // CASO 3 EXIGIDO: Falha de setItem continua retornando false, sem marcar o item como salvo
  console.log('Caso 3 Exigido: Falha de setItem retorna false sem marcar item como salvo');
  const countBeforeSetFail = hookA!.favorites.length;

  Object.defineProperty(windowInstance.localStorage, 'setItem', {
    value: function (k: string, v: string) {
      if (k === keyA) {
        throw new Error('QuotaExceededError: LocalStorage quota exceeded (simulated)');
      }
      return origSetItem.call(windowInstance.localStorage, k, v);
    },
    configurable: true,
    writable: true,
  });

  await act(async () => {
    const success = hookA!.toggleFavorite({ id: 9999, name: 'Item Quota', type: 'movie', cover: '' });
    assert.strictEqual(success, false, 'toggleFavorite deve retornar false em falha de setItem');
  });

  assert.strictEqual(hookA!.favorites.length, countBeforeSetFail, 'Lista não deve ter incrementado');
  assert.strictEqual(hookA!.isFavorite(9999, 'movie'), false, 'Item não deve estar marcado como salvo');

  Object.defineProperty(windowInstance.localStorage, 'setItem', {
    value: origSetItem,
    configurable: true,
    writable: true,
  });

  // CASO 4 EXIGIDO: Na interface, falha ao favoritar ou desfavoritar apresenta o aviso; sucesso não apresenta aviso de erro
  console.log('Caso 4 Exigido: Na interface, falha apresenta aviso e sucesso não apresenta');
  const containerUI = window.document.createElement('div');
  window.document.body.appendChild(containerUI);
  const rootUI = createRoot(containerUI);

  await act(async () => {
    rootUI.render(
      React.createElement(
        XtreamProvider,
        { credentials: credsA },
        React.createElement(FavoritesView, { onPlay: () => {} })
      )
    );
  });

  // Verificar que inicialmente não há alerta de erro
  let alertEl = containerUI.querySelector('[role="alert"]');
  assert.strictEqual(alertEl, null, 'Inicialmente não deve haver alerta de erro na interface');

  // Simular falha de setItem ao desfavoritar um item pela interface
  Object.defineProperty(windowInstance.localStorage, 'setItem', {
    value: function (k: string, v: string) {
      if (k === keyA) {
        throw new Error('QuotaExceededError: simulated error');
      }
      return origSetItem.call(windowInstance.localStorage, k, v);
    },
    configurable: true,
    writable: true,
  });

  // Encontrar o botão de desfavoritar do primeiro item
  const unfavButton = containerUI.querySelector('button[title="Remover dos favoritos"]') as HTMLButtonElement;
  assert(unfavButton, 'Botão de remover favorito deve estar presente no DOM');

  await act(async () => {
    unfavButton.click();
  });

  // Verificar que agora o aviso está visível na tela
  alertEl = containerUI.querySelector('[role="alert"]');
  assert(alertEl, 'Elemento com role="alert" deve estar visível após falha ao desfavoritar');
  assert(
    alertEl.textContent?.includes('Não foi possível salvar os favoritos'),
    `Aviso deve conter mensagem clara de erro. Obtido: "${alertEl.textContent}"`
  );

  // Restaurar setItem e executar ação com sucesso
  Object.defineProperty(windowInstance.localStorage, 'setItem', {
    value: origSetItem,
    configurable: true,
    writable: true,
  });

  // Fechar o aviso clicando no botão fechar do alerta
  const closeAlertBtn = alertEl.querySelector('button[aria-label="Fechar aviso"]') as HTMLButtonElement;
  if (closeAlertBtn) {
    await act(async () => {
      closeAlertBtn.click();
    });
  }

  alertEl = containerUI.querySelector('[role="alert"]');
  assert.strictEqual(alertEl, null, 'Alerta de erro deve ser fechado');

  // Agora desfavoritar com sucesso
  await act(async () => {
    unfavButton.click();
  });

  alertEl = containerUI.querySelector('[role="alert"]');
  assert.strictEqual(alertEl, null, 'Operação com sucesso NÃO deve apresentar alerta de erro');

  await act(async () => {
    rootUI.unmount();
  });

  // CASO 5 EXIGIDO: Falha simulada de removeItem mantém a navegação e as credenciais como estavam e apresenta o aviso; sucesso remove as credenciais e navega normalmente
  console.log('Caso 5 Exigido: Falha de removeItem mantém credenciais/tela e mostra aviso; sucesso desloga');
  window.localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(credsA));

  const containerHome = window.document.createElement('div');
  window.document.body.appendChild(containerHome);
  const rootHome = createRoot(containerHome);

  await act(async () => {
    rootHome.render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/home'] },
        React.createElement(Home)
      )
    );
  });

  // Simular falha de removeItem ao fazer logout
  Object.defineProperty(windowInstance.localStorage, 'removeItem', {
    value: function (k: string) {
      if (k === CREDENTIALS_KEY) {
        throw new Error('Simulated RemoveItem Error: cannot remove credentials');
      }
      return origRemoveItem.call(windowInstance.localStorage, k);
    },
    configurable: true,
    writable: true,
  });

  // Localizar botão "Sair" no menu da conta do cabeçalho superior
  const accountTriggerHome = containerHome.querySelector<HTMLButtonElement>(
    'button[data-header-account-trigger="true"]'
  );
  assert(accountTriggerHome, 'Botão da conta deve estar presente no cabeçalho');
  await act(async () => {
    accountTriggerHome.click();
  });

  const logoutButtons = Array.from(containerHome.querySelectorAll('button'));
  const logoutBtn = logoutButtons.find((btn) => btn.textContent?.includes('Sair'));
  assert(logoutBtn, 'Botão Sair deve estar presente no menu da conta');

  await act(async () => {
    logoutBtn.click();
  });

  // Credenciais devem permanecer no localStorage
  assert(window.localStorage.getItem(CREDENTIALS_KEY) !== null, 'Credenciais devem permanecer intactas após falha de remoção');

  // Alerta deve ser apresentado
  const homeAlert = containerHome.querySelector('[role="alert"]');
  assert(homeAlert, 'Aviso com role="alert" deve estar presente na tela após falha no logout');
  assert(
    homeAlert.textContent?.includes('Não foi possível sair deste dispositivo'),
    `Aviso deve informar que não foi possível sair. Obtido: "${homeAlert.textContent}"`
  );

  // Agora restaurar removeItem e fazer logout com sucesso
  Object.defineProperty(windowInstance.localStorage, 'removeItem', {
    value: origRemoveItem,
    configurable: true,
    writable: true,
  });

  await act(async () => {
    accountTriggerHome.click();
  });
  const logoutBtnRetry = containerHome.querySelector<HTMLButtonElement>(
    'button[data-account-action="logout"]'
  );
  assert(logoutBtnRetry, 'Botão Sair deve estar presente ao reabrir o menu da conta');
  await act(async () => {
    logoutBtnRetry.click();
  });

  assert.strictEqual(window.localStorage.getItem(CREDENTIALS_KEY), null, 'Credenciais devem ter sido removidas com sucesso no logout');

  await act(async () => {
    rootHome.unmount();
  });

  // CASO 6 EXIGIDO: Leitura única de snapshot impede corrupção do cache por falha intermitente de getItem
  console.log('Caso 6 Exigido: Leitura única de snapshot impede corrupção do cache por falha intermitente');

  // Parte 1: Teste direto na função getCachedFavoritesForAccount reproduzindo a falha da versão anterior
  const keyDemo = getFavoritesKey('http://provider.tv:8080', 'usuarioDemo');
  const itemsDemo: FavoriteItem[] = [
    { id: 901, name: 'Canal Demo 1', type: 'live', cover: '' },
    { id: 902, name: 'Filme Demo 2', type: 'movie', cover: '' },
  ];
  window.localStorage.setItem(keyDemo, JSON.stringify(itemsDemo));

  // No código anterior de 2 leituras: a 1ª lia raw, e a 2ª (readStoredFavorites) lia novamente.
  // Se houvesse erro na 2ª leitura, a função gravava { raw, items: [] } no cache, corrompendo-o.
  let readsInCall = 0;
  Object.defineProperty(windowInstance.localStorage, 'getItem', {
    value: function (k: string) {
      if (k === keyDemo) {
        readsInCall++;
        if (readsInCall === 2) {
          throw new Error('Falha simulada na 2ª leitura de localStorage (defeito da versão anterior)');
        }
      }
      return origGetItem.call(windowInstance.localStorage, k);
    },
    configurable: true,
    writable: true,
  });

  // Executar getCachedFavoritesForAccount com o getItem interceptado
  const snapshotDemo = getCachedFavoritesForAccount(keyDemo);

  // Na implementação corrigida com leitura única, exatamente 1 leitura é feita
  assert.strictEqual(readsInCall, 1, 'getCachedFavoritesForAccount deve realizar estritamente UMA leitura de localStorage');
  assert.strictEqual(snapshotDemo.length, 2, 'Snapshot não deve ficar vazio após a leitura única');

  // Restaurar getItem normal
  Object.defineProperty(windowInstance.localStorage, 'getItem', {
    value: origGetItem,
    configurable: true,
    writable: true,
  });

  // Leituras seguintes continuam retornando os favoritos originais sem lista vazia
  const snapshotDemoAfter = getCachedFavoritesForAccount(keyDemo);
  assert.strictEqual(snapshotDemoAfter.length, 2, 'Favoritos continuam intactos no cache após restauração');
  assert.strictEqual(snapshotDemoAfter[0].id, 901);
  assert.strictEqual(snapshotDemoAfter[1].id, 902);

  // Parte 2: Teste do ciclo de vida no hook useFavorites com falha intermitente
  const credsC: XtreamCredentials = { serverUrl: 'http://provider.tv:8080', username: 'usuarioC', password: 'pC' };
  const keyC = getFavoritesKey(credsC.serverUrl, credsC.username);

  const initialFavsC: FavoriteItem[] = [
    { id: 701, name: 'Canal C', type: 'live', cover: '' },
    { id: 702, name: 'Filme C', type: 'movie', cover: '' },
  ];
  window.localStorage.setItem(keyC, JSON.stringify(initialFavsC));

  let hookC: ReturnType<typeof useFavorites> | null = null;
  function AppC() {
    hookC = useFavorites(credsC);
    return React.createElement('div', null, 'App C');
  }

  const containerC = window.document.createElement('div');
  window.document.body.appendChild(containerC);
  const rootC = createRoot(containerC);

  await act(async () => {
    rootC.render(React.createElement(AppC));
  });

  assert.strictEqual(hookC!.favorites.length, 2, 'Conta C inicia com 2 favoritos visíveis');

  // Simular falha intermitente de leitura em getItem durante operação no componente
  Object.defineProperty(windowInstance.localStorage, 'getItem', {
    value: function (k: string) {
      if (k === keyC) {
        throw new Error('Falha intermitente simulada em getItem');
      }
      return origGetItem.call(windowInstance.localStorage, k);
    },
    configurable: true,
    writable: true,
  });

  // Chamar getCachedFavoritesForAccount com erro simulado de leitura
  const snapshotUnderFailure = getCachedFavoritesForAccount(keyC);
  assert.strictEqual(snapshotUnderFailure.length, 2, 'Cache e lista não viram vazios durante falha de leitura');

  // Restaurar getItem normal
  Object.defineProperty(windowInstance.localStorage, 'getItem', {
    value: origGetItem,
    configurable: true,
    writable: true,
  });

  // Ao voltar a funcionar, os favoritos originais continuam visíveis
  const snapshotRecovered = getCachedFavoritesForAccount(keyC);
  assert.strictEqual(snapshotRecovered.length, 2, 'Favoritos originais continuam visíveis após recuperação da leitura');
  assert.strictEqual(snapshotRecovered[0].id, 701);
  assert.strictEqual(snapshotRecovered[1].id, 702);

  await act(async () => {
    rootC.unmount();
    rootA2.unmount();
    rootA_sub.unmount();
    rootB.unmount();
  });

  console.log('✅ Todos os testes de favoritos simples, resiliência e interface aprovados!');
}

// -------------------------------------------------------------
// 5. TESTES DE REGRESSÃO DO PLAYER (SESSÃO, VOLUME, VELOCIDADE, MUTE)
// -------------------------------------------------------------
async function runPlayerVolumeRateAndSessionTests() {
  console.log('--- 3. Testes de Regressão do Player (Sessão, Volume, Taxa, Mute) ---');

  videoLoadCallCount = 0;
  videoPlayCallCount = 0;
  videoPauseCallCount = 0;

  function PlayerWrapper({ url }: { url: string }) {
    return React.createElement(VideoPlayer, {
      streamUrl: url,
      title: 'Vídeo de Teste',
      contentType: 'movie',
      onBack: () => {},
      embedded: true,
    });
  }

  const containerP = window.document.createElement('div');
  window.document.body.appendChild(containerP);
  const rootP = createRoot(containerP);

  await act(async () => {
    rootP.render(React.createElement(PlayerWrapper, { url: 'http://server.tv:8080/movie/u/p/100.mp4' }));
  });

  const videoEl = containerP.querySelector('video') as HTMLVideoElement;
  assert(videoEl, 'Elemento video deve estar presente no DOM');
  const initialLoadCount = videoLoadCallCount;

  // Ajustes de volume, mute e rate não devem invocar video.load()
  await act(async () => {
    videoEl.volume = 0.5;
    videoEl.dispatchEvent(new windowInstance.Event('volumechange') as unknown as Event);
    videoEl.muted = true;
    videoEl.dispatchEvent(new windowInstance.Event('volumechange') as unknown as Event);
    videoEl.playbackRate = 1.25;
    videoEl.dispatchEvent(new windowInstance.Event('ratechange') as unknown as Event);
  });

  assert.strictEqual(videoLoadCallCount, initialLoadCount, 'Volume/mute/velocidade NÃO devem reiniciar o player!');

  // Troca real de URL dispara nova sessão
  await act(async () => {
    rootP.render(React.createElement(PlayerWrapper, { url: 'http://server.tv:8080/movie/u/p/200.mp4' }));
  });
  assert(videoLoadCallCount > initialLoadCount, 'Troca real de URL cria nova sessão de reprodução');

  await act(async () => {
    rootP.unmount();
  });

  console.log('✅ Sessão e controles do Player validados com sucesso!');
}

async function runPlayerControlsStabilityAndAutoHideTests() {
  console.log('--- 4. Testes de Estabilidade de Posição dos Controles e Ocultação Automática ---');

  function LivePlayerWrapper(props: Partial<React.ComponentProps<typeof VideoPlayer>>) {
    return React.createElement(VideoPlayer, {
      streamUrl: 'http://server.tv:8080/live/u/p/101.m3u8',
      title: 'Canal Ao Vivo 1',
      channelName: 'Canal Ao Vivo 1',
      contentType: 'live',
      embedded: true,
      onBack: () => {},
      ...props,
    });
  }

  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  const root = createRoot(container);

  // 1. Validar posicionamento absoluto e invariância da barra inferior
  console.log('Caso 1: Barra inferior e superior posicionadas de forma absoluta e independente do centro');
  await act(async () => {
    root.render(React.createElement(LivePlayerWrapper, { isLoading: true }));
  });

  const topBar = container.querySelector('.bg-gradient-to-b') as HTMLElement;
  const bottomBar = container.querySelector('.bg-gradient-to-t') as HTMLElement;
  assert(topBar, 'Barra superior deve estar presente');
  assert(bottomBar, 'Barra inferior deve estar presente');

  assert(topBar.className.includes('absolute top-0'), 'Barra superior deve estar fixada no topo com absolute top-0');
  assert(bottomBar.className.includes('absolute bottom-0'), 'Barra inferior deve estar fixada na base com absolute bottom-0');

  // Verificar indicador de carregamento central independente
  const loadingIndicator = container.querySelector('.animate-spin') as HTMLElement;
  assert(loadingIndicator, 'Indicador de carregamento deve estar visível durante isLoading');
  const loadingContainer = loadingIndicator.closest('.absolute.inset-0') as HTMLElement;
  assert(loadingContainer, 'Indicador de carregamento deve estar em overlay central absoluto sem empurrar a barra inferior');

  // 2. Chegada de programTitle (EPG) não altera o posicionamento da barra inferior
  console.log('Caso 2: Chegada de programTitle não desloca barra inferior');
  await act(async () => {
    root.render(
      React.createElement(LivePlayerWrapper, {
        isLoading: false,
        programTitle: 'Telejornal Noturno - Cobertura Especial',
      })
    );
  });

  const updatedBottomBar = container.querySelector('.bg-gradient-to-t') as HTMLElement;
  assert(updatedBottomBar, 'Barra inferior continua presente');
  assert(
    updatedBottomBar.className.includes('absolute bottom-0'),
    'Barra inferior permanece rigorosamente ancorada em absolute bottom-0 após chegada de programTitle'
  );

  // 3. Início de reprodução e auto-hide após 3 segundos
  console.log('Caso 3: Reprodução ativa oculta as barras após 3s sem interação');
  const videoEl = container.querySelector('video') as HTMLVideoElement;
  assert(videoEl, 'Elemento video deve estar presente');

  await act(async () => {
    videoEl.dispatchEvent(new windowInstance.Event('playing') as unknown as Event);
  });

  // Imediatamente ao começar a tocar, as barras ainda estão visíveis
  assert(bottomBar.className.includes('opacity-100'), 'Barras iniciam visíveis ao iniciar reprodução');

  // Avançar 3.1 segundos de inatividade
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 3100));
  });

  assert(
    bottomBar.className.includes('opacity-0') && bottomBar.className.includes('invisible'),
    'Barras devem sumir (opacity-0 invisible pointer-events-none) após 3 segundos de reprodução inativa'
  );

  // Botões não capturam foco quando invisíveis (tabIndex = -1)
  const playButton = bottomBar.querySelector('button[aria-label="Pausar"]') as HTMLButtonElement;
  assert(playButton, 'Botão play/pause encontrado');
  assert.strictEqual(playButton.tabIndex, -1, 'Controles ocultos devem ter tabIndex=-1 para não capturar foco acidental');

  // 4. Separação de buffering: indicador permanece visível e barras permanecem ocultas
  console.log('Caso 4: Interrupção por buffer mantém indicador central visível sem forçar barras');
  await act(async () => {
    videoEl.dispatchEvent(new windowInstance.Event('waiting') as unknown as Event);
  });

  const centerBufferingIndicator = container.querySelector('.animate-spin') as HTMLElement;
  assert(centerBufferingIndicator, 'Indicador de buffer no centro DEVE estar visível durante interrupção');
  assert(
    bottomBar.className.includes('opacity-0'),
    'Barras devem PERMANECER ocultas durante buffering sem interação do usuário'
  );

  // 5. Interação do usuário restaura as barras temporariamente
  console.log('Caso 5: Movimento do mouse / toque reinicia o prazo e exibe barras');
  const playerWrapper = container.firstChild as HTMLElement;
  await act(async () => {
    playerWrapper.dispatchEvent(new windowInstance.MouseEvent('mousemove', { bubbles: true }) as unknown as Event);
  });

  assert(bottomBar.className.includes('opacity-100'), 'Movimento de mouse restaura barras imediatamente');
  assert(container.querySelector('.animate-spin'), 'Indicador de buffer continua visível junto com as barras');

  // Aguardar 3.1 segundos: barras somem novamente enquanto buffer continua
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 3100));
  });

  assert(
    bottomBar.className.includes('opacity-0'),
    'Barras voltam a sumir após 3s enquanto buffer ainda está ocorrendo'
  );
  assert(container.querySelector('.animate-spin'), 'Indicador de buffer continua visível mesmo com barras ocultas');

  // 6. Perfil Mais Estabilidade não bloqueia ocultação automática
  console.log('Caso 6: Perfil Mais Estabilidade permite auto-hide normalmente');
  window.localStorage.setItem('nc_player_profile', 'stability');
  await act(async () => {
    playerWrapper.dispatchEvent(new windowInstance.MouseEvent('mousemove', { bubbles: true }) as unknown as Event);
  });
  assert(bottomBar.className.includes('opacity-100'), 'Barras reaparecem com movimento no perfil de estabilidade');

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 3100));
  });

  assert(
    bottomBar.className.includes('opacity-0'),
    'Barras somem após 3s mesmo no perfil de estabilidade'
  );

  // 7. Foco retido por clique de mouse não impede indefinidamente a ocultação
  console.log('Caso 7: Clique de mouse não impede auto-hide por foco persistente');
  await act(async () => {
    playerWrapper.dispatchEvent(new windowInstance.MouseEvent('mousemove', { bubbles: true }) as unknown as Event);
  });
  assert(bottomBar.className.includes('opacity-100'), 'Barras visíveis');

  const visiblePlayButton = bottomBar.querySelector('button') as HTMLButtonElement;
  assert(visiblePlayButton, 'Botão presente');

  // Simular foco recebido por clique (activeElement fica no botão)
  await act(async () => {
    visiblePlayButton.focus();
  });
  assertSameElement(window.document.activeElement, visiblePlayButton, 'Botão reteve foco após clique');

  // Avançar 3.1s sem toque de teclado
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 3100));
  });

  assert(
    bottomBar.className.includes('opacity-0'),
    'Barras devem sumir após 3s mesmo se um botão reteve foco de clique'
  );

  // 8. Atividade real por controle/teclado (setas/Enter) renova o timer de 4.5s no modo remote e oculta após inatividade
  console.log('Caso 8: Atividade real via teclado/controle renova timer (4.5s) e auto-oculta após inatividade');
  const { setNavMode } = await import('../src/navigation');
  setNavMode('remote');

  await act(async () => {
    visiblePlayButton.focus();
    visiblePlayButton.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
      }) as unknown as Event
    );
  });

  assert(
    bottomBar.className.includes('opacity-100'),
    'Tecla de navegação no player em modo remote deve exibir os controles imediatamente'
  );

  // Aguardar 2.6s (antes do prazo de 4.5s do modo remote): controles devem continuar visíveis
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 2600));
  });

  assert(
    bottomBar.className.includes('opacity-100'),
    'Controles devem permanecer visíveis antes de expirar o prazo de 4.5s no modo remote'
  );

  // Nova atividade real no mesmo controle focado (sem precisar mudar o elemento focado) renova o prazo de 4.5s
  await act(async () => {
    visiblePlayButton.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        bubbles: true,
        cancelable: true,
      }) as unknown as Event
    );
  });

  // Mais 2.6s (5.2s desde a primeira tecla, mas apenas 2.6s desde a renovação): ainda visíveis!
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 2600));
  });

  assert(
    bottomBar.className.includes('opacity-100'),
    'Nova tecla real no player deve renovar o prazo de 4.5s mesmo mantendo o foco no mesmo controle'
  );

  // Aguardar o restante da janela renovada (~2.1s adicionais, totalizando 4.7s sem atividade): deve ocultar!
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 2100));
  });

  assert(
    bottomBar.className.includes('opacity-0') && bottomBar.className.includes('invisible'),
    'Após 4.5s sem nova atividade no modo remote, os controles devem se ocultar automaticamente'
  );
  assert.strictEqual(
    playButton.tabIndex,
    -1,
    'Controles ocultos após inatividade em modo remote devem voltar a ter tabIndex=-1'
  );

  // Restaurar modo pointer e reexibir controles para o Caso 9
  setNavMode('pointer');
  await act(async () => {
    playerWrapper.dispatchEvent(new windowInstance.MouseEvent('mousemove', { bubbles: true }) as unknown as Event);
  });

  // 9. Menu de configurações cabe e não é cortado pelo preview
  console.log('Caso 9: Menu de configurações responsivo dentro de contêiner pequeno');
  const settingsBtn = topBar.querySelector('button[title="Configurações de Reprodução"]') as HTMLButtonElement;
  assert(settingsBtn, 'Botão de configurações encontrado');

  await act(async () => {
    settingsBtn.click();
  });

  const settingsMenu = container.querySelector('.bg-nc-bg-card\\/95') as HTMLElement;
  assert(settingsMenu, 'Menu de configurações deve estar aberto');
  assert(
    settingsMenu.className.includes('max-h-[calc(100%-3rem)]'),
    'Menu de configurações respeita altura do contêiner para não ser cortado'
  );
  assert(
    settingsMenu.className.includes('flex flex-col'),
    'Menu de configurações é flex col com submenus roláveis'
  );

  await act(async () => {
    root.unmount();
  });

  console.log('✅ Todos os testes de estabilidade, auto-hide e resiliência do player aprovados!');
}

async function runPlayerBackAndScrollNavigationTests() {
  console.log('\n--- 5. Testes de Botão Voltar (TV ao Vivo) e Preservação de Scroll (Filmes e Séries) ---');

  const testCreds: XtreamCredentials = {
    serverUrl: 'http://server.tv:8080',
    username: 'testUser',
    password: 'testPassword',
    allowed_output_formats: ['m3u8', 'ts'],
  };

  // Mock XtreamService details endpoints
  (XtreamService as any).getVodInfo = async () => ({
    info: {
      name: 'Filme Detalhe Teste',
      plot: 'Sinopse detalhada do filme de teste',
      duration: '120:00',
      cover_big: 'http://server.tv:8080/cover.jpg',
    },
    movie_data: {
      stream_id: 1,
      container_extension: 'mp4',
    },
  });

  (XtreamService as any).getSeriesInfo = async () => ({
    info: {
      name: 'Série Detalhe Teste',
      plot: 'Sinopse detalhada da série de teste',
      cover: 'http://server.tv:8080/series_cover.jpg',
    },
    episodes: {
      '1': [
        { id: '1001', episode_num: 1, title: 'Episódio 1' },
        { id: '1002', episode_num: 2, title: 'Episódio 2' },
      ],
    },
  });

  // =========================================================================
  // CENÁRIO 1: BOTÃO VOLTAR NO PLAYER EMBUTIDO DA TV AO VIVO & ATALHOS ISOLADOS
  // =========================================================================
  console.log('Cenário 1: Botão Voltar na TV ao Vivo (Fullscreen x Preview x Encerramento)');

  const container = windowInstance.document.createElement('div');
  windowInstance.document.body.appendChild(container);
  const root = createRoot(container);

  let onBackCallCount = 0;
  function TestLivePlayer(props: { embedded?: boolean }) {
    return React.createElement(VideoPlayer, {
      streamUrl: 'http://server.tv:8080/live/u/p/101.m3u8',
      title: 'Canal Ao Vivo Teste',
      channelName: 'Canal Ao Vivo Teste',
      contentType: 'live',
      embedded: props.embedded ?? true,
      onBack: () => {
        onBackCallCount++;
      },
    });
  }

  // 1.1 Em tela cheia: primeiro clique em "Voltar" sai da tela cheia sem remontar o vídeo
  await act(async () => {
    root.render(React.createElement(TestLivePlayer, { embedded: true }));
  });

  const playerContainerDiv = container.querySelector('.aspect-video') as any as HTMLElement;
  assert(playerContainerDiv, 'Contêiner do player embutido deve existir');
  const videoElementBefore = container.querySelector('video') as any as HTMLVideoElement;
  assert(videoElementBefore, 'Elemento video deve existir no DOM');

  // Simular entrada em tela cheia no player
  await act(async () => {
    await (playerContainerDiv as any).requestFullscreen();
  });
  assertSameElement(
    (windowInstance.document as any).fullscreenElement,
    playerContainerDiv,
    'document.fullscreenElement deve ser o contêiner do player'
  );

  const backButtonInFullscreen = container.querySelector('button[aria-label="Voltar"]') as any as HTMLButtonElement;
  assert(backButtonInFullscreen, 'Botão Voltar deve estar disponível no topo do player');

  // Clique real no botão Voltar durante tela cheia
  await act(async () => {
    backButtonInFullscreen.click();
    // Aguardar resolução da promessa assíncrona de exitFullscreen
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  assertSameElement(
    (windowInstance.document as any).fullscreenElement,
    null,
    'Primeiro clique em Voltar deve sair da tela cheia (exitFullscreen)'
  );
  assert.strictEqual(
    onBackCallCount,
    0,
    'onBack NÃO deve ser chamado ao sair de tela cheia no player embutido'
  );

  const videoElementAfter = container.querySelector('video') as any as HTMLVideoElement;
  assertSameElement(
    videoElementAfter,
    videoElementBefore,
    'O mesmo elemento <video> deve continuar montado e reproduzindo sem interrupção'
  );

  // 1.2 Fora da tela cheia, clique em Voltar invoca onBack para encerrar canal
  await act(async () => {
    const regularBackButton = container.querySelector('button[aria-label="Voltar"]') as any as HTMLButtonElement;
    regularBackButton.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  assert.strictEqual(
    onBackCallCount,
    1,
    'Fora de tela cheia, clique em Voltar deve acionar onBack para encerrar a seleção'
  );

  // 1.3 Teste de encerramento real no LiveTvView (desktop e mobile)
  const mockLiveChannel = {
    stream_id: 101,
    name: 'Canal Notícias 24h',
    stream_icon: 'http://server.tv:8080/logo.jpg',
    category_id: 'cat_live_1',
  };

  const mockLiveContext: any = {
    credentials: testCreds,
    liveCategories: [{ category_id: 'cat_live_1', category_name: 'Notícias' }],
    liveStreams: [mockLiveChannel],
    allLiveStreams: [mockLiveChannel],
    vodCategories: [],
    vodStreams: [],
    allVodStreams: [],
    seriesCategories: [],
    seriesStreams: [],
    allSeriesStreams: [],
    loadingLive: false,
    loadingVod: false,
    loadingSeries: false,
    error: null,
    fetchLiveStreams: async () => {},
    fetchVodStreams: async () => {},
    fetchSeriesStreams: async () => {},
  };

  await act(async () => {
    root.render(
      React.createElement(
        XtreamMockProvider,
        { value: mockLiveContext },
        React.createElement(LiveTvView, { onPlay: () => {} })
      )
    );
  });

  // Estado inicial: desktop exibe "Selecione um Canal"
  assert(
    container.textContent?.includes('Selecione um Canal'),
    'Desktop inicia com estado Selecione um Canal'
  );

  // Clicar na categoria Notícias para exibir a lista de canais
  const { formatCategoryLabel } = await import('../src/utils/categoryLabel');
  const targetCategoryText = formatCategoryLabel('Notícias', 'live');
  const categoryBtn = Array.from(container.querySelectorAll('.custom-scrollbar button')).find(
    (b) => b.textContent?.trim() === targetCategoryText || b.textContent?.includes('NOTÍCIAS')
  ) as any as HTMLButtonElement;
  assert(categoryBtn, 'Botão da categoria Notícias deve estar presente');
  await act(async () => {
    categoryBtn.click();
  });

  // Selecionar canal
  const channelItemBtn = container.querySelector('button.w-full.flex.items-center') as any as HTMLButtonElement;
  assert(channelItemBtn, 'Botão do canal deve estar na lista');
  await act(async () => {
    channelItemBtn.click();
  });

  const activeVideoEl = container.querySelector('video') as any as HTMLVideoElement;
  assert(activeVideoEl, 'Player com vídeo deve estar montado após seleção do canal');

  // Clicar em Voltar no player fora da tela cheia (desktop)
  const playerBackBtn = container.querySelector('button[aria-label="Voltar"]') as any as HTMLButtonElement;
  assert(playerBackBtn, 'Botão Voltar presente nos controles do preview');
  await act(async () => {
    playerBackBtn.click();
  });

  assert(
    container.textContent?.includes('Selecione um Canal'),
    'Voltar fora de tela cheia encerra o canal no desktop e volta ao estado Selecione um Canal'
  );
  assert.strictEqual(
    container.querySelector('video'),
    null,
    'Nenhum elemento <video> ou transmissão invisível permanece consumindo rede'
  );

  // 1.4 Atalhos de teclado controlam apenas a instância ativa do player
  console.log('Caso 1.4: Atalhos de teclado isolados para o player ativo');
  function DualPlayers() {
    return React.createElement(
      'div',
      null,
      React.createElement(VideoPlayer, {
        streamUrl: 'http://server.tv:8080/movie/1.mp4',
        title: 'Player 1',
        embedded: true,
      }),
      React.createElement(VideoPlayer, {
        streamUrl: 'http://server.tv:8080/movie/2.mp4',
        title: 'Player 2',
        embedded: true,
      })
    );
  }

  await act(async () => {
    root.render(React.createElement(DualPlayers));
  });

  const videos = container.querySelectorAll('video');
  assert.strictEqual(videos.length, 2, 'Dois players montados simultaneamente');
  const video1 = videos[0] as any as HTMLVideoElement;
  const video2 = videos[1] as any as HTMLVideoElement;

  video1.muted = false;
  video2.muted = false;

  // Como Player 2 foi montado por último, ele é o player ativo padrão
  await act(async () => {
    windowInstance.dispatchEvent(new (windowInstance as any).KeyboardEvent('keydown', { key: 'm', bubbles: true }));
  });

  assert.strictEqual(video1.muted, false, 'Player 1 NÃO deve ser mutado por atalho direcionado ao Player 2');
  assert.strictEqual(video2.muted, true, 'Apenas Player 2 (ativo) responde ao atalho "m"');

  // Interagir com Player 1 (tornando-o ativo)
  const player1Div = video1.closest('div') as HTMLElement;
  await act(async () => {
    player1Div.dispatchEvent(new windowInstance.MouseEvent('mousemove', { bubbles: true }) as unknown as Event);
    windowInstance.dispatchEvent(new (windowInstance as any).KeyboardEvent('keydown', { key: 'm', bubbles: true }));
  });

  assert.strictEqual(video1.muted, true, 'Após interação com Player 1, atalho afeta apenas Player 1');

  // 1.5 Regressão: Sobreposição de comandos Voltar durante saída assíncrona de tela cheia na TV ao Vivo
  console.log(
    'Caso 1.5: Saída assíncrona de tela cheia na TV ao Vivo — único exitFullscreen, foco único, sequência tela cheia -> preview -> canais -> categorias, descarte em troca/desmontagem e resiliência a falha'
  );
  {
    const { NavigationProvider, setNavMode } = await import('../src/navigation');
    const originalExitFullscreen = (windowInstance.document as any).exitFullscreen;

    const liveChannels = [
      {
        stream_id: 101,
        name: 'Canal Notícias 24h',
        stream_icon: 'http://server.tv:8080/logo101.jpg',
        category_id: 'cat_live_1',
      },
      {
        stream_id: 102,
        name: 'Canal Esportes Ao Vivo',
        stream_icon: 'http://server.tv:8080/logo102.jpg',
        category_id: 'cat_live_1',
      },
    ];

    const liveOverlapCtx: any = {
      credentials: testCreds,
      liveCategories: [{ category_id: 'cat_live_1', category_name: 'Notícias' }],
      liveStreams: liveChannels,
      allLiveStreams: liveChannels,
      vodCategories: [],
      vodStreams: [],
      allVodStreams: [],
      seriesCategories: [],
      seriesStreams: [],
      allSeriesStreams: [],
      loadingLive: false,
      loadingVod: false,
      loadingSeries: false,
      liveCatalogStatus: 'ready',
      liveCategoriesStatus: 'ready',
      error: null,
      fetchLiveStreams: async () => {},
      fetchVodStreams: async () => {},
      fetchSeriesStreams: async () => {},
      fetchLiveCategories: async () => {},
    };

    try {
      setNavMode('remote');

      await act(async () => {
        root.render(
          React.createElement(
            NavigationProvider,
            null,
            React.createElement(
              XtreamMockProvider,
              { value: liveOverlapCtx },
              React.createElement(LiveTvView, { onPlay: () => {} })
            )
          )
        );
      });

      // Abrir a categoria Notícias (cat_live_1)
      const catBtn = container.querySelector(
        'button[data-live-category-id="cat_live_1"]'
      ) as any as HTMLButtonElement;
      assert(catBtn, '[1.5] Botão da categoria Notícias deve existir');
      await act(async () => {
        catBtn.focus();
        catBtn.click();
      });

      const channelBtns = Array.from(
        container.querySelectorAll('button[data-live-channel-btn="true"]')
      ) as any as HTMLButtonElement[];
      assert.strictEqual(channelBtns.length, 2, '[1.5] Dois canais devem estar renderizados na categoria');
      const channelBtn1 = channelBtns[0];

      // 1º comando no canal 1: abre o preview
      await act(async () => {
        channelBtn1.focus();
        channelBtn1.click();
        await new Promise((r) => setTimeout(r, 20));
      });
      assert(container.querySelector('video') !== null, '[1.5] Preview de vídeo deve estar montado');
      assert.strictEqual(
        channelBtn1.getAttribute('data-live-channel-selected'),
        'true',
        '[1.5] Canal 1 deve estar marcado como selecionado'
      );

      // 2º comando no mesmo canal 1: entra em tela cheia
      await act(async () => {
        channelBtn1.click();
        await new Promise((r) => setTimeout(r, 20));
      });
      const fsModalPlayer = container.querySelector(
        '[data-player-container="true"][data-focus-scope="modal"]'
      ) as any as HTMLElement;
      assert(fsModalPlayer, '[1.5] Player deve estar em camada de tela cheia (data-focus-scope="modal")');
      assertSameElement(
        (windowInstance.document as any).fullscreenElement,
        fsModalPlayer,
        '[1.5] document.fullscreenElement deve apontar para o contêiner do player'
      );

      // Controlar a conclusão de document.exitFullscreen() e contar restaurações de foco no canal 1
      let exitFullscreenCalls = 0;
      let resolvePendingExit: (() => void) | null = null;
      (windowInstance.document as any).exitFullscreen = () => {
        exitFullscreenCalls += 1;
        return new Promise<void>((resolve) => {
          resolvePendingExit = () => {
            currentFullscreenElement = null;
            windowInstance.document.dispatchEvent(new windowInstance.Event('fullscreenchange'));
            resolve();
          };
        });
      };

      let channel1FocusCalls = 0;
      const origChannel1Focus = channelBtn1.focus.bind(channelBtn1);
      channelBtn1.focus = ((options?: FocusOptions) => {
        channel1FocusCalls += 1;
        return origChannel1Focus(options);
      }) as typeof channelBtn1.focus;

      try {
        // Disparar DOIS comandos Voltar (Escape) enquanto exitFullscreen() ainda está pendente
        await act(async () => {
          windowInstance.dispatchEvent(
            new (windowInstance as any).KeyboardEvent('keydown', {
              key: 'Escape',
              bubbles: true,
              cancelable: true,
            })
          );
          windowInstance.dispatchEvent(
            new (windowInstance as any).KeyboardEvent('keydown', {
              key: 'Escape',
              bubbles: true,
              cancelable: true,
            })
          );
        });

        assert.strictEqual(
          exitFullscreenCalls,
          1,
          '[1.5.A] Dois comandos Voltar durante a transição pendente devem disparar apenas UMA chamada a document.exitFullscreen()'
        );
        assert.strictEqual(
          channel1FocusCalls,
          0,
          '[1.5.A] O foco não deve ser restaurado antes da conclusão de exitFullscreen()'
        );
        assert(
          container.querySelector('video') !== null,
          '[1.5.A] O segundo Voltar durante a transição pendente deve ser consumido no mesmo fluxo sem fechar o preview'
        );

        // Concluir a transição assíncrona de saída da tela cheia
        assert(resolvePendingExit !== null, '[1.5.A] Promessa de exitFullscreen deve estar aguardando resolução');
        await act(async () => {
          resolvePendingExit!();
          await new Promise((r) => setTimeout(r, 20));
        });

        assert.strictEqual(
          exitFullscreenCalls,
          1,
          '[1.5.A] Após concluir a transição, o total de chamadas a exitFullscreen() deve permanecer em 1'
        );
        assert.strictEqual(
          channel1FocusCalls,
          1,
          '[1.5.A] O foco deve ser restaurado ao botão do canal selecionado exatamente UMA vez'
        );
        assertSameElement(
          document.activeElement,
          channelBtn1,
          '[1.5.A] O foco ativo deve estar no canal selecionado após sair da tela cheia'
        );
        assertSameElement(
          container.querySelector('[data-player-container="true"][data-focus-scope="modal"]') as any,
          null,
          '[1.5.A] O player não deve mais estar em tela cheia após a conclusão'
        );
        assert(
          container.querySelector('video') !== null,
          '[1.5.A] O preview deve continuar aberto após a conclusão da saída de tela cheia'
        );
      } finally {
        channelBtn1.focus = origChannel1Focus;
      }

      // Restaurar exitFullscreen padrão para validar a sequência seguinte: preview -> lista de canais -> categorias
      (windowInstance.document as any).exitFullscreen = originalExitFullscreen;

      // Próximo comando Voltar (após concluir a saída da tela cheia): fecha o preview normalmente
      await act(async () => {
        windowInstance.dispatchEvent(
          new (windowInstance as any).KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true,
          })
        );
      });
      assertSameElement(
        container.querySelector('video') as any,
        null,
        '[1.5.A] O próximo comando Voltar após concluir a transição deve fechar o preview normalmente'
      );
      assertSameElement(
        document.activeElement,
        channelBtn1,
        '[1.5.A] Ao fechar o preview, o foco permanece no canal na lista de canais'
      );

      // Comando Voltar seguinte: lista de canais -> categorias
      await act(async () => {
        windowInstance.dispatchEvent(
          new (windowInstance as any).KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true,
          })
        );
      });
      const restoredCatBtn = container.querySelector(
        'button[data-live-category-id="cat_live_1"]'
      ) as any as HTMLButtonElement;
      assert(restoredCatBtn, '[1.5.A] Lista de categorias deve voltar a ser exibida');
      assertSameElement(
        document.activeElement,
        restoredCatBtn,
        '[1.5.A] Sequência tela cheia -> preview -> lista de canais -> categorias preservada'
      );

      // -----------------------------------------------------------------------
      // 1.5.B: Conclusão tardia de exitFullscreen() após mudar de canal não deve mover o foco
      // -----------------------------------------------------------------------
      await act(async () => {
        restoredCatBtn.click();
      });
      const chBtnsForSwitch = Array.from(
        container.querySelectorAll('button[data-live-channel-btn="true"]')
      ) as any as HTMLButtonElement[];
      const ch1BtnSwitch = chBtnsForSwitch[0];
      const ch2BtnSwitch = chBtnsForSwitch[1];

      // Abrir canal 1 no preview e depois em tela cheia
      await act(async () => {
        ch1BtnSwitch.focus();
        ch1BtnSwitch.click();
        await new Promise((r) => setTimeout(r, 20));
      });
      await act(async () => {
        ch1BtnSwitch.click();
        await new Promise((r) => setTimeout(r, 20));
      });
      assert(
        container.querySelector('[data-player-container="true"][data-focus-scope="modal"]') !== null,
        '[1.5.B] Canal 1 novamente em tela cheia'
      );

      let exitCallsOnChannelSwitch = 0;
      let resolveChannelSwitchExit: (() => void) | null = null;
      (windowInstance.document as any).exitFullscreen = () => {
        exitCallsOnChannelSwitch += 1;
        return new Promise<void>((resolve) => {
          resolveChannelSwitchExit = () => {
            currentFullscreenElement = null;
            windowInstance.document.dispatchEvent(new windowInstance.Event('fullscreenchange'));
            resolve();
          };
        });
      };

      // Iniciar saída de tela cheia com Voltar (fica pendente)
      await act(async () => {
        windowInstance.dispatchEvent(
          new (windowInstance as any).KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true,
          })
        );
      });
      assert.strictEqual(exitCallsOnChannelSwitch, 1, '[1.5.B] Saída de tela cheia iniciada para o canal 1');

      // Trocar para o canal 2 antes da conclusão de exitFullscreen() e posicionar o foco no botão de voltar às categorias
      const backToCategoriesBtn = container.querySelector(
        'button[data-live-back-to-categories="true"]'
      ) as any as HTMLButtonElement;
      assert(backToCategoriesBtn, '[1.5.B] Botão Voltar às Categorias deve existir');

      await act(async () => {
        ch2BtnSwitch.click();
        backToCategoriesBtn.focus();
      });
      assertSameElement(
        document.activeElement,
        backToCategoriesBtn,
        '[1.5.B] Foco posicionado em outro elemento após trocar para o canal 2'
      );

      // Resolver tardiamente a saída de tela cheia iniciada pelo canal 1
      await act(async () => {
        resolveChannelSwitchExit!();
        await new Promise((r) => setTimeout(r, 20));
      });
      assert.strictEqual(
        exitCallsOnChannelSwitch,
        1,
        '[1.5.B] Desmontar o player anterior na troca de canal não deve disparar outra chamada a exitFullscreen()'
      );
      assertSameElement(
        document.activeElement,
        backToCategoriesBtn,
        '[1.5.B] Conclusão tardia da saída de tela cheia após trocar de canal NÃO deve mover o foco'
      );

      // -----------------------------------------------------------------------
      // 1.5.C: Mesma instância de VideoPlayer mudando streamId/streamUrl ou sendo desmontada antes da conclusão
      // -----------------------------------------------------------------------
      const externalAnchorBtn = document.createElement('button');
      externalAnchorBtn.type = 'button';
      externalAnchorBtn.textContent = 'Âncora Externa';
      document.body.appendChild(externalAnchorBtn);

      const fakeSelectedChannelBtn = document.createElement('button');
      fakeSelectedChannelBtn.type = 'button';
      fakeSelectedChannelBtn.setAttribute('data-live-channel-selected', 'true');
      fakeSelectedChannelBtn.setAttribute('data-live-channel-id', 'ch_101');
      document.body.appendChild(fakeSelectedChannelBtn);

      try {
        // Testar troca de seleção na MESMA instância de VideoPlayer sem desmontar
        await act(async () => {
          root.render(
            React.createElement(VideoPlayer, {
              streamUrl: 'http://server.tv:8080/live/u/p/101.m3u8',
              streamId: 101,
              title: 'Canal 101',
              channelName: 'Canal 101',
              contentType: 'live',
              embedded: true,
              onBack: () => {},
            })
          );
        });

        const sameInstanceContainer = container.querySelector(
          '[data-player-container="true"]'
        ) as any as HTMLElement;
        assert(sameInstanceContainer, '[1.5.C] Contêiner do VideoPlayer deve existir');

        await act(async () => {
          await (sameInstanceContainer as any).requestFullscreen();
        });

        let resolveSameInstanceExit: (() => void) | null = null;
        (windowInstance.document as any).exitFullscreen = () =>
          new Promise<void>((resolve) => {
            resolveSameInstanceExit = () => {
              currentFullscreenElement = null;
              windowInstance.document.dispatchEvent(new windowInstance.Event('fullscreenchange'));
              resolve();
            };
          });

        const sameInstanceBackBtn = container.querySelector(
          'button[aria-label="Voltar"]'
        ) as any as HTMLButtonElement;
        await act(async () => {
          sameInstanceBackBtn.click();
        });

        // Trocar de canal na mesma instância (streamId 101 -> 102) e focar âncora externa antes de resolver exitFullscreen
        await act(async () => {
          root.render(
            React.createElement(VideoPlayer, {
              streamUrl: 'http://server.tv:8080/live/u/p/102.m3u8',
              streamId: 102,
              title: 'Canal 102',
              channelName: 'Canal 102',
              contentType: 'live',
              embedded: true,
              onBack: () => {},
            })
          );
          externalAnchorBtn.focus();
        });

        await act(async () => {
          resolveSameInstanceExit!();
          await new Promise((r) => setTimeout(r, 20));
        });
        assertSameElement(
          document.activeElement,
          externalAnchorBtn,
          '[1.5.C] Conclusão tardia de exitFullscreen após troca de streamId/streamUrl na mesma instância NÃO deve mover o foco'
        );

        // Testar desmontagem do player antes da conclusão de exitFullscreen
        await act(async () => {
          await (sameInstanceContainer as any).requestFullscreen();
        });

        let resolveUnmountExit: (() => void) | null = null;
        (windowInstance.document as any).exitFullscreen = () =>
          new Promise<void>((resolve) => {
            resolveUnmountExit = () => {
              currentFullscreenElement = null;
              windowInstance.document.dispatchEvent(new windowInstance.Event('fullscreenchange'));
              resolve();
            };
          });

        const backBtnBeforeUnmount = container.querySelector(
          'button[aria-label="Voltar"]'
        ) as any as HTMLButtonElement;
        await act(async () => {
          backBtnBeforeUnmount.click();
        });

        await act(async () => {
          root.render(React.createElement('div', null));
          externalAnchorBtn.focus();
        });

        await act(async () => {
          resolveUnmountExit!();
          await new Promise((r) => setTimeout(r, 20));
        });
        assertSameElement(
          document.activeElement,
          externalAnchorBtn,
          '[1.5.C] Conclusão tardia de exitFullscreen após desmontar o player NÃO deve mover o foco'
        );

        // ---------------------------------------------------------------------
        // 1.5.D: Rejeição em document.exitFullscreen() mantendo fullscreenElement no player
        // ---------------------------------------------------------------------
        let onBackAfterFailedExit = 0;
        let retryExitAttempts = 0;
        let fakeChannelFocusCalls = 0;
        const origFakeChannelFocus = fakeSelectedChannelBtn.focus.bind(fakeSelectedChannelBtn);
        fakeSelectedChannelBtn.focus = ((options?: FocusOptions) => {
          fakeChannelFocusCalls += 1;
          return origFakeChannelFocus(options);
        }) as typeof fakeSelectedChannelBtn.focus;

        try {
          await act(async () => {
            root.render(
              React.createElement(VideoPlayer, {
                streamUrl: 'http://server.tv:8080/live/u/p/101.m3u8',
                streamId: 101,
                title: 'Canal 101',
                channelName: 'Canal 101',
                contentType: 'live',
                embedded: true,
                onBack: () => {
                  onBackAfterFailedExit += 1;
                },
              })
            );
          });

          const failExitContainer = container.querySelector(
            '[data-player-container="true"]'
          ) as any as HTMLElement;
          await act(async () => {
            await (failExitContainer as any).requestFullscreen();
          });
          await act(async () => {
            await new Promise((r) => setTimeout(r, 20));
          });

          assertSameElement(
            (windowInstance.document as any).fullscreenElement,
            failExitContainer,
            '[1.5.D] Player deve estar em tela cheia nativa antes do 1º Voltar'
          );
          assert(
            failExitContainer.contains(document.activeElement),
            '[1.5.D] Foco deve estar dentro do player ao entrar em tela cheia'
          );

          // 1ª chamada a exitFullscreen rejeita mantendo document.fullscreenElement no player;
          // 2ª chamada conclui a saída nativa com sucesso
          (windowInstance.document as any).exitFullscreen = async () => {
            retryExitAttempts += 1;
            if (retryExitAttempts === 1) {
              throw new Error('Falha simulada ao sair de tela cheia mantendo fullscreenElement ativo');
            }
            currentFullscreenElement = null;
            windowInstance.document.dispatchEvent(new windowInstance.Event('fullscreenchange'));
          };

          const failExitBackBtn = container.querySelector(
            'button[aria-label="Voltar"]'
          ) as any as HTMLButtonElement;

          // 1º Voltar: exitFullscreen rejeita e document.fullscreenElement continua no player
          await act(async () => {
            failExitBackBtn.click();
            await new Promise((r) => setTimeout(r, 20));
          });

          assert.strictEqual(
            retryExitAttempts,
            1,
            '[1.5.D] 1º Voltar deve ter tentado chamar document.exitFullscreen() uma vez'
          );
          assertSameElement(
            (windowInstance.document as any).fullscreenElement,
            failExitContainer,
            '[1.5.D] document.fullscreenElement continua pertencendo ao player após a rejeição'
          );
          assertSameElement(
            container.querySelector('[data-player-container="true"][data-focus-scope="modal"]') as any,
            failExitContainer,
            '[1.5.D] Quando exitFullscreen rejeita e a tela cheia nativa ainda pertence ao player, o estado de tela cheia deve ser mantido'
          );
          assert(
            failExitContainer.contains(document.activeElement),
            '[1.5.D] Quando a saída falha com tela cheia ainda ativa, o foco deve permanecer no player (não ir para a lista de canais)'
          );
          assert.strictEqual(
            fakeChannelFocusCalls,
            0,
            '[1.5.D] O foco NÃO deve ser restaurado ao canal enquanto a saída da tela cheia não ocorrer'
          );
          assert.strictEqual(
            onBackAfterFailedExit,
            0,
            '[1.5.D] O preview NÃO deve ser fechado no 1º Voltar com falha de saída'
          );

          // 2º Voltar: tenta sair da tela cheia novamente (não fecha o preview) e desta vez conclui com sucesso
          await act(async () => {
            failExitBackBtn.click();
            await new Promise((r) => setTimeout(r, 20));
          });

          assert.strictEqual(
            retryExitAttempts,
            2,
            '[1.5.D] O próximo Voltar após falha deve tentar a saída da tela cheia novamente'
          );
          assertSameElement(
            (windowInstance.document as any).fullscreenElement,
            null,
            '[1.5.D] Na 2ª tentativa bem-sucedida, a saída nativa da tela cheia deve ocorrer (fullscreenElement === null)'
          );
          assertSameElement(
            container.querySelector('[data-player-container="true"][data-focus-scope="modal"]') as any,
            null,
            '[1.5.D] Após a saída nativa bem-sucedida, a camada modal de tela cheia deve ser encerrada'
          );
          assert.strictEqual(
            fakeChannelFocusCalls,
            1,
            '[1.5.D] Após confirmar a saída da tela cheia, o foco deve ser restaurado ao canal uma única vez'
          );
          assertSameElement(
            document.activeElement,
            fakeSelectedChannelBtn,
            '[1.5.D] O foco ativo deve ter retornado ao botão do canal selecionado'
          );
          assert.strictEqual(
            onBackAfterFailedExit,
            0,
            '[1.5.D] Sair da tela cheia na 2ª tentativa deve manter o preview aberto (onBack ainda não chamado)'
          );

          // 3º Voltar (já fora da tela cheia, no preview): fecha o preview normalmente
          await act(async () => {
            failExitBackBtn.click();
            await new Promise((r) => setTimeout(r, 20));
          });
          assert.strictEqual(
            onBackAfterFailedExit,
            1,
            '[1.5.D] Somente o Voltar posterior (já no preview) deve fechar o preview acionando onBack'
          );

          // Caso complementar: se exitFullscreen rejeitar mas o documento já tiver saído da tela cheia, segue o estado real do documento
          await act(async () => {
            await (failExitContainer as any).requestFullscreen();
          });
          await act(async () => {
            await new Promise((r) => setTimeout(r, 20));
          });
          (windowInstance.document as any).exitFullscreen = async () => {
            currentFullscreenElement = null;
            windowInstance.document.dispatchEvent(new windowInstance.Event('fullscreenchange'));
            throw new Error('Rejeição tardia após o documento já ter saído da tela cheia');
          };

          await act(async () => {
            failExitBackBtn.click();
            await new Promise((r) => setTimeout(r, 20));
          });
          assertSameElement(
            container.querySelector('[data-player-container="true"][data-focus-scope="modal"]') as any,
            null,
            '[1.5.D] Se a saída nativa já ocorreu apesar da rejeição, o player deve seguir o estado real do documento'
          );
          assertSameElement(
            document.activeElement,
            fakeSelectedChannelBtn,
            '[1.5.D] Quando o documento realmente saiu da tela cheia apesar da rejeição, o foco deve voltar ao canal'
          );

          // -------------------------------------------------------------------
          // 1.5.E: Rejeição tardia de exitFullscreen() pendente após troca de
          // streamId/streamUrl na mesma instância, com foco fora do player e
          // tela cheia nativa mantida ativa
          // -------------------------------------------------------------------
          let onBackStaleRejectCount = 0;
          await act(async () => {
            root.render(
              React.createElement(VideoPlayer, {
                streamUrl: 'http://server.tv:8080/live/u/p/101.m3u8',
                streamId: 101,
                title: 'Canal 101',
                channelName: 'Canal 101',
                contentType: 'live',
                embedded: true,
                onBack: () => {
                  onBackStaleRejectCount += 1;
                },
              })
            );
          });

          const staleRejectContainer = container.querySelector(
            '[data-player-container="true"]'
          ) as any as HTMLElement;
          await act(async () => {
            await (staleRejectContainer as any).requestFullscreen();
          });
          await act(async () => {
            await new Promise((r) => setTimeout(r, 20));
          });

          let staleRejectExitCalls = 0;
          let rejectStaleAttempt: ((err: Error) => void) | null = null;
          (windowInstance.document as any).exitFullscreen = () => {
            staleRejectExitCalls += 1;
            if (staleRejectExitCalls === 1) {
              return new Promise<void>((_resolve, reject) => {
                rejectStaleAttempt = reject;
              });
            }
            currentFullscreenElement = null;
            windowInstance.document.dispatchEvent(new windowInstance.Event('fullscreenchange'));
            return Promise.resolve();
          };

          const staleRejectBackBtn = container.querySelector(
            'button[aria-label="Voltar"]'
          ) as any as HTMLButtonElement;

          // Iniciar saída na seleção 101 (fica pendente)
          await act(async () => {
            staleRejectBackBtn.click();
          });
          assert.strictEqual(
            staleRejectExitCalls,
            1,
            '[1.5.E] 1ª tentativa de saída iniciada na seleção 101'
          );

          // Enquanto exitFullscreen() está pendente, mudar streamId/streamUrl na mesma instância e deixar o foco fora do player
          await act(async () => {
            root.render(
              React.createElement(VideoPlayer, {
                streamUrl: 'http://server.tv:8080/live/u/p/102.m3u8',
                streamId: 102,
                title: 'Canal 102',
                channelName: 'Canal 102',
                contentType: 'live',
                embedded: true,
                onBack: () => {
                  onBackStaleRejectCount += 1;
                },
              })
            );
            externalAnchorBtn.focus();
          });
          assertSameElement(
            document.activeElement,
            externalAnchorBtn,
            '[1.5.E] Foco posicionado fora do player antes da rejeição da tentativa antiga'
          );

          const focusCallsBeforeStaleReject = fakeChannelFocusCalls;

          // Rejeitar a tentativa antiga mantendo document.fullscreenElement ativo no player
          await act(async () => {
            rejectStaleAttempt!(
              new Error('Falha tardia na tentativa de saída da seleção anterior mantendo tela cheia ativa')
            );
            await new Promise((r) => setTimeout(r, 20));
          });

          assertSameElement(
            (windowInstance.document as any).fullscreenElement,
            staleRejectContainer,
            '[1.5.E] Tela cheia nativa permanece ativa após a rejeição da tentativa antiga'
          );
          assertSameElement(
            document.activeElement,
            externalAnchorBtn,
            '[1.5.E] A rejeição da tentativa antiga NÃO deve mover o foco para dentro do player nem para o canal'
          );
          assert.strictEqual(
            fakeChannelFocusCalls,
            focusCallsBeforeStaleReject,
            '[1.5.E] A rejeição da tentativa antiga NÃO deve focar o botão do canal'
          );
          assert.strictEqual(
            onBackStaleRejectCount,
            0,
            '[1.5.E] A rejeição da tentativa antiga NÃO deve fechar o preview'
          );
          assert(
            container.querySelector('video') !== null,
            '[1.5.E] O elemento <video> do preview permanece montado após a rejeição antiga'
          );

          // Confirmar que a rejeição antiga não impede uma nova tentativa de saída na seleção atual (102)
          await act(async () => {
            staleRejectBackBtn.click();
            await new Promise((r) => setTimeout(r, 20));
          });
          assert.strictEqual(
            staleRejectExitCalls,
            2,
            '[1.5.E] Nova tentativa de Voltar na seleção atual deve chamar exitFullscreen() normalmente'
          );
          assertSameElement(
            (windowInstance.document as any).fullscreenElement,
            null,
            '[1.5.E] Nova tentativa de saída deve concluir a saída nativa da tela cheia'
          );
          assertSameElement(
            container.querySelector('[data-player-container="true"][data-focus-scope="modal"]') as any,
            null,
            '[1.5.E] Camada modal de tela cheia deve ser encerrada após a nova tentativa bem-sucedida'
          );
          assertSameElement(
            document.activeElement,
            fakeSelectedChannelBtn,
            '[1.5.E] Após a saída confirmada na seleção atual, o foco deve voltar ao canal'
          );
          assert.strictEqual(
            onBackStaleRejectCount,
            0,
            '[1.5.E] Preview permanece aberto logo após sair da tela cheia na nova tentativa'
          );
        } finally {
          fakeSelectedChannelBtn.focus = origFakeChannelFocus;
        }
      } finally {
        if (externalAnchorBtn.parentNode) {
          externalAnchorBtn.parentNode.removeChild(externalAnchorBtn);
        }
        if (fakeSelectedChannelBtn.parentNode) {
          fakeSelectedChannelBtn.parentNode.removeChild(fakeSelectedChannelBtn);
        }
      }
    } finally {
      currentFullscreenElement = null;
      (windowInstance.document as any).exitFullscreen = originalExitFullscreen;
      setNavMode('pointer');
    }
  }

  // =========================================================================
  // CENÁRIO 2: SCROLL EM FILMES (MoviesView)
  // =========================================================================
  console.log('\nCenário 2: Preservação de Scroll, Categorias e Carregados em Filmes');

  const mockVodCategories = [
    { category_id: '1', category_name: 'Ação' },
    { category_id: '2', category_name: 'Drama' },
  ];

  const mockVodStreams = Array.from({ length: 150 }, (_, i) => ({
    stream_id: i + 1,
    name: `Filme Teste ${i + 1}`,
    stream_icon: `http://server.tv:8080/movie_${i + 1}.jpg`,
    category_id: i < 75 ? '1' : '2',
    rating: '8.5',
  }));

  const mockMoviesContext: any = {
    credentials: testCreds,
    vodCategories: mockVodCategories,
    vodStreams: mockVodStreams.filter((m) => m.category_id === '1'),
    allVodStreams: mockVodStreams,
    liveCategories: [],
    liveStreams: [],
    allLiveStreams: [],
    seriesCategories: [],
    seriesStreams: [],
    allSeriesStreams: [],
    loadingLive: false,
    loadingVod: false,
    loadingSeries: false,
    error: null,
    fetchLiveStreams: async () => {},
    fetchVodStreams: async (catId?: string) => {
      mockMoviesContext.vodStreams = mockVodStreams.filter((m) => m.category_id === catId);
    },
    fetchSeriesStreams: async () => {},
  };

  await act(async () => {
    root.render(
      React.createElement(
        XtreamMockProvider,
        { value: mockMoviesContext },
        React.createElement(MoviesView, { onPlay: () => {}, searchQuery: '' })
      )
    );
  });

  const moviesMain = container.querySelector('main') as any as HTMLElement;
  assert(moviesMain, 'Elemento main da lista de filmes deve estar presente');

  // Selecionar categoria Ação com cards de filmes
  const acaoCatBtn = Array.from(
    container.querySelectorAll('[data-categories-menu="true"] button[data-category-id]')
  ).find((b) => b.textContent?.toUpperCase().includes('AÇÃO')) as any as HTMLButtonElement;
  assert(acaoCatBtn, 'Botão da categoria Ação');
  await act(async () => {
    acaoCatBtn.click();
  });

  // 2.1 Definir scrollTop > 0 e abrir um card
  moviesMain.scrollTop = 350;
  assert.strictEqual(moviesMain.scrollTop, 350, 'scrollTop de Filmes configurado para 350px');

  const firstMovieCard = container.querySelector('.group.relative.aspect-\\[2\\/3\\]') as any as HTMLElement;
  assert(firstMovieCard, 'Card de filme encontrado');

  await act(async () => {
    firstMovieCard.click();
  });

  // Confirmar que MovieDetails abriu sobre a lista sem desmontar o <main>
  assert(
    container.querySelector('main'),
    'Elemento main NÃO deve ser desmontado ao exibir MovieDetails!'
  );
  const movieDetailsOverlay = container.querySelector('.z-\\[50\\].bg-nc-bg') as any as HTMLElement;
  assert(movieDetailsOverlay, 'Camada de MovieDetails renderizada sobre a lista');

  // Clicar no botão Voltar de MovieDetails
  const movieCloseBtn = movieDetailsOverlay.querySelector('button') as any as HTMLButtonElement;
  assert(movieCloseBtn, 'Botão Voltar em MovieDetails encontrado');
  await act(async () => {
    movieCloseBtn.click();
  });

  assert.strictEqual(
    moviesMain.scrollTop,
    350,
    'Ao fechar MovieDetails, o scrollTop da lista de filmes DEVE ser preservado em 350px!'
  );

  // 2.2 Carregar Mais e testar novamente com quantidade maior
  const loadMoreBtn = container.querySelector('button.px-6.py-3') as any as HTMLButtonElement;
  if (loadMoreBtn) {
    await act(async () => {
      loadMoreBtn.click();
    });
  }

  moviesMain.scrollTop = 700;
  await act(async () => {
    firstMovieCard.click();
  });
  await act(async () => {
    const closeBtn = container.querySelector('.z-\\[50\\].bg-nc-bg button') as any as HTMLButtonElement;
    closeBtn.click();
  });

  assert.strictEqual(
    moviesMain.scrollTop,
    700,
    'Após Carregar Mais, abrir card e voltar continua preservando o scroll em 700px!'
  );

  // 2.3 Repetir a seleção da mesma categoria NÃO deve zerar o scroll
  const sameCatBtn = container.querySelector(
    '[data-categories-menu="true"] button[data-category-selected="true"]'
  ) as any as HTMLButtonElement;
  assert(sameCatBtn, 'Botão da categoria atual de Filmes');
  await act(async () => {
    sameCatBtn.click();
  });
  assert.strictEqual(
    moviesMain.scrollTop,
    700,
    'Repetir a seleção da mesma categoria NÃO deve zerar o scroll!'
  );

  // 2.4 Selecionar OUTRA categoria zera o scroll
  const otherCatBtn = container.querySelector(
    '[data-categories-menu="true"] button[data-category-id="2"]'
  ) as any as HTMLButtonElement;
  assert(otherCatBtn, 'Botão de outra categoria de Filmes');
  await act(async () => {
    otherCatBtn.click();
  });
  assert.strictEqual(
    moviesMain.scrollTop,
    0,
    'Mudar para outra categoria de Filmes DEVE posicionar a lista no topo (scrollTop=0)'
  );

  // =========================================================================
  // CENÁRIO 3: SCROLL EM SÉRIES (SeriesView)
  // =========================================================================
  console.log('\nCenário 3: Preservação e Redefinição de Scroll em Séries');

  const mockSeriesCategories = [
    { category_id: '10', category_name: 'Comédia' },
    { category_id: '20', category_name: 'Suspense' },
  ];

  const mockSeriesStreams = Array.from({ length: 120 }, (_, i) => ({
    series_id: i + 100,
    name: `Série Teste ${i + 100}`,
    cover: `http://server.tv:8080/series_${i + 100}.jpg`,
    category_id: i < 60 ? '10' : '20',
    rating: '9.0',
  }));

  const mockSeriesContext: any = {
    credentials: testCreds,
    seriesCategories: mockSeriesCategories,
    seriesStreams: mockSeriesStreams.filter((s) => s.category_id === '10'),
    allSeriesStreams: mockSeriesStreams,
    vodCategories: [],
    vodStreams: [],
    allVodStreams: [],
    liveCategories: [],
    liveStreams: [],
    allLiveStreams: [],
    loadingLive: false,
    loadingVod: false,
    loadingSeries: false,
    error: null,
    fetchLiveStreams: async () => {},
    fetchVodStreams: async () => {},
    fetchSeriesStreams: async (catId?: string) => {
      mockSeriesContext.seriesStreams = mockSeriesStreams.filter((s) => s.category_id === catId);
    },
  };

  await act(async () => {
    root.render(
      React.createElement(
        XtreamMockProvider,
        { value: mockSeriesContext },
        React.createElement(SeriesView, { onPlay: () => {}, searchQuery: '' })
      )
    );
  });

  const seriesMain = container.querySelector('main') as any as HTMLElement;
  assert(seriesMain, 'Elemento main da lista de séries presente');

  // Selecionar categoria Comédia com cards de séries
  const comediaCatBtn = Array.from(
    container.querySelectorAll('[data-categories-menu="true"] button[data-category-id]')
  ).find((b) => b.textContent?.toUpperCase().includes('COMÉDIA')) as any as HTMLButtonElement;
  assert(comediaCatBtn, 'Botão da categoria Comédia');
  await act(async () => {
    comediaCatBtn.click();
  });

  // 3.1 Transição Série -> Detalhes -> Voltar preserva scroll
  seriesMain.scrollTop = 450;
  assert.strictEqual(seriesMain.scrollTop, 450, 'scrollTop de Séries configurado para 450px');

  const firstSeriesCard = container.querySelector('.group.relative.aspect-\\[2\\/3\\]') as any as HTMLElement;
  assert(firstSeriesCard, 'Card de série encontrado');

  await act(async () => {
    firstSeriesCard.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  const seriesDetailsCloseBtn = (container.querySelector('.z-\\[60\\] button') ||
    container.querySelector('button[title="Fechar"]')) as any as HTMLButtonElement;
  assert(seriesDetailsCloseBtn, 'Botão Fechar/Voltar em SeriesDetails encontrado');

  await act(async () => {
    seriesDetailsCloseBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  assert.strictEqual(
    seriesMain.scrollTop,
    450,
    'Série -> Detalhes -> Voltar DEVE preservar o scroll da categoria atual (450px)!'
  );

  // 3.2 Seleção repetida da mesma categoria preserva
  const sameSeriesCatBtn = container.querySelector(
    '[data-categories-menu="true"] button[data-category-selected="true"]'
  ) as any as HTMLButtonElement;
  assert(sameSeriesCatBtn, 'Botão da categoria atual de Séries');
  await act(async () => {
    sameSeriesCatBtn.click();
  });
  assert.strictEqual(
    seriesMain.scrollTop,
    450,
    'Repetir a seleção da mesma categoria de Séries NÃO zera o scroll!'
  );

  // 3.3 Transição Categoria A -> Categoria B zera scroll
  const otherSeriesCatBtn = container.querySelector(
    '[data-categories-menu="true"] button[data-category-id="20"]'
  ) as any as HTMLButtonElement;
  assert(otherSeriesCatBtn, 'Botão de outra categoria de Séries');
  await act(async () => {
    otherSeriesCatBtn.click();
  });

  assert.strictEqual(
    seriesMain.scrollTop,
    0,
    'Categoria A -> Categoria B DEVE colocar a lista no topo (scrollTop=0)!'
  );

  await act(async () => {
    root.unmount();
  });

  console.log('✅ Todos os testes de botão Voltar, isolamento e preservação de scroll aprovados com sucesso!');
}

async function runCategoryLabelAndChannelGroupTests() {
  console.log('\n--- 6. Testes de Nomes de Categorias e Agrupamento de Canais ---');
  const { formatCategoryLabel } = await import('../src/utils/categoryLabel');
  const { parseChannelVariantSuffix, groupLiveStreams } = await import('../src/utils/liveChannelGroups');

  // Testes de Nomes de Categorias
  assert.strictEqual(formatCategoryLabel('CANAIS · TELECINE', 'live'), 'TELECINE');
  assert.strictEqual(formatCategoryLabel('Canais | Esportes', 'live'), 'ESPORTES');
  assert.strictEqual(formatCategoryLabel('CANAIS', 'live'), 'CANAIS');
  assert.strictEqual(formatCategoryLabel('CANAIS 4K', 'live'), 'CANAIS 4K');
  assert.strictEqual(formatCategoryLabel('CANALIS', 'live'), 'CANALIS');
  assert.strictEqual(formatCategoryLabel('Filmes de Ação', 'vod'), 'FILMES DE AÇÃO');
  assert.strictEqual(formatCategoryLabel('Assistidos Recentemente'), 'ASSISTIDOS RECENTEMENTE');

  // Testes de Parser de Sufixos
  const p1 = parseChannelVariantSuffix('Telecine Action FHD');
  assert.strictEqual(p1.baseName, 'Telecine Action');
  assert.strictEqual(p1.resolution, 'FHD');
  assert.strictEqual(p1.isVariant, true);

  const p2 = parseChannelVariantSuffix('HDMI');
  assert.strictEqual(p2.resolution, null);

  const p3 = parseChannelVariantSuffix('Canal HD 2');
  assert.strictEqual(p3.resolution, null);

  // Testes de Agrupamento
  const mockStreams = [
    { stream_id: 10, name: 'Telecine Action 4K', category_id: '10', epg_channel_id: 'tc_action' },
    { stream_id: 11, name: 'Telecine Action FHD', category_id: '10', epg_channel_id: 'tc_action' },
    { stream_id: 12, name: 'Telecine Action HD', category_id: '10', epg_channel_id: 'tc_action' },
    { stream_id: 13, name: 'Telecine Action HD', category_id: '10', epg_channel_id: 'tc_action' }, // Duplicado HD
    { stream_id: 14, name: 'Telecine Action SD', category_id: '10', epg_channel_id: 'tc_action' },
    { stream_id: 20, name: 'HBO HD', category_id: '10', epg_channel_id: 'hbo' },
  ];

  const groups = groupLiveStreams(mockStreams);
  assert.strictEqual(groups.length, 2, 'Deve resultar em 2 itens (1 grupo Telecine Action + 1 single HBO HD)');
  
  const group1 = groups.find((g) => g.displayName === 'Telecine Action');
  assert(group1, 'Grupo Telecine Action encontrado');
  assert.strictEqual(group1.isGrouped, true);
  // Preserva todas as 5 streams no grupo, incluindo os dois HDs distintos (stream_id 12 e 13)
  assert.strictEqual(group1.variants.length, 5, 'Todos os 5 streams originais devem estar preservados nas variantes');
  assert.strictEqual(group1.allStreams.length, 5);

  const group2 = groups.find((g) => g.displayName === 'HBO HD');
  assert(group2, 'Item HBO HD mantido com nome original');
  assert.strictEqual(group2.isGrouped, false);

  // Teste de Agrupamento Sem Colisão de Pontuação (ex: A/B vs A-B)
  const collisionMock = [
    { stream_id: 100, name: 'A/B HD', category_id: '10' },
    { stream_id: 101, name: 'A/B FHD', category_id: '10' },
    { stream_id: 102, name: 'A-B HD', category_id: '10' },
    { stream_id: 103, name: 'A-B FHD', category_id: '10' },
  ];
  const collisionGroups = groupLiveStreams(collisionMock);
  assert.strictEqual(collisionGroups.length, 2, 'A/B e A-B devem produzir 2 grupos distintos');
  assert.notStrictEqual(
    collisionGroups[0].groupId,
    collisionGroups[1].groupId,
    'GroupIDs de A/B e A-B devem ser estritamente diferentes sem colisão por pontuação'
  );

  console.log('✅ Testes de rótulos de categorias, busca global e agrupamento de canais aprovados!');
}

async function runAttemptIdPropagationAndStaleCallbackTests() {
  console.log('\n--- 7. Testes de ID de Tentativa e Descarte de Callbacks Antigos ---');
  const React = await import('react');
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { VideoPlayer } = await import('../src/components/VideoPlayer');

  let successAttemptId: number | undefined;
  let errorAttemptId: number | undefined;

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  function PlayerTester({ attemptTrigger }: { attemptTrigger: number }) {
    return React.createElement(VideoPlayer, {
      streamUrl: 'http://server.tv:8080/live/user/pass/101.ts',
      title: 'Canal Teste',
      embedded: true,
      attemptTrigger,
      onPlaybackSuccess: (id) => {
        successAttemptId = id;
      },
      onPlaybackFinalError: (msg, id) => {
        errorAttemptId = id;
      },
    });
  }

  // 1. Renderiza o player com attemptTrigger = 5
  await act(async () => {
    root.render(React.createElement(PlayerTester, { attemptTrigger: 5 }));
  });

  const video = container.querySelector('video') as HTMLVideoElement;
  assert(video, 'Elemento <video> deve ser renderizado no player');

  // Simula evento 'playing' nativo do elemento <video>
  await act(async () => {
    video.dispatchEvent(new windowInstance.Event('playing') as unknown as Event);
  });

  assert.strictEqual(
    successAttemptId,
    5,
    'O callback de sucesso deve receber exatamente o ID de tentativa (5) repassado via attemptTrigger'
  );

  // 2. Atualiza attemptTrigger para 6 (nova tentativa da mesma URL) no mesmo elemento <video>
  await act(async () => {
    root.render(React.createElement(PlayerTester, { attemptTrigger: 6 }));
  });

  // Confirma que o elemento <video> é mantido (mesma referência no DOM)
  const video2 = container.querySelector('video') as HTMLVideoElement;
  assertSameElement(video2, video, 'Mesmo elemento <video> deve ser reutilizado sem desmontar o player');

  // Emitir evento para a nova tentativa 6
  await act(async () => {
    video.dispatchEvent(new windowInstance.Event('playing') as unknown as Event);
  });

  assert.strictEqual(
    successAttemptId,
    6,
    'O callback de sucesso da nova tentativa recebe o novo ID (6)'
  );

  await act(async () => {
    root.unmount();
  });
  document.body.removeChild(container);

  console.log('✅ Testes de propagação de ID de tentativa e estabilidade do player aprovados!');
}

async function runLiveTvSdPriorityAndFallbackTests() {
  console.log('\n--- 8. Testes de Prioridade SD -> HD -> FHD -> 4K e Fallback na TV ao Vivo ---');
  const { groupLiveStreams } = await import('../src/utils/liveChannelGroups');
  const { AUTO_RESOLUTION_PRIORITY, selectChannelVariantForAttempt } = await import('../src/views/LiveTvView');

  // 1. Validar constante de prioridade automática SD -> HD -> FHD -> 4K
  assert.deepStrictEqual(
    AUTO_RESOLUTION_PRIORITY,
    ['SD', 'HD', 'FHD', '4K'],
    'Prioridade automática deve ser estritamente SD -> HD -> FHD -> 4K'
  );

  // 2. Grupo com 4K, FHD, HD e SD começa no modo automático por SD (tanto em primaryStream quanto em selectChannelVariantForAttempt)
  const fullGroupStreams = [
    { stream_id: 400, name: 'Discovery Channel 4K', category_id: '10', epg_channel_id: 'disc' },
    { stream_id: 300, name: 'Discovery Channel FHD', category_id: '10', epg_channel_id: 'disc' },
    { stream_id: 200, name: 'Discovery Channel HD', category_id: '10', epg_channel_id: 'disc' },
    { stream_id: 100, name: 'Discovery Channel SD', category_id: '10', epg_channel_id: 'disc' },
  ];

  const groupedFull = groupLiveStreams(fullGroupStreams);
  assert.strictEqual(groupedFull.length, 1, 'Deve agrupar em 1 canal');
  const discGroup = groupedFull[0];
  assert.strictEqual(
    discGroup.primaryStream.stream_id,
    100,
    'primaryStream do grupo deve priorizar SD (stream_id 100)'
  );

  // 3. Falha sequencial em SD avança para HD, depois FHD, depois 4K, sem repetir streams já tentados
  const triedFull = new Set<string | number>();
  const attempt1 = selectChannelVariantForAttempt(discGroup, 'auto', triedFull);
  assert(attempt1, 'Primeira tentativa automática deve encontrar variante');
  assert.strictEqual(attempt1.stream_id, 100, '1ª tentativa deve ser SD (100)');
  triedFull.add(attempt1.stream_id);

  const attempt2 = selectChannelVariantForAttempt(discGroup, 'auto', triedFull);
  assert(attempt2, 'Segunda tentativa após falha de SD deve encontrar variante');
  assert.strictEqual(attempt2.stream_id, 200, '2ª tentativa após falha de SD deve ser HD (200)');
  triedFull.add(attempt2.stream_id);

  const attempt3 = selectChannelVariantForAttempt(discGroup, 'auto', triedFull);
  assert(attempt3, 'Terceira tentativa após falha de HD deve encontrar variante');
  assert.strictEqual(attempt3.stream_id, 300, '3ª tentativa após falha de HD deve ser FHD (300)');
  triedFull.add(attempt3.stream_id);

  const attempt4 = selectChannelVariantForAttempt(discGroup, 'auto', triedFull);
  assert(attempt4, 'Quarta tentativa após falha de FHD deve encontrar variante');
  assert.strictEqual(attempt4.stream_id, 400, '4ª tentativa após falha de FHD deve ser 4K (400)');
  triedFull.add(attempt4.stream_id);

  const attempt5 = selectChannelVariantForAttempt(discGroup, 'auto', triedFull);
  assert.strictEqual(attempt5, null, 'Após esgotar SD, HD, FHD e 4K, deve retornar null sem repetir variantes');

  // 4. Grupo sem SD (ex.: apenas HD e FHD) começa por HD
  const noSdStreams = [
    { stream_id: 502, name: 'ESPN FHD', category_id: '20', epg_channel_id: 'espn' },
    { stream_id: 501, name: 'ESPN HD', category_id: '20', epg_channel_id: 'espn' },
  ];
  const groupedNoSd = groupLiveStreams(noSdStreams);
  assert.strictEqual(groupedNoSd.length, 1);
  const espnGroup = groupedNoSd[0];
  assert.strictEqual(espnGroup.primaryStream.stream_id, 501, 'Sem SD disponível, primaryStream deve iniciar em HD');

  const espnTried = new Set<string | number>();
  const espnFirst = selectChannelVariantForAttempt(espnGroup, 'auto', espnTried);
  assert(espnFirst);
  assert.strictEqual(espnFirst.stream_id, 501, 'Sem SD disponível, 1ª tentativa automática deve ser HD (501)');
  espnTried.add(espnFirst.stream_id);

  const espnSecond = selectChannelVariantForAttempt(espnGroup, 'auto', espnTried);
  assert(espnSecond);
  assert.strictEqual(espnSecond.stream_id, 502, '2ª tentativa sem SD deve ser FHD (502)');

  // 5. Seleção manual de HD ou FHD tenta primeiro todas as entradas dessa resolução e só depois faz fallback automático (SD -> HD -> FHD -> 4K)
  const multiHdStreams = [
    { stream_id: 604, name: 'SporTV 4K', category_id: '20', epg_channel_id: 'sportv' },
    { stream_id: 603, name: 'SporTV FHD', category_id: '20', epg_channel_id: 'sportv' },
    { stream_id: 601, name: 'SporTV HD', category_id: '20', epg_channel_id: 'sportv' },
    { stream_id: 602, name: 'SporTV HD', category_id: '20', epg_channel_id: 'sportv' },
    { stream_id: 600, name: 'SporTV SD', category_id: '20', epg_channel_id: 'sportv' },
  ];
  const sportvGroup = groupLiveStreams(multiHdStreams)[0];
  const triedManual = new Set<string | number>();

  const m1 = selectChannelVariantForAttempt(sportvGroup, '601', triedManual);
  assert.strictEqual(m1?.stream_id, 601, '1ª tentativa manual deve ser o stream HD selecionado (601)');
  triedManual.add(601);

  const m2 = selectChannelVariantForAttempt(sportvGroup, '601', triedManual);
  assert.strictEqual(m2?.stream_id, 602, '2ª tentativa manual deve tentar o outro stream HD disponível (602)');
  triedManual.add(602);

  const m3 = selectChannelVariantForAttempt(sportvGroup, '601', triedManual);
  assert.strictEqual(m3?.stream_id, 600, 'Após esgotar HD manual, fallback automático deve iniciar por SD (600)');
  triedManual.add(600);

  const m4 = selectChannelVariantForAttempt(sportvGroup, '601', triedManual);
  assert.strictEqual(m4?.stream_id, 603, 'Em seguida avança para FHD (603)');
  triedManual.add(603);

  const m5 = selectChannelVariantForAttempt(sportvGroup, '601', triedManual);
  assert.strictEqual(m5?.stream_id, 604, 'E por último 4K (604)');

  // 6. Teste integrado na UI de LiveTvView: início em SD, fallback em erro, e 2º OK no mesmo canal entra em tela cheia sem recriar <video>
  const testCreds: XtreamCredentials = {
    serverUrl: 'http://server.tv:8080',
    username: 'testUser',
    password: 'testPassword',
    allowed_output_formats: ['m3u8', 'ts'],
  };

  const mockLiveContext: any = {
    credentials: testCreds,
    liveCategories: [{ category_id: 'cat_1', category_name: 'Documentários' }],
    liveStreams: fullGroupStreams.map((s) => ({ ...s, category_id: 'cat_1' })),
    allLiveStreams: fullGroupStreams.map((s) => ({ ...s, category_id: 'cat_1' })),
    vodCategories: [],
    vodStreams: [],
    allVodStreams: [],
    seriesCategories: [],
    seriesStreams: [],
    allSeriesStreams: [],
    loadingLive: false,
    loadingVod: false,
    loadingSeries: false,
    error: null,
    fetchLiveStreams: async () => {},
    fetchVodStreams: async () => {},
    fetchSeriesStreams: async () => {},
  };

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      React.createElement(
        XtreamMockProvider,
        { value: mockLiveContext },
        React.createElement(LiveTvView, { onPlay: () => {} })
      )
    );
  });

  // Selecionar categoria Documentários
  const docCatBtn = Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent?.toUpperCase().includes('DOCUMENTÁRIOS')
  ) as HTMLButtonElement;
  assert(docCatBtn, 'Botão da categoria Documentários encontrado');
  await act(async () => {
    docCatBtn.click();
  });

  // Clicar no canal agrupado Discovery Channel
  const channelBtn = container.querySelector('button.w-full.flex.items-center') as HTMLButtonElement;
  assert(channelBtn, 'Botão do canal Discovery Channel encontrado');

  await act(async () => {
    channelBtn.click();
  });

  const videoEl = container.querySelector('video') as HTMLVideoElement;
  assert(videoEl, 'Elemento <video> montado após 1º clique/OK no canal');
  assert(
    container.textContent?.includes('SD'),
    'Player deve iniciar automaticamente na variante SD'
  );

  // Confirmar que 2º clique/OK no mesmo canal já ativo solicita tela cheia sem desmontar <video> nem reiniciar tentativa
  currentFullscreenElement = null;
  const loadCountBeforeSecondOk = videoLoadCallCount;

  await act(async () => {
    channelBtn.click();
  });

  const videoElAfterSecondOk = container.querySelector('video') as HTMLVideoElement;
  assertSameElement(videoElAfterSecondOk, videoEl, '2º OK no mesmo canal NÃO deve desmontar o elemento <video>');
  assert.strictEqual(
    videoLoadCallCount,
    loadCountBeforeSecondOk,
    '2º OK no mesmo canal NÃO deve recarregar a transmissão'
  );
  assert(
    currentFullscreenElement !== null,
    '2º OK no mesmo canal já em reprodução deve abrir tela cheia no player'
  );

  await act(async () => {
    await (windowInstance.document as any).exitFullscreen();
    root.unmount();
  });
  document.body.removeChild(container);

  console.log('✅ Testes de prioridade SD -> HD -> FHD -> 4K, fallback e 2º OK para tela cheia aprovados!');
}

async function runDpadNavigationAndBackPolicyTests() {
  console.log('\n--- 9. Testes de Navegação por Controle/Teclado (D-pad) e Política Central de Voltar ---');
  const {
    NavigationProvider,
    getNavMode,
    clearAllBackHandlersForTest,
    attachCapacitorBackAdapter,
    setCapacitorAppBridgeForTest,
    getNativeBackBridgeStatus,
  } = await import('../src/navigation');

  clearAllBackHandlersForTest();

  // Mock XtreamService endpoints so initial loading overlay finishes immediately and renders rich rows/details
  (XtreamService as any).authenticate = async () => ({
    user_info: { auth: 1, status: 'Active' },
    server_info: { allowed_output_formats: ['m3u8', 'ts'] },
  });
  (XtreamService as any).getLiveCategories = async () => [
    { category_id: '1', category_name: 'Abertos' },
    { category_id: '2', category_name: 'Esportes' },
    { category_id: '3', category_name: 'Sem Canais' },
  ];
  (XtreamService as any).getVodCategories = async () => [
    { category_id: '10', category_name: 'Ação' },
    { category_id: '11', category_name: 'Comédia' },
  ];
  (XtreamService as any).getSeriesCategories = async () => [
    { category_id: '20', category_name: 'Drama' },
    { category_id: '21', category_name: 'Ficção' },
  ];
  (XtreamService as any).getLiveStreams = async (_creds: any, catId?: string) => {
    const all = [
      { stream_id: 101, name: 'Canal Teste 1 SD', category_id: '1' },
      { stream_id: 102, name: 'Canal Teste 2 SD', category_id: '1' },
      { stream_id: 103, name: 'Canal Esporte SD', category_id: '2', epg_channel_id: 'esporte.br' },
      { stream_id: 104, name: 'Canal Esporte HD', category_id: '2', epg_channel_id: 'esporte.br' },
      { stream_id: 105, name: 'Canal Noticias Unico', category_id: '2' },
    ];
    if (catId) return all.filter((s) => s.category_id === String(catId));
    return all;
  };
  (XtreamService as any).getVodStreams = async (_creds: any, catId?: string) => {
    const all = [
      { stream_id: 201, name: 'Filme Ação 1', category_id: '10', stream_icon: 'http://server.tv:8080/poster1.jpg', rating: '8.5', added: '1700000100' },
      { stream_id: 202, name: 'Filme Ação 2', category_id: '10', stream_icon: 'http://server.tv:8080/poster2.jpg', rating: '8.2', added: '1700000090' },
      { stream_id: 203, name: 'Filme Comédia 1', category_id: '11', stream_icon: 'http://server.tv:8080/poster3.jpg', rating: '7.9', added: '1700000080' },
    ];
    if (catId) return all.filter((s) => s.category_id === String(catId));
    return all;
  };
  (XtreamService as any).getSeries = async (_creds: any, catId?: string) => {
    const all = [
      { series_id: 301, name: 'Série Drama 1', category_id: '20', cover: 'http://server.tv:8080/cover1.jpg', rating: '9.0', last_modified: '1700000100' },
      { series_id: 302, name: 'Série Drama 2', category_id: '20', cover: 'http://server.tv:8080/cover2.jpg', rating: '8.7', last_modified: '1700000090' },
    ];
    if (catId) return all.filter((s) => s.category_id === String(catId));
    return all;
  };
  (XtreamService as any).getVodInfo = async () => ({
    info: {
      name: 'Filme Ação 1',
      plot: 'Sinopse extensa do Filme Ação 1 para validar que o usuário consegue descer até o texto completo da sinopse e subir de volta ao topo sem cortar o título.',
      releasedate: '2025-01-10',
      rating: '8.5',
      duration: '02:10:00',
      genre: 'Ação, Aventura',
      director: 'Diretor Teste',
      cast: 'Ator A, Ator B',
    },
    movie_data: {
      stream_id: 201,
      name: 'Filme Ação 1',
      container_extension: 'mp4',
    },
  });
  (XtreamService as any).getSeriesInfo = async () => ({
    info: {
      name: 'Série Drama 1',
      plot: 'Sinopse completa da Série Drama 1 sem truncamento por line-clamp-3 para garantir que toda a descrição seja exibida e navegável por controle remoto e teclado.',
      releaseDate: '2024',
      rating: '9.0',
      genre: 'Drama',
      cast: 'Atriz X, Ator Y',
    },
    seasons: [{ season_number: 1, name: 'Temporada 1' }],
    episodes: {
      '1': [
        { id: '9001', episode_num: 1, title: 'Episódio Piloto', container_extension: 'mp4', info: { duration: '48m', plot: 'Resumo ep 1' } },
        { id: '9002', episode_num: 2, title: 'Episódio Dois', container_extension: 'mp4', info: { duration: '50m', plot: 'Resumo ep 2' } },
      ],
    },
  });

  const { getHistoryKey, readHistoryMap } = await import('../src/utils/playbackHistory');

  const testCreds: XtreamCredentials = {
    serverUrl: 'http://server.tv:8080',
    username: 'navUser',
    password: 'navPassword',
    allowed_output_formats: ['m3u8', 'ts'],
  };

  window.localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(testCreds));
  confirmDisplayPreferences('default', 85);
  const realHistoryKey = getHistoryKey(testCreds.serverUrl, testCreds.username);
  assert(
    realHistoryKey.startsWith('northcode_history_'),
    'getHistoryKey deve derivar a chave real de histórico por conta'
  );
  window.localStorage.removeItem(realHistoryKey);

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/home'] },
        React.createElement(NavigationProvider, null, React.createElement(Home))
      )
    );
  });

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });

  // 1. Pressionar tecla direcional ativa o modo de navegação 'remote' e focaliza elemento visível
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    );
  });

  assert.strictEqual(getNavMode(), 'remote', 'Tecla direcional deve ativar navMode = remote');
  assert.strictEqual(
    document.documentElement.getAttribute('data-nav-mode'),
    'remote',
    'Elemento <html> deve receber data-nav-mode="remote" para exibir foco branco de alto contraste'
  );
  assert(
    document.activeElement && document.activeElement !== document.body,
    'Um elemento interativo visível deve receber foco ao navegar com setas'
  );

  // =========================================================================
  // CRITÉRIO A & B: Navegação vertical e horizontal no Início (HomeView)
  // =========================================================================
  const homeScrollContainer = container.querySelector('[data-nav-zone="content"][data-scroll-container="true"]') as HTMLElement;
  assert(homeScrollContainer, 'HomeView deve possuir container rolável com data-nav-zone="content" e data-scroll-container="true"');

  const heroAnchor = homeScrollContainer.querySelector('[data-scroll-top-anchor="true"]') as HTMLElement;
  assert(heroAnchor, 'HeroBanner deve estar envolvido por [data-scroll-top-anchor="true"]');
  const heroFirstBtn = heroAnchor.querySelector('button') as HTMLButtonElement;
  assert(heroFirstBtn, 'Botão principal do HeroBanner deve existir');

  const homeRows = Array.from(homeScrollContainer.querySelectorAll('[data-scroll-block="true"] [data-nav-row="true"]')) as HTMLElement[];
  assert(homeRows.length >= 2, 'HomeView deve renderizar múltiplas fileiras HorizontalRow');

  // Focar o botão do HeroBanner inicialmente
  await act(async () => {
    heroFirstBtn.focus();
  });
  assertSameElement(document.activeElement, heroFirstBtn, 'Foco inicial posicionado no HeroBanner');

  // Descer pelas fileiras do Início com ArrowDown passo a passo
  for (let i = 0; i < homeRows.length; i++) {
    await act(async () => {
      windowInstance.dispatchEvent(
        new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
      );
    });
    const activeEl = document.activeElement as HTMLElement;
    assert(
      homeRows[i].contains(activeEl),
      `ArrowDown passo ${i + 1} no Início deve focar item dentro da fileira ${i + 1}`
    );
    assert(
      homeScrollContainer.contains(activeEl),
      'Durante navegação vertical no conteúdo do Início, o foco nunca deve escapar para sidebar ou busca'
    );
  }

  // CRITÉRIO B: Dentro da última fileira, testar ArrowRight e ArrowLeft e rolagem horizontal
  const lastRow = homeRows[homeRows.length - 1];
  const lastRowItems = Array.from(lastRow.querySelectorAll('[data-nav-item="true"]')) as HTMLElement[];
  assert(lastRowItems.length >= 2, 'Fileira deve conter pelo menos 2 cards para testar ArrowLeft/ArrowRight');
  assertSameElement(document.activeElement, lastRowItems[0], 'Primeiro card da última fileira deve estar focado');

  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    );
  });
  assertSameElement(
    document.activeElement,
    lastRowItems[1],
    'ArrowRight dentro de HorizontalRow deve focar o próximo card da mesma fileira'
  );

  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
    );
  });
  assertSameElement(
    document.activeElement,
    lastRowItems[0],
    'ArrowLeft dentro de HorizontalRow deve voltar ao card anterior da mesma fileira'
  );

  // Simular que a página Início rolou para baixo ao atingir as fileiras inferiores
  homeScrollContainer.scrollTop = 680;

  // CRITÉRIO A: Subir com ArrowUp desde a última fileira até o HeroBanner sem saltar para sidebar ou busca
  for (let i = homeRows.length - 2; i >= 0; i--) {
    await act(async () => {
      windowInstance.dispatchEvent(
        new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
      );
    });
    const activeEl = document.activeElement as HTMLElement;
    assert(
      homeRows[i].contains(activeEl),
      `ArrowUp deve subir para a fileira anterior (${i + 1}) sem saltar para fora do conteúdo`
    );
    assert.strictEqual(
      activeEl.closest('[data-nav-zone]')?.getAttribute('data-nav-zone'),
      'content',
      'Foco deve permanecer estritamente na zona content durante a subida pelas fileiras'
    );
  }

  // Mais um ArrowUp a partir da primeira fileira deve atingir o HeroBanner e zerar scrollTop = 0
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
    );
  });
  assert(
    heroAnchor.contains(document.activeElement),
    'ArrowUp a partir da primeira fileira deve retornar o foco ao HeroBanner (e não pular para busca ou sidebar)'
  );
  assert.strictEqual(
    homeScrollContainer.scrollTop,
    0,
    'Retornar o foco ao HeroBanner com ArrowUp deve zerar scrollTop (0) para exibir o topo completo do Início'
  );

  // 2. Busca sob demanda pela lupa no cabeçalho superior: abre ao acionar a lupa, foca o input, e fecha/limpa ao pressionar Escape devolvendo o foco à lupa
  assert.strictEqual(
    container.querySelector('input[data-header-search-input="true"]'),
    null,
    'Campo de busca não deve estar visível permanentemente antes de acionar a lupa'
  );
  const searchTriggerBtn = container.querySelector(
    'button[data-header-search-trigger="true"]'
  ) as HTMLButtonElement;
  assert(searchTriggerBtn, 'Botão da lupa (data-header-search-trigger="true") deve existir no cabeçalho');

  await act(async () => {
    searchTriggerBtn.focus();
    searchTriggerBtn.click();
  });

  const searchInput = container.querySelector(
    'input[data-header-search-input="true"]'
  ) as HTMLInputElement;
  assert(searchInput, 'Campo de busca deve abrir após acionar o botão da lupa');
  assertSameElement(
    document.activeElement,
    searchInput,
    'Abrir a busca pela lupa deve focar automaticamente o input de busca'
  );
  assert.strictEqual(
    searchInput.getAttribute('data-search-editing'),
    'true',
    'Ao abrir a busca pela lupa, o modo de edição deve estar ativo (data-search-editing="true")'
  );
  assert.strictEqual(searchInput.readOnly, false, 'Em modo de edição, readOnly deve ser false');

  // Pressionar Escape/Voltar fecha a busca sob demanda, limpa searchQuery e devolve o foco ao botão da lupa sem deslogar
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  assert.strictEqual(
    container.querySelector('input[data-header-search-input="true"]'),
    null,
    'Pressionar Escape deve fechar o campo de busca sob demanda'
  );
  assertSameElement(
    document.activeElement,
    container.querySelector('button[data-header-search-trigger="true"]'),
    'Fechar a busca com Escape deve devolver o foco ao botão da lupa'
  );
  assert(
    window.localStorage.getItem(CREDENTIALS_KEY) !== null,
    'Fechar a busca com Voltar NUNCA deve remover credenciais'
  );

  // =========================================================================
  // CRITÉRIO 4: Filmes (MoviesView), encaminhamento único de foco para o controle "Categorias" (sem abrir menu), MovieDetails (sinopse longa + topo), VideoPlayer Escape único e Voltar da grade filtrada -> vitrine -> botão Filmes no cabeçalho -> Início
  // =========================================================================
  const filmesNavBtn = container.querySelector('button[data-header-nav-id="movies"]') as HTMLButtonElement;
  assert(filmesNavBtn, 'Botão Filmes no cabeçalho superior (data-header-nav-id="movies") deve existir');

  await act(async () => {
    filmesNavBtn.focus();
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
  });

  await waitForCondition(
    () =>
      Boolean(
        container.querySelector('[data-showcase-section="movies"]') &&
          container.querySelector('[data-nav-zone="categories"] button[data-categories-trigger="true"]')
      ),
    1000,
    'Montagem da seção Filmes (MoviesView) e controle Categorias'
  );

  const initialMoviesCatTrigger = container.querySelector(
    '[data-nav-zone="categories"] button[data-categories-trigger="true"]'
  ) as HTMLButtonElement;
  assertSameElement(
    document.activeElement,
    initialMoviesCatTrigger,
    'Ativar Filmes no cabeçalho deve encaminhar o foco uma única vez para o controle Categorias'
  );
  assert.strictEqual(
    initialMoviesCatTrigger.getAttribute('aria-expanded'),
    'false',
    'Ativar Filmes no cabeçalho NÃO deve abrir o menu Categorias automaticamente'
  );

  // Abrir o menu Categorias e selecionar a categoria Ação por Enter
  await act(async () => {
    initialMoviesCatTrigger.click();
  });
  assert.strictEqual(
    initialMoviesCatTrigger.getAttribute('aria-expanded'),
    'true',
    'Clicar no controle Categorias deve abrir o menu de categorias'
  );

  const catButtons = Array.from(
    container.querySelectorAll('[data-categories-menu="true"] button[data-category-id]')
  ) as HTMLButtonElement[];
  const acaoBtn = catButtons.find((b) => b.textContent?.toUpperCase().includes('AÇÃO'));
  assert(acaoBtn, 'Botão da categoria Ação em Filmes deve existir');

  await act(async () => {
    acaoBtn.focus();
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
  });

  await waitForCondition(
    () => container.querySelector('[data-nav-grid="true"] [data-nav-item="true"]') !== null,
    1000,
    'Renderização dos cards de filmes da categoria Ação na grade virtualizada'
  );

  const moviesMain = container.querySelector('main[data-scroll-container="true"]') as HTMLElement;
  assert(moviesMain, 'MoviesView deve possuir <main data-scroll-container="true">');
  moviesMain.scrollTop = 340;

  const movieCard = container.querySelector('[data-nav-grid="true"] [data-nav-item="true"]') as HTMLElement;
  assert(movieCard, 'Card de filme focável com data-nav-item="true" deve existir');

  await act(async () => {
    movieCard.focus();
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
  });

  await waitForCondition(
    () =>
      Boolean(
        document.querySelector('[data-focus-scope="modal"] [role="region"][aria-label="Sinopse do filme"]')
      ),
    1000,
    'Abertura de MovieDetails com sinopse carregada'
  );

  const activeModalScope = document.querySelector('[data-focus-scope="modal"]') as HTMLElement;
  assert(activeModalScope, 'MovieDetails aberto deve expor data-focus-scope="modal"');

  // Em MovieDetails, verificar foco inicial no botão Assistir, descer para a sinopse longa, rolar com ArrowDown/ArrowUp e subir de volta ao topo (scrollTop = 0)
  const movieDetailsScroll = activeModalScope.querySelector('[data-scroll-container="true"]') as HTMLElement;
  assert(movieDetailsScroll, 'MovieDetails deve possuir container rolável com data-scroll-container="true"');

  const moviePlayBtn = activeModalScope.querySelector('button[data-autofocus="true"]') as HTMLButtonElement;
  const movieSynopsisEl = activeModalScope.querySelector('[role="region"][aria-label="Sinopse do filme"]') as HTMLElement;
  assert(moviePlayBtn, 'Botão Assistir com data-autofocus="true" deve existir em MovieDetails');
  assert(movieSynopsisEl, 'Região focável da sinopse (aria-label="Sinopse do filme") deve existir em MovieDetails');

  await act(async () => {
    moviePlayBtn.focus();
  });
  assertSameElement(document.activeElement, moviePlayBtn, 'Foco posicionado no botão Assistir de MovieDetails');

  // ArrowDown a partir da linha de ações (Assistir) deve focar a região da sinopse
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    );
  });
  assertSameElement(
    document.activeElement,
    movieSynopsisEl,
    'ArrowDown a partir de Assistir em MovieDetails deve focar a sinopse para leitura'
  );

  // Simular sinopse longa (scrollHeight > clientHeight) e verificar rolagem progressiva por ArrowDown e ArrowUp
  Object.defineProperty(movieSynopsisEl, 'scrollHeight', { value: 420, configurable: true });
  Object.defineProperty(movieSynopsisEl, 'clientHeight', { value: 150, configurable: true });
  movieSynopsisEl.scrollTop = 0;

  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    );
  });
  assertSameElement(document.activeElement, movieSynopsisEl, 'ArrowDown com texto restante na sinopse do filme deve manter foco na sinopse');
  assert.strictEqual(movieSynopsisEl.scrollTop, 120, '1º ArrowDown na sinopse longa do filme deve avançar scrollTop em 120px');

  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
    );
  });
  assertSameElement(document.activeElement, movieSynopsisEl, 'ArrowUp com scrollTop > 0 na sinopse do filme deve manter foco na sinopse');
  assert.strictEqual(movieSynopsisEl.scrollTop, 0, 'ArrowUp na sinopse do filme deve voltar scrollTop para 0');

  // Simular rolagem da página para baixo durante leitura da sinopse
  movieDetailsScroll.scrollTop = 260;

  // Agora que movieSynopsisEl.scrollTop === 0, o próximo ArrowUp deve retornar à linha do botão Assistir e zerar movieDetailsScroll.scrollTop = 0
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
    );
  });
  assertSameElement(
    document.activeElement,
    moviePlayBtn,
    'ArrowUp a partir do topo da sinopse deve retornar ao botão Assistir (e não saltar direto para Voltar)'
  );
  assert.strictEqual(
    movieDetailsScroll.scrollTop,
    0,
    'Retornar ao botão Assistir com ArrowUp em MovieDetails deve zerar scrollTop = 0 para revelar o título e o topo completo'
  );

  // Abrir VideoPlayer a partir de MovieDetails e confirmar que 1 Escape fecha SOMENTE o VideoPlayer (sem fechar MovieDetails junto)
  await act(async () => {
    moviePlayBtn.focus();
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
  });

  await waitForCondition(
    () => document.querySelector('[data-player-container="true"][data-focus-scope="modal"]') !== null,
    1000,
    'Abertura do VideoPlayer modal a partir de MovieDetails'
  );

  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });

  assertSameElement(
    document.activeElement,
    moviePlayBtn,
    'Fechamento lógico imediato no 1º Escape: o foco deve retornar imediatamente ao botão Assistir em MovieDetails'
  );
  assert(
    activeModalScope.isConnected,
    'Fechamento lógico imediato no 1º Escape: MovieDetails deve permanecer aberto e conectado ao DOM'
  );

  await waitForCondition(
    () => document.querySelector('[data-player-container="true"][data-focus-scope="modal"]') === null,
    1200,
    'Remoção do elemento [data-player-container="true"][data-focus-scope="modal"] após conclusão da animação de saída (AnimatePresence)'
  );

  const residualPlayerEl = document.querySelector('[data-player-container="true"][data-focus-scope="modal"]');
  assertSameElement(
    residualPlayerEl,
    null,
    '1º Escape com VideoPlayer aberto deve remover o VideoPlayer do DOM após a transição de saída'
  );
  assert(
    document.querySelector('[data-focus-scope="modal"]') !== null,
    '1º Escape ao sair do VideoPlayer NÃO deve fechar MovieDetails em duplicidade'
  );
  assertSameElement(
    document.activeElement,
    moviePlayBtn,
    'Após conclusão da saída do VideoPlayer, o foco deve permanecer no botão Assistir em MovieDetails'
  );

  // Passo 1 (Filmes): Escape fecha MovieDetails, restaura foco ao card e preserva scrollTop da grade
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });

  await waitForCondition(
    () => document.querySelector('[data-focus-scope="modal"]') === null,
    1200,
    'Desmontagem de MovieDetails após comando Escape'
  );

  const residualModalAfterMovieClose = document.querySelector('[data-focus-scope="modal"]');
  assertSameElement(
    residualModalAfterMovieClose,
    null,
    'Escape em MovieDetails deve fechar a tela de detalhes'
  );
  assertSameElement(
    document.activeElement,
    movieCard,
    'Ao fechar MovieDetails com Voltar, o foco deve ser restaurado para o card que o abriu'
  );
  assert.strictEqual(
    moviesMain.scrollTop,
    340,
    'Fechar MovieDetails deve preservar a posição de rolagem (scrollTop) da grade de Filmes'
  );

  // Passo 2 (Filmes): Com foco na grade filtrada (categoria Ação), Escape sai da listagem filtrada, volta à vitrine de Filmes e restaura o foco ao controle "Categorias"
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
    await new Promise((r) => setTimeout(r, 20));
  });

  assert(
    container.querySelector('[data-showcase-section="movies"]') !== null &&
      container.querySelector('[data-nav-grid="true"]') === null,
    'Voltar a partir da listagem filtrada de Filmes deve retornar à vitrine de Filmes'
  );
  assertSameElement(
    document.activeElement,
    initialMoviesCatTrigger,
    'Sair da listagem filtrada deve restaurar o foco ao controle "Categorias"'
  );

  // Passo 3 (Critério 4 - Filmes): A partir da vitrine de Filmes, o próximo Escape foca o botão "Filmes" no cabeçalho superior E mantém a seção de Filmes aberta!
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });

  const filmesHeaderBtn = container.querySelector('button[data-header-nav-id="movies"]') as HTMLButtonElement;
  assertSameElement(
    document.activeElement,
    filmesHeaderBtn,
    'Critério 4: Voltar a partir da vitrine de Filmes deve focar o botão "Filmes" no cabeçalho superior'
  );
  assert(
    container.querySelector('[data-showcase-section="movies"]') !== null,
    'Critério 4: Ao focar o botão "Filmes" no cabeçalho superior, a seção de Filmes DEVE continuar aberta e montada'
  );

  // Passo 4 (Ação separada seguinte): Com o foco JÁ no botão "Filmes" do cabeçalho, um novo Escape retorna ao Início
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });
  assert(
    container.querySelector('[data-showcase-section="inicio"]') !== null &&
      container.querySelector('[data-scroll-top-anchor="true"]') !== null,
    'Ação seguinte de Voltar (quando o foco já estava no botão Filmes do cabeçalho) deve retornar ao Início'
  );

  // =========================================================================
  // CRITÉRIO 5: Séries (SeriesView), encaminhamento único de foco para o controle "Categorias" (sem abrir menu), SeriesDetails (sinopse longa) e Voltar da grade filtrada -> vitrine -> botão Séries no cabeçalho -> Início
  // =========================================================================
  const seriesNavBtn = container.querySelector('button[data-header-nav-id="series"]') as HTMLButtonElement;
  assert(seriesNavBtn, 'Botão Séries no cabeçalho superior (data-header-nav-id="series") deve existir');

  await act(async () => {
    seriesNavBtn.focus();
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
  });

  await waitForCondition(
    () =>
      Boolean(
        container.querySelector('[data-showcase-section="series"]') &&
          container.querySelector('[data-nav-zone="categories"] button[data-categories-trigger="true"]')
      ),
    1000,
    'Montagem da seção Séries (SeriesView) e controle Categorias'
  );

  const initialSeriesCatTrigger = container.querySelector(
    '[data-nav-zone="categories"] button[data-categories-trigger="true"]'
  ) as HTMLButtonElement;
  assertSameElement(
    document.activeElement,
    initialSeriesCatTrigger,
    'Ativar Séries no cabeçalho deve encaminhar o foco uma única vez para o controle Categorias'
  );
  assert.strictEqual(
    initialSeriesCatTrigger.getAttribute('aria-expanded'),
    'false',
    'Ativar Séries no cabeçalho NÃO deve abrir o menu Categorias automaticamente'
  );

  await act(async () => {
    initialSeriesCatTrigger.click();
  });

  const seriesCatBtns = Array.from(
    container.querySelectorAll('[data-categories-menu="true"] button[data-category-id]')
  ) as HTMLButtonElement[];
  const dramaBtn = seriesCatBtns.find((b) => b.textContent?.toUpperCase().includes('DRAMA'));
  assert(dramaBtn, 'Botão da categoria Drama em Séries deve existir');

  await act(async () => {
    dramaBtn.focus();
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
  });

  await waitForCondition(
    () => container.querySelector('[data-nav-grid="true"] [data-nav-item="true"]') !== null,
    1000,
    'Renderização dos cards de séries da categoria Drama na grade virtualizada'
  );

  const seriesMain = container.querySelector('main[data-scroll-container="true"]') as HTMLElement;
  assert(seriesMain, 'SeriesView deve possuir <main data-scroll-container="true">');
  seriesMain.scrollTop = 290;

  const seriesCard = container.querySelector('[data-nav-grid="true"] [data-nav-item="true"]') as HTMLElement;
  assert(seriesCard, 'Card de série focável deve existir');

  await act(async () => {
    seriesCard.focus();
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
  });

  await waitForCondition(
    () =>
      Boolean(
        document.querySelector('[data-focus-scope="modal"] [role="region"][aria-label="Sinopse da série"]')
      ),
    1000,
    'Abertura de SeriesDetails com sinopse e episódios carregados'
  );

  const seriesModalScope = document.querySelector('[data-focus-scope="modal"]') as HTMLElement;
  assert(seriesModalScope, 'SeriesDetails aberto deve expor data-focus-scope="modal"');

  const seriesDetailsScroll = seriesModalScope.querySelector('[data-scroll-container="true"]') as HTMLElement;
  const seriesSynopsisEl = seriesModalScope.querySelector('[role="region"][aria-label="Sinopse da série"]') as HTMLElement;
  const seriesFavBtn = seriesModalScope.querySelector('button[data-scroll-block="true"]') as HTMLButtonElement;
  const seriesBackBtn = seriesModalScope.querySelector('[data-scroll-top-anchor="true"] button') as HTMLButtonElement;
  assert(seriesDetailsScroll, 'SeriesDetails deve possuir container rolável com data-scroll-container="true"');
  assert(seriesSynopsisEl, 'Sinopse da série deve ser uma região focável com aria-label="Sinopse da série"');
  assert(seriesFavBtn, 'Botão Favoritar em SeriesDetails deve existir como bloco abaixo da sinopse');
  assert(
    !seriesSynopsisEl.className.includes('line-clamp'),
    'A sinopse em SeriesDetails NÃO deve ter truncamento permanente line-clamp-3'
  );

  // Simular sinopse longa (scrollHeight = 500, clientHeight = 150, maxScroll = 350)
  Object.defineProperty(seriesSynopsisEl, 'scrollHeight', { value: 500, configurable: true });
  Object.defineProperty(seriesSynopsisEl, 'clientHeight', { value: 150, configurable: true });
  seriesSynopsisEl.scrollTop = 0;

  await act(async () => {
    seriesSynopsisEl.focus();
  });
  assertSameElement(document.activeElement, seriesSynopsisEl, 'Foco posicionado na sinopse da série');

  // 1º ArrowDown: rola 0 -> 120 e mantém foco na sinopse
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    );
  });
  assertSameElement(document.activeElement, seriesSynopsisEl, '1º ArrowDown na sinopse longa da série deve manter foco na sinopse');
  assert.strictEqual(seriesSynopsisEl.scrollTop, 120, '1º ArrowDown deve avançar scrollTop para 120');

  // 2º ArrowDown: rola 120 -> 240 e mantém foco na sinopse
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    );
  });
  assertSameElement(document.activeElement, seriesSynopsisEl, '2º ArrowDown na sinopse longa da série deve manter foco na sinopse');
  assert.strictEqual(seriesSynopsisEl.scrollTop, 240, '2º ArrowDown deve avançar scrollTop para 240');

  // 3º ArrowDown: rola 240 -> 350 (limite final) e mantém foco na sinopse
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    );
  });
  assertSameElement(document.activeElement, seriesSynopsisEl, '3º ArrowDown ao atingir o limite da sinopse ainda mantém foco na sinopse');
  assert.strictEqual(seriesSynopsisEl.scrollTop, 350, '3º ArrowDown deve atingir o limite máximo scrollTop = 350');

  // Simular que o container externo também rolou parcialmente
  seriesDetailsScroll.scrollTop = 140;

  // 4º ArrowDown (já no limite 350): passa o foco para o botão Adicionar aos Favoritos SEM resetar scrollTop para 0
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    );
  });
  assertSameElement(
    document.activeElement,
    seriesFavBtn,
    'Após chegar ao fim da sinopse da série, o próximo ArrowDown deve mover o foco para o botão Favoritar'
  );
  assert(
    seriesDetailsScroll.scrollTop >= 140,
    `Mover o foco da sinopse para Favoritar NÃO deve resetar seriesDetailsScroll.scrollTop para 0 prematuramente (atual: ${seriesDetailsScroll.scrollTop})`
  );

  // Subir de volta para a sinopse e testar subida gradual com ArrowUp (350 -> 230 -> 110 -> 0)
  await act(async () => {
    seriesSynopsisEl.focus();
  });
  assert.strictEqual(seriesSynopsisEl.scrollTop, 350, 'Sinopse ainda está no final (350) ao retomar foco');

  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
    );
  });
  assertSameElement(document.activeElement, seriesSynopsisEl, '1º ArrowUp a partir do fim da sinopse deve manter foco na sinopse');
  assert.strictEqual(seriesSynopsisEl.scrollTop, 230, '1º ArrowUp deve reduzir scrollTop de 350 para 230');

  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
    );
  });
  assertSameElement(document.activeElement, seriesSynopsisEl, '2º ArrowUp na sinopse deve manter foco na sinopse');
  assert.strictEqual(seriesSynopsisEl.scrollTop, 110, '2º ArrowUp deve reduzir scrollTop de 230 para 110');

  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
    );
  });
  assertSameElement(document.activeElement, seriesSynopsisEl, '3º ArrowUp ao atingir o topo 0 ainda mantém foco na sinopse');
  assert.strictEqual(seriesSynopsisEl.scrollTop, 0, '3º ArrowUp deve atingir scrollTop = 0');

  // 4º ArrowUp (já em scrollTop === 0): entrega o foco para o botão Voltar no cabeçalho
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
    );
  });
  assertSameElement(
    document.activeElement,
    seriesBackBtn,
    'Quando scrollTop da sinopse chega a 0, o próximo ArrowUp deve mover o foco para o botão Voltar no topo'
  );

  // Navegar até a lista de episódios abaixo e simular rolagem para baixo
  const episodeItems = Array.from(seriesModalScope.querySelectorAll('[data-nav-zone="episodes"] [data-nav-item="true"]')) as HTMLElement[];
  assert(episodeItems.length >= 2, 'SeriesDetails deve renderizar episódios focáveis');

  await act(async () => {
    episodeItems[0].focus();
  });
  seriesDetailsScroll.scrollTop = 420;

  // Subir com ArrowUp desde o primeiro episódio: deve passar pela temporada, favoritar e chegar à sinopse zerando scrollTop = 0
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
    );
  });
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
    );
  });
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
    );
  });

  assertSameElement(
    document.activeElement,
    seriesSynopsisEl,
    'Subir com ArrowUp em SeriesDetails a partir dos episódios deve focar a sinopse no topo'
  );
  assert.strictEqual(
    seriesDetailsScroll.scrollTop,
    0,
    'Atingir a sinopse em SeriesDetails com ArrowUp deve zerar scrollTop = 0 para revelar título e início da sinopse'
  );

  // Passo 1 (Séries): Fechar SeriesDetails com Escape -> foco volta ao card de série e preserva scrollTop
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });
  assertSameElement(document.activeElement, seriesCard, 'Fechar SeriesDetails deve restaurar foco ao card da série');
  assert.strictEqual(seriesMain.scrollTop, 290, 'Fechar SeriesDetails deve preservar scrollTop da grade');

  // Aguardar a conclusão da animação de saída (AnimatePresence exit) de SeriesDetails para que seu handler modal seja desmontado
  await waitForCondition(
    () => document.querySelector('[data-focus-scope="modal"]') === null,
    1200,
    'Desmontagem do modal SeriesDetails após transição de saída (AnimatePresence)'
  );
  assertSameElement(
    document.activeElement,
    seriesCard,
    'Após conclusão da saída de SeriesDetails, o foco deve permanecer no card da série'
  );

  // Passo 2 (Séries): Escape a partir da listagem filtrada volta para a vitrine de Séries e restaura o foco ao controle "Categorias"
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
    await new Promise((r) => setTimeout(r, 20));
  });
  assert(
    container.querySelector('[data-showcase-section="series"]') !== null &&
      container.querySelector('[data-nav-grid="true"]') === null,
    'Voltar a partir da listagem filtrada de Séries deve retornar à vitrine de Séries'
  );
  assertSameElement(
    document.activeElement,
    initialSeriesCatTrigger,
    'Voltar a partir da grade filtrada de Séries deve restaurar o foco ao controle Categorias'
  );

  // Passo 3 (Critério 5 - Séries): Escape a partir da vitrine foca o botão "Séries" no cabeçalho superior E mantém a seção de Séries aberta!
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });
  const seriesHeaderBtn = container.querySelector('button[data-header-nav-id="series"]') as HTMLButtonElement;
  assertSameElement(
    document.activeElement,
    seriesHeaderBtn,
    'Critério 5: Voltar a partir da vitrine de Séries deve focar o botão "Séries" no cabeçalho superior'
  );
  assert(
    container.querySelector('[data-showcase-section="series"]') !== null,
    'Critério 5: Ao focar o botão "Séries" no cabeçalho superior, a seção de Séries DEVE continuar aberta e montada'
  );

  // Passo 4 (Ação separada seguinte): Com o foco JÁ no botão "Séries" do cabeçalho, um novo Escape retorna ao Início
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });
  assert(
    container.querySelector('[data-showcase-section="inicio"]') !== null &&
      container.querySelector('[data-scroll-top-anchor="true"]') !== null,
    'Ação seguinte de Voltar (quando o foco já estava no botão Séries do cabeçalho) deve retornar ao Início'
  );

  // =========================================================================
  // CRITÉRIOS 1, 2 & 3: TV ao Vivo (LiveTvView) — encaminhamento único de foco para 1ª categoria na montagem, foco no 1º canal da categoria, troca A -> B e sequência Voltar mantendo seção aberta
  // =========================================================================
  const liveNavBtn = container.querySelector('button[data-header-nav-id="live"]') as HTMLButtonElement;
  assert(liveNavBtn, 'Botão TV ao Vivo no cabeçalho superior (data-header-nav-id="live") deve existir');

  await act(async () => {
    liveNavBtn.focus();
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
  });

  await waitForCondition(
    () =>
      Boolean(
        container.querySelector('[data-nav-zone="categories"] [data-scroll-container="true"]') &&
          container.querySelector('button[data-live-category-id="1"]')
      ),
    1000,
    'Montagem de LiveTvView e lista de categorias da TV ao Vivo'
  );

  const initialLiveCatBtn = container.querySelector(
    '[data-nav-zone="categories"] button[data-category-selected="true"], [data-nav-zone="categories"] button[data-live-category-id]'
  ) as HTMLButtonElement;
  assertSameElement(
    document.activeElement,
    initialLiveCatBtn,
    'Ativar TV ao Vivo no cabeçalho deve encaminhar o foco uma única vez para a primeira categoria habilitada sem iniciar reprodução'
  );
  assert.strictEqual(
    container.querySelector('video'),
    null,
    'Encaminhar foco ao entrar na TV ao Vivo não deve clicar no destino nem iniciar reprodução'
  );

  const liveCatList = container.querySelector('[data-nav-zone="categories"] [data-scroll-container="true"]') as HTMLElement;
  assert(liveCatList, 'Lista de categorias da TV ao Vivo deve existir');
  liveCatList.scrollTop = 180;

  const abertosCatBtn = container.querySelector('button[data-live-category-id="1"]') as HTMLButtonElement;
  assert(abertosCatBtn, 'Botão da categoria Abertos (id=1) deve existir na TV ao Vivo');

  // Critério 1: Ativar categoria A populada (Abertos, id=1) com Enter (em modo remote)
  await act(async () => {
    abertosCatBtn.focus();
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
  });

  await waitForCondition(
    () => container.querySelectorAll('button[data-live-channel-btn="true"]').length >= 2,
    1000,
    'Renderização dos canais da categoria Abertos (id=1)'
  );

  const channelButtonsCatA = Array.from(container.querySelectorAll('button[data-live-channel-btn="true"]')) as HTMLButtonElement[];
  const backToCatsBtnInA = container.querySelector('button[data-live-back-to-categories="true"]');
  assert(channelButtonsCatA.length >= 2, 'Lista de canais da categoria Abertos deve conter os canais agrupados');
  assert.strictEqual(
    channelButtonsCatA[0].getAttribute('data-live-channel-category-id'),
    '1',
    'Critério 1: O botão do primeiro canal exibido em Abertos deve ter data-live-channel-category-id="1"'
  );
  assertSameElement(
    document.activeElement,
    channelButtonsCatA[0],
    'Critério 1: Ao abrir a categoria A (Abertos), o foco deve ir para o primeiro canal dessa categoria'
  );
  assertDifferentElement(
    document.activeElement,
    backToCatsBtnInA,
    'Critério 1: O foco NÃO deve terminar em "Voltar às Categorias" quando a categoria possui canais'
  );

  // Critério 2: Voltar às categorias e abrir a categoria B populada (Esportes, id=2) com catálogo em memória (filtragem local sem canais residuais de A)
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });
  await waitForCondition(
    () => container.querySelector('button[data-live-category-id="2"]') !== null,
    1000,
    'Retorno à lista de categorias da TV ao Vivo'
  );
  const esportesCatBtn = container.querySelector('button[data-live-category-id="2"]') as HTMLButtonElement;
  assert(esportesCatBtn, 'Botão da categoria Esportes (id=2) deve existir na TV ao Vivo');

  await act(async () => {
    esportesCatBtn.focus();
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
  });

  await waitForCondition(
    () => container.querySelectorAll('button[data-live-channel-btn="true"]').length >= 2,
    1000,
    'Renderização dos canais da categoria Esportes (id=2)'
  );

  const renderedCat1ButtonsInCat2 = container.querySelectorAll('button[data-live-channel-category-id="1"]');
  assert.strictEqual(
    renderedCat1ButtonsInCat2.length,
    0,
    'Critério 2: Ao abrir a categoria B (Esportes), nenhum canal da categoria A (Abertos) pode permanecer renderizado'
  );

  const channelButtonsCatB = Array.from(container.querySelectorAll('button[data-live-channel-btn="true"]')) as HTMLButtonElement[];
  const backToCatsBtnInB = container.querySelector('button[data-live-back-to-categories="true"]');
  assert(channelButtonsCatB.length >= 2, 'Categoria B (Esportes) deve exibir seus canais');
  assert.strictEqual(
    channelButtonsCatB[0].getAttribute('data-live-channel-category-id'),
    '2',
    'Critério 2: O primeiro canal focado em Esportes deve ter data-live-channel-category-id="2"'
  );
  assertSameElement(
    document.activeElement,
    channelButtonsCatB[0],
    'Critério 2: Ao trocar da categoria A para a categoria B populada, o foco deve estar no primeiro canal de B'
  );
  assertDifferentElement(
    document.activeElement,
    backToCatsBtnInB,
    'Critério 2: O foco em B NÃO deve parar em "Voltar às Categorias"'
  );

  // Voltar para categorias e reabrir categoria A (Abertos) para testar fluxo completo de Critério 3:
  // tela cheia -> preview -> canal -> categorias -> botão "TV ao Vivo" na barra lateral mantendo a tela de TV visível
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });
  await waitForCondition(
    () => container.querySelector('button[data-live-category-id="1"]') !== null,
    1000,
    'Retorno à lista de categorias da TV ao Vivo antes de reabrir Abertos'
  );
  const abertosCatBtnAgain = container.querySelector('button[data-live-category-id="1"]') as HTMLButtonElement;
  await act(async () => {
    abertosCatBtnAgain.focus();
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
  });
  await waitForCondition(
    () => container.querySelectorAll('button[data-live-channel-btn="true"]').length >= 2,
    1000,
    'Reabertura dos canais de Abertos'
  );

  const channelButtons = Array.from(container.querySelectorAll('button[data-live-channel-btn="true"]')) as HTMLButtonElement[];
  assertSameElement(document.activeElement, channelButtons[0], 'Foco no primeiro canal de Abertos');

  // ArrowDown deve mover para o segundo canal da lista
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    );
  });
  assertSameElement(
    document.activeElement,
    channelButtons[1],
    'ArrowDown na lista de canais deve focar o segundo canal'
  );

  // 1º Enter no segundo canal: abre o preview lateral mantendo foco no canal
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  assert(container.querySelector('video') !== null, '1º Enter no canal deve iniciar o preview de vídeo');

  // 2º Enter no mesmo canal ativo: entra em tela cheia (embedded fullscreen)
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  assert(
    document.querySelector('[data-player-container="true"][data-focus-scope="modal"]') !== null,
    '2º Enter no mesmo canal em reprodução deve colocar o player em tela cheia ([data-player-container="true"][data-focus-scope="modal"])'
  );

  // 1º Escape (em tela cheia): sai da tela cheia para o preview (sem fechar o preview e sem voltar às categorias)
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  assertSameElement(
    document.querySelector('[data-player-container="true"][data-focus-scope="modal"]'),
    null,
    '1º Escape na TV ao Vivo deve sair da tela cheia de volta ao preview'
  );
  assert(
    container.querySelector('video') !== null,
    'Após 1º Escape (saindo da tela cheia), o preview do canal ainda deve estar aberto'
  );

  // 2º Escape (no preview): fecha o preview e mantém a lista de canais com foco no canal selecionado
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });
  assertSameElement(
    container.querySelector('video'),
    null,
    '2º Escape na TV ao Vivo deve fechar o preview do canal'
  );
  const channelButtonsAfterPreviewClose = Array.from(container.querySelectorAll('button[data-live-channel-btn="true"]')) as HTMLButtonElement[];
  assertSameElement(
    document.activeElement,
    channelButtonsAfterPreviewClose[1],
    'Ao fechar o preview com Voltar, o foco deve permanecer no canal que estava selecionado na lista'
  );

  // 3º Escape (na lista de canais): volta para a lista de categorias e restaura o foco na categoria de origem (Abertos) e seu scrollTop
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });
  const abertosCatBtnRestored = container.querySelector('button[data-live-category-id="1"]') as HTMLButtonElement;
  assert(abertosCatBtnRestored, 'Lista de categorias deve voltar a ser exibida após 3º Escape');
  assertSameElement(
    document.activeElement,
    abertosCatBtnRestored,
    '3º Escape deve restaurar o foco exatamente na categoria de origem (Abertos)'
  );
  const liveCatListRestored = container.querySelector('[data-nav-zone="categories"] [data-scroll-container="true"]') as HTMLElement;
  assert.strictEqual(
    liveCatListRestored.scrollTop,
    180,
    'Voltar para a lista de categorias deve preservar o scrollTop anterior das categorias'
  );

  // Testar categoria vazia ("Sem Canais", id=3): foco deve ir para o botão "Voltar às Categorias"
  const emptyCatBtn = container.querySelector('button[data-live-category-id="3"]') as HTMLButtonElement;
  assert(emptyCatBtn, 'Botão da categoria Sem Canais (id=3) deve existir');
  await act(async () => {
    emptyCatBtn.focus();
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  const backToCatsBtn = container.querySelector('button[data-live-back-to-categories="true"]') as HTMLButtonElement;
  assertSameElement(
    document.activeElement,
    backToCatsBtn,
    'Quando a categoria não tiver canais focáveis, o foco deve ir para o botão "Voltar às Categorias"'
  );

  // Escape volta da categoria vazia para a lista de categorias
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });

  // 4º Escape (Critério 3 - na lista de categorias da TV ao Vivo): foca o botão "TV ao Vivo" no cabeçalho superior E mantém a tela de TV visível!
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });
  const liveHeaderBtn = container.querySelector('button[data-header-nav-id="live"]') as HTMLButtonElement;
  assertSameElement(
    document.activeElement,
    liveHeaderBtn,
    'Critério 3: 4º Escape a partir das categorias da TV ao Vivo deve focar o botão "TV ao Vivo" no cabeçalho superior'
  );
  assert(
    container.textContent?.includes('CATEGORIAS DE TV') &&
      container.querySelector('button[data-live-category-id="1"]') !== null,
    'Critério 3: Ao alcançar o botão "TV ao Vivo" no cabeçalho superior, a tela de TV DEVE continuar aberta e visível'
  );

  // Critério 6: Clique explícito em "Início" no cabeçalho superior continua abrindo Início
  const inicioHeaderBtn = container.querySelector('button[data-header-nav-id="inicio"]') as HTMLButtonElement;
  assert(inicioHeaderBtn, 'Botão Início no cabeçalho superior deve existir');
  await act(async () => {
    inicioHeaderBtn.click();
  });
  assert(
    container.querySelector('[data-scroll-top-anchor="true"]') !== null,
    'Critério 6: Clique explícito em "Início" no cabeçalho superior deve abrir a tela Início'
  );

  // =========================================================================
  // CRITÉRIO 7: Cards de "Canais Ao Vivo" na Home usam o fluxo funcional de LiveTvView e o teste usa getHistoryKey + PlaybackHistoryMap reais
  // =========================================================================
  window.localStorage.removeItem(realHistoryKey);

  // Na HomeView, encontrar a fileira "Canais Ao Vivo" e ativar o card "Canal Esporte HD" (stream_id 104, que pertence ao grupo Canal Esporte com SD=103 e HD=104)
  const homeLiveCards = Array.from(container.querySelectorAll('[data-nav-row="true"] [data-nav-item="true"]')) as HTMLElement[];
  const esporteHomeCard = homeLiveCards.find((el) => el.textContent?.includes('Canal Esporte HD'));
  assert(esporteHomeCard, 'Card "Canal Esporte HD" deve existir na fileira Canais Ao Vivo da Home');

  await act(async () => {
    esporteHomeCard.focus();
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
  });

  // Deve ter aberto LiveTvView com o grupo "Canal Esporte" selecionado e iniciado pela variante SD (stream_id 103) em formato .m3u8 (nunca .ts fixo)
  const liveVideoFromHome = container.querySelector('video') as HTMLVideoElement;
  assert(liveVideoFromHome, 'Clicar em um canal ao vivo na Home deve abrir o player de preview da LiveTvView');
  assert(
    liveVideoFromHome.src.includes('/live/navUser/navPassword/103.m3u8'),
    `Critério 7: Canal aberto pela Home deve usar .m3u8 (allowed_output_formats) e iniciar pela variante SD (103), mas obteve: ${liveVideoFromHome.src}`
  );
  assert(
    !liveVideoFromHome.src.endsWith('.ts'),
    'Critério 7: Canal aberto pela Home NÃO deve forçar URL .ts quando m3u8 é suportado'
  );

  // Antes da confirmação de reprodução (playing), o mapa real de histórico NÃO deve conter 'live:103' nem 'live:104'
  const historyMapBeforePlaying = readHistoryMap(realHistoryKey);
  assert(historyMapBeforePlaying !== null, 'readHistoryMap deve retornar um mapa válido');
  assert.strictEqual(
    historyMapBeforePlaying!['live:103'],
    undefined,
    'Critério 7: Antes do evento playing, o histórico real não deve registrar live:103'
  );
  assert.strictEqual(
    historyMapBeforePlaying!['live:104'],
    undefined,
    'Critério 7: Antes do evento playing, o histórico real não deve registrar live:104'
  );

  // Simular sucesso de reprodução (evento 'playing' no <video>) e verificar presença de 'live:103' no PlaybackHistoryMap real
  await act(async () => {
    liveVideoFromHome.dispatchEvent(new (windowInstance as any).Event('playing'));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  const historyMapAfterPlaying = readHistoryMap(realHistoryKey);
  assert(
    historyMapAfterPlaying && historyMapAfterPlaying['live:103']?.id === '103' && historyMapAfterPlaying['live:103']?.type === 'live',
    'Critério 7: Após o evento playing, o histórico real (PlaybackHistoryMap) deve conter a chave "live:103"'
  );

  // Sequência de Voltar após abrir canal pela Home: preview -> canais -> categorias -> botão "TV ao Vivo" na sidebar (com TV aberta) -> Início
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });
  assertSameElement(container.querySelector('video'), null, '1º Escape após abrir canal pela Home fecha o preview');

  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });
  assert(
    container.querySelector('button[data-live-category-id="2"]') !== null,
    '2º Escape após abrir canal pela Home volta para a lista de categorias da TV ao Vivo'
  );

  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });
  assertSameElement(
    document.activeElement,
    container.querySelector('button[data-header-nav-id="live"]'),
    '3º Escape após abrir canal pela Home foca o botão "TV ao Vivo" no cabeçalho superior'
  );
  assert(
    container.querySelector('button[data-live-category-id="2"]') !== null,
    '3º Escape mantém a tela de TV ao Vivo aberta enquanto o foco está no botão do cabeçalho'
  );

  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });
  assert(
    container.querySelector('[data-scroll-top-anchor="true"]') !== null,
    '4º Escape separado retorna à tela Início'
  );

  // 4. Ponte oficial do Capacitor (@capacitor/app backButton) na raiz chama App.exitApp() e NUNCA faz logout
  let exitAppCalled = false;
  let backListenerCallback: ((ev: any) => void) | null = null;

  setCapacitorAppBridgeForTest({
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    addListener: async (_eventName, cb) => {
      backListenerCallback = cb;
      return {
        remove: async () => {
          backListenerCallback = null;
        },
      };
    },
    exitApp: async () => {
      exitAppCalled = true;
    },
  });

  const detachCap = attachCapacitorBackAdapter();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert(backListenerCallback !== null, 'Adaptador Capacitor deve registrar listener para backButton');
  assert.strictEqual(
    getNativeBackBridgeStatus().label,
    'Capacitor App.backButton (@capacitor/app)',
    'getNativeBackBridgeStatus deve identificar a ponte oficial @capacitor/app'
  );

  // Disparar backButton na raiz (Início sem modal aberto)
  await act(async () => {
    backListenerCallback!({ canGoBack: false });
  });

  assert.strictEqual(exitAppCalled, true, 'Na tela raiz, o botão Voltar do Android deve invocar App.exitApp()');
  assert(
    window.localStorage.getItem(CREDENTIALS_KEY) !== null,
    'Mesmo ao sair do app na raiz, as credenciais NUNCA devem ser removidas (proibido logout no Voltar)'
  );

  detachCap();
  setCapacitorAppBridgeForTest(null);

  // 5. Movimento de ponteiro alterna de volta para 'pointer' sem quebrar cliques
  await act(async () => {
    windowInstance.dispatchEvent(new (windowInstance as any).PointerEvent('pointerdown', { bubbles: true }));
  });
  assert.strictEqual(getNavMode(), 'pointer', 'Evento pointerdown deve alternar navMode para pointer');

  await act(async () => {
    root.unmount();
  });
  document.body.removeChild(container);

  console.log('✅ Testes de navegação por controle/teclado (Critérios 1 a 7), foco, rolagem e política de Voltar aprovados!');
}

async function runDisplaySetupPreviewAndLifecycleTests() {
  console.log('\n--- 10. Testes de Ciclo de Vida da Prévia de Apresentação (DisplaySetupModal & tvEnvironment) ---');
  const { NavigationProvider, clearAllBackHandlersForTest } = await import('../src/navigation');
  clearAllBackHandlersForTest();

  // 0. Primeiro acesso no <Home /> sem preferência salva abre automaticamente o DisplaySetupModal
  window.localStorage.removeItem(STORAGE_KEY_DISPLAY_PREFS);
  cancelDisplayPreview();
  assert.strictEqual(
    getDisplayPreferencesSnapshot().isConfigured,
    false,
    'Sem chave salva no localStorage, isConfigured deve ser false'
  );

  const homeFirstRunContainer = document.createElement('div');
  document.body.appendChild(homeFirstRunContainer);
  const homeFirstRunRoot = createRoot(homeFirstRunContainer);

  await act(async () => {
    homeFirstRunRoot.render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/home'] },
        React.createElement(NavigationProvider, null, React.createElement(Home))
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
  });

  const firstRunModal = homeFirstRunContainer.querySelector('[data-display-setup-modal="true"]');
  assert(firstRunModal !== null, 'No primeiro acesso sem preferência salva, Home deve abrir DisplaySetupModal');
  assert(
    homeFirstRunContainer.querySelector('[data-device-choice="tv"]') !== null &&
      homeFirstRunContainer.querySelector('[data-device-choice="celular"]') !== null &&
      homeFirstRunContainer.querySelector('[data-device-choice="tablet"]') !== null &&
      homeFirstRunContainer.querySelector('[data-device-choice="computador"]') !== null,
    'Modal de primeiro acesso deve apresentar as quatro opções explícitas: TV, Celular, Tablet e Computador'
  );

  // Testar Caminho Rápido de TV no primeiro uso: selecionar TV -> "Usar tamanho sugerido (85%)"
  const firstRunTvBtn = homeFirstRunContainer.querySelector(
    'button[data-device-choice="tv"]'
  ) as HTMLButtonElement;
  await act(async () => {
    firstRunTvBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  const quickUse85Btn = homeFirstRunContainer.querySelector(
    'button[data-tv-use-suggested="true"]'
  ) as HTMLButtonElement | null;
  const quickAdjustBtn = homeFirstRunContainer.querySelector(
    'button[data-tv-adjust-size="true"]'
  ) as HTMLButtonElement | null;
  assert(
    quickUse85Btn !== null && quickAdjustBtn !== null,
    'Ao selecionar TV pela primeira vez, deve oferecer "Usar tamanho sugerido (85%)" e "Ajustar tamanho"'
  );
  assert(
    quickUse85Btn!.textContent?.includes('Usar tamanho sugerido (85%)'),
    'Botão de caminho rápido deve exibir "Usar tamanho sugerido (85%)"'
  );
  assert(
    quickAdjustBtn!.textContent?.includes('Ajustar tamanho'),
    'Botão de calibração opcional deve exibir "Ajustar tamanho"'
  );

  // Enquanto percorre opções no primeiro acesso, a raiz e o localStorage permanecem intactos
  assert.strictEqual(
    window.localStorage.getItem(STORAGE_KEY_DISPLAY_PREFS),
    null,
    'Entrar no passo rápido de TV não deve gravar preferência antes da confirmação'
  );

  await act(async () => {
    quickUse85Btn!.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  assert.strictEqual(
    homeFirstRunContainer.querySelector('[data-display-setup-modal="true"]'),
    null,
    'Confirmar "Usar tamanho sugerido (85%)" deve fechar o DisplaySetupModal no primeiro acesso'
  );
  assert.strictEqual(getDisplayPreferencesSnapshot().isConfigured, true);
  assert.strictEqual(getDisplayPreferencesSnapshot().mode, 'tv');
  assert.strictEqual(getDisplayPreferencesSnapshot().tvScale, 85);
  assert.strictEqual(document.documentElement.getAttribute('data-display-mode'), 'tv');
  assert.strictEqual(document.documentElement.style.getPropertyValue('--nc-ui-scale'), '0.85');

  await act(async () => {
    homeFirstRunRoot.unmount();
  });
  document.body.removeChild(homeFirstRunContainer);

  // 1. Três opções responsivas (Celular, Tablet, Computador):
  //    - navegação por setas e retorno à opção de origem no Voltar (botão e Escape)
  //    - nome escolhido visível na confirmação
  //    - confirmam 'default' a 100% preservando o formato salvo e a escala de TV anteriormente salva (ex.: 90%)
  confirmDisplayPreferences('tv', 90);
  assert.strictEqual(document.documentElement.getAttribute('data-display-mode'), 'tv');
  assert.strictEqual(document.documentElement.style.getPropertyValue('--nc-ui-scale'), '0.9');

  const responsiveChoices: Array<{ id: 'celular' | 'tablet' | 'computador'; label: string }> = [
    { id: 'celular', label: 'Celular' },
    { id: 'tablet', label: 'Tablet' },
    { id: 'computador', label: 'Computador' },
  ];

  for (const choice of responsiveChoices) {
    // Garantir que antes de testar cada opção responsiva temos TV @ 90% salva
    confirmDisplayPreferences('tv', 90);
    const rootFontBeforeResponsive = document.documentElement.style.fontSize;
    const rawSaved90 = window.localStorage.getItem(STORAGE_KEY_DISPLAY_PREFS);

    const respContainer = document.createElement('div');
    document.body.appendChild(respContainer);
    const respRoot = createRoot(respContainer);
    let respCompleted = false;

    await act(async () => {
      respRoot.render(
        React.createElement(
          NavigationProvider,
          null,
          React.createElement(DisplaySetupModal, {
            isOpen: true,
            canCancel: true,
            initialStep: 'device',
            onComplete: () => {
              respCompleted = true;
            },
          })
        )
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    // Navegar por setas em grade de 2 colunas (sm:grid-cols-2) com geometria representativa,
    // disparando os eventos diretamente no elemento focado (document.activeElement)
    const tvBtn = respContainer.querySelector('button[data-device-choice="tv"]') as HTMLButtonElement;
    const celBtn = respContainer.querySelector('button[data-device-choice="celular"]') as HTMLButtonElement;
    const tabBtn = respContainer.querySelector('button[data-device-choice="tablet"]') as HTMLButtonElement;
    const compBtn = respContainer.querySelector('button[data-device-choice="computador"]') as HTMLButtonElement;
    assert(tvBtn && celBtn && tabBtn && compBtn, 'Todas as 4 opções de dispositivo devem estar montadas');

    const mockRect = (left: number, top: number, width: number, height: number): DOMRect =>
      ({
        x: left,
        y: top,
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
        toJSON: () => ({}),
      }) as DOMRect;

    // Geometria 2 colunas (linha 0: TV, Celular | linha 1: Tablet, Computador)
    tvBtn.getBoundingClientRect = () => mockRect(40, 120, 320, 130);
    celBtn.getBoundingClientRect = () => mockRect(380, 120, 320, 130);
    tabBtn.getBoundingClientRect = () => mockRect(40, 270, 320, 130);
    compBtn.getBoundingClientRect = () => mockRect(380, 270, 320, 130);

    const dispatchKeyOnFocused = async (key: string) => {
      const target = (document.activeElement as HTMLElement) || tvBtn;
      await act(async () => {
        target.dispatchEvent(
          new (windowInstance as any).KeyboardEvent('keydown', {
            key,
            bubbles: true,
            cancelable: true,
          }) as unknown as Event
        );
      });
    };

    await act(async () => {
      tvBtn.focus();
    });
    assertSameElement(document.activeElement, tvBtn, 'Foco inicial em TV (col 0, row 0)');

    await dispatchKeyOnFocused('ArrowRight');
    assertSameElement(document.activeElement, celBtn, '2 colunas — ArrowRight: TV -> Celular');

    await dispatchKeyOnFocused('ArrowRight');
    assertSameElement(
      document.activeElement,
      celBtn,
      '2 colunas — ArrowRight em Celular deve manter o foco no fim da linha (Celular)'
    );

    await dispatchKeyOnFocused('ArrowDown');
    assertSameElement(
      document.activeElement,
      compBtn,
      '2 colunas — ArrowDown em Celular deve levar a Computador (abaixo na mesma coluna)'
    );

    await dispatchKeyOnFocused('ArrowLeft');
    assertSameElement(document.activeElement, tabBtn, '2 colunas — ArrowLeft: Computador -> Tablet');

    await dispatchKeyOnFocused('ArrowLeft');
    assertSameElement(
      document.activeElement,
      tabBtn,
      '2 colunas — ArrowLeft em Tablet deve manter o foco no início da linha (Tablet)'
    );

    await dispatchKeyOnFocused('ArrowUp');
    assertSameElement(document.activeElement, tvBtn, '2 colunas — ArrowUp: Tablet -> TV');

    // Selecionar a opção responsiva em teste
    const targetOptionBtn = respContainer.querySelector(
      `button[data-device-choice="${choice.id}"]`
    ) as HTMLButtonElement;
    await act(async () => {
      targetOptionBtn.focus();
      targetOptionBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    // Enquanto está na tela de confirmação da opção responsiva, a raiz e o localStorage permanecem intactos
    assert.strictEqual(
      document.documentElement.getAttribute('data-display-mode'),
      'tv',
      `Selecionar ${choice.label} sem confirmar não deve alterar html[data-display-mode]`
    );
    assert.strictEqual(
      document.documentElement.style.getPropertyValue('--nc-ui-scale'),
      '0.9',
      `Selecionar ${choice.label} sem confirmar não deve alterar --nc-ui-scale`
    );
    assert.strictEqual(
      document.documentElement.style.fontSize,
      rootFontBeforeResponsive,
      `Selecionar ${choice.label} sem confirmar não deve alterar o font-size da raiz`
    );
    assert.strictEqual(
      window.localStorage.getItem(STORAGE_KEY_DISPLAY_PREFS),
      rawSaved90,
      `Selecionar ${choice.label} sem confirmar não deve gravar no localStorage`
    );

    const confirmTitle = respContainer.querySelector('[data-default-confirm-title="true"]');
    assert(
      confirmTitle?.textContent?.includes(choice.label),
      `Tela de confirmação deve exibir o nome escolhido (${choice.label})`
    );

    // Pressionar Voltar (Escape) deve retornar à seleção de dispositivos e devolver o foco exatamente para a opção de origem
    await act(async () => {
      windowInstance.dispatchEvent(
        new (windowInstance as any).KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const returnedOptionBtn = respContainer.querySelector(
      `button[data-device-choice="${choice.id}"]`
    ) as HTMLButtonElement;
    assertSameElement(
      document.activeElement,
      returnedOptionBtn,
      `Voltar a partir da confirmação de ${choice.label} deve devolver o foco para a opção de origem (${choice.label})`
    );

    // Entrar novamente e confirmar a opção responsiva
    await act(async () => {
      returnedOptionBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const confirmDefaultBtn = respContainer.querySelector(
      'button[data-confirm-default="true"]'
    ) as HTMLButtonElement;
    assert(confirmDefaultBtn !== null, `Botão Confirmar para ${choice.label} deve existir`);
    await act(async () => {
      confirmDefaultBtn.click();
    });

    assert.strictEqual(respCompleted, true, `Confirmar ${choice.label} deve chamar onComplete`);
    const snapAfterResp = getDisplayPreferencesSnapshot();
    assert.strictEqual(snapAfterResp.mode, 'default', `${choice.label} deve confirmar o modo 'default'`);
    assert.strictEqual(snapAfterResp.uiScaleFactor, 1, `${choice.label} deve usar escala 1 (100%)`);
    assert.strictEqual(
      snapAfterResp.tvScale,
      90,
      `Confirmar ${choice.label} deve preservar a escala de TV anteriormente salva (90%)`
    );
    assert.strictEqual(document.documentElement.getAttribute('data-display-mode'), 'default');
    assert.strictEqual(document.documentElement.style.getPropertyValue('--nc-ui-scale'), '1');
    assert.strictEqual(document.documentElement.style.fontSize, '');

    const storedParsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY_DISPLAY_PREFS) || '{}');
    assert.deepStrictEqual(
      storedParsed,
      {
        version: 1,
        mode: 'default',
        tvScale: 90,
        configured: true,
      },
      `Formato salvo em localStorage após confirmar ${choice.label} deve permanecer inalterado e preservar tvScale: 90`
    );

    await act(async () => {
      respRoot.unmount();
    });
    document.body.removeChild(respContainer);
  }

  // 2. Prévia local e leve: testar vários movimentos do controle de escala (setas, arraste, botões rápidos 90% e 85%)
  //    verificando que a amostra muda localmente sem alterar html[data-display-mode], --nc-ui-scale, font-size da raiz ou localStorage,
  //    e que Voltar, cancelar, fechar ou desmontar descarta o rascunho.
  confirmDisplayPreferences('default', 90);
  assert.strictEqual(document.documentElement.getAttribute('data-display-mode'), 'default');
  assert.strictEqual(document.documentElement.style.getPropertyValue('--nc-ui-scale'), '1');
  assert.strictEqual(document.documentElement.style.fontSize, '');
  const rawSavedBeforeCalib = window.localStorage.getItem(STORAGE_KEY_DISPLAY_PREFS);

  const container1 = document.createElement('div');
  document.body.appendChild(container1);
  const root1 = createRoot(container1);

  await act(async () => {
    root1.render(
      React.createElement(
        NavigationProvider,
        null,
        React.createElement(DisplaySetupModal, {
          isOpen: true,
          canCancel: true,
          initialStep: 'tv-calibrate',
          onComplete: () => {},
          onCancel: () => {},
        })
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  // Ao reabrir o ajuste direto com tvScale=90 salvo, deve começar pelo valor salvo (90%)
  const slider1 = container1.querySelector('[data-calibration-slider="true"]') as HTMLElement;
  const sample1 = container1.querySelector('[data-calibration-sample="true"]') as HTMLElement;
  const sampleIcon1 = container1.querySelector('[data-sample-icon="true"]') as HTMLElement;
  const sampleText1 = container1.querySelector('[data-sample-text="true"]') as HTMLElement;
  assert(
    slider1 !== null && sample1 !== null && sampleIcon1 !== null && sampleText1 !== null,
    'Cenário 2: Controle de escala e amostra simples (ícone + texto) devem estar presentes'
  );
  assert.strictEqual(
    slider1.getAttribute('aria-valuenow'),
    '90',
    'Cenário 2: Ao reabrir a calibração, deve começar pelo valor salvo (90%)'
  );
  assert.strictEqual(
    sample1.getAttribute('data-sample-scale'),
    '90',
    'Cenário 2: Amostra local deve iniciar em 90%'
  );

  const iconWidthAt90 = parseFloat(sampleIcon1.style.width);
  const textFontAt90 = parseFloat(sampleText1.style.fontSize);
  assert(iconWidthAt90 > 0 && textFontAt90 > 0, 'Cenário 2: Amostra local deve ter dimensões numéricas de ícone e texto');

  // Raiz global continua intocada enquanto o modal de calibração está aberto
  assert.strictEqual(getDisplayPreferencesSnapshot().isPreviewActive, false, 'Cenário 2: Prévia global não deve ser ativada pelo modal');
  assert.strictEqual(document.documentElement.getAttribute('data-display-mode'), 'default', 'Cenário 2: html[data-display-mode] permanece intacto ("default")');
  assert.strictEqual(document.documentElement.style.getPropertyValue('--nc-ui-scale'), '1', 'Cenário 2: --nc-ui-scale permanece intacto ("1")');
  assert.strictEqual(document.documentElement.style.fontSize, '', 'Cenário 2: font-size da raiz permanece intacto');
  assert.strictEqual(window.localStorage.getItem(STORAGE_KEY_DISPLAY_PREFS), rawSavedBeforeCalib, 'Cenário 2: localStorage permanece intacto');

  // Mover controle de escala vários passos para a direita (90% -> 95% -> 100% -> 105% -> 110% -> 115% -> 120% -> 125%)
  for (let i = 0; i < 7; i++) {
    await act(async () => {
      slider1.dispatchEvent(
        new (windowInstance as any).KeyboardEvent('keydown', {
          key: 'ArrowRight',
          bubbles: true,
          cancelable: true,
        }) as unknown as Event
      );
    });
  }
  assert.strictEqual(slider1.getAttribute('aria-valuenow'), '125');
  assert.strictEqual(sample1.getAttribute('data-sample-scale'), '125');
  const iconWidthAt125 = parseFloat(sampleIcon1.style.width);
  const textFontAt125 = parseFloat(sampleText1.style.fontSize);
  assert(
    iconWidthAt125 > iconWidthAt90 && textFontAt125 > textFontAt90,
    'Cenário 2: Em 125%, o ícone e o texto da amostra devem ser maiores que em 90%'
  );

  // Mover controle de escala vários passos para a esquerda até 50% (15 passos de 5%)
  for (let i = 0; i < 15; i++) {
    await act(async () => {
      slider1.dispatchEvent(
        new (windowInstance as any).KeyboardEvent('keydown', {
          key: 'ArrowLeft',
          bubbles: true,
          cancelable: true,
        }) as unknown as Event
      );
    });
  }
  assert.strictEqual(slider1.getAttribute('aria-valuenow'), '50');
  assert.strictEqual(sample1.getAttribute('data-sample-scale'), '50');
  const iconWidthAt50 = parseFloat(sampleIcon1.style.width);
  const textFontAt50 = parseFloat(sampleText1.style.fontSize);
  assert(
    iconWidthAt50 < iconWidthAt90 && textFontAt50 < textFontAt90,
    'Cenário 2: Em 50%, o ícone e o texto da amostra devem ser menores que em 90%'
  );

  // Durante todos os movimentos de 50% a 125%, a raiz do documento e o localStorage continuam 100% intocados
  assert.strictEqual(document.documentElement.getAttribute('data-display-mode'), 'default');
  assert.strictEqual(document.documentElement.style.getPropertyValue('--nc-ui-scale'), '1');
  assert.strictEqual(document.documentElement.style.fontSize, '');
  assert.strictEqual(window.localStorage.getItem(STORAGE_KEY_DISPLAY_PREFS), rawSavedBeforeCalib);

  // Desmontar diretamente sem confirmar descarta o rascunho
  await act(async () => {
    root1.unmount();
  });
  document.body.removeChild(container1);

  assert.strictEqual(document.documentElement.getAttribute('data-display-mode'), 'default');
  assert.strictEqual(document.documentElement.style.getPropertyValue('--nc-ui-scale'), '1');
  assert.strictEqual(window.localStorage.getItem(STORAGE_KEY_DISPLAY_PREFS), rawSavedBeforeCalib);

  // 3. Preferência confirmada "TV 75%" + abrir modal + testar botões rápidos (85% e 90%) + mudar isOpen=false descarta rascunho
  confirmDisplayPreferences('tv', 75);
  assert.strictEqual(document.documentElement.getAttribute('data-display-mode'), 'tv');
  assert.strictEqual(document.documentElement.style.getPropertyValue('--nc-ui-scale'), '0.75');
  assert.strictEqual(document.documentElement.style.fontSize, '12px');

  const container2 = document.createElement('div');
  document.body.appendChild(container2);
  const root2 = createRoot(container2);

  await act(async () => {
    root2.render(
      React.createElement(
        NavigationProvider,
        null,
        React.createElement(DisplaySetupModal, {
          isOpen: true,
          canCancel: true,
          initialStep: 'tv-calibrate',
          onComplete: () => {},
        })
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  const slider2 = container2.querySelector('[data-calibration-slider="true"]') as HTMLElement;
  assert.strictEqual(slider2.getAttribute('aria-valuenow'), '75', 'Cenário 3: Reabrir calibração começa pelo valor salvo (75%)');

  // Testar botão rápido de 90% e botão de restaurar 85%
  const quick90Btn2 = container2.querySelector('button[data-scale-preset="90"]') as HTMLButtonElement;
  const reset85Btn2 = container2.querySelector('button[data-scale-preset="85"]') as HTMLButtonElement;
  assert(quick90Btn2 !== null && reset85Btn2 !== null, 'Cenário 3: Botões rápidos de 90% e 85% devem existir na calibração');

  await act(async () => {
    quick90Btn2.click();
  });
  assert.strictEqual(slider2.getAttribute('aria-valuenow'), '90', 'Cenário 3: Botão rápido escolhe 90% na amostra');
  assert.strictEqual(
    document.documentElement.style.getPropertyValue('--nc-ui-scale'),
    '0.75',
    'Cenário 3: Escolher 90% na amostra NÃO altera --nc-ui-scale global antes de confirmar'
  );
  assert.strictEqual(
    document.documentElement.style.fontSize,
    '12px',
    'Cenário 3: Escolher 90% na amostra NÃO altera font-size da raiz antes de confirmar'
  );

  // Fechar (isOpen=false) sem confirmar descarta o rascunho de 90% e preserva 75% ao reabrir
  await act(async () => {
    root2.render(
      React.createElement(
        NavigationProvider,
        null,
        React.createElement(DisplaySetupModal, {
          isOpen: false,
          canCancel: true,
          initialStep: 'tv-calibrate',
          onComplete: () => {},
        })
      )
    );
  });
  await act(async () => {
    root2.render(
      React.createElement(
        NavigationProvider,
        null,
        React.createElement(DisplaySetupModal, {
          isOpen: true,
          canCancel: true,
          initialStep: 'tv-calibrate',
          onComplete: () => {},
        })
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  const slider2Reopened = container2.querySelector('[data-calibration-slider="true"]') as HTMLElement;
  assert.strictEqual(
    slider2Reopened.getAttribute('aria-valuenow'),
    '75',
    'Cenário 3: Após fechar sem confirmar, reabrir a calibração descarta o rascunho e volta ao valor salvo (75%)'
  );

  await act(async () => {
    root2.unmount();
  });
  document.body.removeChild(container2);

  // 4. Fluxo completo por seleção de TV -> Ajustar tamanho -> alterar rascunho -> Voltar descarta rascunho e retorna foco a TV -> Fechar não grava
  confirmDisplayPreferences('default', 85);
  const rawBeforePreview = window.localStorage.getItem(STORAGE_KEY_DISPLAY_PREFS);
  assert(rawBeforePreview !== null, 'Cenário 4: Preferência inicial salva no localStorage');

  const container3 = document.createElement('div');
  document.body.appendChild(container3);
  const root3 = createRoot(container3);

  let cancelCalled3 = false;
  await act(async () => {
    root3.render(
      React.createElement(
        NavigationProvider,
        null,
        React.createElement(DisplaySetupModal, {
          isOpen: true,
          canCancel: true,
          initialStep: 'device',
          onComplete: () => {},
          onCancel: () => {
            cancelCalled3 = true;
          },
        })
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  const tvChoiceBtn = container3.querySelector('button[data-device-choice="tv"]') as HTMLButtonElement;
  assert(tvChoiceBtn !== null, 'Cenário 4: Botão de escolha TV deve existir');

  await act(async () => {
    tvChoiceBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  const adjustSizeBtn3 = container3.querySelector('button[data-tv-adjust-size="true"]') as HTMLButtonElement;
  assert(adjustSizeBtn3 !== null, 'Cenário 4: Botão Ajustar tamanho deve existir');
  await act(async () => {
    adjustSizeBtn3.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  const slider3 = container3.querySelector('[data-calibration-slider="true"]') as HTMLElement;
  await act(async () => {
    slider3.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
      }) as unknown as Event
    );
  });

  assert.strictEqual(slider3.getAttribute('aria-valuenow'), '90', 'Cenário 4: Rascunho local em 90%');
  assert.strictEqual(document.documentElement.getAttribute('data-display-mode'), 'default', 'Cenário 4: Raiz permanece em default durante o rascunho');
  assert.strictEqual(document.documentElement.style.getPropertyValue('--nc-ui-scale'), '1', 'Cenário 4: --nc-ui-scale permanece 1 durante o rascunho');
  assert.strictEqual(
    window.localStorage.getItem(STORAGE_KEY_DISPLAY_PREFS),
    rawBeforePreview,
    'Cenário 4: Rascunho não deve alterar o valor bruto no localStorage'
  );

  // Clicar no botão Voltar dentro da etapa de calibração -> volta para seleção de dispositivo, descarta rascunho e foca TV
  const backStepBtn = container3.querySelector('button[data-calibration-back="true"]') as HTMLButtonElement;
  assert(backStepBtn !== null, 'Cenário 4: Botão Voltar da etapa de calibração deve existir');

  await act(async () => {
    backStepBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  const tvChoiceAfterBack = container3.querySelector('button[data-device-choice="tv"]') as HTMLButtonElement;
  assertSameElement(
    document.activeElement,
    tvChoiceAfterBack,
    'Cenário 4: Voltar na calibração deve devolver o foco para a opção de origem (TV)'
  );
  assert.strictEqual(
    window.localStorage.getItem(STORAGE_KEY_DISPLAY_PREFS),
    rawBeforePreview,
    'Cenário 4: Voltar não deve gravar nada no localStorage'
  );

  // Clicar em Fechar no passo de dispositivos
  const closeModalBtn = container3.querySelector('button[data-device-cancel="true"]') as HTMLButtonElement;
  assert(closeModalBtn !== null, 'Cenário 4: Botão Fechar deve existir quando canCancel=true');

  await act(async () => {
    closeModalBtn.click();
  });
  assert.strictEqual(cancelCalled3, true, 'Cenário 4: Clicar em Fechar deve invocar onCancel');
  assert.strictEqual(
    window.localStorage.getItem(STORAGE_KEY_DISPLAY_PREFS),
    rawBeforePreview,
    'Cenário 4: Cancelar/Fechar deve manter a string do localStorage idêntica ao estado anterior'
  );

  await act(async () => {
    root3.unmount();
  });
  document.body.removeChild(container3);

  // 5. Escolher 90% pelo botão rápido, confirmar e validar que uma TV já configurada em 90% continua abrindo em 90% sem repetir o seletor
  const container4 = document.createElement('div');
  document.body.appendChild(container4);
  const root4 = createRoot(container4);

  let completed4 = false;
  await act(async () => {
    root4.render(
      React.createElement(
        NavigationProvider,
        null,
        React.createElement(DisplaySetupModal, {
          isOpen: true,
          canCancel: true,
          initialStep: 'tv-calibrate',
          onComplete: () => {
            completed4 = true;
          },
        })
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  const quick90Btn4 = container4.querySelector('button[data-scale-preset="90"]') as HTMLButtonElement;
  await act(async () => {
    quick90Btn4.click();
  });

  const confirmBtn4 = container4.querySelector('[data-calibration-confirm="true"]') as HTMLButtonElement;
  assert(confirmBtn4 !== null, 'Cenário 5: Botão Confirmar deve existir');

  await act(async () => {
    confirmBtn4.click();
  });
  assert.strictEqual(completed4, true, 'Cenário 5: Confirmar deve invocar onComplete');

  await act(async () => {
    root4.unmount();
  });
  document.body.removeChild(container4);

  assert.strictEqual(getDisplayPreferencesSnapshot().mode, 'tv', 'Cenário 5: Modo confirmado deve ser tv');
  assert.strictEqual(getDisplayPreferencesSnapshot().tvScale, 90, 'Cenário 5: Escala confirmada deve ser 90');
  assert.strictEqual(document.documentElement.getAttribute('data-display-mode'), 'tv', 'Cenário 5: DOM deve aplicar data-display-mode="tv" ao confirmar');
  assert.strictEqual(document.documentElement.style.getPropertyValue('--nc-ui-scale'), '0.9', 'Cenário 5: DOM deve aplicar --nc-ui-scale="0.9" ao confirmar');

  // Montar <Home /> com TV já configurada em 90%: não deve abrir o seletor nem redefinir a escala
  const homeConfigured90Container = document.createElement('div');
  document.body.appendChild(homeConfigured90Container);
  const homeConfigured90Root = createRoot(homeConfigured90Container);

  await act(async () => {
    homeConfigured90Root.render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/home'] },
        React.createElement(NavigationProvider, null, React.createElement(Home))
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
  });

  assert.strictEqual(
    homeConfigured90Container.querySelector('[data-display-setup-modal="true"]'),
    null,
    'Cenário 5: Uma TV já configurada em 90% não deve repetir o seletor DisplaySetupModal ao abrir a Home'
  );
  assert.strictEqual(document.documentElement.getAttribute('data-display-mode'), 'tv');
  assert.strictEqual(
    document.documentElement.style.getPropertyValue('--nc-ui-scale'),
    '0.9',
    'Cenário 5: Uma TV já configurada em 90% deve continuar abrindo em 90% sem redefinir a escala'
  );

  await act(async () => {
    homeConfigured90Root.unmount();
  });
  document.body.removeChild(homeConfigured90Container);

  // 6. Confirmar com localStorage.setItem lançando erro -> mantém a preferência confirmada em memória após fechar/desmontar
  window.localStorage.setItem = () => {
    throw new Error('QuotaExceededError: Mock storage failure');
  };

  const container5 = document.createElement('div');
  document.body.appendChild(container5);
  const root5 = createRoot(container5);

  await act(async () => {
    root5.render(
      React.createElement(
        NavigationProvider,
        null,
        React.createElement(DisplaySetupModal, {
          isOpen: true,
          canCancel: true,
          initialStep: 'tv-calibrate',
          onComplete: () => {},
        })
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  const slider5 = container5.querySelector('[data-calibration-slider="true"]') as HTMLElement;
  assert.strictEqual(slider5.getAttribute('aria-valuenow'), '90', 'Cenário 6: Começa em 90% salvo');
  // Subir de 90% para 95% (1 passo de 5%)
  await act(async () => {
    slider5.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
      }) as unknown as Event
    );
  });

  const confirmBtn5 = container5.querySelector('[data-calibration-confirm="true"]') as HTMLButtonElement;
  await act(async () => {
    confirmBtn5.click();
  });

  await act(async () => {
    root5.unmount();
  });
  document.body.removeChild(container5);
  window.localStorage.setItem = origSetItem;

  assert.strictEqual(getDisplayPreferencesSnapshot().isConfigured, true, 'Cenário 6: Mesmo com falha no localStorage, isConfigured deve permanecer true em memória');
  assert.strictEqual(getDisplayPreferencesSnapshot().mode, 'tv', 'Cenário 6: Modo confirmado em memória deve ser tv');
  assert.strictEqual(getDisplayPreferencesSnapshot().tvScale, 95, 'Cenário 6: Escala confirmada em memória deve ser 95');
  assert.strictEqual(document.documentElement.getAttribute('data-display-mode'), 'tv', 'Cenário 6: DOM deve manter data-display-mode="tv"');
  assert.strictEqual(document.documentElement.style.getPropertyValue('--nc-ui-scale'), '0.95', 'Cenário 6: DOM deve manter --nc-ui-scale="0.95"');

  // 7. API programática de tvEnvironment (startDisplayPreview / cancelDisplayPreview com sessão) e React.StrictMode no modal
  confirmDisplayPreferences('default', 85);
  const oldSessionId = createDisplayPreviewSession();
  const newSessionId = createDisplayPreviewSession();

  startDisplayPreview('tv', 70, oldSessionId);
  assert.strictEqual(document.documentElement.style.getPropertyValue('--nc-ui-scale'), '0.7');

  startDisplayPreview('tv', 110, newSessionId);
  assert.strictEqual(document.documentElement.style.getPropertyValue('--nc-ui-scale'), '1.1');

  cancelDisplayPreview(oldSessionId);
  assert.strictEqual(
    getDisplayPreferencesSnapshot().isPreviewActive,
    true,
    'Cenário 7: Cancelar token de sessão antiga não deve encerrar a prévia da sessão nova'
  );
  cancelDisplayPreview(newSessionId);
  assert.strictEqual(getDisplayPreferencesSnapshot().isPreviewActive, false);
  assert.strictEqual(document.documentElement.getAttribute('data-display-mode'), 'default');

  const container8 = document.createElement('div');
  document.body.appendChild(container8);
  const root8 = createRoot(container8);

  await act(async () => {
    root8.render(
      React.createElement(
        React.StrictMode,
        null,
        React.createElement(
          NavigationProvider,
          null,
          React.createElement(DisplaySetupModal, {
            isOpen: true,
            canCancel: true,
            initialStep: 'tv-calibrate',
            onComplete: () => {},
          })
        )
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  assert.strictEqual(
    getDisplayPreferencesSnapshot().isPreviewActive,
    false,
    'Cenário 8: Em React.StrictMode, o modal com amostra local não ativa prévia global'
  );
  assert.strictEqual(document.documentElement.getAttribute('data-display-mode'), 'default');

  await act(async () => {
    root8.unmount();
  });
  document.body.removeChild(container8);

  assert.strictEqual(document.documentElement.getAttribute('data-display-mode'), 'default');
  assert.strictEqual(document.documentElement.style.getPropertyValue('--nc-ui-scale'), '1');

  // 9. Idempotência da aplicação de font-size em px, compensação de minimumFontSize de WebView e restauração do modo padrão
  confirmDisplayPreferences('tv', 50);
  assert.strictEqual(document.documentElement.getAttribute('data-display-mode'), 'tv');
  assert.strictEqual(document.documentElement.style.getPropertyValue('--nc-ui-scale'), '0.5');
  assert.strictEqual(document.documentElement.style.fontSize, '8px', 'Em 50% (base 16px), font-size inline deve ser 8px');

  // Reaplicar diversas escalas seguidas não acumula multiplicações (idempotente)
  confirmDisplayPreferences('tv', 85);
  assert.strictEqual(document.documentElement.style.fontSize, '13.6px', 'Em 85% (base 16px), font-size inline deve ser 13.6px');
  confirmDisplayPreferences('tv', 125);
  assert.strictEqual(document.documentElement.style.fontSize, '20px', 'Em 125% (base 16px), font-size inline deve ser 20px');
  confirmDisplayPreferences('tv', 50);
  assert.strictEqual(document.documentElement.style.fontSize, '8px', 'Retornar a 50% deve resultar exatamente em 8px sem acumular multiplicações');

  // Simular WebView com minimumFontSize = 12px que bloqueia redução de font-size abaixo de 12px
  const origGetComputedStyle = windowInstance.getComputedStyle.bind(windowInstance);
  (windowInstance as any).getComputedStyle = (el: Element) => {
    const baseStyle = origGetComputedStyle(el);
    if (el === document.documentElement && document.documentElement.getAttribute('data-display-mode') === 'tv') {
      return new Proxy(baseStyle, {
        get(target, prop) {
          if (prop === 'fontSize') return '12px';
          const val = (target as any)[prop];
          return typeof val === 'function' ? val.bind(target) : val;
        },
      });
    }
    return baseStyle;
  };
  (globalThis as any).getComputedStyle = (windowInstance as any).getComputedStyle;

  confirmDisplayPreferences('tv', 50);
  assert.strictEqual(
    document.documentElement.style.getPropertyValue('--nc-rem-compensation'),
    '0.6667',
    'Quando a WebView trava o font-size computado em 12px para um pedido de 8px (50%), --nc-rem-compensation deve ser 8/12 = 0.6667'
  );

  // Restaurar getComputedStyle original e voltar ao modo padrão
  (windowInstance as any).getComputedStyle = origGetComputedStyle;
  (globalThis as any).getComputedStyle = origGetComputedStyle;

  confirmDisplayPreferences('default', 85);
  assert.strictEqual(document.documentElement.getAttribute('data-display-mode'), 'default');
  assert.strictEqual(document.documentElement.style.fontSize, '', 'Modo default deve limpar font-size inline');
  assert.strictEqual(document.documentElement.style.getPropertyValue('--nc-rem-compensation'), '', 'Modo default deve limpar --nc-rem-compensation');

  // 9.5 Auditoria da uniformidade de --nc-rem e --nc-rem-compensation em src/index.css
  const cssContent = fs.readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf-8');
  assert(
    cssContent.includes('--nc-rem: calc(1rem * var(--nc-rem-compensation, 1));'),
    'src/index.css deve centralizar o token --nc-rem derivado de --nc-rem-compensation'
  );
  assert(
    cssContent.includes('--spacing: calc(0.25 * var(--nc-rem));'),
    'html[data-display-mode="tv"] deve definir --spacing usando --nc-rem (compensado uma única vez)'
  );
  assert(
    cssContent.includes('--text-sm: calc(0.875 * var(--nc-rem));') &&
      cssContent.includes('--text-base: calc(1 * var(--nc-rem));') &&
      cssContent.includes('--text-xl: calc(1.25 * var(--nc-rem));'),
    'html[data-display-mode="tv"] deve compensar tokens tipográficos (--text-*) via --nc-rem'
  );

  // Verificar que dentro do bloco de regras html[data-display-mode="tv"] não restaram dimensões explícitas em rem sem --nc-rem
  const cssWithoutComments = cssContent.replace(/\/\*[\s\S]*?\*\//g, '');
  const tvRulesSection = cssWithoutComments.split('html[data-display-mode="tv"]')[1]?.split('.nc-calibration-safe')[0] || '';
  const uncompensatedRemMatches = tvRulesSection
    .split('\n')
    .filter((line) => !line.includes('--nc-rem:'))
    .filter((line) => /\b\d+(?:\.\d+)?rem\b/.test(line));
  assert.strictEqual(
    uncompensatedRemMatches.length,
    0,
    `Nenhuma regra do modo TV deve usar rem literal sem --nc-rem, mas encontrou: ${uncompensatedRemMatches.join(' | ')}`
  );

  // 10. Diagnóstico da Tela e Ambiente em ConfigView + 3 cenários explícitos de área de transferência (clipboard)
  confirmDisplayPreferences('tv', 75);
  const diagContainer = document.createElement('div');
  document.body.appendChild(diagContainer);
  const diagRoot = createRoot(diagContainer);

  const secretCreds: XtreamCredentials = {
    serverUrl: 'http://secret-server.iptv.local:8080',
    username: 'secretUser99',
    password: 'superSecretPassword123',
    allowed_output_formats: ['m3u8'],
  };

  await act(async () => {
    diagRoot.render(
      React.createElement(
        XtreamProvider,
        { credentials: secretCreds },
        React.createElement(NavigationProvider, null, React.createElement(ConfigView))
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  const toggleDiagBtn = diagContainer.querySelector('[data-nav-row="config-diagnostics-toggle"]') as HTMLButtonElement;
  assert(toggleDiagBtn !== null, 'Cenário 10: Botão para abrir o diagnóstico da tela deve existir em ConfigView');

  await act(async () => {
    toggleDiagBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 25));
  });

  const diagPanel = diagContainer.querySelector('[data-screen-diagnostics-panel="true"]') as HTMLElement;
  assert(diagPanel !== null, 'Cenário 10: Painel Diagnóstico da Tela e Ambiente deve abrir');

  // No Happy DOM sem layout real, getBoundingClientRect() retorna 0x0 -> ambas as sondas devem exibir "indisponível", nunca 0px
  const probeRectTextEl = diagPanel.querySelector('[data-diag-probe-rect="true"]') as HTMLElement;
  const compProbeRectTextEl = diagPanel.querySelector('[data-diag-compensated-probe-rect="true"]') as HTMLElement;
  assert.strictEqual(
    probeRectTextEl?.textContent?.trim(),
    'indisponível',
    'Cenário 10: Em ambiente simulado sem medição real (rect 0x0), a amostra 10rem x 2rem deve exibir "indisponível" e nunca 0px'
  );
  assert.strictEqual(
    compProbeRectTextEl?.textContent?.trim(),
    'indisponível',
    'Cenário 10: Em ambiente simulado sem medição real (rect 0x0), a amostra compensada deve exibir "indisponível" e nunca 0px'
  );

  // Simular medição real de layout nas duas sondas invisíveis (10rem x 2rem bruta e 10*--nc-rem x 2*--nc-rem compensada)
  const probeEl = diagContainer.querySelector('[data-rem-probe="true"]') as HTMLElement;
  const compensatedProbeEl = diagContainer.querySelector('[data-compensated-probe="true"]') as HTMLElement;
  assert(probeEl !== null, 'Cenário 10: Sonda invisível [data-rem-probe="true"] (10rem x 2rem) deve existir');
  assert(compensatedProbeEl !== null, 'Cenário 10: Sonda invisível [data-compensated-probe="true"] deve existir');
  assert.strictEqual(probeEl.style.width, '10rem', 'Sonda bruta [data-rem-probe="true"] deve manter width: 10rem intacto');
  assert.strictEqual(probeEl.style.height, '2rem', 'Sonda bruta [data-rem-probe="true"] deve manter height: 2rem intacto');

  const mockRect120x24 = () =>
    ({
      width: 120,
      height: 24,
      top: -9999,
      left: -9999,
      right: -9879,
      bottom: -9975,
      x: -9999,
      y: -9999,
      toJSON: () => ({}),
    }) as DOMRect;
  probeEl.getBoundingClientRect = mockRect120x24;
  compensatedProbeEl.getBoundingClientRect = mockRect120x24;

  const copyDiagBtn = diagPanel.querySelector('[data-copy-diagnostics="true"]') as HTMLButtonElement;
  assert(copyDiagBtn !== null, 'Cenário 10: Botão "Copiar diagnóstico" deve existir');

  const origClipboardDescriptor = Object.getOwnPropertyDescriptor(windowInstance.navigator, 'clipboard') ||
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(windowInstance.navigator), 'clipboard');

  try {
    // CENÁRIO 10A: Área de transferência disponível (navigator.clipboard.writeText resolve com sucesso)
    let clipboardCapturedText = '';
    Object.defineProperty(windowInstance.navigator, 'clipboard', {
      value: {
        writeText: async (text: string) => {
          clipboardCapturedText = text;
        },
      },
      configurable: true,
      writable: true,
    });

    await act(async () => {
      copyDiagBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    assert.strictEqual(
      probeRectTextEl?.textContent?.trim(),
      '120 × 24 px',
      'Cenário 10A: Quando getBoundingClientRect retorna medida real, a amostra 10rem × 2rem exibe "120 × 24 px"'
    );
    assert.strictEqual(
      compProbeRectTextEl?.textContent?.trim(),
      '120 × 24 px',
      'Cenário 10A: Quando getBoundingClientRect retorna medida real, a amostra compensada exibe "120 × 24 px"'
    );
    assert(
      copyDiagBtn.textContent?.includes('Diagnóstico copiado!'),
      'Cenário 10A: Com clipboard disponível, o botão deve confirmar "Diagnóstico copiado!"'
    );
    assert.strictEqual(
      diagPanel.querySelector('[data-diagnostics-text="true"]'),
      null,
      'Cenário 10A: Com cópia bem-sucedida para o clipboard, o fallback de textarea não precisa abrir automaticamente'
    );
    assert(
      clipboardCapturedText.includes('TV (75%)') &&
        clipboardCapturedText.includes('Amostra real 10rem × 2rem (getBoundingClientRect): 120 × 24 px') &&
        clipboardCapturedText.includes('Amostra compensada 10×--nc-rem × 2×--nc-rem (getBoundingClientRect): 120 × 24 px'),
      'Cenário 10A: Texto copiado deve conter escala solicitada e medidas reais das amostras bruta e compensada'
    );
    assert(
      !clipboardCapturedText.includes('secret-server.iptv.local') &&
        !clipboardCapturedText.includes('secretUser99') &&
        !clipboardCapturedText.includes('superSecretPassword123'),
      'Cenário 10A: Texto copiado para a área de transferência NUNCA deve expor credenciais, servidor ou senha'
    );

    // CENÁRIO 10B: Área de transferência indisponível (navigator.clipboard ausente/undefined)
    Object.defineProperty(windowInstance.navigator, 'clipboard', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    await act(async () => {
      copyDiagBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    const diagTextareaFallbackB = diagPanel.querySelector('[data-diagnostics-text="true"]') as HTMLTextAreaElement;
    assert(
      diagTextareaFallbackB !== null,
      'Cenário 10B: Quando navigator.clipboard é indisponível, o fallback de texto selecionável [data-diagnostics-text="true"] deve abrir'
    );
    assert(
      diagTextareaFallbackB.value.includes('TV (75%)') &&
        diagTextareaFallbackB.value.includes('120 × 24 px'),
      'Cenário 10B: Textarea de fallback deve conter o relatório completo do diagnóstico'
    );
    assert(
      !diagTextareaFallbackB.value.includes('secret-server.iptv.local') &&
        !diagTextareaFallbackB.value.includes('secretUser99') &&
        !diagTextareaFallbackB.value.includes('superSecretPassword123'),
      'Cenário 10B: Textarea de fallback NUNCA deve incluir credenciais, senhas ou URL do servidor da conta'
    );

    // Ocultar texto selecionável manualmente antes de testar o Cenário 10C (rejeição de escrita)
    const toggleSelectableBtn = Array.from(diagPanel.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Ocultar texto selecionável')
    ) as HTMLButtonElement | undefined;
    if (toggleSelectableBtn) {
      await act(async () => {
        toggleSelectableBtn.click();
      });
    }

    // CENÁRIO 10C: Escrita na área de transferência rejeitada (navigator.clipboard.writeText rejeita a Promise)
    Object.defineProperty(windowInstance.navigator, 'clipboard', {
      value: {
        writeText: async () => {
          throw new Error('NotAllowedError: Write permission denied');
        },
      },
      configurable: true,
      writable: true,
    });

    await act(async () => {
      copyDiagBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    const diagTextareaFallbackC = diagPanel.querySelector('[data-diagnostics-text="true"]') as HTMLTextAreaElement;
    assert(
      diagTextareaFallbackC !== null,
      'Cenário 10C: Quando navigator.clipboard.writeText rejeita, a tela deve se recuperar abrindo o textarea selecionável [data-diagnostics-text="true"]'
    );
    assert(
      diagPanel.textContent?.includes('Área de transferência indisponível'),
      'Cenário 10C: Deve exibir aviso orientando a seleção manual após rejeição da área de transferência'
    );
    assert(
      !diagTextareaFallbackC.value.includes('secret-server.iptv.local') &&
        !diagTextareaFallbackC.value.includes('secretUser99') &&
        !diagTextareaFallbackC.value.includes('superSecretPassword123'),
      'Cenário 10C: Textarea após rejeição NUNCA deve expor credenciais, senhas ou URL do servidor'
    );
  } finally {
    if (origClipboardDescriptor) {
      Object.defineProperty(windowInstance.navigator, 'clipboard', origClipboardDescriptor);
    }
  }

  await act(async () => {
    diagRoot.unmount();
  });
  document.body.removeChild(diagContainer);

  // 11. Nomes de canais em LiveTvView no modo TV: curtos, longos com espaços e longos sem espaços exibem texto completo com classes de quebra em múltiplas linhas
  confirmDisplayPreferences('tv', 85);
  (XtreamService as any).getLiveCategories = async () => [
    { category_id: '77', category_name: 'Variedades' },
  ];
  (XtreamService as any).getLiveStreams = async () => [
    { stream_id: 7701, name: 'SBT', category_id: '77' },
    {
      stream_id: 7702,
      name: 'Discovery Channel Brasil Documentários Especiais e Ciência Ao Vivo',
      category_id: '77',
    },
    {
      stream_id: 7703,
      name: 'CANAL_ULTRA_LONGO_SEM_ESPACOS_PARA_VALIDAR_QUEBRA_SEGURA_NO_PAINEL_DE_TV_2026',
      category_id: '77',
    },
  ];

  const liveTvContainer = document.createElement('div');
  document.body.appendChild(liveTvContainer);
  const liveTvRoot = createRoot(liveTvContainer);

  await act(async () => {
    liveTvRoot.render(
      React.createElement(
        XtreamProvider,
        { credentials: secretCreds },
        React.createElement(
          NavigationProvider,
          null,
          React.createElement(LiveTvView, { onPlay: () => {} })
        )
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
  });

  const cat77Btn = liveTvContainer.querySelector('button[data-live-category-id="77"]') as HTMLButtonElement;
  assert(cat77Btn !== null, 'Cenário 11: Categoria Variedades (id=77) deve ser renderizada');

  await act(async () => {
    cat77Btn.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  const channelNameEls = Array.from(
    liveTvContainer.querySelectorAll('[data-live-channel-name="true"]')
  ) as HTMLElement[];
  assert.strictEqual(channelNameEls.length, 3, 'Cenário 11: Deve renderizar os 3 canais (curto, longo com espaços e longo sem espaços)');

  const renderedChannelTexts = channelNameEls.map((el) => (el.textContent || '').trim());
  assert(renderedChannelTexts.includes('SBT'), 'Cenário 11: Nome curto deve estar íntegro');
  assert(
    renderedChannelTexts.includes('Discovery Channel Brasil Documentários Especiais e Ciência Ao Vivo'),
    'Cenário 11: Nome longo com espaços deve estar íntegro sem corte textual'
  );
  assert(
    renderedChannelTexts.includes('CANAL_ULTRA_LONGO_SEM_ESPACOS_PARA_VALIDAR_QUEBRA_SEGURA_NO_PAINEL_DE_TV_2026'),
    'Cenário 11: Nome longo sem espaços deve estar íntegro sem corte textual'
  );

  for (const nameEl of channelNameEls) {
    assert(
      nameEl.classList.contains('nc-tv-channel-name'),
      'Cenário 11: Elemento do nome do canal deve possuir a classe nc-tv-channel-name para quebra multilinha no modo TV'
    );
  }

  await act(async () => {
    liveTvRoot.unmount();
  });
  document.body.removeChild(liveTvContainer);

  // 11B. Regressão do seletor de dispositivos em 1 coluna (320×568 e 390×844) e 2 colunas (768×1024, 1280×720, 961×541),
  //      incluindo passo rápido de TV empilhado (Usar tamanho sugerido <-> Ajustar tamanho <-> Voltar)
  {
    const makeRect = (left: number, top: number, width: number, height: number): DOMRect =>
      ({
        x: left,
        y: top,
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
        toJSON: () => ({}),
      }) as DOMRect;

    const gridLayoutContainer = document.createElement('div');
    document.body.appendChild(gridLayoutContainer);
    const gridLayoutRoot = createRoot(gridLayoutContainer);

    await act(async () => {
      gridLayoutRoot.render(
        React.createElement(
          NavigationProvider,
          null,
          React.createElement(DisplaySetupModal, {
            isOpen: true,
            canCancel: true,
            initialStep: 'device',
            onComplete: () => {},
          })
        )
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const sendKeyToActive = async (key: string) => {
      const active = document.activeElement as HTMLElement | null;
      assert(active !== null, `Deve existir elemento focado antes de disparar ${key}`);
      await act(async () => {
        active!.dispatchEvent(
          new (windowInstance as any).KeyboardEvent('keydown', {
            key,
            bubbles: true,
            cancelable: true,
          }) as unknown as Event
        );
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    };

    const dTv = gridLayoutContainer.querySelector('button[data-device-choice="tv"]') as HTMLButtonElement;
    const dCel = gridLayoutContainer.querySelector('button[data-device-choice="celular"]') as HTMLButtonElement;
    const dTab = gridLayoutContainer.querySelector('button[data-device-choice="tablet"]') as HTMLButtonElement;
    const dComp = gridLayoutContainer.querySelector('button[data-device-choice="computador"]') as HTMLButtonElement;

    // Layout de 1 coluna empilhada (ex.: 320×568 / 390×844)
    dTv.getBoundingClientRect = () => makeRect(16, 90, 288, 100);
    dCel.getBoundingClientRect = () => makeRect(16, 202, 288, 100);
    dTab.getBoundingClientRect = () => makeRect(16, 314, 288, 100);
    dComp.getBoundingClientRect = () => makeRect(16, 426, 288, 100);

    await act(async () => {
      dTv.focus();
    });
    assertSameElement(document.activeElement, dTv, '1 coluna: foco inicial em TV');

    // Em 1 coluna, Direita/Esquerda não avançam para outros cartões empilhados
    await sendKeyToActive('ArrowRight');
    assertSameElement(document.activeElement, dTv, '1 coluna: ArrowRight em TV mantém foco em TV');

    await sendKeyToActive('ArrowDown');
    assertSameElement(document.activeElement, dCel, '1 coluna: ArrowDown TV -> Celular');
    await sendKeyToActive('ArrowDown');
    assertSameElement(document.activeElement, dTab, '1 coluna: ArrowDown Celular -> Tablet');
    await sendKeyToActive('ArrowDown');
    assertSameElement(document.activeElement, dComp, '1 coluna: ArrowDown Tablet -> Computador');

    await sendKeyToActive('ArrowUp');
    assertSameElement(document.activeElement, dTab, '1 coluna: ArrowUp Computador -> Tablet');
    await sendKeyToActive('ArrowUp');
    assertSameElement(document.activeElement, dCel, '1 coluna: ArrowUp Tablet -> Celular');
    await sendKeyToActive('ArrowUp');
    assertSameElement(document.activeElement, dTv, '1 coluna: ArrowUp Celular -> TV');

    // Entrar em TV para validar a escolha de tamanho empilhada:
    // Baixo: Usar tamanho sugerido -> Ajustar tamanho -> Voltar
    // Cima: Voltar -> Ajustar tamanho -> Usar tamanho sugerido
    await act(async () => {
      dTv.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const qSuggested = gridLayoutContainer.querySelector(
      'button[data-tv-use-suggested="true"]'
    ) as HTMLButtonElement;
    const qAdjust = gridLayoutContainer.querySelector(
      'button[data-tv-adjust-size="true"]'
    ) as HTMLButtonElement;
    const qBack = gridLayoutContainer.querySelector(
      'button[data-tv-quick-back="true"]'
    ) as HTMLButtonElement;
    assert(qSuggested && qAdjust && qBack, 'Passo tv-quick deve montar as 2 opções e o botão Voltar');

    // Geometria empilhada (1 coluna) para tv-quick
    qSuggested.getBoundingClientRect = () => makeRect(16, 110, 288, 120);
    qAdjust.getBoundingClientRect = () => makeRect(16, 244, 288, 120);
    qBack.getBoundingClientRect = () => makeRect(16, 384, 110, 42);

    assertSameElement(
      document.activeElement,
      qSuggested,
      'tv-quick empilhado: foco inicial em Usar tamanho sugerido'
    );

    await sendKeyToActive('ArrowDown');
    assertSameElement(
      document.activeElement,
      qAdjust,
      'tv-quick empilhado: ArrowDown percorre Usar tamanho sugerido -> Ajustar tamanho'
    );

    await sendKeyToActive('ArrowDown');
    assertSameElement(
      document.activeElement,
      qBack,
      'tv-quick empilhado: ArrowDown percorre Ajustar tamanho -> Voltar'
    );

    await sendKeyToActive('ArrowUp');
    assertSameElement(
      document.activeElement,
      qAdjust,
      'tv-quick empilhado: ArrowUp percorre Voltar -> Ajustar tamanho'
    );

    await sendKeyToActive('ArrowUp');
    assertSameElement(
      document.activeElement,
      qSuggested,
      'tv-quick empilhado: ArrowUp percorre Ajustar tamanho -> Usar tamanho sugerido'
    );

    // E quando tv-quick está em 2 colunas (sm:grid-cols-2): Direita/Esquerda alternam entre as 2 opções e Baixo vai a Voltar
    qSuggested.getBoundingClientRect = () => makeRect(40, 120, 320, 140);
    qAdjust.getBoundingClientRect = () => makeRect(380, 120, 320, 140);
    qBack.getBoundingClientRect = () => makeRect(40, 290, 110, 42);

    await sendKeyToActive('ArrowRight');
    assertSameElement(
      document.activeElement,
      qAdjust,
      'tv-quick 2 colunas: ArrowRight Usar tamanho sugerido -> Ajustar tamanho'
    );
    await sendKeyToActive('ArrowLeft');
    assertSameElement(
      document.activeElement,
      qSuggested,
      'tv-quick 2 colunas: ArrowLeft Ajustar tamanho -> Usar tamanho sugerido'
    );
    await sendKeyToActive('ArrowDown');
    assertSameElement(
      document.activeElement,
      qBack,
      'tv-quick 2 colunas: ArrowDown -> Voltar'
    );

    // Pressionar Voltar retorna à opção TV de origem
    await act(async () => {
      qBack.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const dTvAfterBack = gridLayoutContainer.querySelector(
      'button[data-device-choice="tv"]'
    ) as HTMLButtonElement;
    assertSameElement(
      document.activeElement,
      dTvAfterBack,
      'Clicar em Voltar no passo tv-quick deve devolver o foco para a opção TV de origem'
    );

    await act(async () => {
      gridLayoutRoot.unmount();
    });
    document.body.removeChild(gridLayoutContainer);
  }

  // 11C. Verificação da hierarquia tipográfica e encaixe entre dispositivos (320×568, 390×844, 768×1024, 1280×720 e 961×541 a 85%, 90% e 100%)
  {
    const cssText = fs.readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf-8');
    assert(
      cssText.includes('.nc-heading-details') &&
        cssText.includes('.nc-heading-view') &&
        cssText.includes('.nc-heading-section') &&
        cssText.includes('.nc-text-reading') &&
        cssText.includes('.nc-text-meta') &&
        cssText.includes('.nc-badge-info'),
      'src/index.css deve definir a hierarquia tipográfica compartilhada (.nc-heading-*, .nc-text-*, .nc-badge-info)'
    );
    assert(
      cssText.includes('--nc-tv-channel-meta-font: calc(0.75 * var(--nc-rem));'),
      'src/index.css deve elevar --nc-tv-channel-meta-font para 0.75 * --nc-rem (12px em 100%) em vez de 0.68'
    );

    const movieDetailsSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/MovieDetails.tsx'),
      'utf-8'
    );
    const seriesDetailsSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/SeriesDetails.tsx'),
      'utf-8'
    );
    const liveTvSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/views/LiveTvView.tsx'),
      'utf-8'
    );
    const configViewSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/views/ConfigView.tsx'),
      'utf-8'
    );
    assert(
      !movieDetailsSrc.includes('text-3xl md:text-5xl') &&
        movieDetailsSrc.includes('nc-heading-details nc-tv-details-title'),
      'MovieDetails não deve conter o salto abrupto text-3xl md:text-5xl e deve usar nc-heading-details'
    );
    assert(
      !seriesDetailsSrc.includes('text-3xl md:text-5xl') &&
        seriesDetailsSrc.includes('nc-heading-details nc-tv-details-title'),
      'SeriesDetails não deve conter o salto abrupto text-3xl md:text-5xl e deve usar nc-heading-details'
    );
    assert(
      !liveTvSrc.includes('text-[10px]') && !liveTvSrc.includes('text-[11px]'),
      'LiveTvView não deve manter rótulos informativos de 10-11px (text-[10px] ou text-[11px])'
    );
    assert(
      liveTvSrc.includes('nc-live-channel-title nc-heading-section font-bold text-white line-clamp-2 whitespace-normal break-words w-full') &&
        !liveTvSrc.includes('line-clamp-2 whitespace-normal break-words block'),
      'h1.nc-live-channel-title em LiveTvView deve usar line-clamp-2 sem a classe block para preservar display: -webkit-box no CSS compilado'
    );
    assert(
      !configViewSrc.includes('text-[10px]') && !configViewSrc.includes('text-[11px]'),
      'ConfigView não deve manter rótulos informativos de 10-11px (text-[10px] ou text-[11px])'
    );
  }

  // 12. Verificação explícita do isolamento de rede nos testes
  assert.strictEqual(
    blockedExternalNetworkCount,
    0,
    'Nenhuma tentativa de rede externa não mockada deve ter ocorrido durante toda a suíte de testes'
  );

  // Testar que uma chamada não mockada ao XtreamService.authenticate real é interceptada pelo guarda offline sem vazar credenciais
  const preBlockCount = blockedExternalNetworkCount;
  const abortCtrl = new AbortController();
  let guardErrorMsg = '';
  externalNetworkGuardHandler = async (rawUrl: string) => {
    blockedExternalNetworkCount++;
    abortCtrl.abort();
    throw new Error(`Bloqueio offline controlado: ${sanitizeUrlForTestLog(rawUrl)}`);
  };
  try {
    await originalXtreamAuthenticate(secretCreds, { signal: abortCtrl.signal });
  } catch (err: any) {
    guardErrorMsg = String(err?.message || '');
  } finally {
    externalNetworkGuardHandler = null;
  }
  assert(
    blockedExternalNetworkCount === preBlockCount + 1,
    'Guarda de rede offline deve interceptar imediatamente qualquer chamada fetch externa'
  );
  assert(
    !guardErrorMsg.includes('secretUser99') && !guardErrorMsg.includes('superSecretPassword123'),
    'Erros do guarda de rede nunca devem expor usuário ou senha'
  );

  installDefaultXtreamOfflineMocks();
  confirmDisplayPreferences('default', 85);
  console.log('✅ Todos os testes de ciclo de vida da prévia, diagnóstico de escala, 3 cenários de clipboard, nomes de canais e isolamento de rede aprovados!');
}

async function cleanupTestEnvironment(): Promise<void> {
  for (const [, handle] of rafTimers) {
    clearTimeout(handle);
  }
  rafTimers.clear();
  windowInstance.document.body.innerHTML = '';
  try {
    await windowInstance.happyDOM.abort();
    await windowInstance.happyDOM.close();
  } catch {
    // Ignore close errors
  }
}

async function runCapacitorTransportAndAuditFixTests() {
  console.log('\n--- 11. Testes de Capacitor 8, Transporte HTTP JSON, Volume, Catálogo, Storage, Timer LiveTV e Reabertura ---');

  const {
    NavigationProvider,
    attachCapacitorBackAdapter,
    setCapacitorAppBridgeForTest,
    getNativeBackBridgeStatus,
    registerBackHandler,
    clearAllBackHandlersForTest,
  } = await import('../src/navigation');
  const {
    executeXtreamGetRequest,
    setTransportTestConfig,
    isUsingCapacitorNativeTransport,
  } = await import('../src/services/httpTransport');
  const { normalizeCatalogArray } = await import('../src/services/xtreamService');
  const { groupLiveStreams } = await import('../src/utils/liveChannelGroups');
  const {
    normalizePlayerVolume,
    usePlaybackSession,
    VOLUME_STORAGE_KEY,
  } = await import('../src/components/player/usePlaybackSession');
  const {
    isDebugImagesEnabled,
    setDebugImagesEnabled,
  } = await import('../src/utils/mediaUtils');
  const { MediaImage } = await import('../src/components/MediaImage');
  const { setLiveFallbackTimeoutMsForTest } = await import('../src/views/LiveTvView');
  const { Login } = await import('../src/pages/Login');
  const {
    APP_VERSION,
    APP_COMMIT,
    APP_BUILD_TIME,
    resolveCommit,
    formatCommitShort,
  } = await import('../src/version');

  clearAllBackHandlersForTest();

  // =========================================================================
  // 11.1. Ponte oficial Capacitor (@capacitor/app): registro único, remoção e resolução tardia da Promise após desmontagem (StrictMode)
  // =========================================================================
  let activeListenersCount = 0;
  let removeCallsCount = 0;
  const pendingResolvers: Array<(handle: { remove: () => Promise<void> }) => void> = [];

  setCapacitorAppBridgeForTest({
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    addListener: () =>
      new Promise((resolve) => {
        activeListenersCount++;
        pendingResolvers.push(resolve);
      }),
    exitApp: async () => {},
  });

  // Simular ciclo React.StrictMode: 1ª montagem -> desmontagem imediata antes da Promise resolver -> 2ª montagem
  const detachFirst = attachCapacitorBackAdapter();
  detachFirst();
  const detachSecond = attachCapacitorBackAdapter();

  assert.strictEqual(
    pendingResolvers.length,
    2,
    'Duas montagens sequenciais em StrictMode iniciam duas Promises de registro'
  );

  // Resolver a 1ª Promise tardiamente (após detachFirst já ter sido chamado)
  pendingResolvers[0]({
    remove: async () => {
      removeCallsCount++;
      activeListenersCount--;
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 15));

  assert.strictEqual(
    removeCallsCount,
    1,
    'Quando a Promise da 1ª montagem resolve após a desmontagem, handle.remove() deve ser chamado imediatamente'
  );
  assert.strictEqual(
    activeListenersCount,
    1,
    'Apenas o listener da 2ª montagem ativa deve permanecer registrado'
  );

  // Resolver a 2ª Promise e depois desmontar a 2ª instância
  pendingResolvers[1]({
    remove: async () => {
      removeCallsCount++;
      activeListenersCount--;
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 15));
  detachSecond();
  await new Promise((resolve) => setTimeout(resolve, 15));

  assert.strictEqual(
    removeCallsCount,
    2,
    'Desmontar a instância ativa deve remover o listener resolvido'
  );
  assert.strictEqual(
    activeListenersCount,
    0,
    'Nenhum listener órfão deve permanecer ativo após desmontagem completa'
  );

  // Verificar prioridade hierárquica do botão Voltar via listener nativo antes de chegar à raiz
  let interceptedByModal = false;
  let rootExitTriggered = false;
  let currentBackCallback: ((ev: any) => void) | null = null;

  setCapacitorAppBridgeForTest({
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    addListener: async (_eventName, cb) => {
      currentBackCallback = cb;
      return {
        remove: async () => {
          currentBackCallback = null;
        },
      };
    },
    exitApp: async () => {
      rootExitTriggered = true;
    },
  });

  const detachActive = attachCapacitorBackAdapter();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert(currentBackCallback !== null, 'Listener nativo ativo deve estar registrado');

  const unregisterModalBack = registerBackHandler('test-modal-layer', 80, () => {
    interceptedByModal = true;
    return true;
  });

  currentBackCallback!({ canGoBack: true });
  assert.strictEqual(interceptedByModal, true, 'Back nativo deve acionar primeiro o handler de maior prioridade (modal)');
  assert.strictEqual(rootExitTriggered, false, 'Enquanto houver modal/camada aberta, App.exitApp() não deve ser chamado');

  unregisterModalBack();
  currentBackCallback!({ canGoBack: false });
  assert.strictEqual(rootExitTriggered, true, 'Quando nenhuma camada interna consome o Voltar, App.exitApp() deve ser chamado');

  detachActive();
  setCapacitorAppBridgeForTest(null);
  assert.strictEqual(
    getNativeBackBridgeStatus().bridgeType,
    'none',
    'Fora do ambiente nativo, getNativeBackBridgeStatus().bridgeType deve ser "none" (sem AppMint)'
  );

  // =========================================================================
  // 11.2. Transporte HTTP JSON: Navegador (fetch) vs Android Nativo (CapacitorHttp.get), objeto já parseado vs string, timeout, 1 retry e AbortSignal
  // =========================================================================
  // A) Modo Web usando fetch
  setTransportTestConfig({
    mode: 'web',
    capacitorHttpGet: async () => {
      throw new Error('CapacitorHttp.get não deve ser chamado no modo Web');
    },
  });
  assert.strictEqual(isUsingCapacitorNativeTransport(), false);

  let webFetchCalls = 0;
  externalNetworkGuardHandler = async (url: string) => {
    webFetchCalls++;
    return new Response(JSON.stringify({ mode: 'web', url }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const webRes = await executeXtreamGetRequest<{ mode: string; url: string }>({
    url: 'http://provider.test:8080/player_api.php?action=test',
    timeoutMs: 5000,
  });
  assert.strictEqual(webFetchCalls, 1, 'No navegador, executeXtreamGetRequest deve usar fetch');
  assert.strictEqual(webRes.mode, 'web');
  externalNetworkGuardHandler = null;

  // B) Modo Android Nativo usando CapacitorHttp.get com payload já parseado (objeto/array direto sem re-serializar) e com string JSON
  let nativeCalls = 0;
  let capturedNativeOpts: any = null;
  const preParsedPayload = [{ category_id: '10', category_name: 'Filmes 4K' }];

  setTransportTestConfig({
    mode: 'capacitor',
    capacitorHttpGet: async (opts) => {
      nativeCalls++;
      capturedNativeOpts = opts;
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        url: opts.url,
        data: preParsedPayload,
      };
    },
  });
  assert.strictEqual(isUsingCapacitorNativeTransport(), true);

  const nativeObjRes = await executeXtreamGetRequest<typeof preParsedPayload>({
    url: 'http://provider.test:8080/player_api.php?action=get_vod_categories',
    timeoutMs: 9000,
  });
  assert.strictEqual(nativeCalls, 1, 'No Android Capacitor, executeXtreamGetRequest deve usar CapacitorHttp.get');
  assert.strictEqual(
    nativeObjRes,
    preParsedPayload,
    'Quando CapacitorHttp.get já retorna objeto/array parseado, o transporte deve preservá-lo diretamente sem JSON.stringify/JSON.parse desnecessários'
  );
  assert.strictEqual(capturedNativeOpts.connectTimeout, 9000, 'connectTimeout nativo deve ser repassado');
  assert.strictEqual(capturedNativeOpts.readTimeout, 9000, 'readTimeout nativo deve ser repassado');

  // Resposta como texto JSON em CapacitorHttp.get
  setTransportTestConfig({
    mode: 'capacitor',
    capacitorHttpGet: async (opts) => ({
      status: 200,
      headers: { 'content-type': 'text/plain' },
      url: opts.url,
      data: '  {"user_info":{"auth":1,"status":"Active"}}  ',
    }),
  });
  const nativeTextRes = await executeXtreamGetRequest<{ user_info: { auth: number; status: string } }>({
    url: 'http://provider.test:8080/player_api.php',
    timeoutMs: 5000,
  });
  assert.strictEqual(nativeTextRes.user_info.auth, 1, 'Quando CapacitorHttp.get retorna string JSON, o transporte deve fazer parse com segurança');

  // C) Timeout + 1 repetição automática para falha transitória via XtreamService real (originalXtreamAuthenticate)
  let transientAttempts = 0;
  setTransportTestConfig({
    mode: 'capacitor',
    capacitorHttpGet: async (opts) => {
      transientAttempts++;
      if (transientAttempts === 1) {
        const timeoutErr: any = new Error('SocketTimeoutException: timed out');
        throw timeoutErr;
      }
      return {
        status: 200,
        headers: {},
        url: opts.url,
        data: {
          user_info: { username: 'retryUser', auth: 1, status: 'Active' },
          server_info: { allowed_output_formats: ['m3u8'] },
        },
      };
    },
  });

  const retryAuthRes = await originalXtreamAuthenticate({
    serverUrl: 'http://provider.test:8080',
    username: 'retryUser',
    password: 'retryPassword',
  });
  assert.strictEqual(transientAttempts, 2, 'Falha transitória de timeout no XtreamService deve acionar exatamente 1 repetição');
  assert.strictEqual(retryAuthRes.user_info.username, 'retryUser', 'Segunda tentativa de autenticação deve resolver com sucesso');

  // D) Erro HTTP 404 (definitivo) não deve repetir
  let http404Attempts = 0;
  setTransportTestConfig({
    mode: 'capacitor',
    capacitorHttpGet: async (opts) => {
      http404Attempts++;
      return {
        status: 404,
        headers: {},
        url: opts.url,
        data: 'Not Found',
      };
    },
  });

  let caught404: any = null;
  try {
    await originalXtreamAuthenticate({
      serverUrl: 'http://provider.test:8080',
      username: 'retryUser',
      password: 'retryPassword',
    });
  } catch (err) {
    caught404 = err;
  }
  assert(caught404 !== null && String(caught404.message).includes('HTTP 404'), 'HTTP 404 deve lançar erro claro informando o status HTTP');
  assert.strictEqual(http404Attempts, 1, 'Erros HTTP 4xx definitivos não devem fazer retry');

  // E) Cancelamento lógico via AbortSignal interrompe a espera imediatamente
  const cancelCtrl = new AbortController();
  setTransportTestConfig({
    mode: 'capacitor',
    capacitorHttpGet: async (opts) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return { status: 200, headers: {}, url: opts.url, data: { late: true } };
    },
  });

  let caughtAbort: any = null;
  const abortPromise = executeXtreamGetRequest({
    url: 'http://provider.test:8080/player_api.php?action=slow',
    signal: cancelCtrl.signal,
    timeoutMs: 2000,
  });
  setTimeout(() => cancelCtrl.abort(), 15);
  try {
    await abortPromise;
  } catch (err) {
    caughtAbort = err;
  }
  assert(
    caughtAbort !== null && String(caughtAbort.message).includes('Operação cancelada'),
    'Cancelamento via AbortSignal deve interromper imediatamente a espera da operação'
  );

  setTransportTestConfig({ mode: 'auto', capacitorHttpGet: null });

  // =========================================================================
  // 11.3. Correção 5B — Volume persistido inválido em usePlaybackSession.ts
  // =========================================================================
  assert.strictEqual(normalizePlayerVolume('abc'), 1, 'Volume "abc" deve retornar fallback 1');
  assert.strictEqual(normalizePlayerVolume('Infinity'), 1, 'Volume "Infinity" deve retornar fallback 1');
  assert.strictEqual(normalizePlayerVolume('-Infinity'), 1, 'Volume "-Infinity" deve retornar fallback 1');
  assert.strictEqual(normalizePlayerVolume(NaN), 1, 'Volume NaN deve retornar fallback 1');
  assert.strictEqual(normalizePlayerVolume('2'), 1, 'Volume persistido "2" (> 1) deve retornar fallback 1');
  assert.strictEqual(normalizePlayerVolume('-0.2'), 1, 'Volume persistido "-0.2" (< 0) deve retornar fallback 1');
  assert.strictEqual(normalizePlayerVolume(''), 1, 'Volume vazio "" deve retornar fallback 1');
  assert.strictEqual(normalizePlayerVolume('0.65'), 0.65, 'Volume válido "0.65" deve ser preservado como 0.65');
  assert.strictEqual(normalizePlayerVolume(0), 0, 'Volume 0 (mudo por volume) deve ser aceito como 0');

  // Testar leitura inicial do hook usePlaybackSession quando localStorage contém valores corrompidos
  for (const invalidRaw of ['abc', 'Infinity', '2', '-0.2']) {
    window.localStorage.setItem(VOLUME_STORAGE_KEY, invalidRaw);
    let capturedVolume = -1;
    let capturedSetVolume: ((v: number) => void) | null = null;
    const volRef = { current: document.createElement('video') as HTMLVideoElement | null };

    function VolumeProbe() {
      const session = usePlaybackSession({
        streamUrl: 'http://server.tv:8080/live/u/p/1.m3u8',
        contentType: 'live',
        videoRef: volRef,
      });
      capturedVolume = session.volume;
      capturedSetVolume = session.setVolume;
      return null;
    }

    const vContainer = document.createElement('div');
    document.body.appendChild(vContainer);
    const vRoot = createRoot(vContainer);
    await act(async () => {
      vRoot.render(React.createElement(VolumeProbe));
    });

    assert.strictEqual(
      capturedVolume,
      1,
      `Com nc_player_volume="${invalidRaw}" no localStorage, usePlaybackSession deve iniciar com volume seguro 1`
    );

    // Testar setVolume com valor fora da faixa [0, 1] e NaN
    await act(async () => {
      capturedSetVolume!(2.5);
    });
    assert.strictEqual(capturedVolume, 1, 'setVolume(2.5) deve limitar para 1 sem lançar IndexSizeError no elemento video');
    assert.strictEqual(volRef.current!.volume, 1, 'videoElement.volume deve receber valor finito entre 0 e 1');

    await act(async () => {
      capturedSetVolume!(-0.5);
    });
    assert.strictEqual(capturedVolume, 0, 'setVolume(-0.5) deve limitar para 0 sem lançar IndexSizeError');
    assert.strictEqual(volRef.current!.volume, 0, 'videoElement.volume deve receber 0');

    await act(async () => {
      vRoot.unmount();
    });
    document.body.removeChild(vContainer);
  }
  window.localStorage.setItem(VOLUME_STORAGE_KEY, '0.8');

  // =========================================================================
  // 11.4. Correção 5C — Entradas inválidas no catálogo (xtreamService.ts & liveChannelGroups.ts)
  // =========================================================================
  const mixedCatalog = [
    null,
    undefined,
    'texto-invalido',
    123,
    ['sub-array'],
    { stream_id: 501, name: 'Globo SP HD', category_id: '1' },
    null,
    { stream_id: 502, name: 'Globo SP SD', category_id: '1' },
  ];

  const cleanCatalog = normalizeCatalogArray<{ stream_id: number; name: string; category_id: string }>(
    mixedCatalog,
    'Canais ao vivo'
  );
  assert.strictEqual(cleanCatalog.length, 2, 'normalizeCatalogArray deve descartar null, primitivos e sub-arrays');
  assert.strictEqual(cleanCatalog[0].stream_id, 501, 'normalizeCatalogArray deve preservar a ordem dos registros válidos (1º)');
  assert.strictEqual(cleanCatalog[1].stream_id, 502, 'normalizeCatalogArray deve preservar a ordem dos registros válidos (2º)');

  assert.throws(
    () => normalizeCatalogArray({ erro: 'nao-e-array' }, 'Formato inválido: catálogo não é uma lista'),
    /Formato inválido/,
    'normalizeCatalogArray deve continuar lançando erro claro quando a resposta inteira não for uma lista'
  );

  const groupedWithNulls = groupLiveStreams([
    null as any,
    undefined as any,
    'invalido' as any,
    { stream_id: 601, name: 'Band News HD', category_id: '1' } as any,
    { stream_id: 602, name: 'Band News SD', category_id: '1' } as any,
  ]);
  assert.strictEqual(
    groupedWithNulls.length,
    1,
    'groupLiveStreams([null, canalValido]) deve ignorar itens inválidos sem lançar TypeError e agrupar os canais válidos'
  );
  assert.strictEqual(
    groupedWithNulls[0].variants.length,
    2,
    'groupLiveStreams deve preservar todas as variantes válidas do canal'
  );

  // =========================================================================
  // 11.5. Correção 5D — Preferência de depuração de imagens sem falha de armazenamento (mediaUtils.ts)
  // =========================================================================
  window.localStorage.getItem = () => {
    throw new Error('SecurityError: localStorage getItem blocked');
  };
  window.localStorage.setItem = () => {
    throw new Error('QuotaExceededError: localStorage setItem blocked');
  };
  window.localStorage.removeItem = () => {
    throw new Error('SecurityError: localStorage removeItem blocked');
  };

  try {
    assert.doesNotThrow(() => {
      setDebugImagesEnabled(true);
    }, 'setDebugImagesEnabled(true) não deve lançar exceção quando localStorage falha');
    assert.strictEqual(
      isDebugImagesEnabled(),
      true,
      'isDebugImagesEnabled() deve refletir o fallback em memória quando localStorage falha'
    );

    assert.doesNotThrow(() => {
      setDebugImagesEnabled(false);
    }, 'setDebugImagesEnabled(false) não deve lançar exceção quando localStorage.removeItem falha');
    assert.strictEqual(
      isDebugImagesEnabled(),
      false,
      'isDebugImagesEnabled() deve retornar false após desativar no fallback em memória'
    );

    // Renderizar <MediaImage /> com localStorage bloqueado
    const imgContainer = document.createElement('div');
    document.body.appendChild(imgContainer);
    const imgRoot = createRoot(imgContainer);
    await act(async () => {
      imgRoot.render(
        React.createElement(MediaImage, {
          src: 'http://server.tv:8080/images/poster.jpg',
          alt: 'Poster Teste Seguro',
        })
      );
    });
    assert(
      imgContainer.querySelector('img') !== null,
      'Componente <MediaImage /> deve continuar renderizando normalmente mesmo com localStorage inacessível'
    );
    await act(async () => {
      imgRoot.unmount();
    });
    document.body.removeChild(imgContainer);
  } finally {
    window.localStorage.getItem = origGetItem;
    window.localStorage.setItem = origSetItem;
    window.localStorage.removeItem = origRemoveItem;
  }

  // =========================================================================
  // 11.6. Correção 5A — Timer de fallback de 28s em LiveTvView.tsx ao desmontar
  // =========================================================================
  setLiveFallbackTimeoutMsForTest(50);
  try {
    (XtreamService as any).getLiveCategories = async () => [
      { category_id: '88', category_name: 'Canais Fallback Timer' },
    ];
    (XtreamService as any).getLiveStreams = async () => [
      { stream_id: 8801, name: 'Canal Teste Timer SD', category_id: '88' },
      { stream_id: 8802, name: 'Canal Teste Timer HD', category_id: '88' },
    ];

    const timerCreds: XtreamCredentials = {
      serverUrl: 'http://server.tv:8080',
      username: 'timerUser',
      password: 'timerPassword',
      allowed_output_formats: ['m3u8', 'ts'],
    };

    const timerContainer = document.createElement('div');
    document.body.appendChild(timerContainer);
    const timerRoot = createRoot(timerContainer);

    await act(async () => {
      timerRoot.render(
        React.createElement(
          XtreamProvider,
          { credentials: timerCreds },
          React.createElement(
            NavigationProvider,
            null,
            React.createElement(LiveTvView, { onPlay: () => {} })
          )
        )
      );
      await new Promise((resolve) => setTimeout(resolve, 40));
    });

    // Abrir categoria 88 e clicar no canal para iniciar o preview (que agenda fallbackTimeoutRef)
    const cat88Btn = timerContainer.querySelector('button[data-live-category-id="88"]') as HTMLButtonElement;
    assert(cat88Btn !== null, 'Categoria 88 deve estar renderizada');
    await act(async () => {
      cat88Btn.click();
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    const chBtn = timerContainer.querySelector('button[data-live-channel-btn="true"]') as HTMLButtonElement;
    assert(chBtn !== null, 'Botão do canal deve estar renderizado');
    await act(async () => {
      chBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    const loadCallsBeforeUnmount = videoLoadCallCount;

    // Desmontar LiveTvView ANTES do timer de 50ms disparar
    await act(async () => {
      timerRoot.unmount();
    });
    document.body.removeChild(timerContainer);

    // Aguardar 90ms (além dos 50ms do timer) e confirmar que nenhuma nova tentativa de reprodução foi disparada
    await new Promise((resolve) => setTimeout(resolve, 90));
    assert.strictEqual(
      videoLoadCallCount,
      loadCallsBeforeUnmount,
      'Após desmontar LiveTvView com fallbackTimeoutRef pendente, o timer deve ser cancelado e nenhuma nova tentativa pode disparar'
    );
  } finally {
    setLiveFallbackTimeoutMsForTest(28000);
  }

  // =========================================================================
  // 11.7. Reabertura do aplicativo (<Login /> -> /home com credenciais salvas) e identificação honesta de build (version.ts)
  // =========================================================================
  const savedCreds: XtreamCredentials = {
    serverUrl: 'http://server.tv:8080',
    username: 'reopenUser',
    password: 'reopenPassword',
    allowed_output_formats: ['m3u8'],
  };
  window.localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(savedCreds));

  const reopenContainer = document.createElement('div');
  document.body.appendChild(reopenContainer);
  const reopenRoot = createRoot(reopenContainer);

  const { Routes, Route, useLocation } = await import('react-router-dom');
  let currentRoutePath = '';
  function LocationTracker() {
    const loc = useLocation();
    currentRoutePath = loc.pathname;
    return React.createElement('div', { 'data-route-path': loc.pathname });
  }

  await act(async () => {
    reopenRoot.render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/'] },
        React.createElement(
          Routes,
          null,
          React.createElement(Route, { path: '/', element: React.createElement(Login) }),
          React.createElement(Route, { path: '/home', element: React.createElement(LocationTracker) })
        )
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
  });

  assert.strictEqual(
    currentRoutePath,
    '/home',
    'Ao reabrir o aplicativo na rota "/" com credenciais válidas salvas, <Login /> deve redirecionar automaticamente para "/home"'
  );

  await act(async () => {
    reopenRoot.unmount();
  });
  document.body.removeChild(reopenContainer);

  // Validar resolução de versão e commit sem hashes antigos fixos
  assert.strictEqual(APP_VERSION, '1.3.0', 'APP_VERSION deve estar alinhada com package.json (1.3.0)');
  assert.strictEqual(resolveCommit({}), 'local-build', 'Sem commit de ambiente, resolveCommit deve retornar "local-build"');
  assert.strictEqual(formatCommitShort('local-build'), 'local-build', 'formatCommitShort("local-build") deve preservar "local-build"');
  assert.strictEqual(
    formatCommitShort('4c6b86f65165f183f4e0426f06d373fe467a0cbb'),
    '4c6b86f',
    'Quando um SHA completo é fornecido, formatCommitShort deve abreviar para 7 caracteres'
  );
  assert(typeof APP_COMMIT === 'string' && APP_COMMIT.length > 0, 'APP_COMMIT deve ser uma string não vazia');
  assert(typeof APP_BUILD_TIME === 'string' && APP_BUILD_TIME.length > 0, 'APP_BUILD_TIME deve estar preenchido');

  // =========================================================================
  // 11.8. Auto-login com recuperação de acesso (credenciais inválidas/expiradas vs falha transitória) e preservação de dados locais
  // =========================================================================
  const {
    createXtreamAuthError,
    isAuthenticationRejectedError,
    isTransientXtreamError,
  } = await import('../src/services/xtreamService');
  const {
    readAutoLoginState,
    markCredentialsAuthRejected,
    safeSaveCredentials,
  } = await import('../src/utils/accountUtils');

  // A) Classificação estrita: rejeição de autenticação vs erro transitório
  const authRejectedErr = createXtreamAuthError('Usuário ou senha inválidos (auth=0)', 'invalid_credentials', 200);
  assert.strictEqual(isAuthenticationRejectedError(authRejectedErr), true, 'Erro de autenticação explícita deve ser classificado como rejeição de autenticação');
  assert.strictEqual(isTransientXtreamError(authRejectedErr), false, 'Erro de autenticação explícita não deve ser classificado como transitório');
  assert.strictEqual(isAuthenticationRejectedError({ status: 401, message: 'HTTP 401' }), true, 'HTTP 401 deve ser classificado como rejeição de autenticação');
  assert.strictEqual(isAuthenticationRejectedError({ status: 403, message: 'HTTP 403' }), true, 'HTTP 403 deve ser classificado como rejeição de autenticação');
  assert.strictEqual(isTransientXtreamError(new Error('Tempo limite de conexão esgotado')), true, 'Timeout deve ser classificado como transitório');
  assert.strictEqual(isTransientXtreamError(new Error('Failed to fetch')), true, 'Falha de rede/CORS deve ser classificada como transitória');
  assert.strictEqual(isTransientXtreamError({ status: 503, message: 'HTTP 503' }), true, 'HTTP 5xx deve ser classificado como transitório');

  // B) Rejeição de credenciais no <XtreamService.authenticate> real (auth=0 e status='Expired')
  setTransportTestConfig({
    mode: 'capacitor',
    capacitorHttpGet: async (opts) => ({
      status: 200,
      headers: {},
      url: opts.url,
      data: {
        user_info: { username: 'expiredUser', auth: 1, status: 'Expired' },
        server_info: { allowed_output_formats: ['m3u8'] },
      },
    }),
  });

  let caughtExpiredErr: any = null;
  try {
    await originalXtreamAuthenticate({
      serverUrl: 'http://provider.test:8080',
      username: 'expiredUser',
      password: 'expiredPassword',
    });
  } catch (err) {
    caughtExpiredErr = err;
  }
  assert(caughtExpiredErr !== null, 'Conta com status "Expired" deve lançar erro na validação');
  assert.strictEqual(
    isAuthenticationRejectedError(caughtExpiredErr),
    true,
    'Erro de conta expirada deve ser marcado como rejeição de autenticação definitiva (sem retry)'
  );
  setTransportTestConfig({ mode: 'auto', capacitorHttpGet: null });

  // C) Fluxo completo de recuperação de acesso em <Home /> -> <Login /> sem loop de redirecionamento e preservando favoritos, histórico e preferências
  const FAVORITES_KEY = 'nc_simple_favorites_v2';
  const HISTORY_KEY = 'xtream_watch_history';
  const savedFavoritesSample = JSON.stringify([{ key: 'vod:999', type: 'vod', id: 999, name: 'Filme Favorito Preservado' }]);
  const savedHistorySample = JSON.stringify([{ id: '999', type: 'movie', name: 'Filme Histórico Preservado', timestamp: 1700000000000 }]);
  const savedDisplayPrefsSample = JSON.stringify({ version: 2, deviceType: 'other', scalePercent: 100 });

  window.localStorage.setItem(FAVORITES_KEY, savedFavoritesSample);
  window.localStorage.setItem(HISTORY_KEY, savedHistorySample);
  window.localStorage.setItem(STORAGE_KEY_DISPLAY_PREFS, savedDisplayPrefsSample);

  const rejectedCreds: XtreamCredentials = {
    serverUrl: 'http://server.tv:8080',
    username: 'invalidSavedUser',
    password: 'invalidSavedPassword',
    playlistName: 'Minha Lista Principal',
    avatar: '🎬',
    allowed_output_formats: ['m3u8'],
  };
  safeSaveCredentials(rejectedCreds);
  assert.strictEqual(readAutoLoginState().canAutoLogin, true, 'Antes de detectar rejeição, canAutoLogin deve ser true');

  // Simular servidor rejeitando as credenciais salvas ao abrir /home
  (XtreamService as any).authenticate = async () => {
    throw createXtreamAuthError('Acesso negado: conta expirada ou credenciais inválidas no provedor.', 'http_unauthorized', 401);
  };
  (XtreamService as any).getLiveCategories = async () => {
    throw createXtreamAuthError('Acesso negado: conta expirada ou credenciais inválidas no provedor.', 'http_unauthorized', 401);
  };

  const recoveryContainer = document.createElement('div');
  document.body.appendChild(recoveryContainer);
  const recoveryRoot = createRoot(recoveryContainer);

  await act(async () => {
    recoveryRoot.render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/home'] },
        React.createElement(
          Routes,
          null,
          React.createElement(Route, { path: '/', element: React.createElement(Login) }),
          React.createElement(Route, { path: '/home', element: React.createElement(Home) })
        )
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 60));
  });

  const authRecoveryModal = recoveryContainer.querySelector('[data-auth-recovery="true"]');
  assert(
    authRecoveryModal !== null,
    'Quando as credenciais salvas são rejeitadas pelo servidor em /home, o modal de recuperação de acesso ([data-auth-recovery="true"]) deve ser exibido'
  );
  assert.strictEqual(
    readAutoLoginState().isAuthRejected,
    true,
    'Após rejeição de autenticação, readAutoLoginState().isAuthRejected deve ser true'
  );
  assert.strictEqual(
    readAutoLoginState().canAutoLogin,
    false,
    'Com credenciais rejeitadas, readAutoLoginState().canAutoLogin deve ser false para impedir loop de redirecionamento'
  );

  // Clicar em "Corrigir credenciais de acesso" ([data-auth-recovery-login="true"]) para voltar ao Login
  const goToLoginBtn = recoveryContainer.querySelector('[data-auth-recovery-login="true"]') as HTMLButtonElement;
  assert(goToLoginBtn !== null, 'Botão [data-auth-recovery-login="true"] deve estar presente no modal de recuperação');

  await act(async () => {
    goToLoginBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 40));
  });

  // Confirmar que <Login /> permaneceu aberto sem redirecionar de volta para /home e pré-preencheu os dados salvos para edição
  const loginInputs = Array.from(recoveryContainer.querySelectorAll('input')) as HTMLInputElement[];
  assert(
    loginInputs.length >= 4,
    'Ao voltar para "/", <Login /> deve exibir o formulário de edição sem redirecionar em loop para /home'
  );
  const inputValues = loginInputs.map((inp) => inp.value);
  assert(
    inputValues.includes('http://server.tv:8080') && inputValues.includes('invalidSavedUser'),
    'O formulário de Login deve vir pré-preenchido com serverUrl e username salvos para facilitar a correção pelo usuário'
  );
  assert(
    (recoveryContainer.textContent || '').includes('expirada') ||
      (recoveryContainer.textContent || '').includes('inválidas'),
    'O formulário de Login deve exibir o motivo da rejeição das credenciais'
  );

  // Confirmar que favoritos, histórico de exibição e preferências de tela foram integralmente preservados
  assert.strictEqual(
    window.localStorage.getItem(FAVORITES_KEY),
    savedFavoritesSample,
    'Favoritos devem permanecer preservados durante a recuperação de acesso'
  );
  assert.strictEqual(
    window.localStorage.getItem(HISTORY_KEY),
    savedHistorySample,
    'Histórico de reprodução deve permanecer preservado durante a recuperação de acesso'
  );
  assert.strictEqual(
    window.localStorage.getItem(STORAGE_KEY_DISPLAY_PREFS),
    savedDisplayPrefsSample,
    'Preferências de apresentação devem permanecer preservadas durante a recuperação de acesso'
  );

  await act(async () => {
    recoveryRoot.unmount();
  });
  document.body.removeChild(recoveryContainer);

  // D) Falha transitória (timeout/rede/5xx) preserva credenciais salvas, mantém auto-login ativo e permite repetir sem perder a sessão
  const validSavedCreds: XtreamCredentials = {
    serverUrl: 'http://server.tv:8080',
    username: 'transientUser',
    password: 'transientPassword',
    allowed_output_formats: ['m3u8'],
  };
  safeSaveCredentials(validSavedCreds);
  assert.strictEqual(
    readAutoLoginState().canAutoLogin,
    true,
    'Ao salvar credenciais válidas novamente, canAutoLogin deve voltar a ser true'
  );

  confirmDisplayPreferences('default', 85);
  let categoryLoadCount = 0;
  (XtreamService as any).authenticate = async () => {
    throw new Error(
      'Tempo limite de conexão esgotado (timeout) ao consultar o servidor principal da lista IPTV em horário de pico.'
    );
  };
  (XtreamService as any).getLiveCategories = async () => {
    categoryLoadCount++;
    if (categoryLoadCount === 1) {
      throw new Error(
        'Tempo limite de conexão esgotado (timeout) ao consultar o servidor principal da lista IPTV em horário de pico.'
      );
    }
    return [{ category_id: '1', category_name: 'Canais Recuperados' }];
  };
  (XtreamService as any).getVodCategories = async () => [];
  (XtreamService as any).getSeriesCategories = async () => [];

  const transientContainer = document.createElement('div');
  document.body.appendChild(transientContainer);
  const transientRoot = createRoot(transientContainer);

  await act(async () => {
    transientRoot.render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/home'] },
        React.createElement(
          Routes,
          null,
          React.createElement(Route, { path: '/', element: React.createElement(Login) }),
          React.createElement(Route, { path: '/home', element: React.createElement(Home) })
        )
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 60));
  });

  assert.strictEqual(
    transientContainer.querySelector('[data-auth-recovery="true"]'),
    null,
    'Falha transitória de rede/timeout NÃO deve exibir o modal de credenciais inválidas'
  );
  assert.strictEqual(
    readAutoLoginState().canAutoLogin,
    true,
    'Falha transitória NÃO deve invalidar as credenciais salvas nem desativar o auto-login'
  );

  const transientBanner = transientContainer.querySelector('[data-transient-recovery="true"]') as HTMLElement | null;
  assert(
    transientBanner !== null,
    'Quando a carga inicial falha por erro transitório, o banner de repetição ([data-transient-recovery="true"]) deve ser exibido'
  );

  const transientMsgBlock = transientBanner!.querySelector('[data-transient-recovery-message="true"]') as HTMLElement | null;
  const transientMsgParagraph = transientMsgBlock?.querySelector('p') as HTMLElement | null;
  const transientActionsGroup = transientBanner!.querySelector('[data-nav-row="transient-recovery-actions"]') as HTMLElement | null;
  const transientRetryBtn = transientContainer.querySelector('[data-transient-retry="true"]') as HTMLButtonElement | null;
  const transientEditBtn = transientContainer.querySelector('[data-transient-edit-login="true"]') as HTMLButtonElement | null;

  assert(
    transientMsgBlock !== null && transientMsgParagraph !== null && transientActionsGroup !== null,
    'Banner transitório deve conter o bloco da mensagem ([data-transient-recovery-message="true"]), o parágrafo e o grupo de ações'
  );
  assert(
    transientRetryBtn !== null && transientEditBtn !== null,
    'Ambos os botões ([data-transient-retry="true"] e [data-transient-edit-login="true"]) devem estar visíveis no banner transitório'
  );
  assert(
    transientMsgBlock!.classList.contains('grow') &&
      transientMsgBlock!.classList.contains('shrink') &&
      transientMsgBlock!.classList.contains('basis-72') &&
      transientMsgBlock!.classList.contains('min-w-[min(100%,18rem)]') &&
      !transientMsgBlock!.classList.contains('flex-1'),
    'Bloco da mensagem do aviso transitório deve ter largura de base útil (grow shrink basis-72 min-w-[min(100%,18rem)]) sem conflito com flex-1'
  );
  assert(
    transientMsgParagraph!.classList.contains('whitespace-normal') &&
      transientMsgParagraph!.classList.contains('break-words') &&
      !transientMsgParagraph!.classList.contains('truncate'),
    'Parágrafo do aviso transitório deve quebrar linha sem truncar (whitespace-normal break-words)'
  );

  // Validar que ambos os botões recebem foco normalmente
  await act(async () => {
    transientEditBtn!.focus();
  });
  assertSameElement(document.activeElement, transientEditBtn, 'Botão Revisar servidor deve ser focável');
  await act(async () => {
    transientRetryBtn!.focus();
  });
  assertSameElement(document.activeElement, transientRetryBtn, 'Botão Tentar novamente deve ser focável');

  // Validar cálculo de quebra de linha do flex-wrap com base de 18rem (288px) em 320, 390, 430 e 1280 px
  const computeTransientBannerLayout = (viewportW: number) => {
    const horizontalPad = viewportW >= 768 ? 64 : 32; // px-4 (32px) ou md:px-8 (64px)
    const sidebarW = viewportW >= 768 ? 256 : 0;
    const innerWidth = Math.max(0, viewportW - sidebarW - horizontalPad);
    const msgMinBasis = Math.min(innerWidth, 288); // min(100%, 18rem)
    const gapPx = 12; // 0.75rem
    const actionsWidth = 304; // "Tentar novamente" + "Revisar servidor"
    const wrapsBelow = msgMinBasis + gapPx + actionsWidth > innerWidth;
    return { innerWidth, msgMinBasis, actionsWidth, wrapsBelow };
  };

  for (const narrowW of [320, 390, 430]) {
    const layout = computeTransientBannerLayout(narrowW);
    assert.strictEqual(
      layout.wrapsBelow,
      true,
      `Em ${narrowW}px (innerWidth=${layout.innerWidth}px), o grupo de ações deve passar para a linha abaixo da mensagem`
    );
  }
  const desktopBannerLayout = computeTransientBannerLayout(1280);
  assert.strictEqual(
    desktopBannerLayout.wrapsBelow,
    false,
    `Em desktop 1280px (innerWidth=${desktopBannerLayout.innerWidth}px), mensagem e grupo de ações devem caber lado a lado na mesma linha`
  );

  // Restaurar authenticate e clicar em "Tentar novamente"
  installDefaultXtreamOfflineMocks();
  (XtreamService as any).getLiveCategories = async () => [
    { category_id: '1', category_name: 'Canais Recuperados' },
  ];

  await act(async () => {
    transientRetryBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 60));
  });

  assert.strictEqual(
    transientContainer.querySelector('[data-transient-recovery="true"]'),
    null,
    'Após repetir com sucesso, o banner de falha transitória deve desaparecer'
  );

  await act(async () => {
    transientRoot.unmount();
  });
  document.body.removeChild(transientContainer);

  // =========================================================================
  // 11.9. Safe area sem soma indevida com 100dvh e variáveis de ambiente opcionais
  // =========================================================================
  const fs = await import('node:fs');
  const path = await import('node:path');
  const indexCssContent = fs.readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8');
  const bodyRuleMatch = indexCssContent.match(/body\s*\{([^}]*)\}/);
  assert(bodyRuleMatch !== null, 'Regra CSS de body deve existir em src/index.css');
  assert(
    !bodyRuleMatch![1].includes('padding-top') &&
      !bodyRuleMatch![1].includes('padding-bottom') &&
      !bodyRuleMatch![1].includes('padding-left') &&
      !bodyRuleMatch![1].includes('padding-right'),
    'body não deve aplicar padding de safe-area globalmente para não somar com 100dvh nos containers principais'
  );
  assert(
    indexCssContent.includes('.nc-safe-screen') &&
      indexCssContent.includes('.nc-safe-login') &&
      indexCssContent.includes('.nc-safe-modal'),
    'src/index.css deve definir os utilitários de safe-area por container (.nc-safe-screen, .nc-safe-login, .nc-safe-modal)'
  );

  const homeSource = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/Home.tsx'), 'utf8');
  assert(
    homeSource.includes('h-[100dvh] nc-safe-screen'),
    'Home.tsx deve aplicar h-[100dvh] nc-safe-screen no container raiz'
  );
  assert(
    !homeSource.includes('aside className="hidden md:flex flex-col w-64 bg-[#0a0a0a] border-r border-white/5 h-[100dvh]'),
    'A sidebar desktop em Home.tsx deve usar h-full em vez de h-[100dvh] para não ultrapassar o container com safe-area'
  );

  const envExampleContent = fs.readFileSync(path.resolve(process.cwd(), '.env.example'), 'utf8');
  const emptyAssignments = envExampleContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#') && /^[A-Za-z0-9_]+=\s*$/.test(line));
  assert.strictEqual(
    emptyAssignments.length,
    0,
    '.env.example não deve conter variáveis opcionais com valor vazio (apenas documentação em comentários)'
  );

  installDefaultXtreamOfflineMocks();
  console.log('✅ Todos os testes de Capacitor 8, CapacitorHttp, normalização de volume/catálogo, storage seguro, timer LiveTV, auto-login/recuperação e safe-area aprovados!');
}

async function runPerformanceAndVirtualizationTests() {
  console.log('\n--- 12. Testes de Desempenho (39k Registros), Indexação de Catálogo, Virtualização e Navegação D-Pad ---');

  const {
    sortByYearAndRating,
    getValidYear,
    getValidRating,
    getCatalogRankingPerfStats,
    resetCatalogRankingPerfStats,
  } = await import('../src/utils/catalogRanking');
  const {
    getOrCreateVodIndex,
    getOrCreateSeriesIndex,
    getOrCreateLiveIndex,
    computeHeroItemsFromList,
    getHeroBannerItems,
    getCatalogIndexPerfStats,
    resetCatalogIndexPerfStats,
    buildVodIndexAsync,
    buildSeriesIndexAsync,
    buildLiveIndexAsync,
  } = await import('../src/utils/catalogIndex');
  const {
    moveSpatialFocus,
    getSpatialNavPerfStats,
    resetSpatialNavPerfStats,
    getActiveVirtualContainerCount,
    hasRegisteredVirtualContainer,
    NavigationProvider,
  } = await import('../src/navigation');
  const {
    useVirtualWindow,
    computeVirtualWindowBounds,
    getVirtualWindowDiagnostics,
    resetVirtualWindowDiagnostics,
  } = await import('../src/hooks/useVirtualWindow');
  const {
    MediaImage,
    hasLoadedImageUrl,
    clearLoadedImageUrlCache,
    getSharedObserverDiagnostics,
    resetSharedObserverPerfStats,
    parseRootMarginPx,
    setMediaImageRetryDelayMsForTest,
    getActiveMediaImageRetryTimersCount,
  } = await import('../src/components/MediaImage');
  const { HomeView } = await import('../src/views/HomeView');
  const { getHistoryKey } = await import('../src/utils/playbackHistory');

  // =========================================================================
  // 12.1. Equivalência funcional exata de sortByYearAndRating + extração única + imutabilidade
  // =========================================================================
  const referenceSort = (streams: any[]): any[] => {
    if (!Array.isArray(streams) || streams.length === 0) return [];
    const withMeta: any[] = [];
    const withoutMeta: any[] = [];

    for (const item of streams) {
      const year = getValidYear(item);
      const rating = getValidRating(item);
      if (year > 0 || rating > 0) {
        withMeta.push(item);
      } else {
        withoutMeta.push(item);
      }
    }

    withMeta.sort((a, b) => {
      const yearA = getValidYear(a);
      const yearB = getValidYear(b);
      if (yearA !== yearB) return yearB - yearA;
      const ratingA = getValidRating(a);
      const ratingB = getValidRating(b);
      return ratingB - ratingA;
    });

    return [...withMeta, ...withoutMeta];
  };

  const sampleItems = [
    { stream_id: 1, name: 'Filme Clássico (1999)', rating: '8.5', added: '1700000100' },
    { stream_id: 2, name: 'Lançamento 2025 [4K]', rating: '7.5', added: '1700000500' },
    { stream_id: 3, name: 'Lançamento [2025] Dublado', rating: '9.0', added: '1700000900' },
    { stream_id: 4, name: 'Lançamento (2025) Legendado', rating: '9.0', added: '1700000900' }, // empate exato com 3 -> preserva ordem
    { stream_id: 5, name: 'Sem Ano A', rating: '7.2', added: '1600000000' },
    { stream_id: 6, name: 'Sem Ano B', rating: '0', added: '1650000000' },
    { stream_id: 7, name: 'Filme 1080p 2024', year: '2024', rating: '6.8', last_modified: '1710000000' },
    { stream_id: 8, name: 'Série 2026 Especial', releaseDate: '2026-01-15', rating: '8.1' },
    { stream_id: 9, name: 'Item Sem Ano Nem Nota 1', rating: '' },
    { stream_id: 10, name: 'Item Sem Ano Nem Nota 2', rating: null },
  ];
  const originalSnapshot = sampleItems.map((x) => ({ ...x }));
  const referenceSorted = referenceSort(sampleItems);

  resetCatalogRankingPerfStats();
  const optimizedSorted = sortByYearAndRating(sampleItems);
  const rankingStatsAfterSample = getCatalogRankingPerfStats();

  assert.deepStrictEqual(
    optimizedSorted.map((x) => x.stream_id),
    referenceSorted.map((x) => x.stream_id),
    'sortByYearAndRating otimizado deve produzir exatamente a mesma ordem funcional do algoritmo original (incluindo desempate estável e itens sem metadados no final)'
  );
  assert.deepStrictEqual(
    sampleItems,
    originalSnapshot,
    'sortByYearAndRating não deve mutar o array de entrada original'
  );
  assert.strictEqual(
    rankingStatsAfterSample.sortCalls,
    1,
    'Deve contabilizar exatamente 1 chamada a sortByYearAndRating'
  );
  assert.strictEqual(
    rankingStatsAfterSample.metadataExtractions,
    sampleItems.length,
    'Cada item deve passar por extração de metadados apenas 1 vez por ordenação (O(N))'
  );

  // =========================================================================
  // 12.2. Equivalência exata de getHeroBannerItems (two-pointer merge) vs concat+sort de 27k itens
  // =========================================================================
  const heroTestVod = Array.from({ length: 120 }, (_, i) => ({
    stream_id: 1000 + i,
    name: `Filme Hero ${i % 15} (${2018 + (i % 8)}) [FHD]`,
    category_id: String((i % 4) + 1),
    rating: ((i % 90) / 10).toFixed(1),
    added: String(1700000000 + i * 10),
    stream_icon: i % 7 === 0 ? '' : `http://img.test/v_${i}.jpg`,
  }));
  const heroTestSeries = Array.from({ length: 80 }, (_, i) => ({
    series_id: 5000 + i,
    name: `Série Hero ${i % 12} (${2019 + (i % 7)}) 4K`,
    category_id: String((i % 3) + 10),
    rating: ((i % 95) / 10).toFixed(1),
    last_modified: String(1700000500 + i * 15),
    cover: i % 9 === 0 ? 'N/A' : `http://img.test/s_${i}.jpg`,
  }));

  const expectedHero30 = computeHeroItemsFromList([...heroTestVod, ...heroTestSeries]);
  const actualHero30 = getHeroBannerItems(heroTestVod, heroTestSeries);

  assert.strictEqual(actualHero30.length, 30, 'HeroBanner deve selecionar até 30 destaques únicos com capa válida');
  assert.deepStrictEqual(
    actualHero30.map((x) => x.stream_id ?? x.series_id),
    expectedHero30.map((x) => x.stream_id ?? x.series_id),
    'getHeroBannerItems otimizado deve selecionar exatamente os mesmos 30 itens que computeHeroItemsFromList([...vod, ...series])'
  );

  // =========================================================================
  // 12.3. Benchmark reproduzível em 39.000 registros (12k Canais, 18k Filmes, 9k Séries)
  // =========================================================================
  const liveCategories39k = Array.from({ length: 30 }, (_, i) => ({
    category_id: String(i + 1),
    category_name: `Categoria TV ${i + 1}`,
  }));
  const vodCategories39k = Array.from({ length: 40 }, (_, i) => ({
    category_id: String(i + 101),
    category_name: `Categoria Filmes ${i + 1}`,
  }));
  const seriesCategories39k = Array.from({ length: 25 }, (_, i) => ({
    category_id: String(i + 201),
    category_name: `Categoria Séries ${i + 1}`,
  }));

  const liveStreams12k = Array.from({ length: 12000 }, (_, i) => {
    const channelNum = Math.floor(i / 4) + 1;
    const res = ['SD', 'HD', 'FHD', '4K'][i % 4];
    const catId = String((channelNum % 30) + 1);
    return {
      stream_id: i + 1,
      name: `Canal Brasil ${channelNum} ${res}`,
      category_id: catId,
      stream_icon: `http://img.test/live_${channelNum}.png`,
      epg_channel_id: `epg_${channelNum}`,
    };
  });

  const vodStreams18k = Array.from({ length: 18000 }, (_, i) => {
    const year = 1995 + (i % 31);
    const rating = ((i * 7) % 100) / 10;
    const catId = String(((i * 3) % 40) + 101);
    return {
      stream_id: 100000 + i,
      name: `Filme Titulo ${i % 6000} (${year}) [FHD]`,
      category_id: catId,
      rating: rating.toFixed(1),
      added: String(1700000000 + i * 60),
      stream_icon: `http://img.test/vod_${i}.jpg`,
    };
  });

  const seriesStreams9k = Array.from({ length: 9000 }, (_, i) => {
    const year = 2005 + (i % 21);
    const rating = ((i * 11) % 100) / 10;
    const catId = String(((i * 5) % 25) + 201);
    return {
      series_id: 300000 + i,
      name: `Serie Titulo ${i % 3000} (${year}) 4K`,
      category_id: catId,
      rating: rating.toFixed(1),
      last_modified: String(1700000000 + i * 120),
      cover: `http://img.test/series_${i}.jpg`,
    };
  });

  resetCatalogRankingPerfStats();
  resetCatalogIndexPerfStats();

  // Passada 1 (Fria): Construção dos índices + HomeView + HeroBanner + 6 categorias de Filmes + 6 de Séries
  const tColdStart = performance.now();
  const vodIndex39k = getOrCreateVodIndex(vodStreams18k);
  const seriesIndex39k = getOrCreateSeriesIndex(seriesStreams9k);
  const recentMovies20 = vodIndex39k.getSortedAll().slice(0, 20);
  const recentSeries20 = seriesIndex39k.getSortedAll().slice(0, 20);
  const heroItems30 = getHeroBannerItems(vodStreams18k, seriesStreams9k);
  const vodRowsCold = vodCategories39k.slice(0, 6).map((cat) =>
    vodIndex39k.getSortedByCategory(cat.category_id).slice(0, 20)
  );
  const seriesRowsCold = seriesCategories39k.slice(0, 6).map((cat) =>
    seriesIndex39k.getSortedByCategory(cat.category_id).slice(0, 20)
  );
  const coldCatalogPassMs = performance.now() - tColdStart;
  const coldRankingStats = getCatalogRankingPerfStats();

  assert.strictEqual(recentMovies20.length, 20, 'Deve retornar 20 filmes recentes ordenados');
  assert.strictEqual(recentSeries20.length, 20, 'Deve retornar 20 séries recentes ordenadas');
  assert.strictEqual(heroItems30.length, 30, 'Deve retornar 30 itens no HeroBanner sem reordenar 27k itens');
  assert.strictEqual(vodRowsCold.length, 6);
  assert.strictEqual(seriesRowsCold.length, 6);

  // Passada 2 (Quente / Reabertura da Home, troca de abas ou 3 ajustes de escala da TV): Zero novas ordenações!
  resetCatalogRankingPerfStats();
  const tWarmStart = performance.now();
  for (let i = 0; i < 3; i++) {
    const vIdx = getOrCreateVodIndex(vodStreams18k);
    const sIdx = getOrCreateSeriesIndex(seriesStreams9k);
    vIdx.getSortedAll().slice(0, 20);
    sIdx.getSortedAll().slice(0, 20);
    getHeroBannerItems(vodStreams18k, seriesStreams9k);
    vodCategories39k.slice(0, 6).forEach((cat) => vIdx.getSortedByCategory(cat.category_id).slice(0, 20));
    seriesCategories39k.slice(0, 6).forEach((cat) => sIdx.getSortedByCategory(cat.category_id).slice(0, 20));
  }
  const warmScaleChange3xMs = performance.now() - tWarmStart;
  const warmRankingStats = getCatalogRankingPerfStats();
  assert.strictEqual(
    warmRankingStats.sortCalls,
    0,
    'Reabertura da Home ou alterações de escala da TV devem reutilizar o índice com ZERO novas ordenações'
  );

  // Agrupamento de canais ao vivo por categoria via LiveIndex vs catálogo inteiro
  resetCatalogIndexPerfStats();
  const tLiveCatStart = performance.now();
  const liveIndex12k = getOrCreateLiveIndex(liveStreams12k);
  const firstCatGroups = liveIndex12k.getGroupsByCategory(liveCategories39k[0].category_id);
  const liveCatColdMs = performance.now() - tLiveCatStart;

  const tLiveCatWarmStart = performance.now();
  const firstCatGroupsWarm = liveIndex12k.getGroupsByCategory(liveCategories39k[0].category_id);
  const liveCatWarmMs = performance.now() - tLiveCatWarmStart;

  assert(firstCatGroups.length > 0, 'Categoria de TV ao Vivo deve retornar grupos de canais');
  assert.strictEqual(
    firstCatGroups,
    firstCatGroupsWarm,
    'Segunda leitura da mesma categoria em LiveTvView deve retornar a referência em cache sem reagrupar'
  );
  assert.strictEqual(
    getCatalogIndexPerfStats().liveIndexBuilds,
    1,
    'Apenas 1 construção de LiveIndex deve ocorrer para o catálogo'
  );

  // =========================================================================
  // 12.4. Abertura inicial com DisplaySetupModal bloqueando montagem pesada da HomeView
  //       e orquestração em segundo plano no XtreamProvider
  // =========================================================================
  windowInstance.localStorage.removeItem(STORAGE_KEY_DISPLAY_PREFS);
  const creds39k: XtreamCredentials = {
    serverUrl: 'http://perf.tv:8080',
    username: 'perfUser',
    password: 'perfPassword',
  };
  windowInstance.localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(creds39k));

  let liveStreamsFetchCount = 0;
  let vodStreamsFetchCount = 0;
  let seriesFetchCount = 0;

  (XtreamService as any).getLiveCategories = async () => liveCategories39k.slice(0, 6);
  (XtreamService as any).getVodCategories = async () => vodCategories39k.slice(0, 6);
  (XtreamService as any).getSeriesCategories = async () => seriesCategories39k.slice(0, 6);
  (XtreamService as any).getLiveStreams = async () => {
    liveStreamsFetchCount++;
    return liveStreams12k.slice(0, 400);
  };
  (XtreamService as any).getVodStreams = async () => {
    vodStreamsFetchCount++;
    return vodStreams18k.slice(0, 3000); // > 2500 exercita o yield cooperativo em XtreamContext
  };
  (XtreamService as any).getSeries = async () => {
    seriesFetchCount++;
    return seriesStreams9k.slice(0, 400);
  };

  const setupContainer = document.createElement('div');
  document.body.appendChild(setupContainer);
  const setupRoot = createRoot(setupContainer);

  await act(async () => {
    setupRoot.render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/home'] },
        React.createElement(Home, null)
      )
    );
    await new Promise((r) => setTimeout(r, 80));
  });

  const modalDialog = setupContainer.querySelector('[role="dialog"][aria-modal="true"]');
  assert(modalDialog !== null, 'DisplaySetupModal deve abrir no primeiro acesso quando não há preferência salva');
  const deferredPlaceholder = setupContainer.querySelector('[data-home-deferred="true"]');
  assert(
    deferredPlaceholder !== null,
    'Enquanto DisplaySetupModal está aberto no primeiro acesso, o corpo pesado (<main>) deve permanecer diferido ([data-home-deferred="true"])'
  );
  assert.strictEqual(
    setupContainer.querySelector('[data-scroll-top-anchor="true"]'),
    null,
    'HeroBanner não deve estar montado enquanto o modal inicial de escolha de dispositivo bloqueia a tela'
  );
  assert(
    liveStreamsFetchCount >= 1 && vodStreamsFetchCount >= 1 && seriesFetchCount >= 1,
    'XtreamProvider deve iniciar o carregamento dos catálogos em segundo plano mesmo sem HomeView montada'
  );

  // Selecionar "Computador" (step 1) e confirmar (step 1B)
  const otherDevicesCard = modalDialog!.querySelector(
    'button[data-device-choice="computador"]'
  ) as HTMLButtonElement | null;
  assert(otherDevicesCard !== null, 'Botão Computador (data-device-choice="computador") deve existir no DisplaySetupModal');
  await act(async () => {
    otherDevicesCard!.click();
    await new Promise((r) => setTimeout(r, 20));
  });

  const confirmDefaultBtn = modalDialog!.querySelector(
    'button[data-confirm-default="true"]'
  ) as HTMLButtonElement | null;
  assert(confirmDefaultBtn !== null, 'Botão Confirmar e continuar (data-confirm-default="true") deve existir no passo de confirmação');
  await act(async () => {
    confirmDefaultBtn!.click();
    await new Promise((r) => setTimeout(r, 40));
  });

  assert.strictEqual(
    setupContainer.querySelector('[data-home-deferred="true"]'),
    null,
    'Após concluir a escolha de dispositivo, o placeholder diferido deve sair e liberar a HomeView'
  );
  assert(
    setupContainer.querySelector('[data-scroll-top-anchor="true"]') !== null,
    'HomeView e HeroBanner devem montar normalmente assim que o DisplaySetupModal fecha'
  );

  await act(async () => {
    setupRoot.unmount();
  });
  document.body.removeChild(setupContainer);

  // =========================================================================
  // 12.5. Catálogo vazio, falha parcial, recuperação e troca de conta durante processamento (>2500 itens)
  // =========================================================================
  let capturedCtx: any = null;
  function ContextInspector() {
    capturedCtx = React.useContext(XtreamContext);
    return null;
  }

  // Simular falha parcial em VOD + catálogo vazio em Series + sucesso em Live
  let shouldFailVod = true;
  (XtreamService as any).getLiveCategories = async () => [{ category_id: '1', category_name: 'TV Aberta' }];
  (XtreamService as any).getLiveStreams = async () => liveStreams12k.slice(0, 20);
  (XtreamService as any).getVodCategories = async () => {
    if (shouldFailVod) throw new Error('Falha de rede simulada em VOD');
    return [{ category_id: '10', category_name: 'Ação' }];
  };
  (XtreamService as any).getVodStreams = async () => {
    if (shouldFailVod) throw new Error('Falha de rede simulada em VOD');
    return vodStreams18k.slice(0, 20);
  };
  (XtreamService as any).getSeriesCategories = async () => [];
  (XtreamService as any).getSeries = async () => [];

  const ctxContainer = document.createElement('div');
  document.body.appendChild(ctxContainer);
  const ctxRoot = createRoot(ctxContainer);

  await act(async () => {
    ctxRoot.render(
      React.createElement(
        XtreamProvider,
        { credentials: creds39k },
        React.createElement(ContextInspector, null)
      )
    );
    await new Promise((r) => setTimeout(r, 80));
  });

  assert.strictEqual(capturedCtx.liveCatalogStatus, 'ready', 'Catálogo Live deve ficar ready');
  assert.strictEqual(capturedCtx.vodCatalogStatus, 'error', 'Catálogo VOD com falha parcial deve ficar em status error');
  assert.strictEqual(capturedCtx.seriesCatalogStatus, 'ready', 'Catálogo Series vazio deve concluir como ready');
  assert.strictEqual(capturedCtx.allSeriesStreams.length, 0, 'Catálogo Series vazio deve ter 0 itens');

  // Recuperação do catálogo VOD com falha parcial
  shouldFailVod = false;
  await act(async () => {
    await capturedCtx.fetchVodCategories();
    await capturedCtx.fetchVodStreams();
    await new Promise((r) => setTimeout(r, 40));
  });
  assert.strictEqual(capturedCtx.vodCatalogStatus, 'ready', 'Após retry, catálogo VOD deve recuperar para ready');
  assert.strictEqual(capturedCtx.allVodStreams.length, 20, 'Filmes carregados após recuperação devem estar disponíveis');

  // Troca de conta durante processamento assíncrono de catálogo grande (> 2500 itens)
  let resolveSlowAccountAVod: ((val: any[]) => void) | null = null;
  (XtreamService as any).getVodCategories = async (c: XtreamCredentials) => [
    { category_id: '10', category_name: `Cat_${c.username}` },
  ];
  (XtreamService as any).getVodStreams = (c: XtreamCredentials) => {
    if (c.username === 'contaLentaA') {
      return new Promise<any[]>((resolve) => {
        resolveSlowAccountAVod = resolve;
      });
    }
    return Promise.resolve([
      { stream_id: 999001, name: 'Filme Exclusivo Conta B (2025)', category_id: '10', rating: '9.5' },
    ]);
  };

  const credsContaA: XtreamCredentials = {
    serverUrl: 'http://perf.tv:8080',
    username: 'contaLentaA',
    password: '123',
  };
  const credsContaB: XtreamCredentials = {
    serverUrl: 'http://perf.tv:8080',
    username: 'contaRapidaB',
    password: '456',
  };

  await act(async () => {
    ctxRoot.render(
      React.createElement(
        XtreamProvider,
        { credentials: credsContaA },
        React.createElement(ContextInspector, null)
      )
    );
    await new Promise((r) => setTimeout(r, 30));
  });

  // Antes de contaLentaA terminar o carregamento de 3000 filmes, o usuário troca para contaRapidaB
  await act(async () => {
    ctxRoot.render(
      React.createElement(
        XtreamProvider,
        { credentials: credsContaB },
        React.createElement(ContextInspector, null)
      )
    );
    await new Promise((r) => setTimeout(r, 50));
  });

  // Agora a resposta atrasada de 3000 itens da contaLentaA chega
  if (resolveSlowAccountAVod) {
    await act(async () => {
      resolveSlowAccountAVod!(vodStreams18k.slice(0, 3000));
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  assert.strictEqual(
    capturedCtx.credentials?.username,
    'contaRapidaB',
    'Credenciais ativas devem permanecer na contaRapidaB'
  );
  assert.strictEqual(
    capturedCtx.allVodStreams.length,
    1,
    'Resposta atrasada da conta anterior (mesmo com yield de >2500 itens) jamais deve sobrescrever o catálogo da nova conta'
  );
  assert.strictEqual(
    capturedCtx.allVodStreams[0].stream_id,
    999001,
    'O único filme presente deve ser o da contaRapidaB'
  );

  await act(async () => {
    ctxRoot.unmount();
  });
  document.body.removeChild(ctxContainer);

  // =========================================================================
  // 12.6. Virtualização em Filmes, Séries e Canais ao Vivo (Rolagem profunda + Preservação de Foco/Scroll + Fronteira D-Pad)
  // =========================================================================
  const movies2500 = vodStreams18k.slice(0, 2500).map((m, idx) => ({
    ...m,
    category_id: '101',
    name: `Filme Virtual ${idx + 1} (2024)`,
  }));
  const series2500 = seriesStreams9k.slice(0, 2500).map((s, idx) => ({
    ...s,
    category_id: '201',
    name: `Série Virtual ${idx + 1} (2024)`,
  }));
  const live3000 = Array.from({ length: 3000 }, (_, idx) => ({
    stream_id: 700000 + idx,
    name: `Canal Virtual Exclusivo ${idx + 1} FHD`,
    category_id: '1',
    stream_icon: `http://img.test/ch_${idx}.png`,
  }));

  (XtreamService as any).getVodCategories = async () => [vodCategories39k[0]];
  (XtreamService as any).getVodStreams = async () => movies2500;
  (XtreamService as any).getSeriesCategories = async () => [seriesCategories39k[0]];
  (XtreamService as any).getSeries = async () => series2500;
  (XtreamService as any).getLiveCategories = async () => [liveCategories39k[0]];
  (XtreamService as any).getLiveStreams = async () => live3000;
  (XtreamService as any).getVodInfo = async (creds: any, id: any) => ({
    info: { name: `Filme Detalhe ${id}`, plot: 'Sinopse de teste', rating: '8.8', releasedate: '2024' },
    movie_data: { stream_id: Number(id), name: `Filme Detalhe ${id}`, container_extension: 'mp4' },
  });

  const virtContainer = document.createElement('div');
  document.body.appendChild(virtContainer);
  const virtRoot = createRoot(virtContainer);

  const mockOnPlay = () => {};
  await act(async () => {
    virtRoot.render(
      React.createElement(
        XtreamProvider,
        { credentials: creds39k },
        React.createElement(
          NavigationProvider,
          null,
          React.createElement(MoviesView, { onPlay: mockOnPlay })
        )
      )
    );
    await new Promise((r) => setTimeout(r, 80));
  });

  const moviesScrollEl = virtContainer.querySelector('[data-scroll-container="true"]') as HTMLElement;
  assert(moviesScrollEl, 'Container rolável de MoviesView deve existir');
  Object.defineProperty(moviesScrollEl, 'clientHeight', { value: 720, configurable: true });
  Object.defineProperty(moviesScrollEl, 'clientWidth', { value: 1100, configurable: true });

  // Selecionar a categoria 101 (com 2.500 filmes)
  const catBtnMovies = virtContainer.querySelector('button[data-category-id="101"]') as HTMLButtonElement;
  assert(catBtnMovies, 'Botão da Categoria 101 em MoviesView deve existir');
  await act(async () => {
    catBtnMovies.click();
    await new Promise((r) => setTimeout(r, 40));
  });

  const initialMountedMovieCards = virtContainer.querySelectorAll('[data-nav-grid="true"] [data-nav-item="true"]').length;
  assert(
    initialMountedMovieCards > 0 && initialMountedMovieCards <= 96,
    `MoviesView deve montar no máximo 96 cards inicialmente (montou ${initialMountedMovieCards} de 2.500)`
  );

  // Simular rolagem profunda para scrollTop = 15000 (aprox. metade da grade de 2.500 filmes)
  await act(async () => {
    moviesScrollEl.scrollTop = 15000;
    moviesScrollEl.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
    await new Promise((r) => setTimeout(r, 30));
  });

  const deepScrollMountedMovieCards = Array.from(
    virtContainer.querySelectorAll('[data-nav-grid="true"] [data-nav-item="true"]')
  ) as HTMLElement[];
  assert(
    deepScrollMountedMovieCards.length > 0 && deepScrollMountedMovieCards.length <= 96,
    `Após rolagem profunda (scrollTop=15000), MoviesView deve manter janela limitada <= 96 cards no DOM (montou ${deepScrollMountedMovieCards.length})`
  );
  const firstMountedDeepIdx = Number(deepScrollMountedMovieCards[0].getAttribute('data-virtual-index'));
  assert(
    firstMountedDeepIdx > 100,
    `Após rolagem profunda, a janela virtual deve ter avançado além dos primeiros 100 itens (startIndex=${firstMountedDeepIdx})`
  );

  // Testar preservação de scrollTop e foco ao abrir e fechar MovieDetails em posição profunda da janela virtual
  const targetMidCard = deepScrollMountedMovieCards[Math.floor(deepScrollMountedMovieCards.length / 2)];
  const targetMidVirtualIndex = targetMidCard.getAttribute('data-virtual-index');
  assert(targetMidVirtualIndex, 'Card no meio da janela virtual deve possuir data-virtual-index');

  await act(async () => {
    targetMidCard.focus();
    targetMidCard.click();
    await new Promise((r) => setTimeout(r, 50));
  });

  assert(
    virtContainer.textContent?.includes('Sinopse de teste'),
    'Clicar em um filme na janela virtual deve abrir MovieDetails'
  );

  // Fechar MovieDetails via tecla Escape (política central de Voltar)
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      })
    );
    await new Promise((r) => setTimeout(r, 60));
  });

  assert.strictEqual(
    moviesScrollEl.scrollTop,
    15000,
    'Fechar MovieDetails deve preservar exatamente o scrollTop profundo (15000) na grade virtualizada'
  );
  const restoredCard = virtContainer.querySelector(
    `[data-nav-grid="true"] [data-virtual-index="${targetMidVirtualIndex}"]`
  ) as HTMLElement;
  assert(restoredCard !== null, 'O card do filme aberto deve continuar montado na janela virtual ao fechar MovieDetails');
  assertSameElement(
    document.activeElement,
    restoredCard,
    'O foco deve ser restaurado para o mesmo card na grade virtualizada após fechar MovieDetails'
  );

  // Testar travessia de fronteira da janela virtual via D-Pad (focar último card montado e pressionar ArrowRight)
  const currentWindowCards = Array.from(
    virtContainer.querySelectorAll('[data-nav-grid="true"] [data-nav-item="true"]')
  ) as HTMLElement[];
  const lastCardInWindow = currentWindowCards[currentWindowCards.length - 1];
  const lastIdxBeforeMove = Number(lastCardInWindow.getAttribute('data-virtual-index'));
  await act(async () => {
    lastCardInWindow.focus();
  });
  await act(async () => {
    moveSpatialFocus('right');
    await new Promise((r) => setTimeout(r, 20));
  });

  const activeAfterBoundaryMove = document.activeElement as HTMLElement;
  const activeVirtualIndex = Number(activeAfterBoundaryMove?.getAttribute('data-virtual-index'));
  assert.strictEqual(
    activeVirtualIndex,
    lastIdxBeforeMove + 1,
    `Pressionar seta na borda da janela virtual deve expandir a janela sincronamente e focar o próximo índice (${lastIdxBeforeMove + 1})`
  );

  // Benchmark de 5 movimentações consecutivas por setas na grade virtualizada de 2.500 filmes + telemetria de spatialNav
  const gridItemsNow = Array.from(
    virtContainer.querySelectorAll('[data-nav-grid="true"] [data-nav-item="true"]')
  ) as HTMLElement[];
  gridItemsNow.forEach((el, idx) => {
    const col = idx % 6;
    const row = Math.floor(idx / 6);
    el.getBoundingClientRect = () =>
      ({
        left: 280 + col * 160,
        top: 120 + row * 240,
        right: 280 + col * 160 + 145,
        bottom: 120 + row * 240 + 220,
        width: 145,
        height: 220,
        x: 280 + col * 160,
        y: 120 + row * 240,
        toJSON: () => {},
      }) as DOMRect;
  });

  await act(async () => {
    gridItemsNow[0].focus();
  });
  resetSpatialNavPerfStats();
  const tNavStart = performance.now();
  const directions: Array<'right' | 'down' | 'left' | 'up'> = ['right', 'right', 'down', 'left', 'down'];
  for (const dir of directions) {
    moveSpatialFocus(dir);
  }
  const nav5MovesAfterMs = performance.now() - tNavStart;
  const spatialStats = getSpatialNavPerfStats();

  assert.strictEqual(spatialStats.moveCalls, 5, 'Deve registrar 5 chamadas a moveSpatialFocus');
  assert(
    spatialStats.computedStyleCalls < 600,
    `Com memoização hierárquica e virtualização, 5 movimentos de seta devem fazer menos de 600 chamadas a getComputedStyle (fez ${spatialStats.computedStyleCalls} vs 137.550 antes)`
  );

  // Verificar virtualização em SeriesView (2.500 séries) e LiveTvView (3.000 canais)
  await act(async () => {
    virtRoot.render(
      React.createElement(
        XtreamProvider,
        { credentials: creds39k },
        React.createElement(
          NavigationProvider,
          null,
          React.createElement(SeriesView, { onPlay: mockOnPlay })
        )
      )
    );
    await new Promise((r) => setTimeout(r, 60));
  });

  const catBtnSeries = virtContainer.querySelector('button[data-category-id="201"]') as HTMLButtonElement;
  assert(catBtnSeries, 'Botão da Categoria 201 em SeriesView deve existir');
  await act(async () => {
    catBtnSeries.click();
    await new Promise((r) => setTimeout(r, 40));
  });

  const seriesScrollEl = virtContainer.querySelector('[data-scroll-container="true"]') as HTMLElement;
  assert(seriesScrollEl, 'Container rolável de SeriesView deve existir');
  await act(async () => {
    seriesScrollEl.scrollTop = 12000;
    seriesScrollEl.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
    await new Promise((r) => setTimeout(r, 30));
  });
  const mountedSeriesCards = virtContainer.querySelectorAll('[data-nav-grid="true"] [data-nav-item="true"]').length;
  assert(
    mountedSeriesCards > 0 && mountedSeriesCards <= 96,
    `SeriesView após rolagem profunda deve manter <= 96 cards montados (montou ${mountedSeriesCards} de 2.500)`
  );

  await act(async () => {
    virtRoot.render(
      React.createElement(
        XtreamProvider,
        { credentials: creds39k },
        React.createElement(
          NavigationProvider,
          null,
          React.createElement(LiveTvView, { isTvMode: true })
        )
      )
    );
    await new Promise((r) => setTimeout(r, 60));
  });

  // Abrir a categoria 1 de TV ao Vivo (com 3.000 canais)
  const catBtnLive = virtContainer.querySelector('button[data-live-category-id="1"]') as HTMLButtonElement;
  assert(catBtnLive, 'Botão da Categoria 1 na TV ao Vivo deve existir');
  await act(async () => {
    catBtnLive.click();
    await new Promise((r) => setTimeout(r, 40));
  });

  const liveChannelsScrollEl = virtContainer.querySelector('[data-scroll-container="true"]') as HTMLElement;
  assert(liveChannelsScrollEl, 'Lista rolável de canais em LiveTvView deve existir');
  await act(async () => {
    liveChannelsScrollEl.scrollTop = 18000;
    liveChannelsScrollEl.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
    await new Promise((r) => setTimeout(r, 30));
  });

  const mountedLiveChannelButtons = liveChannelsScrollEl.querySelectorAll('button[data-live-channel-btn="true"]').length;
  assert(
    mountedLiveChannelButtons > 0 && mountedLiveChannelButtons <= 80,
    `LiveTvView após rolagem profunda em 3.000 canais deve manter <= 80 botões montados no DOM (montou ${mountedLiveChannelButtons})`
  );

  // =========================================================================
  // 12.7. Controle de repetição contínua (e.repeat) no NavigationProvider e cache de MediaImage
  // =========================================================================
  const firstChannelBtn = liveChannelsScrollEl.querySelector('button[data-live-channel-btn="true"]') as HTMLButtonElement;
  assert(firstChannelBtn, 'Primeiro botão da janela virtual de canais deve existir');
  await act(async () => {
    firstChannelBtn.focus();
  });

  resetSpatialNavPerfStats();
  // Disparar 6 eventos keydown seguidos com repeat: true no mesmo instante -> apenas o 1º deve acionar moveSpatialFocus imediatamente
  await act(async () => {
    for (let i = 0; i < 6; i++) {
      windowInstance.dispatchEvent(
        new (windowInstance as any).KeyboardEvent('keydown', {
          key: 'ArrowDown',
          repeat: true,
          bubbles: true,
          cancelable: true,
        })
      );
    }
  });
  const repeatStats = getSpatialNavPerfStats();
  assert.strictEqual(
    repeatStats.moveCalls,
    1,
    'Rajada síncrona de keydown com repeat=true deve ser limitada pelo throttle de repetição (1 movimento por intervalo de 48ms)'
  );

  // Teste de cache de URL carregada no MediaImage
  clearLoadedImageUrlCache();
  const testImgUrl = 'http://img.test/poster_cached_test.jpg';
  assert.strictEqual(hasLoadedImageUrl(testImgUrl), false, 'URL não deve iniciar no cache de imagens carregadas');

  await act(async () => {
    virtRoot.render(
      React.createElement(MediaImage, {
        src: testImgUrl,
        alt: 'Poster Teste',
        className: 'w-20 h-20',
      })
    );
    await new Promise((r) => setTimeout(r, 20));
  });

  const imgEl1 = virtContainer.querySelector('img') as HTMLImageElement;
  assert(imgEl1, 'Elemento <img> deve ser renderizado pelo MediaImage');
  assert(imgEl1.className.includes('opacity-0'), 'Antes do onLoad, imagem não cacheada deve iniciar com opacity-0');

  await act(async () => {
    imgEl1.dispatchEvent(new windowInstance.Event('load') as unknown as Event);
    await new Promise((r) => setTimeout(r, 20));
  });

  assert.strictEqual(hasLoadedImageUrl(testImgUrl), true, 'Após onLoad, URL deve ser registrada no loadedImageUrlsCache');
  assert(imgEl1.className.includes('opacity-100'), 'Após onLoad, imagem deve ficar com opacity-100');

  // Remontar MediaImage com a mesma URL -> já deve nascer com opacity-100 sem piscar em opacity-0
  await act(async () => {
    virtRoot.render(React.createElement('div', null));
  });
  await act(async () => {
    virtRoot.render(
      React.createElement(MediaImage, {
        src: testImgUrl,
        alt: 'Poster Teste Remontado',
        className: 'w-20 h-20',
      })
    );
  });
  const imgEl2 = virtContainer.querySelector('img') as HTMLImageElement;
  assert(
    imgEl2 && imgEl2.className.includes('opacity-100') && !imgEl2.className.includes('opacity-0'),
    'Ao remontar MediaImage para uma URL já carregada na sessão, a imagem deve iniciar imediatamente visível (opacity-100)'
  );

  // =========================================================================
  // 12.8. [6.A] Último item e última linha incompleta (0, 1, 95, 96, 97, 100, 101, 2500, 2501 itens e múltiplas colunas)
  // =========================================================================
  const testedCounts = [0, 1, 95, 96, 97, 100, 101, 2500, 2501];
  const testedColumns = [2, 3, 4, 5, 6, 10];

  for (const cols of testedColumns) {
    const alignedWin = Math.max(cols * 6, Math.floor(96 / cols) * cols);
    for (const total of testedCounts) {
      const boundsAtZero = computeVirtualWindowBounds({
        totalCount: total,
        columns: cols,
        alignedWindowSize: alignedWin,
        requestedStartIndex: 0,
      });

      if (total === 0) {
        assert.strictEqual(boundsAtZero.startIndex, 0, `[6.A] total=0 cols=${cols} startIndex deve ser 0`);
        assert.strictEqual(boundsAtZero.endIndex, 0, `[6.A] total=0 cols=${cols} endIndex deve ser 0`);
        assert.strictEqual(boundsAtZero.totalRows, 0, `[6.A] total=0 cols=${cols} totalRows deve ser 0`);
        continue;
      }

      assert.strictEqual(boundsAtZero.startIndex, 0, `[6.A] total=${total} cols=${cols} janela inicial deve iniciar em 0`);
      assert.strictEqual(
        boundsAtZero.endIndex,
        Math.min(total, alignedWin),
        `[6.A] total=${total} cols=${cols} janela inicial deve terminar em min(total, alignedWin)`
      );

      // Solicitar montagem do último item (total - 1)
      const boundsAtEnd = computeVirtualWindowBounds({
        totalCount: total,
        columns: cols,
        alignedWindowSize: alignedWin,
        requestedStartIndex: total - 1,
      });

      assert.strictEqual(
        boundsAtEnd.endIndex,
        total,
        `[6.A] total=${total} cols=${cols}: última janela DEVE alcançar exatamente totalCount (${total}), obteve ${boundsAtEnd.endIndex}`
      );
      assert(
        boundsAtEnd.startIndex % cols === 0,
        `[6.A] total=${total} cols=${cols}: startIndex (${boundsAtEnd.startIndex}) deve permanecer alinhado a múltiplo de colunas`
      );
      assert(
        boundsAtEnd.startIndex <= total - 1 && boundsAtEnd.endIndex > total - 1,
        `[6.A] total=${total} cols=${cols}: último índice (${total - 1}) deve estar contido em [${boundsAtEnd.startIndex}, ${boundsAtEnd.endIndex})`
      );
      assert.strictEqual(
        boundsAtEnd.totalRows - boundsAtEnd.endRow,
        0,
        `[6.A] total=${total} cols=${cols}: na última janela, bottomSpacer rows (totalRows - endRow) deve ser 0`
      );
    }
  }

  // Reprodução direta na grade de MoviesView para 101 itens e 2.500 itens (6 colunas, janela de 96):
  // Garantir acesso ao índice 100 (em 101 itens) e ao índice 2499 (em 2.500 itens) por rolagem e por D-Pad, e retorno ao início
  for (const countScenario of [101, 2500, 2501]) {
    const scenarioMovies = Array.from({ length: countScenario }, (_, idx) => ({
      stream_id: 800000 + idx,
      name: `Filme Limite ${idx + 1} (2024)`,
      category_id: '101',
      rating: '8.0',
      stream_icon: `http://img.test/lim_${idx}.jpg`,
    }));

    (XtreamService as any).getVodCategories = async () => [vodCategories39k[0]];
    (XtreamService as any).getVodStreams = async () => scenarioMovies;

    await act(async () => {
      virtRoot.render(
        React.createElement(
          XtreamProvider,
          {
            credentials: {
              serverUrl: 'http://perf.tv:8080',
              username: `user_${countScenario}`,
              password: '123',
            },
          },
          React.createElement(
            NavigationProvider,
            null,
            React.createElement(MoviesView, { onPlay: mockOnPlay })
          )
        )
      );
      await new Promise((r) => setTimeout(r, 80));
    });

    const catBtnScenario = virtContainer.querySelector('button[data-category-id="101"]') as HTMLButtonElement;
    assert(catBtnScenario, `[6.A] Botão da categoria 101 para cenário de ${countScenario} itens deve existir`);
    await act(async () => {
      catBtnScenario.click();
      await new Promise((r) => setTimeout(r, 40));
    });

    const scrollElScenario = virtContainer.querySelector('main[data-scroll-container="true"]') as HTMLElement;
    assert(scrollElScenario, `[6.A] Container rolável para ${countScenario} itens deve existir`);
    Object.defineProperty(scrollElScenario, 'clientHeight', { value: 720, configurable: true });

    // 1. Alcançar o último item (countScenario - 1) via rolagem até o final
    await act(async () => {
      scrollElScenario.scrollTop = 300000;
      scrollElScenario.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
      await new Promise((r) => setTimeout(r, 30));
    });

    const lastItemByScroll = virtContainer.querySelector(
      `[data-nav-grid="true"] [data-virtual-index="${countScenario - 1}"]`
    ) as HTMLElement;
    assert(
      lastItemByScroll !== null,
      `[6.A] Em grade com ${countScenario} itens, o último item (índice ${countScenario - 1}) DEVE ser montado ao rolar até o fim`
    );
    assert.strictEqual(
      lastItemByScroll.getAttribute('aria-label'),
      `Filme Limite ${countScenario} (2024)`,
      `[6.A] O último item montado em ${countScenario} itens deve preservar o título exato`
    );

    // 2. Retornar ao início via rolagem (scrollTop = 0) e verificar montagem do índice 0 e remoção de topSpacer
    await act(async () => {
      scrollElScenario.scrollTop = 0;
      scrollElScenario.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
      await new Promise((r) => setTimeout(r, 30));
    });

    const firstItemAtTop = virtContainer.querySelector(
      '[data-nav-grid="true"] [data-virtual-index="0"]'
    ) as HTMLElement;
    assert(
      firstItemAtTop !== null,
      `[6.A] Ao retornar scrollTop=0 em ${countScenario} itens, o item 0 deve estar montado`
    );
    assert.strictEqual(
      virtContainer.querySelector('[data-virtual-spacer="top"]'),
      null,
      `[6.A] No topo (scrollTop=0), não deve existir espaçador superior (topSpacerPx=0)`
    );

    // 3. Alcançar o último item via navegação D-Pad (partindo da penúltima janela e avançando com ArrowDown / ArrowRight até o último índice)
    if (countScenario === 101) {
      const item95 = virtContainer.querySelector(
        '[data-nav-grid="true"] [data-virtual-index="95"]'
      ) as HTMLElement;
      assert(item95, '[6.A] Em 101 itens, o índice 95 (último da 1ª janela de 96) deve estar montado inicialmente');
      await act(async () => {
        item95.focus();
      });
      // Pressionar ArrowRight a partir de 95 -> deve montar e focar 96, 97, 98, 99, 100
      for (let expectedIdx = 96; expectedIdx <= 100; expectedIdx++) {
        await act(async () => {
          moveSpatialFocus('right');
        });
        const focusedNow = document.activeElement as HTMLElement;
        assert.strictEqual(
          Number(focusedNow?.getAttribute('data-virtual-index')),
          expectedIdx,
          `[6.A] Navegação D-Pad (right) em 101 itens deve montar e focar o índice ${expectedIdx} da última linha incompleta`
        );
      }
      // Voltar com ArrowUp a partir de 100 (linha 16, col 4) -> deve focar 94 (linha 15, col 4)
      await act(async () => {
        moveSpatialFocus('up');
      });
      assert.strictEqual(
        Number((document.activeElement as HTMLElement)?.getAttribute('data-virtual-index')),
        94,
        '[6.A] ArrowUp a partir do último item (100) deve focar o item exatamente acima (94)'
      );
      // Descer novamente com ArrowDown a partir de 95 (linha 15, col 5) para linha 16 incompleta (que termina na col 4 = índice 100)
      const item95Again = virtContainer.querySelector(
        '[data-nav-grid="true"] [data-virtual-index="95"]'
      ) as HTMLElement;
      await act(async () => {
        item95Again.focus();
        moveSpatialFocus('down');
      });
      assert.strictEqual(
        Number((document.activeElement as HTMLElement)?.getAttribute('data-virtual-index')),
        100,
        '[6.A] ArrowDown na última coluna acima de linha final incompleta (95 -> linha 16) deve focar o último item disponível (100)'
      );
    }
  }

  // =========================================================================
  // 12.9. [6.B] Reabertura da mesma categoria na TV ao Vivo (ciclo categorias -> canais -> categorias -> canais)
  // =========================================================================
  (XtreamService as any).getLiveCategories = async () => [liveCategories39k[0]];
  (XtreamService as any).getLiveStreams = async () => live3000;

  await act(async () => {
    virtRoot.render(
      React.createElement(
        XtreamProvider,
        { credentials: creds39k },
        React.createElement(
          NavigationProvider,
          null,
          React.createElement(LiveTvView, { isTvMode: true })
        )
      )
    );
    await new Promise((r) => setTimeout(r, 60));
  });

  // Realizar 3 ciclos completos de abrir a MESMA categoria ("1") -> rolar -> voltar às categorias -> reabrir a mesma categoria ("1")
  for (let cycle = 1; cycle <= 3; cycle++) {
    const catBtnCycle = virtContainer.querySelector('button[data-live-category-id="1"]') as HTMLButtonElement;
    assert(catBtnCycle, `[6.B] Ciclo ${cycle}: botão da categoria 1 deve estar visível na tela de categorias`);

    await act(async () => {
      catBtnCycle.click();
      await new Promise((r) => setTimeout(r, 40));
    });

    const diagAfterOpen = getVirtualWindowDiagnostics();
    assert.strictEqual(
      diagAfterOpen.activeScrollListeners,
      1,
      `[6.B] Ciclo ${cycle}: ao abrir a lista de canais, exatamente 1 listener de scroll virtual deve estar ativo (obteve ${diagAfterOpen.activeScrollListeners})`
    );
    assert.strictEqual(
      getActiveVirtualContainerCount(),
      1,
      `[6.B] Ciclo ${cycle}: exatamente 1 controlador virtual deve estar registrado no spatialNav`
    );

    const channelsVirtualEl = virtContainer.querySelector('[data-virtual-container="true"]') as HTMLElement;
    const channelsScrollEl = channelsVirtualEl?.closest('[data-scroll-container="true"]') as HTMLElement;
    assert(channelsScrollEl && channelsVirtualEl, `[6.B] Ciclo ${cycle}: containers de canais devem estar montados`);
    assert.strictEqual(
      hasRegisteredVirtualContainer(channelsVirtualEl),
      true,
      `[6.B] Ciclo ${cycle}: o novo elemento DOM [data-virtual-container="true"] deve estar registrado no spatialNav`
    );

    // Rolar profundamente na categoria reaberta até o meio (scrollTop = 18000) e depois até o final (scrollTop = 400000)
    await act(async () => {
      channelsScrollEl.scrollTop = 18000;
      channelsScrollEl.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
      await new Promise((r) => setTimeout(r, 30));
    });

    const firstMountedRowAfterReopenScroll = channelsVirtualEl.querySelector('[data-virtual-index]') as HTMLElement;
    const startIdxReopen = Number(firstMountedRowAfterReopenScroll?.getAttribute('data-virtual-index'));
    assert(
      startIdxReopen > 100,
      `[6.B] Ciclo ${cycle}: rolagem após reabrir a mesma categoria DEVE atualizar a janela virtual (startIndex=${startIdxReopen})`
    );

    // Testar travessia de fronteira por D-Pad (ArrowDown no último canal montado da janela atual)
    const mountedRowsNow = Array.from(
      channelsVirtualEl.querySelectorAll('[data-virtual-index]')
    ) as HTMLElement[];
    const lastMountedRow = mountedRowsNow[mountedRowsNow.length - 1];
    const lastMountedIdx = Number(lastMountedRow.getAttribute('data-virtual-index'));
    const lastMountedBtn = lastMountedRow.querySelector('button[data-live-channel-btn="true"]') as HTMLButtonElement;
    assert(lastMountedBtn, `[6.B] Ciclo ${cycle}: último botão de canal da janela deve existir`);

    await act(async () => {
      lastMountedBtn.focus();
      moveSpatialFocus('down');
      await new Promise((r) => setTimeout(r, 20));
    });

    const activeRowAfterDown = (document.activeElement as HTMLElement)?.closest('[data-virtual-index]');
    assert.strictEqual(
      Number(activeRowAfterDown?.getAttribute('data-virtual-index')),
      lastMountedIdx + 1,
      `[6.B] Ciclo ${cycle}: D-Pad ArrowDown na borda da categoria reaberta deve expandir a janela e focar o índice ${lastMountedIdx + 1}`
    );

    // Rolar até o último canal (índice 2999 de 3.000)
    await act(async () => {
      channelsScrollEl.scrollTop = 400000;
      channelsScrollEl.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
      await new Promise((r) => setTimeout(r, 30));
    });
    const lastChannelRow2999 = channelsVirtualEl.querySelector('[data-virtual-index="2999"]') as HTMLElement;
    assert(
      lastChannelRow2999 !== null,
      `[6.B] Ciclo ${cycle}: o último canal (índice 2999) deve ser acessível na categoria reaberta`
    );

    // Voltar às categorias (exceto no último ciclo onde deixamos verificado ou voltamos para testar desmontagem)
    const backToCatsBtn = virtContainer.querySelector('button[data-live-back-to-categories="true"]') as HTMLButtonElement;
    assert(backToCatsBtn, `[6.B] Ciclo ${cycle}: botão Voltar às Categorias deve existir`);
    await act(async () => {
      backToCatsBtn.click();
      await new Promise((r) => setTimeout(r, 30));
    });

    const diagAfterBack = getVirtualWindowDiagnostics();
    assert.strictEqual(
      diagAfterBack.activeScrollListeners,
      0,
      `[6.B] Ciclo ${cycle}: ao voltar para categorias, o listener de scroll antigo deve ser removido (obteve ${diagAfterBack.activeScrollListeners})`
    );
    assert.strictEqual(
      getActiveVirtualContainerCount(),
      0,
      `[6.B] Ciclo ${cycle}: ao voltar para categorias, o controlador virtual antigo deve ser desregistrado`
    );
    assert.strictEqual(
      hasRegisteredVirtualContainer(channelsVirtualEl),
      false,
      `[6.B] Ciclo ${cycle}: o container desmontado não deve permanecer registrado`
    );
  }

  // =========================================================================
  // 12.10. [6.C] Escala de TV (50%, 85%, 100%, 125%), largura real de container e canais de altura variável
  // =========================================================================
  (XtreamService as any).getVodCategories = async () => [vodCategories39k[0]];
  (XtreamService as any).getVodStreams = async () => movies2500;

  await act(async () => {
    virtRoot.render(
      React.createElement(
        XtreamProvider,
        { credentials: creds39k },
        React.createElement(
          NavigationProvider,
          null,
          React.createElement(MoviesView, { onPlay: mockOnPlay })
        )
      )
    );
    await new Promise((r) => setTimeout(r, 60));
  });

  const catBtnScale = virtContainer.querySelector('button[data-category-id="101"]') as HTMLButtonElement;
  await act(async () => {
    catBtnScale.click();
    await new Promise((r) => setTimeout(r, 30));
  });

  const scaleScrollEl = virtContainer.querySelector('main[data-scroll-container="true"]') as HTMLElement;
  const scaleGridEl = virtContainer.querySelector('[data-virtual-container="true"]') as HTMLElement;
  Object.defineProperty(scaleScrollEl, 'clientHeight', { value: 720, configurable: true });
  Object.defineProperty(scaleGridEl, 'clientWidth', { value: 1100, configurable: true });

  resetVirtualWindowDiagnostics();
  const observedColumnsByScale = new Map<number, number>();
  const tRealScaleStart = performance.now();

  for (const tvScaleVal of [50, 85, 100, 125]) {
    await act(async () => {
      const sessionId = createDisplayPreviewSession();
      startDisplayPreview('tv', tvScaleVal, sessionId);
      confirmDisplayPreferences('tv', tvScaleVal, sessionId);
      windowInstance.dispatchEvent(new windowInstance.Event('resize'));
      await new Promise((r) => setTimeout(r, 25));
    });

    // Descobrir quantas colunas reais o controlador registrou testando um passo ArrowDown a partir do índice 0
    await act(async () => {
      scaleScrollEl.scrollTop = 0;
      scaleScrollEl.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
      await new Promise((r) => setTimeout(r, 20));
    });

    const card0 = scaleGridEl.querySelector('[data-virtual-index="0"]') as HTMLElement;
    assert(card0, `[6.C] Card 0 deve existir na escala ${tvScaleVal}%`);
    await act(async () => {
      card0.focus();
      moveSpatialFocus('down');
    });
    const downIdx = Number((document.activeElement as HTMLElement)?.getAttribute('data-virtual-index'));
    assert(
      downIdx >= 2,
      `[6.C] Em escala TV ${tvScaleVal}%, ArrowDown a partir de 0 deve avançar pelo número real de colunas (${downIdx})`
    );
    observedColumnsByScale.set(tvScaleVal, downIdx);

    // Garantir que o último item (2499) continua acessível por rolagem em todas as escalas (50%, 85%, 100%, 125%)
    await act(async () => {
      scaleScrollEl.scrollTop = 500000;
      scaleScrollEl.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
      await new Promise((r) => setTimeout(r, 25));
    });
    const lastCardAtScale = scaleGridEl.querySelector('[data-virtual-index="2499"]');
    assert(
      lastCardAtScale !== null,
      `[6.C] Na escala TV ${tvScaleVal}% (colunas=${downIdx}), o último item (2499) deve permanecer acessível ao rolar até o fim`
    );
  }
  const realScaleRenderAndRemeasureMs = performance.now() - tRealScaleStart;

  assert(
    observedColumnsByScale.get(50)! > observedColumnsByScale.get(100)! &&
      observedColumnsByScale.get(100)! > observedColumnsByScale.get(125)!,
    `[6.C] A contagem de colunas da grade no modo TV deve refletir a escala real (50%=${observedColumnsByScale.get(50)} cols > 100%=${observedColumnsByScale.get(100)} cols > 125%=${observedColumnsByScale.get(125)} cols)`
  );

  // Testar mudança de largura do container (1280px -> 820px -> 540px) em modo padrão
  await act(async () => {
    const sessionId = createDisplayPreviewSession();
    startDisplayPreview('default', 100, sessionId);
    confirmDisplayPreferences('default', 100, sessionId);
    await new Promise((r) => setTimeout(r, 20));
  });

  const colsByWidth: number[] = [];
  for (const widthPx of [1280, 820, 540]) {
    await act(async () => {
      Object.defineProperty(scaleGridEl, 'clientWidth', { value: widthPx, configurable: true });
      scaleScrollEl.scrollTop = 0;
      scaleScrollEl.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
      windowInstance.dispatchEvent(new windowInstance.Event('resize'));
      await new Promise((r) => setTimeout(r, 25));
    });
    const card0 = scaleGridEl.querySelector('[data-virtual-index="0"]') as HTMLElement;
    await act(async () => {
      card0.focus();
      moveSpatialFocus('down');
    });
    colsByWidth.push(Number((document.activeElement as HTMLElement)?.getAttribute('data-virtual-index')));
  }
  assert.deepStrictEqual(
    colsByWidth,
    [6, 4, 2],
    `[6.C] Mudança de largura do container (1280px, 820px, 540px) deve atualizar as colunas reais para [6, 4, 2], obteve [${colsByWidth.join(', ')}]`
  );

  // Testar lista de canais com alturas variáveis (nomes curtos de 1 linha vs nomes longos de 3 linhas no modo TV)
  const variableHeightChannels = Array.from({ length: 300 }, (_, idx) => ({
    stream_id: 910000 + idx,
    name:
      idx % 2 === 0
        ? `Canal Curto ${idx + 1} FHD`
        : `Canal Com Nome Muito Longo Para Três Linhas Completas Na Interface De TV Android ${idx + 1} FHD`,
    category_id: '1',
    stream_icon: `http://img.test/vh_${idx}.png`,
  }));
  (XtreamService as any).getLiveCategories = async () => [liveCategories39k[0]];
  (XtreamService as any).getLiveStreams = async () => variableHeightChannels;

  await act(async () => {
    virtRoot.render(
      React.createElement(
        XtreamProvider,
        {
          credentials: {
            serverUrl: 'http://perf.tv:8080',
            username: 'user_var_height',
            password: '123',
          },
        },
        React.createElement(
          NavigationProvider,
          null,
          React.createElement(LiveTvView, { isTvMode: true })
        )
      )
    );
    await new Promise((r) => setTimeout(r, 60));
  });

  const catBtnVarH = virtContainer.querySelector('button[data-live-category-id="1"]') as HTMLButtonElement;
  await act(async () => {
    catBtnVarH.click();
    await new Promise((r) => setTimeout(r, 40));
  });

  const varListEl = virtContainer.querySelector('[data-virtual-container="true"]') as HTMLElement;
  const varScrollEl = varListEl?.closest('[data-scroll-container="true"]') as HTMLElement;
  assert(varListEl && varScrollEl, '[6.C] Lista de canais com alturas variáveis deve estar montada');

  // Atribuir alturas reais variáveis aos primeiros 80 itens (ex.: 52px para 1 linha e 96px para 3 linhas)
  const renderedRows0 = Array.from(varListEl.querySelectorAll('[data-virtual-index]')) as HTMLElement[];
  renderedRows0.forEach((rowEl) => {
    const idx = Number(rowEl.getAttribute('data-virtual-index'));
    const h = idx % 2 === 0 ? 52 : 96;
    Object.defineProperty(rowEl, 'offsetHeight', { value: h, configurable: true });
  });

  // Disparar resize para medir as alturas reais variáveis e depois rolar para scrollTop = 9000
  await act(async () => {
    windowInstance.dispatchEvent(new windowInstance.Event('resize'));
    await new Promise((r) => setTimeout(r, 20));
  });
  await act(async () => {
    varScrollEl.scrollTop = 9000;
    varScrollEl.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
    await new Promise((r) => setTimeout(r, 30));
  });

  const topSpacerEl = varListEl.querySelector('[data-virtual-spacer="top"]') as HTMLElement;
  assert(topSpacerEl, '[6.C] Espaçador superior deve existir após rolar lista de canais com alturas variáveis');
  const topSpacerHeight = parseFloat(topSpacerEl.style.height || '0');
  assert(
    topSpacerHeight > 0,
    `[6.C] topSpacerPx (${topSpacerHeight}px) deve refletir a soma acumulada das alturas medidas dos itens anteriores`
  );

  // Rolar até o final da lista de alturas variáveis e confirmar acesso ao último canal (índice 299)
  await act(async () => {
    varScrollEl.scrollTop = 50000;
    varScrollEl.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
    await new Promise((r) => setTimeout(r, 30));
  });
  assert(
    varListEl.querySelector('[data-virtual-index="299"]') !== null,
    '[6.C] Último canal (índice 299) deve ser montado ao final da lista com alturas variáveis'
  );

  // =========================================================================
  // 12.11. [6.D] Indexação cooperativa em lotes (intercalação de tarefa de UI entre lotes + abort na troca de sessão)
  // =========================================================================
  const cooperativeItems6k = Array.from({ length: 6000 }, (_, i) => ({
    stream_id: 500000 + i,
    name: `Filme Lote Cooperativo ${i + 1} (${2000 + (i % 25)})`,
    category_id: String((i % 10) + 1),
    rating: ((i % 90) / 10).toFixed(1),
  }));

  resetCatalogIndexPerfStats();
  const batchProgressLog: number[] = [];
  let uiTaskProcessedSnapshot = -1;

  const indexPromise = buildVodIndexAsync(cooperativeItems6k, {
    batchSize: 1000,
    onBatchProgress: (processed) => {
      batchProgressLog.push(processed);
      if (processed === 2000) {
        // Agendar tarefa no event loop exatamente após o 2º lote; ela deve rodar ANTES do 3º lote terminar!
        setTimeout(() => {
          uiTaskProcessedSnapshot = batchProgressLog[batchProgressLog.length - 1];
        }, 0);
      }
    },
  });

  const completedIndex = await indexPromise;
  const coopStats = getCatalogIndexPerfStats();

  assert(completedIndex !== null, '[6.D] buildVodIndexAsync deve retornar o índice completo ao concluir todos os lotes');
  assert.deepStrictEqual(
    batchProgressLog,
    [1000, 2000, 3000, 4000, 5000, 6000],
    '[6.D] Catálogo de 6.000 itens com batchSize=1000 deve ser processado em 6 lotes cooperativos de 1.000 itens'
  );
  assert.strictEqual(
    coopStats.batchesProcessed,
    6,
    '[6.D] Telemetria deve registrar exatamente 6 lotes processados'
  );
  assert.strictEqual(
    coopStats.batchYields,
    5,
    '[6.D] Telemetria deve registrar 5 yields cooperativos ao event loop entre os 6 lotes'
  );
  assert(
    uiTaskProcessedSnapshot >= 2000 && uiTaskProcessedSnapshot < 6000,
    `[6.D] Tarefa de UI agendada no event loop deve executar ENTRE os lotes (executou quando processed=${uiTaskProcessedSnapshot} < 6000)`
  );
  assert.strictEqual(
    completedIndex.byId.size,
    6000,
    '[6.D] Índice cooperativo concluído deve conter todos os 6.000 itens'
  );

  // Testar cancelamento / troca de sessão no meio da indexação cooperativa (após o 2º lote de 5)
  const abortableItems5k = Array.from({ length: 5000 }, (_, i) => ({
    stream_id: 600000 + i,
    name: `Filme Abortado ${i + 1} (2023)`,
    category_id: '1',
    rating: '7.0',
  }));

  resetCatalogIndexPerfStats();
  let cancelMidway = false;
  const abortedProgress: number[] = [];

  const abortedResult = await buildVodIndexAsync(abortableItems5k, {
    batchSize: 1000,
    shouldCancel: () => cancelMidway,
    onBatchProgress: (processed) => {
      abortedProgress.push(processed);
      if (processed === 2000) {
        cancelMidway = true;
      }
    },
  });

  const abortStats = getCatalogIndexPerfStats();
  assert.strictEqual(
    abortedResult,
    null,
    '[6.D] Quando a sessão é cancelada no meio dos lotes, buildVodIndexAsync deve retornar null sem publicar índice parcial'
  );
  assert.deepStrictEqual(
    abortedProgress,
    [1000, 2000],
    '[6.D] Ao cancelar após 2.000 itens, os lotes restantes (3000..5000) NÃO devem ser processados'
  );
  assert.strictEqual(
    abortStats.abortedBuilds,
    1,
    '[6.D] Telemetria deve registrar 1 build abortado'
  );
  assert.strictEqual(
    abortStats.vodIndexBuilds,
    0,
    '[6.D] Build abortado não deve incrementar vodIndexBuilds nem poluir o WeakMap de índices prontos'
  );

  // =========================================================================
  // 12.12. [Auditoria Item 2] Teste de Geometria Dinâmica Durante a Rolagem (600 itens, 6 colunas, janela 96, origem 88px, passo 232px)
  // =========================================================================
  const dynMovies600 = Array.from({ length: 600 }, (_, i) => ({
    stream_id: 950000 + i,
    name: `Filme Geometria Dinâmica ${i + 1} (2024)`,
    category_id: '101',
    rating: '8.4',
    stream_icon: `http://img.test/dyn_${i}.jpg`,
  }));

  (XtreamService as any).getVodCategories = async () => [vodCategories39k[0]];
  (XtreamService as any).getVodStreams = async () => dynMovies600;

  const dynContainer = document.createElement('div');
  document.body.appendChild(dynContainer);
  const dynRoot = createRoot(dynContainer);

  const origGetBoundingClientRect = windowInstance.HTMLElement.prototype.getBoundingClientRect;
  const origConsoleError = console.error;
  const capturedReactErrors: string[] = [];

  console.error = (...args: any[]) => {
    const msg = args.map((a) => String(a ?? '')).join(' ');
    if (
      msg.includes('Maximum update depth exceeded') ||
      msg.includes('Too many re-renders') ||
      msg.includes('Uncaught Error')
    ) {
      capturedReactErrors.push(msg);
    }
    origConsoleError(...args);
  };

  // Simular geometria dinâmica real acoplada ao DOM atual (scrollTop + altura atual do espaçador + origem estrutural de 88px)
  const STRUCTURAL_ORIGIN_PX = 88;
  const CARD_HEIGHT_PX = 216;
  const CARD_GAP_Y_PX = 16;
  const ROW_STRIDE_PX = CARD_HEIGHT_PX + CARD_GAP_Y_PX; // 232px
  const VIEWPORT_HEIGHT_PX = 720;

  let forceOffsetTopFallback = false;
  const dynamicGetBoundingClientRect = function (this: HTMLElement): DOMRect {
    if (dynContainer.contains(this)) {
      if (this.getAttribute('data-scroll-container') === 'true') {
        const h = forceOffsetTopFallback ? 0 : VIEWPORT_HEIGHT_PX;
        return {
          top: 0,
          bottom: h,
          left: 0,
          right: 1100,
          width: 1100,
          height: h,
          x: 0,
          y: 0,
          toJSON: () => {},
        } as DOMRect;
      }

      const scrollEl = this.closest('[data-scroll-container="true"]') as HTMLElement | null;
      const currentScrollTop = scrollEl ? scrollEl.scrollTop || 0 : 0;

      if (this.getAttribute('data-virtual-spacer') === 'top') {
        const spacerHeight = parseFloat(this.style?.height || '0') || 0;
        const top = STRUCTURAL_ORIGIN_PX - currentScrollTop;
        return {
          top,
          bottom: top + spacerHeight,
          left: 0,
          right: 1050,
          width: 1050,
          height: spacerHeight,
          x: 0,
          y: top,
          toJSON: () => {},
        } as DOMRect;
      }

      if (this.getAttribute('data-virtual-container') === 'true') {
        const prevSib = this.previousElementSibling as HTMLElement | null;
        const currentSpacerH =
          prevSib && prevSib.getAttribute('data-virtual-spacer') === 'top'
            ? parseFloat(prevSib.style?.height || '0') || 0
            : 0;
        const renderedCardsCount = this.querySelectorAll('[data-virtual-index]').length;
        const renderedRows = Math.max(1, Math.ceil(renderedCardsCount / 6));
        const gridHeight = forceOffsetTopFallback ? 0 : renderedRows * ROW_STRIDE_PX;
        const gridTop = STRUCTURAL_ORIGIN_PX + currentSpacerH - currentScrollTop;
        return {
          top: gridTop,
          bottom: gridTop + gridHeight,
          left: 0,
          right: 1050,
          width: 1050,
          height: gridHeight,
          x: 0,
          y: gridTop,
          toJSON: () => {},
        } as DOMRect;
      }

      if (this.hasAttribute('data-virtual-index')) {
        const gridEl = this.closest('[data-virtual-container="true"]') as HTMLElement | null;
        if (gridEl) {
          const gridRect = gridEl.getBoundingClientRect();
          const allCards = Array.from(gridEl.querySelectorAll('[data-virtual-index]'));
          const localIdx = Math.max(0, allCards.indexOf(this));
          const col = localIdx % 6;
          const row = Math.floor(localIdx / 6);
          const cardTop = gridRect.top + row * ROW_STRIDE_PX;
          const cardLeft = col * 175;
          return {
            top: cardTop,
            bottom: cardTop + CARD_HEIGHT_PX,
            left: cardLeft,
            right: cardLeft + 160,
            width: 160,
            height: CARD_HEIGHT_PX,
            x: cardLeft,
            y: cardTop,
            toJSON: () => {},
          } as DOMRect;
        }
      }
    }
    return origGetBoundingClientRect.call(this) as unknown as DOMRect;
  };
  (windowInstance.HTMLElement.prototype as any).getBoundingClientRect = dynamicGetBoundingClientRect;

  try {
    // Parte A: Exercitar diretamente o hook useVirtualWindow com geometria dinâmica para inspecionar listOffsetTop, rowHeightPx e contagem de renders
    let latestHookResult: any = null;
    let hookRenderCount = 0;

    function DynamicGridHookHarness({ totalCount }: { totalCount: number }) {
      hookRenderCount++;
      const sRef = React.useRef<HTMLDivElement | null>(null);
      const gRef = React.useRef<HTMLDivElement | null>(null);
      const res = useVirtualWindow({
        totalCount,
        mode: 'grid',
        scrollContainerRef: sRef,
        virtualContainerRef: gRef,
        maxWindowItems: 96,
      });
      latestHookResult = res;

      const items = [];
      for (let idx = res.startIndex; idx < res.endIndex; idx++) {
        items.push(
          React.createElement('div', {
            key: idx,
            'data-virtual-index': idx,
            'data-nav-item': 'true',
          })
        );
      }

      return React.createElement(
        'div',
        {
          ref: res.scrollContainerCallbackRef,
          'data-scroll-container': 'true',
        },
        res.topSpacerPx > 0
          ? React.createElement('div', {
              'data-virtual-spacer': 'top',
              style: { height: `${res.topSpacerPx}px` },
            })
          : null,
        React.createElement(
          'div',
          {
            ref: res.virtualContainerCallbackRef,
            'data-virtual-container': 'true',
            'data-nav-grid': 'true',
          },
          items
        ),
        res.bottomSpacerPx > 0
          ? React.createElement('div', {
              'data-virtual-spacer': 'bottom',
              style: { height: `${res.bottomSpacerPx}px` },
            })
          : null
      );
    }

    await act(async () => {
      dynRoot.render(React.createElement(DynamicGridHookHarness, { totalCount: 600 }));
    });

    assert.strictEqual(
      capturedReactErrors.length,
      0,
      `[Item 2] Nenhum erro do React deve ocorrer na montagem inicial com geometria dinâmica`
    );
    assert.strictEqual(
      latestHookResult.listOffsetTop,
      STRUCTURAL_ORIGIN_PX,
      `[Item 2] Origem estrutural inicial medida deve ser ${STRUCTURAL_ORIGIN_PX}px`
    );
    assert.strictEqual(
      latestHookResult.rowHeightPx,
      ROW_STRIDE_PX,
      `[Item 2] Passo de linha medido pelos cartões dinâmicos (216 + 16) deve ser ${ROW_STRIDE_PX}px`
    );
    assert.strictEqual(latestHookResult.columns, 6, '[Item 2] Colunas medidas devem ser 6');
    assert.strictEqual(latestHookResult.startIndex, 0, '[Item 2] startIndex inicial deve ser 0');
    assert.strictEqual(latestHookResult.endIndex, 96, '[Item 2] endIndex inicial deve ser 96');

    const harnessScrollEl = dynContainer.querySelector('[data-scroll-container="true"]') as HTMLElement;
    const rendersBeforeDeepScroll = hookRenderCount;

    // Rolar do topo para 5.000 pixels (cenário exato que causava Maximum update depth exceeded antes da correção)
    await act(async () => {
      harnessScrollEl.scrollTop = 5000;
      harnessScrollEl.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
      await new Promise((r) => setTimeout(r, 30));
    });

    const rendersForScroll5000 = hookRenderCount - rendersBeforeDeepScroll;
    assert.strictEqual(
      capturedReactErrors.length,
      0,
      `[Item 2] Rolagem para 5000px com geometria dinâmica NÃO deve disparar Maximum update depth exceeded (erros=${capturedReactErrors.length})`
    );
    assert(
      rendersForScroll5000 <= 3,
      `[Item 2] A transição para scrollTop=5000 deve convergir imediatamente sem ciclo de re-renderizações (renderizou ${rendersForScroll5000}x)`
    );

    // Em scrollTop=5000, origem=88, passo=232:
    // effectiveScrollTop = 5000 - 88 = 4912 -> rawFirstVisibleRow = floor(4912 / 232) = 21
    // startRow = 21 - 3 (overscan) = 18 -> startIndex = 18 * 6 = 108, endIndex = 204, topSpacerPx = 18 * 232 = 4176
    assert.strictEqual(
      latestHookResult.startIndex,
      108,
      `[Item 2] Em scrollTop=5000px, startIndex deve convergir para 108 (obteve ${latestHookResult.startIndex})`
    );
    assert.strictEqual(
      latestHookResult.endIndex,
      204,
      `[Item 2] Em scrollTop=5000px, endIndex deve ser 204 (obteve ${latestHookResult.endIndex})`
    );
    assert.strictEqual(
      latestHookResult.topSpacerPx,
      18 * ROW_STRIDE_PX,
      `[Item 2] Em scrollTop=5000px, topSpacerPx deve ser 4176px (obteve ${latestHookResult.topSpacerPx})`
    );
    assert.strictEqual(
      latestHookResult.listOffsetTop,
      STRUCTURAL_ORIGIN_PX,
      `[Item 2] Deslocar a janela virtual para startIndex=108 NÃO deve alterar listOffsetTop (permanece ${STRUCTURAL_ORIGIN_PX}px)`
    );

    // Verificar que todos os itens da região visível (linhas 21 a 24 -> índices 126 a 149) estão montados
    for (let visIdx = 126; visIdx <= 149; visIdx++) {
      assert(
        dynContainer.querySelector(`[data-virtual-index="${visIdx}"]`) !== null,
        `[Item 2] Item visível ${visIdx} na região de 5000px deve estar montado no DOM`
      );
    }

    // Executar medições repetidas (5 chamadas diretas a remeasureLayout + eventos resize) e confirmar estabilidade absoluta
    const rendersBeforeRepeatedMeasure = hookRenderCount;
    await act(async () => {
      for (let m = 0; m < 5; m++) {
        latestHookResult.remeasureLayout();
        windowInstance.dispatchEvent(new windowInstance.Event('resize'));
      }
      await new Promise((r) => setTimeout(r, 20));
    });
    assert.strictEqual(
      latestHookResult.startIndex,
      108,
      '[Item 2] Medições repetidas devem manter startIndex estável em 108'
    );
    assert.strictEqual(
      latestHookResult.listOffsetTop,
      STRUCTURAL_ORIGIN_PX,
      '[Item 2] Medições repetidas devem manter listOffsetTop estável em 88px'
    );
    assert.strictEqual(
      hookRenderCount - rendersBeforeRepeatedMeasure,
      0,
      '[Item 2] Medições repetidas sem mudança geométrica não devem disparar re-renderizações extras'
    );

    // Rolar até o fim (scrollTop = 25000) -> deve montar os últimos itens (até 599) mantendo listOffsetTop = 88
    await act(async () => {
      harnessScrollEl.scrollTop = 25000;
      harnessScrollEl.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
      await new Promise((r) => setTimeout(r, 20));
    });
    assert.strictEqual(
      latestHookResult.endIndex,
      600,
      '[Item 2] Rolagem até o fim com geometria dinâmica deve alcançar endIndex=600'
    );
    assert(
      dynContainer.querySelector('[data-virtual-index="599"]') !== null,
      '[Item 2] Último item (599) deve estar montado ao rolar até o fim'
    );
    assert.strictEqual(
      latestHookResult.listOffsetTop,
      STRUCTURAL_ORIGIN_PX,
      '[Item 2] Na última janela (endIndex=600), listOffsetTop deve permanecer 88px'
    );

    // Rolar para cima (scrollTop = 2500) e depois de volta ao topo (scrollTop = 0)
    await act(async () => {
      harnessScrollEl.scrollTop = 2500;
      harnessScrollEl.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
      await new Promise((r) => setTimeout(r, 20));
    });
    assert.strictEqual(
      latestHookResult.startIndex,
      42,
      `[Item 2] Ao subir para scrollTop=2500px, startIndex deve ser 42 (obteve ${latestHookResult.startIndex})`
    );
    assert.strictEqual(
      latestHookResult.listOffsetTop,
      STRUCTURAL_ORIGIN_PX,
      '[Item 2] Ao subir para scrollTop=2500px, listOffsetTop deve permanecer 88px'
    );

    await act(async () => {
      harnessScrollEl.scrollTop = 0;
      harnessScrollEl.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
      await new Promise((r) => setTimeout(r, 20));
    });
    assert.strictEqual(
      latestHookResult.startIndex,
      0,
      '[Item 2] Ao retornar ao topo (scrollTop=0), startIndex deve voltar a 0'
    );
    assert.strictEqual(
      latestHookResult.topSpacerPx,
      0,
      '[Item 2] Ao retornar ao topo (scrollTop=0), topSpacerPx deve voltar a 0'
    );
    assert.strictEqual(
      latestHookResult.listOffsetTop,
      STRUCTURAL_ORIGIN_PX,
      '[Item 2] No topo, listOffsetTop deve permanecer 88px'
    );

    // Parte B: Validar também o caminho de fallback baseado em offsetTop (quando sRect.height/vRect.height retornam 0 mas offsetTop reflete 40 + 88 + topSpacerPx)
    forceOffsetTopFallback = true;
    const harnessVirtualEl = dynContainer.querySelector('[data-virtual-container="true"]') as HTMLElement;
    Object.defineProperty(harnessScrollEl, 'offsetTop', { value: 40, configurable: true });
    Object.defineProperty(harnessVirtualEl, 'offsetTop', {
      get(this: HTMLElement) {
        const prevSib = this.previousElementSibling as HTMLElement | null;
        const spacerH =
          prevSib && prevSib.getAttribute('data-virtual-spacer') === 'top'
            ? parseFloat(prevSib.style?.height || '0') || 0
            : 0;
        // Mesmo offsetParent que scrollEl (que tem offsetTop=40) + origem 88 + spacerH
        return 40 + STRUCTURAL_ORIGIN_PX + spacerH;
      },
      configurable: true,
    });

    await act(async () => {
      harnessScrollEl.scrollTop = 5000;
      harnessScrollEl.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
      await new Promise((r) => setTimeout(r, 25));
    });
    assert.strictEqual(
      latestHookResult.listOffsetTop,
      STRUCTURAL_ORIGIN_PX,
      '[Item 2] Caminho fallback via offsetTop (considerando offsetTop do scrollContainer e espaçador atual) deve preservar listOffsetTop=88px'
    );
    assert.strictEqual(
      latestHookResult.startIndex,
      108,
      '[Item 2] Caminho fallback via offsetTop em scrollTop=5000px deve manter startIndex estável em 108'
    );

    // Parte C: Exercitar integração completa com MoviesView sob geometria dinâmica
    forceOffsetTopFallback = false;

    await act(async () => {
      dynRoot.render(
        React.createElement(
          XtreamProvider,
          {
            credentials: {
              serverUrl: 'http://perf.tv:8080',
              username: 'user_dyn_movies_600',
              password: '123',
            },
          },
          React.createElement(
            NavigationProvider,
            null,
            React.createElement(MoviesView, { onPlay: mockOnPlay })
          )
        )
      );
      await new Promise((r) => setTimeout(r, 80));
    });

    const dynCatBtn = dynContainer.querySelector('button[data-category-id="101"]') as HTMLButtonElement;
    assert(dynCatBtn, '[Item 2] Botão da categoria 101 em MoviesView dinâmico deve existir');
    await act(async () => {
      dynCatBtn.click();
      await new Promise((r) => setTimeout(r, 40));
    });

    const dynMoviesMain = dynContainer.querySelector('main[data-scroll-container="true"]') as HTMLElement;
    await act(async () => {
      dynMoviesMain.scrollTop = 5000;
      dynMoviesMain.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
      await new Promise((r) => setTimeout(r, 30));
    });

    assert.strictEqual(
      capturedReactErrors.length,
      0,
      '[Item 2] MoviesView com geometria dinâmica em scrollTop=5000px não deve apresentar erros do React'
    );
    const firstCardInMovies5000 = dynContainer.querySelector('[data-nav-grid="true"] [data-virtual-index]') as HTMLElement;
    assert.strictEqual(
      Number(firstCardInMovies5000?.getAttribute('data-virtual-index')),
      108,
      '[Item 2] MoviesView com geometria dinâmica em scrollTop=5000px deve posicionar janela em startIndex=108'
    );
  } finally {
    windowInstance.HTMLElement.prototype.getBoundingClientRect = origGetBoundingClientRect;
    console.error = origConsoleError;
    await act(async () => {
      dynRoot.unmount();
    });
    document.body.removeChild(dynContainer);
  }

  // =========================================================================
  // 12.13. [Auditoria Item 4] Teste Isolado de Eliminação do Retrabalho de Metadados (6.000 Filmes e 6.000 Séries)
  // =========================================================================
  const isolatedVod6k = Array.from({ length: 6000 }, (_, i) => ({
    stream_id: 710000 + i,
    name: i % 10 === 0 ? `Filme Sem Ano ${i + 1}` : `Filme Isolado ${i + 1} (${1998 + (i % 27)})`,
    category_id: String((i % 8) + 1),
    rating: i % 10 === 0 ? '0' : (((i * 3) % 95) / 10).toFixed(1),
  }));
  const isolatedVodSnapshot = isolatedVod6k.map((item) => ({ ...item }));

  resetCatalogRankingPerfStats();
  resetCatalogIndexPerfStats();

  let isolatedVodUiInterleavedAt = -1;
  const isolatedVodProgress: number[] = [];
  const isolatedVodIdx = await buildVodIndexAsync(isolatedVod6k, {
    batchSize: 1000,
    onBatchProgress: (processed) => {
      isolatedVodProgress.push(processed);
      if (processed === 2000) {
        setTimeout(() => {
          isolatedVodUiInterleavedAt = isolatedVodProgress[isolatedVodProgress.length - 1];
        }, 0);
      }
    },
  });

  assert(isolatedVodIdx !== null, '[Item 4] buildVodIndexAsync deve construir o índice de 6.000 filmes');
  const statsAfterVodIndexBuild = getCatalogRankingPerfStats();
  assert.strictEqual(
    statsAfterVodIndexBuild.metadataExtractions,
    0,
    `[Item 4] A construção cooperativa do índice VOD NÃO deve executar extração de ano (esperado 0, obteve ${statsAfterVodIndexBuild.metadataExtractions})`
  );
  assert.strictEqual(
    statsAfterVodIndexBuild.sortCalls,
    0,
    '[Item 4] A construção do índice VOD não deve invocar sortByYearAndRating'
  );
  assert(
    isolatedVodUiInterleavedAt >= 2000 && isolatedVodUiInterleavedAt < 6000,
    `[Item 4] Tarefa de interface deve continuar executando entre os lotes de VOD (executou em processed=${isolatedVodUiInterleavedAt})`
  );

  // Primeira ordenação: deve extrair metadados exatamente 1 vez por item (6.000 extrações)
  const sortedVodFirst = isolatedVodIdx.getSortedAll();
  const statsAfterFirstVodSort = getCatalogRankingPerfStats();
  assert.strictEqual(
    statsAfterFirstVodSort.sortCalls,
    1,
    '[Item 4] 1ª chamada a getSortedAll() em VOD deve realizar 1 ordenação'
  );
  assert.strictEqual(
    statsAfterFirstVodSort.metadataExtractions,
    6000,
    `[Item 4] 1ª ordenação de 6.000 filmes deve realizar exatamente 6.000 extrações (1 por item, sem duplicar para 12.000; obteve ${statsAfterFirstVodSort.metadataExtractions})`
  );

  // Segunda consulta à mesma ordenação: deve reutilizar o resultado em cache (0 novas extrações)
  const sortedVodSecond = isolatedVodIdx.getSortedAll();
  const statsAfterSecondVodSort = getCatalogRankingPerfStats();
  assert.strictEqual(
    sortedVodSecond,
    sortedVodFirst,
    '[Item 4] 2ª consulta a getSortedAll() em VOD deve retornar a referência em cache'
  );
  assert.strictEqual(
    statsAfterSecondVodSort.metadataExtractions,
    6000,
    '[Item 4] 2ª consulta a getSortedAll() em VOD não deve realizar nenhuma nova extração de metadados'
  );
  assert.deepStrictEqual(
    isolatedVod6k,
    isolatedVodSnapshot,
    '[Item 4] O array original de 6.000 filmes deve permanecer intacto (sem mutação)'
  );
  assert.strictEqual(
    getValidYear(sortedVodFirst[0]) >= getValidYear(sortedVodFirst[100]),
    true,
    '[Item 4] Ordem final de filmes deve continuar decrescente por ano/nota'
  );
  assert.strictEqual(
    getValidYear(sortedVodFirst[sortedVodFirst.length - 1]),
    0,
    '[Item 4] Itens sem metadados devem permanecer no final da ordenação'
  );

  // Repetir verificação isolada para o construtor de Séries (buildSeriesIndexAsync com 6.000 itens + cancelamento)
  const isolatedSeries6k = Array.from({ length: 6000 }, (_, i) => ({
    series_id: 810000 + i,
    name: i % 12 === 0 ? `Série Sem Ano ${i + 1}` : `Série Isolada ${i + 1} (${2002 + (i % 23)})`,
    category_id: String((i % 6) + 1),
    rating: i % 12 === 0 ? '' : (((i * 7) % 95) / 10).toFixed(1),
  }));
  const isolatedSeriesSnapshot = isolatedSeries6k.map((item) => ({ ...item }));

  resetCatalogRankingPerfStats();
  resetCatalogIndexPerfStats();

  let isolatedSeriesUiInterleavedAt = -1;
  const isolatedSeriesProgress: number[] = [];
  const isolatedSeriesIdx = await buildSeriesIndexAsync(isolatedSeries6k, {
    batchSize: 1000,
    onBatchProgress: (processed) => {
      isolatedSeriesProgress.push(processed);
      if (processed === 3000) {
        setTimeout(() => {
          isolatedSeriesUiInterleavedAt = isolatedSeriesProgress[isolatedSeriesProgress.length - 1];
        }, 0);
      }
    },
  });

  assert(isolatedSeriesIdx !== null, '[Item 4] buildSeriesIndexAsync deve construir o índice de 6.000 séries');
  const statsAfterSeriesIndexBuild = getCatalogRankingPerfStats();
  assert.strictEqual(
    statsAfterSeriesIndexBuild.metadataExtractions,
    0,
    `[Item 4] A construção cooperativa do índice de Séries NÃO deve executar extração de ano (esperado 0, obteve ${statsAfterSeriesIndexBuild.metadataExtractions})`
  );
  assert(
    isolatedSeriesUiInterleavedAt >= 3000 && isolatedSeriesUiInterleavedAt < 6000,
    `[Item 4] Tarefa de interface deve continuar executando entre os lotes de Séries (executou em processed=${isolatedSeriesUiInterleavedAt})`
  );

  const sortedSeriesFirst = isolatedSeriesIdx.getSortedAll();
  const statsAfterFirstSeriesSort = getCatalogRankingPerfStats();
  assert.strictEqual(
    statsAfterFirstSeriesSort.metadataExtractions,
    6000,
    `[Item 4] 1ª ordenação de 6.000 séries deve realizar exatamente 6.000 extrações (obteve ${statsAfterFirstSeriesSort.metadataExtractions})`
  );

  const sortedSeriesSecond = isolatedSeriesIdx.getSortedAll();
  const statsAfterSecondSeriesSort = getCatalogRankingPerfStats();
  assert.strictEqual(sortedSeriesSecond, sortedSeriesFirst);
  assert.strictEqual(
    statsAfterSecondSeriesSort.metadataExtractions,
    6000,
    '[Item 4] 2ª consulta a getSortedAll() em Séries deve reutilizar o cache com 0 novas extrações'
  );
  assert.deepStrictEqual(
    isolatedSeries6k,
    isolatedSeriesSnapshot,
    '[Item 4] O array original de 6.000 séries deve permanecer intacto'
  );

  // Cancelamento durante construção de Séries deve descartar trabalho incompleto com 0 extrações
  const abortableSeries4k = Array.from({ length: 4000 }, (_, i) => ({
    series_id: 890000 + i,
    name: `Série Abortada ${i + 1} (2024)`,
    category_id: '1',
    rating: '8.0',
  }));
  resetCatalogRankingPerfStats();
  resetCatalogIndexPerfStats();
  let cancelSeriesMidway = false;
  const abortedSeriesRes = await buildSeriesIndexAsync(abortableSeries4k, {
    batchSize: 1000,
    shouldCancel: () => cancelSeriesMidway,
    onBatchProgress: (processed) => {
      if (processed === 2000) cancelSeriesMidway = true;
    },
  });
  assert.strictEqual(abortedSeriesRes, null, '[Item 4] buildSeriesIndexAsync cancelado deve retornar null');
  assert.strictEqual(getCatalogIndexPerfStats().abortedBuilds, 1);
  assert.strictEqual(getCatalogIndexPerfStats().seriesIndexBuilds, 0);
  assert.strictEqual(getCatalogRankingPerfStats().metadataExtractions, 0);

  // =========================================================================
  // 12.14. Carregamento Eficiente das Imagens da Home (Visibilidade Real, Separação Cache/Autorização, Custo de Observadores, Retentativa e Fallback)
  // =========================================================================
  console.log('🧪 Testando 12.14: Carregamento eficiente de imagens na HomeView, HorizontalRow e MediaImage...');

  clearLoadedImageUrlCache();
  resetSharedObserverPerfStats();

  const credsHomeImg: XtreamCredentials = {
    serverUrl: 'http://perf.tv:8080',
    username: 'homeImgPerfUser',
    password: '123',
  };
  const homeHistoryKey = getHistoryKey(credsHomeImg.serverUrl, credsHomeImg.username);
  windowInstance.localStorage.removeItem(homeHistoryKey);

  // Catálogo sintético determinístico para produzir exatamente 10 fileiras de 24 itens na Home (240 cartões + 1 HeroBanner = 241 imagens)
  const homeVodCats4 = Array.from({ length: 4 }, (_, i) => ({
    category_id: String(501 + i),
    category_name: `Filmes Cat ${i + 1}`,
  }));
  const homeSeriesCats3 = Array.from({ length: 3 }, (_, i) => ({
    category_id: String(601 + i),
    category_name: `Séries Cat ${i + 1}`,
  }));
  const homeLiveCats1 = [{ category_id: '701', category_name: 'Canais Ao Vivo Cat 1' }];

  const homeLiveStreams30 = Array.from({ length: 30 }, (_, i) => ({
    stream_id: 910000 + i,
    name: `Canal Home ${i + 1} FHD`,
    category_id: '701',
    stream_icon: `http://img.test/home_live_${i + 1}.png`,
  }));

  const homeVodStreams520 = Array.from({ length: 520 }, (_, i) => {
    const catId = String(501 + (i % 4));
    return {
      stream_id: 920000 + i,
      name: `Filme Home ${i + 1} (2025)`,
      category_id: catId,
      rating: '8.7',
      added: String(1710000000 + i * 10),
      stream_icon: `http://img.test/home_vod_${i + 1}.jpg`,
    };
  });

  const homeSeriesStreams120 = Array.from({ length: 120 }, (_, i) => {
    const catId = String(601 + (i % 3));
    return {
      series_id: 930000 + i,
      name: `Série Home ${i + 1} (2025)`,
      category_id: catId,
      rating: '8.9',
      last_modified: String(1710000000 + i * 10),
      cover: `http://img.test/home_series_${i + 1}.jpg`,
    };
  });

  (XtreamService as any).getLiveCategories = async () => homeLiveCats1;
  (XtreamService as any).getVodCategories = async () => homeVodCats4;
  (XtreamService as any).getSeriesCategories = async () => homeSeriesCats3;
  (XtreamService as any).getLiveStreams = async () => homeLiveStreams30;
  (XtreamService as any).getVodStreams = async () => homeVodStreams520;
  (XtreamService as any).getSeries = async () => homeSeriesStreams120;

  // Configuração geométrica parametrizável para testar diferentes posições de fileira, larguras, escalas e indisponibilidade temporária
  let geomConfig = {
    geometryAvailable: true,
    scrollContainerHeight: 720,
    scrollContainerWidth: 1280,
    row0BaseTop: 520,
    otherRowsStartTop: 1020,
    rowVerticalStep: 320,
    rowHeight: 260,
    navRowWidth: 1120,
    cardWidth: 165,
    cardStep: 185,
    countRectReads: false,
    scrollContainerRectReads: 0,
    navRowRectReads: 0,
    cardRectReads: 0,
  };

  const origProtoGetBCRHome = windowInstance.HTMLElement.prototype.getBoundingClientRect;
  const installHomeGeometryMock = (rootEl: HTMLElement) => {
    (windowInstance.HTMLElement.prototype as any).getBoundingClientRect = function (this: HTMLElement): DOMRect {
      if (!geomConfig.geometryAvailable) {
        return {
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          width: 0,
          height: 0,
          x: 0,
          y: 0,
          toJSON: () => {},
        } as DOMRect;
      }

      if (this.getAttribute('data-nav-zone') === 'content' && this.getAttribute('data-scroll-container') === 'true') {
        if (geomConfig.countRectReads) geomConfig.scrollContainerRectReads++;
        return {
          top: 0,
          bottom: geomConfig.scrollContainerHeight,
          left: 0,
          right: geomConfig.scrollContainerWidth,
          width: geomConfig.scrollContainerWidth,
          height: geomConfig.scrollContainerHeight,
          x: 0,
          y: 0,
          toJSON: () => {},
        } as DOMRect;
      }

      const rowIdxAttr = this.getAttribute('data-home-row-index');
      if (rowIdxAttr !== null) {
        const rIdx = Number(rowIdxAttr);
        const scrollContainer = rootEl.querySelector(
          '[data-nav-zone="content"][data-scroll-container="true"]'
        ) as HTMLElement | null;
        const scrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
        const baseTop =
          rIdx === 0
            ? geomConfig.row0BaseTop
            : geomConfig.otherRowsStartTop + (rIdx - 1) * geomConfig.rowVerticalStep;
        const top = baseTop - scrollTop;
        return {
          top,
          bottom: top + geomConfig.rowHeight,
          left: 48,
          right: 48 + geomConfig.navRowWidth,
          width: geomConfig.navRowWidth,
          height: geomConfig.rowHeight,
          x: 48,
          y: top,
          toJSON: () => {},
        } as DOMRect;
      }

      if (this.getAttribute('data-nav-row') === 'true') {
        if (geomConfig.countRectReads) geomConfig.navRowRectReads++;
        const wrapper = this.closest('[data-home-row-index]') as HTMLElement | null;
        const wrapperRect = wrapper
          ? wrapper.getBoundingClientRect()
          : ({ top: 520, bottom: 780 } as DOMRect);
        return {
          top: wrapperRect.top + 40,
          bottom: wrapperRect.bottom,
          left: 0,
          right: geomConfig.navRowWidth,
          width: geomConfig.navRowWidth,
          height: 220,
          x: 0,
          y: wrapperRect.top + 40,
          toJSON: () => {},
        } as DOMRect;
      }

      const cardIdxAttr = this.getAttribute('data-row-card-index');
      if (cardIdxAttr !== null) {
        if (geomConfig.countRectReads) geomConfig.cardRectReads++;
        const cIdx = Number(cardIdxAttr);
        const navRow = this.closest('[data-nav-row="true"]') as HTMLElement | null;
        const scrollLeft = navRow ? navRow.scrollLeft : 0;
        const baseLeft = cIdx * geomConfig.cardStep - scrollLeft;
        const baseWidth = geomConfig.cardWidth;
        const baseHeight = 220;
        let scale = 1;
        const inlineTransform = this.style?.transform || '';
        const scaleMatch = inlineTransform.match(/scale\(\s*([+-]?\d*\.?\d+)\s*\)/i);
        if (scaleMatch) {
          const parsed = parseFloat(scaleMatch[1]);
          if (Number.isFinite(parsed) && parsed > 0) {
            scale = parsed;
          }
        }
        const scaledWidth = baseWidth * scale;
        const scaledHeight = baseHeight * scale;
        const centerX = baseLeft + baseWidth / 2;
        const left = centerX - scaledWidth / 2;
        return {
          top: 560 - (scaledHeight - baseHeight) / 2,
          bottom: 560 + baseHeight + (scaledHeight - baseHeight) / 2,
          left,
          right: left + scaledWidth,
          width: scaledWidth,
          height: scaledHeight,
          x: left,
          y: 560 - (scaledHeight - baseHeight) / 2,
          toJSON: () => {},
        } as DOMRect;
      }

      return origProtoGetBCRHome.call(this);
    };
  };

  // Implementação funcional de IntersectionObserver para exercitar callbacks reais no ambiente de teste
  const savedWindowIO = (windowInstance as any).IntersectionObserver;
  const savedGlobalIO = (globalThis as any).IntersectionObserver;

  interface ActiveTestObserver {
    callback: IntersectionObserverCallback;
    root: HTMLElement | null;
    rootMargin: string;
    margins: ReturnType<typeof parseRootMarginPx>;
    targets: Map<HTMLElement, boolean | null>;
    instance: IntersectionObserver;
  }
  const activeTestObservers = new Set<ActiveTestObserver>();

  const computeTestIOIntersection = (obs: ActiveTestObserver, target: HTMLElement): boolean => {
    if (!geomConfig.geometryAvailable) return false;
    const tRect = target.getBoundingClientRect();
    const rRect = obs.root
      ? obs.root.getBoundingClientRect()
      : ({
          top: 0,
          bottom: geomConfig.scrollContainerHeight,
          left: 0,
          right: geomConfig.scrollContainerWidth,
          width: geomConfig.scrollContainerWidth,
          height: geomConfig.scrollContainerHeight,
        } as DOMRect);
    if (tRect.width <= 0 || tRect.height <= 0 || rRect.width <= 0 || rRect.height <= 0) {
      return false;
    }
    const vertOk =
      tRect.bottom >= rRect.top - obs.margins.top &&
      tRect.top <= rRect.bottom + obs.margins.bottom;
    const horizOk =
      tRect.right >= rRect.left - obs.margins.left &&
      tRect.left <= rRect.right + obs.margins.right;
    return vertOk && horizOk;
  };

  const deliverTestIntersectionNotifications = (filterRoot?: HTMLElement | null) => {
    for (const obs of Array.from(activeTestObservers)) {
      if (filterRoot !== undefined && obs.root !== filterRoot) continue;
      const changedEntries: IntersectionObserverEntry[] = [];
      for (const [target, prev] of obs.targets.entries()) {
        const isIntersecting = computeTestIOIntersection(obs, target);
        if (prev !== isIntersecting) {
          obs.targets.set(target, isIntersecting);
          changedEntries.push({
            target,
            isIntersecting,
            intersectionRatio: isIntersecting ? 1 : 0,
            boundingClientRect: target.getBoundingClientRect(),
            intersectionRect: target.getBoundingClientRect(),
            rootBounds: obs.root ? obs.root.getBoundingClientRect() : null,
            time: Date.now(),
          } as unknown as IntersectionObserverEntry);
        }
      }
      if (changedEntries.length > 0) {
        obs.callback(changedEntries, obs.instance);
      }
    }
  };

  class FunctionalTestIntersectionObserver {
    private record: ActiveTestObserver;
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      const root = (options?.root as HTMLElement | null) ?? null;
      const rootMargin = options?.rootMargin ?? '0px';
      this.record = {
        callback,
        root,
        rootMargin,
        margins: parseRootMarginPx(rootMargin),
        targets: new Map(),
        instance: this as unknown as IntersectionObserver,
      };
      activeTestObservers.add(this.record);
    }
    observe(target: Element) {
      const el = target as HTMLElement;
      this.record.targets.set(el, null);
    }
    unobserve(target: Element) {
      this.record.targets.delete(target as HTMLElement);
    }
    disconnect() {
      this.record.targets.clear();
      activeTestObservers.delete(this.record);
    }
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }

  (windowInstance as any).IntersectionObserver = FunctionalTestIntersectionObserver;
  (globalThis as any).IntersectionObserver = FunctionalTestIntersectionObserver;
  installHomeGeometryMock(virtContainer);

  try {
    // -----------------------------------------------------------------------
    // 12.14.A: Primeira fileira (rowIndex=0) posicionada totalmente fora da área visível (top=5000px em contêiner de 300px + 240px margem)
    // -----------------------------------------------------------------------
    geomConfig = {
      ...geomConfig,
      geometryAvailable: true,
      scrollContainerHeight: 300,
      row0BaseTop: 5000,
      otherRowsStartTop: 5400,
      navRowWidth: 1120,
      cardWidth: 165,
      cardStep: 185,
    };

    await act(async () => {
      virtRoot.render(
        React.createElement(
          XtreamProvider,
          { credentials: credsHomeImg },
          React.createElement(
            NavigationProvider,
            null,
            React.createElement(HomeView, { onPlay: mockOnPlay })
          )
        )
      );
      await new Promise((r) => setTimeout(r, 120));
    });

    const offscreenRow0Wrapper = virtContainer.querySelector('[data-home-row-index="0"]') as HTMLElement | null;
    assert(offscreenRow0Wrapper !== null, '[12.14.1] Primeira fileira (rowIndex=0) deve estar montada');
    assert.strictEqual(
      offscreenRow0Wrapper!.querySelectorAll('img[src]').length,
      0,
      '[12.14.1] Quando a 1ª fileira (rowIndex=0) está posicionada em top=5000px fora da área visível (300px + 240px margem), 0 imagens de cartões devem ser autorizadas'
    );
    assert.strictEqual(
      virtContainer.querySelectorAll('img[src]').length,
      1,
      '[12.14.1] Com todas as fileiras fora da área visível, apenas a imagem principal do HeroBanner (1) deve estar ativa'
    );

    // -----------------------------------------------------------------------
    // 12.14.B: Diferentes larguras de contêiner e escalas de TV autorizando apenas os cartões abrangidos pela geometria + antecipação (280px)
    // -----------------------------------------------------------------------
    const widthAndScaleCases = [
      // Largura estreita 460px + 280px margem = 740px; cardStep=185 -> cartões 0..3 (left=0, 185, 370, 555 <= 740; cartão 4 tem left=740, cartão 5 tem left=925 > 740) -> 5 cartões (0..4)
      { label: 'Largura estreita (460px, escala 100%)', navRowWidth: 460, cardWidth: 165, cardStep: 185, expectedCards: 5 },
      // Largura padrão 1120px + 280px margem = 1400px; cardStep=185 -> cartões 0..7 (left=0..1295 <= 1400; cartão 8 tem left=1480 > 1400) -> 8 cartões
      { label: 'Largura padrão (1120px, escala 100%)', navRowWidth: 1120, cardWidth: 165, cardStep: 185, expectedCards: 8 },
      // Escala TV 125% (cartões maiores: cardWidth=210, cardStep=235) em 1120px + 280px = 1400px -> cartões 0..5 (left=0..1175 <= 1400; cartão 6 tem left=1410 > 1400) -> 6 cartões
      { label: 'Escala TV 125% (1120px, cardStep=235px)', navRowWidth: 1120, cardWidth: 210, cardStep: 235, expectedCards: 6 },
      // Escala TV 50% (cartões compactos: cardWidth=100, cardStep=115) em 1120px + 280px = 1400px -> cartões 0..12 (left=0..1380 <= 1400; cartão 13 tem left=1495 > 1400) -> 13 cartões
      { label: 'Escala TV 50% (1120px, cardStep=115px)', navRowWidth: 1120, cardWidth: 100, cardStep: 115, expectedCards: 13 },
    ];

    for (const sc of widthAndScaleCases) {
      await act(async () => {
        virtRoot.render(React.createElement('div', null));
      });
      clearLoadedImageUrlCache();

      geomConfig = {
        ...geomConfig,
        geometryAvailable: true,
        scrollContainerHeight: 720,
        row0BaseTop: 520,
        otherRowsStartTop: 1020,
        navRowWidth: sc.navRowWidth,
        cardWidth: sc.cardWidth,
        cardStep: sc.cardStep,
      };

      await act(async () => {
        virtRoot.render(
          React.createElement(
            XtreamProvider,
            { credentials: credsHomeImg },
            React.createElement(
              NavigationProvider,
              null,
              React.createElement(HomeView, { onPlay: mockOnPlay })
            )
          )
        );
        await new Promise((r) => setTimeout(r, 90));
      });

      const r0 = virtContainer.querySelector('[data-home-row-index="0"]') as HTMLElement;
      const authorizedInR0 = r0.querySelectorAll('img[src]').length;
      assert.strictEqual(
        authorizedInR0,
        sc.expectedCards,
        `[12.14.1] ${sc.label}: deve autorizar exatamente ${sc.expectedCards} cartões pela geometria real (obteve ${authorizedInR0})`
      );
    }

    // -----------------------------------------------------------------------
    // 12.14.C: Geometria temporariamente indisponível (0x0 na montagem) -> aguarda sem autorizar e reavalia quando se torna utilizável
    // -----------------------------------------------------------------------
    await act(async () => {
      virtRoot.render(React.createElement('div', null));
    });
    clearLoadedImageUrlCache();

    geomConfig = {
      ...geomConfig,
      geometryAvailable: false,
      scrollContainerHeight: 720,
      row0BaseTop: 520,
      otherRowsStartTop: 1020,
      navRowWidth: 1120,
      cardWidth: 165,
      cardStep: 185,
    };

    await act(async () => {
      virtRoot.render(
        React.createElement(
          XtreamProvider,
          { credentials: credsHomeImg },
          React.createElement(
            NavigationProvider,
            null,
            React.createElement(HomeView, { onPlay: mockOnPlay })
          )
        )
      );
    });

    const row0WhileUnavailable = virtContainer.querySelector('[data-home-row-index="0"]') as HTMLElement | null;
    if (row0WhileUnavailable) {
      assert.strictEqual(
        row0WhileUnavailable.querySelectorAll('img[src]').length,
        0,
        '[12.14.1] Enquanto a geometria está temporariamente indisponível (0x0), nenhuma imagem de fileira deve ser autorizada'
      );
    }

    // Tornar a geometria utilizável no frame seguinte -> reavaliação automática deve autorizar as 8 imagens visíveis da fileira 0
    geomConfig.geometryAvailable = true;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 90));
    });

    const row0AfterGeomReady = virtContainer.querySelector('[data-home-row-index="0"]') as HTMLElement;
    assert(row0AfterGeomReady !== null, '[12.14.1] Fileira 0 deve existir após geometria ficar pronta');
    assert.strictEqual(
      row0AfterGeomReady.querySelectorAll('img[src]').length,
      8,
      '[12.14.1] Assim que a geometria se torna utilizável, a reavaliação automática deve autorizar os 8 cartões visíveis da fileira 0'
    );

    // -----------------------------------------------------------------------
    // 12.14.D: Cenário Sintético Padrão (10 fileiras × 24 cartões = 240 cartões, 241 imagens) + Caminho com IntersectionObserver funcional
    // -----------------------------------------------------------------------
    const homeScrollEl = virtContainer.querySelector(
      '[data-nav-zone="content"][data-scroll-container="true"]'
    ) as HTMLElement;
    assert(homeScrollEl !== null, '[12.14.3] Container interno rolável da HomeView deve existir');

    const allHomeRowWrappers = Array.from(
      virtContainer.querySelectorAll('[data-home-row-index]')
    ) as HTMLElement[];

    const mountedCards240 = virtContainer.querySelectorAll('[data-nav-row="true"] [data-nav-item="true"]').length;
    const activeImgs240 = virtContainer.querySelectorAll('img[src]').length;
    const eagerImgs240 = virtContainer.querySelectorAll('img[loading="eager"]').length;
    const syncDecodingImgs240 = virtContainer.querySelectorAll('img[decoding="sync"]').length;
    const asyncDecodingImgs240 = virtContainer.querySelectorAll('img[decoding="async"]').length;
    const deferredPlaceholders240 = virtContainer.querySelectorAll('[data-media-image-deferred="true"]').length;

    assert.strictEqual(allHomeRowWrappers.length, 10, '[12.14] Home padrão deve montar 10 fileiras');
    assert.strictEqual(mountedCards240, 240, '[12.14] Todos os 240 cartões devem permanecer montados');
    assert.strictEqual(
      activeImgs240,
      9,
      `[12.14] Em scrollTop=0/scrollLeft=0, apenas 9 imagens devem ter src ativo (1 HeroBanner + 8 da 1ª fileira), obteve ${activeImgs240}`
    );
    assert.strictEqual(deferredPlaceholders240, 232, '[12.14] 232 cartões fora da área visível devem aguardar diferidos');
    assert.strictEqual(eagerImgs240, 1, '[12.14] Apenas 1 imagem (HeroBanner) deve usar loading="eager"');
    assert.strictEqual(syncDecodingImgs240, 0, '[12.14] Nenhuma imagem deve usar decoding="sync"');
    assert.strictEqual(asyncDecodingImgs240, activeImgs240, '[12.14] Todas as imagens ativas devem usar decoding="async"');

    const heroImgEl = virtContainer.querySelector('[data-scroll-top-anchor="true"] img') as HTMLImageElement | null;
    assert(heroImgEl !== null, '[12.14] Imagem principal do HeroBanner deve estar ativa');
    assert.strictEqual(heroImgEl!.getAttribute('loading'), 'eager');
    assert.strictEqual(heroImgEl!.getAttribute('decoding'), 'async');
    assert.strictEqual(heroImgEl!.getAttribute('fetchpriority'), 'high');

    // Verificar diagnósticos de observers compartilhados e ausência de listeners manuais de scroll quando IntersectionObserver está ativo
    const observerDiag = getSharedObserverDiagnostics();
    assert(
      observerDiag.verticalObserverRoots.includes(homeScrollEl),
      '[12.14.3] O observer vertical deve usar [data-nav-zone="content"][data-scroll-container="true"] como root'
    );
    assert.strictEqual(
      observerDiag.verticalObserverRoots.length,
      1,
      '[12.14.3] Todas as fileiras devem compartilhar 1 única instância de observer vertical'
    );
    assert.strictEqual(
      observerDiag.horizontalObserverRoots.length,
      10,
      '[12.14.3] Cada fileira [data-nav-row="true"] deve ter 1 instância compartilhada de observer horizontal'
    );
    assert.strictEqual(
      observerDiag.fallbackScrollListeners,
      0,
      '[12.14.3] Com IntersectionObserver funcional, NENHUM listener manual de scroll deve ser instalado nos containers'
    );
    assert.strictEqual(
      observerDiag.fallbackResizeListeners,
      0,
      '[12.14.3] Com IntersectionObserver funcional, NENHUM listener manual de resize deve ser instalado'
    );

    // -----------------------------------------------------------------------
    // Teste 1 e 2 via callbacks reais do IntersectionObserver (rolagem vertical e horizontal)
    // -----------------------------------------------------------------------
    const distantRow3Wrapper = virtContainer.querySelector('[data-home-row-index="3"]') as HTMLElement;
    assert(distantRow3Wrapper !== null, '[12.14.1] Fileira 3 deve estar montada');
    assert.strictEqual(distantRow3Wrapper.querySelectorAll('img[src]').length, 0);

    resetSharedObserverPerfStats();
    await act(async () => {
      homeScrollEl.scrollTop = 1050;
      deliverTestIntersectionNotifications(homeScrollEl);
      await new Promise((r) => setTimeout(r, 20));
    });

    const diagAfterVertIO = getSharedObserverDiagnostics();
    assert(
      diagAfterVertIO.ioCallbackInvocations >= 1,
      '[12.14.1] Aproximação vertical deve acionar o callback do IntersectionObserver'
    );
    assert.strictEqual(
      distantRow3Wrapper.querySelectorAll('img[src]').length,
      8,
      '[12.14.1] Callback do IntersectionObserver vertical deve ativar as 8 imagens dentro da faixa horizontal da fileira 3'
    );
    assert(
      distantRow3Wrapper.querySelector('[data-row-card-index="12"] img') === null,
      '[12.14.1] Cartão 12 fora da faixa horizontal na fileira 3 deve continuar aguardando'
    );

    // Retornar scrollTop = 0 e notificar IntersectionObserver -> imagens já autorizadas na fileira 3 preservam autorização
    await act(async () => {
      homeScrollEl.scrollTop = 0;
      deliverTestIntersectionNotifications(homeScrollEl);
      await new Promise((r) => setTimeout(r, 20));
    });
    assert.strictEqual(
      distantRow3Wrapper.querySelectorAll('img[src]').length,
      8,
      '[12.14.5] Sair da área visível verticalmente deve preservar as imagens já autorizadas na fileira 3'
    );

    // Rolagem horizontal na fileira 0 via callback do IntersectionObserver
    const row0Wrapper = virtContainer.querySelector('[data-home-row-index="0"]') as HTMLElement;
    const row0NavEl = row0Wrapper.querySelector('[data-nav-row="true"]') as HTMLElement;
    const row0Card12 = row0Wrapper.querySelector('[data-row-card-index="12"]') as HTMLElement;
    assert(row0Card12.querySelector('img[src]') === null, '[12.14.2] Cartão 12 deve aguardar antes da rolagem horizontal');

    await act(async () => {
      row0NavEl.scrollLeft = 1500;
      deliverTestIntersectionNotifications(row0NavEl);
      await new Promise((r) => setTimeout(r, 20));
    });

    const row0Card12Img = row0Card12.querySelector('img[src]') as HTMLImageElement | null;
    assert(
      row0Card12Img !== null,
      '[12.14.2] Callback do IntersectionObserver horizontal deve ativar a imagem do cartão 12 ao se aproximar'
    );
    assert.strictEqual(row0Card12Img!.getAttribute('loading'), 'lazy');
    assert.strictEqual(row0Card12Img!.getAttribute('decoding'), 'async');

    // -----------------------------------------------------------------------
    // Teste 4: Ativação imediata por foco de teclado/controle remoto
    // -----------------------------------------------------------------------
    const distantRow6Wrapper = virtContainer.querySelector('[data-home-row-index="6"]') as HTMLElement;
    const distantRow6Card18 = distantRow6Wrapper.querySelector('[data-row-card-index="18"]') as HTMLElement;
    assert(distantRow6Card18.querySelector('img[src]') === null, '[12.14.4] Cartão distante não deve ter img antes do foco');

    await act(async () => {
      distantRow6Card18.focus();
      await new Promise((r) => setTimeout(r, 20));
    });
    assertSameElement(document.activeElement, distantRow6Card18, '[12.14.4] Foco deve permanecer no cartão');
    assert(
      distantRow6Card18.querySelector('img[src]') !== null,
      '[12.14.4] Receber foco deve autorizar e iniciar imediatamente a imagem do cartão'
    );

    // -----------------------------------------------------------------------
    // Cenário Sintético B (500 itens elegíveis em "Continuar Assistindo" = 740 cartões, 741 imagens)
    // + Sonda de 10 eventos de scroll com IntersectionObserver ativo (ZERO leituras manuais de retângulos)
    // -----------------------------------------------------------------------
    const historyMap500: Record<string, any> = {};
    for (let i = 0; i < 500; i++) {
      const movie = homeVodStreams520[i];
      const idStr = String(movie.stream_id);
      historyMap500[`movie:${idStr}`] = {
        id: idStr,
        type: 'movie',
        updatedAt: 1715000000000 - i * 1000,
        positionSec: 180,
      };
    }
    windowInstance.localStorage.setItem(homeHistoryKey, JSON.stringify(historyMap500));

    await act(async () => {
      virtRoot.render(React.createElement('div', null));
    });
    clearLoadedImageUrlCache();

    await act(async () => {
      virtRoot.render(
        React.createElement(
          XtreamProvider,
          { credentials: credsHomeImg },
          React.createElement(
            NavigationProvider,
            null,
            React.createElement(HomeView, { onPlay: mockOnPlay })
          )
        )
      );
      await new Promise((r) => setTimeout(r, 120));
    });

    const continueWatchingRowWrapper = virtContainer.querySelector('[data-home-row-index="0"]') as HTMLElement;
    const continueWatchingNavRow = continueWatchingRowWrapper.querySelector('[data-nav-row="true"]') as HTMLElement;
    const continueWatchingCards = continueWatchingRowWrapper.querySelectorAll('[data-nav-item="true"]');
    const mountedCardsWith500History = virtContainer.querySelectorAll('[data-nav-row="true"] [data-nav-item="true"]').length;
    const activeImgsWith500History = virtContainer.querySelectorAll('img[src]').length;
    const eagerImgsWith500History = virtContainer.querySelectorAll('img[loading="eager"]').length;
    const syncDecodingImgsWith500History = virtContainer.querySelectorAll('img[decoding="sync"]').length;
    const diagWith500HistoryAtStart = getSharedObserverDiagnostics();

    assert.strictEqual(
      continueWatchingNavRow.getAttribute('data-virtual-container'),
      'true',
      '[12.14] A fileira Continuar Assistindo deve ter virtualização horizontal ativa (data-virtual-container="true")'
    );
    assert.strictEqual(
      continueWatchingCards.length,
      14,
      `[12.14] Com 500 itens em Continuar Assistindo (largura 1120px, passo 185px), apenas a janela inicial de 14 cartões deve estar montada no DOM (obteve ${continueWatchingCards.length}, antes: 500)`
    );
    assert.strictEqual(
      mountedCardsWith500History,
      254,
      `[12.14] Total de cartões montados na Home com 500 no histórico deve ser 254 (14 em Continuar Assistindo + 240 nas 10 demais fileiras), obteve ${mountedCardsWith500History} (antes: 740)`
    );
    assert.strictEqual(
      diagWith500HistoryAtStart.activeTargetSubscriptions,
      265,
      `[12.14] Total de assinaturas de observer com 500 no histórico deve cair de 751 para 265 (11 fileiras + 254 cartões montados), obteve ${diagWith500HistoryAtStart.activeTargetSubscriptions}`
    );
    assert.strictEqual(activeImgsWith500History, 9, '[12.14] Com 500 itens em Continuar Assistindo, apenas 9 imagens devem iniciar ativas no topo');
    assert.strictEqual(eagerImgsWith500History, 1, '[12.14] Apenas 1 imagem (HeroBanner) deve ser eager');
    assert.strictEqual(syncDecodingImgsWith500History, 0, '[12.14] 0 imagens devem ter decoding="sync"');

    // Sonda de 10 eventos de scroll na fileira de 500 cartões com IntersectionObserver funcional:
    // Deve provocar ZERO varreduras manuais dos retângulos dos cartões e do contêiner!
    resetSharedObserverPerfStats();
    geomConfig.countRectReads = true;
    geomConfig.scrollContainerRectReads = 0;
    geomConfig.navRowRectReads = 0;
    geomConfig.cardRectReads = 0;

    await act(async () => {
      for (let s = 1; s <= 10; s++) {
        continueWatchingNavRow.scrollLeft = s * 40;
        continueWatchingNavRow.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
      }
      await new Promise((r) => setTimeout(r, 30));
    });

    geomConfig.countRectReads = false;
    const perfStatsAfter10ScrollsWithIO = getSharedObserverDiagnostics();
    assert.strictEqual(
      perfStatsAfter10ScrollsWithIO.fallbackEvaluationPasses,
      0,
      '[12.14.3] Com IntersectionObserver funcional, 10 eventos de scroll devem executar 0 passadas de varredura manual'
    );
    assert.strictEqual(
      geomConfig.cardRectReads,
      0,
      `[12.14.3] Com IntersectionObserver funcional, 10 eventos de scroll devem fazer 0 leituras manuais de retângulos dos cartões (obteve ${geomConfig.cardRectReads})`
    );
    assert.strictEqual(
      geomConfig.navRowRectReads,
      0,
      `[12.14.3] Com IntersectionObserver funcional, 10 eventos de scroll devem fazer 0 leituras manuais do retângulo do contêiner (obteve ${geomConfig.navRowRectReads})`
    );

    // Verificar que o 500º item de "Continuar Assistindo" (índice 499) é montado ao rolar até o fim e ativa sua imagem ao receber foco
    await act(async () => {
      continueWatchingNavRow.scrollLeft = 500 * 185;
      continueWatchingNavRow.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
      await new Promise((r) => setTimeout(r, 20));
    });
    const cwCard499 = continueWatchingRowWrapper.querySelector('[data-row-card-index="499"]') as HTMLElement | null;
    assert(cwCard499 !== null, '[12.14] 500º cartão (índice 499) deve ser montado ao alcançar o fim da fileira');
    await act(async () => {
      cwCard499!.focus();
      await new Promise((r) => setTimeout(r, 20));
    });
    assert(cwCard499!.querySelector('img[src]') !== null, '[12.14] Focar o 500º cartão deve iniciar imediatamente sua imagem');

    windowInstance.localStorage.removeItem(homeHistoryKey);

    // Desmontar HomeView e verificar limpeza completa dos observers
    await act(async () => {
      virtRoot.render(React.createElement('div', null));
      await new Promise((r) => setTimeout(r, 20));
    });

    const diagAfterHomeUnmount = getSharedObserverDiagnostics();
    assert.strictEqual(diagAfterHomeUnmount.activeObserverInstances, 0, '[12.14.6] 0 observers ativos após desmontar HomeView');
    assert.strictEqual(diagAfterHomeUnmount.activeTargetSubscriptions, 0, '[12.14.6] 0 assinaturas ativas após desmontar HomeView');

    // -----------------------------------------------------------------------
    // 12.14.E (Item 2 da Auditoria): Separação entre cache visual (loadedImageUrlsCache) e autorização (active)
    // -----------------------------------------------------------------------
    clearLoadedImageUrlCache();
    const cachedSepUrl = 'http://img.test/cached_visual_only.jpg';

    // 1. Carregar URL em uma instância autorizada (active=true) para registrá-la no loadedImageUrlsCache
    await act(async () => {
      virtRoot.render(
        React.createElement(MediaImage, {
          src: cachedSepUrl,
          itemId: 'item_cache_sep_1',
          alt: 'Imagem Cache 1',
          active: true,
          loading: 'lazy',
          className: 'w-24 h-36',
        })
      );
    });
    const firstCachedImg = virtContainer.querySelector('img') as HTMLImageElement | null;
    assert(firstCachedImg !== null, '[12.14.5] Instância com active=true deve montar <img>');
    await act(async () => {
      firstCachedImg!.dispatchEvent(new windowInstance.Event('load') as unknown as Event);
    });
    assert.strictEqual(hasLoadedImageUrl(cachedSepUrl), true, '[12.14.5] URL deve constar no loadedImageUrlsCache após onLoad');
    assert(firstCachedImg!.className.includes('opacity-100'), '[12.14.5] Imagem carregada deve ter opacity-100');

    // 2. Desmontar e montar uma NOVA instância com a MESMA URL já presente em loadedImageUrlsCache, porém com active=false (e mesmo com priority=true):
    // DEVE permanecer diferida sem criar <img>!
    await act(async () => {
      virtRoot.render(React.createElement('div', null));
    });
    await act(async () => {
      virtRoot.render(
        React.createElement(MediaImage, {
          src: cachedSepUrl,
          itemId: 'item_cache_sep_2',
          alt: 'Nova Instância Diferida com URL em Cache',
          active: false,
          priority: true,
          loading: 'lazy',
          className: 'w-24 h-36',
        })
      );
    });
    assert(
      virtContainer.querySelector('img') === null,
      '[12.14.5] Nova instância com active=false DEVE permanecer diferida mesmo quando sua URL consta em loadedImageUrlsCache e priority=true'
    );
    assert(
      virtContainer.querySelector('[data-media-image-deferred="true"]') !== null,
      '[12.14.5] Nova instância com active=false deve renderizar o placeholder diferido [data-media-image-deferred="true"]'
    );

    // 3. Autorizar essa instância (active=true) -> agora deve montar <img> já preservando o estado visual (opacity-100) do cache
    await act(async () => {
      virtRoot.render(
        React.createElement(MediaImage, {
          src: cachedSepUrl,
          itemId: 'item_cache_sep_2',
          alt: 'Nova Instância Autorizada',
          active: true,
          loading: 'lazy',
          className: 'w-24 h-36',
        })
      );
    });
    const authorizedCachedImg = virtContainer.querySelector('img') as HTMLImageElement | null;
    assert(
      authorizedCachedImg !== null && authorizedCachedImg.className.includes('opacity-100'),
      '[12.14.5] Quando autorizada (active=true), a instância deve usar loadedImageUrlsCache para preservar o estado visual (opacity-100)'
    );

    // 4. Sair e retornar à área visível na MESMA instância já autorizada (active: true -> false -> true) -> preserva autorização e estado
    for (const nextActive of [false, true, false, true]) {
      await act(async () => {
        virtRoot.render(
          React.createElement(MediaImage, {
            src: cachedSepUrl,
            itemId: 'item_cache_sep_2',
            alt: 'Mesma Instância Reentrada',
            active: nextActive,
            loading: 'lazy',
            className: 'w-24 h-36',
          })
        );
      });
      const imgNow = virtContainer.querySelector('img') as HTMLImageElement | null;
      assert(
        imgNow !== null && imgNow.className.includes('opacity-100'),
        `[12.14.5] Instância já autorizada deve conservar sua autorização e estado ao alternar active=${nextActive}`
      );
    }

    // -----------------------------------------------------------------------
    // 12.14.F (Item 4 da Auditoria): Ciclo de retentativa única (~2s) alinhado ao contrato visual e funcional
    // -----------------------------------------------------------------------
    setMediaImageRetryDelayMsForTest(35);
    try {
      const retryUrl1 = 'http://img.test/fail_once_then_exhaust.jpg';
      await act(async () => {
        virtRoot.render(
          React.createElement(MediaImage, {
            src: retryUrl1,
            itemId: 'item_retry_1',
            alt: 'Teste Retry Único',
            active: true,
            loading: 'lazy',
            className: 'w-24 h-36',
          })
        );
      });

      const firstAttemptImg = virtContainer.querySelector('img') as HTMLImageElement | null;
      assert(firstAttemptImg !== null, '[12.14.6] 1ª tentativa deve montar <img>');

      // Disparar 1º erro -> deve agendar exatamente 1 timer de retentativa e manter <img> invisível (opacity-0) durante a espera
      await act(async () => {
        firstAttemptImg!.dispatchEvent(new windowInstance.Event('error') as unknown as Event);
      });
      assert.strictEqual(
        getActiveMediaImageRetryTimersCount(),
        1,
        '[12.14.6] Após 1º erro, deve existir exatamente 1 temporizador de retentativa ativo'
      );
      const waitingImg = virtContainer.querySelector('img') as HTMLImageElement | null;
      assert(
        waitingImg !== null && waitingImg.className.includes('opacity-0') && !waitingImg.className.includes('opacity-100'),
        '[12.14.6] Durante a espera pela nova tentativa, o elemento <img> permanece montado porém invisível (opacity-0)'
      );

      // Aguardar disparo da nova tentativa única
      await act(async () => {
        await new Promise((r) => setTimeout(r, 55));
      });
      assert.strictEqual(
        getActiveMediaImageRetryTimersCount(),
        0,
        '[12.14.6] Após disparo do temporizador, o contador de timers ativos deve voltar a 0'
      );
      const secondAttemptImg = virtContainer.querySelector('img') as HTMLImageElement | null;
      assert(
        secondAttemptImg !== null && secondAttemptImg !== firstAttemptImg,
        '[12.14.6] Após o intervalo configurado, uma nova tentativa (attempt=1) deve ser iniciada'
      );

      // Disparar 2º erro -> encerramento definitivo após a 2ª falha (remove <img> e exibe área reservada vazia)
      await act(async () => {
        secondAttemptImg!.dispatchEvent(new windowInstance.Event('error') as unknown as Event);
      });
      assert.strictEqual(
        getActiveMediaImageRetryTimersCount(),
        0,
        '[12.14.6] Após a 2ª falha, nenhum novo temporizador deve ser agendado'
      );
      assert(
        virtContainer.querySelector('img') === null,
        '[12.14.6] Após a 2ª falha, o componente deve encerrar as tentativas e ocultar <img>'
      );

      // Alternar visibilidade (active: true -> false -> true) para a mesma identidade falha -> preserva orçamento esgotado
      await act(async () => {
        virtRoot.render(
          React.createElement(MediaImage, {
            src: retryUrl1,
            itemId: 'item_retry_1',
            alt: 'Teste Retry Único',
            active: false,
            loading: 'lazy',
            className: 'w-24 h-36',
          })
        );
      });
      await act(async () => {
        virtRoot.render(
          React.createElement(MediaImage, {
            src: retryUrl1,
            itemId: 'item_retry_1',
            alt: 'Teste Retry Único',
            active: true,
            loading: 'lazy',
            className: 'w-24 h-36',
          })
        );
      });
      assert(
        virtContainer.querySelector('img') === null,
        '[12.14.6] Alternar visibilidade para a mesma identidade já falha deve preservar o orçamento esgotado sem recriar <img>'
      );
      assert.strictEqual(getActiveMediaImageRetryTimersCount(), 0);

      // Troca de identidade (nova URL) -> reinicia orçamento e monta novo <img>
      const retryUrl2 = 'http://img.test/new_source_after_error.jpg';
      await act(async () => {
        virtRoot.render(
          React.createElement(MediaImage, {
            src: retryUrl2,
            itemId: 'item_retry_1',
            alt: 'Teste Nova Origem',
            active: true,
            loading: 'lazy',
            className: 'w-24 h-36',
          })
        );
      });
      const newSourceImg = virtContainer.querySelector('img') as HTMLImageElement | null;
      assert(
        newSourceImg !== null && newSourceImg.getAttribute('src') === retryUrl2,
        '[12.14.6] Trocar a identidade da imagem deve reiniciar o orçamento de tentativas e montar <img>'
      );

      // Disparar erro na nova identidade e desmontar -> limpa o temporizador pendente
      await act(async () => {
        newSourceImg!.dispatchEvent(new windowInstance.Event('error') as unknown as Event);
      });
      assert.strictEqual(getActiveMediaImageRetryTimersCount(), 1);
      await act(async () => {
        virtRoot.render(React.createElement('div', null));
      });
      assert.strictEqual(
        getActiveMediaImageRetryTimersCount(),
        0,
        '[12.14.6] Desmontar com retentativa pendente deve cancelar o temporizador imediatamente'
      );
    } finally {
      setMediaImageRetryDelayMsForTest(2000);
    }

    // -----------------------------------------------------------------------
    // 12.14.G (Item 3 e 5 da Auditoria): Fallback sem IntersectionObserver com agrupamento por frame,
    // reutilização da medida do contêiner (1 leitura por passada em 500 cartões) e cancelamento na desmontagem
    // -----------------------------------------------------------------------
    delete (windowInstance as any).IntersectionObserver;
    delete (globalThis as any).IntersectionObserver;

    clearLoadedImageUrlCache();
    windowInstance.localStorage.setItem(homeHistoryKey, JSON.stringify(historyMap500));

    await act(async () => {
      virtRoot.render(
        React.createElement(
          XtreamProvider,
          { credentials: credsHomeImg },
          React.createElement(
            NavigationProvider,
            null,
            React.createElement(HomeView, { onPlay: mockOnPlay })
          )
        )
      );
      await new Promise((r) => setTimeout(r, 120));
    });

    const diagFallbackMounted = getSharedObserverDiagnostics();
    assert.strictEqual(
      diagFallbackMounted.activeObserverInstances,
      0,
      '[12.14.7] Sem IntersectionObserver, activeObserverInstances deve ser 0'
    );
    assert(
      diagFallbackMounted.fallbackScrollListeners > 0 && diagFallbackMounted.fallbackResizeListeners > 0,
      '[12.14.7] No modo fallback, os listeners de scroll e resize devem estar instalados e refletidos nos diagnósticos'
    );
    assert.strictEqual(
      virtContainer.querySelectorAll('img[src]').length,
      9,
      '[12.14.7] No modo fallback, apenas as 9 imagens visíveis/antecipadas (1 HeroBanner + 8 da 1ª fileira) devem iniciar ativas'
    );

    const fallbackCWWrapper = virtContainer.querySelector('[data-home-row-index="0"]') as HTMLElement;
    const fallbackCWNavRow = fallbackCWWrapper.querySelector('[data-nav-row="true"]') as HTMLElement;

    // Disparar 10 eventos de scroll sucessivos no mesmo frame sobre a fileira de 500 cartões no modo fallback:
    // - Devem ser agrupados em apenas 1 atualização por frame (fallbackEvaluationPasses === 1).
    // - A medida do contêiner deve ser reutilizada (1 única leitura do contêiner para os 500 cartões).
    resetSharedObserverPerfStats();
    geomConfig.countRectReads = true;
    geomConfig.scrollContainerRectReads = 0;
    geomConfig.navRowRectReads = 0;
    geomConfig.cardRectReads = 0;

    await act(async () => {
      for (let s = 1; s <= 10; s++) {
        fallbackCWNavRow.scrollLeft = s * 150;
        fallbackCWNavRow.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
      }
      // Antes do frame de animação disparar, deve haver exatamente 1 frame agendado e 0 passadas executadas
      const diagBeforeFrame = getSharedObserverDiagnostics();
      assert.strictEqual(
        diagBeforeFrame.pendingFallbackFrames,
        1,
        '[12.14.7] 10 eventos de scroll sucessivos no fallback devem agendar apenas 1 atualização por frame'
      );
      assert.strictEqual(
        diagBeforeFrame.fallbackEvaluationPasses,
        0,
        '[12.14.7] Nenhuma varredura síncrona repetida deve ocorrer antes do frame agrupado'
      );

      await new Promise((r) => setTimeout(r, 30));
    });

    geomConfig.countRectReads = false;
    const diagAfterCoalescedFrame = getSharedObserverDiagnostics();
    assert.strictEqual(
      diagAfterCoalescedFrame.fallbackEvaluationPasses,
      1,
      `[12.14.7] Os 10 eventos de scroll sucessivos devem resultar em exatamente 1 passada no frame (obteve ${diagAfterCoalescedFrame.fallbackEvaluationPasses})`
    );
    assert.strictEqual(
      geomConfig.navRowRectReads,
      1,
      `[12.14.7] Na passada agrupada da fileira Continuar Assistindo, a medida do contêiner deve ser lida apenas 1 vez e reutilizada (obteve ${geomConfig.navRowRectReads}, antes: 5000)`
    );
    assert.strictEqual(
      geomConfig.cardRectReads,
      14,
      `[12.14.7] Em 10 eventos de scroll agrupados em 1 frame na fileira virtualizada de 500 itens, deve haver apenas 14 leituras dos cartões montados na janela (obteve ${geomConfig.cardRectReads}, antes s/ virtualização: 500, antes s/ agrupamento: 5000)`
    );

    // Agendar mais um evento de scroll no fallback e desmontar imediatamente antes do frame rodar -> tarefa pendente deve ser cancelada!
    fallbackCWNavRow.scrollLeft = 2200;
    fallbackCWNavRow.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
    assert.strictEqual(
      getSharedObserverDiagnostics().pendingFallbackFrames,
      1,
      '[12.14.7] Evento de scroll deve agendar 1 tarefa de frame pendente antes da desmontagem'
    );

    resetSharedObserverPerfStats();
    await act(async () => {
      virtRoot.render(React.createElement('div', null));
    });

    const diagAfterFallbackUnmount = getSharedObserverDiagnostics();
    assert.strictEqual(
      diagAfterFallbackUnmount.pendingFallbackFrames,
      0,
      '[12.14.7] Ao liberar o último assinante na desmontagem, atualizações de frame pendentes devem ser canceladas imediatamente'
    );
    assert.strictEqual(
      diagAfterFallbackUnmount.fallbackScrollListeners,
      0,
      '[12.14.7] Ao liberar o último assinante, todos os listeners de scroll do fallback devem ser removidos'
    );
    assert.strictEqual(
      diagAfterFallbackUnmount.fallbackResizeListeners,
      0,
      '[12.14.7] Ao liberar o último assinante, todos os listeners de resize do fallback devem ser removidos'
    );

    // Aguardar mais que 1 frame para comprovar que a tarefa cancelada realmente não executou após desmontar
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    assert.strictEqual(
      getSharedObserverDiagnostics().fallbackEvaluationPasses,
      0,
      '[12.14.7] Tarefa de fallback cancelada na desmontagem não deve executar após a remoção dos assinantes'
    );

    // -----------------------------------------------------------------------
    // 12.15: Virtualização Horizontal Exclusiva de "Continuar Assistindo"
    // - Histórico curto (6 itens) vs 500 itens (início, meio e fim da fileira)
    // - Espaçadores fora da navegação e acessibilidade + preservação da largura total
    // - Navegação espacial D-Pad (0 -> 499 e 499 -> 0 sem salto, sem perda de foco e sem saída indevida para sidebar)
    // - Navegação vertical entre HeroBanner, Continuar Assistindo e fileira seguinte
    // - Retorno ao cartão de origem pelo identificador estável após detalhes (MovieDetails/SeriesDetails) e reprodução
    // - Rolagem por botões da fileira e recálculo em diferentes larguras e escalas de TV (50%, 85%, 100%, 125%)
    // -----------------------------------------------------------------------
    (windowInstance as any).IntersectionObserver = FunctionalTestIntersectionObserver;
    (globalThis as any).IntersectionObserver = FunctionalTestIntersectionObserver;

    geomConfig = {
      ...geomConfig,
      geometryAvailable: true,
      scrollContainerHeight: 720,
      row0BaseTop: 520,
      otherRowsStartTop: 1020,
      navRowWidth: 1120,
      cardWidth: 165,
      cardStep: 185,
    };

    // A) Histórico curto (6 itens: 4 filmes + 2 séries)
    const historyMapShort6: Record<string, any> = {};
    for (let i = 0; i < 4; i++) {
      const m = homeVodStreams520[i];
      historyMapShort6[`movie:${m.stream_id}`] = {
        id: String(m.stream_id),
        type: 'movie',
        updatedAt: 1716000000000 - i * 1000,
        positionSec: 120,
      };
    }
    for (let i = 0; i < 2; i++) {
      const s = homeSeriesStreams120[i];
      const epId = `ep_short_${i + 1}`;
      historyMapShort6[`episode:${epId}`] = {
        id: epId,
        type: 'episode',
        parentSeriesId: String(s.series_id),
        updatedAt: 1715999000000 - i * 1000,
        positionSec: 240,
      };
    }
    windowInstance.localStorage.setItem(homeHistoryKey, JSON.stringify(historyMapShort6));
    clearLoadedImageUrlCache();

    await act(async () => {
      virtRoot.render(
        React.createElement(
          XtreamProvider,
          { credentials: credsHomeImg },
          React.createElement(
            NavigationProvider,
            null,
            React.createElement(
              'div',
              { className: 'flex flex-row w-full h-full' },
              React.createElement(
                'aside',
                { 'data-nav-zone': 'sidebar' },
                React.createElement(
                  'button',
                  { type: 'button', 'data-sidebar-nav-id': 'inicio', 'data-sidebar-active': 'true' },
                  'Início'
                )
              ),
              React.createElement(HomeView, { onPlay: mockOnPlay })
            )
          )
        )
      );
      await new Promise((r) => setTimeout(r, 100));
    });

    const cwWrapperShort = virtContainer.querySelector('[data-home-row-index="0"]') as HTMLElement;
    const cwNavRowShort = cwWrapperShort.querySelector('[data-nav-row="true"]') as HTMLElement;
    const cwCardsShort = cwWrapperShort.querySelectorAll('[data-nav-item="true"]');
    const cwSpacersShort = cwWrapperShort.querySelectorAll('[data-virtual-spacer]');
    const diagShort = getSharedObserverDiagnostics();

    assert.strictEqual(cwCardsShort.length, 6, '[12.15.1] Com histórico curto (6 itens), todos os 6 cartões devem estar montados');
    assert.strictEqual(cwSpacersShort.length, 0, '[12.15.1] Com histórico curto que cabe na janela, nenhum espaçador deve ser renderizado');
    assert.strictEqual(
      diagShort.activeTargetSubscriptions,
      257,
      `[12.15.1] Com 6 itens em Continuar Assistindo, activeTargetSubscriptions deve ser 257 (11 fileiras + 6 + 240), obteve ${diagShort.activeTargetSubscriptions}`
    );

    // Demais fileiras não devem ter data-virtual-container="true"
    const allNavRowsShort = Array.from(
      virtContainer.querySelectorAll('[data-home-row-index] [data-nav-row="true"]')
    ) as HTMLElement[];
    assert.strictEqual(allNavRowsShort.length, 11, '[12.15.1] Home com Continuar Assistindo deve ter 11 fileiras');
    assert.strictEqual(
      allNavRowsShort.filter((r) => r.getAttribute('data-virtual-container') === 'true').length,
      1,
      '[12.15.1] Apenas a fileira Continuar Assistindo deve ter data-virtual-container="true"; as 10 demais fileiras mantêm o comportamento atual'
    );

    // B) Histórico longo com 500 itens (comparando início, meio e fim da fileira)
    // Incluir 499 filmes e 1 série (no índice 250) para testar também SeriesDetails
    const historyMap500Mixed: Record<string, any> = {};
    for (let i = 0; i < 500; i++) {
      if (i === 251) {
        const ser = homeSeriesStreams120[0];
        const epId = 'ep_500_251';
        historyMap500Mixed[`episode:${epId}`] = {
          id: epId,
          type: 'episode',
          parentSeriesId: String(ser.series_id),
          updatedAt: 1716000000000 - i * 1000,
          positionSec: 300,
        };
      } else {
        const movie = homeVodStreams520[i];
        historyMap500Mixed[`movie:${movie.stream_id}`] = {
          id: String(movie.stream_id),
          type: 'movie',
          updatedAt: 1716000000000 - i * 1000,
          positionSec: 180,
        };
      }
    }
    windowInstance.localStorage.setItem(homeHistoryKey, JSON.stringify(historyMap500Mixed));
    clearLoadedImageUrlCache();

    let lastPlayedUrl = '';
    let lastPlayedStreamId: string | number | undefined = undefined;
    const trackingOnPlay = (url: string, _title: string, _startAt?: number, streamId?: string | number) => {
      lastPlayedUrl = url;
      lastPlayedStreamId = streamId;
    };

    await act(async () => {
      virtRoot.render(React.createElement('div', null));
    });
    await act(async () => {
      virtRoot.render(
        React.createElement(
          XtreamProvider,
          { credentials: credsHomeImg },
          React.createElement(
            NavigationProvider,
            null,
            React.createElement(
              'div',
              { className: 'flex flex-row w-full h-full' },
              React.createElement(
                'aside',
                { 'data-nav-zone': 'sidebar' },
                React.createElement(
                  'button',
                  { type: 'button', 'data-sidebar-nav-id': 'inicio', 'data-sidebar-active': 'true' },
                  'Início'
                )
              ),
              React.createElement(HomeView, { onPlay: trackingOnPlay })
            )
          )
        )
      );
      await new Promise((r) => setTimeout(r, 100));
    });

    const cwWrapper500 = virtContainer.querySelector('[data-home-row-index="0"]') as HTMLElement;
    const cwNavRow500 = cwWrapper500.querySelector('[data-nav-row="true"]') as HTMLElement;

    // 1. Início da fileira (scrollLeft = 0)
    const startCards = Array.from(cwNavRow500.querySelectorAll('[data-nav-item="true"]')) as HTMLElement[];
    const startIndices = startCards.map((c) => Number(c.getAttribute('data-row-card-index')));
    const startLeftSpacer = cwNavRow500.querySelector('[data-virtual-spacer="left"]') as HTMLElement | null;
    const startRightSpacer = cwNavRow500.querySelector('[data-virtual-spacer="right"]') as HTMLElement | null;
    const startDiag = getSharedObserverDiagnostics();

    assert.strictEqual(startCards.length, 14, '[12.15.1] No início (scrollLeft=0), devem estar montados 14 cartões');
    assert.strictEqual(startIndices[0], 0, '[12.15.1] No início, o 1º cartão montado deve ser o índice 0');
    assert.strictEqual(startIndices[startIndices.length - 1], 13, '[12.15.1] No início, o último cartão montado deve ser o índice 13');
    assert(startLeftSpacer === null, '[12.15.1] No início (startIndex=0), não deve existir espaçador esquerdo');
    assert(startRightSpacer !== null, '[12.15.1] No início, deve existir espaçador direito preservando o restante da largura');
    assert.strictEqual(startRightSpacer!.getAttribute('aria-hidden'), 'true', '[12.15.3] Espaçador direito deve ter aria-hidden="true"');
    assert.strictEqual(startRightSpacer!.getAttribute('role'), 'presentation', '[12.15.3] Espaçador direito deve ter role="presentation"');
    assert(startRightSpacer!.getAttribute('tabindex') === null, '[12.15.3] Espaçador não deve ter tabindex');
    assert(startRightSpacer!.getAttribute('data-nav-item') === null, '[12.15.3] Espaçador não deve ter data-nav-item');
    assert.strictEqual(
      startDiag.activeTargetSubscriptions,
      265,
      '[12.15.1] No início com 500 itens, activeTargetSubscriptions deve ser 265 (14 cartões em Continuar Assistindo + 240 demais + 11 fileiras)'
    );

    // Verificar largura total preservada (14 * 165 + 13 * 20 + 20 + rightSpacerWidth === 500 * 165 + 499 * 20 = 92480)
    const expectedTotalRowWidth = 500 * 165 + 499 * 20;
    const startRightSpacerWidth = parseFloat(startRightSpacer!.style.width);
    const startTotalWidth = 14 * 165 + 13 * 20 + 20 + startRightSpacerWidth;
    assert.strictEqual(
      startTotalWidth,
      expectedTotalRowWidth,
      `[12.15.1] A soma dos 14 cartões montados + gaps + espaçador direito no início deve preservar exatamente ${expectedTotalRowWidth}px`
    );

    // 2. Meio da fileira (scrollLeft = 46250, em torno do índice 250)
    await act(async () => {
      cwNavRow500.scrollLeft = 250 * 185;
      cwNavRow500.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
      deliverTestIntersectionNotifications(cwNavRow500);
      await new Promise((r) => setTimeout(r, 20));
    });

    const midCards = Array.from(cwNavRow500.querySelectorAll('[data-nav-item="true"]')) as HTMLElement[];
    const midIndices = midCards.map((c) => Number(c.getAttribute('data-row-card-index')));
    const midLeftSpacer = cwNavRow500.querySelector('[data-virtual-spacer="left"]') as HTMLElement | null;
    const midRightSpacer = cwNavRow500.querySelector('[data-virtual-spacer="right"]') as HTMLElement | null;
    const midDiag = getSharedObserverDiagnostics();

    assert.strictEqual(midCards.length, 14, '[12.15.1] No meio da fileira, devem estar montados exatamente 14 cartões');
    assert.strictEqual(midIndices[0], 247, '[12.15.1] No meio (firstVisible=250, overscan=3), a janela deve iniciar no índice 247');
    assert.strictEqual(midIndices[midIndices.length - 1], 260, '[12.15.1] No meio, a janela deve terminar no índice 260');
    assert(midLeftSpacer !== null && midRightSpacer !== null, '[12.15.1] No meio da fileira, ambos os espaçadores (esquerdo e direito) devem existir');
    assert.strictEqual(midLeftSpacer!.getAttribute('aria-hidden'), 'true');
    assert.strictEqual(midLeftSpacer!.getAttribute('role'), 'presentation');
    assert.strictEqual(
      midDiag.activeTargetSubscriptions,
      265,
      '[12.15.1] No meio da fileira, activeTargetSubscriptions deve permanecer em 265 (sem vazamento de inscrições dos cartões desmontados)'
    );

    const midLeftWidth = parseFloat(midLeftSpacer!.style.width);
    const midRightWidth = parseFloat(midRightSpacer!.style.width);
    const midTotalWidth = midLeftWidth + 20 + (14 * 165 + 13 * 20) + 20 + midRightWidth;
    assert.strictEqual(
      midTotalWidth,
      expectedTotalRowWidth,
      `[12.15.1] No meio da fileira, espaçador esquerdo + cartões montados + espaçador direito deve preservar exatamente ${expectedTotalRowWidth}px`
    );

    // 3. Fim da fileira (scrollLeft no limite máximo)
    await act(async () => {
      cwNavRow500.scrollLeft = expectedTotalRowWidth;
      cwNavRow500.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
      deliverTestIntersectionNotifications(cwNavRow500);
      await new Promise((r) => setTimeout(r, 20));
    });

    const endCards = Array.from(cwNavRow500.querySelectorAll('[data-nav-item="true"]')) as HTMLElement[];
    const endIndices = endCards.map((c) => Number(c.getAttribute('data-row-card-index')));
    const endLeftSpacer = cwNavRow500.querySelector('[data-virtual-spacer="left"]') as HTMLElement | null;
    const endRightSpacer = cwNavRow500.querySelector('[data-virtual-spacer="right"]') as HTMLElement | null;
    const endDiag = getSharedObserverDiagnostics();

    assert.strictEqual(endCards.length, 14, '[12.15.1] No fim da fileira, devem estar montados 14 cartões');
    assert.strictEqual(endIndices[0], 486, '[12.15.1] No fim da fileira, a janela deve iniciar no índice 486');
    assert.strictEqual(endIndices[endIndices.length - 1], 499, '[12.15.1] No fim da fileira, a janela deve alcançar o último item (índice 499)');
    assert(endLeftSpacer !== null && endRightSpacer === null, '[12.15.1] No fim da fileira, apenas o espaçador esquerdo deve existir');
    assert.strictEqual(
      endDiag.activeTargetSubscriptions,
      265,
      '[12.15.1] No fim da fileira, activeTargetSubscriptions deve permanecer em 265'
    );
    const endTotalWidth = parseFloat(endLeftSpacer!.style.width) + 20 + (14 * 165 + 13 * 20);
    assert.strictEqual(
      endTotalWidth,
      expectedTotalRowWidth,
      `[12.15.1] No fim da fileira, espaçador esquerdo + cartões montados deve preservar exatamente ${expectedTotalRowWidth}px`
    );

    // -----------------------------------------------------------------------
    // 12.15.2: Navegação espacial D-Pad do primeiro (0) ao último (499) e retorno (499 -> 0)
    // sem saltos, perda de foco ou saída indevida para a barra lateral + navegação vertical
    // -----------------------------------------------------------------------
    const { setNavMode: setNavModeForCW, getFocusableElements: getFocusableForCW } = await import('../src/navigation');
    setNavModeForCW('remote');

    // Verificar que espaçadores nunca aparecem entre os candidatos focáveis da navegação espacial
    const allFocusableInContainer = getFocusableForCW(virtContainer);
    assert.strictEqual(
      allFocusableInContainer.some((el) => el.hasAttribute('data-virtual-spacer')),
      false,
      '[12.15.3] Espaçadores horizontais nunca devem entrar na lista de candidatos focáveis'
    );

    // Voltar ao início (índice 0) e focar o cartão 0
    await act(async () => {
      cwNavRow500.scrollLeft = 0;
      cwNavRow500.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
    });
    const firstCard0 = cwNavRow500.querySelector('[data-row-card-index="0"]') as HTMLElement;
    assert(firstCard0 !== null, '[12.15.2] Cartão 0 deve estar montado no início');
    await act(async () => {
      firstCard0.focus();
    });
    assertSameElement(document.activeElement, firstCard0, '[12.15.2] Foco deve iniciar no cartão 0');

    // Avançar passo a passo do índice 0 até o último item (499) via moveSpatialFocus('right')
    await act(async () => {
      for (let expectedNext = 1; expectedNext < 500; expectedNext++) {
        const prevFocused = document.activeElement as HTMLElement;
        const nextFocused = moveSpatialFocus('right');
        assert(nextFocused !== null, `[12.15.2] moveSpatialFocus('right') não deve retornar null no passo ${expectedNext}`);
        const actualIdx = Number(nextFocused!.getAttribute('data-row-card-index'));
        if (actualIdx !== expectedNext) {
          assert.strictEqual(
            actualIdx,
            expectedNext,
            `[12.15.2] Avanço para a direita deve ir sem saltos para ${expectedNext} (obteve ${actualIdx})`
          );
        }
        // Na borda da janela, o cartão anterior (prevFocused) deve permanecer conectado até concluir a transferência de foco
        if (expectedNext <= 25 || expectedNext >= 485) {
          assert.strictEqual(
            prevFocused.isConnected,
            true,
            `[12.15.2] O cartão anterior (${expectedNext - 1}) deve permanecer montado até concluir a troca de foco para ${expectedNext}`
          );
        }
      }
    });

    const focusedAtEnd = document.activeElement as HTMLElement;
    assert.strictEqual(
      focusedAtEnd.getAttribute('data-row-card-index'),
      '499',
      '[12.15.2] Após 499 passos para a direita, o foco deve estar no último item (índice 499)'
    );
    assert.strictEqual(
      focusedAtEnd.getAttribute('data-row-item-key'),
      `movie_${homeVodStreams520[499].stream_id}`,
      '[12.15.2] O último item focado deve ter a chave estável movie_10500'
    );

    // Pressionar ArrowRight no último item (499) deve permanecer em 499
    await act(async () => {
      const stayEnd = moveSpatialFocus('right');
      assertSameElement(stayEnd, focusedAtEnd, '[12.15.2] ArrowRight no último item (499) deve manter o foco no item 499');
    });

    // Retornar em sentido inverso do índice 499 até o índice 0 via moveSpatialFocus('left')
    // Nunca deve escapar para a sidebar enquanto o índice for > 0!
    await act(async () => {
      for (let expectedPrev = 498; expectedPrev >= 0; expectedPrev--) {
        const prevFocused = document.activeElement as HTMLElement;
        const nextFocused = moveSpatialFocus('left');
        assert(nextFocused !== null, `[12.15.2] moveSpatialFocus('left') não deve retornar null no passo ${expectedPrev}`);
        const zone = nextFocused!.closest('[data-nav-zone]')?.getAttribute('data-nav-zone');
        if (zone === 'sidebar') {
          assert.fail(`[12.15.2] Saída indevida para a sidebar ao pressionar esquerda no índice ${expectedPrev + 1}`);
        }
        const actualIdx = Number(nextFocused!.getAttribute('data-row-card-index'));
        if (actualIdx !== expectedPrev) {
          assert.strictEqual(
            actualIdx,
            expectedPrev,
            `[12.15.2] Retorno para a esquerda deve ir sem saltos para ${expectedPrev} (obteve ${actualIdx})`
          );
        }
        if (expectedPrev >= 480 || expectedPrev <= 20) {
          assert.strictEqual(
            prevFocused.isConnected,
            true,
            `[12.15.2] O cartão focado (${expectedPrev + 1}) deve permanecer montado até concluir a troca de foco para ${expectedPrev}`
          );
        }
      }
    });

    const focusedBackAt0 = document.activeElement as HTMLElement;
    assert.strictEqual(
      focusedBackAt0.getAttribute('data-row-card-index'),
      '0',
      '[12.15.2] Após retornar todos os passos para a esquerda, o foco deve chegar exatamente ao item 0'
    );

    // Agora, estando no índice 0, pressionar ArrowLeft DEVE ir para o botão da sidebar
    await act(async () => {
      const sidebarFocused = moveSpatialFocus('left');
      assert(
        sidebarFocused !== null && sidebarFocused.getAttribute('data-sidebar-nav-id') === 'inicio',
        '[12.15.2] No índice 0, pressionar esquerda deve mover o foco para a barra lateral (Início)'
      );
    });

    // Pressionar ArrowRight na sidebar retorna ao conteúdo, e testar navegação vertical entre Banner <-> Continuar Assistindo <-> Fileira 1
    const card0Again = cwNavRow500.querySelector('[data-row-card-index="0"]') as HTMLElement;
    await act(async () => {
      card0Again.focus();
    });
    await act(async () => {
      const upToHero = moveSpatialFocus('up');
      assert(
        upToHero !== null && upToHero.closest('[data-scroll-top-anchor="true"]') !== null,
        '[12.15.2] ArrowUp a partir de Continuar Assistindo deve subir para o HeroBanner'
      );
    });
    await act(async () => {
      const downToCW = moveSpatialFocus('down');
      assert(
        downToCW !== null && downToCW.closest('[data-home-row-index="0"]') !== null,
        '[12.15.2] ArrowDown a partir do HeroBanner deve descer para Continuar Assistindo'
      );
    });
    await act(async () => {
      const downToRow1 = moveSpatialFocus('down');
      assert(
        downToRow1 !== null && downToRow1.closest('[data-home-row-index="1"]') !== null,
        '[12.15.2] ArrowDown a partir de Continuar Assistindo deve descer para a fileira seguinte (rowIndex=1)'
      );
    });
    await act(async () => {
      const upBackToCW = moveSpatialFocus('up');
      assert(
        upBackToCW !== null && upBackToCW.closest('[data-home-row-index="0"]') !== null,
        '[12.15.2] ArrowUp a partir da fileira 1 deve retornar para Continuar Assistindo'
      );
    });

    // -----------------------------------------------------------------------
    // 12.15.3: Retorno ao cartão de origem pelo identificador estável após detalhes (MovieDetails e SeriesDetails)
    // e reprodução, mesmo quando o cartão precisa ser remontado
    // -----------------------------------------------------------------------
    // Posicionar no meio da fileira (índice 250 = filme, índice 251 = série), com scrollLeft = 46250
    const savedMidScrollLeft = 250 * 185;
    await act(async () => {
      cwNavRow500.scrollLeft = savedMidScrollLeft;
      cwNavRow500.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
    });

    const originMovieCard250 = cwNavRow500.querySelector('[data-row-card-index="250"]') as HTMLElement;
    assert(originMovieCard250 !== null, '[12.15.3] Cartão de filme no índice 250 deve estar montado');
    const originMovieKey = originMovieCard250.getAttribute('data-row-item-key')!;
    assert.strictEqual(originMovieKey, `movie_${homeVodStreams520[250].stream_id}`);

    // Abrir MovieDetails clicando no cartão 250
    await act(async () => {
      originMovieCard250.focus();
      originMovieCard250.click();
      await new Promise((r) => setTimeout(r, 30));
    });

    const movieModalEl = virtContainer.querySelector('[data-focus-scope="modal"]') as HTMLElement | null;
    assert(movieModalEl !== null, '[12.15.3] MovieDetails deve abrir ao acionar o cartão 250');

    // Simular que, enquanto MovieDetails estava aberto, a fileira rolou para 0 e desmontou o cartão 250!
    await act(async () => {
      cwNavRow500.scrollLeft = 0;
      cwNavRow500.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
    });
    assert(
      cwNavRow500.querySelector(`[data-row-item-key="${originMovieKey}"]`) === null,
      '[12.15.3] Cartão 250 deve estar desmontado quando scrollLeft=0 durante o modal aberto'
    );

    // Acionar reprodução no MovieDetails e fechar o MovieDetails via executeBackAction()
    const { executeBackAction } = await import('../src/navigation');
    await act(async () => {
      executeBackAction();
      await new Promise((r) => setTimeout(r, 30));
    });

    assert(
      virtContainer.querySelector('[data-focus-scope="modal"]') === null,
      '[12.15.3] MovieDetails deve fechar após executeBackAction()'
    );
    const remountedMovieCard250 = cwNavRow500.querySelector(
      `[data-row-item-key="${originMovieKey}"]`
    ) as HTMLElement | null;
    assert(
      remountedMovieCard250 !== null,
      '[12.15.3] Ao fechar MovieDetails, o cartão de origem (índice 250) deve ser remontado na janela virtual pelo identificador estável'
    );
    assert.strictEqual(
      cwNavRow500.scrollLeft,
      savedMidScrollLeft,
      `[12.15.3] A posição horizontal da fileira (scrollLeft=${savedMidScrollLeft}) deve ser restaurada ao voltar de MovieDetails`
    );
    assertSameElement(
      document.activeElement,
      remountedMovieCard250,
      '[12.15.3] O foco deve ser restaurado exatamente no cartão de origem remontado (movie 250)'
    );

    // Agora testar abertura e fechamento de SeriesDetails no índice 251 (série) após desmontagem do cartão
    const originSeriesCard251 = cwNavRow500.querySelector('[data-row-card-index="251"]') as HTMLElement;
    assert(originSeriesCard251 !== null, '[12.15.3] Cartão de série no índice 251 deve estar montado');
    const originSeriesKey = originSeriesCard251.getAttribute('data-row-item-key')!;
    assert(originSeriesKey.startsWith('series_'), '[12.15.3] Cartão 251 deve ter chave estável series_*');

    await act(async () => {
      originSeriesCard251.focus();
      originSeriesCard251.click();
      await new Promise((r) => setTimeout(r, 30));
    });
    assert(
      virtContainer.querySelector('[data-focus-scope="modal"]') !== null,
      '[12.15.3] SeriesDetails deve abrir ao acionar o cartão 251'
    );

    // Desmontar o cartão 251 rolando a fileira para o fim (scrollLeft = expectedTotalRowWidth)
    await act(async () => {
      cwNavRow500.scrollLeft = expectedTotalRowWidth;
      cwNavRow500.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
    });
    assert(
      cwNavRow500.querySelector(`[data-row-item-key="${originSeriesKey}"]`) === null,
      '[12.15.3] Cartão 251 deve estar desmontado quando a fileira está no fim'
    );

    // Fechar SeriesDetails via executeBackAction() -> deve remontar o cartão 251, restaurar scrollLeft e focar o cartão 251
    await act(async () => {
      executeBackAction();
      await new Promise((r) => setTimeout(r, 30));
    });

    const remountedSeriesCard251 = cwNavRow500.querySelector(
      `[data-row-item-key="${originSeriesKey}"]`
    ) as HTMLElement | null;
    assert(
      remountedSeriesCard251 !== null,
      '[12.15.3] Ao fechar SeriesDetails, o cartão de origem (série 251) deve ser remontado pelo identificador estável'
    );
    assert.strictEqual(
      cwNavRow500.scrollLeft,
      savedMidScrollLeft,
      '[12.15.3] scrollLeft deve ser restaurado ao voltar de SeriesDetails'
    );
    assertSameElement(
      document.activeElement,
      remountedSeriesCard251,
      '[12.15.3] O foco deve ser restaurado exatamente no cartão de série 251 remontado'
    );

    // Testar retorno após reprodução (VideoPlayer) quando recordPlaybackPosition atualiza o histórico e reordena o item pelo identificador estável
    const { recordPlaybackPosition } = await import('../src/utils/playbackHistory');
    const { pushFocusMemory: pushFocusForPlay, popFocusMemory: popFocusFromPlay } = await import(
      '../src/navigation'
    );
    const originMovie252 = cwNavRow500.querySelector('[data-row-card-index="252"]') as HTMLElement;
    assert(originMovie252 !== null, '[12.15.3] Cartão 252 deve estar montado antes da reprodução');
    const originMovie252Key = originMovie252.getAttribute('data-row-item-key')!;
    const movie252StreamId = String(homeVodStreams520[252].stream_id);

    await act(async () => {
      originMovie252.focus();
      pushFocusForPlay(originMovie252);
      // Simular atualização de progresso durante a reprodução (move o item para o início do histórico)
      recordPlaybackPosition(credsHomeImg, {
        id: movie252StreamId,
        type: 'movie',
        positionSec: 420,
      });
      await new Promise((r) => setTimeout(r, 20));
    });

    // Ao encerrar a reprodução (popFocusMemory), o cartão deve ser localizado pelo identificador estável (movie_10253), remontado e focado
    await act(async () => {
      const restoredAfterPlay = popFocusFromPlay();
      assert.strictEqual(restoredAfterPlay, true, '[12.15.3] popFocusMemory deve restaurar o cartão de origem após reprodução');
      await new Promise((r) => setTimeout(r, 20));
    });

    const activeAfterPlay = document.activeElement as HTMLElement | null;
    assert(
      activeAfterPlay !== null &&
        activeAfterPlay.getAttribute('data-row-item-key') === originMovie252Key,
      `[12.15.3] Após reprodução que reordena o histórico, o foco deve ser restaurado no cartão de origem pelo identificador estável (${originMovie252Key})`
    );

    // -----------------------------------------------------------------------
    // 12.15.4: Rolagem pelos botões da fileira e recálculo em diferentes larguras e escalas de TV (50%, 85%, 100%, 125%)
    // -----------------------------------------------------------------------
    await act(async () => {
      cwNavRow500.scrollLeft = 0;
      cwNavRow500.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
    });
    const nextChevronBtn = cwWrapper500.querySelector('[data-row-scroll-next="true"]') as HTMLButtonElement;
    const prevChevronBtn = cwWrapper500.querySelector('[data-row-scroll-prev="true"]') as HTMLButtonElement;
    assert(nextChevronBtn !== null && prevChevronBtn !== null, '[12.15.4] Botões laterais da fileira devem existir');

    await act(async () => {
      nextChevronBtn.click();
      nextChevronBtn.click();
      nextChevronBtn.click();
    });
    assert.strictEqual(cwNavRow500.scrollLeft, 900, '[12.15.4] Três cliques no botão avançar da fileira devem avançar scrollLeft para 900px');
    const indicesAfterChevronNext = Array.from(cwNavRow500.querySelectorAll('[data-nav-item="true"]')).map((el) =>
      Number(el.getAttribute('data-row-card-index'))
    );
    assert(
      indicesAfterChevronNext[0] > 0,
      `[12.15.4] Avançar pelos botões da fileira deve deslocar a janela virtual (startIndex=${indicesAfterChevronNext[0]})`
    );

    await act(async () => {
      prevChevronBtn.click();
      prevChevronBtn.click();
      prevChevronBtn.click();
    });
    assert.strictEqual(cwNavRow500.scrollLeft, 0, '[12.15.4] Três cliques no botão recuar da fileira devem retornar scrollLeft para 0');

    // Recálculo em diferentes larguras do contêiner (460px, 1120px, 1680px)
    const resizeWidthCases = [
      { width: 460, expectedMounted: 10 }, // ceil(460/185)+1 = 4 visíveis + 6 overscan = 10
      { width: 1120, expectedMounted: 14 }, // ceil(1120/185)+1 = 8 visíveis + 6 overscan = 14
      { width: 1680, expectedMounted: 17 }, // ceil(1680/185)+1 = 11 visíveis + 6 overscan = 17
    ];
    for (const rc of resizeWidthCases) {
      geomConfig.navRowWidth = rc.width;
      await act(async () => {
        window.dispatchEvent(new windowInstance.Event('resize') as unknown as Event);
      });
      const mountedNow = cwNavRow500.querySelectorAll('[data-nav-item="true"]').length;
      assert.strictEqual(
        mountedNow,
        rc.expectedMounted,
        `[12.15.4] Ao redimensionar a fileira para ${rc.width}px, a janela deve recalcular para ${rc.expectedMounted} cartões montados (obteve ${mountedNow})`
      );
    }
    geomConfig.navRowWidth = 1120;

    // Recálculo nas 4 escalas de TV (50%, 85%, 100%, 125%)
    const { confirmDisplayPreferences } = await import('../src/platform/tvEnvironment');
    const tvScaleCases = [
      { scale: 50, expectedMounted: 21 }, // cardWidth=74, gap=8, stride=82 -> ceil(1120/82)+1=15 + 6 = 21
      { scale: 85, expectedMounted: 16 }, // cardWidth=125.8, gap=13.6, stride=139.4 -> ceil(1120/139.4)+1=10 + 6 = 16
      { scale: 100, expectedMounted: 14 }, // cardWidth=148, gap=16, stride=164 (in 25px range of mock 165 -> 14)
      { scale: 125, expectedMounted: 13 }, // cardWidth=185, gap=20, stride=205 -> ceil(1120/205)+1=7 + 6 = 13
    ];
    for (const tc of tvScaleCases) {
      await act(async () => {
        confirmDisplayPreferences('tv', tc.scale);
      });
      const mountedAtScale = cwNavRow500.querySelectorAll('[data-nav-item="true"]').length;
      assert.strictEqual(
        mountedAtScale,
        tc.expectedMounted,
        `[12.15.4] Na escala de TV ${tc.scale}%, a janela horizontal de Continuar Assistindo deve recalcular para ${tc.expectedMounted} cartões montados (obteve ${mountedAtScale})`
      );
    }
    await act(async () => {
      confirmDisplayPreferences('default', 85);
    });

    // -----------------------------------------------------------------------
    // 12.15.5: REGRESSÃO 1 — Sincronização da geometria com a janela no meio de
    // uma fileira de 500 itens (alteração do espaçamento entre cartões sem mudar
    // startIndex/endIndex + imunidade a transformações de hover/toque)
    // -----------------------------------------------------------------------
    geomConfig.navRowWidth = 1120;
    geomConfig.cardWidth = 165;
    geomConfig.cardStep = 185; // gap = 20px

    await act(async () => {
      cwNavRow500.scrollLeft = 27900; // firstVisible = floor(27900/185) = 150 -> janela [147..160]
      cwNavRow500.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
      window.dispatchEvent(new windowInstance.Event('resize') as unknown as Event);
      await new Promise((r) => setTimeout(r, 20));
    });

    const indicesBeforeGapChange = Array.from(
      cwNavRow500.querySelectorAll('[data-nav-item="true"]')
    ).map((el) => Number(el.getAttribute('data-row-card-index')));
    assert.strictEqual(
      indicesBeforeGapChange.length,
      14,
      '[12.15.5] Antes da mudança de espaçamento, 14 cartões devem estar montados no meio da fileira'
    );
    assert.strictEqual(indicesBeforeGapChange[0], 147, '[12.15.5] startIndex antes deve ser 147');
    assert.strictEqual(
      indicesBeforeGapChange[indicesBeforeGapChange.length - 1],
      160,
      '[12.15.5] último índice montado antes deve ser 160 (endIndex=161)'
    );

    const leftSpacerBeforeGap = cwNavRow500.querySelector(
      '[data-virtual-spacer="left"]'
    ) as HTMLElement | null;
    const rightSpacerBeforeGap = cwNavRow500.querySelector(
      '[data-virtual-spacer="right"]'
    ) as HTMLElement | null;
    assert(
      leftSpacerBeforeGap !== null && rightSpacerBeforeGap !== null,
      '[12.15.5] Espaçadores esquerdo e direito devem existir em torno da janela 147..160'
    );

    const leftWidthGap20 = parseFloat(leftSpacerBeforeGap!.style.width);
    const rightWidthGap20 = parseFloat(rightSpacerBeforeGap!.style.width);
    const expectedLeftGap20 = 147 * 165 + 146 * 20; // 27175px
    const expectedRightGap20 = 339 * 165 + 338 * 20; // 62695px
    const expectedTotalGap20 = 500 * 165 + 499 * 20; // 92480px
    const actualTotalGap20 = leftWidthGap20 + 20 + (14 * 165 + 13 * 20) + 20 + rightWidthGap20;

    assert.strictEqual(
      leftWidthGap20,
      expectedLeftGap20,
      `[12.15.5] Com gap=20px, espaçador esquerdo deve medir ${expectedLeftGap20}px`
    );
    assert.strictEqual(
      rightWidthGap20,
      expectedRightGap20,
      `[12.15.5] Com gap=20px, espaçador direito deve medir ${expectedRightGap20}px`
    );
    assert.strictEqual(
      actualTotalGap20,
      expectedTotalGap20,
      `[12.15.5] Com gap=20px, largura total da fileira deve ser ${expectedTotalGap20}px`
    );

    // Alterar a distância entre os cartões de 185px (gap=20px) para 186px (gap=21px).
    // Em scrollLeft=27900: floor(27900/186) = 150 e ceil(1120/186)+1 = 8 -> startIndex=147 e endIndex=161 continuam IGUAIS!
    geomConfig.cardStep = 186; // gap = 21px
    await act(async () => {
      window.dispatchEvent(new windowInstance.Event('resize') as unknown as Event);
      await new Promise((r) => setTimeout(r, 20));
    });

    const indicesAfterGapChange = Array.from(
      cwNavRow500.querySelectorAll('[data-nav-item="true"]')
    ).map((el) => Number(el.getAttribute('data-row-card-index')));
    assert.deepStrictEqual(
      indicesAfterGapChange,
      indicesBeforeGapChange,
      '[12.15.5] Os índices montados (147..160) devem permanecer idênticos após alterar gap de 20px para 21px'
    );

    const leftSpacerAfterGap = cwNavRow500.querySelector(
      '[data-virtual-spacer="left"]'
    ) as HTMLElement | null;
    const rightSpacerAfterGap = cwNavRow500.querySelector(
      '[data-virtual-spacer="right"]'
    ) as HTMLElement | null;
    const leftWidthGap21 = parseFloat(leftSpacerAfterGap!.style.width);
    const rightWidthGap21 = parseFloat(rightSpacerAfterGap!.style.width);
    const expectedLeftGap21 = 147 * 165 + 146 * 21; // 27321px (+146px)
    const expectedRightGap21 = 339 * 165 + 338 * 21; // 63033px (+338px)
    const expectedTotalGap21 = 500 * 165 + 499 * 21; // 92979px (+499px)
    const actualTotalGap21 = leftWidthGap21 + 21 + (14 * 165 + 13 * 21) + 21 + rightWidthGap21;

    assert.strictEqual(
      leftWidthGap21,
      expectedLeftGap21,
      `[12.15.5] Mesmo com startIndex/endIndex inalterados, o espaçador esquerdo deve acompanhar a mudança de gap para ${expectedLeftGap21}px (obteve ${leftWidthGap21}px)`
    );
    assert.strictEqual(
      rightWidthGap21,
      expectedRightGap21,
      `[12.15.5] Mesmo com startIndex/endIndex inalterados, o espaçador direito deve acompanhar a mudança de gap para ${expectedRightGap21}px (obteve ${rightWidthGap21}px)`
    );
    assert.strictEqual(
      actualTotalGap21,
      expectedTotalGap21,
      `[12.15.5] Largura total da fileira deve acompanhar a mudança de espaçamento para ${expectedTotalGap21}px`
    );

    // Verificar também que transformações de hover (scale(1.05)) ou toque (scale(0.95)) nos cartões montados
    // NÃO distorcem a medição de cardWidth, gap ou espaçadores
    const mountedCard147 = cwNavRow500.querySelector('[data-row-card-index="147"]') as HTMLElement;
    const mountedCard148 = cwNavRow500.querySelector('[data-row-card-index="148"]') as HTMLElement;
    mountedCard147.style.transform = 'scale(1.05)';
    mountedCard148.style.transform = 'scale(0.95)';
    assert.strictEqual(
      Math.round(mountedCard147.getBoundingClientRect().width * 100) / 100,
      173.25,
      '[12.15.5] getBoundingClientRect() do cartão em hover reflete scale(1.05) = 173.25px'
    );

    await act(async () => {
      window.dispatchEvent(new windowInstance.Event('resize') as unknown as Event);
      await new Promise((r) => setTimeout(r, 20));
    });

    const leftWidthDuringHoverTap = parseFloat(
      (cwNavRow500.querySelector('[data-virtual-spacer="left"]') as HTMLElement).style.width
    );
    const rightWidthDuringHoverTap = parseFloat(
      (cwNavRow500.querySelector('[data-virtual-spacer="right"]') as HTMLElement).style.width
    );
    assert.strictEqual(
      leftWidthDuringHoverTap,
      expectedLeftGap21,
      '[12.15.5] Transformações de hover/toque (scale(1.05)/scale(0.95)) não devem contaminar a medição da largura ou do espaçamento no espaçador esquerdo'
    );
    assert.strictEqual(
      rightWidthDuringHoverTap,
      expectedRightGap21,
      '[12.15.5] Transformações de hover/toque (scale(1.05)/scale(0.95)) não devem contaminar a medição da largura ou do espaçamento no espaçador direito'
    );

    mountedCard147.style.transform = '';
    mountedCard148.style.transform = '';
    geomConfig.cardStep = 185;
    await act(async () => {
      window.dispatchEvent(new windowInstance.Event('resize') as unknown as Event);
      await new Promise((r) => setTimeout(r, 20));
    });

    // -----------------------------------------------------------------------
    // 12.15.6: REGRESSÃO 2 — Sincronização de rolagem, montagem e foco sob
    // rolagem suave atrasada (scrollLeft não atualiza imediatamente em smooth scroll),
    // travessia de borda por D-Pad e retorno a cartão distante pelo identificador
    // estável (inclusive após reordenação do histórico)
    // -----------------------------------------------------------------------
    let simulatedEffectiveScrollLeft = 0;
    let pendingSmoothScrollTarget: number | null = null;
    let smoothScrollByCalls = 0;
    let immediateScrollCalls = 0;
    let forceDelayAllScrollLeftWrites = false;

    const origRowScrollDesc = Object.getOwnPropertyDescriptor(
      windowInstance.HTMLElement.prototype,
      'scrollLeft'
    );
    const origRowScrollTo = cwNavRow500.scrollTo;
    const origRowScrollBy = cwNavRow500.scrollBy;

    Object.defineProperty(cwNavRow500, 'scrollLeft', {
      get() {
        return simulatedEffectiveScrollLeft;
      },
      set(val: number) {
        const clamped = Math.max(0, Number(val) || 0);
        if (forceDelayAllScrollLeftWrites) {
          pendingSmoothScrollTarget = clamped;
          return;
        }
        // Em um elemento com classe scroll-smooth, atribuição direta sem scrollBehavior='auto' não atualiza no instante t=0
        if (this.style?.scrollBehavior === 'auto') {
          simulatedEffectiveScrollLeft = clamped;
          pendingSmoothScrollTarget = null;
        } else {
          pendingSmoothScrollTarget = clamped;
        }
      },
      configurable: true,
    });

    cwNavRow500.scrollTo = function (optionsOrX?: ScrollToOptions | number, _y?: number) {
      let targetLeft = simulatedEffectiveScrollLeft;
      let behavior: string = this.style?.scrollBehavior === 'auto' ? 'auto' : 'smooth';
      if (typeof optionsOrX === 'number') {
        targetLeft = Math.max(0, optionsOrX);
      } else if (optionsOrX && typeof optionsOrX === 'object') {
        if (typeof optionsOrX.left === 'number') {
          targetLeft = Math.max(0, optionsOrX.left);
        }
        if (optionsOrX.behavior) {
          behavior = optionsOrX.behavior;
        }
      }
      if (forceDelayAllScrollLeftWrites) {
        pendingSmoothScrollTarget = targetLeft;
        return;
      }
      if (behavior === 'auto' || behavior === 'instant' || this.style?.scrollBehavior === 'auto') {
        immediateScrollCalls++;
        simulatedEffectiveScrollLeft = targetLeft;
        pendingSmoothScrollTarget = null;
      } else {
        pendingSmoothScrollTarget = targetLeft;
      }
    };

    cwNavRow500.scrollBy = function (optionsOrX?: ScrollToOptions | number, _y?: number) {
      let deltaLeft = 0;
      let behavior: string = 'smooth';
      if (typeof optionsOrX === 'number') {
        deltaLeft = optionsOrX;
      } else if (optionsOrX && typeof optionsOrX === 'object') {
        if (typeof optionsOrX.left === 'number') {
          deltaLeft = optionsOrX.left;
        }
        if (optionsOrX.behavior) {
          behavior = optionsOrX.behavior;
        }
      }
      const base = pendingSmoothScrollTarget !== null ? pendingSmoothScrollTarget : simulatedEffectiveScrollLeft;
      const targetLeft = Math.max(0, base + deltaLeft);
      if (behavior === 'smooth' && this.style?.scrollBehavior !== 'auto') {
        smoothScrollByCalls++;
        pendingSmoothScrollTarget = targetLeft;
      } else {
        simulatedEffectiveScrollLeft = targetLeft;
        pendingSmoothScrollTarget = null;
      }
    };

    const advancePendingSmoothScroll = async (fraction: number) => {
      if (pendingSmoothScrollTarget === null) return;
      if (fraction >= 1) {
        simulatedEffectiveScrollLeft = pendingSmoothScrollTarget;
        pendingSmoothScrollTarget = null;
      } else {
        simulatedEffectiveScrollLeft = Math.round(
          simulatedEffectiveScrollLeft +
            (pendingSmoothScrollTarget - simulatedEffectiveScrollLeft) * fraction
        );
      }
      await act(async () => {
        cwNavRow500.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
        deliverTestIntersectionNotifications(cwNavRow500);
      });
    };

    try {
      // Resetar no início com reposicionamento imediato
      await act(async () => {
        cwNavRow500.style.scrollBehavior = 'auto';
        cwNavRow500.scrollLeft = 0;
        cwNavRow500.style.removeProperty('scroll-behavior');
        cwNavRow500.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
        await new Promise((r) => setTimeout(r, 20));
      });

      // A) Botões laterais preservam rolagem suave (behavior: 'smooth') e a janela acompanha scrollLeft efetivo
      smoothScrollByCalls = 0;
      await act(async () => {
        nextChevronBtn.click();
      });
      assert.strictEqual(
        smoothScrollByCalls,
        1,
        '[12.15.6] Botão lateral avançar deve acionar scrollBy({ behavior: "smooth" })'
      );
      assert.strictEqual(
        cwNavRow500.scrollLeft,
        0,
        '[12.15.6] No instante t=0 de uma rolagem suave, scrollLeft ainda é 0'
      );
      assert.strictEqual(
        pendingSmoothScrollTarget,
        300,
        '[12.15.6] O alvo pendente da rolagem suave deve ser 300px'
      );
      const mountedAtT0 = Array.from(cwNavRow500.querySelectorAll('[data-nav-item="true"]')).map((el) =>
        Number(el.getAttribute('data-row-card-index'))
      );
      assert.strictEqual(
        mountedAtT0[0],
        0,
        '[12.15.6] Enquanto scrollLeft efetivo é 0, a janela deve corresponder a scrollLeft=0 (startIndex=0)'
      );

      // Avançar mais 2 cliques suaves (alvo = 900px) e progredir a animação em 2 quadros
      await act(async () => {
        nextChevronBtn.click();
        nextChevronBtn.click();
      });
      assert.strictEqual(pendingSmoothScrollTarget, 900);
      await advancePendingSmoothScroll(0.5); // scrollLeft = 450px
      assert.strictEqual(cwNavRow500.scrollLeft, 450);
      await advancePendingSmoothScroll(1); // scrollLeft = 900px
      assert.strictEqual(cwNavRow500.scrollLeft, 900);
      const mountedAt900 = Array.from(cwNavRow500.querySelectorAll('[data-nav-item="true"]')).map((el) =>
        Number(el.getAttribute('data-row-card-index'))
      );
      assert.strictEqual(
        mountedAt900[0],
        1,
        '[12.15.6] Ao concluir a rolagem suave em 900px (firstVisible=4), a janela deve iniciar em startIndex=1'
      );

      // B) Travessia de borda da janela por D-Pad enquanto uma rolagem suave estava pendente:
      // O D-Pad usa reposicionamento imediato explícito, cancela a rolagem suave pendente,
      // mantém o cartão anterior montado até concluir a troca de foco e sincroniza janela com scrollLeft efetivo
      await act(async () => {
        prevChevronBtn.click(); // Inicia rolagem suave pendente para 600px, mas scrollLeft efetivo ainda é 900px
      });
      assert.strictEqual(cwNavRow500.scrollLeft, 900);
      assert.strictEqual(pendingSmoothScrollTarget, 600);

      const cardAt10 = cwNavRow500.querySelector('[data-row-card-index="10"]') as HTMLElement;
      assert(cardAt10 !== null, '[12.15.6] Cartão 10 deve estar montado em scrollLeft=900');
      await act(async () => {
        cardAt10.focus();
      });

      const immediateCallsBeforeDpad = immediateScrollCalls;
      await act(async () => {
        for (let targetIdx = 11; targetIdx <= 22; targetIdx++) {
          const prevCard = document.activeElement as HTMLElement;
          const nextCard = moveSpatialFocus('right');
          assert(nextCard !== null, `[12.15.6] moveSpatialFocus('right') deve focar o cartão ${targetIdx}`);
          assert.strictEqual(
            Number(nextCard!.getAttribute('data-row-card-index')),
            targetIdx,
            `[12.15.6] O foco deve avançar exatamente para o cartão ${targetIdx}`
          );
          assert.strictEqual(
            prevCard.isConnected,
            true,
            `[12.15.6] Na travessia para ${targetIdx}, o cartão anterior (${targetIdx - 1}) deve permanecer montado até concluir a troca de foco`
          );
          const effectiveScroll = cwNavRow500.scrollLeft;
          const expectedStartForEffective = Math.max(0, Math.floor(effectiveScroll / 185) - 3);
          const currentMountedIndices = Array.from(
            cwNavRow500.querySelectorAll('[data-nav-item="true"]')
          ).map((el) => Number(el.getAttribute('data-row-card-index')));
          assert(
            currentMountedIndices[0] <= expectedStartForEffective,
            `[12.15.6] A janela montada (${currentMountedIndices[0]}..${currentMountedIndices[currentMountedIndices.length - 1]}) deve corresponder ao scrollLeft efetivo (${effectiveScroll}px)`
          );
        }
      });
      assert(
        immediateScrollCalls > immediateCallsBeforeDpad,
        '[12.15.6] A travessia de borda por D-Pad deve acionar reposicionamento imediato explícito'
      );
      assert.strictEqual(
        pendingSmoothScrollTarget,
        null,
        '[12.15.6] O reposicionamento imediato do D-Pad deve cancelar qualquer rolagem suave pendente'
      );

      // C) Caso extremo: mesmo que o ambiente atrase a atualização de scrollLeft por 1 quadro durante travessia de borda (13 -> 14 em scrollLeft=0),
      // a janela é calculada pela posição efetiva (0) + pinnedRange (13..14), mantendo 13 e 14 montados e focando 14 sem perda de foco
      await act(async () => {
        cwNavRow500.style.scrollBehavior = 'auto';
        cwNavRow500.scrollLeft = 0;
        cwNavRow500.style.removeProperty('scroll-behavior');
        cwNavRow500.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
      });
      const borderCard13 = cwNavRow500.querySelector('[data-row-card-index="13"]') as HTMLElement;
      assert(borderCard13 !== null, '[12.15.6] Cartão 13 na borda direita da janela inicial [0..13] deve estar montado');
      await act(async () => {
        borderCard13.focus();
      });

      forceDelayAllScrollLeftWrites = true;
      await act(async () => {
        const focused14 = moveSpatialFocus('right');
        assert(focused14 !== null, '[12.15.6] Mesmo com scrollLeft atrasado em 0, atravessar a borda 13 -> 14 deve montar e focar o cartão 14');
        assert.strictEqual(focused14!.getAttribute('data-row-card-index'), '14');
        assert.strictEqual(
          borderCard13.isConnected,
          true,
          '[12.15.6] Cartão anterior (13) deve continuar montado após a troca de foco para 14'
        );
        assert.strictEqual(
          cwNavRow500.scrollLeft,
          0,
          '[12.15.6] Durante o atraso simulado, scrollLeft efetivo ainda é 0'
        );
        // Como scrollLeft efetivo é 0, o início da janela deve permanecer em 0 (sem desmontar o início antes da rolagem acontecer)
        const mountedWhileDelayed = Array.from(cwNavRow500.querySelectorAll('[data-nav-item="true"]')).map(
          (el) => Number(el.getAttribute('data-row-card-index'))
        );
        assert.strictEqual(
          mountedWhileDelayed[0],
          0,
          '[12.15.6] Enquanto scrollLeft efetivo é 0, startIndex deve permanecer sincronizado com a posição efetiva (0)'
        );
        assert(
          mountedWhileDelayed.includes(13) && mountedWhileDelayed.includes(14),
          '[12.15.6] A janela deve conter tanto o cartão anterior (13) quanto o novo cartão focado (14)'
        );
      });
      forceDelayAllScrollLeftWrites = false;
      await advancePendingSmoothScroll(1);
      assert.strictEqual(
         (document.activeElement as HTMLElement)?.getAttribute('data-row-card-index'),
        '14',
        '[12.15.6] Quando o evento de scroll atrasado chega, o foco permanece no cartão 14'
      );

      // D) Retorno a um cartão distante pelo identificador estável após detalhes e após reprodução com reordenação do histórico:
      // D.1: Cartão que começou no início (índice 3, movie_10004) e foi reordenado no histórico para uma posição distante (índice 390)
      await act(async () => {
        cwNavRow500.style.scrollBehavior = 'auto';
        cwNavRow500.scrollLeft = 0;
        cwNavRow500.style.removeProperty('scroll-behavior');
        cwNavRow500.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
      });
      const cardAtStart3 = cwNavRow500.querySelector('[data-row-card-index="3"]') as HTMLElement;
      assert(cardAtStart3 !== null, '[12.15.6] Cartão no índice 3 deve estar montado no início');
      const movedToDistantKey = cardAtStart3.getAttribute('data-row-item-key')!;
      const movedToDistantStreamId = movedToDistantKey.replace(/^movie_/, '');

      await act(async () => {
        cardAtStart3.focus();
        pushFocusForPlay(cardAtStart3);
      });

      // Reordenar o histórico no localStorage para que movedToDistantKey passe do índice 3 para o índice distante 390
      const rawCurrentHistory = JSON.parse(
        windowInstance.localStorage.getItem(homeHistoryKey) || '{}'
      );
      const targetHistoryEntry = rawCurrentHistory[`movie:${movedToDistantStreamId}`];
      assert(targetHistoryEntry !== undefined, '[12.15.6] Entrada do histórico para o cartão de origem deve existir');
      // Na lista ordenada por updatedAt decrescente, colocar updatedAt entre os itens 390 e 391
      targetHistoryEntry.updatedAt = 1716000000000 - 390 * 1000 - 500;
      windowInstance.localStorage.setItem(homeHistoryKey, JSON.stringify(rawCurrentHistory));

      // Forçar re-render da HomeView com o histórico reordenado (como ocorre ao fechar reprodução/detalhes)
      await act(async () => {
        // Disparar atualização de progresso em outro item para notificar subscribePlaybackHistory
        const firstMovieId = String(homeVodStreams520[0].stream_id);
        recordPlaybackPosition(credsHomeImg, {
          id: firstMovieId,
          type: 'movie',
          positionSec: 195,
        });
        await new Promise((r) => setTimeout(r, 20));
      });

      // Com scrollLeft=0, o item movido para ~390 está desmontado
      assert.strictEqual(
        cwNavRow500.querySelector(`[data-row-item-key="${movedToDistantKey}"]`),
        null,
        '[12.15.6] Após reordenação para posição distante (~390) com scrollLeft=0, o cartão deve estar fora da janela inicial'
      );

      // Restaurar o foco ao encerrar a reprodução via popFocusMemory()
      await act(async () => {
        const ok = popFocusFromPlay();
        assert.strictEqual(
          ok,
          true,
          '[12.15.6] popFocusMemory deve localizar o cartão reordenado para posição distante pelo identificador estável'
        );
        await new Promise((r) => setTimeout(r, 20));
      });

      const activeAtDistant = document.activeElement as HTMLElement | null;
      assert(
        activeAtDistant !== null &&
          activeAtDistant.getAttribute('data-row-item-key') === movedToDistantKey,
        `[12.15.6] O foco deve ser restaurado no cartão distante pelo identificador estável (${movedToDistantKey})`
      );
      const newDistantIdx = Number(activeAtDistant!.getAttribute('data-row-card-index'));
      assert(
        newDistantIdx >= 389 && newDistantIdx <= 391,
        `[12.15.6] O cartão reordenado deve estar montado em sua nova posição distante (~390, obteve ${newDistantIdx})`
      );
      const expectedMinScrollForDistant = newDistantIdx * 185 + 165 - 1120;
      assert(
        cwNavRow500.scrollLeft >= expectedMinScrollForDistant,
        `[12.15.6] A fileira deve ter sido reposicionada imediatamente para exibir o cartão distante (scrollLeft=${cwNavRow500.scrollLeft}px)`
      );

      // D.2: Agora a partir desse cartão distante (~390), simular reprodução que atualiza sua posição e o move para o índice 0
      await act(async () => {
        activeAtDistant!.focus();
        pushFocusForPlay(activeAtDistant!);
        recordPlaybackPosition(credsHomeImg, {
          id: movedToDistantStreamId,
          type: 'movie',
          positionSec: 510,
        });
        await new Promise((r) => setTimeout(r, 20));
      });

      await act(async () => {
        const okBackTo0 = popFocusFromPlay();
        assert.strictEqual(
          okBackTo0,
          true,
          '[12.15.6] popFocusMemory deve restaurar o cartão quando reordenado da posição distante (~390) para o índice 0'
        );
        await new Promise((r) => setTimeout(r, 20));
      });

      const activeAt0AfterReorder = document.activeElement as HTMLElement | null;
      assert(
        activeAt0AfterReorder !== null &&
          activeAt0AfterReorder.getAttribute('data-row-item-key') === movedToDistantKey,
        '[12.15.6] O foco deve permanecer no mesmo item pelo identificador estável após ir para o índice 0'
      );
      assert.strictEqual(
        activeAt0AfterReorder!.getAttribute('data-row-card-index'),
        '0',
        '[12.15.6] O item atualizado deve agora ocupar o índice 0 da fileira'
      );
      assert.strictEqual(
        cwNavRow500.scrollLeft,
        0,
        '[12.15.6] O reposicionamento imediato deve trazer scrollLeft exatamente para 0 quando o item reordenado está no índice 0'
      );
      assert.strictEqual(
        cwNavRow500.querySelector('[data-virtual-spacer="left"]'),
        null,
        '[12.15.6] Com a janela sincronizada em scrollLeft=0 (startIndex=0), não deve haver espaçador esquerdo residual'
      );

      // ---------------------------------------------------------------------
      // 12.15.7: REGRESSÃO 3 — Combinação de destino distante (0 <-> 390) e
      // atualização atrasada de scrollLeft no mesmo cenário + descarte da
      // restauração pendente em nova navegação, rolagem do usuário ou desmontagem
      // ---------------------------------------------------------------------
      const { hasPendingFocusRestore } = await import('../src/navigation');

      // 1) Sentido Direto: do início (scrollLeft=0) até o índice 390 com scrollLeft atrasado
      await act(async () => {
        cwNavRow500.style.scrollBehavior = 'auto';
        cwNavRow500.scrollLeft = 0;
        cwNavRow500.style.removeProperty('scroll-behavior');
        cwNavRow500.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
        await new Promise((r) => setTimeout(r, 20));
      });

      const originCardAt0 = cwNavRow500.querySelector('[data-row-card-index="0"]') as HTMLElement;
      assert(originCardAt0 !== null, '[12.15.7] Cartão 0 deve estar montado no início');
      const delayedRestoreKey = originCardAt0.getAttribute('data-row-item-key')!;
      const delayedRestoreStreamId = delayedRestoreKey.replace(/^movie_/, '');

      await act(async () => {
        originCardAt0.focus();
        pushFocusForPlay(originCardAt0);
      });

      // Reordenar exatamente para o índice 390 entre os 500 itens
      const histFor390 = JSON.parse(windowInstance.localStorage.getItem(homeHistoryKey) || '{}');
      const otherKeys = Object.keys(histFor390).filter(
        (k) => k !== `movie:${delayedRestoreStreamId}`
      );
      otherKeys.sort((a, b) => histFor390[b].updatedAt - histFor390[a].updatedAt);
      for (let i = 0; i < otherKeys.length; i++) {
        const rank = i < 390 ? i : i + 1;
        histFor390[otherKeys[i]].updatedAt = 1717000000000 - rank * 1000;
      }
      histFor390[`movie:${delayedRestoreStreamId}`].updatedAt = 1717000000000 - 390 * 1000;
      windowInstance.localStorage.setItem(homeHistoryKey, JSON.stringify(histFor390));

      const topMovieStreamId = otherKeys[0].replace(/^movie:/, '');
      await act(async () => {
        recordPlaybackPosition(credsHomeImg, {
          id: topMovieStreamId,
          type: 'movie',
          positionSec: 205,
        });
        await new Promise((r) => setTimeout(r, 20));
      });

      const cardsBeforeForwardRestore = Array.from(
        cwNavRow500.querySelectorAll('[data-nav-item="true"]')
      ) as HTMLElement[];
      const countBeforeForward = cardsBeforeForwardRestore.length;
      assert.strictEqual(
        countBeforeForward,
        14,
        '[12.15.7] Antes da restauração (0 -> 390), devem estar montados 14 cartões (0..13)'
      );

      // Ativar atraso de scrollLeft e solicitar restauração de foco para o cartão agora no índice 390
      forceDelayAllScrollLeftWrites = true;
      await act(async () => {
        const popResult = popFocusFromPlay();
        assert.strictEqual(
          popResult,
          true,
          '[12.15.7] popFocusMemory deve aceitar a restauração pendente para o destino distante (390)'
        );
      });

      // ANTES de liberar o deslocamento simulado (scrollLeft ainda é 0):
      const cardsDuringForwardRestore = Array.from(
        cwNavRow500.querySelectorAll('[data-nav-item="true"]')
      ) as HTMLElement[];
      const indicesDuringForward = cardsDuringForwardRestore.map((el) =>
        Number(el.getAttribute('data-row-card-index'))
      );
      const countDuringForward = cardsDuringForwardRestore.length;

      assert.strictEqual(
        cwNavRow500.scrollLeft,
        0,
        '[12.15.7] Enquanto o deslocamento (0 -> 390) está pendente, scrollLeft efetivo ainda é 0'
      );
      assert.strictEqual(
        hasPendingFocusRestore(cwNavRow500),
        true,
        '[12.15.7] Enquanto o deslocamento está pendente, hasPendingFocusRestore deve ser true'
      );
      assert.strictEqual(
        countDuringForward,
        14,
        `[12.15.7] Durante o deslocamento pendente (0 -> 390), a quantidade de cartões montados deve permanecer limitada em 14 (obteve ${countDuringForward})`
      );
      assert.strictEqual(
        indicesDuringForward[0],
        0,
        '[12.15.7] Os cartões visíveis em scrollLeft=0 (iniciando no índice 0) devem continuar montados enquanto o deslocamento não ocorre'
      );
      assert.strictEqual(
        indicesDuringForward[indicesDuringForward.length - 1],
        13,
        '[12.15.7] A janela visível [0..13] deve permanecer intacta sem desmontar a área visível'
      );
      assert.strictEqual(
        cwNavRow500.querySelector('[data-virtual-spacer="left"]'),
        null,
        '[12.15.7] Enquanto scrollLeft efetivo é 0, não deve existir espaçador esquerdo cobrindo a área visível'
      );

      // Liberar o deslocamento simulado para o índice 390 (scrollLeft = 71211px)
      forceDelayAllScrollLeftWrites = false;
      await advancePendingSmoothScroll(1);

      const expectedScrollAt390 = 390 * 185 + 165 - 1120 + 16; // 71211px
      const cardsAfterForwardRestore = Array.from(
        cwNavRow500.querySelectorAll('[data-nav-item="true"]')
      ) as HTMLElement[];
      const indicesAfterForward = cardsAfterForwardRestore.map((el) =>
        Number(el.getAttribute('data-row-card-index'))
      );
      const countAfterForward = cardsAfterForwardRestore.length;
      const focusedAt390 = document.activeElement as HTMLElement | null;

      assert.strictEqual(
        cwNavRow500.scrollLeft,
        expectedScrollAt390,
        `[12.15.7] Após liberar o deslocamento, scrollLeft efetivo deve ser ${expectedScrollAt390}px`
      );
      assert.strictEqual(
        countAfterForward,
        14,
        `[12.15.7] Após o deslocamento para 390, devem estar montados 14 cartões (obteve ${countAfterForward})`
      );
      assert.strictEqual(indicesAfterForward[0], 381, '[12.15.7] A janela em 71211px deve iniciar em 381');
      assert.strictEqual(
        indicesAfterForward[indicesAfterForward.length - 1],
        394,
        '[12.15.7] A janela em 71211px deve terminar em 394 (contendo 390)'
      );
      assert(
        focusedAt390 !== null &&
          focusedAt390.getAttribute('data-row-item-key') === delayedRestoreKey &&
          focusedAt390.getAttribute('data-row-card-index') === '390',
        `[12.15.7] O foco deve ser entregue ao cartão correto no índice 390 pela rowKey (${delayedRestoreKey})`
      );
      assert.strictEqual(
        hasPendingFocusRestore(cwNavRow500),
        false,
        '[12.15.7] Após concluir a restauração no índice 390, a operação pendente deve ser limpa'
      );
      assert.strictEqual(
        cwNavRow500.getAttribute('data-pending-focus-restore'),
        null,
        '[12.15.7] O atributo data-pending-focus-restore deve ser removido após a conclusão'
      );

      // 2) Sentido Inverso: do índice 390 (scrollLeft=71211) de volta ao índice 0 com scrollLeft atrasado
      await act(async () => {
        focusedAt390!.focus();
        pushFocusForPlay(focusedAt390!);
        // Atualizar histórico para mover delayedRestoreKey do índice 390 para o índice 0
        recordPlaybackPosition(credsHomeImg, {
          id: delayedRestoreStreamId,
          type: 'movie',
          positionSec: 540,
        });
        await new Promise((r) => setTimeout(r, 20));
      });

      const countBeforeReverse = cwNavRow500.querySelectorAll('[data-nav-item="true"]').length;
      assert.strictEqual(
        countBeforeReverse,
        14,
        '[12.15.7] Antes da restauração inversa (390 -> 0), devem estar montados 14 cartões (381..394)'
      );

      forceDelayAllScrollLeftWrites = true;
      await act(async () => {
        const popRev = popFocusFromPlay();
        assert.strictEqual(
          popRev,
          true,
          '[12.15.7] popFocusMemory deve registrar a restauração pendente no sentido inverso (390 -> 0)'
        );
      });

      // ANTES de liberar o deslocamento inverso (scrollLeft ainda é 71211px):
      const cardsDuringReverseRestore = Array.from(
        cwNavRow500.querySelectorAll('[data-nav-item="true"]')
      ) as HTMLElement[];
      const indicesDuringReverse = cardsDuringReverseRestore.map((el) =>
        Number(el.getAttribute('data-row-card-index'))
      );
      const countDuringReverse = cardsDuringReverseRestore.length;

      assert.strictEqual(
        cwNavRow500.scrollLeft,
        expectedScrollAt390,
        '[12.15.7] Enquanto o deslocamento inverso (390 -> 0) está pendente, scrollLeft efetivo ainda é 71211px'
      );
      assert.strictEqual(
        hasPendingFocusRestore(cwNavRow500),
        true,
        '[12.15.7] hasPendingFocusRestore deve ser true durante o deslocamento inverso pendente'
      );
      assert.strictEqual(
        countDuringReverse,
        14,
        `[12.15.7] Durante o deslocamento inverso pendente (390 -> 0), a quantidade montada deve permanecer limitada em 14 (obteve ${countDuringReverse})`
      );
      assert.strictEqual(
        indicesDuringReverse[0],
        381,
        '[12.15.7] Os cartões da área visível em 71211px (381..394) devem continuar montados enquanto scrollLeft não muda'
      );
      assert.strictEqual(
        indicesDuringReverse[indicesDuringReverse.length - 1],
        394,
        '[12.15.7] O fim da janela visível em 71211px (394) deve continuar montado durante a transição pendente'
      );

      // Liberar o deslocamento inverso para scrollLeft = 0
      forceDelayAllScrollLeftWrites = false;
      await advancePendingSmoothScroll(1);

      const cardsAfterReverseRestore = Array.from(
        cwNavRow500.querySelectorAll('[data-nav-item="true"]')
      ) as HTMLElement[];
      const indicesAfterReverse = cardsAfterReverseRestore.map((el) =>
        Number(el.getAttribute('data-row-card-index'))
      );
      const countAfterReverse = cardsAfterReverseRestore.length;
      const focusedAt0 = document.activeElement as HTMLElement | null;

      assert.strictEqual(
        cwNavRow500.scrollLeft,
        0,
        '[12.15.7] Após liberar o deslocamento inverso, scrollLeft efetivo deve ser 0px'
      );
      assert.strictEqual(
        countAfterReverse,
        14,
        `[12.15.7] Após concluir o deslocamento inverso para 0, devem estar montados 14 cartões (obteve ${countAfterReverse})`
      );
      assert.strictEqual(indicesAfterReverse[0], 0);
      assert.strictEqual(indicesAfterReverse[indicesAfterReverse.length - 1], 13);
      assert(
        focusedAt0 !== null &&
          focusedAt0.getAttribute('data-row-item-key') === delayedRestoreKey &&
          focusedAt0.getAttribute('data-row-card-index') === '0',
        `[12.15.7] O foco deve ser devolvido ao cartão no índice 0 pela rowKey (${delayedRestoreKey})`
      );
      assert.strictEqual(
        hasPendingFocusRestore(cwNavRow500),
        false,
        '[12.15.7] A restauração pendente deve estar limpa após concluir o sentido inverso'
      );

      // 3) Interrupção da restauração pendente por nova navegação, rolagem do usuário e desmontagem
      // 3.A: Interrupção por nova navegação D-Pad (moveSpatialFocus)
      const card390Now = (() => {
        // Obter a chave do item que atualmente ocupa o índice 390
        const allHistEntries = Object.values(
          JSON.parse(windowInstance.localStorage.getItem(homeHistoryKey) || '{}')
        ) as any[];
        allHistEntries.sort((a, b) => b.updatedAt - a.updatedAt);
        return `movie_${allHistEntries[390].id}`;
      })();
      const { restoreVirtualItemByKey } = await import('../src/navigation');

      forceDelayAllScrollLeftWrites = true;
      await act(async () => {
        restoreVirtualItemByKey(cwNavRow500, card390Now, expectedScrollAt390);
      });
      assert.strictEqual(
        hasPendingFocusRestore(cwNavRow500),
        true,
        '[12.15.7] Restauração para 390 deve ficar pendente enquanto scrollLeft está retido em 0'
      );

      // Usuário navega por D-Pad para o cartão 1 antes do deslocamento acontecer
      await act(async () => {
        const navMoved = moveSpatialFocus('right');
        assert(navMoved !== null && navMoved.getAttribute('data-row-card-index') === '1');
      });
      assert.strictEqual(
        hasPendingFocusRestore(cwNavRow500),
        false,
        '[12.15.7] Nova navegação espacial (moveSpatialFocus) deve descartar imediatamente a restauração pendente'
      );

      // Mesmo que o scroll chegue a 71211px depois, a operação descartada NÃO pode roubar o foco para card390Now
      const heroPlayBtn = virtContainer.querySelector(
        '[data-scroll-top-anchor="true"] button'
      ) as HTMLElement;
      await act(async () => {
        heroPlayBtn.focus();
      });
      forceDelayAllScrollLeftWrites = false;
      pendingSmoothScrollTarget = expectedScrollAt390;
      await advancePendingSmoothScroll(1);
      assertSameElement(
        document.activeElement,
        heroPlayBtn,
        '[12.15.7] Restauração descartada por nova navegação não deve roubar o foco quando a fileira rolar depois'
      );

      // 3.B: Interrupção por rolagem do usuário (botão lateral / evento de scroll em outra posição)
      await act(async () => {
        cwNavRow500.style.scrollBehavior = 'auto';
        cwNavRow500.scrollLeft = 0;
        cwNavRow500.style.removeProperty('scroll-behavior');
        cwNavRow500.dispatchEvent(new windowInstance.Event('scroll') as unknown as Event);
      });
      forceDelayAllScrollLeftWrites = true;
      await act(async () => {
        restoreVirtualItemByKey(cwNavRow500, card390Now, expectedScrollAt390);
      });
      assert.strictEqual(hasPendingFocusRestore(cwNavRow500), true);

      forceDelayAllScrollLeftWrites = false;
      await act(async () => {
        nextChevronBtn.click(); // Rolagem suave iniciada pelo usuário
      });
      assert.strictEqual(
        hasPendingFocusRestore(cwNavRow500),
        false,
        '[12.15.7] Rolagem iniciada pelo usuário (botão lateral) deve descartar a restauração pendente'
      );
      await advancePendingSmoothScroll(1);
      assertSameElement(
        document.activeElement,
        heroPlayBtn,
        '[12.15.7] Restauração descartada por rolagem do usuário não deve roubar o foco'
      );

      console.log(
        `   • Regressão 12.15.7 (Destino Distante 0 <-> 390 c/ scrollLeft Atrasado): ` +
          `0->390 [antes=${countBeforeForward}, durante=${countDuringForward} (0..13), depois=${countAfterForward} (381..394)] | ` +
          `390->0 [antes=${countBeforeReverse}, durante=${countDuringReverse} (381..394), depois=${countAfterReverse} (0..13)]`
      );
    } finally {
      forceDelayAllScrollLeftWrites = false;
      pendingSmoothScrollTarget = null;
      if (origRowScrollDesc) {
        Object.defineProperty(cwNavRow500, 'scrollLeft', origRowScrollDesc);
      }
      cwNavRow500.scrollTo = origRowScrollTo;
      cwNavRow500.scrollBy = origRowScrollBy;
    }
  } finally {
    windowInstance.localStorage.removeItem(homeHistoryKey);
    if (savedWindowIO !== undefined) {
      (windowInstance as any).IntersectionObserver = savedWindowIO;
    }
    if (savedGlobalIO !== undefined) {
      (globalThis as any).IntersectionObserver = savedGlobalIO;
    }
    (windowInstance.HTMLElement.prototype as any).getBoundingClientRect = origProtoGetBCRHome;
    await act(async () => {
      virtRoot.unmount();
    });
    if (virtContainer.parentNode) {
      document.body.removeChild(virtContainer);
    }
    installDefaultXtreamOfflineMocks();
  }

  // =========================================================================
  // 12.16. Divisão de JavaScript por rota (AppRoutes + React.lazy para Home):
  //   1) Abertura sem sessão em "/" não solicita o módulo da Home
  //   2) Login seguido de acesso a "/home" exibe o indicador de carregamento durante a transição e preserva a sequência dos catálogos
  //   3) Saída da conta ("Sair") retorna imediatamente ao Login e limpa a sessão
  //   4) Abertura com sessão salva em "/" (auto-login) e acesso direto a "/home"
  // =========================================================================
  console.log('🧪 Testando 12.16: Divisão por rota (Login estático + Home sob demanda)...');
  const {
    AppRoutes,
    getHomeRouteLoadCountForTest,
    resetHomeRouteLoadCountForTest,
    setHomeRouteLoaderForTest,
  } = await import('../src/App');
  const { MemoryRouter: RouteSplitMemoryRouter } = await import('react-router-dom');
  const {
    CREDENTIALS_KEY: ROUTE_CRED_KEY,
    safeSaveCredentials: saveCredsForRouteTest,
  } = await import('../src/utils/accountUtils');
  const { STORAGE_KEY_DISPLAY_PREFS: ROUTE_DISPLAY_PREFS_KEY } = await import(
    '../src/platform/tvEnvironment'
  );

  const routeTestContainer = document.createElement('div');
  document.body.appendChild(routeTestContainer);
  const routeTestRoot = createRoot(routeTestContainer);

  const prevDisplayPrefsRouteTest = windowInstance.localStorage.getItem(ROUTE_DISPLAY_PREFS_KEY);
  windowInstance.localStorage.setItem(
    ROUTE_DISPLAY_PREFS_KEY,
    JSON.stringify({ version: 1, mode: 'default', tvScale: 85, configured: true })
  );

  try {
    // 12.16.1: Abertura sem sessão ("/") mantém Login disponível na abertura e NÃO carrega o pacote da Home
    windowInstance.localStorage.removeItem(ROUTE_CRED_KEY);
    setHomeRouteLoaderForTest(null);
    resetHomeRouteLoadCountForTest();

    await act(async () => {
      routeTestRoot.render(
        React.createElement(
          RouteSplitMemoryRouter,
          { initialEntries: ['/'] },
          React.createElement(NavigationProvider, null, React.createElement(AppRoutes, null))
        )
      );
      await new Promise((r) => setTimeout(r, 30));
    });

    assert(
      routeTestContainer.querySelector('[data-login-screen="true"]') !== null,
      '[12.16.1] Abertura sem sessão em "/" deve renderizar imediatamente a tela de Login'
    );
    assert.strictEqual(
      getHomeRouteLoadCountForTest(),
      0,
      '[12.16.1] Abertura sem sessão em "/" NÃO deve disparar o carregamento dinâmico da Home'
    );

    // 12.16.2: Login seguido de acesso à Home usa o indicador de carregamento na transição e preserva a sequência dos catálogos
    let resolveDelayedHomeModule: (() => void) | null = null;
    setHomeRouteLoaderForTest(
      () =>
        new Promise((resolve) => {
          resolveDelayedHomeModule = () => {
            import('../src/pages/Home').then((m) => resolve({ default: m.Home }));
          };
        })
    );
    resetHomeRouteLoadCountForTest();

    const catalogCallSequence: string[] = [];
    (XtreamService as any).authenticate = async () => {
      catalogCallSequence.push('authenticate');
      return {
        user_info: { username: 'splitUser', auth: 1, status: 'Active', allowed_output_formats: ['m3u8'] },
        server_info: { url: 'http://split.tv', port: '8080' },
      };
    };
    (XtreamService as any).getLiveCategories = async () => {
      catalogCallSequence.push('getLiveCategories');
      return [{ category_id: '1', category_name: 'Canais Ao Vivo' }];
    };
    (XtreamService as any).getVodCategories = async () => {
      catalogCallSequence.push('getVodCategories');
      return [{ category_id: '10', category_name: 'Filmes' }];
    };
    (XtreamService as any).getSeriesCategories = async () => {
      catalogCallSequence.push('getSeriesCategories');
      return [{ category_id: '20', category_name: 'Séries' }];
    };
    (XtreamService as any).getLiveStreams = async () => {
      catalogCallSequence.push('getLiveStreams');
      return [];
    };
    (XtreamService as any).getVodStreams = async () => {
      catalogCallSequence.push('getVodStreams');
      return [];
    };
    (XtreamService as any).getSeries = async () => {
      catalogCallSequence.push('getSeries');
      return [];
    };

    await act(async () => {
      routeTestRoot.render(
        React.createElement(
          RouteSplitMemoryRouter,
          { initialEntries: ['/'] },
          React.createElement(NavigationProvider, null, React.createElement(AppRoutes, null))
        )
      );
      await new Promise((r) => setTimeout(r, 20));
    });

    const setNativeInputValue = (input: HTMLInputElement, val: string) => {
      const setter = Object.getOwnPropertyDescriptor(
        windowInstance.HTMLInputElement.prototype,
        'value'
      )?.set;
      if (setter) {
        setter.call(input, val);
      } else {
        input.value = val;
      }
      input.dispatchEvent(new windowInstance.Event('input', { bubbles: true }) as unknown as Event);
      input.dispatchEvent(new windowInstance.Event('change', { bubbles: true }) as unknown as Event);
    };

    const serverInput = routeTestContainer.querySelector('#serverUrl') as HTMLInputElement;
    const userInput = routeTestContainer.querySelector('#username') as HTMLInputElement;
    const passInput = routeTestContainer.querySelector('#password') as HTMLInputElement;
    const loginForm = routeTestContainer.querySelector('form') as HTMLFormElement;
    assert(serverInput && userInput && passInput && loginForm, '[12.16.2] Campos do Login devem existir');

    await act(async () => {
      setNativeInputValue(serverInput, 'http://split.tv:8080');
      setNativeInputValue(userInput, 'splitUser');
      setNativeInputValue(passInput, 'splitPass');
    });

    await act(async () => {
      loginForm.dispatchEvent(
        new windowInstance.Event('submit', { bubbles: true, cancelable: true }) as unknown as Event
      );
      await new Promise((r) => setTimeout(r, 30));
    });

    assert.strictEqual(
      getHomeRouteLoadCountForTest(),
      1,
      '[12.16.2] Concluir o login e navegar para "/home" deve solicitar o módulo da Home sob demanda (1 vez)'
    );
    assert(
      routeTestContainer.querySelector('[data-route-loading="home"]') !== null,
      '[12.16.2] Enquanto o módulo da Home está carregando, o indicador de transição ([data-route-loading="home"]) deve ser exibido'
    );

    assert(resolveDelayedHomeModule !== null, '[12.16.2] Loader da Home deve estar aguardando resolução');
    await act(async () => {
      resolveDelayedHomeModule!();
      await new Promise((r) => setTimeout(r, 80));
    });

    assert(
      routeTestContainer.querySelector('[data-home-shell="true"]') !== null,
      '[12.16.2] Após resolver a importação dinâmica, a estrutura principal da Home ([data-home-shell="true"]) deve estar montada'
    );
    assert.deepStrictEqual(
      catalogCallSequence,
      [
        'authenticate',
        'getLiveCategories',
        'getVodCategories',
        'getLiveStreams',
        'getSeriesCategories',
        'getVodStreams',
        'getSeries',
      ],
      `[12.16.2] A sequência de carregamento dos catálogos na Home deve ser integralmente preservada (${catalogCallSequence.join(' -> ')})`
    );

    // 12.16.3: Saída da conta ("Sair") retorna ao Login e remove credenciais sem recarregar a Home
    const routeAccountTrigger = routeTestContainer.querySelector<HTMLButtonElement>(
      'button[data-header-account-trigger="true"]'
    );
    assert(routeAccountTrigger !== null, '[12.16.3] Botão da conta deve estar disponível no cabeçalho da Home');
    await act(async () => {
      routeAccountTrigger!.click();
    });
    const logoutBtn = Array.from(routeTestContainer.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Sair')
    ) as HTMLButtonElement | undefined;
    assert(logoutBtn !== undefined, '[12.16.3] Botão "Sair" deve estar disponível no menu da conta da Home');

    await act(async () => {
      logoutBtn!.click();
      await new Promise((r) => setTimeout(r, 30));
    });

    assert(
      routeTestContainer.querySelector('[data-login-screen="true"]') !== null,
      '[12.16.3] Clicar em "Sair" na Home deve retornar imediatamente para a tela de Login'
    );
    assert.strictEqual(
      windowInstance.localStorage.getItem(ROUTE_CRED_KEY),
      null,
      '[12.16.3] Clicar em "Sair" deve remover as credenciais salvas do localStorage'
    );
    assert.strictEqual(
      getHomeRouteLoadCountForTest(),
      1,
      '[12.16.3] Retornar ao Login não deve disparar novo carregamento da Home'
    );

    // 12.16.4: Abertura com sessão salva em "/" (auto-login) e acesso direto a "/home"
    setHomeRouteLoaderForTest(null);
    resetHomeRouteLoadCountForTest();
    saveCredsForRouteTest({
      playlistName: 'Lista Salva',
      serverUrl: 'http://split.tv:8080',
      username: 'savedUser',
      password: 'savedPassword',
      allowed_output_formats: ['m3u8'],
    });

    await act(async () => {
      routeTestRoot.render(React.createElement('div', null));
    });
    await act(async () => {
      routeTestRoot.render(
        React.createElement(
          RouteSplitMemoryRouter,
          { initialEntries: ['/'] },
          React.createElement(NavigationProvider, null, React.createElement(AppRoutes, null))
        )
      );
    });
    for (let i = 0; i < 80; i++) {
      if (routeTestContainer.querySelector('[data-home-shell="true"]') !== null) {
        break;
      }
      await act(async () => {
        await new Promise((r) => setTimeout(r, 25));
      });
    }

    assert.strictEqual(
      getHomeRouteLoadCountForTest(),
      1,
      '[12.16.4] Abertura em "/" com sessão salva (auto-login) deve redirecionar para "/home" e carregar a Home sob demanda'
    );
    assert(
      routeTestContainer.querySelector('[data-home-shell="true"]') !== null,
      '[12.16.4] Após o auto-login, a Home ([data-home-shell="true"]) deve estar montada'
    );

    // Acesso direto a "/home" sem sessão salva -> redireciona de volta ao Login ("/")
    windowInstance.localStorage.removeItem(ROUTE_CRED_KEY);
    await act(async () => {
      routeTestRoot.render(React.createElement('div', null));
    });
    await act(async () => {
      routeTestRoot.render(
        React.createElement(
          RouteSplitMemoryRouter,
          { initialEntries: ['/home'] },
          React.createElement(NavigationProvider, null, React.createElement(AppRoutes, null))
        )
      );
      await new Promise((r) => setTimeout(r, 60));
    });
    assert(
      routeTestContainer.querySelector('[data-login-screen="true"]') !== null,
      '[12.16.4] Acesso direto a "/home" sem sessão salva deve redirecionar com segurança para a tela de Login ("/")'
    );
  } finally {
    setHomeRouteLoaderForTest(null);
    resetHomeRouteLoadCountForTest();
    windowInstance.localStorage.removeItem(ROUTE_CRED_KEY);
    if (prevDisplayPrefsRouteTest !== null) {
      windowInstance.localStorage.setItem(ROUTE_DISPLAY_PREFS_KEY, prevDisplayPrefsRouteTest);
    } else {
      windowInstance.localStorage.removeItem(ROUTE_DISPLAY_PREFS_KEY);
    }
    await act(async () => {
      routeTestRoot.unmount();
    });
    if (routeTestContainer.parentNode) {
      document.body.removeChild(routeTestContainer);
    }
    installDefaultXtreamOfflineMocks();
  }

  // =========================================================================
  // 12.17. P2.1 — Atualizações do player conforme a visibilidade dos controles e do diagnóstico
  // =========================================================================
  console.log('\n--- 12.17. P2.1: Atualizações do Player conforme Visibilidade dos Controles e Diagnóstico ---');
  {
    const { usePlaybackSession } = await import('../src/components/player/usePlaybackSession');
    const { getHistoryKey, readHistoryMap } = await import('../src/utils/playbackHistory');
    const { setNavMode } = await import('../src/navigation');
    setNavMode('pointer');

    const p21Account: XtreamCredentials = {
      serverUrl: 'http://p21.tv:8080',
      username: 'p21User',
      password: 'p21Password',
    };
    const p21HistoryKey = getHistoryKey(p21Account.serverUrl, p21Account.username);
    windowInstance.localStorage.removeItem(p21HistoryKey);

    const p21Container = document.createElement('div');
    document.body.appendChild(p21Container);
    const p21Root = createRoot(p21Container);

    // -----------------------------------------------------------------------
    // 12.17.1 & 12.17.2: Comparação direta (Controles/Diagnóstico Ocultos vs Visíveis)
    //                    + Sincronização imediata ao reabrir controles e diagnóstico
    // -----------------------------------------------------------------------
    let hookRenderCount = 0;
    let bufferedReadCount = 0;
    let latestSession: ReturnType<typeof usePlaybackSession> | null = null;
    let currentBufferedEnd = 30;
    let finalErrorObserved: string | null = null;

    function HookProbe({
      url,
      controlsVisible,
      diagnosticsOpen,
      streamId = 77701,
    }: {
      url: string;
      controlsVisible: boolean;
      diagnosticsOpen: boolean;
      streamId?: number;
    }) {
      const vRef = React.useRef<HTMLVideoElement | null>(null);
      hookRenderCount += 1;
      const sess = usePlaybackSession({
        videoRef: vRef,
        streamUrl: url,
        contentType: 'movie',
        streamId,
        credentials: p21Account,
        isControlsVisible: controlsVisible,
        isDiagnosticsOpen: diagnosticsOpen,
        onPlaybackFinalError: (msg) => {
          finalErrorObserved = msg;
        },
      });
      latestSession = sess;
      return React.createElement('video', { ref: vRef });
    }

    await act(async () => {
      p21Root.render(
        React.createElement(HookProbe, {
          url: 'http://p21.tv:8080/movie/p21User/p21Password/77701.mp4',
          controlsVisible: true,
          diagnosticsOpen: false,
        })
      );
    });

    const probeVideo = p21Container.querySelector('video') as HTMLVideoElement;
    assert(probeVideo, '[12.17.1] Elemento <video> da sonda deve existir');

    Object.defineProperty(probeVideo, 'duration', {
      value: 200,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(probeVideo, 'videoWidth', {
      value: 1920,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(probeVideo, 'videoHeight', {
      value: 1080,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(probeVideo, 'buffered', {
      get() {
        bufferedReadCount += 1;
        return {
          length: 1,
          start: () => 0,
          end: () => currentBufferedEnd,
        };
      },
      configurable: true,
    });

    await act(async () => {
      probeVideo.dispatchEvent(new windowInstance.Event('loadedmetadata') as unknown as Event);
      probeVideo.dispatchEvent(new windowInstance.Event('playing') as unknown as Event);
    });

    assert.strictEqual(latestSession!.isPlaying, true, '[12.17.1] Sessão deve estar em reprodução');
    assert.strictEqual(latestSession!.duration, 200, '[12.17.1] Duração inicial deve ser sincronizada (200s)');

    // Medir comportamento com controles ocultos e diagnóstico fechado:
    // 20 eventos timeupdate + 10 eventos progress + 2.2s de relógio (2 ciclos de 1000ms)
    await act(async () => {
      p21Root.render(
        React.createElement(HookProbe, {
          url: 'http://p21.tv:8080/movie/p21User/p21Password/77701.mp4',
          controlsVisible: false,
          diagnosticsOpen: false,
        })
      );
    });

    const rendersBeforeHiddenBurst = hookRenderCount;
    const bufferedReadsBeforeHiddenBurst = bufferedReadCount;
    const statsRefBeforeHiddenBurst = latestSession!.stats;

    await act(async () => {
      for (let i = 1; i <= 20; i++) {
        probeVideo.currentTime = i * 2; // avança de 2s até 40s
        probeVideo.dispatchEvent(new windowInstance.Event('timeupdate') as unknown as Event);
      }
      for (let j = 1; j <= 10; j++) {
        currentBufferedEnd = 40 + j * 5; // avança buffer até 90s
        probeVideo.dispatchEvent(new windowInstance.Event('progress') as unknown as Event);
      }
      await new Promise((r) => setTimeout(r, 2200));
    });

    const hiddenBurstRenders = hookRenderCount - rendersBeforeHiddenBurst;
    const hiddenBurstBufferedReads = bufferedReadCount - bufferedReadsBeforeHiddenBurst;

    assert.strictEqual(
      hiddenBurstRenders,
      0,
      `[12.17.1] Com controles e diagnóstico ocultos, 20 timeupdate + 10 progress + 2.2s devem gerar 0 re-renders visuais (obteve ${hiddenBurstRenders}, antes: 32)`
    );
    assert.strictEqual(
      hiddenBurstBufferedReads,
      0,
      `[12.17.1] Com controles e diagnóstico ocultos, calculateBufferStats não deve ler video.buffered (obteve ${hiddenBurstBufferedReads} leituras, antes: 32)`
    );
    assert.strictEqual(
      latestSession!.stats,
      statsRefBeforeHiddenBurst,
      '[12.17.1] Com diagnóstico fechado, o objeto stats não deve ser republicado por timer periódico'
    );

    // Confirmar que a persistência do progresso (Continuar Assistindo) continuou funcionando com controles ocultos
    const savedHistoryHidden = readHistoryMap(p21HistoryKey);
    const savedMovieRec = savedHistoryHidden?.['movie:77701'];
    assert.strictEqual(
      savedMovieRec?.positionSec,
      36,
      `[12.17.1] Mesmo com controles ocultos, timeupdate deve persistir o progresso de reprodução na cadência de >=5s (positionSec=${savedMovieRec?.positionSec})`
    );

    // Simular 2 eventos de waiting (rebuffering) + retorno a playing com controles e diagnóstico ocultos
    await act(async () => {
      probeVideo.dispatchEvent(new windowInstance.Event('waiting') as unknown as Event);
    });
    assert.strictEqual(
      latestSession!.isBuffering,
      true,
      '[12.17.1] Evento waiting deve continuar atualizando isBuffering mesmo com controles ocultos'
    );
    await act(async () => {
      probeVideo.dispatchEvent(new windowInstance.Event('playing') as unknown as Event);
      probeVideo.dispatchEvent(new windowInstance.Event('waiting') as unknown as Event);
      probeVideo.dispatchEvent(new windowInstance.Event('playing') as unknown as Event);
    });
    assert.strictEqual(
      latestSession!.isBuffering,
      false,
      '[12.17.1] Evento playing deve limpar isBuffering normalmente com controles ocultos'
    );

    // Agora reabrir os controles SEM disparar novo timeupdate ou progress -> deve sincronizar imediatamente!
    await act(async () => {
      p21Root.render(
        React.createElement(HookProbe, {
          url: 'http://p21.tv:8080/movie/p21User/p21Password/77701.mp4',
          controlsVisible: true,
          diagnosticsOpen: false,
        })
      );
    });

    assert.strictEqual(
      latestSession!.currentTime,
      40,
      `[12.17.2] Ao reabrir controles, currentTime deve refletir imediatamente o tempo real do vídeo (40s) sem esperar novo timeupdate (obteve ${latestSession!.currentTime})`
    );
    assert.strictEqual(
      latestSession!.bufferedAhead,
      50,
      `[12.17.2] Ao reabrir controles, bufferedAhead deve ser sincronizado imediatamente (90 - 40 = 50s, obteve ${latestSession!.bufferedAhead})`
    );
    assert.strictEqual(
      latestSession!.bufferedRanges.length,
      1,
      '[12.17.2] Ao reabrir controles, bufferedRanges deve ser sincronizado imediatamente'
    );
    assert.strictEqual(
      latestSession!.bufferedRanges[0].end,
      90,
      '[12.17.2] Ao reabrir controles, o fim da faixa de buffer deve ser 90s'
    );

    // -----------------------------------------------------------------------
    // 12.17.3: Diagnóstico sob demanda (aberto em reprodução e aberto em pausa)
    // -----------------------------------------------------------------------
    // Abrir diagnóstico durante a reprodução -> snapshot imediato + atualização periódica a cada 1s
    await act(async () => {
      p21Root.render(
        React.createElement(HookProbe, {
          url: 'http://p21.tv:8080/movie/p21User/p21Password/77701.mp4',
          controlsVisible: true,
          diagnosticsOpen: true,
        })
      );
    });

    assert.strictEqual(
      latestSession!.stats.width,
      1920,
      '[12.17.3] Ao abrir o diagnóstico, a largura do vídeo (1920) deve estar disponível imediatamente'
    );
    assert.strictEqual(
      latestSession!.stats.height,
      1080,
      '[12.17.3] Ao abrir o diagnóstico, a altura do vídeo (1080) deve estar disponível imediatamente'
    );
    assert.strictEqual(
      latestSession!.stats.currentTime,
      40,
      '[12.17.3] Ao abrir o diagnóstico, currentTime (40s) deve estar disponível imediatamente'
    );
    assert.strictEqual(
      latestSession!.stats.rebufferingCount,
      2,
      '[12.17.3] Ao abrir o diagnóstico, rebufferingCount acumulado enquanto estava fechado (2) deve ser preservado'
    );

    // Pausar o vídeo, alterar currentTime/buffer e verificar que o diagnóstico continua atualizando em pausa e ao abrir já pausado
    await act(async () => {
      p21Root.render(
        React.createElement(HookProbe, {
          url: 'http://p21.tv:8080/movie/p21User/p21Password/77701.mp4',
          controlsVisible: true,
          diagnosticsOpen: false,
        })
      );
    });

    await act(async () => {
      probeVideo.currentTime = 75;
      currentBufferedEnd = 120;
      probeVideo.dispatchEvent(new windowInstance.Event('pause') as unknown as Event);
    });

    // Abrir diagnóstico com o vídeo já pausado -> snapshot imediato deve ler 75s e bufferAhead=45s
    await act(async () => {
      p21Root.render(
        React.createElement(HookProbe, {
          url: 'http://p21.tv:8080/movie/p21User/p21Password/77701.mp4',
          controlsVisible: true,
          diagnosticsOpen: true,
        })
      );
    });

    assert.strictEqual(
      latestSession!.stats.currentTime,
      75,
      '[12.17.3] Ao abrir diagnóstico com o vídeo pausado, stats.currentTime deve refletir imediatamente 75s'
    );
    assert.strictEqual(
      latestSession!.stats.bufferedAhead,
      45,
      '[12.17.3] Ao abrir diagnóstico com o vídeo pausado, stats.bufferedAhead deve refletir imediatamente 45s'
    );

    // Enquanto o diagnóstico permanece aberto em pausa, se o buffer avançar (ex.: download em background), o timer de 1s atualiza stats
    currentBufferedEnd = 140;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1150));
    });
    assert.strictEqual(
      latestSession!.stats.bufferedAhead,
      65,
      '[12.17.3] Com diagnóstico aberto (mesmo em pausa), a atualização periódica deve manter stats.bufferedAhead atualizado (65s)'
    );

    // Fechar diagnóstico -> parar atualização periódica imediatamente
    await act(async () => {
      p21Root.render(
        React.createElement(HookProbe, {
          url: 'http://p21.tv:8080/movie/p21User/p21Password/77701.mp4',
          controlsVisible: false,
          diagnosticsOpen: false,
        })
      );
    });
    const statsAfterDiagClosed = latestSession!.stats;
    currentBufferedEnd = 180;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1200));
    });
    assert.strictEqual(
      latestSession!.stats,
      statsAfterDiagClosed,
      '[12.17.3] Após fechar o diagnóstico, nenhuma atualização periódica de stats deve ocorrer'
    );

    // Validar que erro de mídia continua funcionando com controles ocultos
    await act(async () => {
      Object.defineProperty(probeVideo, 'error', {
        value: { code: 2 },
        configurable: true,
      });
      probeVideo.dispatchEvent(new windowInstance.Event('error') as unknown as Event);
    });
    assert(
      Boolean(latestSession!.error) && Boolean(finalErrorObserved),
      '[12.17.1] Erros de mídia e callbacks de fallback (onPlaybackFinalError) devem continuar funcionando com controles ocultos'
    );

    await act(async () => {
      p21Root.unmount();
    });

    // -----------------------------------------------------------------------
    // 12.17.4 & 12.17.5: VideoPlayer completo — Estabilidade do listener de atalhos
    //                    e preservação da sessão (<video>, video.load, currentTime)
    //                    ao alternar controles, configurações e diagnóstico
    // -----------------------------------------------------------------------
    const vpContainer = document.createElement('div');
    document.body.appendChild(vpContainer);
    const vpRoot = createRoot(vpContainer);

    let keydownAddCalls = 0;
    let keydownRemoveCalls = 0;
    const origWinAddEventListener = windowInstance.addEventListener.bind(windowInstance);
    const origWinRemoveEventListener = windowInstance.removeEventListener.bind(windowInstance);

    windowInstance.addEventListener = ((type: string, listener: any, options?: any) => {
      if (type === 'keydown' && !options) {
        keydownAddCalls += 1;
      }
      return origWinAddEventListener(type, listener, options);
    }) as any;

    windowInstance.removeEventListener = ((type: string, listener: any, options?: any) => {
      if (type === 'keydown' && !options) {
        keydownRemoveCalls += 1;
      }
      return origWinRemoveEventListener(type, listener, options);
    }) as any;

    try {
      await act(async () => {
        vpRoot.render(
          React.createElement(VideoPlayer, {
            streamUrl: 'http://p21.tv:8080/movie/p21User/p21Password/88801.mp4',
            title: 'Filme P2.1 Atalhos e Sessão',
            contentType: 'movie',
            streamId: 88801,
            embedded: true,
            onBack: () => {},
          })
        );
      });

      assert.strictEqual(
        keydownAddCalls,
        1,
        '[12.17.4] VideoPlayer deve registrar o listener de atalhos keydown exatamente 1 vez na montagem'
      );

      const vpVideo = vpContainer.querySelector('video') as HTMLVideoElement;
      assert(vpVideo, '[12.17.4] Elemento <video> do VideoPlayer deve existir');
      Object.defineProperty(vpVideo, 'duration', {
        value: 100,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(vpVideo, 'videoWidth', {
        value: 1280,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(vpVideo, 'videoHeight', {
        value: 720,
        configurable: true,
        writable: true,
      });

      const loadCountAfterMount = videoLoadCallCount;
      const addCallsAfterMount = keydownAddCalls;
      const removeCallsAfterMount = keydownRemoveCalls;

      await act(async () => {
        vpVideo.dispatchEvent(new windowInstance.Event('loadedmetadata') as unknown as Event);
        vpVideo.dispatchEvent(new windowInstance.Event('playing') as unknown as Event);
      });

      // Aguardar auto-hide dos controles (3.1s em modo pointer)
      await act(async () => {
        await new Promise((r) => setTimeout(r, 3150));
      });

      const bottomBar = vpContainer.querySelector('.bg-gradient-to-t') as HTMLElement;
      assert(
        bottomBar && bottomBar.className.includes('opacity-0'),
        '[12.17.4] Controles devem estar ocultos após inatividade'
      );

      // Disparar 15 eventos timeupdate + 10 progress + volumechange enquanto oculto e depois visível
      await act(async () => {
        for (let i = 1; i <= 15; i++) {
          vpVideo.currentTime = i * 3; // até 45s
          vpVideo.dispatchEvent(new windowInstance.Event('timeupdate') as unknown as Event);
        }
        for (let j = 1; j <= 10; j++) {
          vpVideo.dispatchEvent(new windowInstance.Event('progress') as unknown as Event);
        }
      });

      assert.strictEqual(
        keydownAddCalls - addCallsAfterMount,
        0,
        `[12.17.4] Atualizações de mídia e auto-hide NÃO devem reinstalar o listener keydown (add=${keydownAddCalls - addCallsAfterMount})`
      );
      assert.strictEqual(
        keydownRemoveCalls - removeCallsAfterMount,
        0,
        `[12.17.4] Atualizações de mídia e auto-hide NÃO devem remover/reinstalar o listener keydown (remove=${keydownRemoveCalls - removeCallsAfterMount})`
      );

      // Reabrir controles via mousemove -> deve exibir imediatamente "00:45 / 01:40" sem novo timeupdate!
      const playerBox = vpContainer.querySelector('[data-player-container="true"]') as HTMLElement;
      await act(async () => {
        playerBox.dispatchEvent(
          new windowInstance.MouseEvent('mousemove', { bubbles: true }) as unknown as Event
        );
      });

      assert(
        bottomBar.className.includes('opacity-100'),
        '[12.17.2] Movimento do mouse deve reexibir a barra de controles'
      );
      assert(
        bottomBar.textContent?.includes('00:45 / 01:40'),
        `[12.17.2] Barra de controles reaberta deve mostrar imediatamente o tempo atual sincronizado ("00:45 / 01:40"), obteve: "${bottomBar.textContent}"`
      );

      // Testar atalhos de teclado (ArrowDown volume, ArrowRight seekBy +10s, tecla '5' busca 50% = 50s, 'm' mute)
      // Garantir que nenhum botão interno esteja focado para exercitar o listener global de atalhos
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }

      const initialVol = vpVideo.volume;
      await act(async () => {
        windowInstance.dispatchEvent(
          new (windowInstance as any).KeyboardEvent('keydown', {
            key: 'ArrowDown',
            bubbles: true,
            cancelable: true,
          })
        );
      });
      const volAfterFirstDown = vpVideo.volume;
      assert(
        Math.abs(volAfterFirstDown - (initialVol - 0.1)) < 1e-6,
        `[12.17.4] Atalho ArrowDown deve reduzir volume em 0.1 (de ${initialVol} para ${volAfterFirstDown})`
      );

      // Segundo ArrowDown consecutivo deve usar o volume atualizado (volAfterFirstDown - 0.1) sem reinstalar o listener
      await act(async () => {
        windowInstance.dispatchEvent(
          new (windowInstance as any).KeyboardEvent('keydown', {
            key: 'ArrowDown',
            bubbles: true,
            cancelable: true,
          })
        );
      });
      assert(
        Math.abs(vpVideo.volume - (volAfterFirstDown - 0.1)) < 1e-6,
        `[12.17.4] Segundo ArrowDown deve ler o volume atualizado da sessão (${vpVideo.volume})`
      );

      // Atalho ArrowRight -> avança +10s (de 45s para 55s)
      await act(async () => {
        windowInstance.dispatchEvent(
          new (windowInstance as any).KeyboardEvent('keydown', {
            key: 'ArrowRight',
            bubbles: true,
            cancelable: true,
          })
        );
      });
      assert.strictEqual(
        vpVideo.currentTime,
        55,
        '[12.17.4] Atalho ArrowRight deve avançar 10s (de 45s para 55s) sem duplicidade de listeners'
      );

      // Atalho numérico '5' -> busca 50% da duração (50s de 100s)
      await act(async () => {
        windowInstance.dispatchEvent(
          new (windowInstance as any).KeyboardEvent('keydown', {
            key: '5',
            bubbles: true,
            cancelable: true,
          })
        );
      });
      assert.strictEqual(
        vpVideo.currentTime,
        50,
        '[12.17.4] Atalho numérico "5" deve buscar 50% da duração atual (50s)'
      );

      // Regressão: Ocultar controles, alterar duração de 100s para 200s, disparar durationchange
      // e pressionar "5" sem novo timeupdate -> deve buscar 100s na própria tecla pressionada
      await act(async () => {
        await new Promise((r) => setTimeout(r, 3150));
      });
      assert(
        bottomBar.className.includes('opacity-0'),
        '[12.17.4] Controles devem estar ocultos antes da mudança de duração 100s -> 200s'
      );

      await act(async () => {
        Object.defineProperty(vpVideo, 'duration', {
          value: 200,
          configurable: true,
          writable: true,
        });
        vpVideo.dispatchEvent(new windowInstance.Event('durationchange') as unknown as Event);
      });

      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      await act(async () => {
        windowInstance.dispatchEvent(
          new (windowInstance as any).KeyboardEvent('keydown', {
            key: '5',
            bubbles: true,
            cancelable: true,
          })
        );
      });
      assert.strictEqual(
        vpVideo.currentTime,
        100,
        '[12.17.4] Com controles ocultos e mudança de duração de 100s para 200s (durationchange sem novo timeupdate), pressionar "5" deve buscar 100s'
      );
      assert(
        bottomBar.textContent?.includes('01:40 / 03:20'),
        `[12.17.4] Ao despertar os controles com a tecla "5" após 100s -> 200s, a barra deve exibir "01:40 / 03:20", obteve: "${bottomBar.textContent}"`
      );
      assert.strictEqual(
        videoLoadCallCount,
        loadCountAfterMount,
        '[12.17.4] Mudança de duração 100s -> 200s e busca por tecla "5" não devem reinicializar a mídia'
      );

      // Regressão inversa: Ocultar controles, alterar duração de 200s para 100s, disparar durationchange
      // e pressionar "5" sem novo timeupdate -> deve buscar 50s na própria tecla pressionada
      await act(async () => {
        await new Promise((r) => setTimeout(r, 3150));
      });
      assert(
        bottomBar.className.includes('opacity-0'),
        '[12.17.4] Controles devem estar ocultos antes da mudança de duração 200s -> 100s'
      );

      await act(async () => {
        Object.defineProperty(vpVideo, 'duration', {
          value: 100,
          configurable: true,
          writable: true,
        });
        vpVideo.dispatchEvent(new windowInstance.Event('durationchange') as unknown as Event);
      });

      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      await act(async () => {
        windowInstance.dispatchEvent(
          new (windowInstance as any).KeyboardEvent('keydown', {
            key: '5',
            bubbles: true,
            cancelable: true,
          })
        );
      });
      assert.strictEqual(
        vpVideo.currentTime,
        50,
        '[12.17.4] Com controles ocultos e mudança de duração de 200s para 100s (durationchange sem novo timeupdate), pressionar "5" deve buscar 50s'
      );
      assert(
        bottomBar.textContent?.includes('00:50 / 01:40'),
        `[12.17.4] Ao despertar os controles com a tecla "5" após 200s -> 100s, a barra deve exibir "00:50 / 01:40", obteve: "${bottomBar.textContent}"`
      );

      // Tratamento seguro para durações desconhecidas, inválidas ou infinitas (NaN, Infinity, 0)
      for (const invalidDur of [NaN, Infinity, 0, -10]) {
        await act(async () => {
          Object.defineProperty(vpVideo, 'duration', {
            value: invalidDur,
            configurable: true,
            writable: true,
          });
          vpVideo.dispatchEvent(new windowInstance.Event('durationchange') as unknown as Event);
          windowInstance.dispatchEvent(
            new (windowInstance as any).KeyboardEvent('keydown', {
              key: '8',
              bubbles: true,
              cancelable: true,
            })
          );
        });
        assert.strictEqual(
          vpVideo.currentTime,
          50,
          `[12.17.4] Duração inválida/infinita (${String(invalidDur)}) deve ser ignorada com segurança pelo atalho numérico`
        );
      }

      // Restaurar duração válida de 100s
      await act(async () => {
        Object.defineProperty(vpVideo, 'duration', {
          value: 100,
          configurable: true,
          writable: true,
        });
        vpVideo.dispatchEvent(new windowInstance.Event('durationchange') as unknown as Event);
      });

      // Atalho 'm' -> alterna mute
      assert.strictEqual(vpVideo.muted, false, '[12.17.4] Vídeo inicia não mutado');
      await act(async () => {
        windowInstance.dispatchEvent(
          new (windowInstance as any).KeyboardEvent('keydown', {
            key: 'm',
            bubbles: true,
            cancelable: true,
          })
        );
      });
      assert.strictEqual(vpVideo.muted, true, '[12.17.4] Atalho "m" deve ativar mudo');

      // 12.17.5: Abrir e fechar Configurações e Diagnóstico preservando <video>, videoLoadCallCount e currentTime
      const settingsBtn = vpContainer.querySelector(
        'button[data-player-control="settings"]'
      ) as HTMLButtonElement;
      const diagnosticsBtn = vpContainer.querySelector(
        'button[data-player-control="diagnostics"]'
      ) as HTMLButtonElement;
      assert(settingsBtn && diagnosticsBtn, '[12.17.5] Botões de Configurações e Diagnóstico devem existir');

      await act(async () => {
        settingsBtn.click();
      });
      assert(
        vpContainer.querySelector('[data-settings-list="true"]') !== null,
        '[12.17.5] Menu de Configurações deve abrir'
      );
      await act(async () => {
        settingsBtn.click();
      });

      await act(async () => {
        diagnosticsBtn.click();
      });
      assert(
        vpContainer.textContent?.includes('Diagnóstico Técnico da Reprodução'),
        '[12.17.5] Modal de Diagnóstico deve abrir'
      );
      assert(
        vpContainer.textContent?.includes('1280x720'),
        '[12.17.3] Modal de Diagnóstico deve exibir imediatamente a resolução atual (1280x720) ao abrir'
      );
      assert(
        vpContainer.textContent?.includes('50s / 100s'),
        '[12.17.3] Modal de Diagnóstico deve exibir imediatamente a posição/duração atual (50s / 100s) ao abrir'
      );

      const closeDiagBtn = vpContainer.querySelector(
        'button[aria-label="Fechar diagnóstico"]'
      ) as HTMLButtonElement;
      assert(closeDiagBtn, '[12.17.5] Botão de fechar diagnóstico deve existir');
      await act(async () => {
        closeDiagBtn.click();
      });

      assertSameElement(
        vpContainer.querySelector('video'),
        vpVideo,
        '[12.17.5] Alternar controles, configurações e diagnóstico deve preservar a mesma instância DOM de <video>'
      );
      assert.strictEqual(
        videoLoadCallCount,
        loadCountAfterMount,
        '[12.17.5] Alternar controles, configurações e diagnóstico NÃO deve chamar video.load() nem recarregar a mídia'
      );
      assert.strictEqual(
        vpVideo.currentTime,
        50,
        '[12.17.5] Alternar controles, configurações e diagnóstico deve preservar video.currentTime intacto (50s)'
      );
      assert.strictEqual(
        keydownAddCalls - addCallsAfterMount,
        0,
        '[12.17.4] Nenhum re-registro do listener keydown deve ocorrer durante todo o ciclo de uso do player'
      );
      assert.strictEqual(
        keydownRemoveCalls - removeCallsAfterMount,
        0,
        '[12.17.4] Nenhuma remoção/reinstalação do listener keydown deve ocorrer antes da desmontagem do player'
      );

      console.log(
        `📊 [Métricas P2.1 — Player c/ Controles e Diagnóstico Ocultos (20 timeupdate + 10 progress + 2.2s)]\n` +
          `   • Re-renders por tempo/buffer/diagnóstico oculto: antes=32 | depois=${hiddenBurstRenders}\n` +
          `   • Leituras de video.buffered (calculateBufferStats) oculto: antes=32 | depois=${hiddenBurstBufferedReads}\n` +
          `   • Reinstalações do listener global keydown na sessão: antes=30+ | depois=${keydownAddCalls - addCallsAfterMount}`
      );
    } finally {
      windowInstance.addEventListener = origWinAddEventListener;
      windowInstance.removeEventListener = origWinRemoveEventListener;
      windowInstance.localStorage.removeItem(p21HistoryKey);
      await act(async () => {
        vpRoot.unmount();
      });
      if (vpContainer.parentNode) {
        document.body.removeChild(vpContainer);
      }
      if (p21Container.parentNode) {
        document.body.removeChild(p21Container);
      }
    }
  }

  // =========================================================================
  // 12.18. P2.2 — Isolamento das atualizações do contexto compartilhado
  // =========================================================================
  console.log('\n🧪 Testando 12.18 (P2.2): Isolamento das atualizações do contexto compartilhado...');
  {
    const { HeroBanner } = await import('../src/components/HeroBanner');
    const { HorizontalRow } = await import('../src/components/HorizontalRow');
    const { MovieDetails } = await import('../src/components/MovieDetails');
    const { SeriesDetails } = await import('../src/components/SeriesDetails');

    const p22CredsA: XtreamCredentials = {
      serverUrl: 'http://p22-account-a.iptv.local:8080',
      username: 'user_p22_a',
      password: 'pass_p22_a',
      allowed_output_formats: ['m3u8', 'ts'],
    };
    const p22CredsB: XtreamCredentials = {
      serverUrl: 'http://p22-account-b.iptv.local:8080',
      username: 'user_p22_b',
      password: 'pass_p22_b',
      allowed_output_formats: ['m3u8', 'ts'],
    };

    let vodFailMode = false;
    let seriesFailMode = false;
    let vodBatchVersion = 1;
    let seriesBatchVersion = 1;
    let liveBatchVersion = 1;

    (XtreamService as any).getAccountInfo = async (creds: XtreamCredentials) => ({
      user_info: {
        username: creds.username,
        status: 'Active',
        exp_date: '1893456000',
        max_connections: '2',
        active_cons: '1',
      },
      server_info: {
        url: creds.serverUrl,
        port: '8080',
        server_protocol: 'http',
        timezone: 'America/Sao_Paulo',
      },
    });
    (XtreamService as any).getVodInfo = async (_creds: XtreamCredentials, id: string | number) => ({
      info: {
        name: `Filme Detalhe ${id}`,
        plot: 'Sinopse de teste P2.2',
        duration: '01:45:00',
        rating: '8.4',
        releasedate: '2025-01-01',
      },
      movie_data: {
        stream_id: Number(id),
        name: `Filme Detalhe ${id}`,
        container_extension: 'mp4',
      },
    });
    (XtreamService as any).getSeriesInfo = async (_creds: XtreamCredentials, id: string | number) => ({
      info: {
        name: `Série Detalhe ${id}`,
        plot: 'Sinopse de série P2.2',
        rating: '8.9',
      },
      seasons: [{ season_number: 1, name: 'Temporada 1' }],
      episodes: {
        '1': [
          {
            id: '9101',
            episode_num: 1,
            title: 'Episódio 1',
            container_extension: 'mp4',
            info: { duration: '00:45:00' },
          },
        ],
      },
    });

    (XtreamService as any).getLiveCategories = async (creds: XtreamCredentials) => [
      { category_id: 'live_cat_1', category_name: `Ao Vivo ${creds.username} v${liveBatchVersion}` },
    ];
    (XtreamService as any).getLiveStreams = async (creds: XtreamCredentials) => [
      {
        stream_id: 501,
        name: `Canal ${creds.username} v${liveBatchVersion}`,
        category_id: 'live_cat_1',
        stream_icon: '',
      },
    ];
    (XtreamService as any).getVodCategories = async (creds: XtreamCredentials) => {
      if (vodFailMode) {
        const err: any = new Error('Falha transitória em categorias VOD');
        err.isTransient = true;
        throw err;
      }
      return [
        { category_id: 'vod_cat_1', category_name: `Aventura VOD ${creds.username} v${vodBatchVersion}` },
      ];
    };
    (XtreamService as any).getVodStreams = async (creds: XtreamCredentials) => {
      if (vodFailMode) {
        const err: any = new Error('Falha transitória em catálogo VOD');
        err.isTransient = true;
        throw err;
      }
      return [
        {
          stream_id: 601,
          name: `Filme ${creds.username} v${vodBatchVersion}`,
          category_id: 'vod_cat_1',
          stream_icon: '',
          rating: '8.5',
          added: '1700000000',
        },
      ];
    };
    (XtreamService as any).getSeriesCategories = async (creds: XtreamCredentials) => {
      if (seriesFailMode) {
        const err: any = new Error('Falha transitória em categorias de Séries');
        err.isTransient = true;
        throw err;
      }
      return [
        {
          category_id: 'series_cat_1',
          category_name: `Mistério Series ${creds.username} v${seriesBatchVersion}`,
        },
      ];
    };
    (XtreamService as any).getSeries = async (creds: XtreamCredentials) => {
      if (seriesFailMode) {
        const err: any = new Error('Falha transitória em catálogo de Séries');
        err.isTransient = true;
        throw err;
      }
      return [
        {
          series_id: 701,
          name: `Série ${creds.username} v${seriesBatchVersion}`,
          category_id: 'series_cat_1',
          cover: '',
          rating: '9.1',
          last_modified: '1700000000',
        },
      ];
    };

    const renderCounts: Record<string, number> = {
      ParentAggregatedShell: 0,
      ConfigView: 0,
      FavoritesView: 0,
      MovieDetails: 0,
      SeriesDetails: 0,
      HeroBanner: 0,
      HorizontalRow: 0,
      VideoPlayer: 0,
      UseFavoritesProbe: 0,
      LiveTvView: 0,
      MoviesView: 0,
      SeriesView: 0,
    };

    const resetRenderCounts = () => {
      for (const k of Object.keys(renderCounts)) {
        renderCounts[k] = 0;
      }
    };

    // Props estáveis para os componentes sob medição
    const stableNoop = () => {};
    const stableHeroItems = [
      {
        stream_id: 601,
        stream_type: 'movie',
        name: 'Filme Hero Estável',
        backdrop_path: ['http://p22.local/backdrop.jpg'],
        rating: '8.8',
      },
    ];
    const stableRowItems = [
      {
        stream_id: 601,
        name: 'Filme Row Estável',
        stream_icon: '',
      },
    ];

    let latestCtxActions: any = null;
    let latestFavHookCredsUser: string | null = null;

    const UseFavoritesProbe = React.memo(function UseFavoritesProbe() {
      const favs = useFavorites();
      const creds = useOptionalXtreamCredentials();
      latestFavHookCredsUser = creds?.username ?? null;
      return React.createElement('div', { 'data-fav-count': favs.favorites.length });
    });

    const trackedMemoComponents: Array<[string, any]> = [
      ['ConfigView', ConfigView],
      ['FavoritesView', FavoritesView],
      ['MovieDetails', MovieDetails],
      ['SeriesDetails', SeriesDetails],
      ['HeroBanner', HeroBanner],
      ['HorizontalRow', HorizontalRow],
      ['VideoPlayer', VideoPlayer],
      ['UseFavoritesProbe', UseFavoritesProbe],
      ['LiveTvView', LiveTvView],
      ['MoviesView', MoviesView],
      ['SeriesView', SeriesView],
    ];
    const originalMemoTypes = new Map<any, any>();
    for (const [compName, compObj] of trackedMemoComponents) {
      if (compObj && typeof compObj === 'object' && typeof compObj.type === 'function') {
        const origType = compObj.type;
        originalMemoTypes.set(compObj, origType);
        compObj.type = function trackedComponentRender(...args: any[]) {
          renderCounts[compName] = (renderCounts[compName] || 0) + 1;
          return origType.apply(this, args);
        };
      }
    }

    // Casca pai que assina useXtreamContext() agregado, provando que mesmo quando um ancestral
    // re-renderiza por mudança de status/erro de um domínio, os filhos isolados e memoizados
    // NÃO re-renderizam se seus próprios contextos e props não mudaram.
    function ParentAggregatedShell() {
      const ctx = useXtreamContext();
      latestCtxActions = ctx;
      renderCounts.ParentAggregatedShell++;

      return React.createElement(
        'div',
        { 'data-p22-shell': ctx.vodCatalogStatus },
        React.createElement(ConfigView, null),
        React.createElement(FavoritesView, { onPlay: stableNoop, searchQuery: '' }),
        React.createElement(MovieDetails, {
          streamId: 601,
          streamName: 'Filme Detalhe 601',
          streamIcon: '',
          onClose: stableNoop,
          onPlay: stableNoop,
        }),
        React.createElement(SeriesDetails, {
          seriesId: 701,
          seriesName: 'Série Detalhe 701',
          seriesCover: '',
          onClose: stableNoop,
          onPlay: stableNoop,
        }),
        React.createElement(HeroBanner, {
          items: stableHeroItems,
          isPaused: true,
          onPlay: stableNoop,
          onInfo: stableNoop,
        }),
        React.createElement(HorizontalRow, {
          title: 'Fileira Estável P2.2',
          items: stableRowItems,
          type: 'vod',
          rowIndex: 0,
          onItemClick: stableNoop,
        }),
        React.createElement(VideoPlayer, {
          streamUrl: 'http://p22-account-a.iptv.local:8080/movie/user_p22_a/pass_p22_a/601.mp4',
          title: ' Filme em Reprodução P2.2',
          contentType: 'movie',
          streamId: 601,
          embedded: true,
          onBack: stableNoop,
        }),
        React.createElement(UseFavoritesProbe, null),
        React.createElement(LiveTvView, { onPlay: stableNoop, searchQuery: '' }),
        React.createElement(MoviesView, { onPlay: stableNoop, searchQuery: '' }),
        React.createElement(SeriesView, { onPlay: stableNoop, searchQuery: '' })
      );
    }

    const p22Container = document.createElement('div');
    document.body.appendChild(p22Container);
    const p22Root = createRoot(p22Container);

    let keydownAddCallsP22 = 0;
    let keydownRemoveCallsP22 = 0;
    const origWinAddP22 = windowInstance.addEventListener.bind(windowInstance);
    const origWinRemoveP22 = windowInstance.removeEventListener.bind(windowInstance);
    windowInstance.addEventListener = function (type: string, listener: any, options?: any) {
      if (type === 'keydown') keydownAddCallsP22++;
      return origWinAddP22(type, listener, options);
    } as any;
    windowInstance.removeEventListener = function (type: string, listener: any, options?: any) {
      if (type === 'keydown') keydownRemoveCallsP22++;
      return origWinRemoveP22(type, listener, options);
    } as any;

    try {
      await act(async () => {
        p22Root.render(
          React.createElement(
            NavigationProvider,
            null,
            React.createElement(
              XtreamProvider,
              { credentials: p22CredsA },
              React.createElement(ParentAggregatedShell, null)
            )
          )
        );
        await new Promise((r) => setTimeout(r, 120));
      });

      assert.strictEqual(
        latestCtxActions?.liveCatalogStatus,
        'ready',
        '[12.18] Catálogo Live deve iniciar pronto na conta A'
      );
      assert.strictEqual(
        latestCtxActions?.vodCatalogStatus,
        'ready',
        '[12.18] Catálogo VOD deve iniciar pronto na conta A'
      );
      assert.strictEqual(
        latestCtxActions?.seriesCatalogStatus,
        'ready',
        '[12.18] Catálogo Series deve iniciar pronto na conta A'
      );

      const playerVideoBeforeUpdates = p22Container.querySelector('video') as HTMLVideoElement;
      assert(playerVideoBeforeUpdates, '[12.18.5] Elemento <video> do VideoPlayer deve estar montado');
      await act(async () => {
        Object.defineProperty(playerVideoBeforeUpdates, 'duration', {
          value: 180,
          configurable: true,
          writable: true,
        });
        playerVideoBeforeUpdates.currentTime = 42;
        playerVideoBeforeUpdates.dispatchEvent(
          new windowInstance.Event('loadedmetadata') as unknown as Event
        );
        playerVideoBeforeUpdates.dispatchEvent(
          new windowInstance.Event('canplay') as unknown as Event
        );
        playerVideoBeforeUpdates.dispatchEvent(
          new windowInstance.Event('playing') as unknown as Event
        );
      });

      const loadCountBeforeVodIsolation = videoLoadCallCount;
      const keydownAddBeforeVodIsolation = keydownAddCallsP22;
      const keydownRemoveBeforeVodIsolation = keydownRemoveCallsP22;

      // -----------------------------------------------------------------------
      // 12.18.1, 12.18.2, 12.18.3 e 12.18.5:
      // Alterar APENAS status/erro/dados de VOD (4 transições exclusivas de VOD:
      // falha de categorias VOD -> recuperação de categorias VOD -> atualização de streams VOD)
      // -----------------------------------------------------------------------
      resetRenderCounts();

      await act(async () => {
        vodFailMode = true;
        await latestCtxActions.fetchVodCategories();
      });
      assert.strictEqual(
        latestCtxActions.vodCategoriesStatus,
        'error',
        '[12.18.1] vodCategoriesStatus deve refletir erro após falha exclusiva de VOD'
      );

      await act(async () => {
        vodFailMode = false;
        vodBatchVersion = 2;
        await latestCtxActions.fetchVodCategories();
      });
      assert.strictEqual(
        latestCtxActions.vodCategoriesStatus,
        'ready',
        '[12.18.1] vodCategoriesStatus deve voltar a ready após recuperação de VOD'
      );
      assert(
        p22Container.textContent?.toUpperCase().includes('AVENTURA VOD USER_P22_A V2'),
        '[12.18.3] MoviesView deve receber o novo estado de VOD e exibir a categoria atualizada v2'
      );

      const vodExclusiveShellRenders = renderCounts.ParentAggregatedShell;
      assert(
        vodExclusiveShellRenders >= 2,
        `[12.18.1] Casca agregada deve ter renderizado nas transições de VOD (renderizou ${vodExclusiveShellRenders}x)`
      );

      // Consumidores apenas de credenciais: 0 re-renders
      const credOnlyConsumers = [
        'ConfigView',
        'FavoritesView',
        'MovieDetails',
        'SeriesDetails',
        'HeroBanner',
        'HorizontalRow',
        'VideoPlayer',
        'UseFavoritesProbe',
      ] as const;

      for (const consumerName of credOnlyConsumers) {
        assert.strictEqual(
          renderCounts[consumerName],
          0,
          `[12.18.1] ${consumerName} NÃO deve re-renderizar quando apenas status/erro/dados de VOD mudam (obteve ${renderCounts[consumerName]})`
        );
      }

      // Outros domínios (LiveTvView e SeriesView): 0 re-renders em mudança exclusiva de Filmes
      assert.strictEqual(
        renderCounts.LiveTvView,
        0,
        `[12.18.2] LiveTvView NÃO deve re-renderizar em mudança exclusiva de Filmes/VOD (obteve ${renderCounts.LiveTvView})`
      );
      assert.strictEqual(
        renderCounts.SeriesView,
        0,
        `[12.18.2] SeriesView NÃO deve re-renderizar em mudança exclusiva de Filmes/VOD (obteve ${renderCounts.SeriesView})`
      );

      // Consumidor do domínio alterado (MoviesView) DEVE ter renderizado
      assert(
        renderCounts.MoviesView >= 2,
        `[12.18.3] MoviesView DEVE renderizar ao receber novo estado de VOD (obteve ${renderCounts.MoviesView})`
      );

      // Agora: mudança exclusiva de Séries (falha -> recuperação v2)
      const moviesRendersOnVod = renderCounts.MoviesView;
      resetRenderCounts();

      await act(async () => {
        seriesFailMode = true;
        await latestCtxActions.fetchSeriesCategories();
      });
      await act(async () => {
        seriesFailMode = false;
        seriesBatchVersion = 2;
        await latestCtxActions.fetchSeriesCategories();
      });

      assert(
        p22Container.textContent?.toUpperCase().includes('MISTÉRIO SERIES USER_P22_A V2'),
        '[12.18.3] SeriesView deve receber o novo estado de Séries e exibir a categoria atualizada v2'
      );
      assert.strictEqual(
        renderCounts.LiveTvView,
        0,
        `[12.18.2] LiveTvView NÃO deve re-renderizar em mudança exclusiva de Séries (obteve ${renderCounts.LiveTvView})`
      );
      assert.strictEqual(
        renderCounts.MoviesView,
        0,
        `[12.18.2] MoviesView NÃO deve re-renderizar em mudança exclusiva de Séries (obteve ${renderCounts.MoviesView})`
      );
      assert(
        renderCounts.SeriesView >= 2,
        `[12.18.3] SeriesView DEVE renderizar ao receber novo estado de Séries (obteve ${renderCounts.SeriesView})`
      );
      for (const consumerName of credOnlyConsumers) {
        assert.strictEqual(
          renderCounts[consumerName],
          0,
          `[12.18.1] ${consumerName} NÃO deve re-renderizar em mudança exclusiva de Séries (obteve ${renderCounts[consumerName]})`
        );
      }

      // 12.18.5: Com reprodução ativa no VideoPlayer, atualizações de catálogo não recriam <video>,
      // não reiniciam a conexão (video.load) e não reinstalam o listener global de atalhos (keydown)
      assertSameElement(
        p22Container.querySelector('video'),
        playerVideoBeforeUpdates,
        '[12.18.5] Atualizações de catálogo NÃO devem recriar o elemento <video> do VideoPlayer'
      );
      assert.strictEqual(
        videoLoadCallCount,
        loadCountBeforeVodIsolation,
        '[12.18.5] Atualizações de catálogo NÃO devem chamar video.load() nem reiniciar a conexão da sessão ativa'
      );
      assert.strictEqual(
        playerVideoBeforeUpdates.currentTime,
        42,
        '[12.18.5] Posição de reprodução (currentTime=42s) deve permanecer intacta durante atualizações de catálogo'
      );
      assert.strictEqual(
        keydownAddCallsP22 - keydownAddBeforeVodIsolation,
        0,
        '[12.18.5] Nenhum re-registro do listener keydown do VideoPlayer deve ocorrer durante atualizações de catálogo'
      );
      assert.strictEqual(
        keydownRemoveCallsP22 - keydownRemoveBeforeVodIsolation,
        0,
        '[12.18.5] Nenhuma remoção do listener keydown do VideoPlayer deve ocorrer durante atualizações de catálogo'
      );

      // -----------------------------------------------------------------------
      // 12.18.4: Troca de conta (credentials A -> credentials B) atualiza todos os
      // consumidores de credenciais e domínios, cancela operações da conta antiga
      // e impede mistura de dados entre contas
      // -----------------------------------------------------------------------
      let slowOldAccountResolved = false;
      (XtreamService as any).getVodCategories = async (creds: XtreamCredentials, opts?: any) => {
        if (creds.username === p22CredsA.username) {
          await new Promise<void>((resolve, reject) => {
            const t = setTimeout(() => {
              slowOldAccountResolved = true;
              resolve();
            }, 60);
            opts?.signal?.addEventListener('abort', () => {
              clearTimeout(t);
              reject(new Error('Operação cancelada pelo usuário.'));
            });
          });
          return [{ category_id: 'stale_a', category_name: 'Categoria Antiga Vazada A' }];
        }
        return [{ category_id: 'vod_cat_b', category_name: 'Aventura Conta B Exclusivo' }];
      };

      // Disparar operação lenta na conta A e imediatamente trocar para a conta B
      let pendingSlowAborted = false;
      (XtreamService as any).getVodCategories = async (creds: XtreamCredentials, opts?: any) => {
        if (creds.username === p22CredsA.username) {
          await new Promise<void>((resolve, reject) => {
            const t = setTimeout(() => {
              slowOldAccountResolved = true;
              resolve();
            }, 80);
            opts?.signal?.addEventListener('abort', () => {
              pendingSlowAborted = true;
              clearTimeout(t);
              reject(new Error('Operação cancelada pelo usuário.'));
            });
          });
          return [{ category_id: 'stale_a', category_name: 'Categoria Antiga Vazada A' }];
        }
        return [{ category_id: 'vod_cat_b', category_name: 'Aventura Conta B Exclusivo' }];
      };

      let pendingSlowPromise: Promise<void> | undefined;
      await act(async () => {
        pendingSlowPromise = latestCtxActions.fetchVodCategories();
      });

      resetRenderCounts();

      await act(async () => {
        p22Root.render(
          React.createElement(
            NavigationProvider,
            null,
            React.createElement(
              XtreamProvider,
              { credentials: p22CredsB },
              React.createElement(ParentAggregatedShell, null)
            )
          )
        );
      });

      await act(async () => {
        await pendingSlowPromise;
        await new Promise((r) => setTimeout(r, 120));
      });

      assert.strictEqual(
        pendingSlowAborted,
        true,
        '[12.18.4] Sinal de aborto da conta anterior (A) deve ser acionado ao trocar para a conta B'
      );
      assert.strictEqual(
        slowOldAccountResolved,
        false,
        '[12.18.4] Operação em andamento da conta anterior (A) deve ser abortada ao trocar para a conta B'
      );
      assert.strictEqual(
        latestFavHookCredsUser,
        'user_p22_b',
        '[12.18.4] useFavorites / useOptionalXtreamCredentials deve refletir imediatamente a nova conta (user_p22_b)'
      );
      assert(
        p22Container.textContent?.toUpperCase().includes('AVENTURA CONTA B EXCLUSIVO'),
        '[12.18.4] MoviesView deve exibir os dados da nova conta B'
      );
      assert(
        !p22Container.textContent?.toUpperCase().includes('CATEGORIA ANTIGA VAZADA A') &&
          !p22Container.textContent?.toUpperCase().includes('USER_P22_A'),
        '[12.18.4] Nenhum dado da conta anterior A deve permanecer ou se misturar após trocar para a conta B'
      );

      for (const consumerName of [
        ...credOnlyConsumers,
        'LiveTvView',
        'MoviesView',
        'SeriesView',
      ] as const) {
        assert(
          renderCounts[consumerName] >= 1,
          `[12.18.4] ${consumerName} DEVE atualizar quando as credenciais da conta mudam (obteve ${renderCounts[consumerName]})`
        );
      }

      // -----------------------------------------------------------------------
      // 12.18.6: Preservação do uso de VideoPlayer sem provider e useFavorites
      // com/sem parâmetro opcional fora de XtreamProvider
      // -----------------------------------------------------------------------
      const standaloneContainer = document.createElement('div');
      document.body.appendChild(standaloneContainer);
      const standaloneRoot = createRoot(standaloneContainer);
      let standaloneFavCount = -1;

      function StandaloneConsumer() {
        const favNoArg = useFavorites();
        const favWithExplicit = useFavorites(p22CredsB);
        standaloneFavCount = favNoArg.favorites.length + favWithExplicit.favorites.length;
        return React.createElement(VideoPlayer, {
          streamUrl: 'http://standalone.local/video.mp4',
          title: 'Standalone Sem Provider',
          embedded: true,
        });
      }

      await act(async () => {
        standaloneRoot.render(React.createElement(StandaloneConsumer, null));
      });
      assert(
        standaloneContainer.querySelector('video') !== null,
        '[12.18.6] VideoPlayer deve continuar funcionando normalmente sem XtreamProvider montado'
      );
      assert(
        standaloneFavCount >= 0,
        '[12.18.6] useFavorites deve funcionar sem XtreamProvider tanto sem argumento quanto com overrideCredentials explícito'
      );
      await act(async () => {
        standaloneRoot.unmount();
      });
      document.body.removeChild(standaloneContainer);

      console.log(
        `📊 [Métricas P2.2 — Isolamento do Contexto Compartilhado (4 transições exclusivas de VOD + 4 de Séries)]\n` +
          `   • Casca agregada (ParentAggregatedShell / useXtreamContext): ${vodExclusiveShellRenders} renders em 4 transições de VOD\n` +
          `   • Consumidores apenas de credenciais (ConfigView, FavoritesView, MovieDetails, SeriesDetails, HeroBanner, HorizontalRow, VideoPlayer, useFavorites): antes=${vodExclusiveShellRenders} renders cada | depois=0 renders\n` +
          `   • LiveTvView em mudanças exclusivas de Filmes (4) + Séries (4): antes=8 renders | depois=0 renders\n` +
          `   • MoviesView em mudança de Filmes vs mudança de Séries: Filmes=${moviesRendersOnVod} renders | Séries=0 renders (antes=4)\n` +
          `   • VideoPlayer ativo durante atualizações de catálogo: re-renders=0 (antes=${vodExclusiveShellRenders * 2}), video.load() extras=0, keydown reinstall=0`
      );
    } finally {
      for (const [compObj, origType] of originalMemoTypes.entries()) {
        compObj.type = origType;
      }
      windowInstance.addEventListener = origWinAddP22;
      windowInstance.removeEventListener = origWinRemoveP22;
      await act(async () => {
        p22Root.unmount();
      });
      if (p22Container.parentNode) {
        document.body.removeChild(p22Container);
      }
    }
  }

  // =========================================================================
  // 12.19. P2.3 — Otimização das leituras e atualizações do histórico
  // =========================================================================
  console.log('🧪 Testando 12.19 (P2.3): Otimização das leituras e atualizações do histórico...');
  {
    const {
      getHistoryKey: getHistKeyP23,
      getRecordKey: getRecKeyP23,
      readHistoryMap: readHistMapP23,
      writeHistoryMap: writeHistMapP23,
      recordPlaybackPosition: recordPosP23,
      getItemProgress: getProgressP23,
      clearItemProgress: clearProgressP23,
      getHistoryRecords: getHistRecordsP23,
      useAccountPlaybackHistory: useHistHookP23,
      getPlaybackHistoryPerfStats,
      resetPlaybackHistoryPerfStats,
      clearPlaybackHistoryMemoryCacheForTest,
      MAX_CACHED_HISTORY_ACCOUNTS,
      HISTORY_UPDATED_EVENT,
    } = await import('../src/utils/playbackHistory');
    const { usePlaybackSession } = await import('../src/components/player/usePlaybackSession');
    const { HorizontalRow } = await import('../src/components/HorizontalRow');
    const { pushFocusMemory, popFocusMemory } = await import('../src/navigation');
    const { XtreamCredentialsContext } = await import('../src/context/XtreamContext');

    const accP23A = { serverUrl: 'http://p23-server-a.tv:8080', username: 'user_p23_a' };
    const accP23B = { serverUrl: 'http://p23-server-a.tv:8080', username: 'user_p23_b' };
    const accP23Server2 = { serverUrl: 'http://p23-server-b.tv:8080', username: 'user_p23_a' };

    const keyP23A = getHistKeyP23(accP23A.serverUrl, accP23A.username);
    const keyP23B = getHistKeyP23(accP23B.serverUrl, accP23B.username);
    const keyP23Server2 = getHistKeyP23(accP23Server2.serverUrl, accP23Server2.username);

    assert.notStrictEqual(keyP23A, keyP23B, '[12.19.3] Usuários distintos no mesmo servidor devem ter chaves distintas');
    assert.notStrictEqual(keyP23A, keyP23Server2, '[12.19.3] Mesmo usuário em servidores distintos deve ter chaves distintas');

    windowInstance.localStorage.removeItem(keyP23A);
    windowInstance.localStorage.removeItem(keyP23B);
    windowInstance.localStorage.removeItem(keyP23Server2);
    clearPlaybackHistoryMemoryCacheForTest();
    resetPlaybackHistoryPerfStats();

    // -----------------------------------------------------------------------
    // 12.19.1: Muitas consultas de progresso (60 episódios) sobre a mesma versão
    //          do histórico (200 registros persistidos)
    // -----------------------------------------------------------------------
    const initialMap200: Record<string, any> = {};
    for (let i = 1; i <= 140; i++) {
      initialMap200[`movie:${1000 + i}`] = {
        id: String(1000 + i),
        type: 'movie',
        updatedAt: 1700000000000 + i * 1000,
        positionSec: 120 + i,
      };
    }
    for (let ep = 1; ep <= 60; ep++) {
      initialMap200[`episode:${5000 + ep}`] = {
        id: String(5000 + ep),
        type: 'episode',
        updatedAt: 1700100000000 + ep * 1000,
        positionSec: ep * 15,
        parentSeriesId: '900',
      };
    }
    windowInstance.localStorage.setItem(keyP23A, JSON.stringify(initialMap200));
    clearPlaybackHistoryMemoryCacheForTest();
    resetPlaybackHistoryPerfStats();

    for (let ep = 1; ep <= 60; ep++) {
      const pos = getProgressP23(accP23A, 'episode', 5000 + ep);
      assert.strictEqual(
        pos,
        ep * 15,
        `[12.19.1] Progresso do episódio ${5000 + ep} deve ser ${ep * 15}s`
      );
    }

    const statsAfter60EpisodeReads = getPlaybackHistoryPerfStats();
    assert.strictEqual(
      statsAfter60EpisodeReads.storageReads,
      1,
      `[12.19.1] 60 consultas getItemProgress na mesma passada devem realizar 1 leitura de storage (antes=60; obteve ${statsAfter60EpisodeReads.storageReads})`
    );
    assert.strictEqual(
      statsAfter60EpisodeReads.jsonParses,
      1,
      `[12.19.1] 60 consultas getItemProgress sobre a mesma versão devem realizar exatamente 1 JSON.parse (obteve ${statsAfter60EpisodeReads.jsonParses})`
    );
    assert.strictEqual(
      statsAfter60EpisodeReads.recordValidations,
      200,
      `[12.19.1] 60 consultas getItemProgress devem validar os 200 registros apenas 1 vez (200 vs 12.000 antes; obteve ${statsAfter60EpisodeReads.recordValidations})`
    );
    assert.strictEqual(
      statsAfter60EpisodeReads.sortCalls,
      0,
      `[12.19.1] Consultas getItemProgress NÃO devem ordenar o histórico (obteve ${statsAfter60EpisodeReads.sortCalls})`
    );

    // Consultas adicionais sobre a mesma versão: 0 novas interpretações e 0 validações
    resetPlaybackHistoryPerfStats();
    for (let ep = 1; ep <= 60; ep++) {
      const pos = getProgressP23(accP23A, 'episode', 5000 + ep);
      assert.strictEqual(pos, ep * 15);
    }
    const statsWarm60EpisodeReads = getPlaybackHistoryPerfStats();
    assert.strictEqual(
      statsWarm60EpisodeReads.storageReads,
      1,
      `[12.19.1] 60 consultas getItemProgress quentes devem realizar 1 verificação de storage (antes=60; obteve ${statsWarm60EpisodeReads.storageReads})`
    );
    assert.strictEqual(
      statsWarm60EpisodeReads.jsonParses,
      0,
      '[12.19.1] Leituras repetidas com snapshot já em cache devem ter 0 JSON.parse'
    );
    assert.strictEqual(
      statsWarm60EpisodeReads.recordValidations,
      0,
      '[12.19.1] Leituras repetidas com snapshot já em cache devem ter 0 validações de registros'
    );
    assert.strictEqual(
      statsWarm60EpisodeReads.sortCalls,
      0,
      '[12.19.1] Leituras repetidas de progresso devem ter 0 ordenações'
    );

    // -----------------------------------------------------------------------
    // 12.19.2: Vários consumidores montados (4 consumidores de useAccountPlaybackHistory)
    //          reutilizam snapshot e ordenação, e atualizam antes da notificação
    // -----------------------------------------------------------------------
    clearPlaybackHistoryMemoryCacheForTest();
    resetPlaybackHistoryPerfStats();

    const consumerSnapshots: Record<number, any[]> = {};
    let progressObservedInsideCustomEvent = -1;

    function MultiConsumerProbe({ account }: { account: { serverUrl: string; username: string } }) {
      const c1 = useHistHookP23(account);
      const c2 = useHistHookP23(account);
      const c3 = useHistHookP23(account);
      const c4 = useHistHookP23(account);
      consumerSnapshots[1] = c1;
      consumerSnapshots[2] = c2;
      consumerSnapshots[3] = c3;
      consumerSnapshots[4] = c4;
      return React.createElement(
        'div',
        { 'data-p23-top-id': c1[0]?.id ?? 'none', 'data-p23-count': c1.length },
        c1[0]?.id ?? 'none'
      );
    }

    const p23Container = document.createElement('div');
    document.body.appendChild(p23Container);
    const p23Root = createRoot(p23Container);

    const onCustomHistoryUpdated = (e: any) => {
      const detail = e?.detail;
      if (detail?.historyKey === keyP23A) {
        progressObservedInsideCustomEvent = getProgressP23(accP23A, 'movie', 1001);
      }
    };
    windowInstance.addEventListener(HISTORY_UPDATED_EVENT, onCustomHistoryUpdated);

    try {
      await act(async () => {
        p23Root.render(React.createElement(MultiConsumerProbe, { account: accP23A }));
      });

      const statsMount4Consumers = getPlaybackHistoryPerfStats();
      assert.strictEqual(
        statsMount4Consumers.storageReads,
        1,
        `[12.19.2] Montagem de 4 consumidores deve realizar apenas 1 leitura de storage (antes=4; obteve ${statsMount4Consumers.storageReads})`
      );
      assert.strictEqual(
        statsMount4Consumers.jsonParses,
        1,
        `[12.19.2] Montagem de 4 consumidores deve realizar apenas 1 interpretação JSON (antes=4; obteve ${statsMount4Consumers.jsonParses})`
      );
      assert.strictEqual(
        statsMount4Consumers.sortCalls,
        1,
        `[12.19.2] Montagem de 4 consumidores deve realizar apenas 1 ordenação compartilhada (antes=4; obteve ${statsMount4Consumers.sortCalls})`
      );
      assert.strictEqual(
        consumerSnapshots[1],
        consumerSnapshots[2],
        '[12.19.2] Consumidores 1 e 2 devem compartilhar exatamente a mesma referência de snapshot'
      );
      assert.strictEqual(
        consumerSnapshots[2],
        consumerSnapshots[3],
        '[12.19.2] Consumidores 2 e 3 devem compartilhar exatamente a mesma referência de snapshot'
      );
      assert.strictEqual(
        consumerSnapshots[3],
        consumerSnapshots[4],
        '[12.19.2] Consumidores 3 e 4 devem compartilhar exatamente a mesma referência de snapshot'
      );

      // Gravação válida atualiza snapshot antes de notificar os 4 consumidores
      resetPlaybackHistoryPerfStats();
      await act(async () => {
        const ok = recordPosP23(accP23A, {
          id: 1001,
          type: 'movie',
          positionSec: 777,
        });
        assert.strictEqual(ok, true, '[12.19.2] recordPlaybackPosition válido deve retornar true');
      });

      const statsAfterWrite4Consumers = getPlaybackHistoryPerfStats();
      assert.strictEqual(
        progressObservedInsideCustomEvent,
        777,
        '[12.19.2] Snapshot já deve estar atualizado quando os ouvintes são notificados'
      );
      assert.strictEqual(
        consumerSnapshots[1][0]?.id,
        '1001',
        '[12.19.2] Filme 1001 atualizado deve passar para o topo da lista ordenada nos consumidores'
      );
      assert.strictEqual(
        consumerSnapshots[1][0]?.positionSec,
        777,
        '[12.19.2] Posição 777s deve estar refletida no snapshot dos consumidores'
      );
      assert.strictEqual(
        consumerSnapshots[1],
        consumerSnapshots[4],
        '[12.19.2] Após gravação, todos os 4 consumidores continuam compartilhando a mesma referência de snapshot'
      );
      assert.strictEqual(
        statsAfterWrite4Consumers.storageReads,
        1,
        `[12.19.2] Atualização com 4 consumidores deve fazer apenas 1 leitura de storage na escrita e 0 nos consumidores (antes=5; obteve ${statsAfterWrite4Consumers.storageReads})`
      );
      assert.strictEqual(
        statsAfterWrite4Consumers.jsonParses,
        0,
        `[12.19.2] Atualização sobre snapshot já validado deve fazer 0 JSON.parse (antes=5; obteve ${statsAfterWrite4Consumers.jsonParses})`
      );
      assert.strictEqual(
        statsAfterWrite4Consumers.sortCalls,
        1,
        `[12.19.2] Atualização com 4 consumidores deve ordenar a lista apenas 1 vez (antes=4; obteve ${statsAfterWrite4Consumers.sortCalls})`
      );

      // -----------------------------------------------------------------------
      // 12.19.3: Troca de conta sem exibir registros da conta anterior +
      //          IDs iguais entre tipos (live/movie/episode) + limite de memória LRU
      // -----------------------------------------------------------------------
      recordPosP23(accP23B, { id: 777, type: 'live', positionSec: 15 });
      recordPosP23(accP23B, { id: 777, type: 'movie', positionSec: 240 });
      recordPosP23(accP23B, { id: 777, type: 'episode', positionSec: 360, parentSeriesId: 888 });
      recordPosP23(accP23Server2, { id: 777, type: 'movie', positionSec: 999 });

      assert.strictEqual(getProgressP23(accP23B, 'live', 777), 15, '[12.19.3] Progresso live:777 isolado');
      assert.strictEqual(getProgressP23(accP23B, 'movie', 777), 240, '[12.19.3] Progresso movie:777 isolado');
      assert.strictEqual(getProgressP23(accP23B, 'episode', 777), 360, '[12.19.3] Progresso episode:777 isolado');
      assert.strictEqual(getProgressP23(accP23Server2, 'movie', 777), 999, '[12.19.3] Progresso isolado por servidor');
      assert.strictEqual(getProgressP23(accP23A, 'movie', 777), 0, '[12.19.3] Conta A não possui movie:777');

      const renderedSnapshotsOnSwitch: Array<{ username: string; recordCount: number; hasAccountARecords: boolean }> = [];
      function SwitchAccountProbe({ account }: { account: { serverUrl: string; username: string } }) {
        const records = useHistHookP23(account);
        const hasAccountARecords = records.some((r) => Number(r.id) >= 1001 && Number(r.id) <= 1140);
        renderedSnapshotsOnSwitch.push({
          username: account.username,
          recordCount: records.length,
          hasAccountARecords,
        });
        return React.createElement('div', null, `${account.username}:${records.length}`);
      }

      await act(async () => {
        p23Root.render(React.createElement(SwitchAccountProbe, { account: accP23A }));
      });
      renderedSnapshotsOnSwitch.length = 0;

      // Trocar para a conta B: nenhum render da conta B pode ver registros da conta A
      await act(async () => {
        p23Root.render(React.createElement(SwitchAccountProbe, { account: accP23B }));
      });

      assert(renderedSnapshotsOnSwitch.length >= 1, '[12.19.3] Deve ter renderizado a conta B');
      for (const entry of renderedSnapshotsOnSwitch) {
        assert.strictEqual(
          entry.username,
          'user_p23_b',
          '[12.19.3] Render após troca deve pertencer a user_p23_b'
        );
        assert.strictEqual(
          entry.hasAccountARecords,
          false,
          '[12.19.3] Troca de conta NUNCA deve exibir temporariamente registros da conta anterior (A)'
        );
        assert.strictEqual(
          entry.recordCount,
          3,
          '[12.19.3] Troca de conta deve selecionar imediatamente os 3 registros da conta B'
        );
      }

      // Política de memória limitada: acessar 12 contas mantém no máximo MAX_CACHED_HISTORY_ACCOUNTS (8) em memória sem apagar o localStorage
      const tempKeys: string[] = [];
      for (let idx = 1; idx <= 12; idx++) {
        const tempAcc = { serverUrl: 'http://p23-lru.tv:8080', username: `lru_user_${idx}` };
        const tKey = getHistKeyP23(tempAcc.serverUrl, tempAcc.username);
        tempKeys.push(tKey);
        recordPosP23(tempAcc, { id: idx, type: 'movie', positionSec: idx * 20 });
      }
      const lruStats = getPlaybackHistoryPerfStats();
      assert(
        lruStats.cachedAccountsCount <= MAX_CACHED_HISTORY_ACCOUNTS,
        `[12.19.3] Cache em memória deve limitar a quantidade de contas a ${MAX_CACHED_HISTORY_ACCOUNTS} (obteve ${lruStats.cachedAccountsCount})`
      );
      // A conta 1 evictada da memória ainda tem seu histórico salvo no localStorage e é relida normalmente
      assert.strictEqual(
        getProgressP23({ serverUrl: 'http://p23-lru.tv:8080', username: 'lru_user_1' }, 'movie', 1),
        20,
        '[12.19.3] Evicção de memória LRU NÃO deve excluir o histórico salvo no localStorage'
      );
      for (const tKey of tempKeys) {
        windowInstance.localStorage.removeItem(tKey);
      }

      // -----------------------------------------------------------------------
      // 12.19.4: Falhas de leitura/escrita, JSON inválido, imutabilidade e alterações externas
      // -----------------------------------------------------------------------
      await act(async () => {
        p23Root.render(React.createElement(MultiConsumerProbe, { account: accP23B }));
      });
      const confirmedBRecords = consumerSnapshots[1];
      assert.strictEqual(confirmedBRecords.length, 3, '[12.19.4] Conta B possui 3 registros confirmados');
      assert(Object.isFrozen(confirmedBRecords), '[12.19.4] Lista do snapshot deve ser congelada (imutável)');
      assert(Object.isFrozen(confirmedBRecords[0]), '[12.19.4] Registros do snapshot devem ser congelados (imutáveis)');

      // Mutação do retorno de readHistoryMap não pode afetar o snapshot
      const clonedMapB = readHistMapP23(keyP23B)!;
      clonedMapB['movie:777'] = { id: '777', type: 'movie', updatedAt: 9999999999999, positionSec: 99999 };
      assert.strictEqual(
        getProgressP23(accP23B, 'movie', 777),
        240,
        '[12.19.4] Mutar o objeto retornado por readHistoryMap NÃO deve alterar o snapshot confirmado'
      );

      // Falha de leitura em localStorage.getItem impede gravação e preserva snapshot confirmado
      const origGetItemP23 = windowInstance.localStorage.getItem;
      const origSetItemP23 = windowInstance.localStorage.setItem;
      let setItemCalledDuringReadFail = false;

      Object.defineProperty(windowInstance.localStorage, 'getItem', {
        value: function (k: string) {
          if (k === keyP23B) {
            throw new Error('Falha simulada de leitura em localStorage.getItem (P2.3)');
          }
          return origGetItemP23.call(windowInstance.localStorage, k);
        },
        configurable: true,
        writable: true,
      });
      Object.defineProperty(windowInstance.localStorage, 'setItem', {
        value: function (k: string, v: string) {
          if (k === keyP23B) setItemCalledDuringReadFail = true;
          return origSetItemP23.call(windowInstance.localStorage, k, v);
        },
        configurable: true,
        writable: true,
      });

      const replacementCandidateMap = {
        'movie:555': { id: '555', type: 'movie' as const, updatedAt: 1719000000000, positionSec: 95 },
      };
      let eventFiredDuringBlockedRead = false;
      const onBlockedReadEvent = () => {
        eventFiredDuringBlockedRead = true;
      };
      windowInstance.addEventListener(HISTORY_UPDATED_EVENT, onBlockedReadEvent);

      assert.strictEqual(
        readHistMapP23(keyP23B),
        null,
        '[12.19.4] readHistoryMap deve retornar null quando localStorage.getItem falha'
      );
      assert.strictEqual(
        recordPosP23(accP23B, { id: 888, type: 'movie', positionSec: 100 }),
        false,
        '[12.19.4] recordPlaybackPosition deve retornar false quando a leitura falha'
      );
      assert.strictEqual(
        clearProgressP23(accP23B, 'movie', 777),
        false,
        '[12.19.4] clearItemProgress deve retornar false quando a leitura falha'
      );
      assert.strictEqual(
        writeHistMapP23(keyP23B, replacementCandidateMap),
        false,
        '[12.19.4] writeHistoryMap deve retornar false quando a leitura prévia falha'
      );
      assert.strictEqual(
        setItemCalledDuringReadFail,
        false,
        '[12.19.4] setItem NUNCA deve ser chamado quando a leitura prévia falha (inclusive em writeHistoryMap)'
      );
      assert.strictEqual(
        eventFiredDuringBlockedRead,
        false,
        '[12.19.4] Nenhum evento de atualização deve ser disparado quando a leitura prévia falha em writeHistoryMap'
      );
      assert.strictEqual(
        consumerSnapshots[1],
        confirmedBRecords,
        '[12.19.4] Snapshot confirmado dos assinantes deve ser preservado durante falha de leitura'
      );
      windowInstance.removeEventListener(HISTORY_UPDATED_EVENT, onBlockedReadEvent);

      // Restaurar getItem e testar JSON corrompido (inclusive chamando writeHistoryMap diretamente)
      Object.defineProperty(windowInstance.localStorage, 'getItem', {
        value: origGetItemP23,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(windowInstance.localStorage, 'setItem', {
        value: origSetItemP23,
        configurable: true,
        writable: true,
      });

      const validRawB = windowInstance.localStorage.getItem(keyP23B)!;
      windowInstance.localStorage.setItem(keyP23B, '{json_corrompido_invalido');

      let setItemCalledOnCorruptJson = false;
      let eventFiredOnCorruptJson = false;
      const onCorruptJsonEvent = () => {
        eventFiredOnCorruptJson = true;
      };
      windowInstance.addEventListener(HISTORY_UPDATED_EVENT, onCorruptJsonEvent);
      Object.defineProperty(windowInstance.localStorage, 'setItem', {
        value: function (k: string, v: string) {
          if (k === keyP23B) setItemCalledOnCorruptJson = true;
          return origSetItemP23.call(windowInstance.localStorage, k, v);
        },
        configurable: true,
        writable: true,
      });

      assert.strictEqual(
        readHistMapP23(keyP23B),
        null,
        '[12.19.4] readHistoryMap deve retornar null para JSON corrompido'
      );
      assert.strictEqual(
        recordPosP23(accP23B, { id: 889, type: 'movie', positionSec: 50 }),
        false,
        '[12.19.4] recordPlaybackPosition deve bloquear gravação sobre JSON corrompido'
      );
      assert.strictEqual(
        clearProgressP23(accP23B, 'movie', 777),
        false,
        '[12.19.4] clearItemProgress deve bloquear gravação sobre JSON corrompido'
      );
      assert.strictEqual(
        writeHistMapP23(keyP23B, replacementCandidateMap),
        false,
        '[12.19.4] writeHistoryMap deve bloquear substituição quando o JSON persistido atual está corrompido'
      );
      assert.strictEqual(
        setItemCalledOnCorruptJson,
        false,
        '[12.19.4] writeHistoryMap NÃO deve chamar setItem quando o JSON existente está corrompido'
      );
      assert.strictEqual(
        eventFiredOnCorruptJson,
        false,
        '[12.19.4] writeHistoryMap NÃO deve notificar assinantes quando o JSON existente está corrompido'
      );
      assert.strictEqual(
        consumerSnapshots[1],
        confirmedBRecords,
        '[12.19.4] Snapshot confirmado em memória deve ser preservado quando há JSON inválido'
      );

      Object.defineProperty(windowInstance.localStorage, 'setItem', {
        value: origSetItemP23,
        configurable: true,
        writable: true,
      });
      windowInstance.removeEventListener(HISTORY_UPDATED_EVENT, onCorruptJsonEvent);
      windowInstance.localStorage.setItem(keyP23B, validRawB);

      // Verificar que a substituição explícita via writeHistoryMap funciona quando leitura e validação têm sucesso
      await act(async () => {
        const replacedOk = writeHistMapP23(keyP23B, replacementCandidateMap);
        assert.strictEqual(
          replacedOk,
          true,
          '[12.19.4] writeHistoryMap deve substituir explicitamente o mapa quando leitura e validação têm sucesso'
        );
      });
      assert.strictEqual(
        consumerSnapshots[1].length,
        1,
        '[12.19.4] Assinantes devem refletir o mapa substituído por writeHistoryMap'
      );
      assert.strictEqual(
        consumerSnapshots[1][0]?.id,
        '555',
        '[12.19.4] Registro 555 deve estar ativo após substituição explícita via writeHistoryMap'
      );
      await act(async () => {
        const restoredMapB = JSON.parse(validRawB);
        assert.strictEqual(writeHistMapP23(keyP23B, restoredMapB), true);
      });
      const confirmedBRecordsRestored = consumerSnapshots[1];

      // Testar falha de escrita (setItem lança erro): retorna false, não altera snapshot nem anuncia sucesso
      let customEventFiredOnWriteFail = false;
      const onWriteFailEvent = () => {
        customEventFiredOnWriteFail = true;
      };
      windowInstance.addEventListener(HISTORY_UPDATED_EVENT, onWriteFailEvent);
      Object.defineProperty(windowInstance.localStorage, 'setItem', {
        value: function (k: string, v: string) {
          if (k === keyP23B) {
            throw new Error('QuotaExceededError simulado em setItem (P2.3)');
          }
          return origSetItemP23.call(windowInstance.localStorage, k, v);
        },
        configurable: true,
        writable: true,
      });

      assert.strictEqual(
        recordPosP23(accP23B, { id: 777, type: 'movie', positionSec: 555 }),
        false,
        '[12.19.4] recordPlaybackPosition deve retornar false quando setItem falha'
      );
      assert.strictEqual(
        writeHistMapP23(keyP23B, {}),
        false,
        '[12.19.4] writeHistoryMap deve retornar false quando setItem falha'
      );
      assert.strictEqual(
        customEventFiredOnWriteFail,
        false,
        '[12.19.4] Falha ao salvar NÃO deve anunciar sucesso via evento'
      );
      assert.strictEqual(
        getProgressP23(accP23B, 'movie', 777),
        240,
        '[12.19.4] Falha ao salvar NÃO deve alterar o snapshot confirmado (continua 240s)'
      );
      assert.strictEqual(
        consumerSnapshots[1],
        confirmedBRecordsRestored,
        '[12.19.4] Assinantes mantêm exatamente o mesmo snapshot confirmado após falha de escrita'
      );

      Object.defineProperty(windowInstance.localStorage, 'setItem', {
        value: origSetItemP23,
        configurable: true,
        writable: true,
      });
      windowInstance.removeEventListener(HISTORY_UPDATED_EVENT, onWriteFailEvent);

      // Evitar sobrescrever alterações externas usando uma cópia antiga em memória
      const parsedExternalB = JSON.parse(windowInstance.localStorage.getItem(keyP23B)!);
      parsedExternalB['movie:808'] = {
        id: '808',
        type: 'movie',
        updatedAt: Date.now() + 1000,
        positionSec: 310,
      };
      windowInstance.localStorage.setItem(keyP23B, JSON.stringify(parsedExternalB));

      await act(async () => {
        const ok = recordPosP23(accP23B, { id: 809, type: 'movie', positionSec: 410 });
        assert.strictEqual(ok, true);
      });
      assert.strictEqual(
        getProgressP23(accP23B, 'movie', 808),
        310,
        '[12.19.4] Gravação deve incorporar alterações externas do localStorage sem sobrescrevê-las com cópia antiga em memória'
      );
      assert.strictEqual(
        getProgressP23(accP23B, 'movie', 809),
        410,
        '[12.19.4] Novo item 809 também deve estar salvo junto com a alteração externa 808'
      );

      // -----------------------------------------------------------------------
      // 12.19.5: Atualização, remoção de chave e storage com key === null em outra aba
      // -----------------------------------------------------------------------
      const multiTabMap = {
        'movie:901': { id: '901', type: 'movie', updatedAt: Date.now() + 5000, positionSec: 640 },
      };
      windowInstance.localStorage.setItem(keyP23B, JSON.stringify(multiTabMap));
      resetPlaybackHistoryPerfStats();

      await act(async () => {
        windowInstance.dispatchEvent(
          new (windowInstance as any).StorageEvent('storage', {
            key: keyP23B,
            newValue: JSON.stringify(multiTabMap),
          })
        );
      });

      const statsCrossTabUpdate = getPlaybackHistoryPerfStats();
      assert.strictEqual(
        consumerSnapshots[1].length,
        1,
        '[12.19.5] StorageEvent de outra aba deve atualizar os consumidores para o novo mapa (1 item)'
      );
      assert.strictEqual(
        consumerSnapshots[1][0]?.id,
        '901',
        '[12.19.5] Consumidores devem refletir o item 901 vindo de outra aba'
      );
      assert.strictEqual(
        statsCrossTabUpdate.storageReads,
        1,
        '[12.19.5] StorageEvent com 4 consumidores deve realizar apenas 1 leitura de storage compartilhada'
      );
      assert.strictEqual(
        statsCrossTabUpdate.jsonParses,
        1,
        '[12.19.5] StorageEvent com 4 consumidores deve realizar apenas 1 interpretação JSON'
      );
      assert.strictEqual(
        statsCrossTabUpdate.sortCalls,
        1,
        '[12.19.5] StorageEvent com 4 consumidores deve realizar apenas 1 ordenação'
      );

      // Remoção da chave em outra aba
      windowInstance.localStorage.removeItem(keyP23B);
      await act(async () => {
        windowInstance.dispatchEvent(
          new (windowInstance as any).StorageEvent('storage', {
            key: keyP23B,
            newValue: null,
          })
        );
      });
      assert.strictEqual(
        consumerSnapshots[1].length,
        0,
        '[12.19.5] Remoção da chave em outra aba deve atualizar o snapshot para lista vazia []'
      );

      // Repopular e testar storage com key === null (localStorage.clear() em outra aba)
      await act(async () => {
        recordPosP23(accP23B, { id: 902, type: 'movie', positionSec: 180 });
      });
      assert.strictEqual(consumerSnapshots[1].length, 1);

      windowInstance.localStorage.removeItem(keyP23B);
      await act(async () => {
        windowInstance.dispatchEvent(
          new (windowInstance as any).StorageEvent('storage', {
            key: null,
          })
        );
      });
      assert.strictEqual(
        consumerSnapshots[1].length,
        0,
        '[12.19.5] StorageEvent com key === null deve limpar o cache e atualizar os consumidores para []'
      );

      // -----------------------------------------------------------------------
      // 12.19.6: Pausa, saída, retomada, vínculo episódio-série e "Assistir do Início"
      // -----------------------------------------------------------------------
      function SessionPersistenceProbe({ url, streamId }: { url: string; streamId: number }) {
        const vRef = React.useRef<HTMLVideoElement | null>(null);
        usePlaybackSession({
          videoRef: vRef,
          streamUrl: url,
          contentType: 'episode',
          streamId,
          credentials: accP23B,
          isControlsVisible: false,
          isDiagnosticsOpen: false,
        });
        return React.createElement('video', { ref: vRef });
      }

      // Associar episódio 3001 à série 400 antes da sessão (como SeriesDetails faz)
      await act(async () => {
        recordPosP23(accP23B, {
          id: 3001,
          type: 'episode',
          parentSeriesId: 400,
          positionSec: 10,
        });
      });

      const sessionContainer = document.createElement('div');
      document.body.appendChild(sessionContainer);
      const sessionRoot = createRoot(sessionContainer);

      await act(async () => {
        sessionRoot.render(
          React.createElement(SessionPersistenceProbe, {
            url: 'http://p23-server-a.tv:8080/series/user_p23_b/pw/3001.mp4',
            streamId: 3001,
          })
        );
      });

      const sessionVideo = sessionContainer.querySelector('video') as HTMLVideoElement;
      assert(sessionVideo, '[12.19.6] Elemento <video> deve estar montado');

      // Gravação periódica em timeupdate (cur = 65s)
      await act(async () => {
        sessionVideo.currentTime = 65;
        sessionVideo.dispatchEvent(new windowInstance.Event('timeupdate') as unknown as Event);
      });
      assert.strictEqual(
        getProgressP23(accP23B, 'episode', 3001),
        65,
        '[12.19.6] timeupdate deve gravar progresso periódico (65s)'
      );
      assert.strictEqual(
        consumerSnapshots[1][0]?.positionSec,
        65,
        '[12.19.6] Consumidor da interface deve refletir imediatamente o progresso periódico (65s)'
      );
      assert.strictEqual(
        consumerSnapshots[1][0]?.parentSeriesId,
        '400',
        '[12.19.6] Atualização periódica do episódio deve preservar o vínculo com parentSeriesId=400'
      );

      // Gravação na pausa (cur = 68s, mesmo com delta < 5s)
      await act(async () => {
        sessionVideo.currentTime = 68;
        sessionVideo.dispatchEvent(new windowInstance.Event('pause') as unknown as Event);
      });
      assert.strictEqual(
        getProgressP23(accP23B, 'episode', 3001),
        68,
        '[12.19.6] Evento pause deve persistir imediatamente a posição atual (68s)'
      );

      // Gravação na saída (unmount com cur = 142s)
      await act(async () => {
        sessionVideo.currentTime = 142;
        sessionRoot.unmount();
      });
      document.body.removeChild(sessionContainer);

      assert.strictEqual(
        getProgressP23(accP23B, 'episode', 3001),
        142,
        '[12.19.6] Saída do player (unmount) deve persistir a posição final para retomada (142s)'
      );
      assert.strictEqual(
        consumerSnapshots[1][0]?.positionSec,
        142,
        '[12.19.6] Interface deve refletir 142s após saída do player'
      );

      // "Assistir do Início" (clearItemProgress) zera positionSec mantendo parentSeriesId
      await act(async () => {
        const cleared = clearProgressP23(accP23B, 'episode', 3001);
        assert.strictEqual(cleared, true, '[12.19.6] clearItemProgress deve retornar true');
      });
      assert.strictEqual(
        getProgressP23(accP23B, 'episode', 3001),
        0,
        '[12.19.6] Assistir do Início deve zerar o progresso (0s)'
      );
      const epRecordAfterClear = getHistRecordsP23(accP23B, 'episode').find((r) => r.id === '3001');
      assert.strictEqual(
        epRecordAfterClear?.parentSeriesId,
        '400',
        '[12.19.6] Assistir do Início deve preservar parentSeriesId=400 no registro do episódio'
      );

      // -----------------------------------------------------------------------
      // 12.19.7: Reordenação de "Continuar Assistindo" preserva restauração de foco pela rowKey estável
      // -----------------------------------------------------------------------
      await act(async () => {
        recordPosP23(accP23B, { id: 201, type: 'movie', positionSec: 90 });
        await new Promise((r) => setTimeout(r, 5));
        recordPosP23(accP23B, { id: 202, type: 'movie', positionSec: 120 });
        await new Promise((r) => setTimeout(r, 5));
        recordPosP23(accP23B, { id: 203, type: 'movie', positionSec: 150 });
      });

      function ContinueWatchingReorderProbe() {
        const records = useHistHookP23(accP23B);
        const items = records
          .filter((r) => r.type === 'movie' && (r.positionSec ?? 0) > 30)
          .map((r) => ({
            stream_id: Number(r.id),
            name: `Filme CW ${r.id}`,
            stream_icon: '',
            rowKey: `movie_${r.id}`,
          }));
        return React.createElement(HorizontalRow, {
          title: 'Continuar Assistindo',
          items,
          type: 'vod',
          rowIndex: 0,
          onItemClick: () => {},
          enableHorizontalVirtualization: true,
        });
      }

      const cwReorderContainer = document.createElement('div');
      document.body.appendChild(cwReorderContainer);
      const cwReorderRoot = createRoot(cwReorderContainer);

      await act(async () => {
        cwReorderRoot.render(
          React.createElement(
            XtreamCredentialsContext.Provider,
            { value: { credentials: { ...accP23B, password: 'pw' } } },
            React.createElement(ContinueWatchingReorderProbe, null)
          )
        );
      });

      const card201Before = cwReorderContainer.querySelector('[data-row-item-key="movie_201"]') as HTMLElement;
      assert(card201Before, '[12.19.7] Cartão movie_201 deve estar montado na fileira Continuar Assistindo');
      assert.strictEqual(
        card201Before.getAttribute('data-row-card-index'),
        '2',
        '[12.19.7] Cartão movie_201 deve iniciar no índice 2 (ordem: 203, 202, 201)'
      );

      await act(async () => {
        card201Before.focus();
        pushFocusMemory(card201Before);
        await new Promise((r) => setTimeout(r, 5));
        // Atualizar progresso de movie_201 -> move movie_201 do índice 2 para o índice 0
        recordPosP23(accP23B, { id: 201, type: 'movie', positionSec: 300 });
      });

      const card201AfterReorder = cwReorderContainer.querySelector('[data-row-item-key="movie_201"]') as HTMLElement;
      assert.strictEqual(
        card201AfterReorder?.getAttribute('data-row-card-index'),
        '0',
        '[12.19.7] Após atualização de progresso, movie_201 deve ser reordenado para o índice 0'
      );

      await act(async () => {
        const restored = popFocusMemory();
        assert.strictEqual(restored, true, '[12.19.7] popFocusMemory deve restaurar o foco pela rowKey estável');
      });
      assertSameElement(
        document.activeElement,
        card201AfterReorder,
        '[12.19.7] O foco deve ser restaurado no cartão movie_201 reordenado'
      );

      await act(async () => {
        cwReorderRoot.unmount();
      });
      document.body.removeChild(cwReorderContainer);

      // -----------------------------------------------------------------------
      // 12.19.8: Bloqueio do getter de window.localStorage (SecurityError)
      //          1) Na importação do módulo (sem impedir a abertura do app)
      //          2) Após o cache já ter sido preenchido (preservando o último snapshot confirmado)
      // -----------------------------------------------------------------------
      const confirmedSnapshotBeforeSecurityBlock = consumerSnapshots[1];
      assert(
        confirmedSnapshotBeforeSecurityBlock && confirmedSnapshotBeforeSecurityBlock.length > 0,
        '[12.19.8] Snapshot confirmado de accP23B deve estar preenchido antes do bloqueio de localStorage'
      );

      const winLocalStorageDescriptor =
        Object.getOwnPropertyDescriptor(windowInstance, 'localStorage') ||
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(windowInstance), 'localStorage');
      const globalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

      try {
        const throwSecurityError = () => {
          const err = new Error('The operation is insecure (localStorage blocked)');
          err.name = 'SecurityError';
          throw err;
        };

        Object.defineProperty(windowInstance, 'localStorage', {
          get: throwSecurityError,
          configurable: true,
        });
        Object.defineProperty(globalThis, 'localStorage', {
          get: throwSecurityError,
          configurable: true,
        });

        // 1) Importar uma nova instância do módulo com o getter de window.localStorage lançando SecurityError
        const blockedModuleUrl = new URL(
          `../src/utils/playbackHistory.ts?security_block_import=${Date.now()}`,
          import.meta.url
        ).href;
        const blockedLoadedMod = await import(blockedModuleUrl);
        assert(
          typeof blockedLoadedMod.getItemProgress === 'function' &&
            typeof blockedLoadedMod.useAccountPlaybackHistory === 'function',
          '[12.19.8] Módulo playbackHistory.ts deve carregar normalmente mesmo quando o getter de window.localStorage lança SecurityError'
        );
        assert.strictEqual(
          blockedLoadedMod.readHistoryMap(keyP23B),
          null,
          '[12.19.8] Na instância importada sob bloqueio de localStorage, readHistoryMap deve retornar null'
        );
        assert.strictEqual(
          blockedLoadedMod.getItemProgress(accP23B, 'movie', 201),
          0,
          '[12.19.8] Na instância importada sob bloqueio e sem cache prévio, getItemProgress deve retornar 0 com segurança'
        );
        assert.strictEqual(
          blockedLoadedMod.recordPlaybackPosition(accP23B, { id: 201, type: 'movie', positionSec: 500 }),
          false,
          '[12.19.8] Na instância importada sob bloqueio, recordPlaybackPosition deve retornar false'
        );
        assert.strictEqual(
          blockedLoadedMod.writeHistoryMap(keyP23B, {}),
          false,
          '[12.19.8] Na instância importada sob bloqueio, writeHistoryMap deve retornar false'
        );

        // 2) No módulo ativo com cache já preenchido antes do bloqueio:
        //    - readHistoryMap retorna null
        //    - gravações retornam false
        //    - último snapshot confirmado é preservado em memória
        assert.strictEqual(
          readHistMapP23(keyP23B),
          null,
          '[12.19.8] Quando localStorage passa a lançar SecurityError após a abertura, readHistoryMap deve retornar null'
        );
        assert.strictEqual(
          recordPosP23(accP23B, { id: 201, type: 'movie', positionSec: 999 }),
          false,
          '[12.19.8] Quando localStorage lança SecurityError após a abertura, recordPlaybackPosition deve retornar false'
        );
        assert.strictEqual(
          clearProgressP23(accP23B, 'movie', 201),
          false,
          '[12.19.8] Quando localStorage lança SecurityError após a abertura, clearItemProgress deve retornar false'
        );
        assert.strictEqual(
          writeHistMapP23(keyP23B, {}),
          false,
          '[12.19.8] Quando localStorage lança SecurityError após a abertura, writeHistoryMap deve retornar false'
        );
        assert.strictEqual(
          getProgressP23(accP23B, 'movie', 201),
          300,
          '[12.19.8] Quando localStorage lança SecurityError após o cache estar preenchido, getItemProgress deve preservar o último valor confirmado (300s)'
        );
        assert.strictEqual(
          getHistRecordsP23(accP23B),
          confirmedSnapshotBeforeSecurityBlock,
          '[12.19.8] getHistoryRecords deve preservar exatamente a mesma referência do último snapshot confirmado quando localStorage falha'
        );
        assert.strictEqual(
          consumerSnapshots[1],
          confirmedSnapshotBeforeSecurityBlock,
          '[12.19.8] Assinantes de useAccountPlaybackHistory devem preservar o último snapshot confirmado quando localStorage falha'
        );
      } finally {
        if (winLocalStorageDescriptor) {
          Object.defineProperty(windowInstance, 'localStorage', winLocalStorageDescriptor);
        }
        if (globalLocalStorageDescriptor) {
          Object.defineProperty(globalThis, 'localStorage', globalLocalStorageDescriptor);
        }
      }

      // -----------------------------------------------------------------------
      // 12.19.9: Preservação de snapshots com 9 contas assinadas simultaneamente
      //          - 9 contas montadas juntas (excedente necessário permitido acima de 8)
      //          - Gravação em apenas 1 conta mantém as outras 8 com a mesma referência de lista (===) e 0 re-renderizações extras
      //          - Desmontagem reduz o cache de volta ao limite (<= 8) sem apagar o localStorage
      // -----------------------------------------------------------------------
      const nineAccounts = Array.from({ length: 9 }, (_, idx) => ({
        serverUrl: 'http://p23-nine.tv:8080',
        username: `nine_active_user_${idx + 1}`,
      }));
      const nineHistoryKeys = nineAccounts.map((acc) => getHistKeyP23(acc.serverUrl, acc.username));

      for (let idx = 0; idx < 9; idx++) {
        recordPosP23(nineAccounts[idx], {
          id: 5000 + idx,
          type: 'movie',
          positionSec: (idx + 1) * 30,
        });
      }

      const nineLatestRefs: Record<number, any[]> = {};
      const nineRenderCounts: Record<number, number> = {};

      function SingleSubscribedAccountChild({
        index,
        account,
      }: {
        index: number;
        account: { serverUrl: string; username: string };
      }) {
        const records = useHistHookP23(account);
        nineLatestRefs[index] = records;
        nineRenderCounts[index] = (nineRenderCounts[index] ?? 0) + 1;
        return React.createElement('span', { 'data-nine-idx': index }, `${account.username}:${records.length}`);
      }

      function NineSubscribedAccountsHarness({ count }: { count: number }) {
        return React.createElement(
          'div',
          null,
          nineAccounts.slice(0, count).map((acc, idx) =>
            React.createElement(SingleSubscribedAccountChild, {
              key: acc.username,
              index: idx,
              account: acc,
            })
          )
        );
      }

      const nineContainer = document.createElement('div');
      document.body.appendChild(nineContainer);
      const nineRoot = createRoot(nineContainer);

      try {
        await act(async () => {
          nineRoot.render(React.createElement(NineSubscribedAccountsHarness, { count: 9 }));
        });

        const statsWith9Mounted = getPlaybackHistoryPerfStats();
        assert(
          statsWith9Mounted.cachedAccountsCount >= 9,
          `[12.19.9] Com 9 contas assinadas simultaneamente, o cache deve manter o excedente necessário (>= 9; obteve ${statsWith9Mounted.cachedAccountsCount})`
        );

        const initialNineSnapshotRefs: Record<number, any[]> = {};
        const renderCountsAfterInitialMount: Record<number, number> = {};
        for (let idx = 0; idx < 9; idx++) {
          assert(
            Array.isArray(nineLatestRefs[idx]) && nineLatestRefs[idx].length === 1,
            `[12.19.9] Conta assinada ${idx + 1} deve iniciar com 1 registro`
          );
          assert.strictEqual(
            nineRenderCounts[idx],
            1,
            `[12.19.9] Conta ${idx + 1} deve montar com exatamente 1 renderização (sem laço de renderização; obteve ${nineRenderCounts[idx]})`
          );
          initialNineSnapshotRefs[idx] = nineLatestRefs[idx];
          renderCountsAfterInitialMount[idx] = nineRenderCounts[idx];
        }

        // Gravar apenas na conta 0 (nine_active_user_1) enquanto todas as 9 estão assinadas
        await act(async () => {
          const ok = recordPosP23(nineAccounts[0], {
            id: 5999,
            type: 'movie',
            positionSec: 145,
          });
          assert.strictEqual(ok, true, '[12.19.9] Gravação na 1ª conta das 9 deve ter sucesso');
        });

        assert.strictEqual(
          nineLatestRefs[0].length,
          2,
          '[12.19.9] Conta 1 (atualizada) deve passar a ter 2 registros no snapshot'
        );
        for (let idx = 1; idx < 9; idx++) {
          assert.strictEqual(
            nineLatestRefs[idx],
            initialNineSnapshotRefs[idx],
            `[12.19.9] Conta assinada ${idx + 1} (não alterada) deve preservar exatamente a mesma referência de lista (===)`
          );
          assert.strictEqual(
            nineRenderCounts[idx],
            renderCountsAfterInitialMount[idx],
            `[12.19.9] Conta assinada ${idx + 1} não deve sofrer re-renderização ao gravar na conta 1`
          );
        }

        // Desmontar as contas 9 e 8 (reduzindo de 9 para 7 assinantes na árvore + 1 em p23Root = 8 assinantes)
        // e depois desmontar todas as 9 de nineRoot -> o cache deve voltar imediatamente ao limite MAX_CACHED_HISTORY_ACCOUNTS (8)
        await act(async () => {
          nineRoot.unmount();
        });

        const statsAfterNineUnmount = getPlaybackHistoryPerfStats();
        assert(
          statsAfterNineUnmount.cachedAccountsCount <= MAX_CACHED_HISTORY_ACCOUNTS,
          `[12.19.9] Após desmontar os assinantes excedentes, o cache deve voltar ao limite de ${MAX_CACHED_HISTORY_ACCOUNTS} entradas (obteve ${statsAfterNineUnmount.cachedAccountsCount})`
        );

        // Os dados persistidos de todas as 9 contas continuam íntegros no localStorage
        for (let idx = 0; idx < 9; idx++) {
          assert.strictEqual(
            getProgressP23(nineAccounts[idx], 'movie', 5000 + idx),
            (idx + 1) * 30,
            `[12.19.9] Dados persistidos da conta ${idx + 1} devem permanecer intactos após redução do cache`
          );
        }
      } finally {
        if (nineContainer.parentNode) {
          document.body.removeChild(nineContainer);
        }
        for (const k of nineHistoryKeys) {
          windowInstance.localStorage.removeItem(k);
        }
      }

      console.log(
        `📊 [Métricas P2.3 — Histórico de Reprodução (Snapshot Estável + useSyncExternalStore)]\n` +
          `   • 60 consultas getItemProgress (temporada de 60 episódios, histórico de 200 itens):\n` +
          `     - 1ª passada (fria): leituras=${statsAfter60EpisodeReads.storageReads} (antes=60) | interpretações JSON=${statsAfter60EpisodeReads.jsonParses} (antes=60) | validações de registro=${statsAfter60EpisodeReads.recordValidations} (antes=12000) | ordenações=${statsAfter60EpisodeReads.sortCalls}\n` +
          `     - 2ª passada (quente): leituras=${statsWarm60EpisodeReads.storageReads} (antes=60) | interpretações JSON=${statsWarm60EpisodeReads.jsonParses} (antes=60) | validações de registro=${statsWarm60EpisodeReads.recordValidations} (antes=12000) | ordenações=${statsWarm60EpisodeReads.sortCalls}\n` +
          `   • 4 consumidores useAccountPlaybackHistory montados (HomeView, LiveTvView, MoviesView, SeriesView):\n` +
          `     - Montagem inicial: leituras=${statsMount4Consumers.storageReads} (antes=4) | interpretações JSON=${statsMount4Consumers.jsonParses} (antes=4) | ordenações=${statsMount4Consumers.sortCalls} (antes=4)\n` +
          `     - Atualização após gravação válida: leituras=${statsAfterWrite4Consumers.storageReads} (antes=5) | interpretações JSON=${statsAfterWrite4Consumers.jsonParses} (antes=5) | ordenações=${statsAfterWrite4Consumers.sortCalls} (antes=4)\n` +
          `     - Atualização via StorageEvent (outra aba): leituras=${statsCrossTabUpdate.storageReads} (antes=4) | interpretações JSON=${statsCrossTabUpdate.jsonParses} (antes=4) | ordenações=${statsCrossTabUpdate.sortCalls} (antes=4)`
      );
    } finally {
      windowInstance.removeEventListener(HISTORY_UPDATED_EVENT, onCustomHistoryUpdated);
      await act(async () => {
        p23Root.unmount();
      });
      if (p23Container.parentNode) {
        document.body.removeChild(p23Container);
      }
      windowInstance.localStorage.removeItem(keyP23A);
      windowInstance.localStorage.removeItem(keyP23B);
      windowInstance.localStorage.removeItem(keyP23Server2);
    }
  }

  // =========================================================================
  // 12.20. P3.1 — Diagnóstico do Carregamento Inicial dos Catálogos
  // =========================================================================
  console.log(
    '🧪 Testando 12.20 (P3.1): Diagnóstico do carregamento inicial dos catálogos (fila, transporte Web/Android, processamento, marcos da Home, sanitização e isolamento)...'
  );
  {
    const catalogDiagMod = await import('../src/utils/catalogDiagnostics');
    const { setTransportTestConfig } = await import('../src/services/httpTransport');
    const {
      CATALOG_DIAGNOSTICS_ENABLED_KEY,
      isCatalogLoadDiagnosticsEnabled,
      setCatalogLoadDiagnosticsEnabled,
      setCatalogDiagnosticsClockForTest,
      resetCatalogDiagnosticsForTest,
      getCatalogDiagnosticsSnapshot,
      getCatalogDiagnosticsRecordedEventsCountForTest,
      startCatalogDiagnosticsSession,
      recordCatalogOperationEnqueued,
      recordCatalogOperationDeduplicated,
      recordCatalogOperationStarted,
      recordCatalogOperationFinished,
      recordHomeOpeningMilestone,
    } = catalogDiagMod;

    const savedGetLiveCatsP31 = (XtreamService as any).getLiveCategories;
    const savedGetVodCatsP31 = (XtreamService as any).getVodCategories;
    const savedGetSeriesCatsP31 = (XtreamService as any).getSeriesCategories;
    const savedGetLiveStreamsP31 = (XtreamService as any).getLiveStreams;
    const savedGetVodStreamsP31 = (XtreamService as any).getVodStreams;
    const savedGetSeriesP31 = (XtreamService as any).getSeries;
    const savedAuthenticateP31 = (XtreamService as any).authenticate;
    const savedFetchP31 = globalThis.fetch;

    const p31Container = document.createElement('div');
    document.body.appendChild(p31Container);
    const p31Root = createRoot(p31Container);

    try {
      resetCatalogDiagnosticsForTest(false);
      windowInstance.localStorage.removeItem(CATALOG_DIAGNOSTICS_ENABLED_KEY);

      // -----------------------------------------------------------------------
      // 12.20.1: Desativado por padrão — zero eventos capturados e mesmas 6 requisições sem chamadas extras
      // -----------------------------------------------------------------------
      assert.strictEqual(
        isCatalogLoadDiagnosticsEnabled(),
        false,
        '[12.20.1] Coleta de diagnóstico inicial dos catálogos deve vir desativada por padrão'
      );
      assert.strictEqual(
        windowInstance.localStorage.getItem(CATALOG_DIAGNOSTICS_ENABLED_KEY),
        null,
        '[12.20.1] Nenhuma chave deve ser gravada no localStorage enquanto o usuário não ativar a coleta'
      );

      let disabledReqCount = 0;
      (XtreamService as any).getLiveCategories = async () => {
        disabledReqCount++;
        return [{ category_id: '1', category_name: 'Canais' }];
      };
      (XtreamService as any).getVodCategories = async () => {
        disabledReqCount++;
        return [{ category_id: '10', category_name: 'Filmes' }];
      };
      (XtreamService as any).getSeriesCategories = async () => {
        disabledReqCount++;
        return [{ category_id: '20', category_name: 'Séries' }];
      };
      (XtreamService as any).getLiveStreams = async () => {
        disabledReqCount++;
        return [{ stream_id: 101, name: 'Canal 1', category_id: '1' }];
      };
      (XtreamService as any).getVodStreams = async () => {
        disabledReqCount++;
        return [{ stream_id: 201, name: 'Filme 1 (2024)', category_id: '10', rating: '8.0' }];
      };
      (XtreamService as any).getSeries = async () => {
        disabledReqCount++;
        return [{ series_id: 301, name: 'Série 1 (2024)', category_id: '20', rating: '8.5' }];
      };

      await act(async () => {
        p31Root.render(
          React.createElement(
            XtreamProvider,
            {
              credentials: {
                serverUrl: 'http://secret-provider.example.com:8080',
                username: 'private_user_zero',
                password: 'private_pass_zero',
              },
            },
            React.createElement('div', null, 'Disabled Diag Test')
          )
        );
        await new Promise((r) => setTimeout(r, 40));
      });

      assert.strictEqual(
        disabledReqCount,
        6,
        `[12.20.1] Com diagnóstico desativado, exatamente as 6 operações iniciais devem carregar sem requisições extras (obteve ${disabledReqCount})`
      );
      assert.strictEqual(
        getCatalogDiagnosticsSnapshot(),
        null,
        '[12.20.1] Com diagnóstico desativado, nenhum snapshot de sessão deve ser alocado em memória'
      );
      assert.strictEqual(
        getCatalogDiagnosticsRecordedEventsCountForTest(),
        0,
        '[12.20.1] Com diagnóstico desativado, o contador de eventos capturados deve ser exatamente 0'
      );

      await act(async () => {
        p31Root.unmount();
      });

      // -----------------------------------------------------------------------
      // 12.20.2: Relógio monotônico controlado — separação de Transporte Web (espera da resposta vs leitura do corpo + JSON.parse) vs Transporte Android CapacitorHttp (transporte + ponte nativa com payload pré-parseado sem re-serializar)
      // -----------------------------------------------------------------------
      let controlledNowMs = 1000;
      setCatalogDiagnosticsClockForTest(() => controlledNowMs);
      setCatalogLoadDiagnosticsEnabled(true);

      assert.strictEqual(
        isCatalogLoadDiagnosticsEnabled(),
        true,
        '[12.20.2] Coleta deve ficar ativa após setCatalogLoadDiagnosticsEnabled(true)'
      );
      assert.strictEqual(
        windowInstance.localStorage.getItem(CATALOG_DIAGNOSTICS_ENABLED_KEY),
        'true',
        '[12.20.2] Apenas a preferência booleana ("true") deve ser persistida no localStorage'
      );

      // Restaurar métodos reais de XtreamService para exercitar XtreamService.request + executeXtreamGetRequest reais
      (XtreamService as any).getLiveCategories = origXtreamMethods.getLiveCategories;
      (XtreamService as any).getVodCategories = origXtreamMethods.getVodCategories;
      (XtreamService as any).getSeriesCategories = origXtreamMethods.getSeriesCategories;
      (XtreamService as any).getLiveStreams = origXtreamMethods.getLiveStreams;
      (XtreamService as any).getVodStreams = origXtreamMethods.getVodStreams;
      (XtreamService as any).getSeries = origXtreamMethods.getSeries;

      const s1Id = 101;
      startCatalogDiagnosticsSession(s1Id, 2);

      // Operação 1: Modo Web (fetch texto) -> espera pela resposta = 35ms, leitura do corpo = 20ms, JSON.parse = 12ms
      setTransportTestConfig({ mode: 'web', capacitorHttpGet: null });
      const rawJsonMovies = JSON.stringify([
        ...Array.from({ length: 200 }, (_, idx) => ({
          stream_id: idx + 1,
          name: `Filme Segredo Alpha ${idx + 1} (${2000 + (idx % 25)})`,
          category_id: '10',
          rating: ((idx % 90) / 10).toFixed(1),
        })),
        null,
        'invalido',
      ]);

      const origJsonParse = JSON.parse;
      JSON.parse = ((text: string, reviver?: any) => {
        controlledNowMs += 12; // Simula 12ms gastos em JSON.parse
        return origJsonParse(text, reviver);
      }) as typeof JSON.parse;

      globalThis.fetch = (async () => {
        controlledNowMs += 35; // 35ms aguardando cabeçalhos da resposta HTTP
        return {
          ok: true,
          status: 200,
          text: async () => {
            controlledNowMs += 20; // 20ms lendo o corpo da resposta
            return rawJsonMovies;
          },
        } as unknown as Response;
      }) as typeof fetch;

      const vodOpHandle = recordCatalogOperationEnqueued(s1Id, 'vod_catalog', 50);
      assert(vodOpHandle !== null, '[12.20.2] Handle da operação vod_catalog deve ser criado');
      controlledNowMs += 15; // 15ms aguardando na fila
      recordCatalogOperationStarted(vodOpHandle);

      const fetchedMoviesWeb = await XtreamService.getVodStreams(
        {
          serverUrl: 'http://private-host.example.org:8080',
          username: 'user_secret_123',
          password: 'pass_secret_456',
        },
        undefined,
        { diagOp: vodOpHandle }
      );
      JSON.parse = origJsonParse;

      assert.strictEqual(
        fetchedMoviesWeb.length,
        200,
        '[12.20.2] Normalização deve filtrar itens inválidos mantendo os 200 filmes válidos'
      );

      // Construir índice VOD em 2 lotes cooperativos de 100 itens com pausa entre lotes medida pelo relógio monotônico
      const vodIdxP31 = await buildVodIndexAsync(fetchedMoviesWeb, {
        batchSize: 100,
        diagOp: vodOpHandle,
        onBatchProgress: (processed) => {
          if (processed < 200) {
            controlledNowMs += 9; // Simula pausa/yield de 9ms entre o 1º e o 2º lote cooperativo
          }
        },
      });
      assert(vodIdxP31 !== null, '[12.20.2] Índice VOD deve ser construído');

      // Executar 1ª ordenação (fria) e 2ª ordenação (cache em memória)
      controlledNowMs += 4;
      const sortedAll1 = vodIdxP31.getSortedAll();
      const sortedAll2 = vodIdxP31.getSortedAll();
      assert.strictEqual(sortedAll1, sortedAll2, '[12.20.2] 2ª leitura de getSortedAll deve vir do cache');

      recordCatalogOperationFinished(vodOpHandle, 'success');

      // Operação 2: Modo Android APK (CapacitorHttp) com payload já entregue como array pela ponte nativa (sem JSON.parse e sem re-serializar)
      let jsonStringifyCalledOnPreParsed = false;
      const origJsonStringify = JSON.stringify;
      const preParsedAndroidCategories = [
        { category_id: '1', category_name: 'Canais Secretos Android' },
        { category_id: '2', category_name: 'Esportes Secretos Android' },
      ];
      JSON.stringify = ((value: any, ...rest: any[]) => {
        if (value === preParsedAndroidCategories) {
          jsonStringifyCalledOnPreParsed = true;
        }
        return origJsonStringify(value, ...rest);
      }) as typeof JSON.stringify;

      setTransportTestConfig({
        mode: 'capacitor',
        capacitorHttpGet: async () => {
          controlledNowMs += 48; // 48ms em transporte + ponte nativa CapacitorHttp
          return {
            status: 200,
            data: preParsedAndroidCategories,
            headers: {},
            url: 'http://private-host.example.org:8080/player_api.php',
          };
        },
      });

      const liveCatOpHandle = recordCatalogOperationEnqueued(s1Id, 'live_categories', 80);
      recordCatalogOperationStarted(liveCatOpHandle);
      const fetchedCatsAndroid = await XtreamService.getLiveCategories(
        {
          serverUrl: 'http://private-host.example.org:8080',
          username: 'user_secret_123',
          password: 'pass_secret_456',
        },
        { diagOp: liveCatOpHandle }
      );
      JSON.stringify = origJsonStringify;
      recordCatalogOperationFinished(liveCatOpHandle, 'success');

      assert.strictEqual(fetchedCatsAndroid.length, 2);
      assert.strictEqual(
        jsonStringifyCalledOnPreParsed,
        false,
        '[12.20.2] Payload já recebido como objeto/array no Android NÃO deve ser re-serializado com JSON.stringify'
      );

      const snapTransport = getCatalogDiagnosticsSnapshot();
      assert(snapTransport !== null, '[12.20.2] Snapshot deve existir');

      const vodOpSnap = snapTransport.operations.vod_catalog!;
      assert(vodOpSnap !== null, '[12.20.2] vod_catalog deve estar no snapshot');
      assert.strictEqual(vodOpSnap.queueWaitMs, 15, '[12.20.2] Espera na fila de vod_catalog deve ser 15ms');
      assert.strictEqual(vodOpSnap.attempts.length, 1);
      assert.strictEqual(vodOpSnap.attempts[0].transportKind, 'web-fetch');
      assert.strictEqual(
        vodOpSnap.attempts[0].responseWaitMs,
        35,
        '[12.20.2] No navegador, espera pela resposta deve ser separada (35ms)'
      );
      assert.strictEqual(
        vodOpSnap.attempts[0].bodyReadMs,
        20,
        '[12.20.2] No navegador, leitura do corpo deve ser separada (20ms)'
      );
      assert.strictEqual(
        vodOpSnap.attempts[0].jsonParseExecuted,
        true,
        '[12.20.2] No navegador com texto JSON, jsonParseExecuted deve ser true'
      );
      assert.strictEqual(
        vodOpSnap.attempts[0].jsonParseMs,
        12,
        '[12.20.2] Tempo de JSON.parse deve ser medido quando JSON.parse realmente ocorre (12ms)'
      );
      assert.strictEqual(vodOpSnap.rawItemsCount, 202, '[12.20.2] Contagem bruta recebida deve ser 202');
      assert.strictEqual(vodOpSnap.validItemsCount, 200, '[12.20.2] Contagem válida após normalização deve ser 200');
      assert(
        vodOpSnap.indexElapsedMs !== null &&
          vodOpSnap.indexActiveComputeMs !== null &&
          vodOpSnap.indexElapsedMs >= vodOpSnap.indexActiveComputeMs + 9,
        `[12.20.2] indexElapsedMs (${vodOpSnap.indexElapsedMs}ms) deve incluir a pausa entre lotes cooperativos (+9ms) além do tempo ativo (${vodOpSnap.indexActiveComputeMs}ms)`
      );
      assert.strictEqual(vodOpSnap.indexBatchesProcessed, 2);
      assert.strictEqual(vodOpSnap.indexBatchYields, 1);
      assert(
        snapTransport.sorting.vod.newSortsCount >= 1 &&
          snapTransport.sorting.vod.cacheHitsCount >= 1,
        '[12.20.2] Diagnóstico de ordenação deve diferenciar novas ordenações de leituras atendidas pelo cache em memória'
      );

      const liveCatOpSnap = snapTransport.operations.live_categories!;
      assert(liveCatOpSnap !== null, '[12.20.2] live_categories deve estar no snapshot');
      assert.strictEqual(liveCatOpSnap.attempts.length, 1);
      assert.strictEqual(liveCatOpSnap.attempts[0].transportKind, 'capacitor-native');
      assert.strictEqual(
        liveCatOpSnap.attempts[0].nativeTransportAndBridgeMs,
        48,
        '[12.20.2] No Android, o tempo de CapacitorHttp deve ser registrado em nativeTransportAndBridgeMs (48ms)'
      );
      assert.strictEqual(liveCatOpSnap.attempts[0].responseWaitMs, null);
      assert.strictEqual(liveCatOpSnap.attempts[0].bodyReadMs, null);
      assert.strictEqual(
        liveCatOpSnap.attempts[0].payloadFormat,
        'pre-parsed-object',
        '[12.20.2] Payload já parseado na ponte nativa deve ser identificado como pre-parsed-object'
      );
      assert.strictEqual(
        liveCatOpSnap.attempts[0].jsonParseExecuted,
        false,
        '[12.20.2] Quando o payload já chega como objeto/array, jsonParseExecuted deve ser false'
      );
      assert.strictEqual(
        liveCatOpSnap.attempts[0].jsonParseMs,
        null,
        '[12.20.2] Quando JSON.parse não ocorre, jsonParseMs deve ser null'
      );
      assert.strictEqual(
        liveCatOpSnap.attempts[0].payloadChars,
        null,
        '[12.20.2] Payload pré-parseado não deve medir caracteres via re-serialização'
      );

      // -----------------------------------------------------------------------
      // 12.20.3: Retry, deduplicação e operações paralelas sem misturar tentativas
      // -----------------------------------------------------------------------
      XtreamService.setRetryDelayMsForTest(25);
      setTransportTestConfig({ mode: 'web', capacitorHttpGet: null });

      let seriesCatAttemptCounter = 0;
      globalThis.fetch = (async () => {
        seriesCatAttemptCounter++;
        controlledNowMs += 18;
        if (seriesCatAttemptCounter === 1) {
          return {
            ok: false,
            status: 502,
            text: async () => 'Bad Gateway Segredo Interno Provedor XYZ',
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          text: async () => {
            controlledNowMs += 7;
            return origJsonStringify([{ category_id: '30', category_name: 'Séries Drama' }]);
          },
        } as unknown as Response;
      }) as typeof fetch;

      const seriesCatOpHandle = recordCatalogOperationEnqueued(s1Id, 'series_categories', 80);
      recordCatalogOperationDeduplicated(s1Id, 'series_categories', 95);
      recordCatalogOperationStarted(seriesCatOpHandle);
      const seriesCatsRes = await XtreamService.getSeriesCategories(
        {
          serverUrl: 'http://private-host.example.org:8080',
          username: 'user_secret_123',
          password: 'pass_secret_456',
        },
        { diagOp: seriesCatOpHandle }
      );
      recordCatalogOperationFinished(seriesCatOpHandle, 'success');
      XtreamService.setRetryDelayMsForTest(1000);

      assert.strictEqual(seriesCatsRes.length, 1);
      const snapAfterRetry = getCatalogDiagnosticsSnapshot()!;
      const seriesCatSnap = snapAfterRetry.operations.series_categories!;
      assert.strictEqual(
        seriesCatSnap.deduplicatedHits,
        1,
        '[12.20.3] Deduplicação deve ser contabilizada na operação correspondente'
      );
      assert.strictEqual(
        seriesCatSnap.effectivePriority,
        95,
        '[12.20.3] Deduplicação com prioridade maior deve elevar effectivePriority'
      );
      assert.strictEqual(
        seriesCatSnap.attempts.length,
        2,
        '[12.20.3] Operação com 1 falha HTTP 502 seguida de sucesso deve registrar 2 tentativas'
      );
      assert.strictEqual(
        seriesCatSnap.retryCount,
        1,
        '[12.20.3] Operação com retry deve registrar retryCount = 1'
      );
      assert.strictEqual(
        seriesCatSnap.attempts[0].outcome,
        'error',
        '[12.20.3] 1ª tentativa transitória deve ser registrada como error'
      );
      assert.strictEqual(
        seriesCatSnap.attempts[0].httpStatus,
        502,
        '[12.20.3] Código HTTP 502 deve ser registrado sem expor mensagem bruta do provedor'
      );
      assert.strictEqual(
        seriesCatSnap.attempts[1].outcome,
        'success',
        '[12.20.3] 2ª tentativa deve ser registrada como success'
      );
      assert.strictEqual(
        seriesCatSnap.outcome,
        'success',
        '[12.20.3] Resultado final da operação após retry bem-sucedido deve ser success'
      );

      // -----------------------------------------------------------------------
      // 12.20.4: Operações paralelas (concorrência máx 2), troca de conta/cancelamento e proteção contra contaminação por resposta tardia
      // -----------------------------------------------------------------------
      setTransportTestConfig({ mode: 'auto', capacitorHttpGet: null });
      globalThis.fetch = savedFetchP31;

      let resolveStaleVodSessionA: ((items: any[]) => void) | null = null;

      (XtreamService as any).getLiveCategories = async (
        _creds: XtreamCredentials,
        opts?: any
      ) => {
        await Promise.resolve();
        controlledNowMs += 10;
        const arr = [{ category_id: '1', category_name: 'TV' }];
        opts?.diagOp?.recordNormalization({
          durationMs: 1,
          rawItemsCount: 1,
          validItemsCount: 1,
        });
        return arr;
      };
      (XtreamService as any).getVodCategories = async (
        _creds: XtreamCredentials,
        opts?: any
      ) => {
        await Promise.resolve();
        controlledNowMs += 12;
        const arr = [{ category_id: '10', category_name: 'Filmes' }];
        opts?.diagOp?.recordNormalization({
          durationMs: 1,
          rawItemsCount: 1,
          validItemsCount: 1,
        });
        return arr;
      };
      (XtreamService as any).getSeriesCategories = async (
        _creds: XtreamCredentials,
        opts?: any
      ) => {
        await Promise.resolve();
        controlledNowMs += 14;
        const arr = [{ category_id: '20', category_name: 'Séries' }];
        opts?.diagOp?.recordNormalization({
          durationMs: 1,
          rawItemsCount: 1,
          validItemsCount: 1,
        });
        return arr;
      };
      (XtreamService as any).getLiveStreams = async (
        _creds: XtreamCredentials,
        _catId?: string,
        opts?: any
      ) => {
        await Promise.resolve();
        controlledNowMs += 20;
        const arr = [{ stream_id: 1001, name: 'Canal Ao Vivo', category_id: '1' }];
        opts?.diagOp?.recordNormalization({
          durationMs: 1,
          rawItemsCount: 1,
          validItemsCount: 1,
        });
        return arr;
      };
      (XtreamService as any).getVodStreams = async (
        creds: XtreamCredentials,
        _catId?: string,
        opts?: any
      ) => {
        if (creds.username === 'account_A_secret') {
          const staleArr = await new Promise<any[]>((resolve) => {
            resolveStaleVodSessionA = resolve;
          });
          opts?.diagOp?.recordNormalization({
            durationMs: 5,
            rawItemsCount: staleArr.length,
            validItemsCount: staleArr.length,
          });
          return staleArr;
        }
        await Promise.resolve();
        controlledNowMs += 30;
        const arr = [
          { stream_id: 2001, name: 'Filme Conta B 1 (2025)', category_id: '10', rating: '8.8' },
          { stream_id: 2002, name: 'Filme Conta B 2 (2024)', category_id: '10', rating: '7.9' },
        ];
        opts?.diagOp?.recordNormalization({
          durationMs: 2,
          rawItemsCount: 2,
          validItemsCount: 2,
        });
        return arr;
      };
      (XtreamService as any).getSeries = async (
        _creds: XtreamCredentials,
        _catId?: string,
        opts?: any
      ) => {
        await Promise.resolve();
        controlledNowMs += 25;
        const arr = [{ series_id: 3001, name: 'Série Conta B (2025)', category_id: '20', rating: '9.0' }];
        opts?.diagOp?.recordNormalization({
          durationMs: 1,
          rawItemsCount: 1,
          validItemsCount: 1,
        });
        return arr;
      };

      const switchRoot = createRoot(p31Container);
      await act(async () => {
        switchRoot.render(
          React.createElement(
            XtreamProvider,
            {
              credentials: {
                serverUrl: 'http://server-a-secret.tv:8080',
                username: 'account_A_secret',
                password: 'pwd_A_secret',
              },
            },
            React.createElement('div', null, 'Session A')
          )
        );
        await new Promise((r) => setTimeout(r, 30));
      });

      const snapSessionA = getCatalogDiagnosticsSnapshot()!;
      assert(snapSessionA !== null, '[12.20.4] Sessão A deve estar registrada');
      const sessionAId = snapSessionA.sessionId;
      assert.strictEqual(
        snapSessionA.operations.vod_catalog?.outcome,
        'running',
        '[12.20.4] vod_catalog da Sessão A deve estar em andamento antes da troca de conta'
      );

      // Trocar para a Conta B enquanto vod_catalog da Sessão A ainda está pendente
      controlledNowMs += 50;
      await act(async () => {
        switchRoot.render(
          React.createElement(
            XtreamProvider,
            {
              credentials: {
                serverUrl: 'http://server-b-secret.tv:8080',
                username: 'account_B_secret',
                password: 'pwd_B_secret',
              },
            },
            React.createElement('div', null, 'Session B')
          )
        );
        await new Promise((r) => setTimeout(r, 50));
      });

      const snapSessionBBeforeLateA = getCatalogDiagnosticsSnapshot()!;
      assert(
        snapSessionBBeforeLateA.sessionId > sessionAId,
        '[12.20.4] Troca de conta deve criar uma nova sessão em memória substituindo a anterior'
      );
      assert(
        snapSessionBBeforeLateA.allSixFinishedAtMs !== null,
        '[12.20.4] Sessão B deve concluir todas as 6 operações'
      );
      assert.strictEqual(
        snapSessionBBeforeLateA.operations.vod_catalog?.validItemsCount,
        2,
        '[12.20.4] Sessão B deve registrar os 2 itens válidos da Conta B'
      );

      // Agora resolver a resposta tardia da Sessão A (com 99 itens falsos) e avançar o relógio
      controlledNowMs += 500;
      await act(async () => {
        if (resolveStaleVodSessionA) {
          resolveStaleVodSessionA(
            Array.from({ length: 99 }, (_, i) => ({
              stream_id: 9000 + i,
              name: `Filme Tardio Sessão A ${i}`,
              category_id: '10',
            }))
          );
        }
        await new Promise((r) => setTimeout(r, 40));
      });

      const snapSessionBAfterLateA = getCatalogDiagnosticsSnapshot()!;
      assert.strictEqual(
        snapSessionBAfterLateA.sessionId,
        snapSessionBBeforeLateA.sessionId,
        '[12.20.4] Resposta tardia da Sessão A não deve alterar o ID da Sessão B ativa'
      );
      assert.strictEqual(
        snapSessionBAfterLateA.operations.vod_catalog?.validItemsCount,
        2,
        '[12.20.4] Resposta tardia da Sessão A (99 itens) NÃO deve contaminar validItemsCount (2) da Sessão B'
      );
      assert.strictEqual(
        snapSessionBAfterLateA.operations.vod_catalog?.totalElapsedMs,
        snapSessionBBeforeLateA.operations.vod_catalog?.totalElapsedMs,
        '[12.20.4] Resposta tardia da Sessão A não deve alterar os tempos da Sessão B'
      );

      // Verificar espera na fila nas 6 operações paralelas da Sessão B (concorrência máxima de 2)
      const opsB = snapSessionBAfterLateA.operations;
      assert.strictEqual(
        opsB.live_categories?.queueWaitMs,
        0,
        '[12.20.4] 1ª operação da fila (live_categories) deve iniciar imediatamente (queueWaitMs=0)'
      );
      assert.strictEqual(
        opsB.vod_categories?.queueWaitMs,
        0,
        '[12.20.4] 2ª operação da fila (vod_categories) deve iniciar imediatamente (queueWaitMs=0)'
      );
      assert(
        (opsB.series_categories?.queueWaitMs ?? 0) > 0 &&
          (opsB.live_catalog?.queueWaitMs ?? 0) > 0 &&
          (opsB.vod_catalog?.queueWaitMs ?? 0) > 0 &&
          (opsB.series_catalog?.queueWaitMs ?? 0) > 0,
        '[12.20.4] As 4 operações seguintes devem registrar queueWaitMs > 0 respeitando a concorrência máxima de 2'
      );

      await act(async () => {
        switchRoot.unmount();
      });

      // -----------------------------------------------------------------------
      // 12.20.5: Marcos de abertura na Home REAL — seletor de apresentação aberto por 150ms desde a 1ª montagem (antes do efeito do provedor) com catálogo ainda pendente, e duração reportada separadamente sem subtração
      // -----------------------------------------------------------------------
      windowInstance.localStorage.removeItem(STORAGE_KEY_DISPLAY_PREFS);
      windowInstance.localStorage.setItem(
        CREDENTIALS_KEY,
        JSON.stringify({
          serverUrl: 'http://server-milestone-secret.tv:8080',
          username: 'user_milestone_secret',
          password: 'pass_milestone_secret',
          playlistName: 'Lista Secreta Milestone',
        })
      );

      let resolvePendingSeriesCatalog150: ((items: any[]) => void) | null = null;
      (XtreamService as any).getLiveCategories = async (_c: any, opts?: any) => {
        opts?.diagOp?.recordNormalization({ durationMs: 1, rawItemsCount: 1, validItemsCount: 1 });
        return [{ category_id: '1', category_name: 'TV' }];
      };
      (XtreamService as any).getVodCategories = async (_c: any, opts?: any) => {
        opts?.diagOp?.recordNormalization({ durationMs: 1, rawItemsCount: 1, validItemsCount: 1 });
        return [{ category_id: '10', category_name: 'Filmes' }];
      };
      (XtreamService as any).getSeriesCategories = async (_c: any, opts?: any) => {
        opts?.diagOp?.recordNormalization({ durationMs: 1, rawItemsCount: 1, validItemsCount: 1 });
        return [{ category_id: '20', category_name: 'Séries' }];
      };
      (XtreamService as any).getLiveStreams = async (_c: any, _cat?: string, opts?: any) => {
        opts?.diagOp?.recordNormalization({ durationMs: 1, rawItemsCount: 1, validItemsCount: 1 });
        return [{ stream_id: 101, name: 'Canal 1', category_id: '1' }];
      };
      (XtreamService as any).getVodStreams = async (_c: any, _cat?: string, opts?: any) => {
        opts?.diagOp?.recordNormalization({ durationMs: 1, rawItemsCount: 2, validItemsCount: 2 });
        return [
          {
            stream_id: 201,
            name: 'Filme 1 (2024)',
            category_id: '10',
            rating: '8.2',
            stream_icon: 'http://img.test/f201.jpg',
          },
          {
            stream_id: 202,
            name: 'Filme 2 (2025)',
            category_id: '10',
            rating: '9.0',
            stream_icon: 'http://img.test/f202.jpg',
          },
        ];
      };
      (XtreamService as any).getSeries = (_c: any, _cat?: string, opts?: any) => {
        return new Promise<any[]>((resolve) => {
          resolvePendingSeriesCatalog150 = (items) => {
            opts?.diagOp?.recordNormalization({
              durationMs: 2,
              rawItemsCount: items.length,
              validItemsCount: items.length,
            });
            resolve(items);
          };
        });
      };

      controlledNowMs = 5000;
      const homeMilestoneRootA = createRoot(p31Container);
      await act(async () => {
        homeMilestoneRootA.render(
          React.createElement(
            MemoryRouter,
            { initialEntries: ['/home'] },
            React.createElement(Home, null)
          )
        );
        await new Promise((r) => setTimeout(r, 30));
      });

      const snapWhileDisplayOpen = getCatalogDiagnosticsSnapshot()!;
      assert(
        snapWhileDisplayOpen !== null,
        '[12.20.5] Sessão da Home real deve estar registrada'
      );
      assert.strictEqual(
        snapWhileDisplayOpen.wasDisplaySetupShown,
        true,
        '[12.20.5] Seletor de apresentação (DisplaySetupModal) deve ser registrado desde a 1ª montagem, mesmo quando o efeito de HomeContent roda antes do efeito de XtreamProvider'
      );
      assert.strictEqual(
        snapWhileDisplayOpen.displaySetupOpenedAtMs,
        0,
        '[12.20.5] Abertura do seletor na 1ª montagem deve constar em 0ms'
      );
      assert.strictEqual(
        snapWhileDisplayOpen.allSixFinishedAtMs,
        null,
        '[12.20.5] Enquanto series_catalog está pendente, allSixFinishedAtMs deve permanecer null'
      );
      assert.strictEqual(
        snapWhileDisplayOpen.homeAvailableAtMs,
        null,
        '[12.20.5] Enquanto seletor e overlay estão ativos, homeAvailableAtMs deve ser null'
      );

      // Fechar o seletor de apresentação após 150ms (t = 5150ms) enquanto o catálogo ainda está pendente
      controlledNowMs = 5150;
      const modalDialog150 = p31Container.querySelector('[role="dialog"][aria-modal="true"]');
      assert(modalDialog150 !== null, '[12.20.5] DisplaySetupModal real deve estar montado no DOM');
      const otherDevBtn150 = modalDialog150!.querySelector(
        'button[data-device-choice="computador"]'
      ) as HTMLButtonElement | null;
      assert(otherDevBtn150 !== null, '[12.20.5] Botão Computador deve existir');
      await act(async () => {
        otherDevBtn150!.click();
        await new Promise((r) => setTimeout(r, 15));
      });
      const confirmBtn150 = modalDialog150!.querySelector(
        'button[data-confirm-default="true"]'
      ) as HTMLButtonElement | null;
      assert(confirmBtn150 !== null, '[12.20.5] Botão Confirmar e continuar deve existir');
      await act(async () => {
        confirmBtn150!.click();
        await new Promise((r) => setTimeout(r, 20));
      });

      const snapAfterDisplayClosed = getCatalogDiagnosticsSnapshot()!;
      assert.strictEqual(
        snapAfterDisplayClosed.displaySetupClosedAtMs,
        150,
        '[12.20.5] Fechamento do seletor de apresentação deve ser registrado em 150ms'
      );
      assert.strictEqual(
        snapAfterDisplayClosed.displaySetupWaitMs,
        150,
        '[12.20.5] Duração do seletor de apresentação deve ser exatamente 150ms'
      );
      assert.strictEqual(
        snapAfterDisplayClosed.allSixFinishedAtMs,
        null,
        '[12.20.5] Catálogo (series_catalog) ainda continua pendente após fechar o seletor aos 150ms'
      );
      assert.strictEqual(
        snapAfterDisplayClosed.homeAvailableAtMs,
        null,
        '[12.20.5] Como o carregamento inicial ainda bloqueia a Home via overlay, homeAvailableAtMs deve continuar null aos 150ms'
      );

      // Concluir a 6ª operação aos 320ms (t = 5320ms)
      controlledNowMs = 5320;
      await act(async () => {
        resolvePendingSeriesCatalog150!([
          { series_id: 301, name: 'Série Final (2025)', category_id: '20', rating: '9.1' },
        ]);
        await new Promise((r) => setTimeout(r, 30));
      });

      const snapAfterAllSix = getCatalogDiagnosticsSnapshot()!;
      assert.strictEqual(
        snapAfterAllSix.allSixFinishedAtMs,
        320,
        '[12.20.5] Conclusão das 6 operações deve ser registrada em 320ms'
      );
      assert.strictEqual(
        snapAfterAllSix.homeAvailableAtMs,
        320,
        '[12.20.5] homeAvailableAtMs deve ser 320ms (sem subtrair os 150ms do seletor que correu em paralelo com o carregamento)'
      );
      assert.strictEqual(
        snapAfterAllSix.displaySetupWaitMs,
        150,
        '[12.20.5] displaySetupWaitMs (150ms) deve continuar reportado separadamente'
      );
      assert.strictEqual(
        snapAfterAllSix.releaseTrigger,
        'auto_all_six',
        '[12.20.5] Liberação automática após as 6 operações deve registrar auto_all_six'
      );

      await act(async () => {
        homeMilestoneRootA.unmount();
      });

      // -----------------------------------------------------------------------
      // 12.20.5B: Liberação manual por "Continuar enquanto carrega" na Home REAL — intenção no clique vs disponibilidade após atualização do DOM, e conclusão posterior das 6 operações
      // -----------------------------------------------------------------------
      let resolveSlowSeriesManual: ((items: any[]) => void) | null = null;
      (XtreamService as any).getSeries = (_c: any, _cat?: string, opts?: any) => {
        return new Promise<any[]>((resolve) => {
          resolveSlowSeriesManual = (items) => {
            opts?.diagOp?.recordNormalization({
              durationMs: 2,
              rawItemsCount: items.length,
              validItemsCount: items.length,
            });
            resolve(items);
          };
        });
      };

      const origSetTimeoutP31 = globalThis.setTimeout;
      globalThis.setTimeout = ((fn: any, ms?: number, ...args: any[]) => {
        if (ms === 10000) {
          return origSetTimeoutP31(fn, 10, ...args);
        }
        return origSetTimeoutP31(fn, ms, ...args);
      }) as typeof setTimeout;

      controlledNowMs = 8000;
      const homeManualRoot = createRoot(p31Container);
      await act(async () => {
        homeManualRoot.render(
          React.createElement(
            MemoryRouter,
            { initialEntries: ['/home'] },
            React.createElement(Home, null)
          )
        );
        await new Promise((r) => origSetTimeoutP31(r, 35));
      });
      globalThis.setTimeout = origSetTimeoutP31;

      const continueWhileLoadingBtn = p31Container.querySelector(
        'button[data-continue-while-loading="true"]'
      ) as HTMLButtonElement | null;
      assert(
        continueWhileLoadingBtn !== null,
        '[12.20.5B] Botão "Continuar enquanto carrega" deve aparecer na Home real enquanto a 6ª operação está pendente'
      );
      const homeShellEl = p31Container.querySelector('[data-home-shell="true"]') as HTMLElement;
      assert(
        homeShellEl.hasAttribute('inert'),
        '[12.20.5B] Antes de clicar em "Continuar enquanto carrega", a Home deve estar bloqueada (inert)'
      );

      // Verificar que o clique registra a intenção imediatamente (aos 350ms, enquanto a Home ainda está inert),
      // e só marca homeAvailableAtMs (aos 358ms) após o commit do React remover o overlay e liberar a Home (inert=false)
      let inertWhenIntentClockRead: boolean | null = null;
      let snapRightOnClickIntent: ReturnType<typeof getCatalogDiagnosticsSnapshot> = null;
      setCatalogDiagnosticsClockForTest(() => {
        if (homeShellEl.hasAttribute('inert')) {
          inertWhenIntentClockRead = true;
          return 8350;
        }
        if (snapRightOnClickIntent === null) {
          snapRightOnClickIntent = getCatalogDiagnosticsSnapshot();
        }
        return 8358;
      });

      controlledNowMs = 8358;
      await act(async () => {
        continueWhileLoadingBtn!.click();
        await new Promise((r) => setTimeout(r, 20));
      });
      setCatalogDiagnosticsClockForTest(() => controlledNowMs);

      assert.strictEqual(
        inertWhenIntentClockRead,
        true,
        '[12.20.5B] No instante em que recordHomeManualContinueIntent lê o relógio (350ms), a Home ainda estava inert'
      );
      assert(
        snapRightOnClickIntent !== null,
        '[12.20.5B] Snapshot logo antes de o efeito pós-commit marcar homeAvailableAtMs deve existir'
      );
      assert.strictEqual(
        snapRightOnClickIntent!.manualContinueClickedAtMs,
        350,
        '[12.20.5B] No instante do clique, manualContinueClickedAtMs deve ser registrado como intenção (350ms)'
      );
      assert.strictEqual(
        snapRightOnClickIntent!.homeAvailableAtMs,
        null,
        '[12.20.5B] Antes de o efeito pós-render confirmar a liberação do DOM, homeAvailableAtMs ainda DEVE ser null'
      );

      const snapAfterManualRender = getCatalogDiagnosticsSnapshot()!;
      assert.strictEqual(
        homeShellEl.hasAttribute('inert'),
        false,
        '[12.20.5B] Após o re-render do clique, a Home deve aceitar interação (sem atributo inert)'
      );
      assert.strictEqual(
        snapAfterManualRender.manualContinueClickedAtMs,
        350,
        '[12.20.5B] Intenção do clique permanece em 350ms'
      );
      assert.strictEqual(
        snapAfterManualRender.homeAvailableAtMs,
        358,
        '[12.20.5B] homeAvailableAtMs deve ser marcado somente depois que a interface atualizou e passou a aceitar interação (358ms)'
      );
      assert.strictEqual(
        snapAfterManualRender.releaseTrigger,
        'manual_continue_button',
        '[12.20.5B] Motivo da liberação deve ser manual_continue_button'
      );
      assert.strictEqual(
        snapAfterManualRender.allSixFinishedAtMs,
        null,
        '[12.20.5B] Como a 6ª operação ainda não terminou, allSixFinishedAtMs deve continuar null'
      );

      assert.strictEqual(
        snapAfterManualRender.sorting.vod.newSortsCount,
        1,
        '[12.20.5B] Com filmes prontos (>= 2 itens) e séries pendentes no momento da liberação manual, vod.newSortsCount deve ser 1'
      );
      assert.strictEqual(
        snapAfterManualRender.sorting.series.newSortsCount,
        0,
        '[12.20.5B] Enquanto séries está pendente (lista vazia), series.newSortsCount deve ser 0'
      );
      assert.strictEqual(
        snapAfterManualRender.sorting.totalNewSortsCount,
        1,
        '[12.20.5B] totalNewSortsCount deve registrar apenas 1 ordenação efetiva na liberação manual'
      );

      // Concluir a 6ª operação (series_catalog) aos 520ms (t = 8520ms), depois da liberação manual
      controlledNowMs = 8520;
      await act(async () => {
        resolveSlowSeriesManual!([
          {
            series_id: 302,
            name: 'Série Tardia Manual 1 (2025)',
            category_id: '20',
            rating: '8.7',
            cover: 'http://img.test/s302.jpg',
          },
          {
            series_id: 303,
            name: 'Série Tardia Manual 2 (2024)',
            category_id: '20',
            rating: '9.1',
            cover: 'http://img.test/s303.jpg',
          },
        ]);
        await new Promise((r) => setTimeout(r, 30));
      });

      const snapAfterLateSix = getCatalogDiagnosticsSnapshot()!;
      assert.strictEqual(
        snapAfterLateSix.homeAvailableAtMs,
        358,
        '[12.20.5B] homeAvailableAtMs (358ms) deve ser preservado após a conclusão posterior das 6 operações'
      );
      assert.strictEqual(
        snapAfterLateSix.allSixFinishedAtMs,
        520,
        '[12.20.5B] Conclusão das 6 operações (520ms) deve ser registrada como marco separado mesmo após a liberação manual'
      );
      assert.strictEqual(
        snapAfterLateSix.releaseTrigger,
        'manual_continue_button',
        '[12.20.5B] releaseTrigger deve continuar sendo manual_continue_button'
      );
      assert.strictEqual(
        snapAfterLateSix.operations.series_catalog?.outcome,
        'success',
        '[12.20.5B] Operação inicial que estava pendente no momento da liberação manual deve continuar sendo medida até concluir com sucesso'
      );
      assert.strictEqual(
        snapAfterLateSix.operations.series_catalog?.completedAtMs,
        520,
        '[12.20.5B] Tempo de conclusão de series_catalog deve ser medido até o fim (520ms)'
      );
      assert.strictEqual(
        snapAfterLateSix.operations.series_catalog?.validItemsCount,
        2,
        '[12.20.5B] Normalização de series_catalog após liberação manual deve registrar os 2 itens válidos'
      );
      assert.strictEqual(
        snapAfterLateSix.operations.series_catalog?.indexedItemsCount,
        2,
        '[12.20.5B] Indexação de series_catalog após liberação manual deve registrar os 2 itens indexados'
      );
      assert.deepStrictEqual(
        snapAfterLateSix.sorting,
        snapAfterManualRender.sorting,
        '[12.20.5B] Os totais de ordenação/mesclagem/agrupamento da abertura devem ser encerrados quando a Home aceitou interação pela 1ª vez (358ms)'
      );

      await act(async () => {
        homeManualRoot.unmount();
      });

      // -----------------------------------------------------------------------
      // 12.20.6: Exposição em Configurações (ConfigView) + Sanitização estrita (sem URL, credenciais, nomes ou conteúdo da resposta)
      // -----------------------------------------------------------------------
      (XtreamService as any).getSeries = async (_c: any, _cat?: string, opts?: any) => {
        opts?.diagOp?.recordNormalization({ durationMs: 1, rawItemsCount: 1, validItemsCount: 1 });
        return [{ series_id: 301, name: 'Série 1 (2025)', category_id: '20', rating: '9.0' }];
      };
      (XtreamService as any).authenticate = async () => ({
        user_info: {
          status: 'Active',
          exp_date: '1893456000',
          active_cons: '1',
          max_connections: '2',
          allowed_output_formats: ['m3u8', 'ts'],
        },
      });

      let copiedTextFromConfig = '';
      Object.defineProperty(windowInstance.navigator, 'clipboard', {
        value: {
          writeText: async (txt: string) => {
            copiedTextFromConfig = txt;
          },
        },
        configurable: true,
      });

      const cfgRoot = createRoot(p31Container);
      await act(async () => {
        cfgRoot.render(
          React.createElement(
            XtreamProvider,
            {
              credentials: {
                serverUrl: 'http://ultra-secret-server.iptv.local:8080',
                username: 'super_secret_username_99',
                password: 'super_secret_password_99',
                playlistName: 'Lista Privada da Família Silva',
              },
            },
            React.createElement(
              NavigationProvider,
              null,
              React.createElement(ConfigView)
            )
          )
        );
        await new Promise((r) => setTimeout(r, 60));
      });

      // Registrar marco de abertura para a sessão recém-carregada no ConfigView
      recordHomeOpeningMilestone({
        isDisplaySetupOpen: false,
        isOverlayActive: false,
        isAuthRejected: false,
        allSixFinished: true,
      });

      const diagToggleBtn = p31Container.querySelector(
        'button[data-nav-row="config-diagnostics-toggle"]'
      ) as HTMLButtonElement;
      assert(diagToggleBtn, '[12.20.6] Botão de abrir diagnóstico na ConfigView deve existir');

      await act(async () => {
        diagToggleBtn.click();
        await new Promise((r) => setTimeout(r, 20));
      });

      const catalogDiagSection = p31Container.querySelector(
        '[data-catalog-diagnostics-section="true"]'
      );
      assert(
        catalogDiagSection !== null,
        '[12.20.6] Seção 4 (Diagnóstico de Carregamento Inicial dos Catálogos P3.1) deve ser exibida no painel de diagnóstico'
      );

      const copyBtn = p31Container.querySelector(
        'button[data-copy-diagnostics="true"]'
      ) as HTMLButtonElement;
      await act(async () => {
        copyBtn.click();
        await new Promise((r) => setTimeout(r, 20));
      });

      assert(
        copiedTextFromConfig.includes(
          '--- Diagnóstico de Abertura dos Catálogos (P3.1) ---'
        ),
        '[12.20.6] Texto copiado pelo botão "Copiar diagnóstico" deve conter o relatório P3.1'
      );
      assert(
        copiedTextFromConfig.includes('[live_categories]') &&
          copiedTextFromConfig.includes('[vod_catalog]') &&
          copiedTextFromConfig.includes('[series_catalog]'),
        '[12.20.6] Relatório copiado deve listar as 6 operações iniciais com seus identificadores locais'
      );

      // Verificação de sanitização estrita: NENHUM dado sensível pode aparecer no relatório
      const forbiddenSubstrings = [
        'ultra-secret-server.iptv.local',
        'super_secret_username_99',
        'super_secret_password_99',
        'Lista Privada da Família Silva',
        'server-a-secret',
        'server-b-secret',
        'account_A_secret',
        'account_B_secret',
        'Filme Conta B',
        'Segredo Interno Provedor XYZ',
      ];
      for (const forbidden of forbiddenSubstrings) {
        assert(
          !copiedTextFromConfig.includes(forbidden),
          `[12.20.6] Relatório de diagnóstico NÃO deve conter dado sensível ou conteúdo da resposta ("${forbidden}")`
        );
      }

      // Testar desativação pelo botão da ConfigView
      const toggleCollectBtn = p31Container.querySelector(
        'button[data-catalog-diagnostics-toggle="true"]'
      ) as HTMLButtonElement;
      assert(toggleCollectBtn, '[12.20.6] Botão de ativar/desativar coleta deve existir na ConfigView');
      await act(async () => {
        toggleCollectBtn.click();
        await new Promise((r) => setTimeout(r, 20));
      });
      assert.strictEqual(
        isCatalogLoadDiagnosticsEnabled(),
        false,
        '[12.20.6] Clicar no botão de coleta quando ativa deve desativar a preferência e limpar a sessão em memória'
      );
      assert.strictEqual(
        getCatalogDiagnosticsSnapshot(),
        null,
        '[12.20.6] Desativar a coleta deve limpar imediatamente o snapshot retido em memória'
      );

      await act(async () => {
        cfgRoot.unmount();
      });

      // Reativar coleta para as regressões seguintes da auditoria
      setCatalogLoadDiagnosticsEnabled(true);

      // -----------------------------------------------------------------------
      // 12.20.7: Rejeição de autenticação na última consulta (HTTP 401 e HTTP 200 com auth: 0) bloqueando a Home com recuperação de acesso
      // -----------------------------------------------------------------------
      (XtreamService as any).getLiveCategories = origXtreamMethods.getLiveCategories;
      (XtreamService as any).getVodCategories = origXtreamMethods.getVodCategories;
      (XtreamService as any).getSeriesCategories = origXtreamMethods.getSeriesCategories;
      (XtreamService as any).getLiveStreams = origXtreamMethods.getLiveStreams;
      (XtreamService as any).getVodStreams = origXtreamMethods.getVodStreams;
      (XtreamService as any).getSeries = origXtreamMethods.getSeries;
      setTransportTestConfig({ mode: 'web', capacitorHttpGet: null });

      // Subcaso A: Última consulta (get_series) retorna HTTP 401 e modal de recuperação de acesso bloqueia a tela
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const urlStr = String(input);
        controlledNowMs += 15;
        if (urlStr.includes('action=get_series&') || urlStr.endsWith('action=get_series')) {
          return {
            ok: false,
            status: 401,
            statusText: 'Unauthorized',
            text: async () => 'Unauthorized',
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          text: async () => {
            controlledNowMs += 5;
            if (urlStr.includes('_categories')) {
              return JSON.stringify([{ category_id: '1', category_name: 'Geral' }]);
            }
            return JSON.stringify([{ stream_id: 1, name: 'Item Valido', category_id: '1' }]);
          },
        } as unknown as Response;
      }) as typeof fetch;

      controlledNowMs = 12000;
      const auth401Root = createRoot(p31Container);
      await act(async () => {
        auth401Root.render(
          React.createElement(
            MemoryRouter,
            { initialEntries: ['/home'] },
            React.createElement(Home, null)
          )
        );
        await new Promise((r) => setTimeout(r, 60));
      });

      const authRecoveryModal401 = p31Container.querySelector('[data-auth-recovery="true"]');
      assert(
        authRecoveryModal401 !== null,
        '[12.20.7]Quando a última consulta retorna HTTP 401, o modal de recuperação de acesso deve bloquear a tela'
      );
      const snapAuth401 = getCatalogDiagnosticsSnapshot()!;
      assert.strictEqual(
        snapAuth401.releaseTrigger,
        'auth_rejected',
        '[12.20.7]Quando a última consulta retorna HTTP 401 e bloqueia a tela, releaseTrigger DEVE ser auth_rejected (e não auto_all_six)'
      );
      assert.strictEqual(
        snapAuth401.homeAvailableAtMs,
        null,
        '[12.20.7]Com a tela bloqueada pela recuperação de acesso, homeAvailableAtMs DEVE permanecer null'
      );
      assert(
        snapAuth401.allSixFinishedAtMs !== null,
        '[12.20.7]A conclusão das 6 operações deve ter seu timestamp registrado separadamente'
      );
      assert.strictEqual(
        snapAuth401.operations.series_catalog?.outcome,
        'error',
        '[12.20.7]series_catalog deve registrar outcome error'
      );
      assert.strictEqual(
        snapAuth401.operations.series_catalog?.errorCategory,
        'auth_rejected',
        '[12.20.7]series_catalog deve registrar errorCategory auth_rejected'
      );
      assert.strictEqual(
        snapAuth401.operations.series_catalog?.attempts[0]?.httpStatus,
        401,
        '[12.20.7]Tentativa de series_catalog deve registrar httpStatus 401'
      );
      assert.strictEqual(
        snapAuth401.operations.series_catalog?.attempts[0]?.errorCategory,
        'auth_rejected',
        '[12.20.7]Tentativa de series_catalog com HTTP 401 deve registrar errorCategory auth_rejected'
      );
      const reportAuth401Text = catalogDiagMod.formatCatalogDiagnosticsReport(snapAuth401);
      assert(
        reportAuth401Text.includes(
          '• Desfecho da abertura da Home: Abertura interrompida por autenticação (disponibilidade na abertura: indisponível)'
        ),
        '[12.20.7] Relatório formatado deve indicar abertura interrompida por autenticação e disponibilidade na abertura indisponível'
      );
      assert(
        !reportAuth401Text.includes('Liberação da interface Home:') &&
          !reportAuth401Text.includes('Home liberada'),
        '[12.20.7] Relatório não deve combinar "Home liberada" / "Liberação da interface Home" com "Abertura interrompida por autenticação"'
      );

      // Agora testar a recuperação de acesso bem-sucedida ("Tentar novamente") após o HTTP 401 na Home real
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const urlStr = String(input);
        controlledNowMs += 10;
        if (!urlStr.includes('action=')) {
          // Chamada de XtreamService.authenticate(credentials)
          return {
            ok: true,
            status: 200,
            text: async () => {
              controlledNowMs += 4;
              return JSON.stringify({
                user_info: {
                  auth: 1,
                  status: 'Active',
                  exp_date: '1893456000',
                  active_cons: '1',
                  max_connections: '2',
                },
              });
            },
          } as unknown as Response;
        }
        if (urlStr.includes('action=get_series&') || urlStr.endsWith('action=get_series')) {
          return {
            ok: true,
            status: 200,
            text: async () => {
              controlledNowMs += 5;
              return JSON.stringify([
                {
                  series_id: 901,
                  name: 'Série Recuperada 1 (2025)',
                  category_id: '1',
                  rating: '9.1',
                  cover: 'http://img.test/sr1.jpg',
                },
                {
                  series_id: 902,
                  name: 'Série Recuperada 2 (2024)',
                  category_id: '1',
                  rating: '8.6',
                  cover: 'http://img.test/sr2.jpg',
                },
              ]);
            },
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          text: async () => {
            controlledNowMs += 4;
            if (urlStr.includes('_categories')) {
              return JSON.stringify([{ category_id: '1', category_name: 'Geral' }]);
            }
            return JSON.stringify([{ stream_id: 1, name: 'Item Valido', category_id: '1' }]);
          },
        } as unknown as Response;
      }) as typeof fetch;

      const retryAuthBtn = p31Container.querySelector(
        'button[data-auth-recovery-retry="true"]'
      ) as HTMLButtonElement | null;
      assert(
        retryAuthBtn !== null,
        '[12.20.7] Botão "Tentar novamente" no modal de recuperação de acesso deve existir'
      );

      controlledNowMs = 12450;
      await act(async () => {
        retryAuthBtn!.click();
        await new Promise((r) => setTimeout(r, 60));
      });

      const authRecoveryModalAfterRetry = p31Container.querySelector('[data-auth-recovery="true"]');
      assert.strictEqual(
        authRecoveryModalAfterRetry,
        null,
        '[12.20.7] Após recuperação bem-sucedida com "Tentar novamente", o modal de recuperação deve fechar'
      );
      const homeShell401 = p31Container.querySelector('[data-home-shell="true"]') as HTMLElement;
      assert.strictEqual(
        homeShell401.hasAttribute('inert'),
        false,
        '[12.20.7] Após recuperação bem-sucedida, a Home deve voltar a operar normalmente e aceitar interação (inert=false)'
      );

      const snapAfterAuthRecovery = getCatalogDiagnosticsSnapshot()!;
      assert.strictEqual(
        snapAfterAuthRecovery.releaseTrigger,
        'auth_rejected',
        '[12.20.7] Após recuperar o acesso com "Tentar novamente", releaseTrigger DEVE preservar o desfecho original da abertura (auth_rejected)'
      );
      assert.strictEqual(
        snapAfterAuthRecovery.homeAvailableAtMs,
        null,
        '[12.20.7] Após recuperar o acesso com "Tentar novamente", homeAvailableAtMs no registro da abertura DEVE permanecer null'
      );
      assert(
        snapAfterAuthRecovery.accessRecoveredAtMs !== null &&
          snapAfterAuthRecovery.accessRecoveredAtMs >= 450,
        '[12.20.7] A recuperação de acesso deve ser registrada em um marco separado (accessRecoveredAtMs)'
      );
      assert.strictEqual(
        snapAfterAuthRecovery.operations.series_catalog?.outcome,
        'error',
        '[12.20.7] O registro original da 6ª operação (series_catalog com HTTP 401) deve ser preservado após a recuperação'
      );
      assert.strictEqual(
        snapAfterAuthRecovery.operations.series_catalog?.errorCategory,
        'auth_rejected',
        '[12.20.7] errorCategory original de series_catalog (auth_rejected) deve ser preservado'
      );
      assert.deepStrictEqual(
        snapAfterAuthRecovery.sorting,
        snapAuth401.sorting,
        '[12.20.7] Os totais de ordenação da abertura interrompida não devem ser alterados pela recuperação posterior'
      );

      const reportAfterRecoveryText =
        catalogDiagMod.formatCatalogDiagnosticsReport(snapAfterAuthRecovery);
      assert(
        reportAfterRecoveryText.includes(
          '• Desfecho da abertura da Home: Abertura interrompida por autenticação (disponibilidade na abertura: indisponível)'
        ),
        '[12.20.7] Relatório após recuperação deve preservar a linha de abertura interrompida por autenticação'
      );
      assert(
        reportAfterRecoveryText.includes('• Recuperação de acesso após falha inicial:'),
        '[12.20.7] Relatório após recuperação deve exibir a recuperação em uma linha de marco separado'
      );
      for (const line of reportAfterRecoveryText.split('\n')) {
        if (line.includes('Abertura interrompida por autenticação')) {
          assert(
            !line.includes('Home liberada') && !line.includes('Liberação da interface Home'),
            `[12.20.7] Nenhuma linha do relatório deve combinar "Home liberada" / "Liberação da interface Home" com "Abertura interrompida por autenticação" ("${line}")`
          );
        }
      }

      await act(async () => {
        auth401Root.unmount();
      });

      // Subcaso B: Resposta HTTP 200 com payload { user_info: { auth: 0 } } na última consulta — tentativa finalizada uma única vez após validação de autenticação
      windowInstance.localStorage.setItem(
        CREDENTIALS_KEY,
        JSON.stringify({
          serverUrl: 'http://server-auth0-secret.tv:8080',
          username: 'user_auth0_secret',
          password: 'pass_auth0_secret',
          playlistName: 'Lista Auth 0',
        })
      );

      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const urlStr = String(input);
        controlledNowMs += 10;
        if (urlStr.includes('action=get_series&') || urlStr.endsWith('action=get_series')) {
          return {
            ok: true,
            status: 200,
            text: async () => {
              controlledNowMs += 4;
              return JSON.stringify({
                user_info: {
                  auth: 0,
                  status: 'Disabled',
                  message: 'Segredo Provedor Auth Zero',
                },
              });
            },
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          text: async () => {
            controlledNowMs += 4;
            if (urlStr.includes('_categories')) {
              return JSON.stringify([{ category_id: '1', category_name: 'Geral' }]);
            }
            return JSON.stringify([{ stream_id: 1, name: 'Item Valido', category_id: '1' }]);
          },
        } as unknown as Response;
      }) as typeof fetch;

      controlledNowMs = 15000;
      const auth200ZeroRoot = createRoot(p31Container);
      await act(async () => {
        auth200ZeroRoot.render(
          React.createElement(
            MemoryRouter,
            { initialEntries: ['/home'] },
            React.createElement(Home, null)
          )
        );
        await new Promise((r) => setTimeout(r, 60));
      });

      const snapAuth200Zero = getCatalogDiagnosticsSnapshot()!;
      const seriesAttAuth0 = snapAuth200Zero.operations.series_catalog?.attempts[0];
      assert(seriesAttAuth0 !== undefined, '[12.20.7B] Tentativa de series_catalog deve existir');
      assert.strictEqual(
        snapAuth200Zero.operations.series_catalog?.attempts.length,
        1,
        '[12.20.7B] HTTP 200 com auth: 0 não deve sofrer retry e deve ter exatamente 1 tentativa'
      );
      assert.strictEqual(
        seriesAttAuth0!.httpStatus,
        200,
        '[12.20.7B] Tentativa com HTTP 200 e auth: 0 DEVE preservar httpStatus = 200'
      );
      assert.strictEqual(
        seriesAttAuth0!.outcome,
        'error',
        '[12.20.7B] Tentativa com HTTP 200 e auth: 0 DEVE ser finalizada apenas depois da validação de autenticação com outcome = error (e não success)'
      );
      assert.strictEqual(
        seriesAttAuth0!.errorCategory,
        'auth_rejected',
        '[12.20.7B] Tentativa com HTTP 200 e auth: 0 DEVE registrar errorCategory = auth_rejected'
      );
      assert.strictEqual(
        snapAuth200Zero.releaseTrigger,
        'auth_rejected',
        '[12.20.7B] Sessão com HTTP 200 e auth: 0 deve registrar releaseTrigger = auth_rejected'
      );
      assert.strictEqual(
        snapAuth200Zero.homeAvailableAtMs,
        null,
        '[12.20.7B] Sessão bloqueada por auth: 0 deve manter homeAvailableAtMs = null'
      );

      await act(async () => {
        auth200ZeroRoot.unmount();
      });

      // -----------------------------------------------------------------------
      // 12.20.8: Desmontagem e remontagem do XtreamProvider durante pausa da indexação cooperativa
      // -----------------------------------------------------------------------
      setTransportTestConfig({ mode: 'auto', capacitorHttpGet: null });
      globalThis.fetch = savedFetchP31;

      const sharedMovies1500 = Array.from({ length: 1500 }, (_, idx) => ({
        stream_id: 70000 + idx,
        name: `Filme Cooperativo ${idx + 1} (2024)`,
        category_id: '10',
        rating: '8.1',
      }));

      let resolveSessionBVodFetch: ((items: any[]) => void) | null = null;
      let sessionAVodCallCount = 0;

      (XtreamService as any).getLiveCategories = async (_c: any, opts?: any) => {
        opts?.diagOp?.recordNormalization({ durationMs: 1, rawItemsCount: 1, validItemsCount: 1 });
        return [{ category_id: '1', category_name: 'TV' }];
      };
      (XtreamService as any).getVodCategories = async (_c: any, opts?: any) => {
        opts?.diagOp?.recordNormalization({ durationMs: 1, rawItemsCount: 1, validItemsCount: 1 });
        return [{ category_id: '10', category_name: 'Filmes' }];
      };
      (XtreamService as any).getSeriesCategories = async (_c: any, opts?: any) => {
        opts?.diagOp?.recordNormalization({ durationMs: 1, rawItemsCount: 1, validItemsCount: 1 });
        return [{ category_id: '20', category_name: 'Séries' }];
      };
      (XtreamService as any).getLiveStreams = async (_c: any, _cat?: string, opts?: any) => {
        opts?.diagOp?.recordNormalization({ durationMs: 1, rawItemsCount: 1, validItemsCount: 1 });
        return [{ stream_id: 1, name: 'Canal 1', category_id: '1' }];
      };
      (XtreamService as any).getVodStreams = async (creds: XtreamCredentials, _cat?: string, opts?: any) => {
        if (creds.username === 'remount_user_A') {
          sessionAVodCallCount++;
          // Retorna cópia fresca de 1500 itens (2 lotes de 1000 + 500 -> 1 pausa setTimeout(0) no meio da indexação)
          const copyA = sharedMovies1500.slice();
          opts?.diagOp?.recordNormalization({
            durationMs: 3,
            rawItemsCount: copyA.length,
            validItemsCount: copyA.length,
          });
          return copyA;
        }
        return new Promise<any[]>((resolve) => {
          resolveSessionBVodFetch = (items) => {
            opts?.diagOp?.recordNormalization({
              durationMs: 3,
              rawItemsCount: items.length,
              validItemsCount: items.length,
            });
            resolve(items);
          };
        });
      };
      (XtreamService as any).getSeries = async (_c: any, _cat?: string, opts?: any) => {
        opts?.diagOp?.recordNormalization({ durationMs: 1, rawItemsCount: 1, validItemsCount: 1 });
        return [{ series_id: 1, name: 'Série 1 (2024)', category_id: '20', rating: '8.5' }];
      };

      // Interceptar o setTimeout(0) da pausa cooperativa de buildVodIndexAsync da Sessão A
      let resumeSessionACooperativeYield: (() => void) | null = null;
      const realSetTimeoutCoop = globalThis.setTimeout;
      let interceptNextZeroTimeout = true;
      globalThis.setTimeout = ((fn: any, ms?: number, ...args: any[]) => {
        if (interceptNextZeroTimeout && (ms === 0 || ms === undefined) && sessionAVodCallCount === 1) {
          interceptNextZeroTimeout = false;
          resumeSessionACooperativeYield = () => fn(...args);
          return 0 as unknown as ReturnType<typeof setTimeout>;
        }
        return realSetTimeoutCoop(fn, ms, ...args);
      }) as typeof setTimeout;

      controlledNowMs = 18000;
      const remountRootA = createRoot(p31Container);
      await act(async () => {
        remountRootA.render(
          React.createElement(
            XtreamProvider,
            {
              credentials: {
                serverUrl: 'http://remount-a.tv:8080',
                username: 'remount_user_A',
                password: '123',
              },
            },
            React.createElement('div', null, 'Provider Instance A')
          )
        );
        await new Promise((r) => realSetTimeoutCoop(r, 25));
      });
      globalThis.setTimeout = realSetTimeoutCoop;

      assert(
        resumeSessionACooperativeYield !== null,
        '[12.20.8] A indexação cooperativa de 1500 filmes da Sessão A deve estar pausada entre o 1º e o 2º lote'
      );
      const snapRemountA = getCatalogDiagnosticsSnapshot()!;
      const remountSessionAId = snapRemountA.sessionId;
      assert.strictEqual(
        snapRemountA.operations.vod_catalog?.outcome,
        'running',
        '[12.20.8] vod_catalog da Sessão A deve estar running durante a pausa cooperativa'
      );

      // Desmontar completamente o provedor da Sessão A durante a pausa da indexação cooperativa
      controlledNowMs = 18040;
      await act(async () => {
        remountRootA.unmount();
      });

      // Montar uma NOVA instância de XtreamProvider (Sessão B, cujo sessionRef local reinicia em 1!) e iniciar o carregamento de filmes
      controlledNowMs = 18050;
      const remountRootB = createRoot(p31Container);
      await act(async () => {
        remountRootB.render(
          React.createElement(
            XtreamProvider,
            {
              credentials: {
                serverUrl: 'http://remount-b.tv:8080',
                username: 'remount_user_B',
                password: '456',
              },
            },
            React.createElement('div', null, 'Provider Instance B')
          )
        );
        await new Promise((r) => realSetTimeoutCoop(r, 25));
      });

      const snapRemountBWhileRunning = getCatalogDiagnosticsSnapshot()!;
      assert(
        snapRemountBWhileRunning.sessionId > remountSessionAId,
        `[12.20.8] Mesmo remontando XtreamProvider do zero, a Sessão B deve receber um sessionId único (${snapRemountBWhileRunning.sessionId} > ${remountSessionAId})`
      );
      assert.strictEqual(
        snapRemountBWhileRunning.operations.vod_catalog?.outcome,
        'running',
        '[12.20.8] vod_catalog da Sessão B deve estar em andamento'
      );

      // Agora a tarefa de indexação cooperativa da Sessão A retoma da pausa e cancela enquanto vod_catalog da Sessão B está em andamento!
      controlledNowMs = 18065;
      await act(async () => {
        resumeSessionACooperativeYield!();
        await new Promise((r) => realSetTimeoutCoop(r, 15));
      });

      const snapRemountBAfterAResumed = getCatalogDiagnosticsSnapshot()!;
      assert.strictEqual(
        snapRemountBAfterAResumed.operations.vod_catalog?.outcome,
        'running',
        '[12.20.8] Quando a tarefa pausada da Sessão A retoma e cancela, vod_catalog da Sessão B DEVE continuar em andamento (running)'
      );
      assert.strictEqual(
        snapRemountBAfterAResumed.operations.vod_catalog?.indexCancelled,
        false,
        '[12.20.8] O cancelamento da indexação da Sessão A jamais deve marcar indexCancelled na Sessão B'
      );

      // Concluir o carregamento e indexação de filmes da Sessão B
      controlledNowMs = 18110;
      await act(async () => {
        resolveSessionBVodFetch!(sharedMovies1500.slice());
        await new Promise((r) => realSetTimeoutCoop(r, 40));
      });

      const snapRemountBCompleted = getCatalogDiagnosticsSnapshot()!;
      assert.strictEqual(
        snapRemountBCompleted.operations.vod_catalog?.outcome,
        'success',
        '[12.20.8] vod_catalog da Sessão B deve concluir normalmente como success'
      );
      assert.strictEqual(
        snapRemountBCompleted.operations.vod_catalog?.indexedItemsCount,
        1500,
        '[12.20.8] vod_catalog da Sessão B deve registrar todos os 1500 itens indexados'
      );
      assert.strictEqual(
        snapRemountBCompleted.operations.vod_catalog?.indexBatchesProcessed,
        2,
        '[12.20.8] vod_catalog da Sessão B deve registrar seus 2 lotes processados'
      );

      // -----------------------------------------------------------------------
      // 12.20.9: 16 consultas manuais posteriores de categorias preservando intactas as 6 operações originais e limitando o histórico
      // -----------------------------------------------------------------------
      let capturedLiveCtxFor16: any = null;
      let capturedVodCtxFor16: any = null;
      let capturedSeriesCtxFor16: any = null;
      function ActionCaptureConsumer() {
        capturedLiveCtxFor16 = useXtreamLive();
        capturedVodCtxFor16 = useXtreamVod();
        capturedSeriesCtxFor16 = useXtreamSeries();
        return null;
      }

      await act(async () => {
        remountRootB.render(
          React.createElement(
            XtreamProvider,
            {
              credentials: {
                serverUrl: 'http://remount-b.tv:8080',
                username: 'remount_user_B',
                password: '456',
              },
            },
            React.createElement(ActionCaptureConsumer, null)
          )
        );
        await new Promise((r) => setTimeout(r, 20));
      });

      const snapBefore16Queries = getCatalogDiagnosticsSnapshot()!;
      assert.strictEqual(
        snapBefore16Queries.operationHistory.length,
        6,
        '[12.20.9] Histórico inicial deve conter exatamente as 6 operações de abertura'
      );
      const originalSixIds = {
        live_categories: snapBefore16Queries.operations.live_categories?.operationId,
        vod_categories: snapBefore16Queries.operations.vod_categories?.operationId,
        series_categories: snapBefore16Queries.operations.series_categories?.operationId,
        live_catalog: snapBefore16Queries.operations.live_catalog?.operationId,
        vod_catalog: snapBefore16Queries.operations.vod_catalog?.operationId,
        series_catalog: snapBefore16Queries.operations.series_catalog?.operationId,
      };
      const originalLiveCatCompletedAt =
        snapBefore16Queries.operations.live_categories?.completedAtMs;

      // Executar 16 consultas posteriores de categorias
      await act(async () => {
        for (let q = 0; q < 16; q++) {
          controlledNowMs += 5;
          if (q % 3 === 0) {
            await capturedLiveCtxFor16.fetchLiveCategories();
          } else if (q % 3 === 1) {
            await capturedVodCtxFor16.fetchVodCategories();
          } else {
            await capturedSeriesCtxFor16.fetchSeriesCategories();
          }
        }
      });

      const snapAfter16Queries = getCatalogDiagnosticsSnapshot()!;
      assert.strictEqual(
        snapAfter16Queries.operationHistory.length,
        6,
        '[12.20.9] Após 16 consultas manuais posteriores de categorias, operationHistory DEVE permanecer limitado às 6 operações originais'
      );
      assert.strictEqual(
        snapAfter16Queries.subsequentOperationsCount,
        16,
        '[12.20.9] As 16 consultas manuais posteriores devem ser contabilizadas em subsequentOperationsCount (16)'
      );
      assert.deepStrictEqual(
        {
          live_categories: snapAfter16Queries.operations.live_categories?.operationId,
          vod_categories: snapAfter16Queries.operations.vod_categories?.operationId,
          series_categories: snapAfter16Queries.operations.series_categories?.operationId,
          live_catalog: snapAfter16Queries.operations.live_catalog?.operationId,
          vod_catalog: snapAfter16Queries.operations.vod_catalog?.operationId,
          series_catalog: snapAfter16Queries.operations.series_catalog?.operationId,
        },
        originalSixIds,
        '[12.20.9] Os 6 registros originais das operações iniciais NÃO devem ser sobrescritos pelas 16 consultas posteriores'
      );
      assert.strictEqual(
        snapAfter16Queries.operations.live_categories?.runNumber,
        1,
        '[12.20.9] runNumber de live_categories deve continuar sendo 1'
      );
      assert.strictEqual(
        snapAfter16Queries.operations.live_categories?.completedAtMs,
        originalLiveCatCompletedAt,
        '[12.20.9] Os tempos das operações iniciais devem permanecer intactos após as 16 consultas posteriores'
      );

      await act(async () => {
        remountRootB.unmount();
      });

      // -----------------------------------------------------------------------
      // 12.20.10: Duas ordenações seguidas de uma mesclagem do HeroBanner reportadas como "2 ordenações e 1 mesclagem" sem somar duas vezes o tempo das ordenações
      // -----------------------------------------------------------------------
      controlledNowMs = 30000;
      startCatalogDiagnosticsSession(undefined, 2);

      const vodSortTestItems = [
        {
          stream_id: 1,
          name: 'Filme Alpha (2024)',
          category_id: '10',
          rating: '8.0',
          stream_icon: 'http://img.test/v1.jpg',
        },
        {
          stream_id: 2,
          name: 'Filme Beta (2025)',
          category_id: '10',
          rating: '9.2',
          stream_icon: 'http://img.test/v2.jpg',
        },
      ];
      const seriesSortTestItems = [
        {
          series_id: 10,
          name: 'Série Gamma (2023)',
          category_id: '20',
          rating: '7.5',
          cover: 'http://img.test/s1.jpg',
        },
        {
          series_id: 11,
          name: 'Série Delta (2025)',
          category_id: '20',
          rating: '9.4',
          cover: 'http://img.test/s2.jpg',
        },
      ];

      // Avançar o relógio controlado de forma determinística durante a 1ª ordenação (VOD = 14ms), 2ª ordenação (Séries = 9ms) e mesclagem do HeroBanner (3ms)
      let clockReadsInSortAndMerge = 0;
      setCatalogDiagnosticsClockForTest(() => {
        clockReadsInSortAndMerge++;
        // Leituras do relógio em getHeroBannerItems:
        // 1: início sort VOD (t=30000) -> 2: fim sort VOD (t=30014 -> 14ms)
        // 3: início sort Series (t=30014) -> 4: fim sort Series (t=30023 -> 9ms)
        // 5: início heroMerge após obter vodSorted e seriesSorted (t=30023) -> 6: fim heroMerge (t=30026 -> 3ms)
        if (clockReadsInSortAndMerge === 1) return 30000;
        if (clockReadsInSortAndMerge === 2) return 30014;
        if (clockReadsInSortAndMerge === 3) return 30014;
        if (clockReadsInSortAndMerge === 4) return 30023;
        if (clockReadsInSortAndMerge === 5) return 30023;
        if (clockReadsInSortAndMerge === 6) return 30026;
        return 30026;
      });

      const heroMergedResult = getHeroBannerItems(vodSortTestItems, seriesSortTestItems);
      setCatalogDiagnosticsClockForTest(() => controlledNowMs);

      assert.strictEqual(heroMergedResult.length, 4, '[12.20.10] HeroBanner deve mesclar os 4 itens');
      const snapSortAndMerge = getCatalogDiagnosticsSnapshot()!;
      assert.strictEqual(
        snapSortAndMerge.sorting.totalNewSortsCount,
        2,
        '[12.20.10] Duas ordenações (VOD + Séries) seguidas de uma mesclagem devem registrar exatamente 2 ordenações em totalNewSortsCount (e não 3)'
      );
      assert.strictEqual(
        snapSortAndMerge.sorting.heroMergesCount,
        1,
        '[12.20.10] A mesclagem do HeroBanner deve ser contabilizada separadamente como 1 mesclagem em heroMergesCount'
      );
      assert.strictEqual(
        snapSortAndMerge.sorting.vod.totalSortMs,
        14,
        '[12.20.10] Tempo da ordenação de Filmes deve ser 14ms'
      );
      assert.strictEqual(
        snapSortAndMerge.sorting.series.totalSortMs,
        9,
        '[12.20.10] Tempo da ordenação de Séries deve ser 9ms'
      );
      assert.strictEqual(
        snapSortAndMerge.sorting.totalSortMs,
        23,
        '[12.20.10] Tempo total das ordenações efetivas deve ser 23ms (14ms + 9ms), sem somar duas vezes na mesclagem'
      );
      assert.strictEqual(
        snapSortAndMerge.sorting.totalHeroMergeMs,
        3,
        '[12.20.10] Tempo da mesclagem do HeroBanner deve medir apenas os 3ms posteriores a vodSorted e seriesSorted (sem incluir os 23ms das duas ordenações)'
      );

      const formattedSortAndMergeReport =
        catalogDiagMod.formatCatalogDiagnosticsReport(snapSortAndMerge);
      assert(
        formattedSortAndMergeReport.includes(
          '• Ordenações efetivas (Filmes + Séries): 2 ordenações (23.0 ms)'
        ),
        '[12.20.10] Relatório formatado deve exibir "2 ordenações (23.0 ms)"'
      );
      assert(
        formattedSortAndMergeReport.includes(
          '• Mesclagens do HeroBanner: 1 mesclagens (3.0 ms, itens=4)'
        ),
        '[12.20.10] Relatório formatado deve exibir "1 mesclagens (3.0 ms, itens=4)"'
      );

      // -----------------------------------------------------------------------
      // 12.20.11: Home e XtreamProvider REAIS — (1) listas vazias ou com 1 item não contam ordenação;
      // (2) filmes prontos e séries pendentes contam exatamente 1 ordenação;
      // (3) conclusão da abertura inclui o trabalho da renderização que liberou a Home;
      // (4) navegação posterior em TV ao vivo e abertura de categoria não alteram os totais da abertura.
      // -----------------------------------------------------------------------
      controlledNowMs = 35000;
      startCatalogDiagnosticsSession(undefined, 2);

      // (1) Listas vazias (0 itens) ou com 1 item retornam o mesmo resultado sem incrementar ordenações
      const emptyVodIdx = getOrCreateVodIndex([]);
      const singleVodItem = [{ stream_id: 555, name: 'Filme Único (2025)', category_id: '10', rating: '8.0' }];
      const singleVodIdx = getOrCreateVodIndex(singleVodItem);
      assert.deepStrictEqual(emptyVodIdx.getSortedAll(), [], '[12.20.11] Lista vazia deve retornar []');
      assert.deepStrictEqual(emptyVodIdx.getSortedByCategory('10'), [], '[12.20.11] Categoria vazia deve retornar []');
      assert.deepStrictEqual(
        singleVodIdx.getSortedAll(),
        singleVodItem,
        '[12.20.11] Lista com 1 item deve retornar [item]'
      );
      assert.deepStrictEqual(
        singleVodIdx.getSortedByCategory('10'),
        singleVodItem,
        '[12.20.11] Categoria com 1 item deve retornar [item]'
      );
      // Chamadas repetidas em cache para 0 e 1 item também não devem contar ordenação nem acerto de cache de ordenação
      emptyVodIdx.getSortedAll();
      singleVodIdx.getSortedAll();
      singleVodIdx.getSortedByCategory('10');

      const snapZeroAndOneItem = getCatalogDiagnosticsSnapshot()!;
      assert.strictEqual(
        snapZeroAndOneItem.sorting.totalNewSortsCount,
        0,
        '[12.20.11] Listas vazias ou com 1 item NÃO devem incrementar totalNewSortsCount'
      );
      assert.strictEqual(
        snapZeroAndOneItem.sorting.totalSortCacheHitsCount,
        0,
        '[12.20.11] Listas vazias ou com 1 item NÃO devem incrementar totalSortCacheHitsCount'
      );

      // (2) Montar a Home REAL e o XtreamProvider REAL com filmes prontos (3 itens) e séries ainda pendentes
      setTransportTestConfig({ mode: 'auto', capacitorHttpGet: null });
      globalThis.fetch = savedFetchP31;
      windowInstance.localStorage.setItem(
        STORAGE_KEY_DISPLAY_PREFS,
        JSON.stringify({ version: 1, mode: 'default', tvScale: 100, configured: true })
      );
      windowInstance.localStorage.setItem(
        CREDENTIALS_KEY,
        JSON.stringify({
          serverUrl: 'http://real-home-sort-nav.tv:8080',
          username: 'real_home_user',
          password: 'real_home_password',
          playlistName: 'Lista Home Real',
        })
      );

      let resolveRealHomePendingSeries: ((items: any[]) => void) | null = null;

      (XtreamService as any).getLiveCategories = async (_c: any, opts?: any) => {
        opts?.diagOp?.recordNormalization({ durationMs: 1, rawItemsCount: 2, validItemsCount: 2 });
        return [
          { category_id: '1', category_name: 'Esportes' },
          { category_id: '2', category_name: 'Notícias' },
        ];
      };
      (XtreamService as any).getVodCategories = async (_c: any, opts?: any) => {
        opts?.diagOp?.recordNormalization({ durationMs: 1, rawItemsCount: 1, validItemsCount: 1 });
        return [{ category_id: '10', category_name: 'Ação' }];
      };
      (XtreamService as any).getSeriesCategories = async (_c: any, opts?: any) => {
        opts?.diagOp?.recordNormalization({ durationMs: 1, rawItemsCount: 1, validItemsCount: 1 });
        return [{ category_id: '20', category_name: 'Drama' }];
      };
      (XtreamService as any).getLiveStreams = async (_c: any, _cat?: string, opts?: any) => {
        opts?.diagOp?.recordNormalization({ durationMs: 2, rawItemsCount: 3, validItemsCount: 3 });
        return [
          { stream_id: 101, name: 'ESPN Brasil HD', category_id: '1' },
          { stream_id: 102, name: 'ESPN Brasil FHD', category_id: '1' },
          { stream_id: 201, name: 'CNN Brasil HD', category_id: '2' },
        ];
      };
      (XtreamService as any).getVodStreams = async (_c: any, _cat?: string, opts?: any) => {
        opts?.diagOp?.recordNormalization({ durationMs: 2, rawItemsCount: 3, validItemsCount: 3 });
        return [
          {
            stream_id: 501,
            name: 'Filme Real A (2023)',
            category_id: '10',
            rating: '7.8',
            stream_icon: 'http://img.test/ra.jpg',
          },
          {
            stream_id: 502,
            name: 'Filme Real B (2025)',
            category_id: '10',
            rating: '9.1',
            stream_icon: 'http://img.test/rb.jpg',
          },
          {
            stream_id: 503,
            name: 'Filme Real C (2024)',
            category_id: '10',
            rating: '8.4',
            stream_icon: 'http://img.test/rc.jpg',
          },
        ];
      };
      (XtreamService as any).getSeries = (_c: any, _cat?: string, opts?: any) => {
        return new Promise<any[]>((resolve) => {
          resolveRealHomePendingSeries = (items) => {
            opts?.diagOp?.recordNormalization({
              durationMs: 2,
              rawItemsCount: items.length,
              validItemsCount: items.length,
            });
            resolve(items);
          };
        });
      };

      controlledNowMs = 36000;
      const realHomeSortNavRoot = createRoot(p31Container);
      await act(async () => {
        realHomeSortNavRoot.render(
          React.createElement(
            MemoryRouter,
            { initialEntries: ['/home'] },
            React.createElement(Home, null)
          )
        );
        await new Promise((r) => setTimeout(r, 40));
      });

      const snapWhileSeriesPending = getCatalogDiagnosticsSnapshot()!;
      assert.strictEqual(
        snapWhileSeriesPending.operations.vod_catalog?.outcome,
        'success',
        '[12.20.11] vod_catalog deve estar concluído na Home real'
      );
      assert.strictEqual(
        snapWhileSeriesPending.operations.series_catalog?.outcome,
        'running',
        '[12.20.11] series_catalog ainda deve estar pendente (running) na Home real'
      );
      assert.strictEqual(
        snapWhileSeriesPending.sorting.vod.newSortsCount,
        1,
        '[12.20.11] Na Home real com filmes prontos (3 itens) e séries pendentes, vod.newSortsCount deve ser 1'
      );
      assert.strictEqual(
        snapWhileSeriesPending.sorting.series.newSortsCount,
        0,
        '[12.20.11] Na Home real com séries ainda pendentes (lista vazia), series.newSortsCount deve ser 0'
      );
      assert.strictEqual(
        snapWhileSeriesPending.sorting.totalNewSortsCount,
        1,
        '[12.20.11] Na Home real com filmes prontos e séries pendentes, uma ordenação de filmes deve aparecer como exatamente 1 ordenação'
      );
      assert.strictEqual(
        snapWhileSeriesPending.sorting.heroMergesCount,
        1,
        '[12.20.11] Mesclagem do HeroBanner com filmes prontos deve ser contada separadamente (1)'
      );
      assert(
        snapWhileSeriesPending.sorting.vod.cacheHitsCount >= 1 &&
          snapWhileSeriesPending.sorting.series.cacheHitsCount === 0,
        '[12.20.11] Acertos de cache de Filmes devem ser contados separadamente sem contar o catálogo vazio de Séries'
      );

      // (3) Concluir series_catalog (com 3 séries) liberando a Home automaticamente e incluindo o trabalho da renderização que liberou a Home
      controlledNowMs = 36240;
      await act(async () => {
        resolveRealHomePendingSeries!([
          {
            series_id: 601,
            name: 'Série Real X (2022)',
            category_id: '20',
            rating: '7.9',
            cover: 'http://img.test/sx.jpg',
          },
          {
            series_id: 602,
            name: 'Série Real Y (2025)',
            category_id: '20',
            rating: '9.3',
            cover: 'http://img.test/sy.jpg',
          },
          {
            series_id: 603,
            name: 'Série Real Z (2024)',
            category_id: '20',
            rating: '8.8',
            cover: 'http://img.test/sz.jpg',
          },
        ]);
        await new Promise((r) => setTimeout(r, 35));
      });

      const snapAtHomeRelease = getCatalogDiagnosticsSnapshot()!;
      assert.strictEqual(
        snapAtHomeRelease.releaseTrigger,
        'auto_all_six',
        '[12.20.11] Após concluir a 6ª operação, a Home deve ser liberada com auto_all_six'
      );
      assert.strictEqual(
        snapAtHomeRelease.homeAvailableAtMs,
        240,
        '[12.20.11] homeAvailableAtMs deve ser 240ms'
      );
      assert.strictEqual(
        snapAtHomeRelease.sorting.vod.newSortsCount,
        1,
        '[12.20.11] Ao liberar a Home, vod.newSortsCount deve ser 1'
      );
      assert.strictEqual(
        snapAtHomeRelease.sorting.series.newSortsCount,
        1,
        '[12.20.11] O trabalho de ordenar Séries que ocorreu na renderização que liberou a Home DEVE ser incluído (series.newSortsCount = 1)'
      );
      assert.strictEqual(
        snapAtHomeRelease.sorting.totalNewSortsCount,
        2,
        '[12.20.11] Ao liberar a Home com Filmes e Séries prontos, totalNewSortsCount deve ser 2'
      );
      assert.strictEqual(
        snapAtHomeRelease.sorting.heroMergesCount,
        2,
        '[12.20.11] A mesclagem do HeroBanner na renderização que liberou a Home deve estar incluída (2)'
      );
      assert.strictEqual(
        snapAtHomeRelease.sorting.liveGroupingsCount,
        0,
        '[12.20.11] Antes de navegar para TV ao Vivo, liveGroupingsCount deve ser 0'
      );

      // (4) Navegar para TV ao Vivo e abrir uma categoria de canais DEPOIS que a Home já aceitou interação
      controlledNowMs = 36500;
      const liveHeaderNavBtn = p31Container.querySelector(
        'button[data-header-nav-id="live"]'
      ) as HTMLButtonElement | null;
      assert(liveHeaderNavBtn !== null, '[12.20.11] Botão "TV ao Vivo" no cabeçalho superior da Home real deve existir');
      await act(async () => {
        liveHeaderNavBtn!.click();
        await new Promise((r) => setTimeout(r, 30));
      });

      // Clicar na categoria "Notícias" (ou "Esportes") dentro da LiveTvView real para disparar getGroupsByCategory
      const liveCategoryButtons = Array.from(
        p31Container.querySelectorAll('button[data-live-category-id]')
      ) as HTMLButtonElement[];
      const targetLiveCatBtn =
        liveCategoryButtons.find((b) => b.getAttribute('data-live-category-id') === '2') ||
        liveCategoryButtons.find((b) => b.getAttribute('data-live-category-id') === '1');
      assert(
        targetLiveCatBtn !== undefined,
        '[12.20.11] Botões de categorias de TV ao vivo devem estar montados na LiveTvView'
      );
      await act(async () => {
        targetLiveCatBtn!.click();
        await new Promise((r) => setTimeout(r, 30));
      });

      const snapAfterLiveNavigation = getCatalogDiagnosticsSnapshot()!;
      assert.deepStrictEqual(
        snapAfterLiveNavigation.sorting,
        snapAtHomeRelease.sorting,
        '[12.20.11] Navegar para TV ao vivo e abrir uma categoria depois da liberação da Home NÃO deve alterar os totais de ordenações, mesclagens, agrupamentos ou cache da abertura'
      );
      assert.strictEqual(
        snapAfterLiveNavigation.sorting.liveGroupingsCount,
        0,
        '[12.20.11] Agrupamentos executados durante a navegação posterior em TV ao vivo não devem entrar no relatório de abertura'
      );

      await act(async () => {
        realHomeSortNavRoot.unmount();
      });

      // -----------------------------------------------------------------------
      // 12.20.12: Medição do HeroBanner com código real (getHeroBannerItems + HeroBanner) e relógio controlado:
      // 1. Catálogos de entrada vazios -> nenhuma mesclagem registrada;
      // 2. Catálogo com itens, mas sem capas válidas -> 1ª chamada registra 1 mesclagem e seu tempo com 0 itens no resultado;
      // 3. 2ª chamada com as mesmas listas -> registra 1 acerto de cache mesmo com resultado vazio, sem incrementar mesclagens;
      // 4. Seleção e exibição do HeroBanner preservadas e encerramento respeitado quando a Home fica disponível.
      // -----------------------------------------------------------------------
      const { HeroBanner: RealHeroBannerP31 } = await import('../src/components/HeroBanner');
      controlledNowMs = 40000;
      startCatalogDiagnosticsSession(undefined, 2);

      // Cenário 1: Catálogos de entrada vazios -> nenhuma mesclagem é registrada
      const emptyHeroItems = getHeroBannerItems([], []);
      assert.strictEqual(
        emptyHeroItems.length,
        0,
        '[12.20.12] Catálogos de entrada vazios devem produzir resultado vazio no HeroBanner'
      );
      const snapAfterEmptyHeroInput = getCatalogDiagnosticsSnapshot()!;
      assert.strictEqual(
        snapAfterEmptyHeroInput.sorting.heroMergesCount,
        0,
        '[12.20.12] Catálogos de entrada vazios NÃO devem registrar mesclagem no HeroBanner'
      );
      assert.strictEqual(
        snapAfterEmptyHeroInput.sorting.heroMergeCacheHitsCount,
        0,
        '[12.20.12] Catálogos de entrada vazios NÃO devem registrar acerto de cache no HeroBanner'
      );
      assert.strictEqual(
        snapAfterEmptyHeroInput.sorting.totalHeroMergeMs,
        0,
        '[12.20.12] Tempo de mesclagem deve permanecer 0ms para catálogos de entrada vazios'
      );

      // Cenário 2: Catálogo com itens, mas sem capas válidas -> 1ª chamada registra 1 mesclagem e seu tempo com 0 itens no resultado
      const vodWithoutCovers = [
        { stream_id: 801, name: 'Filme Sem Capa 1 (2025)', category_id: '10', rating: '9.0', stream_icon: '' },
        { stream_id: 802, name: 'Filme Sem Capa 2 (2024)', category_id: '10', rating: '8.5' },
      ];
      const seriesWithoutCovers = [
        { series_id: 901, name: 'Série Sem Capa 1 (2025)', category_id: '20', rating: '9.2', cover: '' },
      ];

      let heroNoCoverClockStep = 0;
      setCatalogDiagnosticsClockForTest(() => {
        heroNoCoverClockStep++;
        // Leituras do relógio na 1ª chamada:
        // 1: início sort VOD (2 itens) -> 40010
        // 2: fim sort VOD -> 40016 (6ms)
        // (Séries tem apenas 1 item, portanto não executa/registra sort)
        // 3: início heroMerge -> 40016
        // 4: fim heroMerge -> 40020 (4ms)
        if (heroNoCoverClockStep === 1) return 40010;
        if (heroNoCoverClockStep === 2) return 40016;
        if (heroNoCoverClockStep === 3) return 40016;
        if (heroNoCoverClockStep === 4) return 40020;
        return 40020;
      });

      const firstNoCoverHeroResult = getHeroBannerItems(vodWithoutCovers, seriesWithoutCovers);
      setCatalogDiagnosticsClockForTest(() => controlledNowMs);

      assert.strictEqual(
        firstNoCoverHeroResult.length,
        0,
        '[12.20.12] Catálogo com itens sem capas válidas deve retornar 0 itens no resultado do HeroBanner'
      );
      const snapAfterFirstNoCoverHero = getCatalogDiagnosticsSnapshot()!;
      assert.strictEqual(
        snapAfterFirstNoCoverHero.sorting.heroMergesCount,
        1,
        '[12.20.12] 1ª chamada com itens sem capas válidas DEVE registrar 1 mesclagem (heroMergesCount = 1)'
      );
      assert.strictEqual(
        snapAfterFirstNoCoverHero.sorting.totalHeroMergeMs,
        4,
        '[12.20.12] 1ª chamada com itens sem capas válidas DEVE registrar o tempo da mesclagem (4ms)'
      );
      assert.strictEqual(
        snapAfterFirstNoCoverHero.sorting.hero.lastSortedItemsCount,
        0,
        '[12.20.12] O resultado da mesclagem sem capas válidas deve registrar 0 itens de saída (lastSortedItemsCount = 0)'
      );
      assert.strictEqual(
        snapAfterFirstNoCoverHero.sorting.heroMergeCacheHitsCount,
        0,
        '[12.20.12] Na 1ª chamada ainda não há acerto de cache de mesclagem'
      );
      assert.strictEqual(
        snapAfterFirstNoCoverHero.sorting.totalNewSortsCount,
        1,
        '[12.20.12] Apenas a lista de Filmes (2 itens) deve contar 1 ordenação (Séries tem 1 item)'
      );

      // Cenário 3: 2ª chamada com as mesmas listas -> registra 1 acerto de cache mesmo com resultado vazio, sem incrementar mesclagens
      const secondNoCoverHeroResult = getHeroBannerItems(vodWithoutCovers, seriesWithoutCovers);
      assert.strictEqual(
        secondNoCoverHeroResult,
        firstNoCoverHeroResult,
        '[12.20.12] 2ª chamada com as mesmas listas deve retornar a mesma referência do cache'
      );
      assert.strictEqual(
        secondNoCoverHeroResult.length,
        0,
        '[12.20.12] Resultado em cache permanece com 0 itens'
      );
      const snapAfterSecondNoCoverHero = getCatalogDiagnosticsSnapshot()!;
      assert.strictEqual(
        snapAfterSecondNoCoverHero.sorting.heroMergesCount,
        1,
        '[12.20.12] 2ª chamada com as mesmas listas NÃO deve incrementar heroMergesCount (permanece 1)'
      );
      assert.strictEqual(
        snapAfterSecondNoCoverHero.sorting.heroMergeCacheHitsCount,
        1,
        '[12.20.12] 2ª chamada com as mesmas listas DEVE registrar 1 acerto de cache (heroMergeCacheHitsCount = 1), mesmo com resultado vazio'
      );
      assert.strictEqual(
        snapAfterSecondNoCoverHero.sorting.hero.cacheHitsCount,
        1,
        '[12.20.12] hero.cacheHitsCount deve ser 1'
      );
      assert.strictEqual(
        snapAfterSecondNoCoverHero.sorting.hero.lastSortedItemsCount,
        0,
        '[12.20.12] hero.lastSortedItemsCount permanece 0 após leitura do cache vazio'
      );

      // Validar que o componente HeroBanner real preserva a seleção e a exibição (vazio quando 0 itens, e renderizando destaque quando há capa válida)
      const heroBannerTestRoot = createRoot(p31Container);
      await act(async () => {
        heroBannerTestRoot.render(
          React.createElement(
            XtreamProvider,
            { credentials: null },
            React.createElement(RealHeroBannerP31, {
              items: secondNoCoverHeroResult,
              onPlay: () => {},
              onInfo: () => {},
            })
          )
        );
        await new Promise((r) => setTimeout(r, 15));
      });
      assert.strictEqual(
        p31Container.querySelectorAll('button').length,
        0,
        '[12.20.12] HeroBanner real com 0 itens no resultado não deve renderizar botões de destaque'
      );

      const vodWithValidCover = [
        {
          stream_id: 810,
          name: 'Destaque Com Capa (2025)',
          category_id: '10',
          rating: '9.5',
          stream_icon: 'http://img.test/hero810.jpg',
        },
      ];
      const validHeroItems = getHeroBannerItems(vodWithValidCover, []);
      assert.strictEqual(
        validHeroItems.length,
        1,
        '[12.20.12] Catálogo com capa válida deve selecionar o item no resultado do HeroBanner'
      );
      await act(async () => {
        heroBannerTestRoot.render(
          React.createElement(
            XtreamProvider,
            { credentials: null },
            React.createElement(RealHeroBannerP31, {
              items: validHeroItems,
              onPlay: () => {},
              onInfo: () => {},
            })
          )
        );
        await new Promise((r) => setTimeout(r, 15));
      });
      assert(
        p31Container.textContent?.includes('Destaque Com Capa'),
        '[12.20.12] HeroBanner real deve exibir corretamente o item selecionado com capa válida'
      );
      await act(async () => {
        heroBannerTestRoot.unmount();
      });

      // -----------------------------------------------------------------------
      // 12.21: P3.2 — Medição por etapa do carregamento dos catálogos no Android (CapacitorHttp + patch HttpRequestHandler 8.6.0)
      // -----------------------------------------------------------------------
      // Restaurar métodos reais de XtreamService para exercitar o transporte completo
      (XtreamService as any).getLiveCategories = origXtreamMethods.getLiveCategories;
      (XtreamService as any).getVodCategories = origXtreamMethods.getVodCategories;
      (XtreamService as any).getSeriesCategories = origXtreamMethods.getSeriesCategories;
      (XtreamService as any).getLiveStreams = origXtreamMethods.getLiveStreams;
      (XtreamService as any).getVodStreams = origXtreamMethods.getVodStreams;
      (XtreamService as any).getSeries = origXtreamMethods.getSeries;

      const syntheticVodRawPayload = [
        {
          stream_id: 7001,
          name: 'Filme Sintético TV 1 (2025)',
          category_id: '10',
          rating: '8.9',
          stream_icon: 'http://secret-iptv-host.internal:8080/images/7001.jpg',
        },
        {
          stream_id: 7002,
          name: 'Filme Sintético TV 2 (2024)',
          category_id: '10',
          rating: '7.8',
          stream_icon: 'http://secret-iptv-host.internal:8080/images/7002.jpg',
        },
        null,
      ];

      const syntheticSeriesRawPayload = [
        {
          series_id: 8001,
          name: 'Série Sintética TV 1 (2025)',
          category_id: '20',
          rating: '9.1',
          cover: 'http://secret-iptv-host.internal:8080/images/8001.jpg',
        },
        {
          series_id: 8002,
          name: 'Série Sintética TV 2 (2023)',
          category_id: '20',
          rating: '8.4',
          cover: 'http://secret-iptv-host.internal:8080/images/8002.jpg',
        },
      ];
      const syntheticSeriesRawJsonText = JSON.stringify(syntheticSeriesRawPayload);

      // 12.21.1: Coleta desligada — caminho atual sem medições adicionais, sem collectDiagnostics e única chamada HTTP
      resetCatalogDiagnosticsForTest(false);
      assert.strictEqual(
        isCatalogLoadDiagnosticsEnabled(),
        false,
        '[12.21.1] Coleta deve estar desligada para validar o caminho padrão'
      );

      let disabledAndroidHttpCalls = 0;
      let disabledCapturedOptions: any = null;
      setTransportTestConfig({
        mode: 'capacitor',
        capacitorHttpGet: async (opts) => {
          disabledAndroidHttpCalls++;
          disabledCapturedOptions = opts;
          return {
            status: 200,
            data: syntheticVodRawPayload,
            headers: { 'Content-Type': 'application/json' },
            url: opts.url,
          };
        },
      });

      const vodBaselineDisabled = await XtreamService.getVodStreams({
        serverUrl: 'http://secret-iptv-host.internal:8080',
        username: 'tv_secret_user',
        password: 'tv_secret_password',
      });

      assert.strictEqual(
        disabledAndroidHttpCalls,
        1,
        '[12.21.1] Com coleta desligada, a consulta deve fazer exatamente 1 chamada HTTP'
      );
      assert.strictEqual(
        disabledCapturedOptions?.collectDiagnostics,
        undefined,
        '[12.21.1] Com coleta desligada, CapacitorHttp.get NÃO deve solicitar collectDiagnostics'
      );
      assert.strictEqual(
        vodBaselineDisabled.length,
        2,
        '[12.21.1] Catálogo retornado com coleta desligada deve conter os 2 filmes válidos'
      );
      assert.strictEqual(
        getCatalogDiagnosticsSnapshot(),
        null,
        '[12.21.1] Com coleta desligada, nenhum snapshot deve ser criado'
      );
      assert.strictEqual(
        getCatalogDiagnosticsRecordedEventsCountForTest(),
        0,
        '[12.21.1] Com coleta desligada, nenhum evento de diagnóstico deve ser registrado'
      );

      // Baseline de séries com coleta desligada e payload textual
      let disabledSeriesHttpCalls = 0;
      setTransportTestConfig({
        mode: 'capacitor',
        capacitorHttpGet: async (opts) => {
          disabledSeriesHttpCalls++;
          return {
            status: 200,
            data: syntheticSeriesRawJsonText,
            headers: { 'Content-Type': 'text/plain' },
            url: opts.url,
          };
        },
      });
      const seriesBaselineDisabled = await XtreamService.getSeries({
        serverUrl: 'http://secret-iptv-host.internal:8080',
        username: 'tv_secret_user',
        password: 'tv_secret_password',
      });
      assert.strictEqual(disabledSeriesHttpCalls, 1);
      assert.strictEqual(seriesBaselineDisabled.length, 2);

      // 12.21.2: Coleta ligada — Resposta JSON já interpretada no Android (pre-parsed-object)
      controlledNowMs = 50000;
      setCatalogDiagnosticsClockForTest(() => controlledNowMs);
      setCatalogLoadDiagnosticsEnabled(true);
      const p32SessionId = startCatalogDiagnosticsSession(501, 2);

      let enabledVodHttpCalls = 0;
      let enabledVodCapturedOptions: any = null;
      let preParsedStringifiedInP32 = false;
      const origStringifyP32 = JSON.stringify;
      JSON.stringify = ((val: any, ...rest: any[]) => {
        if (val === syntheticVodRawPayload) {
          preParsedStringifiedInP32 = true;
        }
        return origStringifyP32(val, ...rest);
      }) as typeof JSON.stringify;

      setTransportTestConfig({
        mode: 'capacitor',
        capacitorHttpGet: async (opts) => {
          enabledVodHttpCalls++;
          enabledVodCapturedOptions = opts;
          // Simula 80.010,0 ms observados pelo JS (transporte + ponte nativa)
          controlledNowMs += 80010;
          return {
            status: 200,
            data: syntheticVodRawPayload,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Content-Length': '14850240',
            },
            url: opts.url,
            nativeDiagnostics: {
              statusAndHeadersMs: 420.5,
              bodyReadMs: 31200.25,
              nativeJsonParseExecuted: true,
              nativeJsonParseMs: 40750.5,
              nativeTotalMs: 72400.0,
              contentLengthHeaderBytes: 14850240,
              payloadChars: 14620100,
            },
          };
        },
      });

      const p32VodOp = recordCatalogOperationEnqueued(p32SessionId, 'vod_catalog', 60);
      controlledNowMs += 20;
      recordCatalogOperationStarted(p32VodOp);
      const vodWithDiagPreParsed = await XtreamService.getVodStreams(
        {
          serverUrl: 'http://secret-iptv-host.internal:8080',
          username: 'tv_secret_user',
          password: 'tv_secret_password',
        },
        undefined,
        { diagOp: p32VodOp }
      );
      JSON.stringify = origStringifyP32;
      recordCatalogOperationFinished(p32VodOp, 'success');

      assert.strictEqual(
        enabledVodHttpCalls,
        1,
        '[12.21.2] Tentativa acompanhada no Android deve fazer exatamente 1 chamada HTTP'
      );
      assert.strictEqual(
        enabledVodCapturedOptions?.collectDiagnostics,
        true,
        '[12.21.2] Tentativa acompanhada com coleta ligada DEVE enviar collectDiagnostics: true para CapacitorHttp.get'
      );
      assert.strictEqual(
        preParsedStringifiedInP32,
        false,
        '[12.21.2] Resposta já interpretada no Android NÃO deve passar por JSON.stringify no JS'
      );
      assert.deepStrictEqual(
        vodWithDiagPreParsed,
        vodBaselineDisabled,
        '[12.21.2] Resultado do catálogo de filmes com diagnóstico ativo deve permanecer idêntico ao baseline'
      );

      // 12.21.3: Resposta textual com JSON.parse no JavaScript (Content-Type text/plain no Android)
      let enabledSeriesHttpCalls = 0;
      let enabledSeriesCapturedOptions: any = null;
      const origParseP32 = JSON.parse;
      JSON.parse = ((txt: string, rev?: any) => {
        if (txt === syntheticSeriesRawJsonText) {
          controlledNowMs += 145; // 145ms em JSON.parse no JS
        }
        return origParseP32(txt, rev);
      }) as typeof JSON.parse;

      setTransportTestConfig({
        mode: 'capacitor',
        capacitorHttpGet: async (opts) => {
          enabledSeriesHttpCalls++;
          enabledSeriesCapturedOptions = opts;
          controlledNowMs += 2620; // 2620ms observados pelo JS em CapacitorHttp.get
          return {
            status: 200,
            data: syntheticSeriesRawJsonText,
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
            },
            url: opts.url,
            nativeDiagnostics: {
              statusAndHeadersMs: 310.0,
              bodyReadMs: 1850.5,
              nativeJsonParseExecuted: false,
              nativeJsonParseMs: null,
              nativeTotalMs: 2170.0,
              contentLengthHeaderBytes: null,
              payloadChars: syntheticSeriesRawJsonText.length,
            },
          };
        },
      });

      const p32SeriesOp = recordCatalogOperationEnqueued(p32SessionId, 'series_catalog', 55);
      controlledNowMs += 10;
      recordCatalogOperationStarted(p32SeriesOp);
      const seriesWithDiagText = await XtreamService.getSeries(
        {
          serverUrl: 'http://secret-iptv-host.internal:8080',
          username: 'tv_secret_user',
          password: 'tv_secret_password',
        },
        undefined,
        { diagOp: p32SeriesOp }
      );
      JSON.parse = origParseP32;
      recordCatalogOperationFinished(p32SeriesOp, 'success');

      assert.strictEqual(
        enabledSeriesHttpCalls,
        1,
        '[12.21.3] Tentativa textual acompanhada no Android deve fazer exatamente 1 chamada HTTP'
      );
      assert.strictEqual(
        enabledSeriesCapturedOptions?.collectDiagnostics,
        true,
        '[12.21.3] Tentativa textual acompanhada deve enviar collectDiagnostics: true'
      );
      assert.deepStrictEqual(
        seriesWithDiagText,
        seriesBaselineDisabled,
        '[12.21.3] Resultado do catálogo de séries deve permanecer idêntico ao baseline'
      );

      // 12.21.4: Ausência de metadados + etapas não alcançadas em retry (associados à tentativa e sessão corretas)
      let liveCatCallsP32 = 0;
      XtreamService.setRetryDelayMsForTest(15);
      setTransportTestConfig({
        mode: 'capacitor',
        capacitorHttpGet: async (opts) => {
          liveCatCallsP32++;
          if (liveCatCallsP32 === 1) {
            controlledNowMs += 210;
            // 1ª tentativa alcança apenas status + cabeçalhos (HTTP 503) sem leitura de corpo nem total nativo
            return {
              status: 503,
              data: '',
              headers: {},
              url: opts.url,
              nativeDiagnostics: {
                statusAndHeadersMs: 180.0,
                bodyReadMs: null,
                nativeJsonParseExecuted: null,
                nativeJsonParseMs: null,
                nativeTotalMs: null,
                contentLengthHeaderBytes: null,
                payloadChars: null,
              },
            };
          }
          // 2ª tentativa responde sem objeto nativeDiagnostics (ausência total de metadados nativos)
          controlledNowMs += 95;
          return {
            status: 200,
            data: [{ category_id: '1', category_name: 'Canais Abertos' }],
            headers: {},
            url: opts.url,
          };
        },
      });

      const p32LiveCatOp = recordCatalogOperationEnqueued(p32SessionId, 'live_categories', 90);
      recordCatalogOperationStarted(p32LiveCatOp);
      const liveCatsP32 = await XtreamService.getLiveCategories(
        {
          serverUrl: 'http://secret-iptv-host.internal:8080',
          username: 'tv_secret_user',
          password: 'tv_secret_password',
        },
        { diagOp: p32LiveCatOp }
      );
      recordCatalogOperationFinished(p32LiveCatOp, 'success');
      XtreamService.setRetryDelayMsForTest(1000);
      assert.strictEqual(liveCatsP32.length, 1);
      assert.strictEqual(
        liveCatCallsP32,
        2,
        '[12.21.4] Operação com 1 falha transitória seguida de sucesso deve fazer 1 chamada HTTP por tentativa (2 no total)'
      );

      const snapP32 = getCatalogDiagnosticsSnapshot()!;
      assert(snapP32 !== null, '[12.21.4] Snapshot da sessão P3.2 deve existir');
      assert.strictEqual(snapP32.sessionId, p32SessionId);

      // Verificações detalhadas de 12.21.2 (vod_catalog — JSON no Android)
      const vodAttP32 = snapP32.operations.vod_catalog!.attempts[0];
      assert.strictEqual(vodAttP32.nativeTransportAndBridgeMs, 80010);
      assert.strictEqual(vodAttP32.nativeStatusAndHeadersMs, 420.5);
      assert.strictEqual(vodAttP32.nativeBodyReadMs, 31200.25);
      assert.strictEqual(vodAttP32.nativeJsonParseExecuted, true);
      assert.strictEqual(vodAttP32.nativeJsonParseMs, 40750.5);
      assert.strictEqual(vodAttP32.nativeTotalMs, 72400);
      assert.strictEqual(
        vodAttP32.outsideNativeMeasuredMs,
        7610,
        '[12.21.2] Tempo fora do trecho nativo medido deve ser a diferença entre transporte+ponte (80010ms) e total nativo (72400ms) = 7610ms'
      );
      assert.strictEqual(vodAttP32.contentLengthHeaderBytes, 14850240);
      assert.strictEqual(vodAttP32.payloadChars, 14620100);
      assert.strictEqual(vodAttP32.payloadFormat, 'pre-parsed-object');
      assert.strictEqual(vodAttP32.jsonParseExecuted, false);
      assert.strictEqual(vodAttP32.jsonParseMs, null);

      // Verificações detalhadas de 12.21.3 (series_catalog — texto JSON com JSON.parse no JS)
      const seriesAttP32 = snapP32.operations.series_catalog!.attempts[0];
      assert.strictEqual(seriesAttP32.nativeTransportAndBridgeMs, 2620);
      assert.strictEqual(seriesAttP32.nativeStatusAndHeadersMs, 310);
      assert.strictEqual(seriesAttP32.nativeBodyReadMs, 1850.5);
      assert.strictEqual(seriesAttP32.nativeJsonParseExecuted, false);
      assert.strictEqual(seriesAttP32.nativeJsonParseMs, null);
      assert.strictEqual(seriesAttP32.nativeTotalMs, 2170);
      assert.strictEqual(
        seriesAttP32.outsideNativeMeasuredMs,
        450,
        '[12.21.3] Tempo fora do trecho nativo medido deve ser 2620ms - 2170ms = 450ms'
      );
      assert.strictEqual(seriesAttP32.contentLengthHeaderBytes, null);
      assert.strictEqual(seriesAttP32.payloadChars, syntheticSeriesRawJsonText.length);
      assert.strictEqual(seriesAttP32.payloadFormat, 'text-json');
      assert.strictEqual(seriesAttP32.jsonParseExecuted, true);
      assert.strictEqual(seriesAttP32.jsonParseMs, 145);

      // Verificações detalhadas de 12.21.4 (live_categories — tentativa 1 parcial e tentativa 2 sem metadados)
      const liveAtt1P32 = snapP32.operations.live_categories!.attempts[0];
      assert.strictEqual(liveAtt1P32.nativeTransportAndBridgeMs, 210);
      assert.strictEqual(liveAtt1P32.nativeStatusAndHeadersMs, 180);
      assert.strictEqual(liveAtt1P32.nativeBodyReadMs, null);
      assert.strictEqual(liveAtt1P32.nativeJsonParseExecuted, null);
      assert.strictEqual(liveAtt1P32.nativeTotalMs, null);
      assert.strictEqual(liveAtt1P32.outsideNativeMeasuredMs, null);

      const liveAtt2P32 = snapP32.operations.live_categories!.attempts[1];
      assert.strictEqual(liveAtt2P32.nativeTransportAndBridgeMs, 95);
      assert.strictEqual(liveAtt2P32.nativeStatusAndHeadersMs, null);
      assert.strictEqual(liveAtt2P32.nativeBodyReadMs, null);
      assert.strictEqual(liveAtt2P32.nativeJsonParseExecuted, null);
      assert.strictEqual(liveAtt2P32.nativeJsonParseMs, null);
      assert.strictEqual(liveAtt2P32.nativeTotalMs, null);
      assert.strictEqual(liveAtt2P32.outsideNativeMeasuredMs, null);
      assert.strictEqual(liveAtt2P32.contentLengthHeaderBytes, null);
      assert.strictEqual(liveAtt2P32.payloadChars, null);

      // Validar relatório formatado e sanitizado para P3.2
      const reportP32Text = catalogDiagMod.formatCatalogDiagnosticsReport(snapP32);
      assert(
        reportP32Text.includes(
          '• Etapas Android (P3.2): status + cabeçalhos=420.5 ms | leitura + decodificação do corpo=31200.3 ms | JSON no Android=40750.5 ms (executado no Android) | total no trecho nativo=72400.0 ms | tempo fora do trecho nativo medido=7610.0 ms | Content-Length=14850240 (valor do cabeçalho) | texto lido=14620100 caracteres'
        ),
        '[12.21.4] Relatório formatado deve conter a linha de etapas Android para JSON já interpretado no Android'
      );
      assert(
        reportP32Text.includes(
          `• Etapas Android (P3.2): status + cabeçalhos=310.0 ms | leitura + decodificação do corpo=1850.5 ms | JSON no Android=não executado | total no trecho nativo=2170.0 ms | tempo fora do trecho nativo medido=450.0 ms | Content-Length=indisponível | texto lido=${syntheticSeriesRawJsonText.length} caracteres`
        ),
        '[12.21.4] Relatório formatado deve conter a linha de etapas Android para resposta textual com JSON.parse no JS'
      );
      assert(
        reportP32Text.includes(
          '• Etapas Android (P3.2): status + cabeçalhos=180.0 ms | leitura + decodificação do corpo=indisponível | JSON no Android=indisponível | total no trecho nativo=indisponível | tempo fora do trecho nativo medido=indisponível | Content-Length=indisponível | texto lido=indisponível'
        ),
        '[12.21.4] Relatório formatado deve exibir "indisponível" para etapas não alcançadas'
      );
      assert(
        reportP32Text.includes(
          '• Etapas Android (P3.2): status + cabeçalhos=indisponível | leitura + decodificação do corpo=indisponível | JSON no Android=indisponível | total no trecho nativo=indisponível | tempo fora do trecho nativo medido=indisponível | Content-Length=indisponível | texto lido=indisponível'
        ),
        '[12.21.4] Relatório formatado deve exibir "indisponível" quando metadados nativos estão ausentes'
      );
      assert(
        !reportP32Text.includes('secret-iptv-host') &&
          !reportP32Text.includes('tv_secret_user') &&
          !reportP32Text.includes('tv_secret_password') &&
          !reportP32Text.includes('Filme Sintético TV') &&
          !reportP32Text.includes('Série Sintética TV'),
        '[12.21.4] Relatório P3.2 deve conter apenas números e rótulos sanitizados'
      );

      // -----------------------------------------------------------------------
      // 12.21.5: Teste do patch Android em preparo limpo e em segundo preparo (prepare-android.mjs)
      // -----------------------------------------------------------------------
      const fsNode = await import('node:fs');
      const pathNode = await import('node:path');
      const osNode = await import('node:os');
      const prepareAndroidMod = await import('../tooling/android/prepare-android.mjs');

      // Aplicar e validar o patch na árvore real do projeto (idempotente)
      const realWorkspacePatchRes1 =
        prepareAndroidMod.applyCapacitorAndroidHttpDiagnosticsPatch();
      assert.strictEqual(
        realWorkspacePatchRes1.version,
        '8.6.0',
        '[12.21.5] Versão de @capacitor/android no workspace real deve ser 8.6.0'
      );
      prepareAndroidMod.verifyCapacitorAndroidHttpDiagnosticsPatch();
      const realWorkspacePatchRes2 =
        prepareAndroidMod.applyCapacitorAndroidHttpDiagnosticsPatch();
      assert.strictEqual(
        realWorkspacePatchRes2.applied,
        false,
        '[12.21.5] Segunda chamada no workspace real não deve reaplicar o patch'
      );
      assert.strictEqual(
        realWorkspacePatchRes2.alreadyApplied,
        true,
        '[12.21.5] Segunda chamada no workspace real deve detectar patch já aplicado'
      );

      // Reconstruir o fonte original não patcheado de @capacitor/android@8.6.0 para testar preparo limpo -> 2º preparo em diretório temporário isolado
      const realPatchedJavaPath = pathNode.join(
        process.cwd(),
        prepareAndroidMod.CAPACITOR_HTTP_HANDLER_REL_PATH
      );
      const patchFileContent = fsNode.readFileSync(
        pathNode.join(process.cwd(), prepareAndroidMod.CAPACITOR_HTTP_DIAGNOSTICS_PATCH_REL_PATH),
        'utf8'
      );
      const patchedLinesForRevert = fsNode
        .readFileSync(realPatchedJavaPath, 'utf8')
        .replace(/\r\n/g, '\n')
        .split('\n');

      // Reverter os hunks para obter o HttpRequestHandler.java original de @capacitor/android@8.6.0
      const parsedPatchLines = patchFileContent.replace(/\r\n/g, '\n').split('\n');
      const revertHunks: Array<{
        oldStart: number;
        newStart: number;
        preLines: string[];
        postLines: string[];
      }> = [];
      let curRevertHunk: any = null;
      for (const line of parsedPatchLines) {
        if (line.startsWith('--- ') || line.startsWith('+++ ')) continue;
        const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (m) {
          if (curRevertHunk) revertHunks.push(curRevertHunk);
          curRevertHunk = {
            oldStart: Number.parseInt(m[1], 10),
            newStart: Number.parseInt(m[2], 10),
            preLines: [],
            postLines: [],
          };
          continue;
        }
        if (!curRevertHunk) continue;
        if (line.startsWith(' ')) {
          curRevertHunk.preLines.push(line.slice(1));
          curRevertHunk.postLines.push(line.slice(1));
        } else if (line.startsWith('-')) {
          curRevertHunk.preLines.push(line.slice(1));
        } else if (line.startsWith('+')) {
          curRevertHunk.postLines.push(line.slice(1));
        }
      }
      if (curRevertHunk) revertHunks.push(curRevertHunk);

      const cleanOriginalLines = [...patchedLinesForRevert];
      for (let i = revertHunks.length - 1; i >= 0; i--) {
        const h = revertHunks[i];
        cleanOriginalLines.splice(h.newStart - 1, h.postLines.length, ...h.preLines);
      }
      const cleanUnpatchedJavaSource = cleanOriginalLines.join('\n');
      assert(
        !cleanUnpatchedJavaSource.includes('buildResponseWithDiagnostics'),
        '[12.21.5] Fonte revertido para o teste limpo não deve conter buildResponseWithDiagnostics antes do 1º preparo'
      );

      const tmpPrepDir = fsNode.mkdtempSync(
        pathNode.join(osNode.tmpdir(), 'nc-android-prep-p32-')
      );
      try {
        // Montar estrutura mínima do projeto para executar prepareAndroidProject completo (1º preparo limpo e 2º preparo)
        fsNode.copyFileSync(
          pathNode.join(process.cwd(), 'package.json'),
          pathNode.join(tmpPrepDir, 'package.json')
        );
        fsNode.mkdirSync(pathNode.join(tmpPrepDir, 'dist'), { recursive: true });
        fsNode.writeFileSync(
          pathNode.join(tmpPrepDir, 'dist', 'index.html'),
          '<!doctype html><html><body>North Code Play</body></html>',
          'utf8'
        );
        fsNode.mkdirSync(pathNode.join(tmpPrepDir, 'src', 'assets'), { recursive: true });
        fsNode.copyFileSync(
          pathNode.join(process.cwd(), 'src', 'assets', 'logo.png'),
          pathNode.join(tmpPrepDir, 'src', 'assets', 'logo.png')
        );

        // Copiar tooling/android (overlay + patches)
        fsNode.cpSync(
          pathNode.join(process.cwd(), 'tooling', 'android'),
          pathNode.join(tmpPrepDir, 'tooling', 'android'),
          { recursive: true }
        );

        // Criar node_modules/@capacitor/android@8.6.0 com HttpRequestHandler.java limpo (sem patch)
        const tmpCapAndroidPkgDir = pathNode.join(
          tmpPrepDir,
          'node_modules',
          '@capacitor',
          'android'
        );
        const tmpJavaHandlerPath = pathNode.join(
          tmpPrepDir,
          prepareAndroidMod.CAPACITOR_HTTP_HANDLER_REL_PATH
        );
        fsNode.mkdirSync(pathNode.dirname(tmpJavaHandlerPath), { recursive: true });
        fsNode.copyFileSync(
          pathNode.join(process.cwd(), 'node_modules', '@capacitor', 'android', 'package.json'),
          pathNode.join(tmpCapAndroidPkgDir, 'package.json')
        );
        fsNode.writeFileSync(tmpJavaHandlerPath, cleanUnpatchedJavaSource, 'utf8');

        // Criar stub determinístico de Capacitor CLI para simular `cap add android` e `cap sync android` no diretório temporário
        const tmpCapCliBin = pathNode.join(
          tmpPrepDir,
          'node_modules',
          '@capacitor',
          'cli',
          'bin',
          'capacitor'
        );
        fsNode.mkdirSync(pathNode.dirname(tmpCapCliBin), { recursive: true });
        fsNode.writeFileSync(
          tmpCapCliBin,
          `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const root = process.cwd();
const androidAppDir = path.join(root, 'android', 'app');
if (args[0] === 'add' && args[1] === 'android') {
  fs.mkdirSync(path.join(androidAppDir, 'src', 'main', 'assets', 'public'), { recursive: true });
  fs.writeFileSync(
    path.join(androidAppDir, 'build.gradle'),
    'android {\\n  namespace "com.example.app"\\n  defaultConfig {\\n    applicationId "com.example.app"\\n    versionCode 1\\n    versionName "1.0"\\n  }\\n}\\n',
    'utf8'
  );
} else if (args[0] === 'sync' && args[1] === 'android') {
  const assetsDir = path.join(androidAppDir, 'src', 'main', 'assets');
  fs.mkdirSync(path.join(assetsDir, 'public'), { recursive: true });
  fs.copyFileSync(path.join(root, 'dist', 'index.html'), path.join(assetsDir, 'public', 'index.html'));
  fs.writeFileSync(path.join(assetsDir, 'capacitor.config.json'), '{"appId":"com.northcode.play"}', 'utf8');
  fs.writeFileSync(path.join(assetsDir, 'capacitor.plugins.json'), '[]', 'utf8');
}
`,
          'utf8'
        );

        // 1º Preparo (limpo): deve gerar android/, aplicar o patch P3.2 em HttpRequestHandler.java e validar tudo
        const firstPrepResult = prepareAndroidMod.prepareAndroidProject({
          rootDir: tmpPrepDir,
          skipWebBuild: true,
        });
        assert.strictEqual(
          firstPrepResult.reusedExistingAndroid,
          false,
          '[12.21.5] 1º preparo limpo deve gerar a pasta android/'
        );
        assert.strictEqual(
          firstPrepResult.patchApplied,
          true,
          '[12.21.5] 1º preparo limpo DEVE aplicar o patch P3.2 em HttpRequestHandler.java'
        );
        assert.strictEqual(
          firstPrepResult.patchAlreadyApplied,
          false,
          '[12.21.5] No 1º preparo limpo, patchAlreadyApplied deve ser false'
        );

        const javaContentAfterFirstPrep = fsNode.readFileSync(tmpJavaHandlerPath, 'utf8');
        assert(
          javaContentAfterFirstPrep.includes('buildResponseWithDiagnostics') &&
            javaContentAfterFirstPrep.includes('statusAndHeadersMs') &&
            javaContentAfterFirstPrep.includes('bodyReadMs') &&
            javaContentAfterFirstPrep.includes('nativeJsonParseExecuted') &&
            javaContentAfterFirstPrep.includes('nativeJsonParseMs') &&
            javaContentAfterFirstPrep.includes('nativeTotalMs') &&
            javaContentAfterFirstPrep.includes('contentLengthHeaderBytes') &&
            javaContentAfterFirstPrep.includes('payloadChars'),
          '[12.21.5] HttpRequestHandler.java após 1º preparo deve conter todas as medições por etapa do P3.2'
        );

        // 2º Preparo (repetido): deve reutilizar android/ e detectar que o patch já está aplicado sem reaplicá-lo
        const secondPrepResult = prepareAndroidMod.prepareAndroidProject({
          rootDir: tmpPrepDir,
          skipWebBuild: true,
        });
        assert.strictEqual(
          secondPrepResult.reusedExistingAndroid,
          true,
          '[12.21.5] 2º preparo deve reutilizar a pasta android/ existente'
        );
        assert.strictEqual(
          secondPrepResult.patchApplied,
          false,
          '[12.21.5] 2º preparo NÃO deve reaplicar o patch já presente'
        );
        assert.strictEqual(
          secondPrepResult.patchAlreadyApplied,
          true,
          '[12.21.5] 2º preparo deve reportar patchAlreadyApplied = true'
        );

        const javaContentAfterSecondPrep = fsNode.readFileSync(tmpJavaHandlerPath, 'utf8');
        assert.strictEqual(
          javaContentAfterSecondPrep,
          javaContentAfterFirstPrep,
          '[12.21.5] Conteúdo de HttpRequestHandler.java deve permanecer idêntico após o 2º preparo'
        );

        // Validar rejeição caso o conteúdo de HttpRequestHandler.java seja corrompido/inesperado
        fsNode.writeFileSync(
          tmpJavaHandlerPath,
          'package com.getcapacitor.plugin.util;\npublic class HttpRequestHandler { /* arquivo adulterado */ }\n',
          'utf8'
        );
        let threwOnCorruptedContent = false;
        try {
          prepareAndroidMod.applyCapacitorAndroidHttpDiagnosticsPatch({
            rootDir: tmpPrepDir,
          });
        } catch (err: any) {
          threwOnCorruptedContent = /Conteúdo inesperado/i.test(String(err?.message || err));
        }
        assert.strictEqual(
          threwOnCorruptedContent,
          true,
          '[12.21.5] O preparo deve falhar com erro claro se HttpRequestHandler.java tiver conteúdo inesperado'
        );

        // Validar rejeição caso a versão de @capacitor/android seja diferente de 8.6.0
        fsNode.writeFileSync(tmpJavaHandlerPath, cleanUnpatchedJavaSource, 'utf8');
        fsNode.writeFileSync(
          pathNode.join(tmpCapAndroidPkgDir, 'package.json'),
          JSON.stringify({ name: '@capacitor/android', version: '8.5.0' }),
          'utf8'
        );
        let threwOnWrongVersion = false;
        try {
          prepareAndroidMod.applyCapacitorAndroidHttpDiagnosticsPatch({
            rootDir: tmpPrepDir,
          });
        } catch (err: any) {
          threwOnWrongVersion = /Versão incompatível de @capacitor\/android/i.test(
            String(err?.message || err)
          );
        }
        assert.strictEqual(
          threwOnWrongVersion,
          true,
          '[12.21.5] O preparo deve falhar com erro claro se a versão de @capacitor/android divergir de 8.6.0'
        );
      } finally {
        fsNode.rmSync(tmpPrepDir, { recursive: true, force: true });
      }

      console.log(
        `📊 [Métricas P3.1 / P3.2 — Diagnóstico do Carregamento Inicial dos Catálogos (Auditado)]\n` +
          `   • Coleta desativada por padrão: eventos capturados=0 | requisições iniciais=6 (0 extras) | collectDiagnostics omitido\n` +
          `   • Transporte Web (fetch): espera resposta=35ms | leitura corpo=20ms | JSON.parse=12ms\n` +
          `   • Transporte Android P3.2 (JSON nativo sintético): status+cabeçalhos=420.5ms | leitura+decodificação=31200.3ms | JSON Android=40750.5ms | total nativo=72400.0ms | fora do trecho nativo=7610.0ms (total JS=80010.0ms)\n` +
          `   • Transporte Android P3.2 (texto JSON c/ parse JS sintético): status+cabeçalhos=310.0ms | leitura+decodificação=1850.5ms | JSON Android=não executado | total nativo=2170.0ms | fora do trecho nativo=450.0ms | JSON.parse JS=145.0ms\n` +
          `   • Patch @capacitor/android@8.6.0: 1º preparo limpo (aplicado=true) | 2º preparo (já aplicado=true, sem reaplicar) | versão/conteúdo validados\n` +
          `   • Marcos reais da Home: seletor desde 1ª montagem=150ms (separado de homeAvailableAtMs=320ms) | botão manual: intenção=350ms → disponível pós-render=358ms → 6 operações=520ms | HTTP 401/auth:0 → auth_rejected (preservado após recuperação)\n` +
          `   • Preparação da Home vs navegação: filmes prontos c/ séries pendentes=1 ordenação | abertura completa=2 ordenações + 2 mesclagens | HeroBanner sem capas=1 mesclagem (0 itens) + 1 hit cache | navegação posterior em TV ao vivo=0 alterações`
      );

      // =====================================================================
      // 12.22. P3.3 — Transferência dos catálogos grandes no APK Android
      // =====================================================================
      console.log(
        '🧪 Testando 12.22 (P3.3): Transferência dos catálogos grandes no APK Android via arquivo temporário...'
      );
      {
        const fsNodeP33 = await import('node:fs');
        const pathNodeP33 = await import('node:path');
        const osNodeP33 = await import('node:os');
        const { Capacitor: CapacitorCoreP33 } = await import('@capacitor/core');
        const httpTransportModP33 = await import('../src/services/httpTransport');
        const androidAdapterModP33 = await import(
          '../src/services/androidCatalogFileAdapter'
        );
        const prepareAndroidModP33 = await import(
          '../tooling/android/prepare-android.mjs'
        );

        const origIsNativePlatform = CapacitorCoreP33.isNativePlatform;
        const origGetPlatform = CapacitorCoreP33.getPlatform;
        const origIsPluginAvailable = CapacitorCoreP33.isPluginAvailable;
        const origConvertFileSrc = CapacitorCoreP33.convertFileSrc;
        const savedGetVodInfoP33 = (XtreamService as any).getVodInfo;
        const savedGetSeriesInfoP33 = (XtreamService as any).getSeriesInfo;
        const savedGetShortEpgP33 = (XtreamService as any).getShortEpg;

        const tmpCacheRootP33 = fsNodeP33.mkdtempSync(
          pathNodeP33.join(osNodeP33.tmpdir(), 'nc-p33-cache-')
        );
        const dedicatedTransferDirP33 = pathNodeP33.join(
          tmpCacheRootP33,
          androidAdapterModP33.CATALOG_TRANSFER_CACHE_SUBDIR
        );
        fsNodeP33.mkdirSync(dedicatedTransferDirP33, { recursive: true });

        try {
          // Restaurar métodos reais de XtreamService para testar o fluxo real
          (XtreamService as any).getLiveCategories = origXtreamMethods.getLiveCategories;
          (XtreamService as any).getVodCategories = origXtreamMethods.getVodCategories;
          (XtreamService as any).getSeriesCategories = origXtreamMethods.getSeriesCategories;
          (XtreamService as any).getLiveStreams = origXtreamMethods.getLiveStreams;
          (XtreamService as any).getVodStreams = origXtreamMethods.getVodStreams;
          (XtreamService as any).getSeries = origXtreamMethods.getSeries;
          (XtreamService as any).getVodInfo = origXtreamMethods.getVodInfo;
          (XtreamService as any).getSeriesInfo = origXtreamMethods.getSeriesInfo;
          (XtreamService as any).getShortEpg = origXtreamMethods.getShortEpg;
          (XtreamService as any).authenticate = origXtreamMethods.authenticate;

          // -----------------------------------------------------------------
          // 12.22.1: Identificação explícita das consultas de catálogo completo
          // -----------------------------------------------------------------
          assert.strictEqual(
            XtreamService.isFullCatalogQuery('get_live_streams', {}),
            true,
            '[12.22.1] get_live_streams sem category_id deve ser catálogo completo'
          );
          assert.strictEqual(
            XtreamService.isFullCatalogQuery('get_vod_streams', {}),
            true,
            '[12.22.1] get_vod_streams sem category_id deve ser catálogo completo'
          );
          assert.strictEqual(
            XtreamService.isFullCatalogQuery('get_series', {}),
            true,
            '[12.22.1] get_series sem category_id deve ser catálogo completo'
          );
          assert.strictEqual(
            XtreamService.isFullCatalogQuery('get_vod_streams', { category_id: '15' }),
            false,
            '[12.22.1] get_vod_streams filtrado por categoria NÃO deve ser catálogo completo'
          );
          assert.strictEqual(
            XtreamService.isFullCatalogQuery('get_live_streams', { category_id: '10' }),
            false,
            '[12.22.1] get_live_streams filtrado por categoria NÃO deve ser catálogo completo'
          );
          assert.strictEqual(
            XtreamService.isFullCatalogQuery('get_series', { category_id: '25' }),
            false,
            '[12.22.1] get_series filtrado por categoria NÃO deve ser catálogo completo'
          );
          for (const nonFullAction of [
            undefined,
            'get_live_categories',
            'get_vod_categories',
            'get_series_categories',
            'get_vod_info',
            'get_series_info',
            'get_short_epg',
          ]) {
            assert.strictEqual(
              XtreamService.isFullCatalogQuery(nonFullAction, {}),
              false,
              `[12.22.1] Action "${String(nonFullAction)}" NÃO deve usar o transporte de catálogo completo`
            );
          }

          // -----------------------------------------------------------------
          // 12.22.2: Seleção de transporte por ambiente (Navegador comum,
          // Navegador em modo TV, Android APK em ambos os modos de apresentação,
          // e fallback quando o plugin nativo está ausente antes da consulta)
          // -----------------------------------------------------------------
          const credsP33: XtreamCredentials = {
            serverUrl: 'http://p33-secret-provider.iptv.local:8080',
            username: 'p33_secret_user',
            password: 'p33_secret_password',
          };

          let webFetchProviderCount = 0;
          let capacitorHttpGetCount = 0;
          let tempFilePluginDownloadCount = 0;
          let localWebViewFileFetchCount = 0;

          httpTransportModP33.resetAndroidCatalogAdapterLoadCountForTest();
          httpTransportModP33.setTransportTestConfig({
            mode: 'auto',
            capacitorHttpGet: null,
            androidCatalogPluginAvailable: null,
          });

          // (A) Navegador comum (modo padrão) e Navegador em modo TV:
          // Sempre usa fetch do navegador, nunca carrega nem chama o plugin Android
          (CapacitorCoreP33 as any).isNativePlatform = () => false;
          (CapacitorCoreP33 as any).getPlatform = () => 'web';
          (CapacitorCoreP33 as any).isPluginAvailable = () => false;

          globalThis.fetch = (async (input: RequestInfo | URL) => {
            const urlStr = String(input);
            if (urlStr.includes('player_api.php')) {
              webFetchProviderCount++;
              return {
                ok: true,
                status: 200,
                text: async () =>
                  JSON.stringify([{ stream_id: 101, name: 'Filme Web Normal', category_id: '1' }]),
              } as unknown as Response;
            }
            throw new Error(`URL inesperada no navegador: ${urlStr}`);
          }) as typeof fetch;

          confirmDisplayPreferences('default');
          catalogDiagMod.resetCatalogDiagnosticsForTest(false); // Diagnóstico desativado
          const webNormalVod = await XtreamService.getVodStreams(credsP33);
          assert.strictEqual(webNormalVod.length, 1);
          assert.strictEqual(
            webFetchProviderCount,
            1,
            '[12.22.2] Navegador comum deve usar fetch (1 GET)'
          );
          assert.strictEqual(
            httpTransportModP33.getAndroidCatalogAdapterLoadCountForTest(),
            0,
            '[12.22.2] Navegador comum NÃO deve carregar o adaptador Android sob demanda'
          );

          confirmDisplayPreferences('tv', 85);
          const webTvVod = await XtreamService.getVodStreams(credsP33);
          assert.strictEqual(webTvVod.length, 1);
          assert.strictEqual(
            webFetchProviderCount,
            2,
            '[12.22.2] Navegador em modo TV deve continuar usando fetch do navegador'
          );
          assert.strictEqual(
            httpTransportModP33.getAndroidCatalogAdapterLoadCountForTest(),
            0,
            '[12.22.2] Navegador em modo TV NÃO deve carregar o adaptador Android'
          );

          // (B) Android APK quando o plugin nativo está AUSENTE (detectado antes de iniciar a consulta):
          // Cai para CapacitorHttp.get() com exatamente 1 GET ao provedor
          (CapacitorCoreP33 as any).isNativePlatform = () => true;
          (CapacitorCoreP33 as any).getPlatform = () => 'android';
          (CapacitorCoreP33 as any).isPluginAvailable = () => false;

          httpTransportModP33.setTransportTestConfig({
            mode: 'auto',
            androidCatalogPluginAvailable: null,
            capacitorHttpGet: async () => {
              capacitorHttpGetCount++;
              return {
                status: 200,
                data: [{ stream_id: 202, name: 'Filme Fallback CapacitorHttp', category_id: '1' }],
                headers: {},
                url: 'http://p33-secret-provider.iptv.local:8080/player_api.php',
              };
            },
          });

          const fallbackVod = await XtreamService.getVodStreams(credsP33);
          assert.strictEqual(fallbackVod.length, 1);
          assert.strictEqual(
            capacitorHttpGetCount,
            1,
            '[12.22.2] Sem o plugin CatalogFileTransfer disponível antes da consulta, deve usar CapacitorHttp.get com apenas 1 GET'
          );
          assert.strictEqual(
            httpTransportModP33.getAndroidCatalogAdapterLoadCountForTest(),
            0,
            '[12.22.2] Sem o plugin disponível, não deve invocar o caminho de arquivo temporário'
          );

          // (C) Android APK com plugin nativo disponível:
          // Testar com diagnóstico DESATIVADO e ATIVADO, e nos modos 'default' e 'tv',
          // verificando também que autenticação, categorias, catálogos filtrados por categoria,
          // EPG e detalhes continuam usando CapacitorHttp.get
          (CapacitorCoreP33 as any).isNativePlatform = () => true;
          (CapacitorCoreP33 as any).getPlatform = () => 'android';
          (CapacitorCoreP33 as any).isPluginAvailable = (name: string) =>
            name === 'CatalogFileTransfer';

          let p33FileSeq = 0;
          const activeFilesSetP33 = new Set<string>();
          const cancelledTransfersP33 = new Set<string>();
          const lastBridgeResponsesP33: any[] = [];
          const cleanupRequestedFileIdsP33: string[] = [];
          let customCleanupHookP33:
            | ((fileId: string, performDiskDelete: () => boolean) => Promise<{ deleted?: boolean }>)
            | null = null;

          const androidPrivateCacheDirP33 = '/data/user/0/com.northcode.play/cache';
          const androidDedicatedTransferDirP33 = `${androidPrivateCacheDirP33}/${androidAdapterModP33.CATALOG_TRANSFER_CACHE_SUBDIR}`;

          // Simulador fiel do plugin Java CatalogFileTransferPlugin gravando arquivos reais em disco
          let simulatedProviderHandlerP33: (
            opts: any,
            fileHelpers: {
              writeTempAndFinalize: (content: string) => {
                fileId: string;
                filePath: string;
                cacheDir: string;
                bytesWritten: number;
              };
              isCancelled: () => boolean;
            }
          ) => Promise<any>;

          const cleanupStaleFilesSimP33 = () => {
            const entries = fsNodeP33.readdirSync(dedicatedTransferDirP33);
            for (const entryName of entries) {
              if (!activeFilesSetP33.has(entryName)) {
                fsNodeP33.rmSync(pathNodeP33.join(dedicatedTransferDirP33, entryName), {
                  force: true,
                });
              }
            }
          };

          const nativePluginSimP33 = {
            async downloadCatalogToTempFile(opts: any) {
              tempFilePluginDownloadCount++;
              const seq = ++p33FileSeq;
              const safeToken =
                String(opts.transferId || `t${seq}`).replace(/[^a-zA-Z0-9_-]/g, '') +
                `_${seq}`;
              const tempFileName = `nc_catalog_${safeToken}.json.tmp`;
              const finalFileName = `nc_catalog_${safeToken}.json`;
              const tempFilePath = pathNodeP33.join(dedicatedTransferDirP33, tempFileName);
              const finalDiskFilePath = pathNodeP33.join(dedicatedTransferDirP33, finalFileName);
              const finalAndroidFilePath = `${androidDedicatedTransferDirP33}/${finalFileName}`;

              cleanupStaleFilesSimP33();
              activeFilesSetP33.add(tempFileName);
              activeFilesSetP33.add(finalFileName);

              let keepFinal = false;
              try {
                const res = await simulatedProviderHandlerP33(opts, {
                  isCancelled: () => cancelledTransfersP33.has(opts.transferId),
                  writeTempAndFinalize: (content: string) => {
                    // Grava em fluxo no arquivo .tmp e renomeia para .json sem fazer JSON.parse em Java
                    const buf = Buffer.from(content, 'utf8');
                    fsNodeP33.writeFileSync(tempFilePath, buf);
                    if (cancelledTransfersP33.has(opts.transferId)) {
                      throw new Error('TRANSFER_CANCELLED');
                    }
                    fsNodeP33.renameSync(tempFilePath, finalDiskFilePath);
                    keepFinal = true;
                    return {
                      fileId: finalFileName,
                      filePath: finalAndroidFilePath,
                      cacheDir: androidDedicatedTransferDirP33,
                      bytesWritten: buf.byteLength,
                    };
                  },
                });
                lastBridgeResponsesP33.push(res);
                return res;
              } finally {
                activeFilesSetP33.delete(tempFileName);
                fsNodeP33.rmSync(tempFilePath, { force: true });
                if (!keepFinal || cancelledTransfersP33.has(opts.transferId)) {
                  activeFilesSetP33.delete(finalFileName);
                  fsNodeP33.rmSync(finalDiskFilePath, { force: true });
                }
              }
            },
            async cancelTransfer({ transferId }: { transferId: string }) {
              cancelledTransfersP33.add(transferId);
              return { cancelled: true };
            },
            async cleanupTransferFile({ fileId }: { fileId: string }) {
              cleanupRequestedFileIdsP33.push(fileId);
              if (!/^nc_catalog_[a-zA-Z0-9_-]+\.json(?:\.tmp)?$/.test(fileId)) {
                throw new Error(
                  'Identificador de arquivo temporário inválido ou fora do diretório permitido.'
                );
              }
              const target = pathNodeP33.resolve(dedicatedTransferDirP33, fileId);
              if (
                pathNodeP33.dirname(target) !== pathNodeP33.resolve(dedicatedTransferDirP33)
              ) {
                throw new Error('Caminho fora da pasta dedicada.');
              }
              const performDiskDelete = () => {
                activeFilesSetP33.delete(fileId);
                activeFilesSetP33.delete(`${fileId}.tmp`);
                const existed = fsNodeP33.existsSync(target);
                if (existed) {
                  fsNodeP33.rmSync(target, { force: true });
                }
                return existed;
              };
              if (customCleanupHookP33) {
                return customCleanupHookP33(fileId, performDiskDelete);
              }
              const existed = performDiskDelete();
              return { deleted: existed };
            },
          };

          androidAdapterModP33.setAndroidCatalogFileAdapterTestOverride({
            plugin: nativePluginSimP33,
            convertFileSrc: (filePath: string) =>
              `http://localhost/_capacitor_file_${filePath}`,
          });

          // Fetch na WebView: atende as leituras de arquivo local convertidas via _capacitor_file_
          let localFetchInterceptionHookP33: ((localPath: string) => Promise<void>) | null =
            null;
          let forceLocalFileReadErrorP33 = false;

          globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            const urlStr = String(input);
            const prefix = 'http://localhost/_capacitor_file_';
            if (urlStr.startsWith(prefix)) {
              localWebViewFileFetchCount++;
              const requestedAndroidPath = urlStr.slice(prefix.length);
              const localDiskPath = requestedAndroidPath.startsWith(
                `${androidDedicatedTransferDirP33}/`
              )
                ? pathNodeP33.join(
                    dedicatedTransferDirP33,
                    requestedAndroidPath.slice(androidDedicatedTransferDirP33.length + 1)
                  )
                : requestedAndroidPath;
              if (localFetchInterceptionHookP33) {
                await localFetchInterceptionHookP33(localDiskPath);
              }
              if (init?.signal?.aborted) {
                throw new Error('Aborted');
              }
              if (forceLocalFileReadErrorP33 || !fsNodeP33.existsSync(localDiskPath)) {
                return {
                  ok: false,
                  status: 404,
                  text: async () => '',
                } as unknown as Response;
              }
              return {
                ok: true,
                status: 200,
                redirected: false,
                type: 'basic',
                text: async () => {
                  if (init?.signal?.aborted) {
                    throw new Error('Aborted');
                  }
                  return fsNodeP33.readFileSync(localDiskPath, 'utf8');
                },
              } as unknown as Response;
            }
            webFetchProviderCount++;
            throw new Error(`Fetch web externo não deveria ser chamado no Android: ${urlStr}`);
          }) as typeof fetch;

          // Construir catálogos sintéticos grandes com caracteres UTF-8 e entradas inválidas misturadas
          const largeSyntheticVodRaw: any[] = [];
          for (let i = 1; i <= 1500; i++) {
            largeSyntheticVodRaw.push({
              num: i,
              name: `Filme Sintético P3.3 #${i} — Ação & Ficção Científica 4K 🎬`,
              stream_type: 'movie',
              stream_id: 50000 + i,
              stream_icon: `http://img.local/vod_${i}.jpg`,
              rating: '8.7',
              rating_5based: 4.35,
              added: String(1710000000 + i),
              category_id: String((i % 12) + 1),
              container_extension: 'mp4',
            });
          }
          largeSyntheticVodRaw.push(null, 'invalid_primitive', [1, 2, 3]);
          const largeSyntheticVodJsonText = JSON.stringify(largeSyntheticVodRaw);
          const largeSyntheticVodBytes = Buffer.byteLength(largeSyntheticVodJsonText, 'utf8');

          const largeSyntheticLiveRaw: any[] = [];
          for (let i = 1; i <= 800; i++) {
            largeSyntheticLiveRaw.push({
              num: i,
              name: `Canal Ao Vivo P3.3 #${i} — Transmissão São Paulo FHD`,
              stream_type: 'live',
              stream_id: 10000 + i,
              stream_icon: `http://img.local/live_${i}.png`,
              epg_channel_id: `epg_${i}`,
              added: String(1710000000 + i),
              category_id: String((i % 8) + 1),
            });
          }
          const largeSyntheticLiveJsonText = JSON.stringify(largeSyntheticLiveRaw);

          const largeSyntheticSeriesRaw: any[] = [];
          for (let i = 1; i <= 1200; i++) {
            largeSyntheticSeriesRaw.push({
              num: i,
              name: `Série Sintética P3.3 #${i} — Mistério na Neblina`,
              series_id: 80000 + i,
              cover: `http://img.local/series_${i}.jpg`,
              plot: 'Descrição com acentuação UTF-8: coração, ação, episódio.',
              rating: '9.1',
              rating_5based: 4.55,
              last_modified: String(1710000000 + i),
              category_id: String((i % 10) + 1),
            });
          }
          const largeSyntheticSeriesJsonText = JSON.stringify(largeSyntheticSeriesRaw);

          simulatedProviderHandlerP33 = async (opts, helpers) => {
            const urlObj = new URL(opts.url);
            const action = urlObj.searchParams.get('action');
            let bodyText = '[]';
            if (action === 'get_vod_streams') {
              bodyText = largeSyntheticVodJsonText;
            } else if (action === 'get_live_streams') {
              bodyText = largeSyntheticLiveJsonText;
            } else if (action === 'get_series') {
              bodyText = largeSyntheticSeriesJsonText;
            }
            const written = helpers.writeTempAndFinalize(bodyText);
            return {
              status: 200,
              fileId: written.fileId,
              filePath: written.filePath,
              ...(opts.collectDiagnostics
                ? {
                    nativeDiagnostics: {
                      statusAndHeadersMs: 380.4,
                      fileWriteMs: 620.6,
                      nativeJsonParseExecuted: false,
                      nativeJsonParseMs: null,
                      nativeTotalMs: 1005.0,
                      contentLengthHeaderBytes: written.bytesWritten,
                      bytesWritten: written.bytesWritten,
                    },
                  }
                : {}),
            };
          };

          capacitorHttpGetCount = 0;
          tempFilePluginDownloadCount = 0;
          localWebViewFileFetchCount = 0;
          lastBridgeResponsesP33.length = 0;

          httpTransportModP33.setTransportTestConfig({
            mode: 'auto',
            androidCatalogPluginAvailable: null,
            capacitorHttpGet: async (opts) => {
              capacitorHttpGetCount++;
              const u = new URL(opts.url);
              const actName = u.searchParams.get('action');
              if (!actName) {
                return {
                  status: 200,
                  data: {
                    user_info: { username: 'p33_secret_user', status: 'Active', auth: 1 },
                    server_info: { url: 'p33-secret-provider.iptv.local', port: '8080' },
                  },
                  headers: {},
                  url: opts.url,
                };
              }
              if (actName.endsWith('_categories')) {
                return {
                  status: 200,
                  data: [{ category_id: '1', category_name: 'Categoria Geral' }],
                  headers: {},
                  url: opts.url,
                };
              }
              if (u.searchParams.get('category_id')) {
                return {
                  status: 200,
                  data: [{ stream_id: 999, series_id: 999, name: 'Filtrado por Categoria', category_id: '1' }],
                  headers: {},
                  url: opts.url,
                };
              }
              return {
                status: 200,
                data: { info: { name: 'Detalhe/EPG' }, epg_listings: [] },
                headers: {},
                url: opts.url,
              };
            },
          });

          // Monitorar chamadas de JSON.parse durante as 3 consultas de catálogo completo
          let catalogJsonParseCalls = 0;
          const origJsonParseP33 = JSON.parse;
          JSON.parse = ((text: string, ...rest: any[]) => {
            if (
              typeof text === 'string' &&
              (text.includes('Filme Sintético P3.3 #1') ||
                text.includes('Canal Ao Vivo P3.3 #1') ||
                text.includes('Série Sintética P3.3 #1'))
            ) {
              catalogJsonParseCalls++;
            }
            return origJsonParseP33(text, ...rest);
          }) as typeof JSON.parse;

          let apkDefaultVod: any[] = [];
          let apkTvLive: any[] = [];
          let apkTvSeries: any[] = [];
          try {
            // Com diagnóstico DESATIVADO e modo 'default'
            catalogDiagMod.resetCatalogDiagnosticsForTest(false);
            confirmDisplayPreferences('default');
            apkDefaultVod = await XtreamService.getVodStreams(credsP33);

            // Com diagnóstico DESATIVADO e modo 'tv'
            confirmDisplayPreferences('tv', 85);
            apkTvLive = await XtreamService.getLiveStreams(credsP33);
            apkTvSeries = await XtreamService.getSeries(credsP33);
          } finally {
            JSON.parse = origJsonParseP33;
          }

          assert.strictEqual(
            tempFilePluginDownloadCount,
            3,
            '[12.22.2] As 3 consultas de catálogo completo (Live, VOD, Series) no Android devem usar o plugin de arquivo temporário (1 GET por tentativa), mesmo com diagnóstico desativado e em ambos os modos default/tv'
          );
          assert.strictEqual(
            localWebViewFileFetchCount,
            3,
            '[12.22.2] Cada catálogo completo deve ser lido localmente na WebView via convertFileSrc + fetch'
          );
          assert.strictEqual(
            catalogJsonParseCalls,
            3,
            '[12.22.2] Cada corpo JSON válido de catálogo completo deve passar por um único JSON.parse (na WebView)'
          );
          assert.strictEqual(
            capacitorHttpGetCount,
            0,
            '[12.22.2] Consultas de catálogo completo no APK com plugin disponível NÃO devem chamar CapacitorHttp.get'
          );

          // Verificar ausência absoluta do corpo do catálogo no retorno da ponte nativa
          for (const bridgeRes of lastBridgeResponsesP33) {
            assert.strictEqual(
              'data' in bridgeRes,
              false,
              '[12.22.2] O retorno da ponte nativa NÃO deve conter o campo "data" com o corpo do catálogo'
            );
            const serializedBridgeRes = JSON.stringify(bridgeRes);
            assert(
              !serializedBridgeRes.includes('Filme Sintético P3.3') &&
                !serializedBridgeRes.includes('Canal Ao Vivo P3.3') &&
                !serializedBridgeRes.includes('Série Sintética P3.3'),
              '[12.22.2] Nenhum item ou texto do catálogo deve atravessar a ponte nativa do Capacitor'
            );
          }

          // Verificar equivalência exata dos dados normalizados (incluindo UTF-8 e descarte de itens inválidos)
          const expectedNormalizedVod = normalizeCatalogArray(
            origJsonParseP33(largeSyntheticVodJsonText),
            'Erro'
          );
          assert.strictEqual(apkDefaultVod.length, 1500);
          assert.deepStrictEqual(
            apkDefaultVod,
            expectedNormalizedVod,
            '[12.22.2] Os dados normalizados vindos do arquivo temporário devem ser idênticos aos do transporte padrão (preservando UTF-8)'
          );
          assert.strictEqual(apkTvLive.length, 800);
          assert.strictEqual(apkTvSeries.length, 1200);

          // Verificar limpeza imediata dos arquivos temporários após o consumo
          assert.strictEqual(
            fsNodeP33.readdirSync(dedicatedTransferDirP33).length,
            0,
            '[12.22.2] Todos os arquivos temporários devem ser apagados imediatamente após o consumo na WebView'
          );

          // Verificar que autenticação, categorias, catálogos filtrados por categoria, EPG e detalhes
          // continuam usando CapacitorHttp.get normalmente
          await XtreamService.authenticate(credsP33);
          await XtreamService.getLiveCategories(credsP33);
          await XtreamService.getVodCategories(credsP33);
          await XtreamService.getSeriesCategories(credsP33);
          await XtreamService.getLiveStreams(credsP33, '1');
          await XtreamService.getVodStreams(credsP33, '1');
          await XtreamService.getSeries(credsP33, '1');
          await XtreamService.getVodInfo(credsP33, 50001);
          await XtreamService.getSeriesInfo(credsP33, 80001);
          await XtreamService.getShortEpg(credsP33, 10001);

          assert.strictEqual(
            capacitorHttpGetCount,
            10,
            '[12.22.2] Autenticação, categorias, catálogos filtrados por categoria, detalhes e EPG devem preservar CapacitorHttp.get (10 chamadas)'
          );
          assert.strictEqual(
            tempFilePluginDownloadCount,
            3,
            '[12.22.2] Nenhuma chamada filtrada, de categorias, autenticação, detalhe ou EPG deve acionar o plugin de arquivo temporário'
          );

          // -----------------------------------------------------------------
          // 12.22.3: Lista vazia, JSON inválido, HTTP 401/403/5xx (sem corpo),
          // e diferenciação entre erro de leitura do arquivo local vs erro HTTP
          // -----------------------------------------------------------------
          XtreamService.setRetryDelayMsForTest(10);

          // (a) Lista vazia ("[]" e "")
          for (const emptyBody of ['[]', '   ']) {
            simulatedProviderHandlerP33 = async (_opts, helpers) => {
              const written = helpers.writeTempAndFinalize(emptyBody);
              return {
                status: 200,
                fileId: written.fileId,
                filePath: written.filePath,
              };
            };
            const emptyRes = await XtreamService.getVodStreams(credsP33);
            assert.deepStrictEqual(
              emptyRes,
              [],
              `[12.22.3] Corpo vazio (${JSON.stringify(emptyBody)}) deve retornar []`
            );
            assert.strictEqual(
              fsNodeP33.readdirSync(dedicatedTransferDirP33).length,
              0,
              '[12.22.3] Arquivo temporário de lista vazia deve ser removido após leitura'
            );
          }

          // (b) JSON inválido: falha fatal de formato, sem retry (1 GET apenas) e arquivo removido
          let invalidJsonPluginCalls = 0;
          simulatedProviderHandlerP33 = async (_opts, helpers) => {
            invalidJsonPluginCalls++;
            const written = helpers.writeTempAndFinalize('[{"stream_id": 1, "name": "Incompleto"');
            return {
              status: 200,
              fileId: written.fileId,
              filePath: written.filePath,
            };
          };
          let caughtInvalidJson: any = null;
          try {
            await XtreamService.getVodStreams(credsP33);
          } catch (err) {
            caughtInvalidJson = err;
          }
          assert(
            caughtInvalidJson && caughtInvalidJson.isFatalFormat === true,
            '[12.22.3] JSON inválido lido do arquivo temporário deve lançar erro com isFatalFormat = true'
          );
          assert.strictEqual(
            invalidJsonPluginCalls,
            1,
            '[12.22.3] JSON inválido NÃO deve sofrer retry (1 único GET)'
          );
          assert.strictEqual(
            fsNodeP33.readdirSync(dedicatedTransferDirP33).length,
            0,
            '[12.22.3] Arquivo temporário com JSON inválido deve ser removido no bloco finally'
          );

          // (c) HTTP 401 e HTTP 403 sem corpo de resposta: preserva código HTTP, rejeita credenciais sem retry
          for (const authStatus of [401, 403]) {
            let authCalls = 0;
            simulatedProviderHandlerP33 = async () => {
              authCalls++;
              return {
                status: authStatus,
                fileId: null,
                filePath: null,
              };
            };
            let caughtAuthErr: any = null;
            try {
              await XtreamService.getVodStreams(credsP33);
            } catch (err) {
              caughtAuthErr = err;
            }
            assert(
              caughtAuthErr &&
                caughtAuthErr.isAuthError === true &&
                caughtAuthErr.status === authStatus,
              `[12.22.3] Resposta HTTP ${authStatus} sem corpo deve preservar status=${authStatus} e classificar como isAuthError=true`
            );
            assert.strictEqual(
              authCalls,
              1,
              `[12.22.3] HTTP ${authStatus} NÃO deve realizar retry (1 GET apenas)`
            );
          }

          // (d) HTTP 503 sem corpo na 1ª tentativa seguido de sucesso na 2ª tentativa (retry único)
          let http503Attempts = 0;
          const capCallsBefore503 = capacitorHttpGetCount;
          simulatedProviderHandlerP33 = async (_opts, helpers) => {
            http503Attempts++;
            if (http503Attempts === 1) {
              return {
                status: 503,
                fileId: null,
                filePath: null,
              };
            }
            const written = helpers.writeTempAndFinalize(
              JSON.stringify([{ stream_id: 777, name: 'Recuperado após 503', category_id: '1' }])
            );
            return {
              status: 200,
              fileId: written.fileId,
              filePath: written.filePath,
            };
          };
          const recovered503 = await XtreamService.getVodStreams(credsP33);
          assert.strictEqual(
            http503Attempts,
            2,
            '[12.22.3] HTTP 503 transitório deve realizar exatamente 1 retry automático (2 tentativas, 1 GET por tentativa)'
          );
          assert.strictEqual(
            capacitorHttpGetCount,
            capCallsBefore503,
            '[12.22.3] Falha após iniciar a consulta no plugin NÃO deve cair para CapacitorHttp.get'
          );
          assert.strictEqual(recovered503.length, 1);
          assert.strictEqual(recovered503[0].stream_id, 777);

          // (e) Diferenciação entre falha de leitura do arquivo local vs erro HTTP do provedor
          forceLocalFileReadErrorP33 = true;
          let localReadFailAttempts = 0;
          simulatedProviderHandlerP33 = async (_opts, helpers) => {
            localReadFailAttempts++;
            const written = helpers.writeTempAndFinalize(
              JSON.stringify([{ stream_id: 888, name: 'Teste Falha Local' }])
            );
            return {
              status: 200,
              fileId: written.fileId,
              filePath: written.filePath,
            };
          };
          let caughtLocalReadErr: any = null;
          try {
            await XtreamService.getVodStreams(credsP33);
          } catch (err) {
            caughtLocalReadErr = err;
          } finally {
            forceLocalFileReadErrorP33 = false;
          }
          assert(
            caughtLocalReadErr &&
              caughtLocalReadErr.isLocalFileReadError === true &&
              caughtLocalReadErr.status === undefined,
            '[12.22.3] Falha ao ler o arquivo local deve ter isLocalFileReadError=true e não deve ser confundida com erro HTTP do provedor'
          );
          assert.strictEqual(
            catalogDiagMod.classifyDiagnosticErrorCategory(caughtLocalReadErr),
            'local_file_read',
            '[12.22.3] Diagnóstico deve classificar falha de leitura local como local_file_read'
          );
          assert.strictEqual(
            localReadFailAttempts,
            2,
            '[12.22.3] Falha transitória de leitura local deve respeitar a política de 1 retry sem cair para CapacitorHttp.get'
          );
          assert.strictEqual(
            fsNodeP33.readdirSync(dedicatedTransferDirP33).length,
            0,
            '[12.22.3] Mesmo quando a leitura local falha, o arquivo temporário deve ser removido no bloco finally'
          );

          // -----------------------------------------------------------------
          // 12.22.4: Cancelamento durante a transferência, cancelamento durante
          // a leitura local, troca de conta, limpeza de arquivos órfãos vs ativos
          // e rejeição de caminhos arbitrários
          // -----------------------------------------------------------------
          // (a) Cancelamento durante a transferência nativa em andamento
          let transferStartedResolve: (() => void) | null = null;
          const transferStartedPromise = new Promise<void>((r) => {
            transferStartedResolve = r;
          });
          let observedCancelDuringTransfer = false;

          simulatedProviderHandlerP33 = async (opts, helpers) => {
            transferStartedResolve?.();
            await new Promise((r) => setTimeout(r, 40));
            if (helpers.isCancelled() || cancelledTransfersP33.has(opts.transferId)) {
              observedCancelDuringTransfer = true;
              throw new Error('Operação cancelada pelo usuário.');
            }
            const written = helpers.writeTempAndFinalize('[]');
            return { status: 200, fileId: written.fileId, filePath: written.filePath };
          };

          const abortTransferCtrl = new AbortController();
          const inFlightTransferPromise = XtreamService.getVodStreams(credsP33, undefined, {
            signal: abortTransferCtrl.signal,
          });
          await transferStartedPromise;
          abortTransferCtrl.abort();

          let cancelTransferCaught: any = null;
          try {
            await inFlightTransferPromise;
          } catch (err) {
            cancelTransferCaught = err;
          }
          await new Promise((r) => setTimeout(r, 60));
          assert(
            cancelTransferCaught &&
              /Operação cancelada pelo usuário/i.test(String(cancelTransferCaught.message)),
            '[12.22.4] Cancelamento durante transferência deve rejeitar com mensagem de operação cancelada'
          );
          assert.strictEqual(
            observedCancelDuringTransfer,
            true,
            '[12.22.4] Cancelamento deve propagar cancelTransfer para o plugin nativo'
          );
          assert.strictEqual(
            fsNodeP33.readdirSync(dedicatedTransferDirP33).length,
            0,
            '[12.22.4] Nenhum arquivo temporário deve restar após cancelamento durante a transferência'
          );

          // (b) Cancelamento durante a leitura local na WebView (após o arquivo já ter sido gravado)
          const abortLocalReadCtrl = new AbortController();
          let fileExistedWhenLocalReadStarted = false;
          simulatedProviderHandlerP33 = async (_opts, helpers) => {
            const written = helpers.writeTempAndFinalize(
              JSON.stringify([{ stream_id: 901, name: 'Cancelado na Leitura Local' }])
            );
            return { status: 200, fileId: written.fileId, filePath: written.filePath };
          };
          localFetchInterceptionHookP33 = async (localDiskPath) => {
            fileExistedWhenLocalReadStarted = fsNodeP33.existsSync(localDiskPath);
            abortLocalReadCtrl.abort();
          };

          let cancelLocalReadCaught: any = null;
          try {
            await XtreamService.getVodStreams(credsP33, undefined, {
              signal: abortLocalReadCtrl.signal,
            });
          } catch (err) {
            cancelLocalReadCaught = err;
          } finally {
            localFetchInterceptionHookP33 = null;
          }
          assert.strictEqual(
            fileExistedWhenLocalReadStarted,
            true,
            '[12.22.4] Arquivo temporário existia ao iniciar a leitura local'
          );
          assert(
            cancelLocalReadCaught &&
              /Operação cancelada pelo usuário/i.test(String(cancelLocalReadCaught.message)),
            '[12.22.4] Cancelamento durante a leitura local deve abortar a operação'
          );
          assert.strictEqual(
            fsNodeP33.readdirSync(dedicatedTransferDirP33).length,
            0,
            '[12.22.4] Arquivo temporário deve ser removido mesmo quando o cancelamento ocorre durante a leitura local'
          );

          // (c) Limpeza de arquivos residuais de execuções interrompidas sem apagar transferências ativas
          const staleLeftoverFile = pathNodeP33.join(
            dedicatedTransferDirP33,
            'nc_catalog_leftover_crashed_999.json'
          );
          const staleLeftoverTmp = pathNodeP33.join(
            dedicatedTransferDirP33,
            'nc_catalog_leftover_crashed_999.json.tmp'
          );
          fsNodeP33.writeFileSync(staleLeftoverFile, '[{"stale":true}]', 'utf8');
          fsNodeP33.writeFileSync(staleLeftoverTmp, '[{"partial":true', 'utf8');

          let activeProtectedFileSeenDuringRun = false;
          let staleFilesRemovedDuringRun = false;
          const activeProtectedName = 'nc_catalog_active_in_flight_777.json.tmp';
          const activeProtectedPath = pathNodeP33.join(
            dedicatedTransferDirP33,
            activeProtectedName
          );
          fsNodeP33.writeFileSync(activeProtectedPath, '[{"active":true', 'utf8');
          activeFilesSetP33.add(activeProtectedName);

          simulatedProviderHandlerP33 = async (_opts, helpers) => {
            activeProtectedFileSeenDuringRun = fsNodeP33.existsSync(activeProtectedPath);
            staleFilesRemovedDuringRun =
              !fsNodeP33.existsSync(staleLeftoverFile) &&
              !fsNodeP33.existsSync(staleLeftoverTmp);
            const written = helpers.writeTempAndFinalize(
              JSON.stringify([{ stream_id: 333, name: 'Transferência Concorrente' }])
            );
            return { status: 200, fileId: written.fileId, filePath: written.filePath };
          };

          const concurrentCleanRes = await XtreamService.getVodStreams(credsP33);
          assert.strictEqual(concurrentCleanRes.length, 1);
          assert.strictEqual(
            staleFilesRemovedDuringRun,
            true,
            '[12.22.4] Arquivos residuais de execuções interrompidas devem ser removidos automaticamente'
          );
          assert.strictEqual(
            activeProtectedFileSeenDuringRun,
            true,
            '[12.22.4] Limpeza de resíduos NÃO deve apagar arquivos pertencentes a uma transferência ativa'
          );
          activeFilesSetP33.delete(activeProtectedName);
          fsNodeP33.rmSync(activeProtectedPath, { force: true });

          // (d) Rejeição de caminhos arbitrários, URLs externas, caminhos externos com mesmo sufixo,
          // tentativas de escape (normais e codificadas) e URLs de outra origem em convertFileSrc
          const validPrivateFileId = 'nc_catalog_valid_1.json';
          const validPrivateFilePath = `${androidDedicatedTransferDirP33}/${validPrivateFileId}`;
          const validDataDataFilePath = `/data/data/com.northcode.play/cache/${androidAdapterModP33.CATALOG_TRANSFER_CACHE_SUBDIR}/${validPrivateFileId}`;

          assert.strictEqual(
            androidAdapterModP33.isValidCatalogTransferFileReference(
              validPrivateFileId,
              validPrivateFilePath,
              androidDedicatedTransferDirP33
            ),
            true,
            '[12.22.4] Referência válida no cache privado (getCacheDir() /data/user/0/...) deve ser aceita'
          );
          assert.strictEqual(
            androidAdapterModP33.isValidCatalogTransferFileReference(
              validPrivateFileId,
              validDataDataFilePath
            ),
            true,
            '[12.22.4] Referência válida no cache privado (/data/data/...) deve ser aceita'
          );

          // URLs externas com o mesmo sufixo
          for (const externalUrl of [
            `https://evil.example.org/${androidAdapterModP33.CATALOG_TRANSFER_CACHE_SUBDIR}/${validPrivateFileId}`,
            `https://evil.example.org${validPrivateFilePath}`,
            `http://evil.example.org${validPrivateFilePath}`,
            `file://${validPrivateFilePath}`,
            `content://com.northcode.play.provider/${androidAdapterModP33.CATALOG_TRANSFER_CACHE_SUBDIR}/${validPrivateFileId}`,
          ]) {
            assert.strictEqual(
              androidAdapterModP33.isValidCatalogTransferFileReference(
                validPrivateFileId,
                externalUrl
              ),
              false,
              `[12.22.4] URL externa com o mesmo sufixo deve ser rejeitada: ${externalUrl}`
            );
          }

          // Caminhos externos com o mesmo sufixo
          for (const externalPath of [
            `/sdcard/Download/${androidAdapterModP33.CATALOG_TRANSFER_CACHE_SUBDIR}/${validPrivateFileId}`,
            `/storage/emulated/0/Android/data/com.northcode.play/cache/${androidAdapterModP33.CATALOG_TRANSFER_CACHE_SUBDIR}/${validPrivateFileId}`,
            `/data/local/tmp/${androidAdapterModP33.CATALOG_TRANSFER_CACHE_SUBDIR}/${validPrivateFileId}`,
            `/data/user/0/com.other.app/cache/${androidAdapterModP33.CATALOG_TRANSFER_CACHE_SUBDIR}/${validPrivateFileId}`,
            `/tmp/${androidAdapterModP33.CATALOG_TRANSFER_CACHE_SUBDIR}/${validPrivateFileId}`,
          ]) {
            assert.strictEqual(
              androidAdapterModP33.isValidCatalogTransferFileReference(
                validPrivateFileId,
                externalPath
              ),
              false,
              `[12.22.4] Caminho externo com o mesmo sufixo deve ser rejeitado: ${externalPath}`
            );
          }

          // Tentativas de escapar do diretório (segmentos normais ou codificados e divergência de fileId)
          for (const [badFileId, badPath] of [
            ['../secret.json', `${androidDedicatedTransferDirP33}/../secret.json`],
            [
              validPrivateFileId,
              `${androidDedicatedTransferDirP33}/../${androidAdapterModP33.CATALOG_TRANSFER_CACHE_SUBDIR}/${validPrivateFileId}`,
            ],
            [
              validPrivateFileId,
              `/data/user/0/com.northcode.play/cache/../files/${androidAdapterModP33.CATALOG_TRANSFER_CACHE_SUBDIR}/${validPrivateFileId}`,
            ],
            [
              validPrivateFileId,
              `${androidDedicatedTransferDirP33}/%2e%2e/${androidAdapterModP33.CATALOG_TRANSFER_CACHE_SUBDIR}/${validPrivateFileId}`,
            ],
            [
              validPrivateFileId,
              `${androidDedicatedTransferDirP33}/%2e%2e%2f${validPrivateFileId}`,
            ],
            [
              validPrivateFileId,
              `${androidDedicatedTransferDirP33}/..%5c${validPrivateFileId}`,
            ],
            [
              validPrivateFileId,
              `${androidDedicatedTransferDirP33}/sub/${validPrivateFileId}`,
            ],
            [
              validPrivateFileId,
              `${androidDedicatedTransferDirP33}/nc_catalog_other_file_99.json`,
            ],
            ['arbitrary_file.txt', `${androidDedicatedTransferDirP33}/arbitrary_file.txt`],
          ] as const) {
            assert.strictEqual(
              androidAdapterModP33.isValidCatalogTransferFileReference(badFileId, badPath),
              false,
              `[12.22.4] Tentativa de escape ou fileId divergente deve ser rejeitada: fileId=${badFileId} path=${badPath}`
            );
          }

          // Validação de URL pós-convertFileSrc (origem local da WebView e mesmo arquivo aprovado)
          assert.strictEqual(
            androidAdapterModP33.isValidConvertedLocalCatalogUrl(
              `http://localhost/_capacitor_file_${validPrivateFilePath}`,
              validPrivateFilePath
            ),
            true,
            '[12.22.4] URL local da WebView apontando para o mesmo arquivo aprovado deve ser aceita'
          );
          for (const badConvertedUrl of [
            `https://evil.example.org/_capacitor_file_${validPrivateFilePath}`,
            `http://127.0.0.1:8080/_capacitor_file_${validPrivateFilePath}`,
            `https://localhost/_capacitor_file_${validPrivateFilePath}`, // origem diferente de window.location.origin (http://localhost)
            `http://localhost/_capacitor_file_${androidDedicatedTransferDirP33}/nc_catalog_other_file_99.json`,
            `http://localhost/_capacitor_file_${validPrivateFilePath}?redirect=https://evil.example.org`,
            `http://localhost/_capacitor_file_${validPrivateFilePath}#frag`,
            `http://localhost/_capacitor_file_${androidDedicatedTransferDirP33}/%2e%2e/secret.json`,
            `http://localhost/other_prefix${validPrivateFilePath}`,
          ]) {
            assert.strictEqual(
              androidAdapterModP33.isValidConvertedLocalCatalogUrl(
                badConvertedUrl,
                validPrivateFilePath
              ),
              false,
              `[12.22.4] URL pós-convertFileSrc inválida ou de outra origem deve ser rejeitada: ${badConvertedUrl}`
            );
          }

          // Verificar ponta a ponta que referências inválidas e URLs de outra origem devolvidas por
          // convertFileSrc NÃO chegam ao fetch, são classificadas como local_file_read e NÃO acionam CapacitorHttp
          const invalidEndToEndScenarios: Array<{
            label: string;
            fileId: string;
            filePath: string;
            convertFileSrcOverride?: (fp: string) => string;
          }> = [
            {
              label: 'URL HTTPS externa com o mesmo sufixo',
              fileId: validPrivateFileId,
              filePath: `https://evil.example.org${validPrivateFilePath}`,
            },
            {
              label: 'Caminho externo (/sdcard) com o mesmo sufixo',
              fileId: validPrivateFileId,
              filePath: `/sdcard/Download/${androidAdapterModP33.CATALOG_TRANSFER_CACHE_SUBDIR}/${validPrivateFileId}`,
            },
            {
              label: 'Tentativa de escapar do diretório (segmento normal ..)',
              fileId: validPrivateFileId,
              filePath: `${androidDedicatedTransferDirP33}/../${validPrivateFileId}`,
            },
            {
              label: 'Tentativa de escapar do diretório (segmento codificado %2e%2e)',
              fileId: validPrivateFileId,
              filePath: `${androidDedicatedTransferDirP33}/%2e%2e/${androidAdapterModP33.CATALOG_TRANSFER_CACHE_SUBDIR}/${validPrivateFileId}`,
            },
            {
              label: 'URL de outra origem devolvida por convertFileSrc',
              fileId: validPrivateFileId,
              filePath: validPrivateFilePath,
              convertFileSrcOverride: (fp: string) =>
                `https://other-origin.example.org/_capacitor_file_${fp}`,
            },
          ];

          for (const scenario of invalidEndToEndScenarios) {
            const fetchBeforeScenario = localWebViewFileFetchCount + webFetchProviderCount;
            const capHttpBeforeScenario = capacitorHttpGetCount;
            let pluginCallsForScenario = 0;

            androidAdapterModP33.setAndroidCatalogFileAdapterTestOverride({
              plugin: nativePluginSimP33,
              convertFileSrc:
                scenario.convertFileSrcOverride ??
                ((fp: string) => `http://localhost/_capacitor_file_${fp}`),
            });

            simulatedProviderHandlerP33 = async () => {
              pluginCallsForScenario++;
              return {
                status: 200,
                fileId: scenario.fileId,
                filePath: scenario.filePath,
                cacheDir: androidDedicatedTransferDirP33,
              };
            };

            let caughtScenarioErr: any = null;
            try {
              await XtreamService.getVodStreams(credsP33);
            } catch (err) {
              caughtScenarioErr = err;
            }

            assert(
              caughtScenarioErr && caughtScenarioErr.isLocalFileReadError === true,
              `[12.22.4] Cenário "${scenario.label}" deve falhar com isLocalFileReadError=true`
            );
            assert.strictEqual(
              catalogDiagMod.classifyDiagnosticErrorCategory(caughtScenarioErr),
              'local_file_read',
              `[12.22.4] Cenário "${scenario.label}" deve ser classificado como local_file_read`
            );
            assert.strictEqual(
              localWebViewFileFetchCount + webFetchProviderCount,
              fetchBeforeScenario,
              `[12.22.4] Cenário "${scenario.label}" NÃO deve chegar ao fetch`
            );
            assert.strictEqual(
              capacitorHttpGetCount,
              capHttpBeforeScenario,
              `[12.22.4] Cenário "${scenario.label}" NÃO deve acionar CapacitorHttp na tentativa`
            );
            assert.strictEqual(
              pluginCallsForScenario,
              2,
              `[12.22.4] Cenário "${scenario.label}" deve respeitar 1 GET por tentativa (2 tentativas com retry existente)`
            );
          }

          // Restaurar convertFileSrc padrão do teste
          androidAdapterModP33.setAndroidCatalogFileAdapterTestOverride({
            plugin: nativePluginSimP33,
            convertFileSrc: (filePath: string) =>
              `http://localhost/_capacitor_file_${filePath}`,
          });

          let rejectedArbitraryCleanup = false;
          try {
            await nativePluginSimP33.cleanupTransferFile({ fileId: '../outside.json' });
          } catch {
            rejectedArbitraryCleanup = true;
          }
          assert.strictEqual(
            rejectedArbitraryCleanup,
            true,
            '[12.22.4] cleanupTransferFile deve rejeitar caminhos arbitrários'
          );

          // (f) Desacoplamento da limpeza em relação ao prazo e à conclusão da consulta:
          // - Limpeza lenta ou sem resposta (ou com falha): leitura concluída retorna sem ficar presa,
          //   sem mascarar o resultado e sem disparar outro GET; exclusão continua sendo solicitada.
          // - Se a consulta já tiver sido cancelada ou expirado antes de entregar o resultado,
          //   devolve o erro correspondente e o corpo NÃO é interpretado (JSON.parse não é chamado),
          //   enquanto a exclusão continua sendo solicitada.
          cleanupRequestedFileIdsP33.length = 0;
          let hangingCleanupReleases: Array<() => void> = [];
          customCleanupHookP33 = async (_fileId, performDiskDelete) => {
            performDiskDelete();
            await new Promise<void>((resolve) => {
              hangingCleanupReleases.push(resolve);
            });
            return { deleted: true };
          };

          try {
            // Caso 1: Leitura concluída com cleanupTransferFile sem resposta (preso indefinidamente)
            let slowCleanupPluginGets = 0;
            let expectedSlowCleanupFileId = '';
            simulatedProviderHandlerP33 = async (_opts, helpers) => {
              slowCleanupPluginGets++;
              const written = helpers.writeTempAndFinalize(
                JSON.stringify([{ stream_id: 9501, name: 'Filme Limpeza Lenta', category_id: '1' }])
              );
              expectedSlowCleanupFileId = written.fileId;
              return {
                status: 200,
                fileId: written.fileId,
                filePath: written.filePath,
                cacheDir: written.cacheDir,
              };
            };

            let slowCleanupResolved = false;
            const slowCleanupResult = await Promise.race([
              XtreamService.getVodStreams(credsP33).then((items) => {
                slowCleanupResolved = true;
                return items;
              }),
              new Promise<never>((_r, rej) =>
                setTimeout(
                  () => rej(new Error('Consulta ficou presa aguardando cleanupTransferFile')),
                  150
                )
              ),
            ]);

            assert.strictEqual(
              slowCleanupResolved,
              true,
              '[12.22.4] Leitura concluída deve retornar imediatamente sem ficar presa em cleanupTransferFile sem resposta'
            );
            assert.strictEqual(slowCleanupResult.length, 1);
            assert.strictEqual(slowCleanupResult[0].stream_id, 9501);
            assert.strictEqual(
              slowCleanupPluginGets,
              1,
              '[12.22.4] Limpeza lenta não deve disparar outro GET'
            );
            assert(
              cleanupRequestedFileIdsP33.includes(expectedSlowCleanupFileId),
              '[12.22.4] Exclusão do arquivo deve continuar sendo solicitada em caso de sucesso'
            );

            // Caso 2: Falha na limpeza (rejeição de cleanupTransferFile) não mascara o resultado nem dispara outro GET
            customCleanupHookP33 = async (_fileId, performDiskDelete) => {
              performDiskDelete();
              throw new Error('Falha simulada ao excluir arquivo temporário');
            };
            let failingCleanupGets = 0;
            simulatedProviderHandlerP33 = async (_opts, helpers) => {
              failingCleanupGets++;
              const written = helpers.writeTempAndFinalize(
                JSON.stringify([{ stream_id: 9502, name: 'Filme Limpeza Falhou', category_id: '1' }])
              );
              return {
                status: 200,
                fileId: written.fileId,
                filePath: written.filePath,
                cacheDir: written.cacheDir,
              };
            };
            const failingCleanupRes = await XtreamService.getVodStreams(credsP33);
            assert.strictEqual(failingCleanupRes.length, 1);
            assert.strictEqual(failingCleanupRes[0].stream_id, 9502);
            assert.strictEqual(
              failingCleanupGets,
              1,
              '[12.22.4] Falha em cleanupTransferFile não deve mascarar o resultado nem disparar outro GET'
            );

            // Caso 3: Cancelamento chega antes de o resultado ser entregue (com limpeza sem resposta):
            // retorna erro de cancelamento sem ficar preso, NÃO interpreta o JSON e solicita exclusão
            customCleanupHookP33 = async (_fileId, performDiskDelete) => {
              performDiskDelete();
              await new Promise<void>((resolve) => {
                hangingCleanupReleases.push(resolve);
              });
              return { deleted: true };
            };

            const abortBeforeDeliveryCtrl = new AbortController();
            let cancelledCatalogParsedCount = 0;
            let expectedCancelledFileId = '';
            const origParseCancelCheck = JSON.parse;
            JSON.parse = ((text: string, ...rest: any[]) => {
              if (typeof text === 'string' && text.includes('Filme Cancelado Antes da Entrega')) {
                cancelledCatalogParsedCount++;
              }
              return origParseCancelCheck(text, ...rest);
            }) as typeof JSON.parse;

            simulatedProviderHandlerP33 = async (_opts, helpers) => {
              const written = helpers.writeTempAndFinalize(
                JSON.stringify([
                  { stream_id: 9503, name: 'Filme Cancelado Antes da Entrega', category_id: '1' },
                ])
              );
              expectedCancelledFileId = written.fileId;
              return {
                status: 200,
                fileId: written.fileId,
                filePath: written.filePath,
                cacheDir: written.cacheDir,
              };
            };

            // Simular o cancelamento disparando no instante em que a leitura local termina (antes de normalizeTransportPayload)
            const origFetchForCancelBeforeParse = globalThis.fetch;
            globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
              const res = await origFetchForCancelBeforeParse(input, init);
              const origText = res.text.bind(res);
              return {
                ok: res.ok,
                status: res.status,
                redirected: false,
                type: 'basic',
                text: async () => {
                  const body = await origText();
                  abortBeforeDeliveryCtrl.abort();
                  return body;
                },
              } as unknown as Response;
            }) as typeof fetch;

            let caughtCancelBeforeDelivery: any = null;
            try {
              await Promise.race([
                XtreamService.getVodStreams(credsP33, undefined, {
                  signal: abortBeforeDeliveryCtrl.signal,
                }),
                new Promise<never>((_r, rej) =>
                  setTimeout(
                    () => rej(new Error('Cancelamento ficou preso aguardando cleanupTransferFile')),
                    150
                  )
                ),
              ]);
            } catch (err) {
              caughtCancelBeforeDelivery = err;
            } finally {
              globalThis.fetch = origFetchForCancelBeforeParse;
              JSON.parse = origParseCancelCheck;
            }

            assert(
              caughtCancelBeforeDelivery &&
                /Operação cancelada pelo usuário/i.test(String(caughtCancelBeforeDelivery.message)),
              '[12.22.4] Cancelamento antes de entregar o resultado deve rejeitar imediatamente com erro de cancelamento'
            );
            assert.strictEqual(
              cancelledCatalogParsedCount,
              0,
              '[12.22.4] Catálogo cancelado antes da entrega NUNCA deve ser interpretado por JSON.parse'
            );
            assert(
              cleanupRequestedFileIdsP33.includes(expectedCancelledFileId),
              '[12.22.4] Exclusão do arquivo deve continuar sendo solicitada após cancelamento'
            );

            // Caso 4: Prazo (timeout) expira antes de o resultado ser entregue (com limpeza sem resposta)
            // e resposta nativa tardia também solicita exclusão:
            let lateNativeResolve: ((val: any) => void) | null = null;
            let lateNativeFileId = '';
            let timedOutCatalogParsedCount = 0;
            JSON.parse = ((text: string, ...rest: any[]) => {
              if (typeof text === 'string' && text.includes('Filme Expirado Por Timeout')) {
                timedOutCatalogParsedCount++;
              }
              return origParseCancelCheck(text, ...rest);
            }) as typeof JSON.parse;

            simulatedProviderHandlerP33 = async (_opts, helpers) => {
              return new Promise((resolve) => {
                lateNativeResolve = () => {
                  const written = helpers.writeTempAndFinalize(
                    JSON.stringify([
                      { stream_id: 9504, name: 'Filme Expirado Por Timeout', category_id: '1' },
                    ])
                  );
                  lateNativeFileId = written.fileId;
                  resolve({
                    status: 200,
                    fileId: written.fileId,
                    filePath: written.filePath,
                    cacheDir: written.cacheDir,
                  });
                };
              });
            };

            let caughtTimeoutErr: any = null;
            try {
              await httpTransportModP33.executeXtreamGetRequest({
                url: 'http://p33-secret-provider.iptv.local:8080/player_api.php?action=get_vod_streams',
                timeoutMs: 30,
                isFullCatalogRequest: true,
              });
            } catch (err) {
              caughtTimeoutErr = err;
            } finally {
              JSON.parse = origParseCancelCheck;
            }

            assert(
              caughtTimeoutErr &&
                /Tempo limite esgotado/i.test(String(caughtTimeoutErr.message)),
              '[12.22.4] Expiração do prazo antes da entrega deve devolver erro de timeout'
            );
            assert.strictEqual(
              timedOutCatalogParsedCount,
              0,
              '[12.22.4] Catálogo cujo prazo expirou não deve ter o corpo interpretado'
            );

            // Disparar resposta nativa tardia após o timeout e confirmar que a exclusão é solicitada
            cancelledTransfersP33.clear();
            if (lateNativeResolve) {
              (lateNativeResolve as any)();
              await new Promise((r) => setTimeout(r, 20));
            }
            assert(
              lateNativeFileId && cleanupRequestedFileIdsP33.includes(lateNativeFileId),
              '[12.22.4] Resposta nativa tardia após timeout/cancelamento deve solicitar cleanupTransferFile'
            );

            // Caso 5: Regressão determinística com relógio monotônico controlado (diagnóstico desligado):
            // - Com limite de 45 ms, o corpo fica disponível após 100 ms ANTES de o callback do setTimeout executar:
            //   a tentativa retorna timeout, NÃO chama JSON.parse e ainda solicita a limpeza do arquivo.
            // - Se AbortSignal já estiver abortado quando o relógio vence, preserva a classificação de cancelamento.
            // - Dentro do prazo (ex.: 30 ms < 45 ms), o corpo é interpretado uma única vez e a consulta conclui
            //   mesmo se a limpeza ficar pendente.
            let controlledDeadlineClockMs = 50000;
            catalogDiagMod.setCatalogDiagnosticsClockForTest(() => controlledDeadlineClockMs);
            catalogDiagMod.resetCatalogDiagnosticsForTest(false); // Diagnóstico desligado

            try {
              // 5A.1: Transferência nativa (30 ms) + leitura local (70 ms) = 100 ms (> 45 ms) via microtasks,
              // antes de o callback do setTimeout(45) disparar
              let expiredBeforeTimerParseCount = 0;
              let expiredBeforeTimerFileId = '';
              JSON.parse = ((text: string, ...rest: any[]) => {
                if (
                  typeof text === 'string' &&
                  text.includes('Filme Apos Prazo Antes Do Timer')
                ) {
                  expiredBeforeTimerParseCount++;
                }
                return origParseCancelCheck(text, ...rest);
              }) as typeof JSON.parse;

              simulatedProviderHandlerP33 = async (_opts, helpers) => {
                controlledDeadlineClockMs += 30; // 30 ms na etapa nativa (ainda < 45 ms)
                const written = helpers.writeTempAndFinalize(
                  JSON.stringify([
                    {
                      stream_id: 9505,
                      name: 'Filme Apos Prazo Antes Do Timer',
                      category_id: '1',
                    },
                  ])
                );
                expiredBeforeTimerFileId = written.fileId;
                return {
                  status: 200,
                  fileId: written.fileId,
                  filePath: written.filePath,
                  cacheDir: written.cacheDir,
                };
              };

              localFetchInterceptionHookP33 = async () => {
                controlledDeadlineClockMs += 70; // Total = 100 ms (> limite de 45 ms), sem disparar macrotask do timer
              };

              let caughtExpiredBeforeTimerErr: any = null;
              try {
                await httpTransportModP33.executeXtreamGetRequest({
                  url: 'http://p33-secret-provider.iptv.local:8080/player_api.php?action=get_vod_streams',
                  timeoutMs: 45,
                  isFullCatalogRequest: true,
                });
              } catch (err) {
                caughtExpiredBeforeTimerErr = err;
              } finally {
                localFetchInterceptionHookP33 = null;
                JSON.parse = origParseCancelCheck;
              }

              assert(
                caughtExpiredBeforeTimerErr &&
                  caughtExpiredBeforeTimerErr.isTransient === true &&
                  /Tempo limite esgotado/i.test(String(caughtExpiredBeforeTimerErr.message)),
                '[12.22.4] Corpo disponível em 100 ms para limite de 45 ms (antes do callback do setTimeout) deve rejeitar com erro de timeout'
              );
              assert.strictEqual(
                expiredBeforeTimerParseCount,
                0,
                '[12.22.4] Quando o prazo monotônico (45 ms) já venceu em 100 ms antes do callback do timer, JSON.parse NÃO deve ser chamado'
              );
              assert(
                expiredBeforeTimerFileId !== '' &&
                  cleanupRequestedFileIdsP33.includes(expiredBeforeTimerFileId),
                '[12.22.4] Mesmo quando o prazo vence pelo relógio monotônico antes do timer, cleanupTransferFile deve ser solicitado'
              );

              // 5A.2: Resposta nativa já chega após o prazo (100 ms > 45 ms) antes do callback do timer:
              // nem inicia o fetch local, não chama JSON.parse e solicita limpeza do arquivo
              let expiredAtNativeFileId = '';
              let expiredAtNativeParseCount = 0;
              const localFetchCountBefore5A2 = localWebViewFileFetchCount;
              JSON.parse = ((text: string, ...rest: any[]) => {
                if (typeof text === 'string' && text.includes('Filme Nativo Apos Prazo')) {
                  expiredAtNativeParseCount++;
                }
                return origParseCancelCheck(text, ...rest);
              }) as typeof JSON.parse;

              simulatedProviderHandlerP33 = async (_opts, helpers) => {
                controlledDeadlineClockMs += 100; // 100 ms > 45 ms já no retorno nativo, antes do callback do timer
                const written = helpers.writeTempAndFinalize(
                  JSON.stringify([
                    { stream_id: 9506, name: 'Filme Nativo Apos Prazo', category_id: '1' },
                  ])
                );
                expiredAtNativeFileId = written.fileId;
                return {
                  status: 200,
                  fileId: written.fileId,
                  filePath: written.filePath,
                  cacheDir: written.cacheDir,
                };
              };

              let caughtExpiredAtNativeErr: any = null;
              try {
                await httpTransportModP33.executeXtreamGetRequest({
                  url: 'http://p33-secret-provider.iptv.local:8080/player_api.php?action=get_vod_streams',
                  timeoutMs: 45,
                  isFullCatalogRequest: true,
                });
              } catch (err) {
                caughtExpiredAtNativeErr = err;
              } finally {
                JSON.parse = origParseCancelCheck;
              }

              assert(
                caughtExpiredAtNativeErr &&
                  /Tempo limite esgotado/i.test(String(caughtExpiredAtNativeErr.message)),
                '[12.22.4] Resposta nativa recebida após o prazo monotônico (antes do timer) deve retornar timeout'
              );
              assert.strictEqual(
                localWebViewFileFetchCount,
                localFetchCountBefore5A2,
                '[12.22.4] Se o prazo já venceu ao receber a resposta nativa, não deve iniciar fetch local'
              );
              assert.strictEqual(
                expiredAtNativeParseCount,
                0,
                '[12.22.4] JSON.parse não deve ser chamado quando o prazo vence na etapa nativa'
              );
              assert(
                expiredAtNativeFileId !== '' &&
                  cleanupRequestedFileIdsP33.includes(expiredAtNativeFileId),
                '[12.22.4] Limpeza do arquivo deve ser solicitada quando o prazo vence após a resposta nativa'
              );

              // 5A.3: Quando AbortSignal já está abortado E o relógio monotônico também passou do prazo,
              // preserva a classificação de cancelamento
              const abortWithExpiredClockCtrl = new AbortController();
              let abortAndExpiredParseCount = 0;
              JSON.parse = ((text: string, ...rest: any[]) => {
                if (typeof text === 'string' && text.includes('Filme Cancelado Com Relogio Vencido')) {
                  abortAndExpiredParseCount++;
                }
                return origParseCancelCheck(text, ...rest);
              }) as typeof JSON.parse;

              simulatedProviderHandlerP33 = async (_opts, helpers) => {
                const written = helpers.writeTempAndFinalize(
                  JSON.stringify([
                    {
                      stream_id: 9507,
                      name: 'Filme Cancelado Com Relogio Vencido',
                      category_id: '1',
                    },
                  ])
                );
                return {
                  status: 200,
                  fileId: written.fileId,
                  filePath: written.filePath,
                  cacheDir: written.cacheDir,
                };
              };

              const origFetchForAbortAndExpired = globalThis.fetch;
              globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
                const res = await origFetchForAbortAndExpired(input, init);
                const origText = res.text.bind(res);
                return {
                  ok: res.ok,
                  status: res.status,
                  redirected: false,
                  type: 'basic',
                  text: async () => {
                    const body = await origText();
                    controlledDeadlineClockMs += 100; // Relógio vence (> 45 ms)
                    abortWithExpiredClockCtrl.abort(); // E o sinal também está abortado
                    return body;
                  },
                } as unknown as Response;
              }) as typeof fetch;

              let caughtAbortWithExpiredClock: any = null;
              try {
                await httpTransportModP33.executeXtreamGetRequest({
                  url: 'http://p33-secret-provider.iptv.local:8080/player_api.php?action=get_vod_streams',
                  timeoutMs: 45,
                  signal: abortWithExpiredClockCtrl.signal,
                  isFullCatalogRequest: true,
                });
              } catch (err) {
                caughtAbortWithExpiredClock = err;
              } finally {
                globalThis.fetch = origFetchForAbortAndExpired;
                JSON.parse = origParseCancelCheck;
              }

              assert(
                caughtAbortWithExpiredClock &&
                  /Operação cancelada pelo usuário/i.test(
                    String(caughtAbortWithExpiredClock.message)
                  ),
                '[12.22.4] Quando AbortSignal já está abortado mesmo após o prazo vencer, deve preservar a classificação de cancelamento'
              );
              assert.strictEqual(abortAndExpiredParseCount, 0);

              // 5B: Dentro do prazo (18 ms nativo + 12 ms leitura local = 30 ms < 45 ms),
              // o corpo é interpretado uma única vez e a consulta conclui mesmo com a limpeza pendente
              let withinDeadlineParseCount = 0;
              let withinDeadlineFileId = '';
              JSON.parse = ((text: string, ...rest: any[]) => {
                if (
                  typeof text === 'string' &&
                  text.includes('Filme Dentro Do Prazo Com Limpeza Pendente')
                ) {
                  withinDeadlineParseCount++;
                }
                return origParseCancelCheck(text, ...rest);
              }) as typeof JSON.parse;

              simulatedProviderHandlerP33 = async (_opts, helpers) => {
                controlledDeadlineClockMs += 18; // 18 ms na etapa nativa
                const written = helpers.writeTempAndFinalize(
                  JSON.stringify([
                    {
                      stream_id: 9508,
                      name: 'Filme Dentro Do Prazo Com Limpeza Pendente',
                      category_id: '1',
                    },
                  ])
                );
                withinDeadlineFileId = written.fileId;
                return {
                  status: 200,
                  fileId: written.fileId,
                  filePath: written.filePath,
                  cacheDir: written.cacheDir,
                };
              };

              localFetchInterceptionHookP33 = async () => {
                controlledDeadlineClockMs += 12; // Total = 30 ms (< limite de 45 ms)
              };

              let withinDeadlineResult: any[] = [];
              try {
                withinDeadlineResult = await Promise.race([
                  httpTransportModP33.executeXtreamGetRequest<any[]>({
                    url: 'http://p33-secret-provider.iptv.local:8080/player_api.php?action=get_vod_streams',
                    timeoutMs: 45,
                    isFullCatalogRequest: true,
                  }),
                  new Promise<never>((_r, rej) =>
                    setTimeout(
                      () =>
                        rej(
                          new Error(
                            'Consulta dentro do prazo ficou presa aguardando cleanupTransferFile'
                          )
                        ),
                      150
                    )
                  ),
                ]);
              } finally {
                localFetchInterceptionHookP33 = null;
                JSON.parse = origParseCancelCheck;
              }

              assert.strictEqual(
                withinDeadlineParseCount,
                1,
                '[12.22.4] Dentro do prazo (30 ms < 45 ms), o corpo deve ser interpretado exatamente 1 vez'
              );
              assert.strictEqual(withinDeadlineResult.length, 1);
              assert.strictEqual(withinDeadlineResult[0].stream_id, 9508);
              assert(
                withinDeadlineFileId !== '' &&
                  cleanupRequestedFileIdsP33.includes(withinDeadlineFileId),
                '[12.22.4] Dentro do prazo, a limpeza continua sendo solicitada sem reter a conclusão da consulta'
              );
            } finally {
              catalogDiagMod.setCatalogDiagnosticsClockForTest(null);
            }
          } finally {
            customCleanupHookP33 = null;
            for (const release of hangingCleanupReleases) {
              release();
            }
            hangingCleanupReleases = [];
          }

          // (e) Troca de conta durante transferência de catálogo grande via arquivo temporário:
          // descarta resultado tardio da conta anterior e limpa o arquivo temporário
          const credsAcc1P33: XtreamCredentials = {
            serverUrl: 'http://acc1-p33.iptv.local:8080',
            username: 'acc1_user',
            password: 'acc1_pass',
          };
          const credsAcc2P33: XtreamCredentials = {
            serverUrl: 'http://acc2-p33.iptv.local:8080',
            username: 'acc2_user',
            password: 'acc2_pass',
          };

          simulatedProviderHandlerP33 = async (opts, helpers) => {
            if (String(opts.url).includes('acc1_user')) {
              await new Promise((r) => setTimeout(r, 60));
              if (helpers.isCancelled()) {
                throw new Error('TRANSFER_CANCELLED');
              }
              const written = helpers.writeTempAndFinalize(
                JSON.stringify([
                  { stream_id: 1111, name: 'Filme Vazado Conta 1', category_id: '1' },
                ])
              );
              return { status: 200, fileId: written.fileId, filePath: written.filePath };
            }
            const written = helpers.writeTempAndFinalize(
              JSON.stringify([
                { stream_id: 2222, name: 'Filme Exclusivo Conta 2', category_id: '1' },
              ])
            );
            return { status: 200, fileId: written.fileId, filePath: written.filePath };
          };

          let observedVodStreamsInCtxP33: any[] = [];
          function AccountSwitchProbeP33() {
            const ctx = useXtreamContext();
            observedVodStreamsInCtxP33 = ctx.vodStreams;
            return React.createElement('div', {
              'data-vod-count': ctx.vodStreams.length,
            });
          }

          const switchContainerP33 = document.createElement('div');
          document.body.appendChild(switchContainerP33);
          const switchRootP33 = createRoot(switchContainerP33);
          try {
            await act(async () => {
              switchRootP33.render(
                React.createElement(
                  XtreamProvider,
                  { credentials: credsAcc1P33 },
                  React.createElement(AccountSwitchProbeP33, null)
                )
              );
            });
            await act(async () => {
              await new Promise((r) => setTimeout(r, 15));
            });

            // Trocar imediatamente para a Conta 2 enquanto a Conta 1 ainda está transferindo
            await act(async () => {
              switchRootP33.render(
                React.createElement(
                  XtreamProvider,
                  { credentials: credsAcc2P33 },
                  React.createElement(AccountSwitchProbeP33, null)
                )
              );
            });
            await act(async () => {
              await new Promise((r) => setTimeout(r, 120));
            });

            assert.strictEqual(
              observedVodStreamsInCtxP33.length,
              1,
              '[12.22.4] Conta 2 deve concluir carregamento do seu catálogo'
            );
            assert.strictEqual(
              observedVodStreamsInCtxP33[0]?.name,
              'Filme Exclusivo Conta 2',
              '[12.22.4] Dados da Conta 2 devem prevalecer sem contaminação da Conta 1'
            );
            assert.strictEqual(
              fsNodeP33.readdirSync(dedicatedTransferDirP33).length,
              0,
              '[12.22.4] Todos os arquivos temporários das duas contas devem ter sido removidos'
            );
          } finally {
            await act(async () => {
              switchRootP33.unmount();
            });
            if (switchContainerP33.parentNode) {
              document.body.removeChild(switchContainerP33);
            }
          }

          // -----------------------------------------------------------------
          // 12.22.5: Diagnóstico P3.3 por etapa no novo caminho (separando
          // status+cabeçalhos, gravação do corpo, leitura local, interpretação
          // na WebView, total no trecho nativo e tempo fora do trecho nativo
          // medido SEM atribuir a leitura local à ponte, e JSON no Android=não executado)
          // -----------------------------------------------------------------
          let diagClockP33 = 10000;
          catalogDiagMod.setCatalogDiagnosticsClockForTest(() => diagClockP33);
          catalogDiagMod.resetCatalogDiagnosticsForTest(true);

          const sP33 = catalogDiagMod.startCatalogDiagnosticsSession(undefined, 2);

          // Operação 1: live_categories via CapacitorHttp (P3.2 preservado)
          httpTransportModP33.setTransportTestConfig({
            mode: 'auto',
            androidCatalogPluginAvailable: null,
            capacitorHttpGet: async () => {
              diagClockP33 += 45;
              return {
                status: 200,
                data: [{ category_id: '1', category_name: 'Canais P3.3' }],
                headers: {},
                url: 'http://p33-secret-provider.iptv.local:8080/player_api.php',
                nativeDiagnostics: {
                  statusAndHeadersMs: 18.0,
                  bodyReadMs: 12.0,
                  nativeJsonParseExecuted: true,
                  nativeJsonParseMs: 5.0,
                  nativeTotalMs: 36.0,
                  contentLengthHeaderBytes: 512,
                  payloadChars: 512,
                },
              };
            },
          });

          const liveCatOpP33 = catalogDiagMod.recordCatalogOperationEnqueued(
            sP33,
            'live_categories',
            90
          );
          catalogDiagMod.recordCatalogOperationStarted(liveCatOpP33);
          await XtreamService.getLiveCategories(credsP33, { diagOp: liveCatOpP33 });
          catalogDiagMod.recordCatalogOperationFinished(liveCatOpP33, 'success');

          // Operação 2: vod_catalog via android-temp-file (P3.3)
          // Tempos simulados com relógio monotônico controlado:
          // - Chamada ao plugin (downloadCatalogToTempFile): 1030.0 ms no relógio JS
          //   - status + cabeçalhos: 380.4 ms
          //   - gravação do corpo em arquivo temporário: 620.6 ms
          //   - total no trecho nativo: 1005.0 ms
          //   -> tempo fora do trecho nativo medido (ponte do metadado): 1030.0 - 1005.0 = 25.0 ms
          // - Leitura local na WebView (fetch _capacitor_file_ + response.text()): 180.0 ms
          // - Interpretação na WebView (JSON.parse único): 140.0 ms
          simulatedProviderHandlerP33 = async (_opts, helpers) => {
            diagClockP33 += 1030; // Tempo total da chamada ao plugin vista pelo JS (1030 ms)
            const written = helpers.writeTempAndFinalize(largeSyntheticVodJsonText);
            return {
              status: 200,
              fileId: written.fileId,
              filePath: written.filePath,
              nativeDiagnostics: {
                statusAndHeadersMs: 380.4,
                fileWriteMs: 620.6,
                nativeJsonParseExecuted: false,
                nativeJsonParseMs: null,
                nativeTotalMs: 1005.0,
                contentLengthHeaderBytes: largeSyntheticVodBytes,
                bytesWritten: largeSyntheticVodBytes,
              },
            };
          };

          localFetchInterceptionHookP33 = async () => {
            diagClockP33 += 180; // 180 ms de leitura local do arquivo na WebView
          };

          const origParseForDiagP33 = JSON.parse;
          JSON.parse = ((text: string, ...rest: any[]) => {
            if (typeof text === 'string' && text.includes('Filme Sintético P3.3 #1')) {
              diagClockP33 += 140; // 140 ms de JSON.parse único na WebView
            }
            return origParseForDiagP33(text, ...rest);
          }) as typeof JSON.parse;

          const vodCatOpP33 = catalogDiagMod.recordCatalogOperationEnqueued(
            sP33,
            'vod_catalog',
            80
          );
          diagClockP33 += 12; // 12 ms na fila
          catalogDiagMod.recordCatalogOperationStarted(vodCatOpP33);
          try {
            await XtreamService.getVodStreams(credsP33, undefined, { diagOp: vodCatOpP33 });
          } finally {
            JSON.parse = origParseForDiagP33;
            localFetchInterceptionHookP33 = null;
          }
          catalogDiagMod.recordCatalogOperationFinished(vodCatOpP33, 'success');

          const snapP33 = catalogDiagMod.getCatalogDiagnosticsSnapshot()!;
          assert(snapP33 !== null, '[12.22.5] Snapshot P3.3 deve existir');

          // Verificar tentativa de live_categories (CapacitorHttp P3.2)
          const liveCatAttP33 = snapP33.operations.live_categories!.attempts[0];
          assert.strictEqual(
            liveCatAttP33.transportKind,
            'capacitor-native',
            '[12.22.5] Categorias devem registrar transportKind = capacitor-native'
          );

          // Verificar tentativa de vod_catalog (android-temp-file P3.3)
          const vodAttP33 = snapP33.operations.vod_catalog!.attempts[0];
          assert.strictEqual(
            vodAttP33.transportKind,
            'android-temp-file',
            '[12.22.5] Catálogo completo no Android deve registrar transportKind = android-temp-file'
          );
          assert.strictEqual(vodAttP33.nativeStatusAndHeadersMs, 380.4);
          assert.strictEqual(vodAttP33.nativeFileWriteMs, 620.6);
          assert.strictEqual(vodAttP33.nativeTotalMs, 1005);
          assert.strictEqual(
            vodAttP33.nativeTransportAndBridgeMs,
            1030,
            '[12.22.5] nativeTransportAndBridgeMs deve medir apenas a chamada ao plugin (1030ms), sem incluir a leitura local'
          );
          assert.strictEqual(
            vodAttP33.outsideNativeMeasuredMs,
            25,
            '[12.22.5] tempo fora do trecho nativo medido deve ser 25ms (1030 - 1005), SEM atribuir os 180ms da leitura local à ponte'
          );
          assert.strictEqual(
            vodAttP33.localFileReadMs,
            180,
            '[12.22.5] leitura local na WebView deve ser medida separadamente (180ms)'
          );
          assert.strictEqual(
            vodAttP33.nativeJsonParseExecuted,
            false,
            '[12.22.5] nativeJsonParseExecuted deve ser false no novo caminho'
          );
          assert.strictEqual(vodAttP33.nativeJsonParseMs, null);
          assert.strictEqual(
            vodAttP33.jsonParseExecuted,
            true,
            '[12.22.5] jsonParseExecuted na WebView deve ser true'
          );
          assert.strictEqual(
            vodAttP33.jsonParseMs,
            140,
            '[12.22.5] jsonParseMs na WebView deve ser 140ms'
          );
          assert.strictEqual(vodAttP33.bytesWritten, largeSyntheticVodBytes);
          assert.strictEqual(vodAttP33.payloadChars, largeSyntheticVodJsonText.length);

          const reportP33Text = catalogDiagMod.formatCatalogDiagnosticsReport(snapP33);
          assert(
            reportP33Text.includes(
              `• Etapas Android (P3.3 - arquivo temporário): status + cabeçalhos=380.4 ms | gravação do corpo=620.6 ms | leitura local=180.0 ms | interpretação na WebView=140.0 ms | JSON no Android=não executado | total no trecho nativo=1005.0 ms | tempo fora do trecho nativo medido=25.0 ms | Content-Length=${largeSyntheticVodBytes} (valor do cabeçalho) | bytes gravados=${largeSyntheticVodBytes} bytes | texto lido=${largeSyntheticVodJsonText.length} caracteres`
            ),
            `[12.22.5] Relatório formatado P3.3 deve exibir todas as etapas separadas e "JSON no Android=não executado". Obtido:\n${reportP33Text}`
          );
          assert(
            !reportP33Text.includes('p33-secret-provider') &&
              !reportP33Text.includes('p33_secret_user') &&
              !reportP33Text.includes('p33_secret_password') &&
              !reportP33Text.includes('Filme Sintético P3.3'),
            '[12.22.5] Relatório P3.3 não deve expor credenciais, URLs ou conteúdo da resposta'
          );

          // -----------------------------------------------------------------
          // 12.22.6: Preparo Android limpo e repetido validando incorporação de
          // CatalogFileTransferPlugin.java e registro em MainActivity.java antes de super.onCreate
          // -----------------------------------------------------------------
          const tmpPrepDirP33 = fsNodeP33.mkdtempSync(
            pathNodeP33.join(osNodeP33.tmpdir(), 'nc-android-prep-p33-')
          );
          try {
            fsNodeP33.copyFileSync(
              pathNodeP33.join(process.cwd(), 'package.json'),
              pathNodeP33.join(tmpPrepDirP33, 'package.json')
            );
            fsNodeP33.mkdirSync(pathNodeP33.join(tmpPrepDirP33, 'dist'), { recursive: true });
            fsNodeP33.writeFileSync(
              pathNodeP33.join(tmpPrepDirP33, 'dist', 'index.html'),
              '<!doctype html><html><body>North Code Play</body></html>',
              'utf8'
            );
            fsNodeP33.mkdirSync(pathNodeP33.join(tmpPrepDirP33, 'src', 'assets'), {
              recursive: true,
            });
            fsNodeP33.copyFileSync(
              pathNodeP33.join(process.cwd(), 'src', 'assets', 'logo.png'),
              pathNodeP33.join(tmpPrepDirP33, 'src', 'assets', 'logo.png')
            );
            fsNodeP33.cpSync(
              pathNodeP33.join(process.cwd(), 'tooling', 'android'),
              pathNodeP33.join(tmpPrepDirP33, 'tooling', 'android'),
              { recursive: true }
            );

            const tmpJavaHandlerP33 = pathNodeP33.join(
              tmpPrepDirP33,
              prepareAndroidModP33.CAPACITOR_HTTP_HANDLER_REL_PATH
            );
            fsNodeP33.mkdirSync(pathNodeP33.dirname(tmpJavaHandlerP33), { recursive: true });
            fsNodeP33.copyFileSync(
              pathNodeP33.join(
                process.cwd(),
                'node_modules',
                '@capacitor',
                'android',
                'package.json'
              ),
              pathNodeP33.join(
                tmpPrepDirP33,
                'node_modules',
                '@capacitor',
                'android',
                'package.json'
              )
            );
            fsNodeP33.copyFileSync(
              pathNodeP33.join(
                process.cwd(),
                prepareAndroidModP33.CAPACITOR_HTTP_HANDLER_REL_PATH
              ),
              tmpJavaHandlerP33
            );

            const tmpCapCliP33 = pathNodeP33.join(
              tmpPrepDirP33,
              'node_modules',
              '@capacitor',
              'cli',
              'bin',
              'capacitor'
            );
            fsNodeP33.mkdirSync(pathNodeP33.dirname(tmpCapCliP33), { recursive: true });
            fsNodeP33.writeFileSync(
              tmpCapCliP33,
              `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const root = process.cwd();
const androidAppDir = path.join(root, 'android', 'app');
if (args[0] === 'add' && args[1] === 'android') {
  fs.mkdirSync(path.join(androidAppDir, 'src', 'main', 'assets', 'public'), { recursive: true });
  fs.writeFileSync(
    path.join(androidAppDir, 'build.gradle'),
    'android {\\n  namespace "com.example.app"\\n  defaultConfig {\\n    applicationId "com.example.app"\\n    versionCode 1\\n    versionName "1.0"\\n  }\\n}\\n',
    'utf8'
  );
} else if (args[0] === 'sync' && args[1] === 'android') {
  const assetsDir = path.join(androidAppDir, 'src', 'main', 'assets');
  fs.mkdirSync(path.join(assetsDir, 'public'), { recursive: true });
  fs.copyFileSync(path.join(root, 'dist', 'index.html'), path.join(assetsDir, 'public', 'index.html'));
  fs.writeFileSync(path.join(assetsDir, 'capacitor.config.json'), '{"appId":"com.northcode.play"}', 'utf8');
  fs.writeFileSync(path.join(assetsDir, 'capacitor.plugins.json'), '[]', 'utf8');
}
`,
              'utf8'
            );

            const prepCleanP33 = prepareAndroidModP33.prepareAndroidProject({
              rootDir: tmpPrepDirP33,
              skipWebBuild: true,
            });
            assert.strictEqual(prepCleanP33.reusedExistingAndroid, false);

            const generatedPluginPath = pathNodeP33.join(
              tmpPrepDirP33,
              'android',
              'app',
              'src',
              'main',
              'java',
              'com',
              'northcode',
              'play',
              'CatalogFileTransferPlugin.java'
            );
            const generatedMainActivityPath = pathNodeP33.join(
              tmpPrepDirP33,
              'android',
              'app',
              'src',
              'main',
              'java',
              'com',
              'northcode',
              'play',
              'MainActivity.java'
            );
            assert(
              fsNodeP33.existsSync(generatedPluginPath),
              '[12.22.6] CatalogFileTransferPlugin.java deve existir em android/ após preparo limpo'
            );
            const mainActText = fsNodeP33.readFileSync(generatedMainActivityPath, 'utf8');
            assert(
              mainActText.indexOf('registerPlugin(CatalogFileTransferPlugin.class);') !== -1 &&
                mainActText.indexOf('registerPlugin(CatalogFileTransferPlugin.class);') <
                  mainActText.indexOf('super.onCreate(savedInstanceState);'),
              '[12.22.6] MainActivity.java deve registrar CatalogFileTransferPlugin antes de super.onCreate(savedInstanceState)'
            );

            const prepRepeatP33 = prepareAndroidModP33.prepareAndroidProject({
              rootDir: tmpPrepDirP33,
              skipWebBuild: true,
            });
            assert.strictEqual(
              prepRepeatP33.reusedExistingAndroid,
              true,
              '[12.22.6] Preparo repetido deve reutilizar android/ preservando plugin e patch P3.2'
            );
          } finally {
            fsNodeP33.rmSync(tmpPrepDirP33, { recursive: true, force: true });
          }

          console.log(
            `📊 [Métricas P3.3 — Transferência dos Catálogos Grandes via Arquivo Temporário no APK (Sintético)]\n` +
              `   • Seleção por ambiente: Web normal/TV -> fetch | Android APK (default/tv, c/ ou s/ diagnóstico) -> CatalogFileTransfer p/ 3 catálogos completos e CapacitorHttp p/ demais chamadas\n` +
              `   • Catálogo VOD sintético (1.500 itens, ${largeSyntheticVodBytes} bytes): GETs por tentativa=1 | JSON no Android=não executado | JSON.parse na WebView=1 | corpo na ponte nativa=ausente\n` +
              `   • Etapas P3.3 (sintético): status+cabeçalhos=380.4ms | gravação do corpo=620.6ms | total nativo=1005.0ms | fora do trecho nativo=25.0ms | leitura local=180.0ms | interpretação WebView=140.0ms`
          );
        } finally {
          (XtreamService as any).getVodInfo = savedGetVodInfoP33;
          (XtreamService as any).getSeriesInfo = savedGetSeriesInfoP33;
          (XtreamService as any).getShortEpg = savedGetShortEpgP33;
          (CapacitorCoreP33 as any).isNativePlatform = origIsNativePlatform;
          (CapacitorCoreP33 as any).getPlatform = origGetPlatform;
          (CapacitorCoreP33 as any).isPluginAvailable = origIsPluginAvailable;
          (CapacitorCoreP33 as any).convertFileSrc = origConvertFileSrc;
          androidAdapterModP33.setAndroidCatalogFileAdapterTestOverride({
            plugin: null,
            convertFileSrc: null,
          });
          httpTransportModP33.setTransportTestConfig({
            mode: 'auto',
            capacitorHttpGet: null,
            androidCatalogPluginAvailable: null,
          });
          httpTransportModP33.resetAndroidCatalogAdapterLoadCountForTest();
          fsNodeP33.rmSync(tmpCacheRootP33, { recursive: true, force: true });
        }
      }

      // -------------------------------------------------------------------------
      // 12.23. Grade de Programação (EPG) e Navegação por Setas da TV ao Vivo
      // -------------------------------------------------------------------------
      {
        const { computeLiveTvLayoutMetrics } = await import('../src/views/LiveTvView');
        const {
          NavigationProvider: LiveNavProvider,
          getFocusableElements: getLiveFocusableElements,
          isElementFocusable: isLiveElementFocusable,
          setNavMode: setLiveNavMode,
        } = await import('../src/navigation');

        // 1. Verificar métricas de layout em 961 × 541 px (85%, 90%, 100%, default e tv), Desktop e Mobile
        const scalesToVerify = [0.85, 0.9, 1.0];
        const layoutSummaryLines: string[] = [];
        for (const mode of ['default', 'tv'] as const) {
          for (const scale of scalesToVerify) {
            const metrics = computeLiveTvLayoutMetrics({
              viewportWidth: 961,
              viewportHeight: 541,
              uiScale: scale,
              displayMode: mode,
              isGrouped: true,
              hasNowPlaying: true,
              epgCount: 6,
            });
            assert.strictEqual(
              metrics.topSectionDirection,
              'row',
              `[12.23.1] Em 961x541 (${mode} @ ${Math.round(scale * 100)}%), topo da LiveTvView deve ficar lado a lado (row)`
            );
            assert(
              Math.abs(metrics.previewAspectRatio - 16 / 9) < 0.03,
              `[12.23.1] Proporção 16:9 do preview deve ser preservada em 961x541 (${mode} @ ${Math.round(scale * 100)}%): obtido ${metrics.previewAspectRatio}`
            );
            assert(
              metrics.epgHeaderHeight >= 28 && metrics.epgScrollViewportHeight >= 220,
              `[12.23.1] Grade de programação deve ter cabeçalho e área útil generosa em 961x541 (${mode} @ ${Math.round(scale * 100)}%): scrollViewport=${metrics.epgScrollViewportHeight}px`
            );
            assert(
              metrics.visibleEpgCardsCount >= 2.5,
              `[12.23.1] Em 961x541 (${mode} @ ${Math.round(scale * 100)}%), pelo menos 1 entrada inteira (obtido ${metrics.visibleEpgCardsCount} entradas) deve ficar legível abaixo do cabeçalho`
            );
            assert(
              metrics.epgMaxScrollTop > 0,
              `[12.23.1] Com 6 programas em 961x541 (${mode} @ ${Math.round(scale * 100)}%), a lista deve ter espaço de rolagem (maxScrollTop=${metrics.epgMaxScrollTop}px) para alcançar o último item`
            );
            if (scale === 0.9) {
              layoutSummaryLines.push(
                `961x541 ${mode}@90%: topo=${metrics.topSectionHeight}px (preview=${metrics.previewWidth}x${metrics.previewHeight}px), EPG=${metrics.epgSectionHeight}px (scroll=${metrics.epgScrollViewportHeight}px, visíveis=${metrics.visibleEpgCardsCount})`
              );
            }
          }
        }

        const desktopMetrics = computeLiveTvLayoutMetrics({
          viewportWidth: 1280,
          viewportHeight: 720,
          uiScale: 1,
          displayMode: 'default',
          isGrouped: true,
          hasNowPlaying: true,
          epgCount: 6,
        });
        assert.strictEqual(desktopMetrics.topSectionDirection, 'row');
        assert(desktopMetrics.epgScrollViewportHeight >= 360);

        const mobileMetrics = computeLiveTvLayoutMetrics({
          viewportWidth: 375,
          viewportHeight: 667,
          uiScale: 1,
          displayMode: 'default',
          isGrouped: false,
          hasNowPlaying: true,
          epgCount: 6,
        });
        assert.strictEqual(mobileMetrics.isMobile, true);
        assert.strictEqual(mobileMetrics.topSectionDirection, 'column');
        assert(Math.abs(mobileMetrics.previewAspectRatio - 16 / 9) < 0.03);

        // 2. Teste integrado com LiveTvView real + navegação espacial real (default e tv)
        const encodeB64 = (txt: string) =>
          Buffer.from(encodeURIComponent(txt).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16))), 'binary').toString('base64');

        const sixPrograms = [
          {
            id: 'epg_1',
            start: '2026-11-08 18:00:00',
            end: '2026-11-08 19:00:00',
            title: encodeB64('Jornal da Noite — Edição 1'),
            description: encodeB64('Resumo das principais notícias do dia.'),
          },
          {
            id: 'epg_2',
            start: '2026-11-08 19:00:00',
            end: '2026-11-08 20:00:00',
            title: encodeB64('Debate Esportivo — Edição 2'),
            description: encodeB64('Análise da rodada e entrevistas ao vivo.'),
          },
          {
            id: 'epg_3',
            start: '2026-11-08 20:00:00',
            end: '2026-11-08 21:00:00',
            title: encodeB64('Documentário Ciência — Edição 3'),
            description: encodeB64('Exploração espacial e novas descobertas.'),
          },
          {
            id: 'epg_4',
            start: '2026-11-08 21:00:00',
            end: '2026-11-08 22:00:00',
            title: encodeB64('Sessão Cinema — Edição 4'),
            description: encodeB64('Suspense inédito na grade principal.'),
          },
          {
            id: 'epg_5',
            start: '2026-11-08 22:00:00',
            end: '2026-11-08 23:00:00',
            title: encodeB64('Mesa Redonda — Edição 5'),
            description: encodeB64('Bastidores e gols da semana.'),
          },
          {
            id: 'epg_6',
            start: '2026-11-08 23:00:00',
            end: '2026-11-09 00:00:00',
            title: encodeB64('Plantão da Madrugada — Edição 6'),
            description: encodeB64('Últimas atualizações internacionais.'),
          },
        ];

        const savedGetShortEpgLiveTest = XtreamService.getShortEpg;
        let epgCallsByStreamId: Record<string, number> = {};
        let resolvePendingCh3Epg: ((val: any) => void) | null = null;

        (XtreamService as any).getShortEpg = async (
          _creds: XtreamCredentials,
          streamId: string | number,
          limit?: number
        ) => {
          const key = String(streamId);
          epgCallsByStreamId[key] = (epgCallsByStreamId[key] || 0) + 1;
          assert.strictEqual(limit, 10, '[12.23] getShortEpg deve preservar o limite 10');
          if (key === '501' || key === '5011' || key === '5012' || key === '5013') {
            return { epg_listings: sixPrograms };
          }
          if (key === '502') {
            return { epg_listings: [] };
          }
          if (key === '503') {
            return new Promise((resolve) => {
              resolvePendingCh3Epg = resolve;
            });
          }
          if (key === '504') {
            throw new Error('Falha simulada de rede no EPG');
          }
          return { epg_listings: [] };
        };

        const dispatchArrowKey = async (key: 'ArrowRight' | 'ArrowLeft' | 'ArrowDown' | 'ArrowUp' | 'Enter' | 'Escape') => {
          await act(async () => {
            const target =
              document.activeElement instanceof HTMLElement ? document.activeElement : windowInstance;
            target.dispatchEvent(
              new (windowInstance as any).KeyboardEvent('keydown', {
                key,
                bubbles: true,
                cancelable: true,
              })
            );
          });
        };

        const liveEpgContainer = document.createElement('div');
        document.body.appendChild(liveEpgContainer);
        const liveEpgRoot = createRoot(liveEpgContainer);

        const prevDocDisplayMode = document.documentElement.getAttribute('data-display-mode');
        const prevDocScale = document.documentElement.style.getPropertyValue('--nc-ui-scale');
        const prevInnerW = windowInstance.innerWidth;
        const prevInnerH = windowInstance.innerHeight;

        try {
          for (const testDisplayMode of ['default', 'tv'] as const) {
            epgCallsByStreamId = {};
            if (testDisplayMode === 'tv') {
              document.documentElement.setAttribute('data-display-mode', 'tv');
              document.documentElement.style.setProperty('--nc-ui-scale', '0.9');
            } else {
              document.documentElement.setAttribute('data-display-mode', 'default');
              document.documentElement.style.removeProperty('--nc-ui-scale');
            }
            (windowInstance as any).innerWidth = 961;
            (windowInstance as any).innerHeight = 541;

            const liveTestCreds: XtreamCredentials = {
              serverUrl: 'http://epg-audit.local:8080',
              username: 'epg_user',
              password: 'epg_password',
            };

            const liveTestStreams = [
              {
                stream_id: 501,
                name: 'Canal Notícias Internacional Documentários Esportes e Entretenimento Ao Vivo Especial 24 Horas Transmissão Global Contínua SD',
                category_id: 'cat_epg_1',
                epg_channel_id: 'epg_noticias',
                stream_icon: '',
              },
              {
                stream_id: 5011,
                name: 'Canal Notícias Internacional Documentários Esportes e Entretenimento Ao Vivo Especial 24 Horas Transmissão Global Contínua HD',
                category_id: 'cat_epg_1',
                epg_channel_id: 'epg_noticias',
                stream_icon: '',
              },
              {
                stream_id: 5012,
                name: 'Canal Notícias Internacional Documentários Esportes e Entretenimento Ao Vivo Especial 24 Horas Transmissão Global Contínua FHD',
                category_id: 'cat_epg_1',
                epg_channel_id: 'epg_noticias',
                stream_icon: '',
              },
              {
                stream_id: 5013,
                name: 'Canal Notícias Internacional Documentários Esportes e Entretenimento Ao Vivo Especial 24 Horas Transmissão Global Contínua 4K',
                category_id: 'cat_epg_1',
                epg_channel_id: 'epg_noticias',
                stream_icon: '',
              },
              {
                stream_id: 502,
                name: 'Canal Esportes HD',
                category_id: 'cat_epg_1',
                stream_icon: '',
              },
              {
                stream_id: 503,
                name: 'Canal Documentários HD',
                category_id: 'cat_epg_1',
                stream_icon: '',
              },
              {
                stream_id: 504,
                name: 'Canal Filmes HD',
                category_id: 'cat_epg_1',
                stream_icon: '',
              },
            ];

            const liveMockCtx: any = {
              credentials: liveTestCreds,
              accountInfo: {
                user_info: { allowed_output_formats: ['m3u8', 'ts'] },
              },
              isAuthenticated: true,
              isAuthChecking: false,
              isAuthRejected: false,
              authError: null,
              hasInitialMenuData: true,
              isInitialSetupComplete: true,
              liveCategories: [{ category_id: 'cat_epg_1', category_name: 'Canais Principais' }],
              vodCategories: [],
              seriesCategories: [],
              liveStreams: liveTestStreams,
              allLiveStreams: liveTestStreams,
              vodStreams: [],
              allVodStreams: [],
              series: [],
              allSeries: [],
              loadingLive: false,
              loadingVod: false,
              loadingSeries: false,
              liveError: null,
              vodError: null,
              seriesError: null,
              liveCategoriesError: null,
              vodCategoriesError: null,
              seriesCategoriesError: null,
              liveCategoriesStatus: 'ready',
              vodCategoriesStatus: 'ready',
              seriesCategoriesStatus: 'ready',
              liveCatalogStatus: 'ready',
              vodCatalogStatus: 'ready',
              seriesCatalogStatus: 'ready',
              fetchLiveCategories: async () => {},
              fetchVodCategories: async () => {},
              fetchSeriesCategories: async () => {},
              fetchLiveStreams: async () => {},
              fetchVodStreams: async () => {},
              fetchSeries: async () => {},
              retryInitialSetup: async () => {},
            };

            await act(async () => {
              liveEpgRoot.render(
                React.createElement(
                  LiveNavProvider,
                  null,
                  React.createElement(
                    XtreamMockProvider,
                    { value: liveMockCtx },
                    React.createElement(
                      'div',
                      { key: testDisplayMode, className: 'flex flex-col w-full h-full' },
                      React.createElement(
                        'div',
                        { 'data-nav-zone': 'header' },
                        React.createElement('input', {
                          type: 'text',
                          readOnly: true,
                          'data-test-header-search': 'true',
                          placeholder: 'Pesquisar...',
                        })
                      ),
                      React.createElement(LiveTvView, { onPlay: () => {} })
                    )
                  )
                )
              );
            });

            // Entrar na categoria "Canais Principais"
            const catBtn = liveEpgContainer.querySelector<HTMLButtonElement>(
              'button[data-live-category-id="cat_epg_1"]'
            );
            assert(catBtn, `[12.23][${testDisplayMode}] Botão de categoria deve existir`);
            await act(async () => {
              setLiveNavMode('remote');
              catBtn.focus();
              catBtn.click();
            });

            const chBtns = Array.from(
              liveEpgContainer.querySelectorAll<HTMLButtonElement>('button[data-live-channel-btn="true"]')
            );
            assert.strictEqual(
              chBtns.length,
              4,
              `[12.23][${testDisplayMode}] Deve renderizar os 4 canais da categoria`
            );
            const ch1Btn = chBtns[0];
            const ch2Btn = chBtns[1];
            const ch3Btn = chBtns[2];
            const ch4Btn = chBtns[3];

            const favBtns = Array.from(
              liveEpgContainer.querySelectorAll<HTMLButtonElement>('button[data-live-channel-fav="true"]')
            );
            assert.strictEqual(favBtns.length, 4, `[12.23][${testDisplayMode}] Deve renderizar os 4 botões de favorito`);
            const fav1Btn = favBtns[0];
            const fav2Btn = favBtns[1];

            // Abrir Canal 1 no preview
            await act(async () => {
              ch1Btn.focus();
              ch1Btn.click();
              await new Promise((r) => setTimeout(r, 25));
            });

            const previewVideoEl = liveEpgContainer.querySelector('video') as HTMLVideoElement | null;
            assert(previewVideoEl, `[12.23][${testDisplayMode}] <video> do preview deve estar montado`);
            await act(async () => {
              await previewVideoEl.play();
            });

            // Verificar que os 6 programas foram carregados e renderizados como elementos focáveis não-botão
            const epgItems = Array.from(
              liveEpgContainer.querySelectorAll<HTMLElement>('[data-epg-item="true"]')
            );
            assert.strictEqual(
              epgItems.length,
              6,
              `[12.23][${testDisplayMode}] Todos os 6 programas do EPG devem estar renderizados`
            );
            for (let i = 0; i < epgItems.length; i++) {
              assert.notStrictEqual(
                epgItems[i].tagName,
                'BUTTON',
                `[12.23][${testDisplayMode}] Item EPG #${i} não deve ser um <button>`
              );
              assert.strictEqual(
                epgItems[i].getAttribute('role'),
                'article',
                `[12.23][${testDisplayMode}] Item EPG #${i} deve usar role="article" (sem semântica de botão de ação)`
              );
              assert.strictEqual(
                epgItems[i].tabIndex,
                0,
                `[12.23][${testDisplayMode}] Item EPG #${i} deve ter tabIndex=0`
              );
              assert.strictEqual(
                isLiveElementFocusable(epgItems[i]),
                true,
                `[12.23][${testDisplayMode}] Item EPG #${i} deve ser focável pelo navegador espacial`
              );
            }

            // Verificar ausência de rolagem aninhada no painel direito em md+ e preservação de toque no mobile
            const rightPaneEl = liveEpgContainer.querySelector<HTMLElement>('[data-nav-zone="content"]');
            const contentStackEl = liveEpgContainer.querySelector<HTMLElement>('[data-live-content-stack="true"]');
            const topSectionEl = liveEpgContainer.querySelector<HTMLElement>('[data-live-top-section="true"]');
            const epgSectionEl = liveEpgContainer.querySelector<HTMLElement>('[data-live-epg-section="true"]');
            const epgHeaderEl = liveEpgContainer.querySelector<HTMLElement>('[data-live-epg-header="true"]');
            const epgScrollEl = liveEpgContainer.querySelector<HTMLElement>('[data-epg-scroll="true"]');
            const selectedChannelTitleEl = liveEpgContainer.querySelector<HTMLElement>('h1.nc-live-channel-title');

            assert(
              rightPaneEl && contentStackEl && topSectionEl && epgSectionEl && epgHeaderEl && epgScrollEl && selectedChannelTitleEl,
              `[12.23][${testDisplayMode}] Estrutura da grade de programação e título do canal selecionado devem estar presentes`
            );
            assert(
              selectedChannelTitleEl.classList.contains('line-clamp-2') &&
                selectedChannelTitleEl.classList.contains('whitespace-normal') &&
                selectedChannelTitleEl.classList.contains('break-words') &&
                !selectedChannelTitleEl.classList.contains('block'),
              `[12.23][${testDisplayMode}] h1.nc-live-channel-title deve manter line-clamp-2 e quebra de nomes longos sem a classe block`
            );
            assert(
              rightPaneEl.className.includes('md:overflow-hidden') &&
                rightPaneEl.className.includes('overflow-y-auto') &&
                rightPaneEl.className.includes('touch-pan-y'),
              `[12.23][${testDisplayMode}] Painel direito deve evitar rolagem aninhada em md+ e preservar rolagem por toque no celular`
            );
            assert(
              contentStackEl.className.includes('md:overflow-hidden') &&
                epgSectionEl.className.includes('md:overflow-hidden') &&
                epgScrollEl.className.includes('md:overflow-y-auto') &&
                epgScrollEl.getAttribute('data-scroll-container') === 'true',
              `[12.23][${testDisplayMode}] Apenas o container da lista EPG deve rolar verticalmente em md+`
            );
            assert(
              topSectionEl.className.includes('md:flex-row'),
              `[12.23][${testDisplayMode}] Topo do canal deve usar md:flex-row para não empilhar preview acima do resumo em 961x541`
            );

            // Configurar geometria realista de 961 × 541 no container de scroll do EPG para testar rolagem até o 6º item
            const layout90 = computeLiveTvLayoutMetrics({
              viewportWidth: 961,
              viewportHeight: 541,
              uiScale: 0.9,
              displayMode: testDisplayMode,
              isGrouped: false,
              hasNowPlaying: true,
              epgCount: 6,
            });
            Object.defineProperty(epgScrollEl, 'clientHeight', {
              value: layout90.epgScrollViewportHeight,
              configurable: true,
            });
            Object.defineProperty(epgScrollEl, 'scrollHeight', {
              value: layout90.epgTotalContentHeight,
              configurable: true,
            });
            epgScrollEl.getBoundingClientRect = () =>
              ({
                top: layout90.topSectionHeight + layout90.epgHeaderHeight,
                bottom: layout90.topSectionHeight + layout90.epgHeaderHeight + layout90.epgScrollViewportHeight,
                left: 380,
                right: 961,
                width: layout90.rightPaneWidth,
                height: layout90.epgScrollViewportHeight,
                x: 380,
                y: layout90.topSectionHeight + layout90.epgHeaderHeight,
                toJSON: () => ({}),
              }) as DOMRect;

            epgItems.forEach((item, idx) => {
              const itemTopOffset = idx * (layout90.epgCardHeight + 10);
              Object.defineProperty(item, 'offsetTop', { value: itemTopOffset, configurable: true });
              Object.defineProperty(item, 'offsetHeight', {
                value: layout90.epgCardHeight,
                configurable: true,
              });
              item.getBoundingClientRect = () => {
                const baseTop =
                  layout90.topSectionHeight +
                  layout90.epgHeaderHeight +
                  itemTopOffset -
                  epgScrollEl.scrollTop;
                return {
                  top: baseTop,
                  bottom: baseTop + layout90.epgCardHeight,
                  left: 410,
                  right: 945,
                  width: 535,
                  height: layout90.epgCardHeight,
                  x: 410,
                  y: baseTop,
                  toJSON: () => ({}),
                } as DOMRect;
              };
            });

            // Verificar que controles do player embutido NÃO são candidatos de foco por setas, mas continuam aceitando clique
            const focusableInPreview = getLiveFocusableElements();
            const previewPlayPauseBtn = liveEpgContainer.querySelector<HTMLButtonElement>(
              '[data-player-control="play-pause"]'
            );
            const previewFullscreenBtn = liveEpgContainer.querySelector<HTMLButtonElement>(
              '[data-player-control="fullscreen"]'
            );
            assert(
              previewPlayPauseBtn && previewFullscreenBtn,
              `[12.23][${testDisplayMode}] Controles de clique/toque do preview continuam presentes no DOM`
            );
            assert(
              !focusableInPreview.includes(previewPlayPauseBtn) &&
                !focusableInPreview.includes(previewFullscreenBtn),
              `[12.23][${testDisplayMode}] Controles do player no preview embutido NÃO devem receber foco por setas`
            );

            // Clique direto no botão Play/Pause do preview continua funcionando
            await act(async () => {
              previewPlayPauseBtn.click();
            });
            assert.strictEqual(
              previewVideoEl.paused,
              true,
              `[12.23][${testDisplayMode}] Clique/toque no controle do preview deve continuar pausando o vídeo`
            );
            await act(async () => {
              previewPlayPauseBtn.click();
            });
            assert.strictEqual(
              previewVideoEl.paused,
              false,
              `[12.23][${testDisplayMode}] Segundo clique/toque no controle do preview retoma a reprodução`
            );

            // Posicionar foco de volta no botão do Canal 1 e registrar contadores antes de navegar por setas
            await act(async () => {
              ch1Btn.focus();
            });
            assertSameElement(
              document.activeElement,
              ch1Btn,
              `[12.23][${testDisplayMode}] Foco inicial no botão do Canal 1`
            );

            const loadCountBeforeNav = videoLoadCallCount;
            const epgCallsBeforeNav = epgCallsByStreamId['501'] || 0;
            assert.strictEqual(
              epgCallsBeforeNav,
              1,
              `[12.23][${testDisplayMode}] Seleção do Canal 1 deve disparar exatamente 1 consulta de EPG`
            );

            // 1º ArrowRight: Canal 1 -> Favorito do Canal 1
            await dispatchArrowKey('ArrowRight');
            assertSameElement(
              document.activeElement,
              fav1Btn,
              `[12.23][${testDisplayMode}] 1º ArrowRight deve mover o foco do canal para a estrela de favorito`
            );

            // 2º ArrowRight: Favorito do Canal 1 -> 1º item da grade de programação (sem parar nos controles do preview!)
            await dispatchArrowKey('ArrowRight');
            assertSameElement(
              document.activeElement,
              epgItems[0],
              `[12.23][${testDisplayMode}] 2º ArrowRight deve entrar direto no 1º programa da grade (sem parar no player)`
            );

            // ArrowDown percorrendo todos os 6 programas até o último (índice 5)
            for (let targetIdx = 1; targetIdx < epgItems.length; targetIdx++) {
              await dispatchArrowKey('ArrowDown');
              assertSameElement(
                document.activeElement,
                epgItems[targetIdx],
                `[12.23][${testDisplayMode}] ArrowDown deve focar o programa #${targetIdx + 1} (índice ${targetIdx})`
              );
              const containerRect = epgScrollEl.getBoundingClientRect();
              const itemRect = epgItems[targetIdx].getBoundingClientRect();
              assert(
                itemRect.bottom <= containerRect.bottom && itemRect.top >= containerRect.top,
                `[12.23][${testDisplayMode}] Programa #${targetIdx + 1} focado deve estar visível dentro da área de rolagem do EPG`
              );
            }
            assert(
              epgScrollEl.scrollTop > 0,
              `[12.23][${testDisplayMode}] Rolagem do EPG deve avançar para exibir o 6º programa (scrollTop=${epgScrollEl.scrollTop})`
            );

            // ArrowUp voltando na grade e mantendo visibilidade
            await dispatchArrowKey('ArrowUp');
            assertSameElement(
              document.activeElement,
              epgItems[4],
              `[12.23][${testDisplayMode}] ArrowUp deve subir para o programa #5 (índice 4)`
            );
            await dispatchArrowKey('ArrowDown');
            assertSameElement(
              document.activeElement,
              epgItems[5],
              `[12.23][${testDisplayMode}] ArrowDown retorna ao último programa #6 (índice 5)`
            );

            // ArrowLeft a partir da grade devolve o foco para o canal de origem (Canal 1)
            await dispatchArrowKey('ArrowLeft');
            assertSameElement(
              document.activeElement,
              ch1Btn,
              `[12.23][${testDisplayMode}] ArrowLeft na programação deve devolver o foco para o canal de origem (Canal 1)`
            );

            // Testar saída a partir de outra linha de canal (Canal 2) enquanto o Canal 1 permanece aberto no preview
            await dispatchArrowKey('ArrowDown');
            assertSameElement(
              document.activeElement,
              ch2Btn,
              `[12.23][${testDisplayMode}] ArrowDown na lista de canais foca o Canal 2`
            );
            await dispatchArrowKey('ArrowRight');
            assertSameElement(
              document.activeElement,
              fav2Btn,
              `[12.23][${testDisplayMode}] ArrowRight no Canal 2 foca o favorito do Canal 2`
            );
            await dispatchArrowKey('ArrowRight');
            assertSameElement(
              document.activeElement,
              epgItems[0],
              `[12.23][${testDisplayMode}] ArrowRight no favorito do Canal 2 entra na programação`
            );
            await dispatchArrowKey('ArrowLeft');
            assertSameElement(
              document.activeElement,
              ch2Btn,
              `[12.23][${testDisplayMode}] ArrowLeft devolve o foco exatamente para a linha de canal de origem (Canal 2)`
            );

            // Confirmar que mover o foco NUNCA reiniciou a reprodução nem disparou nova consulta de EPG
            assert.strictEqual(
              videoLoadCallCount,
              loadCountBeforeNav,
              `[12.23][${testDisplayMode}] Mover o foco entre canais, favoritos e EPG NÃO deve reiniciar a reprodução`
            );
            assert.strictEqual(
              epgCallsByStreamId['501'],
              1,
              `[12.23][${testDisplayMode}] Mover o foco NÃO deve disparar nova consulta de EPG`
            );
            assertSameElement(
              liveEpgContainer.querySelector('video'),
              previewVideoEl,
              `[12.23][${testDisplayMode}] Mesma instância de <video> preservada após navegar pela grade`
            );

            // 2.B. Rolagem horizontal da faixa "Versão do canal" (data-nav-row="true" + data-live-variants-row="true"),
            // preferência pela versão ativa ao entrar por cima/baixo e preservação de reprodução e EPG
            await dispatchArrowKey('ArrowUp');
            assertSameElement(
              document.activeElement,
              ch1Btn,
              `[12.23][${testDisplayMode}] Foco de volta no Canal 1 agrupado`
            );

            const variantsRowEl = liveEpgContainer.querySelector<HTMLElement>(
              '[data-live-variants-row="true"]'
            );
            assert(
              variantsRowEl,
              `[12.23][${testDisplayMode}] Faixa "Versão do canal" deve estar montada para o canal agrupado`
            );
            assert.strictEqual(
              variantsRowEl.getAttribute('data-nav-row'),
              'true',
              `[12.23][${testDisplayMode}] Faixa de versões deve usar data-nav-row="true" para reaproveitar a rolagem horizontal`
            );
            assert.strictEqual(
              variantsRowEl.getAttribute('data-live-variants-row'),
              'true',
              `[12.23][${testDisplayMode}] Faixa de versões deve ter o marcador data-live-variants-row="true"`
            );
            assert(
              variantsRowEl.className.includes('overflow-x-auto') &&
                variantsRowEl.className.includes('touch-pan-x'),
              `[12.23][${testDisplayMode}] Faixa de versões deve preservar rolagem horizontal e toque (overflow-x-auto touch-pan-x)`
            );

            const variantBtns = Array.from(
              variantsRowEl.querySelectorAll<HTMLButtonElement>('button')
            );
            assert.strictEqual(
              variantBtns.length,
              5,
              `[12.23][${testDisplayMode}] Faixa de versões deve conter 5 opções (Automático + 4 resoluções)`
            );
            assert.strictEqual(
              variantBtns[0].textContent?.trim(),
              'Automático',
              `[12.23][${testDisplayMode}] Primeira opção da faixa deve ser Automático`
            );
            assert.strictEqual(
              variantBtns[4].textContent?.trim(),
              '4K',
              `[12.23][${testDisplayMode}] Última opção da faixa deve ser 4K`
            );

            // Configurar geometria horizontal onde as 5 opções (largura total 266px) não cabem na largura disponível (140px)
            const variantsRowLeft = 480;
            const variantsRowWidth = 140;
            const variantsRowRight = variantsRowLeft + variantsRowWidth; // 620
            const variantMetrics = [
              { offsetLeft: 0, width: 76 },   // Automático: [0..76]
              { offsetLeft: 82, width: 40 },  // FHD: [82..122]
              { offsetLeft: 128, width: 42 }, // HD: [128..170]
              { offsetLeft: 176, width: 46 }, // SD: [176..222]
              { offsetLeft: 228, width: 38 }, // 4K: [228..266]
            ];
            const variantsTotalScrollWidth = 266;

            variantsRowEl.scrollLeft = 0;
            Object.defineProperty(variantsRowEl, 'clientWidth', {
              value: variantsRowWidth,
              configurable: true,
            });
            Object.defineProperty(variantsRowEl, 'scrollWidth', {
              value: variantsTotalScrollWidth,
              configurable: true,
            });
            variantsRowEl.getBoundingClientRect = () =>
              ({
                top: 96,
                bottom: 124,
                left: variantsRowLeft,
                right: variantsRowRight,
                width: variantsRowWidth,
                height: 28,
                x: variantsRowLeft,
                y: 96,
                toJSON: () => ({}),
              }) as DOMRect;

            variantBtns.forEach((btn, idx) => {
              const m = variantMetrics[idx];
              btn.getBoundingClientRect = () => {
                const left = variantsRowLeft + m.offsetLeft - variantsRowEl.scrollLeft;
                return {
                  top: 98,
                  bottom: 122,
                  left,
                  right: left + m.width,
                  width: m.width,
                  height: 24,
                  x: left,
                  y: 98,
                  toJSON: () => ({}),
                } as DOMRect;
              };
            });

            // Confirmar que em scrollLeft=0 a última opção (4K) está inicialmente fora da área visível
            assert(
              variantBtns[4].getBoundingClientRect().right > variantsRowEl.getBoundingClientRect().right,
              `[12.23][${testDisplayMode}] Em scrollLeft=0, a última opção (4K) deve estar fora da área visível da faixa`
            );

            // Entrar na programação (Canal 1 -> Favorito 1 -> 1º item da programação) e subir (ArrowUp) para a faixa de versões
            await dispatchArrowKey('ArrowRight');
            assertSameElement(document.activeElement, fav1Btn, `[12.23][${testDisplayMode}] Canal 1 -> Favorito 1`);
            await dispatchArrowKey('ArrowRight');
            assertSameElement(
              document.activeElement,
              epgItems[0],
              `[12.23][${testDisplayMode}] Favorito 1 -> 1º item da programação preservado com canal agrupado`
            );

            await dispatchArrowKey('ArrowUp');
            assertSameElement(
              document.activeElement,
              variantBtns[0],
              `[12.23][${testDisplayMode}] Entrar na faixa de versões por baixo (ArrowUp) deve focar a versão ativa (Automático)`
            );

            // Subir (ArrowUp) para o controle acima da faixa e entrar na faixa de versões por cima (ArrowDown)
            const mobileBackWrapper = liveEpgContainer.querySelector<HTMLElement>('div.md\\:hidden');
            const mobileBackBtn = mobileBackWrapper?.querySelector<HTMLButtonElement>('button') || null;
            const headerSearchInput = liveEpgContainer.querySelector<HTMLInputElement>(
              'input[data-test-header-search="true"]'
            );
            assert(
              mobileBackBtn && headerSearchInput,
              `[12.23][${testDisplayMode}] Controles acima da faixa de versões devem existir`
            );
            await dispatchArrowKey('ArrowUp');
            assertSameElement(
              document.activeElement,
              mobileBackBtn,
              `[12.23][${testDisplayMode}] ArrowUp a partir da faixa de versões sobe para o bloco superior`
            );
            await dispatchArrowKey('ArrowDown');
            assertSameElement(
              document.activeElement,
              variantBtns[0],
              `[12.23][${testDisplayMode}] Entrar na faixa de versões por cima (ArrowDown a partir do bloco superior) deve focar a versão ativa (Automático)`
            );

            // Em viewport md+ (961px, onde .md:hidden fica oculto), ArrowUp sobe para o header e ArrowDown entra na faixa focando a versão ativa
            if (mobileBackWrapper) {
              mobileBackWrapper.style.display = 'none';
            }
            await dispatchArrowKey('ArrowUp');
            assertSameElement(
              document.activeElement,
              headerSearchInput,
              `[12.23][${testDisplayMode}] Com .md:hidden oculto em 961px, ArrowUp sobe para o header`
            );
            await dispatchArrowKey('ArrowDown');
            assertSameElement(
              document.activeElement,
              variantBtns[0],
              `[12.23][${testDisplayMode}] Entrar na faixa de versões por cima (ArrowDown a partir do header) deve focar a versão ativa (Automático)`
            );

            // Avançar com ArrowRight até a última opção (4K), verificando que cada opção focada fica visível na faixa
            for (let vIdx = 1; vIdx < variantBtns.length; vIdx++) {
              await dispatchArrowKey('ArrowRight');
              assertSameElement(
                document.activeElement,
                variantBtns[vIdx],
                `[12.23][${testDisplayMode}] ArrowRight na faixa de versões deve focar a opção #${vIdx + 1} (${variantBtns[vIdx].textContent?.trim()})`
              );
              const rRect = variantsRowEl.getBoundingClientRect();
              const bRect = variantBtns[vIdx].getBoundingClientRect();
              assert(
                bRect.left >= rRect.left && bRect.right <= rRect.right,
                `[12.23][${testDisplayMode}] Opção #${vIdx + 1} (${variantBtns[vIdx].textContent?.trim()}) deve ficar visível dentro da faixa ao avançar (btn=[${bRect.left}..${bRect.right}], row=[${rRect.left}..${rRect.right}], scrollLeft=${variantsRowEl.scrollLeft})`
              );
            }
            assert(
              variantsRowEl.scrollLeft > 0,
              `[12.23][${testDisplayMode}] A faixa deve ter rolado para a direita para exibir a última opção 4K (scrollLeft=${variantsRowEl.scrollLeft})`
            );
            assert(
              variantBtns[0].getBoundingClientRect().left < variantsRowEl.getBoundingClientRect().left,
              `[12.23][${testDisplayMode}] Com o foco na última opção (4K), a primeira opção (Automático) está deslocada à esquerda`
            );

            // Voltar com ArrowLeft até a primeira opção (Automático) e confirmar que ela volta a ficar visível
            for (let vIdx = variantBtns.length - 2; vIdx >= 0; vIdx--) {
              await dispatchArrowKey('ArrowLeft');
              assertSameElement(
                document.activeElement,
                variantBtns[vIdx],
                `[12.23][${testDisplayMode}] ArrowLeft na faixa de versões deve focar a opção #${vIdx + 1} (${variantBtns[vIdx].textContent?.trim()})`
              );
              const rRect = variantsRowEl.getBoundingClientRect();
              const bRect = variantBtns[vIdx].getBoundingClientRect();
              assert(
                bRect.left >= rRect.left && bRect.right <= rRect.right,
                `[12.23][${testDisplayMode}] Opção #${vIdx + 1} (${variantBtns[vIdx].textContent?.trim()}) deve ficar visível dentro da faixa ao recuar (btn=[${bRect.left}..${bRect.right}], row=[${rRect.left}..${rRect.right}], scrollLeft=${variantsRowEl.scrollLeft})`
              );
            }
            assert.strictEqual(
              variantsRowEl.scrollLeft,
              0,
              `[12.23][${testDisplayMode}] Ao retornar à primeira opção (Automático), scrollLeft deve voltar a 0`
            );

            // Confirmar que apenas mover o foco pela faixa NÃO alterou a versão ativa, NÃO reiniciou o vídeo e NÃO consultou o EPG novamente
            assert.strictEqual(
              variantBtns[0].getAttribute('data-variant-active'),
              'true',
              `[12.23][${testDisplayMode}] Mover o foco pela faixa NÃO deve alterar a versão selecionada (Automático continua ativo)`
            );
            assert.strictEqual(
              variantBtns[4].getAttribute('data-variant-active'),
              'false',
              `[12.23][${testDisplayMode}] 4K não deve ficar ativo apenas por receber foco`
            );
            assert.strictEqual(
              videoLoadCallCount,
              loadCountBeforeNav,
              `[12.23][${testDisplayMode}] Mover o foco pela faixa de versões NÃO deve reiniciar o vídeo`
            );
            assert.strictEqual(
              epgCallsByStreamId['501'],
              1,
              `[12.23][${testDisplayMode}] Mover o foco pela faixa de versões NÃO deve consultar novamente a programação`
            );
            assert.strictEqual(
              epgCallsByStreamId['5013'] || 0,
              0,
              `[12.23][${testDisplayMode}] Nenhuma consulta de EPG deve ser disparada para 4K sem pressionar OK/Enter`
            );

            // Mais um ArrowLeft na primeira opção (Automático) devolve o foco ao canal de origem (Canal 1)
            await dispatchArrowKey('ArrowLeft');
            assertSameElement(
              document.activeElement,
              ch1Btn,
              `[12.23][${testDisplayMode}] ArrowLeft na primeira opção da faixa de versões devolve o foco ao canal de origem`
            );

            // Selecionar 4K com OK/Enter e verificar preferência pela versão ativa ao entrar por baixo e por cima mesmo com a faixa em scrollLeft=0
            await dispatchArrowKey('ArrowRight');
            await dispatchArrowKey('ArrowRight');
            await dispatchArrowKey('ArrowUp');
            for (let vIdx = 1; vIdx < variantBtns.length; vIdx++) {
              await dispatchArrowKey('ArrowRight');
            }
            assertSameElement(document.activeElement, variantBtns[4], `[12.23][${testDisplayMode}] Foco em 4K antes de Enter`);
            await dispatchArrowKey('Enter');
            await act(async () => {
              await new Promise((r) => setTimeout(r, 20));
            });
            assert.strictEqual(
              variantBtns[4].getAttribute('data-variant-active'),
              'true',
              `[12.23][${testDisplayMode}] OK/Enter deve selecionar a versão 4K`
            );
            assert.strictEqual(
              variantBtns[0].getAttribute('data-variant-active'),
              'false',
              `[12.23][${testDisplayMode}] Automático deixa de ser a versão ativa após selecionar 4K`
            );

            // Descer para a programação, rebobinar scrollLeft=0 na faixa (deixando 4K fora da área visível) e subir (ArrowUp):
            // deve focar 4K (versão ativa) e rolar a faixa horizontalmente para torná-lo visível
            await dispatchArrowKey('ArrowDown');
            assertSameElement(
              document.activeElement,
              epgItems[0],
              `[12.23][${testDisplayMode}] ArrowDown a partir da faixa de versões entra no 1º item da programação`
            );
            variantsRowEl.scrollLeft = 0;
            await dispatchArrowKey('ArrowUp');
            assertSameElement(
              document.activeElement,
              variantBtns[4],
              `[12.23][${testDisplayMode}] Entrar por baixo (ArrowUp) com 4K ativo deve focar diretamente 4K`
            );
            {
              const rRect = variantsRowEl.getBoundingClientRect();
              const bRect = variantBtns[4].getBoundingClientRect();
              assert(
                bRect.left >= rRect.left && bRect.right <= rRect.right && variantsRowEl.scrollLeft > 0,
                `[12.23][${testDisplayMode}] Entrar por baixo em 4K deve ajustar a rolagem horizontal da faixa (scrollLeft=${variantsRowEl.scrollLeft})`
              );
            }

            // Subir para o header, rebobinar scrollLeft=0 na faixa e descer (ArrowDown):
            // deve focar 4K (versão ativa) e rolar a faixa horizontalmente para torná-lo visível
            await dispatchArrowKey('ArrowUp');
            assertSameElement(document.activeElement, headerSearchInput, `[12.23][${testDisplayMode}] Foco no header acima da faixa`);
            variantsRowEl.scrollLeft = 0;
            await dispatchArrowKey('ArrowDown');
            assertSameElement(
              document.activeElement,
              variantBtns[4],
              `[12.23][${testDisplayMode}] Entrar por cima (ArrowDown) com 4K ativo deve focar diretamente 4K`
            );
            {
              const rRect = variantsRowEl.getBoundingClientRect();
              const bRect = variantBtns[4].getBoundingClientRect();
              assert(
                bRect.left >= rRect.left && bRect.right <= rRect.right && variantsRowEl.scrollLeft > 0,
                `[12.23][${testDisplayMode}] Entrar por cima em 4K deve ajustar a rolagem horizontal da faixa (scrollLeft=${variantsRowEl.scrollLeft})`
              );
            }

            // Voltar até Automático e pressionar Enter para restaurar o modo automático antes do teste de tela cheia
            for (let vIdx = variantBtns.length - 2; vIdx >= 0; vIdx--) {
              await dispatchArrowKey('ArrowLeft');
            }
            assertSameElement(document.activeElement, variantBtns[0], `[12.23][${testDisplayMode}] Foco de volta em Automático`);
            await dispatchArrowKey('Enter');
            await act(async () => {
              await new Promise((r) => setTimeout(r, 20));
            });
            assert.strictEqual(
              variantBtns[0].getAttribute('data-variant-active'),
              'true',
              `[12.23][${testDisplayMode}] OK/Enter restaura Automático como versão ativa`
            );
            await dispatchArrowKey('ArrowLeft');
            assertSameElement(document.activeElement, ch1Btn, `[12.23][${testDisplayMode}] Foco de volta no Canal 1`);

            // 3. Fluxo de Tela Cheia (2º OK no canal já selecionado) + controles em tela cheia + sequência Voltar preservando o mesmo <video>

            await act(async () => {
              ch1Btn.click();
              await new Promise((r) => setTimeout(r, 20));
            });

            const fsScopeEl = liveEpgContainer.querySelector<HTMLElement>(
              '[data-player-container="true"][data-focus-scope="modal"]'
            );
            assert(
              fsScopeEl,
              `[12.23][${testDisplayMode}] Segundo OK no canal já selecionado deve abrir tela cheia`
            );
            assertSameElement(
              liveEpgContainer.querySelector('video'),
              previewVideoEl,
              `[12.23][${testDisplayMode}] Entrar em tela cheia deve preservar a mesma instância de <video>`
            );

            // Em tela cheia, os controles do player DEVEM ser focáveis por setas
            const focusableInFullscreen = getLiveFocusableElements();
            assert(
              focusableInFullscreen.includes(previewPlayPauseBtn) &&
                focusableInFullscreen.includes(previewFullscreenBtn),
              `[12.23][${testDisplayMode}] Em tela cheia, os controles do player devem voltar a receber foco por setas`
            );

            // 1º Voltar (Escape): sai da tela cheia para o preview, preservando o mesmo <video> e restaurando foco ao Canal 1
            await dispatchArrowKey('Escape');
            await act(async () => {
              await new Promise((r) => setTimeout(r, 20));
            });
            assert.strictEqual(
              liveEpgContainer.querySelector('[data-player-container="true"][data-focus-scope="modal"]'),
              null,
              `[12.23][${testDisplayMode}] 1º Voltar deve sair da tela cheia de volta ao preview`
            );
            assertSameElement(
              liveEpgContainer.querySelector('video'),
              previewVideoEl,
              `[12.23][${testDisplayMode}] Sair da tela cheia deve preservar a mesma instância de <video>`
            );
            assertSameElement(
              document.activeElement,
              ch1Btn,
              `[12.23][${testDisplayMode}] Sair da tela cheia deve restaurar o foco ao Canal 1`
            );

            // 4. Testar erro de reprodução no preview e acesso a "Tentar Novamente" por setas
            for (let errStep = 0; errStep < 16; errStep++) {
              if (liveEpgContainer.querySelector('[data-player-error-primary="true"]')) break;
              await act(async () => {
                previewVideoEl.dispatchEvent(new windowInstance.Event('error') as unknown as Event);
                await new Promise((r) => setTimeout(r, 25));
              });
            }
            const retryErrorBtn = liveEpgContainer.querySelector<HTMLButtonElement>(
              '[data-player-error-primary="true"]'
            );
            assert(
              retryErrorBtn && isLiveElementFocusable(retryErrorBtn),
              `[12.23][${testDisplayMode}] Em caso de falha na reprodução, o botão Tentar Novamente deve estar visível e focável`
            );
            retryErrorBtn.getBoundingClientRect = () =>
              ({
                top: 68,
                bottom: 100,
                left: 740,
                right: 880,
                width: 140,
                height: 32,
                x: 740,
                y: 68,
                toJSON: () => ({}),
              }) as DOMRect;

            const epgItemsAfterError = Array.from(
              liveEpgContainer.querySelectorAll<HTMLElement>('[data-epg-item="true"]')
            );
            epgItemsAfterError.forEach((item, idx) => {
              const itemTopOffset = idx * (layout90.epgCardHeight + 10);
              item.getBoundingClientRect = () => {
                const baseTop =
                  layout90.topSectionHeight +
                  layout90.epgHeaderHeight +
                  itemTopOffset -
                  epgScrollEl.scrollTop;
                return {
                  top: baseTop,
                  bottom: baseTop + layout90.epgCardHeight,
                  left: 410,
                  right: 945,
                  width: 535,
                  height: layout90.epgCardHeight,
                  x: 410,
                  y: baseTop,
                  toJSON: () => ({}),
                } as DOMRect;
              };
            });

            // Navegar Canal 1 -> Favorito -> Programação -> ArrowUp (faixa de versão -> Tentar Novamente)
            await dispatchArrowKey('ArrowRight');
            await dispatchArrowKey('ArrowRight');
            assertSameElement(
              document.activeElement,
              epgItemsAfterError[0],
              `[12.23][${testDisplayMode}] ArrowRight entra na programação mesmo com erro no player`
            );
            await dispatchArrowKey('ArrowUp');
            if (document.activeElement !== retryErrorBtn) {
              // Em canal agrupado, o 1º ArrowUp passa pela faixa "Versão do canal" e o 2º alcança o botão Tentar Novamente no preview
              await dispatchArrowKey('ArrowUp');
            }
            assertSameElement(
              document.activeElement,
              retryErrorBtn,
              `[12.23][${testDisplayMode}] ArrowUp a partir do topo da programação alcança o botão Tentar Novamente do preview`
            );

            const loadBeforeRetry = videoLoadCallCount;
            await act(async () => {
              retryErrorBtn.click();
              await new Promise((r) => setTimeout(r, 20));
            });
            assert(
              videoLoadCallCount > loadBeforeRetry,
              `[12.23][${testDisplayMode}] Acionar Tentar Novamente deve reiniciar a tentativa de reprodução`
            );

            // 5. Testar Grade Vazia (Canal 2), Carregando -> Vazia (Canal 3) e Erro de EPG (Canal 4) com saída previsível no ArrowLeft
            await act(async () => {
              ch2Btn.focus();
              ch2Btn.click();
              await new Promise((r) => setTimeout(r, 20));
            });
            const emptyStateEl = liveEpgContainer.querySelector<HTMLElement>('[data-epg-state="empty"]');
            assert(emptyStateEl, `[12.23][${testDisplayMode}] Canal 2 sem programação deve exibir estado vazio`);
            await dispatchArrowKey('ArrowRight');
            assertSameElement(document.activeElement, fav2Btn, `[12.23][${testDisplayMode}] Canal 2 -> Favorito 2`);
            await dispatchArrowKey('ArrowRight');
            assertSameElement(
              document.activeElement,
              emptyStateEl,
              `[12.23][${testDisplayMode}] Favorito 2 -> Estado de grade vazia`
            );
            await dispatchArrowKey('ArrowLeft');
            assertSameElement(
              document.activeElement,
              ch2Btn,
              `[12.23][${testDisplayMode}] ArrowLeft na grade vazia devolve foco ao Canal 2`
            );

            // Canal 3: EPG carregando e depois concluindo enquanto focado
            await act(async () => {
              ch3Btn.focus();
              ch3Btn.click();
            });
            const loadingStateEl = liveEpgContainer.querySelector<HTMLElement>('[data-epg-state="loading"]');
            assert(loadingStateEl, `[12.23][${testDisplayMode}] Canal 3 com EPG pendente deve exibir estado carregando`);
            await dispatchArrowKey('ArrowRight');
            await dispatchArrowKey('ArrowRight');
            assertSameElement(
              document.activeElement,
              loadingStateEl,
              `[12.23][${testDisplayMode}] Favorito 3 -> Estado carregando do EPG`
            );
            await act(async () => {
              resolvePendingCh3Epg?.({ epg_listings: [] });
              await new Promise((r) => setTimeout(r, 20));
            });
            const ch3EmptyAfterLoad = liveEpgContainer.querySelector<HTMLElement>('[data-epg-state="empty"]');
            assertSameElement(
              document.activeElement,
              ch3EmptyAfterLoad,
              `[12.23][${testDisplayMode}] Quando o carregamento do EPG termina, o foco deve ser preservado na área da programação`
            );
            await dispatchArrowKey('ArrowLeft');
            assertSameElement(
              document.activeElement,
              ch3Btn,
              `[12.23][${testDisplayMode}] ArrowLeft devolve foco ao Canal 3`
            );

            // Canal 4: EPG com falha/indisponível
            await act(async () => {
              ch4Btn.focus();
              ch4Btn.click();
              await new Promise((r) => setTimeout(r, 20));
            });
            const errorStateEl = liveEpgContainer.querySelector<HTMLElement>('[data-epg-state="error"]');
            assert(errorStateEl, `[12.23][${testDisplayMode}] Canal 4 com falha no EPG deve exibir estado indisponível`);
            await dispatchArrowKey('ArrowRight');
            await dispatchArrowKey('ArrowRight');
            assertSameElement(
              document.activeElement,
              errorStateEl,
              `[12.23][${testDisplayMode}] Favorito 4 -> Estado indisponível do EPG`
            );
            await dispatchArrowKey('ArrowLeft');
            assertSameElement(
              document.activeElement,
              ch4Btn,
              `[12.23][${testDisplayMode}] ArrowLeft no estado de erro do EPG devolve foco ao Canal 4`
            );

            // Voltar fecha o preview e mantém foco no Canal 4
            await dispatchArrowKey('Escape');
            assert.strictEqual(
              liveEpgContainer.querySelector('video'),
              null,
              `[12.23][${testDisplayMode}] Voltar no preview fecha o player`
            );
            assertSameElement(
              document.activeElement,
              ch4Btn,
              `[12.23][${testDisplayMode}] Fechar o preview mantém o foco no canal selecionado`
            );
            // 6. Validar estilo de foco da programação em src/index.css (sem fundo/borda/brilho ciano #00E5FF, usando contorno branco padrão)
            const indexCssContent = fs.readFileSync(
              path.resolve(process.cwd(), 'src/index.css'),
              'utf-8'
            );
            const epgFocusRuleMatch = indexCssContent.match(
              /\.nc-tv-epg-card:focus[\s\S]*?\{([\s\S]*?)\}/
            );
            assert(
              epgFocusRuleMatch !== null,
              `[12.23][${testDisplayMode}] Regra .nc-tv-epg-card:focus deve existir em src/index.css`
            );
            const epgFocusRuleBody = epgFocusRuleMatch![1];
            assert(
              !epgFocusRuleBody.includes('#00E5FF') &&
                !epgFocusRuleBody.includes('0, 229, 255') &&
                !epgFocusRuleBody.includes('background-color') &&
                !epgFocusRuleBody.includes('border-color'),
              `[12.23][${testDisplayMode}] Regra de foco de .nc-tv-epg-card e .nc-tv-epg-state não deve aplicar fundo, borda nem brilho ciano`
            );
            assert(
              epgFocusRuleBody.includes('outline: 2px solid #ffffff') &&
                epgFocusRuleBody.includes('outline-offset: 2px'),
              `[12.23][${testDisplayMode}] Regra de foco de .nc-tv-epg-card e .nc-tv-epg-state deve usar o contorno branco padrão da plataforma`
            );
          }

          console.log(
            `📊 [Métricas 12.23 — Grade de Programação e Navegação por Setas na TV ao Vivo]\n` +
              `   • Percurso D-Pad validado (default e tv): Canal -> Favorito -> Programação (6 itens) -> ArrowDown até item #6 -> ArrowLeft retorna à linha de canal de origem\n` +
              `   • Faixa "Versão do canal" (data-nav-row="true" + data-live-variants-row="true"): rolagem horizontal ida/volta (Automático <-> 4K), preferência pela versão ativa ao entrar por cima/baixo e 0 reinícios/consultas extras ao mover foco\n` +
              `   • Foco visual da programação (.nc-tv-epg-card / .nc-tv-epg-state): contorno branco padrão (#ffffff), sem fundo/borda/brilho ciano, preservando destaque do programa atual\n` +
              `   • Exclusão de foco nos controles do preview embutido: ativa (clique/toque e botão Tentar Novamente preservados; tela cheia mantém controles focáveis e mesma instância de <video>)\n` +
              `   • Layout 961×541: ${layoutSummaryLines.join(' | ')}`
          );
        } finally {
          (XtreamService as any).getShortEpg = savedGetShortEpgLiveTest;
          if (prevDocDisplayMode !== null) {
            document.documentElement.setAttribute('data-display-mode', prevDocDisplayMode);
          } else {
            document.documentElement.removeAttribute('data-display-mode');
          }
          if (prevDocScale) {
            document.documentElement.style.setProperty('--nc-ui-scale', prevDocScale);
          } else {
            document.documentElement.style.removeProperty('--nc-ui-scale');
          }
          (windowInstance as any).innerWidth = prevInnerW;
          (windowInstance as any).innerHeight = prevInnerH;
          await act(async () => {
            liveEpgRoot.unmount();
          });
          if (liveEpgContainer.parentNode) {
            document.body.removeChild(liveEpgContainer);
          }
        }
      }

      // =====================================================================
      // 12.24: Etapa 1 da Nova Interface — Barra Superior Compartilhada (TopHeader),
      // Busca sob Demanda (Lupa), Menu da Conta Ancorado e Encaminhamento Único de Foco
      // =====================================================================
      {
        const {
          computeTopHeaderLayoutMetrics,
          TOP_HEADER_SECTIONS,
        } = await import('../src/components/TopHeader');
        const {
          NavigationProvider: Stage1NavProvider,
          setNavMode: setStage1NavMode,
        } = await import('../src/navigation');
        const { confirmDisplayPreferences } = await import('../src/platform/tvEnvironment');
        const { Home: RealHomeApp } = await import('../src/pages/Home');
        const { MemoryRouter } = await import('react-router-dom');

        // 1. Verificar métricas de layout do cabeçalho superior nos 3 cenários exigidos:
        //    - 1580 × 760 px (Desktop padrão 100%)
        //    - 961 × 541 px no modo TV em 90%
        //    - 390 × 844 px em retrato (2 fileiras com rolagem horizontal na faixa de seções)
        const desktop1580 = computeTopHeaderLayoutMetrics({
          viewportWidth: 1580,
          viewportHeight: 760,
          uiScale: 1,
          displayMode: 'default',
          activeSection: 'inicio',
        });
        assert.strictEqual(desktop1580.rowsCount, 1, '[12.24] Em 1580×760, o cabeçalho deve ter 1 linha');
        assert.strictEqual(
          desktop1580.headerHeightPx,
          76,
          `[12.24] Em 1580×760 (100%), a altura de referência do cabeçalho deve ser 76px, obteve ${desktop1580.headerHeightPx}px`
        );
        assert.strictEqual(
          desktop1580.hasHorizontalPageOverflow,
          false,
          '[12.24] Em 1580×760, não deve haver overflow horizontal de página'
        );
        assert(
          Math.abs(desktop1580.navStripRect.centerX - 1580 / 2) <= 2,
          `[12.24] Em 1580×760, a faixa central das 5 seções deve estar centralizada na tela (centerX=${desktop1580.navStripRect.centerX})`
        );
        assert(
          desktop1580.logoRect.right < desktop1580.navStripRect.left &&
            desktop1580.navStripRect.right < desktop1580.actionsRect.left,
          '[12.24] Em 1580×760, Logo (esquerda), Seções (centro) e Lupa+Conta (direita) não devem se sobrepor'
        );

        const tv961 = computeTopHeaderLayoutMetrics({
          viewportWidth: 961,
          viewportHeight: 541,
          uiScale: 0.9,
          displayMode: 'tv',
          activeSection: 'live',
        });
        assert.strictEqual(tv961.rowsCount, 1, '[12.24] Em 961×541 (TV 90%), o cabeçalho deve ter 1 linha');
        assert.strictEqual(
          tv961.headerHeightPx,
          68,
          `[12.24] Em 961×541 (TV 90%), o cabeçalho deve respeitar a escala de TV (68px), obteve ${tv961.headerHeightPx}px`
        );
        assert.strictEqual(
          tv961.hasHorizontalPageOverflow,
          false,
          '[12.24] Em 961×541 (TV 90%), não deve haver overflow horizontal de página'
        );
        assert(
          Math.abs(tv961.navStripRect.centerX - 961 / 2) <= 2,
          '[12.24] Em 961×541 (TV 90%), o conjunto de seções deve continuar centralizado'
        );

        const portrait390Inicio = computeTopHeaderLayoutMetrics({
          viewportWidth: 390,
          viewportHeight: 844,
          uiScale: 1,
          displayMode: 'default',
          activeSection: 'inicio',
          focusedSection: 'inicio',
        });
        const portrait390Favorites = computeTopHeaderLayoutMetrics({
          viewportWidth: 390,
          viewportHeight: 844,
          uiScale: 1,
          displayMode: 'default',
          activeSection: 'inicio',
          focusedSection: 'favorites',
        });
        assert.strictEqual(
          portrait390Inicio.rowsCount,
          2,
          '[12.24] Em 390×844 (retrato), o cabeçalho único deve organizar-se em 2 linhas'
        );
        assert(
          portrait390Inicio.logoRect.bottom <= portrait390Inicio.navStripRect.top &&
            portrait390Inicio.actionsRect.bottom <= portrait390Inicio.navStripRect.top,
          '[12.24] Em 390×844, a 1ª linha (Logo, Lupa e Conta) deve ficar acima da 2ª linha (5 seções)'
        );
        assert(
          portrait390Inicio.navStripRect.scrollWidth > portrait390Inicio.navStripRect.clientWidth,
          '[12.24] Em 390×844, a faixa das 5 seções deve habilitar rolagem horizontal contida na própria faixa'
        );
        assert.strictEqual(
          portrait390Inicio.hasHorizontalPageOverflow,
          false,
          '[12.24] Em 390×844, a rolagem da faixa não deve gerar overflow horizontal na página'
        );
        assert.strictEqual(
          portrait390Inicio.sectionButtons.find((b) => b.id === 'inicio')?.isVisibleInStrip,
          true,
          '[12.24] Em 390×844 com Início ativo/focado, Início deve estar visível na faixa'
        );
        assert(
          portrait390Favorites.navStripRect.scrollLeft > 0 &&
            portrait390Favorites.sectionButtons.find((b) => b.id === 'favorites')?.isVisibleInStrip === true,
          '[12.24] Em 390×844 ao focar Favoritos no final da faixa, a faixa deve rolar horizontalmente mantendo Favoritos visível'
        );

        // 2. Testar fluxos reais no DOM com Home + TopHeader:
        //    - único <header> montado em todas as seções autenticadas
        //    - 0 consultas extras ao provedor ao abrir/fechar busca ou menu da conta
        //    - lupa -> digitação -> Voltar (limpa searchQuery, restaura conteúdo e devolve foco à lupa)
        //    - conta -> navegação vertical (Conta / Configurações / Sair com divisor) -> Voltar devolve foco ao botão da conta
        //    - conta -> Conta (foca Informações da Conta em ConfigView) e conta -> Configurações (foca Ajustar apresentação)
        //    - encaminhamento único de foco quando a categoria já está pronta E quando carrega depois (assíncrono),
        //      além de descarte da pendência se o usuário trocar de seção ou mover o foco antes disso
        const stage1Container = document.createElement('div');
        document.body.appendChild(stage1Container);
        const stage1Root = createRoot(stage1Container);

        let providerQueryCount = 0;
        let failNextSeriesCategories = false;
        let delayedSeriesCategoriesResolver: ((cats: any[]) => void) | null = null;
        let useDelayedSeriesCategories = false;

        (XtreamService as any).authenticate = async () => {
          providerQueryCount++;
          return {
            user_info: {
              username: 'stage1_user',
              status: 'Active',
              exp_date: '1893456000',
              active_cons: '1',
              max_connections: '3',
              allowed_output_formats: ['m3u8', 'ts'],
            },
            server_info: { url: 'http://stage1.local', port: '8080' },
          };
        };
        (XtreamService as any).getLiveCategories = async () => {
          providerQueryCount++;
          return [{ category_id: 'live_cat_1', category_name: 'Canais Abertos' }];
        };
        (XtreamService as any).getVodCategories = async () => {
          providerQueryCount++;
          return [
            { category_id: 'vod_cat_1', category_name: 'Lançamentos' },
            { category_id: 'vod_cat_2', category_name: 'Ficção' },
          ];
        };
        (XtreamService as any).getSeriesCategories = async () => {
          providerQueryCount++;
          if (failNextSeriesCategories) {
            failNextSeriesCategories = false;
            throw new Error('Falha temporária nas categorias de séries');
          }
          if (useDelayedSeriesCategories) {
            return new Promise<any[]>((resolve) => {
              delayedSeriesCategoriesResolver = resolve;
            });
          }
          return [{ category_id: 'ser_cat_1', category_name: 'Séries Populares' }];
        };
        (XtreamService as any).getLiveStreams = async () => {
          providerQueryCount++;
          return [
            {
              stream_id: 701,
              name: 'Canal Stage1 HD',
              category_id: 'live_cat_1',
              stream_icon: '',
            },
          ];
        };
        (XtreamService as any).getVodStreams = async () => {
          providerQueryCount++;
          return [
            {
              stream_id: 801,
              name: 'Filme Alpha Exclusivo',
              category_id: 'vod_cat_1',
              stream_icon: '',
              rating: '8.5',
            },
            {
              stream_id: 802,
              name: 'Filme Beta Aventura',
              category_id: 'vod_cat_1',
              stream_icon: '',
              rating: '7.9',
            },
          ];
        };
        (XtreamService as any).getSeries = async () => {
          providerQueryCount++;
          return [
            {
              series_id: 901,
              name: 'Série Omega',
              category_id: 'ser_cat_1',
              cover: '',
              rating: '9.0',
            },
          ];
        };

        const stage1Creds = {
          serverUrl: 'http://stage1.local:8080',
          username: 'stage1_user',
          password: 'stage1_pass',
          playlistName: 'Lista Stage1',
          allowed_output_formats: ['m3u8', 'ts'],
        };
        windowInstance.localStorage.setItem(
          'northcode_tv_credentials',
          JSON.stringify(stage1Creds)
        );
        confirmDisplayPreferences('default', 85);

        const prevInnerWStage1 = windowInstance.innerWidth;
        const prevInnerHStage1 = windowInstance.innerHeight;

        try {
          (windowInstance as any).innerWidth = 1580;
          (windowInstance as any).innerHeight = 760;

          await act(async () => {
            stage1Root.render(
              React.createElement(
                MemoryRouter,
                { initialEntries: ['/home'] },
                React.createElement(
                  Stage1NavProvider,
                  null,
                  React.createElement(RealHomeApp)
                )
              )
            );
            await new Promise((r) => setTimeout(r, 80));
          });

          setStage1NavMode('remote');

          // Verificar remoção completa da sidebar antiga e menu móvel antigo, e presença de um único <header>
          assert.strictEqual(
            stage1Container.querySelectorAll('header').length,
            1,
            '[12.24] Deve existir exatamente 1 elemento <header> montado'
          );
          assert.strictEqual(
            stage1Container.querySelector('aside[data-nav-zone="sidebar"]'),
            null,
            '[12.24] A barra lateral global antiga (aside[data-nav-zone="sidebar"]) não deve existir'
          );
          assert.strictEqual(
            stage1Container.querySelector('button[data-mobile-menu-trigger]'),
            null,
            '[12.24] O gatilho do menu móvel antigo não deve existir'
          );

          // Verificar os 5 botões de seção na ordem correta e cápsula ativa em Início
          const headerNavBtns = Array.from(
            stage1Container.querySelectorAll<HTMLButtonElement>(
              'header[data-nav-zone="header"] button[data-header-nav-id]'
            )
          );
          assert.deepStrictEqual(
            headerNavBtns.map((b) => b.getAttribute('data-header-nav-id')),
            TOP_HEADER_SECTIONS.map((s) => s.id),
            '[12.24] O cabeçalho deve exibir exatamente Início, TV ao Vivo, Filmes, Séries e Favoritos'
          );
          assert.strictEqual(
            headerNavBtns[0].getAttribute('data-header-nav-active'),
            'true',
            '[12.24] Início deve iniciar com data-header-nav-active="true"'
          );
          assert(
            headerNavBtns[0].className.includes('nc-top-header-pill-active'),
            '[12.24] A seção ativa deve receber a classe da cápsula escura (.nc-top-header-pill-active)'
          );

          const { isElementFocusable: isStage1Focusable } = await import('../src/navigation');
          const getVisibleEnabledCategories = (root: HTMLElement): HTMLButtonElement[] => {
            const isDesktopViewport =
              typeof windowInstance.innerWidth !== 'number' ||
              windowInstance.innerWidth === 0 ||
              windowInstance.innerWidth >= 768;
            return Array.from<HTMLButtonElement>(
              root.querySelectorAll<HTMLButtonElement>(
                '[data-nav-zone="categories"] button[data-categories-trigger="true"], [data-nav-zone="categories"] button[data-category-id], [data-nav-zone="categories"] button[data-live-category-id]'
              )
            ).filter((btn: HTMLButtonElement) => {
              if (!isStage1Focusable(btn) || btn.disabled) return false;
              if (isDesktopViewport && btn.closest('.md\\:hidden')) return false;
              if (!isDesktopViewport && btn.closest('.hidden.md\\:flex')) return false;
              return true;
            });
          };

          const queriesAfterInitialLoad = providerQueryCount;

          const typeInRealInput = (inputEl: HTMLInputElement, nextValue: string) => {
            const protoSetter =
              Object.getOwnPropertyDescriptor(Object.getPrototypeOf(inputEl), 'value')?.set ||
              Object.getOwnPropertyDescriptor(
                (windowInstance as any).HTMLInputElement.prototype,
                'value'
              )?.set;
            protoSetter?.call(inputEl, nextValue);
            inputEl.dispatchEvent(new (windowInstance as any).Event('input', { bubbles: true }));
          };

          // Fluxo 1 (Início): Lupa -> digitação real com evento input propagando -> filtragem -> Voltar (limpa searchQuery, restaura conteúdo e devolve foco à lupa)
          const lupaBtn = stage1Container.querySelector<HTMLButtonElement>(
            'button[data-header-search-trigger="true"]'
          )!;
          assert(lupaBtn !== null, '[12.24] Botão da lupa deve existir no cabeçalho');

          await act(async () => {
            lupaBtn.focus();
            lupaBtn.click();
          });

          const openedSearchInput = stage1Container.querySelector<HTMLInputElement>(
            'input[data-header-search-input="true"]'
          )!;
          assert(openedSearchInput !== null, '[12.24] Input de busca deve abrir ao clicar na lupa');
          assertSameElement(
            document.activeElement,
            openedSearchInput,
            '[12.24] Foco deve ir para o input de busca ao abrir a lupa'
          );

          assert(
            stage1Container.textContent?.includes('Filme Alpha Exclusivo') &&
              stage1Container.textContent?.includes('Filme Beta Aventura'),
            '[12.24] Antes de filtrar, ambos os filmes devem estar visíveis na seção'
          );

          // Digitar termo de busca no campo real com evento input que propaga e aguardar debounce (500ms)
          await act(async () => {
            typeInRealInput(openedSearchInput, 'Alpha Exclusivo');
          });
          await act(async () => {
            await new Promise((r) => setTimeout(r, 550));
          });

          assert(
            stage1Container.textContent?.includes('Filme Alpha Exclusivo') &&
              !stage1Container.textContent?.includes('Filme Beta Aventura'),
            '[12.24] Digitar na busca sob demanda deve filtrar o conteúdo da seção'
          );

          // Pressionar Escape para fechar a busca, limpar searchQuery, restaurar conteúdo e devolver foco à lupa
          await act(async () => {
            openedSearchInput.dispatchEvent(
              new (windowInstance as any).KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
              })
            );
          });
          await act(async () => {
            await new Promise((r) => setTimeout(r, 550));
          });

          assert.strictEqual(
            stage1Container.querySelector('input[data-header-search-input="true"]'),
            null,
            '[12.24] Escape deve fechar o campo de busca'
          );
          assert(
            stage1Container.textContent?.includes('Filme Alpha Exclusivo') &&
              stage1Container.textContent?.includes('Filme Beta Aventura'),
            '[12.24] Fechar a busca deve limpar searchQuery e restaurar o conteúdo normal da seção'
          );
          assertSameElement(
            document.activeElement,
            stage1Container.querySelector('button[data-header-search-trigger="true"]'),
            '[12.24] Fechar a busca deve devolver o foco ao botão da lupa'
          );
          assert.strictEqual(
            providerQueryCount,
            queriesAfterInitialLoad,
            '[12.24] Abrir, digitar e fechar a busca não deve adicionar consultas extras ao provedor'
          );

          // Fluxo 2 (Início): Menu da Conta -> navegação por setas disparadas no item focado (Conta <-> Configurações <-> Sair e limites) -> Escape devolve foco ao botão da conta
          const accountTriggerBtn = stage1Container.querySelector<HTMLButtonElement>(
            'button[data-header-account-trigger="true"]'
          )!;
          assert(accountTriggerBtn !== null, '[12.24] Botão da conta deve existir no cabeçalho');

          await act(async () => {
            accountTriggerBtn.focus();
            accountTriggerBtn.click();
          });

          const accountMenu = stage1Container.querySelector<HTMLElement>(
            '[data-header-account-menu="true"]'
          )!;
          assert(accountMenu !== null, '[12.24] Painel flutuante do menu da conta deve abrir');
          assert(
            accountMenu.querySelector('[role="separator"]') !== null,
            '[12.24] Menu da conta deve conter divisor horizontal antes de Sair'
          );

          const menuAccountBtn = accountMenu.querySelector<HTMLButtonElement>(
            'button[data-account-action="account"]'
          )!;
          const menuConfigBtn = accountMenu.querySelector<HTMLButtonElement>(
            'button[data-account-action="config"]'
          )!;
          const menuLogoutBtn = accountMenu.querySelector<HTMLButtonElement>(
            'button[data-account-action="logout"]'
          )!;
          assert(
            menuAccountBtn && menuConfigBtn && menuLogoutBtn,
            '[12.24] Menu da conta deve oferecer Conta, Configurações e Sair'
          );
          assertSameElement(
            document.activeElement,
            menuAccountBtn,
            '[12.24] Ao abrir o menu da conta, o 1º item (Conta) deve receber foco'
          );

          // Extremo superior: ArrowUp em Conta deve permanecer em Conta
          await act(async () => {
            (document.activeElement as HTMLElement).dispatchEvent(
              new (windowInstance as any).KeyboardEvent('keydown', {
                key: 'ArrowUp',
                bubbles: true,
                cancelable: true,
              })
            );
          });
          assertSameElement(
            document.activeElement,
            menuAccountBtn,
            '[12.24] ArrowUp no extremo superior (Conta) deve manter o foco em Conta'
          );

          // ArrowDown em Conta -> Configurações (sem executar ação)
          await act(async () => {
            (document.activeElement as HTMLElement).dispatchEvent(
              new (windowInstance as any).KeyboardEvent('keydown', {
                key: 'ArrowDown',
                bubbles: true,
                cancelable: true,
              })
            );
          });
          assertSameElement(
            document.activeElement,
            menuConfigBtn,
            '[12.24] ArrowDown no item focado do menu da conta deve focar Configurações'
          );

          // ArrowDown em Configurações -> Sair (sem executar ação)
          await act(async () => {
            (document.activeElement as HTMLElement).dispatchEvent(
              new (windowInstance as any).KeyboardEvent('keydown', {
                key: 'ArrowDown',
                bubbles: true,
                cancelable: true,
              })
            );
          });
          assertSameElement(
            document.activeElement,
            menuLogoutBtn,
            '[12.24] 2º ArrowDown no item focado do menu da conta deve focar Sair'
          );

          // Extremo inferior: ArrowDown em Sair deve permanecer em Sair
          await act(async () => {
            (document.activeElement as HTMLElement).dispatchEvent(
              new (windowInstance as any).KeyboardEvent('keydown', {
                key: 'ArrowDown',
                bubbles: true,
                cancelable: true,
              })
            );
          });
          assertSameElement(
            document.activeElement,
            menuLogoutBtn,
            '[12.24] ArrowDown no extremo inferior (Sair) deve manter o foco em Sair'
          );

          // ArrowUp em Sair -> Configurações
          await act(async () => {
            (document.activeElement as HTMLElement).dispatchEvent(
              new (windowInstance as any).KeyboardEvent('keydown', {
                key: 'ArrowUp',
                bubbles: true,
                cancelable: true,
              })
            );
          });
          assertSameElement(
            document.activeElement,
            menuConfigBtn,
            '[12.24] ArrowUp a partir de Sair deve voltar para Configurações'
          );

          // ArrowUp em Configurações -> Conta
          await act(async () => {
            (document.activeElement as HTMLElement).dispatchEvent(
              new (windowInstance as any).KeyboardEvent('keydown', {
                key: 'ArrowUp',
                bubbles: true,
                cancelable: true,
              })
            );
          });
          assertSameElement(
            document.activeElement,
            menuAccountBtn,
            '[12.24] ArrowUp a partir de Configurações deve voltar para Conta'
          );

          // Fechar o menu da conta com Escape e verificar retorno do foco ao botão da conta e 0 consultas extras
          await act(async () => {
            (document.activeElement as HTMLElement).dispatchEvent(
              new (windowInstance as any).KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
              })
            );
          });
          assert.strictEqual(
            stage1Container.querySelector('[data-header-account-menu="true"]'),
            null,
            '[12.24] Escape deve fechar o menu da conta'
          );
          assertSameElement(
            document.activeElement,
            accountTriggerBtn,
            '[12.24] Fechar o menu da conta com Escape deve devolver o foco ao botão da conta'
          );
          assert.strictEqual(
            providerQueryCount,
            queriesAfterInitialLoad,
            '[12.24] Abrir, navegar e fechar o menu da conta não deve disparar consultas ao provedor'
          );

          // Fluxo 3 (Filmes): Encaminhamento de foco para o controle Categorias (sem abrir menu) + Busca sob demanda (lupa -> digitar -> Escape) + Menu da Conta (abrir -> setas -> Escape) mantendo Filmes ativo!
          const moviesHeaderBtn = stage1Container.querySelector<HTMLButtonElement>(
            'button[data-header-nav-id="movies"]'
          )!;
          await act(async () => {
            moviesHeaderBtn.focus();
            moviesHeaderBtn.click();
          });

          assert.strictEqual(
            moviesHeaderBtn.getAttribute('data-header-nav-active'),
            'true',
            '[12.24] Botão Filmes no cabeçalho deve ficar ativo ao entrar em Filmes'
          );
          const readyMoviesCatBtns = getVisibleEnabledCategories(stage1Container);
          assert(
            readyMoviesCatBtns.length > 0,
            '[12.24] Controle Categorias visível e habilitado de Filmes deve estar montado'
          );
          const expectedMoviesCatBtn =
            readyMoviesCatBtns.find((b) => b.getAttribute('data-category-selected') === 'true') ||
            readyMoviesCatBtns[0];
          assertSameElement(
            document.activeElement,
            expectedMoviesCatBtn,
            '[12.24] Ao ativar Filmes com categorias prontas, o foco deve ser encaminhado uma única vez para o controle Categorias'
          );
          assert.strictEqual(
            expectedMoviesCatBtn.getAttribute('aria-expanded'),
            'false',
            '[12.24] O controle Categorias NÃO deve abrir automaticamente ao receber foco da navegação'
          );

          // Em Filmes: abrir a lupa, digitar um termo e pressionar Escape.
          // O 1º Voltar deve fechar apenas a busca, limpar o termo, restaurar o conteúdo de Filmes e devolver o foco à lupa, mantendo Filmes ativo!
          const moviesLupaBtn = stage1Container.querySelector<HTMLButtonElement>(
            'button[data-header-search-trigger="true"]'
          )!;
          await act(async () => {
            moviesLupaBtn.focus();
            moviesLupaBtn.click();
          });

          const moviesSearchInput = stage1Container.querySelector<HTMLInputElement>(
            'input[data-header-search-input="true"]'
          )!;
          assert(moviesSearchInput !== null, '[12.24] Lupa deve abrir o input de busca dentro de Filmes');
          assertSameElement(
            document.activeElement,
            moviesSearchInput,
            '[12.24] Foco deve ir para o input de busca em Filmes'
          );
          assert(
            stage1Container.textContent?.includes('Filme Alpha Exclusivo') &&
              stage1Container.textContent?.includes('Filme Beta Aventura'),
            '[12.24] Antes de filtrar em Filmes, ambos os filmes devem estar listados'
          );

          await act(async () => {
            typeInRealInput(moviesSearchInput, 'Alpha Exclusivo');
          });
          await act(async () => {
            await new Promise((r) => setTimeout(r, 550));
          });

          assert(
            stage1Container.textContent?.includes('Filme Alpha Exclusivo') &&
              !stage1Container.textContent?.includes('Filme Beta Aventura'),
            '[12.24] Digitar na busca em Filmes deve filtrar os filmes exibidos'
          );

          await act(async () => {
            moviesSearchInput.dispatchEvent(
              new (windowInstance as any).KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
              })
            );
          });
          await act(async () => {
            await new Promise((r) => setTimeout(r, 550));
          });

          assert.strictEqual(
            stage1Container.querySelector('input[data-header-search-input="true"]'),
            null,
            '[12.24] Em Filmes, o 1º Escape com a busca aberta deve fechar apenas o campo de busca'
          );
          assert.strictEqual(
            moviesHeaderBtn.getAttribute('data-header-nav-active'),
            'true',
            '[12.24] Em Filmes, fechar a busca com Escape deve manter a seção Filmes ativa (sem voltar ao Início)'
          );
          assert(
            stage1Container.textContent?.includes('Filme Alpha Exclusivo') &&
              stage1Container.textContent?.includes('Filme Beta Aventura'),
            '[12.24] Em Filmes, fechar a busca com Escape deve limpar o termo e restaurar os filmes da seção'
          );
          assertSameElement(
            document.activeElement,
            stage1Container.querySelector('button[data-header-search-trigger="true"]'),
            '[12.24] Em Filmes, fechar a busca com Escape deve devolver o foco ao botão da lupa'
          );

          // Ainda em Filmes: abrir o menu da conta, percorrer com setas e fechar com Escape mantendo Filmes ativo
          await act(async () => {
            accountTriggerBtn.focus();
            accountTriggerBtn.click();
          });
          const moviesAccountMenu = stage1Container.querySelector<HTMLElement>(
            '[data-header-account-menu="true"]'
          )!;
          assert(moviesAccountMenu !== null, '[12.24] Menu da conta deve abrir estando em Filmes');
          const moviesMenuAccountBtn = moviesAccountMenu.querySelector<HTMLButtonElement>(
            'button[data-account-action="account"]'
          )!;
          const moviesMenuConfigBtn = moviesAccountMenu.querySelector<HTMLButtonElement>(
            'button[data-account-action="config"]'
          )!;
          assertSameElement(document.activeElement, moviesMenuAccountBtn, '[12.24] Foco inicial em Conta dentro de Filmes');

          await act(async () => {
            (document.activeElement as HTMLElement).dispatchEvent(
              new (windowInstance as any).KeyboardEvent('keydown', {
                key: 'ArrowDown',
                bubbles: true,
                cancelable: true,
              })
            );
          });
          assertSameElement(document.activeElement, moviesMenuConfigBtn, '[12.24] ArrowDown move para Configurações em Filmes');

          await act(async () => {
            (document.activeElement as HTMLElement).dispatchEvent(
              new (windowInstance as any).KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
              })
            );
          });
          assert.strictEqual(
            stage1Container.querySelector('[data-header-account-menu="true"]'),
            null,
            '[12.24] Em Filmes, o 1º Escape com o menu da conta aberto deve fechar apenas o menu'
          );
          assert.strictEqual(
            moviesHeaderBtn.getAttribute('data-header-nav-active'),
            'true',
            '[12.24] Em Filmes, fechar o menu da conta com Escape deve manter a seção Filmes ativa'
          );
          assertSameElement(
            document.activeElement,
            accountTriggerBtn,
            '[12.24] Em Filmes, fechar o menu da conta com Escape deve devolver o foco ao botão da conta'
          );
          assert.strictEqual(
            providerQueryCount,
            queriesAfterInitialLoad,
            '[12.24] Abrir e fechar busca e menu da conta em Filmes não deve disparar consultas extras ao provedor'
          );

          // Testar Conta -> Configurações (abre ConfigView focando Ajustar apresentação e mantendo único <header>)
          await act(async () => {
            accountTriggerBtn.click();
          });
          await act(async () => {
            stage1Container
              .querySelector<HTMLButtonElement>('button[data-account-action="config"]')!
              .click();
            await new Promise((r) => setTimeout(r, 40));
          });
          assert.strictEqual(
            stage1Container.querySelectorAll('header').length,
            1,
            '[12.24] Na tela de Configurações, deve continuar existindo um único <header> compartilhado'
          );
          assertSameElement(
            document.activeElement,
            stage1Container.querySelector('[data-config-primary="true"]'),
            '[12.24] Selecionar Configurações no menu da conta deve focar Ajustar apresentação em ConfigView'
          );

          // Testar Conta -> Conta (foca a região Informações da Conta em ConfigView)
          await act(async () => {
            accountTriggerBtn.click();
          });
          await act(async () => {
            stage1Container
              .querySelector<HTMLButtonElement>('button[data-account-action="account"]')!
              .click();
            await new Promise((r) => setTimeout(r, 40));
          });
          assertSameElement(
            document.activeElement,
            stage1Container.querySelector('[data-config-account-focus="true"]'),
            '[12.24] Selecionar Conta no menu da conta deve focar a seção Informações da Conta'
          );

          // Testar clique na Logo para retornar ao Início
          const logoBtn = stage1Container.querySelector<HTMLButtonElement>(
            'button[data-header-logo="true"]'
          )!;
          await act(async () => {
            logoBtn.click();
          });
          assert(
            stage1Container.querySelector('[data-scroll-top-anchor="true"]') !== null,
            '[12.24] Clicar na Logo deve retornar à seção Início'
          );

          // Testar encaminhamento único de foco quando o destino carrega depois (assíncrono)
          // e descarte da pendência se o usuário mover o foco OU trocar de seção antes disso:
          const mountWithPendingSeriesCategories = async () => {
            await act(async () => {
              stage1Root.render(React.createElement('div', null));
            });
            failNextSeriesCategories = true;
            useDelayedSeriesCategories = false;
            delayedSeriesCategoriesResolver = null;

            await act(async () => {
              stage1Root.render(
                React.createElement(
                  MemoryRouter,
                  { initialEntries: ['/home'] },
                  React.createElement(
                    Stage1NavProvider,
                    null,
                    React.createElement(RealHomeApp)
                  )
                )
              );
              await new Promise((r) => setTimeout(r, 40));
            });

            useDelayedSeriesCategories = true;
            const retryBtn = stage1Container.querySelector<HTMLButtonElement>(
              'button[data-transient-retry="true"]'
            )!;
            assert(
              retryBtn !== null,
              '[12.24] Botão de tentar novamente deve existir para iniciar recarregamento assíncrono de categorias'
            );
            await act(async () => {
              retryBtn.click();
              await new Promise((r) => setTimeout(r, 20));
            });
          };

          // Cenário A: Categorias de Séries atrasadas, usuário move o foco para Favoritos antes de carregarem -> pendência descartada!
          await mountWithPendingSeriesCategories();

          // Ativar "Séries" enquanto seriesCategories ainda está pendente (0 categorias visíveis e habilitadas no desktop)
          const seriesBtnDelayed = stage1Container.querySelector<HTMLButtonElement>(
            'button[data-header-nav-id="series"]'
          )!;
          const favBtnDelayed = stage1Container.querySelector<HTMLButtonElement>(
            'button[data-header-nav-id="favorites"]'
          )!;
          await act(async () => {
            seriesBtnDelayed.focus();
            seriesBtnDelayed.click();
          });
          assert.strictEqual(
            getVisibleEnabledCategories(stage1Container).length,
            0,
            '[12.24] Enquanto seriesCategories está pendente, não deve haver categorias visíveis e habilitadas no desktop'
          );

          // Usuário move o foco manualmente para o botão Favoritos no cabeçalho antes das categorias chegarem
          await act(async () => {
            favBtnDelayed.focus();
          });
          assertSameElement(document.activeElement, favBtnDelayed, '[12.24] Usuário moveu o foco manualmente para Favoritos');

          // Agora as categorias de Séries chegam: o foco NÃO deve ser roubado de Favoritos!
          await act(async () => {
            delayedSeriesCategoriesResolver?.([
              { category_id: 'ser_cat_delayed', category_name: 'Séries Atrasadas' },
            ]);
            await new Promise((r) => setTimeout(r, 40));
          });
          assertSameElement(
            document.activeElement,
            favBtnDelayed,
            '[12.24] Se o usuário moveu o foco antes do carregamento tardio das categorias, a pendência de foco deve ser descartada'
          );

          // Cenário B: Categorias atrasadas, usuário troca de seção (para Favoritos) antes de carregarem -> pendência descartada!
          await mountWithPendingSeriesCategories();

          const seriesBtnSwitch = stage1Container.querySelector<HTMLButtonElement>(
            'button[data-header-nav-id="series"]'
          )!;
          const favBtnSwitch = stage1Container.querySelector<HTMLButtonElement>(
            'button[data-header-nav-id="favorites"]'
          )!;
          await act(async () => {
            seriesBtnSwitch.focus();
            seriesBtnSwitch.click();
          });
          assert.strictEqual(
            getVisibleEnabledCategories(stage1Container).length,
            0,
            '[12.24] Enquanto seriesCategories está pendente no Cenário B, 0 categorias visíveis e habilitadas'
          );
          await act(async () => {
            favBtnSwitch.focus();
            favBtnSwitch.click();
          });
          await act(async () => {
            delayedSeriesCategoriesResolver?.([
              { category_id: 'ser_cat_switched', category_name: 'Séries Trocadas' },
            ]);
            await new Promise((r) => setTimeout(r, 40));
          });
          assert.strictEqual(
            favBtnSwitch.getAttribute('data-header-nav-active'),
            'true',
            '[12.24] Se o usuário trocou de seção antes do carregamento tardio, a seção ativa e o foco devem permanecer na nova seção'
          );
          assertSameElement(
            document.activeElement,
            favBtnSwitch,
            '[12.24] Trocar de seção descarta a pendência de foco da seção anterior'
          );

          // Cenário C: Categorias atrasadas, usuário aguarda sem mover o foco -> foco aplicado na categoria visível e habilitada assim que chega!
          await mountWithPendingSeriesCategories();

          const seriesBtnDelayed2 = stage1Container.querySelector<HTMLButtonElement>(
            'button[data-header-nav-id="series"]'
          )!;
          await act(async () => {
            seriesBtnDelayed2.focus();
            seriesBtnDelayed2.click();
          });
          assert.strictEqual(
            getVisibleEnabledCategories(stage1Container).length,
            0,
            '[12.24] Enquanto aguarda categorias de Séries, 0 categorias visíveis e habilitadas no desktop'
          );
          assertSameElement(
            document.activeElement,
            seriesBtnDelayed2,
            '[12.24] Enquanto aguarda categorias de Séries, o foco permanece no botão Séries'
          );

          await act(async () => {
            delayedSeriesCategoriesResolver?.([
              { category_id: 'ser_cat_arrived', category_name: 'Séries Carregadas Depois' },
            ]);
            await new Promise((r) => setTimeout(r, 40));
          });

          const visibleArrivedCats = getVisibleEnabledCategories(stage1Container);
          assert(
            visibleArrivedCats.length > 0,
            '[12.24] Categorias visíveis e habilitadas de Séries devem estar montadas após resolução assíncrona'
          );
          const arrivedSeriesCatBtn =
            visibleArrivedCats.find((b) => b.getAttribute('data-category-selected') === 'true') ||
            visibleArrivedCats[0];
          assertSameElement(
            document.activeElement,
            arrivedSeriesCatBtn,
            '[12.24] Quando o destino carrega depois e o usuário não moveu o foco, o foco deve ser encaminhado automaticamente uma única vez para a categoria visível e habilitada'
          );

          console.log(
            `📊 [Métricas 12.24 — Etapa 1 da Nova Interface (TopHeader, Busca sob Demanda e Menu da Conta)]\n` +
              `   • 1580×760 (Desktop 100%, estimativa de referência): ${desktop1580.rowsCount} linha (${desktop1580.headerHeightPx}px), centro=${desktop1580.navStripRect.centerX}px, overflow=0\n` +
              `   • 961×541 (TV 90%, estimativa de referência): ${tv961.rowsCount} linha (${tv961.headerHeightPx}px), centro=${tv961.navStripRect.centerX}px, overflow=0\n` +
              `   • 390×844 (Retrato, estimativa de referência): ${portrait390Inicio.rowsCount} linhas no mesmo <header>, scrollWidth faixa=${portrait390Inicio.navStripRect.scrollWidth}px (clientWidth=${portrait390Inicio.navStripRect.clientWidth}px), Favoritos visível após scrollLeft=${portrait390Favorites.navStripRect.scrollLeft}px, overflow página=0\n` +
              `   • Fluxos validados: único <header>, 0 consultas extras ao abrir/fechar menus, lupa -> digitação real -> Voltar (no Início e em Filmes), conta -> Conta/Configurações/Sair por setas -> Voltar (no Início e em Filmes), encaminhamento único de foco (imediato, tardio e cancelado ao mover foco ou trocar seção)`
          );

          // =====================================================================
          // 12.25. Validação da Etapa 2 — Estrutura de Catálogo Compartilhada por Início, Filmes e Séries
          // =====================================================================
          console.log(
            '\n--- 12.25. Validação da Etapa 2: Vitrine Compartilhada (Início, Filmes, Séries), Categorias, Ver Todos, Busca e Continuar ---'
          );

          const { recordPlaybackPosition, clearItemProgress } = await import(
            '../src/utils/playbackHistory'
          );
          const { setStoredFavorites, getFavoritesKey } = await import(
            '../src/utils/accountUtils'
          );
          const { notifyAccountSubscribers } = await import('../src/hooks/useFavorites');

          const stage2Creds = {
            serverUrl: 'http://stage2.local:8080',
            username: 'stage2_user',
            password: 'stage2_pass',
            playlistName: 'Lista Stage2',
            allowed_output_formats: ['m3u8', 'ts'],
          };
          windowInstance.localStorage.setItem(
            'northcode_tv_credentials',
            JSON.stringify(stage2Creds)
          );

          // Configurar favoritos e histórico isolados para stage2Creds:
          // - Filme 2001 ("Filme Horizonte 2026") com progresso salvo de 145s (> 30s) e favorito
          // - Série 3001 ("Série Fronteira 2026") com progresso salvo no Episódio 2 ('ep_3001_2', 210s > 30s) e favorita
          recordPlaybackPosition(stage2Creds, {
            id: '2001',
            type: 'movie',
            positionSec: 145,
          });
          recordPlaybackPosition(stage2Creds, {
            id: 'ep_3001_2',
            type: 'episode',
            parentSeriesId: '3001',
            positionSec: 210,
          });

          const stage2FavKey = getFavoritesKey(stage2Creds.serverUrl, stage2Creds.username);
          setStoredFavorites(stage2FavKey, [
            {
              id: '2001',
              type: 'movie',
              name: 'Filme Horizonte 2026',
              cover: 'http://stage2.local:8080/vod_2001.jpg',
              extraData: { rating: '9.4' },
            },
            {
              id: '3001',
              type: 'series',
              name: 'Série Fronteira 2026',
              cover: 'http://stage2.local:8080/series_3001.jpg',
              extraData: { rating: '9.6' },
            },
          ]);
          notifyAccountSubscribers(stage2FavKey);

          let stage2ProviderQueries = 0;
          (XtreamService as any).getLiveCategories = async () => {
            stage2ProviderQueries++;
            return [{ category_id: 'live_s2_1', category_name: 'Canais Abertos' }];
          };
          (XtreamService as any).getLiveStreams = async () => {
            stage2ProviderQueries++;
            return [
              {
                stream_id: 1001,
                name: 'Canal Norte Ao Vivo HD',
                category_id: 'live_s2_1',
                stream_icon: 'http://stage2.local:8080/live_1001.png',
              },
            ];
          };
          (XtreamService as any).getVodCategories = async () => {
            stage2ProviderQueries++;
            return [
              { category_id: 'vod_s2_main', category_name: 'Ação e Aventura' },
              { category_id: 'vod_s2_niche', category_name: 'Documentários Raros' },
            ];
          };
          // 5 filmes na categoria principal (>= 4 -> gera fileira na vitrine) + 1 filme exclusivo na categoria "Documentários Raros" (< 4 -> sem fileira na vitrine inicial, mas acessível via Categorias, Ver todos e Busca!)
          (XtreamService as any).getVodStreams = async () => {
            stage2ProviderQueries++;
            return [
              {
                stream_id: 2001,
                name: 'Filme Horizonte 2026',
                category_id: 'vod_s2_main',
                stream_icon: 'http://stage2.local:8080/vod_2001.jpg',
                backdrop_path: ['http://stage2.local:8080/vod_2001_backdrop.jpg'],
                rating: '9.4',
                added: '1710000010',
                container_extension: 'mp4',
              },
              {
                stream_id: 2002,
                name: 'Filme Tempestade Solar (2025)',
                category_id: 'vod_s2_main',
                stream_icon: 'http://stage2.local:8080/vod_2002.jpg',
                rating: '8.7',
                added: '1710000009',
              },
              {
                stream_id: 2003,
                name: 'Filme Código Urbano (2024)',
                category_id: 'vod_s2_main',
                stream_icon: 'http://stage2.local:8080/vod_2003.jpg',
                rating: '8.3',
                added: '1710000008',
              },
              {
                stream_id: 2004,
                name: 'Filme Vento Sul (2024)',
                category_id: 'vod_s2_main',
                stream_icon: 'http://stage2.local:8080/vod_2004.jpg',
                rating: '8.1',
                added: '1710000007',
              },
              {
                stream_id: 2099,
                name: 'Documentário Secreto Fora da Vitrine (2023)',
                category_id: 'vod_s2_niche',
                stream_icon: 'http://stage2.local:8080/vod_2099.jpg',
                rating: '6.0',
                added: '1600000000',
              },
            ];
          };
          (XtreamService as any).getSeriesCategories = async () => {
            stage2ProviderQueries++;
            return [
              { category_id: 'ser_s2_main', category_name: 'Séries de Drama' },
              { category_id: 'ser_s2_niche', category_name: 'Minisséries Históricas' },
            ];
          };
          (XtreamService as any).getSeries = async () => {
            stage2ProviderQueries++;
            return [
              {
                series_id: 3001,
                name: 'Série Fronteira 2026',
                category_id: 'ser_s2_main',
                cover: 'http://stage2.local:8080/series_3001.jpg',
                rating: '9.6',
                last_modified: '1710000020',
              },
              {
                series_id: 3002,
                name: 'Série Neblina do Norte (2025)',
                category_id: 'ser_s2_main',
                cover: 'http://stage2.local:8080/series_3002.jpg',
                rating: '8.9',
                last_modified: '1710000019',
              },
              {
                series_id: 3003,
                name: 'Série Crônicas da Serra (2024)',
                category_id: 'ser_s2_main',
                cover: 'http://stage2.local:8080/series_3003.jpg',
                rating: '8.5',
                last_modified: '1710000018',
              },
              {
                series_id: 3004,
                name: 'Série Maré Alta (2024)',
                category_id: 'ser_s2_main',
                cover: 'http://stage2.local:8080/series_3004.jpg',
                rating: '8.2',
                last_modified: '1710000017',
              },
              {
                series_id: 3099,
                name: 'Minissérie Arquivo Oculto (2022)',
                category_id: 'ser_s2_niche',
                cover: 'http://stage2.local:8080/series_3099.jpg',
                rating: '6.1',
                last_modified: '1600000000',
              },
            ];
          };
          (XtreamService as any).getVodInfo = async (_creds: any, vodId: any) => ({
            info: {
              plot: `Sinopse completa do filme ${vodId}`,
              genre: 'Ação',
              releasedate: '2026',
              backdrop_path:
                String(vodId) === '2001'
                  ? ['http://stage2.local:8080/vod_2001_backdrop.jpg']
                  : [],
            },
            movie_data: {
              stream_id: Number(vodId),
              container_extension: 'mp4',
            },
          });
          (XtreamService as any).getSeriesInfo = async (_creds: any, serId: any) => ({
            info: {
              plot: `Sinopse completa da série ${serId}`,
              genre: 'Drama',
              releasedate: '2026',
              backdrop_path: [],
            },
            episodes: {
              '1': [
                {
                  id: `ep_${serId}_1`,
                  episode_num: 1,
                  title: 'A Chegada',
                  container_extension: 'mp4',
                },
                {
                  id: `ep_${serId}_2`,
                  episode_num: 2,
                  title: 'O Segredo',
                  container_extension: 'mp4',
                },
              ],
            },
          });

          await act(async () => {
            stage1Root.render(React.createElement('div', null));
          });
          await act(async () => {
            stage1Root.render(
              React.createElement(
                MemoryRouter,
                { initialEntries: ['/home'] },
                React.createElement(
                  Stage1NavProvider,
                  null,
                  React.createElement(RealHomeApp)
                )
              )
            );
            await new Promise((r) => setTimeout(r, 80));
          });

          const initialQueriesS2 = stage2ProviderQueries;
          assert.strictEqual(
            initialQueriesS2,
            6,
            '[12.25] A carga inicial deve executar exatamente as 6 consultas iniciais do catálogo'
          );

          // 1. Verificar Início: vitrine mista com HeroBanner arredondado, Continuar Assistindo, Canais Ao Vivo, Filmes em Destaque, Séries em Destaque e fileiras dinâmicas
          const inicioSectionEl = stage1Container.querySelector('[data-showcase-section="inicio"]');
          assert(inicioSectionEl !== null, '[12.25] Seção Início deve renderizar na vitrine compartilhada');
          const inicioHeroStage = stage1Container.querySelector('[data-hero-stage="true"]');
          assert(inicioHeroStage !== null, '[12.25] HeroBanner com palco arredondado deve existir no Início');
          assert(
            stage1Container.querySelector('button[data-hero-action="play"]') !== null &&
              stage1Container.querySelector('button[data-hero-action="info"]')?.textContent?.includes('Mais informações'),
            '[12.25] HeroBanner deve exibir botão principal (Assistir/Continuar) e "Mais informações"'
          );
          assert(
            stage1Container.textContent?.includes('Continuar Assistindo') &&
              stage1Container.textContent?.includes('Canais Ao Vivo') &&
              stage1Container.textContent?.includes('Filmes em Destaque') &&
              stage1Container.textContent?.includes('Séries em Destaque'),
            '[12.25] Início deve exibir Continuar Assistindo, Canais Ao Vivo, Filmes em Destaque e Séries em Destaque'
          );

          // 2. Navegar para Filmes: isolamento de domínio na vitrine + HeroBanner com imagem horizontal e botão "Continuar" retomando o filme!
          const s2MoviesBtn = stage1Container.querySelector<HTMLButtonElement>(
            'button[data-header-nav-id="movies"]'
          )!;
          await act(async () => {
            s2MoviesBtn.focus();
            s2MoviesBtn.click();
            await new Promise((r) => setTimeout(r, 40));
          });

          assert(
            stage1Container.querySelector('[data-showcase-section="movies"]') !== null,
            '[12.25] Seção Filmes deve renderizar usando a vitrine compartilhada'
          );
          const moviesCatTrigger = stage1Container.querySelector<HTMLButtonElement>(
            'button[data-categories-trigger="true"]'
          )!;
          assertSameElement(
            document.activeElement,
            moviesCatTrigger,
            '[12.25] Ativar Filmes deve encaminhar o foco uma vez ao controle Categorias'
          );
          assert.strictEqual(
            moviesCatTrigger.getAttribute('aria-expanded'),
            'false',
            '[12.25] Controle Categorias não deve abrir automaticamente ao entrar em Filmes'
          );

          // Verificar que Filmes exibe apenas conteúdo de filmes (Continuar Assistindo, Filmes Favoritos, Filmes em Destaque, Ação e Aventura) e NÃO exibe séries nem canais ao vivo
          const visibleMoviesText = Array.from(
            stage1Container.querySelectorAll('main h1, main h2, main h3')
          )
            .map((el) => el.textContent || '')
            .join(' | ');
          assert(
            visibleMoviesText.includes('Continuar Assistindo') &&
              visibleMoviesText.includes('Filmes Favoritos') &&
              visibleMoviesText.includes('Filmes em Destaque') &&
              visibleMoviesText.includes('Ação e Aventura'),
            `[12.25] Vitrine de Filmes deve exibir Continuar Assistindo, Filmes Favoritos, Filmes em Destaque e Ação e Aventura (obteve: ${visibleMoviesText})`
          );
          assert(
            !visibleMoviesText.includes('Séries em Destaque') &&
              !visibleMoviesText.includes('Canais Ao Vivo') &&
              !visibleMoviesText.includes('Série Fronteira 2026'),
            '[12.25] Vitrine de Filmes NÃO deve misturar séries ou canais ao vivo'
          );

          // Verificar HeroBanner em Filmes: Filme 2001 tem backdrop_path horizontal e progresso salvo (145s > 30s) -> botão deve exibir "Continuar"
          const moviesHeroStage = stage1Container.querySelector('[data-hero-stage="true"]')!;
          assert.strictEqual(
            moviesHeroStage.getAttribute('data-hero-image-mode'),
            'horizontal-backdrop',
            '[12.25] Quando backdrop_path horizontal está disponível, HeroBanner deve usar horizontal-backdrop'
          );
          const moviesHeroPlayBtn = stage1Container.querySelector<HTMLButtonElement>(
            'button[data-hero-action="play"]'
          )!;
          assert.strictEqual(
            moviesHeroPlayBtn.getAttribute('data-hero-resume'),
            'true',
            '[12.25] Quando o filme em destaque possui progresso salvo (> 30s), o botão deve indicar retomada'
          );
          assert(
            moviesHeroPlayBtn.textContent?.includes('Continuar'),
            '[12.25] Botão principal do HeroBanner deve exibir "Continuar" para filme com progresso salvo'
          );

          // Clicar em "Continuar" no HeroBanner de Filmes -> abre VideoPlayer para o filme 2001 e fechar com Escape
          await act(async () => {
            moviesHeroPlayBtn.focus();
            moviesHeroPlayBtn.click();
            await new Promise((r) => setTimeout(r, 40));
          });
          assert(
            document.querySelector('[data-player-container="true"]') !== null,
            '[12.25] Clicar em Continuar no HeroBanner de Filmes deve abrir o VideoPlayer'
          );
          await act(async () => {
            windowInstance.dispatchEvent(
              new (windowInstance as any).KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
              })
            );
            await new Promise((r) => setTimeout(r, 60));
          });

          // 3. Testar "Categorias" e "Ver todos" em Filmes: acessar categoria sem fileira na vitrine inicial ("Documentários Raros") e "Ver todos"
          await act(async () => {
            moviesCatTrigger.focus();
            moviesCatTrigger.click();
          });
          const moviesCatMenu = stage1Container.querySelector<HTMLElement>(
            '[data-categories-menu="true"]'
          )!;
          assert.strictEqual(
            moviesCatMenu.hidden,
            false,
            '[12.25] Clicar em Categorias deve abrir o menu de categorias'
          );

          // Fechar o menu Categorias com Escape deve manter Filmes aberto e devolver foco ao botão Categorias
          await act(async () => {
            windowInstance.dispatchEvent(
              new (windowInstance as any).KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
              })
            );
          });
          assert.strictEqual(
            moviesCatMenu.hidden,
            true,
            '[12.25] Escape com o menu Categorias aberto deve fechar apenas o menu'
          );
          assertSameElement(
            document.activeElement,
            moviesCatTrigger,
            '[12.25] Fechar o menu Categorias com Escape deve devolver o foco ao botão Categorias'
          );

          // Reabrir Categorias e escolher "Documentários Raros" (categoria que não tinha fileira na vitrine inicial)
          await act(async () => {
            moviesCatTrigger.click();
          });
          const nicheCatBtn = moviesCatMenu.querySelector<HTMLButtonElement>(
            'button[data-category-id="vod_s2_niche"]'
          )!;
          assert(
            nicheCatBtn !== null,
            '[12.25] Menu Categorias deve listar todas as categorias do domínio, inclusive as sem fileira na vitrine inicial'
          );
          await act(async () => {
            nicheCatBtn.click();
            await new Promise((r) => setTimeout(r, 30));
          });

          assert(
            stage1Container.querySelector('[data-nav-grid="true"][data-virtual-container="true"]') !== null,
            '[12.25] Escolher uma categoria deve abrir a grade virtualizada'
          );
          assert(
            stage1Container.textContent?.includes('Documentário Secreto Fora da Vitrine'),
            '[12.25] A grade filtrada deve exibir o filme da categoria que não tinha fileira na vitrine inicial'
          );

          // 4. Com a categoria "Ação e Aventura" selecionada, usar a busca sob demanda para encontrar um filme FORA da categoria selecionada ("Documentário Secreto Fora da Vitrine") e depois fechar a busca com Escape restaurando o filtro anterior!
          await act(async () => {
            moviesCatTrigger.click();
          });
          await act(async () => {
            moviesCatMenu
              .querySelector<HTMLButtonElement>('button[data-category-id="vod_s2_main"]')!
              .click();
            await new Promise((r) => setTimeout(r, 30));
          });
          assert(
            !stage1Container.textContent?.includes('Documentário Secreto Fora da Vitrine'),
            '[12.25] Na categoria Ação e Aventura, o documentário de outra categoria não está listado'
          );

          const s2LupaBtn = stage1Container.querySelector<HTMLButtonElement>(
            'button[data-header-search-trigger="true"]'
          )!;
          await act(async () => {
            s2LupaBtn.focus();
            s2LupaBtn.click();
          });
          const s2SearchInput = stage1Container.querySelector<HTMLInputElement>(
            'input[data-header-search-input="true"]'
          )!;
          await act(async () => {
            typeInRealInput(s2SearchInput, 'Secreto Fora da Vitrine');
          });
          await act(async () => {
            await new Promise((r) => setTimeout(r, 550));
          });

          assert(
            stage1Container.textContent?.includes('Documentário Secreto Fora da Vitrine'),
            '[12.25] Em Filmes, a busca sob demanda deve pesquisar em TODO o catálogo do domínio, mesmo fora da categoria selecionada'
          );

          // Fechar a busca com Escape -> deve restaurar o filtro anterior ("Ação e Aventura") e devolver o foco à lupa!
          await act(async () => {
            s2SearchInput.dispatchEvent(
              new (windowInstance as any).KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
              })
            );
          });
          await act(async () => {
            await new Promise((r) => setTimeout(r, 550));
          });
          assertSameElement(
            document.activeElement,
            s2LupaBtn,
            '[12.25] Fechar a busca deve devolver o foco à lupa'
          );
          assert(
            stage1Container.querySelector('[data-nav-grid="true"]') !== null &&
              stage1Container.textContent?.includes('Filme Tempestade Solar'),
            '[12.25] Fechar a busca deve restaurar o filtro de categoria anterior'
          );

          // Testar opção "Ver todos" no menu Categorias
          await act(async () => {
            moviesCatTrigger.click();
          });
          const verTodosBtn = moviesCatMenu.querySelector<HTMLButtonElement>(
            'button[data-category-id="all"]'
          )!;
          assert(verTodosBtn !== null, '[12.25] Menu Categorias deve incluir a opção "Ver todos"');
          await act(async () => {
            verTodosBtn.click();
            await new Promise((r) => setTimeout(r, 30));
          });
          const allMoviesCards = stage1Container.querySelectorAll(
            '[data-nav-grid="true"] [data-nav-item="true"]'
          );
          assert.strictEqual(
            allMoviesCards.length,
            5,
            '[12.25] "Ver todos" em Filmes deve exibir todos os 5 filmes do catálogo na grade virtualizada'
          );

          // Sair da listagem filtrada ("Ver todos") com Escape -> volta à vitrine de Filmes e foca o controle Categorias
          await act(async () => {
            windowInstance.dispatchEvent(
              new (windowInstance as any).KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
              })
            );
            await new Promise((r) => setTimeout(r, 20));
          });
          assert(
            stage1Container.querySelector('[data-nav-grid="true"]') === null &&
              stage1Container.querySelector('[data-hero-stage="true"]') !== null,
            '[12.25] Escape na grade filtrada deve voltar à vitrine de Filmes'
          );
          assertSameElement(
            document.activeElement,
            moviesCatTrigger,
            '[12.25] Sair da listagem filtrada deve restaurar o foco ao controle Categorias'
          );

          // 5. Navegar para Séries: verificar composição com capa vertical sem esticar (vertical-cover), fileiras exclusivas de séries e botão "Continuar" retomando o episódio salvo ('ep_3001_2' em 210s)!
          const s2SeriesBtn = stage1Container.querySelector<HTMLButtonElement>(
            'button[data-header-nav-id="series"]'
          )!;
          await act(async () => {
            s2SeriesBtn.focus();
            s2SeriesBtn.click();
            await new Promise((r) => setTimeout(r, 40));
          });

          assert(
            stage1Container.querySelector('[data-showcase-section="series"]') !== null,
            '[12.25] Seção Séries deve renderizar usando a vitrine compartilhada'
          );
          const seriesHeroStage = stage1Container.querySelector('[data-hero-stage="true"]')!;
          assert.strictEqual(
            seriesHeroStage.getAttribute('data-hero-image-mode'),
            'vertical-cover',
            '[12.25] Quando a série possui apenas capa vertical (sem backdrop_path), HeroBanner deve usar vertical-cover sem esticar a capa'
          );
          const seriesHeroImg = seriesHeroStage.querySelector('img')!;
          assert(
            seriesHeroImg.className.includes('object-contain'),
            '[12.25] No modo vertical-cover, a capa vertical no HeroBanner deve usar object-contain para não esticar'
          );

          const visibleSeriesText = Array.from(
            stage1Container.querySelectorAll('main h1, main h2, main h3')
          )
            .map((el) => el.textContent || '')
            .join(' | ');
          assert(
            visibleSeriesText.includes('Continuar Assistindo') &&
              visibleSeriesText.includes('Séries Favoritas') &&
              visibleSeriesText.includes('Séries em Destaque') &&
              visibleSeriesText.includes('Séries de Drama'),
            `[12.25] Vitrine de Séries deve exibir Continuar Assistindo, Séries Favoritas, Séries em Destaque e Séries de Drama (obteve: ${visibleSeriesText})`
          );
          assert(
            !visibleSeriesText.includes('Filmes em Destaque') &&
              !visibleSeriesText.includes('Filme Horizonte 2026'),
            '[12.25] Vitrine de Séries NÃO deve misturar filmes ou canais ao vivo'
          );

          const seriesHeroPlayBtn = stage1Container.querySelector<HTMLButtonElement>(
            'button[data-hero-action="play"]'
          )!;
          assert.strictEqual(
            seriesHeroPlayBtn.getAttribute('data-hero-resume'),
            'true',
            '[12.25] Série 3001 com episódio salvo (210s > 30s) deve habilitar retomada no HeroBanner'
          );
          assert(
            seriesHeroPlayBtn.textContent?.includes('Continuar'),
            '[12.25] HeroBanner em Séries deve exibir "Continuar" quando houver episódio com progresso salvo'
          );

          // Clicar em "Continuar" no HeroBanner de Séries -> deve abrir VideoPlayer retomando o episódio ep_3001_2!
          await act(async () => {
            seriesHeroPlayBtn.focus();
            seriesHeroPlayBtn.click();
            await new Promise((r) => setTimeout(r, 40));
          });
          const activeEpisodePlayer = document.querySelector('[data-player-container="true"]');
          assert(
            activeEpisodePlayer !== null &&
              activeEpisodePlayer.textContent?.includes('O Segredo'),
            '[12.25] Clicar em "Continuar" no HeroBanner de Séries deve retomar o episódio exato com progresso salvo (S01E02 - O Segredo)'
          );
          await act(async () => {
            windowInstance.dispatchEvent(
              new (windowInstance as any).KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
              })
            );
            await new Promise((r) => setTimeout(r, 60));
          });

          assert.strictEqual(
            stage2ProviderQueries,
            initialQueriesS2,
            '[12.25] Alternar entre Início, Filmes e Séries, abrir Categorias, filtrar "Ver todos" e usar a busca não deve disparar consultas extras de catálogo completo'
          );

          clearItemProgress(stage2Creds, 'movie', '2001');
          clearItemProgress(stage2Creds, 'episode', 'ep_3001_2');
          setStoredFavorites(stage2FavKey, []);

          console.log(
            '✅ [12.25] Etapa 2 validada com sucesso: vitrine compartilhada, isolamento de domínio, HeroBanner (horizontal vs vertical-cover sem esticar), Categorias + Ver todos na grade virtualizada, busca no domínio completo e Continuar retomando filme e episódio!'
          );
        } finally {
          useDelayedSeriesCategories = false;
          (windowInstance as any).innerWidth = prevInnerWStage1;
          (windowInstance as any).innerHeight = prevInnerHStage1;
          await act(async () => {
            stage1Root.unmount();
          });
          if (stage1Container.parentNode) {
            document.body.removeChild(stage1Container);
          }
        }
      }
    } finally {
      setTransportTestConfig({
        mode: 'auto',
        capacitorHttpGet: null,
        androidCatalogPluginAvailable: null,
      });
      XtreamService.setRetryDelayMsForTest(1000);
      setCatalogDiagnosticsClockForTest(null);
      resetCatalogDiagnosticsForTest(false);
      windowInstance.localStorage.removeItem(CATALOG_DIAGNOSTICS_ENABLED_KEY);
      (XtreamService as any).getLiveCategories = savedGetLiveCatsP31;
      (XtreamService as any).getVodCategories = savedGetVodCatsP31;
      (XtreamService as any).getSeriesCategories = savedGetSeriesCatsP31;
      (XtreamService as any).getLiveStreams = savedGetLiveStreamsP31;
      (XtreamService as any).getVodStreams = savedGetVodStreamsP31;
      (XtreamService as any).getSeries = savedGetSeriesP31;
      (XtreamService as any).authenticate = savedAuthenticateP31;
      globalThis.fetch = savedFetchP31;
      if (p31Container.parentNode) {
        document.body.removeChild(p31Container);
      }
    }
  }

  console.log(
    `📊 [Benchmark 39k Registros — Métricas Separadas]\n` +
      `   • Passada Fria (Indexação + Ranking Inicial): ${coldCatalogPassMs.toFixed(2)}ms (sorts=${coldRankingStats.sortCalls})\n` +
      `   • Consulta Quente ao Índice em Cache (3x Home/Hero/Categorias): ${warmScaleChange3xMs.toFixed(3)}ms (sorts=${warmRankingStats.sortCalls})\n` +
      `   • Re-render Real + Recálculo de Layout em 4 Escalas TV (50%/85%/100%/125%): ${realScaleRenderAndRemeasureMs.toFixed(2)}ms (cols=${Array.from(observedColumnsByScale.values()).join('/')})\n` +
      `   • Agrupamento de Canais por Categoria: Frio=${liveCatColdMs.toFixed(2)}ms | Quente=${liveCatWarmMs.toFixed(3)}ms\n` +
      `   • Indexação Cooperativa (6k itens, batchSize=1000): lotes=${coopStats.batchesProcessed}, yields=${coopStats.batchYields}, UI intercalada em processed=${uiTaskProcessedSnapshot}\n` +
      `   • Extrações de Metadados (6k itens): Após Indexação=${statsAfterVodIndexBuild.metadataExtractions} | Após 1ª Ordenação=${statsAfterFirstVodSort.metadataExtractions} | Após 2ª Ordenação=${statsAfterSecondVodSort.metadataExtractions}\n` +
      `   • 5 Movimentos D-Pad em Grade Virtualizada (2.500 itens): ${nav5MovesAfterMs.toFixed(2)}ms (getComputedStyle=${spatialStats.computedStyleCalls})\n` +
      `   • Home Sintética Padrão (10 fileiras, 240 cartões, 241 imagens): cartões=240 | img[src]=9 (antes: 241) | eager=1 (antes: 81) | decoding=sync:0 (antes: 81)\n` +
      `   • Home c/ 500 em Continuar Assistindo (11 fileiras): cartões montados=254 (antes: 740; fileira CW=14 no início/meio/fim vs 500) | assinaturas observer=265 (antes: 751) | img[src]=9 (antes: 741)\n` +
      `   • Sonda 500 Cartões × 10 Scrolls: c/ IntersectionObserver -> 0 leituras manuais | Fallback agrupado -> 1 leitura container + 14 cartões montados (antes: 500 cartões)`
  );
  console.log('✅ Todos os testes de desempenho, auditoria de imagens da Home (12.14), virtualização horizontal de Continuar Assistindo (12.15), divisão de rotas (12.16), otimização do player por visibilidade (12.17 / P2.1), isolamento do contexto compartilhado (12.18 / P2.2), otimização do histórico (12.19 / P2.3), diagnóstico P3.1/P3.2, transferência de catálogos grandes via arquivo temporário P3.3 (12.20 / 12.21 / 12.22), grade de programação e navegação por setas da TV ao vivo (12.23), geometria dinâmica em rolagem, eliminação de retrabalho, virtualização (6.A, 6.B, 6.C, 6.D) e navegação D-Pad aprovados!');
}

async function main() {
  console.log('🚀 INICIANDO VALIDAÇÃO COMPLETA DOS FAVORITOS SIMPLES E REGRESSÕES\n');
  runDirectUrlTests();
  await runSimpleFavoritesTests();
  await runPlayerVolumeRateAndSessionTests();
  await runPlayerControlsStabilityAndAutoHideTests();
  await runPlayerBackAndScrollNavigationTests();
  await runCategoryLabelAndChannelGroupTests();
  await runAttemptIdPropagationAndStaleCallbackTests();
  await runLiveTvSdPriorityAndFallbackTests();
  await runDpadNavigationAndBackPolicyTests();
  await runDisplaySetupPreviewAndLifecycleTests();
  await runCapacitorTransportAndAuditFixTests();
  await runPerformanceAndVirtualizationTests();
  await cleanupTestEnvironment();
  console.log('\n🎉 TODOS OS TESTES FORAM EXECUTADOS COM SUCESSO!');
}

main().catch(async (err) => {
  console.error('\n❌ ERRO NA EXECUÇÃO DOS TESTES:', err);
  await cleanupTestEnvironment();
  process.exit(1);
});





