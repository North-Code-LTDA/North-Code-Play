import type { XtreamCredentials } from '../types';
import { normalizeServerUrl } from '../utils/mediaUtils';
import {
  createAbortError,
  createHttpError,
  type TransportError,
} from './httpTransport';

export type XtreamRequestLane = 'auth' | 'catalog' | 'details' | 'epg';

export type XtreamRequestPriority =
  | 'critical'
  | 'user'
  | 'high'
  | 'normal'
  | 'background';

export interface XtreamCoordinatorConfig {
  maxGlobalConcurrent: number;
  maxCatalogConcurrent: number;
  maxEpgConcurrent: number;
  rateLimitMinWaitMs: number;
  rateLimitMaxAutoWaitMs: number;
  rateLimitMissingHeaderCooldownMs: number;
  starvationAgingStepMs: number;
  starvationAgingStepPoints: number;
  starvationMaxBoost: number;
}

export const XTREAM_COORDINATOR_DEFAULTS: Readonly<XtreamCoordinatorConfig> = {
  maxGlobalConcurrent: 4,
  maxCatalogConcurrent: 2,
  maxEpgConcurrent: 3,
  rateLimitMinWaitMs: 1000,
  rateLimitMaxAutoWaitMs: 15000,
  rateLimitMissingHeaderCooldownMs: 3000,
  starvationAgingStepMs: 4000,
  starvationAgingStepPoints: 20,
  starvationMaxBoost: 70,
};

const PRIORITY_WEIGHTS: Record<XtreamRequestPriority, number> = {
  critical: 100,
  user: 80,
  high: 60,
  normal: 40,
  background: 20,
};

function priorityToWeight(
  priority: XtreamRequestPriority = 'normal',
  priorityHint: number = 0
): number {
  const base = PRIORITY_WEIGHTS[priority] ?? PRIORITY_WEIGHTS.normal;
  const clampedHint = Number.isFinite(priorityHint)
    ? Math.max(-10, Math.min(10, priorityHint))
    : 0;
  return base + clampedHint;
}

let config: XtreamCoordinatorConfig = { ...XTREAM_COORDINATOR_DEFAULTS };
let customClockFn: (() => number) | null = null;

function getNowMs(): number {
  if (customClockFn) {
    return customClockFn();
  }
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export interface XtreamSlotHandle {
  release: () => void;
}

interface SlotWaiter {
  id: number;
  lane: XtreamRequestLane;
  basePriority: number;
  enqueuedAtMs: number;
  sessionEpoch: number;
  signal?: AbortSignal;
  settled: boolean;
  resolve: (handle: XtreamSlotHandle) => void;
  reject: (err: Error) => void;
  cleanup: () => void;
}

interface ProviderRateLimitState {
  blockedUntilMs: number;
  hasExplicitRetryAfter: boolean;
  sessionEpoch: number;
}

interface ActiveSleepEntry {
  sessionEpoch: number;
  cancelForSessionReset: () => void;
}

interface CoordinatedInFlightEntry<T = any> {
  dedupeKey: string;
  sessionEpoch: number;
  lane: XtreamRequestLane;
  basePriority: number;
  sharedController: AbortController;
  activeConsumers: number;
  settled: boolean;
  currentSlotWaiter: SlotWaiter | null;
  promise: Promise<T>;
}

let currentSessionEpoch = 1;
let nextWaiterSeq = 1;
let activeGlobal = 0;
const activeByLane: Record<XtreamRequestLane, number> = {
  auth: 0,
  catalog: 0,
  details: 0,
  epg: 0,
};

const slotQueue: SlotWaiter[] = [];
const inFlightMap = new Map<string, CoordinatedInFlightEntry>();
const rateLimitStates = new Map<string, ProviderRateLimitState>();
const activeSleeps = new Set<ActiveSleepEntry>();
const activeNonDedupedControllers = new Set<AbortController>();

export function getXtreamCoordinatorRateLimitMinWaitMs(): number {
  return config.rateLimitMinWaitMs;
}

function buildCanonicalParamsKey(
  params?: Record<string, string | number>
): string {
  if (!params) return '';
  const entries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      entries.push([key, String(value)]);
    }
  }
  if (entries.length === 0) return '';
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return entries.map(([k, v]) => `${k}=${v}`).join('&');
}

