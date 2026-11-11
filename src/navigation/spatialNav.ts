export type NavMode = 'pointer' | 'remote';
export type SpatialDirection = 'up' | 'down' | 'left' | 'right';

export interface VirtualContainerController {
  totalCount: number;
  getColumns: () => number;
  ensureIndexMounted: (targetIndex: number, preserveIndex?: number) => boolean;
  ensureItemKeyMounted?: (itemKey: string, savedScrollLeft?: number) => HTMLElement | null;
  hasPendingFocusRestore?: () => boolean;
  cancelPendingFocusRestore?: () => void;
}

export interface SpatialNavPerfStats {
  moveCalls: number;
  computedStyleCalls: number;
  boundingRectCalls: number;
  querySelectorCalls: number;
  virtualWindowExpansions: number;
}

const spatialPerfStats: SpatialNavPerfStats = {
  moveCalls: 0,
  computedStyleCalls: 0,
  boundingRectCalls: 0,
  querySelectorCalls: 0,
  virtualWindowExpansions: 0,
};

export function getSpatialNavPerfStats(): SpatialNavPerfStats {
  return { ...spatialPerfStats };
}

export function resetSpatialNavPerfStats(): void {
  spatialPerfStats.moveCalls = 0;
  spatialPerfStats.computedStyleCalls = 0;
  spatialPerfStats.boundingRectCalls = 0;
  spatialPerfStats.querySelectorCalls = 0;
  spatialPerfStats.virtualWindowExpansions = 0;
}

export interface ShowcaseRowController {
  totalRows: number;
  ensureRowMounted: (targetRowIndex: number, preserveRowIndex?: number) => boolean;
}

const virtualControllers = new WeakMap<HTMLElement, VirtualContainerController>();
const registeredVirtualContainers = new Set<HTMLElement>();
const showcaseRowControllers = new WeakMap<HTMLElement, ShowcaseRowController>();

export function registerShowcaseRowController(
  container: HTMLElement | null,
  controller: ShowcaseRowController
): void {
  if (!container) return;
  showcaseRowControllers.set(container, controller);
  invalidateCandidateCache();
}

export function unregisterShowcaseRowController(container: HTMLElement | null): void {
  if (!container) return;
  showcaseRowControllers.delete(container);
  invalidateCandidateCache();
}

export function registerVirtualContainer(
  container: HTMLElement | null,
  controller: VirtualContainerController
): void {
  if (!container) return;
  virtualControllers.set(container, controller);
  registeredVirtualContainers.add(container);
  invalidateCandidateCache();
}

export function unregisterVirtualContainer(container: HTMLElement | null): void {
  if (!container) return;
  const controller = virtualControllers.get(container);
  controller?.cancelPendingFocusRestore?.();
  virtualControllers.delete(container);
  registeredVirtualContainers.delete(container);
  invalidateCandidateCache();
}

export function getActiveVirtualContainerCount(): number {
  return registeredVirtualContainers.size;
}

export function hasRegisteredVirtualContainer(container: HTMLElement | null): boolean {
  if (!container) return false;
  return virtualControllers.has(container);
}

export function hasPendingFocusRestore(container: HTMLElement | null): boolean {
  if (!container) return false;
  const controller = virtualControllers.get(container);
  if (controller && typeof controller.hasPendingFocusRestore === 'function') {
    return controller.hasPendingFocusRestore();
  }
  return container.hasAttribute('data-pending-focus-restore');
}

export function cancelPendingFocusRestore(container?: HTMLElement | null): void {
  if (container) {
    const controller = virtualControllers.get(container);
    controller?.cancelPendingFocusRestore?.();
    return;
  }
  registeredVirtualContainers.forEach((c) => {
    const controller = virtualControllers.get(c);
    controller?.cancelPendingFocusRestore?.();
  });
}

export function restoreVirtualItemByKey(
  container: HTMLElement | null,
  itemKey: string,
  savedScrollLeft?: number
): HTMLElement | null {
  if (!container || !itemKey) return null;
  const controller = virtualControllers.get(container);
  if (controller && typeof controller.ensureItemKeyMounted === 'function') {
    const remounted = controller.ensureItemKeyMounted(itemKey, savedScrollLeft);
    if (remounted && remounted.isConnected) {
      focusElementSafely(remounted);
      return remounted;
    }
  }
  return null;
}

interface FocusMemoryEntry {
  element: HTMLElement;
  virtualContainer: HTMLElement | null;
  virtualIndex: number;
  itemKey: string | null;
  scrollLeft: number | null;
}

let currentNavMode: NavMode = 'pointer';
const modeListeners = new Set<(mode: NavMode) => void>();
const focusMemoryStack: FocusMemoryEntry[] = [];

// DOM mutation tracking to avoid redundant querySelectorAll scans when DOM is unchanged
let domMutationVersion = 1;
let observerAttached = false;
let observerDoc: Document | null = null;
let cachedScopeRoot: HTMLElement | null = null;
let cachedScopeMutationVersion = -1;
let cachedRawCandidates: HTMLElement[] = [];

export function invalidateCandidateCache(): void {
  domMutationVersion++;
  cachedScopeMutationVersion = -1;
}

function ensureDomMutationObserver(): void {
  if (typeof document === 'undefined' || !document.body) return;
  if (observerAttached && observerDoc === document) return;

  const MutationObs =
    typeof MutationObserver !== 'undefined'
      ? MutationObserver
      : typeof window !== 'undefined' && (window as any).MutationObserver
        ? (window as any).MutationObserver
        : null;

  if (!MutationObs) return;

  try {
    const obs = new MutationObs(() => {
      domMutationVersion++;
    });
    obs.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'disabled',
        'hidden',
        'inert',
        'aria-hidden',
        'aria-disabled',
        'tabindex',
        'class',
        'style',
        'data-focus-scope',
        'data-nav-item',
        'data-virtual-index',
      ],
    });
    observerAttached = true;
    observerDoc = document;
  } catch {
    // Fallback if MutationObserver fails in minimal environment
  }
}

export function getNavMode(): NavMode {
  return currentNavMode;
}

export function setNavMode(mode: NavMode): void {
  if (
    currentNavMode === mode &&
    typeof document !== 'undefined' &&
    document.documentElement.dataset.navMode === mode
  ) {
    return;
  }
  currentNavMode = mode;
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.dataset.navMode = mode;
  }
  modeListeners.forEach((cb) => {
    try {
      cb(mode);
    } catch {}
  });
}

export function subscribeNavMode(listener: (mode: NavMode) => void): () => void {
  modeListeners.add(listener);
  return () => {
    modeListeners.delete(listener);
  };
}

export function pushFocusMemory(element?: HTMLElement | null): void {
  const target =
    element ||
    (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null);
  if (target && target !== document.body && target !== document.documentElement) {
    const virtualItemEl =
      target.closest<HTMLElement>('[data-virtual-index], [data-row-card-index]') || target;
    const virtualContainer = virtualItemEl.closest<HTMLElement>('[data-virtual-container="true"]');
    const rawIdx =
      virtualItemEl.getAttribute('data-virtual-index') ??
      virtualItemEl.getAttribute('data-row-card-index');
    const parsedIdx = rawIdx !== null ? parseInt(rawIdx, 10) : -1;
    const virtualIndex = Number.isFinite(parsedIdx) ? parsedIdx : -1;
    const itemKey =
      virtualItemEl.getAttribute('data-row-item-key') ||
      virtualItemEl.getAttribute('data-virtual-key') ||
      null;
    const scrollLeft = virtualContainer ? virtualContainer.scrollLeft : null;

    const top = focusMemoryStack[focusMemoryStack.length - 1];
    if (
      top &&
      top.element === target &&
      top.itemKey === itemKey &&
      top.virtualIndex === virtualIndex
    ) {
      if (scrollLeft !== null) {
        top.scrollLeft = scrollLeft;
      }
      return;
    }

    focusMemoryStack.push({
      element: target,
      virtualContainer,
      virtualIndex,
      itemKey,
      scrollLeft,
    });
  }
}

