export type NavMode = 'pointer' | 'remote';
export type SpatialDirection = 'up' | 'down' | 'left' | 'right';

let currentNavMode: NavMode = 'pointer';
const modeListeners = new Set<(mode: NavMode) => void>();
const focusMemoryStack: HTMLElement[] = [];

export function getNavMode(): NavMode {
  return currentNavMode;
}

export function setNavMode(mode: NavMode): void {
  if (currentNavMode === mode && typeof document !== 'undefined' && document.documentElement.dataset.navMode === mode) {
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
    focusMemoryStack.push(target);
  }
}

export function popFocusMemory(): boolean {
  while (focusMemoryStack.length > 0) {
    const candidate = focusMemoryStack.pop();
    if (candidate && candidate.isConnected && isElementFocusable(candidate)) {
      focusElementSafely(candidate);
      return true;
    }
  }
  return false;
}

export function clearFocusMemory(): void {
  focusMemoryStack.length = 0;
}

export function focusElementSafely(el: HTMLElement | null | undefined): boolean {
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
  try {
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  } catch {}
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

/**
 * Determines whether an element is visible, enabled, not inert, and eligible to receive D-pad focus.
 */
export function isElementFocusable(el: HTMLElement): boolean {
  if (!el || !el.isConnected) return false;
  if ((el as any).disabled || el.getAttribute('aria-disabled') === 'true') return false;

  const tabIndexAttr = el.getAttribute('tabindex');
  if (tabIndexAttr !== null && parseInt(tabIndexAttr, 10) < 0) {
    return false;
  }

  let curr: HTMLElement | null = el;
  while (curr && curr !== document.body && curr !== document.documentElement) {
    if (curr.hasAttribute('inert') || curr.getAttribute('aria-hidden') === 'true' || curr.hidden) {
      return false;
    }
    const cls = typeof curr.className === 'string' ? curr.className : '';
    if (
      cls.includes('invisible') ||
      cls.includes('pointer-events-none') ||
      (/(?:^|\s)hidden(?:\s|$)/.test(cls) && !cls.includes('md:flex') && !cls.includes('md:block') && !cls.includes('sm:inline'))
    ) {
      return false;
    }

    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
      try {
        const style = window.getComputedStyle(curr);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return false;
        }
      } catch {}
    }

    curr = curr.parentElement;
  }

  return true;
}

/**
 * Returns the active focus scope container (topmost modal/fullscreen overlay if any, otherwise document.body).
 */
export function getActiveScopeRoot(): HTMLElement {
  if (typeof document === 'undefined') {
    return null as any;
  }

  const scopes = Array.from(
    document.querySelectorAll<HTMLElement>('[data-focus-scope="modal"]')
  ).filter((scope) => isElementFocusable(scope));

  if (scopes.length > 0) {
    return scopes[scopes.length - 1];
  }

  return document.body;
}

/**
 * Lists all focusable elements within the active scope root.
 */
export function getFocusableElements(scopeRoot?: HTMLElement): HTMLElement[] {
  if (typeof document === 'undefined') return [];
  const root = scopeRoot || getActiveScopeRoot();
  if (!root) return [];

  const rawList = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return rawList.filter((el) => isElementFocusable(el));
}

function getLogicalZone(el: HTMLElement): string {
  const zoneEl = el.closest<HTMLElement>('[data-nav-zone]');
  if (zoneEl) {
    return zoneEl.getAttribute('data-nav-zone') || 'main';
  }
  if (el.closest('aside')) return 'sidebar';
  if (el.closest('header')) return 'header';
  return 'main';
}

function getLogicalRow(el: HTMLElement): HTMLElement | null {
  return el.closest<HTMLElement>('[data-nav-row], [data-nav-group]');
}

/**
 * Moves focus in the requested direction ('up' | 'down' | 'left' | 'right').
 * Supports both real 2D bounding-box geometry (Chromium / Android TV WebView)
 * and structural DOM-zone navigation when bounding rects are 0x0 (e.g. happy-dom tests).
 */
