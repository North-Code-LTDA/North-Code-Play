import { Capacitor, registerPlugin } from '@capacitor/core';
import {
  type CapacitorNativeAttemptDiagnosticsInput,
  type CatalogDiagnosticAttemptHandle,
  nowMonotonicMs,
} from '../utils/catalogDiagnostics';
import type { TransportError } from './httpTransport';

export const CATALOG_FILE_TRANSFER_PLUGIN_NAME = 'CatalogFileTransfer';
export const CATALOG_TRANSFER_CACHE_SUBDIR = 'nc_catalog_transfers';

const SAFE_FINAL_FILE_ID_REGEX = /^nc_catalog_[a-zA-Z0-9_-]+\.json$/;
const MAX_NATIVE_CONNECT_TIMEOUT_MS = 15000;

export interface DownloadCatalogToTempFileOptions {
  url: string;
  transferId: string;
  connectTimeout?: number;
  readTimeout?: number;
  disableRedirects?: boolean;
  headers?: Record<string, string>;
  collectDiagnostics?: boolean;
}

export interface DownloadCatalogToTempFileResult {
  status: number;
  fileId?: string | null;
  filePath?: string | null;
  nativeDiagnostics?: CapacitorNativeAttemptDiagnosticsInput | null;
  diagnostics?: CapacitorNativeAttemptDiagnosticsInput | null;
}

export interface CatalogFileTransferNativePlugin {
  downloadCatalogToTempFile(
    options: DownloadCatalogToTempFileOptions
  ): Promise<DownloadCatalogToTempFileResult>;
  cancelTransfer(options: { transferId: string }): Promise<{ cancelled?: boolean }>;
  cleanupTransferFile(options: { fileId: string }): Promise<{ deleted?: boolean }>;
}

let registeredNativePlugin: CatalogFileTransferNativePlugin | null = null;
let pluginOverrideForTest: CatalogFileTransferNativePlugin | null = null;
let convertFileSrcOverrideForTest: ((filePath: string) => string) | null = null;
let nextTransferSeq = 0;

export function setAndroidCatalogFileAdapterTestOverride(config: {
  plugin?: CatalogFileTransferNativePlugin | null;
  convertFileSrc?: ((filePath: string) => string) | null;
}): void {
  if (config.plugin !== undefined) {
    pluginOverrideForTest = config.plugin;
  }
  if (config.convertFileSrc !== undefined) {
    convertFileSrcOverrideForTest = config.convertFileSrc;
  }
}

function getNativeCatalogPlugin(): CatalogFileTransferNativePlugin {
  if (pluginOverrideForTest) {
    return pluginOverrideForTest;
  }
  if (!registeredNativePlugin) {
    registeredNativePlugin = registerPlugin<CatalogFileTransferNativePlugin>(
      CATALOG_FILE_TRANSFER_PLUGIN_NAME
    );
  }
  return registeredNativePlugin;
}

function convertTempFilePathToWebViewUrl(filePath: string): string {
  if (convertFileSrcOverrideForTest) {
    return convertFileSrcOverrideForTest(filePath);
  }
  if (typeof Capacitor?.convertFileSrc === 'function') {
    return Capacitor.convertFileSrc(filePath);
  }
  throw createLocalFileReadError('Conversor de caminho local do Capacitor indisponível.');
}

export function isValidCatalogTransferFileReference(
  fileId: unknown,
  filePath: unknown
): fileId is string {
  if (typeof fileId !== 'string' || !SAFE_FINAL_FILE_ID_REGEX.test(fileId)) {
    return false;
  }
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return false;
  }
  const normalizedPath = filePath.replace(/\\/g, '/');
  if (
    normalizedPath.includes('/../') ||
    normalizedPath.endsWith('/..') ||
    !normalizedPath.endsWith(`/${CATALOG_TRANSFER_CACHE_SUBDIR}/${fileId}`)
  ) {
    return false;
  }
  return true;
}

