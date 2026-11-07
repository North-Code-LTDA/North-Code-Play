import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  XtreamCredentials,
  Category,
  LiveStream,
  VodStream,
  SeriesStream,
} from "../types";
import {
  XtreamService,
  isAuthenticationRejectedError,
} from "../services/xtreamService";
import {
  markCredentialsAuthRejected,
  safeSaveCredentials,
} from "../utils/accountUtils";
import {
  getOrCreateLiveIndex,
  getOrCreateVodIndex,
  getOrCreateSeriesIndex,
  buildLiveIndexAsync,
  buildVodIndexAsync,
  buildSeriesIndexAsync,
} from "../utils/catalogIndex";
import {
  type CatalogDiagnosticOperationHandle,
  startCatalogDiagnosticsSession,
  cancelCatalogDiagnosticsSession,
  recordCatalogOperationEnqueued,
  recordCatalogOperationDeduplicated,
  recordCatalogOperationStarted,
  recordCatalogOperationFinished,
} from "../utils/catalogDiagnostics";

export type OperationStatus = "idle" | "loading" | "ready" | "error";

export type OperationType =
  | "live_categories"
  | "vod_categories"
  | "series_categories"
  | "live_catalog"
  | "vod_catalog"
  | "series_catalog";

export interface XtreamCredentialsContextData {
  credentials: XtreamCredentials | null;
}

export interface XtreamSessionContextData {
  sessionReady: boolean;
  isAuthRejected: boolean;
  authError: string | null;
  allSixFinished: boolean;
  hasTransientCategoriesFailure: boolean;
  transientFailureMessage: string | null;
  retryCategories: () => Promise<void>;
  retrySession: () => Promise<void>;
}

export interface XtreamLiveContextData {
  liveCategories: Category[];
  liveStreams: LiveStream[];
  allLiveStreams: LiveStream[];
  liveCategoriesStatus: OperationStatus;
  liveCatalogStatus: OperationStatus;
  liveCategoriesError: string | null;
  liveError: string | null;
  loadingLive: boolean;
  loadedLiveCatalog: boolean;
  fetchLiveCategories: () => Promise<void>;
  fetchLiveStreams: (categoryId?: string) => Promise<void>;
}

export interface XtreamVodContextData {
  vodCategories: Category[];
  vodStreams: VodStream[];
  allVodStreams: VodStream[];
  vodCategoriesStatus: OperationStatus;
  vodCatalogStatus: OperationStatus;
  vodCategoriesError: string | null;
  vodError: string | null;
  loadingVod: boolean;
  loadedVodCatalog: boolean;
  fetchVodCategories: () => Promise<void>;
  fetchVodStreams: (categoryId?: string) => Promise<void>;
}

export interface XtreamSeriesContextData {
  seriesCategories: Category[];
  seriesStreams: SeriesStream[];
  allSeriesStreams: SeriesStream[];
  seriesCategoriesStatus: OperationStatus;
  seriesCatalogStatus: OperationStatus;
  seriesCategoriesError: string | null;
  seriesError: string | null;
  loadingSeries: boolean;
  loadedSeriesCatalog: boolean;
  fetchSeriesCategories: () => Promise<void>;
  fetchSeriesStreams: (categoryId?: string) => Promise<void>;
}

export interface XtreamContextData
  extends XtreamCredentialsContextData,
    XtreamSessionContextData,
    XtreamLiveContextData,
    XtreamVodContextData,
    XtreamSeriesContextData {
  // Backward compatibility aggregate error fields
  categoriesError: string | null;
  error: string | null;
}

export const XtreamCredentialsContext = createContext<
  XtreamCredentialsContextData | undefined
>(undefined);

export const XtreamSessionContext = createContext<
  XtreamSessionContextData | undefined
>(undefined);

export const XtreamLiveContext = createContext<
  XtreamLiveContextData | undefined
>(undefined);

export const XtreamVodContext = createContext<XtreamVodContextData | undefined>(
  undefined
);

export const XtreamSeriesContext = createContext<
  XtreamSeriesContextData | undefined
>(undefined);

export const XtreamContext = createContext<XtreamContextData | undefined>(
  undefined
);

interface QueueItem {
  type: OperationType;
  priority: number;
  diagOp: CatalogDiagnosticOperationHandle | null;
  run: (
    signal: AbortSignal,
    diagOp: CatalogDiagnosticOperationHandle | null
  ) => Promise<void>;
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
  const diagSessionIdRef = useRef<number>(0);
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

  // Session readiness
  const [sessionReady, setSessionReady] = useState<boolean>(false);

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

  // Auth rejection state (distinct from transient errors)
  const [isAuthRejected, setIsAuthRejected] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const registerErrorAndCheckAuth = useCallback(
    async (
      err: any,
      currentSession: number,
      signal?: AbortSignal
    ): Promise<string> => {
      const fallbackMsg =
        err?.message || "Falha ao comunicar com o servidor do provedor.";

      if (isAuthenticationRejectedError(err)) {
        if (sessionRef.current === currentSession) {
          setIsAuthRejected(true);
          setAuthError(fallbackMsg);
          markCredentialsAuthRejected(fallbackMsg);
        }
        return fallbackMsg;
      }

      // Se o erro não é transitório nem cancelamento (ex.: servidor retornou objeto não-array inesperado
      // em endpoint de categorias), consulta authenticate() para verificar se a conta expirou/foi desativada
      if (
        credentials &&
        !err?.isTransient &&
        err?.message !== "Operação cancelada pelo usuário." &&
        !signal?.aborted
      ) {
        try {
          await XtreamService.authenticate(credentials, { signal });
        } catch (authCheckErr: any) {
          if (
            sessionRef.current === currentSession &&
            isAuthenticationRejectedError(authCheckErr)
          ) {
            if (err && typeof err === "object") {
              err.isAuthError = true;
            }
            const authMsg =
              authCheckErr?.message ||
              "Usuário ou senha inválidos ou conta desativada.";
            setIsAuthRejected(true);
            setAuthError(authMsg);
            markCredentialsAuthRejected(authMsg);
            return authMsg;
          }
        }
      }

      return fallbackMsg;
    },
    [credentials]
  );

