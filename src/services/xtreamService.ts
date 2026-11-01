import {
  Category,
  LiveStream,
  VodStream,
  SeriesStream,
  XtreamAuthResponse,
  XtreamCredentials,
} from "../types";
import { normalizeServerUrl } from "../utils/mediaUtils";
import { executeXtreamGetRequest } from "./httpTransport";

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface XtreamCategorizedError extends Error {
  isAuthError?: boolean;
  isTransient?: boolean;
  isClientError?: boolean;
  isFatalFormat?: boolean;
  status?: number;
  authErrorReason?: 'invalid_credentials' | 'account_inactive' | 'http_unauthorized';
}

export function createXtreamAuthError(
  message: string,
  reason: 'invalid_credentials' | 'account_inactive' | 'http_unauthorized' = 'invalid_credentials',
  status?: number
): XtreamCategorizedError {
  const err: XtreamCategorizedError = new Error(message);
  err.isAuthError = true;
  err.isClientError = true;
  err.isTransient = false;
  err.authErrorReason = reason;
  if (status !== undefined) {
    err.status = status;
  }
  return err;
}

/**
 * Diferencia rejeição comprovada de autenticação (credenciais inválidas, auth=0,
 * conta expirada/desativada/banida ou HTTP 401/403) de falhas transitórias
 * (timeout, falha de rede, CORS, HTTP 5xx ou indisponibilidade temporária).
 */
export function isAuthenticationRejectedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const anyErr = err as XtreamCategorizedError;

  if (anyErr.isAuthError === true) return true;
  if (anyErr.isTransient === true) return false;
  if (anyErr.status === 401 || anyErr.status === 403) return true;

  const msg = String(anyErr.message || '').trim();
  if (!msg) return false;

  // Nunca classificar erros de rede, timeout, CORS ou cancelamento como rejeição de credenciais
  if (
    /tempo limite|timeout|falha de rede|cors|cancelad|indispon|http 5\d\d|http 429|http 408/i.test(
      msg
    )
  ) {
    return false;
  }

  return /usuário ou senha (inválidos|incorretos)|conta (de usuário )?(desativada|expirada|banida)|credenciais inválidas|acesso (negado|expirado)|http (401|403)\b/i.test(
    msg
  );
}

export function isTransientXtreamError(err: unknown): boolean {
  if (!err) return false;
  if (isAuthenticationRejectedError(err)) return false;
  const anyErr = err as XtreamCategorizedError;
  if (anyErr.isTransient === true) return true;
  const msg = String(anyErr.message || '');
  if (/Operação cancelada pelo usuário/i.test(msg)) return false;
  return true;
}

/**
 * Inspeciona se um payload retornado pelo servidor Xtream (em authenticate ou em endpoints
 * de categorias/catálogo) indica explicitamente credenciais inválidas ou conta inativa/expirada.
 */
export function inspectPayloadForAuthError(data: unknown): void {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return;
  }
  const obj = data as Record<string, any>;
  if (!obj.user_info || typeof obj.user_info !== 'object') {
    return;
  }

  const auth = obj.user_info.auth;
  if (auth === 0 || auth === '0' || auth === false || String(auth) === '0') {
    throw createXtreamAuthError(
      'Usuário ou senha inválidos ou conta desativada.',
      'invalid_credentials'
    );
  }

  if (
    obj.user_info.status &&
    ['disabled', 'expired', 'banned'].includes(String(obj.user_info.status).toLowerCase())
  ) {
    throw createXtreamAuthError(
      'Conta de usuário desativada ou expirada.',
      'account_inactive'
    );
  }
}

/**
 * Valida que o retorno do catálogo é um array e descarta entradas inválidas
 * (null, undefined, tipos primitivos ou arrays aninhados no lugar de objetos de registro),
 * preservando a ordem e os dados dos registros válidos.
 */
export function normalizeCatalogArray<T = any>(
  data: unknown,
  invalidFormatMessage: string
): T[] {
  inspectPayloadForAuthError(data);
  if (!Array.isArray(data)) {
    throw new Error(invalidFormatMessage);
  }
  const result: T[] = [];
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      result.push(item as T);
    }
  }
  return result;
}

export class XtreamService {
  private static readonly DEFAULT_TIMEOUT_MS = 25000;
  private static readonly CATALOG_TIMEOUT_MS = 90000;

