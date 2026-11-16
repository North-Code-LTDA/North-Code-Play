import assert from 'assert';
import { Window } from 'happy-dom';

// ============================================================================
// SUÍTE ENXUTA DE TESTES — CICLO 12.29-a
// Evolução funcional do player: legendas, áudio, estados da UI e regressões
// Base histórica completa preservada no Git: commit b74399033450c83b22897b66498985d395b6fcb0
// ============================================================================

const windowInstance = new Window({
  url: 'http://localhost',
  width: 1280,
  height: 720,
});
(globalThis as any).window = windowInstance;
(globalThis as any).document = windowInstance.document;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(globalThis, 'navigator', {
  value: windowInstance.navigator,
  configurable: true,
  writable: true,
});
(globalThis as any).localStorage = windowInstance.localStorage;
(globalThis as any).HTMLElement = windowInstance.HTMLElement;
(globalThis as any).HTMLInputElement = (windowInstance as any).HTMLInputElement;
(globalThis as any).Element = windowInstance.Element;
(globalThis as any).Node = windowInstance.Node;
(globalThis as any).HTMLMediaElement = windowInstance.HTMLMediaElement;
(globalThis as any).HTMLVideoElement = windowInstance.HTMLVideoElement;
(globalThis as any).Event = windowInstance.Event;
(globalThis as any).CustomEvent = windowInstance.CustomEvent;
(globalThis as any).KeyboardEvent = (windowInstance as any).KeyboardEvent;
(globalThis as any).MouseEvent = windowInstance.MouseEvent;
(globalThis as any).PointerEvent = windowInstance.PointerEvent;
(globalThis as any).StorageEvent = windowInstance.StorageEvent;
(globalThis as any).MutationObserver = (windowInstance as any).MutationObserver;
(globalThis as any).getComputedStyle = windowInstance.getComputedStyle.bind(windowInstance);

let nextRafId = 0;
const rafTimers = new Map<number, ReturnType<typeof setTimeout>>();

const testRequestAnimationFrame = (callback: FrameRequestCallback): number => {
  const id = ++nextRafId;
  const handle = setTimeout(() => {
    rafTimers.delete(id);
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    callback(now);
  }, 16);
  rafTimers.set(id, handle);
  return id;
};

const testCancelAnimationFrame = (id: number): void => {
  const handle = rafTimers.get(id);
  if (handle !== undefined) {
    clearTimeout(handle);
    rafTimers.delete(id);
  }
};

(windowInstance as any).requestAnimationFrame = testRequestAnimationFrame;
(windowInstance as any).cancelAnimationFrame = testCancelAnimationFrame;
(globalThis as any).requestAnimationFrame = testRequestAnimationFrame;
(globalThis as any).cancelAnimationFrame = testCancelAnimationFrame;

delete (windowInstance.Element.prototype as any).animate;
delete (windowInstance.HTMLElement.prototype as any).animate;

HTMLMediaElement.prototype.play = function () {
  Object.defineProperty(this, 'paused', { value: false, configurable: true, writable: true });
  this.dispatchEvent(new windowInstance.Event('play'));
  this.dispatchEvent(new windowInstance.Event('playing'));
  return Promise.resolve();
};
HTMLMediaElement.prototype.pause = function () {
  Object.defineProperty(this, 'paused', { value: true, configurable: true, writable: true });
  this.dispatchEvent(new windowInstance.Event('pause'));
};
HTMLMediaElement.prototype.load = function () {
  this.dispatchEvent(new windowInstance.Event('loadstart'));
};

const scrollTopMap = new WeakMap<Element, number>();
Object.defineProperty(windowInstance.HTMLElement.prototype, 'scrollTop', {
  get() {
    return scrollTopMap.get(this) || 0;
  },
  set(val: number) {
    scrollTopMap.set(this, val);
  },
  configurable: true,
});

const scrollLeftMap = new WeakMap<Element, number>();
Object.defineProperty(windowInstance.HTMLElement.prototype, 'scrollLeft', {
  get() {
    return scrollLeftMap.get(this) || 0;
  },
  set(val: number) {
    scrollLeftMap.set(this, val);
  },
  configurable: true,
});

windowInstance.HTMLElement.prototype.scrollTo = function (
  optionsOrX?: ScrollToOptions | number,
  y?: number
) {
  if (typeof optionsOrX === 'number') {
    this.scrollLeft = optionsOrX;
    if (typeof y === 'number') this.scrollTop = y;
  } else if (optionsOrX && typeof optionsOrX === 'object') {
    if (typeof optionsOrX.left === 'number') this.scrollLeft = optionsOrX.left;
    if (typeof optionsOrX.top === 'number') this.scrollTop = optionsOrX.top;
  }
};

// Guarda de isolamento de rede (sem chamadas HTTP reais durante testes)
let customFetchResponder: ((url: string, init?: RequestInit) => Promise<Response>) | null = null;

