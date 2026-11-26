import React, { useEffect, useState, useRef } from 'react';
import {
  Settings,
  User,
  Calendar,
  Loader2,
  Tv,
  Monitor,
  Sliders,
  CheckCircle2,
  AlertCircle,
  Users,
  Gauge,
  Check,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useXtreamCredentials } from '../context/XtreamContext';
import { XtreamService } from '../services/xtreamService';
import { useDisplayPreferences } from '../platform/tvEnvironment';
import {
  usePerformanceProfile,
  PerformanceProfilePreference,
} from '../platform/performanceProfile';
import { DisplaySetupModal } from '../components/DisplaySetupModal';
import {
  getNavMode,
  focusElementSafely,
} from '../navigation';
import {
  formatAccountConnections,
  formatAccountExpiration,
  formatAccountStatus,
} from '../utils/accountUtils';
import { XtreamUserInfo } from '../types';

const PERFORMANCE_OPTIONS: ReadonlyArray<{
  id: PerformanceProfilePreference;
  label: string;
  description: string;
}> = [
  {
    id: 'auto',
    label: 'Automático',
    description: 'Ativa o modo Lite na apresentação TV ao navegar com controle remoto.',
  },
  {
    id: 'lite',
    label: 'Lite',
    description: 'Reduz animações e efeitos gráficos na apresentação TV com controle remoto.',
  },
  {
    id: 'full',
    label: 'Completo',
    description: 'Mantém todos os efeitos visuais atuais.',
  },
];

export interface ConfigViewProps {
  focusTarget?: 'presentation' | 'account';
  focusRequestId?: number;
}

