import { validateTargetUrl, XtreamError } from "./ssrf";

export const ALLOWED_ACTIONS: Record<string, string[]> = {
  auth: [],
  get_live_categories: [],
  get_live_streams: ["category_id"],
  get_vod_categories: [],
  get_vod_streams: ["category_id"],
  get_vod_info: ["vod_id"],
  get_series_categories: [],
  get_series: ["category_id"],
  get_series_info: ["series_id"],
  get_short_epg: ["stream_id", "limit"],
};

const MAX_RESPONSE_SIZE = 25 * 1024 * 1024; // 25 MB
const REQUEST_TIMEOUT_MS = 15000; // 15 seconds
const MAX_REDIRECTS = 5;

// In-memory rate limiter per IP: max 120 requests per 60 seconds
interface RateLimitBucket {
  count: number;
  resetAt: number;
}
const rateLimitMap = new Map<string, RateLimitBucket>();

// Periodic cleanup of expired rate limit entries
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateLimitMap.entries()) {
    if (now > bucket.resetAt) {
      rateLimitMap.delete(ip);
    }
  }
}, 60000).unref();

export function checkRateLimit(clientIp: string, maxRequests = 120, windowMs = 60000): void {
  const now = Date.now();
  const bucket = rateLimitMap.get(clientIp);

  if (!bucket || now > bucket.resetAt) {
    rateLimitMap.set(clientIp, { count: 1, resetAt: now + windowMs });
    return;
  }

  bucket.count += 1;
  if (bucket.count > maxRequests) {
    throw new XtreamError(
      "RATE_LIMITED",
      "Limite de requisições excedido. Por favor, aguarde alguns instantes.",
      429
    );
  }
}

/**
 * Sanitizes URLs to redact passwords before any potential log.
 */
export function sanitizeForLogs(urlOrText: string): string {
  return urlOrText
    .replace(/(password=)[^&]*/gi, "$1***")
    .replace(/(username=)[^&]*/gi, "$1***")
    .replace(/(\/movie\/[^\/]+\/)[^\/]+/gi, "$1***")
    .replace(/(\/series\/[^\/]+\/)[^\/]+/gi, "$1***")
    .replace(/(\/live\/[^\/]+\/)[^\/]+/gi, "$1***");
}

export interface XtreamProxyRequestOptions {
  serverUrl: string;
  username: string;
  password: string;
  action?: string;
  params?: Record<string, string | number>;
  allowPrivateForTest?: boolean;
}

/**
 * Reads a response stream up to MAX_RESPONSE_SIZE bytes.
 */
async function readLimitedResponse(response: Response, maxSize: number): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > maxSize) {
    throw new XtreamError(
      "INVALID_RESPONSE",
      "A resposta do servidor Xtream ultrapassou o limite máximo de 25MB.",
      502
    );
  }

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.length;
        if (totalBytes > maxSize) {
          await reader.cancel();
          throw new XtreamError(
            "INVALID_RESPONSE",
            "A resposta do servidor Xtream ultrapassou o limite máximo de 25MB.",
            502
          );
        }
        chunks.push(value);
      }
    }
  } catch (err) {
    if (err instanceof XtreamError) throw err;
    throw new XtreamError(
      "CONNECTION_FAILED",
      "Falha durante a leitura dos dados do servidor Xtream.",
      502
    );
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder("utf-8").decode(merged);
}

/**
 * Safely executes an Xtream query against player_api.php:
 * - Validates action against strict allowlist
 * - Validates input parameters
 * - Validates target server URL against SSRF
 * - Handles redirects manually with re-validation of new targets
 * - Implements timeouts and response size caps
 * - Validates authentication response structure (including auth: "0" and auth: 0)
 */
