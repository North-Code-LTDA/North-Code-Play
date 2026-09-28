import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Hls from 'hls.js';
import Plyr from 'plyr';
import 'plyr/dist/plyr.css';
import muxjs from 'mux.js';
import { ArrowLeft, Loader2, SkipForward, SkipBack } from 'lucide-react';
import { motion } from 'motion/react';
import { normalizeServerUrl } from '../utils/mediaUtils';

if (typeof window !== 'undefined') {
  // @ts-ignore
  window.muxjs = muxjs;
}

interface VideoPlayerProps {
  streamUrl: string;
  title: string;
  onBack: () => void;
  embedded?: boolean;
  startAt?: number;
  streamId?: string | number;
  onNext?: () => void;
  onPrevious?: () => void;
}

export function VideoPlayer({ streamUrl, title, onBack, embedded = false, startAt, streamId, onNext, onPrevious }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isIdle, setIsIdle] = useState(false);
  const idleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [resolvedStreamUrl, setResolvedStreamUrl] = useState<string>('');

  const handleMouseMove = () => {
    setIsIdle(false);
    if (idleTimeoutRef.current) {
      clearTimeout(idleTimeoutRef.current);
    }
    idleTimeoutRef.current = setTimeout(() => {
      setIsIdle(true);
    }, 3000);
  };

  useEffect(() => {
    handleMouseMove();
    return () => {
      if (idleTimeoutRef.current) clearTimeout(idleTimeoutRef.current);
    };
  }, []);

  // Ensure streamUrl is routed via same-origin HTTPS proxy if it came as a direct legacy URL
  useEffect(() => {
    let isMounted = true;
    if (!streamUrl) {
      setResolvedStreamUrl('');
      return;
    }

    if (streamUrl.startsWith('/api/media/')) {
      setResolvedStreamUrl(streamUrl);
      return;
    }

    // If a legacy direct URL with credentials was passed, convert it via /api/media/ticket
    if (streamUrl.startsWith('http://') || streamUrl.startsWith('https://')) {
      try {
        const parsed = new URL(streamUrl);
        const segments = parsed.pathname.split('/').filter(Boolean);

        // Pattern: /live/user/pass/id.ext or /movie/user/pass/id.ext or /series/user/pass/id.ext
        // or /user/pass/id.ext
        let type: 'live' | 'movie' | 'series' = 'live';
        let username = '';
        let password = '';
        let file = '';

        if (segments.length >= 4 && ['live', 'movie', 'series'].includes(segments[0])) {
          type = segments[0] as any;
          username = segments[1];
          password = segments[2];
          file = segments[3];
        } else if (segments.length >= 3) {
          username = segments[0];
          password = segments[1];
          file = segments[2];
          if (file.endsWith('.mp4') || file.endsWith('.mkv')) {
            type = 'movie';
          }
        }

        const lastDot = file.lastIndexOf('.');
        const id = lastDot !== -1 ? file.slice(0, lastDot) : file;
        const ext = lastDot !== -1 ? file.slice(lastDot + 1) : (type === 'live' ? 'm3u8' : 'mp4');

        if (username && password && id) {
          const cleanServer = normalizeServerUrl(`${parsed.protocol}//${parsed.host}`);
          fetch('/api/media/ticket', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              serverUrl: cleanServer,
              username,
              password,
              type,
              streamId: id,
              ext,
            }),
          })
            .then(res => res.json())
            .then(data => {
              if (isMounted) {
                if (data.streamUrl) {
                  setResolvedStreamUrl(data.streamUrl);
                } else {
                  setResolvedStreamUrl(streamUrl);
                }
              }
            })
            .catch(() => {
              if (isMounted) setResolvedStreamUrl(streamUrl);
            });
          return;
        }
      } catch {
        // Use streamUrl as fallback
      }
    }

    setResolvedStreamUrl(streamUrl);
    return () => {
      isMounted = false;
    };
  }, [streamUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !resolvedStreamUrl) return;

    let hls: Hls | null = null;
    let plyr: Plyr | null = null;
    
    setLoading(true);
    setError(null);

    const onCanPlay = () => setLoading(false);
    const onErrorHandler = () => {
      setError('Erro ao carregar o vídeo. O formato pode não ser compatível com o navegador.');
      setLoading(false);
    };

    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('error', onErrorHandler);

    // Progress Tracking Logic
    const isLive = resolvedStreamUrl.includes('/live') || resolvedStreamUrl.includes('.m3u8') || resolvedStreamUrl.endsWith('.ts');
    const match = resolvedStreamUrl.match(/\/([^/]+)\.[a-zA-Z0-9]+(\?|$)/);
    const derivedStreamId = streamId || match?.[1] || title;
    const initialStartAt = startAt ?? (derivedStreamId ? (Number(localStorage.getItem('nc_progress_' + derivedStreamId)) || 0) : 0);

    const onTimeUpdate = () => {
      if (!isLive && derivedStreamId) {
        // Save progress every ~5 seconds
        if (Math.floor(video.currentTime) % 5 === 0 && video.currentTime > 0) {
          localStorage.setItem('nc_progress_' + derivedStreamId, video.currentTime.toString());
          localStorage.setItem('nc_last_watched_' + derivedStreamId, Date.now().toString());
        }
      }
    };
    video.addEventListener('timeupdate', onTimeUpdate);

    const onEnded = () => {
      if (onNext) {
        onNext();
      }
    };
    video.addEventListener('ended', onEnded);

    const checkAndStartProgress = () => {
       if (!isLive && initialStartAt !== undefined) {
         video.currentTime = initialStartAt;
       }
    };

    try {
      const defaultPlyrOptions: Plyr.Options = {
          controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'captions', 'settings', 'pip', 'airplay', 'fullscreen'],
          settings: ['captions', 'quality', 'speed'],
          autoplay: true
      };

      if (isLive) {
        if (Hls.isSupported()) {
          hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            maxBufferSize: 60 * 1000 * 1000,
            maxBufferLength: 60,
            liveSyncDurationCount: 3,
            liveMaxLatencyDurationCount: 10,
            startLevel: -1,
            fragLoadingTimeOut: 20000,
            manifestLoadingTimeOut: 20000,
          });

          hls.loadSource(resolvedStreamUrl);
          hls.attachMedia(video);

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            setLoading(false);
            checkAndStartProgress();
            const availableQualities = hls!.levels.map((l: any) => l.height);
            
            plyr = new Plyr(video, {
               ...defaultPlyrOptions,
               quality: {
                  default: availableQualities[0] || 0,
                  options: availableQualities,
                  forced: true,
                  onChange: (e: number) => {
                      hls!.levels.forEach((level: any, levelIndex: number) => {
                          if (level.height === e) {
                              hls!.currentLevel = levelIndex;
                          }
                      });
                  }
               }
            });
            
            video.play().catch(() => {});
          });

          let errorRecoveryAttempts = 0;
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) {
              if (errorRecoveryAttempts >= 3) {
                hls?.destroy();
                setError('Não foi possível carregar a transmissão. O servidor de origem pode estar offline ou o formato não é suportado.');
                setLoading(false);
                return;
              }
              switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                  errorRecoveryAttempts++;
                  hls?.startLoad();
                  break;
                case Hls.ErrorTypes.MEDIA_ERROR:
                  errorRecoveryAttempts++;
                  hls?.recoverMediaError();
                  break;
                default:
                  hls?.destroy();
                  setError('Erro fatal ao carregar a transmissão.');
                  setLoading(false);
                  break;
              }
            }
          });
        } else {
          // Native HLS fallback (Safari / iOS)
          video.src = resolvedStreamUrl;
          plyr = new Plyr(video, defaultPlyrOptions);
          video.addEventListener('loadedmetadata', () => {
            setLoading(false);
            checkAndStartProgress();
            video.play().catch(() => {});
          });
        }
      } else {
        // VOD (Movie / Series) - load directly into HTML5 <video> tag handled by Plyr
        video.src = resolvedStreamUrl;
        plyr = new Plyr(video, defaultPlyrOptions);
        video.addEventListener('loadedmetadata', () => {
          setLoading(false);
          checkAndStartProgress();
          video.play().catch(() => {});
        });
      }
    } catch (err: any) {
      setError("Erro ao inicializar o player: " + err.message);
    }

    return () => {
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('error', onErrorHandler);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('ended', onEnded);
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
      if (hls) {
        hls.destroy();
      }
      if (plyr) {
        plyr.destroy();
      }
    };
  }, [resolvedStreamUrl]);

  const handleBack = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    onBack();
  };

  const playerContent = (
    <motion.div 
      key={resolvedStreamUrl || title}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseMove={handleMouseMove}
      onTouchStart={handleMouseMove}
      className={embedded 
        ? `relative w-full aspect-video rounded-xl overflow-hidden shadow-lg bg-black flex flex-col items-center justify-center shrink-0 ${isIdle ? 'cursor-none' : 'cursor-auto'}` 
        : `fixed inset-0 z-[9999] bg-black flex flex-col items-center justify-center ${isIdle ? 'cursor-none' : 'cursor-auto'}`
      }
    >
      {/* Top Bar with Back Button Overlay */}
      {!embedded && (
        <div className={`absolute top-0 left-0 w-full p-6 bg-gradient-to-b from-black/80 to-transparent z-10 flex items-start justify-between gap-4 transition-opacity duration-300 ${isIdle ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
          <div className="flex items-center gap-4">
            <button 
              onClick={handleBack}
              className="p-3 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-full text-white transition-colors"
            >
              <ArrowLeft className="w-6 h-6" />
            </button>
            <h2 className="text-white text-xl font-medium truncate drop-shadow-md">{title}</h2>
          </div>
          
          <div className="flex items-center gap-2">
             {onPrevious && (
                <button 
                  onClick={(e) => { e.stopPropagation(); onPrevious(); }}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-xl text-white transition-colors flex items-center gap-2 text-sm font-medium"
                >
                  <SkipBack className="w-4 h-4" />
                  Anterior
                </button>
             )}
             {onNext && (
                <button 
                  onClick={(e) => { e.stopPropagation(); onNext(); }}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-xl text-white transition-colors flex items-center gap-2 text-sm font-medium"
                >
                  Próximo
                  <SkipForward className="w-4 h-4" />
                </button>
             )}
          </div>
        </div>
      )}

      {loading && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-black/60 backdrop-blur-sm">
          <Loader2 className="w-12 h-12 text-nc-primary animate-spin mb-4" />
          <p className="text-white text-lg font-medium">Carregando transmissão...</p>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-black p-6 text-center">
          <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mb-4">
            <ArrowLeft className="w-8 h-8 text-red-500" />
          </div>
          <p className="text-red-400 text-lg md:text-xl font-medium max-w-lg mb-4">{error}</p>
          <p className="text-gray-400 text-sm max-w-lg mb-6">
            Certifique-se de que o provedor oferece transmissões em formatos compatíveis com a Web (HLS .m3u8 para TV e MP4 para vídeos).
          </p>
          <button 
            onClick={handleBack}
            className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-colors font-medium"
          >
            Voltar para o menu
          </button>
        </div>
      )}

      {/* Video Container: crossOrigin removed for reliable native playback */}
      <div className={`w-full h-full flex flex-col justify-center bg-black ${error ? 'hidden' : 'flex'} plyr-wrapper-override`}>
         <video
           ref={videoRef}
           className="w-full h-full max-h-screen object-contain"
           style={{ width: '100%', height: '100%', objectFit: 'contain' }}
           playsInline
         />
      </div>
    </motion.div>
  );

  if (!embedded && typeof document !== 'undefined') {
    return createPortal(playerContent, document.body);
  }

  return playerContent;
}
