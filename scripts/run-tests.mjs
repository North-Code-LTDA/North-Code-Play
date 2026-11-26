import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PROJECT_ROOT = path.resolve(__dirname, '..');

export const INHERITED_FILTER_ENV_KEYS = Object.freeze([
  'NC_DIRECT_CASE',
  'NC_DIRECT_C3_SUBCASE',
  'NC_LOGIN_CONFIG_CASE',
  'NC_LIVE_TV_NAV_CASE',
  'NC_FULLSCREEN_EXIT_CASE',
  'NC_PERFORMANCE_PROFILE_CASE',
  'NC_LIVE_TV_EPG_ASSETS_CASE',
  'NC_SHOWCASE_CAROUSELS_CASE',
]);

/**
 * Limites externos derivados dos watchdogs internos existentes nas suítes,
 * com margem para bootstrap do Node/tsx e teardown completo (sem alterar watchdogs internos).
 */
export const EXTERNAL_TIMEOUTS_MS = Object.freeze({
  logicFull: 20_000, // test-live-zapping.ts (lógica pura, sem DOM)
  smokeLoginCase5: 25_000, // test-login-config.ts (watchdog interno 20s + 5s margem; cenário único)
  domainDirectBlock: 45_000, // bloco individual de test-direct.ts em processo dedicado
  fullLoginConfig: 35_000, // watchdog interno 20s + 15s margem
  fullFullscreenExit: 35_000, // watchdog interno 20s + 15s margem
  fullPerformanceProfile: 35_000, // watchdog interno 20s + 15s margem
  fullLiveTvEpgAssets: 40_000, // watchdog interno 25s + 15s margem
  fullShowcaseCarousels: 40_000, // watchdog interno 25s + 15s margem
  fullLiveTvNav: 210_000, // watchdog interno 180s + 30s margem
  fullDirect: 150_000, // watchdog interno 120s + 30s margem
});

export const DEFAULT_KILL_GRACE_MS = 2_000;
export const DEFAULT_POST_KILL_SETTLE_MS = 1_500;
export const DEFAULT_TASKKILL_TIMEOUT_MS = 5_000;
const CLEANUP_POLL_INTERVAL_MS = 25;
const MAX_DIAGNOSTIC_OUTPUT_CHARS = 512;

