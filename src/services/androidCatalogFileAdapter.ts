import { Capacitor, registerPlugin } from '@capacitor/core';
import type {
  TransportCancellationMode,
  TransportError,
} from './httpTransport';

function getMonotonicNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export const CATALOG_FILE_TRANSFER_PLUGIN_NAME = 'CatalogFileTransfer';
export const CATALOG_TRANSFER_CACHE_SUBDIR = 'nc_catalog_transfers';

const SAFE_FINAL_FILE_ID_REGEX = /^nc_catalog_[a-zA-Z0-9_-]+\.json$/;
const PRIVATE_ANDROID_CACHE_DIR_REGEX =
  /^\/data\/(?:user(?:_de)?\/\d+|data)\/com\.northcode\.play\/cache$/;
const DEDICATED_ANDROID_TRANSFER_DIR_REGEX =
  /^\/data\/(?:user(?:_de)?\/\d+|data)\/com\.northcode\.play\/cache\/nc_catalog_transfers$/;
const CAPACITOR_FILE_PATH_PREFIX = '/_capacitor_file_';
const MAX_NATIVE_CONNECT_TIMEOUT_MS = 15000;

export interface DownloadCatalogToTempFileOptions {
  url: string;
  transferId: string;
  connectTimeout?: number;
  readTimeout?: number;
  disableRedirects?: boolean;
  headers?: Record<string, string>;
}

export interface DownloadCatalogToTempFileResult {
  status: number;
  fileId?: string | null;
  filePath?: string | null;
  cacheDir?: string | null;
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

function resolveApprovedDedicatedCacheDir(rawCacheDir?: unknown): string | null {
  if (rawCacheDir === undefined || rawCacheDir === null) {
    return null;
  }
  if (typeof rawCacheDir !== 'string' || !rawCacheDir || rawCacheDir !== rawCacheDir.trim()) {
    return '';
  }
  if (
    rawCacheDir.includes('\\') ||
    rawCacheDir.includes('%') ||
    rawCacheDir.includes('?') ||
    rawCacheDir.includes('#') ||
    rawCacheDir.includes('\0') ||
    rawCacheDir.includes(':') ||
    rawCacheDir.includes('//') ||
    rawCacheDir.includes('/./') ||
    rawCacheDir.includes('/../') ||
    rawCacheDir.endsWith('/.') ||
    rawCacheDir.endsWith('/..')
  ) {
    return '';
  }
  const normalized = rawCacheDir.endsWith('/') ? rawCacheDir.slice(0, -1) : rawCacheDir;
  if (DEDICATED_ANDROID_TRANSFER_DIR_REGEX.test(normalized)) {
    return normalized;
  }
  if (PRIVATE_ANDROID_CACHE_DIR_REGEX.test(normalized)) {
    return `${normalized}/${CATALOG_TRANSFER_CACHE_SUBDIR}`;
  }
  return '';
}

/**
 * Valida que a referência aponta estritamente para um arquivo criado pelo plugin
 * dentro do diretório dedicado derivado de `getCacheDir()` no Android
 * (`/data/user/<id>/com.northcode.play/cache/nc_catalog_transfers/<fileId>` ou equivalente
 * privado `/data/data/...` / `/data/user_de/...`), exigindo que `fileId` coincida com o nome
 * final de `filePath` e rejeitando URLs externas, caminhos fora desse diretório e tentativas
 * de escapar da pasta por segmentos normais ou codificados.
 */
export function isValidCatalogTransferFileReference(
  fileId: unknown,
  filePath: unknown,
  cacheDir?: unknown
): fileId is string {
  if (typeof fileId !== 'string' || !SAFE_FINAL_FILE_ID_REGEX.test(fileId)) {
    return false;
  }
  if (
    typeof filePath !== 'string' ||
    !filePath ||
    filePath !== filePath.trim() ||
    !filePath.startsWith('/') ||
    filePath.startsWith('//')
  ) {
    return false;
  }
  if (
    filePath.includes('\\') ||
    filePath.includes('%') ||
    filePath.includes('?') ||
    filePath.includes('#') ||
    filePath.includes('\0') ||
    filePath.includes(':') ||
    filePath.includes('//') ||
    filePath.includes('/./') ||
    filePath.includes('/../') ||
    filePath.endsWith('/.') ||
    filePath.endsWith('/..')
  ) {
    return false;
  }

  const segments = filePath.split('/');
  if (segments.length < 2 || segments[0] !== '') {
    return false;
  }
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg || seg === '.' || seg === '..' || seg.includes('..') || seg.includes('%')) {
      return false;
    }
  }

  const finalSegment = segments[segments.length - 1];
  if (finalSegment !== fileId) {
    return false;
  }

  const parentDir = segments.slice(0, -1).join('/');
  if (!DEDICATED_ANDROID_TRANSFER_DIR_REGEX.test(parentDir)) {
    return false;
  }

  const explicitDedicatedDir = resolveApprovedDedicatedCacheDir(cacheDir);
  if (explicitDedicatedDir !== null) {
    if (!explicitDedicatedDir || parentDir !== explicitDedicatedDir) {
      return false;
    }
  }

  return filePath === `${parentDir}/${fileId}`;
}

