import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { HttpOptions, HttpResponse } from '@capacitor/core';

function getMonotonicNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export interface TransportRequestOptions {
  url: string;
  timeoutMs: number;
  signal?: AbortSignal;
  isFullCatalogRequest?: boolean;
}

export type TransportErrorCategory =
  | 'http_unauthorized'
  | 'http_forbidden'
  | 'http_timeout'
  | 'http_rate_limited'
  | 'http_server_error'
  | 'http_client_error'
  | 'network'
  | 'timeout'
  | 'aborted'
  | 'invalid_format'
  | 'empty_response'
  | 'local_file_read';

export interface TransportError extends Error {
  errorCategory?: TransportErrorCategory;
  isTransient?: boolean;
  isClientError?: boolean;
  isFatalFormat?: boolean;
  isLocalFileReadError?: boolean;
  isAborted?: boolean;
  isRateLimited?: boolean;
  retryAfterMs?: number;
  status?: number;
}

export type TransportMode = 'auto' | 'web' | 'capacitor';

const MAX_NATIVE_CONNECT_TIMEOUT_MS = 15000;
const CATALOG_FILE_TRANSFER_PLUGIN_NAME = 'CatalogFileTransfer';
const ABORT_ERROR_MESSAGE = 'Operação cancelada pelo usuário.';

let transportModeOverride: TransportMode = 'auto';
let capacitorHttpGetOverride:
  | ((options: HttpOptions) => Promise<HttpResponse>)
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
  capacitorHttpGet?: ((options: HttpOptions) => Promise<HttpResponse>) | null;
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

export function createAbortError(): TransportError {
  const abortError: TransportError = new Error(ABORT_ERROR_MESSAGE);
  abortError.errorCategory = 'aborted';
  abortError.isAborted = true;
  abortError.isTransient = false;
  abortError.isClientError = false;
  abortError.isFatalFormat = false;
  return abortError;
}

function createEmptyResponseError(
  message: string = 'O servidor do provedor retornou uma resposta vazia ou ausente.'
): TransportError {
  const err: TransportError = new Error(message);
  err.errorCategory = 'empty_response';
  err.isFatalFormat = true;
  err.isTransient = false;
  err.isClientError = false;
  return err;
}

function createInvalidFormatError(
  message: string = 'O provedor retornou uma resposta em formato inválido (não é um JSON válido).'
): TransportError {
  const err: TransportError = new Error(message);
  err.errorCategory = 'invalid_format';
  err.isFatalFormat = true;
  err.isTransient = false;
  err.isClientError = false;
  return err;
}

/**
 * Interpreta o cabeçalho HTTP `Retry-After` nos formatos:
 * - segundos numéricos inteiros não negativos (ex.: "5", "0");
 * - HTTP-date RFC 9110/7231 (ex.: "Wed, 21 Oct 2015 07:28:00 GMT").
 * Retorna o tempo de espera em milissegundos (>= 0) ou `undefined` se ausente/inválido.
 */
export function parseRetryAfterMs(
  rawHeaderValue: unknown,
  nowMs: number = Date.now()
): number | undefined {
  if (rawHeaderValue === null || rawHeaderValue === undefined) {
    return undefined;
  }

  const candidate = Array.isArray(rawHeaderValue)
    ? rawHeaderValue[0]
    : rawHeaderValue;

  if (typeof candidate === 'number') {
    if (!Number.isFinite(candidate) || candidate < 0 || !Number.isInteger(candidate)) {
      return undefined;
    }
    return candidate * 1000;
  }

  if (typeof candidate !== 'string') {
    return undefined;
  }

  const trimmed = candidate.trim();
  if (!trimmed) {
    return undefined;
  }

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds) || seconds < 0) {
      return undefined;
    }
    return seconds * 1000;
  }

  // Rejeita formatos numéricos inválidos (negativos, decimais ou com sinal) para evitar parse ambíguo de data
  if (/^[+-]?\d+(?:\.\d+)?$/.test(trimmed)) {
    return undefined;
  }

  const parsedDateMs = Date.parse(trimmed);
  if (!Number.isFinite(parsedDateMs)) {
    return undefined;
  }

  return Math.max(0, parsedDateMs - nowMs);
}