export function popFocusMemory(): boolean {
  while (focusMemoryStack.length > 0) {
    const entry = focusMemoryStack.pop()!;
    const { element: candidate, virtualContainer, virtualIndex, itemKey, scrollLeft } = entry;

    if (virtualContainer && virtualContainer.isConnected) {
      const controller = virtualControllers.get(virtualContainer);
      if (controller) {
        if (itemKey && typeof controller.ensureItemKeyMounted === 'function') {
          const remounted = controller.ensureItemKeyMounted(
            itemKey,
            scrollLeft !== null ? scrollLeft : undefined
          );
          if (remounted && remounted.isConnected && isElementFocusable(remounted)) {
            focusElementSafely(remounted);
            return true;
          }
          if (
            typeof controller.hasPendingFocusRestore === 'function' &&
            controller.hasPendingFocusRestore()
          ) {
            return true;
          }
        }

        if (virtualIndex >= 0 && virtualIndex < controller.totalCount) {
          controller.ensureIndexMounted(virtualIndex);
          const byIdx = virtualContainer.querySelector<HTMLElement>(
            `[data-virtual-index="${virtualIndex}"], [data-row-card-index="${virtualIndex}"]`
          );
          if (byIdx && byIdx.isConnected && isElementFocusable(byIdx)) {
            if (scrollLeft !== null && virtualContainer.getAttribute('data-nav-row') !== 'true') {
              setElementScrollLeftImmediate(virtualContainer, scrollLeft);
            }
            focusElementSafely(byIdx);
            return true;
          }
        }
      }
    }

    if (candidate && candidate.isConnected && isElementFocusable(candidate)) {
      focusElementSafely(candidate);
      return true;
    }
  }
  return false;
}

export function clearFocusMemory(): void {
  focusMemoryStack.length = 0;
  cancelPendingFocusRestore();
}

function setElementScrollLeftImmediate(el: HTMLElement, targetScrollLeft: number): void {
  const next = Math.max(0, targetScrollLeft);
  const prevBehavior = el.style?.scrollBehavior ?? '';
  try {
    if (el.style) {
      el.style.scrollBehavior = 'auto';
    }
    if (typeof el.scrollTo === 'function') {
      try {
        el.scrollTo({ left: next, behavior: 'instant' as ScrollBehavior });
      } catch {
        el.scrollTo({ left: next, behavior: 'auto' });
      }
    }
    el.scrollLeft = next;
  } catch {
    el.scrollLeft = next;
  } finally {
    if (el.style) {
      if (prevBehavior) {
        el.style.scrollBehavior = prevBehavior;
      } else {
        el.style.removeProperty('scroll-behavior');
      }
    }
  }
}

export function findScrollContainer(el: HTMLElement | null): HTMLElement | null {
  let curr = el?.parentElement || null;
  while (curr && curr !== document.body && curr !== document.documentElement) {
    if (curr.getAttribute('data-scroll-container') === 'true') {
      return curr;
    }
    const cls = typeof curr.className === 'string' ? curr.className : '';
    const isMdOverflowHidden =
      cls.includes('md:overflow-hidden') &&
      typeof window !== 'undefined' &&
      (window.innerWidth || 1024) >= 768;
    if (
      !isMdOverflowHidden &&
      (cls.includes('overflow-y-auto') || cls.includes('overflow-y-scroll'))
    ) {
      return curr;
    }
    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
      try {
        spatialPerfStats.computedStyleCalls++;
        const oy = window.getComputedStyle(curr).overflowY;
        if (oy === 'auto' || oy === 'scroll') {
          return curr;
        }
      } catch {}
    }
    curr = curr.parentElement;
  }
  return null;
}

/**
 * Scrolls the appropriate vertical and horizontal containers when an element receives focus.
 * When focusing an element marked with data-scroll-top-anchor="true", resets scrollContainer.scrollTop = 0
 * so the real top of the view/modal (HeroBanner, MovieDetails title, SeriesDetails title/synopsis) is revealed.
 */
export function ensureElementScrolledIntoView(
  el: HTMLElement,
  direction?: SpatialDirection
): void {
  if (!el || !el.isConnected) return;

  // 1. Horizontal row container scroll
  const rowContainer = el.closest<HTMLElement>('[data-nav-row="true"]');
  if (rowContainer && rowContainer !== el) {
    const virtualController = virtualControllers.get(rowContainer);
    if (virtualController && rowContainer.getAttribute('data-virtual-container') === 'true') {
      // Virtualized horizontal rows manage their own immediate scroll + window sync via ensureIndexMounted / ensureItemKeyMounted.
      // Only when entering vertically (up/down) might a card need alignment via the controller.
      if (direction === 'up' || direction === 'down') {
        const rawIdx =
          el.getAttribute('data-virtual-index') ?? el.getAttribute('data-row-card-index');
        const parsedIdx = rawIdx !== null ? parseInt(rawIdx, 10) : -1;
        if (parsedIdx >= 0 && parsedIdx < virtualController.totalCount) {
          virtualController.ensureIndexMounted(parsedIdx);
        }
      }
    } else {
      spatialPerfStats.boundingRectCalls += 2;
      const rowRect = rowContainer.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      if (rowRect.width > 0 && elRect.width > 0) {
        const isLiveVariantsRow = rowContainer.getAttribute('data-live-variants-row') === 'true';
        const padX = isLiveVariantsRow
          ? Math.min(16, Math.max(0, Math.floor((rowRect.width - elRect.width) / 2)))
          : 16;
        const maxScrollLeft =
          isLiveVariantsRow &&
          rowContainer.scrollWidth > rowContainer.clientWidth &&
          rowContainer.clientWidth > 0
            ? Math.max(0, rowContainer.scrollWidth - rowContainer.clientWidth)
            : Infinity;
        if (elRect.left < rowRect.left + padX) {
          setElementScrollLeftImmediate(
            rowContainer,
            Math.min(
              maxScrollLeft,
              Math.max(0, rowContainer.scrollLeft + (elRect.left - rowRect.left) - padX)
            )
          );
        } else if (elRect.right > rowRect.right - padX) {
          setElementScrollLeftImmediate(
            rowContainer,
            Math.min(
              maxScrollLeft,
              Math.max(0, rowContainer.scrollLeft + (elRect.right - rowRect.right) + padX)
            )
          );
        }
      } else if (direction === 'left' || direction === 'right') {
        const rowItems = Array.from(
          rowContainer.querySelectorAll<HTMLElement>('[data-nav-item="true"], button')
        );
        const idx = rowItems.indexOf(el);
        if (idx === 0) {
          setElementScrollLeftImmediate(rowContainer, 0);
        } else if (idx > 0) {
          setElementScrollLeftImmediate(rowContainer, idx * 160);
        }
      }
    }
  }

  // 2. Vertical scroll container
  const scrollContainer = findScrollContainer(el);
  if (scrollContainer) {
    spatialPerfStats.boundingRectCalls += 2;
    const containerRect = scrollContainer.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const topAnchor = el.closest<HTMLElement>('[data-scroll-top-anchor="true"]');

    if (topAnchor && scrollContainer.contains(topAnchor)) {
      if (containerRect.height > 0 && elRect.height > 0) {
        const elBottomAtTopZero = elRect.bottom - containerRect.top + scrollContainer.scrollTop;
        if (elBottomAtTopZero <= containerRect.height - 12) {
          scrollContainer.scrollTop = 0;
          return;
        }
      } else {
        scrollContainer.scrollTop = 0;
        return;
      }
    }

    const blockCandidate =
      el.closest<HTMLElement>('[data-scroll-block="true"]') ||
      el.closest<HTMLElement>('[data-nav-row="true"]') ||
      el;
    const targetBlock =
      blockCandidate && scrollContainer.contains(blockCandidate) && blockCandidate !== scrollContainer
        ? blockCandidate
        : el;

    const blockRect =
      targetBlock === el
        ? elRect
        : (() => {
            spatialPerfStats.boundingRectCalls++;
            return targetBlock.getBoundingClientRect();
          })();

    if (containerRect.height > 0 && blockRect.height > 0) {
      const padY = 24;
      if (blockRect.top < containerRect.top + padY) {
        scrollContainer.scrollTop = Math.max(
          0,
          scrollContainer.scrollTop + (blockRect.top - containerRect.top) - padY
        );
      } else if (blockRect.bottom > containerRect.bottom - padY) {
        if (direction === 'up' || blockRect.height > containerRect.height - padY * 2) {
          scrollContainer.scrollTop = Math.max(
            0,
            scrollContainer.scrollTop + (blockRect.top - containerRect.top) - padY
          );
        } else {
          scrollContainer.scrollTop = Math.max(
            0,
            scrollContainer.scrollTop + (blockRect.bottom - containerRect.bottom) + padY
          );
        }
      }
      return;
    }

    // Fallback for simulated DOM environments where getBoundingClientRect() returns 0x0
    if (direction === 'down') {
      const offsetTop = (targetBlock as any).offsetTop;
      if (typeof offsetTop === 'number' && offsetTop > 0) {
        scrollContainer.scrollTop = offsetTop;
      } else {
        scrollContainer.scrollTop = (scrollContainer.scrollTop || 0) + 120;
      }
    } else if (direction === 'up') {
      const offsetTop = (targetBlock as any).offsetTop;
      if (typeof offsetTop === 'number' && offsetTop > 0) {
        scrollContainer.scrollTop = offsetTop;
      } else {
        scrollContainer.scrollTop = Math.max(0, (scrollContainer.scrollTop || 0) - 120);
      }
    }
    return;
  }

  try {
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  } catch {}
}

