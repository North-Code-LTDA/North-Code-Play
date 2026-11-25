import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import type { XtreamCredentials } from '../src/types';
import { createDomTestEnv } from './helpers/domEnv';
import {
  runEssentialTrackAndSecurityTests,
  runWhitePaletteAndControlsIntegrationTests,
} from './direct/player';
import {
  runLiveTvFullscreenAndPreviewTransitionTests,
  runCycle1230dLiveTvLatencyAndFullscreenTests,
} from './direct/live-player';
import { runDeliveryC21CatalogCleanupAndRegressionTests } from './direct/api-transport';
import { runDeliveryC22NativeCleanupAndPreparationTests } from './direct/android-prepare';
import {
  runCycle1230bSpatialNavOptimizationTests,
  runCycle1230cVerticalNavOptimizationTests,
} from './direct/spatial-nav';
import {
  runStep1PersistentImageCacheAndPreloadTests,
  runStep2StartupAndFluidityStabilizationTests,
} from './direct/android-image-cache';
import { runDeliveryAHeroBannerConsolidationTests } from './direct/hero-banner';

const TOTAL_BLOCKS = 13;

const rawCaseFilter = process.env.NC_DIRECT_CASE?.trim();
let selectedCaseNumber: number | null = null;
if (rawCaseFilter) {
  const parsed = Number.parseInt(rawCaseFilter, 10);
  if (!/^\d+$/.test(rawCaseFilter) || parsed < 1 || parsed > TOTAL_BLOCKS) {
    console.error(
      `FALHA em test-direct: filtro inválido NC_DIRECT_CASE="${rawCaseFilter}". Informe um número inteiro entre 1 e ${TOTAL_BLOCKS}.`
    );
    process.exit(1);
  }
  selectedCaseNumber = parsed;
}

// Stub de fetch para arquivos de legenda externos (.srt / .vtt) e transporte sintético
let customFetchResponder: ((url: string) => Promise<Response>) | null = null;

// 1. Inicializar ambiente DOM compartilhado (happy-dom) antes de importar React/HLS/src
const env = await createDomTestEnv({
  url: 'http://localhost:3000',
  width: 1280,
  height: 720,
  watchdogMs: 120000,
  watchdogLabel: 'test-direct',
  rafIntervalMs: 0,
  rafTimestampSource: 'date',
  disableElementAnimate: true,
  stubScrollIntoView: true,
  stubMediaPlayback: true,
  stubResizeObserver: true,
  stubIntersectionObserver: false,
  fetchImpl: (async (input: any) => {
    const url = typeof input === 'string' ? input : input?.url || String(input);
    if (customFetchResponder) {
      return customFetchResponder(url);
    }
    return new Response('Not Found', { status: 404 });
  }) as typeof fetch,
  beforeReactImport: ({ window: win }) => {
    const proto = win.HTMLElement.prototype as any;
    proto.scrollIntoView = function () {};
    proto.scrollTo = function (options?: any, y?: number) {
      if (typeof options === 'object' && options !== null) {
        if (typeof options.top === 'number') this.scrollTop = options.top;
        if (typeof options.left === 'number') this.scrollLeft = options.left;
      } else if (typeof options === 'number') {
        this.scrollLeft = options;
        if (typeof y === 'number') this.scrollTop = y;
      }
    };

    const videoProto = win.HTMLVideoElement.prototype as any;
    videoProto.play = function () {
      return Promise.resolve();
    };
    videoProto.pause = function () {};
    videoProto.load = function () {};
  },
});

const windowInstance = env.window;
const { React, act } = env;

// 2. Importações dinâmicas após bootstrap completo do DOM (evitando hoisting antes de window/document)
let Hls!: (typeof import('hls.js'))['default'];
let redactStreamUrlCredentials!: (typeof import('../src/components/player/trackUtils'))['redactStreamUrlCredentials'];
let formatMediaTrackLabel!: (typeof import('../src/components/player/trackUtils'))['formatMediaTrackLabel'];
let convertSrtToWebVtt!: (typeof import('../src/components/player/trackUtils'))['convertSrtToWebVtt'];
let extractXtreamSubtitles!: (typeof import('../src/components/player/trackUtils'))['extractXtreamSubtitles'];
let VideoPlayer!: (typeof import('../src/components/VideoPlayer'))['VideoPlayer'];
let liveTvViewModule!: typeof import('../src/views/LiveTvView');
let LiveTvView!: (typeof import('../src/views/LiveTvView'))['LiveTvView'];
let XtreamProvider!: (typeof import('../src/context/XtreamContext'))['XtreamProvider'];
let useXtreamSession!: (typeof import('../src/context/XtreamContext'))['useXtreamSession'];
let useXtreamLive!: (typeof import('../src/context/XtreamContext'))['useXtreamLive'];
let useXtreamVod!: (typeof import('../src/context/XtreamContext'))['useXtreamVod'];
let useXtreamSeries!: (typeof import('../src/context/XtreamContext'))['useXtreamSeries'];
let XtreamService!: (typeof import('../src/services/xtreamService'))['XtreamService'];
let executeXtreamGetRequest!: (typeof import('../src/services/httpTransport'))['executeXtreamGetRequest'];
let setTransportTestConfig!: (typeof import('../src/services/httpTransport'))['setTransportTestConfig'];
let getAndroidCatalogAdapterLoadCountForTest!: (typeof import('../src/services/httpTransport'))['getAndroidCatalogAdapterLoadCountForTest'];
let resetAndroidCatalogAdapterLoadCountForTest!: (typeof import('../src/services/httpTransport'))['resetAndroidCatalogAdapterLoadCountForTest'];
let setAndroidCatalogFileAdapterTestOverride!: (typeof import('../src/services/androidCatalogFileAdapter'))['setAndroidCatalogFileAdapterTestOverride'];
let navigationModule!: typeof import('../src/navigation');
let executeBackAction!: (typeof import('../src/navigation'))['executeBackAction'];
let clearAllBackHandlersForTest!: (typeof import('../src/navigation'))['clearAllBackHandlersForTest'];
let setNavMode!: (typeof import('../src/navigation'))['setNavMode'];
let getNavMode!: (typeof import('../src/navigation'))['getNavMode'];
let moveSpatialFocus!: (typeof import('../src/navigation'))['moveSpatialFocus'];
let focusElementSafely!: (typeof import('../src/navigation'))['focusElementSafely'];
let pushFocusMemory!: (typeof import('../src/navigation'))['pushFocusMemory'];
let popFocusMemory!: (typeof import('../src/navigation'))['popFocusMemory'];
let clearFocusMemory!: (typeof import('../src/navigation'))['clearFocusMemory'];
let setFastHorizontalRowNavEnabledForTest!: (typeof import('../src/navigation'))['setFastHorizontalRowNavEnabledForTest'];
let setFastVerticalNavEnabledForTest!: (typeof import('../src/navigation'))['setFastVerticalNavEnabledForTest'];
let registerShowcaseRowController!: (typeof import('../src/navigation'))['registerShowcaseRowController'];
let unregisterShowcaseRowController!: (typeof import('../src/navigation'))['unregisterShowcaseRowController'];
let registerVirtualContainer!: (typeof import('../src/navigation'))['registerVirtualContainer'];
let unregisterVirtualContainer!: (typeof import('../src/navigation'))['unregisterVirtualContainer'];
let invalidateCandidateCache!: (typeof import('../src/navigation'))['invalidateCandidateCache'];
let NavigationProvider!: (typeof import('../src/navigation'))['NavigationProvider'];
let isAndroidCapacitorPlatform!: (typeof import('../src/navigation'))['isAndroidCapacitorPlatform'];
let setAndroidPlatformOverrideForDpadTest!: (typeof import('../src/navigation'))['setAndroidPlatformOverrideForDpadTest'];
let getDpadNavigationBehaviorMode!: (typeof import('../src/navigation'))['getDpadNavigationBehaviorMode'];
let isDpadOptimizedPathActive!: (typeof import('../src/navigation'))['isDpadOptimizedPathActive'];
let HorizontalRow!: (typeof import('../src/components/HorizontalRow'))['HorizontalRow'];
let mediaImageModule!: typeof import('../src/components/MediaImage');
let MediaImage!: (typeof import('../src/components/MediaImage'))['MediaImage'];
let setMediaImageRetryDelayMsForTest!: (typeof import('../src/components/MediaImage'))['setMediaImageRetryDelayMsForTest'];
let CatalogShowcaseView!: (typeof import('../src/components/CatalogShowcaseView'))['CatalogShowcaseView'];
let HeroBanner!: (typeof import('../src/components/HeroBanner'))['HeroBanner'];
let MovieDetails!: (typeof import('../src/components/MovieDetails'))['MovieDetails'];
let SeriesDetails!: (typeof import('../src/components/SeriesDetails'))['SeriesDetails'];
let clearHeroSessionCache!: (typeof import('../src/services/heroSessionCache'))['clearHeroSessionCache'];
let fetchOrReuseHeroDetails!: (typeof import('../src/services/heroSessionCache'))['fetchOrReuseHeroDetails'];
let getCachedHeroDetails!: (typeof import('../src/services/heroSessionCache'))['getCachedHeroDetails'];
let getHeroSessionCacheStatsForTest!: (typeof import('../src/services/heroSessionCache'))['getHeroSessionCacheStatsForTest'];
let ConfigView!: (typeof import('../src/views/ConfigView'))['ConfigView'];
let computeHeroItemsFromList!: (typeof import('../src/utils/catalogIndex'))['computeHeroItemsFromList'];
let getHeroBannerItems!: (typeof import('../src/utils/catalogIndex'))['getHeroBannerItems'];
let getOrCreateVodIndex!: (typeof import('../src/utils/catalogIndex'))['getOrCreateVodIndex'];
let catalogIndexModule!: typeof import('../src/utils/catalogIndex');
let androidImageCacheModule!: typeof import('../src/services/androidImageCache');
let createSimulatedPersistentImageDiskHarness!: (typeof import('../src/services/androidImageCache'))['createSimulatedPersistentImageDiskHarness'];
let createValidTestJpegBytes!: (typeof import('../src/services/androidImageCache'))['createValidTestJpegBytes'];
let acquireCachedImage!: (typeof import('../src/services/androidImageCache'))['acquireCachedImage'];
let getInstantCachedImageSrc!: (typeof import('../src/services/androidImageCache'))['getInstantCachedImageSrc'];
let configureImageCacheStorageBudget!: (typeof import('../src/services/androidImageCache'))['configureImageCacheStorageBudget'];
let clearImageCacheOnLogout!: (typeof import('../src/services/androidImageCache'))['clearImageCacheOnLogout'];
let buildHomeStartupImagePlan!: (typeof import('../src/services/androidImageCache'))['buildHomeStartupImagePlan'];
let executeHomeStartupImagePreparation!: (typeof import('../src/services/androidImageCache'))['executeHomeStartupImagePreparation'];
let recordVisitedShowcaseCategory!: (typeof import('../src/services/androidImageCache'))['recordVisitedShowcaseCategory'];
let getVisitedShowcaseCategories!: (typeof import('../src/services/androidImageCache'))['getVisitedShowcaseCategories'];
let isAndroidPersistentImageCacheAvailable!: (typeof import('../src/services/androidImageCache'))['isAndroidPersistentImageCacheAvailable'];
let extractCatalogItemRawImage!: (typeof import('../src/services/androidImageCache'))['extractCatalogItemRawImage'];
let isVideoPlaybackThrottlingActiveForTest!: (typeof import('../src/services/androidImageCache'))['isVideoPlaybackThrottlingActiveForTest'];
let setCatalogTransferPhaseActiveForImageCache!: (typeof import('../src/services/androidImageCache'))['setCatalogTransferPhaseActiveForImageCache'];
let isCatalogTransferPhaseActiveForImageCache!: (typeof import('../src/services/androidImageCache'))['isCatalogTransferPhaseActiveForImageCache'];
let scheduleBackgroundLowPriorityPreload!: (typeof import('../src/services/androidImageCache'))['scheduleBackgroundLowPriorityPreload'];
let mediaUtilsModule!: typeof import('../src/utils/mediaUtils');
let virtualWindowModule!: typeof import('../src/hooks/useVirtualWindow');
let catalogRankingModule!: typeof import('../src/utils/catalogRanking');
let playbackHistoryModule!: typeof import('../src/utils/playbackHistory');
let liveEpgManagerModule!: typeof import('../src/utils/liveEpgManager');
let tvEnvironmentModule!: typeof import('../src/platform/tvEnvironment');
let APP_COMMIT!: (typeof import('../src/version'))['APP_COMMIT'];
let APP_VERSION!: (typeof import('../src/version'))['APP_VERSION'];
let formatCommitShort!: (typeof import('../src/version'))['formatCommitShort'];