function getExpectedWebViewOrigin(): string | null {
  try {
    if (
      typeof window !== 'undefined' &&
      window.location &&
      typeof window.location.origin === 'string' &&
      window.location.origin &&
      window.location.origin !== 'null'
    ) {
      return window.location.origin;
    }
  } catch {
    // Ignora erro de acesso a window.location
  }
  return null;
}

/**
 * Valida que a URL produzida por `Capacitor.convertFileSrc()` pertence à origem local da
 * WebView e aponta exatamente para o mesmo arquivo aprovado no diretório dedicado do cache
 * privado, sem query, fragmento, credenciais ou segmentos de escape.
 */
export function isValidConvertedLocalCatalogUrl(
  convertedUrl: unknown,
  approvedFilePath: string,
  expectedOriginOverride?: string | null
): convertedUrl is string {
  if (typeof approvedFilePath !== 'string' || !approvedFilePath.startsWith('/')) {
    return false;
  }
  const expectedFileId = approvedFilePath.slice(approvedFilePath.lastIndexOf('/') + 1);
  if (!isValidCatalogTransferFileReference(expectedFileId, approvedFilePath)) {
    return false;
  }

  if (
    typeof convertedUrl !== 'string' ||
    !convertedUrl ||
    convertedUrl !== convertedUrl.trim() ||
    convertedUrl.includes('\\') ||
    convertedUrl.includes('%') ||
    convertedUrl.includes('?') ||
    convertedUrl.includes('#') ||
    convertedUrl.includes('\0') ||
    convertedUrl.includes('/../') ||
    convertedUrl.includes('/./') ||
    convertedUrl.endsWith('/..') ||
    convertedUrl.endsWith('/.')
  ) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(convertedUrl);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }
  if (parsed.hostname !== 'localhost') {
    return false;
  }
  if (parsed.username !== '' || parsed.password !== '' || parsed.search !== '' || parsed.hash !== '') {
    return false;
  }

  const expectedOrigin =
    expectedOriginOverride !== undefined ? expectedOriginOverride : getExpectedWebViewOrigin();
  if (expectedOrigin && parsed.origin !== expectedOrigin) {
    return false;
  }

  const expectedPathname = `${CAPACITOR_FILE_PATH_PREFIX}${approvedFilePath}`;
  if (parsed.pathname !== expectedPathname) {
    return false;
  }

  return convertedUrl === `${parsed.origin}${expectedPathname}`;
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

function createAdapterAbortError(options?: {
  cancellationMode?: TransportCancellationMode;
  nativeAttemptStillPending?: boolean;
  disallowAutomaticRetry?: boolean;
}): TransportError {
  const abortError: TransportError = new Error('Operação cancelada pelo usuário.');
  abortError.name = 'AbortError';
  abortError.errorCategory = 'aborted';
  abortError.isAborted = true;
  abortError.isTransient = false;
  abortError.isClientError = false;
  abortError.isFatalFormat = false;
  abortError.cancellationMode = options?.cancellationMode ?? 'physical';
  abortError.nativeAttemptStillPending =
    options?.nativeAttemptStillPending ?? false;
  abortError.disallowAutomaticRetry =
    options?.disallowAutomaticRetry ?? Boolean(options?.nativeAttemptStillPending);
  return abortError;
}

