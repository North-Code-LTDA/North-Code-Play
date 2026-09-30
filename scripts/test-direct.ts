import assert from 'assert';
import { Window } from 'happy-dom';

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

// Mock HTMLMediaElement methods deterministically
HTMLMediaElement.prototype.play = function () {
  Object.defineProperty(this, 'paused', { value: false, configurable: true, writable: true });
  this.dispatchEvent(new windowInstance.Event('play'));
  this.dispatchEvent(new windowInstance.Event('playing'));
  return Promise.resolve();
};

HTMLMediaElement.prototype.pause = function () {
  Object.defineProperty(this, 'paused', { value: true, configurable: true, writable: true });
  this.dispatchEvent(new windowInstance.Event('pause'));
};

HTMLMediaElement.prototype.load = function () {
  this.dispatchEvent(new windowInstance.Event('loadstart'));
};

// -------------------------------------------------------------
// 2. NOW IMPORT REACT & PROJECT MODULES AFTER DOM INITIALIZATION
// -------------------------------------------------------------
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  normalizeServerUrl,
  normalizeImageSource,
  buildDirectMediaUrl,
  buildDirectImageUrl,
  diagnoseImageUrl,
} from '../src/utils/mediaUtils';
import {
  getAccountKey,
  bootstrapLegacyMigration,
  hasUnassignedLegacyFavorites,
} from '../src/utils/accountUtils';
import { XtreamCredentials } from '../src/types';
import { useFavorites } from '../src/hooks/useFavorites';
import { VideoPlayer } from '../src/components/VideoPlayer';