export function moveSpatialFocus(direction: SpatialDirection): HTMLElement | null {
  if (typeof document === 'undefined') return null;

  const scopeRoot = getActiveScopeRoot();
  const candidates = getFocusableElements(scopeRoot);
  if (candidates.length === 0) return null;

  const activeEl =
    document.activeElement instanceof HTMLElement && scopeRoot.contains(document.activeElement)
      ? document.activeElement
      : null;

  if (!activeEl || !candidates.includes(activeEl)) {
    const first =
      candidates.find((c) => c.getAttribute('data-autofocus') === 'true') || candidates[0];
    focusElementSafely(first);
    return first;
  }

  const activeRect = activeEl.getBoundingClientRect();
  const hasRealGeometry =
    activeRect.width > 0 &&
    activeRect.height > 0 &&
    candidates.some((c) => {
      if (c === activeEl) return false;
      const r = c.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (r.left !== activeRect.left || r.top !== activeRect.top);
    });

  if (hasRealGeometry) {
    const nextByGeometry = findNextByGeometry(activeEl, activeRect, candidates, direction);
    if (nextByGeometry) {
      focusElementSafely(nextByGeometry);
      return nextByGeometry;
    }
  }

  const nextByStructure = findNextByStructure(activeEl, candidates, direction);
  if (nextByStructure) {
    focusElementSafely(nextByStructure);
    return nextByStructure;
  }

  return activeEl;
}

