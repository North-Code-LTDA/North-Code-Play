import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import type { DomTestEnv } from '../helpers/domEnv';

export type CustomFetchResponder = (url: string) => Promise<Response>;

export interface DeliveryC21CatalogDeps {
  env: DomTestEnv;
  getCustomFetchResponder: () => CustomFetchResponder | null;
  setCustomFetchResponder: (responder: CustomFetchResponder | null) => void;
  androidImageCacheModule: typeof import('../../src/services/androidImageCache');
  catalogIndexModule: typeof import('../../src/utils/catalogIndex');
  XtreamService: (typeof import('../../src/services/xtreamService'))['XtreamService'];
  executeXtreamGetRequest: (typeof import('../../src/services/httpTransport'))['executeXtreamGetRequest'];
  setTransportTestConfig: (typeof import('../../src/services/httpTransport'))['setTransportTestConfig'];
  getAndroidCatalogAdapterLoadCountForTest: (typeof import('../../src/services/httpTransport'))['getAndroidCatalogAdapterLoadCountForTest'];
  resetAndroidCatalogAdapterLoadCountForTest: (typeof import('../../src/services/httpTransport'))['resetAndroidCatalogAdapterLoadCountForTest'];
  setAndroidCatalogFileAdapterTestOverride: (typeof import('../../src/services/androidCatalogFileAdapter'))['setAndroidCatalogFileAdapterTestOverride'];
  XtreamProvider: (typeof import('../../src/context/XtreamContext'))['XtreamProvider'];
  useXtreamSession: (typeof import('../../src/context/XtreamContext'))['useXtreamSession'];
  useXtreamLive: (typeof import('../../src/context/XtreamContext'))['useXtreamLive'];
  useXtreamVod: (typeof import('../../src/context/XtreamContext'))['useXtreamVod'];
  useXtreamSeries: (typeof import('../../src/context/XtreamContext'))['useXtreamSeries'];
}

