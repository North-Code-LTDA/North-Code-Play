import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import {
  XtreamCredentials,
  Category,
  LiveStream,
  VodStream,
  SeriesStream,
} from "../types";
import { XtreamService } from "../services/xtreamService";

export type OperationStatus = "idle" | "loading" | "ready" | "error";

export type OperationType =
  | "live_categories"
  | "vod_categories"
  | "series_categories"
  | "live_catalog"
  | "vod_catalog"
  | "series_catalog";

interface XtreamContextData {
  credentials: XtreamCredentials | null;

  // Streams data
  liveCategories: Category[];
  liveStreams: LiveStream[];
  allLiveStreams: LiveStream[];
  vodCategories: Category[];
  vodStreams: VodStream[];
  allVodStreams: VodStream[];
  seriesCategories: Category[];
  seriesStreams: SeriesStream[];
  allSeriesStreams: SeriesStream[];

  // Operation statuses
  liveCategoriesStatus: OperationStatus;
  vodCategoriesStatus: OperationStatus;
  seriesCategoriesStatus: OperationStatus;
  liveCatalogStatus: OperationStatus;
  vodCatalogStatus: OperationStatus;
  seriesCatalogStatus: OperationStatus;

  // Granular errors
  liveCategoriesError: string | null;
  vodCategoriesError: string | null;
  seriesCategoriesError: string | null;
  liveError: string | null;
  vodError: string | null;
  seriesError: string | null;

  // Backward compatibility
  categoriesError: string | null;
  error: string | null;
  loadingLive: boolean;
  loadingVod: boolean;
  loadingSeries: boolean;
  loadedLiveCatalog: boolean;
  loadedVodCatalog: boolean;
  loadedSeriesCatalog: boolean;

  // Actions
  fetchLiveCategories: () => Promise<void>;
  fetchVodCategories: () => Promise<void>;
  fetchSeriesCategories: () => Promise<void>;
  fetchLiveStreams: (categoryId?: string) => Promise<void>;
  fetchVodStreams: (categoryId?: string) => Promise<void>;
  fetchSeriesStreams: (categoryId?: string) => Promise<void>;
  retryCategories: () => Promise<void>;
}

export const XtreamContext = createContext<XtreamContextData | undefined>(
  undefined
);

interface QueueItem {
  type: OperationType;
  priority: number;
  run: (signal: AbortSignal) => Promise<void>;
  resolve: () => void;
  reject: (err: any) => void;
}

