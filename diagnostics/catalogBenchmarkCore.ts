import type {
  Category,
  LiveStream,
  SeriesStream,
  VodStream,
  XtreamCredentials,
} from '../src/types';
import {
  XtreamService,
  type XtreamRequestTelemetry,
} from '../src/services/xtreamService';
import {
  isAndroidTempFileCatalogTransportAvailable,
  isUsingCapacitorNativeTransport,
  type TransportKind,
} from '../src/services/httpTransport';
import {
  buildLiveIndexAsync,
  buildSeriesIndexAsync,
  buildVodIndexAsync,
  type LiveCatalogIndex,
  type RankedCatalogIndex,
} from '../src/utils/catalogIndex';

export type BenchmarkDomain = 'live' | 'vod' | 'series';
export type BenchmarkStrategyId = 'A' | 'B' | 'C';

export const DOMAIN_LABELS_PT: Record<BenchmarkDomain, string> = {
  live: 'TV ao Vivo',
  vod: 'Filmes',
  series: 'Séries',
};

export const STRATEGY_LABELS_PT: Record<BenchmarkStrategyId, string> = {
  A: 'Estratégia A — Completo (atual)',
  B: 'Estratégia B — Por categoria',
  C: 'Estratégia C — Híbrido experimental',
};

export interface SelectedBenchmarkCategory {
  /** Identificador anônimo usado exclusivamente no relatório sanitizado (ex.: "cat_1"). */
  slotId: string;
  /** ID real usado apenas em memória durante a chamada ao provedor (nunca exportado). */
  categoryId: string;
  /** Índice 1-based na lista original de categorias (somente para contexto local). */
  listPosition: number;
}

export interface JsHeapSample {
  available: boolean;
  beforeMb: number | null;
  peakMb: number | null;
  afterMb: number | null;
  deltaMb: number | null;
}

export interface NetworkVolumeMetrics {
  /** Soma do comprimento em caracteres UTF-16 do texto JSON descomprimido recebido (sem re-serializar). */
  payloadTextCharsTotal: number | null;
  /** Soma de bytes efetivamente transferidos pela rede via Resource Timing (null se restrito por CORS/TAO ou indisponível). */
  transferSizeBytesTotal: number | null;
  /** Soma de bytes codificados/comprimidos via Resource Timing (null se restrito/indisponível). */
  encodedBodySizeBytesTotal: number | null;
  /** Soma de bytes descomprimidos via Resource Timing (null se restrito/indisponível). */
  decodedBodySizeBytesTotal: number | null;
  /** Soma de Content-Length expostos por cabeçalho HTTP (null se ausente/bloqueado por CORS). */
  contentLengthHeaderBytesTotal: number | null;
  /** Quantidade de tentativas em que Resource Timing zerou métricas por restrição CORS/Timing-Allow-Origin. */
  resourceTimingRestrictedAttempts: number;
  /** Quantidade de tentativas servidas comprovadamente do cache HTTP do navegador (transferSize=0 e decodedBodySize>0). */
  browserHttpCacheHitAttempts: number;
  /** Indica cabeçalhos HTTP de cache observados (sem valores sensíveis). */
  cacheHeadersObserved: {
    cacheControlValues: string[];
    maxObservedAgeSeconds: number | null;
    anyEtagPresent: boolean;
  };
  /** Tipos de transporte efetivamente utilizados nas tentativas desta estratégia. */
  transportKindsUsed: TransportKind[];
}

export interface CategoryAccessStepMetric {
  slotId: string;
  role: 'first_category' | 'other_category' | 'reuse_category';
  source:
    | 'full_index'
    | 'full_index_cache'
    | 'network_on_demand'
    | 'prefetch_cache'
    | 'round_local_cache';
  durationMs: number;
  fetchDurationMs: number;
  parseDurationMs: number;
  indexDurationMs: number;
  viewMaterializeDurationMs: number;
  recordsInView: number;
  /** Apenas para Estratégia C: duração real do prefetch em segundo plano da categoria antecipada. */
  backgroundPrefetchDurationMs?: number;
}

export type CategoryFilterComplianceStatus =
  | 'respected'
  | 'ignored_full_catalog'
  | 'partial_or_mixed'
  | 'empty_mismatch'
  | 'empty_consistent'
  | 'not_applicable';

export interface CategoryIntegrityCheck {
  slotId: string;
  receivedCount: number;
  uniqueIdCount: number;
  duplicateIdCount: number;
  exactPrimaryCategoryMatchCount: number;
  secondaryCategoryIdsMatchCount: number;
  outOfCategoryCount: number;
  distinctCategoryIdsReturned: number;
  compliance: CategoryFilterComplianceStatus;
  /** Comparação contra a Estratégia A (quando A foi executada na mesma rodada). */
  vsFullCatalog: {
    fullCatalogCategoryUniqueCount: number | null;
    missingComparedToFull: number | null;
    extraComparedToFull: number | null;
    /** Percentual de cobertura do domínio inteiro representado apenas por esta resposta. */
    shareOfFullDomainPercent: number | null;
  };
}

export interface StrategyRunMetrics {
  strategy: BenchmarkStrategyId;
  strategyLabel: string;
  domain: BenchmarkDomain;
  repetitionIndex: number;
  status: 'completed' | 'cancelled' | 'error';
  errorMessage?: string;
  errorCategory?: string;
  /** Tempo para obter a lista de categorias do domínio. */
  categoriesFetchMs: number | null;
  categoriesCount: number;
  /** Tempo acumulado do início da estratégia até a 1ª categoria estar disponível com índice pronto. */
  firstCategoryReadyWithIndexMs: number | null;
  /** Tempo de acesso às demais categorias representativas selecionadas. */
  otherCategoryAccessSteps: CategoryAccessStepMetric[];
  /** Tempo de reutilização da 1ª categoria já carregada/indexada. */
  reuseCategoryAccessMs: number | null;
  /** Tempo acumulado de todo o percurso medido na estratégia. */
  journeyTotalMs: number | null;
  /** Tempo para obter cobertura completa do catálogo (apenas quando efetivamente realizada, ex.: Estratégia A). */
  fullCatalogCoverageMs: number | null;
  /** Tempo total acumulado de consultas Xtream (incluindo espera de fila/rate-limit, rede e parse). */
  queryDurationTotalMs: number;
  /** Tempo total em espera no coordenador X02 (fila de slots + rate-limit). */
  coordinatorWaitTotalMs: number;
  /** Tempo total de transferência + leitura do corpo de resposta. */
  fetchDurationTotalMs: number;
  /** Tempo total de JSON.parse / normalização de payload. */
  parseDurationTotalMs: number;
  /** Tempo total de construção de índice cooperativo + materialização da visão da categoria. */
  indexDurationTotalMs: number;
  /** Duração do prefetch limitado em segundo plano (somente Estratégia C). */
  prefetchBackgroundDurationMs: number | null;
  requestCount: number;
  attemptCount: number;
  retryCount: number;
  rateLimitHitCount: number;
  rateLimitWaitMs: number;
  recordsReceivedTotal: number;
  uniqueRecordsTotal: number;
  duplicateRecordsTotal: number;
  /** Percentual de registros únicos carregados em relação ao catálogo completo da Estratégia A (quando disponível). */
  domainCoverageVsFullPercent: number | null;
  network: NetworkVolumeMetrics;
  jsHeapMb: JsHeapSample;
  /** Verificações de integridade do filtro category_id (Estratégias B e C). */
  categoryIntegrity: CategoryIntegrityCheck[];
  /** Resumo agregado de conformidade do filtro category_id nesta estratégia. */
  overallFilterCompliance: CategoryFilterComplianceStatus;
}

export interface MetricAggregateSummary {
  samples: number;
  min: number | null;
  median: number | null;
  mean: number | null;
  max: number | null;
  /** P95 só é calculado com >= 20 amostras; abaixo disso permanece explicitamente null. */
  p95: number | null;
  p95Available: boolean;
}

export interface StrategyDomainAggregate {
  strategy: BenchmarkStrategyId;
  strategyLabel: string;
  completedRuns: number;
  failedRuns: number;
  cancelledRuns: number;
  firstCategoryReadyWithIndexMs: MetricAggregateSummary;
  otherCategoryAvgAccessMs: MetricAggregateSummary;
  reuseCategoryAccessMs: MetricAggregateSummary;
  journeyTotalMs: MetricAggregateSummary;
  fullCatalogCoverageMs: MetricAggregateSummary;
  queryDurationTotalMs: MetricAggregateSummary;
  indexDurationTotalMs: MetricAggregateSummary;
  requestCountAvg: number | null;
  retryCountTotal: number;
  rateLimitHitTotal: number;
  uniqueRecordsAvg: number | null;
  payloadTextCharsAvg: number | null;
  transferSizeBytesAvg: number | null;
  domainCoverageVsFullPercentAvg: number | null;
  overallFilterCompliance: CategoryFilterComplianceStatus;
  runs: StrategyRunMetrics[];
}

export interface FunctionalDependencyImpact {
  feature: string;
  strategyA: string;
  strategyB: string;
  strategyC: string;
  riskNote: string;
}

export interface DomainBenchmarkResult {
  domain: BenchmarkDomain;
  domainLabel: string;
  totalCategoriesAvailable: number;
  selectedCategorySlots: Array<{
    slotId: string;
    listPosition: number;
  }>;
  repetitionsRequested: number;
  fullCatalogReferenceAvailable: boolean;
  fullCatalogUniqueCount: number | null;
  fullCatalogReceivedCount: number | null;
  fullCatalogDuplicateCount: number | null;
  strategies: Record<BenchmarkStrategyId, StrategyDomainAggregate>;
  providerFilterDiagnosis: {
    status: CategoryFilterComplianceStatus;
    summaryPt: string;
    anyProviderIgnoredFilter: boolean;
    anyOutOfCategoryRecords: boolean;
    anyDuplicatesDetected: boolean;
    anyMissingRecordsVsFull: boolean;
  };
}

export interface BenchmarkEnvironmentInfo {
  runtimeKind: 'web' | 'capacitor_native';
  androidCatalogFileTransferAvailable: boolean;
  memoryApiAvailable: boolean;
  resourceTimingApiAvailable: boolean;
  hardwareConcurrency: number | null;
  deviceMemoryGb: number | null;
  viewportClass: string;
  transportArchitectureNotes: {
    web: string;
    androidFullCatalog: string;
    androidFilteredCatalog: string;
    extrapolationWarning: string;
  };
}