const offlineFetchGuard = async (input: any, init?: RequestInit): Promise<Response> => {
  const rawUrl =
    typeof input === 'string'
      ? input
      : input && typeof input.url === 'string'
        ? input.url
        : String(input ?? '');
  if (customFetchResponder) {
    return customFetchResponder(rawUrl, init);
  }
  throw new Error(`[TestNetworkGuard] Chamada externa bloqueada: ${rawUrl}`);
};

(windowInstance as any).fetch = offlineFetchGuard;
(globalThis as any).fetch = offlineFetchGuard;

import React, { act } from 'react';
import type { XtreamCredentials } from '../src/types';

const { createRoot } = await import('react-dom/client');
const HlsModule = await import('hls.js');
const Hls = HlsModule.default;

const {
  redactStreamUrlCredentials,
  normalizeLanguageLabel,
  formatMediaTrackLabel,
  detectSubtitleFormat,
  extractXtreamSubtitles,
  convertSrtToWebVtt,
  normalizeSubtitleContentToWebVtt,
} = await import('../src/components/player/trackUtils');
const { VideoPlayer } = await import('../src/components/VideoPlayer');
const { MovieDetails } = await import('../src/components/MovieDetails');
const { SeriesDetails } = await import('../src/components/SeriesDetails');
const { LiveTvView } = await import('../src/views/LiveTvView');
const { XtreamProvider } = await import('../src/context/XtreamContext');
const { XtreamService } = await import('../src/services/xtreamService');
const { executeBackAction, clearAllBackHandlersForTest } = await import('../src/navigation/backPolicy');

// Instrumentação determinística para Hls.js em Happy DOM
interface MockHlsController {
  instance: any;
  url: string;
  video: HTMLVideoElement | null;
  destroyed: boolean;
  audioTracks: any[];
  subtitleTracks: any[];
  audioTrack: number;
  subtitleTrack: number;
  subtitleDisplay: boolean;
  levels: any[];
  currentLevel: number;
  emit: (event: string, payload?: any) => void;
}

let hlsMockEnabled = false;
let activeHlsControllers: MockHlsController[] = [];
let nextHlsInitialTracks: {
  audioTracks?: any[];
  subtitleTracks?: any[];
  audioTrack?: number;
  subtitleTrack?: number;
  levels?: any[];
} = {};

const origHlsIsSupported = Hls.isSupported.bind(Hls);
const origHlsLoadSource = Hls.prototype.loadSource;
const origHlsAttachMedia = Hls.prototype.attachMedia;
const origHlsOn = Hls.prototype.on;
const origHlsDestroy = Hls.prototype.destroy;

function enableDeterministicHlsMock(): void {
  hlsMockEnabled = true;
  activeHlsControllers = [];
  (Hls as any).isSupported = () => hlsMockEnabled;

  const listenersMap = new WeakMap<any, Map<string, Array<(...args: any[]) => void>>>();
  const controllerMap = new WeakMap<any, MockHlsController>();

  const ensureController = (inst: any): MockHlsController => {
    let ctrl = controllerMap.get(inst);
    if (!ctrl) {
      ctrl = {
        instance: inst,
        url: '',
        video: null,
        destroyed: false,
        audioTracks: [...(nextHlsInitialTracks.audioTracks ?? [])],
        subtitleTracks: [...(nextHlsInitialTracks.subtitleTracks ?? [])],
        audioTrack:
          nextHlsInitialTracks.audioTrack ??
          ((nextHlsInitialTracks.audioTracks?.length ?? 0) > 0 ? 0 : -1),
        subtitleTrack: nextHlsInitialTracks.subtitleTrack ?? -1,
        subtitleDisplay: (nextHlsInitialTracks.subtitleTrack ?? -1) >= 0,
        levels: [...(nextHlsInitialTracks.levels ?? [{ height: 1080, bitrate: 4500000 }])],
        currentLevel: -1,
        emit(event: string, payload: any = {}) {
          const map = listenersMap.get(inst);
          const handlers = map?.get(event) ?? [];
          for (const fn of handlers) {
            fn(event, payload);
          }
        },
      };
      controllerMap.set(inst, ctrl);
      activeHlsControllers.push(ctrl);

      Object.defineProperties(inst, {
        audioTracks: {
          get: () => ctrl!.audioTracks,
          set: (v) => {
            ctrl!.audioTracks = v;
          },
          configurable: true,
        },
        subtitleTracks: {
          get: () => ctrl!.subtitleTracks,
          set: (v) => {
            ctrl!.subtitleTracks = v;
          },
          configurable: true,
        },
        audioTrack: {
          get: () => ctrl!.audioTrack,
          set: (id: number) => {
            ctrl!.audioTrack = id;
            ctrl!.emit(Hls.Events.AUDIO_TRACK_SWITCHED, { id });
          },
          configurable: true,
        },
        subtitleTrack: {
          get: () => ctrl!.subtitleTrack,
          set: (id: number) => {
            ctrl!.subtitleTrack = id;
            ctrl!.emit(Hls.Events.SUBTITLE_TRACK_SWITCH, { id });
          },
          configurable: true,
        },
        subtitleDisplay: {
          get: () => ctrl!.subtitleDisplay,
          set: (val: boolean) => {
            ctrl!.subtitleDisplay = Boolean(val);
          },
          configurable: true,
        },
        levels: {
          get: () => ctrl!.levels,
          configurable: true,
        },
        currentLevel: {
          get: () => ctrl!.currentLevel,
          set: (lvl: number) => {
            ctrl!.currentLevel = lvl;
          },
          configurable: true,
        },
      });
    }
    return ctrl;
  };

  const sourceLoadedSet = new WeakSet<any>();

  Hls.prototype.on = function (event: any, handler: any, context?: any) {
    // Ignorar listeners internos dos controllers do hls.js (registrados no construtor com 3º argumento context)
    if (context !== undefined || !sourceLoadedSet.has(this)) {
      return this;
    }
    ensureController(this);
    let map = listenersMap.get(this);
    if (!map) {
      map = new Map();
      listenersMap.set(this, map);
    }
    const list = map.get(event) ?? [];
    list.push(handler);
    map.set(event, list);
    return this;
  };

  Hls.prototype.loadSource = function (url: string) {
    sourceLoadedSet.add(this);
    const ctrl = ensureController(this);
    ctrl.url = url;
  };

  Hls.prototype.attachMedia = function (media: HTMLMediaElement) {
    sourceLoadedSet.add(this);
    const ctrl = ensureController(this);
    ctrl.video = media as HTMLVideoElement;
    queueMicrotask(() => {
      if (!ctrl.destroyed) {
        ctrl.emit(Hls.Events.MANIFEST_PARSED, {
          levels: ctrl.levels,
          audioTracks: ctrl.audioTracks,
          subtitleTracks: ctrl.subtitleTracks,
        });
      }
    });
  };

  Hls.prototype.destroy = function () {
    const ctrl = ensureController(this);
    ctrl.destroyed = true;
    listenersMap.delete(this);
  };
}

