import type { Category, XtreamCredentials } from '../src/types';
import { readAutoLoginState, type StoredSessionState } from '../src/utils/accountUtils';
import {
  assertReportSanitized,
  buildFunctionalDependenciesMatrix,
  buildSanitizedBenchmarkReport,
  detectBenchmarkEnvironment,
  DOMAIN_LABELS_PT,
  formatSanitizedReportMarkdown,
  loadCategoriesForSelection,
  pickDefaultRepresentativeCategories,
  runDomainCatalogComparison,
  STRATEGY_LABELS_PT,
  type BenchmarkDomain,
  type BenchmarkStrategyId,
  type CategoryFilterComplianceStatus,
  type DomainBenchmarkResult,
  type SanitizedBenchmarkReport,
  type SelectedBenchmarkCategory,
  type StrategyRunMetrics,
} from './catalogBenchmarkCore';

type DomainMode = BenchmarkDomain | 'all';

interface AppState {
  sessionState: StoredSessionState;
  domainMode: DomainMode;
  repetitions: number;
  categoriesByDomain: Partial<Record<BenchmarkDomain, Category[]>>;
  selectedCategoriesByDomain: Partial<Record<BenchmarkDomain, SelectedBenchmarkCategory[]>>;
  isLoadingCategories: boolean;
  isRunning: boolean;
  activeController: AbortController | null;
  progressLogs: string[];
  lastReport: SanitizedBenchmarkReport | null;
  statusMessage: { kind: 'info' | 'ok' | 'warn' | 'error'; text: string } | null;
}

const state: AppState = {
  sessionState: readAutoLoginState(),
  domainMode: 'live',
  repetitions: 1,
  categoriesByDomain: {},
  selectedCategoriesByDomain: {},
  isLoadingCategories: false,
  isRunning: false,
  activeController: null,
  progressLogs: [],
  lastReport: null,
  statusMessage: null,
};

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Elemento diagnóstico ausente: #${id}`);
  }
  return el as T;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtNum(val: number | null | undefined, suffix = ''): string {
  if (val === null || val === undefined || !Number.isFinite(val)) {
    return 'Indisponível';
  }
  return `${val.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}${suffix}`;
}

function fmtBytes(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) {
    return 'Indisponível';
  }
  if (val < 1024) return `${val} B`;
  if (val < 1024 * 1024) return `${(val / 1024).toFixed(1)} KiB`;
  return `${(val / (1024 * 1024)).toFixed(2)} MiB`;
}

function complianceBadge(status: CategoryFilterComplianceStatus): {
  label: string;
  cls: string;
} {
  switch (status) {
    case 'respected':
      return { label: 'Filtro respeitado', cls: 'badge-ok' };
    case 'ignored_full_catalog':
      return { label: 'Filtro IGNORADO (catálogo completo)', cls: 'badge-err' };
    case 'partial_or_mixed':
      return { label: 'Parcial / itens fora de categoria', cls: 'badge-warn' };
    case 'empty_mismatch':
      return { label: 'Vazio divergente do completo', cls: 'badge-err' };
    case 'empty_consistent':
      return { label: 'Categorias vazias', cls: 'badge-muted' };
    default:
      return { label: 'Não aplicável', cls: 'badge-muted' };
  }
}

function setStatus(kind: 'info' | 'ok' | 'warn' | 'error', text: string): void {
  state.statusMessage = { kind, text };
  renderStatusBanner();
}

function appendLog(line: string): void {
  const time = new Date().toLocaleTimeString('pt-BR', { hour12: false });
  state.progressLogs.push(`[${time}] ${line}`);
  if (state.progressLogs.length > 200) {
    state.progressLogs.shift();
  }
  const logEl = byId<HTMLPreElement>('progress-log');
  logEl.textContent = state.progressLogs.join('\n');
  logEl.scrollTop = logEl.scrollHeight;
}

function getActiveCredentials(): XtreamCredentials | null {
  const s = state.sessionState;
  if (!s.canAutoLogin || !s.credentials) return null;
  return s.credentials;
}

