import assert from 'node:assert';
import type { DomTestEnv } from '../helpers/domEnv';
import type { XtreamCredentials } from '../../src/types';

export interface LivePlayerHlsInitialTracks {
  audioTracks?: any[];
  subtitleTracks?: any[];
  audioTrack?: number;
  subtitleTrack?: number;
}

export interface LivePlayerHlsMockControl {
  enable: () => void;
  restore: () => void;
  setNextInitialTracks: (tracks: LivePlayerHlsInitialTracks) => void;
  getActiveControllers: () => readonly unknown[];
}

export interface LiveTvFullscreenAndPreviewDeps {
  env: DomTestEnv;
  hlsMock: LivePlayerHlsMockControl;
  VideoPlayer: (typeof import('../../src/components/VideoPlayer'))['VideoPlayer'];
  setNavMode: (typeof import('../../src/navigation'))['setNavMode'];
  clearAllBackHandlersForTest: (typeof import('../../src/navigation'))['clearAllBackHandlersForTest'];
  executeBackAction: (typeof import('../../src/navigation'))['executeBackAction'];
}

export interface Cycle1230dLiveTvLatencyDeps {
  env: DomTestEnv;
  hlsMock: LivePlayerHlsMockControl;
  LiveTvView: (typeof import('../../src/views/LiveTvView'))['LiveTvView'];
  XtreamProvider: (typeof import('../../src/context/XtreamContext'))['XtreamProvider'];
  XtreamService: (typeof import('../../src/services/xtreamService'))['XtreamService'];
  setNavMode: (typeof import('../../src/navigation'))['setNavMode'];
  clearAllBackHandlersForTest: (typeof import('../../src/navigation'))['clearAllBackHandlersForTest'];
  clearFocusMemory: (typeof import('../../src/navigation'))['clearFocusMemory'];
  setFastHorizontalRowNavEnabledForTest: (typeof import('../../src/navigation'))['setFastHorizontalRowNavEnabledForTest'];
  setFastVerticalNavEnabledForTest: (typeof import('../../src/navigation'))['setFastVerticalNavEnabledForTest'];
  focusElementSafely: (typeof import('../../src/navigation'))['focusElementSafely'];
  moveSpatialFocus: (typeof import('../../src/navigation'))['moveSpatialFocus'];
  executeBackAction: (typeof import('../../src/navigation'))['executeBackAction'];
}

// ============================================================================
// 2. CICLO 12.29-b.1 — PARTE A: TV AO VIVO (PREVIEW COMPACTO vs FULLSCREEN NATIVO
//    E VISUAL EXPANDIDO + RETORNO SEM REINICIAR REPRODUÇÃO)
// ============================================================================
export async function runLiveTvFullscreenAndPreviewTransitionTests(
  deps: LiveTvFullscreenAndPreviewDeps
): Promise<void> {
  const {
    env,
    hlsMock,
    VideoPlayer,
    setNavMode,
    clearAllBackHandlersForTest,
    executeBackAction,
  } = deps;
  const { React, act } = env;
  const windowInstance = env.window;

  console.log('--- 2. TV ao Vivo: Preview Compacto -> Fullscreen Nativo / Visual -> Retorno sem Reiniciar ---');

  hlsMock.enable();
  hlsMock.setNextInitialTracks({
    audioTracks: [{ id: 0, name: 'Português', lang: 'pt-BR', default: true }],
    subtitleTracks: [],
    audioTrack: 0,
    subtitleTrack: -1,
  });

  const doc: Document = windowInstance.document as unknown as Document;
  setNavMode('remote');
  clearAllBackHandlersForTest();

  const tracked = env.createTrackedRoot();
  const root = tracked.root;

  let primaryError: unknown = null;
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
      hlsMock.getActiveControllers().length,
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
      hlsMock.getActiveControllers().length,
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
      hlsMock.getActiveControllers().length,
      1,
      'Nenhuma reinicialização do motor HLS deve ocorrer após sair da expansão visual'
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
      delete (doc as any).fullscreenElement;
    });
    await runCleanupStep(() => {
      delete (doc as any).exitFullscreen;
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
        console.error('Erros secundários durante limpeza do Bloco 2 (live-player):', cleanupErrors);
      } else {
        throw cleanupErrors[0];
      }
    }
  }

  console.log('✅ TV ao Vivo (preview compacto, fullscreen nativo, expansão visual e retorno intacto) validada!');
}