export const TEST_PLANS = Object.freeze({
  smoke: Object.freeze({
    id: 'smoke',
    category: 'smoke',
    title: 'Smoke Tests (Live TV zapping + Login/Config cenário 5)',
    steps: Object.freeze([
      Object.freeze({
        id: 'smoke:live-zapping',
        name: 'scripts/test-live-zapping.ts',
        purpose: 'Lógica de navegação, agrupamento e zapping da TV ao Vivo (integral)',
        script: 'scripts/test-live-zapping.ts',
        runtime: 'tsx',
        env: Object.freeze({}),
        timeoutMs: EXTERNAL_TIMEOUTS_MS.logicFull,
        internalWatchdogMs: null,
      }),
      Object.freeze({
        id: 'smoke:login-config-case-5',
        name: 'scripts/test-login-config.ts (NC_LOGIN_CONFIG_CASE=5)',
        purpose: 'Interação React essencial de configuração/autenticação (cenário 5)',
        script: 'scripts/test-login-config.ts',
        runtime: 'tsx',
        env: Object.freeze({ NC_LOGIN_CONFIG_CASE: '5' }),
        timeoutMs: EXTERNAL_TIMEOUTS_MS.smokeLoginCase5,
        internalWatchdogMs: 20_000,
      }),
    ]),
  }),

  'live-zapping': Object.freeze({
    id: 'live-zapping',
    category: 'domain',
    title: 'Domínio Live TV Zapping (scripts/test-live-zapping.ts integral)',
    steps: Object.freeze([
      Object.freeze({
        id: 'domain:live-zapping',
        name: 'scripts/test-live-zapping.ts',
        purpose: 'Validação integral de agrupamento e zapping de canais Live TV',
        script: 'scripts/test-live-zapping.ts',
        runtime: 'tsx',
        env: Object.freeze({}),
        timeoutMs: EXTERNAL_TIMEOUTS_MS.logicFull,
        internalWatchdogMs: null,
      }),
    ]),
  }),

  'api-transport': Object.freeze({
    id: 'api-transport',
    category: 'domain',
    title: 'Domínio API & Transporte (test-direct bloco 11)',
    steps: Object.freeze([
      Object.freeze({
        id: 'domain:api-transport-block-11',
        name: 'scripts/test-direct.ts (NC_DIRECT_CASE=11)',
        purpose: 'Bloco 11 — Entrega C2.1 (transporte HTTP, limpeza de catálogo e regressões)',
        script: 'scripts/test-direct.ts',
        runtime: 'tsx',
        env: Object.freeze({ NC_DIRECT_CASE: '11' }),
        timeoutMs: EXTERNAL_TIMEOUTS_MS.domainDirectBlock,
        internalWatchdogMs: 120_000,
      }),
    ]),
  }),

  'spatial-nav': Object.freeze({
    id: 'spatial-nav',
    category: 'domain',
    title: 'Domínio Navegação Espacial (test-direct blocos 4 e 5)',
    steps: Object.freeze([
      Object.freeze({
        id: 'domain:spatial-nav-block-4',
        name: 'scripts/test-direct.ts (NC_DIRECT_CASE=4)',
        purpose: 'Bloco 4 — Otimização de navegação espacial horizontal (Ciclo 12.30b)',
        script: 'scripts/test-direct.ts',
        runtime: 'tsx',
        env: Object.freeze({ NC_DIRECT_CASE: '4' }),
        timeoutMs: EXTERNAL_TIMEOUTS_MS.domainDirectBlock,
        internalWatchdogMs: 120_000,
      }),
      Object.freeze({
        id: 'domain:spatial-nav-block-5',
        name: 'scripts/test-direct.ts (NC_DIRECT_CASE=5)',
        purpose: 'Bloco 5 — Otimização de navegação vertical (Ciclo 12.30c)',
        script: 'scripts/test-direct.ts',
        runtime: 'tsx',
        env: Object.freeze({ NC_DIRECT_CASE: '5' }),
        timeoutMs: EXTERNAL_TIMEOUTS_MS.domainDirectBlock,
        internalWatchdogMs: 120_000,
      }),
    ]),
  }),

  'android-image-cache': Object.freeze({
    id: 'android-image-cache',
    category: 'domain',
    title: 'Domínio Cache de Imagens Android (test-direct blocos 7 e 8)',
    steps: Object.freeze([
      Object.freeze({
        id: 'domain:android-image-cache-block-7',
        name: 'scripts/test-direct.ts (NC_DIRECT_CASE=7)',
        purpose: 'Bloco 7 — Cache persistente de imagens e preload (Etapa 1)',
        script: 'scripts/test-direct.ts',
        runtime: 'tsx',
        env: Object.freeze({ NC_DIRECT_CASE: '7' }),
        timeoutMs: EXTERNAL_TIMEOUTS_MS.domainDirectBlock,
        internalWatchdogMs: 120_000,
      }),
      Object.freeze({
        id: 'domain:android-image-cache-block-8',
        name: 'scripts/test-direct.ts (NC_DIRECT_CASE=8)',
        purpose: 'Bloco 8 — Estabilização de startup e fluidez (Etapa 2)',
        script: 'scripts/test-direct.ts',
        runtime: 'tsx',
        env: Object.freeze({ NC_DIRECT_CASE: '8' }),
        timeoutMs: EXTERNAL_TIMEOUTS_MS.domainDirectBlock,
        internalWatchdogMs: 120_000,
      }),
    ]),
  }),

  'android-prepare': Object.freeze({
    id: 'android-prepare',
    category: 'domain',
    title: 'Domínio Preparação Android (test-direct bloco 12)',
    steps: Object.freeze([
      Object.freeze({
        id: 'domain:android-prepare-block-12',
        name: 'scripts/test-direct.ts (NC_DIRECT_CASE=12)',
        purpose: 'Bloco 12 — Entrega C2.2 (limpeza nativa e preparação Android)',
        script: 'scripts/test-direct.ts',
        runtime: 'tsx',
        env: Object.freeze({ NC_DIRECT_CASE: '12' }),
        timeoutMs: EXTERNAL_TIMEOUTS_MS.domainDirectBlock,
        internalWatchdogMs: 120_000,
      }),
    ]),
  }),

  all: Object.freeze({
    id: 'all',
    category: 'full-regression',
    title: 'Regressão Integral (8 suítes completas sem filtros)',
    steps: Object.freeze([
      Object.freeze({
        id: 'all:1-live-zapping',
        name: 'scripts/test-live-zapping.ts',
        purpose: 'Suíte 1/8 — Live TV zapping e agrupamento de canais (integral)',
        script: 'scripts/test-live-zapping.ts',
        runtime: 'tsx',
        env: Object.freeze({}),
        timeoutMs: EXTERNAL_TIMEOUTS_MS.logicFull,
        internalWatchdogMs: null,
      }),
      Object.freeze({
        id: 'all:2-login-config',
        name: 'scripts/test-login-config.ts',
        purpose: 'Suíte 2/8 — Login, configuração M3U e seleção de ambiente (integral)',
        script: 'scripts/test-login-config.ts',
        runtime: 'tsx',
        env: Object.freeze({}),
        timeoutMs: EXTERNAL_TIMEOUTS_MS.fullLoginConfig,
        internalWatchdogMs: 20_000,
      }),
      Object.freeze({
        id: 'all:3-fullscreen-exit',
        name: 'scripts/test-fullscreen-exit.ts',
        purpose: 'Suíte 3/8 — Saída de tela cheia e política de Voltar (integral)',
        script: 'scripts/test-fullscreen-exit.ts',
        runtime: 'tsx',
        env: Object.freeze({}),
        timeoutMs: EXTERNAL_TIMEOUTS_MS.fullFullscreenExit,
        internalWatchdogMs: 20_000,
      }),
      Object.freeze({
        id: 'all:4-performance-profile',
        name: 'scripts/test-performance-profile.ts',
        purpose: 'Suíte 4/8 — Perfis de desempenho e modo Lite (integral)',
        script: 'scripts/test-performance-profile.ts',
        runtime: 'tsx',
        env: Object.freeze({}),
        timeoutMs: EXTERNAL_TIMEOUTS_MS.fullPerformanceProfile,
        internalWatchdogMs: 20_000,
      }),
      Object.freeze({
        id: 'all:5-live-tv-epg-assets',
        name: 'scripts/test-live-tv-epg-assets.ts',
        purpose: 'Suíte 5/8 — EPG, logotipos e visibilidade da TV ao Vivo (integral)',
        script: 'scripts/test-live-tv-epg-assets.ts',
        runtime: 'tsx',
        env: Object.freeze({}),
        timeoutMs: EXTERNAL_TIMEOUTS_MS.fullLiveTvEpgAssets,
        internalWatchdogMs: 25_000,
      }),
      Object.freeze({
        id: 'all:6-showcase-carousels',
        name: 'scripts/test-showcase-carousels.ts',
        purpose: 'Suíte 6/8 — Carrosséis completos de catálogo e vitrine (integral)',
        script: 'scripts/test-showcase-carousels.ts',
        runtime: 'tsx',
        env: Object.freeze({}),
        timeoutMs: EXTERNAL_TIMEOUTS_MS.fullShowcaseCarousels,
        internalWatchdogMs: 25_000,
      }),
      Object.freeze({
        id: 'all:7-live-tv-nav',
        name: 'scripts/test-live-tv-nav.ts',
        purpose: 'Suíte 7/8 — Navegação completa da TV ao Vivo (integral)',
        script: 'scripts/test-live-tv-nav.ts',
        runtime: 'tsx',
        env: Object.freeze({}),
        timeoutMs: EXTERNAL_TIMEOUTS_MS.fullLiveTvNav,
        internalWatchdogMs: 180_000,
      }),
      Object.freeze({
        id: 'all:8-direct',
        name: 'scripts/test-direct.ts',
        purpose: 'Suíte 8/8 — Suíte direta consolidada de 13 blocos (integral)',
        script: 'scripts/test-direct.ts',
        runtime: 'tsx',
        env: Object.freeze({}),
        timeoutMs: EXTERNAL_TIMEOUTS_MS.fullDirect,
        internalWatchdogMs: 120_000,
      }),
    ]),
  }),
});

let cachedTsxLoaderUrl = null;

/**
 * Resolve o loader ESM local do tsx a partir de node_modules do projeto,
 * retornando URL file:// compatível com Node >=22 em POSIX e Windows.
 */
export function resolveTsxLoaderUrl(projectRoot = PROJECT_ROOT) {
  if (projectRoot === PROJECT_ROOT && cachedTsxLoaderUrl) {
    return cachedTsxLoaderUrl;
  }
  const req = createRequire(path.join(projectRoot, 'package.json'));
  const resolvedPath = req.resolve('tsx');
  const loaderUrl = pathToFileURL(resolvedPath).href;
  if (projectRoot === PROJECT_ROOT) {
    cachedTsxLoaderUrl = loaderUrl;
  }
  return loaderUrl;
}

/**
 * Mapeia sinais de cancelamento manual para códigos de saída POSIX convencionais.
 */
export function getCancellationExitCode(signal) {
  if (signal === 'SIGINT') return 130;
  if (signal === 'SIGTERM') return 143;
  return 1;
}

/**
 * Cria cópia isolada do ambiente, removendo todos os filtros herdados (sem mutar baseEnv)
 * e aplicando somente os filtros explicitamente definidos pelo passo.
 */
