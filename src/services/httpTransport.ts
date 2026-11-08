import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { HttpOptions, HttpResponse } from '@capacitor/core';
import {
  type CapacitorNativeAttemptDiagnosticsInput,
  type CatalogDiagnosticAttemptHandle,
  nowMonotonicMs,
} from '../utils/catalogDiagnostics';

export type DiagnosticHttpOptions = HttpOptions & {
  collectDiagnostics?: boolean;
};

export type DiagnosticHttpResponse = HttpResponse & {
  nativeDiagnostics?: CapacitorNativeAttemptDiagnosticsInput | null;
  diagnostics?: CapacitorNativeAttemptDiagnosticsInput | null;
};

export interface TransportRequestOptions {
  url: string;
  timeoutMs: number;
  signal?: AbortSignal;
  diagAttempt?: CatalogDiagnosticAttemptHandle | null;
  isFullCatalogRequest?: boolean;
}

export interface TransportError extends Error {
  isTransient?: boolean;
  isClientError?: boolean;
  isFatalFormat?: boolean;
  isLocalFileReadError?: boolean;
  status?: number;
}

export type TransportMode = 'auto' | 'web' | 'capacitor';

const MAX_NATIVE_CONNECT_TIMEOUT_MS = 15000;
const CATALOG_FILE_TRANSFER_PLUGIN_NAME = 'CatalogFileTransfer';

let transportModeOverride: TransportMode = 'auto';
let capacitorHttpGetOverride:
  | ((options: DiagnosticHttpOptions) => Promise<DiagnosticHttpResponse>)
  | null = null;
let androidCatalogPluginAvailableOverride: boolean | null = null;
let androidAdapterLoadCountForTest = 0;

/**
 * Permite selecionar explicitamente o modo de transporte ('web' ou 'capacitor'),
 * injetar um mock de `CapacitorHttp.get` e simular a disponibilidade do plugin
 * `CatalogFileTransfer` durante os testes automatizados offline.
 */
export function setTransportTestConfig(config: {
  mode?: TransportMode;
  capacitorHttpGet?: ((options: DiagnosticHttpOptions) => Promise<DiagnosticHttpResponse>) | null;
  androidCatalogPluginAvailable?: boolean | null;
}): void {
  if (config.mode !== undefined) {
    transportModeOverride = config.mode;
  }
  if (config.capacitorHttpGet !== undefined) {
    capacitorHttpGetOverride = config.capacitorHttpGet;
  }
  if (config.androidCatalogPluginAvailable !== undefined) {
    androidCatalogPluginAvailableOverride = config.androidCatalogPluginAvailable;
  }
}

export function getAndroidCatalogAdapterLoadCountForTest(): number {
  return androidAdapterLoadCountForTest;
}

export function resetAndroidCatalogAdapterLoadCountForTest(): void {
  androidAdapterLoadCountForTest = 0;
}

export function isUsingCapacitorNativeTransport(): boolean {
  if (transportModeOverride === 'capacitor') return true;
  if (transportModeOverride === 'web') return false;
  try {
    if (typeof Capacitor?.isNativePlatform === 'function') {
      return Boolean(Capacitor.isNativePlatform());
    }
    if (typeof Capacitor?.getPlatform === 'function') {
      return Capacitor.getPlatform() !== 'web';
    }
  } catch {
    // Fallback para fetch do navegador
  }
  return false;
}

/**
 * Verifica se o ambiente de execução atual é o APK Android com o plugin nativo
 * `CatalogFileTransfer` disponível antes de iniciar a consulta.
 * Independente de diagnóstico ativado, modo "TV", tamanho de tela ou user-agent.
 */
export function isAndroidTempFileCatalogTransportAvailable(): boolean {
  if (transportModeOverride === 'web') return false;
  if (androidCatalogPluginAvailableOverride !== null) {
    return isUsingCapacitorNativeTransport() && androidCatalogPluginAvailableOverride;
  }
  try {
    const isNative =
      typeof Capacitor?.isNativePlatform === 'function' &&
      Capacitor.isNativePlatform() === true;
    const isAndroid =
      typeof Capacitor?.getPlatform === 'function' &&
      Capacitor.getPlatform() === 'android';
    const isPluginAvailable =
      typeof Capacitor?.isPluginAvailable === 'function' &&
      Capacitor.isPluginAvailable(CATALOG_FILE_TRANSFER_PLUGIN_NAME) === true;
    return Boolean(isNative && isAndroid && isPluginAvailable);
  } catch {
    return false;
  }
}