function buildDedupeKey(
  credentials: XtreamCredentials,
  canonicalServer: string,
  action: string | undefined,
  params: Record<string, string | number> | undefined,
  sessionEpoch: number
): string {
  const server = canonicalServer.replace(/\/+$/, '');
  const username = String(credentials.username ?? '');
  const password = String(credentials.password ?? '');
  const actionPart = action ? String(action) : '__auth__';
  const paramsPart = buildCanonicalParamsKey(params);
  // Chave interna de deduplicação nunca deve ser logada nem exposta em erros/estatísticas
  return `${sessionEpoch}\0${server}\0${username}\0${password}\0${actionPart}\0${paramsPart}`;
}

function buildRateLimitScopeKey(
  canonicalServer: string,
  sessionEpoch: number
): string {
  const server = canonicalServer.replace(/\/+$/, '');
  return `${sessionEpoch}\0${server}`;
}

function canAcquireLane(lane: XtreamRequestLane): boolean {
  if (activeGlobal >= config.maxGlobalConcurrent) {
    return false;
  }
  if (lane === 'catalog' && activeByLane.catalog >= config.maxCatalogConcurrent) {
    return false;
  }
  if (lane === 'epg' && activeByLane.epg >= config.maxEpgConcurrent) {
    return false;
  }
  return true;
}

function computeEffectivePriority(waiter: SlotWaiter, nowMs: number): number {
  if (
    waiter.basePriority >= PRIORITY_WEIGHTS.critical ||
    config.starvationAgingStepMs <= 0 ||
    config.starvationMaxBoost <= 0
  ) {
    return waiter.basePriority;
  }
  const waitedMs = Math.max(0, nowMs - waiter.enqueuedAtMs);
  const steps = Math.floor(waitedMs / config.starvationAgingStepMs);
  if (steps <= 0) {
    return waiter.basePriority;
  }
  const boost = Math.min(
    config.starvationMaxBoost,
    steps * config.starvationAgingStepPoints
  );
  return waiter.basePriority + boost;
}

function createSlotHandle(
  lane: XtreamRequestLane,
  epoch: number
): XtreamSlotHandle {
  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      if (epoch !== currentSessionEpoch) {
        return;
      }
      activeGlobal = Math.max(0, activeGlobal - 1);
      activeByLane[lane] = Math.max(0, activeByLane[lane] - 1);
      pumpSlotQueue();
    },
  };
}

function pumpSlotQueue(): void {
  if (slotQueue.length === 0) return;

  const nowMs = getNowMs();

  // Remove any stale or already-aborted waiters first
  for (let i = slotQueue.length - 1; i >= 0; i--) {
    const waiter = slotQueue[i];
    if (
      waiter.settled ||
      waiter.sessionEpoch !== currentSessionEpoch ||
      waiter.signal?.aborted
    ) {
      slotQueue.splice(i, 1);
      if (!waiter.settled) {
        waiter.settled = true;
        waiter.cleanup();
        waiter.reject(createAbortError());
      }
    }
  }

  while (activeGlobal < config.maxGlobalConcurrent && slotQueue.length > 0) {
    let bestIdx = -1;
    let bestPriority = -Infinity;
    let bestSeq = Infinity;

    for (let i = 0; i < slotQueue.length; i++) {
      const waiter = slotQueue[i];
      if (!canAcquireLane(waiter.lane)) {
        continue;
      }
      const effPriority = computeEffectivePriority(waiter, nowMs);
      if (
        effPriority > bestPriority ||
        (effPriority === bestPriority && waiter.id < bestSeq)
      ) {
        bestIdx = i;
        bestPriority = effPriority;
        bestSeq = waiter.id;
      }
    }

    if (bestIdx === -1) {
      break;
    }

    const chosen = slotQueue.splice(bestIdx, 1)[0];
    if (!chosen || chosen.settled) {
      continue;
    }
    if (chosen.sessionEpoch !== currentSessionEpoch || chosen.signal?.aborted) {
      chosen.settled = true;
      chosen.cleanup();
      chosen.reject(createAbortError());
      continue;
    }

    chosen.settled = true;
    chosen.cleanup();
    activeGlobal++;
    activeByLane[chosen.lane]++;
    chosen.resolve(createSlotHandle(chosen.lane, chosen.sessionEpoch));
  }
}