export interface SanitizedBenchmarkReport {
  schemaVersion: 'nc-c01-catalog-benchmark/v1';
  generatedAtIso: string;
  disclaimerPt: string;
  environment: BenchmarkEnvironmentInfo;
  methodology: {
    executionMode: 'sequential_same_account_no_video';
    strategiesCompared: BenchmarkStrategyId[];
    repetitionsPerDomain: number;
    p95MinSamplesRequired: number;
    cacheCaveatPt: string;
    timingScopeCaveatPt: string;
  };
  domains: DomainBenchmarkResult[];
  functionalDependenciesMatrix: FunctionalDependencyImpact[];
}

export interface BenchmarkProgressEvent {
  domain: BenchmarkDomain;
  strategy?: BenchmarkStrategyId;
  repetition?: number;
  totalRepetitions?: number;
  phase: string;
  messagePt: string;
  timestampIso: string;
}

export interface RunDomainComparisonOptions {
  credentials: XtreamCredentials;
  domain: BenchmarkDomain;
  selectedCategories: SelectedBenchmarkCategory[];
  strategies?: BenchmarkStrategyId[];
  repetitions?: number;
  signal?: AbortSignal;
  onProgress?: (event: BenchmarkProgressEvent) => void;
}

interface FullCatalogReference {
  totalReceived: number;
  totalUniqueIds: number;
  duplicateIds: number;
  allUniqueIdSet: Set<string>;
  categoryIdBuckets: Map<string, Set<string>>;
}

interface CachedCategoryBundle {
  items: any[];
  index: LiveCatalogIndex<any> | RankedCatalogIndex<any>;
  viewCount: number;
}

const MIN_SAMPLES_FOR_P95 = 20;

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function roundMs(val: number): number {
  return Math.round(val * 100) / 100;
}

function readJsHeapUsedMb(): number | null {
  try {
    const perf = typeof performance !== 'undefined' ? (performance as any) : null;
    const usedBytes = perf?.memory?.usedJSHeapSize;
    if (typeof usedBytes === 'number' && Number.isFinite(usedBytes) && usedBytes >= 0) {
      return Math.round((usedBytes / (1024 * 1024)) * 100) / 100;
    }
  } catch {
    // Indisponível neste ambiente
  }
  return null;
}

function extractItemId(item: any, domain: BenchmarkDomain): string {
  if (!item || typeof item !== 'object') return '';
  const raw =
    domain === 'series'
      ? item.series_id ?? item.id ?? item.stream_id
      : item.stream_id ?? item.id ?? item.series_id;
  if (raw === undefined || raw === null || raw === '') return '';
  return String(raw);
}

function countUniqueAndDuplicateIds(
  items: any[],
  domain: BenchmarkDomain
): {
  received: number;
  uniqueSet: Set<string>;
  duplicateCount: number;
} {
  const uniqueSet = new Set<string>();
  let received = 0;
  let duplicates = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item !== 'object') continue;
    received++;
    const id = extractItemId(item, domain);
    if (!id) continue;
    if (uniqueSet.has(id)) {
      duplicates++;
    } else {
      uniqueSet.add(id);
    }
  }
  return {
    received,
    uniqueSet,
    duplicateCount: duplicates,
  };
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('Operação cancelada pelo usuário.');
    err.name = 'AbortError';
    (err as any).isAborted = true;
    throw err;
  }
}

function isAbortErrorLike(err: any, signal?: AbortSignal): boolean {
  return Boolean(
    signal?.aborted ||
      err?.isAborted === true ||
      err?.name === 'AbortError' ||
      err?.errorCategory === 'aborted' ||
      err?.message === 'Operação cancelada pelo usuário.'
  );
}

export function detectBenchmarkEnvironment(): BenchmarkEnvironmentInfo {
  const isNative = isUsingCapacitorNativeTransport();
  const hasAndroidFilePlugin = isAndroidTempFileCatalogTransportAvailable();
  const memoryApiAvailable = readJsHeapUsedMb() !== null;
  const resourceTimingApiAvailable =
    typeof performance !== 'undefined' &&
    typeof performance.getEntriesByType === 'function';

  let hardwareConcurrency: number | null = null;
  let deviceMemoryGb: number | null = null;
  if (typeof navigator !== 'undefined') {
    if (
      typeof navigator.hardwareConcurrency === 'number' &&
      Number.isFinite(navigator.hardwareConcurrency)
    ) {
      hardwareConcurrency = navigator.hardwareConcurrency;
    }
    const dm = (navigator as any).deviceMemory;
    if (typeof dm === 'number' && Number.isFinite(dm)) {
      deviceMemoryGb = dm;
    }
  }

  let viewportClass = 'headless/non-browser';
  if (typeof window !== 'undefined' && typeof window.innerWidth === 'number') {
    const w = window.innerWidth;
    if (w >= 1600) viewportClass = 'large-desktop-or-tv (>=1600px)';
    else if (w >= 1200) viewportClass = 'desktop-or-tv-720p-1080p (1200-1599px)';
    else if (w >= 768) viewportClass = 'tablet-or-compact (768-1199px)';
    else viewportClass = 'mobile (<768px)';
  }

  return {
    runtimeKind: isNative ? 'capacitor_native' : 'web',
    androidCatalogFileTransferAvailable: hasAndroidFilePlugin,
    memoryApiAvailable,
    resourceTimingApiAvailable,
    hardwareConcurrency,
    deviceMemoryGb,
    viewportClass,
    transportArchitectureNotes: {
      web: 'No navegador (Web), todas as consultas utilizam fetch nativo com AbortController.',
      androidFullCatalog:
        'No APK Android, consultas de catálogo completo sem category_id utilizam o plugin nativo CatalogFileTransfer (arquivo temporário em cache privado + leitura local na WebView), quando disponível.',
      androidFilteredCatalog:
        'No APK Android, consultas filtradas por category_id (e categorias/EPG/detalhes) utilizam normalmente CapacitorHttp.get, sem passar pelo CatalogFileTransfer.',
      extrapolationWarning:
        'Medições Web não devem ser extrapoladas automaticamente para o APK Android devido à diferença entre fetch, CatalogFileTransfer e CapacitorHttp e ao perfil de memória/CPU de dispositivos Android TV.',
    },
  };
}

export function buildFunctionalDependenciesMatrix(): FunctionalDependencyImpact[] {
  return [
    {
      feature: 'Busca global',
      strategyA: 'Completa e imediata em todo o domínio após carga inicial.',
      strategyB:
        'Incompleta: só enxerga categorias já visitadas, a menos que exista busca remota ou carga posterior.',
      strategyC:
        'Incompleta: enxerga apenas a categoria atual, a categoria em prefetch e categorias já visitadas.',
      riskNote:
        'Redução de tempo inicial em B/C não substitui cobertura de busca global sem estratégia complementar na C02.',
    },
    {
      feature: 'Favoritos e histórico',
      strategyA:
        'Resolução local completa de metadados atualizados contra o índice global do domínio.',
      strategyB:
        'Itens favoritados/assistidos fora das categorias carregadas ficam dependentes apenas do snapshot salvo localmente.',
      strategyC:
        'Mesma limitação da B para itens fora das categorias já carregadas ou pré-carregadas.',
      riskNote:
        'Verificar na C02 se snapshots persistidos em localStorage cobrem reprodução e exibição sem item no catálogo em memória.',
    },
    {
      feature: 'Continuar assistindo',
      strategyA:
        'Sincroniza e resolve itens em andamento em qualquer categoria do domínio.',
      strategyB:
        'Depende de snapshots persistidos ou consultas pontuais (get_vod_info/get_series_info) quando a categoria não foi carregada.',
      strategyC:
        'Mesma dependência da B para categorias não visitadas.',
      riskNote:
        'Pode exigir fallback controlado para não quebrar retomada a partir da Home.',
    },
    {
      feature: 'HeroBanner',
      strategyA:
        'Seleciona os 30 melhores itens deduplicados considerando todo o catálogo de filmes e séries.',
      strategyB:
        'Com apenas 1 categoria carregada, o HeroBanner perde representatividade global do catálogo.',
      strategyC:
        'Ainda restrito a poucas categorias; não reproduz a seleção global atual.',
      riskNote:
        'Impacto direto na tela inicial e nas páginas de Filmes/Séries.',
    },
    {
      feature: 'Destaques e conteúdos recentes',
      strategyA:
        'Ordenação por ano/avaliação/recência sobre o catálogo completo do domínio.',
      strategyB:
        'Limitado ao subconjunto de categorias já carregadas; recentes de outras categorias não aparecem.',
      strategyC:
        'Mesma limitação parcial da B.',
      riskNote:
        'Avaliar se existe categoria dedicada de lançamentos ou necessidade de carregamento progressivo.',
    },
    {
      feature: 'Navegação entre categorias',
      strategyA:
        'Troca instantânea em memória via índice O(1) após carga completa inicial.',
      strategyB:
        'Cada categoria não visitada introduz latência de rede + parse + indexação; reutilização é imediata.',
      strategyC:
        'Próxima categoria pré-carregada tende a abrir instantaneamente; saltos para outras categorias sofrem latência de rede.',
      riskNote:
        'Comparar tempo até 1ª categoria versus soma de latências na troca entre múltiplas categorias.',
    },
    {
      feature: 'Virtualização',
      strategyA:
        'Opera sobre fatia filtrada da categoria mantendo todo o array completo em memória.',
      strategyB:
        'Opera sobre arrays menores por categoria, reduzindo pressão de memória quando o provedor respeita category_id.',
      strategyC:
        'Similar à B com acréscimo controlado de uma categoria pré-carregada.',
      riskNote:
        'Se o provedor ignorar category_id, B e C podem multiplicar memória e tráfego em vez de reduzi-los.',
    },
    {
      feature: 'Reprodução e restauração de foco',
      strategyA:
        'Item e índice permanecem disponíveis na volta do player, preservando posição e foco.',
      strategyB:
        'Preservada desde que o cache local da categoria da sessão não seja descartado ao navegar para o player.',
      strategyC:
        'Preservada com cache local da sessão; requer cuidado para que prefetch não dispute banda com vídeo.',
      riskNote:
        'Nunca executar prefetch concorrente com início de reprodução de vídeo.',
    },
  ];
}

/**
 * Avalia se a resposta filtrada por `category_id` de um provedor realmente respeitou o filtro,
 * identificando duplicados, itens fora da categoria e divergências em relação ao catálogo completo.
 */
