import React, { useMemo, useState, useEffect } from 'react';
import { Play, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface HeroBannerProps {
  items: any[];
  onPlay: (item: any) => void;
  onInfo: (item: any) => void;
}

export function HeroBanner({ items, onPlay, onInfo }: HeroBannerProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  const heroItems = useMemo(() => {
    if (!items || items.length === 0) return [];
    return items.filter(
      (item) => item.stream_icon || item.cover || item.backdrop_path
    ).slice(0, 10);
  }, [items]);

  useEffect(() => {
    if (heroItems.length <= 1) return;
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % heroItems.length);
    }, 8000);
    return () => clearInterval(timer);
  }, [heroItems.length]);

  if (heroItems.length === 0) return null;

  const currentItem = heroItems[currentIndex];
  if (!currentItem) return null;

  const bgImage = currentItem?.stream_icon || currentItem?.cover || currentItem?.backdrop_path;

  const ratingNum = Number(currentItem?.rating || 0);

  return (
    <div className="relative w-full min-h-[60vh] md:min-h-[75vh] flex flex-col justify-end py-16 md:pt-32 md:pb-24 shrink-0 px-6 md:px-12 bg-nc-bg overflow-hidden">
      <AnimatePresence mode="popLayout">
        <motion.div
          key={currentItem?.stream_id || currentItem?.name}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.7 }}
          className="absolute inset-0 z-0"
        >
          <img
            src={bgImage}
            alt={currentItem?.name}
            className="w-full h-full object-cover object-top opacity-80"
            onError={(e) => {
              (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?q=80&w=2070&auto=format&fit=crop';
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-nc-bg via-nc-bg/80 to-transparent" />
          <div className="absolute inset-0 md:bg-gradient-to-r md:from-nc-bg md:via-nc-bg/60 md:to-transparent" />
        </motion.div>
      </AnimatePresence>

      <div className="relative z-10 max-w-2xl w-full">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentItem?.stream_id || currentItem?.name}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.5 }}
          >
            <h1 className="text-4xl md:text-5xl lg:text-7xl font-bold text-white tracking-tight mb-4 drop-shadow-lg break-words whitespace-normal text-wrap">
              {currentItem?.name}
            </h1>
            {ratingNum > 0 && (
              <p className="text-yellow-500 font-medium mb-3 drop-shadow-md flex items-center gap-2">
                ⭐ {ratingNum.toFixed(1)} / 10
              </p>
            )}
            {(currentItem?.plot || currentItem?.overview) && (
              <p className="text-sm md:text-base text-gray-200 line-clamp-3 md:line-clamp-4 mb-6">
                {currentItem?.plot || currentItem?.overview}
              </p>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="flex items-center gap-4 relative z-30 mt-6">
          <button
            onClick={() => onPlay(currentItem)}
            className="flex-1 md:flex-none items-center justify-center flex gap-2 bg-nc-primary hover:bg-nc-primary-hover text-black px-6 py-3 rounded-lg font-semibold transition-all active:scale-95 shadow-lg"
          >
            <Play className="w-5 h-5 fill-black" />
            Assistir
          </button>
          <button 
             onClick={() => onInfo(currentItem)}
             className="flex-1 md:flex-none items-center justify-center flex gap-2 bg-white/20 hover:bg-white/30 backdrop-blur-md text-white px-6 py-3 rounded-lg font-semibold transition-all active:scale-95"
          >
            <Info className="w-5 h-5" />
            Mais Info
          </button>
        </div>
      </div>
    </div>
  );
}
