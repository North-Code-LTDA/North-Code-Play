import React, { useEffect, useState, useRef } from 'react';
import {
  Settings,
  User,
  Server,
  Calendar,
  Loader2,
  GitCommit,
  Globe,
  Radio,
  ShieldCheck,
  Tv,
  Monitor,
  Sliders,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useXtreamContext } from '../context/XtreamContext';
import { XtreamService } from '../services/xtreamService';
import { APP_VERSION, APP_COMMIT } from '../version';
import { useDisplayPreferences } from '../platform/tvEnvironment';
import { DisplaySetupModal } from '../components/DisplaySetupModal';
import {
  getNativeBackBridgeStatus,
  getNavMode,
  focusElementSafely,
} from '../navigation';

interface ScreenMetrics {
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio: number;
  vvWidth: number | null;
  vvHeight: number | null;
  vvScale: number | null;
}

function readScreenMetrics(): ScreenMetrics {
  if (typeof window === 'undefined') {
    return {
      innerWidth: 0,
      innerHeight: 0,
      devicePixelRatio: 1,
      vvWidth: null,
      vvHeight: null,
      vvScale: null,
    };
  }
  const vv = window.visualViewport;
  return {
    innerWidth: Math.round(window.innerWidth),
    innerHeight: Math.round(window.innerHeight),
    devicePixelRatio: Number((window.devicePixelRatio || 1).toFixed(2)),
    vvWidth: vv ? Math.round(vv.width) : null,
    vvHeight: vv ? Math.round(vv.height) : null,
    vvScale: vv ? Number((vv.scale || 1).toFixed(2)) : null,
  };
}

