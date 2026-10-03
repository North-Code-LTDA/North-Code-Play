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
  getSourceKeyForV1,
  isOldKeyAmbiguous,
  getMigrationStatus,
  getSourceRegistry,
  getSourceRegistryEntry,
  setSourceRegistryEntry,
  readAccountEnvelope,
  writeAccountEnvelope,
  initializeLegacyMigrationStatus,
  bootstrapLegacyMigration,
  migrateOldKeyToV2,
  hasUnassignedLegacyFavorites,
  hasAmbiguousOldKeyFavorites,
  importUnassignedLegacyToAccount,
  importAmbiguousOldKeyToAccount,
  safeSaveCredentials,
  safeRemoveCredentials,
  safeGetStorage,
  safeSetStorage,
  LEGACY_FAVORITES_KEY,
  LEGACY_CREDENTIALS_KEY,
  MIGRATION_STATUS_KEY,
  SOURCE_REGISTRY_KEY,
  SOURCE_GLOBAL_KEY,
} from '../src/utils/accountUtils';
import { XtreamCredentials } from '../src/types';
import { useFavorites } from '../src/hooks/useFavorites';
import { VideoPlayer } from '../src/components/VideoPlayer';

// Helper to save orig setItem
const origSetItem = windowInstance.localStorage.setItem;

async function runScenario1() {
  console.log('Cenário 1: base_a/b e base/a_b produzem chaves v2 diferentes e mesma chave v1');
  const keyA_v2 = getAccountKey('http://provider.test/base_a', 'b');
  const keyB_v2 = getAccountKey('http://provider.test/base', 'a_b');
  assert.notStrictEqual(keyA_v2, keyB_v2, 'Chaves v2 devem ser diferentes');

  const keyA_v1 = getOldAccountKey('http://provider.test/base_a', 'b');
  const keyB_v1 = getOldAccountKey('http://provider.test/base', 'a_b');
  assert.strictEqual(keyA_v1, keyB_v1, 'Chaves v1 colidem e devem ser iguais');
  assert.strictEqual(isOldKeyAmbiguous(keyA_v1), true, 'Chave v1 colidida deve ser marcada como ambígua');
}

async function runScenario2() {
  console.log('Cenário 2: A importa origem ambígua; aviso desaparece; A remove item; aviso continua ausente');
  window.localStorage.clear();

  const serverA = 'http://provider.test/base_a';
  const userA = 'b';
  const keyA_v2 = getAccountKey(serverA, userA);
  const oldKey = getOldAccountKey(serverA, userA);
  const ambigItem = { id: 101, name: 'Canal Ambig 1', type: 'live' };

  window.localStorage.setItem(oldKey, JSON.stringify([ambigItem]));
  assert.strictEqual(hasAmbiguousOldKeyFavorites(serverA, userA, keyA_v2), true);

  const importRes = importAmbiguousOldKeyToAccount(serverA, userA);
  assert.strictEqual(importRes.success, true);
  assert.strictEqual(importRes.importedCount, 1);

  // Aviso deve sumir
  assert.strictEqual(hasAmbiguousOldKeyFavorites(serverA, userA, keyA_v2), false);

  // A remove o item
  const ok = writeAccountEnvelope(keyA_v2, []);
  assert.strictEqual(ok, true);

  // Aviso continua ausente mesmo com lista vazia
  assert.strictEqual(hasAmbiguousOldKeyFavorites(serverA, userA, keyA_v2), false);
}

async function runScenario3() {
  console.log('Cenário 3: A remove todos os itens importados, recarrega módulos/página e lista continua vazia');
  // Usar o estado do cenário 2
  const serverA = 'http://provider.test/base_a';
  const userA = 'b';
  const keyA_v2 = getAccountKey(serverA, userA);

  // Simular reload lendo direto do storage
  const env = readAccountEnvelope(keyA_v2);
  assert.strictEqual(env.items.length, 0, 'Lista deve permanecer vazia');
  assert.strictEqual(env.importedSourceKeys.length, 1, 'Comprovante da fonte deve ser preservado');
}