function restoreHlsMock(): void {
  hlsMockEnabled = false;
  (Hls as any).isSupported = origHlsIsSupported;
  Hls.prototype.loadSource = origHlsLoadSource;
  Hls.prototype.attachMedia = origHlsAttachMedia;
  Hls.prototype.on = origHlsOn;
  Hls.prototype.destroy = origHlsDestroy;
  activeHlsControllers = [];
  nextHlsInitialTracks = {};
}

// ============================================================================
// 1. TESTES UNITÁRIOS DE UTILITÁRIOS DE FAIXAS, LEGENDAS E REDAÇÃO DE CREDENCIAIS
// ============================================================================
function runTrackUtilsUnitTests(): void {
  console.log('--- 1. Utilitários de Legendas, Áudio, Conversão SRT->WebVTT e Segurança ---');

  // 1.1 Redação de credenciais Xtream em URLs
  const rawXtreamUrl = 'http://iptv.exemplo.com:8080/movie/clienteSecreto/senhaUltra123/94812.mp4';
  const redacted = redactStreamUrlCredentials(rawXtreamUrl);
  assert(!redacted.includes('clienteSecreto'), 'Username não pode vazar na URL redigida');
  assert(!redacted.includes('senhaUltra123'), 'Password não pode vazar na URL redigida');
  assert(
    redacted.includes('/movie/***/***/94812.mp4'),
    `Formato esperado com ***, obtido: ${redacted}`
  );

  const queryCredsUrl =
    'http://iptv.exemplo.com:8080/player_api.php?username=userX&password=passY&action=get_vod_info';
  const redactedQuery = redactStreamUrlCredentials(queryCredsUrl);
  assert(!redactedQuery.includes('userX') && !redactedQuery.includes('passY'), 'Query params devem ser redigidos');

  // 1.2 Normalização de idiomas e rótulos de faixas
  assert.strictEqual(normalizeLanguageLabel('pt-BR'), 'Português (Brasil)');
  assert.strictEqual(normalizeLanguageLabel('por'), 'Português');
  assert.strictEqual(normalizeLanguageLabel('eng'), 'Inglês');
  assert.strictEqual(normalizeLanguageLabel('spa'), 'Espanhol');

  const audioLabel = formatMediaTrackLabel({
    fallbackPrefix: 'Áudio',
    index: 0,
    lang: 'pt-BR',
    channels: '6',
  });
  assert.strictEqual(audioLabel, 'Português (Brasil) · 5.1');

  const forcedSubLabel = formatMediaTrackLabel({
    fallbackPrefix: 'Legenda',
    index: 1,
    lang: 'pt',
    forced: true,
  });
  assert.strictEqual(forcedSubLabel, 'Português [Forçada]');

  // 1.3 Detecção de formatos suportados vs formatos binários/bitmap não suportados
  assert.strictEqual(detectSubtitleFormat('http://srv/sub.vtt'), 'vtt');
  assert.strictEqual(detectSubtitleFormat('http://srv/sub.srt?token=1'), 'srt');
  assert.strictEqual(detectSubtitleFormat('http://srv/sub.pgs'), 'unsupported');
  assert.strictEqual(detectSubtitleFormat('http://srv/sub.idx'), 'unsupported');
  assert.strictEqual(detectSubtitleFormat('http://srv/sub.sub'), 'unsupported');
  assert.strictEqual(detectSubtitleFormat('http://srv/sub.ass'), 'unsupported');

  // 1.4 Conversão de SRT para WebVTT e rejeição de HTML inválido
  const sampleSrt = [
    '1',
    '00:00:01,250 --> 00:00:04,500',
    '{\\an8}Olá, bem-vindo ao North Code Play!',
    '',
    '2',
    '00:05,100 --> 00:08,900',
    'Segunda linha de legenda.',
  ].join('\r\n');

  const convertedVtt = convertSrtToWebVtt(sampleSrt);
  assert(convertedVtt.startsWith('WEBVTT\n\n'), 'Deve iniciar com cabeçalho WEBVTT');
  assert(
    convertedVtt.includes('00:00:01.250 --> 00:00:04.500'),
    'Deve converter vírgula de milissegundos do SRT para ponto no padrão WebVTT'
  );
  assert(
    convertedVtt.includes('00:00:05.100 --> 00:00:08.900'),
    'Deve normalizar timestamps curtos MM:SS,mmm para HH:MM:SS.mmm'
  );
  assert(!convertedVtt.includes('{\\an8}'), 'Deve limpar tags de override ASS/SSA embutidas no SRT');

  assert.strictEqual(
    normalizeSubtitleContentToWebVtt('<!DOCTYPE html><html><body>404 Not Found</body></html>'),
    null,
    'Página HTML 404 não deve ser aceita como arquivo de legenda válido'
  );

  // 1.5 Extração de legendas externas de payloads Xtream (Filmes e Séries) sem fabricar faixas falsas
  const vodPayload = {
    info: {
      subtitles: [
        { url: 'http://cdn.server.tv/subs/movie_pt.srt', lang: 'pt-BR', label: 'Português BR' },
        { url: '/subs/movie_en.vtt', language: 'en' },
        { url: 'http://cdn.server.tv/subs/bitmap.pgs', lang: 'fr' }, // Não suportado, deve ser filtrado
        { codec_name: 'subrip', language: 'es' }, // Sem URL externa real, não deve fabricar faixa falsa
      ],
    },
  };
  const extractedSubs = extractXtreamSubtitles(vodPayload, 'http://cdn.server.tv');
  assert.strictEqual(
    extractedSubs.length,
    2,
    'Deve extrair apenas legendas externas com URL real e formato compatível (.srt/.vtt)'
  );
  assert.strictEqual(extractedSubs[0].url, 'http://cdn.server.tv/subs/movie_pt.srt');
  assert.strictEqual(extractedSubs[1].url, 'http://cdn.server.tv/subs/movie_en.vtt');

  console.log('✅ Utilitários de faixas e legendas validados com sucesso!');
}

