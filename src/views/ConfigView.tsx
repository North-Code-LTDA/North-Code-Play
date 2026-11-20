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
} from 'lucide-react';
import { motion } from 'motion/react';
import { useXtreamCredentials } from '../context/XtreamContext';
import { XtreamService } from '../services/xtreamService';
import { APP_VERSION, APP_COMMIT, APP_BUILD_TIME, formatCommitShort } from '../version';
import { useDisplayPreferences } from '../platform/tvEnvironment';
import { DisplaySetupModal } from '../components/DisplaySetupModal';
import {
  getNavMode,
  focusElementSafely,
} from '../navigation';

export interface ConfigViewProps {
  focusTarget?: 'presentation' | 'account';
  focusRequestId?: number;
}

export const ConfigView = React.memo(function ConfigView({
  focusTarget = 'presentation',
  focusRequestId = 0,
}: ConfigViewProps = {}) {
  const { credentials } = useXtreamCredentials();
  const [accountInfo, setAccountInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
  } = useDisplayPreferences();

  // Transfer focus on mount or when focusRequestId/focusTarget changes from the header Account menu
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    if (focusTarget === 'account' && !loading) {
      const accountEl = root.querySelector<HTMLElement>('[data-config-account-focus="true"]');
      if (accountEl) {
        focusElementSafely(accountEl);
        hasInitialFocusedRef.current = true;
        return;
      }
    }

    if (hasInitialFocusedRef.current && focusRequestId === 0) return;
    hasInitialFocusedRef.current = true;

    if (focusTarget !== 'account' && getNavMode() !== 'remote' && focusRequestId === 0) return;

    const target =
      (focusTarget === 'account'
        ? root.querySelector<HTMLElement>('[data-config-account-focus="true"]')
        : null) ||
      root.querySelector<HTMLElement>('[data-config-primary="true"]') ||
      root.querySelector<HTMLElement>('button');

    if (target) {
      focusElementSafely(target);
    }
  }, [focusTarget, focusRequestId, loading]);

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
          <div className="flex items-start sm:items-center gap-3.5 sm:gap-4 mb-6 border-b border-nc-border/50 pb-5">
            <div className="p-3 bg-nc-bg-input rounded-xl text-nc-primary shrink-0">
              <Settings className="w-6 h-6 sm:w-7 sm:h-7" />
            </div>
            <div className="min-w-0">
              <h2 className="nc-heading-view font-bold text-white">Configurações</h2>
              <p className="nc-text-subtitle text-nc-text-secondary mt-0.5 break-words">
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
              <h3 className="nc-heading-section font-semibold text-white flex items-center gap-2">
                <Tv className="w-5 h-5 text-nc-primary shrink-0" /> <span>Apresentação e Tamanho da Interface</span>
              </h3>
              <span className="nc-text-meta px-2.5 py-1 rounded-md bg-nc-bg-input border border-nc-border/60 text-gray-300">
                Ativo:{' '}
                <strong className="text-white">
                  {effectiveMode === 'tv'
                    ? `TV (${effectiveTvScale}%)`
                    : 'Outros dispositivos (Padrão 100%)'}
                </strong>
              </span>
            </div>

            <div className="p-4 rounded-xl bg-nc-bg-input/80 border border-nc-border/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 text-white font-semibold nc-text-subtitle">
                  {mode === 'tv' ? (
                    <>
                      <Tv className="w-4 h-4 text-nc-primary shrink-0" />
                      <span className="break-words">Modo TV &mdash; Tamanho da interface em {tvScale}%</span>
                    </>
                  ) : (
                    <>
                      <Monitor className="w-4 h-4 text-nc-primary shrink-0" />
                      <span className="break-words">Outros dispositivos &mdash; Apresentação responsiva padrão (100%)</span>
                    </>
                  )}
                </div>
                <p className="nc-text-meta text-nc-text-secondary leading-relaxed break-words">
                  {mode === 'tv'
                    ? 'A escala contínua de TV ajusta textos, barra lateral, categorias, cartões, detalhes e controles do player.'
                    : 'Utiliza o layout original para computador, celular ou tablet sem aplicar escala de TV.'}
                </p>
              </div>

              <div
                data-nav-row="config-presentation-actions"
                className="nc-action-group shrink-0"
              >
                <button
                  type="button"
                  data-nav-item="true"
                  data-config-primary="true"
                  data-autofocus="true"
                  onClick={(e) => handleOpenAdjustModal('device', e.currentTarget)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-nc-primary text-black font-semibold text-sm hover:bg-nc-primary-hover transition-colors shadow-md"
                >
                  <Sliders className="w-4 h-4 shrink-0" />
                  <span>Ajustar apresentação</span>
                </button>

                {mode === 'tv' && (
                  <button
                    type="button"
                    data-nav-item="true"
                    onClick={(e) => handleOpenAdjustModal('tv-calibrate', e.currentTarget)}
                    className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-nc-bg-card hover:bg-nc-border/50 text-white border border-nc-border/60 font-medium text-sm transition-colors"
                  >
                    <Tv className="w-4 h-4 text-nc-primary shrink-0" />
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
            <div
              tabIndex={0}
              role="region"
              aria-label="Informações da Conta"
              data-nav-item="true"
              data-scroll-block="true"
              data-config-section="account"
              data-config-account-focus="true"
              className="space-y-5 rounded-xl p-1 -m-1 focus:outline-none"
            >
              <h3 className="nc-heading-section font-semibold text-white mb-2">Informações da Conta</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-nc-bg-input rounded-xl p-4 border border-nc-border/50 flex items-start gap-3.5 min-w-0">
                  <User className="w-5 h-5 text-nc-text-secondary mt-1 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="nc-text-meta text-nc-text-secondary">Usuário Logado</p>
                    <p className="font-semibold text-white break-words text-base mt-0.5">
                      {credentials?.username || 'Desconhecido'}
                    </p>
                  </div>
                </div>

                <div className="bg-nc-bg-input rounded-xl p-4 border border-nc-border/50 flex items-start gap-3.5 min-w-0">
                  <Server className="w-5 h-5 text-nc-text-secondary mt-1 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="nc-text-meta text-nc-text-secondary">URL do Servidor</p>
                    <p className="font-semibold text-white break-words text-base mt-0.5 w-full">
                      {credentials?.serverUrl || 'Desconhecido'}
                    </p>
                  </div>
                </div>

                <div className="bg-nc-bg-input rounded-xl p-4 border border-nc-border/50 flex items-start gap-3.5 md:col-span-2 min-w-0">
                  <Calendar className="w-5 h-5 text-nc-text-secondary mt-1 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="nc-text-meta text-nc-text-secondary">Validade da Assinatura</p>
                    <p className="font-semibold text-nc-primary break-words text-base mt-0.5">
                      {formatDate(accountInfo?.exp_date)}
                    </p>
                  </div>
                </div>
              </div>

              {accountInfo?.status && (
                <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 nc-text-subtitle text-nc-text-secondary">
                  <span className="relative flex h-3 w-3 shrink-0">
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
                  <span>
                    Status da Conta: <strong className="text-white ml-1">{accountInfo.status}</strong>
                  </span>
                  {accountInfo.max_connections && (
                    <span className="sm:ml-3 nc-text-meta text-nc-text-secondary">
                      Conexões ativas: {accountInfo.active_cons || 0} / {accountInfo.max_connections}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* App & Build Information Section */}
          <div data-scroll-block="true" className="mt-8 pt-6 border-t border-nc-border/50 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="nc-heading-section font-semibold text-white flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-nc-primary shrink-0" /> <span>Informações do aplicativo</span>
              </h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="bg-nc-bg-input/60 rounded-xl p-4 border border-nc-border/30">
                <span className="text-nc-text-secondary nc-text-meta block mb-1 flex items-center gap-1.5">
                  <GitCommit className="w-4 h-4 text-nc-primary shrink-0" /> <span>Identificação do Build</span>
                </span>
                <span className="font-mono text-white nc-text-meta select-all break-all">
                  {APP_COMMIT}
                </span>
                <span className="text-gray-400 nc-text-meta block mt-1">
                  Versão: v{APP_VERSION} ({formatCommitShort(APP_COMMIT)}) &bull; {APP_BUILD_TIME.slice(0, 10)}
                </span>
              </div>

              <div className="bg-nc-bg-input/60 rounded-xl p-4 border border-nc-border/30">
                <span className="text-nc-text-secondary nc-text-meta block mb-1 flex items-center gap-1.5">
                  <Radio className="w-4 h-4 text-nc-primary shrink-0" /> <span>Formatos do Provedor</span>
                </span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {allowedFormats.length > 0 ? (
                    allowedFormats.map((fmt) => (
                      <span
                        key={fmt}
                        className="px-2 py-0.5 rounded bg-nc-primary/10 border border-nc-primary/30 text-nc-primary font-mono nc-text-meta uppercase"
                      >
                        {fmt}
                      </span>
                    ))
                  ) : (
                    <span className="text-gray-400 nc-text-meta">Padrão (HLS / MP4)</span>
                  )}
                </div>
                <span className="text-gray-400 nc-text-meta block mt-1">
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
});
