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
  DPAD_FLUIDITY_DIAGNOSTICS_ENABLED_KEY,
  DPAD_NAVIGATION_BEHAVIOR_MODE_KEY,
  isDpadFluidityDiagnosticsEnabled,
  setDpadFluidityDiagnosticsEnabled,
  getDpadNavigationBehaviorMode,
  setDpadNavigationBehaviorMode,
  isDpadOptimizedPathActive,
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
  DpadNavigationBehaviorMode,
  DpadLatencySummary,
  DpadDirectionBreakdown,
  DpadFluidityDiagnosticsSnapshot,
} from './dpadFluidityDiagnostics';