/**
 * Normaliza o corpo da resposta que pode chegar:
 * - Já interpretado como objeto/array JavaScript (comportamento padrão do CapacitorHttp em respostas application/json),
 *   retornando a referência diretamente SEM re-serializar (JSON.stringify + JSON.parse) catálogos extensos.
 * - Como texto JSON (string), realizando JSON.parse uma única vez.
 * - Vazio/nulo, retornando [] por compatibilidade com listas Xtream vazias.
 */
export function normalizeTransportPayload<T = any>(
  rawPayload: unknown,
  diagAttempt?: CatalogDiagnosticAttemptHandle | null
): T {
  const trackDiag = Boolean(diagAttempt && diagAttempt.isActive());

  if (rawPayload === null || rawPayload === undefined) {
    if (trackDiag) {
      diagAttempt!.recordPayloadNormalization({
        payloadFormat: 'empty',
        jsonParseExecuted: false,
        jsonParseMs: null,
        payloadChars: 0,
      });
    }
    return [] as unknown as T;
  }

  if (typeof rawPayload === 'object') {
    if (trackDiag) {
      diagAttempt!.recordPayloadNormalization({
        payloadFormat: 'pre-parsed-object',
        jsonParseExecuted: false,
        jsonParseMs: null,
        payloadChars: null,
      });
    }
    return rawPayload as T;
  }

  if (typeof rawPayload === 'string') {
    const trimmed = rawPayload.trim();
    if (!trimmed) {
      if (trackDiag) {
        diagAttempt!.recordPayloadNormalization({
          payloadFormat: 'empty',
          jsonParseExecuted: false,
          jsonParseMs: null,
          payloadChars: rawPayload.length,
        });
      }
      return [] as unknown as T;
    }
    const parseStartMs = trackDiag ? nowMonotonicMs() : 0;
    try {
      const parsed = JSON.parse(trimmed) as T;
      if (trackDiag) {
        const parseDurationMs = nowMonotonicMs() - parseStartMs;
        diagAttempt!.recordPayloadNormalization({
          payloadFormat: 'text-json',
          jsonParseExecuted: true,
          jsonParseMs: parseDurationMs,
          payloadChars: rawPayload.length,
        });
      }
      return parsed;
    } catch {
      if (trackDiag) {
        const parseDurationMs = nowMonotonicMs() - parseStartMs;
        diagAttempt!.recordPayloadNormalization({
          payloadFormat: 'text-json',
          jsonParseExecuted: true,
          jsonParseMs: parseDurationMs,
          payloadChars: rawPayload.length,
        });
      }
      const jsonError: TransportError = new Error(
        'O provedor retornou uma resposta em formato inválido (não é um JSON válido).'
      );
      jsonError.isFatalFormat = true;
      throw jsonError;
    }
  }

  const formatError: TransportError = new Error(
    'O provedor retornou uma resposta em formato inválido (não é um JSON válido).'
  );
  formatError.isFatalFormat = true;
  throw formatError;
}

