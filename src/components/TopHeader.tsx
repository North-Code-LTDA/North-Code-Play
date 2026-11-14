import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Search, User, Settings, LogOut, ChevronDown, X } from 'lucide-react';
import { Logo } from './Logo';
import {
  useNavigationMode,
  useBackHandler,
  BACK_PRIORITY,
  focusElementSafely,
  ensureElementScrolledIntoView,
} from '../navigation';

export type MainSectionId = 'inicio' | 'live' | 'movies' | 'series' | 'favorites' | 'config';
export type PrimaryNavSectionId = Exclude<MainSectionId, 'config'>;

export const TOP_HEADER_SECTIONS: ReadonlyArray<{
  id: PrimaryNavSectionId;
  label: string;
}> = [
  { id: 'inicio', label: 'Início' },
  { id: 'live', label: 'TV ao Vivo' },
  { id: 'movies', label: 'Filmes' },
  { id: 'series', label: 'Séries' },
  { id: 'favorites', label: 'Favoritos' },
];

export interface TopHeaderLayoutMetricsInput {
  viewportWidth: number;
  viewportHeight: number;
  uiScale?: number;
  displayMode?: 'default' | 'tv';
  activeSection?: MainSectionId;
  focusedSection?: PrimaryNavSectionId;
  isSearchOpen?: boolean;
  isAccountMenuOpen?: boolean;
}

export interface TopHeaderSectionButtonMetric {
  id: PrimaryNavSectionId;
  label: string;
  offsetLeft: number;
  width: number;
  leftInViewport: number;
  rightInViewport: number;
  isVisibleInStrip: boolean;
}

export interface TopHeaderLayoutMetrics {
  viewportWidth: number;
  viewportHeight: number;
  remPx: number;
  rowsCount: 1 | 2;
  headerHeightPx: number;
  pageScrollWidthPx: number;
  hasHorizontalPageOverflow: boolean;
  logoRect: { left: number; top: number; width: number; height: number; right: number; bottom: number };
  navStripRect: {
    left: number;
    top: number;
    width: number;
    height: number;
    right: number;
    bottom: number;
    centerX: number;
    scrollWidth: number;
    clientWidth: number;
    scrollLeft: number;
  };
  actionsRect: { left: number; top: number; width: number; height: number; right: number; bottom: number };
  accountMenuRect: {
    left: number;
    top: number;
    width: number;
    height: number;
    right: number;
    bottom: number;
  } | null;
  sectionButtons: TopHeaderSectionButtonMetric[];
}