export function buildIsolatedChildEnv(baseEnv = process.env, explicitEnv = {}) {
  const childEnv = { ...baseEnv };
  const filterSetLower = new Set(INHERITED_FILTER_ENV_KEYS.map((k) => k.toLowerCase()));
  const strippedFilters = [];

  for (const existingKey of Object.keys(childEnv)) {
    if (
      INHERITED_FILTER_ENV_KEYS.includes(existingKey) ||
      (process.platform === 'win32' && filterSetLower.has(existingKey.toLowerCase()))
    ) {
      strippedFilters.push(existingKey);
      delete childEnv[existingKey];
    }
  }

  const appliedFilters = {};
  if (explicitEnv && typeof explicitEnv === 'object') {
    for (const [key, value] of Object.entries(explicitEnv)) {
      if (value !== undefined && value !== null) {
        const strValue = String(value);
        childEnv[key] = strValue;
        appliedFilters[key] = strValue;
      }
    }
  }

  return {
    env: childEnv,
    strippedFilters,
    appliedFilters,
  };
}

/**
 * Monta comando e argumentos separados (sem shell) para execução multiplataforma.
 */
export function buildChildCommand(step, options = {}) {
  const cwd = options.cwd ?? PROJECT_ROOT;
  const execPath = options.execPath ?? process.execPath;
  const scriptAbsPath = path.isAbsolute(step.script)
    ? step.script
    : path.resolve(cwd, step.script);
  const extraArgs = Array.isArray(step.args) ? step.args.map(String) : [];
  const runtime = step.runtime ?? (scriptAbsPath.endsWith('.ts') ? 'tsx' : 'node');

  if (runtime === 'tsx') {
    const loaderUrl = options.tsxLoaderUrl ?? resolveTsxLoaderUrl(cwd);
    return {
      command: execPath,
      args: ['--import', loaderUrl, scriptAbsPath, ...extraArgs],
      cwd,
      scriptAbsPath,
      runtime,
    };
  }

  return {
    command: execPath,
    args: [scriptAbsPath, ...extraArgs],
    cwd,
    scriptAbsPath,
    runtime: 'node',
  };
}

