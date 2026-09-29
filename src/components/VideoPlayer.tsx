import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Hls from 'hls.js';
import Plyr from 'plyr';
import 'plyr/dist/plyr.css';
import muxjs from 'mux.js';
import { ArrowLeft, Loader2, SkipForward, SkipBack, RefreshCw, AlertCircle, Wrench, Copy, Check } from 'lucide-react';
import { motion } from 'motion/react';

if (typeof window !== 'undefined') {
  // @ts-ignore
  window.muxjs = muxjs;
}

export interface VideoPlayerProps {
  key?: React.Key;
  streamUrl?: string;
  title: string;
  onBack: () => void;
  embedded?: boolean;
  startAt?: number;
  streamId?: string | number;
  onNext?: () => void;
  onPrevious?: () => void;
  isLoading?: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
}

export function VideoPlayer({
  streamUrl = '',
  title,
  onBack,
  embedded = false,
  startAt,
  streamId,
  onNext,
  onPrevious,
  isLoading = false,
  errorMessage = null,
  onRetry,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const plyrRef = useRef<Plyr | null>(null);

  const [internalLoading, setInternalLoading] = useState(true);
  const [internalError, setInternalError] = useState<string | null>(null);
  const [isIdle, setIsIdle] = useState(false);
  const idleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [retryTrigger, setRetryTrigger] = useState(0);

  // Diagnostic state
  const [showDiagnosticModal, setShowDiagnosticModal] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [videoStats, setVideoStats] = useState<{
    width?: number;
    height?: number;
    duration?: number;
    currentTime?: number;
    networkState?: number;
    readyState?: number;
  }>({});

  const isPlayerLoading = isLoading || (internalLoading && !errorMessage && !internalError);
  const activeError = errorMessage || internalError;

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

  // Cleanup helper to thoroughly release video element, decoder, MediaSource, and origin sockets
  const cleanupMedia = () => {
    if (hlsRef.current) {
      try {
        hlsRef.current.stopLoad();
        hlsRef.current.detachMedia();
        hlsRef.current.destroy();
      } catch {
        // ignore
      }
      hlsRef.current = null;
    }

    if (plyrRef.current) {
      try {
        plyrRef.current.destroy();
      } catch {
        // ignore
      }
      plyrRef.current = null;
    }

    if (videoRef.current) {
      try {
        videoRef.current.pause();
        videoRef.current.removeAttribute('src');
        videoRef.current.load(); // Reset media element pipeline
      } catch {
        // ignore
      }
    }
  };

  // Direct playback setup on the <video> element
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) {
      cleanupMedia();
      setInternalLoading(false);
      return;
    }

    cleanupMedia();

    setInternalLoading(true);
    setInternalError(null);

    const initPlyrIfNeeded = () => {
      if (embedded) return;
      if (plyrRef.current) return;
      try {
        plyrRef.current = new Plyr(video, {
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
            'fullscreen',
          ],
          settings: ['quality', 'speed'],
          speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
          autoplay: true,
          hideControls: true,
          resetOnEnd: false,
          keyboard: { focused: true, global: true },
        });

        plyrRef.current.on('enterfullscreen', () => {
          if (videoRef.current) {
            // @ts-ignore
            if (videoRef.current.webkitEnterFullscreen) {
              // @ts-ignore
              videoRef.current.webkitEnterFullscreen();
            }
          }
        });
      } catch {
        // fallback to standard controls if Plyr fails
        video.controls = true;
      }
    };

    const isHls =
      streamUrl.includes('.m3u8') ||
      streamUrl.includes('/live/') ||
      streamUrl.toLowerCase().endsWith('.m3u8');

    let isHandled = false;

    // Direct HLS via Hls.js
    if (isHls && Hls.isSupported()) {
      isHandled = true;
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 60,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        xhrSetup: (xhr) => {
          // Direct browser request to provider
          xhr.withCredentials = false;
        },
      });
      hlsRef.current = hls;

      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setInternalLoading(false);
        setInternalError(null);
        initPlyrIfNeeded();
        video.play().catch(() => {});

        if (startAt && startAt > 0) {
          video.currentTime = startAt;
        }
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              setInternalError(
                'Falha de rede ou CORS ao carregar manifesto HLS diretamente do provedor. ' +
                  'Verifique se o provedor permite acesso cross-origin da sua rede.'
              );
              setInternalLoading(false);
              hls.destroy();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              setInternalError('Erro fatal na decodificação do fluxo HLS.');
              setInternalLoading(false);
              hls.destroy();
              break;
          }
        }
      });
    } else if (isHls && video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native Safari HLS
      isHandled = true;
      video.src = streamUrl;
      video.addEventListener('loadedmetadata', () => {
        setInternalLoading(false);
        initPlyrIfNeeded();
        video.play().catch(() => {});
        if (startAt && startAt > 0) {
          video.currentTime = startAt;
        }
      });
    }

    // Direct Progressive MP4 / WebM / container file
    if (!isHandled) {
      video.src = streamUrl;
      video.addEventListener('loadedmetadata', () => {
        setInternalLoading(false);
        setInternalError(null);
        initPlyrIfNeeded();
        video.play().catch(() => {});
        if (startAt && startAt > 0) {
          video.currentTime = startAt;
        }
      });
    }

    const onPlaying = () => {
      setInternalLoading(false);
      setInternalError(null);
    };

    const onWaiting = () => {
      setInternalLoading(true);
    };

    const onError = () => {
      const err = video.error;
      let msg = 'Falha ao reproduzir o vídeo diretamente do provedor.';
      if (err) {
        if (err.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
          msg =
            'Formato não suportado nativamente pelo navegador ou bloqueio de CORS / Mixed Content pelo provedor.';
        } else if (err.code === MediaError.MEDIA_ERR_NETWORK) {
          msg = 'Erro de rede ao conectar à transmissão do provedor.';
        } else if (err.code === MediaError.MEDIA_ERR_DECODE) {
          msg = 'Erro na decodificação do fluxo de vídeo.';
        }
      }
      setInternalError(msg);
      setInternalLoading(false);
    };

    const onTimeUpdate = () => {
      if (streamId && video.currentTime > 5) {
        localStorage.setItem(`nc_progress_${streamId}`, String(Math.floor(video.currentTime)));
      }
    };

    video.addEventListener('playing', onPlaying);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('error', onError);
    video.addEventListener('timeupdate', onTimeUpdate);

    return () => {
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('error', onError);
      video.removeEventListener('timeupdate', onTimeUpdate);
      cleanupMedia();
    };
  }, [streamUrl, retryTrigger, embedded]);

  const handleRetry = () => {
    if (onRetry) {
      onRetry();
    } else {
      setRetryTrigger((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    cleanupMedia();
    onBack();
  };

  const handleRunDiagnostic = () => {
    if (videoRef.current) {
      setVideoStats({
        width: videoRef.current.videoWidth,
        height: videoRef.current.videoHeight,
        duration: videoRef.current.duration,
        currentTime: videoRef.current.currentTime,
        networkState: videoRef.current.networkState,
        readyState: videoRef.current.readyState,
      });
    }
    setShowDiagnosticModal(true);
  };

  const copyDirectUrl = () => {
    if (streamUrl) {
      navigator.clipboard.writeText(streamUrl).then(() => {
        setCopiedUrl(true);
        setTimeout(() => setCopiedUrl(false), 2000);
      });
    }
  };

  const playerContent = (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseMove={handleMouseMove}
      className={`${
        embedded
          ? 'relative w-full aspect-video rounded-2xl overflow-hidden bg-black border border-nc-border/40 shadow-xl'
          : 'fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center'
      }`}
    >
      {/* Top Header Controls (Full-Screen Mode) */}
      {!embedded && (
        <div
          className={`absolute top-0 left-0 right-0 p-6 z-20 flex items-center justify-between bg-gradient-to-b from-black/80 via-black/40 to-transparent transition-opacity duration-300 ${
            isIdle ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}
        >
          <div className="flex items-center gap-4">
            <button
              onClick={handleBack}
              className="p-3 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-full text-white transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-6 h-6" />
            </button>
            <h2 className="text-white text-xl font-medium truncate drop-shadow-md">{title}</h2>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleRunDiagnostic();
              }}
              className="px-3.5 py-2 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-xl text-white transition-colors flex items-center gap-1.5 text-sm font-medium cursor-pointer"
              title="Diagnóstico de reprodução direta"
            >
              <Wrench className="w-4 h-4 text-nc-primary" />
              <span>Diagnóstico</span>
            </button>

            {onPrevious && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onPrevious();
                }}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-xl text-white transition-colors flex items-center gap-2 text-sm font-medium"
              >
                <SkipBack className="w-4 h-4" />
                Anterior
              </button>
            )}
            {onNext && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onNext();
                }}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-xl text-white transition-colors flex items-center gap-2 text-sm font-medium"
              >
                <SkipForward className="w-4 h-4" />
                Próximo
              </button>
            )}
          </div>
        </div>
      )}

      {/* Loading Overlay */}
      {isPlayerLoading && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/75 backdrop-blur-sm pointer-events-none">
          <Loader2 className="w-12 h-12 animate-spin text-nc-primary mb-3" />
          <p className="text-white text-sm font-medium tracking-wide">
            Carregando transmissão direta...
          </p>
        </div>
      )}

      {/* Error Overlay */}
      {activeError && !isPlayerLoading && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center p-6 bg-black/90 backdrop-blur-md text-center">
          <div className="w-14 h-14 rounded-full bg-red-500/20 flex items-center justify-center mb-4">
            <AlertCircle className="w-7 h-7 text-red-500" />
          </div>
          <h3 className="text-lg font-bold text-white mb-2">Erro de Reprodução Direta</h3>
          <p className="text-red-400 text-sm max-w-lg mb-6 leading-relaxed">{activeError}</p>

          <div className="flex flex-wrap gap-3 justify-center">
            <button
              onClick={handleRetry}
              className="px-5 py-2.5 bg-nc-primary text-black font-semibold rounded-xl transition-all hover:brightness-110 flex items-center gap-2 text-sm cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" /> Tentar Novamente
            </button>
            <button
              onClick={handleRunDiagnostic}
              className="px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white font-medium rounded-xl transition-colors border border-nc-border/40 flex items-center gap-2 text-sm cursor-pointer"
            >
              <Wrench className="w-4 h-4 text-nc-primary" /> Diagnóstico
            </button>
            {!embedded && (
              <button
                onClick={handleBack}
                className="px-5 py-2.5 bg-nc-bg-card hover:bg-nc-bg-input text-nc-text-secondary hover:text-white font-medium rounded-xl transition-colors border border-nc-border/50 text-sm cursor-pointer"
              >
                Voltar
              </button>
            )}
          </div>
        </div>
      )}

      {/* Direct Connection Diagnostic Modal */}
      {showDiagnosticModal && (
        <div className="absolute inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-nc-bg border border-nc-border rounded-2xl p-6 max-w-lg w-full shadow-2xl flex flex-col gap-4 text-left max-h-[90vh] overflow-y-auto custom-scrollbar">
            <div className="flex items-center justify-between border-b border-nc-border/50 pb-3">
              <div className="flex items-center gap-2">
                <Wrench className="w-5 h-5 text-nc-primary" />
                <h3 className="text-lg font-bold text-white">Diagnóstico de Reprodução Direta</h3>
              </div>
              <button
                onClick={() => setShowDiagnosticModal(false)}
                className="text-nc-text-secondary hover:text-white text-xl font-bold px-2 py-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs text-nc-text-secondary">
              <div>
                <span className="font-semibold text-white block mb-1">URL Direta da Transmissão:</span>
                <div className="flex items-center gap-2 bg-nc-bg-card p-2 rounded border border-nc-border/40 font-mono text-[11px] text-gray-300 break-all select-all">
                  <span className="flex-1">{streamUrl || 'Nenhuma URL ativa'}</span>
                  {streamUrl && (
                    <button
                      onClick={copyDirectUrl}
                      className="p-1.5 bg-white/10 hover:bg-white/20 rounded text-white shrink-0 cursor-pointer"
                      title="Copiar URL"
                    >
                      {copiedUrl ? (
                        <Check className="w-3.5 h-3.5 text-green-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="bg-nc-bg-card p-2.5 rounded border border-nc-border/40">
                  <span className="block text-gray-400">Motor de Vídeo:</span>
                  <span className="text-white font-medium">
                    {hlsRef.current ? 'HLS.js (MediaSource)' : 'HTML5 Nativo'}
                  </span>
                </div>
                <div className="bg-nc-bg-card p-2.5 rounded border border-nc-border/40">
                  <span className="block text-gray-400">Resolução Ativa:</span>
                  <span className="text-white font-medium">
                    {videoStats.width && videoStats.height
                      ? `${videoStats.width}x${videoStats.height}`
                      : 'Indisponível'}
                  </span>
                </div>
                <div className="bg-nc-bg-card p-2.5 rounded border border-nc-border/40">
                  <span className="block text-gray-400">ReadyState / Network:</span>
                  <span className="text-white font-medium">
                    {videoStats.readyState ?? '-'} / {videoStats.networkState ?? '-'}
                  </span>
                </div>
                <div className="bg-nc-bg-card p-2.5 rounded border border-nc-border/40">
                  <span className="block text-gray-400">Posição / Duração:</span>
                  <span className="text-white font-medium">
                    {Math.floor(videoStats.currentTime || 0)}s /{' '}
                    {videoStats.duration && isFinite(videoStats.duration)
                      ? `${Math.floor(videoStats.duration)}s`
                      : 'Ao vivo'}
                  </span>
                </div>
              </div>

              <div className="p-3 bg-nc-bg-card rounded-xl border border-nc-border/40 space-y-1.5">
                <span className="font-semibold text-white block">Informações de Conectividade:</span>
                <p className="leading-relaxed">
                  • <strong>Sem Proxy Intermediário:</strong> O navegador conecta-se diretamente ao IP ou domínio do provedor.
                </p>
                <p className="leading-relaxed">
                  • <strong>Políticas de Origem (CORS):</strong> Para transmissões HLS (.m3u8), o servidor do provedor precisa permitir cabeçalhos CORS (<code>Access-Control-Allow-Origin</code>).
                </p>
                <p className="leading-relaxed">
                  • <strong>Conteúdo Misto:</strong> Se o aplicativo estiver em HTTPS e o provedor em HTTP puro, navegadores modernos bloqueiam o fluxo. Recomenda-se hospedar o aplicativo em HTTP na VPS para provedores HTTP.
                </p>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowDiagnosticModal(false)}
                className="px-4 py-2 bg-nc-bg-card hover:bg-nc-bg-input text-white rounded-xl border border-nc-border/50 text-xs font-medium cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Video Container: clean HTML5 video in embedded mode; wrapped in Plyr in full mode */}
      <div
        className={`w-full h-full flex flex-col justify-center items-center bg-black ${
          activeError ? 'hidden' : 'flex'
        }`}
      >
        <video
          ref={videoRef}
          className="w-full h-full max-h-screen object-contain"
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          playsInline
          controls={embedded}
        />
      </div>
    </motion.div>
  );

  if (!embedded && typeof document !== 'undefined') {
    return createPortal(playerContent, document.body);
  }

  return playerContent;
}
