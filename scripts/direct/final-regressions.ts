import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import type { DomTestEnv } from '../helpers/domEnv';
import type { XtreamCredentials } from '../../src/types';

export interface FinalRegressionsMockHlsController {
  audioTracks: any[];
  subtitleTracks: any[];
  audioTrack: number;
  subtitleTrack: number;
  subtitleDisplay: boolean;
  levels: any[];
  currentLevel: number;
  listeners: Map<string, Set<(...args: any[]) => void>>;
  emit: (event: string, data?: any) => void;
}

export interface FinalRegressionsHlsMockControl {
  enable: () => void;
  restore: () => void;
  getActiveControllers: () => FinalRegressionsMockHlsController[];
  setNextInitialTracks: (tracks: {
    audioTracks?: any[];
    subtitleTracks?: any[];
    audioTrack?: number;
    subtitleTrack?: number;
  }) => void;
}

export interface DeliveryC3FinalCleanupAndRegressionDeps {
  env: DomTestEnv;
  Hls: (typeof import('hls.js'))['default'];
  hlsMock: FinalRegressionsHlsMockControl;
  VideoPlayer: (typeof import('../../src/components/VideoPlayer'))['VideoPlayer'];
  XtreamService: (typeof import('../../src/services/xtreamService'))['XtreamService'];
  NavigationProvider: (typeof import('../../src/navigation'))['NavigationProvider'];
  setNavMode: (typeof import('../../src/navigation'))['setNavMode'];
  clearAllBackHandlersForTest: (typeof import('../../src/navigation'))['clearAllBackHandlersForTest'];
  executeBackAction: (typeof import('../../src/navigation'))['executeBackAction'];
  setAndroidPlatformOverrideForDpadTest: (typeof import('../../src/navigation'))['setAndroidPlatformOverrideForDpadTest'];
  getHeroSessionCacheStatsForTest: (typeof import('../../src/services/heroSessionCache'))['getHeroSessionCacheStatsForTest'];
  mediaUtilsModule: typeof import('../../src/utils/mediaUtils');
  mediaImageModule: typeof import('../../src/components/MediaImage');
  virtualWindowModule: typeof import('../../src/hooks/useVirtualWindow');
  navigationModule: typeof import('../../src/navigation');
  catalogRankingModule: typeof import('../../src/utils/catalogRanking');
  playbackHistoryModule: typeof import('../../src/utils/playbackHistory');
  liveTvViewModule: typeof import('../../src/views/LiveTvView');
  liveEpgManagerModule: typeof import('../../src/utils/liveEpgManager');
  tvEnvironmentModule: typeof import('../../src/platform/tvEnvironment');
}

// ============================================================================
// CONTRATOS ESTRUTURAIS (13.1, 13.2, 13.8)
// ============================================================================

function runC3StructuralModalExclusionSubtest(): void {
  // 13.1. PlayerDiagnosticsModal fisicamente excluído
  const diagModalPath = path.join(
    process.cwd(),
    'src/components/player/PlayerDiagnosticsModal.tsx'
  );
  assert.strictEqual(
    fs.existsSync(diagModalPath),
    false,
    'src/components/player/PlayerDiagnosticsModal.tsx deve permanecer fisicamente excluído'
  );
}

function runC3DiagnosticExportsCleanupSubtest(deps: DeliveryC3FinalCleanupAndRegressionDeps): void {
  const {
    env,
    mediaUtilsModule,
    mediaImageModule,
    virtualWindowModule,
    navigationModule,
    catalogRankingModule,
    playbackHistoryModule,
    liveTvViewModule,
    liveEpgManagerModule,
    tvEnvironmentModule,
  } = deps;
  const windowInstance = env.window;

  // 13.2. Ausência total de exports diagnósticos/contadores removidos e globais window.nc*
  assert.strictEqual('diagnoseImageUrl' in mediaUtilsModule, false, 'mediaUtils não deve exportar diagnoseImageUrl');
  assert.strictEqual('isDebugImagesEnabled' in mediaUtilsModule, false, 'mediaUtils não deve exportar isDebugImagesEnabled');
  assert.strictEqual('setDebugImagesEnabled' in mediaUtilsModule, false, 'mediaUtils não deve exportar setDebugImagesEnabled');
  assert.strictEqual((windowInstance as any).ncDebugImages, undefined, 'window.ncDebugImages não deve existir');
  assert.strictEqual((windowInstance as any).ncTestImage, undefined, 'window.ncTestImage não deve existir');
  assert.strictEqual((windowInstance as any).__NC_DEBUG_IMAGES__, undefined, 'window.__NC_DEBUG_IMAGES__ não deve existir');

  assert.strictEqual('getSharedObserverDiagnostics' in mediaImageModule, false, 'MediaImage não deve exportar getSharedObserverDiagnostics');
  assert.strictEqual('resetSharedObserverPerfStats' in mediaImageModule, false, 'MediaImage não deve exportar resetSharedObserverPerfStats');
  assert.strictEqual('getVirtualWindowDiagnostics' in virtualWindowModule, false, 'useVirtualWindow não deve exportar getVirtualWindowDiagnostics');
  assert.strictEqual('resetVirtualWindowDiagnostics' in virtualWindowModule, false, 'useVirtualWindow não deve exportar resetVirtualWindowDiagnostics');
  assert.strictEqual('getSpatialNavPerfStats' in navigationModule, false, 'navigation não deve exportar getSpatialNavPerfStats');
  assert.strictEqual('resetSpatialNavPerfStats' in navigationModule, false, 'navigation não deve exportar resetSpatialNavPerfStats');
  assert.strictEqual('getCatalogRankingPerfStats' in catalogRankingModule, false, 'catalogRanking não deve exportar getCatalogRankingPerfStats');
  assert.strictEqual('resetCatalogRankingPerfStats' in catalogRankingModule, false, 'catalogRanking não deve exportar resetCatalogRankingPerfStats');
  assert.strictEqual('getPlaybackHistoryPerfStats' in playbackHistoryModule, false, 'playbackHistory não deve exportar getPlaybackHistoryPerfStats');
  assert.strictEqual('resetPlaybackHistoryPerfStats' in playbackHistoryModule, false, 'playbackHistory não deve exportar resetPlaybackHistoryPerfStats');
  assert.strictEqual('getLiveTvRenderStatsForTest' in liveTvViewModule, false, 'LiveTvView não deve exportar getLiveTvRenderStatsForTest');
  assert.strictEqual('resetLiveTvRenderStatsForTest' in liveTvViewModule, false, 'LiveTvView não deve exportar resetLiveTvRenderStatsForTest');
  assert.strictEqual('getLiveEpgStatsForTest' in liveEpgManagerModule, false, 'liveEpgManager não deve exportar getLiveEpgStatsForTest');
  assert.strictEqual('readDisplayEnvironmentDiagnostics' in tvEnvironmentModule, false, 'tvEnvironment não deve exportar readDisplayEnvironmentDiagnostics');
}

