import { HlsConfig } from 'hls.js';
import { BufferProfileKey } from './types';

export interface BufferProfileConfig {
  key: BufferProfileKey;
  label: string;
  description: string;
  hlsOptions: Partial<HlsConfig>;
}

/**
 * Perfis centralizados de buffer e estabilidade para Hls.js (compatíveis com v1.6.x).
 *
 * Justificativas técnicas:
 * 1. Equilibrado (Padrão):
 *    - lowLatencyMode: false para evitar acelerações artificiais de áudio/vídeo em streams IPTV convencionais.
 *    - maxBufferLength: 30s e maxMaxBufferLength: 60s evitam estouro de memória em navegadores móveis.
 *    - backBufferLength: 30s descarta segmentos antigos para manter o heap leve.
 *    - liveSyncDurationCount: 4 segmentos (~12-16s de atraso) garante folga contra variações de rota.
 *
 * 2. Mais Estabilidade:
 *    - maxBufferLength: 60s e maxMaxBufferLength: 120s para conexões oscilantes ou com jitter.
 *    - liveSyncDurationCount: 6 e liveMaxLatencyDurationCount: 12 aceitam atraso maior em troca de zero interrupções.
 *
 * 3. Baixa Latência:
 *    - lowLatencyMode: true e liveSyncDurationCount: 3 para transmissões esportivas ou ao vivo onde atraso mínimo é prioritário.
 */
export const BUFFER_PROFILES: Record<BufferProfileKey, BufferProfileConfig> = {
  balanced: {
    key: 'balanced',
    label: 'Equilibrado',
    description: 'Padrão recomendado: boa estabilidade com atraso moderado.',
    hlsOptions: {
      lowLatencyMode: false,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      backBufferLength: 30,
      liveSyncDurationCount: 4,
      liveMaxLatencyDurationCount: 8,
      liveDurationInfinity: true,
      enableWorker: true,
      manifestLoadingTimeOut: 20000,
      manifestLoadingMaxRetry: 4,
      levelLoadingTimeOut: 20000,
      levelLoadingMaxRetry: 4,
      fragLoadingTimeOut: 25000,
      fragLoadingMaxRetry: 4,
    },
  },
  stability: {
    key: 'stability',
    label: 'Mais Estabilidade',
    description: 'Maior buffer à frente, ideal para redes oscilantes ou conexões lentas.',
    hlsOptions: {
      lowLatencyMode: false,
      maxBufferLength: 60,
      maxMaxBufferLength: 120,
      backBufferLength: 45,
      liveSyncDurationCount: 6,
      liveMaxLatencyDurationCount: 12,
      liveDurationInfinity: true,
      enableWorker: true,
      manifestLoadingTimeOut: 25000,
      manifestLoadingMaxRetry: 5,
      levelLoadingTimeOut: 25000,
      levelLoadingMaxRetry: 5,
      fragLoadingTimeOut: 30000,
      fragLoadingMaxRetry: 5,
    },
  },
  lowLatency: {
    key: 'lowLatency',
    label: 'Baixa Latência',
    description: 'Menor atraso em transmissões ao vivo com conexão rápida e estável.',
    hlsOptions: {
      lowLatencyMode: true,
      maxBufferLength: 15,
      maxMaxBufferLength: 30,
      backBufferLength: 15,
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 6,
      liveDurationInfinity: true,
      enableWorker: true,
      manifestLoadingTimeOut: 15000,
      manifestLoadingMaxRetry: 3,
      levelLoadingTimeOut: 15000,
      levelLoadingMaxRetry: 3,
      fragLoadingTimeOut: 15000,
      fragLoadingMaxRetry: 3,
    },
  },
};