try {
  ({ default: Hls } = await import('hls.js'));
  ({
    redactStreamUrlCredentials,
    formatMediaTrackLabel,
    convertSrtToWebVtt,
    extractXtreamSubtitles,
  } = await import('../src/components/player/trackUtils'));
  ({ VideoPlayer } = await import('../src/components/VideoPlayer'));
  liveTvViewModule = await import('../src/views/LiveTvView');
  ({ LiveTvView } = liveTvViewModule);
  ({
    XtreamProvider,
    useXtreamSession,
    useXtreamLive,
    useXtreamVod,
    useXtreamSeries,
  } = await import('../src/context/XtreamContext'));
  ({ XtreamService } = await import('../src/services/xtreamService'));
  ({
    executeXtreamGetRequest,
    setTransportTestConfig,
    getAndroidCatalogAdapterLoadCountForTest,
    resetAndroidCatalogAdapterLoadCountForTest,
  } = await import('../src/services/httpTransport'));
  ({ setAndroidCatalogFileAdapterTestOverride } = await import(
    '../src/services/androidCatalogFileAdapter'
  ));
  navigationModule = await import('../src/navigation');
  ({
    executeBackAction,
    clearAllBackHandlersForTest,
    setNavMode,
    getNavMode,
    moveSpatialFocus,
    focusElementSafely,
    pushFocusMemory,
    popFocusMemory,
    clearFocusMemory,
    setFastHorizontalRowNavEnabledForTest,
    setFastVerticalNavEnabledForTest,
    registerShowcaseRowController,
    unregisterShowcaseRowController,
    registerVirtualContainer,
    unregisterVirtualContainer,
    invalidateCandidateCache,
    NavigationProvider,
    isAndroidCapacitorPlatform,
    setAndroidPlatformOverrideForDpadTest,
    getDpadNavigationBehaviorMode,
    isDpadOptimizedPathActive,
  } = navigationModule);
  ({ HorizontalRow } = await import('../src/components/HorizontalRow'));
  mediaImageModule = await import('../src/components/MediaImage');
  ({ MediaImage, setMediaImageRetryDelayMsForTest } = mediaImageModule);
  ({ CatalogShowcaseView } = await import('../src/components/CatalogShowcaseView'));
  ({ HeroBanner } = await import('../src/components/HeroBanner'));
  ({ MovieDetails } = await import('../src/components/MovieDetails'));
  ({ SeriesDetails } = await import('../src/components/SeriesDetails'));
  ({
    clearHeroSessionCache,
    fetchOrReuseHeroDetails,
    getCachedHeroDetails,
    getHeroSessionCacheStatsForTest,
  } = await import('../src/services/heroSessionCache'));
  ({ ConfigView } = await import('../src/views/ConfigView'));
  catalogIndexModule = await import('../src/utils/catalogIndex');
  ({
    computeHeroItemsFromList,
    getHeroBannerItems,
    getOrCreateVodIndex,
  } = catalogIndexModule);
  androidImageCacheModule = await import('../src/services/androidImageCache');
  ({
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
    setCatalogTransferPhaseActiveForImageCache,
    isCatalogTransferPhaseActiveForImageCache,
    scheduleBackgroundLowPriorityPreload,
  } = androidImageCacheModule);
  mediaUtilsModule = await import('../src/utils/mediaUtils');
  virtualWindowModule = await import('../src/hooks/useVirtualWindow');
  catalogRankingModule = await import('../src/utils/catalogRanking');
  playbackHistoryModule = await import('../src/utils/playbackHistory');
  liveEpgManagerModule = await import('../src/utils/liveEpgManager');
  tvEnvironmentModule = await import('../src/platform/tvEnvironment');
  ({ APP_COMMIT, APP_VERSION, formatCommitShort } = await import('../src/version'));
} catch (importError) {
  const cleanupErrors = await env.dispose();
  if (cleanupErrors.length > 0) {
    console.error('Erros adicionais ao limpar ambiente após falha de importação:', cleanupErrors);
  }
  throw importError;
}

