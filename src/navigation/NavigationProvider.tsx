import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  NavMode,
  getNavMode,
  setNavMode,
  subscribeNavMode,
  moveSpatialFocus,
  SpatialDirection,
} from './spatialNav';
import { executeBackAction, setCentralBackPolicyAttached } from './backPolicy';
import { attachCapacitorBackAdapter } from './capacitorBackAdapter';
import { attachTvEnvironmentMonitor } from '../platform/tvEnvironment';

interface NavigationContextValue {
  navMode: NavMode;
}

const NavigationContext = createContext<NavigationContextValue>({
  navMode: 'pointer',
});

export function useNavigationMode(): NavMode {
  return useContext(NavigationContext).navMode;
}

const ARROW_KEY_TO_DIRECTION: Record<string, SpatialDirection> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

function isEditableTextElement(el: HTMLElement | null): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type?.toLowerCase() || 'text';
    if (type === 'range' || type === 'button' || type === 'submit' || type === 'checkbox' || type === 'radio') {
      return false;
    }
    // Check if input is currently readOnly (e.g. search bar before pressing OK in remote mode)
    if ((el as HTMLInputElement).readOnly) {
      return false;
    }
    return true;
  }
  return false;
}

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const [navMode, setNavModeState] = useState<NavMode>(() => getNavMode());

  useEffect(() => {
    const detachTvMonitor = attachTvEnvironmentMonitor();
    const unsubscribeNav = subscribeNavMode((mode) => {
      setNavModeState(mode);
    });
    return () => {
      detachTvMonitor();
      unsubscribeNav();
    };
  }, []);

  useEffect(() => {
    setCentralBackPolicyAttached(true);
    const detachCapacitor = attachCapacitorBackAdapter();

    const handlePointerDown = () => {
      setNavMode('pointer');
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;

      const activeEl = document.activeElement as HTMLElement | null;
      const isEditingText = isEditableTextElement(activeEl);

      // 1. Back / Escape handling
      const isBackKey =
        e.key === 'Escape' ||
        e.key === 'GoBack' ||
        e.key === 'BrowserBack' ||
        (e.key === 'Backspace' && !isEditingText);

      if (isBackKey) {
        const handled = executeBackAction();
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }

      // 2. Arrow keys / D-pad handling
      const direction = ARROW_KEY_TO_DIRECTION[e.key];
      if (direction) {
        setNavMode('remote');

        // If user is on a range slider, allow left/right to adjust slider, up/down to navigate away
        if (
          activeEl &&
          (activeEl.getAttribute('role') === 'slider' ||
            (activeEl.tagName === 'INPUT' && (activeEl as HTMLInputElement).type === 'range'))
        ) {
          if (direction === 'left' || direction === 'right') {
            return;
          }
        }

        // If user is actively editing a text input:
        // Allow Left/Right inside the text input for caret movement; allow Up/Down to navigate between form fields
        if (isEditingText && activeEl) {
          if (direction === 'left' || direction === 'right') {
            return;
          }
        }

        // Check if an active VideoPlayer without focused controls should handle seek/volume in desktop mode
        const isBodyOrUnfocused =
          !activeEl || activeEl === document.body || activeEl === document.documentElement;
        const activePlayerExists = document.querySelector('[data-player-active-shortcuts="true"]');

        if (
          isBodyOrUnfocused &&
          activePlayerExists &&
          !document.querySelector('[data-focus-scope="modal"]:not([data-player-container="true"])')
        ) {
          // Let VideoPlayer's own shortcut handler process Arrow keys when no button/card is focused
          return;
        }

        e.preventDefault();
        moveSpatialFocus(direction);
        return;
      }

      // 3. OK / Enter activation for interactive elements (buttons, cards, episodes, readOnly search trigger)
      if (e.key === 'Enter' || e.key === 'NumpadEnter') {
        if (!activeEl || activeEl === document.body || activeEl === document.documentElement) return;

        setNavMode('remote');
        const tag = activeEl.tagName;

        // If user is actively editing a non-readOnly input/textarea/select, let native form behavior work
        if (
          (tag === 'INPUT' && !(activeEl as HTMLInputElement).readOnly) ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT'
        ) {
          return;
        }

        if (
          tag === 'BUTTON' ||
          tag === 'A' ||
          (tag === 'INPUT' && (activeEl as HTMLInputElement).readOnly) ||
          activeEl.getAttribute('role') === 'button' ||
          activeEl.getAttribute('data-nav-item') === 'true' ||
          activeEl.tabIndex >= 0
        ) {
          e.preventDefault();
          e.stopPropagation();
          activeEl.click();
        }
      }
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown, false);

    return () => {
      setCentralBackPolicyAttached(false);
      detachCapacitor();
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown, false);
    };
  }, []);

  return (
    <NavigationContext.Provider value={{ navMode }}>
      {children}
    </NavigationContext.Provider>
  );
}
