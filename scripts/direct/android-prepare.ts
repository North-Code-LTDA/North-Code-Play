import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface DeliveryC22NativePrepDeps {
  executeXtreamGetRequest: (typeof import('../../src/services/httpTransport'))['executeXtreamGetRequest'];
  setTransportTestConfig: (typeof import('../../src/services/httpTransport'))['setTransportTestConfig'];
  setAndroidCatalogFileAdapterTestOverride: (typeof import('../../src/services/androidCatalogFileAdapter'))['setAndroidCatalogFileAdapterTestOverride'];
}

// ============================================================================
// 12. ENTREGA C2.2 — REMOÇÃO DE PATCH HTTP NATIVO, INSTRUMENTAÇÃO JAVA E INTEGRIDADE ANDROID
// ============================================================================
export async function runDeliveryC22NativeCleanupAndPreparationTests(
  deps: DeliveryC22NativePrepDeps
): Promise<void> {
  const {
    executeXtreamGetRequest,
    setTransportTestConfig,
    setAndroidCatalogFileAdapterTestOverride,
  } = deps;

  console.log(
    '\n--- 12. Entrega C2.2: Remoção de Patch HTTP Nativo, Instrumentação Java e Integridade Android ---'
  );

  const patchFilePath = path.resolve(
    'tooling/android/patches/capacitor-android-8.6.0-http-diagnostics.patch'
  );
  assert.strictEqual(
    fs.existsSync(patchFilePath),
    false,
    'Patch HTTP diagnóstico P3.2 deve ter sido excluído fisicamente'
  );
  assert.strictEqual(
    fs.existsSync(path.resolve('tooling/android/patches')),
    false,
    'Diretório vazio tooling/android/patches não deve permanecer no projeto'
  );

  const prepareAndroidMod: Record<string, any> = await import(
    '../../tooling/android/prepare-android.mjs'
  );

  for (const removedExport of [
    'CAPACITOR_HTTP_DIAGNOSTICS_PATCH_REL_PATH',
    'CAPACITOR_HTTP_HANDLER_REL_PATH',
    'REQUIRED_PATCH_MARKERS',
    'applyCapacitorAndroidHttpDiagnosticsPatch',
    'verifyCapacitorAndroidHttpDiagnosticsPatch',
  ]) {
    assert.strictEqual(
      typeof prepareAndroidMod[removedExport],
      'undefined',
      `prepare-android.mjs não deve exportar ${removedExport}`
    );
  }

  assert.strictEqual(prepareAndroidMod.EXPECTED_CAPACITOR_ANDROID_VERSION, '8.6.0');
  assert.strictEqual(typeof prepareAndroidMod.computeAndroidVersionCode, 'function');
  assert.strictEqual(typeof prepareAndroidMod.verifyCleanCapacitorAndroidDependency, 'function');
  assert.strictEqual(typeof prepareAndroidMod.verifyAndroidCustomizations, 'function');
  assert.strictEqual(typeof prepareAndroidMod.prepareAndroidProject, 'function');

  // Validar dependência real limpa em node_modules/@capacitor/android@8.6.0
  const realIntegrity = prepareAndroidMod.verifyCleanCapacitorAndroidDependency(process.cwd());
  assert.strictEqual(realIntegrity.version, '8.6.0');

  // Validar CatalogFileTransferPlugin.java sem instrumentação diagnóstica e com métodos operacionais
  const catalogPluginJava = fs.readFileSync(
    path.resolve(
      'tooling/android/overlay/app/src/main/java/com/northcode/play/CatalogFileTransferPlugin.java'
    ),
    'utf8'
  );
  for (const forbiddenSymbol of [
    'collectDiagnostics',
    'nativeDiagnostics',
    'parseContentLengthHeader',
    'nanosToMillis',
    'statusAndHeadersMs',
    'fileWriteMs',
    'nativeTotalMs',
    'contentLengthHeaderBytes',
    'bytesWritten',
    'ICapacitorHttpUrlConnection',
  ]) {
    assert(
      !catalogPluginJava.includes(forbiddenSymbol),
      `CatalogFileTransferPlugin.java não deve conter símbolo diagnóstico removido: ${forbiddenSymbol}`
    );
  }
  for (const requiredOperationalSymbol of [
    '@CapacitorPlugin(name = "CatalogFileTransfer")',
    'downloadCatalogToTempFile',
    'cancelTransfer',
    'cleanupTransferFile',
    'nc_catalog_transfers',
    'STREAM_BUFFER_SIZE = 16384',
    'HttpRequestHandler.HttpURLConnectionBuilder',
    'HttpRequestHandler.isDomainExcludedFromSSL',
  ]) {
    assert(
      catalogPluginJava.includes(requiredOperationalSymbol),
      `CatalogFileTransferPlugin.java deve preservar comportamento operacional: ${requiredOperationalSymbol}`
    );
  }

  // Validar ANDROID_BUILD.md atualizado e src/ sem parâmetros diagnósticos residuais
  const androidBuildDoc = fs.readFileSync(path.resolve('ANDROID_BUILD.md'), 'utf8');
  assert(
    !androidBuildDoc.includes('capacitor-android-8.6.0-http-diagnostics.patch') &&
      !androidBuildDoc.includes('P3.2'),
    'ANDROID_BUILD.md não deve referenciar o patch P3.2 removido'
  );
  for (const tsFile of [
    'src/services/androidCatalogFileAdapter.ts',
    'src/services/httpTransport.ts',
  ]) {
    const content = fs.readFileSync(path.resolve(tsFile), 'utf8');
    assert(
      !content.includes('collectDiagnostics') && !content.includes('nativeDiagnostics'),
      `${tsFile} deve permanecer compatível e livre de parâmetros diagnósticos removidos`
    );
  }

  // Testar integridade contra dependência suja e fluxo completo de prepareAndroidProject em diretório temporário isolado
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-c22-android-prep-'));
  let tempPrimaryError: unknown = null;
  try {
    const setupCapacitorPackage = (version: string, httpHandlerJavaContent: string) => {
      const capAndroidDir = path.join(tempRoot, 'node_modules', '@capacitor', 'android');
      const handlerFile = path.join(
        capAndroidDir,
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
      fs.mkdirSync(path.dirname(handlerFile), { recursive: true });
      fs.writeFileSync(
        path.join(capAndroidDir, 'package.json'),
        JSON.stringify({ name: '@capacitor/android', version }),
        'utf8'
      );
      fs.writeFileSync(handlerFile, httpHandlerJavaContent, 'utf8');
      return handlerFile;
    };

    const cleanHandlerContent = fs.readFileSync(
      path.resolve(
        'node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/plugin/util/HttpRequestHandler.java'
      ),
      'utf8'
    );

    // 1) Rejeitar HttpRequestHandler.java contaminado pelo patch antigo sem modificá-lo
    const dirtyContent = `${cleanHandlerContent}\n// buildResponseWithDiagnostics(conn, rt, ns, nativeDiagnostics)\n// nativeDiagnostics.put("nativeTotalMs", 1);\n`;
    const dirtyHandlerPath = setupCapacitorPackage('8.6.0', dirtyContent);
    assert.throws(
      () => prepareAndroidMod.verifyCleanCapacitorAndroidDependency(tempRoot),
      /Integridade de @capacitor\/android@8\.6\.0 comprometida/,
      'Deve detectar marcadores residuais do antigo patch em instalação local reaproveitada'
    );
    assert.strictEqual(
      fs.readFileSync(dirtyHandlerPath, 'utf8'),
      dirtyContent,
      'Verificação de integridade não deve sobrescrever arquivo de terceiros automaticamente'
    );

    // 2) Rejeitar versão incorreta de @capacitor/android
    setupCapacitorPackage('8.5.0', cleanHandlerContent);
    assert.throws(
      () => prepareAndroidMod.verifyCleanCapacitorAndroidDependency(tempRoot),
      /Versão incompatível de @capacitor\/android/,
      'Deve validar a versão travada 8.6.0 de @capacitor/android'
    );

    // 3) Preparação completa (geração inicial + reutilização idempotente) sem patch
    setupCapacitorPackage('8.6.0', cleanHandlerContent);
    fs.writeFileSync(
      path.join(tempRoot, 'package.json'),
      JSON.stringify({ name: 'north-code-play', version: '1.3.0' }),
      'utf8'
    );
    fs.mkdirSync(path.join(tempRoot, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, 'dist', 'index.html'), '<html></html>', 'utf8');
    fs.mkdirSync(path.join(tempRoot, 'src', 'assets'), { recursive: true });
    fs.copyFileSync(
      path.resolve('src/assets/logo.png'),
      path.join(tempRoot, 'src', 'assets', 'logo.png')
    );
    fs.cpSync(
      path.resolve('tooling/android/overlay'),
      path.join(tempRoot, 'tooling', 'android', 'overlay'),
      { recursive: true }
    );

    const mockCapCliPath = path.join(
      tempRoot,
      'node_modules',
      '@capacitor',
      'cli',
      'bin',
      'capacitor'
    );
    fs.mkdirSync(path.dirname(mockCapCliPath), { recursive: true });
    fs.writeFileSync(
      mockCapCliPath,
      `import fs from 'node:fs';
import path from 'node:path';
const [cmd, target] = process.argv.slice(2);
const androidDir = path.join(process.cwd(), 'android');
if (cmd === 'add' && target === 'android') {
  fs.mkdirSync(path.join(androidDir, 'app', 'src', 'main', 'assets', 'public'), { recursive: true });
  fs.writeFileSync(
    path.join(androidDir, 'app', 'build.gradle'),
    'android {\\n  namespace = "com.example.placeholder"\\n  defaultConfig {\\n    applicationId "com.example.placeholder"\\n    versionCode 1\\n    versionName "1.0"\\n  }\\n}\\n',
    'utf8'
  );
} else if (cmd === 'sync' && target === 'android') {
  const assetsDir = path.join(androidDir, 'app', 'src', 'main', 'assets');
  fs.mkdirSync(path.join(assetsDir, 'public'), { recursive: true });
  fs.copyFileSync(path.join(process.cwd(), 'dist', 'index.html'), path.join(assetsDir, 'public', 'index.html'));
  fs.writeFileSync(path.join(assetsDir, 'capacitor.config.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(assetsDir, 'capacitor.plugins.json'), '[]', 'utf8');
}
`,
      'utf8'
    );

    const firstPrep = prepareAndroidMod.prepareAndroidProject({
      rootDir: tempRoot,
      skipWebBuild: true,
    });
    assert.strictEqual(firstPrep.reusedExistingAndroid, false);
    assert.strictEqual(firstPrep.capacitorAndroidVersion, '8.6.0');
    assert.strictEqual(firstPrep.versionName, '1.3.0');
    assert.strictEqual(firstPrep.versionCode, 10300);
    assert.strictEqual('patchApplied' in firstPrep, false);
    assert.strictEqual('patchAlreadyApplied' in firstPrep, false);

    const secondPrep = prepareAndroidMod.prepareAndroidProject({
      rootDir: tempRoot,
      skipWebBuild: true,
    });
    assert.strictEqual(secondPrep.reusedExistingAndroid, true);
    assert.strictEqual(secondPrep.capacitorAndroidVersion, '8.6.0');
  } catch (err) {
    tempPrimaryError = err;
    throw err;
  } finally {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch (cleanupErr) {
      if (tempPrimaryError) {
        console.error('Erro secundário ao remover tempRoot do Bloco 12:', cleanupErr);
      } else {
        throw cleanupErr;
      }
    }
  }

  // Confirmar preservação de status HTTP de erro (ex.: 403) no androidCatalogFileAdapter sem nativeDiagnostics
  setTransportTestConfig({ mode: 'capacitor', androidCatalogPluginAvailable: true });
  setAndroidCatalogFileAdapterTestOverride({
    plugin: {
      async downloadCatalogToTempFile() {
        return {
          status: 403,
          fileId: null,
          filePath: null,
          cacheDir: '/data/user/0/com.northcode.play/cache/nc_catalog_transfers',
        };
      },
      async cancelTransfer() {
        return { cancelled: true };
      },
      async cleanupTransferFile() {
        return { deleted: false };
      },
    },
  });
  let observedForbiddenStatus: number | undefined;
  try {
    await executeXtreamGetRequest({
      url: 'http://provider.tv/player_api.php?action=get_vod_streams',
      timeoutMs: 5000,
      isFullCatalogRequest: true,
    });
  } catch (err: any) {
    observedForbiddenStatus = err?.status;
  } finally {
    const cleanupErrors: unknown[] = [];
    try {
      setAndroidCatalogFileAdapterTestOverride({ plugin: null, convertFileSrc: null });
    } catch (err) {
      cleanupErrors.push(err);
    }
    try {
      setTransportTestConfig({ mode: 'auto', capacitorHttpGet: null, androidCatalogPluginAvailable: null });
    } catch (err) {
      cleanupErrors.push(err);
    }
    if (cleanupErrors.length > 0) {
      throw cleanupErrors[0];
    }
  }
  assert.strictEqual(
    observedForbiddenStatus,
    403,
    'Adapter Android deve continuar preservando códigos HTTP de erro reais'
  );

  console.log(
    '✅ Entrega C2.2 (exclusão do patch HTTP, limpeza do CatalogFileTransferPlugin, integridade @capacitor/android@8.6.0 e preparação Android idempotente) validada!'
  );
}