function createTimeoutError(options?: {
  cancellationMode?: TransportCancellationMode;
  nativeAttemptStillPending?: boolean;
  disallowAutomaticRetry?: boolean;
}): TransportError {
  const timeoutError: TransportError = new Error(
    'Tempo limite esgotado ao aguardar resposta do servidor do provedor.'
  );
  timeoutError.errorCategory = 'timeout';
  timeoutError.isTransient = true;
  timeoutError.isClientError = false;
  timeoutError.cancellationMode = options?.cancellationMode ?? 'physical';
  timeoutError.nativeAttemptStillPending =
    options?.nativeAttemptStillPending ?? false;
  timeoutError.disallowAutomaticRetry =
    options?.disallowAutomaticRetry ?? Boolean(options?.nativeAttemptStillPending);
  return timeoutError;
}

function createNetworkError(): TransportError {
  const netError: TransportError = new Error(
    'Falha de rede ou bloqueio de CORS ao comunicar diretamente com o provedor. ' +
      'Verifique se o servidor está online e se permite requisições da web.'
  );
  netError.errorCategory = 'network';
  netError.isTransient = true;
  netError.isClientError = false;
  return netError;
}

function createLocalFileReadError(detail?: string): TransportError {
  const localErr: TransportError = new Error(
    detail || 'Falha ao ler o arquivo temporário local do catálogo.'
  );
  localErr.errorCategory = 'local_file_read';
  localErr.isTransient = true;
  localErr.isClientError = false;
  localErr.isLocalFileReadError = true;
  return localErr;
}

function requestNativeTransferCancellation(
  plugin: CatalogFileTransferNativePlugin,
  transferId: string
): void {
  try {
    void Promise.resolve(plugin.cancelTransfer({ transferId })).catch(() => {
      // Ignora falha silenciosa de cancelamento tardio
    });
  } catch {
    // Ignora falha síncrona de cancelamento
  }
}

function requestNativeFileCleanup(
  plugin: CatalogFileTransferNativePlugin,
  fileId: string | null | undefined
): void {
  if (!fileId || typeof fileId !== 'string' || !SAFE_FINAL_FILE_ID_REGEX.test(fileId)) {
    return;
  }
  try {
    void Promise.resolve(plugin.cleanupTransferFile({ fileId })).catch(() => {
      // Ignora falha assíncrona de limpeza de arquivo temporário
    });
  } catch {
    // Ignora falha síncrona de limpeza de arquivo temporário
  }
}

/**
 * Executa a transferência de um catálogo completo no APK Android via arquivo temporário
 * na pasta dedicada `<getCacheDir()>/nc_catalog_transfers/` e lê o conteúdo diretamente na WebView
 * via `Capacitor.convertFileSrc` + `fetch`, retornando o texto bruto para `normalizeTransportPayload`.
 *
 * Nunca interpreta o JSON do catálogo na camada Java, nunca trafega o corpo do catálogo
 * pela ponte do Capacitor e nunca bloqueia a conclusão da consulta aguardando `cleanupTransferFile`.
 */