// Mock determinístico para HLS.js
interface MockHlsController {
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

let activeHlsControllers: MockHlsController[] = [];
let nextHlsInitialTracks: {
  audioTracks?: any[];
  subtitleTracks?: any[];
  audioTrack?: number;
  subtitleTrack?: number;
} = {};

const originalHlsIsSupported = Hls.isSupported;
const originalHlsLoadSource = Hls.prototype.loadSource;
const originalHlsAttachMedia = Hls.prototype.attachMedia;
const originalHlsOn = Hls.prototype.on;
const originalHlsDestroy = Hls.prototype.destroy;

function enableDeterministicHlsMock() {
  activeHlsControllers = [];
  (Hls as any).isSupported = () => true;

  Hls.prototype.on = function (this: any, event: any, cb: any, context?: any) {
    if (context !== undefined) {
      return originalHlsOn.call(this, event, cb, context);
    }
    if (!this.__mockCtrl) {
      const ctrl: MockHlsController = {
        audioTracks: nextHlsInitialTracks.audioTracks ? [...nextHlsInitialTracks.audioTracks] : [],
        subtitleTracks: nextHlsInitialTracks.subtitleTracks
          ? [...nextHlsInitialTracks.subtitleTracks]
          : [],
        audioTrack: nextHlsInitialTracks.audioTrack ?? 0,
        subtitleTrack: nextHlsInitialTracks.subtitleTrack ?? -1,
        subtitleDisplay: (nextHlsInitialTracks.subtitleTrack ?? -1) !== -1,
        levels: [{ height: 1080, width: 1920, bitrate: 5000000 }],
        currentLevel: -1,
        listeners: new Map(),
        emit(ev: string, payload: any = {}) {
          const set = ctrl.listeners.get(ev);
          if (set) {
            for (const fn of Array.from(set)) {
              fn(ev, payload);
            }
          }
        },
      };
      this.__mockCtrl = ctrl;
      activeHlsControllers.push(ctrl);

      Object.defineProperty(this, 'audioTracks', {
        get: () => ctrl.audioTracks,
        configurable: true,
      });
      Object.defineProperty(this, 'subtitleTracks', {
        get: () => ctrl.subtitleTracks,
        configurable: true,
      });
      Object.defineProperty(this, 'audioTrack', {
        get: () => ctrl.audioTrack,
        set: (val: number) => {
          ctrl.audioTrack = val;
          ctrl.emit(Hls.Events.AUDIO_TRACK_SWITCHED, { id: val });
        },
        configurable: true,
      });
      Object.defineProperty(this, 'subtitleTrack', {
        get: () => ctrl.subtitleTrack,
        set: (val: number) => {
          ctrl.subtitleTrack = val;
          ctrl.emit(Hls.Events.SUBTITLE_TRACK_SWITCH, { id: val });
        },
        configurable: true,
      });
      Object.defineProperty(this, 'subtitleDisplay', {
        get: () => ctrl.subtitleDisplay,
        set: (val: boolean) => {
          ctrl.subtitleDisplay = Boolean(val);
        },
        configurable: true,
      });
      Object.defineProperty(this, 'levels', {
        get: () => ctrl.levels,
        configurable: true,
      });
      Object.defineProperty(this, 'currentLevel', {
        get: () => ctrl.currentLevel,
        set: (val: number) => {
          ctrl.currentLevel = val;
        },
        configurable: true,
      });
    }

    const ctrl: MockHlsController = this.__mockCtrl;
    if (!ctrl.listeners.has(event)) {
      ctrl.listeners.set(event, new Set());
    }
    ctrl.listeners.get(event)!.add(cb);
    return this;
  };

  Hls.prototype.loadSource = function (this: any, _url: string) {};
  Hls.prototype.attachMedia = function (this: any, _media: HTMLMediaElement) {
    const ctrl: MockHlsController | undefined = this.__mockCtrl;
    if (ctrl) {
      setTimeout(() => {
        ctrl.emit(Hls.Events.MANIFEST_PARSED, {
          levels: ctrl.levels,
          audioTracks: ctrl.audioTracks,
          subtitleTracks: ctrl.subtitleTracks,
        });
      }, 0);
    }
  };
  Hls.prototype.destroy = function (this: any) {
    if (this.__mockCtrl) {
      this.__mockCtrl.listeners.clear();
    }
  };
}

function restoreHlsMock() {
  (Hls as any).isSupported = originalHlsIsSupported;
  Hls.prototype.loadSource = originalHlsLoadSource;
  Hls.prototype.attachMedia = originalHlsAttachMedia;
  Hls.prototype.on = originalHlsOn;
  Hls.prototype.destroy = originalHlsDestroy;
  activeHlsControllers = [];
  nextHlsInitialTracks = {};
}

const hlsMockControl = {
  enable: enableDeterministicHlsMock,
  restore: restoreHlsMock,
  getActiveControllers: () => activeHlsControllers,
  setNextInitialTracks: (tracks: {
    audioTracks?: any[];
    subtitleTracks?: any[];
    audioTrack?: number;
    subtitleTrack?: number;
  }) => {
    nextHlsInitialTracks = tracks;
  },
};

async function runSharedStateResetSteps(): Promise<Error[]> {
  const errors: Error[] = [];
  const steps: Array<{ label: string; run: () => void | Promise<void> }> = [
    { label: 'restoreHlsMock', run: () => restoreHlsMock() },
    {
      label: 'customFetchResponder',
      run: () => {
        customFetchResponder = null;
      },
    },
    { label: 'clearAllBackHandlersForTest', run: () => clearAllBackHandlersForTest() },
    { label: 'clearFocusMemory', run: () => clearFocusMemory() },
    { label: 'invalidateCandidateCache', run: () => invalidateCandidateCache() },
    {
      label: 'setAndroidPlatformOverrideForDpadTest',
      run: () => setAndroidPlatformOverrideForDpadTest(null),
    },
    {
      label: 'setAndroidCatalogFileAdapterTestOverride',
      run: () => setAndroidCatalogFileAdapterTestOverride({ plugin: null, convertFileSrc: null }),
    },
    {
      label: 'setTransportTestConfig',
      run: () =>
        setTransportTestConfig({
          mode: 'auto',
          capacitorHttpGet: null,
          androidCatalogPluginAvailable: null,
        }),
    },
    {
      label: 'setCatalogTransferPhaseActiveForImageCache',
      run: () => setCatalogTransferPhaseActiveForImageCache(false),
    },
    { label: 'clearHeroSessionCache', run: () => clearHeroSessionCache() },
  ];

  for (const step of steps) {
    try {
      await step.run();
    } catch (err) {
      errors.push(
        err instanceof Error
          ? err
          : new Error(`Falha ao resetar estado compartilhado (${step.label}): ${String(err)}`)
      );
    }
  }
  return errors;
}

env.registerCleanup(async () => {
  const resetErrors = await runSharedStateResetSteps();
  if (resetErrors.length > 0) {
    throw resetErrors[0];
  }
});


// Blocos 1 e 3 extraídos para scripts/direct/player.ts
// Bloco 2 extraído para scripts/direct/live-player.ts
// Blocos 4 e 5 (e helpers measureDomCalls*) extraídos para scripts/direct/spatial-nav.ts
// Bloco 6 extraído para scripts/direct/live-player.ts
// Blocos 7 e 8 extraídos para scripts/direct/android-image-cache.ts

// ============================================================================
// 9. ETAPA 3 — FLUIDEZ DO D-PAD, REPETIÇÃO DE TECLAS, LIMITES DE VIRTUALIZAÇÃO E DIAGNÓSTICO
// ============================================================================
async function runStep3DpadFluidityAndDiagnosticsTests(): Promise<void> {
  console.log(
    '--- 9. Etapa 3: Fluidez do D-Pad, Repetição de Teclas, Limites de Virtualização e Diagnóstico ---'
  );

  let customResponderFn: ((url: string) => {
    status?: number;
    contentType?: string;
    bodyBytes?: Uint8Array;
    delayMs?: number;
  } | null) | null = null;
  const harness = createSimulatedPersistentImageDiskHarness({
    initialMaxBytes: 30 * 1024 * 1024,
    customResponder: (url) => (customResponderFn ? customResponderFn(url) : null),
  });
  harness.install();
  setMediaImageRetryDelayMsForTest(30);

  const tracked = env.createTrackedRoot();
  const container = tracked.host;
  const root = tracked.root;

  const mockCreds: XtreamCredentials = {
    serverUrl: 'http://provider.dpad-fluidity.tv:8080',
    username: 'user_dpad',
    password: 'pass_dpad',
  };

  const originalAuthenticate = XtreamService.authenticate;
  (XtreamService as any).authenticate = async () => ({
    user_info: {
      username: 'user_dpad',
      status: 'Active',
      exp_date: '1893456000',
      max_connections: '2',
      active_cons: '1',
    },
    server_info: {
      url: 'provider.dpad-fluidity.tv',
      port: '8080',
      server_protocol: 'http',
    },
  });

  try {
    // -------------------------------------------------------------------------
    // 9.1. Política definitiva por plataforma (Web = padrão, Android = otimizado)
    //      desacoplada de qualquer diagnóstico e imune a chaves legadas de localStorage
    // -------------------------------------------------------------------------
    const policySource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/navigation/navigationPlatformPolicy.ts'),
      'utf8'
    );
    assert(
      !policySource.includes('dpadFluidityDiagnostics'),
      'navigationPlatformPolicy.ts não deve depender de dpadFluidityDiagnostics.ts'
    );
    assert.strictEqual(
      fs.existsSync(path.resolve(process.cwd(), 'src/navigation/dpadFluidityDiagnostics.ts')),
      false,
      'dpadFluidityDiagnostics.ts deve ter sido excluído fisicamente na Entrega C1'
    );

    setAndroidPlatformOverrideForDpadTest(false);
    window.localStorage.setItem('nc_dpad_nav_behavior_mode_v1', 'optimized');

    assert.strictEqual(
      isAndroidCapacitorPlatform(),
      false,
      'No ambiente Web padrão (sem override Android), isAndroidCapacitorPlatform deve retornar false'
    );
    assert.strictEqual(
      getDpadNavigationBehaviorMode(),
      'current',
      'No ambiente Web, a política deve permanecer definitivamente current mesmo se localStorage contiver optimized legado'
    );
    assert.strictEqual(
      isDpadOptimizedPathActive(),
      false,
      'No ambiente Web, isDpadOptimizedPathActive deve retornar false'
    );

    // Simular Capacitor Android nativo com chave legada 'current' no localStorage
    setAndroidPlatformOverrideForDpadTest(true);
    window.localStorage.setItem('nc_dpad_nav_behavior_mode_v1', 'current');

    assert.strictEqual(
      isAndroidCapacitorPlatform(),
      true,
      'Em Capacitor Android nativo, isAndroidCapacitorPlatform deve retornar true'
    );
    assert.strictEqual(
      getDpadNavigationBehaviorMode(),
      'optimized',
      'Em Capacitor Android nativo, a política deve ser definitivamente optimized ignorando localStorage legado current'
    );
    assert.strictEqual(
      isDpadOptimizedPathActive(),
      true,
      'Em Capacitor Android nativo, isDpadOptimizedPathActive deve sempre retornar true'
    );

    // -------------------------------------------------------------------------
    // 9.2. Navegação D-Pad com teclas repetidas (e.repeat), coalescência de
    //      48ms e mudança rápida de direção
    // -------------------------------------------------------------------------

    // Montar uma grade controlada dentro do NavigationProvider para testar eventos reais de teclado (incluindo e.repeat)
    const assignRect = (el: HTMLElement, left: number, top: number, width: number, height: number) => {
      el.getBoundingClientRect = () =>
        ({
          left,
          top,
          right: left + width,
          bottom: top + height,
          width,
          height,
          x: left,
          y: top,
          toJSON: () => {},
        }) as DOMRect;
    };

    await act(async () => {
      root.render(
        React.createElement(
          NavigationProvider,
          null,
          React.createElement(
            'div',
            { 'data-nav-grid': 'true' },
            Array.from({ length: 6 }, (_, rowIdx) =>
              React.createElement(
                'div',
                {
                  key: `r_${rowIdx}`,
                  'data-home-row-index': String(rowIdx),
                  'data-scroll-block': 'true',
                },
                React.createElement(
                  'div',
                  { 'data-nav-row': 'true' },
                  Array.from({ length: 4 }, (__, colIdx) =>
                    React.createElement(
                      'button',
                      {
                        key: `btn_${rowIdx}_${colIdx}`,
                        id: `dpad-grid-btn-${rowIdx}-${colIdx}`,
                        tabIndex: 0,
                        'data-nav-item': 'true',
                        'data-row-card-index': String(colIdx),
                      },
                      `Item ${rowIdx}-${colIdx}`
                    )
                  )
                )
              )
            )
          )
        )
      );
      await new Promise((r) => setTimeout(r, 20));
    });

    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 4; c++) {
        const btn = container.querySelector(`#dpad-grid-btn-${r}-${c}`) as HTMLElement | null;
        assert(btn, `Botão #dpad-grid-btn-${r}-${c} deve estar montado`);
        assignRect(btn, 80 + c * 220, 80 + r * 110, 200, 90);
      }
    }
    invalidateCandidateCache();

    const firstBtn = container.querySelector('#dpad-grid-btn-0-0') as HTMLElement;
    focusElementSafely(firstBtn);
    assert.strictEqual(document.activeElement, firstBtn, 'Foco inicial deve estar em 0-0');

    // Disparar ArrowDown inicial e verificar movimento funcional
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    );
    assert.strictEqual(
      (document.activeElement as HTMLElement)?.id,
      'dpad-grid-btn-1-0',
      'ArrowDown deve mover o foco para 1-0'
    );

    // Testar rajada de teclas repetidas (e.repeat = true) e mudança rápida de direção

    // Disparar 1º repeat ArrowDown (deve executar imediatamente: 1-0 -> 2-0)
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        repeat: true,
        bubbles: true,
        cancelable: true,
      } as any)
    );
    assert.strictEqual(
      (document.activeElement as HTMLElement)?.id,
      'dpad-grid-btn-2-0',
      'O primeiro evento repeat ArrowDown deve avançar imediatamente de 1-0 para 2-0'
    );

    // Disparar 2º repeat ArrowDown imediatamente (< 48ms na mesma direção): deve ser coalescido pelo throttle de 48ms
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        repeat: true,
        bubbles: true,
        cancelable: true,
      } as any)
    );
    assert.strictEqual(
      (document.activeElement as HTMLElement)?.id,
      'dpad-grid-btn-2-0',
      'Um evento repeat na mesma direção dentro da janela de 48ms deve ser coalescido de forma previsível'
    );

    // Mudança imediata de direção em repeat (ArrowRight) mesmo dentro dos 48ms: NÃO deve ser bloqueada!
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        repeat: true,
        bubbles: true,
        cancelable: true,
      } as any)
    );
    assert.strictEqual(
      (document.activeElement as HTMLElement)?.id,
      'dpad-grid-btn-2-1',
      'Mudança rápida de direção (ArrowDown -> ArrowRight) deve responder imediatamente sem descarte pelo throttle da direção anterior'
    );

    // Outra mudança imediata de direção (ArrowUp): 2-1 -> 1-1
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        repeat: false,
        bubbles: true,
        cancelable: true,
      } as any)
    );
    assert.strictEqual(
      (document.activeElement as HTMLElement)?.id,
      'dpad-grid-btn-1-1',
      'Mudança rápida para ArrowUp deve mover imediatamente de 2-1 para 1-1'
    );

    // Aguardar > 55ms e enviar novo repeat na mesma direção: deve avançar normalmente
    await new Promise((r) => setTimeout(r, 55));
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        repeat: true,
        bubbles: true,
        cancelable: true,
      } as any)
    );
    assert.strictEqual(
      (document.activeElement as HTMLElement)?.id,
      'dpad-grid-btn-0-1',
      'Após 48ms, novo repeat na mesma direção deve avançar normalmente de 1-1 para 0-1'
    );

    // -------------------------------------------------------------------------
    // 9.3. Preservação do foco ao cruzar limites de virtualização em CatalogShowcaseView
    //      (Comparação entre Comportamento atual e Comportamento otimizado +
    //       Integridade da apresentação e dos carrosséis)
    // -------------------------------------------------------------------------
    const showcaseCategories = Array.from({ length: 14 }, (_, idx) => ({
      category_id: String(500 + idx),
      category_name: `Categoria Fluidez ${idx + 1}`,
    }));
    const showcaseStreams = showcaseCategories.flatMap((cat, catIdx) =>
      Array.from({ length: 10 }, (_, itemIdx) => ({
        stream_id: 50000 + catIdx * 100 + itemIdx,
        name: `Filme Fluidez Cat ${catIdx + 1} #${itemIdx + 1}`,
        category_id: cat.category_id,
        stream_icon: `http://img.provider.tv/dpad_fluidity/cat_${catIdx}_item_${itemIdx}.jpg`,
        rating: String((7.0 + (itemIdx % 3) * 0.5).toFixed(1)),
        added: String(1700000000 + itemIdx * 3600),
        year: '2025',
      }))
    );

    const assignShowcaseDomGeometry = (rootEl: HTMLElement) => {
      const scrollHost = rootEl.querySelector('main[data-scroll-container="true"]') as HTMLElement | null;
      if (scrollHost) {
        assignRect(scrollHost, 0, 0, 1280, 720);
      }
      const rowBlocks = Array.from(
        rootEl.querySelectorAll('[data-home-row-index]')
      ) as HTMLElement[];
      for (const block of rowBlocks) {
        const rIdx = Number(block.getAttribute('data-home-row-index') ?? '0');
        const rowTop = 120 + rIdx * 320;
        assignRect(block, 40, rowTop, 1200, 300);

        const navRow = block.querySelector('[data-nav-row="true"]') as HTMLElement | null;
        if (navRow) {
          assignRect(navRow, 40, rowTop + 40, 1200, 240);
          const cards = Array.from(
            navRow.querySelectorAll('[data-row-card-index]')
          ) as HTMLElement[];
          for (const card of cards) {
            const cIdx = Number(card.getAttribute('data-row-card-index') ?? '0');
            assignRect(card, 60 + cIdx * 200, rowTop + 50, 180, 220);
          }
        }
      }
      invalidateCandidateCache();
    };

    for (const platformUnderTest of [
      { label: 'web', isAndroid: false, expectedMode: 'current' as const },
      { label: 'android', isAndroid: true, expectedMode: 'optimized' as const },
    ]) {
      setAndroidPlatformOverrideForDpadTest(platformUnderTest.isAndroid);
      assert.strictEqual(
        getDpadNavigationBehaviorMode(),
        platformUnderTest.expectedMode,
        `Plataforma ${platformUnderTest.label} deve operar no modo ${platformUnderTest.expectedMode}`
      );

      await act(async () => {
        root.render(
          React.createElement(
            NavigationProvider,
            null,
            React.createElement(
              XtreamProvider,
              { credentials: mockCreds },
              React.createElement(CatalogShowcaseView, {
                key: `showcase_${platformUnderTest.label}`,
                section: 'movies',
                credentials: mockCreds,
                onPlay: () => {},
                vodCategories: showcaseCategories,
                vodStreams: showcaseStreams,
                allVodStreams: showcaseStreams,
                seriesCategories: [],
                seriesStreams: [],
                allSeriesStreams: [],
                sessionReady: true,
              })
            )
          )
        );
        await new Promise((r) => setTimeout(r, 40));
      });

      assignShowcaseDomGeometry(container);

      const rowsContainer = container.querySelector(
        '[data-showcase-rows-container="true"]'
      ) as HTMLElement | null;
      assert(rowsContainer, `Container de fileiras deve existir na plataforma ${platformUnderTest.label}`);
      assert.strictEqual(
        rowsContainer.getAttribute('data-showcase-virtualized'),
        'true',
        `A vitrine com 14 categorias deve ativar a virtualização vertical de 8 fileiras (${platformUnderTest.label})`
      );
      assert(
        rowsContainer.querySelector('[data-home-row-index="0"]') !== null &&
          rowsContainer.querySelector('[data-home-row-index="7"]') !== null &&
          rowsContainer.querySelector('[data-showcase-unmounted-row="8"]') !== null,
        `Janela virtual deve montar as 8 fileiras iniciais (0..7) (${platformUnderTest.label})`
      );

      // Focar o cartão da coluna 1 na fileira 0 e testar navegação horizontal + vertical cruzando limites de virtualização
      const row0Col1 = container.querySelector(
        '[data-home-row-index="0"] [data-row-card-index="1"]'
      ) as HTMLElement | null;
      assert(row0Col1, `Cartão 1 da fileira 0 deve estar montado (${platformUnderTest.label})`);
      focusElementSafely(row0Col1);

      // Navegar horizontalmente para a direita (coluna 1 -> coluna 2) para confirmar integridade do carrossel e alinhamento de coluna
      await act(async () => {
        moveSpatialFocus('right');
      });
      assignShowcaseDomGeometry(container);
      assert.strictEqual(
        (document.activeElement as HTMLElement)?.getAttribute('data-row-card-index'),
        '2',
        `Navegação horizontal no carrossel deve mover para a coluna 2 (${platformUnderTest.label})`
      );

      // Percorrer verticalmente da fileira 0 até a fileira 11 (cruzando a fronteira da janela 0..7)
      for (let targetRow = 1; targetRow <= 11; targetRow++) {
        await act(async () => {
          moveSpatialFocus('down');
        });
        assignShowcaseDomGeometry(container);

        const activeEl = document.activeElement as HTMLElement | null;
        const activeRowBlock = activeEl?.closest('[data-home-row-index]') as HTMLElement | null;
        assert(
          activeRowBlock,
          `O foco nunca deve se perder ao avançar para a fileira ${targetRow} (${platformUnderTest.label})`
        );
        assert.strictEqual(
          Number(activeRowBlock.getAttribute('data-home-row-index')),
          targetRow,
          `O foco deve pousar exatamente na fileira ${targetRow} ao descer com o D-Pad (${platformUnderTest.label})`
        );
        assert.strictEqual(
          activeEl?.getAttribute('data-row-card-index'),
          '2',
          `A coluna 2 deve ser preservada ao cruzar fileiras e limites de virtualização (fileira ${targetRow}, ${platformUnderTest.label})`
        );
      }

      // Percorrer de volta da fileira 11 até a fileira 0 (cruzando novamente a fronteira superior da janela virtualizada)
      for (let targetRow = 10; targetRow >= 0; targetRow--) {
        await act(async () => {
          moveSpatialFocus('up');
        });
        assignShowcaseDomGeometry(container);

        const activeEl = document.activeElement as HTMLElement | null;
        const activeRowBlock = activeEl?.closest('[data-home-row-index]') as HTMLElement | null;
        assert(
          activeRowBlock,
          `O foco nunca deve se perder ao subir para a fileira ${targetRow} (${platformUnderTest.label})`
        );
        assert.strictEqual(
          Number(activeRowBlock.getAttribute('data-home-row-index')),
          targetRow,
          `O foco deve pousar exatamente na fileira ${targetRow} ao subir com o D-Pad (${platformUnderTest.label})`
        );
        assert.strictEqual(
          activeEl?.getAttribute('data-row-card-index'),
          '2',
          `A coluna 2 deve ser preservada ao subir pelas fileiras virtualizadas (fileira ${targetRow}, ${platformUnderTest.label})`
        );
      }

      // Confirmar que a janela virtualizada acompanhou corretamente a navegação e retornou ao topo
      assert(
        rowsContainer.querySelector('[data-home-row-index="0"]') !== null &&
          rowsContainer.querySelector('[data-home-row-index="7"]') !== null,
        `Ao retornar para a fileira 0, a janela virtualizada deve restaurar o intervalo inicial (${platformUnderTest.label})`
      );
    }

    // -------------------------------------------------------------------------
    // 9.4. Ausência de regressão na navegação Web (memória de foco no retorno de detalhes)
    // -------------------------------------------------------------------------
    const targetReturnCard = container.querySelector(
      '[data-home-row-index="1"] [data-row-card-index="2"]'
    ) as HTMLElement | null;
    assert(targetReturnCard, 'Cartão da fileira 1 coluna 2 deve estar montado');
    targetReturnCard.id = 'web-regression-return-card-1-2';
    focusElementSafely(targetReturnCard);
    pushFocusMemory(targetReturnCard);

    const otherCard = container.querySelector(
      '[data-home-row-index="0"] [data-row-card-index="0"]'
    ) as HTMLElement | null;
    assert(otherCard, 'Cartão 0-0 deve estar montado');
    focusElementSafely(otherCard);
    assert.strictEqual(document.activeElement, otherCard);

    const restoredFromDetails = popFocusMemory();
    assert.strictEqual(
      restoredFromDetails,
      true,
      'popFocusMemory deve restaurar o foco ao retornar da tela de detalhes'
    );
    assert.strictEqual(
      document.activeElement,
      targetReturnCard,
      'O foco deve voltar exatamente ao cartão de origem após fechar detalhes'
    );

    // -------------------------------------------------------------------------
    // 9.5. Coordenação operacional entre navegação D-Pad e cache de imagens +
    //      ConfigView sem diagnóstico D-Pad e sem seletores A/B (preservando C2/C3)
    // -------------------------------------------------------------------------
    setAndroidPlatformOverrideForDpadTest(true);

    // 1) Registrar um movimento real de D-Pad (aciona notifyDpadNavigationActivityForImagePreload)
    await act(async () => {
      moveSpatialFocus('down');
    });

    // 2) Ordenação de categoria e aquisição de imagem continuam operando normalmente durante navegação
    const freshCatalogIndex = getOrCreateVodIndex([...showcaseStreams]);
    const sortedCatItems = freshCatalogIndex.getSortedByCategory('512');
    assert(sortedCatItems.length > 0, 'getOrCreateVodIndex().getSortedByCategory deve retornar os itens ordenados');

    const activeNavImageUrl = 'http://img.provider.tv/dpad_fluidity/active_nav_cover_test.jpg';
    const acquiredDuringNav = await acquireCachedImage(activeNavImageUrl);
    assert.strictEqual(
      acquiredDuringNav.isLocalFile,
      true,
      'A imagem solicitada durante a navegação ativa deve ser adquirida com sucesso'
    );

    // 3) Verificar que durante rajada recente do D-Pad a concorrência de downloads do cache é limitada a <= 2
    let inFlightBurstCount = 0;
    let maxConcurrentDuringDpadBurst = 0;
    const burstUrls = Array.from(
      { length: 6 },
      (_, idx) => `http://img.provider.tv/dpad_throttle/item_${idx}.jpg`
    );
    customResponderFn = (url) => {
      if (url.includes('/dpad_throttle/')) {
        return {
          status: 200,
          contentType: 'image/jpeg',
          bodyBytes: createValidTestJpegBytes(1024),
          delayMs: 35,
        };
      }
      return null;
    };
    const origAcquireImage = harness.plugin.acquireImage.bind(harness.plugin);
    harness.plugin.acquireImage = async (opts) => {
      const isBurstUrl = opts.url.includes('/dpad_throttle/');
      if (isBurstUrl) {
        inFlightBurstCount++;
        if (inFlightBurstCount > maxConcurrentDuringDpadBurst) {
          maxConcurrentDuringDpadBurst = inFlightBurstCount;
        }
      }
      try {
        return await origAcquireImage(opts);
      } finally {
        if (isBurstUrl) {
          inFlightBurstCount--;
        }
      }
    };
    let throttleResults: Awaited<ReturnType<typeof acquireCachedImage>>[] = [];
    try {
      await act(async () => {
        moveSpatialFocus('down');
      });
      throttleResults = await Promise.all(
        burstUrls.map((u) => acquireCachedImage(u, { priority: 'normal' }))
      );
    } finally {
      harness.plugin.acquireImage = origAcquireImage;
      customResponderFn = null;
    }
    assert(
      throttleResults.every((r) => r.isLocalFile),
      'Todas as imagens da fila após rajada D-Pad devem concluir normalmente'
    );
    assert(
      maxConcurrentDuringDpadBurst <= 2,
      `Durante navegação D-Pad ativa, a concorrência máxima de imagens deve ser reduzida para <= 2 (atual=${maxConcurrentDuringDpadBurst})`
    );

    // 4) Renderizar ConfigView e validar ausência total de diagnósticos (C1, C2.1, C3), seletores A/B e
    //    campos técnicos (URL do Servidor, Informações do aplicativo, Identificação do Build, Formatos do Provedor),
    //    bem como a nova ordem comercial (Informações da Conta antes de Apresentação) e a preservação da calibração
    try {
      window.localStorage.removeItem(tvEnvironmentModule.STORAGE_KEY_DISPLAY_PREFS);
    } catch {
      // ignore
    }
    tvEnvironmentModule.cancelDisplayPreview();

    await act(async () => {
      root.render(
        React.createElement(
          NavigationProvider,
          null,
          React.createElement(
            XtreamProvider,
            { credentials: mockCreds },
            React.createElement(ConfigView, { focusTarget: 'presentation' })
          )
        )
      );
      await new Promise((r) => setTimeout(r, 40));
    });

    const diagExpandBtn = container.querySelector(
      'button[data-nav-row="config-diagnostics-toggle"]'
    ) as HTMLButtonElement | null;
    const screenDiagPanelEl = container.querySelector(
      '[data-screen-diagnostics-panel="true"]'
    ) as HTMLElement | null;
    const catalogDiagToggleBtn = container.querySelector(
      '[data-catalog-diagnostics-toggle="true"]'
    ) as HTMLButtonElement | null;
    const catalogDiagSectionEl = container.querySelector(
      '[data-catalog-diagnostics-section="true"]'
    ) as HTMLElement | null;
    const dpadDiagToggleBtn = container.querySelector(
      '[data-dpad-fluidity-diagnostics-toggle="true"]'
    ) as HTMLButtonElement | null;
    const dpadSectionEl = container.querySelector(
      '[data-dpad-fluidity-diagnostics-section="true"]'
    ) as HTMLElement | null;
    const startupModeToggleBtn = container.querySelector(
      '[data-startup-image-mode-toggle="true"]'
    ) as HTMLButtonElement | null;
    const dpadModeToggleBtn = container.querySelector(
      '[data-dpad-behavior-mode-toggle="true"]'
    ) as HTMLButtonElement | null;

    assert.strictEqual(
      diagExpandBtn,
      null,
      'ConfigView NÃO deve mais renderizar o botão de expansão de Diagnóstico de Tela (Entrega C3)'
    );
    assert.strictEqual(
      screenDiagPanelEl,
      null,
      'ConfigView NÃO deve mais renderizar o painel de Diagnóstico da Tela (Entrega C3)'
    );
    assert.strictEqual(
      startupModeToggleBtn,
      null,
      'ConfigView NÃO deve renderizar seletor A/B de modo de abertura (Modo A/Modo B)'
    );
    assert.strictEqual(
      dpadModeToggleBtn,
      null,
      'ConfigView NÃO deve renderizar seletor A/B de modo de navegação D-Pad'
    );
    assert.strictEqual(
      dpadDiagToggleBtn,
      null,
      'ConfigView NÃO deve mais renderizar botão de Diagnóstico de fluidez do D-Pad (Entrega C1)'
    );
    assert.strictEqual(
      dpadSectionEl,
      null,
      'ConfigView NÃO deve mais renderizar Grupo 5 (Diagnóstico de Fluidez do D-Pad)'
    );
    assert.strictEqual(
      catalogDiagToggleBtn,
      null,
      'ConfigView NÃO deve mais renderizar botão de Diagnóstico de Carregamento dos Catálogos (Entrega C2.1)'
    );
    assert.strictEqual(
      catalogDiagSectionEl,
      null,
      'ConfigView NÃO deve mais renderizar Grupo 4 (Diagnóstico de Carregamento Inicial dos Catálogos — Entrega C2.1)'
    );

    const configText = container.textContent || '';
    assert(configText.includes('Configurações'), 'ConfigView deve renderizar o título Configurações');
    assert(
      configText.includes('Informações da Conta') && configText.includes(mockCreds.username),
      'ConfigView deve preservar as Informações da Conta'
    );
    assert(
      configText.includes('Apresentação e Tamanho da Interface'),
      'ConfigView deve preservar a seção de Apresentação e Tamanho da Interface'
    );
    const accountSectionEl = container.querySelector('[data-config-section="account"]');
    const presentationSectionEl = container.querySelector('[data-config-section="presentation"]');
    assert(
      accountSectionEl &&
        presentationSectionEl &&
        Boolean(accountSectionEl.compareDocumentPosition(presentationSectionEl) & Node.DOCUMENT_POSITION_FOLLOWING),
      'ConfigView deve exibir Informações da Conta antes de Apresentação e Tamanho da Interface na ordem DOM'
    );
    assert(
      !configText.includes('URL do Servidor') && !configText.includes(mockCreds.serverUrl),
      'ConfigView NÃO deve exibir o bloco URL do Servidor nem o valor de credentials.serverUrl'
    );
    assert(
      !configText.includes('Informações do aplicativo') &&
        !configText.includes('Identificação do Build') &&
        !configText.includes('Formatos do Provedor') &&
        !configText.includes('Reprodução 100% Direta no Navegador'),
      'ConfigView NÃO deve exibir a seção técnica Informações do aplicativo, Identificação do Build, Formatos do Provedor ou texto técnico de arquitetura'
    );
    assert(
      !configText.includes('Arquitetura & Diagnóstico') &&
        !configText.includes('Diagnóstico Técnico da Tela'),
      'ConfigView não deve exibir títulos de seções diagnósticas removidas na Entrega C3'
    );

    // Testar abertura do modal de calibração, preview temporário, cancelamento sem persistir e confirmação com persistência
    const openCalibrationBtn = container.querySelector<HTMLButtonElement>(
      'button[data-config-primary="true"]'
    )!;
    assert(openCalibrationBtn, 'Botão principal de ajuste de apresentação deve existir em ConfigView');

    await act(async () => {
      openCalibrationBtn.click();
      await new Promise((r) => setTimeout(r, 25));
    });
    assert(
      document.querySelector('[data-display-setup-modal="true"]') !== null,
      'DisplaySetupModal deve abrir a partir de ConfigView'
    );

    // Selecionar TV -> abre calibração diretamente em 90% -> Voltar e cancelar sem confirmar
    await act(async () => {
      (document.querySelector('[data-device-choice="tv"]') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 20));
    });
    const sampleCardEl = document.querySelector('[data-calibration-sample="true"]') as HTMLElement | null;
    const draftBadgeEl = document.querySelector('[data-calibration-draft-badge="true"]') as HTMLElement | null;
    assert(sampleCardEl, 'Cartão de prévia de calibração deve estar visível');
    assert.strictEqual(
      sampleCardEl.getAttribute('data-sample-scale'),
      '90',
      'Prévia visual de calibração deve iniciar na escala padrão de 90%'
    );
    assert(
      draftBadgeEl && (draftBadgeEl.textContent || '').includes('90%'),
      'Badge da calibração deve exibir 90%'
    );
    assert.strictEqual(
      tvEnvironmentModule.getDisplayPreferencesSnapshot().mode,
      'default',
      'Antes de confirmar, o modo global persistido deve permanecer default'
    );

    await act(async () => {
      (document.querySelector('[data-calibration-back="true"]') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 15));
    });
    await act(async () => {
      (document.querySelector('[data-device-cancel="true"]') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 20));
    });
    assert.strictEqual(
      document.querySelector('[data-display-setup-modal="true"]'),
      null,
      'Cancelar calibração deve fechar DisplaySetupModal'
    );
    const afterCancelSnap = tvEnvironmentModule.getDisplayPreferencesSnapshot();
    assert.strictEqual(afterCancelSnap.isPreviewActive, false, 'Cancelamento deve encerrar preview');
    assert.strictEqual(afterCancelSnap.mode, 'default', 'Cancelamento não deve persistir modo TV');

    // Reabrir, configurar TV 90% e confirmar -> deve persistir em localStorage e atributos do documento
    await act(async () => {
      openCalibrationBtn.click();
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () => {
      (document.querySelector('[data-device-choice="tv"]') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 15));
    });
    await act(async () => {
      (document.querySelector('[data-calibration-confirm="true"]') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 20));
    });

    const confirmedTvSnap = tvEnvironmentModule.getDisplayPreferencesSnapshot();
    assert.strictEqual(confirmedTvSnap.mode, 'tv', 'Confirmação deve persistir modo TV');
    assert.strictEqual(confirmedTvSnap.tvScale, 90, 'Confirmação deve persistir escala TV 90%');
    assert.strictEqual(confirmedTvSnap.isConfigured, true, 'Preferências de exibição devem ficar marcadas como configuradas');
    assert.strictEqual(confirmedTvSnap.isPreviewActive, false, 'Preview deve ser encerrado após confirmação');
    assert.strictEqual(
      document.documentElement.getAttribute('data-display-mode'),
      'tv',
      'Atributo data-display-mode no documento deve refletir modo TV confirmado'
    );
    const storedDisplayRaw = window.localStorage.getItem(tvEnvironmentModule.STORAGE_KEY_DISPLAY_PREFS);
    assert(
      storedDisplayRaw && storedDisplayRaw.includes('"mode":"tv"') && storedDisplayRaw.includes('"tvScale":90'),
      'Preferências de apresentação TV 90% devem ser persistidas em localStorage'
    );

    // Reverter para modo padrão (computador) via modal e confirmar
    await act(async () => {
      (container.querySelector('button[data-config-primary="true"]') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () => {
      (document.querySelector('[data-device-choice="computador"]') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 15));
    });
    await act(async () => {
      (document.querySelector('[data-confirm-default="true"]') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 20));
    });
    const confirmedDefaultSnap = tvEnvironmentModule.getDisplayPreferencesSnapshot();
    assert.strictEqual(confirmedDefaultSnap.mode, 'default', 'Alternância para modo padrão deve ser confirmada');
    assert.strictEqual(
      document.documentElement.getAttribute('data-display-mode'),
      'default',
      'Atributo data-display-mode no documento deve retornar para default'
    );

    await clearImageCacheOnLogout();
  } finally {
    customResponderFn = null;
    (XtreamService as any).authenticate = originalAuthenticate;
    try {
      window.localStorage.removeItem('nc_dpad_nav_behavior_mode_v1');
      window.localStorage.removeItem(tvEnvironmentModule.STORAGE_KEY_DISPLAY_PREFS);
    } catch {
      // ignore
    }
    tvEnvironmentModule.cancelDisplayPreview();
    tvEnvironmentModule.syncDocumentDisplayAttributes();
    setAndroidPlatformOverrideForDpadTest(null);
    harness.uninstall();
    setMediaImageRetryDelayMsForTest(2000);
    clearAllBackHandlersForTest();
    clearFocusMemory();
    await tracked.unmount();
  }

  console.log(
    '✅ Etapa 3 / Entrega C1 (política Android/Web sem diagnóstico D-Pad, repetição 48ms, virtualização, redução de concorrência de imagens e ConfigView limpo) validada!'
  );
}