  // Status refs for stable action callbacks across status transitions
  const liveCatalogStatusRef = useRef<OperationStatus>("idle");
  liveCatalogStatusRef.current = liveCatalogStatus;
  const vodCatalogStatusRef = useRef<OperationStatus>("idle");
  vodCatalogStatusRef.current = vodCatalogStatus;
  const seriesCatalogStatusRef = useRef<OperationStatus>("idle");
  seriesCatalogStatusRef.current = seriesCatalogStatus;
  const isAuthRejectedRef = useRef<boolean>(false);
  isAuthRejectedRef.current = isAuthRejected;

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
          liveCatalogStatusRef.current = status;
          setLiveCatalogStatus(status);
          break;
        case "vod_catalog":
          vodCatalogStatusRef.current = status;
          setVodCatalogStatus(status);
          break;
        case "series_catalog":
          seriesCatalogStatusRef.current = status;
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
            recordCatalogOperationFinished(nextItem.diagOp, "cancelled");
            nextItem.resolve();
            return;
          }
          recordCatalogOperationStarted(nextItem.diagOp);
          await nextItem.run(
            currentSignal || new AbortController().signal,
            nextItem.diagOp
          );
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
      task: (
        signal: AbortSignal,
        diagOp: CatalogDiagnosticOperationHandle | null
      ) => Promise<void>
    ): Promise<void> => {
      // If already running or pending, return existing promise (and elevate priority if needed)
      const existingPromise = inFlightPromisesRef.current.get(type);
      if (existingPromise) {
        recordCatalogOperationDeduplicated(
          diagSessionIdRef.current,
          type,
          priority
        );
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

      const diagOp = recordCatalogOperationEnqueued(
        diagSessionIdRef.current,
        type,
        priority
      );

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
        diagOp,
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
    const previousDiagSession = diagSessionIdRef.current;
    if (previousDiagSession > 0) {
      cancelCatalogDiagnosticsSession(previousDiagSession);
    }

    // Invalidate previous session
    sessionRef.current++;
    const currentSession = sessionRef.current;

    // Abort active HTTP calls
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    // Clear queue and pending tasks cleanly without emitting unhandled promise rejections
    queueRef.current.forEach((item) => {
      try {
        recordCatalogOperationFinished(item.diagOp, "cancelled");
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
    liveCatalogStatusRef.current = "idle";
    vodCatalogStatusRef.current = "idle";
    seriesCatalogStatusRef.current = "idle";

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

    const initiallyRejected = Boolean((credentials as any)?.authRejected);
    const initialAuthErr =
      initiallyRejected && typeof (credentials as any)?.authError === "string"
        ? (credentials as any).authError
        : null;
    isAuthRejectedRef.current = initiallyRejected;
    setIsAuthRejected(initiallyRejected);
    setAuthError(initialAuthErr);

    setSessionReady(false);

    if (!credentials) return;

    const currentDiagSession = startCatalogDiagnosticsSession(
      currentSession,
      MAX_CONCURRENT
    );
    diagSessionIdRef.current = currentDiagSession;

    // Queue initial category fetches with controlled priority: Live TV first (priority 6), VOD (4), Series (3)
    enqueueOperation("live_categories", 6, async (signal, diagOp) => {
      if (sessionRef.current !== currentSession || signal.aborted) {
        recordCatalogOperationFinished(diagOp, "cancelled");
        return;
      }
      try {
        const cats = await XtreamService.getLiveCategories(credentials, {
          signal,
          diagOp,
        });
        if (sessionRef.current !== currentSession || signal.aborted) {
          recordCatalogOperationFinished(diagOp, "cancelled");
          return;
        }
        diagOp?.recordResultItemsFallback(Array.isArray(cats) ? cats.length : 0);
        setLiveCategories(cats);
        setLiveCategoriesStatus("ready");
        recordCatalogOperationFinished(diagOp, "success");
      } catch (err: any) {
        if (
          sessionRef.current !== currentSession ||
          signal.aborted ||
          err?.message === "Operação cancelada pelo usuário."
        ) {
          recordCatalogOperationFinished(diagOp, "cancelled", err);
          return;
        }
        const msg = await registerErrorAndCheckAuth(
          err,
          currentSession,
          signal
        );
        if (sessionRef.current !== currentSession || signal.aborted) {
          recordCatalogOperationFinished(diagOp, "cancelled", err);
          return;
        }
        setLiveCategoriesError(
          msg || "Falha ao carregar categorias de TV."
        );
        setLiveCategoriesStatus("error");
        recordCatalogOperationFinished(diagOp, "error", err);
      }
    });

    enqueueOperation("vod_categories", 4, async (signal, diagOp) => {
      if (sessionRef.current !== currentSession || signal.aborted) {
        recordCatalogOperationFinished(diagOp, "cancelled");
        return;
      }
      try {
        const cats = await XtreamService.getVodCategories(credentials, {
          signal,
          diagOp,
        });
        if (sessionRef.current !== currentSession || signal.aborted) {
          recordCatalogOperationFinished(diagOp, "cancelled");
          return;
        }
        diagOp?.recordResultItemsFallback(Array.isArray(cats) ? cats.length : 0);
        setVodCategories(cats);
        setVodCategoriesStatus("ready");
        recordCatalogOperationFinished(diagOp, "success");
      } catch (err: any) {
        if (
          sessionRef.current !== currentSession ||
          signal.aborted ||
          err?.message === "Operação cancelada pelo usuário."
        ) {
          recordCatalogOperationFinished(diagOp, "cancelled", err);
          return;
        }
        const msg = await registerErrorAndCheckAuth(
          err,
          currentSession,
          signal
        );
        if (sessionRef.current !== currentSession || signal.aborted) {
          recordCatalogOperationFinished(diagOp, "cancelled", err);
          return;
        }
        setVodCategoriesError(
          msg || "Falha ao carregar categorias de filmes."
        );
        setVodCategoriesStatus("error");
        recordCatalogOperationFinished(diagOp, "error", err);
      }
    });

    enqueueOperation("series_categories", 3, async (signal, diagOp) => {
      if (sessionRef.current !== currentSession || signal.aborted) {
        recordCatalogOperationFinished(diagOp, "cancelled");
        return;
      }
      try {
        const cats = await XtreamService.getSeriesCategories(credentials, {
          signal,
          diagOp,
        });
        if (sessionRef.current !== currentSession || signal.aborted) {
          recordCatalogOperationFinished(diagOp, "cancelled");
          return;
        }
        diagOp?.recordResultItemsFallback(Array.isArray(cats) ? cats.length : 0);
        setSeriesCategories(cats);
        setSeriesCategoriesStatus("ready");
        recordCatalogOperationFinished(diagOp, "success");
      } catch (err: any) {
        if (
          sessionRef.current !== currentSession ||
          signal.aborted ||
          err?.message === "Operação cancelada pelo usuário."
        ) {
          recordCatalogOperationFinished(diagOp, "cancelled", err);
          return;
        }
        const msg = await registerErrorAndCheckAuth(
          err,
          currentSession,
          signal
        );
        if (sessionRef.current !== currentSession || signal.aborted) {
          recordCatalogOperationFinished(diagOp, "cancelled", err);
          return;
        }
        setSeriesCategoriesError(
          msg || "Falha ao carregar categorias de séries."
        );
        setSeriesCategoriesStatus("error");
        recordCatalogOperationFinished(diagOp, "error", err);
      }
    });

    // Mark current session as fully initialized and ready for component consumer requests
    setSessionReady(true);

    return () => {
      abortControllerRef.current?.abort();
      cancelCatalogDiagnosticsSession(currentDiagSession);
    };
  }, [credentials, enqueueOperation, registerErrorAndCheckAuth]);

  // Actions for Categories
  const fetchLiveCategories = useCallback(async () => {
    if (!credentials) return;
    const currentSession = sessionRef.current;
    return enqueueOperation("live_categories", 100, async (signal, diagOp) => {
      if (sessionRef.current !== currentSession || signal.aborted) {
        recordCatalogOperationFinished(diagOp, "cancelled");
        return;
      }
      try {
        const cats = await XtreamService.getLiveCategories(credentials, {
          signal,
          diagOp,
        });
        if (sessionRef.current !== currentSession || signal.aborted) {
          recordCatalogOperationFinished(diagOp, "cancelled");
          return;
        }
        diagOp?.recordResultItemsFallback(Array.isArray(cats) ? cats.length : 0);
        setLiveCategories(cats);
        setLiveCategoriesStatus("ready");
        recordCatalogOperationFinished(diagOp, "success");
      } catch (err: any) {
        if (
          sessionRef.current !== currentSession ||
          signal.aborted ||
          err?.message === "Operação cancelada pelo usuário."
        ) {
          recordCatalogOperationFinished(diagOp, "cancelled", err);
          return;
        }
        const msg = await registerErrorAndCheckAuth(
          err,
          currentSession,
          signal
        );
        if (sessionRef.current !== currentSession || signal.aborted) {
          recordCatalogOperationFinished(diagOp, "cancelled", err);
          return;
        }
        setLiveCategoriesError(
          msg || "Falha ao carregar categorias de TV."
        );
        setLiveCategoriesStatus("error");
        recordCatalogOperationFinished(diagOp, "error", err);
      }
    });
  }, [credentials, enqueueOperation, registerErrorAndCheckAuth]);

  const fetchVodCategories = useCallback(async () => {
    if (!credentials) return;
    const currentSession = sessionRef.current;
    return enqueueOperation("vod_categories", 100, async (signal, diagOp) => {
      if (sessionRef.current !== currentSession || signal.aborted) {
        recordCatalogOperationFinished(diagOp, "cancelled");
        return;
      }
      try {
        const cats = await XtreamService.getVodCategories(credentials, {
          signal,
          diagOp,
        });
        if (sessionRef.current !== currentSession || signal.aborted) {
          recordCatalogOperationFinished(diagOp, "cancelled");
          return;
        }
        diagOp?.recordResultItemsFallback(Array.isArray(cats) ? cats.length : 0);
        setVodCategories(cats);
        setVodCategoriesStatus("ready");
        recordCatalogOperationFinished(diagOp, "success");
      } catch (err: any) {
        if (
          sessionRef.current !== currentSession ||
          signal.aborted ||
          err?.message === "Operação cancelada pelo usuário."
        ) {
          recordCatalogOperationFinished(diagOp, "cancelled", err);
          return;
        }
        const msg = await registerErrorAndCheckAuth(
          err,
          currentSession,
          signal
        );
        if (sessionRef.current !== currentSession || signal.aborted) {
          recordCatalogOperationFinished(diagOp, "cancelled", err);
          return;
        }
        setVodCategoriesError(
          msg || "Falha ao carregar categorias de filmes."
        );
        setVodCategoriesStatus("error");
        recordCatalogOperationFinished(diagOp, "error", err);
      }
    });
  }, [credentials, enqueueOperation, registerErrorAndCheckAuth]);

  const fetchSeriesCategories = useCallback(async () => {
    if (!credentials) return;
    const currentSession = sessionRef.current;
    return enqueueOperation("series_categories", 100, async (signal, diagOp) => {
      if (sessionRef.current !== currentSession || signal.aborted) {
        recordCatalogOperationFinished(diagOp, "cancelled");
        return;
      }
      try {
        const cats = await XtreamService.getSeriesCategories(credentials, {
          signal,
          diagOp,
        });
        if (sessionRef.current !== currentSession || signal.aborted) {
          recordCatalogOperationFinished(diagOp, "cancelled");
          return;
        }
        diagOp?.recordResultItemsFallback(Array.isArray(cats) ? cats.length : 0);
        setSeriesCategories(cats);
        setSeriesCategoriesStatus("ready");
        recordCatalogOperationFinished(diagOp, "success");
      } catch (err: any) {
        if (
          sessionRef.current !== currentSession ||
          signal.aborted ||
          err?.message === "Operação cancelada pelo usuário."
        ) {
          recordCatalogOperationFinished(diagOp, "cancelled", err);
          return;
        }
        const msg = await registerErrorAndCheckAuth(
          err,
          currentSession,
          signal
        );
        if (sessionRef.current !== currentSession || signal.aborted) {
          recordCatalogOperationFinished(diagOp, "cancelled", err);
          return;
        }
        setSeriesCategoriesError(
          msg || "Falha ao carregar categorias de séries."
        );
        setSeriesCategoriesStatus("error");
        recordCatalogOperationFinished(diagOp, "error", err);
      }
    });
  }, [credentials, enqueueOperation, registerErrorAndCheckAuth]);

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

      // If catalog is already loaded and ready, immediately apply local filter via O(1) index
      if (liveCatalogStatusRef.current === "ready") {
        const source = allLiveStreamsRef.current;
        if (categoryId) {
          setLiveStreams(getOrCreateLiveIndex(source).getByCategory(categoryId));
        } else {
          setLiveStreams(source);
        }
        return;
      }

      const currentSession = sessionRef.current;
      const priority = categoryId ? 100 : 5; // User category request has high priority

      return enqueueOperation("live_catalog", priority, async (signal, diagOp) => {
        if (sessionRef.current !== currentSession || signal.aborted) {
          recordCatalogOperationFinished(diagOp, "cancelled");
          return;
        }
        try {
          const streams = await XtreamService.getLiveStreams(credentials, undefined, {
            signal,
            diagOp,
          });
          if (sessionRef.current !== currentSession || signal.aborted) {
            recordCatalogOperationFinished(diagOp, "cancelled");
            return;
          }
          diagOp?.recordResultItemsFallback(Array.isArray(streams) ? streams.length : 0);
          const liveIdx = await buildLiveIndexAsync(streams, {
            signal,
            shouldCancel: () => sessionRef.current !== currentSession || signal.aborted,
            diagOp,
          });
          if (!liveIdx || sessionRef.current !== currentSession || signal.aborted) {
            recordCatalogOperationFinished(diagOp, "cancelled");
            return;
          }
          allLiveStreamsRef.current = streams;
          setAllLiveStreams(streams);
          liveCatalogStatusRef.current = "ready";
          setLiveCatalogStatus("ready");
          recordCatalogOperationFinished(diagOp, "success");

          // Always respect most recent category selection
          const targetCat = latestLiveCategoryRef.current;
          if (targetCat) {
            setLiveStreams(liveIdx.getByCategory(targetCat));
          } else {
            setLiveStreams(streams);
          }
        } catch (err: any) {
          if (
            sessionRef.current !== currentSession ||
            signal.aborted ||
            err?.message === "Operação cancelada pelo usuário."
          ) {
            recordCatalogOperationFinished(diagOp, "cancelled", err);
            return;
          }
          const msg = await registerErrorAndCheckAuth(
            err,
            currentSession,
            signal
          );
          if (sessionRef.current !== currentSession || signal.aborted) {
            recordCatalogOperationFinished(diagOp, "cancelled", err);
            return;
          }
          setLiveError(msg || "Falha ao carregar canais ao vivo.");
          liveCatalogStatusRef.current = "error";
          setLiveCatalogStatus("error");
          recordCatalogOperationFinished(diagOp, "error", err);
        }
      });
    },
    [credentials, enqueueOperation, registerErrorAndCheckAuth]
  );

  // VOD Streams Catalog Fetch
  const fetchVodStreams = useCallback(
    async (categoryId?: string) => {
      if (!credentials) return;
      // Record most recent category requested
      latestVodCategoryRef.current = categoryId;

      // If catalog is already loaded and ready, immediately apply local filter via O(1) index
      if (vodCatalogStatusRef.current === "ready") {
        const source = allVodStreamsRef.current;
        if (categoryId) {
          setVodStreams(getOrCreateVodIndex(source).getByCategory(categoryId));
        } else {
          setVodStreams(source);
        }
        return;
      }

      const currentSession = sessionRef.current;
      const priority = categoryId ? 100 : 2; // User category request has high priority

      return enqueueOperation("vod_catalog", priority, async (signal, diagOp) => {
        if (sessionRef.current !== currentSession || signal.aborted) {
          recordCatalogOperationFinished(diagOp, "cancelled");
          return;
        }
        try {
          const streams = await XtreamService.getVodStreams(credentials, undefined, {
            signal,
            diagOp,
          });
          if (sessionRef.current !== currentSession || signal.aborted) {
            recordCatalogOperationFinished(diagOp, "cancelled");
            return;
          }
          diagOp?.recordResultItemsFallback(Array.isArray(streams) ? streams.length : 0);
          const vodIdx = await buildVodIndexAsync(streams, {
            signal,
            shouldCancel: () => sessionRef.current !== currentSession || signal.aborted,
            diagOp,
          });
          if (!vodIdx || sessionRef.current !== currentSession || signal.aborted) {
            recordCatalogOperationFinished(diagOp, "cancelled");
            return;
          }
          allVodStreamsRef.current = streams;
          setAllVodStreams(streams);
          vodCatalogStatusRef.current = "ready";
          setVodCatalogStatus("ready");
          recordCatalogOperationFinished(diagOp, "success");

          // Always respect most recent category selection
          const targetCat = latestVodCategoryRef.current;
          if (targetCat) {
            setVodStreams(vodIdx.getByCategory(targetCat));
          } else {
            setVodStreams(streams);
          }
        } catch (err: any) {
          if (
            sessionRef.current !== currentSession ||
            signal.aborted ||
            err?.message === "Operação cancelada pelo usuário."
          ) {
            recordCatalogOperationFinished(diagOp, "cancelled", err);
            return;
          }
          const msg = await registerErrorAndCheckAuth(
            err,
            currentSession,
            signal
          );
          if (sessionRef.current !== currentSession || signal.aborted) {
            recordCatalogOperationFinished(diagOp, "cancelled", err);
            return;
          }
          setVodError(msg || "Falha ao carregar filmes.");
          vodCatalogStatusRef.current = "error";
          setVodCatalogStatus("error");
          recordCatalogOperationFinished(diagOp, "error", err);
        }
      });
    },
    [credentials, enqueueOperation, registerErrorAndCheckAuth]
  );

  // Series Streams Catalog Fetch
  const fetchSeriesStreams = useCallback(
    async (categoryId?: string) => {
      if (!credentials) return;
      // Record most recent category requested
      latestSeriesCategoryRef.current = categoryId;

      // If catalog is already loaded and ready, immediately apply local filter via O(1) index
      if (seriesCatalogStatusRef.current === "ready") {
        const source = allSeriesStreamsRef.current;
        if (categoryId) {
          setSeriesStreams(getOrCreateSeriesIndex(source).getByCategory(categoryId));
        } else {
          setSeriesStreams(source);
        }
        return;
      }

      const currentSession = sessionRef.current;
      const priority = categoryId ? 100 : 1; // User category request has high priority

      return enqueueOperation("series_catalog", priority, async (signal, diagOp) => {
        if (sessionRef.current !== currentSession || signal.aborted) {
          recordCatalogOperationFinished(diagOp, "cancelled");
          return;
        }
        try {
          const streams = await XtreamService.getSeries(credentials, undefined, {
            signal,
            diagOp,
          });
          if (sessionRef.current !== currentSession || signal.aborted) {
            recordCatalogOperationFinished(diagOp, "cancelled");
            return;
          }
          diagOp?.recordResultItemsFallback(Array.isArray(streams) ? streams.length : 0);
          const seriesIdx = await buildSeriesIndexAsync(streams, {
            signal,
            shouldCancel: () => sessionRef.current !== currentSession || signal.aborted,
            diagOp,
          });
          if (!seriesIdx || sessionRef.current !== currentSession || signal.aborted) {
            recordCatalogOperationFinished(diagOp, "cancelled");
            return;
          }
          allSeriesStreamsRef.current = streams;
          setAllSeriesStreams(streams);
          seriesCatalogStatusRef.current = "ready";
          setSeriesCatalogStatus("ready");
          recordCatalogOperationFinished(diagOp, "success");

          // Always respect most recent category selection
          const targetCat = latestSeriesCategoryRef.current;
          if (targetCat) {
            setSeriesStreams(seriesIdx.getByCategory(targetCat));
          } else {
            setSeriesStreams(streams);
          }
        } catch (err: any) {
          if (
            sessionRef.current !== currentSession ||
            signal.aborted ||
            err?.message === "Operação cancelada pelo usuário."
          ) {
            recordCatalogOperationFinished(diagOp, "cancelled", err);
            return;
          }
          const msg = await registerErrorAndCheckAuth(
            err,
            currentSession,
            signal
          );
          if (sessionRef.current !== currentSession || signal.aborted) {
            recordCatalogOperationFinished(diagOp, "cancelled", err);
            return;
          }
          setSeriesError(msg || "Falha ao carregar séries.");
          seriesCatalogStatusRef.current = "error";
          setSeriesCatalogStatus("error");
          recordCatalogOperationFinished(diagOp, "error", err);
        }
      });
    },
    [credentials, enqueueOperation, registerErrorAndCheckAuth]
  );

  // Orchestrate initial catalog fetches independently of whether HomeView is mounted,
  // respecting the max-2 concurrency queue and priorities (live_catalog: 5, vod_catalog: 2, series_catalog: 1)
  useEffect(() => {
    if (!credentials || !sessionReady || isAuthRejected) return;
    if (liveCatalogStatus === "idle") {
      fetchLiveStreams().catch(() => {});
    }
    if (vodCatalogStatus === "idle") {
      fetchVodStreams().catch(() => {});
    }
    if (seriesCatalogStatus === "idle") {
      fetchSeriesStreams().catch(() => {});
    }
  }, [
    credentials,
    sessionReady,
    isAuthRejected,
    liveCatalogStatus,
    vodCatalogStatus,
    seriesCatalogStatus,
    fetchLiveStreams,
    fetchVodStreams,
    fetchSeriesStreams,
  ]);

  // Full session retry (re-verifies authentication if previously rejected and reloads failed categories/catalogs)
  const retrySession = useCallback(async () => {
    if (!credentials) return;
    const currentSession = sessionRef.current;

    if (isAuthRejectedRef.current) {
      try {
        await XtreamService.authenticate(credentials, {
          signal: abortControllerRef.current?.signal,
        });
        if (sessionRef.current !== currentSession) return;
        isAuthRejectedRef.current = false;
        setIsAuthRejected(false);
        setAuthError(null);
        safeSaveCredentials(credentials);
      } catch (err: any) {
        if (sessionRef.current !== currentSession) return;
        if (isAuthenticationRejectedError(err)) {
          const msg =
            err?.message || "Usuário ou senha inválidos ou conta desativada.";
          isAuthRejectedRef.current = true;
          setIsAuthRejected(true);
          setAuthError(msg);
          markCredentialsAuthRejected(msg);
          return;
        }
      }
    }

    await Promise.allSettled([
      fetchLiveCategories(),
      fetchVodCategories(),
      fetchSeriesCategories(),
      fetchLiveStreams(latestLiveCategoryRef.current),
      fetchVodStreams(latestVodCategoryRef.current),
      fetchSeriesStreams(latestSeriesCategoryRef.current),
    ]);
  }, [
    credentials,
    fetchLiveCategories,
    fetchVodCategories,
    fetchSeriesCategories,
    fetchLiveStreams,
    fetchVodStreams,
    fetchSeriesStreams,
  ]);

  // Backward compatibility values
  const loadingLive = liveCatalogStatus === "loading";
  const loadingVod = vodCatalogStatus === "loading";
  const loadingSeries = seriesCatalogStatus === "loading";

  const loadedLiveCatalog = liveCatalogStatus === "ready";
  const loadedVodCatalog = vodCatalogStatus === "ready";
  const loadedSeriesCatalog = seriesCatalogStatus === "ready";

  const categoriesError =
    liveCategoriesError || vodCategoriesError || seriesCategoriesError;
  const error =
    authError || liveError || vodError || seriesError || categoriesError;

  const isStatusFinished = (s: OperationStatus) =>
    s === "ready" || s === "error";
  const allSixFinished = Boolean(
    sessionReady &&
      isStatusFinished(liveCategoriesStatus) &&
      isStatusFinished(vodCategoriesStatus) &&
      isStatusFinished(seriesCategoriesStatus) &&
      isStatusFinished(liveCatalogStatus) &&
      isStatusFinished(vodCatalogStatus) &&
      isStatusFinished(seriesCatalogStatus)
  );

  const hasTransientCategoriesFailure = Boolean(
    !isAuthRejected &&
      sessionReady &&
      (liveCategoriesStatus === "error" ||
        vodCategoriesStatus === "error" ||
        seriesCategoriesStatus === "error")
  );

  const transientFailureMessage = hasTransientCategoriesFailure
    ? liveCategoriesError ||
      vodCategoriesError ||
      seriesCategoriesError ||
      "Falha temporária de conexão com o servidor do provedor."
    : null;

  const credentialsValue = useMemo<XtreamCredentialsContextData>(
    () => ({ credentials }),
    [credentials]
  );

  const sessionValue = useMemo<XtreamSessionContextData>(
    () => ({
      sessionReady,
      isAuthRejected,
      authError,
      allSixFinished,
      hasTransientCategoriesFailure,
      transientFailureMessage,
      retryCategories,
      retrySession,
    }),
    [
      sessionReady,
      isAuthRejected,
      authError,
      allSixFinished,
      hasTransientCategoriesFailure,
      transientFailureMessage,
      retryCategories,
      retrySession,
    ]
  );

  const liveValue = useMemo<XtreamLiveContextData>(
    () => ({
      liveCategories,
      liveStreams,
      allLiveStreams,
      liveCategoriesStatus,
      liveCatalogStatus,
      liveCategoriesError,
      liveError,
      loadingLive,
      loadedLiveCatalog,
      fetchLiveCategories,
      fetchLiveStreams,
    }),
    [
      liveCategories,
      liveStreams,
      allLiveStreams,
      liveCategoriesStatus,
      liveCatalogStatus,
      liveCategoriesError,
      liveError,
      loadingLive,
      loadedLiveCatalog,
      fetchLiveCategories,
      fetchLiveStreams,
    ]
  );

  const vodValue = useMemo<XtreamVodContextData>(
    () => ({
      vodCategories,
      vodStreams,
      allVodStreams,
      vodCategoriesStatus,
      vodCatalogStatus,
      vodCategoriesError,
      vodError,
      loadingVod,
      loadedVodCatalog,
      fetchVodCategories,
      fetchVodStreams,
    }),
    [
      vodCategories,
      vodStreams,
      allVodStreams,
      vodCategoriesStatus,
      vodCatalogStatus,
      vodCategoriesError,
      vodError,
      loadingVod,
      loadedVodCatalog,
      fetchVodCategories,
      fetchVodStreams,
    ]
  );

  const seriesValue = useMemo<XtreamSeriesContextData>(
    () => ({
      seriesCategories,
      seriesStreams,
      allSeriesStreams,
      seriesCategoriesStatus,
      seriesCatalogStatus,
      seriesCategoriesError,
      seriesError,
      loadingSeries,
      loadedSeriesCatalog,
      fetchSeriesCategories,
      fetchSeriesStreams,
    }),
    [
      seriesCategories,
      seriesStreams,
      allSeriesStreams,
      seriesCategoriesStatus,
      seriesCatalogStatus,
      seriesCategoriesError,
      seriesError,
      loadingSeries,
      loadedSeriesCatalog,
      fetchSeriesCategories,
      fetchSeriesStreams,
    ]
  );

  const aggregatedValue = useMemo<XtreamContextData>(
    () => ({
      ...credentialsValue,
      ...sessionValue,
      ...liveValue,
      ...vodValue,
      ...seriesValue,
      categoriesError,
      error,
    }),
    [
      credentialsValue,
      sessionValue,
      liveValue,
      vodValue,
      seriesValue,
      categoriesError,
      error,
    ]
  );

  return (
    <XtreamCredentialsContext.Provider value={credentialsValue}>
      <XtreamSessionContext.Provider value={sessionValue}>
        <XtreamLiveContext.Provider value={liveValue}>
          <XtreamVodContext.Provider value={vodValue}>
            <XtreamSeriesContext.Provider value={seriesValue}>
              <XtreamContext.Provider value={aggregatedValue}>
                {children}
              </XtreamContext.Provider>
            </XtreamSeriesContext.Provider>
          </XtreamVodContext.Provider>
        </XtreamLiveContext.Provider>
      </XtreamSessionContext.Provider>
    </XtreamCredentialsContext.Provider>
  );
}