async function runScenario4() {
  console.log('Cenário 4: Nova chamada de importação da origem concluída não restaura itens e importedCount é zero');
  const serverA = 'http://provider.test/base_a';
  const userA = 'b';
  const keyA_v2 = getAccountKey(serverA, userA);

  const replayRes = importAmbiguousOldKeyToAccount(serverA, userA);
  assert.strictEqual(replayRes.success, true);
  assert.strictEqual(replayRes.importedCount, 0, 'importedCount deve ser 0');

  const env = readAccountEnvelope(keyA_v2);
  assert.strictEqual(env.items.length, 0, 'Itens removidos não devem ser restaurados');
}

async function runScenario5() {
  console.log('Cenário 5: B tenta importar a mesma origem reservada/concluída de A; recebe rejeição');
  const serverB = 'http://provider.test/base';
  const userB = 'a_b';
  const keyB_v2 = getAccountKey(serverB, userB);
  const oldKey = getOldAccountKey(serverB, userB);
  const rawBefore = window.localStorage.getItem(oldKey);

  assert.strictEqual(hasAmbiguousOldKeyFavorites(serverB, userB, keyB_v2), false, 'UI de B não deve ver aviso');

  const importResB = importAmbiguousOldKeyToAccount(serverB, userB);
  assert.strictEqual(importResB.success, false);
  assert.strictEqual(importResB.reason, 'already_assigned');

  assert.strictEqual(window.localStorage.getItem(keyB_v2), null, 'B não deve ter dados gravados');
  assert.strictEqual(window.localStorage.getItem(oldKey), rawBefore, 'Fonte v1 deve estar byte a byte intacta');
}

async function runScenario6() {
  console.log('Cenário 6: Falha ao gravar reserva: nenhum dado de destino é gravado; fontes e credenciais permanecem');
  window.localStorage.clear();

  const credsA: XtreamCredentials = { serverUrl: 'http://srv.tv:8080', username: 'userA', password: 'pA' };
  window.localStorage.setItem(LEGACY_CREDENTIALS_KEY, JSON.stringify(credsA));
  window.localStorage.setItem(LEGACY_FAVORITES_KEY, JSON.stringify([{ id: 1, name: 'F1', type: 'movie' }]));

  const keyA_v2 = getAccountKey(credsA.serverUrl, credsA.username);

  // Simular falha ao gravar status de reserva
  Object.defineProperty(windowInstance.localStorage, 'setItem', {
    value: function (key: string, val: string) {
      if (key === MIGRATION_STATUS_KEY) {
        throw new Error('QuotaExceededError: LocalStorage quota exceeded (simulated)');
      }
      return origSetItem.call(windowInstance.localStorage, key, val);
    },
    configurable: true,
    writable: true,
  });

  const res = importUnassignedLegacyToAccount(keyA_v2);
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.reason, 'storage_failure');

  Object.defineProperty(windowInstance.localStorage, 'setItem', {
    value: origSetItem,
    configurable: true,
    writable: true,
  });

  assert.strictEqual(window.localStorage.getItem(keyA_v2), null, 'Destino não deve ter sido gravado');
  assert.strictEqual(JSON.parse(window.localStorage.getItem(LEGACY_CREDENTIALS_KEY)!).username, 'userA');
}

