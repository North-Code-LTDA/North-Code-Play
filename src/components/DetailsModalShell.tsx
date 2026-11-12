import React from 'react';
import { X } from 'lucide-react';
import { motion } from 'motion/react';

export interface DetailsModalShellProps {
  /** Unique ID for the dialog title element (aria-labelledby) */
  titleId: string;
  /** Type of media details modal ('movie' | 'series') */
  modalType?: 'movie' | 'series';
  /** Handler invoked when clicking the backdrop or the top-right close button */
  onClose: () => void;
  /** Ref to the internal primary scrollable container */
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  /** Top visual/hero header region rendered at the top of the scrollable modal */
  headerRegion?: React.ReactNode;
  /** Main body content rendered below the header region */
  children: React.ReactNode;
  /** Optional overlays rendered inside the modal scope (e.g., resume sub-modal, error alerts) */
  overlaySlot?: React.ReactNode;
  /** Optional custom aria-label for the close button (defaults to "Fechar") */
  closeButtonLabel?: string;
}

/**
 * Reusable Netflix-inspired centered modal shell for media details (MovieDetails, and future SeriesDetails).
 * Keeps the background view mounted and visible behind a dark backdrop (rgba(0, 0, 0, 0.75)),
 * isolates spatial D-Pad focus within data-focus-scope="modal", and provides a single primary
 * vertical scroll container (data-scroll-container="true").
 */
export const DetailsModalShell = React.memo(function DetailsModalShell({
  titleId,
  modalType = 'movie',
  onClose,
  scrollContainerRef,
  headerRegion,
  children,
  overlaySlot,
  closeButtonLabel = 'Fechar',
}: DetailsModalShellProps) {
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      data-focus-scope="modal"
      data-details-modal={modalType}
      data-details-backdrop="true"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={handleBackdropClick}
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.75)' }}
      className="fixed inset-0 z-[50] bg-nc-bg backdrop-blur-[2px] flex items-center justify-center p-0 sm:p-4 md:p-6 overflow-hidden select-none"
    >
      <div
        data-details-dialog="true"
        onClick={(e) => e.stopPropagation()}
        style={{ backgroundColor: '#181818' }}
        className="nc-tv-details-dialog relative w-full max-w-[880px] h-full sm:h-auto max-h-full sm:max-h-[calc(100vh-2.5rem)] md:max-h-[calc(100vh-3rem)] bg-[#181818] text-white rounded-none sm:rounded-2xl border-0 sm:border sm:border-white/10 shadow-[0_28px_90px_rgba(0,0,0,0.92)] flex flex-col overflow-hidden"
      >
        {overlaySlot}

        <div
          ref={scrollContainerRef}
          data-scroll-container="true"
          className="nc-tv-details-scroll relative flex-1 w-full h-full overflow-y-auto overflow-x-hidden"
        >
          {/* Top-right circular close button (first button in DOM order & top D-Pad anchor) */}
          <div
            data-nav-row="true"
            data-scroll-top-anchor="true"
            className=" sticky top-0 z-40 w-full h-0 flex justify-end pointer-events-none"
          >
            <div className="pt-3 pr-3 sm:pt-4 sm:pr-4 pointer-events-auto">
              <button
                type="button"
                aria-label={closeButtonLabel}
                data-details-close="true"
                data-scroll-top-anchor="true"
                onClick={onClose}
                className="nc-tv-details-close-btn w-10 h-10 rounded-full bg-[#181818]/85 hover:bg-[#2a2a2a] text-white border border-white/20 flex items-center justify-center transition-colors shadow-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {headerRegion}

          <div className="nc-tv-movie-details-body relative z-10 w-full">
            {children}
          </div>
        </div>
      </div>
    </motion.div>
  );
});