export function XtreamProvider({
  children,
  credentials,
}: {
  children: React.ReactNode;
  credentials: XtreamCredentials | null;
}) {
  // Session tracking to invalidate work when credentials change
  const sessionRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Data states
  const [liveCategories, setLiveCategories] = useState<Category[]>([]);
  const [liveStreams, setLiveStreams] = useState<LiveStream[]>([]);
  const [allLiveStreams, setAllLiveStreams] = useState<LiveStream[]>([]);

  const [vodCategories, setVodCategories] = useState<Category[]>([]);
  const [vodStreams, setVodStreams] = useState<VodStream[]>([]);
  const [allVodStreams, setAllVodStreams] = useState<VodStream[]>([]);

  const [seriesCategories, setSeriesCategories] = useState<Category[]>([]);
  const [seriesStreams, setSeriesStreams] = useState<SeriesStream[]>([]);
  const [allSeriesStreams, setAllSeriesStreams] = useState<SeriesStream[]>([]);

  // Statuses
  const [liveCategoriesStatus, setLiveCategoriesStatus] =
    useState<OperationStatus>("idle");
  const [vodCategoriesStatus, setVodCategoriesStatus] =
    useState<OperationStatus>("idle");
  const [seriesCategoriesStatus, setSeriesCategoriesStatus] =
    useState<OperationStatus>("idle");

  const [liveCatalogStatus, setLiveCatalogStatus] =
    useState<OperationStatus>("idle");
  const [vodCatalogStatus, setVodCatalogStatus] =
    useState<OperationStatus>("idle");
  const [seriesCatalogStatus, setSeriesCatalogStatus] =
    useState<OperationStatus>("idle");

  // Errors
  const [liveCategoriesError, setLiveCategoriesError] = useState<string | null>(
    null
  );
  const [vodCategoriesError, setVodCategoriesError] = useState<string | null>(
    null
  );
  const [seriesCategoriesError, setSeriesCategoriesError] = useState<
    string | null
  >(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [vodError, setVodError] = useState<string | null>(null);
  const [seriesError, setSeriesError] = useState<string | null>(null);

  // Full-catalog memory references
  const allLiveStreamsRef = useRef<LiveStream[]>([]);
  const allVodStreamsRef = useRef<VodStream[]>([]);
  const allSeriesStreamsRef = useRef<SeriesStream[]>([]);

  // Most recent category selection per domain to prevent race conditions
  const latestLiveCategoryRef = useRef<string | undefined>(undefined);
  const latestVodCategoryRef = useRef<string | undefined>(undefined);
  const latestSeriesCategoryRef = useRef<string | undefined>(undefined);

  // In-flight operation promises
  const inFlightPromisesRef = useRef<Map<OperationType, Promise<void>>>(
    new Map()
  );

  // Concurrency queue references (Max 2 simultaneous operations)
  const MAX_CONCURRENT = 2;
  const activeCountRef = useRef<number>(0);
  const queueRef = useRef<QueueItem[]>([]);
  const pendingSetRef = useRef<Set<OperationType>>(new Set());

  // Helpers to update operation status and errors immediately
  const setOperationStatus = useCallback(
    (type: OperationType, status: OperationStatus) => {
      switch (type) {
        case "live_categories":
          setLiveCategoriesStatus(status);
          break;
        case "vod_categories":
          setVodCategoriesStatus(status);
          break;
        case "series_categories":
          setSeriesCategoriesStatus(status);
          break;
        case "live_catalog":
          setLiveCatalogStatus(status);
          break;
        case "vod_catalog":
          setVodCatalogStatus(status);
          break;
        case "series_catalog":
          setSeriesCatalogStatus(status);
          break;
      }
    },
    []
  );

  const clearOperationError = useCallback((type: OperationType) => {
    switch (type) {
      case "live_categories":
        setLiveCategoriesError(null);
        break;
      case "vod_categories":
        setVodCategoriesError(null);
        break;
      case "series_categories":
        setSeriesCategoriesError(null);
        break;
      case "live_catalog":
        setLiveError(null);
        break;
      case "vod_catalog":
        setVodError(null);
        break;
      case "series_catalog":
        setSeriesError(null);
        break;
    }
  }, []);

  // Pump queue to execute next available task when slots are free
  const processQueue = useCallback(() => {
    const queueSession = sessionRef.current;
    while (
      activeCountRef.current < MAX_CONCURRENT &&
      queueRef.current.length > 0
    ) {
      if (sessionRef.current !== queueSession) break;
      // Sort queue by priority descending (higher priority first)
      queueRef.current.sort((a, b) => b.priority - a.priority);
      const nextItem = queueRef.current.shift();
      if (!nextItem) break;

      activeCountRef.current++;
      const currentSignal = abortControllerRef.current?.signal;

      (async () => {
        try {
          if (currentSignal?.aborted || sessionRef.current !== queueSession) {
            nextItem.resolve();
            return;
          }
          await nextItem.run(currentSignal || new AbortController().signal);
          nextItem.resolve();
        } catch {
          // Internal catch ensures tasks don't leave unhandled promise rejections
          nextItem.resolve();
        } finally {
          // CRITICAL: Only mutate counters and trigger processQueue if session is still current
          if (sessionRef.current === queueSession) {
            activeCountRef.current = Math.max(0, activeCountRef.current - 1);
            pendingSetRef.current.delete(nextItem.type);
            inFlightPromisesRef.current.delete(nextItem.type);
            processQueue();
          }
        }
      })();
    }
  }, []);

  /**
   * Enqueues an operation with concurrency coordination and deduplication.
   * Registers operation as loading immediately upon enqueuing.
   */
  const enqueueOperation = useCallback(
    (
      type: OperationType,
      priority: number,
      task: (signal: AbortSignal) => Promise<void>
    ): Promise<void> => {
      // If already running or pending, return existing promise (and elevate priority if needed)
      const existingPromise = inFlightPromisesRef.current.get(type);
      if (existingPromise) {
        const queued = queueRef.current.find((item) => item.type === type);
        if (queued && priority > queued.priority) {
          queued.priority = priority;
          processQueue();
        }
        return existingPromise;
      }

      // Mark status as loading and clear error IMMEDIATELY upon enqueuing
      setOperationStatus(type, "loading");
      clearOperationError(type);
      pendingSetRef.current.add(type);

      let taskResolve!: () => void;
      let taskReject!: (err: any) => void;
      const promise = new Promise<void>((resolve, reject) => {
        taskResolve = resolve;
        taskReject = reject;
      });

      inFlightPromisesRef.current.set(type, promise);

      queueRef.current.push({
        type,
        priority,
        run: task,
        resolve: taskResolve,
        reject: taskReject,
      });

      // Schedule execution
      processQueue();
      return promise;
    },
    [processQueue, setOperationStatus, clearOperationError]
  );

  // Reset and cancel all work on credentials change or unmount
  useEffect(() => {
    // Invalidate previous session
    sessionRef.current++;
    const currentSession = sessionRef.current;

    // Abort active HTTP calls
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    // Clear queue and pending tasks cleanly without emitting unhandled promise rejections
    queueRef.current.forEach((item) => {
      try {
        item.resolve();
      } catch {
        // ignore
      }
    });
    queueRef.current = [];
    pendingSetRef.current.clear();
    inFlightPromisesRef.current.clear();
    activeCountRef.current = 0;

    // Reset data
    setLiveCategories([]);
    setLiveStreams([]);
    setAllLiveStreams([]);
    setVodCategories([]);
    setVodStreams([]);
    setAllVodStreams([]);
    setSeriesCategories([]);
    setSeriesStreams([]);
    setAllSeriesStreams([]);

    allLiveStreamsRef.current = [];
    allVodStreamsRef.current = [];
    allSeriesStreamsRef.current = [];

    latestLiveCategoryRef.current = undefined;
    latestVodCategoryRef.current = undefined;
    latestSeriesCategoryRef.current = undefined;

    // Reset statuses and errors
    setLiveCategoriesStatus("idle");
    setVodCategoriesStatus("idle");
    setSeriesCategoriesStatus("idle");
    setLiveCatalogStatus("idle");
    setVodCatalogStatus("idle");
    setSeriesCatalogStatus("idle");

    setLiveCategoriesError(null);
    setVodCategoriesError(null);
    setSeriesCategoriesError(null);
    setLiveError(null);
    setVodError(null);
    setSeriesError(null);

    if (!credentials) return;

    // Queue initial category fetches with controlled priority: Live TV first (priority 6), VOD (4), Series (3)
    enqueueOperation("live_categories", 6, async (signal) => {
      if (sessionRef.current !== currentSession) return;
      try {
        const cats = await XtreamService.getLiveCategories(credentials, {
          signal,
        });
        if (sessionRef.current !== currentSession) return;
        setLiveCategories(cats);
        setLiveCategoriesStatus("ready");
      } catch (err: any) {
        if (sessionRef.current !== currentSession) return;
        const msg = err.message || "Falha ao carregar categorias de TV.";
        setLiveCategoriesError(msg);
        setLiveCategoriesStatus("error");
      }
    });

    enqueueOperation("vod_categories", 4, async (signal) => {
      if (sessionRef.current !== currentSession) return;
      try {
        const cats = await XtreamService.getVodCategories(credentials, {
          signal,
        });
        if (sessionRef.current !== currentSession) return;
        setVodCategories(cats);
        setVodCategoriesStatus("ready");
      } catch (err: any) {
        if (sessionRef.current !== currentSession) return;
        const msg = err.message || "Falha ao carregar categorias de filmes.";
        setVodCategoriesError(msg);
        setVodCategoriesStatus("error");
      }
    });

    enqueueOperation("series_categories", 3, async (signal) => {
      if (sessionRef.current !== currentSession) return;
      try {
        const cats = await XtreamService.getSeriesCategories(credentials, {
          signal,
        });
        if (sessionRef.current !== currentSession) return;
        setSeriesCategories(cats);
        setSeriesCategoriesStatus("ready");
      } catch (err: any) {
        if (sessionRef.current !== currentSession) return;
        const msg = err.message || "Falha ao carregar categorias de séries.";
        setSeriesCategoriesError(msg);
        setSeriesCategoriesStatus("error");
      }
    });

    return () => {
      abortControllerRef.current?.abort();
    };
  }, [credentials, enqueueOperation]);

  // Actions for Categories
  const fetchLiveCategories = useCallback(async () => {
    if (!credentials) return;
    const currentSession = sessionRef.current;
    return enqueueOperation("live_categories", 100, async (signal) => {
      if (sessionRef.current !== currentSession) return;
      try {
        const cats = await XtreamService.getLiveCategories(credentials, {
          signal,
        });
        if (sessionRef.current !== currentSession) return;
        setLiveCategories(cats);
        setLiveCategoriesStatus("ready");
      } catch (err: any) {
        if (sessionRef.current !== currentSession) return;
        const msg = err.message || "Falha ao carregar categorias de TV.";
        setLiveCategoriesError(msg);
        setLiveCategoriesStatus("error");
      }
    });
  }, [credentials, enqueueOperation]);

  const fetchVodCategories = useCallback(async () => {
    if (!credentials) return;
    const currentSession = sessionRef.current;
    return enqueueOperation("vod_categories", 100, async (signal) => {
      if (sessionRef.current !== currentSession) return;
      try {
        const cats = await XtreamService.getVodCategories(credentials, {
          signal,
        });
        if (sessionRef.current !== currentSession) return;
        setVodCategories(cats);
        setVodCategoriesStatus("ready");
      } catch (err: any) {
        if (sessionRef.current !== currentSession) return;
        const msg = err.message || "Falha ao carregar categorias de filmes.";
        setVodCategoriesError(msg);
        setVodCategoriesStatus("error");
      }
    });
  }, [credentials, enqueueOperation]);

  const fetchSeriesCategories = useCallback(async () => {
    if (!credentials) return;
    const currentSession = sessionRef.current;
    return enqueueOperation("series_categories", 100, async (signal) => {
      if (sessionRef.current !== currentSession) return;
      try {
        const cats = await XtreamService.getSeriesCategories(credentials, {
          signal,
        });
        if (sessionRef.current !== currentSession) return;
        setSeriesCategories(cats);
        setSeriesCategoriesStatus("ready");
      } catch (err: any) {
        if (sessionRef.current !== currentSession) return;
        const msg = err.message || "Falha ao carregar categorias de séries.";
        setSeriesCategoriesError(msg);
        setSeriesCategoriesStatus("error");
      }
    });
  }, [credentials, enqueueOperation]);

  // Backward-compatible category retry
  const retryCategories = useCallback(async () => {
    await Promise.allSettled([
      fetchLiveCategories(),
      fetchVodCategories(),
      fetchSeriesCategories(),
    ]);
  }, [fetchLiveCategories, fetchVodCategories, fetchSeriesCategories]);

  // Live Streams Catalog Fetch
  const fetchLiveStreams = useCallback(
    async (categoryId?: string) => {
      if (!credentials) return;
      // Record most recent category requested
      latestLiveCategoryRef.current = categoryId;

      // If catalog is already loaded and ready, immediately apply local filter
      if (liveCatalogStatus === "ready") {
        const source = allLiveStreamsRef.current;
        if (categoryId) {
          setLiveStreams(
            source.filter((s) => String(s.category_id) === String(categoryId))
          );
        } else {
          setLiveStreams(source);
        }
        return;
      }

      const currentSession = sessionRef.current;
      const priority = categoryId ? 100 : 5; // User category request has high priority

      return enqueueOperation("live_catalog", priority, async (signal) => {
        if (sessionRef.current !== currentSession) return;
        try {
          const streams = await XtreamService.getLiveStreams(credentials, undefined, {
            signal,
          });
          if (sessionRef.current !== currentSession) return;
          allLiveStreamsRef.current = streams;
          setAllLiveStreams(streams);
          setLiveCatalogStatus("ready");

          // Always respect most recent category selection
          const targetCat = latestLiveCategoryRef.current;
          if (targetCat) {
            setLiveStreams(
              streams.filter((s) => String(s.category_id) === String(targetCat))
            );
          } else {
            setLiveStreams(streams);
          }
        } catch (err: any) {
          if (sessionRef.current !== currentSession) return;
          const msg = err.message || "Falha ao carregar canais ao vivo.";
          setLiveError(msg);
          setLiveCatalogStatus("error");
        }
      });
    },
    [credentials, liveCatalogStatus, enqueueOperation]
  );

  // VOD Streams Catalog Fetch
  const fetchVodStreams = useCallback(
    async (categoryId?: string) => {
      if (!credentials) return;
      // Record most recent category requested
      latestVodCategoryRef.current = categoryId;

      // If catalog is already loaded and ready, immediately apply local filter
      if (vodCatalogStatus === "ready") {
        const source = allVodStreamsRef.current;
        if (categoryId) {
          setVodStreams(
            source.filter((s) => String(s.category_id) === String(categoryId))
          );
        } else {
          setVodStreams(source);
        }
        return;
      }

      const currentSession = sessionRef.current;
      const priority = categoryId ? 100 : 2; // User category request has high priority

      return enqueueOperation("vod_catalog", priority, async (signal) => {
        if (sessionRef.current !== currentSession) return;
        try {
          const streams = await XtreamService.getVodStreams(credentials, undefined, {
            signal,
          });
          if (sessionRef.current !== currentSession) return;
          allVodStreamsRef.current = streams;
          setAllVodStreams(streams);
          setVodCatalogStatus("ready");

          // Always respect most recent category selection
          const targetCat = latestVodCategoryRef.current;
          if (targetCat) {
            setVodStreams(
              streams.filter((s) => String(s.category_id) === String(targetCat))
            );
          } else {
            setVodStreams(streams);
          }
        } catch (err: any) {
          if (sessionRef.current !== currentSession) return;
          const msg = err.message || "Falha ao carregar filmes.";
          setVodError(msg);
          setVodCatalogStatus("error");
        }
      });
    },
    [credentials, vodCatalogStatus, enqueueOperation]
  );

  // Series Streams Catalog Fetch
  const fetchSeriesStreams = useCallback(
    async (categoryId?: string) => {
      if (!credentials) return;
      // Record most recent category requested
      latestSeriesCategoryRef.current = categoryId;

      // If catalog is already loaded and ready, immediately apply local filter
      if (seriesCatalogStatus === "ready") {
        const source = allSeriesStreamsRef.current;
        if (categoryId) {
          setSeriesStreams(
            source.filter((s) => String(s.category_id) === String(categoryId))
          );
        } else {
          setSeriesStreams(source);
        }
        return;
      }

      const currentSession = sessionRef.current;
      const priority = categoryId ? 100 : 1; // User category request has high priority

      return enqueueOperation("series_catalog", priority, async (signal) => {
        if (sessionRef.current !== currentSession) return;
        try {
          const streams = await XtreamService.getSeries(credentials, undefined, {
            signal,
          });
          if (sessionRef.current !== currentSession) return;
          allSeriesStreamsRef.current = streams;
          setAllSeriesStreams(streams);
          setSeriesCatalogStatus("ready");

          // Always respect most recent category selection
          const targetCat = latestSeriesCategoryRef.current;
          if (targetCat) {
            setSeriesStreams(
              streams.filter((s) => String(s.category_id) === String(targetCat))
            );
          } else {
            setSeriesStreams(streams);
          }
        } catch (err: any) {
          if (sessionRef.current !== currentSession) return;
          const msg = err.message || "Falha ao carregar séries.";
          setSeriesError(msg);
          setSeriesCatalogStatus("error");
        }
      });
    },
    [credentials, seriesCatalogStatus, enqueueOperation]
  );

  // Backward compatibility values
  const loadingLive = liveCatalogStatus === "loading";
  const loadingVod = vodCatalogStatus === "loading";
  const loadingSeries = seriesCatalogStatus === "loading";

  const loadedLiveCatalog = liveCatalogStatus === "ready";
  const loadedVodCatalog = vodCatalogStatus === "ready";
  const loadedSeriesCatalog = seriesCatalogStatus === "ready";

  const categoriesError =
    liveCategoriesError || vodCategoriesError || seriesCategoriesError;
  const error = liveError || vodError || seriesError || categoriesError;

  return (
    <XtreamContext.Provider
      value={{
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
        liveCategoriesStatus,
        vodCategoriesStatus,
        seriesCategoriesStatus,
        liveCatalogStatus,
        vodCatalogStatus,
        seriesCatalogStatus,
        liveCategoriesError,
        vodCategoriesError,
        seriesCategoriesError,
        liveError,
        vodError,
        seriesError,
        categoriesError,
        error,
        loadingLive,
        loadingVod,
        loadingSeries,
        loadedLiveCatalog,
        loadedVodCatalog,
        loadedSeriesCatalog,
        fetchLiveCategories,
        fetchVodCategories,
        fetchSeriesCategories,
        fetchLiveStreams,
        fetchVodStreams,
        fetchSeriesStreams,
        retryCategories,
      }}
    >
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