function renderStatusBanner(): void {
  const banner = byId<HTMLDivElement>('status-banner');
  if (!state.statusMessage) {
    banner.hidden = true;
    banner.textContent = '';
    banner.className = 'status-banner';
    return;
  }
  banner.hidden = false;
  banner.className = `status-banner status-${state.statusMessage.kind}`;
  banner.textContent = state.statusMessage.text;
}

function renderSessionCard(): void {
  const statusEl = byId<HTMLDivElement>('session-status');
  const s = state.sessionState;
  if (s.canAutoLogin && s.credentials) {
    statusEl.innerHTML = `
      <span class="badge badge-ok">Conta autorizada pronta</span>
      <span class="muted">Sessão lida via <code>readAutoLoginState()</code> em modo somente leitura (credenciais ocultas e preservadas).</span>
    `;
  } else if (s.isAuthRejected) {
    statusEl.innerHTML = `
      <span class="badge badge-err">Sessão marcada como rejeitada</span>
      <span class="muted">Faça login novamente no aplicativo principal e clique em "Reverificar sessão".</span>
    `;
  } else {
    statusEl.innerHTML = `
      <span class="badge badge-warn">Nenhuma sessão salva encontrada</span>
      <span class="muted">Faça login no aplicativo comercial (<code>/</code>) neste mesmo navegador e clique em "Reverificar sessão".</span>
    `;
  }
}

function renderEnvironmentSummary(): void {
  const env = detectBenchmarkEnvironment();
  const container = byId<HTMLDivElement>('env-summary');
  container.innerHTML = `
    <div class="env-grid">
      <div><strong>Ambiente:</strong> ${escapeHtml(env.runtimeKind)} (${escapeHtml(env.viewportClass)})</div>
      <div><strong>Plugin Android CatalogFileTransfer:</strong> ${env.androidCatalogFileTransferAvailable ? 'Disponível' : 'Não disponível (Web/Browser)'}</div>
      <div><strong>Memória JS (<code>performance.memory</code>):</strong> ${env.memoryApiAvailable ? 'Disponível' : 'Indisponível neste navegador'}</div>
      <div><strong>Resource Timing API:</strong> ${env.resourceTimingApiAvailable ? 'Disponível (sujeito a CORS/Timing-Allow-Origin)' : 'Indisponível'}</div>
      <div><strong>Núcleos lógicos / RAM reportada:</strong> ${env.hardwareConcurrency ?? 'Indisponível'} / ${env.deviceMemoryGb !== null ? `${env.deviceMemoryGb} GiB` : 'Indisponível'}</div>
    </div>
    <p class="caveat-note">
      <strong>Particularidade Android:</strong> ${escapeHtml(env.transportArchitectureNotes.androidFullCatalog)}
      ${escapeHtml(env.transportArchitectureNotes.androidFilteredCatalog)}
      ${escapeHtml(env.transportArchitectureNotes.extrapolationWarning)}
    </p>
  `;
}

function renderControlsState(): void {
  const hasCreds = Boolean(getActiveCredentials());
  const busy = state.isRunning || state.isLoadingCategories;

  const domainSelect = byId<HTMLSelectElement>('domain-select');
  const repsSelect = byId<HTMLSelectElement>('repetitions-select');
  const loadCatsBtn = byId<HTMLButtonElement>('btn-load-categories');
  const startBtn = byId<HTMLButtonElement>('btn-start-benchmark');
  const cancelBtn = byId<HTMLButtonElement>('btn-cancel-benchmark');
  const refreshSessionBtn = byId<HTMLButtonElement>('btn-refresh-session');
  const copyJsonBtn = byId<HTMLButtonElement>('btn-copy-json');
  const exportJsonBtn = byId<HTMLButtonElement>('btn-export-json');
  const exportMdBtn = byId<HTMLButtonElement>('btn-export-md');

  domainSelect.disabled = busy;
  repsSelect.disabled = busy;
  refreshSessionBtn.disabled = busy;
  loadCatsBtn.disabled = !hasCreds || busy || state.domainMode === 'all';
  startBtn.disabled = !hasCreds || busy;
  cancelBtn.disabled = !busy;

  const hasReport = Boolean(state.lastReport);
  copyJsonBtn.disabled = !hasReport;
  exportJsonBtn.disabled = !hasReport;
  exportMdBtn.disabled = !hasReport;
}

