import React, { useRef, useState, useCallback } from 'react';
import { BufferedTimeRange } from './types';

interface PlayerTimelineProps {
  currentTime: number;
  duration: number;
  bufferedRanges: BufferedTimeRange[];
  isLive: boolean;
  liveEdgeDistance?: number;
  isVisible?: boolean;
  onSeek: (time: number) => void;
  onUserInteraction?: () => void;
  formatTime: (seconds: number) => string;
}

export function PlayerTimeline({
  currentTime,
  duration,
  bufferedRanges,
  isLive,
  liveEdgeDistance = 0,
  isVisible = true,
  onSeek,
  onUserInteraction,
  formatTime,
}: PlayerTimelineProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverPosition, setHoverPosition] = useState<number>(0);
  const [isDragging, setIsDragging] = useState(false);

  const effectiveDuration = duration > 0 && isFinite(duration) ? duration : 0;
  const progressPercent = effectiveDuration > 0 ? Math.min(100, Math.max(0, (currentTime / effectiveDuration) * 100)) : 0;
  const canSeek = effectiveDuration > 0 && isVisible;

  const calculateTimeFromEvent = useCallback(
    (e: React.MouseEvent | MouseEvent | React.TouchEvent | TouchEvent | React.PointerEvent): number => {
      if (!barRef.current || effectiveDuration <= 0) return 0;
      const rect = barRef.current.getBoundingClientRect();
      const clientX = 'touches' in e && e.touches.length > 0 ? e.touches[0].clientX : (e as MouseEvent).clientX;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return ratio * effectiveDuration;
    },
    [effectiveDuration]
  );

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!barRef.current || effectiveDuration <= 0) return;
    const rect = barRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverPosition(ratio * 100);
    setHoverTime(ratio * effectiveDuration);
  };

  const handleMouseLeave = () => {
    if (!isDragging) {
      setHoverTime(null);
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (effectiveDuration <= 0) return;
    onUserInteraction?.();
    setIsDragging(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    const targetTime = calculateTimeFromEvent(e);
    onSeek(targetTime);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (isDragging && effectiveDuration > 0) {
      onUserInteraction?.();
      const targetTime = calculateTimeFromEvent(e);
      onSeek(targetTime);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (isDragging) {
      setIsDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  if (isLive && effectiveDuration <= 0) {
    // Live stream without a seekable window: subtle live pulse bar with identical h-4 container height
    return (
      <div
        className="relative w-full h-4 flex items-center group py-1"
        onClick={handleClick}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="w-full h-1 bg-white/20 rounded-full overflow-hidden">
          <div className="w-full h-full bg-nc-primary/50 animate-pulse rounded-full" />
        </div>
      </div>
    );
  }

  return (
    <div
      ref={barRef}
      data-nav-row="player-timeline"
      data-player-control="timeline"
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onFocus={() => onUserInteraction?.()}
      role="slider"
      aria-label="Linha do tempo"
      aria-valuenow={Math.floor(currentTime)}
      aria-valuemin={0}
      aria-valuemax={Math.floor(effectiveDuration)}
      aria-disabled={!canSeek}
      tabIndex={canSeek ? 0 : -1}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          e.stopPropagation();
          onUserInteraction?.();
          if (effectiveDuration > 0) {
            onSeek(Math.max(0, currentTime - 10));
          }
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          e.stopPropagation();
          onUserInteraction?.();
          if (effectiveDuration > 0) {
            onSeek(Math.min(effectiveDuration, currentTime + 10));
          }
        }
      }}
      className="relative w-full h-5 flex items-center cursor-pointer group py-1 px-1 select-none touch-none focus:outline-none rounded-lg"
    >
      {/* Background Track */}
      <div className="relative w-full h-1.5 group-hover:h-2 group-focus:h-2 bg-white/25 rounded-full transition-all duration-150 overflow-hidden">
        {/* Buffered Ranges */}
        {effectiveDuration > 0 &&
          bufferedRanges.map((range, idx) => {
            const startPct = Math.min(100, Math.max(0, (range.start / effectiveDuration) * 100));
            const endPct = Math.min(100, Math.max(0, (range.end / effectiveDuration) * 100));
            const widthPct = Math.max(0, endPct - startPct);
            return (
              <div
                key={idx}
                className="absolute top-0 bottom-0 bg-white/30 rounded-full"
                style={{ left: `${startPct}%`, width: `${widthPct}%` }}
              />
            );
          })}

        {/* Played Progress Bar */}
        <div
          className="absolute top-0 bottom-0 left-0 bg-nc-primary rounded-full transition-[width] duration-75"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Scrubber Thumb */}
      <div
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 bg-nc-primary rounded-full shadow-lg scale-0 group-hover:scale-100 group-focus:scale-100 transition-transform duration-150 pointer-events-none"
        style={{ left: `${progressPercent}%` }}
      />

      {/* Hover Time Tooltip */}
      {hoverTime !== null && effectiveDuration > 0 && (
        <div
          className="absolute bottom-6 -translate-x-1/2 px-2 py-1 bg-nc-bg-card/95 border border-nc-border rounded text-[11px] font-mono text-white pointer-events-none shadow-xl whitespace-nowrap z-30"
          style={{ left: `${hoverPosition}%` }}
        >
          {isLive ? `-${formatTime(Math.max(0, effectiveDuration - hoverTime))}` : formatTime(hoverTime)}
        </div>
      )}
    </div>
  );
}