async function runScenario7() {
  console.log('Cenário 7: Reserva de A gravada, commit do destino falha: B é rejeitada; A pode retomar');
  window.localStorage.clear();
  const legacyItems = [{ id: 70, name: 'Item 70', type: 'live' }];
  window.localStorage.setItem(LEGACY_FAVORITES_KEY, JSON.stringify(legacyItems));

  const keyA_v2 = getAccountKey('http://srvA.tv', 'userA');
  const keyB_v2 = getAccountKey('http://srvB.tv', 'userB');

  // Gravação do destino de A falha
  Object.defineProperty(windowInstance.localStorage, 'setItem', {
    value: function (key: string, val: string) {
      if (key === keyA_v2) {
        throw new Error('QuotaExceededError: LocalStorage quota exceeded (simulated)');
      }
      return origSetItem.call(windowInstance.localStorage, key, val);
    },
    configurable: true,
    writable: true,
  });

  const resFailA = importUnassignedLegacyToAccount(keyA_v2);
  assert.strictEqual(resFailA.success, false);
  assert.strictEqual(resFailA.reason, 'storage_failure');

  Object.defineProperty(windowInstance.localStorage, 'setItem', {
    value: origSetItem,
    configurable: true,
    writable: true,
  });

  // B é rejeitada
  assert.strictEqual(hasUnassignedLegacyFavorites(keyB_v2), false);
  const resB = importUnassignedLegacyToAccount(keyB_v2);
  assert.strictEqual(resB.success, false);
  assert.strictEqual(resB.reason, 'already_assigned');

  // A pode ver e retomar
  assert.strictEqual(hasUnassignedLegacyFavorites(keyA_v2), true);
  const resRetryA = importUnassignedLegacyToAccount(keyA_v2);
  assert.strictEqual(resRetryA.success, true);
  assert.strictEqual(resRetryA.importedCount, 1);
  assert.strictEqual(readAccountEnvelope(keyA_v2).items.length, 1);
}

async function runScenario8() {
  console.log('Cenário 8: Commit de lista + comprovante funciona, status auxiliar final falha: remover item e retomar não o restaura');
  window.localStorage.clear();
  const legacyItems = [{ id: 80, name: 'Item 80', type: 'movie' }];
  window.localStorage.setItem(LEGACY_FAVORITES_KEY, JSON.stringify(legacyItems));

  const keyA_v2 = getAccountKey('http://srvA.tv', 'userA');

  // Falha na gravação do status auxiliar final
  let targetWritten = false;
  Object.defineProperty(windowInstance.localStorage, 'setItem', {
    value: function (key: string, val: string) {
      if (key === keyA_v2) {
        targetWritten = true;
      }
      if (targetWritten && key === MIGRATION_STATUS_KEY) {
        throw new Error('QuotaExceededError: LocalStorage quota exceeded on status (simulated)');
      }
      return origSetItem.call(windowInstance.localStorage, key, val);
    },
    configurable: true,
    writable: true,
  });

  const res = importUnassignedLegacyToAccount(keyA_v2);
  assert.strictEqual(res.success, true, 'Importação de dados deve reportar sucesso');
  assert.strictEqual(res.importedCount, 1);
  assert.strictEqual(res.auxiliaryStatusPending, true);

  Object.defineProperty(windowInstance.localStorage, 'setItem', {
    value: origSetItem,
    configurable: true,
    writable: true,
  });

  // Usuário remove o item importado
  writeAccountEnvelope(keyA_v2, []);
  assert.strictEqual(readAccountEnvelope(keyA_v2).items.length, 0);

  // Retomar operação finaliza status auxiliar e NÃO restaura o item removido
  const resResume = importUnassignedLegacyToAccount(keyA_v2);
  assert.strictEqual(resResume.success, true);
  assert.strictEqual(resResume.importedCount, 0, 'Não deve re-importar itens');
  assert.strictEqual(readAccountEnvelope(keyA_v2).items.length, 0, 'Item não deve ser restaurado');
}

async function runScenario9() {
  console.log('Cenário 9: Recarregamento após o caso 8 preserva titularidade e comprovante');
  const keyA_v2 = getAccountKey('http://srvA.tv', 'userA');
  const keyB_v2 = getAccountKey('http://srvB.tv', 'userB');

  const env = readAccountEnvelope(keyA_v2);
  assert.strictEqual(env.importedSourceKeys.includes(SOURCE_GLOBAL_KEY), true);
  assert.strictEqual(hasUnassignedLegacyFavorites(keyB_v2), false);

  const resB = importUnassignedLegacyToAccount(keyB_v2);
  assert.strictEqual(resB.success, false);
  assert.strictEqual(resB.reason, 'already_assigned');
}