export function getXtreamCoordinatorSessionEpoch(): number {
  return currentSessionEpoch;
}

/**
 * Invalida a época de sessão atual no coordenador compartilhado (ex.: logout ou troca de conta).
 * Aborta operações pendentes, rejeita esperas obsoletas com AbortError e limpa janelas de rate-limit
 * da sessão encerrada sem contaminar a nova sessão.
 */
export function invalidateXtreamCoordinatorSession(): void {
  currentSessionEpoch++;

  const oldEntries = Array.from(inFlightMap.values());
  inFlightMap.clear();
  for (const entry of oldEntries) {
    entry.settled = true;
    entry.currentSlotWaiter = null;
    try {
      entry.sharedController.abort();
    } catch {
      // ignore
    }
  }

  const oldWaiters = slotQueue.splice(0, slotQueue.length);
  for (const waiter of oldWaiters) {
    if (!waiter.settled) {
      waiter.settled = true;
      waiter.cleanup();
      waiter.reject(createAbortError());
    }
  }

  const oldSleeps = Array.from(activeSleeps);
  activeSleeps.clear();
  for (const sleepEntry of oldSleeps) {
    sleepEntry.cancelForSessionReset();
  }

  const oldNonDeduped = Array.from(activeNonDedupedControllers);
  activeNonDedupedControllers.clear();
  for (const controller of oldNonDeduped) {
    try {
      controller.abort();
    } catch {
      // ignore
    }
  }

  rateLimitStates.clear();
  activeGlobal = 0;
  activeByLane.auth = 0;
  activeByLane.catalog = 0;
  activeByLane.details = 0;
  activeByLane.epg = 0;
}

/**
 * Aguarda `ms` milissegundos respeitando tanto `AbortSignal` quanto troca/encerramento de sessão.
 */
export function sleepWithAbortAndSession(
  ms: number,
  signal: AbortSignal | undefined,
  sessionEpoch: number
): Promise<void> {
  if (signal?.aborted || sessionEpoch !== currentSessionEpoch) {
    return Promise.reject(createAbortError());
  }
  const waitMs = Math.max(0, Math.ceil(ms));
  if (waitMs === 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    let done = false;

    const cleanup = () => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      activeSleeps.delete(sleepEntry);
    };

    const onAbort = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cleanup();
      reject(createAbortError());
    };

    const sleepEntry: ActiveSleepEntry = {
      sessionEpoch,
      cancelForSessionReset: onAbort,
    };

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      if (signal?.aborted || sessionEpoch !== currentSessionEpoch) {
        reject(createAbortError());
        return;
      }
      resolve();
    }, waitMs);

    activeSleeps.add(sleepEntry);
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

export function recordProviderRateLimit(
  canonicalServer: string,
  sessionEpoch: number,
  retryAfterMs?: number
): void {
  if (sessionEpoch !== currentSessionEpoch) return;
  const scopeKey = buildRateLimitScopeKey(canonicalServer, sessionEpoch);
  const nowMs = getNowMs();
  const existing = rateLimitStates.get(scopeKey);
  const existingUntil =
    existing && existing.sessionEpoch === sessionEpoch ? existing.blockedUntilMs : 0;

  const hasValidExplicitRetryAfter =
    typeof retryAfterMs === 'number' &&
    Number.isFinite(retryAfterMs) &&
    retryAfterMs >= 0;

  if (hasValidExplicitRetryAfter) {
    const effectiveWait =
      retryAfterMs > config.rateLimitMaxAutoWaitMs
        ? retryAfterMs
        : Math.max(config.rateLimitMinWaitMs, retryAfterMs);
    const nextUntil = Math.max(existingUntil, nowMs + effectiveWait);
    rateLimitStates.set(scopeKey, {
      blockedUntilMs: nextUntil,
      hasExplicitRetryAfter: true,
      sessionEpoch,
    });
    return;
  }

  // Sem Retry-After válido: aplica janela conservadora curta para evitar tempestade
  // concorrente sem fabricar um valor de Retry-After nem autorizar retentativa automática.
  const cooldownMs = Math.max(0, config.rateLimitMissingHeaderCooldownMs);
  if (cooldownMs <= 0) {
    return;
  }
  const nextUntil = Math.max(existingUntil, nowMs + cooldownMs);
  const preserveExplicit =
    Boolean(existing?.hasExplicitRetryAfter) && existingUntil >= nextUntil;
  rateLimitStates.set(scopeKey, {
    blockedUntilMs: nextUntil,
    hasExplicitRetryAfter: preserveExplicit,
    sessionEpoch,
  });
}

