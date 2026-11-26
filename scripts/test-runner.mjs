import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  EXTERNAL_TIMEOUTS_MS,
  INHERITED_FILTER_ENV_KEYS,
  PROJECT_ROOT,
  TEST_BOOTSTRAP_SCRIPT,
  TEST_PLANS,
  buildChildCommand,
  buildIsolatedChildEnv,
  getCancellationExitCode,
  resolveTestBootstrapPath,
  runPlan,
  terminateWindowsProcessTree,
} from './run-tests.mjs';

const IS_WINDOWS = process.platform === 'win32';
const IS_LINUX = process.platform === 'linux';

/**
 * Verifica se um PID ainda está efetivamente em execução.
 * Em Linux, consulta `/proc/<pid>/stat` para não confundir processo zumbi ('Z'/'X')
 * com processo efetivamente ativo, conforme limitação conhecida de `process.kill(pid, 0)`.
 */
function isPidRunning(pid) {
  if (!pid || pid <= 0) return false;
  if (IS_LINUX) {
    try {
      const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const lastParen = raw.lastIndexOf(')');
      if (lastParen !== -1) {
        const state = raw.slice(lastParen + 1).trim()[0];
        if (state === 'Z' || state === 'X' || state === 'x') {
          return false;
        }
      }
      return true;
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        return false;
      }
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

async function waitForFile(filePath, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8').trim();
      if (content.length > 0) {
        return content;
      }
    }
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`Timeout aguardando arquivo sintético: ${filePath}`);
}

function forceCleanupTrackedSyntheticProcesses(trackedPids, trackedPosixGroups) {
  if (!IS_WINDOWS) {
    for (const pgid of trackedPosixGroups) {
      try {
        process.kill(-pgid, 'SIGKILL');
      } catch {}
    }
  }
  for (const pid of trackedPids) {
    if (!isPidRunning(pid)) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }
}

function createFakeTaskkillProcess(behavior) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.killed = false;
  proc.kill = () => {
    proc.killed = true;
    return true;
  };
  setImmediate(() => {
    if (behavior.error) {
      proc.emit('error', behavior.error);
      return;
    }
    if (behavior.stderr) {
      proc.stderr.emit('data', Buffer.from(behavior.stderr, 'utf8'));
    }
    if (!behavior.hang) {
      proc.emit('close', behavior.code ?? 0, behavior.signal ?? null);
    }
  });
  return proc;
}

