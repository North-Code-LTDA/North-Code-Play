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
  await cleanupTestEnvironment();
  console.log('\n🎉 TODOS OS TESTES FORAM EXECUTADOS COM SUCESSO!');
}

main().catch(async (err) => {
  console.error('\n❌ ERRO NA EXECUÇÃO DOS TESTES:', err);
  await cleanupTestEnvironment();
  process.exitCode = 1;
});