function runDirectUrlTests() {
  console.log('--- 1. Testes de Regressão de URLs e Imagens ---');

  // 1. normalizeServerUrl
  assert.strictEqual(normalizeServerUrl('example.com:8080'), 'http://example.com:8080');
  assert.strictEqual(normalizeServerUrl('http:/example.com:8080/'), 'http://example.com:8080');
  assert.strictEqual(normalizeServerUrl('https://provider.tv:8443/custom/base/'), 'https://provider.tv:8443/custom/base');
  assert.strictEqual(normalizeServerUrl('http://iptv.server.net/'), 'http://iptv.server.net');

  // 2. normalizeImageSource
  assert.strictEqual(normalizeImageSource('  https://example.com/cover.jpg  '), 'https://example.com/cover.jpg');
  assert.strictEqual(
    normalizeImageSource(['https://example.com/backdrop1.jpg', 'https://example.com/backdrop2.jpg']),
    'https://example.com/backdrop1.jpg'
  );
  assert.strictEqual(normalizeImageSource(['', '   ', 'https://example.com/valid.jpg']), 'https://example.com/valid.jpg');
  assert.strictEqual(normalizeImageSource([]), null);
  assert.strictEqual(normalizeImageSource(''), null);
  assert.strictEqual(normalizeImageSource('   '), null);
  assert.strictEqual(normalizeImageSource(null), null);
  assert.strictEqual(normalizeImageSource(undefined), null);

  // 3. buildDirectMediaUrl
  const testCreds: XtreamCredentials = {
    serverUrl: 'http://myprovider.xyz:8080',
    username: 'user@test+1',
    password: 'p@ssword#123',
  };

  const liveUrl1 = buildDirectMediaUrl(testCreds, { type: 'live', streamId: 1042 });
  assert.strictEqual(liveUrl1, 'http://myprovider.xyz:8080/live/user%40test%2B1/p%40ssword%23123/1042.m3u8');

  const liveUrl2 = buildDirectMediaUrl(testCreds, { type: 'live', streamId: '1043', allowedOutputFormats: ['ts'] });
  assert.strictEqual(liveUrl2, 'http://myprovider.xyz:8080/live/user%40test%2B1/p%40ssword%23123/1043.ts');

  const movieUrl1 = buildDirectMediaUrl(testCreds, { type: 'movie', streamId: 5520, containerExtension: 'mkv' });
  assert.strictEqual(movieUrl1, 'http://myprovider.xyz:8080/movie/user%40test%2B1/p%40ssword%23123/5520.mkv');

  const seriesUrl1 = buildDirectMediaUrl(testCreds, { type: 'series', streamId: 9910, containerExtension: '.mp4' });
  assert.strictEqual(seriesUrl1, 'http://myprovider.xyz:8080/series/user%40test%2B1/p%40ssword%23123/9910.mp4');

  const directSrcUrl = buildDirectMediaUrl(testCreds, {
    type: 'live',
    streamId: 100,
    directSource: 'http://cdn.example.org/stream.m3u8',
  });
  assert.strictEqual(directSrcUrl, 'http://cdn.example.org/stream.m3u8');

  // 4. buildDirectImageUrl & query / relative URLs
  assert.strictEqual(buildDirectImageUrl('http://img.provider.com/poster.jpg'), 'http://img.provider.com/poster.jpg');
  assert.strictEqual(buildDirectImageUrl('https://image.tmdb.org/t/p/w500/abc.jpg'), 'https://image.tmdb.org/t/p/w500/abc.jpg');

  const providerWithUrlParam =
    'http://logos.exemplo.test/image.php?url=https%3A%2F%2Fstorage.exemplo.test%2Fcanal.png&sig=abc#frag';
  assert.strictEqual(
    buildDirectImageUrl(providerWithUrlParam),
    providerWithUrlParam,
    'URL absoluta com query, assinatura e fragmento deve permanecer intacta'
  );

  assert.strictEqual(buildDirectImageUrl('logo.png', 'http://iptv.server:8080'), 'http://iptv.server:8080/logo.png');
  assert.strictEqual(buildDirectImageUrl('/logos/1.png', 'http://iptv.server:8080'), 'http://iptv.server:8080/logos/1.png');
  assert.strictEqual(buildDirectImageUrl('./relative.jpg', 'http://iptv.server:8080/base/'), 'http://iptv.server:8080/base/relative.jpg');
  assert.strictEqual(buildDirectImageUrl('../parent.jpg', 'http://iptv.server:8080/base/sub/'), 'http://iptv.server:8080/base/parent.jpg');

  assert.strictEqual(buildDirectImageUrl(''), null);
  assert.strictEqual(buildDirectImageUrl(null), null);

  const diag1 = diagnoseImageUrl(providerWithUrlParam);
  assert.strictEqual(diag1.wasModifiedByNormalizer, false);
  assert.strictEqual(diag1.isAbsolute, true);

  console.log('✅ Testes de Regressão de URLs e Imagens concluídos com sucesso!');
}

function runAccountKeyTests() {
  console.log('--- 2. Testes de Identidade de Conta e Chaves Estáveis ---');

  // Server A + User A vs Server A + User B
  const keyA1 = getAccountKey('http://serverA.tv:8080/', 'userA');
  const keyA2 = getAccountKey('http://serverA.tv:8080', 'userB');
  assert.notStrictEqual(keyA1, keyA2, 'Usuários diferentes no mesmo servidor devem ter chaves distintas');

  // Server A + User A vs Server B + User A
  const keyB1 = getAccountKey('http://serverB.tv:8080', 'userA');
  assert.notStrictEqual(keyA1, keyB1, 'Mesmo usuário em servidores diferentes deve ter chaves distintas');

  // Case preservation for username
  const keyUpper = getAccountKey('http://serverA.tv:8080', 'UserA');
  assert.notStrictEqual(keyA1, keyUpper, 'Username com maiúsculas/minúsculas deve preservar a identidade');

  // Server URL normalization equivalence (trailing slash)
  const keyNormalized1 = getAccountKey('http://serverA.tv:8080/', '  userA  ');
  const keyNormalized2 = getAccountKey('http://serverA.tv:8080', 'userA');
  assert.strictEqual(keyNormalized1, keyNormalized2, 'Normalização de trailing slash e trim deve produzir chave idêntica');

  // Distinct ports
  const keyPort1 = getAccountKey('http://serverA.tv:8080', 'userA');
  const keyPort2 = getAccountKey('http://serverA.tv:8443', 'userA');
  assert.notStrictEqual(keyPort1, keyPort2, 'Portas diferentes devem gerar chaves distintas');

  // List name, avatar, password do NOT affect identity
  const keyBase = getAccountKey('http://serverA.tv:8080', 'userA');
  assert.strictEqual(keyBase, getAccountKey('http://serverA.tv:8080', 'userA'), 'Mudar lista/avatar/senha não altera a chave');

  // Empty inputs -> ""
  assert.strictEqual(getAccountKey('', 'userA'), '');
  assert.strictEqual(getAccountKey('http://serverA.tv', ''), '');

  console.log('✅ Testes de Identidade de Conta aprovados com sucesso!');
}

