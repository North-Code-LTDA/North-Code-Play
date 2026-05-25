import { Category, LiveStream, VodStream, SeriesStream, XtreamAuthResponse, XtreamCredentials } from "../types";

export class XtreamService {
  /**
   * Helper function to build the proxied URL for the Xtream API
   */
  private static buildUrl(credentials: XtreamCredentials, action?: string, extraParams: Record<string, string> = {}): string {
    // Ensure no trailing slash
    const baseUrl = credentials.serverUrl.endsWith("/")
      ? credentials.serverUrl.slice(0, -1)
      : credentials.serverUrl;

    const url = new URL(`${baseUrl}/player_api.php`);
    url.searchParams.append("username", credentials.username);
    url.searchParams.append("password", credentials.password);

    if (action) {
      url.searchParams.append("action", action);
    }

    // Append any extra params required
    for (const [key, value] of Object.entries(extraParams)) {
      url.searchParams.append(key, value);
    }

    // Proxy the request through our backend to evade CORS
    return `/api/proxy?url=${encodeURIComponent(url.toString())}`;
  }

  /**
   * 1. Authenticate user and retrieve general account/server properties.
   */
  static async authenticate(credentials: XtreamCredentials): Promise<XtreamAuthResponse> {
    const proxyUrl = this.buildUrl(credentials);
    const response = await fetch(proxyUrl);
    
    if (!response.ok) {
      throw new Error(`Failed to connect. Server responded with status ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.user_info || data.user_info.auth === 0) {
      throw new Error("Authentication failed: Invalid username or password, or server is unreachable.");
    }
    
    return data as XtreamAuthResponse;
  }

  /**
   * Fetch Live Categories
   */
  static async getLiveCategories(credentials: XtreamCredentials): Promise<Category[]> {
    const proxyUrl = this.buildUrl(credentials, "get_live_categories");
    const response = await fetch(proxyUrl);
    if (!response.ok) throw new Error("Failed to fetch live categories");
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  }

  /**
   * Fetch Live Streams
   */
  static async getLiveStreams(credentials: XtreamCredentials, categoryId?: string): Promise<LiveStream[]> {
    const extraParams = categoryId ? { category_id: categoryId } : {};
    const proxyUrl = this.buildUrl(credentials, "get_live_streams", extraParams);
    const response = await fetch(proxyUrl);
    if (!response.ok) throw new Error("Failed to fetch live streams");
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  }

  /**
   * Fetch VOD Categories
   */
  static async getVodCategories(credentials: XtreamCredentials): Promise<Category[]> {
    const proxyUrl = this.buildUrl(credentials, "get_vod_categories");
    const response = await fetch(proxyUrl);
    if (!response.ok) throw new Error("Failed to fetch VOD categories");
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  }

  /**
   * Fetch VOD Streams
   */
  static async getVodStreams(credentials: XtreamCredentials, categoryId?: string): Promise<VodStream[]> {
    const extraParams = categoryId ? { category_id: categoryId } : {};
    const proxyUrl = this.buildUrl(credentials, "get_vod_streams", extraParams);
    const response = await fetch(proxyUrl);
    if (!response.ok) throw new Error("Failed to fetch VOD streams");
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  }

  /**
   * Fetch VOD Info
   */
  static async getVodInfo(credentials: XtreamCredentials, vodId: string | number): Promise<any> {
    const proxyUrl = this.buildUrl(credentials, "get_vod_info", { vod_id: String(vodId) });
    const response = await fetch(proxyUrl);
    if (!response.ok) throw new Error("Failed to fetch VOD Info");
    const data = await response.json();
    return data;
  }

  /**
   * Fetch Series Categories
   */
  static async getSeriesCategories(credentials: XtreamCredentials): Promise<Category[]> {
    const proxyUrl = this.buildUrl(credentials, "get_series_categories");
    const response = await fetch(proxyUrl);
    if (!response.ok) throw new Error("Failed to fetch Series categories");
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  }

  /**
   * Fetch Series
   */
  static async getSeries(credentials: XtreamCredentials, categoryId?: string): Promise<SeriesStream[]> {
    const extraParams = categoryId ? { category_id: categoryId } : {};
    const proxyUrl = this.buildUrl(credentials, "get_series", extraParams);
    const response = await fetch(proxyUrl);
    if (!response.ok) throw new Error("Failed to fetch Series");
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  }

  /**
   * Fetch Series Info (Episodes, Seasons, Details)
   */
  static async getSeriesInfo(credentials: XtreamCredentials, seriesId: string | number): Promise<any> {
    const proxyUrl = this.buildUrl(credentials, "get_series_info", { series_id: String(seriesId) });
    const response = await fetch(proxyUrl);
    if (!response.ok) throw new Error("Failed to fetch Series Info");
    // Some endpoints return direct object, sometimes wrapped
    const data = await response.json();
    return data;
  }

  /**
   * Fetch Short EPG for a stream
   */
  static async getShortEpg(credentials: XtreamCredentials, streamId: string | number, limit: number = 10): Promise<any> {
    const proxyUrl = this.buildUrl(credentials, "get_short_epg", { stream_id: String(streamId), limit: String(limit) });
    const response = await fetch(proxyUrl);
    if (!response.ok) throw new Error("Failed to fetch EPG");
    const data = await response.json();
    return data;
  }
}