// Bloco 10 extraído para scripts/direct/hero-banner.ts
// Bloco 11 extraído para scripts/direct/api-transport.ts
// Bloco 12 extraído para scripts/direct/android-prepare.ts

// ============================================================================
// 13. ENTREGA C3 — LIMPEZA FINAL DE DIAGNÓSTICOS, CONTADORES E REGRESSÕES
// ============================================================================
async function runDeliveryC3FinalCleanupAndRegressionTests(): Promise<void> {
  console.log('🧪 [13] Testando Entrega C3 (Player sem diagnóstico, módulos limpos, ausência de contadores e regressões)...');

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

  // 13.3. VideoPlayer sem botão/menu/overlay de diagnóstico, mantendo controles e overlay de erro reais
  const doc = document;
  const tracked = env.createTrackedRoot();
  const container = tracked.host;
  const root = tracked.root;
  enableDeterministicHlsMock();
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
    restoreHlsMock();
    clearAllBackHandlersForTest();
  }

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

  // 13.9. Seleção real de faixas de áudio (HLS assíncrono, índice vs id, AUDIO_TRACKS_UPDATED intermediário, evento atrasado, falha honesta, feedback visível, troca de mídia, nativo e vazio)
  {
    const audioTracked = env.createTrackedRoot();
    const audioContainer = audioTracked.host;
    const audioRoot = audioTracked.root;
    enableDeterministicHlsMock();
    clearAllBackHandlersForTest();
    setNavMode('remote');

    // Simular 3 faixas HLS com id de metadados diferente do índice do array (10, 25, 40 vs índices 0, 1, 2)
    nextHlsInitialTracks = {
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
    };

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

      const hlsCtrl = activeHlsControllers[activeHlsControllers.length - 1];
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

      nextHlsInitialTracks = {
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
      };

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

      const hlsCtrl2 = activeHlsControllers[activeHlsControllers.length - 1];
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
      restoreHlsMock();
      clearAllBackHandlersForTest();
    }

    // 13.9b. Áudio nativo (HTMLMediaElement.audioTracks): leitura real de .enabled e recusa de falsa confirmação
    const nativeTracked = env.createTrackedRoot();
    const nativeContainer = nativeTracked.host;
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

  // 13.10. Navegação D-Pad no controle de volume sem prisão de foco + edição explícita + preservação de mouse
  {
    const volTracked = env.createTrackedRoot();
    const volContainer = volTracked.host;
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

  // 13.11. Robustez e classificação de erros de reprodução (URL inválida, HLS HTTP 404 imediato, MKV nativo)
  {
    const errTracked = env.createTrackedRoot();
    const errContainer = errTracked.host;
    const errRoot = errTracked.root;
    enableDeterministicHlsMock();
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
      const hls404Ctrl = activeHlsControllers[activeHlsControllers.length - 1];
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
      restoreHlsMock();
      clearAllBackHandlersForTest();
    }
  }

  console.log(
    '✅ Entrega C3 + Correções Pós-C3 (áudio real, volume D-Pad, erros de reprodução e EPG assíncrono) validadas!'
  );
}