export function analyzeCategoryFilterCompliance(params: {
  slotId: string;
  requestedCategoryId: string;
  items: any[];
  domain: BenchmarkDomain;
  fullCatalogReference?: FullCatalogReference | null;
}): CategoryIntegrityCheck {
  const { slotId, requestedCategoryId, items, domain, fullCatalogReference } = params;
  const reqCatStr = String(requestedCategoryId);

  const uniqueIds = new Set<string>();
  const matchingUniqueIds = new Set<string>();
  const distinctCategories = new Set<string>();

  let receivedCount = 0;
  let duplicateIdCount = 0;
  let exactPrimaryCategoryMatchCount = 0;
  let secondaryCategoryIdsMatchCount = 0;
  let outOfCategoryCount = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item !== 'object') continue;
    receivedCount++;

    const id = extractItemId(item, domain);
    let isDuplicate = false;
    if (id) {
      if (uniqueIds.has(id)) {
        duplicateIdCount++;
        isDuplicate = true;
      } else {
        uniqueIds.add(id);
      }
    }

    const primaryCat =
      item.category_id !== undefined && item.category_id !== null
        ? String(item.category_id)
        : '';
    if (primaryCat) {
      distinctCategories.add(primaryCat);
    }

    const exactPrimaryMatch = primaryCat === reqCatStr;
    const secondaryMatch =
      !exactPrimaryMatch &&
      Array.isArray(item.category_ids) &&
      item.category_ids.some(
        (cid: unknown) => cid !== undefined && cid !== null && String(cid) === reqCatStr
      );

    if (exactPrimaryMatch) {
      exactPrimaryCategoryMatchCount++;
      if (id && !isDuplicate) {
        matchingUniqueIds.add(id);
      }
    } else if (secondaryMatch) {
      secondaryCategoryIdsMatchCount++;
      if (id && !isDuplicate) {
        matchingUniqueIds.add(id);
      }
    } else {
      outOfCategoryCount++;
    }
  }

  let fullCatalogCategoryUniqueCount: number | null = null;
  let missingComparedToFull: number | null = null;
  let extraComparedToFull: number | null = null;
  let shareOfFullDomainPercent: number | null = null;

  if (fullCatalogReference) {
    const fullBucket = fullCatalogReference.categoryIdBuckets.get(reqCatStr) ?? new Set<string>();
    fullCatalogCategoryUniqueCount = fullBucket.size;

    let missing = 0;
    fullBucket.forEach((id) => {
      if (!uniqueIds.has(id)) missing++;
    });
    missingComparedToFull = missing;

    let extra = 0;
    matchingUniqueIds.forEach((id) => {
      if (!fullBucket.has(id)) extra++;
    });
    extraComparedToFull = extra;

    if (fullCatalogReference.totalUniqueIds > 0) {
      shareOfFullDomainPercent = roundMs(
        (uniqueIds.size / fullCatalogReference.totalUniqueIds) * 100
      );
    }
  }

  let compliance: CategoryFilterComplianceStatus;
  if (receivedCount === 0) {
    if (fullCatalogCategoryUniqueCount !== null && fullCatalogCategoryUniqueCount > 0) {
      compliance = 'empty_mismatch';
    } else {
      compliance = 'empty_consistent';
    }
  } else if (outOfCategoryCount === 0) {
    compliance = 'respected';
  } else if (
    (fullCatalogReference &&
      fullCatalogReference.totalUniqueIds > 0 &&
      uniqueIds.size >= fullCatalogReference.totalUniqueIds * 0.9 &&
      distinctCategories.size > 1) ||
    (distinctCategories.size >= 3 &&
      outOfCategoryCount > exactPrimaryCategoryMatchCount + secondaryCategoryIdsMatchCount)
  ) {
    compliance = 'ignored_full_catalog';
  } else {
    compliance = 'partial_or_mixed';
  }

  return {
    slotId,
    receivedCount,
    uniqueIdCount: uniqueIds.size,
    duplicateIdCount,
    exactPrimaryCategoryMatchCount,
    secondaryCategoryIdsMatchCount,
    outOfCategoryCount,
    distinctCategoryIdsReturned: distinctCategories.size,
    compliance,
    vsFullCatalog: {
      fullCatalogCategoryUniqueCount,
      missingComparedToFull,
      extraComparedToFull,
      shareOfFullDomainPercent,
    },
  };
}

export function summarizeMetricSamples(values: Array<number | null | undefined>): MetricAggregateSummary {
  const valid = values
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    .slice()
    .sort((a, b) => a - b);

  if (valid.length === 0) {
    return {
      samples: 0,
      min: null,
      median: null,
      mean: null,
      max: null,
      p95: null,
      p95Available: false,
    };
  }

  const min = roundMs(valid[0]);
  const max = roundMs(valid[valid.length - 1]);
  const sum = valid.reduce((acc, n) => acc + n, 0);
  const mean = roundMs(sum / valid.length);
  const mid = Math.floor(valid.length / 2);
  const median = roundMs(
    valid.length % 2 === 0 ? (valid[mid - 1] + valid[mid]) / 2 : valid[mid]
  );

  // Nunca apresentar P95 representativo com número insuficiente de amostras (mínimo 20).
  const p95Available = valid.length >= MIN_SAMPLES_FOR_P95;
  let p95: number | null = null;
  if (p95Available) {
    const idx = Math.min(valid.length - 1, Math.ceil(valid.length * 0.95) - 1);
    p95 = roundMs(valid[idx]);
  }

  return {
    samples: valid.length,
    min,
    median,
    mean,
    max,
    p95,
    p95Available,
  };
}

function summarizeOverallCompliance(
  checks: CategoryIntegrityCheck[]
): CategoryFilterComplianceStatus {
  if (checks.length === 0) return 'not_applicable';
  if (checks.some((c) => c.compliance === 'ignored_full_catalog')) {
    return 'ignored_full_catalog';
  }
  if (checks.some((c) => c.compliance === 'empty_mismatch')) {
    return 'empty_mismatch';
  }
  if (checks.some((c) => c.compliance === 'partial_or_mixed')) {
    return 'partial_or_mixed';
  }
  if (checks.every((c) => c.compliance === 'empty_consistent')) {
    return 'empty_consistent';
  }
  return 'respected';
}

function aggregateTelemetryEvents(events: XtreamRequestTelemetry[]): {
  requestCount: number;
  attemptCount: number;
  retryCount: number;
  rateLimitHitCount: number;
  rateLimitWaitMs: number;
  queryDurationTotalMs: number;
  coordinatorWaitTotalMs: number;
  fetchDurationTotalMs: number;
  parseDurationTotalMs: number;
  network: NetworkVolumeMetrics;
} {
  let requestCount = events.length;
  let attemptCount = 0;
  let retryCount = 0;
  let rateLimitHitCount = 0;
  let rateLimitWaitMs = 0;
  let queryDurationTotalMs = 0;
  let coordinatorWaitTotalMs = 0;
  let fetchDurationTotalMs = 0;
  let parseDurationTotalMs = 0;

  let payloadCharsSum = 0;
  let hasPayloadChars = false;
  let transferBytesSum = 0;
  let hasTransferBytes = false;
  let encodedBytesSum = 0;
  let hasEncodedBytes = false;
  let decodedBytesSum = 0;
  let hasDecodedBytes = false;
  let contentLengthSum = 0;
  let hasContentLength = false;
  let resourceTimingRestrictedAttempts = 0;
  let browserHttpCacheHitAttempts = 0;

  const cacheControlSet = new Set<string>();
  let maxObservedAgeSeconds: number | null = null;
  let anyEtagPresent = false;
  const transportKinds = new Set<TransportKind>();

  for (const ev of events) {
    attemptCount += ev.attemptCount;
    retryCount += ev.retryCount;
    rateLimitHitCount += ev.rateLimitHitCount;
    rateLimitWaitMs += ev.rateLimitWaitMs;
    queryDurationTotalMs += ev.totalDurationMs;
    coordinatorWaitTotalMs += ev.queueWaitMs + ev.rateLimitWaitMs;

    for (const att of ev.attempts) {
      transportKinds.add(att.transportKind);
      fetchDurationTotalMs += att.fetchDurationMs;
      parseDurationTotalMs += att.parseDurationMs;

      if (att.payloadTextChars !== null) {
        payloadCharsSum += att.payloadTextChars;
        hasPayloadChars = true;
      }
      if (att.transferSizeBytes !== null) {
        transferBytesSum += att.transferSizeBytes;
        hasTransferBytes = true;
      }
      if (att.encodedBodySizeBytes !== null) {
        encodedBytesSum += att.encodedBodySizeBytes;
        hasEncodedBytes = true;
      }
      if (att.decodedBodySizeBytes !== null) {
        decodedBytesSum += att.decodedBodySizeBytes;
        hasDecodedBytes = true;
      }
      if (att.contentLengthHeaderBytes !== null) {
        contentLengthSum += att.contentLengthHeaderBytes;
        hasContentLength = true;
      }
      if (att.resourceTimingRestrictedByCors) {
        resourceTimingRestrictedAttempts++;
      }
      if (att.fromBrowserHttpCache === true) {
        browserHttpCacheHitAttempts++;
      }
      if (att.cacheControl) {
        cacheControlSet.add(att.cacheControl);
      }
      if (att.ageHeaderSeconds !== null) {
        maxObservedAgeSeconds =
          maxObservedAgeSeconds === null
            ? att.ageHeaderSeconds
            : Math.max(maxObservedAgeSeconds, att.ageHeaderSeconds);
      }
      if (att.etagPresent) {
        anyEtagPresent = true;
      }
    }
  }

  return {
    requestCount,
    attemptCount,
    retryCount,
    rateLimitHitCount,
    rateLimitWaitMs: roundMs(rateLimitWaitMs),
    queryDurationTotalMs: roundMs(queryDurationTotalMs),
    coordinatorWaitTotalMs: roundMs(coordinatorWaitTotalMs),
    fetchDurationTotalMs: roundMs(fetchDurationTotalMs),
    parseDurationTotalMs: roundMs(parseDurationTotalMs),
    network: {
      payloadTextCharsTotal: hasPayloadChars ? payloadCharsSum : null,
      transferSizeBytesTotal: hasTransferBytes ? transferBytesSum : null,
      encodedBodySizeBytesTotal: hasEncodedBytes ? encodedBytesSum : null,
      decodedBodySizeBytesTotal: hasDecodedBytes ? decodedBytesSum : null,
      contentLengthHeaderBytesTotal: hasContentLength ? contentLengthSum : null,
      resourceTimingRestrictedAttempts,
      browserHttpCacheHitAttempts,
      cacheHeadersObserved: {
        cacheControlValues: Array.from(cacheControlSet),
        maxObservedAgeSeconds,
        anyEtagPresent,
      },
      transportKindsUsed: Array.from(transportKinds),
    },
  };
}

