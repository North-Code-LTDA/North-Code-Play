import assert from 'node:assert';
import type { DomTestEnv } from '../helpers/domEnv';
import type { XtreamCredentials } from '../../src/types';

export interface TestDomCallMetrics {
  querySelectorCalls: number;
  boundingRectCalls: number;
  computedStyleCalls: number;
}

/**
 * Test-only DOM call spy used to verify optimized spatial navigation DOM cost
 * without maintaining any performance counters in production code.
 */
export async function measureDomCallsAsync<T>(
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

export function measureDomCallsSync<T>(
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

export interface Cycle1230bSpatialNavDeps {
  env: DomTestEnv;
  XtreamProvider: (typeof import('../../src/context/XtreamContext'))['XtreamProvider'];
  HorizontalRow: (typeof import('../../src/components/HorizontalRow'))['HorizontalRow'];
  setNavMode: (typeof import('../../src/navigation'))['setNavMode'];
  getNavMode: (typeof import('../../src/navigation'))['getNavMode'];
  clearAllBackHandlersForTest: (typeof import('../../src/navigation'))['clearAllBackHandlersForTest'];
  clearFocusMemory: (typeof import('../../src/navigation'))['clearFocusMemory'];
  setFastHorizontalRowNavEnabledForTest: (typeof import('../../src/navigation'))['setFastHorizontalRowNavEnabledForTest'];
  invalidateCandidateCache: (typeof import('../../src/navigation'))['invalidateCandidateCache'];
  focusElementSafely: (typeof import('../../src/navigation'))['focusElementSafely'];
  moveSpatialFocus: (typeof import('../../src/navigation'))['moveSpatialFocus'];
  pushFocusMemory: (typeof import('../../src/navigation'))['pushFocusMemory'];
  popFocusMemory: (typeof import('../../src/navigation'))['popFocusMemory'];
}

export interface Cycle1230cVerticalNavDeps {
  env: DomTestEnv;
  setNavMode: (typeof import('../../src/navigation'))['setNavMode'];
  clearAllBackHandlersForTest: (typeof import('../../src/navigation'))['clearAllBackHandlersForTest'];
  clearFocusMemory: (typeof import('../../src/navigation'))['clearFocusMemory'];
  setFastHorizontalRowNavEnabledForTest: (typeof import('../../src/navigation'))['setFastHorizontalRowNavEnabledForTest'];
  setFastVerticalNavEnabledForTest: (typeof import('../../src/navigation'))['setFastVerticalNavEnabledForTest'];
  invalidateCandidateCache: (typeof import('../../src/navigation'))['invalidateCandidateCache'];
  registerShowcaseRowController: (typeof import('../../src/navigation'))['registerShowcaseRowController'];
  unregisterShowcaseRowController: (typeof import('../../src/navigation'))['unregisterShowcaseRowController'];
  registerVirtualContainer: (typeof import('../../src/navigation'))['registerVirtualContainer'];
  unregisterVirtualContainer: (typeof import('../../src/navigation'))['unregisterVirtualContainer'];
  focusElementSafely: (typeof import('../../src/navigation'))['focusElementSafely'];
  moveSpatialFocus: (typeof import('../../src/navigation'))['moveSpatialFocus'];
}

// ============================================================================
// 4. CICLO 12.30-b — OTIMIZAÇÃO CIRÚRGICA DA NAVEGAÇÃO D-PAD EM MOVIMENTOS RÁPIDOS
// ============================================================================
export async function runCycle1230bSpatialNavOptimizationTests(
  deps: Cycle1230bSpatialNavDeps
): Promise<void> {
  const {
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
  } = deps;
  const { React, act } = env;
  const windowInstance = env.window;

  console.log('--- 4. Ciclo 12.30-b: Caminho Rápido D-Pad, Virtualização, HorizontalRow e Regressão ---');

  const doc: Document = windowInstance.document as unknown as Document;
  setNavMode('remote');
  clearAllBackHandlersForTest();
  clearFocusMemory();
  setFastHorizontalRowNavEnabledForTest(true);

  const tracked = env.createTrackedRoot();
  const root = tracked.root;

  const testCreds: XtreamCredentials = {
    serverUrl: 'http://provider.tv:8080',
    username: 'u',
    password: 'p',
  };

  let primaryError: unknown = null;
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
      setFastHorizontalRowNavEnabledForTest(true);
    });
    await runCleanupStep(() => {
      clearAllBackHandlersForTest();
    });
    await runCleanupStep(() => {
      clearFocusMemory();
    });
    await runCleanupStep(() => tracked.unmount());
    if (cleanupErrors.length > 0) {
      if (primaryError) {
        console.error('Erros secundários durante limpeza do Bloco 4 (spatial-nav):', cleanupErrors);
      } else {
        throw cleanupErrors[0];
      }
    }
  }

  console.log('✅ Ciclo 12.30-b (caminho rápido D-Pad, virtualização, HorizontalRow e regressão) validado!');
}

// ============================================================================
// 5. CICLO 12.30-c — OTIMIZAÇÃO CIRÚRGICA DA NAVEGAÇÃO VERTICAL D-PAD
// ============================================================================
export async function runCycle1230cVerticalNavOptimizationTests(
  deps: Cycle1230cVerticalNavDeps
): Promise<void> {
  const {
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
  } = deps;
  const windowInstance = env.window;

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

  let primaryError: unknown = null;
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
  } catch (err) {
    primaryError = err;
    throw err;
  } finally {
    const cleanupErrors: unknown[] = [];
    const runCleanupStep = (step: () => void) => {
      try {
        step();
      } catch (err) {
        cleanupErrors.push(err);
      }
    };
    runCleanupStep(() => {
      if (showcaseContainerEl) {
        unregisterShowcaseRowController(showcaseContainerEl);
      }
    });
    runCleanupStep(() => {
      if (virtualGridEl) {
        unregisterVirtualContainer(virtualGridEl);
      }
    });
    runCleanupStep(() => {
      setFastHorizontalRowNavEnabledForTest(true);
    });
    runCleanupStep(() => {
      setFastVerticalNavEnabledForTest(true);
    });
    runCleanupStep(() => {
      clearAllBackHandlersForTest();
    });
    runCleanupStep(() => {
      clearFocusMemory();
    });
    runCleanupStep(() => {
      shellEl.remove();
    });
    if (cleanupErrors.length > 0) {
      if (primaryError) {
        console.error('Erros secundários durante limpeza do Bloco 5 (spatial-nav):', cleanupErrors);
      } else {
        throw cleanupErrors[0];
      }
    }
  }

  console.log('✅ Ciclo 12.30-c (caminho rápido vertical D-Pad, fileiras, grades virtualizadas, alinhamento visual e fallbacks) validado!');
}
