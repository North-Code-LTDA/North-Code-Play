import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PROJECT_ROOT = path.resolve(__dirname, '..');

export const DOM_SUITE_RELATIVE_PATHS = Object.freeze([
  'scripts/test-direct.ts',
  'scripts/test-login-config.ts',
  'scripts/test-fullscreen-exit.ts',
  'scripts/test-performance-profile.ts',
  'scripts/test-live-tv-nav.ts',
  'scripts/test-live-tv-epg-assets.ts',
  'scripts/test-showcase-carousels.ts',
]);

function normalizeFsPath(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

const DOM_SUITE_PATH_SET = new Set(
  DOM_SUITE_RELATIVE_PATHS.map((relPath) => normalizeFsPath(path.resolve(PROJECT_ROOT, relPath)))
);

export function shouldPreloadHappyDom(targetAbsPath) {
  return DOM_SUITE_PATH_SET.has(normalizeFsPath(targetAbsPath));
}

let tsxEsmRegistered = false;

function registerTsxEsmOnce(registerFn) {
  if (tsxEsmRegistered) {
    return;
  }
  registerFn();
  tsxEsmRegistered = true;
}

function isDirectCliInvocation() {
  if (!process.argv[1]) return false;
  try {
    return normalizeFsPath(process.argv[1]) === normalizeFsPath(__filename);
  } catch {
    return false;
  }
}

async function runBootstrap() {
  const targetArg = process.argv[2];
  if (!targetArg || targetArg.trim() === '') {
    throw new Error(
      'Uso: node scripts/test-bootstrap.mjs <caminho-da-suite.ts> [argumentos-adicionais...]'
    );
  }

  const targetAbsPath = path.resolve(process.cwd(), targetArg);
  if (!fs.existsSync(targetAbsPath)) {
    throw new Error(`Suíte de teste não encontrada: ${targetAbsPath}`);
  }

  const stat = fs.statSync(targetAbsPath);
  if (!stat.isFile()) {
    throw new Error(`O caminho informado não é um arquivo de suíte válido: ${targetAbsPath}`);
  }

  // Preserva process.argv como se a suíte original fosse o ponto de entrada,
  // mantendo process.argv[0], definindo process.argv[1] como o arquivo alvo e preservando extras.
  const extraArgs = process.argv.slice(3);
  process.argv.splice(1, process.argv.length - 1, targetAbsPath, ...extraArgs);

  const preloadHappyDom = shouldPreloadHappyDom(targetAbsPath);

  if (preloadHappyDom) {
    // Sequência experimental validada em Windows e Linux:
    // 1. Pré-carregar happy-dom nativamente antes de ativar o loader TypeScript.
    const nativeDom = await import('happy-dom');

    // 2. Registrar a API ESM do tsx uma única vez, mantendo-a ativa por toda a execução assíncrona.
    const { register } = await import('tsx/esm/api');
    registerTsxEsmOnce(register);

    // 3. Validar que happy-dom importado sob o loader preserva exatamente a mesma classe Window.
    const reusedDom = await import('happy-dom');
    if (nativeDom.Window !== reusedDom.Window) {
      throw new Error('Identidade da classe Window não preservada');
    }
  } else {
    // Suítes de lógica pura (como scripts/test-live-zapping.ts) não pré-carregam happy-dom.
    const { register } = await import('tsx/esm/api');
    registerTsxEsmOnce(register);
  }

  // 4. Importar dinamicamente o arquivo original da suíte via URL file:// multiplataforma.
  // Não desregistrar o loader após o retorno do import, pois suítes podem manter imports dinâmicos assíncronos.
  const suiteUrl = pathToFileURL(targetAbsPath).href;
  await import(suiteUrl);
}

if (isDirectCliInvocation()) {
  try {
    await runBootstrap();
  } catch (err) {
    console.error('[test-bootstrap] ❌ Falha ao inicializar/executar suíte:', err);
    process.exitCode = 1;
  }
}