interface DirectRunSummary {
  executedBlocks: Array<{ index: number; name: string }>;
  skippedBlocks: number[];
  durationMs: number;
}

async function main(): Promise<DirectRunSummary> {
  const startedAt = Date.now();
  const executedBlocks: Array<{ index: number; name: string }> = [];
  const skippedBlocks: number[] = [];

  if (selectedCaseNumber !== null) {
    console.log(
      `🚀 INICIANDO SUÍTE DIRECIONADA DE TESTES — NORTH CODE PLAY (filtro PARCIAL NC_DIRECT_CASE=${selectedCaseNumber}/${TOTAL_BLOCKS})\n`
    );
  } else {
    console.log('🚀 INICIANDO SUÍTE DIRECIONADA DE TESTES — NORTH CODE PLAY\n');
  }

  const blocks: Array<{ index: number; name: string; fn: () => Promise<void> | void }> = [
    {
      index: 1,
      name: 'runEssentialTrackAndSecurityTests',
      fn: () =>
        runEssentialTrackAndSecurityTests({
          redactStreamUrlCredentials,
          formatMediaTrackLabel,
          convertSrtToWebVtt,
          extractXtreamSubtitles,
        }),
    },
    {
      index: 2,
      name: 'runLiveTvFullscreenAndPreviewTransitionTests',
      fn: () =>
        runLiveTvFullscreenAndPreviewTransitionTests({
          env,
          hlsMock: hlsMockControl,
          VideoPlayer,
          setNavMode,
          clearAllBackHandlersForTest,
          executeBackAction,
        }),
    },
    {
      index: 3,
      name: 'runWhitePaletteAndControlsIntegrationTests',
      fn: () =>
        runWhitePaletteAndControlsIntegrationTests({
          env,
          hlsMock: hlsMockControl,
          VideoPlayer,
          LiveTvView,
          XtreamProvider,
          XtreamService,
          setNavMode,
          clearAllBackHandlersForTest,
          executeBackAction,
        }),
    },
    {
      index: 4,
      name: 'runCycle1230bSpatialNavOptimizationTests',
      fn: () =>
        runCycle1230bSpatialNavOptimizationTests({
          env,
          XtreamProvider,
          HorizontalRow,
          setNavMode,
          getNavMode,
          clearAllBackHandlersForTest,
          clearFocusMemory,
          setFastHorizontalRowNavEnabledForTest,
          invalidateCandidateCache,
          focusElementSafely,
          moveSpatialFocus,
          pushFocusMemory,
          popFocusMemory,
        }),
    },
    {
      index: 5,
      name: 'runCycle1230cVerticalNavOptimizationTests',
      fn: () =>
        runCycle1230cVerticalNavOptimizationTests({
          env,
          setNavMode,
          clearAllBackHandlersForTest,
          clearFocusMemory,
          setFastHorizontalRowNavEnabledForTest,
          setFastVerticalNavEnabledForTest,
          invalidateCandidateCache,
          registerShowcaseRowController,
          unregisterShowcaseRowController,
          registerVirtualContainer,
          unregisterVirtualContainer,
          focusElementSafely,
          moveSpatialFocus,
        }),
    },
    {
      index: 6,
      name: 'runCycle1230dLiveTvLatencyAndFullscreenTests',
      fn: () =>
        runCycle1230dLiveTvLatencyAndFullscreenTests({
          env,
          hlsMock: hlsMockControl,
          LiveTvView,
          XtreamProvider,
          XtreamService,
          setNavMode,
          clearAllBackHandlersForTest,
          clearFocusMemory,
          setFastHorizontalRowNavEnabledForTest,
          setFastVerticalNavEnabledForTest,
          focusElementSafely,
          moveSpatialFocus,
          executeBackAction,
        }),
    },
    {
      index: 7,
      name: 'runStep1PersistentImageCacheAndPreloadTests',
      fn: () =>
        runStep1PersistentImageCacheAndPreloadTests({
          env,
          hlsMock: hlsMockControl,
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
        }),
    },
    {
      index: 8,
      name: 'runStep2StartupAndFluidityStabilizationTests',
      fn: () =>
        runStep2StartupAndFluidityStabilizationTests({
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
        }),
    },
    { index: 9, name: 'runStep3DpadFluidityAndDiagnosticsTests', fn: runStep3DpadFluidityAndDiagnosticsTests },
    {
      index: 10,
      name: 'runDeliveryAHeroBannerConsolidationTests',
      fn: () =>
        runDeliveryAHeroBannerConsolidationTests({
          env,
          XtreamProvider,
          XtreamService,
          CatalogShowcaseView,
          HeroBanner,
          MovieDetails,
          SeriesDetails,
          clearHeroSessionCache,
          fetchOrReuseHeroDetails,
          getCachedHeroDetails,
          getHeroSessionCacheStatsForTest,
          computeHeroItemsFromList,
          getHeroBannerItems,
          createSimulatedPersistentImageDiskHarness,
          createValidTestJpegBytes,
          setCatalogTransferPhaseActiveForImageCache,
          clearAllBackHandlersForTest,
          clearFocusMemory,
        }),
    },
    {
      index: 11,
      name: 'runDeliveryC21CatalogCleanupAndRegressionTests',
      fn: () =>
        runDeliveryC21CatalogCleanupAndRegressionTests({
          env,
          getCustomFetchResponder: () => customFetchResponder,
          setCustomFetchResponder: (responder) => {
            customFetchResponder = responder;
          },
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
        }),
    },
    {
      index: 12,
      name: 'runDeliveryC22NativeCleanupAndPreparationTests',
      fn: () =>
        runDeliveryC22NativeCleanupAndPreparationTests({
          executeXtreamGetRequest,
          setTransportTestConfig,
          setAndroidCatalogFileAdapterTestOverride,
        }),
    },
    { index: 13, name: 'runDeliveryC3FinalCleanupAndRegressionTests', fn: runDeliveryC3FinalCleanupAndRegressionTests },
  ];

  if (blocks.length !== TOTAL_BLOCKS) {
    throw new Error(
      `Contagem esperada de blocos em test-direct (${TOTAL_BLOCKS}) diverge da registrada (${blocks.length}).`
    );
  }

  for (const block of blocks) {
    if (selectedCaseNumber !== null && block.index !== selectedCaseNumber) {
      skippedBlocks.push(block.index);
      continue;
    }
    let blockError: unknown = null;
    try {
      await block.fn();
      executedBlocks.push({ index: block.index, name: block.name });
    } catch (err) {
      blockError = err;
    } finally {
      const cleanupErrors: Error[] = [];
      try {
        cleanupErrors.push(...(await env.unmountAllRoots()));
      } catch (err) {
        cleanupErrors.push(err instanceof Error ? err : new Error(String(err)));
      }
      cleanupErrors.push(...(await runSharedStateResetSteps()));
      if (cleanupErrors.length > 0) {
        if (blockError) {
          console.error(
            `Erros secundários durante limpeza pós-bloco ${block.index} (${block.name}):`,
            cleanupErrors
          );
        } else {
          blockError = cleanupErrors[0];
        }
      }
    }
    if (blockError) {
      throw blockError;
    }
  }

  return {
    executedBlocks,
    skippedBlocks,
    durationMs: Date.now() - startedAt,
  };
}

