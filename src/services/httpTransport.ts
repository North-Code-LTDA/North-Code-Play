import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { HttpOptions, HttpResponse } from '@capacitor/core';

export interface TransportRequestOptions {
  url: string;
  timeoutMs: number;
  signal?: AbortSignal;
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
export function normalizeTransportPayload<T = any>(rawPayload: unknown): T {
  if (rawPayload === null || rawPayload === undefined) {
    return [] as unknown as T;
  }

  if (typeof rawPayload === 'object') {
    return rawPayload as T;
  }

  if (typeof rawPayload === 'string') {
    const trimmed = rawPayload.trim();
    if (!trimmed) {
      return [] as unknown as T;
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
 *    Utiliza chamadas explícitas de `CapacitorHttp.get` (sem patch global de `fetch`/`XMLHttpRequest`,
 *    preservando o player HTML5/HLS.js).
 *    Configura `connectTimeout` (até 15s) e `readTimeout` (`timeoutMs`) na camada nativa Java,
 *    além do temporizador total da operação em JS.
 *
 *    Nota sobre cancelamento lógico vs. conexão nativa:
 *    A ponte `CapacitorHttp.get` não expõe um descritor para abortar o `HttpURLConnection` nativo
 *    em andamento a partir do JavaScript. Quando `signal` é abortado (ex.: troca de conta ou
 *    desmontagem), a Promise em JS rejeita imediatamente ("Operação cancelada pelo usuário.") e
 *    qualquer resposta nativa tardia é descartada sem processar o payload, enquanto a thread
 *    nativa encerra de forma limitada por `connectTimeout`/`readTimeout`.
 */
export async function executeXtreamGetRequest<T = any>({
  url,
  timeoutMs,
  signal,
}: TransportRequestOptions): Promise<T> {
  if (signal?.aborted) {
    throw new Error('Operação cancelada pelo usuário.');
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
      throw readError;
    }

    if (signal?.aborted) {
      throw new Error('Operação cancelada pelo usuário.');
    }

    return normalizeTransportPayload<T>(textData);
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
  const httpGetFn = capacitorHttpGetOverride ?? ((opts: HttpOptions) => CapacitorHttp.get(opts));

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

    if (signal?.aborted) {
      throw new Error('Operação cancelada pelo usuário.');
    }

    const status = typeof response?.status === 'number' ? response.status : 0;
    if (status < 200 || status >= 300) {
      throw createHttpError(status || 500, status ? `Status ${status}` : 'Erro');
    }

    return normalizeTransportPayload<T>(response.data);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    if (signal && onCallerAbort) {
      signal.removeEventListener('abort', onCallerAbort);
    }
  }
}