function renderCategoryPicker(): void {
  const section = byId<HTMLDivElement>('category-picker');
  if (state.domainMode === 'all') {
    section.innerHTML = `
      <p class="muted">
        Modo <strong>Todos os 3 domínios (sequencial)</strong>: ao iniciar, a ferramenta carregará as categorias de
        <strong>TV ao Vivo</strong>, <strong>Filmes</strong> e <strong>Séries</strong> (uma por vez) e utilizará as
        categorias que você já selecionou para cada domínio ou, caso ainda não selecionadas, escolherá automaticamente
        até 3 categorias representativas (início, meio e terço final) por domínio.
      </p>
    `;
    return;
  }

  const domain = state.domainMode;
  const categories = state.categoriesByDomain[domain];
  if (!categories) {
    section.innerHTML = `
      <p class="muted">
        Nenhuma consulta foi executada ainda. Clique em <strong>"Carregar categorias do domínio"</strong> para escolher
        até 3 categorias representativas de <strong>${escapeHtml(DOMAIN_LABELS_PT[domain])}</strong> (ou inicie a
        comparação diretamente para seleção automática de até 3 categorias representativas).
      </p>
    `;
    return;
  }

  if (categories.length === 0) {
    section.innerHTML = `
      <p class="muted">O provedor retornou 0 categorias para ${escapeHtml(DOMAIN_LABELS_PT[domain])}.</p>
    `;
    return;
  }

  const selected = state.selectedCategoriesByDomain[domain] ?? [];
  const slots = [0, 1, 2].slice(0, Math.min(3, categories.length));

  const optionsHtml = (selectedId: string) =>
    categories
      .map((cat, idx) => {
        const cid = String(cat.category_id);
        const label = `#${idx + 1} — ${cat.category_name || 'Sem nome'}`;
        return `<option value="${escapeHtml(cid)}" ${cid === selectedId ? 'selected' : ''}>${escapeHtml(label)}</option>`;
      })
      .join('');

  section.innerHTML = `
    <p class="muted">
      ${categories.length} categorias encontradas em <strong>${escapeHtml(DOMAIN_LABELS_PT[domain])}</strong>.
      Selecione até ${slots.length} categorias distintas (os nomes abaixo aparecem somente localmente e são substituídos por
      <code>cat_1</code>, <code>cat_2</code>, <code>cat_3</code> no relatório exportado).
    </p>
    <div class="cat-select-grid">
      ${slots
        .map((slotIdx) => {
          const current = selected[slotIdx]?.categoryId ?? String(categories[slotIdx].category_id);
          const roleLabel =
            slotIdx === 0
              ? 'Categoria 1 (cat_1 — abertura inicial e reuso)'
              : slotIdx === 1
                ? 'Categoria 2 (cat_2 — prefetch em C / sob demanda em B)'
                : 'Categoria 3 (cat_3 — sob demanda em B e C)';
          return `
            <label class="field-group">
              <span>${escapeHtml(roleLabel)}</span>
              <select class="cat-slot-select" data-slot-index="${slotIdx}" ${state.isRunning ? 'disabled' : ''}>
                ${optionsHtml(current)}
              </select>
            </label>
          `;
        })
        .join('')}
    </div>
  `;

  section.querySelectorAll<HTMLSelectElement>('select.cat-slot-select').forEach((sel) => {
    sel.addEventListener('change', () => {
      syncSelectedCategoriesFromDom(domain);
    });
  });
}

function syncSelectedCategoriesFromDom(domain: BenchmarkDomain): void {
  const categories = state.categoriesByDomain[domain];
  if (!categories || categories.length === 0) return;

  const selects = Array.from(
    document.querySelectorAll<HTMLSelectElement>('#category-picker select.cat-slot-select')
  );
  const chosenIds: string[] = [];
  const result: SelectedBenchmarkCategory[] = [];

  for (const sel of selects) {
    const val = sel.value;
    if (!val || chosenIds.includes(val)) continue;
    chosenIds.push(val);
    const listIdx = categories.findIndex((c) => String(c.category_id) === val);
    result.push({
      slotId: `cat_${result.length + 1}`,
      categoryId: val,
      listPosition: listIdx >= 0 ? listIdx + 1 : result.length + 1,
    });
  }

  state.selectedCategoriesByDomain[domain] = result;
}