function runC3LegitimateTestHelpersPreservationSubtest(
  deps: DeliveryC3FinalCleanupAndRegressionDeps
): void {
  const { getHeroSessionCacheStatsForTest, setAndroidPlatformOverrideForDpadTest } = deps;

  // 13.8. Confirmar helpers de teste legítimos mantidos sob justificativa explícita
  assert.strictEqual(
    typeof getHeroSessionCacheStatsForTest,
    'function',
    'Helper de leitura sob demanda getHeroSessionCacheStatsForTest deve permanecer preservado'
  );
  assert.strictEqual(
    typeof setAndroidPlatformOverrideForDpadTest,
    'function',
    'Helper determinístico setAndroidPlatformOverrideForDpadTest deve permanecer preservado'
  );
}

// ============================================================================
// UTILITÁRIOS DE MÍDIA, CATÁLOGOS E HISTÓRICO (13.4, 13.5, 13.6)
// ============================================================================

function runC3MediaUtilsDirectUrlSubtest(deps: DeliveryC3FinalCleanupAndRegressionDeps): void {
  const { mediaUtilsModule } = deps;

  // 13.4. Preservação funcional de mediaUtils.buildDirectImageUrl
  assert.strictEqual(
    mediaUtilsModule.buildDirectImageUrl('/images/poster.jpg', 'http://provider.tv:8080'),
    'http://provider.tv:8080/images/poster.jpg',
    'buildDirectImageUrl deve resolver caminhos relativos usando serverUrl'
  );
  assert.strictEqual(
    mediaUtilsModule.buildDirectImageUrl('//cdn.example.com/art.png', 'https://provider.tv'),
    'https://cdn.example.com/art.png',
    'buildDirectImageUrl deve resolver URLs protocol-relative'
  );
  assert.strictEqual(
    mediaUtilsModule.buildDirectImageUrl(
      '/api/media/image?url=https%3A%2F%2Fcdn.example.com%2Fcover.jpg&serverUrl=http%3A%2F%2Fprovider.tv',
      'http://provider.tv'
    ),
    'https://cdn.example.com/cover.jpg',
    'buildDirectImageUrl deve extrair URL direta de URLs legadas de proxy'
  );
}

function runC3CatalogRankingSubtest(deps: DeliveryC3FinalCleanupAndRegressionDeps): void {
  const { catalogRankingModule } = deps;

  // 13.5. Preservação funcional de catalogRanking.sortByYearAndRating (determinismo e imutabilidade)
  const rawRankingInput = [
    { name: 'Sem Metadados', rating: '' },
    { name: 'Clássico (2018)', rating: '9.5' },
    { name: 'Lançamento Baixa Nota (2025)', rating: '6.2' },
    { name: 'Lançamento Alta Nota (2025)', rating: '8.9' },
  ];
  const snapshotBeforeSort = rawRankingInput.map((x) => x.name);
  const ranked = catalogRankingModule.sortByYearAndRating(rawRankingInput);
  assert.deepStrictEqual(
    rawRankingInput.map((x) => x.name),
    snapshotBeforeSort,
    'sortByYearAndRating não deve mutar o array original'
  );
  assert.deepStrictEqual(
    ranked.map((x) => x.name),
    [
      'Lançamento Alta Nota (2025)',
      'Lançamento Baixa Nota (2025)',
      'Clássico (2018)',
      'Sem Metadados',
    ],
    'sortByYearAndRating deve ordenar por ano desc, nota desc e itens sem metadados por último'
  );
}

function runC3PlaybackHistorySubtest(deps: DeliveryC3FinalCleanupAndRegressionDeps): void {
  const { playbackHistoryModule } = deps;

  // 13.6. Preservação funcional de playbackHistory (persistência, progresso, limpeza e isolamento por conta)
  playbackHistoryModule.clearPlaybackHistoryMemoryCacheForTest();
  const acctA = { serverUrl: 'http://srv-a.tv:8080', username: 'alice' };
  const acctB = { serverUrl: 'http://srv-b.tv:8080', username: 'bob' };
  const keyA = playbackHistoryModule.getHistoryKey(acctA.serverUrl, acctA.username);
  const keyB = playbackHistoryModule.getHistoryKey(acctB.serverUrl, acctB.username);
  try {
    window.localStorage.removeItem(keyA);
    window.localStorage.removeItem(keyB);

    assert.strictEqual(
      playbackHistoryModule.recordPlaybackPosition(acctA, {
        id: '701',
        type: 'movie',
        positionSec: 425,
      }),
      true,
      'recordPlaybackPosition deve salvar posição válida na conta A'
    );
    assert.strictEqual(
      playbackHistoryModule.getItemProgress(acctA, 'movie', '701'),
      425,
      'getItemProgress deve retornar exatamente 425s para conta A'
    );
    assert.strictEqual(
      playbackHistoryModule.getItemProgress(acctB, 'movie', '701'),
      0,
      'Conta B não deve enxergar progresso gravado na conta A'
    );
    assert.strictEqual(
      playbackHistoryModule.getAccountHistorySnapshot(keyA).length,
      1,
      'Snapshot de histórico da conta A deve listar 1 registro'
    );
    assert.strictEqual(
      playbackHistoryModule.clearItemProgress(acctA, 'movie', '701'),
      true,
      'clearItemProgress deve remover o progresso do item'
    );
    assert.strictEqual(
      playbackHistoryModule.getItemProgress(acctA, 'movie', '701'),
      0,
      'Após clearItemProgress, progresso deve retornar 0'
    );
  } finally {
    window.localStorage.removeItem(keyA);
    window.localStorage.removeItem(keyB);
    playbackHistoryModule.clearPlaybackHistoryMemoryCacheForTest();
  }
}

// ============================================================================
// EPG (13.7)
// ============================================================================

