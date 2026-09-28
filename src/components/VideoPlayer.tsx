import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Hls from 'hls.js';
import Plyr from 'plyr';
import 'plyr/dist/plyr.css';
import muxjs from 'mux.js';
import { ArrowLeft, Loader2, SkipForward, SkipBack, RefreshCw, AlertCircle } from 'lucide-react';
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
  const [retryTrigger, setRetryTrigger] = useState(0);

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

  // Ensure streamUrl is strictly routed via same-origin HTTPS proxy (/api/media)
  // NEVER fallback silently to direct HTTP/HTTPS URLs.
  useEffect(() => {
    let isMounted = true;
    setError(null);
    setLoading(true);

    if (!streamUrl) {
      setResolvedStreamUrl('');
      setError('Nenhuma URL de transmissão informada.');
      setLoading(false);
      return;
    }

    // Directly uses /api/media proxy route
    if (streamUrl.startsWith('/api/media/')) {
      setResolvedStreamUrl(streamUrl);
      return;
    }

    // If a legacy direct URL with credentials was passed, convert it strictly via /api/media/ticket
    if (streamUrl.startsWith('http://') || streamUrl.startsWith('https://')) {
      try {
        const parsed = new URL(streamUrl);
        const segments = parsed.pathname.split('/').filter(Boolean);

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
            .then(async (res) => {
              if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.message || `Erro no servidor de mídia (${res.status})`);
              }
              return res.json();
            })
            .then(data => {
              if (isMounted) {
                if (data.streamUrl) {
                  setResolvedStreamUrl(data.streamUrl);
                } else {
                  setError('O servidor não forneceu uma rota de mídia segura válida.');
                  setLoading(false);
                }
              }
            })
            .catch((err: any) => {
              if (isMounted) {
                setError(err.message || 'Falha ao preparar a reprodução da mídia via HTTPS.');
                setLoading(false);
              }
            });
          return;
        }
      } catch (err: any) {
        if (isMounted) {
          setError('URL de mídia com formato inválido.');
          setLoading(false);
        }
        return;
      }
    }

    // If it's an unrecognized format without /api/media, do not allow silent HTTP fallback
    setError('A URL de reprodução precisa ser processada pela rota segura /api/media.');
    setLoading(false);

    return () => {
      isMounted = false;
    };
  }, [streamUrl, retryTrigger]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !resolvedStreamUrl) return;

    let hls: Hls | null = null;
    let plyr: Plyr | null = null;
    let recoveryAttempts = 0;
    const MAX_RECOVERIES = 3;
    
    setLoading(true);
    setError(null);

    const initPlyr = () => {
      if (plyr) return;
      try {
        plyr = new Plyr(video, {
          controls: [
            'play-large',
            'play',
            'progress',
            'current-time',
            'duration',
            'mute',
            'volume',
            'settings',
            'pip',
            'fullscreen'
          ],
          autoplay: true,
          hideControls: true,
          resetOnEnd: true,
          seekTime: 10,
          keyboard: { focused: true, global: true },
          tooltips: { controls: true, seek: true },
        });

        plyr.on('ready', () => {
          if (startAt && startAt > 0) {
            video.currentTime = startAt;
          }
          video.play().catch(() => {
            // Autoplay policy: can be resumed on click
          });
        });
      } catch (e) {
        // Fallback to standard HTML5 controls if Plyr initialization fails
        video.controls = true;
      }
    };

    const isHlsUrl = resolvedStreamUrl.includes('.m3u8') || resolvedStreamUrl.includes('/hls');

    if (isHlsUrl && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 60,
        maxBufferLength: 30,
        maxMaxBufferLength: 600,
        maxBufferSize: 60 * 1000 * 1000,
        // Forward credentials if needed
        xhrSetup: (xhr) => {
          xhr.withCredentials = false;
        }
      });

      hls.loadSource(resolvedStreamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false);
        initPlyr();
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          recoveryAttempts++;
          if (recoveryAttempts <= MAX_RECOVERIES) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                hls?.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls?.recoverMediaError();
                break;
              default:
                hls?.destroy();
                setError('Erro irrecuperável na transmissão do canal.');
                setLoading(false);
                break;
            }
          } else {
            // Stop infinite loop and present clear message
            hls?.destroy();
            setError('Não foi possível reproduzir a transmissão após múltiplas tentativas. Verifique a estabilidade da sua lista ou se o canal está offline no provedor.');
            setLoading(false);
          }
        }
      });
    } else if (isHlsUrl && video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native Apple HLS support (Safari iOS / macOS)
      video.src = resolvedStreamUrl;
      video.addEventListener('loadedmetadata', () => {
        setLoading(false);
        initPlyr();
      });
      video.addEventListener('error', () => {
        setError('Falha ao reproduzir fluxo HLS neste dispositivo.');
        setLoading(false);
      });
    } else {
      // Direct video file (MP4, WebM)
      video.src = resolvedStreamUrl;
      video.addEventListener('loadedmetadata', () => {
        setLoading(false);
        initPlyr();
      });
      video.addEventListener('canplay', () => {
        setLoading(false);
      });
      video.addEventListener('error', () => {
        setError('Falha ao carregar o arquivo de vídeo. O contêiner ou codec pode ser incompatível com o navegador.');
        setLoading(false);
      });
    }

    // Save playback progress for resume functionality
    const handleTimeUpdate = () => {
      if (video && video.currentTime > 5 && streamId) {
        localStorage.setItem('nc_progress_' + streamId, Math.floor(video.currentTime).toString());
        localStorage.setItem('nc_last_watched_' + streamId, Date.now().toString());
      }
    };

    video.addEventListener('timeupdate', handleTimeUpdate);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      if (hls) {
        hls.destroy();
      }
      if (plyr) {
        plyr.destroy();
      }
    };
  }, [resolvedStreamUrl, startAt, streamId, retryTrigger]);

  const handleBack = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    onBack();
  };

  const handleRetry = () => {
    setError(null);
    setLoading(true);
    setRetryTrigger((prev) => prev + 1);
  };

  const playerContent = (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseMove={handleMouseMove}
      className={`${embedded ? 'relative w-full aspect-video rounded-2xl overflow-hidden' : 'fixed inset-0 z-50 bg-black flex flex-col items-center justify-center'}`}
    >
      {/* Top Header Controls */}
      {!embedded && (
        <div className={`absolute top-0 left-0 right-0 p-6 z-20 flex items-center justify-between bg-gradient-to-b from-black/80 via-black/40 to-transparent transition-opacity duration-300 ${isIdle ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
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
          <p className="text-white text-lg font-medium">Carregando transmissão segura...</p>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-black p-6 text-center">
          <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mb-4">
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
          <p className="text-red-400 text-lg md:text-xl font-medium max-w-lg mb-4">{error}</p>
          <p className="text-gray-400 text-sm max-w-lg mb-6">
            Todas as transmissões são processadas pela mesma origem HTTPS (/api/media) para garantir compatibilidade no navegador e evitar bloqueios de conteúdo misto.
          </p>
          <div className="flex items-center gap-4">
            <button 
              onClick={handleRetry}
              className="px-6 py-3 bg-nc-primary hover:bg-nc-primary-hover text-black rounded-xl transition-colors font-semibold flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Tentar Novamente
            </button>
            <button 
              onClick={handleBack}
              className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-colors font-medium"
            >
              Voltar
            </button>
          </div>
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
