import React, { useRef } from 'react';
import { motion } from 'motion/react';
import { Play, ChevronLeft, ChevronRight } from 'lucide-react';
import { buildDirectImageUrl, FALLBACK_IMAGE_DATA_URI } from '../utils/mediaUtils';

interface HorizontalRowProps {
  title: string;
  items: any[];
  type: 'live' | 'vod' | 'series';
  onItemClick: (item: any) => void;
}

export function HorizontalRow({ title, items, type, onItemClick }: HorizontalRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);

  if (items.length === 0) return null;

  const scrollByAmount = (amount: number) => {
    if (rowRef.current) {
      rowRef.current.scrollBy({ left: amount, behavior: 'smooth' });
    }
  };

  return (
    <div className="w-full group">
      <h2 className="text-xl md:text-2xl font-semibold text-white mb-4">{title}</h2>
      <div className="relative w-full">
        <button 
          onClick={() => scrollByAmount(-300)}
          className="absolute left-0 top-4 bottom-8 w-12 md:w-16 bg-gradient-to-r from-nc-bg via-nc-bg/80 to-transparent z-10 flex items-center justify-start pl-2 md:pl-4 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0"
        >
          <ChevronLeft className="w-8 h-8 text-white drop-shadow-md" />
        </button>

        <div 
          ref={rowRef}
          className="flex flex-row overflow-x-auto overflow-y-hidden scroll-smooth w-full gap-4 pb-8 pt-4 scrollbar-hide"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
        {items.map((item) => (
          <motion.div
            key={item.stream_id || item.series_id || item.id}
            onClick={() => onItemClick(item)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className={`shrink-0 snap-start select-none group cursor-pointer overflow-hidden rounded-xl bg-nc-bg-card border border-transparent hover:border-nc-primary/50 transition-all ${
              type === 'live' ? 'w-64 md:w-72 aspect-video' : 'w-36 md:w-44 aspect-[2/3]'
            }`}
          >
            <div className="relative w-full h-full">
              {item.stream_icon || item.cover ? (
                 <img 
                   src={buildDirectImageUrl(item.stream_icon || item.cover)} 
                   alt={item.name}
                   className={`w-full h-full transition-transform duration-300 group-hover:scale-105 ${type === 'live' ? 'object-contain p-2 bg-black/40' : 'object-cover'}`}
                   loading="lazy"
                   onError={(e) => {
                     (e.target as HTMLImageElement).src = FALLBACK_IMAGE_DATA_URI;
                   }}
                 />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-nc-bg-input">
                  <span className="text-xs text-nc-text-secondary text-center px-1">{item.name}</span>
                </div>
              )}
              
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                <p className="text-white font-medium text-sm truncate w-full">{item.name}</p>
                {type !== 'live' && item.rating && item.rating !== "0" && (
                   <p className="absolute top-2 right-2 text-xs text-yellow-500 bg-black/50 px-1 py-0.5 rounded">★ {item.rating}</p>
                )}
              </div>
            </div>
          </motion.div>
        ))}
        </div>
        
        <button 
          onClick={() => scrollByAmount(300)}
          className="absolute right-0 top-4 bottom-8 w-12 md:w-16 bg-gradient-to-l from-nc-bg via-nc-bg/80 to-transparent z-10 flex items-center justify-end pr-2 md:pr-4 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <ChevronRight className="w-8 h-8 text-white drop-shadow-md" />
        </button>
      </div>
    </div>
  );
}
