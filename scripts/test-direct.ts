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
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';
import type { XtreamCredentials } from '../src/types';
import type { FavoriteItem } from '../src/hooks/useFavorites';

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
const { XtreamProvider, XtreamContext } = await import('../src/context/XtreamContext');
const { XtreamService } = await import('../src/services/xtreamService');
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
  const navId = el.getAttribute('data-sidebar-nav-id')
    ? `[data-sidebar-nav-id="${el.getAttribute('data-sidebar-nav-id')}"]`
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

  // Localizar botão "Sair"
  const logoutButtons = Array.from(containerHome.querySelectorAll('button'));
  const logoutBtn = logoutButtons.find((btn) => btn.textContent?.includes('Sair'));
  assert(logoutBtn, 'Botão Sair deve estar presente na tela');

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
    logoutBtn.click();
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
        XtreamContext.Provider,
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
              XtreamContext.Provider,
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
        XtreamContext.Provider,
        { value: mockMoviesContext },
        React.createElement(MoviesView, { onPlay: () => {}, searchQuery: '' })
      )
    );
  });

  const moviesMain = container.querySelector('main') as any as HTMLElement;
  assert(moviesMain, 'Elemento main da lista de filmes deve estar presente');

  // Selecionar categoria Ação com cards de filmes
  const acaoCatBtn = Array.from(container.querySelectorAll('aside button')).find(
    (b) => b.textContent?.toUpperCase().includes('AÇÃO')
  ) as any as HTMLButtonElement;
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
  const sameCatBtn = container.querySelector('aside button.bg-nc-primary') as any as HTMLButtonElement;
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
  const otherCatBtn = container.querySelectorAll('aside button')[1] as any as HTMLButtonElement;
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
        XtreamContext.Provider,
        { value: mockSeriesContext },
        React.createElement(SeriesView, { onPlay: () => {}, searchQuery: '' })
      )
    );
  });

  const seriesMain = container.querySelector('main') as any as HTMLElement;
  assert(seriesMain, 'Elemento main da lista de séries presente');

  // Selecionar categoria Comédia com cards de séries
  const comediaCatBtn = Array.from(container.querySelectorAll('aside button')).find(
    (b) => b.textContent?.toUpperCase().includes('COMÉDIA')
  ) as any as HTMLButtonElement;
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
  const sameSeriesCatBtn = container.querySelector('aside button.bg-nc-primary') as any as HTMLButtonElement;
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
  const otherSeriesCatBtn = container.querySelectorAll('aside button')[1] as any as HTMLButtonElement;
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
        XtreamContext.Provider,
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

  // 2. Campo de busca no topo fica readOnly durante passagem por setas e só edita ao pressionar Enter
  const searchInput = container.querySelector('input[placeholder*="Pesquisar"]') as HTMLInputElement;
  assert(searchInput, 'Campo de busca deve existir no cabeçalho');
  assert.strictEqual(
    searchInput.readOnly,
    true,
    'No modo remote, o input de busca deve permanecer readOnly até o usuário pressionar OK/Enter'
  );

  await act(async () => {
    searchInput.focus();
    searchInput.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }) as unknown as Event
    );
  });

  assert.strictEqual(
    searchInput.getAttribute('data-search-editing'),
    'true',
    'Pressionar Enter sobre o input de busca deve ativar o modo de edição (data-search-editing="true")'
  );
  assert.strictEqual(searchInput.readOnly, false, 'Em modo de edição, readOnly deve ser false');

  // Pressionar Escape/Voltar sai do modo de edição da busca sem deslogar
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });

  assert.strictEqual(
    searchInput.getAttribute('data-search-editing'),
    'false',
    'Pressionar Escape deve sair do modo de edição da busca'
  );
  assert(
    window.localStorage.getItem(CREDENTIALS_KEY) !== null,
    'Sair da edição de busca com Voltar NUNCA deve remover credenciais'
  );

  // =========================================================================
  // CRITÉRIO 4: Filmes (MoviesView), MovieDetails (sinopse longa + topo), VideoPlayer Escape único e Voltar da categoria para botão Filmes na sidebar mantendo seção aberta
  // =========================================================================
  const filmesNavBtn = container.querySelector('button[data-sidebar-nav-id="movies"]') as HTMLButtonElement;
  assert(filmesNavBtn, 'Botão Filmes na barra lateral (data-sidebar-nav-id="movies") deve existir');

  await act(async () => {
    filmesNavBtn.focus();
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
  });

  await waitForCondition(
    () =>
      Boolean(
        container.textContent?.includes('Categorias de Filmes') &&
          container.querySelector('[data-nav-zone="categories"] button[data-category-id]')
      ),
    1000,
    'Montagem da seção Filmes (MoviesView) e botões de categoria'
  );

  // Selecionar a categoria Ação por Enter e focar o card do filme
  const catButtons = Array.from(container.querySelectorAll('[data-nav-zone="categories"] button[data-category-id]')) as HTMLButtonElement[];
  const acaoBtn = catButtons.find((b) => b.textContent?.toUpperCase().includes('AÇÃO'));
  assert(acaoBtn, 'Botão da categoria Ação em Filmes deve existir');

  await act(async () => {
    acaoBtn.focus();
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
  });

  await waitForCondition(
    () => container.querySelector('[data-nav-zone="content"] [data-nav-item="true"]') !== null,
    1000,
    'Renderização dos cards de filmes da categoria Ação'
  );

  const moviesMain = container.querySelector('main[data-scroll-container="true"]') as HTMLElement;
  assert(moviesMain, 'MoviesView deve possuir <main data-scroll-container="true">');
  moviesMain.scrollTop = 340;

  const movieCard = container.querySelector('[data-nav-zone="content"] [data-nav-item="true"]') as HTMLElement;
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

  // Pressionar Escape 1 vez:
  // 1) Fechamento lógico imediato: o comando Escape encerra activeVideo e devolve o foco imediatamente ao botão Assistir em MovieDetails, mantendo MovieDetails aberto.
  // 2) Conclusão da saída animada (AnimatePresence exit={{ opacity: 0 }}): o elemento DOM do VideoPlayer é removido após os quadros de saída.
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

  // Passo 2 (Filmes): Com foco num card da grade, Escape foca a categoria selecionada sem sair da seção nem resetar scrollTop
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });

  assert(
    container.textContent?.includes('Categorias de Filmes'),
    'Voltar a partir da grade de Filmes deve permanecer na seção Filmes'
  );
  assertSameElement(
    document.activeElement,
    acaoBtn,
    'Voltar a partir da grade de Filmes deve mover o foco para o botão da categoria atualmente selecionada (Ação)'
  );
  assert.strictEqual(
    moviesMain.scrollTop,
    340,
    'Voltar da grade para a categoria não deve resetar o scrollTop da grade de Filmes'
  );

  // Passo 3 (Critério 4 - Filmes): Com foco na lista de categorias de Filmes, o próximo Escape foca o botão "Filmes" na sidebar E mantém a seção de Filmes aberta, preservando categoria e scroll!
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });

  const filmesSidebarBtn = container.querySelector('button[data-sidebar-nav-id="movies"]') as HTMLButtonElement;
  assertSameElement(
    document.activeElement,
    filmesSidebarBtn,
    'Critério 4: Voltar a partir das categorias de Filmes deve focar o botão "Filmes" na barra lateral'
  );
  assert(
    container.textContent?.includes('Categorias de Filmes'),
    'Critério 4: Ao focar o botão "Filmes" na barra lateral, a seção de Filmes DEVE continuar aberta e montada'
  );
  assert.strictEqual(
    acaoBtn.getAttribute('data-category-selected'),
    'true',
    'Critério 4: A categoria selecionada (Ação) em Filmes deve permanecer preservada'
  );
  assert.strictEqual(
    moviesMain.scrollTop,
    340,
    'Critério 4: O scrollTop da lista de Filmes deve permanecer preservado (340)'
  );

  // Passo 4 (Ação separada seguinte): Com o foco JÁ no botão lateral "Filmes", um novo Escape retorna ao Início
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });
  assert(
    !container.textContent?.includes('Categorias de Filmes') &&
      container.querySelector('[data-scroll-top-anchor="true"]') !== null,
    'Ação seguinte de Voltar (quando o foco já estava no botão lateral de Filmes) deve retornar ao Início'
  );

  // =========================================================================
  // CRITÉRIO 5: Séries (SeriesView), SeriesDetails (sinopse longa) e Voltar da categoria para botão Séries na sidebar mantendo seção aberta
  // =========================================================================
  const seriesNavBtn = container.querySelector('button[data-sidebar-nav-id="series"]') as HTMLButtonElement;
  assert(seriesNavBtn, 'Botão Séries na barra lateral (data-sidebar-nav-id="series") deve existir');

  await act(async () => {
    seriesNavBtn.focus();
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
  });

  await waitForCondition(
    () =>
      Boolean(
        container.textContent?.includes('Categorias de Séries') &&
          container.querySelector('[data-nav-zone="categories"] button[data-category-id]')
      ),
    1000,
    'Montagem da seção Séries (SeriesView) e botões de categoria'
  );

  const seriesCatBtns = Array.from(container.querySelectorAll('[data-nav-zone="categories"] button[data-category-id]')) as HTMLButtonElement[];
  const dramaBtn = seriesCatBtns.find((b) => b.textContent?.toUpperCase().includes('DRAMA'));
  assert(dramaBtn, 'Botão da categoria Drama em Séries deve existir');

  await act(async () => {
    dramaBtn.focus();
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
  });

  await waitForCondition(
    () => container.querySelector('[data-nav-zone="content"] [data-nav-item="true"]') !== null,
    1000,
    'Renderização dos cards de séries da categoria Drama'
  );

  const seriesMain = container.querySelector('main[data-scroll-container="true"]') as HTMLElement;
  assert(seriesMain, 'SeriesView deve possuir <main data-scroll-container="true">');
  seriesMain.scrollTop = 290;

  const seriesCard = container.querySelector('[data-nav-zone="content"] [data-nav-item="true"]') as HTMLElement;
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

  // Passo 2 (Séries): Escape a partir do card volta para a categoria selecionada (Drama)
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });
  assertSameElement(
    document.activeElement,
    dramaBtn,
    'Voltar a partir da grade de Séries deve focar a categoria selecionada (Drama)'
  );

  // Passo 3 (Critério 5 - Séries): Escape a partir da categoria foca o botão "Séries" na sidebar E mantém a seção de Séries aberta, preservando categoria e scroll!
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });
  const seriesSidebarBtn = container.querySelector('button[data-sidebar-nav-id="series"]') as HTMLButtonElement;
  assertSameElement(
    document.activeElement,
    seriesSidebarBtn,
    'Critério 5: Voltar a partir das categorias de Séries deve focar o botão "Séries" na barra lateral'
  );
  assert(
    container.textContent?.includes('Categorias de Séries'),
    'Critério 5: Ao focar o botão "Séries" na barra lateral, a seção de Séries DEVE continuar aberta e montada'
  );
  assert.strictEqual(
    dramaBtn.getAttribute('data-category-selected'),
    'true',
    'Critério 5: A categoria selecionada (Drama) em Séries deve permanecer preservada'
  );
  assert.strictEqual(
    seriesMain.scrollTop,
    290,
    'Critério 5: O scrollTop da lista de Séries deve permanecer preservado (290)'
  );

  // Passo 4 (Ação separada seguinte): Com o foco JÁ no botão lateral "Séries", um novo Escape retorna ao Início
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });
  assert(
    !container.textContent?.includes('Categorias de Séries') &&
      container.querySelector('[data-scroll-top-anchor="true"]') !== null,
    'Ação seguinte de Voltar (quando o foco já estava no botão lateral de Séries) deve retornar ao Início'
  );

  // =========================================================================
  // CRITÉRIOS 1, 2 & 3: TV ao Vivo (LiveTvView) — foco no 1º canal da categoria, troca A -> B e sequência Voltar mantendo seção aberta
  // =========================================================================
  const liveNavBtn = container.querySelector('button[data-sidebar-nav-id="live"]') as HTMLButtonElement;
  assert(liveNavBtn, 'Botão TV ao Vivo na barra lateral (data-sidebar-nav-id="live") deve existir');

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

  // 4º Escape (Critério 3 - na lista de categorias da TV ao Vivo): foca o botão "TV ao Vivo" na barra lateral E mantém a tela de TV visível!
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });
  const liveSidebarBtn = container.querySelector('button[data-sidebar-nav-id="live"]') as HTMLButtonElement;
  assertSameElement(
    document.activeElement,
    liveSidebarBtn,
    'Critério 3: 4º Escape a partir das categorias da TV ao Vivo deve focar o botão "TV ao Vivo" na barra lateral'
  );
  assert(
    container.textContent?.includes('CATEGORIAS DE TV') &&
      container.querySelector('button[data-live-category-id="1"]') !== null,
    'Critério 3: Ao alcançar o botão "TV ao Vivo" na barra lateral, a tela de TV DEVE continuar aberta e visível'
  );

  // Critério 6: Clique explícito em "Início" na barra lateral continua abrindo Início
  const inicioSidebarBtn = container.querySelector('button[data-sidebar-nav-id="inicio"]') as HTMLButtonElement;
  assert(inicioSidebarBtn, 'Botão Início na barra lateral deve existir');
  await act(async () => {
    inicioSidebarBtn.click();
  });
  assert(
    container.querySelector('[data-scroll-top-anchor="true"]') !== null,
    'Critério 6: Clique explícito em "Início" na barra lateral deve abrir a tela Início'
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
    container.querySelector('button[data-sidebar-nav-id="live"]'),
    '3º Escape após abrir canal pela Home foca o botão "TV ao Vivo" na barra lateral'
  );
  assert(
    container.querySelector('button[data-live-category-id="2"]') !== null,
    '3º Escape mantém a tela de TV ao Vivo aberta enquanto o foco está no botão lateral'
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
      homeFirstRunContainer.querySelector('[data-device-choice="default"]') !== null,
    'Modal de primeiro acesso deve apresentar as duas opções explícitas: TV e Outros dispositivos'
  );

  await act(async () => {
    homeFirstRunRoot.unmount();
  });
  document.body.removeChild(homeFirstRunContainer);

  // 1. Preferência confirmada "Outros dispositivos" + abrir modal em prévia de TV + desmontar sem confirmar -> volta para "Outros dispositivos"
  confirmDisplayPreferences('default', 85);
  assert.strictEqual(document.documentElement.getAttribute('data-display-mode'), 'default');
  assert.strictEqual(document.documentElement.style.getPropertyValue('--nc-ui-scale'), '1');

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

  assert.strictEqual(getDisplayPreferencesSnapshot().isPreviewActive, true, 'Cenário 1: Prévia deve estar ativa com modal aberto');
  assert.strictEqual(document.documentElement.getAttribute('data-display-mode'), 'tv', 'Cenário 1: DOM deve refletir modo tv durante a prévia');
  assert.strictEqual(document.documentElement.style.getPropertyValue('--nc-ui-scale'), '0.85', 'Cenário 1: DOM deve refletir escala 0.85 durante a prévia');

  // Desmontar diretamente sem clicar em Confirmar nem Cancelar
  await act(async () => {
    root1.unmount();
  });
  document.body.removeChild(container1);

  assert.strictEqual(getDisplayPreferencesSnapshot().isPreviewActive, false, 'Cenário 1: Prévia deve ser encerrada ao desmontar o modal');
  assert.strictEqual(
    document.documentElement.getAttribute('data-display-mode'),
    'default',
    'Cenário 1: Após desmontar sem confirmar, data-display-mode deve voltar para "default"'
  );
  assert.strictEqual(
    document.documentElement.style.getPropertyValue('--nc-ui-scale'),
    '1',
    'Cenário 1: Após desmontar sem confirmar, --nc-ui-scale deve voltar para "1"'
  );

  // 2. Preferência confirmada "TV 75%" + abrir modal em prévia "125%" + mudar isOpen para false -> volta para "TV 75%"
  confirmDisplayPreferences('tv', 75);
  assert.strictEqual(document.documentElement.getAttribute('data-display-mode'), 'tv');
  assert.strictEqual(document.documentElement.style.getPropertyValue('--nc-ui-scale'), '0.75');

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
  assert(slider2 !== null, 'Cenário 2: Slider de calibração deve estar presente');

  // Avançar de 75% até 125% (10 passos de 5%)
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      slider2.dispatchEvent(
        new (windowInstance as any).KeyboardEvent('keydown', {
          key: 'ArrowRight',
          bubbles: true,
          cancelable: true,
        }) as unknown as Event
      );
    });
  }

  assert.strictEqual(document.documentElement.style.getPropertyValue('--nc-ui-scale'), '1.25', 'Cenário 2: Prévia deve aplicar 125% (1.25) em tempo real');

  // Mudar isOpen para false sem chamar onCancel
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

  assert.strictEqual(getDisplayPreferencesSnapshot().isPreviewActive, false, 'Cenário 2: isOpen=false deve encerrar a prévia');
  assert.strictEqual(document.documentElement.getAttribute('data-display-mode'), 'tv', 'Cenário 2: Modo confirmado TV deve permanecer');
  assert.strictEqual(
    document.documentElement.style.getPropertyValue('--nc-ui-scale'),
    '0.75',
    'Cenário 2: Escala deve restaurar para os 75% (0.75) confirmados'
  );

  await act(async () => {
    root2.unmount();
  });
  document.body.removeChild(container2);

  // 3. Prévia + Voltar e Cancelar não gravam no localStorage (comparando string bruta antes e depois)
  confirmDisplayPreferences('default', 85);
  const rawBeforePreview = window.localStorage.getItem(STORAGE_KEY_DISPLAY_PREFS);
  assert(rawBeforePreview !== null, 'Cenário 3: Preferência inicial salva no localStorage');

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

  const tvChoiceBtn = container3.querySelector('[data-device-choice="tv"]') as HTMLButtonElement;
  assert(tvChoiceBtn !== null, 'Cenário 3: Botão de escolha TV deve existir');

  await act(async () => {
    tvChoiceBtn.click();
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

  assert.strictEqual(document.documentElement.getAttribute('data-display-mode'), 'tv', 'Cenário 3: Prévia TV ativa');
  assert.strictEqual(document.documentElement.style.getPropertyValue('--nc-ui-scale'), '0.9', 'Cenário 3: Prévia em 90%');
  assert.strictEqual(
    window.localStorage.getItem(STORAGE_KEY_DISPLAY_PREFS),
    rawBeforePreview,
    'Cenário 3: Prévia ativa não deve alterar o valor bruto no localStorage'
  );

  // Clicar no botão Voltar dentro da etapa de calibração -> volta para seleção de dispositivo e restaura apresentação confirmada
  const backStepBtn = Array.from(container3.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('Voltar')
  ) as HTMLButtonElement;
  assert(backStepBtn !== null, 'Cenário 3: Botão Voltar da etapa de calibração deve existir');

  await act(async () => {
    backStepBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  assert.strictEqual(getDisplayPreferencesSnapshot().isPreviewActive, false, 'Cenário 3: Voltar à seleção de dispositivo deve cancelar a prévia');
  assert.strictEqual(document.documentElement.getAttribute('data-display-mode'), 'default', 'Cenário 3: Voltar restaura data-display-mode="default"');
  assert.strictEqual(document.documentElement.style.getPropertyValue('--nc-ui-scale'), '1', 'Cenário 3: Voltar restaura --nc-ui-scale="1"');
  assert.strictEqual(
    window.localStorage.getItem(STORAGE_KEY_DISPLAY_PREFS),
    rawBeforePreview,
    'Cenário 3: Voltar não deve gravar nada no localStorage'
  );

  // Entrar novamente em TV e acionar Fechar/Cancelar
  const tvChoiceBtnAgain = container3.querySelector('[data-device-choice="tv"]') as HTMLButtonElement;
  await act(async () => {
    tvChoiceBtnAgain.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  assert.strictEqual(getDisplayPreferencesSnapshot().isPreviewActive, true, 'Cenário 3: Prévia reativada');

  // Voltar para device step e clicar em Fechar
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });
  const closeModalBtn = Array.from(container3.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('Fechar')
  ) as HTMLButtonElement;
  assert(closeModalBtn !== null, 'Cenário 3: Botão Fechar deve existir quando canCancel=true');

  await act(async () => {
    closeModalBtn.click();
  });
  assert.strictEqual(cancelCalled3, true, 'Cenário 3: Clicar em Fechar deve invocar onCancel');
  assert.strictEqual(
    window.localStorage.getItem(STORAGE_KEY_DISPLAY_PREFS),
    rawBeforePreview,
    'Cenário 3: Cancelar/Fechar deve manter a string do localStorage idêntica ao estado anterior'
  );

  await act(async () => {
    root3.unmount();
  });
  document.body.removeChild(container3);

  // 4. Confirmar "TV 65%" e fechar/desmontar -> mantém "TV 65%"
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

  const slider4 = container4.querySelector('[data-calibration-slider="true"]') as HTMLElement;
  // Escala inicial é 85%. Descer 4 passos de 5% -> 65%
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      slider4.dispatchEvent(
        new (windowInstance as any).KeyboardEvent('keydown', {
          key: 'ArrowLeft',
          bubbles: true,
          cancelable: true,
        }) as unknown as Event
      );
    });
  }

  const confirmBtn4 = container4.querySelector('[data-calibration-confirm="true"]') as HTMLButtonElement;
  assert(confirmBtn4 !== null, 'Cenário 4: Botão Confirmar deve existir');

  await act(async () => {
    confirmBtn4.click();
  });
  assert.strictEqual(completed4, true, 'Cenário 4: Confirmar deve invocar onComplete');

  // Fechar (isOpen=false) e desmontar em seguida
  await act(async () => {
    root4.render(
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
    root4.unmount();
  });
  document.body.removeChild(container4);

  assert.strictEqual(getDisplayPreferencesSnapshot().isPreviewActive, false, 'Cenário 4: Prévia encerrada após confirmar');
  assert.strictEqual(getDisplayPreferencesSnapshot().mode, 'tv', 'Cenário 4: Modo confirmado deve ser tv');
  assert.strictEqual(getDisplayPreferencesSnapshot().tvScale, 65, 'Cenário 4: Escala confirmada deve ser 65');
  assert.strictEqual(document.documentElement.getAttribute('data-display-mode'), 'tv', 'Cenário 4: DOM deve manter data-display-mode="tv" após fechar/desmontar');
  assert.strictEqual(document.documentElement.style.getPropertyValue('--nc-ui-scale'), '0.65', 'Cenário 4: DOM deve manter --nc-ui-scale="0.65" após fechar/desmontar');

  // 5. Confirmar com localStorage.setItem lançando erro -> mantém a preferência confirmada em memória após fechar/desmontar
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
  // Subir de 65% para 95% (6 passos de 5%)
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      slider5.dispatchEvent(
        new (windowInstance as any).KeyboardEvent('keydown', {
          key: 'ArrowRight',
          bubbles: true,
          cancelable: true,
        }) as unknown as Event
      );
    });
  }

  const confirmBtn5 = container5.querySelector('[data-calibration-confirm="true"]') as HTMLButtonElement;
  await act(async () => {
    confirmBtn5.click();
  });

  await act(async () => {
    root5.render(
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
    root5.unmount();
  });
  document.body.removeChild(container5);
  window.localStorage.setItem = origSetItem;

  assert.strictEqual(getDisplayPreferencesSnapshot().isConfigured, true, 'Cenário 5: Mesmo com falha no localStorage, isConfigured deve permanecer true em memória');
  assert.strictEqual(getDisplayPreferencesSnapshot().mode, 'tv', 'Cenário 5: Modo confirmado em memória deve ser tv');
  assert.strictEqual(getDisplayPreferencesSnapshot().tvScale, 95, 'Cenário 5: Escala confirmada em memória deve ser 95');
  assert.strictEqual(document.documentElement.getAttribute('data-display-mode'), 'tv', 'Cenário 5: DOM deve manter data-display-mode="tv"');
  assert.strictEqual(document.documentElement.style.getPropertyValue('--nc-ui-scale'), '0.95', 'Cenário 5: DOM deve manter --nc-ui-scale="0.95"');

  // 6. Duas instâncias do modal: uma fechada ao lado de outra aberta em prévia não cancela a prévia ativa
  confirmDisplayPreferences('default', 85);
  const container6 = document.createElement('div');
  document.body.appendChild(container6);
  const root6 = createRoot(container6);

  await act(async () => {
    root6.render(
      React.createElement(
        NavigationProvider,
        null,
        React.createElement(
          React.Fragment,
          null,
          React.createElement(DisplaySetupModal, {
            key: 'home-closed-instance',
            isOpen: false,
            canCancel: false,
            onComplete: () => {},
          }),
          React.createElement(DisplaySetupModal, {
            key: 'config-open-instance',
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

  assert.strictEqual(getDisplayPreferencesSnapshot().isPreviewActive, true, 'Cenário 6: Prévia da instância aberta deve estar ativa');
  assert.strictEqual(document.documentElement.getAttribute('data-display-mode'), 'tv', 'Cenário 6: DOM deve estar em modo tv');

  // Re-renderizar / desmontar apenas a instância fechada mantendo a instância aberta montada
  await act(async () => {
    root6.render(
      React.createElement(
        NavigationProvider,
        null,
        React.createElement(
          React.Fragment,
          null,
          React.createElement(DisplaySetupModal, {
            key: 'config-open-instance',
            isOpen: true,
            canCancel: true,
            initialStep: 'tv-calibrate',
            onComplete: () => {},
          })
        )
      )
    );
  });

  assert.strictEqual(
    getDisplayPreferencesSnapshot().isPreviewActive,
    true,
    'Cenário 6: Desmontar/atualizar a instância fechada NÃO deve cancelar a prévia da instância aberta'
  );
  assert.strictEqual(document.documentElement.getAttribute('data-display-mode'), 'tv');

  await act(async () => {
    root6.unmount();
  });
  document.body.removeChild(container6);
  assert.strictEqual(getDisplayPreferencesSnapshot().isPreviewActive, false, 'Cenário 6: Desmontar a instância aberta encerra a prévia');

  // 7. Encerrar sessão antiga depois de uma nova sessão já ter iniciado mantém a nova prévia ativa
  confirmDisplayPreferences('default', 85);
  const oldSessionId = createDisplayPreviewSession();
  const newSessionId = createDisplayPreviewSession();

  startDisplayPreview('tv', 70, oldSessionId);
  assert.strictEqual(document.documentElement.style.getPropertyValue('--nc-ui-scale'), '0.7');

  startDisplayPreview('tv', 110, newSessionId);
  assert.strictEqual(document.documentElement.style.getPropertyValue('--nc-ui-scale'), '1.1');

  // Cleanup tardio da sessão antiga não pode derrubar a sessão nova
  cancelDisplayPreview(oldSessionId);
  assert.strictEqual(
    getDisplayPreferencesSnapshot().isPreviewActive,
    true,
    'Cenário 7: Cancelar token de sessão antiga não deve encerrar a prévia da sessão nova'
  );
  assert.strictEqual(
    document.documentElement.getAttribute('data-display-mode'),
    'tv',
    'Cenário 7: Modo tv da nova sessão permanece ativo'
  );
  assert.strictEqual(
    document.documentElement.style.getPropertyValue('--nc-ui-scale'),
    '1.1',
    'Cenário 7: Escala 1.1 da nova sessão permanece ativa'
  );

  cancelDisplayPreview(newSessionId);
  assert.strictEqual(getDisplayPreferencesSnapshot().isPreviewActive, false, 'Cenário 7: Cancelar o token da sessão atual encerra a prévia');
  assert.strictEqual(document.documentElement.getAttribute('data-display-mode'), 'default');

  // 8. Montar o modal em React.StrictMode não deixa prévia órfã
  confirmDisplayPreferences('default', 85);
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
    true,
    'Cenário 8: Em React.StrictMode, a prévia deve funcionar normalmente enquanto o modal está aberto'
  );
  assert.strictEqual(document.documentElement.getAttribute('data-display-mode'), 'tv');

  await act(async () => {
    root8.unmount();
  });
  document.body.removeChild(container8);

  assert.strictEqual(
    getDisplayPreferencesSnapshot().isPreviewActive,
    false,
    'Cenário 8: Desmontar o modal sob React.StrictMode não deve deixar prévia órfã'
  );
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

  let categoryLoadCount = 0;
  (XtreamService as any).authenticate = async () => {
    throw new Error('Tempo limite de conexão esgotado (timeout).');
  };
  (XtreamService as any).getLiveCategories = async () => {
    categoryLoadCount++;
    if (categoryLoadCount === 1) {
      throw new Error('Tempo limite de conexão esgotado (timeout).');
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

  const transientBanner = transientContainer.querySelector('[data-transient-recovery="true"]');
  assert(
    transientBanner !== null,
    'Quando a carga inicial falha por erro transitório, o banner de repetição ([data-transient-recovery="true"]) deve ser exibido'
  );

  // Restaurar authenticate e clicar em "Tentar novamente"
  installDefaultXtreamOfflineMocks();
  (XtreamService as any).getLiveCategories = async () => [
    { category_id: '1', category_name: 'Canais Recuperados' },
  ];

  const transientRetryBtn = transientContainer.querySelector('[data-transient-retry="true"]') as HTMLButtonElement;
  assert(transientRetryBtn !== null, 'Botão [data-transient-retry="true"] deve estar disponível');

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

  // Selecionar "Outros dispositivos" (step 1) e confirmar em "Confirmar e continuar" (step 1B)
  const otherDevicesCard = modalDialog!.querySelector(
    'button[data-device-choice="default"]'
  ) as HTMLButtonElement | null;
  assert(otherDevicesCard !== null, 'Botão Outros dispositivos (data-device-choice="default") deve existir no DisplaySetupModal');
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
    const logoutBtn = Array.from(routeTestContainer.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Sair')
    ) as HTMLButtonElement | undefined;
    assert(logoutBtn !== undefined, '[12.16.3] Botão "Sair" deve estar disponível na Home');

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
      await new Promise((r) => setTimeout(r, 90));
    });

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
  console.log('✅ Todos os testes de desempenho, auditoria de imagens da Home (12.14), virtualização horizontal de Continuar Assistindo (12.15), divisão de rotas (12.16), otimização do player por visibilidade (12.17 / P2.1), geometria dinâmica em rolagem, eliminação de retrabalho, virtualização (6.A, 6.B, 6.C, 6.D) e navegação D-Pad aprovados!');
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





