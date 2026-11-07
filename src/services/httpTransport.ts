import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { HttpOptions, HttpResponse } from '@capacitor/core';
import {
  type CatalogDiagnosticAttemptHandle,
  nowMonotonicMs,
  classifyDiagnosticErrorCategory,
} from '../utils/catalogDiagnostics';

export interface TransportRequestOptions {
  url: string;
  timeoutMs: number;
  signal?: AbortSignal;
  diagAttempt?: CatalogDiagnosticAttemptHandle | null;
}

export interface TransportError extends Error {
  isTransient?: boolean;
  isClientError?: boolean;
  isFatalFormat?: boolean;
  status?: number;
}

export type TransportMode = 'auto' | 'web' | 'capacitor';

const MAX_NATIVE_CONNECT_TIMEOUT_MS = 15000;

let transportModeOverride: TransportMode = 'auto';
let capacitorHttpGetOverride: ((options: HttpOptions) => Promise<HttpResponse>) | null = null;

/**
 * Permite selecionar explicitamente o modo de transporte ('web' ou 'capacitor')
 * e injetar um mock de `CapacitorHttp.get` durante os testes automatizados offline.
 */
export function setTransportTestConfig(config: {
  mode?: TransportMode;
  capacitorHttpGet?: ((options: HttpOptions) => Promise<HttpResponse>) | null;
}): void {
  if (config.mode !== undefined) {
    transportModeOverride = config.mode;
  }
  if (config.capacitorHttpGet !== undefined) {
    capacitorHttpGetOverride = config.capacitorHttpGet;
  }
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

/**
 * Executa uma consulta GET JSON para a API Xtream Codes:
 *
 * 1. No navegador ('web'):
 *    Utiliza `fetch` nativo com `AbortController`, interrompendo efetivamente o socket HTTP
 *    quando `signal` é abortado ou quando o prazo `timeoutMs` expira.
 *
 * 2. No aplicativo Android Capacitor ('capacitor'):
 *    Utiliza chamadas explícitas de `CapacitorHttp.get` (sem patch global de `fetch`/`XMLHttpRequest`,
 *    preservando o player HTML5/HLS.js).
 *    Configura `connectTimeout` (até 15s) e `readTimeout` (`timeoutMs`) na camada nativa Java,
 *    além do temporizador total da operação em JS.
 */
export async function executeXtreamGetRequest<T = any>({
  url,
  timeoutMs,
  signal,
  diagAttempt,
}: TransportRequestOptions): Promise<T> {
  if (signal?.aborted) {
    if (diagAttempt?.isActive()) {
      diagAttempt.finishAttempt('cancelled', 'cancelled', null);
    }
    throw new Error('Operação cancelada pelo usuário.');
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
        if (diagAttempt?.isActive()) {
          diagAttempt.finishAttempt('cancelled', 'cancelled', null);
        }
        throw new Error('Operação cancelada pelo usuário.');
      }
      if (didTimeout) {
        const tErr = createTimeoutError();
        if (diagAttempt?.isActive()) {
          diagAttempt.recordWebResponseWait(nowMonotonicMs() - responseWaitStartMs);
          diagAttempt.finishAttempt('error', 'timeout', null);
        }
        throw tErr;
      }
      const nErr = createNetworkError();
      if (diagAttempt?.isActive()) {
        diagAttempt.recordWebResponseWait(nowMonotonicMs() - responseWaitStartMs);
        diagAttempt.finishAttempt('error', 'network', null);
      }
      throw nErr;
    }

    if (signal?.aborted) {
      if (diagAttempt?.isActive()) {
        diagAttempt.finishAttempt('cancelled', 'cancelled', response.status);
      }
      throw new Error('Operação cancelada pelo usuário.');
    }

    if (diagAttempt?.isActive()) {
      diagAttempt.recordWebResponseWait(
        nowMonotonicMs() - responseWaitStartMs,
        response.status
      );
    }

    if (!response.ok) {
      const httpErr = createHttpError(response.status, response.statusText);
      if (diagAttempt?.isActive()) {
        diagAttempt.finishAttempt(
          'error',
          classifyDiagnosticErrorCategory(httpErr),
          response.status
        );
      }
      throw httpErr;
    }

    let textData: string;
    const bodyReadStartMs = diagAttempt?.isActive() ? nowMonotonicMs() : 0;
    try {
      textData = await response.text();
    } catch {
      if (signal?.aborted) {
        if (diagAttempt?.isActive()) {
          diagAttempt.finishAttempt('cancelled', 'cancelled', response.status);
        }
        throw new Error('Operação cancelada pelo usuário.');
      }
      if (didTimeout) {
        const tErr = createTimeoutError();
        if (diagAttempt?.isActive()) {
          diagAttempt.recordWebBodyRead(nowMonotonicMs() - bodyReadStartMs, 0);
          diagAttempt.finishAttempt('error', 'timeout', response.status);
        }
        throw tErr;
      }
      const readError: TransportError = new Error(
        'Falha ao ler os dados da resposta do provedor.'
      );
      readError.isTransient = true;
      if (diagAttempt?.isActive()) {
        diagAttempt.recordWebBodyRead(nowMonotonicMs() - bodyReadStartMs, 0);
        diagAttempt.finishAttempt('error', 'network', response.status);
      }
      throw readError;
    }

    if (signal?.aborted) {
      if (diagAttempt?.isActive()) {
        diagAttempt.finishAttempt('cancelled', 'cancelled', response.status);
      }
      throw new Error('Operação cancelada pelo usuário.');
    }

    if (diagAttempt?.isActive()) {
      diagAttempt.recordWebBodyRead(
        nowMonotonicMs() - bodyReadStartMs,
        textData.length
      );
    }

    try {
      const normalized = normalizeTransportPayload<T>(textData, diagAttempt);
      if (diagAttempt?.isActive()) {
        diagAttempt.finishAttempt('success', null, response.status);
      }
      return normalized;
    } catch (parseErr) {
      if (diagAttempt?.isActive()) {
        diagAttempt.finishAttempt(
          'error',
          classifyDiagnosticErrorCategory(parseErr),
          response.status
        );
      }
      throw parseErr;
    }
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
  const httpGetFn = capacitorHttpGetOverride ?? ((opts: HttpOptions) => CapacitorHttp.get(opts));

  let settled = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let onCallerAbort: (() => void) | null = null;
  const nativeStartMs = diagAttempt?.isActive() ? nowMonotonicMs() : 0;

  try {
    const response = await new Promise<HttpResponse>((resolve, reject) => {
      onCallerAbort = () => {
        if (settled) return;
        settled = true;
        if (diagAttempt?.isActive()) {
          diagAttempt.recordCapacitorTransportAndBridge(nowMonotonicMs() - nativeStartMs);
          diagAttempt.finishAttempt('cancelled', 'cancelled', null);
        }
        reject(new Error('Operação cancelada pelo usuário.'));
      };

      if (signal) {
        if (signal.aborted) {
          settled = true;
          if (diagAttempt?.isActive()) {
            diagAttempt.finishAttempt('cancelled', 'cancelled', null);
          }
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
          diagAttempt.finishAttempt('error', 'timeout', null);
        }
        reject(tErr);
      }, timeoutMs);

      httpGetFn({
        url,
        connectTimeout,
        readTimeout,
        responseType: 'text',
        headers: {
          Accept: 'application/json, text/plain, */*',
        },
      })
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
            if (diagAttempt?.isActive()) {
              diagAttempt.recordCapacitorTransportAndBridge(nowMonotonicMs() - nativeStartMs);
              diagAttempt.finishAttempt('cancelled', 'cancelled', null);
            }
            reject(new Error('Operação cancelada pelo usuário.'));
            return;
          }
          const msg = String(err?.message || err || '').toLowerCase();
          if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('sockettimeout')) {
            const tErr = createTimeoutError();
            if (diagAttempt?.isActive()) {
              diagAttempt.recordCapacitorTransportAndBridge(nowMonotonicMs() - nativeStartMs);
              diagAttempt.finishAttempt('error', 'timeout', null);
            }
            reject(tErr);
            return;
          }
          const nErr = createNetworkError();
          if (diagAttempt?.isActive()) {
            diagAttempt.recordCapacitorTransportAndBridge(nowMonotonicMs() - nativeStartMs);
            diagAttempt.finishAttempt('error', 'network', null);
          }
          reject(nErr);
        });
    });

    if (signal?.aborted) {
      if (diagAttempt?.isActive()) {
        diagAttempt.recordCapacitorTransportAndBridge(nowMonotonicMs() - nativeStartMs);
        diagAttempt.finishAttempt('cancelled', 'cancelled', null);
      }
      throw new Error('Operação cancelada pelo usuário.');
    }

    const status = typeof response?.status === 'number' ? response.status : 0;
    if (diagAttempt?.isActive()) {
      diagAttempt.recordCapacitorTransportAndBridge(
        nowMonotonicMs() - nativeStartMs,
        status || undefined
      );
    }

    if (status < 200 || status >= 300) {
      const httpErr = createHttpError(status || 500, status ? `Status ${status}` : 'Erro');
      if (diagAttempt?.isActive()) {
        diagAttempt.finishAttempt(
          'error',
          classifyDiagnosticErrorCategory(httpErr),
          status || 500
        );
      }
      throw httpErr;
    }

    try {
      const normalized = normalizeTransportPayload<T>(response.data, diagAttempt);
      if (diagAttempt?.isActive()) {
        diagAttempt.finishAttempt('success', null, status);
      }
      return normalized;
    } catch (parseErr) {
      if (diagAttempt?.isActive()) {
        diagAttempt.finishAttempt(
          'error',
          classifyDiagnosticErrorCategory(parseErr),
          status
        );
      }
      throw parseErr;
    }
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    if (signal && onCallerAbort) {
      signal.removeEventListener('abort', onCallerAbort);
    }
  }
}