function renderStrategyRunDetails(run: StrategyRunMetrics): string {
  const stepsText = run.otherCategoryAccessSteps
    .map((step) => {
      const srcLabel =
        step.source === 'full_index'
          ? 'índice completo'
          : step.source === 'prefetch_cache'
            ? `prefetch concluído (${fmtNum(step.backgroundPrefetchDurationMs, ' ms')} em segundo plano)`
            : 'rede sob demanda';
      return `${step.slotId}: ${fmtNum(step.durationMs, ' ms')} (${srcLabel}, ${step.recordsInView} itens na visão)`;
    })
    .join(' | ');

  const heapText = run.jsHeapMb.available
    ? `Antes: ${fmtNum(run.jsHeapMb.beforeMb, ' MiB')} | Pico: ${fmtNum(run.jsHeapMb.peakMb, ' MiB')} | Depois: ${fmtNum(run.jsHeapMb.afterMb, ' MiB')} (Δ ${fmtNum(run.jsHeapMb.deltaMb, ' MiB')})`
    : 'Indisponível neste navegador';

  const transferNote =
    run.network.transferSizeBytesTotal !== null
      ? `Transferência rede (Resource Timing): ${fmtBytes(run.network.transferSizeBytesTotal)} (codificado: ${fmtBytes(run.network.encodedBodySizeBytesTotal)}, descomprimido: ${fmtBytes(run.network.decodedBodySizeBytesTotal)})`
      : run.network.resourceTimingRestrictedAttempts > 0
        ? `Transferência rede indisponível (${run.network.resourceTimingRestrictedAttempts} tentativa(s) bloqueadas por CORS/Timing-Allow-Origin)`
        : 'Transferência rede indisponível neste transporte';

  const cacheNote =
    run.network.browserHttpCacheHitAttempts > 0
      ? `Cache HTTP do navegador detectado em ${run.network.browserHttpCacheHitAttempts} tentativa(s)`
      : run.network.cacheHeadersObserved.cacheControlValues.length > 0
        ? `Cabeçalhos observados: ${run.network.cacheHeadersObserved.cacheControlValues.join(', ')}`
        : 'Sem indicação explícita de hit em cache HTTP local (cache do provedor/CDN não controlável)';

  return `
    <div class="run-detail-card">
      <div class="run-detail-head">
        <strong>${escapeHtml(run.strategyLabel)}</strong>
        <span class="badge ${run.status === 'completed' ? 'badge-ok' : run.status === 'cancelled' ? 'badge-warn' : 'badge-err'}">
          ${run.status === 'completed' ? 'Concluída' : run.status === 'cancelled' ? 'Cancelada' : 'Erro'} (Rodada ${run.repetitionIndex})
        </span>
      </div>
      ${run.errorMessage ? `<p class="error-inline">${escapeHtml(run.errorMessage)}</p>` : ''}
      <ul class="detail-list">
        <li><strong>Categorias:</strong> ${fmtNum(run.categoriesFetchMs, ' ms')} (${run.categoriesCount} categorias)</li>
        <li><strong>Consultas / Parse / Índice:</strong> fetch ${fmtNum(run.fetchDurationTotalMs, ' ms')} | JSON.parse ${fmtNum(run.parseDurationTotalMs, ' ms')} | índice+visão ${fmtNum(run.indexDurationTotalMs, ' ms')} | espera coordenador ${fmtNum(run.coordinatorWaitTotalMs, ' ms')}</li>
        <li><strong>Outras categorias:</strong> ${stepsText ? escapeHtml(stepsText) : 'Nenhuma adicional selecionada'}</li>
        <li><strong>Payload texto descomprimido (sem re-serializar):</strong> ${fmtNum(run.network.payloadTextCharsTotal, ' chars')} | Content-Length exposto: ${fmtBytes(run.network.contentLengthHeaderBytesTotal)}</li>
        <li><strong>Rede:</strong> ${escapeHtml(transferNote)}</li>
        <li><strong>Cache / Transporte:</strong> ${escapeHtml(cacheNote)} | Transportes: ${escapeHtml(run.network.transportKindsUsed.join(', ') || 'nenhum')}</li>
        <li><strong>Memória JS:</strong> ${escapeHtml(heapText)}</li>
        <li><strong>Requisições / Tentativas / Retentativas / HTTP 429:</strong> ${run.requestCount} / ${run.attemptCount} / ${run.retryCount} / ${run.rateLimitHitCount} (espera 429: ${fmtNum(run.rateLimitWaitMs, ' ms')})</li>
      </ul>
    </div>
  `;
}