// ============================================================================
// 2. TESTES DE HLS COM LEGENDAS E MÚLTIPLAS FAIXAS DE ÁUDIO + EVENTOS DINÂMICOS
// ============================================================================
async function runHlsTracksAndSettingsMenuTests(): Promise<void> {
  console.log('--- 2. HLS com Legendas, Múltiplos Áudios, Eventos Dinâmicos e Desativação ---');

  enableDeterministicHlsMock();
  nextHlsInitialTracks = {
    audioTracks: [
      { id: 0, name: 'Português', lang: 'pt-BR', channels: '6', default: true },
      { id: 1, name: 'Original', lang: 'en', channels: '2', default: false },
    ],
    subtitleTracks: [
      { id: 0, name: 'Português', lang: 'pt-BR', forced: false },
      { id: 1, name: 'English CC', lang: 'en', forced: false },
    ],
    audioTrack: 0,
    subtitleTrack: -1,
  };

  const doc: Document = windowInstance.document as unknown as Document;
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        React.createElement(VideoPlayer, {
          streamUrl: 'http://server.tv:8080/movie/user/pass/501.m3u8',
          title: 'Filme HLS Multi-Track',
          contentType: 'movie',
          onBack: () => {},
        })
      );
      await new Promise((r) => setTimeout(r, 20));
    });

    assert.strictEqual(activeHlsControllers.length, 1, 'Deve instanciar 1 controlador HLS');
    const hlsCtrl = activeHlsControllers[0];

    // Abrir menu de configurações do player
    const settingsBtn = doc.querySelector<HTMLButtonElement>(
      'button[data-player-control="settings"]'
    );
    assert(settingsBtn, 'Botão de configurações deve estar presente no player');

    await act(async () => {
      settingsBtn.click();
    });

    const settingsMenu = doc.querySelector('[data-player-settings-menu="true"]');
    assert(settingsMenu, 'Menu de configurações deve abrir');

    const audioMenuItem = doc.querySelector<HTMLButtonElement>('[data-settings-item="audio"]');
    const subMenuItem = doc.querySelector<HTMLButtonElement>('[data-settings-item="subtitles"]');
    assert(audioMenuItem, 'Item Áudio deve estar presente no menu principal');
    assert(subMenuItem, 'Item Legendas deve estar presente no menu principal');
    assert(
      subMenuItem.textContent?.includes('Desativado'),
      `Legenda inicial deve indicar Desativado. Obtido: ${subMenuItem.textContent}`
    );

    // Abrir submenu de Legendas e selecionar faixa 0 (Português)
    await act(async () => {
      subMenuItem.click();
    });

    const subOption0 = doc.querySelector<HTMLButtonElement>('[data-subtitle-track-id="0"]');
    const subOptionOff = doc.querySelector<HTMLButtonElement>('[data-subtitle-track-id="-1"]');
    assert(subOption0, 'Opção de legenda 0 deve existir');
    assert(subOptionOff, 'Opção Desativado (-1) deve existir');

    await act(async () => {
      subOption0.click();
    });

    assert.strictEqual(hlsCtrl.subtitleTrack, 0, 'hls.subtitleTrack deve mudar para 0');
    assert.strictEqual(hlsCtrl.subtitleDisplay, true, 'hls.subtitleDisplay deve ser ativado (true)');

    // Reabrir menu de legendas e desativar (-1)
    await act(async () => {
      doc.querySelector<HTMLButtonElement>('[data-settings-item="subtitles"]')!.click();
    });
    await act(async () => {
      doc.querySelector<HTMLButtonElement>('[data-subtitle-track-id="-1"]')!.click();
    });

    assert.strictEqual(hlsCtrl.subtitleTrack, -1, 'hls.subtitleTrack deve voltar para -1 ao desativar');
    assert.strictEqual(hlsCtrl.subtitleDisplay, false, 'hls.subtitleDisplay deve ser false ao desativar');

    // Abrir submenu de Áudio e alternar para faixa 1 (Inglês)
    await act(async () => {
      doc.querySelector<HTMLButtonElement>('[data-settings-item="audio"]')!.click();
    });
    const audioOption1 = doc.querySelector<HTMLButtonElement>('[data-audio-track-id="1"]');
    assert(audioOption1, 'Opção de áudio 1 (Inglês) deve estar disponível');

    await act(async () => {
      audioOption1.click();
    });
    assert.strictEqual(hlsCtrl.audioTrack, 1, 'hls.audioTrack deve mudar para 1');

    // Simular evento dinâmico SUBTITLE_TRACKS_UPDATED após início da reprodução
    await act(async () => {
      hlsCtrl.subtitleTracks = [
        ...hlsCtrl.subtitleTracks,
        { id: 2, name: 'Español', lang: 'es', forced: false },
      ];
      hlsCtrl.emit(Hls.Events.SUBTITLE_TRACKS_UPDATED, {
        subtitleTracks: hlsCtrl.subtitleTracks,
      });
    });

    await act(async () => {
      doc.querySelector<HTMLButtonElement>('[data-settings-item="subtitles"]')!.click();
    });
    const subOption2 = doc.querySelector<HTMLButtonElement>('[data-subtitle-track-id="2"]');
    assert(subOption2, 'Nova legenda adicionada via SUBTITLE_TRACKS_UPDATED deve aparecer no menu');
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    restoreHlsMock();
  }

  console.log('✅ HLS com legendas, múltiplos áudios e atualização dinâmica validados!');
}

