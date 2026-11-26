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

function killProcessTreeWindows(pid) {
  return new Promise((resolve) => {
    try {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('error', () => {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {}
        resolve();
      });
      killer.once('close', () => resolve());
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
      resolve();
    }
  });
}

function terminateChildTree(child, signal) {
  const pid = child.pid;
  if (!pid) return;

  if (process.platform === 'win32') {
    if (signal === 'SIGKILL') {
      void killProcessTreeWindows(pid);
    } else {
      try {
        child.kill('SIGTERM');
      } catch {
        void killProcessTreeWindows(pid);
      }
    }
    return;
  }

  // Em POSIX, o processo filho é criado em grupo próprio (detached: true),
  // permitindo encerrar exclusivamente o filho e seus descendentes via -pid.
  try {
    process.kill(-pid, signal);
  } catch (err) {
    if (err && err.code !== 'ESRCH') {
      try {
        child.kill(signal);
      } catch {}
    }
  }
}

function defaultLogger(line) {
  console.log(line);
}

/**
 * Executa um único passo em processo independente, com isolamento de filtros,
 * timeout externo real, encerramento da árvore do processo filho e aguardo efetivo do fim.
 */
export function runStep(step, options = {}) {
  const cwd = options.cwd ?? PROJECT_ROOT;
  const baseEnv = options.baseEnv ?? process.env;
  const stdio = options.stdio ?? 'inherit';
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const log = options.logger ?? defaultLogger;
  const stepIndex = options.stepIndex ?? 1;
  const totalSteps = options.totalSteps ?? 1;

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
    log(
      `[run-tests] ❌ [${stepIndex}/${totalSteps}] FALHA DE INICIALIZAÇÃO em ${step.name}: ${message}`
    );
    return Promise.resolve({
      id: step.id,
      name: step.name,
      purpose: step.purpose ?? '',
      script: step.script,
      status: 'init-error',
      exitCode: 1,
      signal: null,
      timedOut: false,
      durationMs,
      strippedFilters,
      appliedFilters,
      errorMessage: message,
    });
  }

  if (!fs.existsSync(built.scriptAbsPath)) {
    const durationMs = Number(process.hrtime.bigint() - startedAtNs) / 1_000_000;
    const message = `Script não encontrado: ${built.scriptAbsPath}`;
    log(
      `[run-tests] ❌ [${stepIndex}/${totalSteps}] FALHA DE INICIALIZAÇÃO em ${step.name}: ${message}`
    );
    return Promise.resolve({
      id: step.id,
      name: step.name,
      purpose: step.purpose ?? '',
      script: step.script,
      status: 'init-error',
      exitCode: 1,
      signal: null,
      timedOut: false,
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
    `\n[run-tests] ▶ [${stepIndex}/${totalSteps}] INÍCIO: ${step.name}` +
      `\n            Finalidade: ${step.purpose ?? step.id}` +
      `\n            Filtros aplicados: ${formatFiltersSummary(appliedFilters)}${strippedNote}` +
      `\n            Timeout externo: ${formatDurationMs(timeoutMs)}`
  );

  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let escalatedToKill = false;
    let timeoutTimer = null;
    let killTimer = null;
    let activeChild = null;

    const cleanupTimers = () => {
      if (timeoutTimer !== null) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      if (killTimer !== null) {
        clearTimeout(killTimer);
        killTimer = null;
      }
    };

    const detachParentSignals = () => {
      process.off('SIGINT', onParentSignal);
      process.off('SIGTERM', onParentSignal);
    };

    const onParentSignal = (sig) => {
      if (activeChild && !settled) {
        terminateChildTree(activeChild, sig);
      }
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      detachParentSignals();
      resolve(result);
    };

    try {
      activeChild = spawn(built.command, built.args, {
        cwd: built.cwd,
        env,
        stdio,
        shell: false,
        detached: process.platform !== 'win32',
        windowsHide: true,
      });
    } catch (spawnErr) {
      const durationMs = Number(process.hrtime.bigint() - startedAtNs) / 1_000_000;
      const message = spawnErr instanceof Error ? spawnErr.message : String(spawnErr);
      log(
        `[run-tests] ❌ [${stepIndex}/${totalSteps}] FALHA DE INICIALIZAÇÃO (spawn) em ${step.name} (${formatDurationMs(durationMs)}): ${message}`
      );
      finish({
        id: step.id,
        name: step.name,
        purpose: step.purpose ?? '',
        script: step.script,
        status: 'init-error',
        exitCode: 1,
        signal: null,
        timedOut: false,
        durationMs,
        strippedFilters,
        appliedFilters,
        errorMessage: message,
      });
      return;
    }

    process.on('SIGINT', onParentSignal);
    process.on('SIGTERM', onParentSignal);

    timeoutTimer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      log(
        `[run-tests] ⏱ [${stepIndex}/${totalSteps}] TIMEOUT EXTERNO (${formatDurationMs(timeoutMs)}) em ${step.name} — encerrando processo filho (SIGTERM)...`
      );
      terminateChildTree(activeChild, 'SIGTERM');

      killTimer = setTimeout(() => {
        if (settled) return;
        escalatedToKill = true;
        log(
          `[run-tests] ⏱ [${stepIndex}/${totalSteps}] Processo ${step.name} não encerrou após margem de ${formatDurationMs(killGraceMs)} — escalando para SIGKILL...`
        );
        terminateChildTree(activeChild, 'SIGKILL');
      }, killGraceMs);
    }, timeoutMs);

    activeChild.once('error', (err) => {
      const durationMs = Number(process.hrtime.bigint() - startedAtNs) / 1_000_000;
      const message = err instanceof Error ? err.message : String(err);
      log(
        `[run-tests] ❌ [${stepIndex}/${totalSteps}] FALHA DE INICIALIZAÇÃO em ${step.name} (${formatDurationMs(durationMs)}): ${message}`
      );
      finish({
        id: step.id,
        name: step.name,
        purpose: step.purpose ?? '',
        script: step.script,
        status: 'init-error',
        exitCode: 1,
        signal: null,
        timedOut: false,
        durationMs,
        strippedFilters,
        appliedFilters,
        errorMessage: message,
      });
    });

    activeChild.once('close', (code, signal) => {
      const durationMs = Number(process.hrtime.bigint() - startedAtNs) / 1_000_000;

      if (timedOut) {
        log(
          `[run-tests] ❌ [${stepIndex}/${totalSteps}] TIMEOUT: ${step.name} encerrado após ${formatDurationMs(durationMs)} (code=${code ?? 'null'}, signal=${signal ?? 'none'}, escalatedSigkill=${escalatedToKill})`
        );
        finish({
          id: step.id,
          name: step.name,
          purpose: step.purpose ?? '',
          script: step.script,
          status: 'timeout',
          exitCode: 124,
          rawExitCode: code,
          signal: signal ?? null,
          timedOut: true,
          escalatedToKill,
          durationMs,
          strippedFilters,
          appliedFilters,
          errorMessage: `Timeout externo excedido (${timeoutMs}ms)`,
        });
        return;
      }

      if (signal) {
        log(
          `[run-tests] ❌ [${stepIndex}/${totalSteps}] ENCERRAMENTO POR SINAL: ${step.name} recebeu ${signal} após ${formatDurationMs(durationMs)}`
        );
        finish({
          id: step.id,
          name: step.name,
          purpose: step.purpose ?? '',
          script: step.script,
          status: 'signal-error',
          exitCode: 1,
          rawExitCode: code,
          signal,
          timedOut: false,
          durationMs,
          strippedFilters,
          appliedFilters,
          errorMessage: `Processo encerrado por sinal ${signal}`,
        });
        return;
      }

      if (code !== 0) {
        const normalizedCode = typeof code === 'number' && code > 0 ? code : 1;
        log(
          `[run-tests] ❌ [${stepIndex}/${totalSteps}] FALHA DE ASSERÇÃO/EXECUÇÃO: ${step.name} encerrou com código ${normalizedCode} em ${formatDurationMs(durationMs)}`
        );
        finish({
          id: step.id,
          name: step.name,
          purpose: step.purpose ?? '',
          script: step.script,
          status: 'assertion-failure',
          exitCode: normalizedCode,
          rawExitCode: code,
          signal: null,
          timedOut: false,
          durationMs,
          strippedFilters,
          appliedFilters,
          errorMessage: `Processo encerrou com código de saída ${normalizedCode}`,
        });
        return;
      }

      log(
        `[run-tests] ✅ [${stepIndex}/${totalSteps}] APROVADO: ${step.name} em ${formatDurationMs(durationMs)} (código 0)`
      );
      finish({
        id: step.id,
        name: step.name,
        purpose: step.purpose ?? '',
        script: step.script,
        status: 'passed',
        exitCode: 0,
        rawExitCode: 0,
        signal: null,
        timedOut: false,
        durationMs,
        strippedFilters,
        appliedFilters,
        errorMessage: null,
      });
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
 * Executa um plano sequencialmente, interrompendo na primeira falha e
 * registrando explicitamente as execuções não alcançadas.
 */
export async function runPlan(plan, options = {}) {
  const log = options.logger ?? defaultLogger;
  const planStartNs = process.hrtime.bigint();
  const results = [];
  const skipped = [];
  let firstFailure = null;

  log(
    `================================================================================\n` +
      `[run-tests] Plano: ${plan.id} (${plan.category}) — ${plan.title}\n` +
      `[run-tests] Execuções previstas: ${plan.steps.length} (sequenciais, processos isolados)\n` +
      `================================================================================`
  );

  for (let i = 0; i < plan.steps.length; i += 1) {
    const step = plan.steps[i];
    if (firstFailure) {
      const skippedEntry = {
        id: step.id,
        name: step.name,
        purpose: step.purpose ?? '',
        script: step.script,
        status: 'skipped-after-failure',
        exitCode: null,
        signal: null,
        timedOut: false,
        durationMs: 0,
        strippedFilters: [],
        appliedFilters: step.env ? { ...step.env } : {},
        errorMessage: `Não executada devido à falha anterior em ${firstFailure.name}`,
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
    });
    results.push(stepResult);

    if (stepResult.status !== 'passed') {
      firstFailure = stepResult;
    }
  }

  const totalDurationMs = Number(process.hrtime.bigint() - planStartNs) / 1_000_000;
  const passedCount = results.filter((r) => r.status === 'passed').length;

  log('\n--------------------------------------------------------------------------------');
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
  log(
    `[run-tests] ❌ PLANO INTERROMPIDO [${plan.id}] — ${failureLabel} em "${firstFailure.name}" (código ${firstFailure.exitCode}${firstFailure.signal ? `, sinal ${firstFailure.signal}` : ''}).`
  );
  log(
    `[run-tests] Resumo: ${passedCount} aprovada(s), 1 falha (${failureLabel}), ${skipped.length} não alcançada(s)/ignorada(s) de ${plan.steps.length}.`
  );
  if (skipped.length > 0) {
    log('[run-tests] Execuções NÃO realizadas após a primeira falha:');
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
