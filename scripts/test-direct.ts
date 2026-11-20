import assert from 'node:assert';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Hls from 'hls.js';

// 1. Inicializar ambiente DOM enxuto
const windowInstance = new Window({
  url: 'http://localhost:3000',
  width: 1280,
  height: 720,
});

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).window = windowInstance;
(globalThis as any).document = windowInstance.document;
Object.defineProperty(globalThis, 'navigator', {
  value: windowInstance.navigator,
  writable: true,
  configurable: true,
});
(globalThis as any).HTMLElement = windowInstance.HTMLElement;
(globalThis as any).HTMLButtonElement = windowInstance.HTMLButtonElement;
(globalThis as any).HTMLInputElement = windowInstance.HTMLInputElement;
(globalThis as any).HTMLVideoElement = windowInstance.HTMLVideoElement;
(globalThis as any).HTMLTrackElement = windowInstance.HTMLTrackElement;
(globalThis as any).Element = windowInstance.Element;
(globalThis as any).Node = windowInstance.Node;
(globalThis as any).SVGElement = windowInstance.SVGElement;
(globalThis as any).Event = windowInstance.Event;
(globalThis as any).CustomEvent = windowInstance.CustomEvent;
(globalThis as any).KeyboardEvent = windowInstance.KeyboardEvent;
(globalThis as any).MouseEvent = windowInstance.MouseEvent;
(globalThis as any).MutationObserver = windowInstance.MutationObserver;
(globalThis as any).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
(globalThis as any).localStorage = windowInstance.localStorage;
(globalThis as any).sessionStorage = windowInstance.sessionStorage;
(globalThis as any).URL = windowInstance.URL;
(globalThis as any).Blob = windowInstance.Blob;
(globalThis as any).getComputedStyle = windowInstance.getComputedStyle.bind(windowInstance);

let rafIdCounter = 1;
const rafTimers = new Map<number, NodeJS.Timeout>();
const rafCallback = (cb: FrameRequestCallback) => {
  const id = rafIdCounter++;
  const timer = setTimeout(() => {
    rafTimers.delete(id);
    cb(Date.now());
  }, 0);
  rafTimers.set(id, timer);
  return id;
};
const cancelRafCallback = (id: number) => {
  const timer = rafTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    rafTimers.delete(id);
  }
};
(globalThis as any).requestAnimationFrame = rafCallback;
(globalThis as any).cancelAnimationFrame = cancelRafCallback;
(windowInstance as any).requestAnimationFrame = rafCallback;
(windowInstance as any).cancelAnimationFrame = cancelRafCallback;

const proto = windowInstance.HTMLElement.prototype as any;
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

const videoProto = windowInstance.HTMLVideoElement.prototype as any;
videoProto.play = function () {
  return Promise.resolve();
};
videoProto.pause = function () {};
videoProto.load = function () {};

// Stub de fetch para arquivos de legenda externos (.srt / .vtt)
let customFetchResponder: ((url: string) => Promise<Response>) | null = null;
(globalThis as any).fetch = async (input: any) => {
  const url = typeof input === 'string' ? input : input?.url || String(input);
  if (customFetchResponder) {
    return customFetchResponder(url);
  }
  return new Response('Not Found', { status: 404 });
};

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

import {
  redactStreamUrlCredentials,
  formatMediaTrackLabel,
  convertSrtToWebVtt,
  extractXtreamSubtitles,
} from '../src/components/player/trackUtils';
import { VideoPlayer } from '../src/components/VideoPlayer';
import * as liveTvViewModule from '../src/views/LiveTvView';
import { LiveTvView } from '../src/views/LiveTvView';
import {
  XtreamProvider,
  useXtreamSession,
  useXtreamLive,
  useXtreamVod,
  useXtreamSeries,
} from '../src/context/XtreamContext';
import { XtreamService } from '../src/services/xtreamService';
import {
  executeXtreamGetRequest,
  setTransportTestConfig,
  getAndroidCatalogAdapterLoadCountForTest,
  resetAndroidCatalogAdapterLoadCountForTest,
} from '../src/services/httpTransport';
import { setAndroidCatalogFileAdapterTestOverride } from '../src/services/androidCatalogFileAdapter';
import type { XtreamCredentials } from '../src/types';
import * as navigationModule from '../src/navigation';
import {
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
} from '../src/navigation';
import { HorizontalRow } from '../src/components/HorizontalRow';
import * as mediaImageModule from '../src/components/MediaImage';
import { MediaImage, setMediaImageRetryDelayMsForTest } from '../src/components/MediaImage';
import { CatalogShowcaseView } from '../src/components/CatalogShowcaseView';
import { HeroBanner } from '../src/components/HeroBanner';
import { MovieDetails } from '../src/components/MovieDetails';
import { SeriesDetails } from '../src/components/SeriesDetails';
import {
  clearHeroSessionCache,
  fetchOrReuseHeroDetails,
  getCachedHeroDetails,
  getHeroSessionCacheStatsForTest,
} from '../src/services/heroSessionCache';
import { ConfigView } from '../src/views/ConfigView';
import {
  computeHeroItemsFromList,
  getHeroBannerItems,
  getOrCreateVodIndex,
} from '../src/utils/catalogIndex';
import * as androidImageCacheModule from '../src/services/androidImageCache';
import * as mediaUtilsModule from '../src/utils/mediaUtils';
import * as virtualWindowModule from '../src/hooks/useVirtualWindow';
import * as catalogRankingModule from '../src/utils/catalogRanking';
import * as playbackHistoryModule from '../src/utils/playbackHistory';
import * as liveEpgManagerModule from '../src/utils/liveEpgManager';
import * as tvEnvironmentModule from '../src/platform/tvEnvironment';
import { APP_COMMIT, APP_VERSION, formatCommitShort } from '../src/version';

interface TestDomCallMetrics {
  querySelectorCalls: number;
  boundingRectCalls: number;
  computedStyleCalls: number;
}

/**
 * Test-only DOM call spy used to verify optimized spatial navigation DOM cost
 * without maintaining any performance counters in production code.
 */
async function measureDomCallsAsync<T>(
  doc: Document,
  win: any,
  fn: () => Promise<T> | T
): Promise<{ result: T; metrics: TestDomCallMetrics }> {
  const metrics: TestDomCallMetrics = {
    querySelectorCalls: 0,
    boundingRectCalls: 0,
    computedStyleCalls: 0,
  };

  const elemProto = win.Element?.prototype;
  const htmlElemProto = win.HTMLElement?.prototype;
  const origQuerySelectorAll = elemProto?.querySelectorAll;
  const origGetBoundingClientRect = htmlElemProto?.getBoundingClientRect;
  const origGetComputedStyle = win.getComputedStyle;

  if (elemProto && origQuerySelectorAll) {
    elemProto.querySelectorAll = function (this: Element, selector: string) {
      if (this === doc.body && typeof selector === 'string' && selector.includes('[data-nav-item="true"]')) {
        metrics.querySelectorCalls += 1;
      }
      return origQuerySelectorAll.call(this, selector);
    };
  }
  if (htmlElemProto && origGetBoundingClientRect) {
    htmlElemProto.getBoundingClientRect = function (this: HTMLElement) {
      metrics.boundingRectCalls += 1;
      return origGetBoundingClientRect.call(this);
    };
  }
  if (origGetComputedStyle) {
    win.getComputedStyle = function (this: any, ...args: any[]) {
      metrics.computedStyleCalls += 1;
      return origGetComputedStyle.apply(this, args);
    };
  }

  try {
    const result = await fn();
    return { result, metrics };
  } finally {
    if (elemProto && origQuerySelectorAll) {
      elemProto.querySelectorAll = origQuerySelectorAll;
    }
    if (htmlElemProto && origGetBoundingClientRect) {
      htmlElemProto.getBoundingClientRect = origGetBoundingClientRect;
    }
    if (origGetComputedStyle) {
      win.getComputedStyle = origGetComputedStyle;
    }
  }
}

function measureDomCallsSync<T>(
  doc: Document,
  win: any,
  fn: () => T
): { result: T; metrics: TestDomCallMetrics } {
  const metrics: TestDomCallMetrics = {
    querySelectorCalls: 0,
    boundingRectCalls: 0,
    computedStyleCalls: 0,
  };

  const elemProto = win.Element?.prototype;
  const htmlElemProto = win.HTMLElement?.prototype;
  const origQuerySelectorAll = elemProto?.querySelectorAll;
  const origGetBoundingClientRect = htmlElemProto?.getBoundingClientRect;
  const origGetComputedStyle = win.getComputedStyle;

  if (elemProto && origQuerySelectorAll) {
    elemProto.querySelectorAll = function (this: Element, selector: string) {
      if (this === doc.body && typeof selector === 'string' && selector.includes('[data-nav-item="true"]')) {
        metrics.querySelectorCalls += 1;
      }
      return origQuerySelectorAll.call(this, selector);
    };
  }
  if (htmlElemProto && origGetBoundingClientRect) {
    htmlElemProto.getBoundingClientRect = function (this: HTMLElement) {
      metrics.boundingRectCalls += 1;
      return origGetBoundingClientRect.call(this);
    };
  }
  if (origGetComputedStyle) {
    win.getComputedStyle = function (this: any, ...args: any[]) {
      metrics.computedStyleCalls += 1;
      return origGetComputedStyle.apply(this, args);
    };
  }

  try {
    const result = fn();
    return { result, metrics };
  } finally {
    if (elemProto && origQuerySelectorAll) {
      elemProto.querySelectorAll = origQuerySelectorAll;
    }
    if (htmlElemProto && origGetBoundingClientRect) {
      htmlElemProto.getBoundingClientRect = origGetBoundingClientRect;
    }
    if (origGetComputedStyle) {
      win.getComputedStyle = origGetComputedStyle;
    }
  }
}
import * as catalogIndexModule from '../src/utils/catalogIndex';
import {
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
} from '../src/services/androidImageCache';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';




// ============================================================================
// 1. TESTES ESSENCIAIS DE REGRESSÃO (LEGENDAS, ÁUDIO E SEGURANÇA — CICLO 12.29-a)
// ============================================================================
function runEssentialTrackAndSecurityTests(): void {
  console.log('--- 1. Regressão Essencial: Utilitários de Legendas, Áudio e Segurança ---');

  const rawMovieUrl = 'http://my-provider.tv:8080/movie/userSecret123/passSecret456/98765.mp4';
  const redactedMovie = redactStreamUrlCredentials(rawMovieUrl);
  assert(!redactedMovie.includes('userSecret123') && !redactedMovie.includes('passSecret456'));

  assert.strictEqual(
    formatMediaTrackLabel({
      rawName: 'Português',
      lang: 'pt-BR',
      fallbackPrefix: 'Áudio',
      index: 0,
      channels: '6',
    }),
    'Português (Português (Brasil)) · 5.1'
  );

  const convertedVtt = convertSrtToWebVtt('1\r\n00:00:01,250 --> 00:00:04,500\r\nOlá!\r\n');
  assert(convertedVtt.startsWith('WEBVTT\n\n') && convertedVtt.includes('00:00:01.250 --> 00:00:04.500'));

  const extractedSubs = extractXtreamSubtitles(
    {
      info: {
        subtitles: [
          { url: 'http://cdn.server.tv/subs/movie_pt.srt', lang: 'pt-BR' },
          { url: 'http://cdn.server.tv/subs/bitmap.pgs', lang: 'fr' },
        ],
      },
    },
    'http://cdn.server.tv'
  );
  assert.strictEqual(extractedSubs.length, 1);

  console.log('✅ Utilitários de legendas, áudio e segurança validados!');
}

// ============================================================================
// 2. CICLO 12.29-b.1 — PARTE A: TV AO VIVO (PREVIEW COMPACTO vs FULLSCREEN NATIVO
//    E VISUAL EXPANDIDO + RETORNO SEM REINICIAR REPRODUÇÃO)
// ============================================================================
async function runLiveTvFullscreenAndPreviewTransitionTests(): Promise<void> {
  console.log('--- 2. TV ao Vivo: Preview Compacto -> Fullscreen Nativo / Visual -> Retorno sem Reiniciar ---');

  enableDeterministicHlsMock();
  nextHlsInitialTracks = {
    audioTracks: [{ id: 0, name: 'Português', lang: 'pt-BR', default: true }],
    subtitleTracks: [],
    audioTrack: 0,
    subtitleTrack: -1,
  };

  const doc: Document = windowInstance.document as unknown as Document;
  setNavMode('remote');
  clearAllBackHandlersForTest();

  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container);

  try {
    let previewBackCalled = 0;
    await act(async () => {
      root.render(
        React.createElement(VideoPlayer, {
          streamUrl: 'http://server.tv:8080/live/user/pass/501.m3u8',
          title: 'SporTV HD',
          channelName: 'SporTV HD',
          programTitle: 'Campeonato Brasileiro Ao Vivo',
          contentType: 'live',
          streamId: 501,
          embedded: true,
          disableEmbeddedControlsFocus: true,
          onBack: () => {
            previewBackCalled++;
          },
        })
      );
      await new Promise((r) => setTimeout(r, 20));
    });

    const playerContainer = doc.querySelector<HTMLElement>('[data-player-container="true"]')!;
    const initialVideoEl = doc.querySelector<HTMLVideoElement>('video')!;
    assert(playerContainer && initialVideoEl, 'Container e elemento <video> devem existir');
    assert.strictEqual(
      activeHlsControllers.length,
      1,
      'Deve haver exatamente 1 instância HLS criada para o canal'
    );

    // Verificação 1: embedded=true com preview normal usa controles compactos
    assert.strictEqual(
      playerContainer.getAttribute('data-player-presentation'),
      'compact-preview',
      'Preview normal da TV ao Vivo deve usar apresentação compact-preview'
    );
    assert.strictEqual(
      doc.querySelector('[data-player-center-title="true"]') === null,
      true,
      'No modo compact-preview não deve renderizar a barra centralizada de tela cheia'
    );

    // Verificação 2: Simular entrada em fullscreen nativo (isFullscreen=true, isVisuallyExpanded=false)
    let currentFsElement: Element | null = null;
    Object.defineProperty(doc, 'fullscreenElement', {
      get: () => currentFsElement,
      configurable: true,
    });
    (playerContainer as any).requestFullscreen = async () => {
      currentFsElement = playerContainer;
      doc.dispatchEvent(new Event('fullscreenchange'));
    };
    (doc as any).exitFullscreen = async () => {
      currentFsElement = null;
      doc.dispatchEvent(new Event('fullscreenchange'));
    };

    const fsBtnInPreview = doc.querySelector<HTMLButtonElement>(
      'button[data-player-control="fullscreen"]'
    )!;
    await act(async () => {
      fsBtnInPreview.click();
      await new Promise((r) => setTimeout(r, 20));
    });

    assert.strictEqual(
      playerContainer.getAttribute('data-player-presentation'),
      'full-layer',
      'Em fullscreen nativo (mesmo com isVisuallyExpanded=false), o player de TV ao Vivo DEVE passar para full-layer'
    );
    const centerTitleInNativeFs = doc.querySelector<HTMLElement>('[data-player-center-title="true"]');
    assert(
      centerTitleInNativeFs,
      'Em fullscreen nativo na TV ao Vivo, os controles devem usar o layout modernizado com título centralizado'
    );
    assert(
      centerTitleInNativeFs.textContent?.includes('SporTV HD') &&
        centerTitleInNativeFs.textContent?.includes('Campeonato Brasileiro Ao Vivo'),
      `Título centralizado em fullscreen deve exibir canal e programa atual. Obtido: ${centerTitleInNativeFs.textContent}`
    );

    // Verificação 5: TV ao Vivo em fullscreen NÃO apresenta velocidade nem avanço/retrocesso de 10s
    assert.strictEqual(
      doc.querySelector('button[data-player-control="speed"]') === null,
      true,
      'TV ao Vivo em tela cheia NÃO deve exibir botão de Velocidade'
    );
    assert.strictEqual(
      doc.querySelector('button[data-player-control="seek-back"]') === null,
      true,
      'TV ao Vivo sem suporte de seeking NÃO deve exibir botão Retroceder 10s'
    );
    assert.strictEqual(
      doc.querySelector('button[data-player-control="seek-forward"]') === null,
      true,
      'TV ao Vivo sem suporte de seeking NÃO deve exibir botão Avançar 10s'
    );
    assert(
      doc.querySelector('button[data-player-control="audio-subtitles"]'),
      'TV ao Vivo em tela cheia deve exibir botão de Áudio e Legendas'
    );

    // Verificação 4: Sair de fullscreen com Voltar restaura o preview compacto sem reiniciar o vídeo nem fechar o canal
    await act(async () => {
      executeBackAction();
      await new Promise((r) => setTimeout(r, 25));
    });

    assert.strictEqual(
      playerContainer.getAttribute('data-player-presentation'),
      'compact-preview',
      'Ao sair de fullscreen nativo, deve restaurar os controles compactos do preview'
    );
    assert.strictEqual(
      doc.querySelector('video') === initialVideoEl,
      true,
      'O elemento <video> não deve ser desmontado nem recriado ao alternar entre preview e fullscreen'
    );
    assert.strictEqual(
      activeHlsControllers.length,
      1,
      'A sessão de reprodução HLS não deve ser reiniciada ao sair de fullscreen para o preview'
    );
    assert.strictEqual(
      previewBackCalled,
      0,
      'Sair de fullscreen para o preview NÃO deve fechar o canal selecionado'
    );

    // Verificação 3: Simular expansão visual alternativa (quando requestFullscreen falha -> isVisuallyExpanded=true)
    delete (playerContainer as any).requestFullscreen;
    const fsBtnAgain = doc.querySelector<HTMLButtonElement>(
      'button[data-player-control="fullscreen"]'
    )!;
    await act(async () => {
      fsBtnAgain.click();
      await new Promise((r) => setTimeout(r, 20));
    });

    assert.strictEqual(
      playerContainer.getAttribute('data-player-presentation'),
      'full-layer',
      'Expansão visual alternativa (isVisuallyExpanded=true) também deve renderizar o layout modernizado full-layer'
    );
    assert(
      doc.querySelector('[data-player-center-title="true"]'),
      'Expansão visual alternativa deve exibir o título centralizado na barra inferior'
    );

    // Sair da expansão visual alternativa via botão Voltar do topo
    const topBackBtn = doc.querySelector<HTMLButtonElement>('button[data-player-control="back"]')!;
    await act(async () => {
      topBackBtn.click();
      await new Promise((r) => setTimeout(r, 20));
    });

    assert.strictEqual(
      playerContainer.getAttribute('data-player-presentation'),
      'compact-preview',
      'Sair da expansão visual alternativa deve restaurar o preview compacto'
    );
    assert.strictEqual(
      activeHlsControllers.length,
      1,
      'Nenhuma reinicialização do motor HLS deve ocorrer após sair da expansão visual'
    );
  } finally {
    delete (doc as any).fullscreenElement;
    delete (doc as any).exitFullscreen;
    clearAllBackHandlersForTest();
    await act(async () => {
      root.unmount();
    });
    container.remove();
    restoreHlsMock();
  }

  console.log('✅ TV ao Vivo (preview compacto, fullscreen nativo, expansão visual e retorno intacto) validada!');
}