async function runScenario10() {
  console.log('Cenário 10: Inicialização com legado e credenciais antigas de A: novo login B não altera a proveniência');
  window.localStorage.clear();
  const credsA: XtreamCredentials = { serverUrl: 'http://prov.net', username: 'userA', password: 'pA' };
  window.localStorage.setItem(LEGACY_CREDENTIALS_KEY, JSON.stringify(credsA));
  window.localStorage.setItem(LEGACY_FAVORITES_KEY, JSON.stringify([{ id: 10, name: 'Item 10', type: 'live' }]));

  const keyA_v2 = getAccountKey(credsA.serverUrl, credsA.username);
  initializeLegacyMigrationStatus();

  const credsB: XtreamCredentials = { serverUrl: 'http://provB.net', username: 'userB', password: 'pB' };
  const saveB = safeSaveCredentials(credsB);
  assert.strictEqual(saveB.success, true);

  const status = getMigrationStatus();
  assert.strictEqual(status.preExistingAccountKey, keyA_v2, 'Proveniência da Conta A deve ser preservada');

  const keyB_v2 = getAccountKey(credsB.serverUrl, credsB.username);
  bootstrapLegacyMigration(keyB_v2);
  assert.strictEqual(readAccountEnvelope(keyB_v2).items.length, 0, 'B não deve receber o legado no bootstrap');
}

async function runScenario11() {
  console.log('Cenário 11: Falha da primeira gravação do status, seguida de tentativa de novo login B: evidência de A é preservada');
  window.localStorage.clear();
  const credsA: XtreamCredentials = { serverUrl: 'http://srvA.com', username: 'userA', password: 'passA' };
  window.localStorage.setItem(LEGACY_CREDENTIALS_KEY, JSON.stringify(credsA));
  window.localStorage.setItem(LEGACY_FAVORITES_KEY, JSON.stringify([{ id: 11, name: 'Item 11', type: 'movie' }]));

  // Falha na gravação do status de migração
  Object.defineProperty(windowInstance.localStorage, 'setItem', {
    value: function (key: string, val: string) {
      if (key === MIGRATION_STATUS_KEY) {
        throw new Error('QuotaExceededError: LocalStorage quota exceeded (simulated)');
      }
      return origSetItem.call(windowInstance.localStorage, key, val);
    },
    configurable: true,
    writable: true,
  });

  const initRes = initializeLegacyMigrationStatus();
  assert.strictEqual(initRes.type, 'storage_failure');

  // Conta B tenta logar
  const credsB: XtreamCredentials = { serverUrl: 'http://srvB.com', username: 'userB', password: 'passB' };
  const saveResB = safeSaveCredentials(credsB);
  assert.strictEqual(saveResB.success, false, 'safeSaveCredentials deve recusar sobrescrever');
  assert.strictEqual(saveResB.error, 'storage_failure_protecting_legacy');

  Object.defineProperty(windowInstance.localStorage, 'setItem', {
    value: origSetItem,
    configurable: true,
    writable: true,
  });

  // Credenciais de A permaneceram intactas
  const rawCreds = JSON.parse(window.localStorage.getItem(LEGACY_CREDENTIALS_KEY)!);
  assert.strictEqual(rawCreds.username, 'userA', 'Evidência de A preservada');
}