async function fetchDomainCategories(
  credentials: XtreamCredentials,
  domain: BenchmarkDomain,
  signal: AbortSignal | undefined,
  onTelemetry?: (ev: XtreamRequestTelemetry) => void
): Promise<Category[]> {
  const opts = {
    signal,
    dedupe: false,
    priority: 'user' as const,
    onTelemetry,
  };
  if (domain === 'live') {
    return XtreamService.getLiveCategories(credentials, opts);
  }
  if (domain === 'vod') {
    return XtreamService.getVodCategories(credentials, opts);
  }
  return XtreamService.getSeriesCategories(credentials, opts);
}

async function fetchDomainItems(
  credentials: XtreamCredentials,
  domain: BenchmarkDomain,
  categoryId: string | undefined,
  priority: 'user' | 'background',
  signal: AbortSignal | undefined,
  onTelemetry?: (ev: XtreamRequestTelemetry) => void
): Promise<Array<LiveStream | VodStream | SeriesStream>> {
  const opts = {
    signal,
    dedupe: false,
    priority,
    onTelemetry,
  };
  if (domain === 'live') {
    return XtreamService.getLiveStreams(credentials, categoryId, opts);
  }
  if (domain === 'vod') {
    return XtreamService.getVodStreams(credentials, categoryId, opts);
  }
  return XtreamService.getSeries(credentials, categoryId, opts);
}

async function buildDomainIndex(
  domain: BenchmarkDomain,
  items: any[],
  signal?: AbortSignal
): Promise<LiveCatalogIndex<any> | RankedCatalogIndex<any>> {
  let built: LiveCatalogIndex<any> | RankedCatalogIndex<any> | null;
  if (domain === 'live') {
    built = await buildLiveIndexAsync(items, { signal });
  } else if (domain === 'vod') {
    built = await buildVodIndexAsync(items, { signal });
  } else {
    built = await buildSeriesIndexAsync(items, { signal });
  }
  if (!built) {
    const err = new Error('Operação cancelada pelo usuário.');
    err.name = 'AbortError';
    (err as any).isAborted = true;
    throw err;
  }
  return built;
}

function materializeCategoryView(
  domain: BenchmarkDomain,
  index: LiveCatalogIndex<any> | RankedCatalogIndex<any>,
  categoryId: string
): number {
  if (domain === 'live') {
    const groups = (index as LiveCatalogIndex<any>).getGroupsByCategory(categoryId);
    return groups.length;
  }
  const sorted = (index as RankedCatalogIndex<any>).getSortedByCategory(categoryId);
  return sorted.length;
}

/**
 * Carrega as categorias de um domínio para seleção interativa pelo proprietário.
 * Nunca altera sessão persistida e respeita cancelamento via AbortSignal.
 */
export async function loadCategoriesForSelection(
  credentials: XtreamCredentials,
  domain: BenchmarkDomain,
  signal?: AbortSignal
): Promise<Category[]> {
  return fetchDomainCategories(credentials, domain, signal);
}

/**
 * Seleciona até 3 categorias representativas (início, meio e terço final) sem viés manual
 * quando o proprietário optar pela seleção automática sugerida.
 */
export function pickDefaultRepresentativeCategories(
  categories: Category[],
  maxCount: number = 3
): SelectedBenchmarkCategory[] {
  if (!Array.isArray(categories) || categories.length === 0) return [];
  const valid = categories.filter(
    (c) => c && c.category_id !== undefined && c.category_id !== null && String(c.category_id).trim() !== ''
  );
  if (valid.length === 0) return [];

  const desired = Math.min(maxCount, valid.length);
  const chosenIndices = new Set<number>();
  if (desired === 1) {
    chosenIndices.add(0);
  } else if (desired === 2) {
    chosenIndices.add(0);
    chosenIndices.add(Math.floor(valid.length / 2));
  } else {
    chosenIndices.add(0);
    chosenIndices.add(Math.floor(valid.length / 2));
    chosenIndices.add(Math.max(1, Math.min(valid.length - 1, Math.floor((valid.length * 3) / 4))));
  }

  for (let i = 0; chosenIndices.size < desired && i < valid.length; i++) {
    chosenIndices.add(i);
  }

  return Array.from(chosenIndices)
    .sort((a, b) => a - b)
    .map((idx, slotIdx) => ({
      slotId: `cat_${slotIdx + 1}`,
      categoryId: String(valid[idx].category_id),
      listPosition: idx + 1,
    }));
}

function createHeapTracker() {
  const before = readJsHeapUsedMb();
  const available = before !== null;
  let peak = before;

  const sample = () => {
    if (!available) return;
    const current = readJsHeapUsedMb();
    if (current !== null && (peak === null || current > peak)) {
      peak = current;
    }
  };

  const finish = (): JsHeapSample => {
    if (!available) {
      return {
        available: false,
        beforeMb: null,
        peakMb: null,
        afterMb: null,
        deltaMb: null,
      };
    }
    const after = readJsHeapUsedMb();
    if (after !== null && (peak === null || after > peak)) {
      peak = after;
    }
    return {
      available: true,
      beforeMb: before,
      peakMb: peak,
      afterMb: after,
      deltaMb:
        before !== null && after !== null
          ? roundMs(after - before)
          : null,
    };
  };

  return { sample, finish };
}

async function executeStrategyA(params: {
  credentials: XtreamCredentials;
  domain: BenchmarkDomain;
  categories: SelectedBenchmarkCategory[];
  repetitionIndex: number;
  signal?: AbortSignal;
  onProgress?: (phase: string, messagePt: string) => void;
}): Promise<{ metrics: StrategyRunMetrics; reference: FullCatalogReference | null }> {
  const { credentials, domain, categories, repetitionIndex, signal, onProgress } = params;
  const telemetryEvents: XtreamRequestTelemetry[] = [];
  const heap = createHeapTracker();
  const strategyStartMs = nowMs();

  let categoriesFetchMs: number | null = null;
  let categoriesCount = 0;
  let firstCategoryReadyWithIndexMs: number | null = null;
  let fullCatalogCoverageMs: number | null = null;
  let reuseCategoryAccessMs: number | null = null;
  let indexDurationTotalMs = 0;
  let recordsReceivedTotal = 0;
  let uniqueRecordsTotal = 0;
  let duplicateRecordsTotal = 0;
  const otherCategoryAccessSteps: CategoryAccessStepMetric[] = [];
  let reference: FullCatalogReference | null = null;

  try {
    checkAbort(signal);
    onProgress?.('categories', 'Estratégia A: consultando categorias do domínio...');
    const catStart = nowMs();
    const fetchedCategories = await fetchDomainCategories(
      credentials,
      domain,
      signal,
      (ev) => telemetryEvents.push(ev)
    );
    categoriesFetchMs = roundMs(nowMs() - catStart);
    categoriesCount = fetchedCategories.length;
    heap.sample();

    checkAbort(signal);
    onProgress?.('full_catalog', 'Estratégia A: consultando catálogo completo do domínio...');
    const fullItems = await fetchDomainItems(
      credentials,
      domain,
      undefined,
      'user',
      signal,
      (ev) => telemetryEvents.push(ev)
    );
    heap.sample();

    checkAbort(signal);
    onProgress?.('index_build', 'Estratégia A: construindo índice local completo...');
    const idxStart = nowMs();
    const fullIndex = await buildDomainIndex(domain, fullItems, signal);
    const fullIndexBuildMs = nowMs() - idxStart;
    indexDurationTotalMs += fullIndexBuildMs;
    fullCatalogCoverageMs = roundMs(nowMs() - strategyStartMs);
    heap.sample();

    // Constrói referência para verificação de integridade nas estratégias B e C
    const idStats = countUniqueAndDuplicateIds(fullItems, domain);
    recordsReceivedTotal = idStats.received;
    uniqueRecordsTotal = idStats.uniqueSet.size;
    duplicateRecordsTotal = idStats.duplicateCount;

    const categoryIdBuckets = new Map<string, Set<string>>();
    for (let i = 0; i < fullItems.length; i++) {
      const item = fullItems[i] as any;
      if (!item || typeof item !== 'object') continue;
      const itemId = extractItemId(item, domain);
      if (!itemId) continue;
      const primaryCat =
        item.category_id !== undefined && item.category_id !== null
          ? String(item.category_id)
          : '';
      if (primaryCat) {
        let bucket = categoryIdBuckets.get(primaryCat);
        if (!bucket) {
          bucket = new Set<string>();
          categoryIdBuckets.set(primaryCat, bucket);
        }
        bucket.add(itemId);
      }
      if (Array.isArray(item.category_ids)) {
        for (const cid of item.category_ids) {
          if (cid === undefined || cid === null) continue;
          const cidStr = String(cid);
          let bucket = categoryIdBuckets.get(cidStr);
          if (!bucket) {
            bucket = new Set<string>();
            categoryIdBuckets.set(cidStr, bucket);
          }
          bucket.add(itemId);
        }
      }
    }

    reference = {
      totalReceived: idStats.received,
      totalUniqueIds: idStats.uniqueSet.size,
      duplicateIds: idStats.duplicateCount,
      allUniqueIdSet: idStats.uniqueSet,
      categoryIdBuckets,
    };

    // Acesso à 1ª categoria via índice
    const firstCat = categories[0];
    if (firstCat) {
      checkAbort(signal);
      onProgress?.('first_category', 'Estratégia A: acessando 1ª categoria pelo índice...');
      const viewStart = nowMs();
      materializeCategoryView(domain, fullIndex, firstCat.categoryId);
      const viewMs = nowMs() - viewStart;
      indexDurationTotalMs += viewMs;
      firstCategoryReadyWithIndexMs = roundMs(nowMs() - strategyStartMs);
      heap.sample();
    } else {
      firstCategoryReadyWithIndexMs = fullCatalogCoverageMs;
    }

    // Acesso às demais categorias via índice já construído
    for (let i = 1; i < categories.length; i++) {
      checkAbort(signal);
      const cat = categories[i];
      onProgress?.(
        'other_category',
        `Estratégia A: acessando categoria ${i + 1}/${categories.length} pelo índice...`
      );
      const stepStart = nowMs();
      const count = materializeCategoryView(domain, fullIndex, cat.categoryId);
      const stepMs = nowMs() - stepStart;
      indexDurationTotalMs += stepMs;
      otherCategoryAccessSteps.push({
        slotId: cat.slotId,
        role: 'other_category',
        source: 'full_index',
        durationMs: roundMs(stepMs),
        fetchDurationMs: 0,
        parseDurationMs: 0,
        indexDurationMs: 0,
        viewMaterializeDurationMs: roundMs(stepMs),
        recordsInView: count,
      });
      heap.sample();
    }

    // Reutilização da 1ª categoria (cache interno do índice)
    if (firstCat) {
      checkAbort(signal);
      onProgress?.('reuse_category', 'Estratégia A: medindo reutilização da 1ª categoria...');
      const reuseStart = nowMs();
      materializeCategoryView(domain, fullIndex, firstCat.categoryId);
      reuseCategoryAccessMs = roundMs(nowMs() - reuseStart);
    }

    const journeyTotalMs = roundMs(nowMs() - strategyStartMs);
    const agg = aggregateTelemetryEvents(telemetryEvents);

    return {
      reference,
      metrics: {
        strategy: 'A',
        strategyLabel: STRATEGY_LABELS_PT.A,
        domain,
        repetitionIndex,
        status: 'completed',
        categoriesFetchMs,
        categoriesCount,
        firstCategoryReadyWithIndexMs,
        otherCategoryAccessSteps,
        reuseCategoryAccessMs,
        journeyTotalMs,
        fullCatalogCoverageMs,
        queryDurationTotalMs: agg.queryDurationTotalMs,
        coordinatorWaitTotalMs: agg.coordinatorWaitTotalMs,
        fetchDurationTotalMs: agg.fetchDurationTotalMs,
        parseDurationTotalMs: agg.parseDurationTotalMs,
        indexDurationTotalMs: roundMs(indexDurationTotalMs),
        prefetchBackgroundDurationMs: null,
        requestCount: agg.requestCount,
        attemptCount: agg.attemptCount,
        retryCount: agg.retryCount,
        rateLimitHitCount: agg.rateLimitHitCount,
        rateLimitWaitMs: agg.rateLimitWaitMs,
        recordsReceivedTotal,
        uniqueRecordsTotal,
        duplicateRecordsTotal,
        domainCoverageVsFullPercent: 100,
        network: agg.network,
        jsHeapMb: heap.finish(),
        categoryIntegrity: [],
        overallFilterCompliance: 'not_applicable',
      },
    };
  } catch (err: any) {
    const cancelled = isAbortErrorLike(err, signal);
    const agg = aggregateTelemetryEvents(telemetryEvents);
    return {
      reference,
      metrics: {
        strategy: 'A',
        strategyLabel: STRATEGY_LABELS_PT.A,
        domain,
        repetitionIndex,
        status: cancelled ? 'cancelled' : 'error',
        errorMessage: cancelled
          ? 'Comparação cancelada pelo usuário.'
          : String(err?.message || 'Erro ao executar a Estratégia A.'),
        errorCategory: err?.errorCategory,
        categoriesFetchMs,
        categoriesCount,
        firstCategoryReadyWithIndexMs,
        otherCategoryAccessSteps,
        reuseCategoryAccessMs,
        journeyTotalMs: roundMs(nowMs() - strategyStartMs),
        fullCatalogCoverageMs,
        queryDurationTotalMs: agg.queryDurationTotalMs,
        coordinatorWaitTotalMs: agg.coordinatorWaitTotalMs,
        fetchDurationTotalMs: agg.fetchDurationTotalMs,
        parseDurationTotalMs: agg.parseDurationTotalMs,
        indexDurationTotalMs: roundMs(indexDurationTotalMs),
        prefetchBackgroundDurationMs: null,
        requestCount: agg.requestCount,
        attemptCount: agg.attemptCount,
        retryCount: agg.retryCount,
        rateLimitHitCount: agg.rateLimitHitCount,
        rateLimitWaitMs: agg.rateLimitWaitMs,
        recordsReceivedTotal,
        uniqueRecordsTotal,
        duplicateRecordsTotal,
        domainCoverageVsFullPercent: null,
        network: agg.network,
        jsHeapMb: heap.finish(),
        categoryIntegrity: [],
        overallFilterCompliance: 'not_applicable',
      },
    };
  }
}

