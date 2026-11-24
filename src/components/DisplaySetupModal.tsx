import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Tv,
  Smartphone,
  Monitor,
  Check,
  ArrowLeft,
  Sliders,
} from 'lucide-react';
import {
  DisplayMode,
  TV_SCALE_MIN,
  TV_SCALE_MAX,
  TV_SCALE_STEP,
  TV_SCALE_DEFAULT,
  clampTvScale,
  getDisplayPreferencesSnapshot,
  useDisplayPreferences,
} from '../platform/tvEnvironment';
import {
  useBackHandler,
  BACK_PRIORITY,
  focusElementSafely,
  setNavMode,
  moveSpatialFocus,
  SpatialDirection,
} from '../navigation';

export type DeviceChoiceId = 'celular' | 'tv' | 'computador';

interface DeviceOptionMeta {
  id: DeviceChoiceId;
  label: string;
  mode: DisplayMode;
  description: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const DEVICE_OPTIONS: DeviceOptionMeta[] = [
  {
    id: 'celular',
    label: 'Celular',
    mode: 'default',
    description: 'Smartphones e tablets.',
    Icon: Smartphone,
  },
  {
    id: 'tv',
    label: 'TV',
    mode: 'tv',
    description: 'Smart TV, Android TV e TV Box.',
    Icon: Tv,
  },
  {
    id: 'computador',
    label: 'Computador',
    mode: 'default',
    description: 'Notebooks e desktops.',
    Icon: Monitor,
  },
];

// In-memory last chosen responsive device label for the current session (does not alter stored preferences format)
let lastSelectedResponsiveChoice: Exclude<DeviceChoiceId, 'tv'> = 'celular';

interface DisplaySetupModalProps {
  isOpen: boolean;
  canCancel?: boolean;
  initialStep?: 'device' | 'tv-calibrate';
  onComplete: () => void;
  onCancel?: () => void;
}

type SetupStep = 'device' | 'tv-calibrate' | 'default-confirm';

function resolveSavedOrDefaultTvScale(): number {
  const snap = getDisplayPreferencesSnapshot();
  return snap.isConfigured ? clampTvScale(snap.tvScale) : TV_SCALE_DEFAULT;
}

function resolveInitialDeviceChoice(): DeviceChoiceId {
  const snap = getDisplayPreferencesSnapshot();
  if (snap.isConfigured && snap.mode === 'default') {
    return lastSelectedResponsiveChoice;
  }
  return 'tv';
}

export function DisplaySetupModal({
  isOpen,
  canCancel = false,
  initialStep = 'device',
  onComplete,
  onCancel,
}: DisplaySetupModalProps) {
  const { confirmPreferences } = useDisplayPreferences();

  const [step, setStep] = useState<SetupStep>(initialStep);
  const [selectedChoice, setSelectedChoice] = useState<DeviceChoiceId>(() =>
    resolveInitialDeviceChoice()
  );
  const [draftScale, setDraftScale] = useState<number>(() =>
    resolveSavedOrDefaultTvScale()
  );
  const [isDraggingSlider, setIsDraggingSlider] = useState(false);

  const modalRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const pendingFocusSelectorRef = useRef<string | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingFocusTimer = useCallback(() => {
    if (focusTimerRef.current !== null) {
      clearTimeout(focusTimerRef.current);
      focusTimerRef.current = null;
    }
  }, []);

  // Initialize local draft state when modal opens/closes/unmounts (never mutates global DOM or storage)
  useEffect(() => {
    if (!isOpen) {
      clearPendingFocusTimer();
      setIsDraggingSlider(false);
      setDraftScale(resolveSavedOrDefaultTvScale());
      return;
    }

    const initialChoice = resolveInitialDeviceChoice();
    const initialScale = resolveSavedOrDefaultTvScale();
    setSelectedChoice(initialChoice);
    setDraftScale(initialScale);
    setIsDraggingSlider(false);
    setStep(initialStep);

    if (initialStep === 'tv-calibrate') {
      setSelectedChoice('tv');
      pendingFocusSelectorRef.current = '[data-calibration-slider="true"]';
    } else {
      pendingFocusSelectorRef.current = `[data-device-choice="${initialChoice}"]`;
    }

    return () => {
      clearPendingFocusTimer();
    };
  }, [isOpen, initialStep, clearPendingFocusTimer]);

  // Apply programmatic focus when step changes or modal opens
  useEffect(() => {
    clearPendingFocusTimer();
    if (!isOpen) return;
    const root = modalRef.current;
    if (!root) return;

    const applyPendingFocus = (): boolean => {
      if (!modalRef.current || !modalRef.current.isConnected) return false;
      const selector = pendingFocusSelectorRef.current;
      const target =
        (selector ? modalRef.current.querySelector<HTMLElement>(selector) : null) ||
        modalRef.current.querySelector<HTMLElement>('[data-autofocus="true"]') ||
        modalRef.current.querySelector<HTMLElement>('button, [role="slider"]');

      if (target && target.isConnected) {
        pendingFocusSelectorRef.current = null;
        focusElementSafely(target);
        return true;
      }
      return false;
    };

    if (!applyPendingFocus()) {
      focusTimerRef.current = setTimeout(() => {
        focusTimerRef.current = null;
        applyPendingFocus();
      }, 0);
    }

    return () => {
      clearPendingFocusTimer();
    };
  }, [isOpen, step, clearPendingFocusTimer]);

  const handleSelectDeviceOption = useCallback((choice: DeviceChoiceId) => {
    setSelectedChoice(choice);
    if (choice === 'tv') {
      const baseScale = resolveSavedOrDefaultTvScale();
      setDraftScale(baseScale);
      pendingFocusSelectorRef.current = '[data-calibration-slider="true"]';
      setStep('tv-calibrate');
      return;
    }

    pendingFocusSelectorRef.current = '[data-confirm-default="true"]';
    setStep('default-confirm');
  }, []);

  const handleReturnToDeviceStep = useCallback(() => {
    setIsDraggingSlider(false);
    setDraftScale(resolveSavedOrDefaultTvScale());
    pendingFocusSelectorRef.current = `[data-device-choice="${selectedChoice}"]`;
    setStep('device');
  }, [selectedChoice]);

  const handleCancelModal = useCallback(() => {
    clearPendingFocusTimer();
    setIsDraggingSlider(false);
    setDraftScale(resolveSavedOrDefaultTvScale());
    onCancel?.();
  }, [clearPendingFocusTimer, onCancel]);

  const handleConfirmTv = useCallback(() => {
    clearPendingFocusTimer();
    confirmPreferences('tv', draftScale);
    onComplete();
  }, [confirmPreferences, draftScale, clearPendingFocusTimer, onComplete]);

  const handleConfirmDefault = useCallback(() => {
    clearPendingFocusTimer();
    if (selectedChoice !== 'tv') {
      lastSelectedResponsiveChoice = selectedChoice;
    }
    const preservedTvScale = resolveSavedOrDefaultTvScale();
    confirmPreferences('default', preservedTvScale);
    onComplete();
  }, [confirmPreferences, selectedChoice, clearPendingFocusTimer, onComplete]);

  const applyScaleValue = useCallback((rawVal: number) => {
    const next = clampTvScale(rawVal);
    setDraftScale(next);
  }, []);

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

  const handleModalKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.defaultPrevented) return;
      let direction: SpatialDirection | null = null;
      if (e.key === 'ArrowUp') direction = 'up';
      else if (e.key === 'ArrowDown') direction = 'down';
      else if (e.key === 'ArrowLeft') direction = 'left';
      else if (e.key === 'ArrowRight') direction = 'right';
      if (!direction) return;