async function runC3LiveEpgManagerSubtest(
  deps: DeliveryC3FinalCleanupAndRegressionDeps
): Promise<void> {
  const { XtreamService, liveEpgManagerModule } = deps;

  // 13.7. Preservação funcional de liveEpgManager (limite de concorrência, deduplicação, cache e cancelamento)
  const originalGetShortEpg = XtreamService.getShortEpg;
  liveEpgManagerModule.resetLiveEpgCacheForTest();
  liveEpgManagerModule.setLiveEpgConcurrencyLimitForTest(2);
  const epgCreds: XtreamCredentials = {
    serverUrl: 'http://epg-c3.tv:8080',
    username: 'epguser',
    password: 'secret',
  };
  let inFlightNow = 0;
  let maxObservedInFlight = 0;
  const epgCallsByStream = new Map<number, number>();
  const resolversByStream = new Map<number, () => void>();

  (XtreamService as any).getShortEpg = (
    _creds: XtreamCredentials,
    streamId: number | string
  ) => {
    const id = Number(streamId);
    epgCallsByStream.set(id, (epgCallsByStream.get(id) || 0) + 1);
    inFlightNow += 1;
    if (inFlightNow > maxObservedInFlight) {
      maxObservedInFlight = inFlightNow;
    }
    return new Promise((resolve) => {
      resolversByStream.set(id, () => {
        inFlightNow -= 1;
        const nowSec = Math.floor(Date.now() / 1000);
        resolve({
          epg_listings: [
            {
              id: `prog-${id}`,
              title: Buffer.from(`Programa ${id}`, 'utf-8').toString('base64'),
              description: Buffer.from(`Desc ${id}`, 'utf-8').toString('base64'),
              start_timestamp: String(nowSec - 300),
              stop_timestamp: String(nowSec + 1800),
            },
          ],
        });
      });
    });
  };

  try {
    const updates501A: string[] = [];
    const updates501B: string[] = [];
    const unsub501A = liveEpgManagerModule.subscribeLiveChannelEpg({
      credentials: epgCreds,
      streamId: 501,
      onUpdate: (snap) => updates501A.push(snap.status),
    });
    // 2ª assinatura simultânea para 501 deve ser deduplicada
    const unsub501B = liveEpgManagerModule.subscribeLiveChannelEpg({
      credentials: epgCreds,
      streamId: 501,
      onUpdate: (snap) => updates501B.push(snap.status),
    });
    const unsub502 = liveEpgManagerModule.subscribeLiveChannelEpg({
      credentials: epgCreds,
      streamId: 502,
      onUpdate: () => {},
    });
    // 503 e 504 entram em fila pois limite de concorrência = 2
    const unsub503 = liveEpgManagerModule.subscribeLiveChannelEpg({
      credentials: epgCreds,
      streamId: 503,
      onUpdate: () => {},
    });
    const unsub504 = liveEpgManagerModule.subscribeLiveChannelEpg({
      credentials: epgCreds,
      streamId: 504,
      onUpdate: () => {},
    });

    // Aguardar microtask de agendamento do liveEpgManager (Promise.resolve().then)
    await new Promise((r) => setTimeout(r, 10));

    assert.strictEqual(
      maxObservedInFlight,
      2,
      `liveEpgManager deve respeitar limite máximo de 2 requisições simultâneas (obtido=${maxObservedInFlight})`
    );
    assert.strictEqual(
      epgCallsByStream.get(501),
      1,
      'Assinaturas simultâneas para o mesmo canal 501 devem ser deduplicadas em 1 requisição'
    );

    // Cancelar 503 enquanto ainda está na fila (não deve disparar rede quando 501/502 terminarem)
    unsub503();

    resolversByStream.get(501)?.();
    await new Promise((r) => setTimeout(r, 15));
    resolversByStream.get(502)?.();
    await new Promise((r) => setTimeout(r, 15));
    resolversByStream.get(504)?.();
    await new Promise((r) => setTimeout(r, 15));

    assert.strictEqual(
      epgCallsByStream.get(503) || 0,
      0,
      'Canal 503 cancelado na fila não deve disparar requisição de rede'
    );
    assert.strictEqual(
      epgCallsByStream.get(504),
      1,
      'Canal 504 na fila deve executar assim que houver slot disponível'
    );
    assert(
      updates501A.includes('ok') && updates501B.includes('ok'),
      'Ambos os assinantes deduplicados do canal 501 devem receber snapshot ok'
    );

    // Nova assinatura em 501 deve ser atendida diretamente pelo cache sem nova chamada de rede
    let cachedStatus = '';
    const unsub501Cached = liveEpgManagerModule.subscribeLiveChannelEpg({
      credentials: epgCreds,
      streamId: 501,
      onUpdate: (snap) => {
        cachedStatus = snap.status;
      },
    });
    assert.strictEqual(cachedStatus, 'ok', 'Cache de EPG deve entregar snapshot ok imediatamente');
    assert.strictEqual(
      epgCallsByStream.get(501),
      1,
      'Hit de cache de EPG não deve disparar nova chamada de rede'
    );

    unsub501A();
    unsub501B();
    unsub502();
    unsub504();
    unsub501Cached();
  } finally {
    (XtreamService as any).getShortEpg = originalGetShortEpg;
    liveEpgManagerModule.setLiveEpgConcurrencyLimitForTest(2);
    liveEpgManagerModule.resetLiveEpgCacheForTest();
  }
}

// ============================================================================
// PLAYER E REPRODUÇÃO (13.3, 13.9, 13.9b, 13.10, 13.11)
// ============================================================================

