#!/usr/bin/env node
/**
 * Script multiplataforma de preparação da camada de portabilidade Android (Capacitor 8)
 * do North Code Play.
 *
 * Responsabilidades:
 * 1. Garantir que o build web (`dist/`) exista (executando `npm run build` quando necessário).
 * 2. Validar a versão travada de `@capacitor/android` (8.6.0) e aplicar de forma idempotente
 *    o patch mínimo `tooling/android/patches/capacitor-android-8.6.0-http-diagnostics.patch`
 *    para medição por etapa do carregamento dos catálogos no Android (P3.2).
 * 3. Gerar a estrutura `android/` via Capacitor CLI quando ausente, ou reutilizar uma pasta
 *    `android/` já existente sem apagá-la.
 * 4. Reaplicar de forma determinística e idempotente todas as personalizações preservadas em
 *    `tooling/android/overlay/`, os ícones oficiais a partir de `src/assets/logo.png` e o
 *    versionamento (`versionCode` e `versionName`) em `android/app/build.gradle`.
 * 5. Sincronizar o bundle web (`dist/`) e os plugins oficiais do Capacitor (`cap sync android`).
 * 6. Validar a integridade dos artefatos gerados e encerrar com erro claro caso qualquer etapa falhe.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT_DIR = path.resolve(__dirname, '..', '..');

export const EXPECTED_CAPACITOR_ANDROID_VERSION = '8.6.0';

export const CAPACITOR_HTTP_DIAGNOSTICS_PATCH_REL_PATH = path.join(
  'tooling',
  'android',
  'patches',
  'capacitor-android-8.6.0-http-diagnostics.patch'
);

export const CAPACITOR_HTTP_HANDLER_REL_PATH = path.join(
  'node_modules',
  '@capacitor',
  'android',
  'capacitor',
  'src',
  'main',
  'java',
  'com',
  'getcapacitor',
  'plugin',
  'util',
  'HttpRequestHandler.java'
);

const REQUIRED_PATCH_MARKERS = [
  'boolean collectDiagnostics = Boolean.TRUE.equals(call.getBoolean("collectDiagnostics", false));',
  'buildResponseWithDiagnostics(connection, responseType, requestStartNs, nativeDiagnostics)',
  'nativeDiagnostics.put("statusAndHeadersMs", statusAndHeadersMs);',
  'nativeDiagnostics.put("bodyReadMs", bodyReadMs);',
  'nativeDiagnostics.put("nativeJsonParseExecuted", nativeJsonParseExecuted);',
  'nativeDiagnostics.put("nativeJsonParseMs",',
  'nativeDiagnostics.put("nativeTotalMs", nanosToMillis(System.nanoTime() - requestStartNs));',
  '"contentLengthHeaderBytes"',
  'nativeDiagnostics.put("payloadChars",',
  'response.put("nativeDiagnostics", nativeDiagnostics);',
];

const MIPMAP_DENSITIES = [
  'mipmap-mdpi',
  'mipmap-hdpi',
  'mipmap-xhdpi',
  'mipmap-xxhdpi',
  'mipmap-xxxhdpi',
];

const MIPMAP_ICON_FILENAMES = [
  'ic_launcher.png',
  'ic_launcher_round.png',
  'ic_launcher_foreground.png',
];

export function computeAndroidVersionCode(versionString) {
  const clean = String(versionString || '1.0.0').trim().split('-')[0];
  const parts = clean.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const major = parts[0] || 1;
  const minor = parts[1] || 0;
  const patch = parts[2] || 0;
  return major * 10000 + minor * 100 + patch;
}

function parseUnifiedDiffHunks(patchContent) {
  const normalized = patchContent.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const hunks = [];
  let currentHunk = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      continue;
    }
    const headerMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (headerMatch) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }
      currentHunk = {
        oldStart: Number.parseInt(headerMatch[1], 10),
        oldCount: headerMatch[2] !== undefined ? Number.parseInt(headerMatch[2], 10) : 1,
        newStart: Number.parseInt(headerMatch[3], 10),
        newCount: headerMatch[4] !== undefined ? Number.parseInt(headerMatch[4], 10) : 1,
        preLines: [],
        postLines: [],
      };
      continue;
    }
    if (!currentHunk) {
      continue;
    }
    if (line.startsWith(' ')) {
      const content = line.slice(1);
      currentHunk.preLines.push(content);
      currentHunk.postLines.push(content);
    } else if (line.startsWith('-')) {
      currentHunk.preLines.push(line.slice(1));
    } else if (line.startsWith('+')) {
      currentHunk.postLines.push(line.slice(1));
    }
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }

  if (hunks.length === 0) {
    throw new Error('Nenhum hunk válido encontrado no arquivo de patch P3.2.');
  }

  return hunks;
}

function linesSliceMatch(sourceLines, startIndexZeroBased, expectedLines) {
  if (
    startIndexZeroBased < 0 ||
    startIndexZeroBased + expectedLines.length > sourceLines.length
  ) {
    return false;
  }
  for (let i = 0; i < expectedLines.length; i++) {
    if (sourceLines[startIndexZeroBased + i] !== expectedLines[i]) {
      return false;
    }
  }
  return true;
}

function hasAllRequiredPatchMarkers(content) {
  for (const marker of REQUIRED_PATCH_MARKERS) {
    if (!content.includes(marker)) {
      return false;
    }
  }
  return true;
}

/**
 * Valida a versão instalada de `@capacitor/android` (8.6.0) e aplica de forma idempotente
 * o patch mínimo em `HttpRequestHandler.java` para a medição por etapa do P3.2.
 * Se o patch já estiver aplicado, encerra sem regravar o arquivo.
 */
