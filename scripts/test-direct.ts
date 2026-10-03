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

// Mock HTMLMediaElement methods deterministically and track call counts
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
  getOldAccountKey,
  isOldKeyAmbiguous,
  getMigrationStatus,
  initializeLegacyMigrationStatus,
  bootstrapLegacyMigration,
  hasUnassignedLegacyFavorites,
  hasAmbiguousOldKeyFavorites,
  importUnassignedLegacyToAccount,
  importAmbiguousOldKeyToAccount,
  safeGetStorage,
  safeSetStorage,
  LEGACY_FAVORITES_KEY,
  LEGACY_CREDENTIALS_KEY,
  MIGRATION_STATUS_KEY,
} from '../src/utils/accountUtils';
import { XtreamCredentials } from '../src/types';
import { useFavorites } from '../src/hooks/useFavorites';
import { VideoPlayer } from '../src/components/VideoPlayer';

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

  const providerWithUrlParam =
    'http://logos.exemplo.test/image.php?url=https%3A%2F%2Fstorage.exemplo.test%2Fcanal.png&sig=abc#frag';
  assert.strictEqual(buildDirectImageUrl(providerWithUrlParam), providerWithUrlParam);

  console.log('✅ Testes de Regressão de URLs e Imagens concluídos com sucesso!');
}

function runAccountKeyCollisionAndAmbiguityTests() {
  console.log('--- 2. Testes de Colisão de Chaves e Ambiguidade (Caso A) ---');

  // Test Case A: Exact reproducer from prompt
  // Servidor http://provider.test/base_a, usuário b
  const key1 = getAccountKey('http://provider.test/base_a', 'b');
  // Servidor http://provider.test/base, usuário a_b
  const key2 = getAccountKey('http://provider.test/base', 'a_b');

  assert.notStrictEqual(
    key1,
    key2,
    'CASO REPRODUZIDO CORRIGIDO: [server/base_a, b] e [server/base, a_b] devem produzir chaves V2 totalmente distintas!'
  );

  assert(key1.startsWith('nc_favs_v2_'));
  assert(key2.startsWith('nc_favs_v2_'));

  // Ambiguity check on old v1 formula
  const oldKeyAmbiguous = getOldAccountKey('http://provider.test/base', 'a_b');
  assert.strictEqual(isOldKeyAmbiguous(oldKeyAmbiguous), true, 'A chave antiga com _ no path e username deve ser identificada como ambígua');

  const oldKeyUnambiguous = getOldAccountKey('http://provider.test/base', 'user');
  assert.strictEqual(isOldKeyAmbiguous(oldKeyUnambiguous), false, 'A chave antiga sem _ deve ser identificada como não-ambígua');

  console.log('✅ Testes de Colisão e Ambiguidade de Chaves concluídos com sucesso!');
}