// ============================================================================
// 11. CONSOLIDAÇÃO PARA LANÇAMENTO — ENTREGA C2.1 (REMOÇÃO DE DIAGNÓSTICOS DE CATÁLOGO)
// ============================================================================
export async function runDeliveryC21CatalogCleanupAndRegressionTests(
  deps: DeliveryC21CatalogDeps
): Promise<void> {
  const {
    env,
    getCustomFetchResponder,
    setCustomFetchResponder,
    androidImageCacheModule,
    catalogIndexModule,
    XtreamService,
    executeXtreamGetRequest,
    setTransportTestConfig,
    getAndroidCatalogAdapterLoadCountForTest,
    resetAndroidCatalogAdapterLoadCountForTest,
    setAndroidCatalogFileAdapterTestOverride,
    XtreamProvider,
    useXtreamSession,
    useXtreamLive,
    useXtreamVod,
    useXtreamSeries,
  } = deps;
  const { React, act } = env;
  const windowInstance = env.window;

  console.log(
    '\n--- 11. Entrega C2.1: Remoção Física de catalogDiagnostics + Regressão Transporte & Orquestração ---'
  );

  // 1) Garantir exclusão física e ausência de símbolos removidos nos módulos
  assert.strictEqual(
    fs.existsSync(path.resolve('src/utils/catalogDiagnostics.ts')),
    false,
    'src/utils/catalogDiagnostics.ts deve ter sido excluído fisicamente'
  );
  for (const removedExport of [
    'getImageCacheRuntimeStatsSnapshot',
    'getStartupImageCoordinationMode',
    'scheduleCooperativeCatalogUrlCount',
  ]) {
    assert.strictEqual(
      typeof (androidImageCacheModule as any)[removedExport],
      'undefined',
      `androidImageCache não deve exportar ${removedExport}`
    );
  }
  for (const removedIndexExport of ['getCatalogIndexPerfStats', 'resetCatalogIndexPerfStats']) {
    assert.strictEqual(
      typeof (catalogIndexModule as any)[removedIndexExport],
      'undefined',
      `catalogIndex não deve exportar ${removedIndexExport}`
    );
  }

  const homeTsxSource = fs.readFileSync(path.resolve('src/pages/Home.tsx'), 'utf8');
  assert(
    !homeTsxSource.includes('deferFullUrlCount') &&
      !homeTsxSource.includes('catalogDiagnostics') &&
      homeTsxSource.includes('maxWaitMs: 3500'),
    'Home.tsx deve preservar maxWaitMs: 3500 sem deferFullUrlCount ou catalogDiagnostics'
  );

  // 2) Transporte Web fetch vs arquivo temporário Android, rejeição de payload inválido e retry
  const prevFetchResponder = getCustomFetchResponder();
  let transportPrimaryError: unknown = null;
  try {
    // Web fetch válido
    setTransportTestConfig({ mode: 'web', androidCatalogPluginAvailable: false });
    setCustomFetchResponder(
      async () =>
        new Response(JSON.stringify([{ stream_id: 1, name: 'Filme Web' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    );
    const webPayload = await executeXtreamGetRequest({
      url: 'http://provider.tv/player_api.php?action=get_vod_streams',
      timeoutMs: 5000,
      isFullCatalogRequest: true,
    });
    assert(Array.isArray(webPayload) && webPayload.length === 1 && webPayload[0].stream_id === 1);

    // JSON/HTML inválido deve falhar em normalizeCatalogArray via XtreamService
    setCustomFetchResponder(
      async () => new Response('<html><body>Erro 502</body></html>', { status: 200 })
    );
    let invalidCatalogFailed = false;
    try {
      await XtreamService.getVodStreams({
        serverUrl: 'http://provider.tv',
        username: 'u1',
        password: 'p1',
      });
    } catch {
      invalidCatalogFailed = true;
    }
    assert.strictEqual(
      invalidCatalogFailed,
      true,
      'Resposta HTML/JSON inválida deve ser rejeitada pelo carregamento de catálogos'
    );

    // Retry único (1 retentativa) em erro transitório HTTP 503
    let retryAttempts = 0;
    setCustomFetchResponder(async () => {
      retryAttempts++;
      if (retryAttempts === 1) {
        return new Response('Busy', { status: 503 });
      }
      return new Response(JSON.stringify([{ stream_id: 2, name: 'Após Retry' }]), {
        status: 200,
      });
    });
    const retried = await XtreamService.getVodStreams({
      serverUrl: 'http://provider.tv',
      username: 'u1',
      password: 'p1',
    });
    assert.strictEqual(retryAttempts, 2, 'Catálogo deve executar 1 retentativa em erro transitório');
    assert.strictEqual(retried[0].stream_id, 2);

    // Transferência Android por arquivo temporário (CatalogFileTransfer)
    resetAndroidCatalogAdapterLoadCountForTest();
    setTransportTestConfig({ mode: 'capacitor', androidCatalogPluginAvailable: true });
    let cleanedFileId: string | null = null;
    const tempPath = '/data/user/0/com.northcode.play/cache/nc_catalog_transfers/nc_catalog_test1.json';
    const tempFileUrl = `${windowInstance.location.origin}/_capacitor_file_${tempPath}`;
    setAndroidCatalogFileAdapterTestOverride({
      convertFileSrc: () => tempFileUrl,
      plugin: {
        async downloadCatalogToTempFile() {
          return {
            status: 200,
            fileId: 'nc_catalog_test1.json',
            filePath: tempPath,
            cacheDir: '/data/user/0/com.northcode.play/cache/nc_catalog_transfers',
          };
        },
        async cancelTransfer() {
          return { cancelled: true };
        },
        async cleanupTransferFile({ fileId }) {
          cleanedFileId = fileId;
          return { deleted: true };
        },
      },
    });
    setCustomFetchResponder(async (url) => {
      assert.strictEqual(url, tempFileUrl);
      return new Response(JSON.stringify([{ stream_id: 99, name: 'Filme Temp Android' }]), {
        status: 200,
      });
    });
    const androidPayload = await executeXtreamGetRequest({
      url: 'http://provider.tv/player_api.php?action=get_vod_streams',
      timeoutMs: 5000,
      isFullCatalogRequest: true,
    });
    assert.strictEqual(getAndroidCatalogAdapterLoadCountForTest(), 1);
    assert.strictEqual(androidPayload[0].stream_id, 99);
    assert.strictEqual(cleanedFileId, 'nc_catalog_test1.json');
  } catch (err) {
    transportPrimaryError = err;
    throw err;
  } finally {
    const cleanupErrors: unknown[] = [];
    const runCleanupStep = (step: () => void) => {
      try {
        step();
      } catch (err) {
        cleanupErrors.push(err);
      }
    };
    runCleanupStep(() => {
      setCustomFetchResponder(prevFetchResponder);
    });
    runCleanupStep(() => {
      setAndroidCatalogFileAdapterTestOverride({ plugin: null, convertFileSrc: null });
    });
    runCleanupStep(() => {
      setTransportTestConfig({ mode: 'auto', capacitorHttpGet: null, androidCatalogPluginAvailable: null });
    });
    if (cleanupErrors.length > 0) {
      if (transportPrimaryError) {
        console.error('Erros secundários durante limpeza de transporte do Bloco 11:', cleanupErrors);
      } else {
        throw cleanupErrors[0];
      }
    }
  }

  // 3) Orquestração das 6 operações em XtreamContext (concorrência máx 2 e allSixFinished)
  const tracked = env.createTrackedRoot();
  const root = tracked.root;

  const origMethods = {
    getLiveCategories: XtreamService.getLiveCategories,
    getVodCategories: XtreamService.getVodCategories,
    getSeriesCategories: XtreamService.getSeriesCategories,
    getLiveStreams: XtreamService.getLiveStreams,
    getVodStreams: XtreamService.getVodStreams,
    getSeries: XtreamService.getSeries,
  };

  let currentInFlightOps = 0;
  let maxObservedConcurrentOps = 0;
  let observedAllSixFinished = false;
  let observedCounts = { live: 0, vod: 0, series: 0 };

  const wrapConcurrent = <T,>(fn: () => Promise<T>) => async () => {
    currentInFlightOps++;
    if (currentInFlightOps > maxObservedConcurrentOps) {
      maxObservedConcurrentOps = currentInFlightOps;
    }
    try {
      await new Promise((r) => setTimeout(r, 15));
      return await fn();
    } finally {
      currentInFlightOps--;
    }
  };

  XtreamService.getLiveCategories = wrapConcurrent(async () => [
    { category_id: '1', category_name: 'Canais', parent_id: 0 },
  ]);
  XtreamService.getVodCategories = wrapConcurrent(async () => [
    { category_id: '2', category_name: 'Filmes', parent_id: 0 },
  ]);
  XtreamService.getSeriesCategories = wrapConcurrent(async () => [
    { category_id: '3', category_name: 'Séries', parent_id: 0 },
  ]);
  XtreamService.getLiveStreams = wrapConcurrent(
    async () => [{ stream_id: 11, name: 'Canal Teste', category_id: '1' } as any]
  );
  XtreamService.getVodStreams = wrapConcurrent(
    async () => [{ stream_id: 22, name: 'Filme Teste', category_id: '2' } as any]
  );
  XtreamService.getSeries = wrapConcurrent(
    async () => [{ series_id: 33, name: 'Série Teste', category_id: '3' } as any]
  );

  function ContextProbe() {
    const session = useXtreamSession();
    const live = useXtreamLive();
    const vod = useXtreamVod();
    const series = useXtreamSeries();
    const triggeredRef = React.useRef(false);
    React.useEffect(() => {
      if (session.sessionReady && !triggeredRef.current) {
        triggeredRef.current = true;
        void live.fetchLiveStreams();
        void vod.fetchVodStreams();
        void series.fetchSeriesStreams();
      }
    }, [session.sessionReady, live, vod, series]);
    observedAllSixFinished = session.allSixFinished;
    observedCounts = {
      live: live.allLiveStreams.length,
      vod: vod.allVodStreams.length,
      series: series.allSeriesStreams.length,
    };
    return null;
  }

  let contextPrimaryError: unknown = null;
  try {
    await act(async () => {
      root.render(
        React.createElement(
          XtreamProvider,
          { credentials: { serverUrl: 'http://provider.tv', username: 'u1', password: 'p1' } },
          React.createElement(ContextProbe)
        )
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    assert.strictEqual(observedAllSixFinished, true, 'XtreamContext deve concluir os 6 catálogos');
    assert(
      maxObservedConcurrentOps <= 2 && maxObservedConcurrentOps >= 1,
      `Orquestração dos 6 catálogos deve manter concorrência máxima de 2 (observado=${maxObservedConcurrentOps})`
    );
    assert.deepStrictEqual(observedCounts, { live: 1, vod: 1, series: 1 });
  } catch (err) {
    contextPrimaryError = err;
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
      Object.assign(XtreamService, origMethods);
    });
    await runCleanupStep(() => tracked.unmount());
    if (cleanupErrors.length > 0) {
      if (contextPrimaryError) {
        console.error('Erros secundários durante limpeza de contexto do Bloco 11:', cleanupErrors);
      } else {
        throw cleanupErrors[0];
      }
    }
  }

  console.log(
    '✅ Entrega C2.1 (exclusão física de catalogDiagnostics, preservação de transporte Web/Android, retries, validação de JSON inválido e fila de 6 catálogos) validada!'
  );
}