export function applyCapacitorAndroidHttpDiagnosticsPatch({
  rootDir = DEFAULT_ROOT_DIR,
} = {}) {
  const capAndroidPkgPath = path.join(
    rootDir,
    'node_modules',
    '@capacitor',
    'android',
    'package.json'
  );
  if (!fs.existsSync(capAndroidPkgPath)) {
    throw new Error(
      `Pacote @capacitor/android não encontrado em "${capAndroidPkgPath}". Execute "npm ci" ou "npm install".`
    );
  }

  const capAndroidPkg = JSON.parse(fs.readFileSync(capAndroidPkgPath, 'utf8'));
  const installedVersion = String(capAndroidPkg.version || '').trim();
  if (installedVersion !== EXPECTED_CAPACITOR_ANDROID_VERSION) {
    throw new Error(
      `Versão incompatível de @capacitor/android: esperado "${EXPECTED_CAPACITOR_ANDROID_VERSION}" para o patch P3.2, encontrado "${installedVersion}".`
    );
  }

  const patchPath = path.join(rootDir, CAPACITOR_HTTP_DIAGNOSTICS_PATCH_REL_PATH);
  if (!fs.existsSync(patchPath)) {
    throw new Error(`Arquivo de patch Android P3.2 não encontrado em: ${patchPath}`);
  }

  const targetFile = path.join(rootDir, CAPACITOR_HTTP_HANDLER_REL_PATH);
  if (!fs.existsSync(targetFile)) {
    throw new Error(
      `Fonte nativo HttpRequestHandler.java não encontrado em: ${targetFile}`
    );
  }

  const patchText = fs.readFileSync(patchPath, 'utf8');
  const hunks = parseUnifiedDiffHunks(patchText);

  const rawTargetContent = fs.readFileSync(targetFile, 'utf8');
  const normalizedTargetContent = rawTargetContent.replace(/\r\n/g, '\n');
  const targetLines = normalizedTargetContent.split('\n');

  const matchesPostState = hunks.every((hunk) =>
    linesSliceMatch(targetLines, hunk.newStart - 1, hunk.postLines)
  );
  if (matchesPostState && hasAllRequiredPatchMarkers(normalizedTargetContent)) {
    return {
      applied: false,
      alreadyApplied: true,
      version: installedVersion,
      targetFile,
      patchPath,
    };
  }

  const matchesPreState = hunks.every((hunk) =>
    linesSliceMatch(targetLines, hunk.oldStart - 1, hunk.preLines)
  );
  if (!matchesPreState) {
    throw new Error(
      `Conteúdo inesperado em "${targetFile}": o arquivo não corresponde ao fonte original nem ao fonte já patcheado de @capacitor/android@${EXPECTED_CAPACITOR_ANDROID_VERSION}.`
    );
  }

  const updatedLines = [...targetLines];
  for (let i = hunks.length - 1; i >= 0; i--) {
    const hunk = hunks[i];
    updatedLines.splice(hunk.oldStart - 1, hunk.preLines.length, ...hunk.postLines);
  }

  const patchedContent = updatedLines.join('\n');
  if (!hasAllRequiredPatchMarkers(patchedContent)) {
    throw new Error(
      `Falha ao validar marcadores do patch P3.2 após aplicação em "${targetFile}".`
    );
  }

  fs.writeFileSync(targetFile, patchedContent, 'utf8');

  return {
    applied: true,
    alreadyApplied: false,
    version: installedVersion,
    targetFile,
    patchPath,
  };
}

