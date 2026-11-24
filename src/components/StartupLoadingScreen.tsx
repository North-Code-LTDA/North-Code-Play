import React from 'react';

export interface StartupLoadingScreenProps {
  ariaLabel?: string;
  dataRouteLoading?: string;
  isInert?: boolean;
  showContinueAction?: boolean;
  onContinue?: () => void;
}

export function StartupLoadingScreen({
  ariaLabel = 'Carregando programação',
  dataRouteLoading,
  isInert = false,
  showContinueAction = false,
  onContinue,
}: StartupLoadingScreenProps) {
  return (
    <div
      role={isInert ? undefined : 'dialog'}
      aria-modal={isInert ? undefined : 'true'}
      aria-hidden={isInert ? 'true' : undefined}
      inert={isInert ? true : undefined}
      aria-label={ariaLabel}
      data-route-loading={dataRouteLoading}
      data-startup-loading-screen="true"
      className="fixed inset-0 z-[100] bg-nc-bg nc-safe-overlay flex items-center justify-center select-none"
    >
      <div role="status" aria-live="polite" className="flex items-center justify-center">
        <span
          aria-hidden="true"
          data-startup-spinner="true"
          className="block w-9 h-9 sm:w-10 sm:h-10 rounded-full border-[2.5px] border-white/15 border-t-white animate-spin motion-reduce:animate-none"
        />
        <span className="sr-only">{ariaLabel}</span>
      </div>

      {showContinueAction && onContinue && (
        <div className="absolute inset-x-0 bottom-[calc(2.25rem+var(--nc-safe-bottom,0px))] flex justify-center px-6">
          <button
            type="button"
            data-nav-item="true"
            data-continue-while-loading="true"
            onClick={onContinue}
            className="px-4 py-2 bg-white/[0.06] hover:bg-white/[0.12] text-white/80 hover:text-white border border-white/15 rounded-lg text-xs sm:text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/90 cursor-pointer"
          >
            Continuar enquanto carrega
          </button>
        </div>
      )}
    </div>
  );
}
