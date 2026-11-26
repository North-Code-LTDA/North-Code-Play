import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  EXTERNAL_TIMEOUTS_MS,
  INHERITED_FILTER_ENV_KEYS,
  PROJECT_ROOT,
  TEST_PLANS,
  buildChildCommand,
  buildIsolatedChildEnv,
  resolveTsxLoaderUrl,
  runPlan,
} from './run-tests.mjs';

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

async function testStaticPackageAndPlansMapping() {
  const pkgPath = path.join(PROJECT_ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const scripts = pkg.scripts ?? {};

  // 1. Verificar preservação integral dos comandos existentes
  const preservedCommands = {
    test: 'tsx scripts/test-direct.ts',
    'test:carousels': 'tsx scripts/test-showcase-carousels.ts',
    'test:login-config': 'tsx scripts/test-login-config.ts',
    'test:fullscreen-exit': 'tsx scripts/test-fullscreen-exit.ts',
    'test:performance-profile': 'tsx scripts/test-performance-profile.ts',
    'test:live-tv-nav': 'tsx scripts/test-live-tv-nav.ts',
    'test:live-tv-epg-assets': 'tsx scripts/test-live-tv-epg-assets.ts',
  };
  for (const [name, expectedCmd] of Object.entries(preservedCommands)) {
    assert.strictEqual(
      scripts[name],
      expectedCmd,
      `Comando existente "${name}" deve permanecer preservado`
    );
  }

  // 2. Verificar todos os novos comandos npm
  const expectedNewCommands = {
    'test:live-zapping': 'node scripts/run-tests.mjs live-zapping',
    'test:api-transport': 'node scripts/run-tests.mjs api-transport',
    'test:spatial-nav': 'node scripts/run-tests.mjs spatial-nav',
    'test:android-image-cache': 'node scripts/run-tests.mjs android-image-cache',
    'test:android-prepare': 'node scripts/run-tests.mjs android-prepare',
    'test:smoke': 'node scripts/run-tests.mjs smoke',
    'test:all': 'node scripts/run-tests.mjs all',
  };
  for (const [name, expectedCmd] of Object.entries(expectedNewCommands)) {
    assert.strictEqual(
      scripts[name],
      expectedCmd,
      `Novo comando "${name}" deve apontar para o orquestrador multiplataforma`
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

  // Confirmar que os limites externos das suítes completas não aplicam 25s indiscriminadamente
  assert(EXTERNAL_TIMEOUTS_MS.fullLiveTvNav >= 200_000, 'test-live-tv-nav completo deve ter margem sobre 180s');
  assert(EXTERNAL_TIMEOUTS_MS.fullDirect >= 140_000, 'test-direct completo deve ter margem sobre 120s');

  // 5. Verificar resolução local de tsx e construção de argumentos sem shell
  const loaderUrl = resolveTsxLoaderUrl();
  assert(loaderUrl.startsWith('file://'), `Loader tsx deve ser URL file:// local (obtido: ${loaderUrl})`);
  assert(
    loaderUrl.includes('/node_modules/tsx/'),
    `Loader tsx deve apontar para node_modules/tsx local (obtido: ${loaderUrl})`
  );

  const built = buildChildCommand(TEST_PLANS.smoke.steps[0]);
  assert.strictEqual(built.command, process.execPath, 'Comando deve usar process.execPath');
  assert.strictEqual(built.cwd, PROJECT_ROOT, 'Diretório de trabalho deve ser a raiz do projeto');
  assert.strictEqual(built.args[0], '--import', 'Deve carregar tsx via --import');
  assert.strictEqual(built.args[1], loaderUrl, 'Deve usar URL local do tsx');
  assert.strictEqual(
    built.args[2],
    path.resolve(PROJECT_ROOT, 'scripts/test-live-zapping.ts'),
    'Argumento do script deve ser caminho resolvido separado em array'
  );

  // 6. Verificar lista exata dos 8 filtros herdados
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

  console.log('  [OK] 1. Mapeamento estático de package.json, planos, watchdogs e loader tsx local');
}

async function testSyntheticContracts() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-run-tests-selfcheck-'));
  const silentLogs = [];
  const captureLog = (line) => silentLogs.push(String(line));

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

    const hangWithChildScript = path.join(tmpDir, 'hang-with-child.mjs');
    fs.writeFileSync(
      hangWithChildScript,
      [
        "import { spawn } from 'node:child_process';",
        "import fs from 'node:fs';",
        'const pidFile = process.argv[2];',
        "process.on('SIGTERM', () => { /* ignora SIGTERM para validar escalonamento SIGKILL */ });",
        "const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)'], { stdio: 'ignore', shell: false });",
        'fs.writeFileSync(pidFile, JSON.stringify({ childPid: process.pid, grandchildPid: grandchild.pid }));',
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
            args: [seqLog, 'STEP1', '60'],
            env: {},
            timeoutMs: 5_000,
          },
          {
            id: 's2',
            name: 'Passo sintético 2',
            purpose: 'Validar execução sequencial 2',
            script: seqScript,
            runtime: 'node',
            args: [seqLog, 'STEP2', '30'],
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
    console.log('  [OK] 3. Propagação de código não zero, interrupção após 1ª falha e registro de ignorados');

    // Contrato 4: Timeout real + encerramento do processo filho e descendente + aguardo efetivo
    const pidFile = path.join(tmpDir, 'hang-pids.json');
    const sentinelAfterTimeout = path.join(tmpDir, 'sentinel-timeout.txt');
    silentLogs.length = 0;
    const timeoutSummary = await runPlan(
      {
        id: 'synthetic-timeout',
        category: 'partial',
        title: 'Plano sintético com timeout e processo descendente',
        steps: [
          {
            id: 't1',
            name: 'Passo travado com filho',
            script: hangWithChildScript,
            runtime: 'node',
            args: [pidFile],
            env: {},
            timeoutMs: 350,
          },
          {
            id: 't2',
            name: 'Passo ignorado após timeout',
            script: sentinelScript,
            runtime: 'node',
            args: [sentinelAfterTimeout],
            env: {},
            timeoutMs: 5_000,
          },
        ],
      },
      { logger: captureLog, stdio: 'ignore', killGraceMs: 250 }
    );
    assert.strictEqual(timeoutSummary.ok, false);
    assert.strictEqual(timeoutSummary.outcome, 'timeout');
    assert.strictEqual(timeoutSummary.exitCode, 124);
    assert.strictEqual(timeoutSummary.results[0].timedOut, true);
    assert.strictEqual(timeoutSummary.skipped.length, 1);
    assert.strictEqual(fs.existsSync(sentinelAfterTimeout), false);

    // Pequena janela para o SO finalizar a coleta do descendente após SIGKILL de grupo
    await new Promise((r) => setTimeout(r, 80));
    const { childPid, grandchildPid } = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
    assert.strictEqual(isPidAlive(childPid), false, `Processo filho (${childPid}) deve estar encerrado após timeout`);
    assert.strictEqual(
      isPidAlive(grandchildPid),
      false,
      `Processo descendente (${grandchildPid}) deve estar encerrado após timeout`
    );
    console.log('  [OK] 4. Timeout externo real, escalonamento SIGTERM->SIGKILL e encerramento da árvore do filho');

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
    console.log('  [OK] 5. Tratamento de falha de inicialização (script ausente e erro de spawn)');

    // Contrato 6: Encerramento por sinal (fora de timeout)
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
    assert.strictEqual(signalSummary.outcome, 'signal-error');
    assert.strictEqual(signalSummary.results[0].signal, 'SIGTERM');
    assert.strictEqual(signalSummary.exitCode, 1);
    console.log('  [OK] 6. Tratamento de encerramento por sinal externo');

    // Contrato 7: Remoção dos 8 filtros herdados + aplicação de filtro explícito + imutabilidade de process.env
    const savedParentFilters = {};
    for (const k of INHERITED_FILTER_ENV_KEYS) {
      savedParentFilters[k] = Object.prototype.hasOwnProperty.call(process.env, k)
        ? process.env[k]
        : undefined;
      process.env[k] = `POLLUTED_${k}`;
    }

    try {
      // Verificação unitária de buildIsolatedChildEnv sem mutar process.env
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

      // Verificação real em processos filhos sintéticos (passo sem filtro + passo com filtro explícito)
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
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  const startedAt = Date.now();
  console.log('🧪 INICIANDO AUTOTESTE SINTÉTICO DO ORQUESTRADOR (scripts/test-runner.mjs)...');
  await testStaticPackageAndPlansMapping();
  await testSyntheticContracts();
  console.log(
    `\n✅ AUTOTESTE DO ORQUESTRADOR APROVADO (7/7 contratos verificados) em ${Date.now() - startedAt}ms.`
  );
}

try {
  await main();
} catch (err) {
  console.error('\n❌ FALHA NO AUTOTESTE DO ORQUESTRADOR:', err);
  process.exitCode = 1;
}