// ============================================================================
// 6. CICLO 12.30-d — REDUÇÃO DA LATÊNCIA NA TV AO VIVO E ENTRADA IMEDIATA EM TELA CHEIA
// ============================================================================
export async function runCycle1230dLiveTvLatencyAndFullscreenTests(
  deps: Cycle1230dLiveTvLatencyDeps
): Promise<void> {
  const {
    env,
    hlsMock,
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
  } = deps;
  const { React, act } = env;
  const windowInstance = env.window;

  console.log(
    '--- 6. Ciclo 12.30-d: TV ao Vivo sem Re-render Global no Foco, Virtualização e 2º OK Imediato em Tela Cheia ---'
  );

  hlsMock.enable();
  hlsMock.setNextInitialTracks({
    audioTracks: [{ id: 0, name: 'Português', lang: 'pt-BR', default: true }],
    subtitleTracks: [],
    audioTrack: 0,
    subtitleTrack: -1,
  });

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

  const tracked = env.createTrackedRoot();
  const root = tracked.root;

  const testCreds: XtreamCredentials = {
    serverUrl: 'http://provider.tv:8080',
    username: 'u',
    password: 'p',
  };

  let primaryError: unknown = null;
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
      hlsMock.getActiveControllers().length,
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
      hlsMock.getActiveControllers().length,
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
    // 2) Controle play-pause NÃO deve existir no Live; interação inofensiva em controle existente (mute)
    // 3) Clique no próprio container do player
    assert.strictEqual(
      doc.querySelector('button[data-player-control="play-pause"]'),
      null,
      'Botão play-pause não deve existir na reprodução TV ao Vivo (Live)'
    );
    const muteBtn = doc.querySelector<HTMLButtonElement>(
      'button[data-player-control="mute"]'
    )!;
    assert(muteBtn, 'Controle de mudo em full-layer deve estar disponível');

    await act(async () => {
      ch1000Again.click();
      ch1000Again.click();
      muteBtn.click();
      muteBtn.click();
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
      hlsMock.getActiveControllers().length,
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
    const expectedBackBtn = doc.querySelector('button[data-player-control="back"]');
    const expectedSettingsBtn = doc.querySelector('button[data-player-control="settings"]');
    assert.strictEqual(
      doc.activeElement === expectedBackBtn || doc.activeElement === expectedSettingsBtn,
      true,
      `Ao entrar em tela cheia Live no modo controle remoto, o foco deve estar em back ou settings (active: ${(doc.activeElement as HTMLElement | null)?.tagName} control=${(doc.activeElement as HTMLElement | null)?.getAttribute?.('data-player-control')})`
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
      hlsMock.getActiveControllers().length,
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
      hlsMock.getActiveControllers().length,
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
      (windowInstance as any).innerWidth = origInnerWidth;
    });
    await runCleanupStep(() => {
      delete (doc as any).fullscreenElement;
    });
    await runCleanupStep(() => {
      delete (doc as any).exitFullscreen;
    });
    await runCleanupStep(() => {
      Object.assign(XtreamService, origXtreamMethods);
    });
    await runCleanupStep(() => {
      clearAllBackHandlersForTest();
    });
    await runCleanupStep(() => {
      clearFocusMemory();
    });
    await runCleanupStep(() => tracked.unmount());
    await runCleanupStep(() => {
      hlsMock.restore();
    });
    if (cleanupErrors.length > 0) {
      if (primaryError) {
        console.error('Erros secundários durante limpeza do Bloco 6 (live-player):', cleanupErrors);
      } else {
        throw cleanupErrors[0];
      }
    }
  }

  console.log(
    '✅ Ciclo 12.30-d (foco sem re-render global, virtualização, 2º OK imediato, proteção contra OK repetido e fallback visual) validado!'
  );
}