// ============================================================================
// 3. TESTES DE HLS SEM LEGENDAS E COM ÁUDIO ÚNICO (ESTADOS COERENTES NA UI)
// ============================================================================
async function runHlsWithoutSubtitlesTests(): Promise<void> {
  console.log('--- 3. HLS sem Legendas e com Faixa Única de Áudio (Estados Coerentes) ---');

  enableDeterministicHlsMock();
  nextHlsInitialTracks = {
    audioTracks: [{ id: 0, name: 'Português', lang: 'pt', default: true }],
    subtitleTracks: [],
    audioTrack: 0,
    subtitleTrack: -1,
  };

  const doc: Document = windowInstance.document as unknown as Document;
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        React.createElement(VideoPlayer, {
          streamUrl: 'http://server.tv:8080/live/user/pass/901.m3u8',
          title: 'Canal Ao Vivo Sem Legendas',
          contentType: 'live',
          onBack: () => {},
        })
      );
      await new Promise((r) => setTimeout(r, 20));
    });

    const settingsBtn = doc.querySelector<HTMLButtonElement>(
      'button[data-player-control="settings"]'
    )!;
    await act(async () => {
      settingsBtn.click();
    });

    // Áudio e Legendas devem continuar acessíveis no menu principal
    const audioItem = doc.querySelector<HTMLButtonElement>('[data-settings-item="audio"]');
    const subItem = doc.querySelector<HTMLButtonElement>('[data-settings-item="subtitles"]');
    assert(audioItem, 'Item Áudio deve estar sempre visível mesmo com 1 faixa');
    assert(subItem, 'Item Legendas deve estar sempre visível mesmo com 0 faixas');
    assert(
      subItem.textContent?.includes('Indisponível'),
      `Resumo de Legendas sem faixas deve exibir Indisponível. Obtido: ${subItem.textContent}`
    );

    // Abrir submenu Legendas: deve mostrar Desativado + aviso de indisponibilidade, sem criar faixas falsas
    await act(async () => {
      subItem.click();
    });
    const emptySubNote = doc.querySelector('[data-subtitles-empty-state="true"]');
    assert(emptySubNote, 'Submenu de legendas vazias deve exibir aviso claro de indisponibilidade');
    const allSubButtons = doc.querySelectorAll('[data-subtitle-track-id]');
    assert.strictEqual(
      allSubButtons.length,
      1,
      'Sem legendas disponíveis, deve haver apenas a opção Desativado (-1), sem faixas falsas'
    );

    // Voltar ao menu principal pelo botão Voltar do cabeçalho do submenu e abrir Áudio
    const backBtn = doc.querySelector<HTMLButtonElement>('[data-settings-back="true"]')!;
    await act(async () => {
      backBtn.click();
    });
    await act(async () => {
      doc.querySelector<HTMLButtonElement>('[data-settings-item="audio"]')!.click();
    });

    const singleAudioNote = doc.querySelector('[data-audio-single-note="true"]');
    assert(singleAudioNote, 'Submenu de áudio com 1 faixa deve informar que há faixa única');
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    restoreHlsMock();
  }

  console.log('✅ Estados coerentes para HLS sem legendas e áudio único validados!');
}

