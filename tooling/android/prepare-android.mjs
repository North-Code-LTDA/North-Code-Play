#!/usr/bin/env node
/**
 * Script multiplataforma de preparação da camada de portabilidade Android (Capacitor 8)
 * do North Code Play.
 *
 * Responsabilidades:
 * 1. Garantir que o build web (`dist/`) exista (executando `npm run build` quando necessário).
 * 2. Validar a versão travada de `@capacitor/android` (8.6.0) e garantir integridade limpa
 *    da dependência nativa, sem resquícios de patch diagnóstico experimental.
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

const LEGACY_HTTP_DIAGNOSTICS_MARKERS = [
  'boolean collectDiagnostics = Boolean.TRUE.equals(call.getBoolean("collectDiagnostics", false));',
  'buildResponseWithDiagnostics(',
  'nativeDiagnostics.put(',
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

/**
 * Valida que `@capacitor/android` está na versão travada (8.6.0) e que seu arquivo
 * `HttpRequestHandler.java` não contém marcadores residuais de patches diagnósticos antigos
 * em uma árvore `node_modules/` reaproveitada.
 */
export function verifyCleanCapacitorAndroidDependency(rootDir = DEFAULT_ROOT_DIR) {
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
      `Versão incompatível de @capacitor/android: esperado "${EXPECTED_CAPACITOR_ANDROID_VERSION}", encontrado "${installedVersion}".`
    );
  }

  const httpRequestHandlerPath = path.join(
    rootDir,
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
  if (!fs.existsSync(httpRequestHandlerPath)) {
    throw new Error(
      `Fonte nativo HttpRequestHandler.java não encontrado em: ${httpRequestHandlerPath}`
    );
  }

  const httpHandlerContent = fs
    .readFileSync(httpRequestHandlerPath, 'utf8')
    .replace(/\r\n/g, '\n');
  const detectedLegacyMarker = LEGACY_HTTP_DIAGNOSTICS_MARKERS.find((marker) =>
    httpHandlerContent.includes(marker)
  );
  if (detectedLegacyMarker) {
    throw new Error(
      `Integridade de @capacitor/android@${EXPECTED_CAPACITOR_ANDROID_VERSION} comprometida: foram detectados resquícios do antigo patch de diagnóstico HTTP em "${httpRequestHandlerPath}". Restaure a dependência original (ex.: execute "npm ci" ou reinstale "@capacitor/android@${EXPECTED_CAPACITOR_ANDROID_VERSION}") antes de preparar o projeto Android.`
    );
  }

  return {
    version: installedVersion,
    httpRequestHandlerPath,
  };
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
  verifyCleanCapacitorAndroidDependency(rootDir);

  const androidDir = path.join(rootDir, 'android');
  const requiredFiles = [
    path.join(androidDir, 'app', 'build.gradle'),
    path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml'),
    path.join(androidDir, 'app', 'src', 'main', 'java', 'com', 'northcode', 'play', 'MainActivity.java'),
    path.join(
      androidDir,
      'app',
      'src',
      'main',
      'java',
      'com',
      'northcode',
      'play',
      'CatalogFileTransferPlugin.java'
    ),
    path.join(
      androidDir,
      'app',
      'src',
      'main',
      'java',
      'com',
      'northcode',
      'play',
      'ImageDiskCachePlugin.java'
    ),
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
  const registerPluginIdx = mainActivityContent.indexOf(
    'registerPlugin(CatalogFileTransferPlugin.class);'
  );
  const registerImageCachePluginIdx = mainActivityContent.indexOf(
    'registerPlugin(ImageDiskCachePlugin.class);'
  );
  const superOnCreateIdx = mainActivityContent.indexOf('super.onCreate(savedInstanceState);');
  if (
    !mainActivityContent.includes('UI_MODE_TYPE_TELEVISION') ||
    !mainActivityContent.includes('setMinimumFontSize(1)') ||
    !mainActivityContent.includes('setTextZoom(100)') ||
    registerPluginIdx === -1 ||
    registerImageCachePluginIdx === -1 ||
    superOnCreateIdx === -1 ||
    registerPluginIdx > superOnCreateIdx ||
    registerImageCachePluginIdx > superOnCreateIdx
  ) {
    throw new Error(
      'Validação pós-preparação falhou: MainActivity.java não contém a configuração de WebView para Android TV ou o registro de CatalogFileTransferPlugin e ImageDiskCachePlugin antes de super.onCreate.'
    );
  }

  const catalogPluginContent = fs.readFileSync(
    path.join(
      androidDir,
      'app',
      'src',
      'main',
      'java',
      'com',
      'northcode',
      'play',
      'CatalogFileTransferPlugin.java'
    ),
    'utf8'
  );
  if (
    !catalogPluginContent.includes('@CapacitorPlugin(name = "CatalogFileTransfer")') ||
    !catalogPluginContent.includes('downloadCatalogToTempFile') ||
    !catalogPluginContent.includes('cancelTransfer') ||
    !catalogPluginContent.includes('cleanupTransferFile') ||
    !catalogPluginContent.includes('nc_catalog_transfers')
  ) {
    throw new Error(
      'Validação pós-preparação falhou: CatalogFileTransferPlugin.java não contém todos os métodos nativos operacionais.'
    );
  }
  if (
    catalogPluginContent.includes('collectDiagnostics') ||
    catalogPluginContent.includes('nativeDiagnostics')
  ) {
    throw new Error(
      'Validação pós-preparação falhou: CatalogFileTransferPlugin.java ainda contém instrumentação de diagnóstico removida.'
    );
  }

  const imageCachePluginContent = fs.readFileSync(
    path.join(
      androidDir,
      'app',
      'src',
      'main',
      'java',
      'com',
      'northcode',
      'play',
      'ImageDiskCachePlugin.java'
    ),
    'utf8'
  );
  if (
    !imageCachePluginContent.includes('@CapacitorPlugin(name = "ImageDiskCache")') ||
    !imageCachePluginContent.includes('acquireImage') ||
    !imageCachePluginContent.includes('getHydratedIndex') ||
    !imageCachePluginContent.includes('clearAll') ||
    !imageCachePluginContent.includes('nc_image_cache')
  ) {
    throw new Error(
      'Validação pós-preparação falhou: ImageDiskCachePlugin.java não contém todos os métodos nativos da Etapa 1.'
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

  const { version: capacitorAndroidVersion } = verifyCleanCapacitorAndroidDependency(rootDir);
  console.log(
    `[android:prepare] Dependência @capacitor/android@${capacitorAndroidVersion} validada (limpa).`
  );

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
    capacitorAndroidVersion,
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