export function verifyCapacitorAndroidHttpDiagnosticsPatch(rootDir = DEFAULT_ROOT_DIR) {
  const capAndroidPkgPath = path.join(
    rootDir,
    'node_modules',
    '@capacitor',
    'android',
    'package.json'
  );
  if (!fs.existsSync(capAndroidPkgPath)) {
    throw new Error(
      `Validação pós-preparação falhou: @capacitor/android/package.json ausente em ${capAndroidPkgPath}`
    );
  }
  const capAndroidPkg = JSON.parse(fs.readFileSync(capAndroidPkgPath, 'utf8'));
  if (String(capAndroidPkg.version || '').trim() !== EXPECTED_CAPACITOR_ANDROID_VERSION) {
    throw new Error(
      `Validação pós-preparação falhou: versão de @capacitor/android (${capAndroidPkg.version}) difere da versão travada (${EXPECTED_CAPACITOR_ANDROID_VERSION}).`
    );
  }

  const targetFile = path.join(rootDir, CAPACITOR_HTTP_HANDLER_REL_PATH);
  if (!fs.existsSync(targetFile)) {
    throw new Error(
      `Validação pós-preparação falhou: HttpRequestHandler.java ausente em ${targetFile}`
    );
  }
  const content = fs.readFileSync(targetFile, 'utf8').replace(/\r\n/g, '\n');
  if (!hasAllRequiredPatchMarkers(content)) {
    throw new Error(
      'Validação pós-preparação falhou: HttpRequestHandler.java não contém a instrumentação por etapa do P3.2.'
    );
  }
}

function copyDirectoryOverlayRecursive(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) {
    throw new Error(`Diretório de personalizações Android não encontrado: ${srcDir}`);
  }
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDirectoryOverlayRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function patchAppBuildGradle(buildGradlePath, versionName, versionCode) {
  if (!fs.existsSync(buildGradlePath)) {
    throw new Error(`Arquivo build.gradle do módulo app não encontrado em: ${buildGradlePath}`);
  }

  let content = fs.readFileSync(buildGradlePath, 'utf8');

  content = content.replace(
    /namespace\s*=?\s*["'][^"']+["']/,
    'namespace = "com.northcode.play"'
  );
  content = content.replace(
    /applicationId\s+["'][^"']+["']/,
    'applicationId "com.northcode.play"'
  );
  content = content.replace(
    /versionCode\s+\d+/,
    `versionCode ${versionCode}`
  );
  content = content.replace(
    /versionName\s+["'][^"']+["']/,
    `versionName "${versionName}"`
  );

  fs.writeFileSync(buildGradlePath, content, 'utf8');
}

function copyBrandLauncherIcons(logoSourcePath, resDir) {
  if (!fs.existsSync(logoSourcePath)) {
    throw new Error(`Logo oficial não encontrado para geração de ícones Android: ${logoSourcePath}`);
  }

  for (const density of MIPMAP_DENSITIES) {
    const densityDir = path.join(resDir, density);
    fs.mkdirSync(densityDir, { recursive: true });
    for (const iconName of MIPMAP_ICON_FILENAMES) {
      fs.copyFileSync(logoSourcePath, path.join(densityDir, iconName));
    }
  }
}