// ============================================================================
// 4. CONTEÚDO PROGRESSIVO (.MP4) COM LEGENDAS EXTERNAS (.SRT/.VTT),
//    FAIXAS NATIVAS E LIMPEZA COMPLETA AO TROCAR DE CONTEÚDO/EPISÓDIO
// ============================================================================
async function runProgressiveExternalSubtitlesAndContentSwitchTests(): Promise<void> {
  console.log('--- 4. Progressivo (.mp4) com Legendas Externas (.srt/.vtt) e Troca de Episódio ---');

  customFetchResponder = async (url: string) => {
    if (url.endsWith('.srt')) {
      return new Response(
        '1\n00:00:01,000 --> 00:00:03,000\nLegenda SRT convertida com sucesso!\n',
        { status: 200 }
      );
    }
    if (url.endsWith('.vtt')) {
      return new Response(
        'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nLegenda VTT nativa!\n',
        { status: 200 }
      );
    }
    return new Response('Not Found', { status: 404 });
  };

  const doc: Document = windowInstance.document as unknown as Document;
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container);

  try {
    // Renderizar Episódio 1 com 2 legendas externas (.srt e .vtt)
    await act(async () => {
      root.render(
        React.createElement(VideoPlayer, {
          streamUrl: 'http://server.tv:8080/series/user/pass/1001.mp4',
          title: 'Série Teste - S01E01',
          contentType: 'series',
          externalSubtitles: [
            { url: 'http://server.tv:8080/subs/ep1_pt.srt', lang: 'pt-BR', label: 'Português (SRT)' },
            { url: 'http://server.tv:8080/subs/ep1_en.vtt', lang: 'en', label: 'Inglês (VTT)' },
          ],
          onBack: () => {},
        })
      );
      await new Promise((r) => setTimeout(r, 40));
    });

    const videoEl = doc.querySelector('video') as HTMLVideoElement;
    assert(videoEl, 'Elemento <video> deve existir');
    assert.strictEqual(
      videoEl.getAttribute('crossorigin'),
      null,
      'Elemento <video> NÃO deve definir crossorigin="anonymous" para não bloquear streams IPTV sem CORS'
    );

    const attachedTrackNodes = videoEl.querySelectorAll('track[data-nc-external-track="true"]');
    assert.strictEqual(
      attachedTrackNodes.length,
      2,
      'Deve anexar 2 elementos <track> convertidos para WebVTT no <video>'
    );

    // Abrir menu de legendas e ativar a legenda 0 (Português SRT convertido)
    await act(async () => {
      doc.querySelector<HTMLButtonElement>('button[data-player-control="settings"]')!.click();
    });
    await act(async () => {
      doc.querySelector<HTMLButtonElement>('[data-settings-item="subtitles"]')!.click();
    });

    const subBtn0 = doc.querySelector<HTMLButtonElement>('[data-subtitle-track-id="0"]');
    const subBtn1 = doc.querySelector<HTMLButtonElement>('[data-subtitle-track-id="1"]');
    assert(subBtn0 && subBtn1, 'Ambas as legendas externas devem estar listadas no menu');

    await act(async () => {
      subBtn0.click();
    });

    const track0El = attachedTrackNodes[0] as HTMLTrackElement;
    assert(
      track0El.getAttribute('default') !== null || (track0El as any).track?.mode === 'showing',
      'A faixa de legenda externa selecionada deve ser ativada'
    );

    // Agora trocar para o Episódio 2 SEM legendas externas na mesma instância do VideoPlayer
    await act(async () => {
      root.render(
        React.createElement(VideoPlayer, {
          streamUrl: 'http://server.tv:8080/series/user/pass/1002.mp4',
          title: 'Série Teste - S01E02',
          contentType: 'series',
          externalSubtitles: [],
          onBack: () => {},
        })
      );
      await new Promise((r) => setTimeout(r, 40));
    });

    const remainingTrackNodes = videoEl.querySelectorAll('track[data-nc-external-track="true"]');
    assert.strictEqual(
      remainingTrackNodes.length,
      0,
      'Ao trocar de episódio/conteúdo, todos os elementos <track> do episódio anterior devem ser removidos'
    );

    // Verificar no menu que as legendas do Episódio 1 não ficaram retidas
    const subMenuSummary = doc.querySelector<HTMLButtonElement>('[data-settings-item="subtitles"]');
    assert(
      subMenuSummary?.textContent?.includes('Indisponível'),
      `Após trocar para episódio sem legendas, o menu deve indicar Indisponível. Obtido: ${subMenuSummary?.textContent}`
    );
  } finally {
    customFetchResponder = null;
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }

  console.log('✅ Legendas externas (.srt/.vtt) e limpeza na troca de episódio validadas!');
}

