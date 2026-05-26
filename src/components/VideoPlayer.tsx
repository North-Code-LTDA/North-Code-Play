import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import Plyr from 'plyr';
import 'plyr/dist/plyr.css';
import muxjs from 'mux.js';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';

if (typeof window !== 'undefined') {
  // @ts-ignore
  window.muxjs = muxjs;
}

interface VideoPlayerProps {
  streamUrl: string;
  title: string;
  onBack: () => void;
  embedded?: boolean;
}

export function VideoPlayer({ streamUrl, title, onBack, embedded = false }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return;

    let hls: Hls | null = null;
    let plyr: Plyr | null = null;
    
    setLoading(true);
    setError(null);

    const onCanPlay = () => setLoading(false);
    const onErrorHandler = (e: any) => {
      console.error('Video error:', e);
      setError('Erro ao carregar o vídeo. O formato pode não ser suportado nivamente ou houve bloqueio de CORS.');
      setLoading(false);
    };

    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('error', onErrorHandler);

    try {
      // Direct Play: We use the streamUrl directly without proxies
      // Live vs VOD detection
      const isLive = streamUrl.includes('/live/') || streamUrl.includes('.m3u8') || streamUrl.endsWith('.ts');

      const defaultPlyrOptions: Plyr.Options = {
          controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'captions', 'settings', 'pip', 'airplay', 'fullscreen'],
          settings: ['captions', 'quality', 'speed'],
          autoplay: true
      };

      if (isLive) {
        // Force m3u8 extension for HLS playback Native vs Hls.js
        const finalUrl = streamUrl.endsWith('.ts') ? streamUrl.replace('.ts', '.m3u8') : streamUrl;

        console.log("Direct Play URL:", finalUrl);

        if (Hls.isSupported()) {
          hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            maxBufferSize: 60 * 1000 * 1000, // 60MB de buffer na memória RAM
            maxBufferLength: 60, // 60 segundos de vídeo carregados para frente
            liveSyncDurationCount: 3, // Tolerância de sincronia no ao vivo
            liveMaxLatencyDurationCount: 10, // Latência máxima antes de forçar o pulo
            startLevel: -1, // Deixa começar na melhor qualidade inicial viável
            fragLoadingTimeOut: 20000, // 20 segundos de paciência antes de dar erro de rede
            manifestLoadingTimeOut: 20000,
          });

          hls.loadSource(finalUrl);
          hls.attachMedia(video);

          hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
            setLoading(false);
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
            
            video.play().catch(console.error);
          });

          let errorRecoveryAttempts = 0;
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) {
              if (errorRecoveryAttempts >= 5) {
                hls?.destroy();
                setError('A transmissão falhou repetidas vezes e não pôde ser recuperada.');
                setLoading(false);
                return;
              }
              switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                  console.error('Erro de rede fatal. Tentando recuperar... ', errorRecoveryAttempts);
                  errorRecoveryAttempts++;
                  hls?.startLoad();
                  break;
                case Hls.ErrorTypes.MEDIA_ERROR:
                  console.error('Erro de mídia fatal. Tentando recuperar... ', errorRecoveryAttempts);
                  errorRecoveryAttempts++;
                  hls?.recoverMediaError();
                  break;
                default:
                  hls?.destroy();
                  setError('Erro fatal ao carregar a transmissão. O formato pode não ser suportado.');
                  setLoading(false);
                  break;
              }
            }
          });
        } else {
          // Native HLS fallback (Safari / Apple devices)
          video.src = finalUrl;
          plyr = new Plyr(video, defaultPlyrOptions);
          video.addEventListener('loadedmetadata', () => {
            setLoading(false);
            video.play().catch(console.error);
          });
        }
      } else {
        console.log("Direct Play VOD URL:", streamUrl);
        // It's VOD (Movie / Series) - load directly into the HTML5 <video> tag handled by Plyr
        video.src = streamUrl;
        plyr = new Plyr(video, defaultPlyrOptions);
        video.addEventListener('loadedmetadata', () => {
          setLoading(false);
          video.play().catch(console.error);
        });
      }
    } catch (err: any) {
      console.error("Player setup error:", err);
      setError("Erro ao inicializar o player: " + err.message);
    }

    return () => {
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('error', onErrorHandler);
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
  }, [streamUrl]);

  return (
    <motion.div 
      key={streamUrl}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={embedded 
        ? "relative w-full aspect-video rounded-xl overflow-hidden shadow-lg bg-black flex flex-col items-center justify-center shrink-0" 
        : "fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center"
      }
    >
      {/* Top Bar with Back Button Overlay */}
      {!embedded && (
        <div className="absolute top-0 left-0 w-full p-6 bg-gradient-to-b from-black/80 to-transparent z-10 flex items-start justify-between gap-4 transition-opacity duration-300">
          <div className="flex items-center gap-4">
            <button 
              onClick={onBack}
              className="p-3 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-full text-white transition-colors"
            >
              <ArrowLeft className="w-6 h-6" />
            </button>
            <h2 className="text-white text-xl font-medium truncate drop-shadow-md">{title}</h2>
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
            Se o vídeo não formatar ou tiver apenas áudio, certifique-se de que o formato seja compatível com seu dispositivo Web/Celular/TV.
          </p>
          <button 
            onClick={onBack}
            className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-colors font-medium"
          >
            Voltar para o menu
          </button>
        </div>
      )}

      {/* Wrapping the video in a full size container. Global CSS might also need .plyr { width: 100%; height: 100%; } */}
      <div className={`w-full h-full flex flex-col justify-center bg-black ${error ? 'hidden' : 'flex'} plyr-wrapper-override`}>
         <video
           ref={videoRef}
           className="w-full h-full max-h-screen object-contain"
           style={{ width: '100%', height: '100%', objectFit: 'contain' }}
           playsInline
           crossOrigin="anonymous"
         />
      </div>
    </motion.div>
  );
}