async function runLegacyMigrationAndFailureResilienceTests() {
  console.log('--- 3. Testes de Migração e Tolerância a Falhas (Casos B, C, D, E, F, G, H, I, L) ---');

  window.localStorage.clear();

  // Test Case D: First visit without saved credentials -> Legacy exists -> new login B occurs -> legacy remains unassigned
  const legacyFavs = [{ id: '99', name: 'Canal Antigo', cover: 'http://img/old.jpg', type: 'live' }];
  window.localStorage.setItem(LEGACY_FAVORITES_KEY, JSON.stringify(legacyFavs));

  // Initialize app at startup without saved credentials
  initializeLegacyMigrationStatus();

  const statusAtStart = JSON.parse(window.localStorage.getItem(MIGRATION_STATUS_KEY) || '{}');
  assert.strictEqual(statusAtStart.status, 'unassigned', 'Test Case D: Inicialização sem credenciais deve marcar legado como unassigned');

  // Now user B logs in
  const credsB: XtreamCredentials = { serverUrl: 'http://serverB.tv:8080', username: 'userB', password: 'passB' };
  window.localStorage.setItem(LEGACY_CREDENTIALS_KEY, JSON.stringify(credsB));

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

  assert.strictEqual(hookB!.favorites.length, 0, 'Test Case D: Novo login B NÃO deve receber automaticamente o legado unassigned');
  assert.strictEqual(hookB!.canImportLegacy, true, 'Test Case D: canImportLegacy deve permitir ação explícita');

  // Test Case E: Account A persisted before update receives legacy once; account B does not
  window.localStorage.clear();
  window.localStorage.setItem(LEGACY_FAVORITES_KEY, JSON.stringify(legacyFavs));

  const credsA: XtreamCredentials = { serverUrl: 'http://serverA.tv:8080', username: 'userA', password: 'passA' };
  window.localStorage.setItem(LEGACY_CREDENTIALS_KEY, JSON.stringify(credsA));

  // App loads with pre-existing creds A
  initializeLegacyMigrationStatus();

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

  assert.strictEqual(hookA!.favorites.length, 1, 'Test Case E: Conta A pré-existente deve receber o legado');

  // Remove item in A
  await act(async () => {
    hookA!.toggleFavorite(legacyFavs[0] as any);
  });
  assert.strictEqual(hookA!.favorites.length, 0, 'Test Case E: Item removido pela Conta A');

  // Reload / re-render in A must NOT restore deleted item
  await act(async () => {
    rootA.render(React.createElement(AppA));
  });
  assert.strictEqual(hookA!.favorites.length, 0, 'Test Case E: Re-renderização NÃO deve restaurar item removido');

  // Test Case H: Invalid JSON in target key remains literally intact after import attempt
  window.localStorage.clear();
  window.localStorage.setItem(LEGACY_FAVORITES_KEY, JSON.stringify(legacyFavs));

  const keyA_V2 = getAccountKey(credsA.serverUrl, credsA.username);
  const corruptTargetStr = '{ malformed_json_content: true ';
  window.localStorage.setItem(keyA_V2, corruptTargetStr);

  const importRes = importUnassignedLegacyToAccount(keyA_V2);
  assert.strictEqual(importRes.success, false, 'Test Case H: Importação deve retornar falha');
  assert.strictEqual(importRes.reason, 'corrupt_target');
  assert.strictEqual(
    window.localStorage.getItem(keyA_V2),
    corruptTargetStr,
    'Test Case H: Conteúdo JSON corrompido do destino deve permanecer rigorosamente intacto!'
  );

  // Test Case F: Failure writing target favorites does NOT mark migration as completed
  window.localStorage.clear();
  window.localStorage.setItem(LEGACY_FAVORITES_KEY, JSON.stringify(legacyFavs));

  const origSetItem = windowInstance.localStorage.setItem;
  Object.defineProperty(windowInstance.localStorage, 'setItem', {
    value: function (key: string, val: string) {
      if (key === keyA_V2) {
        throw new Error('QuotaExceededError: LocalStorage quota exceeded');
      }
      return origSetItem.call(windowInstance.localStorage, key, val);
    },
    configurable: true,
    writable: true,
  });

  const importResFail = importUnassignedLegacyToAccount(keyA_V2);
  assert.strictEqual(importResFail.success, false, 'Test Case F: Importação deve falhar se gravação do destino falhar');
  assert.strictEqual(importResFail.reason, 'storage_failure');
  const finalStatusFail = getMigrationStatus();
  assert.notStrictEqual(finalStatusFail.status, 'imported', 'Test Case F: Status de importação NÃO deve ser marcado como concluído!');

  // Restore original setItem
  Object.defineProperty(windowInstance.localStorage, 'setItem', {
    value: origSetItem,
    configurable: true,
    writable: true,
  });

  const keyB_V2 = getAccountKey(credsB.serverUrl, credsB.username);

  // DEFEITO 1: Conta B tenta tomar a importação pendente atribuída à Conta A
  // 1. hasUnassignedLegacyFavorites deve ser falso para a Conta B
  assert.strictEqual(
    hasUnassignedLegacyFavorites(keyB_V2),
    false,
    'DEFEITO 1: hasUnassignedLegacyFavorites deve retornar false para Conta B quando há importação pendente da Conta A'
  );

  // 2. Conta B tenta executar importUnassignedLegacyToAccount e deve ser rejeitada com already_assigned
  const importResB = importUnassignedLegacyToAccount(keyB_V2);
  assert.strictEqual(importResB.success, false, 'DEFEITO 1: Conta B NÃO deve conseguir tomar importação pendente da Conta A');
  assert.strictEqual(importResB.reason, 'already_assigned', 'DEFEITO 1: Conta B deve receber motivo already_assigned');
  assert.strictEqual(window.localStorage.getItem(keyB_V2), null, 'DEFEITO 1: Conta B não deve ter recebido os favoritos');

  // 3. Status deve permanecer intocado como pending_import da Conta A
  const statusAfterB = getMigrationStatus();
  assert.strictEqual(statusAfterB.status, 'pending_import', 'DEFEITO 1: Status deve permanecer pending_import');
  assert.strictEqual(statusAfterB.assignedAccountKey, keyA_V2, 'DEFEITO 1: assignedAccountKey deve continuar sendo Conta A');

  // 4. Conta A pode retomar a importação pendente
  assert.strictEqual(
    hasUnassignedLegacyFavorites(keyA_V2),
    true,
    'DEFEITO 1: Conta A deve ver hasUnassignedLegacyFavorites como true para retomar sua importação pendente'
  );

  const importResARetry = importUnassignedLegacyToAccount(keyA_V2);
  assert.strictEqual(importResARetry.success, true, 'DEFEITO 1: Conta A deve conseguir retomar sua importação pendente com sucesso');
  assert.strictEqual(importResARetry.importedCount, 1, 'DEFEITO 1: Conta A deve ter importado os itens com sucesso');

  const statusFinalA = getMigrationStatus();
  assert.strictEqual(statusFinalA.status, 'imported', 'DEFEITO 1: Status deve transitar para imported');
  assert.strictEqual(statusFinalA.assignedAccountKey, keyA_V2, 'DEFEITO 1: assignedAccountKey deve ser Conta A');
  assert.strictEqual(hasUnassignedLegacyFavorites(keyA_V2), false, 'DEFEITO 1: hasUnassignedLegacyFavorites deve ser false após conclusão');
  assert.strictEqual(hasUnassignedLegacyFavorites(keyB_V2), false, 'DEFEITO 1: hasUnassignedLegacyFavorites deve ser false para Conta B após conclusão');

  // DEFEITO 2: Proteção do legado atribuído a conta pré-existente
  window.localStorage.clear();
  window.localStorage.setItem(LEGACY_FAVORITES_KEY, JSON.stringify(legacyFavs));
  window.localStorage.setItem(LEGACY_CREDENTIALS_KEY, JSON.stringify(credsA));
  initializeLegacyMigrationStatus();

  // Simular falha de quota durante migração automática (bootstrapLegacyMigration) da Conta A
  Object.defineProperty(windowInstance.localStorage, 'setItem', {
    value: function (key: string, val: string) {
      if (key === keyA_V2) {
        throw new Error('QuotaExceededError: LocalStorage quota exceeded');
      }
      return origSetItem.call(windowInstance.localStorage, key, val);
    },
    configurable: true,
    writable: true,
  });

  bootstrapLegacyMigration(keyA_V2);

  // Restaurar setItem
  Object.defineProperty(windowInstance.localStorage, 'setItem', {
    value: origSetItem,
    configurable: true,
    writable: true,
  });

  const statusPreExistingFail = getMigrationStatus();
  assert.strictEqual(statusPreExistingFail.status, 'unmigrated', 'Status deve permanecer unmigrated após falha no bootstrap');
  assert.strictEqual(statusPreExistingFail.preExistingAccountKey, keyA_V2, 'preExistingAccountKey deve ser Conta A');

  // Conta B não pode importar legado da Conta A pré-existente
  assert.strictEqual(
    hasUnassignedLegacyFavorites(keyB_V2),
    false,
    'DEFEITO 2: Conta B não deve ver legado pré-existente da Conta A como desatribuído'
  );
  const importResBPreExisting = importUnassignedLegacyToAccount(keyB_V2);
  assert.strictEqual(importResBPreExisting.success, false, 'DEFEITO 2: Conta B não deve conseguir importar legado da Conta A');
  assert.strictEqual(importResBPreExisting.reason, 'already_assigned', 'DEFEITO 2: Deve retornar already_assigned');

  // Login da Conta B não deve sobrescrever preExistingAccountKey
  window.localStorage.setItem(LEGACY_CREDENTIALS_KEY, JSON.stringify(credsB));
  initializeLegacyMigrationStatus();
  const statusAfterBLogin = getMigrationStatus();
  assert.strictEqual(
    statusAfterBLogin.preExistingAccountKey,
    keyA_V2,
    'DEFEITO 2: initializeLegacyMigrationStatus não deve sobrescrever preExistingAccountKey após novo login'
  );

  // Conta A consegue retomar a migração
  assert.strictEqual(
    hasUnassignedLegacyFavorites(keyA_V2),
    true,
    'DEFEITO 2: Conta A deve conseguir importar seu legado pré-existente'
  );
  const importResAPreExisting = importUnassignedLegacyToAccount(keyA_V2);
  assert.strictEqual(importResAPreExisting.success, true, 'DEFEITO 2: Conta A importa seu legado com sucesso');

  // DEFEITO 3: Chave antiga ambígua não reaparece após importação e rollback de cache em falha de storage
  const ambigServer = 'http://provider.test/base_a';
  const ambigUser = 'b';
  const ambigOldKey = getOldAccountKey(ambigServer, ambigUser);

  window.localStorage.setItem(ambigOldKey, JSON.stringify([{ id: 999, name: 'Canal Ambig', type: 'live' }]));
  assert.strictEqual(
    hasAmbiguousOldKeyFavorites(ambigServer, ambigUser),
    true,
    'DEFEITO 3: hasAmbiguousOldKeyFavorites deve ser true antes da importação'
  );

  const ambigImportRes = importAmbiguousOldKeyToAccount(ambigServer, ambigUser);
  assert.strictEqual(ambigImportRes.success, true, 'Importação da chave ambígua deve ter sucesso');
  assert.strictEqual(
    hasAmbiguousOldKeyFavorites(ambigServer, ambigUser),
    false,
    'DEFEITO 3: hasAmbiguousOldKeyFavorites deve ser false após importação bem sucedida (banner some)'
  );

  // Testar rollback de cache em memória do useFavorites após QuotaExceededError no toggleFavorite
  let hookTestCache: ReturnType<typeof useFavorites> | null = null;
  function AppTestCache() {
    hookTestCache = useFavorites(credsA);
    return React.createElement('div', null, 'Test Cache');
  }
  const containerCache = window.document.createElement('div');
  window.document.body.appendChild(containerCache);
  const rootCache = createRoot(containerCache);

  await act(async () => {
    rootCache.render(React.createElement(AppTestCache));
  });

  const countBeforeQuota = hookTestCache!.favorites.length;
  // Simular falha de gravação durante toggleFavorite
  Object.defineProperty(windowInstance.localStorage, 'setItem', {
    value: function (key: string, val: string) {
      if (key === keyA_V2) {
        throw new Error('QuotaExceededError: LocalStorage quota exceeded');
      }
      return origSetItem.call(windowInstance.localStorage, key, val);
    },
    configurable: true,
    writable: true,
  });

  await act(async () => {
    const toggleSuccess = hookTestCache!.toggleFavorite({ id: 8888, name: 'Item Quota', type: 'movie', cover: '' });
    assert.strictEqual(toggleSuccess, false, 'toggleFavorite deve retornar false em falha de storage');
  });

  assert.strictEqual(
    hookTestCache!.favorites.length,
    countBeforeQuota,
    'DEFEITO 3: Cache em memória NÃO deve reter itens que falharam ao salvar no localStorage'
  );

  // Restaurar setItem
  Object.defineProperty(windowInstance.localStorage, 'setItem', {
    value: origSetItem,
    configurable: true,
    writable: true,
  });

  await act(async () => {
    rootCache.unmount();
    rootA.unmount();
    rootB.unmount();
  });

  console.log('✅ Testes de Migração e Resiliência a Falhas concluídos com sucesso!');
}