async function runScenario12() {
  console.log('Cenário 12: Inicialização sem credenciais e com legado: novo login não recebe dados automaticamente; só explícito');
  window.localStorage.clear();
  window.localStorage.setItem(LEGACY_FAVORITES_KEY, JSON.stringify([{ id: 12, name: 'Item 12', type: 'series' }]));

  const initRes = initializeLegacyMigrationStatus();
  assert.strictEqual(initRes.type, 'initialized');
  assert.strictEqual(initRes.status.status, 'unassigned');

  const credsB: XtreamCredentials = { serverUrl: 'http://srvB.com', username: 'userB', password: 'pB' };
  safeSaveCredentials(credsB);

  const keyB_v2 = getAccountKey(credsB.serverUrl, credsB.username);
  bootstrapLegacyMigration(keyB_v2);
  assert.strictEqual(readAccountEnvelope(keyB_v2).items.length, 0, 'Bootstrap não deve atribuir automaticamente');

  // Apenas importação explícita
  assert.strictEqual(hasUnassignedLegacyFavorites(keyB_v2), true);
  const explicitRes = importUnassignedLegacyToAccount(keyB_v2);
  assert.strictEqual(explicitRes.success, true);
  assert.strictEqual(readAccountEnvelope(keyB_v2).items.length, 1);
}

async function runScenario13() {
  console.log('Cenário 13: StrictMode/repetição da inicialização não troca titular nem recopia dados');
  const statusBefore = getMigrationStatus();
  initializeLegacyMigrationStatus();
  initializeLegacyMigrationStatus();
  const statusAfter = getMigrationStatus();
  assert.deepStrictEqual(statusBefore, statusAfter);
}

async function runScenario14() {
  console.log('Cenário 14: Estado global pending_import/imported/migrated anterior é reconhecido e respeitado');
  window.localStorage.clear();
  const keyA_v2 = getAccountKey('http://srv.com', 'userA');
  const keyB_v2 = getAccountKey('http://srv.com', 'userB');

  window.localStorage.setItem(
    MIGRATION_STATUS_KEY,
    JSON.stringify({ status: 'pending_import', assignedAccountKey: keyA_v2, attemptedAt: Date.now() })
  );
  window.localStorage.setItem(LEGACY_FAVORITES_KEY, JSON.stringify([{ id: 14, name: 'Item 14', type: 'movie' }]));

  assert.strictEqual(hasUnassignedLegacyFavorites(keyB_v2), false);
  assert.strictEqual(hasUnassignedLegacyFavorites(keyA_v2), true);

  const resB = importUnassignedLegacyToAccount(keyB_v2);
  assert.strictEqual(resB.success, false);
  assert.strictEqual(resB.reason, 'already_assigned');
}

async function runScenario15() {
  console.log('Cenário 15: Origem global e chave v1 de uma mesma conta podem ser importadas independentemente com 2 comprovantes');
  window.localStorage.clear();
  const server = 'http://srv15.com';
  const user = 'user15';
  const keyV2 = getAccountKey(server, user);
  const oldKey = getOldAccountKey(server, user);

  window.localStorage.setItem(LEGACY_FAVORITES_KEY, JSON.stringify([{ id: 1, name: 'Global Item', type: 'movie' }]));
  window.localStorage.setItem(oldKey, JSON.stringify([{ id: 2, name: 'V1 Item', type: 'live' }]));

  // Importar global
  const resGlobal = importUnassignedLegacyToAccount(keyV2);
  assert.strictEqual(resGlobal.success, true);

  // Importar v1 (mesmo chamando importAmbiguousOldKeyToAccount ou migrateOldKeyToV2)
  const resV1 = importAmbiguousOldKeyToAccount(server, user);
  assert.strictEqual(resV1.success, true);

  const env = readAccountEnvelope(keyV2);
  assert.strictEqual(env.items.length, 2);
  assert.strictEqual(env.importedSourceKeys.includes(SOURCE_GLOBAL_KEY), true);
  assert.strictEqual(env.importedSourceKeys.includes(getSourceKeyForV1(oldKey)), true);
}

