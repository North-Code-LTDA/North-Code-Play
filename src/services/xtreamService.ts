import {
  Category,
  LiveStream,
  VodStream,
  SeriesStream,
  XtreamAuthResponse,
  XtreamCredentials,
  XtreamSeriesInfoResponse,
  XtreamVodInfoResponse,
} from "../types";
import {
  normalizeAllowedOutputFormats,
  normalizeServerUrl,
} from "../utils/mediaUtils";
import {
  createAbortError,
  createHttpError,
  executeXtreamGetRequest,
  type TransportCancellationMode,
  type TransportErrorCategory,
} from "./httpTransport";
import {
  elevateXtreamRequestPriority,
  getXtreamCoordinatorRateLimitMinWaitMs,
  runCoordinatedXtreamRequest,
  type XtreamRequestLane,
  type XtreamRequestPriority,
} from "./xtreamRequestCoordinator";

export interface RequestOptions {
  signal?: AbortSignal;
  priority?: XtreamRequestPriority;
  priorityHint?: number;
  lane?: XtreamRequestLane;
  dedupe?: boolean;
}

export type XtreamAuthErrorReason =
  | 'invalid_credentials'
  | 'account_inactive'
  | 'http_unauthorized';

export type XtreamErrorCategory =
  | TransportErrorCategory
  | 'auth_rejected'
  | 'ambiguous_auth_response';

export interface XtreamCategorizedError extends Error {
  errorCategory?: XtreamErrorCategory;
  isAuthError?: boolean;
  isTransient?: boolean;
  isClientError?: boolean;
  isFatalFormat?: boolean;
  isAborted?: boolean;
  isRateLimited?: boolean;
  retryAfterMs?: number;
  requiresAuthRecheck?: boolean;
  status?: number;
  authErrorReason?: XtreamAuthErrorReason;
  cancellationMode?: TransportCancellationMode;
  nativeAttemptStillPending?: boolean;
  disallowAutomaticRetry?: boolean;
}

const EXPLICIT_INACTIVE_STATUSES = new Set([
  'disabled',
  'expired',
  'banned',
  'inactive',
  'suspended',
  'blocked',
  'revoked',
  'deactivated',
  'expirado',
  'expirada',
  'desativado',
  'desativada',
  'banido',
  'banida',
  'inativo',
  'inativa',
  'suspenso',
  'suspensa',
  'bloqueado',
  'bloqueada',
]);

function isPlainObject(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTextField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim().toLowerCase();
}

function isExplicitAuthRejectionValue(auth: unknown): boolean {
  if (auth === 0 || auth === false) return true;
  const normalized = normalizeTextField(auth);
  return normalized === '0' || normalized === 'false';
}

function isExplicitAuthSuccessValue(auth: unknown): boolean {
  if (auth === 1 || auth === true) return true;
  const normalized = normalizeTextField(auth);
  return normalized === '1' || normalized === 'true';
}

function createAmbiguousAuthResponseError(message: string): XtreamCategorizedError {
  const err: XtreamCategorizedError = new Error(message);
  err.errorCategory = 'ambiguous_auth_response';
  err.isAuthError = false;
  err.isClientError = false;
  err.isTransient = false;
  err.isFatalFormat = true;
  return err;
}

function createResourceUnauthorizedError(): XtreamCategorizedError {
  const err: XtreamCategorizedError = new Error(
    'Acesso recusado ao recurso pelo servidor do provedor (HTTP 401).'
  );
  err.errorCategory = 'http_unauthorized';
  err.status = 401;
  err.isAuthError = false;
  err.isClientError = true;
  err.isTransient = false;
  err.requiresAuthRecheck = true;
  return err;
}

export function createXtreamAuthError(
  message: string,
  reason: XtreamAuthErrorReason = 'invalid_credentials',
  status?: number
): XtreamCategorizedError {
  const err: XtreamCategorizedError = new Error(message);
  err.errorCategory = 'auth_rejected';
  err.isAuthError = true;
  err.isClientError = true;
  err.isTransient = false;
  err.isFatalFormat = false;
  err.authErrorReason = reason;
  if (status !== undefined) {
    err.status = status;
  }
  return err;
}

