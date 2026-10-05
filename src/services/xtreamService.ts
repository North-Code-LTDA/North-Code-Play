import {
  Category,
  LiveStream,
  VodStream,
  SeriesStream,
  XtreamAuthResponse,
  XtreamCredentials,
} from "../types";
import { normalizeServerUrl } from "../utils/mediaUtils";

export class XtreamService {
  /**
   * Performs direct HTTP/HTTPS GET requests from the user's browser directly to the Xtream provider.
   * Uses URL and URLSearchParams to construct the query string.
   */
  private static async request<T = any>(
    credentials: XtreamCredentials,
    action?: string,
    params: Record<string, string | number> = {},
    timeoutMs: number = 25000
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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(targetUrl.toString(), {
        method: "GET",
        signal: controller.signal,
      });
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        throw new Error(
          "Tempo limite esgotado ao aguardar resposta do servidor do provedor."
        );
      }
      // Standard browser network error (often caused by CORS restrictions on the provider or mixed content)
      throw new Error(
        "Falha de rede ou bloqueio de CORS ao comunicar diretamente com o provedor. " +
          "Verifique se o servidor está online e se permite requisições da web."
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new Error(
        `O servidor do provedor retornou HTTP ${response.status} (${response.statusText || "Erro"}).`
      );
    }

    let textData: string;
    try {
      textData = await response.text();
    } catch {
      throw new Error("Falha ao ler os dados da resposta do provedor.");
    }

    if (!textData || !textData.trim()) {
      return [] as unknown as T;
    }

    try {
      return JSON.parse(textData) as T;
    } catch {
      throw new Error(
        "O provedor retornou uma resposta em formato inválido (não é um JSON válido)."
      );
    }
  }

  /**
   * 1. Authenticate user and retrieve general account/server properties.
   * Calls player_api.php?username=...&password=... without action.
   */
  static async authenticate(credentials: XtreamCredentials): Promise<XtreamAuthResponse> {
    const data = await this.request<any>(credentials);

    if (!data || typeof data !== "object") {
      throw new Error("Resposta inválida recebida do servidor do provedor.");
    }

    if (!data.user_info) {
      throw new Error("Usuário ou senha incorretos ou resposta inesperada do provedor.");
    }

    const auth = data.user_info.auth;
    // Validate auth: must not be 0, "0", or false
    if (auth === 0 || auth === "0" || auth === false || String(auth) === "0") {
      throw new Error("Usuário ou senha inválidos ou conta desativada.");
    }

    if (
      data.user_info.status &&
      ["disabled", "expired", "banned"].includes(String(data.user_info.status).toLowerCase())
    ) {
      throw new Error("Conta de usuário desativada ou expirada.");
    }

    return data as XtreamAuthResponse;
  }

  /**
   * Fetch Live Categories
   */
  static async getLiveCategories(credentials: XtreamCredentials): Promise<Category[]> {
    const data = await this.request<any>(credentials, "get_live_categories");
    return Array.isArray(data) ? data : [];
  }

  /**
   * Fetch Live Streams
   */
  static async getLiveStreams(credentials: XtreamCredentials, categoryId?: string): Promise<LiveStream[]> {
    const params = categoryId ? { category_id: categoryId } : {};
    const data = await this.request<any>(credentials, "get_live_streams", params);
    return Array.isArray(data) ? data : [];
  }

  /**
   * Fetch VOD Categories
   */
  static async getVodCategories(credentials: XtreamCredentials): Promise<Category[]> {
    const data = await this.request<any>(credentials, "get_vod_categories");
    return Array.isArray(data) ? data : [];
  }

  /**
   * Fetch VOD Streams
   */
  static async getVodStreams(credentials: XtreamCredentials, categoryId?: string): Promise<VodStream[]> {
    const params = categoryId ? { category_id: categoryId } : {};
    const data = await this.request<any>(credentials, "get_vod_streams", params);
    return Array.isArray(data) ? data : [];
  }

  /**
   * Fetch VOD Info
   */
  static async getVodInfo(credentials: XtreamCredentials, vodId: string | number): Promise<any> {
    const data = await this.request<any>(credentials, "get_vod_info", { vod_id: String(vodId) });
    return data;
  }

  /**
   * Fetch Series Categories
   */
  static async getSeriesCategories(credentials: XtreamCredentials): Promise<Category[]> {
    const data = await this.request<any>(credentials, "get_series_categories");
    return Array.isArray(data) ? data : [];
  }

  /**
   * Fetch Series
   */
  static async getSeries(credentials: XtreamCredentials, categoryId?: string): Promise<SeriesStream[]> {
    const params = categoryId ? { category_id: categoryId } : {};
    const data = await this.request<any>(credentials, "get_series", params);
    return Array.isArray(data) ? data : [];
  }

  /**
   * Fetch Series Info (Episodes, Seasons, Details)
   */
  static async getSeriesInfo(credentials: XtreamCredentials, seriesId: string | number): Promise<any> {
    const data = await this.request<any>(credentials, "get_series_info", { series_id: String(seriesId) });
    return data;
  }

  /**
   * Fetch Short EPG for a stream
   */
  static async getShortEpg(credentials: XtreamCredentials, streamId: string | number, limit: number = 10): Promise<any> {
    const data = await this.request<any>(credentials, "get_short_epg", {
      stream_id: String(streamId),
      limit: String(limit),
    });
    return data;
  }
}
