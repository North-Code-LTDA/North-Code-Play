import type {
  Category,
  LiveStream,
  SeriesStream,
  VodStream,
  XtreamCredentials,
} from '../src/types';
import {
  XtreamService,
  type XtreamErrorCategory,
  type XtreamRequestTelemetry,
} from '../src/services/xtreamService';
import {
  isAndroidTempFileCatalogTransportAvailable,
  isUsingCapacitorNativeTransport,
  type TransportKind,
} from '../src/services/httpTransport';
import {
  getXtreamCoordinatorActivitySnapshot,
  type XtreamCoordinatorActivitySnapshot,
} from '../src/services/xtreamRequestCoordinator';
import {
  buildLiveIndexAsync,
  buildSeriesIndexAsync,
  buildVodIndexAsync,
  type LiveCatalogIndex,
  type RankedCatalogIndex,
} from '../src/utils/catalogIndex';

export type BenchmarkDomain = 'live' | 'vod' | 'series';
export type BenchmarkStrategyId = 'A' | 'B' | 'C';
export type MeasurementCompleteness = 'complete' | 'partial' | 'unavailable';
export type ExecutionOverallStatus = 'completed' | 'partial' | 'cancelled' | 'failed';
export type CoverageComparisonStatus =
  | 'available'
  | 'unavailable_no_full_reference';

export type SanitizedErrorCategory = XtreamErrorCategory | 'unknown_error';

const ALLOWED_ERROR_CATEGORIES: ReadonlySet<string> = new Set<SanitizedErrorCategory>([
  'http_unauthorized',
  'http_forbidden',
  'http_timeout',
  'http_rate_limited',
  'http_server_error',
  'http_client_error',
  'network',
  'timeout',
  'aborted',
  'invalid_format',
  'empty_response',
  'local_file_read',
  'auth_rejected',
  'ambiguous_auth_response',
  'unknown_error',
]);

export const ERROR_CATEGORY_DESCRIPTIONS_PT: Record<SanitizedErrorCategory, string> = {
  http_unauthorized: 'Acesso recusado pelo provedor (HTTP 401).',
  http_forbidden: 'Acesso proibido pelo provedor (HTTP 403).',
  http_timeout: 'Tempo limite HTTP no servidor do provedor (HTTP 408).',
  http_rate_limited: 'Limite de requisições atingido no provedor (HTTP 429).',
  http_server_error: 'Erro temporário no servidor do provedor (HTTP 5xx).',
  http_client_error: 'Requisição rejeitada pelo provedor (HTTP 4xx).',
  network: 'Falha de rede ou bloqueio CORS na comunicação com o provedor.',
  timeout: 'Tempo limite esgotado ao aguardar resposta do provedor.',
  aborted: 'Operação cancelada pelo usuário.',
  invalid_format: 'Resposta do provedor em formato JSON inválido.',
  empty_response: 'Resposta vazia recebida do provedor.',
  local_file_read: 'Falha ao ler arquivo temporário local no transporte Android.',
  auth_rejected: 'Autenticação rejeitada pelo provedor.',
  ambiguous_auth_response: 'Resposta de autenticação ambígua ou incompleta.',
  unknown_error: 'Erro técnico não categorizado durante a consulta.',
};

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

const JS_HEAP_SAMPLING_CAVEAT_PT =
  'Amostras pontuais de heap JavaScript (performance.memory.usedJSHeapSize), sujeitas à atuação assíncrona do garbage collector; não representam pico absoluto de memória nem consumo total de RAM do dispositivo.';

export interface SelectedBenchmarkCategory {
  /** Identificador anônimo usado exclusivamente no relatório sanitizado (ex.: "cat_1"). */
  slotId: string;
  /** ID real usado apenas em memória durante a chamada ao provedor (nunca exportado). */
  categoryId: string;
  /** Índice 1-based na lista original de categorias (somente contexto estrutural). */
  listPosition: number;
}

export interface BenchmarkIsolationCheck {
  canStartIsolated: boolean;
  activeMediaPlaybackCount: number;
  coordinatorActivity: XtreamCoordinatorActivitySnapshot;
  reasonsPt: string[];
}

export interface JsHeapSample {
  available: boolean;
  beforeStrategyMb: number | null;
  maxSampledDuringStrategyMb: number | null;
  afterStrategyBeforeAuditMb: number | null;
  afterAuditMb: number | null;
  strategyDeltaMb: number | null;
  auditDeltaMb: number | null;
  samplingCaveatPt: string;
}

export interface ObservableSumMetric {
  observedAttempts: number;
  missingAttempts: number;
  status: MeasurementCompleteness;
  /** Soma estrita apenas das tentativas observáveis (nunca apresentada como total confirmado se status === 'partial'). */
  observableSum: number | null;
}

export interface NetworkVolumeMetrics {
  totalAttempts: number;
  /** Comprimento do texto JSON descomprimido recebido em caracteres UTF-16 (sem re-serializar; distinto de bytes UTF-8 e bytes transferidos). */
  payloadTextChars: ObservableSumMetric;
  /** Bytes efetivamente transferidos na rede via Resource Timing (distinto de payload descomprimido). */
  transferSizeBytes: ObservableSumMetric;
  /** Bytes codificados/comprimidos via Resource Timing. */
  encodedBodySizeBytes: ObservableSumMetric;
  /** Bytes descomprimidos reportados via Resource Timing. */
  decodedBodySizeBytes: ObservableSumMetric;
  /** Valor do cabeçalho HTTP Content-Length quando exposto ao cliente. */
  contentLengthHeaderBytes: ObservableSumMetric;
  resourceTimingRestrictedAttempts: number;
  browserHttpCacheHitAttempts: number;
  /** Apenas sinais booleanos/numéricos de cabeçalhos de cache (nunca valores textuais livres). */
  cacheHeaderSignals: {
    anyCacheControlHeaderPresent: boolean;
    anyCacheableDirectiveObserved: boolean;
    anyNoCacheDirectiveObserved: boolean;
    maxObservedAgeSeconds: number | null;
    anyEtagPresent: boolean;
  };
  transportKindsUsed: TransportKind[];
}

export type CategoryAccessSource =
  | 'full_index'
  | 'full_index_cache'
  | 'network_on_demand'
  | 'prefetch_cache_hit'
  | 'prefetch_in_flight_wait'
  | 'round_local_cache';

export interface CategoryAccessStepMetric {
  slotId: string;
  role: 'first_category' | 'other_category' | 'reuse_category';
  source: CategoryAccessSource;
  /** Tempo efetivamente aguardado pelo usuário na troca/acesso (inclui espera restante se prefetch em andamento). */
  durationMs: number;
  transferAndReadMs: number;
  jsonParseMs: number;
  indexBuildMs: number;
  viewPreparationMs: number;
  recordsInView: number;
  /** Apenas para Estratégia C na categoria pré-carregada: duração total do trabalho de prefetch. */
  backgroundPrefetchDurationMs: number | null;
  /** Apenas para Estratégia C: true se o prefetch já havia encerrado antes do acesso. */
  prefetchCompletedBeforeAccess: boolean | null;
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
  intraResponseDuplicateCount: number;
  exactPrimaryCategoryMatchCount: number;
  secondaryCategoryIdsMatchCount: number;
  outOfCategoryCount: number;
  distinctCategoryIdsReturned: number;
  compliance: CategoryFilterComplianceStatus;
  vsFullCatalog: {
    status: CoverageComparisonStatus;
    fullCatalogCategoryUniqueCount: number | null;
    presentInReferenceCount: number | null;
    missingFromReferenceCount: number | null;
    additionalNotInReferenceCount: number | null;
    categoryCoveragePercent: number | null;
    shareOfFullDomainPercent: number | null;
  };
}

export interface StrategyRunMetrics {
  strategy: BenchmarkStrategyId;
  strategyLabel: string;
  domain: BenchmarkDomain;
  repetitionIndex: number;
  /** Posição efetiva (1..N) em que esta estratégia rodou nesta repetição. */
  executionOrderPosition: number;
  status: 'completed' | 'cancelled' | 'error';
  errorCategory: SanitizedErrorCategory | null;
  errorDescriptionPt: string | null;
  /** Consulta de categorias do domínio. */
  categoriesFetchMs: number | null;
  categoriesCount: number;
  /** Momento exato em que a 1ª categoria ficou pronta com índice + visão (sem overhead de auditoria). */
  firstCategoryReadyWithIndexMs: number | null;
  /** Acessos às demais categorias representativas selecionadas. */
  otherCategoryAccessSteps: CategoryAccessStepMetric[];
  /** Reutilização da 1ª categoria já carregada/indexada. */
  reuseCategoryAccessMs: number | null;
  /** Tempo total decorrido da estratégia comercial, excluindo auditoria diagnóstica posterior. */
  strategyElapsedExcludingAuditMs: number | null;
  /** Tempo adicional gasto exclusivamente na auditoria diagnóstica de integridade/cobertura. */
  integrityAuditOverheadMs: number;
  /** Tempo total real decorrido de parede (estratégia + auditoria). */
  wallClockTotalMs: number | null;
  /** Momento em que o catálogo completo + índice completo ficaram prontos (apenas Estratégia A; null em B/C). */
  fullCatalogCoverageMs: number | null;
  /** Durações discriminadas dos componentes de trabalho da estratégia. */
  timingBreakdown: {
    categoriesFetchMs: number | null;
    catalogTransferAndReadMs: number;
    jsonParseMs: number;
    indexBuildMs: number;
    viewPreparationMs: number;
    coordinatorWaitMs: number;
    prefetchWorkDurationMs: number | null;
    integrityAuditOverheadMs: number;
  };
  requestCount: number;
  attemptCount: number;
  retryCount: number;
  rateLimitHitCount: number;
  rateLimitWaitMs: number;
  recordsReceivedTotal: number;
  uniqueRecordsTotal: number;
  intraResponseDuplicateTotal: number;
  crossQueryRepeatedIdCount: number;
  multiCategoryLegitimateOverlapCount: number;
  unexpectedCrossQueryRepeatCount: number;
  coverageVsFullReference: {
    status: CoverageComparisonStatus;
    referenceSource: 'same_repetition' | 'earlier_repetition' | 'unavailable';
    presentInReferenceCount: number | null;
    missingFromReferenceCount: number | null;
    additionalNotInReferenceCount: number | null;
    /** Interseção real limitada estritamente a [0, 100]. */
    domainCoveragePercent: number | null;
  };
  network: NetworkVolumeMetrics;
  jsHeapMb: JsHeapSample;
  categoryIntegrity: CategoryIntegrityCheck[];
  overallFilterCompliance: CategoryFilterComplianceStatus;
}