/**
 * Diferencia rejeição comprovada de autenticação (auth=0/false, conta inativa/expirada/desativada/banida
 * ou HTTP 401 confirmado no endpoint authenticate()) de HTTP 403, HTTP 401 em outros recursos antes de
 * revalidação, respostas ambíguas/inválidas, rate limit (429), cancelamentos e falhas transitórias.
 */
export function isAuthenticationRejectedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const anyErr = err as XtreamCategorizedError;

  if (anyErr.isAuthError === true) return true;
  if (anyErr.isAuthError === false) return false;
  if (
    anyErr.isAborted === true ||
    anyErr.isTransient === true ||
    anyErr.isRateLimited === true ||
    anyErr.isFatalFormat === true
  ) {
    return false;
  }
  if (anyErr.errorCategory !== undefined) {
    return anyErr.errorCategory === 'auth_rejected';
  }
  if (anyErr.authErrorReason !== undefined) {
    return true;
  }
  if (typeof anyErr.status === 'number') {
    return false;
  }

  const msg = String(anyErr.message || '').trim();
  if (!msg) return false;

  // Fallback defensivo apenas para erros não estruturados
  if (
    /tempo limite|timeout|falha de rede|cors|cancelad|indispon|http 5\d\d|http 429|http 408|http 403|proibid|restrit|formato inválido|não é um json|resposta vazia|página html|não confirmou a autenticação/i.test(
      msg
    )
  ) {
    return false;
  }

  return /usuário ou senha (inválidos|incorretos)|conta (de usuário )?(desativada|expirada|banida|suspensa|bloqueada|inativa)|credenciais inválidas/i.test(
    msg
  );
}

/**
 * Identifica falhas transitórias de comunicação/provedor (rede, CORS, timeout, HTTP 408,
 * HTTP 429 ou HTTP 5xx), diferenciando-as de rejeição de autenticação, erros HTTP 4xx,
 * respostas malformadas/vazias e cancelamento intencional.
 */
export function isTransientXtreamError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const anyErr = err as XtreamCategorizedError;

  if (anyErr.isAborted === true) return false;
  if (isAuthenticationRejectedError(anyErr)) return false;
  if (anyErr.isFatalFormat === true) return false;
  if (anyErr.isClientError === true) return false;
  if (anyErr.isTransient === true) return true;
  if (anyErr.isTransient === false) return false;

  if (anyErr.errorCategory !== undefined) {
    return (
      anyErr.errorCategory === 'network' ||
      anyErr.errorCategory === 'timeout' ||
      anyErr.errorCategory === 'http_timeout' ||
      anyErr.errorCategory === 'http_rate_limited' ||
      anyErr.errorCategory === 'http_server_error' ||
      anyErr.errorCategory === 'local_file_read'
    );
  }

  if (typeof anyErr.status === 'number') {
    return (
      anyErr.status === 408 ||
      anyErr.status === 429 ||
      (anyErr.status >= 500 && anyErr.status <= 599)
    );
  }

  const msg = String(anyErr.message || '');
  if (/Operação cancelada pelo usuário/i.test(msg)) return false;
  return /tempo limite|timeout|falha de rede|cors|indisponível|limite de requisições|http 5\d\d|http 408|http 429/i.test(
    msg
  );
}

/**
 * Inspeciona se um payload retornado pelo servidor Xtream (em authenticate ou em endpoints
 * de categorias/catálogo) indica explicitamente credenciais inválidas ou conta inativa/expirada.
 * Prioriza rejeições explícitas mesmo quando outros campos do payload forem contraditórios.
 */