function createSharedRateLimitError(
  remainingMs: number,
  hasExplicitRetryAfter: boolean
): TransportError {
  const err = createHttpError(429);
  if (hasExplicitRetryAfter && Number.isFinite(remainingMs) && remainingMs >= 0) {
    err.retryAfterMs = Math.ceil(remainingMs);
  }
  return err;
}

export interface OperationRateLimitBudget {
  waitedMs: number;
}

export function hasActiveProviderRateLimit(
  canonicalServer: string,
  sessionEpoch: number
): boolean {
  if (sessionEpoch !== currentSessionEpoch) return false;
  const scopeKey = buildRateLimitScopeKey(canonicalServer, sessionEpoch);
  const state = rateLimitStates.get(scopeKey);
  if (!state || state.sessionEpoch !== sessionEpoch) {
    return false;
  }
  const remainingMs = state.blockedUntilMs - getNowMs();
  if (remainingMs <= 0) {
    if (rateLimitStates.get(scopeKey) === state) {
      rateLimitStates.delete(scopeKey);
    }
    return false;
  }
  return true;
}

export async function waitForProviderRateLimitGate(
  canonicalServer: string,
  sessionEpoch: number,
  signal?: AbortSignal,
  budget?: OperationRateLimitBudget
): Promise<void> {
  if (signal?.aborted || sessionEpoch !== currentSessionEpoch) {
    throw createAbortError();
  }

  const scopeKey = buildRateLimitScopeKey(canonicalServer, sessionEpoch);
  const sharedBudget: OperationRateLimitBudget = budget ?? { waitedMs: 0 };

  while (true) {
    if (signal?.aborted || sessionEpoch !== currentSessionEpoch) {
      throw createAbortError();
    }

    const state = rateLimitStates.get(scopeKey);
    if (!state || state.sessionEpoch !== sessionEpoch) {
      return;
    }

    const remainingMs = state.blockedUntilMs - getNowMs();
    if (remainingMs <= 0) {
      if (rateLimitStates.get(scopeKey) === state) {
        rateLimitStates.delete(scopeKey);
      }
      return;
    }

    const remainingBudgetMs = config.rateLimitMaxAutoWaitMs - sharedBudget.waitedMs;
    if (
      remainingMs > config.rateLimitMaxAutoWaitMs ||
      remainingMs > remainingBudgetMs
    ) {
      throw createSharedRateLimitError(remainingMs, state.hasExplicitRetryAfter);
    }

    const sleepDurationMs = Math.max(1, Math.ceil(remainingMs));
    const beforeSleepMs = getNowMs();
    await sleepWithAbortAndSession(sleepDurationMs, signal, sessionEpoch);
    const actualElapsedMs = Math.max(0, getNowMs() - beforeSleepMs);
    sharedBudget.waitedMs += Math.max(sleepDurationMs, actualElapsedMs);
  }
}

