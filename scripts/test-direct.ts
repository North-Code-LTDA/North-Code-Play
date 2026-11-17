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
import {
  LiveTvView,
  getLiveTvRenderStatsForTest,
  resetLiveTvRenderStatsForTest,
} from '../src/views/LiveTvView';
import { XtreamProvider } from '../src/context/XtreamContext';
import { XtreamService } from '../src/services/xtreamService';
import type { XtreamCredentials } from '../src/types';
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
  getSpatialNavPerfStats,
  resetSpatialNavPerfStats,
  setFastHorizontalRowNavEnabledForTest,
  setFastVerticalNavEnabledForTest,
  registerShowcaseRowController,
  unregisterShowcaseRowController,
  registerVirtualContainer,
  unregisterVirtualContainer,
  invalidateCandidateCache,
} from '../src/navigation';
import { HorizontalRow } from '../src/components/HorizontalRow';




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

    // A) Medir 5 movimentos rápidos (0 -> 1 -> 2 -> 3 -> 4 -> 5) no CAMINHO RÁPIDO
    invalidateCandidateCache();
    resetSpatialNavPerfStats();
    setFastHorizontalRowNavEnabledForTest(true);

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

    const fastStats = getSpatialNavPerfStats();
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

    // B) Medir os mesmos 5 movimentos (0 -> 1 -> 2 -> 3 -> 4 -> 5) no CAMINHO TRADICIONAL
    invalidateCandidateCache();
    resetSpatialNavPerfStats();
    setFastHorizontalRowNavEnabledForTest(false);

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

    const traditionalStats = getSpatialNavPerfStats();
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
    assert.strictEqual(
      fastStats.boundingRectCalls,
      0,
      `Caminho rápido entre cartões montados na mesma fileira virtualizada não deve ler getBoundingClientRect desnecessariamente (obtido: ${fastStats.boundingRectCalls})`
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
    resetSpatialNavPerfStats();

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

    const virtualCrossingStats = getSpatialNavPerfStats();
    assert(
      virtualCrossingStats.virtualWindowExpansions > 0,
      'Atravessar além da janela inicial deve expandir a janela virtualizada sincronicamente'
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
    resetSpatialNavPerfStats();
    const movedToCh1 = moveSpatialFocus('right');
    const liveFastStats = getSpatialNavPerfStats();
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
    resetSpatialNavPerfStats();
    ensureRowMountedCalls = 0;
    setFastVerticalNavEnabledForTest(true);

    for (let targetRow = 1; targetRow <= 4; targetRow++) {
      const next = moveSpatialFocus('down');
      assert.strictEqual(
        next?.getAttribute('data-test-pos'),
        `r${targetRow}-c0`,
        `Passo vertical rápido para baixo deve focar r${targetRow}-c0`
      );
    }

    const fastDownStats = getSpatialNavPerfStats();
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
    resetSpatialNavPerfStats();
    setFastVerticalNavEnabledForTest(false);

    for (let targetRow = 1; targetRow <= 4; targetRow++) {
      const next = moveSpatialFocus('down');
      assert.strictEqual(
        next?.getAttribute('data-test-pos'),
        `r${targetRow}-c0`,
        `Passo vertical tradicional para baixo deve focar r${targetRow}-c0`
      );
    }

    const tradDownStats = getSpatialNavPerfStats();
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
      fastDownStats.boundingRectCalls <= 4,
      `Caminho vertical rápido entre fileiras montadas deve restringir getBoundingClientRect apenas ao contêiner de scroll por passo (obtido: ${fastDownStats.boundingRectCalls})`
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
    resetSpatialNavPerfStats();

    for (let r = 1; r < totalShowcaseRows; r++) {
      const moved = moveSpatialFocus('down');
      assert.strictEqual(
        moved?.getAttribute('data-test-pos'),
        `r${r}-c0`,
        `Travessia vertical virtualizada deve montar e focar a fileira ${r}`
      );
    }

    const rowCrossingStats = getSpatialNavPerfStats();
    assert(
      rowCrossingStats.virtualWindowExpansions > 0,
      'Atravessar fileiras além da janela inicial deve expandir sincronicamente a janela de fileiras'
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
    resetSpatialNavPerfStats();
    setFastVerticalNavEnabledForTest(true);

    for (let row = 1; row <= 3; row++) {
      const expectedIdx = row * gridCols + 3;
      const next = moveSpatialFocus('down');
      assert.strictEqual(
        next?.getAttribute('data-virtual-index'),
        String(expectedIdx),
        `Passo vertical rápido na grade deve focar o índice ${expectedIdx} mantendo a coluna 3`
      );
    }

    const fastGridStats = getSpatialNavPerfStats();

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
    resetSpatialNavPerfStats();
    setFastVerticalNavEnabledForTest(false);

    for (let row = 1; row <= 3; row++) {
      const expectedIdx = row * gridCols + 3;
      const next = moveSpatialFocus('down');
      assert.strictEqual(
        next?.getAttribute('data-virtual-index'),
        String(expectedIdx),
        `Passo vertical tradicional na grade deve focar o índice ${expectedIdx}`
      );
    }

    const tradGridStats = getSpatialNavPerfStats();
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
      fastGridStats.boundingRectCalls <= 3,
      `Caminho rápido na grade virtualizada deve restringir getBoundingClientRect apenas ao contêiner de scroll por passo (obtido: ${fastGridStats.boundingRectCalls})`
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

    resetLiveTvRenderStatsForTest();

    // Navegar horizontalmente por 4 canais na fileira Esportes (1000 -> 1001 -> 1002 -> 1003 -> 1004)
    // e verticalmente entre categorias (Esportes -> Notícias -> Filmes -> voltar a Esportes)
    const expectedNextRow1 = String(Number(sportsRowIndex) + 1);
    const expectedNextRow2 = String(Number(sportsRowIndex) + 2);

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

    const focusNavStats = getLiveTvRenderStatsForTest();
    assert.strictEqual(
      focusNavStats.viewRenders,
      0,
      `Mudança de foco entre canais NÃO deve re-renderizar LiveTvView (obtido: ${focusNavStats.viewRenders})`
    );
    assert.strictEqual(
      focusNavStats.rowRenders,
      0,
      `Mudança de foco entre canais montados NÃO deve re-renderizar LiveCategoryRow (obtido: ${focusNavStats.rowRenders})`
    );
    assert.strictEqual(
      focusNavStats.rightPaneRenders,
      0,
      `Mudança de foco entre canais NÃO deve re-renderizar o painel direito de preview (obtido: ${focusNavStats.rightPaneRenders})`
    );
    assert.strictEqual(
      focusNavStats.epgSectionRenders,
      0,
      `Mudança de foco entre canais NÃO deve re-renderizar a grade de EPG (obtido: ${focusNavStats.epgSectionRenders})`
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

    resetLiveTvRenderStatsForTest();
    pauseCallsWhilePending = 0;

    // Executar 2º OK no canal 1000 já selecionado
    await act(async () => {
      insideClickActivation = true;
      ch1000Again.click();
      insideClickActivation = false;
    });

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
      getLiveTvRenderStatsForTest().viewRenders,
      0,
      '2º OK via comunicação direta NÃO deve exigir re-render de LiveTvView para solicitar fullscreen'
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

async function main(): Promise<void> {
  console.log('🚀 INICIANDO SUÍTE DIRECIONADA DE TESTES — CICLO 12.30-d\n');
  runEssentialTrackAndSecurityTests();
  await runLiveTvFullscreenAndPreviewTransitionTests();
  await runWhitePaletteAndControlsIntegrationTests();
  await runCycle1230bSpatialNavOptimizationTests();
  await runCycle1230cVerticalNavOptimizationTests();
  await runCycle1230dLiveTvLatencyAndFullscreenTests();
  for (const timer of rafTimers.values()) {
    clearTimeout(timer);
  }
  rafTimers.clear();
  console.log('\n🎉 TODOS OS TESTES DO CICLO 12.30-d FORAM EXECUTADOS COM SUCESSO!');
  await windowInstance.close();
}

main().catch((err) => {
  console.error('\n❌ ERRO NA EXECUÇÃO DOS TESTES:', err);
  process.exit(1);
});