async function loadAndIndexSingleCategory(params: {
  credentials: XtreamCredentials;
  domain: BenchmarkDomain;
  category: SelectedBenchmarkCategory;
  priority: 'user' | 'background';
  signal?: AbortSignal;
  telemetryEvents: XtreamRequestTelemetry[];
  fullCatalogReference?: FullCatalogReference | null;
}): Promise<{
  bundle: CachedCategoryBundle;
  stepDurationMs: number;
  fetchDurationMs: number;
  parseDurationMs: number;
  indexDurationMs: number;
  viewMaterializeDurationMs: number;
  integrity: CategoryIntegrityCheck;
}> {
  const {
    credentials,
    domain,
    category,
    priority,
    signal,
    telemetryEvents,
    fullCatalogReference,
  } = params;

  const stepStart = nowMs();
  let stepFetchMs = 0;
  let stepParseMs = 0;

  const items = await fetchDomainItems(
    credentials,
    domain,
    category.categoryId,
    priority,
    signal,
    (ev) => {
      telemetryEvents.push(ev);
      for (const att of ev.attempts) {
        stepFetchMs += att.fetchDurationMs;
        stepParseMs += att.parseDurationMs;
      }
    }
  );

  checkAbort(signal);
  const idxStart = nowMs();
  const index = await buildDomainIndex(domain, items, signal);
  const indexDurationMs = nowMs() - idxStart;

  const viewStart = nowMs();
  const viewCount = materializeCategoryView(domain, index, category.categoryId);
  const viewMaterializeDurationMs = nowMs() - viewStart;

  const stepDurationMs = nowMs() - stepStart;

  const integrity = analyzeCategoryFilterCompliance({
    slotId: category.slotId,
    requestedCategoryId: category.categoryId,
    items,
    domain,
    fullCatalogReference,
  });

  return {
    bundle: { items, index, viewCount },
    stepDurationMs,
    fetchDurationMs: stepFetchMs,
    parseDurationMs: stepParseMs,
    indexDurationMs,
    viewMaterializeDurationMs,
    integrity,
  };
}

async function executeStrategyB(params: {
  credentials: XtreamCredentials;
  domain: BenchmarkDomain;
  categories: SelectedBenchmarkCategory[];
  repetitionIndex: number;
  fullCatalogReference?: FullCatalogReference | null;
  signal?: AbortSignal;
  onProgress?: (phase: string, messagePt: string) => void;
}): Promise<StrategyRunMetrics> {
  const {
    credentials,
    domain,
    categories,
    repetitionIndex,
    fullCatalogReference,
    signal,
    onProgress,
  } = params;
  const telemetryEvents: XtreamRequestTelemetry[] = [];
  const heap = createHeapTracker();
  const strategyStartMs = nowMs();
  const roundCache = new Map<string, CachedCategoryBundle>();
  const allLoadedUniqueIds = new Set<string>();
  const categoryIntegrity: CategoryIntegrityCheck[] = [];
  const otherCategoryAccessSteps: CategoryAccessStepMetric[] = [];

  let categoriesFetchMs: number | null = null;
  let categoriesCount = 0;
  let firstCategoryReadyWithIndexMs: number | null = null;
  let reuseCategoryAccessMs: number | null = null;
  let indexDurationTotalMs = 0;
  let recordsReceivedTotal = 0;
  let duplicateRecordsTotal = 0;

  try {
    checkAbort(signal);
    onProgress?.('categories', 'Estratégia B: consultando categorias do domínio...');
    const catStart = nowMs();
    const fetchedCategories = await fetchDomainCategories(
      credentials,
      domain,
      signal,
      (ev) => telemetryEvents.push(ev)
    );
    categoriesFetchMs = roundMs(nowMs() - catStart);
    categoriesCount = fetchedCategories.length;
    heap.sample();

    const firstCat = categories[0];
    if (firstCat) {
      checkAbort(signal);
      onProgress?.('first_category', 'Estratégia B: carregando somente a 1ª categoria...');
      const firstResult = await loadAndIndexSingleCategory({
        credentials,
        domain,
        category: firstCat,
        priority: 'user',
        signal,
        telemetryEvents,
        fullCatalogReference,
      });
      roundCache.set(firstCat.categoryId, firstResult.bundle);
      categoryIntegrity.push(firstResult.integrity);
      indexDurationTotalMs +=
        firstResult.indexDurationMs + firstResult.viewMaterializeDurationMs;
      recordsReceivedTotal += firstResult.integrity.receivedCount;
      duplicateRecordsTotal += firstResult.integrity.duplicateIdCount;
      for (const item of firstResult.bundle.items) {
        const id = extractItemId(item, domain);
        if (id) allLoadedUniqueIds.add(id);
      }
      firstCategoryReadyWithIndexMs = roundMs(nowMs() - strategyStartMs);
      heap.sample();
    }

    // Demais categorias sob demanda
    for (let i = 1; i < categories.length; i++) {
      checkAbort(signal);
      const cat = categories[i];
      onProgress?.(
        'other_category',
        `Estratégia B: carregando categoria ${i + 1}/${categories.length} sob demanda...`
      );
      const res = await loadAndIndexSingleCategory({
        credentials,
        domain,
        category: cat,
        priority: 'user',
        signal,
        telemetryEvents,
        fullCatalogReference,
      });
      roundCache.set(cat.categoryId, res.bundle);
      categoryIntegrity.push(res.integrity);
      indexDurationTotalMs += res.indexDurationMs + res.viewMaterializeDurationMs;
      recordsReceivedTotal += res.integrity.receivedCount;
      duplicateRecordsTotal += res.integrity.duplicateIdCount;
      for (const item of res.bundle.items) {
        const id = extractItemId(item, domain);
        if (id) allLoadedUniqueIds.add(id);
      }
      otherCategoryAccessSteps.push({
        slotId: cat.slotId,
        role: 'other_category',
        source: 'network_on_demand',
        durationMs: roundMs(res.stepDurationMs),
        fetchDurationMs: roundMs(res.fetchDurationMs),
        parseDurationMs: roundMs(res.parseDurationMs),
        indexDurationMs: roundMs(res.indexDurationMs),
        viewMaterializeDurationMs: roundMs(res.viewMaterializeDurationMs),
        recordsInView: res.bundle.viewCount,
      });
      heap.sample();
    }

    // Reutilização da 1ª categoria a partir do cache local da rodada
    if (firstCat) {
      checkAbort(signal);
      onProgress?.('reuse_category', 'Estratégia B: medindo reutilização da 1ª categoria...');
      const reuseStart = nowMs();
      const cached = roundCache.get(firstCat.categoryId);
      if (cached) {
        materializeCategoryView(domain, cached.index, firstCat.categoryId);
      }
      reuseCategoryAccessMs = roundMs(nowMs() - reuseStart);
    }

    const journeyTotalMs = roundMs(nowMs() - strategyStartMs);
    const agg = aggregateTelemetryEvents(telemetryEvents);
    const domainCoverageVsFullPercent =
      fullCatalogReference && fullCatalogReference.totalUniqueIds > 0
        ? roundMs((allLoadedUniqueIds.size / fullCatalogReference.totalUniqueIds) * 100)
        : null;

    return {
      strategy: 'B',
      strategyLabel: STRATEGY_LABELS_PT.B,
      domain,
      repetitionIndex,
      status: 'completed',
      categoriesFetchMs,
      categoriesCount,
      firstCategoryReadyWithIndexMs,
      otherCategoryAccessSteps,
      reuseCategoryAccessMs,
      journeyTotalMs,
      fullCatalogCoverageMs: null,
      queryDurationTotalMs: agg.queryDurationTotalMs,
      coordinatorWaitTotalMs: agg.coordinatorWaitTotalMs,
      fetchDurationTotalMs: agg.fetchDurationTotalMs,
      parseDurationTotalMs: agg.parseDurationTotalMs,
      indexDurationTotalMs: roundMs(indexDurationTotalMs),
      prefetchBackgroundDurationMs: null,
      requestCount: agg.requestCount,
      attemptCount: agg.attemptCount,
      retryCount: agg.retryCount,
      rateLimitHitCount: agg.rateLimitHitCount,
      rateLimitWaitMs: agg.rateLimitWaitMs,
      recordsReceivedTotal,
      uniqueRecordsTotal: allLoadedUniqueIds.size,
      duplicateRecordsTotal,
      domainCoverageVsFullPercent,
      network: agg.network,
      jsHeapMb: heap.finish(),
      categoryIntegrity,
      overallFilterCompliance: summarizeOverallCompliance(categoryIntegrity),
    };
  } catch (err: any) {
    const cancelled = isAbortErrorLike(err, signal);
    const agg = aggregateTelemetryEvents(telemetryEvents);
    return {
      strategy: 'B',
      strategyLabel: STRATEGY_LABELS_PT.B,
      domain,
      repetitionIndex,
      status: cancelled ? 'cancelled' : 'error',
      errorMessage: cancelled
        ? 'Comparação cancelada pelo usuário.'
        : String(err?.message || 'Erro ao executar a Estratégia B.'),
      errorCategory: err?.errorCategory,
      categoriesFetchMs,
      categoriesCount,
      firstCategoryReadyWithIndexMs,
      otherCategoryAccessSteps,
      reuseCategoryAccessMs,
      journeyTotalMs: roundMs(nowMs() - strategyStartMs),
      fullCatalogCoverageMs: null,
      queryDurationTotalMs: agg.queryDurationTotalMs,
      coordinatorWaitTotalMs: agg.coordinatorWaitTotalMs,
      fetchDurationTotalMs: agg.fetchDurationTotalMs,
      parseDurationTotalMs: agg.parseDurationTotalMs,
      indexDurationTotalMs: roundMs(indexDurationTotalMs),
      prefetchBackgroundDurationMs: null,
      requestCount: agg.requestCount,
      attemptCount: agg.attemptCount,
      retryCount: agg.retryCount,
      rateLimitHitCount: agg.rateLimitHitCount,
      rateLimitWaitMs: agg.rateLimitWaitMs,
      recordsReceivedTotal,
      uniqueRecordsTotal: allLoadedUniqueIds.size,
      duplicateRecordsTotal,
      domainCoverageVsFullPercent: null,
      network: agg.network,
      jsHeapMb: heap.finish(),
      categoryIntegrity,
      overallFilterCompliance: summarizeOverallCompliance(categoryIntegrity),
    };
  }
}