function runNodeBinOrCommand(rootDir, binJsPath, args, stepLabel) {
  const result = spawnSync(process.execPath, [binJsPath, ...args], {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    throw new Error(`Falha ao executar "${stepLabel}": ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`A etapa "${stepLabel}" encerrou com código de erro ${result.status ?? 1}.`);
  }
}

function resolveCapacitorCliBin(rootDir) {
  const localCapBin = path.join(
    rootDir,
    'node_modules',
    '@capacitor',
    'cli',
    'bin',
    'capacitor'
  );
  if (fs.existsSync(localCapBin)) {
    return localCapBin;
  }
  throw new Error(
    `Capacitor CLI não encontrado em "${localCapBin}". Execute "npm ci" ou "npm install" antes de preparar o projeto Android.`
  );
}

function resolveViteCliBin(rootDir) {
  const localViteBin = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');
  if (fs.existsSync(localViteBin)) {
    return localViteBin;
  }
  throw new Error(
    `Vite CLI não encontrado em "${localViteBin}". Execute "npm ci" ou "npm install" antes do build.`
  );
}

export function verifyAndroidCustomizations(rootDir, expectedVersionName, expectedVersionCode) {
  verifyCapacitorAndroidHttpDiagnosticsPatch(rootDir);

  const androidDir = path.join(rootDir, 'android');
  const requiredFiles = [
    path.join(rootDir, CAPACITOR_HTTP_DIAGNOSTICS_PATCH_REL_PATH),
    path.join(androidDir, 'app', 'build.gradle'),
    path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml'),
    path.join(androidDir, 'app', 'src', 'main', 'java', 'com', 'northcode', 'play', 'MainActivity.java'),
    path.join(androidDir, 'app', 'src', 'main', 'res', 'xml', 'network_security_config.xml'),
    path.join(androidDir, 'app', 'src', 'main', 'res', 'drawable', 'tv_banner.xml'),
    path.join(androidDir, 'app', 'src', 'main', 'res', 'drawable', 'ic_launcher_foreground_inset.xml'),
    path.join(androidDir, 'app', 'src', 'main', 'res', 'values', 'strings.xml'),
    path.join(androidDir, 'app', 'src', 'main', 'res', 'values', 'ic_launcher_background.xml'),
    path.join(androidDir, 'app', 'src', 'main', 'res', 'mipmap-anydpi-v26', 'ic_launcher.xml'),
    path.join(androidDir, 'app', 'src', 'main', 'res', 'mipmap-anydpi-v26', 'ic_launcher_round.xml'),
    path.join(androidDir, 'app', 'src', 'main', 'assets', 'webview_update_required.html'),
    path.join(androidDir, 'app', 'src', 'main', 'assets', 'public', 'index.html'),
    path.join(androidDir, 'app', 'src', 'main', 'assets', 'capacitor.config.json'),
    path.join(androidDir, 'app', 'src', 'main', 'assets', 'capacitor.plugins.json'),
  ];

  for (const filePath of requiredFiles) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Validação pós-preparação falhou: arquivo obrigatório ausente: ${filePath}`);
    }
  }

  const manifestContent = fs.readFileSync(
    path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml'),
    'utf8'
  );
  if (
    !manifestContent.includes('android.intent.category.LEANBACK_LAUNCHER') ||
    !manifestContent.includes('android.intent.category.LAUNCHER') ||
    !manifestContent.includes('@xml/network_security_config') ||
    !manifestContent.includes('android:usesCleartextTraffic="true"') ||
    !manifestContent.includes('@drawable/tv_banner')
  ) {
    throw new Error(
      'Validação pós-preparação falhou: AndroidManifest.xml não contém todas as configurações de TV/Mobile/Rede do North Code Play.'
    );
  }

  const mainActivityContent = fs.readFileSync(
    path.join(androidDir, 'app', 'src', 'main', 'java', 'com', 'northcode', 'play', 'MainActivity.java'),
    'utf8'
  );
  if (
    !mainActivityContent.includes('UI_MODE_TYPE_TELEVISION') ||
    !mainActivityContent.includes('setMinimumFontSize(1)') ||
    !mainActivityContent.includes('setTextZoom(100)')
  ) {
    throw new Error(
      'Validação pós-preparação falhou: MainActivity.java não contém a configuração de WebView para Android TV.'
    );
  }

  const gradleContent = fs.readFileSync(path.join(androidDir, 'app', 'build.gradle'), 'utf8');
  if (
    !gradleContent.includes(`versionCode ${expectedVersionCode}`) ||
    !gradleContent.includes(`versionName "${expectedVersionName}"`) ||
    !gradleContent.includes('applicationId "com.northcode.play"')
  ) {
    throw new Error(
      `Validação pós-preparação falhou: android/app/build.gradle não reflete applicationId com.northcode.play, versionCode ${expectedVersionCode} e versionName "${expectedVersionName}".`
    );
  }
}

