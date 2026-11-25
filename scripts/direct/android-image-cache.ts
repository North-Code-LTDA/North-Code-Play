import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import type { DomTestEnv } from '../helpers/domEnv';
import type { XtreamCredentials } from '../../src/types';

export interface ImageCacheHlsMockControl {
  enable: () => void;
  restore: () => void;
}

export interface Step1PersistentImageCacheDeps {
  env: DomTestEnv;
  hlsMock: ImageCacheHlsMockControl;
  XtreamProvider: (typeof import('../../src/context/XtreamContext'))['XtreamProvider'];
  XtreamService: (typeof import('../../src/services/xtreamService'))['XtreamService'];
  HorizontalRow: (typeof import('../../src/components/HorizontalRow'))['HorizontalRow'];
  MediaImage: (typeof import('../../src/components/MediaImage'))['MediaImage'];
  setMediaImageRetryDelayMsForTest: (typeof import('../../src/components/MediaImage'))['setMediaImageRetryDelayMsForTest'];
  CatalogShowcaseView: (typeof import('../../src/components/CatalogShowcaseView'))['CatalogShowcaseView'];
  LiveTvView: (typeof import('../../src/views/LiveTvView'))['LiveTvView'];
  clearAllBackHandlersForTest: (typeof import('../../src/navigation'))['clearAllBackHandlersForTest'];
  clearFocusMemory: (typeof import('../../src/navigation'))['clearFocusMemory'];
  createSimulatedPersistentImageDiskHarness: (typeof import('../../src/services/androidImageCache'))['createSimulatedPersistentImageDiskHarness'];
  createValidTestJpegBytes: (typeof import('../../src/services/androidImageCache'))['createValidTestJpegBytes'];
  acquireCachedImage: (typeof import('../../src/services/androidImageCache'))['acquireCachedImage'];
  getInstantCachedImageSrc: (typeof import('../../src/services/androidImageCache'))['getInstantCachedImageSrc'];
  configureImageCacheStorageBudget: (typeof import('../../src/services/androidImageCache'))['configureImageCacheStorageBudget'];
  clearImageCacheOnLogout: (typeof import('../../src/services/androidImageCache'))['clearImageCacheOnLogout'];
  buildHomeStartupImagePlan: (typeof import('../../src/services/androidImageCache'))['buildHomeStartupImagePlan'];
  executeHomeStartupImagePreparation: (typeof import('../../src/services/androidImageCache'))['executeHomeStartupImagePreparation'];
  recordVisitedShowcaseCategory: (typeof import('../../src/services/androidImageCache'))['recordVisitedShowcaseCategory'];
  getVisitedShowcaseCategories: (typeof import('../../src/services/androidImageCache'))['getVisitedShowcaseCategories'];
  isAndroidPersistentImageCacheAvailable: (typeof import('../../src/services/androidImageCache'))['isAndroidPersistentImageCacheAvailable'];
  extractCatalogItemRawImage: (typeof import('../../src/services/androidImageCache'))['extractCatalogItemRawImage'];
  isVideoPlaybackThrottlingActiveForTest: (typeof import('../../src/services/androidImageCache'))['isVideoPlaybackThrottlingActiveForTest'];
}

export interface Step2StartupAndFluidityDeps {
  env: DomTestEnv;
  MediaImage: (typeof import('../../src/components/MediaImage'))['MediaImage'];
  setMediaImageRetryDelayMsForTest: (typeof import('../../src/components/MediaImage'))['setMediaImageRetryDelayMsForTest'];
  clearAllBackHandlersForTest: (typeof import('../../src/navigation'))['clearAllBackHandlersForTest'];
  clearFocusMemory: (typeof import('../../src/navigation'))['clearFocusMemory'];
  androidImageCacheModule: typeof import('../../src/services/androidImageCache');
  createSimulatedPersistentImageDiskHarness: (typeof import('../../src/services/androidImageCache'))['createSimulatedPersistentImageDiskHarness'];
  createValidTestJpegBytes: (typeof import('../../src/services/androidImageCache'))['createValidTestJpegBytes'];
  acquireCachedImage: (typeof import('../../src/services/androidImageCache'))['acquireCachedImage'];
  getInstantCachedImageSrc: (typeof import('../../src/services/androidImageCache'))['getInstantCachedImageSrc'];
  clearImageCacheOnLogout: (typeof import('../../src/services/androidImageCache'))['clearImageCacheOnLogout'];
  buildHomeStartupImagePlan: (typeof import('../../src/services/androidImageCache'))['buildHomeStartupImagePlan'];
  executeHomeStartupImagePreparation: (typeof import('../../src/services/androidImageCache'))['executeHomeStartupImagePreparation'];
  setCatalogTransferPhaseActiveForImageCache: (typeof import('../../src/services/androidImageCache'))['setCatalogTransferPhaseActiveForImageCache'];
  isCatalogTransferPhaseActiveForImageCache: (typeof import('../../src/services/androidImageCache'))['isCatalogTransferPhaseActiveForImageCache'];
  scheduleBackgroundLowPriorityPreload: (typeof import('../../src/services/androidImageCache'))['scheduleBackgroundLowPriorityPreload'];
}

