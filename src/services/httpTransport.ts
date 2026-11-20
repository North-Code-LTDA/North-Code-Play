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

/**
 * Normaliza o corpo da resposta que pode chegar:
 * - Já interpretado como objeto/array JavaScript (comportamento padrão do CapacitorHttp em respostas application/json),
 *   retornando a referência diretamente SEM re-serializar (JSON.stringify + JSON.parse) catálogos extensos.
 * - Como texto JSON (string), realizando JSON.parse uma única vez.
 * - Vazio/nulo, retornando [] por compatibilidade com listas Xtream vazias.
 */
export function normalizeTransportPayload<T = any>(
  rawPayload: unknown,
  signal?: AbortSignal,
  deadlineAt?: number
): T {
  if (signal?.aborted) {
    throw new Error('Operação cancelada pelo usuário.');
  }
  if (typeof deadlineAt === 'number' && Number.isFinite(deadlineAt) && getMonotonicNowMs() >= deadlineAt) {
    throw createTimeoutError();
  }

  if (rawPayload === null || rawPayload === undefined) {
    return [] as unknown as T;
  }

  if (typeof rawPayload === 'object') {
    return rawPayload as T;
  }

  if (typeof rawPayload === 'string') {
    const trimmed = rawPayload.trim();
    if (!trimmed) {
      if (signal?.aborted) {
        throw new Error('Operação cancelada pelo usuário.');
      }
      if (typeof deadlineAt === 'number' && Number.isFinite(deadlineAt) && getMonotonicNowMs() >= deadlineAt) {
        throw createTimeoutError();
      }
      return [] as unknown as T;
    }
    if (signal?.aborted) {
      throw new Error('Operação cancelada pelo usuário.');
    }
    if (typeof deadlineAt === 'number' && Number.isFinite(deadlineAt) && getMonotonicNowMs() >= deadlineAt) {
      throw createTimeoutError();
    }
    try {
      return JSON.parse(trimmed) as T;
    } catch {
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
    throw new Error('Operação cancelada pelo usuário.');
  }

  if (isFullCatalogRequest && isAndroidTempFileCatalogTransportAvailable()) {
    const deadlineAt = getMonotonicNowMs() + timeoutMs;
    androidAdapterLoadCountForTest++;
    const { executeAndroidTempFileCatalogDownload } = await import(
      './androidCatalogFileAdapter'
    );
    if (signal?.aborted) {
      throw new Error('Operação cancelada pelo usuário.');
    }
    if (getMonotonicNowMs() >= deadlineAt) {
      throw createTimeoutError();
    }
    const rawText = await executeAndroidTempFileCatalogDownload({
      url,
      timeoutMs,
      deadlineAt,
      signal,
    });
    if (signal?.aborted) {
      throw new Error('Operação cancelada pelo usuário.');
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
        throw new Error('Operação cancelada pelo usuário.');
      }
      if (didTimeout) {
        throw createTimeoutError();
      }
      throw createNetworkError();
    }

    if (signal?.aborted) {
      throw new Error('Operação cancelada pelo usuário.');
    }

    if (!response.ok) {
      throw createHttpError(response.status, response.statusText);
    }

    let textData: string;
    try {
      textData = await response.text();
    } catch {
      if (signal?.aborted) {
        throw new Error('Operação cancelada pelo usuário.');
      }
      if (didTimeout) {
        throw createTimeoutError();
      }
      const readError: TransportError = new Error(
        'Falha ao ler os dados da resposta do provedor.'
      );
      readError.isTransient = true;
      readError.status = response.status;
      throw readError;
    }

    if (signal?.aborted) {
      throw new Error('Operação cancelada pelo usuário.');
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
            reject(new Error('Operação cancelada pelo usuário.'));
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
      throw new Error('Operação cancelada pelo usuário.');
    }

    if (status < 200 || status >= 300) {
      throw createHttpError(status || 500, status ? `Status ${status}` : 'Erro');
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