/**
 * Helper provider for unit tests that supply a static or partial mock XtreamContextData object.
 * Populates all isolated contexts and the aggregated XtreamContext without subscribing
 * isolated consumers to the aggregated context during production rendering.
 */
export function XtreamMockProvider({
  value,
  children,
}: {
  value: Partial<XtreamContextData> & { credentials?: XtreamCredentials | null };
  children: React.ReactNode;
}) {
  const noopAsync = useCallback(async () => {}, []);
  const credentials = value.credentials ?? null;

  const credentialsValue = useMemo<XtreamCredentialsContextData>(
    () => ({ credentials }),
    [credentials]
  );

  const sessionValue = useMemo<XtreamSessionContextData>(
    () => ({
      sessionReady: value.sessionReady ?? true,
      isAuthRejected: value.isAuthRejected ?? false,
      authError: value.authError ?? null,
      allSixFinished: value.allSixFinished ?? true,
      hasTransientCategoriesFailure:
        value.hasTransientCategoriesFailure ?? false,
      transientFailureMessage: value.transientFailureMessage ?? null,
      retryCategories: value.retryCategories ?? noopAsync,
      retrySession: value.retrySession ?? noopAsync,
    }),
    [
      value.sessionReady,
      value.isAuthRejected,
      value.authError,
      value.allSixFinished,
      value.hasTransientCategoriesFailure,
      value.transientFailureMessage,
      value.retryCategories,
      value.retrySession,
      noopAsync,
    ]
  );

  const liveValue = useMemo<XtreamLiveContextData>(
    () => ({
      liveCategories: value.liveCategories ?? [],
      liveStreams: value.liveStreams ?? [],
      allLiveStreams: value.allLiveStreams ?? [],
      liveCategoriesStatus: value.liveCategoriesStatus ?? "ready",
      liveCatalogStatus: value.liveCatalogStatus ?? "ready",
      liveCategoriesError: value.liveCategoriesError ?? null,
      liveError: value.liveError ?? null,
      loadingLive: value.loadingLive ?? false,
      loadedLiveCatalog: value.loadedLiveCatalog ?? true,
      fetchLiveCategories: value.fetchLiveCategories ?? noopAsync,
      fetchLiveStreams: value.fetchLiveStreams ?? noopAsync,
    }),
    [
      value.liveCategories,
      value.liveStreams,
      value.allLiveStreams,
      value.liveCategoriesStatus,
      value.liveCatalogStatus,
      value.liveCategoriesError,
      value.liveError,
      value.loadingLive,
      value.loadedLiveCatalog,
      value.fetchLiveCategories,
      value.fetchLiveStreams,
      noopAsync,
    ]
  );

  const vodValue = useMemo<XtreamVodContextData>(
    () => ({
      vodCategories: value.vodCategories ?? [],
      vodStreams: value.vodStreams ?? [],
      allVodStreams: value.allVodStreams ?? [],
      vodCategoriesStatus: value.vodCategoriesStatus ?? "ready",
      vodCatalogStatus: value.vodCatalogStatus ?? "ready",
      vodCategoriesError: value.vodCategoriesError ?? null,
      vodError: value.vodError ?? null,
      loadingVod: value.loadingVod ?? false,
      loadedVodCatalog: value.loadedVodCatalog ?? true,
      fetchVodCategories: value.fetchVodCategories ?? noopAsync,
      fetchVodStreams: value.fetchVodStreams ?? noopAsync,
    }),
    [
      value.vodCategories,
      value.vodStreams,
      allVodStreamsDeps(value.allVodStreams),
      value.vodCategoriesStatus,
      value.vodCatalogStatus,
      value.vodCategoriesError,
      value.vodError,
      value.loadingVod,
      value.loadedVodCatalog,
      value.fetchVodCategories,
      value.fetchVodStreams,
      noopAsync,
    ]
  );

  const seriesValue = useMemo<XtreamSeriesContextData>(
    () => ({
      seriesCategories: value.seriesCategories ?? [],
      seriesStreams: value.seriesStreams ?? [],
      allSeriesStreams: value.allSeriesStreams ?? [],
      seriesCategoriesStatus: value.seriesCategoriesStatus ?? "ready",
      seriesCatalogStatus: value.seriesCatalogStatus ?? "ready",
      seriesCategoriesError: value.seriesCategoriesError ?? null,
      seriesError: value.seriesError ?? null,
      loadingSeries: value.loadingSeries ?? false,
      loadedSeriesCatalog: value.loadedSeriesCatalog ?? true,
      fetchSeriesCategories: value.fetchSeriesCategories ?? noopAsync,
      fetchSeriesStreams: value.fetchSeriesStreams ?? noopAsync,
    }),
    [
      value.seriesCategories,
      value.seriesStreams,
      value.allSeriesStreams,
      value.seriesCategoriesStatus,
      value.seriesCatalogStatus,
      value.seriesCategoriesError,
      value.seriesError,
      value.loadingSeries,
      value.loadedSeriesCatalog,
      value.fetchSeriesCategories,
      value.fetchSeriesStreams,
      noopAsync,
    ]
  );

  const aggregatedValue = useMemo<XtreamContextData>(
    () => ({
      ...credentialsValue,
      ...sessionValue,
      ...liveValue,
      ...vodValue,
      ...seriesValue,
      categoriesError: value.categoriesError ?? null,
      error: value.error ?? null,
    }),
    [
      credentialsValue,
      sessionValue,
      liveValue,
      vodValue,
      seriesValue,
      value.categoriesError,
      value.error,
    ]
  );

  return (
    <XtreamCredentialsContext.Provider value={credentialsValue}>
      <XtreamSessionContext.Provider value={sessionValue}>
        <XtreamLiveContext.Provider value={liveValue}>
          <XtreamVodContext.Provider value={vodValue}>
            <XtreamSeriesContext.Provider value={seriesValue}>
              <XtreamContext.Provider value={aggregatedValue}>
                {children}
              </XtreamContext.Provider>
            </XtreamSeriesContext.Provider>
          </XtreamVodContext.Provider>
        </XtreamLiveContext.Provider>
      </XtreamSessionContext.Provider>
    </XtreamCredentialsContext.Provider>
  );
}

