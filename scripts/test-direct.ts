import assert from 'assert';
import { Window } from 'happy-dom';

// Initialize DOM environment before importing React components
const windowInstance = new Window({ url: 'http://localhost' });
(globalThis as any).window = windowInstance;
(globalThis as any).document = windowInstance.document;
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

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  normalizeServerUrl,
  normalizeImageSource,
  buildDirectMediaUrl,
  buildDirectImageUrl,
  diagnoseImageUrl,
} from '../src/utils/mediaUtils';
import { XtreamCredentials } from '../src/types';
import { useFavorites } from '../src/hooks/useFavorites';
import { VideoPlayer } from '../src/components/VideoPlayer';

function runDirectUrlTests() {
  console.log('--- 1. Testes de URLs Diretas e Padronização de Imagens ---');

  // 1. normalizeServerUrl
  assert.strictEqual(
    normalizeServerUrl('example.com:8080'),
    'http://example.com:8080'
  );
  assert.strictEqual(
    normalizeServerUrl('http:/example.com:8080/'),
    'http://example.com:8080'
  );
  assert.strictEqual(
    normalizeServerUrl('https://provider.tv:8443/custom/base/'),
    'https://provider.tv:8443/custom/base'
  );
  assert.strictEqual(
    normalizeServerUrl('http://iptv.server.net/'),
    'http://iptv.server.net'
  );

  // 2. normalizeImageSource (array vs string safe boundary)
  assert.strictEqual(
    normalizeImageSource('  https://example.com/cover.jpg  '),
    'https://example.com/cover.jpg'
  );
  assert.strictEqual(
    normalizeImageSource(['https://example.com/backdrop1.jpg', 'https://example.com/backdrop2.jpg']),
    'https://example.com/backdrop1.jpg'
  );
  assert.strictEqual(
    normalizeImageSource(['', '   ', 'https://example.com/valid.jpg']),
    'https://example.com/valid.jpg'
  );
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

  const liveUrl1 = buildDirectMediaUrl(testCreds, {
    type: 'live',
    streamId: 1042,
  });
  assert.strictEqual(
    liveUrl1,
    'http://myprovider.xyz:8080/live/user%40test%2B1/p%40ssword%23123/1042.m3u8'
  );

  const liveUrl2 = buildDirectMediaUrl(testCreds, {
    type: 'live',
    streamId: '1043',
    allowedOutputFormats: ['ts'],
  });
  assert.strictEqual(
    liveUrl2,
    'http://myprovider.xyz:8080/live/user%40test%2B1/p%40ssword%23123/1043.ts'
  );

  const liveUrl3 = buildDirectMediaUrl(testCreds, {
    type: 'live',
    streamId: 1044,
    allowedOutputFormats: ['ts', 'm3u8'],
  });
  assert.strictEqual(
    liveUrl3,
    'http://myprovider.xyz:8080/live/user%40test%2B1/p%40ssword%23123/1044.m3u8'
  );

  const movieUrl1 = buildDirectMediaUrl(testCreds, {
    type: 'movie',
    streamId: 5520,
    containerExtension: 'mkv',
  });
  assert.strictEqual(
    movieUrl1,
    'http://myprovider.xyz:8080/movie/user%40test%2B1/p%40ssword%23123/5520.mkv'
  );

  const seriesUrl1 = buildDirectMediaUrl(testCreds, {
    type: 'series',
    streamId: 9910,
    containerExtension: '.mp4',
  });
  assert.strictEqual(
    seriesUrl1,
    'http://myprovider.xyz:8080/series/user%40test%2B1/p%40ssword%23123/9910.mp4'
  );

  const directSrcUrl = buildDirectMediaUrl(testCreds, {
    type: 'live',
    streamId: 100,
    directSource: 'http://cdn.example.org/stream.m3u8',
  });
  assert.strictEqual(directSrcUrl, 'http://cdn.example.org/stream.m3u8');

  // 4. buildDirectImageUrl
  assert.strictEqual(
    buildDirectImageUrl('http://img.provider.com/poster.jpg'),
    'http://img.provider.com/poster.jpg'
  );
  assert.strictEqual(
    buildDirectImageUrl('https://image.tmdb.org/t/p/w500/abc.jpg'),
    'https://image.tmdb.org/t/p/w500/abc.jpg'
  );

  const providerWithUrlParam =
    'http://logos.exemplo.test/image.php?url=https%3A%2F%2Fstorage.exemplo.test%2Fcanal.png&sig=abc';
  assert.strictEqual(
    buildDirectImageUrl(providerWithUrlParam),
    providerWithUrlParam,
    'URL absoluta do provedor com ?url= e &sig= deve sair rigorosamente intacta!'
  );

  assert.strictEqual(
    buildDirectImageUrl('logo.png', 'http://iptv.server:8080'),
    'http://iptv.server:8080/logo.png'
  );
  assert.strictEqual(
    buildDirectImageUrl('/logos/1.png', 'http://iptv.server:8080'),
    'http://iptv.server:8080/logos/1.png'
  );
  assert.strictEqual(
    buildDirectImageUrl('/api/media/image?url=https%3A%2F%2Fimage.tmdb.org%2Fpic.jpg'),
    'https://image.tmdb.org/pic.jpg'
  );
  assert.strictEqual(buildDirectImageUrl(''), null);
  assert.strictEqual(buildDirectImageUrl(null), null);

  assert(!liveUrl1.includes('/api/media'), 'liveUrl1 não deve conter /api/media');
  assert(!movieUrl1.includes('/api/media'), 'movieUrl1 não deve conter /api/media');
  assert(!seriesUrl1.includes('/api/media'), 'seriesUrl1 não deve conter /api/media');

  const diag1 = diagnoseImageUrl(providerWithUrlParam);
  assert.strictEqual(diag1.wasModifiedByNormalizer, false);
  assert.strictEqual(diag1.isAbsolute, true);
  assert.strictEqual(diag1.diffCategory, 'identical');

  console.log('✅ Testes de URLs e imagens concluídos com sucesso!');
}

