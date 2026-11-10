import React, { useMemo, useState, useEffect } from 'react';
import { Play, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useXtreamCredentials } from '../context/XtreamContext';
import { XtreamService } from '../services/xtreamService';
import { MediaImage } from './MediaImage';
import { normalizeImageSource } from '../utils/mediaUtils';
import { getValidYear } from '../utils/catalogRanking';
import { computeHeroItemsFromList } from '../utils/catalogIndex';

interface HeroBannerProps {
  items: any[];
  onPlay: (item: any) => void;
  onInfo: (item: any) => void;
  isPaused?: boolean;
}

export const HeroBanner = React.memo(function HeroBanner({
  items,
  onPlay,
  onInfo,
  isPaused = false,
}: HeroBannerProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const { credentials } = useXtreamCredentials();
  const [activeDetails, setActiveDetails] = useState<any>(null);

  const heroItems = useMemo(() => {
    return computeHeroItemsFromList(items);
  }, [items]);

  useEffect(() => {
    setCurrentIndex(0);
  }, [heroItems]);

  useEffect(() => {
    if (heroItems.length <= 1 || isPaused) return;
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % heroItems.length);
    }, 8000);
    return () => clearInterval(timer);
  }, [heroItems.length, isPaused]);

  const currentItem = heroItems[currentIndex];

  useEffect(() => {
    if (!currentItem || !credentials || isPaused) return;
    
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
  }, [currentItem, credentials, isPaused]);

  if (heroItems.length === 0 || !currentItem) return null;

  const bgImage = currentItem.stream_icon || currentItem.cover || normalizeImageSource(currentItem.backdrop_path);

  return (
    <div className="nc-tv-hero relative w-full min-h-[60vh] md:min-h-[75vh] flex flex-col justify-end py-16 md:pt-32 md:pb-24 shrink-0 px-6 md:px-12 bg-nc-bg overflow-hidden">
      <AnimatePresence mode="popLayout">
        <motion.div
          key={currentItem.stream_id || currentItem.name}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.7 }}
          className="absolute inset-0 z-0"
        >
          <MediaImage
            src={bgImage}
            serverUrl={credentials?.serverUrl}
            alt={currentItem.name}
            itemId={currentItem.stream_id || currentItem.name}
            itemName={currentItem.name}
            priority={true}
            className="w-full h-full object-cover object-top opacity-80"
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
            <h1 className="nc-heading-hero nc-tv-hero-title font-bold text-white tracking-tight drop-shadow-lg break-words whitespace-normal text-wrap">
              {currentItem.name}
            </h1>
            
            <div className="flex flex-wrap items-center gap-3 nc-text-subtitle text-gray-300 mb-4 mt-3">
              {currentItem.rating && currentItem.rating !== "0" && (
                <span className="text-yellow-500 font-medium drop-shadow-md">
                  ★ {currentItem.rating}
                </span>
              )}
              {(activeDetails?.releasedate || getValidYear(currentItem) > 0) && (
                <span className="bg-white/10 px-2 py-0.5 rounded nc-text-meta text-white/90">
                  {activeDetails?.releasedate || getValidYear(currentItem) || ''}
                </span>
              )}
              {(activeDetails?.genre || currentItem.category_name) && (
                <span className="text-white/80 break-words">
                  {activeDetails?.genre || currentItem.category_name}
                </span>
              )}
            </div>

            <p className="nc-text-reading text-white/80 line-clamp-3 md:line-clamp-5 mb-6">
              {activeDetails?.plot || activeDetails?.overview || currentItem.plot || currentItem.overview || 'Carregando sinopse...'}
            </p>
          </motion.div>
        </AnimatePresence>

        <div data-nav-row="true" className="nc-action-group relative z-30 mt-6">
          <button
            type="button"
            onClick={() => onPlay(currentItem)}
            className="flex-1 sm:flex-none items-center justify-center flex gap-2 bg-nc-primary hover:bg-nc-primary-hover text-black px-5 sm:px-6 py-3 rounded-lg font-semibold transition-all active:scale-95 shadow-lg"
          >
            <Play className="w-5 h-5 fill-black shrink-0" />
            <span>Assistir</span>
          </button>
          <button 
             type="button"
             onClick={() => onInfo(currentItem)}
             className="flex-1 sm:flex-none items-center justify-center flex gap-2 bg-white/20 hover:bg-white/30 backdrop-blur-md text-white px-5 sm:px-6 py-3 rounded-lg font-semibold transition-all active:scale-95"
          >
            <Info className="w-5 h-5 shrink-0" />
            <span>Mais Info</span>
          </button>
        </div>
      </div>
    </div>
  );
});