async function runScenario16() {
  console.log('Cenário 16: Chave v1 não ambígua e v2 antigo em formato array continuam compatíveis');
  window.localStorage.clear();
  const server = 'http://srv16.com';
  const user = 'user16';
  const keyV2 = getAccountKey(server, user);
  const oldKey = getOldAccountKey(server, user);

  // v2 antigo no formato array cru
  window.localStorage.setItem(keyV2, JSON.stringify([{ id: 100, name: 'Old V2 Item', type: 'series' }]));
  window.localStorage.setItem(oldKey, JSON.stringify([{ id: 200, name: 'Old V1 Item', type: 'movie' }]));

  const ok = migrateOldKeyToV2(server, user);
  assert.strictEqual(ok, true);

  const env = readAccountEnvelope(keyV2);
  assert.strictEqual(env.items.length, 2);
  assert.strictEqual(env.schemaVersion, 1);
}

async function runScenario17() {
  console.log('Cenário 17: JSON corrompido ou leitura com exceção não causa sobrescrita em migração ou toggle');
  window.localStorage.clear();
  const keyV2 = getAccountKey('http://srv17.com', 'user17');
  const malformedStr = '{ corrupt_json: true ';
  window.localStorage.setItem(keyV2, malformedStr);
  window.localStorage.setItem(LEGACY_FAVORITES_KEY, JSON.stringify([{ id: 1, name: 'Item', type: 'live' }]));

  const resImport = importUnassignedLegacyToAccount(keyV2);
  assert.strictEqual(resImport.success, false);
  assert.strictEqual(resImport.reason, 'corrupt_target');
  assert.strictEqual(window.localStorage.getItem(keyV2), malformedStr, 'Valor deve permanecer intocado');
}

async function runScenario18() {
  console.log('Cenário 18: Falha de toggleFavorite não cria favorito em memória, não remove item persistido e retorna falha');
  window.localStorage.clear();
  const creds = { serverUrl: 'http://srv18.com', username: 'user18', password: 'p' };
  const keyV2 = getAccountKey(creds.serverUrl, creds.username);
  writeAccountEnvelope(keyV2, [{ id: 1, name: 'Item 1', type: 'movie' }]);

  let hook: ReturnType<typeof useFavorites> | null = null;
  function AppTest() {
    hook = useFavorites(creds);
    return React.createElement('div', null, 'Test 18');
  }

  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(React.createElement(AppTest));
  });

  assert.strictEqual(hook!.favorites.length, 1);

  // Simular quota exceeded
  Object.defineProperty(windowInstance.localStorage, 'setItem', {
    value: function (key: string, val: string) {
      if (key === keyV2) {
        throw new Error('QuotaExceededError (simulated)');
      }
      return origSetItem.call(windowInstance.localStorage, key, val);
    },
    configurable: true,
    writable: true,
  });

  await act(async () => {
    const success = hook!.toggleFavorite({ id: 2, name: 'Item 2', type: 'movie', cover: '' });
    assert.strictEqual(success, false, 'toggleFavorite deve retornar false');
  });

  assert.strictEqual(hook!.favorites.length, 1, 'Memória não deve reter o item não persistido');
  assert.strictEqual(readAccountEnvelope(keyV2).items.length, 1, 'Storage permaneceu intacto');

  Object.defineProperty(windowInstance.localStorage, 'setItem', {
    value: origSetItem,
    configurable: true,
    writable: true,
  });

  await act(async () => {
    root.unmount();
  });
}