export function focusElementSafely(
  el: HTMLElement | null | undefined,
  direction?: SpatialDirection
): boolean {
  if (!el || !el.isConnected) return false;
  try {
    el.focus({ preventScroll: true });
  } catch {
    try {
      el.focus();
    } catch {
      return false;
    }
  }
  ensureElementScrolledIntoView(el, direction);
  return true;
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
  '[data-nav-item="true"]',
].join(', ');

const HIDDEN_CLASS_REGEX = /(?:^|\s)hidden(?:\s|$)/;
const OPACITY_ZERO_CLASS_REGEX = /(?:^|\s)opacity-0(?:\s|$)/;

function isSingleNodeVisible(node: HTMLElement): boolean {
  if (node.hasAttribute('inert') || node.getAttribute('aria-hidden') === 'true' || node.hidden) {
    return false;
  }
  const cls = typeof node.className === 'string' ? node.className : '';
  if (cls) {
    if (
      cls.includes('invisible') ||
      OPACITY_ZERO_CLASS_REGEX.test(cls) ||
      (HIDDEN_CLASS_REGEX.test(cls) &&
        !cls.includes('md:flex') &&
        !cls.includes('md:block') &&
        !cls.includes('sm:inline'))
    ) {
      return false;
    }
  }

  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    try {
      spatialPerfStats.computedStyleCalls++;
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return false;
      }
    } catch {}
  }

  return true;
}

/**
 * Top-down recursive visibility check with ancestor memoization.
 * Shared ancestors (e.g. main, grid wrapper, section) are checked with getComputedStyle
 * only ONCE per navigation pass instead of once per child candidate.
 */
function isSubtreeVisible(
  node: HTMLElement | null,
  ancestorCache?: Map<HTMLElement, boolean>
): boolean {
  if (!node || node === document.body || node === document.documentElement) {
    return true;
  }

  if (ancestorCache) {
    const cached = ancestorCache.get(node);
    if (cached !== undefined) {
      return cached;
    }
  }

  // Check parent first so hidden/inert containers short-circuit before inspecting children
  const parentVisible = isSubtreeVisible(node.parentElement, ancestorCache);
  if (!parentVisible) {
    ancestorCache?.set(node, false);
    return false;
  }

  const selfVisible = isSingleNodeVisible(node);
  ancestorCache?.set(node, selfVisible);
  return selfVisible;
}

/**
 * Determines whether an element is visible, enabled, not inert, and eligible to receive D-pad focus.
 */
export function isElementFocusable(
  el: HTMLElement,
  ancestorCache?: Map<HTMLElement, boolean>
): boolean {
  if (!el || !el.isConnected) return false;
  if ((el as any).disabled || el.getAttribute('aria-disabled') === 'true') return false;

  const tabIndexAttr = el.getAttribute('tabindex');
  if (tabIndexAttr !== null && parseInt(tabIndexAttr, 10) < 0) {
    return false;
  }

  return isSubtreeVisible(el, ancestorCache);
}

/**
 * Returns the active focus scope container (topmost modal/fullscreen overlay if any, otherwise document.body).
 */
export function getActiveScopeRoot(ancestorCache?: Map<HTMLElement, boolean>): HTMLElement {
  if (typeof document === 'undefined') {
    return null as any;
  }

  const cache = ancestorCache || new Map<HTMLElement, boolean>();
  const scopes = Array.from(
    document.querySelectorAll<HTMLElement>('[data-focus-scope="modal"]')
  ).filter((scope) => isElementFocusable(scope, cache));

  if (scopes.length > 0) {
    return scopes[scopes.length - 1];
  }

  return document.body;
}

function queryRawCandidates(root: HTMLElement): HTMLElement[] {
  ensureDomMutationObserver();
  if (
    observerAttached &&
    cachedScopeRoot === root &&
    cachedScopeMutationVersion === domMutationVersion &&
    cachedRawCandidates.length > 0 &&
    cachedRawCandidates.every((el) => el.isConnected)
  ) {
    return cachedRawCandidates;
  }

  spatialPerfStats.querySelectorCalls++;
  const rawList = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  cachedScopeRoot = root;
  cachedScopeMutationVersion = domMutationVersion;
  cachedRawCandidates = rawList;
  return rawList;
}

/**
 * Lists all focusable elements within the active scope root.
 */
export function getFocusableElements(
  scopeRoot?: HTMLElement,
  ancestorCache?: Map<HTMLElement, boolean>
): HTMLElement[] {
  if (typeof document === 'undefined') return [];
  const cache = ancestorCache || new Map<HTMLElement, boolean>();
  const root = scopeRoot || getActiveScopeRoot(cache);
  if (!root) return [];

  const rawList = queryRawCandidates(root);
  return rawList.filter((el) => isElementFocusable(el, cache));
}

interface NavPassContext {
  rectCache: Map<HTMLElement, DOMRect>;
  zoneCache: Map<HTMLElement, string>;
  rowCache: Map<HTMLElement, HTMLElement | null>;
  gridCache: Map<HTMLElement, HTMLElement | null>;
  ancestorCache: Map<HTMLElement, boolean>;
}

function createNavPassContext(): NavPassContext {
  return {
    rectCache: new Map<HTMLElement, DOMRect>(),
    zoneCache: new Map<HTMLElement, string>(),
    rowCache: new Map<HTMLElement, HTMLElement | null>(),
    gridCache: new Map<HTMLElement, HTMLElement | null>(),
    ancestorCache: new Map<HTMLElement, boolean>(),
  };
}

function getCachedRect(el: HTMLElement, ctx: NavPassContext): DOMRect {
  let rect = ctx.rectCache.get(el);
  if (!rect) {
    spatialPerfStats.boundingRectCalls++;
    rect = el.getBoundingClientRect();
    ctx.rectCache.set(el, rect);
  }
  return rect;
}