async function executeStrategyC(params: {
  credentials: XtreamCredentials;
  domain: BenchmarkDomain;
  categories: SelectedBenchmarkCategory[];
  repetitionIndex: number;
  fullCatalogReference?: FullCatalogReference | null;
  signal?: AbortSignal;
  onProgress?: (phase: string, messagePt: string) => void;
}): Promise<StrategyRunMetrics> {
  const {
    credentials,
    domain,
    categories,
    repetitionIndex,
    fullCatalogReference,
    signal,
    onProgress,
  } = params;
  const telemetryEvents: XtreamRequestTelemetry[] = [];
  const heap = createHeapTracker();
  const strategyStartMs = nowMs();
  const roundCache = new Map<string, CachedCategoryBundle>();
  const allLoadedUniqueIds = new Set<string>();
  const categoryIntegrity: CategoryIntegrityCheck[] = [];
  const otherCategoryAccessSteps: CategoryAccessStepMetric[] = [];

  let categoriesFetchMs: number | null = null;
  let categoriesCount = 0;
  let firstCategoryReadyWithIndexMs: number | null = null;
  let reuseCategoryAccessMs: number | null = null;
  let prefetchBackgroundDurationMs: number | null = null;
  let indexDurationTotalMs = 0;
  let recordsReceivedTotal = 0;
  let duplicateRecordsTotal = 0;

  try {
    checkAbort(signal);
    onProgress?.('categories', 'Estratégia C: consultando categorias do domínio...');
    const catStart = nowMs();
    const fetchedCategories = await fetchDomainCategories(
      credentials,
      domain,
      signal,
      (ev) => telemetryEvents.push(ev)
    );
    categoriesFetchMs = roundMs(nowMs() - catStart);
    categoriesCount = fetchedCategories.length;
    heap.sample();

    const firstCat = categories[0];
    if (firstCat) {
      checkAbort(signal);
      onProgress?.(
        'first_category',
        'Estratégia C: carregando prioritariamente a 1ª categoria...'
      );
      const firstResult = await loadAndIndexSingleCategory({
        credentials,
        domain,
        category: firstCat,
        priority: 'user',
        signal,
        telemetryEvents,
        fullCatalogReference,
      });
      roundCache.set(firstCat.categoryId, firstResult.bundle);
      categoryIntegrity.push(firstResult.integrity);
      indexDurationTotalMs +=
        firstResult.indexDurationMs + firstResult.viewMaterializeDurationMs;
      recordsReceivedTotal += firstResult.integrity.receivedCount;
      duplicateRecordsTotal += firstResult.integrity.duplicateIdCount;
      for (const item of firstResult.bundle.items) {
        const id = extractItemId(item, domain);
        if (id) allLoadedUniqueIds.add(id);
      }
      // Tempo da 1ª categoria registrada ANTES de iniciar o prefetch limitado
      firstCategoryReadyWithIndexMs = roundMs(nowMs() - strategyStartMs);
      heap.sample();
    }

    // Prefetch limitado de exatamente UMA próxima categoria (cat_2) após disponibilizar cat_1
    const prefetchCat = categories[1];
    if (prefetchCat) {
      checkAbort(signal);
      onProgress?.(
        'limited_prefetch',
        'Estratégia C: executando prefetch limitado da próxima categoria (1 categoria)...'
      );
      const prefetchRes = await loadAndIndexSingleCategory({
        credentials,
        domain,
        category: prefetchCat,
        priority: 'background',
        signal,
        telemetryEvents,
        fullCatalogReference,
      });
      roundCache.set(prefetchCat.categoryId, prefetchRes.bundle);
      categoryIntegrity.push(prefetchRes.integrity);
      prefetchBackgroundDurationMs = roundMs(prefetchRes.stepDurationMs);
      indexDurationTotalMs +=
        prefetchRes.indexDurationMs + prefetchRes.viewMaterializeDurationMs;
      recordsReceivedTotal += prefetchRes.integrity.receivedCount;
      duplicateRecordsTotal += prefetchRes.integrity.duplicateIdCount;
      for (const item of prefetchRes.bundle.items) {
        const id = extractItemId(item, domain);
        if (id) allLoadedUniqueIds.add(id);
      }
      heap.sample();

      // Acesso à 2ª categoria já pré-carregada
      checkAbort(signal);
      onProgress?.(
        'other_category',
        'Estratégia C: medindo acesso à 2ª categoria já pré-carregada...'
      );
      const accessStart = nowMs();
      const cached = roundCache.get(prefetchCat.categoryId);
      const viewCount = cached
        ? materializeCategoryView(domain, cached.index, prefetchCat.categoryId)
        : 0;
      const accessMs = nowMs() - accessStart;
      otherCategoryAccessSteps.push({
        slotId: prefetchCat.slotId,
        role: 'other_category',
        source: 'prefetch_cache',
        durationMs: roundMs(accessMs),
        fetchDurationMs: 0,
        parseDurationMs: 0,
        indexDurationMs: 0,
        viewMaterializeDurationMs: roundMs(accessMs),
        recordsInView: viewCount,
        backgroundPrefetchDurationMs: prefetchBackgroundDurationMs,
      });
    }

    // Demais categorias (ex.: cat_3) carregadas sob demanda, provando limite do prefetch a 1 categoria
    for (let i = 2; i < categories.length; i++) {
      checkAbort(signal);
      const cat = categories[i];
      onProgress?.(
        'other_category',
        `Estratégia C: carregando categoria ${i + 1}/${categories.length} sob demanda...`
      );
      const res = await loadAndIndexSingleCategory({
        credentials,
        domain,
        category: cat,
        priority: 'user',
        signal,
        telemetryEvents,
        fullCatalogReference,
      });
      roundCache.set(cat.categoryId, res.bundle);
      categoryIntegrity.push(res.integrity);
      indexDurationTotalMs += res.indexDurationMs + res.viewMaterializeDurationMs;
      recordsReceivedTotal += res.integrity.receivedCount;
      duplicateRecordsTotal += res.integrity.duplicateIdCount;
      for (const item of res.bundle.items) {
        const id = extractItemId(item, domain);
        if (id) allLoadedUniqueIds.add(id);
      }
      otherCategoryAccessSteps.push({
        slotId: cat.slotId,
        role: 'other_category',
        source: 'network_on_demand',
        durationMs: roundMs(res.stepDurationMs),
        fetchDurationMs: roundMs(res.fetchDurationMs),
        parseDurationMs: roundMs(res.parseDurationMs),
        indexDurationMs: roundMs(res.indexDurationMs),
        viewMaterializeDurationMs: roundMs(res.viewMaterializeDurationMs),
        recordsInView: res.bundle.viewCount,
      });
      heap.sample();
    }

    // Reutilização da 1ª categoria já disponível no cache da rodada
    if (firstCat) {
      checkAbort(signal);
      onProgress?.('reuse_category', 'Estratégia C: medindo reutilização da 1ª categoria...');
      const reuseStart = nowMs();
      const cached = roundCache.get(firstCat.categoryId);
      if (cached) {
        materializeCategoryView(domain, cached.index, firstCat.categoryId);
      }
      reuseCategoryAccessMs = roundMs(nowMs() - reuseStart);
    }

    const journeyTotalMs = roundMs(nowMs() - strategyStartMs);
    const agg = aggregateTelemetryEvents(telemetryEvents);
    const domainCoverageVsFullPercent =
      fullCatalogReference && fullCatalogReference.totalUniqueIds > 0
        ? roundMs((allLoadedUniqueIds.size / fullCatalogReference.totalUniqueIds) * 100)
        : null;

    return {
      strategy: 'C',
      strategyLabel: STRATEGY_LABELS_PT.C,
      domain,
      repetitionIndex,
      status: 'completed',
      categoriesFetchMs,
      categoriesCount,
      firstCategoryReadyWithIndexMs,
      otherCategoryAccessSteps,
      reuseCategoryAccessMs,
      journeyTotalMs,
      fullCatalogCoverageMs: null,
      queryDurationTotalMs: agg.queryDurationTotalMs,
      coordinatorWaitTotalMs: agg.coordinatorWaitTotalMs,
      fetchDurationTotalMs: agg.fetchDurationTotalMs,
      parseDurationTotalMs: agg.parseDurationTotalMs,
      indexDurationTotalMs: roundMs(indexDurationTotalMs),
      prefetchBackgroundDurationMs,
      requestCount: agg.requestCount,
      attemptCount: agg.attemptCount,
      retryCount: agg.retryCount,
      rateLimitHitCount: agg.rateLimitHitCount,
      rateLimitWaitMs: agg.rateLimitWaitMs,
      recordsReceivedTotal,
      uniqueRecordsTotal: allLoadedUniqueIds.size,
      duplicateRecordsTotal,
      domainCoverageVsFullPercent,
      network: agg.network,
      jsHeapMb: heap.finish(),
      categoryIntegrity,
      overallFilterCompliance: summarizeOverallCompliance(categoryIntegrity),
    };
  } catch (err: any) {
    const cancelled = isAbortErrorLike(err, signal);
    const agg = aggregateTelemetryEvents(telemetryEvents);
    return {
      strategy: 'C',
      strategyLabel: STRATEGY_LABELS_PT.C,
      domain,
      repetitionIndex,
      status: cancelled ? 'cancelled' : 'error',
      errorMessage: cancelled
        ? 'Comparação cancelada pelo usuário.'
        : String(err?.message || 'Erro ao executar a Estratégia C.'),
      errorCategory: err?.errorCategory,
      categoriesFetchMs,
      categoriesCount,
      firstCategoryReadyWithIndexMs,
      otherCategoryAccessSteps,
      reuseCategoryAccessMs,
      journeyTotalMs: roundMs(nowMs() - strategyStartMs),
      fullCatalogCoverageMs: null,
      queryDurationTotalMs: agg.queryDurationTotalMs,
      coordinatorWaitTotalMs: agg.coordinatorWaitTotalMs,
      fetchDurationTotalMs: agg.fetchDurationTotalMs,
      parseDurationTotalMs: agg.parseDurationTotalMs,
      indexDurationTotalMs: roundMs(indexDurationTotalMs),
      prefetchBackgroundDurationMs,
      requestCount: agg.requestCount,
      attemptCount: agg.attemptCount,
      retryCount: agg.retryCount,
      rateLimitHitCount: agg.rateLimitHitCount,
      rateLimitWaitMs: agg.rateLimitWaitMs,
      recordsReceivedTotal,
      uniqueRecordsTotal: allLoadedUniqueIds.size,
      duplicateRecordsTotal,
      domainCoverageVsFullPercent: null,
      network: agg.network,
      jsHeapMb: heap.finish(),
      categoryIntegrity,
      overallFilterCompliance: summarizeOverallCompliance(categoryIntegrity),
    };
  }
}