function extractHeaderCaseInsensitive(
  headers: unknown,
  targetHeaderName: string
): string | undefined {
  if (!headers || typeof headers !== 'object') {
    return undefined;
  }

  const lowerTarget = targetHeaderName.toLowerCase();

  if (typeof (headers as Headers).get === 'function') {
    try {
      const value = (headers as Headers).get(lowerTarget);
      if (typeof value === 'string') {
        return value;
      }
    } catch {
      // Fallback para iteração de propriedades
    }
  }

  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() === lowerTarget) {
      if (typeof value === 'string') {
        return value;
      }
      if (Array.isArray(value) && typeof value[0] === 'string') {
        return value[0];
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
      }
    }
  }

  return undefined;
}

/**
 * Normaliza o corpo da resposta que pode chegar:
 * - Já interpretado como objeto/array JavaScript (comportamento padrão do CapacitorHttp em respostas application/json),
 *   retornando a referência diretamente SEM re-serializar (JSON.stringify + JSON.parse) catálogos extensos.
 * - Como texto JSON (string), realizando JSON.parse uma única vez.
 * - Diferencia explicitamente array JSON vazio (`[]`) de corpo ausente, texto vazio, `null`, HTML ou JSON inválido.
 */
export function normalizeTransportPayload<T = any>(
  rawPayload: unknown,
  signal?: AbortSignal,
  deadlineAt?: number
): T {
  if (signal?.aborted) {
    throw createAbortError();
  }
  if (typeof deadlineAt === 'number' && Number.isFinite(deadlineAt) && getMonotonicNowMs() >= deadlineAt) {
    throw createTimeoutError();
  }

  if (rawPayload === null || rawPayload === undefined) {
    throw createEmptyResponseError();
  }

  if (typeof rawPayload === 'object') {
    return rawPayload as T;
  }

  if (typeof rawPayload === 'string') {
    const trimmed = rawPayload.trim();
    if (!trimmed) {
      if (signal?.aborted) {
        throw createAbortError();
      }
      if (typeof deadlineAt === 'number' && Number.isFinite(deadlineAt) && getMonotonicNowMs() >= deadlineAt) {
        throw createTimeoutError();
      }
      throw createEmptyResponseError();
    }
    if (signal?.aborted) {
      throw createAbortError();
    }
    if (typeof deadlineAt === 'number' && Number.isFinite(deadlineAt) && getMonotonicNowMs() >= deadlineAt) {
      throw createTimeoutError();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      if (/^<!doctype\s+html\b|^<html\b|^<head\b|^<body\b/i.test(trimmed)) {
        throw createInvalidFormatError(
          'O provedor retornou uma página HTML inesperada em vez de uma resposta JSON.'
        );
      }
      throw createInvalidFormatError(
        'O provedor retornou uma resposta em formato inválido (não é um JSON válido).'
      );
    }

    if (parsed === null || parsed === undefined) {
      throw createEmptyResponseError(
        'O provedor retornou uma resposta JSON nula ou vazia.'
      );
    }

    if (typeof parsed !== 'object') {
      throw createInvalidFormatError(
        'O provedor retornou uma resposta em formato inesperado (esperava-se objeto ou lista JSON).'
      );
    }

    return parsed as T;
  }

  throw createInvalidFormatError(
    'O provedor retornou uma resposta em formato inválido (não é um JSON válido).'
  );
}

