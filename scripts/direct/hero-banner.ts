import assert from 'node:assert';
import type { DomTestEnv } from '../helpers/domEnv';
import type { XtreamCredentials } from '../../src/types';

export interface DeliveryAHeroBannerDeps {
  env: DomTestEnv;
  XtreamProvider: (typeof import('../../src/context/XtreamContext'))['XtreamProvider'];
  XtreamService: (typeof import('../../src/services/xtreamService'))['XtreamService'];
  CatalogShowcaseView: (typeof import('../../src/components/CatalogShowcaseView'))['CatalogShowcaseView'];
  HeroBanner: (typeof import('../../src/components/HeroBanner'))['HeroBanner'];
  MovieDetails: (typeof import('../../src/components/MovieDetails'))['MovieDetails'];
  SeriesDetails: (typeof import('../../src/components/SeriesDetails'))['SeriesDetails'];
  clearHeroSessionCache: (typeof import('../../src/services/heroSessionCache'))['clearHeroSessionCache'];
  fetchOrReuseHeroDetails: (typeof import('../../src/services/heroSessionCache'))['fetchOrReuseHeroDetails'];
  getCachedHeroDetails: (typeof import('../../src/services/heroSessionCache'))['getCachedHeroDetails'];
  getHeroSessionCacheStatsForTest: (typeof import('../../src/services/heroSessionCache'))['getHeroSessionCacheStatsForTest'];
  computeHeroItemsFromList: (typeof import('../../src/utils/catalogIndex'))['computeHeroItemsFromList'];
  getHeroBannerItems: (typeof import('../../src/utils/catalogIndex'))['getHeroBannerItems'];
  createSimulatedPersistentImageDiskHarness: (typeof import('../../src/services/androidImageCache'))['createSimulatedPersistentImageDiskHarness'];
  createValidTestJpegBytes: (typeof import('../../src/services/androidImageCache'))['createValidTestJpegBytes'];
  setCatalogTransferPhaseActiveForImageCache: (typeof import('../../src/services/androidImageCache'))['setCatalogTransferPhaseActiveForImageCache'];
  clearAllBackHandlersForTest: (typeof import('../../src/navigation'))['clearAllBackHandlersForTest'];
  clearFocusMemory: (typeof import('../../src/navigation'))['clearFocusMemory'];
}

// ============================================================================
// 10. CONSOLIDAÇÃO PARA LANÇAMENTO — ENTREGA A: HEROBANNER
// ============================================================================
export async function runDeliveryAHeroBannerConsolidationTests(
  deps: DeliveryAHeroBannerDeps
): Promise<void> {
  const {
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
  } = deps;
  const { React, act } = env;
  const windowInstance = env.window;

  console.log(
    '\n--- 10. Entrega A (HeroBanner): Reuso de Seleção, Cache Compartilhado, Pausa Real, Sequência por Página, Isolamento e Modo Web/Android ---'
  );

  clearHeroSessionCache();

  const doc = windowInstance.document;
  const tracked = env.createTrackedRoot();
  const container = tracked.host;
  const root = tracked.root;

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

  let primaryError: unknown = null;
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
      restoreHeroIntervalTracker();
    });
    await runCleanupStep(() => {
      Object.assign(XtreamService, origMethods);
    });
    await runCleanupStep(() => {
      clearHeroSessionCache();
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
        console.error('Erros secundários durante limpeza do Bloco 10 (hero-banner):', cleanupErrors);
      } else {
        throw cleanupErrors[0];
      }
    }
  }

  console.log(
    '✅ Entrega A (HeroBanner: reuso de seleção, cache compartilhado, pausa por visibilidade, sequência por página, isolamento de conta, botões e Web/Android) validada!'
  );
}