function buildStrategyAggregate(
  strategy: BenchmarkStrategyId,
  runs: StrategyRunMetrics[]
): StrategyDomainAggregate {
  const completed = runs.filter((r) => r.status === 'completed');
  const failed = runs.filter((r) => r.status === 'error');
  const cancelled = runs.filter((r) => r.status === 'cancelled');

  const otherStepDurations = completed.flatMap((r) =>
    r.otherCategoryAccessSteps.map((s) => s.durationMs)
  );
  const allIntegrityChecks = completed.flatMap((r) => r.categoryIntegrity);

  const avgOf = (vals: Array<number | null | undefined>): number | null => {
    const valid = vals.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (valid.length === 0) return null;
    return roundMs(valid.reduce((a, b) => a + b, 0) / valid.length);
  };

  return {
    strategy,
    strategyLabel: STRATEGY_LABELS_PT[strategy],
    completedRuns: completed.length,
    failedRuns: failed.length,
    cancelledRuns: cancelled.length,
    firstCategoryReadyWithIndexMs: summarizeMetricSamples(
      completed.map((r) => r.firstCategoryReadyWithIndexMs)
    ),
    otherCategoryAvgAccessMs: summarizeMetricSamples(otherStepDurations),
    reuseCategoryAccessMs: summarizeMetricSamples(
      completed.map((r) => r.reuseCategoryAccessMs)
    ),
    journeyTotalMs: summarizeMetricSamples(completed.map((r) => r.journeyTotalMs)),
    fullCatalogCoverageMs: summarizeMetricSamples(
      completed.map((r) => r.fullCatalogCoverageMs)
    ),
    queryDurationTotalMs: summarizeMetricSamples(
      completed.map((r) => r.queryDurationTotalMs)
    ),
    indexDurationTotalMs: summarizeMetricSamples(
      completed.map((r) => r.indexDurationTotalMs)
    ),
    requestCountAvg: avgOf(completed.map((r) => r.requestCount)),
    retryCountTotal: runs.reduce((acc, r) => acc + r.retryCount, 0),
    rateLimitHitTotal: runs.reduce((acc, r) => acc + r.rateLimitHitCount, 0),
    uniqueRecordsAvg: avgOf(completed.map((r) => r.uniqueRecordsTotal)),
    payloadTextCharsAvg: avgOf(completed.map((r) => r.network.payloadTextCharsTotal)),
    transferSizeBytesAvg: avgOf(completed.map((r) => r.network.transferSizeBytesTotal)),
    domainCoverageVsFullPercentAvg: avgOf(
      completed.map((r) => r.domainCoverageVsFullPercent)
    ),
    overallFilterCompliance: summarizeOverallCompliance(allIntegrityChecks),
    runs,
  };
}

function buildFilterDiagnosisSummaryPt(
  status: CategoryFilterComplianceStatus,
  anyOutOfCategory: boolean,
  anyDuplicates: boolean,
  anyMissingVsFull: boolean
): string {
  switch (status) {
    case 'ignored_full_catalog':
      return 'CRÍTICO: o provedor ignorou category_id e devolveu praticamente o catálogo completo em consulta filtrada. Estratégias por categoria multiplicariam tráfego e memória.';
    case 'empty_mismatch':
      return 'ATENÇÃO: consulta filtrada por category_id retornou lista vazia para categoria que possui itens no catálogo completo.';
    case 'partial_or_mixed':
      return 'PARCIAL: o provedor retornou itens fora da categoria solicitada junto com itens válidos' +
        (anyDuplicates ? ' e registros duplicados.' : '.');
    case 'empty_consistent':
      return 'Categorias testadas vazias tanto na consulta filtrada quanto no catálogo completo; selecionar categorias povoadas para validação conclusiva.';
    case 'respected': {
      const notes: string[] = ['O provedor respeitou category_id nas categorias testadas'];
      if (anyDuplicates) notes.push('com duplicados detectados na resposta');
      if (anyMissingVsFull) {
        notes.push('porém com diferença de cobertura em relação ao catálogo completo');
      }
      if (!anyOutOfCategory && !anyDuplicates && !anyMissingVsFull) {
        notes.push('sem registros fora de categoria ou perdas frente ao catálogo completo');
      }
      return `${notes.join(', ')}.`;
    }
    default:
      return 'Filtro category_id não avaliado (somente Estratégia A executada ou execução interrompida).';
  }
}

/**
 * Executa a comparação sequencial das estratégias (A -> B -> C) para um único domínio,
 * reutilizando XtreamService, o coordenador X02 e os índices cooperativos existentes.
 */