export interface MetricAggregateSummary {
  samples: number;
  min: number | null;
  median: number | null;
  mean: number | null;
  max: number | null;
  /** P95 só é calculado com >= 20 amostras homogêneas; caso contrário permanece null. */
  p95: number | null;
  p95Available: boolean;
  homogeneousSamples: boolean;
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
  strategyElapsedExcludingAuditMs: MetricAggregateSummary;
  fullCatalogCoverageMs: MetricAggregateSummary;
  integrityAuditOverheadMs: MetricAggregateSummary;
  requestCountAvg: number | null;
  retryCountTotal: number;
  rateLimitHitTotal: number;
  uniqueRecordsAvg: number | null;
  payloadTextCharsStatus: MeasurementCompleteness;
  payloadTextCharsObservableAvg: number | null;
  transferSizeStatus: MeasurementCompleteness;
  transferSizeObservableBytesAvg: number | null;
  domainCoveragePercentAvg: number | null;
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
  domainStatus: ExecutionOverallStatus;
  totalCategoriesAvailable: number;
  selectedCategorySlots: Array<{
    slotId: string;
    listPosition: number;
  }>;
  repetitionsRequested: number;
  executionOrderByRepetition: Array<{
    repetitionIndex: number;
    order: BenchmarkStrategyId[];
  }>;
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
    anyAdditionalRecordsNotInReference: boolean;
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
  schemaVersion: 'nc-c01-catalog-benchmark/v2';
  generatedAtIso: string;
  executionStatus: ExecutionOverallStatus;
  executionSummaryPt: string;
  disclaimerPt: string;
  environment: BenchmarkEnvironmentInfo;
  methodology: {
    executionMode: 'sequential_same_account_no_video';
    strategiesCompared: BenchmarkStrategyId[];
    repetitionsPerDomain: number;
    strategyOrderRotationPolicyPt: string;
    p95MinHomogeneousSamplesRequired: number;
    cacheDistinctionPt: string;
    timingScopeCaveatPt: string;
    memoryCaveatPt: string;
    liveCatalogDriftCaveatPt: string;
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

interface DeferredCategoryAuditRecord {
  slotId: string;
  requestedCategoryId: string;
  receivedCount: number;
  uniqueIds: Set<string>;
  matchingUniqueIds: Set<string>;
  intraResponseDuplicateCount: number;
  exactPrimaryCategoryMatchCount: number;
  secondaryCategoryIdsMatchCount: number;
  outOfCategoryCount: number;
  distinctCategoryIdsReturned: number;
}

interface DeferredStrategyAuditPayload {
  run: StrategyRunMetrics;
  categoryRecords: DeferredCategoryAuditRecord[];
  allLoadedUniqueIds: Set<string>;
}

interface CachedCategoryBundle {
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

function sanitizeErrorCategory(raw: unknown): SanitizedErrorCategory {
  if (typeof raw === 'string' && ALLOWED_ERROR_CATEGORIES.has(raw)) {
    return raw as SanitizedErrorCategory;
  }
  return 'unknown_error';
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

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('Operação cancelada pelo usuário.');
    err.name = 'AbortError';
    (err as any).isAborted = true;
    (err as any).errorCategory = 'aborted';
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

/**
 * Verifica se o ambiente está isolado para iniciar uma comparação sem interferência
 * de reprodução simultânea ou operações comerciais pendentes no coordenador X02.
 * Nunca invalida a sessão global nem cancela consumidores comerciais.
 */
export function checkBenchmarkIsolationStatus(options?: {
  externalLoadingReasonsPt?: string[];
}): BenchmarkIsolationCheck {
  const coordinatorActivity = getXtreamCoordinatorActivitySnapshot();
  let activeMediaPlaybackCount = 0;

  if (typeof document !== 'undefined') {
    try {
      const mediaEls = document.querySelectorAll<HTMLMediaElement>('video, audio');
      mediaEls.forEach((el) => {
        if (!el.paused && !el.ended && el.readyState > 0) {
          activeMediaPlaybackCount++;
        }
      });
    } catch {
      // Ignora em ambientes sem DOM completo
    }
  }

  const reasonsPt: string[] = [];
  if (activeMediaPlaybackCount > 0) {
    reasonsPt.push(
      `Há ${activeMediaPlaybackCount} reprodução(ões) de mídia ativa(s). Pause ou encerre o player antes de iniciar a comparação.`
    );
  }
  if (coordinatorActivity.hasActiveOperations) {
    reasonsPt.push(
      `Existem operações comerciais em andamento no coordenador X02 (${coordinatorActivity.activeGlobal} ativa(s), ${coordinatorActivity.queuedSlots} na fila, ${coordinatorActivity.inFlightCount} em voo). Aguarde a conclusão para evitar interferência na medição.`
    );
  }
  if (options?.externalLoadingReasonsPt) {
    for (const reason of options.externalLoadingReasonsPt) {
      if (reason && !reasonsPt.includes(reason)) {
        reasonsPt.push(reason);
      }
    }
  }

  return {
    canStartIsolated: reasonsPt.length === 0,
    activeMediaPlaybackCount,
    coordinatorActivity,
    reasonsPt,
  };
}

/**
 * Rotaciona deterministicamente a ordem das estratégias a partir da 2ª repetição,
 * preservando A, B, C na 1ª rodada de triagem inicial.
 */
export function getStrategyOrderForRepetition(
  strategies: BenchmarkStrategyId[],
  repetitionIndex: number
): BenchmarkStrategyId[] {
  if (strategies.length <= 1 || repetitionIndex <= 1) {
    return [...strategies];
  }
  const shift = (repetitionIndex - 1) % strategies.length;
  return [...strategies.slice(shift), ...strategies.slice(0, shift)];
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
        'Na troca imediata, aguarda o restante do prefetch em andamento; só é instantânea se o prefetch já tiver terminado antes da troca.',
      riskNote:
        'Comparar tempo até 1ª categoria versus latência real na troca entre múltiplas categorias.',
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

function buildCompactCategoryAuditRecord(
  slotId: string,
  requestedCategoryId: string,
  items: any[],
  domain: BenchmarkDomain
): DeferredCategoryAuditRecord {
  const reqCatStr = String(requestedCategoryId);
  const uniqueIds = new Set<string>();
  const matchingUniqueIds = new Set<string>();
  const distinctCategories = new Set<string>();

  let receivedCount = 0;
  let intraResponseDuplicateCount = 0;
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
        intraResponseDuplicateCount++;
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

  return {
    slotId,
    requestedCategoryId: reqCatStr,
    receivedCount,
    uniqueIds,
    matchingUniqueIds,
    intraResponseDuplicateCount,
    exactPrimaryCategoryMatchCount,
    secondaryCategoryIdsMatchCount,
    outOfCategoryCount,
    distinctCategoryIdsReturned: distinctCategories.size,
  };
}

function evaluateCategoryAuditRecord(
  rec: DeferredCategoryAuditRecord,
  fullCatalogReference?: FullCatalogReference | null
): CategoryIntegrityCheck {
  let status: CoverageComparisonStatus = 'unavailable_no_full_reference';
  let fullCatalogCategoryUniqueCount: number | null = null;
  let presentInReferenceCount: number | null = null;
  let missingFromReferenceCount: number | null = null;
  let additionalNotInReferenceCount: number | null = null;
  let categoryCoveragePercent: number | null = null;
  let shareOfFullDomainPercent: number | null = null;

  if (fullCatalogReference) {
    status = 'available';
    const fullBucket =
      fullCatalogReference.categoryIdBuckets.get(rec.requestedCategoryId) ??
      new Set<string>();
    fullCatalogCategoryUniqueCount = fullBucket.size;

    let presentInBucket = 0;
    fullBucket.forEach((id) => {
      if (rec.uniqueIds.has(id)) presentInBucket++;
    });
    presentInReferenceCount = presentInBucket;
    missingFromReferenceCount = Math.max(0, fullBucket.size - presentInBucket);

    let additionalNotInBucket = 0;
    rec.matchingUniqueIds.forEach((id) => {
      if (!fullBucket.has(id)) additionalNotInBucket++;
    });
    additionalNotInReferenceCount = additionalNotInBucket;

    if (fullBucket.size > 0) {
      categoryCoveragePercent = Math.min(
        100,
        roundMs((presentInBucket / fullBucket.size) * 100)
      );
    }

    if (fullCatalogReference.totalUniqueIds > 0) {
      let presentInFullDomain = 0;
      rec.uniqueIds.forEach((id) => {
        if (fullCatalogReference.allUniqueIdSet.has(id)) presentInFullDomain++;
      });
      shareOfFullDomainPercent = Math.min(
        100,
        roundMs((presentInFullDomain / fullCatalogReference.totalUniqueIds) * 100)
      );
    }
  }

  let compliance: CategoryFilterComplianceStatus;
  if (rec.receivedCount === 0) {
    if (fullCatalogCategoryUniqueCount !== null && fullCatalogCategoryUniqueCount > 0) {
      compliance = 'empty_mismatch';
    } else {
      compliance = 'empty_consistent';
    }
  } else if (rec.outOfCategoryCount === 0) {
    compliance = 'respected';
  } else if (
    (fullCatalogReference &&
      fullCatalogReference.totalUniqueIds > 0 &&
      shareOfFullDomainPercent !== null &&
      shareOfFullDomainPercent >= 90 &&
      rec.distinctCategoryIdsReturned > 1) ||
    (rec.distinctCategoryIdsReturned >= 3 &&
      rec.outOfCategoryCount >
        rec.exactPrimaryCategoryMatchCount + rec.secondaryCategoryIdsMatchCount)
  ) {
    compliance = 'ignored_full_catalog';
  } else {
    compliance = 'partial_or_mixed';
  }

  return {
    slotId: rec.slotId,
    receivedCount: rec.receivedCount,
    uniqueIdCount: rec.uniqueIds.size,
    intraResponseDuplicateCount: rec.intraResponseDuplicateCount,
    exactPrimaryCategoryMatchCount: rec.exactPrimaryCategoryMatchCount,
    secondaryCategoryIdsMatchCount: rec.secondaryCategoryIdsMatchCount,
    outOfCategoryCount: rec.outOfCategoryCount,
    distinctCategoryIdsReturned: rec.distinctCategoryIdsReturned,
    compliance,
    vsFullCatalog: {
      status,
      fullCatalogCategoryUniqueCount,
      presentInReferenceCount,
      missingFromReferenceCount,
      additionalNotInReferenceCount,
      categoryCoveragePercent,
      shareOfFullDomainPercent,
    },
  };
}

/**
 * Avalia conformidade do filtro `category_id` usando interseção real de identificadores.
 */
export function analyzeCategoryFilterCompliance(params: {
  slotId: string;
  requestedCategoryId: string;
  items: any[];
  domain: BenchmarkDomain;
  fullCatalogReference?: FullCatalogReference | null;
}): CategoryIntegrityCheck {
  const rec = buildCompactCategoryAuditRecord(
    params.slotId,
    params.requestedCategoryId,
    params.items,
    params.domain
  );
  return evaluateCategoryAuditRecord(rec, params.fullCatalogReference);
}

function computeCrossQueryRepeats(records: DeferredCategoryAuditRecord[]): {
  crossQueryRepeatedIdCount: number;
  multiCategoryLegitimateOverlapCount: number;
  unexpectedCrossQueryRepeatCount: number;
} {
  const seenMatchingIds = new Set<string>();
  const seenAllIds = new Set<string>();
  let crossQueryRepeatedIdCount = 0;
  let multiCategoryLegitimateOverlapCount = 0;
  let unexpectedCrossQueryRepeatCount = 0;

  for (const rec of records) {
    rec.uniqueIds.forEach((id) => {
      const matchedHere = rec.matchingUniqueIds.has(id);
      if (seenAllIds.has(id)) {
        crossQueryRepeatedIdCount++;
        if (matchedHere && seenMatchingIds.has(id)) {
          multiCategoryLegitimateOverlapCount++;
        } else {
          unexpectedCrossQueryRepeatCount++;
        }
      } else {
        seenAllIds.add(id);
      }
      if (matchedHere) {
        seenMatchingIds.add(id);
      }
    });
  }

  return {
    crossQueryRepeatedIdCount,
    multiCategoryLegitimateOverlapCount,
    unexpectedCrossQueryRepeatCount,
  };
}

function reconcileDeferredAuditWithReference(
  payload: DeferredStrategyAuditPayload,
  fullCatalogReference: FullCatalogReference | null,
  referenceSource: 'same_repetition' | 'earlier_repetition' | 'unavailable'
): void {
  const { run, categoryRecords, allLoadedUniqueIds } = payload;

  const evaluated = categoryRecords.map((rec) =>
    evaluateCategoryAuditRecord(rec, fullCatalogReference)
  );
  run.categoryIntegrity = evaluated;
  run.overallFilterCompliance = summarizeOverallCompliance(evaluated);

  if (fullCatalogReference && fullCatalogReference.totalUniqueIds > 0) {
    let presentInRef = 0;
    let additionalNotInRef = 0;
    allLoadedUniqueIds.forEach((id) => {
      if (fullCatalogReference.allUniqueIdSet.has(id)) {
        presentInRef++;
      } else {
        additionalNotInRef++;
      }
    });
    const missingFromRef = Math.max(
      0,
      fullCatalogReference.totalUniqueIds - presentInRef
    );
    run.coverageVsFullReference = {
      status: 'available',
      referenceSource,
      presentInReferenceCount: presentInRef,
      missingFromReferenceCount: missingFromRef,
      additionalNotInReferenceCount: additionalNotInRef,
      domainCoveragePercent: Math.min(
        100,
        roundMs((presentInRef / fullCatalogReference.totalUniqueIds) * 100)
      ),
    };
  } else {
    run.coverageVsFullReference = {
      status: 'unavailable_no_full_reference',
      referenceSource: 'unavailable',
      presentInReferenceCount: null,
      missingFromReferenceCount: null,
      additionalNotInReferenceCount: null,
      domainCoveragePercent: null,
    };
  }
}

export function summarizeMetricSamples(
  values: Array<number | null | undefined>,
  homogeneousSamples: boolean = true
): MetricAggregateSummary {
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
      homogeneousSamples,
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

  // Nunca apresentar P95 representativo sem >= 20 amostras homogêneas.
  const p95Available = homogeneousSamples && valid.length >= MIN_SAMPLES_FOR_P95;
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
    homogeneousSamples,
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

function buildObservableSumMetric(
  observedAttempts: number,
  totalAttempts: number,
  sum: number
): ObservableSumMetric {
  const missingAttempts = Math.max(0, totalAttempts - observedAttempts);
  let status: MeasurementCompleteness;
  if (totalAttempts === 0 || observedAttempts === 0) {
    status = 'unavailable';
  } else if (missingAttempts === 0) {
    status = 'complete';
  } else {
    status = 'partial';
  }
  return {
    observedAttempts,
    missingAttempts,
    status,
    observableSum: observedAttempts > 0 ? sum : null,
  };
}

function aggregateTelemetryEvents(events: XtreamRequestTelemetry[]): {
  requestCount: number;
  attemptCount: number;
  retryCount: number;
  rateLimitHitCount: number;
  rateLimitWaitMs: number;
  coordinatorWaitMs: number;
  transferAndReadMs: number;
  jsonParseMs: number;
  network: NetworkVolumeMetrics;
} {
  const requestCount = events.length;
  let attemptCount = 0;
  let retryCount = 0;
  let rateLimitHitCount = 0;
  let rateLimitWaitMs = 0;
  let coordinatorWaitMs = 0;
  let transferAndReadMs = 0;
  let jsonParseMs = 0;

  let totalAttempts = 0;
  let payloadCharsObserved = 0;
  let payloadCharsSum = 0;
  let transferObserved = 0;
  let transferSum = 0;
  let encodedObserved = 0;
  let encodedSum = 0;
  let decodedObserved = 0;
  let decodedSum = 0;
  let contentLengthObserved = 0;
  let contentLengthSum = 0;
  let resourceTimingRestrictedAttempts = 0;
  let browserHttpCacheHitAttempts = 0;

  let anyCacheControlHeaderPresent = false;
  let anyCacheableDirectiveObserved = false;
  let anyNoCacheDirectiveObserved = false;
  let maxObservedAgeSeconds: number | null = null;
  let anyEtagPresent = false;
  const transportKinds = new Set<TransportKind>();

  for (const ev of events) {
    attemptCount += ev.attemptCount;
    retryCount += ev.retryCount;
    rateLimitHitCount += ev.rateLimitHitCount;
    rateLimitWaitMs += ev.rateLimitWaitMs;
    coordinatorWaitMs += ev.queueWaitMs + ev.rateLimitWaitMs;

    for (const att of ev.attempts) {
      totalAttempts++;
      transportKinds.add(att.transportKind);
      transferAndReadMs += att.fetchDurationMs;
      jsonParseMs += att.parseDurationMs;

      if (att.payloadTextChars !== null) {
        payloadCharsObserved++;
        payloadCharsSum += att.payloadTextChars;
      }
      if (att.transferSizeBytes !== null) {
        transferObserved++;
        transferSum += att.transferSizeBytes;
      }
      if (att.encodedBodySizeBytes !== null) {
        encodedObserved++;
        encodedSum += att.encodedBodySizeBytes;
      }
      if (att.decodedBodySizeBytes !== null) {
        decodedObserved++;
        decodedSum += att.decodedBodySizeBytes;
      }
      if (att.contentLengthHeaderBytes !== null) {
        contentLengthObserved++;
        contentLengthSum += att.contentLengthHeaderBytes;
      }
      if (att.resourceTimingRestrictedByCors) {
        resourceTimingRestrictedAttempts++;
      }
      if (att.fromBrowserHttpCache === true) {
        browserHttpCacheHitAttempts++;
      }
      if (att.cacheControl) {
        anyCacheControlHeaderPresent = true;
        const ccLower = att.cacheControl.toLowerCase();
        if (/\b(max-age=[1-9]\d*|s-maxage=[1-9]\d*|public|immutable)\b/.test(ccLower)) {
          anyCacheableDirectiveObserved = true;
        }
        if (/\b(no-store|no-cache|max-age=0|private)\b/.test(ccLower)) {
          anyNoCacheDirectiveObserved = true;
        }
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
    coordinatorWaitMs: roundMs(coordinatorWaitMs),
    transferAndReadMs: roundMs(transferAndReadMs),
    jsonParseMs: roundMs(jsonParseMs),
    network: {
      totalAttempts,
      payloadTextChars: buildObservableSumMetric(
        payloadCharsObserved,
        totalAttempts,
        payloadCharsSum
      ),
      transferSizeBytes: buildObservableSumMetric(
        transferObserved,
        totalAttempts,
        transferSum
      ),
      encodedBodySizeBytes: buildObservableSumMetric(
        encodedObserved,
        totalAttempts,
        encodedSum
      ),
      decodedBodySizeBytes: buildObservableSumMetric(
        decodedObserved,
        totalAttempts,
        decodedSum
      ),
      contentLengthHeaderBytes: buildObservableSumMetric(
        contentLengthObserved,
        totalAttempts,
        contentLengthSum
      ),
      resourceTimingRestrictedAttempts,
      browserHttpCacheHitAttempts,
      cacheHeaderSignals: {
        anyCacheControlHeaderPresent,
        anyCacheableDirectiveObserved,
        anyNoCacheDirectiveObserved,
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
    (err as any).errorCategory = 'aborted';
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
    return (index as LiveCatalogIndex<any>).getGroupsByCategory(categoryId).length;
  }
  return (index as RankedCatalogIndex<any>).getSortedByCategory(categoryId).length;
}

export async function loadCategoriesForSelection(
  credentials: XtreamCredentials,
  domain: BenchmarkDomain,
  signal?: AbortSignal
): Promise<Category[]> {
  return fetchDomainCategories(credentials, domain, signal);
}

export function pickDefaultRepresentativeCategories(
  categories: Category[],
  maxCount: number = 3
): SelectedBenchmarkCategory[] {
  if (!Array.isArray(categories) || categories.length === 0) return [];
  const valid = categories.filter(
    (c) =>
      c &&
      c.category_id !== undefined &&
      c.category_id !== null &&
      String(c.category_id).trim() !== ''
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
    chosenIndices.add(
      Math.max(1, Math.min(valid.length - 1, Math.floor((valid.length * 3) / 4)))
    );
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
  let maxSampledDuringStrategy = before;
  let afterStrategyBeforeAudit: number | null = null;

  const sampleStrategy = () => {
    if (!available) return;
    const current = readJsHeapUsedMb();
    if (
      current !== null &&
      (maxSampledDuringStrategy === null || current > maxSampledDuringStrategy)
    ) {
      maxSampledDuringStrategy = current;
    }
  };

  const markEndOfStrategyBeforeAudit = () => {
    if (!available) return;
    const current = readJsHeapUsedMb();
    afterStrategyBeforeAudit = current;
    if (
      current !== null &&
      (maxSampledDuringStrategy === null || current > maxSampledDuringStrategy)
    ) {
      maxSampledDuringStrategy = current;
    }
  };

  const finish = (): JsHeapSample => {
    if (!available) {
      return {
        available: false,
        beforeStrategyMb: null,
        maxSampledDuringStrategyMb: null,
        afterStrategyBeforeAuditMb: null,
        afterAuditMb: null,
        strategyDeltaMb: null,
        auditDeltaMb: null,
        samplingCaveatPt: JS_HEAP_SAMPLING_CAVEAT_PT,
      };
    }
    const afterAudit = readJsHeapUsedMb();
    const strategyEnd = afterStrategyBeforeAudit ?? afterAudit;
    return {
      available: true,
      beforeStrategyMb: before,
      maxSampledDuringStrategyMb: maxSampledDuringStrategy,
      afterStrategyBeforeAuditMb: strategyEnd,
      afterAuditMb: afterAudit,
      strategyDeltaMb:
        before !== null && strategyEnd !== null ? roundMs(strategyEnd - before) : null,
      auditDeltaMb:
        strategyEnd !== null && afterAudit !== null
          ? roundMs(afterAudit - strategyEnd)
          : null,
      samplingCaveatPt: JS_HEAP_SAMPLING_CAVEAT_PT,
    };
  };

  return { sampleStrategy, markEndOfStrategyBeforeAudit, finish };
}

function buildFullCatalogReferenceFromItems(
  fullItems: any[],
  domain: BenchmarkDomain
): FullCatalogReference {
  const allUniqueIdSet = new Set<string>();
  const categoryIdBuckets = new Map<string, Set<string>>();
  let totalReceived = 0;
  let duplicateIds = 0;

  for (let i = 0; i < fullItems.length; i++) {
    const item = fullItems[i] as any;
    if (!item || typeof item !== 'object') continue;
    totalReceived++;
    const itemId = extractItemId(item, domain);
    if (!itemId) continue;
    if (allUniqueIdSet.has(itemId)) {
      duplicateIds++;
    } else {
      allUniqueIdSet.add(itemId);
    }

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

  return {
    totalReceived,
    totalUniqueIds: allUniqueIdSet.size,
    duplicateIds,
    allUniqueIdSet,
    categoryIdBuckets,
  };
}

async function executeStrategyA(params: {
  credentials: XtreamCredentials;
  domain: BenchmarkDomain;
  categories: SelectedBenchmarkCategory[];
  repetitionIndex: number;
  executionOrderPosition: number;
  signal?: AbortSignal;
  onProgress?: (phase: string, messagePt: string) => void;
}): Promise<{ metrics: StrategyRunMetrics; reference: FullCatalogReference | null }> {
  const {
    credentials,
    domain,
    categories,
    repetitionIndex,
    executionOrderPosition,
    signal,
    onProgress,
  } = params;
  const telemetryEvents: XtreamRequestTelemetry[] = [];
  const heap = createHeapTracker();
  const strategyStartMs = nowMs();

  let categoriesFetchMs: number | null = null;
  let categoriesCount = 0;
  let firstCategoryReadyWithIndexMs: number | null = null;
  let fullCatalogCoverageMs: number | null = null;
  let reuseCategoryAccessMs: number | null = null;
  let indexBuildMs = 0;
  let viewPreparationMs = 0;
  let integrityAuditOverheadMs = 0;
  let strategyElapsedExcludingAuditMs: number | null = null;
  let recordsReceivedTotal = 0;
  let uniqueRecordsTotal = 0;
  let intraResponseDuplicateTotal = 0;
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
    heap.sampleStrategy();

    checkAbort(signal);
    onProgress?.('full_catalog', 'Estratégia A: consultando catálogo completo do domínio...');
    let fullItems: any[] | null = await fetchDomainItems(
      credentials,
      domain,
      undefined,
      'user',
      signal,
      (ev) => telemetryEvents.push(ev)
    );
    heap.sampleStrategy();

    checkAbort(signal);
    onProgress?.('index_build', 'Estratégia A: construindo índice local completo...');
    const idxStart = nowMs();
    const fullIndex = await buildDomainIndex(domain, fullItems, signal);
    indexBuildMs += nowMs() - idxStart;
    // Registra cobertura completa imediatamente quando catálogo + índice estão prontos (antes da auditoria).
    fullCatalogCoverageMs = roundMs(nowMs() - strategyStartMs);
    heap.sampleStrategy();

    // Acesso à 1ª categoria pelo índice — SEM executar auditoria de integridade antes deste marco!
    const firstCat = categories[0];
    if (firstCat) {
      checkAbort(signal);
      onProgress?.('first_category', 'Estratégia A: preparando visão da 1ª categoria pelo índice...');
      const viewStart = nowMs();
      materializeCategoryView(domain, fullIndex, firstCat.categoryId);
      viewPreparationMs += nowMs() - viewStart;
      firstCategoryReadyWithIndexMs = roundMs(nowMs() - strategyStartMs);
      heap.sampleStrategy();
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
      viewPreparationMs += stepMs;
      otherCategoryAccessSteps.push({
        slotId: cat.slotId,
        role: 'other_category',
        source: 'full_index',
        durationMs: roundMs(stepMs),
        transferAndReadMs: 0,
        jsonParseMs: 0,
        indexBuildMs: 0,
        viewPreparationMs: roundMs(stepMs),
        recordsInView: count,
        backgroundPrefetchDurationMs: null,
        prefetchCompletedBeforeAccess: null,
      });
      heap.sampleStrategy();
    }

    // Reutilização da 1ª categoria (cache interno do índice)
    if (firstCat) {
      checkAbort(signal);
      onProgress?.('reuse_category', 'Estratégia A: medindo reutilização da 1ª categoria...');
      const reuseStart = nowMs();
      materializeCategoryView(domain, fullIndex, firstCat.categoryId);
      reuseCategoryAccessMs = roundMs(nowMs() - reuseStart);
    }

    // Congela o tempo comercial da estratégia ANTES do trabalho de auditoria diagnóstica!
    strategyElapsedExcludingAuditMs = roundMs(nowMs() - strategyStartMs);
    heap.markEndOfStrategyBeforeAudit();

    // Auditoria diagnóstica separada: extrai referência de IDs e libera fullItems logo após.
    const auditStart = nowMs();
    reference = buildFullCatalogReferenceFromItems(fullItems, domain);
    recordsReceivedTotal = reference.totalReceived;
    uniqueRecordsTotal = reference.totalUniqueIds;
    intraResponseDuplicateTotal = reference.duplicateIds;
    fullItems = null;
    integrityAuditOverheadMs = roundMs(nowMs() - auditStart);

    const wallClockTotalMs = roundMs(nowMs() - strategyStartMs);
    const agg = aggregateTelemetryEvents(telemetryEvents);

    return {
      reference,
      metrics: {
        strategy: 'A',
        strategyLabel: STRATEGY_LABELS_PT.A,
        domain,
        repetitionIndex,
        executionOrderPosition,
        status: 'completed',
        errorCategory: null,
        errorDescriptionPt: null,
        categoriesFetchMs,
        categoriesCount,
        firstCategoryReadyWithIndexMs,
        otherCategoryAccessSteps,
        reuseCategoryAccessMs,
        strategyElapsedExcludingAuditMs,
        integrityAuditOverheadMs,
        wallClockTotalMs,
        fullCatalogCoverageMs,
        timingBreakdown: {
          categoriesFetchMs,
          catalogTransferAndReadMs: agg.transferAndReadMs,
          jsonParseMs: agg.jsonParseMs,
          indexBuildMs: roundMs(indexBuildMs),
          viewPreparationMs: roundMs(viewPreparationMs),
          coordinatorWaitMs: agg.coordinatorWaitMs,
          prefetchWorkDurationMs: null,
          integrityAuditOverheadMs,
        },
        requestCount: agg.requestCount,
        attemptCount: agg.attemptCount,
        retryCount: agg.retryCount,
        rateLimitHitCount: agg.rateLimitHitCount,
        rateLimitWaitMs: agg.rateLimitWaitMs,
        recordsReceivedTotal,
        uniqueRecordsTotal,
        intraResponseDuplicateTotal,
        crossQueryRepeatedIdCount: 0,
        multiCategoryLegitimateOverlapCount: 0,
        unexpectedCrossQueryRepeatCount: 0,
        coverageVsFullReference: {
          status: 'available',
          referenceSource: 'same_repetition',
          presentInReferenceCount: uniqueRecordsTotal,
          missingFromReferenceCount: 0,
          additionalNotInReferenceCount: 0,
          domainCoveragePercent: uniqueRecordsTotal > 0 ? 100 : null,
        },
        network: agg.network,
        jsHeapMb: heap.finish(),
        categoryIntegrity: [],
        overallFilterCompliance: 'not_applicable',
      },
    };
  } catch (err: any) {
    const cancelled = isAbortErrorLike(err, signal);
    const errCat: SanitizedErrorCategory = cancelled
      ? 'aborted'
      : sanitizeErrorCategory(err?.errorCategory);
    const agg = aggregateTelemetryEvents(telemetryEvents);
    const wallClockTotalMs = roundMs(nowMs() - strategyStartMs);
    return {
      reference,
      metrics: {
        strategy: 'A',
        strategyLabel: STRATEGY_LABELS_PT.A,
        domain,
        repetitionIndex,
        executionOrderPosition,
        status: cancelled ? 'cancelled' : 'error',
        errorCategory: errCat,
        errorDescriptionPt: ERROR_CATEGORY_DESCRIPTIONS_PT[errCat],
        categoriesFetchMs,
        categoriesCount,
        firstCategoryReadyWithIndexMs,
        otherCategoryAccessSteps,
        reuseCategoryAccessMs,
        strategyElapsedExcludingAuditMs:
          strategyElapsedExcludingAuditMs ??
          roundMs(Math.max(0, wallClockTotalMs - integrityAuditOverheadMs)),
        integrityAuditOverheadMs,
        wallClockTotalMs,
        fullCatalogCoverageMs,
        timingBreakdown: {
          categoriesFetchMs,
          catalogTransferAndReadMs: agg.transferAndReadMs,
          jsonParseMs: agg.jsonParseMs,
          indexBuildMs: roundMs(indexBuildMs),
          viewPreparationMs: roundMs(viewPreparationMs),
          coordinatorWaitMs: agg.coordinatorWaitMs,
          prefetchWorkDurationMs: null,
          integrityAuditOverheadMs,
        },
        requestCount: agg.requestCount,
        attemptCount: agg.attemptCount,
        retryCount: agg.retryCount,
        rateLimitHitCount: agg.rateLimitHitCount,
        rateLimitWaitMs: agg.rateLimitWaitMs,
        recordsReceivedTotal,
        uniqueRecordsTotal,
        intraResponseDuplicateTotal,
        crossQueryRepeatedIdCount: 0,
        multiCategoryLegitimateOverlapCount: 0,
        unexpectedCrossQueryRepeatCount: 0,
        coverageVsFullReference: {
          status: 'unavailable_no_full_reference',
          referenceSource: 'unavailable',
          presentInReferenceCount: null,
          missingFromReferenceCount: null,
          additionalNotInReferenceCount: null,
          domainCoveragePercent: null,
        },
        network: agg.network,
        jsHeapMb: heap.finish(),
        categoryIntegrity: [],
        overallFilterCompliance: 'not_applicable',
      },
    };
  }
}

interface RawCategoryLoadResult {
  bundle: CachedCategoryBundle;
  rawItems: any[];
  stepDurationMs: number;
  transferAndReadMs: number;
  jsonParseMs: number;
  indexBuildMs: number;
  viewPreparationMs: number;
}

async function loadAndIndexSingleCategoryPure(params: {
  credentials: XtreamCredentials;
  domain: BenchmarkDomain;
  category: SelectedBenchmarkCategory;
  priority: 'user' | 'background';
  signal?: AbortSignal;
  telemetryEvents: XtreamRequestTelemetry[];
}): Promise<RawCategoryLoadResult> {
  const { credentials, domain, category, priority, signal, telemetryEvents } = params;

  const stepStart = nowMs();
  let transferAndReadMs = 0;
  let jsonParseMs = 0;

  const rawItems = await fetchDomainItems(
    credentials,
    domain,
    category.categoryId,
    priority,
    signal,
    (ev) => {
      telemetryEvents.push(ev);
      for (const att of ev.attempts) {
        transferAndReadMs += att.fetchDurationMs;
        jsonParseMs += att.parseDurationMs;
      }
    }
  );

  checkAbort(signal);
  const idxStart = nowMs();
  const index = await buildDomainIndex(domain, rawItems, signal);
  const indexBuildMs = nowMs() - idxStart;

  const viewStart = nowMs();
  const viewCount = materializeCategoryView(domain, index, category.categoryId);
  const viewPreparationMs = nowMs() - viewStart;

  const stepDurationMs = nowMs() - stepStart;

  return {
    bundle: { index, viewCount },
    rawItems,
    stepDurationMs,
    transferAndReadMs,
    jsonParseMs,
    indexBuildMs,
    viewPreparationMs,
  };
}

async function executeStrategyB(params: {
  credentials: XtreamCredentials;
  domain: BenchmarkDomain;
  categories: SelectedBenchmarkCategory[];
  repetitionIndex: number;
  executionOrderPosition: number;
  signal?: AbortSignal;
  onProgress?: (phase: string, messagePt: string) => void;
}): Promise<DeferredStrategyAuditPayload> {
  const {
    credentials,
    domain,
    categories,
    repetitionIndex,
    executionOrderPosition,
    signal,
    onProgress,
  } = params;
  const telemetryEvents: XtreamRequestTelemetry[] = [];
  const heap = createHeapTracker();
  const strategyStartMs = nowMs();
  const roundCache = new Map<string, CachedCategoryBundle>();
  const pendingRawForAudit: Array<{
    slotId: string;
    categoryId: string;
    items: any[];
  }> = [];
  const otherCategoryAccessSteps: CategoryAccessStepMetric[] = [];

  let categoriesFetchMs: number | null = null;
  let categoriesCount = 0;
  let firstCategoryReadyWithIndexMs: number | null = null;
  let reuseCategoryAccessMs: number | null = null;
  let indexBuildMs = 0;
  let viewPreparationMs = 0;
  let integrityAuditOverheadMs = 0;
  let strategyElapsedExcludingAuditMs: number | null = null;

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
    heap.sampleStrategy();

    const firstCat = categories[0];
    if (firstCat) {
      checkAbort(signal);
      onProgress?.('first_category', 'Estratégia B: carregando somente a 1ª categoria...');
      const firstRes = await loadAndIndexSingleCategoryPure({
        credentials,
        domain,
        category: firstCat,
        priority: 'user',
        signal,
        telemetryEvents,
      });
      roundCache.set(firstCat.categoryId, firstRes.bundle);
      indexBuildMs += firstRes.indexBuildMs;
      viewPreparationMs += firstRes.viewPreparationMs;
      // Registra disponibilidade imediatamente, SEM auditoria de integridade antes deste ponto.
      firstCategoryReadyWithIndexMs = roundMs(nowMs() - strategyStartMs);
      pendingRawForAudit.push({
        slotId: firstCat.slotId,
        categoryId: firstCat.categoryId,
        items: firstRes.rawItems,
      });
      heap.sampleStrategy();
    }

    for (let i = 1; i < categories.length; i++) {
      checkAbort(signal);
      const cat = categories[i];
      onProgress?.(
        'other_category',
        `Estratégia B: carregando categoria ${i + 1}/${categories.length} sob demanda...`
      );
      const res = await loadAndIndexSingleCategoryPure({
        credentials,
        domain,
        category: cat,
        priority: 'user',
        signal,
        telemetryEvents,
      });
      roundCache.set(cat.categoryId, res.bundle);
      indexBuildMs += res.indexBuildMs;
      viewPreparationMs += res.viewPreparationMs;
      otherCategoryAccessSteps.push({
        slotId: cat.slotId,
        role: 'other_category',
        source: 'network_on_demand',
        durationMs: roundMs(res.stepDurationMs),
        transferAndReadMs: roundMs(res.transferAndReadMs),
        jsonParseMs: roundMs(res.jsonParseMs),
        indexBuildMs: roundMs(res.indexBuildMs),
        viewPreparationMs: roundMs(res.viewPreparationMs),
        recordsInView: res.bundle.viewCount,
        backgroundPrefetchDurationMs: null,
        prefetchCompletedBeforeAccess: null,
      });
      pendingRawForAudit.push({
        slotId: cat.slotId,
        categoryId: cat.categoryId,
        items: res.rawItems,
      });
      heap.sampleStrategy();
    }

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

    // Congela o tempo comercial ANTES da auditoria diagnóstica!
    strategyElapsedExcludingAuditMs = roundMs(nowMs() - strategyStartMs);
    heap.markEndOfStrategyBeforeAudit();

    // Auditoria diagnóstica separada (somente IDs compactos retidos, arrays descartados imediatamente)
    const auditStart = nowMs();
    const categoryRecords: DeferredCategoryAuditRecord[] = [];
    const allLoadedUniqueIds = new Set<string>();
    let recordsReceivedTotal = 0;
    let intraResponseDuplicateTotal = 0;

    for (const entry of pendingRawForAudit) {
      const rec = buildCompactCategoryAuditRecord(
        entry.slotId,
        entry.categoryId,
        entry.items,
        domain
      );
      categoryRecords.push(rec);
      recordsReceivedTotal += rec.receivedCount;
      intraResponseDuplicateTotal += rec.intraResponseDuplicateCount;
      rec.uniqueIds.forEach((id) => allLoadedUniqueIds.add(id));
    }
    pendingRawForAudit.length = 0;
    roundCache.clear();

    const repeats = computeCrossQueryRepeats(categoryRecords);
    integrityAuditOverheadMs = roundMs(nowMs() - auditStart);

    const wallClockTotalMs = roundMs(nowMs() - strategyStartMs);
    const agg = aggregateTelemetryEvents(telemetryEvents);

    const run: StrategyRunMetrics = {
      strategy: 'B',
      strategyLabel: STRATEGY_LABELS_PT.B,
      domain,
      repetitionIndex,
      executionOrderPosition,
      status: 'completed',
      errorCategory: null,
      errorDescriptionPt: null,
      categoriesFetchMs,
      categoriesCount,
      firstCategoryReadyWithIndexMs,
      otherCategoryAccessSteps,
      reuseCategoryAccessMs,
      strategyElapsedExcludingAuditMs,
      integrityAuditOverheadMs,
      wallClockTotalMs,
      fullCatalogCoverageMs: null,
      timingBreakdown: {
        categoriesFetchMs,
        catalogTransferAndReadMs: agg.transferAndReadMs,
        jsonParseMs: agg.jsonParseMs,
        indexBuildMs: roundMs(indexBuildMs),
        viewPreparationMs: roundMs(viewPreparationMs),
        coordinatorWaitMs: agg.coordinatorWaitMs,
        prefetchWorkDurationMs: null,
        integrityAuditOverheadMs,
      },
      requestCount: agg.requestCount,
      attemptCount: agg.attemptCount,
      retryCount: agg.retryCount,
      rateLimitHitCount: agg.rateLimitHitCount,
      rateLimitWaitMs: agg.rateLimitWaitMs,
      recordsReceivedTotal,
      uniqueRecordsTotal: allLoadedUniqueIds.size,
      intraResponseDuplicateTotal,
      crossQueryRepeatedIdCount: repeats.crossQueryRepeatedIdCount,
      multiCategoryLegitimateOverlapCount: repeats.multiCategoryLegitimateOverlapCount,
      unexpectedCrossQueryRepeatCount: repeats.unexpectedCrossQueryRepeatCount,
      coverageVsFullReference: {
        status: 'unavailable_no_full_reference',
        referenceSource: 'unavailable',
        presentInReferenceCount: null,
        missingFromReferenceCount: null,
        additionalNotInReferenceCount: null,
        domainCoveragePercent: null,
      },
      network: agg.network,
      jsHeapMb: heap.finish(),
      categoryIntegrity: [],
      overallFilterCompliance: 'not_applicable',
    };

    return { run, categoryRecords, allLoadedUniqueIds };
  } catch (err: any) {
    pendingRawForAudit.length = 0;
    roundCache.clear();
    const cancelled = isAbortErrorLike(err, signal);
    const errCat: SanitizedErrorCategory = cancelled
      ? 'aborted'
      : sanitizeErrorCategory(err?.errorCategory);
    const agg = aggregateTelemetryEvents(telemetryEvents);
    const wallClockTotalMs = roundMs(nowMs() - strategyStartMs);
    const run: StrategyRunMetrics = {
      strategy: 'B',
      strategyLabel: STRATEGY_LABELS_PT.B,
      domain,
      repetitionIndex,
      executionOrderPosition,
      status: cancelled ? 'cancelled' : 'error',
      errorCategory: errCat,
      errorDescriptionPt: ERROR_CATEGORY_DESCRIPTIONS_PT[errCat],
      categoriesFetchMs,
      categoriesCount,
      firstCategoryReadyWithIndexMs,
      otherCategoryAccessSteps,
      reuseCategoryAccessMs,
      strategyElapsedExcludingAuditMs:
        strategyElapsedExcludingAuditMs ??
        roundMs(Math.max(0, wallClockTotalMs - integrityAuditOverheadMs)),
      integrityAuditOverheadMs,
      wallClockTotalMs,
      fullCatalogCoverageMs: null,
      timingBreakdown: {
        categoriesFetchMs,
        catalogTransferAndReadMs: agg.transferAndReadMs,
        jsonParseMs: agg.jsonParseMs,
        indexBuildMs: roundMs(indexBuildMs),
        viewPreparationMs: roundMs(viewPreparationMs),
        coordinatorWaitMs: agg.coordinatorWaitMs,
        prefetchWorkDurationMs: null,
        integrityAuditOverheadMs,
      },
      requestCount: agg.requestCount,
      attemptCount: agg.attemptCount,
      retryCount: agg.retryCount,
      rateLimitHitCount: agg.rateLimitHitCount,
      rateLimitWaitMs: agg.rateLimitWaitMs,
      recordsReceivedTotal: 0,
      uniqueRecordsTotal: 0,
      intraResponseDuplicateTotal: 0,
      crossQueryRepeatedIdCount: 0,
      multiCategoryLegitimateOverlapCount: 0,
      unexpectedCrossQueryRepeatCount: 0,
      coverageVsFullReference: {
        status: 'unavailable_no_full_reference',
        referenceSource: 'unavailable',
        presentInReferenceCount: null,
        missingFromReferenceCount: null,
        additionalNotInReferenceCount: null,
        domainCoveragePercent: null,
      },
      network: agg.network,
      jsHeapMb: heap.finish(),
      categoryIntegrity: [],
      overallFilterCompliance: 'not_applicable',
    };
    return { run, categoryRecords: [], allLoadedUniqueIds: new Set() };
  }
}

async function executeStrategyC(params: {
  credentials: XtreamCredentials;
  domain: BenchmarkDomain;
  categories: SelectedBenchmarkCategory[];
  repetitionIndex: number;
  executionOrderPosition: number;
  signal?: AbortSignal;
  onProgress?: (phase: string, messagePt: string) => void;
}): Promise<DeferredStrategyAuditPayload> {
  const {
    credentials,
    domain,
    categories,
    repetitionIndex,
    executionOrderPosition,
    signal,
    onProgress,
  } = params;
  const telemetryEvents: XtreamRequestTelemetry[] = [];
  const heap = createHeapTracker();
  const strategyStartMs = nowMs();
  const roundCache = new Map<string, CachedCategoryBundle>();
  const pendingRawForAudit: Array<{
    slotId: string;
    categoryId: string;
    items: any[];
  }> = [];
  const otherCategoryAccessSteps: CategoryAccessStepMetric[] = [];

  let categoriesFetchMs: number | null = null;
  let categoriesCount = 0;
  let firstCategoryReadyWithIndexMs: number | null = null;
  let reuseCategoryAccessMs: number | null = null;
  let prefetchWorkDurationMs: number | null = null;
  let indexBuildMs = 0;
  let viewPreparationMs = 0;
  let integrityAuditOverheadMs = 0;
  let strategyElapsedExcludingAuditMs: number | null = null;

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
    heap.sampleStrategy();

    const firstCat = categories[0];
    if (firstCat) {
      checkAbort(signal);
      onProgress?.(
        'first_category',
        'Estratégia C: carregando prioritariamente a 1ª categoria...'
      );
      const firstRes = await loadAndIndexSingleCategoryPure({
        credentials,
        domain,
        category: firstCat,
        priority: 'user',
        signal,
        telemetryEvents,
      });
      roundCache.set(firstCat.categoryId, firstRes.bundle);
      indexBuildMs += firstRes.indexBuildMs;
      viewPreparationMs += firstRes.viewPreparationMs;
      // Registra disponibilidade da 1ª categoria ANTES de disparar o prefetch limitado.
      firstCategoryReadyWithIndexMs = roundMs(nowMs() - strategyStartMs);
      pendingRawForAudit.push({
        slotId: firstCat.slotId,
        categoryId: firstCat.categoryId,
        items: firstRes.rawItems,
      });
      heap.sampleStrategy();
    }

    // Inicia prefetch limitado de EXATAMENTE UMA próxima categoria (cat_2) sem pausas artificiais
    // e mede a troca imediata, distinguindo prefetch em andamento vs hit real de cache concluído.
    const prefetchCat = categories[1];
    if (prefetchCat) {
      checkAbort(signal);
      onProgress?.(
        'limited_prefetch',
        'Estratégia C: iniciando prefetch limitado da 2ª categoria e medindo troca imediata...'
      );

      let prefetchFinished = false;
      let prefetchCompletedResult: RawCategoryLoadResult | null = null;
      const prefetchStartMs = nowMs();

      const prefetchPromise = loadAndIndexSingleCategoryPure({
        credentials,
        domain,
        category: prefetchCat,
        priority: 'background',
        signal,
        telemetryEvents,
      }).then((res) => {
        prefetchFinished = true;
        prefetchCompletedResult = res;
        prefetchWorkDurationMs = roundMs(nowMs() - prefetchStartMs);
        roundCache.set(prefetchCat.categoryId, res.bundle);
        return res;
      });

      // Troca imediata para cat_2 (sem pausa artificial para favorecer o prefetch!)
      const switchStartMs = nowMs();
      const wasAlreadyFinishedBeforeAccess = prefetchFinished;

      let resolvedPrefetch: RawCategoryLoadResult;
      if (wasAlreadyFinishedBeforeAccess && prefetchCompletedResult) {
        resolvedPrefetch = prefetchCompletedResult;
      } else {
        resolvedPrefetch = await prefetchPromise;
      }

      const cachedAfterAwait = roundCache.get(prefetchCat.categoryId);
      const viewAccessStart = nowMs();
      const viewCount = cachedAfterAwait
        ? materializeCategoryView(domain, cachedAfterAwait.index, prefetchCat.categoryId)
        : resolvedPrefetch.bundle.viewCount;
      const viewAccessMs = nowMs() - viewAccessStart;
      const realSwitchWaitMs = nowMs() - switchStartMs;

      indexBuildMs += resolvedPrefetch.indexBuildMs;
      viewPreparationMs += resolvedPrefetch.viewPreparationMs + viewAccessMs;

      otherCategoryAccessSteps.push({
        slotId: prefetchCat.slotId,
        role: 'other_category',
        source: wasAlreadyFinishedBeforeAccess
          ? 'prefetch_cache_hit'
          : 'prefetch_in_flight_wait',
        durationMs: roundMs(realSwitchWaitMs),
        transferAndReadMs: wasAlreadyFinishedBeforeAccess
          ? 0
          : roundMs(resolvedPrefetch.transferAndReadMs),
        jsonParseMs: wasAlreadyFinishedBeforeAccess
          ? 0
          : roundMs(resolvedPrefetch.jsonParseMs),
        indexBuildMs: wasAlreadyFinishedBeforeAccess
          ? 0
          : roundMs(resolvedPrefetch.indexBuildMs),
        viewPreparationMs: roundMs(
          wasAlreadyFinishedBeforeAccess
            ? viewAccessMs
            : resolvedPrefetch.viewPreparationMs + viewAccessMs
        ),
        recordsInView: viewCount,
        backgroundPrefetchDurationMs: prefetchWorkDurationMs,
        prefetchCompletedBeforeAccess: wasAlreadyFinishedBeforeAccess,
      });

      pendingRawForAudit.push({
        slotId: prefetchCat.slotId,
        categoryId: prefetchCat.categoryId,
        items: resolvedPrefetch.rawItems,
      });
      heap.sampleStrategy();
    }

    // Demais categorias (ex.: cat_3) carregadas sob demanda (limite de 1 categoria pré-carregada)
    for (let i = 2; i < categories.length; i++) {
      checkAbort(signal);
      const cat = categories[i];
      onProgress?.(
        'other_category',
        `Estratégia C: carregando categoria ${i + 1}/${categories.length} sob demanda...`
      );
      const res = await loadAndIndexSingleCategoryPure({
        credentials,
        domain,
        category: cat,
        priority: 'user',
        signal,
        telemetryEvents,
      });
      roundCache.set(cat.categoryId, res.bundle);
      indexBuildMs += res.indexBuildMs;
      viewPreparationMs += res.viewPreparationMs;
      otherCategoryAccessSteps.push({
        slotId: cat.slotId,
        role: 'other_category',
        source: 'network_on_demand',
        durationMs: roundMs(res.stepDurationMs),
        transferAndReadMs: roundMs(res.transferAndReadMs),
        jsonParseMs: roundMs(res.jsonParseMs),
        indexBuildMs: roundMs(res.indexBuildMs),
        viewPreparationMs: roundMs(res.viewPreparationMs),
        recordsInView: res.bundle.viewCount,
        backgroundPrefetchDurationMs: null,
        prefetchCompletedBeforeAccess: null,
      });
      pendingRawForAudit.push({
        slotId: cat.slotId,
        categoryId: cat.categoryId,
        items: res.rawItems,
      });
      heap.sampleStrategy();
    }

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

    // Congela tempo comercial ANTES da auditoria diagnóstica!
    strategyElapsedExcludingAuditMs = roundMs(nowMs() - strategyStartMs);
    heap.markEndOfStrategyBeforeAudit();

    const auditStart = nowMs();
    const categoryRecords: DeferredCategoryAuditRecord[] = [];
    const allLoadedUniqueIds = new Set<string>();
    let recordsReceivedTotal = 0;
    let intraResponseDuplicateTotal = 0;

    for (const entry of pendingRawForAudit) {
      const rec = buildCompactCategoryAuditRecord(
        entry.slotId,
        entry.categoryId,
        entry.items,
        domain
      );
      categoryRecords.push(rec);
      recordsReceivedTotal += rec.receivedCount;
      intraResponseDuplicateTotal += rec.intraResponseDuplicateCount;
      rec.uniqueIds.forEach((id) => allLoadedUniqueIds.add(id));
    }
    pendingRawForAudit.length = 0;
    roundCache.clear();

    const repeats = computeCrossQueryRepeats(categoryRecords);
    integrityAuditOverheadMs = roundMs(nowMs() - auditStart);

    const wallClockTotalMs = roundMs(nowMs() - strategyStartMs);
    const agg = aggregateTelemetryEvents(telemetryEvents);

    const run: StrategyRunMetrics = {
      strategy: 'C',
      strategyLabel: STRATEGY_LABELS_PT.C,
      domain,
      repetitionIndex,
      executionOrderPosition,
      status: 'completed',
      errorCategory: null,
      errorDescriptionPt: null,
      categoriesFetchMs,
      categoriesCount,
      firstCategoryReadyWithIndexMs,
      otherCategoryAccessSteps,
      reuseCategoryAccessMs,
      strategyElapsedExcludingAuditMs,
      integrityAuditOverheadMs,
      wallClockTotalMs,
      fullCatalogCoverageMs: null,
      timingBreakdown: {
        categoriesFetchMs,
        catalogTransferAndReadMs: agg.transferAndReadMs,
        jsonParseMs: agg.jsonParseMs,
        indexBuildMs: roundMs(indexBuildMs),
        viewPreparationMs: roundMs(viewPreparationMs),
        coordinatorWaitMs: agg.coordinatorWaitMs,
        prefetchWorkDurationMs,
        integrityAuditOverheadMs,
      },
      requestCount: agg.requestCount,
      attemptCount: agg.attemptCount,
      retryCount: agg.retryCount,
      rateLimitHitCount: agg.rateLimitHitCount,
      rateLimitWaitMs: agg.rateLimitWaitMs,
      recordsReceivedTotal,
      uniqueRecordsTotal: allLoadedUniqueIds.size,
      intraResponseDuplicateTotal,
      crossQueryRepeatedIdCount: repeats.crossQueryRepeatedIdCount,
      multiCategoryLegitimateOverlapCount: repeats.multiCategoryLegitimateOverlapCount,
      unexpectedCrossQueryRepeatCount: repeats.unexpectedCrossQueryRepeatCount,
      coverageVsFullReference: {
        status: 'unavailable_no_full_reference',
        referenceSource: 'unavailable',
        presentInReferenceCount: null,
        missingFromReferenceCount: null,
        additionalNotInReferenceCount: null,
        domainCoveragePercent: null,
      },
      network: agg.network,
      jsHeapMb: heap.finish(),
      categoryIntegrity: [],
      overallFilterCompliance: 'not_applicable',
    };

    return { run, categoryRecords, allLoadedUniqueIds };
  } catch (err: any) {
    pendingRawForAudit.length = 0;
    roundCache.clear();
    const cancelled = isAbortErrorLike(err, signal);
    const errCat: SanitizedErrorCategory = cancelled
      ? 'aborted'
      : sanitizeErrorCategory(err?.errorCategory);
    const agg = aggregateTelemetryEvents(telemetryEvents);
    const wallClockTotalMs = roundMs(nowMs() - strategyStartMs);
    const run: StrategyRunMetrics = {
      strategy: 'C',
      strategyLabel: STRATEGY_LABELS_PT.C,
      domain,
      repetitionIndex,
      executionOrderPosition,
      status: cancelled ? 'cancelled' : 'error',
      errorCategory: errCat,
      errorDescriptionPt: ERROR_CATEGORY_DESCRIPTIONS_PT[errCat],
      categoriesFetchMs,
      categoriesCount,
      firstCategoryReadyWithIndexMs,
      otherCategoryAccessSteps,
      reuseCategoryAccessMs,
      strategyElapsedExcludingAuditMs:
        strategyElapsedExcludingAuditMs ??
        roundMs(Math.max(0, wallClockTotalMs - integrityAuditOverheadMs)),
      integrityAuditOverheadMs,
      wallClockTotalMs,
      fullCatalogCoverageMs: null,
      timingBreakdown: {
        categoriesFetchMs,
        catalogTransferAndReadMs: agg.transferAndReadMs,
        jsonParseMs: agg.jsonParseMs,
        indexBuildMs: roundMs(indexBuildMs),
        viewPreparationMs: roundMs(viewPreparationMs),
        coordinatorWaitMs: agg.coordinatorWaitMs,
        prefetchWorkDurationMs,
        integrityAuditOverheadMs,
      },
      requestCount: agg.requestCount,
      attemptCount: agg.attemptCount,
      retryCount: agg.retryCount,
      rateLimitHitCount: agg.rateLimitHitCount,
      rateLimitWaitMs: agg.rateLimitWaitMs,
      recordsReceivedTotal: 0,
      uniqueRecordsTotal: 0,
      intraResponseDuplicateTotal: 0,
      crossQueryRepeatedIdCount: 0,
      multiCategoryLegitimateOverlapCount: 0,
      unexpectedCrossQueryRepeatCount: 0,
      coverageVsFullReference: {
        status: 'unavailable_no_full_reference',
        referenceSource: 'unavailable',
        presentInReferenceCount: null,
        missingFromReferenceCount: null,
        additionalNotInReferenceCount: null,
        domainCoveragePercent: null,
      },
      network: agg.network,
      jsHeapMb: heap.finish(),
      categoryIntegrity: [],
      overallFilterCompliance: 'not_applicable',
    };
    return { run, categoryRecords: [], allLoadedUniqueIds: new Set() };
  }
}

function summarizeCompletenessAcrossRuns(
  statuses: MeasurementCompleteness[]
): MeasurementCompleteness {
  if (statuses.length === 0) return 'unavailable';
  if (statuses.every((s) => s === 'complete')) return 'complete';
  if (statuses.every((s) => s === 'unavailable')) return 'unavailable';
  return 'partial';
}

function buildStrategyAggregate(
  strategy: BenchmarkStrategyId,
  runs: StrategyRunMetrics[]
): StrategyDomainAggregate {
  const completed = runs.filter((r) => r.status === 'completed');
  const failed = runs.filter((r) => r.status === 'error');
  const cancelled = runs.filter((r) => r.status === 'cancelled');

  // Amostras são homogêneas apenas se todas ocorreram na mesma posição de ordem (sem rotação mista).
  const distinctOrderPositions = new Set(completed.map((r) => r.executionOrderPosition));
  const homogeneousSamples = distinctOrderPositions.size <= 1;

  const otherStepDurations = completed.flatMap((r) =>
    r.otherCategoryAccessSteps.map((s) => s.durationMs)
  );
  const allIntegrityChecks = completed.flatMap((r) => r.categoryIntegrity);

  const avgOf = (vals: Array<number | null | undefined>): number | null => {
    const valid = vals.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (valid.length === 0) return null;
    return roundMs(valid.reduce((a, b) => a + b, 0) / valid.length);
  };

  const payloadTextCharsStatus = summarizeCompletenessAcrossRuns(
    completed.map((r) => r.network.payloadTextChars.status)
  );
  const transferSizeStatus = summarizeCompletenessAcrossRuns(
    completed.map((r) => r.network.transferSizeBytes.status)
  );

  return {
    strategy,
    strategyLabel: STRATEGY_LABELS_PT[strategy],
    completedRuns: completed.length,
    failedRuns: failed.length,
    cancelledRuns: cancelled.length,
    firstCategoryReadyWithIndexMs: summarizeMetricSamples(
      completed.map((r) => r.firstCategoryReadyWithIndexMs),
      homogeneousSamples
    ),
    otherCategoryAvgAccessMs: summarizeMetricSamples(otherStepDurations, false),
    reuseCategoryAccessMs: summarizeMetricSamples(
      completed.map((r) => r.reuseCategoryAccessMs),
      homogeneousSamples
    ),
    strategyElapsedExcludingAuditMs: summarizeMetricSamples(
      completed.map((r) => r.strategyElapsedExcludingAuditMs),
      homogeneousSamples
    ),
    fullCatalogCoverageMs: summarizeMetricSamples(
      completed.map((r) => r.fullCatalogCoverageMs),
      homogeneousSamples
    ),
    integrityAuditOverheadMs: summarizeMetricSamples(
      completed.map((r) => r.integrityAuditOverheadMs),
      homogeneousSamples
    ),
    requestCountAvg: avgOf(completed.map((r) => r.requestCount)),
    retryCountTotal: runs.reduce((acc, r) => acc + r.retryCount, 0),
    rateLimitHitTotal: runs.reduce((acc, r) => acc + r.rateLimitHitCount, 0),
    uniqueRecordsAvg: avgOf(completed.map((r) => r.uniqueRecordsTotal)),
    payloadTextCharsStatus,
    payloadTextCharsObservableAvg: avgOf(
      completed.map((r) => r.network.payloadTextChars.observableSum)
    ),
    transferSizeStatus,
    transferSizeObservableBytesAvg: avgOf(
      completed.map((r) => r.network.transferSizeBytes.observableSum)
    ),
    domainCoveragePercentAvg: avgOf(
      completed.map((r) => r.coverageVsFullReference.domainCoveragePercent)
    ),
    overallFilterCompliance: summarizeOverallCompliance(allIntegrityChecks),
    runs,
  };
}

function buildFilterDiagnosisSummaryPt(
  status: CategoryFilterComplianceStatus,
  anyOutOfCategory: boolean,
  anyDuplicates: boolean,
  anyMissingVsFull: boolean,
  anyAdditionalVsRef: boolean
): string {
  switch (status) {
    case 'ignored_full_catalog':
      return 'CRÍTICO: o provedor ignorou category_id e devolveu praticamente o catálogo completo em consulta filtrada. Estratégias por categoria multiplicariam tráfego e memória.';
    case 'empty_mismatch':
      return 'ATENÇÃO: consulta filtrada por category_id retornou lista vazia para categoria que possui itens na referência completa.';
    case 'partial_or_mixed':
      return (
        'PARCIAL: o provedor retornou itens fora da categoria solicitada junto com itens válidos' +
        (anyDuplicates ? ' e registros duplicados.' : '.')
      );
    case 'empty_consistent':
      return 'Categorias testadas vazias tanto na consulta filtrada quanto na referência completa; selecionar categorias povoadas para validação conclusiva.';
    case 'respected': {
      const notes: string[] = ['O provedor respeitou category_id nas categorias testadas'];
      if (anyDuplicates) notes.push('com duplicados detectados na resposta');
      if (anyMissingVsFull) {
        notes.push('com itens ausentes em relação à referência completa');
      }
      if (anyAdditionalVsRef) {
        notes.push(
          'com itens adicionais não presentes na referência (possível atualização ao vivo do provedor durante a comparação)'
        );
      }
      if (!anyOutOfCategory && !anyDuplicates && !anyMissingVsFull && !anyAdditionalVsRef) {
        notes.push('sem registros fora de categoria ou divergências frente à referência completa');
      }
      return `${notes.join(', ')}.`;
    }
    default:
      return 'Filtro category_id não avaliado (somente Estratégia A executada ou execução interrompida).';
  }
}

function resolveOverallStatusFromRuns(
  runs: StrategyRunMetrics[],
  expectedTotalRuns: number
): ExecutionOverallStatus {
  if (runs.length === 0) return 'failed';
  const completedCount = runs.filter((r) => r.status === 'completed').length;
  const cancelledCount = runs.filter((r) => r.status === 'cancelled').length;
  const failedCount = runs.filter((r) => r.status === 'error').length;

  if (completedCount === expectedTotalRuns && cancelledCount === 0 && failedCount === 0) {
    return 'completed';
  }
  if (cancelledCount > 0 && completedCount === 0) {
    return 'cancelled';
  }
  if (completedCount === 0 && failedCount > 0) {
    return 'failed';
  }
  if (cancelledCount > 0) {
    return 'cancelled';
  }
  return 'partial';
}

/**
 * Executa a comparação sequencial das estratégias para um domínio:
 * - Rodada 1: preserva A, B, C para obter referência completa inicial.
 * - Repetições >= 2: alterna deterministicamente a ordem (B/C/A, C/A/B, ...) para reduzir viés de aquecimento.
 * - Reconcilia integridade/cobertura posteriormente quando B/C executam antes de A, sem alterar tempos medidos.
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
  const executionOrderByRepetition: Array<{
    repetitionIndex: number;
    order: BenchmarkStrategyId[];
  }> = [];

  let latestValidFullReference: FullCatalogReference | null = null;
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

    const repOrder = getStrategyOrderForRepetition(strategies, rep);
    executionOrderByRepetition.push({ repetitionIndex: rep, order: repOrder });

    let repFullReference: FullCatalogReference | null = null;
    const deferredAuditsInRep: DeferredStrategyAuditPayload[] = [];

    for (let orderIdx = 0; orderIdx < repOrder.length; orderIdx++) {
      if (signal?.aborted) break;
      const strategy = repOrder[orderIdx];
      const orderPos = orderIdx + 1;

      emit(
        'strategy_start',
        `[${DOMAIN_LABELS_PT[domain]}] Rodada ${rep}/${safeReps} (ordem ${repOrder.join(' → ')}) — iniciando ${STRATEGY_LABELS_PT[strategy]}...`,
        strategy,
        rep
      );

      if (strategy === 'A') {
        const res = await executeStrategyA({
          credentials,
          domain,
          categories: normalizedCategories,
          repetitionIndex: rep,
          executionOrderPosition: orderPos,
          signal,
          onProgress: (phase, msg) =>
            emit(phase, `[${DOMAIN_LABELS_PT[domain]}] ${msg}`, 'A', rep),
        });
        runsByStrategy.A.push(res.metrics);
        if (res.reference) {
          repFullReference = res.reference;
          latestValidFullReference = res.reference;
        }
        if (res.metrics.categoriesCount > totalCategoriesAvailable) {
          totalCategoriesAvailable = res.metrics.categoriesCount;
        }
        if (res.metrics.status === 'cancelled') break;
      } else if (strategy === 'B') {
        const payload = await executeStrategyB({
          credentials,
          domain,
          categories: normalizedCategories,
          repetitionIndex: rep,
          executionOrderPosition: orderPos,
          signal,
          onProgress: (phase, msg) =>
            emit(phase, `[${DOMAIN_LABELS_PT[domain]}] ${msg}`, 'B', rep),
        });
        runsByStrategy.B.push(payload.run);
        if (payload.run.status === 'completed') {
          deferredAuditsInRep.push(payload);
        }
        if (payload.run.categoriesCount > totalCategoriesAvailable) {
          totalCategoriesAvailable = payload.run.categoriesCount;
        }
        if (payload.run.status === 'cancelled') break;
      } else if (strategy === 'C') {
        const payload = await executeStrategyC({
          credentials,
          domain,
          categories: normalizedCategories,
          repetitionIndex: rep,
          executionOrderPosition: orderPos,
          signal,
          onProgress: (phase, msg) =>
            emit(phase, `[${DOMAIN_LABELS_PT[domain]}] ${msg}`, 'C', rep),
        });
        runsByStrategy.C.push(payload.run);
        if (payload.run.status === 'completed') {
          deferredAuditsInRep.push(payload);
        }
        if (payload.run.categoriesCount > totalCategoriesAvailable) {
          totalCategoriesAvailable = payload.run.categoriesCount;
        }
        if (payload.run.status === 'cancelled') break;
      }
    }

    // Reconcilia integridade e cobertura de B e C após a rodada (mesmo quando B/C executaram antes de A),
    // sem alterar nenhum tempo já registrado e descartando os conjuntos temporários em seguida.
    const refToUse = repFullReference ?? latestValidFullReference;
    const refSource: 'same_repetition' | 'earlier_repetition' | 'unavailable' =
      repFullReference
        ? 'same_repetition'
        : latestValidFullReference
          ? 'earlier_repetition'
          : 'unavailable';

    for (const deferred of deferredAuditsInRep) {
      reconcileDeferredAuditWithReference(deferred, refToUse, refSource);
      deferred.categoryRecords.length = 0;
      deferred.allLoadedUniqueIds.clear();
    }
    deferredAuditsInRep.length = 0;
  }

  const aggA = buildStrategyAggregate('A', runsByStrategy.A);
  const aggB = buildStrategyAggregate('B', runsByStrategy.B);
  const aggC = buildStrategyAggregate('C', runsByStrategy.C);

  const allRuns = [...runsByStrategy.A, ...runsByStrategy.B, ...runsByStrategy.C];
  const domainStatus = resolveOverallStatusFromRuns(
    allRuns,
    safeReps * strategies.length
  );

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
    allFilteredChecks.some((c) => c.intraResponseDuplicateCount > 0) ||
    (latestValidFullReference ? latestValidFullReference.duplicateIds > 0 : false);
  const anyMissingRecordsVsFull = allFilteredChecks.some(
    (c) =>
      c.vsFullCatalog.missingFromReferenceCount !== null &&
      c.vsFullCatalog.missingFromReferenceCount > 0
  );
  const anyAdditionalRecordsNotInReference = allFilteredChecks.some(
    (c) =>
      c.vsFullCatalog.additionalNotInReferenceCount !== null &&
      c.vsFullCatalog.additionalNotInReferenceCount > 0
  );

  const refSummary = latestValidFullReference
    ? {
        available: true,
        uniqueCount: latestValidFullReference.totalUniqueIds,
        receivedCount: latestValidFullReference.totalReceived,
        duplicateCount: latestValidFullReference.duplicateIds,
      }
    : {
        available: false,
        uniqueCount: null,
        receivedCount: null,
        duplicateCount: null,
      };
  // Libera referência completa de IDs ao finalizar o domínio para não reter memória diagnóstica.
  latestValidFullReference = null;

  emit(
    'domain_done',
    domainStatus === 'completed'
      ? `[${DOMAIN_LABELS_PT[domain]}] Comparação concluída.`
      : `[${DOMAIN_LABELS_PT[domain]}] Comparação encerrada com estado: ${domainStatus}.`,
    undefined,
    safeReps
  );

  return {
    domain,
    domainLabel: DOMAIN_LABELS_PT[domain],
    domainStatus,
    totalCategoriesAvailable,
    selectedCategorySlots: normalizedCategories.map((c) => ({
      slotId: c.slotId,
      listPosition: c.listPosition,
    })),
    repetitionsRequested: safeReps,
    executionOrderByRepetition,
    fullCatalogReferenceAvailable: refSummary.available,
    fullCatalogUniqueCount: refSummary.uniqueCount,
    fullCatalogReceivedCount: refSummary.receivedCount,
    fullCatalogDuplicateCount: refSummary.duplicateCount,
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
        anyMissingRecordsVsFull,
        anyAdditionalRecordsNotInReference
      ),
      anyProviderIgnoredFilter,
      anyOutOfCategoryRecords,
      anyDuplicatesDetected,
      anyMissingRecordsVsFull,
      anyAdditionalRecordsNotInReference,
    },
  };
}

function projectObservableSum(m: ObservableSumMetric): ObservableSumMetric {
  return {
    observedAttempts: m.observedAttempts,
    missingAttempts: m.missingAttempts,
    status: m.status,
    observableSum: m.observableSum,
  };
}

function projectMetricAggregate(m: MetricAggregateSummary): MetricAggregateSummary {
  return {
    samples: m.samples,
    min: m.min,
    median: m.median,
    mean: m.mean,
    max: m.max,
    p95: m.p95Available ? m.p95 : null,
    p95Available: m.p95Available,
    homogeneousSamples: m.homogeneousSamples,
  };
}

function projectSanitizedRun(run: StrategyRunMetrics): StrategyRunMetrics {
  const errCat = run.errorCategory ? sanitizeErrorCategory(run.errorCategory) : null;
  return {
    strategy: run.strategy,
    strategyLabel: STRATEGY_LABELS_PT[run.strategy],
    domain: run.domain,
    repetitionIndex: run.repetitionIndex,
    executionOrderPosition: run.executionOrderPosition,
    status: run.status,
    errorCategory: errCat,
    errorDescriptionPt: errCat ? ERROR_CATEGORY_DESCRIPTIONS_PT[errCat] : null,
    categoriesFetchMs: run.categoriesFetchMs,
    categoriesCount: run.categoriesCount,
    firstCategoryReadyWithIndexMs: run.firstCategoryReadyWithIndexMs,
    otherCategoryAccessSteps: run.otherCategoryAccessSteps.map((step) => ({
      slotId: step.slotId,
      role: step.role,
      source: step.source,
      durationMs: step.durationMs,
      transferAndReadMs: step.transferAndReadMs,
      jsonParseMs: step.jsonParseMs,
      indexBuildMs: step.indexBuildMs,
      viewPreparationMs: step.viewPreparationMs,
      recordsInView: step.recordsInView,
      backgroundPrefetchDurationMs: step.backgroundPrefetchDurationMs,
      prefetchCompletedBeforeAccess: step.prefetchCompletedBeforeAccess,
    })),
    reuseCategoryAccessMs: run.reuseCategoryAccessMs,
    strategyElapsedExcludingAuditMs: run.strategyElapsedExcludingAuditMs,
    integrityAuditOverheadMs: run.integrityAuditOverheadMs,
    wallClockTotalMs: run.wallClockTotalMs,
    fullCatalogCoverageMs: run.fullCatalogCoverageMs,
    timingBreakdown: {
      categoriesFetchMs: run.timingBreakdown.categoriesFetchMs,
      catalogTransferAndReadMs: run.timingBreakdown.catalogTransferAndReadMs,
      jsonParseMs: run.timingBreakdown.jsonParseMs,
      indexBuildMs: run.timingBreakdown.indexBuildMs,
      viewPreparationMs: run.timingBreakdown.viewPreparationMs,
      coordinatorWaitMs: run.timingBreakdown.coordinatorWaitMs,
      prefetchWorkDurationMs: run.timingBreakdown.prefetchWorkDurationMs,
      integrityAuditOverheadMs: run.timingBreakdown.integrityAuditOverheadMs,
    },
    requestCount: run.requestCount,
    attemptCount: run.attemptCount,
    retryCount: run.retryCount,
    rateLimitHitCount: run.rateLimitHitCount,
    rateLimitWaitMs: run.rateLimitWaitMs,
    recordsReceivedTotal: run.recordsReceivedTotal,
    uniqueRecordsTotal: run.uniqueRecordsTotal,
    intraResponseDuplicateTotal: run.intraResponseDuplicateTotal,
    crossQueryRepeatedIdCount: run.crossQueryRepeatedIdCount,
    multiCategoryLegitimateOverlapCount: run.multiCategoryLegitimateOverlapCount,
    unexpectedCrossQueryRepeatCount: run.unexpectedCrossQueryRepeatCount,
    coverageVsFullReference: {
      status: run.coverageVsFullReference.status,
      referenceSource: run.coverageVsFullReference.referenceSource,
      presentInReferenceCount: run.coverageVsFullReference.presentInReferenceCount,
      missingFromReferenceCount: run.coverageVsFullReference.missingFromReferenceCount,
      additionalNotInReferenceCount:
        run.coverageVsFullReference.additionalNotInReferenceCount,
      domainCoveragePercent: run.coverageVsFullReference.domainCoveragePercent,
    },
    network: {
      totalAttempts: run.network.totalAttempts,
      payloadTextChars: projectObservableSum(run.network.payloadTextChars),
      transferSizeBytes: projectObservableSum(run.network.transferSizeBytes),
      encodedBodySizeBytes: projectObservableSum(run.network.encodedBodySizeBytes),
      decodedBodySizeBytes: projectObservableSum(run.network.decodedBodySizeBytes),
      contentLengthHeaderBytes: projectObservableSum(run.network.contentLengthHeaderBytes),
      resourceTimingRestrictedAttempts: run.network.resourceTimingRestrictedAttempts,
      browserHttpCacheHitAttempts: run.network.browserHttpCacheHitAttempts,
      cacheHeaderSignals: {
        anyCacheControlHeaderPresent:
          Boolean(run.network.cacheHeaderSignals.anyCacheControlHeaderPresent),
        anyCacheableDirectiveObserved:
          Boolean(run.network.cacheHeaderSignals.anyCacheableDirectiveObserved),
        anyNoCacheDirectiveObserved:
          Boolean(run.network.cacheHeaderSignals.anyNoCacheDirectiveObserved),
        maxObservedAgeSeconds: run.network.cacheHeaderSignals.maxObservedAgeSeconds,
        anyEtagPresent: Boolean(run.network.cacheHeaderSignals.anyEtagPresent),
      },
      transportKindsUsed: [...run.network.transportKindsUsed],
    },
    jsHeapMb: {
      available: Boolean(run.jsHeapMb.available),
      beforeStrategyMb: run.jsHeapMb.beforeStrategyMb,
      maxSampledDuringStrategyMb: run.jsHeapMb.maxSampledDuringStrategyMb,
      afterStrategyBeforeAuditMb: run.jsHeapMb.afterStrategyBeforeAuditMb,
      afterAuditMb: run.jsHeapMb.afterAuditMb,
      strategyDeltaMb: run.jsHeapMb.strategyDeltaMb,
      auditDeltaMb: run.jsHeapMb.auditDeltaMb,
      samplingCaveatPt: JS_HEAP_SAMPLING_CAVEAT_PT,
    },
    categoryIntegrity: run.categoryIntegrity.map((c) => ({
      slotId: c.slotId,
      receivedCount: c.receivedCount,
      uniqueIdCount: c.uniqueIdCount,
      intraResponseDuplicateCount: c.intraResponseDuplicateCount,
      exactPrimaryCategoryMatchCount: c.exactPrimaryCategoryMatchCount,
      secondaryCategoryIdsMatchCount: c.secondaryCategoryIdsMatchCount,
      outOfCategoryCount: c.outOfCategoryCount,
      distinctCategoryIdsReturned: c.distinctCategoryIdsReturned,
      compliance: c.compliance,
      vsFullCatalog: {
        status: c.vsFullCatalog.status,
        fullCatalogCategoryUniqueCount: c.vsFullCatalog.fullCatalogCategoryUniqueCount,
        presentInReferenceCount: c.vsFullCatalog.presentInReferenceCount,
        missingFromReferenceCount: c.vsFullCatalog.missingFromReferenceCount,
        additionalNotInReferenceCount: c.vsFullCatalog.additionalNotInReferenceCount,
        categoryCoveragePercent: c.vsFullCatalog.categoryCoveragePercent,
        shareOfFullDomainPercent: c.vsFullCatalog.shareOfFullDomainPercent,
      },
    })),
    overallFilterCompliance: run.overallFilterCompliance,
  };
}

function projectSanitizedStrategyAggregate(
  agg: StrategyDomainAggregate
): StrategyDomainAggregate {
  return {
    strategy: agg.strategy,
    strategyLabel: STRATEGY_LABELS_PT[agg.strategy],
    completedRuns: agg.completedRuns,
    failedRuns: agg.failedRuns,
    cancelledRuns: agg.cancelledRuns,
    firstCategoryReadyWithIndexMs: projectMetricAggregate(
      agg.firstCategoryReadyWithIndexMs
    ),
    otherCategoryAvgAccessMs: projectMetricAggregate(agg.otherCategoryAvgAccessMs),
    reuseCategoryAccessMs: projectMetricAggregate(agg.reuseCategoryAccessMs),
    strategyElapsedExcludingAuditMs: projectMetricAggregate(
      agg.strategyElapsedExcludingAuditMs
    ),
    fullCatalogCoverageMs: projectMetricAggregate(agg.fullCatalogCoverageMs),
    integrityAuditOverheadMs: projectMetricAggregate(agg.integrityAuditOverheadMs),
    requestCountAvg: agg.requestCountAvg,
    retryCountTotal: agg.retryCountTotal,
    rateLimitHitTotal: agg.rateLimitHitTotal,
    uniqueRecordsAvg: agg.uniqueRecordsAvg,
    payloadTextCharsStatus: agg.payloadTextCharsStatus,
    payloadTextCharsObservableAvg: agg.payloadTextCharsObservableAvg,
    transferSizeStatus: agg.transferSizeStatus,
    transferSizeObservableBytesAvg: agg.transferSizeObservableBytesAvg,
    domainCoveragePercentAvg: agg.domainCoveragePercentAvg,
    overallFilterCompliance: agg.overallFilterCompliance,
    runs: agg.runs.map(projectSanitizedRun),
  };
}

function projectSanitizedDomainResult(dom: DomainBenchmarkResult): DomainBenchmarkResult {
  return {
    domain: dom.domain,
    domainLabel: DOMAIN_LABELS_PT[dom.domain],
    domainStatus: dom.domainStatus,
    totalCategoriesAvailable: dom.totalCategoriesAvailable,
    selectedCategorySlots: dom.selectedCategorySlots.map((s) => ({
      slotId: s.slotId,
      listPosition: s.listPosition,
    })),
    repetitionsRequested: dom.repetitionsRequested,
    executionOrderByRepetition: dom.executionOrderByRepetition.map((e) => ({
      repetitionIndex: e.repetitionIndex,
      order: [...e.order],
    })),
    fullCatalogReferenceAvailable: Boolean(dom.fullCatalogReferenceAvailable),
    fullCatalogUniqueCount: dom.fullCatalogUniqueCount,
    fullCatalogReceivedCount: dom.fullCatalogReceivedCount,
    fullCatalogDuplicateCount: dom.fullCatalogDuplicateCount,
    strategies: {
      A: projectSanitizedStrategyAggregate(dom.strategies.A),
      B: projectSanitizedStrategyAggregate(dom.strategies.B),
      C: projectSanitizedStrategyAggregate(dom.strategies.C),
    },
    providerFilterDiagnosis: {
      status: dom.providerFilterDiagnosis.status,
      summaryPt: buildFilterDiagnosisSummaryPt(
        dom.providerFilterDiagnosis.status,
        dom.providerFilterDiagnosis.anyOutOfCategoryRecords,
        dom.providerFilterDiagnosis.anyDuplicatesDetected,
        dom.providerFilterDiagnosis.anyMissingRecordsVsFull,
        dom.providerFilterDiagnosis.anyAdditionalRecordsNotInReference
      ),
      anyProviderIgnoredFilter: Boolean(
        dom.providerFilterDiagnosis.anyProviderIgnoredFilter
      ),
      anyOutOfCategoryRecords: Boolean(dom.providerFilterDiagnosis.anyOutOfCategoryRecords),
      anyDuplicatesDetected: Boolean(dom.providerFilterDiagnosis.anyDuplicatesDetected),
      anyMissingRecordsVsFull: Boolean(dom.providerFilterDiagnosis.anyMissingRecordsVsFull),
      anyAdditionalRecordsNotInReference: Boolean(
        dom.providerFilterDiagnosis.anyAdditionalRecordsNotInReference
      ),
    },
  };
}

function buildExecutionStatusSummaryPt(
  status: ExecutionOverallStatus,
  requestedDomainsCount: number,
  collectedDomainsCount: number
): string {
  switch (status) {
    case 'completed':
      return `Execução concluída integralmente em ${collectedDomainsCount}/${requestedDomainsCount} domínio(s) solicitado(s).`;
    case 'cancelled':
      return `Execução cancelada pelo usuário (${collectedDomainsCount}/${requestedDomainsCount} domínio(s) com medições parciais preservadas).`;
    case 'partial':
      return `Execução parcial: nem todos os domínios ou estratégias foram concluídos (${collectedDomainsCount}/${requestedDomainsCount} domínio(s) com dados).`;
    default:
      return 'Execução encerrada com falha sem conclusão das estratégias solicitadas.';
  }
}

/**
 * Constrói o relatório sanitizado por projeção explícita (allowlist) de campos agregados permitidos.
 * Nunca exporta mensagens brutas de erro, cabeçalhos HTTP livres, URLs, hosts, credenciais,
 * respostas do provedor, títulos ou identificadores reais de conteúdos/categorias.
 */
export function buildSanitizedBenchmarkReport(params: {
  domains: DomainBenchmarkResult[];
  requestedDomainsCount?: number;
  strategiesCompared: BenchmarkStrategyId[];
  repetitionsPerDomain: number;
  wasCancelled?: boolean;
  environment?: BenchmarkEnvironmentInfo;
}): SanitizedBenchmarkReport {
  const projectedDomains = params.domains.map(projectSanitizedDomainResult);
  const requestedCount = params.requestedDomainsCount ?? Math.max(1, projectedDomains.length);

  let executionStatus: ExecutionOverallStatus;
  if (params.wasCancelled) {
    executionStatus = 'cancelled';
  } else if (projectedDomains.length === 0) {
    executionStatus = 'failed';
  } else if (
    projectedDomains.length === requestedCount &&
    projectedDomains.every((d) => d.domainStatus === 'completed')
  ) {
    executionStatus = 'completed';
  } else if (projectedDomains.every((d) => d.domainStatus === 'failed')) {
    executionStatus = 'failed';
  } else {
    executionStatus = 'partial';
  }

  const env = params.environment ?? detectBenchmarkEnvironment();

  return {
    schemaVersion: 'nc-c01-catalog-benchmark/v2',
    generatedAtIso: new Date().toISOString(),
    executionStatus,
    executionSummaryPt: buildExecutionStatusSummaryPt(
      executionStatus,
      requestedCount,
      projectedDomains.length
    ),
    disclaimerPt:
      'Relatório sanitizado gerado por projeção explícita de campos agregados (C01.R — North Code Play). Não contém credenciais, URLs, hosts, tokens, cabeçalhos livres, mensagens brutas de erro, respostas do provedor, títulos ou IDs reais.',
    environment: {
      runtimeKind: env.runtimeKind,
      androidCatalogFileTransferAvailable: Boolean(env.androidCatalogFileTransferAvailable),
      memoryApiAvailable: Boolean(env.memoryApiAvailable),
      resourceTimingApiAvailable: Boolean(env.resourceTimingApiAvailable),
      hardwareConcurrency: env.hardwareConcurrency,
      deviceMemoryGb: env.deviceMemoryGb,
      viewportClass: env.viewportClass,
      transportArchitectureNotes: { ...env.transportArchitectureNotes },
    },
    methodology: {
      executionMode: 'sequential_same_account_no_video',
      strategiesCompared: [...params.strategiesCompared],
      repetitionsPerDomain: params.repetitionsPerDomain,
      strategyOrderRotationPolicyPt:
        'Rodada 1 executa A → B → C para referência inicial; repetições seguintes alternam deterministicamente (B → C → A, C → A → B, ...) para reduzir viés de aquecimento, com reconciliação de integridade posterior sem alterar tempos medidos.',
      p95MinHomogeneousSamplesRequired: MIN_SAMPLES_FOR_P95,
      cacheDistinctionPt:
        'Distingue cache local da rodada (isolado por estratégia), cache HTTP observável no navegador (Resource Timing e sinais booleanos de cabeçalhos) e condições não controláveis de cache HTTP, proxy ou servidor do provedor, que não podem ser eliminadas.',
      timingScopeCaveatPt:
        'Os tempos medem preparação de dados (consulta de categorias, transferência/leitura, JSON.parse, construção de índice e preparação da visão da categoria), separados do custo adicional da auditoria diagnóstica e distintos do tempo ponta a ponta de login até renderização no app.',
      memoryCaveatPt: JS_HEAP_SAMPLING_CAVEAT_PT,
      liveCatalogDriftCaveatPt:
        'O catálogo remoto do provedor pode sofrer alterações durante a comparação; itens adicionais não encontrados na referência são reportados sem descarte de registros legítimos.',
    },
    domains: projectedDomains,
    functionalDependenciesMatrix: buildFunctionalDependenciesMatrix(),
  };
}

/**
 * Proteção complementar (defesa em profundidade) após a projeção explícita de campos permitidos:
 * verifica se qualquer dado sensível da conta ativa apareceu no relatório serializado.
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

function completenessLabelPt(status: MeasurementCompleteness): string {
  if (status === 'complete') return 'completa';
  if (status === 'partial') return 'parcial';
  return 'indisponível';
}

export function formatSanitizedReportMarkdown(report: SanitizedBenchmarkReport): string {
  const lines: string[] = [];
  lines.push('# Relatório Diagnóstico C01.R — Comparação de Estratégias de Catálogo');
  lines.push('');
  lines.push(`- **Gerado em:** ${report.generatedAtIso}`);
  lines.push(`- **Estado da execução:** ${report.executionStatus} — ${report.executionSummaryPt}`);
  lines.push(`- **Ambiente:** ${report.environment.runtimeKind} (${report.environment.viewportClass})`);
  lines.push(
    `- **Plugin Android CatalogFileTransfer disponível:** ${report.environment.androidCatalogFileTransferAvailable ? 'Sim' : 'Não'}`
  );
  lines.push(
    `- **Heap JS amostrado (\`performance.memory\`):** ${report.environment.memoryApiAvailable ? 'Disponível' : 'Indisponível neste navegador'}`
  );
  lines.push(`- **Repetições por domínio:** ${report.methodology.repetitionsPerDomain}`);
  lines.push('');
  lines.push(`> ${report.disclaimerPt}`);
  lines.push('');
  lines.push('## Ressalvas Metodológicas');
  lines.push(`- **Ordem das estratégias:** ${report.methodology.strategyOrderRotationPolicyPt}`);
  lines.push(`- **Escopo de tempo:** ${report.methodology.timingScopeCaveatPt}`);
  lines.push(`- **Caches:** ${report.methodology.cacheDistinctionPt}`);
  lines.push(`- **Memória:** ${report.methodology.memoryCaveatPt}`);
  lines.push(`- **Alterações no catálogo remoto:** ${report.methodology.liveCatalogDriftCaveatPt}`);
  lines.push(
    `- **Transporte Android:** ${report.environment.transportArchitectureNotes.androidFullCatalog} ${report.environment.transportArchitectureNotes.androidFilteredCatalog} ${report.environment.transportArchitectureNotes.extrapolationWarning}`
  );
  lines.push('');

  for (const dom of report.domains) {
    lines.push(`## Domínio: ${dom.domainLabel} (estado: ${dom.domainStatus})`);
    lines.push(
      `- Categorias disponíveis: ${dom.totalCategoriesAvailable} | Slots avaliados: ${dom.selectedCategorySlots.map((s) => `${s.slotId} (#${s.listPosition})`).join(', ')}`
    );
    lines.push(
      `- Ordem efetiva por rodada: ${dom.executionOrderByRepetition.map((e) => `R${e.repetitionIndex}: ${e.order.join('→')}`).join(' | ')}`
    );
    lines.push(
      `- Referência completa (Estratégia A): ${dom.fullCatalogReferenceAvailable ? `${dom.fullCatalogUniqueCount} registros únicos (${dom.fullCatalogReceivedCount} recebidos, ${dom.fullCatalogDuplicateCount} duplicados)` : 'Indisponível'}`
    );
    lines.push(`- **Diagnóstico de filtro \`category_id\`:** ${dom.providerFilterDiagnosis.summaryPt}`);
    lines.push('');
    lines.push(
      '| Estratégia | 1ª cat. pronta (ms) | Outras cat. (ms) | Reuso 1ª cat. (ms) | Percurso s/ auditoria (ms) | Cobertura completa (ms) | Auditoria (ms) | Req. / Retent. | Únicos | Payload UTF-16 (chars) | Transferência rede (bytes / medição) | Cobertura interseção (%) |'
    );
    lines.push(
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
    );

    for (const sid of ['A', 'B', 'C'] as BenchmarkStrategyId[]) {
      const s = dom.strategies[sid];
      if (!s || (s.completedRuns === 0 && s.failedRuns === 0 && s.cancelledRuns === 0)) {
        continue;
      }
      const transferDisplay =
        s.transferSizeStatus === 'unavailable'
          ? 'Indisponível'
          : `${fmtNum(s.transferSizeObservableBytesAvg)} (${completenessLabelPt(s.transferSizeStatus)})`;
      const payloadDisplay =
        s.payloadTextCharsStatus === 'unavailable'
          ? 'Indisponível'
          : `${fmtNum(s.payloadTextCharsObservableAvg)} (${completenessLabelPt(s.payloadTextCharsStatus)})`;

      lines.push(
        `| ${s.strategyLabel} | ${fmtNum(s.firstCategoryReadyWithIndexMs.median)} | ${fmtNum(s.otherCategoryAvgAccessMs.median)} | ${fmtNum(s.reuseCategoryAccessMs.median)} | ${fmtNum(s.strategyElapsedExcludingAuditMs.median)} | ${fmtNum(s.fullCatalogCoverageMs.median)} | ${fmtNum(s.integrityAuditOverheadMs.median)} | ${fmtNum(s.requestCountAvg)} / ${s.retryCountTotal} | ${fmtNum(s.uniqueRecordsAvg)} | ${payloadDisplay} | ${transferDisplay} | ${fmtNum(s.domainCoveragePercentAvg, '%')} |`
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