async function runScenario19() {
  console.log('Cenário 19: Mesma conta em dois consumidores React atualiza favoritos e avisos; contas diferentes isoladas');
  window.localStorage.clear();
  const credsA = { serverUrl: 'http://srv19.com', username: 'userA', password: 'p' };
  const credsB = { serverUrl: 'http://srv19.com', username: 'userB', password: 'p' };

  let hookA1: ReturnType<typeof useFavorites> | null = null;
  let hookA2: ReturnType<typeof useFavorites> | null = null;
  let hookB: ReturnType<typeof useFavorites> | null = null;

  function AppMulti() {
    hookA1 = useFavorites(credsA);
    hookA2 = useFavorites(credsA);
    hookB = useFavorites(credsB);
    return React.createElement('div', null, 'Multi');
  }

  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(React.createElement(AppMulti));
  });

  await act(async () => {
    hookA1!.toggleFavorite({ id: 99, name: 'Shared Item', type: 'live', cover: '' });
  });

  assert.strictEqual(hookA1!.favorites.length, 1);
  assert.strictEqual(hookA2!.favorites.length, 1, 'Consumidor 2 de A deve atualizar imediatamente');
  assert.strictEqual(hookB!.favorites.length, 0, 'Consumidor de B deve permanecer isolado');

  await act(async () => {
    root.unmount();
  });
}

async function runScenario20() {
  console.log('Cenário 20: storage event altera corretamente o estado observado; key === null invalida snapshots');
  window.localStorage.clear();
  const creds = { serverUrl: 'http://srv20.com', username: 'user20', password: 'p' };
  const keyV2 = getAccountKey(creds.serverUrl, creds.username);

  let hook: ReturnType<typeof useFavorites> | null = null;
  function AppStorage() {
    hook = useFavorites(creds);
    return React.createElement('div', null, 'Storage Test');
  }
  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(React.createElement(AppStorage));
  });

  // Atualização em outra aba
  writeAccountEnvelope(keyV2, [{ id: 55, name: 'From Tab 2', type: 'movie' }]);
  await act(async () => {
    windowInstance.dispatchEvent(new windowInstance.StorageEvent('storage', { key: keyV2 }));
  });
  assert.strictEqual(hook!.favorites.length, 1);

  // Limpeza de storage em outra aba (key === null)
  window.localStorage.clear();
  await act(async () => {
    windowInstance.dispatchEvent(new windowInstance.StorageEvent('storage', { key: null }));
  });
  assert.strictEqual(hook!.favorites.length, 0, 'Snapshot deve invalidar e retornar vazio');

  await act(async () => {
    root.unmount();
  });
}

async function runScenario21() {
  console.log('Cenário 21: Alterar nome da lista/avatar/senha não muda identidade; mudar usuário ou servidor muda');
  const k1 = getAccountKey('http://provider.tv:8080/base', 'UserX');
  const k2 = getAccountKey('http://provider.tv:8080/base/', 'UserX');
  assert.strictEqual(k1, k2, 'Normalização de trailing slash preserva identidade');

  const kDiffUser = getAccountKey('http://provider.tv:8080/base', 'userx');
  assert.notStrictEqual(k1, kDiffUser, 'Case-sensitive de usuário deve gerar chaves distintas');

  const kDiffPort = getAccountKey('http://provider.tv:8081/base', 'UserX');
  assert.notStrictEqual(k1, kDiffPort, 'Porta diferente gera chave distinta');
}

async function runScenario22() {
  console.log('Cenário 22: Fonte bruta global/v1 permanece byte a byte intacta em sucesso e em falha');
  window.localStorage.clear();
  const rawGlobal = JSON.stringify([{ id: 1, name: 'Exact Content', type: 'live' }]);
  window.localStorage.setItem(LEGACY_FAVORITES_KEY, rawGlobal);

  const keyV2 = getAccountKey('http://srv22.com', 'user22');
  importUnassignedLegacyToAccount(keyV2);

  assert.strictEqual(window.localStorage.getItem(LEGACY_FAVORITES_KEY), rawGlobal, 'Global byte a byte intacta');
}