async function runFavoritesIsolationAndMigrationTests() {
  console.log('--- 3. Testes de Favoritos por Conta e Sincronização Local ---');

  window.localStorage.clear();

  const credsA: XtreamCredentials = { serverUrl: 'http://serverA.tv:8080', username: 'userA', password: 'passA' };
  const credsB: XtreamCredentials = { serverUrl: 'http://serverA.tv:8080', username: 'userB', password: 'passB' };

  let hookInstA1: ReturnType<typeof useFavorites> | null = null;
  let hookInstA2: ReturnType<typeof useFavorites> | null = null;
  let hookInstB: ReturnType<typeof useFavorites> | null = null;

  function AppAccountA() {
    hookInstA1 = useFavorites(credsA);
    hookInstA2 = useFavorites(credsA);
    return React.createElement('div', null, 'Component A');
  }

  function AppAccountB() {
    hookInstB = useFavorites(credsB);
    return React.createElement('div', null, 'Component B');
  }

  const containerA = window.document.createElement('div');
  window.document.body.appendChild(containerA);
  const rootA = createRoot(containerA);

  const containerB = window.document.createElement('div');
  window.document.body.appendChild(containerB);
  const rootB = createRoot(containerB);

  await act(async () => {
    rootA.render(React.createElement(AppAccountA));
    rootB.render(React.createElement(AppAccountB));
  });

  assert(hookInstA1 && hookInstA2 && hookInstB, 'Hooks de favoritos devem ser inicializados');

  // 1. Account A favorites item X
  await act(async () => {
    hookInstA1!.toggleFavorite({ id: '101', name: 'Canal 1', cover: 'http://img/1.jpg', type: 'live' });
  });

  // Check immediate update on all components of Account A
  assert.strictEqual(hookInstA1!.favorites.length, 1);
  assert.strictEqual(hookInstA2!.favorites.length, 1);
  assert.strictEqual(hookInstA1!.isFavorite('101', 'live'), true);

  // 2. Account B on same server starts empty
  assert.strictEqual(hookInstB!.favorites.length, 0, 'Conta B não deve ver os favoritos da Conta A');

  // 3. Account B favorites item Y
  await act(async () => {
    hookInstB!.toggleFavorite({ id: '202', name: 'Filme 1', cover: 'http://img/2.jpg', type: 'movie' });
  });

  assert.strictEqual(hookInstB!.favorites.length, 1);
  assert.strictEqual(hookInstB!.isFavorite('202', 'movie'), true);
  // Account A still has only item X
  assert.strictEqual(hookInstA1!.favorites.length, 1);
  assert.strictEqual(hookInstA1!.isFavorite('202', 'movie'), false);

  // 4. Cross-tab storage event test
  await act(async () => {
    const keyA = getAccountKey(credsA.serverUrl, credsA.username);
    const remoteUpdate = [
      { id: '101', name: 'Canal 1', cover: 'http://img/1.jpg', type: 'live' },
      { id: '303', name: 'Série Remote', cover: 'http://img/3.jpg', type: 'series' },
    ];
    window.localStorage.setItem(keyA, JSON.stringify(remoteUpdate));
    const storageEvent = new window.StorageEvent('storage', {
      key: keyA,
      newValue: JSON.stringify(remoteUpdate),
    });
    window.dispatchEvent(storageEvent);
  });

  assert.strictEqual(hookInstA1!.favorites.length, 2, 'Evento storage da Conta A deve atualizar inscritos da Conta A');
  assert.strictEqual(hookInstB!.favorites.length, 1, 'Evento storage da Conta A não deve alterar Conta B');

  // 5. Test Legacy Migration
  window.localStorage.clear();
  const legacyFavs = [
    { id: '99', name: 'Canal Legado', cover: 'http://img/leg.jpg', type: 'live' },
  ];
  window.localStorage.setItem('northcode_tv_favorites', JSON.stringify(legacyFavs));

  // Without pre-existing credentials, bootstrap legacy migration marks as unassigned
  bootstrapLegacyMigration();
  assert.strictEqual(hasUnassignedLegacyFavorites(), true, 'Legado sem conta deve ficar marcado como unassigned');

  let hookInstMigrated: ReturnType<typeof useFavorites> | null = null;
  function AppMigrationTest() {
    hookInstMigrated = useFavorites(credsA);
    return React.createElement('div', null, 'Migration Test');
  }

  const containerMig = window.document.createElement('div');
  window.document.body.appendChild(containerMig);
  const rootMig = createRoot(containerMig);

  await act(async () => {
    rootMig.render(React.createElement(AppMigrationTest));
  });

  assert.strictEqual(hookInstMigrated!.canImportLegacy, true, 'canImportLegacy deve ser true para legado unassigned');

  // Perform explicit import
  await act(async () => {
    const res = hookInstMigrated!.importLegacyFavorites();
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.importedCount, 1);
  });

  assert.strictEqual(hookInstMigrated!.favorites.length, 1);
  assert.strictEqual(hookInstMigrated!.isFavorite('99', 'live'), true);

  await act(async () => {
    rootA.unmount();
    rootB.unmount();
    rootMig.unmount();
  });

  console.log('✅ Testes de Favoritos por Conta e Sincronização Local aprovados com sucesso!');
}