function getLogicalZone(el: HTMLElement, ctx?: NavPassContext): string {
  if (ctx) {
    const cached = ctx.zoneCache.get(el);
    if (cached !== undefined) return cached;
  }

  let result = 'main';
  const modalScope = el.closest<HTMLElement>('[data-focus-scope="modal"]');
  const zoneEl = el.closest<HTMLElement>('[data-nav-zone]');
  if (modalScope && (!zoneEl || !modalScope.contains(zoneEl))) {
    result = 'modal';
  } else if (zoneEl) {
    const zone = zoneEl.getAttribute('data-nav-zone') || 'main';
    result = zone === 'episodes' ? 'main' : zone;
  } else if (el.closest('aside')) {
    result = 'sidebar';
  } else if (el.closest('header')) {
    result = 'header';
  }

  ctx?.zoneCache.set(el, result);
  return result;
}

function getLogicalRow(el: HTMLElement, ctx?: NavPassContext): HTMLElement | null {
  if (ctx && ctx.rowCache.has(el)) {
    return ctx.rowCache.get(el) ?? null;
  }
  const row = el.closest<HTMLElement>('[data-nav-row], [data-nav-group]');
  ctx?.rowCache.set(el, row);
  return row;
}

function getLogicalGrid(el: HTMLElement, ctx?: NavPassContext): HTMLElement | null {
  if (ctx && ctx.gridCache.has(el)) {
    return ctx.gridCache.get(el) ?? null;
  }
  const grid = el.closest<HTMLElement>('[data-nav-grid="true"]');
  ctx?.gridCache.set(el, grid);
  return grid;
}

interface ZoneBlock {
  type: 'row' | 'grid' | 'item';
  container: HTMLElement;
  items: HTMLElement[];
}

function buildZoneBlocks(zoneCandidates: HTMLElement[], ctx: NavPassContext): ZoneBlock[] {
  const blocks: ZoneBlock[] = [];

  for (const el of zoneCandidates) {
    const row = getLogicalRow(el, ctx);
    if (row) {
      const prev = blocks[blocks.length - 1];
      if (prev && prev.type === 'row' && prev.container === row) {
        prev.items.push(el);
      } else {
        blocks.push({ type: 'row', container: row, items: [el] });
      }
      continue;
    }

    const grid = getLogicalGrid(el, ctx);
    if (grid) {
      const prev = blocks[blocks.length - 1];
      if (prev && prev.type === 'grid' && prev.container === grid) {
        prev.items.push(el);
      } else {
        blocks.push({ type: 'grid', container: grid, items: [el] });
      }
      continue;
    }

    blocks.push({ type: 'item', container: el, items: [el] });
  }

  return blocks;
}

function pickBestItemInBlock(
  current: HTMLElement,
  block: ZoneBlock,
  hasRealGeometry: boolean,
  ctx: NavPassContext
): HTMLElement {
  if (block.items.length === 1) {
    return block.items[0];
  }

  if (current.getAttribute('role') === 'slider') {
    const primaryTarget = block.items.find(
      (item) => item.getAttribute('data-player-primary') === 'true'
    );
    return primaryTarget || block.items[0];
  }

  if (block.type === 'row') {
    if (block.container.getAttribute('data-nav-season-row') === 'true') {
      const selectedSeasonBtn = block.items.find(
        (item) => item.getAttribute('data-season-selected') === 'true'
      );
      if (selectedSeasonBtn) return selectedSeasonBtn;
    }
    if (block.container.getAttribute('data-nav-row') === 'player-error') {
      const primaryErrBtn = block.items.find(
        (item) => item.getAttribute('data-player-error-primary') === 'true'
      );
      if (primaryErrBtn) return primaryErrBtn;
    }
    if (
      block.container.getAttribute('data-live-variants-row') === 'true' ||
      block.container.getAttribute('data-nav-row') === 'live-variants'
    ) {
      const activeVariantBtn = block.items.find(
        (item) => item.getAttribute('data-variant-active') === 'true'
      );
      if (activeVariantBtn) return activeVariantBtn;
    }
  }

  if (hasRealGeometry) {
    const currRect = getCachedRect(current, ctx);
    const cx = currRect.left + currRect.width / 2;

    let pool = block.items;
    if (block.type === 'row') {
      const rowRect = getCachedRect(block.container, ctx);
      if (rowRect.width > 0) {
        const visibleInRow = block.items.filter((item) => {
          const r = getCachedRect(item, ctx);
          return r.right > rowRect.left + 4 && r.left < rowRect.right - 4;
        });
        if (visibleInRow.length > 0) {
          pool = visibleInRow;
        }
      }
    }

    let best = pool[0];
    let bestDist = Infinity;
    for (const item of pool) {
      const r = getCachedRect(item, ctx);
      const ix = r.left + r.width / 2;
      const dist = Math.abs(ix - cx);
      if (dist < bestDist) {
        bestDist = dist;
        best = item;
      }
    }
    return best;
  }

  return block.items[0];
}

function findNextInGridBlock(
  current: HTMLElement,
  gridItems: HTMLElement[],
  direction: SpatialDirection,
  hasRealGeometry: boolean,
  ctx: NavPassContext
): HTMLElement | null {
  const idx = gridItems.indexOf(current);
  if (idx === -1) return null;

  if (hasRealGeometry) {
    const currentRect = getCachedRect(current, ctx);
    const cx = currentRect.left + currentRect.width / 2;
    const cy = currentRect.top + currentRect.height / 2;

    let best: HTMLElement | null = null;
    let bestScore = Infinity;

    for (const item of gridItems) {
      if (item === current) continue;
      const r = getCachedRect(item, ctx);
      if (r.width <= 0 || r.height <= 0) continue;

      const tx = r.left + r.width / 2;
      const ty = r.top + r.height / 2;
      const dx = tx - cx;
      const dy = ty - cy;
      const sameRow = Math.abs(dy) < Math.max(currentRect.height, r.height) * 0.5;
      const overlapX =
        Math.max(0, Math.min(currentRect.right, r.right) - Math.max(currentRect.left, r.left)) > 0;

      if (direction === 'right' && sameRow && dx > 4) {
        const score = dx + Math.abs(dy) * 2;
        if (score < bestScore) {
          bestScore = score;
          best = item;
        }
      } else if (direction === 'left' && sameRow && dx < -4) {
        const score = -dx + Math.abs(dy) * 2;
        if (score < bestScore) {
          bestScore = score;
          best = item;
        }
      } else if (direction === 'down' && !sameRow && dy > 4) {
        const crossPenalty = overlapX ? Math.abs(dx) * 0.2 : Math.abs(dx) * 2.5;
        const score = dy + crossPenalty;
        if (score < bestScore) {
          bestScore = score;
          best = item;
        }
      } else if (direction === 'up' && !sameRow && dy < -4) {
        const crossPenalty = overlapX ? Math.abs(dx) * 0.2 : Math.abs(dx) * 2.5;
        const score = -dy + crossPenalty;
        if (score < bestScore) {
          bestScore = score;
          best = item;
        }
      }
    }

    return best;
  }

  // Structural fallback in headless DOM (0x0 rects)
  const virtualItemEl = current.closest<HTMLElement>('[data-virtual-index]');
  const virtualContainer = virtualItemEl?.closest<HTMLElement>('[data-virtual-container="true"]');
  if (virtualItemEl && virtualContainer) {
    const controller = virtualControllers.get(virtualContainer);
    const currentIndex = parseInt(virtualItemEl.getAttribute('data-virtual-index') || '-1', 10);
    if (controller && controller.totalCount > 0 && currentIndex >= 0) {
      const cols = Math.max(1, controller.getColumns());
      const totalCount = controller.totalCount;
      let targetVirtualIndex = -1;

      if (direction === 'right') {
        targetVirtualIndex = currentIndex + 1 < totalCount ? currentIndex + 1 : -1;
      } else if (direction === 'left') {
        targetVirtualIndex = currentIndex - 1 >= 0 ? currentIndex - 1 : -1;
      } else if (direction === 'down') {
        const currentRow = Math.floor(currentIndex / cols);
        const totalRows = Math.ceil(totalCount / cols);
        targetVirtualIndex =
          currentRow < totalRows - 1 ? Math.min(totalCount - 1, currentIndex + cols) : -1;
      } else if (direction === 'up') {
        targetVirtualIndex = currentIndex - cols >= 0 ? currentIndex - cols : -1;
      }

      if (targetVirtualIndex >= 0) {
        const targetStr = String(targetVirtualIndex);
        const match = gridItems.find(
          (item) =>
            (item.getAttribute('data-virtual-index') ||
              item.closest<HTMLElement>('[data-virtual-index]')?.getAttribute('data-virtual-index')) ===
            targetStr
        );
        return match || null;
      }
      return null;
    }
  }

  if (direction === 'right' || direction === 'down') {
    return idx < gridItems.length - 1 ? gridItems[idx + 1] : null;
  }
  if (direction === 'left' || direction === 'up') {
    return idx > 0 ? gridItems[idx - 1] : null;
  }
  return null;
}

