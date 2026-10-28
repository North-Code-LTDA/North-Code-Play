export type NavMode = 'pointer' | 'remote';
export type SpatialDirection = 'up' | 'down' | 'left' | 'right';

let currentNavMode: NavMode = 'pointer';
const modeListeners = new Set<(mode: NavMode) => void>();
const focusMemoryStack: HTMLElement[] = [];

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
    // Avoid pushing duplicate consecutive references of the exact same element
    if (focusMemoryStack[focusMemoryStack.length - 1] !== target) {
      focusMemoryStack.push(target);
    }
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

export function findScrollContainer(el: HTMLElement | null): HTMLElement | null {
  let curr = el?.parentElement || null;
  while (curr && curr !== document.body && curr !== document.documentElement) {
    if (curr.getAttribute('data-scroll-container') === 'true') {
      return curr;
    }
    const cls = typeof curr.className === 'string' ? curr.className : '';
    if (cls.includes('overflow-y-auto') || cls.includes('overflow-y-scroll')) {
      return curr;
    }
    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
      try {
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
    const rowRect = rowContainer.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    if (rowRect.width > 0 && elRect.width > 0) {
      const padX = 16;
      if (elRect.left < rowRect.left + padX) {
        rowContainer.scrollLeft = Math.max(
          0,
          rowContainer.scrollLeft + (elRect.left - rowRect.left) - padX
        );
      } else if (elRect.right > rowRect.right - padX) {
        rowContainer.scrollLeft = Math.max(
          0,
          rowContainer.scrollLeft + (elRect.right - rowRect.right) + padX
        );
      }
    }
  }

  // 2. Vertical scroll container
  const scrollContainer = findScrollContainer(el);
  if (scrollContainer) {
    const topAnchor = el.closest<HTMLElement>('[data-scroll-top-anchor="true"]');
    if (topAnchor && scrollContainer.contains(topAnchor)) {
      scrollContainer.scrollTop = 0;
      return;
    }

    const blockCandidate =
      el.closest<HTMLElement>('[data-scroll-block="true"]') ||
      el.closest<HTMLElement>('[data-nav-row="true"]') ||
      el;
    const targetBlock =
      blockCandidate && scrollContainer.contains(blockCandidate) && blockCandidate !== scrollContainer
        ? blockCandidate
        : el;

    const containerRect = scrollContainer.getBoundingClientRect();
    const blockRect = targetBlock.getBoundingClientRect();

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
      /(?:^|\s)opacity-0(?:\s|$)/.test(cls) ||
      (/(?:^|\s)hidden(?:\s|$)/.test(cls) &&
        !cls.includes('md:flex') &&
        !cls.includes('md:block') &&
        !cls.includes('sm:inline'))
    ) {
      return false;
    }

    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
      try {
        const style = window.getComputedStyle(curr);
        if (style.display === 'none' || style.visibility === 'hidden') {
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

function getLogicalGrid(el: HTMLElement): HTMLElement | null {
  return el.closest<HTMLElement>('[data-nav-grid="true"]');
}

interface ZoneBlock {
  type: 'row' | 'grid' | 'item';
  container: HTMLElement;
  items: HTMLElement[];
}

function buildZoneBlocks(zoneCandidates: HTMLElement[]): ZoneBlock[] {
  const blocks: ZoneBlock[] = [];

  for (const el of zoneCandidates) {
    const row = getLogicalRow(el);
    if (row) {
      const prev = blocks[blocks.length - 1];
      if (prev && prev.type === 'row' && prev.container === row) {
        prev.items.push(el);
      } else {
        blocks.push({ type: 'row', container: row, items: [el] });
      }
      continue;
    }

    const grid = getLogicalGrid(el);
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
  hasRealGeometry: boolean
): HTMLElement {
  if (block.items.length === 1) {
    return block.items[0];
  }

  // If moving into a horizontal row or group, prefer horizontally aligned item that is visible in the row
  if (hasRealGeometry) {
    const currRect = current.getBoundingClientRect();
    const cx = currRect.left + currRect.width / 2;

    let pool = block.items;
    if (block.type === 'row') {
      const rowRect = block.container.getBoundingClientRect();
      if (rowRect.width > 0) {
        const visibleInRow = block.items.filter((item) => {
          const r = item.getBoundingClientRect();
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
      const r = item.getBoundingClientRect();
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
  hasRealGeometry: boolean
): HTMLElement | null {
  const idx = gridItems.indexOf(current);
  if (idx === -1) return null;

  if (hasRealGeometry) {
    const currentRect = current.getBoundingClientRect();
    const cx = currentRect.left + currentRect.width / 2;
    const cy = currentRect.top + currentRect.height / 2;

    let best: HTMLElement | null = null;
    let bestScore = Infinity;

    for (const item of gridItems) {
      if (item === current) continue;
      const r = item.getBoundingClientRect();
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
  targetZone: string
): HTMLElement | null {
  const zoneItems = candidates.filter((c) => getLogicalZone(c) === targetZone);
  if (zoneItems.length === 0) return null;

  if (targetZone === 'categories') {
    const selectedChannel = zoneItems.find(
      (c) => c.getAttribute('data-live-channel-selected') === 'true'
    );
    if (selectedChannel) return selectedChannel;

    const selectedCat = zoneItems.find(
      (c) => c.getAttribute('data-category-selected') === 'true'
    );
    if (selectedCat) return selectedCat;
  }

  if (targetZone === 'sidebar') {
    const activeSidebar = zoneItems.find(
      (c) => c.getAttribute('data-sidebar-active') === 'true'
    );
    if (activeSidebar) return activeSidebar;
  }

  return zoneItems[0];
}

/**
 * Moves focus in the requested direction ('up' | 'down' | 'left' | 'right').
 * Follows visual/DOM zone structure so vertical navigation inside content scrolls through rows
 * and never jumps accidentally to the sidebar or search bar.
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
    const contentCandidates = candidates.filter((c) => getLogicalZone(c) === 'content');
    const first =
      candidates.find((c) => c.getAttribute('data-autofocus') === 'true') ||
      contentCandidates[0] ||
      candidates[0];
    focusElementSafely(first, direction);
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

  const currentZone = getLogicalZone(activeEl);
  const currentRow = getLogicalRow(activeEl);
  const currentGrid = getLogicalGrid(activeEl);
  const sameZoneCandidates = candidates.filter((c) => getLogicalZone(c) === currentZone);

  // ---------------------------------------------------------------------------
  // VERTICAL NAVIGATION ('up' | 'down')
  // ---------------------------------------------------------------------------
  if (direction === 'up' || direction === 'down') {
    const blocks = buildZoneBlocks(sameZoneCandidates);
    const bIdx = blocks.findIndex((b) => b.items.includes(activeEl));

    if (bIdx !== -1) {
      const currentBlock = blocks[bIdx];

      // 1. If inside a grid block, first try moving vertically within the grid
      if (currentBlock.type === 'grid') {
        const nextInGrid = findNextInGridBlock(activeEl, currentBlock.items, direction, hasRealGeometry);
        if (nextInGrid) {
          focusElementSafely(nextInGrid, direction);
          return nextInGrid;
        }
      }

      // 2. Move to the adjacent block within the SAME zone
      const targetBlockIdx = direction === 'down' ? bIdx + 1 : bIdx - 1;
      if (targetBlockIdx >= 0 && targetBlockIdx < blocks.length) {
        const targetBlock = blocks[targetBlockIdx];
        const nextEl = pickBestItemInBlock(activeEl, targetBlock, hasRealGeometry);
        focusElementSafely(nextEl, direction);
        return nextEl;
      }
    }

    // 3. At the vertical boundary of the current zone:
    if (direction === 'up') {
      // Ensure scroll container is fully scrolled to top (0) before leaving the zone
      const scrollContainer = findScrollContainer(activeEl);
      if (scrollContainer && scrollContainer.scrollTop > 0) {
        scrollContainer.scrollTop = 0;
        return activeEl;
      }

      // Deliberate transition to header (search input) ONLY when at the very top of content or categories
      if (currentZone === 'content' || currentZone === 'categories') {
        const headerTarget = pickPreferredZoneEntry(candidates, 'header');
        if (headerTarget) {
          focusElementSafely(headerTarget, direction);
          return headerTarget;
        }
      }

      return activeEl;
    }

    if (direction === 'down') {
      // From header (search input), move down into content (or categories if content is empty)
      if (currentZone === 'header') {
        const contentTarget = pickPreferredZoneEntry(candidates, 'content');
        if (contentTarget) {
          focusElementSafely(contentTarget, direction);
          return contentTarget;
        }
        const categoriesTarget = pickPreferredZoneEntry(candidates, 'categories');
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
    // 1. Inside an explicit horizontal row (data-nav-row / data-nav-group)
    if (currentRow) {
      const rowItems = candidates.filter((c) => getLogicalRow(c) === currentRow);
      const idxInRow = rowItems.indexOf(activeEl);

      if (direction === 'right') {
        if (idxInRow >= 0 && idxInRow < rowItems.length - 1) {
          const nextInRow = rowItems[idxInRow + 1];
          focusElementSafely(nextInRow, direction);
          return nextInRow;
        }
        // At right end of a row in categories (e.g. LiveTvView channel row fav button), allow moving right to content
        if (currentZone === 'categories') {
          const contentTarget = pickPreferredZoneEntry(candidates, 'content');
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
        // At left boundary of row (idxInRow === 0): deliberate zone transition
        if (currentZone === 'content') {
          const categoriesTarget = pickPreferredZoneEntry(candidates, 'categories');
          if (categoriesTarget) {
            focusElementSafely(categoriesTarget, direction);
            return categoriesTarget;
          }
          const sidebarTarget = pickPreferredZoneEntry(candidates, 'sidebar');
          if (sidebarTarget) {
            focusElementSafely(sidebarTarget, direction);
            return sidebarTarget;
          }
        } else if (currentZone === 'categories') {
          const sidebarTarget = pickPreferredZoneEntry(candidates, 'sidebar');
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
      const gridItems = sameZoneCandidates.filter((c) => getLogicalGrid(c) === currentGrid);
      const nextInGrid = findNextInGridBlock(activeEl, gridItems, direction, hasRealGeometry);
      if (nextInGrid) {
        focusElementSafely(nextInGrid, direction);
        return nextInGrid;
      }

      if (direction === 'left') {
        const categoriesTarget = pickPreferredZoneEntry(candidates, 'categories');
        if (categoriesTarget) {
          focusElementSafely(categoriesTarget, direction);
          return categoriesTarget;
        }
        const sidebarTarget = pickPreferredZoneEntry(candidates, 'sidebar');
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
        const categoriesTarget = pickPreferredZoneEntry(candidates, 'categories');
        if (categoriesTarget) {
          focusElementSafely(categoriesTarget, direction);
          return categoriesTarget;
        }
        const contentTarget = pickPreferredZoneEntry(candidates, 'content');
        if (contentTarget) {
          focusElementSafely(contentTarget, direction);
          return contentTarget;
        }
        const headerTarget = pickPreferredZoneEntry(candidates, 'header');
        if (headerTarget) {
          focusElementSafely(headerTarget, direction);
          return headerTarget;
        }
      } else if (currentZone === 'categories') {
        const contentTarget = pickPreferredZoneEntry(candidates, 'content');
        if (contentTarget) {
          focusElementSafely(contentTarget, direction);
          return contentTarget;
        }
      }
    }

    if (direction === 'left') {
      if (currentZone === 'content' || currentZone === 'header') {
        const categoriesTarget = pickPreferredZoneEntry(candidates, 'categories');
        if (categoriesTarget) {
          focusElementSafely(categoriesTarget, direction);
          return categoriesTarget;
        }
        const sidebarTarget = pickPreferredZoneEntry(candidates, 'sidebar');
        if (sidebarTarget) {
          focusElementSafely(sidebarTarget, direction);
          return sidebarTarget;
        }
      } else if (currentZone === 'categories') {
        const sidebarTarget = pickPreferredZoneEntry(candidates, 'sidebar');
        if (sidebarTarget) {
          focusElementSafely(sidebarTarget, direction);
          return sidebarTarget;
        }
      }
    }
  }

  return activeEl;
}
