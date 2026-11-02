import React, { useRef, useState, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useXtreamContext } from '../context/XtreamContext';
import {
  MediaImage,
  observeContainerVisibility,
  VERTICAL_HOME_ROOT_MARGIN,
  HORIZONTAL_ROW_ROOT_MARGIN,
  INITIAL_VISIBLE_CARDS_PER_ROW,
} from './MediaImage';

interface HorizontalRowProps {
  title: string;
  items: any[];
  type: 'live' | 'vod' | 'series';
  onItemClick: (item: any) => void;
  rowIndex?: number;
  scrollContainer?: HTMLElement | null;
}

export const HorizontalRow = React.memo(function HorizontalRow({
  title,
  items,
  type,
  onItemClick,
  rowIndex = 0,
  scrollContainer = null,
}: HorizontalRowProps) {
  const rowWrapperRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const cardElementsRef = useRef<Map<number, HTMLElement>>(new Map());
  const { credentials } = useXtreamContext();

  const [isRowVerticallyVisible, setIsRowVerticallyVisible] = useState<boolean>(
    () => rowIndex === 0
  );
  const [horizontallyVisibleIndices, setHorizontallyVisibleIndices] = useState<Set<number>>(() => {
    const initial = new Set<number>();
    const initialLimit = Math.min(items.length, INITIAL_VISIBLE_CARDS_PER_ROW);
    for (let i = 0; i < initialLimit; i++) {
      initial.add(i);
    }
    return initial;
  });
  const [focusedCardIndex, setFocusedCardIndex] = useState<number | null>(null);

  const setCardElementRef = useCallback((idx: number, el: HTMLDivElement | null) => {
    if (el) {
      cardElementsRef.current.set(idx, el);
    } else {
      cardElementsRef.current.delete(idx);
    }
  }, []);

  // Observe row vertical visibility inside the Home internal scroll container
  useEffect(() => {
    const wrapperEl = rowWrapperRef.current;
    if (!wrapperEl || items.length === 0) return;

    const verticalRoot =
      scrollContainer ??
      (wrapperEl.closest('[data-scroll-container="true"]') as HTMLElement | null);

    return observeContainerVisibility({
      target: wrapperEl,
      root: verticalRoot,
      rootMargin: VERTICAL_HOME_ROOT_MARGIN,
      axis: 'vertical',
      index: rowIndex,
      onIntersectChange: (isVisible) => {
        setIsRowVerticallyVisible((prev) => (prev === isVisible ? prev : isVisible));
      },
    });
  }, [scrollContainer, rowIndex, items.length]);

  // Observe card horizontal visibility inside the row's horizontal scroll container
  useEffect(() => {
    const rowEl = rowRef.current;
    if (!rowEl || items.length === 0) return;

    const cleanups: Array<() => void> = [];
    for (let idx = 0; idx < items.length; idx++) {
      const cardEl = cardElementsRef.current.get(idx);
      if (!cardEl) continue;

      const unsubscribe = observeContainerVisibility({
        target: cardEl,
        root: rowEl,
        rootMargin: HORIZONTAL_ROW_ROOT_MARGIN,
        axis: 'horizontal',
        index: idx,
        onIntersectChange: (isVisible) => {
          setHorizontallyVisibleIndices((prev) => {
            const alreadyVisible = prev.has(idx);
            if (isVisible === alreadyVisible) return prev;
            const next = new Set(prev);
            if (isVisible) {
              next.add(idx);
            } else {
              next.delete(idx);
            }
            return next;
          });
        },
      });
      cleanups.push(unsubscribe);
    }

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }, [items]);

  // Also catch native focusin events on the row container so programmatic/D-pad focus immediately activates the card image
  useEffect(() => {
    const rowEl = rowRef.current;
    if (!rowEl) return;

    const handleFocusIn = (e: Event) => {
      const target = e.target as HTMLElement | null;
      const cardEl = target?.closest('[data-row-card-index]') as HTMLElement | null;
      if (!cardEl) return;
      const rawIdx = cardEl.getAttribute('data-row-card-index');
      if (rawIdx !== null) {
        const parsedIdx = Number(rawIdx);
        if (Number.isFinite(parsedIdx)) {
          setFocusedCardIndex(parsedIdx);
        }
      }
    };

    rowEl.addEventListener('focusin', handleFocusIn);
    return () => {
      rowEl.removeEventListener('focusin', handleFocusIn);
    };
  }, [items.length]);

  if (items.length === 0) return null;

  const scrollByAmount = (amount: number) => {
    if (rowRef.current) {
      if (typeof rowRef.current.scrollBy === 'function') {
        rowRef.current.scrollBy({ left: amount, behavior: 'smooth' });
      } else {
        rowRef.current.scrollLeft = Math.max(0, (rowRef.current.scrollLeft || 0) + amount);
        rowRef.current.dispatchEvent(new Event('scroll'));
      }
    }
  };

  return (
    <div
      ref={rowWrapperRef}
      data-home-row-index={rowIndex}
      className="w-full group"
    >
      <h2 className="text-xl md:text-2xl font-semibold text-white mb-4">{title}</h2>
      <div className="relative w-full">
        <button 
          type="button"
          tabIndex={-1}
          onClick={() => scrollByAmount(-300)}
          className="absolute left-0 top-4 bottom-8 w-12 md:w-16 bg-gradient-to-r from-nc-bg via-nc-bg/80 to-transparent z-10 flex items-center justify-start pl-2 md:pl-4 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0"
        >
          <ChevronLeft className="w-8 h-8 text-white drop-shadow-md" />
        </button>

        <div 
          ref={rowRef}
          data-nav-row="true"
          className="flex flex-row overflow-x-auto overflow-y-hidden scroll-smooth w-full gap-4 pb-8 pt-4 scrollbar-hide"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
        {items.map((item, idx) => {
          const isCardAuthorized =
            (isRowVerticallyVisible && horizontallyVisibleIndices.has(idx)) ||
            focusedCardIndex === idx;

          return (
            <motion.div
              key={item.rowKey || item.stream_id || item.series_id || item.id}
              ref={(el) => setCardElementRef(idx, el)}
              tabIndex={0}
              role="button"
              data-nav-item="true"
              data-row-card-index={idx}
              aria-label={item.name}
              onClick={() => onItemClick(item)}
              onFocus={() => setFocusedCardIndex(idx)}
              onBlur={() => setFocusedCardIndex((prev) => (prev === idx ? null : prev))}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className={`shrink-0 snap-start select-none group cursor-pointer overflow-hidden rounded-xl bg-nc-bg-card border border-transparent hover:border-nc-primary/50 transition-all ${
                type === 'live'
                  ? 'nc-tv-row-card-live w-64 md:w-72 aspect-video'
                  : 'nc-tv-row-card-poster w-36 md:w-44 aspect-[2/3]'
              }`}
            >
              <div className="relative w-full h-full">
                <MediaImage
                  src={item.stream_icon || item.cover}
                  serverUrl={credentials?.serverUrl}
                  alt={item.name}
                  itemId={item.stream_id || item.series_id || item.id}
                  itemName={item.name}
                  active={isCardAuthorized}
                  priority={false}
                  loading="lazy"
                  decoding="async"
                  className={`w-full h-full transition-transform duration-300 group-hover:scale-105 ${type === 'live' ? 'object-contain p-2 bg-black/40' : 'object-cover'}`}
                />
                
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity flex items-end p-4">
                  <p className="text-white font-medium text-sm truncate w-full">{item.name}</p>
                  {type !== 'live' && item.rating && item.rating !== "0" && (
                     <p className="absolute top-2 right-2 text-xs text-yellow-500 bg-black/50 px-1 py-0.5 rounded">★ {item.rating}</p>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
        </div>
        
        <button 
          type="button"
          tabIndex={-1}
          onClick={() => scrollByAmount(300)}
          className="absolute right-0 top-4 bottom-8 w-12 md:w-16 bg-gradient-to-l from-nc-bg via-nc-bg/80 to-transparent z-10 flex items-center justify-end pr-2 md:pr-4 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <ChevronRight className="w-8 h-8 text-white drop-shadow-md" />
        </button>
      </div>
    </div>
  );
});


