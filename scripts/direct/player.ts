import assert from 'node:assert';
import type { DomTestEnv } from '../helpers/domEnv';
import type { XtreamCredentials } from '../../src/types';

export interface PlayerHlsInitialTracks {
  audioTracks?: any[];
  subtitleTracks?: any[];
  audioTrack?: number;
  subtitleTrack?: number;
}

export interface PlayerHlsMockControl {
  enable: () => void;
  restore: () => void;
  setNextInitialTracks: (tracks: PlayerHlsInitialTracks) => void;
}

export interface EssentialTrackAndSecurityDeps {
  redactStreamUrlCredentials: (typeof import('../../src/components/player/trackUtils'))['redactStreamUrlCredentials'];
  formatMediaTrackLabel: (typeof import('../../src/components/player/trackUtils'))['formatMediaTrackLabel'];
  convertSrtToWebVtt: (typeof import('../../src/components/player/trackUtils'))['convertSrtToWebVtt'];
  extractXtreamSubtitles: (typeof import('../../src/components/player/trackUtils'))['extractXtreamSubtitles'];
}

export interface WhitePaletteAndControlsDeps {
  env: DomTestEnv;
  hlsMock: PlayerHlsMockControl;
  VideoPlayer: (typeof import('../../src/components/VideoPlayer'))['VideoPlayer'];
  LiveTvView: (typeof import('../../src/views/LiveTvView'))['LiveTvView'];
  XtreamProvider: (typeof import('../../src/context/XtreamContext'))['XtreamProvider'];
  XtreamService: (typeof import('../../src/services/xtreamService'))['XtreamService'];
  setNavMode: (typeof import('../../src/navigation'))['setNavMode'];
  clearAllBackHandlersForTest: (typeof import('../../src/navigation'))['clearAllBackHandlersForTest'];
  executeBackAction: (typeof import('../../src/navigation'))['executeBackAction'];
}

// ============================================================================
// 1. TESTES ESSENCIAIS DE REGRESSÃO (LEGENDAS, ÁUDIO E SEGURANÇA — CICLO 12.29-a)
// ============================================================================
export function runEssentialTrackAndSecurityTests(deps: EssentialTrackAndSecurityDeps): void {
  const {
    redactStreamUrlCredentials,
    formatMediaTrackLabel,
    convertSrtToWebVtt,
    extractXtreamSubtitles,
  } = deps;

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
// 3. CICLO 12.29-b.1 — PARTE B E C: PADRONIZAÇÃO BRANCA, FILMES, SÉRIES,
//    SUBMENUS DIRETOS E FOCO D-PAD / VOLTAR
// ============================================================================
export async function runWhitePaletteAndControlsIntegrationTests(
  deps: WhitePaletteAndControlsDeps
): Promise<void> {
  const {
    env,
    hlsMock,
    VideoPlayer,
    LiveTvView,
    XtreamProvider,
    XtreamService,
    setNavMode,
    clearAllBackHandlersForTest,
    executeBackAction,
  } = deps;
  const { React, act } = env;
  const windowInstance = env.window;

  console.log('--- 3. Identidade Visual Branca, Filmes, Séries, Submenus e Foco D-Pad/Voltar ---');

  hlsMock.enable();
  hlsMock.setNextInitialTracks({
    audioTracks: [
      { id: 0, name: 'Português', lang: 'pt-BR', default: true },
      { id: 1, name: 'Original', lang: 'en', default: false },
    ],
    subtitleTracks: [{ id: 0, name: 'Português', lang: 'pt-BR', forced: false }],
    audioTrack: 0,
    subtitleTrack: 0,
  });

  const doc: Document = windowInstance.document as unknown as Document;
  (doc as any).pictureInPictureEnabled = true;
  setNavMode('remote');
  clearAllBackHandlersForTest();

  const tracked = env.createTrackedRoot();
  const root = tracked.root;

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

  let primaryError: unknown = null;
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
    hlsMock.restore();

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
      Object.assign(XtreamService, origXtreamMethods);
    });
    await runCleanupStep(() => {
      clearAllBackHandlersForTest();
    });
    await runCleanupStep(() => tracked.unmount());
    await runCleanupStep(() => {
      hlsMock.restore();
    });
    if (cleanupErrors.length > 0) {
      if (primaryError) {
        console.error('Erros secundários durante limpeza do Bloco 3 (player):', cleanupErrors);
      } else {
        throw cleanupErrors[0];
      }
    }
  }

  console.log('✅ Identidade visual branca, controles responsivos, submenus e foco validados!');
}