async function runC3PlayerNoDiagnosticsAndOverlaysSubtest(
  deps: DeliveryC3FinalCleanupAndRegressionDeps
): Promise<void> {
  const { env, hlsMock, VideoPlayer, clearAllBackHandlersForTest, setNavMode, executeBackAction } =
    deps;
  const { React, act } = env;

  // 13.3. VideoPlayer sem botão/menu/overlay de diagnóstico, mantendo controles e overlay de erro reais
  const doc = document;
  const tracked = env.createTrackedRoot();
  const root = tracked.root;
  hlsMock.enable();
  clearAllBackHandlersForTest();
  setNavMode('remote');

  try {
    await act(async () => {
      root.render(
        React.createElement(VideoPlayer, {
          streamUrl: 'http://server.tv:8080/movie/user/pass/9001.m3u8',
          title: 'Filme Teste C3',
          contentType: 'movie',
          onBack: () => {},
        })
      );
      await new Promise((r) => setTimeout(r, 30));
    });

    const playerRoot = doc.querySelector('[data-player-container="true"]') as HTMLElement | null;
    assert(playerRoot, 'VideoPlayer deve montar o container principal');

    assert.strictEqual(
      playerRoot.querySelector('button[data-player-control="diagnostics"]'),
      null,
      'PlayerControls não deve renderizar botão de Diagnóstico Técnico'
    );

    // Abrir submenu de áudio/legendas e voltar para o menu principal de configurações
    const audioSubBtn = playerRoot.querySelector(
      'button[data-player-control="audio-subtitles"]'
    ) as HTMLButtonElement | null;
    assert(audioSubBtn, 'Botão de Áudio e Legendas deve continuar presente');
    await act(async () => {
      audioSubBtn.click();
      await new Promise((r) => setTimeout(r, 20));
    });
    const backToMainBtn = playerRoot.querySelector(
      '[data-settings-back="true"]'
    ) as HTMLButtonElement | null;
    assert(backToMainBtn, 'Botão Voltar do submenu de configurações deve existir');
    await act(async () => {
      backToMainBtn.click();
      await new Promise((r) => setTimeout(r, 20));
    });

    const settingsMenu = playerRoot.querySelector(
      '[data-player-settings-menu="true"]'
    ) as HTMLElement | null;
    assert(settingsMenu, 'Menu principal de configurações do player deve abrir');
    assert.strictEqual(settingsMenu.getAttribute('data-active-submenu'), 'main');
    assert(settingsMenu.querySelector('[data-settings-item="audio"]'), 'Item Áudio deve existir no menu principal');
    assert(settingsMenu.querySelector('[data-settings-item="subtitles"]'), 'Item Legendas deve existir no menu principal');
    assert(settingsMenu.querySelector('[data-settings-item="speed"]'), 'Item Velocidade deve existir no menu principal');
    assert(settingsMenu.querySelector('[data-settings-item="profile"]'), 'Item Perfil de Buffer deve existir no menu principal');
    assert.strictEqual(
      settingsMenu.querySelector('[data-settings-item="diagnostics"]'),
      null,
      'Menu principal de configurações do player não deve conter item Diagnóstico Técnico'
    );
    assert(
      !(settingsMenu.textContent || '').includes('Diagnóstico Técnico'),
      'Menu de configurações do player não deve exibir texto "Diagnóstico Técnico"'
    );

    // Fechar menu de configurações e exibir estado de erro para validar overlay de erro limpo
    await act(async () => {
      executeBackAction();
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () => {
      root.render(
        React.createElement(VideoPlayer, {
          streamUrl: 'http://server.tv:8080/movie/user/pass/9001.m3u8',
          title: 'Filme Teste C3',
          contentType: 'movie',
          errorMessage: 'Falha ao carregar transmissão',
          onBack: () => {},
        })
      );
      await new Promise((r) => setTimeout(r, 30));
    });

    const errorOverlay = playerRoot.querySelector(
      '[data-player-error-overlay="true"]'
    ) as HTMLElement | null;
    assert(errorOverlay, 'Overlay de erro fatal do player deve ser exibido');
    assert(
      errorOverlay.querySelector('[data-player-error-primary="true"]'),
      'Overlay de erro deve preservar o botão Tentar novamente'
    );
    assert.strictEqual(
      errorOverlay.querySelector('[data-player-error-diagnostics="true"]'),
      null,
      'Overlay de erro não deve exibir botão de diagnóstico técnico'
    );
    assert(
      !(errorOverlay.textContent || '').includes('Diagnóstico'),
      'Overlay de erro não deve mencionar diagnóstico técnico'
    );
  } finally {
    await tracked.unmount();
    hlsMock.restore();
    clearAllBackHandlersForTest();
  }
}

async function runC3AudioTrackSelectionSubtest(
  deps: DeliveryC3FinalCleanupAndRegressionDeps
): Promise<void> {
  const {
    env,
    Hls,
    hlsMock,
    VideoPlayer,
    clearAllBackHandlersForTest,
    setNavMode,
    executeBackAction,
  } = deps;
  const { React, act } = env;
  const doc = document;

  // 13.9. Seleção real de faixas de áudio (HLS assíncrono, índice vs id, AUDIO_TRACKS_UPDATED intermediário, evento atrasado, falha honesta, feedback visível, troca de mídia, nativo e vazio)
  {
    const audioTracked = env.createTrackedRoot();
    const audioRoot = audioTracked.root;
    hlsMock.enable();
    clearAllBackHandlersForTest();
    setNavMode('remote');

    // Simular 3 faixas HLS com id de metadados diferente do índice do array (10, 25, 40 vs índices 0, 1, 2)
    hlsMock.setNextInitialTracks({
      audioTracks: [
        {
          id: 10,
          groupId: 'aud',
          name: 'Português',
          lang: 'pt-BR',
          default: true,
          url: 'http://cdn/audio-pt.m3u8',
        },
        {
          id: 25,
          groupId: 'aud',
          name: 'Inglês',
          lang: 'en',
          default: false,
          url: 'http://cdn/audio-en.m3u8',
        },
        {
          id: 40,
          groupId: 'aud',
          name: 'Espanhol',
          lang: 'es',
          default: false,
          url: 'http://cdn/audio-es.m3u8',
        },
      ],
      subtitleTracks: [],
      audioTrack: 0,
      subtitleTrack: -1,
    });

    try {
      await act(async () => {
        audioRoot.render(
          React.createElement(VideoPlayer, {
            streamUrl: 'http://server.tv:8080/movie/user/pass/9100.m3u8',
            title: 'Filme Multi-Áudio HLS',
            contentType: 'movie',
            onBack: () => {},
          })
        );
        await new Promise((r) => setTimeout(r, 30));
      });

      const activeControllers1 = hlsMock.getActiveControllers();
      const hlsCtrl = activeControllers1[activeControllers1.length - 1];
      assert(hlsCtrl, 'Controlador mock HLS deve estar ativo para teste de troca de áudio');
      await act(async () => {
        hlsCtrl.emit(Hls.Events.MANIFEST_PARSED, {
          levels: hlsCtrl.levels,
          audioTracks: hlsCtrl.audioTracks,
          subtitleTracks: hlsCtrl.subtitleTracks,
        });
        await new Promise((r) => setTimeout(r, 15));
      });

      const playerEl = doc.querySelector('[data-player-container="true"]') as HTMLElement;
      assert(playerEl, 'Player multi-áudio HLS deve montar');

      // Abrir menu -> aba Áudio
      const openAudioSub = async () => {
        const audioSubTrigger = playerEl.querySelector(
          'button[data-player-control="audio-subtitles"]'
        ) as HTMLButtonElement;
        assert(audioSubTrigger, 'Botão Áudio e Legendas deve existir');
        await act(async () => {
          audioSubTrigger.click();
          await new Promise((r) => setTimeout(r, 15));
        });
        const audioTab = playerEl.querySelector(
          'button[data-settings-tab="audio"]'
        ) as HTMLButtonElement | null;
        if (audioTab) {
          await act(async () => {
            audioTab.click();
            await new Promise((r) => setTimeout(r, 15));
          });
        }
      };

      await openAudioSub();
      const settingsMenuEl = playerEl.querySelector(
        '[data-player-settings-menu="true"]'
      ) as HTMLElement;
      assert.strictEqual(settingsMenuEl.getAttribute('data-active-submenu'), 'audio');

      const trackBtn0 = playerEl.querySelector('button[data-audio-track-id="0"]') as HTMLButtonElement;
      const trackBtn1 = playerEl.querySelector('button[data-audio-track-id="1"]') as HTMLButtonElement;
      const trackBtn2 = playerEl.querySelector('button[data-audio-track-id="2"]') as HTMLButtonElement;
      assert(trackBtn0 && trackBtn1 && trackBtn2, 'As 3 faixas reais HLS devem ser listadas pelos índices 0, 1 e 2');
      assert.strictEqual(trackBtn0.getAttribute('data-track-active'), 'true', 'Faixa 0 deve iniciar ativa');
      assert.strictEqual(trackBtn1.getAttribute('data-track-active'), 'false', 'Faixa 1 deve iniciar inativa');

      // Tornar a troca assíncrona no mock (não emitir AUDIO_TRACK_SWITCHED imediatamente)
      let assignedHlsIndex = -1;
      const origEmit = hlsCtrl.emit;
      let suppressSyncAudioSwitched = true;
      hlsCtrl.emit = (ev: string, payload?: any) => {
        if (suppressSyncAudioSwitched && ev === Hls.Events.AUDIO_TRACK_SWITCHED) {
          assignedHlsIndex = payload?.id ?? -1;
          return;
        }
        origEmit(ev, payload);
      };

      // 1) Clicar na faixa já ativa (0) não deve criar estado pendente artificial
      await act(async () => {
        trackBtn0.click();
        await new Promise((r) => setTimeout(r, 15));
      });
      assert.strictEqual(
        settingsMenuEl.getAttribute('data-active-submenu'),
        'audio',
        'Submenu de áudio deve permanecer aberto sem fechamento abrupto'
      );
      assert.strictEqual(
        trackBtn0.getAttribute('data-track-pending'),
        'false',
        'Selecionar faixa já ativa não deve criar estado pendente artificial'
      );
      assert.strictEqual(trackBtn0.getAttribute('data-track-active'), 'true');

      // 2) Solicitar troca A (0) -> B (1): submenu permanece aberto e exibe Trocando... visível imediatamente
      await act(async () => {
        trackBtn1.click();
        await new Promise((r) => setTimeout(r, 15));
      });

      assert.strictEqual(
        assignedHlsIndex,
        1,
        'Troca de áudio HLS deve atribuir índice real 1 do array hls.audioTracks (e não id de metadado 25)'
      );
      assert.strictEqual(hlsCtrl.audioTrack, 1, 'Propriedade hls.audioTrack deve refletir índice 1');
      assert.strictEqual(
        settingsMenuEl.getAttribute('data-active-submenu'),
        'audio',
        'Submenu de áudio deve permanecer aberto enquanto a troca está pendente para exibir Trocando...'
      );
      assert.strictEqual(
        playerEl.querySelector('button[data-audio-track-id="1"]')?.getAttribute('data-track-active'),
        'false',
        'Faixa 1 não pode ser confirmada como ativa antes de AUDIO_TRACK_SWITCHED'
      );
      assert.strictEqual(
        playerEl.querySelector('button[data-audio-track-id="1"]')?.getAttribute('data-track-pending'),
        'true',
        'Faixa 1 deve exibir estado pendente visível imediatamente no submenu aberto'
      );
      assert.strictEqual(
        playerEl.querySelector('button[data-audio-track-id="0"]')?.getAttribute('data-track-active'),
        'true',
        'Faixa 0 deve permanecer como ativa confirmada até a troca concluir'
      );

      // 3) AUDIO_TRACKS_UPDATED intermediário durante troca pendente NÃO pode promover faixa 1 a confirmada
      await act(async () => {
        origEmit(Hls.Events.AUDIO_TRACKS_UPDATED, { audioTracks: hlsCtrl.audioTracks });
        await new Promise((r) => setTimeout(r, 15));
      });
      assert.strictEqual(
        playerEl.querySelector('button[data-audio-track-id="1"]')?.getAttribute('data-track-active'),
        'false',
        'AUDIO_TRACKS_UPDATED intermediário não pode confirmar prematuramente a faixa 1'
      );
      assert.strictEqual(
        playerEl.querySelector('button[data-audio-track-id="1"]')?.getAttribute('data-track-pending'),
        'true',
        'Após AUDIO_TRACKS_UPDATED intermediário, faixa 1 deve continuar pendente'
      );
      assert.strictEqual(
        playerEl.querySelector('button[data-audio-track-id="0"]')?.getAttribute('data-track-active'),
        'true',
        'Após AUDIO_TRACKS_UPDATED intermediário, faixa 0 anteriormente confirmada deve continuar ativa'
      );

      // 4) Eventos fora de ordem: usuário solicita C (2) antes de B (1) concluir; confirmação atrasada de B NÃO confirma C
      await act(async () => {
        trackBtn2.click();
        await new Promise((r) => setTimeout(r, 15));
      });
      assert.strictEqual(hlsCtrl.audioTrack, 2, 'hls.audioTrack deve receber índice 2 para faixa C');
      assert.strictEqual(
        playerEl.querySelector('button[data-audio-track-id="2"]')?.getAttribute('data-track-pending'),
        'true',
        'Faixa 2 deve ficar pendente'
      );

      // Confirmação atrasada da faixa B (id 25, url audio-en.m3u8) chega enquanto solicitação atual é C (2)
      await act(async () => {
        origEmit(Hls.Events.AUDIO_TRACK_SWITCHED, {
          id: 25,
          groupId: 'aud',
          name: 'Inglês',
          lang: 'en',
          url: 'http://cdn/audio-en.m3u8',
        });
        await new Promise((r) => setTimeout(r, 15));
      });
      assert.strictEqual(
        playerEl.querySelector('button[data-audio-track-id="2"]')?.getAttribute('data-track-active'),
        'false',
        'Evento atrasado de faixa B não deve confirmar equivocadamente a solicitação mais recente C'
      );
      assert.strictEqual(
        playerEl.querySelector('button[data-audio-track-id="2"]')?.getAttribute('data-track-pending'),
        'true',
        'Solicitação mais recente C deve permanecer pendente após evento atrasado de B'
      );

      // Agora confirmação real da faixa C chega e conclui a troca
      await act(async () => {
        origEmit(Hls.Events.AUDIO_TRACK_SWITCHED, {
          id: 40,
          groupId: 'aud',
          name: 'Espanhol',
          lang: 'es',
          url: 'http://cdn/audio-es.m3u8',
        });
        await new Promise((r) => setTimeout(r, 15));
      });
      assert.strictEqual(
        playerEl.querySelector('button[data-audio-track-id="2"]')?.getAttribute('data-track-active'),
        'true',
        'Após AUDIO_TRACK_SWITCHED correspondente a C, faixa 2 deve ser confirmada como ativa'
      );
      assert.strictEqual(
        playerEl.querySelector('button[data-audio-track-id="2"]')?.getAttribute('data-track-pending'),
        'false',
        'Estado pendente deve encerrar após confirmação de C'
      );
      assert.strictEqual(
        playerEl.querySelector('button[data-audio-track-id="0"]')?.getAttribute('data-track-active'),
        'false',
        'Faixa anterior deve deixar de estar ativa após confirmação de C'
      );

      // 5) Falha não fatal ao carregar faixa B (com hls.audioTrack em B, sem confirmar B e sem afirmar C se engine diverge)
      await act(async () => {
        trackBtn1.click();
        await new Promise((r) => setTimeout(r, 15));
      });
      await act(async () => {
        origEmit(Hls.Events.ERROR, {
          fatal: false,
          type: Hls.ErrorTypes.NETWORK_ERROR,
          details: Hls.ErrorDetails.AUDIO_TRACK_LOAD_ERROR,
        });
        await new Promise((r) => setTimeout(r, 15));
      });
      assert.strictEqual(
        playerEl.querySelector('[data-player-error-overlay="true"]'),
        null,
        'Erro não fatal de faixa de áudio não deve interromper o vídeo'
      );
      assert.strictEqual(
        settingsMenuEl.getAttribute('data-active-submenu'),
        'audio',
        'Submenu de áudio deve permanecer visível exibindo o erro ao usuário'
      );
      assert(
        playerEl.querySelector('[data-audio-track-feedback="true"]'),
        'Falha ao carregar faixa de áudio deve exibir mensagem visível ao usuário'
      );
      assert.strictEqual(
        playerEl.querySelector('button[data-audio-track-id="1"]')?.getAttribute('data-track-pending'),
        'false',
        'Estado pendente deve encerrar após erro de carregamento'
      );
      assert.strictEqual(
        playerEl.querySelector('button[data-audio-track-id="1"]')?.getAttribute('data-track-active'),
        'false',
        'Faixa com erro de carregamento não deve ser marcada como confirmada'
      );
      assert.strictEqual(
        playerEl.querySelector('button[data-audio-track-id="2"]')?.getAttribute('data-track-active'),
        'false',
        'Não deve afirmar que a faixa anterior continua tocando quando hls.audioTrack já divergiu para a faixa com erro'
      );

      // Mesmo se AUDIO_TRACKS_UPDATED ocorrer depois da falha, não deve promover a faixa com falha
      await act(async () => {
        origEmit(Hls.Events.AUDIO_TRACKS_UPDATED, { audioTracks: hlsCtrl.audioTracks });
        await new Promise((r) => setTimeout(r, 15));
      });
      assert.strictEqual(
        playerEl.querySelector('button[data-audio-track-id="1"]')?.getAttribute('data-track-active'),
        'false',
        'AUDIO_TRACKS_UPDATED após falha não pode promover a faixa que falhou'
      );

      // 5b) Faixa solicitada desaparece em AUDIO_TRACKS_UPDATED durante troca pendente -> cancela pendente e informa indisponibilidade
      await act(async () => {
        trackBtn0.click();
        await new Promise((r) => setTimeout(r, 15));
      });
      assert.strictEqual(
        playerEl.querySelector('button[data-audio-track-id="0"]')?.getAttribute('data-track-pending'),
        'true',
        'Faixa 0 deve ficar pendente antes da remoção da lista'
      );
      await act(async () => {
        hlsCtrl.audioTracks = [hlsCtrl.audioTracks[2]];
        hlsCtrl.audioTrack = 0;
        origEmit(Hls.Events.AUDIO_TRACKS_UPDATED, { audioTracks: hlsCtrl.audioTracks });
        await new Promise((r) => setTimeout(r, 15));
      });
      assert.strictEqual(
        playerEl.querySelector('button[data-audio-track-id="0"]')?.getAttribute('data-track-pending'),
        'false',
        'Remoção da faixa pendente deve encerrar estado pendente sem travamento'
      );
      assert(
        playerEl.querySelector('[data-audio-track-feedback="true"]')?.textContent?.includes('não está mais disponível'),
        'Remoção da faixa pendente deve exibir mensagem clara de indisponibilidade'
      );

      // 6) Mudança de mídia durante troca pendente deve limpar estado pendente e descartar callback antigo
      hlsCtrl.audioTracks = [
        { id: 10, groupId: 'aud', name: 'Português', lang: 'pt-BR', default: true, url: 'http://cdn/audio-pt.m3u8' },
        { id: 25, groupId: 'aud', name: 'Inglês', lang: 'en', default: false, url: 'http://cdn/audio-en.m3u8' },
      ];
      await act(async () => {
        origEmit(Hls.Events.AUDIO_TRACKS_UPDATED, { audioTracks: hlsCtrl.audioTracks });
        await new Promise((r) => setTimeout(r, 15));
      });
      await act(async () => {
        (playerEl.querySelector('button[data-audio-track-id="1"]') as HTMLButtonElement).click();
        await new Promise((r) => setTimeout(r, 15));
      });
      assert.strictEqual(
        playerEl.querySelector('button[data-audio-track-id="1"]')?.getAttribute('data-track-pending'),
        'true'
      );

      hlsMock.setNextInitialTracks({
        audioTracks: [
          {
            id: 99,
            groupId: 'aud2',
            name: 'Português',
            lang: 'pt-BR',
            default: true,
            url: 'http://cdn/new-pt.m3u8',
          },
        ],
        subtitleTracks: [],
        audioTrack: 0,
        subtitleTrack: -1,
      });

      await act(async () => {
        audioRoot.render(
          React.createElement(VideoPlayer, {
            streamUrl: 'http://server.tv:8080/movie/user/pass/9101.m3u8',
            title: 'Nova Mídia HLS',
            contentType: 'movie',
            onBack: () => {},
          })
        );
        await new Promise((r) => setTimeout(r, 30));
      });

      const activeControllers2 = hlsMock.getActiveControllers();
      const hlsCtrl2 = activeControllers2[activeControllers2.length - 1];
      assert(hlsCtrl2 && hlsCtrl2 !== hlsCtrl, 'Nova mídia deve inicializar nova instância HLS');
      await act(async () => {
        hlsCtrl2.emit(Hls.Events.MANIFEST_PARSED, {
          levels: hlsCtrl2.levels,
          audioTracks: hlsCtrl2.audioTracks,
          subtitleTracks: hlsCtrl2.subtitleTracks,
        });
        await new Promise((r) => setTimeout(r, 15));
      });

      // Callback atrasado da sessão antiga deve ser ignorado sem transferir estado pendente
      await act(async () => {
        origEmit(Hls.Events.AUDIO_TRACK_SWITCHED, {
          id: 10,
          groupId: 'aud',
          name: 'Português',
          lang: 'pt-BR',
          url: 'http://cdn/audio-pt.m3u8',
        });
        await new Promise((r) => setTimeout(r, 15));
      });

      assert.strictEqual(
        playerEl.querySelector('[data-audio-track-feedback="true"]'),
        null,
        'Mudança de mídia deve limpar feedback de erro da sessão anterior'
      );
      assert(
        playerEl.querySelector('[data-audio-single-note="true"]'),
        'Nova mídia com faixa única deve exibir nota honesta de faixa única sem estado pendente herdado'
      );
      assert.strictEqual(
        playerEl.querySelector('button[data-audio-track-id="0"]')?.getAttribute('data-track-pending'),
        'false',
        'Nova mídia não deve herdar estado pendente da mídia anterior'
      );
    } finally {
      await audioTracked.unmount();
      hlsMock.restore();
      clearAllBackHandlersForTest();
    }

    // 13.9b. Áudio nativo (HTMLMediaElement.audioTracks): leitura real de .enabled e recusa de falsa confirmação
    const nativeTracked = env.createTrackedRoot();
    const nativeRoot = nativeTracked.root;
    clearAllBackHandlersForTest();
    setNavMode('remote');

    try {
      await act(async () => {
        nativeRoot.render(
          React.createElement(VideoPlayer, {
            streamUrl: 'http://server.tv:8080/movie/user/pass/9200.mp4',
            title: 'Filme MP4 Nativo',
            contentType: 'movie',
            onBack: () => {},
          })
        );
        await new Promise((r) => setTimeout(r, 20));
      });

      const playerEl = doc.querySelector('[data-player-container="true"]') as HTMLElement;
      const videoEl = playerEl.querySelector('video') as any;
      assert(videoEl, 'Elemento video deve existir no player nativo');

      // Estado vazio inicial: sem faixas expostas -> estado honesto sem faixas fictícias
      const openNativeAudioSub = async () => {
        const trigger = playerEl.querySelector(
          'button[data-player-control="audio-subtitles"]'
        ) as HTMLButtonElement;
        await act(async () => {
          trigger.click();
          await new Promise((r) => setTimeout(r, 15));
        });
        const audioTab = playerEl.querySelector(
          'button[data-settings-tab="audio"]'
        ) as HTMLButtonElement | null;
        if (audioTab) {
          await act(async () => {
            audioTab.click();
            await new Promise((r) => setTimeout(r, 15));
          });
        }
      };

      await openNativeAudioSub();
      assert(
        playerEl.querySelector('[data-audio-default-only="true"]') &&
          playerEl.querySelector('[data-audio-empty-state="true"]'),
        'Mídia progressiva sem faixas expostas deve informar honestamente ausência de faixas adicionais'
      );

      // Fechar menu, anexar audioTracks nativas reais e disparar loadedmetadata
      await act(async () => {
        executeBackAction();
        await new Promise((r) => setTimeout(r, 15));
      });

      let lockTrack0ReadOnly = false;
      let track0Enabled = true;
      let track1Enabled = false;
      const nativeTrackList: any = [
        {
          id: 't0',
          kind: 'main',
          label: 'Dublado',
          language: 'pt-BR',
          get enabled() {
            return track0Enabled;
          },
          set enabled(v: boolean) {
            if (!lockTrack0ReadOnly) {
              track0Enabled = Boolean(v);
            }
          },
        },
        {
          id: 't1',
          kind: 'alternative',
          label: 'Original',
          language: 'en',
          get enabled() {
            return track1Enabled;
          },
          set enabled(v: boolean) {
            track1Enabled = Boolean(v);
          },
        },
      ];
      Object.defineProperty(videoEl, 'audioTracks', {
        value: nativeTrackList,
        configurable: true,
      });

      await act(async () => {
        videoEl.dispatchEvent(new Event('loadedmetadata'));
        await new Promise((r) => setTimeout(r, 20));
      });

      await openNativeAudioSub();
      const natBtn1 = playerEl.querySelector('button[data-audio-track-id="1"]') as HTMLButtonElement;
      assert(natBtn1, 'Faixa nativa 1 deve ser listada após loadedmetadata');
      await act(async () => {
        natBtn1.click();
        await new Promise((r) => setTimeout(r, 15));
      });
      assert.strictEqual(track1Enabled, true, 'Faixa nativa 1 deve ter enabled=true');
      assert.strictEqual(track0Enabled, false, 'Faixa nativa 0 deve ter enabled=false');
      assert.strictEqual(
        playerEl.querySelector('button[data-audio-track-id="1"]')?.getAttribute('data-track-active'),
        'true',
        'Troca nativa confirmada imediatamente deve ficar visível no submenu aberto'
      );

      // Bloquear escrita em track0 (simulando navegador que ignora alteração de .enabled) e tentar voltar para faixa 0
      lockTrack0ReadOnly = true;
      const natBtn0 = playerEl.querySelector('button[data-audio-track-id="0"]') as HTMLButtonElement;
      await act(async () => {
        natBtn0.click();
        await new Promise((r) => setTimeout(r, 15));
      });
      assert.strictEqual(
        natBtn0.getAttribute('data-track-active'),
        'false',
        'Não deve confirmar falsamente faixa nativa cujo .enabled não mudou para true'
      );
      assert(
        playerEl.querySelector('[data-audio-track-feedback="true"]'),
        'Deve informar feedback visível quando navegador impedir troca de faixa nativa'
      );
    } finally {
      await nativeTracked.unmount();
      clearAllBackHandlersForTest();
    }
  }
}

async function runC3VolumeDpadAndMouseSubtest(
  deps: DeliveryC3FinalCleanupAndRegressionDeps
): Promise<void> {
  const {
    env,
    NavigationProvider,
    VideoPlayer,
    clearAllBackHandlersForTest,
    setNavMode,
    executeBackAction,
  } = deps;
  const { React, act } = env;
  const doc = document;

  // 13.10. Navegação D-Pad no controle de volume sem prisão de foco + edição explícita + preservação de mouse
  const volTracked = env.createTrackedRoot();
  const volRoot = volTracked.root;
  clearAllBackHandlersForTest();
  setNavMode('remote');
  window.localStorage.setItem('nc_player_volume', '0.5');

  let backCalled = false;
  try {
    await act(async () => {
      volRoot.render(
        React.createElement(
          NavigationProvider,
          null,
          React.createElement(VideoPlayer, {
            streamUrl: 'http://server.tv:8080/movie/user/pass/9300.mp4',
            title: 'Filme Teste Volume D-Pad',
            contentType: 'movie',
            onBack: () => {
              backCalled = true;
            },
          })
        )
      );
      await new Promise((r) => setTimeout(r, 30));
    });

    const playerEl = doc.querySelector('[data-player-container="true"]') as HTMLElement;
    assert(playerEl, 'Player de teste de volume deve montar');

    // Geometria horizontal determinística para a fileira inferior no happy-dom
    const orderedControls = [
      'play-pause',
      'seek-back',
      'seek-forward',
      'mute',
      'volume-slider',
      'audio-subtitles',
      'speed',
      'fullscreen',
    ];
    orderedControls.forEach((ctrlName, idx) => {
      const el = playerEl.querySelector(`[data-player-control="${ctrlName}"]`) as HTMLElement | null;
      if (el) {
        const left = 40 + idx * 90;
        el.getBoundingClientRect = () =>
          ({
            left,
            right: left + 60,
            top: 620,
            bottom: 660,
            width: 60,
            height: 40,
            x: left,
            y: 620,
            toJSON: () => {},
          }) as DOMRect;
      }
    });

    const muteBtn = playerEl.querySelector('[data-player-control="mute"]') as HTMLButtonElement;
    const volSlider = playerEl.querySelector(
      'input[data-player-control="volume-slider"]'
    ) as HTMLInputElement;
    const audioSubBtn = playerEl.querySelector(
      '[data-player-control="audio-subtitles"]'
    ) as HTMLButtonElement;
    assert(muteBtn && volSlider && audioSubBtn, 'Controles mute, volume-slider e audio-subtitles devem existir');

    // 1) Focar slider sem modo de edição: ArrowRight NÃO pode prender o foco e NÃO pode alterar volume
    await act(async () => {
      volSlider.focus();
      await new Promise((r) => setTimeout(r, 10));
    });
    assert.strictEqual(volSlider.getAttribute('data-slider-editing'), 'false');
    const initialVol = parseFloat(volSlider.value);

    await act(async () => {
      volSlider.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
      );
      await new Promise((r) => setTimeout(r, 15));
    });
    assert.strictEqual(
      doc.activeElement,
      audioSubBtn,
      'ArrowRight fora do modo de edição deve sair do slider de volume para o controle à direita sem prender foco'
    );
    assert.strictEqual(
      parseFloat(volSlider.value),
      initialVol,
      'Atravessar o slider com ArrowRight não deve alterar o volume acidentalmente'
    );

    // 2) Voltar para o slider e sair pela esquerda com ArrowLeft -> deve ir para mute
    await act(async () => {
      volSlider.focus();
      await new Promise((r) => setTimeout(r, 10));
    });
    await act(async () => {
      volSlider.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
      );
      await new Promise((r) => setTimeout(r, 15));
    });
    assert.strictEqual(
      doc.activeElement,
      muteBtn,
      'ArrowLeft fora do modo de edição deve sair do slider de volume para o botão mute'
    );

    // 3) Entrar no modo explícito de edição com Enter -> ajustar volume -> sair com Voltar sem fechar player
    await act(async () => {
      volSlider.focus();
      await new Promise((r) => setTimeout(r, 10));
    });
    await act(async () => {
      volSlider.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      );
      await new Promise((r) => setTimeout(r, 15));
    });
    assert.strictEqual(
      volSlider.getAttribute('data-slider-editing'),
      'true',
      'Pressionar OK/Enter no slider de volume deve ativar modo de edição'
    );

    await act(async () => {
      volSlider.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
      );
      await new Promise((r) => setTimeout(r, 15));
    });
    assert.strictEqual(
      doc.activeElement,
      volSlider,
      'Durante modo de edição, ArrowRight deve manter o foco no slider enquanto ajusta o volume'
    );
    assert(
      parseFloat(volSlider.value) > initialVol,
      `ArrowRight no modo de edição deve aumentar o volume (antes=${initialVol}, depois=${volSlider.value})`
    );

    await act(async () => {
      executeBackAction();
      await new Promise((r) => setTimeout(r, 15));
    });
    assert.strictEqual(
      volSlider.getAttribute('data-slider-editing'),
      'false',
      'Voltar durante edição de volume deve encerrar o modo de edição'
    );
    assert.strictEqual(
      backCalled,
      false,
      'Voltar durante edição de volume não deve fechar o player'
    );

    // 4) Confirmar saída livre após encerrar edição
    await act(async () => {
      volSlider.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
      );
      await new Promise((r) => setTimeout(r, 15));
    });
    assert.strictEqual(
      doc.activeElement,
      audioSubBtn,
      'Após sair do modo de edição, ArrowRight deve voltar a navegar livremente para a direita'
    );

    // 5) Modo desktop/pointer preserva ajuste direto sem exigir Enter
    setNavMode('pointer');
    const volBeforePointer = parseFloat(volSlider.value);
    await act(async () => {
      volSlider.focus();
      volSlider.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
      );
      await new Promise((r) => setTimeout(r, 15));
    });
    assert(
      parseFloat(volSlider.value) < volBeforePointer,
      'Fora do modo remote, ajuste de teclado no slider deve continuar imediato sem exigir Enter'
    );
  } finally {
    await volTracked.unmount();
    clearAllBackHandlersForTest();
    window.localStorage.removeItem('nc_player_volume');
  }
}