// ============================================================================
// 5. INTEGRAÇÃO DE MOVIEDETAILS E SERIESDETAILS + NAVEGAÇÃO D-PAD / VOLTAR
//    E REGRESSÃO ESSENCIAL DA TV AO VIVO E DIAGNÓSTICO SEGURO
// ============================================================================
async function runDetailsIntegrationDpadAndLiveTvRegressionTests(): Promise<void> {
  console.log('--- 5. Integração MovieDetails/SeriesDetails, D-Pad/Voltar e Regressão TV ao Vivo ---');

  const testCreds: XtreamCredentials = {
    serverUrl: 'http://provider.tv:8080',
    username: 'userProtected',
    password: 'secretPassword99',
  };

  (XtreamService as any).authenticate = async () => ({
    user_info: { username: 'userProtected', auth: 1, status: 'Active' },
    server_info: { allowed_output_formats: ['m3u8', 'ts'] },
  });
  (XtreamService as any).getLiveCategories = async () => [
    { category_id: '10', category_name: 'Esportes' },
  ];
  (XtreamService as any).getVodCategories = async () => [];
  (XtreamService as any).getSeriesCategories = async () => [];
  (XtreamService as any).getLiveStreams = async () => [
    { stream_id: 501, name: 'SporTV HD', category_id: '10', stream_icon: '' },
  ];
  (XtreamService as any).getVodStreams = async () => [];
  (XtreamService as any).getSeries = async () => [];
  (XtreamService as any).getShortEpg = async () => ({ epg_listings: [] });

  (XtreamService as any).getVodInfo = async () => ({
    info: {
      name: 'Matrix Resurrections',
      plot: 'Sinopse de teste',
      subtitles: [{ url: 'http://provider.tv:8080/subs/matrix_pt.srt', lang: 'pt-BR' }],
    },
    movie_data: {
      stream_id: 777,
      container_extension: 'mp4',
    },
  });

  (XtreamService as any).getSeriesInfo = async () => ({
    info: { name: 'Dark', plot: 'Série alemã' },
    episodes: {
      '1': [
        {
          id: '8881',
          episode_num: 1,
          title: 'Segredos',
          container_extension: 'mp4',
          info: {
            subtitles: [{ url: 'http://provider.tv:8080/subs/dark_s01e01.vtt', lang: 'pt-BR' }],
          },
        },
      ],
    },
  });

  customFetchResponder = async (url: string) => {
    if (url.endsWith('.vtt')) {
      return new Response('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nDark S01E01 VTT\n', {
        status: 200,
      });
    }
    return new Response('Not Found', { status: 404 });
  };

  const doc: Document = windowInstance.document as unknown as Document;
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container);

  try {
    // 5.1 MovieDetails deve repassar externalSubtitles extraídas para onPlay
    let capturedMoviePlayArgs: any[] = [];
    await act(async () => {
      root.render(
        React.createElement(
          XtreamProvider,
          { credentials: testCreds },
          React.createElement(MovieDetails, {
            streamId: 777,
            streamName: 'Matrix Resurrections',
            containerExtension: 'mp4',
            onClose: () => {},
            onPlay: (...args: any[]) => {
              capturedMoviePlayArgs = args;
            },
          })
        )
      );
      await new Promise((r) => setTimeout(r, 50));
    });

    const playMovieBtn = doc.querySelector<HTMLButtonElement>('[data-movie-primary-cta="true"]');
    assert(playMovieBtn, 'Botão Assistir em MovieDetails deve existir');
    await act(async () => {
      playMovieBtn.click();
    });

    assert.strictEqual(
      capturedMoviePlayArgs[9]?.length,
      1,
      'MovieDetails deve repassar 1 legenda externa extraída para onPlay'
    );
    assert.strictEqual(
      capturedMoviePlayArgs[9][0].url,
      'http://provider.tv:8080/subs/matrix_pt.srt'
    );

    // 5.2 SeriesDetails deve extrair legendas do episódio e anexá-las ao VideoPlayer
    await act(async () => {
      root.render(
        React.createElement(
          XtreamProvider,
          { credentials: testCreds },
          React.createElement(SeriesDetails, {
            seriesId: 888,
            seriesName: 'Dark',
            onClose: () => {},
          })
        )
      );
      await new Promise((r) => setTimeout(r, 60));
    });

    const playSeriesBtn = doc.querySelector<HTMLButtonElement>('[data-series-primary-cta="true"]');
    assert(playSeriesBtn, 'Botão Assistir em SeriesDetails deve existir');
    await act(async () => {
      playSeriesBtn.click();
      await new Promise((r) => setTimeout(r, 50));
    });

    const seriesTrackEl = doc.querySelector('track[data-nc-external-track="true"]');
    assert(
      seriesTrackEl &&
        seriesTrackEl.getAttribute('data-nc-external-url') ===
          'http://provider.tv:8080/subs/dark_s01e01.vtt',
      'SeriesDetails deve iniciar o VideoPlayer com a legenda externa do episódio anexada'
    );

    // 5.3 Navegação Voltar (Back/Escape) em camadas no PlayerSettingsMenu + Redação no Diagnóstico
    clearAllBackHandlersForTest();
    let backCalledCount = 0;
    await act(async () => {
      root.render(
        React.createElement(VideoPlayer, {
          streamUrl: 'http://provider.tv:8080/movie/userProtected/secretPassword99/777.mp4',
          title: 'Matrix Resurrections',
          contentType: 'movie',
          onBack: () => {
            backCalledCount++;
          },
        })
      );
      await new Promise((r) => setTimeout(r, 20));
    });

    await act(async () => {
      doc.querySelector<HTMLButtonElement>('button[data-player-control="settings"]')!.click();
    });
    await act(async () => {
      doc.querySelector<HTMLButtonElement>('[data-settings-item="subtitles"]')!.click();
    });
    assert(
      doc.querySelector('[data-subtitle-track-id="-1"]'),
      'Submenu de legendas deve estar aberto'
    );

    // 1º Back: fecha o submenu (volta ao menu principal de configurações), não fecha o player
    await act(async () => {
      executeBackAction();
    });
    assert(
      doc.querySelector('[data-settings-item="subtitles"]'),
      '1º Back deve retornar do submenu de Legendas para o menu principal de Configurações'
    );
    assert.strictEqual(backCalledCount, 0, '1º Back não deve sair do player');

    // Abrir Diagnóstico Técnico e verificar que credenciais na URL estão redigidas
    await act(async () => {
      doc.querySelector<HTMLButtonElement>('button[data-player-control="diagnostics"]')!.click();
    });
    const diagText = doc.body.textContent || '';
    assert(
      !diagText.includes('userProtected') && !diagText.includes('secretPassword99'),
      'Modal de Diagnóstico Técnico NUNCA deve exibir credenciais Xtream em texto puro'
    );

    // 5.4 Regressão essencial da TV ao Vivo (layout 50/50 e seleção de canal sem erros)
    await act(async () => {
      root.render(
        React.createElement(
          XtreamProvider,
          { credentials: testCreds },
          React.createElement(LiveTvView, {
            categories: [{ category_id: '10', category_name: 'Esportes' }],
            streams: [
              {
                stream_id: 501,
                name: 'SporTV HD',
                category_id: '10',
                stream_icon: '',
              } as any,
            ],
            selectedCategory: '10',
            onSelectCategory: () => {},
            searchQuery: '',
            onPlayStream: () => {},
          })
        )
      );
      await new Promise((r) => setTimeout(r, 40));
    });

    const channelCard = doc.querySelector('[data-live-channel-id="501"]');
    assert(channelCard, 'TV ao Vivo deve renderizar o cartão de canal normalmente sem regressões');
  } finally {
    customFetchResponder = null;
    clearAllBackHandlersForTest();
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }

  console.log('✅ Integração de detalhes, navegação Back em camadas, diagnóstico seguro e TV ao Vivo validados!');
}

async function main(): Promise<void> {
  console.log('🚀 INICIANDO SUÍTE ENXUTA DE TESTES — CICLO 12.29-a\n');
  runTrackUtilsUnitTests();
  await runHlsTracksAndSettingsMenuTests();
  await runHlsWithoutSubtitlesTests();
  await runProgressiveExternalSubtitlesAndContentSwitchTests();
  await runDetailsIntegrationDpadAndLiveTvRegressionTests();
  for (const timer of rafTimers.values()) {
    clearTimeout(timer);
  }
  rafTimers.clear();
  console.log('\n🎉 TODOS OS TESTES DO CICLO 12.29-a FORAM EXECUTADOS COM SUCESSO!');
}

main().catch((err) => {
  console.error('\n❌ ERRO NA EXECUÇÃO DOS TESTES:', err);
  process.exit(1);
});