export function acquireXtreamSlot(options: {
  lane: XtreamRequestLane;
  basePriority: number;
  sessionEpoch: number;
  signal?: AbortSignal;
  onWaiterCreated?: (waiter: SlotWaiter | null) => void;
}): Promise<XtreamSlotHandle> {
  const { lane, basePriority, sessionEpoch, signal, onWaiterCreated } = options;

  if (signal?.aborted || sessionEpoch !== currentSessionEpoch) {
    return Promise.reject(createAbortError());
  }

  // Fast path: dispatch immediately only if lane is available AND no higher-priority eligible waiter is ahead
  if (canAcquireLane(lane)) {
    const nowMs = getNowMs();
    let blockedByHigherPriority = false;
    for (let i = 0; i < slotQueue.length; i++) {
      const existing = slotQueue[i];
      if (
        !existing.settled &&
        existing.sessionEpoch === currentSessionEpoch &&
        !existing.signal?.aborted &&
        canAcquireLane(existing.lane) &&
        computeEffectivePriority(existing, nowMs) >= basePriority
      ) {
        blockedByHigherPriority = true;
        break;
      }
    }

    if (!blockedByHigherPriority) {
      activeGlobal++;
      activeByLane[lane]++;
      onWaiterCreated?.(null);
      return Promise.resolve(createSlotHandle(lane, sessionEpoch));
    }
  }

  return new Promise<XtreamSlotHandle>((resolve, reject) => {
    const waiter: SlotWaiter = {
      id: nextWaiterSeq++,
      lane,
      basePriority,
      enqueuedAtMs: getNowMs(),
      sessionEpoch,
      signal,
      settled: false,
      resolve: (handle) => {
        onWaiterCreated?.(null);
        resolve(handle);
      },
      reject: (err) => {
        onWaiterCreated?.(null);
        reject(err);
      },
      cleanup: () => {
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
      },
    };

    const onAbort = () => {
      if (waiter.settled) return;
      waiter.settled = true;
      waiter.cleanup();
      const idx = slotQueue.indexOf(waiter);
      if (idx !== -1) {
        slotQueue.splice(idx, 1);
      }
      onWaiterCreated?.(null);
      reject(createAbortError());
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    slotQueue.push(waiter);
    onWaiterCreated?.(waiter);
    pumpSlotQueue();
  });
}

export function elevateXtreamRequestPriority(
  credentials: XtreamCredentials | null | undefined,
  action: string | undefined,
  params: Record<string, string | number> | undefined,
  priority: XtreamRequestPriority,
  priorityHint: number = 0
): void {
  if (!credentials?.serverUrl) return;
  const canonicalServer = normalizeServerUrl(credentials.serverUrl);
  if (!canonicalServer) return;
  const dedupeKey = buildDedupeKey(
    credentials,
    canonicalServer,
    action,
    params,
    currentSessionEpoch
  );
  const entry = inFlightMap.get(dedupeKey);
  if (!entry || entry.settled || entry.sessionEpoch !== currentSessionEpoch) {
    return;
  }
  const nextWeight = priorityToWeight(priority, priorityHint);
  if (nextWeight > entry.basePriority) {
    entry.basePriority = nextWeight;
    if (entry.currentSlotWaiter && !entry.currentSlotWaiter.settled) {
      entry.currentSlotWaiter.basePriority = nextWeight;
      pumpSlotQueue();
    }
  }
}

export interface CoordinatedExecutionContext {
  signal: AbortSignal;
  sessionEpoch: number;
  acquireSlot: () => Promise<XtreamSlotHandle>;
  hasActiveRateLimit: () => boolean;
  getRemainingRateLimitBudgetMs: () => number;
  waitForRateLimit: () => Promise<void>;
  recordRateLimit: (retryAfterMs?: number) => void;
  sleep: (ms: number) => Promise<void>;
}

export interface RunCoordinatedRequestOptions<T> {
  credentials: XtreamCredentials;
  canonicalServer: string;
  action?: string;
  params?: Record<string, string | number>;
  lane: XtreamRequestLane;
  priority?: XtreamRequestPriority;
  priorityHint?: number;
  dedupe?: boolean;
  signal?: AbortSignal;
  execute: (ctx: CoordinatedExecutionContext) => Promise<T>;
}

/**
 * Executa uma requisição Xtream sob coordenação compartilhada:
 * - Limite global (4) e sub-limites por fila (catálogos/categorias = 2, EPG = 3)
 * - Prioridade explícita com envelhecimento anti-inanição
 * - Deduplicação segura em voo isolada por servidor canônico, credenciais completas, época, endpoint e parâmetros
 * - Cancelamento por contagem de consumidores (abortar 1 consumidor não derruba os demais)
 * - Coordenação compartilhada de rate-limit (HTTP 429) por escopo de provedor
 */
export function runCoordinatedXtreamRequest<T>(
  options: RunCoordinatedRequestOptions<T>
): Promise<T> {
  const {
    credentials,
    canonicalServer,
    action,
    params,
    lane,
    priority = 'normal',
    priorityHint = 0,
    dedupe = true,
    signal: callerSignal,
    execute,
  } = options;

  if (callerSignal?.aborted) {
    return Promise.reject(createAbortError());
  }

  const startEpoch = currentSessionEpoch;
  const requestedWeight = priorityToWeight(priority, priorityHint);

  if (!dedupe) {
    const localController = new AbortController();
    activeNonDedupedControllers.add(localController);
    const rateLimitBudget: OperationRateLimitBudget = { waitedMs: 0 };
    const onCallerAbort = () => localController.abort();
    if (callerSignal) {
      callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }
    const ctx: CoordinatedExecutionContext = {
      signal: localController.signal,
      sessionEpoch: startEpoch,
      acquireSlot: () =>
        acquireXtreamSlot({
          lane,
          basePriority: requestedWeight,
          sessionEpoch: startEpoch,
          signal: localController.signal,
        }),
      hasActiveRateLimit: () =>
        hasActiveProviderRateLimit(canonicalServer, startEpoch),
      getRemainingRateLimitBudgetMs: () =>
        Math.max(0, config.rateLimitMaxAutoWaitMs - rateLimitBudget.waitedMs),
      waitForRateLimit: () =>
        waitForProviderRateLimitGate(
          canonicalServer,
          startEpoch,
          localController.signal,
          rateLimitBudget
        ),
      recordRateLimit: (retryAfterMs) =>
        recordProviderRateLimit(canonicalServer, startEpoch, retryAfterMs),
      sleep: (ms) =>
        sleepWithAbortAndSession(ms, localController.signal, startEpoch),
    };
    return execute(ctx).finally(() => {
      activeNonDedupedControllers.delete(localController);
      if (callerSignal) {
        callerSignal.removeEventListener('abort', onCallerAbort);
      }
    });
  }

  const dedupeKey = buildDedupeKey(
    credentials,
    canonicalServer,
    action,
    params,
    startEpoch
  );

  let entry = inFlightMap.get(dedupeKey) as
    | CoordinatedInFlightEntry<T>
    | undefined;

  if (entry && !entry.settled && entry.sessionEpoch === startEpoch) {
    if (requestedWeight > entry.basePriority) {
      entry.basePriority = requestedWeight;
      if (entry.currentSlotWaiter && !entry.currentSlotWaiter.settled) {
        entry.currentSlotWaiter.basePriority = requestedWeight;
        pumpSlotQueue();
      }
    }
  } else {
    const sharedController = new AbortController();
    const rateLimitBudget: OperationRateLimitBudget = { waitedMs: 0 };
    const createdEntry: CoordinatedInFlightEntry<T> = {
      dedupeKey,
      sessionEpoch: startEpoch,
      lane,
      basePriority: requestedWeight,
      sharedController,
      activeConsumers: 0,
      settled: false,
      currentSlotWaiter: null,
      promise: Promise.resolve(undefined as unknown as T),
    };

    const ctx: CoordinatedExecutionContext = {
      signal: sharedController.signal,
      sessionEpoch: startEpoch,
      acquireSlot: () =>
        acquireXtreamSlot({
          lane,
          basePriority: createdEntry.basePriority,
          sessionEpoch: startEpoch,
          signal: sharedController.signal,
          onWaiterCreated: (waiter) => {
            createdEntry.currentSlotWaiter = waiter;
          },
        }),
      hasActiveRateLimit: () =>
        hasActiveProviderRateLimit(canonicalServer, startEpoch),
      getRemainingRateLimitBudgetMs: () =>
        Math.max(0, config.rateLimitMaxAutoWaitMs - rateLimitBudget.waitedMs),
      waitForRateLimit: () =>
        waitForProviderRateLimitGate(
          canonicalServer,
          startEpoch,
          sharedController.signal,
          rateLimitBudget
        ),
      recordRateLimit: (retryAfterMs) =>
        recordProviderRateLimit(canonicalServer, startEpoch, retryAfterMs),
      sleep: (ms) =>
        sleepWithAbortAndSession(ms, sharedController.signal, startEpoch),
    };

    const rawPromise = Promise.resolve()
      .then(() => execute(ctx))
      .finally(() => {
        createdEntry.settled = true;
        createdEntry.currentSlotWaiter = null;
        if (inFlightMap.get(dedupeKey) === createdEntry) {
          inFlightMap.delete(dedupeKey);
        }
      });

    // Evita aviso de rejeição não tratada caso todos os consumidores cancelem antes da resolução
    rawPromise.catch(() => {});
    createdEntry.promise = rawPromise;
    inFlightMap.set(dedupeKey, createdEntry);
    entry = createdEntry;
  }

  entry.activeConsumers++;

  return new Promise<T>((resolve, reject) => {
    let consumerDone = false;

    const cleanupListener = () => {
      if (callerSignal) {
        callerSignal.removeEventListener('abort', onCallerAbort);
      }
    };

    const onCallerAbort = () => {
      if (consumerDone) return;
      consumerDone = true;
      cleanupListener();
      if (entry && !entry.settled) {
        entry.activeConsumers = Math.max(0, entry.activeConsumers - 1);
        if (entry.activeConsumers <= 0) {
          entry.settled = true;
          if (inFlightMap.get(dedupeKey) === entry) {
            inFlightMap.delete(dedupeKey);
          }
          entry.sharedController.abort();
        }
      }
      reject(createAbortError());
    };

    if (callerSignal) {
      callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }

    entry!.promise.then(
      (result) => {
        if (consumerDone) return;
        consumerDone = true;
        cleanupListener();
        if (callerSignal?.aborted || currentSessionEpoch !== startEpoch) {
          reject(createAbortError());
          return;
        }
        resolve(result);
      },
      (err) => {
        if (consumerDone) return;
        consumerDone = true;
        cleanupListener();
        if (callerSignal?.aborted || currentSessionEpoch !== startEpoch) {
          reject(createAbortError());
          return;
        }
        reject(err);
      }
    );
  });
}

export function setXtreamCoordinatorConfigForTest(
  partial: Partial<XtreamCoordinatorConfig> & {
    clockFn?: (() => number) | null;
  }
): void {
  if (partial.clockFn !== undefined) {
    customClockFn = partial.clockFn;
  }
  const { clockFn: _ignored, ...rest } = partial;
  config = { ...config, ...rest };
}

export function resetXtreamCoordinatorForTest(): void {
  config = { ...XTREAM_COORDINATOR_DEFAULTS };
  customClockFn = null;
  invalidateXtreamCoordinatorSession();
}

export interface XtreamCoordinatorActivitySnapshot {
  activeGlobal: number;
  activeByLane: Record<XtreamRequestLane, number>;
  queuedSlots: number;
  inFlightCount: number;
  activeNonDedupedCount: number;
  hasActiveOperations: boolean;
}

/**
 * Snapshot somente-leitura e sanitizado da atividade atual no coordenador X02,
 * permitindo detectar operações comerciais concorrentes sem expor credenciais/URLs
 * e sem interferir na sessão global.
 */
export function getXtreamCoordinatorActivitySnapshot(): XtreamCoordinatorActivitySnapshot {
  const hasActiveOperations =
    activeGlobal > 0 ||
    slotQueue.length > 0 ||
    inFlightMap.size > 0 ||
    activeNonDedupedControllers.size > 0;
  return {
    activeGlobal,
    activeByLane: { ...activeByLane },
    queuedSlots: slotQueue.length,
    inFlightCount: inFlightMap.size,
    activeNonDedupedCount: activeNonDedupedControllers.size,
    hasActiveOperations,
  };
}

export function getXtreamCoordinatorStatsForTest(): {
  sessionEpoch: number;
  activeGlobal: number;
  activeByLane: Record<XtreamRequestLane, number>;
  queuedSlots: number;
  inFlightCount: number;
  activeRateLimitScopes: number;
} {
  return {
    sessionEpoch: currentSessionEpoch,
    activeGlobal,
    activeByLane: { ...activeByLane },
    queuedSlots: slotQueue.length,
    inFlightCount: inFlightMap.size,
    activeRateLimitScopes: rateLimitStates.size,
  };
}