export async function executeAndroidTempFileCatalogDownload({
  url,
  timeoutMs,
  deadlineAt,
  signal,
}: {
  url: string;
  timeoutMs: number;
  deadlineAt?: number;
  signal?: AbortSignal;
}): Promise<string> {
  if (signal?.aborted) {
    throw createAdapterAbortError();
  }

  const attemptStartMs = getMonotonicNowMs();
  const effectiveDeadlineAt =
    typeof deadlineAt === 'number' && Number.isFinite(deadlineAt)
      ? deadlineAt
      : attemptStartMs + timeoutMs;

  let didTimeout = false;
  const isDeadlineExpired = (): boolean => {
    if (didTimeout || getMonotonicNowMs() >= effectiveDeadlineAt) {
      didTimeout = true;
      return true;
    }
    return false;
  };

  if (isDeadlineExpired()) {
    throw createTimeoutError();
  }

  const plugin = getNativeCatalogPlugin();
  const transferId = `nc_tr_${++nextTransferSeq}`;
  const connectTimeout = Math.min(timeoutMs, MAX_NATIVE_CONNECT_TIMEOUT_MS);
  const readTimeout = timeoutMs;

  let queryFinished = false;
  // Separa explicitamente o encerramento lógico da promessa JS (downloadWrapperSettled)
  // do encerramento confirmado da chamada nativa (nativeDownloadSettled).
  let downloadWrapperSettled = false;
  let nativeDownloadInvoked = false;
  let nativeDownloadSettled = false;
  let localReadInProgress = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let onCallerAbort: (() => void) | null = null;
  let localFetchAbortController: AbortController | null = null;
  let acquiredFileId: string | null = null;
  let rejectInterruptPromise: ((err: Error) => void) | null = null;

  const isNativeTransferStillPending = (): boolean =>
    nativeDownloadInvoked && !nativeDownloadSettled;

  const interruptPromise = new Promise<never>((_resolve, reject) => {
    rejectInterruptPromise = reject;
  });
  // Evita unhandled rejection caso interruptPromise rejeite fora de um Promise.race ativo
  interruptPromise.catch(() => {});

  try {
    onCallerAbort = () => {
      if (queryFinished) return;
      localFetchAbortController?.abort();
      const stillPending = isNativeTransferStillPending();
      if (stillPending) {
        requestNativeTransferCancellation(plugin, transferId);
      }
      rejectInterruptPromise?.(
        createAdapterAbortError({
          cancellationMode: stillPending ? 'logical' : 'physical',
          nativeAttemptStillPending: stillPending,
          disallowAutomaticRetry: stillPending,
        })
      );
    };

    if (signal) {
      if (signal.aborted) {
        throw createAdapterAbortError({
          cancellationMode: 'physical',
          nativeAttemptStillPending: false,
          disallowAutomaticRetry: false,
        });
      }
      signal.addEventListener('abort', onCallerAbort, { once: true });
    }

    const remainingTimeoutMs = Math.max(0, effectiveDeadlineAt - getMonotonicNowMs());
    timeoutId = setTimeout(() => {
      if (queryFinished) return;
      didTimeout = true;
      localFetchAbortController?.abort();
      const stillPending = isNativeTransferStillPending();
      if (stillPending) {
        requestNativeTransferCancellation(plugin, transferId);
      }
      rejectInterruptPromise?.(
        createTimeoutError({
          cancellationMode: stillPending ? 'logical' : 'physical',
          nativeAttemptStillPending: stillPending,
          disallowAutomaticRetry: stillPending,
        })
      );
    }, remainingTimeoutMs);

    const downloadResult = await new Promise<DownloadCatalogToTempFileResult>(
      (resolve, reject) => {
        const settleWrapperReject = (err: Error) => {
          if (downloadWrapperSettled) return;
          downloadWrapperSettled = true;
          reject(err);
        };

        interruptPromise.catch((interruptErr: Error) => {
          settleWrapperReject(interruptErr);
        });

        const requestOptions: DownloadCatalogToTempFileOptions = {
          url,
          transferId,
          connectTimeout,
          readTimeout,
          headers: {
            Accept: 'application/json, text/plain, */*',
          },
        };

        nativeDownloadInvoked = true;
        plugin
          .downloadCatalogToTempFile(requestOptions)
          .then((res) => {
            nativeDownloadSettled = true;
            if (downloadWrapperSettled || queryFinished) {
              // Resposta tardia após a promessa JS já ter encerrado: solicitar exclusão imediata sem bloquear
              if (res && typeof res.fileId === 'string') {
                requestNativeFileCleanup(plugin, res.fileId);
              }
              return;
            }
            downloadWrapperSettled = true;
            resolve(res);
          })
          .catch((err: any) => {
            nativeDownloadSettled = true;
            if (downloadWrapperSettled) return;
            if (signal?.aborted) {
              settleWrapperReject(
                createAdapterAbortError({
                  cancellationMode: 'physical',
                  nativeAttemptStillPending: false,
                  disallowAutomaticRetry: false,
                })
              );
              return;
            }
            const msg = String(err?.message || err?.code || err || '').toLowerCase();
            if (
              isDeadlineExpired() ||
              msg.includes('timeout') ||
              msg.includes('timed out') ||
              msg.includes('sockettimeout')
            ) {
              settleWrapperReject(
                createTimeoutError({
                  cancellationMode: 'physical',
                  nativeAttemptStillPending: false,
                  disallowAutomaticRetry: false,
                })
              );
              return;
            }
            if (msg.includes('cancel') || msg.includes('abort')) {
              settleWrapperReject(
                createAdapterAbortError({
                  cancellationMode: 'physical',
                  nativeAttemptStillPending: false,
                  disallowAutomaticRetry: false,
                })
              );
              return;
            }
            settleWrapperReject(createNetworkError());
          });
      }
    );

    const status = typeof downloadResult?.status === 'number' ? downloadResult.status : 0;
    const rawFileId = downloadResult?.fileId ?? null;
    const rawFilePath = downloadResult?.filePath ?? null;
    const rawCacheDir = downloadResult?.cacheDir ?? undefined;

    if (typeof rawFileId === 'string' && SAFE_FINAL_FILE_ID_REGEX.test(rawFileId)) {
      acquiredFileId = rawFileId;
    }

    if (signal?.aborted) {
      throw createAdapterAbortError();
    }
    if (isDeadlineExpired()) {
      throw createTimeoutError();
    }

    // Preserva o código HTTP do provedor (mesmo quando a resposta de erro não tem corpo),
    // diferenciando-o de qualquer falha de leitura do arquivo local.
    if (status < 200 || status >= 300) {
      throw createProviderHttpError(status || 500, status ? `Status ${status}` : 'Erro');
    }

    if (!isValidCatalogTransferFileReference(rawFileId, rawFilePath, rawCacheDir)) {
      throw createLocalFileReadError(
        'Referência de arquivo temporário inválida ou fora do diretório dedicado de cache.'
      );
    }

    const approvedFilePath = rawFilePath as string;
    let localFileUrl: string;
    try {
      localFileUrl = convertTempFilePathToWebViewUrl(approvedFilePath);
    } catch (convErr) {
      if ((convErr as TransportError)?.isLocalFileReadError) {
        throw convErr;
      }
      throw createLocalFileReadError('Falha ao converter caminho do arquivo temporário.');
    }

    if (!isValidConvertedLocalCatalogUrl(localFileUrl, approvedFilePath)) {
      throw createLocalFileReadError(
        'URL local convertida inválida ou fora da origem local da WebView.'
      );
    }

    if (signal?.aborted) {
      throw createAdapterAbortError();
    }
    if (isDeadlineExpired()) {
      throw createTimeoutError();
    }

    localFetchAbortController = new AbortController();
    localReadInProgress = true;

    let localResponse: Response;
    try {
      localResponse = await Promise.race([
        fetch(localFileUrl, {
          method: 'GET',
          redirect: 'error',
          signal: localFetchAbortController.signal,
        }),
        interruptPromise,
      ]);
    } catch {
      localReadInProgress = false;
      if (signal?.aborted) {
        throw createAdapterAbortError();
      }
      if (isDeadlineExpired()) {
        throw createTimeoutError();
      }
      throw createLocalFileReadError();
    }

    if (signal?.aborted) {
      localReadInProgress = false;
      throw createAdapterAbortError();
    }
    if (isDeadlineExpired()) {
      localReadInProgress = false;
      throw createTimeoutError();
    }

    if (
      !localResponse.ok ||
      localResponse.redirected ||
      localResponse.type === 'opaqueredirect' ||
      (localResponse.status >= 300 && localResponse.status < 400)
    ) {
      localReadInProgress = false;
      throw createLocalFileReadError();
    }

    let textData: string;
    try {
      textData = await Promise.race([localResponse.text(), interruptPromise]);
    } catch {
      localReadInProgress = false;
      if (signal?.aborted) {
        throw createAdapterAbortError();
      }
      if (isDeadlineExpired()) {
        throw createTimeoutError();
      }
      throw createLocalFileReadError();
    }

    localReadInProgress = false;

    if (signal?.aborted) {
      throw createAdapterAbortError();
    }
    if (isDeadlineExpired()) {
      throw createTimeoutError();
    }

    return textData;
  } finally {
    queryFinished = true;
    if (localReadInProgress) {
      localFetchAbortController?.abort();
    }
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    if (signal && onCallerAbort) {
      signal.removeEventListener('abort', onCallerAbort);
    }
    if (acquiredFileId) {
      // Dispara a exclusão do arquivo temporário de forma desacoplada (sem await)
      // para nunca reter a conclusão da consulta nem mascarar seu resultado ou erro.
      requestNativeFileCleanup(plugin, acquiredFileId);
    }
  }
}