async function runC3PlaybackErrorClassificationSubtest(
  deps: DeliveryC3FinalCleanupAndRegressionDeps
): Promise<void> {
  const { env, Hls, hlsMock, VideoPlayer, clearAllBackHandlersForTest } = deps;
  const { React, act } = env;
  const doc = document;

  // 13.11. Robustez e classificação de erros de reprodução (URL inválida, HLS HTTP 404 imediato, MKV nativo)
  const errTracked = env.createTrackedRoot();
  const errRoot = errTracked.root;
  hlsMock.enable();
  clearAllBackHandlersForTest();

  let finalErrors: string[] = [];
  try {
    // 13.11a. URL malformada deve falhar imediatamente sem carregamento infinito
    await act(async () => {
      errRoot.render(
        React.createElement(VideoPlayer, {
          streamUrl: 'url-malformada-sem-protocolo',
          title: 'URL Inválida',
          contentType: 'movie',
          onBack: () => {},
          onPlaybackFinalError: (msg) => finalErrors.push(msg),
        })
      );
      await new Promise((r) => setTimeout(r, 25));
    });
    const invalidOverlay = doc.querySelector('[data-player-error-overlay="true"]') as HTMLElement | null;
    assert(invalidOverlay, 'URL malformada deve exibir overlay de erro imediatamente');
    assert(
      (invalidOverlay.textContent || '').includes('inválido'),
      'Mensagem de erro para URL malformada deve informar endereço inválido'
    );
    assert(finalErrors.length >= 1, 'onPlaybackFinalError deve ser notificado para URL malformada');

    // 13.11b. HLS fatal HTTP 404 deve classificar como indisponível no provedor sem retries cegos
    finalErrors = [];
    await act(async () => {
      errRoot.render(
        React.createElement(VideoPlayer, {
          streamUrl: 'http://server.tv:8080/series/user/pass/9404.m3u8',
          title: 'Episódio 404',
          contentType: 'episode',
          onBack: () => {},
          onPlaybackFinalError: (msg) => finalErrors.push(msg),
        })
      );
      await new Promise((r) => setTimeout(r, 25));
    });
    const activeControllers = hlsMock.getActiveControllers();
    const hls404Ctrl = activeControllers[activeControllers.length - 1];
    assert(hls404Ctrl, 'Controlador HLS deve existir para teste de HTTP 404');
    await act(async () => {
      hls404Ctrl.emit(Hls.Events.ERROR, {
        fatal: true,
        type: Hls.ErrorTypes.NETWORK_ERROR,
        details: Hls.ErrorDetails.MANIFEST_LOAD_ERROR,
        response: { code: 404 },
      });
      await new Promise((r) => setTimeout(r, 20));
    });
    const hls404Overlay = doc.querySelector('[data-player-error-overlay="true"]') as HTMLElement | null;
    assert(hls404Overlay, 'HLS fatal HTTP 404 deve falhar prontamente sem esperar 3 retries');
    assert(
      (hls404Overlay.textContent || '').includes('HTTP 404'),
      'Erro HLS 404 deve informar claramente indisponibilidade HTTP 404'
    );

    // 13.11c. Erro nativo code 4 em arquivo .mkv deve informar limitação real de contêiner/codec MKV
    await act(async () => {
      errRoot.render(
        React.createElement(VideoPlayer, {
          streamUrl: 'http://server.tv:8080/movie/user/pass/9500.mkv',
          title: 'Filme MKV',
          contentType: 'movie',
          onBack: () => {},
        })
      );
      await new Promise((r) => setTimeout(r, 25));
    });
    const mkvVideo = doc.querySelector('[data-player-container="true"] video') as any;
    assert(mkvVideo, 'Elemento video deve existir para teste de erro MKV');
    Object.defineProperty(mkvVideo, 'error', {
      value: { code: 4 },
      configurable: true,
    });
    await act(async () => {
      mkvVideo.dispatchEvent(new Event('error'));
      await new Promise((r) => setTimeout(r, 20));
    });
    const mkvOverlay = doc.querySelector('[data-player-error-overlay="true"]') as HTMLElement | null;
    assert(mkvOverlay, 'Erro nativo MKV deve exibir overlay de erro');
    assert(
      (mkvOverlay.textContent || '').includes('MKV'),
      'Erro nativo em arquivo .mkv deve mencionar limitação de formato MKV no navegador'
    );
  } finally {
    await errTracked.unmount();
    hlsMock.restore();
    clearAllBackHandlersForTest();
  }
}