// ============================================================================
// 3. CICLO 12.29-b.1 — PARTE B E C: PADRONIZAÇÃO BRANCA, FILMES, SÉRIES,
//    SUBMENUS DIRETOS E FOCO D-PAD / VOLTAR
// ============================================================================
async function runWhitePaletteAndControlsIntegrationTests(): Promise<void> {
  console.log('--- 3. Identidade Visual Branca, Filmes, Séries, Submenus e Foco D-Pad/Voltar ---');

  enableDeterministicHlsMock();
  nextHlsInitialTracks = {
    audioTracks: [
      { id: 0, name: 'Português', lang: 'pt-BR', default: true },
      { id: 1, name: 'Original', lang: 'en', default: false },
    ],
    subtitleTracks: [{ id: 0, name: 'Português', lang: 'pt-BR', forced: false }],
    audioTrack: 0,
    subtitleTrack: 0,
  };

  const doc: Document = windowInstance.document as unknown as Document;
  (doc as any).pictureInPictureEnabled = true;
  setNavMode('remote');
  clearAllBackHandlersForTest();

  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container);

  const origXtreamMethods = {
    authenticate: XtreamService.authenticate,
    getLiveCategories: XtreamService.getLiveCategories,
    getVodCategories: XtreamService.getVodCategories,
    getSeriesCategories: XtreamService.getSeriesCategories,
    getLiveStreams: XtreamService.getLiveStreams,
    getVodStreams: XtreamService.getVodStreams,
    getSeries: XtreamService.getSeries,
    getShortEpg: XtreamService.getShortEpg,
  };

  try {
    // Renderizar Série com carregando ativo inicialmente para inspecionar spinner, progresso, thumb, volume e indicador de legenda
    await act(async () => {
      root.render(
        React.createElement(VideoPlayer, {
          streamUrl: 'http://server.tv:8080/series/user/pass/3001.m3u8',
          title: 'Luna Nera - S1E1',
          programTitle: 'Presságio',
          contentType: 'episode',
          isLoading: true,
          onBack: () => {},
          onNext: () => {},
          onPrevious: () => {},
        })
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25));
    });

    const playerRoot = doc.querySelector<HTMLElement>('[data-player-container="true"]')!;
    const htmlSnapshot = playerRoot.innerHTML;
    assert(
      !htmlSnapshot.includes('#E50914') && !htmlSnapshot.includes('e50914'),
      'Nenhum valor vermelho decorativo (#E50914) deve existir na marcação do player'
    );

    const progressBar = doc.querySelector<HTMLElement>('[data-player-progress-bar="true"]')!;
    const timelineThumb = doc.querySelector<HTMLElement>('[data-player-timeline-thumb="true"]')!;
    const spinner = doc.querySelector<HTMLElement>('[data-player-spinner="true"]')!;
    const volumeSlider = doc.querySelector<HTMLElement>(
      'input[data-player-control="volume-slider"]'
    )!;
    const subActiveDot = doc.querySelector<HTMLElement>(
      '[data-player-subtitles-active-dot="true"]'
    )!;

    assert(progressBar.className.includes('bg-nc-primary'), 'Barra de progresso deve usar bg-nc-primary (branco)');
    assert(timelineThumb.className.includes('bg-nc-primary'), 'Marcador circular deve usar bg-nc-primary (branco)');
    assert(spinner.className.includes('border-nc-primary'), 'Spinner de carregamento deve usar border-nc-primary (branco)');
    assert(
      volumeSlider.className.includes('accent-nc-primary') &&
        volumeSlider.className.includes('nc-player-volume-slider'),
      'Slider de volume deve usar accent-nc-primary e nc-player-volume-slider (branco)'
    );
    assert(
      subActiveDot.className.includes('bg-nc-primary'),
      'Indicador de legenda ativa deve usar bg-nc-primary (branco)'
    );

    // Verificar estrutura responsiva .nc-player-bottom-layout com grupos left, title-cell e right
    const bottomRow = doc.querySelector<HTMLElement>('[data-nav-row="player-bottom"]')!;
    assert(
      bottomRow.className.includes('nc-player-bottom-layout'),
      'Fileira inferior deve usar a classe responsiva nc-player-bottom-layout'
    );
    assert(
      bottomRow.querySelector('.nc-player-title-cell[data-player-center-title="true"]'),
      'Célula do título deve usar nc-player-title-cell'
    );
    assert(
      bottomRow.querySelector('.nc-player-left-group[data-player-group="left"]'),
      'Grupo esquerdo deve usar nc-player-left-group'
    );
    assert(
      bottomRow.querySelector('.nc-player-right-group[data-player-group="right"]'),
      'Grupo direito deve usar nc-player-right-group'
    );

    // Testar abertura direta de Áudio e Legendas + Velocidade e restauração de foco com Voltar
    const audioSubBtn = doc.querySelector<HTMLButtonElement>(
      'button[data-player-control="audio-subtitles"]'
    )!;
    await act(async () => {
      audioSubBtn.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    const settingsMenu = doc.querySelector<HTMLElement>('[data-player-settings-menu="true"]');
    assert(settingsMenu, 'Menu deve abrir ao clicar em Áudio e Legendas');
    assert.strictEqual(settingsMenu.getAttribute('data-active-submenu'), 'subtitles');

    await act(async () => {
      executeBackAction();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    assert.strictEqual(
      doc.querySelector('[data-player-settings-menu="true"]') === null,
      true,
      'Menu deve fechar ao pressionar Voltar'
    );
    assert.strictEqual(
      doc.activeElement === doc.querySelector('button[data-player-control="audio-subtitles"]'),
      true,
      'Voltar deve devolver o foco exatamente para o botão Áudio e Legendas'
    );

    const speedBtn = doc.querySelector<HTMLButtonElement>('button[data-player-control="speed"]')!;
    await act(async () => {
      speedBtn.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    assert.strictEqual(
      doc.querySelector('[data-player-settings-menu="true"]')?.getAttribute('data-active-submenu'),
      'speed'
    );

    await act(async () => {
      executeBackAction();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    assert.strictEqual(
      doc.activeElement === doc.querySelector('button[data-player-control="speed"]'),
      true,
      'Voltar deve devolver o foco exatamente para o botão Velocidade'
    );

    // Fechar o VideoPlayer antes de montar LiveTvView e restaurar o mock HLS
    await act(async () => {
      root.render(null);
    });
    restoreHlsMock();

    // Regressão essencial da página LiveTvView completa
    const testCreds: XtreamCredentials = {
      serverUrl: 'http://provider.tv:8080',
      username: 'u',
      password: 'p',
    };
    (XtreamService as any).authenticate = async () => ({
      user_info: { auth: 1, status: 'Active' },
      server_info: {},
    });
    (XtreamService as any).getLiveCategories = async () => [
      { category_id: '10', category_name: 'Esportes' },
    ];
    (XtreamService as any).getVodCategories = async () => [];
    (XtreamService as any).getSeriesCategories = async () => [];
    (XtreamService as any).getLiveStreams = async () => [
      {
        stream_id: 501,
        name: 'SporTV HD',
        category_id: '10',
        stream_icon: '',
      },
    ];
    (XtreamService as any).getVodStreams = async () => [];
    (XtreamService as any).getSeries = async () => [];
    (XtreamService as any).getShortEpg = async () => ({ epg_listings: [] });

    await act(async () => {
      root.render(
        React.createElement(
          XtreamProvider,
          { credentials: testCreds },
          React.createElement(LiveTvView, {
            searchQuery: '',
          })
        )
      );
    });

    for (let attempt = 0; attempt < 10; attempt++) {
      if (doc.querySelector('[data-live-channel-id="501"]')) {
        break;
      }
      await act(async () => {
        await new Promise((r) => setTimeout(r, 15));
      });
    }

    assert(
      doc.querySelector('[data-live-channel-id="501"]'),
      'LiveTvView deve renderizar cartões de canais sem regressão'
    );
  } finally {
    Object.assign(XtreamService, origXtreamMethods);
    clearAllBackHandlersForTest();
    await act(async () => {
      root.unmount();
    });
    container.remove();
    restoreHlsMock();
  }

  console.log('✅ Identidade visual branca, controles responsivos, submenus e foco validados!');
}

// ============================================================================
// 4. CICLO 12.30-b — OTIMIZAÇÃO CIRÚRGICA DA NAVEGAÇÃO D-PAD EM MOVIMENTOS RÁPIDOS
// ============================================================================
async function runCycle1230bSpatialNavOptimizationTests(): Promise<void> {
  console.log('--- 4. Ciclo 12.30-b: Caminho Rápido D-Pad, Virtualização, HorizontalRow e Regressão ---');

  const doc: Document = windowInstance.document as unknown as Document;
  setNavMode('remote');
  clearAllBackHandlersForTest();
  clearFocusMemory();
  setFastHorizontalRowNavEnabledForTest(true);

  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container);

  const testCreds: XtreamCredentials = {
    serverUrl: 'http://provider.tv:8080',
    username: 'u',
    password: 'p',
  };

  try {
    // -------------------------------------------------------------------------
    // 4.1. Caminho rápido vs Caminho tradicional (métricas determinísticas de
    //      consultas globais e leituras de geometria) + HorizontalRow sem
    //      re-renderizações desnecessárias em sequência rápida de setas
    // -------------------------------------------------------------------------
    const items40 = Array.from({ length: 40 }, (_, i) => ({
      stream_id: 1000 + i,
      name: `Filme ${i}`,
      stream_icon: `http://img.test/${i}.jpg`,
      rating: '8.5',
    }));

    let customCardRenderCalls = 0;
    const renderStates = new Map<number, { isAuthorized: boolean; isFocused: boolean }>();

    await act(async () => {
      root.render(
        React.createElement(
          XtreamProvider,
          { credentials: testCreds },
          React.createElement(
            'div',
            { 'data-nav-zone': ' main-shell' },
            // Sidebar para testar fronteira esquerda (índice 0 -> ArrowLeft)
            React.createElement(
              'aside',
              { 'data-nav-zone': 'sidebar' },
              React.createElement(
                'button',
                {
                  type: 'button',
                  'data-nav-item': 'true',
                  'data-sidebar-item': 'home',
                },
                'Início'
              )
            ),
            // Barra de filtros estilo Favoritos para testar fronteira superior
            React.createElement(
              'div',
              { 'data-favorites-view': 'true' },
              React.createElement(
                'div',
                {
                  'data-nav-zone': 'categories',
                  'data-showcase-categories-bar': 'true',
                },
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    'data-nav-item': 'true',
                    'data-category-selected': 'true',
                    'data-fav-filter': 'all',
                  },
                  'Todos'
                )
              ),
              // Zona de conteúdo com múltiplos candidatos extras para evidenciar custo de varredura global
              React.createElement(
                'div',
                {
                  'data-nav-zone': 'content',
                  'data-scroll-container': 'true',
                  style: { overflowY: 'auto', height: '720px' },
                },
                React.createElement(HorizontalRow, {
                  title: 'Destaques',
                  items: items40,
                  type: 'vod',
                  virtualize: true,
                  rowIndex: 0,
                  onItemClick: () => {},
                  renderCardItem: (params) => {
                    customCardRenderCalls++;
                    renderStates.set(params.index, {
                      isAuthorized: params.isAuthorized,
                      isFocused: params.isFocused,
                    });
                    return React.createElement(
                      'div',
                      {
                        key: params.itemKey,
                        ref: params.setCardRef,
                        tabIndex: 0,
                        role: 'button',
                        'data-nav-item': 'true',
                        'data-row-card-index': params.index,
                        'data-virtual-index': params.virtualize ? params.index : undefined,
                        'data-row-item-key': params.itemKey,
                        'data-card-focused': params.isFocused ? 'true' : 'false',
                        'data-card-authorized': params.isAuthorized ? 'true' : 'false',
                        onFocus: params.onFocusCard,
                        onBlur: params.onBlurCard,
                      },
                      params.item.name
                    );
                  },
                }),
                // Segunda fileira para testar navegação vertical entre fileiras
                React.createElement(HorizontalRow, {
                  title: 'Lançamentos',
                  items: items40.slice(0, 12),
                  type: 'vod',
                  virtualize: true,
                  rowIndex: 1,
                  onItemClick: () => {},
                })
              )
            )
          )
        )
      );
    });

    const row0 = doc.querySelectorAll<HTMLElement>('[data-nav-row="true"]')[0]!;
    const card0 = row0.querySelector<HTMLElement>('[data-row-card-index="0"]')!;
    assert(row0 && card0, 'Fileira 0 e cartão 0 devem estar montados');

    // Focar cartão 0 inicialmente
    await act(async () => {
      focusElementSafely(card0);
    });
    assert.strictEqual(doc.activeElement, card0, 'Cartão 0 deve estar focado');
    assert.strictEqual(
      card0.getAttribute('data-card-focused'),
      'true',
      'Cartão 0 deve ter data-card-focused="true"'
    );
    assert.strictEqual(
      card0.getAttribute('data-card-authorized'),
      'true',
      'Cartão 0 deve ativar autorização de imagem imediatamente ao receber foco'
    );

    // A) Medir 5 movimentos rápidos (0 -> 1 -> 2 -> 3 -> 4 -> 5) no CAMINHO RÁPIDO via espião DOM local
    invalidateCandidateCache();
    setFastHorizontalRowNavEnabledForTest(true);

    const { metrics: fastStats } = await measureDomCallsAsync(doc, windowInstance, async () => {
      await act(async () => {
        for (let step = 1; step <= 5; step++) {
          const next = moveSpatialFocus('right');
          assert.strictEqual(
            next?.getAttribute('data-row-card-index'),
            String(step),
            `Passo ${step} (rápido) deve focar o cartão ${step}`
          );
        }
      });
    });

    const card5 = row0.querySelector<HTMLElement>('[data-row-card-index="5"]')!;
    assert.strictEqual(doc.activeElement, card5, 'Foco deve estar no cartão 5 após sequência rápida');
    assert.strictEqual(
      card0.getAttribute('data-card-focused'),
      'false',
      'Cartão 0 deve ter data-card-focused="false" após perder foco'
    );
    assert.strictEqual(
      card5.getAttribute('data-card-focused'),
      'true',
      'Cartão 5 deve ter data-card-focused="true" ao receber foco'
    );

    // Agora os cartões 0..5 já estão autorizados. Verificar que navegar de volta 5 -> 4 -> 3 -> 2 -> 1 -> 0
    // NÃO dispara nenhuma re-renderização da fileira inteira em HorizontalRow!
    const renderCallsBeforeAuthorizedBackSequence = customCardRenderCalls;
    await act(async () => {
      for (let step = 4; step >= 0; step--) {
        const prev = moveSpatialFocus('left');
        assert.strictEqual(
          prev?.getAttribute('data-row-card-index'),
          String(step),
          `Passo reverso para ${step} deve focar cartão ${step}`
        );
      }
    });
    const renderCallsAfterAuthorizedBackSequence = customCardRenderCalls;
    assert.strictEqual(
      renderCallsAfterAuthorizedBackSequence,
      renderCallsBeforeAuthorizedBackSequence,
      `HorizontalRow não deve re-renderizar a fileira inteira ao mover foco entre cartões já autorizados (antes=${renderCallsBeforeAuthorizedBackSequence}, depois=${renderCallsAfterAuthorizedBackSequence})`
    );
    assert.strictEqual(
      card0.getAttribute('data-card-focused'),
      'true',
      'Cartão 0 deve voltar a ter data-card-focused="true" sem exigir re-render da fileira'
    );
    assert.strictEqual(
      card5.getAttribute('data-card-focused'),
      'false',
      'Cartão 5 deve voltar a ter data-card-focused="false"'
    );

    // B) Medir os mesmos 5 movimentos (0 -> 1 -> 2 -> 3 -> 4 -> 5) no CAMINHO TRADICIONAL via espião DOM local
    invalidateCandidateCache();
    setFastHorizontalRowNavEnabledForTest(false);

    const { metrics: traditionalStats } = await measureDomCallsAsync(doc, windowInstance, async () => {
      await act(async () => {
        for (let step = 1; step <= 5; step++) {
          const next = moveSpatialFocus('right');
          assert.strictEqual(
            next?.getAttribute('data-row-card-index'),
            String(step),
            `Passo ${step} (tradicional) deve focar o cartão ${step}`
          );
        }
      });
    });

    setFastHorizontalRowNavEnabledForTest(true);

    assert.strictEqual(
      fastStats.querySelectorCalls,
      0,
      `Caminho rápido não deve executar querySelectorAll global de candidatos (obtido: ${fastStats.querySelectorCalls})`
    );
    assert(
      fastStats.querySelectorCalls < traditionalStats.querySelectorCalls,
      `Caminho rápido deve realizar menos consultas globais que o caminho tradicional (fast=${fastStats.querySelectorCalls}, trad=${traditionalStats.querySelectorCalls})`
    );
    assert(
      fastStats.boundingRectCalls < traditionalStats.boundingRectCalls,
      `Caminho rápido deve realizar menos leituras de geometria que o caminho tradicional (fast=${fastStats.boundingRectCalls}, trad=${traditionalStats.boundingRectCalls})`
    );
    assert(
      fastStats.computedStyleCalls < traditionalStats.computedStyleCalls,
      `Caminho rápido deve realizar menos chamadas a getComputedStyle que o caminho tradicional (fast=${fastStats.computedStyleCalls}, trad=${traditionalStats.computedStyleCalls})`
    );

    // -------------------------------------------------------------------------
    // 4.2. Fronteira esquerda (índice 0 -> ArrowLeft para sidebar) e travessia
    //      de janelas virtualizadas (0 -> 22 -> 0)
    // -------------------------------------------------------------------------
    await act(async () => {
      focusElementSafely(card0);
    });
    assert.strictEqual(doc.activeElement, card0);

    // No índice 0, ArrowLeft deve cair no fallback e sair para a sidebar
    const leftBoundaryTarget = moveSpatialFocus('left');
    assert.strictEqual(
      leftBoundaryTarget?.getAttribute('data-sidebar-item'),
      'home',
      'ArrowLeft a partir do cartão 0 deve usar o fallback de fronteira e focar a sidebar'
    );

    // Voltar para o cartão 0 e atravessar a janela virtualizada até o cartão 22
    await act(async () => {
      focusElementSafely(card0);
    });
    assert.strictEqual(
      row0.querySelector('[data-row-card-index="22"]'),
      null,
      'Cartão 22 não deve estar montado antes da travessia da janela virtualizada'
    );

    await act(async () => {
      for (let idx = 1; idx <= 22; idx++) {
        const focused = moveSpatialFocus('right');
        assert.strictEqual(
          focused?.getAttribute('data-row-card-index'),
          String(idx),
          `Travessia virtualizada deve montar e focar o cartão ${idx}`
        );
      }
    });

    assert(
      row0.querySelector('[data-row-card-index="22"]') !== null,
      'Atravessar além da janela inicial deve expandir a janela virtualizada sincronicamente e montar o cartão 22'
    );
    assert.strictEqual(
      doc.activeElement?.getAttribute('data-row-card-index'),
      '22',
      'Cartão 22 deve estar montado e focado após expansão da janela virtual'
    );

    // -------------------------------------------------------------------------
    // 4.3. Restauração de foco (pushFocusMemory / popFocusMemory) após abrir e
    //      fechar detalhes ou player em fileira virtualizada
    // -------------------------------------------------------------------------
    const activeCard22 = doc.activeElement as HTMLElement;
    pushFocusMemory(activeCard22);

    // Simular abertura de modal de detalhes/player com escopo próprio [data-focus-scope="modal"]
    const modalEl = doc.createElement('div');
    modalEl.setAttribute('data-focus-scope', 'modal');
    const modalBtn1 = doc.createElement('button');
    modalBtn1.setAttribute('data-nav-item', 'true');
    modalBtn1.setAttribute('data-row-card-index', '0');
    modalBtn1.textContent = 'Assistir Agora';
    modalEl.appendChild(modalBtn1);
    doc.body.appendChild(modalEl);

    await act(async () => {
      focusElementSafely(modalBtn1);
    });
    assert.strictEqual(doc.activeElement, modalBtn1, 'Foco deve entrar no modal');

    // Dentro do modal, moveSpatialFocus('right') não deve escapar para a fileira de fundo
    const insideModalMove = moveSpatialFocus('right');
    assert.strictEqual(
      insideModalMove,
      modalBtn1,
      'Movimento horizontal dentro de um modal não deve escapar do escopo [data-focus-scope="modal"]'
    );

    // Fechar o modal e restaurar foco via popFocusMemory()
    modalEl.remove();
    let restoredOk = false;
    await act(async () => {
      restoredOk = popFocusMemory();
    });
    assert.strictEqual(
      restoredOk,
      true,
      'popFocusMemory deve retornar true ao restaurar o foco após fechar detalhes/player'
    );
    assert.strictEqual(
      doc.activeElement?.getAttribute('data-row-card-index'),
      '22',
      'document.activeElement deve ser o cartão 22 restaurado'
    );

    // -------------------------------------------------------------------------
    // 4.4. Navegação vertical entre fileiras e subida para o filtro de Favoritos
    // -------------------------------------------------------------------------
    await act(async () => {
      const c0 = row0.querySelector<HTMLElement>('[data-row-card-index="0"]');
      if (c0) {
        focusElementSafely(c0);
      } else {
        // Garantir montagem do índice 0 voltando à esquerda
        for (let idx = 21; idx >= 0; idx--) {
          moveSpatialFocus('left');
        }
      }
    });
    assert.strictEqual(
      doc.activeElement?.getAttribute('data-row-card-index'),
      '0',
      'Deve voltar ao cartão 0 da 1ª fileira'
    );

    let downToRow1: HTMLElement | null = null;
    await act(async () => {
      downToRow1 = moveSpatialFocus('down');
    });
    const row1 = doc.querySelectorAll<HTMLElement>('[data-nav-row="true"]')[1]!;
    assert(
      downToRow1 && row1.contains(downToRow1),
      'ArrowDown a partir da fileira 0 deve descer para a fileira 1'
    );

    let upToRow0: HTMLElement | null = null;
    await act(async () => {
      upToRow0 = moveSpatialFocus('up');
    });
    assert(
      upToRow0 && row0.contains(upToRow0),
      'ArrowUp a partir da fileira 1 deve subir de volta para a fileira 0'
    );

    let upToFavFilter: HTMLElement | null = null;
    await act(async () => {
      upToFavFilter = moveSpatialFocus('up');
    });
    assert.strictEqual(
      upToFavFilter?.getAttribute('data-fav-filter'),
      'all',
      'ArrowUp da 1ª seção em Favoritos deve subir diretamente para o filtro ativo ("Todos")'
    );

    // -------------------------------------------------------------------------
    // 4.5. TV ao Vivo (LiveCategoryRow: botão principal do canal via caminho
    //      rápido e botão secundário de favorito via fallback) + Grade de Busca
    // -------------------------------------------------------------------------
    const liveRowEl = doc.createElement('div');
    liveRowEl.setAttribute('data-nav-zone', 'categories');
    liveRowEl.setAttribute('data-nav-row', 'true');
    liveRowEl.setAttribute('data-live-category-row-scroll', 'true');

    const chCard0 = doc.createElement('div');
    chCard0.setAttribute('data-live-channel-card', 'true');
    const chBtn0 = doc.createElement('button');
    chBtn0.setAttribute('data-nav-item', 'true');
    chBtn0.setAttribute('data-row-card-index', '0');
    chBtn0.setAttribute('data-live-channel-btn', 'true');
    const chFav0 = doc.createElement('button');
    chFav0.setAttribute('data-nav-item', 'true');
    chFav0.setAttribute('data-row-fav-index', '0');
    chFav0.setAttribute('data-live-channel-fav', 'true');
    chCard0.appendChild(chBtn0);
    chCard0.appendChild(chFav0);

    const chCard1 = doc.createElement('div');
    chCard1.setAttribute('data-live-channel-card', 'true');
    const chBtn1 = doc.createElement('button');
    chBtn1.setAttribute('data-nav-item', 'true');
    chBtn1.setAttribute('data-row-card-index', '1');
    chBtn1.setAttribute('data-live-channel-btn', 'true');
    chCard1.appendChild(chBtn1);

    liveRowEl.appendChild(chCard0);
    liveRowEl.appendChild(chCard1);
    doc.body.appendChild(liveRowEl);

    await act(async () => {
      focusElementSafely(chBtn0);
    });
    const { result: movedToCh1, metrics: liveFastStats } = measureDomCallsSync(
      doc,
      windowInstance,
      () => moveSpatialFocus('right')
    );
    assert.strictEqual(movedToCh1, chBtn1, 'Caminho rápido deve avançar de chBtn0 para chBtn1 na TV ao Vivo');
    assert.strictEqual(
      liveFastStats.querySelectorCalls,
      0,
      'Caminho rápido na fileira de canais da TV ao Vivo não deve realizar varredura global'
    );

    // Quando focado no botão secundário de favorito (data-live-channel-fav="true"), ArrowLeft deve voltar ao chBtn0 via fallback
    await act(async () => {
      focusElementSafely(chFav0);
    });
    const backToChMain = moveSpatialFocus('left');
    assert.strictEqual(
      backToChMain,
      chBtn0,
      'ArrowLeft no botão de favorito do canal deve retornar ao botão principal do mesmo cartão via fallback'
    );
    liveRowEl.remove();

    // -------------------------------------------------------------------------
    // 4.6. Cache de alinhamento vertical em ensureElementScrolledIntoView():
    //      se a posição real da fileira mudar sem alteração do scrollTop,
    //      a rolagem vertical necessária deve ocorrer normalmente
    // -------------------------------------------------------------------------
    const scrollContainerEl = doc.querySelector<HTMLElement>('[data-scroll-container="true"]')!;
    const row0Wrapper = row0.closest<HTMLElement>('[data-home-row-index="0"]')!;
    await act(async () => {
      const c0 = row0.querySelector<HTMLElement>('[data-row-card-index="0"]')!;
      focusElementSafely(c0);
    });
    assert.strictEqual(scrollContainerEl.scrollTop, 0);

    // Simular que a posição real de row0Wrapper mudou para abaixo da área visível
    // sem qualquer alteração em scrollContainerEl.scrollTop (que permanece 0)
    (scrollContainerEl as any).getBoundingClientRect = () => ({
      top: 0,
      bottom: 500,
      left: 0,
      right: 1280,
      width: 1280,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    (row0Wrapper as any).getBoundingClientRect = () => ({
      top: 400,
      bottom: 650,
      left: 0,
      right: 1280,
      width: 1280,
      height: 250,
      x: 0,
      y: 400,
      toJSON: () => ({}),
    });

    await act(async () => {
      moveSpatialFocus('right');
    });
    assert(
      scrollContainerEl.scrollTop > 0,
      `Quando a posição real da fileira mudar para fora da viewport sem alterar scrollTop, ensureElementScrolledIntoView deve rolar verticalmente (scrollTop=${scrollContainerEl.scrollTop})`
    );
    delete (scrollContainerEl as any).getBoundingClientRect;
    delete (row0Wrapper as any).getBoundingClientRect;
    scrollContainerEl.scrollTop = 0;

    // Ausência de regressão entre modos pointer (mouse/toque) e remote (D-Pad)
    setNavMode('pointer');
    assert.strictEqual(getNavMode(), 'pointer');
    setNavMode('remote');
    assert.strictEqual(getNavMode(), 'remote');
  } finally {
    setFastHorizontalRowNavEnabledForTest(true);
    clearAllBackHandlersForTest();
    clearFocusMemory();
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }

  console.log('✅ Ciclo 12.30-b (caminho rápido D-Pad, virtualização, HorizontalRow e regressão) validado!');
}

// ============================================================================
// 5. CICLO 12.30-c — OTIMIZAÇÃO CIRÚRGICA DA NAVEGAÇÃO VERTICAL D-PAD
// ============================================================================
async function runCycle1230cVerticalNavOptimizationTests(): Promise<void> {
  console.log('--- 5. Ciclo 12.30-c: Caminho Rápido Vertical D-Pad (Fileiras, Grades Virtualizadas, Alinhamento Visual e Fallbacks) ---');

  const doc: Document = windowInstance.document as unknown as Document;
  setNavMode('remote');
  clearAllBackHandlersForTest();
  clearFocusMemory();
  setFastHorizontalRowNavEnabledForTest(true);
  setFastVerticalNavEnabledForTest(true);

  const shellEl = doc.createElement('div');
  doc.body.appendChild(shellEl);

  let showcaseContainerEl: HTMLElement | null = null;
  let virtualGridEl: HTMLElement | null = null;

  try {
    // -------------------------------------------------------------------------
    // 5.1. Caminho vertical rápido vs tradicional em fileiras de vitrine
    //      ([data-showcase-rows-container="true"]) + ausência de chamadas
    //      duplicadas a ensureRowMounted + travessia de janela virtualizada
    // -------------------------------------------------------------------------
    const headerZone = doc.createElement('header');
    headerZone.setAttribute('data-nav-zone', 'header');
    for (let i = 0; i < 6; i++) {
      const hBtn = doc.createElement('button');
      hBtn.setAttribute('data-nav-item', 'true');
      if (i === 0) hBtn.setAttribute('data-header-nav-active', 'true');
      hBtn.textContent = `Menu ${i}`;
      headerZone.appendChild(hBtn);
    }
    shellEl.appendChild(headerZone);

    const categoriesBar = doc.createElement('div');
    categoriesBar.setAttribute('data-nav-zone', 'categories');
    categoriesBar.setAttribute('data-showcase-categories-bar', 'true');
    const selectedCategoryBtn = doc.createElement('button');
    selectedCategoryBtn.setAttribute('data-nav-item', 'true');
    selectedCategoryBtn.setAttribute('data-category-selected', 'true');
    selectedCategoryBtn.setAttribute('data-cat-id', 'todos');
    selectedCategoryBtn.textContent = 'Todos';
    categoriesBar.appendChild(selectedCategoryBtn);
    for (let i = 1; i <= 10; i++) {
      const catBtn = doc.createElement('button');
      catBtn.setAttribute('data-nav-item', 'true');
      catBtn.textContent = `Categoria ${i}`;
      categoriesBar.appendChild(catBtn);
    }
    shellEl.appendChild(categoriesBar);

    const contentScrollEl = doc.createElement('div');
    contentScrollEl.setAttribute('data-nav-zone', 'content');
    contentScrollEl.setAttribute('data-scroll-container', 'true');
    shellEl.appendChild(contentScrollEl);

    showcaseContainerEl = doc.createElement('div');
    showcaseContainerEl.setAttribute('data-showcase-rows-container', 'true');
    const totalShowcaseRows = 10;
    const windowSize = 6;
    let currentWindowStart = 0;
    let ensureRowMountedCalls = 0;
    const rowNodesByIndex = new Map<number, HTMLElement>();

    const renderShowcaseRowsWindow = (startRow: number) => {
      if (!showcaseContainerEl) return;
      showcaseContainerEl.setAttribute('data-showcase-total-rows', String(totalShowcaseRows));
      const endRow = Math.min(totalShowcaseRows, startRow + windowSize);

      for (const [rIdx, node] of Array.from(rowNodesByIndex.entries())) {
        if (rIdx < startRow || rIdx >= endRow) {
          node.remove();
          rowNodesByIndex.delete(rIdx);
        }
      }

      let prevNode: HTMLElement | null = null;
      for (let r = startRow; r < endRow; r++) {
        let rowWrapper = rowNodesByIndex.get(r);
        if (!rowWrapper) {
          rowWrapper = doc.createElement('div');
          rowWrapper.setAttribute('data-home-row-index', String(r));
          rowWrapper.setAttribute('data-scroll-block', 'true');
          if (r === 0) {
            rowWrapper.setAttribute('data-scroll-top-anchor', 'true');
          }

          const rowScroll = doc.createElement('div');
          rowScroll.setAttribute('data-nav-row', 'true');
          for (let c = 0; c < 12; c++) {
            const card = doc.createElement('div');
            card.setAttribute('tabindex', '0');
            card.setAttribute('role', 'button');
            card.setAttribute('data-nav-item', 'true');
            card.setAttribute('data-row-card-index', String(c));
            card.setAttribute('data-test-pos', `r${r}-c${c}`);
            card.textContent = `Fileira ${r} Cartão ${c}`;
            rowScroll.appendChild(card);
          }
          rowWrapper.appendChild(rowScroll);
          rowNodesByIndex.set(r, rowWrapper);
        }
        if (rowWrapper.parentElement !== showcaseContainerEl) {
          const refNode = prevNode ? prevNode.nextSibling : showcaseContainerEl.firstChild;
          showcaseContainerEl.insertBefore(rowWrapper, refNode);
        }
        prevNode = rowWrapper;
      }
    };

    renderShowcaseRowsWindow(0);
    contentScrollEl.appendChild(showcaseContainerEl);

    let showcaseRowWindowExpansions = 0;
    registerShowcaseRowController(showcaseContainerEl, {
      totalRows: totalShowcaseRows,
      ensureRowMounted: (targetRowIndex: number) => {
        ensureRowMountedCalls++;
        const curEnd = currentWindowStart + windowSize;
        if (targetRowIndex >= currentWindowStart && targetRowIndex < curEnd) {
          return false;
        }
        const nextStart = Math.max(
          0,
          Math.min(totalShowcaseRows - windowSize, targetRowIndex - 2)
        );
        if (nextStart === currentWindowStart) {
          return false;
        }
        currentWindowStart = nextStart;
        renderShowcaseRowsWindow(currentWindowStart);
        showcaseRowWindowExpansions++;
        return true;
      },
    });

    // Focar Fileira 0 Cartão 0
    const getRowCard = (r: number, c: number) =>
      showcaseContainerEl!.querySelector<HTMLElement>(
        `[data-home-row-index="${r}"] [data-row-card-index="${c}"]`
      );

    focusElementSafely(getRowCard(0, 0)!);
    assert.strictEqual(doc.activeElement, getRowCard(0, 0));

    // A) Medir 4 movimentos verticais (0 -> 1 -> 2 -> 3 -> 4) no CAMINHO VERTICAL RÁPIDO
    invalidateCandidateCache();
    ensureRowMountedCalls = 0;
    setFastVerticalNavEnabledForTest(true);

    const { metrics: fastDownStats } = measureDomCallsSync(doc, windowInstance, () => {
      for (let targetRow = 1; targetRow <= 4; targetRow++) {
        const next = moveSpatialFocus('down');
        assert.strictEqual(
          next?.getAttribute('data-test-pos'),
          `r${targetRow}-c0`,
          `Passo vertical rápido para baixo deve focar r${targetRow}-c0`
        );
      }
    });

    assert.strictEqual(
      ensureRowMountedCalls,
      4,
      `Cada movimento vertical deve consultar ensureRowMounted exatamente 1 vez sem duplicidade (obtido: ${ensureRowMountedCalls} para 4 passos)`
    );

    // Voltar para cima (4 -> 3 -> 2 -> 1 -> 0) no caminho rápido
    for (let targetRow = 3; targetRow >= 0; targetRow--) {
      const prev = moveSpatialFocus('up');
      assert.strictEqual(
        prev?.getAttribute('data-test-pos'),
        `r${targetRow}-c0`,
        `Passo vertical rápido para cima deve focar r${targetRow}-c0`
      );
    }

    // B) Medir os mesmos 4 movimentos verticais (0 -> 1 -> 2 -> 3 -> 4) no CAMINHO TRADICIONAL
    invalidateCandidateCache();
    setFastVerticalNavEnabledForTest(false);

    const { metrics: tradDownStats } = measureDomCallsSync(doc, windowInstance, () => {
      for (let targetRow = 1; targetRow <= 4; targetRow++) {
        const next = moveSpatialFocus('down');
        assert.strictEqual(
          next?.getAttribute('data-test-pos'),
          `r${targetRow}-c0`,
          `Passo vertical tradicional para baixo deve focar r${targetRow}-c0`
        );
      }
    });

    setFastVerticalNavEnabledForTest(true);

    assert.strictEqual(
      fastDownStats.querySelectorCalls,
      0,
      `Caminho vertical rápido entre fileiras montadas não deve executar querySelectorAll global de candidatos (obtido: ${fastDownStats.querySelectorCalls})`
    );
    assert(
      fastDownStats.querySelectorCalls < tradDownStats.querySelectorCalls,
      `Caminho vertical rápido deve realizar menos varreduras globais que o caminho tradicional (fast=${fastDownStats.querySelectorCalls}, trad=${tradDownStats.querySelectorCalls})`
    );
    assert(
      fastDownStats.boundingRectCalls < tradDownStats.boundingRectCalls,
      `Caminho vertical rápido deve realizar menos leituras de geometria que o caminho tradicional (fast=${fastDownStats.boundingRectCalls}, trad=${tradDownStats.boundingRectCalls})`
    );
    assert(
      fastDownStats.computedStyleCalls < tradDownStats.computedStyleCalls,
      `Caminho vertical rápido deve realizar menos chamadas a getComputedStyle que o caminho tradicional (fast=${fastDownStats.computedStyleCalls}, trad=${tradDownStats.computedStyleCalls})`
    );

    // -------------------------------------------------------------------------
    // 5.2. Preservação da seleção visual horizontal (pickBestItemInBlock) entre
    //      fileiras com diferentes deslocamentos horizontais (scrollLeft)
    // -------------------------------------------------------------------------
    const row0Container = showcaseContainerEl.querySelector<HTMLElement>(
      '[data-home-row-index="0"] [data-nav-row="true"]'
    )!;
    const row1Container = showcaseContainerEl.querySelector<HTMLElement>(
      '[data-home-row-index="1"] [data-nav-row="true"]'
    )!;

    const mockRect = (left: number, top: number, width: number, height: number): DOMRect =>
      ({
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        x: left,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;

    (row0Container as any).getBoundingClientRect = () => mockRect(0, 100, 1200, 220);
    (row1Container as any).getBoundingClientRect = () => mockRect(0, 360, 1200, 220);

    // Fileira 0: sem scroll horizontal (cartão 2 está em left = 400..580, centro cx = 490)
    const row0Cards = Array.from(row0Container.querySelectorAll<HTMLElement>('[data-row-card-index]'));
    row0Cards.forEach((card, idx) => {
      (card as any).getBoundingClientRect = () => mockRect(idx * 200, 110, 180, 200);
    });

    // Fileira 1: rolada horizontalmente em 600px (scrollLeft = 600), de modo que os cartões 0, 1 e 2
    // estão fora da área visível à esquerda (left < 0) e o cartão 5 está visualmente alinhado
    // na coluna do cartão 2 da Fileira 0 (5 * 200 - 600 = 400..580, centro ix = 490)!
    row1Container.scrollLeft = 600;
    const row1Cards = Array.from(row1Container.querySelectorAll<HTMLElement>('[data-row-card-index]'));
    row1Cards.forEach((card, idx) => {
      (card as any).getBoundingClientRect = () => mockRect(idx * 200 - 600, 370, 180, 200);
    });

    focusElementSafely(getRowCard(0, 2)!);
    assert.strictEqual(doc.activeElement, getRowCard(0, 2));

    const visuallyAlignedTarget = moveSpatialFocus('down');
    assert.strictEqual(
      visuallyAlignedTarget?.getAttribute('data-test-pos'),
      'r1-c5',
      `Ao descer da coluna visual (cx=490) da fileira 0 (cartão 2) para a fileira 1 rolada (scrollLeft=600), o caminho rápido deve selecionar o cartão visualmente alinhado r1-c5 e não o mesmo índice numérico r1-c2 (obtido: ${visuallyAlignedTarget?.getAttribute('data-test-pos')})`
    );

    // Subir de volta (r1-c5 -> r0-c2) também deve preservar o alinhamento visual
    const visuallyAlignedBackUp = moveSpatialFocus('up');
    assert.strictEqual(
      visuallyAlignedBackUp?.getAttribute('data-test-pos'),
      'r0-c2',
      `Ao subir de r1-c5 (cx=490) para a fileira 0, deve retornar ao cartão visualmente alinhado r0-c2 (obtido: ${visuallyAlignedBackUp?.getAttribute('data-test-pos')})`
    );

    // Limpar mocks geométricos das fileiras 0 e 1
    delete (row0Container as any).getBoundingClientRect;
    delete (row1Container as any).getBoundingClientRect;
    row1Container.scrollLeft = 0;
    row0Cards.forEach((card) => delete (card as any).getBoundingClientRect);
    row1Cards.forEach((card) => delete (card as any).getBoundingClientRect);

    // -------------------------------------------------------------------------
    // 5.3. Travessia de janela virtualizada de fileiras (0 -> 9 -> 0) e
    //      fronteiras superior/inferior
    // -------------------------------------------------------------------------
    contentScrollEl.scrollTop = 0;
    focusElementSafely(getRowCard(0, 0)!);
    showcaseRowWindowExpansions = 0;

    for (let r = 1; r < totalShowcaseRows; r++) {
      const moved = moveSpatialFocus('down');
      assert.strictEqual(
        moved?.getAttribute('data-test-pos'),
        `r${r}-c0`,
        `Travessia vertical virtualizada deve montar e focar a fileira ${r}`
      );
    }

    assert(
      showcaseRowWindowExpansions > 0 && currentWindowStart > 0,
      `Atravessar fileiras além da janela inicial deve expandir sincronicamente a janela de fileiras (expansions=${showcaseRowWindowExpansions}, start=${currentWindowStart})`
    );

    // Na última fileira (r9), ArrowDown deve manter o foco na última fileira sem saltar para o topo
    const atBottomRow = moveSpatialFocus('down');
    assert.strictEqual(
      atBottomRow?.getAttribute('data-test-pos'),
      'r9-c0',
      'ArrowDown na última fileira deve permanecer na última fileira'
    );

    // Subir de r9 de volta até r0
    for (let r = totalShowcaseRows - 2; r >= 0; r--) {
      const movedUp = moveSpatialFocus('up');
      assert.strictEqual(
        movedUp?.getAttribute('data-test-pos'),
        `r${r}-c0`,
        `Subida vertical virtualizada deve montar e focar a fileira ${r}`
      );
    }

    // Na fileira 0, ArrowUp deve cair no fallback de fronteira superior e focar a barra de categorias ("Todos")
    const exitedUpToCategory = moveSpatialFocus('up');
    assert.strictEqual(
      exitedUpToCategory,
      selectedCategoryBtn,
      'ArrowUp a partir da fileira 0 deve acionar o fallback de fronteira e focar a categoria ativa ("Todos")'
    );

    // -------------------------------------------------------------------------
    // 5.4. Navegação vertical rápida em grades virtualizadas
    //      ([data-virtual-container="true"][data-nav-grid="true"])
    // -------------------------------------------------------------------------
    unregisterShowcaseRowController(showcaseContainerEl);
    showcaseContainerEl.remove();
    showcaseContainerEl = null;
    contentScrollEl.scrollTop = 0;

    virtualGridEl = doc.createElement('div');
    virtualGridEl.setAttribute('data-nav-grid', 'true');
    virtualGridEl.setAttribute('data-virtual-container', 'true');
    const gridCols = 6;
    const gridTotalItems = 60; // 10 linhas de 6 colunas
    const gridWindowSize = 24; // 4 linhas montadas por vez
    let gridWindowStart = 0;
    const gridNodesByIndex = new Map<number, HTMLElement>();

    const renderVirtualGridWindow = (startIdx: number) => {
      if (!virtualGridEl) return;
      const endIdx = Math.min(gridTotalItems, startIdx + gridWindowSize);
      for (const [idx, node] of Array.from(gridNodesByIndex.entries())) {
        if (idx < startIdx || idx >= endIdx) {
          node.remove();
          gridNodesByIndex.delete(idx);
        }
      }
      let prevItem: HTMLElement | null = null;
      for (let idx = startIdx; idx < endIdx; idx++) {
        let item = gridNodesByIndex.get(idx);
        if (!item) {
          item = doc.createElement('div');
          item.setAttribute('tabindex', '0');
          item.setAttribute('role', 'button');
          item.setAttribute('data-nav-item', 'true');
          item.setAttribute('data-virtual-index', String(idx));
          item.textContent = `Item Grade ${idx}`;
          gridNodesByIndex.set(idx, item);
        }
        if (item.parentElement !== virtualGridEl) {
          const refNode = prevItem ? prevItem.nextSibling : virtualGridEl.firstChild;
          virtualGridEl.insertBefore(item, refNode);
        }
        prevItem = item;
      }
    };

    renderVirtualGridWindow(0);
    contentScrollEl.appendChild(virtualGridEl);

    registerVirtualContainer(virtualGridEl, {
      totalCount: gridTotalItems,
      getColumns: () => gridCols,
      ensureIndexMounted: (targetIndex: number) => {
        const curEnd = gridWindowStart + gridWindowSize;
        if (targetIndex >= gridWindowStart + gridCols && targetIndex < curEnd - gridCols) {
          return false;
        }
        const targetRow = Math.floor(targetIndex / gridCols);
        const desiredStartRow = Math.max(0, Math.min(6, targetRow - 1));
        const nextStart = desiredStartRow * gridCols;
        if (nextStart === gridWindowStart) {
          return false;
        }
        gridWindowStart = nextStart;
        renderVirtualGridWindow(gridWindowStart);
        return true;
      },
    });

    const getGridItem = (idx: number) =>
      virtualGridEl!.querySelector<HTMLElement>(`[data-virtual-index="${idx}"]`);

    // Focar item na coluna 3 da linha 0 (índice 3)
    focusElementSafely(getGridItem(3)!);
    assert.strictEqual(doc.activeElement, getGridItem(3));

    // A) Medir 3 movimentos verticais dentro da janela montada (3 -> 9 -> 15 -> 21) no CAMINHO RÁPIDO
    invalidateCandidateCache();
    setFastVerticalNavEnabledForTest(true);

    const { metrics: fastGridStats } = measureDomCallsSync(doc, windowInstance, () => {
      for (let row = 1; row <= 3; row++) {
        const expectedIdx = row * gridCols + 3;
        const next = moveSpatialFocus('down');
        assert.strictEqual(
          next?.getAttribute('data-virtual-index'),
          String(expectedIdx),
          `Passo vertical rápido na grade deve focar o índice ${expectedIdx} mantendo a coluna 3`
        );
      }
    });

    // Voltar para linha 0 coluna 3 (21 -> 15 -> 9 -> 3)
    for (let row = 2; row >= 0; row--) {
      const expectedIdx = row * gridCols + 3;
      const prev = moveSpatialFocus('up');
      assert.strictEqual(
        prev?.getAttribute('data-virtual-index'),
        String(expectedIdx),
        `Subida rápida na grade deve focar o índice ${expectedIdx} mantendo a coluna 3`
      );
    }

    // B) Medir os mesmos 3 movimentos (3 -> 9 -> 15 -> 21) no CAMINHO TRADICIONAL
    invalidateCandidateCache();
    setFastVerticalNavEnabledForTest(false);

    const { metrics: tradGridStats } = measureDomCallsSync(doc, windowInstance, () => {
      for (let row = 1; row <= 3; row++) {
        const expectedIdx = row * gridCols + 3;
        const next = moveSpatialFocus('down');
        assert.strictEqual(
          next?.getAttribute('data-virtual-index'),
          String(expectedIdx),
          `Passo vertical tradicional na grade deve focar o índice ${expectedIdx}`
        );
      }
    });

    setFastVerticalNavEnabledForTest(true);

    assert.strictEqual(
      fastGridStats.querySelectorCalls,
      0,
      `Caminho vertical rápido na grade virtualizada não deve executar querySelectorAll global (obtido: ${fastGridStats.querySelectorCalls})`
    );
    assert(
      fastGridStats.querySelectorCalls < tradGridStats.querySelectorCalls,
      `Caminho rápido na grade deve realizar menos varreduras globais que o tradicional (fast=${fastGridStats.querySelectorCalls}, trad=${tradGridStats.querySelectorCalls})`
    );
    assert(
      fastGridStats.boundingRectCalls < tradGridStats.boundingRectCalls,
      `Caminho rápido na grade deve realizar menos leituras de geometria que o tradicional (fast=${fastGridStats.boundingRectCalls}, trad=${tradGridStats.boundingRectCalls})`
    );
    assert(
      fastGridStats.computedStyleCalls < tradGridStats.computedStyleCalls,
      `Caminho rápido na grade deve realizar menos chamadas a getComputedStyle que o tradicional (fast=${fastGridStats.computedStyleCalls}, trad=${tradGridStats.computedStyleCalls})`
    );

    // C) Atravessar até a última linha da grade virtualizada (linha 9, índice 57) e voltar ao topo (índice 3)
    for (let row = 4; row <= 9; row++) {
      const expectedIdx = row * gridCols + 3;
      const next = moveSpatialFocus('down');
      assert.strictEqual(
        next?.getAttribute('data-virtual-index'),
        String(expectedIdx),
        `Travessia vertical na grade deve montar e focar o índice ${expectedIdx}`
      );
    }

    for (let row = 8; row >= 0; row--) {
      const expectedIdx = row * gridCols + 3;
      const prev = moveSpatialFocus('up');
      assert.strictEqual(
        prev?.getAttribute('data-virtual-index'),
        String(expectedIdx),
        `Retorno vertical na grade deve montar e focar o índice ${expectedIdx}`
      );
    }

    // D) Na linha 0 da grade (índice 3), ArrowUp deve cair no fallback e subir para a barra de categorias
    const gridExitUp = moveSpatialFocus('up');
    assert.strictEqual(
      gridExitUp,
      selectedCategoryBtn,
      'ArrowUp na primeira linha da grade virtualizada deve sair para o botão de categoria ativa ("Todos")'
    );
  } finally {
    if (showcaseContainerEl) {
      unregisterShowcaseRowController(showcaseContainerEl);
    }
    if (virtualGridEl) {
      unregisterVirtualContainer(virtualGridEl);
    }
    setFastHorizontalRowNavEnabledForTest(true);
    setFastVerticalNavEnabledForTest(true);
    clearAllBackHandlersForTest();
    clearFocusMemory();
    shellEl.remove();
  }

  console.log('✅ Ciclo 12.30-c (caminho rápido vertical D-Pad, fileiras, grades virtualizadas, alinhamento visual e fallbacks) validado!');
}

// ============================================================================
// 6. CICLO 12.30-d — REDUÇÃO DA LATÊNCIA NA TV AO VIVO E ENTRADA IMEDIATA EM TELA CHEIA
// ============================================================================
async function runCycle1230dLiveTvLatencyAndFullscreenTests(): Promise<void> {
  console.log(
    '--- 6. Ciclo 12.30-d: TV ao Vivo sem Re-render Global no Foco, Virtualização e 2º OK Imediato em Tela Cheia ---'
  );

  enableDeterministicHlsMock();
  nextHlsInitialTracks = {
    audioTracks: [{ id: 0, name: 'Português', lang: 'pt-BR', default: true }],
    subtitleTracks: [],
    audioTrack: 0,
    subtitleTrack: -1,
  };

  const doc: Document = windowInstance.document as unknown as Document;
  const origInnerWidth = windowInstance.innerWidth;
  (windowInstance as any).innerWidth = 1280;
  setNavMode('remote');
  clearAllBackHandlersForTest();
  clearFocusMemory();
  setFastHorizontalRowNavEnabledForTest(true);
  setFastVerticalNavEnabledForTest(true);

  const origXtreamMethods = {
    authenticate: XtreamService.authenticate,
    getLiveCategories: XtreamService.getLiveCategories,
    getVodCategories: XtreamService.getVodCategories,
    getSeriesCategories: XtreamService.getSeriesCategories,
    getLiveStreams: XtreamService.getLiveStreams,
    getVodStreams: XtreamService.getVodStreams,
    getSeries: XtreamService.getSeries,
    getShortEpg: XtreamService.getShortEpg,
  };

  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container);

  const testCreds: XtreamCredentials = {
    serverUrl: 'http://provider.tv:8080',
    username: 'u',
    password: 'p',
  };

  try {
    // Configurar 4 categorias (Categoria 10 com 32 canais para exercitar virtualização horizontal > 24)
    (XtreamService as any).authenticate = async () => ({
      user_info: { auth: 1, status: 'Active' },
      server_info: {},
    });
    (XtreamService as any).getLiveCategories = async () => [
      { category_id: '10', category_name: 'Esportes' },
      { category_id: '20', category_name: 'Notícias' },
      { category_id: '30', category_name: 'Filmes e Séries' },
      { category_id: '40', category_name: 'Documentários' },
    ];
    (XtreamService as any).getVodCategories = async () => [];
    (XtreamService as any).getSeriesCategories = async () => [];

    const sportsStreams = Array.from({ length: 32 }, (_, i) => ({
      stream_id: 1000 + i,
      name: `Canal Esporte ${i + 1} HD`,
      category_id: '10',
      stream_icon: '',
    }));
    const newsStreams = Array.from({ length: 8 }, (_, i) => ({
      stream_id: 2000 + i,
      name: `Canal Notícia ${i + 1} HD`,
      category_id: '20',
      stream_icon: '',
    }));
    const movieStreams = Array.from({ length: 8 }, (_, i) => ({
      stream_id: 3000 + i,
      name: `Canal Cinema ${i + 1} HD`,
      category_id: '30',
      stream_icon: '',
    }));
    const docStreams = Array.from({ length: 8 }, (_, i) => ({
      stream_id: 4000 + i,
      name: `Canal Doc ${i + 1} HD`,
      category_id: '40',
      stream_icon: '',
    }));

    (XtreamService as any).getLiveStreams = async () => [
      ...sportsStreams,
      ...newsStreams,
      ...movieStreams,
      ...docStreams,
    ];
    (XtreamService as any).getVodStreams = async () => [];
    (XtreamService as any).getSeries = async () => [];

    const nowSec = Math.floor(Date.now() / 1000);
    (XtreamService as any).getShortEpg = async () => ({
      epg_listings: [
        {
          id: 'epg-1',
          title: Buffer.from('Grande Final Ao Vivo', 'utf-8').toString('base64'),
          description: Buffer.from('Transmissão exclusiva em alta definição', 'utf-8').toString('base64'),
          start_timestamp: String(nowSec - 600),
          stop_timestamp: String(nowSec + 3000),
        },
        {
          id: 'epg-2',
          title: Buffer.from('Pós-Jogo Especial', 'utf-8').toString('base64'),
          description: Buffer.from('Análise completa da rodada', 'utf-8').toString('base64'),
          start_timestamp: String(nowSec + 3000),
          stop_timestamp: String(nowSec + 6600),
        },
      ],
    });

    await act(async () => {
      root.render(
        React.createElement(
          XtreamProvider,
          { credentials: testCreds },
          React.createElement(LiveTvView, {
            searchQuery: '',
          })
        )
      );
    });

    for (let attempt = 0; attempt < 15; attempt++) {
      if (doc.querySelector('button[data-live-channel-id="1000"]')) {
        break;
      }
      await act(async () => {
        await new Promise((r) => setTimeout(r, 15));
      });
    }

    const ch1000Btn = doc.querySelector<HTMLButtonElement>('button[data-live-channel-id="1000"]')!;
    assert(ch1000Btn, 'Canal inicial 1000 deve estar montado');

    // -------------------------------------------------------------------------
    // 6.1. Primeiro OK inicia o preview compacto sem solicitar fullscreen
    // -------------------------------------------------------------------------
    await act(async () => {
      focusElementSafely(ch1000Btn);
      ch1000Btn.click();
      await new Promise((r) => setTimeout(r, 25));
    });

    const playerContainer = doc.querySelector<HTMLElement>('[data-player-container="true"]')!;
    const initialVideoEl = doc.querySelector<HTMLVideoElement>('video')!;
    assert(playerContainer && initialVideoEl, '1º OK deve montar o VideoPlayer no painel de preview');
    assert.strictEqual(
      playerContainer.getAttribute('data-player-presentation'),
      'compact-preview',
      '1º OK deve iniciar o player em modo compact-preview'
    );
    assert.strictEqual(
      activeHlsControllers.length,
      1,
      '1º OK deve iniciar exatamente 1 sessão HLS'
    );

    // Simular vídeo em reprodução ativa no preview
    let pauseCallsWhilePending = 0;
    const origPause = initialVideoEl.pause?.bind(initialVideoEl);
    (initialVideoEl as any).pause = () => {
      pauseCallsWhilePending++;
      if (origPause) origPause();
    };
    await act(async () => {
      initialVideoEl.dispatchEvent(new Event('play'));
      initialVideoEl.dispatchEvent(new Event('playing'));
      await new Promise((r) => setTimeout(r, 15));
    });

    // -------------------------------------------------------------------------
    // 6.2. Foco rápido entre canais (horizontal e vertical) com preview e EPG
    //      ativos NÃO provoca re-render de LiveTvView, LiveCategoryRow,
    //      painel de preview ou seção de EPG
    // -------------------------------------------------------------------------
    const showcaseRowsContainer = doc.querySelector<HTMLElement>(
      '[data-showcase-rows-container="true"]'
    )!;
    assert(showcaseRowsContainer, 'Contêiner de fileiras da TV ao Vivo deve existir');

    // Após o 1º OK iniciar a reprodução, a fileira "Assistidos Recentemente" ocupa o índice 0
    // e a categoria "Esportes" (categoryId="10") passa a ocupar o índice 1.
    const sportsRowEl = ch1000Btn.closest<HTMLElement>('[data-home-row-index]')!;
    const sportsRowIndex = sportsRowEl.getAttribute('data-home-row-index') || '1';

    await act(async () => {
      focusElementSafely(ch1000Btn);
    });
    assert.strictEqual(doc.activeElement, ch1000Btn);
    assert.strictEqual(ch1000Btn.getAttribute('data-live-channel-origin'), 'true');

    // Observar estabilidade DOM do painel direito e da grade de EPG via MutationObserver local de teste
    const rightPaneEl = doc.querySelector<HTMLElement>('[data-nav-zone="content"]')!;
    const epgSectionEl = doc.querySelector<HTMLElement>('[data-live-epg-section="true"]')!;
    assert(rightPaneEl && epgSectionEl, 'Painel direito e seção de EPG devem estar montados');
    const initialRightPaneHtml = rightPaneEl.innerHTML;
    const initialEpgHtml = epgSectionEl.innerHTML;
    let rightPaneMutations = 0;
    let epgMutations = 0;
    const rightPaneObserver = new windowInstance.MutationObserver((records: any[]) => {
      rightPaneMutations += records.length;
    });
    const epgObserver = new windowInstance.MutationObserver((records: any[]) => {
      epgMutations += records.length;
    });
    rightPaneObserver.observe(rightPaneEl as any, { childList: true, subtree: true, attributes: true, characterData: true });
    epgObserver.observe(epgSectionEl as any, { childList: true, subtree: true, attributes: true, characterData: true });

    // Navegar horizontalmente por 4 canais na fileira Esportes (1000 -> 1001 -> 1002 -> 1003 -> 1004)
    // e verticalmente entre categorias (Esportes -> Notícias -> Filmes -> voltar a Esportes)
    const expectedNextRow1 = String(Number(sportsRowIndex) + 1);
    const expectedNextRow2 = String(Number(sportsRowIndex) + 2);

    try {
      await act(async () => {
        for (let step = 1; step <= 4; step++) {
          moveSpatialFocus('right');
          const expectedId = String(1000 + step);
          const activeBtn = doc.activeElement as HTMLElement | null;
          assert.strictEqual(
            activeBtn?.getAttribute('data-live-channel-id'),
            expectedId,
            `Passo horizontal ${step} deve focar o canal ${expectedId}`
          );
          assert.strictEqual(
            activeBtn?.getAttribute('data-live-channel-origin'),
            'true',
            `Canal focado ${expectedId} deve receber data-live-channel-origin="true"`
          );
          assert.strictEqual(
            showcaseRowsContainer.getAttribute('data-live-origin-row-index'),
            sportsRowIndex,
            `data-live-origin-row-index deve permanecer ${sportsRowIndex} na fileira Esportes`
          );
          assert.strictEqual(
            showcaseRowsContainer.getAttribute('data-live-origin-card-index'),
            String(step),
            `data-live-origin-card-index deve atualizar para ${step}`
          );
          assert.strictEqual(
            doc.querySelectorAll('button[data-live-channel-origin="true"]').length,
            1,
            'Deve existir exatamente 1 botão com data-live-channel-origin="true"'
          );
        }

        moveSpatialFocus('down');
        assert.strictEqual(
          showcaseRowsContainer.getAttribute('data-live-origin-row-index'),
          expectedNextRow1,
          `ArrowDown para a próxima categoria deve atualizar data-live-origin-row-index para ${expectedNextRow1}`
        );

        moveSpatialFocus('down');
        assert.strictEqual(
          showcaseRowsContainer.getAttribute('data-live-origin-row-index'),
          expectedNextRow2,
          `ArrowDown para a categoria seguinte deve atualizar data-live-origin-row-index para ${expectedNextRow2}`
        );

        moveSpatialFocus('up');
        moveSpatialFocus('up');
        assert.strictEqual(
          showcaseRowsContainer.getAttribute('data-live-origin-row-index'),
          sportsRowIndex,
          `ArrowUp de volta à categoria Esportes deve atualizar data-live-origin-row-index para ${sportsRowIndex}`
        );
      });
    } finally {
      rightPaneObserver.disconnect();
      epgObserver.disconnect();
    }

    assert.strictEqual(
      rightPaneMutations,
      0,
      `Mudança de foco entre canais NÃO deve mutar o DOM do painel direito de preview (mutações=${rightPaneMutations})`
    );
    assert.strictEqual(
      epgMutations,
      0,
      `Mudança de foco entre canais NÃO deve mutar o DOM da grade de EPG (mutações=${epgMutations})`
    );
    assert.strictEqual(
      doc.querySelector('[data-nav-zone="content"]'),
      rightPaneEl,
      'Instância DOM do painel direito deve permanecer intacta durante navegação de foco'
    );
    assert.strictEqual(
      doc.querySelector('[data-live-epg-section="true"]'),
      epgSectionEl,
      'Instância DOM da seção de EPG deve permanecer intacta durante navegação de foco'
    );
    assert.strictEqual(
      rightPaneEl.innerHTML,
      initialRightPaneHtml,
      'Conteúdo do painel direito deve permanecer inalterado durante mudança de foco entre canais'
    );
    assert.strictEqual(
      epgSectionEl.innerHTML,
      initialEpgHtml,
      'Conteúdo da grade de EPG deve permanecer inalterado durante mudança de foco entre canais'
    );
    assert.strictEqual(
      activeHlsControllers.length,
      1,
      'Navegação entre canais com preview ativo deve manter a mesma sessão HLS intacta'
    );

    // -------------------------------------------------------------------------
    // 6.3. Foco e restauração após virtualização horizontal de cartões
    // -------------------------------------------------------------------------
    const currentCardIdx = parseInt(
      (doc.activeElement as HTMLElement)?.getAttribute('data-row-card-index') || '0',
      10
    );
    // 1ª etapa: avançar até a borda da janela inicial (índice 18) para expandir a janela virtualizada para [12..30)
    await act(async () => {
      for (let idx = currentCardIdx; idx < 18; idx++) {
        moveSpatialFocus('right');
      }
    });
    // 2ª etapa: avançar pelos cartões recém-montados até o índice 28
    await act(async () => {
      const midIdx = parseInt(
        (doc.activeElement as HTMLElement)?.getAttribute('data-row-card-index') || '17',
        10
      );
      for (let idx = midIdx; idx < 28; idx++) {
        moveSpatialFocus('right');
      }
    });

    const ch1028Btn = doc.querySelector<HTMLButtonElement>(
      'button[data-live-channel-id="1028"][data-live-channel-category-id="10"]'
    )!;
    assert(ch1028Btn, 'Canal 1028 (índice 28) deve ser montado pela virtualização horizontal');
    assert.strictEqual(doc.activeElement, ch1028Btn);
    assert.strictEqual(ch1028Btn.getAttribute('data-live-channel-origin'), 'true');
    assert.strictEqual(
      showcaseRowsContainer.getAttribute('data-live-origin-row-index'),
      sportsRowIndex
    );
    assert.strictEqual(showcaseRowsContainer.getAttribute('data-live-origin-card-index'), '28');

    // Mover o foco para o painel direito (zona content - item EPG) e rolar a fileira Esportes
    // de volta para scrollLeft = 0 para desmontar o cartão 28 pela virtualização
    const epgPrimaryEl = doc.querySelector<HTMLElement>('[data-epg-primary="true"]')!;
    assert(epgPrimaryEl, 'Item primário de EPG deve existir no painel direito');
    const sportsRowScrollEl = doc.querySelector<HTMLElement>(
      `[data-home-row-index="${sportsRowIndex}"] [data-live-category-row-scroll="true"]`
    )!;

    await act(async () => {
      focusElementSafely(epgPrimaryEl);
      sportsRowScrollEl.scrollLeft = 0;
      sportsRowScrollEl.dispatchEvent(new Event('scroll'));
    });
    assert.strictEqual(doc.activeElement === epgPrimaryEl, true);
    assert.strictEqual(
      doc.querySelector('button[data-live-channel-id="1028"][data-live-channel-category-id="10"]'),
      null,
      'Canal 1028 deve ter sido desmontado ao rolar a janela virtual para o início'
    );

    // Pressionar ArrowLeft a partir da zona content deve remontar o índice 28 e restaurar o foco nele
    await act(async () => {
      moveSpatialFocus('left');
    });
    const remounted1028Btn = doc.querySelector<HTMLButtonElement>(
      'button[data-live-channel-id="1028"][data-live-channel-category-id="10"]'
    )!;
    assert(remounted1028Btn, 'Retorno para categorias deve remontar o canal de origem 1028');
    if (doc.activeElement !== remounted1028Btn) {
      await act(async () => {
        moveSpatialFocus('left');
      });
    }
    const activeAfterLeft = doc.activeElement as HTMLElement | null;
    assert.strictEqual(
      activeAfterLeft === remounted1028Btn,
      true,
      `Foco deve ser restaurado exatamente no canal de origem 1028 após virtualização (active: ${activeAfterLeft?.tagName} id=${activeAfterLeft?.getAttribute?.('data-live-channel-id')})`
    );
    assert.strictEqual(
      remounted1028Btn.getAttribute('data-live-channel-origin'),
      'true',
      'Atributo data-live-channel-origin="true" deve ser preservado após remontagem virtual'
    );

    // Voltar para o canal 1000 (que já está selecionado no preview) para testar o 2º OK
    await act(async () => {
      sportsRowScrollEl.scrollLeft = 0;
      sportsRowScrollEl.dispatchEvent(new Event('scroll'));
    });
    const ch1000Again = doc.querySelector<HTMLButtonElement>(
      'button[data-live-channel-id="1000"][data-live-channel-category-id="10"]'
    )!;
    assert(ch1000Again, 'Canal 1000 deve estar montado no início da fileira Esportes');
    await act(async () => {
      focusElementSafely(ch1000Again);
    });

    // -------------------------------------------------------------------------
    // 6.4 e 6.5. Segundo OK solicita fullscreen IMEDIATAMENTE na ativação do
    //            usuário + proteção contra OK repetido durante solicitação pendente
    // -------------------------------------------------------------------------
    let currentFsElement: Element | null = null;
    Object.defineProperty(doc, 'fullscreenElement', {
      get: () => currentFsElement,
      configurable: true,
    });

    let fsRequestCount = 0;
    let fsCalledSynchronouslyDuringClick = false;
    let insideClickActivation = false;
    let resolvePendingFs!: () => void;

    (playerContainer as any).requestFullscreen = () => {
      fsRequestCount++;
      if (insideClickActivation) {
        fsCalledSynchronouslyDuringClick = true;
      }
      return new Promise<void>((resolve) => {
        resolvePendingFs = () => {
          currentFsElement = playerContainer;
          doc.dispatchEvent(new Event('fullscreenchange'));
          resolve();
        };
      });
    };
    (doc as any).exitFullscreen = async () => {
      currentFsElement = null;
      doc.dispatchEvent(new Event('fullscreenchange'));
    };

    pauseCallsWhilePending = 0;
    const epgHtmlBeforeSecondOk = epgSectionEl.innerHTML;
    let epgMutationsOnSecondOk = 0;
    const epgSecondOkObserver = new windowInstance.MutationObserver((records: any[]) => {
      epgMutationsOnSecondOk += records.length;
    });
    epgSecondOkObserver.observe(epgSectionEl as any, { childList: true, subtree: true, attributes: true, characterData: true });

    // Executar 2º OK no canal 1000 já selecionado
    try {
      await act(async () => {
        insideClickActivation = true;
        ch1000Again.click();
        insideClickActivation = false;
      });
    } finally {
      epgSecondOkObserver.disconnect();
    }

    assert.strictEqual(
      fsCalledSynchronouslyDuringClick,
      true,
      '2º OK deve chamar container.requestFullscreen() sincronamente dentro do evento de ativação do usuário'
    );
    assert.strictEqual(
      fsRequestCount,
      1,
      '2º OK deve disparar exatamente 1 solicitação de fullscreen'
    );
    assert.strictEqual(
      epgMutationsOnSecondOk,
      0,
      '2º OK via comunicação direta por ref NÃO deve mutar a seção de EPG da tela'
    );
    assert.strictEqual(
      epgSectionEl.innerHTML,
      epgHtmlBeforeSecondOk,
      'Conteúdo da grade de EPG deve permanecer intacto ao solicitar fullscreen via 2º OK'
    );
    assert.strictEqual(
      playerContainer.getAttribute('data-player-presentation'),
      'full-layer',
      'Enquanto a solicitação de fullscreen está pendente, o player já deve estar em full-layer sem tela intermediária'
    );

    // Disparar múltiplos comandos de OK enquanto a entrada em fullscreen ainda está pendente:
    // 1) OK repetido no botão do canal
    // 2) OK / clique no botão play-pause do player
    // 3) Clique no próprio container do player
    const playPauseBtn = doc.querySelector<HTMLButtonElement>(
      'button[data-player-control="play-pause"]'
    )!;
    assert(playPauseBtn, 'Botão play-pause em full-layer deve estar disponível');

    await act(async () => {
      ch1000Again.click();
      ch1000Again.click();
      playPauseBtn.click();
      playerContainer.click();
    });

    assert.strictEqual(
      fsRequestCount,
      1,
      'OK repetido durante solicitação pendente NÃO deve iniciar uma segunda chamada a requestFullscreen'
    );
    assert.strictEqual(
      pauseCallsWhilePending,
      0,
      'OK repetido durante entrada pendente em fullscreen NÃO deve pausar acidentalmente a reprodução'
    );
    assert.strictEqual(
      activeHlsControllers.length,
      1,
      'OK repetido não deve reinicializar o stream HLS'
    );
    assert.strictEqual(
      doc.querySelector('video') === initialVideoEl,
      true,
      'O elemento <video> não deve ser desmontado nem remontado'
    );

    // Concluir a promessa pendente do Fullscreen API
    await act(async () => {
      resolvePendingFs();
      await new Promise((r) => setTimeout(r, 10));
    });

    assert.strictEqual(
      playerContainer.getAttribute('data-player-presentation'),
      'full-layer',
      'Após resolução da Fullscreen API, o player deve permanecer em full-layer'
    );
    const expectedPlayPauseBtn = doc.querySelector('button[data-player-control="play-pause"]');
    assert.strictEqual(
      doc.activeElement === expectedPlayPauseBtn,
      true,
      `Ao entrar em tela cheia no modo controle remoto, o foco deve estar no controle play-pause do player (active: ${(doc.activeElement as HTMLElement | null)?.tagName} control=${(doc.activeElement as HTMLElement | null)?.getAttribute?.('data-player-control')})`
    );

    // -------------------------------------------------------------------------
    // 6.6. Saída da tela cheia preserva a sessão, reprodução e restaura o foco
    // -------------------------------------------------------------------------
    await act(async () => {
      executeBackAction();
      await new Promise((r) => setTimeout(r, 15));
    });

    assert.strictEqual(
      playerContainer.getAttribute('data-player-presentation'),
      'compact-preview',
      'Voltar a partir da tela cheia deve retornar ao modo compact-preview'
    );
    assert.strictEqual(
      activeHlsControllers.length,
      1,
      'Sair da tela cheia deve preservar a mesma sessão HLS sem reiniciar'
    );
    assert.strictEqual(
      doc.querySelector('video') === initialVideoEl,
      true,
      'Sair da tela cheia deve preservar a mesma instância do elemento <video>'
    );
    assert.strictEqual(
      doc.activeElement === ch1000Again,
      true,
      `Sair da tela cheia na TV ao Vivo deve restaurar o foco ao cartão do canal de origem (active: ${(doc.activeElement as HTMLElement | null)?.tagName} ch=${(doc.activeElement as HTMLElement | null)?.getAttribute?.('data-live-channel-id')})`
    );

    // -------------------------------------------------------------------------
    // 6.7. Falha da Fullscreen API aciona o fallback visual sem tela intermediária
    // -------------------------------------------------------------------------
    let rejectFsCalled = 0;
    (playerContainer as any).requestFullscreen = async () => {
      rejectFsCalled++;
      throw new Error('Fullscreen request denied by environment');
    };

    await act(async () => {
      ch1000Again.click();
      await new Promise((r) => setTimeout(r, 10));
    });

    assert.strictEqual(rejectFsCalled, 1, 'Deve tentar chamar requestFullscreen no 2º OK');
    assert.strictEqual(
      playerContainer.getAttribute('data-player-presentation'),
      'full-layer',
      'Quando a Fullscreen API rejeita, o fallback de expansão visual deve manter o player em full-layer'
    );
    assert.strictEqual(
      activeHlsControllers.length,
      1,
      'Fallback de expansão visual não deve reiniciar o stream'
    );

    // Sair da expansão visual pelo botão Voltar restaura o preview compacto
    await act(async () => {
      executeBackAction();
      await new Promise((r) => setTimeout(r, 15));
    });
    assert.strictEqual(
      playerContainer.getAttribute('data-player-presentation'),
      'compact-preview',
      'Voltar deve sair da expansão visual de volta ao preview compacto'
    );

    // -------------------------------------------------------------------------
    // 6.8. Compatibilidade com viewport mobile / Android e fechamento do preview
    // -------------------------------------------------------------------------
    (windowInstance as any).innerWidth = 390;
    const ch2000Btn = doc.querySelector<HTMLButtonElement>('button[data-live-channel-id="2000"]')!;
    assert(ch2000Btn, 'Canal 2000 deve existir para teste de viewport mobile');

    await act(async () => {
      focusElementSafely(ch2000Btn);
      ch2000Btn.click();
      await new Promise((r) => setTimeout(r, 10));
    });

    const rightPaneMain = doc.querySelector<HTMLElement>('main[data-nav-zone="content"]')!;
    assert(
      rightPaneMain.className.includes('flex'),
      'No mobile (<768px), selecionar um canal deve abrir o painel do player móvel'
    );

    // 1º Back no mobile fecha o painel móvel de volta à lista, 2º Back fecha o preview
    await act(async () => {
      executeBackAction();
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () => {
      executeBackAction();
      await new Promise((r) => setTimeout(r, 20));
    });
    assert.strictEqual(
      doc.querySelector('[data-player-container="true"]'),
      null,
      'Fechar o preview deve desmontar o player e retornar ao estado inicial de seleção'
    );
    assert.strictEqual(
      doc.activeElement === ch2000Btn,
      true,
      `Fechar o preview deve restaurar o foco exatamente ao canal 2000 (active: ${(doc.activeElement as HTMLElement | null)?.tagName} ch=${(doc.activeElement as HTMLElement | null)?.getAttribute?.('data-live-channel-id')})`
    );
  } finally {
    (windowInstance as any).innerWidth = origInnerWidth;
    delete (doc as any).fullscreenElement;
    delete (doc as any).exitFullscreen;
    Object.assign(XtreamService, origXtreamMethods);
    clearAllBackHandlersForTest();
    clearFocusMemory();
    await act(async () => {
      root.unmount();
    });
    container.remove();
    restoreHlsMock();
  }

  console.log(
    '✅ Ciclo 12.30-d (foco sem re-render global, virtualização, 2º OK imediato, proteção contra OK repetido e fallback visual) validado!'
  );
}

// ============================================================================
// 7. CACHE PERSISTENTE DE IMAGENS E PRÉ-CARREGAMENTO INTELIGENTE (ETAPA 1 — APK ANDROID)
// ============================================================================
async function runStep1PersistentImageCacheAndPreloadTests(): Promise<void> {
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

  const doc = windowInstance.document;
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  let root = createRoot(container);

  const origHeroMethods = {
    getVodInfo: XtreamService.getVodInfo,
    getSeriesInfo: XtreamService.getSeriesInfo,
  };
  XtreamService.getVodInfo = async () => ({ info: {}, movie_data: {} } as any);
  XtreamService.getSeriesInfo = async () => ({ info: {}, episodes: {} } as any);

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

    enableDeterministicHlsMock();
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
    } finally {
      Object.assign(XtreamService, origXtreamLiveMethods);
      restoreHlsMock();
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
  } finally {
    Object.assign(XtreamService, origHeroMethods);
    customResponderFn = null;
    harness.uninstall();
    setMediaImageRetryDelayMsForTest(2000);
    clearAllBackHandlersForTest();
    clearFocusMemory();
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }

  console.log(
    '✅ Etapa 1 (cache persistente Android, deduplicação, validação HTTP/assinatura, LRU, recuperação de corrupção, preparação prioritária e logout) validada!'
  );
}

// ============================================================================
// 8. ESTABILIZAÇÃO DO CARREGAMENTO E FLUIDEZ NO APK ANDROID (ETAPA 2)
// ============================================================================
async function runStep2StartupAndFluidityStabilizationTests(): Promise<void> {
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

  const doc = windowInstance.document;
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container);

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
  } finally {
    customResponderFn = null;
    try {
      window.localStorage.removeItem('nc_startup_image_mode_v1');
    } catch {
      // ignore
    }
    setCatalogTransferPhaseActiveForImageCache(false);
    harness.uninstall();
    setMediaImageRetryDelayMsForTest(2000);
    clearAllBackHandlersForTest();
    clearFocusMemory();
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }

  console.log(
    '✅ Etapa 2 (coordenação catálogos/imagens, eliminação do gap pós-catálogos, contabilização prioritária exata, cancelamento de fila na rolagem vertical e Modo B consolidado) validada!'
  );
}

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

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

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

    // 4) Renderizar ConfigView e validar ausência total de diagnósticos (C1, C2.1, C3) e seletores A/B,
    //    bem como a preservação da calibração de apresentação, conta, formatos e Identificação do Build
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
      configText.includes('Apresentação e Tamanho da Interface'),
      'ConfigView deve preservar a seção de Apresentação e Tamanho da Interface'
    );
    assert(
      configText.includes('Informações da Conta') && configText.includes(mockCreds.username),
      'ConfigView deve preservar as Informações da Conta'
    );
    assert(
      configText.includes('Formatos do Provedor'),
      'ConfigView deve preservar a seção Formatos do Provedor'
    );
    assert(
      configText.includes('Informações do aplicativo') &&
        configText.includes('Identificação do Build') &&
        configText.includes(`v${APP_VERSION}`) &&
        configText.includes(formatCommitShort(APP_COMMIT)),
      'ConfigView deve preservar Informações do aplicativo e Identificação do Build (versão e commit)'
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

    // Selecionar TV -> Ajustar tamanho -> Escolher preset 90% -> Voltar e cancelar sem confirmar
    await act(async () => {
      (document.querySelector('[data-device-choice="tv"]') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () => {
      (document.querySelector('[data-tv-adjust-size="true"]') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () => {
      (document.querySelector('[data-scale-preset="90"]') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 20));
    });
    const sampleCardEl = document.querySelector('[data-calibration-sample="true"]') as HTMLElement | null;
    const draftBadgeEl = document.querySelector('[data-calibration-draft-badge="true"]') as HTMLElement | null;
    assert(sampleCardEl, 'Cartão de prévia de calibração deve estar visível');
    assert.strictEqual(
      sampleCardEl.getAttribute('data-sample-scale'),
      '90',
      'Prévia visual de calibração deve refletir escala temporária de 90%'
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
      (document.querySelector('[data-tv-adjust-size="true"]') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 15));
    });
    await act(async () => {
      (document.querySelector('[data-scale-preset="90"]') as HTMLButtonElement).click();
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
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }

  console.log(
    '✅ Etapa 3 / Entrega C1 (política Android/Web sem diagnóstico D-Pad, repetição 48ms, virtualização, redução de concorrência de imagens e ConfigView limpo) validada!'
  );
}

// ============================================================================
// 10. CONSOLIDAÇÃO PARA LANÇAMENTO — ENTREGA A: HEROBANNER
// ============================================================================
async function runDeliveryAHeroBannerConsolidationTests(): Promise<void> {
  console.log(
    '\n--- 10. Entrega A (HeroBanner): Reuso de Seleção, Cache Compartilhado, Pausa Real, Sequência por Página, Isolamento e Modo Web/Android ---'
  );

  clearHeroSessionCache();

  const doc = windowInstance.document;
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container);

  const origMethods = {
    getVodInfo: XtreamService.getVodInfo,
    getSeriesInfo: XtreamService.getSeriesInfo,
    authenticate: XtreamService.authenticate,
  };
  XtreamService.authenticate = async () => ({ user_info: { auth: 1, status: 'Active' } } as any);

  const origSetInterval = globalThis.setInterval;
  const origClearInterval = globalThis.clearInterval;
  const origWindowSetInterval = windowInstance.setInterval.bind(windowInstance);
  const origWindowClearInterval = windowInstance.clearInterval.bind(windowInstance);

  type TrackedInterval = { id: number; delay: number; cb: () => void };
  let activeHeroIntervals: TrackedInterval[] = [];
  let syntheticTimerSeq = 900000;

  const installHeroIntervalTracker = () => {
    activeHeroIntervals = [];
    const wrappedSet = (fn: any, ms?: number, ...args: any[]) => {
      if (ms === 8000 && typeof fn === 'function') {
        const id = ++syntheticTimerSeq;
        activeHeroIntervals.push({ id, delay: ms, cb: () => fn(...args) });
        return id as any;
      }
      return origSetInterval(fn, ms, ...args);
    };
    const wrappedClear = (id: any) => {
      const idx = activeHeroIntervals.findIndex((t) => t.id === id);
      if (idx !== -1) {
        activeHeroIntervals.splice(idx, 1);
        return;
      }
      origClearInterval(id);
    };
    (globalThis as any).setInterval = wrappedSet;
    (globalThis as any).clearInterval = wrappedClear;
    (windowInstance as any).setInterval = wrappedSet;
    (windowInstance as any).clearInterval = wrappedClear;
  };

  const restoreHeroIntervalTracker = () => {
    (globalThis as any).setInterval = origSetInterval;
    (globalThis as any).clearInterval = origClearInterval;
    (windowInstance as any).setInterval = origWindowSetInterval;
    (windowInstance as any).clearInterval = origWindowClearInterval;
    activeHeroIntervals = [];
  };

  const accountA: XtreamCredentials = {
    serverUrl: 'http://hero-server-a.tv:8080',
    username: 'userHeroA',
    password: 'pwA',
  };
  const accountB: XtreamCredentials = {
    serverUrl: 'http://hero-server-b.tv:8080',
    username: 'userHeroB',
    password: 'pwB',
  };

  // Build realistic catalogs (> 35 movies & > 35 series) with duplicates and year/rating tiebreakers
  const mockVodCatalog = Array.from({ length: 40 }, (_, i) => ({
    stream_id: 100 + i,
    stream_type: 'movie',
    name: i === 2 ? 'Filme Destaque 1 4K' : i === 0 ? 'Filme Destaque 1' : `Filme Catálogo ${i}`,
    stream_icon: `http://img.hero.tv/vod/poster_${100 + i}.jpg`,
    category_id: '10',
    category_name: 'Ação',
    rating: String((9.5 - i * 0.1).toFixed(1)),
    year: String(2025 - Math.floor(i / 8)),
    container_extension: 'mkv',
  }));

  const mockSeriesCatalog = Array.from({ length: 40 }, (_, i) => ({
    series_id: 500 + i,
    name: i === 1 ? 'Filme Destaque 1' : `Série Catálogo ${i}`,
    cover: `http://img.hero.tv/series/cover_${500 + i}.jpg`,
    backdrop_path: [`http://img.hero.tv/series/backdrop_${500 + i}.jpg`],
    plot: `Sinopse completa da série ${500 + i} já carregada no catálogo.`,
    genre: 'Drama / Suspense',
    releaseDate: '2025-02-01',
    category_id: '20',
    category_name: 'Séries',
    rating: String((9.4 - i * 0.1).toFixed(1)),
    year: String(2025 - Math.floor(i / 8)),
  }));

  try {
    // -----------------------------------------------------------------------
    // 10.1. Reutilização de seleção entre Filmes, Séries e Início + 0 consultas
    //       para séries que já possuem backdrop e sinopse no catálogo
    // -----------------------------------------------------------------------
    const moviesHero = getHeroBannerItems(mockVodCatalog, []);
    const moviesHeroRepeatedFreshEmpty = getHeroBannerItems(mockVodCatalog, []);
    const seriesHero = getHeroBannerItems([], mockSeriesCatalog);
    const homeHero = getHeroBannerItems(mockVodCatalog, mockSeriesCatalog);
    const directReferenceMerge = computeHeroItemsFromList([
      ...mockVodCatalog,
      ...mockSeriesCatalog,
    ]);

    assert.strictEqual(
      moviesHero,
      moviesHeroRepeatedFreshEmpty,
      'getHeroBannerItems deve reutilizar o mesmo cache mesmo quando arrays vazios literais são passados'
    );
    assert.strictEqual(moviesHero.length, 30, 'Filmes deve selecionar exatamente 30 destaques');
    assert.strictEqual(seriesHero.length, 30, 'Séries deve selecionar exatamente 30 destaques');
    assert.strictEqual(homeHero.length, 30, 'Início deve selecionar exatamente 30 destaques');
    assert.deepStrictEqual(
      homeHero.map((x) => `${x.stream_id ?? ''}:${x.series_id ?? ''}:${x.name}`),
      directReferenceMerge.map((x) => `${x.stream_id ?? ''}:${x.series_id ?? ''}:${x.name}`),
      'A combinação de Filmes Top 30 e Séries Top 30 deve preservar rigorosamente classificação, ordenação e deduplicação'
    );

    const movieIdSet = new Set(moviesHero);
    const seriesIdSet = new Set(seriesHero);
    assert(
      homeHero.every((item) => movieIdSet.has(item) || seriesIdSet.has(item)),
      'Todos os itens de destaque da Home devem reutilizar exatamente as instâncias selecionadas de Filmes/Séries'
    );

    let vodInfoCalls: Array<{ id: string; user: string }> = [];
    let seriesInfoCalls: Array<{ id: string; user: string }> = [];

    XtreamService.getVodInfo = async (creds, vodId, opts) => {
      vodInfoCalls.push({ id: String(vodId), user: creds.username });
      if (opts?.signal?.aborted) {
        throw new Error('Operação cancelada pelo usuário.');
      }
      return {
        info: {
          name: `Filme ${vodId}`,
          backdrop_path: [`http://img.hero.tv/vod/backdrop_${vodId}.jpg`],
          plot: `Sinopse detalhada do filme ${vodId}.`,
          genre: 'Ficção Científica',
          releasedate: '2025-05-10',
          rating: '9.5',
        },
        movie_data: {
          stream_id: Number(vodId),
          name: `Filme ${vodId}`,
          container_extension: 'mp4',
        },
      };
    };

    XtreamService.getSeriesInfo = async (creds, seriesId, opts) => {
      seriesInfoCalls.push({ id: String(seriesId), user: creds.username });
      if (opts?.signal?.aborted) {
        throw new Error('Operação cancelada pelo usuário.');
      }
      return {
        info: {
          name: `Série ${seriesId}`,
          backdrop_path: [`http://img.hero.tv/series/backdrop_${seriesId}.jpg`],
          plot: `Sinopse detalhada da série ${seriesId}.`,
          genre: 'Drama',
          releaseDate: '2025-03-15',
        },
        episodes: {
          '1': [
            {
              id: Number(seriesId) * 100 + 1,
              episode_num: 1,
              title: 'Episódio Piloto',
              container_extension: 'mkv',
            },
          ],
        },
      };
    };

    // Series catalog already has backdrop_path + plot -> HeroBanner must make ZERO get_series_info requests!
    installHeroIntervalTracker();
    await act(async () => {
      root.render(
        React.createElement(
          XtreamProvider,
          { credentials: accountA },
          React.createElement(HeroBanner, {
            items: seriesHero.slice(0, 3),
            domain: 'series',
            onPlay: () => {},
            onInfo: () => {},
          })
        )
      );
      await new Promise((r) => setTimeout(r, 25));
    });
    assert.strictEqual(
      seriesInfoCalls.length,
      0,
      'Séries cujos registros de catálogo já possuem backdrop e sinopse não devem disparar get_series_info no HeroBanner'
    );
    assert(
      (container.textContent || '').includes('Sinopse completa da série 500 já carregada no catálogo.'),
      'HeroBanner deve renderizar imediatamente a sinopse já presente no catálogo da série'
    );

    // -----------------------------------------------------------------------
    // 10.2. Cache compartilhado de sessão (sem novas requisições ao retornar,
    //       compartilhamento com Mais Informações e Assistir, limite de episódios)
    // -----------------------------------------------------------------------
    await act(async () => {
      root.render(React.createElement('div'));
      await new Promise((r) => setTimeout(r, 10));
    });
    vodInfoCalls = [];
    seriesInfoCalls = [];
    clearHeroSessionCache();
    activeHeroIntervals = [];

    let playedCalls: any[] = [];
    await act(async () => {
      root.render(
        React.createElement(
          XtreamProvider,
          { credentials: accountA },
          React.createElement(HeroBanner, {
            items: moviesHero.slice(0, 3),
            domain: 'movies',
            onPlay: (item, details) => {
              playedCalls.push({ item, details });
            },
            onInfo: () => {},
          })
        )
      );
      await new Promise((r) => setTimeout(r, 25));
    });

    const firstMovieId = String(moviesHero[0].stream_id);
    assert.strictEqual(
      vodInfoCalls.length,
      1,
      'Deve consultar get_vod_info apenas 1 vez sob demanda para o slide visível inicial'
    );
    assert.strictEqual(vodInfoCalls[0].id, firstMovieId);

    // Advance slide 0 -> 1 -> 2 -> 0 (wrap around to slide 0 again)
    assert.strictEqual(activeHeroIntervals.length, 1, 'Deve existir 1 timer de rotação ativo');
    await act(async () => {
      activeHeroIntervals[0].cb(); // -> index 1
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () => {
      activeHeroIntervals[0].cb(); // -> index 2
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () => {
      activeHeroIntervals[0].cb(); // -> index 0 again!
      await new Promise((r) => setTimeout(r, 20));
    });

    assert.strictEqual(
      vodInfoCalls.filter((c) => c.id === firstMovieId).length,
      1,
      'Ao retornar a um slide já consultado na mesma sessão, NÃO deve haver nova chamada get_vod_info'
    );

    // Switch to 'inicio' displaying the same first movie -> must reuse session cache (0 new calls!)
    const callsBeforeHomeReuse = vodInfoCalls.length;
    await act(async () => {
      root.render(
        React.createElement(
          XtreamProvider,
          { credentials: accountA },
          React.createElement(HeroBanner, {
            items: [moviesHero[0], seriesHero[0]],
            domain: 'inicio',
            onPlay: () => {},
            onInfo: () => {},
          })
        )
      );
      await new Promise((r) => setTimeout(r, 20));
    });
    assert.strictEqual(
      vodInfoCalls.length,
      callsBeforeHomeReuse,
      'HeroBanner da Home deve reaproveitar o detalhe em cache consultado anteriormente em Filmes'
    );

    // Open MovieDetails ("Mais informações") for firstMovieId -> must reuse cached details (0 new calls!)
    await act(async () => {
      root.render(
        React.createElement(
          XtreamProvider,
          { credentials: accountA },
          React.createElement(MovieDetails, {
            streamId: Number(firstMovieId),
            streamName: moviesHero[0].name,
            streamIcon: moviesHero[0].stream_icon,
            onClose: () => {},
            onPlay: () => {},
          })
        )
      );
      await new Promise((r) => setTimeout(r, 25));
    });
    assert.strictEqual(
      vodInfoCalls.length,
      callsBeforeHomeReuse,
      'Abrir MovieDetails ("Mais informações") para item já em cache NÃO deve repetir get_vod_info'
    );
    assert(
      (container.textContent || '').includes(`Sinopse detalhada do filme ${firstMovieId}`),
      'MovieDetails deve exibir os metadados compartilhados do cache de sessão'
    );

    // Test bounded series episode retention (max 3 series episodes maps, metadata stays without episodes)
    seriesInfoCalls = [];
    for (let k = 0; k < 5; k++) {
      await fetchOrReuseHeroDetails(accountA, { series_id: 900 + k, stream_type: 'series' });
    }
    const cacheStatsAfter5Series = getHeroSessionCacheStatsForTest();
    assert(
      cacheStatsAfter5Series.seriesEpisodesEntriesCount <= 3,
      `Retenção de mapas completos de episódios deve ser limitada (atual=${cacheStatsAfter5Series.seriesEpisodesEntriesCount})`
    );
    const oldestMetadata = getCachedHeroDetails(
      accountA,
      { series_id: 900, stream_type: 'series' },
      { requireEpisodes: false }
    );
    assert(oldestMetadata && oldestMetadata.info, 'Metadados leves da série mais antiga devem continuar em cache');
    assert.strictEqual(
      oldestMetadata.episodes,
      undefined,
      'Cache de metadados leves não deve reter objetos de episódios'
    );
    assert.strictEqual(
      getCachedHeroDetails(
        accountA,
        { series_id: 900, stream_type: 'series' },
        { requireEpisodes: true }
      ),
      null,
      'A série mais antiga fora do limite de episódios deve ter seu mapa de episódios descartado'
    );

    // Opening SeriesDetails for the evicted series 900 must still fetch complete episodes reliably!
    const seriesCallsBeforeDetails = seriesInfoCalls.length;
    await act(async () => {
      root.render(
        React.createElement(
          XtreamProvider,
          { credentials: accountA },
          React.createElement(SeriesDetails, {
            seriesId: 900,
            seriesName: 'Série 900',
            onClose: () => {},
            onPlay: () => {},
          })
        )
      );
      await new Promise((r) => setTimeout(r, 30));
    });
    assert.strictEqual(
      seriesInfoCalls.length,
      seriesCallsBeforeDetails + 1,
      'Quando o mapa de episódios foi descartado por limite de memória, SeriesDetails deve buscar os episódios completos sob demanda sem comprometer a série'
    );
    assert(
      (container.textContent || '').includes('Episódio Piloto'),
      'SeriesDetails deve renderizar normalmente os episódios completos buscados sob demanda'
    );

    // -----------------------------------------------------------------------
    // 10.3. Pausa completa quando invisível no scroll container + cancelamento
    //       seguro + preservação de solicitação compartilhada com consumidor ativo
    // -----------------------------------------------------------------------
    await act(async () => {
      root.render(React.createElement('div'));
      await new Promise((r) => setTimeout(r, 10));
    });
    clearHeroSessionCache();
    vodInfoCalls = [];
    seriesInfoCalls = [];
    activeHeroIntervals = [];

    // Mock delayed VOD fetch to validate cancellation + shared consumer protection
    let resolveSlowVod: ((val: any) => void) | null = null;
    let slowVodAborted = false;
    XtreamService.getVodInfo = (creds, vodId, opts) => {
      vodInfoCalls.push({ id: String(vodId), user: creds.username });
      return new Promise((resolve, reject) => {
        if (opts?.signal) {
          opts.signal.addEventListener('abort', () => {
            slowVodAborted = true;
            reject(new Error('Operação cancelada pelo usuário.'));
          });
        }
        resolveSlowVod = resolve;
      });
    };

    const vodForScrollTest = Array.from({ length: 6 }, (_, i) => ({
      stream_id: 2000 + i,
      stream_type: 'movie',
      name: `Filme Scroll ${i}`,
      stream_icon: `http://img.hero.tv/scroll/${2000 + i}.jpg`,
      category_id: '10',
      rating: String(9.0 - i * 0.1),
      year: '2025',
      container_extension: 'mp4',
    }));

    // Mount inside a real [data-scroll-container="true"] with IntersectionObserver absent
    // so this sub-test specifically validates the scroll/resize geometric fallback path
    const origWindowIOForFallback = (windowInstance as any).IntersectionObserver;
    const origGlobalIOForFallback = (globalThis as any).IntersectionObserver;
    (windowInstance as any).IntersectionObserver = undefined;
    (globalThis as any).IntersectionObserver = undefined;

    try {
      await act(async () => {
        root.render(
          React.createElement(
            XtreamProvider,
            { credentials: accountA },
            React.createElement(CatalogShowcaseView, {
              section: 'movies',
              credentials: accountA,
              onPlay: () => {},
              vodCategories: [{ category_id: '10', category_name: 'Ação' }],
              vodStreams: vodForScrollTest,
              allVodStreams: vodForScrollTest,
              sessionReady: true,
            })
          )
        );
        await new Promise((r) => setTimeout(r, 25));
      });

      const scrollContainerEl = container.querySelector(
        '[data-scroll-container="true"]'
      ) as any;
      const heroWrapperEl = container.querySelector('.nc-tv-hero') as any;
      const heroStageEl = container.querySelector('[data-hero-stage="true"]') as any;
      assert(scrollContainerEl && heroWrapperEl && heroStageEl, 'Container de scroll e HeroBanner devem estar montados');

      // Provide measurable viewport geometry for scroll visibility assertions
      let heroRectTop = 64;
      let heroRectBottom = 594;
      (scrollContainerEl as any).getBoundingClientRect = () => ({
        top: 64,
        bottom: 720,
        left: 0,
        right: 1280,
        width: 1280,
        height: 656,
      });
      (heroWrapperEl as any).getBoundingClientRect = () => ({
        top: heroRectTop,
        bottom: heroRectBottom,
        left: 0,
        right: 1280,
        width: 1280,
        height: 530,
      });

      // Request for slide 0 is currently in flight (`resolveSlowVod` pending), with abort tracking
      assert.strictEqual(vodInfoCalls.length, 1, 'Slide 0 visível iniciou 1 consulta get_vod_info');
      assert.strictEqual(heroStageEl.getAttribute('data-hero-paused'), 'false');
      assert.strictEqual(activeHeroIntervals.length, 1, 'Timer 8000ms deve estar ativo quando visível');

      // Scroll down past the HeroBanner so heroRect.bottom <= containerRect.top!
      heroRectTop = -700;
      heroRectBottom = -170;
      await act(async () => {
        scrollContainerEl.scrollTop = 764;
        scrollContainerEl.dispatchEvent(new Event('scroll'));
        await new Promise((r) => setTimeout(r, 20));
      });

      assert.strictEqual(
        heroStageEl.getAttribute('data-hero-paused'),
        'true',
        'Ao rolar para baixo tirando o HeroBanner da área visível, ele deve entrar em pausa completa'
      );
      assert.strictEqual(
        activeHeroIntervals.length,
        0,
        'Enquanto invisível, o timer de troca de slides do HeroBanner deve ser suspenso'
      );
      assert.strictEqual(
        slowVodAborted,
        true,
        'Ao ficar invisível, a solicitação não essencial exclusiva do HeroBanner deve ser cancelada'
      );

      // Late resolution of an aborted or stale request must be ignored cleanly
      const callsWhileInvisibleBefore = vodInfoCalls.length;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 25));
      });
      assert.strictEqual(
        vodInfoCalls.length,
        callsWhileInvisibleBefore,
        'Nenhuma nova consulta de detalhes deve iniciar enquanto o HeroBanner estiver invisível'
      );

      // Test shared consumer safety: start in-flight request with HeroBanner + MovieDetails, then cancel HeroBanner's AbortController
      clearHeroSessionCache();
      let sharedAborted = false;
      let resolveShared: ((val: any) => void) | null = null;
      XtreamService.getVodInfo = (_creds, _vodId, opts) =>
        new Promise((resolve, reject) => {
          if (opts?.signal) {
            opts.signal.addEventListener('abort', () => {
              sharedAborted = true;
              reject(new Error('Operação cancelada pelo usuário.'));
            });
          }
          resolveShared = resolve;
        });

      const heroCtrl = new AbortController();
      const activeConsumerCtrl = new AbortController();
      const sharedItem = { stream_id: 7777, stream_type: 'movie', name: 'Shared Item' };
      const pBanner = fetchOrReuseHeroDetails(accountA, sharedItem, { signal: heroCtrl.signal });
      const pDetails = fetchOrReuseHeroDetails(accountA, sharedItem, {
        signal: activeConsumerCtrl.signal,
        throwOnError: true,
      });
      heroCtrl.abort(); // Banner scrolled away / switched slide
      const bannerCancelledResult = await pBanner;
      assert.strictEqual(bannerCancelledResult, null);
      assert.strictEqual(
        sharedAborted,
        false,
        'Cancelar o sinal do HeroBanner NÃO pode abortar a mesma consulta aguardada por outro consumidor ativo (ex.: MovieDetails/Assistir)'
      );
      resolveShared!({
        info: { plot: 'Sinopse compartilhada', backdrop_path: ['http://img.hero.tv/7777.jpg'] },
        movie_data: { stream_id: 7777, container_extension: 'mp4' },
      });
      const activeDetailsRes = await pDetails;
      assert.strictEqual(
        activeDetailsRes.info.plot,
        'Sinopse compartilhada',
        'O consumidor ativo deve receber normalmente o resultado da consulta compartilhada'
      );

      // Restore synchronous mock & scroll HeroBanner back into view
      XtreamService.getVodInfo = async (creds, vodId) => {
        vodInfoCalls.push({ id: String(vodId), user: creds.username });
        return {
          info: {
            backdrop_path: [`http://img.hero.tv/vod/backdrop_${vodId}.jpg`],
            plot: `Sinopse ${vodId}`,
          },
          movie_data: { stream_id: Number(vodId), container_extension: 'mp4' },
        };
      };

      heroRectTop = 64;
      heroRectBottom = 594;
      await act(async () => {
        scrollContainerEl.scrollTop = 0;
        scrollContainerEl.dispatchEvent(new Event('scroll'));
        await new Promise((r) => setTimeout(r, 20));
      });
      assert.strictEqual(
        heroStageEl.getAttribute('data-hero-paused'),
        'false',
        'Ao voltar ao topo, o HeroBanner deve retomar a atividade no mesmo índice preservado'
      );
      assert.strictEqual(
        heroStageEl.getAttribute('data-hero-index'),
        '0',
        'O índice atual deve permanecer preservado ao pausar e retomar visibilidade'
      );
      assert.strictEqual(activeHeroIntervals.length, 1, 'Timer 8000ms deve ser reativado ao retornar à área visível');

      // Clean up DOM rects before next sub-test
      delete (scrollContainerEl as any).getBoundingClientRect;
      delete (heroWrapperEl as any).getBoundingClientRect;

      // Also test document.hidden pause
      Object.defineProperty(doc, 'hidden', { value: true, configurable: true });
      Object.defineProperty(doc, 'visibilityState', { value: 'hidden', configurable: true });
      await act(async () => {
        doc.dispatchEvent(new Event('visibilitychange') as any);
        await new Promise((r) => setTimeout(r, 15));
      });
      assert.strictEqual(
        heroStageEl.getAttribute('data-hero-paused'),
        'true',
        'Quando document.visibilityState=hidden, o HeroBanner deve pausar integralmente'
      );
      Object.defineProperty(doc, 'hidden', { value: false, configurable: true });
      Object.defineProperty(doc, 'visibilityState', { value: 'visible', configurable: true });
      await act(async () => {
        doc.dispatchEvent(new Event('visibilitychange') as any);
        await new Promise((r) => setTimeout(r, 15));
      });
      assert.strictEqual(heroStageEl.getAttribute('data-hero-paused'), 'false');
    } finally {
      (windowInstance as any).IntersectionObserver = origWindowIOForFallback;
      (globalThis as any).IntersectionObserver = origGlobalIOForFallback;
    }

    // -----------------------------------------------------------------------
    // 10.4. Preservação da sequência por página (Início, Filmes, Séries) +
    //       Reinício apenas quando o catálogo for substituído ou conta mudar
    // -----------------------------------------------------------------------
    await act(async () => {
      root.render(React.createElement('div'));
      await new Promise((r) => setTimeout(r, 10));
    });
    clearHeroSessionCache();
    activeHeroIntervals = [];

    // 1) Render 'movies' and advance twice -> index 2
    await act(async () => {
      root.render(
        React.createElement(
          XtreamProvider,
          { credentials: accountA },
          React.createElement(HeroBanner, {
            items: moviesHero.slice(0, 5),
            domain: 'movies',
            onPlay: () => {},
            onInfo: () => {},
          })
        )
      );
      await new Promise((r) => setTimeout(r, 15));
    });
    await act(async () => {
      activeHeroIntervals[0].cb();
      await new Promise((r) => setTimeout(r, 10));
    });
    await act(async () => {
      activeHeroIntervals[0].cb();
      await new Promise((r) => setTimeout(r, 10));
    });
    assert.strictEqual(
      container.querySelector('[data-hero-stage="true"]')?.getAttribute('data-hero-index'),
      '2',
      'Filmes deve estar no slide 2'
    );

    // 2) Switch to 'series' and advance once -> index 1
    await act(async () => {
      root.render(
        React.createElement(
          XtreamProvider,
          { credentials: accountA },
          React.createElement(HeroBanner, {
            items: seriesHero.slice(0, 5),
            domain: 'series',
            onPlay: () => {},
            onInfo: () => {},
          })
        )
      );
      await new Promise((r) => setTimeout(r, 15));
    });
    assert.strictEqual(
      container.querySelector('[data-hero-stage="true"]')?.getAttribute('data-hero-index'),
      '0',
      'Séries deve iniciar no slide 0 na primeira visita'
    );
    await act(async () => {
      activeHeroIntervals[0].cb();
      await new Promise((r) => setTimeout(r, 10));
    });
    assert.strictEqual(
      container.querySelector('[data-hero-stage="true"]')?.getAttribute('data-hero-index'),
      '1',
      'Séries deve estar no slide 1'
    );

    // 3) Return to 'movies' -> MUST restore directly to index 2!
    await act(async () => {
      root.render(
        React.createElement(
          XtreamProvider,
          { credentials: accountA },
          React.createElement(HeroBanner, {
            items: moviesHero.slice(0, 5),
            domain: 'movies',
            onPlay: () => {},
            onInfo: () => {},
          })
        )
      );
      await new Promise((r) => setTimeout(r, 15));
    });
    assert.strictEqual(
      container.querySelector('[data-hero-stage="true"]')?.getAttribute('data-hero-index'),
      '2',
      'Ao voltar para Filmes após visitar Séries, o HeroBanner deve preservar o índice 2 sem reiniciar para 0'
    );

    // 4) Replace movies catalog with genuinely different items -> MUST reset to 0!
    const replacedMovies = Array.from({ length: 5 }, (_, i) => ({
      stream_id: 9500 + i,
      stream_type: 'movie',
      name: `Novo Catálogo ${i}`,
      stream_icon: `http://img.hero.tv/new/${9500 + i}.jpg`,
      rating: String(9.0 - i * 0.1),
      year: '2026',
    }));
    await act(async () => {
      root.render(
        React.createElement(
          XtreamProvider,
          { credentials: accountA },
          React.createElement(HeroBanner, {
            items: replacedMovies,
            domain: 'movies',
            onPlay: () => {},
            onInfo: () => {},
          })
        )
      );
      await new Promise((r) => setTimeout(r, 15));
    });
    assert.strictEqual(
      container.querySelector('[data-hero-stage="true"]')?.getAttribute('data-hero-index'),
      '0',
      'Quando o catálogo for substituído por novos itens, o HeroBanner deve reiniciar para o índice 0'
    );

    // -----------------------------------------------------------------------
    // 10.5. Isolamento por conta/servidor e limpeza no logout
    // -----------------------------------------------------------------------
    // Populate Account B with same item IDs -> must NOT reuse Account A's details cache or sequence
    const callsBeforeAccountB = vodInfoCalls.length;
    await act(async () => {
      root.render(
        React.createElement(
          XtreamProvider,
          { credentials: accountB },
          React.createElement(HeroBanner, {
            items: moviesHero.slice(0, 5),
            domain: 'movies',
            onPlay: () => {},
            onInfo: () => {},
          })
        )
      );
      await new Promise((r) => setTimeout(r, 20));
    });
    assert.strictEqual(
      container.querySelector('[data-hero-stage="true"]')?.getAttribute('data-hero-index'),
      '0',
      'Conta B deve iniciar com sequência isolada no índice 0'
    );
    assert(
      vodInfoCalls.length > callsBeforeAccountB &&
        vodInfoCalls[vodInfoCalls.length - 1].user === accountB.username,
      'Conta B não deve vazar nem reaproveitar detalhes em cache da Conta A'
    );

    clearHeroSessionCache();
    const clearedStats = getHeroSessionCacheStatsForTest();
    assert.strictEqual(clearedStats.metadataEntriesCount, 0);
    assert.strictEqual(clearedStats.seriesEpisodesEntriesCount, 0);
    assert.strictEqual(clearedStats.inFlightCount, 0);
    assert.strictEqual(clearedStats.sequenceEntriesCount, 0);

    // -----------------------------------------------------------------------
    // 10.6. Botões "Assistir"/"Continuar" e "Mais informações" + 10.7. Web e Android
    // -----------------------------------------------------------------------
    playedCalls = [];
    let infoClickedItem: any = null;
    await act(async () => {
      root.render(
        React.createElement(
          XtreamProvider,
          { credentials: accountA },
          React.createElement(HeroBanner, {
            items: [moviesHero[0]],
            domain: 'inicio',
            canContinueItem: () => true,
            onPlay: (item, details) => {
              playedCalls.push({ item, details });
            },
            onInfo: (item) => {
              infoClickedItem = item;
            },
          })
        )
      );
      await new Promise((r) => setTimeout(r, 20));
    });

    const playBtn = container.querySelector('[data-hero-action="play"]') as any;
    const infoBtn = container.querySelector('[data-hero-action="info"]') as any;
    assert(playBtn && (playBtn.textContent || '').includes('Continuar'), 'Botão deve exibir Continuar quando houver progresso');
    assert(infoBtn && (infoBtn.textContent || '').includes('Mais informações'), 'Botão Mais informações deve existir');

    await act(async () => {
      playBtn.click();
      infoBtn.click();
    });
    assert.strictEqual(playedCalls.length, 1, 'Botão Assistir/Continuar deve acionar reprodução com os detalhes em cache');
    assert.strictEqual(playedCalls[0].item.stream_id, moviesHero[0].stream_id);
    assert.strictEqual(infoClickedItem?.stream_id, moviesHero[0].stream_id);

    // 10.7b. Android persistent cache mode: no bulk 30-cover downloads & 0 downloads while paused/invisible
    const androidHarness = createSimulatedPersistentImageDiskHarness({
      initialMaxBytes: 120 * 1024 * 1024,
      defaultByteSize: 2048,
      customResponder: () => ({
        status: 200,
        contentType: 'image/jpeg',
        bodyBytes: createValidTestJpegBytes(2048),
      }),
    });

    try {
      androidHarness.install();
      clearHeroSessionCache();
      setCatalogTransferPhaseActiveForImageCache(false);

      // 1) Mount paused/invisible with 30 movies -> ZERO image fetches must occur
      await act(async () => {
        root.render(
          React.createElement(
            XtreamProvider,
            { credentials: accountA },
            React.createElement(HeroBanner, {
              items: moviesHero,
              domain: 'movies',
              isPaused: true,
              onPlay: () => {},
              onInfo: () => {},
            })
          )
        );
        await new Promise((r) => setTimeout(r, 700));
      });
      assert.strictEqual(
        androidHarness.getNetworkFetchCount(),
        0,
        'No Android com HeroBanner pausado/invisível, nenhuma capa deve ser baixada em segundo plano'
      );

      // 2) Mount visible with 30 series -> downloads ONLY current slide (+ at most 1 next slide after settling), NEVER all 30 covers!
      await act(async () => {
        root.render(
          React.createElement(
            XtreamProvider,
            { credentials: accountA },
            React.createElement(HeroBanner, {
              items: seriesHero,
              domain: 'series',
              isPaused: false,
              onPlay: () => {},
              onInfo: () => {},
            })
          )
        );
        await new Promise((r) => setTimeout(r, 700));
      });
      const androidVisibleFetches = androidHarness.getNetworkFetchCount();
      assert(
        androidVisibleFetches >= 1 && androidVisibleFetches <= 2,
        `No Android com HeroBanner visível, deve baixar apenas o slide atual e no máximo o próximo slide após estabilizar — nunca as 30 capas (baixados=${androidVisibleFetches})`
      );
    } finally {
      androidHarness.uninstall();
    }

    // -----------------------------------------------------------------------
    // 10.8. Entrega B — HeroBanner com IntersectionObserver ativo NÃO deve
    //       anexar listener contínuo de scroll nem chamar getBoundingClientRect() a cada rolagem
    // -----------------------------------------------------------------------
    await act(async () => {
      root.render(React.createElement('div'));
      await new Promise((r) => setTimeout(r, 10));
    });
    clearHeroSessionCache();
    vodInfoCalls = [];
    activeHeroIntervals = [];

    const origWindowIO = (windowInstance as any).IntersectionObserver;
    const origGlobalIO = (globalThis as any).IntersectionObserver;
    let capturedIOCallback: ((entries: any[]) => void) | null = null;
    let ioObservedElements = 0;
    let ioDisconnected = false;

    class MockIntersectionObserver {
      private cb: (entries: any[]) => void;
      private isHeroObserver = false;
      constructor(cb: (entries: any[]) => void) {
        this.cb = cb;
      }
      observe(el: any) {
        if (el?.classList?.contains?.('nc-tv-hero')) {
          this.isHeroObserver = true;
          capturedIOCallback = this.cb;
          ioObservedElements++;
        }
      }
      unobserve() {}
      disconnect() {
        if (this.isHeroObserver) {
          ioDisconnected = true;
        }
      }
    }

    (windowInstance as any).IntersectionObserver = MockIntersectionObserver;
    (globalThis as any).IntersectionObserver = MockIntersectionObserver;

    try {
      await act(async () => {
        root.render(
          React.createElement(
            XtreamProvider,
            { credentials: accountA },
            React.createElement(CatalogShowcaseView, {
              section: 'movies',
              credentials: accountA,
              onPlay: () => {},
              vodCategories: [{ category_id: '10', category_name: 'Ação' }],
              vodStreams: vodForScrollTest,
              allVodStreams: vodForScrollTest,
              sessionReady: true,
            })
          )
        );
        await new Promise((r) => setTimeout(r, 25));
      });

      const ioScrollContainer = container.querySelector('[data-scroll-container="true"]') as any;
      const ioHeroWrapper = container.querySelector('.nc-tv-hero') as any;
      const ioHeroStage = container.querySelector('[data-hero-stage="true"]') as any;
      assert(ioScrollContainer && ioHeroWrapper && ioHeroStage);
      assert.strictEqual(ioObservedElements, 1, 'HeroBanner deve observar heroEl via IntersectionObserver');
      assert(capturedIOCallback, 'Callback do IntersectionObserver deve estar registrado');

      // Contabilizar chamadas de getBoundingClientRect no próprio HeroBanner durante múltiplos eventos de scroll/resize
      let heroRectCallsDuringScroll = 0;
      ioScrollContainer.getBoundingClientRect = () => ({
        top: 64,
        bottom: 720,
        left: 0,
        right: 1280,
        width: 1280,
        height: 656,
      });
      ioHeroWrapper.getBoundingClientRect = () => {
        heroRectCallsDuringScroll++;
        return { top: 64, bottom: 594, left: 0, right: 1280, width: 1280, height: 530 };
      };

      await act(async () => {
        for (let step = 1; step <= 10; step++) {
          ioScrollContainer.scrollTop = step * 80;
          ioScrollContainer.dispatchEvent(new Event('scroll'));
        }
        windowInstance.dispatchEvent(new Event('resize') as any);
        await new Promise((r) => setTimeout(r, 20));
      });

      assert.strictEqual(
        heroRectCallsDuringScroll,
        0,
        `Com IntersectionObserver ativo, scroll e resize NÃO devem disparar getBoundingClientRect() contínuo no HeroBanner (chamadas=${heroRectCallsDuringScroll})`
      );

      // Pausa e retomada continuam funcionando normalmente via IntersectionObserver
      await act(async () => {
        capturedIOCallback!([{ isIntersecting: false, intersectionRatio: 0 }]);
        await new Promise((r) => setTimeout(r, 15));
      });
      assert.strictEqual(
        ioHeroStage.getAttribute('data-hero-paused'),
        'true',
        'IntersectionObserver com isIntersecting=false deve pausar o HeroBanner'
      );
      assert.strictEqual(activeHeroIntervals.length, 0);

      await act(async () => {
        capturedIOCallback!([{ isIntersecting: true, intersectionRatio: 0.75 }]);
        await new Promise((r) => setTimeout(r, 15));
      });
      assert.strictEqual(
        ioHeroStage.getAttribute('data-hero-paused'),
        'false',
        'IntersectionObserver com isIntersecting=true deve retomar o HeroBanner'
      );
      assert.strictEqual(activeHeroIntervals.length, 1);

      await act(async () => {
        root.render(React.createElement('div'));
        await new Promise((r) => setTimeout(r, 10));
      });
      assert.strictEqual(ioDisconnected, true, 'Ao desmontar, HeroBanner deve chamar observer.disconnect()');
    } finally {
      (windowInstance as any).IntersectionObserver = origWindowIO;
      (globalThis as any).IntersectionObserver = origGlobalIO;
    }
  } finally {
    restoreHeroIntervalTracker();
    Object.assign(XtreamService, origMethods);
    clearHeroSessionCache();
    clearAllBackHandlersForTest();
    clearFocusMemory();
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }

  console.log(
    '✅ Entrega A (HeroBanner: reuso de seleção, cache compartilhado, pausa por visibilidade, sequência por página, isolamento de conta, botões e Web/Android) validada!'
  );
}

// ============================================================================
// 11. CONSOLIDAÇÃO PARA LANÇAMENTO — ENTREGA C2.1 (REMOÇÃO DE DIAGNÓSTICOS DE CATÁLOGO)
// ============================================================================
async function runDeliveryC21CatalogCleanupAndRegressionTests(): Promise<void> {
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
  const prevFetchResponder = customFetchResponder;
  try {
    // Web fetch válido
    setTransportTestConfig({ mode: 'web', androidCatalogPluginAvailable: false });
    customFetchResponder = async () =>
      new Response(JSON.stringify([{ stream_id: 1, name: 'Filme Web' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    const webPayload = await executeXtreamGetRequest({
      url: 'http://provider.tv/player_api.php?action=get_vod_streams',
      timeoutMs: 5000,
      isFullCatalogRequest: true,
    });
    assert(Array.isArray(webPayload) && webPayload.length === 1 && webPayload[0].stream_id === 1);

    // JSON/HTML inválido deve falhar em normalizeCatalogArray via XtreamService
    customFetchResponder = async () =>
      new Response('<html><body>Erro 502</body></html>', { status: 200 });
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
    customFetchResponder = async () => {
      retryAttempts++;
      if (retryAttempts === 1) {
        return new Response('Busy', { status: 503 });
      }
      return new Response(JSON.stringify([{ stream_id: 2, name: 'Após Retry' }]), {
        status: 200,
      });
    };
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
    customFetchResponder = async (url) => {
      assert.strictEqual(url, tempFileUrl);
      return new Response(JSON.stringify([{ stream_id: 99, name: 'Filme Temp Android' }]), {
        status: 200,
      });
    };
    const androidPayload = await executeXtreamGetRequest({
      url: 'http://provider.tv/player_api.php?action=get_vod_streams',
      timeoutMs: 5000,
      isFullCatalogRequest: true,
    });
    assert.strictEqual(getAndroidCatalogAdapterLoadCountForTest(), 1);
    assert.strictEqual(androidPayload[0].stream_id, 99);
    assert.strictEqual(cleanedFileId, 'nc_catalog_test1.json');
  } finally {
    customFetchResponder = prevFetchResponder;
    setAndroidCatalogFileAdapterTestOverride({ plugin: null, convertFileSrc: null });
    setTransportTestConfig({ mode: 'auto', capacitorHttpGet: null, androidCatalogPluginAvailable: null });
  }

  // 3) Orquestração das 6 operações em XtreamContext (concorrência máx 2 e allSixFinished)
  const doc = windowInstance.document;
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container);

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
  } finally {
    Object.assign(XtreamService, origMethods);
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }

  console.log(
    '✅ Entrega C2.1 (exclusão física de catalogDiagnostics, preservação de transporte Web/Android, retries, validação de JSON inválido e fila de 6 catálogos) validada!'
  );
}

async function runDeliveryC22NativeCleanupAndPreparationTests(): Promise<void> {
  console.log(
    '\n--- 12. Entrega C2.2: Remoção de Patch HTTP Nativo, Instrumentação Java e Integridade Android ---'
  );

  const patchFilePath = path.resolve(
    'tooling/android/patches/capacitor-android-8.6.0-http-diagnostics.patch'
  );
  assert.strictEqual(
    fs.existsSync(patchFilePath),
    false,
    'Patch HTTP diagnóstico P3.2 deve ter sido excluído fisicamente'
  );
  assert.strictEqual(
    fs.existsSync(path.resolve('tooling/android/patches')),
    false,
    'Diretório vazio tooling/android/patches não deve permanecer no projeto'
  );

  const prepareAndroidMod: Record<string, any> = await import(
    '../tooling/android/prepare-android.mjs'
  );

  for (const removedExport of [
    'CAPACITOR_HTTP_DIAGNOSTICS_PATCH_REL_PATH',
    'CAPACITOR_HTTP_HANDLER_REL_PATH',
    'REQUIRED_PATCH_MARKERS',
    'applyCapacitorAndroidHttpDiagnosticsPatch',
    'verifyCapacitorAndroidHttpDiagnosticsPatch',
  ]) {
    assert.strictEqual(
      typeof prepareAndroidMod[removedExport],
      'undefined',
      `prepare-android.mjs não deve exportar ${removedExport}`
    );
  }

  assert.strictEqual(prepareAndroidMod.EXPECTED_CAPACITOR_ANDROID_VERSION, '8.6.0');
  assert.strictEqual(typeof prepareAndroidMod.computeAndroidVersionCode, 'function');
  assert.strictEqual(typeof prepareAndroidMod.verifyCleanCapacitorAndroidDependency, 'function');
  assert.strictEqual(typeof prepareAndroidMod.verifyAndroidCustomizations, 'function');
  assert.strictEqual(typeof prepareAndroidMod.prepareAndroidProject, 'function');

  // Validar dependência real limpa em node_modules/@capacitor/android@8.6.0
  const realIntegrity = prepareAndroidMod.verifyCleanCapacitorAndroidDependency(process.cwd());
  assert.strictEqual(realIntegrity.version, '8.6.0');

  // Validar CatalogFileTransferPlugin.java sem instrumentação diagnóstica e com métodos operacionais
  const catalogPluginJava = fs.readFileSync(
    path.resolve(
      'tooling/android/overlay/app/src/main/java/com/northcode/play/CatalogFileTransferPlugin.java'
    ),
    'utf8'
  );
  for (const forbiddenSymbol of [
    'collectDiagnostics',
    'nativeDiagnostics',
    'parseContentLengthHeader',
    'nanosToMillis',
    'statusAndHeadersMs',
    'fileWriteMs',
    'nativeTotalMs',
    'contentLengthHeaderBytes',
    'bytesWritten',
    'ICapacitorHttpUrlConnection',
  ]) {
    assert(
      !catalogPluginJava.includes(forbiddenSymbol),
      `CatalogFileTransferPlugin.java não deve conter símbolo diagnóstico removido: ${forbiddenSymbol}`
    );
  }
  for (const requiredOperationalSymbol of [
    '@CapacitorPlugin(name = "CatalogFileTransfer")',
    'downloadCatalogToTempFile',
    'cancelTransfer',
    'cleanupTransferFile',
    'nc_catalog_transfers',
    'STREAM_BUFFER_SIZE = 16384',
    'HttpRequestHandler.HttpURLConnectionBuilder',
    'HttpRequestHandler.isDomainExcludedFromSSL',
  ]) {
    assert(
      catalogPluginJava.includes(requiredOperationalSymbol),
      `CatalogFileTransferPlugin.java deve preservar comportamento operacional: ${requiredOperationalSymbol}`
    );
  }

  // Validar ANDROID_BUILD.md atualizado e src/ sem parâmetros diagnósticos residuais
  const androidBuildDoc = fs.readFileSync(path.resolve('ANDROID_BUILD.md'), 'utf8');
  assert(
    !androidBuildDoc.includes('capacitor-android-8.6.0-http-diagnostics.patch') &&
      !androidBuildDoc.includes('P3.2'),
    'ANDROID_BUILD.md não deve referenciar o patch P3.2 removido'
  );
  for (const tsFile of [
    'src/services/androidCatalogFileAdapter.ts',
    'src/services/httpTransport.ts',
  ]) {
    const content = fs.readFileSync(path.resolve(tsFile), 'utf8');
    assert(
      !content.includes('collectDiagnostics') && !content.includes('nativeDiagnostics'),
      `${tsFile} deve permanecer compatível e livre de parâmetros diagnósticos removidos`
    );
  }

  // Testar integridade contra dependência suja e fluxo completo de prepareAndroidProject em diretório temporário isolado
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-c22-android-prep-'));
  try {
    const setupCapacitorPackage = (version: string, httpHandlerJavaContent: string) => {
      const capAndroidDir = path.join(tempRoot, 'node_modules', '@capacitor', 'android');
      const handlerFile = path.join(
        capAndroidDir,
        'capacitor',
        'src',
        'main',
        'java',
        'com',
        'getcapacitor',
        'plugin',
        'util',
        'HttpRequestHandler.java'
      );
      fs.mkdirSync(path.dirname(handlerFile), { recursive: true });
      fs.writeFileSync(
        path.join(capAndroidDir, 'package.json'),
        JSON.stringify({ name: '@capacitor/android', version }),
        'utf8'
      );
      fs.writeFileSync(handlerFile, httpHandlerJavaContent, 'utf8');
      return handlerFile;
    };

    const cleanHandlerContent = fs.readFileSync(
      path.resolve(
        'node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/plugin/util/HttpRequestHandler.java'
      ),
      'utf8'
    );

    // 1) Rejeitar HttpRequestHandler.java contaminado pelo patch antigo sem modificá-lo
    const dirtyContent = `${cleanHandlerContent}\n// buildResponseWithDiagnostics(conn, rt, ns, nativeDiagnostics)\n// nativeDiagnostics.put("nativeTotalMs", 1);\n`;
    const dirtyHandlerPath = setupCapacitorPackage('8.6.0', dirtyContent);
    assert.throws(
      () => prepareAndroidMod.verifyCleanCapacitorAndroidDependency(tempRoot),
      /Integridade de @capacitor\/android@8\.6\.0 comprometida/,
      'Deve detectar marcadores residuais do antigo patch em instalação local reaproveitada'
    );
    assert.strictEqual(
      fs.readFileSync(dirtyHandlerPath, 'utf8'),
      dirtyContent,
      'Verificação de integridade não deve sobrescrever arquivo de terceiros automaticamente'
    );

    // 2) Rejeitar versão incorreta de @capacitor/android
    setupCapacitorPackage('8.5.0', cleanHandlerContent);
    assert.throws(
      () => prepareAndroidMod.verifyCleanCapacitorAndroidDependency(tempRoot),
      /Versão incompatível de @capacitor\/android/,
      'Deve validar a versão travada 8.6.0 de @capacitor/android'
    );

    // 3) Preparação completa (geração inicial + reutilização idempotente) sem patch
    setupCapacitorPackage('8.6.0', cleanHandlerContent);
    fs.writeFileSync(
      path.join(tempRoot, 'package.json'),
      JSON.stringify({ name: 'north-code-play', version: '1.3.0' }),
      'utf8'
    );
    fs.mkdirSync(path.join(tempRoot, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, 'dist', 'index.html'), '<html></html>', 'utf8');
    fs.mkdirSync(path.join(tempRoot, 'src', 'assets'), { recursive: true });
    fs.copyFileSync(
      path.resolve('src/assets/logo.png'),
      path.join(tempRoot, 'src', 'assets', 'logo.png')
    );
    fs.cpSync(
      path.resolve('tooling/android/overlay'),
      path.join(tempRoot, 'tooling', 'android', 'overlay'),
      { recursive: true }
    );

    const mockCapCliPath = path.join(
      tempRoot,
      'node_modules',
      '@capacitor',
      'cli',
      'bin',
      'capacitor'
    );
    fs.mkdirSync(path.dirname(mockCapCliPath), { recursive: true });
    fs.writeFileSync(
      mockCapCliPath,
      `import fs from 'node:fs';
import path from 'node:path';
const [cmd, target] = process.argv.slice(2);
const androidDir = path.join(process.cwd(), 'android');
if (cmd === 'add' && target === 'android') {
  fs.mkdirSync(path.join(androidDir, 'app', 'src', 'main', 'assets', 'public'), { recursive: true });
  fs.writeFileSync(
    path.join(androidDir, 'app', 'build.gradle'),
    'android {\\n  namespace = "com.example.placeholder"\\n  defaultConfig {\\n    applicationId "com.example.placeholder"\\n    versionCode 1\\n    versionName "1.0"\\n  }\\n}\\n',
    'utf8'
  );
} else if (cmd === 'sync' && target === 'android') {
  const assetsDir = path.join(androidDir, 'app', 'src', 'main', 'assets');
  fs.mkdirSync(path.join(assetsDir, 'public'), { recursive: true });
  fs.copyFileSync(path.join(process.cwd(), 'dist', 'index.html'), path.join(assetsDir, 'public', 'index.html'));
  fs.writeFileSync(path.join(assetsDir, 'capacitor.config.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(assetsDir, 'capacitor.plugins.json'), '[]', 'utf8');
}
`,
      'utf8'
    );

    const firstPrep = prepareAndroidMod.prepareAndroidProject({
      rootDir: tempRoot,
      skipWebBuild: true,
    });
    assert.strictEqual(firstPrep.reusedExistingAndroid, false);
    assert.strictEqual(firstPrep.capacitorAndroidVersion, '8.6.0');
    assert.strictEqual(firstPrep.versionName, '1.3.0');
    assert.strictEqual(firstPrep.versionCode, 10300);
    assert.strictEqual('patchApplied' in firstPrep, false);
    assert.strictEqual('patchAlreadyApplied' in firstPrep, false);

    const secondPrep = prepareAndroidMod.prepareAndroidProject({
      rootDir: tempRoot,
      skipWebBuild: true,
    });
    assert.strictEqual(secondPrep.reusedExistingAndroid, true);
    assert.strictEqual(secondPrep.capacitorAndroidVersion, '8.6.0');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  // Confirmar preservação de status HTTP de erro (ex.: 403) no androidCatalogFileAdapter sem nativeDiagnostics
  setTransportTestConfig({ mode: 'capacitor', androidCatalogPluginAvailable: true });
  setAndroidCatalogFileAdapterTestOverride({
    plugin: {
      async downloadCatalogToTempFile() {
        return {
          status: 403,
          fileId: null,
          filePath: null,
          cacheDir: '/data/user/0/com.northcode.play/cache/nc_catalog_transfers',
        };
      },
      async cancelTransfer() {
        return { cancelled: true };
      },
      async cleanupTransferFile() {
        return { deleted: false };
      },
    },
  });
  let observedForbiddenStatus: number | undefined;
  try {
    await executeXtreamGetRequest({
      url: 'http://provider.tv/player_api.php?action=get_vod_streams',
      timeoutMs: 5000,
      isFullCatalogRequest: true,
    });
  } catch (err: any) {
    observedForbiddenStatus = err?.status;
  } finally {
    setAndroidCatalogFileAdapterTestOverride({ plugin: null, convertFileSrc: null });
    setTransportTestConfig({ mode: 'auto', capacitorHttpGet: null, androidCatalogPluginAvailable: null });
  }
  assert.strictEqual(
    observedForbiddenStatus,
    403,
    'Adapter Android deve continuar preservando códigos HTTP de erro reais'
  );

  console.log(
    '✅ Entrega C2.2 (exclusão do patch HTTP, limpeza do CatalogFileTransferPlugin, integridade @capacitor/android@8.6.0 e preparação Android idempotente) validada!'
  );
}

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
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container);
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
          error: 'Falha ao carregar transmissão',
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
    await act(async () => {
      root.unmount();
    });
    restoreHlsMock();
    clearAllBackHandlersForTest();
    container.remove();
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
      '/api/image?url=https%3A%2F%2Fcdn.example.com%2Fcover.jpg&server=http%3A%2F%2Fprovider.tv',
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
      updates501A.includes('ready') && updates501B.includes('ready'),
      'Ambos os assinantes deduplicados do canal 501 devem receber snapshot ready'
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
    assert.strictEqual(cachedStatus, 'ready', 'Cache de EPG deve entregar snapshot ready imediatamente');
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

  console.log(
    '✅ Entrega C3 (remoção final de diagnósticos e contadores + regressões funcionais de Player, ConfigView, mediaUtils, catalogRanking, playbackHistory e liveEpgManager) validada!'
  );
}

async function main(): Promise<void> {
  console.log('🚀 INICIANDO SUÍTE DIRECIONADA DE TESTES — NORTH CODE PLAY\n');
  runEssentialTrackAndSecurityTests();
  await runLiveTvFullscreenAndPreviewTransitionTests();
  await runWhitePaletteAndControlsIntegrationTests();
  await runCycle1230bSpatialNavOptimizationTests();
  await runCycle1230cVerticalNavOptimizationTests();
  await runCycle1230dLiveTvLatencyAndFullscreenTests();
  await runStep1PersistentImageCacheAndPreloadTests();
  await runStep2StartupAndFluidityStabilizationTests();
  await runStep3DpadFluidityAndDiagnosticsTests();
  await runDeliveryAHeroBannerConsolidationTests();
  await runDeliveryC21CatalogCleanupAndRegressionTests();
  await runDeliveryC22NativeCleanupAndPreparationTests();
  await runDeliveryC3FinalCleanupAndRegressionTests();
  for (const timer of rafTimers.values()) {
    clearTimeout(timer);
  }
  rafTimers.clear();
  console.log('\n🎉 TODOS OS TESTES FORAM EXECUTADOS COM SUCESSO!');
  await windowInstance.close();
}

main().catch((err) => {
  console.error('\n❌ ERRO NA EXECUÇÃO DOS TESTES:', err);
  process.exit(1);
});