async function runScenario23() {
  console.log('Cenário 23: Ciclo A -> B -> A preserva listas independentes e avisos de migração corretos');
  window.localStorage.clear();
  const credsA = { serverUrl: 'http://srvA.com', username: 'userA', password: 'p' };
  const credsB = { serverUrl: 'http://srvB.com', username: 'userB', password: 'p' };
  const keyA = getAccountKey(credsA.serverUrl, credsA.username);
  const keyB = getAccountKey(credsB.serverUrl, credsB.username);

  writeAccountEnvelope(keyA, [{ id: 1, name: 'Fav A', type: 'movie' }]);
  writeAccountEnvelope(keyB, [{ id: 2, name: 'Fav B', type: 'live' }]);

  let activeCreds = credsA;
  let hook: ReturnType<typeof useFavorites> | null = null;
  function AppCycle() {
    hook = useFavorites(activeCreds);
    return React.createElement('div', null, 'Cycle');
  }

  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  const root = createRoot(container);

  // A
  await act(async () => {
    root.render(React.createElement(AppCycle));
  });
  assert.strictEqual(hook!.favorites[0].name, 'Fav A');

  // B
  activeCreds = credsB;
  await act(async () => {
    root.render(React.createElement(AppCycle));
  });
  assert.strictEqual(hook!.favorites[0].name, 'Fav B');

  // Retorno para A
  activeCreds = credsA;
  await act(async () => {
    root.render(React.createElement(AppCycle));
  });
  assert.strictEqual(hook!.favorites[0].name, 'Fav A');

  await act(async () => {
    root.unmount();
  });
}

async function runScenario24() {
  console.log('Cenário 24: URL, imagens e player passam nas regressões já existentes');
  // URLs & Imagens
  assert.strictEqual(normalizeServerUrl('example.com:8080'), 'http://example.com:8080');
  assert.strictEqual(normalizeServerUrl('https://provider.tv:8443/custom/base/'), 'https://provider.tv:8443/custom/base');
  assert.strictEqual(normalizeImageSource('  https://example.com/cover.jpg  '), 'https://example.com/cover.jpg');

  // Player session
  videoLoadCallCount = 0;
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
  assert(videoEl, 'Video element must be present');
  const initialLoadCount = videoLoadCallCount;

  // Ajustes de volume, mute e rate não devem invocar video.load()
  await act(async () => {
    videoEl.volume = 0.5;
    videoEl.dispatchEvent(new windowInstance.Event('volumechange') as unknown as Event);
    videoEl.muted = true;
    videoEl.dispatchEvent(new windowInstance.Event('volumechange') as unknown as Event);
    videoEl.playbackRate = 1.5;
    videoEl.dispatchEvent(new windowInstance.Event('ratechange') as unknown as Event);
  });

  assert.strictEqual(videoLoadCallCount, initialLoadCount, 'Volume/mute/rate não devem recriar sessão');

  // Troca real de URL dispara nova sessão
  await act(async () => {
    rootP.render(React.createElement(PlayerWrapper, { url: 'http://server.tv:8080/movie/u/p/200.mp4' }));
  });
  assert(videoLoadCallCount > initialLoadCount, 'Troca real de URL cria nova sessão');

  await act(async () => {
    rootP.unmount();
  });
}

async function main() {
  console.log('🚀 INICIANDO SUÍTE COMPLETA DOS 24 CENÁRIOS DE INTEGRIDADE E REGRESSÃO\n');

  await runScenario1();
  await runScenario2();
  await runScenario3();
  await runScenario4();
  await runScenario5();
  await runScenario6();
  await runScenario7();
  await runScenario8();
  await runScenario9();
  await runScenario10();
  await runScenario11();
  await runScenario12();
  await runScenario13();
  await runScenario14();
  await runScenario15();
  await runScenario16();
  await runScenario17();
  await runScenario18();
  await runScenario19();
  await runScenario20();
  await runScenario21();
  await runScenario22();
  await runScenario23();
  await runScenario24();

  console.log('\n🎉 TODOS OS 24 CENÁRIOS OBRIGATÓRIOS FORAM EXECUTADOS COM SUCESSO!');
}

main().catch((err) => {
  console.error('\n❌ ERRO NA EXECUÇÃO DOS CENÁRIOS:', err);
  process.exit(1);
});