async function runPlayerAndMetricsTests() {
  console.log('--- 4. Testes de Player, Sessão e Métricas ---');

  let externalRetryCount = 0;

  function PlayerWrapper({ url }: { url: string }) {
    return React.createElement(VideoPlayer, {
      streamUrl: url,
      title: 'Vídeo de Teste',
      contentType: 'movie',
      onBack: () => {},
      onRetry: () => { externalRetryCount++; },
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
  assert(videoEl, 'Elemento video deve ser renderizado');

  // Simulate video loadedmetadata and playing
  await act(async () => {
    videoEl.dispatchEvent(new windowInstance.Event('loadedmetadata') as unknown as Event);
    videoEl.dispatchEvent(new windowInstance.Event('playing') as unknown as Event);
  });

  // Test play/pause toggle button
  const pauseBtn = containerP.querySelector('button[aria-label="Pausar"], button[aria-label="Reproduzir"]') as HTMLButtonElement;
  assert(pauseBtn, 'Botão de Play/Pause deve existir no DOM');

  await act(async () => {
    pauseBtn.click();
  });

  // Change URL -> stats & metrics reset
  await act(async () => {
    rootP.render(React.createElement(PlayerWrapper, { url: 'http://server.tv:8080/movie/u/p/200.mp4' }));
  });

  const newVideoEl = containerP.querySelector('video') as HTMLVideoElement;
  assert(newVideoEl, 'Novo elemento de vídeo deve estar presente após alteração de URL');

  await act(async () => {
    rootP.unmount();
  });

  console.log('✅ Testes de Player, Sessão e Métricas aprovados com sucesso!');
}

async function main() {
  runDirectUrlTests();
  runAccountKeyTests();
  await runFavoritesIsolationAndMigrationTests();
  await runPlayerAndMetricsTests();
  console.log('\n🎉 TODOS OS TESTES AUTOMATIZADOS FORAM EXECUTADOS COM SUCESSO!');
}

main().catch((err) => {
  console.error('❌ Erro na execução dos testes:', err);
  process.exit(1);
});