export function createHttpError(
  status: number,
  _statusText?: string,
  retryAfterHeaderValue?: unknown
): TransportError {
  if (status === 401) {
    const err: TransportError = new Error(
      'Acesso recusado ao recurso pelo servidor do provedor (HTTP 401).'
    );
    err.errorCategory = 'http_unauthorized';
    err.status = 401;
    err.isClientError = true;
    err.isTransient = false;
    return err;
  }

  if (status === 403) {
    const err: TransportError = new Error(
      'Acesso proibido ou restrito pelo servidor do provedor (HTTP 403).'
    );
    err.errorCategory = 'http_forbidden';
    err.status = 403;
    err.isClientError = true;
    err.isTransient = false;
    return err;
  }

  if (status === 408) {
    const err: TransportError = new Error(
      'Tempo limite HTTP esgotado no servidor do provedor (HTTP 408).'
    );
    err.errorCategory = 'http_timeout';
    err.status = 408;
    err.isClientError = false;
    err.isTransient = true;
    return err;
  }

  if (status === 429) {
    const err: TransportError = new Error(
      'Limite de requisições do provedor atingido (HTTP 429). Aguarde alguns instantes e tente novamente.'
    );
    err.errorCategory = 'http_rate_limited';
    err.status = 429;
    err.isClientError = false;
    err.isTransient = true;
    err.isRateLimited = true;
    const parsedRetryAfter = parseRetryAfterMs(retryAfterHeaderValue);
    if (parsedRetryAfter !== undefined) {
      err.retryAfterMs = parsedRetryAfter;
    }
    return err;
  }

  if (status >= 500 && status <= 599) {
    const err: TransportError = new Error(
      `O servidor do provedor está temporariamente indisponível (HTTP ${status}).`
    );
    err.errorCategory = 'http_server_error';
    err.status = status;
    err.isClientError = false;
    err.isTransient = true;
    return err;
  }

  if (status >= 400 && status < 500) {
    const err: TransportError = new Error(
      `O servidor do provedor rejeitou a requisição (HTTP ${status}).`
    );
    err.errorCategory = 'http_client_error';
    err.status = status;
    err.isClientError = true;
    err.isTransient = false;
    return err;
  }

  const fallbackStatus = status || 500;
  const httpError: TransportError = new Error(
    `O servidor do provedor retornou resposta inesperada (HTTP ${fallbackStatus}).`
  );
  httpError.errorCategory = fallbackStatus >= 500 ? 'http_server_error' : 'http_client_error';
  httpError.status = fallbackStatus;
  httpError.isClientError = fallbackStatus >= 400 && fallbackStatus < 500;
  httpError.isTransient = !httpError.isClientError;
  return httpError;
}

function createTimeoutError(): TransportError {
  const timeoutError: TransportError = new Error(
    'Tempo limite esgotado ao aguardar resposta do servidor do provedor.'
  );
  timeoutError.errorCategory = 'timeout';
  timeoutError.isTransient = true;
  timeoutError.isClientError = false;
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
  isFullCatalogRequest = false,
}: TransportRequestOptions): Promise<T> {
  if (signal?.aborted) {
    throw createAbortError();
  }

  if (isFullCatalogRequest && isAndroidTempFileCatalogTransportAvailable()) {
    const deadlineAt = getMonotonicNowMs() + timeoutMs;
    androidAdapterLoadCountForTest++;
    const { executeAndroidTempFileCatalogDownload } = await import(
      './androidCatalogFileAdapter'
    );
    if (signal?.aborted) {
      throw createAbortError();
    }
    if (getMonotonicNowMs() >= deadlineAt) {
      throw createTimeoutError();
    }
    let rawText: string;
    try {
      rawText = await executeAndroidTempFileCatalogDownload({
        url,
        timeoutMs,
        deadlineAt,
        signal,
      });
    } catch (err: any) {
      if (signal?.aborted || err?.isAborted || err?.message === ABORT_ERROR_MESSAGE) {
        throw createAbortError();
      }
      // CatalogFileTransfer não retorna headers HTTP; preserva o status HTTP sem inventar Retry-After.
      if (typeof err?.status === 'number' && !err?.isLocalFileReadError) {
        throw createHttpError(err.status);
      }
      if (err?.isLocalFileReadError && !err?.errorCategory) {
        err.errorCategory = 'local_file_read';
      }
      throw err;
    }
    if (signal?.aborted) {
      throw createAbortError();
    }
    if (getMonotonicNowMs() >= deadlineAt) {
      throw createTimeoutError();
    }
    return normalizeTransportPayload<T>(rawText, signal, deadlineAt);
  }

  if (isUsingCapacitorNativeTransport()) {
    return executeCapacitorHttpGet<T>({ url, timeoutMs, signal });
  }

  return executeBrowserFetchGet<T>({ url, timeoutMs, signal });
}

