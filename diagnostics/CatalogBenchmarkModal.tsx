import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Download,
  FileText,
  FolderSearch,
  Info,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
  X,
  XCircle,
} from 'lucide-react';
import type { Category } from '../src/types';
import {
  useXtreamCredentials,
  useXtreamLive,
  useXtreamSeries,
  useXtreamVod,
} from '../src/context/XtreamContext';
import {
  BACK_PRIORITY,
  SpatialDirection,
  focusElementSafely,
  moveSpatialFocus,
  setNavMode,
  useBackHandler,
} from '../src/navigation';
import {
  assertReportSanitized,
  buildSanitizedBenchmarkReport,
  checkBenchmarkIsolationStatus,
  detectBenchmarkEnvironment,
  DOMAIN_LABELS_PT,
  formatSanitizedReportMarkdown,
  loadCategoriesForSelection,
  pickDefaultRepresentativeCategories,
  runDomainCatalogComparison,
  STRATEGY_LABELS_PT,
  type BenchmarkDomain,
  type BenchmarkIsolationCheck,
  type BenchmarkProgressEvent,
  type BenchmarkStrategyId,
  type CategoryFilterComplianceStatus,
  type DomainBenchmarkResult,
  type ExecutionOverallStatus,
  type MeasurementCompleteness,
  type SanitizedBenchmarkReport,
  type SelectedBenchmarkCategory,
  type StrategyRunMetrics,
} from './catalogBenchmarkCore';

export interface CatalogBenchmarkModalProps {
  isOpen: boolean;
  onClose: () => void;
  isAccountInfoLoading?: boolean;
}

type DomainSelectionMode = BenchmarkDomain | 'all';
type CategorySelectionMode = 'auto' | 'manual';

const DOMAIN_OPTIONS: ReadonlyArray<{ id: DomainSelectionMode; label: string }> = [
  { id: 'live', label: 'TV ao Vivo' },
  { id: 'vod', label: 'Filmes' },
  { id: 'series', label: 'Séries' },
  { id: 'all', label: 'Todos (3 domínios)' },
];

const REPETITION_OPTIONS: ReadonlyArray<number> = [1, 2, 3, 5];

const ALL_STRATEGIES: BenchmarkStrategyId[] = ['A', 'B', 'C'];