      const activeEl =
        typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;

      // Let the continuous scale slider handle ArrowLeft/ArrowRight directly
      if (
        activeEl &&
        activeEl.getAttribute('role') === 'slider' &&
        (direction === 'left' || direction === 'right')
      ) {
        return;
      }

      e.preventDefault();
      setNavMode('remote');
      moveSpatialFocus(direction);
    },
    []
  );

  if (!isOpen) return null;

  const selectedOptionMeta =
    DEVICE_OPTIONS.find((opt) => opt.id === selectedChoice) || DEVICE_OPTIONS[0];
  const SelectedIcon = selectedOptionMeta.Icon;

  const scalePercentProgress =
    ((draftScale - TV_SCALE_MIN) / (TV_SCALE_MAX - TV_SCALE_MIN)) * 100;

  // Local sample dimensions computed strictly from draftScale (never touches documentElement)
  const sampleScaleFactor = draftScale / 100;
  const sampleIconBoxPx = Math.round(44 * sampleScaleFactor);
  const sampleIconSvgPx = Math.round(22 * sampleScaleFactor);
  const sampleTitleFontPx = Number((18 * sampleScaleFactor).toFixed(2));
  const sampleSubtextFontPx = Number((13.5 * sampleScaleFactor).toFixed(2));

  return (
    <div
      ref={modalRef}
      role="dialog"
      aria-modal="true"
      aria-label="Configuração de apresentação da interface"
      data-focus-scope="modal"
      data-display-setup-modal="true"
      onKeyDown={handleModalKeyDown}
      className="nc-calibration-modal nc-safe-modal fixed inset-0 z-[150] bg-black/85 backdrop-blur-md flex items-center justify-center sm:p-5 overflow-y-auto select-none"
    >
      <div className="nc-calibration-shell w-full max-w-[780px] bg-nc-bg-card border border-nc-border/70 rounded-2xl shadow-2xl overflow-hidden my-auto">
        {/* Step 1: Three Device Options (Celular, TV, Computador) */}
        {step === 'device' && (
          <div className="nc-calibration-safe p-5 sm:p-7 space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-nc-border/50 pb-4">
              <div className="flex items-center gap-3.5 min-w-0 flex-1">
                <div className="w-11 h-11 rounded-xl bg-nc-primary/15 border border-nc-primary/30 flex items-center justify-center text-nc-primary shrink-0">
                  <Tv className="w-6 h-6" />
                </div>
                <div className="min-w-0">
                  <h2 className="nc-cal-title font-bold text-white break-words">
                    Como você está usando o North Code Play?
                  </h2>
                  <p className="nc-cal-subtitle text-nc-text-secondary mt-0.5 break-words">
                    Escolha o dispositivo para ajustar a interface.
                  </p>
                </div>
              </div>

              {canCancel && (
                <button
                  type="button"
                  data-nav-item="true"
                  data-device-cancel="true"
                  onClick={handleCancelModal}
                  className="nc-cal-btn px-3.5 py-2 rounded-xl bg-nc-bg-input hover:bg-nc-border/50 text-nc-text-secondary hover:text-white border border-nc-border/50 transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-2"
                >
                  Fechar
                </button>
              )}
            </div>

            <div
              data-nav-grid="true"
              data-device-choices="true"
              className="grid grid-cols-1 sm:grid-cols-3 gap-3.5"
            >
              {DEVICE_OPTIONS.map((opt) => {
                const OptionIcon = opt.Icon;
                const isSelected = selectedChoice === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    data-nav-item="true"
                    data-device-choice={opt.id}
                    data-device-mode={opt.mode}
                    data-autofocus={isSelected ? 'true' : undefined}
                    onClick={() => handleSelectDeviceOption(opt.id)}
                    className={`text-left p-4 sm:p-5 rounded-2xl border transition-all flex flex-col justify-between gap-4 focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-2 ${
                      isSelected
                        ? 'bg-nc-primary/15 border-nc-primary text-white shadow-lg'
                        : 'bg-nc-bg-input/80 border-nc-border/50 text-gray-200 hover:bg-nc-bg-input hover:border-white/40'
                    }`}
                  >
                    <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center text-white shrink-0">
                      <OptionIcon className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="nc-cal-card-title font-bold text-white">{opt.label}</div>
                      <p className="nc-cal-card-desc text-nc-text-secondary mt-1">
                        {opt.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 1B: Confirm Non-TV Device (Celular or Computador -> mode="default") */}
        {step === 'default-confirm' && (
          <div className="nc-calibration-safe p-5 sm:p-7 space-y-6">
            <div className="flex items-center gap-3.5 border-b border-nc-border/50 pb-4">
              <div className="w-11 h-11 rounded-xl bg-nc-primary/15 border border-nc-primary/30 flex items-center justify-center text-nc-primary shrink-0">
                <SelectedIcon className="w-6 h-6" />
              </div>
              <div>
                <h2
                  data-default-confirm-title="true"
                  className="nc-cal-title font-bold text-white"
                >
                  {selectedOptionMeta.label}
                </h2>
                <p className="nc-cal-subtitle text-nc-text-secondary mt-0.5">
                  A interface será ajustada para uso em {selectedOptionMeta.label.toLowerCase()}.
                </p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-nc-bg-input/70 border border-nc-border/50 text-gray-300 nc-cal-card-desc">
              Você poderá alterar esta escolha a qualquer momento em{' '}
              <strong className="text-white">Configurações &rarr; Ajustar apresentação</strong>.
            </div>

            <div
              data-nav-row="default-confirm-actions"
              className="flex flex-wrap items-center justify-end gap-3 pt-2"
            >
              <button
                type="button"
                data-nav-item="true"
                data-default-back="true"
                onClick={handleReturnToDeviceStep}
                className="nc-cal-btn flex items-center gap-2 px-4 py-2.5 rounded-xl bg-nc-bg-input hover:bg-nc-border/60 text-gray-200 hover:text-white border border-nc-border/60 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-2"
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
                className="nc-cal-btn flex items-center gap-2 px-5 py-2.5 rounded-xl bg-nc-primary text-black font-semibold hover:bg-nc-primary-hover transition-colors shadow-lg focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-2"
              >
                <Check className="w-4 h-4" />
                <span>Confirmar {selectedOptionMeta.label}</span>
              </button>
            </div>
          </div>
        )}

        {/* Step 2: TV Scale Calibration with Local Lightweight Sample */}
        {step === 'tv-calibrate' && (
          <div className="flex flex-col">
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
                    Use as setas Esquerda/Direita para ajustar o tamanho e Confirmar para aplicar.
                  </p>
                </div>
              </div>
              <div
                data-calibration-draft-badge="true"
                className="nc-cal-scale-pill px-3 py-1 rounded-xl bg-nc-primary text-black font-bold shrink-0 tabular-nums"
              >
                {draftScale}%
              </div>
            </div>

            {/* Lightweight Local Sample (scoped strictly to this box, never mutates html or root font-size) */}
            <div className="p-4 sm:p-5 bg-black/70 border-b border-nc-border/50">
              <div className="nc-calibration-safe flex items-center justify-between mb-2.5">
                <span className="nc-cal-badge text-nc-text-secondary font-semibold">
                  Amostra de leitura ({draftScale}%)
                </span>
              </div>

              <div
                aria-label={`Amostra de tamanho em ${draftScale}%`}
                data-calibration-sample="true"
                data-sample-scale={String(draftScale)}
                style={
                  {
                    '--nc-local-sample-scale': String(sampleScaleFactor),
                  } as React.CSSProperties
                }
                className="w-full min-h-[108px] px-4 py-4 rounded-xl border border-nc-border/60 bg-nc-bg flex items-center gap-4 pointer-events-none overflow-hidden"
              >
                <div
                  data-sample-icon="true"
                  style={{
                    width: `${sampleIconBoxPx}px`,
                    height: `${sampleIconBoxPx}px`,
                  }}
                  className="rounded-xl bg-nc-bg-card border border-nc-border/60 flex items-center justify-center text-white shrink-0 transition-[width,height] duration-100"
                >
                  <Tv
                    style={{
                      width: `${sampleIconSvgPx}px`,
                      height: `${sampleIconSvgPx}px`,
                    }}
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <div
                    data-sample-text="true"
                    style={{
                      fontSize: `${sampleTitleFontPx}px`,
                      lineHeight: 1.3,
                    }}
                    className="font-semibold text-white truncate transition-[font-size] duration-100"
                  >
                    Canal Demonstração HD — Programação ao Vivo
                  </div>
                  <div
                    data-sample-subtext="true"
                    style={{
                      fontSize: `${sampleSubtextFontPx}px`,
                      lineHeight: 1.35,
                    }}
                    className="text-nc-text-secondary truncate mt-1 transition-[font-size] duration-100"
                  >
                    Verifique se o ícone e o texto estão confortáveis a distância ({draftScale}%)
                  </div>
                </div>
              </div>
            </div>

            {/* Slider and Action Controls (protected with fixed pixel sizes) */}
            <div className="nc-calibration-safe p-5 space-y-5 bg-nc-bg-card">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="nc-cal-label font-semibold text-white">
                    Tamanho da interface
                  </label>
                  <span className="nc-cal-label font-mono font-bold text-nc-primary tabular-nums">
                    {draftScale}%
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
                  className="nc-cal-slider-box relative w-full py-3 px-2 rounded-xl bg-nc-bg-input border border-nc-border/70 cursor-pointer flex flex-col gap-2 focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-2"
                >
                  <div className="relative w-full h-3 bg-white/15 rounded-full overflow-hidden">
                    <div
                      data-calibration-slider-fill="true"
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
                          tick === draftScale ? 'bg-white scale-125' : 'bg-white/20'
                        }`}
                      />
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between text-nc-text-secondary nc-cal-badge">
                  <span>{TV_SCALE_MIN}% &mdash; Menor</span>
                  <span>{TV_SCALE_MAX}% &mdash; Maior</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div
                data-nav-row="tv-calibration-actions"
                className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-nc-border/40"
              >
                <button
                  type="button"
                  data-nav-item="true"
                  data-calibration-back="true"
                  onClick={handleReturnToDeviceStep}
                  className="nc-cal-btn flex items-center gap-2 px-4 py-2.5 rounded-xl bg-nc-bg-input hover:bg-nc-border/60 text-gray-200 hover:text-white border border-nc-border/60 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-2"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Voltar</span>
                </button>

                <button
                  type="button"
                  data-nav-item="true"
                  data-player-primary="true"
                  data-calibration-confirm="true"
                  onClick={handleConfirmTv}
                  className="nc-cal-btn flex items-center gap-2 px-5 py-2.5 rounded-xl bg-nc-primary text-black font-semibold hover:bg-nc-primary-hover transition-colors shadow-lg focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-2"
                >
                  <Check className="w-4 h-4" />
                  <span>Confirmar</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
