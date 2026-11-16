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
import { LiveTvView } from '../src/views/LiveTvView';
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

async function main(): Promise<void> {
  console.log('🚀 INICIANDO SUÍTE DIRECIONADA DE TESTES — CICLO 12.30-b\n');
  runEssentialTrackAndSecurityTests();
  await runLiveTvFullscreenAndPreviewTransitionTests();
  await runWhitePaletteAndControlsIntegrationTests();
  await runCycle1230bSpatialNavOptimizationTests();
  for (const timer of rafTimers.values()) {
    clearTimeout(timer);
  }
  rafTimers.clear();
  console.log('\n🎉 TODOS OS TESTES DO CICLO 12.30-b FORAM EXECUTADOS COM SUCESSO!');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ ERRO NA EXECUÇÃO DOS TESTES:', err);
  process.exit(1);
});

