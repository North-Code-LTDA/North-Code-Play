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
  assert.strictEqual(video2, video, 'Mesmo elemento <video> deve ser reutilizado sem desmontar o player');

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
  assert.strictEqual(videoElAfterSecondOk, videoEl, '2º OK no mesmo canal NÃO deve desmontar o elemento <video>');
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
    setNavMode,
    executeBackAction,
    clearAllBackHandlersForTest,
    attachCapacitorBackAdapter,
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

  const testCreds: XtreamCredentials = {
    serverUrl: 'http://server.tv:8080',
    username: 'navUser',
    password: 'navPassword',
    allowed_output_formats: ['m3u8', 'ts'],
  };

  window.localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(testCreds));
  const historyStorageKey = 'northcode_playback_history_http://server.tv:8080_navUser';
  window.localStorage.removeItem(historyStorageKey);

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
  assert.strictEqual(document.activeElement, heroFirstBtn, 'Foco inicial posicionado no HeroBanner');

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
  assert.strictEqual(document.activeElement, lastRowItems[0], 'Primeiro card da última fileira deve estar focado');

  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    );
  });
  assert.strictEqual(
    document.activeElement,
    lastRowItems[1],
    'ArrowRight dentro de HorizontalRow deve focar o próximo card da mesma fileira'
  );

  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
    );
  });
  assert.strictEqual(
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
  // CRITÉRIOS C, E, G & REQ 3/4: Filmes (MoviesView), MovieDetails (sinopse longa + topo), VideoPlayer Escape único e retorno ao botão Filmes na sidebar
  // =========================================================================
  const filmesNavBtn = container.querySelector('button[data-sidebar-nav-id="movies"]') as HTMLButtonElement;
  assert(filmesNavBtn, 'Botão Filmes na barra lateral (data-sidebar-nav-id="movies") deve existir');

  await act(async () => {
    filmesNavBtn.focus();
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
  });

  assert(
    container.textContent?.includes('Categorias de Filmes'),
    'Enter no item Filmes da sidebar deve abrir a seção de Filmes'
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
    await new Promise((resolve) => setTimeout(resolve, 40));
  });

  const activeModalScope = document.querySelector('[data-focus-scope="modal"]') as HTMLElement;
  assert(activeModalScope, 'MovieDetails aberto deve expor data-focus-scope="modal"');

  // CRITÉRIO E & REQ 4: Em MovieDetails, verificar foco inicial no botão Assistir, descer para a sinopse longa, rolar com ArrowDown/ArrowUp e subir de volta ao topo (scrollTop = 0)
  const movieDetailsScroll = activeModalScope.querySelector('[data-scroll-container="true"]') as HTMLElement;
  assert(movieDetailsScroll, 'MovieDetails deve possuir container rolável com data-scroll-container="true"');

  const moviePlayBtn = activeModalScope.querySelector('button[data-autofocus="true"]') as HTMLButtonElement;
  const movieSynopsisEl = activeModalScope.querySelector('[role="region"][aria-label="Sinopse do filme"]') as HTMLElement;
  assert(moviePlayBtn, 'Botão Assistir com data-autofocus="true" deve existir em MovieDetails');
  assert(movieSynopsisEl, 'Região focável da sinopse (aria-label="Sinopse do filme") deve existir em MovieDetails');

  await act(async () => {
    moviePlayBtn.focus();
  });
  assert.strictEqual(document.activeElement, moviePlayBtn, 'Foco posicionado no botão Assistir de MovieDetails');

  // ArrowDown a partir da linha de ações (Assistir) deve focar a região da sinopse
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    );
  });
  assert.strictEqual(
    document.activeElement,
    movieSynopsisEl,
    'ArrowDown a partir de Assistir em MovieDetails deve focar a sinopse para leitura'
  );

  // REQ 4 (MovieDetails): Simular sinopse longa (scrollHeight > clientHeight) e verificar rolagem progressiva por ArrowDown e ArrowUp
  Object.defineProperty(movieSynopsisEl, 'scrollHeight', { value: 420, configurable: true });
  Object.defineProperty(movieSynopsisEl, 'clientHeight', { value: 150, configurable: true });
  movieSynopsisEl.scrollTop = 0;

  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    );
  });
  assert.strictEqual(document.activeElement, movieSynopsisEl, 'ArrowDown com texto restante na sinopse do filme deve manter foco na sinopse');
  assert.strictEqual(movieSynopsisEl.scrollTop, 120, '1º ArrowDown na sinopse longa do filme deve avançar scrollTop em 120px');

  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
    );
  });
  assert.strictEqual(document.activeElement, movieSynopsisEl, 'ArrowUp com scrollTop > 0 na sinopse do filme deve manter foco na sinopse');
  assert.strictEqual(movieSynopsisEl.scrollTop, 0, 'ArrowUp na sinopse do filme deve voltar scrollTop para 0');

  // Simular rolagem da página para baixo durante leitura da sinopse
  movieDetailsScroll.scrollTop = 260;

  // Agora que movieSynopsisEl.scrollTop === 0, o próximo ArrowUp deve retornar à linha do botão Assistir e zerar movieDetailsScroll.scrollTop = 0
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
    );
  });
  assert.strictEqual(
    document.activeElement,
    moviePlayBtn,
    'ArrowUp a partir do topo da sinopse deve retornar ao botão Assistir (e não saltar direto para Voltar)'
  );
  assert.strictEqual(
    movieDetailsScroll.scrollTop,
    0,
    'Retornar ao botão Assistir com ArrowUp em MovieDetails deve zerar scrollTop = 0 para revelar o título e o topo completo'
  );

  // CRITÉRIO G: Abrir VideoPlayer a partir de MovieDetails e confirmar que 1 Escape fecha SOMENTE o VideoPlayer (sem fechar MovieDetails junto)
  await act(async () => {
    moviePlayBtn.focus();
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  assert(
    document.querySelector('[data-player-container="true"][data-focus-scope="modal"]') !== null,
    'Pressionar Enter em Assistir deve abrir o VideoPlayer modal ([data-player-container="true"][data-focus-scope="modal"])'
  );

  // Pressionar Escape 1 vez: deve fechar o VideoPlayer e manter MovieDetails aberto, restaurando foco ao botão Assistir
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });

  assert.strictEqual(
    document.querySelector('[data-player-container="true"][data-focus-scope="modal"]'),
    null,
    '1º Escape com VideoPlayer aberto deve fechar o VideoPlayer'
  );
  assert(
    document.querySelector('[data-focus-scope="modal"]') !== null,
    '1º Escape ao sair do VideoPlayer NÃO deve fechar MovieDetails em duplicidade (Critério G)'
  );
  assert.strictEqual(
    document.activeElement,
    moviePlayBtn,
    'Ao fechar o VideoPlayer com Escape, o foco deve retornar imediatamente ao botão Assistir em MovieDetails'
  );

  // CRITÉRIO C (Parte 1 - Filmes): Escape fecha MovieDetails, restaura foco ao card e preserva scrollTop da grade
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });

  assert.strictEqual(
    document.querySelector('[data-focus-scope="modal"]'),
    null,
    'Escape em MovieDetails deve fechar a tela de detalhes'
  );
  assert.strictEqual(
    document.activeElement,
    movieCard,
    'Ao fechar MovieDetails com Voltar, o foco deve ser restaurado para o card que o abriu'
  );
  assert.strictEqual(
    moviesMain.scrollTop,
    340,
    'Fechar MovieDetails deve preservar a posição de rolagem (scrollTop) da grade de Filmes'
  );

  // CRITÉRIO C (Parte 2 - Filmes): Com foco num card da grade, 1º Escape foca a categoria selecionada sem sair da seção nem resetar scrollTop
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });

  assert(
    container.textContent?.includes('Categorias de Filmes'),
    'Voltar a partir da grade de Filmes deve permanecer na seção Filmes'
  );
  assert.strictEqual(
    document.activeElement,
    acaoBtn,
    'Voltar a partir da grade de Filmes deve mover o foco para o botão da categoria atualmente selecionada (Ação)'
  );
  assert.strictEqual(
    moviesMain.scrollTop,
    340,
    'Voltar da grade para a categoria não deve resetar o scrollTop da grade de Filmes'
  );

  // CRITÉRIO C (Parte 3 - Filmes) & REQ 3: Com foco já nas categorias, próximo Escape volta para Início e foca o botão Filmes na sidebar
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  assert(
    !container.textContent?.includes('Categorias de Filmes'),
    'Voltar quando o foco já está nas categorias de Filmes deve retornar à tela inicial (Início)'
  );
  const filmesSidebarAfterReturn = container.querySelector('button[data-sidebar-nav-id="movies"]') as HTMLButtonElement;
  assert.strictEqual(
    document.activeElement,
    filmesSidebarAfterReturn,
    'REQ 3: Ao voltar de Filmes para Início com Escape/Voltar, o foco deve ir para o botão Filmes na barra lateral'
  );

  // =========================================================================
  // CRITÉRIOS C, F & REQ 3/4: Séries (SeriesView) e SeriesDetails (sinopse longa com rolagem progressiva + retorno à sidebar)
  // =========================================================================
  const seriesNavBtn = container.querySelector('button[data-sidebar-nav-id="series"]') as HTMLButtonElement;
  assert(seriesNavBtn, 'Botão Séries na barra lateral (data-sidebar-nav-id="series") deve existir');

  await act(async () => {
    seriesNavBtn.focus();
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
  });

  assert(
    container.textContent?.includes('Categorias de Séries'),
    'Enter no item Séries da sidebar deve abrir a seção de Séries'
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
    await new Promise((resolve) => setTimeout(resolve, 40));
  });

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
    'A sinopse em SeriesDetails NÃO deve ter truncamento permanente line-clamp-3 (Critério F)'
  );

  // REQ 4 (SeriesDetails): Simular sinopse longa (scrollHeight = 500, clientHeight = 150, maxScroll = 350)
  Object.defineProperty(seriesSynopsisEl, 'scrollHeight', { value: 500, configurable: true });
  Object.defineProperty(seriesSynopsisEl, 'clientHeight', { value: 150, configurable: true });
  seriesSynopsisEl.scrollTop = 0;

  await act(async () => {
    seriesSynopsisEl.focus();
  });
  assert.strictEqual(document.activeElement, seriesSynopsisEl, 'Foco posicionado na sinopse da série');

  // 1º ArrowDown: rola 0 -> 120 e mantém foco na sinopse
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    );
  });
  assert.strictEqual(document.activeElement, seriesSynopsisEl, '1º ArrowDown na sinopse longa da série deve manter foco na sinopse');
  assert.strictEqual(seriesSynopsisEl.scrollTop, 120, '1º ArrowDown deve avançar scrollTop para 120');

  // 2º ArrowDown: rola 120 -> 240 e mantém foco na sinopse
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    );
  });
  assert.strictEqual(document.activeElement, seriesSynopsisEl, '2º ArrowDown na sinopse longa da série deve manter foco na sinopse');
  assert.strictEqual(seriesSynopsisEl.scrollTop, 240, '2º ArrowDown deve avançar scrollTop para 240');

  // 3º ArrowDown: rola 240 -> 350 (limite final) e mantém foco na sinopse
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    );
  });
  assert.strictEqual(document.activeElement, seriesSynopsisEl, '3º ArrowDown ao atingir o limite da sinopse ainda mantém foco na sinopse');
  assert.strictEqual(seriesSynopsisEl.scrollTop, 350, '3º ArrowDown deve atingir o limite máximo scrollTop = 350');

  // Simular que o container externo também rolou parcialmente
  seriesDetailsScroll.scrollTop = 140;

  // 4º ArrowDown (já no limite 350): passa o foco para o botão Adicionar aos Favoritos SEM resetar scrollTop para 0
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    );
  });
  assert.strictEqual(
    document.activeElement,
    seriesFavBtn,
    'Após chegar ao fim da sinopse da série, o próximo ArrowDown deve mover o foco para o botão Favoritar'
  );
  assert.strictEqual(
    seriesDetailsScroll.scrollTop,
    140,
    'Mover o foco da sinopse para Favoritar NÃO deve resetar seriesDetailsScroll.scrollTop para 0 prematuramente'
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
  assert.strictEqual(document.activeElement, seriesSynopsisEl, '1º ArrowUp a partir do fim da sinopse deve manter foco na sinopse');
  assert.strictEqual(seriesSynopsisEl.scrollTop, 230, '1º ArrowUp deve reduzir scrollTop de 350 para 230');

  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
    );
  });
  assert.strictEqual(document.activeElement, seriesSynopsisEl, '2º ArrowUp na sinopse deve manter foco na sinopse');
  assert.strictEqual(seriesSynopsisEl.scrollTop, 110, '2º ArrowUp deve reduzir scrollTop de 230 para 110');

  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
    );
  });
  assert.strictEqual(document.activeElement, seriesSynopsisEl, '3º ArrowUp ao atingir o topo 0 ainda mantém foco na sinopse');
  assert.strictEqual(seriesSynopsisEl.scrollTop, 0, '3º ArrowUp deve atingir scrollTop = 0');

  // 4º ArrowUp (já em scrollTop === 0): entrega o foco para o botão Voltar no cabeçalho
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
    );
  });
  assert.strictEqual(
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

  assert.strictEqual(
    document.activeElement,
    seriesSynopsisEl,
    'Subir com ArrowUp em SeriesDetails a partir dos episódios deve focar a sinopse no topo'
  );
  assert.strictEqual(
    seriesDetailsScroll.scrollTop,
    0,
    'Atingir a sinopse em SeriesDetails com ArrowUp deve zerar scrollTop = 0 para revelar título e início da sinopse'
  );

  // Fechar SeriesDetails com Escape -> foco volta ao card de série -> Escape volta para categoria Drama -> Escape volta ao Início e foca botão Séries na sidebar
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });
  assert.strictEqual(document.activeElement, seriesCard, 'Fechar SeriesDetails deve restaurar foco ao card da série');
  assert.strictEqual(seriesMain.scrollTop, 290, 'Fechar SeriesDetails deve preservar scrollTop da grade');

  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });
  assert.strictEqual(
    document.activeElement,
    dramaBtn,
    'Voltar a partir da grade de Séries deve focar a categoria selecionada (Drama)'
  );

  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  assert(
    !container.textContent?.includes('Categorias de Séries'),
    'Voltar a partir das categorias de Séries deve retornar ao Início'
  );
  const seriesSidebarAfterReturn = container.querySelector('button[data-sidebar-nav-id="series"]') as HTMLButtonElement;
  assert.strictEqual(
    document.activeElement,
    seriesSidebarAfterReturn,
    'REQ 3: Ao voltar de Séries para Início com Escape/Voltar, o foco deve ir para o botão Séries na barra lateral'
  );

  // =========================================================================
  // CRITÉRIO D & REQ 1/3: TV ao Vivo (LiveTvView) — troca de categoria A -> B sem perder foco, atraso de rede e sequência Voltar
  // =========================================================================
  const liveNavBtn = container.querySelector('button[data-sidebar-nav-id="live"]') as HTMLButtonElement;
  assert(liveNavBtn, 'Botão TV ao Vivo na barra lateral (data-sidebar-nav-id="live") deve existir');

  await act(async () => {
    liveNavBtn.focus();
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
  });

  const liveCatList = container.querySelector('[data-nav-zone="categories"][data-scroll-container="true"]') as HTMLElement;
  assert(liveCatList, 'Lista de categorias da TV ao Vivo deve existir');
  liveCatList.scrollTop = 180;

  const abertosCatBtn = container.querySelector('button[data-live-category-id="1"]') as HTMLButtonElement;
  assert(abertosCatBtn, 'Botão da categoria Abertos (id=1) deve existir na TV ao Vivo');

  // Ativar categoria A (Abertos, id=1) com Enter (em modo remote)
  await act(async () => {
    abertosCatBtn.focus();
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  // Deve ter trocado para a lista de canais da categoria 1 e focado automaticamente o primeiro canal de A
  const channelButtonsCatA = Array.from(container.querySelectorAll('button[data-live-channel-btn="true"]')) as HTMLButtonElement[];
  assert(channelButtonsCatA.length >= 2, 'Lista de canais da categoria Abertos deve conter os canais agrupados');
  assert.strictEqual(
    channelButtonsCatA[0].getAttribute('data-live-channel-category-id'),
    '1',
    'Primeiro canal exibido em Abertos deve pertencer à categoria 1'
  );
  assert.strictEqual(
    document.activeElement,
    channelButtonsCatA[0],
    'Ao escolher a categoria A (Abertos) por teclado/controle, o foco deve ir automaticamente para o primeiro canal de A'
  );

  // REQ 1: Voltar às categorias e abrir a categoria B (Esportes, id=2) simulando atraso no fetchLiveStreams
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });
  const esportesCatBtn = container.querySelector('button[data-live-category-id="2"]') as HTMLButtonElement;
  assert(esportesCatBtn, 'Botão da categoria Esportes (id=2) deve existir na TV ao Vivo');

  // Configurar fetchLiveStreams da categoria 2 com pequeno atraso para validar que nenhum canal antigo da categoria 1 é focado ou renderizado
  const originalGetLiveStreams = (XtreamService as any).getLiveStreams;
  (XtreamService as any).getLiveStreams = async (creds: any, catId?: string) => {
    if (String(catId) === '2') {
      await new Promise((r) => setTimeout(r, 40));
    }
    return originalGetLiveStreams(creds, catId);
  };

  await act(async () => {
    esportesCatBtn.focus();
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
  });

  // Imediatamente após abrir a categoria 2, NUNCA deve existir botão renderizado da categoria 1
  const renderedCat1ButtonsInCat2 = container.querySelectorAll('button[data-live-channel-category-id="1"]');
  assert.strictEqual(
    renderedCat1ButtonsInCat2.length,
    0,
    'REQ 1: Ao abrir a categoria B (Esportes), nenhum canal da categoria A (Abertos) pode continuar renderizado'
  );

  // Aguardar resolução de getLiveStreams(cat=2)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
  (XtreamService as any).getLiveStreams = originalGetLiveStreams;

  const channelButtonsCatB = Array.from(container.querySelectorAll('button[data-live-channel-btn="true"]')) as HTMLButtonElement[];
  assert(channelButtonsCatB.length >= 2, 'Categoria B (Esportes) deve exibir seus canais após carregamento');
  assert.strictEqual(
    channelButtonsCatB[0].getAttribute('data-live-channel-category-id'),
    '2',
    'Canais exibidos em Esportes devem pertencer à categoria 2'
  );
  assert.strictEqual(
    document.activeElement,
    channelButtonsCatB[0],
    'REQ 1: Ao abrir a categoria B após passar pela categoria A, o foco deve estar no primeiro canal de B (nunca em body ou sidebar)'
  );

  // Voltar para categorias e reabrir categoria A (Abertos) para testar fluxo de preview -> fullscreen -> categorias -> Início
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });
  const abertosCatBtnAgain = container.querySelector('button[data-live-category-id="1"]') as HTMLButtonElement;
  await act(async () => {
    abertosCatBtnAgain.focus();
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  const channelButtons = Array.from(container.querySelectorAll('button[data-live-channel-btn="true"]')) as HTMLButtonElement[];
  assert.strictEqual(document.activeElement, channelButtons[0], 'Foco no primeiro canal de Abertos');

  // ArrowDown deve mover para o segundo canal da lista
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    );
  });
  assert.strictEqual(
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
  assert.strictEqual(
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
  assert.strictEqual(
    container.querySelector('video'),
    null,
    '2º Escape na TV ao Vivo deve fechar o preview do canal'
  );
  const channelButtonsAfterPreviewClose = Array.from(container.querySelectorAll('button[data-live-channel-btn="true"]')) as HTMLButtonElement[];
  assert.strictEqual(
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
  assert.strictEqual(
    document.activeElement,
    abertosCatBtnRestored,
    '3º Escape deve restaurar o foco exatamente na categoria de origem (Abertos)'
  );
  const liveCatListRestored = container.querySelector('[data-nav-zone="categories"][data-scroll-container="true"]') as HTMLElement;
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
  assert.strictEqual(
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

  // 4º Escape (na lista de categorias da TV ao Vivo): volta para Início e foca o botão TV ao Vivo na sidebar (REQ 3)
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  assert(
    container.querySelector('[data-scroll-top-anchor="true"]') !== null,
    '4º Escape a partir das categorias da TV ao Vivo deve retornar à tela Início'
  );
  const liveSidebarAfterReturn = container.querySelector('button[data-sidebar-nav-id="live"]') as HTMLButtonElement;
  assert.strictEqual(
    document.activeElement,
    liveSidebarAfterReturn,
    'REQ 3: Ao voltar de TV ao Vivo para Início com Escape/Voltar, o foco deve ir para o botão TV ao Vivo na barra lateral'
  );

  // =========================================================================
  // REQ 2: Cards de "Canais Ao Vivo" na Home usam o fluxo funcional de LiveTvView (m3u8, SD -> HD, fallback e histórico só no sucesso)
  // =========================================================================
  window.localStorage.removeItem(historyStorageKey);

  // Na HomeView, encontrar a fileira "Canais Ao Vivo" e clicar no card "Canal Esporte HD" (stream_id 104, que pertence ao grupo Canal Esporte com SD=103 e HD=104)
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
    `REQ 2: Canal aberto pela Home deve usar .m3u8 (allowed_output_formats) e iniciar pela variante SD (103), mas obteve: ${liveVideoFromHome.src}`
  );
  assert(
    !liveVideoFromHome.src.endsWith('.ts'),
    'REQ 2: Canal aberto pela Home NÃO deve forçar URL .ts quando m3u8 é suportado'
  );

  // Antes da confirmação de reprodução (playing), o histórico NÃO deve ter registrado o canal
  const historyBeforeSuccess = JSON.parse(window.localStorage.getItem(historyStorageKey) || '[]');
  assert.strictEqual(
    historyBeforeSuccess.length,
    0,
    'REQ 2: O histórico de reprodução NÃO deve ser gravado apenas pelo clique na Home antes da reprodução funcionar'
  );

  // Simular sucesso de reprodução (evento 'playing' no <video>) e verificar que agora o histórico é gravado
  await act(async () => {
    liveVideoFromHome.dispatchEvent(new (windowInstance as any).Event('playing'));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  const historyAfterSuccess = JSON.parse(window.localStorage.getItem(historyStorageKey) || '[]');
  assert(
    historyAfterSuccess.some((item: any) => String(item.id) === '103' && item.type === 'live'),
    'REQ 2: O histórico deve registrar o canal somente após confirmação de sucesso (playing) na LiveTvView'
  );

  // Sequência de Voltar após abrir canal pela Home: preview -> canais -> categorias -> Início (com foco no botão TV ao Vivo da sidebar)
  await act(async () => {
    windowInstance.dispatchEvent(
      new (windowInstance as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });
  assert.strictEqual(container.querySelector('video'), null, '1º Escape após abrir canal pela Home fecha o preview');

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
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  assert(
    container.querySelector('[data-scroll-top-anchor="true"]') !== null,
    '3º Escape após abrir canal pela Home retorna ao Início'
  );
  assert.strictEqual(
    document.activeElement,
    container.querySelector('button[data-sidebar-nav-id="live"]'),
    '3º Escape retorna o foco para o botão TV ao Vivo na barra lateral'
  );

  // 4. Ponte de runtime do Capacitor (backButton) na raiz chama App.exitApp() e NUNCA faz logout
  let exitAppCalled = false;
  let backListenerCallback: ((ev: any) => void) | null = null;

  (windowInstance as any).Capacitor = {
    Plugins: {
      App: {
        addListener: (eventName: string, cb: (ev: any) => void) => {
          if (eventName === 'backButton') {
            backListenerCallback = cb;
          }
          return {
            remove: () => {
              backListenerCallback = null;
            },
          };
        },
        exitApp: () => {
          exitAppCalled = true;
        },
      },
    },
  };

  const detachCap = attachCapacitorBackAdapter();
  assert(backListenerCallback !== null, 'Adaptador Capacitor deve registrar listener para backButton');

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
  delete (windowInstance as any).Capacitor;

  // 5. Movimento de ponteiro alterna de volta para 'pointer' sem quebrar cliques
  await act(async () => {
    windowInstance.dispatchEvent(new (windowInstance as any).PointerEvent('pointerdown', { bubbles: true }));
  });
  assert.strictEqual(getNavMode(), 'pointer', 'Evento pointerdown deve alternar navMode para pointer');

  await act(async () => {
    root.unmount();
  });
  document.body.removeChild(container);

  console.log('✅ Testes de navegação por controle/teclado (Critérios A a H + Requisitos 1 a 5), foco, rolagem e política de Voltar aprovados!');
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
  console.log('\n🎉 TODOS OS TESTES FORAM EXECUTADOS COM SUCESSO!');
}

main().catch((err) => {
  console.error('\n❌ ERRO NA EXECUÇÃO DOS TESTES:', err);
  process.exit(1);
});


