import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { XtreamCredentials, Category, LiveStream, VodStream, SeriesStream } from "../types";
import { XtreamService } from "../services/xtreamService";

interface XtreamContextData {
  credentials: XtreamCredentials | null;
  liveCategories: Category[];
  liveStreams: LiveStream[];
  allLiveStreams: LiveStream[];
  vodCategories: Category[];
  vodStreams: VodStream[];
  allVodStreams: VodStream[];
  seriesCategories: Category[];
  seriesStreams: SeriesStream[];
  allSeriesStreams: SeriesStream[];
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

  const [allLiveStreams, setAllLiveStreams] = useState<LiveStream[]>([]);
  const [allVodStreams, setAllVodStreams] = useState<VodStream[]>([]);
  const [allSeriesStreams, setAllSeriesStreams] = useState<SeriesStream[]>([]);

  const fetchLiveStreams = useCallback(async (categoryId?: string) => {
    if (!credentials) return;
    
    // If we already have ALL streams loaded, just filter locally.
    if (allLiveStreams.length > 0) {
      if (categoryId) {
        setLiveStreams(allLiveStreams.filter(s => String(s.category_id) === String(categoryId)));
      } else {
        setLiveStreams(allLiveStreams);
      }
      return;
    }

    setLoadingLive(true);
    try {
      // First try to fetch ALL if no category is specified, or if we want to cache all
      // Actually, let's always fetch ALL streams once, since it makes search possible across all categories.
      const streams = await XtreamService.getLiveStreams(credentials);
      setAllLiveStreams(streams);
      
      if (categoryId) {
        setLiveStreams(streams.filter(s => String(s.category_id) === String(categoryId)));
      } else {
        setLiveStreams(streams);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load live streams.");
    } finally {
      setLoadingLive(false);
    }
  }, [credentials, allLiveStreams]);

  const fetchVodStreams = useCallback(async (categoryId?: string) => {
    if (!credentials) return;

    if (allVodStreams.length > 0) {
      if (categoryId) {
        setVodStreams(allVodStreams.filter(s => String(s.category_id) === String(categoryId)));
      } else {
        setVodStreams(allVodStreams);
      }
      return;
    }

    setLoadingVod(true);
    try {
      const streams = await XtreamService.getVodStreams(credentials);
      setAllVodStreams(streams);
      
      if (categoryId) {
        setVodStreams(streams.filter(s => String(s.category_id) === String(categoryId)));
      } else {
        setVodStreams(streams);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load movies.");
    } finally {
      setLoadingVod(false);
    }
  }, [credentials, allVodStreams]);

  const fetchSeriesStreams = useCallback(async (categoryId?: string) => {
    if (!credentials) return;
    
    if (allSeriesStreams.length > 0) {
      if (categoryId) {
        setSeriesStreams(allSeriesStreams.filter(s => String(s.category_id) === String(categoryId)));
      } else {
        setSeriesStreams(allSeriesStreams);
      }
      return;
    }

    setLoadingSeries(true);
    try {
      const streams = await XtreamService.getSeries(credentials);
      setAllSeriesStreams(streams);
      
      if (categoryId) {
        setSeriesStreams(streams.filter(s => String(s.category_id) === String(categoryId)));
      } else {
        setSeriesStreams(streams);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load series.");
    } finally {
      setLoadingSeries(false);
    }
  }, [credentials, allSeriesStreams]);

  // Provide the all... streams to the context

  // Removed automatic fetching to prevent memory issues with massive lists.
  // Streams should be fetched per-category by the respective views.

  return (
    <XtreamContext.Provider value={{
      credentials,
      liveCategories,
      liveStreams,
      allLiveStreams,
      vodCategories,
      vodStreams,
      allVodStreams,
      seriesCategories,
      seriesStreams,
      allSeriesStreams,
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