// ============================================================================
// 7. CACHE PERSISTENTE DE IMAGENS E PRÉ-CARREGAMENTO INTELIGENTE (ETAPA 1 — APK ANDROID)
// ============================================================================
export async function runStep1PersistentImageCacheAndPreloadTests(
  deps: Step1PersistentImageCacheDeps
): Promise<void> {
  const {
    env,
    hlsMock,
    XtreamProvider,
    XtreamService,
    HorizontalRow,
    MediaImage,
    setMediaImageRetryDelayMsForTest,
    CatalogShowcaseView,
    LiveTvView,
    clearAllBackHandlersForTest,
    clearFocusMemory,
    createSimulatedPersistentImageDiskHarness,
    createValidTestJpegBytes,
    acquireCachedImage,
    getInstantCachedImageSrc,
    configureImageCacheStorageBudget,
    clearImageCacheOnLogout,
    buildHomeStartupImagePlan,
    executeHomeStartupImagePreparation,
    recordVisitedShowcaseCategory,
    getVisitedShowcaseCategories,
    isAndroidPersistentImageCacheAvailable,
    extractCatalogItemRawImage,
    isVideoPlaybackThrottlingActiveForTest,
  } = deps;
  const { React, act } = env;

  console.log(
    '\n--- 7. Etapa 1: Cache Persistente de Imagens, Pré-Carregamento e Diagnóstico (APK Android) ---'
  );

  // 7.0. Validar arquivos nativos do overlay Android (ImageDiskCachePlugin.java e MainActivity.java)
  const rootDir = process.cwd();
  const pluginJavaPath = path.join(
    rootDir,
    'tooling/android/overlay/app/src/main/java/com/northcode/play/ImageDiskCachePlugin.java'
  );
  const mainActivityJavaPath = path.join(
    rootDir,
    'tooling/android/overlay/app/src/main/java/com/northcode/play/MainActivity.java'
  );
  assert(
    fs.existsSync(pluginJavaPath),
    'ImageDiskCachePlugin.java deve existir no overlay Android'
  );
  const pluginJavaContent = fs.readFileSync(pluginJavaPath, 'utf8');
  assert(
    pluginJavaContent.includes('@CapacitorPlugin(name = "ImageDiskCache")') &&
      pluginJavaContent.includes('nc_image_cache') &&
      !pluginJavaContent.includes('file.setReadable(true, false)') &&
      pluginJavaContent.includes('getFilesDir()'),
    'ImageDiskCachePlugin.java deve usar diretório persistente nc_image_cache separado de nc_catalog_transfers'
  );
  const mainActivityJavaContent = fs.readFileSync(mainActivityJavaPath, 'utf8');
  assert(
    mainActivityJavaContent.includes('registerPlugin(ImageDiskCachePlugin.class);') &&
      mainActivityJavaContent.indexOf('registerPlugin(ImageDiskCachePlugin.class);') <
        mainActivityJavaContent.indexOf('super.onCreate(savedInstanceState);'),
    'MainActivity.java deve registrar ImageDiskCachePlugin antes de super.onCreate'
  );

  // 7.11. Preservação do fallback web quando o plugin nativo não estiver disponível
  assert.strictEqual(
    isAndroidPersistentImageCacheAvailable(),
    false,
    'No ambiente web padrão (sem plugin Android), o cache persistente nativo deve estar desativado'
  );
  const webFallbackRes = await acquireCachedImage('http://img.provider.tv/covers/web_only.jpg');
  assert.strictEqual(
    webFallbackRes.isLocalFile,
    false,
    'Fallback web deve manter a URL remota direta sem exigir o plugin nativo'
  );
  assert.strictEqual(
    webFallbackRes.src,
    'http://img.provider.tv/covers/web_only.jpg',
    'Fallback web deve retornar exatamente a URL resolvida original'
  );

  // Configurar harness de disco persistente simulado para os cenários Android
  let customResponderFn:
    | ((
        url: string,
        reqHeaders: { ifNoneMatch?: string; ifModifiedSince?: string }
      ) => any)
    | null = null;

  const harness = createSimulatedPersistentImageDiskHarness({
    initialMaxBytes: 120 * 1024 * 1024,
    defaultByteSize: 2048,
    customResponder: (url, reqHeaders) => {
      if (customResponderFn) {
        return customResponderFn(url, reqHeaders);
      }
      return {
        status: 200,
        contentType: 'image/jpeg',
        bodyBytes: createValidTestJpegBytes(2048),
      };
    },
  });

  const tracked = env.createTrackedRoot();
  const container = tracked.host;
  const root = tracked.root;

  const origHeroMethods = {
    getVodInfo: XtreamService.getVodInfo,
    getSeriesInfo: XtreamService.getSeriesInfo,
  };
  XtreamService.getVodInfo = async () => ({ info: {}, movie_data: {} } as any);
  XtreamService.getSeriesInfo = async () => ({ info: {}, episodes: {} } as any);

  let primaryError: unknown = null;
  try {
    harness.install();
    setMediaImageRetryDelayMsForTest(25);

    // -------------------------------------------------------------------------
    // 7.5. Deduplicação de requisições simultâneas para a mesma URL
    // -------------------------------------------------------------------------
    const sharedUrl = 'http://img.provider.tv:8080/images/shared_cover_101.jpg';
    customResponderFn = () => ({
      status: 200,
      contentType: 'image/jpeg',
      bodyBytes: createValidTestJpegBytes(4096),
      delayMs: 15,
    });

    const [dupRes1, dupRes2, dupRes3] = await Promise.all([
      acquireCachedImage(sharedUrl, { priority: 'high' }),
      acquireCachedImage(sharedUrl, { priority: 'high' }),
      acquireCachedImage(sharedUrl, { priority: 'critical' }),
    ]);

    assert.strictEqual(
      harness.getNetworkFetchCount(sharedUrl),
      1,
      'Requisições simultâneas para a mesma URL devem realizar apenas 1 download na rede'
    );
    assert.strictEqual(
      dupRes1.src,
      dupRes2.src,
      'Todas as requisições deduplicadas devem receber o mesmo caminho local'
    );
    assert.strictEqual(
      dupRes2.src,
      dupRes3.src,
      'Todas as requisições deduplicadas devem receber o mesmo caminho local'
    );
    assert(
      dupRes1.src.includes('/_capacitor_file_/data/user/0/com.northcode.play/files/nc_image_cache/'),
      'A URL retornada deve apontar para o diretório persistente nc_image_cache via Capacitor'
    );
    customResponderFn = null;

    // -------------------------------------------------------------------------
    // 7.4. Reaproveitamento do cache persistente entre fechamento e reabertura do app
    // -------------------------------------------------------------------------
    const fetchesBeforeRestart = harness.getNetworkFetchCount(sharedUrl);
    harness.simulateAppRestart();

    // Hidratar e adquirir após reiniciar o app
    const afterRestartRes = await acquireCachedImage(sharedUrl, { priority: 'high' });
    assert.strictEqual(
      afterRestartRes.fromCache,
      true,
      'Após fechar e reabrir o aplicativo, a imagem já persistida deve resultar em cache hit local'
    );
    assert.strictEqual(
      harness.getNetworkFetchCount(sharedUrl),
      fetchesBeforeRestart,
      'Reabrir o aplicativo não deve baixar novamente da rede a imagem já persistida no disco'
    );
    assert.strictEqual(
      getInstantCachedImageSrc(sharedUrl),
      afterRestartRes.src,
      'A consulta síncrona em memória deve retornar imediatamente o arquivo local hidratado'
    );

    // -------------------------------------------------------------------------
    // 7.6. Rejeição de respostas inválidas sem corromper o cache persistente
    // -------------------------------------------------------------------------
    // 7.6a. HTTP 404 / 500 / 403
    customResponderFn = (url) => {
      if (url.includes('err404')) return { status: 404, contentType: 'text/plain' };
      if (url.includes('err403')) return { status: 403, contentType: 'text/plain' };
      if (url.includes('html_error')) {
        return {
          status: 200,
          contentType: 'text/html; charset=utf-8',
          bodyBytes: new TextEncoder().encode('<!DOCTYPE html><html><body>Erro</body></html>'),
        };
      }
      if (url.includes('fake_image_json')) {
        return {
          status: 200,
          contentType: 'image/jpeg',
          bodyBytes: new TextEncoder().encode('{"error":"rate_limit_exceeded","status":false}'),
        };
      }
      if (url.includes('truncated_body')) {
        return {
          status: 200,
          contentType: 'image/jpeg',
          declaredContentLength: 8192,
          bodyBytes: createValidTestJpegBytes(1024),
        };
      }
      if (url.includes('no_store_img')) {
        return {
          status: 200,
          contentType: 'image/jpeg',
          cacheControl: 'private, no-store, max-age=0',
          bodyBytes: createValidTestJpegBytes(2048),
        };
      }
      return {
        status: 200,
        contentType: 'image/jpeg',
        bodyBytes: createValidTestJpegBytes(2048),
      };
    };

    const invalidUrls = [
      'http://img.provider.tv/err404.jpg',
      'http://img.provider.tv/err403.jpg',
      'http://img.provider.tv/html_error.jpg',
      'http://img.provider.tv/fake_image_json.jpg',
      'http://img.provider.tv/truncated_body.jpg',
    ];

    for (const badUrl of invalidUrls) {
      let rejected = false;
      try {
        await acquireCachedImage(badUrl);
      } catch {
        rejected = true;
      }
      assert.strictEqual(
        rejected,
        true,
        `A resposta inválida (${badUrl}) deve ser rejeitada pela camada de cache`
      );
      assert.strictEqual(
        harness.hasPhysicalFileForUrl(badUrl),
        false,
        `A resposta inválida (${badUrl}) nunca deve ser persistida em disco`
      );
      assert.strictEqual(
        getInstantCachedImageSrc(badUrl),
        null,
        `A resposta inválida (${badUrl}) nunca deve entrar no índice em memória`
      );
    }

    // Cache-Control: no-store deve fazer bypass do disco E retornar inlineDataUrl para evitar 2º GET no <img>
    const noStoreUrl = 'http://img.provider.tv/no_store_img.jpg';
    const noStoreRes = await acquireCachedImage(noStoreUrl);
    assert.strictEqual(
      noStoreRes.bypassedNoStore,
      true,
      'Respostas com Cache-Control: no-store devem ser sinalizadas como bypass'
    );
    assert.strictEqual(
      noStoreRes.isLocalFile,
      false,
      'Respostas com Cache-Control: no-store não devem gerar arquivo local persistido'
    );
    assert(
      noStoreRes.src.startsWith('data:image/jpeg;base64,'),
      'Respostas com Cache-Control: no-store devem retornar inlineDataUrl em memória para evitar segundo GET na tag <img>'
    );
    assert.strictEqual(
      harness.hasPhysicalFileForUrl(noStoreUrl),
      false,
      'Respostas com Cache-Control: no-store não devem deixar arquivo em nc_image_cache'
    );

    // Renderizar MediaImage com URL no-store e comprovar que ocorre apenas 1 GET na rede
    const noStoreRenderUrl = 'http://img.provider.tv/no_store_img_render.jpg';
    await act(async () => {
      root.render(
        React.createElement(MediaImage, {
          src: noStoreRenderUrl,
          alt: 'No Store Render',
          itemId: '998',
          active: true,
        })
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    assert.strictEqual(
      harness.getNetworkFetchCount(noStoreRenderUrl),
      1,
      'Renderizar MediaImage com Cache-Control: no-store deve realizar exatamente 1 único GET na rede'
    );
    const noStoreImgEl = container.querySelector('img');
    assert(
      noStoreImgEl && noStoreImgEl.getAttribute('src')?.startsWith('data:image/jpeg;base64,'),
      'MediaImage deve exibir o data URL em memória sem disparar segundo GET remoto no navegador/WebView'
    );

    // Revalidação condicional HTTP (Cache-Control: no-cache / max-age expirado + ETag 304 Not Modified)
    let observedIfNoneMatch: string | undefined;
    const revalUrl = 'http://img.provider.tv/reval_etag_cover.jpg';
    let revalCallCount = 0;
    customResponderFn = (url, reqHeaders) => {
      if (url === revalUrl) {
        revalCallCount++;
        if (revalCallCount === 1) {
          return {
            status: 200,
            contentType: 'image/jpeg',
            cacheControl: 'public, no-cache',
            etag: '"etag-cover-v1"',
            bodyBytes: createValidTestJpegBytes(2048),
          };
        }
        observedIfNoneMatch = reqHeaders.ifNoneMatch;
        return {
          status: 304,
          contentType: 'image/jpeg',
          cacheControl: 'public, max-age=86400',
          etag: '"etag-cover-v1"',
        };
      }
      return {
        status: 200,
        contentType: 'image/jpeg',
        bodyBytes: createValidTestJpegBytes(2048),
      };
    };

    const revalRes1 = await acquireCachedImage(revalUrl);
    assert.strictEqual(revalRes1.isLocalFile, true, 'Primeira carga de revalUrl persiste localmente');
    assert.strictEqual(
      getInstantCachedImageSrc(revalUrl),
      null,
      'Entrada com Cache-Control: no-cache não deve saltar a revalidação HTTP síncrona'
    );
    const revalRes2 = await acquireCachedImage(revalUrl);
    assert.strictEqual(
      observedIfNoneMatch,
      '"etag-cover-v1"',
      'A revalidação HTTP deve enviar o cabeçalho condicional If-None-Match com o ETag armazenado'
    );
    assert.strictEqual(
      revalRes2.fromCache,
      true,
      'Resposta HTTP 304 Not Modified deve reaproveitar o arquivo local persistido como cache hit'
    );
    assert.strictEqual(
      getInstantCachedImageSrc(revalUrl),
      revalRes2.src,
      'Após 304 atualizando Cache-Control para max-age=86400, a entrada passa a responder sincronicamente'
    );
    customResponderFn = null;

    // -------------------------------------------------------------------------
    // 7.7. Respeito ao limite de espaço e remoção LRU das entradas mais antigas
    // -------------------------------------------------------------------------
    await clearImageCacheOnLogout();
    await configureImageCacheStorageBudget(6000); // Cabe no máximo 2 imagens de 2048 bytes (4096 <= 6000; 3ª = 6144 > 6000)

    const lruUrl1 = 'http://img.provider.tv/lru_1.jpg';
    const lruUrl2 = 'http://img.provider.tv/lru_2.jpg';
    const lruUrl3 = 'http://img.provider.tv/lru_3.jpg';
    const lruUrl4 = 'http://img.provider.tv/lru_4.jpg';

    await acquireCachedImage(lruUrl1);
    await acquireCachedImage(lruUrl2);
    // Acessar lruUrl1 novamente para torná-la mais recente que lruUrl2
    await acquireCachedImage(lruUrl1);
    // Adicionar lruUrl3 deve remover lruUrl2 (a menos recentemente utilizada)
    await acquireCachedImage(lruUrl3);

    assert.strictEqual(
      harness.hasPhysicalFileForUrl(lruUrl2),
      false,
      'A entrada menos recentemente utilizada (lru_2) deve ser removida do disco ao atingir o limite de bytes'
    );
    assert.strictEqual(
      getInstantCachedImageSrc(lruUrl2),
      null,
      'A entrada removida por LRU (lru_2) deve sair do índice síncrono em memória'
    );
    assert.strictEqual(
      harness.hasPhysicalFileForUrl(lruUrl1),
      true,
      'A entrada acessada recentemente (lru_1) deve permanecer no cache'
    );
    assert.strictEqual(
      harness.hasPhysicalFileForUrl(lruUrl3),
      true,
      'A nova entrada (lru_3) deve estar armazenada no cache'
    );

    // Validar desempate determinístico e sincronização de recência dentro do MESMO milissegundo
    const origDateNow = Date.now;
    const frozenMs = origDateNow();
    Date.now = () => frozenMs;
    try {
      // No momento: lru_1 e lru_3 estão no disco (lru_1 é mais antigo que lru_3).
      // Acessamos lru_1 via getInstantCachedImageSrc no mesmo milissegundo para torná-lo mais recente que lru_3:
      const hitSameMs = getInstantCachedImageSrc(lruUrl1);
      assert(hitSameMs, 'lru_1 deve responder sincronicamente em memória');
      // Agora adicionamos lru_4 no mesmo milissegundo: lru_3 deve ser descartado e lru_1 preservado!
      await acquireCachedImage(lruUrl4);
    } finally {
      Date.now = origDateNow;
    }

    assert.strictEqual(
      harness.hasPhysicalFileForUrl(lruUrl3),
      false,
      'Mesmo quando acessos ocorrem no mesmo milissegundo, lru_3 (menos recente após toque em lru_1) deve ser removido do disco'
    );
    assert.strictEqual(
      harness.hasPhysicalFileForUrl(lruUrl1),
      true,
      'lru_1 tocado via getInstantCachedImageSrc no mesmo milissegundo deve ter sua recência sincronizada e permanecer no disco'
    );
    assert.strictEqual(
      harness.hasPhysicalFileForUrl(lruUrl4),
      true,
      'A nova entrada lru_4 deve estar armazenada no disco'
    );
    assert(
      harness.getTotalDiskBytes() <= 6000,
      'O total de bytes armazenados em disco deve respeitar estritamente o orçamento configurado'
    );
    assert.strictEqual(
      harness.getPhysicalFileCount(),
      2,
      'Ao atingir o limite de 6000 bytes (2 imagens de 2048B), apenas as 2 entradas mais recentes devem permanecer no disco'
    );

    // Restaurar orçamento padrão de 120 MB
    await configureImageCacheStorageBudget(120 * 1024 * 1024);

    // -------------------------------------------------------------------------
    // 7.8. Recuperação automática sob demanda quando arquivo local estiver ausente ou corrompido
    // -------------------------------------------------------------------------
    const corruptibleUrl = 'http://img.provider.tv/corruptible_poster.jpg';
    await acquireCachedImage(corruptibleUrl);
    assert.strictEqual(
      harness.getNetworkFetchCount(corruptibleUrl),
      1,
      'Deve baixar inicialmente 1 vez'
    );

    // Simular corrupção do arquivo físico local
    harness.corruptPhysicalFileForUrl(corruptibleUrl);

    await act(async () => {
      root.render(
        React.createElement(MediaImage, {
          src: corruptibleUrl,
          alt: 'Poster Corrompido',
          itemId: '999',
          active: true,
        })
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    assert.strictEqual(
      harness.getNetworkFetchCount(corruptibleUrl),
      2,
      'MediaImage deve invalidar a entrada local corrompida e buscar novamente na rede sob demanda'
    );
    const renderedImgAfterRecovery = container.querySelector('img');
    assert(
      renderedImgAfterRecovery &&
        renderedImgAfterRecovery.getAttribute('src')?.includes('/_capacitor_file_/') &&
        !harness.isPhysicalFileMarkedCorrupted(renderedImgAfterRecovery.getAttribute('src')!),
      'Após recuperação corretiva, MediaImage deve renderizar o novo arquivo local íntegro'
    );

    // -------------------------------------------------------------------------
    // 7.2. Reaproveitamento de imagem após desmontagem e remontagem por virtualização horizontal
    // -------------------------------------------------------------------------
    const horizItems = Array.from({ length: 30 }, (_, idx) => ({
      stream_id: 5000 + idx,
      name: `Filme Horizontal ${idx}`,
      stream_icon: `http://img.provider.tv/horiz/poster_${idx}.jpg`,
    }));

    // Pré-carregar os primeiros 12 cartões no cache persistente
    for (let i = 0; i < 12; i++) {
      await acquireCachedImage(horizItems[i].stream_icon);
    }
    const fetchCountCard0BeforeHoriz = harness.getNetworkFetchCount(horizItems[0].stream_icon);
    assert.strictEqual(fetchCountCard0BeforeHoriz, 1, 'Cartão 0 foi baixado apenas 1 vez');

    const mockCreds: XtreamCredentials = {
      serverUrl: 'http://provider.tv:8080',
      username: 'user1',
      password: 'pw1',
    };

    await act(async () => {
      root.render(
        React.createElement(
          XtreamProvider,
          { credentials: mockCreds },
          React.createElement(HorizontalRow, {
            title: 'Fileira Virtualizada',
            items: horizItems,
            type: 'vod',
            rowIndex: 0,
            virtualize: true,
            onItemClick: () => {},
          })
        )
      );
      await new Promise((r) => setTimeout(r, 20));
    });

    const rowTrackEl = container.querySelector('[data-nav-row="true"]') as any;
    assert(rowTrackEl, 'Trilha horizontal deve estar montada');

    // Deslocar horizontalmente para o final (desmontando o cartão 0)
    await act(async () => {
      rowTrackEl.scrollLeft = 3600;
      rowTrackEl.dispatchEvent(new Event('scroll'));
      await new Promise((r) => setTimeout(r, 20));
    });
    assert.strictEqual(
      rowTrackEl.querySelector('[data-row-card-index="0"]'),
      null,
      'Cartão 0 deve ter sido desmontado pela virtualização horizontal ao rolar para a direita'
    );

    // Retornar ao início (remontando o cartão 0)
    await act(async () => {
      rowTrackEl.scrollLeft = 0;
      rowTrackEl.dispatchEvent(new Event('scroll'));
      await new Promise((r) => setTimeout(r, 20));
    });

    const remountedCard0 = rowTrackEl.querySelector('[data-row-card-index="0"]') as any;
    assert(remountedCard0, 'Cartão 0 deve ser remontado ao voltar ao início da fileira');
    assert.strictEqual(
      harness.getNetworkFetchCount(horizItems[0].stream_icon),
      fetchCountCard0BeforeHoriz,
      'Remontar o cartão 0 na virtualização horizontal NÃO deve gerar novo download de rede'
    );

    // -------------------------------------------------------------------------
    // 7.1 & 7.3. Reaproveitamento após desmontagem/remontagem vertical na Home (8 fileiras)
    //            e ao alternar entre Início, Filmes e Séries
    // -------------------------------------------------------------------------
    const testVodCategories = Array.from({ length: 12 }, (_, idx) => ({
      category_id: String(10 + idx),
      category_name: `Categoria Filmes ${idx + 1}`,
    }));
    const testVodStreams = testVodCategories.flatMap((cat, catIdx) =>
      Array.from({ length: 6 }, (_, itemIdx) => ({
        stream_id: 10000 + catIdx * 100 + itemIdx,
        name: `Filme Cat ${catIdx + 1} #${itemIdx + 1}`,
        category_id: cat.category_id,
        stream_icon: `http://img.provider.tv/vod/cat_${catIdx}_item_${itemIdx}.jpg`,
        rating: '8.0',
        year: '2025',
      }))
    );
    const testSeriesCategories = [
      { category_id: '201', category_name: 'Séries Drama' },
    ];
    const testSeriesStreams = Array.from({ length: 6 }, (_, idx) => ({
      series_id: 20000 + idx,
      name: `Série Drama #${idx + 1}`,
      category_id: '201',
      cover: `http://img.provider.tv/series/drama_${idx}.jpg`,
      rating: '8.5',
      year: '2025',
    }));

    // 7.9. Ordem de prioridade do pré-carregamento inicial e adaptação por largura da tela
    recordVisitedShowcaseCategory('vod_cat_19'); // Categoria visitada anteriormente
    const planMobile = buildHomeStartupImagePlan({
      serverUrl: mockCreds.serverUrl,
      allVodStreams: testVodStreams,
      allSeriesStreams: testSeriesStreams,
      vodCategories: testVodCategories,
      seriesCategories: testSeriesCategories,
      viewportWidth: 390,
      viewportHeight: 844,
      displayMode: 'default',
      tvScale: 100,
    });
    const planFullHdTv = buildHomeStartupImagePlan({
      serverUrl: mockCreds.serverUrl,
      allVodStreams: testVodStreams,
      allSeriesStreams: testSeriesStreams,
      vodCategories: testVodCategories,
      seriesCategories: testSeriesCategories,
      viewportWidth: 1920,
      viewportHeight: 1080,
      displayMode: 'tv',
      tvScale: 85,
    });

    assert(
      planFullHdTv.posterCardsPerRow > planMobile.posterCardsPerRow,
      `A quantidade de capas preparadas por fileira deve adaptar-se à largura real da tela (TV 1920px=${planFullHdTv.posterCardsPerRow} > Mobile 390px=${planMobile.posterCardsPerRow})`
    );
    assert(
      planFullHdTv.tier1HeroUrls.length > 0 &&
        planFullHdTv.tier2FirstRowsVisibleUrls.length > 0 &&
        planFullHdTv.tier3NextRowsUrls.length > 0 &&
        planFullHdTv.tier4VisitedCategoryUrls.length > 0,
      'O plano de abertura deve preencher as 4 camadas de prioridade (HeroBanner, primeiras fileiras, fileiras seguintes e categorias visitadas)'
    );
    assert.strictEqual(
      planFullHdTv.priorityUrls[0],
      planFullHdTv.tier1HeroUrls[0],
      'A 1ª prioridade obrigatória deve ser a imagem principal do HeroBanner'
    );

    const prepRes1 = await executeHomeStartupImagePreparation(planFullHdTv);
    assert(
      prepRes1.preparedCount >= planFullHdTv.priorityUrls.length,
      'A preparação inicial deve armazenar todas as capas prioritárias no cache persistente'
    );

    // Executar novamente quando já estão em cache: resposta imediata sem downloads extras
    const cacheHitPrepStartMs = Date.now();
    const prepRes2 = await executeHomeStartupImagePreparation(planFullHdTv);
    const cacheHitPrepElapsedMs = Date.now() - cacheHitPrepStartMs;
    assert.strictEqual(
      prepRes2.allAlreadyCached,
      true,
      'Quando as imagens prioritárias já estão no cache local, allAlreadyCached deve ser true'
    );
    assert(
      cacheHitPrepElapsedMs < 50,
      `Quando as imagens prioritárias já estão no cache local, não deve haver atraso artificial (levou ${cacheHitPrepElapsedMs} ms)`
    );

    // Validar extração de imagem de itens do catálogo e pré-carregamento real das fileiras adjacentes
    assert.strictEqual(
      extractCatalogItemRawImage(testVodStreams[0]),
      testVodStreams[0].stream_icon,
      'extractCatalogItemRawImage deve extrair stream_icon de registros de filmes/canais'
    );
    assert.strictEqual(
      extractCatalogItemRawImage(testSeriesStreams[0]),
      testSeriesStreams[0].cover,
      'extractCatalogItemRawImage deve extrair cover de registros de séries'
    );

    // Antes de pré-aquecer manualmente todas as 12 categorias, montar o CatalogShowcaseView
    // e verificar que o efeito de antecipação de categorias adjacentes agenda e baixa URLs válidas
    // das fileiras além da janela inicial!
    await act(async () => {
      root.render(
        React.createElement(
          XtreamProvider,
          { credentials: mockCreds },
          React.createElement(CatalogShowcaseView, {
            section: 'inicio',
            credentials: mockCreds,
            onPlay: () => {},
            vodCategories: testVodCategories,
            vodStreams: testVodStreams,
            allVodStreams: testVodStreams,
            seriesCategories: testSeriesCategories,
            seriesStreams: testSeriesStreams,
            allSeriesStreams: testSeriesStreams,
            sessionReady: true,
          })
        )
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });

    // Na seção 'inicio':
    // Row 0 = Filmes em Destaque, Row 1 = Séries em Destaque, Row 2 = vod_cat_10 (catIdx 0),
    // Row 3 = series_cat_201, Row 4..7 = vod_cat_11..14 (catIdx 1..4).
    // As fileiras adjacentes de lookahead (rows 8 e 9) correspondem a vod_cat_15 (catIdx 5) e vod_cat_16 (catIdx 6)!
    const adjacentLookaheadUrl = testVodStreams.find((m) => m.category_id === '15')?.stream_icon;
    assert(adjacentLookaheadUrl, 'Deve existir URL de capa na categoria adjacente vod_cat_15');
    assert.strictEqual(
      harness.hasPhysicalFileForUrl(adjacentLookaheadUrl!),
      true,
      'O pré-carregamento de categorias adjacentes em CatalogShowcaseView deve extrair URLs válidas dos objetos e armazená-las no cache persistente'
    );

    // Pré-aquecer todas as capas restantes de testVodStreams para testar navegação vertical entre as 12 fileiras com 0 downloads adicionais
    for (const m of testVodStreams) {
      await acquireCachedImage(m.stream_icon);
    }
    for (const s of testSeriesStreams) {
      await acquireCachedImage(s.cover);
    }
    const totalFetchesAfterWarmup = harness.getNetworkFetchCount();

    const showcaseContainer = container.querySelector(
      '[data-showcase-rows-container="true"]'
    ) as any;
    assert(showcaseContainer, 'Container de fileiras da Home deve estar montado');
    assert.strictEqual(
      showcaseContainer.getAttribute('data-showcase-virtualized'),
      'true',
      'A Home com mais de 11 fileiras deve ativar a virtualização vertical de 8 fileiras'
    );

    const mainScrollEl = container.querySelector('main[data-scroll-container="true"]') as any;
    // Rolar até o fundo da Home (desmontando as fileiras iniciais 0..3 e montando as finais)
    await act(async () => {
      mainScrollEl.scrollTop = 3200;
      mainScrollEl.dispatchEvent(new Event('scroll'));
      await new Promise((r) => setTimeout(r, 25));
    });
    assert(
      showcaseContainer.querySelector('[data-showcase-unmounted-row="0"]') !== null,
      'A fileira 0 deve estar desmontada após rolar para o final da Home'
    );
    assert(
      getVisitedShowcaseCategories().length > 0,
      'Rolar pelas categorias da Home deve registrar as categorias visitadas no armazenamento local'
    );

    // Rolar de volta ao topo da Home (remontando as fileiras iniciais 0..3)
    await act(async () => {
      mainScrollEl.scrollTop = 0;
      mainScrollEl.dispatchEvent(new Event('scroll'));
      await new Promise((r) => setTimeout(r, 25));
    });
    assert(
      showcaseContainer.querySelector('[data-home-row-index="0"]') !== null,
      'A fileira 0 deve ser remontada ao retornar ao topo da Home'
    );
    assert.strictEqual(
      harness.getNetworkFetchCount(),
      totalFetchesAfterWarmup,
      'Retornar às categorias já visitadas na Home após desmontagem/remontagem vertical NÃO deve baixar imagens novamente da rede'
    );

    // 7.3. Alternar entre Início -> Filmes -> Séries -> Início sem novos downloads
    await act(async () => {
      root.render(
        React.createElement(
          XtreamProvider,
          { credentials: mockCreds },
          React.createElement(CatalogShowcaseView, {
            section: 'movies',
            credentials: mockCreds,
            onPlay: () => {},
            vodCategories: testVodCategories,
            vodStreams: testVodStreams,
            allVodStreams: testVodStreams,
            sessionReady: true,
          })
        )
      );
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () => {
      root.render(
        React.createElement(
          XtreamProvider,
          { credentials: mockCreds },
          React.createElement(CatalogShowcaseView, {
            section: 'series',
            credentials: mockCreds,
            onPlay: () => {},
            seriesCategories: testSeriesCategories,
            seriesStreams: testSeriesStreams,
            allSeriesStreams: testSeriesStreams,
            sessionReady: true,
          })
        )
      );
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () => {
      root.render(
        React.createElement(
          XtreamProvider,
          { credentials: mockCreds },
          React.createElement(CatalogShowcaseView, {
            section: 'inicio',
            credentials: mockCreds,
            onPlay: () => {},
            vodCategories: testVodCategories,
            vodStreams: testVodStreams,
            allVodStreams: testVodStreams,
            seriesCategories: testSeriesCategories,
            seriesStreams: testSeriesStreams,
            allSeriesStreams: testSeriesStreams,
            sessionReady: true,
          })
        )
      );
      await new Promise((r) => setTimeout(r, 20));
    });

    assert.strictEqual(
      harness.getNetworkFetchCount(),
      totalFetchesAfterWarmup,
      'Alternar entre Início, Filmes e Séries e retornar NÃO deve transferir novamente imagens já armazenadas no cache persistente'
    );

    // -------------------------------------------------------------------------
    // 7.12. Tags <img> renderizam sem dependência de catalogDiagnostics.ts
    // -------------------------------------------------------------------------
    const mountedImgs = container.querySelectorAll('img');
    assert(mountedImgs.length > 0, 'Devem existir tags <img> montadas na vitrine');
    await act(async () => {
      (mountedImgs[0] as any).dispatchEvent(new Event('load'));
      if (mountedImgs[1]) (mountedImgs[1] as any).dispatchEvent(new Event('load'));
    });

    // -------------------------------------------------------------------------
    // 7.13. Reconhecimento do preview ativo da TV ao Vivo na redução de concorrência
    // -------------------------------------------------------------------------
    assert.strictEqual(
      isVideoPlaybackThrottlingActiveForTest(),
      false,
      'Sem vídeo ou preview ativo, o throttling de reprodução deve estar desativado'
    );

    hlsMock.enable();
    const origXtreamLiveMethods = {
      getLiveCategories: XtreamService.getLiveCategories,
      getLiveStreams: XtreamService.getLiveStreams,
      getShortEpg: XtreamService.getShortEpg,
    };
    XtreamService.getLiveCategories = async () => [
      { category_id: '70', category_name: 'Canais Teste Preview', parent_id: 0 },
    ];
    XtreamService.getLiveStreams = async () =>
      [
        {
          num: 1,
          name: 'Canal Preview 1 FHD',
          stream_type: 'live',
          stream_id: 7001,
          stream_icon: '',
          epg_channel_id: 'epg1',
          added: '1700000000',
          category_id: '70',
          custom_sid: '',
          tv_archive: 0,
          direct_source: '',
          tv_archive_duration: 0,
        },
      ] as any;
    XtreamService.getShortEpg = async () => ({ epg_listings: [] });

    let livePreviewPrimaryError: unknown = null;
    try {
      await act(async () => {
        root.render(
          React.createElement(
            XtreamProvider,
            { credentials: mockCreds },
            React.createElement(LiveTvView, {
              onPlayFullscreen: () => {},
            })
          )
        );
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 40));
      });

      const liveCardBtn = container.querySelector(
        'button[data-live-channel-id="7001"]'
      ) as any;
      assert(liveCardBtn, 'Cartão de canal da TV ao Vivo deve estar montado');

      await act(async () => {
        liveCardBtn.click();
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 25));
      });

      assert(
        container.querySelector('[data-player-container="true"]') !== null,
        'O preview de vídeo da TV ao Vivo deve estar montado após selecionar o canal'
      );
      assert.strictEqual(
        isVideoPlaybackThrottlingActiveForTest(),
        true,
        'Enquanto um canal estiver reproduzindo no preview da TV ao Vivo, o controle de concorrência de imagens deve reconhecer a reprodução ativa'
      );

      // Desmontar a TV ao Vivo e verificar que o estado de throttling de vídeo é limpo
      await act(async () => {
        root.render(React.createElement('div'));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 15));
      });
      assert.strictEqual(
        isVideoPlaybackThrottlingActiveForTest(),
        false,
        'Ao encerrar o preview da TV ao Vivo, o controle de concorrência de imagens deve restaurar a capacidade normal'
      );
    } catch (err) {
      livePreviewPrimaryError = err;
      throw err;
    } finally {
      const innerCleanupErrors: unknown[] = [];
      try {
        Object.assign(XtreamService, origXtreamLiveMethods);
      } catch (err) {
        innerCleanupErrors.push(err);
      }
      try {
        hlsMock.restore();
      } catch (err) {
        innerCleanupErrors.push(err);
      }
      if (innerCleanupErrors.length > 0) {
        if (livePreviewPrimaryError) {
          console.error('Erros secundários durante limpeza de preview Live do Bloco 7:', innerCleanupErrors);
        } else {
          throw innerCleanupErrors[0];
        }
      }
    }

    // -------------------------------------------------------------------------
    // 7.10. Limpeza completa no logout, proteção contra gravação tardia e serialização de nova sessão
    // -------------------------------------------------------------------------
    const prevSessionUrl = 'http://img.provider.tv/prev_session_persisted.jpg';
    await acquireCachedImage(prevSessionUrl);
    assert.strictEqual(
      harness.hasPhysicalFileForUrl(prevSessionUrl),
      true,
      'Imagem da sessão anterior deve estar no disco antes do logout'
    );

    const slowInFlightUrl = 'http://img.provider.tv/slow_before_logout.jpg';
    customResponderFn = (url) => ({
      status: 200,
      contentType: 'image/jpeg',
      bodyBytes: createValidTestJpegBytes(2048),
      delayMs: url === slowInFlightUrl ? 40 : 10,
    });

    const inFlightBeforeLogoutPromise = acquireCachedImage(slowInFlightUrl).catch((err) => err);
    // Acionar logout e, imediatamente (sem aguardar o término da Promise de logout),
    // iniciar uma requisição de uma nova sessão para verificar a barreira de serialização
    const logoutPromise = clearImageCacheOnLogout();
    assert.strictEqual(
      getInstantCachedImageSrc(prevSessionUrl),
      null,
      'Durante o logout em andamento, nenhuma imagem da sessão anterior pode ser reutilizada sincronicamente'
    );
    const nextSessionUrl = 'http://img.provider.tv/next_session_after_logout.jpg';
    const nextSessionAcquirePromise = acquireCachedImage(nextSessionUrl);

    const [inFlightOutcome, , nextSessionOutcome] = await Promise.all([
      inFlightBeforeLogoutPromise,
      logoutPromise,
      nextSessionAcquirePromise,
    ]);
    await new Promise((r) => setTimeout(r, 50));

    assert(
      inFlightOutcome instanceof Error,
      'Download em andamento iniciado antes do logout deve ser cancelado/rejeitado'
    );
    assert.strictEqual(
      harness.hasPhysicalFileForUrl(prevSessionUrl),
      false,
      'Arquivo da sessão anterior deve ter sido removido pelo logout'
    );
    assert.strictEqual(
      harness.hasPhysicalFileForUrl(slowInFlightUrl),
      false,
      'Download iniciado antes do logout nunca deve ser gravado tardiamente no disco'
    );
    assert.strictEqual(
      nextSessionOutcome.isLocalFile,
      true,
      'A requisição iniciada pela nova sessão deve aguardar a barreira do logout e persistir com segurança na nova época'
    );
    assert.strictEqual(
      harness.hasPhysicalFileForUrl(nextSessionUrl),
      true,
      'O arquivo da nova sessão pós-logout deve estar íntegro no disco'
    );

    // Executar logout final para verificar estado zerado
    await clearImageCacheOnLogout();
    assert.strictEqual(
      harness.getPhysicalFileCount(),
      0,
      'Após logout final, nenhum arquivo deve permanecer no disco'
    );
    assert.strictEqual(
      harness.getTotalDiskBytes(),
      0,
      'Após logout final, nenhum byte deve permanecer ocupado no disco'
    );
    assert.strictEqual(
      getInstantCachedImageSrc(nextSessionUrl),
      null,
      'Após logout, o índice em memória deve ficar completamente vazio'
    );
    assert.strictEqual(
      getVisitedShowcaseCategories().length,
      0,
      'Após logout, o histórico local de categorias visitadas para pré-carregamento deve ser limpo'
    );
  } catch (err) {
    primaryError = err;
    throw err;
  } finally {
    const cleanupErrors: unknown[] = [];
    const runCleanupStep = async (step: () => void | Promise<void>) => {
      try {
        await step();
      } catch (err) {
        cleanupErrors.push(err);
      }
    };
    await runCleanupStep(() => {
      Object.assign(XtreamService, origHeroMethods);
    });
    await runCleanupStep(() => {
      customResponderFn = null;
    });
    await runCleanupStep(() => {
      harness.uninstall();
    });
    await runCleanupStep(() => {
      setMediaImageRetryDelayMsForTest(2000);
    });
    await runCleanupStep(() => {
      clearAllBackHandlersForTest();
    });
    await runCleanupStep(() => {
      clearFocusMemory();
    });
    await runCleanupStep(() => tracked.unmount());
    if (cleanupErrors.length > 0) {
      if (primaryError) {
        console.error('Erros secundários durante limpeza do Bloco 7 (android-image-cache):', cleanupErrors);
      } else {
        throw cleanupErrors[0];
      }
    }
  }

  console.log(
    '✅ Etapa 1 (cache persistente Android, deduplicação, validação HTTP/assinatura, LRU, recuperação de corrupção, preparação prioritária e logout) validada!'
  );
}

// ============================================================================
// 8. ESTABILIZAÇÃO DO CARREGAMENTO E FLUIDEZ NO APK ANDROID (ETAPA 2)
// ============================================================================
export async function runStep2StartupAndFluidityStabilizationTests(
  deps: Step2StartupAndFluidityDeps
): Promise<void> {
  const {
    env,
    MediaImage,
    setMediaImageRetryDelayMsForTest,
    clearAllBackHandlersForTest,
    clearFocusMemory,
    androidImageCacheModule,
    createSimulatedPersistentImageDiskHarness,
    createValidTestJpegBytes,
    acquireCachedImage,
    getInstantCachedImageSrc,
    clearImageCacheOnLogout,
    buildHomeStartupImagePlan,
    executeHomeStartupImagePreparation,
    setCatalogTransferPhaseActiveForImageCache,
    isCatalogTransferPhaseActiveForImageCache,
    scheduleBackgroundLowPriorityPreload,
  } = deps;
  const { React, act } = env;

  console.log(
    '\n--- 8. Etapa 2: Coordenação Catálogos/Imagens, Eliminação do Gap de 8,1s, Contabilização Prioritária, Cancelamento Vertical e Modo A/B ---'
  );

  let customResponderFn:
    | ((
        url: string,
        reqHeaders: { ifNoneMatch?: string; ifModifiedSince?: string }
      ) => any)
    | null = null;

  const harness = createSimulatedPersistentImageDiskHarness({
    initialMaxBytes: 120 * 1024 * 1024,
    defaultByteSize: 2048,
    customResponder: (url, reqHeaders) => {
      if (customResponderFn) {
        return customResponderFn(url, reqHeaders);
      }
      return {
        status: 200,
        contentType: 'image/jpeg',
        bodyBytes: createValidTestJpegBytes(2048),
      };
    },
  });

  const tracked = env.createTrackedRoot();
  const root = tracked.root;

  let primaryError: unknown = null;
  try {
    harness.install();
    setMediaImageRetryDelayMsForTest(25);

    // -------------------------------------------------------------------------
    // 8.1. Coordenação entre carregamento dos 6 catálogos e cache de imagens
    // -------------------------------------------------------------------------
    // Pré-popular uma imagem no disco persistente antes do início dos catálogos
    const preCachedLogoUrl = 'http://img.provider.tv/logos/ch_persisted_before_catalogs.jpg';
    const preRes = await acquireCachedImage(preCachedLogoUrl);
    assert.strictEqual(preRes.isLocalFile, true, 'Imagem prévia deve estar persistida no disco');

    const downloadsBeforeCatalogPhase = harness.getNetworkFetchCount();

    // Ativar fase de transferência dos 6 catálogos iniciais (!allSixFinished)
    setCatalogTransferPhaseActiveForImageCache(true);
    assert.strictEqual(
      isCatalogTransferPhaseActiveForImageCache(),
      true,
      'Fase de transferência de catálogos deve estar ativa'
    );

    // 1) Imagens já persistidas localmente continuam sendo reutilizadas imediatamente sem rede
    const instantDuringCatalogs = getInstantCachedImageSrc(preCachedLogoUrl);
    assert(
      instantDuringCatalogs === preRes.src &&
        instantDuringCatalogs.includes(
          '/_capacitor_file_/data/user/0/com.northcode.play/files/nc_image_cache/'
        ),
      'getInstantCachedImageSrc deve servir imediatamente imagens já persistidas durante os catálogos'
    );
    const acquireHitDuringCatalogs = await acquireCachedImage(preCachedLogoUrl);
    assert.strictEqual(
      acquireHitDuringCatalogs.fromCache,
      true,
      'acquireCachedImage também deve retornar hit local imediato durante os catálogos para imagens já persistidas'
    );

    // 2) Pré-carregamento oportunista de baixa prioridade deve ser bloqueado durante os catálogos
    scheduleBackgroundLowPriorityPreload([
      'http://img.provider.tv/covers/blocked_low_during_catalogs_1.jpg',
      'http://img.provider.tv/covers/blocked_low_during_catalogs_2.jpg',
    ]);
    await new Promise((r) => setTimeout(r, 25));
    assert.strictEqual(
      harness.getNetworkFetchCount(),
      downloadsBeforeCatalogPhase,
      'Pré-carregamento oportunista não deve iniciar downloads remotos enquanto os 6 catálogos estiverem carregando'
    );

    // 3) Requisições de cartões montados em segundo plano ficam retidas na fila sem competir com os catálogos
    const queuedDuringCatalogsUrl = 'http://img.provider.tv/covers/queued_while_catalogs_loading.jpg';
    let queuedResolved = false;
    const queuedPromise = acquireCachedImage(queuedDuringCatalogsUrl, {
      priority: 'normal',
    }).then((res) => {
      queuedResolved = true;
      return res;
    });

    await new Promise((r) => setTimeout(r, 30));
    assert.strictEqual(
      queuedResolved,
      false,
      'Download remoto não essencial deve aguardar o término dos 6 catálogos'
    );
    assert.strictEqual(
      harness.getNetworkFetchCount(),
      downloadsBeforeCatalogPhase,
      'Nenhum download remoto de imagem deve ocorrer durante a transferência dos catálogos'
    );

    // Concluir os 6 catálogos -> libera a fila imediatamente
    setCatalogTransferPhaseActiveForImageCache(false);
    const queuedRes = await queuedPromise;
    assert.strictEqual(
      queuedRes.isLocalFile,
      true,
      'Assim que os 6 catálogos terminam, o download aguardando na fila deve ser concluído com sucesso'
    );

    // -------------------------------------------------------------------------
    // 8.2. Plano rápido de abertura da Home sem varredura estatística de todo o catálogo
    // -------------------------------------------------------------------------
    const manyVodCategories = Array.from({ length: 120 }, (_, i) => ({
      category_id: `cat_${i + 1}`,
      category_name: `Categoria Filmes ${i + 1}`,
      parent_id: 0,
    }));
    const manyVodStreams = Array.from({ length: 3000 }, (_, i) => ({
      num: i + 1,
      name: `Filme Sintético ${i + 1}`,
      stream_type: 'movie',
      stream_id: 100000 + i,
      stream_icon: `http://img.provider.tv/vod/poster_${i + 1}.jpg`,
      rating: '8.0',
      rating_5based: 4,
      added: String(1700000000 + (i % 500)),
      category_id: `cat_${(i % 120) + 1}`,
      container_extension: 'mp4',
      custom_sid: '',
      direct_source: '',
    }));

    const startupPlanStartMs = Date.now();
    const startupPlan = buildHomeStartupImagePlan({
      allLiveStreams: [
        {
          num: 1,
          name: 'Canal 1',
          stream_type: 'live',
          stream_id: 901,
          stream_icon: 'http://img.provider.tv/live/ch_901.jpg',
          epg_channel_id: '',
          added: '1700000000',
          category_id: 'live_1',
          custom_sid: '',
          tv_archive: 0,
          direct_source: '',
          tv_archive_duration: 0,
        },
      ] as any,
      vodCategories: manyVodCategories as any,
      allVodStreams: manyVodStreams as any,
      seriesCategories: [],
      allSeriesStreams: [],
      continueWatchingItems: [],
    });
    const startupPlanElapsedMs = Date.now() - startupPlanStartMs;

    assert(
      startupPlan.priorityUrls.length > 0,
      'buildHomeStartupImagePlan deve produzir as URLs prioritárias da primeira dobra imediatamente'
    );
    assert(
      startupPlanElapsedMs < 200,
      `buildHomeStartupImagePlan sem varredura estatística deve executar rapidamente (levou ${startupPlanElapsedMs} ms)`
    );
    assert.strictEqual(
      typeof (androidImageCacheModule as any).scheduleCooperativeCatalogUrlCount,
      'undefined',
      'scheduleCooperativeCatalogUrlCount deve ter sido removida definitivamente (Entrega C2.1)'
    );

    // -------------------------------------------------------------------------
    // 8.3. Contabilização exata das imagens prioritárias (sucesso vs falha vs pendente)
    // -------------------------------------------------------------------------
    const diskHitPriorityUrl = 'http://img.provider.tv/priority/already_on_disk.jpg';
    await acquireCachedImage(diskHitPriorityUrl);

    const downloadOkPriorityUrl = 'http://img.provider.tv/priority/download_ok.jpg';
    const failPriorityUrl = 'http://img.provider.tv/priority/download_fail_500.jpg';
    const slowPendingPriorityUrl = 'http://img.provider.tv/priority/download_slow_timeout.jpg';

    customResponderFn = (url) => {
      if (url === failPriorityUrl) {
        return {
          status: 500,
          contentType: 'text/plain',
          bodyBytes: new Uint8Array([69, 82, 82]),
        };
      }
      if (url === slowPendingPriorityUrl) {
        return {
          status: 200,
          contentType: 'image/jpeg',
          bodyBytes: createValidTestJpegBytes(2048),
          delayMs: 250,
        };
      }
      return {
        status: 200,
        contentType: 'image/jpeg',
        bodyBytes: createValidTestJpegBytes(2048),
        delayMs: 10,
      };
    };

    const prepAccountingResult = await executeHomeStartupImagePreparation(
      {
        tier1HeroUrls: [],
        tier2FirstRowsVisibleUrls: [
          diskHitPriorityUrl,
          downloadOkPriorityUrl,
          failPriorityUrl,
          slowPendingPriorityUrl,
        ],
        tier3NextRowsUrls: [],
        tier4VisitedCategoryUrls: [],
        priorityUrls: [
          diskHitPriorityUrl,
          downloadOkPriorityUrl,
          failPriorityUrl,
          slowPendingPriorityUrl,
        ],
        posterCardsPerRow: 6,
        landscapeCardsPerRow: 4,
      },
      { maxWaitMs: 60 }
    );

    assert.strictEqual(
      prepAccountingResult.foundOnDiskCount,
      1,
      'Deve contabilizar exatamente 1 imagem prioritária já encontrada no disco'
    );
    assert.strictEqual(
      prepAccountingResult.downloadedSuccessCount,
      1,
      'Deve contabilizar exatamente 1 imagem prioritária baixada com sucesso antes do timeout'
    );
    assert.strictEqual(
      prepAccountingResult.failedCount,
      1,
      'Deve contabilizar exatamente 1 imagem prioritária que falhou durante a preparação'
    );
    assert.strictEqual(
      prepAccountingResult.pendingAtReleaseCount,
      1,
      'Deve contabilizar exatamente 1 imagem prioritária ainda pendente quando a Home foi liberada por timeout'
    );
    assert.strictEqual(
      prepAccountingResult.preparedCount,
      2,
      'Falhas e pendências NUNCA devem ser somadas em preparedCount (preparedCount deve ser foundOnDiskCount + downloadedSuccessCount = 2)'
    );

    // Aguardar término da imagem lenta em background
    await new Promise((r) => setTimeout(r, 260));
    customResponderFn = null;

    // -------------------------------------------------------------------------
    // 8.4. Cancelamento de tarefas obsoletas na fila ao desmontar cartões na navegação vertical
    // -------------------------------------------------------------------------
    customResponderFn = () => ({
      status: 200,
      contentType: 'image/jpeg',
      bodyBytes: createValidTestJpegBytes(2048),
      delayMs: 45,
    });

    const downloadsBeforeVerticalBurst = harness.getNetworkFetchCount();

    // Disparar 4 downloads que ocupam os 4 workers ativos (capacidade ociosa padrão) +
    // 4 downloads na fila pendente que serão abortados (simulando uma fileira desmontada durante navegação vertical rápida)
    const activeWorkerPromises = [
      acquireCachedImage('http://img.provider.tv/vnav/active_worker_1.jpg'),
      acquireCachedImage('http://img.provider.tv/vnav/active_worker_2.jpg'),
      acquireCachedImage('http://img.provider.tv/vnav/active_worker_3.jpg'),
      acquireCachedImage('http://img.provider.tv/vnav/active_worker_4.jpg'),
    ];

    const staleControllers = [
      new AbortController(),
      new AbortController(),
      new AbortController(),
      new AbortController(),
    ];
    const stalePromises = staleControllers.map((ctrl, idx) =>
      acquireCachedImage(`http://img.provider.tv/vnav/stale_unmounted_${idx + 1}.jpg`, {
        signal: ctrl.signal,
      }).catch((err) => ({ isLocalFile: false, aborted: true, error: err }))
    );

    // Enfileirar a imagem da fileira de destino final onde o usuário parou o D-Pad
    const destinationRowUrl = 'http://img.provider.tv/vnav/destination_visible_card.jpg';
    const destinationPromise = acquireCachedImage(destinationRowUrl);

    // Abortar imediatamente os 4 cartões obsoletos ainda na fila (fileiras intermediárias desmontadas)
    for (const ctrl of staleControllers) {
      ctrl.abort();
    }

    const [staleResults, activeResults, destinationResult] = await Promise.all([
      Promise.all(stalePromises),
      Promise.all(activeWorkerPromises),
      destinationPromise,
    ]);

    assert.strictEqual(
      activeResults.every((r) => r.isLocalFile),
      true,
      'Os 4 downloads já em execução nos workers devem concluir normalmente'
    );
    assert.strictEqual(
      staleResults.every((r: any) => r.isLocalFile === false && r.aborted === true),
      true,
      'As 4 tarefas abortadas na fila antes de iniciar devem ser canceladas sem baixar arquivos remotos'
    );
    assert.strictEqual(
      destinationResult.isLocalFile,
      true,
      'O cartão visível na fileira de destino deve ser baixado e persistido imediatamente após a remoção das tarefas obsoletas'
    );
    assert.strictEqual(
      harness.getNetworkFetchCount() - downloadsBeforeVerticalBurst,
      5,
      'Somente os 4 workers ativos + 1 cartão de destino devem ter sido baixados pela rede (as 4 obsoletas foram removidas da fila)'
    );

    // Verificar também que desmontar um componente <MediaImage /> antes do início do download cancela sua tarefa na fila
    const busy1 = acquireCachedImage('http://img.provider.tv/vnav/busy_media_1.jpg');
    const busy2 = acquireCachedImage('http://img.provider.tv/vnav/busy_media_2.jpg');
    const busy3 = acquireCachedImage('http://img.provider.tv/vnav/busy_media_3.jpg');
    const busy4 = acquireCachedImage('http://img.provider.tv/vnav/busy_media_4.jpg');
    const unmountedCardUrl = 'http://img.provider.tv/vnav/unmounted_media_card.jpg';

    await act(async () => {
      root.render(
        React.createElement(MediaImage, {
          src: unmountedCardUrl,
          alt: 'Cartão desmontado na rolagem vertical',
        })
      );
    });
    // Desmontar imediatamente o MediaImage enquanto os 4 workers ainda estão ocupados
    await act(async () => {
      root.render(React.createElement('div'));
    });

    await Promise.all([busy1, busy2, busy3, busy4]);
    await new Promise((r) => setTimeout(r, 60));
    assert.strictEqual(
      harness.hasPhysicalFileForUrl(unmountedCardUrl),
      false,
      'MediaImage desmontado enquanto aguardava na fila deve cancelar sua requisição sem baixar o arquivo'
    );

    customResponderFn = null;

    // -------------------------------------------------------------------------
    // 8.5. Consolidação definitiva do Modo B ignorando chave legada mode_a
    // -------------------------------------------------------------------------
    window.localStorage.setItem('nc_startup_image_mode_v1', 'mode_a');
    setCatalogTransferPhaseActiveForImageCache(true);
    const fetchesBeforeModeBCheck = harness.getNetworkFetchCount();
    const blockedInModeBPromise = acquireCachedImage(
      'http://img.provider.tv/covers/mode_b_still_active_over_legacy_key.jpg',
      { priority: 'normal' }
    );
    await new Promise((r) => setTimeout(r, 25));
    assert.strictEqual(
      harness.getNetworkFetchCount(),
      fetchesBeforeModeBCheck,
      'Mesmo com nc_startup_image_mode_v1=mode_a no storage, a coordenação consolidada continua retendo downloads remotos durante os catálogos'
    );
    assert(
      getInstantCachedImageSrc(preCachedLogoUrl) !== null &&
        harness.hasPhysicalFileForUrl(preCachedLogoUrl),
      'Os arquivos já persistidos no disco devem continuar sendo servidos e preservados mesmo com chave legada mode_a'
    );
    setCatalogTransferPhaseActiveForImageCache(false);
    const unblockedAfterModeBCheck = await blockedInModeBPromise;
    assert.strictEqual(unblockedAfterModeBCheck.isLocalFile, true);

    await clearImageCacheOnLogout();
  } catch (err) {
    primaryError = err;
    throw err;
  } finally {
    const cleanupErrors: unknown[] = [];
    const runCleanupStep = async (step: () => void | Promise<void>) => {
      try {
        await step();
      } catch (err) {
        cleanupErrors.push(err);
      }
    };
    await runCleanupStep(() => {
      customResponderFn = null;
    });
    await runCleanupStep(() => {
      try {
        window.localStorage.removeItem('nc_startup_image_mode_v1');
      } catch {
        // ignore
      }
    });
    await runCleanupStep(() => {
      setCatalogTransferPhaseActiveForImageCache(false);
    });
    await runCleanupStep(() => {
      harness.uninstall();
    });
    await runCleanupStep(() => {
      setMediaImageRetryDelayMsForTest(2000);
    });
    await runCleanupStep(() => {
      clearAllBackHandlersForTest();
    });
    await runCleanupStep(() => {
      clearFocusMemory();
    });
    await runCleanupStep(() => tracked.unmount());
    if (cleanupErrors.length > 0) {
      if (primaryError) {
        console.error('Erros secundários durante limpeza do Bloco 8 (android-image-cache):', cleanupErrors);
      } else {
        throw cleanupErrors[0];
      }
    }
  }

  console.log(
    '✅ Etapa 2 (coordenação catálogos/imagens, eliminação do gap pós-catálogos, contabilização prioritária exata, cancelamento de fila na rolagem vertical e Modo B consolidado) validada!'
  );
}