async function testStaticPackageAndPlansMapping() {
  const pkgPath = path.join(PROJECT_ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const scripts = pkg.scripts ?? {};

  // 1. Verificar os 24 comandos npm (10 preservados gerais + 7 aliases legados via bootstrap + 7 orquestrador)
  assert.strictEqual(
    Object.keys(scripts).length,
    24,
    'package.json deve preservar exatamente 24 comandos npm'
  );

  const preservedGeneralCommands = {
    dev: 'vite',
    build: 'vite build',
    start: 'vite preview',
    preview: 'vite preview',
    clean: 'node -e "require(\'node:fs\').rmSync(\'dist\', { recursive: true, force: true })"',
    lint: 'tsc --noEmit',
    'cap:sync': 'node tooling/android/prepare-android.mjs --skip-web-build',
    'android:sync': 'npm run build && node tooling/android/prepare-android.mjs --skip-web-build',
    'android:prepare': 'npm run build && node tooling/android/prepare-android.mjs --skip-web-build',
    'android:open': 'node tooling/android/prepare-android.mjs --skip-web-build --open',
  };
  for (const [name, expectedCmd] of Object.entries(preservedGeneralCommands)) {
    assert.strictEqual(
      scripts[name],
      expectedCmd,
      `Comando preservado "${name}" deve permanecer inalterado`
    );
  }

  const bootstrapLegacyCommands = {
    test: 'node scripts/test-bootstrap.mjs scripts/test-direct.ts',
    'test:carousels': 'node scripts/test-bootstrap.mjs scripts/test-showcase-carousels.ts',
    'test:login-config': 'node scripts/test-bootstrap.mjs scripts/test-login-config.ts',
    'test:fullscreen-exit': 'node scripts/test-bootstrap.mjs scripts/test-fullscreen-exit.ts',
    'test:performance-profile': 'node scripts/test-bootstrap.mjs scripts/test-performance-profile.ts',
    'test:live-tv-nav': 'node scripts/test-bootstrap.mjs scripts/test-live-tv-nav.ts',
    'test:live-tv-epg-assets': 'node scripts/test-bootstrap.mjs scripts/test-live-tv-epg-assets.ts',
  };
  for (const [name, expectedCmd] of Object.entries(bootstrapLegacyCommands)) {
    assert.strictEqual(
      scripts[name],
      expectedCmd,
      `Alias legado "${name}" deve utilizar node scripts/test-bootstrap.mjs`
    );
  }

  // 2. Verificar os 7 comandos do orquestrador multiplataforma
  const expectedOrchestratorCommands = {
    'test:live-zapping': 'node scripts/run-tests.mjs live-zapping',
    'test:api-transport': 'node scripts/run-tests.mjs api-transport',
    'test:spatial-nav': 'node scripts/run-tests.mjs spatial-nav',
    'test:android-image-cache': 'node scripts/run-tests.mjs android-image-cache',
    'test:android-prepare': 'node scripts/run-tests.mjs android-prepare',
    'test:smoke': 'node scripts/run-tests.mjs smoke',
    'test:all': 'node scripts/run-tests.mjs all',
  };
  for (const [name, expectedCmd] of Object.entries(expectedOrchestratorCommands)) {
    assert.strictEqual(
      scripts[name],
      expectedCmd,
      `Comando "${name}" deve continuar apontando para o orquestrador multiplataforma`
    );
  }

  // 3. Verificar mapeamento exato de cada plano
  assert.strictEqual(TEST_PLANS['live-zapping'].category, 'domain');
  assert.deepStrictEqual(
    TEST_PLANS['live-zapping'].steps.map((s) => ({ script: s.script, env: s.env })),
    [{ script: 'scripts/test-live-zapping.ts', env: {} }]
  );

  assert.strictEqual(TEST_PLANS['api-transport'].category, 'domain');
  assert.deepStrictEqual(
    TEST_PLANS['api-transport'].steps.map((s) => ({ script: s.script, env: s.env })),
    [{ script: 'scripts/test-direct.ts', env: { NC_DIRECT_CASE: '11' } }]
  );

  assert.strictEqual(TEST_PLANS['spatial-nav'].category, 'domain');
  assert.deepStrictEqual(
    TEST_PLANS['spatial-nav'].steps.map((s) => ({ script: s.script, env: s.env })),
    [
      { script: 'scripts/test-direct.ts', env: { NC_DIRECT_CASE: '4' } },
      { script: 'scripts/test-direct.ts', env: { NC_DIRECT_CASE: '5' } },
    ]
  );

  assert.strictEqual(TEST_PLANS['android-image-cache'].category, 'domain');
  assert.deepStrictEqual(
    TEST_PLANS['android-image-cache'].steps.map((s) => ({ script: s.script, env: s.env })),
    [
      { script: 'scripts/test-direct.ts', env: { NC_DIRECT_CASE: '7' } },
      { script: 'scripts/test-direct.ts', env: { NC_DIRECT_CASE: '8' } },
    ]
  );

  assert.strictEqual(TEST_PLANS['android-prepare'].category, 'domain');
  assert.deepStrictEqual(
    TEST_PLANS['android-prepare'].steps.map((s) => ({ script: s.script, env: s.env })),
    [{ script: 'scripts/test-direct.ts', env: { NC_DIRECT_CASE: '12' } }]
  );

  assert.strictEqual(TEST_PLANS.smoke.category, 'smoke');
  assert.deepStrictEqual(
    TEST_PLANS.smoke.steps.map((s) => ({ script: s.script, env: s.env })),
    [
      { script: 'scripts/test-live-zapping.ts', env: {} },
      { script: 'scripts/test-login-config.ts', env: { NC_LOGIN_CONFIG_CASE: '5' } },
    ]
  );

  assert.strictEqual(TEST_PLANS.all.category, 'full-regression');
  assert.deepStrictEqual(
    TEST_PLANS.all.steps.map((s) => ({ script: s.script, env: s.env })),
    [
      { script: 'scripts/test-live-zapping.ts', env: {} },
      { script: 'scripts/test-login-config.ts', env: {} },
      { script: 'scripts/test-fullscreen-exit.ts', env: {} },
      { script: 'scripts/test-performance-profile.ts', env: {} },
      { script: 'scripts/test-live-tv-epg-assets.ts', env: {} },
      { script: 'scripts/test-showcase-carousels.ts', env: {} },
      { script: 'scripts/test-live-tv-nav.ts', env: {} },
      { script: 'scripts/test-direct.ts', env: {} },
    ]
  );

  // 4. Verificar que todos os scripts referenciados existem no disco e têm timeouts acima do watchdog interno
  for (const plan of Object.values(TEST_PLANS)) {
    for (const step of plan.steps) {
      const absPath = path.resolve(PROJECT_ROOT, step.script);
      assert.strictEqual(
        fs.existsSync(absPath),
        true,
        `Script referenciado deve existir no disco: ${step.script}`
      );
      if (plan.category === 'full-regression' && step.internalWatchdogMs !== null) {
        assert(
          step.timeoutMs > step.internalWatchdogMs,
          `Timeout externo de ${step.id} (${step.timeoutMs}ms) deve superar o watchdog interno (${step.internalWatchdogMs}ms)`
        );
      }
    }
  }

  assert(EXTERNAL_TIMEOUTS_MS.fullLiveTvNav >= 200_000, 'test-live-tv-nav completo deve ter margem sobre 180s');
  assert(EXTERNAL_TIMEOUTS_MS.fullDirect >= 140_000, 'test-direct completo deve ter margem sobre 120s');

  // 5. Verificar resolução do bootstrap compartilhado e construção de argumentos sem shell e sem --import tsx
  const bootstrapAbsPath = resolveTestBootstrapPath();
  assert.strictEqual(
    bootstrapAbsPath,
    path.resolve(PROJECT_ROOT, TEST_BOOTSTRAP_SCRIPT),
    'Bootstrap resolvido deve apontar para scripts/test-bootstrap.mjs na raiz do projeto'
  );
  assert.strictEqual(
    fs.existsSync(bootstrapAbsPath),
    true,
    `Bootstrap compartilhado deve existir no disco: ${bootstrapAbsPath}`
  );

  const builtTsx = buildChildCommand({
    ...TEST_PLANS.smoke.steps[1],
    args: ['--flag-a', 'valor-b'],
  });
  assert.strictEqual(builtTsx.command, process.execPath, 'Comando tsx deve usar process.execPath');
  assert.strictEqual(builtTsx.cwd, PROJECT_ROOT, 'Diretório de trabalho deve ser a raiz do projeto');
  assert.strictEqual(
    builtTsx.bootstrapAbsPath,
    bootstrapAbsPath,
    'bootstrapAbsPath deve apontar para scripts/test-bootstrap.mjs'
  );
  assert.deepStrictEqual(
    builtTsx.args,
    [
      bootstrapAbsPath,
      path.resolve(PROJECT_ROOT, 'scripts/test-login-config.ts'),
      '--flag-a',
      'valor-b',
    ],
    'Runtime tsx deve passar [bootstrapAbsPath, scriptAbsPath, ...extraArgs] separados em array'
  );
  assert.strictEqual(
    builtTsx.args.includes('--import'),
    false,
    'Novo caminho tsx não deve utilizar --import tsx'
  );
  assert.strictEqual(
    builtTsx.args.some((arg) => arg.includes('/node_modules/tsx/') || arg.includes('\\node_modules\\tsx\\')),
    false,
    'Novo caminho tsx não deve referenciar loader tsx diretamente nos argumentos'
  );

  // Verificar preservação integral do caminho runtime node
  const builtNode = buildChildCommand({
    id: 'synthetic-node-cmd',
    name: 'Script Node direto',
    script: 'scripts/test-runner.mjs',
    runtime: 'node',
    args: ['arg1', 'arg2'],
    env: {},
  });
  assert.strictEqual(builtNode.command, process.execPath, 'Runtime node deve usar process.execPath');
  assert.strictEqual(builtNode.runtime, 'node');
  assert.deepStrictEqual(
    builtNode.args,
    [path.resolve(PROJECT_ROOT, 'scripts/test-runner.mjs'), 'arg1', 'arg2'],
    'Runtime node deve manter execução direta sem bootstrap'
  );

  // 6. Verificar lista exata dos 8 filtros herdados e códigos de cancelamento
  assert.deepStrictEqual(
    [...INHERITED_FILTER_ENV_KEYS],
    [
      'NC_DIRECT_CASE',
      'NC_DIRECT_C3_SUBCASE',
      'NC_LOGIN_CONFIG_CASE',
      'NC_LIVE_TV_NAV_CASE',
      'NC_FULLSCREEN_EXIT_CASE',
      'NC_PERFORMANCE_PROFILE_CASE',
      'NC_LIVE_TV_EPG_ASSETS_CASE',
      'NC_SHOWCASE_CAROUSELS_CASE',
    ]
  );
  assert.strictEqual(getCancellationExitCode('SIGINT'), 130);
  assert.strictEqual(getCancellationExitCode('SIGTERM'), 143);

  console.log(
    '  [OK] 1. Mapeamento estático dos 24 comandos npm, planos, watchdogs, códigos de cancelamento e bootstrap compartilhado'
  );
}

async function testSyntheticContracts() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-run-tests-selfcheck-'));
  const silentLogs = [];
  const captureLog = (line) => silentLogs.push(String(line));
  const trackedPids = new Set();
  const trackedPosixGroups = new Set();
  const executionCoverage = {
    executedEmpirically: [],
    staticOrMockOnly: [],
  };

  try {
    // Fixtures sintéticas mínimas em .mjs (sem React, sem DOM real)
    const seqScript = path.join(tmpDir, 'seq-step.mjs');
    fs.writeFileSync(
      seqScript,
      [
        "import fs from 'node:fs';",
        'const [logFile, label, delayMs] = process.argv.slice(2);',
        'fs.appendFileSync(logFile, `START:${label}\\n`);',
        'await new Promise((r) => setTimeout(r, Number(delayMs) || 20));',
        'fs.appendFileSync(logFile, `END:${label}\\n`);',
      ].join('\n'),
      'utf8'
    );

    const failScript = path.join(tmpDir, 'fail-step.mjs');
    fs.writeFileSync(
      failScript,
      'const code = Number(process.argv[2] ?? 2); process.exitCode = code;\n',
      'utf8'
    );

    const sentinelScript = path.join(tmpDir, 'sentinel-step.mjs');
    fs.writeFileSync(
      sentinelScript,
      "import fs from 'node:fs'; fs.writeFileSync(process.argv[2], 'SHOULD_NOT_RUN');\n",
      'utf8'
    );

    // Fixture para Contrato 4: filho + neto que ignoram SIGTERM
    const hangWithChildScript = path.join(tmpDir, 'hang-with-child.mjs');
    fs.writeFileSync(
      hangWithChildScript,
      [
        "import { spawn } from 'node:child_process';",
        "import fs from 'node:fs';",
        'const [pidFile, readyFile] = process.argv.slice(2);',
        "process.on('SIGTERM', () => { /* ignora SIGTERM para validar escalada SIGKILL em POSIX */ });",
        'const gcCode = "const fs=require(\'node:fs\'); process.on(\'SIGTERM\',()=>{}); fs.writeFileSync(process.argv[1], String(process.pid)); setInterval(()=>{},60000);";',
        "const grandchild = spawn(process.execPath, ['-e', gcCode, readyFile], { stdio: 'ignore', shell: false });",
        'fs.writeFileSync(pidFile, JSON.stringify({ childPid: process.pid, grandchildPid: grandchild.pid }));',
        'setInterval(() => {}, 60000);',
      ].join('\n'),
      'utf8'
    );

    // Fixture para Contrato 8 (POSIX): filho encerra imediatamente com código 0 ao receber SIGTERM,
    // mas descendente no mesmo grupo ignora SIGTERM
    const earlyExitStubbornDescendantScript = path.join(tmpDir, 'early-exit-stubborn-descendant.mjs');
    fs.writeFileSync(
      earlyExitStubbornDescendantScript,
      [
        "import { spawn } from 'node:child_process';",
        "import fs from 'node:fs';",
        'const [pidFile, readyFile] = process.argv.slice(2);',
        'const gcCode = "const fs=require(\'node:fs\'); process.on(\'SIGTERM\',()=>{}); fs.writeFileSync(process.argv[1], String(process.pid)); setInterval(()=>{},60000);";',
        "const grandchild = spawn(process.execPath, ['-e', gcCode, readyFile], { stdio: 'ignore', shell: false });",
        'fs.writeFileSync(pidFile, JSON.stringify({ childPid: process.pid, grandchildPid: grandchild.pid }));',
        "process.on('SIGTERM', () => { process.exit(0); });",
        'setInterval(() => {}, 60000);',
      ].join('\n'),
      'utf8'
    );

    // Fixture para Contrato 9a: filho intercepta SIGINT e encerra voluntariamente com código 0,
    // enquanto descendente ignora SIGINT
    const trapSignalExitZeroScript = path.join(tmpDir, 'trap-signal-exit-zero.mjs');
    fs.writeFileSync(
      trapSignalExitZeroScript,
      [
        "import { spawn } from 'node:child_process';",
        "import fs from 'node:fs';",
        'const [pidFile, readyFile, trapSig] = process.argv.slice(2);',
        'const gcCode = `const fs=require(\'node:fs\'); process.on(${JSON.stringify(trapSig)},()=>{}); fs.writeFileSync(process.argv[1], String(process.pid)); setInterval(()=>{},60000);`;',
        "const grandchild = spawn(process.execPath, ['-e', gcCode, readyFile], { stdio: 'ignore', shell: false });",
        'fs.writeFileSync(pidFile, JSON.stringify({ childPid: process.pid, grandchildPid: grandchild.pid }));',
        'if (process.platform !== "win32") {',
        '  process.on(trapSig, () => { process.exit(0); });',
        '}',
        'setInterval(() => {}, 60000);',
      ].join('\n'),
      'utf8'
    );

    const signalSelfScript = path.join(tmpDir, 'signal-self.mjs');
    fs.writeFileSync(
      signalSelfScript,
      "process.kill(process.pid, 'SIGTERM'); setTimeout(() => {}, 5000);\n",
      'utf8'
    );

    const dumpFiltersScript = path.join(tmpDir, 'dump-filters.mjs');
    fs.writeFileSync(
      dumpFiltersScript,
      [
        "import fs from 'node:fs';",
        'const outFile = process.argv[2];',
        'const keys = process.argv.slice(3);',
        'const snapshot = {};',
        'for (const k of keys) snapshot[k] = Object.prototype.hasOwnProperty.call(process.env, k) ? process.env[k] : null;',
        'fs.writeFileSync(outFile, JSON.stringify(snapshot));',
      ].join('\n'),
      'utf8'
    );

    // Contrato 2: Sucesso + Execução sequencial estrita + distinção de banners
    const seqLog = path.join(tmpDir, 'seq.log');
    silentLogs.length = 0;
    const seqSummary = await runPlan(
      {
        id: 'synthetic-seq',
        category: 'smoke',
        title: 'Plano sintético sequencial',
        steps: [
          {
            id: 's1',
            name: 'Passo sintético 1',
            purpose: 'Validar execução sequencial 1',
            script: seqScript,
            runtime: 'node',
            args: [seqLog, 'STEP1', '50'],
            env: {},
            timeoutMs: 5_000,
          },
          {
            id: 's2',
            name: 'Passo sintético 2',
            purpose: 'Validar execução sequencial 2',
            script: seqScript,
            runtime: 'node',
            args: [seqLog, 'STEP2', '25'],
            env: {},
            timeoutMs: 5_000,
          },
        ],
      },
      { logger: captureLog, stdio: 'ignore' }
    );
    assert.strictEqual(seqSummary.ok, true);
    assert.strictEqual(seqSummary.exitCode, 0);
    assert.strictEqual(seqSummary.outcome, 'smoke-passed');
    assert.strictEqual(seqSummary.passedCount, 2);
    assert.strictEqual(seqSummary.skipped.length, 0);
    const seqLines = fs.readFileSync(seqLog, 'utf8').trim().split('\n');
    assert.deepStrictEqual(
      seqLines,
      ['START:STEP1', 'END:STEP1', 'START:STEP2', 'END:STEP2'],
      'Passo 2 só pode iniciar após o término completo do Passo 1'
    );
    assert(
      silentLogs.some((l) => l.includes('SMOKE APROVADO') && l.includes('NÃO equivale à regressão integral')),
      'Relatório de smoke deve distinguir claramente que não é regressão integral'
    );
    executionCoverage.executedEmpirically.push('Execução sequencial, aprovação e banner de smoke');
    console.log('  [OK] 2. Execução sequencial bem-sucedida e distinção de banner de smoke');

    // Contrato 3: Código não zero + interrupção imediata na primeira falha + registro de ignorados
    const sentinelFile = path.join(tmpDir, 'sentinel-fail.txt');
    silentLogs.length = 0;
    const failSummary = await runPlan(
      {
        id: 'synthetic-fail',
        category: 'domain',
        title: 'Plano sintético com falha no passo 2',
        steps: [
          {
            id: 'f1',
            name: 'Passo ok',
            script: seqScript,
            runtime: 'node',
            args: [path.join(tmpDir, 'fail-ok.log'), 'OK1', '10'],
            env: {},
            timeoutMs: 5_000,
          },
          {
            id: 'f2',
            name: 'Passo falha código 7',
            script: failScript,
            runtime: 'node',
            args: ['7'],
            env: {},
            timeoutMs: 5_000,
          },
          {
            id: 'f3',
            name: 'Passo que não deve executar',
            script: sentinelScript,
            runtime: 'node',
            args: [sentinelFile],
            env: {},
            timeoutMs: 5_000,
          },
        ],
      },
      { logger: captureLog, stdio: 'ignore' }
    );
    assert.strictEqual(failSummary.ok, false);
    assert.strictEqual(failSummary.exitCode, 7, 'Deve propagar o código de saída não zero do processo filho');
    assert.strictEqual(failSummary.outcome, 'assertion-failure');
    assert.strictEqual(failSummary.passedCount, 1);
    assert.strictEqual(failSummary.skipped.length, 1);
    assert.strictEqual(failSummary.skipped[0].id, 'f3');
    assert.strictEqual(failSummary.skipped[0].status, 'skipped-after-failure');
    assert.strictEqual(fs.existsSync(sentinelFile), false, 'Passo posterior à falha não pode ser executado');
    assert(
      silentLogs.some((l) => l.includes('Execuções NÃO realizadas após a primeira falha')),
      'Relatório deve listar explicitamente execuções não alcançadas'
    );
    executionCoverage.executedEmpirically.push('Fail-fast, código de saída não zero e listagem de passos ignorados');
    console.log('  [OK] 3. Propagação de código não zero, interrupção após 1ª falha e registro de ignorados');

    // Contrato 4: Timeout real + encerramento da árvore (adaptado a POSIX e Windows)
    const pidFile4 = path.join(tmpDir, 'hang-pids-4.json');
    const readyFile4 = path.join(tmpDir, 'hang-ready-4.txt');
    const sentinelAfterTimeout4 = path.join(tmpDir, 'sentinel-timeout-4.txt');
    silentLogs.length = 0;
    const timeoutSummary = await runPlan(
      {
        id: 'synthetic-timeout',
        category: 'partial',
        title: 'Plano sintético com timeout e processo descendente',
        steps: [
          {
            id: 't1',
            name: 'Passo travado com descendente',
            script: hangWithChildScript,
            runtime: 'node',
            args: [pidFile4, readyFile4],
            env: {},
            timeoutMs: 500,
          },
          {
            id: 't2',
            name: 'Passo ignorado após timeout',
            script: sentinelScript,
            runtime: 'node',
            args: [sentinelAfterTimeout4],
            env: {},
            timeoutMs: 5_000,
          },
        ],
      },
      { logger: captureLog, stdio: 'ignore', killGraceMs: 250 }
    );
    const pids4 = JSON.parse(fs.readFileSync(pidFile4, 'utf8'));
    trackedPids.add(pids4.childPid);
    trackedPids.add(pids4.grandchildPid);
    trackedPosixGroups.add(pids4.childPid);

    assert.strictEqual(timeoutSummary.ok, false);
    assert.strictEqual(timeoutSummary.outcome, 'timeout');
    assert.strictEqual(timeoutSummary.exitCode, 124);
    assert.strictEqual(timeoutSummary.results[0].timedOut, true);
    assert.strictEqual(timeoutSummary.results[0].cleanup?.confirmed, true);
    assert.strictEqual(timeoutSummary.skipped.length, 1);
    assert.strictEqual(fs.existsSync(sentinelAfterTimeout4), false);
    if (IS_WINDOWS) {
      assert.strictEqual(timeoutSummary.results[0].cleanup?.method, 'taskkill');
      assert.strictEqual(timeoutSummary.results[0].cleanup?.taskkillExitCode, 0);
      executionCoverage.executedEmpirically.push('Timeout real Windows com taskkill /PID /T /F');
    } else {
      assert.strictEqual(timeoutSummary.results[0].escalatedToKill, true);
      assert.strictEqual(timeoutSummary.results[0].cleanup?.method, 'posix-process-group');
      executionCoverage.executedEmpirically.push('Timeout real POSIX com escalada SIGTERM->SIGKILL no grupo -pgid');
    }
    assert.strictEqual(
      isPidRunning(pids4.childPid),
      false,
      `Processo filho (${pids4.childPid}) deve estar encerrado após timeout`
    );
    assert.strictEqual(
      isPidRunning(pids4.grandchildPid),
      false,
      `Processo descendente (${pids4.grandchildPid}) deve estar encerrado após timeout`
    );
    console.log(
      IS_WINDOWS
        ? '  [OK] 4. Timeout externo real e encerramento da árvore via taskkill /T /F (Windows)'
        : '  [OK] 4. Timeout externo real, escalada SIGTERM->SIGKILL e encerramento da árvore do filho (POSIX)'
    );

    // Contrato 5: Falha de inicialização (script ausente e erro real de spawn)
    const initMissingSummary = await runPlan(
      {
        id: 'synthetic-init-missing',
        category: 'partial',
        title: 'Script ausente',
        steps: [
          {
            id: 'i1',
            name: 'Script inexistente',
            script: path.join(tmpDir, 'does-not-exist.mjs'),
            runtime: 'node',
            env: {},
            timeoutMs: 2_000,
          },
          {
            id: 'i2',
            name: 'Não alcançado',
            script: sentinelScript,
            runtime: 'node',
            args: [path.join(tmpDir, 'sentinel-init.txt')],
            env: {},
            timeoutMs: 2_000,
          },
        ],
      },
      { logger: captureLog, stdio: 'ignore' }
    );
    assert.strictEqual(initMissingSummary.ok, false);
    assert.strictEqual(initMissingSummary.outcome, 'init-error');
    assert.strictEqual(initMissingSummary.exitCode, 1);
    assert.strictEqual(initMissingSummary.skipped.length, 1);

    const initSpawnErrSummary = await runPlan(
      {
        id: 'synthetic-init-spawn',
        category: 'partial',
        title: 'Erro real de spawn',
        steps: [
          {
            id: 'is1',
            name: 'Binário inexistente',
            script: failScript,
            runtime: 'node',
            env: {},
            timeoutMs: 2_000,
          },
        ],
      },
      {
        logger: captureLog,
        stdio: 'ignore',
        execPath: path.join(tmpDir, 'nonexistent-node-binary'),
      }
    );
    assert.strictEqual(initSpawnErrSummary.ok, false);
    assert.strictEqual(initSpawnErrSummary.outcome, 'init-error');
    assert.strictEqual(initSpawnErrSummary.exitCode, 1);
    executionCoverage.executedEmpirically.push('Falha de inicialização (script ausente e erro de spawn)');
    console.log('  [OK] 5. Tratamento de falha de inicialização (script ausente e erro de spawn)');

    // Contrato 6: Encerramento inesperado por sinal (adaptado à semântica de sinais Windows/POSIX)
    const signalSummary = await runPlan(
      {
        id: 'synthetic-signal',
        category: 'partial',
        title: 'Encerramento por sinal',
        steps: [
          {
            id: 'sig1',
            name: 'Auto-SIGTERM',
            script: signalSelfScript,
            runtime: 'node',
            env: {},
            timeoutMs: 5_000,
          },
        ],
      },
      { logger: captureLog, stdio: 'ignore' }
    );
    assert.strictEqual(signalSummary.ok, false);
    assert.strictEqual(signalSummary.exitCode, 1);
    if (IS_WINDOWS) {
      assert(
        signalSummary.outcome === 'signal-error' || signalSummary.outcome === 'assertion-failure',
        `Em Windows, auto-SIGTERM encerra sem sinal POSIX (obtido: ${signalSummary.outcome})`
      );
      executionCoverage.executedEmpirically.push('Encerramento abrupto por auto-SIGTERM (semântica Windows)');
    } else {
      assert.strictEqual(signalSummary.outcome, 'signal-error');
      assert.strictEqual(signalSummary.results[0].signal, 'SIGTERM');
      executionCoverage.executedEmpirically.push('Encerramento inesperado por sinal externo (POSIX SIGTERM)');
    }
    console.log('  [OK] 6. Tratamento de encerramento inesperado por sinal externo');

    // Contrato 7: Remoção dos 8 filtros herdados + aplicação de filtro explícito + imutabilidade de process.env
    const savedParentFilters = {};
    for (const k of INHERITED_FILTER_ENV_KEYS) {
      savedParentFilters[k] = Object.prototype.hasOwnProperty.call(process.env, k)
        ? process.env[k]
        : undefined;
      process.env[k] = `POLLUTED_${k}`;
    }

    try {
      const isolatedEmpty = buildIsolatedChildEnv(process.env, {});
      assert.strictEqual(isolatedEmpty.strippedFilters.length, INHERITED_FILTER_ENV_KEYS.length);
      for (const k of INHERITED_FILTER_ENV_KEYS) {
        assert.strictEqual(isolatedEmpty.env[k], undefined, `Filtro herdado ${k} deve ser removido`);
        assert.strictEqual(
          process.env[k],
          `POLLUTED_${k}`,
          `process.env do pai (${k}) não pode ser modificado`
        );
      }

      const outAll = path.join(tmpDir, 'filters-all.json');
      const outDomain = path.join(tmpDir, 'filters-domain.json');
      const filterSummary = await runPlan(
        {
          id: 'synthetic-filters',
          category: 'full-regression',
          title: 'Isolamento de filtros em processos filhos reais',
          steps: [
            {
              id: 'flt-empty',
              name: 'Sem filtro explícito (simula test:all)',
              script: dumpFiltersScript,
              runtime: 'node',
              args: [outAll, ...INHERITED_FILTER_ENV_KEYS],
              env: {},
              timeoutMs: 5_000,
            },
            {
              id: 'flt-explicit',
              name: 'Com filtro explícito NC_DIRECT_CASE=11',
              script: dumpFiltersScript,
              runtime: 'node',
              args: [outDomain, ...INHERITED_FILTER_ENV_KEYS],
              env: { NC_DIRECT_CASE: '11' },
              timeoutMs: 5_000,
            },
          ],
        },
        { logger: captureLog, stdio: 'ignore' }
      );
      assert.strictEqual(filterSummary.ok, true);
      assert.strictEqual(filterSummary.outcome, 'full-regression-passed');

      const childAllEnv = JSON.parse(fs.readFileSync(outAll, 'utf8'));
      const childDomainEnv = JSON.parse(fs.readFileSync(outDomain, 'utf8'));

      for (const k of INHERITED_FILTER_ENV_KEYS) {
        assert.strictEqual(
          childAllEnv[k],
          null,
          `Em execução sem filtro, ${k} deve estar ausente no processo filho`
        );
        if (k === 'NC_DIRECT_CASE') {
          assert.strictEqual(
            childDomainEnv[k],
            '11',
            'Filtro explícito NC_DIRECT_CASE=11 deve ser aplicado no processo filho'
          );
        } else {
          assert.strictEqual(
            childDomainEnv[k],
            null,
            `Demais filtros herdados (${k}) devem permanecer removidos`
          );
        }
        assert.strictEqual(
          process.env[k],
          `POLLUTED_${k}`,
          `process.env do processo pai (${k}) deve permanecer imutável após runPlan`
        );
      }
      executionCoverage.executedEmpirically.push('Isolamento dos 8 filtros herdados e imutabilidade de process.env');
      console.log('  [OK] 7. Isolamento dos 8 filtros herdados, filtro explícito e imutabilidade de process.env');
    } finally {
      for (const k of INHERITED_FILTER_ENV_KEYS) {
        if (savedParentFilters[k] === undefined) {
          delete process.env[k];
        } else {
          process.env[k] = savedParentFilters[k];
        }
      }
    }

    // Contrato 8 (NOVO — POSIX): Processo principal encerra ao receber SIGTERM,
    // mas descendente no mesmo grupo ignora SIGTERM; close do principal NÃO pode cancelar escalada SIGKILL
    if (!IS_WINDOWS) {
      const pidFile8 = path.join(tmpDir, 'early-exit-pids-8.json');
      const readyFile8 = path.join(tmpDir, 'early-exit-ready-8.txt');
      const sentinelAfter8 = path.join(tmpDir, 'sentinel-early-exit-8.txt');
      silentLogs.length = 0;

      const earlyExitSummary = await runPlan(
        {
          id: 'synthetic-posix-early-main-exit',
          category: 'partial',
          title: 'POSIX: principal encerra em SIGTERM enquanto descendente resiste',
          steps: [
            {
              id: 'p1',
              name: 'Filho encerra cedo + neto ignora SIGTERM',
              script: earlyExitStubbornDescendantScript,
              runtime: 'node',
              args: [pidFile8, readyFile8],
              env: {},
              timeoutMs: 550,
            },
            {
              id: 'p2',
              name: 'Passo que não pode rodar após timeout',
              script: sentinelScript,
              runtime: 'node',
              args: [sentinelAfter8],
              env: {},
              timeoutMs: 5_000,
            },
          ],
        },
        { logger: captureLog, stdio: 'ignore', killGraceMs: 250 }
      );

      assert.strictEqual(
        fs.existsSync(readyFile8),
        true,
        'Descendente deve ter iniciado e instalado trap SIGTERM antes do timeout'
      );
      const pids8 = JSON.parse(fs.readFileSync(pidFile8, 'utf8'));
      trackedPids.add(pids8.childPid);
      trackedPids.add(pids8.grandchildPid);
      trackedPosixGroups.add(pids8.childPid);

      assert.strictEqual(earlyExitSummary.ok, false);
      assert.strictEqual(earlyExitSummary.outcome, 'timeout');
      assert.strictEqual(earlyExitSummary.exitCode, 124);
      assert.strictEqual(
        earlyExitSummary.results[0].rawExitCode,
        0,
        'Processo principal deve ter encerrado voluntariamente (código 0) no SIGTERM'
      );
      assert.strictEqual(
        earlyExitSummary.results[0].escalatedToKill,
        true,
        'Close do processo principal NÃO pode cancelar a escalada SIGKILL para o grupo'
      );
      assert.strictEqual(earlyExitSummary.results[0].cleanup?.confirmed, true);
      assert.strictEqual(earlyExitSummary.results[0].cleanup?.errors.length, 0);
      assert.strictEqual(earlyExitSummary.skipped.length, 1);
      assert.strictEqual(fs.existsSync(sentinelAfter8), false, 'Nenhuma etapa posterior ao timeout pode executar');
      assert.strictEqual(isPidRunning(pids8.childPid), false, 'Processo principal deve estar encerrado');
      assert.strictEqual(
        isPidRunning(pids8.grandchildPid),
        false,
        `Descendente resistente a SIGTERM (${pids8.grandchildPid}) deve estar encerrado após SIGKILL no grupo`
      );
      executionCoverage.executedEmpirically.push(
        'Encerramento POSIX: close antecipado do principal não cancela escalada SIGKILL do grupo'
      );
      console.log(
        '  [OK] 8. Encerramento POSIX: close antecipado do principal preserva escalada SIGKILL sobre descendente do grupo'
      );
    } else {
      executionCoverage.staticOrMockOnly.push('Escalada POSIX SIGTERM->SIGKILL com descendente (não aplicável em Windows)');
      console.log('  [SKIP-WIN] 8. Contrato específico de escalada de grupo POSIX não aplicável em Windows');
    }

    // Contrato 9 (NOVO): Cancelamento manual (SIGINT via signalTarget + SIGTERM real via subprocesso em POSIX)
    // 9a: SIGINT com filho que intercepta sinal e encerra voluntariamente com código 0 + descendente no grupo
    {
      const pidFile9a = path.join(tmpDir, 'cancel-pids-9a.json');
      const readyFile9a = path.join(tmpDir, 'cancel-ready-9a.txt');
      const sentinel9a = path.join(tmpDir, 'sentinel-cancel-9a.txt');
      const fakeSignalTarget = new EventEmitter();
      silentLogs.length = 0;

      const cancelPlanPromise = runPlan(
        {
          id: 'synthetic-manual-cancel-sigint',
          category: 'domain',
          title: 'Cancelamento manual SIGINT com filho saindo com código 0',
          steps: [
            {
              id: 'c1',
              name: 'Passo intercepta SIGINT e encerra 0',
              script: trapSignalExitZeroScript,
              runtime: 'node',
              args: [pidFile9a, readyFile9a, 'SIGINT'],
              env: {},
              timeoutMs: 10_000,
            },
            {
              id: 'c2',
              name: 'Passo subsequente proibido após cancelamento',
              script: sentinelScript,
              runtime: 'node',
              args: [sentinel9a],
              env: {},
              timeoutMs: 5_000,
            },
          ],
        },
        {
          logger: captureLog,
          stdio: 'ignore',
          signalTarget: fakeSignalTarget,
          killGraceMs: 250,
        }
      );

      await waitForFile(readyFile9a, 4_000);
      const pids9a = JSON.parse(await waitForFile(pidFile9a, 4_000));
      trackedPids.add(pids9a.childPid);
      trackedPids.add(pids9a.grandchildPid);
      trackedPosixGroups.add(pids9a.childPid);

      fakeSignalTarget.emit('SIGINT', 'SIGINT');
      const cancelSummary = await cancelPlanPromise;

      assert.strictEqual(cancelSummary.ok, false, 'Plano cancelado jamais pode ser convertido em aprovação');
      assert.strictEqual(cancelSummary.outcome, 'cancelled');
      assert.strictEqual(cancelSummary.cancelled, true);
      assert.strictEqual(cancelSummary.cancelSignal, 'SIGINT');
      assert.strictEqual(cancelSummary.exitCode, 130, 'Cancelamento por SIGINT deve retornar código 130');
      assert.strictEqual(cancelSummary.results[0].status, 'cancelled');
      if (!IS_WINDOWS) {
        assert.strictEqual(
          cancelSummary.results[0].rawExitCode,
          0,
          'Filho deve ter encerrado voluntariamente com código 0, sem enganar o orquestrador'
        );
        assert.strictEqual(
          cancelSummary.results[0].escalatedToKill,
          true,
          'Descendente resistente a SIGINT deve ser encerrado por escalada SIGKILL do grupo'
        );
      }
      assert.strictEqual(cancelSummary.results[0].cleanup?.confirmed, true);
      assert.strictEqual(cancelSummary.skipped.length, 1);
      assert.strictEqual(cancelSummary.skipped[0].id, 'c2');
      assert.strictEqual(cancelSummary.skipped[0].status, 'skipped-after-cancellation');
      assert.strictEqual(fs.existsSync(sentinel9a), false, 'Nenhum passo subsequente pode executar após cancelamento');
      assert.strictEqual(isPidRunning(pids9a.childPid), false);
      assert.strictEqual(isPidRunning(pids9a.grandchildPid), false);
      assert(
        silentLogs.some((l) => l.includes('PLANO CANCELADO')) &&
        silentLogs.some((l) => l.includes('Execuções NÃO realizadas após o cancelamento')),
        'Relatório deve distinguir cancelamento manual e listar passos não realizados'
      );
    }

    // 9b: Sinal real do SO (SIGTERM) enviado a um subprocesso Node executando runPlan (POSIX)
    if (!IS_WINDOWS) {
      const pidFile9b = path.join(tmpDir, 'cancel-pids-9b.json');
      const readyFile9b = path.join(tmpDir, 'cancel-ready-9b.txt');
      const sentinel9b = path.join(tmpDir, 'sentinel-cancel-9b.txt');
      const runnerHarnessScript = path.join(tmpDir, 'cancel-os-sigterm-harness.mjs');
      const runTestsUrl = new URL('./run-tests.mjs', import.meta.url).href;

      fs.writeFileSync(
        runnerHarnessScript,
        [
          `import { runPlan } from ${JSON.stringify(runTestsUrl)};`,
          'const [childScript, pidFile, readyFile, sentinelScript, sentinelFile] = process.argv.slice(2);',
          'const summary = await runPlan({',
          "  id: 'os-sigterm-cancel',",
          "  category: 'domain',",
          "  title: 'Cancelamento real por SIGTERM do SO',",
          '  steps: [',
          '    {',
          "      id: 'os1',",
          "      name: 'Filho intercepta SIGTERM e sai 0',",
          '      script: childScript,',
          "      runtime: 'node',",
          "      args: [pidFile, readyFile, 'SIGTERM'],",
          '      env: {},',
          '      timeoutMs: 10_000,',
          '    },',
          '    {',
          "      id: 'os2',",
          "      name: 'Sentinela proibida',",
          '      script: sentinelScript,',
          "      runtime: 'node',",
          '      args: [sentinelFile],',
          '      env: {},',
          '      timeoutMs: 5_000,',
          '    },',
          '  ],',
          "}, { stdio: 'ignore', logger: () => {}, killGraceMs: 250 });",
          'process.exitCode = summary.ok ? 0 : (summary.exitCode || 1);',
        ].join('\n'),
        'utf8'
      );

      const harnessChild = spawn(
        process.execPath,
        [runnerHarnessScript, trapSignalExitZeroScript, pidFile9b, readyFile9b, sentinelScript, sentinel9b],
        {
          cwd: PROJECT_ROOT,
          stdio: 'ignore',
          shell: false,
          windowsHide: true,
        }
      );
      if (harnessChild.pid) trackedPids.add(harnessChild.pid);

      const harnessExitPromise = new Promise((resolve, reject) => {
        harnessChild.once('error', reject);
        harnessChild.once('close', (code, signal) => resolve({ code, signal }));
      });

      await waitForFile(readyFile9b, 4_000);
      const pids9b = JSON.parse(await waitForFile(pidFile9b, 4_000));
      trackedPids.add(pids9b.childPid);
      trackedPids.add(pids9b.grandchildPid);
      trackedPosixGroups.add(pids9b.childPid);

      process.kill(harnessChild.pid, 'SIGTERM');
      const harnessResult = await harnessExitPromise;

      assert.strictEqual(harnessResult.signal, null, 'Orquestrador deve concluir limpeza e encerrar naturalmente');
      assert.strictEqual(
        harnessResult.code,
        143,
        `Orquestrador cancelado por SIGTERM real do SO deve sair com código 143 (obtido: ${harnessResult.code})`
      );
      assert.strictEqual(fs.existsSync(sentinel9b), false, 'Passo subsequente não pode rodar após SIGTERM real');
      assert.strictEqual(isPidRunning(pids9b.childPid), false);
      assert.strictEqual(isPidRunning(pids9b.grandchildPid), false);
      executionCoverage.executedEmpirically.push(
        'Cancelamento manual (SIGINT=130 via signalTarget e SIGTERM=143 real do SO) com filho saindo com código 0'
      );
    } else {
      executionCoverage.executedEmpirically.push(
        'Cancelamento manual (SIGINT=130 via signalTarget com taskkill /T /F em Windows)'
      );
    }
    console.log(
      '  [OK] 9. Cancelamento manual (SIGINT=130 / SIGTERM=143) não convertido em aprovação, sem passos subsequentes'
    );

    // Contrato 10 (NOVO): Verificação contratual de `terminateWindowsProcessTree`
    // (taskkill /PID /T /F como primeira ação, shell:false, windowsHide:true, verificação de código e fallback seguro)
    {
      const calls = [];
      let childKillCount = 0;
      const fakeChild = {
        kill: (sig) => {
          childKillCount += 1;
          calls.push({ kind: 'fallback-child-kill', sig });
        },
      };

      // 10a: Sucesso (código 0) — taskkill é a primeira ação, sem fallback, confirmado=true
      const resOk = await terminateWindowsProcessTree(42424, {
        child: fakeChild,
        isChildClosed: () => true,
        logger: () => {},
        spawnFn: (cmd, args, opts) => {
          calls.push({ kind: 'spawn', cmd, args, opts });
          return createFakeTaskkillProcess({ code: 0 });
        },
      });
      assert.strictEqual(calls.length, 1, 'taskkill deve ser a única ação quando encerra com código 0');
      assert.strictEqual(calls[0].kind, 'spawn');
      assert.strictEqual(calls[0].cmd, 'taskkill');
      assert.deepStrictEqual(calls[0].args, ['/PID', '42424', '/T', '/F']);
      assert.strictEqual(calls[0].opts.shell, false);
      assert.strictEqual(calls[0].opts.windowsHide, true);
      assert.strictEqual(calls[0].args.includes('/IM'), false, 'Nunca usar encerramento por nome de executável');
      assert.strictEqual(resOk.confirmed, true);
      assert.strictEqual(resOk.taskkillExitCode, 0);
      assert.strictEqual(resOk.fallbackUsed, false);
      assert.strictEqual(resOk.errors.length, 0);

      // 10b: Código 128 (PID já não encontrado) — NÃO declara árvore confirmada
      const res128 = await terminateWindowsProcessTree(42425, {
        child: fakeChild,
        isChildClosed: () => true,
        logger: () => {},
        spawnFn: () => createFakeTaskkillProcess({ code: 128, stderr: 'ERROR: The process "42425" not found.' }),
      });
      assert.strictEqual(res128.confirmed, false, 'Código 128 não pode declarar árvore confirmada');
      assert.strictEqual(res128.taskkillExitCode, 128);
      assert(res128.errors.length >= 1);

      // 10c: Erro de spawn de taskkill com filho ainda aberto — ativa fallback limitado e mantém confirmed=false
      childKillCount = 0;
      let closedAfterFallback = false;
      const resSpawnErr = await terminateWindowsProcessTree(42426, {
        child: {
          kill: (sig) => {
            childKillCount += 1;
            assert.strictEqual(sig, 'SIGKILL');
            closedAfterFallback = true;
          },
        },
        isChildClosed: () => closedAfterFallback,
        waitForChildClose: () => Promise.resolve(),
        logger: () => {},
        spawnFn: () => createFakeTaskkillProcess({ error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) }),
      });
      assert.strictEqual(resSpawnErr.confirmed, false, 'Erro de spawn em taskkill não pode confirmar árvore');
      assert.strictEqual(resSpawnErr.fallbackUsed, true);
      assert.strictEqual(childKillCount, 1);
      assert(resSpawnErr.errors.length >= 1);

      // 10d: Timeout do próprio taskkill — não aguarda indefinidamente, ativa fallback e mantém confirmed=false
      childKillCount = 0;
      let closedAfterTimeoutFallback = false;
      const resTaskkillTimeout = await terminateWindowsProcessTree(42427, {
        child: {
          kill: () => {
            childKillCount += 1;
            closedAfterTimeoutFallback = true;
          },
        },
        isChildClosed: () => closedAfterTimeoutFallback,
        waitForChildClose: () => Promise.resolve(),
        taskkillTimeoutMs: 40,
        logger: () => {},
        spawnFn: () => createFakeTaskkillProcess({ hang: true }),
      });
      assert.strictEqual(resTaskkillTimeout.taskkillTimedOut, true);
      assert.strictEqual(resTaskkillTimeout.confirmed, false);
      assert.strictEqual(resTaskkillTimeout.fallbackUsed, true);
      assert.strictEqual(childKillCount, 1);

      if (!IS_WINDOWS) {
        executionCoverage.staticOrMockOnly.push(
          'Execução real de taskkill /PID /T /F no sistema operacional Windows (verificado apenas via contrato simulado neste host POSIX)'
        );
        executionCoverage.staticOrMockOnly.push(
          'Limpeza case-insensitive de variáveis de filtro e comportamento real de CTRL+C/sinais em Windows'
        );
      }
      console.log(
        IS_WINDOWS
          ? '  [OK] 10. Contrato terminateWindowsProcessTree (taskkill /T /F, códigos de saída, timeout e fallback seguro)'
          : '  [OK] 10. Contrato simulado de terminateWindowsProcessTree (validação contratual/estática; execução real Windows pendente)'
      );
    }

    // Verificação explícita de ausência de processos sintéticos remanescentes
    const remainingPids = [...trackedPids].filter((pid) => isPidRunning(pid));
    assert.deepStrictEqual(
      remainingPids,
      [],
      `Nenhum processo sintético pode permanecer em execução ao final do autoteste (restantes: ${remainingPids.join(', ')})`
    );
    console.log(
      `  [OK] Limpeza final verificada: 0 de ${trackedPids.size} processos sintéticos rastreados remanescentes.`
    );

    console.log(`\n📋 Cobertura efetiva nesta plataforma (${process.platform}):`);
    for (const item of executionCoverage.executedEmpirically) {
      console.log(`   - [EMPÍRICO] ${item}`);
    }
    if (executionCoverage.staticOrMockOnly.length > 0) {
      console.log('📋 Caminhos NÃO validados empiricamente neste ambiente (somente estático/simulado):');
      for (const item of executionCoverage.staticOrMockOnly) {
        console.log(`   - [PENDENTE NO SO-ALVO] ${item}`);
      }
    }
  } finally {
    forceCleanupTrackedSyntheticProcesses(trackedPids, trackedPosixGroups);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  const startedAt = Date.now();
  console.log('🧪 INICIANDO AUTOTESTE SINTÉTICO DO ORQUESTRADOR (scripts/test-runner.mjs)...');
  await testStaticPackageAndPlansMapping();
  await testSyntheticContracts();
  console.log(
    `\n✅ AUTOTESTE DO ORQUESTRADOR APROVADO (10/10 contratos verificados) em ${Date.now() - startedAt}ms.`
  );
}

try {
  await main();
} catch (err) {
  console.error('\n❌ FALHA NO AUTOTESTE DO ORQUESTRADOR:', err);
  process.exitCode = 1;
}
