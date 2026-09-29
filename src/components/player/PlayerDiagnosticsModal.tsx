import React, { useState } from 'react';
import { Wrench, Copy, Check, X, ShieldAlert, Cpu } from 'lucide-react';
import { PlaybackStats, PlayerContentType, PlayerTransport } from './types';

interface PlayerDiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  streamUrl: string;
  contentType: PlayerContentType;
  transport: PlayerTransport;
  stats: PlaybackStats;
}

export function PlayerDiagnosticsModal({
  isOpen,
  onClose,
  streamUrl,
  contentType,
  transport,
  stats,
}: PlayerDiagnosticsModalProps) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const copyUrl = () => {
    if (streamUrl) {
      navigator.clipboard.writeText(streamUrl).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  const contentTypeLabel =
    contentType === 'live'
      ? 'TV ao Vivo'
      : contentType === 'episode'
      ? 'Episódio de Série'
      : 'Filme (VOD)';

  const transportLabel =
    transport === 'hls' ? 'HLS (Hls.js / MediaSource)' : 'Progressivo Nativo (HTML5 Video)';

  return (
    <div
      className="absolute inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="bg-nc-bg-card border border-nc-border rounded-2xl p-6 max-w-lg w-full shadow-2xl flex flex-col gap-4 text-left max-h-[90vh] overflow-y-auto custom-scrollbar select-text text-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-nc-border/50 pb-3">
          <div className="flex items-center gap-2">
            <Wrench className="w-5 h-5 text-nc-primary" />
            <h3 className="text-base font-bold">Diagnóstico Técnico da Reprodução</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/10 rounded-full text-nc-text-secondary hover:text-white cursor-pointer"
            title="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* URL Card */}
        <div className="space-y-1.5 text-xs">
          <span className="font-semibold text-nc-text-secondary block">
            URL Direta da Mídia (sem proxies):
          </span>
          <div className="flex items-center gap-2 bg-nc-bg-input p-2.5 rounded-xl border border-nc-border/40 font-mono text-[11px] text-gray-300 break-all select-all">
            <span className="flex-1">{streamUrl || 'Nenhuma URL ativa'}</span>
            {streamUrl && (
              <button
                onClick={copyUrl}
                className="p-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-white shrink-0 cursor-pointer flex items-center gap-1 text-xs"
                title="Copiar URL para testar no VLC"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copiado!' : 'Copiar'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-nc-bg-input p-2.5 rounded-xl border border-nc-border/40">
            <span className="block text-nc-text-secondary">Tipo de Conteúdo:</span>
            <span className="font-medium text-white">{contentTypeLabel}</span>
          </div>

          <div className="bg-nc-bg-input p-2.5 rounded-xl border border-nc-border/40">
            <span className="block text-nc-text-secondary">Motor / Transporte:</span>
            <span className="font-medium text-white">{transportLabel}</span>
          </div>

          <div className="bg-nc-bg-input p-2.5 rounded-xl border border-nc-border/40">
            <span className="block text-nc-text-secondary">Resolução do Vídeo:</span>
            <span className="font-medium text-white">
              {stats.width && stats.height ? `${stats.width}x${stats.height}` : 'Indisponível'}
            </span>
          </div>

          <div className="bg-nc-bg-input p-2.5 rounded-xl border border-nc-border/40">
            <span className="block text-nc-text-secondary">Buffer à Frente:</span>
            <span className="font-medium text-white">
              {stats.bufferedAhead !== undefined ? `${stats.bufferedAhead.toFixed(1)} segundos` : '-'}
            </span>
          </div>

          <div className="bg-nc-bg-input p-2.5 rounded-xl border border-nc-border/40">
            <span className="block text-nc-text-secondary">Eventos de Rebuffering:</span>
            <span className="font-medium text-white">{stats.rebufferingCount}</span>
          </div>

          <div className="bg-nc-bg-input p-2.5 rounded-xl border border-nc-border/40">
            <span className="block text-nc-text-secondary">
              {contentType === 'live' ? 'Atraso ao Vivo:' : 'Posição / Duração:'}
            </span>
            <span className="font-medium text-white">
              {contentType === 'live'
                ? stats.liveLatency !== undefined && stats.liveLatency > 0
                  ? `~${Math.round(stats.liveLatency)}s atrás da borda`
                  : 'Sincronizado ao vivo'
                : `${Math.floor(stats.currentTime || 0)}s / ${Math.floor(stats.duration || 0)}s`}
            </span>
          </div>
        </div>

        {/* CORS / Connection Note */}
        <div className="p-3 bg-nc-bg-input/60 rounded-xl border border-nc-border/40 text-xs space-y-1 text-nc-text-secondary leading-relaxed">
          <span className="font-semibold text-white flex items-center gap-1.5 mb-1">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400" /> Diretrizes de Conexão
          </span>
          <p>
            • <strong>Origem Direta:</strong> As requisições saem 100% diretamente do navegador para o servidor do provedor.
          </p>
          <p>
            • <strong>CORS:</strong> Para transmissões HLS (.m3u8), o servidor IPTV precisa enviar <code>Access-Control-Allow-Origin: *</code>.
          </p>
          <p>
            • <strong>Mixed Content:</strong> Em sites HTTPS, navegadores bloqueiam fluxos de provedores HTTP puro. A VPS entrega a aplicação em HTTP para compatibilidade com IPTV HTTP.
          </p>
        </div>

        <div className="flex justify-end pt-1">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-nc-bg-input hover:bg-white/10 text-white rounded-xl border border-nc-border/50 text-xs font-medium cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
