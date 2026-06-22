import React, { useMemo, useState, useEffect } from 'react';
import { Play, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useXtreamContext } from '../context/XtreamContext';
import { XtreamService } from '../services/xtreamService';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';

interface HeroBannerProps {
  items: any[];
  onPlay: (item: any) => void;
  onInfo: (item: any) => void;
}

const getValidYear = (item: any) => {
  let yearStr = item.year || item.releasedate || '';
  if (!yearStr && item.name) {
    const match = item.name.match(/(19|20)\d{2}/);
    if (match) yearStr = match[0];
  }
  const year = parseInt(yearStr, 10);
  return year >= 1950 && year <= 2026 ? year : 0;
};

const getValidRating = (item: any) => parseFloat(item.rating) || 0;

export function HeroBanner({ items, onPlay, onInfo }: HeroBannerProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const { credentials } = useXtreamContext();
  const [activeDetails, setActiveDetails] = useState<any>(null);

  const heroItems = useMemo(() => {
    if (!items || items.length === 0) return [];
    
    const normalize = (name: string) => {
      if (!name) return '';
      return name
        .toLowerCase()
        .replace(/\b(dublado|legendado|dub|leg|4k|fhd|hd|dual|áudio|audio)\b/g, '')
        .replace(/[\[\]\(\)]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const sortedItems = [...items]
      .filter((item) => item.stream_icon || item.cover || item.backdrop_path)
      .sort((a, b) => {
        const yearA = getValidYear(a);
        const yearB = getValidYear(b);
        if (yearB !== yearA) return yearB - yearA;
        return getValidRating(b) - getValidRating(a);
      });

    const deduped: any[] = [];
    const seenNames = new Set<string>();

    for (const item of sortedItems) {
      const normalizedName = normalize(item.name);
      if (!seenNames.has(normalizedName)) {
        seenNames.add(normalizedName);
        deduped.push(item);
      }
      if (deduped.length === 30) break;
    }

    return deduped;
  }, [items]);

  useEffect(() => {
    if (heroItems.length <= 1) return;
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % heroItems.length);
    }, 8000);
    return () => clearInterval(timer);
  }, [heroItems.length]);

  const currentItem = heroItems[currentIndex];
  
  const { ref: playRef, focused: playFocused } = useFocusable({
    onEnterPress: () => onPlay(currentItem)
  });
  
  const { ref: infoRef, focused: infoFocused } = useFocusable({
    onEnterPress: () => onInfo(currentItem)
  });

  useEffect(() => {
    if (!currentItem || !credentials) return;
    
    let isMounted = true;
    setActiveDetails(null);

    const fetchDetails = async () => {
      try {
        const isMovie = currentItem.stream_type === 'movie' || (currentItem.stream_id && !currentItem.series_id);
        if (isMovie) {
          const res = await XtreamService.getVodInfo(credentials, currentItem.stream_id);
          if (isMounted && res?.info) {
            setActiveDetails(res.info);
          }
        } else {
          const res = await XtreamService.getSeriesInfo(credentials, currentItem.series_id || currentItem.stream_id || currentItem.id);
          if (isMounted && res?.info) {
            setActiveDetails(res.info);
          }
        }
      } catch (error) {
        console.warn('Failed to fetch details for hero item:', error);
      }
    };

    fetchDetails();

    return () => {
      isMounted = false;
    };
  }, [currentItem, credentials]);

  if (heroItems.length === 0 || !currentItem) return null;

  const bgImage = currentItem.stream_icon || currentItem.cover || currentItem.backdrop_path;

  return (
    <div className="relative w-full min-h-[60vh] md:min-h-[75vh] flex flex-col justify-end py-16 md:pt-32 md:pb-24 shrink-0 px-6 md:px-12 bg-nc-bg overflow-hidden">
      <AnimatePresence mode="popLayout">
        <motion.div
          key={currentItem.stream_id || currentItem.name}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.7 }}
          className="absolute inset-0 z-0"
        >
          <img
            src={bgImage}
            alt={currentItem.name}
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
            key={currentItem.stream_id || currentItem.name}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.5 }}
          >
            <h1 className="text-4xl md:text-5xl lg:text-7xl font-bold text-white tracking-tight drop-shadow-lg break-words whitespace-normal text-wrap">
              {currentItem.name}
            </h1>
            
            <div className="flex flex-wrap items-center gap-3 text-sm text-gray-300 mb-4 mt-3">
              {currentItem.rating && currentItem.rating !== "0" && (
                <span className="text-yellow-500 font-medium drop-shadow-md">
                  ★ {currentItem.rating}
                </span>
              )}
              {(activeDetails?.releasedate || getValidYear(currentItem) > 0) && (
                <span className="bg-white/10 px-2 py-0.5 rounded text-white/90">
                  {activeDetails?.releasedate || getValidYear(currentItem) || ''}
                </span>
              )}
              {(activeDetails?.genre || currentItem.category_name) && (
                <span className="text-white/80">
                  {activeDetails?.genre || currentItem.category_name}
                </span>
              )}
            </div>

            <p className="text-white/80 line-clamp-3 md:line-clamp-5 mb-6 text-sm md:text-base leading-relaxed">
              {activeDetails?.plot || activeDetails?.overview || currentItem.plot || currentItem.overview || 'Carregando sinopse...'}
            </p>
          </motion.div>
        </AnimatePresence>

        <div className="flex items-center gap-4 relative z-30 mt-6">
          <button
            ref={playRef as React.RefObject<HTMLButtonElement>}
            onClick={() => onPlay(currentItem)}
            className={`flex-1 md:flex-none items-center justify-center flex gap-2 bg-nc-primary hover:bg-nc-primary-hover text-black px-6 py-3 rounded-lg font-semibold transition-all active:scale-95 shadow-lg ${playFocused ? 'ring-4 ring-white scale-105' : ''}`}
          >
            <Play className="w-5 h-5 fill-black" />
            Assistir
          </button>
          <button 
            ref={infoRef as React.RefObject<HTMLButtonElement>}
             onClick={() => onInfo(currentItem)}
             className={`flex-1 md:flex-none items-center justify-center flex gap-2 bg-white/20 hover:bg-white/30 backdrop-blur-md text-white px-6 py-3 rounded-lg font-semibold transition-all active:scale-95 ${infoFocused ? 'ring-4 ring-white scale-105' : ''}`}
          >
            <Info className="w-5 h-5" />
            Mais Info
          </button>
        </div>
      </div>
    </div>
  );
}