function formatMetric(value: number | null | undefined, suffix = ''): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'Indisponível';
  }
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}${suffix}`;
}

function formatCompletenessBadge(status: MeasurementCompleteness): string {
  if (status === 'complete') return 'completa';
  if (status === 'partial') return 'parcial';
  return 'indisponível';
}

function formatComplianceLabel(status: CategoryFilterComplianceStatus): string {
  switch (status) {
    case 'respected':
      return 'Respeitou category_id';
    case 'ignored_full_catalog':
      return 'Ignorou category_id (catálogo inteiro)';
    case 'partial_or_mixed':
      return 'Parcial / itens fora da categoria';
    case 'empty_mismatch':
      return 'Vazio divergente da referência';
    case 'empty_consistent':
      return 'Categorias vazias (consistente)';
    default:
      return 'Não aplicável';
  }
}

function getComplianceToneClass(status: CategoryFilterComplianceStatus): string {
  switch (status) {
    case 'respected':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    case 'ignored_full_catalog':
    case 'empty_mismatch':
      return 'bg-red-500/15 text-red-200 border-red-500/35';
    case 'partial_or_mixed':
    case 'empty_consistent':
      return 'bg-amber-500/15 text-amber-200 border-amber-500/35';
    default:
      return 'bg-white/[0.06] text-nc-text-secondary border-white/15';
  }
}

function getExecutionStatusMeta(status: ExecutionOverallStatus): {
  label: string;
  toneClass: string;
} {
  switch (status) {
    case 'completed':
      return {
        label: 'Concluída integralmente',
        toneClass: 'bg-emerald-500/12 border-emerald-500/35 text-emerald-200',
      };
    case 'partial':
      return {
        label: 'Execução parcial',
        toneClass: 'bg-amber-500/12 border-amber-500/35 text-amber-200',
      };
    case 'cancelled':
      return {
        label: 'Execução cancelada',
        toneClass: 'bg-white/[0.08] border-white/25 text-white',
      };
    default:
      return {
        label: 'Falha na execução',
        toneClass: 'bg-red-500/12 border-red-500/35 text-red-200',
      };
  }
}

function formatStepSourceLabel(source: string): string {
  switch (source) {
    case 'full_index':
      return 'Índice completo';
    case 'full_index_cache':
      return 'Cache do índice';
    case 'network_on_demand':
      return 'Rede sob demanda';
    case 'prefetch_cache_hit':
      return 'Prefetch concluído (cache hit)';
    case 'prefetch_in_flight_wait':
      return 'Prefetch em andamento (espera real)';
    case 'round_local_cache':
      return 'Cache local da rodada';
    default:
      return source;
  }
}

function computeInMemoryAccountKey(
  credentials: { serverUrl?: string; username?: string; password?: string } | null
): string {
  if (!credentials) return '';
  return `${credentials.serverUrl ?? ''}\0${credentials.username ?? ''}\0${credentials.password ?? ''}`;
}

async function copyTextSafely(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fallback abaixo
    }
  }
  if (typeof document !== 'undefined') {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(textarea);
      return copied;
    } catch {
      return false;
    }
  }
  return false;
}

function triggerFileDownload(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1500);
}

export default function CatalogBenchmarkModal({
  isOpen,
  onClose,
  isAccountInfoLoading = false,
}: CatalogBenchmarkModalProps) {
  const { credentials } = useXtreamCredentials();
  const { loadingLive } = useXtreamLive();
  const { loadingVod } = useXtreamVod();
  const { loadingSeries } = useXtreamSeries();

  const [domainSelection, setDomainSelection] = useState<DomainSelectionMode>('live');
  const [categoryMode, setCategoryMode] = useState<CategorySelectionMode>('auto');
  const [repetitions, setRepetitions] = useState<number>(1);

  const [categoriesByDomain, setCategoriesByDomain] = useState<
    Partial<Record<BenchmarkDomain, Category[]>>
  >({});
  const [manualSelectionByDomain, setManualSelectionByDomain] = useState<
    Partial<Record<BenchmarkDomain, string[]>>
  >({});

  const [isLoadingCategories, setIsLoadingCategories] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isolationWarning, setIsolationWarning] = useState<BenchmarkIsolationCheck | null>(null);
  const [actionMessage, setActionMessage] = useState<{
    tone: 'info' | 'warning' | 'error' | 'success';
    text: string;
  } | null>(null);
  const [progressLog, setProgressLog] = useState<BenchmarkProgressEvent[]>([]);
  const [lastReport, setLastReport] = useState<SanitizedBenchmarkReport | null>(null);
  const [copiedFeedback, setCopiedFeedback] = useState(false);

  const modalRef = useRef<HTMLDivElement>(null);
  const activeAbortRef = useRef<AbortController | null>(null);
  const executionIdRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(true);
  const prevAccountKeyRef = useRef<string>(computeInMemoryAccountKey(credentials));

  const environmentInfo = useMemo(() => detectBenchmarkEnvironment(), []);

  const targetDomains = useMemo<BenchmarkDomain[]>(
    () => (domainSelection === 'all' ? ['live', 'vod', 'series'] : [domainSelection]),
    [domainSelection]
  );

  const buildExternalLoadingReasons = useCallback((): string[] => {
    const reasons: string[] = [];
    if (isAccountInfoLoading) {
      reasons.push(
        'As informações da conta ainda estão sendo carregadas nas Configurações. Aguarde a conclusão.'
      );
    }
    if (loadingLive) {
      reasons.push('O catálogo comercial de TV ao Vivo está carregando em segundo plano.');
    }
    if (loadingVod) {
      reasons.push('O catálogo comercial de Filmes está carregando em segundo plano.');
    }
    if (loadingSeries) {
      reasons.push('O catálogo comercial de Séries está carregando em segundo plano.');
    }
    return reasons;
  }, [isAccountInfoLoading, loadingLive, loadingVod, loadingSeries]);

  const cancelActiveOperations = useCallback((invalidateExecutionId: boolean) => {
    if (invalidateExecutionId) {
      executionIdRef.current += 1;
    }
    const ctrl = activeAbortRef.current;
    if (ctrl && !ctrl.signal.aborted) {
      ctrl.abort();
    }
    activeAbortRef.current = null;
  }, []);

  // Marca ciclo de montagem e garante aborto no unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      cancelActiveOperations(true);
    };
  }, [cancelActiveOperations]);

  // Limpa resultados, categorias carregadas e cancela operações em troca de conta ou logout
  const currentAccountKey = computeInMemoryAccountKey(credentials);
  useEffect(() => {
    if (prevAccountKeyRef.current !== currentAccountKey) {
      prevAccountKeyRef.current = currentAccountKey;
      cancelActiveOperations(true);
      setIsRunning(false);
      setIsLoadingCategories(false);
      setCategoriesByDomain({});
      setManualSelectionByDomain({});
      setLastReport(null);
      setProgressLog([]);
      setIsolationWarning(null);
      setActionMessage(
        currentAccountKey
          ? {
              tone: 'info',
              text: 'Conta ativa alterada: estado anterior do diagnóstico foi limpo.',
            }
          : {
              tone: 'warning',
              text: 'Sessão encerrada: operações canceladas e dados do diagnóstico limpos.',
            }
      );
    }
  }, [currentAccountKey, cancelActiveOperations]);

  // Cancela operações se o modal for fechado externamente e aplica foco inicial ao abrir
  useEffect(() => {
    if (!isOpen) {
      cancelActiveOperations(true);
      setIsRunning(false);
      setIsLoadingCategories(false);
      return;
    }

    // Verificação puramente local (sem nenhuma chamada de rede!) do estado do ambiente ao abrir
    const initialIsolation = checkBenchmarkIsolationStatus({
      externalLoadingReasonsPt: buildExternalLoadingReasons(),
    });
    setIsolationWarning(initialIsolation.canStartIsolated ? null : initialIsolation);

    const timer = setTimeout(() => {
      const root = modalRef.current;
      if (!root || !root.isConnected) return;
      const target =
        root.querySelector<HTMLElement>('[data-autofocus="true"]') ||
        root.querySelector<HTMLElement>('button:not([disabled])');
      if (target) {
        focusElementSafely(target);
      }
    }, 0);

    return () => clearTimeout(timer);
  }, [isOpen, cancelActiveOperations, buildExternalLoadingReasons]);

  const handleRequestClose = useCallback(() => {
    cancelActiveOperations(true);
    setIsRunning(false);
    setIsLoadingCategories(false);
    onClose();
  }, [cancelActiveOperations, onClose]);

  useBackHandler(
    'catalog-benchmark-modal',
    BACK_PRIORITY.SUB_MODAL,
    () => {
      handleRequestClose();
      return true;
    },
    isOpen
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleRequestClose();
        return;
      }

      const targetTag = (e.target as HTMLElement | null)?.tagName;
      if (targetTag === 'SELECT') {
        return;
      }

      let dir: SpatialDirection | null = null;
      if (e.key === 'ArrowUp') dir = 'up';
      else if (e.key === 'ArrowDown') dir = 'down';
      else if (e.key === 'ArrowLeft') dir = 'left';
      else if (e.key === 'ArrowRight') dir = 'right';

      if (dir) {
        e.preventDefault();
        e.stopPropagation();
        setNavMode('remote');
        moveSpatialFocus(dir);
      }
    },
    [handleRequestClose]
  );

  const handleRecheckIsolation = useCallback(() => {
    const check = checkBenchmarkIsolationStatus({
      externalLoadingReasonsPt: buildExternalLoadingReasons(),
    });
    setIsolationWarning(check.canStartIsolated ? null : check);
    if (check.canStartIsolated) {
      setActionMessage({
        tone: 'success',
        text: 'Ambiente isolado: nenhuma operação comercial pendente nem reprodução de mídia ativa.',
      });
    } else {
      setActionMessage({
        tone: 'warning',
        text: 'Há atividade concorrente detectada. Aguarde antes de iniciar a comparação.',
      });
    }
  }, [buildExternalLoadingReasons]);

  const handleLoadManualCategories = useCallback(async () => {
    if (!credentials) {
      setActionMessage({
        tone: 'error',
        text: 'Nenhuma conta autenticada ativa. Faça login antes de usar o diagnóstico.',
      });
      return;
    }

    const isolation = checkBenchmarkIsolationStatus({
      externalLoadingReasonsPt: buildExternalLoadingReasons(),
    });
    if (!isolation.canStartIsolated) {
      setIsolationWarning(isolation);
      setActionMessage({
        tone: 'warning',
        text: 'Carregamento bloqueado para evitar interferência com atividade comercial ativa.',
      });
      return;
    }

    setIsolationWarning(null);
    cancelActiveOperations(true);
    const runId = executionIdRef.current;
    const controller = new AbortController();
    activeAbortRef.current = controller;

    setIsLoadingCategories(true);
    setActionMessage({
      tone: 'info',
      text: `Consultando categorias de ${targetDomains.map((d) => DOMAIN_LABELS_PT[d]).join(', ')}...`,
    });

    try {
      const loadedMap: Partial<Record<BenchmarkDomain, Category[]>> = {};
      const defaultSelected: Partial<Record<BenchmarkDomain, string[]>> = {};

      for (const dom of targetDomains) {
        if (controller.signal.aborted || executionIdRef.current !== runId) break;
        const cats = await loadCategoriesForSelection(credentials, dom, controller.signal);
        if (controller.signal.aborted || executionIdRef.current !== runId) break;
        loadedMap[dom] = cats;
        const defaults = pickDefaultRepresentativeCategories(cats, 3);
        defaultSelected[dom] = defaults.map((d) => d.categoryId);
      }

      if (!isMountedRef.current || executionIdRef.current !== runId) return;

      if (controller.signal.aborted) {
        setActionMessage({
          tone: 'info',
          text: 'Consulta de categorias cancelada pelo usuário.',
        });
        return;
      }

      setCategoriesByDomain((prev) => ({ ...prev, ...loadedMap }));
      setManualSelectionByDomain((prev) => {
        const next = { ...prev };
        for (const dom of targetDomains) {
          if (!next[dom] || next[dom]!.length === 0) {
            next[dom] = defaultSelected[dom] ?? [];
          }
        }
        return next;
      });
      setActionMessage({
        tone: 'success',
        text: 'Categorias carregadas. Selecione até 3 categorias representativas para comparar exatamente o mesmo conjunto entre A, B e C.',
      });
    } catch (err: any) {
      if (!isMountedRef.current || executionIdRef.current !== runId) return;
      if (controller.signal.aborted || err?.isAborted || err?.name === 'AbortError') {
        setActionMessage({
          tone: 'info',
          text: 'Consulta de categorias cancelada pelo usuário.',
        });
      } else {
        setActionMessage({
          tone: 'error',
          text: 'Não foi possível consultar as categorias do provedor neste momento.',
        });
      }
    } finally {
      if (isMountedRef.current && executionIdRef.current === runId) {
        if (activeAbortRef.current === controller) {
          activeAbortRef.current = null;
        }
        setIsLoadingCategories(false);
      }
    }
  }, [
    credentials,
    buildExternalLoadingReasons,
    cancelActiveOperations,
    targetDomains,
  ]);

  const toggleManualCategory = useCallback((domain: BenchmarkDomain, categoryId: string) => {
    setManualSelectionByDomain((prev) => {
      const current = prev[domain] ?? [];
      if (current.includes(categoryId)) {
        return {
          ...prev,
          [domain]: current.filter((id) => id !== categoryId),
        };
      }
      if (current.length >= 3) {
        return {
          ...prev,
          [domain]: [...current.slice(1), categoryId],
        };
      }
      return {
        ...prev,
        [domain]: [...current, categoryId],
      };
    });
  }, []);

  const handleCancelExecution = useCallback(() => {
    if (!isRunning && !isLoadingCategories) return;
    const ctrl = activeAbortRef.current;
    if (ctrl && !ctrl.signal.aborted) {
      ctrl.abort();
    }
    setActionMessage({
      tone: 'warning',
      text: 'Cancelamento solicitado. Aguardando interrupção limpa das requisições em andamento...',
    });
  }, [isRunning, isLoadingCategories]);

  const handleStartComparison = useCallback(async () => {
    if (!credentials) {
      setActionMessage({
        tone: 'error',
        text: 'Nenhuma conta autenticada ativa. Faça login antes de iniciar a comparação.',
      });
      return;
    }

    const isolation = checkBenchmarkIsolationStatus({
      externalLoadingReasonsPt: buildExternalLoadingReasons(),
    });
    if (!isolation.canStartIsolated) {
      setIsolationWarning(isolation);
      setActionMessage({
        tone: 'warning',
        text: 'Execução bloqueada: há reprodução de mídia ativa ou operações comerciais pendentes.',
      });
      return;
    }

    setIsolationWarning(null);
    cancelActiveOperations(true);
    const runId = executionIdRef.current;
    const controller = new AbortController();
    activeAbortRef.current = controller;

    // Limpa relatório anterior imediatamente ao iniciar nova execução (sem sobreposição de resultados antigos)
    setLastReport(null);
    setCopiedFeedback(false);
    setProgressLog([]);
    setIsRunning(true);
    setActionMessage({
      tone: 'info',
      text: 'Comparação em andamento de forma sequencial e isolada...',
    });

    const collectedDomainResults: DomainBenchmarkResult[] = [];
    let wasCancelled = false;

    const pushProgress = (event: BenchmarkProgressEvent) => {
      if (!isMountedRef.current || executionIdRef.current !== runId) return;
      setProgressLog((prev) => {
        const next = [...prev, event];
        return next.length > 60 ? next.slice(next.length - 60) : next;
      });
    };

    try {
      for (const dom of targetDomains) {
        if (controller.signal.aborted || executionIdRef.current !== runId) {
          wasCancelled = true;
          break;
        }

        let selectedCategories: SelectedBenchmarkCategory[] = [];

        if (categoryMode === 'manual') {
          const availableCats = categoriesByDomain[dom] ?? [];
          const manualIds = manualSelectionByDomain[dom] ?? [];
          if (availableCats.length > 0 && manualIds.length > 0) {
            selectedCategories = manualIds
              .map((catId, slotIdx) => {
                const listIdx = availableCats.findIndex(
                  (c) => String(c.category_id) === String(catId)
                );
                if (listIdx < 0) return null;
                return {
                  slotId: `cat_${slotIdx + 1}`,
                  categoryId: String(availableCats[listIdx].category_id),
                  listPosition: listIdx + 1,
                };
              })
              .filter((x): x is SelectedBenchmarkCategory => x !== null);
          }
        }

        if (selectedCategories.length === 0) {
          pushProgress({
            domain: dom,
            phase: 'select_categories',
            messagePt: `[${DOMAIN_LABELS_PT[dom]}] Selecionando categorias representativas da conta ativa...`,
            timestampIso: new Date().toISOString(),
          });
          const cats =
            categoriesByDomain[dom] && categoriesByDomain[dom]!.length > 0
              ? categoriesByDomain[dom]!
              : await loadCategoriesForSelection(credentials, dom, controller.signal);

          if (controller.signal.aborted || executionIdRef.current !== runId) {
            wasCancelled = true;
            break;
          }

          if (isMountedRef.current && executionIdRef.current === runId) {
            setCategoriesByDomain((prev) => ({ ...prev, [dom]: cats }));
          }

          selectedCategories = pickDefaultRepresentativeCategories(cats, 3);
        }

        if (selectedCategories.length === 0) {
          pushProgress({
            domain: dom,
            phase: 'no_categories',
            messagePt: `[${DOMAIN_LABELS_PT[dom]}] Nenhuma categoria disponível nesta conta para comparação.`,
            timestampIso: new Date().toISOString(),
          });
          continue;
        }

        const domResult = await runDomainCatalogComparison({
          credentials,
          domain: dom,
          selectedCategories,
          strategies: ALL_STRATEGIES,
          repetitions,
          signal: controller.signal,
          onProgress: pushProgress,
        });

        if (!isMountedRef.current || executionIdRef.current !== runId) {
          return;
        }

        collectedDomainResults.push(domResult);
        if (domResult.domainStatus === 'cancelled' || controller.signal.aborted) {
          wasCancelled = true;
          break;
        }
      }

      if (!isMountedRef.current || executionIdRef.current !== runId) {
        return;
      }

      if (controller.signal.aborted) {
        wasCancelled = true;
      }

      const report = buildSanitizedBenchmarkReport({
        domains: collectedDomainResults,
        requestedDomainsCount: targetDomains.length,
        strategiesCompared: ALL_STRATEGIES,
        repetitionsPerDomain: repetitions,
        wasCancelled,
        environment: environmentInfo,
      });

      setLastReport(report);

      if (report.executionStatus === 'completed') {
        setActionMessage({
          tone: 'success',
          text: report.executionSummaryPt,
        });
      } else if (report.executionStatus === 'cancelled') {
        setActionMessage({
          tone: 'warning',
          text: report.executionSummaryPt,
        });
      } else if (report.executionStatus === 'partial') {
        setActionMessage({
          tone: 'warning',
          text: report.executionSummaryPt,
        });
      } else {
        setActionMessage({
          tone: 'error',
          text: report.executionSummaryPt,
        });
      }
    } catch (err: any) {
      if (!isMountedRef.current || executionIdRef.current !== runId) {
        return;
      }
      const aborted = Boolean(
        controller.signal.aborted || err?.isAborted || err?.name === 'AbortError'
      );
      const report = buildSanitizedBenchmarkReport({
        domains: collectedDomainResults,
        requestedDomainsCount: targetDomains.length,
        strategiesCompared: ALL_STRATEGIES,
        repetitionsPerDomain: repetitions,
        wasCancelled: aborted,
        environment: environmentInfo,
      });
      setLastReport(report);
      setActionMessage({
        tone: aborted ? 'warning' : 'error',
        text: aborted
          ? report.executionSummaryPt
          : 'Execução interrompida por erro técnico durante a consulta ao provedor.',
      });
    } finally {
      if (isMountedRef.current && executionIdRef.current === runId) {
        if (activeAbortRef.current === controller) {
          activeAbortRef.current = null;
        }
        setIsRunning(false);
      }
    }
  }, [
    credentials,
    buildExternalLoadingReasons,
    cancelActiveOperations,
    targetDomains,
    categoryMode,
    categoriesByDomain,
    manualSelectionByDomain,
    repetitions,
    environmentInfo,
  ]);

  const canExportReport = Boolean(
    !isRunning &&
      !isLoadingCategories &&
      lastReport &&
      lastReport.domains.length > 0
  );

  const handleCopyJson = useCallback(async () => {
    if (!canExportReport || !lastReport) return;
    const serialized = JSON.stringify(lastReport, null, 2);
    const audit = assertReportSanitized(serialized, credentials);
    if (!audit.safe) {
      setActionMessage({
        tone: 'error',
        text: `Exportação bloqueada pela verificação de sanitização (${audit.leakedTokens.join(', ')}).`,
      });
      return;
    }
    const ok = await copyTextSafely(serialized);
    if (ok) {
      setCopiedFeedback(true);
      setActionMessage({
        tone: 'success',
        text: 'Relatório JSON sanitizado copiado para a área de transferência.',
      });
      setTimeout(() => {
        if (isMountedRef.current) setCopiedFeedback(false);
      }, 2500);
    } else {
      setActionMessage({
        tone: 'warning',
        text: 'Não foi possível copiar automaticamente neste dispositivo. Utilize "Exportar JSON sanitizado".',
      });
    }
  }, [canExportReport, lastReport, credentials]);

  const handleExportJson = useCallback(() => {
    if (!canExportReport || !lastReport) return;
    const serialized = JSON.stringify(lastReport, null, 2);
    const audit = assertReportSanitized(serialized, credentials);
    if (!audit.safe) {
      setActionMessage({
        tone: 'error',
        text: `Exportação bloqueada pela verificação de sanitização (${audit.leakedTokens.join(', ')}).`,
      });
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    triggerFileDownload(
      serialized,
      `north-code-c01r-diagnostico-${stamp}.json`,
      'application/json;charset=utf-8'
    );
    setActionMessage({
      tone: 'success',
      text: 'Arquivo JSON sanitizado gerado para download.',
    });
  }, [canExportReport, lastReport, credentials]);

  const handleExportMarkdown = useCallback(() => {
    if (!canExportReport || !lastReport) return;
    const markdown = formatSanitizedReportMarkdown(lastReport);
    const audit = assertReportSanitized(markdown, credentials);
    if (!audit.safe) {
      setActionMessage({
        tone: 'error',
        text: `Exportação bloqueada pela verificação de sanitização (${audit.leakedTokens.join(', ')}).`,
      });
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    triggerFileDownload(
      markdown,
      `north-code-c01r-diagnostico-${stamp}.md`,
      'text/markdown;charset=utf-8'
    );
    setActionMessage({
      tone: 'success',
      text: 'Arquivo Markdown sanitizado gerado para download.',
    });
  }, [canExportReport, lastReport, credentials]);

  if (!isOpen) return null;

  const isBusy = isRunning || isLoadingCategories;
  const activeUsernameLabel =
    credentials?.username && credentials.username.trim().length > 0
      ? credentials.username.trim()
      : 'Sem conta ativa';

  return (
    <div
      ref={modalRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="catalog-benchmark-modal-title"
      data-focus-scope="modal"
      data-catalog-benchmark-modal="true"
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-[150] bg-black/85 backdrop-blur-md flex items-center justify-center p-2.5 sm:p-5 md:p-6 overflow-hidden"
    >
      <div className="w-full max-w-6xl max-h-[94vh] bg-nc-bg border border-white/15 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Cabeçalho fixo do modal */}
        <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6 sm:py-4 bg-nc-bg-card border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-white/[0.08] border border-white/15 flex items-center justify-center text-white shrink-0">
              <Activity className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  id="catalog-benchmark-modal-title"
                  className="text-base sm:text-lg font-bold text-white tracking-tight"
                >
                  Diagnóstico de catálogos
                </h2>
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-white/[0.08] border border-white/15 text-nc-text-secondary">
                  Ferramenta temporária de desenvolvimento
                </span>
              </div>
              <p className="text-xs text-nc-text-secondary mt-0.5 truncate">
                Conta ativa: <span className="text-white font-medium">{activeUsernameLabel}</span>{' '}
                · Ambiente:{' '}
                <span className="text-white/90">
                  {environmentInfo.runtimeKind === 'capacitor_native' ? 'Android APK' : 'Web'}
                </span>{' '}
                · Heap JS:{' '}
                <span className="text-white/90">
                  {environmentInfo.memoryApiAvailable ? 'Disponível' : 'Indisponível'}
                </span>
              </p>
            </div>
          </div>

          <button
            type="button"
            data-nav-item="true"
            data-catalog-benchmark-close="true"
            onClick={handleRequestClose}
            className="inline-flex items-center gap-2 min-h-[40px] px-4 py-2 rounded-xl bg-white/[0.08] hover:bg-white/[0.16] text-white border border-white/15 text-sm font-medium cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-white/90 shrink-0"
          >
            <X className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Fechar</span>
          </button>
        </header>

        {/* Corpo rolável */}
        <div
          data-scroll-container="true"
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar px-4 py-4 sm:px-6 sm:py-5 space-y-5"
        >
          {/* Aviso de isolamento / atividade concorrente */}
          {isolationWarning && !isolationWarning.canStartIsolated && (
            <div
              role="alert"
              data-isolation-warning="true"
              className="rounded-xl bg-amber-500/12 border border-amber-500/35 p-4 space-y-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-amber-200 font-semibold text-sm">
                  <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Atividade concorrente detectada no aplicativo</span>
                </div>
                <button
                  type="button"
                  data-nav-item="true"
                  onClick={handleRecheckIsolation}
                  disabled={isBusy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 border border-amber-400/30 text-xs font-medium cursor-pointer disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/90"
                >
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Verificar novamente</span>
                </button>
              </div>
              <ul className="list-disc pl-5 text-xs text-amber-100/90 space-y-1">
                {isolationWarning.reasonsPt.map((reason, idx) => (
                  <li key={idx}>{reason}</li>
                ))}
              </ul>
              <p className="text-[11px] text-amber-200/80">
                O diagnóstico não cancela operações comerciais nem invalida a sessão ativa; aguarde a
                conclusão para evitar interferência nas medições.
              </p>
            </div>
          )}

          {/* Painel de configuração da execução */}
          <section
            aria-label="Configuração da comparação"
            className="bg-nc-bg-card border border-white/10 rounded-xl p-4 sm:p-5 space-y-4"
          >
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Domínio */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-nc-text-secondary uppercase tracking-wider">
                  Domínio
                </p>
                <div
                  data-nav-row="benchmark-domain-row"
                  className="grid grid-cols-2 gap-2"
                >
                  {DOMAIN_OPTIONS.map((opt) => {
                    const selected = domainSelection === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        data-nav-item="true"
                        data-benchmark-domain={opt.id}
                        disabled={isBusy}
                        onClick={() => setDomainSelection(opt.id)}
                        className={`min-h-[38px] px-3 py-2 rounded-lg text-xs font-medium border text-left transition-colors cursor-pointer disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/90 ${
                          selected
                            ? 'bg-white text-black border-white font-semibold'
                            : 'bg-nc-bg-input text-white/90 border-white/10 hover:border-white/25'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Modo de seleção de categorias */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-nc-text-secondary uppercase tracking-wider">
                  Categorias testadas (iguais em A, B e C)
                </p>
                <div
                  data-nav-row="benchmark-catmode-row"
                  className="grid grid-cols-2 gap-2"
                >
                  <button
                    type="button"
                    data-nav-item="true"
                    disabled={isBusy}
                    onClick={() => setCategoryMode('auto')}
                    className={`min-h-[38px] px-3 py-2 rounded-lg text-xs font-medium border text-left cursor-pointer disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/90 ${
                      categoryMode === 'auto'
                        ? 'bg-white text-black border-white font-semibold'
                        : 'bg-nc-bg-input text-white/90 border-white/10 hover:border-white/25'
                    }`}
                  >
                    Automática (até 3)
                  </button>
                  <button
                    type="button"
                    data-nav-item="true"
                    disabled={isBusy}
                    onClick={() => setCategoryMode('manual')}
                    className={`min-h-[38px] px-3 py-2 rounded-lg text-xs font-medium border text-left cursor-pointer disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/90 ${
                      categoryMode === 'manual'
                        ? 'bg-white text-black border-white font-semibold'
                        : 'bg-nc-bg-input text-white/90 border-white/10 hover:border-white/25'
                    }`}
                  >
                    Manual (escolher)
                  </button>
                </div>
                <p className="text-[11px] text-nc-text-secondary leading-relaxed">
                  Nenhuma consulta automática ocorre ao abrir esta tela.
                </p>
              </div>

              {/* Repetições */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-nc-text-secondary uppercase tracking-wider">
                  Repetições por domínio
                </p>
                <div
                  data-nav-row="benchmark-reps-row"
                  className="grid grid-cols-4 gap-2"
                >
                  {REPETITION_OPTIONS.map((rep) => {
                    const selected = repetitions === rep;
                    return (
                      <button
                        key={rep}
                        type="button"
                        data-nav-item="true"
                        disabled={isBusy}
                        onClick={() => setRepetitions(rep)}
                        className={`min-h-[38px] px-2.5 py-2 rounded-lg text-xs font-semibold border text-center tabular-nums cursor-pointer disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/90 ${
                          selected
                            ? 'bg-white text-black border-white'
                            : 'bg-nc-bg-input text-white/90 border-white/10 hover:border-white/25'
                        }`}
                      >
                        {rep}x
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-nc-text-secondary leading-relaxed">
                  Rodada 1: A→B→C. Rodadas ≥ 2 alternam a ordem (B→C→A, C→A→B).
                </p>
              </div>
            </div>

            {/* Seleção manual opcional de categorias */}
            {categoryMode === 'manual' && (
              <div className="pt-3 border-t border-white/10 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-nc-text-secondary">
                    Carregue as categorias da conta ativa sob demanda e selecione até 3 categorias por
                    domínio.
                  </p>
                  <button
                    type="button"
                    data-nav-item="true"
                    disabled={isBusy || !credentials}
                    onClick={handleLoadManualCategories}
                    className="inline-flex items-center gap-2 min-h-[38px] px-3.5 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.15] text-white border border-white/15 text-xs font-medium cursor-pointer disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/90"
                  >
                    {isLoadingCategories ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <FolderSearch className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    <span>Carregar categorias</span>
                  </button>
                </div>

                {targetDomains.map((dom) => {
                  const cats = categoriesByDomain[dom];
                  if (!cats || cats.length === 0) return null;
                  const chosen = manualSelectionByDomain[dom] ?? [];
                  const displayCats = cats.slice(0, 60);
                  return (
                    <div key={dom} className="space-y-2">
                      <p className="text-xs font-semibold text-white">
                        {DOMAIN_LABELS_PT[dom]} — selecionadas: {chosen.length}/3 (exibindo{' '}
                        {displayCats.length} de {cats.length})
                      </p>
                      <div className="max-h-36 overflow-y-auto custom-scrollbar flex flex-wrap gap-1.5 p-2 rounded-lg bg-nc-bg-input border border-white/10">
                        {displayCats.map((cat) => {
                          const catId = String(cat.category_id);
                          const active = chosen.includes(catId);
                          return (
                            <button
                              key={catId}
                              type="button"
                              data-nav-item="true"
                              disabled={isBusy}
                              onClick={() => toggleManualCategory(dom, catId)}
                              className={`px-2.5 py-1 rounded-md text-xs border transition-colors cursor-pointer disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/90 ${
                                active
                                  ? 'bg-white text-black border-white font-semibold'
                                  : 'bg-white/[0.04] text-white/85 border-white/10 hover:border-white/30'
                              }`}
                            >
                              {cat.category_name || `Categoria ${catId}`}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Barra de ações principais */}
            <div
              data-nav-row="benchmark-primary-actions"
              className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-white/10"
            >
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  data-nav-item="true"
                  data-autofocus="true"
                  data-benchmark-start="true"
                  disabled={isBusy || !credentials}
                  onClick={handleStartComparison}
                  className="inline-flex items-center justify-center gap-2 min-h-[42px] px-5 py-2 rounded-xl bg-nc-primary text-black font-semibold text-sm hover:bg-nc-primary-hover active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-white/90"
                >
                  {isRunning ? (
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
                  ) : (
                    <Play className="w-4 h-4 shrink-0" aria-hidden="true" />
                  )}
                  <span>{isRunning ? 'Executando comparação...' : 'Iniciar comparação'}</span>
                </button>

                <button
                  type="button"
                  data-nav-item="true"
                  data-benchmark-cancel="true"
                  disabled={!isBusy}
                  onClick={handleCancelExecution}
                  className="inline-flex items-center justify-center gap-2 min-h-[42px] px-4 py-2 rounded-xl bg-red-500/15 hover:bg-red-500/25 text-red-200 border border-red-500/35 font-medium text-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-white/90"
                >
                  <Square className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Cancelar</span>
                </button>
              </div>

              {/* Ações de exportação sanitizada */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-nav-item="true"
                  data-benchmark-copy-json="true"
                  disabled={!canExportReport}
                  onClick={handleCopyJson}
                  className="inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-white border border-white/15 text-xs font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-white/90"
                >
                  {copiedFeedback ? (
                    <ClipboardCheck className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  <span>{copiedFeedback ? 'JSON copiado' : 'Copiar JSON sanitizado'}</span>
                </button>

                <button
                  type="button"
                  data-nav-item="true"
                  data-benchmark-export-json="true"
                  disabled={!canExportReport}
                  onClick={handleExportJson}
                  className="inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-white border border-white/15 text-xs font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-white/90"
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Exportar JSON sanitizado</span>
                </button>

                <button
                  type="button"
                  data-nav-item="true"
                  data-benchmark-export-md="true"
                  disabled={!canExportReport}
                  onClick={handleExportMarkdown}
                  className="inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-white border border-white/15 text-xs font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-white/90"
                >
                  <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Exportar Markdown sanitizado</span>
                </button>
              </div>
            </div>
          </section>

          {/* Mensagem de status da operação */}
          {actionMessage && (
            <div
              role="status"
              data-benchmark-status-tone={actionMessage.tone}
              className={`rounded-xl border px-4 py-3 text-xs sm:text-sm flex items-start gap-2.5 ${
                actionMessage.tone === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                  : actionMessage.tone === 'warning'
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                    : actionMessage.tone === 'error'
                      ? 'bg-red-500/10 border-red-500/30 text-red-200'
                      : 'bg-white/[0.05] border-white/15 text-white/90'
              }`}
            >
              {actionMessage.tone === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" aria-hidden="true" />
              ) : actionMessage.tone === 'error' ? (
                <XCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" aria-hidden="true" />
              ) : actionMessage.tone === 'warning' ? (
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-300" aria-hidden="true" />
              ) : (
                <Info className="w-4 h-4 shrink-0 mt-0.5 text-white/75" aria-hidden="true" />
              )}
              <span className="leading-relaxed">{actionMessage.text}</span>
            </div>
          )}

          {/* Progresso em tempo real */}
          {progressLog.length > 0 && (
            <section
              aria-label="Progresso da execução"
              className="bg-nc-bg-card border border-white/10 rounded-xl p-4 space-y-2"
            >
              <p className="text-xs font-semibold text-nc-text-secondary uppercase tracking-wider">
                Progresso da medição ({progressLog.length} eventos)
              </p>
              <div className="max-h-36 overflow-y-auto custom-scrollbar space-y-1 font-mono text-[11px] text-white/80 bg-nc-bg-input rounded-lg p-3 border border-white/[0.07]">
                {progressLog.slice(-25).map((ev, idx) => (
                  <div key={`${ev.timestampIso}-${idx}`} className="leading-snug">
                    <span className="text-nc-text-secondary">
                      {ev.timestampIso.slice(11, 19)}
                    </span>{' '}
                    {ev.messagePt}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Resultados consolidados */}
          {lastReport && (
            <div className="space-y-5" data-benchmark-report="true">
              {/* Resumo de estado e garantia de privacidade */}
              {(() => {
                const statusMeta = getExecutionStatusMeta(lastReport.executionStatus);
                return (
                  <div
                    className={`rounded-xl border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${statusMeta.toneClass}`}
                  >
                    <div className="space-y-1">
                      <p className="text-sm font-semibold">
                        Estado da execução: {statusMeta.label}
                      </p>
                      <p className="text-xs opacity-90">{lastReport.executionSummaryPt}</p>
                    </div>
                    <div className="inline-flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg bg-black/30 border border-white/15 text-white/90 shrink-0">
                      <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
                      <span>Relatório sanitizado por projeção explícita</span>
                    </div>
                  </div>
                );
              })()}

              {/* Resultados por domínio */}
              {lastReport.domains.map((dom) => (
                <DomainResultSection key={dom.domain} domainResult={dom} />
              ))}

              {/* Matriz de impacto nas funcionalidades comerciais */}
              <section
                aria-label="Impacto nas funcionalidades comerciais"
                className="bg-nc-bg-card border border-white/10 rounded-xl p-4 sm:p-5 space-y-3"
              >
                <h3 className="text-sm font-semibold text-white">
                  Dependências funcionais comerciais
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-white/10 text-nc-text-secondary">
                        <th className="py-2 pr-3 font-semibold">Funcionalidade</th>
                        <th className="py-2 px-3 font-semibold">Estratégia A</th>
                        <th className="py-2 px-3 font-semibold">Estratégia B</th>
                        <th className="py-2 pl-3 font-semibold">Estratégia C</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.07] text-white/90">
                      {lastReport.functionalDependenciesMatrix.map((dep) => (
                        <tr key={dep.feature}>
                          <td className="py-2.5 pr-3 font-medium text-white align-top">
                            {dep.feature}
                          </td>
                          <td className="py-2.5 px-3 align-top text-nc-text-secondary">
                            {dep.strategyA}
                          </td>
                          <td className="py-2.5 px-3 align-top text-nc-text-secondary">
                            {dep.strategyB}
                          </td>
                          <td className="py-2.5 pl-3 align-top text-nc-text-secondary">
                            {dep.strategyC}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Ressalvas metodológicas e de plataforma */}
              <section
                aria-label="Ressalvas metodológicas"
                className="bg-nc-bg-card border border-white/10 rounded-xl p-4 sm:p-5 space-y-2 text-xs text-nc-text-secondary"
              >
                <h3 className="text-sm font-semibold text-white">
                  Ressalvas metodológicas e limites de observação
                </h3>
                <ul className="list-disc pl-5 space-y-1.5 leading-relaxed">
                  <li>
                    <strong className="text-white/90">Escopo de tempo:</strong>{' '}
                    {lastReport.methodology.timingScopeCaveatPt}
                  </li>
                  <li>
                    <strong className="text-white/90">Rotação de ordem:</strong>{' '}
                    {lastReport.methodology.strategyOrderRotationPolicyPt}
                  </li>
                  <li>
                    <strong className="text-white/90">Caches:</strong>{' '}
                    {lastReport.methodology.cacheDistinctionPt}
                  </li>
                  <li>
                    <strong className="text-white/90">Memória JS:</strong>{' '}
                    {lastReport.methodology.memoryCaveatPt}
                  </li>
                  <li>
                    <strong className="text-white/90">Catálogo remoto dinâmico:</strong>{' '}
                    {lastReport.methodology.liveCatalogDriftCaveatPt}
                  </li>
                  <li>
                    <strong className="text-white/90">Transporte Android vs Web:</strong>{' '}
                    {lastReport.environment.transportArchitectureNotes.androidFullCatalog}{' '}
                    {lastReport.environment.transportArchitectureNotes.androidFilteredCatalog}{' '}
                    {lastReport.environment.transportArchitectureNotes.extrapolationWarning}
                  </li>
                </ul>
              </section>
            </div>
          )}

          {/* Nota de privacidade quando ainda não há relatório */}
          {!lastReport && (
            <section className="bg-nc-bg-card border border-white/10 rounded-xl p-4 space-y-2 text-xs text-nc-text-secondary">
              <div className="flex items-center gap-2 text-white font-semibold">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
                <span>Escopo e segurança do diagnóstico</span>
              </div>
              <p className="leading-relaxed">
                Esta ferramenta compara sequencialmente as estratégias{' '}
                <strong className="text-white/90">A (Completo)</strong>,{' '}
                <strong className="text-white/90">B (Por categoria)</strong> e{' '}
                <strong className="text-white/90">C (Híbrido com prefetch de 1 categoria)</strong>{' '}
                usando a sessão já autenticada, sem alterar favoritos, histórico, cache comercial ou
                preferências do aplicativo. Os relatórios exportados passam por projeção explícita de
                campos agregados e nunca incluem URLs, hosts, credenciais, cabeçalhos livres,
                mensagens brutas de erro, títulos ou IDs reais.
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

const DomainResultSection: React.FC<{
  domainResult: DomainBenchmarkResult;
}> = ({ domainResult }) => {
  const statusMeta = getExecutionStatusMeta(domainResult.domainStatus);

  return (
    <section className="bg-nc-bg-card border border-white/10 rounded-xl p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold text-white">{domainResult.domainLabel}</h3>
            <span
              className={`text-[11px] font-medium px-2 py-0.5 rounded-md border ${statusMeta.toneClass}`}
            >
              {statusMeta.label}
            </span>
          </div>
          <p className="text-xs text-nc-text-secondary">
            Categorias disponíveis: <span className="text-white">{domainResult.totalCategoriesAvailable}</span>{' '}
            · Slots avaliados:{' '}
            <span className="text-white">
              {domainResult.selectedCategorySlots
                .map((s) => `${s.slotId} (#${s.listPosition})`)
                .join(', ')}
            </span>{' '}
            · Ordem por rodada:{' '}
            <span className="text-white">
              {domainResult.executionOrderByRepetition
                .map((e) => `R${e.repetitionIndex}: ${e.order.join('→')}`)
                .join(' | ')}
            </span>
          </p>
        </div>

        <span
          className={`text-xs font-medium px-2.5 py-1 rounded-lg border ${getComplianceToneClass(
            domainResult.providerFilterDiagnosis.status
          )}`}
        >
          {formatComplianceLabel(domainResult.providerFilterDiagnosis.status)}
        </span>
      </div>

      {/* Diagnóstico de category_id */}
      <div className="rounded-lg bg-nc-bg-input border border-white/[0.08] px-3.5 py-2.5 text-xs text-white/90 space-y-1">
        <p>{domainResult.providerFilterDiagnosis.summaryPt}</p>
        <p className="text-[11px] text-nc-text-secondary">
          Referência completa (Estratégia A):{' '}
          {domainResult.fullCatalogReferenceAvailable
            ? `${domainResult.fullCatalogUniqueCount} registros únicos (${domainResult.fullCatalogReceivedCount} recebidos, ${domainResult.fullCatalogDuplicateCount} duplicados intra-resposta)`
            : 'Indisponível (Estratégia A não concluída)'}
        </p>
      </div>

      {/* Tabela comparativa das estratégias */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs tabular-nums">
          <thead>
            <tr className="border-b border-white/10 text-nc-text-secondary">
              <th className="py-2 pr-3 font-semibold">Estratégia</th>
              <th className="py-2 px-2.5 font-semibold text-right">1ª cat. pronta</th>
              <th className="py-2 px-2.5 font-semibold text-right">Outras cat.</th>
              <th className="py-2 px-2.5 font-semibold text-right">Reuso 1ª cat.</th>
              <th className="py-2 px-2.5 font-semibold text-right">Percurso s/ audit.</th>
              <th className="py-2 px-2.5 font-semibold text-right">Cobert. completa</th>
              <th className="py-2 px-2.5 font-semibold text-right">Auditoria</th>
              <th className="py-2 px-2.5 font-semibold text-right">Req / Ret / 429</th>
              <th className="py-2 px-2.5 font-semibold text-right">Únicos</th>
              <th className="py-2 px-2.5 font-semibold text-right">Payload UTF-16</th>
              <th className="py-2 px-2.5 font-semibold text-right">Rede (bytes)</th>
              <th className="py-2 pl-2.5 font-semibold text-right">Interseção (%)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.07] text-white/90">
            {ALL_STRATEGIES.map((sid) => {
              const agg = domainResult.strategies[sid];
              if (!agg) return null;
              const payloadDisplay =
                agg.payloadTextCharsStatus === 'unavailable'
                  ? 'Indisponível'
                  : `${formatMetric(agg.payloadTextCharsObservableAvg)} (${formatCompletenessBadge(
                      agg.payloadTextCharsStatus
                    )})`;
              const transferDisplay =
                agg.transferSizeStatus === 'unavailable'
                  ? 'Indisponível'
                  : `${formatMetric(agg.transferSizeObservableBytesAvg)} (${formatCompletenessBadge(
                      agg.transferSizeStatus
                    )})`;

              return (
                <tr key={sid}>
                  <td className="py-2.5 pr-3 font-medium text-white whitespace-nowrap">
                    <div>{STRATEGY_LABELS_PT[sid]}</div>
                    <div className="text-[11px] text-nc-text-secondary font-normal">
                      OK: {agg.completedRuns} · Erro: {agg.failedRuns} · Canc.: {agg.cancelledRuns}
                    </div>
                  </td>
                  <td className="py-2.5 px-2.5 text-right whitespace-nowrap">
                    {formatMetric(agg.firstCategoryReadyWithIndexMs.median, ' ms')}
                  </td>
                  <td className="py-2.5 px-2.5 text-right whitespace-nowrap">
                    {formatMetric(agg.otherCategoryAvgAccessMs.median, ' ms')}
                  </td>
                  <td className="py-2.5 px-2.5 text-right whitespace-nowrap">
                    {formatMetric(agg.reuseCategoryAccessMs.median, ' ms')}
                  </td>
                  <td className="py-2.5 px-2.5 text-right whitespace-nowrap">
                    {formatMetric(agg.strategyElapsedExcludingAuditMs.median, ' ms')}
                  </td>
                  <td className="py-2.5 px-2.5 text-right whitespace-nowrap">
                    {formatMetric(agg.fullCatalogCoverageMs.median, ' ms')}
                  </td>
                  <td className="py-2.5 px-2.5 text-right whitespace-nowrap text-nc-text-secondary">
                    {formatMetric(agg.integrityAuditOverheadMs.median, ' ms')}
                  </td>
                  <td className="py-2.5 px-2.5 text-right whitespace-nowrap">
                    {formatMetric(agg.requestCountAvg)} / {agg.retryCountTotal} /{' '}
                    {agg.rateLimitHitTotal}
                  </td>
                  <td className="py-2.5 px-2.5 text-right whitespace-nowrap">
                    {formatMetric(agg.uniqueRecordsAvg)}
                  </td>
                  <td className="py-2.5 px-2.5 text-right whitespace-nowrap text-nc-text-secondary">
                    {payloadDisplay}
                  </td>
                  <td className="py-2.5 px-2.5 text-right whitespace-nowrap text-nc-text-secondary">
                    {transferDisplay}
                  </td>
                  <td className="py-2.5 pl-2.5 text-right whitespace-nowrap">
                    {formatMetric(agg.domainCoveragePercentAvg, '%')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Detalhes por execução: etapas de troca (incl. prefetch Estratégia C), integridade e heap JS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {ALL_STRATEGIES.map((sid) => {
          const runs = domainResult.strategies[sid]?.runs ?? [];
          const latestRun: StrategyRunMetrics | undefined = runs[runs.length - 1];
          if (!latestRun) return null;

          return (
            <div
              key={sid}
              className="rounded-lg bg-nc-bg-input border border-white/[0.07] p-3 space-y-2 text-[11px]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-white">
                  Estratégia {sid} (R{latestRun.repetitionIndex}, pos. {latestRun.executionOrderPosition})
                </span>
                <span className="text-nc-text-secondary">{latestRun.status}</span>
              </div>

              {latestRun.errorDescriptionPt && (
                <p className="text-red-300">{latestRun.errorDescriptionPt}</p>
              )}

              <div className="space-y-1 text-nc-text-secondary tabular-nums">
                <div>
                  Categorias: {formatMetric(latestRun.timingBreakdown.categoriesFetchMs, ' ms')} ·
                  Leitura: {formatMetric(latestRun.timingBreakdown.catalogTransferAndReadMs, ' ms')} ·
                  Parse: {formatMetric(latestRun.timingBreakdown.jsonParseMs, ' ms')} · Índice:{' '}
                  {formatMetric(latestRun.timingBreakdown.indexBuildMs, ' ms')}
                </div>
                {latestRun.timingBreakdown.prefetchWorkDurationMs !== null && (
                  <div>
                    Trabalho de prefetch (C):{' '}
                    <span className="text-white">
                      {formatMetric(latestRun.timingBreakdown.prefetchWorkDurationMs, ' ms')}
                    </span>
                  </div>
                )}
                <div>
                  Duplicados intra: {latestRun.intraResponseDuplicateTotal} · Multi-cat. legítima:{' '}
                  {latestRun.multiCategoryLegitimateOverlapCount} · Repetição inesperada:{' '}
                  {latestRun.unexpectedCrossQueryRepeatCount}
                </div>
                <div>
                  Cobertura interseção:{' '}
                  {latestRun.coverageVsFullReference.status === 'available'
                    ? `${formatMetric(latestRun.coverageVsFullReference.domainCoveragePercent, '%')} (presentes: ${latestRun.coverageVsFullReference.presentInReferenceCount}, ausentes: ${latestRun.coverageVsFullReference.missingFromReferenceCount}, adicionais: ${latestRun.coverageVsFullReference.additionalNotInReferenceCount})`
                    : 'Indisponível (sem referência completa)'}
                </div>
                <div>
                  Heap JS amostrado:{' '}
                  {latestRun.jsHeapMb.available
                    ? `Δ estratégia ${formatMetric(latestRun.jsHeapMb.strategyDeltaMb, ' MB')} · Δ auditoria ${formatMetric(latestRun.jsHeapMb.auditDeltaMb, ' MB')} · máx. amostrado ${formatMetric(latestRun.jsHeapMb.maxSampledDuringStrategyMb, ' MB')}`
                    : 'Indisponível neste ambiente'}
                </div>
              </div>

              {latestRun.otherCategoryAccessSteps.length > 0 && (
                <div className="pt-1.5 border-t border-white/[0.07] space-y-1">
                  <p className="text-white/80 font-medium">Trocas de categoria:</p>
                  {latestRun.otherCategoryAccessSteps.map((step, i) => (
                    <div
                      key={`${step.slotId}-${i}`}
                      className="flex items-center justify-between gap-2 text-nc-text-secondary"
                    >
                      <span>
                        {step.slotId}: {formatStepSourceLabel(step.source)}
                      </span>
                      <span className="text-white tabular-nums shrink-0">
                        {formatMetric(step.durationMs, ' ms')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