export const ConfigView = React.memo(function ConfigView({
  focusTarget = 'presentation',
  focusRequestId = 0,
}: ConfigViewProps = {}) {
  const { credentials } = useXtreamCredentials();
  const [accountInfo, setAccountInfo] = useState<XtreamUserInfo | null>(null);
  const [loading, setLoading] = useState(Boolean(credentials));
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

  const {
    preference: performancePreference,
    effectiveMode: effectivePerformanceMode,
    isAndroidApk,
    isLiteActive,
    setPreference: setPerformancePreference,
  } = usePerformanceProfile();

  // Posiciona a abertura de Configurações/Conta a partir do topo da página, sem rolar para seções inferiores
  // e sem aplicar foco automático agressivo quando o usuário está navegando com mouse/ponteiro.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    if (focusRequestId > 0 || !hasInitialFocusedRef.current) {
      root.scrollTop = 0;
    }

    const navMode = getNavMode();
    if (navMode !== 'remote') {
      hasInitialFocusedRef.current = true;
      return;
    }

    if (hasInitialFocusedRef.current && focusRequestId === 0) return;
    hasInitialFocusedRef.current = true;

    const target =
      root.querySelector<HTMLElement>('[data-config-account-focus="true"]') ||
      root.querySelector<HTMLElement>('[data-config-primary="true"]') ||
      root.querySelector<HTMLElement>('button');

    if (target) {
      focusElementSafely(target);
    }
  }, [focusTarget, focusRequestId]);

  useEffect(() => {
    let isMounted = true;
    const abortController =
      typeof AbortController !== 'undefined' ? new AbortController() : null;

    setAccountInfo(null);
    if (!credentials) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    XtreamService.authenticate(
      credentials,
      abortController ? { signal: abortController.signal } : undefined
    )
      .then((data) => {
        if (!isMounted || abortController?.signal.aborted) return;
        setAccountInfo(data?.user_info ?? null);
        setLoading(false);
      })
      .catch((err) => {
        if (!isMounted || abortController?.signal.aborted || err?.name === 'AbortError') return;
        setError(err?.message || 'Falha ao buscar informações da conta.');
        setLoading(false);
      });

    return () => {
      isMounted = false;
      abortController?.abort();
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

  const rawUsername =
    typeof accountInfo?.username === 'string' && accountInfo.username.trim().length > 0
      ? accountInfo.username.trim()
      : typeof credentials?.username === 'string' && credentials.username.trim().length > 0
        ? credentials.username.trim()
        : '';
  const usernameDisplay = rawUsername || 'Indisponível';

  const expirationInfo = formatAccountExpiration(accountInfo?.exp_date);
  const statusInfo = formatAccountStatus(accountInfo?.status);
  const connectionsInfo = formatAccountConnections(
    accountInfo?.active_cons,
    accountInfo?.max_connections
  );

  const accountGridClass = 'grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-4';

  const activeModeLabel = effectiveMode === 'tv' ? 'TV' : 'Outros dispositivos';
  const activeScaleLabel = effectiveMode === 'tv' ? `${effectiveTvScale}%` : '100%';

  return (
    <>
      <div
        ref={containerRef}
        data-nav-zone="content"
        data-scroll-container="true"
        inert={isAdjustModalOpen ? true : undefined}
        className="nc-tv-content-pad nc-safe-screen w-full h-full min-w-0 min-h-0 flex flex-col items-center justify-start px-4 py-6 sm:px-6 sm:py-8 md:px-10 md:py-10 overflow-y-auto overflow-x-hidden custom-scrollbar bg-nc-bg"
      >
        <motion.div
          data-config-lite-motion={isLiteActive ? 'true' : 'false'}
          initial={isLiteActive ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={isLiteActive ? { duration: 0 } : { duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-4xl space-y-6 sm:space-y-8 pb-10"
        >
          {/* 1. Cabeçalho Configurações */}
          <header className="flex items-start sm:items-center gap-3.5 sm:gap-4 pb-5 border-b border-white/10">
            <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-nc-bg-card border border-white/10 flex items-center justify-center text-white shrink-0">
              <Settings className="w-5 h-5 sm:w-6 sm:h-6" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 className="nc-heading-view font-bold text-white tracking-tight">
                Configurações
              </h1>
              <p className="nc-text-subtitle text-nc-text-secondary mt-0.5 break-words">
                Detalhes da sua assinatura e ajustes de apresentação da interface
              </p>
            </div>
          </header>

          {/* 2. Informações da Conta (Primeira seção) */}
          <section
            tabIndex={0}
            role="region"
            aria-label="Informações da Conta"
            data-nav-item="true"
            data-scroll-block="true"
            data-scroll-top-anchor="true"
            data-config-section="account"
            data-config-account-focus="true"
            className="bg-nc-bg-card border border-white/10 rounded-2xl p-5 sm:p-6 md:p-7 space-y-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          >
            <div className="flex items-center gap-2.5">
              <User className="w-5 h-5 text-white/80 shrink-0" aria-hidden="true" />
              <h2 className="nc-heading-section font-semibold text-white">
                Informações da Conta
              </h2>
            </div>

            {loading ? (
              <div className="flex items-center gap-3 py-6 text-nc-text-secondary">
                <Loader2 className="w-5 h-5 animate-spin text-white shrink-0" aria-hidden="true" />
                <p className="nc-text-subtitle">Carregando informações da conta...</p>
              </div>
            ) : error ? (
              <div
                role="alert"
                className="flex items-start gap-3 rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3.5 text-red-200"
              >
                <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="min-w-0 space-y-1">
                  <p className="nc-text-subtitle font-medium text-red-200 break-words">
                    {error}
                  </p>
                  {credentials?.username && (
                    <p className="nc-text-meta text-nc-text-secondary break-words">
                      Usuário conectado: <span className="text-white font-medium">{credentials.username}</span>
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className={accountGridClass}>
                {/* Usuário conectado */}
                <div className="rounded-xl bg-nc-bg-input/90 border border-white/[0.07] px-4 py-4 flex items-start gap-3.5 min-w-0">
                  <User className="w-5 h-5 text-nc-text-secondary mt-0.5 shrink-0" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="nc-text-meta text-nc-text-secondary">Usuário</p>
                    <p
                      className={`font-semibold break-words text-base mt-1 ${
                        rawUsername ? 'text-white' : 'text-nc-text-secondary'
                      }`}
                    >
                      {usernameDisplay}
                    </p>
                  </div>
                </div>

                {/* Validade da assinatura */}
                <div className="rounded-xl bg-nc-bg-input/90 border border-white/[0.07] px-4 py-4 flex items-start gap-3.5 min-w-0">
                  <Calendar className="w-5 h-5 text-nc-text-secondary mt-0.5 shrink-0" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="nc-text-meta text-nc-text-secondary">Validade da Assinatura</p>
                    <p
                      className={`font-semibold break-words text-base mt-1 tabular-nums ${
                        expirationInfo.isExpired
                          ? 'text-red-400'
                          : expirationInfo.isAvailable
                            ? 'text-white'
                            : 'text-nc-text-secondary'
                      }`}
                    >
                      {expirationInfo.label}
                    </p>
                  </div>
                </div>

                {/* Status da conta */}
                <div className="rounded-xl bg-nc-bg-input/90 border border-white/[0.07] px-4 py-4 flex items-start gap-3.5 min-w-0">
                  {statusInfo.tone === 'active' ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" aria-hidden="true" />
                  ) : statusInfo.tone === 'inactive' ? (
                    <AlertCircle className="w-5 h-5 text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-nc-text-secondary mt-0.5 shrink-0" aria-hidden="true" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="nc-text-meta text-nc-text-secondary">Status da Conta</p>
                    <p
                      className={`font-semibold break-words text-base mt-1 ${
                        statusInfo.tone === 'active'
                          ? 'text-emerald-400'
                          : statusInfo.tone === 'inactive'
                            ? 'text-red-400'
                            : statusInfo.isAvailable
                              ? 'text-white'
                              : 'text-nc-text-secondary'
                      }`}
                    >
                      {statusInfo.label}
                    </p>
                  </div>
                </div>

                {/* Conexões ativas e limite simultâneo */}
                <div className="rounded-xl bg-nc-bg-input/90 border border-white/[0.07] px-4 py-4 flex items-start gap-3.5 min-w-0">
                  <Users className="w-5 h-5 text-nc-text-secondary mt-0.5 shrink-0" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="nc-text-meta text-nc-text-secondary">Conexões Ativas</p>
                    <p
                      className={`font-semibold text-base mt-1 tabular-nums ${
                        connectionsInfo.isAvailable ? 'text-white' : 'text-nc-text-secondary'
                      }`}
                    >
                      {connectionsInfo.displayText}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* 3. Apresentação e Tamanho da Interface (Segunda seção) */}
          <section
            aria-label="Apresentação e Tamanho da Interface"
            data-scroll-block="true"
            data-config-section="presentation"
            className="bg-nc-bg-card border border-white/10 rounded-2xl p-5 sm:p-6 md:p-7 space-y-5"
          >
            <div className="flex items-center gap-2.5">
              {effectiveMode === 'tv' ? (
                <Tv className="w-5 h-5 text-white/80 shrink-0" aria-hidden="true" />
              ) : (
                <Monitor className="w-5 h-5 text-white/80 shrink-0" aria-hidden="true" />
              )}
              <h2 className="nc-heading-section font-semibold text-white">
                Apresentação e Tamanho da Interface
              </h2>
            </div>

            <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
              <div className="grid grid-cols-2 gap-4 sm:gap-6 min-w-0">
                <div className="min-w-0">
                  <p className="nc-text-meta text-nc-text-secondary">Modo atual</p>
                  <p className="font-semibold text-white text-base mt-1 break-words">
                    {activeModeLabel}
                  </p>
                </div>

                <div className="min-w-0">
                  <p className="nc-text-meta text-nc-text-secondary">Escala</p>
                  <p className="font-semibold text-white text-base mt-1 tabular-nums">
                    {activeScaleLabel}
                  </p>
                </div>
              </div>

              <div
                data-nav-row="config-presentation-actions"
                className="nc-action-group shrink-0"
              >
                <button
                  type="button"
                  data-nav-item="true"
                  data-config-primary="true"
                  onClick={(e) => handleOpenAdjustModal('device', e.currentTarget)}
                  className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 rounded-xl bg-nc-primary text-black font-semibold text-sm hover:bg-nc-primary-hover active:scale-[0.98] transition-all duration-150 whitespace-nowrap cursor-pointer"
                >
                  <Sliders className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Ajustar apresentação</span>
                </button>

                {mode === 'tv' && (
                  <button
                    type="button"
                    data-nav-item="true"
                    onClick={(e) => handleOpenAdjustModal('tv-calibrate', e.currentTarget)}
                    className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-white border border-white/15 font-medium text-sm active:scale-[0.98] transition-all duration-150 whitespace-nowrap cursor-pointer tabular-nums"
                  >
                    <Tv className="w-4 h-4 text-white/85 shrink-0" aria-hidden="true" />
                    <span>Calibrar escala ({tvScale}%)</span>
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* 4. Desempenho visual (visível apenas no APK Android) */}
          {isAndroidApk && (
            <section
              aria-label="Desempenho visual"
              data-scroll-block="true"
              data-config-section="performance"
              className="bg-nc-bg-card border border-white/10 rounded-2xl p-5 sm:p-6 md:p-7 space-y-5"
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <Gauge className="w-5 h-5 text-white/80 shrink-0" aria-hidden="true" />
                  <h2 className="nc-heading-section font-semibold text-white">
                    Desempenho visual
                  </h2>
                </div>
                <p
                  data-performance-active-label="true"
                  className="nc-text-meta text-nc-text-secondary"
                >
                  Ativo agora:{' '}
                  <span className="text-white font-semibold">
                    {effectivePerformanceMode === 'lite' ? 'Lite' : 'Completo'}
                  </span>
                </p>
              </div>

              <div
                role="radiogroup"
                aria-label="Opções de desempenho visual"
                data-nav-row="config-performance-options"
                className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-3.5"
              >
                {PERFORMANCE_OPTIONS.map((option) => {
                  const isSelected = performancePreference === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      data-nav-item="true"
                      data-performance-option={option.id}
                      data-selected={isSelected ? 'true' : 'false'}
                      onClick={() => setPerformancePreference(option.id)}
                      className={`text-left rounded-xl p-4 border cursor-pointer flex flex-col justify-between gap-2.5 min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/90 ${
                        isSelected
                          ? 'bg-white/[0.12] border-white/65 text-white'
                          : 'bg-nc-bg-input/90 border-white/[0.07] text-nc-text-secondary hover:bg-white/[0.06] hover:border-white/20 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-sm sm:text-base text-white">
                          {option.label}
                        </span>
                        <span
                          aria-hidden="true"
                          className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${
                            isSelected
                              ? 'bg-white border-white text-black'
                              : 'border-white/25 bg-transparent text-transparent'
                          }`}
                        >
                          <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                        </span>
                      </div>
                      <p className="nc-text-meta text-nc-text-secondary leading-relaxed">
                        {option.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
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