function formatDurationMs(ms) {
  if (ms < 1_000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1_000).toFixed(2)}s (${Math.round(ms)}ms)`;
}

function formatFiltersSummary(appliedFilters) {
  const entries = Object.entries(appliedFilters);
  if (entries.length === 0) {
    return 'nenhum (execução integral)';
  }
  return entries.map(([k, v]) => `${k}=${v}`).join(', ');
}

function defaultLogger(line) {
  console.log(line);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function waitWithTimeout(promise, timeoutMs) {
  let timer = null;
  return new Promise((resolve) => {
    let done = false;
    const finish = (timedOut) => {
      if (done) return;
      done = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      resolve({ timedOut });
    };
    timer = setTimeout(() => finish(true), timeoutMs);
    promise.then(
      () => finish(false),
      () => finish(false)
    );
  });
}

function appendBounded(current, chunk) {
  if (current.length >= MAX_DIAGNOSTIC_OUTPUT_CHARS) return current;
  const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk ?? '');
  return (current + text).slice(0, MAX_DIAGNOSTIC_OUTPUT_CHARS);
}

function isPosixProcessGroupPresent(pgid) {
  if (!pgid || pgid <= 0) return false;
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (err) {
    if (err && err.code === 'ESRCH') {
      return false;
    }
    // EPERM ou erro inesperado: não afirmar que o grupo foi encerrado
    return true;
  }
}

function trySafeSingleChildFallbackKill(child, pid, errors) {
  let attempted = false;
  if (child && typeof child.kill === 'function') {
    attempted = true;
    try {
      child.kill('SIGKILL');
      return { attempted, succeeded: true };
    } catch (err) {
      if (err && err.code === 'ESRCH') {
        return { attempted, succeeded: true };
      }
      errors.push(
        `Fallback seguro child.kill('SIGKILL') para PID ${pid} falhou: ${err instanceof Error ? err.message : String(err)}`
      );
      return { attempted, succeeded: false };
    }
  }
  if (pid) {
    attempted = true;
    try {
      process.kill(pid, 'SIGKILL');
      return { attempted, succeeded: true };
    } catch (err) {
      if (err && err.code === 'ESRCH') {
        return { attempted, succeeded: true };
      }
      errors.push(
        `Fallback seguro process.kill(${pid}, 'SIGKILL') falhou: ${err instanceof Error ? err.message : String(err)}`
      );
      return { attempted, succeeded: false };
    }
  }
  return { attempted, succeeded: false };
}

/**
 * Encerramento da árvore do processo filho no Windows:
 * - Executa `taskkill /PID <pid> /T /F` como PRIMEIRA ação enquanto o processo principal ainda existe.
 * - Usa argumentos separados, `shell: false` e `windowsHide: true`.
 * - Aguarda a conclusão efetiva de `taskkill` (com limite de segurança) e verifica seu código de saída.
 * - Nunca utiliza encerramento por nome de executável (`/IM`).
 * - Só declara `confirmed: true` quando `taskkill` concluir com código 0 e o processo principal encerrar.
 */
export async function terminateWindowsProcessTree(pid, options = {}) {
  const spawnFn = options.spawnFn ?? spawn;
  const child = options.child ?? null;
  const isChildClosed = options.isChildClosed ?? (() => true);
  const waitForChildClose = options.waitForChildClose ?? (() => Promise.resolve());
  const taskkillTimeoutMs = options.taskkillTimeoutMs ?? DEFAULT_TASKKILL_TIMEOUT_MS;
  const postKillSettleMs = options.postKillSettleMs ?? DEFAULT_POST_KILL_SETTLE_MS;
  const log = options.logger ?? defaultLogger;
  const stepLabel = options.stepLabel ?? '';

  const errors = [];
  let fallbackUsed = false;
  let taskkillExitCode = null;
  let taskkillSignal = null;
  let taskkillTimedOut = false;
  let taskkillSpawnError = null;
  let taskkillOutput = '';
  let taskkillConfirmed = false;

  if (!pid || pid <= 0) {
    errors.push('PID do processo filho indisponível para encerramento no Windows.');
    return {
      platform: 'win32',
      method: 'taskkill',
      taskkillExitCode,
      taskkillSignal,
      taskkillTimedOut,
      escalatedToKill: false,
      fallbackUsed,
      confirmed: false,
      childCloseTimedOut: false,
      errors,
    };
  }

  const taskkillArgs = ['/PID', String(pid), '/T', '/F'];

  await new Promise((resolve) => {
    let settled = false;
    let helperTimer = null;
    let killer = null;

    const finishHelper = () => {
      if (settled) return;
      settled = true;
      if (helperTimer !== null) {
        clearTimeout(helperTimer);
        helperTimer = null;
      }
      resolve();
    };

    try {
      killer = spawnFn('taskkill', taskkillArgs, {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (spawnErr) {
      taskkillSpawnError = spawnErr instanceof Error ? spawnErr.message : String(spawnErr);
      errors.push(`Falha síncrona ao iniciar taskkill para PID ${pid}: ${taskkillSpawnError}`);
      finishHelper();
      return;
    }

    if (killer.stdout && typeof killer.stdout.on === 'function') {
      killer.stdout.on('data', (chunk) => {
        taskkillOutput = appendBounded(taskkillOutput, chunk);
      });
    }
    if (killer.stderr && typeof killer.stderr.on === 'function') {
      killer.stderr.on('data', (chunk) => {
        taskkillOutput = appendBounded(taskkillOutput, chunk);
      });
    }

    helperTimer = setTimeout(() => {
      if (settled) return;
      taskkillTimedOut = true;
      errors.push(
        `Timeout (${formatDurationMs(taskkillTimeoutMs)}) aguardando conclusão de taskkill /PID ${pid} /T /F.`
      );
      try {
        killer.kill('SIGKILL');
      } catch {}
      finishHelper();
    }, taskkillTimeoutMs);

    killer.once('error', (err) => {
      taskkillSpawnError = err instanceof Error ? err.message : String(err);
      errors.push(`Erro ao executar taskkill para PID ${pid}: ${taskkillSpawnError}`);
      finishHelper();
    });

    killer.once('close', (code, signal) => {
      taskkillExitCode = code;
      taskkillSignal = signal ?? null;
      finishHelper();
    });
  });

  if (!taskkillSpawnError && !taskkillTimedOut) {
    if (taskkillExitCode === 0 && !taskkillSignal) {
      taskkillConfirmed = true;
    } else if (taskkillExitCode === 128) {
      errors.push(
        `taskkill retornou código 128 para PID ${pid} (processo principal não encontrado; não é possível confirmar encerramento de descendentes).`
      );
    } else {
      const detail = taskkillOutput.trim() ? ` | saída: ${taskkillOutput.trim()}` : '';
      errors.push(
        `taskkill encerrou com falha para PID ${pid} (code=${taskkillExitCode ?? 'null'}, signal=${taskkillSignal ?? 'none'})${detail}`
      );
    }
  }

  // Fallback limitado e seguro exclusivamente sobre o processo filho desta execução
  if (!taskkillConfirmed && !isChildClosed()) {
    fallbackUsed = true;
    if (stepLabel) {
      log(
        `[run-tests] ⚠ ${stepLabel} Executando fallback limitado sobre PID ${pid} (sem encerramento por nome de executável)...`
      );
    }
    trySafeSingleChildFallbackKill(child, pid, errors);
  }

  let childCloseTimedOut = false;
  if (!isChildClosed()) {
    const waitResult = await waitWithTimeout(waitForChildClose(), postKillSettleMs);
    childCloseTimedOut = waitResult.timedOut;
    if (childCloseTimedOut) {
      errors.push(
        `Evento close do processo principal (PID ${pid}) não ocorreu dentro de ${formatDurationMs(postKillSettleMs)} após encerramento no Windows.`
      );
    }
  }

  const confirmed = taskkillConfirmed && !childCloseTimedOut && isChildClosed() && errors.length === 0;

  return {
    platform: 'win32',
    method: 'taskkill',
    taskkillExitCode,
    taskkillSignal,
    taskkillTimedOut,
    escalatedToKill: false,
    fallbackUsed,
    confirmed,
    childCloseTimedOut,
    errors,
  };
}

/**
 * Encerramento do grupo dedicado de processos em POSIX (`detached: true`, `-pgid`):
 * - Envia o sinal inicial (`SIGTERM` ou `SIGINT`) exclusivamente ao grupo próprio `-pgid`.
 * - NÃO cancela a limpeza nem a escalada se o processo principal encerrar enquanto ainda houver
 *   descendentes presentes no grupo `-pgid`.
 * - Aguarda a margem (`killGraceMs`) encerrando antecipadamente apenas quando o processo principal
 *   já fechou E o grupo `-pgid` não existe mais (`ESRCH`).
 * - Escala para `SIGKILL` em `-pgid` se o processo principal ou algum descendente do grupo permanecer ativo.
 * - Aguarda de forma limitada (`postKillSettleMs`) a conclusão da limpeza e registra qualquer falha.
 */
async function terminatePosixProcessGroup(pid, options = {}) {
  const child = options.child ?? null;
  const initialSignal = options.initialSignal ?? 'SIGTERM';
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const postKillSettleMs = options.postKillSettleMs ?? DEFAULT_POST_KILL_SETTLE_MS;
  const isChildClosed = options.isChildClosed ?? (() => true);
  const waitForChildClose = options.waitForChildClose ?? (() => Promise.resolve());
  const log = options.logger ?? defaultLogger;
  const stepLabel = options.stepLabel ?? '';
  const stepName = options.stepName ?? String(pid);

  const errors = [];
  let escalatedToKill = false;
  let fallbackUsed = false;
  let childCloseTimedOut = false;

  if (!pid || pid <= 0) {
    errors.push('PID do processo filho indisponível para encerramento POSIX.');
    return {
      platform: process.platform,
      method: 'posix-process-group',
      initialSignal,
      escalatedToKill: false,
      fallbackUsed: false,
      confirmed: false,
      childCloseTimedOut: false,
      errors,
    };
  }

  const pgid = pid;
  let initialGroupAlreadyGone = false;

  try {
    process.kill(-pgid, initialSignal);
  } catch (err) {
    if (err && err.code === 'ESRCH') {
      initialGroupAlreadyGone = true;
    } else {
      errors.push(
        `Falha ao enviar ${initialSignal} ao grupo próprio -${pgid}: ${err instanceof Error ? err.message : String(err)}`
      );
      if (!isChildClosed() && child) {
        fallbackUsed = true;
        try {
          child.kill(initialSignal);
        } catch (fallbackErr) {
          if (!fallbackErr || fallbackErr.code !== 'ESRCH') {
            errors.push(
              `Fallback ${initialSignal} no filho ${pid} falhou: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`
            );
          }
        }
      }
    }
  }

  // Margem de encerramento gracioso: continua ativa mesmo após `close` do processo principal
  // caso ainda existam descendentes no grupo próprio `-pgid`.
  if (!initialGroupAlreadyGone) {
    const graceDeadline = Date.now() + killGraceMs;
    while (Date.now() < graceDeadline) {
      if (isChildClosed() && !isPosixProcessGroupPresent(pgid)) {
        break;
      }
      const remaining = Math.max(1, Math.min(CLEANUP_POLL_INTERVAL_MS, graceDeadline - Date.now()));
      await sleep(remaining);
    }
  }

  const needsEscalation = !isChildClosed() || isPosixProcessGroupPresent(pgid);
  if (needsEscalation) {
    escalatedToKill = true;
    if (stepLabel) {
      log(
        `[run-tests] ⏱ ${stepLabel} Grupo próprio -${pgid} (${stepName}) ainda ativo após margem de ${formatDurationMs(killGraceMs)} — escalando para SIGKILL...`
      );
    }
    try {
      process.kill(-pgid, 'SIGKILL');
    } catch (err) {
      if (!err || err.code !== 'ESRCH') {
        errors.push(
          `Falha ao enviar SIGKILL ao grupo próprio -${pgid}: ${err instanceof Error ? err.message : String(err)}`
        );
        if (!isChildClosed()) {
          fallbackUsed = true;
          trySafeSingleChildFallbackKill(child, pid, errors);
        }
      }
    }

    const settleDeadline = Date.now() + postKillSettleMs;
    while (Date.now() < settleDeadline) {
      if (isChildClosed() && !isPosixProcessGroupPresent(pgid)) {
        break;
      }
      const remaining = Math.max(1, Math.min(CLEANUP_POLL_INTERVAL_MS, settleDeadline - Date.now()));
      await sleep(remaining);
    }
  } else if (!isChildClosed()) {
    const waitResult = await waitWithTimeout(waitForChildClose(), postKillSettleMs);
    childCloseTimedOut = waitResult.timedOut;
  }

  if (!isChildClosed()) {
    childCloseTimedOut = true;
    errors.push(
      `Evento close do processo principal (PID ${pid}) não foi recebido após janela limitada de encerramento.`
    );
  }

  const groupStillPresent = isPosixProcessGroupPresent(pgid);
  if (groupStillPresent) {
    errors.push(
      `Grupo próprio -${pgid} ainda reportou presença após tentativa de limpeza (pode haver processo resistente ou zumbi pendente de coleta).`
    );
  }

  const confirmed = !childCloseTimedOut && !groupStillPresent && errors.length === 0;

  return {
    platform: process.platform,
    method: 'posix-process-group',
    initialSignal,
    escalatedToKill,
    fallbackUsed,
    confirmed,
    childCloseTimedOut,
    errors,
  };
}

/**
 * Executa um único passo em processo independente, com isolamento de filtros,
 * timeout externo real, cancelamento manual seguro, encerramento consistente
 * da árvore do processo filho e aguardo efetivo da limpeza antes de finalizar.
 */
export function runStep(step, options = {}) {
  const cwd = options.cwd ?? PROJECT_ROOT;
  const baseEnv = options.baseEnv ?? process.env;
  const stdio = options.stdio ?? 'inherit';
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const postKillSettleMs = options.postKillSettleMs ?? DEFAULT_POST_KILL_SETTLE_MS;
  const taskkillTimeoutMs = options.taskkillTimeoutMs ?? DEFAULT_TASKKILL_TIMEOUT_MS;
  const log = options.logger ?? defaultLogger;
  const stepIndex = options.stepIndex ?? 1;
  const totalSteps = options.totalSteps ?? 1;
  const stepLabel = `[${stepIndex}/${totalSteps}]`;
  const signalTarget = options.signalTarget ?? process;
  const attachParentSignals = options.attachParentSignals ?? true;
  const registerCancelHandler = options.registerCancelHandler ?? null;
  const platform = options.platform ?? process.platform;

  const startedAtNs = process.hrtime.bigint();
  const { env, strippedFilters, appliedFilters } = buildIsolatedChildEnv(baseEnv, step.env);

  let built;
  try {
    built = buildChildCommand(step, {
      cwd,
      execPath: options.execPath,
      tsxLoaderUrl: options.tsxLoaderUrl,
    });
  } catch (err) {
    const durationMs = Number(process.hrtime.bigint() - startedAtNs) / 1_000_000;
    const message = err instanceof Error ? err.message : String(err);
    log(`[run-tests] ❌ ${stepLabel} FALHA DE INICIALIZAÇÃO em ${step.name}: ${message}`);
    return Promise.resolve({
      id: step.id,
      name: step.name,
      purpose: step.purpose ?? '',
      script: step.script,
      status: 'init-error',
      exitCode: 1,
      signal: null,
      timedOut: false,
      cancelled: false,
      cancelSignal: null,
      escalatedToKill: false,
      cleanup: null,
      durationMs,
      strippedFilters,
      appliedFilters,
      errorMessage: message,
    });
  }

  if (!fs.existsSync(built.scriptAbsPath)) {
    const durationMs = Number(process.hrtime.bigint() - startedAtNs) / 1_000_000;
    const message = `Script não encontrado: ${built.scriptAbsPath}`;
    log(`[run-tests] ❌ ${stepLabel} FALHA DE INICIALIZAÇÃO em ${step.name}: ${message}`);
    return Promise.resolve({
      id: step.id,
      name: step.name,
      purpose: step.purpose ?? '',
      script: step.script,
      status: 'init-error',
      exitCode: 1,
      signal: null,
      timedOut: false,
      cancelled: false,
      cancelSignal: null,
      escalatedToKill: false,
      cleanup: null,
      durationMs,
      strippedFilters,
      appliedFilters,
      errorMessage: message,
    });
  }

  const timeoutMs = typeof step.timeoutMs === 'number' && step.timeoutMs > 0 ? step.timeoutMs : 30_000;
  const strippedNote =
    strippedFilters.length > 0
      ? ` | filtros herdados removidos: ${strippedFilters.join(', ')}`
      : '';
  log(
    `\n[run-tests] ▶ ${stepLabel} INÍCIO: ${step.name}` +
      `\n            Finalidade: ${step.purpose ?? step.id}` +
      `\n            Filtros aplicados: ${formatFiltersSummary(appliedFilters)}${strippedNote}` +
      `\n            Timeout externo: ${formatDurationMs(timeoutMs)}`
  );

  return new Promise((resolve) => {
    let settled = false;
    let childClosed = false;
    let closeCode = null;
    let closeSignal = null;
    let spawnErrorMessage = null;

    let terminationTrigger = null; // null | 'timeout' | 'cancelled'
    let cancelSignal = null;
    let terminationPromise = null;
    let cleanupReport = null;
    let timeoutTimer = null;
    let activeChild = null;

    let resolveChildClosed;
    const childClosedPromise = new Promise((res) => {
      resolveChildClosed = res;
    });

    const clearExternalTimeout = () => {
      if (timeoutTimer !== null) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
    };

    const detachParentSignals = () => {
      if (attachParentSignals && signalTarget && typeof signalTarget.off === 'function') {
        signalTarget.off('SIGINT', onCancelSignal);
        signalTarget.off('SIGTERM', onCancelSignal);
      }
      if (typeof registerCancelHandler === 'function') {
        registerCancelHandler(null);
      }
    };

    const markChildClosed = (code, signal) => {
      if (childClosed) return;
      childClosed = true;
      closeCode = code;
      closeSignal = signal ?? null;
      resolveChildClosed();
    };

    const startTermination = (trigger, initialSignal) => {
      if (settled || terminationTrigger !== null) {
        return;
      }
      terminationTrigger = trigger;
      if (trigger === 'cancelled') {
        cancelSignal = initialSignal;
      }
      clearExternalTimeout();

      const pid = activeChild?.pid ?? null;

      if (trigger === 'timeout') {
        const actionDesc =
          platform === 'win32'
            ? `taskkill /PID ${pid ?? '?'} /T /F`
            : `encerramento do grupo próprio -${pid ?? '?'} (${initialSignal})`;
        log(
          `[run-tests] ⏱ ${stepLabel} TIMEOUT EXTERNO (${formatDurationMs(timeoutMs)}) em ${step.name} — iniciando ${actionDesc}...`
        );
      } else {
        const actionDesc =
          platform === 'win32'
            ? `taskkill /PID ${pid ?? '?'} /T /F`
            : `encerramento do grupo próprio -${pid ?? '?'} (${initialSignal})`;
        log(
          `[run-tests] 🛑 ${stepLabel} CANCELAMENTO MANUAL (${initialSignal}) em ${step.name} — iniciando ${actionDesc}...`
        );
      }

      const terminationRunner =
        platform === 'win32'
          ? terminateWindowsProcessTree(pid, {
              child: activeChild,
              isChildClosed: () => childClosed,
              waitForChildClose: () => childClosedPromise,
              taskkillTimeoutMs,
              postKillSettleMs,
              logger: log,
              stepLabel,
              spawnFn: options.taskkillSpawnFn,
            })
          : terminatePosixProcessGroup(pid, {
              child: activeChild,
              initialSignal,
              killGraceMs,
              postKillSettleMs,
              isChildClosed: () => childClosed,
              waitForChildClose: () => childClosedPromise,
              logger: log,
              stepLabel,
              stepName: step.name,
            });

      terminationPromise = terminationRunner
        .catch((unexpectedErr) => ({
          platform,
          method: platform === 'win32' ? 'taskkill' : 'posix-process-group',
          escalatedToKill: false,
          fallbackUsed: false,
          confirmed: false,
          childCloseTimedOut: !childClosed,
          errors: [
            `Erro inesperado durante limpeza do processo: ${unexpectedErr instanceof Error ? unexpectedErr.message : String(unexpectedErr)}`,
          ],
        }))
        .then((report) => {
          cleanupReport = report;
          tryFinalize();
        });
    };

    const onCancelSignal = (sig) => {
      if (settled) return;
      if (terminationTrigger === null) {
        startTermination('cancelled', sig);
      } else if (terminationTrigger === 'timeout') {
        log(
          `[run-tests] 🛑 ${stepLabel} Sinal ${sig} recebido durante encerramento por timeout em ${step.name}; aguardando conclusão da limpeza em andamento.`
        );
      }
    };

    const tryFinalize = () => {
      if (settled) return;

      // Não finalizar prematuramente enquanto houver operação de encerramento pendente
      if (terminationPromise !== null && cleanupReport === null) {
        return;
      }

      // Sem encerramento ativo, só finaliza quando o processo filho fecha ou falha no spawn
      if (terminationPromise === null && !childClosed && spawnErrorMessage === null) {
        return;
      }

      settled = true;
      clearExternalTimeout();
      detachParentSignals();

      const durationMs = Number(process.hrtime.bigint() - startedAtNs) / 1_000_000;

      if (cleanupReport && cleanupReport.errors.length > 0) {
        for (const cleanupErr of cleanupReport.errors) {
          log(`[run-tests] ⚠ ${stepLabel} Falha/aviso na limpeza de processos: ${cleanupErr}`);
        }
      }

      if (terminationTrigger === 'cancelled') {
        const exitCode = getCancellationExitCode(cancelSignal);
        const escalated = Boolean(cleanupReport?.escalatedToKill);
        const confirmed = Boolean(cleanupReport?.confirmed);
        log(
          `[run-tests] 🛑 ${stepLabel} CANCELADO (${cancelSignal}): ${step.name} interrompido após ${formatDurationMs(durationMs)} ` +
            `(rawCode=${closeCode ?? 'null'}, rawSignal=${closeSignal ?? 'none'}, escalatedSigkill=${escalated}, cleanupConfirmed=${confirmed}, exitCode=${exitCode})`
        );
        resolve({
          id: step.id,
          name: step.name,
          purpose: step.purpose ?? '',
          script: step.script,
          status: 'cancelled',
          exitCode,
          rawExitCode: closeCode,
          signal: closeSignal,
          timedOut: false,
          cancelled: true,
          cancelSignal,
          escalatedToKill: escalated,
          cleanup: cleanupReport,
          durationMs,
          strippedFilters,
          appliedFilters,
          errorMessage: `Execução cancelada manualmente por ${cancelSignal}`,
        });
        return;
      }

      if (terminationTrigger === 'timeout') {
        const escalated = Boolean(cleanupReport?.escalatedToKill);
        const confirmed = Boolean(cleanupReport?.confirmed);
        log(
          `[run-tests] ❌ ${stepLabel} TIMEOUT: ${step.name} encerrado após ${formatDurationMs(durationMs)} ` +
            `(rawCode=${closeCode ?? 'null'}, rawSignal=${closeSignal ?? 'none'}, escalatedSigkill=${escalated}, cleanupConfirmed=${confirmed})`
        );
        resolve({
          id: step.id,
          name: step.name,
          purpose: step.purpose ?? '',
          script: step.script,
          status: 'timeout',
          exitCode: 124,
          rawExitCode: closeCode,
          signal: closeSignal,
          timedOut: true,
          cancelled: false,
          cancelSignal: null,
          escalatedToKill: escalated,
          cleanup: cleanupReport,
          durationMs,
          strippedFilters,
          appliedFilters,
          errorMessage: `Timeout externo excedido (${timeoutMs}ms)`,
        });
        return;
      }

      if (spawnErrorMessage !== null) {
        log(
          `[run-tests] ❌ ${stepLabel} FALHA DE INICIALIZAÇÃO em ${step.name} (${formatDurationMs(durationMs)}): ${spawnErrorMessage}`
        );
        resolve({
          id: step.id,
          name: step.name,
          purpose: step.purpose ?? '',
          script: step.script,
          status: 'init-error',
          exitCode: 1,
          rawExitCode: null,
          signal: null,
          timedOut: false,
          cancelled: false,
          cancelSignal: null,
          escalatedToKill: false,
          cleanup: cleanupReport,
          durationMs,
          strippedFilters,
          appliedFilters,
          errorMessage: spawnErrorMessage,
        });
        return;
      }

      if (closeSignal) {
        log(
          `[run-tests] ❌ ${stepLabel} ENCERRAMENTO POR SINAL: ${step.name} recebeu ${closeSignal} após ${formatDurationMs(durationMs)}`
        );
        resolve({
          id: step.id,
          name: step.name,
          purpose: step.purpose ?? '',
          script: step.script,
          status: 'signal-error',
          exitCode: 1,
          rawExitCode: closeCode,
          signal: closeSignal,
          timedOut: false,
          cancelled: false,
          cancelSignal: null,
          escalatedToKill: false,
          cleanup: null,
          durationMs,
          strippedFilters,
          appliedFilters,
          errorMessage: `Processo encerrado por sinal ${closeSignal}`,
        });
        return;
      }

      if (closeCode !== 0) {
        const normalizedCode = typeof closeCode === 'number' && closeCode > 0 ? closeCode : 1;
        log(
          `[run-tests] ❌ ${stepLabel} FALHA DE ASSERÇÃO/EXECUÇÃO: ${step.name} encerrou com código ${normalizedCode} em ${formatDurationMs(durationMs)}`
        );
        resolve({
          id: step.id,
          name: step.name,
          purpose: step.purpose ?? '',
          script: step.script,
          status: 'assertion-failure',
          exitCode: normalizedCode,
          rawExitCode: closeCode,
          signal: null,
          timedOut: false,
          cancelled: false,
          cancelSignal: null,
          escalatedToKill: false,
          cleanup: null,
          durationMs,
          strippedFilters,
          appliedFilters,
          errorMessage: `Processo encerrou com código de saída ${normalizedCode}`,
        });
        return;
      }

      log(
        `[run-tests] ✅ ${stepLabel} APROVADO: ${step.name} em ${formatDurationMs(durationMs)} (código 0)`
      );
      resolve({
        id: step.id,
        name: step.name,
        purpose: step.purpose ?? '',
        script: step.script,
        status: 'passed',
        exitCode: 0,
        rawExitCode: 0,
        signal: null,
        timedOut: false,
        cancelled: false,
        cancelSignal: null,
        escalatedToKill: false,
        cleanup: null,
        durationMs,
        strippedFilters,
        appliedFilters,
        errorMessage: null,
      });
    };

    try {
      activeChild = spawn(built.command, built.args, {
        cwd: built.cwd,
        env,
        stdio,
        shell: false,
        detached: platform !== 'win32',
        windowsHide: true,
      });
    } catch (spawnErr) {
      spawnErrorMessage = spawnErr instanceof Error ? spawnErr.message : String(spawnErr);
      markChildClosed(null, null);
      tryFinalize();
      return;
    }

    if (attachParentSignals && signalTarget && typeof signalTarget.on === 'function') {
      signalTarget.on('SIGINT', onCancelSignal);
      signalTarget.on('SIGTERM', onCancelSignal);
    }

    if (typeof registerCancelHandler === 'function') {
      registerCancelHandler(onCancelSignal);
    }

    // Se cancelamento já disparou imediatamente ao registrar o handler, não armar timer externo
    if (terminationTrigger === null) {
      timeoutTimer = setTimeout(() => {
        if (settled || childClosed || terminationTrigger !== null) return;
        startTermination('timeout', 'SIGTERM');
      }, timeoutMs);
    }

    activeChild.once('error', (err) => {
      spawnErrorMessage = err instanceof Error ? err.message : String(err);
      markChildClosed(null, null);
      tryFinalize();
    });

    activeChild.once('close', (code, signal) => {
      clearExternalTimeout();
      markChildClosed(code, signal);
      tryFinalize();
    });
  });
}

function getApprovalBanner(plan, totalSteps) {
  switch (plan.category) {
    case 'smoke':
      return `✅ SMOKE APROVADO (${totalSteps}/${totalSteps} execuções) — validação rápida direcionada; NÃO equivale à regressão integral (test:all).`;
    case 'domain':
      return `✅ DOMÍNIO ESPECÍFICO APROVADO [${plan.id}] (${totalSteps}/${totalSteps} execuções) — execução direcionada; NÃO equivale à regressão integral (test:all).`;
    case 'partial':
      return `✅ SUÍTE PARCIAL APROVADA [${plan.id}] (${totalSteps}/${totalSteps} execuções) — execução parcial; NÃO equivale à regressão integral (test:all).`;
    case 'full-regression':
      return `✅ REGRESSÃO INTEGRAL APROVADA (${totalSteps}/${totalSteps} suítes completas sem filtros).`;
    default:
      return `✅ EXECUÇÃO CONCLUÍDA [${plan.id}] (${totalSteps}/${totalSteps}).`;
  }
}

function getFailureLabel(status) {
  switch (status) {
    case 'cancelled':
      return 'CANCELAMENTO MANUAL';
    case 'timeout':
      return 'TIMEOUT';
    case 'init-error':
      return 'FALHA DE INICIALIZAÇÃO';
    case 'signal-error':
      return 'ENCERRAMENTO POR SINAL';
    case 'assertion-failure':
      return 'FALHA DE ASSERÇÃO / EXECUÇÃO';
    default:
      return 'FALHA';
  }
}

/**
 * Executa um plano sequencialmente, interrompendo na primeira falha ou cancelamento manual
 * e registrando explicitamente as execuções não alcançadas.
 */
export async function runPlan(plan, options = {}) {
  const log = options.logger ?? defaultLogger;
  const signalTarget = options.signalTarget ?? process;
  const planStartNs = process.hrtime.bigint();
  const results = [];
  const skipped = [];
  let firstFailure = null;
  let planCancelSignal = null;
  let activeStepCancelHandler = null;

  const onPlanCancelSignal = (sig) => {
    if (!planCancelSignal) {
      planCancelSignal = sig;
      log(
        `\n[run-tests] 🛑 CANCELAMENTO MANUAL (${sig}) recebido no plano [${plan.id}] — nenhuma nova etapa será iniciada.`
      );
    }
    if (typeof activeStepCancelHandler === 'function') {
      activeStepCancelHandler(sig);
    }
  };

  if (signalTarget && typeof signalTarget.on === 'function') {
    signalTarget.on('SIGINT', onPlanCancelSignal);
    signalTarget.on('SIGTERM', onPlanCancelSignal);
  }

  log(
    `================================================================================\n` +
      `[run-tests] Plano: ${plan.id} (${plan.category}) — ${plan.title}\n` +
      `[run-tests] Execuções previstas: ${plan.steps.length} (sequenciais, processos isolados)\n` +
      `================================================================================`
  );

  try {
    for (let i = 0; i < plan.steps.length; i += 1) {
      const step = plan.steps[i];

      if (firstFailure || planCancelSignal) {
        const isCancelled = Boolean(planCancelSignal || firstFailure?.status === 'cancelled');
        const effectiveCancelSignal = planCancelSignal ?? firstFailure?.cancelSignal ?? null;
        const skippedEntry = {
          id: step.id,
          name: step.name,
          purpose: step.purpose ?? '',
          script: step.script,
          status: isCancelled ? 'skipped-after-cancellation' : 'skipped-after-failure',
          exitCode: null,
          signal: null,
          timedOut: false,
          cancelled: isCancelled,
          cancelSignal: effectiveCancelSignal,
          escalatedToKill: false,
          cleanup: null,
          durationMs: 0,
          strippedFilters: [],
          appliedFilters: step.env ? { ...step.env } : {},
          errorMessage: isCancelled
            ? `Não executada devido ao cancelamento manual (${effectiveCancelSignal})`
            : `Não executada devido à falha anterior em ${firstFailure.name}`,
        };
        results.push(skippedEntry);
        skipped.push(skippedEntry);
        continue;
      }

      const stepResult = await runStep(step, {
        ...options,
        stepIndex: i + 1,
        totalSteps: plan.steps.length,
        logger: log,
        signalTarget,
        attachParentSignals: false,
        registerCancelHandler: (handler) => {
          activeStepCancelHandler = handler;
          if (handler && planCancelSignal) {
            handler(planCancelSignal);
          }
        },
      });
      activeStepCancelHandler = null;
      results.push(stepResult);

      if (stepResult.status !== 'passed') {
        firstFailure = stepResult;
        if (stepResult.status === 'cancelled' && !planCancelSignal) {
          planCancelSignal = stepResult.cancelSignal;
        }
      }
    }
  } finally {
    activeStepCancelHandler = null;
    if (signalTarget && typeof signalTarget.off === 'function') {
      signalTarget.off('SIGINT', onPlanCancelSignal);
      signalTarget.off('SIGTERM', onPlanCancelSignal);
    }
  }

  const totalDurationMs = Number(process.hrtime.bigint() - planStartNs) / 1_000_000;
  const passedCount = results.filter((r) => r.status === 'passed').length;

  log('\n--------------------------------------------------------------------------------');

  // Nunca converter um plano cancelado em aprovação, mesmo que o último passo tenha encerrado com código 0
  if (!firstFailure && planCancelSignal) {
    const exitCode = getCancellationExitCode(planCancelSignal);
    log(
      `[run-tests] 🛑 PLANO CANCELADO [${plan.id}] — CANCELAMENTO MANUAL (${planCancelSignal}) recebido durante a execução (código ${exitCode}).`
    );
    log(
      `[run-tests] Resumo: ${passedCount} concluída(s) antes do cancelamento, ${skipped.length} não alcançada(s)/ignorada(s) de ${plan.steps.length}.`
    );
    if (skipped.length > 0) {
      log('[run-tests] Execuções NÃO realizadas após o cancelamento:');
      for (const s of skipped) {
        log(`            - ${s.name} (${s.id}): ${s.errorMessage}`);
      }
    }
    log(`[run-tests] Duração total: ${formatDurationMs(totalDurationMs)} | Código de saída: ${exitCode}`);
    log('--------------------------------------------------------------------------------');

    return {
      ok: false,
      planId: plan.id,
      category: plan.category,
      outcome: 'cancelled',
      cancelled: true,
      cancelSignal: planCancelSignal,
      exitCode,
      totalDurationMs,
      passedCount,
      totalSteps: plan.steps.length,
      results,
      skipped,
      firstFailure: null,
    };
  }

  if (!firstFailure) {
    log(`[run-tests] ${getApprovalBanner(plan, plan.steps.length)}`);
    log(`[run-tests] Duração total: ${formatDurationMs(totalDurationMs)} | Código de saída: 0`);
    log('--------------------------------------------------------------------------------');
    return {
      ok: true,
      planId: plan.id,
      category: plan.category,
      outcome:
        plan.category === 'full-regression'
          ? 'full-regression-passed'
          : plan.category === 'smoke'
            ? 'smoke-passed'
            : plan.category === 'domain'
              ? 'domain-passed'
              : 'partial-passed',
      cancelled: false,
      cancelSignal: null,
      exitCode: 0,
      totalDurationMs,
      passedCount,
      totalSteps: plan.steps.length,
      results,
      skipped,
      firstFailure: null,
    };
  }

  const failureLabel = getFailureLabel(firstFailure.status);
  const isCancelledFailure = firstFailure.status === 'cancelled';
  if (isCancelledFailure) {
    log(
      `[run-tests] 🛑 PLANO CANCELADO [${plan.id}] — ${failureLabel} (${firstFailure.cancelSignal}) em "${firstFailure.name}" (código ${firstFailure.exitCode}).`
    );
  } else {
    log(
      `[run-tests] ❌ PLANO INTERROMPIDO [${plan.id}] — ${failureLabel} em "${firstFailure.name}" (código ${firstFailure.exitCode}${firstFailure.signal ? `, sinal ${firstFailure.signal}` : ''}).`
    );
  }
  log(
    `[run-tests] Resumo: ${passedCount} aprovada(s), 1 ${isCancelledFailure ? 'cancelada' : 'falha'} (${failureLabel}), ${skipped.length} não alcançada(s)/ignorada(s) de ${plan.steps.length}.`
  );
  if (skipped.length > 0) {
    log(
      isCancelledFailure
        ? '[run-tests] Execuções NÃO realizadas após o cancelamento:'
        : '[run-tests] Execuções NÃO realizadas após a primeira falha:'
    );
    for (const s of skipped) {
      log(`            - ${s.name} (${s.id}): ${s.errorMessage}`);
    }
  }
  log(
    `[run-tests] Duração total: ${formatDurationMs(totalDurationMs)} | Código de saída: ${firstFailure.exitCode}`
  );
  log('--------------------------------------------------------------------------------');

  return {
    ok: false,
    planId: plan.id,
    category: plan.category,
    outcome: firstFailure.status,
    cancelled: isCancelledFailure,
    cancelSignal: isCancelledFailure ? firstFailure.cancelSignal : planCancelSignal,
    exitCode: firstFailure.exitCode,
    totalDurationMs,
    passedCount,
    totalSteps: plan.steps.length,
    results,
    skipped,
    firstFailure,
  };
}

function isDirectCliInvocation() {
  if (!process.argv[1]) return false;
  try {
    return path.resolve(process.argv[1]) === path.resolve(__filename);
  } catch {
    return false;
  }
}

async function runCli() {
  const planName = process.argv[2]?.trim();
  const validPlans = Object.keys(TEST_PLANS);

  if (!planName || !Object.prototype.hasOwnProperty.call(TEST_PLANS, planName)) {
    console.error(
      `[run-tests] ❌ FALHA DE INICIALIZAÇÃO: plano inválido ou ausente ("${planName ?? ''}"). ` +
        `Planos disponíveis: ${validPlans.join(', ')}.`
    );
    process.exitCode = 1;
    return;
  }

  const plan = TEST_PLANS[planName];
  const summary = await runPlan(plan);
  if (!summary.ok) {
    process.exitCode = summary.exitCode || 1;
  }
}

if (isDirectCliInvocation()) {
  await runCli();
}
