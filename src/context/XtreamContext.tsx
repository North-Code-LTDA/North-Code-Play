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
  invalidateXtreamCoordinatorSession,
  type XtreamRequestPriority,
} from "../services/xtreamRequestCoordinator";
import { clearHeroSessionCache } from "../services/heroSessionCache";
import { clearLiveEpgSessionCache } from "../utils/liveEpgManager";
import {
  buildReconciledCredentialsFromAuth,
  getCredentialsIdentityKey,
  isLegacyAmbiguousOutputFormats,
  markCredentialsAuthRejected,
  safePersistReconciledCredentials,
  safeSaveCredentials,
} from "../utils/accountUtils";
import {
  getOrCreateLiveIndex,
  getOrCreateVodIndex,
  getOrCreateSeriesIndex,
  buildLiveIndexAsync,
  buildVodIndexAsync,
  buildSeriesIndexAsync,
  RankedCatalogIndex,
} from "../utils/catalogIndex";

export type OperationStatus = "idle" | "loading" | "ready" | "error";

export type OperationType =
  | "live_categories"
  | "vod_categories"
  | "series_categories"
  | "live_catalog"
  | "vod_catalog"
  | "series_catalog";

export interface CategoryCatalogCacheEntry<T> {
  categoryId: string;
  items: T[];
  index: RankedCatalogIndex<T>;
  loadedAt: number;
}

const MAX_SESSION_CATEGORY_CACHE_ENTRIES = 12;

function storeCategoryCacheEntry<T>(
  cache: Map<string, CategoryCatalogCacheEntry<T>>,
  categoryId: string,
  items: T[],
  index: RankedCatalogIndex<T>
): void {
  if (cache.has(categoryId)) {
    cache.delete(categoryId);
  } else if (cache.size >= MAX_SESSION_CATEGORY_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      cache.delete(oldestKey);
    }
  }
  cache.set(categoryId, {
    categoryId,
    items,
    index,
    loadedAt: Date.now(),
  });
}

function itemBelongsToRequestedCategory(
  item: {
    category_id?: string | number | null;
    category_ids?: Array<string | number> | null;
  },
  requestedCategoryId: string
): boolean {
  const target = String(requestedCategoryId).trim();
  if (!target) return false;
  const primary =
    item.category_id !== undefined && item.category_id !== null
      ? String(item.category_id).trim()
      : "";
  if (primary === target) {
    return true;
  }
  if (Array.isArray(item.category_ids)) {
    for (const cid of item.category_ids) {
      if (cid !== null && cid !== undefined && String(cid).trim() === target) {
        return true;
      }
    }
  }
  return false;
}

export function inspectCategoryFilterCompliance<
  T extends {
    category_id?: string | number | null;
    category_ids?: Array<string | number> | null;
  }
>(
  items: T[],
  requestedCategoryId: string
): {
  compliant: boolean;
  matchingItems: T[];
  outOfCategoryCount: number;
} {
  if (!Array.isArray(items) || items.length === 0) {
    return {
      compliant: true,
      matchingItems: [],
      outOfCategoryCount: 0,
    };
  }
  const matchingItems: T[] = [];
  let outOfCategoryCount = 0;
  for (const item of items) {
    if (item && itemBelongsToRequestedCategory(item, requestedCategoryId)) {
      matchingItems.push(item);
    } else {
      outOfCategoryCount++;
    }
  }
  return {
    compliant: outOfCategoryCount === 0,
    matchingItems,
    outOfCategoryCount,
  };
}

export interface XtreamCredentialsContextData {
  credentials: XtreamCredentials | null;
}

export interface XtreamSessionContextData {
  sessionReady: boolean;
  initialCategoriesReady: boolean;
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
  vodCategoryStatus: OperationStatus;
  vodCategoriesError: string | null;
  vodError: string | null;
  vodCategoryError: string | null;
  activeVodCategoryId: string | null;
  vodProviderSupportsCategoryFilter: boolean;
  loadingVod: boolean;
  loadedVodCatalog: boolean;
  fetchVodCategories: () => Promise<void>;
  fetchVodStreams: (categoryId?: string) => Promise<void>;
  isVodCategoryLoaded: (categoryId: string) => boolean;
  getVodCategoryStreams: (categoryId: string) => VodStream[];
  getPartialVodStreamsForSearch: () => VodStream[];
}