export function inspectPayloadForAuthError(data: unknown): void {
  if (!isPlainObject(data)) {
    return;
  }
  const userInfo = data.user_info;
  if (!isPlainObject(userInfo)) {
    return;
  }

  if (isExplicitAuthRejectionValue(userInfo.auth)) {
    throw createXtreamAuthError(
      'Usuário ou senha inválidos ou conta desativada.',
      'invalid_credentials'
    );
  }

  const normalizedStatus = normalizeTextField(userInfo.status);
  if (normalizedStatus && EXPLICIT_INACTIVE_STATUSES.has(normalizedStatus)) {
    throw createXtreamAuthError(
      'Conta de usuário desativada, expirada ou suspensa pelo provedor.',
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
    const formatErr: XtreamCategorizedError = new Error(invalidFormatMessage);
    formatErr.errorCategory = 'invalid_format';
    formatErr.isFatalFormat = true;
    formatErr.isTransient = false;
    formatErr.isClientError = false;
    formatErr.isAuthError = false;
    if (isPlainObject(data)) {
      // Alguns provedores retornam um objeto de erro fora do padrão user_info em endpoints de catálogo
      formatErr.requiresAuthRecheck = true;
    }
    throw formatErr;
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
  private static readonly RATE_LIMIT_MIN_WAIT_MS = 1000;
  private static readonly RATE_LIMIT_MAX_RETRY_AFTER_MS = 15000;
  private static retryDelayMs = 1000;
  private static defaultTimeoutOverrideMs: number | null = null;
  private static catalogTimeoutOverrideMs: number | null = null;

  static setRetryDelayMsForTest(ms: number): void {
    XtreamService.retryDelayMs = Math.max(0, ms);
  }

  static setTimeoutsForTest(overrides: {
    defaultTimeoutMs?: number | null;
    catalogTimeoutMs?: number | null;
  }): void {
    if (overrides.defaultTimeoutMs !== undefined) {
      XtreamService.defaultTimeoutOverrideMs =
        overrides.defaultTimeoutMs === null
          ? null
          : Math.max(1, overrides.defaultTimeoutMs);
    }
    if (overrides.catalogTimeoutMs !== undefined) {
      XtreamService.catalogTimeoutOverrideMs =
        overrides.catalogTimeoutMs === null
          ? null
          : Math.max(1, overrides.catalogTimeoutMs);
    }
  }

  private static getEffectiveDefaultTimeoutMs(): number {
    return (
      XtreamService.defaultTimeoutOverrideMs ?? XtreamService.DEFAULT_TIMEOUT_MS
    );
  }

  private static getEffectiveCatalogTimeoutMs(): number {
    return (
      XtreamService.catalogTimeoutOverrideMs ?? XtreamService.CATALOG_TIMEOUT_MS
    );
  }

  private static resolveDefaultLane(action?: string): XtreamRequestLane {
    if (!action) return "auth";
    if (action === "get_short_epg") return "epg";
    if (action === "get_vod_info" || action === "get_series_info") {
      return "details";
    }
    return "catalog";
  }

  private static resolveDefaultPriority(
    action?: string
  ): XtreamRequestPriority {
    if (!action) return "user";
    if (action === "get_vod_info" || action === "get_series_info") {
      return "user";
    }
    return "normal";
  }

  static elevateRequestPriority(
    credentials: XtreamCredentials | null | undefined,
    action: string | undefined,
    params: Record<string, string | number> | undefined,
    priority: XtreamRequestPriority,
    priorityHint: number = 0
  ): void {
    elevateXtreamRequestPriority(
      credentials,
      action,
      params,
      priority,
      priorityHint
    );
  }

  /**
   * Identifica explicitamente as consultas de catálogo completo:
   * `get_live_streams`, `get_vod_streams` e `get_series` sem filtro de `category_id`.
   */
  static isFullCatalogQuery(
    action?: string,
    params?: Record<string, string | number>
  ): boolean {
    if (
      action !== "get_live_streams" &&
      action !== "get_vod_streams" &&
      action !== "get_series"
    ) {
      return false;
    }
    const categoryId = params?.category_id;
    return (
      categoryId === undefined ||
      categoryId === null ||
      String(categoryId).trim() === ""
    );
  }

  /**
   * Performs direct HTTP/HTTPS GET requests to the Xtream provider via the transport adapter
   * (fetch on Web, explicit CapacitorHttp or temp-file catalog plugin on Android).
   * Applies at most ONE automatic retry for transient network errors, timeouts, HTTP 408,
   * HTTP 5xx, or HTTP 429 strictly when a valid Retry-After <= 15s is provided.
   * Does NOT retry other HTTP 4xx, auth rejections, invalid/empty payloads, or caller cancellation.
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
      const urlErr: XtreamCategorizedError = new Error(
        "URL do servidor Xtream não fornecida ou inválida."
      );
      urlErr.errorCategory = "http_client_error";
      urlErr.isClientError = true;
      urlErr.isTransient = false;
      urlErr.isAuthError = false;
      throw urlErr;
    }

    let targetUrl: URL;
    try {
      targetUrl = new URL(
        `${cleanServerUrl.replace(/\/+$/, "")}/player_api.php`
      );
    } catch {
      const invalidUrlErr: XtreamCategorizedError = new Error(
        "Endereço de servidor inválido. Verifique a URL informada."
      );
      invalidUrlErr.errorCategory = "http_client_error";
      invalidUrlErr.isClientError = true;
      invalidUrlErr.isTransient = false;
      invalidUrlErr.isAuthError = false;
      throw invalidUrlErr;
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
    const isAuthEndpoint = action === undefined;
    const isFullCatalogRequest = XtreamService.isFullCatalogQuery(action, params);
    const lane = options?.lane ?? XtreamService.resolveDefaultLane(action);
    const priority =
      options?.priority ?? XtreamService.resolveDefaultPriority(action);
    const maxAttempts = 2;

    return runCoordinatedXtreamRequest<T>({
      credentials,
      canonicalServer: cleanServerUrl,
      action,
      params,
      lane,
      priority,
      priorityHint: options?.priorityHint,
      dedupe: options?.dedupe ?? true,
      signal: callerSignal,
      execute: async (coordCtx) => {
        const effectiveSignal = coordCtx.signal;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          if (effectiveSignal.aborted) {
            throw createAbortError();
          }

          await coordCtx.waitForRateLimit();

          if (effectiveSignal.aborted) {
            throw createAbortError();
          }

          const slot = await coordCtx.acquireSlot();
          try {
            const payload = await executeXtreamGetRequest<T>({
              url: targetUrl.toString(),
              timeoutMs,
              signal: effectiveSignal,
              isFullCatalogRequest,
            });
            inspectPayloadForAuthError(payload);
            return payload;
          } catch (err: any) {
            slot.release();

            const isAbort = Boolean(
              effectiveSignal.aborted ||
                err?.isAborted === true ||
                err?.message === "Operação cancelada pelo usuário."
            );

            if (isAbort) {
              throw createAbortError(
                err?.cancellationMode || "physical",
                Boolean(err?.nativeAttemptStillPending)
              );
            }

            const status = typeof err?.status === "number" ? err.status : undefined;
            let effectiveErr: XtreamCategorizedError;

            if (status === 401 && !err?.isAuthError) {
              effectiveErr = isAuthEndpoint
                ? createXtreamAuthError(
                    "Acesso recusado pelo servidor do provedor (HTTP 401). Verifique as credenciais ou a situação da conta.",
                    "http_unauthorized",
                    401
                  )
                : createResourceUnauthorizedError();
            } else if (status === 403) {
              effectiveErr = createHttpError(403) as XtreamCategorizedError;
              effectiveErr.isAuthError = false;
              effectiveErr.requiresAuthRecheck = false;
            } else if (status === 408 && err?.errorCategory !== "http_timeout") {
              effectiveErr = createHttpError(408) as XtreamCategorizedError;
              effectiveErr.isAuthError = false;
            } else if (status === 429 && err?.errorCategory !== "http_rate_limited") {
              effectiveErr = createHttpError(429) as XtreamCategorizedError;
              effectiveErr.isAuthError = false;
              if (
                typeof err?.retryAfterMs === "number" &&
                Number.isFinite(err.retryAfterMs) &&
                err.retryAfterMs >= 0
              ) {
                effectiveErr.retryAfterMs = err.retryAfterMs;
              }
            } else {
              effectiveErr = err as XtreamCategorizedError;
            }

            // Nunca repetir rejeições de autenticação, erros HTTP 4xx (exceto 408/429 tratados acima) ou formato inválido/vazio
            if (
              effectiveErr?.isAuthError ||
              effectiveErr?.isClientError ||
              effectiveErr?.isFatalFormat
            ) {
              throw effectiveErr;
            }

            // Proteção contra sobreposição nativa (CapacitorHttp):
            // nunca iniciar retentativa automática enquanto a tentativa nativa anterior não tiver encerramento confirmado.
            if (
              effectiveErr?.nativeAttemptStillPending === true ||
              effectiveErr?.disallowAutomaticRetry === true
            ) {
              throw effectiveErr;
            }

            // Política controlada de HTTP 429 com coordenação compartilhada por provedor:
            // somente uma nova tentativa quando houver Retry-After válido <= 15s.
            if (effectiveErr?.isRateLimited || effectiveErr?.status === 429) {
              const retryAfterMs = effectiveErr?.retryAfterMs;
              coordCtx.recordRateLimit(retryAfterMs);

              const canRetryRateLimit =
                attempt < maxAttempts &&
                typeof retryAfterMs === "number" &&
                Number.isFinite(retryAfterMs) &&
                retryAfterMs >= 0 &&
                retryAfterMs <= XtreamService.RATE_LIMIT_MAX_RETRY_AFTER_MS;

              if (!canRetryRateLimit) {
                throw effectiveErr;
              }

              const waitMs = Math.max(
                getXtreamCoordinatorRateLimitMinWaitMs(),
                retryAfterMs
              );
              await coordCtx.sleep(waitMs);
              continue;
            }

            if (effectiveErr?.isTransient !== true || attempt >= maxAttempts) {
              throw effectiveErr;
            }

            // Uma única nova tentativa controlada para falhas transitórias (rede, CORS, timeout físico, HTTP 408 ou 5xx)
            await coordCtx.sleep(XtreamService.retryDelayMs);
          } finally {
            slot.release();
          }
        }

        throw new Error("Falha ao comunicar com o servidor do provedor.");
      },
    });
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
      XtreamService.getEffectiveDefaultTimeoutMs(),
      {
        lane: "auth",
        priority: "user",
        ...options,
      }
    );

    if (!isPlainObject(data) || !isPlainObject(data.user_info)) {
      throw createAmbiguousAuthResponseError(
        "Resposta de autenticação inválida ou incompleta recebida do servidor do provedor."
      );
    }

    inspectPayloadForAuthError(data);

    if (!isExplicitAuthSuccessValue(data.user_info.auth)) {
      throw createAmbiguousAuthResponseError(
        "O servidor do provedor não confirmou a autenticação da conta na resposta recebida."
      );
    }

    const normalizedFormats = normalizeAllowedOutputFormats(
      data.user_info.allowed_output_formats
    );
    if (normalizedFormats !== undefined) {
      return {
        ...data,
        user_info: {
          ...data.user_info,
          allowed_output_formats: normalizedFormats,
        },
      } as XtreamAuthResponse;
    }

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
      XtreamService.getEffectiveDefaultTimeoutMs(),
      { lane: "catalog", ...options }
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
      XtreamService.getEffectiveCatalogTimeoutMs(),
      { lane: "catalog", ...options }
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
      XtreamService.getEffectiveDefaultTimeoutMs(),
      { lane: "catalog", ...options }
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
      XtreamService.getEffectiveCatalogTimeoutMs(),
      { lane: "catalog", ...options }
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
  ): Promise<XtreamVodInfoResponse> {
    return this.request<XtreamVodInfoResponse>(
      credentials,
      "get_vod_info",
      { vod_id: String(vodId) },
      XtreamService.getEffectiveDefaultTimeoutMs(),
      { lane: "details", priority: "user", ...options }
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
      XtreamService.getEffectiveDefaultTimeoutMs(),
      { lane: "catalog", ...options }
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
      XtreamService.getEffectiveCatalogTimeoutMs(),
      { lane: "catalog", ...options }
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
  ): Promise<XtreamSeriesInfoResponse> {
    return this.request<XtreamSeriesInfoResponse>(
      credentials,
      "get_series_info",
      { series_id: String(seriesId) },
      XtreamService.getEffectiveDefaultTimeoutMs(),
      { lane: "details", priority: "user", ...options }
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
      XtreamService.getEffectiveDefaultTimeoutMs(),
      { lane: "epg", priority: "normal", ...options }
    );
  }
}