export function ConfigView() {
  const { credentials } = useXtreamContext();
  const [accountInfo, setAccountInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showScreenDiagnostics, setShowScreenDiagnostics] = useState(false);
  const [screenMetrics, setScreenMetrics] = useState<ScreenMetrics>(() => readScreenMetrics());
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [modalInitialStep, setModalInitialStep] = useState<'device' | 'tv-calibrate'>('device');

  const containerRef = useRef<HTMLDivElement>(null);
  const adjustTriggerRef = useRef<HTMLButtonElement | null>(null);
  const hasInitialFocusedRef = useRef(false);

  const {
    mode,
    tvScale,
    effectiveMode,
    effectiveTvScale,
    uiScaleFactor,
    isConfigured,
  } = useDisplayPreferences();

  const nativeBackBridge = getNativeBackBridgeStatus();

  // Transfer focus once on mount when entering ConfigView via keyboard/remote
  useEffect(() => {
    if (hasInitialFocusedRef.current) return;
    hasInitialFocusedRef.current = true;

    if (getNavMode() !== 'remote') return;

    const root = containerRef.current;
    if (!root) return;

    const target =
      root.querySelector<HTMLElement>('[data-config-primary="true"]') ||
      root.querySelector<HTMLElement>('button');

    if (target) {
      focusElementSafely(target);
    }
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setScreenMetrics(readScreenMetrics());
    };
    window.addEventListener('resize', handleResize);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      vv?.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    if (credentials) {
      XtreamService.authenticate(credentials)
        .then((data) => {
          if (isMounted) {
            setAccountInfo(data.user_info);
            setLoading(false);
          }
        })
        .catch((err) => {
          if (isMounted) {
            setError(err.message || 'Falha ao buscar informações da conta.');
            setLoading(false);
          }
        });
    }

    return () => {
      isMounted = false;
    };
  }, [credentials]);

  const handleOpenAdjustModal = (
    step: 'device' | 'tv-calibrate',
    triggerEl: HTMLButtonElement
  ) => {
    adjustTriggerRef.current = triggerEl;
    setModalInitialStep(step);
    setIsAdjustModalOpen(true);
  };

  const handleCloseAdjustModal = () => {
    setIsAdjustModalOpen(false);
    const triggerEl = adjustTriggerRef.current;
    setTimeout(() => {
      if (triggerEl && document.body.contains(triggerEl)) {
        focusElementSafely(triggerEl);
      } else if (containerRef.current) {
        const fallback = containerRef.current.querySelector<HTMLElement>(
          '[data-config-primary="true"]'
        );
        if (fallback) focusElementSafely(fallback);
      }
    }, 0);
  };

  const formatDate = (expDate: string | number) => {
    if (!expDate || expDate === 'null') return 'Vitalícia / Indisponível';
    const timestamp = typeof expDate === 'string' ? parseInt(expDate, 10) : expDate;
    if (isNaN(timestamp)) return String(expDate);

    // Xtream typically uses seconds for timestamp
    const date = new Date(timestamp * 1000);
    if (date.getFullYear() > 2099) return 'Vitalícia';
    return `Sua conta expira em: ${date.toLocaleDateString('pt-BR')}`;
  };

  const allowedFormats: string[] =
    accountInfo?.allowed_output_formats || credentials?.allowed_output_formats || [];

  const formatBackBridgeStatus = () => {
    return nativeBackBridge.label;
  };

  return (
    <>
      <div
        ref={containerRef}
        data-nav-zone="content"
        data-scroll-container="true"
        inert={isAdjustModalOpen ? true : undefined}
        className="nc-tv-content-pad w-full h-full min-w-0 min-h-0 flex flex-col items-center justify-start p-4 sm:p-6 md:p-10 overflow-y-auto custom-scrollbar"
      >
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-3xl bg-nc-bg-card border border-nc-border/50 rounded-2xl p-5 sm:p-6 md:p-8 shadow-2xl mb-8"
        >
          <div className="flex items-center gap-4 mb-6 border-b border-nc-border/50 pb-5">
            <div className="p-3 bg-nc-bg-input rounded-xl text-nc-primary">
              <Settings className="w-7 h-7" />
            </div>
            <div>
              <h2 className="text-xl md:text-2xl font-bold text-white">Configurações & Diagnóstico</h2>
              <p className="text-nc-text-secondary text-sm">
                Ajuste a apresentação da interface por dispositivo e verifique os detalhes da conta
              </p>
            </div>
          </div>

          {/* Presentation & Continuous TV Scale Section */}
          <div
            data-scroll-block="true"
            data-scroll-top-anchor="true"
            className="mb-8 pb-6 border-b border-nc-border/50 space-y-4"
          >
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-lg font-medium text-white flex items-center gap-2">
                <Tv className="w-5 h-5 text-nc-primary" /> Apresentação e Tamanho da Interface
              </h3>
              <span className="text-xs px-2.5 py-1 rounded-md bg-nc-bg-input border border-nc-border/60 text-gray-300">
                Ativo:{' '}
                <strong className="text-white">
                  {effectiveMode === 'tv'
                    ? `TV (${effectiveTvScale}%)`
                    : 'Outros dispositivos (Padrão 100%)'}
                </strong>
              </span>
            </div>

            <div className="p-4 rounded-xl bg-nc-bg-input/80 border border-nc-border/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-white font-semibold text-sm">
                  {mode === 'tv' ? (
                    <>
                      <Tv className="w-4 h-4 text-nc-primary shrink-0" />
                      <span>Modo TV &mdash; Tamanho da interface em {tvScale}%</span>
                    </>
                  ) : (
                    <>
                      <Monitor className="w-4 h-4 text-nc-primary shrink-0" />
                      <span>Outros dispositivos &mdash; Apresentação responsiva padrão (100%)</span>
                    </>
                  )}
                </div>
                <p className="text-xs text-nc-text-secondary leading-relaxed">
                  {mode === 'tv'
                    ? 'A escala contínua de TV ajusta textos, barra lateral, categorias, cartões, detalhes e controles do player.'
                    : 'Utiliza o layout original para computador, celular ou tablet sem aplicar escala de TV.'}
                </p>
              </div>

              <div
                data-nav-row="config-presentation-actions"
                className="flex flex-wrap items-center gap-2.5 shrink-0"
              >
                <button
                  type="button"
                  data-nav-item="true"
                  data-config-primary="true"
                  data-autofocus="true"
                  onClick={(e) => handleOpenAdjustModal('device', e.currentTarget)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-nc-primary text-black font-semibold text-sm hover:bg-nc-primary-hover transition-colors shadow-md"
                >
                  <Sliders className="w-4 h-4" />
                  <span>Ajustar apresentação</span>
                </button>

                {mode === 'tv' && (
                  <button
                    type="button"
                    data-nav-item="true"
                    onClick={(e) => handleOpenAdjustModal('tv-calibrate', e.currentTarget)}
                    className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-nc-bg-card hover:bg-nc-border/50 text-white border border-nc-border/60 font-medium text-sm transition-colors"
                  >
                    <Tv className="w-4 h-4 text-nc-primary" />
                    <span>Calibrar escala ({tvScale}%)</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-10 text-nc-text-secondary">
              <Loader2 className="w-10 h-10 animate-spin mb-4 text-nc-primary" />
              <p>Carregando informações da conta...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-10 text-red-400 text-center">
              <p>{error}</p>
            </div>
          ) : (
            <div className="space-y-5">
              <h3 className="text-lg font-medium text-white mb-2">Informações da Conta</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-nc-bg-input rounded-xl p-4 border border-nc-border/50 flex items-start gap-3.5">
                  <User className="w-5 h-5 text-nc-text-secondary mt-1 shrink-0" />
                  <div className="overflow-hidden">
                    <p className="text-xs text-nc-text-secondary">Usuário Logado</p>
                    <p className="font-semibold text-white truncate text-base mt-0.5">
                      {credentials?.username || 'Desconhecido'}
                    </p>
                  </div>
                </div>

                <div className="bg-nc-bg-input rounded-xl p-4 border border-nc-border/50 flex items-start gap-3.5">
                  <Server className="w-5 h-5 text-nc-text-secondary mt-1 shrink-0" />
                  <div className="overflow-hidden w-full">
                    <p className="text-xs text-nc-text-secondary">URL do Servidor</p>
                    <p className="font-semibold text-white truncate text-base mt-0.5 w-full">
                      {credentials?.serverUrl || 'Desconhecido'}
                    </p>
                  </div>
                </div>

                <div className="bg-nc-bg-input rounded-xl p-4 border border-nc-border/50 flex items-start gap-3.5 md:col-span-2">
                  <Calendar className="w-5 h-5 text-nc-text-secondary mt-1 shrink-0" />
                  <div className="overflow-hidden">
                    <p className="text-xs text-nc-text-secondary">Validade da Assinatura</p>
                    <p className="font-semibold text-white truncate text-base mt-0.5 text-nc-primary">
                      {formatDate(accountInfo?.exp_date)}
                    </p>
                  </div>
                </div>
              </div>

              {accountInfo?.status && (
                <div className="mt-3 flex items-center gap-2 text-sm text-nc-text-secondary">
                  <span className="relative flex h-3 w-3">
                    <span
                      className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                        accountInfo.status.toLowerCase() === 'active' ? 'bg-green-400' : 'bg-red-400'
                      }`}
                    ></span>
                    <span
                      className={`relative inline-flex rounded-full h-3 w-3 ${
                        accountInfo.status.toLowerCase() === 'active' ? 'bg-green-500' : 'bg-red-500'
                      }`}
                    ></span>
                  </span>
                  Status da Conta: <strong className="text-white ml-1">{accountInfo.status}</strong>
                  {accountInfo.max_connections && (
                    <span className="ml-4 text-xs text-nc-text-secondary">
                      Conexões ativas: {accountInfo.active_cons || 0} / {accountInfo.max_connections}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Build & Diagnostics Section */}
          <div data-scroll-block="true" className="mt-8 pt-6 border-t border-nc-border/50 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-lg font-medium text-white flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-nc-primary" /> Arquitetura & Diagnóstico
              </h3>
              <button
                type="button"
                data-nav-row="config-diagnostics-toggle"
                data-nav-item="true"
                data-scroll-block="true"
                onClick={() => setShowScreenDiagnostics((prev) => !prev)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-nc-bg-input border border-nc-border/60 text-xs font-medium text-gray-200 hover:text-white hover:border-white/40 transition-colors"
              >
                <Monitor className="w-3.5 h-3.5 text-nc-primary" />
                <span>{showScreenDiagnostics ? 'Ocultar diagnóstico da tela' : 'Ver diagnóstico da tela'}</span>
                {showScreenDiagnostics ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            </div>

            {showScreenDiagnostics && (
              <div
                tabIndex={0}
                role="region"
                aria-label="Diagnóstico da Tela e Ambiente"
                data-nav-item="true"
                data-synopsis-focus="true"
                data-scroll-block="true"
                className="bg-nc-bg-input/80 rounded-xl p-4 border border-nc-border/50 space-y-3 text-xs focus:outline-none"
              >
                <div className="font-semibold text-white text-sm flex items-center gap-2 border-b border-nc-border/40 pb-2">
                  <Monitor className="w-4 h-4 text-nc-primary" /> Diagnóstico da Tela e Ambiente
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <span className="text-gray-400 block">Modo de Apresentação Efetivo</span>
                    <span className="text-white font-mono">
                      {effectiveMode === 'tv'
                        ? `TV — Escala ${effectiveTvScale}% (--nc-ui-scale: ${uiScaleFactor})`
                        : 'Padrão (100%)'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400 block">Preferência Salva no Dispositivo</span>
                    <span className="text-white font-mono">
                      {isConfigured
                        ? mode === 'tv'
                          ? `TV (${tvScale}%)`
                          : 'Outros dispositivos (100%)'
                        : 'Não configurada'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400 block">Viewport CSS (innerWidth × innerHeight)</span>
                    <span className="text-white font-mono">
                      {screenMetrics.innerWidth} × {screenMetrics.innerHeight} px
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400 block">Device Pixel Ratio (DPR)</span>
                    <span className="text-white font-mono">{screenMetrics.devicePixelRatio}x</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block">Visual Viewport</span>
                    <span className="text-white font-mono">
                      {screenMetrics.vvWidth !== null && screenMetrics.vvHeight !== null
                        ? `${screenMetrics.vvWidth} × ${screenMetrics.vvHeight} px (scale: ${screenMetrics.vvScale ?? 1})`
                        : 'Indisponível'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400 block">Integração Nativa de Voltar</span>
                    <span className="text-white font-mono">{formatBackBridgeStatus()}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="bg-nc-bg-input/60 rounded-xl p-4 border border-nc-border/30">
                <span className="text-nc-text-secondary text-xs block mb-1 flex items-center gap-1.5">
                  <GitCommit className="w-4 h-4 text-nc-primary" /> Commit da Aplicação
                </span>
                <span className="font-mono text-white text-xs select-all break-all">
                  {APP_COMMIT}
                </span>
                <span className="text-gray-500 text-[11px] block mt-1">
                  Versão: v{APP_VERSION} ({APP_COMMIT.slice(0, 7)})
                </span>
              </div>

              <div className="bg-nc-bg-input/60 rounded-xl p-4 border border-nc-border/30">
                <span className="text-nc-text-secondary text-xs block mb-1 flex items-center gap-1.5">
                  <Radio className="w-4 h-4 text-nc-primary" /> Formatos do Provedor
                </span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {allowedFormats.length > 0 ? (
                    allowedFormats.map((fmt) => (
                      <span
                        key={fmt}
                        className="px-2 py-0.5 rounded bg-nc-primary/10 border border-nc-primary/30 text-nc-primary font-mono text-xs uppercase"
                      >
                        {fmt}
                      </span>
                    ))
                  ) : (
                    <span className="text-gray-400 text-xs">Padrão (HLS / MP4)</span>
                  )}
                </div>
                <span className="text-gray-500 text-[11px] block mt-1">
                  Canais ao vivo priorizam HLS (.m3u8) para reprodução direta
                </span>
              </div>

              <div className="bg-nc-bg-input/60 rounded-xl p-4 border border-nc-border/30 md:col-span-2">
                <span className="text-nc-text-secondary text-xs block mb-1 flex items-center gap-1.5">
                  <Globe className="w-4 h-4 text-nc-primary" /> Reprodução 100% Direta no Navegador
                </span>
                <p className="text-gray-300 text-xs leading-relaxed">
                  Todas as consultas de API, autenticação, catálogo, capas e transmissões de vídeo são
                  feitas diretamente pelo navegador para o servidor do provedor IPTV, sem qualquer proxy ou intermediação de tráfego.
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      <DisplaySetupModal
        isOpen={isAdjustModalOpen}
        canCancel={true}
        initialStep={modalInitialStep}
        onComplete={handleCloseAdjustModal}
        onCancel={handleCloseAdjustModal}
      />
    </>
  );
}