export async function executeXtreamQuery(options: XtreamProxyRequestOptions): Promise<any> {
  const { serverUrl, username, password, action = "auth", params = {}, allowPrivateForTest = false } = options;

  if (!serverUrl || typeof serverUrl !== "string") {
    throw new XtreamError("INVALID_REQUEST", "URL do servidor não informada.", 400);
  }
  if (!username || typeof username !== "string") {
    throw new XtreamError("INVALID_REQUEST", "Usuário não informado.", 400);
  }
  if (!password || typeof password !== "string") {
    throw new XtreamError("INVALID_REQUEST", "Senha não informada.", 400);
  }

  // 1. Validate action against allowlist
  const normalizedAction = action || "auth";
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_ACTIONS, normalizedAction)) {
    throw new XtreamError("INVALID_ACTION", `Ação "${action}" não é permitida.`, 400);
  }

  const allowedParamNames = ALLOWED_ACTIONS[normalizedAction];
  const sanitizedParams: Record<string, string> = {};

  if (params && typeof params === "object") {
    for (const [key, value] of Object.entries(params)) {
      if (allowedParamNames.includes(key)) {
        const strVal = String(value).trim();
        // Allow alphanumeric, dashes, underscores
        if (!/^[a-zA-Z0-9_\-.]+$/.test(strVal)) {
          throw new XtreamError("INVALID_REQUEST", `Parâmetro "${key}" contém caracteres inválidos.`, 400);
        }
        sanitizedParams[key] = strVal;
      }
    }
  }

  // 2. Initial SSRF validation of serverUrl
  const { cleanBaseUrl } = await validateTargetUrl(serverUrl, { allowPrivateForTest });

  // 3. Build the Xtream endpoint: strictly player_api.php
  const targetUrl = new URL("/player_api.php", cleanBaseUrl);
  targetUrl.searchParams.set("username", username);
  targetUrl.searchParams.set("password", password);

  if (normalizedAction !== "auth") {
    targetUrl.searchParams.set("action", normalizedAction);
    for (const [k, v] of Object.entries(sanitizedParams)) {
      targetUrl.searchParams.set(k, v);
    }
  }

  // 4. Execute request with manual redirect following & SSRF checks
  let currentUrl = targetUrl;
  let redirectsCount = 0;
  let responseText = "";

  while (redirectsCount <= MAX_REDIRECTS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(currentUrl.toString(), {
        method: "GET",
        headers: {
          "User-Agent": "NorthCodePlay/1.0",
          Accept: "application/json, text/plain, */*",
        },
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError" || controller.signal.aborted) {
        throw new XtreamError("TIMEOUT", "Tempo limite de conexão com o servidor esgotado.", 504);
      }
      throw new XtreamError(
        "CONNECTION_FAILED",
        "Falha ao conectar com o servidor Xtream. Verifique o endereço e a porta.",
        502
      );
    } finally {
      clearTimeout(timeoutId);
    }

    // Handle Redirects
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      redirectsCount++;
      if (redirectsCount > MAX_REDIRECTS) {
        throw new XtreamError("INVALID_RESPONSE", "Número excessivo de redirecionamentos do servidor.", 502);
      }

      const locationHeader = res.headers.get("location");
      if (!locationHeader) {
        throw new XtreamError("INVALID_RESPONSE", "Redirecionamento sem cabeçalho Location.", 502);
      }

      let nextUrl: URL;
      try {
        nextUrl = new URL(locationHeader, currentUrl);
      } catch {
        throw new XtreamError("INVALID_RESPONSE", "URL de redirecionamento inválida.", 502);
      }

      // Re-validate the redirect target against SSRF!
      await validateTargetUrl(nextUrl.toString(), { allowPrivateForTest });

      currentUrl = nextUrl;
      continue;
    }

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new XtreamError("INVALID_CREDENTIALS", "Usuário ou senha incorretos.", 401);
      }
      throw new XtreamError(
        "CONNECTION_FAILED",
        `Servidor Xtream retornou erro HTTP ${res.status}.`,
        502
      );
    }

    // Read body safely with limit
    responseText = await readLimitedResponse(res, MAX_RESPONSE_SIZE);
    break;
  }

  // 5. Parse response JSON
  let data: any;
  try {
    data = JSON.parse(responseText);
  } catch {
    // If it is not valid JSON, it might be an HTML error page or empty response
    throw new XtreamError(
      "INVALID_RESPONSE",
      "O servidor Xtream retornou uma resposta que não está em formato JSON válido.",
      502
    );
  }

  // 6. Validate authentication response if action is "auth"
  if (normalizedAction === "auth") {
    if (!data || typeof data !== "object") {
      throw new XtreamError("INVALID_RESPONSE", "Resposta de autenticação inválida.", 502);
    }

    const userInfo = data.user_info;
    if (!userInfo || typeof userInfo !== "object") {
      throw new XtreamError("INVALID_CREDENTIALS", "Usuário ou senha inválidos.", 401);
    }

    const auth = userInfo.auth;
    // Check if auth is 0 or "0" or false, or status is disabled
    const isZeroAuth = auth === 0 || auth === "0" || auth === false || auth === "false";
    const isDisabled = userInfo.status && typeof userInfo.status === "string" && ["disabled", "expired", "banned"].includes(userInfo.status.toLowerCase());

    if (isZeroAuth || isDisabled) {
      throw new XtreamError(
        "INVALID_CREDENTIALS",
        "Usuário ou senha inválidos ou conta desativada.",
        401
      );
    }
  }

  return data;
}