function allVodStreamsDeps(arr: VodStream[] | undefined) {
  return arr;
}

export function useXtreamCredentials(): XtreamCredentialsContextData {
  const context = useContext(XtreamCredentialsContext);
  if (context === undefined) {
    throw new Error(
      "useXtreamCredentials must be used within a XtreamProvider"
    );
  }
  return context;
}

export function useOptionalXtreamCredentials(): XtreamCredentials | null {
  const context = useContext(XtreamCredentialsContext);
  return context?.credentials ?? null;
}

export function useXtreamSession(): XtreamSessionContextData {
  const context = useContext(XtreamSessionContext);
  if (context === undefined) {
    throw new Error("useXtreamSession must be used within a XtreamProvider");
  }
  return context;
}

export function useXtreamLive(): XtreamLiveContextData {
  const context = useContext(XtreamLiveContext);
  if (context === undefined) {
    throw new Error("useXtreamLive must be used within a XtreamProvider");
  }
  return context;
}

export function useXtreamVod(): XtreamVodContextData {
  const context = useContext(XtreamVodContext);
  if (context === undefined) {
    throw new Error("useXtreamVod must be used within a XtreamProvider");
  }
  return context;
}

export function useXtreamSeries(): XtreamSeriesContextData {
  const context = useContext(XtreamSeriesContext);
  if (context === undefined) {
    throw new Error("useXtreamSeries must be used within a XtreamProvider");
  }
  return context;
}

export function useXtreamContext() {
  const context = useContext(XtreamContext);
  if (context === undefined) {
    throw new Error("useXtreamContext must be used within a XtreamProvider");
  }
  return context;
}
