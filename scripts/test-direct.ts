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
import { runStep3DpadFluidityAndDiagnosticsTests } from './direct/dpad-image-integration';
import { runDeliveryAHeroBannerConsolidationTests } from './direct/hero-banner';
import {
  runDeliveryC3FinalCleanupAndRegressionTests,
  VALID_C3_SUBCASES,
  type DirectC3SubcaseId,
} from './direct/final-regressions';

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

const rawC3SubcaseFilter = process.env.NC_DIRECT_C3_SUBCASE?.trim();
let selectedC3Subcase: DirectC3SubcaseId | null = null;
if (rawC3SubcaseFilter) {
  if (selectedCaseNumber !== 13) {
    console.error(
      `FALHA em test-direct: NC_DIRECT_C3_SUBCASE="${rawC3SubcaseFilter}" só pode ser utilizado em conjunto com NC_DIRECT_CASE=13.`
    );
    process.exit(1);
  }
  if (!(VALID_C3_SUBCASES as readonly string[]).includes(rawC3SubcaseFilter)) {
    console.error(
      `FALHA em test-direct: filtro inválido NC_DIRECT_C3_SUBCASE="${rawC3SubcaseFilter}". Valores válidos: ${VALID_C3_SUBCASES.join(', ')}.`
    );
    process.exit(1);
  }
  selectedC3Subcase = rawC3SubcaseFilter as DirectC3SubcaseId;
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

interface DirectRunSummary {
  executedBlocks: Array<{ index: number; name: string }>;
  skippedBlocks: number[];
  durationMs: number;
}

async function main(): Promise<DirectRunSummary> {
  const startedAt = Date.now();
  const executedBlocks: Array<{ index: number; name: string }> = [];
  const skippedBlocks: number[] = [];

  if (selectedCaseNumber !== null && selectedC3Subcase !== null) {
    console.log(
      `🚀 INICIANDO SUÍTE DIRECIONADA DE TESTES — NORTH CODE PLAY (filtro PARCIAL NC_DIRECT_CASE=${selectedCaseNumber}/${TOTAL_BLOCKS}, NC_DIRECT_C3_SUBCASE=${selectedC3Subcase})\n`
    );
  } else if (selectedCaseNumber !== null) {
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
    {
      index: 9,
      name: 'runStep3DpadFluidityAndDiagnosticsTests',
      fn: () =>
        runStep3DpadFluidityAndDiagnosticsTests({
          env,
          XtreamProvider,
          XtreamService,
          NavigationProvider,
          CatalogShowcaseView,
          ConfigView,
          setMediaImageRetryDelayMsForTest,
          createSimulatedPersistentImageDiskHarness,
          createValidTestJpegBytes,
          acquireCachedImage,
          clearImageCacheOnLogout,
          setAndroidPlatformOverrideForDpadTest,
          isAndroidCapacitorPlatform,
          getDpadNavigationBehaviorMode,
          isDpadOptimizedPathActive,
          invalidateCandidateCache,
          focusElementSafely,
          moveSpatialFocus,
          pushFocusMemory,
          popFocusMemory,
          clearAllBackHandlersForTest,
          clearFocusMemory,
          getOrCreateVodIndex,
          tvEnvironmentModule,
        }),
    },
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
    {
      index: 13,
      name: 'runDeliveryC3FinalCleanupAndRegressionTests',
      fn: () =>
        runDeliveryC3FinalCleanupAndRegressionTests({
          env,
          Hls,
          hlsMock: hlsMockControl,
          VideoPlayer,
          XtreamService,
          NavigationProvider,
          setNavMode,
          clearAllBackHandlersForTest,
          executeBackAction,
          setAndroidPlatformOverrideForDpadTest,
          getHeroSessionCacheStatsForTest,
          mediaUtilsModule,
          mediaImageModule,
          virtualWindowModule,
          navigationModule,
          catalogRankingModule,
          playbackHistoryModule,
          liveTvViewModule,
          liveEpgManagerModule,
          tvEnvironmentModule,
          subcaseFilter: selectedC3Subcase,
        }),
    },
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
  if (selectedCaseNumber !== null && selectedC3Subcase !== null) {
    const execLabels = summary.executedBlocks.map((b) => `${b.index} (${b.name})`).join(', ');
    console.log(
      `\n🎉 Sucesso PARCIAL (filtro NC_DIRECT_CASE=${selectedCaseNumber}, NC_DIRECT_C3_SUBCASE=${selectedC3Subcase}): subcenário executado [${selectedC3Subcase}] em [${execLabels}] | demais 10 subcenários e ${summary.skippedBlocks.length} blocos ignorados de ${TOTAL_BLOCKS} em ${summary.durationMs}ms — test-direct.`
    );
  } else if (selectedCaseNumber !== null) {
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
