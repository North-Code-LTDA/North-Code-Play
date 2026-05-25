import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { XtreamCredentials, Category, LiveStream, VodStream, SeriesStream } from "../types";
import { XtreamService } from "../services/xtreamService";

interface XtreamContextData {
  credentials: XtreamCredentials | null;
  liveCategories: Category[];
  liveStreams: LiveStream[];
  vodCategories: Category[];
  vodStreams: VodStream[];
  seriesCategories: Category[];
  seriesStreams: SeriesStream[];
  loadingLive: boolean;
  loadingVod: boolean;
  loadingSeries: boolean;
  error: string | null;
  fetchLiveStreams: (categoryId?: string) => Promise<void>;
  fetchVodStreams: (categoryId?: string) => Promise<void>;
  fetchSeriesStreams: (categoryId?: string) => Promise<void>;
}

const XtreamContext = createContext<XtreamContextData | undefined>(undefined);

export function XtreamProvider({ children, credentials }: { children: React.ReactNode; credentials: XtreamCredentials | null }) {
  const [liveCategories, setLiveCategories] = useState<Category[]>([]);
  const [liveStreams, setLiveStreams] = useState<LiveStream[]>([]);
  const [vodCategories, setVodCategories] = useState<Category[]>([]);
  const [vodStreams, setVodStreams] = useState<VodStream[]>([]);
  const [seriesCategories, setSeriesCategories] = useState<Category[]>([]);
  const [seriesStreams, setSeriesStreams] = useState<SeriesStream[]>([]);

  const [loadingLive, setLoadingLive] = useState(false);
  const [loadingVod, setLoadingVod] = useState(false);
  const [loadingSeries, setLoadingSeries] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initial fetch of categories
  useEffect(() => {
    if (!credentials) return;

    const fetchInitialData = async () => {
      try {
        setError(null);
        // We can fetch categories simultaneously
        const [liveCat, vodCat, seriesCat] = await Promise.all([
          XtreamService.getLiveCategories(credentials).catch(() => []),
          XtreamService.getVodCategories(credentials).catch(() => []),
          XtreamService.getSeriesCategories(credentials).catch(() => []),
        ]);
        setLiveCategories(liveCat);
        setVodCategories(vodCat);
        setSeriesCategories(seriesCat);
      } catch (err: any) {
        setError(err.message || "Failed to load categories.");
      }
    };

    fetchInitialData();
  }, [credentials]);

  const fetchLiveStreams = useCallback(async (categoryId?: string) => {
    if (!credentials) return;
    setLoadingLive(true);
    try {
      const streams = await XtreamService.getLiveStreams(credentials, categoryId);
      setLiveStreams(streams);
    } catch (err: any) {
      setError(err.message || "Failed to load live streams.");
    } finally {
      setLoadingLive(false);
    }
  }, [credentials]);

  const fetchVodStreams = useCallback(async (categoryId?: string) => {
    if (!credentials) return;
    setLoadingVod(true);
    try {
      const streams = await XtreamService.getVodStreams(credentials, categoryId);
      setVodStreams(streams);
    } catch (err: any) {
      setError(err.message || "Failed to load movies.");
    } finally {
      setLoadingVod(false);
    }
  }, [credentials]);

  const fetchSeriesStreams = useCallback(async (categoryId?: string) => {
    if (!credentials) return;
    setLoadingSeries(true);
    try {
      const streams = await XtreamService.getSeries(credentials, categoryId);
      setSeriesStreams(streams);
    } catch (err: any) {
      setError(err.message || "Failed to load series.");
    } finally {
      setLoadingSeries(false);
    }
  }, [credentials]);

  // Initial fetch of streams (All)
  // Removed automatic fetching to prevent memory issues with massive lists.
  // Streams should be fetched per-category by the respective views.

  return (
    <XtreamContext.Provider value={{
      credentials,
      liveCategories,
      liveStreams,
      vodCategories,
      vodStreams,
      seriesCategories,
      seriesStreams,
      loadingLive,
      loadingVod,
      loadingSeries,
      error,
      fetchLiveStreams,
      fetchVodStreams,
      fetchSeriesStreams,
    }}>
      {children}
    </XtreamContext.Provider>
  );
}

export function useXtreamContext() {
  const context = useContext(XtreamContext);
  if (context === undefined) {
    throw new Error("useXtreamContext must be used within a XtreamProvider");
  }
  return context;
}
