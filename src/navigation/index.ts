export {
  NavigationProvider,
  useNavigationMode,
} from './NavigationProvider';

export {
  getNavMode,
  setNavMode,
  subscribeNavMode,
  moveSpatialFocus,
  getFocusableElements,
  getActiveScopeRoot,
  isElementFocusable,
  focusElementSafely,
  ensureElementScrolledIntoView,
  findScrollContainer,
  pushFocusMemory,
  popFocusMemory,
  clearFocusMemory,
  getFocusMemoryCount,
  peekFocusMemoryElement,
  registerVirtualContainer,
  unregisterVirtualContainer,
  registerShowcaseRowController,
  unregisterShowcaseRowController,
  getActiveShowcaseRowControllerCount,
  hasRegisteredShowcaseRowController,
  getActiveVirtualContainerCount,
  hasRegisteredVirtualContainer,
  hasPendingFocusRestore,
  cancelPendingFocusRestore,
  restoreVirtualItemByKey,
  invalidateCandidateCache,
  getSpatialNavPerfStats,
  resetSpatialNavPerfStats,
  setFastHorizontalRowNavEnabledForTest,
  setFastVerticalNavEnabledForTest,
} from './spatialNav';
export type {
  NavMode,
  SpatialDirection,
  VirtualContainerController,
  ShowcaseRowController,
  SpatialNavPerfStats,
} from './spatialNav';

export {
  BACK_PRIORITY,
  registerBackHandler,
  executeBackAction,
  useBackHandler,
  clearAllBackHandlersForTest,
  isCentralBackPolicyAttached,
  setCentralBackPolicyAttached,
} from './backPolicy';
export type { BackHandlerEntry } from './backPolicy';

export {
  attachCapacitorBackAdapter,
  getNativeBackBridgeStatus,
  setCapacitorAppBridgeForTest,
} from './capacitorBackAdapter';
export type {
  NativeBackBridgeStatus,
  CapacitorAppBridgeLike,
} from './capacitorBackAdapter';

export {
  setAndroidPlatformOverrideForDpadTest,
  isAndroidCapacitorPlatform,
  getDpadNavigationBehaviorMode,
  isDpadOptimizedPathActive,
} from './navigationPlatformPolicy';
export type { DpadNavigationBehaviorMode } from './navigationPlatformPolicy';

export {
  DPAD_FLUIDITY_DIAGNOSTICS_ENABLED_KEY,
  isDpadFluidityDiagnosticsEnabled,
  setDpadFluidityDiagnosticsEnabled,
  isDpadNavigationCurrentlyActiveWindow,
  setDpadFluidityClockForTest,
  resetDpadFluidityDiagnostics,
  recordDpadKeydownReceived,
  recordDpadMoveResolution,
  recordDpadFlushSyncExecution,
  recordDpadGeometryMeasurement,
  recordDpadVirtualMountDelta,
  recordDpadNavImageActivity,
  recordDpadNavCategorySortActivity,
  getDpadFluidityDiagnosticsSnapshot,
  subscribeDpadFluidityDiagnostics,
  formatDpadFluidityDiagnosticsReport,
} from './dpadFluidityDiagnostics';
export type {
  DpadLatencySummary,
  DpadDirectionBreakdown,
  DpadFluidityDiagnosticsSnapshot,
} from './dpadFluidityDiagnostics';

