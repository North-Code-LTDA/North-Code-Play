import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Hls from 'hls.js';
import Plyr from 'plyr';
import 'plyr/dist/plyr.css';
import muxjs from 'mux.js';
import { ArrowLeft, Loader2, SkipForward, SkipBack, RefreshCw, AlertCircle, Wrench, CheckCircle2 } from 'lucide-react';
import { motion } from 'motion/react';
import { normalizeServerUrl } from '../utils/mediaUtils';

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
  const [resolvedStreamUrl, setResolvedStreamUrl] = useState<string>('');
  const [retryTrigger, setRetryTrigger] = useState(0);

  // Diagnostic state
  const [diagnosticLoading, setDiagnosticLoading] = useState(false);
  const [diagnosticReport, setDiagnosticReport] = useState<any | null>(null);
  const [showDiagnosticModal, setShowDiagnosticModal] = useState(false);

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
      } catch (e) {
        // ignore
      }
      hlsRef.current = null;
    }

    if (plyrRef.current) {
      try {
        plyrRef.current.destroy();
      } catch (e) {
        // ignore
      }
      plyrRef.current = null;
    }

    if (videoRef.current) {
      try {
        videoRef.current.pause();
        videoRef.current.removeAttribute('src');
        videoRef.current.load(); // Reset media element pipeline
      } catch (e) {
        // ignore
      }
    }
  };

  // 1. Resolve stream URL via /api/media
  useEffect(() => {
    let isMounted = true;
    setInternalError(null);
    setInternalLoading(true);

    if (!streamUrl) {
      setResolvedStreamUrl('');
      // If external loading is happening, don't set error yet
      if (!isLoading) {
        setInternalLoading(false);
      }
      return;
    }

    // Directly uses /api/media proxy route
    if (streamUrl.startsWith('/api/media/')) {
      setResolvedStreamUrl(streamUrl);
      return;
    }

    // Convert legacy raw URL via /api/media/ticket
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
            .then((data) => {
              if (isMounted) {
                if (data.streamUrl) {
                  setResolvedStreamUrl(data.streamUrl);
                } else {
                  setInternalError('O servidor não forneceu uma rota de mídia segura válida.');
                  setInternalLoading(false);
                }
              }
            })
            .catch((err: any) => {
              if (isMounted) {
                setInternalError(err.message || 'Falha ao preparar a reprodução da mídia via HTTPS.');
                setInternalLoading(false);
              }
            });
          return;
        }
      } catch (err: any) {
        if (isMounted) {
          setInternalError('URL de mídia com formato inválido.');
          setInternalLoading(false);
        }
        return;
      }
    }

    setInternalError('A URL de reprodução precisa ser processada pela rota segura /api/media.');
    setInternalLoading(false);

    return () => {
      isMounted = false;
    };
  }, [streamUrl, retryTrigger, isLoading]);

  // 2. Attach media to <video> when resolvedStreamUrl is available
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !resolvedStreamUrl) {
      cleanupMedia();
      return;
    }

    cleanupMedia();

    let recoveryAttempts = 0;
    const MAX_RECOVERIES = 3;

    setInternalLoading(true);
    setInternalError(null);

    // Initialize Plyr only when not embedded to avoid DOM disruption in live channel switching
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
          autoplay: true,
          hideControls: true,
          resetOnEnd: true,
          seekTime: 10,
          keyboard: { focused: true, global: true },
          tooltips: { controls: true, seek: true },
        });

        plyrRef.current.on('ready', () => {
          if (startAt && startAt > 0) {
            video.currentTime = startAt;
          }
          video.play().catch(() => {});
        });
      } catch {
        video.controls = true;
      }
    };

    const isHlsUrl = resolvedStreamUrl.includes('.m3u8') || resolvedStreamUrl.includes('/hls');

    if (isHlsUrl && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 60,
        maxBufferLength: 30,
        maxMaxBufferLength: 600,
        maxBufferSize: 60 * 1000 * 1000,
        xhrSetup: (xhr) => {
          xhr.withCredentials = false;
        },
      });

      hlsRef.current = hls;

      hls.loadSource(resolvedStreamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setInternalLoading(false);
        initPlyrIfNeeded();
        if (embedded) {
          video.play().catch(() => {});
        }
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          recoveryAttempts++;
          if (recoveryAttempts <= MAX_RECOVERIES) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError();
                break;
              default:
                cleanupMedia();
                setInternalError('Erro irrecuperável na transmissão do canal.');
                setInternalLoading(false);
                break;
            }
          } else {
            cleanupMedia();
            setInternalError(
              'Não foi possível reproduzir a transmissão após múltiplas tentativas. O canal pode estar offline no provedor.'
            );
            setInternalLoading(false);
          }
        }
      });
    } else if (isHlsUrl && video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native Apple HLS (Safari)
      video.src = resolvedStreamUrl;
      const onLoadedMetadata = () => {
        setInternalLoading(false);
        initPlyrIfNeeded();
        if (embedded) {
          video.play().catch(() => {});
        }
      };
      const onError = () => {
        setInternalError('Falha ao reproduzir fluxo HLS neste dispositivo.');
        setInternalLoading(false);
      };

      video.addEventListener('loadedmetadata', onLoadedMetadata);
      video.addEventListener('error', onError);

      return () => {
        video.removeEventListener('loadedmetadata', onLoadedMetadata);
        video.removeEventListener('error', onError);
        cleanupMedia();
      };
    } else {
      // Direct video file (MP4, WebM)
      video.src = resolvedStreamUrl;
      const onLoaded = () => {
        setInternalLoading(false);
        initPlyrIfNeeded();
        if (startAt && startAt > 0) {
          video.currentTime = startAt;
        }
        video.play().catch(() => {});
      };
      const onError = () => {
        setInternalError(
          'Falha ao carregar o arquivo de vídeo. O contêiner ou codec pode ser incompatível com o navegador.'
        );
        setInternalLoading(false);
      };

      video.addEventListener('loadedmetadata', onLoaded);
      video.addEventListener('canplay', onLoaded);
      video.addEventListener('error', onError);

      return () => {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('canplay', onLoaded);
        video.removeEventListener('error', onError);
        cleanupMedia();
      };
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
      cleanupMedia();
    };
  }, [resolvedStreamUrl, startAt, streamId, retryTrigger, embedded]);

  const handleBack = () => {
    cleanupMedia();
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    onBack();
  };

  const handleRetry = () => {
    setInternalError(null);
    setInternalLoading(true);
    setDiagnosticReport(null);
    if (onRetry) {
      onRetry();
    } else {
      setRetryTrigger((prev) => prev + 1);
    }
  };

  // Run diagnostic tool on demand
  const handleRunDiagnostic = async () => {
    setDiagnosticLoading(true);
    setShowDiagnosticModal(true);
    try {
      // If resolvedStreamUrl contains ticketId /api/media/stream/:ticket/:file
      const match = resolvedStreamUrl.match(/\/api\/media\/stream\/([^/]+)/);
      const ticketId = match ? match[1] : undefined;

      const res = ticketId
        ? await fetch(`/api/media/diagnose/${ticketId}`)
        : await fetch('/api/media/diagnose', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ streamId }),
          });

      if (res.ok) {
        const data = await res.json();
        setDiagnosticReport(data);
      } else {
        setDiagnosticReport({
          error: `Falha no serviço de diagnóstico (${res.status})`,
        });
      }
    } catch (err: any) {
      setDiagnosticReport({
        error: err?.message || 'Não foi possível conectar ao serviço de diagnóstico.',
      });
    } finally {
      setDiagnosticLoading(false);
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
          : 'fixed inset-0 z-50 bg-black flex flex-col items-center justify-center'
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
                Próximo
                <SkipForward className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Embedded Mode Top Bar Header */}
      {embedded && (
        <div className="absolute top-0 left-0 right-0 p-2 px-3 z-20 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
          <span className="text-xs font-semibold text-white/90 truncate max-w-[80%] drop-shadow">
            {title}
          </span>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 text-[10px] font-semibold border border-red-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
            AO VIVO
          </span>
        </div>
      )}

      {/* Persistent Loading Overlay (visible during channel switch & ticket creation; never blank/black) */}
      {isPlayerLoading && !activeError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-black/75 backdrop-blur-sm p-4 text-center">
          <Loader2 className="w-10 h-10 text-nc-primary animate-spin mb-3" />
          <p className="text-white text-base font-semibold truncate max-w-xs">{title}</p>
          <p className="text-gray-400 text-xs mt-1">Carregando transmissão segura...</p>
        </div>
      )}

      {/* Clear Error Overlay */}
      {activeError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-black/90 p-4 text-center">
          <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mb-3">
            <AlertCircle className="w-6 h-6 text-red-500" />
          </div>
          <p className="text-red-400 text-sm md:text-base font-medium max-w-md mb-2">{activeError}</p>
          <p className="text-gray-400 text-xs max-w-md mb-4">
            A transmissão é processada pela rota segura /api/media para garantir compatibilidade no navegador.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={handleRetry}
              className="px-4 py-2 bg-nc-primary hover:bg-nc-primary-hover text-black rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Tentar Novamente
            </button>
            <button
              onClick={handleRunDiagnostic}
              className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 cursor-pointer"
            >
              <Wrench className="w-3.5 h-3.5" />
              Diagnóstico
            </button>
            {!embedded && (
              <button
                onClick={handleBack}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-medium cursor-pointer"
              >
                Voltar
              </button>
            )}
          </div>
        </div>
      )}

      {/* Diagnostic Modal */}
      {showDiagnosticModal && (
        <div className="absolute inset-0 z-30 bg-black/85 backdrop-blur-md p-4 flex flex-col items-center justify-center">
          <div className="bg-nc-bg-card border border-nc-border rounded-2xl p-5 max-w-md w-full max-h-[85vh] overflow-y-auto text-left shadow-2xl">
            <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
              <Wrench className="w-4 h-4 text-nc-primary" /> Diagnóstico de Conexão com Origem
            </h3>

            {diagnosticLoading ? (
              <div className="py-8 flex flex-col items-center justify-center text-center">
                <Loader2 className="w-8 h-8 animate-spin text-nc-primary mb-2" />
                <p className="text-xs text-nc-text-secondary">Consultando servidor do provedor e cabeçalhos HTTP...</p>
              </div>
            ) : diagnosticReport ? (
              <div className="space-y-3 text-xs">
                {diagnosticReport.conclusion && (
                  <div
                    className={`p-3 rounded-xl border ${
                      diagnosticReport.conclusion.category === 'MAINTENANCE_VIDEO'
                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                        : diagnosticReport.conclusion.category === 'READY_NATIVE'
                        ? 'bg-green-500/10 border-green-500/30 text-green-300'
                        : 'bg-nc-bg-input border-nc-border text-white'
                    }`}
                  >
                    <p className="font-semibold text-xs mb-1">
                      {diagnosticReport.conclusion.category === 'MAINTENANCE_VIDEO'
                        ? 'Vídeo Substituto de Manutenção Detectado'
                        : 'Resultado da Análise'}
                    </p>
                    <p className="leading-relaxed">{diagnosticReport.conclusion.message}</p>
                    {diagnosticReport.conclusion.transcodingWillFix === false &&
                      diagnosticReport.conclusion.category === 'MAINTENANCE_VIDEO' && (
                        <p className="mt-2 text-[11px] text-amber-200/80 font-mono">
                          Nota técnica: Transcodificação não corrige mídias que a origem não forneceu.
                        </p>
                      )}
                  </div>
                )}

                {diagnosticReport.primaryProbe && (
                  <div className="p-3 bg-nc-bg rounded-xl border border-nc-border/40 space-y-1 font-mono text-[11px] text-gray-300">
                    <p>
                      <span className="text-gray-400">Extensão solicitada:</span> .{diagnosticReport.primaryProbe.requestedExt}
                    </p>
                    <p>
                      <span className="text-gray-400">Status HTTP:</span> {diagnosticReport.primaryProbe.httpStatus}
                    </p>
                    <p>
                      <span className="text-gray-400">Content-Type:</span> {diagnosticReport.primaryProbe.contentType}
                    </p>
                    <p>
                      <span className="text-gray-400">Tamanho:</span>{' '}
                      {diagnosticReport.primaryProbe.contentLength
                        ? `${Math.round(diagnosticReport.primaryProbe.contentLength / 1024)} KB`
                        : 'Não informado'}
                    </p>
                    <p>
                      <span className="text-gray-400">Suporte a Range:</span>{' '}
                      {diagnosticReport.primaryProbe.rangeSupported ? 'Sim (HTTP 206)' : 'Não / Não verificado'}
                    </p>
                    <p>
                      <span className="text-gray-400">Vídeo substituto:</span>{' '}
                      {diagnosticReport.primaryProbe.isMaintenanceVideo ? 'Sim (Confirmado)' : 'Não'}
                    </p>
                  </div>
                )}

                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => setShowDiagnosticModal(false)}
                    className="px-4 py-2 bg-nc-bg-input hover:bg-nc-border text-white rounded-lg text-xs font-medium"
                  >
                    Fechar
                  </button>
                </div>
              </div>
            ) : (
              <div className="py-4 text-center text-xs text-gray-400">
                Nenhum dado disponível.
                <button
                  onClick={() => setShowDiagnosticModal(false)}
                  className="block mx-auto mt-3 px-3 py-1 bg-nc-bg-input text-white rounded"
                >
                  Fechar
                </button>
              </div>
            )}
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
