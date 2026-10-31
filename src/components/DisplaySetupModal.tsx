import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Tv, Monitor, Check, RotateCcw, ArrowLeft, Sliders, Sparkles } from 'lucide-react';
import {
  DisplayMode,
  TV_SCALE_MIN,
  TV_SCALE_MAX,
  TV_SCALE_STEP,
  TV_SCALE_DEFAULT,
  clampTvScale,
  createDisplayPreviewSession,
  getDisplayPreferencesSnapshot,
  useDisplayPreferences,
} from '../platform/tvEnvironment';
import {
  useBackHandler,
  BACK_PRIORITY,
  focusElementSafely,
} from '../navigation';

interface DisplaySetupModalProps {
  isOpen: boolean;
  canCancel?: boolean;
  initialStep?: 'device' | 'tv-calibrate';
  onComplete: () => void;
  onCancel?: () => void;
}

type SetupStep = 'device' | 'tv-calibrate' | 'default-confirm';

export function DisplaySetupModal({
  isOpen,
  canCancel = false,
  initialStep = 'device',
  onComplete,
  onCancel,
}: DisplaySetupModalProps) {
  const {
    mode: confirmedMode,
    tvScale: confirmedTvScale,
    isConfigured,
    startPreview,
    cancelPreview,
    confirmPreferences,
  } = useDisplayPreferences();

  const [step, setStep] = useState<SetupStep>(initialStep);
  const [selectedDevice, setSelectedDevice] = useState<DisplayMode>(() =>
    isConfigured ? confirmedMode : 'tv'
  );
  const [draftScale, setDraftScale] = useState<number>(() =>
    isConfigured ? clampTvScale(confirmedTvScale) : TV_SCALE_DEFAULT
  );
  const [isDraggingSlider, setIsDraggingSlider] = useState(false);

  const modalRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const pendingFocusSelectorRef = useRef<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingFocusTimer = useCallback(() => {
    if (focusTimerRef.current !== null) {
      clearTimeout(focusTimerRef.current);
      focusTimerRef.current = null;
    }
  }, []);

  const ensureSessionId = useCallback((): string => {
    if (!activeSessionIdRef.current) {
      activeSessionIdRef.current = createDisplayPreviewSession();
    }
    return activeSessionIdRef.current;
  }, []);

  // Initialize state and manage preview session lifecycle when modal opens/closes/unmounts
  useEffect(() => {
    if (!isOpen) {
      clearPendingFocusTimer();
      if (activeSessionIdRef.current) {
        const staleSessionId = activeSessionIdRef.current;
        activeSessionIdRef.current = null;
        cancelPreview(staleSessionId);
      }
      return;
    }

    const sessionId = createDisplayPreviewSession();
    activeSessionIdRef.current = sessionId;

    const snap = getDisplayPreferencesSnapshot();
    const initialMode: DisplayMode = snap.isConfigured ? snap.mode : 'tv';
    const initialScale = snap.isConfigured ? clampTvScale(snap.tvScale) : TV_SCALE_DEFAULT;
    setSelectedDevice(initialMode);
    setDraftScale(initialScale);
    setStep(initialStep);

    if (initialStep === 'tv-calibrate') {
      startPreview('tv', initialScale, sessionId);
      pendingFocusSelectorRef.current = '[data-calibration-slider="true"]';
    } else {
      pendingFocusSelectorRef.current = `[data-device-choice="${initialMode}"]`;
    }

    return () => {
      clearPendingFocusTimer();
      cancelPreview(sessionId);
      if (activeSessionIdRef.current === sessionId) {
        activeSessionIdRef.current = null;
      }
    };
  }, [isOpen, initialStep, startPreview, cancelPreview, clearPendingFocusTimer]);

  // Apply programmatic focus when step changes or modal opens
  useEffect(() => {
    clearPendingFocusTimer();
    if (!isOpen) return;
    const root = modalRef.current;
    if (!root) return;

    focusTimerRef.current = setTimeout(() => {
      focusTimerRef.current = null;
      if (!modalRef.current || !modalRef.current.isConnected) return;
      const selector = pendingFocusSelectorRef.current;
      pendingFocusSelectorRef.current = null;

      const target =
        (selector ? modalRef.current.querySelector<HTMLElement>(selector) : null) ||
        modalRef.current.querySelector<HTMLElement>('[data-autofocus="true"]') ||
        modalRef.current.querySelector<HTMLElement>('button, [role="slider"]');

      if (target && target.isConnected) {
        focusElementSafely(target);
      }
    }, 0);

    return () => {
      clearPendingFocusTimer();
    };
  }, [isOpen, step, clearPendingFocusTimer]);

  const handleSelectTvDevice = useCallback(() => {
    const sessionId = ensureSessionId();
    const nextScale =
      isConfigured && confirmedMode === 'tv'
        ? clampTvScale(confirmedTvScale)
        : draftScale || TV_SCALE_DEFAULT;
    setSelectedDevice('tv');
    setDraftScale(nextScale);
    startPreview('tv', nextScale, sessionId);
    pendingFocusSelectorRef.current = '[data-calibration-slider="true"]';
    setStep('tv-calibrate');
  }, [isConfigured, confirmedMode, confirmedTvScale, draftScale, startPreview, ensureSessionId]);

  const handleSelectOtherDevice = useCallback(() => {
    const sessionId = ensureSessionId();
    setSelectedDevice('default');
    startPreview('default', draftScale, sessionId);
    pendingFocusSelectorRef.current = '[data-confirm-default="true"]';
    setStep('default-confirm');
  }, [draftScale, startPreview, ensureSessionId]);

  const handleReturnToDeviceStep = useCallback(() => {
    if (activeSessionIdRef.current) {
      cancelPreview(activeSessionIdRef.current);
    }
    pendingFocusSelectorRef.current = `[data-device-choice="${selectedDevice}"]`;
    setStep('device');
  }, [cancelPreview, selectedDevice]);

  const handleCancelModal = useCallback(() => {
    clearPendingFocusTimer();
    if (activeSessionIdRef.current) {
      cancelPreview(activeSessionIdRef.current);
    }
    onCancel?.();
  }, [cancelPreview, clearPendingFocusTimer, onCancel]);

  const handleConfirmTv = useCallback(() => {
    clearPendingFocusTimer();
    confirmPreferences('tv', draftScale, activeSessionIdRef.current ?? undefined);
    onComplete();
  }, [confirmPreferences, draftScale, clearPendingFocusTimer, onComplete]);

  const handleConfirmDefault = useCallback(() => {
    clearPendingFocusTimer();
    confirmPreferences('default', draftScale, activeSessionIdRef.current ?? undefined);
    onComplete();
  }, [confirmPreferences, draftScale, clearPendingFocusTimer, onComplete]);

  const handleResetScale = useCallback(() => {
    const sessionId = ensureSessionId();
    setDraftScale(TV_SCALE_DEFAULT);
    startPreview('tv', TV_SCALE_DEFAULT, sessionId);
  }, [startPreview, ensureSessionId]);

  const applyScaleValue = useCallback(
    (rawVal: number) => {
      const sessionId = ensureSessionId();
      const next = clampTvScale(rawVal);
      setDraftScale(next);
      startPreview('tv', next, sessionId);
    },
    [startPreview, ensureSessionId]
  );

  // Back policy integration
  useBackHandler(
    'display-setup-modal',
    BACK_PRIORITY.SUB_MODAL + 10,
    () => {
      if (!isOpen) return false;
      if (step === 'tv-calibrate' || step === 'default-confirm') {
        handleReturnToDeviceStep();
        return true;
      }
      if (canCancel) {
        handleCancelModal();
        return true;
      }
      // On mandatory first-run device selection step, consume Back so underlying app does not react
      return true;
    },
    isOpen
  );

  const updateScaleFromPointer = useCallback(
    (clientX: number) => {
      const bar = sliderRef.current;
      if (!bar) return;
      const rect = bar.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const rawValue = TV_SCALE_MIN + ratio * (TV_SCALE_MAX - TV_SCALE_MIN);
      applyScaleValue(rawValue);
    },
    [applyScaleValue]
  );

  if (!isOpen) return null;

  const scalePercentProgress =
    ((draftScale - TV_SCALE_MIN) / (TV_SCALE_MAX - TV_SCALE_MIN)) * 100;

  return (
    <div
      ref={modalRef}
      role="dialog"
      aria-modal="true"
      aria-label="Configuração de apresentação da interface"
      data-focus-scope="modal"
      data-display-setup-modal="true"
      className="nc-calibration-modal fixed inset-0 z-[150] bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 overflow-y-auto select-none"
    >
      <div className="nc-calibration-shell w-full max-w-[820px] bg-nc-bg-card border border-nc-border/70 rounded-2xl shadow-2xl overflow-hidden my-auto">
        {/* Step 1: Explicit Device Selection */}
        {step === 'device' && (
          <div className="nc-calibration-safe p-5 sm:p-7 space-y-6">
            <div className="flex items-start justify-between gap-4 border-b border-nc-border/50 pb-4">
              <div className="flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-xl bg-nc-primary/15 border border-nc-primary/30 flex items-center justify-center text-nc-primary shrink-0">
                  <Tv className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="nc-cal-title font-bold text-white">
                    Como você está usando o North Code Play?
                  </h2>
                  <p className="nc-cal-subtitle text-nc-text-secondary mt-0.5">
                    Escolha o tipo de dispositivo para ajustar as proporções da interface.
                  </p>
                </div>
              </div>

              {canCancel && (
                <button
                  type="button"
                  data-nav-item="true"
                  onClick={handleCancelModal}
                  className="nc-cal-btn px-3.5 py-2 rounded-xl bg-nc-bg-input hover:bg-nc-border/50 text-nc-text-secondary hover:text-white border border-nc-border/50 transition-colors shrink-0"
                >
                  Fechar
                </button>
              )}
            </div>

            <div
              data-nav-row="display-device-choices"
              className="grid grid-cols-1 sm:grid-cols-2 gap-4"
            >
              <button
                type="button"
                data-nav-item="true"
                data-device-choice="tv"
                data-autofocus={selectedDevice === 'tv' ? 'true' : undefined}
                onClick={handleSelectTvDevice}
                className={`text-left p-5 rounded-2xl border transition-all flex flex-col justify-between gap-4 ${
                  selectedDevice === 'tv'
                    ? 'bg-nc-primary/15 border-nc-primary text-white shadow-lg'
                    : 'bg-nc-bg-input/80 border-nc-border/50 text-gray-200 hover:bg-nc-bg-input hover:border-white/40'
                }`}
              >
                <div className="flex items-center justify-between gap-3 w-full">
                  <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center text-white">
                    <Tv className="w-6 h-6" />
                  </div>
                  <span className="nc-cal-badge px-2.5 py-1 rounded-full bg-white/10 text-white/90 font-medium">
                    Ajuste de escala
                  </span>
                </div>
                <div>
                  <div className="nc-cal-card-title font-bold text-white">TV</div>
                  <p className="nc-cal-card-desc text-nc-text-secondary mt-1">
                    Smart TV, Android TV ou TV Box. Permite calibrar o tamanho da interface para enxergar mais conteúdo na tela.
                  </p>
                </div>
              </button>

              <button
                type="button"
                data-nav-item="true"
                data-device-choice="default"
                data-autofocus={selectedDevice === 'default' ? 'true' : undefined}
                onClick={handleSelectOtherDevice}
                className={`text-left p-5 rounded-2xl border transition-all flex flex-col justify-between gap-4 ${
                  selectedDevice === 'default'
                    ? 'bg-nc-primary/15 border-nc-primary text-white shadow-lg'
                    : 'bg-nc-bg-input/80 border-nc-border/50 text-gray-200 hover:bg-nc-bg-input hover:border-white/40'
                }`}
              >
                <div className="flex items-center justify-between gap-3 w-full">
                  <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center text-white">
                    <Monitor className="w-6 h-6" />
                  </div>
                  <span className="nc-cal-badge px-2.5 py-1 rounded-full bg-white/10 text-white/90 font-medium">
                    Padrão 100%
                  </span>
                </div>
                <div>
                  <div className="nc-cal-card-title font-bold text-white">
                    Outros dispositivos
                  </div>
                  <p className="nc-cal-card-desc text-nc-text-secondary mt-1">
                    Computador, celular ou tablet. Mantém o layout responsivo padrão sem aplicar escala de TV.
                  </p>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Step 1B: Confirm "Outros dispositivos" */}
        {step === 'default-confirm' && (
          <div className="nc-calibration-safe p-5 sm:p-7 space-y-6">
            <div className="flex items-center gap-3.5 border-b border-nc-border/50 pb-4">
              <div className="w-11 h-11 rounded-xl bg-nc-primary/15 border border-nc-primary/30 flex items-center justify-center text-nc-primary shrink-0">
                <Monitor className="w-6 h-6" />
              </div>
              <div>
                <h2 className="nc-cal-title font-bold text-white">
                  Outros dispositivos — Computador, celular ou tablet
                </h2>
                <p className="nc-cal-subtitle text-nc-text-secondary mt-0.5">
                  O comportamento responsivo padrão (100%) será utilizado sem escala específica de TV.
                </p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-nc-bg-input/70 border border-nc-border/50 text-gray-300 nc-cal-card-desc">
              Você poderá alterar esta escolha a qualquer momento em <strong className="text-white">Configurações &rarr; Ajustar apresentação</strong>.
            </div>

            <div
              data-nav-row="default-confirm-actions"
              className="flex flex-wrap items-center justify-end gap-3 pt-2"
            >
              <button
                type="button"
                data-nav-item="true"
                onClick={handleReturnToDeviceStep}
                className="nc-cal-btn flex items-center gap-2 px-4 py-2.5 rounded-xl bg-nc-bg-input hover:bg-nc-border/60 text-gray-200 hover:text-white border border-nc-border/60 font-medium transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Voltar</span>
              </button>

              <button
                type="button"
                data-nav-item="true"
                data-confirm-default="true"
                data-autofocus="true"
                onClick={handleConfirmDefault}
                className="nc-cal-btn flex items-center gap-2 px-5 py-2.5 rounded-xl bg-nc-primary text-black font-semibold hover:bg-nc-primary-hover transition-colors shadow-lg"
              >
                <Check className="w-4 h-4" />
                <span>Confirmar e continuar</span>
              </button>
            </div>
          </div>
        )}

        {/* Step 2: TV Continuous Scale Calibration */}
        {step === 'tv-calibrate' && (
          <div className=" flex flex-col">
            {/* Header (fixed legible scale) */}
            <div className="nc-calibration-safe px-5 pt-4 pb-3 border-b border-nc-border/50 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-nc-primary/15 border border-nc-primary/30 flex items-center justify-center text-nc-primary shrink-0">
                  <Sliders className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="nc-cal-title font-bold text-white">
                    Calibração de Tamanho para TV
                  </h2>
                  <p className="nc-cal-subtitle text-nc-text-secondary">
                    Use as setas Esquerda/Direita para ajustar a escala em tempo real e Baixo para confirmar.
                  </p>
                </div>
              </div>
              <div className="nc-cal-scale-pill px-3 py-1 rounded-xl bg-nc-primary text-black font-bold shrink-0">
                {draftScale}%
              </div>
            </div>

            {/* Static Real-Token Preview Area (scales with root html[data-display-mode="tv"] and --nc-ui-scale!) */}
            <div className="p-3 sm:p-4 bg-black/70 border-b border-nc-border/50">
              <div className="nc-calibration-safe flex items-center justify-between mb-2">
                <span className="nc-cal-badge text-nc-text-secondary uppercase tracking-wider font-semibold flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-nc-primary" /> Prévia em tempo real ({draftScale}%)
                </span>
                <span className="nc-cal-badge text-nc-text-secondary">
                  {draftScale < 85
                    ? 'Mais itens visíveis na tela'
                    : draftScale === 85
                    ? 'Tamanho inicial sugerido para TV (85%)'
                    : 'Elementos maiores na tela'}
                </span>
              </div>

              {/* Miniature App Layout using real rem & TV tokens */}
              <div
                aria-hidden="true"
                className="w-full h-[185px] sm:h-[210px] rounded-xl border border-nc-border/60 bg-nc-bg overflow-hidden flex pointer-events-none"
              >
                {/* Simulated Sidebar */}
                <div className="w-[calc(8.5*var(--nc-rem,1rem))] flex flex-col border-r border-nc-border/50 bg-black/60 shrink-0 h-full">
                  <div className="nc-tv-sidebar-logo border-b border-nc-border/30">
                    <div className="font-bold text-white text-xs truncate">NORTH CODE</div>
                  </div>
                  <div className="nc-tv-sidebar-nav flex-1 flex flex-col overflow-hidden">
                    <button
                      type="button"
                      tabIndex={-1}
                      className="flex items-center gap-2 w-full rounded-lg bg-nc-primary text-black font-semibold text-left truncate"
                    >
                      <span className="w-2 h-2 rounded-full bg-black shrink-0" />
                      <span className="truncate">Início</span>
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      className="flex items-center gap-2 w-full rounded-lg text-nc-text-secondary text-left truncate"
                    >
                      <span className="w-2 h-2 rounded-full bg-nc-text-secondary/50 shrink-0" />
                      <span className="truncate">TV ao Vivo</span>
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      className="flex items-center gap-2 w-full rounded-lg text-nc-text-secondary text-left truncate"
                    >
                      <span className="w-2 h-2 rounded-full bg-nc-text-secondary/50 shrink-0" />
                      <span className="truncate">Filmes</span>
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      className="flex items-center gap-2 w-full rounded-lg text-nc-text-secondary text-left truncate"
                    >
                      <span className="w-2 h-2 rounded-full bg-nc-text-secondary/50 shrink-0" />
                      <span className="truncate">Séries</span>
                    </button>
                  </div>
                </div>

                {/* Simulated Category & Channel Pane */}
                <div className="w-[calc(9.5*var(--nc-rem,1rem))] hidden sm:flex flex-col border-r border-nc-border/50 bg-nc-bg-card/30 shrink-0 h-full p-2 gap-1 overflow-hidden">
                  <div className="text-xs font-semibold uppercase tracking-wider text-nc-text-secondary px-2 py-1">
                    Canais
                  </div>
                  <div className="nc-tv-category-btn rounded-lg bg-nc-primary text-black font-semibold">
                    Canais Abertos HD
                  </div>
                  <div className="nc-tv-category-btn rounded-lg text-nc-text-secondary bg-nc-bg-input/50">
                    Esportes Ao Vivo
                  </div>
                  <div className="nc-tv-category-btn rounded-lg text-nc-text-secondary">
                    Filmes & Séries
                  </div>
                  <div className="nc-tv-category-btn rounded-lg text-nc-text-secondary">
                    Documentários
                  </div>
                </div>

                {/* Simulated Content Grid */}
                <div className="nc-tv-content-pad flex-1 min-w-0 h-full overflow-hidden flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-white truncate">
                      Destaques do Catálogo
                    </span>
                    <span className="text-xs text-nc-text-secondary">
                      Escala {draftScale}%
                    </span>
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(calc(5.75*var(--nc-rem,1rem)),1fr))] gap-2 flex-1 content-start overflow-hidden">
                    {Array.from({ length: 10 }).map((_, idx) => (
                      <div
                        key={idx}
                        className={`aspect-[16/10] rounded-lg border p-2 flex flex-col justify-end ${
                          idx === 0
                            ? 'bg-nc-primary/20 border-nc-primary'
                            : 'bg-nc-bg-card border-nc-border/50'
                        }`}
                      >
                        <div className="text-xs font-semibold text-white truncate">
                          Item {idx + 1}
                        </div>
                        <div className="text-xs text-nc-text-secondary truncate">
                          Full HD
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Slider and Action Controls (protected with fixed pixel sizes so 50% scale never shrinks the modal buttons) */}
            <div className="nc-calibration-safe p-5 space-y-5 bg-nc-bg-card">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="nc-cal-label font-semibold text-white">
                    Tamanho da interface
                  </label>
                  <span className="nc-cal-label font-mono font-bold text-nc-primary">
                    {draftScale}% {draftScale === TV_SCALE_DEFAULT ? '(Sugerido)' : ''}
                  </span>
                </div>

                {/* Interactive Continuous Slider (50% to 125%, step 5%) */}
                <div
                  ref={sliderRef}
                  role="slider"
                  tabIndex={0}
                  aria-label="Tamanho da interface"
                  aria-valuemin={TV_SCALE_MIN}
                  aria-valuemax={TV_SCALE_MAX}
                  aria-valuenow={draftScale}
                  aria-valuetext={`${draftScale}%`}
                  data-nav-row="tv-scale-slider"
                  data-nav-item="true"
                  data-calibration-slider="true"
                  data-autofocus="true"
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft') {
                      e.preventDefault();
                      e.stopPropagation();
                      applyScaleValue(draftScale - TV_SCALE_STEP);
                    } else if (e.key === 'ArrowRight') {
                      e.preventDefault();
                      e.stopPropagation();
                      applyScaleValue(draftScale + TV_SCALE_STEP);
                    }
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setIsDraggingSlider(true);
                    try {
                      e.currentTarget.setPointerCapture(e.pointerId);
                    } catch {}
                    updateScaleFromPointer(e.clientX);
                  }}
                  onPointerMove={(e) => {
                    if (!isDraggingSlider) return;
                    e.stopPropagation();
                    updateScaleFromPointer(e.clientX);
                  }}
                  onPointerUp={(e) => {
                    if (!isDraggingSlider) return;
                    e.stopPropagation();
                    setIsDraggingSlider(false);
                    try {
                      e.currentTarget.releasePointerCapture(e.pointerId);
                    } catch {}
                  }}
                  className="nc-cal-slider-box relative w-full py-3 px-2 rounded-xl bg-nc-bg-input border border-nc-border/70 cursor-pointer flex flex-col gap-2 focus:outline-none"
                >
                  <div className="relative w-full h-3 bg-white/15 rounded-full overflow-hidden">
                    <div
                      className="absolute top-0 bottom-0 left-0 bg-nc-primary rounded-full transition-[width] duration-75"
                      style={{ width: `${scalePercentProgress}%` }}
                    />
                  </div>

                  {/* Step ticks */}
                  <div className="flex items-center justify-between px-0.5">
                    {Array.from(
                      { length: (TV_SCALE_MAX - TV_SCALE_MIN) / TV_SCALE_STEP + 1 },
                      (_, i) => TV_SCALE_MIN + i * TV_SCALE_STEP
                    ).map((tick) => (
                      <span
                        key={tick}
                        className={`w-1 h-1.5 rounded-full ${
                          tick === draftScale
                            ? 'bg-white scale-125'
                            : tick === TV_SCALE_DEFAULT
                            ? 'bg-white/60'
                            : 'bg-white/20'
                        }`}
                      />
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between text-nc-text-secondary nc-cal-badge">
                  <span>{TV_SCALE_MIN}% &mdash; Menor (mais conteúdo visível)</span>
                  <span>Sugerido: {TV_SCALE_DEFAULT}%</span>
                  <span>{TV_SCALE_MAX}% &mdash; Maior (menos conteúdo)</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div
                data-nav-row="tv-calibration-actions"
                className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-nc-border/40"
              >
                <button
                  type="button"
                  data-nav-item="true"
                  onClick={handleReturnToDeviceStep}
                  className="nc-cal-btn flex items-center gap-2 px-4 py-2.5 rounded-xl bg-nc-bg-input hover:bg-nc-border/60 text-gray-200 hover:text-white border border-nc-border/60 font-medium transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Voltar</span>
                </button>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    data-nav-item="true"
                    onClick={handleResetScale}
                    className="nc-cal-btn flex items-center gap-2 px-4 py-2.5 rounded-xl bg-nc-bg-input hover:bg-nc-border/60 text-gray-200 hover:text-white border border-nc-border/60 font-medium transition-colors"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>Restaurar tamanho inicial ({TV_SCALE_DEFAULT}%)</span>
                  </button>

                  <button
                    type="button"
                    data-nav-item="true"
                    data-player-primary="true"
                    data-calibration-confirm="true"
                    onClick={handleConfirmTv}
                    className="nc-cal-btn flex items-center gap-2 px-5 py-2.5 rounded-xl bg-nc-primary text-black font-semibold hover:bg-nc-primary-hover transition-colors shadow-lg"
                  >
                    <Check className="w-4 h-4" />
                    <span>Confirmar</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