async function runPlayerVolumeRateAndSessionTests() {
  console.log('--- 4. Testes de Player, Volume, Velocidade e Sessão (Casos J, K) ---');

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

  // Test Case J: Change volume, mute, and playback rate
  await act(async () => {
    videoEl.volume = 0.4;
    videoEl.dispatchEvent(new windowInstance.Event('volumechange') as unknown as Event);
  });

  await act(async () => {
    videoEl.muted = true;
    videoEl.dispatchEvent(new windowInstance.Event('volumechange') as unknown as Event);
  });

  await act(async () => {
    videoEl.playbackRate = 1.25;
    videoEl.dispatchEvent(new windowInstance.Event('ratechange') as unknown as Event);
  });

  assert.strictEqual(
    videoLoadCallCount,
    initialLoadCount,
    'CASO J APROVADO: Ajustes de volume, mute e velocidade NÃO devem invocar video.load() nem reiniciar a sessão de mídia!'
  );

  // Test Case K: Real URL change DOES trigger new session
  await act(async () => {
    rootP.render(React.createElement(PlayerWrapper, { url: 'http://server.tv:8080/movie/u/p/200.mp4' }));
  });

  assert(
    videoLoadCallCount > initialLoadCount,
    'CASO K APROVADO: Troca real de URL deve criar uma nova sessão de reprodução!'
  );

  await act(async () => {
    rootP.unmount();
  });

  console.log('✅ Testes de Player, Volume, Velocidade e Sessão concluídos com sucesso!');
}

async function main() {
  runDirectUrlTests();
  runAccountKeyCollisionAndAmbiguityTests();
  await runLegacyMigrationAndFailureResilienceTests();
  await runPlayerVolumeRateAndSessionTests();
  console.log('\n🎉 TODOS OS TESTES DE REGRESSÃO E CORREÇÃO FORAM EXECUTADOS COM SUCESSO!');
}

main().catch((err) => {
  console.error('❌ Erro na execução dos testes:', err);
  process.exit(1);
});