function createProviderHttpError(status: number, statusText?: string): TransportError {
  const isClientError = status >= 400 && status < 500;
  const httpError: TransportError = new Error(
    `O servidor do provedor retornou HTTP ${status} (${statusText || `Status ${status}`}).`
  );
  httpError.status = status;
  httpError.isClientError = isClientError;
  httpError.isTransient = !isClientError;
  return httpError;
}

function createTimeoutError(): TransportError {
  const timeoutError: TransportError = new Error(
    'Tempo limite esgotado ao aguardar resposta do servidor do provedor.'
  );
  timeoutError.isTransient = true;
  return timeoutError;
}

function createNetworkError(): TransportError {
  const netError: TransportError = new Error(
    'Falha de rede ou bloqueio de CORS ao comunicar diretamente com o provedor. ' +
      'Verifique se o servidor está online e se permite requisições da web.'
  );
  netError.isTransient = true;
  return netError;
}

function createLocalFileReadError(detail?: string): TransportError {
  const localErr: TransportError = new Error(
    detail || 'Falha ao ler o arquivo temporário local do catálogo.'
  );
  localErr.isTransient = true;
  localErr.isLocalFileReadError = true;
  return localErr;
}

function extractNativeDiagnostics(
  source: unknown
): CapacitorNativeAttemptDiagnosticsInput | null {
  if (!source || typeof source !== 'object') {
    return null;
  }
  const candidate = source as Record<string, unknown>;
  const rawDiag = candidate.nativeDiagnostics ?? candidate.diagnostics ?? null;
  if (rawDiag && typeof rawDiag === 'object') {
    return rawDiag as CapacitorNativeAttemptDiagnosticsInput;
  }
  return null;
}

async function safeCancelNativeTransfer(
  plugin: CatalogFileTransferNativePlugin,
  transferId: string
): Promise<void> {
  try {
    await plugin.cancelTransfer({ transferId });
  } catch {
    // Ignora falha silenciosa de cancelamento tardio
  }
}

async function safeCleanupNativeFile(
  plugin: CatalogFileTransferNativePlugin,
  fileId: string | null | undefined
): Promise<void> {
  if (!fileId || typeof fileId !== 'string' || !SAFE_FINAL_FILE_ID_REGEX.test(fileId)) {
    return;
  }
  try {
    await plugin.cleanupTransferFile({ fileId });
  } catch {
    // Ignora falha silenciosa de limpeza de arquivo temporário
  }
}

/**
 * Executa a transferência de um catálogo completo no APK Android via arquivo temporário
 * na pasta dedicada `<cacheDir>/nc_catalog_transfers/` e lê o conteúdo diretamente na WebView
 * via `Capacitor.convertFileSrc` + `fetch`, retornando o texto bruto para `normalizeTransportPayload`.
 *
 * Nunca interpreta o JSON do catálogo na camada Java e nunca trafega o corpo do catálogo
 * pela ponte do Capacitor.
 */
