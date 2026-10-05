import assert from 'assert';
import { Window, Storage } from 'happy-dom';

// -------------------------------------------------------------
// 1. SETUP DOM & STORAGE ENVIRONMENT BEFORE ANY MODULE IMPORTS
// -------------------------------------------------------------
const windowInstance = new Window({ url: 'http://localhost' });
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
(globalThis as any).HTMLMediaElement = windowInstance.HTMLMediaElement;
(globalThis as any).HTMLVideoElement = windowInstance.HTMLVideoElement;
(globalThis as any).MouseEvent = windowInstance.MouseEvent;
(globalThis as any).PointerEvent = windowInstance.PointerEvent;
(globalThis as any).StorageEvent = windowInstance.StorageEvent;

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
  set(el: Element | null) {
    currentFullscreenElement = el;
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

// -------------------------------------------------------------
// 2. NOW IMPORT REACT & PROJECT MODULES AFTER DOM INITIALIZATION
// -------------------------------------------------------------
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import {
  normalizeServerUrl,
  normalizeImageSource,
  buildDirectMediaUrl,
  buildDirectImageUrl,
} from '../src/utils/mediaUtils';
import {
  getFavoritesKey,
  getStoredFavorites,
  setStoredFavorites,
  readStoredFavorites,
  safeReadStorage,
  safeSaveCredentials,
  safeRemoveCredentials,
  FAVORITES_KEY_PREFIX,
  CREDENTIALS_KEY,
} from '../src/utils/accountUtils';
import { XtreamCredentials } from '../src/types';
import { useFavorites, FavoriteItem, getCachedFavoritesForAccount } from '../src/hooks/useFavorites';
import { VideoPlayer } from '../src/components/VideoPlayer';
import { FavoritesView } from '../src/views/FavoritesView';
import { MoviesView } from '../src/views/MoviesView';
import { SeriesView } from '../src/views/SeriesView';
import { LiveTvView } from '../src/views/LiveTvView';
import { XtreamProvider, XtreamContext } from '../src/context/XtreamContext';
import { XtreamService } from '../src/services/xtreamService';
import { Home } from '../src/pages/Home';

const origGetItem = windowInstance.localStorage.getItem;
const origSetItem = windowInstance.localStorage.setItem;
const origRemoveItem = windowInstance.localStorage.removeItem;

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
  assert.strictEqual(window.document.activeElement, visiblePlayButton, 'Botão reteve foco após clique');

  // Avançar 3.1s sem toque de teclado
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 3100));
  });

  assert(
    bottomBar.className.includes('opacity-0'),
    'Barras devem sumir após 3s mesmo se um botão reteve foco de clique'
  );

  // 8. Navegação acessível via teclado preserva visibilidade
  console.log('Caso 8: Navegação acessível via teclado mantém controles visíveis');
  await act(async () => {
    playerWrapper.dispatchEvent(new windowInstance.MouseEvent('mousemove', { bubbles: true }) as unknown as Event);
    windowInstance.dispatchEvent(new (windowInstance as any).KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    visiblePlayButton.focus();
  });

  // Aguardar 3.1s: com navegação por teclado ativa, os controles não devem desaparecer
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 3100));
  });

  assert(
    bottomBar.className.includes('opacity-100'),
    'Barras devem permanecer visíveis enquanto usuário navega via teclado'
  );

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
  assert.strictEqual(
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

  assert.strictEqual(
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
  assert.strictEqual(
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
  const categoryBtn = Array.from(container.querySelectorAll('.custom-scrollbar button')).find(
    (b) => b.textContent?.includes('Notícias')
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
    (b) => b.textContent?.includes('Ação')
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
    (b) => b.textContent?.includes('Comédia')
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

async function main() {
  console.log('🚀 INICIANDO VALIDAÇÃO COMPLETA DOS FAVORITOS SIMPLES E REGRESSÕES\n');
  runDirectUrlTests();
  await runSimpleFavoritesTests();
  await runPlayerVolumeRateAndSessionTests();
  await runPlayerControlsStabilityAndAutoHideTests();
  await runPlayerBackAndScrollNavigationTests();
  console.log('\n🎉 TODOS OS TESTES FORAM EXECUTADOS COM SUCESSO!');
}

main().catch((err) => {
  console.error('\n❌ ERRO NA EXECUÇÃO DOS TESTES:', err);
  process.exit(1);
});
