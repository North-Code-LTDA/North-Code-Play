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
} from './spatialNav';
export type { NavMode, SpatialDirection } from './spatialNav';

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
} from './capacitorBackAdapter';
export type { NativeBackBridgeStatus } from './capacitorBackAdapter';