async function executeBrowserFetchGet<T = any>({
  url,
  timeoutMs,
  signal,
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

  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });
    } catch {
      if (signal?.aborted) {
        throw createAbortError();
      }
      if (didTimeout) {
        throw createTimeoutError();
      }
      throw createNetworkError();
    }

    if (signal?.aborted) {
      throw createAbortError();
    }

    if (!response.ok) {
      const retryAfterHeader = extractHeaderCaseInsensitive(
        response.headers,
        'retry-after'
      );
      throw createHttpError(response.status, response.statusText, retryAfterHeader);
    }

    let textData: string;
    try {
      textData = await response.text();
    } catch {
      if (signal?.aborted) {
        throw createAbortError();
      }
      if (didTimeout) {
        throw createTimeoutError();
      }
      const readError: TransportError = new Error(
        'Falha ao ler os dados da resposta do provedor.'
      );
      readError.errorCategory = 'network';
      readError.isTransient = true;
      readError.isClientError = false;
      readError.status = response.status;
      throw readError;
    }

    if (signal?.aborted) {
      throw createAbortError();
    }

    return normalizeTransportPayload<T>(textData, signal);
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
}: TransportRequestOptions): Promise<T> {
  const connectTimeout = Math.min(timeoutMs, MAX_NATIVE_CONNECT_TIMEOUT_MS);
  const readTimeout = timeoutMs;
  const httpGetFn =
    capacitorHttpGetOverride ??
    ((opts: HttpOptions) => CapacitorHttp.get(opts));

  let settled = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let onCallerAbort: (() => void) | null = null;

  try {
    const response = await new Promise<HttpResponse>((resolve, reject) => {
      onCallerAbort = () => {
        if (settled) return;
        settled = true;
        reject(createAbortError());
      };

      if (signal) {
        if (signal.aborted) {
          settled = true;
          reject(createAbortError());
          return;
        }
        signal.addEventListener('abort', onCallerAbort, { once: true });
      }

      timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(createTimeoutError());
      }, timeoutMs);

      const requestOptions: HttpOptions = {
        url,
        connectTimeout,
        readTimeout,
        responseType: 'text',
        headers: {
          Accept: 'application/json, text/plain, */*',
        },
      };

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
          if (signal?.aborted) {
            reject(createAbortError());
            return;
          }
          const msg = String(err?.message || err || '').toLowerCase();
          if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('sockettimeout')) {
            reject(createTimeoutError());
            return;
          }
          reject(createNetworkError());
        });
    });

    const status = typeof response?.status === 'number' ? response.status : 0;

    if (signal?.aborted) {
      throw createAbortError();
    }

    if (status < 200 || status >= 300) {
      const retryAfterHeader = extractHeaderCaseInsensitive(
        response?.headers,
        'retry-after'
      );
      throw createHttpError(
        status || 500,
        status ? `Status ${status}` : 'Erro',
        retryAfterHeader
      );
    }

    return normalizeTransportPayload<T>(response.data, signal);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    if (signal && onCallerAbort) {
      signal.removeEventListener('abort', onCallerAbort);
    }
  }
}