export async function executeAndroidTempFileCatalogDownload({
  url,
  timeoutMs,
  signal,
  diagAttempt,
}: {
  url: string;
  timeoutMs: number;
  signal?: AbortSignal;
  diagAttempt?: CatalogDiagnosticAttemptHandle | null;
}): Promise<string> {
  if (signal?.aborted) {
    throw new Error('Operação cancelada pelo usuário.');
  }

  const plugin = getNativeCatalogPlugin();
  const transferId = `nc_tr_${++nextTransferSeq}`;
  const connectTimeout = Math.min(timeoutMs, MAX_NATIVE_CONNECT_TIMEOUT_MS);
  const readTimeout = timeoutMs;

  if (diagAttempt?.isActive()) {
    diagAttempt.setTransportKind('android-temp-file');
  }

  const trackDiag = Boolean(diagAttempt && diagAttempt.isActive());
  const nativeCallStartMs = trackDiag ? nowMonotonicMs() : 0;

  let settled = false;
  let didTimeout = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let onCallerAbort: (() => void) | null = null;
  let localFetchAbortController: AbortController | null = null;
  let acquiredFileId: string | null = null;

  try {
    const downloadResult = await new Promise<DownloadCatalogToTempFileResult>(
      (resolve, reject) => {
        onCallerAbort = () => {
          localFetchAbortController?.abort();
          void safeCancelNativeTransfer(plugin, transferId);
          if (settled) return;
          settled = true;
          if (diagAttempt?.isActive()) {
            diagAttempt.recordAndroidTempFileTransfer(nowMonotonicMs() - nativeCallStartMs);
          }
          reject(new Error('Operação cancelada pelo usuário.'));
        };

        if (signal) {
          if (signal.aborted) {
            settled = true;
            void safeCancelNativeTransfer(plugin, transferId);
            reject(new Error('Operação cancelada pelo usuário.'));
            return;
          }
          signal.addEventListener('abort', onCallerAbort, { once: true });
        }

        timeoutId = setTimeout(() => {
          didTimeout = true;
          localFetchAbortController?.abort();
          void safeCancelNativeTransfer(plugin, transferId);
          if (settled) return;
          settled = true;
          const tErr = createTimeoutError();
          if (diagAttempt?.isActive()) {
            diagAttempt.recordAndroidTempFileTransfer(nowMonotonicMs() - nativeCallStartMs);
          }
          reject(tErr);
        }, timeoutMs);

        const requestOptions: DownloadCatalogToTempFileOptions = {
          url,
          transferId,
          connectTimeout,
          readTimeout,
          headers: {
            Accept: 'application/json, text/plain, */*',
          },
        };
        if (trackDiag) {
          requestOptions.collectDiagnostics = true;
        }

        plugin
          .downloadCatalogToTempFile(requestOptions)
          .then((res) => {
            if (settled) {
              // Resposta tardia após cancelamento ou timeout: remover imediatamente o arquivo temporário
              if (res && typeof res.fileId === 'string') {
                void safeCleanupNativeFile(plugin, res.fileId);
              }
              return;
            }
            settled = true;
            resolve(res);
          })
          .catch((err: any) => {
            if (settled) return;
            settled = true;
            const errNativeDiag = extractNativeDiagnostics(err);
            if (signal?.aborted) {
              if (diagAttempt?.isActive()) {
                diagAttempt.recordAndroidTempFileTransfer(
                  nowMonotonicMs() - nativeCallStartMs,
                  undefined,
                  errNativeDiag
                );
              }
              reject(new Error('Operação cancelada pelo usuário.'));
              return;
            }
            const msg = String(err?.message || err?.code || err || '').toLowerCase();
            if (
              didTimeout ||
              msg.includes('timeout') ||
              msg.includes('timed out') ||
              msg.includes('sockettimeout')
            ) {
              const tErr = createTimeoutError();
              if (diagAttempt?.isActive()) {
                diagAttempt.recordAndroidTempFileTransfer(
                  nowMonotonicMs() - nativeCallStartMs,
                  undefined,
                  errNativeDiag
                );
              }
              reject(tErr);
              return;
            }
            if (msg.includes('cancel') || msg.includes('abort')) {
              if (diagAttempt?.isActive()) {
                diagAttempt.recordAndroidTempFileTransfer(
                  nowMonotonicMs() - nativeCallStartMs,
                  undefined,
                  errNativeDiag
                );
              }
              reject(new Error('Operação cancelada pelo usuário.'));
              return;
            }
            const nErr = createNetworkError();
            if (diagAttempt?.isActive()) {
              diagAttempt.recordAndroidTempFileTransfer(
                nowMonotonicMs() - nativeCallStartMs,
                undefined,
                errNativeDiag
              );
            }
            reject(nErr);
          });
      }
    );

    const status = typeof downloadResult?.status === 'number' ? downloadResult.status : 0;
    const rawFileId = downloadResult?.fileId ?? null;
    const rawFilePath = downloadResult?.filePath ?? null;

    if (typeof rawFileId === 'string' && SAFE_FINAL_FILE_ID_REGEX.test(rawFileId)) {
      acquiredFileId = rawFileId;
    }

    // Registra o término da chamada nativa ANTES da leitura local na WebView,
    // para que `outsideNativeMeasuredMs` meça apenas a ponte nativa sem atribuir a leitura local à ponte.
    if (diagAttempt?.isActive()) {
      diagAttempt.recordAndroidTempFileTransfer(
        nowMonotonicMs() - nativeCallStartMs,
        status || undefined,
        extractNativeDiagnostics(downloadResult)
      );
    }

    if (signal?.aborted) {
      throw new Error('Operação cancelada pelo usuário.');
    }
    if (didTimeout) {
      throw createTimeoutError();
    }

    // Preserva o código HTTP do provedor (mesmo quando a resposta de erro não tem corpo),
    // diferenciando-o de qualquer falha de leitura do arquivo local.
    if (status < 200 || status >= 300) {
      throw createProviderHttpError(status || 500, status ? `Status ${status}` : 'Erro');
    }

    if (!isValidCatalogTransferFileReference(rawFileId, rawFilePath)) {
      throw createLocalFileReadError(
        'Referência de arquivo temporário inválida ou fora do diretório dedicado de cache.'
      );
    }

    const localFileUrl = convertTempFilePathToWebViewUrl(rawFilePath as string);
    localFetchAbortController = new AbortController();

    const localReadStartMs = diagAttempt?.isActive() ? nowMonotonicMs() : 0;
    let localResponse: Response;
    try {
      localResponse = await fetch(localFileUrl, {
        method: 'GET',
        signal: localFetchAbortController.signal,
      });
    } catch {
      if (signal?.aborted) {
        throw new Error('Operação cancelada pelo usuário.');
      }
      if (didTimeout) {
        if (diagAttempt?.isActive()) {
          diagAttempt.recordAndroidLocalFileRead(nowMonotonicMs() - localReadStartMs, null);
        }
        throw createTimeoutError();
      }
      if (diagAttempt?.isActive()) {
        diagAttempt.recordAndroidLocalFileRead(nowMonotonicMs() - localReadStartMs, null);
      }
      throw createLocalFileReadError();
    }

    if (signal?.aborted) {
      throw new Error('Operação cancelada pelo usuário.');
    }
    if (didTimeout) {
      if (diagAttempt?.isActive()) {
        diagAttempt.recordAndroidLocalFileRead(nowMonotonicMs() - localReadStartMs, null);
      }
      throw createTimeoutError();
    }

    if (!localResponse.ok) {
      if (diagAttempt?.isActive()) {
        diagAttempt.recordAndroidLocalFileRead(nowMonotonicMs() - localReadStartMs, null);
      }
      throw createLocalFileReadError();
    }

    let textData: string;
    try {
      textData = await localResponse.text();
    } catch {
      if (signal?.aborted) {
        throw new Error('Operação cancelada pelo usuário.');
      }
      if (didTimeout) {
        if (diagAttempt?.isActive()) {
          diagAttempt.recordAndroidLocalFileRead(nowMonotonicMs() - localReadStartMs, null);
        }
        throw createTimeoutError();
      }
      if (diagAttempt?.isActive()) {
        diagAttempt.recordAndroidLocalFileRead(nowMonotonicMs() - localReadStartMs, null);
      }
      throw createLocalFileReadError();
    }

    if (signal?.aborted) {
      throw new Error('Operação cancelada pelo usuário.');
    }
    if (didTimeout) {
      throw createTimeoutError();
    }

    if (diagAttempt?.isActive()) {
      diagAttempt.recordAndroidLocalFileRead(
        nowMonotonicMs() - localReadStartMs,
        textData.length
      );
    }

    return textData;
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    if (signal && onCallerAbort) {
      signal.removeEventListener('abort', onCallerAbort);
    }
    if (acquiredFileId) {
      await safeCleanupNativeFile(plugin, acquiredFileId);
    }
  }
}