export async function runDomainCatalogComparison(
  options: RunDomainComparisonOptions
): Promise<DomainBenchmarkResult> {
  const {
    credentials,
    domain,
    selectedCategories,
    strategies = ['A', 'B', 'C'],
    repetitions = 1,
    signal,
    onProgress,
  } = options;

  const safeReps = Math.max(1, Math.min(25, Math.floor(repetitions || 1)));
  const normalizedCategories: SelectedBenchmarkCategory[] = selectedCategories.map(
    (c, idx) => ({
      slotId: c.slotId || `cat_${idx + 1}`,
      categoryId: String(c.categoryId),
      listPosition: c.listPosition,
    })
  );

  const runsByStrategy: Record<BenchmarkStrategyId, StrategyRunMetrics[]> = {
    A: [],
    B: [],
    C: [],
  };

  let fullCatalogReference: FullCatalogReference | null = null;
  let totalCategoriesAvailable = 0;

  const emit = (
    phase: string,
    messagePt: string,
    strategy?: BenchmarkStrategyId,
    repetition?: number
  ) => {
    onProgress?.({
      domain,
      strategy,
      repetition,
      totalRepetitions: safeReps,
      phase,
      messagePt,
      timestampIso: new Date().toISOString(),
    });
  };

  for (let rep = 1; rep <= safeReps; rep++) {
    if (signal?.aborted) break;

    for (const strategy of strategies) {
      if (signal?.aborted) break;
      emit(
        'strategy_start',
        `[${DOMAIN_LABELS_PT[domain]}] Rodada ${rep}/${safeReps} — iniciando ${STRATEGY_LABELS_PT[strategy]}...`,
        strategy,
        rep
      );

      if (strategy === 'A') {
        const res = await executeStrategyA({
          credentials,
          domain,
          categories: normalizedCategories,
          repetitionIndex: rep,
          signal,
          onProgress: (phase, msg) => emit(phase, `[${DOMAIN_LABELS_PT[domain]}] ${msg}`, 'A', rep),
        });
        runsByStrategy.A.push(res.metrics);
        if (res.reference && !fullCatalogReference) {
          fullCatalogReference = res.reference;
        }
        if (res.metrics.categoriesCount > totalCategoriesAvailable) {
          totalCategoriesAvailable = res.metrics.categoriesCount;
        }
        if (res.metrics.status === 'cancelled') break;
      } else if (strategy === 'B') {
        const res = await executeStrategyB({
          credentials,
          domain,
          categories: normalizedCategories,
          repetitionIndex: rep,
          fullCatalogReference,
          signal,
          onProgress: (phase, msg) => emit(phase, `[${DOMAIN_LABELS_PT[domain]}] ${msg}`, 'B', rep),
        });
        runsByStrategy.B.push(res);
        if (res.categoriesCount > totalCategoriesAvailable) {
          totalCategoriesAvailable = res.categoriesCount;
        }
        if (res.status === 'cancelled') break;
      } else if (strategy === 'C') {
        const res = await executeStrategyC({
          credentials,
          domain,
          categories: normalizedCategories,
          repetitionIndex: rep,
          fullCatalogReference,
          signal,
          onProgress: (phase, msg) => emit(phase, `[${DOMAIN_LABELS_PT[domain]}] ${msg}`, 'C', rep),
        });
        runsByStrategy.C.push(res);
        if (res.categoriesCount > totalCategoriesAvailable) {
          totalCategoriesAvailable = res.categoriesCount;
        }
        if (res.status === 'cancelled') break;
      }
    }
  }

  const aggA = buildStrategyAggregate('A', runsByStrategy.A);
  const aggB = buildStrategyAggregate('B', runsByStrategy.B);
  const aggC = buildStrategyAggregate('C', runsByStrategy.C);

  const allFilteredChecks = [
    ...runsByStrategy.B.flatMap((r) => r.categoryIntegrity),
    ...runsByStrategy.C.flatMap((r) => r.categoryIntegrity),
  ];
  const diagStatus = summarizeOverallCompliance(allFilteredChecks);
  const anyProviderIgnoredFilter = allFilteredChecks.some(
    (c) => c.compliance === 'ignored_full_catalog'
  );
  const anyOutOfCategoryRecords = allFilteredChecks.some((c) => c.outOfCategoryCount > 0);
  const anyDuplicatesDetected =
    allFilteredChecks.some((c) => c.duplicateIdCount > 0) ||
    (fullCatalogReference ? fullCatalogReference.duplicateIds > 0 : false);
  const anyMissingRecordsVsFull = allFilteredChecks.some(
    (c) =>
      c.vsFullCatalog.missingComparedToFull !== null &&
      c.vsFullCatalog.missingComparedToFull > 0
  );

  emit(
    'domain_done',
    `[${DOMAIN_LABELS_PT[domain]}] Comparação concluída.`,
    undefined,
    safeReps
  );

  return {
    domain,
    domainLabel: DOMAIN_LABELS_PT[domain],
    totalCategoriesAvailable,
    selectedCategorySlots: normalizedCategories.map((c) => ({
      slotId: c.slotId,
      listPosition: c.listPosition,
    })),
    repetitionsRequested: safeReps,
    fullCatalogReferenceAvailable: fullCatalogReference !== null,
    fullCatalogUniqueCount: fullCatalogReference?.totalUniqueIds ?? null,
    fullCatalogReceivedCount: fullCatalogReference?.totalReceived ?? null,
    fullCatalogDuplicateCount: fullCatalogReference?.duplicateIds ?? null,
    strategies: {
      A: aggA,
      B: aggB,
      C: aggC,
    },
    providerFilterDiagnosis: {
      status: diagStatus,
      summaryPt: buildFilterDiagnosisSummaryPt(
        diagStatus,
        anyOutOfCategoryRecords,
        anyDuplicatesDetected,
        anyMissingRecordsVsFull
      ),
      anyProviderIgnoredFilter,
      anyOutOfCategoryRecords,
      anyDuplicatesDetected,
      anyMissingRecordsVsFull,
    },
  };
}

export function buildSanitizedBenchmarkReport(params: {
  domains: DomainBenchmarkResult[];
  strategiesCompared: BenchmarkStrategyId[];
  repetitionsPerDomain: number;
  environment?: BenchmarkEnvironmentInfo;
}): SanitizedBenchmarkReport {
  return {
    schemaVersion: 'nc-c01-catalog-benchmark/v1',
    generatedAtIso: new Date().toISOString(),
    disclaimerPt:
      'Relatório sanitizado da ferramenta diagnóstica C01 (North Code Play). Não contém credenciais, URLs, tokens, respostas brutas, títulos ou identificadores individuais de conteúdos/categorias.',
    environment: params.environment ?? detectBenchmarkEnvironment(),
    methodology: {
      executionMode: 'sequential_same_account_no_video',
      strategiesCompared: params.strategiesCompared,
      repetitionsPerDomain: params.repetitionsPerDomain,
      p95MinSamplesRequired: MIN_SAMPLES_FOR_P95,
      cacheCaveatPt:
        'Caches locais da rodada são isolados por estratégia; porém caches HTTP do navegador, proxies ou cache do próprio provedor não podem ser purgados programaticamente e podem influenciar rodadas subsequentes.',
      timingScopeCaveatPt:
        'Os tempos coletados medem preparação de dados (consulta HTTP, parse JSON, construção de índice cooperativo e materialização da categoria), não o tempo ponta a ponta de login até renderização e interação no aplicativo comercial.',
    },
    domains: params.domains,
    functionalDependenciesMatrix: buildFunctionalDependenciesMatrix(),
  };
}

/**
 * Verificação de segurança antes de copiar ou exportar o relatório:
 * garante que nenhum dado sensível da conta ativa (usuário, senha, URL ou host do provedor)
 * vazou acidentalmente no texto sanitizado.
 */
export function assertReportSanitized(
  serializedReport: string,
  credentials?: XtreamCredentials | null
): { safe: boolean; leakedTokens: string[] } {
  const leakedLabels: string[] = [];
  if (!credentials) {
    return { safe: true, leakedTokens: [] };
  }

  const lower = serializedReport.toLowerCase();
  const checkSensitive = (value: string | undefined, label: string) => {
    if (!value) return;
    const trimmed = value.trim();
    if (trimmed.length < 3) return;
    if (lower.includes(trimmed.toLowerCase())) {
      leakedLabels.push(label);
    }
  };

  checkSensitive(credentials.username, 'username');
  checkSensitive(credentials.password, 'password');
  checkSensitive(credentials.serverUrl, 'serverUrl');

  if (credentials.serverUrl) {
    try {
      const parsed = new URL(
        /^https?:\/\//i.test(credentials.serverUrl)
          ? credentials.serverUrl
          : `http://${credentials.serverUrl}`
      );
      if (parsed.hostname && parsed.hostname.length >= 4 && parsed.hostname !== 'localhost') {
        checkSensitive(parsed.hostname, 'provider_hostname');
      }
    } catch {
      // Ignora URL malformada
    }
  }

  return {
    safe: leakedLabels.length === 0,
    leakedTokens: leakedLabels,
  };
}

function fmtNum(val: number | null | undefined, suffix = ''): string {
  if (val === null || val === undefined || !Number.isFinite(val)) {
    return 'Indisponível';
  }
  return `${val.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}${suffix}`;
}

export function formatSanitizedReportMarkdown(report: SanitizedBenchmarkReport): string {
  const lines: string[] = [];
  lines.push('# Relatório Diagnóstico C01 — Comparação de Estratégias de Catálogo');
  lines.push('');
  lines.push(`- **Gerado em:** ${report.generatedAtIso}`);
  lines.push(`- **Ambiente:** ${report.environment.runtimeKind} (${report.environment.viewportClass})`);
  lines.push(
    `- **Plugin Android CatalogFileTransfer disponível:** ${report.environment.androidCatalogFileTransferAvailable ? 'Sim' : 'Não'}`
  );
  lines.push(
    `- **Memória JS (\`performance.memory\`):** ${report.environment.memoryApiAvailable ? 'Disponível' : 'Indisponível neste navegador'}`
  );
  lines.push(`- **Repetições por domínio:** ${report.methodology.repetitionsPerDomain}`);
  lines.push('');
  lines.push(`> ${report.disclaimerPt}`);
  lines.push('');
  lines.push('## Ressalvas Metodológicas');
  lines.push(`- **Escopo de tempo:** ${report.methodology.timingScopeCaveatPt}`);
  lines.push(`- **Caches:** ${report.methodology.cacheCaveatPt}`);
  lines.push(
    `- **Transporte Android:** ${report.environment.transportArchitectureNotes.androidFullCatalog} ${report.environment.transportArchitectureNotes.androidFilteredCatalog} ${report.environment.transportArchitectureNotes.extrapolationWarning}`
  );
  lines.push('');

  for (const dom of report.domains) {
    lines.push(`## Domínio: ${dom.domainLabel}`);
    lines.push(
      `- Categorias disponíveis no domínio: ${dom.totalCategoriesAvailable} | Categorias representativas testadas: ${dom.selectedCategorySlots.map((s) => `${s.slotId} (#${s.listPosition})`).join(', ')}`
    );
    lines.push(
      `- Referência de catálogo completo (Estratégia A): ${dom.fullCatalogReferenceAvailable ? `${dom.fullCatalogUniqueCount} registros únicos (${dom.fullCatalogReceivedCount} recebidos, ${dom.fullCatalogDuplicateCount} duplicados)` : 'Não executada'}`
    );
    lines.push(`- **Diagnóstico de filtro \`category_id\`:** ${dom.providerFilterDiagnosis.summaryPt}`);
    lines.push('');
    lines.push(
      '| Estratégia | 1ª cat. pronta (ms) | Outras cat. média (ms) | Reuso 1ª cat. (ms) | Percurso total (ms) | Cobertura completa (ms) | Req. / Retent. | Registros únicos | Payload texto (chars) | Transferência rede (bytes) | Cobertura vs A (%) |'
    );
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');

    for (const sid of ['A', 'B', 'C'] as BenchmarkStrategyId[]) {
      const s = dom.strategies[sid];
      if (!s || (s.completedRuns === 0 && s.failedRuns === 0 && s.cancelledRuns === 0)) {
        continue;
      }
      lines.push(
        `| ${s.strategyLabel} | ${fmtNum(s.firstCategoryReadyWithIndexMs.median)} | ${fmtNum(s.otherCategoryAvgAccessMs.median)} | ${fmtNum(s.reuseCategoryAccessMs.median)} | ${fmtNum(s.journeyTotalMs.median)} | ${fmtNum(s.fullCatalogCoverageMs.median)} | ${fmtNum(s.requestCountAvg)} / ${s.retryCountTotal} | ${fmtNum(s.uniqueRecordsAvg)} | ${fmtNum(s.payloadTextCharsAvg)} | ${fmtNum(s.transferSizeBytesAvg)} | ${fmtNum(s.domainCoverageVsFullPercentAvg, '%')} |`
      );
    }
    lines.push('');
  }

  lines.push('## Impacto nas Funcionalidades Comerciais');
  lines.push('| Funcionalidade | Estratégia A | Estratégia B | Estratégia C |');
  lines.push('| --- | --- | --- | --- |');
  for (const dep of report.functionalDependenciesMatrix) {
    lines.push(
      `| ${dep.feature} | ${dep.strategyA} | ${dep.strategyB} | ${dep.strategyC} |`
    );
  }
  lines.push('');

  return lines.join('\n');
}