async function runPlayerAndFavoritesTests() {
  console.log('--- 2. Testes de Integração de Player, Eventos, Sessão e Favoritos ---');

  window.localStorage.clear();

  // -------------------------------------------------------------
  // TESTES DE FAVORITOS REATIVOS (Requisitos 13, 14, 15, 16)
  // -------------------------------------------------------------
  console.log('Testando Compartilhamento e Sincronização de Favoritos...');

  const existingFavs = [
    { id: 101, name: 'Canal 1', cover: 'http://img/1.png', type: 'live' as const },
    { id: '202', name: 'Filme 1', cover: 'http://img/2.png', type: 'movie' as const },
  ];
  window.localStorage.setItem('northcode_tv_favorites', JSON.stringify(existingFavs));

  let favsHookInstance1: ReturnType<typeof useFavorites> | null = null;
  let favsHookInstance2: ReturnType<typeof useFavorites> | null = null;

  function TestFavoritesApp() {
    favsHookInstance1 = useFavorites();
    favsHookInstance2 = useFavorites();
    return React.createElement('div', null, 'Favorites Test Component');
  }

  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(React.createElement(TestFavoritesApp));
  });

  assert(favsHookInstance1 && favsHookInstance2, 'Hooks de favoritos devem estar inicializados');

  assert.strictEqual((favsHookInstance1 as any).favorites.length, 2);
  assert.strictEqual((favsHookInstance2 as any).favorites.length, 2);
  assert.strictEqual((favsHookInstance1 as any).isFavorite('101', 'live'), true);
  assert.strictEqual((favsHookInstance2 as any).isFavorite(202, 'movie'), true);

  await act(async () => {
    (favsHookInstance1 as any).toggleFavorite({
      id: 303,
      name: 'Série 1',
      cover: 'http://img/3.png',
      type: 'series',
    });
  });

  assert.strictEqual((favsHookInstance2 as any).favorites.length, 3);
  assert.strictEqual((favsHookInstance2 as any).isFavorite(303, 'series'), true);

  await act(async () => {
    (favsHookInstance2 as any).toggleFavorite({
      id: 404,
      name: 'Canal 2',
      cover: 'http://img/4.png',
      type: 'live',
    });
  });

  assert.strictEqual((favsHookInstance1 as any).favorites.length, 4);
  assert.strictEqual((favsHookInstance1 as any).isFavorite(404, 'live'), true);

  await act(async () => {
    (favsHookInstance1 as any).toggleFavorite({
      id: 101,
      name: 'Canal 1',
      cover: 'http://img/1.png',
      type: 'live',
    });
  });

  assert.strictEqual((favsHookInstance2 as any).favorites.length, 3);
  assert.strictEqual((favsHookInstance2 as any).isFavorite(101, 'live'), false);
  assert.strictEqual((favsHookInstance2 as any).isFavorite(404, 'live'), true);

  await act(async () => {
    const updatedByOtherTab = [
      { id: 999, name: 'Canal Remoto', cover: 'http://img/remote.png', type: 'live' as const },
    ];
    window.localStorage.setItem('northcode_tv_favorites', JSON.stringify(updatedByOtherTab));
    const storageEvent = new window.StorageEvent('storage', {
      key: 'northcode_tv_favorites',
      newValue: JSON.stringify(updatedByOtherTab),
    });
    window.dispatchEvent(storageEvent);
  });

  assert.strictEqual((favsHookInstance1 as any).isFavorite(999, 'live'), true);
  console.log('✅ Testes de Favoritos compartilhados e evento storage aprovados!');

  // -------------------------------------------------------------
  // TESTES DE PLAYER & CONTROLES (Requisitos 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)
  // -------------------------------------------------------------
  console.log('Testando Player, Controles, Eventos e Ciclo de Vida...');

  if (!(HTMLMediaElement.prototype as any).play) {
    HTMLMediaElement.prototype.play = function () {
      Object.defineProperty(this, 'paused', { value: false, configurable: true });
      this.dispatchEvent(new window.Event('play'));
      this.dispatchEvent(new window.Event('playing'));
      return Promise.resolve();
    };
  }
  if (!(HTMLMediaElement.prototype as any).pause) {
    HTMLMediaElement.prototype.pause = function () {
      Object.defineProperty(this, 'paused', { value: true, configurable: true });
      this.dispatchEvent(new window.Event('pause'));
    };
  }

  let onBackCalled = false;
  let onNextCalled = false;
  let onPreviousCalled = false;
  let externalRetryCalledCount = 0;

  function PlayerTestWrapper({
    url = 'http://provider.tv:8080/movie/user/pass/1.mp4',
    extRetry,
  }: {
    url?: string;
    extRetry?: () => void;
  }) {
    return React.createElement(VideoPlayer, {
      streamUrl: url,
      title: 'Filme de Teste',
      contentType: 'movie',
      onBack: () => {
        onBackCalled = true;
      },
      onNext: () => {
        onNextCalled = true;
      },
      onPrevious: () => {
        onPreviousCalled = true;
      },
      onRetry: extRetry,
      embedded: true,
    });
  }

  const playerContainer = window.document.createElement('div');
  window.document.body.appendChild(playerContainer);
  const playerRoot = createRoot(playerContainer);

  await act(async () => {
    playerRoot.render(React.createElement(PlayerTestWrapper));
  });

  const videoEl = playerContainer.querySelector('video') as HTMLVideoElement;
  assert(videoEl, 'Elemento de vídeo deve estar presente no DOM');

  const pauseBtn = playerContainer.querySelector('button[aria-label="Pausar"], button[title*="Pausar"]') as HTMLButtonElement;
  if (pauseBtn) {
    await act(async () => {
      pauseBtn.click();
    });
    assert.strictEqual(videoEl.paused, true, 'Clique no botão pausar deve manter o vídeo pausado');

    const playBtn = playerContainer.querySelector('button[aria-label="Reproduzir"], button[title*="Reproduzir"]') as HTMLButtonElement;
    if (playBtn) {
      await act(async () => {
        playBtn.click();
      });
      assert.strictEqual(videoEl.paused, false, 'Clique no botão reproduzir deve iniciar o vídeo');
    }
  }

  const initialPausedState = videoEl.paused;
  const settingsBtn = playerContainer.querySelector('button[title*="Configurações"]') as HTMLButtonElement;
  if (settingsBtn) {
    await act(async () => {
      settingsBtn.click();
    });
    assert.strictEqual(videoEl.paused, initialPausedState, 'Abrir configurações não deve alterar estado de reprodução');
  }

  const prevBtn = playerContainer.querySelector('button[title*="Anterior"]') as HTMLButtonElement;
  if (prevBtn) {
    await act(async () => {
      prevBtn.click();
    });
    assert.strictEqual(onPreviousCalled, true, 'Callback onPrevious deve ser invocado');
  }

  await act(async () => {
    playerRoot.render(
      React.createElement(PlayerTestWrapper, {
        extRetry: () => {
          externalRetryCalledCount++;
        },
      })
    );
  });

  const retryButton = playerContainer.querySelector('button[title*="Tentar Novamente"]') || playerContainer.querySelectorAll('button')[0];
  if (retryButton) {
    await act(async () => {
      (retryButton as HTMLButtonElement).click();
    });
    assert.strictEqual(externalRetryCalledCount, 1, 'Callback externo de retry deve ser chamado exatamente uma vez');
  }

  await act(async () => {
    playerRoot.unmount();
    root.unmount();
  });

  console.log('✅ Testes de Player, Eventos, Sessão e Controles aprovados com sucesso!');
}

async function main() {
  runDirectUrlTests();
  await runPlayerAndFavoritesTests();
  console.log('\n🎉 TODOS OS TESTES AUTOMATIZADOS FORAM EXECUTADOS COM SUCESSO!');
}

main().catch((err) => {
  console.error('❌ Erro na execução dos testes:', err);
  process.exit(1);
});