export function computeTopHeaderLayoutMetrics({
  viewportWidth,
  viewportHeight,
  uiScale = 1,
  displayMode = 'default',
  activeSection = 'inicio',
  focusedSection,
  isSearchOpen = false,
  isAccountMenuOpen = false,
}: TopHeaderLayoutMetricsInput): TopHeaderLayoutMetrics {
  const effectiveScale = displayMode === 'tv' ? Math.max(0.5, Math.min(1.25, uiScale)) : 1;
  const remPx = 16 * effectiveScale;
  const isTwoRow = viewportWidth < 768;
  const rowsCount: 1 | 2 = isTwoRow ? 2 : 1;

  const padX = isTwoRow ? Math.round(0.875 * remPx) : Math.round(2 * remPx);
  const row1Height = Math.round(4.75 * remPx);
  const row2Height = isTwoRow ? Math.round(2.75 * remPx) : 0;
  const headerHeightPx = row1Height + row2Height;

  const pillWidths: Record<PrimaryNavSectionId, number> = {
    inicio: Math.round(4.6 * remPx),
    live: Math.round(6.6 * remPx),
    movies: Math.round(4.8 * remPx),
    series: Math.round(4.7 * remPx),
    favorites: Math.round(5.8 * remPx),
  };
  const pillGap = Math.round(0.375 * remPx);

  let totalNavContentWidth = 0;
  const rawOffsets: Array<{ id: PrimaryNavSectionId; label: string; offsetLeft: number; width: number }> = [];
  TOP_HEADER_SECTIONS.forEach((sec, idx) => {
    const w = pillWidths[sec.id];
    rawOffsets.push({
      id: sec.id,
      label: sec.label,
      offsetLeft: totalNavContentWidth,
      width: w,
    });
    totalNavContentWidth += w + (idx < TOP_HEADER_SECTIONS.length - 1 ? pillGap : 0);
  });

  const logoWidth = isTwoRow ? Math.round(10.5 * remPx) : Math.round(12.25 * remPx);
  const logoHeight = Math.round(2.5 * remPx);
  const logoTop = Math.round((row1Height - logoHeight) / 2);
  const logoRect = {
    left: padX,
    top: logoTop,
    width: logoWidth,
    height: logoHeight,
    right: padX + logoWidth,
    bottom: logoTop + logoHeight,
  };

  const searchWidth = isSearchOpen
    ? isTwoRow
      ? Math.min(Math.round(12.5 * remPx), Math.max(140, viewportWidth - padX * 2 - logoWidth - Math.round(4 * remPx)))
      : Math.round(17.5 * remPx)
    : Math.round(2.5 * remPx);
  const accountBtnWidth = Math.round(3.5 * remPx);
  const actionsGap = Math.round(0.625 * remPx);
  const actionsWidth = searchWidth + actionsGap + accountBtnWidth;
  const actionsHeight = Math.round(2.5 * remPx);
  const actionsLeft = Math.max(logoRect.right + 8, viewportWidth - padX - actionsWidth);
  const actionsTop = Math.round((row1Height - actionsHeight) / 2);
  const actionsRect = {
    left: actionsLeft,
    top: actionsTop,
    width: actionsWidth,
    height: actionsHeight,
    right: actionsLeft + actionsWidth,
    bottom: actionsTop + actionsHeight,
  };

  let navLeft: number;
  let navTop: number;
  let navClientWidth: number;
  const navHeight = Math.round(2.35 * remPx);

  if (isTwoRow) {
    navLeft = padX;
    navTop = row1Height + Math.round((row2Height - navHeight) / 2);
    navClientWidth = Math.max(120, viewportWidth - padX * 2);
  } else {
    const maxAvailableCenterWidth = Math.max(
      180,
      viewportWidth - Math.max(logoRect.right, viewportWidth - actionsRect.left) * 2 - Math.round(1.5 * remPx)
    );
    navClientWidth = Math.min(totalNavContentWidth, maxAvailableCenterWidth);
    navLeft = Math.round((viewportWidth - navClientWidth) / 2);
    navTop = Math.round((row1Height - navHeight) / 2);
  }

  const maxScrollLeft = Math.max(0, totalNavContentWidth - navClientWidth);
  const targetSectionToKeepVisible: PrimaryNavSectionId =
    focusedSection ?? (activeSection === 'config' ? 'inicio' : activeSection);
  const targetEntry = rawOffsets.find((item) => item.id === targetSectionToKeepVisible) ?? rawOffsets[0];

  let scrollLeft = 0;
  if (maxScrollLeft > 0 && targetEntry) {
    const padScroll = Math.min(12, Math.max(0, Math.floor((navClientWidth - targetEntry.width) / 2)));
    if (targetEntry.offsetLeft < scrollLeft + padScroll) {
      scrollLeft = Math.max(0, targetEntry.offsetLeft - padScroll);
    } else if (targetEntry.offsetLeft + targetEntry.width > scrollLeft + navClientWidth - padScroll) {
      scrollLeft = Math.min(
        maxScrollLeft,
        Math.max(0, targetEntry.offsetLeft + targetEntry.width - navClientWidth + padScroll)
      );
    }
  }

  const sectionButtons: TopHeaderSectionButtonMetric[] = rawOffsets.map((item) => {
    const leftInViewport = navLeft + item.offsetLeft - scrollLeft;
    const rightInViewport = leftInViewport + item.width;
    const isVisibleInStrip =
      leftInViewport >= navLeft - 1 && rightInViewport <= navLeft + navClientWidth + 1;
    return {
      id: item.id,
      label: item.label,
      offsetLeft: item.offsetLeft,
      width: item.width,
      leftInViewport,
      rightInViewport,
      isVisibleInStrip,
    };
  });

  const navStripRect = {
    left: navLeft,
    top: navTop,
    width: navClientWidth,
    height: navHeight,
    right: navLeft + navClientWidth,
    bottom: navTop + navHeight,
    centerX: navLeft + navClientWidth / 2,
    scrollWidth: totalNavContentWidth,
    clientWidth: navClientWidth,
    scrollLeft,
  };

  const menuWidth = Math.round(14 * remPx);
  const menuHeight = Math.round(8.75 * remPx);
  const accountMenuRect = isAccountMenuOpen
    ? {
        left: Math.max(8, actionsRect.right - menuWidth),
        top: actionsRect.bottom + 8,
        width: menuWidth,
        height: menuHeight,
        right: actionsRect.right,
        bottom: actionsRect.bottom + 8 + menuHeight,
      }
    : null;

  return {
    viewportWidth,
    viewportHeight,
    remPx,
    rowsCount,
    headerHeightPx,
    pageScrollWidthPx: viewportWidth,
    hasHorizontalPageOverflow: false,
    logoRect,
    navStripRect,
    actionsRect,
    accountMenuRect,
    sectionButtons,
  };
}