let runError: unknown = null;
let summary: DirectRunSummary | null = null;

try {
  summary = await main();
} catch (err) {
  runError = err;
}

const teardownErrors = await env.dispose();

if (runError) {
  console.error('\n❌ ERRO NA EXECUÇÃO DOS TESTES (test-direct):', runError);
  if (teardownErrors.length > 0) {
    console.error('Erros adicionais durante teardown em test-direct:', teardownErrors);
  }
  process.exitCode = 1;
} else if (teardownErrors.length > 0) {
  console.error('\n❌ FALHA DURANTE TEARDOWN EM test-direct:', teardownErrors);
  process.exitCode = 1;
} else if (summary) {
  if (selectedCaseNumber !== null) {
    const execLabels = summary.executedBlocks.map((b) => `${b.index} (${b.name})`).join(', ');
    console.log(
      `\n🎉 Sucesso PARCIAL (filtro NC_DIRECT_CASE=${selectedCaseNumber}): bloco executado [${execLabels}] | ${summary.skippedBlocks.length} ignorados (${summary.skippedBlocks.join(', ')}) de ${TOTAL_BLOCKS} em ${summary.durationMs}ms — test-direct.`
    );
  } else {
    console.log(
      `\n🎉 TODOS OS ${summary.executedBlocks.length}/${TOTAL_BLOCKS} BLOCOS DE TESTES FORAM EXECUTADOS COM SUCESSO EM ${summary.durationMs}ms — test-direct!`
    );
  }
}