function createHttpError(status: number, statusText?: string): TransportError {
  const isClientError = status >= 400 && status < 500;
  const httpError: TransportError = new Error(
    `O servidor do provedor retornou HTTP ${status} (${statusText || 'Erro'}).`
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

function extractNativeDiagnosticsFromSource(
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

/**
 * Executa uma consulta GET JSON para a API Xtream Codes:
 *
 * 1. No navegador ('web'):
 *    Utiliza `fetch` nativo com `AbortController`, interrompendo efetivamente o socket HTTP
 *    quando `signal` é abortado ou quando o prazo `timeoutMs` expira.
 *
 * 2. No aplicativo Android Capacitor ('capacitor'):
 *    - Para consultas de catálogo completo (`isFullCatalogRequest: true`) quando `Capacitor.isNativePlatform()`
 *      é verdadeiro, `Capacitor.getPlatform()` é `'android'` e o plugin `CatalogFileTransfer` está disponível:
 *      carrega o adaptador sob demanda, grava o corpo em arquivo temporário no cache interno privado e
 *      lê na WebView via `Capacitor.convertFileSrc` + `fetch`, fazendo `JSON.parse` uma única vez no JS.
 *    - Para autenticação, categorias, catálogos filtrados por categoria, EPG, detalhes (ou se o plugin
 *      não estiver disponível antes do início da consulta): utiliza `CapacitorHttp.get`.
 */
export async function executeXtreamGetRequest<T = any>({
  url,
  timeoutMs,
  signal,
  diagAttempt,
  isFullCatalogRequest = false,
}: TransportRequestOptions): Promise<T> {
  if (signal?.aborted) {
    throw new Error('Operação cancelada pelo usuário.');
  }

  if (isFullCatalogRequest && isAndroidTempFileCatalogTransportAvailable()) {
    androidAdapterLoadCountForTest++;
    const { executeAndroidTempFileCatalogDownload } = await import(
      './androidCatalogFileAdapter'
    );
    const rawText = await executeAndroidTempFileCatalogDownload({
      url,
      timeoutMs,
      signal,
      diagAttempt,
    });
    return normalizeTransportPayload<T>(rawText, diagAttempt);
  }

  if (isUsingCapacitorNativeTransport()) {
    return executeCapacitorHttpGet<T>({ url, timeoutMs, signal, diagAttempt });
  }

  return executeBrowserFetchGet<T>({ url, timeoutMs, signal, diagAttempt });
}

async function executeBrowserFetchGet<T = any>({
  url,
  timeoutMs,
  signal,
  diagAttempt,
}: TransportRequestOptions): Promise<T> {
  const controller = new AbortController();
  let didTimeout = false;

  const timeoutId = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  const onCallerAbort = () => {
    controller.abort();
  };

  if (signal) {
    signal.addEventListener('abort', onCallerAbort, { once: true });
  }

  const trackDiag = Boolean(diagAttempt && diagAttempt.isActive());

  try {
    let response: Response;
    const responseWaitStartMs = trackDiag ? nowMonotonicMs() : 0;
    try {
      response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });
    } catch {
      if (signal?.aborted) {
        throw new Error('Operação cancelada pelo usuário.');
      }
      if (didTimeout) {
        const tErr = createTimeoutError();
        if (diagAttempt?.isActive()) {
          diagAttempt.recordWebResponseWait(nowMonotonicMs() - responseWaitStartMs);
        }
        throw tErr;
      }
      const nErr = createNetworkError();
      if (diagAttempt?.isActive()) {
        diagAttempt.recordWebResponseWait(nowMonotonicMs() - responseWaitStartMs);
      }
      throw nErr;
    }

    if (diagAttempt?.isActive()) {
      diagAttempt.recordWebResponseWait(
        nowMonotonicMs() - responseWaitStartMs,
        response.status
      );
    }

    if (signal?.aborted) {
      throw new Error('Operação cancelada pelo usuário.');
    }

    if (!response.ok) {
      throw createHttpError(response.status, response.statusText);
    }

    let textData: string;
    const bodyReadStartMs = diagAttempt?.isActive() ? nowMonotonicMs() : 0;
    try {
      textData = await response.text();
    } catch {
      if (signal?.aborted) {
        throw new Error('Operação cancelada pelo usuário.');
      }
      if (didTimeout) {
        const tErr = createTimeoutError();
        if (diagAttempt?.isActive()) {
          diagAttempt.recordWebBodyRead(nowMonotonicMs() - bodyReadStartMs, 0);
        }
        throw tErr;
      }
      const readError: TransportError = new Error(
        'Falha ao ler os dados da resposta do provedor.'
      );
      readError.isTransient = true;
      readError.status = response.status;
      if (diagAttempt?.isActive()) {
        diagAttempt.recordWebBodyRead(nowMonotonicMs() - bodyReadStartMs, 0);
      }
      throw readError;
    }

    if (signal?.aborted) {
      throw new Error('Operação cancelada pelo usuário.');
    }

    if (diagAttempt?.isActive()) {
      diagAttempt.recordWebBodyRead(
        nowMonotonicMs() - bodyReadStartMs,
        textData.length
      );
    }

    return normalizeTransportPayload<T>(textData, diagAttempt);
  } finally {
    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener('abort', onCallerAbort);
    }
  }
}