function renderDomainResult(dom: DomainBenchmarkResult): string {
  const diagBadge = complianceBadge(dom.providerFilterDiagnosis.status);

  const rowsHtml = (['A', 'B', 'C'] as BenchmarkStrategyId[])
    .map((sid) => {
      const s = dom.strategies[sid];
      if (!s || (s.completedRuns === 0 && s.failedRuns === 0 && s.cancelledRuns === 0)) {
        return '';
      }
      const p95Label = s.firstCategoryReadyWithIndexMs.p95Available
        ? fmtNum(s.firstCategoryReadyWithIndexMs.p95, ' ms')
        : 'Amostra insuf.';
      return `
        <tr>
          <td><strong>${escapeHtml(STRATEGY_LABELS_PT[sid])}</strong></td>
          <td>${fmtNum(s.firstCategoryReadyWithIndexMs.median, ' ms')}</td>
          <td>${fmtNum(s.otherCategoryAvgAccessMs.median, ' ms')}</td>
          <td>${fmtNum(s.reuseCategoryAccessMs.median, ' ms')}</td>
          <td>${fmtNum(s.journeyTotalMs.median, ' ms')}</td>
          <td>${fmtNum(s.fullCatalogCoverageMs.median, ' ms')}</td>
          <td>${fmtNum(s.requestCountAvg)} / ${s.retryCountTotal}</td>
          <td>${fmtNum(s.uniqueRecordsAvg)}</td>
          <td>${fmtNum(s.payloadTextCharsAvg, ' chars')}</td>
          <td>${fmtBytes(s.transferSizeBytesAvg)}</td>
          <td>${fmtNum(s.domainCoverageVsFullPercentAvg, '%')}</td>
          <td>${escapeHtml(p95Label)}</td>
        </tr>
      `;
    })
    .join('');

  const integrityChecks = [
    ...dom.strategies.B.runs.flatMap((r) => r.categoryIntegrity.map((c) => ({ strat: 'B', rep: r.repetitionIndex, c }))),
    ...dom.strategies.C.runs.flatMap((r) => r.categoryIntegrity.map((c) => ({ strat: 'C', rep: r.repetitionIndex, c }))),
  ];

  const integrityRowsHtml = integrityChecks
    .map(({ strat, rep, c }) => {
      const b = complianceBadge(c.compliance);
      return `
        <tr>
          <td>Estratégia ${strat} (R${rep})</td>
          <td><code>${escapeHtml(c.slotId)}</code></td>
          <td><span class="badge ${b.cls}">${escapeHtml(b.label)}</span></td>
          <td>${c.receivedCount} / ${c.uniqueIdCount}</td>
          <td>${c.duplicateIdCount}</td>
          <td>${c.exactPrimaryCategoryMatchCount} (+${c.secondaryCategoryIdsMatchCount} sec.)</td>
          <td>${c.outOfCategoryCount}</td>
          <td>${c.vsFullCatalog.fullCatalogCategoryUniqueCount ?? '—'}</td>
          <td>${c.vsFullCatalog.missingComparedToFull ?? '—'} / +${c.vsFullCatalog.extraComparedToFull ?? '—'}</td>
        </tr>
      `;
    })
    .join('');

  const allRuns = [
    ...dom.strategies.A.runs,
    ...dom.strategies.B.runs,
    ...dom.strategies.C.runs,
  ];

  return `
    <article class="domain-result-block">
      <header class="domain-result-header">
        <h3>${escapeHtml(dom.domainLabel)}</h3>
        <span class="badge ${diagBadge.cls}">${escapeHtml(diagBadge.label)}</span>
      </header>
      <p class="muted">
        Categorias no domínio: <strong>${dom.totalCategoriesAvailable}</strong> |
        Slots avaliados: <strong>${dom.selectedCategorySlots.map((s) => `${s.slotId} (#${s.listPosition})`).join(', ') || 'nenhum'}</strong> |
        Referência completa (A): <strong>${dom.fullCatalogReferenceAvailable ? `${dom.fullCatalogUniqueCount} únicos (${dom.fullCatalogReceivedCount} recebidos, ${dom.fullCatalogDuplicateCount} duplicados)` : 'indisponível'}</strong>
      </p>
      <p class="diagnosis-box">${escapeHtml(dom.providerFilterDiagnosis.summaryPt)}</p>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Estratégia</th>
              <th>1ª cat. pronta</th>
              <th>Outras cat. (mediana)</th>
              <th>Reuso 1ª cat.</th>
              <th>Percurso total</th>
              <th>Cobertura completa</th>
              <th>Req. / Retent.</th>
              <th>Registros únicos</th>
              <th>Payload texto (descomp.)</th>
              <th>Transferência rede</th>
              <th>Cobertura vs A</th>
              <th>P95 (mín. 20)</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>

      ${
        integrityRowsHtml
          ? `
        <h4>Integridade funcional do filtro <code>category_id</code></h4>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Execução</th>
                <th>Categoria</th>
                <th>Conformidade</th>
                <th>Recebidos / Únicos</th>
                <th>Duplicados</th>
                <th>Na categoria</th>
                <th>Fora da categoria</th>
                <th>Únicos na A</th>
                <th>Faltantes / Extras vs A</th>
              </tr>
            </thead>
            <tbody>
              ${integrityRowsHtml}
            </tbody>
          </table>
        </div>
      `
          : ''
      }

      <details class="run-details-disclosure">
        <summary>Detalhes por execução (tempos de parse/índice, memória JS, cache HTTP e transporte)</summary>
        <div class="run-details-grid">
          ${allRuns.map(renderStrategyRunDetails).join('')}
        </div>
      </details>
    </article>
  `;
}

function renderResults(): void {
  const resultsEl = byId<HTMLDivElement>('results-container');
  if (!state.lastReport || state.lastReport.domains.length === 0) {
    resultsEl.innerHTML =
      '<p class="muted">Nenhum resultado ainda. Selecione o domínio e clique em <strong>"Iniciar comparação"</strong>.</p>';
    return;
  }

  resultsEl.innerHTML = state.lastReport.domains.map(renderDomainResult).join('');
}

function renderFunctionalMatrix(): void {
  const tbody = byId<HTMLTableSectionElement>('functional-matrix-body');
  const rows = buildFunctionalDependenciesMatrix();
  tbody.innerHTML = rows
    .map(
      (r) => `
      <tr>
        <td><strong>${escapeHtml(r.feature)}</strong></td>
        <td>${escapeHtml(r.strategyA)}</td>
        <td>${escapeHtml(r.strategyB)}</td>
        <td>${escapeHtml(r.strategyC)}</td>
        <td class="muted">${escapeHtml(r.riskNote)}</td>
      </tr>
    `
    )
    .join('');
}

async function handleLoadCategories(): Promise<void> {
  const creds = getActiveCredentials();
  if (!creds) {
    setStatus('warn', 'Nenhuma conta autorizada disponível na sessão local.');
    return;
  }
  if (state.domainMode === 'all') return;

  const domain = state.domainMode;
  const controller = new AbortController();
  state.isLoadingCategories = true;
  state.activeController = controller;
  setStatus('info', `Carregando categorias de ${DOMAIN_LABELS_PT[domain]}...`);
  appendLog(`Consultando categorias de ${DOMAIN_LABELS_PT[domain]}...`);
  renderControlsState();

  try {
    const categories = await loadCategoriesForSelection(creds, domain, controller.signal);
    state.categoriesByDomain[domain] = categories;
    state.selectedCategoriesByDomain[domain] = pickDefaultRepresentativeCategories(
      categories,
      3
    );
    appendLog(
      `${categories.length} categorias carregadas para ${DOMAIN_LABELS_PT[domain]}.`
    );
    setStatus(
      'ok',
      `${categories.length} categorias carregadas para ${DOMAIN_LABELS_PT[domain]}. Ajuste as categorias representativas se desejar e inicie a comparação.`
    );
  } catch (err: any) {
    if (controller.signal.aborted || err?.isAborted) {
      appendLog('Carregamento de categorias cancelado pelo usuário.');
      setStatus('warn', 'Carregamento de categorias cancelado.');
    } else {
      const msg = String(err?.message || 'Falha ao carregar categorias do provedor.');
      appendLog(`Erro ao carregar categorias: ${msg}`);
      setStatus('error', msg);
    }
  } finally {
    state.isLoadingCategories = false;
    state.activeController = null;
    renderCategoryPicker();
    renderControlsState();
  }
}

async function handleStartBenchmark(): Promise<void> {
  const creds = getActiveCredentials();
  if (!creds) {
    setStatus('warn', 'Nenhuma conta autorizada disponível na sessão local.');
    return;
  }

  const domainsToRun: BenchmarkDomain[] =
    state.domainMode === 'all' ? ['live', 'vod', 'series'] : [state.domainMode];

  if (state.domainMode !== 'all' && state.categoriesByDomain[state.domainMode]) {
    syncSelectedCategoriesFromDom(state.domainMode);
  }

  const controller = new AbortController();
  state.isRunning = true;
  state.activeController = controller;
  state.progressLogs = [];
  byId<HTMLPreElement>('progress-log').textContent = '';
  setStatus('info', 'Comparação em andamento (execução sequencial sem reprodução de vídeo)...');
  renderControlsState();

  const domainResults: DomainBenchmarkResult[] = [];
  const strategies: BenchmarkStrategyId[] = ['A', 'B', 'C'];

  try {
    for (const domain of domainsToRun) {
      if (controller.signal.aborted) break;

      let selected = state.selectedCategoriesByDomain[domain];
      if (!selected || selected.length === 0) {
        appendLog(
          `[${DOMAIN_LABELS_PT[domain]}] Obtendo categorias para selecionar representantes...`
        );
        const cats = await loadCategoriesForSelection(creds, domain, controller.signal);
        state.categoriesByDomain[domain] = cats;
        selected = pickDefaultRepresentativeCategories(cats, 3);
        state.selectedCategoriesByDomain[domain] = selected;
        if (state.domainMode === domain) {
          renderCategoryPicker();
        }
      }

      if (controller.signal.aborted) break;

      if (!selected || selected.length === 0) {
        appendLog(
          `[${DOMAIN_LABELS_PT[domain]}] Nenhuma categoria válida retornada pelo provedor; domínio ignorado.`
        );
        continue;
      }

      const result = await runDomainCatalogComparison({
        credentials: creds,
        domain,
        selectedCategories: selected,
        strategies,
        repetitions: state.repetitions,
        signal: controller.signal,
        onProgress: (ev) => {
          appendLog(ev.messagePt);
        },
      });
      domainResults.push(result);
    }

    if (domainResults.length > 0) {
      state.lastReport = buildSanitizedBenchmarkReport({
        domains: domainResults,
        strategiesCompared: strategies,
        repetitionsPerDomain: state.repetitions,
      });
      renderResults();
    }

    if (controller.signal.aborted) {
      appendLog('Comparação interrompida pelo usuário.');
      setStatus(
        'warn',
        domainResults.length > 0
          ? 'Comparação cancelada. Resultados parciais já coletados foram exibidos.'
          : 'Comparação cancelada antes da conclusão.'
      );
    } else {
      appendLog('Todas as medições solicitadas foram concluídas.');
      setStatus(
        'ok',
        'Comparação concluída. Revise os resultados abaixo ou exporte o relatório sanitizado.'
      );
    }
  } catch (err: any) {
    if (controller.signal.aborted || err?.isAborted) {
      appendLog('Comparação cancelada pelo usuário.');
      setStatus('warn', 'Comparação cancelada pelo usuário.');
    } else {
      const msg = String(err?.message || 'Erro inesperado durante a comparação.');
      appendLog(`Erro: ${msg}`);
      setStatus('error', msg);
    }
  } finally {
    state.isRunning = false;
    state.activeController = null;
    renderCategoryPicker();
    renderControlsState();
  }
}

function handleCancel(): void {
  if (!state.activeController) return;
  appendLog('Solicitando cancelamento imediato das consultas em andamento...');
  state.activeController.abort();
}

function getVerifiedSerializedReport(format: 'json' | 'markdown'): string | null {
  if (!state.lastReport) return null;
  const serialized =
    format === 'json'
      ? JSON.stringify(state.lastReport, null, 2)
      : formatSanitizedReportMarkdown(state.lastReport);

  const audit = assertReportSanitized(serialized, getActiveCredentials());
  if (!audit.safe) {
    setStatus(
      'error',
      `Exportação bloqueada por segurança: padrão sensível detectado (${audit.leakedTokens.join(', ')}).`
    );
    return null;
  }
  return serialized;
}

async function handleCopyJson(): Promise<void> {
  const serialized = getVerifiedSerializedReport('json');
  if (!serialized) return;
  try {
    await navigator.clipboard.writeText(serialized);
    setStatus('ok', 'Relatório JSON sanitizado copiado para a área de transferência.');
  } catch {
    setStatus(
      'warn',
      'Não foi possível copiar automaticamente pela API de área de transferência. Utilize "Exportar JSON sanitizado".'
    );
  }
}

function triggerFileDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function handleExport(format: 'json' | 'markdown'): void {
  const serialized = getVerifiedSerializedReport(format);
  if (!serialized) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  if (format === 'json') {
    triggerFileDownload(
      `north-code-c01-benchmark-${stamp}.json`,
      serialized,
      'application/json;charset=utf-8'
    );
    setStatus('ok', 'Arquivo JSON sanitizado exportado localmente.');
  } else {
    triggerFileDownload(
      `north-code-c01-benchmark-${stamp}.md`,
      serialized,
      'text/markdown;charset=utf-8'
    );
    setStatus('ok', 'Arquivo Markdown sanitizado exportado localmente.');
  }
}

function init(): void {
  renderSessionCard();
  renderEnvironmentSummary();
  renderCategoryPicker();
  renderFunctionalMatrix();
  renderResults();
  renderControlsState();

  byId<HTMLSelectElement>('domain-select').addEventListener('change', (ev) => {
    state.domainMode = (ev.target as HTMLSelectElement).value as DomainMode;
    renderCategoryPicker();
    renderControlsState();
  });

  byId<HTMLSelectElement>('repetitions-select').addEventListener('change', (ev) => {
    const val = Number((ev.target as HTMLSelectElement).value);
    state.repetitions = Number.isFinite(val) && val >= 1 ? Math.floor(val) : 1;
  });

  byId<HTMLButtonElement>('btn-refresh-session').addEventListener('click', () => {
    state.sessionState = readAutoLoginState();
    renderSessionCard();
    renderControlsState();
    setStatus(
      state.sessionState.canAutoLogin ? 'ok' : 'warn',
      state.sessionState.canAutoLogin
        ? 'Sessão local autorizada verificada com sucesso (somente leitura).'
        : 'Nenhuma sessão autorizada pronta encontrada no navegador.'
    );
  });

  byId<HTMLButtonElement>('btn-load-categories').addEventListener('click', () => {
    void handleLoadCategories();
  });

  byId<HTMLButtonElement>('btn-start-benchmark').addEventListener('click', () => {
    void handleStartBenchmark();
  });

  byId<HTMLButtonElement>('btn-cancel-benchmark').addEventListener('click', () => {
    handleCancel();
  });

  byId<HTMLButtonElement>('btn-copy-json').addEventListener('click', () => {
    void handleCopyJson();
  });

  byId<HTMLButtonElement>('btn-export-json').addEventListener('click', () => {
    handleExport('json');
  });

  byId<HTMLButtonElement>('btn-export-md').addEventListener('click', () => {
    handleExport('markdown');
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