export interface XtreamSeriesContextData {
  seriesCategories: Category[];
  seriesStreams: SeriesStream[];
  allSeriesStreams: SeriesStream[];
  seriesCategoriesStatus: OperationStatus;
  seriesCatalogStatus: OperationStatus;
  seriesCategoryStatus: OperationStatus;
  seriesCategoriesError: string | null;
  seriesError: string | null;
  seriesCategoryError: string | null;
  activeSeriesCategoryId: string | null;
  seriesProviderSupportsCategoryFilter: boolean;
  loadingSeries: boolean;
  loadedSeriesCatalog: boolean;
  fetchSeriesCategories: () => Promise<void>;
  fetchSeriesStreams: (categoryId?: string) => Promise<void>;
  isSeriesCategoryLoaded: (categoryId: string) => boolean;
  getSeriesCategoryStreams: (categoryId: string) => SeriesStream[];
  getPartialSeriesStreamsForSearch: () => SeriesStream[];
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

interface InFlightOperationEntry {
  priority: number;
  promise: Promise<void>;
  elevate?: (priority: XtreamRequestPriority, priorityHint: number) => void;
}

const OPERATION_TO_ACTION: Record<OperationType, string> = {
  live_categories: "get_live_categories",
  vod_categories: "get_vod_categories",
  series_categories: "get_series_categories",
  live_catalog: "get_live_streams",
  vod_catalog: "get_vod_streams",
  series_catalog: "get_series",
};

function mapOperationPriorityToCoordinator(priority: number): {
  priority: XtreamRequestPriority;
  priorityHint: number;
} {
  if (priority >= 100) {
    return { priority: "user", priorityHint: 10 };
  }
  if (priority >= 5) {
    return { priority: "high", priorityHint: priority };
  }
  if (priority >= 3) {
    return { priority: "normal", priorityHint: priority };
  }
  return { priority: "background", priorityHint: priority };
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
  const activeSessionIdentityRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const credentialsPropRef = useRef<XtreamCredentials | null>(credentials);
  credentialsPropRef.current = credentials;

  // Live reconciled metadata for legacy sessions (scoped strictly to prop identityKey
  // so updating metadata updates active consumers immediately WITHOUT restarting catalog effects)
  const [reconciledCredentialsEntry, setReconciledCredentialsEntry] = useState<{
    identityKey: string;
    credentials: XtreamCredentials;
  } | null>(null);
  const reconciledEntryRef = useRef<{
    identityKey: string;
    credentials: XtreamCredentials;
  } | null>(null);
  reconciledEntryRef.current = reconciledCredentialsEntry;
  const legacyReconcileAttemptedKeyRef = useRef<string | null>(null);

  const propIdentityKey = getCredentialsIdentityKey(credentials);
  const effectiveCredentials = useMemo<XtreamCredentials | null>(() => {
    if (!credentials) return null;
    if (
      reconciledCredentialsEntry &&
      propIdentityKey &&
      reconciledCredentialsEntry.identityKey === propIdentityKey
    ) {
      return reconciledCredentialsEntry.credentials;
    }
    return credentials;
  }, [credentials, propIdentityKey, reconciledCredentialsEntry]);
  const effectiveCredentialsRef = useRef<XtreamCredentials | null>(effectiveCredentials);
  effectiveCredentialsRef.current = effectiveCredentials;

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

  // Progressive single-category statuses and active selection
  const [vodCategoryStatus, setVodCategoryStatus] =
    useState<OperationStatus>("idle");
  const [seriesCategoryStatus, setSeriesCategoryStatus] =
    useState<OperationStatus>("idle");
  const [activeVodCategoryId, setActiveVodCategoryId] = useState<string | null>(
    null
  );
  const [activeSeriesCategoryId, setActiveSeriesCategoryId] = useState<
    string | null
  >(null);
  const [
    vodProviderSupportsCategoryFilter,
    setVodProviderSupportsCategoryFilter,
  ] = useState<boolean>(true);
  const [
    seriesProviderSupportsCategoryFilter,
    setSeriesProviderSupportsCategoryFilter,
  ] = useState<boolean>(true);
  const [vodCategoryCacheVersion, setVodCategoryCacheVersion] =
    useState<number>(0);
  const [seriesCategoryCacheVersion, setSeriesCategoryCacheVersion] =
    useState<number>(0);

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
  const [vodCategoryError, setVodCategoryError] = useState<string | null>(null);
  const [seriesCategoryError, setSeriesCategoryError] = useState<string | null>(
    null
  );

  // Auth rejection state (distinct from transient errors)
  const [isAuthRejected, setIsAuthRejected] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const isAuthRejectedRef = useRef<boolean>(false);
  isAuthRejectedRef.current = isAuthRejected;
  const AUTH_RECHECK_COOLDOWN_MS = 15000;
  const authRecheckInFlightRef = useRef<{
    session: number;
    promise: Promise<{ rejected: boolean; message?: string }>;
  } | null>(null);
  const lastAuthRecheckRef = useRef<{
    session: number;
    completedAt: number;
  } | null>(null);

  const isAbortedOperation = useCallback(
    (err: any, signal?: AbortSignal): boolean =>
      Boolean(
        signal?.aborted ||
          err?.isAborted === true ||
          err?.message === "Operação cancelada pelo usuário."
      ),
    []
  );

  const registerErrorAndCheckAuth = useCallback(
    async (
      err: any,
      currentSession: number,
      signal?: AbortSignal
    ): Promise<string> => {
      const fallbackMsg =
        err?.message || "Falha ao comunicar com o servidor do provedor.";

      if (isAbortedOperation(err, signal)) {
        return fallbackMsg;
      }

      if (isAuthenticationRejectedError(err)) {
        if (sessionRef.current === currentSession) {
          isAuthRejectedRef.current = true;
          setIsAuthRejected(true);
          setAuthError(fallbackMsg);
          markCredentialsAuthRejected(fallbackMsg);
        }
        return fallbackMsg;
      }

      // Restringe rechecagem via authenticate() apenas a casos pertinentes:
      // HTTP 401 em endpoint de recurso ou objeto JSON inesperado onde se esperava lista de catálogo.
      // Nunca dispara rechecagem nem invalida credenciais em HTTP 403, 404, 429, 408, 5xx, rede,
      // timeout, resposta vazia/HTML/JSON inválido ou cancelamento.
      const shouldRecheckAuth = Boolean(
        credentials &&
          sessionRef.current === currentSession &&
          !isAuthRejectedRef.current &&
          !err?.isTransient &&
          !err?.isRateLimited &&
          err?.status !== 403 &&
          (err?.requiresAuthRecheck === true || err?.status === 401)
      );

      if (shouldRecheckAuth && credentials) {
        let recheckPromise: Promise<{ rejected: boolean; message?: string }>;
        if (
          authRecheckInFlightRef.current &&
          authRecheckInFlightRef.current.session === currentSession
        ) {
          recheckPromise = authRecheckInFlightRef.current.promise;
        } else {
          const lastRecheck = lastAuthRecheckRef.current;
          if (
            lastRecheck &&
            lastRecheck.session === currentSession &&
            Date.now() - lastRecheck.completedAt < AUTH_RECHECK_COOLDOWN_MS
          ) {
            return fallbackMsg;
          }

          recheckPromise = XtreamService.authenticate(credentials, {
            signal,
            lane: "auth",
            priority: "critical",
          })
            .then((authRes) => {
              if (sessionRef.current === currentSession && !signal?.aborted) {
                lastAuthRecheckRef.current = {
                  session: currentSession,
                  completedAt: Date.now(),
                };
                const currentEffective = effectiveCredentialsRef.current;
                const currentId = getCredentialsIdentityKey(credentialsPropRef.current);
                if (
                  currentEffective &&
                  currentId &&
                  currentId === getCredentialsIdentityKey(credentials) &&
                  isLegacyAmbiguousOutputFormats(currentEffective)
                ) {
                  const reconciled = buildReconciledCredentialsFromAuth(
                    currentEffective,
                    authRes
                  );
                  setReconciledCredentialsEntry({
                    identityKey: currentId,
                    credentials: reconciled,
                  });
                  safePersistReconciledCredentials(reconciled);
                }
              }
              return { rejected: false };
            })
            .catch((authCheckErr: any) => {
              if (
                sessionRef.current === currentSession &&
                !isAbortedOperation(authCheckErr, signal) &&
                isAuthenticationRejectedError(authCheckErr)
              ) {
                return {
                  rejected: true,
                  message:
                    authCheckErr?.message ||
                    "Usuário ou senha inválidos ou conta desativada.",
                };
              }
              if (
                sessionRef.current === currentSession &&
                !isAbortedOperation(authCheckErr, signal)
              ) {
                lastAuthRecheckRef.current = {
                  session: currentSession,
                  completedAt: Date.now(),
                };
              }
              return { rejected: false };
            })
            .finally(() => {
              if (authRecheckInFlightRef.current?.session === currentSession) {
                authRecheckInFlightRef.current = null;
              }
            });

          authRecheckInFlightRef.current = {
            session: currentSession,
            promise: recheckPromise,
          };
        }

        const result = await recheckPromise;
        if (
          result.rejected &&
          sessionRef.current === currentSession &&
          !signal?.aborted
        ) {
          const authMsg =
            result.message || "Usuário ou senha inválidos ou conta desativada.";
          if (err && typeof err === "object") {
            err.isAuthError = true;
          }
          isAuthRejectedRef.current = true;
          setIsAuthRejected(true);
          setAuthError(authMsg);
          markCredentialsAuthRejected(authMsg);
          return authMsg;
        }
      }

      return fallbackMsg;
    },
    [credentials, isAbortedOperation]
  );

  // Status refs for stable action callbacks across status transitions
  const liveCatalogStatusRef = useRef<OperationStatus>("idle");
  liveCatalogStatusRef.current = liveCatalogStatus;
  const vodCatalogStatusRef = useRef<OperationStatus>("idle");
  vodCatalogStatusRef.current = vodCatalogStatus;
  const seriesCatalogStatusRef = useRef<OperationStatus>("idle");
  seriesCatalogStatusRef.current = seriesCatalogStatus;

  // Full-catalog memory references
  const allLiveStreamsRef = useRef<LiveStream[]>([]);
  const allVodStreamsRef = useRef<VodStream[]>([]);
  const allSeriesStreamsRef = useRef<SeriesStream[]>([]);

  // Most recent category selection per domain to prevent race conditions
  const latestLiveCategoryRef = useRef<string | undefined>(undefined);
  const latestVodCategoryRef = useRef<string | undefined>(undefined);
  const latestSeriesCategoryRef = useRef<string | undefined>(undefined);

  // Bounded session-scoped category caches (cleared when global catalog becomes ready or session resets)
  const vodCategoryCacheRef = useRef<
    Map<string, CategoryCatalogCacheEntry<VodStream>>
  >(new Map());
  const seriesCategoryCacheRef = useRef<
    Map<string, CategoryCatalogCacheEntry<SeriesStream>>
  >(new Map());
  const inFlightVodCategoriesRef = useRef<
    Map<string, InFlightOperationEntry>
  >(new Map());
  const inFlightSeriesCategoriesRef = useRef<
    Map<string, InFlightOperationEntry>
  >(new Map());
  const vodProviderSupportsCategoryFilterRef = useRef<boolean>(true);
  const seriesProviderSupportsCategoryFilterRef = useRef<boolean>(true);

  // In-flight domain operation promises (deduplicação de estado React; concorrência e fila delegadas ao coordenador compartilhado)
  const inFlightOperationsRef = useRef<
    Map<OperationType, InFlightOperationEntry>
  >(new Map());

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

  /**
   * Coordena uma operação de catálogo/categoria deduplicada por domínio,
   * delegando limites de concorrência (2 catálogos / 4 global), prioridade
   * e rate-limit ao coordenador compartilhado via XtreamService.
   */
  const enqueueOperation = useCallback(
    (
      type: OperationType,
      priority: number,
      task: (
        signal: AbortSignal,
        coordPriority: {
          priority: XtreamRequestPriority;
          priorityHint: number;
        }
      ) => Promise<void>
    ): Promise<void> => {
      const mappedPriority = mapOperationPriorityToCoordinator(priority);

      const existing = inFlightOperationsRef.current.get(type);
      if (existing) {
        if (priority > existing.priority) {
          existing.priority = priority;
          existing.elevate?.(
            mappedPriority.priority,
            mappedPriority.priorityHint
          );
        }
        return existing.promise;
      }

      // Mark status as loading and clear error IMMEDIATELY upon enqueuing
      setOperationStatus(type, "loading");
      clearOperationError(type);

      const opSession = sessionRef.current;
      const currentSignal =
        abortControllerRef.current?.signal || new AbortController().signal;
      const credsAtStart = credentialsPropRef.current;

      const entry: InFlightOperationEntry = {
        priority,
        promise: Promise.resolve(),
        elevate: (nextPriority, nextHint) => {
          XtreamService.elevateRequestPriority(
            credsAtStart,
            OPERATION_TO_ACTION[type],
            {},
            nextPriority,
            nextHint
          );
        },
      };

      const promise = (async () => {
        try {
          if (currentSignal.aborted || sessionRef.current !== opSession) {
            return;
          }
          await task(currentSignal, mappedPriority);
        } catch {
          // Internal catch ensures tasks don't leave unhandled promise rejections
        } finally {
          if (
            sessionRef.current === opSession &&
            inFlightOperationsRef.current.get(type) === entry
          ) {
            inFlightOperationsRef.current.delete(type);
          }
        }
      })();

      entry.promise = promise;
      inFlightOperationsRef.current.set(type, entry);
      return promise;
    },
    [setOperationStatus, clearOperationError]
  );

  // Limpeza completa de caches/coordenador no unmount do provider (ex.: saída para tela de Login)
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      vodCategoryCacheRef.current.clear();
      seriesCategoryCacheRef.current.clear();
      inFlightVodCategoriesRef.current.clear();
      inFlightSeriesCategoriesRef.current.clear();
      if (activeSessionIdentityRef.current !== null) {
        activeSessionIdentityRef.current = null;
        clearLiveEpgSessionCache();
        clearHeroSessionCache();
        invalidateXtreamCoordinatorSession();
      }
    };
  }, []);

  // Reset and cancel all work on credentials change
  useEffect(() => {
    // Invalidate previous session
    sessionRef.current++;
    const currentSession = sessionRef.current;
    const nextIdentityKey = getCredentialsIdentityKey(credentials);
    const prevIdentityKey = activeSessionIdentityRef.current;

    // Abort active HTTP calls
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    if (prevIdentityKey !== null && prevIdentityKey !== nextIdentityKey) {
      clearLiveEpgSessionCache();
      clearHeroSessionCache();
      invalidateXtreamCoordinatorSession();
    }
    activeSessionIdentityRef.current = nextIdentityKey;

    inFlightOperationsRef.current.clear();
    inFlightVodCategoriesRef.current.clear();
    inFlightSeriesCategoriesRef.current.clear();
    vodCategoryCacheRef.current.clear();
    seriesCategoryCacheRef.current.clear();
    setVodCategoryCacheVersion((v) => v + 1);
    setSeriesCategoryCacheVersion((v) => v + 1);
    vodProviderSupportsCategoryFilterRef.current = true;
    seriesProviderSupportsCategoryFilterRef.current = true;
    setVodProviderSupportsCategoryFilter(true);
    setSeriesProviderSupportsCategoryFilter(true);
    authRecheckInFlightRef.current = null;
    lastAuthRecheckRef.current = null;

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
    setActiveVodCategoryId(null);
    setActiveSeriesCategoryId(null);

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
    setVodCategoryStatus("idle");
    setSeriesCategoryStatus("idle");

    setLiveCategoriesError(null);
    setVodCategoriesError(null);
    setSeriesCategoriesError(null);
    setLiveError(null);
    setVodError(null);
    setSeriesError(null);
    setVodCategoryError(null);
    setSeriesCategoryError(null);

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

    // Queue initial category fetches with controlled priority: Live TV first (priority 6), VOD (4), Series (3)
    enqueueOperation("live_categories", 6, async (signal, coordPrio) => {
      if (sessionRef.current !== currentSession || signal.aborted) {
        return;
      }
      try {
        const cats = await XtreamService.getLiveCategories(credentials, {
          signal,
          lane: "catalog",
          priority: coordPrio.priority,
          priorityHint: coordPrio.priorityHint,
        });
        if (sessionRef.current !== currentSession || signal.aborted) {
          return;
        }
        setLiveCategories(cats);
        setLiveCategoriesStatus("ready");
      } catch (err: any) {
        if (
          sessionRef.current !== currentSession ||
          isAbortedOperation(err, signal)
        ) {
          return;
        }
        const msg = await registerErrorAndCheckAuth(
          err,
          currentSession,
          signal
        );
        if (sessionRef.current !== currentSession || signal.aborted) {
          return;
        }
        setLiveCategoriesError(
          msg || "Falha ao carregar categorias de TV."
        );
        setLiveCategoriesStatus("error");
      }
    });

    enqueueOperation("vod_categories", 4, async (signal, coordPrio) => {
      if (sessionRef.current !== currentSession || signal.aborted) {
        return;
      }
      try {
        const cats = await XtreamService.getVodCategories(credentials, {
          signal,
          lane: "catalog",
          priority: coordPrio.priority,
          priorityHint: coordPrio.priorityHint,
        });
        if (sessionRef.current !== currentSession || signal.aborted) {
          return;
        }
        setVodCategories(cats);
        setVodCategoriesStatus("ready");
      } catch (err: any) {
        if (
          sessionRef.current !== currentSession ||
          isAbortedOperation(err, signal)
        ) {
          return;
        }
        const msg = await registerErrorAndCheckAuth(
          err,
          currentSession,
          signal
        );
        if (sessionRef.current !== currentSession || signal.aborted) {
          return;
        }
        setVodCategoriesError(
          msg || "Falha ao carregar categorias de filmes."
        );
        setVodCategoriesStatus("error");
      }
    });

    enqueueOperation("series_categories", 3, async (signal, coordPrio) => {
      if (sessionRef.current !== currentSession || signal.aborted) {
        return;
      }
      try {
        const cats = await XtreamService.getSeriesCategories(credentials, {
          signal,
          lane: "catalog",
          priority: coordPrio.priority,
          priorityHint: coordPrio.priorityHint,
        });
        if (sessionRef.current !== currentSession || signal.aborted) {
          return;
        }
        setSeriesCategories(cats);
        setSeriesCategoriesStatus("ready");
      } catch (err: any) {
        if (
          sessionRef.current !== currentSession ||
          isAbortedOperation(err, signal)
        ) {
          return;
        }
        const msg = await registerErrorAndCheckAuth(
          err,
          currentSession,
          signal
        );
        if (sessionRef.current !== currentSession || signal.aborted) {
          return;
        }
        setSeriesCategoriesError(
          msg || "Falha ao carregar categorias de séries."
        );
        setSeriesCategoriesStatus("error");
      }
    });

    // Mark current session as fully initialized and ready for component consumer requests
    setSessionReady(true);

    return () => {
      abortControllerRef.current?.abort();
    };
  }, [credentials, enqueueOperation, registerErrorAndCheckAuth, isAbortedOperation]);

  // One-shot reconciliation restricted strictly to ambiguous legacy sessions where
  // pre-X01.c–e Login persisted `allowed_output_formats: []` without provider confirmation.
  useEffect(() => {
    if (!credentials || !propIdentityKey) {
      legacyReconcileAttemptedKeyRef.current = null;
      setReconciledCredentialsEntry(null);
      return;
    }

    // Drop stale reconciled entry if switching to a different credential identity
    if (
      reconciledEntryRef.current &&
      reconciledEntryRef.current.identityKey !== propIdentityKey
    ) {
      setReconciledCredentialsEntry(null);
    }

    // If this identity was already reconciled in this provider lifecycle, skip
    if (reconciledEntryRef.current?.identityKey === propIdentityKey) {
      return;
    }

    if (!isLegacyAmbiguousOutputFormats(credentials)) {
      return;
    }

    const currentSession = sessionRef.current;
    const attemptKey = `${currentSession}:${propIdentityKey}`;
    if (legacyReconcileAttemptedKeyRef.current === attemptKey) {
      return;
    }
    legacyReconcileAttemptedKeyRef.current = attemptKey;

    const controller = new AbortController();
    const credsSnapshot = credentials;

    XtreamService.authenticate(credsSnapshot, {
      signal: controller.signal,
      lane: "auth",
      priority: "background",
    })
      .then((authResponse) => {
        if (
          controller.signal.aborted ||
          sessionRef.current !== currentSession ||
          getCredentialsIdentityKey(credentialsPropRef.current) !== propIdentityKey
        ) {
          return;
        }
        const reconciled = buildReconciledCredentialsFromAuth(
          credsSnapshot,
          authResponse
        );
        setReconciledCredentialsEntry({
          identityKey: propIdentityKey,
          credentials: reconciled,
        });
        safePersistReconciledCredentials(reconciled);
      })
      .catch((err: any) => {
        if (
          controller.signal.aborted ||
          isAbortedOperation(err, controller.signal) ||
          sessionRef.current !== currentSession ||
          getCredentialsIdentityKey(credentialsPropRef.current) !== propIdentityKey
        ) {
          return;
        }
        if (isAuthenticationRejectedError(err)) {
          const msg =
            err?.message || "Usuário ou senha inválidos ou conta desativada.";
          isAuthRejectedRef.current = true;
          setIsAuthRejected(true);
          setAuthError(msg);
          markCredentialsAuthRejected(msg);
        }
        // Transient failures preserve credentials untouched without assuming permissions or retrying automatically
      });

    return () => {
      controller.abort();
    };
  }, [credentials, propIdentityKey, isAbortedOperation]);

  // Actions for Categories
  const fetchLiveCategories = useCallback(async () => {
    if (!credentials) return;
    const currentSession = sessionRef.current;
    return enqueueOperation("live_categories", 100, async (signal, coordPrio) => {
      if (sessionRef.current !== currentSession || signal.aborted) {
        return;
      }
      try {
        const cats = await XtreamService.getLiveCategories(credentials, {
          signal,
          lane: "catalog",
          priority: coordPrio.priority,
          priorityHint: coordPrio.priorityHint,
        });
        if (sessionRef.current !== currentSession || signal.aborted) {
          return;
        }
        setLiveCategories(cats);
        setLiveCategoriesStatus("ready");
      } catch (err: any) {
        if (
          sessionRef.current !== currentSession ||
          isAbortedOperation(err, signal)
        ) {
          return;
        }
        const msg = await registerErrorAndCheckAuth(
          err,
          currentSession,
          signal
        );
        if (sessionRef.current !== currentSession || signal.aborted) {
          return;
        }
        setLiveCategoriesError(
          msg || "Falha ao carregar categorias de TV."
        );
        setLiveCategoriesStatus("error");
      }
    });
  }, [credentials, enqueueOperation, registerErrorAndCheckAuth, isAbortedOperation]);

  const fetchVodCategories = useCallback(async () => {
    if (!credentials) return;
    const currentSession = sessionRef.current;
    return enqueueOperation("vod_categories", 100, async (signal, coordPrio) => {
      if (sessionRef.current !== currentSession || signal.aborted) {
        return;
      }
      try {
        const cats = await XtreamService.getVodCategories(credentials, {
          signal,
          lane: "catalog",
          priority: coordPrio.priority,
          priorityHint: coordPrio.priorityHint,
        });
        if (sessionRef.current !== currentSession || signal.aborted) {
          return;
        }
        setVodCategories(cats);
        setVodCategoriesStatus("ready");
      } catch (err: any) {
        if (
          sessionRef.current !== currentSession ||
          isAbortedOperation(err, signal)
        ) {
          return;
        }
        const msg = await registerErrorAndCheckAuth(
          err,
          currentSession,
          signal
        );
        if (sessionRef.current !== currentSession || signal.aborted) {
          return;
        }
        setVodCategoriesError(
          msg || "Falha ao carregar categorias de filmes."
        );
        setVodCategoriesStatus("error");
      }
    });
  }, [credentials, enqueueOperation, registerErrorAndCheckAuth, isAbortedOperation]);

  const fetchSeriesCategories = useCallback(async () => {
    if (!credentials) return;
    const currentSession = sessionRef.current;
    return enqueueOperation("series_categories", 100, async (signal, coordPrio) => {
      if (sessionRef.current !== currentSession || signal.aborted) {
        return;
      }
      try {
        const cats = await XtreamService.getSeriesCategories(credentials, {
          signal,
          lane: "catalog",
          priority: coordPrio.priority,
          priorityHint: coordPrio.priorityHint,
        });
        if (sessionRef.current !== currentSession || signal.aborted) {
          return;
        }
        setSeriesCategories(cats);
        setSeriesCategoriesStatus("ready");
      } catch (err: any) {
        if (
          sessionRef.current !== currentSession ||
          isAbortedOperation(err, signal)
        ) {
          return;
        }
        const msg = await registerErrorAndCheckAuth(
          err,
          currentSession,
          signal
        );
        if (sessionRef.current !== currentSession || signal.aborted) {
          return;
        }
        setSeriesCategoriesError(
          msg || "Falha ao carregar categorias de séries."
        );
        setSeriesCategoriesStatus("error");
      }
    });
  }, [credentials, enqueueOperation, registerErrorAndCheckAuth, isAbortedOperation]);

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

      return enqueueOperation("live_catalog", priority, async (signal, coordPrio) => {
        if (sessionRef.current !== currentSession || signal.aborted) {
          return;
        }
        try {
          const streams = await XtreamService.getLiveStreams(credentials, undefined, {
            signal,
            lane: "catalog",
            priority: coordPrio.priority,
            priorityHint: coordPrio.priorityHint,
          });
          if (sessionRef.current !== currentSession || signal.aborted) {
            return;
          }
          const liveIdx = await buildLiveIndexAsync(streams, {
            signal,
            shouldCancel: () => sessionRef.current !== currentSession || signal.aborted,
          });
          if (!liveIdx || sessionRef.current !== currentSession || signal.aborted) {
            return;
          }
          allLiveStreamsRef.current = streams;
          setAllLiveStreams(streams);
          liveCatalogStatusRef.current = "ready";
          setLiveCatalogStatus("ready");

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
            isAbortedOperation(err, signal)
          ) {
            return;
          }
          const msg = await registerErrorAndCheckAuth(
            err,
            currentSession,
            signal
          );
          if (sessionRef.current !== currentSession || signal.aborted) {
            return;
          }
          setLiveError(msg || "Falha ao carregar canais ao vivo.");
          liveCatalogStatusRef.current = "error";
          setLiveCatalogStatus("error");
        }
      });
    },
    [credentials, enqueueOperation, registerErrorAndCheckAuth, isAbortedOperation]
  );

  // VOD Global Catalog Fetch helper
  const enqueueGlobalVodCatalog = useCallback(
    (priority: number): Promise<void> => {
      if (!credentials) return Promise.resolve();
      const currentSession = sessionRef.current;
      return enqueueOperation("vod_catalog", priority, async (signal, coordPrio) => {
        if (sessionRef.current !== currentSession || signal.aborted) {
          return;
        }
        try {
          const streams = await XtreamService.getVodStreams(credentials, undefined, {
            signal,
            lane: "catalog",
            priority: coordPrio.priority,
            priorityHint: coordPrio.priorityHint,
          });
          if (sessionRef.current !== currentSession || signal.aborted) {
            return;
          }
          const vodIdx = await buildVodIndexAsync(streams, {
            signal,
            shouldCancel: () => sessionRef.current !== currentSession || signal.aborted,
          });
          if (!vodIdx || sessionRef.current !== currentSession || signal.aborted) {
            return;
          }
          allVodStreamsRef.current = streams;
          setAllVodStreams(streams);
          vodCatalogStatusRef.current = "ready";
          setVodCatalogStatus("ready");

          // Free partial category caches once global catalog and index are ready
          if (vodCategoryCacheRef.current.size > 0) {
            vodCategoryCacheRef.current.clear();
            setVodCategoryCacheVersion((v) => v + 1);
          }

          // Always respect most recent category selection
          const targetCat = latestVodCategoryRef.current;
          if (targetCat) {
            setVodStreams(vodIdx.getByCategory(targetCat));
            setVodCategoryStatus("ready");
            setVodCategoryError(null);
          } else {
            setVodStreams(streams);
          }
        } catch (err: any) {
          if (
            sessionRef.current !== currentSession ||
            isAbortedOperation(err, signal)
          ) {
            return;
          }
          const msg = await registerErrorAndCheckAuth(
            err,
            currentSession,
            signal
          );
          if (sessionRef.current !== currentSession || signal.aborted) {
            return;
          }
          setVodError(msg || "Falha ao carregar filmes.");
          vodCatalogStatusRef.current = "error";
          setVodCatalogStatus("error");
          if (latestVodCategoryRef.current) {
            setVodCategoryError(msg || "Falha ao carregar filmes.");
            setVodCategoryStatus("error");
          }
        }
      });
    },
    [credentials, enqueueOperation, registerErrorAndCheckAuth, isAbortedOperation]
  );

  // VOD Streams Catalog Fetch (Progressive: category-first when full catalog not yet started, index reuse when full catalog ready)
  const fetchVodStreams = useCallback(
    async (categoryId?: string) => {
      if (!credentials) return;
      const normalizedCategoryId =
        categoryId !== undefined &&
        categoryId !== null &&
        String(categoryId).trim() !== ""
          ? String(categoryId).trim()
          : undefined;

      // Record most recent category requested
      latestVodCategoryRef.current = normalizedCategoryId;
      setActiveVodCategoryId(normalizedCategoryId ?? null);

      // Rule 1: If global catalog is already loaded and ready, use exclusively its O(1) local index
      if (vodCatalogStatusRef.current === "ready") {
        const source = allVodStreamsRef.current;
        if (normalizedCategoryId) {
          setVodStreams(getOrCreateVodIndex(source).getByCategory(normalizedCategoryId));
          setVodCategoryStatus("ready");
          setVodCategoryError(null);
        } else {
          setVodStreams(source);
          setVodCategoryStatus("idle");
          setVodCategoryError(null);
        }
        return;
      }

      // Global catalog requested explicitly (e.g., Showcase, HeroBanner, Global Search, "Ver todos")
      if (!normalizedCategoryId) {
        return enqueueGlobalVodCatalog(2);
      }

      // Rule 2: If category is already available in the session category cache, reuse its data and index immediately
      const cachedCategory = vodCategoryCacheRef.current.get(normalizedCategoryId);
      if (cachedCategory) {
        vodCategoryCacheRef.current.delete(normalizedCategoryId);
        vodCategoryCacheRef.current.set(normalizedCategoryId, {
          ...cachedCategory,
          loadedAt: Date.now(),
        });
        setVodStreams(cachedCategory.items);
        setVodCategoryStatus("ready");
        setVodCategoryError(null);
        return;
      }

      // Rule 4 & 5: If a full catalog query is ALREADY in flight, avoid firing a redundant query;
      // elevate its priority if still queued and reuse the complete response when it arrives.
      const existingGlobalOp = inFlightOperationsRef.current.get("vod_catalog");
      if (existingGlobalOp) {
        if (100 > existingGlobalOp.priority) {
          existingGlobalOp.priority = 100;
          const mapped = mapOperationPriorityToCoordinator(100);
          existingGlobalOp.elevate?.(mapped.priority, mapped.priorityHint);
        }
        setVodCategoryStatus("loading");
        setVodCategoryError(null);
        return existingGlobalOp.promise;
      }

      // Section 8: If provider was already detected as incompatible with category_id in this session, fall back to full catalog
      if (!vodProviderSupportsCategoryFilterRef.current) {
        setVodCategoryStatus("loading");
        setVodCategoryError(null);
        return enqueueGlobalVodCatalog(100);
      }

      // Share identical in-flight category query
      const existingCatOp = inFlightVodCategoriesRef.current.get(normalizedCategoryId);
      if (existingCatOp) {
        if (100 > existingCatOp.priority) {
          existingCatOp.priority = 100;
          const mapped = mapOperationPriorityToCoordinator(100);
          existingCatOp.elevate?.(mapped.priority, mapped.priorityHint);
        }
        setVodCategoryStatus("loading");
        setVodCategoryError(null);
        return existingCatOp.promise;
      }

      // Rule 3: Full catalog has not started and user requested a specific category -> prioritize filtered query
      const currentSession = sessionRef.current;
      const currentSignal =
        abortControllerRef.current?.signal || new AbortController().signal;
      const credsAtStart = credentialsPropRef.current;

      setVodCategoryStatus("loading");
      setVodCategoryError(null);

      const entry: InFlightOperationEntry = {
        priority: 100,
        promise: Promise.resolve(),
        elevate: (nextPriority, nextHint) => {
          XtreamService.elevateRequestPriority(
            credsAtStart,
            "get_vod_streams",
            { category_id: normalizedCategoryId },
            nextPriority,
            nextHint
          );
        },
      };

      const promise = (async () => {
        try {
          if (currentSignal.aborted || sessionRef.current !== currentSession) {
            return;
          }
          const streams = await XtreamService.getVodStreams(
            credentials,
            normalizedCategoryId,
            {
              signal: currentSignal,
              lane: "catalog",
              priority: "user",
              priorityHint: 10,
            }
          );
          if (sessionRef.current !== currentSession || currentSignal.aborted) {
            return;
          }

          // Section 8: Verify provider category_id filter compliance
          const compliance = inspectCategoryFilterCompliance(
            streams,
            normalizedCategoryId
          );
          if (!compliance.compliant) {
            vodProviderSupportsCategoryFilterRef.current = false;
            setVodProviderSupportsCategoryFilter(false);
            if (
              compliance.matchingItems.length > 0 &&
              latestVodCategoryRef.current === normalizedCategoryId
            ) {
              setVodStreams(compliance.matchingItems);
            }
            await enqueueGlobalVodCatalog(100);
            return;
          }

          const catIdx = await buildVodIndexAsync(streams, {
            signal: currentSignal,
            shouldCancel: () =>
              sessionRef.current !== currentSession || currentSignal.aborted,
          });
          if (!catIdx || sessionRef.current !== currentSession || currentSignal.aborted) {
            return;
          }

          if (vodCatalogStatusRef.current !== "ready") {
            storeCategoryCacheEntry(
              vodCategoryCacheRef.current,
              normalizedCategoryId,
              streams,
              catIdx
            );
            setVodCategoryCacheVersion((v) => v + 1);
          }

          if (latestVodCategoryRef.current === normalizedCategoryId) {
            if (vodCatalogStatusRef.current === "ready") {
              setVodStreams(
                getOrCreateVodIndex(allVodStreamsRef.current).getByCategory(
                  normalizedCategoryId
                )
              );
            } else {
              setVodStreams(streams);
            }
            setVodCategoryStatus("ready");
            setVodCategoryError(null);
          }
        } catch (err: any) {
          if (
            sessionRef.current !== currentSession ||
            isAbortedOperation(err, currentSignal)
          ) {
            return;
          }
          const msg = await registerErrorAndCheckAuth(
            err,
            currentSession,
            currentSignal
          );
          if (sessionRef.current !== currentSession || currentSignal.aborted) {
            return;
          }
          if (latestVodCategoryRef.current === normalizedCategoryId) {
            setVodCategoryError(msg || "Falha ao carregar categoria de filmes.");
            setVodCategoryStatus("error");
          }
        } finally {
          if (
            sessionRef.current === currentSession &&
            inFlightVodCategoriesRef.current.get(normalizedCategoryId) === entry
          ) {
            inFlightVodCategoriesRef.current.delete(normalizedCategoryId);
          }
        }
      })();

      entry.promise = promise;
      inFlightVodCategoriesRef.current.set(normalizedCategoryId, entry);
      return promise;
    },
    [
      credentials,
      enqueueGlobalVodCatalog,
      registerErrorAndCheckAuth,
      isAbortedOperation,
    ]
  );

  // Series Global Catalog Fetch helper
  const enqueueGlobalSeriesCatalog = useCallback(
    (priority: number): Promise<void> => {
      if (!credentials) return Promise.resolve();
      const currentSession = sessionRef.current;
      return enqueueOperation("series_catalog", priority, async (signal, coordPrio) => {
        if (sessionRef.current !== currentSession || signal.aborted) {
          return;
        }
        try {
          const streams = await XtreamService.getSeries(credentials, undefined, {
            signal,
            lane: "catalog",
            priority: coordPrio.priority,
            priorityHint: coordPrio.priorityHint,
          });
          if (sessionRef.current !== currentSession || signal.aborted) {
            return;
          }
          const seriesIdx = await buildSeriesIndexAsync(streams, {
            signal,
            shouldCancel: () => sessionRef.current !== currentSession || signal.aborted,
          });
          if (!seriesIdx || sessionRef.current !== currentSession || signal.aborted) {
            return;
          }
          allSeriesStreamsRef.current = streams;
          setAllSeriesStreams(streams);
          seriesCatalogStatusRef.current = "ready";
          setSeriesCatalogStatus("ready");

          // Free partial category caches once global catalog and index are ready
          if (seriesCategoryCacheRef.current.size > 0) {
            seriesCategoryCacheRef.current.clear();
            setSeriesCategoryCacheVersion((v) => v + 1);
          }

          // Always respect most recent category selection
          const targetCat = latestSeriesCategoryRef.current;
          if (targetCat) {
            setSeriesStreams(seriesIdx.getByCategory(targetCat));
            setSeriesCategoryStatus("ready");
            setSeriesCategoryError(null);
          } else {
            setSeriesStreams(streams);
          }
        } catch (err: any) {
          if (
            sessionRef.current !== currentSession ||
            isAbortedOperation(err, signal)
          ) {
            return;
          }
          const msg = await registerErrorAndCheckAuth(
            err,
            currentSession,
            signal
          );
          if (sessionRef.current !== currentSession || signal.aborted) {
            return;
          }
          setSeriesError(msg || "Falha ao carregar séries.");
          seriesCatalogStatusRef.current = "error";
          setSeriesCatalogStatus("error");
          if (latestSeriesCategoryRef.current) {
            setSeriesCategoryError(msg || "Falha ao carregar séries.");
            setSeriesCategoryStatus("error");
          }
        }
      });
    },
    [credentials, enqueueOperation, registerErrorAndCheckAuth, isAbortedOperation]
  );

  // Series Streams Catalog Fetch (Progressive: category-first when full catalog not yet started, index reuse when full catalog ready)
  const fetchSeriesStreams = useCallback(
    async (categoryId?: string) => {
      if (!credentials) return;
      const normalizedCategoryId =
        categoryId !== undefined &&
        categoryId !== null &&
        String(categoryId).trim() !== ""
          ? String(categoryId).trim()
          : undefined;

      // Record most recent category requested
      latestSeriesCategoryRef.current = normalizedCategoryId;
      setActiveSeriesCategoryId(normalizedCategoryId ?? null);

      // Rule 1: If global catalog is already loaded and ready, use exclusively its O(1) local index
      if (seriesCatalogStatusRef.current === "ready") {
        const source = allSeriesStreamsRef.current;
        if (normalizedCategoryId) {
          setSeriesStreams(
            getOrCreateSeriesIndex(source).getByCategory(normalizedCategoryId)
          );
          setSeriesCategoryStatus("ready");
          setSeriesCategoryError(null);
        } else {
          setSeriesStreams(source);
          setSeriesCategoryStatus("idle");
          setSeriesCategoryError(null);
        }
        return;
      }

      // Global catalog requested explicitly (e.g., Showcase, HeroBanner, Global Search, "Ver todos")
      if (!normalizedCategoryId) {
        return enqueueGlobalSeriesCatalog(1);
      }

      // Rule 2: If category is already available in the session category cache, reuse its data and index immediately
      const cachedCategory = seriesCategoryCacheRef.current.get(normalizedCategoryId);
      if (cachedCategory) {
        seriesCategoryCacheRef.current.delete(normalizedCategoryId);
        seriesCategoryCacheRef.current.set(normalizedCategoryId, {
          ...cachedCategory,
          loadedAt: Date.now(),
        });
        setSeriesStreams(cachedCategory.items);
        setSeriesCategoryStatus("ready");
        setSeriesCategoryError(null);
        return;
      }

      // Rule 4 & 5: If a full catalog query is ALREADY in flight, avoid firing a redundant query;
      // elevate its priority if still queued and reuse the complete response when it arrives.
      const existingGlobalOp = inFlightOperationsRef.current.get("series_catalog");
      if (existingGlobalOp) {
        if (100 > existingGlobalOp.priority) {
          existingGlobalOp.priority = 100;
          const mapped = mapOperationPriorityToCoordinator(100);
          existingGlobalOp.elevate?.(mapped.priority, mapped.priorityHint);
        }
        setSeriesCategoryStatus("loading");
        setSeriesCategoryError(null);
        return existingGlobalOp.promise;
      }

      // Section 8: If provider was already detected as incompatible with category_id in this session, fall back to full catalog
      if (!seriesProviderSupportsCategoryFilterRef.current) {
        setSeriesCategoryStatus("loading");
        setSeriesCategoryError(null);
        return enqueueGlobalSeriesCatalog(100);
      }

      // Share identical in-flight category query
      const existingCatOp = inFlightSeriesCategoriesRef.current.get(normalizedCategoryId);
      if (existingCatOp) {
        if (100 > existingCatOp.priority) {
          existingCatOp.priority = 100;
          const mapped = mapOperationPriorityToCoordinator(100);
          existingCatOp.elevate?.(mapped.priority, mapped.priorityHint);
        }
        setSeriesCategoryStatus("loading");
        setSeriesCategoryError(null);
        return existingCatOp.promise;
      }

      // Rule 3: Full catalog has not started and user requested a specific category -> prioritize filtered query
      const currentSession = sessionRef.current;
      const currentSignal =
        abortControllerRef.current?.signal || new AbortController().signal;
      const credsAtStart = credentialsPropRef.current;

      setSeriesCategoryStatus("loading");
      setSeriesCategoryError(null);

      const entry: InFlightOperationEntry = {
        priority: 100,
        promise: Promise.resolve(),
        elevate: (nextPriority, nextHint) => {
          XtreamService.elevateRequestPriority(
            credsAtStart,
            "get_series",
            { category_id: normalizedCategoryId },
            nextPriority,
            nextHint
          );
        },
      };

      const promise = (async () => {
        try {
          if (currentSignal.aborted || sessionRef.current !== currentSession) {
            return;
          }
          const streams = await XtreamService.getSeries(
            credentials,
            normalizedCategoryId,
            {
              signal: currentSignal,
              lane: "catalog",
              priority: "user",
              priorityHint: 10,
            }
          );
          if (sessionRef.current !== currentSession || currentSignal.aborted) {
            return;
          }

          // Section 8: Verify provider category_id filter compliance
          const compliance = inspectCategoryFilterCompliance(
            streams,
            normalizedCategoryId
          );
          if (!compliance.compliant) {
            seriesProviderSupportsCategoryFilterRef.current = false;
            setSeriesProviderSupportsCategoryFilter(false);
            if (
              compliance.matchingItems.length > 0 &&
              latestSeriesCategoryRef.current === normalizedCategoryId
            ) {
              setSeriesStreams(compliance.matchingItems);
            }
            await enqueueGlobalSeriesCatalog(100);
            return;
          }

          const catIdx = await buildSeriesIndexAsync(streams, {
            signal: currentSignal,
            shouldCancel: () =>
              sessionRef.current !== currentSession || currentSignal.aborted,
          });
          if (!catIdx || sessionRef.current !== currentSession || currentSignal.aborted) {
            return;
          }

          if (seriesCatalogStatusRef.current !== "ready") {
            storeCategoryCacheEntry(
              seriesCategoryCacheRef.current,
              normalizedCategoryId,
              streams,
              catIdx
            );
            setSeriesCategoryCacheVersion((v) => v + 1);
          }

          if (latestSeriesCategoryRef.current === normalizedCategoryId) {
            if (seriesCatalogStatusRef.current === "ready") {
              setSeriesStreams(
                getOrCreateSeriesIndex(allSeriesStreamsRef.current).getByCategory(
                  normalizedCategoryId
                )
              );
            } else {
              setSeriesStreams(streams);
            }
            setSeriesCategoryStatus("ready");
            setSeriesCategoryError(null);
          }
        } catch (err: any) {
          if (
            sessionRef.current !== currentSession ||
            isAbortedOperation(err, currentSignal)
          ) {
            return;
          }
          const msg = await registerErrorAndCheckAuth(
            err,
            currentSession,
            currentSignal
          );
          if (sessionRef.current !== currentSession || currentSignal.aborted) {
            return;
          }
          if (latestSeriesCategoryRef.current === normalizedCategoryId) {
            setSeriesCategoryError(msg || "Falha ao carregar categoria de séries.");
            setSeriesCategoryStatus("error");
          }
        } finally {
          if (
            sessionRef.current === currentSession &&
            inFlightSeriesCategoriesRef.current.get(normalizedCategoryId) === entry
          ) {
            inFlightSeriesCategoriesRef.current.delete(normalizedCategoryId);
          }
        }
      })();

      entry.promise = promise;
      inFlightSeriesCategoriesRef.current.set(normalizedCategoryId, entry);
      return promise;
    },
    [
      credentials,
      enqueueGlobalSeriesCatalog,
      registerErrorAndCheckAuth,
      isAbortedOperation,
    ]
  );

  // Category cache lookup helpers for consumers
  const isVodCategoryLoaded = useCallback(
    (categoryId: string): boolean => {
      const target = String(categoryId ?? "").trim();
      if (!target) return false;
      if (vodCatalogStatus === "ready") return true;
      return vodCategoryCacheRef.current.has(target);
    },
    [vodCatalogStatus, vodCategoryCacheVersion]
  );

  const getVodCategoryStreams = useCallback(
    (categoryId: string): VodStream[] => {
      const target = String(categoryId ?? "").trim();
      if (!target) return [];
      if (vodCatalogStatus === "ready") {
        return getOrCreateVodIndex(allVodStreams).getSortedByCategory(target);
      }
      const cached = vodCategoryCacheRef.current.get(target);
      if (cached) {
        return cached.index.getSortedByCategory(target);
      }
      return [];
    },
    [vodCatalogStatus, allVodStreams, vodCategoryCacheVersion]
  );

  const getPartialVodStreamsForSearch = useCallback((): VodStream[] => {
    if (vodCatalogStatus === "ready" || allVodStreams.length > 0) {
      return allVodStreams;
    }
    const seen = new Set<string>();
    const combined: VodStream[] = [];
    for (const entry of vodCategoryCacheRef.current.values()) {
      for (const item of entry.items) {
        const key = String(item.stream_id ?? (item as any).id ?? "");
        if (key && !seen.has(key)) {
          seen.add(key);
          combined.push(item);
        }
      }
    }
    for (const item of vodStreams) {
      const key = String(item.stream_id ?? (item as any).id ?? "");
      if (key && !seen.has(key)) {
        seen.add(key);
        combined.push(item);
      }
    }
    return combined;
  }, [vodCatalogStatus, allVodStreams, vodStreams, vodCategoryCacheVersion]);

  const isSeriesCategoryLoaded = useCallback(
    (categoryId: string): boolean => {
      const target = String(categoryId ?? "").trim();
      if (!target) return false;
      if (seriesCatalogStatus === "ready") return true;
      return seriesCategoryCacheRef.current.has(target);
    },
    [seriesCatalogStatus, seriesCategoryCacheVersion]
  );

  const getSeriesCategoryStreams = useCallback(
    (categoryId: string): SeriesStream[] => {
      const target = String(categoryId ?? "").trim();
      if (!target) return [];
      if (seriesCatalogStatus === "ready") {
        return getOrCreateSeriesIndex(allSeriesStreams).getSortedByCategory(target);
      }
      const cached = seriesCategoryCacheRef.current.get(target);
      if (cached) {
        return cached.index.getSortedByCategory(target);
      }
      return [];
    },
    [seriesCatalogStatus, allSeriesStreams, seriesCategoryCacheVersion]
  );

  const getPartialSeriesStreamsForSearch = useCallback((): SeriesStream[] => {
    if (seriesCatalogStatus === "ready" || allSeriesStreams.length > 0) {
      return allSeriesStreams;
    }
    const seen = new Set<string>();
    const combined: SeriesStream[] = [];
    for (const entry of seriesCategoryCacheRef.current.values()) {
      for (const item of entry.items) {
        const key = String(item.series_id ?? (item as any).id ?? "");
        if (key && !seen.has(key)) {
          seen.add(key);
          combined.push(item);
        }
      }
    }
    for (const item of seriesStreams) {
      const key = String(item.series_id ?? (item as any).id ?? "");
      if (key && !seen.has(key)) {
        seen.add(key);
        combined.push(item);
      }
    }
    return combined;
  }, [seriesCatalogStatus, allSeriesStreams, seriesStreams, seriesCategoryCacheVersion]);

  // Section 5 & Section 6 Rule 8:
  // Automatically start Live TV full catalog (standard strategy for Live TV),
  // while avoiding starting all heavy VOD/Series full-catalog downloads before the user can interact.
  useEffect(() => {
    if (!credentials || !sessionReady || isAuthRejected) return;
    if (liveCatalogStatus === "idle") {
      fetchLiveStreams().catch(() => {});
    }
  }, [
    credentials,
    sessionReady,
    isAuthRejected,
    liveCatalogStatus,
    fetchLiveStreams,
  ]);

  // Full session retry (re-verifies authentication if previously rejected and reloads failed categories/catalogs)
  const retrySession = useCallback(async () => {
    if (!credentials) return;
    const currentSession = sessionRef.current;
    // Manual retry always bypasses automatic auth recheck cooldown
    lastAuthRecheckRef.current = null;

    if (isAuthRejectedRef.current) {
      try {
        const authResponse = await XtreamService.authenticate(credentials, {
          signal: abortControllerRef.current?.signal,
          lane: "auth",
          priority: "critical",
        });
        if (sessionRef.current !== currentSession) return;
        const reconciled = buildReconciledCredentialsFromAuth(
          effectiveCredentialsRef.current || credentials,
          authResponse
        );
        isAuthRejectedRef.current = false;
        setIsAuthRejected(false);
        setAuthError(null);
        const currentId = getCredentialsIdentityKey(credentials);
        if (currentId) {
          setReconciledCredentialsEntry({
            identityKey: currentId,
            credentials: reconciled,
          });
        }
        safeSaveCredentials(reconciled);
      } catch (err: any) {
        if (
          sessionRef.current !== currentSession ||
          isAbortedOperation(err, abortControllerRef.current?.signal)
        ) {
          return;
        }
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
    } else if (isLegacyAmbiguousOutputFormats(effectiveCredentialsRef.current)) {
      try {
        const authResponse = await XtreamService.authenticate(credentials, {
          signal: abortControllerRef.current?.signal,
          lane: "auth",
          priority: "critical",
        });
        if (sessionRef.current !== currentSession) return;
        const currentId = getCredentialsIdentityKey(credentials);
        if (currentId && currentId === getCredentialsIdentityKey(credentialsPropRef.current)) {
          const reconciled = buildReconciledCredentialsFromAuth(
            effectiveCredentialsRef.current || credentials,
            authResponse
          );
          setReconciledCredentialsEntry({
            identityKey: currentId,
            credentials: reconciled,
          });
          safePersistReconciledCredentials(reconciled);
        }
      } catch (err: any) {
        if (
          sessionRef.current !== currentSession ||
          isAbortedOperation(err, abortControllerRef.current?.signal)
        ) {
          return;
        }
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
    isAbortedOperation,
    fetchLiveCategories,
    fetchVodCategories,
    fetchSeriesCategories,
    fetchLiveStreams,
    fetchVodStreams,
    fetchSeriesStreams,
  ]);

  // Backward compatibility values
  const loadingLive = liveCatalogStatus === "loading";
  const loadingVod =
    vodCatalogStatus === "loading" || vodCategoryStatus === "loading";
  const loadingSeries =
    seriesCatalogStatus === "loading" || seriesCategoryStatus === "loading";

  const loadedLiveCatalog = liveCatalogStatus === "ready";
  const loadedVodCatalog = vodCatalogStatus === "ready";
  const loadedSeriesCatalog = seriesCatalogStatus === "ready";

  const categoriesError =
    liveCategoriesError || vodCategoriesError || seriesCategoriesError;
  const error =
    authError || liveError || vodError || seriesError || categoriesError;

  const isStatusFinished = (s: OperationStatus) =>
    s === "ready" || s === "error";
  const initialCategoriesReady = Boolean(
    sessionReady &&
      (isStatusFinished(liveCategoriesStatus) ||
        isStatusFinished(vodCategoriesStatus) ||
        isStatusFinished(seriesCategoriesStatus))
  );
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
    () => ({ credentials: effectiveCredentials }),
    [effectiveCredentials]
  );

  const sessionValue = useMemo<XtreamSessionContextData>(
    () => ({
      sessionReady,
      initialCategoriesReady,
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
      initialCategoriesReady,
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
      vodCategoryStatus,
      vodCategoriesError,
      vodError,
      vodCategoryError,
      activeVodCategoryId,
      vodProviderSupportsCategoryFilter,
      loadingVod,
      loadedVodCatalog,
      fetchVodCategories,
      fetchVodStreams,
      isVodCategoryLoaded,
      getVodCategoryStreams,
      getPartialVodStreamsForSearch,
    }),
    [
      vodCategories,
      vodStreams,
      allVodStreams,
      vodCategoriesStatus,
      vodCatalogStatus,
      vodCategoryStatus,
      vodCategoriesError,
      vodError,
      vodCategoryError,
      activeVodCategoryId,
      vodProviderSupportsCategoryFilter,
      loadingVod,
      loadedVodCatalog,
      fetchVodCategories,
      fetchVodStreams,
      isVodCategoryLoaded,
      getVodCategoryStreams,
      getPartialVodStreamsForSearch,
    ]
  );

  const seriesValue = useMemo<XtreamSeriesContextData>(
    () => ({
      seriesCategories,
      seriesStreams,
      allSeriesStreams,
      seriesCategoriesStatus,
      seriesCatalogStatus,
      seriesCategoryStatus,
      seriesCategoriesError,
      seriesError,
      seriesCategoryError,
      activeSeriesCategoryId,
      seriesProviderSupportsCategoryFilter,
      loadingSeries,
      loadedSeriesCatalog,
      fetchSeriesCategories,
      fetchSeriesStreams,
      isSeriesCategoryLoaded,
      getSeriesCategoryStreams,
      getPartialSeriesStreamsForSearch,
    }),
    [
      seriesCategories,
      seriesStreams,
      allSeriesStreams,
      seriesCategoriesStatus,
      seriesCatalogStatus,
      seriesCategoryStatus,
      seriesCategoriesError,
      seriesError,
      seriesCategoryError,
      activeSeriesCategoryId,
      seriesProviderSupportsCategoryFilter,
      loadingSeries,
      loadedSeriesCatalog,
      fetchSeriesCategories,
      fetchSeriesStreams,
      isSeriesCategoryLoaded,
      getSeriesCategoryStreams,
      getPartialSeriesStreamsForSearch,
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
  const defaultIsCategoryLoaded = useCallback(() => true, []);
  const defaultGetVodCategoryStreams = useCallback(
    (categoryId: string) => {
      const all = value.allVodStreams ?? [];
      if (all.length > 0) {
        return getOrCreateVodIndex(all).getSortedByCategory(categoryId);
      }
      return (value.vodStreams ?? []).filter(
        (m) => String(m.category_id) === String(categoryId)
      );
    },
    [value.allVodStreams, value.vodStreams]
  );
  const defaultGetPartialVodStreams = useCallback(
    () =>
      (value.allVodStreams && value.allVodStreams.length > 0
        ? value.allVodStreams
        : value.vodStreams) ?? [],
    [value.allVodStreams, value.vodStreams]
  );
  const defaultGetSeriesCategoryStreams = useCallback(
    (categoryId: string) => {
      const all = value.allSeriesStreams ?? [];
      if (all.length > 0) {
        return getOrCreateSeriesIndex(all).getSortedByCategory(categoryId);
      }
      return (value.seriesStreams ?? []).filter(
        (s) => String(s.category_id) === String(categoryId)
      );
    },
    [value.allSeriesStreams, value.seriesStreams]
  );
  const defaultGetPartialSeriesStreams = useCallback(
    () =>
      (value.allSeriesStreams && value.allSeriesStreams.length > 0
        ? value.allSeriesStreams
        : value.seriesStreams) ?? [],
    [value.allSeriesStreams, value.seriesStreams]
  );
  const credentials = value.credentials ?? null;

  const credentialsValue = useMemo<XtreamCredentialsContextData>(
    () => ({ credentials }),
    [credentials]
  );

  const sessionValue = useMemo<XtreamSessionContextData>(
    () => ({
      sessionReady: value.sessionReady ?? true,
      initialCategoriesReady: value.initialCategoriesReady ?? true,
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
      value.initialCategoriesReady,
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
      vodCategoryStatus: value.vodCategoryStatus ?? "ready",
      vodCategoriesError: value.vodCategoriesError ?? null,
      vodError: value.vodError ?? null,
      vodCategoryError: value.vodCategoryError ?? null,
      activeVodCategoryId: value.activeVodCategoryId ?? null,
      vodProviderSupportsCategoryFilter:
        value.vodProviderSupportsCategoryFilter ?? true,
      loadingVod: value.loadingVod ?? false,
      loadedVodCatalog: value.loadedVodCatalog ?? true,
      fetchVodCategories: value.fetchVodCategories ?? noopAsync,
      fetchVodStreams: value.fetchVodStreams ?? noopAsync,
      isVodCategoryLoaded: value.isVodCategoryLoaded ?? defaultIsCategoryLoaded,
      getVodCategoryStreams:
        value.getVodCategoryStreams ?? defaultGetVodCategoryStreams,
      getPartialVodStreamsForSearch:
        value.getPartialVodStreamsForSearch ?? defaultGetPartialVodStreams,
    }),
    [
      value.vodCategories,
      value.vodStreams,
      allVodStreamsDeps(value.allVodStreams),
      value.vodCategoriesStatus,
      value.vodCatalogStatus,
      value.vodCategoryStatus,
      value.vodCategoriesError,
      value.vodError,
      value.vodCategoryError,
      value.activeVodCategoryId,
      value.vodProviderSupportsCategoryFilter,
      value.loadingVod,
      value.loadedVodCatalog,
      value.fetchVodCategories,
      value.fetchVodStreams,
      value.isVodCategoryLoaded,
      value.getVodCategoryStreams,
      value.getPartialVodStreamsForSearch,
      defaultIsCategoryLoaded,
      defaultGetVodCategoryStreams,
      defaultGetPartialVodStreams,
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
      seriesCategoryStatus: value.seriesCategoryStatus ?? "ready",
      seriesCategoriesError: value.seriesCategoriesError ?? null,
      seriesError: value.seriesError ?? null,
      seriesCategoryError: value.seriesCategoryError ?? null,
      activeSeriesCategoryId: value.activeSeriesCategoryId ?? null,
      seriesProviderSupportsCategoryFilter:
        value.seriesProviderSupportsCategoryFilter ?? true,
      loadingSeries: value.loadingSeries ?? false,
      loadedSeriesCatalog: value.loadedSeriesCatalog ?? true,
      fetchSeriesCategories: value.fetchSeriesCategories ?? noopAsync,
      fetchSeriesStreams: value.fetchSeriesStreams ?? noopAsync,
      isSeriesCategoryLoaded:
        value.isSeriesCategoryLoaded ?? defaultIsCategoryLoaded,
      getSeriesCategoryStreams:
        value.getSeriesCategoryStreams ?? defaultGetSeriesCategoryStreams,
      getPartialSeriesStreamsForSearch:
        value.getPartialSeriesStreamsForSearch ?? defaultGetPartialSeriesStreams,
    }),
    [
      value.seriesCategories,
      value.seriesStreams,
      value.allSeriesStreams,
      value.seriesCategoriesStatus,
      value.seriesCatalogStatus,
      value.seriesCategoryStatus,
      value.seriesCategoriesError,
      value.seriesError,
      value.seriesCategoryError,
      value.activeSeriesCategoryId,
      value.seriesProviderSupportsCategoryFilter,
      value.loadingSeries,
      value.loadedSeriesCatalog,
      value.fetchSeriesCategories,
      value.fetchSeriesStreams,
      value.isSeriesCategoryLoaded,
      value.getSeriesCategoryStreams,
      value.getPartialSeriesStreamsForSearch,
      defaultIsCategoryLoaded,
      defaultGetSeriesCategoryStreams,
      defaultGetPartialSeriesStreams,
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