  /**
   * Helper to delay between attempts, respecting caller cancellation.
   */
  private static sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        return reject(new Error("Operação cancelada pelo usuário."));
      }
      const timer = setTimeout(() => {
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
        resolve();
      }, ms);

      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error("Operação cancelada pelo usuário."));
      };

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  /**
   * Performs direct HTTP/HTTPS GET requests to the Xtream provider via the transport adapter
   * (fetch on Web, explicit CapacitorHttp on Android).
   * Applies at most ONE automatic retry for transient network errors or timeouts.
   * Does NOT retry HTTP 4xx, auth rejections, invalid JSON, or intentional caller cancellation.
   */
  private static async request<T = any>(
    credentials: XtreamCredentials,
    action?: string,
    params: Record<string, string | number> = {},
    timeoutMs: number = XtreamService.DEFAULT_TIMEOUT_MS,
    options?: RequestOptions
  ): Promise<T> {
    const cleanServerUrl = normalizeServerUrl(credentials.serverUrl);
    if (!cleanServerUrl) {
      throw new Error("URL do servidor Xtream não fornecida ou inválida.");
    }

    let targetUrl: URL;
    try {
      targetUrl = new URL(
        `${cleanServerUrl.replace(/\/+$/, "")}/player_api.php`
      );
    } catch {
      throw new Error(`Endereço de servidor inválido: ${cleanServerUrl}`);
    }

    targetUrl.searchParams.set("username", credentials.username);
    targetUrl.searchParams.set("password", credentials.password);

    if (action) {
      targetUrl.searchParams.set("action", action);
    }

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        targetUrl.searchParams.set(key, String(value));
      }
    }

    const callerSignal = options?.signal;
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (callerSignal?.aborted) {
        throw new Error("Operação cancelada pelo usuário.");
      }

      try {
        const payload = await executeXtreamGetRequest<T>({
          url: targetUrl.toString(),
          timeoutMs,
          signal: callerSignal,
        });
        inspectPayloadForAuthError(payload);
        return payload;
      } catch (err: any) {
        // Do not retry caller aborts
        if (callerSignal?.aborted || err?.message === "Operação cancelada pelo usuário.") {
          throw new Error("Operação cancelada pelo usuário.");
        }
        // Classify HTTP 401 / 403 as explicit authentication rejection
        if (err?.status === 401 || err?.status === 403) {
          throw createXtreamAuthError(
            `Acesso recusado pelo servidor do provedor (HTTP ${err.status}). Verifique seu usuário e senha.`,
            "http_unauthorized",
            err.status
          );
        }
        // Do not retry auth errors or HTTP 4xx
        if (err?.isAuthError || err?.isClientError) {
          throw err;
        }
        // Do not retry fatal format errors (malformed JSON)
        if (err?.isFatalFormat) {
          throw err;
        }
        // If this was the last attempt, rethrow error
        if (attempt >= maxAttempts) {
          throw err;
        }
        // Wait briefly before the single retry
        await XtreamService.sleep(1000, callerSignal);
      }
    }

    throw new Error("Falha ao comunicar com o servidor do provedor.");
  }

  /**
   * 1. Authenticate user and retrieve general account/server properties.
   * Calls player_api.php?username=...&password=... without action.
   * Uses default 25000ms timeout per attempt.
   */
  static async authenticate(
    credentials: XtreamCredentials,
    options?: RequestOptions
  ): Promise<XtreamAuthResponse> {
    const data = await this.request<any>(
      credentials,
      undefined,
      {},
      XtreamService.DEFAULT_TIMEOUT_MS,
      options
    );

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Resposta inválida recebida do servidor do provedor.");
    }

    if (!data.user_info) {
      throw createXtreamAuthError(
        "Usuário ou senha incorretos ou resposta inesperada do provedor.",
        "invalid_credentials"
      );
    }

    inspectPayloadForAuthError(data);

    return data as XtreamAuthResponse;
  }

  /**
   * Fetch Live Categories (25000ms)
   */
  static async getLiveCategories(
    credentials: XtreamCredentials,
    options?: RequestOptions
  ): Promise<Category[]> {
    const data = await this.request<any>(
      credentials,
      "get_live_categories",
      {},
      XtreamService.DEFAULT_TIMEOUT_MS,
      options
    );
    return normalizeCatalogArray<Category>(
      data,
      "Resposta inválida do provedor ao buscar categorias de TV (esperava-se uma lista)."
    );
  }

  /**
   * Fetch Live Streams (90000ms)
   */
  static async getLiveStreams(
    credentials: XtreamCredentials,
    categoryId?: string,
    options?: RequestOptions
  ): Promise<LiveStream[]> {
    const params = categoryId ? { category_id: categoryId } : {};
    const data = await this.request<any>(
      credentials,
      "get_live_streams",
      params,
      XtreamService.CATALOG_TIMEOUT_MS,
      options
    );
    return normalizeCatalogArray<LiveStream>(
      data,
      "Resposta inválida do provedor ao buscar canais ao vivo (esperava-se uma lista)."
    );
  }

  /**
   * Fetch VOD Categories (25000ms)
   */
  static async getVodCategories(
    credentials: XtreamCredentials,
    options?: RequestOptions
  ): Promise<Category[]> {
    const data = await this.request<any>(
      credentials,
      "get_vod_categories",
      {},
      XtreamService.DEFAULT_TIMEOUT_MS,
      options
    );
    return normalizeCatalogArray<Category>(
      data,
      "Resposta inválida do provedor ao buscar categorias de filmes (esperava-se uma lista)."
    );
  }

  /**
   * Fetch VOD Streams (90000ms)
   */
  static async getVodStreams(
    credentials: XtreamCredentials,
    categoryId?: string,
    options?: RequestOptions
  ): Promise<VodStream[]> {
    const params = categoryId ? { category_id: categoryId } : {};
    const data = await this.request<any>(
      credentials,
      "get_vod_streams",
      params,
      XtreamService.CATALOG_TIMEOUT_MS,
      options
    );
    return normalizeCatalogArray<VodStream>(
      data,
      "Resposta inválida do provedor ao buscar catálogo de filmes (esperava-se uma lista)."
    );
  }

  /**
   * Fetch VOD Info (25000ms)
   */
  static async getVodInfo(
    credentials: XtreamCredentials,
    vodId: string | number,
    options?: RequestOptions
  ): Promise<any> {
    return this.request<any>(
      credentials,
      "get_vod_info",
      { vod_id: String(vodId) },
      XtreamService.DEFAULT_TIMEOUT_MS,
      options
    );
  }

  /**
   * Fetch Series Categories (25000ms)
   */
  static async getSeriesCategories(
    credentials: XtreamCredentials,
    options?: RequestOptions
  ): Promise<Category[]> {
    const data = await this.request<any>(
      credentials,
      "get_series_categories",
      {},
      XtreamService.DEFAULT_TIMEOUT_MS,
      options
    );
    return normalizeCatalogArray<Category>(
      data,
      "Resposta inválida do provedor ao buscar categorias de séries (esperava-se uma lista)."
    );
  }

  /**
   * Fetch Series (90000ms)
   */
  static async getSeries(
    credentials: XtreamCredentials,
    categoryId?: string,
    options?: RequestOptions
  ): Promise<SeriesStream[]> {
    const params = categoryId ? { category_id: categoryId } : {};
    const data = await this.request<any>(
      credentials,
      "get_series",
      params,
      XtreamService.CATALOG_TIMEOUT_MS,
      options
    );
    return normalizeCatalogArray<SeriesStream>(
      data,
      "Resposta inválida do provedor ao buscar catálogo de séries (esperava-se uma lista)."
    );
  }

  /**
   * Fetch Series Info (25000ms)
   */
  static async getSeriesInfo(
    credentials: XtreamCredentials,
    seriesId: string | number,
    options?: RequestOptions
  ): Promise<any> {
    return this.request<any>(
      credentials,
      "get_series_info",
      { series_id: String(seriesId) },
      XtreamService.DEFAULT_TIMEOUT_MS,
      options
    );
  }

  /**
   * Fetch Short EPG (25000ms)
   */
  static async getShortEpg(
    credentials: XtreamCredentials,
    streamId: string | number,
    limit: number = 10,
    options?: RequestOptions
  ): Promise<any> {
    return this.request<any>(
      credentials,
      "get_short_epg",
      {
        stream_id: String(streamId),
        limit: String(limit),
      },
      XtreamService.DEFAULT_TIMEOUT_MS,
      options
    );
  }
}
