import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import type { DomTestEnv } from '../helpers/domEnv';
import type { XtreamCredentials } from '../../src/types';

export interface Step3DpadFluidityAndDiagnosticsDeps {
  env: DomTestEnv;
  XtreamProvider: (typeof import('../../src/context/XtreamContext'))['XtreamProvider'];
  XtreamService: (typeof import('../../src/services/xtreamService'))['XtreamService'];
  NavigationProvider: (typeof import('../../src/navigation'))['NavigationProvider'];
  CatalogShowcaseView: (typeof import('../../src/components/CatalogShowcaseView'))['CatalogShowcaseView'];
  ConfigView: (typeof import('../../src/views/ConfigView'))['ConfigView'];
  setMediaImageRetryDelayMsForTest: (typeof import('../../src/components/MediaImage'))['setMediaImageRetryDelayMsForTest'];
  createSimulatedPersistentImageDiskHarness: (typeof import('../../src/services/androidImageCache'))['createSimulatedPersistentImageDiskHarness'];
  createValidTestJpegBytes: (typeof import('../../src/services/androidImageCache'))['createValidTestJpegBytes'];
  acquireCachedImage: (typeof import('../../src/services/androidImageCache'))['acquireCachedImage'];
  clearImageCacheOnLogout: (typeof import('../../src/services/androidImageCache'))['clearImageCacheOnLogout'];
  setAndroidPlatformOverrideForDpadTest: (typeof import('../../src/navigation'))['setAndroidPlatformOverrideForDpadTest'];
  isAndroidCapacitorPlatform: (typeof import('../../src/navigation'))['isAndroidCapacitorPlatform'];
  getDpadNavigationBehaviorMode: (typeof import('../../src/navigation'))['getDpadNavigationBehaviorMode'];
  isDpadOptimizedPathActive: (typeof import('../../src/navigation'))['isDpadOptimizedPathActive'];
  invalidateCandidateCache: (typeof import('../../src/navigation'))['invalidateCandidateCache'];
  focusElementSafely: (typeof import('../../src/navigation'))['focusElementSafely'];
  moveSpatialFocus: (typeof import('../../src/navigation'))['moveSpatialFocus'];
  pushFocusMemory: (typeof import('../../src/navigation'))['pushFocusMemory'];
  popFocusMemory: (typeof import('../../src/navigation'))['popFocusMemory'];
  clearAllBackHandlersForTest: (typeof import('../../src/navigation'))['clearAllBackHandlersForTest'];
  clearFocusMemory: (typeof import('../../src/navigation'))['clearFocusMemory'];
  getOrCreateVodIndex: (typeof import('../../src/utils/catalogIndex'))['getOrCreateVodIndex'];
  tvEnvironmentModule: typeof import('../../src/platform/tvEnvironment');
}

// ============================================================================
// 9. ETAPA 3 — FLUIDEZ DO D-PAD, REPETIÇÃO DE TECLAS, LIMITES DE VIRTUALIZAÇÃO E DIAGNÓSTICO
// ============================================================================
export async function runStep3DpadFluidityAndDiagnosticsTests(
  deps: Step3DpadFluidityAndDiagnosticsDeps
): Promise<void> {
  const {
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
  } = deps;
  const { React, act } = env;

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