function pickPreferredZoneEntry(
  candidates: HTMLElement[],
  targetZone: string,
  ctx: NavPassContext
): HTMLElement | null {
  const zoneItems = candidates.filter((c) => getLogicalZone(c, ctx) === targetZone);
  if (zoneItems.length === 0) return null;

  if (targetZone === 'categories') {
    const originChannel = zoneItems.find(
      (c) => c.getAttribute('data-live-channel-origin') === 'true'
    );
    if (originChannel) return originChannel;

    const selectedChannel = zoneItems.find(
      (c) => c.getAttribute('data-live-channel-selected') === 'true'
    );
    if (selectedChannel) return selectedChannel;

    const selectedCat = zoneItems.find(
      (c) => c.getAttribute('data-category-selected') === 'true'
    );
    if (selectedCat) return selectedCat;
  }

  if (targetZone === 'content') {
    const primaryConfig = zoneItems.find(
      (c) => c.getAttribute('data-config-primary') === 'true'
    );
    if (primaryConfig) return primaryConfig;

    const epgPrimary = zoneItems.find(
      (c) => c.getAttribute('data-epg-primary') === 'true'
    );
    if (epgPrimary) return epgPrimary;

    const autofocusItem = zoneItems.find((c) => c.getAttribute('data-autofocus') === 'true');
    if (autofocusItem) return autofocusItem;
  }

  if (targetZone === 'header') {
    const searchInput = zoneItems.find(
      (c) => c.getAttribute('data-header-search-input') === 'true'
    );
    if (searchInput) return searchInput;

    const activeHeaderNav = zoneItems.find(
      (c) => c.getAttribute('data-header-nav-active') === 'true'
    );
    if (activeHeaderNav) return activeHeaderNav;

    const activeAccountBtn = zoneItems.find(
      (c) => c.getAttribute('data-header-account-active') === 'true'
    );
    if (activeAccountBtn) return activeAccountBtn;
  }

  if (targetZone === 'sidebar') {
    const activeSidebar = zoneItems.find(
      (c) => c.getAttribute('data-sidebar-active') === 'true'
    );
    if (activeSidebar) return activeSidebar;
  }

  return zoneItems[0];
}

