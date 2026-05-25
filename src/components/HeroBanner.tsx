import React, { useMemo, useState, useEffect } from 'react';
import { Play, Info } from 'lucide-react';
import { motion } from 'motion/react';

interface HeroBannerProps {
  items: any[];
  onPlay: (item: any) => void;
  onInfo: (item: any) => void;
}

export function HeroBanner({ items, onPlay, onInfo }: HeroBannerProps) {
  const [randomItem, setRandomItem] = useState<any | null>(null);

  useEffect(() => {
    if (items.length > 0 && !randomItem) {
      const validItems = items.filter(
        (item) => item.stream_icon || item.cover || item.backdrop_path
      );
      if (validItems.length > 0) {
        const randomIndex = Math.floor(Math.random() * validItems.length);
        setRandomItem(validItems[randomIndex]);
      }
    }
  }, [items, randomItem]);

  if (!randomItem) return null;

  const bgImage = randomItem.stream_icon || randomItem.cover;

  return (
    <div className="relative w-full min-h-[60vh] md:min-h-[75vh] flex flex-col justify-end py-16 md:pt-32 md:pb-24 shrink-0 px-6 md:px-12">
      <div className="absolute inset-0 z-0">
        <img
          src={bgImage}
          alt={randomItem.name}
          className="w-full h-full object-cover object-top opacity-80"
          onError={(e) => {
            (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?q=80&w=2070&auto=format&fit=crop';
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-nc-bg via-nc-bg/60 to-transparent" />
        <div className="absolute inset-0 md:bg-gradient-to-r md:from-nc-bg md:via-nc-bg/40 md:to-transparent" />
      </div>

      <div className="relative z-10 max-w-2xl w-full">
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-4xl md:text-5xl lg:text-7xl font-bold text-white tracking-tight mb-4 drop-shadow-lg break-words whitespace-normal text-wrap"
        >
          {randomItem.name}
        </motion.h1>
        {randomItem.rating && randomItem.rating !== "0" && (
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-yellow-500 font-medium mb-2 drop-shadow-md"
          >
            ★ {randomItem.rating}
          </motion.p>
        )}
        {randomItem.plot && (
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="text-white/80 line-clamp-3 md:line-clamp-5 mb-6"
          >
            {randomItem.plot}
          </motion.p>
        )}

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="flex items-center gap-4 relative z-30"
        >
          <button
            onClick={() => onPlay(randomItem)}
            className="flex-1 md:flex-none items-center justify-center flex gap-2 bg-nc-primary hover:bg-nc-primary-hover text-black px-6 py-3 rounded-lg font-semibold transition-all active:scale-95 shadow-lg"
          >
            <Play className="w-5 h-5 fill-black" />
            Assistir
          </button>
          <button 
             onClick={() => onInfo(randomItem)}
             className="flex-1 md:flex-none items-center justify-center flex gap-2 bg-white/20 hover:bg-white/30 backdrop-blur-md text-white px-6 py-3 rounded-lg font-semibold transition-all active:scale-95"
          >
            <Info className="w-5 h-5" />
            Mais Info
          </button>
        </motion.div>
      </div>
    </div>
  );
}