export function prepareAndroidProject({
  rootDir = DEFAULT_ROOT_DIR,
  skipWebBuild = false,
  openAndroidStudio = false,
} = {}) {
  const pkgJsonPath = path.join(rootDir, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) {
    throw new Error(`package.json não encontrado em: ${pkgJsonPath}`);
  }

  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  const versionName = String(pkg.version || '1.3.0').trim();
  const versionCode = computeAndroidVersionCode(versionName);

  const distIndex = path.join(rootDir, 'dist', 'index.html');
  if (!skipWebBuild || !fs.existsSync(distIndex)) {
    console.log('[android:prepare] Compilando interface web (vite build)...');
    const viteBin = resolveViteCliBin(rootDir);
    runNodeBinOrCommand(rootDir, viteBin, ['build'], 'vite build');
  }

  if (!fs.existsSync(distIndex)) {
    throw new Error(
      `Build web não encontrado em "${distIndex}". Certifique-se de que "npm run build" concluiu sem erros.`
    );
  }

  const patchResult = applyCapacitorAndroidHttpDiagnosticsPatch({ rootDir });
  if (patchResult.applied) {
    console.log(
      `[android:prepare] Patch P3.2 aplicado em @capacitor/android@${patchResult.version} (HttpRequestHandler.java).`
    );
  } else {
    console.log(
      `[android:prepare] Patch P3.2 já estava aplicado em @capacitor/android@${patchResult.version} (reaplicação ignorada).`
    );
  }

  const capBin = resolveCapacitorCliBin(rootDir);
  const androidDir = path.join(rootDir, 'android');
  const androidAppGradle = path.join(androidDir, 'app', 'build.gradle');
  const androidExists = fs.existsSync(androidDir) && fs.existsSync(androidAppGradle);

  if (!androidExists) {
    if (fs.existsSync(androidDir)) {
      throw new Error(
        `A pasta "${androidDir}" existe mas está incompleta (ausente app/build.gradle). Remova a pasta incompleta antes de continuar.`
      );
    }
    console.log('[android:prepare] Pasta android/ ausente. Gerando projeto Android via Capacitor...');
    runNodeBinOrCommand(rootDir, capBin, ['add', 'android'], 'cap add android');
  } else {
    console.log('[android:prepare] Reutilizando pasta android/ existente (sem apagar)...');
  }

  const overlayDir = path.join(rootDir, 'tooling', 'android', 'overlay');
  console.log('[android:prepare] Aplicando personalizações do North Code Play (tooling/android/overlay)...');
  copyDirectoryOverlayRecursive(overlayDir, androidDir);

  const logoPath = path.join(rootDir, 'src', 'assets', 'logo.png');
  const resDir = path.join(androidDir, 'app', 'src', 'main', 'res');
  copyBrandLauncherIcons(logoPath, resDir);

  patchAppBuildGradle(androidAppGradle, versionName, versionCode);

  console.log('[android:prepare] Sincronizando bundle web (dist/) e plugins Capacitor (cap sync android)...');
  runNodeBinOrCommand(rootDir, capBin, ['sync', 'android'], 'cap sync android');

  // Reaplicar overlay após `cap sync android` para garantir que assets customizados
  // (como webview_update_required.html e configurações Android) permaneçam intactos
  copyDirectoryOverlayRecursive(overlayDir, androidDir);
  patchAppBuildGradle(androidAppGradle, versionName, versionCode);

  verifyAndroidCustomizations(rootDir, versionName, versionCode);

  console.log(
    `[android:prepare] Projeto Android pronto e validado (com.northcode.play v${versionName}, versionCode ${versionCode}, ${
      androidExists ? 'pasta android/ reutilizada' : 'pasta android/ gerada'
    }).`
  );

  if (openAndroidStudio) {
    console.log('[android:prepare] Abrindo projeto no Android Studio (cap open android)...');
    runNodeBinOrCommand(rootDir, capBin, ['open', 'android'], 'cap open android');
  }

  return {
    reusedExistingAndroid: androidExists,
    patchApplied: patchResult.applied,
    patchAlreadyApplied: patchResult.alreadyApplied,
    capacitorAndroidVersion: patchResult.version,
    versionName,
    versionCode,
    androidDir,
  };
}

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isDirectExecution) {
  const args = new Set(process.argv.slice(2));
  const skipWebBuild = args.has('--skip-web-build') || args.has('--skip-build');
  const openAndroidStudio = args.has('--open');

  try {
    prepareAndroidProject({
      rootDir: DEFAULT_ROOT_DIR,
      skipWebBuild,
      openAndroidStudio,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n[android:prepare] ERRO: ${message}`);
    process.exit(1);
  }
}