function tryScrollFocusedSynopsis(
  activeEl: HTMLElement,
  direction: 'up' | 'down'
): boolean {
  if (activeEl.getAttribute('data-synopsis-focus') !== 'true') {
    return false;
  }
  const step = 120;

  const selfMaxScroll = Math.max(0, (activeEl.scrollHeight || 0) - (activeEl.clientHeight || 0));
  if (selfMaxScroll > 2) {
    if (direction === 'down' && activeEl.scrollTop < selfMaxScroll - 2) {
      activeEl.scrollTop = Math.min(selfMaxScroll, activeEl.scrollTop + step);
      return true;
    }
    if (direction === 'up' && activeEl.scrollTop > 2) {
      activeEl.scrollTop = Math.max(0, activeEl.scrollTop - step);
      return true;
    }
  }

  const scrollContainer = findScrollContainer(activeEl);
  if (scrollContainer) {
    const containerMaxScroll = Math.max(
      0,
      (scrollContainer.scrollHeight || 0) - (scrollContainer.clientHeight || 0)
    );
    if (containerMaxScroll > 2) {
      spatialPerfStats.boundingRectCalls += 2;
      const cRect = scrollContainer.getBoundingClientRect();
      const aRect = activeEl.getBoundingClientRect();
      const hasRects = cRect.height > 0 && aRect.height > 0;

      if (direction === 'down') {
        const synopsisStillBelowViewport = hasRects ? aRect.bottom > cRect.bottom - 16 : false;
        if (synopsisStillBelowViewport && scrollContainer.scrollTop < containerMaxScroll - 2) {
          const delta = Math.min(step, Math.ceil(aRect.bottom - (cRect.bottom - 16)));
          scrollContainer.scrollTop = Math.min(
            containerMaxScroll,
            scrollContainer.scrollTop + Math.max(1, delta)
          );
          return true;
        }
      } else if (direction === 'up') {
        const synopsisStillAboveViewport = hasRects ? aRect.top < cRect.top + 16 : false;
        if (synopsisStillAboveViewport && scrollContainer.scrollTop > 2) {
          const delta = Math.min(step, Math.ceil(cRect.top + 16 - aRect.top));
          scrollContainer.scrollTop = Math.max(
            0,
            scrollContainer.scrollTop - Math.max(1, delta)
          );
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * If activeEl is inside a virtualized container ([data-virtual-container="true"]) and moving in `direction`
 * targets a logical index that is outside or near the edge of the currently mounted window,
 * synchronously expands/shifts the virtual window before collecting candidates.
 */
function ensureVirtualTargetMountedIfNeeded(
  activeEl: HTMLElement | null,
  direction: SpatialDirection
): void {
  if (!activeEl) return;

  // 1. Vertical showcase row window expansion (reaching unmounted showcase rows with ArrowDown/ArrowUp)
  if (direction === 'down' || direction === 'up') {
    const homeRowEl = activeEl.closest<HTMLElement>('[data-home-row-index]');
    if (homeRowEl) {
      const currentRowIndex = parseInt(homeRowEl.getAttribute('data-home-row-index') || '-1', 10);
      const rowsContainer = homeRowEl.closest<HTMLElement>('[data-showcase-rows-container="true"]');
      if (rowsContainer && !isNaN(currentRowIndex) && currentRowIndex >= 0) {
        const rowController = showcaseRowControllers.get(rowsContainer);
        if (rowController && rowController.totalRows > 0) {
          const targetRowIndex =
            direction === 'down' ? currentRowIndex + 1 : currentRowIndex - 1;
          if (targetRowIndex >= 0 && targetRowIndex < rowController.totalRows) {
            const expanded = rowController.ensureRowMounted(targetRowIndex, currentRowIndex);
            if (expanded) {
              spatialPerfStats.virtualWindowExpansions++;
              invalidateCandidateCache();
            }
          }
        }
      }
    } else if (
      direction === 'down' &&
      (activeEl.closest('[data-hero-stage="true"]') ||
        activeEl.closest('[data-showcase-categories-bar="true"]'))
    ) {
      const showcaseSection = activeEl.closest<HTMLElement>('[data-showcase-section]');
      const rowsContainer = showcaseSection?.querySelector<HTMLElement>(
        '[data-showcase-rows-container="true"]'
      );
      if (rowsContainer) {
        const rowController = showcaseRowControllers.get(rowsContainer);
        if (rowController && rowController.totalRows > 0) {
          const expanded = rowController.ensureRowMounted(0, 0);
          if (expanded) {
            spatialPerfStats.virtualWindowExpansions++;
            invalidateCandidateCache();
          }
        }
      }
    }
  }

  // 2. Virtualized grid or horizontal row item window expansion
  const virtualItemEl = activeEl.closest<HTMLElement>('[data-virtual-index]');
  if (!virtualItemEl) return;

  const virtualContainer = virtualItemEl.closest<HTMLElement>('[data-virtual-container="true"]');
  if (!virtualContainer) return;

  const controller = virtualControllers.get(virtualContainer);
  if (!controller || controller.totalCount <= 0) return;

  const currentIndex = parseInt(virtualItemEl.getAttribute('data-virtual-index') || '-1', 10);
  if (isNaN(currentIndex) || currentIndex < 0) return;

  const isHorizontalRow = virtualContainer.getAttribute('data-nav-row') === 'true';
  const cols = Math.max(1, controller.getColumns());
  const totalCount = controller.totalCount;
  let targetIndex = -1;

  if (isHorizontalRow) {
    if (direction === 'right') {
      targetIndex = currentIndex + 1 < totalCount ? currentIndex + 1 : -1;
    } else if (direction === 'left') {
      targetIndex = currentIndex - 1 >= 0 ? currentIndex - 1 : -1;
    }
  } else {
    if (direction === 'right') {
      targetIndex = cols > 1 && currentIndex + 1 < totalCount ? currentIndex + 1 : -1;
    } else if (direction === 'left') {
      targetIndex = cols > 1 && currentIndex - 1 >= 0 ? currentIndex - 1 : -1;
    } else if (direction === 'down') {
      const currentRow = Math.floor(currentIndex / cols);
      const totalRows = Math.ceil(totalCount / cols);
      targetIndex =
        currentRow < totalRows - 1 ? Math.min(totalCount - 1, currentIndex + cols) : -1;
    } else if (direction === 'up') {
      targetIndex = currentIndex - cols >= 0 ? currentIndex - cols : -1;
    }
  }

  if (targetIndex >= 0 && targetIndex < totalCount) {
    if (isHorizontalRow) {
      const expanded = controller.ensureIndexMounted(targetIndex, currentIndex);
      if (expanded) {
        spatialPerfStats.virtualWindowExpansions++;
        invalidateCandidateCache();
      }
      return;
    }

    const existingTarget = virtualContainer.querySelector<HTMLElement>(
      `[data-virtual-index="${targetIndex}"]`
    );
    if (!existingTarget) {
      const expanded = controller.ensureIndexMounted(targetIndex, currentIndex);
      if (expanded) {
        spatialPerfStats.virtualWindowExpansions++;
        invalidateCandidateCache();
      }
    } else {
      // Pre-expand window if within 1 row of the boundary
      const lookaheadStep = cols;
      const aheadIndex =
        direction === 'down' || direction === 'right'
          ? Math.min(totalCount - 1, targetIndex + lookaheadStep)
          : Math.max(0, targetIndex - lookaheadStep);
      const aheadEl = virtualContainer.querySelector<HTMLElement>(
        `[data-virtual-index="${aheadIndex}"]`
      );
      if (!aheadEl) {
        const expanded = controller.ensureIndexMounted(targetIndex, currentIndex);
        if (expanded) {
          spatialPerfStats.virtualWindowExpansions++;
          invalidateCandidateCache();
        }
      }
    }
  } else if (!isHorizontalRow && (direction === 'down' || direction === 'up')) {
    // Crossing vertical boundary between sibling virtualized grids in the same scroll container (e.g. Início search domains)
    const scrollRoot = findScrollContainer(virtualContainer) || virtualContainer.parentElement;
    if (scrollRoot) {
      const siblingGrids = Array.from(
        scrollRoot.querySelectorAll<HTMLElement>('[data-nav-grid="true"][data-virtual-container="true"]')
      );
      const gIdx = siblingGrids.indexOf(virtualContainer);
      if (direction === 'down' && gIdx !== -1 && gIdx + 1 < siblingGrids.length) {
        const nextController = virtualControllers.get(siblingGrids[gIdx + 1]);
        if (nextController && nextController.totalCount > 0) {
          const expanded = nextController.ensureIndexMounted(0);
          if (expanded) {
            spatialPerfStats.virtualWindowExpansions++;
            invalidateCandidateCache();
          }
        }
      } else if (direction === 'up' && gIdx > 0) {
        const prevController = virtualControllers.get(siblingGrids[gIdx - 1]);
        if (prevController && prevController.totalCount > 0) {
          const expanded = prevController.ensureIndexMounted(prevController.totalCount - 1);
          if (expanded) {
            spatialPerfStats.virtualWindowExpansions++;
            invalidateCandidateCache();
          }
        }
      }
    }
  }
}

/**
 * Moves focus in the requested direction ('up' | 'down' | 'left' | 'right').
 * Follows visual/DOM zone structure so vertical navigation inside content scrolls through rows
 * and never jumps accidentally to the sidebar or search bar.
 */
export function moveSpatialFocus(direction: SpatialDirection): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  spatialPerfStats.moveCalls++;

  // Any new spatial navigation immediately discards pending focus restorations
  cancelPendingFocusRestore();

  const initialActive =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  // Expand virtual window synchronously if navigating near/across a virtualized list boundary
  ensureVirtualTargetMountedIfNeeded(initialActive, direction);

  const ctx = createNavPassContext();
  const scopeRoot = getActiveScopeRoot(ctx.ancestorCache);
  const candidates = getFocusableElements(scopeRoot, ctx.ancestorCache);
  if (candidates.length === 0) return null;

  const activeEl =
    document.activeElement instanceof HTMLElement && scopeRoot.contains(document.activeElement)
      ? document.activeElement
      : null;

  if (!activeEl || !candidates.includes(activeEl)) {
    const contentCandidates = candidates.filter((c) => getLogicalZone(c, ctx) === 'content');
    const first =
      candidates.find((c) => c.getAttribute('data-autofocus') === 'true') ||
      contentCandidates[0] ||
      candidates[0];
    focusElementSafely(first, direction);
    return first;
  }

  const activeRect = getCachedRect(activeEl, ctx);
  const hasRealGeometry =
    activeRect.width > 0 &&
    activeRect.height > 0 &&
    candidates.some((c) => {
      if (c === activeEl) return false;
      const r = getCachedRect(c, ctx);
      return r.width > 0 && r.height > 0 && (r.left !== activeRect.left || r.top !== activeRect.top);
    });

  const currentZone = getLogicalZone(activeEl, ctx);
  const currentRow = getLogicalRow(activeEl, ctx);
  const currentGrid = getLogicalGrid(activeEl, ctx);
  const sameZoneCandidates = candidates.filter((c) => getLogicalZone(c, ctx) === currentZone);

  // Account dropdown menu or Categories dropdown menu: explicit vertical list inside its own modal focus scope
  const verticalMenuScope = activeEl.closest<HTMLElement>(
    '[data-header-account-menu="true"], [data-categories-menu="true"]'
  );
  if (verticalMenuScope) {
    const menuItems = candidates.filter((c) => verticalMenuScope.contains(c));
    const idx = menuItems.indexOf(activeEl);
    if (idx !== -1) {
      if (direction === 'down') {
        if (idx < menuItems.length - 1) {
          const nextItem = menuItems[idx + 1];
          focusElementSafely(nextItem, direction);
          return nextItem;
        }
        return activeEl;
      }
      if (direction === 'up') {
        if (idx > 0) {
          const prevItem = menuItems[idx - 1];
          focusElementSafely(prevItem, direction);
          return prevItem;
        }
        return activeEl;
      }
    }
    return activeEl;
  }

  // ---------------------------------------------------------------------------
  // VERTICAL NAVIGATION ('up' | 'down')
  // ---------------------------------------------------------------------------
  if (direction === 'up' || direction === 'down') {
    // 0. If currently focused on a scrollable synopsis region, scroll it progressively before moving focus
    if (tryScrollFocusedSynopsis(activeEl, direction)) {
      return activeEl;
    }

    if (currentZone === 'header') {
      const isTwoRowHeader =
        typeof window !== 'undefined' &&
        typeof window.innerWidth === 'number' &&
        window.innerWidth > 0 &&
        window.innerWidth < 768;

      if (isTwoRowHeader) {
        const inNavStrip = Boolean(activeEl.closest('[data-header-nav-strip="true"]'));
        const stripItems = sameZoneCandidates.filter((c) =>
          Boolean(c.closest('[data-header-nav-strip="true"]'))
        );
        const topRowItems = sameZoneCandidates.filter(
          (c) => !c.closest('[data-header-nav-strip="true"]')
        );

        if (direction === 'down' && !inNavStrip && stripItems.length > 0) {
          const targetInStrip =
            stripItems.find((c) => c.getAttribute('data-header-nav-active') === 'true') ||
            stripItems[0];
          focusElementSafely(targetInStrip, direction);
          return targetInStrip;
        }

        if (direction === 'up' && inNavStrip && topRowItems.length > 0) {
          const targetTop =
            topRowItems.find((c) => c.getAttribute('data-header-search-input') === 'true') ||
            topRowItems[0];
          focusElementSafely(targetTop, direction);
          return targetTop;
        }
      }
    } else {
      const blocks = buildZoneBlocks(sameZoneCandidates, ctx);
      const bIdx = blocks.findIndex((b) => b.items.includes(activeEl));

      if (bIdx !== -1) {
        const currentBlock = blocks[bIdx];

        // 1. If inside a grid block, first try moving vertically within the grid
        if (currentBlock.type === 'grid') {
          const nextInGrid = findNextInGridBlock(
            activeEl,
            currentBlock.items,
            direction,
            hasRealGeometry,
            ctx
          );
          if (nextInGrid) {
            focusElementSafely(nextInGrid, direction);
            return nextInGrid;
          }
        }

        // 2. Move to the adjacent block within the SAME zone
        const targetBlockIdx = direction === 'down' ? bIdx + 1 : bIdx - 1;
        if (targetBlockIdx >= 0 && targetBlockIdx < blocks.length) {
          const targetBlock = blocks[targetBlockIdx];
          const nextEl = pickBestItemInBlock(activeEl, targetBlock, hasRealGeometry, ctx);
          focusElementSafely(nextEl, direction);
          return nextEl;
        }
      }
    }

    // 3. At the vertical boundary of the current zone:
    if (direction === 'up') {
      const scrollContainer = findScrollContainer(activeEl);
      if (scrollContainer && scrollContainer.scrollTop > 0) {
        scrollContainer.scrollTop = 0;
        return activeEl;
      }

      if (currentZone === 'content') {
        const showcaseCategoriesBtn = candidates.find(
          (c) =>
            getLogicalZone(c, ctx) === 'categories' &&
            Boolean(c.closest('[data-showcase-categories-bar="true"]'))
        );
        if (showcaseCategoriesBtn) {
          focusElementSafely(showcaseCategoriesBtn, direction);
          return showcaseCategoriesBtn;
        }
      }

      if (currentZone === 'content' || currentZone === 'categories') {
        const headerTarget = pickPreferredZoneEntry(candidates, 'header', ctx);
        if (headerTarget) {
          focusElementSafely(headerTarget, direction);
          return headerTarget;
        }
      }

      return activeEl;
    }

    if (direction === 'down') {
      if (
        currentZone === 'categories' &&
        Boolean(activeEl.closest('[data-showcase-categories-bar="true"]'))
      ) {
        const contentTarget = pickPreferredZoneEntry(candidates, 'content', ctx);
        if (contentTarget) {
          focusElementSafely(contentTarget, direction);
          return contentTarget;
        }
      }

      if (currentZone === 'header') {
        const contentCandidates = candidates.filter((c) => getLogicalZone(c, ctx) === 'content');
        const contentBlocks = buildZoneBlocks(contentCandidates, ctx);
        if (
          contentBlocks.length > 0 &&
          contentBlocks[0].type === 'row' &&
          (contentBlocks[0].container.getAttribute('data-live-variants-row') === 'true' ||
            contentBlocks[0].container.getAttribute('data-nav-row') === 'live-variants')
        ) {
          const nextEl = pickBestItemInBlock(activeEl, contentBlocks[0], hasRealGeometry, ctx);
          focusElementSafely(nextEl, direction);
          return nextEl;
        }
        if (activeEl.hasAttribute('data-header-nav-id')) {
          const categoriesTarget = pickPreferredZoneEntry(candidates, 'categories', ctx);
          if (categoriesTarget) {
            focusElementSafely(categoriesTarget, direction);
            return categoriesTarget;
          }
        }
        const contentTarget = pickPreferredZoneEntry(candidates, 'content', ctx);
        if (contentTarget) {
          focusElementSafely(contentTarget, direction);
          return contentTarget;
        }
        const categoriesTarget = pickPreferredZoneEntry(candidates, 'categories', ctx);
        if (categoriesTarget) {
          focusElementSafely(categoriesTarget, direction);
          return categoriesTarget;
        }
      }

      return activeEl;
    }
  }

  // ---------------------------------------------------------------------------
  // HORIZONTAL NAVIGATION ('left' | 'right')
  // ---------------------------------------------------------------------------
  if (direction === 'left' || direction === 'right') {
    // 0. Inside the top header bar
    if (currentZone === 'header') {
      const isTwoRowHeader =
        typeof window !== 'undefined' &&
        typeof window.innerWidth === 'number' &&
        window.innerWidth > 0 &&
        window.innerWidth < 768;

      const headerRowPool = isTwoRowHeader
        ? activeEl.closest('[data-header-nav-strip="true"]')
          ? sameZoneCandidates.filter((c) => Boolean(c.closest('[data-header-nav-strip="true"]')))
          : sameZoneCandidates.filter((c) => !c.closest('[data-header-nav-strip="true"]'))
        : sameZoneCandidates;

      const hIdx = headerRowPool.indexOf(activeEl);
      if (hIdx !== -1) {
        if (direction === 'right' && hIdx < headerRowPool.length - 1) {
          const nextHeaderEl = headerRowPool[hIdx + 1];
          focusElementSafely(nextHeaderEl, direction);
          return nextHeaderEl;
        }
        if (direction === 'left' && hIdx > 0) {
          const prevHeaderEl = headerRowPool[hIdx - 1];
          focusElementSafely(prevHeaderEl, direction);
          return prevHeaderEl;
        }
      }
      return activeEl;
    }

    // 1. Inside an explicit horizontal row (data-nav-row / data-nav-group)
    if (currentRow) {
      const rowController = virtualControllers.get(currentRow);
      const rawVirtualIdx =
        activeEl.getAttribute('data-virtual-index') ?? activeEl.getAttribute('data-row-card-index');
      const currentVirtualIdx = rawVirtualIdx !== null ? parseInt(rawVirtualIdx, 10) : -1;

      if (rowController && rowController.totalCount > 0 && currentVirtualIdx >= 0) {
        if (direction === 'right') {
          const nextLogicalIdx = currentVirtualIdx + 1;
          if (nextLogicalIdx < rowController.totalCount) {
            let nextEl = currentRow.querySelector<HTMLElement>(
              `[data-virtual-index="${nextLogicalIdx}"], [data-row-card-index="${nextLogicalIdx}"]`
            );
            if (!nextEl) {
              const expanded = rowController.ensureIndexMounted(nextLogicalIdx, currentVirtualIdx);
              if (expanded) {
                spatialPerfStats.virtualWindowExpansions++;
                invalidateCandidateCache();
              }
              nextEl = currentRow.querySelector<HTMLElement>(
                `[data-virtual-index="${nextLogicalIdx}"], [data-row-card-index="${nextLogicalIdx}"]`
              );
            }
            if (nextEl && isElementFocusable(nextEl)) {
              focusElementSafely(nextEl, direction);
              return nextEl;
            }
          }
          if (
            currentZone === 'categories' &&
            !activeEl.closest('[data-showcase-categories-bar="true"]')
          ) {
            const contentTarget = pickPreferredZoneEntry(candidates, 'content', ctx);
            if (contentTarget) {
              focusElementSafely(contentTarget, direction);
              return contentTarget;
            }
          }
          return activeEl;
        }

        if (direction === 'left') {
          if (currentVirtualIdx > 0) {
            const prevLogicalIdx = currentVirtualIdx - 1;
            let prevEl = currentRow.querySelector<HTMLElement>(
              `[data-virtual-index="${prevLogicalIdx}"], [data-row-card-index="${prevLogicalIdx}"]`
            );
            if (!prevEl) {
              const expanded = rowController.ensureIndexMounted(prevLogicalIdx, currentVirtualIdx);
              if (expanded) {
                spatialPerfStats.virtualWindowExpansions++;
                invalidateCandidateCache();
              }
              prevEl = currentRow.querySelector<HTMLElement>(
                `[data-virtual-index="${prevLogicalIdx}"], [data-row-card-index="${prevLogicalIdx}"]`
              );
            }
            if (prevEl && isElementFocusable(prevEl)) {
              focusElementSafely(prevEl, direction);
              return prevEl;
            }
            return activeEl;
          }

          // Only at logical index 0 may ArrowLeft leave the virtualized row for sidebar/categories (when categories is a sidebar)
          if (currentZone === 'content') {
            const categoriesTarget = pickPreferredZoneEntry(candidates, 'categories', ctx);
            if (
              categoriesTarget &&
              !categoriesTarget.closest('[data-showcase-categories-bar="true"]')
            ) {
              focusElementSafely(categoriesTarget, direction);
              return categoriesTarget;
            }
            const sidebarTarget = pickPreferredZoneEntry(candidates, 'sidebar', ctx);
            if (sidebarTarget) {
              focusElementSafely(sidebarTarget, direction);
              return sidebarTarget;
            }
          } else if (currentZone === 'categories') {
            const sidebarTarget = pickPreferredZoneEntry(candidates, 'sidebar', ctx);
            if (sidebarTarget) {
              focusElementSafely(sidebarTarget, direction);
              return sidebarTarget;
            }
          }
          return activeEl;
        }
      }

      const rowItems = candidates.filter((c) => getLogicalRow(c, ctx) === currentRow);
      const idxInRow = rowItems.indexOf(activeEl);

      if (direction === 'right') {
        if (idxInRow >= 0 && idxInRow < rowItems.length - 1) {
          const nextInRow = rowItems[idxInRow + 1];
          focusElementSafely(nextInRow, direction);
          return nextInRow;
        }
        if (
          currentZone === 'categories' &&
          !activeEl.closest('[data-showcase-categories-bar="true"]')
        ) {
          const contentTarget = pickPreferredZoneEntry(candidates, 'content', ctx);
          if (contentTarget) {
            focusElementSafely(contentTarget, direction);
            return contentTarget;
          }
        }
        return activeEl;
      }

      if (direction === 'left') {
        if (idxInRow > 0) {
          const prevInRow = rowItems[idxInRow - 1];
          focusElementSafely(prevInRow, direction);
          return prevInRow;
        }
        if (currentZone === 'content') {
          const categoriesTarget = pickPreferredZoneEntry(candidates, 'categories', ctx);
          if (
            categoriesTarget &&
            !categoriesTarget.closest('[data-showcase-categories-bar="true"]')
          ) {
            focusElementSafely(categoriesTarget, direction);
            return categoriesTarget;
          }
          const sidebarTarget = pickPreferredZoneEntry(candidates, 'sidebar', ctx);
          if (sidebarTarget) {
            focusElementSafely(sidebarTarget, direction);
            return sidebarTarget;
          }
        } else if (currentZone === 'categories') {
          const sidebarTarget = pickPreferredZoneEntry(candidates, 'sidebar', ctx);
          if (sidebarTarget) {
            focusElementSafely(sidebarTarget, direction);
            return sidebarTarget;
          }
        }
        return activeEl;
      }
    }

    // 2. Inside a CSS Grid (data-nav-grid="true")
    if (currentGrid) {
      const gridItems = sameZoneCandidates.filter((c) => getLogicalGrid(c, ctx) === currentGrid);
      const nextInGrid = findNextInGridBlock(activeEl, gridItems, direction, hasRealGeometry, ctx);
      if (nextInGrid) {
        focusElementSafely(nextInGrid, direction);
        return nextInGrid;
      }

      if (direction === 'left') {
        const categoriesTarget = pickPreferredZoneEntry(candidates, 'categories', ctx);
        if (
          categoriesTarget &&
          !categoriesTarget.closest('[data-showcase-categories-bar="true"]')
        ) {
          focusElementSafely(categoriesTarget, direction);
          return categoriesTarget;
        }
        const sidebarTarget = pickPreferredZoneEntry(candidates, 'sidebar', ctx);
        if (sidebarTarget) {
          focusElementSafely(sidebarTarget, direction);
          return sidebarTarget;
        }
      }
      return activeEl;
    }

    // 3. Standalone items in sidebar, categories, header, or modal
    if (direction === 'right') {
      if (currentZone === 'sidebar') {
        const categoriesTarget = pickPreferredZoneEntry(candidates, 'categories', ctx);
        if (categoriesTarget) {
          focusElementSafely(categoriesTarget, direction);
          return categoriesTarget;
        }
        const contentTarget = pickPreferredZoneEntry(candidates, 'content', ctx);
        if (contentTarget) {
          focusElementSafely(contentTarget, direction);
          return contentTarget;
        }
        const headerTarget = pickPreferredZoneEntry(candidates, 'header', ctx);
        if (headerTarget) {
          focusElementSafely(headerTarget, direction);
          return headerTarget;
        }
      } else if (
        currentZone === 'categories' &&
        !activeEl.closest('[data-showcase-categories-bar="true"]')
      ) {
        const contentTarget = pickPreferredZoneEntry(candidates, 'content', ctx);
        if (contentTarget) {
          focusElementSafely(contentTarget, direction);
          return contentTarget;
        }
      }
    }

    if (direction === 'left') {
      if (currentZone === 'content') {
        const categoriesTarget = pickPreferredZoneEntry(candidates, 'categories', ctx);
        if (
          categoriesTarget &&
          !categoriesTarget.closest('[data-showcase-categories-bar="true"]')
        ) {
          focusElementSafely(categoriesTarget, direction);
          return categoriesTarget;
        }
        const sidebarTarget = pickPreferredZoneEntry(candidates, 'sidebar', ctx);
        if (sidebarTarget) {
          focusElementSafely(sidebarTarget, direction);
          return sidebarTarget;
        }
      } else if (currentZone === 'categories') {
        const sidebarTarget = pickPreferredZoneEntry(candidates, 'sidebar', ctx);
        if (sidebarTarget) {
          focusElementSafely(sidebarTarget, direction);
          return sidebarTarget;
        }
      }
    }
  }

  return activeEl;
}
