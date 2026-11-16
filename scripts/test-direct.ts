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
} from '../src/navigation';

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

async function main(): Promise<void> {
  console.log('🚀 INICIANDO SUÍTE DIRECIONADA DE TESTES — CICLO 12.29-b.1\n');
  runEssentialTrackAndSecurityTests();
  await runLiveTvFullscreenAndPreviewTransitionTests();
  await runWhitePaletteAndControlsIntegrationTests();
  for (const timer of rafTimers.values()) {
    clearTimeout(timer);
  }
  rafTimers.clear();
  console.log('\n🎉 TODOS OS TESTES DO CICLO 12.29-b.1 FORAM EXECUTADOS COM SUCESSO!');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ ERRO NA EXECUÇÃO DOS TESTES:', err);
  process.exit(1);
});
