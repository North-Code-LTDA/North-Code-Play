import { Category, LiveStream, VodStream, SeriesStream, XtreamAuthResponse, XtreamCredentials } from "../types";

export class XtreamService {
  /**
   * Helper function to perform same-origin calls to the Express Xtream proxy
   */
  private static async request<T = any>(
    credentials: XtreamCredentials,
    action: string,
    params: Record<string, string | number> = {}
  ): Promise<T> {
    const cleanServerUrl = (credentials.serverUrl || "").trim().replace(/\/+$/, "");

    const response = await fetch("/api/xtream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        serverUrl: cleanServerUrl,
        username: credentials.username,
        password: credentials.password,
        action,
        params,
      }),
    });

    if (!response.ok) {
      let errorMessage = `Erro de conexão (${response.status})`;
      try {
        const errJson = await response.json();
        if (errJson && errJson.message) {
          errorMessage = errJson.message;
        }
      } catch {
        // Fallback message
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();
    return data as T;
  }

  /**
   * 1. Authenticate user and retrieve general account/server properties.
   */
  static async authenticate(credentials: XtreamCredentials): Promise<XtreamAuthResponse> {
    const data = await this.request<XtreamAuthResponse>(credentials, "auth");

    if (!data || !data.user_info) {
      throw new Error("Usuário ou senha inválidos.");
    }

    const auth = data.user_info.auth;
    // Validate auth: must not be 0, "0", or false
    if (auth === 0 || auth === "0" || String(auth) === "0") {
      throw new Error("Usuário ou senha inválidos ou conta desativada.");
    }

    if (
      data.user_info.status &&
      ["disabled", "expired", "banned"].includes(data.user_info.status.toLowerCase())
    ) {
      throw new Error("Conta de usuário desativada ou expirada.");
    }

    return data;
  }

  /**
   * Fetch Live Categories
   */
  static async getLiveCategories(credentials: XtreamCredentials): Promise<Category[]> {
    const data = await this.request<Category[]>(credentials, "get_live_categories");
    return Array.isArray(data) ? data : [];
  }

  /**
   * Fetch Live Streams
   */
  static async getLiveStreams(credentials: XtreamCredentials, categoryId?: string): Promise<LiveStream[]> {
    const params = categoryId ? { category_id: categoryId } : {};
    const data = await this.request<LiveStream[]>(credentials, "get_live_streams", params);
    return Array.isArray(data) ? data : [];
  }

  /**
   * Fetch VOD Categories
   */
  static async getVodCategories(credentials: XtreamCredentials): Promise<Category[]> {
    const data = await this.request<Category[]>(credentials, "get_vod_categories");
    return Array.isArray(data) ? data : [];
  }

  /**
   * Fetch VOD Streams
   */
  static async getVodStreams(credentials: XtreamCredentials, categoryId?: string): Promise<VodStream[]> {
    const params = categoryId ? { category_id: categoryId } : {};
    const data = await this.request<VodStream[]>(credentials, "get_vod_streams", params);
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
    const data = await this.request<Category[]>(credentials, "get_series_categories");
    return Array.isArray(data) ? data : [];
  }

  /**
   * Fetch Series
   */
  static async getSeries(credentials: XtreamCredentials, categoryId?: string): Promise<SeriesStream[]> {
    const params = categoryId ? { category_id: categoryId } : {};
    const data = await this.request<SeriesStream[]>(credentials, "get_series", params);
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