function findNextByGeometry(
  current: HTMLElement,
  currentRect: DOMRect,
  candidates: HTMLElement[],
  direction: SpatialDirection
): HTMLElement | null {
  const cx = currentRect.left + currentRect.width / 2;
  const cy = currentRect.top + currentRect.height / 2;
  const currentRow = getLogicalRow(current);
  const currentZone = getLogicalZone(current);

  let bestCandidate: HTMLElement | null = null;
  let bestScore = Infinity;

  for (const candidate of candidates) {
    if (candidate === current) continue;
    const rect = candidate.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

    const tx = rect.left + rect.width / 2;
    const ty = rect.top + rect.height / 2;
    const dx = tx - cx;
    const dy = ty - cy;

    let primaryDist = 0;
    let crossDist = 0;
    let isValidDirection = false;

    const overlapX =
      Math.max(0, Math.min(currentRect.right, rect.right) - Math.max(currentRect.left, rect.left)) > 0;
    const overlapY =
      Math.max(0, Math.min(currentRect.bottom, rect.bottom) - Math.max(currentRect.top, rect.top)) > 0;

    switch (direction) {
      case 'right':
        if (dx > 4 && (overlapY || Math.abs(dy) < Math.max(currentRect.height, rect.height) * 2.5 || getLogicalZone(candidate) !== currentZone)) {
          isValidDirection = true;
          primaryDist = Math.max(0, rect.left - currentRect.right);
          if (primaryDist === 0) primaryDist = dx;
          crossDist = overlapY ? Math.abs(dy) * 0.25 : Math.abs(dy) * 2.5;
        }
        break;
      case 'left':
        if (dx < -4 && (overlapY || Math.abs(dy) < Math.max(currentRect.height, rect.height) * 2.5 || getLogicalZone(candidate) !== currentZone)) {
          isValidDirection = true;
          primaryDist = Math.max(0, currentRect.left - rect.right);
          if (primaryDist === 0) primaryDist = -dx;
          crossDist = overlapY ? Math.abs(dy) * 0.25 : Math.abs(dy) * 2.5;
        }
        break;
      case 'down':
        if (dy > 4) {
          isValidDirection = true;
          primaryDist = Math.max(0, rect.top - currentRect.bottom);
          if (primaryDist === 0) primaryDist = dy;
          crossDist = overlapX ? Math.abs(dx) * 0.2 : Math.abs(dx) * 1.5;
        }
        break;
      case 'up':
        if (dy < -4) {
          isValidDirection = true;
          primaryDist = Math.max(0, currentRect.top - rect.bottom);
          if (primaryDist === 0) primaryDist = -dy;
          crossDist = overlapX ? Math.abs(dx) * 0.2 : Math.abs(dx) * 1.5;
        }
        break;
    }

    if (!isValidDirection) continue;

    let zonePenalty = 0;
    const candidateRow = getLogicalRow(candidate);
    const candidateZone = getLogicalZone(candidate);

    if ((direction === 'left' || direction === 'right') && currentRow && candidateRow === currentRow) {
      zonePenalty = -150;
    } else if (candidateZone !== currentZone) {
      if ((direction === 'up' || direction === 'down') && currentZone === 'sidebar') {
        zonePenalty = 2000;
      } else {
        zonePenalty = 120;
      }
    }

    const score = primaryDist + crossDist + zonePenalty;
    if (score < bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  return bestCandidate;
}

function findNextByStructure(
  current: HTMLElement,
  candidates: HTMLElement[],
  direction: SpatialDirection
): HTMLElement | null {
  const currentIdx = candidates.indexOf(current);
  if (currentIdx === -1) return candidates[0] || null;

  const currentZone = getLogicalZone(current);
  const currentRow = getLogicalRow(current);

  if (direction === 'right') {
    if (currentRow) {
      const rowItems = candidates.filter((c) => getLogicalRow(c) === currentRow);
      const idxInRow = rowItems.indexOf(current);
      if (idxInRow >= 0 && idxInRow < rowItems.length - 1) {
        return rowItems[idxInRow + 1];
      }
    }
    if (currentZone === 'sidebar') {
      const nonSidebar = candidates.find((c) => getLogicalZone(c) !== 'sidebar');
      if (nonSidebar) return nonSidebar;
    }
    if (currentZone === 'categories') {
      const nextZoneItem = candidates.find(
        (c) => getLogicalZone(c) !== 'sidebar' && getLogicalZone(c) !== 'categories'
      );
      if (nextZoneItem) return nextZoneItem;
    }
    return candidates[Math.min(candidates.length - 1, currentIdx + 1)];
  }

  if (direction === 'left') {
    if (currentRow) {
      const rowItems = candidates.filter((c) => getLogicalRow(c) === currentRow);
      const idxInRow = rowItems.indexOf(current);
      if (idxInRow > 0) {
        return rowItems[idxInRow - 1];
      }
    }
    if (currentZone !== 'sidebar') {
      const categoriesItem = candidates.find((c) => getLogicalZone(c) === 'categories');
      if (categoriesItem && currentZone !== 'categories') {
        return categoriesItem;
      }
      const sidebarItem = candidates.find((c) => getLogicalZone(c) === 'sidebar');
      if (sidebarItem) {
        return sidebarItem;
      }
    }
    return candidates[Math.max(0, currentIdx - 1)];
  }

  if (direction === 'down') {
    if (currentRow) {
      // Try moving to the next row or next element outside the current horizontal row
      for (let i = currentIdx + 1; i < candidates.length; i++) {
        if (getLogicalRow(candidates[i]) !== currentRow) {
          return candidates[i];
        }
      }
    }
    const zoneItems = candidates.filter((c) => getLogicalZone(c) === currentZone);
    const idxInZone = zoneItems.indexOf(current);
    if (idxInZone >= 0 && idxInZone < zoneItems.length - 1) {
      return zoneItems[idxInZone + 1];
    }
    return candidates[Math.min(candidates.length - 1, currentIdx + 1)];
  }

  if (direction === 'up') {
    if (currentRow) {
      for (let i = currentIdx - 1; i >= 0; i--) {
        if (getLogicalRow(candidates[i]) !== currentRow) {
          return candidates[i];
        }
      }
    }
    const zoneItems = candidates.filter((c) => getLogicalZone(c) === currentZone);
    const idxInZone = zoneItems.indexOf(current);
    if (idxInZone > 0) {
      return zoneItems[idxInZone - 1];
    }
    return candidates[Math.max(0, currentIdx - 1)];
  }

  return null;
}
