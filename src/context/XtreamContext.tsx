import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
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
  liveError: string | null;
  vodError: string | null;
  seriesError: string | null;
  categoriesError: string | null;
  fetchLiveStreams: (categoryId?: string) => Promise<void>;
  fetchVodStreams: (categoryId?: string) => Promise<void>;
  fetchSeriesStreams: (categoryId?: string) => Promise<void>;
  retryCategories: () => Promise<void>;
}

export const XtreamContext = createContext<XtreamContextData | undefined>(undefined);

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
  const [liveError, setLiveError] = useState<string | null>(null);
  const [vodError, setVodError] = useState<string | null>(null);
  const [seriesError, setSeriesError] = useState<string | null>(null);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);

  // Backward-compatible global error: displays any active error
  const error = liveError || vodError || seriesError || categoriesError;

  // In-flight promise references to prevent concurrent duplicate full-catalog fetches
  const inFlightLiveRef = useRef<Promise<void> | null>(null);
  const inFlightVodRef = useRef<Promise<void> | null>(null);
  const inFlightSeriesRef = useRef<Promise<void> | null>(null);

  // Catalog loaded flags to distinguish truly empty catalogs from not yet fetched
  const [loadedLiveCatalog, setLoadedLiveCatalog] = useState(false);
  const [loadedVodCatalog, setLoadedVodCatalog] = useState(false);
  const [loadedSeriesCatalog, setLoadedSeriesCatalog] = useState(false);

  // Initial fetch / retry of categories
  const retryCategories = useCallback(async () => {
    if (!credentials) return;
    setCategoriesError(null);

    const [liveRes, vodRes, seriesRes] = await Promise.allSettled([
      XtreamService.getLiveCategories(credentials),
      XtreamService.getVodCategories(credentials),
      XtreamService.getSeriesCategories(credentials),
    ]);

    let hadError = false;
    let errorMsg = '';

    if (liveRes.status === 'fulfilled') {
      setLiveCategories(liveRes.value);
    } else {
      hadError = true;
      errorMsg = liveRes.reason?.message || 'Falha ao carregar categorias de TV.';
    }

    if (vodRes.status === 'fulfilled') {
      setVodCategories(vodRes.value);
    } else {
      hadError = true;
      errorMsg = vodRes.reason?.message || 'Falha ao carregar categorias de filmes.';
    }

    if (seriesRes.status === 'fulfilled') {
      setSeriesCategories(seriesRes.value);
    } else {
      hadError = true;
      errorMsg = seriesRes.reason?.message || 'Falha ao carregar categorias de séries.';
    }

    if (hadError) {
      setCategoriesError(errorMsg);
    }
  }, [credentials]);

  useEffect(() => {
    if (credentials) {
      retryCategories();
    }
  }, [credentials, retryCategories]);

  const [allLiveStreams, setAllLiveStreams] = useState<LiveStream[]>([]);
  const [allVodStreams, setAllVodStreams] = useState<VodStream[]>([]);
  const [allSeriesStreams, setAllSeriesStreams] = useState<SeriesStream[]>([]);

  const fetchLiveStreams = useCallback(async (categoryId?: string) => {
    if (!credentials) return;
    
    // If we already have the full catalog loaded, just filter locally.
    if (loadedLiveCatalog) {
      if (categoryId) {
        setLiveStreams(allLiveStreams.filter(s => String(s.category_id) === String(categoryId)));
      } else {
        setLiveStreams(allLiveStreams);
      }
      return;
    }

    // If a full-catalog fetch is already in flight, reuse it
    if (inFlightLiveRef.current) {
      try {
        await inFlightLiveRef.current;
      } catch {
        // Handled in the original call
      }
      return;
    }

    setLoadingLive(true);
    setLiveError(null);

    const promise = (async () => {
      try {
        const streams = await XtreamService.getLiveStreams(credentials);
        setAllLiveStreams(streams);
        setLoadedLiveCatalog(true);
        
        if (categoryId) {
          setLiveStreams(streams.filter(s => String(s.category_id) === String(categoryId)));
        } else {
          setLiveStreams(streams);
        }
      } catch (err: any) {
        setLiveError(err.message || "Failed to load live streams.");
      } finally {
        setLoadingLive(false);
        inFlightLiveRef.current = null;
      }
    })();

    inFlightLiveRef.current = promise;
    await promise;
  }, [credentials, loadedLiveCatalog, allLiveStreams]);

  const fetchVodStreams = useCallback(async (categoryId?: string) => {
    if (!credentials) return;

    if (loadedVodCatalog) {
      if (categoryId) {
        setVodStreams(allVodStreams.filter(s => String(s.category_id) === String(categoryId)));
      } else {
        setVodStreams(allVodStreams);
      }
      return;
    }

    if (inFlightVodRef.current) {
      try {
        await inFlightVodRef.current;
      } catch {
        // Handled in original call
      }
      return;
    }

    setLoadingVod(true);
    setVodError(null);

    const promise = (async () => {
      try {
        const streams = await XtreamService.getVodStreams(credentials);
        setAllVodStreams(streams);
        setLoadedVodCatalog(true);
        
        if (categoryId) {
          setVodStreams(streams.filter(s => String(s.category_id) === String(categoryId)));
        } else {
          setVodStreams(streams);
        }
      } catch (err: any) {
        setVodError(err.message || "Failed to load movies.");
      } finally {
        setLoadingVod(false);
        inFlightVodRef.current = null;
      }
    })();

    inFlightVodRef.current = promise;
    await promise;
  }, [credentials, loadedVodCatalog, allVodStreams]);

  const fetchSeriesStreams = useCallback(async (categoryId?: string) => {
    if (!credentials) return;
    
    if (loadedSeriesCatalog) {
      if (categoryId) {
        setSeriesStreams(allSeriesStreams.filter(s => String(s.category_id) === String(categoryId)));
      } else {
        setSeriesStreams(allSeriesStreams);
      }
      return;
    }

    if (inFlightSeriesRef.current) {
      try {
        await inFlightSeriesRef.current;
      } catch {
        // Handled in original call
      }
      return;
    }

    setLoadingSeries(true);
    setSeriesError(null);

    const promise = (async () => {
      try {
        const streams = await XtreamService.getSeries(credentials);
        setAllSeriesStreams(streams);
        setLoadedSeriesCatalog(true);
        
        if (categoryId) {
          setSeriesStreams(streams.filter(s => String(s.category_id) === String(categoryId)));
        } else {
          setSeriesStreams(streams);
        }
      } catch (err: any) {
        setSeriesError(err.message || "Failed to load series.");
      } finally {
        setLoadingSeries(false);
        inFlightSeriesRef.current = null;
      }
    })();

    inFlightSeriesRef.current = promise;
    await promise;
  }, [credentials, loadedSeriesCatalog, allSeriesStreams]);

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
      liveError,
      vodError,
      seriesError,
      categoriesError,
      fetchLiveStreams,
      fetchVodStreams,
      fetchSeriesStreams,
      retryCategories,
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
