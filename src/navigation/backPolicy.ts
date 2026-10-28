import { useEffect, useRef } from 'react';

export interface BackHandlerEntry {
  id: string;
  priority: number;
  handler: () => boolean | void;
  order: number;
}

/**
 * Priority constants for the centralized Back policy:
 * - SUB_MODAL (100): Player settings/diagnostics, resume playback modal, search edit mode, error modals
 * - FULLSCREEN_PLAYER (90): Embedded fullscreen preview or standalone VideoPlayer
 * - DETAILS_MODAL (80): MovieDetails, SeriesDetails
 * - DRAWER_MENU (70): Mobile navigation drawer
 * - VIEW_INTERNAL (60): LiveTvView active channel / channel list -> categories
 * - SECTION_TO_HOME (50): Internal section (live, movies, series, favorites, config) -> inicio
 */
export const BACK_PRIORITY = {
  SUB_MODAL: 100,
  FULLSCREEN_PLAYER: 90,
  DETAILS_MODAL: 80,
  DRAWER_MENU: 70,
  VIEW_INTERNAL: 60,
  SECTION_TO_HOME: 50,
} as const;

let sequenceCounter = 0;
const handlers = new Map<string, BackHandlerEntry>();

export function registerBackHandler(
  id: string,
  priority: number,
  handler: () => boolean | void
): () => void {
  const entry: BackHandlerEntry = {
    id,
    priority,
    handler,
    order: ++sequenceCounter,
  };
  handlers.set(id, entry);

  return () => {
    const current = handlers.get(id);
    if (current === entry) {
      handlers.delete(id);
    }
  };
}

/**
 * Executes the highest-priority registered back handler.
 * Returns true if a handler consumed the back action, or false if at the root screen.
 * Note: Back NEVER logs out or clears credentials.
 */
export function executeBackAction(): boolean {
  if (handlers.size === 0) {
    return false;
  }

  const sorted = Array.from(handlers.values()).sort((a, b) => {
    if (b.priority !== a.priority) {
      return b.priority - a.priority;
    }
    return b.order - a.order;
  });

  for (const entry of sorted) {
    try {
      const result = entry.handler();
      if (result !== false) {
        return true;
      }
    } catch (err) {
      console.warn('Back handler error:', err);
    }
  }

  return false;
}

export function clearAllBackHandlersForTest(): void {
  handlers.clear();
}

export function useBackHandler(
  id: string,
  priority: number,
  handler: () => boolean | void,
  enabled: boolean = true
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    return registerBackHandler(id, priority, () => handlerRef.current());
  }, [id, priority, enabled]);
}