// ============================================================================
// 13. ENTREGA C3 — LIMPEZA FINAL DE DIAGNÓSTICOS, CONTADORES E REGRESSÕES
// ============================================================================
export async function runDeliveryC3FinalCleanupAndRegressionTests(
  deps: DeliveryC3FinalCleanupAndRegressionDeps
): Promise<void> {
  console.log('🧪 [13] Testando Entrega C3 (Player sem diagnóstico, módulos limpos, ausência de contadores e regressões)...');

  // Execução preservada na ordem original 13.1 -> 13.11
  runC3StructuralModalExclusionSubtest(); // 13.1
  runC3DiagnosticExportsCleanupSubtest(deps); // 13.2
  await runC3PlayerNoDiagnosticsAndOverlaysSubtest(deps); // 13.3
  runC3MediaUtilsDirectUrlSubtest(deps); // 13.4
  runC3CatalogRankingSubtest(deps); // 13.5
  runC3PlaybackHistorySubtest(deps); // 13.6
  await runC3LiveEpgManagerSubtest(deps); // 13.7
  runC3LegitimateTestHelpersPreservationSubtest(deps); // 13.8
  await runC3AudioTrackSelectionSubtest(deps); // 13.9 e 13.9b
  await runC3VolumeDpadAndMouseSubtest(deps); // 13.10
  await runC3PlaybackErrorClassificationSubtest(deps); // 13.11

  console.log(
    '✅ Entrega C3 + Correções Pós-C3 (áudio real, volume D-Pad, erros de reprodução e EPG assíncrono) validadas!'
  );
}