export interface TopHeaderProps {
  currentView: MainSectionId;
  onSelectSection: (section: PrimaryNavSectionId, meta?: { isPointerClick?: boolean }) => void;
  onSelectAccountAction: (action: 'account' | 'config' | 'logout') => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  isSearchOpen: boolean;
  onOpenSearch: () => void;
  onCloseSearch: () => void;
  isAccountMenuOpen: boolean;
  onToggleAccountMenu: () => void;
  onCloseAccountMenu: (restoreFocus?: boolean) => void;
  username?: string;
  inert?: boolean;
}

export const TopHeader = React.memo(function TopHeader({
  currentView,
  onSelectSection,
  onSelectAccountAction,
  searchQuery,
  onSearchQueryChange,
  isSearchOpen,
  onOpenSearch,
  onCloseSearch,
  isAccountMenuOpen,
  onToggleAccountMenu,
  onCloseAccountMenu,
  username,
  inert = false,
}: TopHeaderProps) {
  const navMode = useNavigationMode();
  const [isSearchEditing, setIsSearchEditing] = useState(false);

  const navStripRef = useRef<HTMLElement | null>(null);
  const searchTriggerRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const accountContainerRef = useRef<HTMLDivElement | null>(null);
  const accountTriggerRef = useRef<HTMLButtonElement | null>(null);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const prevSearchOpenRef = useRef(isSearchOpen);
  const prevAccountMenuOpenRef = useRef(isAccountMenuOpen);
  const shouldRestoreSearchFocusRef = useRef(false);
  const shouldRestoreAccountFocusRef = useRef(false);

  const scrollButtonIntoStrip = useCallback((btn: HTMLElement | null, direction?: 'left' | 'right') => {
    if (!btn) return;
    ensureElementScrolledIntoView(btn, direction);
    const strip = navStripRef.current;
    if (!strip) return;
    const stripRect = strip.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    if (stripRect.width > 0 && btnRect.width > 0) {
      const pad = Math.min(12, Math.max(0, Math.floor((stripRect.width - btnRect.width) / 2)));
      const maxScroll = Math.max(0, strip.scrollWidth - strip.clientWidth);
      if (btnRect.left < stripRect.left + pad) {
        strip.scrollLeft = Math.min(
          maxScroll,
          Math.max(0, strip.scrollLeft + (btnRect.left - stripRect.left) - pad)
        );
      } else if (btnRect.right > stripRect.right - pad) {
        strip.scrollLeft = Math.min(
          maxScroll,
          Math.max(0, strip.scrollLeft + (btnRect.right - stripRect.right) + pad)
        );
      }
    }
  }, []);

  // Keep the active section pill visible inside the horizontal strip when currentView changes
  useEffect(() => {
    const strip = navStripRef.current;
    if (!strip) return;
    const activeBtn = strip.querySelector<HTMLElement>('button[data-header-nav-active="true"]');
    if (activeBtn) {
      scrollButtonIntoStrip(activeBtn);
    }
  }, [currentView, scrollButtonIntoStrip]);

  // Focus and activate search input when opened via the search magnifier button;
  // restore focus to the search magnifier button when closed via close button or Voltar/Escape.
  useEffect(() => {
    if (isSearchOpen && !prevSearchOpenRef.current) {
      shouldRestoreSearchFocusRef.current = false;
      setIsSearchEditing(true);
      const input = searchInputRef.current;
      if (input) {
        focusElementSafely(input);
      }
    } else if (!isSearchOpen && prevSearchOpenRef.current) {
      setIsSearchEditing(false);
      if (shouldRestoreSearchFocusRef.current) {
        shouldRestoreSearchFocusRef.current = false;
        if (searchTriggerRef.current && document.body.contains(searchTriggerRef.current)) {
          focusElementSafely(searchTriggerRef.current);
        }
      }
    }
    prevSearchOpenRef.current = isSearchOpen;
  }, [isSearchOpen]);

  // Focus the first item ("Conta") when the account menu opens;
  // restore focus to the account trigger when closed via Voltar/Escape.
  useEffect(() => {
    if (isAccountMenuOpen && !prevAccountMenuOpenRef.current) {
      shouldRestoreAccountFocusRef.current = false;
      const menu = accountMenuRef.current;
      const firstAction = menu?.querySelector<HTMLElement>('button[data-account-action="account"]');
      if (firstAction) {
        focusElementSafely(firstAction);
      }
    } else if (!isAccountMenuOpen && prevAccountMenuOpenRef.current) {
      if (shouldRestoreAccountFocusRef.current) {
        shouldRestoreAccountFocusRef.current = false;
        if (accountTriggerRef.current && document.body.contains(accountTriggerRef.current)) {
          focusElementSafely(accountTriggerRef.current);
        }
      }
    }
    prevAccountMenuOpenRef.current = isAccountMenuOpen;
  }, [isAccountMenuOpen]);

  // Close the account menu when clicking/tapping outside
  useEffect(() => {
    if (!isAccountMenuOpen) return;
    const handleOutsidePointerDown = (e: PointerEvent | MouseEvent) => {
      const target = e.target as Node | null;
      if (
        target &&
        accountContainerRef.current &&
        !accountContainerRef.current.contains(target)
      ) {
        shouldRestoreAccountFocusRef.current = false;
        onCloseAccountMenu(false);
      }
    };
    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
    };
  }, [isAccountMenuOpen, onCloseAccountMenu]);

  const handleCloseSearchAndRestoreFocus = useCallback(() => {
    shouldRestoreSearchFocusRef.current = true;
    setIsSearchEditing(false);
    onSearchQueryChange('');
    onCloseSearch();
  }, [onCloseSearch, onSearchQueryChange]);

  const handleCloseAccountMenuAndRestoreFocus = useCallback(
    (restoreFocus = true) => {
      shouldRestoreAccountFocusRef.current = restoreFocus;
      onCloseAccountMenu(restoreFocus);
      if (restoreFocus && accountTriggerRef.current && document.body.contains(accountTriggerRef.current)) {
        focusElementSafely(accountTriggerRef.current);
      }
    },
    [onCloseAccountMenu]
  );

  // Back priority for Account Menu when open
  useBackHandler(
    'header-account-menu',
    BACK_PRIORITY.ACCOUNT_MENU,
    () => {
      if (!isAccountMenuOpen) return false;
      handleCloseAccountMenuAndRestoreFocus(true);
      return true;
    },
    isAccountMenuOpen
  );

  // Back priority for On-Demand Search when open
  useBackHandler(
    'header-search-open',
    BACK_PRIORITY.HEADER_SEARCH,
    () => {
      if (!isSearchOpen) return false;
      handleCloseSearchAndRestoreFocus();
      return true;
    },
    isSearchOpen
  );

  const handleAccountMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab') {
      const menu = accountMenuRef.current;
      if (!menu) return;
      const items: HTMLButtonElement[] = Array.from<HTMLButtonElement>(
        menu.querySelectorAll<HTMLButtonElement>('button[data-account-action]')
      );
      if (items.length === 0) return;
      const activeIdx = items.indexOf(document.activeElement as HTMLButtonElement);
      if (e.shiftKey && activeIdx <= 0) {
        e.preventDefault();
        focusElementSafely(items[items.length - 1]);
      } else if (!e.shiftKey && activeIdx === items.length - 1) {
        e.preventDefault();
        focusElementSafely(items[0]);
      }
    }
  };

  const avatarInitial = (username?.trim()?.[0] || 'N').toUpperCase();

  return (
    <header
      data-nav-zone="header"
      data-top-header="true"
      inert={inert ? true : undefined}
      className="nc-top-header shrink-0 z-40 bg-nc-bg/95 backdrop-blur-md border-b border-white/[0.08] w-full relative"
    >
      <div data-top-header-inner="true" className="nc-top-header-inner w-full">
        {/* Left: Brand Logo -> navigates to Início */}
        <div className="nc-top-header-brand flex items-center min-w-0 shrink-0">
          <button
            type="button"
            data-nav-item="true"
            data-header-logo="true"
            aria-label="North Code Play — Ir para o Início"
            onClick={(e) => onSelectSection('inicio', { isPointerClick: e.detail > 0 })}
            className="nc-top-header-logo-btn flex items-center rounded-xl py-1 px-1.5 text-left transition-opacity hover:opacity-90 shrink-0"
          >
            <Logo className="nc-top-header-logo" />
          </button>
        </div>

        {/* Center (Row 1 on md+, Row 2 with horizontal scroll on < md): 5 Sections */}
        <nav
          ref={navStripRef}
          aria-label="Navegação principal"
          data-nav-row="true"
          data-header-nav-strip="true"
          className="nc-top-header-nav flex items-center overflow-x-auto scrollbar-hide touch-pan-x min-w-0"
        >
          {TOP_HEADER_SECTIONS.map((section) => {
            const isActive = currentView === section.id;
            return (
              <button
                key={section.id}
                type="button"
                data-nav-item="true"
                data-header-nav-id={section.id}
                data-header-nav-active={isActive ? 'true' : 'false'}
                aria-current={isActive ? 'page' : undefined}
                onFocus={(e) => scrollButtonIntoStrip(e.currentTarget)}
                onClick={(e) => onSelectSection(section.id, { isPointerClick: e.detail > 0 })}
                className={`nc-top-header-pill shrink-0 whitespace-nowrap rounded-full transition-colors ${
                  isActive
                    ? 'nc-top-header-pill-active bg-[#262626] text-white font-semibold shadow-sm'
                    : 'text-gray-300 font-medium hover:text-white hover:bg-white/[0.06]'
                }`}
              >
                {section.label}
              </button>
            );
          })}
        </nav>

        {/* Right: On-Demand Search (Lupa) & Account Dropdown Trigger */}
        <div className="nc-top-header-actions flex items-center justify-end gap-2 sm:gap-2.5 min-w-0 shrink-0">
          {!isSearchOpen ? (
            <button
              ref={searchTriggerRef}
              type="button"
              data-nav-item="true"
              data-header-search-trigger="true"
              aria-label="Abrir busca"
              aria-expanded="false"
              onClick={onOpenSearch}
              className="nc-top-header-icon-btn flex items-center justify-center rounded-full text-gray-200 hover:text-white hover:bg-white/[0.08] transition-colors shrink-0"
            >
              <Search className="nc-top-header-icon" />
            </button>
          ) : (
            <div
              data-header-search-panel="true"
              className="nc-top-header-search-box flex items-center bg-[#141414]/95 border border-white/25 rounded-full px-3 py-1 gap-2 transition-all min-w-0"
            >
              <Search className="w-4 h-4 text-gray-300 shrink-0 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                readOnly={navMode === 'remote' && !isSearchEditing}
                data-header-search-input="true"
                data-search-editing={isSearchEditing ? 'true' : 'false'}
                placeholder="Pesquisar canais, filmes ou séries..."
                aria-label="Pesquisar canais, filmes ou séries"
                onClick={() => setIsSearchEditing(true)}
                onChange={(e) => onSearchQueryChange(e.target.value)}
                onBlur={() => setIsSearchEditing(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!isSearchEditing) {
                      setIsSearchEditing(true);
                    }
                  }
                }}
                className="nc-top-header-search-input bg-transparent text-white placeholder-gray-400 text-sm focus:outline-none min-w-0 flex-1"
              />
              <button
                type="button"
                data-nav-item="true"
                data-header-search-close="true"
                aria-label="Fechar busca"
                onClick={handleCloseSearchAndRestoreFocus}
                className="p-1 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Account Trigger & Anchored Floating Menu */}
          <div ref={accountContainerRef} className="relative shrink-0">
            <button
              ref={accountTriggerRef}
              type="button"
              data-nav-item="true"
              data-header-account-trigger="true"
              data-header-account-active={
                currentView === 'config' || isAccountMenuOpen ? 'true' : 'false'
              }
              aria-label="Menu da conta"
              aria-haspopup="menu"
              aria-expanded={isAccountMenuOpen ? 'true' : 'false'}
              onClick={onToggleAccountMenu}
              className={`nc-top-header-account-btn flex items-center gap-1.5 rounded-full p-1 pr-2 transition-colors ${
                currentView === 'config' || isAccountMenuOpen
                  ? 'bg-[#262626] text-white'
                  : 'text-gray-200 hover:text-white hover:bg-white/[0.08]'
              }`}
            >
              <span className="nc-top-header-avatar flex items-center justify-center rounded-md bg-gradient-to-br from-neutral-700 to-neutral-900 border border-white/15 text-white font-semibold text-xs uppercase select-none">
                {avatarInitial}
              </span>
              <ChevronDown
                className={`w-3.5 h-3.5 text-gray-300 transition-transform duration-150 ${
                  isAccountMenuOpen ? 'rotate-180 text-white' : ''
                }`}
              />
            </button>

            {isAccountMenuOpen && (
              <div
                ref={accountMenuRef}
                role="menu"
                aria-label="Opções da conta"
                data-header-account-menu="true"
                data-focus-scope="modal"
                data-nav-zone="modal"
                onKeyDown={handleAccountMenuKeyDown}
                className="nc-top-header-account-menu absolute right-0 top-full mt-2 w-56 rounded-xl bg-[#181818]/98 border border-white/12 shadow-2xl py-2 z-50 backdrop-blur-xl flex flex-col"
              >
                <button
                  type="button"
                  role="menuitem"
                  data-nav-item="true"
                  data-autofocus="true"
                  data-account-action="account"
                  onClick={() => onSelectAccountAction('account')}
                  className="nc-account-menu-item flex items-center gap-3 w-full px-4 py-2.5 text-left text-sm text-gray-200 hover:text-white hover:bg-white/[0.08] transition-colors"
                >
                  <User className="w-4 h-4 text-gray-400 shrink-0" />
                  <span>Conta</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-nav-item="true"
                  data-account-action="config"
                  onClick={() => onSelectAccountAction('config')}
                  className="nc-account-menu-item flex items-center gap-3 w-full px-4 py-2.5 text-left text-sm text-gray-200 hover:text-white hover:bg-white/[0.08] transition-colors"
                >
                  <Settings className="w-4 h-4 text-gray-400 shrink-0" />
                  <span>Configurações</span>
                </button>
                <div role="separator" className="my-1.5 border-t border-white/10" />
                <button
                  type="button"
                  role="menuitem"
                  data-nav-item="true"
                  data-account-action="logout"
                  onClick={() => onSelectAccountAction('logout')}
                  className="nc-account-menu-item flex items-center gap-3 w-full px-4 py-2.5 text-left text-sm text-gray-200 hover:text-white hover:bg-white/[0.08] transition-colors"
                >
                  <LogOut className="w-4 h-4 text-gray-400 shrink-0" />
                  <span>Sair</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
});