async function executeCapacitorHttpGet<T = any>({
  url,
  timeoutMs,
  signal,
  diagAttempt,
}: TransportRequestOptions): Promise<T> {
  const connectTimeout = Math.min(timeoutMs, MAX_NATIVE_CONNECT_TIMEOUT_MS);
  const readTimeout = timeoutMs;
  const httpGetFn =
    capacitorHttpGetOverride ??
    ((opts: DiagnosticHttpOptions) => CapacitorHttp.get(opts) as Promise<DiagnosticHttpResponse>);

  let settled = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let onCallerAbort: (() => void) | null = null;
  const trackDiag = Boolean(diagAttempt && diagAttempt.isActive());
  const nativeStartMs = trackDiag ? nowMonotonicMs() : 0;

  try {
    const response = await new Promise<DiagnosticHttpResponse>((resolve, reject) => {
      onCallerAbort = () => {
        if (settled) return;
        settled = true;
        if (diagAttempt?.isActive()) {
          diagAttempt.recordCapacitorTransportAndBridge(nowMonotonicMs() - nativeStartMs);
        }
        reject(new Error('Operação cancelada pelo usuário.'));
      };

      if (signal) {
        if (signal.aborted) {
          settled = true;
          reject(new Error('Operação cancelada pelo usuário.'));
          return;
        }
        signal.addEventListener('abort', onCallerAbort, { once: true });
      }

      timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        const tErr = createTimeoutError();
        if (diagAttempt?.isActive()) {
          diagAttempt.recordCapacitorTransportAndBridge(nowMonotonicMs() - nativeStartMs);
        }
        reject(tErr);
      }, timeoutMs);

      const requestOptions: DiagnosticHttpOptions = {
        url,
        connectTimeout,
        readTimeout,
        responseType: 'text',
        headers: {
          Accept: 'application/json, text/plain, */*',
        },
      };
      if (trackDiag) {
        requestOptions.collectDiagnostics = true;
      }

      httpGetFn(requestOptions)
        .then((res) => {
          if (settled) {
            // Resposta tardia após cancelamento lógico ou timeout: descartada sem processamento
            return;
          }
          settled = true;
          resolve(res);
        })
        .catch((err: any) => {
          if (settled) return;
          settled = true;
          const errNativeDiag = extractNativeDiagnosticsFromSource(err);
          if (signal?.aborted) {
            if (diagAttempt?.isActive()) {
              diagAttempt.recordCapacitorTransportAndBridge(
                nowMonotonicMs() - nativeStartMs,
                undefined,
                errNativeDiag
              );
            }
            reject(new Error('Operação cancelada pelo usuário.'));
            return;
          }
          const msg = String(err?.message || err || '').toLowerCase();
          if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('sockettimeout')) {
            const tErr = createTimeoutError();
            if (diagAttempt?.isActive()) {
              diagAttempt.recordCapacitorTransportAndBridge(
                nowMonotonicMs() - nativeStartMs,
                undefined,
                errNativeDiag
              );
            }
            reject(tErr);
            return;
          }
          const nErr = createNetworkError();
          if (diagAttempt?.isActive()) {
            diagAttempt.recordCapacitorTransportAndBridge(
              nowMonotonicMs() - nativeStartMs,
              undefined,
              errNativeDiag
            );
          }
          reject(nErr);
        });
    });

    const status = typeof response?.status === 'number' ? response.status : 0;
    if (diagAttempt?.isActive()) {
      diagAttempt.recordCapacitorTransportAndBridge(
        nowMonotonicMs() - nativeStartMs,
        status || undefined,
        extractNativeDiagnosticsFromSource(response)
      );
    }

    if (signal?.aborted) {
      throw new Error('Operação cancelada pelo usuário.');
    }

    if (status < 200 || status >= 300) {
      throw createHttpError(status || 500, status ? `Status ${status}` : 'Erro');
    }

    return normalizeTransportPayload<T>(response.data, diagAttempt);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    if (signal && onCallerAbort) {
      signal.removeEventListener('abort', onCallerAbort);
    }
  }
}
