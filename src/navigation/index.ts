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
  registerVirtualContainer,
  unregisterVirtualContainer,
  getActiveVirtualContainerCount,
  hasRegisteredVirtualContainer,
  restoreVirtualItemByKey,
  invalidateCandidateCache,
  getSpatialNavPerfStats,
  resetSpatialNavPerfStats,
} from './spatialNav';
export type {
  NavMode,
  SpatialDirection,
  VirtualContainerController,
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
